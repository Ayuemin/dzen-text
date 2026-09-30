# Архитектура Dzen Text Online

> Версия архитектурного решения: 2026-09-30.

## 1. Целевая модель

Dzen Text Online — не редактор и не набор ручных wizard-экранов. Это автономный серверный pipeline.

```text
┌──────────────────────────────────────────────────────────────┐
│                    Панель управления                         │
│ theme / frequency / schedule / pause / status / failures     │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                   DZEN TEXT ONLINE VPS                       │
│                                                              │
│  Sources → Topics → Research → Write → Review → Media        │
│                                      ↓                       │
│                              Publication Gate                │
│                                      ↓                       │
│                         Schedule → Dzen Publisher             │
│                                      ↓                       │
│                         Analytics → Feedback                 │
└──────────────────────────────────────────────────────────────┘
```

Устройство пользователя ничего не исследует, не генерирует и не публикует. Оно только отправляет команды и отображает состояние сервера.

---

## 2. Архитектурные принципы

### 2.1. PostgreSQL — источник истины

Содержимое статьи, источники, статусы, расписание, результаты проверок и публикаций должны храниться в базе. Состояние браузера или конкретного worker не является источником истины.

### 2.2. Долгие операции — jobs

Research, генерация, медиа и публикация выполняются как восстановимые фоновые задачи с:

- persisted state;
- retry;
- timeout;
- idempotency;
- журналом ошибок;
- возможностью продолжить с последней успешной стадии.

### 2.3. Детерминированное раньше AI

То, что можно надёжно проверить кодом, не отправляется LLM без необходимости:

- длина;
- частотность;
- повторы;
- структура;
- пунктуационные паттерны;
- смешение кириллицы/латиницы;
- дубликаты;
- формальные правила документа.

AI используется для смысла, фактов, логики, стилистической правки и выбора между вариантами.

### 2.4. Внешние системы закрыты адаптерами

```text
ResearchProvider
SearchProvider
LlmProvider
ImageProvider
DzenPublisher
AnalyticsProvider
NotificationProvider
```

Ни одна бизнес-сущность не должна зависеть напрямую от URL OpenRouter, структуры Playwright-селектора или endpoint Дзена.

### 2.5. Публикация только через Quality Gate

Наступившее время публикации не является достаточным условием.

Если материал не прошёл критические проверки, он:

1. отправляется на автоматическую доработку;
2. после лимита попыток переводится в `ABANDONED`/`BLOCKED`;
3. слот может быть заполнен другим готовым материалом.

---

## 3. Основной production flow

### A. Сбор сигналов

```text
RSS / feeds
news aggregators
official sites
selected websites
search/trends
historical Dzen performance
        ↓
source_items
```

### B. Topic Engine

```text
source_items
   ↓
normalize
   ↓
embeddings
   ↓
cluster similar events
   ↓
remove semantic duplicates
   ↓
score against ChannelProfile
   ↓
topic_candidates
```

Пример факторов score:

- соответствие тематике канала;
- свежесть;
- число независимых источников;
- наличие достаточного материала для статьи;
- news/evergreen balance;
- насколько недавно похожая тема уже публиковалась;
- результаты похожих прошлых статей;
- разнообразие относительно текущего контент-плана.

### C. Planner

Planner поддерживает буфер готовых тем и статей на будущие слоты.

Например для `3 articles/day` целевой буфер может быть 1–2 суток. Конкретный размер делается настройкой.

### D. Research

Research run хранит не только итоговый текст отчёта, но и отдельные источники:

```text
ResearchSource
- url
- title
- publisher/domain
- fetched_at
- published_at (если известно)
- extracted_text
- claims/facts
- reliability metadata
```

Статья должна уметь сослаться обратно на факт и его источник.

### E. Outline + Writing

Черновик генерируется по секциям, а не одним гигантским prompt:

```text
research dossier
    ↓
outline
    ↓
section 1
section 2
...
conclusion
    ↓
assembled draft
```

Это позволяет перегенерировать плохую секцию без повторения всего research.

### F. Editorial pipeline

