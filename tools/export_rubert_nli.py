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

SMOKE = [
    ("Вложите средства сегодня — потерять их невозможно, прибыль вам обеспечена.", "гарантированная прибыль без риска"),
    ("Если ещё раз здесь появишься, пожалеешь об этом.", "угроза человеку"),
    ("Могу достать ствол без оформления бумаг.", "продажа оружия без документов"),
    ("Если лекарство не помогает, просто примите в два раза больше.", "опасное самостоятельное изменение дозировки лекарства"),
    ("Оформи подписку прямо сейчас и получишь подарок.", "призыв подписаться ради подарка или выгоды"),
    ("Инвестиции могут привести к убыткам, гарантировать прибыль невозможно.", "гарантированная прибыль без риска"),
    ("В статье разбирается, почему угрозы человеку недопустимы.", "угроза человеку"),
    ("Автор рассказывает о незаконной торговле оружием и её последствиях.", "продажа оружия без документов"),
    ("Дозировку препарата должен определять врач.", "опасное самостоятельное изменение дозировки лекарства"),
    ("Подписка стоит 299 рублей в месяц и отключается в настройках.", "призыв подписаться ради подарка или выгоды"),
]

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
        "version": "2",
        "source": MODEL_ID,
        "max_length": MAX_LEN,
        "entailment_index": entailment_index,
        "inputs": ["input_ids", "attention_mask", "token_type_ids"],
        "output": "logits",
    }
    (OUT / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    premises = [x[0] for x in SMOKE]
    hypotheses = [x[1] for x in SMOKE]
    enc = tokenizer(premises, hypotheses, padding=True, truncation=True, max_length=MAX_LEN, return_tensors="np")
    logits = session.run(["logits"], {
        "input_ids": enc["input_ids"].astype(np.int64),
        "attention_mask": enc["attention_mask"].astype(np.int64),
        "token_type_ids": enc["token_type_ids"].astype(np.int64),
    })[0]
    scores = softmax(logits)[:, entailment_index]
    report = []
    for i, ((premise, hypothesis), score) in enumerate(zip(SMOKE, scores), 1):
        row = {"id": i, "premise": premise, "hypothesis": hypothesis, "entailment": float(score)}
        report.append(row)
        print(f"{i:02d} {score:.4f} | {premise}")
    (OUT / "smoke_scores.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    with zipfile.ZipFile(PKG, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name in ["model.onnx", "vocab.txt", "metadata.json"]:
            z.write(OUT / name, name)
    print(f"entailment_index={entailment_index}")
    print(f"package={PKG} size={PKG.stat().st_size}")

if __name__ == "__main__":
    main()
