'use strict';
const assert=require('assert');
const P0=require('../app/src/main/assets/www/js/14-p0-core.js');

function one(text){
  const hits=P0.findRepeatedWords(text);
  assert.strictEqual(hits.length,1,'expected one repeated-word hit for: '+JSON.stringify(text));
  return hits[0];
}

// A01: Russian word boundaries must not depend on ASCII \b.
let h=one('слово слово');
assert.strictEqual('слово слово'.slice(h.start,h.end),'слово');
h=one('Это это');
assert.strictEqual('Это это'.slice(h.start,h.end),'это');
h=one('слово\nслово');
assert.strictEqual(h.separator,'\n');
h=one('ёж, ЁЖ');
assert.strictEqual('ёж, ЁЖ'.slice(h.start,h.end),'ЁЖ');
assert.strictEqual(P0.findRepeatedWords('слово другое слово').length,0);
assert.strictEqual(P0.findRepeatedWords('тест тестирование').length,0);

// A02: all offsets are JavaScript/textarea UTF-16 offsets. Emoji before a hit
// must not shift the selected Russian fragment; CRLF must remain untouched.
const unicode='😀 ёж ёж\r\nтекст';
h=one(unicode);
assert.strictEqual(unicode.slice(h.start,h.end),'ёж');
assert.strictEqual(h.start,6); // 😀 occupies two UTF-16 code units.
const removed=P0.applyEdits(unicode,[{start:h.start,end:h.end,expected:'ёж',replacement:''}]);
assert.strictEqual(removed.ok,true);
assert.strictEqual(removed.text,'😀 ёж \r\nтекст');
assert.ok(removed.text.includes('\r\n'));

// Combining marks are preserved exactly around edited UTF-16 ranges.
const combining='До е\u0301 и после';
const accentStart=combining.indexOf('е');
let accentEdit=P0.applyEdits(combining,[{
  start:accentStart,
  end:accentStart+2,
  expected:'е\u0301',
  replacement:'ё'
}]);
assert.strictEqual(accentEdit.ok,true);
assert.strictEqual(accentEdit.text,'До ё и после');

// A03: analysis result is valid only for the same document/revision/text/settings/rules.
const base={documentId:'a_1',revision:7,textHash:P0.textHash('текст'),settingsVersion:'s1',rulesVersion:'r1'};
assert.strictEqual(P0.snapshotMatches(base,{...base}),true);
assert.strictEqual(P0.snapshotMatches(base,{...base,revision:8}),false);
assert.strictEqual(P0.snapshotMatches(base,{...base,documentId:'a_2'}),false);
assert.strictEqual(P0.snapshotMatches(base,{...base,textHash:P0.textHash('другой')}),false);
assert.strictEqual(P0.snapshotMatches(base,{...base,settingsVersion:'s2'}),false);
assert.strictEqual(P0.snapshotMatches(base,{...base,rulesVersion:'r2'}),false);

// A04: edits are validated against original fragments and applied from right to left.
const src='раз два три четыре';
let tx=P0.applyEdits(src,[
  {start:0,end:3,expected:'раз',replacement:'РАЗ'},
  {start:8,end:11,expected:'три',replacement:'III'}
]);
assert.strictEqual(tx.ok,true);
assert.strictEqual(tx.text,'РАЗ два III четыре');
assert.strictEqual(tx.count,2);
assert.strictEqual(src,'раз два три четыре','source snapshot must remain immutable');

tx=P0.applyEdits(src,[{start:0,end:3,expected:'два',replacement:'X'}]);
assert.strictEqual(tx.ok,false);
assert.strictEqual(tx.error,'fragment');
assert.strictEqual(tx.text,src);

tx=P0.applyEdits(src,[
  {start:0,end:7,replacement:'A'},
  {start:4,end:11,replacement:'B'}
]);
assert.strictEqual(tx.ok,false);
assert.strictEqual(tx.error,'overlap');
assert.strictEqual(tx.text,src);

// A11: the publication model has exactly one title for Markdown H1 and plain text.
let parts=P0.publicationParts('# Заголовок статьи\n\nПервый абзац.\nВторой абзац.');
assert.strictEqual(parts.title,'Заголовок статьи');
assert.strictEqual(parts.titleMode,'h1');
assert.ok(!parts.body.includes('# Заголовок статьи'));
let payload=P0.composePublication(parts.title,'<p>Первый абзац.</p>','Первый абзац.','all');
assert.strictEqual((payload.plain.match(/Заголовок статьи/g)||[]).length,1);
assert.strictEqual((payload.html.match(/Заголовок статьи/g)||[]).length,1);

parts=P0.publicationParts('Обычный заголовок\n\nТекст без Markdown.');
assert.strictEqual(parts.title,'Обычный заголовок');
assert.strictEqual(parts.titleMode,'plain');
assert.strictEqual(parts.body,'Текст без Markdown.');
payload=P0.composePublication(parts.title,'<p>Текст без Markdown.</p>','Текст без Markdown.','all');
assert.strictEqual(payload.plain,'Обычный заголовок\n\nТекст без Markdown.');
assert.strictEqual((payload.plain.match(/Обычный заголовок/g)||[]).length,1);

const titleOnly=P0.composePublication(parts.title,'<p>Текст</p>','Текст','title');
assert.strictEqual(titleOnly.plain,'Обычный заголовок');
const bodyOnly=P0.composePublication(parts.title,'<p>Текст</p>','Текст','body');
assert.strictEqual(bodyOnly.plain,'Текст');
assert.ok(!bodyOnly.html.includes('Обычный заголовок'));

console.log('P0 foundation tests passed');
