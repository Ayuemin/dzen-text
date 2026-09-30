# План разработки Dzen Text Online

> Этот roadmap задаёт **порядок и критерии готовности**, а не календарные обещания.  
> Главный принцип: сначала доказать полностью автономный vertical slice, затем расширять источники и интеллект.

---

# Phase 0 — технические доказательства до большой сборки

Цель: снять главные неизвестные, которые способны сделать остальную архитектуру бессмысленной.

## 0.1. Dzen Browser Publisher spike

На тестовом канале проверить:

- persistent browser profile;
- повторное использование авторизации;
- создание статьи;
- заголовок;
- несколько текстовых блоков;
- H2;
- изображения внутри статьи;
- публикацию;
- получение финального URL;
- обнаружение истёкшей сессии;
- поведение при captcha.

Основа для эксперимента: MIT `sophiaelowyn/yandex-dzen-auto-publisher` + Playwright/Patchright.

**Gate:** одна подготовленная fixture-статья автоматически публикуется на тестовый канал несколько раз подряд без ручных действий между запусками.

## 0.2. Dzen Direct API protocol spike

Не копируя код проектов без лицензии, самостоятельно подтвердить наблюдаемый flow:

```text
csrf-token
→ add-publication
→ image upload
→ update content
→ publish
```

Проверить:

- динамическое получение `publisherId`;
- cookies/session requirements;
- CSRF;
- Draft.js schema;
- image blocks;
- preview/cover;
- save draft;
- publish;
- есть ли реально поддерживаемое delayed/server-side schedule.

**Gate:** если direct flow стабилен — делаем его primary adapter. Если нет — browser adapter остаётся primary, direct adapter считается experimental.

## 0.3. Analytics spike

Адаптировать `dzen-analytics-mini` в тестовом режиме и убедиться, что по опубликованному URL/каналу можно получать реальные public metrics.

**Gate:** publication связывается с snapshots просмотров/лайков/комментариев.

---

# Phase 1 — серверный фундамент

## 1.1. Новый online-контур в экспериментальной ветке

Предлагаемая структура:

```text
online/
├── api/                 # FastAPI control plane
├── domain/              # наши модели и policy
├── flows/               # Prefect flows
├── agents/              # LangGraph/LLM workflows
├── research/            # research adapters
├── topics/              # discovery/scoring/dedup
├── editorial/           # writer/editor/fact checks
├── media/               # image policy/providers
├── publisher/           # Dzen adapters
├── analytics/           # Dzen metrics + feedback
├── notifications/       # Apprise adapter
├── web/                 # минимальный control UI
├── tests/
└── deploy/
    └── docker-compose.yml
```

Текущий Android `app/` не меняем и не удаляем.

## 1.2. Базовые services

Поднять Docker Compose:

```text
postgres + pgvector
zentext-api
prefect-server
zentext-worker
zentext-analysis-js
languagetool
dzen-publisher/browser-runtime
```

## 1.3. База

Создать миграции для минимальных таблиц:

```text
channels
channel_profiles
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
model_usage
```

## 1.4. Control plane

Минимальные операции:

```text
GET/PUT channel profile
pause/resume autopilot
submit priority topic
list articles/status
list publication jobs
list failures
reconnect/check Dzen
```

**Gate Phase 1:** после `docker compose up` панель видит PostgreSQL, Prefect worker, analyzer, LanguageTool и publisher health.

---

# Phase 2 — доменная модель и надёжный job lifecycle

До подключения AI зафиксировать переходы состояний.

## 2.1. Article state machine

```text
PLANNED
→ RESEARCHING
→ OUTLINING
→ WRITING
→ REVIEWING
→ MEDIA
→ READY
→ SCHEDULED
→ PUBLISHING
→ PUBLISHED
```

Ошибка не должна терять уже выполненную работу.

## 2.2. Idempotency

Каждый stage должен понимать:

- был ли он уже успешно выполнен;
- можно ли повторить его безопасно;
- какие artefacts являются входом;
- какая version является результатом.

## 2.3. Retry policy

Разделить ошибки:

```text
TRANSIENT          → автоматический retry
CONTENT_REJECTED   → editorial remediation
AUTH_REQUIRED      → BLOCKED_AUTH + notification
CAPTCHA_REQUIRED   → controlled browser fallback / notification
UNSUPPORTED_DZEN   → compatibility alert
FATAL_CONFIG       → stop affected channel
```

