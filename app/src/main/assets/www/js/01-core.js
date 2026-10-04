let keyboardBaselineHeight=(window.visualViewport&&window.visualViewport.height)||window.innerHeight||document.documentElement.clientHeight||0;
let layoutBaselineHeight=window.innerHeight||document.documentElement.clientHeight||keyboardBaselineHeight;
let nativeKeyboardOpen=false;
let fallbackKeyboardOpen=false;
let nativeKeyboardInsetCss=0;
let fallbackKeyboardInsetCss=0;
window.__keyboardOpen=false;

function syncKeyboardAvoidance(){
  const currentLayout=Math.round(window.innerHeight||document.documentElement.clientHeight||layoutBaselineHeight||0);
  if(!nativeKeyboardOpen&&!fallbackKeyboardOpen&&currentLayout>0){
    layoutBaselineHeight=Math.max(layoutBaselineHeight,currentLayout);
  }
  const layoutShrink=Math.max(0,Math.round(layoutBaselineHeight-currentLayout));
  const reported=nativeKeyboardOpen?nativeKeyboardInsetCss:fallbackKeyboardInsetCss;
  // Android 15 may leave WebView full-height and place the IME over it. If
  // adjustResize already consumed part/all of the IME, subtract that layout
  // shrink so we never add the keyboard height twice.
  const avoidance=Math.max(0,Math.round(reported-layoutShrink));
  document.documentElement.style.setProperty('--keyboardInset',avoidance+'px');
  if(document.body)document.body.classList.toggle('keyboard-open',nativeKeyboardOpen||fallbackKeyboardOpen);
}

function applyKeyboardState(){
  const next=nativeKeyboardOpen||fallbackKeyboardOpen;
  syncKeyboardAvoidance();
  if(next===window.__keyboardOpen)return;
  window.__keyboardOpen=next;
  window.dispatchEvent(new CustomEvent('editorKeyboardState',{detail:{open:next}}));
}

function updateFallbackKeyboardState(){
  const vv=window.visualViewport;
  const current=Math.round((vv&&vv.height)||window.innerHeight||document.documentElement.clientHeight||0);
  if(!window.__keyboardOpen&&current>keyboardBaselineHeight)keyboardBaselineHeight=current;
  const delta=Math.max(0,Math.round(keyboardBaselineHeight-current));
  fallbackKeyboardInsetCss=delta;
  fallbackKeyboardOpen=delta>=100;
  applyKeyboardState();
}

window.onNativeKeyboardInset=function(inset,open){
  nativeKeyboardOpen=!!open;
  const scale=Math.max(1,Number(window.devicePixelRatio)||1);
  nativeKeyboardInsetCss=nativeKeyboardOpen?Math.max(0,Math.round((Number(inset)||0)/scale)):0;
  if(!nativeKeyboardOpen)fallbackKeyboardOpen=false;
  applyKeyboardState();
  if(!nativeKeyboardOpen)setTimeout(updateFallbackKeyboardState,40);
};

if(window.visualViewport){
  window.visualViewport.addEventListener('resize',updateFallbackKeyboardState);
  window.visualViewport.addEventListener('scroll',syncKeyboardAvoidance);
}
window.addEventListener('resize',updateFallbackKeyboardState);
window.addEventListener('orientationchange',function(){
  setTimeout(function(){
    const current=(window.visualViewport&&window.visualViewport.height)||window.innerHeight||document.documentElement.clientHeight||0;
    const currentLayout=window.innerHeight||document.documentElement.clientHeight||0;
    if(!window.__keyboardOpen){
      keyboardBaselineHeight=current;
      if(currentLayout)layoutBaselineHeight=currentLayout;
    }
    updateFallbackKeyboardState();
  },350);
});
setTimeout(updateFallbackKeyboardState,0);

let sheetFocusRevealTimer=null;
function keepFocusedSheetFieldVisible(){
  clearTimeout(sheetFocusRevealTimer);
  sheetFocusRevealTimer=setTimeout(function(){
    const active=document.activeElement;
    if(!active||active===document.body||active===editor)return;
    const sheet=active.closest&&active.closest('.sheet');
    if(!sheet||!sheet.parentElement||!sheet.parentElement.classList.contains('open'))return;
    try{active.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'})}catch(e){
      try{active.scrollIntoView(false)}catch(_e){}
    }
  },90);
}
document.addEventListener('focusin',function(event){
  if(event.target&&event.target.closest&&event.target.closest('.sheet'))keepFocusedSheetFieldVisible();
});
window.addEventListener('editorKeyboardState',function(event){
  if(event.detail&&event.detail.open)keepFocusedSheetFieldVisible();
});

const editor=document.getElementById('editor'), preview=document.getElementById('preview'), htmlCode=document.getElementById('htmlCode');
const exampleRiskWords='VPN\nВПН\nобход\nобход блокировок\nразблокировка\nпрокси\nанонимайзер';
const defaultSettings={font:'serif',size:19,line:1.7,theme:'system',paper:'gray',accent:'#D65C43',backgroundVeil:0.6,backgroundText:'dark',customBackgroundId:'',wpm:200,tts:1.0,autosave:true,showCode:false,headingCheck:true,headingMin:8,headingMax:80,sentenceCheck:true,sentenceMax:30,paragraphCheck:true,paragraphMax:650,frequentCheck:true,frequentMin:8,nearbyCheck:true,structureCheck:true,structureMax:1800,phraseCheck:true,openingCheck:true,headingStructureCheck:true,markdownCheck:true,proofCheck:true,riskCheck:true,riskWords:exampleRiskWords,documentProfile:'article',articleTitleMode:'auto'};
let settings={...defaultSettings}; let speaking=false; let saveTimer=null; let currentAnalysis={issues:[],warningCount:0,metrics:{}};
let inputWasPaste=false;
const USER_SYNONYMS_KEY='editorUserSynonymsV1';
let userSynonyms={};

// Optional P1 analyzers are loaded after all parser-included editor scripts have
// evaluated. This keeps 12-bootstrap.js the final static script while allowing
// context-aware modules to override legacy functions only after those functions
// exist. If a module fails to load, the editor remains usable with the baseline
// deterministic checks instead of blocking startup.
function loadDeferredEditorModule(src,id){
  const load=function(){
    if(id&&document.getElementById(id))return;
    const script=document.createElement('script');
    if(id)script.id=id;
    script.src=src;
    script.async=false;
    script.onerror=function(){try{console.error('Deferred editor module failed:',src)}catch(e){}};
    document.head.appendChild(script);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});
  else load();
}
loadDeferredEditorModule('js/16-proof-context.js','proofContextModuleV2');
loadDeferredEditorModule('js/17-rule-pack-p1.js','rulePackP1Module');
loadDeferredEditorModule('js/18-structure-p1.js','structureP1Module');
loadDeferredEditorModule('js/19-spelling-hunspell.js','spellingHunspellModule');
loadDeferredEditorModule('js/20-spelling-dictionary.js','spellingDictionaryModule');
