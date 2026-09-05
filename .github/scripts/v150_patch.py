from pathlib import Path


def rep(s, old, new, label):
    if old not in s:
        raise SystemExit(f'Patch anchor not found: {label}')
    return s.replace(old, new, 1)

# ---- Web UI / JS ----
p = Path('app/src/main/assets/www/index.html')
s = p.read_text(encoding='utf-8')
s = rep(s, '<title>Дзен Текст 1.4.1</title>', '<title>Дзен Текст 1.5.0</title>', 'title')

s = rep(s,
    '.bottom{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;',
    '.bottom{display:grid;grid-template-columns:auto 1fr auto auto auto;align-items:center;',
    'bottom columns')
s = rep(s,
    '@media(max-width:430px){.bottom{grid-template-columns:auto 1fr auto auto}',
    '@media(max-width:430px){.bottom{grid-template-columns:auto 1fr auto auto auto}',
    'mobile bottom columns')

css_anchor = '.analysisDot.bad span{background:#d64545;box-shadow:0 0 0 4px rgba(214,69,69,.12)}'
css_new = css_anchor + '.analysisDot.stale span{background:#8b9097;box-shadow:0 0 0 4px rgba(139,144,151,.12)}.checkAction.running{opacity:.55;pointer-events:none}.spellAttribution{font-size:12px;margin-top:8px}.spellAttribution a{color:var(--text);text-decoration:underline}.proofChip{border:1px solid var(--border);background:var(--surface2);color:var(--text);border-radius:999px;padding:8px 12px;font-size:14px;white-space:nowrap}'
s = rep(s, css_anchor, css_new, 'proof css')

repeat_panel_anchor = '''    <div id="repeatNavPanel" class="repeatNavPanel" aria-live="polite">
      <div class="repeatNavHead"><div class="repeatNavTitle"><b id="repeatNavTitle">Повтор</b><div id="repeatNavCount"></div></div><button id="repeatNavPrev" class="miniIcon" onclick="navigateRepeatOccurrence(-1)" aria-label="Предыдущее совпадение">‹</button><button id="repeatNavNext" class="miniIcon" onclick="navigateRepeatOccurrence(1)" aria-label="Следующее совпадение">›</button><button class="miniIcon" onclick="closeRepeatNavigator()" aria-label="Закрыть">×</button></div>
      <button id="repeatNavContext" class="repeatNavContext" type="button" onclick="jumpRepeatOccurrence()"></button>
      <div class="repeatNavMeta">Листайте совпадения стрелками. Нажмите на фрагмент, чтобы перейти к нему в редакторе.</div>
    </div>'''
spell_panel = repeat_panel_anchor + '''
    <div id="spellPanel" class="replacePanel" aria-live="polite">
      <div class="replaceHead"><div class="replaceTitle">Орфография: <b id="spellWord">—</b><div id="spellCount"></div></div><button id="spellPrev" class="miniIcon" onclick="navigateSpellIssue(-1)" aria-label="Предыдущая ошибка">‹</button><button id="spellNext" class="miniIcon" onclick="navigateSpellIssue(1)" aria-label="Следующая ошибка">›</button><button class="miniIcon" onclick="closeSpellPanel()" aria-label="Закрыть">×</button></div>
      <div id="spellSuggestions" class="replaceChips"></div>
      <div class="replaceNote">Нажмите на вариант, чтобы заменить выделенное слово.</div>
      <div class="spellAttribution"><a href="https://yandex.ru/dev/speller/">Проверка правописания: Яндекс.Спеллер</a></div>
    </div>'''
s = rep(s, repeat_panel_anchor, spell_panel, 'spell panel')

bottom_anchor = '''    <button class="analysisDot" id="analysisDot" onclick="openAnalysis()" aria-label="Редакторский анализ"><span></span></button>'''
check_button = '''    <button class="gear checkAction" id="checkBtn" onclick="runFullCheck()" aria-label="Проверить текст" title="Проверить текст"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h8M4 12h5M4 18h7"/><path d="m14 15 2.5 2.5L21 12"/></svg></button>
''' + bottom_anchor
s = rep(s, bottom_anchor, check_button, 'check button')

