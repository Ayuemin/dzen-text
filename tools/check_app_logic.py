from pathlib import Path
import re
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "app/src/main/assets/www"
JS = WWW / "js"
HTML = (WWW / "index.html").read_text(encoding="utf-8")
errors = []

# Duplicate DOM IDs make getElementById silently target the wrong control.
ids = re.findall(r'\bid="([^"]+)"', HTML)
seen = defaultdict(int)
for value in ids:
    seen[value] += 1
duplicates = sorted(k for k,v in seen.items() if v > 1)
if duplicates:
    errors.append("duplicate HTML ids: " + ", ".join(duplicates))

# Every static script include must resolve to a real file.
scripts = re.findall(r'<script\s+src="([^"]+)"', HTML)
for src in scripts:
    path = WWW / src
    if not path.exists():
        errors.append("missing script: " + src)

# Top-level named function declarations are global in these classic scripts.
# Duplicate names are dangerous because the later file/declaration wins silently.
functions = defaultdict(list)
native_callbacks = defaultdict(list)
id_refs = defaultdict(list)

for path in sorted(JS.glob("*.js")):
    text = path.read_text(encoding="utf-8")
    for match in re.finditer(r'(?m)^function\s+([A-Za-z_$][\w$]*)\s*\(', text):
        functions[match.group(1)].append(path.name)
    for match in re.finditer(r'window\.(onNative[A-Za-z0-9_$]+)\s*=', text):
        native_callbacks[match.group(1)].append(path.name)
    for match in re.finditer(r'getElementById\(\s*["\']([^"\']+)["\']\s*\)', text):
        id_refs[match.group(1)].append(path.name)

dupe_functions = {k:v for k,v in functions.items() if len(v) > 1}
if dupe_functions:
    errors.append("duplicate global functions: " + "; ".join(f"{k} -> {','.join(v)}" for k,v in sorted(dupe_functions.items())))

dupe_callbacks = {k:v for k,v in native_callbacks.items() if len(v) > 1}
if dupe_callbacks:
    errors.append("duplicate native callbacks: " + "; ".join(f"{k} -> {','.join(v)}" for k,v in sorted(dupe_callbacks.items())))

html_ids = set(ids)
dynamic_ids = {"customEditorFontStyle", "analysisCollapsedSummary"}  # optional/created dynamically
missing_refs = sorted(k for k in id_refs if k not in html_ids and k not in dynamic_ids)
if missing_refs:
    errors.append("getElementById targets missing from HTML: " + ", ".join(missing_refs))

# Programmatic textarea replacements must participate in persistence/history.
# Keep this narrow and explicit: formatting/replacement modules are required to
# funnel edits through the central post-edit hook.
for name in ["07-spelling.js", "08-navigation.js", "11-ui.js", "12-markdown-toolbar.js"]:
    path = JS / name
    text = path.read_text(encoding="utf-8")
    if "editor.setRangeText(" in text and "afterProgrammaticEdit(" not in text:
        errors.append(name + " changes editor text without afterProgrammaticEdit()")


# Destructive article replacement must be protected by a version snapshot.
editor_js = (JS / "09-editor.js").read_text(encoding="utf-8")
history_js = (JS / "12-history.js").read_text(encoding="utf-8")
bootstrap_js = (JS / "12-bootstrap.js").read_text(encoding="utf-8")
articles_js = (JS / "12-articles.js").read_text(encoding="utf-8")

for fn, marker in [
    ("clearEditor", "ensureProtectiveVersion('Перед очисткой')"),
    ("loadFileText", "ensureProtectiveVersion('Перед импортом')"),
]:
    start = editor_js.find("function " + fn) if fn == "clearEditor" else editor_js.find("async function " + fn)
    if start < 0:
        errors.append("missing " + fn)
    else:
        block = editor_js[start:start + 2600]
        if marker not in block:
            errors.append(fn + " may overwrite text without a protective version")

restore_start = history_js.find("async function restoreVersion")
if restore_start < 0 or "ensureProtectiveVersion('Перед восстановлением')" not in history_js[restore_start:restore_start + 2600]:
    errors.append("restoreVersion may overwrite text without a protective version")

if "autoVersionInterval" in history_js or "setInterval(function(){" in history_js:
    errors.append("auto-versioning must use one article-local timeout scheduler, not a global interval")

if "if(repeatNavState)closeRepeatNavigator()" in bootstrap_js:
    errors.append("manual editing must refresh repeat navigation instead of closing it")
if "scheduleRepeatNavigatorRefresh" not in bootstrap_js:
    errors.append("repeat navigation refresh hook is missing")

if "function scheduleArticleSave()" not in articles_js or "articleDirty=true" not in articles_js:
    errors.append("native article autosave dirty-state scheduler is missing")
if "function resetArticleAutosaveState()" not in articles_js:
    errors.append("article switches must cancel stale autosave state")
if "if(!text.trim())return true;" in articles_js:
    errors.append("empty article edits must be persisted before switching articles")

open_start = articles_js.find("function openSavedArticle")
if open_start < 0:
    errors.append("missing openSavedArticle")
else:
    block = articles_js[open_start:open_start + 2200]
    load_pos = block.find("AndroidDocuments.loadArticle(next)")
    activate_pos = block.find("AndroidDocuments.setActiveArticle(next)")
    if load_pos < 0 or activate_pos < 0 or load_pos > activate_pos:
        errors.append("openSavedArticle must read the target before changing active article")
    if "preserveCurrentArticleBeforeSwitch('Перед сменой статьи')" not in block:
        errors.append("openSavedArticle must preserve current article before switching")

new_start = articles_js.find("function createNewArticle")
if new_start < 0 or "if(!preserveCurrentArticleBeforeSwitch('Перед новой статьёй'))return;" not in articles_js[new_start:new_start + 900]:
    errors.append("createNewArticle must persist even an empty dirty article before switching")

ui_js = (JS / "11-ui.js").read_text(encoding="utf-8")
idea_start = ui_js.find("async function ideaAsText")
if idea_start < 0 or "preserveCurrentArticleBeforeSwitch('Перед статьёй из идеи')" not in ui_js[idea_start:idea_start + 1800]:
    errors.append("ideaAsText must preserve current article before switching")

migration_start = history_js.find("function migrateLegacyVersions")
if migration_start < 0:
    errors.append("missing migrateLegacyVersions")
else:
    block = history_js[migration_start:migration_start + 1400]
    if "result.ok||result.duplicate" not in block or "if(complete)" not in block:
        errors.append("legacy versions must only be deleted after confirmed migration")

# Zero-argument render() runs a full analysis by default and is forbidden in
# routine UI/storage flows.
for path in sorted(JS.glob("*.js")):
    text = path.read_text(encoding="utf-8")
    if re.search(r'\brender\s*\(\s*\)', text):
        errors.append(path.name + " contains render() which triggers an implicit full analysis")

if errors:
    raise SystemExit("\n".join("APP LOGIC: " + e for e in errors))

print(f"App logic checks OK: {len(ids)} ids, {len(functions)} global functions, {len(scripts)} scripts")
