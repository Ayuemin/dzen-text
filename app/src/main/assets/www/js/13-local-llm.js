(function(){
'use strict';

const LOCAL_LLM_CRITERIA_KEY='localLlmCriteriaV1';
const LOCAL_LLM_EXCLUSIONS_KEY='localLlmExclusionsV1';
const DEFAULT_LOCAL_LLM_CRITERIA=`Ищи смысловые сигналы, которые стоит перепроверить перед публикацией:
- финансовые обещания, гарантированный доход, отсутствие риска;
- угрозы, насилие, агрессивные призывы;
- продажу или продвижение ограниченных товаров и услуг;
- опасные медицинские рекомендации и самостоятельное изменение лечения;
- навязчивое стимулирование подписок, лайков, репостов и другой активности;
- азартные игры и ставки;
- мошеннические предложения и вводящие в заблуждение гарантии;
- способы обхода блокировок, ограничений и запретов;
- незаконные действия;
- сексуальный или шокирующий контент;
- другие формулировки, которые разумно перепроверить перед публикацией.

Не реагируй только на отдельное слово: важен смысл фрагмента.`;
const DEFAULT_LOCAL_LLM_EXCLUSIONS=`Не считать проблемой само по себе:
- нейтральное упоминание темы;
- цитирование или пересказ без одобрения;
- осуждение, предупреждение или опровержение;
- явное отрицание, например «доход не гарантируется»;
- историческое, художественное, образовательное или информационное описание;
- обсуждение запрета или риска без предложения совершить действие.`;

let localLlmCache={text:null,promptKey:'',issues:[],meta:null,error:''};
let localLlmPending=null;
let localLlmRunning=false;

function localLlmBridgeAvailable(){
  return !!(window.AndroidLocalLlm&&typeof AndroidLocalLlm.status==='function'&&typeof AndroidLocalLlm.analyzeAsync==='function');
}
function localLlmManageAvailable(){
  return !!(window.AndroidLocalLlm&&typeof AndroidLocalLlm.pickModel==='function'&&typeof AndroidLocalLlm.clearModel==='function');
}
function localLlmStatus(){
  if(!localLlmBridgeAvailable())return {installed:false,available:false,browser:true};
  try{return JSON.parse(AndroidLocalLlm.status()||'{}')}catch(e){return {installed:false,available:false,error:String(e&&e.message||e)}}
}
function localLlmCriteria(){
  try{return localStorage.getItem(LOCAL_LLM_CRITERIA_KEY)||DEFAULT_LOCAL_LLM_CRITERIA}catch(e){return DEFAULT_LOCAL_LLM_CRITERIA}
}
function localLlmExclusions(){
  try{return localStorage.getItem(LOCAL_LLM_EXCLUSIONS_KEY)||DEFAULT_LOCAL_LLM_EXCLUSIONS}catch(e){return DEFAULT_LOCAL_LLM_EXCLUSIONS}
}
function localLlmPromptKey(){return localLlmCriteria()+'\u0000'+localLlmExclusions()}
function saveLocalLlmPrompt(){
  const c=document.getElementById('localLlmCriteria'),x=document.getElementById('localLlmExclusions');
  try{
    if(c)localStorage.setItem(LOCAL_LLM_CRITERIA_KEY,c.value.trim()||DEFAULT_LOCAL_LLM_CRITERIA);
    if(x)localStorage.setItem(LOCAL_LLM_EXCLUSIONS_KEY,x.value.trim()||DEFAULT_LOCAL_LLM_EXCLUSIONS);
  }catch(e){}
  invalidateLocalLlmCache();
  if(localLlmPending)localLlmPending.stale=true;
}
function invalidateLocalLlmCache(){localLlmCache={text:null,promptKey:'',issues:[],meta:null,error:''}}
function formatLocalLlmSize(bytes){
  let n=Number(bytes)||0;if(!n)return '';
  const units=['Б','КБ','МБ','ГБ'];let i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}
  return (i>=2?n.toFixed(n>=100?0:1):Math.round(n))+' '+units[i];
}

function removeLegacyRulePackUi(){
  try{activeRulePack=null}catch(e){}
  try{lastRulePackDiagnostics={checked:0,matches:0,errors:[]}}catch(e){}
  const pack=document.getElementById('rulePackStatus');
  if(pack&&pack.closest('.settingsGroup'))pack.closest('.settingsGroup').remove();
  const backdrop=document.getElementById('rulePackBackdrop');if(backdrop)backdrop.remove();
  const input=document.getElementById('rulePackFileInput');if(input)input.remove();
  document.querySelectorAll('.analysisFilter[data-mode="rules"]').forEach(x=>x.remove());
  try{if(analysisMode==='rules')analysisMode='problems'}catch(e){}
  const oldModel=document.getElementById('localClassifierSettingsGroup');if(oldModel)oldModel.remove();
  try{ensureLocalClassifierSettings=function(){}}catch(e){}
  try{refreshLocalClassifierStatus=function(){}}catch(e){}
}

function ensureLocalLlmStyles(){
  if(document.getElementById('localLlmRuntimeStyle'))return;
  const style=document.createElement('style');style.id='localLlmRuntimeStyle';
  style.textContent='.localLlmPromptLabel{display:block;font-size:12px;color:var(--muted);margin:13px 0 6px}.localLlmPrompt{width:100%;box-sizing:border-box;min-height:132px;resize:vertical;border:1px solid var(--border);border-radius:12px;background:var(--surface2);color:var(--text);padding:11px;font:inherit;line-height:1.45}.localLlmStatus{margin-bottom:10px}.localLlmProgress{margin-top:8px;color:var(--muted);font-size:12px}.localLlmActions{margin:10px 0}.analysisSummary .semanticRunning{font-weight:650}';
  document.head.appendChild(style);
}

function ensureLocalLlmSettings(){
  removeLegacyRulePackUi();ensureLocalLlmStyles();
  const wrap=document.querySelector('#settingsBackdrop .settingsGroupWrap');if(!wrap)return;
  let group=document.getElementById('localLlmSettingsGroup');
  if(!group){
    group=document.createElement('details');group.className='settingsGroup';group.id='localLlmSettingsGroup';
    group.innerHTML='<summary><span>Локальная смысловая модель</span><small>Любая совместимая GGUF-модель на устройстве</small></summary><div class="settingsGroupBody"><div class="ruleStatus localLlmStatus" data-local-llm-status></div><div class="settingActions localLlmActions"><button class="nativeBtn primarySettingBtn" data-local-llm-install type="button" onclick="installLocalLlmModel()">Установить модель</button><button class="nativeBtn dangerText" data-local-llm-remove type="button" onclick="removeLocalLlmModel()" hidden>Удалить модель</button></div><div class="smallNote">Выберите файл <b>.gguf</b> на телефоне. Приложение проверит модель и скопирует её во внутреннее хранилище. После установки исходный файл в «Загрузках» приложению больше не нужен.</div><label class="localLlmPromptLabel" for="localLlmCriteria">Что искать</label><textarea id="localLlmCriteria" class="localLlmPrompt" rows="8" maxlength="12000"></textarea><label class="localLlmPromptLabel" for="localLlmExclusions">Что не считать проблемой</label><textarea id="localLlmExclusions" class="localLlmPrompt" rows="6" maxlength="12000"></textarea><div class="smallNote">Служебная инструкция и обязательный JSON-формат ответа зашиты в приложение и здесь не редактируются.</div><div class="settingActions"><button class="nativeBtn" type="button" onclick="resetLocalLlmPrompt()">Вернуть рекомендуемые критерии</button></div></div>';
    const control=document.getElementById('controlListsSettingsGroup');
    if(control&&control.parentNode===wrap)wrap.insertBefore(group,control);else wrap.appendChild(group);
    const c=group.querySelector('#localLlmCriteria'),x=group.querySelector('#localLlmExclusions');
    if(c)c.addEventListener('input',saveLocalLlmPrompt);if(x)x.addEventListener('input',saveLocalLlmPrompt);
  }
  const c=document.getElementById('localLlmCriteria'),x=document.getElementById('localLlmExclusions');
  if(c&&document.activeElement!==c)c.value=localLlmCriteria();
  if(x&&document.activeElement!==x)x.value=localLlmExclusions();
  refreshLocalLlmStatus();
}

function refreshLocalLlmStatus(){
  const el=document.querySelector('[data-local-llm-status]');if(!el)return;
  const s=localLlmStatus(),install=document.querySelector('[data-local-llm-install]'),remove=document.querySelector('[data-local-llm-remove]');
  if(install){install.hidden=!localLlmManageAvailable();install.textContent=s.installed?'Заменить модель':'Установить модель'}
  if(remove)remove.hidden=!(localLlmManageAvailable()&&s.installed);
  if(s.browser){el.innerHTML='<b>Доступно только в Android-приложении.</b>';return}
  if(!s.installed){el.innerHTML='<b>Модель не установлена.</b><br>Редакторские проверки и контрольные списки работают без неё.'+(s.error?'<br><span class="warn">'+escapeHtml(s.error)+'</span>':'');return}
  const size=s.sizeBytes?' · '+formatLocalLlmSize(s.sizeBytes):'';
  el.innerHTML='<b>'+escapeHtml(s.name||'GGUF-модель')+'</b>'+size+'<br>Движок: <b>llama.cpp</b> · формат: <b>GGUF</b><br>Статус: <b>'+(s.available?'готова к локальной проверке':'не готова')+'</b>'+(s.error?'<br><span class="warn">'+escapeHtml(s.error)+'</span>':'');
}

window.installLocalLlmModel=function(){
  if(!localLlmManageAvailable()){toast('Установка GGUF-модели доступна в Android-приложении');return}
  try{AndroidLocalLlm.pickModel();toast('Выберите GGUF-модель на телефоне')}catch(e){toast('Не удалось открыть выбор модели')}
};
window.removeLocalLlmModel=async function(){
  if(!localLlmManageAvailable())return;
  const ok=typeof appConfirm==='function'?await appConfirm('Удалить локальную модель?','Внутренняя копия GGUF-модели будет удалена из приложения. Редакторские проверки и контрольные списки останутся.','Удалить',true):true;
  if(!ok)return;
  let removed=false;try{removed=!!AndroidLocalLlm.clearModel()}catch(e){}
  invalidateLocalLlmCache();refreshLocalLlmStatus();try{analyzeText()}catch(e){}
  toast(removed?'Локальная модель удалена':'Не удалось удалить модель — возможно, сейчас идёт проверка');
};
window.resetLocalLlmPrompt=async function(){
  const ok=typeof appConfirm==='function'?await appConfirm('Вернуть рекомендуемые критерии?','Ваши изменения полей «Что искать» и «Что не считать проблемой» будут заменены стандартными.','Вернуть',false):true;
  if(!ok)return;
  try{localStorage.setItem(LOCAL_LLM_CRITERIA_KEY,DEFAULT_LOCAL_LLM_CRITERIA);localStorage.setItem(LOCAL_LLM_EXCLUSIONS_KEY,DEFAULT_LOCAL_LLM_EXCLUSIONS)}catch(e){}
  const c=document.getElementById('localLlmCriteria'),x=document.getElementById('localLlmExclusions');if(c)c.value=DEFAULT_LOCAL_LLM_CRITERIA;if(x)x.value=DEFAULT_LOCAL_LLM_EXCLUSIONS;invalidateLocalLlmCache();if(localLlmPending)localLlmPending.stale=true;toast('Рекомендуемые критерии восстановлены');
};

function appendLocalLlmIssues(src,result){
  if(!result||!Array.isArray(result.issues)||!currentAnalysis||!Array.isArray(currentAnalysis.issues))return;
  for(const raw of result.issues){
    const start=Math.max(0,Math.min(src.length,Number(raw.start)||0));
    const end=Math.max(start,Math.min(src.length,Number(raw.end)||start));
    const category=String(raw.category||'').trim();
    let detail=String(raw.message||'Проверьте смысл и контекст этого фрагмента.').trim();
    if(category)detail+=' · '+category;
    const issue=addIssue(currentAnalysis.issues,'semantic',String(raw.title||'Смысловой сигнал'),detail,start,end,'warning');
    if(issue){issue.llmCategory=category;issue.llmModel=String(result.modelName||'')}
  }
}
function recountLocalAnalysis(){
  if(!currentAnalysis||!Array.isArray(currentAnalysis.issues))return;
  const issues=currentAnalysis.issues,overflow={...(issues._overflow||{})};
  const overflowTotal=Object.values(overflow).reduce((a,b)=>a+(Number(b)||0),0);
  const countType=t=>issues.filter(x=>x.type===t).length+(Number(overflow[t])||0);
  const warningCount=issues.length+overflowTotal,semanticCount=countType('semantic');
  currentAnalysis.issueOverflow=overflow;currentAnalysis.overflowTotal=overflowTotal;currentAnalysis.warningCount=warningCount;currentAnalysis.semanticCount=semanticCount;currentAnalysis.rulesCount=0;currentAnalysis.editorCount=Math.max(0,warningCount-semanticCount);
}
function patchLocalAnalysisSummary(){
  const a=currentAnalysis||{},sum=document.getElementById('analysisSummary');if(!sum)return;
  const total=Number(a.warningCount)||0,semantic=Number(a.semanticCount)||0,editor=Math.max(0,total-semantic);
  if(total)sum.innerHTML='Редакторских замечаний: <b>'+editor+'</b> · смысловых: <b>'+semantic+'</b> · всего: <b>'+total+'</b>.'+(localLlmRunning?' <span class="semanticRunning">Модель проверяет текст…</span>':'');
  else sum.innerHTML='<b>По локальным проверкам замечаний нет.</b>'+(localLlmRunning?' <span class="semanticRunning">Смысловая модель ещё проверяет текст…</span>':' Финальная вычитка всё равно нужна.');
}

function installLocalLlmIntegration(){
  removeLegacyRulePackUi();
  try{
    const priorGroups=issueGroups;
    issueGroups=function(){
      const groups=priorGroups().filter(x=>x.id!=='rules');
      if(!groups.some(x=>x.id==='semantic'))groups.splice(2,0,{id:'semantic',name:'Локальный смысловой анализ'});
      return groups;
    };
  }catch(e){}

  const priorRender=renderAnalysis;
  renderAnalysis=function(){priorRender();document.querySelectorAll('.analysisFilter[data-mode="rules"]').forEach(x=>x.remove());patchLocalAnalysisSummary()};

  const priorAnalyze=analyzeText;
  analyzeText=function(){
    const result=priorAnalyze(),src=editor.value||'',key=localLlmPromptKey();
    if(localLlmCache.text===src&&localLlmCache.promptKey===key&&Array.isArray(localLlmCache.issues))appendLocalLlmIssues(src,{issues:localLlmCache.issues,modelName:localLlmCache.meta&&localLlmCache.meta.modelName});
    recountLocalAnalysis();renderAnalysis();updateAnalysisDot();return currentAnalysis;
  };
  window.analyzeText=analyzeText;

  const priorOpenSettings=openSettings;
  openSettings=function(){removeLegacyRulePackUi();priorOpenSettings();ensureLocalLlmSettings();refreshLocalLlmStatus()};
  window.openSettings=openSettings;

  buildAnalysisReport=function(){
    analyzeText();const src=editor.value||'',a=currentAnalysis||{},lines=[];
    const semantic=Number(a.semanticCount)||0,editorCount=Math.max(0,(Number(a.warningCount)||0)-semantic);
    lines.push('ОТЧЁТ РЕДАКТОРА ПО ЛОКАЛЬНОЙ ПРОВЕРКЕ');
    lines.push('Создан: '+new Date().toLocaleString('ru-RU'));
    lines.push('Всего замечаний: '+(a.warningCount||0)+'; редакторских: '+editorCount+'; смысловых: '+semantic+'.');
    const st=localLlmStatus();
    if(st.installed)lines.push('Смысловая модель: '+String(st.name||'GGUF-модель')+' · локально через llama.cpp.');
    else lines.push('Смысловая модель: не установлена.');
    if(localLlmCache.meta&&localLlmCache.text===src){
      const m=localLlmCache.meta;lines.push('Обработано смысловой моделью: '+Number(m.segments||0)+' фрагментов'+(m.chunks?' · '+Number(m.chunks)+' блоков':'')+(m.elapsedMs?' · '+(Number(m.elapsedMs)/1000).toFixed(1)+' с':'')+'.');
    }
    if(localLlmCache.error&&localLlmCache.text===src)lines.push('Предупреждение смысловой модели: '+cleanReportText(localLlmCache.error));
    if(a.overflowTotal)lines.push('В интерфейсе сохранено '+a.issues.length+' из '+a.warningCount+' замечаний; '+a.overflowTotal+' однотипных срабатываний скрыто.');
    lines.push('');
    if(!a.issues||!a.issues.length){lines.push('Замечаний не найдено.');return lines.join('\n')}
    a.issues.forEach((i,n)=>{
      const start=Number.isFinite(i.start)?i.start:0,end=Number.isFinite(i.end)?i.end:start;let marker=cleanReportText(src.slice(start,end));if(!marker)marker=cleanReportText(i.word||i.title);
      lines.push((n+1)+'. ['+reportTypeName(i.type)+'] '+cleanReportText(i.title));
      lines.push('Метка поиска: «'+marker+'»');const context=shortContext(src,start,end);if(context)lines.push('Контекст: '+context);
      lines.push('Позиция: символы '+(start+1)+'–'+Math.max(start+1,end));if(i.detail)lines.push('Комментарий: '+cleanReportText(i.detail));lines.push('');
    });
    return lines.join('\n');
  };
  window.buildAnalysisReport=buildAnalysisReport;

  const priorRun=typeof runFullCheck==='function'?runFullCheck:null;
  if(priorRun){
    runFullCheck=function(){
      const alreadyRunning=localLlmRunning||!!localLlmPending;
      if(!alreadyRunning)invalidateLocalLlmCache();
      priorRun();
      const src=editor.value||'',status=localLlmStatus();
      if(!src.trim()||!localLlmBridgeAvailable()||!status.installed||!status.available)return;
      if(alreadyRunning){toast('Смысловая модель уже проверяет текст. Дождитесь завершения.');return}
      const criteria=localLlmCriteria(),exclusions=localLlmExclusions(),key=criteria+'\u0000'+exclusions;
      let id=-1;
      try{id=Number(AndroidLocalLlm.analyzeAsync(src,criteria,exclusions))||-1}catch(e){id=-1}
      if(id<1){toast('Не удалось запустить смысловую проверку');return}
      localLlmPending={id,text:src,promptKey:key};localLlmRunning=true;setCheckRunning(true);renderAnalysis();toast('Смысловая модель проверяет текст локально…');
    };
    window.runFullCheck=runFullCheck;
  }

  editor.addEventListener('input',()=>{invalidateLocalLlmCache();if(localLlmPending)localLlmPending.stale=true});
  ensureLocalLlmSettings();
}

window.onNativeLocalLlmInstalling=function(){toast('Копирую и проверяю GGUF-модель…')};
window.onNativeLocalLlmChanged=function(statusText){
  invalidateLocalLlmCache();refreshLocalLlmStatus();try{analyzeText()}catch(e){}let name='';try{name=JSON.parse(statusText||'{}').name||''}catch(e){}toast(name?'Модель установлена: '+name:'GGUF-модель установлена');
};
window.onNativeLocalLlmError=function(msg){refreshLocalLlmStatus();toast('Модель не установлена: '+String(msg||'неизвестная ошибка'))};
window.onNativeLocalLlmResult=function(requestId,payload){
  const pending=localLlmPending;if(!pending||Number(requestId)!==Number(pending.id))return;
  localLlmPending=null;localLlmRunning=false;setCheckRunning(false);
  let result={available:false,issues:[]};try{result=JSON.parse(payload||'{}')}catch(e){result={available:false,issues:[],error:'Не удалось разобрать ответ движка'}}
  if(pending.stale||pending.text!==(editor.value||'')||pending.promptKey!==localLlmPromptKey()){toast('Смысловая проверка завершилась, но текст или критерии уже изменены — результат не применён');renderAnalysis();return}
  const errs=Array.isArray(result.errors)?result.errors:[];
  const error=String(result.error||'')+(errs.length?(result.error?' · ':'')+errs.slice(0,2).join('; '):'');
  localLlmCache={text:pending.text,promptKey:pending.promptKey,issues:Array.isArray(result.issues)?result.issues:[],meta:result,error};
  analyzeText();
  if(!result.available&&error)toast('Смысловая модель: '+error);else toast('Смысловая проверка завершена: '+localLlmCache.issues.length+' замечаний');
};
window.onNativeLocalLlmAnalysisError=function(requestId,msg){
  if(!localLlmPending||Number(requestId)!==Number(localLlmPending.id))return;
  localLlmPending=null;localLlmRunning=false;setCheckRunning(false);renderAnalysis();toast('Ошибка смысловой проверки: '+String(msg||'неизвестная ошибка'));
};

setTimeout(function(){try{installLocalLlmIntegration()}catch(e){console.error('Local GGUF integration failed',e)}},0);

})();
