function aiTextCheckConfigured(){
  return typeof dzenAiBridgeAvailable==='function'&&dzenAiBridgeAvailable()&&
    typeof dzenAiHasKey==='function'&&dzenAiHasKey()&&
    !!String(settings.dzenAiBaseUrl||'').trim()&&!!String(settings.dzenAiModel||'').trim();
}
function continueManualAiCheck(src,prefix=''){
  if(!aiTextCheckConfigured()){
    setCheckRunning(false);
    toast((prefix?prefix+' · ':'')+'AI-проверка не настроена. Укажите API, модель и ключ в настройках');
    return;
  }
  toast((prefix?prefix+' · ':'')+'запускаю AI-проверку…');
  startAiDzenArticleCheck(String(src||editor.value||''));
}
function runFullCheck(){
  const src=editor.value||'';
  if(!src.trim()){toast('Нет текста для проверки');return}
  editor.blur();
  setCheckRunning(true);
  toast(src.length>150000?'Обновляю локальную проверку большого текста…':'Обновляю локальную проверку…');
  setTimeout(()=>{
    try{
      analyzeText();
      analysisMode='problems';
      document.getElementById('analysisBackdrop')?.classList.add('open');
      renderAnalysis();
      continueManualAiCheck(src,'Локальная проверка готова');
    }catch(e){
      setCheckRunning(false);
      toast('Не удалось завершить проверку');
      console.error(e);
    }
  },60);
}

// Compatibility no-op for old navigation/history calls. The online spelling
// panel and its network workflow are retired; language checking belongs to AI.
function closeSpellPanel(){
  spellNavState=null;
  const panel=document.getElementById('spellPanel');
  if(panel)panel.classList.remove('open');
}
function closeAnalysis(){document.getElementById('analysisBackdrop').classList.remove('open')}
function openAnalysis(){
  editor.blur();
  setCheckRunning(true);
  setTimeout(()=>{
    try{
      analyzeText();
      analysisMode='problems';
      document.getElementById('analysisBackdrop').classList.add('open');
      renderAnalysis();
    }finally{setCheckRunning(false)}
  },40);
}
function analysisBackdropClick(e){if(e.target.id==='analysisBackdrop')closeAnalysis()}
