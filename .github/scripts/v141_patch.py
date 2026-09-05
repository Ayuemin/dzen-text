from pathlib import Path

p = Path('app/src/main/assets/www/index.html')
s = p.read_text(encoding='utf-8')

def rep(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f'Patch anchor not found: {label}')
    s = s.replace(old, new, 1)

rep('<title>Дзен Текст 1.4.0</title>', '<title>Дзен Текст 1.4.1</title>', 'title')

# Sheet close buttons and navigator styles.
css_anchor = ".analysisRow.dzenRisk .warn{color:#b26718}"
css_extra = ".sheetHeader{display:flex;align-items:center;gap:10px}.sheetHeader h2{flex:1;margin:0 0 15px}.sheetClose{width:38px;height:38px;border:1px solid var(--border);border-radius:10px;background:var(--surface2);color:var(--text);font-size:22px;display:grid;place-items:center;margin-bottom:12px}.repeatNavPanel{position:absolute;left:10px;right:10px;bottom:8px;z-index:8;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 10px 35px rgba(0,0,0,.24);padding:11px;display:none;max-height:310px;overflow:auto}.repeatNavPanel.open{display:block}.repeatNavHead{display:flex;align-items:center;gap:8px;margin-bottom:8px}.repeatNavTitle{font-size:13px;color:var(--muted);min-width:0;flex:1}.repeatNavTitle b{color:var(--text);font-size:15px}.repeatNavContext{display:block;width:100%;text-align:left;border:1px solid var(--border);background:var(--surface2);color:var(--text);border-radius:11px;padding:11px;margin-top:7px;font-size:13px;line-height:1.5}.repeatNavHit{color:var(--accent);font-weight:800;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px;background:var(--accentSoft);border-radius:4px;padding:0 2px}.repeatNavMeta{color:var(--muted);font-size:11px;margin-top:7px}"
rep(css_anchor, css_extra + css_anchor, 'css')

# Settings header: explicit close button.
rep('<div class="sheetBackdrop" id="settingsBackdrop" onclick="backdropClick(event)"><div class="sheet">\n  <div class="handle"></div><h2>Настройки</h2>',
    '<div class="sheetBackdrop" id="settingsBackdrop" onclick="backdropClick(event)"><div class="sheet">\n  <div class="handle"></div><div class="sheetHeader"><h2>Настройки</h2><button class="sheetClose" type="button" onclick="closeSettings()" aria-label="Закрыть настройки">×</button></div>',
    'settings header')

# Analysis button now closes instead of floating/collapsing.
rep('<div class="handle"></div><div class="analysisHeader"><h2>Редакторский анализ</h2><button id="analysisCollapse" class="analysisCollapse" type="button" onclick="toggleAnalysisCollapse()" aria-label="Свернуть анализ">⌄</button></div><div id="analysisCollapsedSummary" class="analysisCollapsedSummary"></div>',
    '<div class="handle"></div><div class="sheetHeader"><h2>Редакторский анализ</h2><button id="analysisCollapse" class="sheetClose" type="button" onclick="closeAnalysis()" aria-label="Закрыть анализ">×</button></div>',
    'analysis header')

# Add repeat navigator near existing nearby-repeat panel.
markup_anchor = '''    <div id="nearbyPanel" class="nearbyPanel" aria-live="polite">
      <div class="nearbyHead"><div class="nearbyTitle">Повтор рядом: <b id="nearbyWord">—</b><div>Одно слово найдено в двух соседних предложениях</div></div><button class="miniIcon" onclick="closeNearbyRepeat()" aria-label="Закрыть">×</button></div>
      <button id="nearbyFirst" class="nearbySentence" onclick="jumpNearbyRepeat(0)"></button>
      <button id="nearbySecond" class="nearbySentence" onclick="jumpNearbyRepeat(1)"></button>
      <div class="nearbyActions"><button class="nativeBtn" type="button" onclick="replaceNearbyRepeat(0)">Заменить первое</button><button class="nativeBtn" type="button" onclick="replaceNearbyRepeat(1)">Заменить второе</button></div>
      <div class="replaceNote">Повторяющееся слово подчёркнуто в обоих предложениях. Нажмите на предложение, чтобы перейти к соответствующему месту текста.</div>
    </div>'''
