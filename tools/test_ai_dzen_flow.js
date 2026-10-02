/**
 * End-to-end simulation of the AI (Dzen rules) check pipeline.
 *
 * The app talks to the model through the AndroidDzenAI Java bridge, so this
 * harness injects a fake bridge with scripted answers and then exercises the
 * real code path: runFullCheck -> startAiDzenArticleCheck -> aiChat ->
 * parseAiJson -> normalizeAiArticleResult -> analyzeText -> report builders.
 *
 * It answers three questions:
 *   1. does a successful model answer reach the on-screen analysis?
 *   2. does it reach the exported text report?
 *   3. what happens to issues whose quote does not match the article?
 *
 * Run: node tools/test_ai_dzen_flow.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const WWW = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www');
const JS = path.join(WWW, 'js');

function noop() {}
function makeEl() {
  const el = {
    _text: '', _html: '',
    style: { setProperty: noop, removeProperty: noop, getPropertyValue: () => '' },
    dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop,
    setAttribute: noop, getAttribute: () => null,
    appendChild: noop, removeChild: noop, focus: noop, blur: noop,
    querySelectorAll: () => [], querySelector: () => null,
    closest: () => null, contains: () => false,
  };
  Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: v => { el._html = v; } });
  Object.defineProperty(el, 'textContent', { get: () => el._text, set: v => { el._text = v; } });
  Object.defineProperty(el, 'value', { get: () => el._value || '', set: v => { el._value = v; } });
  el.scrollTop = 0; el.scrollHeight = 1000; el.clientHeight = 500;
  el.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 });
  return el;
}

const elements = {};
// htmlPageData() ignores pages with less than 180 characters of text, so the
// fixture has to be a realistically sized help page.
const articleHtml = '<html><head><title>Правила Дзена</title></head><body><h1>Правила</h1>' +
  '<p>Статья не должна содержать рекламу, запрещённые материалы и недостоверные сведения. ' +
  'Требования к оформлению заголовка, структуре текста и изображениям изложены в этом разделе.</p>' +
  '<p>Автор обязуется проверять факты, указывать источники и не публиковать материалы, ' +
  'нарушающие законодательство Российской Федерации.</p>' +
  '<a href="/help/ru/requirements/other.html">Другие требования к статьям</a>' +
  '<a href="https://example.com/outside">Внешний сайт, который нужно игнорировать</a>' +
  '</body></html>';

const chatLog = [];
let chatResponder = null;

const sandbox = {
  window: {
    innerHeight: 800, visualViewport: null,
    addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
    setTimeout, clearTimeout, setInterval, clearInterval,
    location: { protocol: 'file:' },
  },
  document: {
    documentElement: makeEl(),
    getElementById(id) { return elements[id] || (elements[id] = makeEl()); },
    createElement: () => makeEl(),
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener: noop, body: makeEl(), activeElement: null, hidden: false,
    execCommand: () => true,
  },
  localStorage: {
    _v: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._v, k) ? this._v[k] : null; },
    setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; },
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  navigator: { language: 'ru-RU' },
  console, URL, JSON, Math, Date, Promise, RegExp, Error, String, Number, Object, Array, Map, Set,
};
// Fake native bridge. In the app it is injected as window.AndroidDzenAI by
// addJavascriptInterface, so it has to be reachable as a bare global too.
const bridge = {
  hasKey: () => true,
  saveKey: () => true,
  clearKey: noop,
  fetchPage(url, id) {
    setTimeout(() => sandbox.window.onNativeAiPageResult(id, url, articleHtml), 0);
  },
  chat(base, model, system, user, id) {
    chatLog.push({ base, model, system, user });
    setTimeout(() => {
      try {
        sandbox.window.onNativeAiChatResult(id, chatResponder({ system, user, call: chatLog.length }));
      } catch (e) {
        sandbox.window.onNativeAiError(id, e.message);
      }
    }, 0);
  },
};
sandbox.AndroidDzenAI = bridge;
// dzenAiBridgeAvailable() probes window.AndroidDzenAI, so both must exist.
sandbox.window.AndroidDzenAI = bridge;

sandbox.globalThis = sandbox;
sandbox.window.document = sandbox.document;
sandbox.document.getElementById('editor');
sandbox.window.getSelection = () => ({ removeAllRanges: noop, addRange: noop, rangeCount: 0 });
sandbox.getSelection = sandbox.window.getSelection;
// Minimal HTML stand-in: enough for htmlPageData() to see text and links.
sandbox.DOMParser = class {
  parseFromString(raw) {
    const html = String(raw || '');
    const links = [];
    const linkRe = /<a[^>]+href="([^"]+)"[^>]*>/gi;
    let m;
    while ((m = linkRe.exec(html))) links.push({ getAttribute: () => m[1] });
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      querySelectorAll: (sel) => (sel === 'a[href]' ? links : []),
      querySelector: () => null,
      body: { innerText: text, textContent: text },
    };
  }
};
vm.createContext(sandbox);

const FILES = [
  '01-core.js', '02-text-tools.js', '03-analysis-core.js', '04-dzen-analysis.js',
  '05-analysis-state.js', '06-analysis-report.js', '07-spelling.js', '08-navigation.js',
  '09-editor.js', '10-settings.js', '10-ai-dzen.js', '11-ui.js', '12-dialogs.js',
  '12-articles.js', '12-history.js', '12-markdown-toolbar.js', '12-publish.js',
];
const bundle = FILES.map(f => fs.readFileSync(path.join(JS, f), 'utf8')).join('\n;\n');
vm.runInContext(bundle, sandbox, { filename: 'editor-bundle.js' });
// 01-core.js binds `editor` to the element resolved from the DOM.
sandbox.editor = elements.editor;

const ARTICLE = [
  '# Как выбрать тему для статьи',
  '',
  'Тема статьи — это не просто строчка в заголовке.',
  'От темы зависит, напишет ли читатель следующую главу.',
  '',
  '## Три признака хорошей темы',
  '',
  'Хорошая тема отвечает на один вопрос.',
  '',
  'Сначала сформулируйте вопрос, потом ищите подтверждение.',
  '',
  '## Как проверить тему',
  '',
  'Проверьте тему на свежесть и конкретность.',
  '',
  'Если тему нельзя объяснить в одном абзаце, разбейте её.',
].join('\n');

const KNOWLEDGE = JSON.stringify({ items: [
  { kind: 'rule', title: 'Запрещена реклама', guidance: 'В статье не должно быть явной рекламы.', source_url: 'https://dzen.ru/help/ru/requirements/rules.html' },
] });

function isKnowledgeCall(system) {
  return system.includes('создаёшь базу знаний');
}

function articleAnswer() {
  return JSON.stringify({
    dzen_issues: [
      { title: 'Проверьте формулировку о рекламе', reason: 'Тема близка к рекламной подаче.', quote: 'От темы зависит, напишет ли читатель следующую главу.', severity: 'warning', source_url: 'https://dzen.ru/help/ru/requirements/rules.html' },
    ],
    quality_issues: [
      { title: 'Размытая формулировка', reason: 'Не проверяемое утверждение.', quote: 'От темы зависит, напишет ли читатель следующую главу.', severity: 'warning' },
    ],
    style_issues: [
      { title: 'Однотипное начало', reason: 'Абзац начинается с отглагольного существительного.', quote: 'Проверьте тему на свежесть и конкретность.', severity: 'warning' },
    ],
  });
}

function setMode(mode) {
  vm.runInContext("settings.dzenCheckMode=" + JSON.stringify(mode) + ";" +
    "settings.dzenAiBaseUrl='https://example.test/v1';" +
    "settings.dzenAiModel='test/model';" +
    "settings.dzenAiSources='https://dzen.ru/help/ru/requirements/rules.html';" +
    "settings.dzenAiStylePrompt='';", sandbox);
}

function reset(mode) {
  chatLog.length = 0;
  vm.runInContext('clearDzenAiKnowledge(); clearAiDzenIssues("idle");', sandbox);
  sandbox.editor.value = ARTICLE;
  setMode(mode || 'ai');
}

const run = (expr) => vm.runInContext(expr, sandbox);
const results = [];
function check(name, fn) {
  try { fn(); results.push(['ok', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}

function waitFor(predicate, label) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      let ok = false;
      try { ok = predicate(); } catch (e) { ok = false; }
      if (ok) return resolve();
      if (Date.now() - t0 > 20000) {
        return reject(new Error('timeout waiting for ' + label + ' (state=' + run('aiDzenRun.state') + ' msg=' + run('aiDzenRun.message') + ')'));
      }
      setTimeout(poll, 10);

      setTimeout(poll, 10);
    })();
  });
}

// startAiDzenArticleCheck is async, so awaiting the promise it returns settles
// exactly when the run is over. Polling a state flag instead races the finally
// block that clears aiDzenBusy.
function startAiCheck() {
  return vm.runInContext('startAiDzenArticleCheck(editor.value)', sandbox);
}

// Polls for the scenarios driven through runFullCheck(), which does not hand
// back the AI promise.
const settled = () => {
  const s = run('aiDzenRun.state');
  return (s === 'success' || s === 'error') && run('aiDzenBusy') === false;
};

// Traces each scenario when DBG=1, so a slow or stuck run is easy to place.
let scenarioNo = 0;
async function stage(name, fn) {
  scenarioNo++;
  const t0 = Date.now();
  if (process.env.DBG) console.log('  [dbg] >> ' + scenarioNo + ' ' + name);
  await fn();
  if (process.env.DBG) console.log('  [dbg] << ' + scenarioNo + ' ' + name + ' in ' + (Date.now() - t0) + 'ms');
}


(async () => {
  // ------------------------------------------------- scenario 1: happy path
  reset('ai');
  chatResponder = ({ system }) => (isKnowledgeCall(system) ? KNOWLEDGE : articleAnswer());
  await stage('happy path', startAiCheck);
  check('AI run reaches success state', () => {
    const s = run('aiDzenRun.state');
    assert.strictEqual(s, 'success', 'state=' + s + ' msg=' + run('aiDzenRun.message'));
  });
  check('knowledge base was built', () => assert.ok(run('dzenAiKnowledge()'), 'no knowledge in localStorage'));
  check('aiDzenIssues are stored', () => assert.ok(run('aiDzenIssues.length') > 0, 'aiDzenIssues empty'));
  check('AI issues reach currentAnalysis', () => {
    const n = run('currentAnalysis.issues.filter(x=>x.ai===true).length');
    assert.ok(n > 0, 'currentAnalysis has no ai issues');
  });
  check('analysis panel shows AI issues', () => {
    const html = elements.analysisContent._html;
    assert.ok(/Размытая формулировка|Проверьте формулировку/.test(html), 'panel html: ' + html.slice(0, 400));
  });
  check('AI report lists AI issues', () => {
    const r = run('buildAiAnalysisReport()');
    assert.ok(/AI-замечаний: [1-9]/.test(r), r.slice(0, 300));
  });
  check('combined report counts AI issues', () => {
    const r = run('buildCombinedAnalysisReport()');
    assert.ok(/AI: [1-9]/.test(r), r.slice(0, 300));
  });
  check('issue positions point at the quoted text', () => {
    const at = run('editor.value.slice(aiDzenIssues[0].start, aiDzenIssues[0].end)');
    assert.ok(at.length > 0 && ARTICLE.indexOf(at) >= 0, 'mapped text: ' + JSON.stringify(at));
  });

  // ------------------------------- scenario 2: quote the model got wrong
  reset('ai');
  chatResponder = ({ system }) => (isKnowledgeCall(system) ? KNOWLEDGE : JSON.stringify({
    dzen_issues: [{ title: 'Не найдёт цитату', reason: 'Придуманная цитата.', quote: 'такой фразы нет в статье вовсе', severity: 'warning' }],
  }));
  await stage('invented quote', startAiCheck);
  check('mismatched quote is rejected', () => {
    assert.strictEqual(run('aiDzenIssues.length'), 0, 'accepted ' + run('aiDzenIssues.length'));
  });
  check('rejected count is reported', () => assert.ok(run('aiDzenRun.rejected') >= 1, 'rejected=' + run('aiDzenRun.rejected')));
  check('report explains zero findings', () => assert.ok(/Замечаний не найдено/.test(run('buildAiAnalysisReport()'))));

  // ------------------------------------------ scenario 3: unparsable answer
  reset('ai');
  chatResponder = ({ system }) => (isKnowledgeCall(system) ? KNOWLEDGE : 'Извините, я не могу выполнить эту просьбу.');
  await stage('unparsable', startAiCheck);
  check('unparsable answer becomes an error state', () => {
    assert.strictEqual(run('aiDzenRun.state'), 'error', 'state=' + run('aiDzenRun.state'));
  });
  check('error is visible in the analysis note', () => {
    assert.ok(/AI-проверка не завершена/.test(elements.analysisContent._html), elements.analysisContent._html.slice(0, 300));
  });

  // ------------------------------------------- scenario 4: stale after edit
  reset('ai');
  chatResponder = ({ system }) => (isKnowledgeCall(system) ? KNOWLEDGE : articleAnswer());
  await stage('stale', startAiCheck);
  run("editor.value = editor.value + '\\n\\nДобавленный абзац.'; markAnalysisStale();");
  check('editing marks the AI result stale', () => {
    assert.strictEqual(run('aiDzenRun.state'), 'stale', 'state=' + run('aiDzenRun.state'));
  });
  check('stale report says the run is outdated', () => {
    assert.ok(/устарел|не запускалась/.test(run('buildAiAnalysisReport()')));
  });

  // ----------------------------------------------- scenario 5: "both" mode
  reset('both');
  chatResponder = ({ system }) => (isKnowledgeCall(system) ? KNOWLEDGE : articleAnswer());
  run('runFullCheck()');
  await stage('both mode', () => waitFor(settled, 'run'));
  check('both mode completes', () => {
    const s = run('aiDzenRun.state');
    assert.strictEqual(s, 'success', 'state=' + s + ' ' + run('aiDzenRun.message'));
  });
  check('both mode keeps local findings', () => {
    const n = run('currentAnalysis.issues.filter(x=>!x.ai).length');
    assert.ok(n > 0, 'local=' + n);
  });
  check('both mode keeps AI findings', () => {
    const n = run('currentAnalysis.issues.filter(x=>x.ai).length');
    assert.ok(n > 0, 'ai=' + n);
  });
  check('combined report labels AI origin', () => {
    assert.ok(/\[AI ·/.test(run('buildCombinedAnalysisReport()')), 'no AI origin labels');
  });

  // ------------------------------------- scenario 6: toolbar button, AI mode
  reset('ai');
  chatResponder = ({ system }) => (isKnowledgeCall(system) ? KNOWLEDGE : articleAnswer());
  run('runFullCheck()');
  await stage('toolbar', () => waitFor(settled, 'run'));
  check('AI mode via the toolbar button works', () => {
    const s = run('aiDzenRun.state');
    assert.strictEqual(s, 'success', 'state=' + s + ' ' + run('aiDzenRun.message'));
  });

  // ------------------------- scenario 7: realistic model quote drift
  // Real models normalise typography: they append an ellipsis, write е for ё,
  // use a hyphen for — and " for «». Each of these used to silently discard an
  // otherwise valid finding.
  reset('ai');
  chatResponder = ({ system }) => (isKnowledgeCall(system) ? KNOWLEDGE : JSON.stringify({
    quality_issues: [
      { title: 'Лишняя многоточие', reason: 'Модель добавила многоточие.', quote: 'От темы зависит, напишет ли читатель следующую главу...', severity: 'warning' },
      { title: 'Тире заменено', reason: 'Модель написала дефис вместо тире.', quote: 'Тема статьи - это не просто строчка в заголовке.', severity: 'warning' },
      { title: 'Ё как е', reason: 'Модель заменила ё на е.', quote: 'Если тему нельзя объяснить в одном абзаце, разбейте ее.', severity: 'warning' },
    ],
  }));
  await stage('drift', startAiCheck);
  check('quote with a trailing ellipsis is located', () => {
    assert.ok(run('aiDzenIssues.some(x=>x.title==="Лишняя многоточие")'), 'dropped; rejected=' + run('aiDzenRun.rejected'));
  });
  check('quote with a swapped dash is located', () => {
    assert.ok(run('aiDzenIssues.some(x=>x.title==="Тире заменено")'), 'dropped; rejected=' + run('aiDzenRun.rejected'));
  });
  check('quote with ё written as е is located', () => {
    assert.ok(run('aiDzenIssues.some(x=>x.title==="Ё как е")'), 'dropped; rejected=' + run('aiDzenRun.rejected'));
  });
  check('drifted quotes still map onto the real source text', () => {
    for (const title of ['Лишняя многоточие', 'Тире заменено', 'Ё как е']) {
      const got = run('(function(){var i=aiDzenIssues.find(x=>x.title===' + JSON.stringify(title) + ');' +
        'return i?editor.value.slice(i.start,i.end):null})()');
      assert.ok(got && ARTICLE.indexOf(got) >= 0, title + ' -> ' + JSON.stringify(got));
    }
  });
  reset('ai');
  chatResponder = ({ system }) => (isKnowledgeCall(system) ? KNOWLEDGE : JSON.stringify({
    quality_issues: [{ title: 'Придумка', reason: 'Такой фразы нет.', quote: 'совершенно другой текст которого нет' }],
  }));
  await stage('invented 2', startAiCheck);
  check('an invented quote is not accepted', () => {
    assert.strictEqual(run('aiDzenIssues.length'), 0, 'accepted ' + run('aiDzenIssues.length'));
  });

  // ------------------------- scenario 8: quote spanning a chunk boundary
  // A long article is split into 18k chunks. A quote that the model returns
  // across the split cannot be found in either chunk.
  reset('ai');
  const longArticle = ARTICLE + '\n\n' + 'Дополнительный абзац про тему.\n\n'.repeat(700);
  sandbox.editor.value = longArticle;
  check('long article is split into several chunks', () => {
    const n = run('splitArticleForAi(editor.value).length');
    assert.ok(n > 1, 'chunks=' + n);
  });
  const boundary = run('(function(){var c=splitArticleForAi(editor.value);return c[0].text.slice(-40)+" ||| "+c[1].text.slice(0,40)})()');
  chatResponder = ({ system }) => (isKnowledgeCall(system) ? KNOWLEDGE : JSON.stringify({
    quality_issues: [{ title: 'Граница', reason: 'Проверка границы чанка.', quote: boundary, severity: 'warning' }],
  }));
  await stage('chunk boundary', startAiCheck);
  check('quote spanning a chunk boundary is rejected, not misplaced', () => {
    const n = run('aiDzenIssues.length');
    assert.strictEqual(n, 0, 'accepted a cross-chunk quote: ' + n);
  });

  // ------------------------- scenario 9: 180-item cap and dedupe
  reset('ai');
  chatResponder = ({ system }) => {
    if (isKnowledgeCall(system)) return KNOWLEDGE;
    const many = [];
    for (let i = 0; i < 300; i++) {
      many.push({ title: 'Замечание ' + i, reason: 'Причина ' + i, quote: 'Хорошая тема отвечает на один вопрос.', severity: 'warning' });
    }
    return JSON.stringify({ quality_issues: many });
  };
  await stage('cap', startAiCheck);
  check('duplicate findings are collapsed and the list is capped', () => {
    const n = run('aiDzenIssues.length');
    assert.ok(n <= 180, 'capped at 180, got ' + n);
    assert.ok(n > 0, 'nothing accepted');
  });
  check('accepted counter matches the stored issue list', () => {
    assert.strictEqual(run('aiDzenRun.accepted'), run('aiDzenIssues.length'));
  });

  console.log('');
  let failed = 0;
  for (const [status, name, msg] of results) {
    if (status !== 'ok') failed++;
    console.log((status === 'ok' ? '  ok   ' : ' FAIL  ') + name + (msg ? '\n        ' + msg : ''));
  }
  console.log('\nAI flow: ' + (results.length - failed) + '/' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
