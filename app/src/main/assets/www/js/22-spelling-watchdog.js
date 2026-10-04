(function(){
'use strict';

const TIMEOUT_MS=8000;
let trackedDiagnostics=null;
let checkingSince=0;

function refreshTracking(){
  const analysis=typeof currentAnalysis==='object'&&currentAnalysis?currentAnalysis:null;
  const diagnostics=analysis&&analysis.spellingDiagnostics;
  if(!diagnostics||diagnostics.state!=='checking'){
    trackedDiagnostics=diagnostics||null;
    checkingSince=0;
    return;
  }
  if(diagnostics!==trackedDiagnostics){
    trackedDiagnostics=diagnostics;
    checkingSince=Date.now();
  }
  if(!checkingSince)checkingSince=Date.now();
  if(Date.now()-checkingSince<TIMEOUT_MS)return;

  try{
    if(window.AndroidSpelling&&typeof AndroidSpelling.cancel==='function')AndroidSpelling.cancel();
  }catch(e){}
  diagnostics.state='error';
  diagnostics.error='Проверка орфографии заняла больше 8 секунд. Повторите проверку; проблемный запрос отменён.';
  diagnostics.timeout=true;
  checkingSince=0;
  try{if(typeof renderAnalysis==='function')renderAnalysis()}catch(e){}
  try{if(typeof updateAnalysisDot==='function')updateAnalysisDot()}catch(e){}
}

if(typeof setInterval==='function')setInterval(refreshTracking,500);
window.SpellingWatchdog={TIMEOUT_MS,refreshTracking};
})();