markup_new = markup_anchor + '''
    <div id="repeatNavPanel" class="repeatNavPanel" aria-live="polite">
      <div class="repeatNavHead"><div class="repeatNavTitle"><b id="repeatNavTitle">Повтор</b><div id="repeatNavCount"></div></div><button id="repeatNavPrev" class="miniIcon" onclick="navigateRepeatOccurrence(-1)" aria-label="Предыдущее совпадение">‹</button><button id="repeatNavNext" class="miniIcon" onclick="navigateRepeatOccurrence(1)" aria-label="Следующее совпадение">›</button><button class="miniIcon" onclick="closeRepeatNavigator()" aria-label="Закрыть">×</button></div>
      <button id="repeatNavContext" class="repeatNavContext" type="button" onclick="jumpRepeatOccurrence()"></button>
      <div class="repeatNavMeta">Листайте совпадения стрелками. Нажмите на фрагмент, чтобы перейти к нему в редакторе.</div>
    </div>'''
rep(markup_anchor, markup_new, 'repeat navigator markup')

old_phrase = "function analyzeRepeatedPhrases(src,issues){const ws=wordMatches(src).map(m=>({text:m[0],low:m[0].toLocaleLowerCase('ru-RU'),start:m.index,end:m.index+m[0].length})),maps={3:new Map(),2:new Map()};for(const n of [3,2]){for(let i=0;i+n<=ws.length;i++){const a=ws.slice(i,i+n),segment=src.slice(a[0].start,a[a.length-1].end);if(/[.!?…\\n]/.test(segment))continue;if(n===2&&(a.some(x=>x.low.length<5||stopWords.has(x.low))))continue;if(n===3&&a.filter(x=>x.low.length>=4&&!stopWords.has(x.low)).length<2)continue;const key=a.map(x=>x.low).join(' ');if(key.length<10)continue;let v=maps[n].get(key);if(!v){v={count:0,start:a[0].start,end:a[a.length-1].end,text:segment};maps[n].set(key,v)}v.count++}}const selected=[];for(const n of [3,2]){const arr=[...maps[n].entries()].filter(([,v])=>v.count>=2).sort((a,b)=>b[1].count-a[1].count||b[0].length-a[0].length);for(const [key,v] of arr){if(selected.length>=8)break;if(n===2&&selected.some(x=>x.key.includes(key)))continue;selected.push({key,...v});addSimpleIssue(issues,'phrase',`Повторяется фраза: «${v.text}»`,`${v.count} раза в тексте`,v.start,v.end)}}}"
new_phrase = "function analyzeRepeatedPhrases(src,issues){const ws=wordMatches(src).map(m=>({text:m[0],low:m[0].toLocaleLowerCase('ru-RU'),start:m.index,end:m.index+m[0].length})),maps={3:new Map(),2:new Map()};for(const n of [3,2]){for(let i=0;i+n<=ws.length;i++){const a=ws.slice(i,i+n),segment=src.slice(a[0].start,a[a.length-1].end);if(/[.!?…\\n]/.test(segment))continue;if(n===2&&(a.some(x=>x.low.length<5||stopWords.has(x.low))))continue;if(n===3&&a.filter(x=>x.low.length>=4&&!stopWords.has(x.low)).length<2)continue;const key=a.map(x=>x.low).join(' ');if(key.length<10)continue;let v=maps[n].get(key);if(!v){v={count:0,start:a[0].start,end:a[a.length-1].end,text:segment,occurrences:[]};maps[n].set(key,v)}v.count++;v.occurrences.push({start:a[0].start,end:a[a.length-1].end})}}const selected=[];for(const n of [3,2]){const arr=[...maps[n].entries()].filter(([,v])=>v.count>=2).sort((a,b)=>b[1].count-a[1].count||b[0].length-a[0].length);for(const [key,v] of arr){if(selected.length>=8)break;if(n===2&&selected.some(x=>x.key.includes(key)))continue;selected.push({key,...v});addSimpleIssue(issues,'phrase',`Повторяется фраза: «${v.text}»`,`${v.count} раза в тексте`,v.start,v.end);issues[issues.length-1].occurrences=v.occurrences;issues[issues.length-1].navTitle=`Фраза «${v.text}»`}}}"
rep(old_phrase, new_phrase, 'phrase occurrences')

