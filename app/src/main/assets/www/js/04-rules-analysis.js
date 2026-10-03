const RULE_PACK_SCHEMA='editorial-rule-pack-v1';
const RULE_PACK_KEY='editorialRulePackV1';
let activeRulePack=null;
let pendingRulePack=null;
let lastRulePackDiagnostics={checked:0,matches:0,errors:[]};

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
function finiteNumber(v){const n=Number(v);return Number.isFinite(n)?n:null}
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
    const scope=type==='manual'?'all':String(raw.scope||'all');if(type!=='manual'&&!RULE_SCOPES.has(scope)){errors.push(prefix+'scope: all, title или body.');continue}
    const rule={id,type,title,message,severity,scope};
    if(['word','phrase','phrase_any','phrase_all','stem'].includes(type)){
      rule.values=packStrings(raw.values,100);if(!rule.values.length){errors.push(prefix+'values должен содержать хотя бы одно значение.');continue}
      if(type==='phrase'&&rule.values.length!==1){errors.push(prefix+'type phrase требует ровно одно значение в values.');continue}
    }else if(type==='context'){
      rule.phrases=packStrings(raw.phrases,100);rule.stems=packStrings(raw.stems,100);rule.required_nearby=packStrings(raw.required_nearby,100);rule.exclude_nearby=packStrings(raw.exclude_nearby,100);
      if(!rule.phrases.length&&!rule.stems.length){errors.push(prefix+'context требует phrases и/или stems.');continue}
      const windowRaw=raw.window==null?220:finiteNumber(raw.window),scoreRaw=raw.min_score==null?2:finiteNumber(raw.min_score);
      if(windowRaw==null||windowRaw<=0||windowRaw>5000){errors.push(prefix+'context.window должен быть числом от 1 до 5000.');continue}
      if(scoreRaw==null||scoreRaw<=0||scoreRaw>100){errors.push(prefix+'context.min_score должен быть числом от 1 до 100.');continue}
      rule.window=Math.round(windowRaw);rule.min_score=scoreRaw;
    }else if(type==='title_length'){
      const minRaw=raw.min==null?0:finiteNumber(raw.min),maxRaw=raw.max==null?0:finiteNumber(raw.max);
      if(minRaw==null||maxRaw==null||minRaw<0||maxRaw<0){errors.push(prefix+'title_length min/max должны быть неотрицательными числами.');continue}
      rule.min=minRaw;rule.max=maxRaw;if(!rule.min&&!rule.max){errors.push(prefix+'title_length требует min и/или max.');continue}
      if(rule.min&&rule.max&&rule.min>rule.max){errors.push(prefix+'title_length требует min <= max.');continue}rule.scope='title';
    }else if(type==='link_count'){
      const maxRaw=finiteNumber(raw.max);if(maxRaw==null||maxRaw<0){errors.push(prefix+'link_count требует max >= 0.');continue}rule.max=Math.floor(maxRaw);rule.scope='all';
    }else if(type==='caps_ratio'){
      rule.max_ratio=finiteNumber(raw.max_ratio);const minLetters=raw.min_letters==null?10:finiteNumber(raw.min_letters);
      if(!(rule.max_ratio>0&&rule.max_ratio<=1)){errors.push(prefix+'caps_ratio требует 0 < max_ratio <= 1.');continue}
      if(minLetters==null||minLetters<1){errors.push(prefix+'caps_ratio.min_letters должен быть >= 1.');continue}rule.min_letters=Math.floor(minLetters);
    }
    if(type==='manual')manualCount++;else autoCount++;clean.push(rule)
  }
  const pack={schema:RULE_PACK_SCHEMA,id:String(input.id||''),name:String(input.name||'').trim(),version:String(input.version||'').trim(),description:String(input.description||'').trim().slice(0,500),source:String(input.source||'').trim().slice(0,500),rules:clean};
  if(typeof input.test_text==='string')pack.test_text=input.test_text.slice(0,20000);
  return {ok:errors.length===0,errors,pack,autoCount,manualCount};
}
function loadRulePack(){try{const raw=localStorage.getItem(RULE_PACK_KEY);if(!raw)return null;const result=validateRulePackObject(JSON.parse(raw));return result.ok?result.pack:null}catch(e){return null}}
function saveRulePack(pack){try{localStorage.setItem(RULE_PACK_KEY,JSON.stringify(pack));return true}catch(e){toast('Не удалось сохранить пакет правил');return false}}
function manualRuleItems(){return activeRulePack?activeRulePack.rules.filter(r=>r.type==='manual'):[]}
function activeAutoRules(){return activeRulePack?activeRulePack.rules.filter(r=>r.type!=='manual'):[]}
function updateRulePackStatus(){
  const el=document.getElementById('rulePackStatus');if(!el)return;
  const actions=el.parentElement&&el.parentElement.querySelector('.rulePackActions');
  let removeBtn=document.getElementById('rulePackRemoveBtn');
  if(actions&&!removeBtn){removeBtn=document.createElement('button');removeBtn.id='rulePackRemoveBtn';removeBtn.className='nativeBtn';removeBtn.type='button';removeBtn.textContent='Удалить пакет';removeBtn.onclick=removeRulePack;actions.appendChild(removeBtn)}
  const importBtn=actions&&Array.from(actions.querySelectorAll('button')).find(b=>String(b.getAttribute('onclick')||'').includes('openRulePackImport'));
  if(!activeRulePack){el.innerHTML='<b>Пакет не установлен.</b><br>Проверяется локально по загруженному JSON.';if(removeBtn)removeBtn.hidden=true;if(importBtn)importBtn.textContent='Загрузить JSON';return}
  const a=activeAutoRules().length,m=manualRuleItems().length;
  el.innerHTML='<b>'+escapeHtml(activeRulePack.name)+'</b><br>Версия '+escapeHtml(activeRulePack.version)+'<br>Автоматических правил: <b>'+a+'</b><br>Ручных правил: <b>'+m+'</b><br><b>Статус: применяется</b>'+(activeRulePack.source?'<br>Источник: '+escapeHtml(activeRulePack.source):'');
  if(removeBtn)removeBtn.hidden=false;if(importBtn)importBtn.textContent='Загрузить другой JSON';
}
function rulePackTemplate(){return JSON.stringify({schema:RULE_PACK_SCHEMA,id:'example-platform',name:'Пример правил площадки',version:'1.1',description:'Самопроверяемый локальный пример пакета правил.',source:'https://example.com/rules',test_text:'Вы не поверите: банан и очень длинный тестовый заголовок\n\nДоход без риска гарантирован каждому.\nБанан упомянут ещё раз.\nhttps://example.com/one\nhttps://example.com/two',rules:[{id:'forbidden-word',title:'Найдено контрольное слово',type:'word',scope:'all',severity:'warning',values:['банан'],message:'Слово «банан» найдено тестовым пакетом.'},{id:'title-clickbait',title:'Нежелательная фраза в заголовке',type:'phrase_any',scope:'title',severity:'warning',values:['вы не поверите','шокирующая правда'],message:'Проверьте формулировку заголовка.'},{id:'finance-context',title:'Финансовое обещание — проверить контекст',type:'context',scope:'all',severity:'warning',stems:['доход'],required_nearby:['без риска','гарантирован'],exclude_nearby:['не гарантируется','можно потерять'],window:90,min_score:2,message:'Проверьте, нет ли безусловного обещания результата.'},{id:'title-too-long',title:'Слишком длинный заголовок',type:'title_length',scope:'title',severity:'warning',max:35,message:'Сократите тестовый заголовок.'},{id:'too-many-links',title:'Слишком много ссылок',type:'link_count',scope:'all',severity:'warning',max:1,message:'В тестовом тексте больше одной ссылки.'},{id:'manual-title',title:'Соответствие заголовка тексту',type:'manual',severity:'warning',message:'Перед публикацией вручную проверьте соответствие заголовка содержанию.'}]},null,2)}
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
  pendingRulePack=result.pack;box.innerHTML='<div class="rulePackOk"><b>'+escapeHtml(result.pack.name)+'</b> · '+escapeHtml(result.pack.version)+(name?'<br>Файл: '+escapeHtml(name):'')+'<br>Автоматических правил: <b>'+result.autoCount+'</b> · ручных: <b>'+result.manualCount+'</b>'+(result.pack.test_text?'<br><span class="smallNote">В JSON есть test_text для ручной проверки образца.</span>':'')+'</div>';document.getElementById('rulePackInstallBtn').hidden=false;
}
function validateRulePackPaste(){validateRulePackText(document.getElementById('rulePackPaste').value,'')}
function installPendingRulePack(){if(!pendingRulePack)return;if(!saveRulePack(pendingRulePack))return;activeRulePack=pendingRulePack;updateRulePackStatus();closeRulePackImport();let analysis=null;try{analysis=analyzeText()}catch(e){console.error(e)}const d=analysis&&analysis.ruleDiagnostics||lastRulePackDiagnostics;toast('Пакет установлен. Проверено '+(d.checked||0)+' правил, найдено '+(d.matches||0)+' замечаний.')}
async function removeRulePack(){let ok=true;if(typeof appConfirm==='function')ok=await appConfirm('Удалить пакет правил?','Пакет и его замечания будут удалены только из приложения.','Удалить',true);if(!ok)return;try{localStorage.removeItem(RULE_PACK_KEY)}catch(e){}activeRulePack=null;lastRulePackDiagnostics={checked:0,matches:0,errors:[]};updateRulePackStatus();try{analyzeText()}catch(e){console.error(e)}toast('Пакет правил удалён')}
window.onNativeRulePackLoaded=(text,name)=>{openRulePackImport();document.getElementById('rulePackPaste').value=String(text||'');validateRulePackText(text,name||'')};
window.onNativeRulePackError=(msg)=>toast(msg||'Не удалось загрузить JSON');

