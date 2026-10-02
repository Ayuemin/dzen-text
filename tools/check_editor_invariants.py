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

workflow = (JS / "12-markdown-toolbar.js").read_text(encoding="utf-8")
analysis_state = (JS / "05-analysis-state.js").read_text(encoding="utf-8")
analysis_report = (JS / "06-analysis-report.js").read_text(encoding="utf-8")
editor_js = (JS / "09-editor.js").read_text(encoding="utf-8")
bootstrap = (JS / "12-bootstrap.js").read_text(encoding="utf-8")
spelling = (JS / "07-spelling.js").read_text(encoding="utf-8")

# Current product policy: the Markdown toolbar is temporarily disabled because it
# competed with the status row above the Android keyboard. The compatibility file
# keeps the legacy hook inert and physically hides the toolbar and its setting.
if "settings.markdownToolbar=false" not in workflow:
    errors.append("Markdown toolbar must stay disabled until it no longer hides the status row")
if "bar.hidden=true" not in workflow:
    errors.append("Markdown toolbar must be physically hidden, not only disabled in settings")
if "hideSettingsGroupFor(mdSwitch)" not in workflow:
    errors.append("obsolete Markdown-toolbar setting must stay hidden")

# Local analysis is automatic and coalesced. Every text edit marks the analysis
# stale and markAnalysisStale schedules the local pass. Neither path may launch AI.
if "scheduleAnalysis" not in analysis_state or "function markAnalysisStale" not in analysis_state:
    errors.append("every edit must schedule the local analysis pass")
if "markAnalysisStale();" not in bootstrap:
    errors.append("ordinary editor input must mark/schedule the local analysis pass")
if "startAiDzenArticleCheck" in bootstrap or "startAiDzenArticleCheck" in analysis_state:
    errors.append("ordinary input/local analysis must never start the external AI check")
if "startAiDzenArticleCheck(" not in spelling or "continueManualAiCheck" not in spelling:
    errors.append("manual full-check command must still be able to start AI")
if "drawerCheckButton.textContent='AI-проверка текста'" not in workflow:
    errors.append("manual sidebar check must be labelled AI-проверка текста")
if "checkButton.hidden=true" not in workflow:
    errors.append("the old bottom check button must stay hidden; the status dot only opens results")
if "dot.setAttribute('aria-label','Открыть результаты проверки')" not in workflow:
    errors.append("the status dot must describe opening results, not launching a check")

# The old local/AI/both user mode selector is no longer part of the UX. Internal
# code stays in combined mode so local findings are always present and a completed
# manual AI session is layered on top of the same result set.
if "currentCheckMode=function(){return 'both'}" not in workflow:
    errors.append("local checks and retained AI findings must share one internal result set")
if "hideSettingsGroupFor(mode)" not in workflow:
    errors.append("obsolete check-mode selector must stay hidden")
if "settings.dzenCheck=true" not in workflow:
    errors.append("local Dzen rule checks must always be enabled")

# AI findings survive ordinary edits. They are retained as a session and remapped
# by exact checked quote plus context; editing that quote removes only that finding.
for marker in ("aiDzenSessionIssues", "exactQuotePositions", "remapAiDzenIssues", "aiContextBefore", "aiContextAfter"):
    if marker not in workflow:
        errors.append("AI result retention is missing: " + marker)
if "aiDzenSessionIssues=[]" not in workflow:
    errors.append("a new AI run/document must be able to reset the retained session")
if "baseSetEditorTextForArticle" not in workflow or "clearAiDzenIssues('idle')" not in workflow:
    errors.append("switching articles must clear the previous article's AI session")

# The user-facing findings list and exported report are unified. Source remains an
# internal issue.ai flag but must not be prefixed on individual cards or rows.
if "escapeHtml(i.title)" not in analysis_report:
    errors.append("finding cards must render the issue title without source prefixes")
if "origin+i.title" in analysis_report or "AI · ':'Локально" in analysis_report:
    errors.append("finding cards must not expose legacy AI/Локально origin prefixes")
if "без технических пометок об источнике проверки" not in analysis_report:
    errors.append("analysis export must describe the unified result set")
if "function buildCurrentAnalysisReport" not in analysis_report or "Dzen-Text-report-" not in analysis_report:
    errors.append("analysis export must use one unified current report")

# Publication must never ship raw Markdown. The current Android 1.10.6 bridge
# has historical html/plain parameter names but feeds ClipData.Item(text,htmlText),
# so JavaScript compensates by passing plain first and rendered HTML second.
if "copyForPublication(payload.plain,payload.html)" not in editor_js:
    errors.append("Android publication bridge must receive plain text before HTML")
if "new ClipData.Item(htmlValue, plainValue)" not in main_activity:
    errors.append("unexpected PublishBridge layout: review clipboard flavour ordering")
if "ClipboardManager" not in main_activity or "setPrimaryClip" not in main_activity:
    errors.append("publication copy must write through Android ClipboardManager")

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