settings_anchor = '''  <div class="setting"><details><summary>Правила Дзена</summary>'''
proof_settings = '''  <div class="setting"><details><summary>Проверка текста</summary>
    <div class="switchRow"><span>Локальные опечатки и пунктуация</span><input id="proofCheck" class="switch" type="checkbox" onchange="applySettings()"></div>
    <div class="switchRow" style="margin-top:13px"><span>Онлайн-проверка орфографии</span><input id="onlineSpelling" class="switch" type="checkbox" onchange="applySettings()"></div>
    <div class="smallNote">Онлайн-проверка по умолчанию выключена. Если включить её, текст отправляется в Яндекс.Спеллер только после нажатия кнопки ✓. Автоматический анализ после вставки и загрузки файла остаётся локальным.</div>
    <div class="spellAttribution"><a href="https://yandex.ru/dev/speller/">Проверка правописания: Яндекс.Спеллер</a></div>
  </details></div>
''' + settings_anchor
s = rep(s, settings_anchor, proof_settings, 'proof settings')

old_defaults = "const defaultSettings={font:'system',size:18,line:1.65,theme:'system',wpm:200,tts:1.0,autosave:true,showCode:false,headingCheck:true,headingMin:8,headingMax:80,sentenceCheck:true,sentenceMax:30,paragraphCheck:true,paragraphMax:650,frequentCheck:true,frequentMin:8,nearbyCheck:true,structureCheck:true,structureMax:1800,phraseCheck:true,openingCheck:true,headingStructureCheck:true,markdownCheck:true,dzenCheck:true,riskCheck:true,riskWords:exampleRiskWords};"
new_defaults = "const defaultSettings={font:'system',size:18,line:1.65,theme:'system',wpm:200,tts:1.0,autosave:true,showCode:false,headingCheck:true,headingMin:8,headingMax:80,sentenceCheck:true,sentenceMax:30,paragraphCheck:true,paragraphMax:650,frequentCheck:true,frequentMin:8,nearbyCheck:true,structureCheck:true,structureMax:1800,phraseCheck:true,openingCheck:true,headingStructureCheck:true,markdownCheck:true,proofCheck:true,onlineSpelling:false,dzenCheck:true,riskCheck:true,riskWords:exampleRiskWords};"
s = rep(s, old_defaults, new_defaults, 'default settings')

state_anchor = "let settings=loadSettings(); let speaking=false; let saveTimer=null; let currentAnalysis={issues:[],warningCount:0,metrics:{}};"
state_new = state_anchor + "\nlet onlineSpellIssues=[],onlineSpellSource='',spellStatus='idle',spellRequestId='',spellNavState=null,inputWasPaste=false;"
s = rep(s, state_anchor, state_new, 'spell state')

