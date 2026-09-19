function buildAnalysisReport(){analyzeText();const src=editor.value||'',a=currentAnalysis,lines=[];lines.push('ОТЧЁТ «ДЗЕН ТЕКСТ» ПО РЕДАКТОРСКОЙ ПРОВЕРКЕ');lines.push(`Создан: ${new Date().toLocaleString('ru-RU')}`);lines.push(`Всего замечаний: ${a.warningCount||0}; редакторских: ${a.editorCount||0}; признаки ИИ-стиля: ${a.aiStyleCount||0}; правила Дзена: ${a.dzenCount||0}; орфография: ${a.spellCount||0}.`);lines.push(`База правил Дзена: ${String(activeDzenRules().version||'встроенная')}.`);lines.push('');lines.push('Инструкция для модели: исправляйте только отмеченные места, сверяясь с «Меткой поиска» и контекстом. Не меняйте смысл и структуру статьи без необходимости. Сигналы «Правила Дзена» означают повод проверить формулировку, а не установленное нарушение.');lines.push('');if(!a.issues.length){lines.push('Замечаний не найдено.');return lines.join('\n')}a.issues.forEach((i,n)=>{const start=Number.isFinite(i.start)?i.start:0,end=Number.isFinite(i.end)?i.end:start;let marker=cleanReportText(src.slice(start,end));if(!marker)marker=cleanReportText(i.word||i.title);let context=shortContext(src,start,end);lines.push(`${n+1}. [${reportTypeName(i.type)}] ${cleanReportText(i.title)}`);lines.push(`Метка поиска: «${marker}»`);if(context)lines.push(`Контекст: ${context}`);lines.push(`Позиция: символы ${start+1}–${Math.max(start+1,end)}`);if(Array.isArray(i.occurrences)&&i.occurrences.length>1)lines.push(`Совпадения: ${i.occurrences.slice(0,12).map(o=>(Number(o.start)||0)+1).join(', ')}${i.occurrences.length>12?' …':''}`);if(i.detail)lines.push(`Комментарий: ${cleanReportText(i.detail)}`);if(i.type==='dzen')lines.push(`Уровень: ${i.severity==='critical'?'высокий риск — проверить':'проверить вручную'}`);lines.push('')});return lines.join('\n')}
function copyPlainReport(text){const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-10000px';document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy')}catch(e){}ta.remove();return ok}
function copyAnalysisReport(){const text=buildAnalysisReport();if(copyPlainReport(text))toast('Отчёт с замечаниями скопирован');else toast('Не удалось скопировать отчёт')}
function saveAnalysisReport(){const text=buildAnalysisReport(),name=`Dzen-Text-report-${new Date().toISOString().slice(0,10)}.txt`;if(window.AndroidFile&&typeof AndroidFile.saveReport==='function'){AndroidFile.saveReport(text,name);return}try{const blob=new Blob([text],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1200);toast('Отчёт сохранён')}catch(e){toast('Не удалось сохранить отчёт')}}
window.onNativeReportSaved=(name)=>toast(`Отчёт сохранён${name?': '+name:''}`);window.onNativeReportError=(msg)=>toast(msg||'Не удалось сохранить отчёт');
function renderAnalysis(){const box=document.getElementById('analysisContent'),sum=document.getElementById('analysisSummary'),collapsed=document.getElementById('analysisCollapsedSummary'),a=currentAnalysis,ec=a.editorCount||0,ac=a.aiStyleCount||0,dc=a.dzenCount||0,sc=a.spellCount||0;let spellPart=settings.onlineSpelling?(spellStatus==='checking'?' · орфография: <b>проверяю…</b>':` · орфография: <b>${sc}</b>`):' · онлайн-орфография: выкл.';sum.innerHTML=a.warningCount?`Редакторских замечаний: <b>${ec}</b> · ИИ-стиль: <b>${ac}</b> · по правилам Дзена: <b>${dc}</b>${spellPart}.`:`<b>По локальным проверкам замечаний нет.</b>${spellPart} Финальная вычитка всё равно нужна.`;if(collapsed)collapsed.textContent=`${ec?'🔴':'🟢'} редакторских: ${ec} · ${dc?'🟠':'🟢'} Дзен: ${dc}`;document.querySelectorAll('.analysisFilter').forEach(b=>b.classList.toggle('active',b.dataset.mode===analysisMode));let html='';if(analysisMode==='all')html+=`<div class="analysisInfo"><div class="metric"><b>${a.metrics.headings?.length||0}</b><span>заголовков</span></div><div class="metric"><b>${a.metrics.avgSentence||0}</b><span>слов в среднем предложении</span></div><div class="metric"><b>${a.metrics.lists||0}</b><span>пунктов списков</span></div><div class="metric"><b>${a.metrics.links||0}</b><span>ссылок</span></div></div>`;if(analysisMode==='dzen'){const rows=a.issues.filter(x=>x.type==='dzen');html+=`<div class="analysisDzenNote">База правил: <b>${escapeHtml(String(activeDzenRules().version||'встроенная'))}</b>. Совпадение означает только повод проверить фрагмент, а не установленное нарушение.</div>`;if(rows.length)html+=`<div class="analysisGroup"><div class="analysisTitle"><span>Возможные риски</span><span class="badge bad">${rows.length}</span></div>${rows.map(issueHtml).join('')}</div>`;else html+='<div class="analysisEmpty">Автоматические признаки риска по текущей базе не найдены.</div>';html+=renderDzenManual();box.innerHTML=html;return}for(const g of issueGroups()){const rows=a.issues.filter(x=>x.type===g.id);if(g.id==='heading'&&analysisMode==='all'){const hs=a.metrics.headings||[];html+=`<div class="analysisGroup"><div class="analysisTitle"><span>${g.name}</span><span class="badge ${rows.length?'bad':''}">${rows.length||'✓'}</span></div>`;if(!hs.length)html+='<div class="analysisRow"><span class="meta">Заголовков Markdown не найдено.</span></div>';else for(const h of hs){const bad=rows.find(r=>r.start===h.start);html+=bad?issueHtml(bad):`<button class="analysisRow jump" onclick="jumpTo(${h.start},${h.end})"><span class="ok">H${h.level} · ${h.text.length} знаков</span> ${escapeHtml(h.text)}<span class="meta">Нажмите, чтобы перейти к заголовку</span></button>`}html+='</div>';continue}if(!rows.length)continue;html+=`<div class="analysisGroup"><div class="analysisTitle"><span>${g.name}</span><span class="badge bad">${rows.length}</span></div>${rows.map(issueHtml).join('')}${g.id==='spelling'?'<div class="spellAttribution"><a href="https://yandex.ru/dev/speller/">Проверка правописания: Яндекс.Спеллер</a></div>':''}</div>`}if(!a.warningCount)html+='<div class="analysisEmpty">Красных замечаний нет. Переключите «Всё», чтобы посмотреть информационные показатели.</div>';box.innerHTML=html}
function issueHtml(i){
  let sev=i.severity==='critical'?'Контроль':'Обратите внимание';
  if(i.type==='dzen')sev=i.severity==='critical'?'Высокий риск — проверить':'Проверить вручную';
  if(i.type==='aiStyle')sev='Маркер машинного стиля — проверить';
  const word=i.word?String(i.word):'';
  const idx=currentAnalysis.issues.indexOf(i);
  const sameType=currentAnalysis.issues.filter(x=>x.type===i.type).length;
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
