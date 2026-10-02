/*
 * Editor workflow policy.
 *
 * The old Markdown toolbar is intentionally disabled for now: on Android it
 * competed with the bottom status row while the IME was open. This legacy file
 * stays in the script order as the compatibility/workflow slot.
 */
function applyMarkdown(){return false}

(function installEditorWorkflowPolicy(){
  const baseLoadSettings=loadSettings;
  loadSettings=function(){
    const value=baseLoadSettings();
    value.markdownToolbar=false;
    value.dzenCheck=true;
    value.dzenCheckMode='both';
    return value;
  };

  // The mode selector is no longer user-facing. Local checks are always active;
  // a completed manual AI run is simply an additional layer in the same result.
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

  // Keep the exact source text behind every accepted finding. The model may
  // normalise punctuation in the quote it returns, so the accepted source span
  // is the only reliable anchor for later edits.
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

  function commonPrefix(a,b){
    const n=Math.min(a.length,b.length);let i=0;
    while(i<n&&a[i]===b[i])i++;
    return i;
  }
  function commonSuffix(a,b){
    const n=Math.min(a.length,b.length);let i=0;
    while(i<n&&a[a.length-1-i]===b[b.length-1-i])i++;
    return i;
  }
  function aiCandidateScore(src,start,issue){
    const quote=String(issue.quote||'');
    const before=src.slice(Math.max(0,start-64),start);
    const after=src.slice(start+quote.length,start+quote.length+64);
    const context=commonSuffix(before,String(issue.aiBefore||''))+commonPrefix(after,String(issue.aiAfter||''));
    const distance=Math.abs(start-(Number(issue.aiOriginalStart)||0));
    return context*10000-distance;
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

    const visible=[];
    for(const original of aiDzenSessionIssues){
      const quote=String(original.quote||'');
      if(!quote)continue;
      const candidates=exactQuotePositions(src,quote);
      if(!candidates.length)continue;
      candidates.sort((a,b)=>aiCandidateScore(src,b,original)-aiCandidateScore(src,a,original));
      const start=candidates[0],end=start+quote.length;
      // Several independent findings may legitimately point to one fragment.
      // Do not treat an already-used span as occupied: all such findings should
      // remain until that fragment itself is edited.
      visible.push({...original,start,end});
    }
    aiDzenIssues=visible;
    aiDzenSource=src;
    if(aiDzenRun&&aiDzenRun.state==='success')aiDzenRun={...aiDzenRun,remaining:visible.length};
  }

  // Ordinary editing never destroys a completed AI response. A finding remains
  // while its checked source fragment still exists and disappears when that
  // fragment is changed. Undo can therefore make it reappear naturally.
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

  // Local analysis is automatic, coalesced and never calls an external model.
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
      aiDzenSessionIssues=(Array.isArray(aiDzenIssues)?aiDzenIssues:[]).map(issue=>{
        const start=Number(issue.start)||0,end=Number(issue.end)||start;
        return {
          ...issue,
          quote:String(issue.quote||aiDzenSessionSource.slice(start,end)),
          aiOriginalStart:start,
          aiBefore:aiDzenSessionSource.slice(Math.max(0,start-64),start),
          aiAfter:aiDzenSessionSource.slice(end,end+64)
        };
      });
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
    if(aiDzenRun.state==='success')return '<div class="analysisDzenNote"><b>Последняя AI-проверка завершена.</b> Осталось замечаний: '+(Array.isArray(aiDzenIssues)?aiDzenIssues.length:0)+'. Новая AI-проверка запускается только вручную.</div>';
    return '';
  };

  const baseIssueGroups=issueGroups;
  issueGroups=function(){
    return baseIssueGroups().map(group=>{
      if(group.id==='aiQuality')return {...group,name:'Качество текста'};
      if(group.id==='aiStyle')return {...group,name:'Стиль текста'};
      return group;
    });
  };

  const baseIssueHtml=issueHtml;
  issueHtml=function(issue){
    // Base renderer adds the source prefix only in the old "both" mode. Render
    // each card as a unified finding while preserving issue.ai internally.
    const realMode=currentCheckMode;
    currentCheckMode=function(){return 'local'};
    try{
      return baseIssueHtml(issue)
        .replace('AI · качество текста — проверить','Качество текста — проверить')
        .replace('Маркер машинного стиля — проверить','Стиль текста — проверить');
    }finally{currentCheckMode=realMode}
  };

  const baseRenderAnalysis=renderAnalysis;
  renderAnalysis=function(){
    baseRenderAnalysis();
    const total=Number(currentAnalysis&&currentAnalysis.warningCount)||0;
    const aiCount=currentAnalysis&&Array.isArray(currentAnalysis.issues)?currentAnalysis.issues.filter(x=>x&&x.ai===true).length:0;
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
        .replace('Обе проверки завершены без замечаний.','Текущих замечаний нет.')
        .replace(/AI · качество текста — проверить/g,'Качество текста — проверить')
        .replace(/Маркер машинного стиля — проверить/g,'Стиль текста — проверить');
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

  // Whole-document changes start another context and must never inherit findings
  // from the previous article/import/restored version.
  const baseSetEditorTextForArticle=setEditorTextForArticle;
  setEditorTextForArticle=function(text,focus){
    clearAiDzenIssues('idle');
    return baseSetEditorTextForArticle(text,focus);
  };
  const baseLoadFileText=loadFileText;
  loadFileText=async function(text,name=''){
    const before=editor.value;
    await baseLoadFileText(text,name);
    if(editor.value!==before){clearAiDzenIssues('idle');analyzeText()}
  };
  if(typeof restoreVersion==='function'){
    const baseRestoreVersion=restoreVersion;
    restoreVersion=async function(id){
      const before=editor.value;
      await baseRestoreVersion(id);
      if(editor.value!==before){clearAiDzenIssues('idle');analyzeText()}
    };
  }

  updateDzenRulesStatus=function(){
    const el=document.getElementById('dzenRulesStatus');
    if(!el)return;
    const enabled=settings.dzenSmartRules!==false,r=activeDzenRules();
    el.innerHTML='База правил: <b>'+(enabled?'обновляемая':'встроенная')+'</b><br>Версия: <b>'+escapeHtml(String(r.version||'встроенная'))+'</b><br>Источник: официальная справка Дзена · проверен '+escapeHtml(String(r.source_checked||'—'));
  };
  const baseUpdateDzenRulesFromGitHub=updateDzenRulesFromGitHub;
  updateDzenRulesFromGitHub=async function(){
    if(settings.dzenSmartRules===false){
      updateDzenRulesStatus();
      toast('Обновляемая база правил отключена в настройках');
      return;
    }
    return baseUpdateDzenRulesFromGitHub();
  };

  updateMarkdownToolbarVisibility=function(){
    const bar=document.getElementById('markdownToolbar');
    if(bar){bar.classList.remove('visible');bar.hidden=true}
    if(document.body)document.body.classList.remove('markdown-toolbar-visible');
  };

  function refreshHintTexts(){
    if(typeof APP_HINTS==='undefined')return;
    APP_HINTS.currentExport={title:'Отчёт по проверке',text:'Содержит все текущие замечания. Локальная проверка работает постоянно, а замечания последней AI-проверки остаются до исправления соответствующих фрагментов.'};
    APP_HINTS.localDzenBase={title:'Обновляемая база правил',text:'Приложение загружает компактную базу правил и применяет её локально на устройстве. Текст статьи при такой проверке никуда не отправляется.'};
    APP_HINTS.analysisOverview={title:'Редакторский анализ',text:'Локальные проверки пересчитываются автоматически во время редактирования. Если ранее запускалась AI-проверка, её ещё не исправленные замечания показываются в этом же списке.'};
    APP_HINTS.localAiStyle={title:'Формальные признаки стиля',text:'Офлайн-фильтр отмечает отдельные формальные шаблоны текста. Он не определяет авторство и не обращается к внешней AI-модели.'};
    APP_HINTS.dzenCheck={title:'Правила Дзена',text:'Правила проверяются автоматически на устройстве по встроенной или обновляемой базе. Для этого внешний AI API не используется.'};
  }

  function applyWorkflowUiPolicy(){
    settings.markdownToolbar=false;
    settings.dzenCheck=true;
    settings.dzenCheckMode='both';
    refreshHintTexts();
    updateMarkdownToolbarVisibility();

    const mdSwitch=document.getElementById('markdownToolbarSwitch');
    if(mdSwitch){mdSwitch.checked=false;const group=mdSwitch.closest('details.settingsGroup');if(group)group.hidden=true}

    const mode=document.getElementById('dzenCheckMode');
    if(mode){mode.value='both';const group=mode.closest('details.settingsGroup');if(group)group.hidden=true}

    const localSwitch=document.getElementById('dzenCheck');
    if(localSwitch){
      localSwitch.checked=true;
      const row=localSwitch.closest('.switchRow');if(row)row.hidden=true;
      const group=localSwitch.closest('details.settingsGroup');
      if(group){
        const title=group.querySelector('summary > span'),sub=group.querySelector('summary > small');
        if(title)title.textContent='Правила Дзена';
        if(sub)sub.textContent='Автоматическая локальная проверка и база правил';
      }
    }

    const smart=document.getElementById('dzenSmartRules');
    if(smart){
      const label=smart.closest('.switchRow')?.querySelector('.labelWithHint');
      if(label&&label.firstChild)label.firstChild.textContent='Использовать обновляемую базу правил ';
      const group=smart.closest('details.settingsGroup'),note=group&&group.querySelector('.smallNote');
      if(note)note.textContent='Правила проверяются автоматически на устройстве. Статья не отправляется во внешнюю AI-модель; при обновлении загружается только компактная база правил.';
    }

    const aiStyle=document.getElementById('aiStyleCheck');
    if(aiStyle){
      const label=aiStyle.closest('.switchRow')?.querySelector('.labelWithHint');
      if(label&&label.firstChild)label.firstChild.textContent='Формальные признаки шаблонного стиля ';
      const group=aiStyle.closest('details.settingsGroup'),notes=group&&group.querySelectorAll('.smallNote');
      if(notes&&notes.length)notes[notes.length-1].textContent='Локальный фильтр работает офлайн и не определяет авторство текста. Смысловой разбор стиля выполняется только при ручной AI-проверке.';
    }

    const aiFields=document.getElementById('dzenAiFields'),aiGroup=aiFields&&aiFields.closest('details.settingsGroup');
    if(aiGroup){
      const title=aiGroup.querySelector('summary > span'),sub=aiGroup.querySelector('summary > small');
      if(title)title.textContent='AI-проверка текста';
      if(sub)sub.textContent='API, модель, база знаний Дзена и стиль';
      const prompt=document.getElementById('dzenAiStylePrompt');
      const promptLabel=prompt&&prompt.previousElementSibling&&prompt.previousElementSibling.querySelector('.labelWithHint');
      if(promptLabel&&promptLabel.firstChild)promptLabel.firstChild.textContent='Что искать в стиле текста ';
    }

    const spell=document.getElementById('onlineSpelling');
    if(spell){const group=spell.closest('details.settingsGroup'),note=group&&group.querySelector('.smallNote');if(note)note.textContent='Онлайн-орфография запускается только при ручной AI-проверке текста. При наборе текст наружу не отправляется.'}

    const drawerCheckButton=document.querySelector('.drawerActions button[onclick="drawerCheck()"]');
    if(drawerCheckButton)drawerCheckButton.textContent='AI-проверка текста';
    const checkButton=document.getElementById('checkBtn');if(checkButton)checkButton.hidden=true;
    const dot=document.getElementById('analysisDot');if(dot){dot.setAttribute('aria-label','Открыть результаты проверки');dot.title='Открыть результаты проверки'}
    const copy=document.querySelector('button[onclick="copyRichHtml()"]');if(copy){copy.setAttribute('aria-label','Скопировать для публикации');copy.title='Скопировать для публикации'}
    updateDzenRulesStatus();
  }

  const baseApplySettings=applySettings;
  applySettings=async function(){
    const result=await baseApplySettings();
    applyWorkflowUiPolicy();
    if(typeof scheduleAnalysis==='function')scheduleAnalysis();
    return result;
  };

  applyWorkflowUiPolicy();
  setTimeout(applyWorkflowUiPolicy,0);
})();