# Local proofreading helpers before analyzeText.
analyze_anchor = 'function analyzeText(){const src=editor.value||\'\', issues=[], headings=headingsFromSource(src), sentences=sentenceObjects(src), paragraphs=paragraphObjects(src), allWords=wordMatches(src), totalWords=allWords.length;'
proof_helpers = r'''function analyzeProofLocal(src,issues){
 const add=(title,detail,start,end,replacement='')=>{addIssue(issues,'proof',title,detail,start,end);if(replacement)issues[issues.length-1].replacement=replacement};
 let m;
 const double=/[^\n ] {2,}(?=\S)/g;while((m=double.exec(src))){const st=m.index+1,en=m.index+m[0].length;add('Несколько пробелов подряд','Оставьте один пробел',st,en,' ')}
 const before=/\s+[,:;!?]/g;while((m=before.exec(src))){const punct=m[0].slice(-1),st=m.index,en=m.index+m[0].length;add('Пробел перед знаком препинания',`Перед «${punct}» пробел обычно не нужен`,st,en,punct)}
 const after=/[,:;!?](?=[A-Za-zА-Яа-яЁё])/g;while((m=after.exec(src))){const st=m.index,en=st+1;add('Нет пробела после знака препинания','Проверьте границу слов',st,en,m[0]+' ')}
 const dup=/\b([A-Za-zА-Яа-яЁё]{2,})\s+\1\b/giu;while((m=dup.exec(src))){const second=m.index+m[0].lastIndexOf(m[1]);add(`Повтор слова: «${m[1]}»`,'Два одинаковых слова подряд',second,second+m[1].length,'')}
 const punct=/([!?;,])\1+/g;while((m=punct.exec(src)))add('Повторяющийся знак препинания',`Найдено «${m[0]}»`,m.index,m.index+m[0].length,m[1]);
 const words=/[A-Za-zА-Яа-яЁё]+/g;while((m=words.exec(src))){if(/[A-Za-z]/.test(m[0])&&/[А-Яа-яЁё]/.test(m[0]))add('Смешаны кириллица и латиница',`Проверьте слово «${m[0]}»`,m.index,m.index+m[0].length)}
}
function clearOnlineSpelling(){onlineSpellIssues=[];onlineSpellSource='';spellStatus=settings.onlineSpelling?'idle':'off';spellRequestId='';closeSpellPanel()}
function setCheckRunning(v){const b=document.getElementById('checkBtn');if(!b)return;b.classList.toggle('running',!!v);b.setAttribute('aria-busy',v?'true':'false')}
function markAnalysisStale(){const dot=document.getElementById('analysisDot');dot.classList.remove('bad');dot.classList.add('stale');dot.setAttribute('aria-label','Текст изменён — нажмите Проверить');dot.title='Текст изменён — нажмите ✓ для полной проверки'}
'''
s = rep(s, analyze_anchor, proof_helpers + analyze_anchor, 'proof helpers')

# Inject local + cached online spelling into analysis.
markdown_call = " if(settings.markdownCheck)analyzeMarkdown(src,issues);\n if(settings.dzenCheck)analyzeDzenRules(src,headings,issues);"
markdown_new = " if(settings.markdownCheck)analyzeMarkdown(src,issues);\n if(settings.proofCheck)analyzeProofLocal(src,issues);\n if(onlineSpellSource===src&&onlineSpellIssues.length){for(const x of onlineSpellIssues){const it={type:'spelling',title:`Орфография: «${x.word||src.slice(x.start,x.end)}»`,detail:(x.suggestions&&x.suggestions.length)?`Варианты: ${x.suggestions.slice(0,3).join(', ')}`:'Яндекс.Спеллер не предложил замену',start:x.start,end:x.end,severity:'warning',word:x.word||'',suggestions:x.suggestions||[]};issues.push(it)}}\n if(settings.dzenCheck)analyzeDzenRules(src,headings,issues);"
s = rep(s, markdown_call, markdown_new, 'proof analysis merge')

old_counts = " const warningCount=issues.length,dzenCount=issues.filter(x=>x.type==='dzen').length,editorCount=warningCount-dzenCount;currentAnalysis={issues,warningCount,dzenCount,editorCount,metrics};renderAnalysis();updateAnalysisDot();return currentAnalysis}"
new_counts = " const warningCount=issues.length,dzenCount=issues.filter(x=>x.type==='dzen').length,spellCount=issues.filter(x=>x.type==='spelling').length,editorCount=warningCount-dzenCount-spellCount;currentAnalysis={issues,warningCount,dzenCount,spellCount,editorCount,metrics};renderAnalysis();updateAnalysisDot();return currentAnalysis}"
s = rep(s, old_counts, new_counts, 'analysis counts')

old_dot = "function updateAnalysisDot(){const dot=document.getElementById('analysisDot');dot.classList.toggle('bad',currentAnalysis.warningCount>0);dot.setAttribute('aria-label',currentAnalysis.warningCount?`Есть замечания: ${currentAnalysis.warningCount}`:'Замечаний нет');dot.title=currentAnalysis.warningCount?`Есть замечания: ${currentAnalysis.warningCount}`:'Всё в пределах настроенных норм'}"
new_dot = "function updateAnalysisDot(){const dot=document.getElementById('analysisDot');dot.classList.remove('stale');dot.classList.toggle('bad',currentAnalysis.warningCount>0);dot.setAttribute('aria-label',currentAnalysis.warningCount?`Есть замечания: ${currentAnalysis.warningCount}`:'Замечаний нет');dot.title=currentAnalysis.warningCount?`Есть замечания: ${currentAnalysis.warningCount}`:'Всё в пределах настроенных норм'}"
s = rep(s, old_dot, new_dot, 'dot state')

