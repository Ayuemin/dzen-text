(function(){
'use strict';

const SCHEMA='spelling-user-dictionary-v1';
const MAX_IMPORT_WORDS=5000;
const MAX_VISIBLE_WORDS=300;

function normalizePersonalWord(value){
  return String(value||'').trim().toLocaleLowerCase('ru-RU');
}
function validPersonalWord(value){
  const word=String(value||'').trim();
  return !!word&&word.length<=80&&/^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’\-]*$/.test(word);
}
function parseImportWords(text,fileName){
  const raw=String(text||'');
  const name=String(fileName||'').toLocaleLowerCase('ru-RU');
  let values=[];
  if(name.endsWith('.json')||/^\s*[\[{]/.test(raw)){
    try{
      const parsed=JSON.parse(raw);
      if(Array.isArray(parsed))values=parsed;
      else if(parsed&&typeof parsed==='object'&&Array.isArray(parsed.words))values=parsed.words;
      else throw new Error('JSON должен быть массивом слов или объектом с полем words.');
    }catch(e){
      if(name.endsWith('.json'))return {ok:false,error:String(e&&e.message||e),words:[],rejected:0,truncated:false};
      values=raw.split(/\r?\n/);
    }
  }else values=raw.split(/\r?\n/);

  const out=[],seen=new Set();let rejected=0,truncated=false;
  for(const item of values){
    const word=String(item==null?'':item).trim();
    if(!word)continue;
    if(!validPersonalWord(word)){rejected++;continue}
    const key=normalizePersonalWord(word);
    if(seen.has(key))continue;
    seen.add(key);out.push(word);
    if(out.length>=MAX_IMPORT_WORDS){truncated=true;break}
  }
  return {ok:true,words:out,rejected,truncated};
}
function nativeUserWords(){
  if(!window.AndroidSpelling||typeof AndroidSpelling.userWords!=='function')return [];
  try{
    const parsed=JSON.parse(AndroidSpelling.userWords()||'[]');
    return Array.isArray(parsed)?parsed.map(String).filter(validPersonalWord).sort((a,b)=>a.localeCompare(b,'ru')):[];
  }catch(e){return []}
}
function dictionaryStatus(){
  if(!window.AndroidSpelling||typeof AndroidSpelling.status!=='function')return {state:'unavailable'};
  try{return JSON.parse(AndroidSpelling.status()||'{}')}catch(e){return {state:'unavailable',error:String(e&&e.message||e)}}
}
function renderPersonalDictionary(){
  const statusEl=document.querySelector('[data-spelling-dictionary-status]');
  const listEl=document.querySelector('[data-spelling-dictionary-list]');
  if(!statusEl||!listEl)return;
  const status=dictionaryStatus(),words=nativeUserWords();
  if(status.state==='ready')statusEl.innerHTML='Личный словарь: <b>'+words.length+'</b> слов. Он хранится отдельно от встроенного LibreOffice ru_RU.';
  else if(status.state==='initializing')statusEl.textContent='Орфография загружается… Личный словарь уже сохранён и подключится после запуска Hunspell.';
  else statusEl.textContent='Модуль орфографии недоступен'+(status.error?': '+String(status.error):'.');

  if(!words.length){listEl.innerHTML='<div class="smallNote">Личный словарь пуст.</div>';return}
  const visible=words.slice(0,MAX_VISIBLE_WORDS);
  listEl.innerHTML=visible.map(word=>'<div class="analysisRow"><span>'+escapeHtml(word)+'</span><button class="nativeBtn" type="button" data-remove-spelling-word='+JSON.stringify(word)+'>Удалить</button></div>').join('')+
    (words.length>visible.length?'<div class="smallNote">Показаны первые '+visible.length+' из '+words.length+' слов. Экспорт содержит весь словарь.</div>':'');
  listEl.querySelectorAll('[data-remove-spelling-word]').forEach(button=>{
    button.onclick=function(){removePersonalWord(this.getAttribute('data-remove-spelling-word')||'')};
  });
}
function removePersonalWord(word){
  if(!window.AndroidSpelling||typeof AndroidSpelling.removeUserWord!=='function'){toast('Личный словарь недоступен');return false}
  let ok=false;try{ok=!!AndroidSpelling.removeUserWord(String(word||''))}catch(e){}
  if(!ok){toast('Не удалось удалить слово');return false}
  renderPersonalDictionary();toast('Слово удалено из личного словаря');return true;
}
function exportPersonalDictionary(){
  const words=nativeUserWords();
  const payload=JSON.stringify({schema:SCHEMA,version:1,exportedAt:new Date().toISOString(),words},null,2);
  const name='spelling-user-dictionary.json';
  if(window.AndroidFile&&typeof AndroidFile.saveReport==='function'){
    AndroidFile.saveReport(payload,name);return true;
  }
  try{
    const blob=new Blob([payload],{type:'application/json;charset=utf-8'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Личный словарь экспортирован');return true;
  }catch(e){toast('Не удалось экспортировать личный словарь');return false}
}
function importPersonalDictionaryText(text,fileName){
  const parsed=parseImportWords(text,fileName);
  if(!parsed.ok){toast('Импорт словаря: '+parsed.error);return {ok:false,added:0,rejected:0,truncated:false}}
  if(!window.AndroidSpelling||typeof AndroidSpelling.addUserWord!=='function'){toast('Личный словарь недоступен');return {ok:false,added:0,rejected:parsed.rejected,truncated:parsed.truncated}}
  let added=0;
  for(const word of parsed.words){
    try{if(AndroidSpelling.addUserWord(word))added++}catch(e){}
  }
  renderPersonalDictionary();
  let message='Импортировано слов: '+added;
  if(parsed.rejected)message+=' · отклонено: '+parsed.rejected;
  if(parsed.truncated)message+=' · достигнут лимит '+MAX_IMPORT_WORDS;
  toast(message);
  return {ok:true,added,rejected:parsed.rejected,truncated:parsed.truncated};
}
function choosePersonalDictionaryImport(){
  if(window.AndroidSpellingFile&&typeof AndroidSpellingFile.pickImport==='function'){
    AndroidSpellingFile.pickImport();return;
  }
  const input=document.querySelector('#spellingDictionaryFileInput');if(input)input.click();
}
async function clearPersonalDictionary(){
  if(!window.AndroidSpelling||typeof AndroidSpelling.clearUserWords!=='function'){toast('Личный словарь недоступен');return false}
  let ok=true;
  if(typeof appConfirm==='function')ok=await appConfirm('Очистить личный словарь?','Все добавленные вами слова будут удалены. Встроенный словарь Hunspell не изменится.','Очистить',true);
  if(!ok)return false;
  let cleared=false;try{cleared=!!AndroidSpelling.clearUserWords()}catch(e){}
  if(!cleared){toast('Не удалось очистить личный словарь');return false}
  renderPersonalDictionary();toast('Личный словарь очищен');return true;
}
function ensureSpellingDictionaryUi(){
  const wrap=document.querySelector('#settingsBackdrop .settingsGroupWrap');
  if(!wrap||document.querySelector('#spellingDictionarySettings'))return;
  const group=document.createElement('details');group.className='settingsGroup';group.id='spellingDictionarySettings';
  group.innerHTML='<summary><span>Орфография и личный словарь</span><small>Hunspell · слова пользователя</small></summary><div class="settingsGroupBody">'+
    '<div class="smallNote" data-spelling-dictionary-status></div>'+
    '<div class="settingActions"><button class="nativeBtn" type="button" data-spelling-import>Импорт</button><button class="nativeBtn" type="button" data-spelling-export>Экспорт</button><button class="nativeBtn" type="button" data-spelling-clear>Очистить</button></div>'+
    '<div data-spelling-dictionary-list></div></div>';
  wrap.appendChild(group);
  group.querySelector('[data-spelling-import]').onclick=choosePersonalDictionaryImport;
  group.querySelector('[data-spelling-export]').onclick=exportPersonalDictionary;
  group.querySelector('[data-spelling-clear]').onclick=clearPersonalDictionary;

  // Browser fallback; Android production uses AndroidSpellingFile so import does
  // not depend on WebChromeClient.onShowFileChooser support.
  let input=document.querySelector('#spellingDictionaryFileInput');
  if(!input){
    input=document.createElement('input');input.id='spellingDictionaryFileInput';input.className='fileInput';input.type='file';input.accept='.json,.txt,application/json,text/plain';
    (document.querySelector('.editorWrap')||document.body).appendChild(input);
    input.addEventListener('change',function(event){
      const file=event.target.files&&event.target.files[0];event.target.value='';if(!file)return;
      if(file.size>2*1024*1024){toast('Файл личного словаря больше 2 МБ');return}
      const reader=new FileReader();
      reader.onload=function(){importPersonalDictionaryText(String(reader.result||''),file.name||'')};
      reader.onerror=function(){toast('Не удалось прочитать файл личного словаря')};
      reader.readAsText(file,'UTF-8');
    });
  }
  renderPersonalDictionary();
}

window.removePersonalSpellingWord=removePersonalWord;
window.exportPersonalDictionary=exportPersonalDictionary;
window.importPersonalDictionaryText=importPersonalDictionaryText;
window.choosePersonalDictionaryImport=choosePersonalDictionaryImport;
window.clearPersonalDictionary=clearPersonalDictionary;
window.onNativeSpellingDictionaryLoaded=function(text,name){
  return importPersonalDictionaryText(String(text||''),String(name||''));
};
window.onNativeSpellingDictionaryError=function(message){
  toast(message||'Не удалось импортировать личный словарь');
};

try{
  if(typeof openSettings==='function'){
    const previousOpenSettings=openSettings;
    openSettings=function(){const out=previousOpenSettings();ensureSpellingDictionaryUi();renderPersonalDictionary();return out};
    window.openSettings=openSettings;
  }
}catch(e){}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureSpellingDictionaryUi,{once:true});else ensureSpellingDictionaryUi();

window.SpellingDictionaryUI={SCHEMA,MAX_IMPORT_WORDS,normalizePersonalWord,validPersonalWord,parseImportWords,nativeUserWords};
})();
