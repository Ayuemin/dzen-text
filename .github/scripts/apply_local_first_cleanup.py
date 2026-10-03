#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing exact block: {label}')
    return text.replace(old, new, 1)


def sub_once(text, pattern, repl, label, flags=0):
    text, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'expected one regex match for {label}, got {count}')
    return text

# Native Android: remove the dead network spelling bridge and every network import.
p = 'app/src/main/java/ru/dzenprep/texteditor/MainActivity.java'
s = read(p)
for line in (
    'import java.net.HttpURLConnection;\n',
    'import java.net.URL;\n',
    'import java.net.URLEncoder;\n',
):
    s = s.replace(line, '')
s = replace_once(s, '        web.addJavascriptInterface(new SpellBridge(), "AndroidSpell");\n', '', 'AndroidSpell interface')
s = sub_once(
    s,
    r'\n    public class SpellBridge \{.*?\n    \}\n\n    public class DictionaryBridge',
    '\n    public class DictionaryBridge',
    'SpellBridge class',
    re.S,
)
s = sub_once(
    s,
    r'\n    private static class SpellChunk \{.*?\n    private String readDisplayName',
    '\n    private String readDisplayName',
    'Yandex spelling helpers',
    re.S,
)
for forbidden in ('SpellBridge', 'AndroidSpell', 'speller.yandex.net', 'HttpURLConnection', 'URLEncoder'):
    if forbidden in s:
        raise SystemExit(f'native cleanup left {forbidden}')
write(p, s)

# HTML: remove hidden legacy spelling UI and remote-rule controls instead of hiding them at runtime.
p = 'app/src/main/assets/www/index.html'
s = read(p)
s = s.replace('<title>Дзен Текст 1.9.0</title>', '<title>Дзен Текст 1.11.0</title>')
s = sub_once(
    s,
    r'\n    <div id="spellPanel" class="replacePanel"[\s\S]*?\n  <div class="markdownToolbar"',
    '\n  <div class="markdownToolbar"',
    'spell panel',
)
local_group = '''\n    <details class="settingsGroup">\n      <summary><span>Локальная проверка</span><small>Опечатки, пунктуация и механические ошибки</small></summary>\n      <div class="settingsGroupBody">\n        <div class="switchRow"><span>Локальные опечатки и пунктуация</span><input id="proofCheck" class="switch" type="checkbox" onchange="applySettings()"></div>\n        <div class="smallNote">Проверка выполняется только на устройстве. Текст статьи никуда не отправляется.</div>\n      </div>\n    </details>\n'''
s = sub_once(
    s,
    r'\n    <details class="settingsGroup">\s*<summary><span>Проверка текста</span>[\s\S]*?</details>\s*(?=\n\s*<details class="settingsGroup">\s*<summary><span>Правила Дзена</span>)',
    local_group,
    'spelling settings group',
)
dzen_group = '''\n    <details class="settingsGroup">\n      <summary><span>Правила Дзена</span><small>Встроенные локальные эвристики</small></summary>\n      <div class="settingsGroupBody">\n        <div class="switchRow"><span>Проверять возможные риски</span><input id="dzenCheck" class="switch" type="checkbox" onchange="applySettings()"></div>\n        <div class="smallNote">Используется встроенный набор эвристик. Совпадение означает повод проверить формулировку вручную, а не установленное нарушение.</div>\n        <div id="dzenRulesStatus" class="ruleStatus"></div>\n      </div>\n    </details>\n'''
s = sub_once(
    s,
    r'\n    <details class="settingsGroup">\s*<summary><span>Правила Дзена</span>[\s\S]*?</details>\s*(?=\n\s*<details class="settingsGroup">\s*<summary><span>Словарь синонимов</span>)',
    dzen_group,
    'Dzen settings group',
)
s = s.replace('<span>Признаки ИИ-стиля</span><input id="aiStyleCheck"', '<span>Типографические сигналы</span><input id="aiStyleCheck"')
s = s.replace('Локальный фильтр отмечает типографические признаки, характерные для машинного текста. Смысловые шаблоны автоматически не оцениваются.', 'Локальная механическая проверка типографических признаков. Она не определяет авторство текста и не оценивает смысл.')
s = s.replace('Отчёт содержит метки поиска, контекст и позиции замечаний — удобно передать его модели, которая будет править исходную статью.', 'Отчёт содержит метки поиска, контекст и позиции замечаний — его можно сохранить или скопировать для ручной работы.')
s = s.replace('onclick="drawerCheck()">Проверить текст</button>', 'onclick="drawerCheck()">Проверить локально</button>')
s = s.replace('id="checkBtn" onclick="runFullCheck()" aria-label="Проверить текст" title="Проверить текст"', 'id="checkBtn" onclick="runFullCheck()" aria-label="Обновить локальную проверку" title="Обновить локальную проверку"')
for forbidden in ('Яндекс.Спеллер', 'onlineSpelling', 'dzenSmartRules', 'spellPanel', 'spellIgnoreStatus'):
    if forbidden in s:
        raise SystemExit(f'HTML cleanup left {forbidden}')
