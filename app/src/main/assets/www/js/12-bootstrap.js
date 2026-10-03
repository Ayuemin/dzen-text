let localClassifierCache={text:null,issues:[],error:'',segments:0};

const CONTROL_LISTS_KEY='editorControlListsV1';
let controlLists=[];
let controlListsRevision=0;
let controlListsSaveTimer=null;
let compiledControlLists={revision:-1,single:new Map(),phrases:new Map()};

function localClassifierBridgeAvailable(){
  return !!(window.AndroidLocalClassifier&&typeof AndroidLocalClassifier.status==='function'&&typeof AndroidLocalClassifier.analyze==='function');
}

function localClassifierManageAvailable(){
  return !!(window.AndroidLocalClassifier&&typeof AndroidLocalClassifier.pickPackage==='function'&&typeof AndroidLocalClassifier.clearUserModel==='function');
}

function localClassifierStatus(){
  if(!localClassifierBridgeAvailable())return {installed:false,available:false,browser:true};
  try{return JSON.parse(AndroidLocalClassifier.status()||'{}')}catch(e){return {installed:false,available:false,error:String(e&&e.message||e)}}
}

function ensureLocalClassifierSettings(){
  const wrap=document.querySelector('#settingsBackdrop .settingsGroupWrap');
  if(!wrap||document.querySelector('#localClassifierSettingsGroup'))return;
  const group=document.createElement('details');
  group.className='settingsGroup';
  group.id='localClassifierSettingsGroup';
  group.innerHTML='<summary><span>Локальная смысловая модель</span><small>ONNX-классификатор предложений на устройстве</small></summary><div class="settingsGroupBody"><div class="ruleStatus" data-local-classifier-status></div><div class="settingActions localClassifierActions"><button class="nativeBtn primarySettingBtn" data-local-classifier-install type="button" onclick="installLocalClassifierPackage()">Установить модель</button><button class="nativeBtn" data-local-classifier-remove type="button" onclick="removeLocalClassifierModel()" hidden>Удалить модель</button></div><div class="smallNote">Модель работает полностью на устройстве. Для установки выберите ZIP-пакет с файлами <b>model.onnx</b> и <b>metadata.json</b>. Перед заменой приложение проверит совместимость модели.</div></div>';
  const control=document.querySelector('#controlListsSettingsGroup');
  const rulePack=document.querySelector('#rulePackStatus');
  const before=control||(rulePack&&rulePack.closest?rulePack.closest('.settingsGroup'):null);
  if(before&&before.parentNode===wrap)wrap.insertBefore(group,before);else wrap.appendChild(group);
}

function refreshLocalClassifierStatus(){
  ensureLocalClassifierSettings();
  const el=document.querySelector('[data-local-classifier-status]');
  if(!el)return;
  const status=localClassifierStatus();
  const installBtn=document.querySelector('[data-local-classifier-install]');
  const removeBtn=document.querySelector('[data-local-classifier-remove]');
  if(installBtn){installBtn.hidden=!localClassifierManageAvailable();installBtn.textContent=status.userInstalled?'Заменить модель':'Установить модель'}
  if(removeBtn)removeBtn.hidden=!(localClassifierManageAvailable()&&status.userInstalled);
  if(status.browser){
    el.innerHTML='<b>Доступно только в Android-приложении.</b>';
    return;
  }
  if(!status.installed){
    el.innerHTML='<b>Модель не установлена.</b><br>Обычные локальные проверки работают без неё.'+(status.error?'<br><span class="warn">'+escapeHtml(status.error)+'</span>':'');
    return;
  }
  if(!status.available){
    el.innerHTML='<b>Модель найдена, но не загрузилась.</b>'+(status.error?'<br>'+escapeHtml(status.error):'');
    return;
  }
  const source=status.source==='user'?'установлена пользователем':'встроена в приложение';
  const pkg=status.packageName?'<br>Файл: '+escapeHtml(status.packageName):'';
  el.innerHTML='<b>'+escapeHtml(status.name||'Локальная смысловая модель')+'</b>'+(status.version?' · '+escapeHtml(status.version):'')+'<br>Категорий: <b>'+Number(status.labels||0)+'</b><br>Источник: '+source+pkg+'<br>Статус: <b>применяется локально</b>'+(status.error?'<br><span class="smallNote">'+escapeHtml(status.error)+'</span>':'');
}

