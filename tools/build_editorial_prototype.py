#!/usr/bin/env python3
from pathlib import Path
import json, re, shutil

ROOT=Path(__file__).resolve().parents[1]
WWW=ROOT/'app/src/main/assets/www'
JS=WWW/'js'
JAVA_OLD=ROOT/'app/src/main/java/ru/dzenprep/texteditor'
JAVA_NEW=ROOT/'app/src/main/java/io/github/ayuemin/texteditor'

def read(p): return Path(p).read_text(encoding='utf-8')
def write(p,s):
    p=Path(p); p.parent.mkdir(parents=True,exist_ok=True); p.write_text(s,encoding='utf-8')
def replace_once(text,old,new,label):
    if old not in text: raise SystemExit('missing marker: '+label)
    return text.replace(old,new,1)

# --- Neutral Android identity: separate install, no migration contract. ---
for name in ['MainActivity.java','DocumentStore.java']:
    src=JAVA_OLD/name
    text=read(src).replace('package ru.dzenprep.texteditor;','package io.github.ayuemin.texteditor;')
    text=text.replace('getSharedPreferences("dzen_text"','getSharedPreferences("editor_text"')
    text=text.replace('"dzen_documents"','"editor_documents"')
    text=text.replace('"dzen_"','"editor_"')
    text=text.replace('Дзен Текст','Редактор текста').replace('Dzen Text','Text Editor').replace('Dzen editor','publication editor')
    write(JAVA_NEW/name,text)
shutil.rmtree(ROOT/'app/src/main/java/ru',ignore_errors=True)

gradle=read(ROOT/'app/build.gradle')
gradle=re.sub(r"namespace '[^']+'","namespace 'io.github.ayuemin.texteditor'",gradle)
gradle=re.sub(r"applicationId '[^']+'","applicationId 'io.github.ayuemin.texteditor'",gradle)
gradle=re.sub(r'versionCode\s+\d+','versionCode 1',gradle)
gradle=re.sub(r"versionName\s+'[^']+'","versionName '0.1.0-prototype'",gradle)
write(ROOT/'app/build.gradle',gradle)
manifest=read(ROOT/'app/src/main/AndroidManifest.xml').replace('android:label="Дзен Текст"','android:label="Редактор текста"')
write(ROOT/'app/src/main/AndroidManifest.xml',manifest)

# --- Core: no bundled platform rules, no AI-style switch. ---
core=read(JS/'01-core.js')
core=core.replace("window.dispatchEvent(new CustomEvent('dzenKeyboardState'","window.dispatchEvent(new CustomEvent('editorKeyboardState'")
core=core.replace("window.addEventListener('dzenKeyboardState'","window.addEventListener('editorKeyboardState'")
core=core.replace("aiStyleCheck:true,proofCheck:true,dzenCheck:true,","proofCheck:true,")
core=core.replace("const USER_SYNONYMS_KEY='dzenUserSynonymsV1';","const USER_SYNONYMS_KEY='editorUserSynonymsV1';")
core=re.sub(r"const DEFAULT_DZEN_RULES=.*?function updateDzenRulesStatus\(\)\{.*?\}\s*$","",core,flags=re.S)
write(JS/'01-core.js',core.rstrip()+"\n")

