'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const P0=require('../app/src/main/assets/www/js/14-p0-core.js');

const sandbox={P0Core:P0,console};
sandbox.window=sandbox;
sandbox.addIssue=function(arr,type,title,detail,start,end,severity){
  const issue={type,title,detail,start,end,severity};
  arr.push(issue);
  return issue;
};
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname,'..','app','src','main','assets','www','js','16-proof-context.js'),'utf8'),
  sandbox,{filename:'16-proof-context.js'}
);
assert.strictEqual(typeof sandbox.analyzeProofLocal,'function','proof v2 not installed');

function issues(text){const out=[];sandbox.analyzeProofLocal(text,out);return out;}
function byRule(list,id){return list.filter(x=>x.ruleId===id);}

// A06 / GRAM04: these contexts must stay untouched.
for(const text of [
  'Число 3.14 осталось точным.',
  'Встреча в 12:30 состоится.',
  'Это т. е. обычное сокращение.',
  'Адрес https://example.com/a:b?x=1 остаётся как есть.',
  'Допустим вопрос?! Да.',
  'Улыбка :) и грусть :( остаются смайликами.',
  'Код `слово,слово  cлово (((` не проверяется.',
  '```js\nconst cлово="да,нет"; (((\n```'
]){
  assert.deepStrictEqual(issues(text),[],`unexpected issue for safe context: ${text}`);
}

let list=issues('Первое,второе.');
let hit=byRule(list,'mechanics.space-after-punctuation')[0];
assert.ok(hit,'missing space-after-punctuation issue');
assert.strictEqual('Первое,второе.'.slice(hit.start,hit.end),',');
assert.strictEqual(hit.replacement,', ');

list=issues('Первое , второе.');
hit=byRule(list,'mechanics.space-before-punctuation')[0];
assert.ok(hit,'missing space-before-punctuation issue');
assert.strictEqual(hit.replacement,',');

list=issues('Очень  много пробелов.');
hit=byRule(list,'mechanics.multiple-spaces')[0];
assert.ok(hit,'missing multiple-spaces issue');
assert.strictEqual(hit.replacement,' ');

list=issues('Что!!! Это повтор.');
hit=byRule(list,'mechanics.repeated-punctuation')[0];
assert.ok(hit,'missing repeated punctuation issue');
assert.strictEqual(hit.replacement,'!');

list=issues('Это cлово смешивает алфавиты.');
hit=byRule(list,'mechanics.mixed-alphabet')[0];
assert.ok(hit,'missing mixed alphabet recommendation');
assert.strictEqual(hit.confidence,0.72);
assert.strictEqual(hit.replacement,undefined,'mixed alphabet must not auto-replace');

list=issues('Текст с незакрытой (скобкой.');
hit=byRule(list,'mechanics.unbalanced-bracket')[0];
assert.ok(hit,'missing unbalanced bracket issue');
assert.strictEqual('Текст с незакрытой (скобкой.'.slice(hit.start,hit.end),'(');

list=issues('Лишняя скобка ) здесь.');
hit=byRule(list,'mechanics.unbalanced-bracket')[0];
assert.ok(hit,'missing extra closing bracket issue');
assert.strictEqual('Лишняя скобка ) здесь.'.slice(hit.start,hit.end),')');

// Excluded ranges may contain the same mechanical patterns without leaking issues.
list=issues('Снаружи,ошибка и `внутри,ошибка` плюс https://example.com/a,b.');
assert.strictEqual(byRule(list,'mechanics.space-after-punctuation').length,1,'only readable outside text should trigger');
assert.strictEqual(list[0].start,'Снаружи,ошибка'.indexOf(','));

console.log('GRAM04/A06 proof context tests passed');
