#!/usr/bin/env python3
from pathlib import Path


def rep(text, old, new, label, count=1):
    if old not in text:
        raise SystemExit(f"missing patch anchor: {label}")
    return text.replace(old, new, count)

html_path = Path('app/src/main/assets/www/index.html')
java_path = Path('app/src/main/java/ru/dzenprep/texteditor/MainActivity.java')
gradle_path = Path('app/build.gradle')
readme_path = Path('README.md')

h = html_path.read_text(encoding='utf-8')

h = h.replace('<title>Дзен Текст 1.6.1</title>', '<title>Дзен Текст 1.7.0</title>')

css_old = '.spellAttribution{font-size:12px;margin-top:8px}.spellAttribution a{color:var(--text);text-decoration:underline}.proofChip'
css_new = '.spellAttribution{font-size:12px;margin-top:8px}.spellAttribution a{color:var(--text);text-decoration:underline}.analysisExport{border-top:1px solid var(--border);margin-top:14px;padding-top:13px}.analysisExportTitle{font-weight:750;font-size:14px;margin-bottom:8px}.analysisExportActions{display:flex;gap:8px;flex-wrap:wrap}.analysisExportActions .nativeBtn{display:flex;align-items:center;gap:7px}.spellActions{margin-top:4px}.proofChip'
h = rep(h, css_old, css_new, 'export css')

spell_markup_old = '''      <div id="spellSuggestions" class="replaceChips"></div>\n      <div class="replaceNote">Нажмите на вариант, чтобы заменить выделенное слово.</div>'''
spell_markup_new = '''      <div id="spellSuggestions" class="replaceChips"></div>\n      <div class="settingActions spellActions"><button class="nativeBtn" type="button" onclick="ignoreCurrentSpellWord()">Не ошибка · запомнить</button></div>\n      <div class="replaceNote">Нажмите на вариант, чтобы заменить выделенное слово. Если слово правильное, «Не ошибка» добавит его в локальные исключения на этом устройстве.</div>'''
h = rep(h, spell_markup_old, spell_markup_new, 'spell ignore button')

settings_old = '''    <div class="smallNote">Онлайн-проверка по умолчанию выключена. Если включить её, текст отправляется в Яндекс.Спеллер только после нажатия кнопки ✓. Автоматический анализ после вставки и загрузки файла остаётся локальным.</div>\n    <div class="spellAttribution"><a href="https://yandex.ru/dev/speller/">Проверка правописания: Яндекс.Спеллер</a></div>'''
settings_new = '''    <div class="smallNote">Онлайн-проверка по умолчанию выключена. Если включить её, текст отправляется в Яндекс.Спеллер только после нажатия кнопки ✓. Автоматический анализ после вставки и загрузки файла остаётся локальным.</div>\n    <div id="spellIgnoreStatus" class="dictStatus">Мои правильные слова: 0</div>\n    <div class="settingActions"><button class="nativeBtn" type="button" onclick="clearSpellIgnoreWords()">Очистить исключения</button></div>\n    <div class="smallNote">Если Спеллер ошибочно считает правильное слово ошибкой, откройте замечание и нажмите «Не ошибка · запомнить». Слово останется только на устройстве.</div>\n    <div class="spellAttribution"><a href="https://yandex.ru/dev/speller/">Проверка правописания: Яндекс.Спеллер</a></div>'''
h = rep(h, settings_old, settings_new, 'spell ignore settings')

analysis_old = '''  <div id="analysisBody"><div id="analysisSummary" class="analysisSummary"></div><div id="analysisContent"></div></div>\n</div></div>'''
analysis_new = '''  <div id="analysisBody"><div id="analysisSummary" class="analysisSummary"></div><div id="analysisContent"></div></div>\n  <div class="analysisExport"><div class="analysisExportTitle">Выгрузить замечания</div><div class="analysisExportActions"><button class="nativeBtn" type="button" onclick="copyAnalysisReport()" aria-label="Скопировать замечания">⧉ В буфер</button><button class="nativeBtn" type="button" onclick="saveAnalysisReport()" aria-label="Сохранить замечания в файл">⇩ В файл</button></div><div class="smallNote">Отчёт содержит метки поиска, контекст и позиции замечаний — удобно передать его модели, которая будет править исходную статью.</div></div>\n</div></div>'''
h = rep(h, analysis_old, analysis_new, 'analysis export ui')

