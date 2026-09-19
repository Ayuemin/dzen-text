const EDIT_VERSIONS_KEY='dzenTextVersionsV1';
const MAX_UNDO_STATES=80;
const MAX_VERSIONS=20;
const MAX_VERSION_CHARS=650000;
let undoStack=[];
let redoStack=[];
let beforeInputSnapshot=null;
let lastTypingAt=0;
let autoVersionTimer=null;
let historyRestoring=false;

function editorSnapshot(){
  return {
    text:editor.value,
    start:editor.selectionStart||0,
    end:editor.selectionEnd||0
  };
}

function sameSnapshot(a,b){
  return !!a&&!!b&&a.text===b.text&&a.start===b.start&&a.end===b.end;
}

function pushUndoSnapshot(snapshot){
  if(!snapshot)return;
  const last=undoStack[undoStack.length-1];
  if(last&&sameSnapshot(last,snapshot))return;
  undoStack.push(snapshot);
  if(undoStack.length>MAX_UNDO_STATES)undoStack.splice(0,undoStack.length-MAX_UNDO_STATES);
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
  clearOnlineSpelling();
  render(true);
  markAnalysisStale();
  editor.focus();
  editor.setSelectionRange(start,end);
  historyRestoring=false;
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

function loadVersions(){
  try{
    const value=JSON.parse(localStorage.getItem(EDIT_VERSIONS_KEY)||'[]');
    return Array.isArray(value)?value:[];
  }catch(e){return []}
}

function storeVersions(items){
  try{
    localStorage.setItem(EDIT_VERSIONS_KEY,JSON.stringify(items));
    return true;
  }catch(e){
    return false;
  }
}

function trimVersions(items){
  const out=items.slice(0,MAX_VERSIONS);
  let total=0;
  const kept=[];
  for(const item of out){
    const size=String(item.text||'').length;
    if(kept.length&&total+size>MAX_VERSION_CHARS)break;
    kept.push(item);
    total+=size;
  }
  return kept;
}

function saveVersionSnapshot(reason='Авто',silent=true){
  const text=editor.value||'';
  if(!text.trim())return false;
  let versions=loadVersions();
  if(versions[0]&&versions[0].text===text)return false;
  const item={
    id:String(Date.now())+'_'+Math.random().toString(36).slice(2,7),
    ts:Date.now(),
    reason:String(reason||'Версия'),
    text
  };
  versions=trimVersions([item,...versions]);
  const ok=storeVersions(versions);
  if(ok&&!silent)toast('Версия сохранена');
  return ok;
}

function saveVersionNow(){
  if(!editor.value.trim()){toast('Нет текста для сохранения');return}
  if(!saveVersionSnapshot('Вручную',false))toast('Такая версия уже сохранена');
  renderVersions();
}

function versionPreview(text){
  const one=String(text||'').replace(/\s+/g,' ').trim();
  return one.length>110?one.slice(0,110)+'…':one;
}

function renderVersions(){
  const root=document.getElementById('versionsList');
  if(!root)return;
  const versions=loadVersions();
  if(!versions.length){
    root.innerHTML='<div class="empty versionEmpty">Версий пока нет. Они появятся автоматически после редактирования, а текущую можно сохранить вручную.</div>';
    return;
  }
  root.innerHTML=versions.map(item=>{
    const date=new Date(Number(item.ts)||Date.now()).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    const reason=escapeHtml(item.reason||'Версия');
    const preview=escapeHtml(versionPreview(item.text));
    const chars=String(item.text||'').length.toLocaleString('ru-RU');
    const id=String(item.id).replace(/'/g,'');
    return '<div class="versionCard">'+
      '<div class="versionMeta"><b>'+reason+'</b><span>'+date+' · '+chars+' знаков</span></div>'+
      '<div class="versionPreview">'+preview+'</div>'+
      '<div class="versionActions"><button type="button" onclick="restoreVersion(\''+id+'\')">Восстановить</button><button type="button" class="dangerText" onclick="deleteVersion(\''+id+'\')">Удалить</button></div>'+
      '</div>';
  }).join('');
}

function openVersions(){
  if(typeof closeQuickMenu==='function')closeQuickMenu();
  renderVersions();
  document.getElementById('versionsBackdrop').classList.add('open');
}

function closeVersions(){
  document.getElementById('versionsBackdrop').classList.remove('open');
}

function versionsBackdropClick(event){
  if(event.target&&event.target.id==='versionsBackdrop')closeVersions();
}

async function restoreVersion(id){
  const item=loadVersions().find(x=>x.id===id);
  if(!item)return;
  const ok=await appConfirm('Восстановить версию?','Текущий текст останется в истории и его можно будет вернуть.','Восстановить',false);
  if(!ok)return;
  saveVersionSnapshot('Перед восстановлением',true);
  historyCheckpoint();
  editor.value=item.text||'';
  clearOnlineSpelling();
  render(true);
  closeVersions();
  showPane('edit');
  editor.focus();
  editor.setSelectionRange(0,0);
  toast('Версия восстановлена');
}

async function deleteVersion(id){
  const ok=await appConfirm('Удалить версию?','Эту сохранённую копию нельзя будет восстановить.','Удалить',true);
  if(!ok)return;
  storeVersions(loadVersions().filter(x=>x.id!==id));
  renderVersions();
}

function scheduleAutoVersion(){
  clearTimeout(autoVersionTimer);
  autoVersionTimer=setTimeout(()=>saveVersionSnapshot('Авто',true),45000);
}

editor.addEventListener('beforeinput',event=>{
  if(historyRestoring)return;
  beforeInputSnapshot=editorSnapshot();
});

editor.addEventListener('input',event=>{
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

document.addEventListener('visibilitychange',()=>{
  if(document.hidden)saveVersionSnapshot('Авто',true);
});

updateHistoryButtons();