# --- Generic local rule-pack engine. No executable regex or code in imported packs. ---
rules_js=r'''const RULE_PACK_SCHEMA='editorial-rule-pack-v1';
const RULE_PACK_KEY='editorialRulePackV1';
let activeRulePack=null;
let pendingRulePack=null;

const RULE_TYPES=new Set(['word','phrase','phrase_any','phrase_all','stem','context','title_length','link_count','caps_ratio','manual']);
const RULE_SCOPES=new Set(['all','title','body']);
const RULE_SEVERITIES=new Set(['warning','critical']);

function ruleWordChar(c){return !!c&&/[A-Za-zА-Яа-яЁё0-9_]/.test(c)}
function ruleOccurrences(text,q,max=8,mode='phrase'){
  const out=[];if(!q)return out;let p=0;const first=ruleWordChar(q[0]),last=ruleWordChar(q[q.length-1]);
  while(out.length<max&&(p=text.indexOf(q,p))>=0){const before=text[p-1],after=text[p+q.length];let ok=true;
    if(mode==='word'){if(first&&ruleWordChar(before))ok=false;if(last&&ruleWordChar(after))ok=false}
    else if(mode==='stem'){if(first&&ruleWordChar(before))ok=false}
    else {if(first&&ruleWordChar(before))ok=false;if(last&&ruleWordChar(after))ok=false}
    if(ok)out.push(p);p+=Math.max(1,q.length)}return out
}
function packStrings(value,max=100){return Array.isArray(value)?value.map(x=>String(x||'').trim()).filter(Boolean).slice(0,max):[]}
function rulePackAllowedId(v){return /^[A-Za-z0-9._-]{1,80}$/.test(String(v||''))}
function validateRulePackObject(input){
  const errors=[];if(!input||typeof input!=='object'||Array.isArray(input))return {ok:false,errors:['Корень JSON должен быть объектом.']};
  if(input.schema!==RULE_PACK_SCHEMA)errors.push('schema должен быть «'+RULE_PACK_SCHEMA+'».');
  if(!rulePackAllowedId(input.id))errors.push('id пакета: 1–80 символов A-Z, a-z, 0-9, точка, _ или -.');
  if(!String(input.name||'').trim()||String(input.name).length>120)errors.push('name пакета обязателен и должен быть короче 120 символов.');
  if(!String(input.version||'').trim()||String(input.version).length>40)errors.push('version обязателен и должен быть короче 40 символов.');
  if(!Array.isArray(input.rules)||!input.rules.length)errors.push('rules должен быть непустым массивом.');
  if(Array.isArray(input.rules)&&input.rules.length>500)errors.push('В одном пакете допускается не более 500 правил.');
  const ids=new Set(),clean=[];let autoCount=0,manualCount=0;
  for(const [index,raw] of (Array.isArray(input.rules)?input.rules:[]).entries()){
    const n=index+1,prefix='Правило '+n+': ';
    if(!raw||typeof raw!=='object'||Array.isArray(raw)){errors.push(prefix+'должно быть объектом.');continue}
    const id=String(raw.id||'');if(!rulePackAllowedId(id)){errors.push(prefix+'неверный id.');continue}if(ids.has(id)){errors.push(prefix+'id «'+id+'» повторяется.');continue}ids.add(id);
    const type=String(raw.type||'');if(!RULE_TYPES.has(type)){errors.push(prefix+'неизвестный type «'+type+'».');continue}
    const title=String(raw.title||'').trim();if(!title||title.length>160){errors.push(prefix+'title обязателен и должен быть короче 160 символов.');continue}
    const message=String(raw.message||'').trim();if(!message||message.length>500){errors.push(prefix+'message обязателен и должен быть короче 500 символов.');continue}
    const severity=String(raw.severity||'warning');if(!RULE_SEVERITIES.has(severity)){errors.push(prefix+'severity: warning или critical.');continue}
    const scope=String(raw.scope||'all');if(type!=='manual'&&!RULE_SCOPES.has(scope)){errors.push(prefix+'scope: all, title или body.');continue}
    const rule={id,type,title,message,severity,scope};
    if(['word','phrase','phrase_any','phrase_all','stem'].includes(type)){
      rule.values=packStrings(raw.values,100);if(!rule.values.length){errors.push(prefix+'values должен содержать хотя бы одно значение.');continue}
      if(type==='phrase'&&rule.values.length!==1){errors.push(prefix+'type phrase требует ровно одно значение в values.');continue}
    }else if(type==='context'){
      rule.phrases=packStrings(raw.phrases,100);rule.stems=packStrings(raw.stems,100);rule.required_nearby=packStrings(raw.required_nearby,100);rule.exclude_nearby=packStrings(raw.exclude_nearby,100);
      if(!rule.phrases.length&&!rule.stems.length){errors.push(prefix+'context требует phrases и/или stems.');continue}
      rule.window=Math.max(40,Math.min(1000,Number(raw.window)||220));rule.min_score=Math.max(1,Math.min(10,Number(raw.min_score)||2));
    }else if(type==='title_length'){
      rule.min=Math.max(0,Number(raw.min)||0);rule.max=Math.max(0,Number(raw.max)||0);if(!rule.min&&!rule.max){errors.push(prefix+'title_length требует min и/или max.');continue}rule.scope='title';
    }else if(type==='link_count'){
      rule.max=Math.max(0,Number(raw.max)||0);if(!rule.max){errors.push(prefix+'link_count требует max > 0.');continue}rule.scope='all';
    }else if(type==='caps_ratio'){
      rule.max_ratio=Number(raw.max_ratio);rule.min_letters=Math.max(1,Number(raw.min_letters)||10);if(!(rule.max_ratio>0&&rule.max_ratio<=1)){errors.push(prefix+'caps_ratio требует max_ratio от 0 до 1.');continue}
    }
    if(type==='manual')manualCount++;else autoCount++;clean.push(rule)
  }
  const pack={schema:RULE_PACK_SCHEMA,id:String(input.id||''),name:String(input.name||'').trim(),version:String(input.version||'').trim(),description:String(input.description||'').trim().slice(0,500),source:String(input.source||'').trim().slice(0,500),rules:clean};
  return {ok:errors.length===0,errors,pack,autoCount,manualCount};
}
function loadRulePack(){try{const raw=localStorage.getItem(RULE_PACK_KEY);if(!raw)return null;const result=validateRulePackObject(JSON.parse(raw));return result.ok?result.pack:null}catch(e){return null}}
function saveRulePack(pack){try{localStorage.setItem(RULE_PACK_KEY,JSON.stringify(pack));return true}catch(e){toast('Не удалось сохранить пакет правил');return false}}
function manualRuleItems(){return activeRulePack?activeRulePack.rules.filter(r=>r.type==='manual'):[]}
function activeAutoRules(){return activeRulePack?activeRulePack.rules.filter(r=>r.type!=='manual'):[]}
function updateRulePackStatus(){
  const el=document.getElementById('rulePackStatus');if(!el)return;
  if(!activeRulePack){el.innerHTML='<b>Пакет не загружен.</b><br>Дополнительные правила площадки не применяются.';return}
  const a=activeAutoRules().length,m=manualRuleItems().length;
  el.innerHTML='<b>'+escapeHtml(activeRulePack.name)+'</b> · версия '+escapeHtml(activeRulePack.version)+'<br>Автоматических правил: <b>'+a+'</b> · ручных: <b>'+m+'</b>'+(activeRulePack.source?'<br>Источник: '+escapeHtml(activeRulePack.source):'');
}
function rulePackTemplate(){return JSON.stringify({schema:RULE_PACK_SCHEMA,id:'example-platform',name:'Пример правил площадки',version:'1.0',description:'Замените примеры своими правилами.',source:'https://example.com/rules',rules:[{id:'title-clickbait',title:'Нежелательная фраза в заголовке',type:'phrase_any',scope:'title',severity:'warning',values:['вы не поверите','шокирующая правда'],message:'Проверьте формулировку заголовка.'},{id:'finance-context',title:'Финансовое обещание — проверить контекст',type:'context',scope:'all',severity:'warning',phrases:['гарантированный доход'],stems:['прибыл','доход'],required_nearby:['гарантирован','без риска'],exclude_nearby:['не гарантируется','можно потерять'],window:220,min_score:2,message:'Проверьте, нет ли безусловного обещания результата.'},{id:'manual-title',title:'Соответствие заголовка тексту',type:'manual',severity:'warning',message:'Перед публикацией вручную проверьте соответствие заголовка содержанию.'}]},null,2)}
function downloadRulePackTemplate(){
  const text=rulePackTemplate(),name='editorial-rule-pack-example.json';
  if(window.AndroidFile&&typeof AndroidFile.saveReport==='function'){AndroidFile.saveReport(text,name);return}
  try{const blob=new Blob([text],{type:'application/json;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),800);toast('Образец JSON сохранён')}catch(e){toast('Не удалось сохранить образец')}
}
function openRulePackImport(){pendingRulePack=null;document.getElementById('rulePackPaste').value='';document.getElementById('rulePackImportResult').innerHTML='';document.getElementById('rulePackInstallBtn').hidden=true;document.getElementById('rulePackBackdrop').classList.add('open')}
function closeRulePackImport(){document.getElementById('rulePackBackdrop').classList.remove('open');pendingRulePack=null}
function rulePackBackdropClick(e){if(e.target&&e.target.id==='rulePackBackdrop')closeRulePackImport()}
function chooseRulePackFile(){if(window.AndroidFile&&typeof AndroidFile.pickRulePack==='function'){AndroidFile.pickRulePack();return}document.getElementById('rulePackFileInput').click()}
function validateRulePackText(text,name=''){
  const box=document.getElementById('rulePackImportResult');pendingRulePack=null;let parsed;
  try{parsed=JSON.parse(String(text||''))}catch(e){box.innerHTML='<div class="rulePackError"><b>JSON не разобран.</b><br>'+escapeHtml(String(e.message||e))+'</div>';document.getElementById('rulePackInstallBtn').hidden=true;return}
  const result=validateRulePackObject(parsed);if(!result.ok){box.innerHTML='<div class="rulePackError"><b>Формат не принят.</b><ul>'+result.errors.slice(0,20).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul></div>';document.getElementById('rulePackInstallBtn').hidden=true;return}
  pendingRulePack=result.pack;box.innerHTML='<div class="rulePackOk"><b>'+escapeHtml(result.pack.name)+'</b> · '+escapeHtml(result.pack.version)+(name?'<br>Файл: '+escapeHtml(name):'')+'<br>Автоматических правил: <b>'+result.autoCount+'</b> · ручных: <b>'+result.manualCount+'</b></div>';document.getElementById('rulePackInstallBtn').hidden=false;
}
function validateRulePackPaste(){validateRulePackText(document.getElementById('rulePackPaste').value,'')}
function installPendingRulePack(){if(!pendingRulePack)return;if(!saveRulePack(pendingRulePack))return;activeRulePack=pendingRulePack;updateRulePackStatus();closeRulePackImport();try{analyzeText()}catch(e){}toast('Пакет правил установлен')}
window.onNativeRulePackLoaded=(text,name)=>{openRulePackImport();document.getElementById('rulePackPaste').value=String(text||'');validateRulePackText(text,name||'')};
window.onNativeRulePackError=(msg)=>toast(msg||'Не удалось загрузить JSON');

function ruleScopeSource(src,titleObj,scope){if(scope==='title')return titleObj?{text:titleObj.text,base:titleObj.start}:{text:'',base:0};if(scope==='body'&&titleObj){const start=Math.min(src.length,titleObj.end);return {text:src.slice(start),base:start}}return {text:src,base:0}}
function addPackIssue(issues,rule,start,end,detail){const it=addSimpleIssue(issues,'rules',rule.title,detail||rule.message,start,end,rule.severity);if(it){it.ruleId=rule.id;it.packName=activeRulePack?activeRulePack.name:''}return it}
function containsAny(text,values){const lower=text.toLocaleLowerCase('ru-RU');return (values||[]).some(v=>lower.includes(String(v).toLocaleLowerCase('ru-RU')))}
function analyzeRulePack(src,headings,issues){
  if(!activeRulePack)return;const titleObj=headings.find(h=>h.level===1);let total=0;
  for(const rule of activeAutoRules()){
    if(total>=100)break;const scoped=ruleScopeSource(src,titleObj,rule.scope),source=scoped.text,lower=source.toLocaleLowerCase('ru-RU');if(!source&&rule.scope==='title')continue;
    if(['word','phrase','phrase_any','stem'].includes(rule.type)){
      const mode=rule.type==='stem'?'stem':rule.type==='word'?'word':'phrase';let shown=0;
      for(const raw of rule.values){const q=String(raw).toLocaleLowerCase('ru-RU');for(const at of ruleOccurrences(lower,q,6,mode)){addPackIssue(issues,rule,scoped.base+at,scoped.base+at+q.length,rule.message+' · «'+raw+'»');shown++;total++;if(shown>=6||total>=100)break}if(shown>=6||total>=100)break}
    }else if(rule.type==='phrase_all'){
      const found=rule.values.map(v=>({v,at:lower.indexOf(String(v).toLocaleLowerCase('ru-RU'))}));if(found.every(x=>x.at>=0)){const first=found.sort((a,b)=>a.at-b.at)[0];addPackIssue(issues,rule,scoped.base+first.at,scoped.base+first.at+String(first.v).length,rule.message);total++}
    }else if(rule.type==='context'){
      const candidates=[];for(const p of rule.phrases||[]){const q=String(p).toLocaleLowerCase('ru-RU');for(const at of ruleOccurrences(lower,q,6,'phrase'))candidates.push({at,len:q.length,label:p,score:3})}for(const s of rule.stems||[]){const q=String(s).toLocaleLowerCase('ru-RU');for(const at of ruleOccurrences(lower,q,6,'stem'))candidates.push({at,len:q.length,label:s,score:1})}candidates.sort((a,b)=>a.at-b.at);let shown=0;
      for(const c of candidates){if(shown>=6||total>=100)break;const ws=Math.max(0,c.at-rule.window),we=Math.min(lower.length,c.at+c.len+rule.window),windowText=lower.slice(ws,we);let score=c.score;if(containsAny(windowText,rule.required_nearby))score++;if(containsAny(windowText,rule.exclude_nearby))score-=2;if(score<rule.min_score)continue;addPackIssue(issues,rule,scoped.base+c.at,scoped.base+c.at+c.len,rule.message+' · сигнал «'+c.label+'»');shown++;total++}
    }else if(rule.type==='title_length'&&titleObj){const len=titleObj.text.length;if((rule.min&&len<rule.min)||(rule.max&&len>rule.max)){addPackIssue(issues,rule,titleObj.start,titleObj.end,rule.message+' · '+len+' знаков');total++}}
    else if(rule.type==='link_count'){const urls=Array.from(src.matchAll(/https?:\/\/[^\s)]+/g));if(urls.length>rule.max){const u=urls[Math.min(rule.max,urls.length-1)];addPackIssue(issues,rule,u.index,u.index+u[0].length,rule.message+' · ссылок: '+urls.length);total++}}
    else if(rule.type==='caps_ratio'){const letters=Array.from(source).filter(c=>/[A-Za-zА-Яа-яЁё]/.test(c));if(letters.length>=rule.min_letters){const upp=letters.filter(c=>c===c.toUpperCase()&&c!==c.toLowerCase()).length,ratio=upp/letters.length;if(ratio>rule.max_ratio){addPackIssue(issues,rule,scoped.base,Math.min(src.length,scoped.base+Math.max(1,source.length)),rule.message+' · заглавных: '+Math.round(ratio*100)+'%');total++}}}
  }
}

function analyzeProofLocal(src,issues){
 const add=(title,detail,start,end,replacement='')=>{const issue=addIssue(issues,'proof',title,detail,start,end);if(issue&&replacement)issue.replacement=replacement;return !!issue};let m;
 const double=/[^\n ] {2,}(?=\S)/g;while((m=double.exec(src))){const st=m.index+1,en=m.index+m[0].length;add('Несколько пробелов подряд','Оставьте один пробел',st,en,' ')}
 const before=/\s+[,:;!?]/g;while((m=before.exec(src))){const punct=m[0].slice(-1),st=m.index,en=m.index+m[0].length;add('Пробел перед знаком препинания','Перед «'+punct+'» пробел обычно не нужен',st,en,punct)}
 const after=/[,:;!?](?=[A-Za-zА-Яа-яЁё])/g;while((m=after.exec(src))){const st=m.index,en=st+1;add('Нет пробела после знака препинания','Проверьте границу слов',st,en,m[0]+' ')}
 const dup=/\b([A-Za-zА-Яа-яЁё]{2,})\s+\1\b/giu;while((m=dup.exec(src))){const second=m.index+m[0].lastIndexOf(m[1]);add('Повтор слова: «'+m[1]+'»','Два одинаковых слова подряд',second,second+m[1].length,'')}
 const punct=/([!?;,])\1+/g;while((m=punct.exec(src)))add('Повторяющийся знак препинания','Найдено «'+m[0]+'»',m.index,m.index+m[0].length,m[1]);
 const words=/[A-Za-zА-Яа-яЁё]+/g;while((m=words.exec(src))){if(/[A-Za-z]/.test(m[0])&&/[А-Яа-яЁё]/.test(m[0]))add('Смешаны кириллица и латиница','Проверьте слово «'+m[0]+'»',m.index,m.index+m[0].length)}
}
'''
write(JS/'04-rules-analysis.js',rules_js)
if (JS/'04-dzen-analysis.js').exists(): (JS/'04-dzen-analysis.js').unlink()

