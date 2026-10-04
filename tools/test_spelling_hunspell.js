'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const P0=require('../app/src/main/assets/www/js/14-p0-core.js');

const storage={};
let batch=null;
let addedUserWord='';
let appliedEdit=null;
let staleMarks=0;
const snapshot={documentId:'article-1',revision:7,textHash:'hash:1',settingsVersion:'s',rulesVersion:'r'};
const sandbox={
  console,P0Core:P0,
  settings:{spellingYoMode:'normal'},
  editor:{value:'Текст ашипка.\n\n`код ашипка`\n\nhttps://example.test/ашипка\n\nМЧС работает.'},
  currentAnalysis:{issues:[],warningCount:0,editorCount:0,rulesCount:0,metrics:{},analysisSnapshot:{...snapshot}},
  localStorage:{getItem(k){return Object.prototype.hasOwnProperty.call(storage,k)?storage[k]:null},setItem(k,v){storage[k]=String(v)}},
  AndroidSpelling:{
    status(){return JSON.stringify({state:'ready',initMs:700,moduleVersion:'hunspell-test'})},
    cancel(){},
    checkBatch(id,json,limit){batch={id,words:JSON.parse(json),limit}},
    addUserWord(word){addedUserWord=String(word);return true}
  },
  currentDocumentSnapshot(){return {...snapshot}},
  snapshotMatchesCurrent(){return true},
  persistSettings(){return true},
  recountP0Analysis(){
    const a=sandbox.currentAnalysis;a.warningCount=a.issues.length;a.editorCount=a.issues.length;
  },
  renderAnalysis(){},updateAnalysisDot(){},
  analyzeText(){
    sandbox.currentAnalysis={issues:[],warningCount:0,editorCount:0,rulesCount:0,metrics:{},analysisSnapshot:{...snapshot}};
    return sandbox.currentAnalysis;
  },
  issueGroups(){return [{id:'proof',name:'Proof'}]},
  issueHtml(){return '<div></div>'},
  escapeHtml(v){return String(v)},
  jumpTo(){},toast(){},markAnalysisStale(){staleMarks++},
  applyDocumentEdits(edits,snap,label){appliedEdit={edits,snapshot:snap,label};return true},
  setTimeout(){return 0},clearTimeout(){},
  document:{readyState:'complete',getElementById(){return null},querySelector(){return null}},
};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app','src','main','assets','www','js','19-spelling-hunspell.js'),'utf8'),sandbox,{filename:'19-spelling-hunspell.js'});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app','src','main','assets','www','js','21-spelling-policy.js'),'utf8'),sandbox,{filename:'21-spelling-policy.js'});

function deliverMisspell(suggestions=['ошибка','нашивка']){
  assert.ok(batch,'native spelling batch not requested');
  sandbox.onNativeSpellingBatch(batch.id,JSON.stringify({
    state:'ready',checked:batch.words.length,durationMs:2.5,
    misspelled:[{word:'ашипка',suggestions}]
  }));
}
function startSpellText(text,revision,hash){
  sandbox.editor.value=text;snapshot.revision=revision;snapshot.textHash=hash;batch=null;sandbox.analyzeText();
  assert.ok(batch,'native batch missing for SPELL04 integration');return {...batch};
}
function deliverBatch(request,entries){
  sandbox.onNativeSpellingBatch(request.id,JSON.stringify({state:'ready',checked:request.words.length,durationMs:1.25,misspelled:entries}));
}

assert.ok(sandbox.SpellingHunspell,'SpellingHunspell API missing');
assert.ok(sandbox.SpellingPolicy,'SpellingPolicy API missing');
const tokens=sandbox.SpellingHunspell.collectCandidates(sandbox.editor.value).map(x=>x.text);
assert.ok(tokens.includes('Текст'));
assert.ok(tokens.includes('ашипка'));
assert.strictEqual(tokens.includes('код'),false,'inline code leaked into spelling');
assert.strictEqual(tokens.filter(x=>x==='ашипка').length,1,'excluded code/URL occurrence leaked into spelling');
assert.strictEqual(tokens.includes('МЧС'),false,'temporary abbreviation guard missing');

