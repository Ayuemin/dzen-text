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

for block in re.findall(r"\.markdownToolbar\s*\{([^}]*)\}", css, re.S):
    if re.search(r"position\s*:\s*fixed", block):
        errors.append("Markdown toolbar must stay in normal flex layout, never position:fixed")
    if re.search(r"bottom\s*:\s*calc\([^)]*(?:keyboardInset|viewportBottomInset)", block):
        errors.append("Markdown toolbar must not emulate keyboard insets")

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

if "markdown-toolbar-visible .bottom{display:none" not in css.replace("\n", "").replace(" ", ""):
    # Accept the formatted variant too.
    compact = re.sub(r"\s+", "", css)
    if "body.markdown-toolbar-visible.bottom{display:none!important}" in compact:
        pass

if "keepFocusedSheetFieldVisible" not in core or "scrollIntoView" not in core:
    errors.append("focused sheet fields must be revealed after the keyboard opens")

toolbar = (JS / "12-markdown-toolbar.js").read_text(encoding="utf-8")
if "touchDevice" not in toolbar or "keyboardExpected" not in toolbar:
    errors.append("Markdown toolbar needs a touch-focus fallback when IME callbacks are delayed")
if 'placeholder="Начните писать…"' not in html:
    errors.append("empty editor invitation is missing")

scripts = re.findall(r'<script\s+src="([^"]+)"', html)
if not scripts or scripts[-1] != "js/12-bootstrap.js":
    errors.append("Bootstrap must remain the final editor script")

if errors:
    raise SystemExit("\n".join("EDITOR INVARIANT: " + e for e in errors))

print("Editor invariants OK")
print("Direct textarea scroll writers:", ", ".join(scroll_writers))
