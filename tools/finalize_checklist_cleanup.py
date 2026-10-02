from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / 'app/src/main/assets/www'
JS = WWW / 'js'


def must_replace(text, old, new, label, count=1):
    n = text.count(old)
    if n != count:
        raise SystemExit(f'{label}: expected {count} occurrence(s), found {n}')
    return text.replace(old, new, count)


def remove_details_containing(html, marker):
    pos = html.find(marker)
    if pos < 0:
        raise SystemExit(f'missing settings marker: {marker}')
    start = html.rfind('    <details class="settingsGroup">', 0, pos)
    if start < 0:
        raise SystemExit(f'cannot find settings group start for {marker}')
    end = html.find('    </details>', pos)
    if end < 0:
        raise SystemExit(f'cannot find settings group end for {marker}')
    end += len('    </details>')
    while end < len(html) and html[end] in '\r\n':
        end += 1
    return html[:start] + html[end:]


def function_span(text, name):
    m = re.search(r'(?m)^(?:async\s+)?function\s+' + re.escape(name) + r'\s*\(', text)
    if not m:
        raise SystemExit(f'missing function {name}')
    brace = text.find('{', m.start())
    depth = 0
    end = None
    quote = None
    escape = False
    line_comment = False
    block_comment = False
    i = brace
    while i < len(text):
        ch = text[i]
        nx = text[i + 1] if i + 1 < len(text) else ''
        if line_comment:
            if ch == '\n':
                line_comment = False
        elif block_comment:
            if ch == '*' and nx == '/':
                block_comment = False
                i += 1
        elif quote:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == quote:
                quote = None
        else:
            if ch == '/' and nx == '/':
                line_comment = True
                i += 1
            elif ch == '/' and nx == '*':
                block_comment = True
                i += 1
            elif ch in "'\"`":
                quote = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        i += 1
    if end is None:
        raise SystemExit(f'unbalanced function {name}')
    return m.start(), end


def remove_function(text, name):
    start, end = function_span(text, name)
    while end < len(text) and text[end] in '\r\n':
        end += 1
    return text[:start] + text[end:]


def replace_function(text, name, replacement):
    start, end = function_span(text, name)
    return text[:start] + replacement.rstrip() + text[end:]


def remove_assigned_function(text, name):
    marker = name + '=function('
    start = text.find(marker)
    if start < 0:
        raise SystemExit(f'missing assigned function {name}')
    line_start = text.rfind('\n', 0, start) + 1
    brace = text.find('{', start)
    depth = 0
    quote = None
    escape = False
    end = None
    i = brace
    while i < len(text):
        ch = text[i]
        if quote:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == quote:
                quote = None
        else:
            if ch in "'\"`":
                quote = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        i += 1
    if end is None:
        raise SystemExit(f'unbalanced assigned function {name}')
    if text[end:end + 1] == ';':
        end += 1
    while end < len(text) and text[end] in '\r\n':
        end += 1
    return text[:line_start] + text[end:]


def remove_object_entry(text, key):
    marker = '\n  ' + key + ':{'
    start = text.find(marker)
    if start < 0:
        raise SystemExit(f'missing object entry {key}')
    brace = text.find('{', start)
    depth = 0
    quote = None
    escape = False
    i = brace
    end = None
    while i < len(text):
        ch = text[i]
        if quote:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == quote:
                quote = None
        else:
            if ch in "'\"`":
                quote = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        i += 1
    if end is None:
        raise SystemExit(f'unbalanced object entry {key}')
    if text[end:end + 1] == ',':
        end += 1
    if text[end:end + 1] == '\n':
        end += 1
    return text[:start] + '\n' + text[end:]


