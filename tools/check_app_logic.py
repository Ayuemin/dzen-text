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

if errors:
    raise SystemExit("\n".join("APP LOGIC: " + e for e in errors))

print(f"App logic checks OK: {len(ids)} ids, {len(functions)} global functions, {len(scripts)} scripts")
