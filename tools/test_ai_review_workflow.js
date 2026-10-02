/** Regression coverage for the unified local + AI review workflow. */
'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');

const workflow=fs.readFileSync(path.join(__dirname,'..','app','src','main','assets','www','js','12-workflow-policy.js'),'utf8');
const elements={};
function makeEl(){
  const classes=new Set();
  const el={hidden:false,disabled:false,value:'',textContent:'',innerHTML:'',style:{},parentElement:null,
    classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,v)=>v?classes.add(x):classes.delete(x)},
    setAttribute(){},addEventListener(){},appendChild(){},insertBefore(){},closest(){return null},querySelector(){return makeEl()},querySelectorAll(){return []},focus(){},blur(){}};
  return el;
}
const document={
  head:makeEl(),body:makeEl(),documentElement:makeEl(),activeElement:null,
  getElementById(id){return elements[id]||(elements[id]=makeEl())},
  createElement(){return makeEl()},querySelector(){return null},querySelectorAll(){return []}
};
const localStorage={_v:{},getItem(k){return Object.prototype.hasOwnProperty.call(this._v,k)?this._v[k]:null},setItem(k,v){this._v[k]=String(v)},removeItem(k){delete this._v[k]}};
let localIssues=[];
let chatResponder=()=>JSON.stringify({dzen_issues:[],quality_issues:[],style_issues:[]});
let chatCalls=[];
let crawlCalls=0;
let protectiveVersions=0;
let historyPoints=0;
let toasts=[];

