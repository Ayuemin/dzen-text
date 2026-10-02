/**
 * Integration tests for copyRichHtml: the single code path that feeds the Dzen
 * editor. Each scenario asserts what actually landed in the clipboard.
 *
 *   1. native bridge present  -> both flavours come from AndroidPublish
 *   2. native bridge absent   -> browser selection copy of rendered HTML
 *   3. selection copy fails   -> plain-text fallback still carries no Markdown
 *   4. clipboard stage is emptied and the user selection survives
 *
 * Run: node tools/test_publish_copy.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www', 'js');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

// Extracts a top-level function by brace matching so the copy path can be
// tested without loading the whole editor, which needs a full DOM.
function loadFunctions(sandbox, file, names) {
  const src = fs.readFileSync(path.join(JS, file), 'utf8');
  for (const fn of names) {
    const start = src.indexOf('function ' + fn);
    if (start < 0) throw new Error('missing function ' + fn);
    let depth = 0, end = -1;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) throw new Error('unbalanced function ' + fn);
    vm.runInContext(src.slice(start, end), sandbox, { filename: file + '#' + fn });
  }
}

function makeEnv(opts) {
  const toasts = [];
  const nativeCalls = [];
  const execCalls = [];
  let selection = [{ marker: 'user-selection' }];

  const stage = {
    _html: '',
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
  };
  const plainTa = {
    value: '', setAttribute() {}, select() {},
    setSelectionRange() {}, remove() {},
  };

  const sandbox = {
    window: {},
    document: {
      createElement(tag) {
        if (tag === 'textarea') {
          plainTa.setAttribute = () => {};
          plainTa.select = () => {};
          plainTa.setSelectionRange = () => {};
          plainTa.remove = () => {};
          return plainTa;
        }
        return {
          set innerHTML(v) { this._html = v; },
          get innerHTML() { return this._html; },
          get textContent() { return String(this._html).replace(/<[^>]+>/g, ''); },
          get innerText() { return this.textContent; },
        };
      },
      getElementById(id) { return id === 'copyStage' ? stage : null; },
      body: { appendChild() {} },
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    execCommand(cmd) { execCalls.push(cmd); return !opts.execCommandFails; },
    toast(msg) { toasts.push(msg); },
  };
  sandbox.document.execCommand = sandbox.execCommand;

  if (opts.nativeAvailable) {
    sandbox.AndroidPublish = {
      copyForPublication(html, plain) {
        nativeCalls.push({ html, plain });
        return !opts.nativeFails;
      },
    };
  }
  sandbox.window.AndroidPublish = sandbox.AndroidPublish;

  const selectionApi = {
    get rangeCount() { return selection.length; },
    getRangeAt(i) { return selection[i]; },
    removeAllRanges() { selection = []; },
    addRange(r) { selection.push(r); },
  };
  sandbox.window.getSelection = () => selectionApi;
  sandbox.getSelection = sandbox.window.getSelection;

  sandbox.__stage = stage;
  sandbox.__toasts = toasts;
  sandbox.__nativeCalls = nativeCalls;
  sandbox.__execCalls = execCalls;
  sandbox.__selectionState = () => selection;
  sandbox.__plainTa = plainTa;

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, '02-text-tools.js'), 'utf8'), sandbox, { filename: '02-text-tools.js' });
  loadFunctions(sandbox, '09-editor.js', ['publishPayload', 'copyRichHtml', 'copyPayloadToWebClipboard']);
  sandbox.editor = { value: opts.markdown || '' };
  return sandbox;
}

const ARTICLE = '# Заголовок статьи\n\nПервый абзац с **жирным** словом.\n\n## Подзаголовок\n\n- пункт один\n- пункт два\n\n[ссылка](https://dzen.ru/x)';

// --- 1. native bridge -----------------------------------------------------
{
  const env = makeEnv({ nativeAvailable: true, markdown: ARTICLE });
  env.copyRichHtml();
  check('нативный мост вызван один раз', env.__nativeCalls.length === 1, String(env.__nativeCalls.length));
  const call = env.__nativeCalls[0] || { html: '', plain: '' };
  check('в HTML нет markdown-заголовка', !call.html.includes('# '), call.html);
  check('в HTML нет markdown-жирного', !call.html.includes('**'), call.html);
  check('в HTML нет markdown-ссылки', !call.html.includes(']('), call.html);
  check('в HTML есть отрендеренный strong', call.html.includes('<strong>жирным</strong>'), call.html);
  check('в HTML есть ссылка', call.html.includes('<a href="https://dzen.ru/x"'), call.html);
  check('plain не содержит markdown', !call.plain.includes('**') && !call.plain.includes('## ') && !call.plain.includes(']('), call.plain);
  check('plain содержит текст статьи', call.plain.includes('Первый абзац'), call.plain);
  check('execCommand не вызывается при наличии моста', env.__execCalls.length === 0, JSON.stringify(env.__execCalls));
  check('тост об успешном копировании', env.__toasts[0] === 'Скопировано для публикации', JSON.stringify(env.__toasts));
}

// --- 2. browser fallback, selection copy succeeds -------------------------
{
  const env = makeEnv({ nativeAvailable: false, markdown: ARTICLE });
  env.copyRichHtml();
  check('браузерный путь вызывает execCommand', env.__execCalls.includes('copy'), JSON.stringify(env.__execCalls));
  check('браузерный путь не использует нативный мост', env.__nativeCalls.length === 0);
  check('stage очищен после копирования', env.__stage.innerHTML === '', env.__stage.innerHTML);
  check('выделение пользователя восстановлено', env.__selectionState().some(r => r.marker === 'user-selection'), JSON.stringify(env.__selectionState()));
  check('нет тоста про «Текст скопирован»', env.__toasts.every(t => t !== 'Текст скопирован для публикации'), JSON.stringify(env.__toasts));
}

// --- 3. selection copy fails: plain fallback must not be Markdown ---------
{
  const env = makeEnv({ nativeAvailable: false, execCommandFails: true, markdown: ARTICLE });
  env.copyRichHtml();
  check('plain fallback заполнен', env.__plainTa.value.length > 0, JSON.stringify(env.__plainTa.value));
  check('plain fallback без markdown-заголовка', !env.__plainTa.value.includes('# '), env.__plainTa.value);
  check('plain fallback без markdown-жирного', !env.__plainTa.value.includes('**'), env.__plainTa.value);
  check('plain fallback без markdown-ссылки', !env.__plainTa.value.includes(']('), env.__plainTa.value);
  check('plain fallback содержит текст статьи', env.__plainTa.value.includes('Первый абзац'), env.__plainTa.value);
  check('stage очищен даже при неудаче', env.__stage.innerHTML === '');
}

// --- 4. native bridge fails: degrade instead of breaking -----------------
{
  const env = makeEnv({ nativeAvailable: true, nativeFails: true, markdown: ARTICLE });
  env.copyRichHtml();
  check('при отказе моста есть браузерный запасной путь', env.__execCalls.length > 0, JSON.stringify(env.__execCalls));
  check('при отказе моста всё равно один тост', env.__toasts.length === 1, JSON.stringify(env.__toasts));
}

// --- 5. empty article ----------------------------------------------------
{
  const env = makeEnv({ nativeAvailable: true, markdown: '' });
  env.copyRichHtml();
  check('пустая статья не вызывает мост', env.__nativeCalls.length === 0);
  check('пустая статья сообщает пользователю', env.__toasts[0] === 'Текущая статья пустая', JSON.stringify(env.__toasts));
}

if (failures.length) {
  console.error('PUBLISH COPY: провалено проверок — ' + failures.length);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('Publish copy OK: ' + passed + ' проверок');