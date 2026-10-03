'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const file=path.join(__dirname,'..','app','src','main','assets','www','js','12-publish.js');
const src=fs.readFileSync(file,'utf8');
function extract(name){
  const re=new RegExp('function\\s+'+name+'\\s*\\(');
  const m=re.exec(src);if(!m)throw new Error('missing '+name);
  const brace=src.indexOf('{',m.index);let depth=0,end=-1;
  for(let i=brace;i<src.length;i++){
    if(src[i]==='{')depth++;else if(src[i]==='}'&&--depth===0){end=i+1;break}
  }
  if(end<0)throw new Error('unbalanced '+name);
  return src.slice(m.index,end);
}
const sandbox={};vm.createContext(sandbox);vm.runInContext(extract('sanitizeImportedHtmlSource'),sandbox);
const sanitize=sandbox.sanitizeImportedHtmlSource;

const hostile=`<!doctype html><html><head>
<script>globalThis.PWNED=1</script>
<style>body{background:url(https://bad.test/a.png)}</style>
<link rel="stylesheet" href="https://bad.test/x.css">
</head><body onload="fetch('https://bad.test/')">
<h1 onclick="alert(1)">Заголовок</h1>
<p style="background:url(https://bad.test/b.png)">Обычный текст.</p>
<img src="https://bad.test/image.jpg" srcset="https://bad.test/2.jpg 2x" alt="Подпись изображения">
<iframe src="https://bad.test/frame"><p>не должно остаться</p></iframe>
<object data="https://bad.test/o"></object>
<a href="https://example.org/article" onclick="evil()">ссылка как данные</a>
</body></html>`;
const clean=sanitize(hostile);

function no(pattern,label){if(pattern.test(clean))throw new Error(label+' remained: '+clean)}
no(/<script\b/i,'script');
no(/<style\b/i,'style');
no(/<iframe\b/i,'iframe');
no(/<object\b/i,'object');
no(/<link\b/i,'link');
no(/<img\b/i,'img');
no(/\son[a-z]+\s*=/i,'event handler');
no(/\ssrc(set)?\s*=/i,'resource src');
no(/\sstyle\s*=/i,'inline style');
if(!clean.includes('Заголовок')||!clean.includes('Обычный текст.'))throw new Error('readable text was lost');
if(!clean.includes('Подпись изображения'))throw new Error('image alt text was lost');
if(!clean.includes('href="https://example.org/article"'))throw new Error('safe link href must remain data');

console.log('P0 HTML import safety A12 passed');
