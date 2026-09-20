function activeCorrectionPanel(){for(const id of ['replacePanel','nearbyPanel','repeatNavPanel','spellPanel','issueNavPanel']){const el=document.getElementById(id);if(el&&el.classList.contains('open'))return el}return null}
function closeAllCorrectionPanels(){
  try{if(replacementState)closeReplacement()}catch(e){}
  try{if(nearbyState)closeNearbyRepeat()}catch(e){}
  try{if(repeatNavState)closeRepeatNavigator()}catch(e){}
  try{if(issueNavState)closeIssueNavigator()}catch(e){}
  try{if(spellNavState)closeSpellPanel()}catch(e){}
}
function textareaCaretContentTop(pos){const cs=getComputedStyle(editor),mirror=document.createElement('div');mirror.style.position='fixed';mirror.style.left='-10000px';mirror.style.top='0';mirror.style.visibility='hidden';mirror.style.pointerEvents='none';mirror.style.whiteSpace='pre-wrap';mirror.style.overflowWrap='break-word';mirror.style.wordBreak=cs.wordBreak||'normal';mirror.style.boxSizing=cs.boxSizing;mirror.style.width=editor.offsetWidth+'px';mirror.style.padding=cs.padding;mirror.style.border=cs.border;mirror.style.fontFamily=cs.fontFamily;mirror.style.fontSize=cs.fontSize;mirror.style.fontWeight=cs.fontWeight;mirror.style.fontStyle=cs.fontStyle;mirror.style.letterSpacing=cs.letterSpacing;mirror.style.lineHeight=cs.lineHeight;mirror.style.tabSize=cs.tabSize||'8';mirror.textContent=editor.value.slice(0,Math.max(0,pos));const marker=document.createElement('span');marker.textContent='\u200b';mirror.appendChild(marker);document.body.appendChild(mirror);const top=marker.offsetTop;mirror.remove();return top}
function ensureSelectionVisible(start,end){if(!editor||!editor.offsetWidth)return;if(editor.value.length>120000)return;const er=editor.getBoundingClientRect();if(!er.height)return;const vv=window.visualViewport;const viewportTop=vv?vv.offsetTop:0,viewportBottom=vv?vv.offsetTop+vv.height:window.innerHeight;let visibleTop=Math.max(er.top,viewportTop)+12,visibleBottom=Math.min(er.bottom,viewportBottom)-12;const panel=activeCorrectionPanel();if(panel){const pr=panel.getBoundingClientRect();if(pr.height&&pr.top>visibleTop)visibleBottom=Math.min(visibleBottom,pr.top-12)}if(visibleBottom-visibleTop<80)return;const contentTop=textareaCaretContentTop(start),targetY=visibleTop+(visibleBottom-visibleTop)*0.43,maxScroll=Math.max(0,editor.scrollHeight-editor.clientHeight),desired=contentTop-(targetY-er.top);editor.scrollTop=Math.max(0,Math.min(maxScroll,desired))}
let selectionVisibilityTimer=null;function scheduleSelectionVisibility(delay=40){if(!activeCorrectionPanel())return;clearTimeout(selectionVisibilityTimer);selectionVisibilityTimer=setTimeout(()=>ensureSelectionVisible(editor.selectionStart,editor.selectionEnd),delay)}
if(window.visualViewport){window.visualViewport.addEventListener('resize',()=>scheduleSelectionVisibility(55));window.visualViewport.addEventListener('scroll',()=>scheduleSelectionVisibility(55))}window.addEventListener('resize',()=>scheduleSelectionVisibility(55));
function jumpTo(start,end,quiet=false){
  document.getElementById('analysisBackdrop').classList.remove('open');
  showPane('edit');
  setTimeout(()=>{
    const s=Math.max(0,start),e=Math.max(s,end);
    editor.focus();
    editor.setSelectionRange(s,e);

    // For normal articles, compensate for the correction panel once after the
    // browser has scrolled the textarea. For very large articles the hidden
    // mirror would copy a huge prefix and cause visible pauses; WebView's native
    // textarea selection scrolling is faster and sufficiently accurate.
    if(editor.value.length<=120000){
      requestAnimationFrame(()=>ensureSelectionVisible(s,e));
      setTimeout(()=>ensureSelectionVisible(s,e),160);
    }

    if(!quiet){
      const h=document.getElementById('highlightHint');
      h.classList.add('show');
      setTimeout(()=>h.classList.remove('show'),1200);
    }
  },55);
}

