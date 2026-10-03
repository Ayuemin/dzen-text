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
function closeSpellPanel(){}
function closeAnalysis(){document.getElementById('analysisBackdrop').classList.remove('open')}
function openAnalysis(){editor.blur();setCheckRunning(true);setTimeout(()=>{try{analyzeText();document.getElementById('analysisBackdrop').classList.add('open');setAnalysisMode(analysisMode)}finally{setCheckRunning(false)}},40)}
function analysisBackdropClick(e){if(e.target.id==='analysisBackdrop')closeAnalysis()}