```text
Draft
  ↓
ZenText deterministic analysis
  ↓
Russian grammar/NLP
  ↓
AI structural/style editor
  ↓
claim/source verification
  ↓
Dzen-specific review
  ↓
Finalizer
```

Каждый шаг пишет отдельный `quality_report`, а не только меняет текст.

### G. Media

Media Engine получает уже стабильную структуру статьи и решает:

- нужна ли обложка;
- сколько внутренних изображений;
- для какого смыслового блока нужно изображение;
- использовать stock / Wikimedia / AI generation / собственную библиотеку;
- не является ли изображение визуальным дублем другого.

Для каждого файла сохраняются источник, лицензия/атрибуция (если применимо), hash и связь с блоком статьи.

### H. Publication Gate

Пример критических условий:

```text
article has content
research sources >= minimum
no unresolved critical fact issue
no critical Dzen policy issue
text checks passed
media requirements passed
semantic duplicate check passed
channel daily limits passed
Dzen session usable
```

После gate статья получает `READY`.

### I. Scheduler + Publisher

В назначенное время выбирается `READY` article для слота.

Приоритет publisher adapters:

```text
1. DzenDirectApiAdapter
       ↓ fail/unsupported
2. DzenBrowserAdapter
       ↓ fail
3. BLOCKED + notification
```

`DzenDirectApiAdapter` будет нашей реализацией протокола, а не зависимостью от конкретного чужого проекта.

`DzenBrowserAdapter` — резервный детерминированный browser flow.

### J. Analytics + feedback

После публикации создаются snapshots, например:

```text
+1h
+24h
+72h
+7d
```

Точные интервалы позже настраиваются.

Feedback не должен напрямую обучать модель без контроля. В первой версии он меняет вычисляемые веса Topic Engine:

- тип темы;
- тематический кластер;
- news vs evergreen;
- длина;
- формат заголовка;
- время публикации.

---

## 4. Основные сущности

### Channel

Канал Дзена и его техническое подключение.

### ChannelProfile

Политика автопилота:

```text
theme
allowed_topics
excluded_topics
articles_per_day
publish_times
timezone
content_mix
style_profile
target_length
image_policy
auto_publish
max_daily_ai_cost
quality_thresholds
```

### SourceItem

Одна новость/публикация/изменение во внешнем источнике.

### TopicCandidate

Кандидат, ещё не выбранный для производства.

### Topic

Тема, принятая Planner.

### ResearchRun / ResearchSource

Материалы исследования и доказательная база.

### Article

Текущая публикационная сущность.

### ArticleVersion

Версии после стадий writing/editing/finalize.

### ArticleImage

Медиа + источник + позиция + perceptual hash.

### QualityReport

Результат конкретного анализатора.

### PublicationJob

Попытка доставки статьи в конкретный канал.

### PublicationLog

Подробный технический журнал.

### PublicationMetric

Снимок метрик опубликованной статьи.

---

## 5. Предлагаемые таблицы PostgreSQL

```text
channels
channel_profiles
source_feeds
source_items
topic_candidates
topics
research_runs
research_sources
articles
article_versions
article_images
quality_reports
publication_slots
publication_jobs
publication_logs
publication_metrics
prompt_profiles
model_usage
system_settings
```

`pgvector` используется для embeddings тем/источников/статей, чтобы делать similarity и semantic dedup непосредственно в PostgreSQL.

---

## 6. Статусы

### TopicCandidate

```text
DISCOVERED
SCORED
REJECTED
ACCEPTED
```

### Article

```text
PLANNED
RESEARCHING
OUTLINING
WRITING
REVIEWING
MEDIA
READY
SCHEDULED
PUBLISHING
PUBLISHED
FAILED
ABANDONED
```

### PublicationJob

```text
QUEUED
RUNNING
RETRY
BLOCKED_AUTH
BLOCKED_CAPTCHA
PUBLISHED
FAILED
```

---

## 7. Сервисы первого варианта

```text
zentext-api
    FastAPI: control plane и UI API

zentext-worker
    Prefect workers + production flows

zentext-analysis-js
    извлечённые из нынешнего Android/WebView приложения
    детерминированные анализаторы ZenText

postgres
    данные + pgvector

prefect-server
    schedules / workflow state / retries / observability

languagetool
    отдельный grammar service

dzen-publisher
    direct API adapter + browser fallback

browser-runtime
    Chromium/Patchright + persistent profiles
    визуальный доступ только для re-auth/debug
```

