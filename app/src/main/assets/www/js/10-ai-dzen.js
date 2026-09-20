const DZEN_AI_KNOWLEDGE_KEY='dzenAiKnowledgeV1';
let aiDzenIssues=[];
let aiDzenSource='';
let aiDzenBusy=false;
let aiDzenRun={state:'idle',message:'',calls:0,raw:0,accepted:0,rejected:0,model:'',startedAt:0,finishedAt:0};
const aiNativeWaiters=new Map();
let aiNativeSeq=0;
let dzenAiLiveCrawl=null;

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
function setAiDzenRunState(state,extra={}){
  aiDzenRun={
    state:String(state||'idle'),
    message:String(extra.message||''),
    calls:Number(extra.calls||0),
    raw:Number(extra.raw||0),
    accepted:Number(extra.accepted||0),
    rejected:Number(extra.rejected||0),
    model:String(extra.model||settings.dzenAiModel||''),
    startedAt:Number(extra.startedAt||0),
    finishedAt:Number(extra.finishedAt||0)
  };
}
function clearAiDzenIssues(state='idle',message=''){
  aiDzenIssues=[];
  aiDzenSource='';
  setAiDzenRunState(state,{message});
}
function invalidateAiDzenIssues(){
  const hadResult=aiDzenSource||aiDzenRun.state==='success'||aiDzenRun.state==='error'||aiDzenRun.state==='running';
  clearAiDzenIssues(hadResult?'stale':'idle');
}
function aiDzenRunText(){
  if(aiDzenRun.state==='running')return 'проверяется…';
  if(aiDzenRun.state==='error')return 'ошибка';
  if(aiDzenRun.state==='stale')return 'результат устарел';
  if(aiDzenRun.state==='success')return String(aiDzenRun.accepted||0)+' замеч.';
  return 'не запускалась';
}
function aiDzenRunDiagnosticHtml(){
  if(!checkModeUsesAi())return '';
  if(aiDzenRun.state==='running')return '<div class="analysisDzenNote"><b>AI-проверка выполняется…</b> Модель: '+escapeHtml(aiDzenRun.model||String(settings.dzenAiModel||'—'))+(aiDzenRun.calls?' · запросов: '+aiDzenRun.calls:'')+'.</div>';
  if(aiDzenRun.state==='error')return '<div class="analysisDzenNote"><b>AI-проверка не завершена.</b> '+escapeHtml(aiDzenRun.message||'Неизвестная ошибка')+'.</div>';
  if(aiDzenRun.state==='stale')return '<div class="analysisDzenNote"><b>AI-результат устарел.</b> Текст был изменён после последней проверки.</div>';
  if(aiDzenRun.state==='success'){
    let text='<b>AI-проверка завершена.</b> Модель: '+escapeHtml(aiDzenRun.model||String(settings.dzenAiModel||'—'))+' · запросов: '+aiDzenRun.calls+' · принято замечаний: '+aiDzenRun.accepted;
    if(aiDzenRun.rejected)text+=' · отброшено из-за несовпавшей цитаты: '+aiDzenRun.rejected;
    return '<div class="analysisDzenNote">'+text+'.</div>';
  }
  return '<div class="analysisDzenNote"><b>AI-проверка ещё не запускалась.</b></div>';
}
function clearDzenAiKnowledge(){
  localStorage.removeItem(DZEN_AI_KNOWLEDGE_KEY);
  updateDzenAiStatus();
  toast('AI-база Дзена очищена');
}
function syncDzenAiVisibility(){
  const box=document.getElementById('dzenAiFields');
  if(box)box.hidden=false;
}
function syncDzenAiSettingsUI(){
  const mode=document.getElementById('dzenCheckMode');
  const base=document.getElementById('dzenAiBaseUrl');
  const model=document.getElementById('dzenAiModel');
  const sources=document.getElementById('dzenAiSources');
  const prompt=document.getElementById('dzenAiStylePrompt');
  const key=document.getElementById('dzenAiApiKey');
  if(mode)mode.value=normalizeDzenCheckMode(settings.dzenCheckMode);
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
function renderDzenAiPageReport(report=null){
  const countEl=document.getElementById('dzenAiPageCount');
  const listEl=document.getElementById('dzenAiPageList');
  const noteEl=document.getElementById('dzenAiCrawlNote');
  if(!countEl||!listEl||!noteEl)return;
  const k=dzenAiKnowledge();
  const stored=k&&k.crawl?k.crawl:null;
  const data=report||stored;
  const urls=Array.isArray(data?.urls)?data.urls:[];
  const failed=Array.isArray(data?.failedUrls)?data.failedUrls:[];
  const found=Number(data?.discovered||urls.length||0);
  const processed=Number(data?.processed||urls.length||0);
  const skipped=Number(data?.skipped||failed.length||0);
  const truncated=!!data?.truncated;
  countEl.textContent=processed?String(processed):'0';
  noteEl.textContent=data
    ?'Найдено: '+found+' · обработано: '+processed+' · пропущено: '+skipped+(truncated?' · достигнут защитный предел':'')
    :'Список появится после сборки базы.';
  const rows=[];
  for(const url of urls)rows.push('<div class="aiPageRow"><span>✓</span><span>'+escapeHtml(String(url))+'</span></div>');
  for(const url of failed)rows.push('<div class="aiPageRow aiPageSkipped"><span>×</span><span>'+escapeHtml(String(url))+'</span></div>');
  listEl.innerHTML=rows.length?rows.join(''):'<div class="smallNote">Пока нет обработанных страниц.</div>';
}
function aiDzenStatusLine(){
  if(aiDzenRun.state==='success')return '<br>Последняя AI-проверка: <b>успешно</b> · модель: '+escapeHtml(aiDzenRun.model||String(settings.dzenAiModel||'—'))+' · запросов: '+aiDzenRun.calls+' · замечаний: '+aiDzenRun.accepted;
  if(aiDzenRun.state==='error')return '<br>Последняя AI-проверка: <b>ошибка</b> · '+escapeHtml(aiDzenRun.message||'неизвестная ошибка');
  if(aiDzenRun.state==='running')return '<br>AI-проверка: <b>выполняется…</b>';
  if(aiDzenRun.state==='stale')return '<br>Последний AI-результат: <b>устарел после изменения текста</b>';
  return '<br>AI-проверка статьи ещё не запускалась.';
}
function updateDzenAiStatus(message=''){
  const el=document.getElementById('dzenAiStatus');
  if(!el)return;
  if(message){
    el.textContent=message;
    if(dzenAiLiveCrawl)renderDzenAiPageReport(dzenAiLiveCrawl);
    return;
  }
  const k=dzenAiKnowledge();
  const key=dzenAiHasKey()?'ключ сохранён':'ключ не задан';
  if(!k){
    el.innerHTML='Подключение: <b>'+key+'</b><br>AI-база ещё не собрана.'+aiDzenStatusLine();
    renderDzenAiPageReport();
    return;
  }
  const date=k.builtAt?new Date(k.builtAt).toLocaleString('ru-RU'):'—';
  const state=dzenAiKnowledgeCurrent(k)?'актуальна для этих настроек':'нужно обновить';
  const pages=Number(k.crawl?.processed||k.pages||0);
  el.innerHTML='Подключение: <b>'+key+'</b><br>AI-база: <b>'+state+'</b> · страниц: '+pages+' · пунктов: '+k.items.length+'<br>Собрана: '+escapeHtml(date)+aiDzenStatusLine();
  renderDzenAiPageReport();
}
async function onDzenCheckModeChanged(){
  const select=document.getElementById('dzenCheckMode');
  const next=normalizeDzenCheckMode(select?.value);
  const previous=normalizeDzenCheckMode(settings.dzenCheckMode);
  const enablesAi=(next==='ai'||next==='both')&&!(previous==='ai'||previous==='both');
  if(enablesAi){
    const ok=await appConfirm(
      'Включить AI-проверку?',
      'После нажатия «Проверить» текст статьи и подготовленная база знаний Дзена будут отправлены в указанный вами OpenAI-совместимый API. При обычном наборе текста ничего не отправляется.',
      'Включить',
      false
    );
    if(!ok){
      if(select)select.value=previous;
      return;
    }
  }
  await applySettings();
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
  // Аварийный предел только для явно аномальной одиночной страницы.
  if(text.length>120000)text=text.slice(0,120000);
  return {url,title,text,links};
}
function canonicalAiSourceUrl(raw){
  try{
    const u=new URL(String(raw||'').trim());
    if(u.protocol!=='https:')return '';
    u.hash='';
    if(/(^|\.)dzen\.ru$/i.test(u.hostname)&&u.pathname.startsWith('/help/ru/'))u.search='';
    return u.href;
  }catch(e){return ''}
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
  const canonical=canonicalAiSourceUrl(url);
  if(!canonical)return false;
  const u=new URL(canonical);
  if(/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|apk|mp4|webm|mp3|wav)(?:\?|$)/i.test(canonical))return false;
  return seeds.some(seed=>{
    const scope=sourceScope(seed);
    return scope&&u.origin===scope.origin&&u.pathname.startsWith(scope.prefix);
  });
}
async function crawlDzenAiSources(){
  const rawSeeds=parseDzenAiSources();
  const seeds=[...new Set(rawSeeds.map(canonicalAiSourceUrl).filter(Boolean))];
  if(!seeds.length)throw new Error('Добавьте хотя бы один HTTPS URL Дзена');

  // Обходим все уникальные страницы, достижимые из стартовых URL внутри разрешённого раздела.
  // Предел 500 — аварийная защита от циклического/бесконечного сайта, а не рабочий лимит базы.
  const EMERGENCY_MAX_PAGES=500;
  const queue=[],discovered=new Set(),seen=new Set(),pages=[],failedUrls=[];
  let truncated=false;

  const enqueue=(raw)=>{
    const url=canonicalAiSourceUrl(raw);
    if(!url||discovered.has(url)||!allowedAiSourceLink(url,seeds))return;
    if(discovered.size>=EMERGENCY_MAX_PAGES){truncated=true;return}
    discovered.add(url);
    queue.push(url);
  };
  seeds.forEach(enqueue);

  while(queue.length){
    const canonical=queue.shift();
    if(seen.has(canonical))continue;
    seen.add(canonical);

    dzenAiLiveCrawl={
      discovered:discovered.size,
      processed:pages.length,
      skipped:failedUrls.length,
      truncated,
      urls:pages.map(x=>x.url),
      failedUrls:[...failedUrls]
    };
    updateDzenAiStatus('Читаю справку Дзена: '+seen.size+' · найдено '+discovered.size+'…');

    let fetched;
    try{
      fetched=await aiFetchPage(canonical);
    }catch(e){
      failedUrls.push(canonical);
      continue;
    }

    const data=htmlPageData(fetched.content,canonical);
    if(data.text.length>180){
      pages.push({url:canonical,title:data.title,text:data.text});
    }else{
      failedUrls.push(canonical);
    }

    for(const link of data.links)enqueue(link);
  }

  if(!pages.length)throw new Error('Не удалось получить текст из указанных страниц');

  const crawl={
    discovered:discovered.size,
    processed:pages.length,
    skipped:failedUrls.length,
    truncated,
    urls:pages.map(x=>x.url),
    failedUrls:[...failedUrls]
  };
  dzenAiLiveCrawl=crawl;
  renderDzenAiPageReport(crawl);
  return {pages,crawl};
}
function packKnowledgeBatches(pages,maxChars=28000){
  const pieces=[];
  const pagePieceMax=22000;
  for(const p of pages){
    let offset=0,part=1;
    while(offset<p.text.length){
      let end=Math.min(p.text.length,offset+pagePieceMax);
      if(end<p.text.length){
        const cut=p.text.lastIndexOf('\n',end);
        if(cut>offset+Math.floor(pagePieceMax*.6))end=cut;
      }
      const piece=p.text.slice(offset,end).trim();
      if(piece){
        pieces.push('=== SOURCE ===\nURL: '+p.url+'\nTITLE: '+p.title+'\nPART: '+part+'\nTEXT:\n'+piece);
        part++;
      }
      offset=Math.max(end,offset+1);
    }
  }
  const batches=[];let current='',count=0;
  for(const block of pieces){
    if(current&&current.length+block.length+2>maxChars){
      batches.push({text:current,count});
      current='';count=0;
    }
    current+=(current?'\n\n':'')+block;
    count++;
  }
  if(current)batches.push({text:current,count});
  return batches;
}
function normalizeKnowledgeItems(value){
  const items=Array.isArray(value?.items)?value.items:[];
  return items.map(x=>({
    kind:String(x?.kind||'recommendation').slice(0,32),
    title:String(x?.title||'').trim().slice(0,180),
    guidance:String(x?.guidance||x?.rule||'').trim().slice(0,1200),
    source_url:String(x?.source_url||x?.source||'').trim().slice(0,800)
  })).filter(x=>x.title&&x.guidance);
}
function dedupeKnowledgeItems(items){
  const seen=new Set(),out=[];
  for(const item of items){
    const key=(item.kind+'|'+item.title+'|'+item.guidance).toLocaleLowerCase('ru-RU').replace(/\s+/g,' ').trim();
    if(seen.has(key))continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
function packKnowledgeItems(items,maxChars=22000){
  const batches=[];let current=[],chars=0;
  for(const item of items){
    const size=JSON.stringify(item).length+2;
    if(current.length&&chars+size>maxChars){batches.push(current);current=[];chars=0}
    current.push(item);chars+=size;
  }
  if(current.length)batches.push(current);
  return batches;
}
async function buildDzenAiKnowledge(options={}){
  if(aiDzenBusy)return false;
  if(!dzenAiBridgeAvailable()){toast('AI-проверка доступна только в установленном приложении');return false}
  if(!dzenAiHasKey()){toast('Сначала сохраните API-ключ');return false}
  if(!String(settings.dzenAiBaseUrl||'').trim()||!String(settings.dzenAiModel||'').trim()){toast('Заполните API URL и модель');return false}
  aiDzenBusy=true;
  dzenAiLiveCrawl=null;
  try{
    updateDzenAiStatus('Получаю страницы Дзена…');
    const crawled=await crawlDzenAiSources();
    const pages=crawled.pages;
    const batches=packKnowledgeBatches(pages);
    let items=[];
    const system='Ты создаёшь базу знаний для редактора статей. Используй только предоставленные официальные материалы. Извлеки все отдельные обязательные правила, запреты, ограничения, рекомендации, требования к качеству и оформлению, а также сведения, которые могут влиять на распространение и показатели публикации. Не объединяй разные запреты в расплывчатый общий пункт и не пропускай конкретные ограничения ради краткости. Не придумывай норм и не делай выводов, которых нет в источнике. Верни только JSON: {"items":[{"kind":"rule|recommendation|quality|distribution|format","title":"кратко","guidance":"что учитывать автору","source_url":"точный URL из материала"}]}.';
    for(let i=0;i<batches.length;i++){
      updateDzenAiStatus('AI разбирает материалы: '+(i+1)+'/'+batches.length+'…');
      const raw=await aiChat(system,batches[i].text);
      items.push(...normalizeKnowledgeItems(parseAiJson(raw)));
    }
    updateDzenAiStatus('Собираю базу без потери правил…');
    items=dedupeKnowledgeItems(items);
    const knowledge={
      schema:2,
      builtAt:Date.now(),
      signature:dzenAiSettingsSignature(),
      baseUrl:String(settings.dzenAiBaseUrl||''),
      model:String(settings.dzenAiModel||''),
      sources:parseDzenAiSources(),
      pages:pages.length,
      crawl:crawled.crawl,
      items
    };
    if(!knowledge.items.length)throw new Error('Модель не выделила полезных правил');
    localStorage.setItem(DZEN_AI_KNOWLEDGE_KEY,JSON.stringify(knowledge));
    updateDzenAiStatus();
    if(!options.quiet)toast('AI-база Дзена обновлена');
    return true;
  }catch(e){
    updateDzenAiStatus();
    toast(e.message||'Не удалось собрать AI-базу Дзена');
    return false;
  }finally{aiDzenBusy=false;dzenAiLiveCrawl=null;updateDzenAiStatus()}
}
function shouldRunAiDzenCheck(){
  return checkModeUsesAi();
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
function aiRawIssueCount(value){
  return (Array.isArray(value?.dzen_issues)?value.dzen_issues.length:0)+
    (Array.isArray(value?.quality_issues)?value.quality_issues.length:0)+
    (Array.isArray(value?.style_issues)?value.style_issues.length:0);
}
function normalizeAiArticleResult(value,chunk){
  const out=[];
  for(const x of Array.isArray(value?.dzen_issues)?value.dzen_issues:[]){const it=aiIssueFromItem(x,'dzen',chunk);if(it)out.push(it)}
  for(const x of Array.isArray(value?.quality_issues)?value.quality_issues:[]){const it=aiIssueFromItem(x,'aiQuality',chunk);if(it)out.push(it)}
  for(const x of Array.isArray(value?.style_issues)?value.style_issues:[]){const it=aiIssueFromItem(x,'aiStyle',chunk);if(it)out.push(it)}
  return out;
}
async function startAiDzenArticleCheck(src){
  const source=String(src||editor.value||'');
  if(!source.trim()){setCheckRunning(false);return}
  if(aiDzenBusy){toast('AI уже выполняет другую операцию');setCheckRunning(false);return}
  aiDzenIssues=[];
  aiDzenSource='';
  setAiDzenRunState('running',{model:String(settings.dzenAiModel||''),startedAt:Date.now()});
  let knowledge=null;
  try{
    setCheckRunning(true);
    renderAnalysis();
    knowledge=await ensureDzenAiKnowledge();
    if(!knowledge)throw new Error('Нет актуальной AI-базы Дзена');
    if(aiDzenBusy)throw new Error('AI уже выполняет другую операцию');
    aiDzenBusy=true;
    toast('AI проверяет статью…');
    const knowledgeBatches=packKnowledgeItems(knowledge.items);
    const stylePrompt=String(settings.dzenAiStylePrompt||'').trim();
    const chunks=splitArticleForAi(source);
    const result=[];
    const system='Ты редактор Яндекс Дзена. Выполни три независимые проверки. 1) DZEN_ISSUES: проверяй соответствие переданной базе знаний Дзена; не придумывай правил вне базы. 2) QUALITY_ISSUES: независимо от базы найди явные редакторские проблемы текста: орфографические, грамматические и пунктуационные ошибки, сломанные или бессмысленные фразы, грубую/неуместную лексику и мат, явные логические противоречия и другие конкретные дефекты, ухудшающие качество статьи. Не придирайся к допустимому авторскому стилю. 3) STYLE_ISSUES: ищи только признаки из STYLE_INSTRUCTION, если она не пуста. Каждое замечание обязано содержать точную короткую цитату из ARTICLE_CHUNK без исправления цитаты. Не выдумывай цитаты. Верни только JSON: {"dzen_issues":[{"title":"...","reason":"...","quote":"точная цитата","severity":"warning|critical","source_url":"..."}],"quality_issues":[{"title":"...","reason":"...","quote":"точная цитата","severity":"warning|critical"}],"style_issues":[{"title":"...","reason":"...","quote":"точная цитата","severity":"warning"}]}.';
    const totalCalls=Math.max(1,chunks.length*knowledgeBatches.length);
    let callNo=0,rawCount=0,acceptedCount=0,rejectedCount=0;
    for(let i=0;i<chunks.length;i++){
      for(let k=0;k<knowledgeBatches.length;k++){
        callNo++;
        aiDzenRun.calls=callNo;
        updateDzenAiStatus('Проверяю статью: '+callNo+'/'+totalCalls+'…');
        renderAnalysis();
        const knowledgeJson=JSON.stringify({items:knowledgeBatches[k]});
        const styleInstruction=k===0?stylePrompt:'';
        const prompt='KNOWLEDGE_PART '+(k+1)+'/'+knowledgeBatches.length+':\n'+knowledgeJson+'\n\nSTYLE_INSTRUCTION:\n'+styleInstruction+'\n\nARTICLE_CHUNK '+(i+1)+'/'+chunks.length+'; absolute_offset='+chunks[i].start+':\n'+chunks[i].text;
        const raw=await aiChat(system,prompt);
        const parsed=parseAiJson(raw);
        const rawHere=aiRawIssueCount(parsed);
        const accepted=normalizeAiArticleResult(parsed,chunks[i]);
        rawCount+=rawHere;
        acceptedCount+=accepted.length;
        rejectedCount+=Math.max(0,rawHere-accepted.length);
        result.push(...accepted);
      }
    }
    const seen=new Set();
    aiDzenIssues=result.filter(x=>{const key=x.type+'|'+x.title+'|'+x.start+'|'+x.end;if(seen.has(key))return false;seen.add(key);return true}).slice(0,180);
    aiDzenSource=source;
    setAiDzenRunState('success',{
      model:String(settings.dzenAiModel||''),
      calls:callNo,
      raw:rawCount,
      accepted:aiDzenIssues.length,
      rejected:rejectedCount,
      startedAt:aiDzenRun.startedAt||Date.now(),
      finishedAt:Date.now()
    });
    analyzeText();
    document.getElementById('analysisBackdrop').classList.add('open');
    setAnalysisMode('problems');
    updateDzenAiStatus();
    toast(aiDzenIssues.length?'AI-проверка: замечаний '+aiDzenIssues.length:'AI-проверка завершена: замечаний нет');
  }catch(e){
    aiDzenIssues=[];
    aiDzenSource='';
    setAiDzenRunState('error',{
      model:String(settings.dzenAiModel||''),
      calls:aiDzenRun.calls,
      message:e&&e.message?e.message:'AI-проверка не выполнена',
      startedAt:aiDzenRun.startedAt||Date.now(),
      finishedAt:Date.now()
    });
    analyzeText();
    updateDzenAiStatus();
    document.getElementById('analysisBackdrop').classList.add('open');
    renderAnalysis();
    toast(aiDzenRun.message);
  }finally{
    aiDzenBusy=false;
    setCheckRunning(false);
  }
}

async function testDzenAiConnection(){
  if(aiDzenBusy){toast('AI уже выполняет другую операцию');return}
  try{
    updateDzenAiStatus('Проверяю подключение к AI…');
    const raw=await aiChat('Проверка подключения. Верни только JSON {"ok":true}.','TEST');
    const parsed=parseAiJson(raw);
    if(parsed?.ok!==true)throw new Error('API ответил, но тестовый ответ имеет неожиданный формат');
    toast('AI подключение работает');
    updateDzenAiStatus();
  }catch(e){
    toast('AI не отвечает: '+(e&&e.message?e.message:'ошибка подключения'));
    updateDzenAiStatus();
  }
}

