/*
 * Workflow policy for the editor.
 *
 * The Markdown toolbar is intentionally disabled for now: on Android it
 * competes with the bottom status bar while the IME is open. This legacy
 * asset remains in the load order so the policy can be applied before the
 * bootstrap listener is installed, without adding another blocking script.
 */
(function installEditorWorkflowPolicy(){
  const baseLoadSettings=loadSettings;
  loadSettings=function(){
    const value=baseLoadSettings();
    value.markdownToolbar=false;
    value.dzenCheck=true;
    value.dzenCheckMode='both';
    return value;
  };

  // There is no user-selectable check mode anymore. Local checks are always
  // active; the AI layer is added only after the explicit manual command.
  normalizeDzenCheckMode=function(){return 'both'};
  currentCheckMode=function(){return 'both'};
  checkModeUsesLocal=function(){return true};
  checkModeUsesAi=function(){return true};

  const baseClearAiDzenIssues=clearAiDzenIssues;
  let aiDzenSessionIssues=[];
  let aiDzenSessionSource='';

  clearAiDzenIssues=function(state='idle',message=''){
    aiDzenSessionIssues=[];
    aiDzenSessionSource='';
    return baseClearAiDzenIssues(state,message);
  };

  const baseAiIssueFromItem=aiIssueFromItem;
  aiIssueFromItem=function(item,type,chunk){
    const issue=baseAiIssueFromItem(item,type,chunk);
    if(!issue)return null;
    const localStart=Math.max(0,Number(issue.start||0)-Number(chunk.start||0));
    const localEnd=Math.max(localStart,Number(issue.end||0)-Number(chunk.start||0));
    issue.quote=String(chunk.text||'').slice(localStart,localEnd)||String(item&&item.quote||'').trim();
    issue.aiOriginalStart=Number(issue.start)||0;
    return issue;
  };

  function exactQuotePositions(src,quote){
    const out=[];
    if(!quote)return out;
    let at=0;
    while(at<=src.length-quote.length){
      const found=src.indexOf(quote,at);
      if(found<0)break;
      out.push(found);
      at=found+Math.max(1,quote.length);
    }
    return out;
  }

  function remapAiDzenIssues(src){
    src=String(src||'');
    if(!aiDzenSessionIssues.length){
      aiDzenIssues=[];
      if(aiDzenRun&&aiDzenRun.state==='success'){
        aiDzenSource=src;
        aiDzenRun={...aiDzenRun,remaining:0};
      }
      return;
    }

    const used=new Set();
    const visible=[];
    const ordered=aiDzenSessionIssues.slice().sort((a,b)=>(Number(a.start)||0)-(Number(b.start)||0));
    for(const original of ordered){
      const quote=String(original.quote||'');
      if(!quote)continue;
      const oldStart=Number(original.start)||Number(original.aiOriginalStart)||0;
      const candidates=exactQuotePositions(src,quote).filter(pos=>!used.has(pos+'|'+(pos+quote.length)));
      if(!candidates.length)continue;
      candidates.sort((a,b)=>Math.abs(a-oldStart)-Math.abs(b-oldStart));
      const start=candidates[0],end=start+quote.length;
      used.add(start+'|'+end);
      visible.push({...original,start,end});
    }
    aiDzenIssues=visible;
    aiDzenSource=src;
    if(aiDzenRun&&aiDzenRun.state==='success'){
      aiDzenRun={...aiDzenRun,remaining:visible.length};
    }
  }

  // Editing no longer destroys a completed AI response. Only findings whose
  // exact checked fragment still exists remain visible; fixed fragments vanish.
  invalidateAiDzenIssues=function(){
    if(!editor)return;
    const src=editor.value||'';
    if(!src.trim()){
      clearAiDzenIssues('idle');
      return;
    }
    if(aiDzenRun&&aiDzenRun.state==='running')return;
    remapAiDzenIssues(src);
  };

  const baseAnalyzeText=analyzeText;
  analyzeText=function(){
    const src=editor.value||'';
    if(aiDzenSessionIssues.length&&aiDzenSource!==src)remapAiDzenIssues(src);
    return baseAnalyzeText();
  };

  // Local checks are cheap and never call an external AI API. Every text edit
  // schedules a coalesced local pass; the dot may be stale only for that short
  // debounce window.
  markAnalysisStale=function(){
    invalidateAiDzenIssues();
    const dot=document.getElementById('analysisDot');
    if(dot){
      dot.classList.remove('bad');
      dot.classList.add('stale');
      dot.setAttribute('aria-label','Текст изменён — локальная проверка обновляется');
      dot.title='Локальная проверка обновляется';
    }
    if(typeof scheduleAnalysis==='function')scheduleAnalysis();
  };

  const baseStartAiDzenArticleCheck=startAiDzenArticleCheck;
  startAiDzenArticleCheck=async function(src){
    aiDzenSessionIssues=[];
    aiDzenSessionSource=String(src||editor.value||'');
    await baseStartAiDzenArticleCheck(src);
    if(aiDzenRun&&aiDzenRun.state==='success'){
      aiDzenSessionIssues=(Array.isArray(aiDzenIssues)?aiDzenIssues:[]).map(issue=>({
        ...issue,
        quote:String(issue.quote||aiDzenSessionSource.slice(Number(issue.start)||0,Number(issue.end)||0)),
        aiOriginalStart:Number(issue.start)||0
      }));
      remapAiDzenIssues(editor.value||'');
      analyzeText();
      renderAnalysis();
      if(typeof updateDzenAiStatus==='function')updateDzenAiStatus();
    }
  };

  aiDzenRunText=function(){
    if(aiDzenRun.state==='running')return 'проверяется…';
    if(aiDzenRun.state==='error')return 'ошибка';
    if(aiDzenRun.state==='success')return String(Array.isArray(aiDzenIssues)?aiDzenIssues.length:0)+' замеч.';
    return 'не запускалась';
  };

  aiDzenRunDiagnosticHtml=function(){
    if(aiDzenRun.state==='running')return '<div class="analysisDzenNote"><b>AI-проверка выполняется…</b> Модель: '+escapeHtml(aiDzenRun.model||String(settings.dzenAiModel||'—'))+(aiDzenRun.calls?' · запросов: '+aiDzenRun.calls:'')+'.</div>';
    if(aiDzenRun.state==='error')return '<div class="analysisDzenNote"><b>AI-проверка не завершена.</b> '+escapeHtml(aiDzenRun.message||'Неизвестная ошибка')+'.</div>';
    if(aiDzenRun.state==='success'){
      const left=Array.isArray(aiDzenIssues)?aiDzenIssues.length:0;
      return '<div class="analysisDzenNote"><b>Последняя AI-проверка завершена.</b> Осталось замечаний: '+left+'. Новая AI-проверка запускается только вручную.</div>';
    }
    return '';
  };

  const baseIssueGroups=issueGroups;
  issueGroups=function(){
    return baseIssueGroups().map(group=>group.id==='aiQuality'?{...group,name:'Качество текста'}:group);
  };

  const baseIssueHtml=issueHtml;
  issueHtml=function(issue){
    // The legacy renderer adds an origin prefix only in the internal "both"
    // mode. Render the same card without exposing that implementation detail.
    const realMode=currentCheckMode;
    currentCheckMode=function(){return 'local'};
    try{
      return baseIssueHtml(issue).replace('AI · качество текста — проверить','Качество текста — проверить');
    }finally{
      currentCheckMode=realMode;
    }
  };

  const baseRenderAnalysis=renderAnalysis;
  renderAnalysis=function(){
    baseRenderAnalysis();
    const total=Number(currentAnalysis&&currentAnalysis.warningCount)||0;
    const aiCount=currentAnalysis&&Array.isArray(currentAnalysis.issues)
      ?currentAnalysis.issues.filter(x=>x&&x.ai===true).length:0;
    const sum=document.getElementById('analysisSummary');
    if(sum){
      let suffix=' · локальная проверка обновляется автоматически';
      if(aiDzenRun&&aiDzenRun.state==='running')suffix=' · AI-проверка выполняется…';
      else if(aiDzenRun&&aiDzenRun.state==='success')suffix=' · осталось замечаний последней AI-проверки: <b>'+aiCount+'</b>';
      else if(aiDzenRun&&aiDzenRun.state==='error')suffix=' · последняя AI-проверка завершилась ошибкой';
      sum.innerHTML='Замечаний: <b>'+total+'</b>'+suffix+'.';
    }
    const collapsed=document.getElementById('analysisCollapsedSummary');
    if(collapsed)collapsed.textContent=total?'🔴 замечаний: '+total:'🟢 замечаний нет';
    const title=document.getElementById('analysisExportTitleText');
    if(title)title.textContent='Выгрузить замечания';
    const note=document.getElementById('analysisExportNote');
    if(note)note.textContent='В отчёт попадут текущие замечания без технических пометок об источнике проверки.';
    const box=document.getElementById('analysisContent');
    if(box){
      box.innerHTML=box.innerHTML
        .replace('Показаны вместе локальные и AI-замечания по Дзену.','Показаны текущие замечания по правилам Дзена.')
        .replace(/AI · качество текста — проверить/g,'Качество текста — проверить');
    }
  };

  buildCurrentAnalysisReport=function(){
    analyzeText();
    const src=editor.value||'',issues=currentAnalysis.issues||[],lines=[];
    lines.push('ОТЧЁТ «ДЗЕН ТЕКСТ» ПО ТЕКУЩЕЙ ПРОВЕРКЕ');
    lines.push('Создан: '+new Date().toLocaleString('ru-RU'));
    lines.push('Всего замечаний: '+issues.length+'.');
    lines.push('База правил Дзена: '+String(activeDzenRules().version||'встроенная')+'.');
    if(aiDzenRun&&aiDzenRun.state==='success')lines.push('Последняя AI-проверка выполнена; осталось замечаний: '+issues.filter(x=>x&&x.ai===true).length+'.');
    lines.push('');
    if(!issues.length){lines.push('Текущих замечаний нет.');return lines.join('\n')}
    reportIssueLines(lines,src,issues,false);
    return lines.join('\n');
  };
  currentReportFileName=function(){return 'Dzen-Text-report-'+new Date().toISOString().slice(0,10)+'.txt'};

  // A whole-document replacement starts another editing context. Do not carry
  // findings from one article/import/restored version into another document.
  const baseSetEditorTextForArticle=setEditorTextForArticle;
  setEditorTextForArticle=function(text,focus){
    clearAiDzenIssues('idle');
    return baseSetEditorTextForArticle(text,focus);
  };

  const baseLoadFileText=loadFileText;
  loadFileText=async function(text,name=''){
    const before=editor.value;
    await baseLoadFileText(text,name);
    if(editor.value!==before){
      clearAiDzenIssues('idle');
      analyzeText();
    }
  };

  if(typeof restoreVersion==='function'){
    const baseRestoreVersion=restoreVersion;
    restoreVersion=async function(id){
      const before=editor.value;
      await baseRestoreVersion(id);
      if(editor.value!==before){
        clearAiDzenIssues('idle');
        analyzeText();
      }
    };
  }

  updateDzenRulesStatus=function(){
    const el=document.getElementById('dzenRulesStatus');
    if(!el)return;
    const enabled=settings.dzenSmartRules!==false,r=activeDzenRules();
    el.innerHTML='База правил: <b>'+(enabled?'обновляемая':'встроенная')+'</b><br>Версия: <b>'+escapeHtml(String(r.version||'встроенная'))+'</b><br>Источник: официальная справка Дзена · проверен '+escapeHtml(String(r.source_checked||'—'));
  };

  updateMarkdownToolbarVisibility=function(){
    const bar=document.getElementById('markdownToolbar');
    if(bar){bar.classList.remove('visible');bar.hidden=true}
    if(document.body)document.body.classList.remove('markdown-toolbar-visible');
  };

  function applyWorkflowUiPolicy(){
    settings.markdownToolbar=false;
    settings.dzenCheck=true;
    settings.dzenCheckMode='both';

    updateMarkdownToolbarVisibility();
    const mdSwitch=document.getElementById('markdownToolbarSwitch');
    if(mdSwitch){
      mdSwitch.checked=false;
      const group=mdSwitch.closest('details.settingsGroup');
      if(group)group.hidden=true;
    }

    const mode=document.getElementById('dzenCheckMode');
    if(mode){
      mode.value='both';
      const group=mode.closest('details.settingsGroup');
      if(group)group.hidden=true;
    }

    const localSwitch=document.getElementById('dzenCheck');
    if(localSwitch){
      localSwitch.checked=true;
      const row=localSwitch.closest('.switchRow');
      if(row)row.hidden=true;
      const group=localSwitch.closest('details.settingsGroup');
      if(group){
        const title=group.querySelector('summary > span');
        const sub=group.querySelector('summary > small');
        if(title)title.textContent='Правила Дзена';
        if(sub)sub.textContent='Автоматическая локальная проверка и база правил';
      }
    }

    const smart=document.getElementById('dzenSmartRules');
    if(smart){
      const label=smart.closest('.switchRow')?.querySelector('.labelWithHint');
      if(label&&label.firstChild)label.firstChild.textContent='Использовать обновляемую базу правил ';
      const group=smart.closest('details.settingsGroup');
      const note=group&&group.querySelector('.smallNote');
      if(note)note.textContent='Правила проверяются автоматически на устройстве. Статья не отправляется во внешнюю AI-модель; при обновлении загружается только компактная база правил.';
    }

    const aiFields=document.getElementById('dzenAiFields');
    const aiGroup=aiFields&&aiFields.closest('details.settingsGroup');
    if(aiGroup){
      const title=aiGroup.querySelector('summary > span');
      const sub=aiGroup.querySelector('summary > small');
      if(title)title.textContent='AI-проверка текста';
      if(sub)sub.textContent='API, модель, база знаний Дзена и стиль';
    }

    const spell=document.getElementById('onlineSpelling');
    if(spell){
      const group=spell.closest('details.settingsGroup');
      const note=group&&group.querySelector('.smallNote');
      if(note)note.textContent='Онлайн-орфография запускается только при ручной AI-проверке текста. При наборе текст наружу не отправляется.';
    }

    const drawerCheckButton=document.querySelector('.drawerActions button[onclick="drawerCheck()"]');
    if(drawerCheckButton)drawerCheckButton.textContent='AI-проверка текста';

    const checkButton=document.getElementById('checkBtn');
    if(checkButton)checkButton.hidden=true;

    const dot=document.getElementById('analysisDot');
    if(dot){dot.setAttribute('aria-label','Открыть результаты проверки');dot.title='Открыть результаты проверки'}

    const copy=document.querySelector('button[onclick="copyRichHtml()"]');
    if(copy){copy.setAttribute('aria-label','Скопировать для публикации');copy.title='Скопировать для публикации'}

    updateDzenRulesStatus();
  }

  applyWorkflowUiPolicy();
  setTimeout(applyWorkflowUiPolicy,0);
})();
