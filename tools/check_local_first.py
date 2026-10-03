#!/usr/bin/env python3
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
www = root / 'app/src/main/assets/www'
js_dir = www / 'js'

errors = []

def require(cond, message):
    if not cond:
        errors.append(message)

spelling = (js_dir / '07-spelling.js').read_text(encoding='utf-8')
bootstrap = (js_dir / '12-bootstrap.js').read_text(encoding='utf-8')
main_activity = (root / 'app/src/main/java/ru/dzenprep/texteditor/MainActivity.java').read_text(encoding='utf-8')
html = (www / 'index.html').read_text(encoding='utf-8')
manifest = (root / 'app/src/main/AndroidManifest.xml').read_text(encoding='utf-8')
gradle = (root / 'app/build.gradle').read_text(encoding='utf-8')
all_js = '\n'.join(p.read_text(encoding='utf-8') for p in sorted(js_dir.glob('*.js')))

require('android.permission.INTERNET' not in manifest, 'Local-first app must not request Android INTERNET permission')
require('AndroidSpell.check(' not in all_js, 'Runtime JS must not call Yandex.Speller')
require('AndroidDzenAI' not in all_js, 'Runtime JS must not contain the external AI article bridge')
require(not (js_dir / '10-ai-dzen.js').exists(), 'External AI article checker must stay absent')
require('AndroidSpell' not in main_activity, 'Native AndroidSpell bridge must be physically removed')
require('speller.yandex.net' not in main_activity, 'Yandex.Speller endpoint must be physically removed')
require('HttpURLConnection' not in main_activity, 'Local-first MainActivity must not keep HTTP networking code')
require('Яндекс.Спеллер' not in html, 'Yandex.Speller UI must be physically removed')
require('onlineSpelling' not in all_js and 'onlineSpelling' not in html, 'Online spelling state/UI must be physically removed')
require('dzenSmartRules' not in all_js and 'dzenSmartRules' not in html, 'Remote Dzen rules state/UI must be physically removed')
require('raw.githubusercontent.com/Ayuemin/dzen-text/main/rules/dzen-rules.json' not in all_js, 'Runtime must not download Dzen rules')
require('scheduleLocalAnalysis()' in bootstrap, 'Automatic local analysis must stay enabled')
require('AndroidSpell.check' not in spelling, 'Manual full check must not invoke AndroidSpell')
require((js_dir / '12-publish.js').exists(), 'Publication preflight module must exist')
require('AndroidPublish' in main_activity and 'ClipData.Item(plainValue, htmlValue)' in main_activity, 'Native publication clipboard bridge must stay present')
require('buildPublishHtml' in (js_dir / '02-text-tools.js').read_text(encoding='utf-8'), 'Publication must derive payload from rendered Markdown')
require(not (root / '.github/workflows/update-dzen-rules.yml').exists(), 'AI Dzen updater workflow must stay removed')
require(not (root / 'tools/update_dzen_rules.py').exists(), 'AI Dzen updater script must stay removed')
version_code = re.search(r'versionCode\s+(\d+)', gradle)
version_name = re.search(r"versionName\s+'([^']+)'", gradle)
require(version_code and int(version_code.group(1)) >= 48, 'Local-first build must upgrade installed v1.10.8')
require(version_name and version_name.group(1) == '1.11.0', 'Expected local-first versionName 1.11.0')

if errors:
    raise SystemExit('\n'.join('FAIL: ' + x for x in errors))
print('Local-first guard OK')

require('clearOnlineSpelling' not in all_js, 'Legacy spelling compatibility calls must stay removed')
require('OpenRouter receives only' not in all_js, 'Built-in local rule pack must not retain remote-generator provenance')