# --- Analysis state/report becomes platform-neutral. ---
state=read(JS/'05-analysis-state.js')
state=state.replace(" if(settings.aiStyleCheck!==false)analyzeAIStyle(src,headings,paragraphs,issues);\n","")
state=state.replace(" if(settings.dzenCheck)analyzeDzenRules(src,headings,issues);"," if(activeRulePack)analyzeRulePack(src,headings,issues);")
state=re.sub(r"const issueOverflow=.*?currentAnalysis=\{issues,warningCount,dzenCount,aiStyleCount,editorCount,metrics,issueOverflow,overflowTotal\};", "const issueOverflow={...(issues._overflow||{})},overflowTotal=Object.values(issueOverflow).reduce((a,b)=>a+(Number(b)||0),0);const typeCount=t=>issues.filter(x=>x.type===t).length+(issueOverflow[t]||0);const warningCount=issues.length+overflowTotal,rulesCount=typeCount('rules'),editorCount=warningCount-rulesCount;currentAnalysis={issues,warningCount,rulesCount,editorCount,metrics,issueOverflow,overflowTotal};", state)
state=re.sub(r"function issueGroups\(\)\{return \[.*?\]\}","function issueGroups(){return [{id:'proof',name:'Пробелы и пунктуация'},{id:'risk',name:'Контроль слов'},{id:'rules',name:'Пакет правил'},{id:'heading',name:'Заголовки'},{id:'headingStructure',name:'Структура H1–H3'},{id:'sentence',name:'Длинные предложения'},{id:'paragraph',name:'Длинные абзацы'},{id:'frequent',name:'Частые слова'},{id:'nearby',name:'Повторы рядом'},{id:'phrase',name:'Повторяющиеся фразы'},{id:'opening',name:'Одинаковые начала'},{id:'markdown',name:'Markdown'},{id:'structure',name:'Структура текста'}]}",state)
state=state.replace("function setAnalysisMode(mode){analysisMode=['problems','all','dzen'].includes(mode)?mode:'problems';","function setAnalysisMode(mode){analysisMode=['problems','all','rules'].includes(mode)?mode:'problems';")
state=re.sub(r"function renderDzenManual\(\)\{.*?\}\n","function renderRulePackManual(){const items=manualRuleItems().map(x=>'<li><b>'+escapeHtml(x.title)+'</b> — '+escapeHtml(x.message)+'</li>').join('');return items?'<div class=\"analysisRulesNote\"><b>Ручной чек-лист пакета</b><ul class=\"manualChecklist\">'+items+'</ul></div>':''}\n",state)
write(JS/'05-analysis-state.js',state)