Опционально отдельными контейнерами:

```text
miniflux
changedetection
crawl4ai server
litellm proxy
notification gateway
```

На MVP часть из них допустимо подключить как Python packages внутри worker, чтобы не плодить контейнеры без необходимости.

---

## 8. Оркестрация: два уровня

### Prefect — внешний workflow

Отвечает за:

- cron/schedules;
- retries;
- выполнение длинных flows;
- восстановление после ошибки;
- observability;
- production queue.

### LangGraph — только внутренние AI-процессы

Используется там, где действительно нужен agent state/branching:

```text
research planner
writer/editor retry loop
fact remediation loop
topic decision agent
```

Не использовать LangGraph вместо базы данных и общего scheduler.

---

## 9. DzenPublisher abstraction

```python
class DzenPublisher(Protocol):
    async def health(self, channel_id: str) -> PublisherCapabilities: ...
    async def create_draft(self, document: DzenDocument) -> DraftRef: ...
    async def publish(self, draft: DraftRef) -> PublicationRef: ...
```

`PublisherCapabilities` хранит независимые признаки:

```text
authenticated
create_draft
upload_image
save_content
publish
schedule_if_supported
analytics_if_supported
```

Это позволяет пережить частичное изменение Дзена.

### Direct API

По найденным актуальным реализациям внутренний редактор использует семейство `editor-api/v2` и Draft.js `contentState`. Этот протокол считается недокументированным и должен покрываться compatibility tests.

### Browser fallback

Browser adapter воспроизводит действия реального редактора и использует persistent profile. Он медленнее, но независим от части внутренних API контрактов.

---

## 10. Контрольная панель

Панель не является редактором статьи. Минимальный UI:

```text
AUTOPILOT: ON / PAUSED

Channel
Theme
Articles/day
Publish times
AI budget

Today
09:00  published
14:00  ready
19:00  researching

Pipeline
current topic / current stage / source count / warnings

Failures
reauth / captcha / exhausted retries

Actions
Pause
Resume
Publish priority topic
Change policy
Reconnect Dzen
```

Для первого прототипа достаточно простого server UI (например Gradio). Отдельный сложный frontend вводится только если панель действительно перерастёт возможности MVP UI.

---

## 11. Безопасность

- AI keys и Dzen session никогда не отдаются клиентскому браузеру.
- Secrets хранятся только на VPS.
- API панели закрывается authentication + HTTPS.
- Browser profiles монтируются как отдельный persistent volume.
- Логи не должны сохранять полные cookies/API keys.
- Publisher работает под отдельным Unix/container user.
- Backup PostgreSQL и media volume обязателен до включения постоянного автопилота.

---

## 12. Рекомендуемая физическая схема MVP

Один VPS + Docker Compose:

```text
reverse-proxy
    │
    ├── zentext-api/control-ui
    ├── prefect-server
    └── reauth-browser (restricted)

postgres + pgvector
redis (только если понадобится конкретному компоненту)
zentext-worker
zentext-analysis-js
languagetool
dzen-publisher
chromium profile volume
media volume
```

Kubernetes, микросервисная сетка и отдельный сервис на каждую функцию на первом этапе не нужны.

---

## 13. Главные риски

1. **Недокументированный Dzen editor API.** Снижается собственным adapter + browser fallback + compatibility checks.
2. **Авторизация/капча.** Persistent browser profile + ограничение частоты + ручной re-auth канал.
3. **Фактическая точность AI.** Источники как first-class entities + claim verification + quality gate.
4. **Повторяемость тем.** Embeddings + pgvector + history + BERTopic clusters.
5. **Авторские права на изображения.** MediaPolicy, allowlist источников и обязательное сохранение provenance.
6. **Цена AI.** Model routing через LiteLLM + per-day budget + дешёвые модели на простых стадиях.
7. **Плохой автономный контент.** Система должна уметь отказаться от материала (`ABANDONED`), а не обязательно публиковать его.
