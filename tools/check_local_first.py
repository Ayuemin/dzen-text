#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
www = root / 'app/src/main/assets/www'
js_dir = www / 'js'

errors = []

def require(cond, message):
    if not cond:
        errors.append(message)

spelling = (js_dir / '07-spelling.js').read_text(encoding='utf-8')
bootstrap = (js_dir / '12-bootstrap.js').read_text(encoding='utf-8')
all_js = '\n'.join(p.read_text(encoding='utf-8') for p in sorted(js_dir.glob('*.js')))

require('AndroidSpell.check(' not in all_js, 'Runtime JS must not call Yandex.Speller')
require('AndroidDzenAI' not in all_js, 'Runtime JS must not contain the external AI article bridge')
require(not (js_dir / '10-ai-dzen.js').exists(), 'External AI article checker must stay absent')
require("settings.onlineSpelling=false" in bootstrap, 'Bootstrap must force online spelling off')
require("settings.dzenSmartRules=false" in bootstrap, 'Bootstrap must force remote Dzen rules off')
require('scheduleLocalAnalysis()' in bootstrap, 'Automatic local analysis must stay enabled')
require("spellStatus='off'" in spelling, 'Manual full check must remain local-only')
require('AndroidSpell.check' not in spelling, 'Manual full check must not invoke AndroidSpell')
require(not (root / '.github/workflows/update-dzen-rules.yml').exists(), 'AI Dzen updater workflow must stay removed')
require(not (root / 'tools/update_dzen_rules.py').exists(), 'AI Dzen updater script must stay removed')

if errors:
    raise SystemExit('\n'.join('FAIL: ' + x for x in errors))
print('Local-first guard OK')
