function markdownWrap(before,after,placeholder){
  const start=editor.selectionStart,end=editor.selectionEnd;
  const selected=editor.value.slice(start,end);
  const body=selected||placeholder||'текст';
  const replacement=before+body+after;
  editor.setRangeText(replacement,start,end,'end');
  if(selected){
    editor.setSelectionRange(start+before.length,start+before.length+selected.length);
  }else{
    editor.setSelectionRange(start+before.length,start+before.length+body.length);
  }
}

function markdownPrefix(kind){
  const value=editor.value,start=editor.selectionStart,end=editor.selectionEnd;
  const lineStart=value.lastIndexOf('\n',Math.max(0,start-1))+1;
  let lineEnd=value.indexOf('\n',end);
  if(lineEnd<0)lineEnd=value.length;
  const block=value.slice(lineStart,lineEnd);
  const lines=block.split('\n');
  let replacement='';

  if(/^h[1-6]$/.test(kind)){
    const level=Number(kind.slice(1));
    const mark='#'.repeat(level);
    const all=lines.every(function(x){return new RegExp('^\\\\s*'+mark+'\\\\s+').test(x)});
    replacement=lines.map(function(line){
      if(all)return line.replace(new RegExp('^(\\\\s*)'+mark+'\\\\s+'),'$1');
      return line.replace(/^(\s*)#{1,6}\s+/,'$1').replace(/^(\s*)/,'$1'+mark+' ');
    }).join('\n');
  }else if(kind==='quote'){
    const all=lines.every(function(x){return /^\s*>\s?/.test(x)});
    replacement=lines.map(function(line){return all?line.replace(/^(\s*)>\s?/,'$1'):line.replace(/^(\s*)/,'$1> ')}).join('\n');
  }else if(kind==='bullet'){
    const all=lines.every(function(x){return /^\s*[-*+]\s+/.test(x)});
    replacement=lines.map(function(line){return all?line.replace(/^(\s*)[-*+]\s+/,'$1'):line.replace(/^(\s*)(?:\d+[.)]\s+)?/,'$1- ')}).join('\n');
  }else if(kind==='number'){
    const all=lines.every(function(x){return /^\s*\d+[.)]\s+/.test(x)});
    replacement=lines.map(function(line,i){
      if(all)return line.replace(/^(\s*)\d+[.)]\s+/,'$1');
      return line.replace(/^(\s*)(?:[-*+]\s+)?/,'$1'+(i+1)+'. ');
    }).join('\n');
  }

  editor.setRangeText(replacement,lineStart,lineEnd,'select');
}

function applyMarkdown(action){
  if(typeof historyCheckpoint==='function')historyCheckpoint();
  editor.focus();
  if(action==='bold')markdownWrap('**','**','текст');
  else if(action==='italic')markdownWrap('*','*','текст');
  else if(action==='strike')markdownWrap('~~','~~','текст');
  else if(action==='code'){
    const tick=String.fromCharCode(96);
    markdownWrap(tick,tick,'код');
  }else if(action==='link'){
    const start=editor.selectionStart,end=editor.selectionEnd;
    const label=editor.value.slice(start,end)||'ссылка';
    const replacement='['+label+'](https://)';
    editor.setRangeText(replacement,start,end,'end');
    const urlStart=start+label.length+3;
    editor.setSelectionRange(urlStart,urlStart+8);
  }else if(action==='hr'){
    const start=editor.selectionStart,end=editor.selectionEnd;
    editor.setRangeText((start&&editor.value[start-1]!=='\n'?'\n':'')+'---\n',start,end,'end');
  }else if(['h1','h2','h3','h4','h5','h6','quote','bullet','number'].includes(action)){
    markdownPrefix(action);
  }
  afterProgrammaticEdit(false);
  updateMarkdownToolbarVisibility();
}

function updateMarkdownToolbarVisibility(){
  const bar=document.getElementById('markdownToolbar');
  if(!bar)return;
  const edit=document.getElementById('editPane');
  const visible=settings.markdownToolbar!==false&&
    document.activeElement===editor&&
    edit&&edit.classList.contains('active')&&
    window.__keyboardOpen===true;
  bar.classList.toggle('visible',visible);
  document.body.classList.toggle('markdown-toolbar-visible',visible);
}

(function initMarkdownToolbar(){
  const bar=document.getElementById('markdownToolbar');
  if(!bar)return;
  bar.addEventListener('pointerdown',e=>{
    if(e.target.closest('button'))e.preventDefault();
  });
  editor.addEventListener('focus',()=>setTimeout(updateMarkdownToolbarVisibility,20));
  editor.addEventListener('blur',()=>setTimeout(updateMarkdownToolbarVisibility,100));
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',updateMarkdownToolbarVisibility);
  }
  window.addEventListener('resize',updateMarkdownToolbarVisibility);
  window.addEventListener('dzenKeyboardState',()=>setTimeout(updateMarkdownToolbarVisibility,20));
  document.addEventListener('visibilitychange',updateMarkdownToolbarVisibility);
})();