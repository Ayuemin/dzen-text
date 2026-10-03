// Publication preflight.
//
// The whole point of this app is that the pasted result is accepted by the target
// editor. Copying therefore runs a preflight: the rendered HTML is normalised
// into a conservative subset, and anything the author should know is reported
// before the text leaves the app. Errors block the copy instead of failing silently.

const PUBLISH_MAX_HEADING = 3;

function sanitizePublishHtml(html) {
  let out = String(html == null ? '' : html);
  out = out.replace(/<h([4-6])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi, '<h3>$3</h3>');
  out = out.replace(/<(del|s|strike)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, '$3');
  out = out.replace(/<code(\s[^>]*)?>([\s\S]*?)<\/code>/gi, '$2');
  out = out.replace(/<hr(\s[^>]*)?>/gi, '');
  return out;
}

function stripHtmlTags(html) {
  return String(html == null ? '' : html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function publishTitleFrom(markdown) {
  const lines = String(markdown == null ? '' : markdown).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^#\s+(.*)$/);
    return m ? stripHtmlTags(m[1]) : '';
  }
  return '';
}

function publishHeadings(html) {
  const out = [];
  const re = /<h([1-6])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const text = stripHtmlTags(m[2]);
    if (text) out.push({ level: Number(m[1]), text });
  }
  return out;
}

function publishPreflight(markdown) {
  const src = String(markdown == null ? '' : markdown);
  const html = sanitizePublishHtml(buildPublishHtml(src));
  const plain = buildPublishPlain(html);
  const errors = [];
  const warnings = [];

  if (!html) errors.push('Статья пустая: нечего публиковать.');

  const title = publishTitleFrom(src);
  if (!title) {
    warnings.push('Не определён заголовок статьи. Проверьте первую строку перед публикацией.');
  } else if (title.length > 200) {
    warnings.push('Заголовок очень длинный (' + title.length + ' символов). Проверьте, как он выглядит при публикации.');
  }

  const extraTitles = publishHeadings(html).filter(h => h.level === 1);
  if (extraTitles.length) {
    errors.push('В теле статьи остался второй заголовок H1. Если заголовок публикуется отдельным полем, оставьте в статье только один заголовок.');
  }

  const plainWords = plain.trim() ? plain.trim().split(/\s+/).filter(Boolean).length : 0;
  if (html && plainWords < 30) {
    warnings.push('Текст очень короткий (' + plainWords + ' слов). Проверьте, достаточно ли материала для публикации.');
  }

  if (/^#{4,6}\s/m.test(src)) {
    warnings.push('Заголовки H4–H6 при копировании понижаются до H3.');
  }
  if (/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/m.test(src)) {
    warnings.push('Горизонтальные разделители при копировании убираются.');
  }
  if (/~~[^~]+~~/.test(src)) {
    warnings.push('Зачёркнутый текст копируется обычным текстом.');
  }

  return { errors, warnings, html, plain };
}

function p0PublicationPayload(markdown, mode) {
  const src = String(markdown == null ? '' : markdown);
  const parts = (typeof P0Core !== 'undefined' && P0Core.publicationParts)
    ? P0Core.publicationParts(src)
    : { title: publishTitleFrom(src), body: src, titleMode: 'legacy' };
  const canonical = parts.title ? '# ' + parts.title + '\n\n' + parts.body : parts.body;
  const checked = publishPreflight(canonical);
  const composed = (typeof P0Core !== 'undefined' && P0Core.composePublication)
    ? P0Core.composePublication(parts.title, checked.html, checked.plain, mode)
    : { html: checked.html, plain: checked.plain };
  return {
    errors: checked.errors,
    warnings: checked.warnings,
    title: parts.title,
    titleMode: parts.titleMode,
    bodyHtml: checked.html,
    bodyPlain: checked.plain,
    html: composed.html,
    plain: composed.plain,
    mode: mode === 'title' || mode === 'body' ? mode : 'all'
  };
}

async function copyPublicationMode(mode) {
  const result = p0PublicationPayload(editor.value, mode);
  if (mode === 'title' && !result.title) {
    toast('Заголовок статьи не определён');
    return;
  }
  if (mode !== 'title' && result.errors.length) {
    await appConfirm('Нельзя скопировать для публикации', result.errors.join('\n\n'), 'Понятно', true);
    return;
  }
  if (mode !== 'title' && result.warnings.length) {
    const ok = await appConfirm(
      'Проверьте перед публикацией',
      result.warnings.join('\n\n') + '\n\nВсё равно скопировать?',
      'Скопировать', false
    );
    if (!ok) return;
  }
  copyRichPayload(result);
}

function copyPublicationAll() { return copyPublicationMode('all'); }
function copyPublicationBody() { return copyPublicationMode('body'); }
function copyPublicationTitle() { return copyPublicationMode('title'); }

window.copyPublicationAll = copyPublicationAll;
window.copyPublicationBody = copyPublicationBody;
window.copyPublicationTitle = copyPublicationTitle;
window.copyRichHtml = copyPublicationAll;

function installPublicationCopyUi() {
  const drawer = document.querySelector('.drawerActions');
  if (drawer && !drawer.querySelector('[data-copy-title]')) {
    const old = Array.from(drawer.querySelectorAll('button')).find(function(button) {
      return /drawerCopyForPublication/.test(button.getAttribute('onclick') || '');
    });
    if (old) {
      old.textContent = 'Скопировать всё';
      old.setAttribute('onclick', 'copyPublicationAll()');
      const title = document.createElement('button');
      title.type = 'button';
      title.dataset.copyTitle = '1';
      title.textContent = 'Скопировать заголовок';
      title.onclick = copyPublicationTitle;
      const body = document.createElement('button');
      body.type = 'button';
      body.dataset.copyBody = '1';
      body.textContent = 'Скопировать текст';
      body.onclick = copyPublicationBody;
      old.insertAdjacentElement('afterend', body);
      old.insertAdjacentElement('afterend', title);
    }
  }
  const topCopy = document.querySelector('.tab[onclick="copyRichHtml()"]');
  if (topCopy) {
    topCopy.title = 'Копировать всё';
    topCopy.setAttribute('aria-label', 'Копировать заголовок и текст');
  }
}
setTimeout(installPublicationCopyUi, 0);

function sanitizeImportedHtmlSource(html) {
  let src = String(html == null ? '' : html);
  src = src.replace(/<!--([\s\S]*?)-->/g, '');
  src = src.replace(/<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  src = src.replace(/<(script|style|iframe|object|embed|link|meta|base|source|video|audio)\b[^>]*\/?>/gi, '');
  src = src.replace(/<img\b([^>]*)>/gi, function(_, attrs) {
    const alt = String(attrs || '').match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const text = alt ? (alt[1] || alt[2] || alt[3] || '') : '';
    return text ? String(text).replace(/[<>]/g, '') : '';
  });
  src = src.replace(/\s(?:on[a-z]+|src|srcset|poster|background)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  src = src.replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return src;
}

if (typeof htmlToEditableText === 'function') {
  const unsafeHtmlToEditableText = htmlToEditableText;
  htmlToEditableText = function(html) {
    return unsafeHtmlToEditableText(sanitizeImportedHtmlSource(html));
  };
  window.htmlToEditableText = htmlToEditableText;
}
window.sanitizeImportedHtmlSource = sanitizeImportedHtmlSource;
