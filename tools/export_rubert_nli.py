#!/usr/bin/env python3
import json
import shutil
import zipfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

MODEL_ID = "cointegrated/rubert-tiny-bilingual-nli"
OUT = Path("build/local-nli")
PKG = Path("build/rubert-tiny-nli-android.zip")
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
        return self.model(input_ids=input_ids, attention_mask=attention_mask, token_type_ids=token_type_ids).logits


def softmax(x):
    x = np.asarray(x, dtype=np.float64)
    x -= x.max(axis=-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=-1, keepdims=True)


def score_pairs(session, tokenizer, entailment_index, pairs):
    premises = [p for p, _ in pairs]
    hypotheses = [h for _, h in pairs]
    enc = tokenizer(premises, hypotheses, padding=True, truncation=True, max_length=MAX_LEN, return_tensors="np")
    logits = session.run(["logits"], {
        "input_ids": enc["input_ids"].astype(np.int64),
        "attention_mask": enc["attention_mask"].astype(np.int64),
        "token_type_ids": enc["token_type_ids"].astype(np.int64),
    })[0]
    return softmax(logits)[:, entailment_index]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID)
    model.eval()
    entailment_index = int(model.config.label2id.get("entailment", 1))

    dummy = tokenizer("Кошка сидит на ковре.", "кошка на ковре", return_tensors="pt")
    wrapper = Wrapper(model)
    model_path = OUT / "model.onnx"
    torch.onnx.export(
        wrapper,
        (dummy["input_ids"], dummy["attention_mask"], dummy["token_type_ids"]),
        model_path,
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

    tok_dir = OUT / "tokenizer_tmp"
    tokenizer.save_pretrained(tok_dir)
    shutil.copyfile(tok_dir / "vocab.txt", OUT / "vocab.txt")
    shutil.rmtree(tok_dir)

    metadata = {
        "schema": "local-nli-model-v1",
        "name": "RuBERT-tiny bilingual NLI",
        "version": "3",
        "source": MODEL_ID,
        "max_length": MAX_LEN,
        "entailment_index": entailment_index,
        "inputs": ["input_ids", "attention_mask", "token_type_ids"],
        "output": "logits",
    }
    (OUT / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    report = []
    for category, case in CASES.items():
        pairs = [
            (case["positive"], case["signal"]),
            (case["positive"], case["safe"]),
            (case["negative"], case["signal"]),
            (case["negative"], case["safe"]),
        ]
        p_signal, p_safe, n_signal, n_safe = score_pairs(session, tokenizer, entailment_index, pairs)
        p_contrast = float(p_signal - p_safe)
        n_contrast = float(n_signal - n_safe)
        row = {
            "category": category,
            "signal": case["signal"],
            "safe": case["safe"],
            "positive_signal": float(p_signal),
            "positive_safe": float(p_safe),
            "positive_contrast": p_contrast,
            "negative_signal": float(n_signal),
            "negative_safe": float(n_safe),
            "negative_contrast": n_contrast,
            "separation": float(p_contrast - n_contrast),
        }
        report.append(row)
        print(
            f"{category:10s} pos={p_contrast:+.4f} ({p_signal:.3f}-{p_safe:.3f}) "
            f"neg={n_contrast:+.4f} ({n_signal:.3f}-{n_safe:.3f}) sep={p_contrast-n_contrast:+.4f}"
        )
    (OUT / "smoke_scores.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    with zipfile.ZipFile(PKG, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name in ["model.onnx", "vocab.txt", "metadata.json"]:
            z.write(OUT / name, name)
    print(f"entailment_index={entailment_index}")
    print(f"package={PKG} size={PKG.stat().st_size}")

if __name__ == "__main__":
    main()
