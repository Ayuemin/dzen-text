const IDEAS_KEY='dzenQuickIdeasV1';
let sideTouch=null;

function openSideDrawer(){closeQuickMenu();if(document.activeElement===editor)editor.blur();document.getElementById('sideBackdrop').classList.add('open')}
function closeSideDrawer(){document.getElementById('sideBackdrop').classList.remove('open')}
function sideBackdropClick(e){if(e.target.id==='sideBackdrop')closeSideDrawer()}

function toggleQuickMenu(e){if(e)e.stopPropagation();document.getElementById('quickMenu').classList.toggle('open')}
function closeQuickMenu(){document.getElementById('quickMenu').classList.remove('open')}

function drawerEditor(){closeSideDrawer();showPane('edit')}
function drawerPreview(){closeSideDrawer();showPane('preview')}
function drawerImport(){closeSideDrawer();chooseFile()}
function drawerCheck(){closeSideDrawer();runFullCheck()}
function drawerVersions(){closeSideDrawer();openVersions()}
function drawerSettings(){closeSideDrawer();openSettings()}

function quickPreview(){closeQuickMenu();showPane('preview')}
function quickCopy(){closeQuickMenu();copyRichHtml()}
function quickSpeak(){closeQuickMenu();toggleSpeak()}
function quickCheck(){closeQuickMenu();runFullCheck()}
function quickImport(){closeQuickMenu();chooseFile()}
function quickSettings(){closeQuickMenu();openSettings()}
function quickClear(){closeQuickMenu();clearEditor()}

function loadIdeas(){
  try{
    const value=JSON.parse(localStorage.getItem(IDEAS_KEY)||'[]');
    return Array.isArray(value)?value:[];
  }catch(e){return []}
}
function saveIdeas(value){localStorage.setItem(IDEAS_KEY,JSON.stringify(value))}
function openIdeas(){closeSideDrawer();renderIdeas();document.getElementById('ideasBackdrop').classList.add('open');setTimeout(()=>document.getElementById('ideaInput').focus(),80)}
function closeIdeas(){document.getElementById('ideasBackdrop').classList.remove('open')}
function ideasBackdropClick(e){if(e.target.id==='ideasBackdrop')closeIdeas()}
function saveQuickIdea(){
  const input=document.getElementById('ideaInput'),text=input.value.trim();
  if(!text){toast('Сначала запишите идею');return}
  const ideas=loadIdeas();ideas.unshift({id:String(Date.now())+'_'+Math.random().toString(36).slice(2),text,created:Date.now()});
  saveIdeas(ideas.slice(0,300));input.value='';renderIdeas();toast('Идея сохранена')
}
async function deleteIdea(id){
  if(!await appConfirm('Удалить идею?','Идея будет удалена без переноса в текст.','Удалить',true))return;
  saveIdeas(loadIdeas().filter(x=>x.id!==id));renderIdeas()
}
function insertIdea(id){
  const idea=loadIdeas().find(x=>x.id===id);if(!idea)return;
  const start=editor.selectionStart||editor.value.length,end=editor.selectionEnd||start;
  const prefix=start&&editor.value[start-1]!=='\n'?'\n':'';
  historyCheckpoint();editor.setRangeText(prefix+idea.text,start,end,'end');render();closeIdeas();showPane('edit');editor.focus();toast('Идея вставлена в текст')
}
async function ideaAsText(id){
  const idea=loadIdeas().find(x=>x.id===id);if(!idea)return;
  if(editor.value.trim()&&!await appConfirm('Сделать идею текущим текстом?','Текущий текст будет сохранён в версиях перед заменой.','Заменить',false))return;
  saveVersionSnapshot('Перед заменой идеей',true);historyCheckpoint();editor.value=idea.text;clearOnlineSpelling();render(true);closeIdeas();showPane('edit');editor.focus();toast('Идея открыта в редакторе')
}
function renderIdeas(){
  const root=document.getElementById('ideasList'),ideas=loadIdeas();
  if(!ideas.length){root.innerHTML='<div class="empty">Пока нет идей. Запишите короткую мысль сверху.</div>';return}
  root.innerHTML=ideas.map(x=>{
    const date=x.created?new Date(x.created).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
    return '<div class="ideaCard"><div class="ideaText">'+escapeHtml(x.text)+'</div><div class="ideaMeta">'+date+'</div><div class="ideaActions">'+
      '<button type="button" onclick="insertIdea(\''+x.id+'\')">Вставить</button>'+
      '<button type="button" onclick="ideaAsText(\''+x.id+'\')">Сделать текстом</button>'+
      '<button type="button" class="dangerText" onclick="deleteIdea(\''+x.id+'\')">Удалить</button>'+
      '</div></div>'
  }).join('')
}

document.addEventListener('click',e=>{
  const menu=document.getElementById('quickMenu');
  if(menu.classList.contains('open')&&!menu.contains(e.target)&&!e.target.closest('.moreFloat'))closeQuickMenu()
});
document.addEventListener('touchstart',e=>{
  if(e.touches.length!==1)return;
  const t=e.touches[0];
  sideTouch={x:t.clientX,y:t.clientY,drawer:document.getElementById('sideBackdrop').classList.contains('open')};
},{passive:true});
document.addEventListener('touchend',e=>{
  if(!sideTouch||!e.changedTouches.length)return;
  const t=e.changedTouches[0],dx=t.clientX-sideTouch.x,dy=t.clientY-sideTouch.y;
  if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.35){
    if(!sideTouch.drawer&&sideTouch.x<Math.min(180,window.innerWidth*0.38)&&dx>0)openSideDrawer();
    else if(sideTouch.drawer&&dx<0)closeSideDrawer()
  }
  sideTouch=null
},{passive:true});

function handleNativeBack(){
  const confirmBox=document.getElementById('confirmBackdrop');
  if(confirmBox&&confirmBox.classList.contains('open')){resolveAppConfirm(false);return true}
  const versions=document.getElementById('versionsBackdrop');
  if(versions&&versions.classList.contains('open')){closeVersions();return true}
  const quick=document.getElementById('quickMenu');
  if(quick&&quick.classList.contains('open')){closeQuickMenu();return true}
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
  return false
}
window.handleNativeBack=handleNativeBack;
