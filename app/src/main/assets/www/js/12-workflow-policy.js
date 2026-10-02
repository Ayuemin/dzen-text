/* Retained AI-session policy and document-boundary resets. */
(function installEditorWorkflowPolicy(){
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
  function chooseAiOccurrence(src,issue){
    const quote=String(issue.quote||'');
    if(!quote)return null;
    const positions=exactQuotePositions(src,quote);
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
    const survivors=[];
    for(const original of aiDzenSessionIssues){
      // Different AI findings may legitimately refer to the exact same source
      // span. Context and the previous position disambiguate repeated quotes in
      // different places, so findings must not reserve a range from one another.
      const start=chooseAiOccurrence(src,original);
      if(start==null)continue;
      const quote=String(original.quote||'');
      const end=start+quote.length;
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
  aiDzenStatusLine=function(){
    const left=Array.isArray(aiDzenIssues)?aiDzenIssues.length:0;
    if(aiDzenRun.state==='success')return '<br>Последняя AI-проверка: <b>успешно</b> · модель: '+escapeHtml(aiDzenRun.model||String(settings.dzenAiModel||'—'))+' · запросов: '+aiDzenRun.calls+' · осталось замечаний: '+left;
    if(aiDzenRun.state==='error'){
      let text='<br>Последняя AI-проверка: <b>ошибка</b> · '+escapeHtml(aiDzenRun.message||'неизвестная ошибка');
      if(aiDzenRun.previousPreserved&&left)text+=' · сохранено предыдущих замечаний: '+left;
      return text;
    }
    if(aiDzenRun.state==='running')return '<br>AI-проверка: <b>выполняется…</b>';
    return '<br>AI-проверка статьи ещё не запускалась.';
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
})();