write(p, s)

# Core state: remove online spelling and make the Dzen rule pack permanently built in.
p = 'app/src/main/assets/www/js/01-core.js'
s = read(p)
s = s.replace('onlineSpelling:false,', '')
s = s.replace('dzenSmartRules:true,', '')
s = sub_once(s, r'let onlineSpellIssues=.*?inputWasPaste=false;\n', 'let inputWasPaste=false;\n', 'online spelling state')
s = sub_once(s, r'const SPELL_IGNORE_KEY=.*?\n\nconst DZEN_RULES_URL=', 'const DZEN_RULES_URL=', 'spelling ignore state', re.S)
s = s.replace("const DZEN_RULES_URL='https://raw.githubusercontent.com/Ayuemin/dzen-text/main/rules/dzen-rules.json';\n", '')
s = s.replace("const DZEN_RULES_KEY='dzenRulesV2';\n", '')
s = s.replace('let dzenRulesFromCache=false;\nlet dzenRules=DEFAULT_DZEN_RULES;\n', 'let dzenRules=DEFAULT_DZEN_RULES;\n')
s = sub_once(s, r'function activeDzenRules\(\)\{[^\n]*\}\n', 'function activeDzenRules(){return DEFAULT_DZEN_RULES}\n', 'active local Dzen rules')
s = sub_once(s, r'function loadDzenRules\(\)\{[^\n]*\}\n', 'function loadDzenRules(){return DEFAULT_DZEN_RULES}\n', 'load local Dzen rules')
s = sub_once(s, r'function updateDzenRulesStatus\(\)\{[^\n]*\}\n', "function updateDzenRulesStatus(){const el=document.getElementById('dzenRulesStatus');if(!el)return;const r=DEFAULT_DZEN_RULES;el.innerHTML=`Локальная база: <b>встроенная</b><br>Версия: <b>${escapeHtml(String(r.version||'встроенная'))}</b><br>Статья проверяется только на устройстве.`}\n", 'local Dzen status')
s = sub_once(s, r'async function updateDzenRulesFromGitHub\(\)\{[^\n]*\}\n', '', 'remote Dzen updater')
s = sub_once(s, r'function resetDzenRules\(\)\{[^\n]*\}\n', '', 'remote Dzen reset')
for forbidden in ('onlineSpelling', 'spellIgnore', 'DZEN_RULES_URL', 'DZEN_RULES_KEY', 'dzenSmartRules', 'raw.githubusercontent.com'):
    if forbidden in s:
        raise SystemExit(f'core cleanup left {forbidden}')
write(p, s)

# Analysis: spelling results no longer exist, and user-facing AI-authorship wording is removed.
p = 'app/src/main/assets/www/js/04-dzen-analysis.js'
s = read(p)
s = s.replace('В нашем редакционном фильтре он считается типографическим маркером машинного текста. Нажмите, чтобы просмотреть все места. Сам по себе символ не доказывает авторство ИИ.', 'Это типографический сигнал для проверки единообразия. Нажмите, чтобы просмотреть все места. Сам по себе символ не является ошибкой и ничего не говорит об авторстве текста.')
write(p, s)

