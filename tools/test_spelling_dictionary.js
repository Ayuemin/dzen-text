'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const sandbox={
  console,
  document:{readyState:'loading',addEventListener(){},querySelector(){return null},getElementById(){return null}},
  AndroidSpelling:{userWords(){return JSON.stringify(['ёжик','Арбуз','ёжик'])},status(){return JSON.stringify({state:'ready'})}},
  setTimeout(){},
};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app','src','main','assets','www','js','20-spelling-dictionary.js'),'utf8'),sandbox,{filename:'20-spelling-dictionary.js'});

const api=sandbox.SpellingDictionaryUI;
assert.ok(api,'SpellingDictionaryUI API missing');
assert.strictEqual(api.validPersonalWord('слово'),true);
assert.strictEqual(api.validPersonalWord('слово-форма'),true);
assert.strictEqual(api.validPersonalWord("д'артаньян"),true);
assert.strictEqual(api.validPersonalWord('два слова'),false);
assert.strictEqual(api.validPersonalWord('123'),false);

let parsed=api.parseImportWords(JSON.stringify({schema:'spelling-user-dictionary-v1',words:['Слово','слово','ёлка','два слова',''] }),'dict.json');
assert.strictEqual(parsed.ok,true);
assert.deepStrictEqual(Array.from(parsed.words),['Слово','ёлка']);
assert.strictEqual(parsed.rejected,1);

parsed=api.parseImportWords('слово\r\nЁлка\nслово\nне верно\n','dict.txt');
assert.strictEqual(parsed.ok,true);
assert.deepStrictEqual(Array.from(parsed.words),['слово','Ёлка']);
assert.strictEqual(parsed.rejected,1);

parsed=api.parseImportWords('{bad json','dict.json');
assert.strictEqual(parsed.ok,false,'malformed JSON import must be rejected');

const many=Array.from({length:5002},(_,i)=>'слово'+String(i).replace(/\d/g,d=>'а'.repeat(Number(d)+1)));
parsed=api.parseImportWords(JSON.stringify(many),'many.json');
assert.strictEqual(parsed.ok,true);
assert.ok(parsed.words.length<=api.MAX_IMPORT_WORDS);
assert.strictEqual(parsed.truncated,true);

const nativeWords=Array.from(api.nativeUserWords());
assert.ok(nativeWords.includes('ёжик'));
assert.ok(nativeWords.includes('Арбуз'));

console.log('SPELL03 personal dictionary import/export parser tests passed');
