#!/usr/bin/env python3
"""Build a compact offline Dzen risk database from the official Dzen rules.

Privacy boundary: this script only sends the text downloaded from the official
Dzen help page to OpenRouter. It has no input path for user articles and is
intended to run only inside GitHub Actions.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

SOURCE_URL = os.getenv("DZEN_RULES_SOURCE_URL", "https://dzen.ru/help/ru/requirements/rules.html")
PRIMARY_MODEL = os.getenv("DZEN_RULES_MODEL", "openai/gpt-oss-20b:free")
FALLBACK_MODEL = "openrouter/free"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
RULES_PATH = Path("rules/dzen-rules.json")
FORCE = os.getenv("FORCE_REBUILD", "").lower() in {"1", "true", "yes"}
PROMPT_VERSION = 2


class TextExtractor(HTMLParser):
    BLOCKS = {"p", "div", "section", "article", "main", "header", "footer", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "br", "tr", "td"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip += 1
        elif not self.skip and tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"} and self.skip:
            self.skip -= 1
        elif not self.skip and tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def fetch_official_text(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; DzenTextRulesUpdater/1.0; +https://github.com/Ayuemin/dzen-text)",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "ru-RU,ru;q=0.9",
            "Cache-Control": "no-cache",
        },
    )
    with urllib.request.urlopen(req, timeout=40) as resp:
        raw = resp.read(3_000_000)
        charset = resp.headers.get_content_charset() or "utf-8"
    source = raw.decode(charset, errors="replace")
    parser = TextExtractor()
    parser.feed(source)
    text = html.unescape("".join(parser.parts)).replace("\xa0", " ")
    lines = []
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if line and (not lines or line != lines[-1]):
            lines.append(line)
    clean = "\n".join(lines)
    # Fail closed: never replace a good local database with an error/login page.
    low = clean.lower()
    if len(clean) < 2500 or "дзен" not in low or not any(x in low for x in ("контент", "публикац", "правил", "требован")):
        raise RuntimeError(f"Official page extraction looks incomplete ({len(clean)} chars)")
    return clean


def response_schema() -> dict:
    string_list = {"type": "array", "items": {"type": "string"}, "maxItems": 40}
    category = {
        "type": "object",
        "additionalProperties": False,
        "required": ["id", "title", "severity", "scope", "phrases", "stems", "action_words", "context_words", "exclude_words", "min_score", "explanation"],
        "properties": {
            "id": {"type": "string", "minLength": 2, "maxLength": 48},
            "title": {"type": "string", "minLength": 3, "maxLength": 120},
            "severity": {"type": "string", "enum": ["critical", "warning", "info"]},
            "scope": {"type": "string", "enum": ["title", "body", "all"]},
            "phrases": string_list,
            "stems": string_list,
            "action_words": string_list,
            "context_words": string_list,
            "exclude_words": string_list,
            "min_score": {"type": "integer", "minimum": 1, "maximum": 5},
            "explanation": {"type": "string", "minLength": 5, "maxLength": 300},
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["article_title_max_chars", "categories", "manual_checks"],
        "properties": {
            "article_title_max_chars": {"type": "integer", "minimum": 0, "maximum": 300},
            "categories": {"type": "array", "items": category, "minItems": 3, "maxItems": 60},
            "manual_checks": {"type": "array", "items": {"type": "string", "maxLength": 260}, "maxItems": 20},
        },
    }


def prompt_for(source_text: str) -> tuple[str, str]:
    system = """Ты преобразуешь ТОЛЬКО предоставленный официальный текст правил Дзена в компактную базу локальных эвристик для редактора статей.
Не используй память о правилах Дзена и не придумывай запреты, которых нет в источнике.
Цель — обнаруживать возможный риск и отправлять автора на ручную проверку, а не объявлять нарушение.