function invalidateLocalClassifierCache(){
  localClassifierCache={text:null,issues:[],error:'',segments:0};
}

function installLocalClassifierPackage(){
  if(!localClassifierManageAvailable()){toast('Установка модели доступна в Android-приложении');return}
  invalidateLocalClassifierCache();
  try{AndroidLocalClassifier.pickPackage();toast('Выберите ZIP-пакет локальной модели')}catch(e){toast('Не удалось открыть выбор модели')}
}

async function removeLocalClassifierModel(){
  if(!localClassifierManageAvailable())return;
  const ok=typeof appConfirm==='function'?await appConfirm('Удалить локальную модель?','Пользовательская ONNX-модель будет удалена только из приложения. Остальные локальные проверки продолжат работать.','Удалить',true):true;
  if(!ok)return;
  let removed=false;
  try{removed=!!AndroidLocalClassifier.clearUserModel()}catch(e){}
  invalidateLocalClassifierCache();
  refreshLocalClassifierStatus();
  try{analyzeText()}catch(e){console.error(e)}
  toast(removed?'Локальная модель удалена':'Не удалось полностью удалить модель');
}

window.onNativeLocalClassifierInstalling=()=>toast('Проверяю и устанавливаю локальную модель…');
window.onNativeLocalClassifierChanged=(statusText)=>{
  invalidateLocalClassifierCache();
  refreshLocalClassifierStatus();
  try{window.__runLocalSemantic=true;analyzeText()}catch(e){console.error(e)}finally{window.__runLocalSemantic=false}
  let name='';try{const s=JSON.parse(statusText||'{}');name=s&&s.name?String(s.name):''}catch(e){}
  toast(name?'Модель установлена: '+name:'Локальная модель установлена');
};
window.onNativeLocalClassifierError=(msg)=>{refreshLocalClassifierStatus();toast('Модель не установлена: '+String(msg||'неизвестная ошибка'))};

function cleanControlListItem(value){
  let s=String(value||'').replace(/^\s*(?:[-*•]+|\d+[.)])\s*/,'').trim().replace(/\s+/g,' ');
  if((s.startsWith('«')&&s.endsWith('»'))||(s.startsWith('"')&&s.endsWith('"'))||(s.startsWith("'")&&s.endsWith("'"))||(s.startsWith('`')&&s.endsWith('`')))s=s.slice(1,-1).trim();
  return s.slice(0,240);
}

function dedupeControlItems(items){
  const out=[],seen=new Set();
  for(const raw of items){
    const item=cleanControlListItem(raw);if(!item)continue;
    const key=item.toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
    if(seen.has(key))continue;seen.add(key);out.push(item);if(out.length>=50000)break;
  }
  return out;
}

function controlItemsFromLines(text){
  return dedupeControlItems(String(text||'').replace(/\r/g,'').split('\n'));
}

function controlItemsFromPaste(text){
  const raw=String(text||'').replace(/\r/g,'').trim();if(!raw)return [];
  if(/[\n,;\t]/.test(raw))return dedupeControlItems(raw.split(/[\n,;\t]+/));
  const tokens=[];
  raw.replace(/«([^»]+)»|"([^"]+)"|'([^']+)'|`([^`]+)`|(\S+)/g,(m,a,b,c,d,e)=>{tokens.push(a||b||c||d||e||'');return m});
  return dedupeControlItems(tokens);
}

