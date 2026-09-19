let keyboardBaselineHeight=(window.visualViewport&&window.visualViewport.height)||window.innerHeight||document.documentElement.clientHeight||0;
let nativeKeyboardOpen=false;
let fallbackKeyboardOpen=false;
window.__keyboardOpen=false;

function applyKeyboardState(){
  const next=nativeKeyboardOpen||fallbackKeyboardOpen;
  if(next===window.__keyboardOpen)return;
  window.__keyboardOpen=next;
  window.dispatchEvent(new CustomEvent('dzenKeyboardState',{detail:{open:next}}));
}

function updateFallbackKeyboardState(){
  const vv=window.visualViewport;
  const current=Math.round((vv&&vv.height)||window.innerHeight||document.documentElement.clientHeight||0);
  if(current>keyboardBaselineHeight)keyboardBaselineHeight=current;
  const delta=Math.max(0,Math.round(keyboardBaselineHeight-current));
  fallbackKeyboardOpen=delta>=100;
  applyKeyboardState();
}

window.onNativeKeyboardInset=function(_inset,open){
  nativeKeyboardOpen=!!open;
  if(!nativeKeyboardOpen)fallbackKeyboardOpen=false;
  applyKeyboardState();
  if(!nativeKeyboardOpen)setTimeout(updateFallbackKeyboardState,40);
};

if(window.visualViewport){
  window.visualViewport.addEventListener('resize',updateFallbackKeyboardState);
}
window.addEventListener('resize',updateFallbackKeyboardState);
window.addEventListener('orientationchange',function(){
  setTimeout(function(){
    const current=(window.visualViewport&&window.visualViewport.height)||window.innerHeight||document.documentElement.clientHeight||0;
    if(!window.__keyboardOpen)keyboardBaselineHeight=current;
    updateFallbackKeyboardState();
  },350);
});
setTimeout(updateFallbackKeyboardState,0);
const editor=document.getElementById('editor'), preview=document.getElementById('preview'), htmlCode=document.getElementById('htmlCode');
const exampleRiskWords='VPN\nВПН\nобход\nобход блокировок\nразблокировка\nпрокси\nанонимайзер';
const defaultSettings={font:'serif',size:19,line:1.7,theme:'system',paper:'gray',accent:'#D65C43',backgroundVeil:0.6,backgroundText:'dark',customBackgroundId:'',wpm:200,tts:1.0,autosave:true,showCode:false,markdownToolbar:true,headingCheck:true,headingMin:8,headingMax:80,sentenceCheck:true,sentenceMax:30,paragraphCheck:true,paragraphMax:650,frequentCheck:true,frequentMin:8,nearbyCheck:true,structureCheck:true,structureMax:1800,phraseCheck:true,openingCheck:true,headingStructureCheck:true,markdownCheck:true,aiStyleCheck:true,proofCheck:true,onlineSpelling:false,dzenCheck:true,dzenSmartRules:true,riskCheck:true,riskWords:exampleRiskWords};
let settings={...defaultSettings}; let speaking=false; let saveTimer=null; let currentAnalysis={issues:[],warningCount:0,metrics:{}};
let onlineSpellIssues=[],onlineSpellSource='',spellStatus='idle',spellRequestId='',spellNavState=null,inputWasPaste=false;
const USER_SYNONYMS_KEY='dzenUserSynonymsV1';
let userSynonyms={};
const SPELL_IGNORE_KEY='dzenSpellIgnoreV1';
let spellIgnoreWords=new Set();
function spellKey(word){return String(word||'').trim().toLocaleLowerCase('ru-RU')}
function loadSpellIgnoreWords(){try{const a=JSON.parse(localStorage.getItem(SPELL_IGNORE_KEY)||'[]');return new Set(Array.isArray(a)?a.map(spellKey).filter(Boolean):[])}catch(e){return new Set()}}
function saveSpellIgnoreWords(){localStorage.setItem(SPELL_IGNORE_KEY,JSON.stringify([...spellIgnoreWords].sort()))}
function updateSpellIgnoreStatus(){const el=document.getElementById('spellIgnoreStatus');if(el)el.innerHTML=`Мои правильные слова: <b>${spellIgnoreWords.size}</b>`}
async function clearSpellIgnoreWords(){if(!spellIgnoreWords.size){toast('Список исключений уже пуст');return}if(!await appConfirm('Очистить исключения?','Все слова, отмеченные как правильные, будут удалены из локального списка.','Очистить',true))return;spellIgnoreWords.clear();saveSpellIgnoreWords();updateSpellIgnoreStatus();clearOnlineSpelling();analyzeText();toast('Исключения орфографии очищены')}

