(function(){
'use strict';

const MODULE_VERSION='hunspell-ui-1';
const ALLOWED_KEY='spellingAllowedByDocumentV1';
const MAX_VISIBLE_ISSUES=160;
let requestSerial=0;
let pendingRequest=null;
const skippedOccurrences=new Set();

function normalizeWord(value){
  return String(value||'').trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
}
function isSpellToken(token){
  const word=String(token&&token.text||'');
  if(!word||word.length>80)return false;
  if(!/[А-Яа-яЁё]/.test(word))return false;
  if(/[0-9]/.test(word))return false;
  // SPELL04 will formalize abbreviation handling. Until then, avoid turning
  // short all-caps abbreviations into noisy hard errors.
  if(/^[А-ЯЁ]{2,8}$/.test(word))return false;
  return true;
}
function collectCandidates(src){
  const text=String(src||'');
  if(typeof P0Core==='undefined'||!P0Core.documentModel||!P0Core.languageWords)return [];
  const model=P0Core.documentModel(text);
  return P0Core.languageWords(text,model).filter(isSpellToken);
}
function loadAllowedMap(){
  try{
    const parsed=JSON.parse(localStorage.getItem(ALLOWED_KEY)||'{}');
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
  }catch(e){return {}}
}
function documentIdNow(){
  try{return String(currentDocumentSnapshot().documentId||'local-draft')}catch(e){return 'local-draft'}
}
function documentAllowedWords(documentId){
  const map=loadAllowedMap(),items=map[String(documentId||documentIdNow())];
  return new Set(Array.isArray(items)?items.map(normalizeWord).filter(Boolean):[]);
}
function saveDocumentAllowedWord(word){
  const key=normalizeWord(word);if(!key)return false;
  const doc=documentIdNow(),map=loadAllowedMap(),set=new Set(Array.isArray(map[doc])?map[doc].map(normalizeWord):[]);
  set.add(key);map[doc]=Array.from(set).sort();
  try{localStorage.setItem(ALLOWED_KEY,JSON.stringify(map));return true}catch(e){return false}
}
function spellingBridgeStatus(){
  if(!window.AndroidSpelling||typeof AndroidSpelling.status!=='function')return {state:'unavailable',error:'AndroidSpelling bridge unavailable'};
  try{return JSON.parse(AndroidSpelling.status()||'{}')}catch(e){return {state:'unavailable',error:String(e&&e.message||e)}}
}
function spellingSnapshotMatches(a,b){
  if(!a||!b)return false;
  return String(a.documentId||'')===String(b.documentId||'')&&Number(a.revision||0)===Number(b.revision||0)&&String(a.textHash||'')===String(b.textHash||'');
}
function occurrenceKey(snapshot,start,end,word){
  return [snapshot&&snapshot.documentId||'',snapshot&&snapshot.revision||0,start,end,normalizeWord(word)].join('|');
}
function uniqueWords(tokens,allowed){
  const out=[],seen=new Set();
  for(const token of tokens){
    const normalized=normalizeWord(token.text);if(!normalized||allowed.has(normalized))continue;
    const exact=String(token.text);if(seen.has(exact))continue;seen.add(exact);out.push(exact);
  }
  return out;
}
function setSpellingDiagnostics(patch){
  if(!currentAnalysis)return;
  currentAnalysis.spellingDiagnostics={...(currentAnalysis.spellingDiagnostics||{}),...(patch||{}),moduleVersion:MODULE_VERSION};
}
function clearSpellingIssues(){
  if(!currentAnalysis||!Array.isArray(currentAnalysis.issues))return;
  for(let i=currentAnalysis.issues.length-1;i>=0;i--)if(currentAnalysis.issues[i]&&currentAnalysis.issues[i].type==='spelling')currentAnalysis.issues.splice(i,1);
  const overflow={...(currentAnalysis.issues._overflow||currentAnalysis.issueOverflow||{})};delete overflow.spelling;
  currentAnalysis.issues._overflow=overflow;currentAnalysis.issueOverflow=overflow;
}
function recalcAndRender(){
  try{if(typeof recountP0Analysis==='function')recountP0Analysis()}catch(e){}
  try{if(typeof renderAnalysis==='function')renderAnalysis()}catch(e){}
  try{if(typeof updateAnalysisDot==='function')updateAnalysisDot()}catch(e){}
}
function queueSpellingCheck(){
  if(!currentAnalysis||!Array.isArray(currentAnalysis.issues))return;
  const status=spellingBridgeStatus();
  if(status.state!=='ready'){
    setSpellingDiagnostics({state:status.state||'unavailable',error:String(status.error||''),initMs:Number(status.initMs)||0});
    recalcAndRender();
    return;
  }
  const src=String(editor&&editor.value||''),snapshot=currentAnalysis.analysisSnapshot||(typeof currentDocumentSnapshot==='function'?currentDocumentSnapshot():null);
  if(!snapshot)return;
  const tokens=collectCandidates(src),allowed=documentAllowedWords(snapshot.documentId),words=uniqueWords(tokens,allowed);
  const requestId='spell-'+(++requestSerial)+'-'+String(snapshot.documentId||'doc')+'-'+Number(snapshot.revision||0);
  pendingRequest={requestId,snapshot:{...snapshot},src,tokens};
  setSpellingDiagnostics({state:'checking',checked:0,issues:0,error:'',initMs:Number(status.initMs)||0});
  try{
    if(typeof AndroidSpelling.cancel==='function')AndroidSpelling.cancel();
    AndroidSpelling.checkBatch(requestId,JSON.stringify(words),5);
  }catch(e){
    setSpellingDiagnostics({state:'unavailable',error:String(e&&e.message||e)});
  }
  recalcAndRender();
}
function parseNativeBatch(text){
  try{return JSON.parse(String(text||'{}'))}catch(e){return {state:'error',error:'Некорректный ответ модуля орфографии'}}
}
function createSpellingIssue(token,nativeEntry,snapshot){
  const suggestions=Array.isArray(nativeEntry.suggestions)?nativeEntry.suggestions.map(String).filter(Boolean).slice(0,5):[];
  return {
    type:'spelling',category:'spelling',kind:'error',severity:'warning',confidence:0.99,
    ruleId:'spelling.unknown-word',title:'Возможно, опечатка: «'+token.text+'»',
    detail:suggestions.length?'Варианты: '+suggestions.join(', '):'Слово не найдено во встроенном словаре.',
    start:token.start,end:token.end,fragment:token.text,word:token.text,
    fixes:suggestions.map(x=>({label:x,replacement:x})),suggestions,
    documentId:String(snapshot.documentId||''),revision:Number(snapshot.revision||0),moduleVersion:'hunspell-1.7.2'
  };
}
window.onNativeSpellingBatch=function(requestId,payload){
  const request=pendingRequest;if(!request||String(requestId)!==request.requestId)return;
  const data=parseNativeBatch(payload);
  if(data.state!=='ready'){
    setSpellingDiagnostics({state:data.state||'error',error:String(data.error||'Ошибка Hunspell')});recalcAndRender();return;
  }
  let current=null;try{current=currentDocumentSnapshot()}catch(e){}
  if(!current||!spellingSnapshotMatches(request.snapshot,current))return;
  if(String(editor&&editor.value||'')!==request.src)return;
  const miss=new Map();
  for(const item of Array.isArray(data.misspelled)?data.misspelled:[])if(item&&item.word)miss.set(String(item.word),item);
  clearSpellingIssues();
  const allowed=documentAllowedWords(request.snapshot.documentId),issues=currentAnalysis.issues;let hidden=0,shown=0;
  for(const token of request.tokens){
    const entry=miss.get(String(token.text));if(!entry)continue;
    if(allowed.has(normalizeWord(token.text)))continue;
    if(skippedOccurrences.has(occurrenceKey(request.snapshot,token.start,token.end,token.text)))continue;
    if(shown>=MAX_VISIBLE_ISSUES){hidden++;continue}
    issues.push(createSpellingIssue(token,entry,request.snapshot));shown++;
  }
  const overflow={...(issues._overflow||currentAnalysis.issueOverflow||{})};if(hidden)overflow.spelling=hidden;else delete overflow.spelling;
  issues._overflow=overflow;currentAnalysis.issueOverflow=overflow;
  setSpellingDiagnostics({state:'ready',checked:Number(data.checked)||0,issues:shown+hidden,visible:shown,hidden,durationMs:Number(data.durationMs)||0,error:''});
  pendingRequest=null;recalcAndRender();
};
window.onNativeSpellingReady=function(payload){
  const status=parseNativeBatch(payload);setSpellingDiagnostics({state:status.state||'unavailable',error:String(status.error||''),initMs:Number(status.initMs)||0});
  if(status.state==='ready'&&currentAnalysis&&Array.isArray(currentAnalysis.issues))queueSpellingCheck();else recalcAndRender();
};
window.onNativeSpellingUserWordsChanged=function(){
  if(currentAnalysis&&Array.isArray(currentAnalysis.issues))queueSpellingCheck();
};
function removeMatchingSpellingIssues(test){
  if(!currentAnalysis||!Array.isArray(currentAnalysis.issues))return;
  for(let i=currentAnalysis.issues.length-1;i>=0;i--){const issue=currentAnalysis.issues[i];if(issue&&issue.type==='spelling'&&test(issue))currentAnalysis.issues.splice(i,1)}
  recalcAndRender();
}
function applySpellingFix(start,end,fragment,replacement){
  const snapshot=currentAnalysis&&currentAnalysis.analysisSnapshot;if(!snapshot)return false;
  const ok=typeof applyDocumentEdits==='function'&&applyDocumentEdits([{start:Number(start),end:Number(end),expected:String(fragment),replacement:String(replacement)}],snapshot,'spelling fix');
  if(ok){try{markAnalysisStale()}catch(e){};toast('Исправлено: '+replacement)}
  return !!ok;
}
function skipSpellingOccurrence(start,end,word){
  const snapshot=currentAnalysis&&currentAnalysis.analysisSnapshot;if(!snapshot)return;
  skippedOccurrences.add(occurrenceKey(snapshot,Number(start),Number(end),word));
  removeMatchingSpellingIssues(i=>i.start===Number(start)&&i.end===Number(end)&&normalizeWord(i.word)===normalizeWord(word));
  toast('Замечание пропущено для этой версии текста');
}
function allowSpellingWord(word){
  if(!saveDocumentAllowedWord(word)){toast('Не удалось сохранить разрешённое слово');return false}
  const key=normalizeWord(word);removeMatchingSpellingIssues(i=>normalizeWord(i.word)===key);toast('Слово разрешено в этой статье');return true;
}
function addSpellingUserWord(word){
  if(!window.AndroidSpelling||typeof AndroidSpelling.addUserWord!=='function'){toast('Личный словарь недоступен');return false}
  let ok=false;try{ok=!!AndroidSpelling.addUserWord(String(word||''))}catch(e){}
  if(!ok){toast('Не удалось добавить слово в личный словарь');return false}
  const key=normalizeWord(word);removeMatchingSpellingIssues(i=>normalizeWord(i.word)===key);toast('Добавлено в личный словарь');return true;
}
window.applySpellingFix=applySpellingFix;
window.skipSpellingOccurrence=skipSpellingOccurrence;
window.allowSpellingWord=allowSpellingWord;
window.addSpellingUserWord=addSpellingUserWord;

function jsArg(value){return JSON.stringify(String(value==null?'':value)).replace(/'/g,'\\u0027').replace(/</g,'\\u003c')}
function spellingIssueHtml(i){
  const suggestions=Array.isArray(i.suggestions)?i.suggestions.slice(0,5):[];
  const jump='jumpTo('+Number(i.start)+','+Number(i.end)+')';
  let actions='';
  suggestions.forEach((suggestion,index)=>{
    const label=(index===0?'Исправить → ':'')+suggestion;
    actions+='<button class="nativeBtn" type="button" onclick=\'event.stopPropagation();applySpellingFix('+Number(i.start)+','+Number(i.end)+','+jsArg(i.fragment)+','+jsArg(suggestion)+')\'>'+escapeHtml(label)+'</button>';
  });
  actions+='<button class="nativeBtn" type="button" onclick=\'event.stopPropagation();skipSpellingOccurrence('+Number(i.start)+','+Number(i.end)+','+jsArg(i.word)+')\'>Пропустить</button>';
  actions+='<button class="nativeBtn" type="button" onclick=\'event.stopPropagation();allowSpellingWord('+jsArg(i.word)+')\'>Разрешить</button>';
  actions+='<button class="nativeBtn" type="button" onclick=\'event.stopPropagation();addSpellingUserWord('+jsArg(i.word)+')\'>В словарь</button>';
  return '<div class="spellingCard"><button class="analysisRow jump" type="button" onclick="'+jump+'"><span class="warn">'+escapeHtml(i.title)+'</span><span class="meta">'+escapeHtml(i.detail||'')+' · ошибка · нажмите для перехода</span></button><div class="settingActions">'+actions+'</div></div>';
}

if(typeof issueGroups==='function'){
  const priorIssueGroups=issueGroups;
  issueGroups=function(){
    const groups=priorIssueGroups();if(!groups.some(x=>x.id==='spelling'))groups.unshift({id:'spelling',name:'Орфография'});return groups;
  };
  window.issueGroups=issueGroups;
}
if(typeof issueHtml==='function'){
  const priorIssueHtml=issueHtml;
  issueHtml=function(issue){return issue&&issue.type==='spelling'?spellingIssueHtml(issue):priorIssueHtml(issue)};
  window.issueHtml=issueHtml;
}
if(typeof renderAnalysis==='function'){
  const priorRenderAnalysis=renderAnalysis;
  renderAnalysis=function(){
    const out=priorRenderAnalysis();
    const summary=document.getElementById('analysisSummary'),d=currentAnalysis&&currentAnalysis.spellingDiagnostics;
    if(summary&&d){
      let text='';
      if(d.state==='checking'||d.state==='initializing')text='Орфография: проверяется…';
      else if(d.state==='ready')text='Орфография: проверено '+Number(d.checked||0)+' уникальных слов'+(Number(d.durationMs)>0?' за '+Number(d.durationMs).toFixed(0)+' мс':'')+'.';
      else if(d.state==='unavailable'||d.state==='error')text='Орфография недоступна'+(d.error?': '+String(d.error):'.');
      if(text)summary.insertAdjacentHTML('beforeend',' <span class="smallNote">'+escapeHtml(text)+'</span>');
    }
    return out;
  };
  window.renderAnalysis=renderAnalysis;
}
if(typeof analyzeText==='function'){
  const priorAnalyzeText=analyzeText;
  analyzeText=function(){
    const oldAnalysis=currentAnalysis,oldSnapshot=oldAnalysis&&oldAnalysis.analysisSnapshot,oldSpelling=oldAnalysis&&Array.isArray(oldAnalysis.issues)?oldAnalysis.issues.filter(x=>x&&x.type==='spelling'):[];
    const result=priorAnalyzeText();
    const nextSnapshot=currentAnalysis&&currentAnalysis.analysisSnapshot;
    if(oldSpelling.length&&oldSnapshot&&nextSnapshot&&spellingSnapshotMatches(oldSnapshot,nextSnapshot)){
      for(const issue of oldSpelling)currentAnalysis.issues.push(issue);
      try{if(typeof recountP0Analysis==='function')recountP0Analysis()}catch(e){}
    }
    queueSpellingCheck();
    return result;
  };
  window.analyzeText=analyzeText;
}

window.SpellingHunspell={MODULE_VERSION,normalizeWord,isSpellToken,collectCandidates,documentAllowedWords,queueSpellingCheck};
})();
