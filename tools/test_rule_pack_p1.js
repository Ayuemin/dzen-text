'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const store=new Map();
const localStorage={
  getItem:k=>store.has(k)?store.get(k):null,
  setItem:(k,v)=>{store.set(k,String(v));},
  removeItem:k=>store.delete(k)
};
const sandbox={
  console,TextEncoder,localStorage,
  document:{querySelector(){return null;}},
  escapeHtml:s=>String(s),toast(){},analyzeText(){},updateRulePackStatus(){},
  validateRulePackText(){},installPendingRulePack(){},
  activeRulePack:{schema:'editorial-rule-pack-v1',id:'demo',name:'Demo',version:'1',rules:[
    {id:'a',type:'word',title:'A',message:'A',values:['a']},
    {id:'b',type:'word',title:'B',message:'B',values:['b']},
    {id:'manual-a',type:'manual',title:'Manual',message:'M'}
  ]},
  analyzeRulePack(){return {checked:1,matches:100,errors:[]};},
  renderRulePackManual(){return '';},
  lastRulePackDiagnostics:{checked:0,matches:0,errors:[]},
  currentDocumentSnapshot(){return {documentId:'article-1',revision:5};},
  validateRulePackObject(input){return {ok:true,errors:[],pack:input,autoCount:(input.rules||[]).filter(r=>r.type!=='manual').length,manualCount:(input.rules||[]).filter(r=>r.type==='manual').length};},
  saveRulePack(){return true;},closeRulePackImport(){},pendingRulePack:null
};
// The production v1 functions read browser globals lexically; they do not rely
// on the caller's `this`. Mirror that here so the P1 wrapper is tested against
// the same calling contract.
sandbox.activeAutoRules=()=>sandbox.activeRulePack.rules.filter(r=>r.type!=='manual');
sandbox.manualRuleItems=()=>sandbox.activeRulePack.rules.filter(r=>r.type==='manual');
sandbox.window=sandbox;
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app','src','main','assets','www','js','17-rule-pack-p1.js'),'utf8'),sandbox,{filename:'17-rule-pack-p1.js'});

const P=sandbox.RulePackP1;
assert.ok(P,'RulePackP1 API missing');
const valid={schema:'editorial-rule-pack-v1',id:'pack',name:'Пакет',version:'1',rules:[{id:'r1',type:'word',title:'Слово',message:'Проверьте',values:['тест']}]};
let result=P.prevalidatePackText(JSON.stringify(valid));
assert.strictEqual(result.ok,true,JSON.stringify(result.errors));

const dup=JSON.parse(JSON.stringify(valid));
dup.rules.push({...dup.rules[0]});
result=P.prevalidatePackText(JSON.stringify(dup));
assert.strictEqual(result.ok,false);
assert.ok(result.errors.some(x=>x.includes('$.rules[1].id')&&x.includes('дубликат')),JSON.stringify(result.errors));

const badType=JSON.parse(JSON.stringify(valid));
badType.rules[0].type='javascript';
result=P.prevalidatePackText(JSON.stringify(badType));
assert.strictEqual(result.ok,false);
assert.ok(result.errors.some(x=>x.includes('$.rules[0].type')),JSON.stringify(result.errors));

const tooMany=JSON.parse(JSON.stringify(valid));
tooMany.rules=Array.from({length:501},(_,i)=>({id:'r'+i,type:'word',title:'R',message:'M',values:['x']}));
result=P.prevalidatePackText(JSON.stringify(tooMany));
assert.strictEqual(result.ok,false);
assert.ok(result.errors.some(x=>x.includes('$.rules')&&x.includes('500')),JSON.stringify(result.errors));

const huge='{"schema":"editorial-rule-pack-v1","padding":"'+'я'.repeat(1100000)+'"}';
result=P.prevalidatePackText(huge);
assert.strictEqual(result.ok,false);
assert.ok(result.errors.some(x=>x.includes('2 МБ')),JSON.stringify(result.errors));

assert.strictEqual(sandbox.activeAutoRules().length,2);
sandbox.setPackRuleEnabled('a',false);
assert.deepStrictEqual(Array.from(sandbox.activeAutoRules(),r=>r.id),['b']);
sandbox.setPackRuleEnabled('a',true);
assert.deepStrictEqual(Array.from(sandbox.activeAutoRules(),r=>r.id),['a','b']);

const diag=sandbox.analyzeRulePack('x',[],[]);
assert.strictEqual(diag.totalRules,2);
assert.strictEqual(diag.checked,1);
assert.strictEqual(diag.partial,true);
assert.strictEqual(diag.issueLimitReached,true);
assert.ok(/Проверено 1 из 2/.test(diag.partialReason),diag.partialReason);

sandbox.toggleManualRuleMark('manual-a');
let html=sandbox.renderRulePackManual();
assert.ok(html.includes('☑'),'manual mark for current revision should be checked');
sandbox.currentDocumentSnapshot=()=>({documentId:'article-1',revision:6});
html=sandbox.renderRulePackManual();
assert.ok(html.includes('устарела'),'manual mark must become stale on new revision');

console.log('P1 rule-pack tests passed');
