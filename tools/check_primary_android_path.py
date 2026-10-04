#!/usr/bin/env python3
import re
from pathlib import Path

manifest = Path('app/src/main/AndroidManifest.xml').read_text(encoding='utf-8')
editor = Path('app/src/main/java/io/github/ayuemin/texteditor/EditorActivity.java').read_text(encoding='utf-8')
semantic = Path('app/src/main/java/io/github/ayuemin/texteditor/SemanticActivity.java').read_text(encoding='utf-8')
spelling = Path('app/src/main/java/io/github/ayuemin/texteditor/HunspellSpellingBridge.java').read_text(encoding='utf-8')
spelling_ui = Path('app/src/main/assets/www/js/19-spelling-hunspell.js').read_text(encoding='utf-8')
core = Path('app/src/main/assets/www/js/01-core.js').read_text(encoding='utf-8')
watchdog = Path('app/src/main/assets/www/js/22-spelling-watchdog.js').read_text(encoding='utf-8')
diagnostics = Path('app/src/main/assets/www/js/23-diagnostics.js').read_text(encoding='utf-8')

assert 'android:name=".EditorActivity"' in manifest, 'launcher must use EditorActivity'
assert 'class EditorActivity extends MainActivity' in editor, 'production EditorActivity must bypass SemanticActivity'
assert 'extends SemanticActivity' not in editor, 'production path still inherits experimental semantic activity'
assert '"AndroidDocumentRevision"' in editor, 'production path lost P0 revision bridge'
assert '"AndroidSpelling"' in editor, 'production path lost Hunspell bridge'
assert '"AndroidSpellingFile"' in editor, 'production path lost native personal dictionary picker'
assert '"AndroidDiagnostics"' in editor, 'production path lost diagnostic log bridge'
assert 'DevLog.read()' in editor and 'DevLog.clear()' in editor, 'diagnostic log cannot be retrieved/cleared from production app'
assert 'REQUEST_OPEN_SPELLING_DICTIONARY' in editor, 'personal dictionary picker result path missing'
assert 'onNativeSpellingDictionaryLoaded' in editor, 'personal dictionary picker callback missing'
assert re.search(r'addJavascriptInterface\s*\([^;]*"AndroidSemanticModel"', editor, re.S) is None, 'experimental semantic bridge leaked into production activity'
assert 'class SemanticActivity extends MainActivity' in semantic, 'experimental semantic activity unexpectedly removed/reworked'
assert re.search(r'addJavascriptInterface\s*\([^;]*"AndroidSemanticModel"', semantic, re.S), 'experimental semantic bridge missing from SemanticActivity'

# SPELL04 performance/safety regression: product-like mixed-script tokens must be
# rejected before Hunspell. The critical document batch is membership-only;
# suggest() is intentionally outside this path while its latency is investigated.
assert 'isSafeRussianSpellToken(word)' in spelling, 'native spelling batch lost SPELL04 preflight'
assert 'word.matches(".*[A-Za-z].*")' in spelling, 'mixed Latin/Cyrillic tokens can still reach Hunspell'
assert 'word.matches(".*[0-9].*")' in spelling, 'number/model tokens can still reach Hunspell'
assert 'filtered' in spelling, 'spelling diagnostics lost native filtered-token count'
run_batch = spelling.split('private void runBatch', 1)[1].split('private void startBatchWatchdog', 1)[0]
assert '.suggestions(' not in run_batch, 'Hunspell suggest() leaked back into critical document batch'
assert 'SPELL-WORD' in spelling and 'SPELL-WATCH' in spelling, 'per-word/stall tracing is missing'
assert 'DevLog.stackSummary(workerThread)' in spelling, 'stalled Hunspell worker stack is not captured'
assert 'evaluateJavascript result:' in spelling, 'native-to-JS callback delivery result is not logged'

# addIssue() creates issues._overflow with Object.defineProperty and therefore a
# non-writable property reference. The spelling callback must mutate that object
# instead of assigning a replacement, otherwise strict-mode WebView throws and
# leaves spellingDiagnostics forever in "checking".
assert 'currentAnalysis.issues._overflow=overflow' not in spelling_ui, 'spelling clear path reassigns non-writable issues._overflow'
assert 'issues._overflow=overflow' not in spelling_ui, 'spelling callback reassigns non-writable issues._overflow'
assert "Object.defineProperty(issues,'_overflow'" in spelling_ui, 'spelling callback cannot initialize a missing overflow container safely'
assert 'delete nativeOverflow.spelling' in spelling_ui, 'spelling callback no longer mutates existing overflow container'

# A native regression must never leave the analysis sheet in an endless
# "checking" state. The watchdog cancels the logical request after 8 seconds.
assert "22-spelling-watchdog.js" in core, 'spelling watchdog is not loaded'
assert 'TIMEOUT_MS=8000' in watchdog, 'spelling watchdog timeout changed or missing'
assert "diagnostics.state='error'" in watchdog, 'spelling watchdog does not surface a terminal state'
assert "AndroidSpelling.cancel" in watchdog, 'spelling watchdog does not invalidate the stuck request'

# The physical-device test must be self-diagnosing without adb. Keep one owner
# for each native callback: the diagnostics module only emits state heartbeats
# and exposes copy/clear controls, while the bridge logs callback delivery.
assert "23-diagnostics.js" in core, 'diagnostics UI module is not loaded'
assert 'copyDiagnosticLog' in diagnostics and 'clearDiagnosticLog' in diagnostics, 'diagnostic log controls missing'
assert 'checking heartbeat' in diagnostics, 'JS spelling heartbeat tracing missing'
assert 'AndroidPublish.copyForPublication' in diagnostics, 'diagnostic log cannot be copied from the app'
assert 'onNativeSpellingBatch=' not in diagnostics, 'diagnostics must not become a second native batch callback owner'
assert 'onNativeSpellingReady=' not in diagnostics, 'diagnostics must not become a second native ready callback owner'

print('Primary Android path is deterministic; spelling preflight/watchdog/diagnostics + overflow-safe callback + native dictionary bridges are present; semantic NLI remains isolated')