sandbox.analyzeText();
assert.ok(batch,'native spelling batch not requested');
assert.strictEqual(batch.limit,5);
assert.ok(batch.words.includes('ашипка'));
assert.strictEqual(batch.words.includes('МЧС'),false);
deliverMisspell(['ошибка','нашивка','ошибка-2','ошибка-3','ошибка-4','лишняя']);
assert.strictEqual(sandbox.currentAnalysis.issues.filter(x=>x.type==='spelling').length,1);
let issue=sandbox.currentAnalysis.issues.find(x=>x.type==='spelling');
assert.strictEqual(issue.ruleId,'spelling.unknown-word');
assert.strictEqual(issue.fragment,'ашипка');
assert.strictEqual(issue.suggestions.length,5,'UI must cap suggestions at five');
assert.deepStrictEqual(Array.from(issue.suggestions.slice(0,2)),['ошибка','нашивка']);
assert.strictEqual(issue.documentId,'article-1');
assert.strictEqual(issue.revision,7);

assert.strictEqual(sandbox.applySpellingFix(issue.start,issue.end,issue.fragment,'ошибка'),true);
assert.ok(appliedEdit,'spelling fix did not use transactional document edit');
assert.strictEqual(appliedEdit.edits.length,1);
assert.strictEqual(appliedEdit.edits[0].expected,'ашипка');
assert.strictEqual(appliedEdit.edits[0].replacement,'ошибка');
assert.strictEqual(appliedEdit.snapshot.revision,7);
assert.strictEqual(appliedEdit.label,'spelling fix');
assert.strictEqual(staleMarks,1,'successful spelling fix must mark analysis stale');

sandbox.skipSpellingOccurrence(issue.start,issue.end,issue.word);
assert.strictEqual(sandbox.currentAnalysis.issues.filter(x=>x.type==='spelling').length,0,'skip must remove only the current occurrence');

batch=null;sandbox.analyzeText();
deliverMisspell();
assert.strictEqual(sandbox.currentAnalysis.issues.filter(x=>x.type==='spelling').length,0,'skip must survive recheck of the same revision');

snapshot.revision=8;
snapshot.textHash='hash:2';
batch=null;sandbox.analyzeText();
deliverMisspell();
assert.strictEqual(sandbox.currentAnalysis.issues.filter(x=>x.type==='spelling').length,1,'skip must expire after document revision changes');

assert.strictEqual(sandbox.addSpellingUserWord('ашипка'),true);
assert.strictEqual(addedUserWord,'ашипка');
assert.strictEqual(sandbox.currentAnalysis.issues.filter(x=>x.type==='spelling').length,0,'personal dictionary action must remove matching issues');

batch=null;sandbox.analyzeText();
const staleBatch={...batch};
assert.ok(staleBatch&&staleBatch.id);
snapshot.revision=9;
snapshot.textHash='hash:3';
sandbox.onNativeSpellingBatch(staleBatch.id,JSON.stringify({state:'ready',checked:1,durationMs:1,misspelled:[{word:'ашипка',suggestions:['ошибка']}]}));
assert.strictEqual(sandbox.currentAnalysis.issues.filter(x=>x.type==='spelling').length,0,'stale native response must be discarded');
snapshot.revision=8;
snapshot.textHash='hash:2';

batch=null;sandbox.analyzeText();
deliverMisspell();
assert.strictEqual(sandbox.allowSpellingWord('ашипка'),true);
assert.strictEqual(sandbox.currentAnalysis.issues.filter(x=>x.type==='spelling').length,0);
assert.ok(storage.spellingAllowedByDocumentV1,'document allow-list was not persisted');

batch=null;sandbox.analyzeText();
assert.ok(batch);
assert.strictEqual(batch.words.includes('ашипка'),false,'allowed article word returned to native batch');

// SPELL04: deterministic token policy. Numbers/model names, mixed-script product
// tokens and conventional abbreviations are outside Russian dictionary errors.
assert.strictEqual(sandbox.SpellingPolicy.classifySpellWord('МЧС').check,false);
assert.strictEqual(sandbox.SpellingPolicy.classifySpellWord('т').check,false);
assert.strictEqual(sandbox.SpellingPolicy.classifySpellWord('ЯндексGPT').check,false);
assert.strictEqual(sandbox.SpellingPolicy.classifySpellWord('Камера-15').check,false);
assert.strictEqual(sandbox.SpellingPolicy.classifySpellWord('интернет-магазин').reason,'hyphenated');
assert.strictEqual(sandbox.SpellingPolicy.classifySpellWord('обычный').check,true);
assert.strictEqual(sandbox.SpellingPolicy.adaptSuggestionCase('Елка','ёлка'),'Ёлка');