function newControlListId(){return 'list_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)}

function sanitizeControlLists(raw){
  if(!Array.isArray(raw))return [];
  const out=[];
  for(const item of raw){
    if(!item||typeof item!=='object')continue;
    const id=/^[A-Za-z0-9_-]{3,80}$/.test(String(item.id||''))?String(item.id):newControlListId();
    const name=String(item.name||'Мой список').trim().slice(0,100)||'Мой список';
    const items=dedupeControlItems(Array.isArray(item.items)?item.items:[]);
    out.push({id,name,items});if(out.length>=100)break;
  }
  return out;
}

function loadControlLists(){
  try{
    const saved=localStorage.getItem(CONTROL_LISTS_KEY);
    if(saved!==null)return sanitizeControlLists(JSON.parse(saved));
  }catch(e){}
  const legacy=String(settings&&settings.riskWords||'').trim();
  const example=typeof exampleRiskWords==='string'?exampleRiskWords.trim():'';
  if(legacy&&legacy!==example){
    const migrated=[{id:newControlListId(),name:'Контрольные слова',items:controlItemsFromPaste(legacy)}];
    try{localStorage.setItem(CONTROL_LISTS_KEY,JSON.stringify(migrated))}catch(e){}
    return migrated;
  }
  return [];
}

function saveControlListsNow(showError=true){
  clearTimeout(controlListsSaveTimer);controlListsSaveTimer=null;
  try{localStorage.setItem(CONTROL_LISTS_KEY,JSON.stringify(controlLists));controlListsRevision++;compiledControlLists.revision=-1;return true}catch(e){if(showError)toast('Не удалось сохранить контрольные списки');return false}
}

function scheduleControlListsSave(){
  clearTimeout(controlListsSaveTimer);controlListsSaveTimer=setTimeout(()=>saveControlListsNow(),250);
  controlListsRevision++;compiledControlLists.revision=-1;
}

function controlListById(id){return controlLists.find(x=>x.id===String(id))||null}

function renderControlListsSettings(){
  const root=document.querySelector('#controlListsContainer');if(!root)return;
  if(!controlLists.length){root.innerHTML='<div class="controlListsEmpty">Списков пока нет. Создайте первый — название может быть любым.</div>';return}
  root.innerHTML=controlLists.map(list=>{
    const id=list.id,name=escapeHtml(list.name),count=list.items.length;
    return '<details class="controlListCard" data-control-list="'+id+'"><summary><span>'+name+'</span><small>'+count+' '+controlItemWord(count)+'</small></summary><div class="controlListBody"><label class="controlListLabel">Название</label><input class="controlListName" type="text" maxlength="100" value="'+escapeHtml(list.name)+'" onchange="renameControlList(\''+id+'\',this.value)"><label class="controlListLabel">Слова и фразы</label><textarea class="riskArea controlListArea" rows="9" oninput="updateControlListText(\''+id+'\',this.value)" onpaste="handleControlListPaste(event,\''+id+'\')" placeholder="подписка&#10;купить&#10;гарантированный доход">'+escapeHtml(list.items.join('\n'))+'</textarea><div class="smallNote">Словоформы учитываются автоматически. Вставку через запятые, точки с запятой, пробелы или списком приложение может разобрать само.</div><div class="settingActions"><button class="nativeBtn" type="button" onclick="normalizeControlList(\''+id+'\')">Разобрать список</button><button class="nativeBtn dangerText" type="button" onclick="deleteControlList(\''+id+'\')">Удалить</button></div></div></details>';
  }).join('');
}

function controlItemWord(n){const a=Math.abs(Number(n)||0)%100,b=a%10;return a>10&&a<20?'элементов':b===1?'элемент':b>=2&&b<=4?'элемента':'элементов'}

function addControlList(){
  const used=new Set(controlLists.map(x=>x.name));let name='Мой список',n=2;while(used.has(name))name='Мой список '+n++;
  const list={id:newControlListId(),name,items:[]};controlLists.push(list);saveControlListsNow();renderControlListsSettings();
  const card=document.querySelector('[data-control-list="'+list.id+'"]');if(card){card.open=true;const input=card.querySelector('.controlListName');if(input){input.focus();input.select()}}
}

function renameControlList(id,value){
  const list=controlListById(id);if(!list)return;list.name=String(value||'').trim().slice(0,100)||'Мой список';scheduleControlListsSave();
  const card=document.querySelector('[data-control-list="'+list.id+'"]');if(card){const s=card.querySelector('summary span');if(s)s.textContent=list.name}
}

function updateControlListText(id,value){
  const list=controlListById(id);if(!list)return;list.items=controlItemsFromLines(value);scheduleControlListsSave();
  const card=document.querySelector('[data-control-list="'+list.id+'"]');if(card){const small=card.querySelector('summary small');if(small)small.textContent=list.items.length+' '+controlItemWord(list.items.length)}
}

function handleControlListPaste(event,id){
  const clip=event.clipboardData||window.clipboardData;if(!clip)return;const text=clip.getData('text');if(!text)return;
  const items=controlItemsFromPaste(text);if(!items.length)return;event.preventDefault();
  const area=event.target,before=area.value.slice(0,area.selectionStart),after=area.value.slice(area.selectionEnd),insert=items.join('\n');
  area.value=before+(before&&!before.endsWith('\n')?'\n':'')+insert+(after&&!after.startsWith('\n')?'\n':'')+after;
  updateControlListText(id,area.value);toast('Вставка разобрана: '+items.length+' '+controlItemWord(items.length));
}

function normalizeControlList(id){
  const list=controlListById(id);if(!list)return;const card=document.querySelector('[data-control-list="'+list.id+'"]'),area=card&&card.querySelector('.controlListArea');
  const items=controlItemsFromPaste(area?area.value:list.items.join('\n'));list.items=items;saveControlListsNow();if(area)area.value=items.join('\n');
  if(card){const small=card.querySelector('summary small');if(small)small.textContent=items.length+' '+controlItemWord(items.length)}
  toast('Список приведён к одному элементу на строку');
}

async function deleteControlList(id){
  const list=controlListById(id);if(!list)return;const ok=typeof appConfirm==='function'?await appConfirm('Удалить список?','«'+list.name+'» и все его элементы будут удалены только из приложения.','Удалить',true):true;if(!ok)return;
  controlLists=controlLists.filter(x=>x.id!==list.id);saveControlListsNow();renderControlListsSettings();try{analyzeText()}catch(e){}toast('Контрольный список удалён');
}

function controlStem(raw){
  let word=String(raw||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/^[^a-zа-я0-9]+|[^a-zа-я0-9]+$/g,'');
  if(!word||!/[а-я]/.test(word))return word;
  if(word.length<=3)return word;
  const original=word;
  word=word.replace(/(ившись|ывшись|ивши|ывши|ив|ыв)$/,'');
  word=word.replace(/(ся|сь)$/,'');
  const adjective=/(ими|ыми|его|ого|ему|ому|ее|ие|ые|ое|ей|ий|ый|ой|ем|им|ым|ом|их|ых|ую|юю|ая|яя|ою|ею)$/;
  const beforeAdj=word;word=word.replace(adjective,'');
  if(word!==beforeAdj)word=word.replace(/(ем|нн|вш|ющ|щ)$/,'');
  else{
    const verb=/(ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ны|ть|ешь|нно|ать|ять|еть|уть|ти|чь)$/;
    const beforeVerb=word;word=word.replace(verb,'');
    if(word===beforeVerb)word=word.replace(/(иями|ями|ами|ией|иям|ием|иях|ев|ов|ие|ье|еи|ии|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я|а|евы|овы|ев|ов|е|и)$/,'');
  }
  word=word.replace(/и$/,'').replace(/ейше$/,'').replace(/нн$/,'н').replace(/ь$/,'');
  if(/[пбвфм]л$/.test(word)&&/[ю]$/.test(original))word=word.slice(0,-1);
  return word.length>=2?word:original;
}

function controlTermStems(text){return wordMatches(String(text||'')).map(m=>controlStem(m[0])).filter(Boolean)}

function compileControlLists(){
  if(compiledControlLists.revision===controlListsRevision)return compiledControlLists;
  const single=new Map(),phrases=new Map();
  for(const list of controlLists){
    for(const item of list.items){
      const stems=controlTermStems(item);if(!stems.length)continue;const entry={listName:list.name,item,stems};
      if(stems.length===1){if(!single.has(stems[0]))single.set(stems[0],[]);single.get(stems[0]).push(entry)}
      else{if(!phrases.has(stems[0]))phrases.set(stems[0],[]);phrases.get(stems[0]).push(entry)}
    }
  }
  compiledControlLists={revision:controlListsRevision,single,phrases};return compiledControlLists;
}

function analyzeControlLists(src,issues){
  if(!controlLists.length)return;const compiled=compileControlLists();if(!compiled.single.size&&!compiled.phrases.size)return;
  const tokens=wordMatches(src).map(m=>({text:m[0],start:m.index,end:m.index+m[0].length,stem:controlStem(m[0])}));if(!tokens.length)return;
  const matches=[];
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i],singles=compiled.single.get(t.stem)||[];
    for(const entry of singles)matches.push({start:t.start,end:t.end,lists:new Set([entry.listName]),items:new Set([entry.item])});
    const phrases=compiled.phrases.get(t.stem)||[];
    for(const entry of phrases){if(i+entry.stems.length>tokens.length)continue;let ok=true;for(let j=1;j<entry.stems.length;j++){if(tokens[i+j].stem!==entry.stems[j]){ok=false;break}}if(ok)matches.push({start:t.start,end:tokens[i+entry.stems.length-1].end,lists:new Set([entry.listName]),items:new Set([entry.item])})}
  }
  matches.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start);
  const selected=[];
  for(const m of matches){
    const exact=selected.find(x=>x.start===m.start&&x.end===m.end);if(exact){for(const x of m.lists)exact.lists.add(x);for(const x of m.items)exact.items.add(x);continue}
    const container=selected.find(x=>m.start>=x.start&&m.end<=x.end);if(container){for(const x of m.lists)container.lists.add(x);for(const x of m.items)container.items.add(x);continue}
    selected.push(m);if(selected.length>=160)break;
  }
  selected.sort((a,b)=>a.start-b.start);
  for(const m of selected){
    const names=[...m.lists],items=[...m.items],shown=src.slice(m.start,m.end),title=names.length===1?names[0]:'Контрольные списки: '+names.slice(0,3).join(', ')+(names.length>3?'…':'');
    const detail='Найдено: «'+shown+'» · запись: «'+items[0]+'» · словоформы учитываются';
    const issue=addIssue(issues,'control',title,detail,m.start,m.end,'warning');if(issue){issue.word=shown;issue.controlLists=names;issue.controlItems=items}
  }
}

