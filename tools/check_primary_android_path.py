#!/usr/bin/env python3
import re
from pathlib import Path

manifest = Path('app/src/main/AndroidManifest.xml').read_text(encoding='utf-8')
editor = Path('app/src/main/java/io/github/ayuemin/texteditor/EditorActivity.java').read_text(encoding='utf-8')
semantic = Path('app/src/main/java/io/github/ayuemin/texteditor/SemanticActivity.java').read_text(encoding='utf-8')

assert 'android:name=".EditorActivity"' in manifest, 'launcher must use EditorActivity'
assert 'class EditorActivity extends MainActivity' in editor, 'production EditorActivity must bypass SemanticActivity'
assert 'extends SemanticActivity' not in editor, 'production path still inherits experimental semantic activity'
assert '"AndroidDocumentRevision"' in editor, 'production path lost P0 revision bridge'
assert '"AndroidSpelling"' in editor, 'production path lost Hunspell bridge'
assert re.search(r'addJavascriptInterface\s*\([^;]*"AndroidSemanticModel"', editor, re.S) is None, 'experimental semantic bridge leaked into production activity'
assert 'class SemanticActivity extends MainActivity' in semantic, 'experimental semantic activity unexpectedly removed/reworked'
assert re.search(r'addJavascriptInterface\s*\([^;]*"AndroidSemanticModel"', semantic, re.S), 'experimental semantic bridge missing from SemanticActivity'

print('Primary Android path is deterministic; semantic NLI remains isolated')
