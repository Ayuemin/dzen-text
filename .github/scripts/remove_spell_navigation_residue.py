#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def patch(path, replacements):
    p=ROOT/path
    text=p.read_text(encoding='utf-8')
    for old,new,label in replacements:
        if old not in text:
            raise SystemExit(f'missing {label} in {path}')
        text=text.replace(old,new)
    p.write_text(text,encoding='utf-8')

patch('app/src/main/assets/www/js/08-navigation.js',[
    ("function activeCorrectionPanel(){for(const id of ['replacePanel','nearbyPanel','repeatNavPanel','spellPanel','issueNavPanel'])", "function activeCorrectionPanel(){for(const id of ['replacePanel','nearbyPanel','repeatNavPanel','issueNavPanel'])", 'spellPanel active panel entry'),
    ("  try{if(spellNavState)closeSpellPanel()}catch(e){}\n", '', 'spell close-all hook'),
    ("  if(typeof spellNavState!=='undefined'&&spellNavState)closeSpellPanel();\n", '', 'spell issue navigator hook'),
])

patch('app/src/main/assets/www/js/12-articles.js',[
    ("  try{closeSpellPanel()}catch(e){}\n", '', 'article spell panel reset'),
    ("  try{clearOnlineSpelling()}catch(e){}\n", '', 'article online spelling reset'),
])

all_js='\n'.join(p.read_text(encoding='utf-8') for p in sorted((ROOT/'app/src/main/assets/www/js').glob('*.js')))
for token in ('spellNavState','closeSpellPanel','spellPanel','clearOnlineSpelling','onlineSpellIssues','AndroidSpell'):
    if token in all_js:
        raise SystemExit(f'legacy spelling runtime token remains: {token}')
print('Spelling navigation residue removed')
