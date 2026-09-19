let caretMirror=null;
let caretMarker=null;
let caretFrame=0;

function ensureCaretMirror(){
  if(caretMirror)return caretMirror;
  caretMirror=document.createElement('div');
  caretMirror.setAttribute('aria-hidden','true');
  caretMirror.style.position='fixed';
  caretMirror.style.left='-100000px';
  caretMirror.style.top='0';
  caretMirror.style.visibility='hidden';
  caretMirror.style.pointerEvents='none';
  caretMirror.style.whiteSpace='pre-wrap';
  caretMirror.style.wordWrap='break-word';
  caretMirror.style.overflowWrap='break-word';
  caretMirror.style.boxSizing='border-box';
  caretMirror.style.minHeight='0';
  caretMirror.style.overflow='hidden';
  caretMarker=document.createElement('span');
  caretMarker.textContent='\u200b';
  document.body.appendChild(caretMirror);
  return caretMirror;
}

function syncCaretMirror(){
  const mirror=ensureCaretMirror();
  const cs=getComputedStyle(editor);
  const props=[
    'fontFamily','fontSize','fontWeight','fontStyle','fontVariant',
    'letterSpacing','wordSpacing','textTransform','textIndent',
    'lineHeight','paddingTop','paddingRight','paddingBottom','paddingLeft',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'
  ];
  for(const prop of props)mirror.style[prop]=cs[prop];
  mirror.style.width=editor.clientWidth+'px';
  mirror.textContent=editor.value.slice(0,editor.selectionEnd);
  if(editor.selectionEnd>0&&editor.value.charAt(editor.selectionEnd-1)==='\n'){
    mirror.appendChild(document.createTextNode('\u200b'));
  }
  mirror.appendChild(caretMarker);
}

function ensureCaretVisible(force=false){
  if(document.activeElement!==editor)return;
  if(window.__keyboardOpen!==true&&!force)return;
  if(editor.selectionStart!==editor.selectionEnd)return;
  if(editor.clientHeight<120)return;

  syncCaretMirror();

  const caretTop=caretMarker.offsetTop;
  const visibleTop=caretTop-editor.scrollTop;
  const lineHeight=parseFloat(getComputedStyle(editor).lineHeight)||28;
  const topGuard=Math.max(88,editor.clientHeight*0.22);
  const bottomGuard=editor.clientHeight-Math.max(86,lineHeight*2.8);

  if(visibleTop<topGuard||visibleTop>bottomGuard||force){
    const target=Math.max(topGuard,Math.min(bottomGuard,editor.clientHeight*0.46));
    const maxScroll=Math.max(0,editor.scrollHeight-editor.clientHeight);
    const next=Math.max(0,Math.min(maxScroll,caretTop-target));
    if(Math.abs(editor.scrollTop-next)>2)editor.scrollTop=next;
  }
}

function scheduleCaretFocus(force=false,delay=0){
  clearTimeout(scheduleCaretFocus.timer);
  scheduleCaretFocus.timer=setTimeout(()=>{
    cancelAnimationFrame(caretFrame);
    caretFrame=requestAnimationFrame(()=>ensureCaretVisible(force));
  },delay);
}

editor.addEventListener('input',()=>scheduleCaretFocus(false,0));
editor.addEventListener('keyup',event=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key)){
    scheduleCaretFocus(false,0);
  }
});
editor.addEventListener('click',()=>scheduleCaretFocus(false,0));
editor.addEventListener('focus',()=>{
  scheduleCaretFocus(false,120);
  scheduleCaretFocus(false,280);
});
document.addEventListener('selectionchange',()=>{
  if(document.activeElement===editor)scheduleCaretFocus(false,0);
});
window.addEventListener('dzenKeyboardInset',event=>{
  if(Number(event.detail)>=100){
    scheduleCaretFocus(true,80);
    scheduleCaretFocus(true,220);
  }
});
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',()=>scheduleCaretFocus(false,80));
}