report=r'''function analysisVisibleAndHidden(type){const visible=currentAnalysis.issues.filter(x=>x.type===type).length;const hidden=Number(currentAnalysis.issueOverflow&&currentAnalysis.issueOverflow[type])||0;return {visible,hidden,total:visible+hidden}}
function analysisOverflowNote(type){const n=analysisVisibleAndHidden(type);return n.hidden?'<div class="analysisOverflowNote">Показано '+n.visible+' из '+n.total+' однотипных замечаний. Остальные скрыты, чтобы не перегружать редактор.</div>':''}
function buildAnalysisReport(){analyzeText();const src=editor.value||'',a=currentAnalysis,lines=[];lines.push('ОТЧЁТ РЕДАКТОРА ПО ЛОКАЛЬНОЙ ПРОВЕРКЕ');lines.push('Создан: '+new Date().toLocaleString('ru-RU'));lines.push('Всего замечаний: '+(a.warningCount||0)+'; редакторских: '+(a.editorCount||0)+'; из пакета правил: '+(a.rulesCount||0)+'.');if(activeRulePack)lines.push('Пакет правил: '+activeRulePack.name+' · '+activeRulePack.version+'.');else lines.push('Пакет правил: не загружен.');if(a.overflowTotal)lines.push('В интерфейсе сохранено '+a.issues.length+' из '+a.warningCount+' замечаний; '+a.overflowTotal+' однотипных срабатываний скрыто.');lines.push('');if(!a.issues.length){lines.push('Замечаний не найдено.');return lines.join('\n')}a.issues.forEach((i,n)=>{const start=Number.isFinite(i.start)?i.start:0,end=Number.isFinite(i.end)?i.end:start;let marker=cleanReportText(src.slice(start,end));if(!marker)marker=cleanReportText(i.word||i.title);lines.push((n+1)+'. ['+reportTypeName(i.type)+'] '+cleanReportText(i.title));lines.push('Метка поиска: «'+marker+'»');const context=shortContext(src,start,end);if(context)lines.push('Контекст: '+context);lines.push('Позиция: символы '+(start+1)+'–'+Math.max(start+1,end));if(i.ruleId)lines.push('Правило: '+i.ruleId+(i.packName?' · '+i.packName:''));if(i.detail)lines.push('Комментарий: '+cleanReportText(i.detail));lines.push('')});return lines.join('\n')}
function copyPlainReport(text){const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-10000px';document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy')}catch(e){}ta.remove();return ok}
function copyAnalysisReport(){const text=buildAnalysisReport();if(copyPlainReport(text))toast('Отчёт с замечаниями скопирован');else toast('Не удалось скопировать отчёт')}
function saveAnalysisReport(){const text=buildAnalysisReport(),name='Text-Editor-report-'+new Date().toISOString().slice(0,10)+'.txt';if(window.AndroidFile&&typeof AndroidFile.saveReport==='function'){AndroidFile.saveReport(text,name);return}try{const blob=new Blob([text],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1200);toast('Отчёт сохранён')}catch(e){toast('Не удалось сохранить отчёт')}}
window.onNativeReportSaved=(name)=>toast('Файл сохранён'+(name?': '+name:''));window.onNativeReportError=(msg)=>toast(msg||'Не удалось сохранить файл');
function renderAnalysis(){const box=document.getElementById('analysisContent'),sum=document.getElementById('analysisSummary'),a=currentAnalysis,ec=a.editorCount||0,rc=a.rulesCount||0;sum.innerHTML=a.warningCount?'Редакторских замечаний: <b>'+ec+'</b> · из пакета правил: <b>'+rc+'</b>.':'<b>По локальным проверкам замечаний нет.</b> Финальная вычитка всё равно нужна.';document.querySelectorAll('.analysisFilter').forEach(b=>b.classList.toggle('active',b.dataset.mode===analysisMode));let html='';if(analysisMode==='all')html+='<div class="analysisInfo"><div class="metric"><b>'+(a.metrics.headings?.length||0)+'</b><span>заголовков</span></div><div class="metric"><b>'+(a.metrics.avgSentence||0)+'</b><span>слов в среднем предложении</span></div><div class="metric"><b>'+(a.metrics.lists||0)+'</b><span>пунктов списков</span></div><div class="metric"><b>'+(a.metrics.links||0)+'</b><span>ссылок</span></div></div>';if(analysisMode==='rules'){if(activeRulePack)html+='<div class="analysisRulesNote">Пакет: <b>'+escapeHtml(activeRulePack.name)+'</b> · '+escapeHtml(activeRulePack.version)+'. Срабатывание означает совпадение с формализованным правилом пакета.</div>';else html+='<div class="analysisEmpty">Пакет правил не загружен.</div>';const rows=a.issues.filter(x=>x.type==='rules');if(rows.length){const n=analysisVisibleAndHidden('rules');html+='<div class="analysisGroup"><div class="analysisTitle"><span>Срабатывания пакета</span><span class="badge bad">'+n.total+'</span></div>'+rows.map(issueHtml).join('')+analysisOverflowNote('rules')+'</div>'}html+=renderRulePackManual();box.innerHTML=html;return}for(const g of issueGroups()){const rows=a.issues.filter(x=>x.type===g.id);if(g.id==='heading'&&analysisMode==='all'){const hs=a.metrics.headings||[];html+='<div class="analysisGroup"><div class="analysisTitle"><span>'+g.name+'</span><span class="badge '+(analysisVisibleAndHidden(g.id).total?'bad':'')+'">'+(analysisVisibleAndHidden(g.id).total||'✓')+'</span></div>';if(!hs.length)html+='<div class="analysisRow"><span class="meta">Заголовков Markdown не найдено.</span></div>';else for(const h of hs){const bad=rows.find(r=>r.start===h.start);html+=bad?issueHtml(bad):'<button class="analysisRow jump" onclick="jumpTo('+h.start+','+h.end+')"><span class="ok">H'+h.level+' · '+h.text.length+' знаков</span> '+escapeHtml(h.text)+'<span class="meta">Нажмите, чтобы перейти к заголовку</span></button>'}html+='</div>';continue}if(!rows.length)continue;const n=analysisVisibleAndHidden(g.id);html+='<div class="analysisGroup"><div class="analysisTitle"><span>'+g.name+'</span><span class="badge bad">'+n.total+'</span></div>'+rows.map(issueHtml).join('')+analysisOverflowNote(g.id)+'</div>'}if(!a.warningCount)html+='<div class="analysisEmpty">Замечаний нет. Переключите «Всё», чтобы посмотреть информационные показатели.</div>';box.innerHTML=html}
function issueHtml(i){let sev=i.severity==='critical'?'Контроль':'Обратите внимание';if(i.type==='rules')sev=i.severity==='critical'?'Критичное правило':'Правило пакета';const word=i.word?String(i.word):'',idx=currentAnalysis.issues.indexOf(i),sameType=currentAnalysis.issues.filter(x=>x.type===i.type).length;let click,cls,hint;if(i.type==='nearby'&&Number.isFinite(i.pairStart)){click='openNearbyRepeat('+i.pairStart+','+i.pairEnd+','+i.start+','+i.end+','+i.firstSentenceStart+','+i.firstSentenceEnd+','+i.secondSentenceStart+','+i.secondSentenceEnd+','+JSON.stringify(word)+')';cls='analysisRow jump nearbyWord';hint='нажмите: показать оба повтора'}else if((i.type==='phrase'||i.type==='opening')&&Array.isArray(i.occurrences)&&i.occurrences.length>1){click='openRepeatNavigator('+idx+')';cls='analysisRow jump';hint='нажмите: листать '+i.occurrences.length+' совпадений'}else if(word&&i.type==='frequent'){click='openReplacement('+i.start+','+i.end+','+JSON.stringify(word)+')';cls='analysisRow jump frequentWord';hint='нажмите: листать совпадения и выбрать замену'}else if(sameType>1){click='openIssueNavigator('+idx+')';cls='analysisRow jump'+(i.type==='rules'?' ruleRisk':'');hint='нажмите: листать '+sameType+' замечаний этого типа'}else{click='jumpTo('+i.start+','+i.end+')';cls='analysisRow jump'+(i.type==='rules'?' ruleRisk':'');hint='нажмите для перехода'}return '<button class="'+cls+'" onclick=\''+click.replace(/'/g,'&#39;')+'\'><span class="warn">'+escapeHtml(i.title)+'</span><span class="meta">'+escapeHtml(i.detail||'')+' · '+sev+' · '+hint+'</span></button>'}
'''
write(JS/'06-analysis-report.js',report)

