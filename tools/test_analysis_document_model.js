'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const P0=require('../app/src/main/assets/www/js/14-p0-core.js');

const JS=path.join(__dirname,'..','app','src','main','assets','www','js');
const sandbox={
  P0Core:P0,
  console,
  stopWords:new Set(['этот','который','после','перед']),
  wordMatches(text){return Array.from(String(text||'').matchAll(/[A-Za-zА-Яа-яЁё0-9]+(?:[-’'][A-Za-zА-Яа-яЁё0-9]+)*/g));}
};
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(JS,'03-analysis-core.js'),'utf8'),sandbox,{filename:'03-analysis-core.js'});

const src=[
  '# Настоящий заголовок',
  '',
  'Первое предложение с [видимой подписью](https://example.com/ошибка). Второе предложение.',
  '',
  '```md',
  '# Ложный заголовок в коде',
  'ошибка ошибка внутри кода',
  '```',
  '',
  '> Цитата не входит в обычные абзацы.',
  '',
  '- Список тоже не обычный абзац.',
  '',
  'После кода повторяемая фраза один два три.',
  'Ещё текст: повторяемая фраза один два три.'
].join('\r\n');

const headings=sandbox.headingsFromSource(src);
assert.strictEqual(headings.length,1,'heading inside fenced code must be ignored');
assert.strictEqual(headings[0].text,'Настоящий заголовок');
assert.strictEqual(src.slice(headings[0].start,headings[0].end),'Настоящий заголовок');

const sentences=sandbox.sentenceObjects(src);
assert.ok(sentences.some(s=>s.text.startsWith('Первое предложение')),'paragraph sentence missing');
assert.ok(!sentences.some(s=>s.text.includes('внутри кода')),'fenced code became sentence');
assert.ok(!sentences.some(s=>s.text.startsWith('>')),'quote became ordinary sentence');
assert.ok(!sentences.some(s=>s.text.startsWith('-')),'list became ordinary sentence');

const paragraphs=sandbox.paragraphObjects(src);
assert.ok(paragraphs.some(p=>p.text.includes('Первое предложение')),'paragraph missing');
assert.ok(!paragraphs.some(p=>p.text.includes('внутри кода')),'code became paragraph');
assert.ok(!paragraphs.some(p=>p.text.includes('Цитата не входит')),'quote became paragraph');

const words=sandbox.analysisWordMatches('Подпись [ссылки](https://example.com/path) и `код ошибка`.');
const wordTexts=words.map(m=>m[0].toLocaleLowerCase('ru-RU'));
assert.ok(wordTexts.includes('подпись')&&wordTexts.includes('ссылки'),'readable link label must be checked');
assert.ok(!wordTexts.includes('https')&&!wordTexts.includes('example')&&!wordTexts.includes('path'),'URL destination must be excluded');
assert.ok(!wordTexts.includes('код')&&!wordTexts.includes('ошибка'),'inline code must be excluded');

const issues=[];
sandbox.analyzeRepeatedPhrases(src,issues);
assert.ok(issues.some(i=>/повторяемая фраза один/.test(i.title)),'repeat inside readable paragraphs must be detected');

const bridge='альфа бета https://example.com/x альфа бета';
const bridgeIssues=[];
sandbox.analyzeRepeatedPhrases(bridge,bridgeIssues);
assert.strictEqual(bridgeIssues.length,0,'phrase detector must not bridge across excluded URL');

console.log('Analysis DOC05 integration tests passed');
