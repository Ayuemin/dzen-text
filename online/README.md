# Dzen Text Online — implementation root

Эта директория зарезервирована под новую серверную систему. Она **не заменяет** существующий Android `app/` и не должна влиять на его сборку.

До завершения технических spikes здесь намеренно нет production-кода и чужих скопированных компонентов.

Планируемая структура:

```text
online/
├── api/                 # FastAPI control plane
├── domain/              # ChannelProfile, Topic, Article, Publication...
├── flows/               # Prefect production/scheduling flows
├── agents/              # stateful AI subflows (LangGraph where useful)
├── sources/             # feed/search/change adapters
├── topics/              # embeddings, clusters, scoring, dedup
├── research/            # Crawl4AI / GPT Researcher adapters
├── editorial/           # writer/editor/fact/Dzen policy pipeline
├── analysis-js/         # existing ZenText deterministic analyzers
├── media/               # image providers, provenance, duplicate checks
├── publisher/           # DzenDirectApiAdapter + DzenBrowserAdapter
├── analytics/           # Dzen metrics and feedback
├── notifications/       # Apprise adapter
├── web/                 # thin autopilot control/monitor UI
├── tests/
├── config/
│   └── autopilot.example.yaml
└── deploy/
    └── docker-compose.yml
```

Архитектурные документы находятся в [`../docs/online/`](../docs/online/README.md).

## Первый исполняемый milestone

Не «пустой сайт», а автономный вертикальный сценарий:

```text
manual topic
→ research
→ outline
→ article
→ ZenText checks
→ editorial remediation
→ images
→ publication gate
→ Dzen publish
→ publication URL
```

После доказательства этого сценария добавляются автоматический Topic Hunter, Planner, schedules и feedback loop.
