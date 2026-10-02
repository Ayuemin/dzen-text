/**
 * Measures the cost of a full analysis run on a long article.
 *
 * analyzeText() is synchronous, so its cost lands directly on the UI thread.
 * This benchmark builds realistic Russian text of a given size and reports the
 * time for one pass. It exists to justify the debounce threshold and to catch a
 * regression that makes the editor unusable on long articles.
 *
 * Run: node tools/bench_analysis.js [wordCount]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WWW = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www');
const JS = path.join(WWW, 'js');
const WORDS = Number(process.argv[2] || 10000);

function noop() {}
function makeEl() {
  const el = {
    _text: '', _html: '',
    style: {}, dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop,
    setAttribute: noop, getAttribute: () => null,
    appendChild: noop, remove: noop, focus: noop, blur: noop,
    querySelectorAll: () => [],
  };
  Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: v => { el._html = v; } });
  Object.defineProperty(el, 'textContent', { get: () => el._text, set: v => { el._text = v; } });
  Object.defineProperty(el, 'value', { get: () => el._value || '', set: v => { el._value = v; } });
  el.scrollTop = 0;
  el.scrollHeight = 1000;
  el.clientHeight = 500;
  el.getBoundingClientRect = () => ({ top: 0, bottom: 0, height: 500 });
  return el;
}

const elements = {};
// 01-core.js resolves the editor from the DOM; pre-register it so the
// benchmark can assign the article text before analysis runs.
elements.editor = makeEl();
const documentElement = makeEl();
const sandbox = {
  window: {
    innerHeight: 800,
    visualViewport: null,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    setTimeout, clearTimeout,
    location: { protocol: 'file:' },
  },
  document: {
    documentElement,
    getElementById(id) { return elements[id] || (elements[id] = makeEl()); },
    createElement: () => makeEl(),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: noop, removeEventListener: noop,
    body: makeEl(),
    activeElement: null,
    hidden: false,
  },
  localStorage: {
    _v: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._v, k) ? this._v[k] : null; },
    setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; },
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  navigator: { language: 'ru-RU' },
  console,
};
sandbox.globalThis = sandbox;
sandbox.window.getSelection = () => ({ removeAllRanges: noop, addRange: noop, rangeCount: 0 });
sandbox.getSelection = sandbox.window.getSelection;
vm.createContext(sandbox);

// In the browser these are classic <script> tags that share one global lexical
// environment, so top-level let/const from any file is visible to every other.
// vm.runInContext would isolate each call, so concatenate into one script.
const FILES = [
  '01-core.js', '02-text-tools.js', '03-analysis-core.js', '04-dzen-analysis.js',
  '05-analysis-state.js', '06-analysis-report.js', '07-spelling.js', '08-navigation.js',
  '09-editor.js', '10-settings.js', '10-ai-dzen.js', '11-ui.js', '12-dialogs.js',
  '12-articles.js', '12-history.js', '12-markdown-toolbar.js', '12-publish.js',
];
const bundle = FILES
  .map(f => fs.readFileSync(path.join(JS, f), 'utf8'))
  .join('\n;\n');
try {
  vm.runInContext(bundle, sandbox, { filename: 'editor-bundle.js' });
} catch (e) {
  console.error('bundle failed to load:', e.message);
  process.exit(2);
}
if (typeof sandbox.analyzeText !== 'function') {
  console.error('analyzeText is not reachable in the sandbox');
  process.exit(2);
}

// Realistic prose: repeated sentence shapes so the heuristics actually fire.
const SENTENCES = [
  'Редактор проверяет текст перед публикацией и подсказывает возможные проблемы которые пользователь должен исправить самостоятельно перед отправкой готовой статьи в редактор дзена.',
  'Это очень длинное предложение, которое содержит много слов и потому превышает заданный порог настройки.',
  'Каждое такое предложение обрабатывается анализатором и попадает в список замечаний.',
  'Пользователь видит список замечаний и может перейти к нужному месту в тексте.',
  'Дзен требует аккуратного оформления статьи и ясной структуры.',
];
function buildText(words) {
  const out = ['# Заголовок статьи'];
  let count = 0, i = 0;
  while (count < words) {
    const s = SENTENCES[i++ % SENTENCES.length];
    count += s.split(/\s+/).length;
    out.push('', s, '');
    if (i % 9 === 0) out.push('## Подзаголовок ' + (i / 9));
    if (i % 17 === 0) out.push('- пункт списка');
  }
  return out.join('\n');
}

const text = buildText(WORDS);
// 01-core.js binds `editor` to this very element.
sandbox.editor = elements.editor;
// Lower every threshold so all heuristics fire: this is the worst case.
sandbox.editor.value = text;
vm.runInContext('settings.sentenceMax=8;settings.paragraphMax=120;settings.frequentMin=3;settings.nearbyCheck=true;settings.phraseCheck=true;settings.openingCheck=true;settings.structureMax=200;settings.headingMax=20;', sandbox);
const t0 = process.hrtime.bigint();
const result = sandbox.analyzeText();
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

console.log('words in source :', WORDS, ' chars:', text.length);
console.log('analysis pass  :', ms.toFixed(1), 'ms');
console.log('issues found   :', result ? result.warningCount : 'n/a');

console.log('SLOW (>=400ms) :', ms >= 400 ? 'yes' : 'no');
process.exit(ms >= 400 ? 1 : 0);