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
  if(!activeArticleId){
    toast('Не удалось открыть хранилище статей');
    return false;
  }
  let text=String(AndroidDocuments.loadArticle(activeArticleId)||'');
  let legacy='';
  try{legacy=localStorage.getItem('dzenDraft')||''}catch(e){}
  let legacyNeedsRetry=false;
  if(!text&&legacy){
    text=legacy;
    let migrated=false;
    try{migrated=!!AndroidDocuments.saveArticle(activeArticleId,text)}catch(e){migrated=false}
    if(migrated){
      try{localStorage.removeItem('dzenDraft')}catch(e){}
    }else{
      // Не удаляем единственную старую копию, пока нативное хранилище
      // не подтвердило запись. Фоновое автосохранение попробует ещё раз.
      legacyNeedsRetry=true;
    }
  }
  editor.value=text;
  if(legacyNeedsRetry){
    articleDirty=true;
    scheduleArticleSave();
    toast('Черновик восстановлен. Сохранение будет повторено автоматически');
  }
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

function resetArticleAutosaveState(){
  clearTimeout(articleSaveTimer);
  articleSaveTimer=null;
  articleDirty=false;
}

function preserveCurrentArticleBeforeSwitch(reason){
  const text=editor.value||'';
  const versionReason=reason||'Перед сменой статьи';

  if(documentsAvailable()){
    if(!activeArticleId){
      try{activeArticleId=String(AndroidDocuments.ensureActiveArticle()||'')}catch(e){}
    }
    if(!activeArticleId){
      toast('Не удалось определить текущую статью. Переход отменён');
      return false;
    }

    // Если пользователь только что удалил весь текст, на диске ещё может
    // оставаться предыдущая непустая редакция. Сохраняем её в историю до
    // записи пустого состояния, иначе быстрый переход на другую статью
    // может сделать это состояние невосстановимым.
    if(!text.trim()&&articleDirty&&typeof AndroidDocuments.loadArticle==='function'&&typeof AndroidDocuments.saveVersion==='function'){
      try{
        const previousText=String(AndroidDocuments.loadArticle(activeArticleId)||'');
        if(previousText.trim()){
          const result=JSON.parse(AndroidDocuments.saveVersion(activeArticleId,versionReason,previousText)||'{}');
          if(!(result.ok||result.duplicate)){
            toast('Не удалось сохранить защитную версию. Переход отменён');
            return false;
          }
        }
      }catch(e){
        toast('Не удалось сохранить защитную версию. Переход отменён');
        return false;
      }
    }

    let saved=false;
    try{saved=!!AndroidDocuments.saveArticle(activeArticleId,text)}catch(e){saved=false}
    if(saved)articleDirty=false;
    if(!saved){
      toast('Не удалось сохранить текущую статью. Переход отменён');
      return false;
    }
  }else{
    try{
      if(text)localStorage.setItem('dzenDraft',text);
      else localStorage.removeItem('dzenDraft');
    }catch(e){
      toast('Не удалось сохранить текущую статью. Переход отменён');
      return false;
    }
  }

  if(text.trim()&&typeof saveVersionSnapshot==='function'){
    saveVersionSnapshot(versionReason,true);
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
  resetArticleAutosaveState();
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
  if(!preserveCurrentArticleBeforeSwitch('Перед новой статьёй'))return;

  if(documentsAvailable()){
    const newId=String(AndroidDocuments.createArticle()||'');
    if(!newId){
      toast('Не удалось создать новую статью');
      return;
    }
    activeArticleId=newId;
  }else{
    activeArticleId='local_'+Date.now();
  }

  setEditorTextForArticle('',true);
  try{localStorage.removeItem('dzenDraft')}catch(e){}
  closeSideDrawer();
  updateCurrentArticleUi();
  renderSavedArticles();
}

function openSavedArticle(id){
  if(!documentsAvailable())return;
  const next=String(id||'');
  if(!next||next===activeArticleId){closeSideDrawer();return}
  if(!preserveCurrentArticleBeforeSwitch('Перед сменой статьи'))return;

  // Сначала читаем цель и только после этого меняем активный ID. Так ошибка
  // чтения не оставит старый текст привязанным к другой статье.
  let text='';
  try{text=String(AndroidDocuments.loadArticle(next)||'')}catch(e){
    toast('Не удалось прочитать статью');
    return;
  }
  let activated=false;
  try{activated=!!AndroidDocuments.setActiveArticle(next)}catch(e){activated=false}
  if(!activated){toast('Не удалось открыть статью');return}
  activeArticleId=next;
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
    if(!activeArticleId){
      setEditorTextForArticle('',false);
      toast('Статья удалена, но не удалось создать новое рабочее окно');
      renderSavedArticles();
      updateCurrentArticleUi();
      return;
    }
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
