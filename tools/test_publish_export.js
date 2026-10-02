/**
 * Behavioural tests for the publication export path.
 *
 * tools/check_*.py assert on source substrings and cannot catch a conversion
 * bug. These tests load the real editor module in a minimal DOM shim, so they
 * exercise markdownToHtml/inline exactly as the WebView does, and assert the
 * guarantee the Dzen editor depends on: both clipboard flavours come from one
 * payload and never carry raw Markdown.
 *
 * Run: node tools/test_publish_export.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www', 'js');

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Mirrors how a browser renders our generated markup into text: block ends and
// <br> become newlines, everything else collapses to text.
function htmlToPlain(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|article)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const sandbox = {
  window: {},
  document: {
    createElement() {
      return {
        set innerHTML(v) { this._html = v; },
        get innerHTML() { return this._html; },
        get textContent() { return htmlToPlain(this._html); },
        get innerText() { return htmlToPlain(this._html); },
      };
    },
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(JS, '02-text-tools.js'), 'utf8'), sandbox, { filename: '02-text-tools.js' });

const {
  escapeHtml, escapeAttr, safeHttpUrl, inline,
  markdownToHtml, buildPublishHtml,
} = sandbox;

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

function eq(name, actual, expected) {
  check(name, actual === expected, 'получено ' + JSON.stringify(actual) + ', ожидалось ' + JSON.stringify(expected));
}

// --- escaping -------------------------------------------------------------
eq('escapeHtml экранирует кавычки', escapeHtml('a"b\'c'), 'a&quot;b&#39;c');
eq('escapeHtml экранирует амперсанд', escapeHtml('a&b'), 'a&amp;b');
eq('escapeAttr экранирует кавычки', escapeAttr('a"b'), 'a&quot;b');
eq('escapeHtml принимает не-строку', escapeHtml(null), '');

// --- URL safety -----------------------------------------------------------
eq('safeHttpUrl принимает https', safeHttpUrl('https://dzen.ru/a'), 'https://dzen.ru/a');
eq('safeHttpUrl отклоняет кавычку в URL', safeHttpUrl('https://a"onmouseover="x'), '');
eq('safeHttpUrl отклоняет пробел в URL', safeHttpUrl('https://a b'), '');
eq('safeHttpUrl отклоняет javascript:', safeHttpUrl('javascript:alert(1)'), '');

// --- inline: attribute injection must be impossible -----------------------
const injected = inline('[клик](https://a"onmouseover="alert(1))');
check('инъекция атрибута не создаёт onmouseover', !/onmouseover\s*=/.test(injected), injected);
check('javascript: не превращается в ссылку', !/<a\s/.test(inline('[клик](javascript:alert(1))')));
check('валидная ссылка сохраняется', /<a href="https:\/\/dzen\.ru\/a"/.test(inline('[клик](https://dzen.ru/a)')));

// --- markdownToHtml -------------------------------------------------------
check('H1 рендерится как h1', markdownToHtml('# Заголовок').includes('<h1>Заголовок</h1>'));
check('жирный рендерится как strong', markdownToHtml('**жирно**').includes('<strong>жирно</strong>'));
check('курсив рендерится как em', markdownToHtml('*курс*').includes('<em>курс</em>'));
check('список рендерится как ul/li', markdownToHtml('- один\n- два').includes('<ul>') && markdownToHtml('- один').includes('<li>один</li>'));
check('нумерованный список рендерится как ol', markdownToHtml('1. первый').includes('<ol>'));
check('цитата рендерится как blockquote', markdownToHtml('> цитата').includes('<blockquote>'));
check('разделитель рендерится как hr', markdownToHtml('---').includes('<hr>'));
check('HTML в тексте экранируется', !markdownToHtml('<script>alert(1)</script>').includes('<script>'));
eq('пустой текст даёт пустой HTML', markdownToHtml(''), '');
check('CRLF нормализуется', markdownToHtml('один\r\n\r\nдва').includes('<p>один</p>'));

// --- buildPublishHtml: заголовок не дублируется в тело --------------------
const article = '# Мой заголовок\n\nПервый абзац.\n\n## Подзаголовок\n\nВторой абзац.';
const pub = buildPublishHtml(article);
check('H1 заголовка не попадает в тело публикации', !pub.includes('<h1>'), pub);
check('подзаголовок H2 остаётся в теле', pub.includes('<h2>Подзаголовок</h2>'), pub);
check('абзацы публикации на месте', pub.includes('<p>Первый абзац.</p>') && pub.includes('<p>Второй абзац.</p>'), pub);
eq('пустая статья даёт пустой выход', buildPublishHtml(''), '');
check('BOM не ломает разбор заголовка', !buildPublishHtml('\uFEFF# Заголовок\n\nтело').includes('<h1>'));

// --- plain flavour --------------------------------------------------------
const plain = htmlToPlain(pub);
check('plain не содержит markdown-заголовка', !plain.includes('# '), plain);
check('plain не содержит markdown-жирного', !plain.includes('**'), plain);
check('plain содержит текст первого абзаца', plain.includes('Первый абзац.'), plain);
check('plain содержит текст подзаголовка', plain.includes('Подзаголовок'), plain);
check('plain не содержит HTML-тегов', !/<[a-z/]/i.test(plain), plain);

// --- the core guarantee: no raw Markdown may reach either flavour ---------
const markdownish = '## Подзаголовок\n\n- пункт один\n- пункт два\n\n**жирный** и *курсив* и [ссылка](https://dzen.ru/x)';
const outHtml = buildPublishHtml(markdownish);
const outPlain = htmlToPlain(outHtml);
for (const [flavour, value] of [['html', outHtml], ['plain', outPlain]]) {
  check(`${flavour}: нет сырого ##`, !/^#{1,6} /m.test(value), value);
  check(`${flavour}: нет сырой пары **`, !value.includes('**'), value);
  check(`${flavour}: нет маркера списка`, !/(^|\n)- /m.test(value), value);
  check(`${flavour}: нет markdown-ссылки`, !/\]\(/.test(value), value);
}

// --- output stays inside the tag whitelist the Dzen editor understands -----
const ALLOWED = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del',
  'code', 'a', 'ul', 'ol', 'li', 'blockquote', 'hr', 'br']);
const rich = markdownToHtml('# A\n\nтекст **жирный** *курс* ~~зачёркнутый~~ `код` [ссылка](https://dzen.ru)\n\n> цитата\n\n- один\n- два\n\n1. раз\n\n---');
const tags = [...rich.matchAll(/<\/?([a-z0-9]+)/gi)].map(m => m[1].toLowerCase());
const unexpectedTags = [...new Set(tags.filter(t => !ALLOWED.has(t)))];
check('в выходе нет неизвестных тегов', unexpectedTags.length === 0, 'найдены: ' + unexpectedTags.join(', '));

if (failures.length) {
  console.error('PUBLISH EXPORT: провалено проверок — ' + failures.length);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('Publish export OK: ' + passed + ' проверок');