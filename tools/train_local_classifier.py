#!/usr/bin/env python3
"""
Train the starter fully-local semantic classifier for the Android prototype.

The model is intentionally small and transparent:
- hashed character n-grams, exactly matching LocalTextClassifier.java;
- one logistic-regression head per semantic label;
- a two-node ONNX graph (MatMul + Add);
- synthetic Russian training data with explicit hard negatives.

This is a starter signal model, not a moderation authority. It is tuned to
surface suspicious sentences for human review with relatively conservative
thresholds.
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_recall_fscore_support
from sklearn.model_selection import train_test_split

FEATURE_COUNT = 4096
NGRAM_MIN = 3
NGRAM_MAX = 5
RANDOM_SEED = 20261003

LABELS = [
    "financial-promise",
    "aggression-violence",
    "restricted-sale",
    "medical-advice",
    "spam-promotion",
    "neutral",
]

LABEL_META = {
    "financial-promise": {
        "title": "Возможное финансовое обещание",
        "message": "Проверьте, не обещает ли предложение гарантированный, лёгкий или безрисковый доход.",
        "severity": "warning",
        "emit": True,
    },
    "aggression-violence": {
        "title": "Возможная агрессия или насилие",
        "message": "Проверьте смысл предложения: модель увидела признаки угрозы, призыва или одобрения насилия.",
        "severity": "warning",
        "emit": True,
    },
    "restricted-sale": {
        "title": "Возможная продажа ограниченного товара",
        "message": "Проверьте, не предлагает ли предложение купить, продать или заказать ограниченный товар или услугу.",
        "severity": "warning",
        "emit": True,
    },
    "medical-advice": {
        "title": "Возможная медицинская рекомендация",
        "message": "Проверьте, не содержит ли предложение категоричной медицинской рекомендации, опасной дозировки или обещания результата.",
        "severity": "warning",
        "emit": True,
    },
    "spam-promotion": {
        "title": "Возможный навязчивый призыв",
        "message": "Проверьте, не является ли предложение навязчивым рекламным призывом или искусственным стимулированием активности.",
        "severity": "warning",
        "emit": True,
    },
    "neutral": {
        "title": "Нейтральный контекст",
        "message": "",
        "severity": "warning",
        "emit": False,
    },
}


@dataclass(frozen=True)
class Example:
    text: str
    labels: frozenset[str]


def ex(text: str, *labels: str) -> Example:
    return Example(text.strip(), frozenset(labels))


def java_signed32(value: int) -> int:
    value &= 0xFFFFFFFF
    return value if value < 0x80000000 else value - 0x100000000


def fnv1a_java_chars(value: str, start: int, end: int) -> int:
    h = 0x811C9DC5
    for ch in value[start:end]:
        c = ord(ch)
        # LocalTextClassifier.java hashes the low byte and then the high byte
        # of every UTF-16 char. Russian text is inside the BMP, so Python's
        # code point equals the Java char value for this dataset.
        h ^= c & 0xFF
        h = (h * 0x01000193) & 0xFFFFFFFF
        h ^= (c >> 8) & 0xFF
        h = (h * 0x01000193) & 0xFFFFFFFF
    return java_signed32(h)


def features_for(text: str) -> np.ndarray:
    vector = np.zeros(FEATURE_COUNT, dtype=np.float32)
    normalized = " ".join(text.lower().split())
    if not normalized:
        return vector
    padded = f" {normalized} "
    for n in range(NGRAM_MIN, NGRAM_MAX + 1):
        if len(padded) < n:
            continue
        for i in range(0, len(padded) - n + 1):
            h = fnv1a_java_chars(padded, i, i + n)
            index = (h & 0x7FFFFFFF) % FEATURE_COUNT
            vector[index] += -1.0 if h < 0 else 1.0
    norm = float(np.linalg.norm(vector))
    if norm > 0:
        vector /= norm
    return vector


def add_variants(rows: list[Example], texts: list[str], labels: tuple[str, ...], prefixes: list[str], suffixes: list[str]) -> None:
    for text in texts:
        rows.append(ex(text, *labels))
        for prefix in prefixes:
            rows.append(ex(prefix + text[0].lower() + text[1:], *labels))
        for suffix in suffixes:
            rows.append(ex(text.rstrip(".!?") + suffix, *labels))


def build_dataset() -> list[Example]:
    rng = random.Random(RANDOM_SEED)
    rows: list[Example] = []

    money = ["50 000 рублей", "100 000 рублей", "200 000 рублей", "30 000 рублей", "миллион рублей"]
    periods = ["за неделю", "за месяц", "за три дня", "за вечер", "за пару часов"]
    percents = ["20%", "40%", "70%", "100%", "200%"]
    finance_templates = [
        "Гарантированный доход {money} {period} без риска.",
        "Вложите деньги сегодня и получите {pct} прибыли гарантированно.",
        "Этот способ даст каждому {money} {period}, потерь не будет.",
        "Доход без риска гарантирован каждому участнику.",
        "Ваш капитал удвоится, результат гарантирован.",
        "Заработок {money} {period} без вложений и без риска.",
        "Инвестиция приносит стабильные {pct}, вы ничего не потеряете.",
        "Прибыль гарантирована, достаточно перевести деньги сейчас.",
        "Получите фиксированный доход {money}, никаких рисков.",
        "Схема позволяет гарантированно заработать {money} {period}.",
    ]
    for _ in range(320):
        t = rng.choice(finance_templates)
        rows.append(ex(t.format(money=rng.choice(money), period=rng.choice(periods), pct=rng.choice(percents)),
                       "financial-promise"))

    finance_hard_negatives = [
        "Гарантированный доход не существует, инвестиции всегда связаны с риском.",
        "Доход не гарантируется: можно потерять часть или все вложенные деньги.",
        "Прошлая доходность не гарантирует будущую прибыль.",
        "Автор не обещает заработок и предупреждает о возможных убытках.",
        "Инвестиции могут принести доход, но результат заранее неизвестен.",
        "Безрисковых инвестиций не бывает.",
        "Высокая доходность обычно означает высокий риск.",
        "Мы обсуждаем обещания гарантированного дохода как признак мошенничества.",
        "Фраза «доход без риска» приведена как пример опасной рекламы.",
        "Можно заработать, а можно потерять деньги — гарантии нет.",
    ]
    add_variants(rows, finance_hard_negatives, (),
                 ["Важно понимать: ", "В статье подчёркивается, что ", "Эксперт напоминает: "],
                 [", и это нужно учитывать.", ", поэтому обещаний быть не должно."])

    violence_templates = [
        "Я тебя убью.",
        "Надо убить их всех.",
        "Его нужно избить, чтобы понял.",
        "Давайте уничтожим этих людей.",
        "Я тебя зарежу, если придёшь снова.",
        "Таких надо расстреливать.",
        "Соберёмся и переломаем ему руки.",
        "Нужно напасть на него сегодня вечером.",
        "Я обещаю тебя покалечить.",
        "Подожги их дом, пусть боятся.",
        "Его следует забить до смерти.",
        "Надо устроить расправу над ними.",
    ]
    for _ in range(320):
        rows.append(ex(rng.choice(violence_templates), "aggression-violence"))

    violence_hard_negatives = [
        "В фильме герой говорит: «Я тебя убью», но сцена осуждает насилие.",
        "Нельзя угрожать людям и призывать кого-либо убить.",
        "Статья рассказывает, как предотвратить домашнее насилие.",
        "Историки описывают убийство как трагическое событие.",
        "Фраза «убить время» означает просто занять себя.",
        "Мы осуждаем любые призывы к расправе.",
        "Полиция расследует угрозы и попытку нападения.",
        "Автор объясняет, почему насилие недопустимо.",
        "Не бейте человека и не пытайтесь решать конфликт силой.",
        "Слово «убийство» встречается в названии детективного романа.",
    ]
    add_variants(rows, violence_hard_negatives, (),
                 ["В образовательном материале сказано: ", "Для контекста: ", "Автор отдельно поясняет: "],
                 [", это не призыв к действию.", ", насилие здесь не одобряется."])

    goods = ["оружие", "патроны", "наркотики", "вейп", "никотиновые жидкости", "рецептурные таблетки"]
    restricted_templates = [
        "Купить {good} без документов можно по этой ссылке.",
        "Продам {good}, пишите в личку.",
        "Заказать {good} с доставкой без проверки возраста.",
        "Есть {good} недорого, оплата переводом.",
        "Купите {good} прямо сейчас, отправлю сегодня.",
        "Продаю {good} без рецепта и лишних вопросов.",
        "Можно достать {good}, обращайтесь.",
        "Закажи {good}, доставка анонимная.",
    ]
    for _ in range(320):
        rows.append(ex(rng.choice(restricted_templates).format(good=rng.choice(goods)), "restricted-sale"))

    restricted_hard_negatives = [
        "Продажа оружия без лицензии запрещена законом.",
        "В статье обсуждается незаконная торговля наркотиками.",
        "Купить подписку на журнал можно на сайте издательства.",
        "Продам старый стол и книжный шкаф.",
        "Рецептурный препарат отпускают только по назначению врача.",
        "Мы не продаём никотиновые изделия несовершеннолетним.",
        "Исследование посвящено рынку оружия и правилам лицензирования.",
        "Полиция пресекла попытку продать запрещённые вещества.",
        "Не покупайте лекарства с рук.",
        "Заказать обычные книги можно с доставкой.",
    ]
    add_variants(rows, restricted_hard_negatives, (),
                 ["Справочно: ", "В материале говорится, что ", "Правило простое: "],
                 [", это обычное информационное упоминание.", ", предложение о продаже отсутствует."])

    medical_templates = [
        "Принимайте антибиотик три раза в день без консультации врача.",
        "Этот препарат гарантированно лечит рак.",
        "Увеличьте дозировку самостоятельно, если эффекта нет.",
        "Не обращайтесь к врачу, просто пейте эти таблетки.",
        "Средство полностью излечивает диабет за неделю.",
        "Отмените назначенный врачом препарат и принимайте этот.",
        "Детям можно дать двойную дозу для быстрого эффекта.",
        "Этот метод гарантированно вылечит заболевание без обследования.",
        "Начните принимать антибиотики при первых симптомах.",
        "Лекарство безопасно для всех, противопоказаний нет.",
    ]
    for _ in range(320):
        rows.append(ex(rng.choice(medical_templates), "medical-advice"))

    medical_hard_negatives = [
        "Перед приёмом лекарства обратитесь к врачу.",
        "Не меняйте дозировку самостоятельно.",
        "Информация в статье не заменяет медицинскую консультацию.",
        "Антибиотики назначает врач после оценки показаний.",
        "У препарата есть противопоказания и побочные эффекты.",
        "Нет гарантии, что лечение поможет конкретному человеку.",
        "При ухудшении состояния требуется медицинская помощь.",
        "Мы разбираем миф о том, что антибиотики лечат вирусные инфекции.",
        "Автор не рекомендует отменять назначенное лечение.",
        "Дозировка зависит от диагноза и состояния пациента.",
    ]
    add_variants(rows, medical_hard_negatives, (),
                 ["Врач предупреждает: ", "Важно: ", "В справочном материале сказано: "],
                 [", решение принимает специалист.", ", самолечение не рекомендуется."])

    promo_templates = [
        "Подпишись прямо сейчас и получи подарок.",
        "Поставь лайк, сделай репост и отметь трёх друзей.",
        "Купите подписчиков и быстро раскрутите канал.",
        "Накрутим лайки и просмотры недорого.",
        "Подпишитесь, чтобы получить секретный бонус.",
        "Жми на ссылку и оформляй подписку прямо сейчас.",
        "Используй промокод и обязательно подпишись на канал.",
        "Сделай репост, чтобы участвовать в розыгрыше.",
        "Подпишись и поставь лайк для доступа к материалу.",
        "Купи пакет подписчиков со скидкой сегодня.",
    ]
    for _ in range(320):
        rows.append(ex(rng.choice(promo_templates), "spam-promotion"))

    promo_hard_negatives = [
        "Я отменил подписку на сервис.",
        "Подписка на журнал закончилась в прошлом месяце.",
        "Количество подписчиков выросло после публикации.",
        "Мы не просим читателей ставить лайки или делать репосты.",
        "Статья анализирует накрутку подписчиков как проблему.",
        "Пользователь может самостоятельно оформить или отменить подписку.",
        "Автор объясняет, почему покупка подписчиков вредит статистике.",
        "В исследовании сравнивают число лайков и просмотров.",
        "Промокод указан в истории рекламной кампании как пример.",
        "Слово «подписка» само по себе не означает призыв.",
    ]
    add_variants(rows, promo_hard_negatives, (),
                 ["Для примера: ", "В аналитическом тексте сказано: ", "Нейтральное описание: "],
                 [", призыва к действию здесь нет.", ", это описание, а не реклама."])

    # Multi-label cases make independent sigmoid heads useful in practice.
    multi = [
        ex("Подпишись прямо сейчас и получи гарантированный доход без риска.", "spam-promotion", "financial-promise"),
        ex("Купи рецептурные таблетки без рецепта и принимай двойную дозу.", "restricted-sale", "medical-advice"),
        ex("Сделай репост и призови подписчиков избить этого человека.", "spam-promotion", "aggression-violence"),
        ex("Закажи запрещённые таблетки, они гарантированно вылечат болезнь.", "restricted-sale", "medical-advice"),
        ex("Купи доступ к схеме и гарантированно заработай сто тысяч за неделю.", "spam-promotion", "financial-promise"),
    ]
    for item in multi:
        rows.extend([item] * 24)

    generic_neutral = [
        "Сегодня я купил хлеб и молоко в магазине.",
        "Мы оформили подписку на электронную библиотеку.",
        "Вечером я прочитал новую главу книги.",
        "Редактор проверил текст и исправил несколько опечаток.",
        "Стоимость подписки изменилась с нового месяца.",
        "Компания опубликовала финансовый отчёт за квартал.",
        "Доход организации вырос по сравнению с прошлым годом.",
        "Врач рассказал об истории развития медицины.",
        "Фильм содержит сцены насилия и рассчитан на взрослых.",
        "В новостях сообщили о расследовании преступления.",
        "Покупатель заказал обычный смартфон в интернет-магазине.",
        "Автор перечислил плюсы и минусы платной подписки.",
        "Мы обсуждали бюджет проекта и возможные расходы.",
        "Читатель оставил комментарий под статьёй.",
        "Студенты изучают правила оказания первой помощи.",
        "В тексте встретилось слово «убить», но это цитата из романа.",
        "Он купил акции и понимает, что их цена может снизиться.",
        "Она подписалась на музейную рассылку.",
        "В статье говорится о профилактике заболеваний.",
        "Исследование посвящено рекламе и поведению аудитории.",
        "Я хочу купить годовую подписку на образовательный сервис.",
        "Бесплатная подписка доступна студентам по условиям программы.",
        "Недорогая подписка не требует никаких дополнительных действий.",
        "Мы сравнили дешёвую и дорогую подписку на музыку.",
        "Слово «бесплатно» используется в описании тарифа.",
    ]
    add_variants(rows, generic_neutral, (),
                 ["Сегодня: ", "В заметке сказано: ", "Наблюдение: "],
                 [" — это обычное описание.", " без какого-либо призыва."])

    normalized: list[Example] = []
    for item in rows:
        labels = item.labels or frozenset({"neutral"})
        normalized.append(Example(item.text, labels))

    rng.shuffle(normalized)
    return normalized


SMOKE_CASES = [
    ex("Доход без риска гарантирован каждому, вложите деньги сегодня.", "financial-promise"),
    ex("Доход не гарантируется, можно потерять все вложенные деньги."),
    ex("Я тебя убью, если ещё раз сюда придёшь.", "aggression-violence"),
    ex("В романе герой произносит слова «я тебя убью», а автор осуждает его поступок."),
    ex("Продам оружие без документов, доставка сегодня.", "restricted-sale"),
    ex("Статья объясняет, почему оружие нельзя продавать без лицензии."),
    ex("Принимайте антибиотик без врача и увеличьте дозу вдвое.", "medical-advice"),
    ex("Не меняйте дозировку антибиотика без консультации врача."),
    ex("Подпишись, поставь лайк и сделай репост ради подарка.", "spam-promotion"),
    ex("Я отменил подписку, потому что сервис мне больше не нужен."),
    ex("Купить подписку на журнал можно в приложении."),
    ex("Бесплатная подписка доступна студентам и не требует покупки."),
    ex("Купи рецептурные таблетки без рецепта и принимай их сам.", "restricted-sale", "medical-advice"),
    ex("Подпишись и получи гарантированный доход без риска.", "spam-promotion", "financial-promise"),
]


def matrix(examples: list[Example]) -> tuple[np.ndarray, np.ndarray]:
    x = np.stack([features_for(item.text) for item in examples]).astype(np.float32)
    y = np.zeros((len(examples), len(LABELS)), dtype=np.int64)
    for row, item in enumerate(examples):
        for label in item.labels:
            y[row, LABELS.index(label)] = 1
    return x, y


def sigmoid(logits: np.ndarray) -> np.ndarray:
    logits = np.clip(logits, -40.0, 40.0)
    return 1.0 / (1.0 + np.exp(-logits))


def choose_threshold(y_true: np.ndarray, scores: np.ndarray, label: str) -> float:
    # Prefer precision: these results are shown as review signals and a noisy
    # classifier would quickly become unusable.
    best = None
    for threshold in np.arange(0.50, 0.951, 0.01):
        pred = scores >= threshold
        p, r, f, _ = precision_recall_fscore_support(
            y_true, pred, average="binary", zero_division=0
        )
        candidate = (p >= 0.90, f, r, p, -abs(threshold - 0.72), float(threshold))
        if best is None or candidate > best:
            best = candidate
    threshold = best[-1] if best else 0.72
    # Keep thresholds conservative for the first public prototype.
    if label != "neutral":
        threshold = min(0.90, max(0.62, threshold))
    else:
        threshold = 0.50
    return round(float(threshold), 2)


def train(examples: list[Example]):
    # Multilabel rows are stratified by their sorted label signature so the
    # mixed cases stay represented on both sides when possible.
    signatures = ["+".join(sorted(x.labels)) for x in examples]
    train_rows, valid_rows = train_test_split(
        examples,
        test_size=0.25,
        random_state=RANDOM_SEED,
        stratify=signatures,
    )
    x_train, y_train = matrix(train_rows)
    x_valid, y_valid = matrix(valid_rows)

    coefs = []
    intercepts = []
    valid_logits = np.zeros((len(valid_rows), len(LABELS)), dtype=np.float32)
    metrics = {}

    for col, label in enumerate(LABELS):
        clf = LogisticRegression(
            solver="liblinear",
            C=2.0,
            class_weight="balanced",
            max_iter=500,
            random_state=RANDOM_SEED,
        )
        clf.fit(x_train, y_train[:, col])
        coefs.append(clf.coef_[0].astype(np.float32))
        intercepts.append(np.float32(clf.intercept_[0]))
        valid_logits[:, col] = clf.decision_function(x_valid).astype(np.float32)

    valid_scores = sigmoid(valid_logits)
    thresholds = {}
    for col, label in enumerate(LABELS):
        threshold = choose_threshold(y_valid[:, col], valid_scores[:, col], label)
        thresholds[label] = threshold
        pred = valid_scores[:, col] >= threshold
        p, r, f, _ = precision_recall_fscore_support(
            y_valid[:, col], pred, average="binary", zero_division=0
        )
        metrics[label] = {
            "threshold": threshold,
            "precision": round(float(p), 4),
            "recall": round(float(r), 4),
            "f1": round(float(f), 4),
            "positives": int(y_valid[:, col].sum()),
        }

    weights = np.stack(coefs, axis=1).astype(np.float32)
    bias = np.asarray(intercepts, dtype=np.float32)
    return weights, bias, thresholds, metrics, train_rows, valid_rows


def make_onnx(weights: np.ndarray, bias: np.ndarray, path: Path) -> None:
    input_info = helper.make_tensor_value_info(
        "features", TensorProto.FLOAT, [None, FEATURE_COUNT]
    )
    output_info = helper.make_tensor_value_info(
        "logits", TensorProto.FLOAT, [None, len(LABELS)]
    )
    graph = helper.make_graph(
        [
            helper.make_node("MatMul", ["features", "weights"], ["linear"]),
            helper.make_node("Add", ["linear", "bias"], ["logits"]),
        ],
        "local_text_classifier",
        [input_info],
        [output_info],
        initializer=[
            numpy_helper.from_array(weights, name="weights"),
            numpy_helper.from_array(bias, name="bias"),
        ],
    )
    model = helper.make_model(
        graph,
        producer_name="dzen-text-starter-trainer",
        opset_imports=[helper.make_operatorsetid("", 13)],
    )
    # Android ONNX Runtime supports this conservative IR version.
    model.ir_version = 8
    onnx.checker.check_model(model)
    onnx.save(model, path)


def build_metadata(thresholds: dict[str, float]) -> dict:
    return {
        "schema": "local-text-classifier-v1",
        "name": "Стартовая локальная смысловая модель",
        "version": "1.0.0",
        "feature_kind": "char-ngram-hash-v1",
        "feature_count": FEATURE_COUNT,
        "ngram_min": NGRAM_MIN,
        "ngram_max": NGRAM_MAX,
        "activation": "sigmoid",
        "input_name": "features",
        "output_name": "logits",
        "labels": [
            {
                "id": label,
                **LABEL_META[label],
                "threshold": thresholds[label],
            }
            for label in LABELS
        ],
        "notes": "Синтетическая стартовая модель для локальных сигналов. Требует ручной проверки найденных фрагментов.",
    }


def evaluate_runtime(model_path: Path, metadata: dict, cases: list[Example]) -> dict:
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    x, _ = matrix(cases)
    logits = session.run(["logits"], {"features": x})[0]
    scores = sigmoid(logits)

    results = []
    exact = 0
    emitted_labels = [x["id"] for x in metadata["labels"] if x.get("emit", True)]
    thresholds = {x["id"]: float(x["threshold"]) for x in metadata["labels"]}
    for row, item in enumerate(cases):
        predicted = {
            label for col, label in enumerate(LABELS)
            if label in emitted_labels and scores[row, col] >= thresholds[label]
        }
        expected = {x for x in item.labels if x != "neutral"}
        if predicted == expected:
            exact += 1
        results.append({
            "text": item.text,
            "expected": sorted(expected),
            "predicted": sorted(predicted),
            "scores": {
                label: round(float(scores[row, LABELS.index(label)]), 4)
                for label in emitted_labels
            },
        })
    return {
        "cases": len(cases),
        "exact_matches": exact,
        "exact_match_rate": round(exact / max(1, len(cases)), 4),
        "results": results,
    }


def write_readme(path: Path) -> None:
    path.write_text(
        """Стартовая локальная смысловая модель v1

