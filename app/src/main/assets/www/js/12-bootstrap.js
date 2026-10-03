let localClassifierCache={text:null,issues:[],error:'',segments:0};

function localClassifierBridgeAvailable(){
  return !!(window.AndroidLocalClassifier&&typeof AndroidLocalClassifier.status==='function'&&typeof AndroidLocalClassifier.analyze==='function');
}

function localClassifierStatus(){
  if(!localClassifierBridgeAvailable())return {installed:false,available:false,browser:true};
  try{return JSON.parse(AndroidLocalClassifier.status()||'{}')}catch(e){return {installed:false,available:false,error:String(e&&e.message||e)}}
}

function ensureLocalClassifierSettings(){
  const wrap=document.querySelector('#settingsBackdrop .settingsGroupWrap');
  if(!wrap||document.querySelector('#localClassifierSettingsGroup'))return;
  const group=document.createElement('details');
  group.className='settingsGroup';
  group.id='localClassifierSettingsGroup';
  group.innerHTML='<summary><span>Локальная смысловая модель</span><small>ONNX-классификатор предложений на устройстве</small></summary><div class="settingsGroupBody"><div class="ruleStatus" data-local-classifier-status></div><div class="smallNote">Модель не использует интернет. Если её нет или она не загрузилась, остальные проверки продолжают работать как обычно.</div></div>';
  const rulePack=document.querySelector('#rulePackStatus');
  const before=rulePack&&rulePack.closest?rulePack.closest('.settingsGroup'):null;
  if(before&&before.parentNode===wrap)wrap.insertBefore(group,before);else wrap.appendChild(group);
}

function refreshLocalClassifierStatus(){
  ensureLocalClassifierSettings();
  const el=document.querySelector('[data-local-classifier-status]');
  if(!el)return;
  const status=localClassifierStatus();
  if(status.browser){
    el.innerHTML='<b>Доступно только в Android-приложении.</b>';
    return;
  }
  if(!status.installed){
    el.innerHTML='<b>Модель не установлена.</b><br>Обычные локальные проверки работают без неё.';
    return;
  }
  if(!status.available){
    el.innerHTML='<b>Модель найдена, но не загрузилась.</b>'+(status.error?'<br>'+escapeHtml(status.error):'');
    return;
  }
  el.innerHTML='<b>'+escapeHtml(status.name||'Локальная смысловая модель')+'</b>'+(status.version?' · '+escapeHtml(status.version):'')+'<br>Категорий: <b>'+Number(status.labels||0)+'</b><br>Статус: <b>применяется локально</b>';
}

function runLocalClassifier(src){
  if(!localClassifierBridgeAvailable())return {available:false,issues:[]};
  try{
    const result=JSON.parse(AndroidLocalClassifier.analyze(String(src||''))||'{}');
    return result&&typeof result==='object'?result:{available:false,issues:[]};
  }catch(e){
    return {available:false,issues:[],error:String(e&&e.message||e)};
  }
}

function appendLocalClassifierIssues(src,result){
  if(!result||!Array.isArray(result.issues))return;
  const issues=currentAnalysis&&Array.isArray(currentAnalysis.issues)?currentAnalysis.issues:null;
  if(!issues)return;
  for(const raw of result.issues){
    const start=Math.max(0,Math.min(src.length,Number(raw.start)||0));
    const end=Math.max(start,Math.min(src.length,Number(raw.end)||start));
    const score=Number(raw.score);
    const confidence=Number.isFinite(score)?' · уверенность '+Math.round(score*100)+'%':'';
    const issue=addIssue(
      issues,
      'semantic',
      String(raw.title||'Смысловой сигнал'),
      String(raw.message||'Проверьте смысл и контекст предложения.')+confidence,
      start,
      end,
      raw.severity==='critical'?'critical':'warning'
    );
    if(issue){
      issue.classifierId=String(raw.id||'');
      issue.score=score;
    }
  }
  const issueOverflow={...(issues._overflow||{})};
  const overflowTotal=Object.values(issueOverflow).reduce((a,b)=>a+(Number(b)||0),0);
  const warningCount=issues.length+overflowTotal;
  const rulesCount=issues.filter(x=>x.type==='rules').length+(issueOverflow.rules||0);
  currentAnalysis.issueOverflow=issueOverflow;
  currentAnalysis.overflowTotal=overflowTotal;
  currentAnalysis.warningCount=warningCount;
  currentAnalysis.rulesCount=rulesCount;
  currentAnalysis.editorCount=warningCount-rulesCount;
}

