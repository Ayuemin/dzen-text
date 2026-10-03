(function(){
'use strict';

const REVISION_KEY='p0DocumentRevisionsV1';
let p0RevisionStore={};
let p0State={documentId:'',revision:0,textHash:'',settingsVersion:'',rulesVersion:''};
let p0PersistTimer=null;
window.__experimentalSemanticViewActive=false;

function nativeRevisionAvailable(){
  return !!(window.AndroidDocumentRevision
    &&typeof AndroidDocumentRevision.read==='function'
    &&typeof AndroidDocumentRevision.persist==='function');
}
function loadRevisionStore(){
  try{
    const parsed=JSON.parse(localStorage.getItem(REVISION_KEY)||'{}');
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
  }catch(e){return {}}
}
function nativeRevisionFor(id){
  if(!nativeRevisionAvailable())return null;
  try{
    const value=JSON.parse(AndroidDocumentRevision.read(String(id))||'{}');
    const revision=Math.max(0,Number(value.revision)||0);
    const textHash=String(value.textHash||'');
    return revision?{revision,textHash}:null;
  }catch(e){return null}
}
function saveRevisionStoreSoon(){
  clearTimeout(p0PersistTimer);
  p0PersistTimer=setTimeout(function(){
    try{localStorage.setItem(REVISION_KEY,JSON.stringify(p0RevisionStore))}catch(e){}
    if(nativeRevisionAvailable()){
      for(const [id,state] of Object.entries(p0RevisionStore)){
        if(!state||!state.textHash)continue;
        try{
          const persisted=JSON.parse(AndroidDocumentRevision.persist(id,Math.max(0,Number(state.revision)||0),String(state.textHash))||'{}');
          const revision=Math.max(0,Number(persisted.revision)||0);
          if(revision>Number(state.revision||0)){
            state.revision=revision;
            if(p0State.documentId===id)p0State.revision=revision;
          }
        }catch(e){}
      }
    }
  },350);
}
function currentDocumentId(){
  try{if(typeof activeArticleId!=='undefined'&&activeArticleId)return String(activeArticleId)}catch(e){}
  return 'local-draft';
}
function settingsVersion(){
  try{return P0Core.textHash(JSON.stringify(settings||{}))}catch(e){return 'settings:unknown'}
}
function rulesVersion(){
  try{
    const pack=typeof activeRulePack!=='undefined'?activeRulePack:null;
    const lists=typeof controlLists!=='undefined'?controlLists:null;
    return P0Core.textHash(JSON.stringify({pack:pack||null,lists:lists||null}));
  }catch(e){return 'rules:unknown'}
}
function storedRevisionFor(id){
  const local=p0RevisionStore[id]||{};
  const native=nativeRevisionFor(id)||{};
  if(Number(native.revision||0)>Number(local.revision||0)){
    return {revision:Number(native.revision)||0,textHash:String(native.textHash||'')};
  }
  return {revision:Number(local.revision)||0,textHash:String(local.textHash||'')};
}
function syncDocumentRevision(reason){
  const id=currentDocumentId();
  const hash=P0Core.textHash(editor&&editor.value||'');
  if(p0State.documentId!==id){
    const saved=storedRevisionFor(id);
    let revision=Math.max(0,Number(saved.revision)||0);
    if(saved.textHash!==hash)revision++;
    if(revision<1)revision=1;
    p0State={documentId:id,revision,textHash:hash,settingsVersion:settingsVersion(),rulesVersion:rulesVersion()};
    p0RevisionStore[id]={revision,textHash:hash};
    saveRevisionStoreSoon();
    return p0State;
  }
  if(p0State.textHash!==hash){
    p0State.revision=Math.max(1,p0State.revision+1);
    p0State.textHash=hash;
    p0RevisionStore[id]={revision:p0State.revision,textHash:hash};
    saveRevisionStoreSoon();
  }
  p0State.settingsVersion=settingsVersion();
  p0State.rulesVersion=rulesVersion();
  return p0State;
}
function currentDocumentSnapshot(){
  const state=syncDocumentRevision('snapshot');
  return {
    documentId:state.documentId,
    revision:state.revision,
    textHash:state.textHash,
    settingsVersion:state.settingsVersion,
    rulesVersion:state.rulesVersion
  };
}
function snapshotMatchesCurrent(snapshot,options){
  return P0Core.snapshotMatches(snapshot,currentDocumentSnapshot(),options);
}

function stableRuleId(issue){
  if(issue&&issue.ruleId)return String(issue.ruleId);
  const type=String(issue&&issue.type||'unknown');
  const title=String(issue&&issue.title||'').toLocaleLowerCase('ru-RU');
  if(type==='heading')return title.startsWith('коротк')?'style.heading.short':'style.heading.long';
  if(type==='sentence')return 'style.sentence.long';
  if(type==='paragraph')return 'style.paragraph.long';
  if(type==='frequent')return 'style.frequent-word';
  if(type==='nearby')return 'style.nearby-repeat';
  if(type==='phrase')return 'style.repeated-phrase';
  if(type==='opening')return 'style.repeated-opening';
  if(type==='structure')return title.startsWith('нет подзаголов')?'structure.missing-subheadings':'structure.large-gap';
  if(type==='headingStructure'){
    if(title.startsWith('несколько'))return 'structure.multiple-h1';
    if(title.startsWith('скачок'))return 'structure.heading-level-jump';
    if(title.startsWith('два заголов'))return 'structure.adjacent-headings';
    return 'structure.heading';
  }
  if(type==='markdown'){
    if(title.startsWith('после #'))return 'markdown.heading-space';
    if(title.includes('ссылка'))return 'markdown.unclosed-link';
    return 'markdown.unclosed-markup';
  }
  if(type==='proof')return 'proof.mechanical';
  if(type==='control')return 'control.list-match';
  if(type==='semantic')return 'semantic.experimental';
  if(type==='rules')return 'rules.external';
  return 'legacy.'+type;
}
function issueKind(issue){
  const type=String(issue&&issue.type||'');
  if(type==='rules')return 'platform-rule';
  if(type==='proof'||type==='markdown')return 'error';
  return 'recommendation';
}
function normalizeIssueContract(issue,src,snapshot){
  if(!issue)return issue;
  const start=Math.max(0,Math.min(src.length,Number(issue.start)||0));
  const end=Math.max(start,Math.min(src.length,Number(issue.end)||start));
  issue.start=start;
  issue.end=end;
  issue.ruleId=stableRuleId(issue);
  issue.category=String(issue.category||issue.type||'unknown');
  issue.kind=String(issue.kind||issueKind(issue));
  if(!Number.isFinite(Number(issue.confidence)))issue.confidence=issue.kind==='error'?1:0.75;
  issue.fragment=src.slice(start,end);
  if(!Array.isArray(issue.fixes))issue.fixes=[];
  issue.documentId=snapshot.documentId;
  issue.revision=snapshot.revision;
  return issue;
}
function removeLegacyRepeatedWordIssues(issues){
  for(let i=issues.length-1;i>=0;i--){
    const issue=issues[i];
    if(!issue||issue.type!=='proof')continue;
    const title=String(issue.title||'').toLocaleLowerCase('ru-RU');
    if(/одинаков.*слов|повтор.*слов|слов.*подряд/.test(title))issues.splice(i,1);
  }
}
function addRepeatedWordIssues(src,issues,snapshot){
  if(!settings||!settings.proofCheck)return;
  removeLegacyRepeatedWordIssues(issues);
  const found=P0Core.findRepeatedWords(src);
  for(const hit of found){
    const issue=addIssue(issues,'proof','Повтор слова подряд','Одинаковое слово идёт два раза подряд. Проверьте, нужен ли повтор.',hit.start,hit.end,'warning');
    if(issue){
      issue.ruleId='style.repeated-word';
      issue.kind='recommendation';
      issue.confidence=0.98;
      issue.firstStart=hit.firstStart;
      issue.firstEnd=hit.firstEnd;
      issue.fragment=hit.fragment;
      issue.fixes=[];
      normalizeIssueContract(issue,src,snapshot);
    }
  }
}
function recountP0Analysis(){
  if(!currentAnalysis||!Array.isArray(currentAnalysis.issues))return;
  const overflow={...(currentAnalysis.issues._overflow||currentAnalysis.issueOverflow||{})};
  const overflowTotal=Object.values(overflow).reduce((a,b)=>a+(Number(b)||0),0);
  const countType=function(type){return currentAnalysis.issues.filter(x=>x.type===type).length+(Number(overflow[type])||0)};
  const warningCount=currentAnalysis.issues.length+overflowTotal;
  const rulesCount=countType('rules');
  const semanticCount=countType('semantic');
  currentAnalysis.issueOverflow=overflow;
  currentAnalysis.overflowTotal=overflowTotal;
  currentAnalysis.warningCount=warningCount;
  currentAnalysis.rulesCount=rulesCount;
  currentAnalysis.semanticCount=semanticCount;
  currentAnalysis.editorCount=Math.max(0,warningCount-rulesCount-semanticCount);
}

function applyDocumentEdits(edits,snapshot,label){
  const expected=snapshot||currentDocumentSnapshot();
  if(!snapshotMatchesCurrent(expected)){
    toast('Текст изменился после проверки. Сначала обновите проверку.');
    return false;
  }
  const before=editor.value||'';
  const result=P0Core.applyEdits(before,edits);
  if(!result.ok){
    toast(result.error==='overlap'?'Исправления пересекаются — действие отменено':'Фрагмент уже изменён — действие отменено');
    return false;
  }
  if(result.text===before)return true;
  if(typeof historyCheckpoint==='function')historyCheckpoint();
  editor.value=result.text;
  syncDocumentRevision(label||'edit transaction');
  if(typeof afterProgrammaticEdit==='function')afterProgrammaticEdit(true);
  return true;
}
window.currentDocumentSnapshot=currentDocumentSnapshot;
window.snapshotMatchesCurrent=snapshotMatchesCurrent;
window.applyDocumentEdits=applyDocumentEdits;

function patchAnalysisStateLabel(){
  const summary=document.getElementById('analysisSummary');
  if(!summary||!currentAnalysis)return;
  const snap=currentAnalysis.analysisSnapshot;
  if(currentAnalysis.status==='stale'){
    summary.insertAdjacentHTML('beforeend',' <span class="semanticRunning">Текст изменён — результаты устарели.</span>');
  }else if(snap&&currentAnalysis.status==='complete'){
    summary.insertAdjacentHTML('beforeend',' <span class="smallNote">Проверено доступными модулями · ревизия '+Number(snap.revision||0)+'.</span>');
  }
}

function restoreRuleFilter(){
  const root=document.querySelector('#analysisBackdrop .analysisFilters');
  if(!root||root.querySelector('[data-mode="rules"]'))return;
  const button=document.createElement('button');
  button.className='analysisFilter';
  button.dataset.mode='rules';
  button.textContent='Правила площадки';
  button.onclick=function(){setAnalysisMode('rules')};
  root.appendChild(button);
}
function restoreRulePackUi(){
  try{
    if(typeof activeRulePack!=='undefined'&&!activeRulePack&&typeof loadRulePack==='function')activeRulePack=loadRulePack();
  }catch(e){}

  const wrap=document.querySelector('#settingsBackdrop .settingsGroupWrap');
  if(wrap&&!document.querySelector('#rulePackStatus')){
    const group=document.createElement('details');
    group.className='settingsGroup';
    group.id='p0RulePackSettingsGroup';
    group.innerHTML='<summary><span>Пакет правил</span><small>Требования площадки или редакции</small></summary><div class="settingsGroupBody"><div id="rulePackStatus" class="ruleStatus"></div><div class="smallNote">Пакет работает локально. Импорт проверяется перед заменой действующего набора.</div><div class="settingActions rulePackActions"><button class="nativeBtn" type="button" data-rule-template>Скачать образец JSON</button><button class="nativeBtn primarySettingBtn" type="button" data-rule-import>Загрузить JSON</button></div></div>';
    group.querySelector('[data-rule-template]').onclick=function(){downloadRulePackTemplate()};
    group.querySelector('[data-rule-import]').onclick=function(){openRulePackImport()};
    const semantic=document.querySelector('#semanticClassifierSettings');
    if(semantic&&semantic.parentNode===wrap)wrap.insertBefore(group,semantic);else wrap.appendChild(group);
  }

  if(!document.querySelector('#rulePackFileInput')){
    const input=document.createElement('input');
    input.id='rulePackFileInput';input.className='fileInput';input.type='file';
    input.accept='.json,application/json,text/plain';
    const host=document.querySelector('.editorWrap')||document.body;host.appendChild(input);
    input.addEventListener('change',function(e){
      const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;
      const r=new FileReader();
      r.onload=function(){window.onNativeRulePackLoaded(String(r.result||''),f.name)};
      r.onerror=function(){toast('Не удалось прочитать JSON')};
      r.readAsText(f,'UTF-8');
    });
  }

  if(!document.querySelector('#rulePackBackdrop')){
    const backdrop=document.createElement('div');
    backdrop.className='sheetBackdrop';backdrop.id='rulePackBackdrop';
    backdrop.innerHTML='<div class="sheet rulePackSheet"><div class="handle"></div><div class="sheetHeader"><h2>Загрузить пакет правил</h2><button class="sheetClose" type="button" data-rule-close aria-label="Закрыть">×</button></div><div class="smallNote">Поддерживается строгий формат <b>editorial-rule-pack-v1</b>. Пакет не может выполнять код или сетевые запросы.</div><div class="settingActions"><button class="nativeBtn primarySettingBtn" type="button" data-rule-file>Выбрать JSON-файл</button></div><div class="subLabel"><span>Или вставьте JSON</span></div><textarea id="rulePackPaste" class="rulePackPaste" rows="10" spellcheck="false" placeholder="{ &quot;schema&quot;: &quot;editorial-rule-pack-v1&quot;, … }"></textarea><div class="settingActions"><button class="nativeBtn" type="button" data-rule-validate>Проверить формат</button><button id="rulePackInstallBtn" class="nativeBtn primarySettingBtn" type="button" data-rule-install hidden>Установить пакет</button></div><div id="rulePackImportResult" class="rulePackImportResult"></div></div>';
    backdrop.onclick=function(e){if(e.target===backdrop)closeRulePackImport()};
    backdrop.querySelector('[data-rule-close]').onclick=function(){closeRulePackImport()};
    backdrop.querySelector('[data-rule-file]').onclick=function(){chooseRulePackFile()};
    backdrop.querySelector('[data-rule-validate]').onclick=function(){validateRulePackPaste()};
    backdrop.querySelector('[data-rule-install]').onclick=function(){installPendingRulePack()};
    document.body.appendChild(backdrop);
  }

  restoreRuleFilter();
  try{if(typeof updateRulePackStatus==='function')updateRulePackStatus()}catch(e){}
}

function markSemanticExperimental(){
  const group=document.querySelector('#semanticClassifierSettings');
  if(!group)return;
  const summary=group.querySelector('summary');
  if(summary){
    const title=summary.querySelector('span');
    const small=summary.querySelector('small');
    if(title)title.textContent='Смысловая проверка · эксперимент';
    if(small)small.textContent='Не входит в основную проверку по ТЗ';
  }
  const body=group.querySelector('.settingsGroupBody');
  if(body&&!body.querySelector('[data-run-experimental-semantic]')){
    const row=document.createElement('div');
    row.className='settingActions';
    row.innerHTML='<button class="nativeBtn" data-run-experimental-semantic type="button">Запустить экспериментальную проверку</button>';
    row.querySelector('button').onclick=function(){
      if(typeof window.runExperimentalSemanticCheck==='function')window.runExperimentalSemanticCheck();
      else toast('Экспериментальная смысловая проверка недоступна');
    };
    body.insertBefore(row,body.firstChild);
    const note=document.createElement('div');
    note.className='smallNote';
    note.textContent='Основная кнопка «Проверить» запускает только принимаемые локальные модули. Этот ONNX-модуль оставлен временно для экспериментов и диагностики.';
    body.insertBefore(note,row.nextSibling);
  }
}

function installFoundation(){
  if(window.__p0FoundationInstalled)return;
  if(!window.P0Core||typeof editor==='undefined'||!editor)return;
  window.__p0FoundationInstalled=true;
  p0RevisionStore=loadRevisionStore();
  syncDocumentRevision('install');

  editor.addEventListener('input',function(){
    window.__experimentalSemanticViewActive=false;
    syncDocumentRevision('input');
  },true);

  if(typeof setEditorTextForArticle==='function'){
    const priorSetArticle=setEditorTextForArticle;
    setEditorTextForArticle=function(text,focus){
      window.__experimentalSemanticViewActive=false;
      const result=priorSetArticle(text,focus);
      syncDocumentRevision('article switch');
      return result;
    };
    window.setEditorTextForArticle=setEditorTextForArticle;
  }

  if(typeof afterProgrammaticEdit==='function'){
    const priorAfterEdit=afterProgrammaticEdit;
    afterProgrammaticEdit=function(runAnalysis,options){
      syncDocumentRevision('programmatic edit');
      return priorAfterEdit(runAnalysis,options);
    };
    window.afterProgrammaticEdit=afterProgrammaticEdit;
  }

  if(typeof markAnalysisStale==='function'){
    const priorStale=markAnalysisStale;
    markAnalysisStale=function(){
      if(currentAnalysis)currentAnalysis.status='stale';
      return priorStale();
    };
    window.markAnalysisStale=markAnalysisStale;
  }

  if(typeof analyzeText==='function'){
    const priorAnalyze=analyzeText;
    analyzeText=function(){
      const snapshot=currentDocumentSnapshot();
      const src=editor.value||'';
      const result=priorAnalyze();
      if(!currentAnalysis||!Array.isArray(currentAnalysis.issues))return result;
      if(!window.__experimentalSemanticViewActive){
        for(let i=currentAnalysis.issues.length-1;i>=0;i--){
          if(currentAnalysis.issues[i]&&currentAnalysis.issues[i].type==='semantic')currentAnalysis.issues.splice(i,1);
        }
      }
      addRepeatedWordIssues(src,currentAnalysis.issues,snapshot);
      for(const issue of currentAnalysis.issues)normalizeIssueContract(issue,src,snapshot);
      recountP0Analysis();
      currentAnalysis.analysisSnapshot=snapshot;
      currentAnalysis.status=snapshotMatchesCurrent(snapshot)?'complete':'stale';
      currentAnalysis.documentId=snapshot.documentId;
      currentAnalysis.revision=snapshot.revision;
      if(typeof renderAnalysis==='function')renderAnalysis();
      if(typeof updateAnalysisDot==='function')updateAnalysisDot();
      return currentAnalysis;
    };
    window.analyzeText=analyzeText;
  }

  if(typeof renderAnalysis==='function'){
    const priorRenderAnalysis=renderAnalysis;
    renderAnalysis=function(){
      const out=priorRenderAnalysis();
      restoreRuleFilter();
      patchAnalysisStateLabel();
      return out;
    };
    window.renderAnalysis=renderAnalysis;
  }

  if(typeof buildAnalysisReport==='function'){
    const priorReport=buildAnalysisReport;
    buildAnalysisReport=function(){
      let text=priorReport();
      const a=currentAnalysis||{};
      const total=Number(a.warningCount)||0;
      const rules=Number(a.rulesCount)||0;
      const semantic=window.__experimentalSemanticViewActive?(Number(a.semanticCount)||0):0;
      const editorCount=Math.max(0,total-rules-semantic);
      text=String(text||'').replace(/Всего замечаний:[^\n]*/, 'Всего замечаний: '+total+'; редакторских: '+editorCount+'; правил площадки: '+rules+'; смысловых экспериментальных: '+semantic+'.');
      if(typeof activeRulePack!=='undefined'&&activeRulePack){
        const line='Пакет правил: '+String(activeRulePack.name||'без названия')+' · '+String(activeRulePack.version||'без версии')+'.';
        if(!text.includes(line))text=text.replace(/\n/,'\n'+line+'\n');
      }
      return text;
    };
    window.buildAnalysisReport=buildAnalysisReport;
  }

  if(typeof renderReplacement==='function'){
    const priorRenderReplacement=renderReplacement;
    renderReplacement=function(){
      const out=priorRenderReplacement();
      if(replacementState){
        const snap=currentDocumentSnapshot();
        replacementState.p0Snapshot=snap;
        replacementState.p0Expected=editor.value.slice(replacementState.start,replacementState.end);
      }
      return out;
    };
    window.renderReplacement=renderReplacement;
  }

  if(typeof applyReplacement==='function'){
    const priorApplyReplacement=applyReplacement;
    applyReplacement=function(text){
      if(!replacementState)return;
      const snap=replacementState.p0Snapshot;
      const expected=String(replacementState.p0Expected==null?'':replacementState.p0Expected);
      const current=editor.value.slice(replacementState.start,replacementState.end);
      if(!snap||!snapshotMatchesCurrent(snap)||current!==expected){
        toast('Этот фрагмент уже изменился. Откройте замечание заново.');
        if(typeof closeReplacement==='function')closeReplacement();
        return;
      }
      return priorApplyReplacement(text);
    };
    window.applyReplacement=applyReplacement;
  }

  if(typeof runFullCheck==='function'){
    const experimentalRun=runFullCheck;
    window.runExperimentalSemanticCheck=function(){
      window.__experimentalSemanticViewActive=true;
      return experimentalRun();
    };
    runFullCheck=function(){
      window.__experimentalSemanticViewActive=false;
      const src=editor.value||'';
      if(!src.trim()){toast('Нет текста для проверки');return}
      editor.blur();
      setCheckRunning(true);
      toast(src.length>150000?'Обновляю доступные локальные проверки большого текста…':'Обновляю доступные локальные проверки…');
      setTimeout(function(){
        try{
          analyzeText();
          analysisMode='problems';
          document.getElementById('analysisBackdrop').classList.add('open');
          setAnalysisMode('problems');
          renderAnalysis();
          setCheckRunning(false);
          toast('Проверено доступными локальными модулями');
        }catch(e){
          setCheckRunning(false);
          toast('Не удалось завершить локальную проверку');
          console.error(e);
        }
      },40);
    };
    window.runFullCheck=runFullCheck;
  }

  if(typeof openSettings==='function'){
    const priorOpenSettings=openSettings;
    openSettings=function(){
      const out=priorOpenSettings();
      setTimeout(function(){restoreRulePackUi();markSemanticExperimental()},0);
      return out;
    };
    window.openSettings=openSettings;
  }

  setTimeout(function(){restoreRulePackUi();markSemanticExperimental()},80);

  try{
    if(window.AndroidDevLog&&typeof AndroidDevLog.log==='function')AndroidDevLog.log('P0','foundation installed; nativeRevision='+nativeRevisionAvailable());
  }catch(e){}
}

setTimeout(installFoundation,0);
})();
