function afterProgrammaticEdit(runAnalysis=false){
  markAnalysisStale();
  render(!!runAnalysis);
  if(typeof scheduleArticleSave==='function')scheduleArticleSave();
  if(typeof scheduleAutoVersion==='function')scheduleAutoVersion();
  if(typeof updateCurrentArticleUi==='function')updateCurrentArticleUi();
}

async function clearEditor(){
  if(!editor.value.trim()){
    showPane('edit');
    setTimeout(()=>editor.focus(),40);
    return;
  }
  if(!await appConfirm('Очистить текущий текст?','Перед очисткой будет сохранена версия, поэтому текст можно будет восстановить.','Очистить',true))return;
  if(!ensureProtectiveVersion('Перед очисткой'))return;
  historyCheckpoint();
  stopSpeak();
  closeReplacement();
  closeNearbyRepeat();
  closeRepeatNavigator();
  if(typeof closeIssueNavigator==='function')closeIssueNavigator();
  closeSpellPanel();
  clearOnlineSpelling();
  editor.value='';
  localStorage.removeItem('dzenDraft');
  markAnalysisStale();
  render(false);
  if(typeof persistCurrentArticleNow==='function')persistCurrentArticleNow();
  if(typeof renderSavedArticles==='function')renderSavedArticles();
  showPane('edit');
  setTimeout(()=>{
    editor.focus();
    editor.setSelectionRange(0,0);
  },60);
  toast('Статья очищена');
}
function chooseFile(){if(window.AndroidFile&&typeof AndroidFile.pick==='function'){AndroidFile.pick();return}document.getElementById('fileInput').click()}
function htmlToEditableText(html){const root=document.createElement('div');root.innerHTML=html;function walk(n){if(n.nodeType===3)return n.nodeValue||'';if(n.nodeType!==1)return '';const tag=n.tagName.toLowerCase();const inner=Array.from(n.childNodes).map(walk).join('');if(/^h[1-6]$/.test(tag))return '#'.repeat(+tag[1])+' '+inner.trim()+'\n\n';if(tag==='p'||tag==='div'||tag==='section'||tag==='article')return inner.trim()+'\n\n';if(tag==='br')return '\n';if(tag==='strong'||tag==='b')return '**'+inner+'**';if(tag==='em'||tag==='i')return '*'+inner+'*';if(tag==='blockquote')return inner.trim().split(/\n/).map(x=>'> '+x).join('\n')+'\n\n';if(tag==='li'){const ol=n.parentElement&&n.parentElement.tagName.toLowerCase()==='ol';return (ol?'1. ':'- ')+inner.trim()+'\n'}if(tag==='ul'||tag==='ol')return inner+'\n';if(tag==='hr')return '---\n\n';if(tag==='a'){const href=n.getAttribute('href')||'';return /^https?:/i.test(href)?`[${inner.trim()||href}](${href})`:inner}return inner}return walk(root).replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim()}
async function loadFileText(text,name=''){
  if(editor.value.trim()){
    const ok=await appConfirm('Импортировать файл?','Текущий текст будет заменён содержимым файла. Перед заменой сохранится версия, которую можно восстановить.','Импортировать',false);
    if(!ok)return;
  }
  if(editor.value.trim()&&typeof ensureProtectiveVersion==='function'&&!ensureProtectiveVersion('Перед импортом'))return;
  historyCheckpoint();
  const ext=(name.split('.').pop()||'').toLowerCase();
  editor.value=(ext==='html'||ext==='htm')?htmlToEditableText(text):String(text||'').replace(/^\uFEFF/,'');
  closeReplacement();
  closeNearbyRepeat();
  closeRepeatNavigator();
  if(typeof closeIssueNavigator==='function')closeIssueNavigator();
  clearOnlineSpelling();
  render(false);
  markAnalysisStale();
  if(typeof persistCurrentArticleNow==='function')persistCurrentArticleNow();
  showPane('edit');
  editor.focus();
  if(editor.value.length<120000){
    setTimeout(()=>{try{analyzeText()}catch(e){}},220);
  }else{
    toast('Большой текст загружен. Полную проверку запускайте кнопкой «Проверить текст»');
  }
  toast(name?('Загружен файл: '+name):'Текст загружен из файла');
}
window.onNativeFileLoaded=(text,name)=>loadFileText(text,name||'');window.onNativeFileError=(msg)=>toast(msg||'Не удалось открыть файл');

