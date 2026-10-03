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

console.log('P0 foundation tests passed');
