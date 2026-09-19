const LEGACY_VERSIONS_KEY='dzenTextVersionsV1';
let undoStack=[];
let redoStack=[];
let beforeInputSnapshot=null;
let lastTypingAt=0;
let autoVersionTimer=null;
let autoVersionDirty=false;
let lastAutoVersionAt=0;
let historyRestoring=false;
let lastLargeSnapshotAt=0;

function editorSnapshot(){
  return {text:editor.value,start:editor.selectionStart||0,end:editor.selectionEnd||0};
}

function sameSnapshot(a,b){
  return !!a&&!!b&&a.text===b.text&&a.start===b.start&&a.end===b.end;
}

function undoLimitForText(text){
  const size=String(text||'').length;
  if(size>300000)return 10;
  if(size>150000)return 18;
  if(size>60000)return 35;
  return 70;
}

function pushUndoSnapshot(snapshot){
  if(!snapshot)return;
  const last=undoStack[undoStack.length-1];
  if(last&&sameSnapshot(last,snapshot))return;
  undoStack.push(snapshot);
  const limit=undoLimitForText(snapshot.text);
  if(undoStack.length>limit)undoStack.splice(0,undoStack.length-limit);
}

function resetUndoHistory(){
  undoStack=[];
  redoStack=[];
  beforeInputSnapshot=null;
  lastTypingAt=0;
  lastLargeSnapshotAt=0;
  clearTimeout(autoVersionTimer);
  autoVersionTimer=null;
  autoVersionDirty=false;
  lastAutoVersionAt=0;
  updateHistoryButtons();
}

function historyCheckpoint(){
  pushUndoSnapshot(editorSnapshot());
  redoStack=[];
  lastTypingAt=0;
  updateHistoryButtons();
}

function restoreEditorSnapshot(snapshot){
  if(!snapshot)return;
  historyRestoring=true;
  editor.value=snapshot.text||'';
  const max=editor.value.length;
  const start=Math.max(0,Math.min(max,Number(snapshot.start)||0));
  const end=Math.max(start,Math.min(max,Number(snapshot.end)||start));
  if(typeof closeAllCorrectionPanels==='function')closeAllCorrectionPanels();
  clearOnlineSpelling();
  historyRestoring=false;
  if(typeof afterProgrammaticEdit==='function')afterProgrammaticEdit(false);
  else{
    markAnalysisStale();
    render(false);
    if(typeof scheduleArticleSave==='function')scheduleArticleSave();
  }
  editor.focus();
  editor.setSelectionRange(start,end);
}

function undoEdit(){
  if(!undoStack.length){toast('Нечего отменять');return}
  const current=editorSnapshot();
  const target=undoStack.pop();
  redoStack.push(current);
  restoreEditorSnapshot(target);
  updateHistoryButtons();
}

function redoEdit(){
  if(!redoStack.length){toast('Нечего повторять');return}
  const current=editorSnapshot();
  const target=redoStack.pop();
  pushUndoSnapshot(current);
  restoreEditorSnapshot(target);
  updateHistoryButtons();
}

function updateHistoryButtons(){
  const undo=document.getElementById('undoBtn');
  const redo=document.getElementById('redoBtn');
  if(undo)undo.disabled=!undoStack.length;
  if(redo)redo.disabled=!redoStack.length;
}

function nativeVersionsAvailable(){
  return !!(window.AndroidDocuments&&typeof AndroidDocuments.saveVersion==='function'&&activeArticleId);
}

function legacyVersions(){
  try{
    const value=JSON.parse(localStorage.getItem(LEGACY_VERSIONS_KEY)||'[]');
    return Array.isArray(value)?value:[];
  }catch(e){return []}
}

function migrateLegacyVersions(){
  if(!nativeVersionsAvailable())return;
  const old=legacyVersions();
  if(!old.length)return;
  const pending=old.slice(0,12);
  let complete=true;
  for(const item of pending){
    try{
      const result=JSON.parse(AndroidDocuments.saveVersion(activeArticleId,item.reason||'Перенесено',item.text||'')||'{}');
      if(!(result.ok||result.duplicate))complete=false;
    }catch(e){
      complete=false;
    }
  }
  // Старое хранилище удаляем только после подтверждённого переноса каждой
  // версии. При нехватке места или ошибке записи исходные копии остаются.
  if(complete){
    try{localStorage.removeItem(LEGACY_VERSIONS_KEY)}catch(e){}
  }
}