function installLocalClassifierIntegration(){
  if(window.__localClassifierIntegrationInstalled)return;
  window.__localClassifierIntegrationInstalled=true;

  const baseAnalyze=analyzeText;
  analyzeText=function(){
    const result=baseAnalyze();
    const src=editor.value||'';
    let semantic=null;
    if(window.__runLocalSemantic){
      semantic=runLocalClassifier(src);
      localClassifierCache={
        text:src,
        issues:Array.isArray(semantic.issues)?semantic.issues:[],
        error:String(semantic.error||''),
        segments:Number(semantic.segments||0)
      };
    }else if(localClassifierCache.text===src){
      semantic={available:true,issues:localClassifierCache.issues,error:localClassifierCache.error,segments:localClassifierCache.segments};
    }
    if(semantic)appendLocalClassifierIssues(src,semantic);
    renderAnalysis();
    updateAnalysisDot();
    return currentAnalysis;
  };

  const baseIssueGroups=issueGroups;
  issueGroups=function(){
    const groups=baseIssueGroups();
    if(!groups.some(x=>x.id==='semantic'))groups.splice(2,0,{id:'semantic',name:'Локальный смысловой анализ'});
    return groups;
  };

  const baseOpenSettings=openSettings;
  openSettings=function(){
    ensureLocalClassifierSettings();
    baseOpenSettings();
    refreshLocalClassifierStatus();
  };
}

installLocalClassifierIntegration();

let localAnalysisTimer=null;
function scheduleLocalAnalysis(){
  clearTimeout(localAnalysisTimer);
  const size=(editor.value||'').length;
  const delay=size>160000?1000:size>80000?600:240;
  localAnalysisTimer=setTimeout(()=>{
    localAnalysisTimer=null;
    try{analyzeText()}catch(e){console.error(e)}
  },delay);
}

function bootstrapEditor(){
  if(window.__platformTextBootstrapped)return;
  window.__platformTextBootstrapped=true;

  document.title='Редактор текста · прототип';
  settings=loadSettings();
  userSynonyms=loadUserSynonyms();
  activeRulePack=loadRulePack();

  editor.addEventListener('paste',()=>{inputWasPaste=true});
  editor.addEventListener('input',()=>{
    if(replacementState)closeReplacement();
    if(nearbyState)closeNearbyRepeat();
    if(repeatNavState&&typeof scheduleRepeatNavigatorRefresh==='function')scheduleRepeatNavigatorRefresh();
    if(typeof issueNavState!=='undefined'&&issueNavState&&typeof scheduleIssueNavigatorRefresh==='function')scheduleIssueNavigatorRefresh();
    inputWasPaste=false;
    render(false);
    markAnalysisStale();
    scheduleLocalAnalysis();
  });
  editor.addEventListener('keydown',e=>{
    if(e.key==='Tab'){
      e.preventDefault();
      const s=editor.selectionStart,en=editor.selectionEnd;
      if(typeof historyCheckpoint==='function')historyCheckpoint();
      editor.setRangeText('    ',s,en,'end');
      afterProgrammaticEdit(false);
      scheduleLocalAnalysis();
    }
  });

  document.getElementById('fileInput').addEventListener('change',e=>{
    const f=e.target.files&&e.target.files[0];
    e.target.value='';
    if(!f)return;
    const r=new FileReader();
    r.onload=()=>loadFileText(String(r.result||''),f.name);
    r.onerror=()=>toast('Не удалось прочитать файл');
    r.readAsText(f,'UTF-8');
  });

  document.getElementById('synonymFileInput').addEventListener('change',e=>{
    const f=e.target.files&&e.target.files[0];
    e.target.value='';
    if(!f)return;
    const r=new FileReader();
    r.onload=()=>parseBrowserDictionary(String(r.result||''),f.name);
    r.onerror=()=>toast('Не удалось прочитать словарь');
    r.readAsText(f,'UTF-8');
  });

  document.getElementById('rulePackFileInput').addEventListener('change',e=>{
    const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;const r=new FileReader();r.onload=()=>window.onNativeRulePackLoaded(String(r.result||''),f.name);r.onerror=()=>toast('Не удалось прочитать JSON');r.readAsText(f,'UTF-8');
  });

  document.getElementById('manualReplacement').addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      applyManualReplacement();
    }
  });

  window.onNativeTtsDone=()=>setSpeaking(false);
  window.onNativeTtsError=(msg)=>{setSpeaking(false);toast(msg||'Ошибка системной озвучки')};
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&speaking)stopSpeak()});

  applyVisualSettings();
  let managed=false;
  if(typeof initArticleWorkspace==='function')managed=initArticleWorkspace();
  if(!managed&&settings.autosave){
    const draft=localStorage.getItem('editorDraft');
    if(draft)editor.value=draft;
  }
  if(typeof migrateLegacyVersions==='function')migrateLegacyVersions();
  syncSettingsUI();
  updateUserSynonymStatus();
  updateRulePackStatus();
  ensureLocalClassifierSettings();
  refreshLocalClassifierStatus();
  render(false);
  scheduleLocalAnalysis();
  if(typeof updateCurrentArticleUi==='function')updateCurrentArticleUi();
  if(typeof updateDrawerSpeakLabel==='function')updateDrawerSpeakLabel();
  setTimeout(updateDictStatus,80);
  setTimeout(updateDictStatus,800);
}

try{
  bootstrapEditor();
}catch(error){
  console.error('Editor bootstrap failed',error);
  const t=document.getElementById('toast');
  if(t){
    t.textContent='Ошибка запуска редактора. Перезапустите приложение.';
    t.classList.add('show');
  }
}
