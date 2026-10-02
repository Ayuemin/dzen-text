function analysisVisibleAndHidden(type){
  const visible=currentAnalysis.issues.filter(x=>x.type===type).length;
  const hidden=Number(currentAnalysis.issueOverflow&&currentAnalysis.issueOverflow[type])||0;
  return {visible,hidden,total:visible+hidden};
}
function analysisOverflowNote(type){
  const n=analysisVisibleAndHidden(type);
  return n.hidden?'<div class="analysisOverflowNote">Показано '+n.visible+' из '+n.total+' однотипных замечаний. Остальные скрыты, чтобы не перегружать редактор.</div>':'';
}

function reportIssueLines(lines,src,issues){
  issues.forEach((i,n)=>{
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
    if(i.type==='dzen'){
      if(i.ruleId)lines.push(`Правило базы: ${cleanReportText(i.ruleId)}`);
      if(i.sourceUrl)lines.push(`Источник правила: ${cleanReportText(i.sourceUrl)}`);
      lines.push(`Уровень: ${i.severity==='critical'?'высокий риск — проверить':'проверить в контексте'}`);
    }
    lines.push('');
  });
}

function currentDzenKnowledgeReportLine(){
  try{
    if(typeof dzenAiKnowledge!=='function')return 'База правил Дзена: не собрана.';
    const k=dzenAiKnowledge();
    if(!k||!Array.isArray(k.items)||!k.items.length)return 'База правил Дзена: не собрана.';
    const date=k.builtAt?new Date(k.builtAt).toLocaleString('ru-RU'):'—';
    const current=typeof dzenAiKnowledgeCurrent==='function'?dzenAiKnowledgeCurrent(k):true;
    return `База правил Дзена: ${k.items.length} пунктов · ${current?'актуальна':'требует ручного обновления'} · собрана ${date}.`;
  }catch(e){return 'База правил Дзена: состояние недоступно.'}
}

function buildCurrentAnalysisReport(){
  analyzeText();
  const src=editor.value||'',a=currentAnalysis,lines=[],issues=a.issues||[];
  const aiCount=issues.filter(x=>x&&x.ai===true).length;
  const localCount=Math.max(0,issues.length-aiCount+(Number(a.overflowTotal)||0));
  lines.push('ОТЧЁТ «ДЗЕН ТЕКСТ» ПО ТЕКУЩЕЙ ПРОВЕРКЕ');
  lines.push(`Создан: ${new Date().toLocaleString('ru-RU')}`);
  lines.push(`Всего замечаний: ${issues.length}. Локальных: ${localCount}. AI: ${aiCount}.`);
  lines.push(currentDzenKnowledgeReportLine());
  if(typeof aiDzenRun!=='undefined'){
    if(aiDzenRun.state==='success')lines.push(`Последняя AI-проверка завершена; актуальных AI-замечаний: ${aiCount}.`);
    else if(aiDzenRun.state==='running')lines.push('AI-проверка выполняется.');
    else if(aiDzenRun.state==='error')lines.push(`Последняя AI-проверка не завершена: ${cleanReportText(aiDzenRun.message||'ошибка')}.`);
    else lines.push('AI-проверка для текущего текста не запускалась.');
  }
  lines.push('');
  if(!issues.length){lines.push('Текущих замечаний нет.');return lines.join('\n')}
  reportIssueLines(lines,src,issues);
  return lines.join('\n');
}
function buildAnalysisReport(){return buildCurrentAnalysisReport()}
function buildAiAnalysisReport(){return buildCurrentAnalysisReport()}
function buildCombinedAnalysisReport(){return buildCurrentAnalysisReport()}
function currentReportFileName(){return `Dzen-Text-report-${new Date().toISOString().slice(0,10)}.txt`}
function copyPlainReport(text){
  const ta=document.createElement('textarea');
  ta.value=text;ta.style.position='fixed';ta.style.left='-10000px';
  document.body.appendChild(ta);ta.select();
  let ok=false;try{ok=document.execCommand('copy')}catch(e){}
  ta.remove();return ok;
}
function copyCurrentAnalysisReport(){
  const text=buildCurrentAnalysisReport();
  if(copyPlainReport(text))toast('Отчёт скопирован');else toast('Не удалось скопировать отчёт');
}
function saveCurrentAnalysisReport(){
  const text=buildCurrentAnalysisReport(),name=currentReportFileName();
  if(window.AndroidFile&&typeof AndroidFile.saveReport==='function'){AndroidFile.saveReport(text,name);return}
  try{
    const blob=new Blob([text],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1200);toast('Отчёт сохранён');
  }catch(e){toast('Не удалось сохранить отчёт')}
}
window.onNativeReportSaved=(name)=>toast(`Отчёт сохранён${name?': '+name:''}`);
window.onNativeReportError=(msg)=>toast(msg||'Не удалось сохранить отчёт');

