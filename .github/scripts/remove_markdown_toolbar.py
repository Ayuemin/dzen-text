#!/usr/bin/env python3
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[2]

def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def sub1(s,pat,repl,label,flags=0):
    out,n=re.subn(pat,lambda _m: repl,s,count=1,flags=flags)
    if n!=1: raise SystemExit(f'{label}: expected 1 match, got {n}')
    return out

# Remove the keyboard Markdown bar, while keeping the independent history engine.
p='app/src/main/assets/www/index.html'; s=read(p)
s=sub1(s,r'\n\s*<div class="markdownToolbar" id="markdownToolbar"[\s\S]*?(?=\n\s*<footer class="bottom">)','\n','Markdown toolbar markup')
s=sub1(s,r'\n\s*<details class="settingsGroup">\s*<summary><span>Ввод текста</span>[\s\S]*?</details>\s*(?=\n\s*<details class="settingsGroup">\s*<summary><span>Чтение и озвучка</span>)','\n','Markdown toolbar settings')
s=s.replace('  <script src="js/12-markdown-toolbar.js"></script>\n','')
write(p,s)

p='app/src/main/assets/www/js/01-core.js'; s=read(p)
s=s.replace('markdownToolbar:true,','')
write(p,s)

p='app/src/main/assets/www/js/10-settings.js'; s=read(p)
s=s.replace('markdownToolbarSwitch.checked=settings.markdownToolbar!==false;','')
s=s.replace('    markdownToolbar:markdownToolbarSwitch.checked,\n','')
s=s.replace("  if(typeof updateMarkdownToolbarVisibility==='function')updateMarkdownToolbarVisibility();\n",'')
write(p,s)

p='app/src/main/assets/www/js/09-editor.js'; s=read(p)
s=s.replace("  if(typeof updateMarkdownToolbarVisibility==='function')setTimeout(updateMarkdownToolbarVisibility,20);\n",'')
write(p,s)

p='app/src/main/assets/www/css/editor-v2.css'; s=read(p)
s=sub1(s,r'\n/\* Markdown bar: appears while editing and sits above the keyboard\. \*/[\s\S]*?(?=\n/\* Paper presets stay subtle enough for long reading sessions\. \*/)','\n','Markdown toolbar CSS')
s=sub1(s,r'\n/\* Markdown controls are shown only while the IME is really visible\. \*/[\s\S]*?\.mdHistory\{[^}]*\}','\n','late Markdown toolbar CSS override')
write(p,s)

# Remove dead spelling-only CSS that survived the native/UI removal.
p='app/src/main/assets/www/css/app.css'; s=read(p)
s=re.sub(r'\.spellAttribution\{[^}]*\}\.spellAttribution a\{[^}]*\}','',s)
s=re.sub(r'\.spellActions\{[^}]*\}','',s)
write(p,s)

# Strengthen local-first invariants: formatting toolbar stays retired, history stays alive.
p='tools/check_local_first.py'; s=read(p)
extra="""
require(not (js_dir / '12-markdown-toolbar.js').exists(), 'Retired Markdown toolbar module must stay removed')
require('markdownToolbar' not in all_js and 'markdownToolbar' not in html, 'Retired Markdown toolbar state/UI must stay removed')
require('markdown-toolbar-visible' not in (www / 'css/editor-v2.css').read_text(encoding='utf-8'), 'Retired Markdown toolbar CSS must stay removed')
history=(js_dir / '12-history.js').read_text(encoding='utf-8')
require('function undoEdit()' in history and 'function redoEdit()' in history, 'Undo/Redo engine must stay available')
require('function saveVersionSnapshot' in history, 'Version history must stay available')
"""
if "Retired Markdown toolbar module" not in s:
    s += extra
write(p,s)

# Physical module removal.
toolbar=ROOT/'app/src/main/assets/www/js/12-markdown-toolbar.js'
if toolbar.exists(): toolbar.unlink()

# Fail if any runtime toolbar residue remains.
www=ROOT/'app/src/main/assets/www'
html=(www/'index.html').read_text(encoding='utf-8')
js='\n'.join(x.read_text(encoding='utf-8') for x in sorted((www/'js').glob('*.js')))
css='\n'.join(x.read_text(encoding='utf-8') for x in sorted((www/'css').glob('*.css')))
for token in ('markdownToolbar','updateMarkdownToolbarVisibility','markdown-toolbar-visible'):
    if token in html or token in js or token in css:
        raise SystemExit(f'Markdown toolbar residue remains: {token}')
print('Markdown toolbar removed; history engine retained')
