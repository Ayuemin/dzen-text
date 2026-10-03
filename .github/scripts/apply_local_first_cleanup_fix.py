#!/usr/bin/env python3
from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]
p = root / 'app/src/main/assets/www/js/05-analysis-state.js'
s = p.read_text(encoding='utf-8')
s, count = re.subn(r'^function clearOnlineSpelling\(\)\{[^\n]*\}\n', '', s, count=1, flags=re.M)
if count != 1:
    raise SystemExit(f'expected clearOnlineSpelling once, got {count}')
p.write_text(s, encoding='utf-8')

www = root / 'app/src/main/assets/www'
all_js = '\n'.join(x.read_text(encoding='utf-8') for x in sorted((www / 'js').glob('*.js')))
html = (www / 'index.html').read_text(encoding='utf-8')
for token in ('onlineSpelling', 'dzenSmartRules', 'AndroidSpell', 'spellStatus', 'spellRequestId', 'onlineSpellIssues', 'onlineSpellSource'):
    if token in all_js or token in html:
        raise SystemExit(f'legacy local-first token remains: {token}')
print('Legacy spelling state removed')