old_groups = "function issueGroups(){return [{id:'risk',name:'Контроль слов'},{id:'dzen',name:'Правила Дзена'},{id:'heading',name:'Заголовки'},{id:'headingStructure',name:'Структура H1–H3'},{id:'sentence',name:'Длинные предложения'},{id:'paragraph',name:'Длинные абзацы'},{id:'frequent',name:'Частые слова'},{id:'nearby',name:'Повторы рядом'},{id:'phrase',name:'Повторяющиеся фразы'},{id:'opening',name:'Одинаковые начала'},{id:'markdown',name:'Markdown'},{id:'structure',name:'Структура текста'}]}"
new_groups = "function issueGroups(){return [{id:'spelling',name:'Орфография'},{id:'proof',name:'Опечатки и пунктуация'},{id:'risk',name:'Контроль слов'},{id:'dzen',name:'Правила Дзена'},{id:'heading',name:'Заголовки'},{id:'headingStructure',name:'Структура H1–H3'},{id:'sentence',name:'Длинные предложения'},{id:'paragraph',name:'Длинные абзацы'},{id:'frequent',name:'Частые слова'},{id:'nearby',name:'Повторы рядом'},{id:'phrase',name:'Повторяющиеся фразы'},{id:'opening',name:'Одинаковые начала'},{id:'markdown',name:'Markdown'},{id:'structure',name:'Структура текста'}]}"
s = rep(s, old_groups, new_groups, 'issue groups')

# Summary: show spelling state and attribution when used.
old_render_start = "function renderAnalysis(){const box=document.getElementById('analysisContent'),sum=document.getElementById('analysisSummary'),collapsed=document.getElementById('analysisCollapsedSummary'),a=currentAnalysis,ec=a.editorCount||0,dc=a.dzenCount||0;sum.innerHTML=a.warningCount?`Редакторских замечаний: <b>${ec}</b> · по правилам Дзена: <b>${dc}</b>.`:'<b>По включённым автоматическим проверкам замечаний нет.</b> Финальная вычитка всё равно нужна.';"
new_render_start = "function renderAnalysis(){const box=document.getElementById('analysisContent'),sum=document.getElementById('analysisSummary'),collapsed=document.getElementById('analysisCollapsedSummary'),a=currentAnalysis,ec=a.editorCount||0,dc=a.dzenCount||0,sc=a.spellCount||0;let spellPart=settings.onlineSpelling?(spellStatus==='checking'?' · орфография: <b>проверяю…</b>':` · орфография: <b>${sc}</b>`):' · онлайн-орфография: выкл.';sum.innerHTML=a.warningCount?`Редакторских замечаний: <b>${ec}</b> · по правилам Дзена: <b>${dc}</b>${spellPart}.`:`<b>По локальным проверкам замечаний нет.</b>${spellPart} Финальная вычитка всё равно нужна.`;"
s = rep(s, old_render_start, new_render_start, 'analysis summary')

# Add attribution under spelling group.
old_group_end = "if(!rows.length)continue;html+=`<div class=\"analysisGroup\"><div class=\"analysisTitle\"><span>${g.name}</span><span class=\"badge bad\">${rows.length}</span></div>${rows.map(issueHtml).join('')}</div>`}if(!a.warningCount)"
new_group_end = "if(!rows.length)continue;html+=`<div class=\"analysisGroup\"><div class=\"analysisTitle\"><span>${g.name}</span><span class=\"badge bad\">${rows.length}</span></div>${rows.map(issueHtml).join('')}${g.id==='spelling'?'<div class=\"spellAttribution\"><a href=\"https://yandex.ru/dev/speller/\">Проверка правописания: Яндекс.Спеллер</a></div>':''}</div>`}if(!a.warningCount)"
s = rep(s, old_group_end, new_group_end, 'spelling attribution')

