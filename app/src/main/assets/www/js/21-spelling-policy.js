(function(){
'use strict';

const MODULE_VERSION='spelling-policy-1';
const YO_NORMAL='normal';
const YO_STRICT='strict';

function yoMode(){
  try{return settings&&settings.spellingYoMode===YO_STRICT?YO_STRICT:YO_NORMAL}catch(e){return YO_NORMAL}
}
function normalizeYo(value){
  return String(value||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
}
function classifySpellWord(value){
  const word=String(value||'').trim();
  if(!word)return {check:false,reason:'empty'};
  if(word.length>80)return {check:false,reason:'too-long'};
  if(!/[А-Яа-яЁё]/.test(word))return {check:false,reason:'non-russian'};
  if(/[0-9]/.test(word))return {check:false,reason:'number-or-model'};
  // Latin or mixed-script names are not Russian spelling errors. GRAM04 owns
  // suspicious Cyrillic/Latin mixing, so spelling must not duplicate that signal.
  if(/[A-Za-z]/.test(word))return {check:false,reason:'product-or-mixed-script'};
  // Dotted abbreviations are tokenized into one-letter pieces; short ALL-CAPS
  // forms are conventional abbreviations. Neither is a hard spelling error.
  if(/^[А-ЯЁ]$/.test(word)||/^[А-ЯЁ]{2,12}(?:-[А-ЯЁ]{1,12})*$/.test(word))return {check:false,reason:'abbreviation'};
  // Internal capitals are a strong local signal for a product/name token.
  if(/[а-яё][А-ЯЁ]/.test(word))return {check:false,reason:'product-name'};
  if(!/^[А-Яа-яЁё]+(?:[-’'][А-Яа-яЁё]+)*$/.test(word))return {check:false,reason:'unsupported-shape'};
  return {check:true,reason:word.includes('-')?'hyphenated':'word'};
}
function adaptSuggestionCase(source,suggestion){
  const src=String(source||''),value=String(suggestion||'');
  if(!value)return value;
  if(src&&src===src.toLocaleUpperCase('ru-RU'))return value.toLocaleUpperCase('ru-RU');
  if(/^[А-ЯЁ][а-яё]+(?:[-’'][А-Яа-яЁё]+)*$/.test(src))return value.charAt(0).toLocaleUpperCase('ru-RU')+value.slice(1);
  return value;
}
function normalizedSuggestions(issue){
  const source=String(issue&&issue.word||issue&&issue.fragment||'');
  const raw=Array.isArray(issue&&issue.suggestions)?issue.suggestions:[];
  const out=[],seen=new Set();
  for(const item of raw){
    const value=adaptSuggestionCase(source,String(item||'').trim());
    const key=value.toLocaleLowerCase('ru-RU');
    if(!value||seen.has(key))continue;
    seen.add(key);out.push(value);if(out.length>=5)break;
  }
  return out;
}
function yoEquivalentSuggestions(word,suggestions){
  const source=String(word||''),key=normalizeYo(source);
  return (suggestions||[]).filter(value=>String(value)!==source&&normalizeYo(value)===key&&/[Ёё]/.test(String(value)));
}
function rewriteIssueByPolicy(issue){
  if(!issue||issue.type!=='spelling')return {keep:true,changed:false};
  const word=String(issue.word||issue.fragment||'');
  const classification=classifySpellWord(word);
  if(!classification.check)return {keep:false,changed:true,reason:classification.reason};

  const suggestions=normalizedSuggestions(issue);
  issue.suggestions=suggestions;
  issue.fixes=suggestions.map(value=>({label:value,replacement:value}));
  const yo=yoEquivalentSuggestions(word,suggestions);
  if(yo.length){
    if(yoMode()===YO_NORMAL)return {keep:false,changed:true,reason:'yo-equivalent-normal-mode'};
    const ordered=yo.concat(suggestions.filter(value=>!yo.includes(value))).slice(0,5);
    issue.ruleId='spelling.yo';
    issue.kind='error';
    issue.confidence=0.99;
    issue.title='Проверьте букву «ё»: «'+word+'»';
    issue.detail='Строгий режим «ё». Вариант: '+yo[0];
    issue.suggestions=ordered;
    issue.fixes=ordered.map(value=>({label:value,replacement:value}));
    issue.moduleVersion=MODULE_VERSION;
    return {keep:true,changed:true,reason:'yo-strict'};
  }

  if(classification.reason==='hyphenated'){
    issue.ruleId='spelling.hyphenated-word';
    issue.kind='recommendation';
    issue.confidence=0.78;
    issue.title='Проверьте дефисное написание: «'+word+'»';
    issue.detail=suggestions.length?'Hunspell не принял слово целиком. Возможные варианты: '+suggestions.join(', '):'Hunspell не принял дефисное слово целиком. Проверьте дефис и написание частей.';
    issue.moduleVersion=MODULE_VERSION;
    return {keep:true,changed:true,reason:'hyphenated'};
  }

  issue.moduleVersion=MODULE_VERSION;
  return {keep:true,changed:true,reason:'ordinary'};
}
function recalcAfterPolicy(){
  try{if(typeof recountP0Analysis==='function')recountP0Analysis()}catch(e){}
  try{if(typeof renderAnalysis==='function')renderAnalysis()}catch(e){}
  try{if(typeof updateAnalysisDot==='function')updateAnalysisDot()}catch(e){}
}
function applyPolicyToCurrentIssues(shouldRender=true){
  if(!currentAnalysis||!Array.isArray(currentAnalysis.issues))return {kept:0,removed:0};
  let kept=0,removed=0;
  for(let i=currentAnalysis.issues.length-1;i>=0;i--){
    const issue=currentAnalysis.issues[i];
    if(!issue||issue.type!=='spelling')continue;
    const result=rewriteIssueByPolicy(issue);
    if(!result.keep){currentAnalysis.issues.splice(i,1);removed++;}else kept++;
  }
  if(shouldRender)recalcAfterPolicy();
  return {kept,removed};
}

// Keep exactly one Android native callback. The Hunspell module owns it; this
// policy layer hooks the common recount/render boundary used after a batch.
const previousRecalc=typeof window.recalcAndRender==='function'?window.recalcAndRender:null;
if(previousRecalc){
  window.recalcAndRender=function(){
    applyPolicyToCurrentIssues(false);
    return previousRecalc.apply(this,arguments);
  };
}

function setYoMode(mode){
  const next=mode===YO_STRICT?YO_STRICT:YO_NORMAL;
  try{settings.spellingYoMode=next}catch(e){return false}
  try{if(typeof persistSettings==='function'&&!persistSettings())return false}catch(e){}
  if(currentAnalysis&&Array.isArray(currentAnalysis.issues)){
    for(let i=currentAnalysis.issues.length-1;i>=0;i--)if(currentAnalysis.issues[i]&&currentAnalysis.issues[i].type==='spelling')currentAnalysis.issues.splice(i,1);
  }
  try{if(typeof markAnalysisStale==='function')markAnalysisStale()}catch(e){}
  try{if(typeof analyzeText==='function')analyzeText()}catch(e){}
  syncPolicyUi();
  try{if(typeof toast==='function')toast(next===YO_STRICT?'Орфография: строгий режим «ё»':'Орфография: «е» и «ё» считаются эквивалентными') }catch(e){}
  return true;
}
function ensurePolicyUi(){
  if(typeof document==='undefined'||typeof document.querySelector!=='function')return;
  const body=document.querySelector('#spellingDictionarySettings .settingsGroupBody');
  if(!body||document.querySelector('#spellingPolicySettings'))return;
  const root=document.createElement('div');root.id='spellingPolicySettings';
  root.innerHTML='<div class="subLabel"><span>Буква «ё»</span></div><select data-spelling-yo-mode><option value="normal">Обычный режим: е/ё эквивалентны</option><option value="strict">Строгий режим: предлагать ё</option></select><div class="smallNote">Строгий режим срабатывает, когда Hunspell отвергает форму с «е» и предлагает эквивалентную форму с «ё». Числа и модели, латиница, product-like токены и короткие аббревиатуры не считаются русскими орфографическими ошибками. Непринятые дефисные слова показываются как рекомендация.</div>';
  body.insertBefore(root,body.firstChild||null);
  const select=root.querySelector('[data-spelling-yo-mode]');if(select)select.onchange=function(){setYoMode(this.value)};
  syncPolicyUi();
}
function syncPolicyUi(){
  if(typeof document==='undefined'||typeof document.querySelector!=='function')return;
  const select=document.querySelector('[data-spelling-yo-mode]');if(select)select.value=yoMode();
}
function installUiSoon(){
  ensurePolicyUi();
  if(typeof document!=='undefined'&&typeof document.querySelector==='function'&&!document.querySelector('#spellingPolicySettings')&&typeof setTimeout==='function')setTimeout(ensurePolicyUi,120);
}
try{
  if(typeof openSettings==='function'){
    const previousOpenSettings=openSettings;
    openSettings=function(){const out=previousOpenSettings();installUiSoon();syncPolicyUi();return out};
    window.openSettings=openSettings;
  }
}catch(e){}
if(typeof document!=='undefined'){
  if(document.readyState==='loading'&&typeof document.addEventListener==='function')document.addEventListener('DOMContentLoaded',installUiSoon,{once:true});else installUiSoon();
}

window.setSpellingYoMode=setYoMode;
window.SpellingPolicy={MODULE_VERSION,YO_NORMAL,YO_STRICT,yoMode,normalizeYo,classifySpellWord,adaptSuggestionCase,yoEquivalentSuggestions,rewriteIssueByPolicy,applyPolicyToCurrentIssues,setYoMode};
})();