# index.html: physically remove obsolete toolbar/mode controls.
p = WWW / 'index.html'
html = p.read_text(encoding='utf-8')
html = must_replace(html, '<title>Дзен Текст 1.10.3</title>', '<title>Дзен Текст 1.10.6</title>', 'html title')
html, n = re.subn(r'\n  <div class="markdownToolbar" id="markdownToolbar" aria-label="Панель Markdown">.*?\n  </div>\n  <footer class="bottom">', '\n  <footer class="bottom">', html, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f'markdown toolbar block: expected 1, found {n}')
html = remove_details_containing(html, 'id="markdownToolbarSwitch"')
html = remove_details_containing(html, 'id="dzenCheckMode"')
html, n = re.subn(r'\n\s*<button class="gear checkAction" id="checkBtn"[^\n]*</button>', '', html, count=1)
if n != 1:
    raise SystemExit(f'old bottom check button: expected 1, found {n}')
html = must_replace(html, '<button type="button" onclick="drawerCheck()">Проверить текст</button>', '<button type="button" id="drawerAiCheckBtn" onclick="drawerCheck()">AI-проверка текста</button>', 'drawer AI button')
html = must_replace(html, '<button class="analysisDot" id="analysisDot" onclick="openAnalysis()" aria-label="Редакторский анализ"><span></span></button>', '<button class="analysisDot" id="analysisDot" onclick="openAnalysis()" aria-label="Открыть результаты проверки" title="Открыть результаты проверки"><span></span></button>', 'analysis dot')
html = html.replace('aria-label="Копировать HTML" title="Копировать HTML"', 'aria-label="Скопировать для публикации" title="Скопировать для публикации"', 1)
html = must_replace(html, '<summary><span>Локальная проверка Дзена</span><small>Правила и обновляемая локальная база</small></summary>', '<summary><span>Правила Дзена</span><small>Автоматическая проверка и обновляемая база правил</small></summary>', 'dzen rules title')
html, n = re.subn(r'\n\s*<div class="switchRow"><span class="labelWithHint">Проверять правила Дзена локально .*?id="dzenCheck".*?</div>', '', html, count=1)
if n != 1:
    raise SystemExit(f'dzenCheck row: expected 1, found {n}')
html = html.replace('Использовать обновляемую локальную базу', 'Использовать обновляемую базу правил')
html = html.replace('Работает без внешней AI-модели. Статья остаётся на устройстве; обновляется только компактная база правил.', 'Правила проверяются автоматически на устройстве. При обновлении загружается только компактная база правил; статья во внешнюю AI-модель не отправляется.')
html = html.replace('>Обновить локальную базу</button>', '>Обновить базу правил</button>')
html = html.replace('>Вернуть встроенные</button>', '>Вернуть встроенные правила</button>')
html = must_replace(html, '<summary><span>AI-проверка Дзена</span><small>API, модель, база знаний и стиль</small></summary>', '<summary><span>AI-проверка текста</span><small>API, модель, база знаний Дзена и дополнительные критерии</small></summary>', 'AI settings title')
html = html.replace('Онлайн-проверка выполняется только после нажатия кнопки проверки. При наборе текст наружу не отправляется.', 'Онлайн-орфография запускается только вместе с ручной AI-проверкой текста. При обычном наборе текст наружу не отправляется.')
html = must_replace(html, '<script src="js/12-markdown-toolbar.js"></script>', '<script src="js/12-workflow-policy.js"></script>', 'workflow script')
p.write_text(html, encoding='utf-8')

# core: retire mode and toolbar settings.
p = JS / '01-core.js'
core = p.read_text(encoding='utf-8')
core = must_replace(core, ',markdownToolbar:true', '', 'markdown setting default')
core = must_replace(core, ',dzenCheck:true', '', 'local dzen toggle default')
core = must_replace(core, ",dzenCheckMode:'local'", '', 'check mode default')
for fn in ['normalizeDzenCheckMode', 'currentCheckMode', 'checkModeUsesLocal', 'checkModeUsesAi']:
    core = remove_function(core, fn)