function settingsGroupByTitle(title){
  return Array.from(document.querySelectorAll('#settingsBackdrop .settingsGroup')).find(g=>{const s=g.querySelector(':scope > summary > span');return s&&s.textContent.trim()===title})||null;
}

function ensureControlListStyles(){
  if(document.querySelector('#controlListsRuntimeStyle'))return;const style=document.createElement('style');style.id='controlListsRuntimeStyle';style.textContent='.controlListsIntro{margin-bottom:12px}.controlListsEmpty{padding:15px;border:1px dashed var(--border);border-radius:13px;color:var(--muted);font-size:13px;line-height:1.45}.controlListCard{border:1px solid var(--border);border-radius:14px;margin:10px 0;background:var(--surface)}.controlListCard>summary{list-style:none;padding:13px 14px;cursor:pointer;display:flex;flex-direction:column;gap:3px}.controlListCard>summary::-webkit-details-marker{display:none}.controlListCard>summary span{font-weight:720}.controlListCard>summary small{color:var(--muted)}.controlListBody{border-top:1px solid var(--border);padding:13px}.controlListLabel{display:block;font-size:12px;color:var(--muted);margin:8px 0 5px}.controlListName{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:11px;background:var(--surface2);color:var(--text);padding:10px 11px;font:inherit}.controlListArea{width:100%;box-sizing:border-box;min-height:160px}.controlListsAdd{width:100%;margin-top:10px}.localClassifierActions{margin:12px 0 6px}';document.head.appendChild(style)
}