# Spelling issue opens suggestions; local proof with a suggested replacement can use quick fix navigator.
old_issue_branch = "else if((i.type==='phrase'||i.type==='opening')&&Array.isArray(i.occurrences)&&i.occurrences.length>1){const idx=currentAnalysis.issues.indexOf(i);click=`openRepeatNavigator(${idx})`;cls='analysisRow jump';hint=`нажмите: листать ${i.occurrences.length} совпадений`}else{"
new_issue_branch = "else if((i.type==='phrase'||i.type==='opening')&&Array.isArray(i.occurrences)&&i.occurrences.length>1){const idx=currentAnalysis.issues.indexOf(i);click=`openRepeatNavigator(${idx})`;cls='analysisRow jump';hint=`нажмите: листать ${i.occurrences.length} совпадений`}else if(i.type==='spelling'){const idx=currentAnalysis.issues.indexOf(i);click=`openSpellIssue(${idx})`;cls='analysisRow jump';hint='нажмите: варианты исправления'}else{"
s = rep(s, old_issue_branch, new_issue_branch, 'spelling issue action')

# Insert spell UI + full check before closeAnalysis.
close_analysis_anchor = "function closeAnalysis(){document.getElementById('analysisBackdrop').classList.remove('open')}"
spell_js = r'''function runFullCheck(){
 const src=editor.value||'';if(!src.trim()){toast('Нет текста для проверки');return}
 clearOnlineSpelling();analyzeText();analysisMode='problems';document.getElementById('analysisBackdrop').classList.add('open');setAnalysisMode('problems');
 if(!settings.onlineSpelling){spellStatus='off';renderAnalysis();toast('Полная локальная проверка выполнена');return}
 if(!(window.AndroidSpell&&typeof AndroidSpell.check==='function')){spellStatus='error';renderAnalysis();toast('Онлайн-проверка доступна только в установленном приложении');return}
 spellStatus='checking';spellRequestSource=src;spellRequestId=String(Date.now())+'_'+Math.random().toString(36).slice(2);setCheckRunning(true);renderAnalysis();AndroidSpell.check(src,spellRequestId)
}
window.onNativeSpellResult=(requestId,items)=>{if(String(requestId)!==String(spellRequestId))return;setCheckRunning(false);if(editor.value!==spellRequestSource){spellStatus='stale';toast('Текст изменился во время проверки — результат отброшен');return}onlineSpellIssues=(Array.isArray(items)?items:[]).map(x=>({start:+x.start||0,end:+x.end||0,word:String(x.word||''),suggestions:Array.isArray(x.suggestions)?x.suggestions.map(String):[],code:+x.code||0})).filter(x=>x.end>x.start);onlineSpellSource=editor.value;spellStatus='done';analyzeText();document.getElementById('analysisBackdrop').classList.add('open');setAnalysisMode('problems');toast(onlineSpellIssues.length?`Орфография: найдено ${onlineSpellIssues.length}`:'Орфографических ошибок не найдено')};
window.onNativeSpellError=(requestId,msg)=>{if(String(requestId)!==String(spellRequestId))return;setCheckRunning(false);spellStatus='error';onlineSpellIssues=[];onlineSpellSource='';renderAnalysis();toast(msg||'Не удалось выполнить онлайн-проверку')};
function openSpellIssue(issueIndex){const issue=currentAnalysis.issues[issueIndex];if(!issue||issue.type!=='spelling'){return}const list=currentAnalysis.issues.filter(x=>x.type==='spelling');const idx=Math.max(0,list.indexOf(issue));spellNavState={issues:list,index:idx};closeAnalysis();if(replacementState)closeReplacement();if(nearbyState)closeNearbyRepeat();if(repeatNavState)closeRepeatNavigator();showPane('edit');renderSpellPanel();jumpSpellIssue(true)}
function renderSpellPanel(){const panel=document.getElementById('spellPanel');if(!spellNavState||!spellNavState.issues.length){panel.classList.remove('open');return}const total=spellNavState.issues.length;spellNavState.index=((spellNavState.index%total)+total)%total;const it=spellNavState.issues[spellNavState.index];document.getElementById('spellWord').textContent=it.word||editor.value.slice(it.start,it.end);document.getElementById('spellCount').textContent=`${spellNavState.index+1} из ${total}`;document.getElementById('spellPrev').disabled=total<2;document.getElementById('spellNext').disabled=total<2;const box=document.getElementById('spellSuggestions');const arr=Array.isArray(it.suggestions)?it.suggestions:[];box.innerHTML=arr.length?arr.slice(0,8).map(x=>`<button class="proofChip" onclick='applySpellSuggestion(${JSON.stringify(x).replace(/'/g,"&#39;")})'>${escapeHtml(x)}</button>`).join(''):'<span class="smallNote">Готовой замены нет — проверьте слово вручную.</span>';panel.classList.add('open')}
function navigateSpellIssue(dir){if(!spellNavState)return;spellNavState.index+=dir;renderSpellPanel();jumpSpellIssue(true)}
function jumpSpellIssue(quiet=false){if(!spellNavState)return;const it=spellNavState.issues[spellNavState.index];jumpTo(it.start,it.end,true);if(!quiet)toast(`${spellNavState.index+1} из ${spellNavState.issues.length}`)}
function applySpellSuggestion(text){if(!spellNavState||!text)return;const it=spellNavState.issues[spellNavState.index],before=editor.value.slice(it.start,it.end),repl=preserveCase(before,String(text)),delta=repl.length-(it.end-it.start);editor.setRangeText(repl,it.start,it.end,'select');onlineSpellIssues=onlineSpellIssues.filter(x=>!(x.start===it.start&&x.end===it.end)).map(x=>x.start>it.start?{...x,start:x.start+delta,end:x.end+delta}:x);onlineSpellSource=editor.value;spellStatus='done';spellNavState=null;document.getElementById('spellPanel').classList.remove('open');render(true);toast(`Исправлено: ${before} → ${repl}`);const next=currentAnalysis.issues.find(x=>x.type==='spelling');if(next)openSpellIssue(currentAnalysis.issues.indexOf(next))}
function closeSpellPanel(){spellNavState=null;const p=document.getElementById('spellPanel');if(p)p.classList.remove('open')}
'''
s = rep(s, close_analysis_anchor, spell_js + close_analysis_anchor, 'spell js')