core = replace_function(core, 'updateDzenRulesStatus', """function updateDzenRulesStatus(){
  const el=document.getElementById('dzenRulesStatus');
  if(!el)return;
  const enabled=settings.dzenSmartRules!==false,r=activeDzenRules();
  el.innerHTML='База правил: <b>'+(enabled?'обновляемая':'встроенная')+'</b><br>Версия: <b>'+escapeHtml(String(r.version||'встроенная'))+'</b><br>Источник: официальная справка Дзена · проверен '+escapeHtml(String(r.source_checked||'—'));
}""")
core = core.replace('Обновляемая ИИ-база отключена в настройках', 'Обновляемая база правил отключена в настройках')
core = core.replace('Проверяю обновление умной базы…', 'Проверяю обновление базы правил…')
p.write_text(core, encoding='utf-8')

# analysis: local always, retained AI layered on top.
p = JS / '05-analysis-state.js'
a = p.read_text(encoding='utf-8')
a = must_replace(a, "function setCheckRunning(v){const b=document.getElementById('checkBtn');if(!b)return;b.classList.toggle('running',!!v);b.setAttribute('aria-busy',v?'true':'false')}", "function setCheckRunning(v){const b=document.getElementById('drawerAiCheckBtn');if(!b)return;b.classList.toggle('running',!!v);b.setAttribute('aria-busy',v?'true':'false');b.disabled=!!v}", 'running button')
a = must_replace(a, " const localEnabled=checkModeUsesLocal();\n const aiEnabled=checkModeUsesAi();\n\n if(localEnabled){\n", '', 'local mode gate')
a = must_replace(a, "\n }\n\n if(aiEnabled&&typeof aiDzenSource", "\n\n if(typeof aiDzenSource", 'AI mode gate')
a = must_replace(a, "   if(settings.dzenCheck)analyzeDzenRules(src,headings,issues);", "   analyzeDzenRules(src,headings,issues);", 'always dzen rules')
a = must_replace(a, ',metrics,issueOverflow,overflowTotal,checkMode:currentCheckMode()};', ',metrics,issueOverflow,overflowTotal};', 'analysis mode metadata')
p.write_text(a, encoding='utf-8')

# navigation: unified findings.
p = JS / '08-navigation.js'
nav = p.read_text(encoding='utf-8')
nav = must_replace(nav, "const same=currentCheckMode()==='both'?currentAnalysis.issues.filter(x=>x.type===issue.type):currentAnalysis.issues.filter(x=>x.type===issue.type&&!!x.ai===!!issue.ai);", "const same=currentAnalysis.issues.filter(x=>x.type===issue.type);", 'unified issue navigation')
p.write_text(nav, encoding='utf-8')

# editor: remove Markdown visibility hook and use natural native payload order.
p = JS / '09-editor.js'
ed = p.read_text(encoding='utf-8')
ed = ed.replace("  if(typeof updateMarkdownToolbarVisibility==='function')setTimeout(updateMarkdownToolbarVisibility,20);\n", '')
ed = must_replace(ed, "      // MainActivity 1.10.6 constructed ClipData.Item as (firstArg, secondArg).\n      // Android interprets those fields as (plainText, htmlText), so pass the\n      // payload in platform order until the native bridge itself is migrated.\n      ok=!!AndroidPublish.copyForPublication(payload.plain,payload.html);", "      ok=!!AndroidPublish.copyForPublication(payload.html,payload.plain);", 'publication bridge order')
p.write_text(ed, encoding='utf-8')

# settings: remove retired fields and schedule analysis after rule changes.
p = JS / '10-settings.js'
st = p.read_text(encoding='utf-8')
st = must_replace(st, 'markdownToolbarSwitch.checked=settings.markdownToolbar!==false;', '', 'markdown settings sync')
st = must_replace(st, 'dzenCheck.checked=settings.dzenCheck;', '', 'dzen toggle sync')
st = must_replace(st, '    markdownToolbar:markdownToolbarSwitch.checked,\n', '', 'markdown settings apply')
st = must_replace(st, '    dzenCheck:dzenCheck.checked,\n', '', 'dzen toggle apply')
st = must_replace(st, "    dzenCheckMode:normalizeDzenCheckMode(document.getElementById('dzenCheckMode')?.value),\n", '', 'mode apply')
st = must_replace(st, '  render(false,false);', '  render(true,false);', 'settings schedule analysis')
st = st.replace("  if(typeof updateMarkdownToolbarVisibility==='function')updateMarkdownToolbarVisibility();\n", '')
p.write_text(st, encoding='utf-8')