function upgradeLocalSettingsUi(){
  ensureControlListStyles();
  const editorGroup=settingsGroupByTitle('Редакторский анализ'),proofGroup=settingsGroupByTitle('Пробелы и пунктуация');
  if(editorGroup&&proofGroup){const proofRow=proofGroup.querySelector('.switchRow'),body=editorGroup.querySelector('.settingsGroupBody');if(proofRow&&body){proofRow.style.marginTop='13px';body.appendChild(proofRow);const note=document.createElement('div');note.className='smallNote';note.textContent='Проверки выполняются только на устройстве. Текст статьи никуда не отправляется.';body.appendChild(note)}proofGroup.remove()}
  let controlGroup=settingsGroupByTitle('Контроль слов');
  if(controlGroup){
    controlGroup.id='controlListsSettingsGroup';const summary=controlGroup.querySelector(':scope > summary');if(summary)summary.innerHTML='<span>Контрольные списки</span><small>Любые слова и фразы со словоформами</small>';
    const body=controlGroup.querySelector('.settingsGroupBody'),legacyCheck=document.querySelector('#riskCheck'),legacyWords=document.querySelector('#riskWords');
    if(body){body.innerHTML='<div class="smallNote controlListsIntro">Создавайте любое число списков с произвольными названиями. Непустой список применяется автоматически; отдельного переключателя не требуется.</div><div id="controlListsContainer"></div><button class="nativeBtn primarySettingBtn controlListsAdd" type="button" onclick="addControlList()">＋ Новый список</button>';if(legacyCheck){legacyCheck.hidden=true;body.appendChild(legacyCheck)}if(legacyWords){legacyWords.hidden=true;body.appendChild(legacyWords)}}
  }else controlGroup=document.querySelector('#controlListsSettingsGroup');
  const packGroup=settingsGroupByTitle('Пакет правил');if(packGroup){const summary=packGroup.querySelector(':scope > summary');if(summary)summary.innerHTML='<span>Дополнительно</span><small>Импорт технических JSON-правил</small>'}
}