syn_anchor = "const USER_SYNONYMS_KEY='dzenUserSynonymsV1';\nlet userSynonyms=loadUserSynonyms();"
syn_insert = """const USER_SYNONYMS_KEY='dzenUserSynonymsV1';
let userSynonyms=loadUserSynonyms();
const SPELL_IGNORE_KEY='dzenSpellIgnoreV1';
let spellIgnoreWords=loadSpellIgnoreWords();
function spellKey(word){return String(word||'').trim().toLocaleLowerCase('ru-RU')}
function loadSpellIgnoreWords(){try{const a=JSON.parse(localStorage.getItem(SPELL_IGNORE_KEY)||'[]');return new Set(Array.isArray(a)?a.map(spellKey).filter(Boolean):[])}catch(e){return new Set()}}
function saveSpellIgnoreWords(){localStorage.setItem(SPELL_IGNORE_KEY,JSON.stringify([...spellIgnoreWords].sort()))}
function updateSpellIgnoreStatus(){const el=document.getElementById('spellIgnoreStatus');if(el)el.innerHTML=`Мои правильные слова: <b>${spellIgnoreWords.size}</b>`}
function clearSpellIgnoreWords(){if(!spellIgnoreWords.size){toast('Список исключений уже пуст');return}if(!confirm('Удалить все слова, отмеченные как правильные?'))return;spellIgnoreWords.clear();saveSpellIgnoreWords();updateSpellIgnoreStatus();clearOnlineSpelling();analyzeText();toast('Исключения орфографии очищены')}
"""
h = rep(h, syn_anchor, syn_insert, 'spell ignore storage')

old_dzen = """function dzenListHas(text,arr){for(const x of arr||[]){const q=String(x).toLocaleLowerCase('ru-RU').trim();if(q&&text.indexOf(q)>=0)return true}return false}
function dzenOccurrences(text,q,max=6){const out=[];if(!q)return out;let p=0;while(out.length<max&&(p=text.indexOf(q,p))>=0){out.push(p);p+=Math.max(1,q.length)}return out}
"""
new_dzen = """function dzenWordChar(c){return !!c&&/[A-Za-zА-Яа-яЁё0-9_]/.test(c)}
function dzenOccurrences(text,q,max=6,mode='any'){const out=[];if(!q)return out;let p=0;const firstWord=dzenWordChar(q[0]),lastWord=dzenWordChar(q[q.length-1]);while(out.length<max&&(p=text.indexOf(q,p))>=0){const before=text[p-1],after=text[p+q.length];let ok=true;if(mode==='phrase'){if(firstWord&&dzenWordChar(before))ok=false;if(lastWord&&dzenWordChar(after))ok=false}else if(mode==='stem'){if(firstWord&&dzenWordChar(before))ok=false}if(ok)out.push(p);p+=Math.max(1,q.length)}return out}
function dzenListHas(text,arr){for(const x of arr||[]){const q=String(x).toLocaleLowerCase('ru-RU').trim();if(q&&dzenOccurrences(text,q,1,'phrase').length)return true}return false}
"""
h = rep(h, old_dzen, new_dzen, 'dzen boundary helpers')
h = rep(h, "dzenOccurrences(lower,ph,4)", "dzenOccurrences(lower,ph,4,'phrase')", 'dzen phrase boundaries')
h = rep(h, "dzenOccurrences(lower,st,5)", "dzenOccurrences(lower,st,5,'stem')", 'dzen stem boundaries')

spell_result_old = """onlineSpellIssues=(Array.isArray(items)?items:[]).map(x=>({start:+x.start||0,end:+x.end||0,word:String(x.word||''),suggestions:Array.isArray(x.suggestions)?x.suggestions.map(String):[],code:+x.code||0})).filter(x=>x.end>x.start);"""
spell_result_new = """onlineSpellIssues=(Array.isArray(items)?items:[]).map(x=>({start:+x.start||0,end:+x.end||0,word:String(x.word||''),suggestions:Array.isArray(x.suggestions)?x.suggestions.map(String):[],code:+x.code||0})).filter(x=>x.end>x.start&&!spellIgnoreWords.has(spellKey(x.word||editor.value.slice(x.start,x.end))));"""
h = rep(h, spell_result_old, spell_result_new, 'filter ignored spell words')

apply_spell_anchor = """function applySpellSuggestion(text){if(!spellNavState||!text)return;const it=spellNavState.issues[spellNavState.index],before=editor.value.slice(it.start,it.end),repl=preserveCase(before,String(text)),delta=repl.length-(it.end-it.start);editor.setRangeText(repl,it.start,it.end,'select');onlineSpellIssues=onlineSpellIssues.filter(x=>!(x.start===it.start&&x.end===it.end)).map(x=>x.start>it.start?{...x,start:x.start+delta,end:x.end+delta}:x);onlineSpellSource=editor.value;spellStatus='done';spellNavState=null;document.getElementById('spellPanel').classList.remove('open');render(true);toast(`Исправлено: ${before} → ${repl}`);const next=currentAnalysis.issues.find(x=>x.type==='spelling');if(next)openSpellIssue(currentAnalysis.issues.indexOf(next))}
"""
apply_spell_new = apply_spell_anchor + """function ignoreCurrentSpellWord(){if(!spellNavState||!spellNavState.issues.length)return;const it=spellNavState.issues[spellNavState.index],word=editor.value.slice(it.start,it.end)||it.word,key=spellKey(word);if(!key)return;spellIgnoreWords.add(key);saveSpellIgnoreWords();updateSpellIgnoreStatus();onlineSpellIssues=onlineSpellIssues.filter(x=>spellKey(x.word||editor.value.slice(x.start,x.end))!==key);onlineSpellSource=editor.value;spellStatus='done';spellNavState=null;document.getElementById('spellPanel').classList.remove('open');analyzeText();toast(`Запомнил: «${word}» — не ошибка`);const next=currentAnalysis.issues.find(x=>x.type==='spelling');if(next)openSpellIssue(currentAnalysis.issues.indexOf(next))}
"""
h = rep(h, apply_spell_anchor, apply_spell_new, 'ignore current spell word')