function saveVersionSnapshot(reason,silent){
  reason=reason||'Авто';
  silent=silent!==false;
  const text=editor.value||'';
  if(!text.trim())return false;

  if(nativeVersionsAvailable()){
    try{
      const result=JSON.parse(AndroidDocuments.saveVersion(activeArticleId,String(reason),text)||'{}');
      if(result.ok){
        if(!silent)toast('Версия сохранена');
        return true;
      }
      if(result.duplicate){
        if(!silent)toast('Такая версия уже сохранена');
        return true;
      }
      if(result.limit&&!silent)toast('История версий достигла лимита 100 МБ');
      if(result.error&&!silent)toast('Не удалось сохранить версию');
      return false;
    }catch(e){
      if(!silent)toast('Не удалось сохранить версию');
      return false;
    }
  }

  try{
    const list=legacyVersions();
    if(list[0]&&list[0].text===text){
      if(!silent)toast('Такая версия уже сохранена');
      return true;
    }
    list.unshift({id:String(Date.now()),ts:Date.now(),reason:String(reason),text:text});
    while(list.length>12)list.pop();
    localStorage.setItem(LEGACY_VERSIONS_KEY,JSON.stringify(list));
    if(!silent)toast('Версия сохранена');
    return true;
  }catch(e){
    return false;
  }
}

function saveVersionNow(){
  if(!editor.value.trim()){toast('Нет текста для сохранения');return}
  saveVersionSnapshot('Вручную',false);
  renderVersions();
}

function ensureProtectiveVersion(reason){
  if(!editor.value.trim())return true;
  const safe=saveVersionSnapshot(reason||'Защитная версия',true);
  if(!safe)toast('Не удалось сохранить защитную версию. Действие отменено');
  return safe;
}

function versionsPayload(){
  if(nativeVersionsAvailable()){
    try{return JSON.parse(AndroidDocuments.listVersions(activeArticleId)||'{}')}catch(e){return {versions:[]}}
  }
  const versions=legacyVersions().map(function(x){
    return {id:x.id,ts:x.ts,reason:x.reason,size:String(x.text||'').length,preview:String(x.text||'').replace(/\s+/g,' ').trim().slice(0,150)};
  });
  return {versions:versions,articleBytes:0,totalBytes:0,limitBytes:0};
}

function renderVersionUsage(data){
  const text=document.getElementById('versionUsageText');
  const bar=document.getElementById('versionUsageBar');
  if(!text||!bar)return;
  const total=Math.max(0,Number(data.totalBytes)||0);
  const article=Math.max(0,Number(data.articleBytes)||0);
  const limit=Math.max(0,Number(data.limitBytes)||0);
  if(limit){
    text.textContent='Эта статья: '+bytesLabel(article)+' · всего: '+bytesLabel(total)+' из '+bytesLabel(limit);
    bar.style.width=Math.min(100,(total/limit)*100)+'%';
  }else{
    text.textContent='История хранится локально';
    bar.style.width='0%';
  }
}

