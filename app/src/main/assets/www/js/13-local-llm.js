(function(){
'use strict';

const SEMANTIC_CATEGORIES_KEY='semanticCategoriesV2';
const LEGACY_SEMANTIC_CATEGORIES_KEY='semanticCategoriesV1';
const GENERIC_SAFE='Текст только нейтрально обсуждает эту тему, предупреждает о ней или осуждает её без предложения совершить действие.';
const DEFAULT_SEMANTIC_CATEGORIES=[
  {id:'finance',name:'Финансовые обещания',signal:'автор обещает гарантированную прибыль без риска',safe:'автор предупреждает, что прибыль не гарантирована и возможны убытки',threshold:.60,enabled:true},
  {id:'threat',name:'Угрозы и запугивание',signal:'человеку говорят, что он пожалеет, если снова появится',safe:'текст объясняет, почему угрожать людям недопустимо',threshold:.64,enabled:true},
  {id:'restricted',name:'Ограниченные товары',signal:'автор предлагает достать оружие без документов',safe:'автор обсуждает незаконную торговлю оружием и её последствия',threshold:.62,enabled:true},
  {id:'medical',name:'Опасные медицинские советы',signal:'автор советует самостоятельно увеличить дозировку лекарства',safe:'автор советует определять дозировку лекарства с врачом',threshold:.55,enabled:true},
  {id:'engagement',name:'Манипулятивный призыв',signal:'автор призывает подписаться ради подарка',safe:'автор нейтрально сообщает цену и условия отключения подписки',threshold:.60,enabled:true},
  {id:'gambling',name:'Азартные игры',signal:'автор призывает делать ставки, играть в казино или обещает выгоду от азартной игры',safe:'автор нейтрально обсуждает риски азартных игр или предупреждает о них',threshold:.64,enabled:true},
  {id:'bypass',name:'Обход ограничений',signal:'автор предлагает практический способ обойти блокировку, запрет или техническое ограничение',safe:'автор только обсуждает ограничения или предупреждает о последствиях их обхода',threshold:.64,enabled:true},
  {id:'illegal',name:'Опасные или незаконные действия',signal:'автор призывает совершить незаконное или опасное действие либо даёт практическую инструкцию',safe:'автор предупреждает об опасном или незаконном действии, осуждает его или описывает последствия',threshold:.65,enabled:true},
  {id:'explicit',name:'Шокирующий или откровенный контент',signal:'автор предлагает, одобряет или подробно инструктирует сексуальное, жестокое или шокирующее действие',safe:'текст нейтрально, образовательным или предупреждающим образом обсуждает чувствительную тему',threshold:.66,enabled:true}
];

let semanticCache={text:null,key:'',issues:[],meta:null,error:''};
let semanticPending=null;
let semanticRunning=false;

function semanticBridgeAvailable(){return !!(window.AndroidSemanticModel&&typeof AndroidSemanticModel.status==='function'&&typeof AndroidSemanticModel.analyzeAsync==='function')}
function semanticManageAvailable(){return !!(window.AndroidSemanticModel&&typeof AndroidSemanticModel.pickModel==='function'&&typeof AndroidSemanticModel.clearModel==='function')}
function semanticStatus(){if(!semanticBridgeAvailable())return {installed:false,available:false,browser:true};try{return JSON.parse(AndroidSemanticModel.status()||'{}')}catch(e){return {installed:false,available:false,error:String(e&&e.message||e)}}}
function cloneDefaults(){return DEFAULT_SEMANTIC_CATEGORIES.map(x=>({...x}))}
function defaultCategory(id){return DEFAULT_SEMANTIC_CATEGORIES.find(x=>x.id===id)||null}
function cleanSemanticText(v,max){return String(v||'').trim().replace(/\s+/g,' ').slice(0,max)}
function cleanCategory(raw,index){
  if(!raw||typeof raw!=='object')return null;
  const id=String(raw.id||('cat'+index)).toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64)||('cat'+index);
  const def=defaultCategory(id);
  const name=cleanSemanticText(raw.name||(def&&def.name)||'',80);
  const signal=cleanSemanticText(raw.signal||raw.description||(def&&def.signal)||'',320);
  const safe=cleanSemanticText(raw.safe||(def&&def.safe)||GENERIC_SAFE,320)||GENERIC_SAFE;
  if(!name||!signal)return null;
  const fallback=def?def.threshold:.60;
  const threshold=Math.max(.50,Math.min(.99,Number.isFinite(Number(raw.threshold))?Number(raw.threshold):fallback));
  return {id,name,signal,safe,threshold,enabled:raw.enabled!==false};
}
function loadSemanticCategories(){
  for(const key of [SEMANTIC_CATEGORIES_KEY,LEGACY_SEMANTIC_CATEGORIES_KEY]){
    try{
      const raw=localStorage.getItem(key);if(!raw)continue;
      const a=JSON.parse(raw);if(!Array.isArray(a))continue;
      const clean=a.map(cleanCategory).filter(Boolean).slice(0,24);
      if(clean.length){
        if(key!==SEMANTIC_CATEGORIES_KEY)try{localStorage.setItem(SEMANTIC_CATEGORIES_KEY,JSON.stringify(clean))}catch(e){}
        return clean;
      }
    }catch(e){}
  }
  return cloneDefaults();
}
let semanticCategories=loadSemanticCategories();
function semanticKey(){return JSON.stringify(semanticCategories)}
function saveSemanticCategories(){try{localStorage.setItem(SEMANTIC_CATEGORIES_KEY,JSON.stringify(semanticCategories))}catch(e){}invalidateSemanticCache();if(semanticPending)semanticPending.stale=true}
function invalidateSemanticCache(){semanticCache={text:null,key:'',issues:[],meta:null,error:''}}
function formatSemanticSize(bytes){let n=Number(bytes)||0;if(!n)return '';const u=['Б','КБ','МБ','ГБ'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return (i>=2?n.toFixed(n>=100?0:1):Math.round(n))+' '+u[i]}

function removeLegacySemanticUi(){
  try{activeRulePack=null}catch(e){}try{lastRulePackDiagnostics={checked:0,matches:0,errors:[]}}catch(e){}
  const pack=document.querySelector('#rulePackStatus');if(pack&&pack.closest('.settingsGroup'))pack.closest('.settingsGroup').remove();
  const backdrop=document.querySelector('#rulePackBackdrop');if(backdrop)backdrop.remove();const input=document.querySelector('#rulePackFileInput');if(input)input.remove();
  const oldOnnx=document.querySelector('#localClassifierSettingsGroup');if(oldOnnx)oldOnnx.remove();const oldLlm=document.querySelector('#localLlmSettingsGroup');if(oldLlm)oldLlm.remove();
  document.querySelectorAll('.analysisFilter[data-mode="rules"]').forEach(x=>x.remove());try{if(analysisMode==='rules')analysisMode='problems'}catch(e){}
  try{ensureLocalClassifierSettings=function(){}}catch(e){}try{refreshLocalClassifierStatus=function(){}}catch(e){}
}

function ensureSemanticStyles(){
  if(document.querySelector('#semanticClassifierStyle'))return;
  const s=document.createElement('style');s.id='semanticClassifierStyle';
  s.textContent='.semanticStatus{margin-bottom:10px}.semanticActions{margin:10px 0}.semanticIntro{margin:12px 0}.semanticCards{display:flex;flex-direction:column;gap:9px}.semanticCard{border:1px solid var(--border);border-radius:13px;background:var(--surface)}.semanticCard>summary{padding:12px 13px;cursor:pointer;display:flex;gap:8px;align-items:center}.semanticCard>summary span{font-weight:700;flex:1}.semanticCard>summary small{color:var(--muted)}.semanticBody{border-top:1px solid var(--border);padding:12px}.semanticField{display:block;font-size:12px;color:var(--muted);margin:9px 0 5px}.semanticInput,.semanticDescription{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;background:var(--surface2);color:var(--text);padding:9px 10px;font:inherit}.semanticDescription{min-height:78px;resize:vertical;line-height:1.4}.semanticThreshold{display:flex;gap:8px;align-items:center}.semanticThreshold input{width:90px}.semanticRunning{font-weight:650}.semanticHint{margin-top:6px;color:var(--muted);font-size:12px;line-height:1.35}';
  document.head.appendChild(s);
}
function semanticCardHtml(c,index){
  const id=String(c.id).replace(/'/g,'');
  return '<details class="semanticCard" data-semantic="'+escapeHtml(id)+'"><summary><input type="checkbox" '+(c.enabled?'checked':'')+' onclick="event.stopPropagation()" onchange="toggleSemanticCategory('+index+',this.checked)"><span>'+escapeHtml(c.name)+'</span><small>порог '+Math.round(c.threshold*100)+'%</small></summary><div class="semanticBody"><label class="semanticField">Название</label><input class="semanticInput" maxlength="80" value="'+escapeHtml(c.name)+'" onchange="renameSemanticCategory('+index+',this.value)"><label class="semanticField">Что искать</label><textarea class="semanticDescription" maxlength="320" onchange="signalSemanticCategory('+index+',this.value)">'+escapeHtml(c.signal)+'</textarea><label class="semanticField">Безопасный контекст / исключение</label><textarea class="semanticDescription" maxlength="320" onchange="safeSemanticCategory('+index+',this.value)">'+escapeHtml(c.safe)+'</textarea><label class="semanticField">Порог срабатывания</label><div class="semanticThreshold"><input type="number" min="50" max="99" step="1" value="'+Math.round(c.threshold*100)+'" onchange="thresholdSemanticCategory('+index+',this.value)"><span>%</span></div><div class="semanticHint">Модель сравнивает оба описания. Чем выше порог, тем меньше срабатываний.</div><div class="settingActions"><button class="nativeBtn dangerText" type="button" onclick="deleteSemanticCategory('+index+')">Удалить категорию</button></div></div></details>';
}
function renderSemanticCategories(){const root=document.querySelector('[data-semantic-categories]');if(!root)return;root.innerHTML=semanticCategories.length?semanticCategories.map(semanticCardHtml).join(''):'<div class="smallNote">Смысловых категорий пока нет.</div>'}
function ensureSemanticSettings(){
  removeLegacySemanticUi();ensureSemanticStyles();const wrap=document.querySelector('#settingsBackdrop .settingsGroupWrap');if(!wrap)return;
  let group=document.querySelector('#semanticClassifierSettings');
  if(!group){
    group=document.createElement('details');group.className='settingsGroup';group.id='semanticClassifierSettings';
    group.innerHTML='<summary><span>Смысловая проверка</span><small>Быстрый локальный классификатор ONNX</small></summary><div class="settingsGroupBody"><div class="ruleStatus semanticStatus" data-semantic-status></div><div class="settingActions semanticActions"><button class="nativeBtn primarySettingBtn" data-semantic-install type="button" onclick="installSemanticModel()">Установить модель</button><button class="nativeBtn dangerText" data-semantic-remove type="button" onclick="removeSemanticModel()" hidden>Удалить модель</button></div><div class="smallNote semanticIntro">Для каждой категории задаются два коротких смысла: что считать сигналом и что считать безопасным контекстом. Модель ничего не генерирует и не пишет JSON — она только сравнивает эти смыслы с фрагментами статьи.</div><div class="semanticCards" data-semantic-categories></div><div class="settingActions"><button class="nativeBtn primarySettingBtn" type="button" onclick="addSemanticCategory()">＋ Категория</button><button class="nativeBtn" type="button" onclick="resetSemanticCategories()">Вернуть стандартные</button></div></div>';
    const control=document.querySelector('#controlListsSettingsGroup');if(control&&control.parentNode===wrap)wrap.insertBefore(group,control);else wrap.appendChild(group);
  }
  renderSemanticCategories();refreshSemanticStatus();
}
function refreshSemanticStatus(){
  const el=document.querySelector('[data-semantic-status]');if(!el)return;
  const s=semanticStatus(),install=document.querySelector('[data-semantic-install]'),remove=document.querySelector('[data-semantic-remove]');
  if(install){install.hidden=!semanticManageAvailable();install.textContent=s.installed?'Заменить модель':'Установить модель'}
  if(remove)remove.hidden=!(semanticManageAvailable()&&s.installed);
  if(s.browser){el.innerHTML='<b>Доступно только в Android-приложении.</b>';return}
  if(!s.installed){el.innerHTML='<b>Смысловая модель не установлена.</b><br>Редакторские проверки и контрольные списки работают без неё.'+(s.error?'<br><span class="warn">'+escapeHtml(s.error)+'</span>':'');return}
  el.innerHTML='<b>'+escapeHtml(s.name||'NLI-модель')+'</b>'+(s.version?' · '+escapeHtml(s.version):'')+(s.sizeBytes?' · '+formatSemanticSize(s.sizeBytes):'')+'<br>Движок: <b>ONNX Runtime</b> · режим: <b>контрастная NLI-классификация</b><br>Статус: <b>'+(s.available?'готова':'ошибка')+'</b>'+(s.error?'<br><span class="warn">'+escapeHtml(s.error)+'</span>':'');
}

window.installSemanticModel=function(){if(!semanticManageAvailable()){toast('Установка модели доступна в Android-приложении');return}try{AndroidSemanticModel.pickModel();toast('Выберите ZIP-пакет смысловой модели')}catch(e){toast('Не удалось открыть выбор модели')}};
window.removeSemanticModel=async function(){if(!semanticManageAvailable())return;const ok=typeof appConfirm==='function'?await appConfirm('Удалить смысловую модель?','Внутренняя копия модели будет удалена. Редакторские проверки и контрольные списки останутся.','Удалить',true):true;if(!ok)return;let removed=false;try{removed=!!AndroidSemanticModel.clearModel()}catch(e){}invalidateSemanticCache();refreshSemanticStatus();try{analyzeText()}catch(e){}toast(removed?'Смысловая модель удалена':'Не удалось удалить модель')};
window.toggleSemanticCategory=(i,v)=>{if(semanticCategories[i]){semanticCategories[i].enabled=!!v;saveSemanticCategories();renderSemanticCategories()}};
window.renameSemanticCategory=(i,v)=>{if(semanticCategories[i]){semanticCategories[i].name=cleanSemanticText(v,80)||semanticCategories[i].name;saveSemanticCategories();renderSemanticCategories()}};
window.signalSemanticCategory=(i,v)=>{if(semanticCategories[i]){const x=cleanSemanticText(v,320);if(x)semanticCategories[i].signal=x;saveSemanticCategories()}};
window.safeSemanticCategory=(i,v)=>{if(semanticCategories[i]){semanticCategories[i].safe=cleanSemanticText(v,320)||GENERIC_SAFE;saveSemanticCategories()}};
window.thresholdSemanticCategory=(i,v)=>{if(semanticCategories[i]){semanticCategories[i].threshold=Math.max(.50,Math.min(.99,(Number(v)||60)/100));saveSemanticCategories();renderSemanticCategories()}};
window.deleteSemanticCategory=async i=>{if(!semanticCategories[i])return;const ok=typeof appConfirm==='function'?await appConfirm('Удалить смысловую категорию?','«'+semanticCategories[i].name+'» больше не будет проверяться моделью.','Удалить',true):true;if(!ok)return;semanticCategories.splice(i,1);saveSemanticCategories();renderSemanticCategories()};
window.addSemanticCategory=()=>{const n=semanticCategories.length+1;semanticCategories.push({id:'custom-'+Date.now().toString(36),name:'Новая категория '+n,signal:'В тексте есть смысл, который нужно дополнительно проверить перед публикацией.',safe:GENERIC_SAFE,threshold:.60,enabled:true});saveSemanticCategories();renderSemanticCategories();const cards=document.querySelectorAll('.semanticCard');if(cards.length)cards[cards.length-1].open=true};
window.resetSemanticCategories=async()=>{const ok=typeof appConfirm==='function'?await appConfirm('Вернуть стандартные категории?','Ваши изменения смысловых категорий будут заменены стандартным набором.','Вернуть',false):true;if(!ok)return;semanticCategories=cloneDefaults();saveSemanticCategories();renderSemanticCategories();toast('Стандартные категории восстановлены')};

function appendSemanticIssues(src,result){
  if(!result||!Array.isArray(result.issues)||!currentAnalysis||!Array.isArray(currentAnalysis.issues))return;
  for(const raw of result.issues){
    const start=Math.max(0,Math.min(src.length,Number(raw.start)||0)),end=Math.max(start,Math.min(src.length,Number(raw.end)||start)),score=Number(raw.score);
    let detail=String(raw.message||'Проверьте смысл и контекст этого фрагмента.');
    if(Number.isFinite(score))detail+=' · сравнительная оценка '+Math.round(score*100)+'%';
    const issue=addIssue(currentAnalysis.issues,'semantic',String(raw.title||raw.category||'Смысловой сигнал'),detail,start,end,'warning');
    if(issue){issue.semanticScore=score;issue.semanticSignalScore=Number(raw.signalScore);issue.semanticSafeScore=Number(raw.safeScore);issue.semanticContrast=Number(raw.contrast);issue.semanticCategory=String(raw.category||'');issue.semanticModel=String(result.modelName||'')}
  }
}
function recountSemantic(){
  if(!currentAnalysis||!Array.isArray(currentAnalysis.issues))return;
  const issues=currentAnalysis.issues,overflow={...(issues._overflow||{})},overflowTotal=Object.values(overflow).reduce((a,b)=>a+(Number(b)||0),0),countType=t=>issues.filter(x=>x.type===t).length+(Number(overflow[t])||0),warningCount=issues.length+overflowTotal,semanticCount=countType('semantic');
  currentAnalysis.issueOverflow=overflow;currentAnalysis.overflowTotal=overflowTotal;currentAnalysis.warningCount=warningCount;currentAnalysis.semanticCount=semanticCount;currentAnalysis.rulesCount=0;currentAnalysis.editorCount=Math.max(0,warningCount-semanticCount);
}
function patchSemanticSummary(){
  const a=currentAnalysis||{},sum=document.querySelector('#analysisSummary');if(!sum)return;
  const total=Number(a.warningCount)||0,semantic=Number(a.semanticCount)||0,editor=Math.max(0,total-semantic);
  if(total)sum.innerHTML='Редакторских замечаний: <b>'+editor+'</b> · смысловых: <b>'+semantic+'</b> · всего: <b>'+total+'</b>.'+(semanticRunning?' <span class="semanticRunning">Смысловая модель проверяет текст…</span>':'');
  else sum.innerHTML='<b>По локальным проверкам замечаний нет.</b>'+(semanticRunning?' <span class="semanticRunning">Смысловая модель ещё проверяет текст…</span>':' Финальная вычитка всё равно нужна.');
}

function installSemanticIntegration(){
  if(window.__semanticContrastInstalled)return;window.__semanticContrastInstalled=true;
  removeLegacySemanticUi();
  try{const priorGroups=issueGroups;issueGroups=function(){const groups=priorGroups().filter(x=>x.id!=='rules');if(!groups.some(x=>x.id==='semantic'))groups.splice(2,0,{id:'semantic',name:'Смысловые категории'});return groups}}catch(e){}
  const priorRender=renderAnalysis;renderAnalysis=function(){priorRender();document.querySelectorAll('.analysisFilter[data-mode="rules"]').forEach(x=>x.remove());patchSemanticSummary()};window.renderAnalysis=renderAnalysis;
  const priorAnalyze=analyzeText;analyzeText=function(){const result=priorAnalyze(),src=editor.value||'',key=semanticKey();if(semanticCache.text===src&&semanticCache.key===key&&Array.isArray(semanticCache.issues))appendSemanticIssues(src,{issues:semanticCache.issues,modelName:semanticCache.meta&&semanticCache.meta.modelName});recountSemantic();renderAnalysis();updateAnalysisDot();return currentAnalysis};window.analyzeText=analyzeText;
  const priorOpenSettings=openSettings;openSettings=function(){removeLegacySemanticUi();priorOpenSettings();ensureSemanticSettings();refreshSemanticStatus()};window.openSettings=openSettings;
  const priorReport=buildAnalysisReport;buildAnalysisReport=function(){
    analyzeText();const src=editor.value||'',a=currentAnalysis||{},lines=[],semantic=Number(a.semanticCount)||0,editorCount=Math.max(0,(Number(a.warningCount)||0)-semantic);
    lines.push('ОТЧЁТ РЕДАКТОРА ПО ЛОКАЛЬНОЙ ПРОВЕРКЕ');lines.push('Создан: '+new Date().toLocaleString('ru-RU'));lines.push('Всего замечаний: '+(a.warningCount||0)+'; редакторских: '+editorCount+'; смысловых: '+semantic+'.');
    const st=semanticStatus();lines.push(st.installed?'Смысловая модель: '+String(st.name||'NLI-модель')+' · локально через ONNX Runtime.':'Смысловая модель: не установлена.');
    if(semanticCache.meta&&semanticCache.text===src){const m=semanticCache.meta;lines.push('Обработано смысловой моделью: '+Number(m.segments||0)+' фрагментов · '+Number(m.categories||0)+' категорий · '+Number(m.pairs||0)+' NLI-сравнений'+(m.elapsedMs?' · '+(Number(m.elapsedMs)/1000).toFixed(2)+' с':'')+'.')}
    if(semanticCache.error&&semanticCache.text===src)lines.push('Предупреждение смысловой модели: '+cleanReportText(semanticCache.error));
    if(a.overflowTotal)lines.push('В интерфейсе сохранено '+a.issues.length+' из '+a.warningCount+' замечаний; '+a.overflowTotal+' однотипных срабатываний скрыто.');
    lines.push('');if(!a.issues||!a.issues.length){lines.push('Замечаний не найдено.');return lines.join('\n')}
    a.issues.forEach((i,n)=>{const start=Number.isFinite(i.start)?i.start:0,end=Number.isFinite(i.end)?i.end:start;let marker=cleanReportText(src.slice(start,end));if(!marker)marker=cleanReportText(i.word||i.title);lines.push((n+1)+'. ['+reportTypeName(i.type)+'] '+cleanReportText(i.title));lines.push('Метка поиска: «'+marker+'»');const context=shortContext(src,start,end);if(context)lines.push('Контекст: '+context);lines.push('Позиция: символы '+(start+1)+'–'+Math.max(start+1,end));if(i.detail)lines.push('Комментарий: '+cleanReportText(i.detail));lines.push('')});
    return lines.join('\n');
  };window.buildAnalysisReport=buildAnalysisReport;
  const priorRun=typeof runFullCheck==='function'?runFullCheck:null;
  if(priorRun){
    runFullCheck=function(){
      if(semanticRunning){toast('Смысловая проверка уже выполняется');return}
      invalidateSemanticCache();semanticPending=null;priorRun();
      const src=editor.value||'',status=semanticStatus();if(!src.trim()||!semanticBridgeAvailable()||!status.installed||!status.available)return;
      const key=semanticKey();let id=-1;try{id=Number(AndroidSemanticModel.analyzeAsync(src,key))||-1}catch(e){id=-1}
      if(id<1){toast('Не удалось запустить смысловую проверку');return}
      semanticPending={id,text:src,key,stale:false};semanticRunning=true;setCheckRunning(true);renderAnalysis();toast('Смысловой классификатор проверяет текст…');
    };window.runFullCheck=runFullCheck;
  }
  editor.addEventListener('input',()=>{invalidateSemanticCache();if(semanticPending)semanticPending.stale=true});ensureSemanticSettings();
}

window.onNativeSemanticModelInstalling=()=>toast('Копирую и проверяю смысловую модель…');
window.onNativeSemanticModelChanged=statusText=>{invalidateSemanticCache();refreshSemanticStatus();let name='';try{name=JSON.parse(statusText||'{}').name||''}catch(e){}toast(name?'Модель установлена: '+name:'Смысловая модель установлена')};
window.onNativeSemanticModelError=msg=>{refreshSemanticStatus();toast('Модель не установлена: '+String(msg||'неизвестная ошибка'))};
window.onNativeSemanticResult=function(requestId,payload){
  const pending=semanticPending;if(!pending||Number(requestId)!==Number(pending.id))return;
  semanticPending=null;semanticRunning=false;setCheckRunning(false);
  let result={available:false,issues:[]};try{result=JSON.parse(payload||'{}')}catch(e){result={available:false,issues:[],error:'Не удалось разобрать результат классификатора'}}
  if(pending.stale||pending.text!==(editor.value||'')||pending.key!==semanticKey()){toast('Смысловая проверка завершилась, но текст или категории уже изменены — результат не применён');renderAnalysis();return}
  const error=String(result.error||'');semanticCache={text:pending.text,key:pending.key,issues:Array.isArray(result.issues)?result.issues:[],meta:result,error};analyzeText();
  if(!result.available&&error)toast('Смысловая модель: '+error);else toast('Смысловая проверка: '+semanticCache.issues.length+' замечаний за '+((Number(result.elapsedMs)||0)/1000).toFixed(2)+' с');
};
window.onNativeSemanticAnalysisError=function(requestId,msg){if(semanticPending&&Number(requestId)===Number(semanticPending.id))semanticPending=null;semanticRunning=false;setCheckRunning(false);renderAnalysis();toast('Ошибка смысловой проверки: '+String(msg||'неизвестная ошибка'))};

setTimeout(function(){try{installSemanticIntegration()}catch(e){console.error('Semantic classifier integration failed',e)}},0);
})();
