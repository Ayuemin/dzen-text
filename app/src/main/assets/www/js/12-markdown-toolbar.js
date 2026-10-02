/*
 * Compatibility policy for the 1.10.x editor layout.
 *
 * The old Markdown toolbar asset remains in the established script order, but
 * the toolbar itself is disabled. This file now owns only compatibility glue:
 * persistent AI findings across edits, document-boundary resets, UI cleanup,
 * and the 1.10.6 Android clipboard argument correction.
 */
function applyMarkdown(){return false}

(function installEditorWorkflowPolicy(){
  // Local analysis is always active. AI is an additional manual layer, not a
  // user-selectable replacement for local checks.
  normalizeDzenCheckMode=function(){return 'both'};
  currentCheckMode=function(){return 'both'};
  checkModeUsesLocal=function(){return true};
  checkModeUsesAi=function(){return true};

  const baseClearAiDzenIssues=clearAiDzenIssues;
  const baseAiIssueFromItem=aiIssueFromItem;
  const baseAnalyzeText=analyzeText;
  const baseStartAiDzenArticleCheck=startAiDzenArticleCheck;
  let aiDzenSessionIssues=[];
  let aiDzenSessionSource='';

  clearAiDzenIssues=function(state='idle',message=''){
    aiDzenSessionIssues=[];
    aiDzenSessionSource='';
    return baseClearAiDzenIssues(state,message);
  };

  aiIssueFromItem=function(item,type,chunk){
    const issue=baseAiIssueFromItem(item,type,chunk);
    if(!issue)return null;
    const text=String(chunk&&chunk.text||'');
    const chunkStart=Number(chunk&&chunk.start)||0;
    const localStart=Math.max(0,(Number(issue.start)||0)-chunkStart);
    const localEnd=Math.max(localStart,(Number(issue.end)||0)-chunkStart);
    issue.quote=text.slice(localStart,localEnd)||String(item&&item.quote||'').trim();
    issue.aiOriginalStart=Number(issue.start)||0;
    issue.aiLastStart=issue.aiOriginalStart;
    issue.aiContextBefore=text.slice(Math.max(0,localStart-64),localStart);
    issue.aiContextAfter=text.slice(localEnd,Math.min(text.length,localEnd+64));
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
  function suffixScore(expected,actual){
    expected=String(expected||'');actual=String(actual||'');
    let n=0,i=expected.length-1,j=actual.length-1;
    while(i>=0&&j>=0&&expected[i]===actual[j]&&n<64){n++;i--;j--}
    return n;
  }
  function prefixScore(expected,actual){
    expected=String(expected||'');actual=String(actual||'');
    let n=0,limit=Math.min(64,expected.length,actual.length);
    while(n<limit&&expected[n]===actual[n])n++;
    return n;
  }
  function chooseAiOccurrence(src,issue,used){
    const quote=String(issue.quote||'');
    if(!quote)return null;
    const positions=exactQuotePositions(src,quote).filter(pos=>!used.has(pos+'|'+(pos+quote.length)));
    if(!positions.length)return null;
    const anchor=Number.isFinite(Number(issue.aiLastStart))?Number(issue.aiLastStart):Number(issue.aiOriginalStart)||0;
    const before=String(issue.aiContextBefore||''),after=String(issue.aiContextAfter||'');
    const ranked=positions.map(pos=>{
      const actualBefore=src.slice(Math.max(0,pos-before.length),pos);
      const actualAfter=src.slice(pos+quote.length,pos+quote.length+after.length);
      return {
        pos,
        context:suffixScore(before,actualBefore)+prefixScore(after,actualAfter),
        distance:Math.abs(pos-anchor)
      };
    }).sort((a,b)=>b.context-a.context||a.distance-b.distance);
    const best=ranked[0];
    if(ranked.length>1&&best.context===0&&best.distance>500)return null;
    return best.pos;
  }

  function remapAiDzenIssues(src){
    src=String(src||'');
    if(!aiDzenSessionIssues.length){
      aiDzenIssues=[];
      aiDzenSource=src;
      return;
    }
    const used=new Set(),survivors=[];
    for(const original of aiDzenSessionIssues){
      const start=chooseAiOccurrence(src,original,used);
      if(start==null)continue;
      const quote=String(original.quote||'');
      const end=start+quote.length;
      used.add(start+'|'+end);
      survivors.push({...original,start,end,aiLastStart:start});
    }
    // Once the checked fragment itself has been changed, that finding is
    // considered handled for this AI run and does not reappear until a new run.
    aiDzenSessionIssues=survivors;
    aiDzenIssues=survivors.map(x=>({...x}));
    aiDzenSource=src;
  }

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

  analyzeText=function(){
    const src=editor.value||'';
    if(aiDzenSessionIssues.length&&aiDzenSource!==src)remapAiDzenIssues(src);
    else if(!aiDzenSessionIssues.length&&Array.isArray(aiDzenIssues)&&aiDzenIssues.length)aiDzenSource=src;
    return baseAnalyzeText();
  };

  startAiDzenArticleCheck=async function(src){
    const source=String(src||editor.value||'');
    const previous={
      session:aiDzenSessionIssues.map(x=>({...x})),
      issues:Array.isArray(aiDzenIssues)?aiDzenIssues.map(x=>({...x})):[],
      source:String(aiDzenSource||''),
      run:aiDzenRun?{...aiDzenRun}:null
    };
    aiDzenSessionIssues=[];
    aiDzenSessionSource=source;
    let thrown=null;
    try{await baseStartAiDzenArticleCheck(source)}catch(e){thrown=e}

    if(aiDzenRun&&aiDzenRun.state==='success'){
      aiDzenSessionIssues=(Array.isArray(aiDzenIssues)?aiDzenIssues:[]).map(issue=>({
        ...issue,
        quote:String(issue.quote||source.slice(Number(issue.start)||0,Number(issue.end)||0)),
        aiOriginalStart:Number(issue.aiOriginalStart??issue.start)||0,
        aiLastStart:Number(issue.start)||0
      }));
      remapAiDzenIssues(editor.value||'');
    }else if(previous.session.length){
      // A failed refresh must not destroy a still useful previous result.
      aiDzenSessionIssues=previous.session;
      aiDzenIssues=previous.issues;
      aiDzenSource=previous.source;
      remapAiDzenIssues(editor.value||'');
      if(aiDzenRun)aiDzenRun={...aiDzenRun,previousPreserved:true};
    }

    try{analyzeText()}catch(e){}
    try{renderAnalysis()}catch(e){}
    if(typeof updateDzenAiStatus==='function')updateDzenAiStatus();
    if(thrown){
      setCheckRunning(false);
      toast('AI-проверка не завершена: '+String(thrown.message||thrown));
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
    if(aiDzenRun.state==='error'){
      let text='<b>AI-проверка не завершена.</b> '+escapeHtml(aiDzenRun.message||'Неизвестная ошибка')+'.';
      if(aiDzenRun.previousPreserved&&aiDzenIssues.length)text+=' Сохранены замечания предыдущей проверки: '+aiDzenIssues.length+'.';
      return '<div class="analysisDzenNote">'+text+'</div>';
    }
    if(aiDzenRun.state==='success')return '<div class="analysisDzenNote"><b>Последняя AI-проверка завершена.</b> Осталось замечаний: '+aiDzenIssues.length+'. Новая AI-проверка запускается только вручную.</div>';
    return '';
  };

  // Full document replacements start a different editing context. AI findings
  // are intentionally scoped to one article/version/import only.
  if(typeof setEditorTextForArticle==='function'){
    const baseSetEditorTextForArticle=setEditorTextForArticle;
    setEditorTextForArticle=function(text,focus){
      clearAiDzenIssues('idle');
      return baseSetEditorTextForArticle(text,focus);
    };
  }
  if(typeof loadFileText==='function'){
    const baseLoadFileText=loadFileText;
    loadFileText=async function(text,name=''){
      const before=editor.value;
      await baseLoadFileText(text,name);
      if(editor.value!==before){clearAiDzenIssues('idle');try{analyzeText()}catch(e){}}
    };
  }
  if(typeof restoreVersion==='function'){
    const baseRestoreVersion=restoreVersion;
    restoreVersion=async function(id){
      const before=editor.value;
      await baseRestoreVersion(id);
      if(editor.value!==before){clearAiDzenIssues('idle');try{analyzeText()}catch(e){}}
    };
  }

  updateDzenRulesStatus=function(){
    const el=document.getElementById('dzenRulesStatus');
    if(!el)return;
    const enabled=settings.dzenSmartRules!==false,r=activeDzenRules();
    el.innerHTML='База правил: <b>'+(enabled?'обновляемая':'встроенная')+'</b><br>Версия: <b>'+escapeHtml(String(r.version||'встроенная'))+'</b><br>Источник: официальная справка Дзена · проверен '+escapeHtml(String(r.source_checked||'—'));
  };

  // The toolbar conflicts with the bottom status row while the Android IME is
  // open. Keep it disabled until it can be redesigned in a non-competing area.
  updateMarkdownToolbarVisibility=function(){
    const bar=document.getElementById('markdownToolbar');
    if(bar){bar.classList.remove('visible');bar.hidden=true}
    if(document.body)document.body.classList.remove('markdown-toolbar-visible');
  };

  // Android 1.10.6 wires the bridge variables opposite to ClipData.Item's
  // Item(text, htmlText) constructor. Pass plain first and HTML second so item 0
  // exposes the formats in the order Android and the Dzen editor expect.
  const baseCopyRichPayload=copyRichPayload;
  copyRichPayload=function(result){
    const payload={html:String(result&&result.html||''),plain:String(result&&result.plain||'')};
    if(!payload.html){toast('Текущая статья пустая');return}
    if(window.AndroidPublish&&typeof AndroidPublish.copyForPublication==='function'){
      let queued=false;
      try{queued=!!AndroidPublish.copyForPublication(payload.plain,payload.html)}catch(e){queued=false}
      if(queued){toast('Скопировано для публикации');return}
    }
    return baseCopyRichPayload(result);
  };

  function hideSettingsGroupFor(control){
    if(!control)return;
    const group=control.closest('details.settingsGroup');
    if(group)group.hidden=true;
  }
  function applyWorkflowUiPolicy(){
    settings.markdownToolbar=false;
    settings.dzenCheck=true;
    settings.dzenCheckMode='both';

    updateMarkdownToolbarVisibility();
    const mdSwitch=document.getElementById('markdownToolbarSwitch');
    if(mdSwitch)mdSwitch.checked=false;
    hideSettingsGroupFor(mdSwitch);

    const mode=document.getElementById('dzenCheckMode');
    if(mode)mode.value='both';
    hideSettingsGroupFor(mode);

    const localSwitch=document.getElementById('dzenCheck');
    if(localSwitch){localSwitch.checked=true;const row=localSwitch.closest('.switchRow');if(row)row.hidden=true}
    const smart=document.getElementById('dzenSmartRules');
    if(smart){
      const group=smart.closest('details.settingsGroup');
      if(group){
        const title=group.querySelector('summary > span'),sub=group.querySelector('summary > small');
        if(title)title.textContent='Правила Дзена';
        if(sub)sub.textContent='Автоматическая проверка и обновляемая база правил';
        const note=group.querySelector('.smallNote');
        if(note)note.textContent='Правила проверяются автоматически на устройстве. При обновлении загружается только компактная база правил; статья во внешнюю AI-модель не отправляется.';
        const buttons=group.querySelectorAll('.settingActions .nativeBtn');
        if(buttons[0])buttons[0].textContent='Обновить базу правил';
        if(buttons[1])buttons[1].textContent='Вернуть встроенные правила';
      }
      const label=smart.closest('.switchRow')?.querySelector('.labelWithHint');
      if(label&&label.firstChild)label.firstChild.textContent='Использовать обновляемую базу правил ';
    }

    const aiFields=document.getElementById('dzenAiFields');
    const aiGroup=aiFields&&aiFields.closest('details.settingsGroup');
    if(aiGroup){
      const title=aiGroup.querySelector('summary > span'),sub=aiGroup.querySelector('summary > small');
      if(title)title.textContent='AI-проверка текста';
      if(sub)sub.textContent='API, модель, база знаний Дзена и дополнительные критерии';
    }

    const spell=document.getElementById('onlineSpelling');
    if(spell){
      const group=spell.closest('details.settingsGroup'),note=group&&group.querySelector('.smallNote');
      if(note)note.textContent='Онлайн-орфография запускается только вместе с ручной AI-проверкой текста. При обычном наборе текст наружу не отправляется.';
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