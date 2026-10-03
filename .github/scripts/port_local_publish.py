#!/usr/bin/env python3
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[2]

def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def tag(path): return subprocess.check_output(['git','show',f'v1.10.8:{path}'],cwd=ROOT,text=True)
def sub1(s,pat,repl,label,flags=0):
    out,n=re.subn(pat,repl,s,count=1,flags=flags)
    if n!=1: raise SystemExit(f'{label}: expected 1 match, got {n}')
    return out

# Harden Markdown rendering and add a single publication payload source of truth.
p='app/src/main/assets/www/js/02-text-tools.js'
cur=read(p); old=tag(p)
prefix=old[:old.index('function wordMatches')]
cur=prefix+cur[cur.index('function wordMatches'):]
write(p,cur)

# Copy pure publication preflight and its behavioural tests from the proven release.
for p in ('app/src/main/assets/www/js/12-publish.js','tools/test_publish_export.js','tools/test_publish_copy.js'):
    write(p,tag(p))

# Replace the legacy WebView copy path with the tested publication path.
p='app/src/main/assets/www/js/09-editor.js'; cur=read(p); old=tag(p)
start=old.index('function publishPayload()')
end=old.index('function cleanSpeechText()',start)
publish_block=old[start:end]
cur=sub1(cur,r'function copyRichHtml\(\)\{[\s\S]*?(?=function cleanSpeechText\(\))',publish_block,'copy publication path')
write(p,cur)

# The real publication subsystem supersedes the bootstrap compatibility implementation.
p='app/src/main/assets/www/js/12-bootstrap.js'; cur=read(p)
cur=sub1(cur,r'\nfunction installLocalPublicationSafety\(\)\{[\s\S]*?\n\}\n\nfunction bootstrapDzenText', '\nfunction bootstrapDzenText','bootstrap publication shim')
cur=cur.replace('  installLocalPublicationSafety();\n','')
write(p,cur)

# Load preflight before bootstrap.
p='app/src/main/assets/www/index.html'; cur=read(p)
needle='<script src="js/12-bootstrap.js"></script>'
if '<script src="js/12-publish.js"></script>' not in cur:
    if needle not in cur: raise SystemExit('bootstrap script tag not found')
    cur=cur.replace(needle,'<script src="js/12-publish.js"></script>\n'+needle,1)
write(p,cur)

# Port only the native clipboard bridge, not the AI/network code around it.
p='app/src/main/java/ru/dzenprep/texteditor/MainActivity.java'; cur=read(p); old=tag(p)
imports=(
'import android.content.ClipData;\n','import android.content.ClipDescription;\n','import android.content.ClipboardManager;\n',
'import android.os.Looper;\n','import java.util.concurrent.CountDownLatch;\n','import java.util.concurrent.TimeUnit;\n','import java.util.concurrent.atomic.AtomicBoolean;\n')
for imp in imports:
    if imp not in cur:
        if imp.startswith('import android.content.'):
            cur=cur.replace('import android.content.Intent;\n',imp+'import android.content.Intent;\n',1)
        elif imp.startswith('import android.os.'):
            cur=cur.replace('import android.os.Build;\n','import android.os.Build;\n'+imp,1)
        else:
            cur=cur.replace('import java.util.Iterator;\n','import java.util.Iterator;\n'+imp,1)
if 'new PublishBridge(), "AndroidPublish"' not in cur:
    cur=cur.replace('        web.addJavascriptInterface(new FileBridge(), "AndroidFile");\n','        web.addJavascriptInterface(new FileBridge(), "AndroidFile");\n        web.addJavascriptInterface(new PublishBridge(), "AndroidPublish");\n',1)
cls_start=old.index('    /** Copies the rendered article to the system clipboard for the Dzen editor. */')
cls_end=old.index('    public class DocumentsBridge',cls_start)
bridge=old[cls_start:cls_end]
if 'public class PublishBridge' not in cur:
    cur=cur.replace('    public class DocumentsBridge',bridge+'    public class DocumentsBridge',1)
write(p,cur)

# Remove the final spelling compatibility calls now that the native spelling UI is gone.
p='app/src/main/assets/www/js/12-history.js'; cur=read(p)
cur=cur.replace('  clearOnlineSpelling();\n','')
write(p,cur)
p='app/src/main/assets/www/js/07-spelling.js'; cur=read(p)
cur=cur.replace('function closeSpellPanel(){}\n','')
write(p,cur)

# Erase obsolete OpenRouter provenance from the built-in static Dzen pack.
p='app/src/main/assets/www/js/01-core.js'; cur=read(p)
cur=cur.replace('"source_sha256":"bootstrap-pending-official-refresh","generator":{"provider":"bootstrap","model":"none","prompt_version":2},"privacy":"OpenRouter receives only the official Dzen rules page. User articles are never sent by this updater."','"source_sha256":"builtin-local-pack","generator":{"provider":"builtin","model":"none","prompt_version":3},"privacy":"Static built-in local rule pack. User articles never leave the device."')
write(p,cur)

# CI executes publication behaviour, not just source-string invariants.
p='.github/workflows/android-ci.yml'; cur=read(p)
marker='          python3 tools/check_app_logic.py\n'
extra='          node tools/test_publish_export.js\n          node tools/test_publish_copy.js\n'
if extra not in cur:
    if marker not in cur: raise SystemExit('CI marker missing')
    cur=cur.replace(marker,marker+extra,1)
write(p,cur)

# Strengthen local-first guard around the port.
p='tools/check_local_first.py'; cur=read(p)
anchor="require('ta.value=payload.plain' in bootstrap.replace(' ', ''), 'Publication fallback must use rendered plain text')\n"
# Bootstrap no longer owns publication fallback, so replace old shim assertions with subsystem assertions.
cur=cur.replace("require('ta.value=editor.value' not in bootstrap.replace(' ', ''), 'Publication fallback must never copy raw Markdown')\n",'')
cur=cur.replace(anchor,"require((js_dir / '12-publish.js').exists(), 'Publication preflight module must exist')\nrequire('AndroidPublish' in main_activity and 'ClipData.Item(plainValue, htmlValue)' in main_activity, 'Native publication clipboard bridge must stay present')\nrequire('buildPublishHtml' in (js_dir / '02-text-tools.js').read_text(encoding='utf-8'), 'Publication must derive payload from rendered Markdown')\n")
cur += "\nrequire('clearOnlineSpelling' not in all_js, 'Legacy spelling compatibility calls must stay removed')\nrequire('OpenRouter receives only' not in all_js, 'Built-in local rule pack must not retain remote-generator provenance')\n"
write(p,cur)

print('Local publication subsystem ported')