p = 'app/src/main/assets/www/js/05-analysis-state.js'
s = read(p)
s = re.sub(r"\n if\(onlineSpellSource===src&&onlineSpellIssues\.length\)\{[^\n]*\}", '', s)
s = s.replace(",spellCount=typeCount('spelling')", '')
s = s.replace('-spellCount', '')
s = s.replace('dzenCount,spellCount,aiStyleCount', 'dzenCount,aiStyleCount')
s = s.replace("return [{id:'spelling',name:'Орфография'},", 'return [')
write(p, s)

p = 'app/src/main/assets/www/js/06-analysis-report.js'
s = read(p)
s = s.replace('признаки ИИ-стиля: ${a.aiStyleCount||0}; правила Дзена: ${a.dzenCount||0}; орфография: ${a.spellCount||0}.', 'типографические сигналы: ${a.aiStyleCount||0}; правила Дзена: ${a.dzenCount||0}.')
s = s.replace("lines.push('Инструкция для модели: исправляйте только отмеченные места, сверяясь с «Меткой поиска» и контекстом. Не меняйте смысл и структуру статьи без необходимости. Сигналы «Правила Дзена» означают повод проверить формулировку, а не установленное нарушение.');", "lines.push('Используйте «Метку поиска», контекст и позицию, чтобы вручную проверить отмеченные места. Сигналы «Правила Дзена» означают повод проверить формулировку, а не установленное нарушение.');")
render = '''function renderAnalysis(){const box=document.getElementById('analysisContent'),sum=document.getElementById('analysisSummary'),collapsed=document.getElementById('analysisCollapsedSummary'),a=currentAnalysis,ec=a.editorCount||0,ac=a.aiStyleCount||0,dc=a.dzenCount||0;sum.innerHTML=a.warningCount?`Редакторских замечаний: <b>${ec}</b> · типографических сигналов: <b>${ac}</b> · по правилам Дзена: <b>${dc}</b>.`:`<b>По локальным проверкам замечаний нет.</b> Финальная вычитка всё равно нужна.`;if(collapsed)collapsed.textContent=`${ec?'🔴':'🟢'} редакторских: ${ec} · ${dc?'🟠':'🟢'} Дзен: ${dc}`;document.querySelectorAll('.analysisFilter').forEach(b=>b.classList.toggle('active',b.dataset.mode===analysisMode));let html='';if(analysisMode==='all')html+=`<div class="analysisInfo"><div class="metric"><b>${a.metrics.headings?.length||0}</b><span>заголовков</span></div><div class="metric"><b>${a.metrics.avgSentence||0}</b><span>слов в среднем предложении</span></div><div class="metric"><b>${a.metrics.lists||0}</b><span>пунктов списков</span></div><div class="metric"><b>${a.metrics.links||0}</b><span>ссылок</span></div></div>`;if(analysisMode==='dzen'){const rows=a.issues.filter(x=>x.type==='dzen');html+=`<div class="analysisDzenNote">База правил: <b>${escapeHtml(String(activeDzenRules().version||'встроенная'))}</b>. Совпадение означает только повод проверить фрагмент, а не установленное нарушение.</div>`;if(rows.length){const n=analysisVisibleAndHidden('dzen');html+=`<div class="analysisGroup"><div class="analysisTitle"><span>Возможные риски</span><span class="badge bad">${n.total}</span></div>${rows.map(issueHtml).join('')}${analysisOverflowNote('dzen')}</div>`;}else html+='<div class="analysisEmpty">Автоматические признаки риска по текущей базе не найдены.</div>';html+=renderDzenManual();box.innerHTML=html;return}for(const g of issueGroups()){const rows=a.issues.filter(x=>x.type===g.id);if(g.id==='heading'&&analysisMode==='all'){const hs=a.metrics.headings||[];html+=`<div class="analysisGroup"><div class="analysisTitle"><span>${g.name}</span><span class="badge ${analysisVisibleAndHidden(g.id).total?'bad':''}">${analysisVisibleAndHidden(g.id).total||'✓'}</span></div>`;if(!hs.length)html+='<div class="analysisRow"><span class="meta">Заголовков Markdown не найдено.</span></div>';else for(const h of hs){const bad=rows.find(r=>r.start===h.start);html+=bad?issueHtml(bad):`<button class="analysisRow jump" onclick="jumpTo(${h.start},${h.end})"><span class="ok">H${h.level} · ${h.text.length} знаков</span> ${escapeHtml(h.text)}<span class="meta">Нажмите, чтобы перейти к заголовку</span></button>`}html+='</div>';continue}if(!rows.length)continue;const n=analysisVisibleAndHidden(g.id);html+=`<div class="analysisGroup"><div class="analysisTitle"><span>${g.name}</span><span class="badge bad">${n.total}</span></div>${rows.map(issueHtml).join('')}${analysisOverflowNote(g.id)}</div>`}if(!a.warningCount)html+='<div class="analysisEmpty">Замечаний нет. Переключите «Всё», чтобы посмотреть информационные показатели.</div>';box.innerHTML=html}\n'''
s = sub_once(s, r'function renderAnalysis\(\)\{[\s\S]*?\nfunction issueHtml\(i\)\{', render + 'function issueHtml(i){', 'local renderAnalysis')
s = s.replace("  if(i.type==='aiStyle')sev='Маркер машинного стиля — проверить';", "  if(i.type==='aiStyle')sev='Типографический сигнал — проверить';")
s = re.sub(r"\n  \}else if\(i\.type==='spelling'\)\{[\s\S]*?hint='нажмите: варианты исправления';", '', s, count=1)
for forbidden in ('Яндекс.Спеллер', 'онлайн-орфография', "type==='spelling'", 'Инструкция для модели', 'ИИ-стиль'):
    if forbidden in s:
        raise SystemExit(f'report cleanup left {forbidden}')
