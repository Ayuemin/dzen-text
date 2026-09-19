function runFullCheck(){
 const src=editor.value||'';
 if(!src.trim()){toast('Нет текста для проверки');return}
 editor.blur();
 clearOnlineSpelling();
 setCheckRunning(true);
 toast(src.length>150000?'Проверяю большой текст…':'Проверяю текст…');
 setTimeout(()=>{
   try{
     analyzeText();
     analysisMode='problems';
     document.getElementById('analysisBackdrop').classList.add('open');
     setAnalysisMode('problems');

     if(!settings.onlineSpelling){
       spellStatus='off';
       renderAnalysis();
       setCheckRunning(false);
       toast('Полная локальная проверка выполнена');
       return;
     }
     if(!(window.AndroidSpell&&typeof AndroidSpell.check==='function')){
       spellStatus='error';
       renderAnalysis();
       setCheckRunning(false);
       toast('Онлайн-проверка доступна только в установленном приложении');
       return;
     }
     spellStatus='checking';
     spellRequestSource=src;
     spellRequestId=String(Date.now())+'_'+Math.random().toString(36).slice(2);
     renderAnalysis();
     AndroidSpell.check(src,spellRequestId);
   }catch(e){
     setCheckRunning(false);
     toast('Не удалось завершить проверку');
     console.error(e);
   }
 },60);
}
window.onNativeSpellResult=(requestId,items)=>{if(String(requestId)!==String(spellRequestId))return;setCheckRunning(false);if(editor.value!==spellRequestSource){spellStatus='stale';toast('Текст изменился во время проверки — результат отброшен');return}onlineSpellIssues=(Array.isArray(items)?items:[]).map(x=>({start:+x.start||0,end:+x.end||0,word:String(x.word||''),suggestions:Array.isArray(x.suggestions)?x.suggestions.map(String):[],code:+x.code||0})).filter(x=>x.end>x.start&&!spellIgnoreWords.has(spellKey(x.word||editor.value.slice(x.start,x.end))));onlineSpellSource=editor.value;spellStatus='done';analyzeText();document.getElementById('analysisBackdrop').classList.add('open');setAnalysisMode('problems');toast(onlineSpellIssues.length?`Орфография: найдено ${onlineSpellIssues.length}`:'Орфографических ошибок не найдено')};
window.onNativeSpellError=(requestId,msg)=>{if(String(requestId)!==String(spellRequestId))return;setCheckRunning(false);spellStatus='error';onlineSpellIssues=[];onlineSpellSource='';renderAnalysis();toast(msg||'Не удалось выполнить онлайн-проверку')};
function openSpellIssue(issueIndex){const issue=currentAnalysis.issues[issueIndex];if(!issue||issue.type!=='spelling'){return}const list=currentAnalysis.issues.filter(x=>x.type==='spelling');const idx=Math.max(0,list.indexOf(issue));spellNavState={issues:list,index:idx};closeAnalysis();if(replacementState)closeReplacement();if(nearbyState)closeNearbyRepeat();if(repeatNavState)closeRepeatNavigator();showPane('edit');renderSpellPanel();jumpSpellIssue(true)}
function renderSpellPanel(){const panel=document.getElementById('spellPanel');if(!spellNavState||!spellNavState.issues.length){panel.classList.remove('open');return}const total=spellNavState.issues.length;spellNavState.index=((spellNavState.index%total)+total)%total;const it=spellNavState.issues[spellNavState.index];document.getElementById('spellWord').textContent=it.word||editor.value.slice(it.start,it.end);document.getElementById('spellCount').textContent=`${spellNavState.index+1} из ${total}`;document.getElementById('spellPrev').disabled=total<2;document.getElementById('spellNext').disabled=total<2;const box=document.getElementById('spellSuggestions');const arr=Array.isArray(it.suggestions)?it.suggestions:[];box.innerHTML=arr.length?arr.slice(0,8).map(x=>`<button class="proofChip" onclick='applySpellSuggestion(${JSON.stringify(x).replace(/'/g,"&#39;")})'>${escapeHtml(x)}</button>`).join(''):'<span class="smallNote">Готовой замены нет — проверьте слово вручную.</span>';panel.classList.add('open')}
function navigateSpellIssue(dir){if(!spellNavState)return;spellNavState.index+=dir;renderSpellPanel();jumpSpellIssue(true)}
function jumpSpellIssue(quiet=false){if(!spellNavState)return;const it=spellNavState.issues[spellNavState.index];jumpTo(it.start,it.end,true);if(!quiet)toast(`${spellNavState.index+1} из ${spellNavState.issues.length}`)}
function applySpellSuggestion(text){if(!spellNavState||!text)return;const it=spellNavState.issues[spellNavState.index],before=editor.value.slice(it.start,it.end),repl=preserveCase(before,String(text)),delta=repl.length-(it.end-it.start);if(typeof historyCheckpoint==='function')historyCheckpoint();editor.setRangeText(repl,it.start,it.end,'select');onlineSpellIssues=onlineSpellIssues.filter(x=>!(x.start===it.start&&x.end===it.end)).map(x=>x.start>it.start?{...x,start:x.start+delta,end:x.end+delta}:x);onlineSpellSource=editor.value;spellStatus='done';spellNavState=null;document.getElementById('spellPanel').classList.remove('open');afterProgrammaticEdit(true,{keepOnlineSpelling:true});toast(`Исправлено: ${before} → ${repl}`);const next=currentAnalysis.issues.find(x=>x.type==='spelling');if(next)openSpellIssue(currentAnalysis.issues.indexOf(next))}
function ignoreCurrentSpellWord(){if(!spellNavState||!spellNavState.issues.length)return;const it=spellNavState.issues[spellNavState.index],word=editor.value.slice(it.start,it.end)||it.word,key=spellKey(word);if(!key)return;const had=spellIgnoreWords.has(key);spellIgnoreWords.add(key);if(!saveSpellIgnoreWords()){if(!had)spellIgnoreWords.delete(key);updateSpellIgnoreStatus();return}updateSpellIgnoreStatus();onlineSpellIssues=onlineSpellIssues.filter(x=>spellKey(x.word||editor.value.slice(x.start,x.end))!==key);onlineSpellSource=editor.value;spellStatus='done';spellNavState=null;document.getElementById('spellPanel').classList.remove('open');analyzeText();toast(`Запомнил: «${word}» — не ошибка`);const next=currentAnalysis.issues.find(x=>x.type==='spelling');if(next)openSpellIssue(currentAnalysis.issues.indexOf(next))}
function closeSpellPanel(){spellNavState=null;const p=document.getElementById('spellPanel');if(p)p.classList.remove('open')}
function closeAnalysis(){document.getElementById('analysisBackdrop').classList.remove('open')}
function openAnalysis(){editor.blur();setCheckRunning(true);setTimeout(()=>{try{analyzeText();document.getElementById('analysisBackdrop').classList.add('open');setAnalysisMode(analysisMode)}finally{setCheckRunning(false)}},40)}
function analysisBackdropClick(e){if(e.target.id==='analysisBackdrop')closeAnalysis()}