# --- HTML: fixed drawer overlay, neutral package UI, import sheet. ---
html=read(WWW/'index.html')
html=html.replace('<title>Дзен Текст 1.11.0</title>','<title>Редактор текста</title>').replace('<span>Дзен Текст</span>','<span>Редактор текста</span>')
html=html.replace('<div class="sideDrawerBackdrop" id="sideBackdrop"','<div class="sideBackdrop" id="sideBackdrop"')
html=html.replace('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6"/></svg>','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',1)
html=html.replace('<input id="synonymFileInput" class="fileInput" type="file" accept=".json,.txt,application/json,text/plain">','<input id="synonymFileInput" class="fileInput" type="file" accept=".json,.txt,application/json,text/plain">\n      <input id="rulePackFileInput" class="fileInput" type="file" accept=".json,application/json,text/plain">')
html=re.sub(r'\n\s*<div class="switchRow" style="margin-top:13px"><span>Типографические сигналы</span>.*?<div class="smallNote">Локальная механическая проверка типографических признаков.*?</div>','',html,flags=re.S)
html=html.replace('<summary><span>Локальная проверка</span><small>Опечатки, пунктуация и механические ошибки</small></summary>','<summary><span>Пробелы и пунктуация</span><small>Механические ошибки оформления</small></summary>')
html=html.replace('<div class="switchRow"><span>Локальные опечатки и пунктуация</span><input id="proofCheck" class="switch" type="checkbox" onchange="applySettings()"></div>','<div class="switchRow"><span>Проверять пробелы и пунктуацию</span><input id="proofCheck" class="switch" type="checkbox" onchange="applySettings()"></div>')
old_rules=re.search(r'<details class="settingsGroup">\s*<summary><span>Правила Дзена</span>.*?</details>',html,re.S)
if not old_rules: raise SystemExit('rules settings block not found')
new_rules='''<details class="settingsGroup">\n      <summary><span>Пакет правил</span><small>Дополнительные требования выбранной площадки или редакции</small></summary>\n      <div class="settingsGroupBody">\n        <div id="rulePackStatus" class="ruleStatus"></div>\n        <div class="smallNote">Встроенных правил площадок нет. JSON хранится и применяется только на устройстве.</div>\n        <div class="settingActions rulePackActions"><button class="nativeBtn" type="button" onclick="downloadRulePackTemplate()">Скачать образец JSON</button><button class="nativeBtn primarySettingBtn" type="button" onclick="openRulePackImport()">Загрузить JSON</button></div>\n      </div>\n    </details>'''
html=html[:old_rules.start()]+new_rules+html[old_rules.end():]
html=html.replace('<button class="analysisFilter" data-mode="dzen" onclick="setAnalysisMode(\'dzen\')">Правила Дзена</button>','<button class="analysisFilter" data-mode="rules" onclick="setAnalysisMode(\'rules\')">Пакет правил</button>')
import_sheet='''\n<div class="sheetBackdrop" id="rulePackBackdrop" onclick="rulePackBackdropClick(event)"><div class="sheet rulePackSheet">\n  <div class="handle"></div><div class="sheetHeader"><h2>Загрузить пакет правил</h2><button class="sheetClose" type="button" onclick="closeRulePackImport()" aria-label="Закрыть">×</button></div>\n  <div class="smallNote">Поддерживается только строгий формат <b>editorial-rule-pack-v1</b>. Пакет не может выполнять код или сетевые запросы.</div>\n  <div class="settingActions"><button class="nativeBtn primarySettingBtn" type="button" onclick="chooseRulePackFile()">Выбрать JSON-файл</button></div>\n  <div class="subLabel"><span>Или вставьте JSON</span></div>\n  <textarea id="rulePackPaste" class="rulePackPaste" rows="10" spellcheck="false" placeholder="{ &quot;schema&quot;: &quot;editorial-rule-pack-v1&quot;, … }"></textarea>\n  <div class="settingActions"><button class="nativeBtn" type="button" onclick="validateRulePackPaste()">Проверить формат</button><button id="rulePackInstallBtn" class="nativeBtn primarySettingBtn" type="button" onclick="installPendingRulePack()" hidden>Установить пакет</button></div>\n  <div id="rulePackImportResult" class="rulePackImportResult"></div>\n</div></div>\n'''
html=html.replace('\n<div class="dialogBackdrop" id="confirmBackdrop"',import_sheet+'\n<div class="dialogBackdrop" id="confirmBackdrop"')
html=html.replace('js/04-dzen-analysis.js','js/04-rules-analysis.js')
write(WWW/'index.html',html)

