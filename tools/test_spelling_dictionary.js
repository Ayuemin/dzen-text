'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

let pickerCalls=0;
const addedWords=[];
const messages=[];
const sandbox={
  console,
  document:{readyState:'loading',addEventListener(){},querySelector(){return null}},
  AndroidSpelling:{
    userWords(){return JSON.stringify(['ёжик','Арбуз','ёжик'])},
    status(){return JSON.stringify({state:'ready'})},
    addUserWord(word){addedWords.push(String(word));return true}
  },
  AndroidSpellingFile:{pickImport(){pickerCalls++}},
  toast(message){messages.push(String(message))},
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

function letters(n){
  let out='';let value=n+1;
  while(value>0){value--;out=String.fromCharCode(1072+(value%32))+out;value=Math.floor(value/32)}
  return out;
}
const many=Array.from({length:5002},(_,i)=>'слово'+letters(i));
parsed=api.parseImportWords(JSON.stringify(many),'many.json');
assert.strictEqual(parsed.ok,true);
assert.strictEqual(parsed.words.length,api.MAX_IMPORT_WORDS);
assert.strictEqual(parsed.truncated,true);

const nativeWords=Array.from(api.nativeUserWords());
assert.ok(nativeWords.includes('ёжик'));
assert.ok(nativeWords.includes('Арбуз'));

sandbox.choosePersonalDictionaryImport();
assert.strictEqual(pickerCalls,1,'Android production import must use native system picker');
assert.deepStrictEqual(addedWords,[],'opening picker must not mutate dictionary');

const importResult=sandbox.onNativeSpellingDictionaryLoaded(JSON.stringify({schema:'spelling-user-dictionary-v1',words:['новослово','ёжик'] }),'roundtrip.json');
assert.strictEqual(importResult.ok,true);
assert.strictEqual(importResult.added,2);
assert.deepStrictEqual(addedWords,['новослово','ёжик']);
assert.ok(messages.some(x=>x.includes('Импортировано слов: 2')),'native import result was not surfaced');

sandbox.onNativeSpellingDictionaryError('Ошибка чтения');
assert.ok(messages.includes('Ошибка чтения'),'native picker error was not surfaced');

console.log('SPELL03 personal dictionary import/export + native picker tests passed');
