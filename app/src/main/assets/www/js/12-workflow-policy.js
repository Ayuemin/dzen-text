/* Unified deterministic + semantic review workflow. */
(function installEditorWorkflowPolicy(){
  const baseClearAiDzenIssues=clearAiDzenIssues;
  const baseAiIssueFromItem=aiIssueFromItem;
  const baseAnalyzeText=analyzeText;
  const baseRenderAnalysis=renderAnalysis;
  const baseIssueGroups=issueGroups;
  const baseOpenSettings=openSettings;
  const baseRenderReplacement=renderReplacement;
  const baseHandleNativeBack=window.handleNativeBack;

  const MY_RULES_KEY='dzenMyRulesV1';
  let aiDzenSessionIssues=[];
  let aiFixBusy=false;
  let aiSynonymBusy=false;
  let myRulesSaveTimer=null;

  function stableHash(value){
    const s=String(value||'');
    let h=2166136261;
    for(let i=0;i<s.length;i++){
      h^=s.charCodeAt(i);
      h=Math.imul(h,16777619);
    }
    return (h>>>0).toString(16).padStart(8,'0')+'-'+s.length;
  }
  function uniqueStrings(values,max=80,maxLen=240){
    const seen=new Set(),out=[];
    for(const raw of Array.isArray(values)?values:[]){
      const value=String(raw||'').replace(/\s+/g,' ').trim().slice(0,maxLen);
      const key=value.toLocaleLowerCase('ru-RU');
      if(!value||seen.has(key))continue;
      seen.add(key);out.push(value);
      if(out.length>=max)break;
    }
    return out;
  }
  function loadMyRules(){
    try{
      const value=JSON.parse(localStorage.getItem(MY_RULES_KEY)||'null');
      return {
        local:uniqueStrings(value&&value.local,120,160),
        semantic:uniqueStrings(value&&value.semantic,80,500)
      };
    }catch(e){return {local:[],semantic:[]}}
  }
  function saveMyRules(value){
    try{
      localStorage.setItem(MY_RULES_KEY,JSON.stringify({local:uniqueStrings(value.local,120,160),semantic:uniqueStrings(value.semantic,80,500)}));
      return true;
    }catch(e){toast('Не удалось сохранить мои правила');return false}
  }
  function parseRuleLines(value){return uniqueStrings(String(value||'').split(/\n+/),120,500)}
  function syncMyRulesUi(){
    const rules=loadMyRules(),local=document.getElementById('myLocalRules'),semantic=document.getElementById('mySemanticRules');
    if(local&&document.activeElement!==local)local.value=rules.local.join('\n');
    if(semantic&&document.activeElement!==semantic)semantic.value=rules.semantic.join('\n');
  }
  function saveMyRulesFromUi(){
    clearTimeout(myRulesSaveTimer);
    myRulesSaveTimer=setTimeout(function(){
      const local=document.getElementById('myLocalRules'),semantic=document.getElementById('mySemanticRules');
      if(!local||!semantic)return;
      if(saveMyRules({local:parseRuleLines(local.value),semantic:parseRuleLines(semantic.value)})){
        try{analyzeText()}catch(e){}
      }
    },220);
  }
  window.saveMyRulesFromUi=saveMyRulesFromUi;

  function injectWorkflowStyle(){
    if(document.getElementById('workflowReviewStyle'))return;
    const style=document.createElement('style');
    style.id='workflowReviewStyle';
    style.textContent=`
      .analysisWorkflowStatus{display:flex;flex-direction:column;gap:8px;margin:0 0 14px}
      .analysisStatusRow{display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:13px;background:var(--surface2);padding:10px 11px;color:var(--text);font-size:13px;line-height:1.35}
      .analysisStatusRow b{font-size:14px}.analysisStatusText{min-width:0;flex:1}.analysisStatusMeta{display:block;color:var(--muted);font-size:11px;margin-top:2px}
      .analysisFixButton{width:100%;min-height:44px;border:0;border-radius:13px;background:var(--accent);color:#fff;font-weight:760;font-size:14px;padding:10px 12px}
      .analysisFixButton:disabled{opacity:.42}.aiSpinner{width:18px;height:18px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) 24%,var(--border));border-top-color:var(--accent);animation:dzenAiSpin .8s linear infinite;flex:0 0 auto}
      @keyframes dzenAiSpin{to{transform:rotate(360deg)}}
      .knowledgeSheet{max-height:88vh}.knowledgeSummary{font-size:12px;color:var(--muted);margin:-4px 0 12px}.knowledgeRule{border-top:1px solid var(--border);padding:11px 0}.knowledgeRule:first-child{border-top:0}.knowledgeRule summary{cursor:pointer;font-weight:720;font-size:14px}.knowledgeRuleMeta{font-size:11px;color:var(--muted);margin:5px 0}.knowledgeRuleText{font-size:13px;line-height:1.45;margin:7px 0}.knowledgeQuote{font-size:12px;line-height:1.45;background:var(--surface2);border-radius:10px;padding:9px 10px;white-space:pre-wrap}.knowledgeBadge{display:inline-block;border-radius:999px;padding:2px 7px;background:var(--surface2);font-size:10px;color:var(--muted);margin-right:5px}.workflowMyRules textarea{min-height:120px}.aiSynonymAction{margin:4px 0 8px;width:100%}
    `;
    document.head.appendChild(style);
  }
  function installKnowledgeSheet(){
    if(document.getElementById('dzenKnowledgeBackdrop'))return;
    const backdrop=document.createElement('div');
    backdrop.className='sheetBackdrop';backdrop.id='dzenKnowledgeBackdrop';
    backdrop.innerHTML='<div class="sheet knowledgeSheet"><div class="handle"></div><div class="sheetHeader"><h2>База правил Дзена</h2><button class="sheetClose" type="button" aria-label="Закрыть">×</button></div><div id="dzenKnowledgeSummary" class="knowledgeSummary"></div><div id="dzenKnowledgeList"></div></div>';
    backdrop.addEventListener('click',function(e){if(e.target===backdrop)closeDzenKnowledge()});
    backdrop.querySelector('.sheetClose').addEventListener('click',closeDzenKnowledge);
    document.body.appendChild(backdrop);
  }
  function installWorkflowUi(){
    injectWorkflowStyle();installKnowledgeSheet();
    settings.onlineSpelling=false;
    settings.riskCheck=false;
    settings.dzenSmartRules=false;
    try{if(typeof persistSettings==='function')persistSettings(false)}catch(e){}
    const online=document.getElementById('onlineSpelling');if(online)online.checked=false;
    const risk=document.getElementById('riskCheck');if(risk)risk.checked=false;
    const legacyDzen=document.getElementById('dzenSmartRules');if(legacyDzen)legacyDzen.checked=false;

    const spellingGroup=online&&online.closest('details.settingsGroup');if(spellingGroup)spellingGroup.hidden=true;
    const dzenGroup=legacyDzen&&legacyDzen.closest('details.settingsGroup');if(dzenGroup)dzenGroup.hidden=true;
    const spellPanel=document.getElementById('spellPanel');if(spellPanel)spellPanel.hidden=true;
    const filters=document.getElementById('analysisLocalFilters');if(filters)filters.hidden=true;

    const riskWords=document.getElementById('riskWords');
    const riskGroup=riskWords&&riskWords.closest('details.settingsGroup');
    if(riskGroup&&!riskGroup.querySelector('.workflowMyRules')){
      const summary=riskGroup.querySelector('summary');
      if(summary)summary.innerHTML='<span>Мои правила</span><small>Личные локальные и смысловые требования</small>';
      const oldBody=riskGroup.querySelector('.settingsGroupBody');if(oldBody)oldBody.style.display='none';
      const body=document.createElement('div');body.className='settingsGroupBody workflowMyRules';
      body.innerHTML='<div class="subLabel"><span>Точные слова и фразы</span></div><textarea id="myLocalRules" class="riskArea" rows="6" placeholder="По одному слову или фразе на строку"></textarea><div class="smallNote">Эти правила проверяются локально точным совпадением.</div><div class="subLabel" style="margin-top:14px"><span>Смысловые правила</span></div><textarea id="mySemanticRules" class="riskArea" rows="6" placeholder="Например: не допускать категоричных обещаний результата"></textarea><div class="smallNote">Эти требования передаются AI только при ручной AI-проверке.</div>';
      riskGroup.appendChild(body);
      body.querySelector('#myLocalRules').addEventListener('input',saveMyRulesFromUi);
      body.querySelector('#mySemanticRules').addEventListener('input',saveMyRulesFromUi);
    }
    syncMyRulesUi();

    const dict=document.getElementById('dictStatus');
    const dictGroup=dict&&dict.closest('details.settingsGroup');
    if(dictGroup){
      const summary=dictGroup.querySelector('summary');if(summary)summary.innerHTML='<span>Синонимы</span><small>AI по контексту и офлайн-словарь</small>';
      const note=dictGroup.querySelector('.settingsGroupBody>.smallNote');
      if(note)note.textContent='Основной подбор выполняется AI по контексту выбранного места. Встроенный и пользовательский словари остаются офлайн-резервом.';
    }

    const buildButton=document.querySelector('button[onclick="buildDzenAiKnowledge()"]');
    if(buildButton){
      buildButton.textContent='Обновить базу правил Дзена';
      const actions=buildButton.parentElement;
      if(actions&&!document.getElementById('openDzenKnowledgeBtn')){
        const open=document.createElement('button');open.className='nativeBtn';open.type='button';open.id='openDzenKnowledgeBtn';open.textContent='Открыть базу';open.addEventListener('click',openDzenKnowledge);actions.appendChild(open);
      }
    }
  }

  function renderDzenKnowledge(){
    const summary=document.getElementById('dzenKnowledgeSummary'),list=document.getElementById('dzenKnowledgeList');
    if(!summary||!list)return;
    const knowledge=dzenAiKnowledge();
    if(!knowledge||!Array.isArray(knowledge.items)||!knowledge.items.length){
      summary.textContent='База ещё не собрана. Запустите обновление в настройках.';
      list.innerHTML='<div class="analysisEmpty">Правил пока нет.</div>';return;
    }
    const mechanical=knowledge.items.filter(x=>x.check_mode==='mechanical').length;
    const semantic=knowledge.items.length-mechanical;
    const date=knowledge.builtAt?new Date(knowledge.builtAt).toLocaleString('ru-RU'):'—';
    const crawl=knowledge.crawl||{};
    summary.textContent='Обновлено: '+date+' · страниц: '+Number(crawl.processed||knowledge.pages||0)+' · правил: '+knowledge.items.length+' · механических: '+mechanical+' · смысловых: '+semantic;
    list.innerHTML=knowledge.items.map(function(item){
      const mode=item.check_mode==='mechanical'?'механическое':'смысловое';
      const source=escapeHtml(String(item.source_url||'—'));
      const terms=Array.isArray(item.terms)&&item.terms.length?'<div class="knowledgeRuleText"><b>Точные маркеры:</b> '+escapeHtml(item.terms.join(', '))+'</div>':'';
      const exceptions=item.exceptions?'<div class="knowledgeRuleText"><b>Исключения:</b> '+escapeHtml(item.exceptions)+'</div>':'';
      return '<details class="knowledgeRule"><summary><span class="knowledgeBadge">'+mode+'</span>'+escapeHtml(item.title||'Правило')+'</summary><div class="knowledgeRuleMeta">Источник: '+source+'</div><div class="knowledgeRuleText">'+escapeHtml(item.guidance||'')+'</div>'+exceptions+terms+'<div class="knowledgeQuote">«'+escapeHtml(item.source_quote||'')+'»</div></details>';
    }).join('');
  }
  function openDzenKnowledge(){renderDzenKnowledge();document.getElementById('dzenKnowledgeBackdrop')?.classList.add('open')}
  function closeDzenKnowledge(){document.getElementById('dzenKnowledgeBackdrop')?.classList.remove('open')}
  window.openDzenKnowledge=openDzenKnowledge;
  window.closeDzenKnowledge=closeDzenKnowledge;

  if(typeof dzenAiSettingsSignature==='function'){
    dzenAiSettingsSignature=function(){
      return JSON.stringify({sources:parseDzenAiSources().map(canonicalAiSourceUrl).filter(Boolean).sort()});
    };
  }
  dzenAiKnowledgeCurrent=function(value){
    return !!(value&&Number(value.schema)>=3&&value.signature===dzenAiSettingsSignature()&&Array.isArray(value.items)&&value.items.length);
  };

  function normalizeKnowledgeItem(raw,pageMap){
    const source=canonicalAiSourceUrl(raw&&raw.source_url||raw&&raw.source||'');
    const page=pageMap.get(source);
    if(!page)return null;
    const quote=String(raw&&raw.source_quote||'').replace(/\u00a0/g,' ').trim().slice(0,1200);
    if(!quote||!page.text.includes(quote))return null;
    const title=String(raw&&raw.title||'').replace(/\s+/g,' ').trim().slice(0,180);
    const guidance=String(raw&&raw.guidance||raw&&raw.rule||'').replace(/\s+/g,' ').trim().slice(0,1200);
    if(!title||!guidance)return null;
    let terms=uniqueStrings(raw&&raw.terms,24,120).filter(x=>page.text.toLocaleLowerCase('ru-RU').includes(x.toLocaleLowerCase('ru-RU')));
    let mode=String(raw&&raw.check_mode||'semantic').toLowerCase()==='mechanical'&&terms.length?'mechanical':'semantic';
    if(mode!=='mechanical')terms=[];
    return {
      id:'rule_'+stableHash(source+'|'+quote+'|'+title),
      kind:String(raw&&raw.kind||'rule').slice(0,32),
      check_mode:mode,
      title,
      guidance,
      exceptions:String(raw&&raw.exceptions||'').replace(/\s+/g,' ').trim().slice(0,700),
      terms,
      severity:String(raw&&raw.severity||'warning')==='critical'?'critical':'warning',
      source_url:source,
      source_quote:quote
    };
  }
  function normalizeKnowledgePayload(value,pageMap){
    const raw=Array.isArray(value&&value.items)?value.items:[];
    return raw.map(x=>normalizeKnowledgeItem(x,pageMap)).filter(Boolean);
  }
  function dedupeKnowledgeV3(items){
    const seen=new Set(),out=[];
    for(const item of items){
      const key=item.source_url+'|'+item.source_quote.toLocaleLowerCase('ru-RU')+'|'+item.title.toLocaleLowerCase('ru-RU');
      if(seen.has(key))continue;seen.add(key);out.push(item);
    }
    return out;
  }
  function batchUrls(text){
    const out=[];for(const m of String(text||'').matchAll(/^URL:\s*(\S+)/gm)){const u=canonicalAiSourceUrl(m[1]);if(u&&!out.includes(u))out.push(u)}return out;
  }

  buildDzenAiKnowledge=async function(options={}){
    if(aiDzenBusy)return false;
    if(!dzenAiBridgeAvailable()){toast('AI доступен только в установленном приложении');return false}
    if(!dzenAiHasKey()){toast('Сначала сохраните API-ключ');return false}
    if(!String(settings.dzenAiBaseUrl||'').trim()||!String(settings.dzenAiModel||'').trim()){toast('Заполните API URL и модель');return false}
    aiDzenBusy=true;dzenAiLiveCrawl=null;
    try{
      updateDzenAiStatus('Получаю официальную справку Дзена…');
      const crawled=await crawlDzenAiSources();
      const pages=crawled.pages;
      const pageMap=new Map(pages.map(p=>[canonicalAiSourceUrl(p.url),p]));
      const pageIndex=pages.map(p=>({url:canonicalAiSourceUrl(p.url),title:p.title,hash:stableHash(p.text),length:p.text.length}));
      const previous=dzenAiKnowledge();
      const previousIndex=new Map(Array.isArray(previous&&previous.pageIndex)?previous.pageIndex.map(x=>[canonicalAiSourceUrl(x.url),x.hash]):[]);
      const changedPages=pages.filter(p=>previousIndex.get(canonicalAiSourceUrl(p.url))!==stableHash(p.text));
      const unchangedUrls=new Set(pageIndex.filter(x=>previousIndex.get(x.url)===x.hash).map(x=>x.url));
      const reused=Number(previous&&previous.schema)>=3&&Array.isArray(previous.items)
        ?previous.items.filter(x=>unchangedUrls.has(canonicalAiSourceUrl(x.source_url))).map(x=>normalizeKnowledgeItem(x,pageMap)).filter(Boolean):[];

      let reviewed=[];let extractCalls=0,reviewCalls=0;
      if(changedPages.length){
        const batches=packKnowledgeBatches(changedPages);
        let extracted=[];
        const extractionSystem='Ты составляешь проверяемую базу знаний для редактора статей по официальной справке Дзена. Используй только SOURCE. Извлекай атомарные правила, запреты, ограничения, рекомендации и требования. Для каждого пункта обязательно скопируй точную короткую SOURCE_QUOTE из источника. check_mode=mechanical ставь только когда правило можно надёжно проверить точным совпадением слова/фразы; тогда terms должны содержать только буквальные маркеры из источника. Всё, что требует понимания контекста, помечай semantic. Не придумывай нормы. Верни только JSON {"items":[{"kind":"rule|recommendation|quality|distribution|format","check_mode":"mechanical|semantic","title":"...","guidance":"...","exceptions":"...","terms":["..."],"severity":"warning|critical","source_url":"точный URL","source_quote":"точная цитата"}]}.';
        for(let i=0;i<batches.length;i++){
          updateDzenAiStatus('AI выделяет правила из изменившихся страниц…');
          const parsed=parseAiJson(await aiChat(extractionSystem,batches[i].text));extractCalls++;
          extracted.push(...normalizeKnowledgePayload(parsed,pageMap));
        }
        extracted=dedupeKnowledgeV3(extracted);

        const reviewSystem='Ты независимый ревизор базы правил Дзена. У тебя есть SOURCE_MATERIAL и CANDIDATE_ITEMS первого прохода. Повторно прочитай источник с нуля: убери неподтверждённые или слишком широкие трактовки, раздели слитые правила, добавь пропущенные существенные правила и исключения. Любой итоговый пункт обязан иметь точную SOURCE_QUOTE, дословно присутствующую в SOURCE_MATERIAL, и точный source_url. Не доверяй кандидату без проверки. Верни полный исправленный набор пунктов только для предоставленного SOURCE_MATERIAL в JSON того же формата {"items":[...]}.';
        for(let i=0;i<batches.length;i++){
          const urls=new Set(batchUrls(batches[i].text));
          const candidates=extracted.filter(x=>urls.has(x.source_url));
          const prompt='SOURCE_MATERIAL:\n'+batches[i].text+'\n\nCANDIDATE_ITEMS:\n'+JSON.stringify({items:candidates});
          updateDzenAiStatus('Независимый AI-ревизор проверяет базу…');
          const parsed=parseAiJson(await aiChat(reviewSystem,prompt));reviewCalls++;
          reviewed.push(...normalizeKnowledgePayload(parsed,pageMap));
        }
        reviewed=dedupeKnowledgeV3(reviewed);
        if(!reviewed.length)throw new Error('Ревизор не подтвердил ни одного правила на изменившихся страницах');
      }

      const items=dedupeKnowledgeV3([...reused,...reviewed]);
      if(!items.length)throw new Error('Не удалось собрать подтверждённые правила');
      const knowledge={
        schema:3,builtAt:Date.now(),signature:dzenAiSettingsSignature(),
        builderModel:String(settings.dzenAiModel||''),sources:parseDzenAiSources(),pages:pages.length,
        crawl:crawled.crawl,pageIndex,items,
        review:{completed:true,extractCalls,reviewCalls,changedPages:changedPages.length,reusedPages:unchangedUrls.size}
      };
      localStorage.setItem(DZEN_AI_KNOWLEDGE_KEY,JSON.stringify(knowledge));
      updateDzenAiStatus();renderDzenKnowledge();
      if(!options.quiet)toast(changedPages.length?'База правил Дзена обновлена':'Страницы Дзена не изменились — AI-пересборка не потребовалась');
      try{analyzeText()}catch(e){}
      return true;
    }catch(e){
      updateDzenAiStatus();toast(e&&e.message?e.message:'Не удалось обновить базу правил Дзена');return false;
    }finally{aiDzenBusy=false;dzenAiLiveCrawl=null;updateDzenAiStatus()}
  };
  ensureDzenAiKnowledge=async function(){
    const knowledge=dzenAiKnowledge();
    return dzenAiKnowledgeCurrent(knowledge)?knowledge:null;
  };

  updateDzenAiStatus=function(message=''){
    const el=document.getElementById('dzenAiStatus');if(!el)return;
    const key=dzenAiHasKey()?'ключ сохранён':'ключ не задан';
    if(message){el.textContent=message;if(dzenAiLiveCrawl)renderDzenAiPageReport(dzenAiLiveCrawl);return}
    const knowledge=dzenAiKnowledge();
    if(!knowledge){el.innerHTML='Подключение: <b>'+key+'</b><br>База правил Дзена: <b>не собрана</b>. Обновление запускается только вручную.';renderDzenAiPageReport();return}
    const current=dzenAiKnowledgeCurrent(knowledge);
    const date=knowledge.builtAt?new Date(knowledge.builtAt).toLocaleString('ru-RU'):'—';
    const mechanical=knowledge.items.filter(x=>x.check_mode==='mechanical').length;
    const semantic=knowledge.items.length-mechanical;
    const review=knowledge.review&&knowledge.review.completed?'ревизор выполнен':'ревизия отсутствует';
    el.innerHTML='Подключение: <b>'+key+'</b><br>База правил: <b>'+(current?'актуальна':'требует ручного обновления')+'</b> · пунктов: '+knowledge.items.length+' ('+mechanical+' механических, '+semantic+' смысловых)<br>Собрана: '+escapeHtml(date)+' · '+review;
    renderDzenAiPageReport();
  };

  updateDzenRulesStatus=function(){};
  clearOnlineSpelling=function(){onlineSpellIssues=[];onlineSpellSource='';spellStatus='off';spellRequestId='';spellNavState=null;closeSpellPanel()};

  function analyzeExactTerms(src,issues,item,type){
    const lower=src.toLocaleLowerCase('ru-RU');let shown=0;
    for(const raw of item.terms||[]){
      const term=String(raw||'').trim();if(!term)continue;
      const q=term.toLocaleLowerCase('ru-RU');
      const positions=typeof dzenOccurrences==='function'?dzenOccurrences(lower,q,6,'phrase'):[];
      for(const at of positions){
        const detail=(item.guidance||'Проверьте формулировку')+(item.source_url?' · Источник: '+item.source_url:'');
        addSimpleIssue(issues,type,item.title||('Найдено «'+term+'»'),detail,at,at+term.length,item.severity||'warning');
        if(++shown>=8)return;
      }
    }
  }
  analyzeDzenRules=function(src,headings,issues){
    const knowledge=dzenAiKnowledge();
    if(dzenAiKnowledgeCurrent(knowledge)){
      for(const item of knowledge.items){if(item.check_mode==='mechanical'&&Array.isArray(item.terms)&&item.terms.length)analyzeExactTerms(src,issues,item,'dzen')}
    }
    const mine=loadMyRules();
    for(const term of mine.local){
      analyzeExactTerms(src,issues,{title:'Моё правило: «'+term+'»',guidance:'Точное пользовательское правило',terms:[term],severity:'warning'},'myRule');
    }
  };

  issueGroups=function(){
    const groups=baseIssueGroups().filter(x=>x.id!=='spelling'&&x.id!=='risk');
    for(const g of groups){
      if(g.id==='proof')g.name='Технические ошибки';
      if(g.id==='aiQuality')g.name='Язык и смысл';
      if(g.id==='aiStyle')g.name='Стиль текста';
    }
    if(!groups.some(x=>x.id==='myRule'))groups.splice(Math.max(0,groups.findIndex(x=>x.id==='dzen')+1),0,{id:'myRule',name:'Мои правила'});
    return groups;
  };

  clearAiDzenIssues=function(state='idle',message=''){
    aiDzenSessionIssues=[];
    return baseClearAiDzenIssues(state,message);
  };
  aiIssueFromItem=function(item,type,chunk){
    const issue=baseAiIssueFromItem(item,type,chunk);if(!issue)return null;
    const text=String(chunk&&chunk.text||''),chunkStart=Number(chunk&&chunk.start)||0;
    const localStart=Math.max(0,(Number(issue.start)||0)-chunkStart),localEnd=Math.max(localStart,(Number(issue.end)||0)-chunkStart);
    issue.quote=text.slice(localStart,localEnd)||String(item&&item.quote||'').trim();
    issue.aiOriginalStart=Number(issue.start)||0;issue.aiLastStart=issue.aiOriginalStart;
    issue.aiContextBefore=text.slice(Math.max(0,localStart-64),localStart);issue.aiContextAfter=text.slice(localEnd,Math.min(text.length,localEnd+64));
    return issue;
  };
  function exactQuotePositions(src,quote){const out=[];if(!quote)return out;let at=0;while(at<=src.length-quote.length){const found=src.indexOf(quote,at);if(found<0)break;out.push(found);at=found+Math.max(1,quote.length)}return out}
  function suffixScore(expected,actual){expected=String(expected||'');actual=String(actual||'');let n=0,i=expected.length-1,j=actual.length-1;while(i>=0&&j>=0&&expected[i]===actual[j]&&n<64){n++;i--;j--}return n}
  function prefixScore(expected,actual){expected=String(expected||'');actual=String(actual||'');let n=0,limit=Math.min(64,expected.length,actual.length);while(n<limit&&expected[n]===actual[n])n++;return n}
  function chooseAiOccurrence(src,issue){
    const quote=String(issue.quote||'');if(!quote)return null;const positions=exactQuotePositions(src,quote);if(!positions.length)return null;
    const anchor=Number.isFinite(Number(issue.aiLastStart))?Number(issue.aiLastStart):Number(issue.aiOriginalStart)||0;
    const before=String(issue.aiContextBefore||''),after=String(issue.aiContextAfter||'');
    const ranked=positions.map(pos=>({pos,context:suffixScore(before,src.slice(Math.max(0,pos-before.length),pos))+prefixScore(after,src.slice(pos+quote.length,pos+quote.length+after.length)),distance:Math.abs(pos-anchor)})).sort((a,b)=>b.context-a.context||a.distance-b.distance);
    const best=ranked[0];if(ranked.length>1&&best.context===0&&best.distance>500)return null;return best.pos;
  }
  function remapAiDzenIssues(src){
    src=String(src||'');if(!aiDzenSessionIssues.length){aiDzenIssues=[];aiDzenSource=src;return}
    const survivors=[];for(const original of aiDzenSessionIssues){const start=chooseAiOccurrence(src,original);if(start==null)continue;const quote=String(original.quote||'');survivors.push({...original,start,end:start+quote.length,aiLastStart:start})}
    aiDzenSessionIssues=survivors;aiDzenIssues=survivors.map(x=>({...x}));aiDzenSource=src;
  }
  invalidateAiDzenIssues=function(){
    if(!editor)return;const src=editor.value||'';if(!src.trim()){clearAiDzenIssues('idle');return}if(aiDzenRun&&aiDzenRun.state==='running')return;remapAiDzenIssues(src);
  };
  analyzeText=function(){
    const src=editor.value||'';
    settings.onlineSpelling=false;settings.riskCheck=false;settings.dzenSmartRules=false;
    onlineSpellIssues=[];onlineSpellSource='';
    if(aiDzenSessionIssues.length&&aiDzenSource!==src)remapAiDzenIssues(src);
    else if(!aiDzenSessionIssues.length&&Array.isArray(aiDzenIssues)&&aiDzenIssues.length)aiDzenSource=src;
    return baseAnalyzeText();
  };

  function normalizeArticleResult(value,chunk,allowQuality,allowedDzenSources){
    const out=[];let raw=0;
    const push=function(arr,type){
      for(const x of Array.isArray(arr)?arr:[]){
        raw++;
        if(type==='dzen'){
          const source=canonicalAiSourceUrl(x&&x.source_url||'');
          if(!source||!allowedDzenSources.has(source))continue;
        }
        const item=aiIssueFromItem(x,type,chunk);if(item)out.push(item);
      }
    };
    push(value&&value.dzen_issues,'dzen');
    if(allowQuality){push(value&&value.quality_issues,'aiQuality');push(value&&value.style_issues,'aiStyle')}
    return {issues:out,raw};
  }
  async function performSemanticAiCheck(source){
    if(aiDzenBusy){toast('AI уже выполняет другую операцию');setCheckRunning(false);return}
    aiDzenIssues=[];aiDzenSource='';
    setAiDzenRunState('running',{model:String(settings.dzenAiModel||''),startedAt:Date.now()});
    setCheckRunning(true);renderAnalysis();
    try{
      const knowledge=await ensureDzenAiKnowledge();
      aiDzenBusy=true;
      const semantic=knowledge?knowledge.items.filter(x=>x.check_mode!=='mechanical'):[];
      const knowledgeBatches=semantic.length?packKnowledgeItems(semantic):[[]];
      const allowedSources=new Set(semantic.map(x=>canonicalAiSourceUrl(x.source_url)).filter(Boolean));
      const stylePrompt=String(settings.dzenAiStylePrompt||'').trim();
      const mySemantic=loadMyRules().semantic;
      const chunks=splitArticleForAi(source);
      const result=[];
      let calls=0,rawCount=0,rejected=0;
      const system='Ты выполняешь смысловую редакторскую проверку статьи. DZEN_ISSUES: используй только переданные смысловые правила Дзена и никогда не придумывай норм вне базы. QUALITY_ISSUES: найди орфографические, грамматические и сложные пунктуационные ошибки, неудачные или двусмысленные формулировки, внутренние логические противоречия, неуместную лексику и другие дефекты, требующие понимания контекста. Не сообщай то, что приложение уже проверяет механически: частоту и повторы слов, повторы в соседних предложениях, одинаковые начала, длину предложений/абзацев/заголовков, структуру H1-H3, Markdown, пробелы, простые повторяющиеся знаки, точные слова/фразы, количество ссылок и другие числовые/структурные сигналы. STYLE_ISSUES используй только по STYLE_INSTRUCTION. MY_SEMANTIC_RULES — пользовательские требования, их замечания относись к QUALITY_ISSUES, а не к правилам Дзена. Каждое замечание обязано содержать точную короткую quote из ARTICLE_CHUNK. Верни только JSON {"dzen_issues":[{"title":"...","reason":"...","quote":"...","severity":"warning|critical","source_url":"..."}],"quality_issues":[{"title":"...","reason":"...","quote":"...","severity":"warning|critical"}],"style_issues":[{"title":"...","reason":"...","quote":"...","severity":"warning"}]}.';
      for(let i=0;i<chunks.length;i++){
        for(let k=0;k<knowledgeBatches.length;k++){
          const allowQuality=k===0;calls++;aiDzenRun.calls=calls;updateDzenAiStatus('AI проверяет статью…');renderAnalysis();
          const prompt='RUN_QUALITY_AND_STYLE: '+(allowQuality?'yes':'no')+'\nDZEN_KNOWLEDGE:\n'+JSON.stringify({items:knowledgeBatches[k]})+'\n\nMY_SEMANTIC_RULES:\n'+JSON.stringify(allowQuality?mySemantic:[])+'\n\nSTYLE_INSTRUCTION:\n'+(allowQuality?stylePrompt:'')+'\n\nARTICLE_CHUNK absolute_offset='+chunks[i].start+':\n'+chunks[i].text;
          const parsed=parseAiJson(await aiChat(system,prompt));
          const normalized=normalizeArticleResult(parsed,chunks[i],allowQuality,allowedSources);
          rawCount+=normalized.raw;rejected+=Math.max(0,normalized.raw-normalized.issues.length);result.push(...normalized.issues);
        }
      }
      const seen=new Set();aiDzenIssues=result.filter(x=>{const key=x.type+'|'+x.title+'|'+x.start+'|'+x.end;if(seen.has(key))return false;seen.add(key);return true}).slice(0,180);
      aiDzenSource=source;
      setAiDzenRunState('success',{model:String(settings.dzenAiModel||''),calls,raw:rawCount,accepted:aiDzenIssues.length,rejected,startedAt:aiDzenRun.startedAt||Date.now(),finishedAt:Date.now()});
      aiDzenRun.knowledgeMissing=!knowledge;
      analyzeText();document.getElementById('analysisBackdrop')?.classList.add('open');updateDzenAiStatus();renderAnalysis();
      toast(aiDzenIssues.length?'AI-проверка: замечаний '+aiDzenIssues.length:'AI-проверка завершена: дополнительных замечаний нет');
    }catch(e){
      aiDzenIssues=[];aiDzenSource='';
      setAiDzenRunState('error',{model:String(settings.dzenAiModel||''),calls:aiDzenRun.calls,message:e&&e.message?e.message:'AI-проверка не выполнена',startedAt:aiDzenRun.startedAt||Date.now(),finishedAt:Date.now()});
      try{analyzeText()}catch(_e){}updateDzenAiStatus();document.getElementById('analysisBackdrop')?.classList.add('open');renderAnalysis();toast(aiDzenRun.message);
    }finally{aiDzenBusy=false;setCheckRunning(false);renderAnalysis()}
  }

  startAiDzenArticleCheck=async function(src){
    const source=String(src||editor.value||'');if(!source.trim()){setCheckRunning(false);return}
    const previous={session:aiDzenSessionIssues.map(x=>({...x})),issues:Array.isArray(aiDzenIssues)?aiDzenIssues.map(x=>({...x})):[],source:String(aiDzenSource||''),run:aiDzenRun?{...aiDzenRun}:null};
    aiDzenSessionIssues=[];
    await performSemanticAiCheck(source);
    if(aiDzenRun&&aiDzenRun.state==='success'){
      aiDzenSessionIssues=(Array.isArray(aiDzenIssues)?aiDzenIssues:[]).map(issue=>({...issue,quote:String(issue.quote||source.slice(Number(issue.start)||0,Number(issue.end)||0)),aiOriginalStart:Number(issue.aiOriginalStart??issue.start)||0,aiLastStart:Number(issue.start)||0}));
      remapAiDzenIssues(editor.value||'');
    }else if(previous.session.length){
      aiDzenSessionIssues=previous.session;aiDzenIssues=previous.issues;aiDzenSource=previous.source;remapAiDzenIssues(editor.value||'');if(aiDzenRun)aiDzenRun={...aiDzenRun,previousPreserved:true};
    }
    try{analyzeText()}catch(e){}renderAnalysis();updateDzenAiStatus();
  };

  aiDzenRunDiagnosticHtml=function(){return ''};
  aiDzenRunText=function(){
    if(aiDzenRun.state==='running')return 'проверяется…';if(aiDzenRun.state==='error')return 'ошибка';if(aiDzenRun.state==='success')return String(aiDzenIssues.length)+' замеч.';return 'не запускалась';
  };
  aiDzenStatusLine=function(){return ''};

  function issueSpans(issue,src){
    let spans=[];
    if(Array.isArray(issue.occurrences))spans.push(...issue.occurrences.map(x=>({start:Number(x.start),end:Number(x.end)})));
    if(issue.type==='nearby'&&Number.isFinite(issue.pairStart)&&Number.isFinite(issue.pairEnd))spans.push({start:issue.pairStart,end:issue.pairEnd});
    if(issue.type==='frequent'&&issue.word&&typeof exactWordOccurrences==='function')spans.push(...exactWordOccurrences(issue.word));
    if(Number.isFinite(issue.start)&&Number.isFinite(issue.end))spans.push({start:issue.start,end:issue.end});
    const seen=new Set(),out=[];
    for(const span of spans){let start=Math.max(0,Math.min(src.length,Number(span.start)||0)),end=Math.max(start,Math.min(src.length,Number(span.end)||start));if(end<=start)continue;const key=start+':'+end;if(seen.has(key))continue;seen.add(key);out.push({start,end})}
    return out;
  }
  function collectAiFixTargets(src){
    const map=new Map();
    for(const issue of currentAnalysis.issues||[]){
      for(const span of issueSpans(issue,src)){
        const key=span.start+':'+span.end,existing=map.get(key);
        if(existing){existing.issue_titles.push(issue.title||'Замечание');existing.issue_types.push(issue.type);continue}
        map.set(key,{start:span.start,end:span.end,quote:src.slice(span.start,span.end),issue_titles:[issue.title||'Замечание'],issue_types:[issue.type],detail:String(issue.detail||'').slice(0,500)});
      }
    }
    return [...map.values()].sort((a,b)=>a.start-b.start).slice(0,180).map((x,i)=>({...x,target_id:'t'+(i+1),context:src.slice(Math.max(0,x.start-150),Math.min(src.length,x.end+150))}));
  }
  function protectedTokens(text){return Array.from(String(text||'').matchAll(/https?:\/\/[^\s)]+|(?<![\p{L}\p{N}_])\d+(?:[.,]\d+)?%?(?![\p{L}\p{N}_])/gu)).map(x=>x[0])}
  function sameArray(a,b){return a.length===b.length&&a.every((x,i)=>x===b[i])}
  function normalizeAiPatches(value,targets,src){
    const byId=new Map(targets.map(x=>[x.target_id,x])),raw=Array.isArray(value&&value.patches)?value.patches:[],out=[];
    for(const p of raw){
      const target=byId.get(String(p&&p.target_id||''));if(!target)continue;
      const quote=String(p&&p.quote||''),replacement=String(p&&p.replacement??'');if(!quote||quote===replacement)continue;
      const segment=src.slice(target.start,target.end),rel=segment.indexOf(quote);if(rel<0)continue;
      const start=target.start+rel,end=start+quote.length;
      const maxReplacement=Math.min(5000,Math.max(180,quote.length*3+160));if(replacement.length>maxReplacement)continue;
      if(!sameArray(protectedTokens(quote),protectedTokens(replacement)))continue;
      out.push({start,end,quote,replacement,target_id:target.target_id});
    }
    out.sort((a,b)=>b.start-a.start||b.end-a.end);
    const accepted=[];
    for(const patch of out){if(accepted.some(x=>patch.start<x.end&&patch.end>x.start))continue;accepted.push(patch)}
    return accepted;
  }
  async function startAiFixFromAnalysis(){
    if(aiFixBusy||aiDzenBusy){toast('Дождитесь завершения текущей AI-операции');return}
    analyzeText();const src=editor.value||'',targets=collectAiFixTargets(src);
    if(!targets.length){toast('Нет замечаний для исправления');return}
    if(!aiTextCheckConfigured()){toast('Для AI-исправления настройте API, модель и ключ');return}
    if(typeof ensureProtectiveVersion==='function'&&!ensureProtectiveVersion('До AI-исправления'))return;
    aiFixBusy=true;aiDzenBusy=true;setCheckRunning(true);renderAnalysis();
    try{
      const system='Ты точечный редактор. ARTICLE дан только как контекст для понимания авторского смысла и стиля. Менять разрешено исключительно места из TARGETS. Верни только минимальные точечные замены. Не переписывай статью целиком, не улучшай соседний текст заодно, не добавляй новых идей и фактов, не меняй имена, числа, даты, ссылки и Markdown без прямой необходимости замечания. Для повторов подбирай естественный по контексту синоним или минимально перестраивай отмеченный фрагмент. Для громких обещаний и смысловых замечаний перефразируй только отмеченную цитату, сохраняя исходную мысль. Если безопасной точечной правки нет — пропусти TARGET. quote должна быть точной подстрокой внутри соответствующего TARGET. Верни JSON {"patches":[{"target_id":"t1","quote":"точная часть TARGET","replacement":"замена"}]}.';
      const prompt='ARTICLE:\n'+src+'\n\nTARGETS:\n'+JSON.stringify(targets);
      const parsed=parseAiJson(await aiChat(system,prompt));
      const patches=normalizeAiPatches(parsed,targets,src);
      if(!patches.length)throw new Error('AI не предложил безопасных точечных исправлений');
      let next=src;for(const patch of patches)next=next.slice(0,patch.start)+patch.replacement+next.slice(patch.end);
      if(!sameArray(protectedTokens(src),protectedTokens(next)))throw new Error('AI попытался изменить защищённые числа или ссылки');
      const oldHeadings=(src.match(/^#{1,6}\s/gm)||[]).length,newHeadings=(next.match(/^#{1,6}\s/gm)||[]).length;
      if(oldHeadings!==newHeadings)throw new Error('AI попытался изменить структуру Markdown');
      if(Math.abs(next.length-src.length)>Math.max(4000,Math.floor(src.length*.35)))throw new Error('Ответ AI меняет слишком большой объём текста');
      if(typeof historyCheckpoint==='function')historyCheckpoint();
      editor.value=next;clearAiDzenIssues('idle');
      if(typeof afterProgrammaticEdit==='function')afterProgrammaticEdit(false);else{markAnalysisStale();render(false)}
      analyzeText();closeAnalysis();showPane('edit');editor.blur();
      toast('AI применил точечных исправлений: '+patches.length);
    }catch(e){toast(e&&e.message?e.message:'Не удалось применить AI-исправления')}
    finally{aiFixBusy=false;aiDzenBusy=false;setCheckRunning(false);renderAnalysis()}
  }
  window.startAiFixFromAnalysis=startAiFixFromAnalysis;

  renderAnalysis=function(){
    analysisMode='problems';baseRenderAnalysis();
    const filters=document.getElementById('analysisLocalFilters');if(filters)filters.hidden=true;
    const sum=document.getElementById('analysisSummary');if(!sum)return;
    const issues=Array.isArray(currentAnalysis.issues)?currentAnalysis.issues:[];
    const aiCount=issues.filter(x=>x&&x.ai===true).length;
    const localCount=issues.length-aiCount+(Number(currentAnalysis.overflowTotal)||0);
    let aiRow='';
    if(aiDzenRun.state==='running')aiRow='<div class="analysisStatusRow"><span class="aiSpinner"></span><div class="analysisStatusText"><b>AI проверяет текст…</b><span class="analysisStatusMeta">Смысловая проверка выполняется независимым запросом.</span></div></div>';
    else if(aiDzenRun.state==='success')aiRow='<div class="analysisStatusRow"><div class="analysisStatusText"><b>AI-проверка завершена · замечаний: '+aiCount+'</b><span class="analysisStatusMeta">Повторный запуск будет новой независимой проверкой.</span></div></div>';
    else if(aiDzenRun.state==='error')aiRow='<div class="analysisStatusRow"><div class="analysisStatusText"><b>AI-проверка не завершена</b><span class="analysisStatusMeta">'+escapeHtml(aiDzenRun.message||'Ошибка AI')+'</span></div></div>';
    else aiRow='<div class="analysisStatusRow"><div class="analysisStatusText"><b>AI-проверка не запускалась</b><span class="analysisStatusMeta">Это дополнительная смысловая проверка; локальные замечания уже можно исправлять с AI.</span></div></div>';
    const blocked=aiFixBusy||aiDzenRun.state==='running'||aiDzenBusy;
    const disabled=!issues.length||blocked;
    const fixLabel=aiFixBusy?'<span class="aiSpinner" style="display:inline-block;vertical-align:middle;margin-right:8px"></span>AI исправляет текст…':'Исправить текст с помощью AI';
    sum.className='analysisSummary analysisWorkflowHost';
    sum.innerHTML='<div class="analysisWorkflowStatus"><div class="analysisStatusRow"><div class="analysisStatusText"><b>Локальные замечания: '+localCount+'</b><span class="analysisStatusMeta">Механические проверки обновляются автоматически.</span></div></div>'+aiRow+'<button class="analysisFixButton" type="button" onclick="startAiFixFromAnalysis()" '+(disabled?'disabled':'')+'>'+fixLabel+'</button></div>';
  };
  setAnalysisMode=function(){analysisMode='problems';renderAnalysis()};

  async function requestAiSynonyms(){
    if(aiSynonymBusy||aiDzenBusy){toast('Дождитесь завершения текущей AI-операции');return}
    if(!replacementState){return}
    if(!aiTextCheckConfigured()){toast('Для контекстных синонимов настройте API, модель и ключ');return}
    const start=Number(replacementState.start)||0,end=Number(replacementState.end)||start,word=editor.value.slice(start,end)||replacementState.original;
    const context=editor.value.slice(Math.max(0,start-450),Math.min(editor.value.length,end+450));
    aiSynonymBusy=true;aiDzenBusy=true;
    const btn=document.getElementById('aiSynonymBtn');if(btn){btn.disabled=true;btn.textContent='AI подбирает…'}
    try{
      const system='Подбери современные естественные русские синонимы именно для указанного места текста. Учитывай значение, стиль, управление и грамматическую форму. Не предлагай архаичные, книжные или семантически неточные варианты без необходимости. Верни только JSON {"suggestions":["вариант",...]}, от 3 до 8 вариантов, уже в форме, которую можно вставить вместо WORD.';
      const parsed=parseAiJson(await aiChat(system,'WORD: '+word+'\nCONTEXT:\n'+context));
      const suggestions=uniqueStrings(parsed&&parsed.suggestions,8,100).filter(x=>x.toLocaleLowerCase('ru-RU')!==word.toLocaleLowerCase('ru-RU'));
      if(!suggestions.length)throw new Error('AI не нашёл подходящих замен');
      const chips=document.getElementById('replaceChips');if(!chips)return;
      const local=suggestionsForWord(word).filter(x=>!suggestions.some(y=>y.toLocaleLowerCase('ru-RU')===String(x).toLocaleLowerCase('ru-RU'))).slice(0,5);
      chips.innerHTML=suggestions.map(x=>{const arg=JSON.stringify(x).replace(/'/g,'&#39;');return '<button class="replaceChip" onclick=\'applyReplacement('+arg+')\'>'+escapeHtml(x)+'</button>'}).join('')+(local.length?'<span class="smallNote" style="min-width:100%;display:block">Офлайн-варианты:</span>'+local.map(x=>{const arg=JSON.stringify(x).replace(/'/g,'&#39;');return '<button class="replaceChip" onclick=\'applyReplacement('+arg+')\'>'+escapeHtml(x)+'</button>'}).join(''):'');
    }catch(e){toast(e&&e.message?e.message:'Не удалось подобрать синонимы')}
    finally{aiSynonymBusy=false;aiDzenBusy=false;if(btn){btn.disabled=false;btn.textContent='Подобрать с AI по контексту'}}
  }
  window.requestAiSynonyms=requestAiSynonyms;
  renderReplacement=function(){
    baseRenderReplacement();const panel=document.getElementById('replacePanel');if(!panel||!replacementState)return;
    let btn=document.getElementById('aiSynonymBtn');
    if(!btn){btn=document.createElement('button');btn.id='aiSynonymBtn';btn.type='button';btn.className='nativeBtn aiSynonymAction';btn.textContent='Подобрать с AI по контексту';btn.addEventListener('click',requestAiSynonyms);const manual=panel.querySelector('.replaceManual');panel.insertBefore(btn,manual)}
    const note=panel.querySelector('.replaceNote');if(note)note.textContent='AI подбирает замену по контексту. Локальный словарь остаётся офлайн-резервом.';
  };

  openSettings=function(){baseOpenSettings();installWorkflowUi();syncMyRulesUi();updateDzenAiStatus();renderDzenKnowledge()};
  if(typeof syncDzenAiSettingsUI==='function'){
    const baseSyncDzenAiSettingsUI=syncDzenAiSettingsUI;
    syncDzenAiSettingsUI=function(){baseSyncDzenAiSettingsUI();installWorkflowUi();updateDzenAiStatus()};
  }

  if(typeof setEditorTextForArticle==='function'){
    const baseSetEditorTextForArticle=setEditorTextForArticle;
    setEditorTextForArticle=function(text,focus){clearAiDzenIssues('idle');return baseSetEditorTextForArticle(text,focus)};
  }
  if(typeof loadFileText==='function'){
    const baseLoadFileText=loadFileText;
    loadFileText=async function(text,name=''){const before=editor.value;await baseLoadFileText(text,name);if(editor.value!==before){clearAiDzenIssues('idle');try{analyzeText()}catch(e){}}};
  }
  if(typeof restoreVersion==='function'){
    const baseRestoreVersion=restoreVersion;
    restoreVersion=async function(id){const before=editor.value;await baseRestoreVersion(id);if(editor.value!==before){clearAiDzenIssues('idle');try{analyzeText()}catch(e){}}};
  }

  window.handleNativeBack=function(){
    const knowledge=document.getElementById('dzenKnowledgeBackdrop');if(knowledge&&knowledge.classList.contains('open')){closeDzenKnowledge();return true}
    return typeof baseHandleNativeBack==='function'?baseHandleNativeBack():false;
  };

  installWorkflowUi();
})();