function updateAnalysisExportUi(){
  const title=document.getElementById('analysisExportTitleText'),note=document.getElementById('analysisExportNote');
  if(title)title.textContent='Выгрузить замечания';
  if(note)note.textContent='В отчёт попадут все текущие локальные и актуальные AI-замечания.';
}
function renderAnalysis(){
  const box=document.getElementById('analysisContent'),
        sum=document.getElementById('analysisSummary'),
        collapsed=document.getElementById('analysisCollapsedSummary'),
        a=currentAnalysis,
        aiCount=a.issues.filter(x=>x&&x.ai===true).length,
        total=a.warningCount||0;

  updateAnalysisExportUi();
  if(sum){
    let suffix=' · локальная проверка обновляется автоматически';
    if(typeof aiDzenRun!=='undefined'&&aiDzenRun.state==='running')suffix=' · AI-проверка выполняется…';
    else if(typeof aiDzenRun!=='undefined'&&aiDzenRun.state==='success')suffix=` · актуальных AI-замечаний: <b>${aiCount}</b>`;
    else if(typeof aiDzenRun!=='undefined'&&aiDzenRun.state==='error')suffix=' · последняя AI-проверка завершилась ошибкой';
    sum.innerHTML=`Замечаний: <b>${total}</b>${suffix}.`;
  }
  if(collapsed)collapsed.textContent=total?`🔴 замечаний: ${total}`:'🟢 замечаний нет';

  let html=typeof aiDzenRunDiagnosticHtml==='function'?aiDzenRunDiagnosticHtml():'';
  for(const g of issueGroups()){
    const rows=a.issues.filter(x=>x.type===g.id);
    if(!rows.length)continue;
    const count=rows.length+(Number(a.issueOverflow?.[g.id])||0);
    html+=`<div class="analysisGroup"><div class="analysisTitle"><span>${g.name}</span><span class="badge bad">${count}</span></div>${rows.map(issueHtml).join('')}${analysisOverflowNote(g.id)}</div>`;
  }

  if(!total)html+='<div class="analysisEmpty">Текущих замечаний нет.</div>';
  box.innerHTML=html;
}
function issueHtml(i){
  let sev=i.severity==='critical'?'Контроль':'Обратите внимание';
  if(i.type==='dzen')sev=i.severity==='critical'?'Высокий риск — проверить':'Правило Дзена — проверить';
  if(i.type==='aiStyle')sev='Стиль текста — проверить';
  if(i.type==='aiQuality')sev='Язык и смысл — проверить';
  const word=i.word?String(i.word):'';
  const idx=currentAnalysis.issues.indexOf(i);
  const sameType=currentAnalysis.issues.filter(x=>x.type===i.type).length;
  let click,cls,hint;
  if(i.type==='nearby'&&Number.isFinite(i.pairStart)){
    click=`openNearbyRepeat(${i.pairStart},${i.pairEnd},${i.start},${i.end},${i.firstSentenceStart},${i.firstSentenceEnd},${i.secondSentenceStart},${i.secondSentenceEnd},${JSON.stringify(word)})`;
    cls='analysisRow jump nearbyWord';hint='нажмите: показать оба повтора';
  }else if((i.type==='phrase'||i.type==='opening'||i.type==='aiStyle')&&Array.isArray(i.occurrences)&&i.occurrences.length>1){
    click=`openRepeatNavigator(${idx})`;cls='analysisRow jump';hint=`нажмите: листать ${i.occurrences.length} совпадений`;
  }else if(word&&i.type==='frequent'){
    click=`openReplacement(${i.start},${i.end},${JSON.stringify(word)})`;cls='analysisRow jump frequentWord';hint='нажмите: листать совпадения и выбрать замену';
  }else if(sameType>1){
    click=`openIssueNavigator(${idx})`;cls='analysisRow jump'+(i.type==='dzen'?' dzenRisk':'');hint=`нажмите: листать ${sameType} замечаний этого типа`;
  }else{
    click=`jumpTo(${i.start},${i.end})`;cls='analysisRow jump'+(i.type==='dzen'?' dzenRisk':'');hint='нажмите для перехода';
  }
  return `<button class="${cls}" onclick='${click.replace(/'/g,"&#39;")}'><span class="warn">${escapeHtml(i.title)}</span><span class="meta">${escapeHtml(i.detail||'')} · ${sev} · ${hint}</span></button>`;
}