let issueNavState=null;
let issueNavRefreshTimer=null;

function scheduleIssueNavigatorRefresh(){
  if(!issueNavState)return;
  const type=issueNavState.type;
  const current=issueNavState.issues[issueNavState.index]||null;
  const anchor=current&&Number.isFinite(current.start)?current.start:editor.selectionStart||0;
  clearTimeout(issueNavRefreshTimer);
  const delay=editor.value.length>120000?1100:520;
  issueNavRefreshTimer=setTimeout(function(){
    if(!issueNavState||issueNavState.type!==type)return;
    try{analyzeText()}catch(e){return}
    const same=currentAnalysis.issues.filter(function(x){return x.type===type});
    if(!same.length){
      closeIssueNavigator();
      toast('Замечания этого типа исправлены');
      return;
    }
    let nextIndex=same.findIndex(function(x){return Number(x.start)>anchor+1});
    if(nextIndex<0){
      nextIndex=same.findIndex(function(x){return Number(x.start)>=Math.max(0,anchor-2)});
    }
    if(nextIndex<0)nextIndex=0;
    issueNavState={type:type,issues:same,index:nextIndex};
    renderIssueNavigator();
  },delay);
}

function issueTypeLabel(type){
  const group=(typeof issueGroups==='function'?issueGroups():[]).find(x=>x.id===type);
  return group?group.name:'Замечания';
}
function openIssueNavigator(issueIndex){
  const issue=currentAnalysis.issues[issueIndex];
  if(!issue)return;
  const same=currentCheckMode()==='both'?currentAnalysis.issues.filter(x=>x.type===issue.type):currentAnalysis.issues.filter(x=>x.type===issue.type&&!!x.ai===!!issue.ai);
  if(same.length<2){jumpTo(issue.start,issue.end);return}
  closeAnalysis();
  if(replacementState)closeReplacement();
  if(nearbyState)closeNearbyRepeat();
  if(repeatNavState)closeRepeatNavigator();
  if(typeof spellNavState!=='undefined'&&spellNavState)closeSpellPanel();
  let index=same.indexOf(issue);
  if(index<0)index=0;
  issueNavState={type:issue.type,issues:same,index};
  showPane('edit');
  renderIssueNavigator();
  jumpIssueNavigator(true);
}
function renderIssueNavigator(){
  const panel=document.getElementById('issueNavPanel');
  if(!panel)return;
  if(!issueNavState||!issueNavState.issues.length){panel.classList.remove('open');return}
  const total=issueNavState.issues.length;
  issueNavState.index=((issueNavState.index%total)+total)%total;
  const issue=issueNavState.issues[issueNavState.index];
  document.getElementById('issueNavType').textContent=issueTypeLabel(issue.type);
  document.getElementById('issueNavCount').textContent=(issueNavState.index+1)+' из '+total;
  document.getElementById('issueNavTitle').textContent=issue.title||'Замечание';
  let detail=String(issue.detail||'').replace(/\s+/g,' ').trim();
  if(detail.length>90)detail=detail.slice(0,90)+'…';
  document.getElementById('issueNavDetail').textContent=detail;
  document.getElementById('issueNavPrev').disabled=total<2;
  document.getElementById('issueNavNext').disabled=total<2;
  const src=editor.value||'';
  const start=Number(issue.start)||0;
  const end=Math.max(start,Number(issue.end)||start);
  let context=src.slice(start,Math.min(src.length,Math.max(end,start+100))).replace(/\s+/g,' ').trim();
  if(context.length>100)context=context.slice(0,100)+'…';
  document.getElementById('issueNavContext').textContent=context||String(issue.title||'Замечание');
  panel.classList.add('open');
}
function navigateIssueNavigator(dir){
  if(!issueNavState)return;
  issueNavState.index+=dir;
  renderIssueNavigator();
  jumpIssueNavigator(true);
}
function jumpIssueNavigator(quiet=false){
  if(!issueNavState)return;
  const issue=issueNavState.issues[issueNavState.index];
  jumpTo(issue.start,issue.end,true);
  if(!quiet)toast((issueNavState.index+1)+' из '+issueNavState.issues.length);
}
function closeIssueNavigator(){
  clearTimeout(issueNavRefreshTimer);
  issueNavState=null;
  const panel=document.getElementById('issueNavPanel');
  if(panel)panel.classList.remove('open');
}