Содержимое:
- model.onnx — небольшой линейный ONNX-классификатор;
- metadata.json — категории, пороги и контракт входа/выхода;
- evaluation.json — воспроизводимый smoke-тест сборки.

Установка:
1. Откройте Настройки → Локальная смысловая модель.
2. Нажмите «Установить модель».
3. Выберите ZIP-пакет целиком.
4. После проверки приложение покажет название и версию модели.

Модель работает полностью на устройстве и не использует интернет.

Важно: это стартовая экспериментальная модель на синтетических русскоязычных
примерах. Её замечания являются сигналами для ручной проверки, а не выводом о
нарушении. На реальных текстах возможны ложные срабатывания и пропуски.
""",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="build/local-model")
    args = parser.parse_args()
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    examples = build_dataset()
    weights, bias, thresholds, validation, train_rows, valid_rows = train(examples)

    model_path = out / "model.onnx"
    make_onnx(weights, bias, model_path)
    metadata = build_metadata(thresholds)
    (out / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    smoke = evaluate_runtime(model_path, metadata, SMOKE_CASES)
    evaluation = {
        "training_examples": len(examples),
        "train_examples": len(train_rows),
        "validation_examples": len(valid_rows),
        "validation_metrics": validation,
        "smoke": smoke,
    }
    (out / "evaluation.json").write_text(
        json.dumps(evaluation, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_readme(out / "README.txt")

    # Fail CI if the model cannot distinguish the core positive/negative smoke
    # pairs well enough. This is deliberately stricter than "the file loads".
    if smoke["exact_match_rate"] < 0.78:
        print(json.dumps(evaluation, ensure_ascii=False, indent=2))
        raise SystemExit(
            f"Starter classifier smoke accuracy too low: {smoke['exact_match_rate']:.1%}"
        )

    package = out.parent / "local-text-classifier-starter-v1.zip"
    if package.exists():
        package.unlink()
    with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name in ["model.onnx", "metadata.json", "evaluation.json", "README.txt"]:
            zf.write(out / name, arcname=name)

    # Final verification from the package bytes, matching the Android install path.
    with zipfile.ZipFile(package, "r") as zf:
        assert "model.onnx" in zf.namelist()
        assert "metadata.json" in zf.namelist()
        package_meta = json.loads(zf.read("metadata.json").decode("utf-8"))
        assert package_meta["schema"] == "local-text-classifier-v1"
        assert len(package_meta["labels"]) == len(LABELS)

    print(f"Training examples: {len(examples)}")
    for label in LABELS:
        m = validation[label]
        print(
            f"{label}: threshold={m['threshold']:.2f} "
            f"precision={m['precision']:.3f} recall={m['recall']:.3f} f1={m['f1']:.3f}"
        )
    print(
        f"Smoke exact matches: {smoke['exact_matches']}/{smoke['cases']} "
        f"({smoke['exact_match_rate']:.1%})"
    )
    print(f"Model: {model_path} ({model_path.stat().st_size} bytes)")
    print(f"Package: {package} ({package.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