**Gate:** искусственно падающий pipeline продолжает работу с последней сохранённой стадии, а не начинает статью с нуля.

---

# Phase 3 — первый автономный vertical slice: тема задаётся человеком

Это первый действительно полезный продукт.

Вход:

```text
topic = «... »
channel_profile = ...
auto_publish = true
```

Дальше всё автоматически.

## 3.1. Research

Подключить:

```text
Crawl4AI
GPT Researcher
LiteLLM
```

Сохранять sources как отдельные записи, а не только итоговый AI-report.

## 3.2. Outline

Из research dossier получить структурированный outline.

## 3.3. Writing

Генерировать статью секциями.

Сохранять:

```text
research version
outline version
draft section versions
assembled draft
```

## 3.4. Existing ZenText checks

Из нынешнего Android/WebView проекта выделить pure JS анализаторы в `zentext-analysis-js`.

На первом этапе **не переписывать их на Python**.

API сервиса условно:

```text
POST /analyze
{ text, rules/profile }

→ issues[]
```

## 3.5. LanguageTool + Natasha

Добавить grammar/NLP signals.

## 3.6. AI editor

AI получает не абстрактную команду «улучши текст», а конкретные:

```text
draft
research claims
sources
deterministic issues
grammar issues
style profile
```

После rewrite проверки запускаются повторно.

## 3.7. Media

Минимум:

- cover;
- N section images;
- provenance;
- duplicate hash;
- relation to article block.

На MVP достаточно Pexels/Wikimedia/одного AI image provider.

## 3.8. Publish

PublicationGate → DzenPublisher → final URL.

**Gate Phase 3 — ключевой:** одна команда с темой приводит к опубликованной статье с изображениями и сохранённым URL **без промежуточных действий пользователя**.

Если этот gate не достигнут, к автоматическому поиску тем не переходим.

---

# Phase 4 — Dzen resilience layer

После vertical slice превратить publisher из прототипа в заменяемый subsystem.

## 4.1. Реализовать interface

```text
DzenPublisher
DzenDirectApiAdapter
DzenBrowserAdapter
```

## 4.2. Capabilities health

Проверять независимо:

```text
auth
create draft
save content
image upload
publish
schedule (если существует)
analytics
```

## 4.3. Compatibility fixtures

Хранить набор fixture articles:

```text
plain paragraphs
H2
lists
blockquote
links
bold/italic if supported
1 image
multiple images
long article
```

После обновления publisher прогонять dry/controlled tests.

## 4.4. Remote re-auth

Добавить restricted visible-browser flow через noVNC/аналог только для ручной авторизации.

**Gate:** изменение/ошибка direct API не останавливает фабрику, пока browser fallback остаётся рабочим.

---

# Phase 5 — автоматический Topic Hunter

Теперь убираем обязательный ввод темы человеком.

## 5.1. Feed ingestion

Подключить curated feeds через Miniflux или прямые adapters.

Сохранять `source_items`.

## 5.2. Full article extraction

Для перспективных source items использовать Crawl4AI.

## 5.3. Embeddings

`sentence-transformers` → `pgvector`.

## 5.4. Semantic dedup

Не создавать новую тему, если похожая:

- уже опубликована недавно;
- уже находится в production pipeline;
- уже стоит в плане.

## 5.5. Topic clusters

BERTopic группирует поток вокруг событий/тем.

## 5.6. Topic scoring

Наша первая формула:

```text
score =
  relevance_to_channel
+ freshness
+ source_diversity
+ trend_strength
+ researchability
+ historical_cluster_performance
- recent_duplicate
- plan_saturation
- excluded_topic_penalty
```

Весовые коэффициенты настраиваются в `ChannelProfile`/`TopicPolicy`.

**Gate:** сервер способен из потока источников предложить/выбрать разные темы без повторов и без выхода за заданную тематику.

---

# Phase 6 — Planner и недельный/непрерывный автопилот

## 6.1. Publication slots

Из `articles_per_day + publish_times + timezone` создаются будущие slots.

## 6.2. Production buffer

Planner поддерживает запас готовых материалов заранее, а не начинает писать ровно в момент публикации.

## 6.3. Content mix

Например:

```text
MIXED:
09:00 evergreen
14:00 trend/news
19:00 evergreen_or_best_candidate
```

Это policy, а не жёсткое правило.

## 6.4. Dynamic replacement