function runLocalClassifier(src){
  if(!localClassifierBridgeAvailable())return {available:false,issues:[]};
  try{
    const result=JSON.parse(AndroidLocalClassifier.analyze(String(src||''))||'{}');
    return result&&typeof result==='object'?result:{available:false,issues:[]};
  }catch(e){
    return {available:false,issues:[],error:String(e&&e.message||e)};
  }
}

function appendLocalClassifierIssues(src,result){
  if(!result||!Array.isArray(result.issues))return;
  const issues=currentAnalysis&&Array.isArray(currentAnalysis.issues)?currentAnalysis.issues:null;
  if(!issues)return;
  for(const raw of result.issues){
    const start=Math.max(0,Math.min(src.length,Number(raw.start)||0));
    const end=Math.max(start,Math.min(src.length,Number(raw.end)||start));
    const score=Number(raw.score);
    const confidence=Number.isFinite(score)?' · уверенность '+Math.round(score*100)+'%':'';
    const issue=addIssue(
      issues,
      'semantic',
      String(raw.title||'Смысловой сигнал'),
      String(raw.message||'Проверьте смысл и контекст предложения.')+confidence,
      start,
      end,
      raw.severity==='critical'?'critical':'warning'
    );
    if(issue){
      issue.classifierId=String(raw.id||'');
      issue.score=score;
    }
  }
  const issueOverflow={...(issues._overflow||{})};
  const overflowTotal=Object.values(issueOverflow).reduce((a,b)=>a+(Number(b)||0),0);
  const warningCount=issues.length+overflowTotal;
  const rulesCount=issues.filter(x=>x.type==='rules').length+(issueOverflow.rules||0);
  currentAnalysis.issueOverflow=issueOverflow;
  currentAnalysis.overflowTotal=overflowTotal;
  currentAnalysis.warningCount=warningCount;
  currentAnalysis.rulesCount=rulesCount;
  currentAnalysis.editorCount=warningCount-rulesCount;
}

function installLocalClassifierIntegration(){
  if(window.__localClassifierIntegrationInstalled)return;
  window.__localClassifierIntegrationInstalled=true;

  const baseAnalyze=analyzeText;
  analyzeText=function(){
    const result=baseAnalyze();
    const src=editor.value||'';
    let semantic=null;
    if(window.__runLocalSemantic){
      semantic=runLocalClassifier(src);
      localClassifierCache={
        text:src,
        issues:Array.isArray(semantic.issues)?semantic.issues:[],
        error:String(semantic.error||''),
        segments:Number(semantic.segments||0)
      };
    }else if(localClassifierCache.text===src){
      semantic={available:true,issues:localClassifierCache.issues,error:localClassifierCache.error,segments:localClassifierCache.segments};
    }
    if(semantic)appendLocalClassifierIssues(src,semantic);
    renderAnalysis();
    updateAnalysisDot();
    return currentAnalysis;
  };

  const baseIssueGroups=issueGroups;
  issueGroups=function(){
    const groups=baseIssueGroups();
    if(!groups.some(x=>x.id==='semantic'))groups.splice(2,0,{id:'semantic',name:'Локальный смысловой анализ'});
    return groups;
  };

  const baseOpenSettings=openSettings;
  openSettings=function(){
    ensureLocalClassifierSettings();
    baseOpenSettings();
    renderControlListsSettings();
    refreshLocalClassifierStatus();
  };
}

installLocalClassifierIntegration();