let repeatNavState=null;
let repeatNavRefreshTimer=null;

function scheduleRepeatNavigatorRefresh(){
  if(!repeatNavState)return;
  const state={...repeatNavState};
  const current=state.occurrences[state.index]||null;
  const anchor=current&&Number.isFinite(current.start)?current.start:(editor.selectionStart||0);
  clearTimeout(repeatNavRefreshTimer);
  const delay=editor.value.length>120000?1100:520;
  repeatNavRefreshTimer=setTimeout(function(){
    if(!repeatNavState||repeatNavState.type!==state.type)return;
    try{analyzeText()}catch(e){return}
    const candidates=currentAnalysis.issues.filter(function(issue){
      return issue.type===state.type&&Array.isArray(issue.occurrences)&&issue.occurrences.length>1;
    });
    if(!candidates.length){
      closeRepeatNavigator();
      toast('Совпадения этого типа исправлены');
      return;
    }
    let issue=candidates.find(function(x){
      return (x.navTitle||x.title)===state.title;
    })||candidates.find(function(x){
      return x.occurrences.some(function(o){return Number(o.start)>=Math.max(0,anchor-2)});
    })||candidates[0];

    const occ=issue.occurrences;
    let index=occ.findIndex(function(o){return Number(o.start)>anchor+1});
    if(index<0)index=occ.findIndex(function(o){return Number(o.start)>=Math.max(0,anchor-2)});
    if(index<0)index=0;
    repeatNavState={
      type:issue.type,
      issueIndex:currentAnalysis.issues.indexOf(issue),
      index:index,
      occurrences:occ,
      title:issue.navTitle||issue.title
    };
    renderRepeatNavigator();
  },delay);
}

