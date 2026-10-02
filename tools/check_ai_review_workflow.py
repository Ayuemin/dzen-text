from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "app/src/main/assets/www"
JS = WWW / "js"
workflow = (JS / "12-workflow-policy.js").read_text(encoding="utf-8")
spelling = (JS / "07-spelling.js").read_text(encoding="utf-8")
errors = []

# Yandex.Speller is no longer part of the active manual-check pipeline.
for marker in ["AndroidSpell.check(", "onNativeSpellResult", "onNativeSpellError"]:
    if marker in spelling:
        errors.append("retired online speller marker remains in 07-spelling.js: " + marker)

# The analysis sheet has three independent top-level states/actions.
for marker in [
    "Локальные замечания:",
    "AI проверяет текст…",
    "AI-проверка завершена",
    "Исправить текст с помощью AI",
]:
    if marker not in workflow:
        errors.append("missing analysis status/action: " + marker)
if "Исправить локальные замечания" in workflow or "Исправить AI-замечания" in workflow:
    errors.append("AI fix must not ask the user to choose local vs AI findings")

# AI correction must be patch-only, guarded and reversible.
for marker in [
    "TARGETS",
    '"patches"',
    "target_id",
    "ensureProtectiveVersion('До AI-исправления')",
    "quote должна быть точной подстрокой",
    "Не переписывай статью целиком",
]:
    if marker not in workflow:
        errors.append("AI patch safeguard missing: " + marker)

# Dzen knowledge is explicit, source-grounded and independently reviewed.
for marker in [
    "source_quote",
    "check_mode",
    "Независимый AI-ревизор",
    "review:{completed:true",
    "pageIndex",
    "changedPages",
    "Обновить базу правил Дзена",
    "Открыть базу",
]:
    if marker not in workflow:
        errors.append("Dzen knowledge invariant missing: " + marker)

ensure_pos = workflow.find("ensureDzenAiKnowledge=async function")
if ensure_pos < 0:
    errors.append("explicit knowledge accessor override is missing")
else:
    block = workflow[ensure_pos:ensure_pos + 350]
    if "buildDzenAiKnowledge" in block:
        errors.append("article checking must not rebuild Dzen knowledge implicitly")

# Mechanical checks stay local; semantic checks go to AI without duplicating counts/repeats.
for marker in [
    "Не сообщай то, что приложение уже проверяет механически",
    "allowQuality=k===0",
    "item.check_mode==='mechanical'",
    "MY_SEMANTIC_RULES",
]:
    if marker not in workflow:
        errors.append("local/semantic split missing: " + marker)

# User rules and contextual synonyms replace the old product concepts.
for marker in [
    "Мои правила",
    "myLocalRules",
    "mySemanticRules",
    "Подобрать с AI по контексту",
    "офлайн-резервом",
]:
    if marker not in workflow:
        errors.append("user-rule/synonym workflow missing: " + marker)

if errors:
    raise SystemExit("\n".join("AI REVIEW: " + error for error in errors))
print("AI review workflow invariants OK")