const sandbox={console,JSON,Math,Date,Promise,Map,Set,WeakMap,RegExp,String,Number,Object,Array,URL,setTimeout,clearTimeout,
  window:{handleNativeBack:()=>false},document,localStorage,DZEN_AI_KNOWLEDGE_KEY:'dzenAiKnowledgeV1',
  settings:{onlineSpelling:false,riskCheck:false,dzenSmartRules:false,dzenAiBaseUrl:'https://api.test/v1',dzenAiModel:'test/model',dzenAiSources:'https://dzen.ru/help/ru/rules',dzenAiStylePrompt:''},
  editor:{value:'',selectionStart:0,selectionEnd:0,blur(){},focus(){}},
  currentAnalysis:{issues:[],overflowTotal:0},analysisMode:'problems',
  aiDzenIssues:[],aiDzenSource:'',aiDzenBusy:false,dzenAiLiveCrawl:null,
  aiDzenRun:{state:'idle',message:'',calls:0,raw:0,accepted:0,rejected:0,model:'',startedAt:0,finishedAt:0},
  onlineSpellIssues:[],onlineSpellSource:'',spellStatus:'off',spellRequestId:'',spellNavState:null,
  replacementState:null,
  persistSettings:()=>true,escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),toast:s=>toasts.push(String(s)),
  clearAiDzenIssues(state='idle',message=''){sandbox.aiDzenIssues=[];sandbox.aiDzenSource='';sandbox.setAiDzenRunState(state,{message})},
  aiIssueFromItem(item,type,chunk){const q=String(item&&item.quote||'');const at=chunk.text.indexOf(q);if(at<0)return null;return {type,title:item.title||'AI',detail:item.reason||'',start:chunk.start+at,end:chunk.start+at+q.length,severity:item.severity||'warning',ai:true}},
  analyzeText(){sandbox.currentAnalysis={issues:[...localIssues,...sandbox.aiDzenIssues],overflowTotal:0};return sandbox.currentAnalysis},
  renderAnalysis(){},issueGroups(){return [{id:'proof',name:'Опечатки'},{id:'dzen',name:'Дзен'},{id:'frequent',name:'Частые слова'}]},openSettings(){},renderReplacement(){},
  setAiDzenRunState(state,extra={}){sandbox.aiDzenRun={state,message:String(extra.message||''),calls:Number(extra.calls||0),raw:Number(extra.raw||0),accepted:Number(extra.accepted||0),rejected:Number(extra.rejected||0),model:String(extra.model||sandbox.settings.dzenAiModel||''),startedAt:Number(extra.startedAt||0),finishedAt:Number(extra.finishedAt||0)}},
  dzenAiBridgeAvailable:()=>true,dzenAiHasKey:()=>true,
  parseDzenAiSources(){return String(sandbox.settings.dzenAiSources||'').split(/\n|,|;/).map(x=>x.trim()).filter(Boolean)},
  canonicalAiSourceUrl(raw){try{const u=new URL(String(raw));u.hash='';u.search='';return u.href}catch(e){return ''}},
  dzenAiSettingsSignature(){return 'legacy'},
  dzenAiKnowledge(){try{const x=JSON.parse(localStorage.getItem('dzenAiKnowledgeV1')||'null');return x&&Array.isArray(x.items)?x:null}catch(e){return null}},
  dzenAiKnowledgeCurrent:()=>false,
  crawlDzenAiSources:async()=>{crawlCalls++;const text='Правило: нельзя обещать гарантированный результат. Исключения описываются отдельно.';return {pages:[{url:'https://dzen.ru/help/ru/rules',title:'Правила',text}],crawl:{discovered:1,processed:1,skipped:0,urls:['https://dzen.ru/help/ru/rules'],failedUrls:[]}}},
  packKnowledgeBatches(pages){return [{text:'=== SOURCE ===\nURL: '+pages[0].url+'\nTITLE: '+pages[0].title+'\nPART: 1\nTEXT:\n'+pages[0].text,count:1}]},
  packKnowledgeItems(items){return items.length?[items]:[[]]},
  parseAiJson:raw=>JSON.parse(String(raw)),
  aiChat:async(system,user)=>{chatCalls.push({system,user});return chatResponder({system,user,call:chatCalls.length})},
  renderDzenAiPageReport(){},
  updateDzenAiStatus(){},clearDzenAiKnowledge(){localStorage.removeItem('dzenAiKnowledgeV1')},
  addSimpleIssue(issues,type,title,detail,start,end,severity='warning'){issues.push({type,title,detail,start,end,severity});return issues[issues.length-1]},
  dzenOccurrences(text,q,max){const out=[];let p=0;while(out.length<max&&(p=text.indexOf(q,p))>=0){out.push(p);p+=Math.max(1,q.length)}return out},
  setCheckRunning(){},splitArticleForAi(src){return [{start:0,text:src}]},
  aiTextCheckConfigured:()=>true,
  ensureProtectiveVersion(){protectiveVersions++;return true},historyCheckpoint(){historyPoints++},afterProgrammaticEdit(){},closeAnalysis(){elements.analysisBackdrop.classList.remove('open')},showPane(){},markAnalysisStale(){},render(){},
  exactWordOccurrences(word){const out=[];let at=0;while((at=sandbox.editor.value.indexOf(word,at))>=0){out.push({start:at,end:at+word.length,text:word});at+=word.length}return out},
  suggestionsForWord:()=>['вариант'],applyReplacement(){},
  setEditorTextForArticle:undefined,loadFileText:undefined,restoreVersion:undefined,
  closeSpellPanel(){},
};
sandbox.window=sandbox;
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(workflow,sandbox,{filename:'12-workflow-policy.js'});

const results=[];
function check(name,fn){try{fn();results.push(['ok',name])}catch(e){results.push(['FAIL',name,e.message])}}