# AI settings: remove mode selector support.
p = JS / '10-ai-dzen.js'
ai = p.read_text(encoding='utf-8')
ai = ai.replace("  if(!checkModeUsesAi())return '';\n", '')
ai = ai.replace("  const mode=document.getElementById('dzenCheckMode');\n", '')
ai = ai.replace("  if(mode)mode.value=normalizeDzenCheckMode(settings.dzenCheckMode);\n", '')
ai = remove_function(ai, 'onDzenCheckModeChanged')
p.write_text(ai, encoding='utf-8')

# hints: remove retired concepts and mode-based export wording.
p = JS / '12-dialogs.js'
dlg = p.read_text(encoding='utf-8')
for key in ['markdownToolbar', 'dzenCheck', 'mode', 'exportIssues', 'aiExportIssues']:
    dlg = remove_object_entry(dlg, key)
dlg = dlg.replace('AI-проверке Дзена', 'AI-проверке текста')
dlg = dlg.replace('При включении текст отправляется в Яндекс.Спеллер только после ручного запуска проверки.', 'При включении текст отправляется в Яндекс.Спеллер только вместе с ручной AI-проверкой текста.')
old_current = "text:'Содержимое зависит от выбранного общего режима. В «Локальной» выгружаются только локальные замечания, в «AI» — только замечания модели, а в «Обе» — единый отчёт с пометкой, откуда пришло каждое замечание.'"
new_current = "text:'Содержит текущие локальные замечания и ещё актуальные замечания последней ручной AI-проверки. Технические пометки об источнике у отдельных пунктов не добавляются.'"
dlg = must_replace(dlg, old_current, new_current, 'current report hint')
p.write_text(dlg, encoding='utf-8')

# Turn the former toolbar file into a dedicated workflow/session module.
old = JS / '12-markdown-toolbar.js'
wf = old.read_text(encoding='utf-8')
wf = re.sub(r'^/\*[\s\S]*?\*/\n', '/* Retained AI-session policy and document-boundary resets. */\n', wf, count=1)
wf = wf.replace('function applyMarkdown(){return false}\n\n', '')
wf = wf.replace("  // Local analysis is always active. AI is an additional manual layer, not a\n  // user-selectable replacement for local checks.\n  normalizeDzenCheckMode=function(){return 'both'};\n  currentCheckMode=function(){return 'both'};\n  checkModeUsesLocal=function(){return true};\n  checkModeUsesAi=function(){return true};\n\n", '')
wf = remove_assigned_function(wf, 'updateMarkdownToolbarVisibility')
wf = remove_function(wf, 'hideSettingsGroupFor')
wf = remove_function(wf, 'applyWorkflowUiPolicy')
wf = wf.replace('  applyWorkflowUiPolicy();\n  setTimeout(applyWorkflowUiPolicy,0);\n', '')
if 'markdownToolbar' in wf or 'dzenCheckMode' in wf or 'applyMarkdown' in wf:
    raise SystemExit('retired Markdown/mode references remained in workflow policy')
(JS / '12-workflow-policy.js').write_text(wf, encoding='utf-8')
old.unlink()

# Native clipboard: correct Item(text, htmlText) and wait for the actual write.
p = ROOT / 'app/src/main/java/ru/dzenprep/texteditor/MainActivity.java'
java = p.read_text(encoding='utf-8')
java = must_replace(java, 'import android.os.Build;\n', 'import android.os.Build;\nimport android.os.Looper;\n', 'Looper import')
java = must_replace(java, 'import java.util.Iterator;\n', 'import java.util.Iterator;\nimport java.util.concurrent.CountDownLatch;\nimport java.util.concurrent.TimeUnit;\nimport java.util.concurrent.atomic.AtomicBoolean;\n', 'concurrency imports')
marker = '        public boolean copyForPublication(final String html, final String plain) {'
start = java.find(marker)
if start < 0:
    raise SystemExit('PublishBridge method not found')
