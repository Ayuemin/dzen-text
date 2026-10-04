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

// Integration regression: exercise the real analysis core and STRUCT wrapper,
// not only the light sandbox stubs above.
const integrationStore={};
const noopClassList={add(){},remove(){},toggle(){}};
const analysisDot={classList:noopClassList,setAttribute(){},title:''};
const genericElement={classList:noopClassList,setAttribute(){},querySelector(){return null},querySelectorAll(){return []},insertAdjacentElement(){},appendChild(){}};
const integration={
  console,P0Core:P0,
  settings:{
    documentProfile:'article',articleTitleMode:'auto',
    headingCheck:true,headingMin:8,headingMax:80,
    sentenceCheck:false,sentenceMax:30,
    paragraphCheck:false,paragraphMax:650,
    frequentCheck:false,frequentMin:4,nearbyCheck:false,
    structureCheck:true,structureMax:120,
    headingStructureCheck:true,phraseCheck:false,openingCheck:false,
    markdownCheck:false,proofCheck:false
  },
  editor:{value:''},activeRulePack:null,
  localStorage:{setItem(k,v){integrationStore[k]=String(v)},getItem(k){return integrationStore[k]||null},removeItem(k){delete integrationStore[k]}},
  document:{
    querySelector(){return null},querySelectorAll(){return []},createElement(){return {...genericElement}},
    getElementById(id){return id==='analysisDot'?analysisDot:{...genericElement}}
  },
  toast(){},persistSettings(){integrationStore.editorSettings=JSON.stringify(integration.settings);return true},syncSettingsUI(){},
  markdownToHtml(src){return '<p>'+String(src)+'</p>'},sanitizePublishHtml(html){return html},buildPublishPlain(html){return html.replace(/<[^>]+>/g,'')},
  p0PublicationPayload(markdown,mode){return {title:'legacy',plain:String(markdown),html:String(markdown),mode}},
  articleTitleFromSource(){return null}
};
integration.window=integration;integration.globalThis=integration;
vm.createContext(integration);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app','src','main','assets','www','js','03-analysis-core.js'),'utf8'),integration,{filename:'03-analysis-core.js'});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app','src','main','assets','www','js','18-structure-p1.js'),'utf8'),integration,{filename:'18-structure-p1.js'});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app','src','main','assets','www','js','05-analysis-state.js'),'utf8'),integration,{filename:'05-analysis-state.js'});
// Rendering is covered elsewhere. Keep this test focused on analysis results.
integration.renderAnalysis=()=>{};
integration.updateAnalysisDot=()=>{};

// A05: one H1 is the article title, not a subheading. Long article profile text
// must recommend subheadings; post profile must not.
integration.editor.value='# Основной заголовок\n\n'+('Длинный основной текст без подзаголовков. '.repeat(8));
integration.settings.structureCheck=true;
integration.settings.structureMax=120;
let analysis=integration.analyzeText();
assert.ok(analysis.issues.some(x=>x.type==='structure'&&x.title==='Нет подзаголовков'),'A05: H1-only long article must recommend subheadings');
integration.applyDocumentProfile('post');
analysis=integration.analyzeText();
assert.strictEqual(analysis.issues.some(x=>x.type==='structure'),false,'A05: post profile must not require subheadings');

// STRUCT03: headings inside fenced code must not enter the heading model.
let prodHeadings=integration.headingsFromSource('```md\n# Ложный заголовок\n###\n```\n# Реальный\n\n## Раздел\nТекст');
assert.deepStrictEqual(Array.from(prodHeadings,h=>h.text),['Реальный','Раздел'],'code headings leaked into structure model');

// Valid H1-H6 chain is allowed when levels progress normally and text exists
// between headings. H4-H6 are not errors merely because of their level.
const hChain='# H1\nТекст\n## H2\nТекст\n### H3\nТекст\n#### H4\nТекст\n##### H5\nТекст\n###### H6\nТекст';
prodHeadings=integration.headingsFromSource(hChain);
issues=[];integration.analyzeHeadingStructure(hChain,prodHeadings,issues);
assert.strictEqual(issues.length,0,'valid H1-H6 chain must not be rejected');

const multipleH1='# Первый\nТекст\n# Второй\nТекст';
prodHeadings=integration.headingsFromSource(multipleH1);
issues=[];integration.analyzeHeadingStructure(multipleH1,prodHeadings,issues);
assert.ok(issues.some(x=>x.title==='Несколько заголовков H1'),'multiple H1 regression missing');

const levelJump='# Первый\nТекст\n### Третий\nТекст';
prodHeadings=integration.headingsFromSource(levelJump);
issues=[];integration.analyzeHeadingStructure(levelJump,prodHeadings,issues);
assert.ok(issues.some(x=>/^Скачок H1 → H3/.test(x.title)),'heading level jump regression missing');

const adjacent='# Первый\n## Второй\nТекст';
prodHeadings=integration.headingsFromSource(adjacent);
issues=[];integration.analyzeHeadingStructure(adjacent,prodHeadings,issues);
assert.ok(issues.some(x=>x.title==='Два заголовка подряд'),'adjacent heading regression missing');

// Empty heading in code is ignored, real empty heading is reported once.
const emptyWithCode='```md\n###\n```\n# Реальный\nТекст\n###   \n';
prodHeadings=integration.headingsFromSource(emptyWithCode);
issues=[];integration.analyzeHeadingStructure(emptyWithCode,prodHeadings,issues);
assert.strictEqual(issues.filter(x=>/^Пустой заголовок H3/.test(x.title)).length,1,'empty code heading must be excluded');

// Large gaps between real subheadings are profile-controlled structure issues.
integration.applyDocumentProfile('article');
integration.settings.structureMax=100;
integration.editor.value='# H1\n\n'+('абзац '.repeat(30))+'\n\n## Раздел\nКоротко.';
analysis=integration.analyzeText();
assert.ok(analysis.issues.some(x=>x.type==='structure'&&/^Большой участок без подзаголовка/.test(x.title)),'large heading gap regression missing');

console.log('STRUCT01-04 profile/title tests passed');