// Normal е/ё mode suppresses a miss when Hunspell's correction differs only by ё.
sandbox.settings.spellingYoMode='normal';
let policyIssue={type:'spelling',word:'елка',fragment:'елка',suggestions:['ёлка','елки'],fixes:[],ruleId:'spelling.unknown-word',kind:'error'};
let result=sandbox.SpellingPolicy.rewriteIssueByPolicy(policyIssue);
assert.strictEqual(result.keep,false,'normal е/ё mode must suppress an equivalent ё-only correction');

// Strict mode exposes the same signal as a dedicated, safely fixable ё issue.
sandbox.settings.spellingYoMode='strict';
policyIssue={type:'spelling',word:'елка',fragment:'елка',suggestions:['ёлка','елки'],fixes:[],ruleId:'spelling.unknown-word',kind:'error'};
result=sandbox.SpellingPolicy.rewriteIssueByPolicy(policyIssue);
assert.strictEqual(result.keep,true);
assert.strictEqual(policyIssue.ruleId,'spelling.yo');
assert.strictEqual(policyIssue.suggestions[0],'ёлка');
assert.strictEqual(policyIssue.fixes[0].replacement,'ёлка');

// A rejected hyphenated form is downgraded to a recommendation: the dictionary
// rejection alone is not enough to assert that the hyphen itself is wrong.
policyIssue={type:'spelling',word:'интернет-магазин',fragment:'интернет-магазин',suggestions:['интернет магазин'],fixes:[],ruleId:'spelling.unknown-word',kind:'error'};
result=sandbox.SpellingPolicy.rewriteIssueByPolicy(policyIssue);
assert.strictEqual(result.keep,true);
assert.strictEqual(policyIssue.ruleId,'spelling.hyphenated-word');
assert.strictEqual(policyIssue.kind,'recommendation');

// Product-like mixed-script tokens must not survive into spelling issues; GRAM04
// remains responsible for suspicious alphabet mixing.
policyIssue={type:'spelling',word:'ЯндексGPT',fragment:'ЯндексGPT',suggestions:['Яндекс'],fixes:[],ruleId:'spelling.unknown-word',kind:'error'};
result=sandbox.SpellingPolicy.rewriteIssueByPolicy(policyIssue);
assert.strictEqual(result.keep,false);

// Integration: policy must run inside the real native-batch callback, not only
// when rewriteIssueByPolicy is called directly.
sandbox.settings.spellingYoMode='normal';
let request=startSpellText('елка т. е. ЯндексGPT интернет-магазин Камера-15',10,'hash:10');
deliverBatch(request,[
  {word:'елка',suggestions:['ёлка']},
  {word:'т',suggestions:['та']},
  {word:'е',suggestions:['ее']},
  {word:'ЯндексGPT',suggestions:['Яндекс']},
  {word:'интернет-магазин',suggestions:['интернет магазин']}
]);
let spelling=sandbox.currentAnalysis.issues.filter(x=>x.type==='spelling');
assert.strictEqual(spelling.some(x=>x.word==='елка'),false,'normal ё mode leaked through native callback');
assert.strictEqual(spelling.some(x=>x.word==='т'||x.word==='е'),false,'dotted abbreviation letters leaked through native callback');
assert.strictEqual(spelling.some(x=>x.word==='ЯндексGPT'),false,'product-like mixed token leaked through native callback');
assert.strictEqual(spelling.some(x=>x.word==='Камера-15'),false,'number/model token leaked through native callback');
const hyphenIssue=spelling.find(x=>x.word==='интернет-магазин');
assert.ok(hyphenIssue,'hyphenated native issue should remain as a recommendation');
assert.strictEqual(hyphenIssue.kind,'recommendation');
assert.strictEqual(hyphenIssue.ruleId,'spelling.hyphenated-word');
assert.ok(sandbox.issueHtml(hyphenIssue).includes('рекомендация'),'recommendation card must not be labelled as an error');

sandbox.settings.spellingYoMode='strict';
request=startSpellText('елка',11,'hash:11');
deliverBatch(request,[{word:'елка',suggestions:['ёлка']}]);
spelling=sandbox.currentAnalysis.issues.filter(x=>x.type==='spelling');
assert.strictEqual(spelling.length,1,'strict ё mode must expose one native issue');
assert.strictEqual(spelling[0].ruleId,'spelling.yo');
assert.strictEqual(spelling[0].suggestions[0],'ёлка');
assert.strictEqual(spelling[0].fixes[0].replacement,'ёлка');

console.log('SPELL01/02/04 Hunspell integration tests passed');