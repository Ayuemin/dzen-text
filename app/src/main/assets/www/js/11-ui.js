const IDEAS_KEY='dzenQuickIdeasV1';
let sideTouch=null;

function openSideDrawer(){
  if(document.activeElement===editor)editor.blur();
  if(typeof persistCurrentArticleNow==='function')persistCurrentArticleNow();
  if(typeof renderSavedArticles==='function')renderSavedArticles();
  if(typeof updateCurrentArticleUi==='function')updateCurrentArticleUi();
  if(typeof updateDrawerSpeakLabel==='function')updateDrawerSpeakLabel();
  document.getElementById('sideBackdrop').classList.add('open');
}

function closeSideDrawer(){
  document.getElementById('sideBackdrop').classList.remove('open');
}

function sideBackdropClick(event){
  if(event.target&&event.target.id==='sideBackdrop')closeSideDrawer();
}

function drawerImport(){closeSideDrawer();chooseFile()}
function drawerCheck(){closeSideDrawer();runFullCheck()}
function drawerVersions(){closeSideDrawer();openVersions()}
function drawerSettings(){closeSideDrawer();openSettings()}
function drawerIdeas(){closeSideDrawer();openIdeas()}
function drawerClear(){closeSideDrawer();clearEditor()}

function loadIdeas(){
  try{
    const value=JSON.parse(localStorage.getItem(IDEAS_KEY)||'[]');
    return Array.isArray(value)?value:[];
  }catch(e){return []}
}

function saveIdeas(value){
  try{
    localStorage.setItem(IDEAS_KEY,JSON.stringify(value));
    return true;
  }catch(e){
    toast('Не удалось сохранить идеи: локальное хранилище недоступно');
    return false;
  }
}

function openIdeas(){
  closeSideDrawer();
  if(typeof closeAllCorrectionPanels==='function')closeAllCorrectionPanels();
  renderIdeas();
  document.getElementById('ideasBackdrop').classList.add('open');
  setTimeout(function(){document.getElementById('ideaInput').focus()},80);
}

function closeIdeas(){
  document.getElementById('ideasBackdrop').classList.remove('open');
}

function ideasBackdropClick(event){
  if(event.target&&event.target.id==='ideasBackdrop')closeIdeas();
}

function saveQuickIdea(){
  const input=document.getElementById('ideaInput');
  const text=input.value.trim();
  if(!text){toast('Сначала запишите идею');return}
  const ideas=loadIdeas();
  ideas.unshift({id:String(Date.now())+'_'+Math.random().toString(36).slice(2),text:text,created:Date.now()});
  if(!saveIdeas(ideas.slice(0,300)))return;
  input.value='';
  renderIdeas();
  toast('Идея сохранена');
}

async function deleteIdea(id){
  if(!await appConfirm('Удалить идею?','Идея будет удалена без переноса в текст.','Удалить',true))return;
  if(!saveIdeas(loadIdeas().filter(function(x){return x.id!==id})))return;
  renderIdeas();
}

function insertIdea(id){
  const idea=loadIdeas().find(function(x){return x.id===id});
  if(!idea)return;
  const start=editor.selectionStart||editor.value.length;
  const end=editor.selectionEnd||start;
  const prefix=start&&editor.value[start-1]!=='\n'?'\n':'';
  historyCheckpoint();
  editor.setRangeText(prefix+idea.text,start,end,'end');
  afterProgrammaticEdit(false);
  closeIdeas();
  showPane('edit');
  editor.focus();
  toast('Идея вставлена в текст');
}

async function ideaAsText(id){
  const idea=loadIdeas().find(function(x){return x.id===id});
  if(!idea)return;

  if(editor.value.trim()){
    const ok=await appConfirm(
      'Создать статью из идеи?',
      'Текущая статья сохранится в библиотеке, а идея откроется как новая статья.',
      'Создать статью',
      false
    );
    if(!ok)return;
    if(typeof preserveCurrentArticleBeforeSwitch==='function'&&!preserveCurrentArticleBeforeSwitch('Перед статьёй из идеи'))return;
  }

  if(documentsAvailable()){
    const previousId=activeArticleId;
    let newId='';
    try{newId=String(AndroidDocuments.createArticle()||'')}catch(e){newId=''}
    if(!newId){
      toast('Не удалось создать статью из идеи');
      return;
    }

    let saved=false;
    try{saved=!!AndroidDocuments.saveArticle(newId,idea.text||'')}catch(e){saved=false}
    if(!saved){
      try{AndroidDocuments.deleteArticle(newId)}catch(e){}
      try{if(previousId)AndroidDocuments.setActiveArticle(previousId)}catch(e){}
      activeArticleId=previousId;
      toast('Не удалось сохранить статью из идеи');
      return;
    }
    activeArticleId=newId;
  }else{
    activeArticleId='local_'+Date.now();
  }

  setEditorTextForArticle(idea.text||'',true);
  if(typeof persistCurrentArticleNow==='function')persistCurrentArticleNow();
  closeIdeas();
  updateCurrentArticleUi();
  renderSavedArticles();
  toast('Идея открыта как новая статья');
}

