const DZEN_AI_KNOWLEDGE_KEY='dzenAiKnowledgeV1';
let aiDzenIssues=[];
let aiDzenSource='';
let aiDzenBusy=false;
const aiNativeWaiters=new Map();
let aiNativeSeq=0;

function dzenAiBridgeAvailable(){
  return !!(window.AndroidDzenAI&&typeof AndroidDzenAI.chat==='function'&&typeof AndroidDzenAI.fetchPage==='function');
}
function dzenAiHasKey(){
  try{return !!(window.AndroidDzenAI&&typeof AndroidDzenAI.hasKey==='function'&&AndroidDzenAI.hasKey())}catch(e){return false}
}
function dzenAiSettingsSignature(){
  return JSON.stringify({
    base:String(settings.dzenAiBaseUrl||'').trim(),
    model:String(settings.dzenAiModel||'').trim(),
    sources:parseDzenAiSources()
  });
}
function parseDzenAiSources(){
  return String(settings.dzenAiSources||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
}
function dzenAiKnowledge(){
  try{
    const value=JSON.parse(localStorage.getItem(DZEN_AI_KNOWLEDGE_KEY)||'null');
    return value&&Array.isArray(value.items)?value:null;
  }catch(e){return null}
}
function dzenAiKnowledgeCurrent(value){
  return !!(value&&value.signature===dzenAiSettingsSignature()&&Array.isArray(value.items)&&value.items.length);
}
function clearAiDzenIssues(){
  aiDzenIssues=[];
  aiDzenSource='';
}
function clearDzenAiKnowledge(){
  localStorage.removeItem(DZEN_AI_KNOWLEDGE_KEY);
  updateDzenAiStatus();
  toast('AI-база Дзена очищена');
}
function syncDzenAiVisibility(){
  const box=document.getElementById('dzenAiFields');
  if(box)box.hidden=(document.getElementById('dzenCheckMode')?.value||settings.dzenCheckMode)!=='ai';
}
function syncDzenAiSettingsUI(){
  const mode=document.getElementById('dzenCheckMode');
  const base=document.getElementById('dzenAiBaseUrl');
  const model=document.getElementById('dzenAiModel');
  const sources=document.getElementById('dzenAiSources');
  const prompt=document.getElementById('dzenAiStylePrompt');
  const key=document.getElementById('dzenAiApiKey');
  if(mode)mode.value=settings.dzenCheckMode||'builtin';
  if(base)base.value=settings.dzenAiBaseUrl||'https://openrouter.ai/api/v1';
  if(model)model.value=settings.dzenAiModel||'openrouter/free';
  if(sources)sources.value=settings.dzenAiSources||'https://dzen.ru/help/ru/requirements/rules.html';
  if(prompt)prompt.value=settings.dzenAiStylePrompt||'';
  if(key){
    key.value='';
    key.placeholder=dzenAiHasKey()?'Ключ сохранён на устройстве':'Введите API-ключ';
  }
  syncDzenAiVisibility();
  updateDzenAiStatus();
}
function updateDzenAiStatus(message=''){
  const el=document.getElementById('dzenAiStatus');
  if(!el)return;
  if(message){el.textContent=message;return}
  const k=dzenAiKnowledge();
  const key=dzenAiHasKey()?'ключ сохранён':'ключ не задан';
  if(!k){
    el.innerHTML='Подключение: <b>'+key+'</b><br>AI-база ещё не собрана.';
    return;
  }
  const date=k.builtAt?new Date(k.builtAt).toLocaleString('ru-RU'):'—';
  const state=dzenAiKnowledgeCurrent(k)?'актуальна для этих настроек':'нужно обновить';
  el.innerHTML='Подключение: <b>'+key+'</b><br>AI-база: <b>'+state+'</b> · страниц: '+Number(k.pages||0)+' · пунктов: '+k.items.length+'<br>Собрана: '+escapeHtml(date);
}
function onDzenCheckModeChanged(){
  applySettings();
  syncDzenAiVisibility();
}
function saveDzenAiApiKey(){
  const input=document.getElementById('dzenAiApiKey');
  const key=String(input?.value||'').trim();
  if(!key){toast(dzenAiHasKey()?'Ключ уже сохранён':'Введите API-ключ');return}
  try{
    if(!window.AndroidDzenAI||typeof AndroidDzenAI.saveKey!=='function'||!AndroidDzenAI.saveKey(key))throw new Error('save');
    input.value='';
    input.placeholder='Ключ сохранён на устройстве';
    updateDzenAiStatus();
    toast('API-ключ сохранён');
  }catch(e){toast('Не удалось сохранить API-ключ')}
}
async function clearDzenAiApiKey(){
  if(!dzenAiHasKey()){toast('API-ключ не сохранён');return}
  if(!await appConfirm('Удалить API-ключ?','Ключ будет удалён только из приложения.','Удалить',true))return;
  try{AndroidDzenAI.clearKey()}catch(e){}
  syncDzenAiSettingsUI();
  toast('API-ключ удалён');
}
function aiNativePromise(kind,invoke){
  if(!dzenAiBridgeAvailable())return Promise.reject(new Error('AI-проверка доступна только в установленном приложении'));
  const id=kind+'_'+Date.now()+'_'+(++aiNativeSeq);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      aiNativeWaiters.delete(id);
      reject(new Error(kind==='page'?'Источник не ответил вовремя':'AI API не ответил вовремя'));
    },kind==='page'?35000:120000);
    aiNativeWaiters.set(id,{kind,resolve,reject,timer});
    try{invoke(id)}catch(e){
      clearTimeout(timer);aiNativeWaiters.delete(id);reject(e);
    }
  });
}
window.onNativeAiPageResult=(requestId,url,content)=>{
  const w=aiNativeWaiters.get(String(requestId));if(!w)return;
  clearTimeout(w.timer);aiNativeWaiters.delete(String(requestId));w.resolve({url:String(url||''),content:String(content||'')});
};
window.onNativeAiChatResult=(requestId,content)=>{
  const w=aiNativeWaiters.get(String(requestId));if(!w)return;
  clearTimeout(w.timer);aiNativeWaiters.delete(String(requestId));w.resolve(String(content||''));
};
window.onNativeAiError=(requestId,message)=>{
  const w=aiNativeWaiters.get(String(requestId));if(!w)return;
  clearTimeout(w.timer);aiNativeWaiters.delete(String(requestId));w.reject(new Error(String(message||'Ошибка AI')));
};
function aiFetchPage(url){
  return aiNativePromise('page',id=>AndroidDzenAI.fetchPage(String(url||''),id));
}
function aiChat(systemPrompt,userPrompt){
  const base=String(settings.dzenAiBaseUrl||'').trim();
  const model=String(settings.dzenAiModel||'').trim();
  if(!base||!model)return Promise.reject(new Error('Заполните API URL и модель'));
  if(!dzenAiHasKey())return Promise.reject(new Error('Сохраните API-ключ'));
  return aiNativePromise('chat',id=>AndroidDzenAI.chat(base,model,String(systemPrompt||''),String(userPrompt||''),id));
}
function parseAiJson(raw){
  let s=String(raw||'').trim();
  const fenced=s.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i);
  if(fenced)s=fenced[1].trim();
  const first=s.indexOf('{'),last=s.lastIndexOf('}');
  if(first>=0&&last>first)s=s.slice(first,last+1);
  return JSON.parse(s);
}
function htmlPageData(raw,url){
  const doc=new DOMParser().parseFromString(String(raw||''),'text/html');
  const links=[];
  doc.querySelectorAll('a[href]').forEach(a=>{
    try{links.push(new URL(a.getAttribute('href'),url).href)}catch(e){}
  });
  doc.querySelectorAll('script,style,noscript,svg,canvas,header,footer,nav,form').forEach(x=>x.remove());
  const title=(doc.querySelector('title')?.textContent||doc.querySelector('h1')?.textContent||url).replace(/\s+/g,' ').trim();
  let text=(doc.body?.innerText||doc.body?.textContent||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();
  if(text.length>12000)text=text.slice(0,12000);
  return {url,title,text,links};
}
function sourceScope(seed){
  try{
    const u=new URL(seed);
    if(/(^|\.)dzen\.ru$/i.test(u.hostname)&&u.pathname.startsWith('/help/ru/'))return {origin:u.origin,prefix:'/help/ru/'};
    const slash=u.pathname.lastIndexOf('/');
    return {origin:u.origin,prefix:u.pathname.slice(0,slash+1)||'/'};
  }catch(e){return null}
}
function allowedAiSourceLink(url,seeds){
  let u;try{u=new URL(url)}catch(e){return false}
  if(u.protocol!=='https:')return false;
  u.hash='';
  const clean=u.href;
  if(/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|apk)(?:\?|$)/i.test(clean))return false;
  return seeds.some(seed=>{
    const scope=sourceScope(seed);return scope&&u.origin===scope.origin&&u.pathname.startsWith(scope.prefix);
  });
}
async function crawlDzenAiSources(){
  const seeds=parseDzenAiSources();
  if(!seeds.length)throw new Error('Добавьте хотя бы один URL Дзена');
  const queue=[...seeds],seen=new Set(),pages=[],maxPages=18;
  let totalChars=0;
  while(queue.length&&pages.length<maxPages&&totalChars<90000){
    const next=queue.shift();
    let canonical;try{const u=new URL(next);u.hash='';canonical=u.href}catch(e){continue}
    if(seen.has(canonical)||!allowedAiSourceLink(canonical,seeds))continue;
    seen.add(canonical);
    updateDzenAiStatus('Читаю базу Дзена: '+(pages.length+1)+'/'+maxPages+'…');
    let fetched;
    try{fetched=await aiFetchPage(canonical)}catch(e){continue}
    const data=htmlPageData(fetched.content,canonical);
    if(data.text.length>180){
      pages.push({url:data.url,title:data.title,text:data.text});
      totalChars+=data.text.length;
    }
    for(const link of data.links){
      if(queue.length+seen.size>90)break;
      if(allowedAiSourceLink(link,seeds)&&!seen.has(link))queue.push(link);
    }
  }
  if(!pages.length)throw new Error('Не удалось получить текст из указанных страниц');
  return pages;
}
function packKnowledgeBatches(pages,maxChars=30000){
  const batches=[];let current='',count=0;
  for(const p of pages){
    const block='\n\n=== SOURCE ===\nURL: '+p.url+'\nTITLE: '+p.title+'\nTEXT:\n'+p.text;
    if(current&&current.length+block.length>maxChars){batches.push({text:current,count});current='';count=0}
    current+=block;count++;
  }
  if(current)batches.push({text:current,count});
  return batches;
}
function normalizeKnowledgeItems(value){
  const items=Array.isArray(value?.items)?value.items:[];
  return items.map(x=>({
    kind:String(x?.kind||'recommendation').slice(0,32),
    title:String(x?.title||'').trim().slice(0,180),
    guidance:String(x?.guidance||x?.rule||'').trim().slice(0,900),
    source_url:String(x?.source_url||x?.source||'').trim().slice(0,800)
  })).filter(x=>x.title&&x.guidance).slice(0,140);
}
async function buildDzenAiKnowledge(options={}){
  if(aiDzenBusy)return false;
  if(!dzenAiBridgeAvailable()){toast('AI-проверка доступна только в установленном приложении');return false}
  if(!dzenAiHasKey()){toast('Сначала сохраните API-ключ');return false}
  if(!String(settings.dzenAiBaseUrl||'').trim()||!String(settings.dzenAiModel||'').trim()){toast('Заполните API URL и модель');return false}
  aiDzenBusy=true;
  try{
    updateDzenAiStatus('Получаю страницы Дзена…');
    const pages=await crawlDzenAiSources();
    const batches=packKnowledgeBatches(pages);
    let items=[];
    const system='Ты создаёшь базу знаний для редактора статей. Используй только предоставленные официальные материалы. Выделяй обязательные правила, рекомендации, требования к качеству и оформлению, а также сведения, которые могут влиять на распространение и показатели публикации. Не придумывай норм и не делай выводов, которых нет в источнике. Верни только JSON: {"items":[{"kind":"rule|recommendation|quality|distribution|format","title":"кратко","guidance":"что учитывать автору","source_url":"точный URL из материала"}]}.';
    for(let i=0;i<batches.length;i++){
      updateDzenAiStatus('AI разбирает материалы: '+(i+1)+'/'+batches.length+'…');
      const raw=await aiChat(system,batches[i].text);
      items.push(...normalizeKnowledgeItems(parseAiJson(raw)));
    }
    if(items.length>1){
      const compact=JSON.stringify({items:items.slice(0,140)});
      updateDzenAiStatus('Убираю повторы и собираю базу…');
      const mergeSystem='Объедини пункты базы знаний без потери смысла. Удали только явные дубли. Не добавляй новых правил. Сохраняй source_url. Верни только JSON вида {"items":[{"kind":"rule|recommendation|quality|distribution|format","title":"...","guidance":"...","source_url":"..."}]}.';
      try{
        const merged=normalizeKnowledgeItems(parseAiJson(await aiChat(mergeSystem,compact.slice(0,55000))));
        if(merged.length)items=merged;
      }catch(e){}
    }
    const knowledge={schema:1,builtAt:Date.now(),signature:dzenAiSettingsSignature(),baseUrl:String(settings.dzenAiBaseUrl||''),model:String(settings.dzenAiModel||''),sources:parseDzenAiSources(),pages:pages.length,items:items.slice(0,120)};
    if(!knowledge.items.length)throw new Error('Модель не выделила полезных правил');
    localStorage.setItem(DZEN_AI_KNOWLEDGE_KEY,JSON.stringify(knowledge));
    updateDzenAiStatus();
    if(!options.quiet)toast('AI-база Дзена обновлена');
    return true;
  }catch(e){
    updateDzenAiStatus();
    toast(e.message||'Не удалось собрать AI-базу Дзена');
    return false;
  }finally{aiDzenBusy=false}
}
function shouldRunAiDzenCheck(){
  return settings.dzenCheck!==false&&(settings.dzenCheckMode||'builtin')==='ai';
}
async function ensureDzenAiKnowledge(){
  let k=dzenAiKnowledge();
  if(dzenAiKnowledgeCurrent(k))return k;
  const ok=await buildDzenAiKnowledge({quiet:true});
  if(!ok)return null;
  k=dzenAiKnowledge();
  return dzenAiKnowledgeCurrent(k)?k:null;
}
function splitArticleForAi(src,maxChars=18000){
  const out=[];let start=0;
  while(start<src.length){
    let end=Math.min(src.length,start+maxChars);
    if(end<src.length){
      const cut=src.lastIndexOf('\n\n',end);
      if(cut>start+Math.floor(maxChars*.55))end=cut+2;
    }
    out.push({start,text:src.slice(start,end)});
    start=end;
  }
  return out;
}
function findAiQuote(chunk,quote){
  const q=String(quote||'').trim();
  if(!q)return null;
  let at=chunk.text.indexOf(q);
  if(at<0)at=chunk.text.toLocaleLowerCase('ru-RU').indexOf(q.toLocaleLowerCase('ru-RU'));
  if(at<0)return null;
  return {start:chunk.start+at,end:chunk.start+at+q.length,quote:q};
}
function aiIssueFromItem(item,type,chunk){
  const found=findAiQuote(chunk,item?.quote);
  if(!found)return null;
  const title=String(item?.title||'AI-замечание').trim().slice(0,180);
  let detail=String(item?.reason||item?.detail||'Проверьте фрагмент.').trim().slice(0,900);
  const source=String(item?.source_url||'').trim();
  if(source)detail+=' · Источник: '+source;
  return {type,title,detail,start:found.start,end:found.end,severity:String(item?.severity||'warning')==='critical'?'critical':'warning',ai:true};
}
function normalizeAiArticleResult(value,chunk){
  const out=[];
  for(const x of Array.isArray(value?.dzen_issues)?value.dzen_issues:[]){const it=aiIssueFromItem(x,'dzen',chunk);if(it)out.push(it)}
  for(const x of Array.isArray(value?.quality_issues)?value.quality_issues:[]){const it=aiIssueFromItem(x,'dzen',chunk);if(it)out.push(it)}
  for(const x of Array.isArray(value?.style_issues)?value.style_issues:[]){const it=aiIssueFromItem(x,'aiStyle',chunk);if(it)out.push(it)}
  return out;
}
async function startAiDzenArticleCheck(src){
  const source=String(src||editor.value||'');
  if(!source.trim()){setCheckRunning(false);return}
  if(aiDzenBusy){toast('AI уже занят обновлением базы');setCheckRunning(false);return}
  aiDzenBusy=true;
  clearAiDzenIssues();
  try{
    setCheckRunning(true);
    toast('AI проверяет статью…');
    const knowledge=await ensureDzenAiKnowledge();
    if(!knowledge)throw new Error('Нет актуальной AI-базы Дзена');
    const compactKnowledge=JSON.stringify({items:knowledge.items.slice(0,100)}).slice(0,30000);
    const stylePrompt=String(settings.dzenAiStylePrompt||'').trim();
    const chunks=splitArticleForAi(source);
    const result=[];
    const system='Ты редактор Яндекс Дзена. Проверяй только по переданной базе знаний и отдельно ищи стилистические признаки машинного текста по пользовательской инструкции. Не утверждай, что текст создан ИИ: отмечай только конкретные признаки. Каждое замечание обязано содержать точную короткую цитату из ARTICLE_CHUNK. Не выдумывай цитаты. Верни только JSON: {"dzen_issues":[{"title":"...","reason":"...","quote":"точная цитата","severity":"warning|critical","source_url":"..."}],"quality_issues":[{"title":"...","reason":"...","quote":"точная цитата","severity":"warning","source_url":"..."}],"style_issues":[{"title":"...","reason":"...","quote":"точная цитата","severity":"warning"}]}.';
    for(let i=0;i<chunks.length;i++){
      updateDzenAiStatus('Проверяю статью: '+(i+1)+'/'+chunks.length+'…');
      const prompt='KNOWLEDGE:\n'+compactKnowledge+'\n\nSTYLE_INSTRUCTION:\n'+stylePrompt+'\n\nARTICLE_CHUNK '+(i+1)+'/'+chunks.length+'; absolute_offset='+chunks[i].start+':\n'+chunks[i].text;
      const raw=await aiChat(system,prompt);
      result.push(...normalizeAiArticleResult(parseAiJson(raw),chunks[i]));
    }
    const seen=new Set();
    aiDzenIssues=result.filter(x=>{const k=x.type+'|'+x.title+'|'+x.start+'|'+x.end;if(seen.has(k))return false;seen.add(k);return true}).slice(0,180);
    aiDzenSource=source;
    analyzeText();
    document.getElementById('analysisBackdrop').classList.add('open');
    setAnalysisMode('problems');
    updateDzenAiStatus();
    toast(aiDzenIssues.length?'AI-проверка: замечаний '+aiDzenIssues.length:'AI-проверка: дополнительных замечаний нет');
  }catch(e){
    clearAiDzenIssues();
    updateDzenAiStatus();
    toast(e.message||'AI-проверка не выполнена');
  }finally{
    aiDzenBusy=false;
    setCheckRunning(false);
  }
}
