'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const P0=require('../app/src/main/assets/www/js/14-p0-core.js');

const stored={};
const sandbox={
  console,P0Core:P0,
  settings:{documentProfile:'article',articleTitleMode:'auto',headingCheck:true,headingMin:8,headingMax:80,sentenceCheck:true,sentenceMax:30,paragraphCheck:true,paragraphMax:650,structureCheck:true,structureMax:1800,phraseCheck:true,openingCheck:true,headingStructureCheck:true},
  localStorage:{setItem(k,v){stored[k]=String(v)},getItem(k){return stored[k]||null}},
  document:{querySelector(){return null},createElement(){return {}}},
  toast(){},markAnalysisStale(){},persistSettings(){stored.editorSettings=JSON.stringify(sandbox.settings);return true},syncSettingsUI(){},
  markdownToHtml(src){return '<p>'+String(src)+'</p>'},sanitizePublishHtml(html){return html},buildPublishPlain(html){return html.replace(/<[^>]+>/g,'')},
  p0PublicationPayload(markdown,mode){return {title:'legacy',plain:String(markdown),html:String(markdown),mode}},
  articleTitleFromSource(){return null},
  addSimpleIssue(issues,type,title,detail,start,end){const i={type,title,detail,start,end};issues.push(i);return i},
  analyzeHeadingStructure(){},
  headingsFromSource(src){
    const out=[];const re=/^(#{1,6})[ \t]+(.+)$/gm;let m;
    while((m=re.exec(String(src||'')))){const t=m[2].trim(),at=m.index+m[0].indexOf(m[2]);out.push({level:m[1].length,text:t,start:at,end:at+m[2].length,lineStart:m.index})}
    return out;
  }
};
sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app','src','main','assets','www','js','18-structure-p1.js'),'utf8'),sandbox,{filename:'18-structure-p1.js'});

assert.ok(sandbox.StructureP1,'StructureP1 API missing');

let hs=sandbox.headingsFromSource('Обычный заголовок\n\nТекст заметки.');
assert.strictEqual(hs.length,1);
assert.strictEqual(hs[0].level,1);
assert.strictEqual(hs[0].plainTitle,true);
assert.strictEqual(hs[0].text,'Обычный заголовок');
let title=sandbox.articleTitleFromSource('Обычный заголовок\n\nТекст заметки.',hs);
assert.strictEqual(title.text,'Обычный заголовок');
assert.strictEqual(title.markdown,false);

hs=sandbox.headingsFromSource('Первая строка\n\n## Подзаголовок\nТекст');
assert.strictEqual(hs.some(h=>h.plainTitle),false,'Markdown document must not promote plain first line');
assert.strictEqual(sandbox.articleTitleFromSource('Первая строка\n\n## Подзаголовок\nТекст',hs),null,'Markdown without H1 has no article title');

hs=sandbox.headingsFromSource('# H1\n\n## Раздел');
title=sandbox.articleTitleFromSource('# H1\n\n## Раздел',hs);
assert.strictEqual(title.text,'H1');
assert.strictEqual(title.markdown,true);

sandbox.setArticleTitleMode('none');
hs=sandbox.headingsFromSource('Обычный заголовок\nТекст');
assert.strictEqual(hs.length,0,'no-title mode must not invent a title');
assert.strictEqual(sandbox.articleTitleFromSource('Обычный заголовок\nТекст',hs),null);
let payload=sandbox.p0PublicationPayload('# H1\n\nТело', 'all');
assert.strictEqual(payload.title,'');
assert.strictEqual(payload.titleMode,'none');
assert.ok(payload.plain.includes('# H1'),'no-title mode must preserve first line in body');

sandbox.setArticleTitleMode('auto');
let issues=[];
sandbox.analyzeHeadingStructure('# Первый\n\n## Повтор\nТекст\n\n## Повтор\n\n###   \n',[
  {level:1,text:'Первый',start:2,end:8,lineStart:0},
  {level:2,text:'Повтор',start:13,end:19,lineStart:10},
  {level:2,text:'Повтор',start:31,end:37,lineStart:28}
],issues);
assert.ok(issues.some(x=>x.title==='Повторяется заголовок'),'duplicate heading not detected');
assert.ok(issues.some(x=>/^Пустой заголовок H3/.test(x.title)),'empty heading not detected');

sandbox.applyDocumentProfile('post');
assert.strictEqual(sandbox.settings.documentProfile,'post');
assert.strictEqual(sandbox.settings.structureCheck,false,'post must not require subheadings');
assert.strictEqual(sandbox.settings.sentenceMax,35);

sandbox.settings.sentenceMax=27;sandbox.settings.paragraphMax=777;sandbox.settings.structureCheck=true;
sandbox.saveCustomDocumentProfile();
assert.strictEqual(sandbox.settings.documentProfile,'custom');
assert.strictEqual(sandbox.settings.customDocumentProfile.sentenceMax,27);
sandbox.settings.sentenceMax=50;
sandbox.applyDocumentProfile('custom');
assert.strictEqual(sandbox.settings.sentenceMax,27,'custom profile must restore saved thresholds');

console.log('STRUCT01-04 profile/title tests passed');