# --- Settings/bootstrap/UI wiring. ---
settings=read(JS/'10-settings.js')
settings=settings.replace('updateDzenRulesStatus()','updateRulePackStatus()')
settings=settings.replace(';aiStyleCheck.checked=settings.aiStyleCheck!==false','')
settings=settings.replace(';dzenCheck.checked=settings.dzenCheck','')
settings=settings.replace('    aiStyleCheck:aiStyleCheck.checked,\n','').replace('    dzenCheck:dzenCheck.checked,\n','')
write(JS/'10-settings.js',settings)

boot=read(JS/'12-bootstrap.js')
boot=boot.replace('function bootstrapDzenText()','function bootstrapEditor()').replace('bootstrapDzenText();','bootstrapEditor();')
boot=boot.replace("document.title='Дзен Текст 1.11.0';","document.title='Редактор текста · прототип';")
boot=boot.replace('  dzenRules=loadDzenRules();','  activeRulePack=loadRulePack();')
boot=boot.replace('  updateDzenRulesStatus();','  updateRulePackStatus();')
boot=boot.replace("  document.getElementById('manualReplacement').addEventListener", "  document.getElementById('rulePackFileInput').addEventListener('change',e=>{\n    const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;const r=new FileReader();r.onload=()=>window.onNativeRulePackLoaded(String(r.result||''),f.name);r.onerror=()=>toast('Не удалось прочитать JSON');r.readAsText(f,'UTF-8');\n  });\n\n  document.getElementById('manualReplacement').addEventListener")
boot=boot.replace("console.error('Dzen Text bootstrap failed'","console.error('Editor bootstrap failed'")
write(JS/'12-bootstrap.js',boot)