const DZEN_RULES_URL='https://raw.githubusercontent.com/Ayuemin/dzen-text/main/rules/dzen-rules.json';
const DZEN_RULES_KEY='dzenRulesV2';
const DEFAULT_DZEN_RULES={"schema":2,"version":"2026.09.05-bootstrap","source":"https://dzen.ru/help/ru/requirements/rules.html","source_checked":"2026-09-05","source_sha256":"bootstrap-pending-official-refresh","generator":{"provider":"bootstrap","model":"none","prompt_version":2},"privacy":"OpenRouter receives only the official Dzen rules page. User articles are never sent by this updater.","note":"Локальная эвристическая проверка. Совпадение означает возможный риск, а не установленное нарушение.","article_title_max_chars":0,"categories":[{"id":"clickbait","title":"Возможный кликбейт","severity":"warning","scope":"title","phrases":["вы не поверите","ты не поверишь","никто не расскажет","все скрывают","от вас скрывают","шокирующая правда","срочно прочитайте","срочно смотрите","это изменит вашу жизнь"],"stems":["сенсац","шокир"],"action_words":[],"context_words":["секрет","правда","срочно"],"exclude_words":["почему не стоит верить","разбираем кликбейт"],"min_score":1,"explanation":"Проверьте, не обещает ли заголовок больше, чем подтверждает сама статья."},{"id":"dangerous_instructions","title":"Опасное или незаконное действие — проверить контекст","severity":"critical","scope":"all","phrases":["как взломать","как обойти блокировку","как изготовить оружие","как сделать взрывчатку","как купить наркотики"],"stems":["взлом","блокиров","оруж","взрывчат","наркот"],"action_words":["как","инструкция","пошагово","сделать","изготовить","купить","достать","обойти","взломать","настроить"],"context_words":["способ","метод","схема","пошаговый"],"exclude_words":["опасно","не делайте","не следует","запрещено","предупреждение","новость","история","осуждает"],"min_score":2,"explanation":"Тематическое слово само по себе не считается риском: приложение ищет сочетание темы с инструктивной формулировкой."},{"id":"medical_promises","title":"Категоричное медицинское обещание — проверить","severity":"warning","scope":"all","phrases":["гарантированно лечит","гарантированно вылечит","заменяет врача","откажитесь от лекарств","не принимайте лекарства","100% лечение"],"stems":["лечит","вылечит","лекарств","диагноз","врач"],"action_words":["гарантированно","100%","заменяет","откажитесь","не принимайте"],"context_words":["лечение","метод","средство"],"exclude_words":["обратитесь к врачу","по данным","исследование","может","возможно","не является медицинской рекомендацией"],"min_score":2,"explanation":"Особенно внимательно проверяйте гарантии результата и призывы отказаться от профессиональной помощи."},{"id":"profanity","title":"Возможная ненормативная лексика","severity":"critical","scope":"all","phrases":[],"stems":["хуй","пизд","ебан","ёбан","ебат","ёбат","блят","бляд"],"action_words":[],"context_words":[],"exclude_words":[],"min_score":1,"explanation":"Проверьте фрагмент вручную: основы могут встречаться и внутри другого слова."},{"id":"guaranteed_financial_result","title":"Гарантированный финансовый результат — проверить","severity":"warning","scope":"all","phrases":["гарантированный доход","гарантированная прибыль","заработок без риска","100% прибыль"],"stems":["доход","прибыл","заработ"],"action_words":["гарантирован","100%","без риска","точно получите"],"context_words":["деньги","инвести","влож"],"exclude_words":["риск","не гарантируется","можно потерять","пример","история"],"min_score":2,"explanation":"Проверьте, не выглядит ли формулировка как безусловное обещание финансового результата."}],"manual_checks":["Достоверность фактических утверждений требует внешних источников и не устанавливается локально.","Заимствованный или дублированный контент нельзя надежно определить без сравнения с внешними публикациями.","Авторские права на текст, изображения и видео автоматически не определяются.","Полное соответствие заголовка содержанию требует смысловой оценки человеком.","Чувствительные темы и спорный контекст требуют ручной проверки даже при отсутствии локальных срабатываний."]};
let dzenRulesFromCache=false;
let dzenRules=DEFAULT_DZEN_RULES;
function validDzenRules(o){const s=Number(o&&o.schema);if(!o||!Array.isArray(o.manual_checks))return false;if(s===2)return Array.isArray(o.categories)&&o.categories.length>=3;if(s===1)return Array.isArray(o.clickbait_phrases);return false}
function activeDzenRules(){return settings&&settings.dzenSmartRules===false?DEFAULT_DZEN_RULES:dzenRules}
function loadDzenRules(){try{const raw=localStorage.getItem(DZEN_RULES_KEY);if(raw){const o=JSON.parse(raw);if(validDzenRules(o)){dzenRulesFromCache=true;return o}}}catch(e){}return DEFAULT_DZEN_RULES}
function updateDzenRulesStatus(){const el=document.getElementById('dzenRulesStatus');if(!el)return;const enabled=settings.dzenSmartRules!==false,r=activeDzenRules(),g=r.generator||{},model=g.model&&g.model!=='none'?` · ИИ: ${escapeHtml(String(g.model))}`:'';el.innerHTML=`Умная база: <b>${enabled?'включена':'выключена'}</b><br>Версия: <b>${escapeHtml(String(r.version||'встроенная'))}</b> · ${enabled&&dzenRulesFromCache?'обновлённая':'встроенная'}<br>Источник: официальная справка Дзена · проверен ${escapeHtml(String(r.source_checked||'—'))}${model}`}
async function updateDzenRulesFromGitHub(){if(settings.dzenSmartRules===false){updateDzenRulesStatus();toast('Обновляемая ИИ-база отключена в настройках');return}const el=document.getElementById('dzenRulesStatus');if(el)el.textContent='Проверяю обновление умной базы…';try{const r=await fetch(DZEN_RULES_URL+'?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const o=await r.json();if(!validDzenRules(o))throw new Error('Некорректный формат');localStorage.setItem(DZEN_RULES_KEY,JSON.stringify(o));dzenRules=o;dzenRulesFromCache=true;updateDzenRulesStatus();render();toast(`База правил Дзена обновлена: ${o.version||'новая версия'}`)}catch(e){updateDzenRulesStatus();toast('Не удалось обновить базу. Встроенная версия продолжает работать')}}
function resetDzenRules(){localStorage.removeItem(DZEN_RULES_KEY);dzenRules=DEFAULT_DZEN_RULES;dzenRulesFromCache=false;updateDzenRulesStatus();render();toast('Восстановлена встроенная база правил Дзена')}
