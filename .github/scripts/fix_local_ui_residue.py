#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def patch(path, changes):
    p=ROOT/path
    s=p.read_text(encoding='utf-8')
    for old,new,label in changes:
        if old not in s:
            raise SystemExit(f'missing {label} in {path}')
        s=s.replace(old,new)
    p.write_text(s,encoding='utf-8')

patch('app/src/main/assets/www/index.html',[
    ('id="sideDrawerBackdrop" onclick="sideDrawerBackdropClick(event)"','id="sideBackdrop" onclick="sideBackdropClick(event)"','side drawer backdrop handler'),
])

patch('app/src/main/assets/www/js/11-ui.js',[
    ("  if(typeof spellNavState!=='undefined'&&spellNavState){closeSpellPanel();return true}\n",'', 'dead spelling back-handler'),
])

# Prevent the old spelling UI and mismatched drawer naming from returning.
p=ROOT/'tools/check_local_first.py'
s=p.read_text(encoding='utf-8')
needle="require('clearOnlineSpelling' not in all_js, 'Legacy spelling compatibility calls must stay removed')\n"
extra=(
    "require('spellNavState' not in all_js and 'closeSpellPanel' not in all_js, 'Legacy spelling panel navigation must stay removed')\n"
    "require('id=\"sideBackdrop\"' in html and 'sideBackdropClick(event)' in html, 'Side drawer backdrop must match the runtime handler')\n"
    "require('sideDrawerBackdropClick' not in html, 'Stale side drawer backdrop handler must stay removed')\n"
)
if extra not in s:
    if needle not in s: raise SystemExit('local-first guard insertion point missing')
    s=s.replace(needle,needle+extra)
p.write_text(s,encoding='utf-8')
print('Local UI residue fixed')