function renderVersions(){
  const root=document.getElementById('versionsList');
  if(!root)return;
  const data=versionsPayload();
  const versions=Array.isArray(data.versions)?data.versions:[];
  renderVersionUsage(data);
  if(!versions.length){
    root.innerHTML='<div class="empty versionEmpty">Версий этой статьи пока нет.</div>';
    return;
  }
  root.innerHTML=versions.map(function(item){
    const date=new Date(Number(item.ts)||Date.now()).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    const reason=escapeHtml(item.reason||'Версия');
    const preview=escapeHtml(item.preview||'');
    const id=String(item.id||'').replace(/'/g,'');
    return '<div class="versionCard">'+
      '<div class="versionMeta"><b>'+reason+'</b><span>'+date+' · '+bytesLabel(item.size)+'</span></div>'+
      '<div class="versionPreview">'+preview+'</div>'+
      '<div class="versionActions"><button type="button" onclick="restoreVersion(\''+id+'\')">Восстановить</button><button type="button" class="dangerText" onclick="deleteVersion(\''+id+'\')">Удалить</button></div>'+
      '</div>';
  }).join('');
}

function openVersions(){
  if(typeof closeSideDrawer==='function')closeSideDrawer();
  if(typeof persistCurrentArticleNow==='function')persistCurrentArticleNow();
  renderVersions();
  document.getElementById('versionsBackdrop').classList.add('open');
}

function closeVersions(){
  document.getElementById('versionsBackdrop').classList.remove('open');
}

function versionsBackdropClick(event){
  if(event.target&&event.target.id==='versionsBackdrop')closeVersions();
}

function loadVersionText(id){
  if(nativeVersionsAvailable()){
    try{return String(AndroidDocuments.loadVersion(activeArticleId,id)||'')}catch(e){return ''}
  }
  const item=legacyVersions().find(function(x){return String(x.id)===String(id)});
  return item?String(item.text||''):'';
}

async function restoreVersion(id){
  const text=loadVersionText(id);
  if(!text)return;
  const ok=await appConfirm('Восстановить версию?','Текущий текст сначала сохранится отдельной версией.','Восстановить',false);
  if(!ok)return;
  if(!ensureProtectiveVersion('Перед восстановлением'))return;
  historyCheckpoint();
  historyRestoring=true;
  editor.value=text;
  historyRestoring=false;
  if(typeof closeAllCorrectionPanels==='function')closeAllCorrectionPanels();
  clearOnlineSpelling();
  if(typeof afterProgrammaticEdit==='function')afterProgrammaticEdit(false);
  else{
    markAnalysisStale();
    render(false);
  }
  if(typeof persistCurrentArticleNow==='function')persistCurrentArticleNow();
  if(typeof updateCurrentArticleUi==='function')updateCurrentArticleUi();
  closeVersions();
  showPane('edit');
  editor.focus();
  editor.setSelectionRange(0,0);
  toast('Версия восстановлена');
}

async function deleteVersion(id){
  const ok=await appConfirm('Удалить версию?','Эту сохранённую копию нельзя будет восстановить.','Удалить',true);
  if(!ok)return;
  let deleted=false;
  if(nativeVersionsAvailable()){
    try{deleted=!!AndroidDocuments.deleteVersion(activeArticleId,id)}catch(e){deleted=false}
  }else{
    try{
      localStorage.setItem(LEGACY_VERSIONS_KEY,JSON.stringify(legacyVersions().filter(function(x){return String(x.id)!==String(id)})));
      deleted=true;
    }catch(e){deleted=false}
  }
  if(!deleted){
    toast('Не удалось удалить версию');
    return;
  }
  renderVersions();
}

async function doubleConfirmCleanup(title,text){
  const first=await appConfirm(title,text,'Продолжить',true);
  if(!first)return false;
  return await appConfirm('Подтвердите ещё раз','Удаление версий необратимо. Текущая статья останется без изменений.','Удалить версии',true);
}

async function cleanupVersions(mode){
  if(!nativeVersionsAvailable()){toast('Очистка истории доступна в установленном приложении');return}
  let title='Удалить версии?';
  let text='Будут удалены выбранные версии текущей статьи.';
  if(mode==='week'){title='Удалить версии старше недели?';text='Останутся версии за последние 7 дней.'}
  if(mode==='month'){title='Удалить версии старше месяца?';text='Останутся версии за последние 30 дней.'}
  if(mode==='all'){title='Удалить все версии?';text='История версий текущей статьи будет полностью очищена.'}
  if(!await doubleConfirmCleanup(title,text))return;

  let count=0;
  try{
    if(mode==='all')count=AndroidDocuments.deleteAllVersions(activeArticleId);
    else{
      const days=mode==='week'?7:30;
      count=AndroidDocuments.deleteVersionsOlderThan(activeArticleId,Date.now()-days*24*60*60*1000);
    }
  }catch(e){}
  renderVersions();
  toast('Удалено версий: '+count);
}

function flushAutoVersion(){
  if(!autoVersionDirty)return false;
  const now=Date.now();
  const minGap=60000;
  if(lastAutoVersionAt&&now-lastAutoVersionAt<minGap)return false;

  if(!editor.value.trim()){
    autoVersionDirty=false;
    return false;
  }

  const saved=saveVersionSnapshot('Авто',true);
  // Duplicate/current-state-already-saved is also a completed snapshot attempt.
  // Do not keep retrying the same text forever.
  autoVersionDirty=false;
  if(saved)lastAutoVersionAt=now;
  return saved;
}

function scheduleAutoVersion(){
  autoVersionDirty=true;
  if(autoVersionTimer)return;

  const now=Date.now();
  const firstDelay=15000;
  const minGap=60000;
  const wait=lastAutoVersionAt
    ? Math.max(1000,minGap-(now-lastAutoVersionAt))
    : firstDelay;

  autoVersionTimer=setTimeout(function(){
    autoVersionTimer=null;
    const flushed=flushAutoVersion();
    if(autoVersionDirty)scheduleAutoVersion();
  },wait);
}

editor.addEventListener('beforeinput',function(){
  if(historyRestoring)return;
  const size=editor.value.length;
  const now=Date.now();
  if(size>120000){
    if(now-lastLargeSnapshotAt<4500){
      beforeInputSnapshot=null;
      return;
    }
    lastLargeSnapshotAt=now;
  }
  beforeInputSnapshot=editorSnapshot();
});

editor.addEventListener('input',function(event){
  if(historyRestoring)return;
  const now=Date.now();
  const type=String(event.inputType||'');
  const mergeable=/^(insertText|insertCompositionText|deleteContentBackward|deleteContentForward)$/.test(type);
  const merge=mergeable&&now-lastTypingAt<900&&undoStack.length;
  if(beforeInputSnapshot&&!merge)pushUndoSnapshot(beforeInputSnapshot);
  redoStack=[];
  beforeInputSnapshot=null;
  lastTypingAt=now;
  updateHistoryButtons();
  scheduleAutoVersion();
});

document.addEventListener('visibilitychange',function(){
  if(document.hidden){
    autoVersionDirty=true;
    flushAutoVersion();
  }
});

updateHistoryButtons();