let statsTimer=null;
let previewDirty=true;

function fastWordCount(src){
  let count=0,inWord=false;
  for(let i=0;i<src.length;i++){
    const c=src.charCodeAt(i);
    const word=(c>=48&&c<=57)||(c>=65&&c<=90)||(c>=97&&c<=122)||(c>=0x0410&&c<=0x044F)||c===0x0401||c===0x0451;
    if(word){
      if(!inWord){count++;inWord=true}
    }else{
      inWord=false;
    }
  }
  return count;
}

function updateStatsFast(){
  const src=editor.value||'';
  const chars=src.length;
  const words=fastWordCount(src);
  document.getElementById('chars').textContent=chars.toLocaleString('ru-RU');
  document.getElementById('words').textContent=words.toLocaleString('ru-RU');
  const mins=words/Math.max(1,settings.wpm);
  document.getElementById('readTime').textContent=words===0?'0 мин':mins<1?'меньше 1 мин':Math.max(1,Math.ceil(mins))+' мин';
}

function scheduleStatsUpdate(immediate=false){
  clearTimeout(statsTimer);
  if(immediate){updateStatsFast();return}
  const size=editor.value.length;
  const delay=size>250000?1200:size>120000?700:260;
  statsTimer=setTimeout(updateStatsFast,delay);
}

function renderPreview(){
  const html=markdownToHtml(editor.value);
  preview.innerHTML=html||'<div class="empty">Здесь появится оформленный текст</div>';
  htmlCode.textContent=html;
  htmlCode.style.display=settings.showCode?'block':'none';
  previewDirty=false;
}

function render(runAnalysis=true,forcePreview=false){
  previewDirty=true;
  const previewActive=document.getElementById('previewPane').classList.contains('active');
  if(forcePreview||previewActive)renderPreview();
  scheduleStatsUpdate(runAnalysis||forcePreview);
  if(runAnalysis)analyzeText();
  if(!(typeof documentsAvailable==='function'&&documentsAvailable())&&settings.autosave){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>localStorage.setItem('dzenDraft',editor.value),500);
  }
}

function updateStats(){updateStatsFast()}

function showPane(name){
  document.getElementById('editPane').classList.toggle('active',name==='edit');
  document.getElementById('previewPane').classList.toggle('active',name==='preview');
  document.getElementById('editTab').classList.toggle('active',name==='edit');
  document.getElementById('previewTab').classList.toggle('active',name==='preview');
  if(name==='preview'&&previewDirty)render(false,true);
  if(typeof updateMarkdownToolbarVisibility==='function')setTimeout(updateMarkdownToolbarVisibility,20);
  if(typeof updateCurrentArticleUi==='function')updateCurrentArticleUi();
}

function copyRichHtml(){
  const html=markdownToHtml(editor.value);
  if(!html){toast('Текущая статья пустая');return}
  const stage=document.getElementById('copyStage');
  stage.innerHTML=html;
  const sel=window.getSelection(),range=document.createRange();
  range.selectNodeContents(stage);
  sel.removeAllRanges();
  sel.addRange(range);
  let ok=false;
  try{ok=document.execCommand('copy')}catch(e){}
  sel.removeAllRanges();
  if(ok){
    toast('Скопировано для публикации');
  }else{
    const ta=document.createElement('textarea');
    ta.value=editor.value;
    document.body.appendChild(ta);
    ta.select();
    try{ok=document.execCommand('copy')}catch(e){}
    ta.remove();
    toast(ok?'Текст скопирован для публикации':'Не удалось скопировать');
  }
}

function cleanSpeechText(){
  return plainFromHtml(markdownToHtml(editor.value)).replace(/https?:\/\/\S+/g,'ссылка').replace(/\s+/g,' ').trim();
}

function toggleSpeak(){
  if(speaking){stopSpeak();return}
  const text=cleanSpeechText();
  if(!text){toast('Нет текста для озвучки');return}
  if(window.AndroidTTS&&typeof AndroidTTS.speak==='function'){
    AndroidTTS.speak(text,Number(settings.tts));
    setSpeaking(true);
    return;
  }
  if('speechSynthesis' in window){
    try{
      speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(text);
      u.lang='ru-RU';
      u.rate=Number(settings.tts);
      u.onend=()=>setSpeaking(false);
      u.onerror=()=>setSpeaking(false);
      speechSynthesis.speak(u);
      setSpeaking(true);
      return;
    }catch(e){}
  }
  toast('Системная озвучка недоступна');
}

