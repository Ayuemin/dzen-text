function bootstrapDzenText(){
  if(window.__dzenTextBootstrapped)return;
  window.__dzenTextBootstrapped=true;

  document.title='Дзен Текст 1.10.7';
  settings=loadSettings();
  // Retired product concepts are migrated only after the user's saved settings
  // are loaded, so unrelated editor/appearance preferences are never replaced
  // by defaults during startup.
  settings.onlineSpelling=false;
  settings.riskCheck=false;
  settings.dzenSmartRules=false;
  if(typeof persistSettings==='function')persistSettings(false);
  userSynonyms=loadUserSynonyms();
  spellIgnoreWords=loadSpellIgnoreWords();
  dzenRules=loadDzenRules();

  editor.addEventListener('input',()=>{
    if(replacementState)closeReplacement();
    if(nearbyState)closeNearbyRepeat();
    if(repeatNavState&&typeof scheduleRepeatNavigatorRefresh==='function')scheduleRepeatNavigatorRefresh();
    if(typeof issueNavState!=='undefined'&&issueNavState&&typeof scheduleIssueNavigatorRefresh==='function')scheduleIssueNavigatorRefresh();
    if(spellNavState)closeSpellPanel();
    clearOnlineSpelling();
    render(false);
    markAnalysisStale();
  });
  editor.addEventListener('keydown',e=>{
    if(e.key==='Tab'){
      e.preventDefault();
      const s=editor.selectionStart,en=editor.selectionEnd;
      if(typeof historyCheckpoint==='function')historyCheckpoint();
      editor.setRangeText('    ',s,en,'end');
      afterProgrammaticEdit(false);
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
    const draft=localStorage.getItem('dzenDraft');
    if(draft)editor.value=draft;
  }
  if(typeof migrateLegacyVersions==='function')migrateLegacyVersions();
  syncSettingsUI();

  // The remaining local style heuristic is purely typographic. Do not present
  // it as an AI-authorship detector.
  const aiStyle=document.getElementById('aiStyleCheck');
  if(aiStyle){
    const row=aiStyle.closest('.switchRow');
    const label=row&&row.querySelector('.labelWithHint');
    if(label&&label.childNodes&&label.childNodes[0])label.childNodes[0].nodeValue='Типографические сигналы ';
    const note=row&&row.nextElementSibling;
    if(note&&note.classList&&note.classList.contains('smallNote'))note.textContent='Локальная механическая проверка отдельных типографических признаков. Она не определяет авторство текста и не оценивает смысл.';
  }

  updateUserSynonymStatus();
  updateDzenRulesStatus();
  updateSpellIgnoreStatus();
  render(false);
  if(typeof scheduleAnalysis==='function')scheduleAnalysis();
  if(typeof updateCurrentArticleUi==='function')updateCurrentArticleUi();
  if(typeof updateDrawerSpeakLabel==='function')updateDrawerSpeakLabel();
  setTimeout(updateDictStatus,80);
  setTimeout(updateDictStatus,800);
}

try{
  bootstrapDzenText();
}catch(error){
  console.error('Dzen Text bootstrap failed',error);
  const t=document.getElementById('toast');
  if(t){
    t.textContent='Ошибка запуска редактора. Перезапустите приложение.';
    t.classList.add('show');
  }
}
