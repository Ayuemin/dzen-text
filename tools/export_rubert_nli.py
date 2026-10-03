#!/usr/bin/env python3
import json
import shutil
import zipfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoModelForSequenceClassification, AutoTokenizer

MODEL_ID = "cointegrated/rubert-base-cased-nli-threeway"
OUT = Path("build/local-nli")
PKG = Path("build/rubert-base-nli-int8-android.zip")
MAX_LEN = 192

CASES = {
    "finance": {
        "positive": "Вложите средства сегодня — потерять их невозможно, прибыль вам обеспечена.",
        "negative": "Инвестиции могут привести к убыткам, гарантировать прибыль невозможно.",
        "signal": "автор обещает гарантированную прибыль без риска",
        "safe": "автор предупреждает, что прибыль не гарантирована и возможны убытки",
    },
    "threat": {
        "positive": "Если ещё раз здесь появишься, пожалеешь об этом.",
        "negative": "В статье разбирается, почему угрозы человеку недопустимы.",
        "signal": "автор угрожает человеку неприятными последствиями",
        "safe": "автор обсуждает угрозы и осуждает их",
    },
    "restricted": {
        "positive": "Могу достать ствол без оформления бумаг.",
        "negative": "Автор рассказывает о незаконной торговле оружием и её последствиях.",
        "signal": "автор предлагает достать оружие без документов",
        "safe": "автор обсуждает незаконную торговлю оружием и её последствия",
    },
    "medical": {
        "positive": "Если лекарство не помогает, просто примите в два раза больше.",
        "negative": "Дозировку препарата должен определять врач.",
        "signal": "автор советует самостоятельно увеличить дозировку лекарства",
        "safe": "автор советует определять дозировку лекарства с врачом",
    },
    "engagement": {
        "positive": "Оформи подписку прямо сейчас и получишь подарок.",
        "negative": "Подписка стоит 299 рублей в месяц и отключается в настройках.",
        "signal": "автор призывает подписаться ради подарка",
        "safe": "автор нейтрально сообщает цену и условия отключения подписки",
    },
}


class Wrapper(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids, attention_mask, token_type_ids):
        return self.model(
            input_ids=input_ids,
            attention_mask=attention_mask,
            token_type_ids=token_type_ids,
        ).logits


def softmax(x):
    x = np.asarray(x, dtype=np.float64)
    x -= x.max(axis=-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=-1, keepdims=True)


def encode_pairs(tokenizer, pairs, tensor_type):
    premises = [p for p, _ in pairs]
    hypotheses = [h for _, h in pairs]
    return tokenizer(
        premises,
        hypotheses,
        padding=True,
        truncation=True,
        max_length=MAX_LEN,
        return_tensors=tensor_type,
    )


def score_onnx(session, tokenizer, entailment_index, pairs):
    enc = encode_pairs(tokenizer, pairs, "np")
    logits = session.run(["logits"], {
        "input_ids": enc["input_ids"].astype(np.int64),
        "attention_mask": enc["attention_mask"].astype(np.int64),
        "token_type_ids": enc["token_type_ids"].astype(np.int64),
    })[0]
    return softmax(logits), softmax(logits)[:, entailment_index]


def score_torch(model, tokenizer, entailment_index, pairs):
    enc = encode_pairs(tokenizer, pairs, "pt")
    with torch.no_grad():
        logits = model(**enc).logits.cpu().numpy()
    return softmax(logits), softmax(logits)[:, entailment_index]


def label_index(model, name, fallback):
    labels = {str(k).lower(): int(v) for k, v in model.config.label2id.items()}
    return labels.get(name.lower(), fallback)