write(p, s)

# The manual checker is now purely local; retain a no-op closeSpellPanel for old call sites during migration.
p = 'app/src/main/assets/www/js/07-spelling.js'
write(p, '''function runFullCheck(){\n const src=editor.value||'';\n if(!src.trim()){toast('Нет текста для проверки');return}\n editor.blur();\n setCheckRunning(true);\n toast(src.length>150000?'Обновляю локальную проверку большого текста…':'Обновляю локальную проверку…');\n setTimeout(()=>{\n   try{\n     analyzeText();\n     analysisMode='problems';\n     document.getElementById('analysisBackdrop').classList.add('open');\n     setAnalysisMode('problems');\n     renderAnalysis();\n     setCheckRunning(false);\n     toast('Локальная проверка обновлена');\n   }catch(e){\n     setCheckRunning(false);\n     toast('Не удалось завершить проверку');\n     console.error(e);\n   }\n },60);\n}\nfunction closeSpellPanel(){}\nfunction closeAnalysis(){document.getElementById('analysisBackdrop').classList.remove('open')}\nfunction openAnalysis(){editor.blur();setCheckRunning(true);setTimeout(()=>{try{analyzeText();document.getElementById('analysisBackdrop').classList.add('open');setAnalysisMode(analysisMode)}finally{setCheckRunning(false)}},40)}\nfunction analysisBackdropClick(e){if(e.target.id==='analysisBackdrop')closeAnalysis()}\n''')

# Editor no longer maintains online spelling state.
p = 'app/src/main/assets/www/js/09-editor.js'
s = read(p)
s = s.replace("  const keepOnlineSpelling=!!options.keepOnlineSpelling;\n  if(!keepOnlineSpelling&&typeof clearOnlineSpelling==='function')clearOnlineSpelling();\n", '')
s = s.replace('  closeSpellPanel();\n', '')
s = s.replace('  clearOnlineSpelling();\n', '')
write(p, s)