brace = java.find('{', start)
depth = 0
end = None
for i in range(brace, len(java)):
    if java[i] == '{':
        depth += 1
    elif java[i] == '}':
        depth -= 1
        if depth == 0:
            end = i + 1
            break
if end is None:
    raise SystemExit('PublishBridge method braces unbalanced')
native_method = '''        public boolean copyForPublication(final String html, final String plain) {
            final String htmlValue = html == null ? "" : html;
            final String plainValue = plain == null ? "" : plain;
            if (htmlValue.trim().isEmpty() && plainValue.trim().isEmpty()) return false;

            if (Looper.myLooper() == Looper.getMainLooper()) {
                return writePublicationClipboard(htmlValue, plainValue);
            }

            final AtomicBoolean copied = new AtomicBoolean(false);
            final CountDownLatch done = new CountDownLatch(1);
            runOnUiThread(() -> {
                try {
                    copied.set(writePublicationClipboard(htmlValue, plainValue));
                } finally {
                    done.countDown();
                }
            });
            try {
                return done.await(2500, TimeUnit.MILLISECONDS) && copied.get();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }

        private boolean writePublicationClipboard(String htmlValue, String plainValue) {
            try {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (clipboard == null) return false;
                ClipDescription description = new ClipDescription("Дзен Текст",
                        new String[] { ClipDescription.MIMETYPE_TEXT_PLAIN, ClipDescription.MIMETYPE_TEXT_HTML });
                ClipData clip = new ClipData(description, new ClipData.Item(plainValue, htmlValue));
                clip.addItem(new ClipData.Item(plainValue));
                clipboard.setPrimaryClip(clip);
                return true;
            } catch (Exception e) {
                return false;
            }
        }'''
java = java[:start] + native_method + java[end:]
p.write_text(java, encoding='utf-8')

# Regression tests.
p = ROOT / 'tools/test_publish_copy.js'
t = p.read_text(encoding='utf-8')
t = t.replace('The Android 1.10.6 bridge historically names its arguments html/plain but\n * passes them into ClipData.Item(text, htmlText). JavaScript therefore calls\n * the bridge in Android platform order: plain first, HTML second.\n', 'The Android bridge accepts (html, plain) and writes ClipData.Item(plain, html),\n * so JavaScript keeps the natural payload order while Android exposes both flavours.\n')
t = must_replace(t, '      copyForPublication(plain, html) {\n        nativeCalls.push({ html, plain });', '      copyForPublication(html, plain) {\n        nativeCalls.push({ html, plain });', 'publish test native signature')
t = t.replace("check('plain действительно передан первым аргументом Android-моста',", "check('Android-мост получает HTML и plain в естественном порядке',")
p.write_text(t, encoding='utf-8')

p = ROOT / 'tools/test_ai_dzen_flow.js'
t = p.read_text(encoding='utf-8')
t = must_replace(t, "  '12-articles.js', '12-history.js', '12-markdown-toolbar.js', '12-publish.js',", "  '12-articles.js', '12-history.js', '12-workflow-policy.js', '12-publish.js',", 'AI harness workflow module')
p.write_text(t, encoding='utf-8')

p = ROOT / 'tools/check_editor_invariants.py'
inv = p.read_text(encoding='utf-8')
start_marker = '# Current product policy: the Markdown toolbar is temporarily disabled because it'
end_marker = "if 'placeholder=\"Начните писать…\"' not in html:"
s = inv.find(start_marker)
e = inv.find(end_marker)
if s < 0 or e < 0 or e <= s:
    raise SystemExit('invariant policy block markers not found')
