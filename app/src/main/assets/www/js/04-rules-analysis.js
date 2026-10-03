const RULE_PACK_SCHEMA='editorial-rule-pack-v1';
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
