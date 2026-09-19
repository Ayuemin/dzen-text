let activeArticleId='';
let articleSaveTimer=null;
let articleSaveInterval=null;
let articleDirty=false;

function documentsAvailable(){
  return !!(window.AndroidDocuments&&typeof AndroidDocuments.ensureActiveArticle==='function');
}

function bytesLabel(value){
  const n=Math.max(0,Number(value)||0);
  if(n<1024)return Math.round(n)+' Б';
  if(n<1024*1024)return (n/1024).toFixed(n<10*1024?1:0)+' КБ';
  return (n/(1024*1024)).toFixed(n<10*1024*1024?1:0)+' МБ';
}

function articleTitleFromText(text){
  const lines=String(text||'').split(/\r?\n/);
  for(const raw of lines){
    let line=raw.trim();
    if(!line)continue;
    line=line.replace(/^\s*(?:#{1,6}|>|[-*+]|\d+[.)])\s*/,'')
      .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
      .replace(/[*_~\x60#]/g,'')
      .replace(/\s+/g,' ')
      .trim();
    if(line)return line.length>72?line.slice(0,72)+'…':line;
  }
  return 'Без названия';
}

function articleFileName(){
  let name=articleTitleFromText(editor.value).replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').trim();
  if(!name||name==='Без названия')name='Статья';
  if(name.length>72)name=name.slice(0,72).trim();
  return name+'.md';
}

function initArticleWorkspace(){
  if(!documentsAvailable()){
    const draft=settings.autosave?localStorage.getItem('dzenDraft'):'';
    if(draft)editor.value=draft;
    return false;
  }

  activeArticleId=String(AndroidDocuments.ensureActiveArticle()||'');
  let text=String(AndroidDocuments.loadArticle(activeArticleId)||'');
  const legacy=localStorage.getItem('dzenDraft')||'';
  if(!text&&legacy){
    text=legacy;
    AndroidDocuments.saveArticle(activeArticleId,text);
    localStorage.removeItem('dzenDraft');
  }
  editor.value=text;
  updateCurrentArticleUi();
  return true;
}

function persistCurrentArticleNow(){
  clearTimeout(articleSaveTimer);
  articleSaveTimer=null;
  if(!documentsAvailable()||!activeArticleId)return false;
  try{
    const ok=!!AndroidDocuments.saveArticle(activeArticleId,editor.value||'');
    if(ok)articleDirty=false;
    return ok;
  }catch(e){
    return false;
  }
}

function flushArticleAutosave(){
  if(!articleDirty)return;
  if(persistCurrentArticleNow()){
    updateCurrentArticleUi();
    const side=document.getElementById('sideBackdrop');
    if(side&&side.classList.contains('open'))renderSavedArticles();
  }
}

function scheduleArticleSave(){
  if(!documentsAvailable()||!activeArticleId)return;
  articleDirty=true;
  clearTimeout(articleSaveTimer);
  articleSaveTimer=setTimeout(flushArticleAutosave,900);
  if(!articleSaveInterval){
    articleSaveInterval=setInterval(flushArticleAutosave,5000);
  }
}

function preserveCurrentArticleBeforeSwitch(reason){
  const text=editor.value||'';
  if(!text.trim())return true;

  if(documentsAvailable()){
    if(!activeArticleId){
      try{activeArticleId=String(AndroidDocuments.ensureActiveArticle()||'')}catch(e){}
    }
    let saved=false;
    try{saved=!!AndroidDocuments.saveArticle(activeArticleId,text)}catch(e){saved=false}
    if(!saved){
      toast('Не удалось сохранить текущую статью. Переход отменён');
      return false;
    }
  }else{
    try{localStorage.setItem('dzenDraft',text)}catch(e){
      toast('Не удалось сохранить текущую статью. Переход отменён');
      return false;
    }
  }

  if(typeof saveVersionSnapshot==='function'){
    saveVersionSnapshot(reason||'Перед сменой статьи',true);
  }
  return true;
}

function resetEditorPanels(){
  try{if(typeof stopSpeak==='function'&&speaking)stopSpeak()}catch(e){}
  try{closeReplacement()}catch(e){}
  try{closeNearbyRepeat()}catch(e){}
  try{closeRepeatNavigator()}catch(e){}
  try{closeIssueNavigator()}catch(e){}
  try{closeSpellPanel()}catch(e){}
  try{clearOnlineSpelling()}catch(e){}
  if(typeof resetUndoHistory==='function')resetUndoHistory();
}

function setEditorTextForArticle(text,focus){
  editor.value=String(text||'');
  resetEditorPanels();
  markAnalysisStale();
  render(false);
  showPane('edit');
  if(focus){
    setTimeout(function(){
      editor.focus();
      const pos=editor.value.length;
      editor.setSelectionRange(pos,pos);
    },80);
  }
}

function createNewArticle(){
  const previousId=activeArticleId;
  const hadText=!!editor.value.trim();

  if(hadText&&!preserveCurrentArticleBeforeSwitch('Перед новой статьёй'))return;

  if(documentsAvailable()){
    activeArticleId=String(AndroidDocuments.createArticle()||'');
    if(!activeArticleId){
      toast('Не удалось создать новую статью');
      return;
    }
  }else{
    activeArticleId='local_'+Date.now();
  }

  setEditorTextForArticle('',true);
  localStorage.removeItem('dzenDraft');
  closeSideDrawer();
  updateCurrentArticleUi();
  renderSavedArticles();
}

function openSavedArticle(id){
  if(!documentsAvailable())return;
  const next=String(id||'');
  if(!next||next===activeArticleId){closeSideDrawer();return}
  if(editor.value.trim()&&!preserveCurrentArticleBeforeSwitch('Перед сменой статьи'))return;
  if(!AndroidDocuments.setActiveArticle(next)){toast('Не удалось открыть статью');return}
  activeArticleId=next;
  const text=String(AndroidDocuments.loadArticle(next)||'');
  setEditorTextForArticle(text,false);
  closeSideDrawer();
  updateCurrentArticleUi();
}

async function deleteSavedArticle(id){
  if(!documentsAvailable())return;
  const articles=loadSavedArticles();
  const item=articles.find(function(x){return x.id===id});
  const title=item&&item.title?item.title:'эту статью';
  const ok=await appConfirm('Удалить статью?','«'+title+'» и её версии будут удалены с устройства.','Удалить',true);
  if(!ok)return;
  const wasActive=id===activeArticleId;
  if(!AndroidDocuments.deleteArticle(id)){toast('Не удалось удалить статью');return}
  if(wasActive){
    activeArticleId=String(AndroidDocuments.createArticle()||'');
    setEditorTextForArticle('',true);
  }
  renderSavedArticles();
  updateCurrentArticleUi();
  toast('Статья удалена');
}

function loadSavedArticles(){
  if(!documentsAvailable())return [];
  try{
    const items=JSON.parse(AndroidDocuments.listArticles()||'[]');
    return Array.isArray(items)?items:[];
  }catch(e){
    return [];
  }
}

function renderSavedArticles(){
  const root=document.getElementById('savedArticlesList');
  const count=document.getElementById('savedArticlesCount');
  if(!root)return;
  const items=loadSavedArticles();
  if(count)count.textContent=String(items.length);
  if(!items.length){
    root.innerHTML='<div class="drawerEmpty">Сохранённых статей пока нет</div>';
    return;
  }
  root.innerHTML=items.map(function(item){
    const id=String(item.id||'').replace(/'/g,'');
    const active=id===activeArticleId;
    const title=escapeHtml(item.title||'Без названия');
    const date=new Date(Number(item.updated)||Date.now()).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    return '<div class="savedArticleRow '+(active?'active':'')+'">'+
      '<button type="button" class="savedArticleOpen" onclick="openSavedArticle(\''+id+'\')">'+
        '<span class="savedArticleTitle">'+title+'</span>'+
        '<span class="savedArticleMeta">'+date+' · '+bytesLabel(item.size)+'</span>'+
      '</button>'+
      '<button type="button" class="savedArticleDelete" onclick="deleteSavedArticle(\''+id+'\')" aria-label="Удалить статью">×</button>'+
    '</div>';
  }).join('');
}

function updateCurrentArticleUi(){
  const title=articleTitleFromText(editor.value);
  const label=document.getElementById('currentArticleLabel');
  if(label)label.textContent=title;
  const view=document.getElementById('drawerViewToggle');
  const previewPane=document.getElementById('previewPane');
  if(view)view.textContent=previewPane&&previewPane.classList.contains('active')?'Вернуться в редактор':'Предпросмотр';
}

function toggleEditorPreview(){
  const previewPane=document.getElementById('previewPane');
  const previewActive=previewPane&&previewPane.classList.contains('active');
  showPane(previewActive?'edit':'preview');
  updateCurrentArticleUi();
  closeSideDrawer();
}

function drawerCopyForPublication(){
  closeSideDrawer();
  copyRichHtml();
}

function drawerSpeak(){
  closeSideDrawer();
  toggleSpeak();
}

function updateDrawerSpeakLabel(){
  const button=document.getElementById('drawerSpeakBtn');
  if(button)button.textContent=speaking?'Остановить озвучку':'Озвучить';
}

function saveCurrentArticleToFile(){
  persistCurrentArticleNow();
  if(!editor.value.trim()){toast('Текущая статья пустая');return}
  const name=articleFileName();
  if(window.AndroidFile&&typeof AndroidFile.saveArticleFile==='function'){
    AndroidFile.saveArticleFile(editor.value,name);
    closeSideDrawer();
    return;
  }
  try{
    const blob=new Blob([editor.value],{type:'text/markdown;charset=utf-8'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){URL.revokeObjectURL(a.href)},1000);
    closeSideDrawer();
  }catch(e){
    toast('Не удалось сохранить файл');
  }
}

window.onNativeArticleSaved=function(name){toast('Статья сохранена'+(name?': '+name:''))};
window.onNativeArticleSaveError=function(msg){toast(msg||'Не удалось сохранить статью')};

editor.addEventListener('input',function(){
  scheduleArticleSave();
  updateCurrentArticleUi();
});

document.addEventListener('visibilitychange',function(){
  if(document.hidden)persistCurrentArticleNow();
});

window.addEventListener('beforeunload',persistCurrentArticleNow);
