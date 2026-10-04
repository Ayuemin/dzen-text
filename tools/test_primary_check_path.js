'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

let analyzeCalls=0;
let semanticCalls=0;
let renderCalls=0;
const analysisBackdrop={classList:{add(){},remove(){}}};
const sandbox={
  console,
  editor:{value:'Обычный текст',blur(){}},
  analysisMode:'problems',
  __runLocalSemantic:false,
  toast(){},
  setCheckRunning(){},
  setAnalysisMode(){},
  renderAnalysis(){renderCalls++},
  analyzeText(){
    analyzeCalls++;
    if(sandbox.__runLocalSemantic)semanticCalls++;
    return {issues:[]};
  },
  document:{getElementById(id){return id==='analysisBackdrop'?analysisBackdrop:null}},
  setTimeout(fn){fn();return 1}
};
sandbox.window=sandbox;
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app','src','main','assets','www','js','07-spelling.js'),'utf8'),sandbox,{filename:'07-spelling.js'});

sandbox.runFullCheck();
assert.strictEqual(analyzeCalls,1,'full check must run analysis once');
assert.strictEqual(semanticCalls,0,'full check must not enable experimental semantic NLI');
assert.strictEqual(sandbox.__runLocalSemantic,false,'semantic flag leaked after full check');
assert.ok(renderCalls>0,'full check did not render analysis');

sandbox.openAnalysis();
assert.strictEqual(analyzeCalls,2,'opening analysis must refresh deterministic analysis');
assert.strictEqual(semanticCalls,0,'opening analysis must not enable experimental semantic NLI');
assert.strictEqual(sandbox.__runLocalSemantic,false,'semantic flag leaked after opening analysis');

sandbox.runAnalysisWithSemanticModel();
assert.strictEqual(analyzeCalls,3,'explicit experimental semantic path must still call analysis');
assert.strictEqual(semanticCalls,1,'explicit experimental semantic path no longer enables NLI');
assert.strictEqual(sandbox.__runLocalSemantic,false,'experimental semantic flag was not reset');

console.log('Primary deterministic check path tests passed');
