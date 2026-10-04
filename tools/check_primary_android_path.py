#!/usr/bin/env python3
import re
from pathlib import Path

manifest = Path('app/src/main/AndroidManifest.xml').read_text(encoding='utf-8')
editor = Path('app/src/main/java/io/github/ayuemin/texteditor/EditorActivity.java').read_text(encoding='utf-8')
semantic = Path('app/src/main/java/io/github/ayuemin/texteditor/SemanticActivity.java').read_text(encoding='utf-8')
spelling = Path('app/src/main/java/io/github/ayuemin/texteditor/HunspellSpellingBridge.java').read_text(encoding='utf-8')
core = Path('app/src/main/assets/www/js/01-core.js').read_text(encoding='utf-8')
watchdog = Path('app/src/main/assets/www/js/22-spelling-watchdog.js').read_text(encoding='utf-8')

assert 'android:name=".EditorActivity"' in manifest, 'launcher must use EditorActivity'
assert 'class EditorActivity extends MainActivity' in editor, 'production EditorActivity must bypass SemanticActivity'
assert 'extends SemanticActivity' not in editor, 'production path still inherits experimental semantic activity'
assert '"AndroidDocumentRevision"' in editor, 'production path lost P0 revision bridge'
assert '"AndroidSpelling"' in editor, 'production path lost Hunspell bridge'
assert '"AndroidSpellingFile"' in editor, 'production path lost native personal dictionary picker'
assert 'REQUEST_OPEN_SPELLING_DICTIONARY' in editor, 'personal dictionary picker result path missing'
assert 'onNativeSpellingDictionaryLoaded' in editor, 'personal dictionary picker callback missing'
assert re.search(r'addJavascriptInterface\s*\([^;]*"AndroidSemanticModel"', editor, re.S) is None, 'experimental semantic bridge leaked into production activity'
assert 'class SemanticActivity extends MainActivity' in semantic, 'experimental semantic activity unexpectedly removed/reworked'
assert re.search(r'addJavascriptInterface\s*\([^;]*"AndroidSemanticModel"', semantic, re.S), 'experimental semantic bridge missing from SemanticActivity'

# SPELL04 performance/safety regression: product-like mixed-script tokens must be
# rejected before Hunspell suggestion generation. Post-processing them in JS is
# too late because native suggest() can be the expensive part.
assert 'isSafeRussianSpellToken(word)' in spelling, 'native spelling batch lost SPELL04 preflight'
assert 'word.matches(".*[A-Za-z].*")' in spelling, 'mixed Latin/Cyrillic tokens can still reach Hunspell'
assert 'word.matches(".*[0-9].*")' in spelling, 'number/model tokens can still reach Hunspell'
assert 'filtered' in spelling, 'spelling diagnostics lost native filtered-token count'

# A native regression must never leave the analysis sheet in an endless
# "checking" state. The watchdog cancels the logical request after 8 seconds.
assert "22-spelling-watchdog.js" in core, 'spelling watchdog is not loaded'
assert 'TIMEOUT_MS=8000' in watchdog, 'spelling watchdog timeout changed or missing'
assert "diagnostics.state='error'" in watchdog, 'spelling watchdog does not surface a terminal state'
assert "AndroidSpelling.cancel" in watchdog, 'spelling watchdog does not invalidate the stuck request'

print('Primary Android path is deterministic; spelling preflight/watchdog + native dictionary bridges are present; semantic NLI remains isolated')
