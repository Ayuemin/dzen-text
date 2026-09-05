from pathlib import Path


def rep(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Patch marker not found: {label}")
    return text.replace(old, new, 1)

# Version bump.
gradle_path = Path('app/build.gradle')
gradle = gradle_path.read_text(encoding='utf-8')
gradle = rep(gradle, 'versionCode 22', 'versionCode 23', 'versionCode')
gradle = rep(gradle, "versionName '1.5.1'", "versionName '1.5.2'", 'versionName')
gradle_path.write_text(gradle, encoding='utf-8')

html_path = Path('app/src/main/assets/www/index.html')
html = html_path.read_text(encoding='utf-8')
html = rep(html, '<title>Дзен Текст 1.5.1</title>', '<title>Дзен Текст 1.5.2</title>', 'html title')

old_jump = r'''function jumpTo(start,end,quiet=false){document.getElementById('analysisBackdrop').classList.remove('open');showPane('edit');setTimeout(()=>{editor.focus();editor.setSelectionRange(Math.max(0,start),Math.max(start,end));const maxScroll=Math.max(0,editor.scrollHeight-editor.clientHeight);const ratio=editor.value.length?start/editor.value.length:0;editor.scrollTop=Math.max(0,Math.min(maxScroll,maxScroll*ratio-editor.clientHeight*.28));if(!quiet){const h=document.getElementById('highlightHint');h.classList.add('show');setTimeout(()=>h.classList.remove('show'),1200)}},70)}'''

new_jump = r'''function activeCorrectionPanel(){for(const id of ['replacePanel','nearbyPanel','repeatNavPanel','spellPanel']){const el=document.getElementById(id);if(el&&el.classList.contains('open'))return el}return null}
function textareaCaretContentTop(pos){const cs=getComputedStyle(editor),mirror=document.createElement('div');mirror.style.position='fixed';mirror.style.left='-10000px';mirror.style.top='0';mirror.style.visibility='hidden';mirror.style.pointerEvents='none';mirror.style.whiteSpace='pre-wrap';mirror.style.overflowWrap='break-word';mirror.style.wordBreak=cs.wordBreak||'normal';mirror.style.boxSizing=cs.boxSizing;mirror.style.width=editor.offsetWidth+'px';mirror.style.padding=cs.padding;mirror.style.border=cs.border;mirror.style.fontFamily=cs.fontFamily;mirror.style.fontSize=cs.fontSize;mirror.style.fontWeight=cs.fontWeight;mirror.style.fontStyle=cs.fontStyle;mirror.style.letterSpacing=cs.letterSpacing;mirror.style.lineHeight=cs.lineHeight;mirror.style.tabSize=cs.tabSize||'8';mirror.textContent=editor.value.slice(0,Math.max(0,pos));const marker=document.createElement('span');marker.textContent='\u200b';mirror.appendChild(marker);document.body.appendChild(mirror);const top=marker.offsetTop;mirror.remove();return top}
function ensureSelectionVisible(start,end){if(!editor||!editor.offsetWidth)return;const er=editor.getBoundingClientRect();if(!er.height)return;const vv=window.visualViewport;const viewportTop=vv?vv.offsetTop:0,viewportBottom=vv?vv.offsetTop+vv.height:window.innerHeight;let visibleTop=Math.max(er.top,viewportTop)+12,visibleBottom=Math.min(er.bottom,viewportBottom)-12;const panel=activeCorrectionPanel();if(panel){const pr=panel.getBoundingClientRect();if(pr.height&&pr.top>visibleTop)visibleBottom=Math.min(visibleBottom,pr.top-12)}if(visibleBottom-visibleTop<80)return;const contentTop=textareaCaretContentTop(start),targetY=visibleTop+(visibleBottom-visibleTop)*0.43,maxScroll=Math.max(0,editor.scrollHeight-editor.clientHeight),desired=contentTop-(targetY-er.top);editor.scrollTop=Math.max(0,Math.min(maxScroll,desired))}
let selectionVisibilityTimer=null;function scheduleSelectionVisibility(delay=40){if(!activeCorrectionPanel())return;clearTimeout(selectionVisibilityTimer);selectionVisibilityTimer=setTimeout(()=>ensureSelectionVisible(editor.selectionStart,editor.selectionEnd),delay)}
if(window.visualViewport){window.visualViewport.addEventListener('resize',()=>scheduleSelectionVisibility(55));window.visualViewport.addEventListener('scroll',()=>scheduleSelectionVisibility(55))}window.addEventListener('resize',()=>scheduleSelectionVisibility(55));
function jumpTo(start,end,quiet=false){document.getElementById('analysisBackdrop').classList.remove('open');showPane('edit');setTimeout(()=>{const s=Math.max(0,start),e=Math.max(s,end);editor.focus();editor.setSelectionRange(s,e);ensureSelectionVisible(s,e);setTimeout(()=>ensureSelectionVisible(s,e),140);setTimeout(()=>ensureSelectionVisible(s,e),320);if(!quiet){const h=document.getElementById('highlightHint');h.classList.add('show');setTimeout(()=>h.classList.remove('show'),1200)}},70)}'''

html = rep(html, old_jump, new_jump, 'jumpTo real-position scrolling')
html_path.write_text(html, encoding='utf-8')

# Keep README current.
readme_path = Path('README.md')
readme = readme_path.read_text(encoding='utf-8')
readme = rep(readme, 'Текущая версия: **v1.5.1**.', 'Текущая версия: **v1.5.2**.', 'README version')
needle = '- панели замены, повторов и исправлений автоматически поднимаются над экранной клавиатурой;\n- подсчёт знаков, слов и примерного времени чтения.'
replacement = '- панели замены, повторов и исправлений автоматически поднимаются над экранной клавиатурой;\n- при переходе к ошибке или совпадению редактор автоматически прокручивает выделенный фрагмент в свободную видимую область над панелью;\n- подсчёт знаков, слов и примерного времени чтения.'
readme = rep(readme, needle, replacement, 'README selection visibility')
readme_path.write_text(readme, encoding='utf-8')
