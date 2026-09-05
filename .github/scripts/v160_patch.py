from pathlib import Path
import json


def rep(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Patch marker not found: {label}")
    return text.replace(old, new, 1)

# Version bump.
gradle_path = Path('app/build.gradle')
gradle = gradle_path.read_text(encoding='utf-8')
gradle = rep(gradle, 'versionCode 23', 'versionCode 24', 'versionCode')
gradle = rep(gradle, "versionName '1.5.2'", "versionName '1.6.0'", 'versionName')
gradle_path.write_text(gradle, encoding='utf-8')

rules = json.loads(Path('rules/dzen-rules.json').read_text(encoding='utf-8'))
if rules.get('schema') != 2:
    raise SystemExit('rules/dzen-rules.json must be schema 2 before building v1.6.0')
embedded_rules = json.dumps(rules, ensure_ascii=False, separators=(',', ':'))

html_path = Path('app/src/main/assets/www/index.html')
html = html_path.read_text(encoding='utf-8')
html = rep(html, '<title>Дзен Текст 1.5.2</title>', '<title>Дзен Текст 1.6.0</title>', 'html title')

# Explain and expose the smart rules database as an explicit, disableable feature.
old_dzen_row = '''    <div class="switchRow"><span>Проверять возможные риски</span><input id="dzenCheck" class="switch" type="checkbox" onchange="applySettings()"></div>'''
new_dzen_row = '''    <div class="switchRow"><span>Проверять возможные риски</span><input id="dzenCheck" class="switch" type="checkbox" onchange="applySettings()"></div>
    <div class="switchRow" style="margin-top:13px"><span>Использовать обновляемую ИИ-базу</span><input id="dzenSmartRules" class="switch" type="checkbox" onchange="applySettings()"></div>'''
html = rep(html, old_dzen_row, new_dzen_row, 'Dzen smart rules switch')
html = rep(
    html,
    '    <div class="smallNote">Это предварительная эвристическая проверка. Она не заменяет модерацию Дзена и не объявляет совпадение нарушением.</div>',
    '    <div class="smallNote">Это предварительная локальная проверка. Обновляемая база строится на GitHub Actions из официальных правил Дзена с помощью OpenRouter. Текст вашей статьи в OpenRouter не отправляется.</div>',
    'Dzen privacy note',
)
html = rep(html, 'onclick="updateDzenRulesFromGitHub()">Проверить обновление</button>', 'onclick="updateDzenRulesFromGitHub()">Обновить умную базу</button>', 'Dzen update button')
html = rep(
    html,
    '    <div class="smallNote">Обновление загружается только по кнопке с GitHub-репозитория dzen-text. Встроенная база работает офлайн.</div>',
    '    <div class="smallNote">Источник истины — официальная справка Дзена. Приложение получает с GitHub только уже обработанную компактную базу. Функцию можно отключить выше; встроенная база всегда остаётся офлайн.</div>',
    'Dzen source note',
)

html = rep(html, 'dzenCheck:true,riskCheck:true', 'dzenCheck:true,dzenSmartRules:true,riskCheck:true', 'default smart rules setting')
html = rep(html, 'dzenCheck.checked=settings.dzenCheck;riskCheck.checked=', 'dzenCheck.checked=settings.dzenCheck;dzenSmartRules.checked=settings.dzenSmartRules!==false;riskCheck.checked=', 'sync smart rules setting')
html = rep(html, 'dzenCheck:dzenCheck.checked,riskCheck:riskCheck.checked', 'dzenCheck:dzenCheck.checked,dzenSmartRules:dzenSmartRules.checked,riskCheck:riskCheck.checked', 'save smart rules setting')

# Replace rules loader with schema-2 aware implementation. The Android app never calls OpenRouter.
start = html.index("const DZEN_RULES_URL=")
end = html.index("function loadSettings()", start)
new_rules_block = f'''const DZEN_RULES_URL='https://raw.githubusercontent.com/Ayuemin/dzen-text/main/rules/dzen-rules.json';
const DZEN_RULES_KEY='dzenRulesV2';
const DEFAULT_DZEN_RULES={embedded_rules};
let dzenRulesFromCache=false;
let dzenRules=loadDzenRules();
function validDzenRules(o){{const s=Number(o&&o.schema);if(!o||!Array.isArray(o.manual_checks))return false;if(s===2)return Array.isArray(o.categories)&&o.categories.length>=3;if(s===1)return Array.isArray(o.clickbait_phrases);return false}}
function activeDzenRules(){{return settings&&settings.dzenSmartRules===false?DEFAULT_DZEN_RULES:dzenRules}}
function loadDzenRules(){{try{{const raw=localStorage.getItem(DZEN_RULES_KEY);if(raw){{const o=JSON.parse(raw);if(validDzenRules(o)){{dzenRulesFromCache=true;return o}}}}}}catch(e){{}}return DEFAULT_DZEN_RULES}}
function updateDzenRulesStatus(){{const el=document.getElementById('dzenRulesStatus');if(!el)return;const enabled=settings.dzenSmartRules!==false,r=activeDzenRules(),g=r.generator||{{}},model=g.model&&g.model!=='none'?` · ИИ: ${{escapeHtml(String(g.model))}}`:'';el.innerHTML=`Умная база: <b>${{enabled?'включена':'выключена'}}</b><br>Версия: <b>${{escapeHtml(String(r.version||'встроенная'))}}</b> · ${{enabled&&dzenRulesFromCache?'обновлённая':'встроенная'}}<br>Источник: официальная справка Дзена · проверен ${{escapeHtml(String(r.source_checked||'—'))}}${{model}}`}}
async function updateDzenRulesFromGitHub(){{if(settings.dzenSmartRules===false){{updateDzenRulesStatus();toast('Обновляемая ИИ-база отключена в настройках');return}}const el=document.getElementById('dzenRulesStatus');if(el)el.textContent='Проверяю обновление умной базы…';try{{const r=await fetch(DZEN_RULES_URL+'?t='+Date.now(),{{cache:'no-store'}});if(!r.ok)throw new Error('HTTP '+r.status);const o=await r.json();if(!validDzenRules(o))throw new Error('Некорректный формат');localStorage.setItem(DZEN_RULES_KEY,JSON.stringify(o));dzenRules=o;dzenRulesFromCache=true;updateDzenRulesStatus();render();toast(`База правил Дзена обновлена: ${{o.version||'новая версия'}}`)}}catch(e){{updateDzenRulesStatus();toast('Не удалось обновить базу. Встроенная версия продолжает работать')}}}}
function resetDzenRules(){{localStorage.removeItem(DZEN_RULES_KEY);dzenRules=DEFAULT_DZEN_RULES;dzenRulesFromCache=false;updateDzenRulesStatus();render();toast('Восстановлена встроенная база правил Дзена')}}
'''
html = html[:start] + new_rules_block + html[end:]

# Context-aware schema 2 analyzer. It uses only local strings from dzen-rules.json.
start = html.index('function analyzeDzenRules(')
end = html.index('\nfunction analyzeProofLocal', start)
new_analyzer = r'''function dzenListHas(text,arr){for(const x of arr||[]){const q=String(x).toLocaleLowerCase('ru-RU').trim();if(q&&text.indexOf(q)>=0)return true}return false}
function dzenOccurrences(text,q,max=6){const out=[];if(!q)return out;let p=0;while(out.length<max&&(p=text.indexOf(q,p))>=0){out.push(p);p+=Math.max(1,q.length)}return out}
function analyzeDzenSchema2(src,headings,issues,r,titleObj){const title=titleObj?titleObj.text:'',categories=Array.isArray(r.categories)?r.categories:[];let total=0;for(const cat of categories){if(total>=20)break;const scope=cat.scope||'all';if(scope==='title'&&!titleObj)continue;const source=scope==='title'?title:src,base=scope==='title'?titleObj.start:0,lower=source.toLocaleLowerCase('ru-RU');const candidates=[];const seen=new Set();for(const ph0 of cat.phrases||[]){const ph=String(ph0).toLocaleLowerCase('ru-RU').trim();for(const at of dzenOccurrences(lower,ph,4)){const k=at+':'+ph.length;if(!seen.has(k)){seen.add(k);candidates.push({at,len:ph.length,label:ph,score:3})}}}for(const st0 of cat.stems||[]){const st=String(st0).toLocaleLowerCase('ru-RU').trim();for(const at of dzenOccurrences(lower,st,5)){const k=at+':'+st.length;if(!seen.has(k)){seen.add(k);candidates.push({at,len:st.length,label:st,score:1})}}}candidates.sort((a,b)=>a.at-b.at);let shown=0;for(const c of candidates){if(shown>=4||total>=20)break;const ws=Math.max(0,c.at-220),we=Math.min(lower.length,c.at+c.len+220),windowText=lower.slice(ws,we);let score=c.score;if(dzenListHas(windowText,cat.action_words))score++;if(dzenListHas(windowText,cat.context_words))score++;if(dzenListHas(windowText,cat.exclude_words))score-=2;const minScore=Math.max(1,Number(cat.min_score)||2);if(score<minScore)continue;const severity=cat.severity==='critical'?'critical':'warning',detail=`Сигнал «${c.label}». ${String(cat.explanation||'Проверьте фрагмент в контексте правил Дзена.')}`;addSimpleIssue(issues,'dzen',String(cat.title||'Возможный риск по правилам Дзена'),detail,base+c.at,base+c.at+c.len,severity);shown++;total++}}}
function analyzeDzenLegacy(src,issues,r){const lower=src.toLocaleLowerCase('ru-RU');const addPhraseList=(arr,titleText,severity='warning')=>{let shown=0;for(const ph of arr||[]){const q=String(ph).toLocaleLowerCase('ru-RU'),at=lower.indexOf(q);if(at>=0){addSimpleIssue(issues,'dzen',titleText,`Найдена фраза «${ph}». Оцените её в контексте`,at,at+q.length,severity);if(++shown>=4)break}}};addPhraseList(r.dangerous_phrases,'Опасная или незаконная тематика — проверить контекст','critical');addPhraseList(r.medical_claim_phrases,'Категоричное медицинское утверждение — проверить','warning');let prof=0;for(const stem of r.profanity_stems||[]){const at=lower.indexOf(String(stem).toLocaleLowerCase('ru-RU'));if(at>=0){addSimpleIssue(issues,'dzen','Возможная ненормативная лексика','Проверьте фрагмент в контексте',at,Math.min(src.length,at+String(stem).length),'critical');if(++prof>=3)break}}}
function analyzeDzenRules(src,headings,issues){const r=activeDzenRules(),titleObj=headings.find(h=>h.level===1),title=titleObj?titleObj.text:'';const titleLimit=Number(r.article_title_max_chars||0);if(titleObj&&titleLimit>0&&title.length>titleLimit)addSimpleIssue(issues,'dzen',`Заголовок длиннее ${titleLimit} знаков`,`${title.length} знаков — проверьте актуальный лимит Дзена`,titleObj.start,titleObj.end,'critical');if(titleObj){const letters=Array.from(title).filter(c=>/[A-Za-zА-Яа-яЁё]/.test(c));const upp=letters.filter(c=>c===c.toUpperCase()&&c!==c.toLowerCase()).length;if(letters.length>=10&&upp/letters.length>.55)addSimpleIssue(issues,'dzen','Много ЗАГЛАВНЫХ букв в заголовке','Проверьте, не выглядит ли оформление агрессивным или вводящим в заблуждение',titleObj.start,titleObj.end);if(/[!?]{2,}/.test(title))addSimpleIssue(issues,'dzen','Повторяющиеся !/? в заголовке','Проверьте, не создаёт ли оформление ложного ожидания',titleObj.start,titleObj.end)}if(Number(r.schema)===2)analyzeDzenSchema2(src,headings,issues,r,titleObj);else analyzeDzenLegacy(src,issues,r);const urls=Array.from(src.matchAll(/https?:\/\/[^\s)]+/g));if(urls.length>10)addSimpleIssue(issues,'dzen','Много ссылок в публикации',`${urls.length} ссылок — проверьте, не выглядит ли материал как ссылочный спам`,urls[10].index,urls[10].index+urls[10][0].length);const um=new Map();for(const u of urls){const k=u[0].replace(/[.,!?]+$/,'');let v=um.get(k)||{count:0,start:u.index,end:u.index+u[0].length};v.count++;um.set(k,v)}for(const [url,v] of um){if(v.count>=3){addSimpleIssue(issues,'dzen','Одна и та же ссылка повторяется',`${v.count} повторов одного URL`,v.start,v.end);break}}}'''
html = html[:start] + new_analyzer + html[end:]

# Manual-check and Dzen-only views must honor the disableable smart database.
html = rep(html, "function renderDzenManual(){const items=(dzenRules.manual_checks||[])", "function renderDzenManual(){const items=(activeDzenRules().manual_checks||[])", 'active Dzen manual checklist')
html = rep(html, "База правил: <b>${escapeHtml(String(dzenRules.version||'встроенная'))}</b>.", "База правил: <b>${escapeHtml(String(activeDzenRules().version||'встроенная'))}</b>.", 'active Dzen version in analysis')

html_path.write_text(html, encoding='utf-8')

# README: explain the privacy boundary and server-side generation.
readme_path = Path('README.md')
readme = readme_path.read_text(encoding='utf-8')
readme = rep(readme, 'Текущая версия: **v1.5.2**.', 'Текущая версия: **v1.6.0**.', 'README version')
old = '''База правил встроена в приложение и работает офлайн. Её можно вручную обновить из репозитория без установки новой APK.'''
new = '''База правил встроена в приложение и работает офлайн. Начиная с v1.6.0 используется контекстная schema 2: кроме фраз и основ слов она учитывает слова действия, усиливающий контекст и исключения, поэтому одно тематическое слово само по себе реже превращается в ложное предупреждение.

Обновляемая база строится на GitHub Actions. Workflow скачивает **официальную страницу правил Дзена**, и только если её нормализованный текст изменился, передаёт этот официальный текст в OpenRouter для преобразования в компактный JSON. Статьи пользователей в OpenRouter не отправляются. В приложении эту обновляемую ИИ-базу можно полностью отключить — тогда используется встроенная офлайн-версия.'''
readme = rep(readme, old, new, 'README smart Dzen rules section')
readme = rep(readme, '- обновление базы правил Дзена с GitHub;', '- скачивание готовой базы правил Дзена с GitHub; сама база строится на GitHub Actions из официальных правил, без передачи пользовательских статей в OpenRouter;', 'README privacy rules bullet')
readme = rep(readme, '- `Release APK` — при публикации тега `v*` собирает подписанный APK и создаёт GitHub Release.', '- `Release APK` — при публикации тега `v*` собирает подписанный APK и создаёт GitHub Release;\n- `Update Dzen rules database` — раз в сутки проверяет официальный источник и вызывает OpenRouter только при изменении официального текста.', 'README actions')
readme_path.write_text(readme, encoding='utf-8')