function repeatContextMarkup(occ){const src=editor.value||'';let a=Number.isFinite(occ.contextStart)?occ.contextStart:Math.max(0,occ.start-90),b=Number.isFinite(occ.contextEnd)?occ.contextEnd:Math.min(src.length,occ.end+110);if(!Number.isFinite(occ.contextStart)){const left=src.lastIndexOf('\n',occ.start-1);if(left>=0)a=Math.max(a,left+1);const right=src.indexOf('\n',occ.end);if(right>=0)b=Math.min(b,right)}const full=src.slice(a,b).replace(/^\s+|\s+$/g,'');const trimLeft=src.slice(a,b).indexOf(full),base=a+Math.max(0,trimLeft),hs=Math.max(0,occ.start-base),he=Math.max(hs,Math.min(full.length,occ.end-base));return `${escapeHtml(full.slice(0,hs))}<span class="repeatNavHit">${escapeHtml(full.slice(hs,he))}</span>${escapeHtml(full.slice(he))}`}
function openRepeatNavigator(issueIndex){const issue=currentAnalysis.issues[issueIndex];if(!issue||!Array.isArray(issue.occurrences)||issue.occurrences.length<2){if(issue)jumpTo(issue.start,issue.end);return}closeAnalysis();if(replacementState)closeReplacement();if(nearbyState)closeNearbyRepeat();repeatNavState={type:issue.type,issueIndex,index:0,occurrences:issue.occurrences,title:issue.navTitle||issue.title};showPane('edit');renderRepeatNavigator();jumpRepeatOccurrence(true)}
function renderRepeatNavigator(){const panel=document.getElementById('repeatNavPanel');if(!repeatNavState){panel.classList.remove('open');return}const total=repeatNavState.occurrences.length;repeatNavState.index=((repeatNavState.index%total)+total)%total;const occ=repeatNavState.occurrences[repeatNavState.index];document.getElementById('repeatNavTitle').textContent=repeatNavState.title;document.getElementById('repeatNavCount').textContent=`${repeatNavState.index+1} из ${total} совпадений`;document.getElementById('repeatNavPrev').disabled=total<2;document.getElementById('repeatNavNext').disabled=total<2;document.getElementById('repeatNavContext').innerHTML=repeatContextMarkup(occ);panel.classList.add('open')}
function navigateRepeatOccurrence(dir){if(!repeatNavState)return;repeatNavState.index+=dir;renderRepeatNavigator();jumpRepeatOccurrence(true)}
function jumpRepeatOccurrence(quiet=false){if(!repeatNavState)return;const occ=repeatNavState.occurrences[repeatNavState.index];jumpTo(occ.start,occ.end,true);if(!quiet)toast(`${repeatNavState.index+1} из ${repeatNavState.occurrences.length}`)}
function closeRepeatNavigator(){clearTimeout(repeatNavRefreshTimer);repeatNavState=null;document.getElementById('repeatNavPanel').classList.remove('open')}
let nearbyState=null;
function nearbySentenceMarkup(sentenceStart,sentenceEnd,wordStart,wordEnd,label){const src=editor.value||'',full=src.slice(sentenceStart,sentenceEnd),a=Math.max(0,Math.min(full.length,wordStart-sentenceStart)),b=Math.max(a,Math.min(full.length,wordEnd-sentenceStart));return `<span class="nearbyLabel">${label}</span>${escapeHtml(full.slice(0,a))}<span class="nearbyHit">${escapeHtml(full.slice(a,b))}</span>${escapeHtml(full.slice(b))}`}
function openNearbyRepeat(pairStart,pairEnd,start,end,firstSentenceStart,firstSentenceEnd,secondSentenceStart,secondSentenceEnd,word){document.getElementById('analysisBackdrop').classList.remove('open');if(replacementState)closeReplacement();nearbyState={pairStart,pairEnd,start,end,firstSentenceStart,firstSentenceEnd,secondSentenceStart,secondSentenceEnd,word};showPane('edit');renderNearbyRepeat();jumpTo(start,end,true)}
function renderNearbyRepeat(){const panel=document.getElementById('nearbyPanel');if(!nearbyState){panel.classList.remove('open');return}document.getElementById('nearbyWord').textContent=nearbyState.word||editor.value.slice(nearbyState.start,nearbyState.end);document.getElementById('nearbyFirst').innerHTML=nearbySentenceMarkup(nearbyState.firstSentenceStart,nearbyState.firstSentenceEnd,nearbyState.pairStart,nearbyState.pairEnd,'Первое предложение');document.getElementById('nearbySecond').innerHTML=nearbySentenceMarkup(nearbyState.secondSentenceStart,nearbyState.secondSentenceEnd,nearbyState.start,nearbyState.end,'Следующее предложение');panel.classList.add('open')}
function jumpNearbyRepeat(which){if(!nearbyState)return;const first=which===0,s=first?nearbyState.pairStart:nearbyState.start,e=first?nearbyState.pairEnd:nearbyState.end;jumpTo(s,e,true)}
function replaceNearbyRepeat(which){if(!nearbyState)return;const first=which===0,s=first?nearbyState.pairStart:nearbyState.start,e=first?nearbyState.pairEnd:nearbyState.end,w=editor.value.slice(s,e)||nearbyState.word;closeNearbyRepeat();openReplacement(s,e,w)}
function closeNearbyRepeat(){nearbyState=null;document.getElementById('nearbyPanel').classList.remove('open')}
function exactWordOccurrences(word){const re=new RegExp('(?<![A-Za-zА-Яа-яЁё0-9_])'+word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Za-zА-Яа-яЁё0-9_])','giu');return Array.from(editor.value.matchAll(re)).map(m=>({start:m.index,end:m.index+m[0].length,text:m[0]}))}
function openReplacement(start,end,word){document.getElementById('analysisBackdrop').classList.remove('open');const actual=editor.value.slice(start,end)||word;replacementState={original:actual,lookup:actual,start,end,index:0};const occ=exactWordOccurrences(actual);let idx=occ.findIndex(o=>o.start===start);replacementState.index=idx>=0?idx:0;showPane('edit');renderReplacement();jumpTo(start,end,true)}
function renderReplacement(){const panel=document.getElementById('replacePanel');if(!replacementState){panel.classList.remove('open');return}const occ=exactWordOccurrences(replacementState.original);if(!occ.length){closeReplacement();return}replacementState.index=Math.max(0,Math.min(replacementState.index,occ.length-1));const cur=occ[replacementState.index];replacementState.start=cur.start;replacementState.end=cur.end;document.getElementById('replaceWord').textContent=cur.text;document.getElementById('replaceCount').textContent=`${replacementState.index+1} из ${occ.length} совпадений`;document.getElementById('replacePrev').disabled=occ.length<2;document.getElementById('replaceNext').disabled=occ.length<2;const sug=suggestionsForWord(cur.text);const chips=document.getElementById('replaceChips');chips.innerHTML=sug.length?sug.map(x=>{const arg=JSON.stringify(x).replace(/'/g,'&#39;');return `<button class="replaceChip" onclick='applyReplacement(${arg})'>${escapeHtml(x)}</button>`}).join(''):'<span class="smallNote">Для этой формы нет готовых локальных синонимов. Можно ввести свой вариант ниже.</span>';document.getElementById('manualReplacement').value='';panel.classList.add('open')}
function navigateReplacement(dir){if(!replacementState)return;const occ=exactWordOccurrences(replacementState.original);if(!occ.length){closeReplacement();return}replacementState.index=(replacementState.index+dir+occ.length)%occ.length;const cur=occ[replacementState.index];replacementState.start=cur.start;replacementState.end=cur.end;renderReplacement();jumpTo(cur.start,cur.end,true)}
function applyReplacement(text){if(!replacementState||!text)return;const current=editor.value.slice(replacementState.start,replacementState.end);const repl=preserveCase(current,text);if(typeof historyCheckpoint==='function')historyCheckpoint();editor.setRangeText(repl,replacementState.start,replacementState.end,'select');afterProgrammaticEdit(true);toast(`Заменено: ${current} → ${repl}`);const occ=exactWordOccurrences(replacementState.original);if(occ.length){replacementState.index=Math.min(replacementState.index,occ.length-1);const cur=occ[replacementState.index];replacementState.start=cur.start;replacementState.end=cur.end;renderReplacement();jumpTo(cur.start,cur.end,true)}else closeReplacement()}
function applyManualReplacement(){const v=document.getElementById('manualReplacement').value.trim();if(v&&replacementState){const current=editor.value.slice(replacementState.start,replacementState.end)||replacementState.original;rememberUserSynonym(current,v);applyReplacement(v)}}
function closeReplacement(){replacementState=null;document.getElementById('replacePanel').classList.remove('open')}
