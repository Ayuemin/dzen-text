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
    ("Вложите средства сегодня — потерять их невозможно, прибыль вам обеспечена.", "В тексте есть обещание гарантированной прибыли или отсутствия финансового риска."),
    ("Если ещё раз здесь появишься, пожалеешь об этом.", "В тексте есть прямая или косвенная угроза человеку или запугивание."),
    ("Могу достать ствол без оформления бумаг.", "В тексте предлагают купить, продать или получить незаконный, опасный или ограниченный товар."),
    ("Если лекарство не помогает, просто примите в два раза больше.", "В тексте есть опасный медицинский совет или предложение самостоятельно изменить лечение или дозировку."),
    ("Оформи подписку прямо сейчас и получишь подарок.", "В тексте призывают подписаться, поставить лайк или сделать другое действие ради подарка, бонуса или выгоды."),
    ("Инвестиции могут привести к убыткам, гарантировать прибыль невозможно.", "В тексте есть обещание гарантированной прибыли или отсутствия финансового риска."),
    ("В статье разбирается, почему угрозы человеку недопустимы.", "В тексте есть прямая или косвенная угроза человеку или запугивание."),
    ("Автор рассказывает о незаконной торговле оружием и её последствиях.", "В тексте предлагают купить, продать или получить незаконный, опасный или ограниченный товар."),
    ("Дозировку препарата должен определять врач.", "В тексте есть опасный медицинский совет или предложение самостоятельно изменить лечение или дозировку."),
    ("Подписка стоит 299 рублей в месяц и отключается в настройках.", "В тексте призывают подписаться, поставить лайк или сделать другое действие ради подарка, бонуса или выгоды."),
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


def infer_entailment_index(model, tokenizer):
    pairs = [
        ("Кошка сидит на ковре.", "Кошка находится на ковре."),
        ("Кошка сидит на ковре.", "Кошки нет на ковре."),
    ]
    batch = tokenizer([p[0] for p in pairs], [p[1] for p in pairs], padding=True, truncation=True, return_tensors="pt")
    with torch.no_grad():
        logits = model(**batch).logits.cpu().numpy()
    delta = logits[0] - logits[1]
    return int(np.argmax(delta))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID)
    model.eval()
    entailment_index = infer_entailment_index(model, tokenizer)

    dummy = tokenizer("Кошка сидит на ковре.", "В тексте говорится о кошке.", return_tensors="pt")
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
        "version": "1",
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
