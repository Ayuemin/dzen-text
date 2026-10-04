function runAnalysisWithSemanticModel(){
 window.__runLocalSemantic=true;
 try{return analyzeText()}finally{window.__runLocalSemantic=false}
}
function runDeterministicAnalysis(){
 window.__runLocalSemantic=false;
 return analyzeText()
}
function runFullCheck(){
 const src=editor.value||'';
 if(!src.trim()){toast('Нет текста для проверки');return}
 editor.blur();
 setCheckRunning(true);
 toast(src.length>150000?'Обновляю локальную проверку большого текста…':'Обновляю локальную проверку…');
 setTimeout(()=>{
   try{
     runDeterministicAnalysis();
     analysisMode='problems';
     document.getElementById('analysisBackdrop').classList.add('open');
     setAnalysisMode('problems');
     renderAnalysis();
     setCheckRunning(false);
     toast('Локальная проверка обновлена');
   }catch(e){
     setCheckRunning(false);
     toast('Не удалось завершить проверку');
     console.error(e);
   }
 },60);
}
function closeAnalysis(){document.getElementById('analysisBackdrop').classList.remove('open')}
function openAnalysis(){editor.blur();setCheckRunning(true);setTimeout(()=>{try{runDeterministicAnalysis();document.getElementById('analysisBackdrop').classList.add('open');setAnalysisMode(analysisMode)}finally{setCheckRunning(false)}},40)}
function analysisBackdropClick(e){if(e.target.id==='analysisBackdrop')closeAnalysis()}