function articleTitleFromSource(src,headings){
  const h1=(headings||[]).find(h=>h.level===1);if(h1){let lineEnd=src.indexOf('\n',h1.lineStart);if(lineEnd<0)lineEnd=src.length;return {text:h1.text,start:h1.start,end:h1.end,lineStart:h1.lineStart,lineEnd,markdown:true}}
  const re=/^([^\r\n]*\S[^\r\n]*)/gm;let m;while((m=re.exec(src))){const raw=m[1],trimmed=raw.trim();if(!trimmed)continue;const lead=raw.indexOf(trimmed),start=m.index+lead,end=start+trimmed.length;return {text:trimmed,start,end,lineStart:m.index,lineEnd:m.index+raw.length,markdown:false}}
  return null
}
function maskRangePreserveNewlines(src,start,end){return src.slice(0,start)+src.slice(start,end).replace(/[^\r\n]/g,' ')+src.slice(end)}
function ruleScopeSource(src,titleObj,scope){if(scope==='title')return titleObj?{text:titleObj.text,base:titleObj.start}:{text:'',base:0};if(scope==='body'&&titleObj)return {text:maskRangePreserveNewlines(src,titleObj.lineStart,titleObj.lineEnd),base:0};return {text:src,base:0}}
function addPackIssue(issues,rule,start,end,detail){const it=addSimpleIssue(issues,'rules',rule.title,detail||rule.message,start,end,rule.severity);if(it){it.ruleId=rule.id;it.packName=activeRulePack?activeRulePack.name:''}return it}
function containsAny(text,values){const lower=text.toLocaleLowerCase('ru-RU');return (values||[]).some(v=>lower.includes(String(v).toLocaleLowerCase('ru-RU')))}
function analyzeRulePack(src,headings,issues){
  const diagnostics={checked:0,matches:0,errors:[]};lastRulePackDiagnostics=diagnostics;if(!activeRulePack)return diagnostics;const titleObj=articleTitleFromSource(src,headings);
  for(const rule of activeAutoRules()){
    if(diagnostics.matches>=100)break;diagnostics.checked++;
    try{
      const scoped=ruleScopeSource(src,titleObj,rule.scope),source=scoped.text,lower=source.toLocaleLowerCase('ru-RU');if(!source&&rule.scope==='title')continue;
      if(['word','phrase','phrase_any','stem'].includes(rule.type)){
        const mode=rule.type==='stem'?'stem':rule.type==='word'?'word':'phrase';let shown=0;
        for(const raw of rule.values){const q=String(raw).toLocaleLowerCase('ru-RU');for(const at of ruleOccurrences(lower,q,6,mode)){if(addPackIssue(issues,rule,scoped.base+at,scoped.base+at+q.length,rule.message+' · «'+raw+'»'))diagnostics.matches++;shown++;if(shown>=6||diagnostics.matches>=100)break}if(shown>=6||diagnostics.matches>=100)break}
      }else if(rule.type==='phrase_all'){
        const found=rule.values.map(v=>{const q=String(v).toLocaleLowerCase('ru-RU'),hits=ruleOccurrences(lower,q,1,'phrase');return {v,at:hits.length?hits[0]:-1}});if(found.every(x=>x.at>=0)){const first=found.sort((a,b)=>a.at-b.at)[0];if(addPackIssue(issues,rule,scoped.base+first.at,scoped.base+first.at+String(first.v).length,rule.message))diagnostics.matches++}
      }else if(rule.type==='context'){
        const candidates=[];for(const p of rule.phrases||[]){const q=String(p).toLocaleLowerCase('ru-RU');for(const at of ruleOccurrences(lower,q,6,'phrase'))candidates.push({at,len:q.length,label:p,score:3})}for(const s of rule.stems||[]){const q=String(s).toLocaleLowerCase('ru-RU');for(const at of ruleOccurrences(lower,q,6,'stem'))candidates.push({at,len:q.length,label:s,score:1})}candidates.sort((a,b)=>a.at-b.at);let shown=0;
        for(const c of candidates){if(shown>=6||diagnostics.matches>=100)break;const ws=Math.max(0,c.at-rule.window),we=Math.min(lower.length,c.at+c.len+rule.window),windowText=lower.slice(ws,we);if((rule.exclude_nearby||[]).length&&containsAny(windowText,rule.exclude_nearby))continue;const required=(rule.required_nearby||[]),hasRequired=!required.length||containsAny(windowText,required);if(!hasRequired)continue;let score=c.score+(required.length?1:0);if(score<rule.min_score)continue;if(addPackIssue(issues,rule,scoped.base+c.at,scoped.base+c.at+c.len,rule.message+' · сигнал «'+c.label+'»'))diagnostics.matches++;shown++}
      }else if(rule.type==='title_length'&&titleObj){const len=titleObj.text.length;if((rule.min&&len<rule.min)||(rule.max&&len>rule.max)){if(addPackIssue(issues,rule,titleObj.start,titleObj.end,rule.message+' · '+len+' знаков'))diagnostics.matches++}}
      else if(rule.type==='link_count'){const urls=Array.from(source.matchAll(/https?:\/\/[^\s)]+/g));if(urls.length>rule.max){const u=urls[Math.min(rule.max,urls.length-1)];if(addPackIssue(issues,rule,scoped.base+u.index,scoped.base+u.index+u[0].length,rule.message+' · ссылок: '+urls.length))diagnostics.matches++}}
      else if(rule.type==='caps_ratio'){const letters=Array.from(source).filter(c=>/[A-Za-zА-Яа-яЁё]/.test(c));if(letters.length>=rule.min_letters){const upp=letters.filter(c=>c===c.toUpperCase()&&c!==c.toLowerCase()).length,ratio=upp/letters.length;if(ratio>rule.max_ratio){let first=source.search(/[A-Za-zА-Яа-яЁё]/);if(first<0)first=0;const end=Math.min(src.length,scoped.base+first+Math.max(1,Math.min(source.length-first,80)));if(addPackIssue(issues,rule,scoped.base+first,end,rule.message+' · заглавных: '+Math.round(ratio*100)+'%'))diagnostics.matches++}}}
    }catch(e){diagnostics.errors.push({ruleId:rule.id,message:String(e&&e.message||e||'Неизвестная ошибка')});console.error('Rule pack error',rule.id,e)}
  }
  lastRulePackDiagnostics=diagnostics;return diagnostics
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