# render can update stats without running full local analysis; paste/file still force it.
old_render = "function render(){const html=markdownToHtml(editor.value);preview.innerHTML=html||'<div class=\"empty\">Здесь появится оформленный текст</div>';htmlCode.textContent=html;htmlCode.style.display=settings.showCode?'block':'none';updateStats(html);analyzeText();if(settings.autosave){clearTimeout(saveTimer);saveTimer=setTimeout(()=>localStorage.setItem('dzenDraft',editor.value),250)}}"
new_render = "function render(runAnalysis=true){const html=markdownToHtml(editor.value);preview.innerHTML=html||'<div class=\"empty\">Здесь появится оформленный текст</div>';htmlCode.textContent=html;htmlCode.style.display=settings.showCode?'block':'none';updateStats(html);if(runAnalysis)analyzeText();if(settings.autosave){clearTimeout(saveTimer);saveTimer=setTimeout(()=>localStorage.setItem('dzenDraft',editor.value),250)}}"
s = rep(s, old_render, new_render, 'render mode')

# Settings state + privacy confirmation.
old_sync = "autosaveSwitch.checked=settings.autosave;codeSwitch.checked=settings.showCode;headingCheck.checked=settings.headingCheck;"
new_sync = "autosaveSwitch.checked=settings.autosave;codeSwitch.checked=settings.showCode;proofCheck.checked=settings.proofCheck;onlineSpelling.checked=settings.onlineSpelling;headingCheck.checked=settings.headingCheck;"
s = rep(s, old_sync, new_sync, 'sync proof settings')

