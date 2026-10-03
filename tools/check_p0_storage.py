#!/usr/bin/env python3
from pathlib import Path
import re

root=Path(__file__).resolve().parents[1]
articles=(root/'app/src/main/assets/www/js/12-articles.js').read_text(encoding='utf-8')
editor=(root/'app/src/main/assets/www/js/09-editor.js').read_text(encoding='utf-8')
history=(root/'app/src/main/assets/www/js/12-history.js').read_text(encoding='utf-8')
store=(root/'app/src/main/java/io/github/ayuemin/texteditor/DocumentStore.java').read_text(encoding='utf-8')
activity=(root/'app/src/main/java/io/github/ayuemin/texteditor/MainActivity.java').read_text(encoding='utf-8')
semantic=(root/'app/src/main/java/io/github/ayuemin/texteditor/SemanticActivity.java').read_text(encoding='utf-8')
revision=(root/'app/src/main/java/io/github/ayuemin/texteditor/DocumentRevisionBridge.java').read_text(encoding='utf-8')

errors=[]
def need(cond,msg):
    if not cond: errors.append(msg)

# DATA 01/02: normal autosave must settle within one second and flush on lifecycle boundaries.
m=re.search(r'articleSaveTimer\s*=\s*setTimeout\(flushArticleAutosave\s*,\s*(\d+)\s*\)',articles)
need(bool(m),'article autosave debounce not found')
if m: need(int(m.group(1))<=1000,f'article autosave debounce is {m.group(1)}ms (>1000ms)')
need("document.addEventListener('visibilitychange'" in articles and 'persistCurrentArticleNow()' in articles,
     'article save is not flushed when WebView becomes hidden')
need('window.addEventListener(\'beforeunload\',persistCurrentArticleNow)' in articles,
     'article save is not flushed before unload')
need('window.persistCurrentArticleNow&&window.persistCurrentArticleNow()' in activity,
     'Activity.onPause does not request an immediate article flush')

# Dangerous replacement operations must create a protective version first.
need("ensureProtectiveVersion('Перед очисткой')" in editor,'clear does not require a protective version')
need("ensureProtectiveVersion('Перед импортом')" in editor,'import does not require a protective version')
need('Не удалось сохранить защитную версию. Переход отменён' in articles,
     'article switch is not blocked after protective-version failure')

# Native text storage must use recoverable temp/backup replacement.
need('recoverAtomicFiles(root)' in store,'DocumentStore does not run crash recovery at startup')
need('file.getAbsolutePath() + ".tmp"' in store,'atomic temp file is missing')
need('file.getAbsolutePath() + ".bak"' in store,'atomic backup file is missing')
need('if (temp.renameTo(file))' in store and 'backup.renameTo(file)' in store,
     'atomic replace/rollback path is missing')
need('public synchronized boolean saveArticle' in store,'article saves are not serialized')

# DOC 01: the revision sidecar must be attached before the clean WebView load.
attach='addJavascriptInterface(new DocumentRevisionBridge(this), "AndroidDocumentRevision")'
need(attach in semantic,'native document revision bridge is not attached')
need('p0_document_revisions' in revision,'native revision sidecar preferences are missing')
need('@JavascriptInterface' in revision and 'persist(' in revision and 'read(' in revision,
     'revision bridge does not expose read/persist')
need('stores no article text' in revision.lower() or 'store for DOC 01' in revision,
     'revision sidecar purpose is undocumented')

if errors:
    print('P0 STORAGE INVARIANTS FAILED:')
    for e in errors: print(' - '+e)
    raise SystemExit(1)
print('P0 storage/recovery invariants OK')
