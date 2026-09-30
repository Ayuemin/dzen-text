# GitHub-кирпичики для Dzen Text Online

> Снимок исследования: **2026-09-30**.  
> Цель таблицы — не собрать максимальное число зависимостей, а найти максимум готовой работы и затем выбрать минимальный устойчивый набор.

## Условные обозначения

- **ADOPT** — хороший кандидат на непосредственное использование.
- **SERVICE** — лучше запускать отдельным сервисом/контейнером.
- **ADAPT** — можно брать код/библиотеку и писать наш адаптер.
- **REFERENCE** — изучать реализацию, но не копировать код без дополнительного разрешения/лицензионного решения.
- **OPTIONAL** — полезно позже, не нужно для первого вертикального прототипа.

Лицензионный принцип проекта: ядро предпочтительно строить из MIT / Apache-2.0 / BSD / PostgreSQL-license компонентов. LGPL допустим через отдельную сервисную границу. GPL/AGPL и проекты без лицензии не копируем в core без отдельного решения.

---

# 1. Оркестрация и автономный workflow

| Что нужно | Готовый проект | Что уже есть | Лицензия | Решение | Что остаётся нам |
|---|---|---|---|---|---|
| Production workflow, schedules, retries, monitoring | [PrefectHQ/prefect](https://github.com/PrefectHQ/prefect) | flows/tasks, cron, retries, caching, event automation, self-hosted server/UI | Apache-2.0 | **ADOPT** | Описать наши flows/states и product-level DB model |
| Stateful AI subgraphs | [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | durable state, branching, memory, interrupts, long-running agents | MIT | **ADOPT** точечно | Наши research/editor/fact-remediation graphs |
| Классическая task queue | [celery/celery](https://github.com/celery/celery) | mature workers/retries/queues | BSD-3-Clause | OPTIONAL fallback | Не нужен одновременно с Prefect на MVP |
| Только scheduler | [agronholm/apscheduler](https://github.com/agronholm/apscheduler) | cron/date/interval jobs | MIT | OPTIONAL fallback | Не нужен при Prefect |
| Visual workflow platform | [activepieces/activepieces](https://github.com/activepieces/activepieces) | self-hosted workflow builder/integrations | core MIT, EE отдельно | REFERENCE/OPTIONAL | Prefect лучше соответствует Python-first архитектуре |
| Контент-календарь/social scheduler как образец | [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app) | calendar, queues, providers, analytics, API | AGPL-3.0 | **REFERENCE** | Не копировать core без принятия AGPL |

**Выбор сейчас:** Prefect снаружи, LangGraph только внутри действительно агентных стадий.

---

# 2. Backend, база и панель автопилота

| Что нужно | Проект | Готовое | Лицензия | Решение | Наш код |
|---|---|---|---|---|---|
| API + Postgres + auth + Docker foundation | [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) | FastAPI, SQLModel, PostgreSQL, JWT, tests, Docker Compose, CI | MIT | **ADAPT** | Удалить demo-domain/frontend, добавить ZenText domain |
| Auth, если понадобится несколько пользователей | [fastapi-users/fastapi-users](https://github.com/fastapi-users/fastapi-users) | registration/auth/reset/OAuth adapters | MIT | OPTIONAL | На личном MVP достаточно одного admin account |
| Быстрая серверная control-panel | [gradio-app/gradio](https://github.com/gradio-app/gradio) | Python UI, forms, status, streaming | Apache-2.0 | **ADOPT MVP** | Наш dashboard/настройки, позже заменить при необходимости |
| Основная БД | PostgreSQL | transactions, constraints, JSONB, FTS | PostgreSQL License | **ADOPT** | Схема Dzen Text Online |
| Semantic similarity в той же БД | [pgvector/pgvector](https://github.com/pgvector/pgvector) | exact/ANN vector search, cosine/L2/etc | PostgreSQL-style permissive | **ADOPT** | Индексы/embeddings policy |

**Выбор сейчас:** FastAPI + PostgreSQL/pgvector; Gradio как максимально быстрый пульт управления, без строительства большого frontend.

---

# 3. Источники, новости и обнаружение тем

| Что нужно | Проект | Готовое | Лицензия | Решение | Наш код |
|---|---|---|---|---|---|
| RSS/Atom/JSON Feed ingestion | [miniflux/v2](https://github.com/miniflux/v2) | background feed updates, content extraction, filters, webhooks, REST API, Postgres | Apache-2.0 | **SERVICE** | Список тематических feeds + adapter в source_items |
| Минимальный feed parser | [kurtmckee/feedparser](https://github.com/kurtmckee/feedparser) | RSS/Atom parsing | BSD-like | ADOPT fallback | Наш polling/cache при отказе от Miniflux |
| Hot-news aggregation / готовые source adapters | [newsnext/newsnow](https://github.com/newsnext/newsnow) | realtime/hottest news, множество source adapters, Docker | MIT | **ADAPT/OPTIONAL** | Нужны источники, релевантные нашим темам/языку |
| Мониторинг изменений важных страниц | [dgtlmoon/changedetection.io](https://github.com/dgtlmoon/changedetection.io) | scheduled watches, Playwright fetch, selectors, webhooks, generated RSS | Apache-2.0 | **SERVICE OPTIONAL** | Список официальных страниц и rules |
| Универсальная генерация RSS | [DIYgod/RSSHub](https://github.com/DIYgod/RSSHub) | огромное число routes | AGPL-3.0 | SERVICE/REFERENCE | Можно запускать отдельно unmodified; не копировать core |
| Trend radar concept | [sansan0/TrendRadar](https://github.com/sansan0/TrendRadar) | aggregation, ranking, AI filtering/notifications | GPL-3.0 | REFERENCE | Использовать идеи scoring, не код в core |

Для первой версии Topic Hunter достаточно: **Miniflux + curated feeds + Crawl4AI/search + собственный Topic Engine**. NewsNow и changedetection добавляются как дополнительные сигналы.

---

# 4. Crawling, extraction и research

| Что нужно | Проект | Готовое | Лицензия | Решение | Наш код |
|---|---|---|---|---|---|
| Web → clean Markdown / extraction | [unclecode/crawl4ai](https://github.com/unclecode/crawl4ai) | async crawler, JS pages, deep/adaptive crawl, structured extraction, persistent sessions, Docker/REST/MCP | Apache-2.0 | **ADOPT** | Safe fetch policy, domains, cache, provenance |
| Deep research | [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | planner/execution agents, 20+ sources, citations, long reports, web/local research, image scraping | Apache-2.0 | **ADOPT primary** | Output schema `ResearchRun/ResearchSource`, Russian prompts, source policy |
| Research → outline → long article | [stanford-oval/storm](https://github.com/stanford-oval/storm) | multi-perspective research, outline, article generation, polish, modular retrievers | MIT | **ADAPT/OPTIONAL** | A/B against GPT Researcher; likely use outline logic or as alternate engine |

**Выбор сейчас:** Crawl4AI for extraction + GPT Researcher for deep research. STORM держим как второй research/outline provider.

---

# 5. Topic intelligence, разнообразие и дедупликация

| Что нужно | Проект | Готовое | Лицензия | Решение | Наш код |
|---|---|---|---|---|---|
| Embeddings | [huggingface/sentence-transformers](https://github.com/huggingface/sentence-transformers) | multilingual sentence/document embeddings | Apache-2.0 | **ADOPT** | Выбор multilingual model и batching |
| Topic clustering | [MaartenGr/BERTopic](https://github.com/MaartenGr/BERTopic) | multilingual, dynamic, online topic modeling, topic representations | MIT | **ADOPT** | Превратить clusters в candidate topics и trend score |
| Semantic history | [pgvector/pgvector](https://github.com/pgvector/pgvector) | nearest-neighbor search | permissive | **ADOPT** | Duplicate thresholds и recency policy |

**Наша ключевая логика:** `TopicScore = relevance + freshness + source_diversity + trend + history_performance - semantic_duplicate_penalty - saturation_penalty`.

Готовая библиотека не знает, что является хорошей темой именно для нашего канала, поэтому final scoring остаётся нашим продуктовым кодом.

---

# 6. LLM routing и стоимость

| Что нужно | Проект | Готовое | Лицензия | Решение | Наш код |
|---|---|---|---|---|---|
| Один API для десятков моделей | [BerriAI/litellm](https://github.com/BerriAI/litellm) | OpenAI-compatible gateway, 100+ providers, routing, spend tracking, fallbacks | core MIT, enterprise отдельно | **ADOPT** | Roles→models, budgets, fallback policy |

Пример policy:

```text
cheap/fast model   → classification, extraction, simple rewrite
strong model       → outline, final writing, difficult editorial decisions
research model     → source-grounded research
vision model       → image validation when needed
```

Ключи внешних providers остаются только на VPS.

---

# 7. Написание и редактура

| Что нужно | Источник | Готовое | Лицензия | Решение | Наш код |
|---|---|---|---|---|---|
| Детерминированный ZenText analyzer | **наш текущий dzen-text** | повторы, структура, частотность, длина, Markdown, punctuation/spacing, duplicated words, mixed scripts, Dzen heuristics и др. | наш код | **REUSE** | Выделить pure JS из UI и запустить server-side |
| Русский NLP | [natasha/natasha](https://github.com/natasha/natasha) | token/sentence segmentation, morphology, lemmatization, syntax, NER, facts | MIT | **ADOPT** | Additional editorial metrics/rules |
| Grammar/style server | [languagetool-org/languagetool](https://github.com/languagetool-org/languagetool) | HTTP server, Russian among supported languages, grammar beyond spellcheck | LGPL-2.1+ core | **SERVICE** | Adapter + ignored rules/profile |
| AI/RAG evaluations | [vibrantlabsai/ragas](https://github.com/vibrantlabsai/ragas) | custom LLM metrics, RAG evaluations, feedback loops | Apache-2.0 | OPTIONAL | Quality experiments; не делать gate зависимым только от LLM score |

**Ключевое решение:** текущие анализаторы ZenText — уже готовый наш кирпич. На первом этапе их лучше вынести в небольшой Node service/package, а не переписывать сразу на Python.

---

# 8. Изображения и media pipeline

| Что нужно | Проект/источник | Готовое | Лицензия | Решение | Наш код |
|---|---|---|---|---|---|
| Stock photos | Pexels API | official search/download API | terms API | **ADOPT via HTTP** | Query builder, provenance, source/author metadata |
| Open media | Wikimedia Commons API | public media + metadata | per-file licenses | **ADOPT via HTTP** | License allowlist/attribution handling |
| AI image generation on GPU/self-host | [huggingface/diffusers](https://github.com/huggingface/diffusers) | many diffusion pipelines | Apache-2.0 library; model licenses vary | OPTIONAL | На обычном VPS лучше cloud providers |
| Perceptual image duplicate detection | [JohannesBuchner/imagehash](https://github.com/JohannesBuchner/imagehash) | pHash/dHash/aHash/etc | BSD-style | **ADOPT** | Thresholds + article/history lookup |
| Image discovery inside research | GPT Researcher | smart image scraping/filtering | Apache-2.0 | ADAPT | Нельзя автоматически считать найденную картинку legal-to-publish |

**Самописная обязательная часть — `MediaPolicy`:** допустимые источники, provenance, лицензия, visual relevance, duplicates, image count and placement.

---

# 9. Dzen publisher — наиболее специфичная часть

## 9.1. `kalininlive/dzen-factory`

Repository: https://github.com/kalininlive/dzen-factory

Что полезно:

- FastAPI Publisher Service;
- Patchright/browser automation;
- cookies/session checks;
- multi-account model;
- article/post/video flow;
- `[DZEN_IMAGE]` placement idea;
- DB entities `accounts/topics/articles/publish_log/images/settings`;
- health endpoint and daily limits.

Лицензия: README заявляет **MIT**, но на момент исследования отдельный `LICENSE` в репозитории не найден.

Решение: **REFERENCE / ADAPT CONCEPT**. До буквального переноса крупных кусков кода лучше получить нормальный LICENSE/подтверждение. Концепцию и API boundaries используем свободно как архитектурный ориентир.

## 9.2. `sophiaelowyn/yandex-dzen-auto-publisher`

Repository: https://github.com/sophiaelowyn/yandex-dzen-auto-publisher

Что готово:

- Python + Playwright/CDP;
- актуальный на август 2026 browser flow;
- `article.html + meta.json + photo-N`;
- вставка блоков и картинок;
- CAPTCHA detection/fallback;
- multi-channel editor URL;
- MIT LICENSE в репозитории.

Решение: **ADAPT** как основа `DzenBrowserAdapter`.

Примечание: поле `schedule` присутствует в формате, но изученный основной скрипт фактически выполняет обычный publish; серверное расписание Dzen Text Online всё равно должно быть нашим outer scheduler.

## 9.3. `nws98123-prog/dzen-autopublisher`

Repository: https://github.com/nws98123-prog/dzen-autopublisher

Что полезно:

- Selenium + direct HTTP approach;
- editor API experimentation;
- local web UI.

На момент проверки LICENSE отсутствует.

Решение: **REFERENCE ONLY**.

## 9.4. `Andrrreyiv/dzen-publish`

Repository: https://github.com/Andrrreyiv/dzen-publish

Полезен как компактное описание реальных quirks текущего Draft.js editor и порядка заполнения через CDP.

Решение: **REFERENCE** до отдельной проверки лицензии.

## 9.5. `vetalione/content_pipeline` — очень важный reference

Repository: https://github.com/vetalione/content_pipeline

Это наиболее близкий найденный проект к нашей конечной концепции:

- AI research;
- автоматический article pipeline;
- images/covers;
- PostgreSQL + Redis/BullMQ;
- autopilot;
- Dzen + другие publishers;
- **прямая реализация внутреннего Dzen HTTP API**.

В `packages/api/src/services/publishers/dzen-api.ts` на момент исследования описан flow:

```text
GET  /media-api/csrf-token
POST /editor-api/v2/add-publication
POST /editor-api/v2/add-image... / add-image-from-url
POST /editor-api/v2/update-publication-content-and-publish
```

Контент передаётся как Draft.js `contentState` с блоками `header-two`, `unstyled`, `blockquote`, `atomic:image`.

**Но LICENSE в репозитории не найден.** Поэтому это крайне ценный источник знаний о текущем протоколе, но **не источник кода для копирования**.

Решение: **REFERENCE ONLY**; написать свой `DzenDirectApiAdapter` и подтвердить протокол тестами.

## 9.6. Browser engines

| Проект | Роль | Лицензия | Решение |
|---|---|---|---|
| [microsoft/playwright](https://github.com/microsoft/playwright) | стандартная browser automation | Apache-2.0 | ADOPT |
| [Kaliiiiiiiiii-Vinyzu/patchright-python](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python) | Playwright-compatible hardened browser automation | Apache-2.0 | ADOPT/experiment |
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | AI browser agent | MIT | OPTIONAL emergency/general browser agent |
| [SeleniumHQ/docker-selenium](https://github.com/SeleniumHQ/docker-selenium) | browser container + integrated noVNC | Apache-2.0 | OPTIONAL for visible remote auth/debug |
| [novnc/noVNC](https://github.com/novnc/noVNC) | browser-accessible VNC client | MPL-2.0 core | OPTIONAL |

**Правильная собственная абстракция:**

```text
DzenPublisher
 ├── DzenDirectApiAdapter      ← основной после подтверждения
 └── DzenBrowserAdapter        ← надёжный fallback
```

---

# 10. Аналитика и feedback loop

| Что нужно | Проект | Готовое | Лицензия | Решение | Наш код |
|---|---|---|---|---|---|
| Публичные Dzen metrics | [samsebeingener/dzen-analytics-mini](https://github.com/samsebeingener/dzen-analytics-mini) | subscribers, publications, views, likes, comments, metric snapshots; без auth/cookies | MIT | **ADAPT** | PostgreSQL adapter + scheduled snapshots + map to our publication IDs |

Это один из самых ценных готовых кирпичей: он позволяет строить feedback loop без зависимости от приватного editor API.

Первый feedback не должен «самообучать LLM». Он меняет веса выбора:

```text
topic cluster
article type
publish time
headline pattern
news/evergreen mix
```

---

# 11. Уведомления

| Что нужно | Проект | Готовое | Лицензия | Решение |
|---|---|---|---|---|
| Один API → Telegram/email/Discord/ntfy/etc | [caronc/apprise](https://github.com/caronc/apprise) | огромное число notification backends | BSD-2-Clause | **ADOPT** |
| Свой простой push/pub-sub | [binwiederhier/ntfy](https://github.com/binwiederhier/ntfy) | HTTP push + Android/Desktop clients + self-host | Apache-2.0 | OPTIONAL SERVICE |

Для MVP Apprise достаточно. Уведомления нужны прежде всего для `BLOCKED_AUTH`, exhausted retries и publish failures.

---

# 12. Что точно не надо писать с нуля

После разведки нет смысла самостоятельно создавать:

- cron/scheduler engine;
- generic retry/task monitor;
- vector DB;
- RSS reader;
- generic crawler;
- deep-research engine с нуля;
- provider-specific clients для десятков LLM;
- Russian tokenizer/morphology/NER;
- grammar checker;
- browser automation framework;
- push notification framework;
- базовый Dzen metrics scraper;
- все старые ZenText text checks заново.

---

# 13. Что остаётся нашим собственным кодом

Это наиболее важный итог таблицы.

| Наш компонент | Почему нельзя просто взять готовый |
|---|---|
| `ChannelProfile` | Это политика конкретной фабрики/канала |
| `TopicScore` и diversity policy | Общая topic modeling библиотека не знает бизнес-цель канала |
| `ContentPlanner` | Нужно связать частоту, backlog, news/evergreen и готовность статей |
| Research normalization | Разные research engines надо свести к нашей доказательной модели |
| Writer prompts / section workflow | Это качество и «голос» Dzen Text |
| `ZenTextChecks` integration | Наш существующий анализ надо отделить от WebView UI |
| Editorial remediation loop | Какие ошибки исправлять и сколько раз |
| `PublicationGate` | Наши пороги и критические условия |
| `MediaPolicy` | Источники, лицензии, relevancy, placement, duplicates |
| `DzenDocumentBuilder` | Наша нейтральная article model → Draft.js/browser format |
| `DzenDirectApiAdapter` | Нужна наша чистая реализация недокументированного протокола |
| Dzen compatibility tests | Внешний API может измениться в любой момент |
| `FeedbackPolicy` | Как реальные метрики меняют будущий topic score |
| Integration tests | Главный риск находится на стыках всех готовых кирпичей |

---

# 14. Рекомендуемый минимальный набор зависимостей для первого прототипа

Чтобы «максимум GitHub» не превратился в dependency zoo, первый вертикальный прототип строим только на:

```text
FastAPI
PostgreSQL + pgvector
Prefect
LiteLLM
Crawl4AI
GPT Researcher
sentence-transformers
current ZenText JS analyzers
LanguageTool
Natasha
ImageHash
Playwright/Patchright
MIT Dzen browser publisher code as reference/adaptation
dzen-analytics-mini
Apprise
```

Добавляем после доказательства vertical slice:

```text
Miniflux
BERTopic
changedetection.io
STORM
Ragas
NewsNow
AI image generators
```

Так мы переиспользуем много готового кода, но сохраняем контролируемую сложность системы.
