from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "app/src/main/assets/www"
JS = WWW / "js"
HTML = (WWW / "index.html").read_text(encoding="utf-8")
CSS = "\n".join(path.read_text(encoding="utf-8") for path in sorted((WWW / "css").glob("*.css")))
ALL_JS = "\n".join(path.read_text(encoding="utf-8") for path in sorted(JS.glob("*.js")))
MAIN_JAVA = (ROOT / "app/src/main/java/ru/dzenprep/texteditor/MainActivity.java").read_text(encoding="utf-8")
errors = []

# Retired workflow concepts must stay physically absent from the active UI/code.
for phrase in [
    "Режим проверки",
    "Локальная проверка Дзена",
    "AI-проверка Дзена",
    "Панель Markdown над клавиатурой",
    "выбранному режиму проверки",
]:
    if phrase in HTML or phrase in ALL_JS:
        errors.append("retired visible wording remains: " + phrase)

for marker in [
    "dzenCheckMode",
    "markdownToolbarSwitch",
    "normalizeDzenCheckMode",
    "checkModeUsesLocal",
    "checkModeUsesAi",
]:
    if marker in HTML or marker in ALL_JS:
        errors.append("retired active marker remains: " + marker)

for marker in ["markdownToolbar", ".mdBtn", "markdown-toolbar-visible"]:
    if marker in HTML or marker in CSS:
        errors.append("obsolete Markdown toolbar source/CSS remains: " + marker)

if (JS / "12-markdown-toolbar.js").exists():
    errors.append("obsolete Markdown toolbar JavaScript still exists")
if not (JS / "12-workflow-policy.js").exists():
    errors.append("workflow policy module is missing")

# Native publication bridge must expose plain text as ClipData text and HTML as
# htmlText, and may report success only after the UI-thread clipboard write.
if "new ClipData.Item(plainValue, htmlValue)" not in MAIN_JAVA:
    errors.append("publication clipboard must use ClipData.Item(plain, html)")
if "CountDownLatch" not in MAIN_JAVA or "done.await(" not in MAIN_JAVA or "copied.get()" not in MAIN_JAVA:
    errors.append("PublishBridge must wait for the actual clipboard write before returning success")
if "clipboard.setPrimaryClip(clip);" not in MAIN_JAVA:
    errors.append("PublishBridge must write the constructed rich clipboard payload")

if errors:
    raise SystemExit("\n".join("RETIRED WORKFLOW: " + error for error in errors))

print("Retired workflow / clipboard invariants OK")
