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
