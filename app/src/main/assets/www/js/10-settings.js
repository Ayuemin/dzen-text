function openSettings(){document.querySelectorAll('#settingsBackdrop details').forEach(d=>d.open=false);syncSettingsUI();updateDictStatus();updateDzenRulesStatus();document.getElementById('settingsBackdrop').classList.add('open');setTimeout(updateDictStatus,120)}
function closeSettings(){document.getElementById('settingsBackdrop').classList.remove('open')}
function backdropClick(e){if(e.target.id==='settingsBackdrop')closeSettings()}
let cachedCustomBackground='';
let cachedCustomFontData='';
let cachedCustomFontName='';
function normalizeAccentHex(v){v=String(v||'').trim().toUpperCase();if(!v.startsWith('#'))v='#'+v;return /^#[0-9A-F]{6}$/.test(v)?v:'#D65C43'}
function readCustomBackground(){if(cachedCustomBackground)return cachedCustomBackground;try{if(window.AndroidFile&&typeof AndroidFile.backgroundData==='function')cachedCustomBackground=AndroidFile.backgroundData()||''}catch(e){}return cachedCustomBackground}
function chooseBackground(){if(window.AndroidFile&&typeof AndroidFile.pickBackground==='function'){AndroidFile.pickBackground();return}toast('Выбор собственного фона доступен в установленном приложении')}
function clearCustomBackground(){try{if(window.AndroidFile&&typeof AndroidFile.clearBackground==='function')AndroidFile.clearBackground()}catch(e){}cachedCustomBackground='';settings.paper='gray';localStorage.setItem('dzenSettings',JSON.stringify(settings));syncSettingsUI();applyVisualSettings();toast('Свой фон удалён')}
window.onNativeBackgroundChanged=()=>{cachedCustomBackground='';settings.paper='custom';localStorage.setItem('dzenSettings',JSON.stringify(settings));syncSettingsUI();applyVisualSettings();toast('Фон обновлён')};
function readCustomFontData(){if(cachedCustomFontData)return cachedCustomFontData;try{if(window.AndroidFile&&typeof AndroidFile.fontData==='function')cachedCustomFontData=AndroidFile.fontData()||''}catch(e){}return cachedCustomFontData}
function readCustomFontName(){if(cachedCustomFontName)return cachedCustomFontName;try{if(window.AndroidFile&&typeof AndroidFile.fontName==='function')cachedCustomFontName=AndroidFile.fontName()||''}catch(e){}return cachedCustomFontName}
function ensureCustomFontFace(){
  const data=readCustomFontData();
  let style=document.getElementById('customEditorFontStyle');
  if(!data){
    if(style)style.remove();
    return false;
  }
  if(!style){
    style=document.createElement('style');
    style.id='customEditorFontStyle';
    document.head.appendChild(style);
  }
  style.textContent="@font-face{font-family:'DzenUserFont';src:url('"+data+"');font-display:swap}";
  return true;
}
function updateCustomFontStatus(){
  const el=document.getElementById('customFontStatus');
  if(!el)return;
  const name=readCustomFontName();
  el.innerHTML=name?'Подключён: <b>'+escapeHtml(name)+'</b>':'Свой шрифт не подключён';
}
function chooseEditorFont(){if(window.AndroidFile&&typeof AndroidFile.pickFont==='function'){AndroidFile.pickFont();return}toast('Добавление своего шрифта доступно в установленном приложении')}
function onFontSelectChanged(){
  if(fontSelect.value==='custom'&&!readCustomFontName()){
    fontSelect.value=settings.font==='custom'?'serif':settings.font;
    chooseEditorFont();
    return;
  }
  applySettings();
}
function clearEditorFont(){try{if(window.AndroidFile&&typeof AndroidFile.clearFont==='function')AndroidFile.clearFont()}catch(e){}cachedCustomFontData='';cachedCustomFontName='';const style=document.getElementById('customEditorFontStyle');if(style)style.remove();if(settings.font==='custom')settings.font='serif';localStorage.setItem('dzenSettings',JSON.stringify(settings));syncSettingsUI();applyVisualSettings();toast('Свой шрифт удалён')}
window.onNativeFontChanged=(name)=>{cachedCustomFontData='';cachedCustomFontName=String(name||'');if(name){settings.font='custom';localStorage.setItem('dzenSettings',JSON.stringify(settings));}else if(settings.font==='custom'){settings.font='serif';localStorage.setItem('dzenSettings',JSON.stringify(settings));}syncSettingsUI();applyVisualSettings();updateCustomFontStatus();toast(name?'Шрифт подключён':'Свой шрифт удалён')};
window.onNativeFontError=(msg)=>toast(msg||'Не удалось подключить шрифт');
function syncSettingsUI(){paperSelect.value=settings.paper||'gray';backgroundVeil.value=Number(settings.backgroundVeil??0.6);backgroundTextSelect.value=settings.backgroundText||'dark';accentHex.value=normalizeAccentHex(settings.accent);fontSelect.value=settings.font;sizeRange.value=settings.size;lineRange.value=settings.line;themeSelect.value=settings.theme;wpmRange.value=settings.wpm;ttsRange.value=settings.tts;autosaveSwitch.checked=settings.autosave;codeSwitch.checked=settings.showCode;markdownToolbarSwitch.checked=settings.markdownToolbar!==false;proofCheck.checked=settings.proofCheck;onlineSpelling.checked=settings.onlineSpelling;headingCheck.checked=settings.headingCheck;headingMin.value=settings.headingMin;headingMax.value=settings.headingMax;sentenceCheck.checked=settings.sentenceCheck;sentenceMax.value=settings.sentenceMax;paragraphCheck.checked=settings.paragraphCheck;paragraphMax.value=settings.paragraphMax;frequentCheck.checked=settings.frequentCheck;frequentMin.value=settings.frequentMin;nearbyCheck.checked=settings.nearbyCheck;structureCheck.checked=settings.structureCheck;structureMax.value=settings.structureMax;phraseCheck.checked=settings.phraseCheck;openingCheck.checked=settings.openingCheck;headingStructureCheck.checked=settings.headingStructureCheck;markdownCheck.checked=settings.markdownCheck;aiStyleCheck.checked=settings.aiStyleCheck!==false;dzenCheck.checked=settings.dzenCheck;dzenSmartRules.checked=settings.dzenSmartRules!==false;riskCheck.checked=settings.riskCheck;riskWords.value=settings.riskWords||'';updateCustomFontStatus();updateSettingLabels();updateDzenRulesStatus();updateSpellIgnoreStatus()}
async function applySettings(){
  let wantsOnline=onlineSpelling.checked;
  if(wantsOnline&&!settings.onlineSpelling){
    const ok=await appConfirm(
      'Включить онлайн-проверку?',
      'Текст будет отправляться в Яндекс.Спеллер только после нажатия кнопки проверки. При наборе и вставке ничего не отправляется.',
      'Включить',
      false
    );
    if(!ok){
      wantsOnline=false;
      onlineSpelling.checked=false;
    }
  }

  settings={
    ...settings,
    paper:paperSelect.value,
    accent:normalizeAccentHex(accentHex.value),
    backgroundVeil:+backgroundVeil.value,
    backgroundText:backgroundTextSelect.value,
    font:fontSelect.value,
    size:+sizeRange.value,
    line:+lineRange.value,
    theme:themeSelect.value,
    wpm:+wpmRange.value,
    tts:+ttsRange.value,
    autosave:autosaveSwitch.checked,
    showCode:codeSwitch.checked,
    markdownToolbar:markdownToolbarSwitch.checked,
    proofCheck:proofCheck.checked,
    onlineSpelling:wantsOnline,
    headingCheck:headingCheck.checked,
    headingMin:+headingMin.value,
    headingMax:+headingMax.value,
    sentenceCheck:sentenceCheck.checked,
    sentenceMax:+sentenceMax.value,
    paragraphCheck:paragraphCheck.checked,
    paragraphMax:+paragraphMax.value,
    frequentCheck:frequentCheck.checked,
    frequentMin:+frequentMin.value,
    nearbyCheck:nearbyCheck.checked,
    structureCheck:structureCheck.checked,
    structureMax:+structureMax.value,
    phraseCheck:phraseCheck.checked,
    openingCheck:openingCheck.checked,
    headingStructureCheck:headingStructureCheck.checked,
    markdownCheck:markdownCheck.checked,
    aiStyleCheck:aiStyleCheck.checked,
    dzenCheck:dzenCheck.checked,
    dzenSmartRules:dzenSmartRules.checked,
    riskCheck:riskCheck.checked,
    riskWords:riskWords.value
  };
  if(settings.headingMin>=settings.headingMax)settings.headingMin=Math.max(3,settings.headingMax-5);
  localStorage.setItem('dzenSettings',JSON.stringify(settings));
  applyVisualSettings();
  render(false,document.getElementById('previewPane').classList.contains('active'));
  updateSettingLabels();
  if(typeof updateMarkdownToolbarVisibility==='function')updateMarkdownToolbarVisibility();
}
function updateSettingLabels(){backgroundVeilVal.textContent=Math.round(Number(settings.backgroundVeil||0)*100)+'%';const sw=document.getElementById('accentPreview');if(sw)sw.style.background=normalizeAccentHex(settings.accent);const names={system:'Системный',serif:'Книжный',classic:'Классический',sans:'Нейтральный',mono:'Моно',custom:'Свой'};fontVal.textContent=names[settings.font];sizeVal.textContent=settings.size+' px';lineVal.textContent=Number(settings.line).toFixed(2);wpmVal.textContent=settings.wpm+' слов/мин';ttsVal.textContent=Number(settings.tts).toFixed(2)+'×';headingVal.textContent=`${settings.headingMin}–${settings.headingMax} знаков`;sentenceVal.textContent=`>${settings.sentenceMax} слов`;paragraphVal.textContent=`>${settings.paragraphMax} знаков`;frequentVal.textContent=`${settings.frequentMin}+`;structureVal.textContent=`>${settings.structureMax} знаков`}
function resetRiskWords(){riskWords.value=exampleRiskWords;applySettings();toast('Пример списка восстановлен')}
function clearRiskWords(){riskWords.value='';applySettings();toast('Список очищен')}
function applyVisualSettings(){
 const fonts={system:'system-ui,-apple-system,"Segoe UI",sans-serif',serif:'"Noto Serif","Droid Serif",serif',classic:'Georgia,"Times New Roman",serif',sans:'Arial,"Segoe UI",sans-serif',mono:'ui-monospace,Consolas,monospace',custom:"'DzenUserFont',serif"};
 if(settings.font==='custom')ensureCustomFontFace();
 const root=document.documentElement,accent=normalizeAccentHex(settings.accent);
 root.dataset.theme=settings.theme;root.dataset.paper=settings.paper||'gray';
 root.style.setProperty('--accent',accent);root.style.setProperty('--editorFont',fonts[settings.font]||fonts.serif);
 root.style.setProperty('--fontSize',settings.size+'px');root.style.setProperty('--lineHeight',settings.line);
 if((settings.paper||'gray')==='custom'){
   const data=readCustomBackground();
   if(data)root.style.setProperty('--custom-paper-image','url("'+data+'")');else root.style.removeProperty('--custom-paper-image');
   const a=Math.max(0,Math.min(.9,Number(settings.backgroundVeil??.6)));
   const light=settings.backgroundText==='light';
   root.style.setProperty('--paper-veil',light?'rgba(0,0,0,'+a+')':'rgba(255,255,255,'+a+')');
   root.style.setProperty('--paper-text',light?'#F4F3EE':'#20211F');
   root.style.setProperty('--paper-muted',light?'#C8C7C1':'#666963');
 }else{
   root.style.removeProperty('--custom-paper-image');root.style.removeProperty('--paper-veil');root.style.removeProperty('--paper-text');root.style.removeProperty('--paper-muted')
 }
}
let toastTimer;function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2300)}