new_block = '''# Current product policy: the old toolbar and mode selector are removed from
# source, not merely hidden. Undo/redo history remains implemented separately.
workflow_path = JS / "12-workflow-policy.js"
if "markdownToolbar" in html or "markdownToolbarSwitch" in html:
    errors.append("obsolete Markdown toolbar UI must be removed from HTML")
if (JS / "12-markdown-toolbar.js").exists() or "js/12-markdown-toolbar.js" in html:
    errors.append("obsolete Markdown toolbar script must be removed")
if not workflow_path.exists() or "js/12-workflow-policy.js" not in html:
    errors.append("retained AI-session workflow module is missing")
if "dzenCheckMode" in html:
    errors.append("obsolete local/AI/both selector must be removed from HTML")
if "id=\\\"dzenCheck\\\"" in html:
    errors.append("local Dzen checks must no longer have an off switch")
if "id=\\\"checkBtn\\\"" in html:
    errors.append("old bottom manual-check button must be removed")
if "id=\\\"drawerAiCheckBtn\\\"" not in html or ">AI-проверка текста</button>" not in html:
    errors.append("sidebar must expose the single manual AI-check command")

workflow = workflow_path.read_text(encoding="utf-8") if workflow_path.exists() else ""
editor_js = (JS / "09-editor.js").read_text(encoding="utf-8")
bootstrap = (JS / "12-bootstrap.js").read_text(encoding="utf-8")
analysis_state = (JS / "05-analysis-state.js").read_text(encoding="utf-8")
settings_js = (JS / "10-settings.js").read_text(encoding="utf-8")
ai_js = (JS / "10-ai-dzen.js").read_text(encoding="utf-8")
core_js = (JS / "01-core.js").read_text(encoding="utf-8")

for retired in ("markdownToolbarSwitch", "settings.markdownToolbar", "dzenCheckMode", "normalizeDzenCheckMode", "checkModeUsesLocal", "checkModeUsesAi"):
    if retired in core_js + settings_js + ai_js + analysis_state + workflow:
        errors.append("retired check/Markdown concept remains in active JS: " + retired)

if "scheduleAnalysis()" not in analysis_state:
    errors.append("ordinary edits must schedule the local analysis pass")
if "startAiDzenArticleCheck" in bootstrap:
    errors.append("ordinary input/bootstrap code must never start external AI")
if "startAiDzenArticleCheck(String(src||editor.value||''))" not in (JS / "07-spelling.js").read_text(encoding="utf-8"):
    errors.append("manual full-check command must still be able to start AI")
if "aiDzenSessionIssues" not in workflow or "remapAiDzenIssues" not in workflow:
    errors.append("retained AI-session remapping is missing")
if "без технических пометок об источнике" not in (JS / "06-analysis-report.js").read_text(encoding="utf-8"):
    errors.append("unified analysis report description is missing")

if "copyForPublication(payload.html,payload.plain)" not in editor_js:
    errors.append("publication JS bridge must pass HTML then plain text")
if "new ClipData.Item(plainValue, htmlValue)" not in main_activity:
    errors.append("Android clipboard item must map plain text before HTML")
if "CountDownLatch" not in main_activity or "done.await(" not in main_activity or "copied.get()" not in main_activity:
    errors.append("PublishBridge success must wait for the actual clipboard write")
if "setPrimaryClip" not in main_activity:
    errors.append("publication copy must write through Android ClipboardManager")

history_js = (JS / "12-history.js").read_text(encoding="utf-8")
if "function undoEdit" not in history_js or "function redoEdit" not in history_js:
    errors.append("removing the Markdown toolbar must not remove undo/redo history mechanisms")

'''
inv = inv[:s] + new_block + inv[e:]
p.write_text(inv, encoding='utf-8')

# Physical absence checks before tests.
final_html = (WWW / 'index.html').read_text(encoding='utf-8')
joined_js = '\n'.join(x.read_text(encoding='utf-8') for x in JS.glob('*.js'))
for retired in ['markdownToolbarSwitch', 'dzenCheckMode']:
    if retired in final_html or retired in joined_js:
        raise SystemExit(f'retired source marker still present: {retired}')
if (JS / '12-markdown-toolbar.js').exists():
    raise SystemExit('obsolete markdown toolbar script still exists')

print('Final checklist cleanup applied')