(async()=>{
  // 1. The analysis header has three independent states/actions.
  sandbox.editor.value='Текст слово слово.';
  localIssues=[{type:'frequent',title:'слово — 2 раза',detail:'повтор',start:6,end:11,word:'слово'}];
  sandbox.analyzeText();sandbox.renderAnalysis();
  check('header shows local issue count',()=>assert.ok(elements.analysisSummary.innerHTML.includes('Локальные замечания: 1')));
  check('header shows independent AI state',()=>assert.ok(elements.analysisSummary.innerHTML.includes('AI-проверка не запускалась')));
  check('header exposes one direct AI-fix action',()=>{assert.ok(elements.analysisSummary.innerHTML.includes('Исправить текст с помощью AI'));assert.ok(!elements.analysisSummary.innerHTML.includes('Исправить локальные'))});

  // 2. AI fix works even before an AI check and applies only a target patch.
  chatCalls=[];protectiveVersions=0;historyPoints=0;
  chatResponder=()=>JSON.stringify({patches:[{target_id:'t1',quote:'слово',replacement:'термин'}]});
  await sandbox.startAiFixFromAnalysis();
  check('local-only findings can be fixed by AI',()=>assert.strictEqual(sandbox.editor.value,'Текст термин слово.'));
  check('AI fix creates a protective version',()=>assert.strictEqual(protectiveVersions,1));
  check('AI fix participates in undo history',()=>assert.strictEqual(historyPoints,1));

  // 3. Manual AI checks do not auto-rebuild Dzen knowledge and are independent.
  sandbox.editor.value='Это плохая формулировка.';localIssues=[];chatCalls=[];crawlCalls=0;
  chatResponder=()=>JSON.stringify({dzen_issues:[],quality_issues:[{title:'Неточность',reason:'Слишком расплывчато',quote:'плохая формулировка',severity:'warning'}],style_issues:[]});
  await sandbox.startAiDzenArticleCheck(sandbox.editor.value);
  const firstCalls=chatCalls.length;
  await sandbox.startAiDzenArticleCheck(sandbox.editor.value);
  check('manual AI check never rebuilds rules implicitly',()=>assert.strictEqual(crawlCalls,0));
  check('each repeated AI check is a fresh API request',()=>assert.strictEqual(chatCalls.length,firstCalls*2));
  check('AI result is retained as a contextual issue',()=>assert.strictEqual(sandbox.aiDzenIssues.length,1));

  // 4. Knowledge build is explicit, has exact source quotes and an independent review pass.
  chatCalls=[];crawlCalls=0;localStorage.removeItem('dzenAiKnowledgeV1');
  const quote='Правило: нельзя обещать гарантированный результат.';
  const item={kind:'rule',check_mode:'semantic',title:'Без гарантированных обещаний',guidance:'Не обещать гарантированный результат',exceptions:'',terms:[],severity:'warning',source_url:'https://dzen.ru/help/ru/rules',source_quote:quote};
  chatResponder=()=>JSON.stringify({items:[item]});
  const built=await sandbox.buildDzenAiKnowledge();
  const knowledge=sandbox.dzenAiKnowledge();
  check('explicit knowledge build succeeds',()=>assert.strictEqual(built,true));
  check('knowledge uses schema 3 with reviewed provenance',()=>{assert.strictEqual(knowledge.schema,3);assert.strictEqual(knowledge.review.completed,true)});
  check('knowledge build performs extractor and independent reviewer calls',()=>assert.strictEqual(chatCalls.length,2));
  check('accepted rule keeps an exact source quote',()=>assert.strictEqual(knowledge.items[0].source_quote,quote));

  // 5. Unsupported source quotes are rejected.
  localStorage.removeItem('dzenAiKnowledgeV1');chatCalls=[];
  chatResponder=()=>JSON.stringify({items:[{...item,source_quote:'Этой цитаты на странице нет.'}]});
  const bad=await sandbox.buildDzenAiKnowledge();
  check('invented source quote cannot enter knowledge',()=>assert.strictEqual(bad,false));

  const failed=results.filter(x=>x[0]==='FAIL');
  for(const row of results)console.log(row[0],row[1],row[2]||'');
  if(failed.length)process.exit(1);
  console.log('AI review workflow checks:',results.length+'/'+results.length);
})().catch(e=>{console.error(e);process.exit(1)});