old_apply = "function applySettings(){settings={...settings,font:fontSelect.value,size:+sizeRange.value,line:+lineRange.value,theme:themeSelect.value,wpm:+wpmRange.value,tts:+ttsRange.value,autosave:autosaveSwitch.checked,showCode:codeSwitch.checked,headingCheck:headingCheck.checked,"
new_apply = "function applySettings(){let wantsOnline=onlineSpelling.checked;if(wantsOnline&&!settings.onlineSpelling){if(!confirm('Включить онлайн-проверку? При нажатии ✓ текст будет отправляться в Яндекс.Спеллер для проверки орфографии. Автоматически при наборе или вставке текст не отправляется.')){wantsOnline=false;onlineSpelling.checked=false}}settings={...settings,font:fontSelect.value,size:+sizeRange.value,line:+lineRange.value,theme:themeSelect.value,wpm:+wpmRange.value,tts:+ttsRange.value,autosave:autosaveSwitch.checked,showCode:codeSwitch.checked,proofCheck:proofCheck.checked,onlineSpelling:wantsOnline,headingCheck:headingCheck.checked,"
s = rep(s, old_apply, new_apply, 'apply proof settings')

# Input behavior: paste auto-analyzes; typing only updates stats/preview and marks analysis stale.
old_input = "editor.addEventListener('input',()=>{if(replacementState)closeReplacement();if(nearbyState)closeNearbyRepeat();if(repeatNavState)closeRepeatNavigator();render()});editor.addEventListener('keydown'"
new_input = "editor.addEventListener('paste',()=>{inputWasPaste=true});editor.addEventListener('input',()=>{if(replacementState)closeReplacement();if(nearbyState)closeNearbyRepeat();if(repeatNavState)closeRepeatNavigator();if(spellNavState)closeSpellPanel();const pasted=inputWasPaste;inputWasPaste=false;clearOnlineSpelling();render(pasted);if(!pasted)markAnalysisStale()});editor.addEventListener('keydown'"
s = rep(s, old_input, new_input, 'input behavior')

# File load is explicitly an automatic local-analysis event.
old_load = "closeReplacement();closeNearbyRepeat();closeRepeatNavigator();render();showPane('edit');editor.focus();toast(name?`Загружен файл: ${name}`:'Текст загружен из файла')}"
new_load = "closeReplacement();closeNearbyRepeat();closeRepeatNavigator();clearOnlineSpelling();render(true);showPane('edit');editor.focus();toast(name?`Загружен файл: ${name}`:'Текст загружен из файла')}"
s = rep(s, old_load, new_load, 'file auto analysis')

# clear closes proof panel too.
old_clear = "stopSpeak();closeReplacement();closeNearbyRepeat();closeRepeatNavigator();editor.value='';localStorage.removeItem('dzenDraft');render();editor.focus();toast('Поле очищено')"
new_clear = "stopSpeak();closeReplacement();closeNearbyRepeat();closeRepeatNavigator();closeSpellPanel();clearOnlineSpelling();editor.value='';localStorage.removeItem('dzenDraft');render(true);editor.focus();toast('Поле очищено')"
s = rep(s, old_clear, new_clear, 'clear proof state')

p.write_text(s, encoding='utf-8')

# ---- Native Android bridge for Yandex Speller ----
p = Path('app/src/main/java/ru/dzenprep/texteditor/MainActivity.java')
j = p.read_text(encoding='utf-8')

j = rep(j, 'import java.io.FileOutputStream;\n', 'import java.io.FileOutputStream;\nimport java.io.OutputStream;\nimport java.net.HttpURLConnection;\nimport java.net.URL;\nimport java.net.URLEncoder;\n', 'java imports')
j = rep(j, 'web.addJavascriptInterface(new DictionaryBridge(), "AndroidDictionary");\n', 'web.addJavascriptInterface(new DictionaryBridge(), "AndroidDictionary");\n        web.addJavascriptInterface(new SpellBridge(), "AndroidSpell");\n', 'spell bridge registration')