old_open = "function analyzeOpenings(sentences,paragraphs,issues){const scan=(items,label,minCount)=>{const map=new Map();for(const o of items){const m=wordMatches(stripMarkdownForLabel(o.text))[0];if(!m)continue;const key=m[0].toLocaleLowerCase('ru-RU');if(key.length<3)continue;let v=map.get(key);if(!v){const local=o.text.toLocaleLowerCase('ru-RU').indexOf(key);v={count:0,start:o.start+Math.max(0,local),end:o.start+Math.max(0,local)+m[0].length,word:m[0]};map.set(key,v)}v.count++}for(const [,v] of [...map].filter(([,v])=>v.count>=minCount).sort((a,b)=>b[1].count-a[1].count).slice(0,5)){addSimpleIssue(issues,'opening',`${label} часто начинаются с «${v.word}»`,`${v.count} одинаковых начал`,v.start,v.end)}};scan(sentences,'Предложения',3);scan(paragraphs,'Абзацы',3)}"
new_open = "function analyzeOpenings(sentences,paragraphs,issues){const scan=(items,label,minCount)=>{const map=new Map();for(const o of items){const clean=stripMarkdownForLabel(o.text),m=wordMatches(clean)[0];if(!m)continue;const key=m[0].toLocaleLowerCase('ru-RU');if(key.length<3)continue;const rawLow=o.text.toLocaleLowerCase('ru-RU'),local=rawLow.indexOf(key),start=o.start+Math.max(0,local),end=start+m[0].length;let v=map.get(key);if(!v){v={count:0,start,end,word:m[0],occurrences:[]};map.set(key,v)}v.count++;v.occurrences.push({start,end,contextStart:o.start,contextEnd:o.end})}for(const [,v] of [...map].filter(([,v])=>v.count>=minCount).sort((a,b)=>b[1].count-a[1].count).slice(0,5)){addSimpleIssue(issues,'opening',`${label} часто начинаются с «${v.word}»`,`${v.count} одинаковых начал`,v.start,v.end);issues[issues.length-1].occurrences=v.occurrences;issues[issues.length-1].navTitle=`${label}: «${v.word}»`}};scan(sentences,'Предложения',3);scan(paragraphs,'Абзацы',3)}"
rep(old_open, new_open, 'opening occurrences')