ui=read(JS/'11-ui.js')
ui=ui.replace("document.getElementById('sideBackdrop').classList.add('open');","document.getElementById('sideBackdrop').classList.add('open');document.body.classList.add('drawer-open');")
ui=ui.replace("document.getElementById('sideBackdrop').classList.remove('open');","document.getElementById('sideBackdrop').classList.remove('open');document.body.classList.remove('drawer-open');")
ui=ui.replace("  const settingsSheet=document.getElementById('settingsBackdrop');", "  const rulePack=document.getElementById('rulePackBackdrop');\n  if(rulePack&&rulePack.classList.contains('open')){closeRulePackImport();return true}\n  const settingsSheet=document.getElementById('settingsBackdrop');")
ui=ui.replace("const IDEAS_KEY='dzenQuickIdeasV1';","const IDEAS_KEY='editorQuickIdeasV1';")
write(JS/'11-ui.js',ui)

# Local storage / neutral publication wording.
tools=read(JS/'02-text-tools.js').replace("localStorage.getItem('dzenSettings')","localStorage.getItem('editorSettings')")
tools=tools.replace('Dzen editor','publication editor').replace('Dzen expects','the target editor expects').replace('Dzen','publication')
write(JS/'02-text-tools.js',tools)
editor=read(JS/'09-editor.js').replace("localStorage.removeItem('dzenDraft')","localStorage.removeItem('editorDraft')")
write(JS/'09-editor.js',editor)
for name in ['12-articles.js','12-history.js','12-publish.js']:
    p=JS/name;s=read(p).replace('dzenDraft','editorDraft').replace('Dzen-Text','Text-Editor').replace('Дзен Текст','Редактор текста');write(p,s)

# CSS overlay correction + neutral analysis classes.
css=read(WWW/'css/editor-v2.css').replace('analysisDzenNote','analysisRulesNote').replace('dzenRisk','ruleRisk')
css=css.replace('.sideDrawer{\n  overflow:hidden!important;\n}', '.sideDrawer{\n  overflow-y:auto!important;\n  overflow-x:hidden!important;\n  overscroll-behavior:contain;\n}')
css += r'''

/* Prototype: the navigation drawer is always an overlay, never document content. */
.sideBackdrop{position:fixed!important;inset:0!important;z-index:30!important;display:none!important;background:rgba(0,0,0,.32)!important;overflow:hidden!important}
.sideBackdrop.open{display:block!important}
.sideDrawer{position:absolute!important;left:0!important;top:0!important;bottom:0!important;height:100%!important;max-height:100%!important;overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain!important}
body.drawer-open{overflow:hidden!important}
.rulePackActions{display:grid!important;grid-template-columns:1fr!important;gap:9px!important}
.rulePackPaste{width:100%;min-height:220px;resize:vertical;border:1px solid var(--border);border-radius:12px;background:var(--surface2);color:var(--text);padding:11px;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
.rulePackImportResult{margin-top:12px;font-size:12.5px;line-height:1.45}
.rulePackError{color:#a83f38}.rulePackOk{color:var(--text)}.rulePackError ul{padding-left:20px}
.analysisRulesNote{padding:11px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface2);font-size:12px;line-height:1.45;margin-bottom:10px}
'''
write(WWW/'css/editor-v2.css',css)

# Native file picker for rule packs. Reuse report saver for template export.
main=read(JAVA_NEW/'MainActivity.java')
main=main.replace('private static final int REQUEST_SAVE_ARTICLE = 1912;','private static final int REQUEST_SAVE_ARTICLE = 1912;\n    private static final int REQUEST_OPEN_RULE_PACK = 1913;')
marker='''        @JavascriptInterface\n        public void pickBackground() {'''
method='''        @JavascriptInterface\n        public void pickRulePack() {\n            runOnUiThread(() -> {\n                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);\n                intent.addCategory(Intent.CATEGORY_OPENABLE);\n                intent.setType("application/json");\n                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain"});\n                try {\n                    startActivityForResult(intent, REQUEST_OPEN_RULE_PACK);\n                } catch (Exception e) {\n                    runJs("window.onNativeRulePackError && window.onNativeRulePackError('Не удалось открыть выбор JSON')");\n                }\n            });\n        }\n\n'''
if marker not in main: raise SystemExit('pickBackground marker missing')
main=main.replace(marker,method+marker,1)
activity_marker='''        if (requestCode == REQUEST_OPEN_TEXT) {'''
rule_result='''        if (requestCode == REQUEST_OPEN_RULE_PACK) {\n            try {\n                String name = readDisplayName(uri);\n                byte[] bytes = readLimited(uri, 1024 * 1024);\n                String text = decodeText(bytes);\n                runJs("window.onNativeRulePackLoaded && window.onNativeRulePackLoaded(" + JSONObject.quote(text) + "," + JSONObject.quote(name) + ")");\n            } catch (Exception e) {\n                runJs("window.onNativeRulePackError && window.onNativeRulePackError('Не удалось прочитать JSON до 1 МБ')");\n            }\n            return;\n        }\n\n'''
if activity_marker not in main: raise SystemExit('activity marker missing')
main=main.replace(activity_marker,rule_result+activity_marker,1)
main=main.replace('ClipDescription description = new ClipDescription("Редактор текста"','ClipDescription description = new ClipDescription("Редактор текста"')
write(JAVA_NEW/'MainActivity.java',main)