bridge_anchor = '''    public class DictionaryBridge {'''
spell_bridge = r'''    public class SpellBridge {
        @JavascriptInterface
        public void check(final String text, final String requestId) {
            final String source = text == null ? "" : text;
            final String id = requestId == null ? "" : requestId;
            if (source.trim().isEmpty()) {
                runJs("window.onNativeSpellResult && window.onNativeSpellResult(" + JSONObject.quote(id) + ",[])");
                return;
            }
            new Thread(() -> {
                try {
                    JSONArray result = checkSpellingOnline(source);
                    runJs("window.onNativeSpellResult && window.onNativeSpellResult(" + JSONObject.quote(id) + "," + result.toString() + ")");
                } catch (Exception e) {
                    runJs("window.onNativeSpellError && window.onNativeSpellError(" + JSONObject.quote(id) + ",'Не удалось обратиться к Яндекс.Спеллеру. Проверьте интернет.')");
                }
            }, "dzen-speller").start();
        }
    }

'''+bridge_anchor
j = rep(j, bridge_anchor, spell_bridge, 'spell bridge class')

method_anchor = '''    private String readDisplayName(Uri uri) {'''
spell_methods = r'''    private static class SpellChunk {
        final int start;
        final String text;
        SpellChunk(int start, String text) { this.start = start; this.text = text; }
    }

    private List<SpellChunk> splitForSpeller(String text) {
        final int maxChars = 7000;
        List<SpellChunk> out = new ArrayList<>();
        int start = 0;
        while (start < text.length()) {
            int end = Math.min(text.length(), start + maxChars);
            if (end < text.length()) {
                int best = -1;
                for (int i = end; i > start + maxChars / 2; i--) {
                    char c = text.charAt(i - 1);
                    if (c == '\n' || Character.isWhitespace(c)) { best = i; break; }
                }
                if (best > start) end = best;
            }
            out.add(new SpellChunk(start, text.substring(start, end)));
            start = end;
        }
        return out;
    }

    private JSONArray checkSpellingOnline(String text) throws Exception {
        JSONArray result = new JSONArray();
        for (SpellChunk chunk : splitForSpeller(text)) {
            String body = "text=" + URLEncoder.encode(chunk.text, "UTF-8") + "&lang=ru&options=6&format=plain";
            byte[] payload = body.getBytes(StandardCharsets.UTF_8);
            HttpURLConnection conn = (HttpURLConnection) new URL("https://speller.yandex.net/services/spellservice.json/checkText").openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(18000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "Dzen-Text/1.5.0 Android");
            conn.setFixedLengthStreamingMode(payload.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(payload); }
            int code = conn.getResponseCode();
            InputStream response = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
            if (response == null) { conn.disconnect(); throw new Exception("HTTP " + code); }
            byte[] bytes;
            try (InputStream in = response; ByteArrayOutputStream buf = new ByteArrayOutputStream()) {
                byte[] tmp = new byte[4096]; int n;
                while ((n = in.read(tmp)) != -1) buf.write(tmp, 0, n);
                bytes = buf.toByteArray();
            } finally { conn.disconnect(); }
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
            JSONArray errors = new JSONArray(new String(bytes, StandardCharsets.UTF_8));
            for (int i = 0; i < errors.length(); i++) {
                JSONObject e = errors.optJSONObject(i);
                if (e == null) continue;
                int pos = e.optInt("pos", -1), len = e.optInt("len", 0);
                if (pos < 0 || len <= 0) continue;
                JSONObject item = new JSONObject();
                item.put("start", chunk.start + pos);
                item.put("end", chunk.start + pos + len);
                item.put("word", e.optString("word", ""));
                item.put("code", e.optInt("code", 0));
                JSONArray suggestions = e.optJSONArray("s");
                item.put("suggestions", suggestions == null ? new JSONArray() : suggestions);
                result.put(item);
            }
        }
        return result;
    }

'''+method_anchor
j = rep(j, method_anchor, spell_methods, 'spell methods')
p.write_text(j, encoding='utf-8')

# ---- version ----
p = Path('app/build.gradle')
g = p.read_text(encoding='utf-8')
g = rep(g, 'versionCode 20', 'versionCode 21', 'versionCode')
g = rep(g, "versionName '1.4.1'", "versionName '1.5.0'", 'versionName')
p.write_text(g, encoding='utf-8')