Правила генерации:
1. Не создавай безразмерный словарь. Обычно достаточно 5–25 категорий и небольшого числа сильных сигналов.
2. phrases — характерные многословные формулировки. stems — короткие основы тематических слов без regex. action_words — слова действия/инструкции. context_words — слова, усиливающие риск. exclude_words — слова/фразы, часто указывающие на осуждение, новость, предупреждение или иной безопасный контекст.
3. Для контекстных тем делай min_score 2–4, чтобы одно тематическое слово не срабатывало само по себе. min_score 1 допустим только для очень сильного самостоятельного сигнала.
4. Не добавляй регулярные выражения, персональные данные, внешние URL, длинные цитаты из источника или примеры опасных инструкций.
5. article_title_max_chars укажи только если в источнике явно назван лимит заголовка статьи; иначе 0.
6. manual_checks — то, что локальный анализ текста надежно определить не может (например, права на медиа, фактическую достоверность, внешний дубль).
7. Все строки — на русском, кроме технических id в snake_case.
"""
    user = "ОФИЦИАЛЬНЫЙ ТЕКСТ ПРАВИЛ ДЗЕНА:\n\n" + source_text
    return system, user


def call_openrouter(api_key: str, model: str, source_text: str) -> tuple[dict, str]:
    system, user = prompt_for(source_text)
    payload = {
        "model": model,
        "temperature": 0.1,
        "max_tokens": 12000,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "dzen_rules_offline_database",
                "strict": True,
                "schema": response_schema(),
            },
        },
    }
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/Ayuemin/dzen-text",
            "X-Title": "Dzen Text rules updater",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:1000]
        raise RuntimeError(f"OpenRouter HTTP {e.code}: {body}") from e
    content = data["choices"][0]["message"]["content"]
    if isinstance(content, dict):
        generated = content
    else:
        text = str(content).strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I | re.S)
        generated = json.loads(text)
    return generated, str(data.get("model") or model)


def clean_list(value, limit=40, max_len=100):
    out = []
    seen = set()
    for item in value if isinstance(value, list) else []:
        s = re.sub(r"\s+", " ", str(item)).strip().lower()
        if not s or len(s) > max_len or s in seen:
            continue
        seen.add(s)
        out.append(s)
        if len(out) >= limit:
            break
    return out


def validate_and_wrap(generated: dict, source_hash: str, model_used: str) -> dict:
    if not isinstance(generated, dict):
        raise ValueError("Model output is not an object")
    categories = []
    ids = set()
    for raw in generated.get("categories", [])[:60]:
        if not isinstance(raw, dict):
            continue
        ident = re.sub(r"[^a-z0-9_]+", "_", str(raw.get("id", "")).lower()).strip("_")[:48]
        if len(ident) < 2 or ident in ids:
            continue
        ids.add(ident)
        sev = raw.get("severity") if raw.get("severity") in {"critical", "warning", "info"} else "warning"
        scope = raw.get("scope") if raw.get("scope") in {"title", "body", "all"} else "all"
        cat = {
            "id": ident,
            "title": re.sub(r"\s+", " ", str(raw.get("title", "Возможный риск"))).strip()[:120],
            "severity": sev,
            "scope": scope,
            "phrases": clean_list(raw.get("phrases")),
            "stems": clean_list(raw.get("stems"), max_len=40),
            "action_words": clean_list(raw.get("action_words"), max_len=60),
            "context_words": clean_list(raw.get("context_words"), max_len=60),
            "exclude_words": clean_list(raw.get("exclude_words"), max_len=100),
            "min_score": max(1, min(5, int(raw.get("min_score", 2)))),
            "explanation": re.sub(r"\s+", " ", str(raw.get("explanation", "Проверьте фрагмент в контексте правил Дзена."))).strip()[:300],
        }
        if cat["phrases"] or cat["stems"]:
            categories.append(cat)
    if len(categories) < 3:
        raise ValueError(f"Too few usable categories: {len(categories)}")
    manual = []
    for x in generated.get("manual_checks", [])[:20]:
        s = re.sub(r"\s+", " ", str(x)).strip()[:260]
        if s and s not in manual:
            manual.append(s)
    title_limit = int(generated.get("article_title_max_chars") or 0)
    if not 0 <= title_limit <= 300:
        title_limit = 0
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    return {
        "schema": 2,
        "version": today.replace("-", ".") + "+" + source_hash[:8],
        "source": SOURCE_URL,
        "source_checked": today,
        "source_sha256": source_hash,
        "generator": {
            "provider": "OpenRouter",
            "model": model_used,
            "prompt_version": PROMPT_VERSION,
        },
        "privacy": "OpenRouter receives only the official Dzen rules page. User articles are never sent by this updater.",
        "note": "Локальная эвристическая проверка. Совпадение означает возможный риск, а не установленное нарушение.",
        "article_title_max_chars": title_limit,
        "categories": categories,
        "manual_checks": manual,
    }


def main() -> int:
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        print("OPENROUTER_API_KEY is not configured; database was not changed.")
        return 0

    print(f"Fetching official Dzen rules: {SOURCE_URL}")
    source_text = fetch_official_text(SOURCE_URL)
    source_hash = hashlib.sha256(source_text.encode("utf-8")).hexdigest()
    print(f"Official rules extracted: {len(source_text)} chars; sha256={source_hash[:12]}…")

    previous = {}
    if RULES_PATH.exists():
        try:
            previous = json.loads(RULES_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    if not FORCE and previous.get("source_sha256") == source_hash and previous.get("schema") == 2:
        print("Official rules have not changed; OpenRouter is not called.")
        return 0

    last_error = None
    models = [PRIMARY_MODEL]
    if FALLBACK_MODEL not in models:
        models.append(FALLBACK_MODEL)
    for model in models:
        try:
            print(f"Generating compact database with {model}…")
            generated, used = call_openrouter(api_key, model, source_text)
            wrapped = validate_and_wrap(generated, source_hash, used)
            RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
            RULES_PATH.write_text(json.dumps(wrapped, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"Wrote {len(wrapped['categories'])} categories using {used}.")
            return 0
        except Exception as exc:
            last_error = exc
            print(f"Model {model} failed: {exc}", file=sys.stderr)
    raise RuntimeError(f"All free model attempts failed: {last_error}")


if __name__ == "__main__":
    raise SystemExit(main())
