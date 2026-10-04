(function(){
'use strict';

const PROFILE_FIELDS=['headingCheck','headingMin','headingMax','sentenceCheck','sentenceMax','paragraphCheck','paragraphMax','structureCheck','structureMax','phraseCheck','openingCheck','headingStructureCheck'];
const PROFILE_PRESETS={
  article:{headingCheck:true,headingMin:8,headingMax:80,sentenceCheck:true,sentenceMax:30,paragraphCheck:true,paragraphMax:650,structureCheck:true,structureMax:1800,phraseCheck:true,openingCheck:true,headingStructureCheck:true},
  post:{headingCheck:true,headingMin:5,headingMax:100,sentenceCheck:true,sentenceMax:35,paragraphCheck:true,paragraphMax:900,structureCheck:false,structureMax:2600,phraseCheck:true,openingCheck:true,headingStructureCheck:true},
  note:{headingCheck:false,headingMin:3,headingMax:120,sentenceCheck:true,sentenceMax:40,paragraphCheck:true,paragraphMax:1200,structureCheck:false,structureMax:3200,phraseCheck:true,openingCheck:false,headingStructureCheck:true}
};

function titleMode(){return settings&&settings.articleTitleMode==='none'?'none':'auto'}
function profileName(){const v=String(settings&&settings.documentProfile||'article');return ['article','post','note','custom'].includes(v)?v:'article'}
function firstPlainTitle(src){
  src=String(src||'');
  // Any Markdown heading makes the document Markdown for title purposes. In
  // Markdown only H1 is the article title; H2/H3 must not promote line 1.
  if(/^[ \t]{0,3}#{1,6}(?:[ \t]|$)/m.test(src))return null;
  const lines=typeof P0Core!=='undefined'&&P0Core.lineRecords?P0Core.lineRecords(src):[];
  const model=typeof P0Core!=='undefined'&&P0Core.documentModel?P0Core.documentModel(src):null;
  for(const line of lines){
    const raw=String(line.text||''),trimmed=raw.trim();if(!trimmed)continue;
    if(model&&P0Core.rangeIsExcluded&&P0Core.rangeIsExcluded(model,line.start,line.textEnd))continue;
    if(/^(?:>|```|~~~|[-*+]\s|\d+[.)]\s)/.test(trimmed))return null;
    const lead=raw.indexOf(trimmed),start=line.start+Math.max(0,lead);
    return {level:1,text:trimmed,start,end:start+trimmed.length,lineStart:line.start,lineEnd:line.textEnd,plainTitle:true};
  }
  return null;
}

const baseHeadingsFromSource=typeof headingsFromSource==='function'?headingsFromSource:null;
if(baseHeadingsFromSource){
  headingsFromSource=function(src){
    const out=baseHeadingsFromSource(src)||[];
    if(titleMode()==='none')return out;
    if(out.some(h=>h.level===1)||out.length)return out;
    const plain=firstPlainTitle(src);if(plain)out.unshift(plain);
    return out;
  };
  window.headingsFromSource=headingsFromSource;
}

function unifiedArticleTitle(src,headings){
  if(titleMode()==='none')return null;
  const hs=Array.isArray(headings)?headings:(baseHeadingsFromSource?baseHeadingsFromSource(src):[]);
  const h1=hs.find(h=>h.level===1);
  if(h1){
    let lineEnd=Number.isFinite(h1.lineEnd)?h1.lineEnd:String(src||'').indexOf('\n',h1.lineStart);
    if(lineEnd<0)lineEnd=String(src||'').length;
    return {text:h1.text,start:h1.start,end:h1.end,lineStart:h1.lineStart,lineEnd,markdown:!h1.plainTitle,plain:!!h1.plainTitle};
  }
  if(hs.length||/^[ \t]{0,3}#{1,6}(?:[ \t]|$)/m.test(String(src||'')))return null;
  const plain=firstPlainTitle(src);
  return plain?{text:plain.text,start:plain.start,end:plain.end,lineStart:plain.lineStart,lineEnd:plain.lineEnd,markdown:false,plain:true}:null;
}
if(typeof articleTitleFromSource==='function'){
  articleTitleFromSource=unifiedArticleTitle;
  window.articleTitleFromSource=unifiedArticleTitle;
}
window.unifiedArticleTitle=unifiedArticleTitle;

function addStructureIssue(issues,title,detail,start,end){
  if(typeof addSimpleIssue==='function')return addSimpleIssue(issues,'headingStructure',title,detail,start,end);
  if(typeof addIssue==='function')return addIssue(issues,'headingStructure',title,detail,start,end);
  return null;
}
const baseAnalyzeHeadingStructure=typeof analyzeHeadingStructure==='function'?analyzeHeadingStructure:null;
if(baseAnalyzeHeadingStructure){
  analyzeHeadingStructure=function(src,headings,issues){
    baseAnalyzeHeadingStructure(src,headings,issues);
    src=String(src||'');
    const model=typeof P0Core!=='undefined'&&P0Core.documentModel?P0Core.documentModel(src):null;
    const lines=typeof P0Core!=='undefined'&&P0Core.lineRecords?P0Core.lineRecords(src):[];
    for(const line of lines){
      const m=String(line.text||'').match(/^[ \t]{0,3}(#{1,6})[ \t]*$/);if(!m)continue;
      if(model&&P0Core.rangeIsExcluded&&P0Core.rangeIsExcluded(model,line.start,line.textEnd))continue;
      const marker=String(line.text||'').indexOf('#');
      addStructureIssue(issues,'Пустой заголовок H'+m[1].length,'После маркера заголовка нет текста.',line.start+Math.max(0,marker),line.textEnd);
    }
    const seen=new Map();
    for(const h of headings||[]){
      if(h.plainTitle)continue;
      const key=String(h.text||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
      if(!key)continue;
      if(seen.has(key))addStructureIssue(issues,'Повторяется заголовок','Такой же текст заголовка уже встречался выше.',h.start,h.end);
      else seen.set(key,h);
    }
  };
  window.analyzeHeadingStructure=analyzeHeadingStructure;
}

function persistStructureSettings(){
  try{if(typeof persistSettings==='function')return persistSettings();localStorage.setItem('editorSettings',JSON.stringify(settings));return true}catch(e){return false}
}
function applyDocumentProfile(name){
  name=['article','post','note','custom'].includes(name)?name:'article';
  settings.documentProfile=name;
  let preset=name==='custom'?settings.customDocumentProfile:PROFILE_PRESETS[name];
  if(!preset&&name==='custom')preset=PROFILE_PRESETS.article;
  if(preset)for(const key of PROFILE_FIELDS)if(Object.prototype.hasOwnProperty.call(preset,key))settings[key]=preset[key];
  persistStructureSettings();
  try{if(typeof syncSettingsUI==='function')syncSettingsUI()}catch(e){}
  syncStructureUi();
  try{if(typeof markAnalysisStale==='function')markAnalysisStale()}catch(e){}
  toast('Профиль: '+({article:'Статья',post:'Пост',note:'Заметка',custom:'Свой'}[name]||name));
}
function setArticleTitleMode(mode){
  settings.articleTitleMode=mode==='none'?'none':'auto';
  persistStructureSettings();syncStructureUi();
  try{if(typeof markAnalysisStale==='function')markAnalysisStale()}catch(e){}
}
function saveCustomDocumentProfile(){
  const custom={};for(const key of PROFILE_FIELDS)custom[key]=settings[key];
  settings.customDocumentProfile=custom;settings.documentProfile='custom';
  persistStructureSettings();syncStructureUi();toast('Текущие пороги сохранены как свой профиль');
}
window.applyDocumentProfile=applyDocumentProfile;
window.setArticleTitleMode=setArticleTitleMode;
window.saveCustomDocumentProfile=saveCustomDocumentProfile;

function ensureStructureUi(){
  const wrap=document.querySelector('#settingsBackdrop .settingsGroupWrap');if(!wrap||document.querySelector('#documentProfileSettings'))return;
  const group=document.createElement('details');group.className='settingsGroup';group.id='documentProfileSettings';
  group.innerHTML='<summary><span>Тип документа и заголовок</span><small>Статья, пост, заметка или свои пороги</small></summary><div class="settingsGroupBody">'+
    '<div class="subLabel"><span>Профиль</span></div><select data-document-profile><option value="article">Статья</option><option value="post">Пост</option><option value="note">Заметка</option><option value="custom">Свой</option></select>'+
    '<div class="smallNote" data-profile-note></div>'+
    '<div class="subLabel" style="margin-top:13px"><span>Заголовок статьи</span></div><select data-title-mode><option value="auto">Авто: H1 или первая строка обычного текста</option><option value="none">Без заголовка</option></select>'+
    '<div class="smallNote">В Markdown заголовком статьи считается только первый H1. Для обычного текста в режиме «Авто» — первая непустая строка. Режим «Без заголовка» не вынимает первую строку из тела при копировании.</div>'+
    '<div class="settingActions"><button class="nativeBtn" type="button" data-save-custom-profile>Сохранить текущие пороги как «Свой»</button></div></div>';
  const analysis=Array.from(wrap.children).find(x=>x.querySelector&&x.querySelector('#headingCheck'));
  if(analysis)wrap.insertBefore(group,analysis);else wrap.appendChild(group);
  group.querySelector('[data-document-profile]').onchange=function(){applyDocumentProfile(this.value)};
  group.querySelector('[data-title-mode]').onchange=function(){setArticleTitleMode(this.value)};
  group.querySelector('[data-save-custom-profile]').onclick=saveCustomDocumentProfile;
  syncStructureUi();
}
function syncStructureUi(){
  const group=document.querySelector('#documentProfileSettings');if(!group)return;
  const p=group.querySelector('[data-document-profile]'),t=group.querySelector('[data-title-mode]'),note=group.querySelector('[data-profile-note]');
  if(p)p.value=profileName();if(t)t.value=titleMode();
  if(note){const messages={article:'Статья: контролируются подзаголовки и более строгие пороги длины.',post:'Пост: подзаголовки не обязательны; пороги длины мягче.',note:'Заметка: структура свободнее, одинаковые начала не проверяются профилем.',custom:'Свой профиль: используются сохранённые вами пороги и переключатели.'};note.textContent=messages[profileName()]||''}
}

// Explicit no-title mode must preserve an H1 as part of the body instead of
// silently stripping it for a separate title field.
const basePublicationPayload=typeof p0PublicationPayload==='function'?p0PublicationPayload:null;
if(basePublicationPayload){
  p0PublicationPayload=function(markdown,mode){
    if(titleMode()!=='none')return basePublicationPayload(markdown,mode);
    const src=String(markdown==null?'':markdown);
    const rawHtml=typeof markdownToHtml==='function'?markdownToHtml(src):'';
    const html=typeof sanitizePublishHtml==='function'?sanitizePublishHtml(rawHtml):rawHtml;
    const plain=typeof buildPublishPlain==='function'?buildPublishPlain(html):src;
    const errors=[];const warnings=[];
    if(!html)errors.push('Статья пустая: нечего публиковать.');
    const words=plain.trim()?plain.trim().split(/\s+/).filter(Boolean).length:0;
    if(html&&words<30)warnings.push('Текст очень короткий ('+words+' слов). Проверьте, достаточно ли материала для публикации.');
    if(/^#{4,6}\s/m.test(src))warnings.push('Заголовки H4–H6 при копировании понижаются до H3.');
    const composed=typeof P0Core!=='undefined'&&P0Core.composePublication?P0Core.composePublication('',html,plain,mode):{html,plain};
    return {errors,warnings,title:'',titleMode:'none',bodyHtml:html,bodyPlain:plain,html:composed.html,plain:composed.plain,mode:mode==='title'||mode==='body'?mode:'all'};
  };
  window.p0PublicationPayload=p0PublicationPayload;
}

ensureStructureUi();
try{
  if(typeof openSettings==='function'){
    const priorOpenSettings=openSettings;
    openSettings=function(){const out=priorOpenSettings();ensureStructureUi();syncStructureUi();return out};
    window.openSettings=openSettings;
  }
}catch(e){}

window.StructureP1={PROFILE_PRESETS,firstPlainTitle,unifiedArticleTitle,profileName,titleMode};
})();