function stopSpeak(){
  if(window.AndroidTTS&&typeof AndroidTTS.stop==='function')AndroidTTS.stop();
  if('speechSynthesis' in window)try{speechSynthesis.cancel()}catch(e){}
  setSpeaking(false);
}

function setSpeaking(v){
  speaking=!!v;
  const b=document.getElementById('speakBtn');
  if(b){b.classList.toggle('stop',speaking);b.setAttribute('aria-label',speaking?'Остановить озвучку':'Озвучить');b.title=speaking?'Стоп':'Озвучить'}
  const st=document.getElementById('speakText');
  if(st)st.textContent=speaking?'Стоп':'Озвучить';
  const icon=document.getElementById('speakIcon');
  if(icon)icon.innerHTML=speaking?'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11"/></svg>';
  if(typeof updateDrawerSpeakLabel==='function')updateDrawerSpeakLabel();
}
window.browserSynonymMap={};
function updateDictStatus(){const el=document.getElementById('dictStatus');let txt='Встроенный словарь: проверяю…';try{if(window.AndroidDictionary&&typeof AndroidDictionary.status==='function'){const o=JSON.parse(AndroidDictionary.status()||'{}');const built=Number(o.builtinCount||0);if(built)txt=`Встроенный словарь: <b>${built}</b> слов · готов`;else if(o.builtinError)txt=`Встроенный словарь: <b>ошибка</b> (${escapeHtml(String(o.builtinError))})`;else txt='Встроенный словарь: не загружен';if(o.count)txt+=`<br>Внешний: <b>${escapeHtml(o.name||'словарь')}</b> · ${o.count} слов`;else txt+='<br>Внешний словарь: не загружен'}else txt='Встроенный словарь: доступен только в установленном приложении'}catch(e){txt='Встроенный словарь: не удалось получить статус'}if(window.browserSynonymCount)txt+=`<br>Словарь браузера: <b>${escapeHtml(window.browserSynonymName||'словарь')}</b> · ${window.browserSynonymCount} слов`;el.innerHTML=txt}
function chooseSynonymDictionary(){if(window.AndroidDictionary&&typeof AndroidDictionary.pick==='function'){AndroidDictionary.pick();return}document.getElementById('synonymFileInput').click()}
function clearSynonymDictionary(){if(window.AndroidDictionary&&typeof AndroidDictionary.clear==='function'){AndroidDictionary.clear();updateDictStatus();toast('Внешний словарь удалён');return}window.browserSynonymMap={};window.browserSynonymCount=0;updateDictStatus();toast('Внешний словарь удалён')}
function parseBrowserDictionary(text,name){try{const src=String(text||'').trim(),map={};if(src.startsWith('{')){const o=JSON.parse(src);if(Array.isArray(o.wordlist)){for(const it of o.wordlist){if(!it||!it.name||!Array.isArray(it.synonyms))continue;map[String(it.name).toLocaleLowerCase('ru-RU')]=it.synonyms.map(String).filter(Boolean)}}else{for(const [k,v] of Object.entries(o)){const a=Array.isArray(v)?v:(typeof v==='string'?v.split(/[|;,]/):[]);if(a.length)map[k.toLocaleLowerCase('ru-RU')]=a.map(x=>String(x).trim()).filter(Boolean)}}}else{for(const line of src.split(/\r?\n/)){const m=line.match(/^\s*([^=:\t]+)\s*[=:\t]\s*(.+)$/);if(!m)continue;const a=m[2].split(/[|;,]/).map(x=>x.trim()).filter(Boolean);if(a.length)map[m[1].trim().toLocaleLowerCase('ru-RU')]=a}}window.browserSynonymMap=map;window.browserSynonymCount=Object.keys(map).length;window.browserSynonymName=name||'словарь';updateDictStatus();toast(`Словарь загружен: ${window.browserSynonymCount} слов`)}catch(e){toast('Не удалось разобрать словарь')}}
window.onNativeDictionaryLoaded=(name,count)=>{updateDictStatus();toast(`Словарь загружен: ${count} слов`)};window.onNativeDictionaryError=(msg)=>toast(msg||'Не удалось загрузить словарь');
