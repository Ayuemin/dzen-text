// Publication preflight.
//
// The whole point of this app is that the pasted result is accepted by the Dzen
// editor. Copying therefore runs a preflight: the rendered HTML is normalised
// into the subset Dzen can represent, and anything the author should know is
// reported before the text leaves the app. Errors block the copy instead of
// failing silently with a toast.

const PUBLISH_MAX_HEADING = 3;

// The Dzen editor offers controls for H1-H3, bold, italic, links, quotes and
// lists. Deeper headings, strikethrough, inline code and horizontal rules have
// no control, so pasting them produces unpredictable results. Keep the words,
// drop the markup.
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

// A Dzen article has one title in its own form field, so the "# " line is the
// title and everything after it is the body. Articles written without such a
// line simply have no title.
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

/**
 * Runs the preflight and returns {errors, warnings, html, plain}.
 * errors   - block publication; the Dzen editor could not represent the article
 * warnings - the author may still publish, but should look first
 */
function publishPreflight(markdown) {
  const src = String(markdown == null ? '' : markdown);
  const html = sanitizePublishHtml(buildPublishHtml(src));
  const plain = buildPublishPlain(html);
  const errors = [];
  const warnings = [];

  if (!html) errors.push('Статья пустая: нечего публиковать.');

  const title = publishTitleFrom(src);
  if (!title) {
    warnings.push('Нет строки «# Заголовок». В Дзене заголовок — отдельное поле, добавьте его первой строкой.');
  } else if (title.length > 200) {
    warnings.push('Заголовок очень длинный (' + title.length + ' символов). Проверьте, как он выглядит в Дзене.');
  }

  // H1 inside the body renders as a second title next to the form field.
  const extraTitles = publishHeadings(html).filter(h => h.level === 1);
  if (extraTitles.length) {
    errors.push('В теле статьи остался заголовок «# …»: в Дзене заголовок задаётся отдельным полем, а не в тексте.');
  }

  const plainWords = plain.trim() ? plain.trim().split(/\s+/).filter(Boolean).length : 0;
  if (html && plainWords < 30) {
    warnings.push('Текст очень короткий (' + plainWords + ' слов). Короткие статьи плохо ранжируются.');
  }

  // Markup with no Dzen control. The text survives sanitisation, so these are
  // advisory rather than blocking.
  if (/^#{4,6}\s/m.test(src)) {
    warnings.push('Заголовки H4–H6 понижены до H3: в Дзене глубже трёх уровней нет.');
  }
  if (/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/m.test(src)) {
    warnings.push('Разделители «---» убраны из публикации: в Дзене для этого есть отдельный элемент.');
  }
  if (/~~[^~]+~~/.test(src)) {
    warnings.push('Зачёркнутый текст публикуется обычным текстом: в Дзене зачёркивания нет.');
  }

  return { errors, warnings, html, plain };
}