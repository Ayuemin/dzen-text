(function(){
'use strict';

const PACK_MAX_BYTES=2*1024*1024;
const PACK_BACKUP_KEY='editorialRulePackV1Backup';
const PACK_META_KEY='editorialRulePackV1Meta';
const PACK_DISABLED_KEY='editorialRulePackV1Disabled';
const PACK_MANUAL_KEY='editorialRulePackV1ManualMarks';

function utf8Bytes(value){
  const s=String(value==null?'':value);
  if(typeof TextEncoder!=='undefined')return new TextEncoder().encode(s).length;
  try{return unescape(encodeURIComponent(s)).length}catch(e){return s.length*3}
}
function pathError(path,message){return String(path||'$')+': '+String(message||'неверное значение')}
function rulePathErrors(input){
  const errors=[];
  if(!input||typeof input!=='object'||Array.isArray(input))return [pathError('$','ожидается объект')];
  if(input.schema!=='editorial-rule-pack-v1')errors.push(pathError('$.schema','ожидается «editorial-rule-pack-v1»'));
  if(!/^[A-Za-z0-9._-]{1,80}$/.test(String(input.id||'')))errors.push(pathError('$.id','нужен уникальный id пакета длиной 1–80'));
  if(!String(input.name||'').trim())errors.push(pathError('$.name','обязательное непустое название'));
  if(!String(input.version||'').trim())errors.push(pathError('$.version','обязательная версия'));
  if(!Array.isArray(input.rules))return errors.concat(pathError('$.rules','ожидается массив правил'));
  if(input.rules.length<1)errors.push(pathError('$.rules','массив не должен быть пустым'));
  if(input.rules.length>500)errors.push(pathError('$.rules','не более 500 правил'));
  const ids=new Set();
  const types=new Set(['word','phrase','phrase_any','phrase_all','stem','context','title_length','link_count','caps_ratio','manual']);
  const scopes=new Set(['all','title','body']);
  for(let i=0;i<input.rules.length;i++){
    const r=input.rules[i],p='$.rules['+i+']';
    if(!r||typeof r!=='object'||Array.isArray(r)){errors.push(pathError(p,'ожидается объект'));continue}
    const id=String(r.id||'');
    if(!/^[A-Za-z0-9._-]{1,80}$/.test(id))errors.push(pathError(p+'.id','неверный id'));
    else if(ids.has(id))errors.push(pathError(p+'.id','дубликат «'+id+'»'));
    else ids.add(id);
    const type=String(r.type||'');
    if(!types.has(type))errors.push(pathError(p+'.type','неизвестный тип «'+type+'»'));
    if(!String(r.title||'').trim())errors.push(pathError(p+'.title','обязательный заголовок'));
    if(!String(r.message||'').trim())errors.push(pathError(p+'.message','обязательное объяснение'));
    if(type!=='manual'&&r.scope!=null&&!scopes.has(String(r.scope)))errors.push(pathError(p+'.scope','допустимы all, title или body'));
    if(['word','phrase','phrase_any','phrase_all','stem'].includes(type)&&(!Array.isArray(r.values)||!r.values.length))errors.push(pathError(p+'.values','нужен непустой массив'));
    if(type==='context'&&(!Array.isArray(r.phrases)||!r.phrases.length)&&(!Array.isArray(r.stems)||!r.stems.length))errors.push(pathError(p,'context требует phrases и/или stems'));
  }
  return errors;
}
function prevalidatePackText(text){
  const raw=String(text==null?'':text);
  const size=utf8Bytes(raw);
  if(size>PACK_MAX_BYTES)return {ok:false,size,errors:[pathError('$','файл больше 2 МБ ('+size+' байт)')]};
  let parsed;
  try{parsed=JSON.parse(raw)}catch(e){return {ok:false,size,errors:[pathError('$','JSON не разобран: '+String(e&&e.message||e))]}}
  const errors=rulePathErrors(parsed);
  return {ok:errors.length===0,size,errors,parsed};
}
function loadJson(key,fallback){try{const v=JSON.parse(localStorage.getItem(key)||'null');return v==null?fallback:v}catch(e){return fallback}}
function saveJson(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch(e){return false}}
function packIdentity(pack){return pack?String(pack.id||'')+'@'+String(pack.version||''):''}
function disabledMap(){const value=loadJson(PACK_DISABLED_KEY,{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
function isPackRuleEnabled(ruleId){
  if(typeof activeRulePack==='undefined'||!activeRulePack)return true;
  const all=disabledMap(),set=all[packIdentity(activeRulePack)];
  return !(set&&set[String(ruleId)]===true);
}
function setPackRuleEnabled(ruleId,enabled){
  if(typeof activeRulePack==='undefined'||!activeRulePack)return;
  const all=disabledMap(),key=packIdentity(activeRulePack),set=all[key]&&typeof all[key]==='object'?all[key]:{};
  if(enabled)delete set[String(ruleId)];else set[String(ruleId)]=true;
  all[key]=set;saveJson(PACK_DISABLED_KEY,all);
  try{analyzeText()}catch(e){console.error(e)}
  try{updateRulePackStatus()}catch(e){}
}
function currentPackMeta(){const value=loadJson(PACK_META_KEY,{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
function setCurrentPackMeta(meta){saveJson(PACK_META_KEY,meta||{})}
function backupCurrentPack(){
  if(typeof activeRulePack==='undefined'||!activeRulePack)return true;
  return saveJson(PACK_BACKUP_KEY,{pack:activeRulePack,meta:currentPackMeta(),savedAt:Date.now()});
}
function backupPack(){const value=loadJson(PACK_BACKUP_KEY,null);return value&&value.pack?value:null}

function renderPackValidationError(box,errors){
  if(!box)return;
  box.innerHTML='<div class="rulePackError"><b>Формат не принят.</b><ul>'+(errors||[]).slice(0,24).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul></div>';
}
function validateRulePackTextP1(text,name){
  const box=document.querySelector('#rulePackImportResult');
  pendingRulePack=null;
  const pre=prevalidatePackText(text);
  if(!pre.ok){renderPackValidationError(box,pre.errors);const install=document.querySelector('#rulePackInstallBtn');if(install)install.hidden=true;return}
  const result=validateRulePackObject(pre.parsed);
  if(!result.ok){renderPackValidationError(box,result.errors.map(x=>pathError('$',x)));const install=document.querySelector('#rulePackInstallBtn');if(install)install.hidden=true;return}
  pendingRulePack=result.pack;
  if(box)box.innerHTML='<div class="rulePackOk"><b>'+escapeHtml(result.pack.name)+'</b> · '+escapeHtml(result.pack.version)+(name?'<br>Файл: '+escapeHtml(name):'')+'<br>Размер: <b>'+pre.size+'</b> байт · автоматических правил: <b>'+result.autoCount+'</b> · ручных: <b>'+result.manualCount+'</b>'+(result.pack.source?'<br>Источник: '+escapeHtml(result.pack.source):'')+'</div>';
  const install=document.querySelector('#rulePackInstallBtn');if(install)install.hidden=false;
}
function installPendingRulePackP1(){
  if(!pendingRulePack)return;
  if(typeof activeRulePack!=='undefined'&&activeRulePack&&!backupCurrentPack()){toast('Не удалось создать резерв предыдущего пакета. Замена отменена.');return}
  const next=pendingRulePack;
  if(!saveRulePack(next)){toast('Новый пакет не установлен');return}
  activeRulePack=next;
  setCurrentPackMeta({installedAt:Date.now(),checkedAt:0,source:String(next.source||''),identity:packIdentity(next)});
  updateRulePackStatus();closeRulePackImport();
  let analysis=null;try{analysis=analyzeText()}catch(e){console.error(e)}
  const d=analysis&&analysis.ruleDiagnostics||lastRulePackDiagnostics;
  toast('Пакет установлен. Проверено '+(d.checked||0)+' из '+(d.totalRules||activeAutoRules().length)+' правил.');
}
function restorePreviousRulePack(){
  const backup=backupPack();
  if(!backup){toast('Резерв предыдущего пакета отсутствует');return false}
  const validation=validateRulePackObject(backup.pack);
  if(!validation.ok){toast('Резерв пакета повреждён и не будет установлен');return false}
  const current=typeof activeRulePack!=='undefined'?activeRulePack:null;
  if(!saveRulePack(validation.pack)){toast('Не удалось восстановить пакет');return false}
  activeRulePack=validation.pack;
  if(current)saveJson(PACK_BACKUP_KEY,{pack:current,meta:currentPackMeta(),savedAt:Date.now()});else localStorage.removeItem(PACK_BACKUP_KEY);
  setCurrentPackMeta(backup.meta||{installedAt:Date.now(),checkedAt:0,source:String(validation.pack.source||''),identity:packIdentity(validation.pack)});
  updateRulePackStatus();try{analyzeText()}catch(e){}
  toast('Предыдущий пакет восстановлен');return true;
}

const baseActiveAutoRules=typeof activeAutoRules==='function'?activeAutoRules:null;
if(baseActiveAutoRules){
  activeAutoRules=function(){return baseActiveAutoRules().filter(r=>isPackRuleEnabled(r.id))};
  window.activeAutoRules=activeAutoRules;
}
const baseManualRuleItems=typeof manualRuleItems==='function'?manualRuleItems:null;
if(baseManualRuleItems){
  manualRuleItems=function(){return baseManualRuleItems().filter(r=>isPackRuleEnabled(r.id))};
  window.manualRuleItems=manualRuleItems;
}

const baseAnalyzeRulePack=typeof analyzeRulePack==='function'?analyzeRulePack:null;
if(baseAnalyzeRulePack){
  analyzeRulePack=function(src,headings,issues){
    const result=baseAnalyzeRulePack(src,headings,issues)||{checked:0,matches:0,errors:[]};
    const total=activeAutoRules().length;
    result.totalRules=total;
    result.truncatedRules=Math.max(0,total-Number(result.checked||0));
    result.issueLimitReached=Number(result.matches||0)>=100;
    result.partial=result.truncatedRules>0||result.issueLimitReached||!!(result.errors&&result.errors.length);
    if(result.truncatedRules>0)result.partialReason='Проверено '+result.checked+' из '+total+' правил; достигнут лимит замечаний.';
    else if(result.issueLimitReached)result.partialReason='Найдено не менее 100 замечаний; показ ограничен.';
    else if(result.errors&&result.errors.length)result.partialReason='Часть правил завершилась ошибкой.';
    const meta=currentPackMeta();meta.checkedAt=Date.now();meta.identity=packIdentity(activeRulePack);setCurrentPackMeta(meta);
    lastRulePackDiagnostics=result;
    return result;
  };
  window.analyzeRulePack=analyzeRulePack;
}

function manualMarks(){const value=loadJson(PACK_MANUAL_KEY,{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
function manualMarkKey(ruleId){
  const snap=typeof currentDocumentSnapshot==='function'?currentDocumentSnapshot():{documentId:'local-draft',revision:0};
  return {key:packIdentity(activeRulePack)+'|'+String(ruleId)+'|'+String(snap.documentId||''),revision:Number(snap.revision)||0};
}
function manualState(ruleId){
  const ref=manualMarkKey(ruleId),marks=manualMarks(),item=marks[ref.key];
  if(!item)return {checked:false,stale:false};
  return {checked:!!item.checked&&Number(item.revision)===ref.revision,stale:!!item.checked&&Number(item.revision)!==ref.revision};
}
function toggleManualRuleMark(ruleId){
  const ref=manualMarkKey(ruleId),marks=manualMarks(),state=manualState(ruleId);
  marks[ref.key]={checked:!state.checked,revision:ref.revision,updatedAt:Date.now()};
  saveJson(PACK_MANUAL_KEY,marks);
  if(typeof renderAnalysis==='function')renderAnalysis();
}
window.toggleManualRuleMark=toggleManualRuleMark;

const baseRenderRulePackManual=typeof renderRulePackManual==='function'?renderRulePackManual:null;
if(baseRenderRulePackManual){
  renderRulePackManual=function(){
    const rules=manualRuleItems();
    let html='';
    if(rules.length){
      html='<div class="analysisRulesNote"><b>Ручной чек-лист</b><ul class="manualChecklist">'+rules.map(rule=>{
        const state=manualState(rule.id),id=String(rule.id).replace(/'/g,'');
        const mark=state.checked?'☑':state.stale?'◴':'☐';
        const stale=state.stale?' <span class="smallNote">отметка устарела после изменения текста</span>':'';
        return '<li><button type="button" class="nativeBtn" onclick="toggleManualRuleMark(\''+id+'\')">'+mark+'</button> <b>'+escapeHtml(rule.title)+'</b> — '+escapeHtml(rule.message)+stale+'</li>';
      }).join('')+'</ul></div>';
    }
    const d=typeof lastRulePackDiagnostics!=='undefined'?lastRulePackDiagnostics:null;
    if(d&&d.partial){html+='<div class="analysisRulesNote"><b>Проверено частично.</b> '+escapeHtml(d.partialReason||'Часть правил не проверена.')+'</div>'}
    else if(d&&Number.isFinite(Number(d.totalRules))){html+='<div class="analysisRulesNote">Проверено '+Number(d.checked||0)+' из '+Number(d.totalRules||0)+' автоматических правил.</div>'}
    return html;
  };
  window.renderRulePackManual=renderRulePackManual;
}

function renderRuleControls(){
  const status=document.querySelector('#rulePackStatus');if(!status)return;
  let root=document.querySelector('#rulePackP1Controls');
  if(!root){root=document.createElement('div');root.id='rulePackP1Controls';status.insertAdjacentElement('afterend',root)}
  if(typeof activeRulePack==='undefined'||!activeRulePack){root.innerHTML='';return}
  const rules=activeRulePack.rules||[],meta=currentPackMeta(),backup=backupPack();
  root.innerHTML='<div class="smallNote">Установлен: '+(meta.installedAt?new Date(meta.installedAt).toLocaleString('ru-RU'):'—')+(meta.checkedAt?'<br>Последняя проверка: '+new Date(meta.checkedAt).toLocaleString('ru-RU'):'')+'</div>'+
    '<details class="nestedDetails"><summary>Правила пакета · '+rules.length+'</summary><div class="settingsGroupBody">'+rules.map(r=>'<label class="settingRow"><span><b>'+escapeHtml(r.title)+'</b><small>'+escapeHtml(r.id)+' · '+escapeHtml(r.type)+'</small></span><input type="checkbox" '+(isPackRuleEnabled(r.id)?'checked':'')+' onchange="setPackRuleEnabled(\''+String(r.id).replace(/'/g,'')+'\',this.checked)"></label>').join('')+'</div></details>'+
    (backup?'<div class="settingActions"><button class="nativeBtn" type="button" onclick="restorePreviousRulePack()">Восстановить предыдущий пакет</button></div>':'');
}
window.setPackRuleEnabled=setPackRuleEnabled;
window.restorePreviousRulePack=restorePreviousRulePack;

const baseUpdateStatus=typeof updateRulePackStatus==='function'?updateRulePackStatus:null;
if(baseUpdateStatus){
  updateRulePackStatus=function(){const result=baseUpdateStatus();renderRuleControls();return result};
  window.updateRulePackStatus=updateRulePackStatus;
}

// Replace import/install entry points only after all v1 functions already exist.
validateRulePackText=validateRulePackTextP1;
window.validateRulePackText=validateRulePackTextP1;
installPendingRulePack=installPendingRulePackP1;
window.installPendingRulePack=installPendingRulePackP1;

// Browser/native input guards: reject oversized files before parsing/replacing.
const fileInput=document.querySelector('#rulePackFileInput');
if(fileInput)fileInput.addEventListener('change',function(event){
  const f=event.target.files&&event.target.files[0];
  if(f&&Number(f.size)>PACK_MAX_BYTES){event.stopImmediatePropagation();event.preventDefault();event.target.value='';toast('Пакет правил больше 2 МБ и не будет загружен')}
},true);
if(typeof window.onNativeRulePackLoaded==='function'){
  const nativeLoaded=window.onNativeRulePackLoaded;
  window.onNativeRulePackLoaded=function(text,name){
    if(utf8Bytes(text)>PACK_MAX_BYTES){toast('Пакет правил больше 2 МБ и не будет загружен');return}
    return nativeLoaded(text,name);
  };
}

window.RulePackP1={PACK_MAX_BYTES,utf8Bytes,rulePathErrors,prevalidatePackText,packIdentity};
try{updateRulePackStatus()}catch(e){}
})();
