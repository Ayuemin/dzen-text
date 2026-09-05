from pathlib import Path


def rep(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Patch marker not found: {label}")
    return text.replace(old, new, 1)

# Android: ask the system to resize the activity when the IME appears.
manifest_path = Path('app/src/main/AndroidManifest.xml')
manifest = manifest_path.read_text(encoding='utf-8')
manifest = rep(
    manifest,
    'android:exported="true"\n            android:screenOrientation="unspecified">',
    'android:exported="true"\n            android:screenOrientation="unspecified"\n            android:windowSoftInputMode="adjustResize">',
    'manifest adjustResize',
)
manifest_path.write_text(manifest, encoding='utf-8')

# Version.
gradle_path = Path('app/build.gradle')
gradle = gradle_path.read_text(encoding='utf-8')
gradle = rep(gradle, 'versionCode 21', 'versionCode 22', 'versionCode')
gradle = rep(gradle, "versionName '1.5.0'", "versionName '1.5.1'", 'versionName')
gradle_path.write_text(gradle, encoding='utf-8')

# Web UI: use VisualViewport as a fallback on phones where the keyboard overlays WebView.
html_path = Path('app/src/main/assets/www/index.html')
html = html_path.read_text(encoding='utf-8')
html = rep(html, '<title>Дзен Текст 1.5.0</title>', '<title>Дзен Текст 1.5.1</title>', 'html title')
html = rep(
    html,
    '--fontSize:18px;--lineHeight:1.65}',
    '--fontSize:18px;--lineHeight:1.65;--keyboardInset:0px}',
    'keyboard css variable',
)
html = rep(
    html,
    '.replacePanel{position:absolute;left:10px;right:10px;bottom:8px;',
    '.replacePanel{position:fixed;left:10px;right:10px;bottom:calc(8px + var(--keyboardInset));',
    'replace panel position',
)
html = rep(
    html,
    '.nearbyPanel{position:absolute;left:10px;right:10px;bottom:8px;',
    '.nearbyPanel{position:fixed;left:10px;right:10px;bottom:calc(8px + var(--keyboardInset));',
    'nearby panel position',
)
html = rep(
    html,
    '.repeatNavPanel{position:absolute;left:10px;right:10px;bottom:8px;',
    '.repeatNavPanel{position:fixed;left:10px;right:10px;bottom:calc(8px + var(--keyboardInset));',
    'repeat navigator position',
)
keyboard_js = r'''function updateKeyboardInset(){
  const vv=window.visualViewport;
  let inset=0;
  if(vv){
    const layoutH=window.innerHeight||document.documentElement.clientHeight||0;
    inset=Math.max(0,Math.round(layoutH-vv.height-vv.offsetTop));
    // Tiny viewport differences are browser chrome, not the keyboard.
    if(inset<80)inset=0;
  }
  document.documentElement.style.setProperty('--keyboardInset',inset+'px');
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',updateKeyboardInset);
  window.visualViewport.addEventListener('scroll',updateKeyboardInset);
}
window.addEventListener('resize',updateKeyboardInset);
document.addEventListener('focusin',()=>setTimeout(updateKeyboardInset,60));
document.addEventListener('focusout',()=>setTimeout(updateKeyboardInset,120));
setTimeout(updateKeyboardInset,0);
'''
html = rep(html, '<script>\nconst editor=', '<script>\n' + keyboard_js + 'const editor=', 'keyboard viewport JS')
html_path.write_text(html, encoding='utf-8')

# Keep README current.
readme_path = Path('README.md')
readme = readme_path.read_text(encoding='utf-8')
readme = rep(readme, 'Текущая версия: **v1.5.0**.', 'Текущая версия: **v1.5.1**.', 'README version')
needle = '- автосохранение черновика;\n- подсчёт знаков, слов и примерного времени чтения.'
replacement = '- автосохранение черновика;\n- панели замены, повторов и исправлений автоматически поднимаются над экранной клавиатурой;\n- подсчёт знаков, слов и примерного времени чтения.'
readme = rep(readme, needle, replacement, 'README keyboard feature')
readme_path.write_text(readme, encoding='utf-8')
