from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "app/src/main/assets/www"
JS = WWW / "js"

errors = []

html = (WWW / "index.html").read_text(encoding="utf-8")
css = (WWW / "css/editor-v2.css").read_text(encoding="utf-8")
manifest = (ROOT / "app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")

# The Android window resizes for the IME. UI chrome must participate in layout,
# not emulate a second keyboard inset on top of adjustResize.
if 'android:windowSoftInputMode="adjustResize"' not in manifest:
    errors.append("MainActivity must use adjustResize")

main_activity = (ROOT / "app/src/main/java/ru/dzenprep/texteditor/MainActivity.java").read_text(encoding="utf-8")
if "WindowInsets.Type.ime()" not in main_activity:
    errors.append("Android 11+ must detect the IME through WindowInsets.Type.ime()")

core = (JS / "01-core.js").read_text(encoding="utf-8")
if "nativeKeyboardKnown" in core:
    errors.append("keyboard fallback must never be permanently disabled by an initial native signal")
if "nativeKeyboardOpen||fallbackKeyboardOpen" not in core.replace(" ", ""):
    errors.append("keyboard state must combine native and viewport signals")
if "nativeKeyboardInsetCss" not in core or "setProperty('--keyboardInset'" not in core:
    errors.append("native IME height must feed the CSS keyboard inset")
if "layoutBaselineHeight" not in core or "reported-layoutShrink" not in core.replace(" ", ""):
    errors.append("IME avoidance must subtract layout resize to prevent double padding")

if "js/12-caret-focus.js" in html or (JS / "12-caret-focus.js").exists():
    errors.append("legacy caret auto-scroll controller must stay removed")

compact_css = re.sub(r"\s+", "", css)
if "body.keyboard-open.app{padding-bottom:calc(env(safe-area-inset-bottom)+var(--keyboardInset))!important;" not in compact_css:
    errors.append("editor layout must reserve unresolved Android keyboard overlap")
if "bottom:calc(8px+env(safe-area-inset-bottom)+var(--keyboardInset))!important" not in compact_css:
    errors.append("fixed editor panels must stay above the Android keyboard")
if "body.keyboard-open.sheetBackdrop.open.sheet{bottom:var(--keyboardInset)!important;" not in compact_css:
    errors.append("open bottom sheets must rise above unresolved Android keyboard overlap")
if "#riskWords.riskArea{min-height:190px!important;" not in compact_css:
    errors.append("control-word textarea must remain a comfortable multiline editor")

scroll_writers = []
for path in sorted(JS.glob("*.js")):
    text = path.read_text(encoding="utf-8")
    if re.search(r"editor\.scrollTop\s*=", text):
        scroll_writers.append(path.name)

allowed = {"08-navigation.js"}
unexpected = sorted(set(scroll_writers) - allowed)
if unexpected:
    errors.append("Only navigation may set editor.scrollTop; found: " + ", ".join(unexpected))

# The issue navigator is the only intentional manual scroller: programmatic jumps
# to analysis findings need deterministic positioning.
if "08-navigation.js" not in scroll_writers:
    errors.append("navigation scroll controller is missing")

if "keepFocusedSheetFieldVisible" not in core or "scrollIntoView" not in core:
    errors.append("focused sheet fields must be revealed after the keyboard opens")

workflow = (JS / "12-workflow-policy.js").read_text(encoding="utf-8")
analysis_state = (JS / "05-analysis-state.js").read_text(encoding="utf-8")
analysis_report = (JS / "06-analysis-report.js").read_text(encoding="utf-8")
editor_js = (JS / "09-editor.js").read_text(encoding="utf-8")
bootstrap = (JS / "12-bootstrap.js").read_text(encoding="utf-8")
spelling = (JS / "07-spelling.js").read_text(encoding="utf-8")

# Current product policy: the old toolbar and mode selector are removed from
# source, not merely hidden. Undo/redo history remains implemented separately.
workflow_path = JS / "12-workflow-policy.js"
if "markdownToolbar" in html or "markdownToolbarSwitch" in html:
    errors.append("obsolete Markdown toolbar UI must be removed from HTML")
if (JS / "12-markdown-toolbar.js").exists() or "js/12-markdown-toolbar.js" in html:
    errors.append("obsolete Markdown toolbar script must be removed")
if not workflow_path.exists() or "js/12-workflow-policy.js" not in html:
    errors.append("retained AI-session workflow module is missing")