sync_old = "updateSettingLabels();updateDzenRulesStatus()}"
sync_new = "updateSettingLabels();updateDzenRulesStatus();updateSpellIgnoreStatus()}"
h = rep(h, sync_old, sync_new, 'settings spell status')

export_anchor = """function renderDzenManual(){const items=(activeDzenRules().manual_checks||[]).map(x=>`<li>${escapeHtml(String(x))}</li>`).join('');return `<div class=\"analysisDzenNote\"><b>Что приложение не может подтвердить автоматически</b><ul class=\"manualChecklist\">${items}</ul></div>`}
"""
export_funcs = export_anchor + r'''function reportTypeName(type){const g=issueGroups().find(x=>x.id===type);return g?g.name:String(type||'Замечание')}
function cleanReportText(s){return String(s||'').replace(/\s+/g,' ').trim()}
function buildAnalysisReport(){analyzeText();const src=editor.value||'',a=currentAnalysis,lines=[];lines.push('ОТЧЁТ «ДЗЕН ТЕКСТ» ПО РЕДАКТОРСКОЙ ПРОВЕРКЕ');lines.push(`Создан: ${new Date().toLocaleString('ru-RU')}`);lines.push(`Всего замечаний: ${a.warningCount||0}; редакторских: ${a.editorCount||0}; правила Дзена: ${a.dzenCount||0}; орфография: ${a.spellCount||0}.`);lines.push(`База правил Дзена: ${String(activeDzenRules().version||'встроенная')}.`);lines.push('');lines.push('Инструкция для модели: исправляйте только отмеченные места, сверяясь с «Меткой поиска» и контекстом. Не меняйте смысл и структуру статьи без необходимости. Сигналы «Правила Дзена» означают повод проверить формулировку, а не установленное нарушение.');lines.push('');if(!a.issues.length){lines.push('Замечаний не найдено.');return lines.join('\n')}a.issues.forEach((i,n)=>{const start=Number.isFinite(i.start)?i.start:0,end=Number.isFinite(i.end)?i.end:start;let marker=cleanReportText(src.slice(start,end));if(!marker)marker=cleanReportText(i.word||i.title);let context=shortContext(src,start,end);lines.push(`${n+1}. [${reportTypeName(i.type)}] ${cleanReportText(i.title)}`);lines.push(`Метка поиска: «${marker}»`);if(context)lines.push(`Контекст: ${context}`);lines.push(`Позиция: символы ${start+1}–${Math.max(start+1,end)}`);if(Array.isArray(i.occurrences)&&i.occurrences.length>1)lines.push(`Совпадения: ${i.occurrences.slice(0,12).map(o=>(Number(o.start)||0)+1).join(', ')}${i.occurrences.length>12?' …':''}`);if(i.detail)lines.push(`Комментарий: ${cleanReportText(i.detail)}`);if(i.type==='dzen')lines.push(`Уровень: ${i.severity==='critical'?'высокий риск — проверить':'проверить вручную'}`);lines.push('')});return lines.join('\n')}
function copyPlainReport(text){const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-10000px';document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy')}catch(e){}ta.remove();return ok}
function copyAnalysisReport(){const text=buildAnalysisReport();if(copyPlainReport(text))toast('Отчёт с замечаниями скопирован');else toast('Не удалось скопировать отчёт')}
function saveAnalysisReport(){const text=buildAnalysisReport(),name=`Dzen-Text-report-${new Date().toISOString().slice(0,10)}.txt`;if(window.AndroidFile&&typeof AndroidFile.saveReport==='function'){AndroidFile.saveReport(text,name);return}try{const blob=new Blob([text],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1200);toast('Отчёт сохранён')}catch(e){toast('Не удалось сохранить отчёт')}}
window.onNativeReportSaved=(name)=>toast(`Отчёт сохранён${name?': '+name:''}`);window.onNativeReportError=(msg)=>toast(msg||'Не удалось сохранить отчёт');
'''
h = rep(h, export_anchor, export_funcs, 'analysis report functions')