# --- Generic sample/spec in repository; no bundled rules. ---
rules_dir=ROOT/'rules';rules_dir.mkdir(exist_ok=True)
old=rules_dir/'dzen-rules.json'
if old.exists(): old.unlink()
example=json.loads(json.dumps({"schema":"editorial-rule-pack-v1","id":"example-platform","name":"Пример правил площадки","version":"1.0","description":"Пользовательский локальный пакет правил.","source":"https://example.com/rules","rules":[{"id":"title-clickbait","title":"Нежелательная фраза в заголовке","type":"phrase_any","scope":"title","severity":"warning","values":["вы не поверите","шокирующая правда"],"message":"Проверьте формулировку заголовка."},{"id":"manual-title","title":"Соответствие заголовка тексту","type":"manual","severity":"warning","message":"Проверьте вручную соответствие заголовка содержанию."}]}))
write(rules_dir/'editorial-rule-pack-example.json',json.dumps(example,ensure_ascii=False,indent=2)+'\n')
write(rules_dir/'README.md','''# Editorial Rule Pack v1\n\nПриложение не содержит встроенных правил площадок. Пользователь загружает локальный JSON-пакет формата `editorial-rule-pack-v1`.\n\nПоддерживаемые типы: `word`, `phrase`, `phrase_any`, `phrase_all`, `stem`, `context`, `title_length`, `link_count`, `caps_ratio`, `manual`. Произвольный JavaScript и регулярные выражения не исполняются.\n\nГотовый пример: `editorial-rule-pack-example.json`.\n''')

# --- CI and invariant checks for a truly neutral/offline prototype. ---
workflow=read(ROOT/'.github/workflows/android-ci.yml')
workflow=workflow.replace('      - local-first-v1.9','      - local-first-v1.9\n      - prototype/editorial-rule-packs')
workflow=workflow.replace('python3 tools/check_local_first.py','python3 tools/check_offline_editor.py')
workflow=workflow.replace('name: Dzen-Text-v${{ env.APP_VERSION }}-APKs','name: Text-Editor-v${{ env.APP_VERSION }}-APKs')
write(ROOT/'.github/workflows/android-ci.yml',workflow)

inv=read(ROOT/'tools/check_editor_invariants.py').replace('app/src/main/java/ru/dzenprep/texteditor/MainActivity.java','app/src/main/java/io/github/ayuemin/texteditor/MainActivity.java')
write(ROOT/'tools/check_editor_invariants.py',inv)

offline=r'''#!/usr/bin/env python3
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1];www=root/'app/src/main/assets/www';js=www/'js';errors=[]
def require(c,m):
    if not c: errors.append(m)
manifest=(root/'app/src/main/AndroidManifest.xml').read_text(encoding='utf-8');gradle=(root/'app/build.gradle').read_text(encoding='utf-8');main=(root/'app/src/main/java/io/github/ayuemin/texteditor/MainActivity.java').read_text(encoding='utf-8');html=(www/'index.html').read_text(encoding='utf-8');all_js='\n'.join(p.read_text(encoding='utf-8') for p in sorted(js.glob('*.js')))
require('android.permission.INTERNET' not in manifest,'Offline editor must not request INTERNET')
require('fetch(' not in all_js and 'XMLHttpRequest' not in all_js and 'WebSocket' not in all_js,'Runtime JS must not contain network clients')
require("applicationId 'io.github.ayuemin.texteditor'" in gradle,'Prototype must use a new neutral applicationId')
require('ru.dzenprep' not in main,'Old Java package must be removed')
require(not (js/'04-dzen-analysis.js').exists(),'Platform-specific analyzer must be removed')
require((js/'04-rules-analysis.js').exists(),'Generic rule-pack analyzer is missing')
require('editorial-rule-pack-v1' in all_js and 'RULE_TYPES' in all_js,'Strict rule-pack schema is missing')
require('id="sideBackdrop"' in html and 'class="sideBackdrop"' in html,'Drawer backdrop DOM/CSS contract must match')
require('overflow-y:auto!important' in (www/'css/editor-v2.css').read_text(encoding='utf-8'),'Drawer must scroll internally')
require('DEFAULT_DZEN_RULES' not in all_js,'No bundled platform rule database is allowed')
require('dzenRules' not in all_js and 'activeDzenRules' not in all_js,'Legacy platform rule state must be removed')
require('Правила Дзена' not in html,'Settings must be platform-neutral')
require(not (root/'rules/dzen-rules.json').exists(),'Bundled platform rules file must be removed')
# New install: app source must not retain the old product/platform identity.
for p in (root/'app/src/main').rglob('*'):
    if not p.is_file() or p.suffix.lower() in {'.png','.jpg','.jpeg','.webp','.ttf','.otf','.woff','.woff2'}: continue
    try: text=p.read_text(encoding='utf-8')
    except Exception: continue
    if re.search(r'dzen|дзен',text,re.I): errors.append('Old Dzen identity remains in '+str(p.relative_to(root)))
if errors: raise SystemExit('\n'.join('OFFLINE EDITOR: '+e for e in errors))
print('Offline neutral editor guard OK')
'''
write(ROOT/'tools/check_offline_editor.py',offline)
old_guard=ROOT/'tools/check_local_first.py'
if old_guard.exists(): old_guard.unlink()

# Neutralize remaining app-source identifiers/comments/keys. New app has no migration requirement.
for p in (ROOT/'app/src/main').rglob('*'):
    if not p.is_file() or p.suffix.lower() not in {'.java','.xml','.html','.js','.css'}: continue
    text=read(p)
    text=text.replace('dzenSettings','editorSettings').replace('dzenDraft','editorDraft').replace('dzenUser','editorUser').replace('dzenQuick','editorQuick').replace('dzenKeyboardState','editorKeyboardState')
    text=text.replace('Дзен Текст','Редактор текста').replace('Dzen-Text','Text-Editor').replace('Dzen Text','Text Editor')
    text=text.replace('Дзен','площадка').replace('Dzen','platform').replace('dzen','platform')
    write(p,text)

# Undo accidental package token replacement if any happened after Java move.
for name in ['MainActivity.java','DocumentStore.java']:
    p=JAVA_NEW/name;text=read(p).replace('io.github.ayuemin.texteditor','io.github.ayuemin.texteditor');write(p,text)

print('Prototype transformation complete')