old_issue = "function issueHtml(i){let sev=i.severity==='critical'?'Контроль':'Обратите внимание';if(i.type==='dzen')sev=i.severity==='critical'?'Высокий риск — проверить':'Проверить вручную';const word=i.word?String(i.word):'';let click,cls,hint;if(i.type==='nearby'&&Number.isFinite(i.pairStart)){click=`openNearbyRepeat(${i.pairStart},${i.pairEnd},${i.start},${i.end},${i.firstSentenceStart},${i.firstSentenceEnd},${i.secondSentenceStart},${i.secondSentenceEnd},${JSON.stringify(word)})`;cls='analysisRow jump nearbyWord';hint='нажмите: показать оба повтора'}else{click=word&&i.type==='frequent'?`openReplacement(${i.start},${i.end},${JSON.stringify(word)})`:`jumpTo(${i.start},${i.end})`;cls='analysisRow jump'+(word&&i.type==='frequent'?' frequentWord':'')+(i.type==='dzen'?' dzenRisk':'');hint=word&&i.type==='frequent'?'нажмите: перейти и выбрать замену':'нажмите для перехода'}return `<button class=\"${cls}\" onclick='${click.replace(/'/g,\"&#39;\")}'><span class=\"warn\">${escapeHtml(i.title)}</span><span class=\"meta\">${escapeHtml(i.detail||'')} · ${sev} · ${hint}</span></button>`}"
new_issue = "function issueHtml(i){let sev=i.severity==='critical'?'Контроль':'Обратите внимание';if(i.type==='dzen')sev=i.severity==='critical'?'Высокий риск — проверить':'Проверить вручную';const word=i.word?String(i.word):'';let click,cls,hint;if(i.type==='nearby'&&Number.isFinite(i.pairStart)){click=`openNearbyRepeat(${i.pairStart},${i.pairEnd},${i.start},${i.end},${i.firstSentenceStart},${i.firstSentenceEnd},${i.secondSentenceStart},${i.secondSentenceEnd},${JSON.stringify(word)})`;cls='analysisRow jump nearbyWord';hint='нажмите: показать оба повтора'}else if((i.type==='phrase'||i.type==='opening')&&Array.isArray(i.occurrences)&&i.occurrences.length>1){const idx=currentAnalysis.issues.indexOf(i);click=`openRepeatNavigator(${idx})`;cls='analysisRow jump';hint=`нажмите: листать ${i.occurrences.length} совпадений`}else{click=word&&i.type==='frequent'?`openReplacement(${i.start},${i.end},${JSON.stringify(word)})`:`jumpTo(${i.start},${i.end})`;cls='analysisRow jump'+(word&&i.type==='frequent'?' frequentWord':'')+(i.type==='dzen'?' dzenRisk':'');hint=word&&i.type==='frequent'?'нажмите: перейти и выбрать замену':'нажмите для перехода'}return `<button class=\"${cls}\" onclick='${click.replace(/'/g,\"&#39;\")}'><span class=\"warn\">${escapeHtml(i.title)}</span><span class=\"meta\">${escapeHtml(i.detail||'')} · ${sev} · ${hint}</span></button>`}"
rep(old_issue, new_issue, 'issue navigation')

old_collapse = "function toggleAnalysisCollapse(){const bd=document.getElementById('analysisBackdrop'),btn=document.getElementById('analysisCollapse'),on=bd.classList.toggle('collapsed');btn.textContent=on?'⌃':'⌄';btn.setAttribute('aria-label',on?'Развернуть анализ':'Свернуть анализ')}\nfunction openAnalysis(){analyzeText();const bd=document.getElementById('analysisBackdrop');bd.classList.add('open');bd.classList.remove('collapsed');const btn=document.getElementById('analysisCollapse');if(btn){btn.textContent='⌄';btn.setAttribute('aria-label','Свернуть анализ')}setAnalysisMode(analysisMode)}\nfunction analysisBackdropClick(e){if(e.target.id==='analysisBackdrop'&&!e.currentTarget.classList.contains('collapsed'))e.currentTarget.classList.remove('open')}"
new_collapse = "function closeAnalysis(){document.getElementById('analysisBackdrop').classList.remove('open')}\nfunction openAnalysis(){analyzeText();document.getElementById('analysisBackdrop').classList.add('open');setAnalysisMode(analysisMode)}\nfunction analysisBackdropClick(e){if(e.target.id==='analysisBackdrop')closeAnalysis()}"
rep(old_collapse, new_collapse, 'analysis close behavior')

# Settings close helper.
rep("function backdropClick(e){if(e.target.id==='settingsBackdrop')e.currentTarget.classList.remove('open')}",
    "function closeSettings(){document.getElementById('settingsBackdrop').classList.remove('open')}\nfunction backdropClick(e){if(e.target.id==='settingsBackdrop')closeSettings()}",
    'settings close helper')