let localAnalysisTimer=null;
function scheduleLocalAnalysis(){
  clearTimeout(localAnalysisTimer);
  const size=(editor.value||'').length;
  const delay=size>160000?1000:size>80000?600:240;
  localAnalysisTimer=setTimeout(()=>{
    localAnalysisTimer=null;
    try{analyzeText()}catch(e){console.error(e)}
  },delay);
}

function bootstrapEditor(){
  if(window.__platformTextBootstrapped)return;
  window.__platformTextBootstrapped=true;

  document.title='Редактор текста · прототип';
  settings=loadSettings();
  controlLists=loadControlLists();
  controlListsRevision++;
  userSynonyms=loadUserSynonyms();
  activeRulePack=loadRulePack();

  editor.addEventListener('paste',()=>{inputWasPaste=true});
  editor.addEventListener('input',()=>{
    if(replacementState)closeReplacement();
    if(nearbyState)closeNearbyRepeat();
    if(repeatNavState&&typeof scheduleRepeatNavigatorRefresh==='function')scheduleRepeatNavigatorRefresh();
    if(typeof issueNavState!=='undefined'&&issueNavState&&typeof scheduleIssueNavigatorRefresh==='function')scheduleIssueNavigatorRefresh();
    inputWasPaste=false;
    render(false);
    markAnalysisStale();
    scheduleLocalAnalysis();
  });
  editor.addEventListener('keydown',e=>{
    if(e.key==='Tab'){
      e.preventDefault();
      const s=editor.selectionStart,en=editor.selectionEnd;
      if(typeof historyCheckpoint==='function')historyCheckpoint();
      editor.setRangeText('    ',s,en,'end');
      afterProgrammaticEdit(false);
      scheduleLocalAnalysis();
    }
  });

  document.getElementById('fileInput').addEventListener('change',e=>{
    const f=e.target.files&&e.target.files[0];
    e.target.value='';
    if(!f)return;
    const r=new FileReader();
    r.onload=()=>loadFileText(String(r.result||''),f.name);
    r.onerror=()=>toast('Не удалось прочитать файл');
    r.readAsText(f,'UTF-8');
  });

  document.getElementById('synonymFileInput').addEventListener('change',e=>{
    const f=e.target.files&&e.target.files[0];
    e.target.value='';
    if(!f)return;
    const r=new FileReader();
    r.onload=()=>parseBrowserDictionary(String(r.result||''),f.name);
    r.onerror=()=>toast('Не удалось прочитать словарь');
    r.readAsText(f,'UTF-8');
  });

  document.getElementById('rulePackFileInput').addEventListener('change',e=>{
    const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;const r=new FileReader();r.onload=()=>window.onNativeRulePackLoaded(String(r.result||''),f.name);r.onerror=()=>toast('Не удалось прочитать JSON');r.readAsText(f,'UTF-8');
  });

  document.getElementById('manualReplacement').addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      applyManualReplacement();
    }
  });

  window.onNativeTtsDone=()=>setSpeaking(false);
  window.onNativeTtsError=(msg)=>{setSpeaking(false);toast(msg||'Ошибка системной озвучки')};
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&speaking)stopSpeak()});

  applyVisualSettings();
  let managed=false;
  if(typeof initArticleWorkspace==='function')managed=initArticleWorkspace();
  if(!managed&&settings.autosave){
    const draft=localStorage.getItem('editorDraft');
    if(draft)editor.value=draft;
  }
  if(typeof migrateLegacyVersions==='function')migrateLegacyVersions();
  upgradeLocalSettingsUi();
  syncSettingsUI();
  renderControlListsSettings();
  updateUserSynonymStatus();
  updateRulePackStatus();
  ensureLocalClassifierSettings();
  refreshLocalClassifierStatus();
  render(false);
  scheduleLocalAnalysis();
  if(typeof updateCurrentArticleUi==='function')updateCurrentArticleUi();
  if(typeof updateDrawerSpeakLabel==='function')updateDrawerSpeakLabel();
  setTimeout(updateDictStatus,80);
  setTimeout(updateDictStatus,800);
}

try{
  bootstrapEditor();
}catch(error){
  console.error('Editor bootstrap failed',error);
  const t=document.getElementById('toast');
  if(t){
    t.textContent='Ошибка запуска редактора. Перезапустите приложение.';
    t.classList.add('show');
  }
}
