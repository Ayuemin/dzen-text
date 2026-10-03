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

function installLocalPublicationSafety(){
  const escapePublishHtml=s=>String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const safeHttpUrl=raw=>{
    const url=String(raw==null?'':raw).trim();
    return /^https?:\/\/[^\s"'<>\\]+$/i.test(url)?url:'';
  };
  const linkRe=/\[([^\]\n]+)\]\((https?:\/\/[^\s)"'<>]+)\)/g;
  const publishInline=value=>{
    const links=[];
    let s=String(value==null?'':value).replace(linkRe,(m,label,href)=>{
      const url=safeHttpUrl(href);
      if(!url)return m;
      const token='\u0000'+links.length+'\u0000';
      links.push('<a href="'+escapePublishHtml(url)+'" rel="noopener noreferrer nofollow">'+escapePublishHtml(label)+'</a>');
      return token;
    });
    s=escapePublishHtml(s);
    s=s.replace(/`([^`]+)`/g,'<code>$1</code>');
    s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    s=s.replace(/__([^_]+)__/g,'<strong>$1</strong>');
    s=s.replace(/~~([^~]+)~~/g,'<del>$1</del>');
    s=s.replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>');
    s=s.replace(/\u0000(\d+)\u0000/g,(m,i)=>links[Number(i)]||'');
    s=s.replace(/\[([^\]\n]+)\]\([^)\n]*\)/g,(m,label)=>escapePublishHtml(label));
    return s;
  };
  const publishMarkdownToHtml=source=>{
    let src=String(source||'').replace(/\r\n?/g,'\n').trim();
    if(!src)return '';
    const lines=src.split('\n');
    const out=[];let para=[],listType=null,quote=[];
    const flushPara=()=>{if(para.length){out.push('<p>'+publishInline(para.join(' '))+'</p>');para=[]}};
    const closeList=()=>{if(listType){out.push('</'+listType+'>');listType=null}};
    const flushQuote=()=>{if(quote.length){out.push('<blockquote><p>'+publishInline(quote.join(' '))+'</p></blockquote>');quote=[]}};
    for(const raw of lines){
      const t=raw.trim();
      if(!t){flushPara();closeList();flushQuote();continue}
      let m=t.match(/^(#{1,6})\s+(.+)$/);
      if(m){flushPara();closeList();flushQuote();const n=Math.min(3,m[1].length);out.push('<h'+n+'>'+publishInline(m[2])+'</h'+n+'>');continue}
      if(/^([-*_])(?:\s*\1){2,}$/.test(t)){flushPara();closeList();flushQuote();continue}
      m=t.match(/^>\s?(.*)$/);
      if(m){flushPara();closeList();quote.push(m[1]);continue}else flushQuote();
      m=t.match(/^[-*+]\s+(.+)$/);
      if(m){flushPara();if(listType!=='ul'){closeList();out.push('<ul>');listType='ul'}out.push('<li>'+publishInline(m[1])+'</li>');continue}
      m=t.match(/^\d+[.)]\s+(.+)$/);
      if(m){flushPara();if(listType!=='ol'){closeList();out.push('<ol>');listType='ol'}out.push('<li>'+publishInline(m[1])+'</li>');continue}
      closeList();para.push(t);
    }
    flushPara();closeList();flushQuote();
    return out.join('\n');
  };
  const buildPayload=()=>{
    const src=String(editor.value||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
    const body=src.replace(/^\s*#[ \t]+[^\n]*\n?/,'');
    const html=publishMarkdownToHtml(body);
    if(!html)return null;
    const d=document.createElement('div');d.innerHTML=html;
    const plain=(d.innerText||d.textContent||'').replace(/\n{3,}/g,'\n\n').trim();
    return {html,plain};
  };
  copyRichHtml=function(){
    const payload=buildPayload();
    if(!payload){toast('Текущая статья пустая');return}
    const stage=document.getElementById('copyStage');
    const sel=window.getSelection();
    const saved=[];
    try{if(sel&&sel.rangeCount)for(let i=0;i<sel.rangeCount;i++)saved.push(sel.getRangeAt(i))}catch(e){}
    let ok=false;
    try{
      stage.innerHTML=payload.html;
      const range=document.createRange();
      range.selectNodeContents(stage);
      sel.removeAllRanges();sel.addRange(range);
      ok=!!document.execCommand('copy');
    }catch(e){ok=false}
    finally{
      try{stage.innerHTML=''}catch(e){}
      try{sel.removeAllRanges();for(const range of saved)sel.addRange(range)}catch(e){}
    }
    if(!ok){
      const ta=document.createElement('textarea');
      ta.value=payload.plain;
      ta.setAttribute('aria-hidden','true');
      ta.style.position='fixed';ta.style.left='-10000px';
      document.body.appendChild(ta);ta.select();
      try{ok=!!document.execCommand('copy')}catch(e){ok=false}
      ta.remove();
    }
    toast(ok?'Скопировано для публикации':'Не удалось скопировать');
  };
}

function bootstrapDzenText(){
  if(window.__dzenTextBootstrapped)return;
  window.__dzenTextBootstrapped=true;

  document.title='Дзен Текст 1.11.0';
  settings=loadSettings();
  installLocalPublicationSafety();
  userSynonyms=loadUserSynonyms();
  dzenRules=loadDzenRules();

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
    const draft=localStorage.getItem('dzenDraft');
    if(draft)editor.value=draft;
  }
  if(typeof migrateLegacyVersions==='function')migrateLegacyVersions();
  syncSettingsUI();
  updateUserSynonymStatus();
  updateDzenRulesStatus();
  render(false);
  scheduleLocalAnalysis();
  if(typeof updateCurrentArticleUi==='function')updateCurrentArticleUi();
  if(typeof updateDrawerSpeakLabel==='function')updateDrawerSpeakLabel();
  setTimeout(updateDictStatus,80);
  setTimeout(updateDictStatus,800);
}

try{
  bootstrapDzenText();
}catch(error){
  console.error('Dzen Text bootstrap failed',error);
  const t=document.getElementById('toast');
  if(t){
    t.textContent='Ошибка запуска редактора. Перезапустите приложение.';
    t.classList.add('show');
  }
}