# Settings become local-only; remove all controls/state for online spelling and remote Dzen rules.
p = 'app/src/main/assets/www/js/10-settings.js'
s = read(p)
s = s.replace('onlineSpelling.checked=settings.onlineSpelling;', '')
s = s.replace('dzenSmartRules.checked=settings.dzenSmartRules!==false;', '')
s = s.replace('updateSpellIgnoreStatus()', '')
s = sub_once(
    s,
    r'async function applySettings\(\)\{[\s\S]*?\n\s*settings=\{',
    'function applySettings(){\n  settings={',
    'local applySettings prefix',
)
s = s.replace('    onlineSpelling:wantsOnline,\n', '')
s = s.replace('    dzenSmartRules:dzenSmartRules.checked,\n', '')
for forbidden in ('onlineSpelling', 'dzenSmartRules', 'Яндекс.Спеллер'):
    if forbidden in s:
        raise SystemExit(f'settings cleanup left {forbidden}')
write(p, s)

# Bootstrap: remove compatibility hiding/overrides; only local analysis + publication hardening remain.
p = 'app/src/main/assets/www/js/12-bootstrap.js'
s = read(p)
s = sub_once(s, r'\nfunction installTypographyReview\(\)\{[\s\S]*?\n\}\n\nfunction enforceLocalFirstSettings', '\nfunction enforceLocalFirstSettings', 'typography bootstrap override')
s = sub_once(s, r'\nfunction enforceLocalFirstSettings\(\)\{[\s\S]*?\n\}\n\nfunction applyLocalFirstUi', '\nfunction applyLocalFirstUi', 'local-first settings override')
s = sub_once(s, r'\nfunction applyLocalFirstUi\(\)\{[\s\S]*?\n\}\n\nfunction bootstrapDzenText', '\nfunction bootstrapDzenText', 'runtime UI hiding')
s = s.replace('  enforceLocalFirstSettings();\n', '')
s = s.replace('  installTypographyReview();\n', '')
s = s.replace('  spellIgnoreWords=loadSpellIgnoreWords();\n', '')
s = s.replace('    if(spellNavState)closeSpellPanel();\n', '')
s = s.replace('    clearOnlineSpelling();\n', '')
s = s.replace('  applyLocalFirstUi();\n', '')
s = s.replace('  updateSpellIgnoreStatus();\n', '')
for forbidden in ('onlineSpelling', 'dzenSmartRules', 'spellIgnoreWords', 'spellNavState', 'clearOnlineSpelling', 'applyLocalFirstUi', 'enforceLocalFirstSettings'):
    if forbidden in s:
        raise SystemExit(f'bootstrap cleanup left {forbidden}')
write(p, s)

# Strengthen the permanent guard to enforce physical removal, not only runtime disabling.
p = 'tools/check_local_first.py'
s = read(p)
s = s.replace("bootstrap = (js_dir / '12-bootstrap.js').read_text(encoding='utf-8')\n", "bootstrap = (js_dir / '12-bootstrap.js').read_text(encoding='utf-8')\nmain_activity = (root / 'app/src/main/java/ru/dzenprep/texteditor/MainActivity.java').read_text(encoding='utf-8')\nhtml = (www / 'index.html').read_text(encoding='utf-8')\n")
s = s.replace("require(\"settings.onlineSpelling=false\" in bootstrap, 'Bootstrap must force online spelling off')\nrequire(\"settings.dzenSmartRules=false\" in bootstrap, 'Bootstrap must force remote Dzen rules off')\n", "require('AndroidSpell' not in main_activity, 'Native AndroidSpell bridge must be physically removed')\nrequire('speller.yandex.net' not in main_activity, 'Yandex.Speller endpoint must be physically removed')\nrequire('HttpURLConnection' not in main_activity, 'Local-first MainActivity must not keep HTTP networking code')\nrequire('Яндекс.Спеллер' not in html, 'Yandex.Speller UI must be physically removed')\nrequire('onlineSpelling' not in all_js and 'onlineSpelling' not in html, 'Online spelling state/UI must be physically removed')\nrequire('dzenSmartRules' not in all_js and 'dzenSmartRules' not in html, 'Remote Dzen rules state/UI must be physically removed')\nrequire('raw.githubusercontent.com/Ayuemin/dzen-text/main/rules/dzen-rules.json' not in all_js, 'Runtime must not download Dzen rules')\n")
s = s.replace("require(\"spellStatus='off'\" in spelling, 'Manual full check must remain local-only')\n", '')
write(p, s)

print('Physical local-first cleanup applied')
