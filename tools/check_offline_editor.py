#!/usr/bin/env python3
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1];www=root/'app/src/main/assets/www';js=www/'js';errors=[]
def require(c,m):
    if not c: errors.append(m)
manifest=(root/'app/src/main/AndroidManifest.xml').read_text(encoding='utf-8');gradle=(root/'app/build.gradle').read_text(encoding='utf-8');main=(root/'app/src/main/java/io/github/ayuemin/texteditor/MainActivity.java').read_text(encoding='utf-8');html=(www/'index.html').read_text(encoding='utf-8');all_js='\n'.join(p.read_text(encoding='utf-8') for p in sorted(js.glob('*.js')))
require('android.permission.INTERNET' not in manifest,'Offline editor must not request INTERNET')
require('fetch(' not in all_js and 'XMLHttpRequest' not in all_js and 'WebSocket' not in all_js,'Runtime JS must not contain network clients')
require("applicationId 'io.github.ayuemin.texteditor'" in gradle,'Prototype must use a new neutral applicationId')
require('ru.dzenprep' not in main,'Old Java package must be removed')
require(not (js/'04-dzen-analysis.js').exists(),'Platform-specific analyzer must be removed')
require((js/'04-rules-analysis.js').exists(),'Generic rule-pack analyzer is missing')
require('editorial-rule-pack-v1' in all_js and 'RULE_TYPES' in all_js,'Strict rule-pack schema is missing')
require('id="sideBackdrop"' in html and 'class="sideBackdrop"' in html,'Drawer backdrop DOM/CSS contract must match')
require('overflow-y:auto!important' in (www/'css/editor-v2.css').read_text(encoding='utf-8'),'Drawer must scroll internally')
require('DEFAULT_DZEN_RULES' not in all_js,'No bundled platform rule database is allowed')
require('dzenRules' not in all_js and 'activeDzenRules' not in all_js,'Legacy platform rule state must be removed')
require('Правила Дзена' not in html,'Settings must be platform-neutral')
require(not (root/'rules/dzen-rules.json').exists(),'Bundled platform rules file must be removed')
# New install: app source must not retain the old product/platform identity.
for p in (root/'app/src/main').rglob('*'):
    if not p.is_file() or p.suffix.lower() in {'.png','.jpg','.jpeg','.webp','.ttf','.otf','.woff','.woff2'}: continue
    try: text=p.read_text(encoding='utf-8')
    except Exception: continue
    if re.search(r'dzen|дзен',text,re.I): errors.append('Old Dzen identity remains in '+str(p.relative_to(root)))
if errors: raise SystemExit('\n'.join('OFFLINE EDITOR: '+e for e in errors))
print('Offline neutral editor guard OK')