if "dzenCheckMode" in html:
    errors.append("obsolete local/AI/both selector must be removed from HTML")
if "id=\"dzenCheck\"" in html:
    errors.append("local Dzen checks must no longer have an off switch")
if "id=\"checkBtn\"" in html:
    errors.append("old bottom manual-check button must be removed")
if "id=\"drawerAiCheckBtn\"" not in html or ">AI-проверка текста</button>" not in html:
    errors.append("sidebar must expose the single manual AI-check command")

workflow = workflow_path.read_text(encoding="utf-8") if workflow_path.exists() else ""
editor_js = (JS / "09-editor.js").read_text(encoding="utf-8")
bootstrap = (JS / "12-bootstrap.js").read_text(encoding="utf-8")
analysis_state = (JS / "05-analysis-state.js").read_text(encoding="utf-8")
settings_js = (JS / "10-settings.js").read_text(encoding="utf-8")
ai_js = (JS / "10-ai-dzen.js").read_text(encoding="utf-8")
core_js = (JS / "01-core.js").read_text(encoding="utf-8")

for retired in ("markdownToolbarSwitch", "settings.markdownToolbar", "dzenCheckMode", "normalizeDzenCheckMode", "checkModeUsesLocal", "checkModeUsesAi"):
    if retired in core_js + settings_js + ai_js + analysis_state + workflow:
        errors.append("retired check/Markdown concept remains in active JS: " + retired)

if "scheduleAnalysis()" not in analysis_state:
    errors.append("ordinary edits must schedule the local analysis pass")
if "startAiDzenArticleCheck" in bootstrap:
    errors.append("ordinary input/bootstrap code must never start external AI")
if "startAiDzenArticleCheck(String(src||editor.value||''))" not in (JS / "07-spelling.js").read_text(encoding="utf-8"):
    errors.append("manual full-check command must still be able to start AI")
if "aiDzenSessionIssues" not in workflow or "remapAiDzenIssues" not in workflow:
    errors.append("retained AI-session remapping is missing")
if "без технических пометок об источнике" not in (JS / "06-analysis-report.js").read_text(encoding="utf-8"):
    errors.append("unified analysis report description is missing")

if "copyForPublication(payload.html,payload.plain)" not in editor_js:
    errors.append("publication JS bridge must pass HTML then plain text")
if "new ClipData.Item(plainValue, htmlValue)" not in main_activity:
    errors.append("Android clipboard item must map plain text before HTML")
if "CountDownLatch" not in main_activity or "done.await(" not in main_activity or "copied.get()" not in main_activity:
    errors.append("PublishBridge success must wait for the actual clipboard write")
if "setPrimaryClip" not in main_activity:
    errors.append("publication copy must write through Android ClipboardManager")

history_js = (JS / "12-history.js").read_text(encoding="utf-8")
if "function undoEdit" not in history_js or "function redoEdit" not in history_js:
    errors.append("removing the Markdown toolbar must not remove undo/redo history mechanisms")

if 'placeholder="Начните писать…"' not in html:
    errors.append("empty editor invitation is missing")

scripts = re.findall(r'<script\s+src="([^"]+)"', html)
if not scripts or scripts[-1] != "js/12-bootstrap.js":
    errors.append("Bootstrap must remain the final editor script")

# Secrets must not sit in plain SharedPreferences or leave the device in a backup.
secret_src = (ROOT / "app/src/main/java/ru/dzenprep/texteditor/SecretStore.java")
if not secret_src.exists():
    errors.append("SecretStore is missing: the AI API key must be stored encrypted")
else:
    secret_text = secret_src.read_text(encoding="utf-8")
    if "AndroidKeyStore" not in secret_text or "AES/GCM/NoPadding" not in secret_text:
        errors.append("SecretStore must encrypt with an Android Keystore AES-GCM key")
    if "secretStore.save(" not in main_activity:
        errors.append("the AI API key must be written through SecretStore")
    if 'putString("dzen_ai_api_key"' in main_activity:
        errors.append("the AI API key must not be stored as a plain SharedPreferences string")

if 'android:allowBackup="false"' not in manifest:
    errors.append("app data backup must stay disabled so articles and the API key are not exported")

if errors:
    raise SystemExit("\n".join("EDITOR INVARIANT: " + e for e in errors))

print("Editor invariants OK")
print("Direct textarea scroll writers:", ", ".join(scroll_writers))