function renderIdeas(){
  const root=document.getElementById('ideasList');
  const ideas=loadIdeas();
  if(!ideas.length){
    root.innerHTML='<div class="empty">Пока нет идей. Запишите короткую мысль сверху.</div>';
    return;
  }
  root.innerHTML=ideas.map(function(x){
    const date=x.created?new Date(x.created).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
    return '<div class="ideaCard"><div class="ideaText">'+escapeHtml(x.text)+'</div><div class="ideaMeta">'+date+'</div><div class="ideaActions">'+
      '<button type="button" onclick="insertIdea(\''+x.id+'\')">Вставить</button>'+
      '<button type="button" onclick="ideaAsText(\''+x.id+'\')">Сделать текстом</button>'+
      '<button type="button" class="dangerText" onclick="deleteIdea(\''+x.id+'\')">Удалить</button>'+
      '</div></div>';
  }).join('');
}

document.addEventListener('touchstart',function(event){
  if(event.touches.length!==1)return;
  const t=event.touches[0];
  sideTouch={
    x:t.clientX,
    y:t.clientY,
    drawer:document.getElementById('sideBackdrop').classList.contains('open')
  };
},{passive:true});

document.addEventListener('touchend',function(event){
  if(!sideTouch||!event.changedTouches.length)return;
  const t=event.changedTouches[0];
  const dx=t.clientX-sideTouch.x;
  const dy=t.clientY-sideTouch.y;
  if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.3){
    const openZone=Math.min(220,window.innerWidth*0.46);
    if(!sideTouch.drawer&&sideTouch.x<openZone&&dx>0)openSideDrawer();
    else if(sideTouch.drawer&&dx<0)closeSideDrawer();
  }
  sideTouch=null;
},{passive:true});

function handleNativeBack(){
  const confirmBox=document.getElementById('confirmBackdrop');
  if(confirmBox&&confirmBox.classList.contains('open')){resolveAppConfirm(false);return true}
  const versions=document.getElementById('versionsBackdrop');
  if(versions&&versions.classList.contains('open')){closeVersions();return true}
  const side=document.getElementById('sideBackdrop');
  if(side&&side.classList.contains('open')){closeSideDrawer();return true}
  const ideas=document.getElementById('ideasBackdrop');
  if(ideas&&ideas.classList.contains('open')){closeIdeas();return true}
  const settingsSheet=document.getElementById('settingsBackdrop');
  if(settingsSheet&&settingsSheet.classList.contains('open')){closeSettings();return true}
  const analysis=document.getElementById('analysisBackdrop');
  if(analysis&&analysis.classList.contains('open')){closeAnalysis();return true}
  if(typeof spellNavState!=='undefined'&&spellNavState){closeSpellPanel();return true}
  if(typeof replacementState!=='undefined'&&replacementState){closeReplacement();return true}
  if(typeof nearbyState!=='undefined'&&nearbyState){closeNearbyRepeat();return true}
  if(typeof repeatNavState!=='undefined'&&repeatNavState){closeRepeatNavigator();return true}
  if(typeof issueNavState!=='undefined'&&issueNavState){closeIssueNavigator();return true}
  const previewPane=document.getElementById('previewPane');
  if(previewPane&&previewPane.classList.contains('active')){showPane('edit');return true}

  // Android may destroy the WebView immediately after Back. Flush the active
  // article synchronously through the native bridge before allowing Activity exit.
  try{
    if(typeof persistCurrentArticleNow==='function')persistCurrentArticleNow();
    if(typeof flushAutoVersion==='function')flushAutoVersion();
  }catch(e){}
  return false;
}

window.handleNativeBack=handleNativeBack;
