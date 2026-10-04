'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const P0=require('../app/src/main/assets/www/js/14-p0-core.js');

const storage={};
let batch=null;
const snapshot={documentId:'article-1',revision:7,textHash:'hash:1',settingsVersion:'s',rulesVersion:'r'};
const sandbox={
  console,P0Core:P0,
  editor:{value:'Текст ашипка.\n\n`код ашипка`\n\nhttps://example.test/ашипка\n\nМЧС работает.'},
  currentAnalysis:{issues:[],warningCount:0,editorCount:0,rulesCount:0,metrics:{},analysisSnapshot:snapshot},
  localStorage:{getItem(k){return Object.prototype.hasOwnProperty.call(storage,k)?storage[k]:null},setItem(k,v){storage[k]=String(v)}},
  AndroidSpelling:{
    status(){return JSON.stringify({state:'ready',initMs:700,moduleVersion:'hunspell-test'})},
    cancel(){},
    checkBatch(id,json,limit){batch={id,words:JSON.parse(json),limit}},
    addUserWord(){return true}
  },
  currentDocumentSnapshot(){return {...snapshot}},
  snapshotMatchesCurrent(){return true},
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
  jumpTo(){},toast(){},markAnalysisStale(){},
  applyDocumentEdits(){return true},
  document:{getElementById(){return null}},
};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app','src','main','assets','www','js','19-spelling-hunspell.js'),'utf8'),sandbox,{filename:'19-spelling-hunspell.js'});

assert.ok(sandbox.SpellingHunspell,'SpellingHunspell API missing');
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

sandbox.onNativeSpellingBatch(batch.id,JSON.stringify({
  state:'ready',checked:batch.words.length,durationMs:2.5,
  misspelled:[{word:'ашипка',suggestions:['ошибка','нашивка']}]
}));
assert.strictEqual(sandbox.currentAnalysis.issues.filter(x=>x.type==='spelling').length,1);
const issue=sandbox.currentAnalysis.issues.find(x=>x.type==='spelling');
assert.strictEqual(issue.ruleId,'spelling.unknown-word');
assert.strictEqual(issue.fragment,'ашипка');
assert.deepStrictEqual(Array.from(issue.suggestions),['ошибка','нашивка']);
assert.strictEqual(issue.documentId,'article-1');
assert.strictEqual(issue.revision,7);

assert.strictEqual(sandbox.allowSpellingWord('ашипка'),true);
assert.strictEqual(sandbox.currentAnalysis.issues.filter(x=>x.type==='spelling').length,0);
assert.ok(storage.spellingAllowedByDocumentV1,'document allow-list was not persisted');

batch=null;sandbox.analyzeText();
assert.ok(batch);
assert.strictEqual(batch.words.includes('ашипка'),false,'allowed article word returned to native batch');

console.log('SPELL01/02 Hunspell integration tests passed');