startup_old = "syncSettingsUI();updateUserSynonymStatus();updateDzenRulesStatus();render();"
startup_new = "syncSettingsUI();updateUserSynonymStatus();updateDzenRulesStatus();updateSpellIgnoreStatus();render();"
h = rep(h, startup_old, startup_new, 'startup spell ignore status')

html_path.write_text(h, encoding='utf-8')

j = java_path.read_text(encoding='utf-8')
j = rep(j, 'private static final int REQUEST_OPEN_DICTIONARY = 1908;', 'private static final int REQUEST_OPEN_DICTIONARY = 1908;\n    private static final int REQUEST_SAVE_REPORT = 1909;', 'save report request code')
j = rep(j, 'private volatile String bundledDictionaryError = "";', 'private volatile String bundledDictionaryError = "";\n    private volatile String pendingReportText = "";', 'pending report field')
bridge_anchor = '''        }\n    }\n\n    public class SpellBridge {'''
bridge_new = '''        }\n\n        @JavascriptInterface\n        public void saveReport(final String text, final String fileName) {\n            runOnUiThread(() -> {\n                pendingReportText = text == null ? "" : text;\n                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);\n                intent.addCategory(Intent.CATEGORY_OPENABLE);\n                intent.setType("text/plain");\n                intent.putExtra(Intent.EXTRA_TITLE, (fileName == null || fileName.trim().isEmpty()) ? "Dzen-Text-report.txt" : fileName);\n                try {\n                    startActivityForResult(intent, REQUEST_SAVE_REPORT);\n                } catch (Exception e) {\n                    runJs("window.onNativeReportError && window.onNativeReportError('Не удалось открыть сохранение файла')");\n                }\n            });\n        }\n    }\n\n    public class SpellBridge {'''
j = rep(j, bridge_anchor, bridge_new, 'FileBridge saveReport')
result_anchor = '''        Uri uri = data.getData();\n        if (uri == null) return;\n\n        if (requestCode == REQUEST_OPEN_TEXT) {'''
result_new = '''        Uri uri = data.getData();\n        if (uri == null) return;\n\n        if (requestCode == REQUEST_SAVE_REPORT) {\n            try (OutputStream out = getContentResolver().openOutputStream(uri)) {\n                if (out == null) throw new Exception("stream");\n                out.write(pendingReportText.getBytes(StandardCharsets.UTF_8));\n                out.flush();\n                runJs("window.onNativeReportSaved && window.onNativeReportSaved('TXT')");\n            } catch (Exception e) {\n                runJs("window.onNativeReportError && window.onNativeReportError('Не удалось сохранить отчёт')");\n            } finally {\n                pendingReportText = "";\n            }\n            return;\n        }\n\n        if (requestCode == REQUEST_OPEN_TEXT) {'''
j = rep(j, result_anchor, result_new, 'save report result')
j = j.replace('Dzen-Text/1.5.0 Android', 'Dzen-Text/1.7.0 Android')
java_path.write_text(j, encoding='utf-8')

g = gradle_path.read_text(encoding='utf-8')
g = rep(g, 'versionCode 25', 'versionCode 26', 'version code')
g = rep(g, "versionName '1.6.1'", "versionName '1.7.0'", 'version name')
gradle_path.write_text(g, encoding='utf-8')

r = readme_path.read_text(encoding='utf-8')
section = '''\n\n## Новое в 1.7.0\n\n- Выгрузка всех замечаний редакторского анализа в буфер обмена или TXT-файл. Отчёт содержит точные метки поиска, контекст и позиции в исходной статье — его удобно передавать модели для точечной правки.\n- Для ложных срабатываний Яндекс.Спеллера появилась команда «Не ошибка · запомнить». Такие слова хранятся только на устройстве и больше не попадают в орфографические замечания; список можно очистить в настройках.\n- Проверка правил Дзена теперь учитывает границы слов: короткая самостоятельная фраза вроде «ню» больше не срабатывает внутри обычного слова вроде «дню». Тематические основы ищутся только от начала слова, что уменьшает ложные совпадения.\n'''
if '## Новое в 1.7.0' not in r:
    r = r.rstrip() + section
readme_path.write_text(r, encoding='utf-8')

# Static guards for the most important regression fixes.
out = html_path.read_text(encoding='utf-8')
for needle in [
    "dzenOccurrences(lower,ph,4,'phrase')",
    "dzenOccurrences(lower,st,5,'stem')",
    "Не ошибка · запомнить",
    "buildAnalysisReport()",
    "SPELL_IGNORE_KEY",
]:
    if needle not in out:
        raise SystemExit(f'missing expected result: {needle}')
print('v1.7.0 patch applied')
