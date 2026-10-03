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

function enforceLocalFirstSettings(){
  settings.onlineSpelling=false;
  settings.dzenSmartRules=false;
  try{if(typeof DZEN_RULES_KEY!=='undefined')localStorage.removeItem(DZEN_RULES_KEY)}catch(e){}
  try{if(typeof persistSettings==='function')persistSettings(false)}catch(e){}

  markAnalysisStale=function(){
    const dot=document.getElementById('analysisDot');
    if(!dot)return;
    dot.classList.remove('bad');
    dot.classList.add('stale');
    dot.setAttribute('aria-label','Локальная проверка обновляется');
    dot.title='Локальная проверка обновляется автоматически';
  };

  updateDzenRulesFromGitHub=function(){toast('В этой версии используется только встроенная локальная база правил Дзена')};
  updateDzenRulesStatus=function(){
    const el=document.getElementById('dzenRulesStatus');
    if(!el)return;
    const r=typeof DEFAULT_DZEN_RULES!=='undefined'?DEFAULT_DZEN_RULES:{};
    el.innerHTML='Локальная база: <b>встроенная</b><br>Версия: <b>'+escapeHtml(String(r.version||'встроенная'))+'</b><br>Статья проверяется только на устройстве.';
  };
}

function applyLocalFirstUi(){
  const online=document.getElementById('onlineSpelling');
  if(online){
    online.checked=false;
    const row=online.closest('.switchRow');
    if(row){row.hidden=true;const note=row.nextElementSibling;if(note&&note.classList.contains('smallNote'))note.hidden=true}
  }
  const spellStatus=document.getElementById('spellIgnoreStatus');
  if(spellStatus){
    spellStatus.hidden=true;
    const actions=spellStatus.nextElementSibling;
    if(actions&&actions.classList.contains('settingActions'))actions.hidden=true;
  }
  document.querySelectorAll('.spellAttribution').forEach(x=>x.hidden=true);
  const spellPanel=document.getElementById('spellPanel');if(spellPanel)spellPanel.hidden=true;
  const proof=document.getElementById('proofCheck');
  const proofGroup=proof&&proof.closest('details.settingsGroup');
  if(proofGroup){
    const summary=proofGroup.querySelector('summary');
    if(summary)summary.innerHTML='<span>Локальная проверка</span><small>Опечатки, пунктуация и механические ошибки</small>';
  }

  const smart=document.getElementById('dzenSmartRules');
  if(smart){
    smart.checked=false;
    const row=smart.closest('.switchRow');
    if(row){row.hidden=true;const note=row.nextElementSibling;if(note&&note.classList.contains('smallNote'))note.hidden=true}
  }
  const dzenStatus=document.getElementById('dzenRulesStatus');
  if(dzenStatus){
    const actions=dzenStatus.nextElementSibling;
    if(actions&&actions.classList.contains('settingActions'))actions.hidden=true;
  }
  const dzenCheck=document.getElementById('dzenCheck');
  const dzenGroup=dzenCheck&&dzenCheck.closest('details.settingsGroup');
  if(dzenGroup){
    const summary=dzenGroup.querySelector('summary');
    if(summary)summary.innerHTML='<span>Правила Дзена</span><small>Встроенные локальные эвристики</small>';
  }

  const aiStyle=document.getElementById('aiStyleCheck');
  if(aiStyle){
    const row=aiStyle.closest('.switchRow');
    const label=row&&row.querySelector('span');
    if(label)label.textContent='Типографические сигналы';
    const note=row&&row.nextElementSibling;
    if(note&&note.classList.contains('smallNote'))note.textContent='Локальная механическая проверка типографических признаков. Она не определяет авторство текста и не оценивает смысл.';
  }

  const check=document.getElementById('checkBtn');
  if(check){check.setAttribute('aria-label','Обновить локальную проверку');check.title='Обновить локальную проверку'}
  const drawerCheck=document.querySelector('button[onclick="drawerCheck()"]');
  if(drawerCheck)drawerCheck.textContent='Проверить локально';
}

function bootstrapDzenText(){
  if(window.__dzenTextBootstrapped)return;
  window.__dzenTextBootstrapped=true;

  settings=loadSettings();
  enforceLocalFirstSettings();
  userSynonyms=loadUserSynonyms();
  spellIgnoreWords=loadSpellIgnoreWords();
  dzenRules=loadDzenRules();

  editor.addEventListener('paste',()=>{inputWasPaste=true});
  editor.addEventListener('input',()=>{
    if(replacementState)closeReplacement();
    if(nearbyState)closeNearbyRepeat();
    if(repeatNavState&&typeof scheduleRepeatNavigatorRefresh==='function')scheduleRepeatNavigatorRefresh();
    if(typeof issueNavState!=='undefined'&&issueNavState&&typeof scheduleIssueNavigatorRefresh==='function')scheduleIssueNavigatorRefresh();
    if(spellNavState)closeSpellPanel();
    inputWasPaste=false;
    clearOnlineSpelling();
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
  applyLocalFirstUi();
  updateUserSynonymStatus();
  updateDzenRulesStatus();
  updateSpellIgnoreStatus();
  render(false);
  scheduleLocalAnalysis();
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
