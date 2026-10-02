/**
 * End-to-end simulation of the manual AI check and the retained-result workflow.
 *
 * The harness injects a fake AndroidDzenAI bridge and executes the same classic
 * scripts as the WebView. It verifies both the model pipeline and the product
 * rule introduced after 1.10.6: editing must not throw away the whole AI run.
 * A finding whose checked fragment was edited is handled for that AI session and
 * can only be created again by another explicit AI check.
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
    _text: '', _html: '', _value: '', hidden: false,
    style: { setProperty: noop, removeProperty: noop, getPropertyValue: () => '' },
    dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop,
    setAttribute: noop, getAttribute: () => null,
    appendChild: noop, removeChild: noop, focus: noop, blur: noop,
    querySelectorAll: () => [], querySelector: () => null,
    closest: () => null, contains: () => false,
  };
  Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: v => { el._html = String(v); } });
  Object.defineProperty(el, 'textContent', { get: () => el._text, set: v => { el._text = String(v); } });
  Object.defineProperty(el, 'value', { get: () => el._value, set: v => { el._value = String(v); } });
  el.scrollTop = 0; el.scrollHeight = 1000; el.clientHeight = 500;
  el.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 });
  return el;
}

const elements = {};
const articleHtml = '<html><head><title>Правила Дзена</title></head><body><h1>Правила</h1>' +
  '<p>Статья не должна содержать рекламу, запрещённые материалы и недостоверные сведения. ' +
  'Требования к оформлению заголовка, структуре текста и изображениям изложены в этом разделе.</p>' +
  '<p>Автор обязуется проверять факты, указывать источники и не публиковать материалы, ' +
  'нарушающие законодательство Российской Федерации.</p>' +
  '<a href="/help/ru/requirements/other.html">Другие требования к статьям</a>' +
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
    _v: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._v, k) ? this._v[k] : null; },
    setItem(k, v) { this._v[k] = String(v); },
    removeItem(k) { delete this._v[k]; },
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  navigator: { language: 'ru-RU' },
  console, URL, JSON, Math, Date, Promise, RegExp, Error, String, Number, Object, Array, Map, Set,
};

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
sandbox.window.AndroidDzenAI = bridge;
sandbox.globalThis = sandbox;
sandbox.window.document = sandbox.document;
sandbox.document.getElementById('editor');
sandbox.window.getSelection = () => ({ removeAllRanges: noop, addRange: noop, rangeCount: 0 });
sandbox.getSelection = sandbox.window.getSelection;

sandbox.DOMParser = class {
  parseFromString(raw) {
    const html = String(raw || '');
    const links = [];
    const linkRe = /<a[^>]+href="([^"]+)"[^>]*>/gi;
    let m;
    while ((m = linkRe.exec(html))) {
      const href = m[1];
      links.push({ getAttribute: () => href });
    }
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      querySelectorAll: sel => (sel === 'a[href]' ? links : []),
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
  '12-articles.js', '12-history.js', '12-workflow-policy.js', '12-publish.js',
];
vm.runInContext(FILES.map(f => fs.readFileSync(path.join(JS, f), 'utf8')).join('\n;\n'), sandbox, { filename: 'editor-bundle.js' });
sandbox.editor = elements.editor;

const ARTICLE = [
  '# Как выбрать тему для статьи', '',
  'Тема статьи — это не просто строчка в заголовке.',
  'От темы зависит, напишет ли читатель следующую главу.', '',
  '## Три признака хорошей темы', '',
  'Хорошая тема отвечает на один вопрос.', '',
  'Сначала сформулируйте вопрос, потом ищите подтверждение.', '',
  '## Как проверить тему', '',
  'Проверьте тему на свежесть и конкретность.', '',
  'Если тему нельзя объяснить в одном абзаце, разбейте её.',
].join('\n');

const SHARED_QUOTE = 'От темы зависит, напишет ли читатель следующую главу.';
const STYLE_QUOTE = 'Проверьте тему на свежесть и конкретность.';
const KNOWLEDGE = JSON.stringify({ items: [
  { kind: 'rule', title: 'Запрещена реклама', guidance: 'В статье не должно быть явной рекламы.', source_url: 'https://dzen.ru/help/ru/requirements/rules.html' },
] });

function isKnowledgeCall(system) { return system.includes('создаёшь базу знаний'); }
function articleAnswer() {
  return JSON.stringify({
    dzen_issues: [
      { title: 'Проверьте формулировку о рекламе', reason: 'Тема близка к рекламной подаче.', quote: SHARED_QUOTE, severity: 'warning', source_url: 'https://dzen.ru/help/ru/requirements/rules.html' },
    ],
    quality_issues: [
      { title: 'Размытая формулировка', reason: 'Непроверяемое утверждение.', quote: SHARED_QUOTE, severity: 'warning' },
    ],
    style_issues: [
      { title: 'Однотипное начало', reason: 'Проверьте формулировку.', quote: STYLE_QUOTE, severity: 'warning' },
    ],
  });
}

const run = expr => vm.runInContext(expr, sandbox);
function setSettings() {
  vm.runInContext(
    "settings.dzenCheckMode='both';" +
    "settings.dzenAiBaseUrl='https://example.test/v1';" +
    "settings.dzenAiModel='test/model';" +
    "settings.dzenAiSources='https://dzen.ru/help/ru/requirements/rules.html';" +
    "settings.dzenAiStylePrompt='';", sandbox);
}
function reset() {
  chatLog.length = 0;
  run('clearDzenAiKnowledge(); clearAiDzenIssues("idle");');
  sandbox.editor.value = ARTICLE;
  setSettings();
}
function startAiCheck() { return run('startAiDzenArticleCheck(editor.value)'); }
const settled = () => ['success','error'].includes(run('aiDzenRun.state')) && run('aiDzenBusy') === false;
function waitFor(predicate, label) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      let ok = false; try { ok = predicate(); } catch (_) {}
      if (ok) return resolve();
      if (Date.now() - t0 > 20000) return reject(new Error('timeout waiting for ' + label));
      setTimeout(poll, 10);
    })();
  });
}

const results = [];
function check(name, fn) {
  try { fn(); results.push(['ok', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}

(async () => {
  // 1. Happy path: findings reach the visible result and reports.
  reset();
  chatResponder = ({ system }) => isKnowledgeCall(system) ? KNOWLEDGE : articleAnswer();
  await startAiCheck();
  check('AI run reaches success state', () => assert.strictEqual(run('aiDzenRun.state'), 'success'));
  check('knowledge base was built', () => assert.ok(run('dzenAiKnowledge()')));
  check('all three AI findings are retained', () => assert.strictEqual(run('aiDzenIssues.length'), 3));
  check('two independent findings may share one source span', () => assert.strictEqual(run('aiDzenIssues.filter(x=>x.quote===' + JSON.stringify(SHARED_QUOTE) + ').length'), 2));
  check('AI findings reach currentAnalysis', () => assert.strictEqual(run('currentAnalysis.issues.filter(x=>x.ai===true).length'), 3));
  check('panel does not expose AI/Local origin prefixes', () => {
    assert.ok(!/AI ·|Локально ·/.test(elements.analysisContent._html), elements.analysisContent._html.slice(0, 500));
  });
  check('current report does not expose AI/Local origin prefixes', () => {
    const report = run('buildCurrentAnalysisReport()');
    assert.ok(!/\[AI ·|\[Локально ·/.test(report), report.slice(0, 500));
  });
  check('issue positions point at their exact accepted source', () => {
    const ok = run('aiDzenIssues.every(x=>editor.value.slice(x.start,x.end)===x.quote)');
    assert.ok(ok);
  });

  // 2. Unrelated edits keep the result, remap positions, and make no AI call.
  const callsBeforeEdit = chatLog.length;
  const originalCount = run('aiDzenIssues.length');
  run("editor.value='Новый вводный абзац.\\n\\n'+editor.value; markAnalysisStale(); analyzeText();");
  check('ordinary edit keeps successful AI session', () => assert.strictEqual(run('aiDzenRun.state'), 'success'));
  check('unrelated edit keeps every unresolved AI finding', () => assert.strictEqual(run('aiDzenIssues.length'), originalCount));
  check('ordinary edit does not call external AI', () => assert.strictEqual(chatLog.length, callsBeforeEdit));
  check('retained findings are remapped after text shifts', () => {
    assert.ok(run('aiDzenIssues.every(x=>editor.value.slice(x.start,x.end)===x.quote)'));
    assert.ok(run('aiDzenIssues.some(x=>x.start>' + ARTICLE.indexOf(SHARED_QUOTE) + ')'));
  });

  // 3. Editing one checked fragment removes only findings tied to that fragment.
  run('editor.value=editor.value.replace(' + JSON.stringify(STYLE_QUOTE) + ',' + JSON.stringify('Проверьте тему на актуальность и конкретность.') + '); markAnalysisStale(); analyzeText();');
  check('fixed fragment disappears from retained findings', () => assert.ok(!run('aiDzenIssues.some(x=>x.title==="Однотипное начало")')));
  check('other AI findings remain after one fix', () => assert.strictEqual(run('aiDzenIssues.length'), 2));
  check('two findings on the untouched shared fragment both remain', () => assert.strictEqual(run('aiDzenIssues.filter(x=>x.quote===' + JSON.stringify(SHARED_QUOTE) + ').length'), 2));

  // 4. Undo-like text restoration must not resurrect a handled finding inside
  // the same AI session. A new explicit AI run is the only way to create it again.
  run('editor.value=editor.value.replace(' + JSON.stringify('Проверьте тему на актуальность и конкретность.') + ',' + JSON.stringify(STYLE_QUOTE) + '); markAnalysisStale(); analyzeText();');
  check('restoring text does not resurrect a handled finding', () => assert.ok(!run('aiDzenIssues.some(x=>x.title==="Однотипное начало")')));
  check('handled finding remains removed in the same session', () => assert.strictEqual(run('aiDzenIssues.length'), 2));
  await startAiCheck();
  check('a new manual AI run may create the finding again', () => assert.ok(run('aiDzenIssues.some(x=>x.title==="Однотипное начало")')));
  check('new manual AI run rebuilds the complete result', () => assert.strictEqual(run('aiDzenIssues.length'), 3));

  // 5. Changing a fragment shared by two findings resolves both, not the third.
  run('editor.value=editor.value.replace(' + JSON.stringify(SHARED_QUOTE) + ',' + JSON.stringify('Тема влияет на интерес читателя, но это стоит подтверждать фактами.') + '); markAnalysisStale(); analyzeText();');
  check('editing a shared source resolves all findings attached to it', () => assert.strictEqual(run('aiDzenIssues.length'), 1));
  check('unrelated retained finding stays visible', () => assert.ok(run('aiDzenIssues.some(x=>x.title==="Однотипное начало")')));

  // 6. Invented quote is rejected.
  reset();
  chatResponder = ({ system }) => isKnowledgeCall(system) ? KNOWLEDGE : JSON.stringify({
    quality_issues: [{ title: 'Придумка', reason: 'Нет такой фразы.', quote: 'совершенно другой текст которого нет', severity: 'warning' }],
  });
  await startAiCheck();
  check('invented quote is rejected', () => assert.strictEqual(run('aiDzenIssues.length'), 0));
  check('rejected quote is counted', () => assert.ok(run('aiDzenRun.rejected') >= 1));

  // 7. Unparseable answer becomes a visible error.
  reset();
  chatResponder = ({ system }) => isKnowledgeCall(system) ? KNOWLEDGE : 'Это не JSON';
  await startAiCheck();
  check('unparseable answer becomes an error state', () => assert.strictEqual(run('aiDzenRun.state'), 'error'));
  check('AI error is visible in the analysis panel', () => assert.ok(/AI-проверка не завершена/.test(elements.analysisContent._html)));

  // 8. The only explicit full-check command still reaches AI; local edits do not.
  reset();
  chatResponder = ({ system }) => isKnowledgeCall(system) ? KNOWLEDGE : articleAnswer();
  run('runFullCheck()');
  await waitFor(settled, 'manual full check');
  check('manual full-check command reaches AI', () => assert.strictEqual(run('aiDzenRun.state'), 'success'));
  check('manual check keeps local findings too', () => assert.ok(run('currentAnalysis.issues.some(x=>!x.ai)')));

  // 9. Realistic quote drift from a model is still mapped to exact source text.
  reset();
  chatResponder = ({ system }) => isKnowledgeCall(system) ? KNOWLEDGE : JSON.stringify({
    quality_issues: [
      { title: 'Многоточие', reason: 'Дрейф цитаты.', quote: SHARED_QUOTE + '..', severity: 'warning' },
      { title: 'Тире', reason: 'Дрейф тире.', quote: 'Тема статьи - это не просто строчка в заголовке.', severity: 'warning' },
      { title: 'Ё', reason: 'Дрейф ё.', quote: 'Если тему нельзя объяснить в одном абзаце, разбейте ее.', severity: 'warning' },
    ],
  });
  await startAiCheck();
  check('typographic quote drift is accepted', () => assert.strictEqual(run('aiDzenIssues.length'), 3));
  check('drifted findings store exact source anchors', () => assert.ok(run('aiDzenIssues.every(x=>editor.value.slice(x.start,x.end)===x.quote)')));

  // 10. Cross-chunk quote is rejected rather than misplaced.
  reset();
  sandbox.editor.value = ARTICLE + '\n\n' + 'Дополнительный абзац про тему.\n\n'.repeat(700);
  const boundary = run('(function(){var c=splitArticleForAi(editor.value);return c[0].text.slice(-40)+" ||| "+c[1].text.slice(0,40)})()');
  chatResponder = ({ system }) => isKnowledgeCall(system) ? KNOWLEDGE : JSON.stringify({
    quality_issues: [{ title: 'Граница', reason: 'Граница чанка.', quote: boundary, severity: 'warning' }],
  });
  await startAiCheck();
  check('long article is split into several chunks', () => assert.ok(run('splitArticleForAi(editor.value).length') > 1));
  check('cross-chunk quote is rejected', () => assert.strictEqual(run('aiDzenIssues.length'), 0));

  // 11. The 180-item safety cap still survives the retention layer. Distinct
  // findings on the same quote are intentionally kept as distinct findings.
  reset();
  chatResponder = ({ system }) => {
    if (isKnowledgeCall(system)) return KNOWLEDGE;
    const many = [];
    for (let i = 0; i < 300; i++) many.push({ title: 'Замечание ' + i, reason: 'Причина ' + i, quote: 'Хорошая тема отвечает на один вопрос.', severity: 'warning' });
    return JSON.stringify({ quality_issues: many });
  };
  await startAiCheck();
  check('AI finding list is capped at 180', () => assert.strictEqual(run('aiDzenIssues.length'), 180));
  check('accepted counter matches retained result after the cap', () => assert.strictEqual(run('aiDzenRun.accepted'), run('aiDzenIssues.length')));

  console.log('');
  let failed = 0;
  for (const [status, name, msg] of results) {
    if (status !== 'ok') failed++;
    console.log((status === 'ok' ? '  ok   ' : ' FAIL  ') + name + (msg ? '\n        ' + msg : ''));
  }
  console.log('\nAI flow: ' + (results.length - failed) + '/' + results.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
