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
    if(i.type==='dzen')lines.push(`Уровень: ${i.severity==='critical'?'высокий риск — проверить':'проверить вручную'}`);
    lines.push('');
  });
}

function buildCurrentAnalysisReport(){
  analyzeText();
  const src=editor.value||'',a=currentAnalysis,lines=[],issues=a.issues||[];
  const aiCount=issues.filter(x=>x&&x.ai===true).length;
  lines.push('ОТЧЁТ «ДЗЕН ТЕКСТ» ПО ТЕКУЩЕЙ ПРОВЕРКЕ');
  lines.push(`Создан: ${new Date().toLocaleString('ru-RU')}`);
  lines.push(`Всего замечаний: ${issues.length}.`);
  lines.push(`База правил Дзена: ${String(activeDzenRules().version||'встроенная')}.`);
  if(typeof aiDzenRun!=='undefined'&&aiDzenRun.state==='success')lines.push(`Последняя AI-проверка выполнена; осталось замечаний: ${aiCount}.`);
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
  if(note)note.textContent='В отчёт попадут текущие замечания без технических пометок об источнике проверки.';
}
function renderAnalysis(){
  const box=document.getElementById('analysisContent'),
        sum=document.getElementById('analysisSummary'),
        collapsed=document.getElementById('analysisCollapsedSummary'),
        a=currentAnalysis,
        aiCount=a.issues.filter(x=>x&&x.ai===true).length,
        total=a.warningCount||0;

  updateAnalysisExportUi();
  document.querySelectorAll('.analysisFilter').forEach(b=>b.classList.toggle('active',b.dataset.mode===analysisMode));

  let suffix=' · локальная проверка обновляется автоматически';
  if(typeof aiDzenRun!=='undefined'&&aiDzenRun.state==='running')suffix=' · AI-проверка выполняется…';
  else if(typeof aiDzenRun!=='undefined'&&aiDzenRun.state==='success')suffix=` · осталось замечаний последней AI-проверки: <b>${aiCount}</b>`;
  else if(typeof aiDzenRun!=='undefined'&&aiDzenRun.state==='error')suffix=' · последняя AI-проверка завершилась ошибкой';
  if(sum)sum.innerHTML=`Замечаний: <b>${total}</b>${suffix}.`;
  if(collapsed)collapsed.textContent=total?`🔴 замечаний: ${total}`:'🟢 замечаний нет';

  let html=typeof aiDzenRunDiagnosticHtml==='function'?aiDzenRunDiagnosticHtml():'';
  if(analysisMode==='all'){
    html+=`<div class="analysisInfo"><div class="metric"><b>${a.metrics.headings?.length||0}</b><span>заголовков</span></div><div class="metric"><b>${a.metrics.avgSentence||0}</b><span>слов в среднем предложении</span></div><div class="metric"><b>${a.metrics.lists||0}</b><span>пунктов списков</span></div><div class="metric"><b>${a.metrics.links||0}</b><span>ссылок</span></div></div>`;
  }

  if(analysisMode==='dzen'){
    const rows=a.issues.filter(x=>x.type==='dzen');
    html+=`<div class="analysisDzenNote">База правил: <b>${escapeHtml(String(activeDzenRules().version||'встроенная'))}</b>. Совпадение означает повод проверить формулировку, а не автоматический вердикт.</div>`;
    if(rows.length){
      const totalRows=rows.length+(Number(a.issueOverflow?.dzen)||0);
      html+=`<div class="analysisGroup"><div class="analysisTitle"><span>Возможные риски</span><span class="badge bad">${totalRows}</span></div>${rows.map(issueHtml).join('')}${analysisOverflowNote('dzen')}</div>`;
    }else{
      html+='<div class="analysisEmpty">Замечаний по правилам Дзена не найдено.</div>';
    }
    html+=renderDzenManual();
    box.innerHTML=html;
    return;
  }

  for(const g of issueGroups()){
    const rows=a.issues.filter(x=>x.type===g.id);
    if(g.id==='heading'&&analysisMode==='all'){
      const hs=a.metrics.headings||[],count=rows.length+(Number(a.issueOverflow?.[g.id])||0);
      html+=`<div class="analysisGroup"><div class="analysisTitle"><span>${g.name}</span><span class="badge ${count?'bad':''}">${count||'✓'}</span></div>`;
      if(!hs.length)html+='<div class="analysisRow"><span class="meta">Заголовков Markdown не найдено.</span></div>';
      else for(const h of hs){const bad=rows.find(r=>r.start===h.start);html+=bad?issueHtml(bad):`<button class="analysisRow jump" onclick="jumpTo(${h.start},${h.end})"><span class="ok">H${h.level} · ${h.text.length} знаков</span> ${escapeHtml(h.text)}<span class="meta">Нажмите, чтобы перейти к заголовку</span></button>`}
      html+='</div>';
      continue;
    }
    if(!rows.length)continue;
    const count=rows.length+(Number(a.issueOverflow?.[g.id])||0);
    html+=`<div class="analysisGroup"><div class="analysisTitle"><span>${g.name}</span><span class="badge bad">${count}</span></div>${rows.map(issueHtml).join('')}${analysisOverflowNote(g.id)}${g.id==='spelling'?'<div class="spellAttribution"><a href="https://yandex.ru/dev/speller/">Проверка правописания: Яндекс.Спеллер</a></div>':''}</div>`;
  }

  if(!total)html+='<div class="analysisEmpty">Текущих замечаний нет. Переключите «Всё», чтобы посмотреть информационные показатели.</div>';
  box.innerHTML=html;
}
function issueHtml(i){
  let sev=i.severity==='critical'?'Контроль':'Обратите внимание';
  if(i.type==='dzen')sev=i.severity==='critical'?'Высокий риск — проверить':'Проверить вручную';
  if(i.type==='aiStyle')sev='Маркер машинного стиля — проверить';
  if(i.type==='aiQuality')sev='Качество текста — проверить';
  const word=i.word?String(i.word):'';
  const idx=currentAnalysis.issues.indexOf(i);
  const sameType=currentAnalysis.issues.filter(x=>x.type===i.type).length;
  let click,cls,hint;
  if(i.type==='nearby'&&Number.isFinite(i.pairStart)){
    click=`openNearbyRepeat(${i.pairStart},${i.pairEnd},${i.start},${i.end},${i.firstSentenceStart},${i.firstSentenceEnd},${i.secondSentenceStart},${i.secondSentenceEnd},${JSON.stringify(word)})`;
    cls='analysisRow jump nearbyWord';hint='нажмите: показать оба повтора';
  }else if((i.type==='phrase'||i.type==='opening'||i.type==='aiStyle')&&Array.isArray(i.occurrences)&&i.occurrences.length>1){
    click=`openRepeatNavigator(${idx})`;cls='analysisRow jump';hint=`нажмите: листать ${i.occurrences.length} совпадений`;
  }else if(i.type==='spelling'){
    click=`openSpellIssue(${idx})`;cls='analysisRow jump';hint='нажмите: варианты исправления';
  }else if(word&&i.type==='frequent'){
    click=`openReplacement(${i.start},${i.end},${JSON.stringify(word)})`;cls='analysisRow jump frequentWord';hint='нажмите: листать совпадения и выбрать замену';
  }else if(sameType>1){
    click=`openIssueNavigator(${idx})`;cls='analysisRow jump'+(i.type==='dzen'?' dzenRisk':'');hint=`нажмите: листать ${sameType} замечаний этого типа`;
  }else{
    click=`jumpTo(${i.start},${i.end})`;cls='analysisRow jump'+(i.type==='dzen'?' dzenRisk':'');hint='нажмите для перехода';
  }
  return `<button class="${cls}" onclick='${click.replace(/'/g,"&#39;")}'><span class="warn">${escapeHtml(i.title)}</span><span class="meta">${escapeHtml(i.detail||'')} · ${sev} · ${hint}</span></button>`;
}