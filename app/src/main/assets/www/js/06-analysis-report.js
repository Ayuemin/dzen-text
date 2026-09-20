function analysisVisibleAndHidden(type){
  const visible=currentAnalysis.issues.filter(x=>x.type===type).length;
  const hidden=Number(currentAnalysis.issueOverflow&&currentAnalysis.issueOverflow[type])||0;
  return {visible,hidden,total:visible+hidden};
}
function analysisOverflowNote(type){
  const n=analysisVisibleAndHidden(type);
  return n.hidden?'<div class="analysisOverflowNote">Показано '+n.visible+' из '+n.total+' однотипных замечаний. Остальные скрыты, чтобы не перегружать редактор.</div>':'';
}

function buildAnalysisReport(){
  analyzeText();
  const src=editor.value||'',a=currentAnalysis,lines=[];
  const localIssues=a.issues.filter(x=>!x.ai);
  const localDzen=localIssues.filter(x=>x.type==='dzen').length;
  const localAiStyle=localIssues.filter(x=>x.type==='aiStyle').length;
  const localSpell=localIssues.filter(x=>x.type==='spelling').length;
  const localEditor=localIssues.length-localDzen-localAiStyle-localSpell;
  lines.push('ОТЧЁТ «ДЗЕН ТЕКСТ» ПО ЛОКАЛЬНОЙ РЕДАКТОРСКОЙ ПРОВЕРКЕ');
  lines.push(`Создан: ${new Date().toLocaleString('ru-RU')}`);
  lines.push(`Всего локальных замечаний: ${localIssues.length}; редакторских: ${localEditor}; признаки ИИ-стиля: ${localAiStyle}; правила Дзена: ${localDzen}; орфография: ${localSpell}.`);
  lines.push(`База правил Дзена: ${String(activeDzenRules().version||'встроенная')}.`);
  lines.push('');
  lines.push('Инструкция для модели: исправляйте только отмеченные места, сверяясь с «Меткой поиска» и контекстом. Не меняйте смысл и структуру статьи без необходимости. Сигналы «Правила Дзена» означают повод проверить формулировку, а не установленное нарушение.');
  lines.push('');
  if(!localIssues.length){lines.push('Локальных замечаний не найдено.');return lines.join('\n')}
  localIssues.forEach((i,n)=>{
    const start=Number.isFinite(i.start)?i.start:0,end=Number.isFinite(i.end)?i.end:start;
    let marker=cleanReportText(src.slice(start,end));
    if(!marker)marker=cleanReportText(i.word||i.title);
    const context=shortContext(src,start,end);
    lines.push(`${n+1}. [${reportTypeName(i.type)}] ${cleanReportText(i.title)}`);
    lines.push(`Метка поиска: «${marker}»`);
    if(context)lines.push(`Контекст: ${context}`);
    lines.push(`Позиция: символы ${start+1}–${Math.max(start+1,end)}`);
    if(Array.isArray(i.occurrences)&&i.occurrences.length>1)lines.push(`Совпадения: ${i.occurrences.slice(0,12).map(o=>(Number(o.start)||0)+1).join(', ')}${i.occurrences.length>12?' …':''}`);
    if(i.detail)lines.push(`Комментарий: ${cleanReportText(i.detail)}`);
    if(i.type==='dzen')lines.push(`Уровень: ${i.severity==='critical'?'высокий риск — проверить':'проверить вручную'}`);
    lines.push('');
  });
  return lines.join('\n');
}
function copyPlainReport(text){const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-10000px';document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy')}catch(e){}ta.remove();return ok}
function copyAnalysisReport(){const text=buildAnalysisReport();if(copyPlainReport(text))toast('Отчёт с замечаниями скопирован');else toast('Не удалось скопировать отчёт')}
function saveAnalysisReport(){const text=buildAnalysisReport(),name=`Dzen-Text-report-${new Date().toISOString().slice(0,10)}.txt`;if(window.AndroidFile&&typeof AndroidFile.saveReport==='function'){AndroidFile.saveReport(text,name);return}try{const blob=new Blob([text],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1200);toast('Отчёт сохранён')}catch(e){toast('Не удалось сохранить отчёт')}}
function buildAiAnalysisReport(){
  analyzeText();
  const src=editor.value||'',a=currentAnalysis,lines=[];
  const aiRows=a.issues.filter(x=>x&&x.ai===true);
  const aiRun=typeof aiDzenSource!=='undefined'&&aiDzenSource===src;
  const knowledge=typeof dzenAiKnowledge==='function'?dzenAiKnowledge():null;
  lines.push('ОТЧЁТ «ДЗЕН ТЕКСТ» — ЗАМЕЧАНИЯ AI-ПРОВЕРКИ');
  lines.push(`Создан: ${new Date().toLocaleString('ru-RU')}`);
  lines.push(`AI-замечаний: ${aiRows.length}.`);
  if(settings.dzenAiModel)lines.push(`Модель: ${cleanReportText(settings.dzenAiModel)}.`);
  if(settings.dzenAiBaseUrl)lines.push(`API: ${cleanReportText(settings.dzenAiBaseUrl)}.`);
  if(knowledge&&knowledge.builtAt)lines.push(`AI-база Дзена собрана: ${new Date(knowledge.builtAt).toLocaleString('ru-RU')}.`);
  if(knowledge&&knowledge.crawl)lines.push(`Страниц базы: обработано ${Number(knowledge.crawl.processed||0)}, пропущено ${Number(knowledge.crawl.skipped||0)}.`);
  lines.push('');
  lines.push('Инструкция для модели: исправляйте только перечисленные места. Не меняйте смысл статьи без необходимости. Замечания по правилам Дзена являются редакторскими сигналами для проверки, а не автоматическим вердиктом о нарушении.');
  lines.push('');
  if(!aiRun){
    lines.push('AI-проверка для текущей версии текста не запускалась или её результат устарел после редактирования.');
    return lines.join('\n');
  }
  if(!aiRows.length){
    lines.push('AI-проверка выполнена. Дополнительных AI-замечаний не найдено.');
    return lines.join('\n');
  }
  aiRows.forEach((i,n)=>{
    const start=Number.isFinite(i.start)?i.start:0,end=Number.isFinite(i.end)?i.end:start;
    let marker=cleanReportText(src.slice(start,end));
    if(!marker)marker=cleanReportText(i.word||i.title);
    const context=shortContext(src,start,end);
    const type=i.type==='aiStyle'?'AI · стиль':'AI · Дзен';
    lines.push(`${n+1}. [${type}] ${cleanReportText(i.title)}`);
    lines.push(`Метка поиска: «${marker}»`);
    if(context)lines.push(`Контекст: ${context}`);
    lines.push(`Позиция: символы ${start+1}–${Math.max(start+1,end)}`);
    if(i.detail)lines.push(`Комментарий: ${cleanReportText(i.detail)}`);
    if(i.type==='dzen')lines.push(`Уровень: ${i.severity==='critical'?'высокий риск — проверить':'проверить вручную'}`);
    lines.push('');
  });
  return lines.join('\n');
}
function copyAiAnalysisReport(){
  const text=buildAiAnalysisReport();
  if(copyPlainReport(text))toast('AI-замечания скопированы');else toast('Не удалось скопировать AI-отчёт');
}
function saveAiAnalysisReport(){
  const text=buildAiAnalysisReport(),name=`Dzen-Text-AI-report-${new Date().toISOString().slice(0,10)}.txt`;
  if(window.AndroidFile&&typeof AndroidFile.saveReport==='function'){AndroidFile.saveReport(text,name);return}
  try{
    const blob=new Blob([text],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1200);toast('AI-отчёт сохранён');
  }catch(e){toast('Не удалось сохранить AI-отчёт')}
}
window.onNativeReportSaved=(name)=>toast(`Отчёт сохранён${name?': '+name:''}`);window.onNativeReportError=(msg)=>toast(msg||'Не удалось сохранить отчёт');
function renderAnalysis(){
  const box=document.getElementById('analysisContent'),
        sum=document.getElementById('analysisSummary'),
        collapsed=document.getElementById('analysisCollapsedSummary'),
        a=currentAnalysis,
        localIssues=a.issues.filter(x=>!x.ai),
        aiIssues=a.issues.filter(x=>x.ai),
        overflow=a.issueOverflow||{},
        overflowTotal=Object.values(overflow).reduce((n,v)=>n+(Number(v)||0),0),
        localTotal=localIssues.length+overflowTotal,
        localDzen=localIssues.filter(x=>x.type==='dzen').length+(Number(overflow.dzen)||0),
        localAiStyle=localIssues.filter(x=>x.type==='aiStyle').length+(Number(overflow.aiStyle)||0),
        localSpell=localIssues.filter(x=>x.type==='spelling').length+(Number(overflow.spelling)||0),
        localEditor=localTotal-localDzen-localAiStyle-localSpell,
        aiCount=aiIssues.length;

  let spellPart=settings.onlineSpelling
    ?(spellStatus==='checking'?' · орфография: <b>проверяю…</b>':` · орфография: <b>${localSpell}</b>`)
    :' · онлайн-орфография: выкл.';

  sum.innerHTML=`Локальных замечаний: <b>${localTotal}</b> · AI: <b>${aiCount}</b>${spellPart}.`;
  if(collapsed)collapsed.textContent=`${localTotal?'🔴':'🟢'} локальных: ${localTotal} · ${aiCount?'🟣':'🟢'} AI: ${aiCount}`;
  document.querySelectorAll('.analysisFilter').forEach(b=>b.classList.toggle('active',b.dataset.mode===analysisMode));

  let html='';

  if(analysisMode==='ai'){
    const aiCurrent=typeof aiDzenSource!=='undefined'&&aiDzenSource===(editor.value||'');
    if(!aiCurrent){
      html+='<div class="analysisEmpty">AI-проверка для текущей версии текста ещё не выполнена или результат устарел после редактирования.</div>';
      box.innerHTML=html;
      return;
    }
    if(!aiIssues.length){
      html+='<div class="analysisEmpty">AI-проверка выполнена. Дополнительных замечаний не найдено.</div>';
      box.innerHTML=html;
      return;
    }
    const groups=[
      {id:'dzen',name:'AI · соответствие Дзену'},
      {id:'aiStyle',name:'AI · стиль текста'}
    ];
    for(const g of groups){
      const rows=aiIssues.filter(x=>x.type===g.id);
      if(!rows.length)continue;
      html+=`<div class="analysisGroup"><div class="analysisTitle"><span>${g.name}</span><span class="badge bad">${rows.length}</span></div>${rows.map(issueHtml).join('')}</div>`;
    }
    box.innerHTML=html;
    return;
  }

  if(analysisMode==='all'){
    html+=`<div class="analysisInfo"><div class="metric"><b>${a.metrics.headings?.length||0}</b><span>заголовков</span></div><div class="metric"><b>${a.metrics.avgSentence||0}</b><span>слов в среднем предложении</span></div><div class="metric"><b>${a.metrics.lists||0}</b><span>пунктов списков</span></div><div class="metric"><b>${a.metrics.links||0}</b><span>ссылок</span></div></div>`;
  }

  if(analysisMode==='dzen'){
    const rows=localIssues.filter(x=>x.type==='dzen');
    html+=`<div class="analysisDzenNote">База правил: <b>${escapeHtml(String(activeDzenRules().version||'встроенная'))}</b>. Это только встроенная/локальная проверка. AI-замечания находятся во вкладке «AI».</div>`;
    if(rows.length){
      const total=rows.length+(Number(overflow.dzen)||0);
      html+=`<div class="analysisGroup"><div class="analysisTitle"><span>Возможные риски</span><span class="badge bad">${total}</span></div>${rows.map(issueHtml).join('')}${analysisOverflowNote('dzen')}</div>`;
    }else{
      html+='<div class="analysisEmpty">Автоматические признаки риска по локальной базе не найдены.</div>';
    }
    html+=renderDzenManual();
    box.innerHTML=html;
    return;
  }

  for(const g of issueGroups()){
    const rows=localIssues.filter(x=>x.type===g.id);
    if(g.id==='heading'&&analysisMode==='all'){
      const hs=a.metrics.headings||[];
      const total=rows.length+(Number(overflow[g.id])||0);
      html+=`<div class="analysisGroup"><div class="analysisTitle"><span>${g.name}</span><span class="badge ${total?'bad':''}">${total||'✓'}</span></div>`;
      if(!hs.length){
        html+='<div class="analysisRow"><span class="meta">Заголовков Markdown не найдено.</span></div>';
      }else{
        for(const h of hs){
          const bad=rows.find(r=>r.start===h.start);
          html+=bad?issueHtml(bad):`<button class="analysisRow jump" onclick="jumpTo(${h.start},${h.end})"><span class="ok">H${h.level} · ${h.text.length} знаков</span> ${escapeHtml(h.text)}<span class="meta">Нажмите, чтобы перейти к заголовку</span></button>`;
        }
      }
      html+='</div>';
      continue;
    }
    if(!rows.length)continue;
    const total=rows.length+(Number(overflow[g.id])||0);
    html+=`<div class="analysisGroup"><div class="analysisTitle"><span>${g.name}</span><span class="badge bad">${total}</span></div>${rows.map(issueHtml).join('')}${analysisOverflowNote(g.id)}${g.id==='spelling'?'<div class="spellAttribution"><a href="https://yandex.ru/dev/speller/">Проверка правописания: Яндекс.Спеллер</a></div>':''}</div>`;
  }
  if(!localTotal)html+='<div class="analysisEmpty">Локальных замечаний нет. Переключите «Всё», чтобы посмотреть информационные показатели, или «AI» для результатов модели.</div>';
  box.innerHTML=html;
}
function issueHtml(i){
  let sev=i.severity==='critical'?'Контроль':'Обратите внимание';
  if(i.type==='dzen')sev=i.severity==='critical'?'Высокий риск — проверить':'Проверить вручную';
  if(i.type==='aiStyle')sev='Маркер машинного стиля — проверить';
  const word=i.word?String(i.word):'';
  const idx=currentAnalysis.issues.indexOf(i);
  const sameType=currentAnalysis.issues.filter(x=>x.type===i.type&&!!x.ai===!!i.ai).length;
  let click,cls,hint;
  if(i.type==='nearby'&&Number.isFinite(i.pairStart)){
    click=`openNearbyRepeat(${i.pairStart},${i.pairEnd},${i.start},${i.end},${i.firstSentenceStart},${i.firstSentenceEnd},${i.secondSentenceStart},${i.secondSentenceEnd},${JSON.stringify(word)})`;
    cls='analysisRow jump nearbyWord';
    hint='нажмите: показать оба повтора';
  }else if((i.type==='phrase'||i.type==='opening'||i.type==='aiStyle')&&Array.isArray(i.occurrences)&&i.occurrences.length>1){
    click=`openRepeatNavigator(${idx})`;
    cls='analysisRow jump';
    hint=`нажмите: листать ${i.occurrences.length} совпадений`;
  }else if(i.type==='spelling'){
    click=`openSpellIssue(${idx})`;
    cls='analysisRow jump';
    hint='нажмите: варианты исправления';
  }else if(word&&i.type==='frequent'){
    click=`openReplacement(${i.start},${i.end},${JSON.stringify(word)})`;
    cls='analysisRow jump frequentWord';
    hint='нажмите: листать совпадения и выбрать замену';
  }else if(sameType>1){
    click=`openIssueNavigator(${idx})`;
    cls='analysisRow jump'+(i.type==='dzen'?' dzenRisk':'');
    hint=`нажмите: листать ${sameType} замечаний этого типа`;
  }else{
    click=`jumpTo(${i.start},${i.end})`;
    cls='analysisRow jump'+(i.type==='dzen'?' dzenRisk':'');
    hint='нажмите для перехода';
  }
  return `<button class="${cls}" onclick='${click.replace(/'/g,"&#39;")}'><span class="warn">${escapeHtml(i.title)}</span><span class="meta">${escapeHtml(i.detail||'')} · ${sev} · ${hint}</span></button>`;
}