Если появился сильный свежий topic candidate, planner может заменить ещё не опубликованный слабый слот по понятным правилам.

## 6.5. Slot fallback

Если статья к слоту не прошла Quality Gate:

```text
choose another READY article
```

а не публиковать плохой материал.

**Gate Phase 6:** пользователь задаёт тематику и количество статей/день, после чего фабрика автономно поддерживает расписание несколько последовательных циклов.

---

# Phase 7 — Analytics и замкнутый feedback loop

## 7.1. Metrics collector

Адаптировать MIT `dzen-analytics-mini`:

```text
publication
→ snapshots
→ publication_metrics
```

## 7.2. Derived metrics

Считать сравнительные показатели внутри канала, а не использовать только абсолютные просмотры.

Примеры:

```text
views_at_24h
engagement_rate
relative_performance_vs_channel_baseline
cluster_performance
publish_time_performance
```

## 7.3. FeedbackPolicy v1

Без автоматического fine-tuning.

Метрики корректируют:

- веса topic clusters;
- долю news/evergreen;
- preferred publish times;
- diversity policy.

## 7.4. Защита от переобучения

Не делать вывод по одной статье; использовать minimum sample size и decay старых результатов.

**Gate:** результат опубликованных статей измеримо влияет на последующий topic ranking и отображается в журнале решения.

---

# Phase 8 — стоимость, наблюдаемость и безопасность

## 8.1. AI cost budget

Через LiteLLM/model_usage:

```text
max cost/day
max cost/article
provider fallback
role-based models
```

## 8.2. Observability

Для каждой статьи видеть:

```text
stage durations
LLM calls/tokens/cost
sources count
retries
quality issues
publisher attempts
final URL
```

## 8.3. Notifications

Apprise:

```text
AUTH_REQUIRED
PUBLISH_FAILED
pipeline repeatedly failed
daily budget exhausted
compatibility check broken
```

Успешные публикации можно уведомлять агрегированно, чтобы не создавать шум.

## 8.4. Security

- HTTPS;
- admin authentication;
- secrets только server-side;
- masked logs;
- DB backups;
- media backups;
- isolated browser profile volumes;
- publisher process/container isolation.

---

# Phase 9 — расширение после доказанной стабильности

Только после устойчивой статьи/день pipeline:

- несколько каналов;
- отдельные ChannelProfile/voices;
- более сложный content calendar;
- additional sources;
- changedetection for official pages;
- STORM as alternate research/outline engine;
- Ragas/custom eval experiments;
- automatic cover styles;
- posts/video/reels;
- другие publishing platforms;
- более удобная custom web-panel вместо Gradio, если она действительно понадобится.

---

# Порядок реализации в одном списке

1. Проверить browser publication.
2. Проверить direct Dzen API самостоятельно.
3. Проверить Dzen metrics.
4. Поднять server foundation.
5. Зафиксировать domain/state/retries.
6. Сделать `manual topic → research → article → review → media → publish`.
7. Сделать Dzen adapters + compatibility layer.
8. Вынести нынешние ZenText analyzers на сервер.
9. Подключить source ingestion.
10. Добавить embeddings/dedup/BERTopic.
11. Написать TopicScore.
12. Добавить Planner + schedules + buffer.
13. Включить autonomous topic selection.
14. Подключить analytics feedback.
15. Hardening/cost/security/backup.
16. Только затем масштабировать источники, каналы и форматы.

---

# Definition of Done для первого серьёзного релиза Dzen Text Online

Пользователь один раз задаёт:

```text
Тематика: ...
Не писать: ...
Статей в день: 3
Время: 09:00, 14:00, 19:00
Стиль: ...
Автопубликация: ON
```

После этого система способна автономно:

1. находить темы;
2. не повторять недавно опубликованные темы;
3. собирать несколько источников;
4. писать статью;
5. исправлять собственные обнаруженные ошибки;
6. отбрасывать статью, если она не проходит quality gate;
7. подбирать изображения с provenance;
8. поддерживать очередь готовых материалов;
9. публиковать по расписанию;
10. переживать временные ошибки через retry/fallback;
11. уведомлять только при необходимости вмешательства;
12. собирать метрики публикаций;
13. учитывать предыдущие результаты при выборе следующих тем;
14. сохранять полную историю того, почему тема и материал были выбраны/отклонены.

Это и есть целевой **автопилот Dzen Text Online**.
