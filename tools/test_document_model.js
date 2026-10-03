'use strict';
const assert=require('assert');
const P0=require('../app/src/main/assets/www/js/14-p0-core.js');

const src=[
  '# Заголовок статьи',
  '',
  'Обычный текст с [подписью ссылки](https://example.com/path?q=1).',
  'Путь C:\\Temp\\file.txt и /usr/local/bin/tool не проверяются как слова.',
  'Но подпись ссылки должна проверяться.',
  '',
  '> Цитата сохраняет свой тип блока.',
  '',
  '- Первый пункт списка',
  '- Второй пункт списка',
  '',
  'Встроенный `код с ашипкой` исключён.',
  '',
  '```js',
  'const ашипка = "слово слово";',
  '```',
  '',
  'После кода слово слово должно быть видно.'
].join('\r\n');

const model=P0.documentModel(src);
assert.strictEqual(model.textLength,src.length);
assert.ok(model.blocks.some(b=>b.type==='heading'&&b.level===1),'H1 block missing');
assert.ok(model.blocks.some(b=>b.type==='quote'),'quote block missing');
assert.ok(model.blocks.some(b=>b.type==='list'),'list block missing');
assert.ok(model.blocks.some(b=>b.type==='code'&&b.excluded),'code block missing');

function excludedText(kind){
  return model.excluded.filter(r=>r.kind===kind||r.kind==='mixed').map(r=>src.slice(r.start,r.end));
}
assert.ok(model.excluded.some(r=>src.slice(r.start,r.end).includes('https://example.com/path?q=1')),'URL not excluded');
assert.ok(model.excluded.some(r=>src.slice(r.start,r.end).includes('C:\\Temp\\file.txt')),'Windows path not excluded');
assert.ok(model.excluded.some(r=>src.slice(r.start,r.end).includes('/usr/local/bin/tool')),'Unix path not excluded');
assert.ok(model.excluded.some(r=>src.slice(r.start,r.end).includes('`код с ашипкой`')),'inline code not excluded');
assert.ok(model.excluded.some(r=>src.slice(r.start,r.end).includes('const ашипка')),'fenced code not excluded');

const lang=P0.languageWords(src,model);
const texts=lang.map(t=>t.text.toLocaleLowerCase('ru-RU'));
assert.ok(texts.includes('подписью'),'readable link label must remain analyzable');
assert.ok(texts.includes('цитата'),'quote text must remain analyzable');
assert.ok(!texts.includes('example'),'URL host must not become a language token');
assert.ok(!texts.includes('temp'),'Windows path must not become a language token');
assert.ok(!texts.includes('ашипкой'),'inline-code typo must not become a language token');
assert.ok(!texts.includes('ашипка'),'fenced-code typo must not become a language token');

const repeats=P0.findRepeatedWords(src);
assert.strictEqual(repeats.length,1,'only repeat outside code should be reported');
assert.strictEqual(src.slice(repeats[0].start,repeats[0].end),'слово');
assert.ok(repeats[0].start>src.indexOf('```js'),'reported repeat must be after fenced code');

const crlf=src.indexOf('\r\n');
assert.ok(crlf>=0,'fixture must contain CRLF');
const heading=model.blocks.find(b=>b.type==='heading');
assert.strictEqual(src.slice(heading.start,heading.end).startsWith('# Заголовок статьи'),true,'UTF-16 offsets must point to original source');

console.log('Document model DOC05/A06 tests passed');