# Repeat navigator helpers, inserted before nearby-repeat state.
nearby_anchor = "let nearbyState=null;"
nav_helpers = r'''let repeatNavState=null;
function repeatContextMarkup(occ){const src=editor.value||'';let a=Number.isFinite(occ.contextStart)?occ.contextStart:Math.max(0,occ.start-90),b=Number.isFinite(occ.contextEnd)?occ.contextEnd:Math.min(src.length,occ.end+110);if(!Number.isFinite(occ.contextStart)){const left=src.lastIndexOf('\n',occ.start-1);if(left>=0)a=Math.max(a,left+1);const right=src.indexOf('\n',occ.end);if(right>=0)b=Math.min(b,right)}const full=src.slice(a,b).replace(/^\s+|\s+$/g,'');const trimLeft=src.slice(a,b).indexOf(full),base=a+Math.max(0,trimLeft),hs=Math.max(0,occ.start-base),he=Math.max(hs,Math.min(full.length,occ.end-base));return `${escapeHtml(full.slice(0,hs))}<span class="repeatNavHit">${escapeHtml(full.slice(hs,he))}</span>${escapeHtml(full.slice(he))}`}
function openRepeatNavigator(issueIndex){const issue=currentAnalysis.issues[issueIndex];if(!issue||!Array.isArray(issue.occurrences)||issue.occurrences.length<2){if(issue)jumpTo(issue.start,issue.end);return}closeAnalysis();if(replacementState)closeReplacement();if(nearbyState)closeNearbyRepeat();repeatNavState={issueIndex,index:0,occurrences:issue.occurrences,title:issue.navTitle||issue.title};showPane('edit');renderRepeatNavigator();jumpRepeatOccurrence(true)}
function renderRepeatNavigator(){const panel=document.getElementById('repeatNavPanel');if(!repeatNavState){panel.classList.remove('open');return}const total=repeatNavState.occurrences.length;repeatNavState.index=((repeatNavState.index%total)+total)%total;const occ=repeatNavState.occurrences[repeatNavState.index];document.getElementById('repeatNavTitle').textContent=repeatNavState.title;document.getElementById('repeatNavCount').textContent=`${repeatNavState.index+1} из ${total} совпадений`;document.getElementById('repeatNavPrev').disabled=total<2;document.getElementById('repeatNavNext').disabled=total<2;document.getElementById('repeatNavContext').innerHTML=repeatContextMarkup(occ);panel.classList.add('open')}
function navigateRepeatOccurrence(dir){if(!repeatNavState)return;repeatNavState.index+=dir;renderRepeatNavigator();jumpRepeatOccurrence(true)}
function jumpRepeatOccurrence(quiet=false){if(!repeatNavState)return;const occ=repeatNavState.occurrences[repeatNavState.index];jumpTo(occ.start,occ.end,true);if(!quiet)toast(`${repeatNavState.index+1} из ${repeatNavState.occurrences.length}`)}
function closeRepeatNavigator(){repeatNavState=null;document.getElementById('repeatNavPanel').classList.remove('open')}
'''
rep(nearby_anchor, nav_helpers + nearby_anchor, 'repeat navigator helpers')

# Close repeat navigator when text changes, is cleared, or a file is loaded.
rep("editor.addEventListener('input',()=>{if(replacementState)closeReplacement();if(nearbyState)closeNearbyRepeat();render()});",
    "editor.addEventListener('input',()=>{if(replacementState)closeReplacement();if(nearbyState)closeNearbyRepeat();if(repeatNavState)closeRepeatNavigator();render()});",
    'input close navigator')
rep("stopSpeak();closeReplacement();closeNearbyRepeat();editor.value='';",
    "stopSpeak();closeReplacement();closeNearbyRepeat();closeRepeatNavigator();editor.value='';",
    'clear close navigator')
rep("closeReplacement();closeNearbyRepeat();render();showPane('edit');editor.focus();toast(name?`Загружен файл: ${name}`:'Текст загружен из файла')",
    "closeReplacement();closeNearbyRepeat();closeRepeatNavigator();render();showPane('edit');editor.focus();toast(name?`Загружен файл: ${name}`:'Текст загружен из файла')",
    'file load close navigator')

p.write_text(s, encoding='utf-8')

g = Path('app/build.gradle')
b = g.read_text(encoding='utf-8')
if "versionCode 19" not in b or "versionName '1.4.0'" not in b:
    raise SystemExit('Unexpected Android version before v1.4.1 patch')
b = b.replace('versionCode 19', 'versionCode 20', 1).replace("versionName '1.4.0'", "versionName '1.4.1'", 1)
g.write_text(b, encoding='utf-8')