def summarize(scores):
    p_signal, p_safe, n_signal, n_safe = [float(x) for x in scores]
    p_contrast = p_signal - p_safe
    n_contrast = n_signal - n_safe
    return {
        "positive_signal": p_signal,
        "positive_safe": p_safe,
        "positive_contrast": p_contrast,
        "negative_signal": n_signal,
        "negative_safe": n_safe,
        "negative_contrast": n_contrast,
        "separation": p_contrast - n_contrast,
    }


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID)
    model.eval()
    entailment_index = label_index(model, "entailment", 0)
    contradiction_index = label_index(model, "contradiction", 1)
    neutral_index = label_index(model, "neutral", 2)
    print("label2id=", model.config.label2id)
    print("id2label=", model.config.id2label)

    dummy = tokenizer("Кошка сидит на ковре.", "кошка на ковре", return_tensors="pt")
    wrapper = Wrapper(model)
    fp32_path = OUT / "model-fp32.onnx"
    int8_path = OUT / "model.onnx"
    torch.onnx.export(
        wrapper,
        (dummy["input_ids"], dummy["attention_mask"], dummy["token_type_ids"]),
        fp32_path,
        input_names=["input_ids", "attention_mask", "token_type_ids"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "token_type_ids": {0: "batch", 1: "sequence"},
            "logits": {0: "batch"},
        },
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )

    quantize_dynamic(
        model_input=str(fp32_path),
        model_output=str(int8_path),
        weight_type=QuantType.QInt8,
        per_channel=False,
        reduce_range=False,
        op_types_to_quantize=["MatMul", "Gemm"],
        extra_options={"DefaultTensorType": "float"},
    )

    tok_dir = OUT / "tokenizer_tmp"
    tokenizer.save_pretrained(tok_dir)
    vocab = tok_dir / "vocab.txt"
    if not vocab.exists():
        raise RuntimeError("Tokenizer did not produce vocab.txt")
    shutil.copyfile(vocab, OUT / "vocab.txt")
    shutil.rmtree(tok_dir)

    metadata = {
        "schema": "local-nli-model-v1",
        "name": "RuBERT-base NLI INT8",
        "version": "2",
        "source": MODEL_ID,
        "quantization": "dynamic-int8",
        "max_length": MAX_LEN,
        "entailment_index": entailment_index,
        "contradiction_index": contradiction_index,
        "neutral_index": neutral_index,
        "inputs": ["input_ids", "attention_mask", "token_type_ids"],
        "output": "logits",
    }
    (OUT / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    fp32_session = ort.InferenceSession(str(fp32_path), providers=["CPUExecutionProvider"])
    int8_session = ort.InferenceSession(str(int8_path), providers=["CPUExecutionProvider"])
    report = []
    for category, case in CASES.items():
        pairs = [
            (case["positive"], case["signal"]),
            (case["positive"], case["safe"]),
            (case["negative"], case["signal"]),
            (case["negative"], case["safe"]),
        ]
        torch_probs, torch_scores = score_torch(model, tokenizer, entailment_index, pairs)
        fp32_probs, fp32_scores = score_onnx(fp32_session, tokenizer, entailment_index, pairs)
        int8_probs, int8_scores = score_onnx(int8_session, tokenizer, entailment_index, pairs)
        torch_summary = summarize(torch_scores)
        fp32_summary = summarize(fp32_scores)
        int8_summary = summarize(int8_scores)
        row = {
            "category": category,
            "signal": case["signal"],
            "safe": case["safe"],
            "torch": torch_summary,
            "onnx_fp32": fp32_summary,
            "onnx_int8": int8_summary,
            "torch_probs": torch_probs.tolist(),
            "fp32_probs": fp32_probs.tolist(),
            "int8_probs": int8_probs.tolist(),
        }
        report.append(row)
        print(
            f"{category:10s} "
            f"torch sep={torch_summary['separation']:+.4f} "
            f"fp32 sep={fp32_summary['separation']:+.4f} "
            f"int8 sep={int8_summary['separation']:+.4f} | "
            f"int8 pos={int8_summary['positive_contrast']:+.4f} "
            f"neg={int8_summary['negative_contrast']:+.4f}"
        )

    (OUT / "smoke_scores.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    fp32_size = fp32_path.stat().st_size
    int8_size = int8_path.stat().st_size
    fp32_path.unlink()

    with zipfile.ZipFile(PKG, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name in ["model.onnx", "vocab.txt", "metadata.json"]:
            z.write(OUT / name, name)

    print(f"labels entailment={entailment_index} contradiction={contradiction_index} neutral={neutral_index}")
    print(f"fp32_size={fp32_size} int8_size={int8_size} ratio={int8_size/fp32_size:.3f}")
    print(f"package={PKG} size={PKG.stat().st_size}")


if __name__ == "__main__":
    main()
