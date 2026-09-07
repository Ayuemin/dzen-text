#!/usr/bin/env python3
from pathlib import Path


def rep(text, old, new, label, count=1):
    found = text.count(old)
    if found < count:
        raise SystemExit(f"{label}: expected at least {count}, found {found}")
    return text.replace(old, new, count)

p = Path('app/src/main/assets/www/index.html')
s = p.read_text(encoding='utf-8')

s = rep(s, '<title>Дзен Текст 1.7.0</title>', '<title>Дзен Текст 1.8.0</title>', 'html title')

old = '<div class="switchRow" style="margin-top:13px"><span>Ошибки Markdown</span><input id="markdownCheck" class="switch" type="checkbox" onchange="applySettings()"></div>'
new = old + '\n    <div class="switchRow" style="margin-top:13px"><span>Признаки ИИ-стиля</span><input id="aiStyleCheck" class="switch" type="checkbox" onchange="applySettings()"></div>\n    <div class="smallNote">Локальный редакторский фильтр: длинное тире, шаблонные вводные и переходы, конструкции «не просто X, а Y» / «не только X, но и Y», чрезмерные связки, однообразные H2 и серия абзацев с мини-слоганами. Это не доказательство авторства ИИ, а поиск характерного машинного почерка.</div>'
s = rep(s, old, new, 'AI-style setting UI')

s = rep(s, 'markdownCheck:true,proofCheck:true', 'markdownCheck:true,aiStyleCheck:true,proofCheck:true', 'default setting')
s = rep(s, 'markdownCheck.checked=settings.markdownCheck;dzenCheck.checked=settings.dzenCheck;', 'markdownCheck.checked=settings.markdownCheck;aiStyleCheck.checked=settings.aiStyleCheck!==false;dzenCheck.checked=settings.dzenCheck;', 'sync setting')
s = rep(s, 'markdownCheck:markdownCheck.checked,dzenCheck:dzenCheck.checked', 'markdownCheck:markdownCheck.checked,aiStyleCheck:aiStyleCheck.checked,dzenCheck:dzenCheck.checked', 'apply setting')

anchor = 'function analyzeProofLocal(src,issues){\n'
ai_code = r'''function aiNorm(s){return String(s||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е')}
function aiPhraseOccurrences(src,phrase,max=20){const text=aiNorm(src),q=aiNorm(phrase),out=[];for(const at of dzenOccurrences(text,q,max,'phrase'))out.push({start:at,end:at+phrase.length});return out}
function addAIStyleAggregate(issues,title,detail,occurrences){if(!occurrences||!occurrences.length)return;const first=occurrences[0];addSimpleIssue(issues,'aiStyle',title,detail,first.start,first.end,'warning');const it=issues[issues.length-1];if(occurrences.length>1){it.occurrences=occurrences.slice(0,40);it.navTitle=title}}
function analyzeAIStyle(src,headings,paragraphs,issues){
 let remaining=24;
 const addAgg=(title,detail,occ)=>{if(remaining<=0||!occ||!occ.length)return;addAIStyleAggregate(issues,title,detail,occ);remaining--};
 const dashOcc=Array.from(src.matchAll(/—/g)).map(m=>({start:m.index,end:m.index+1}));
 if(dashOcc.length)addAgg(`Длинное тире — ${dashOcc.length} раз`,dashOcc.length===1?'В редакционном стиле это заметный машинный маркер. Само по себе тире не доказывает авторство ИИ.':'Много длинных тире делает текст похожим на типичную нейросетевую подачу. Проверьте, нужны ли они синтаксически.',dashOcc);
 const cliches=[
  'знаете это чувство, когда','представьте себе','в современном мире','в эпоху цифровых технологий','и тут на сцену выходит','а теперь самое интересное','что это за зверь','давайте честно','не будем тянуть','подведём итоги','подведем итоги','в заключение','без лишних слов','подводные камни','кому подойдёт, а кому нет','кому подойдет, а кому нет','что под капотом','ответ прост','вывод очевиден','давайте разберёмся','давайте разберемся','сегодня поговорим','в этой статье мы рассмотрим','каждый из нас','ни для кого не секрет','важно отметить','следует отметить'
 ];
 const seenCliche=new Set();
 for(const ph of cliches){const key=aiNorm(ph);if(seenCliche.has(key))continue;seenCliche.add(key);const occ=aiPhraseOccurrences(src,ph,8);if(occ.length)addAgg(`Шаблонная формулировка: «${ph}»`,'Фраза часто встречается в машинных текстах и обычно не добавляет содержания. Лучше начать сразу с факта или мысли.',occ)}
 const meta=[
  'и вот тут начинается','и вот здесь начинается самое интересное','вот тут и появляется','именно здесь становится понятно','а теперь перейдём к','а теперь перейдем к','дальше разберём','дальше разберем','ниже рассмотрим','в следующем разделе','следующий важный момент','есть ещё один нюанс','есть еще один нюанс','но это ещё не всё','но это еще не все','дальше — больше','дальше - больше','чтобы понять это, сначала','о нём поговорим дальше','о нем поговорим дальше','к этому мы ещё вернёмся','к этому мы еще вернемся'
 ];
 const seenMeta=new Set();
 for(const ph of meta){const key=aiNorm(ph);if(seenMeta.has(key))continue;seenMeta.add(key);const occ=aiPhraseOccurrences(src,ph,8);if(occ.length)addAgg(`Метатекст вместо мысли: «${ph}»`,'Переход анонсирует следующий фрагмент вместо того, чтобы сразу сообщить новый факт. Это характерный шаблон машинной подачи.',occ)}
 const patterns=[
  {re:/\bэто\s+не\s+просто\b[^.!?\n]{1,160}\b(?:а|но)\b[^.!?\n]{0,160}/giu,title:'Шаблон «это не просто X, а Y»',detail:'Контрастная конструкция сама по себе допустима, но часто используется моделью как готовая риторическая рамка.'},
  {re:/\bне\s+только\b[^.!?\n]{1,180}\bно\s+и\b[^.!?\n]{0,180}/giu,title:'Шаблон «не только X, но и Y»',detail:'Проверьте, нельзя ли сказать мысль прямо без симметричной риторической конструкции.'}
 ];
 for(const spec of patterns){let n=0;for(const m of src.matchAll(spec.re)){if(remaining<=0||n>=4)break;addSimpleIssue(issues,'aiStyle',spec.title,spec.detail,m.index,m.index+m[0].length,'warning');remaining--;n++}}
 const connectors=['кроме того','более того','однако','при этом'];
 for(const ph of connectors){const occ=aiPhraseOccurrences(src,ph,30);if(occ.length>=4)addAgg(`Связка «${ph}» повторяется ${occ.length} раз`,'Частое повторение служебной связки создаёт ровный машинный ритм. Оставьте её только там, где без неё нарушается логика.',occ)}
 const h2=(headings||[]).filter(h=>h.level===2);
 if(h2.length>=3){const map=new Map();for(const h of h2){const m=wordMatches(h.text)[0];if(!m)continue;const key=aiNorm(m[0]);let v=map.get(key)||{word:m[0],items:[]};v.items.push(h);map.set(key,v)}const top=[...map.values()].sort((a,b)=>b.items.length-a.items.length)[0];if(top&&top.items.length>=3&&top.items.length/h2.length>=.67){const occ=top.items.map(h=>({start:h.start,end:Math.min(h.end,h.start+top.word.length)}));addAgg(`Однообразные H2: ${top.items.length} из ${h2.length} начинаются с «${top.word}»`,'Одинаковая синтаксическая рамка большинства подзаголовков выглядит шаблонно. Попробуйте формулировать подзаголовки как разные самостоятельные мысли.',occ)}}
 const sloganRuns=[];let run=[];
 const flushRun=()=>{if(run.length>=4)sloganRuns.push(run.slice());run=[]};
 for(const p of paragraphs||[]){const matches=Array.from(String(p.text||'').matchAll(/[^.!?…\n]+(?:[.!?…]+|$)/g));if(!matches.length){flushRun();continue}const last=matches[matches.length-1],clean=last[0].trim(),lead=last[0].indexOf(clean),wc=countWords(stripMarkdownForLabel(clean));if(p.chars>=100&&wc>0&&wc<=6&&clean.length<=70){run.push({start:p.start+last.index+Math.max(0,lead),end:p.start+last.index+Math.max(0,lead)+clean.length})}else flushRun()}
 flushRun();
 for(const seq of sloganRuns.slice(0,2))addAgg(`Серия абзацев с короткими финальными фразами — ${seq.length} подряд`,'Несколько абзацев подряд заканчиваются мини-слоганами. Такой ритм часто выглядит искусственно выстроенным.',seq);
}
'''
if anchor not in s:
    raise SystemExit('AI code anchor not found')
s = s.replace(anchor, ai_code + anchor, 1)

s = rep(s, 'if(settings.markdownCheck)analyzeMarkdown(src,issues);\n if(settings.proofCheck)analyzeProofLocal(src,issues);', 'if(settings.markdownCheck)analyzeMarkdown(src,issues);\n if(settings.aiStyleCheck!==false)analyzeAIStyle(src,headings,paragraphs,issues);\n if(settings.proofCheck)analyzeProofLocal(src,issues);', 'analyze call')

old = "const warningCount=issues.length,dzenCount=issues.filter(x=>x.type==='dzen').length,spellCount=issues.filter(x=>x.type==='spelling').length,editorCount=warningCount-dzenCount-spellCount;currentAnalysis={issues,warningCount,dzenCount,spellCount,editorCount,metrics};"
new = "const warningCount=issues.length,dzenCount=issues.filter(x=>x.type==='dzen').length,spellCount=issues.filter(x=>x.type==='spelling').length,aiStyleCount=issues.filter(x=>x.type==='aiStyle').length,editorCount=warningCount-dzenCount-spellCount-aiStyleCount;currentAnalysis={issues,warningCount,dzenCount,spellCount,aiStyleCount,editorCount,metrics};"
s = rep(s, old, new, 'analysis counters')

s = rep(s, "{id:'proof',name:'Опечатки и пунктуация'},{id:'risk',name:'Контроль слов'}", "{id:'proof',name:'Опечатки и пунктуация'},{id:'aiStyle',name:'Признаки ИИ-стиля'},{id:'risk',name:'Контроль слов'}", 'issue group')

old = "lines.push(`Всего замечаний: ${a.warningCount||0}; редакторских: ${a.editorCount||0}; правила Дзена: ${a.dzenCount||0}; орфография: ${a.spellCount||0}.`);"
new = "lines.push(`Всего замечаний: ${a.warningCount||0}; редакторских: ${a.editorCount||0}; признаки ИИ-стиля: ${a.aiStyleCount||0}; правила Дзена: ${a.dzenCount||0}; орфография: ${a.spellCount||0}.`);"
s = rep(s, old, new, 'report summary')

old = "function renderAnalysis(){const box=document.getElementById('analysisContent'),sum=document.getElementById('analysisSummary'),collapsed=document.getElementById('analysisCollapsedSummary'),a=currentAnalysis,ec=a.editorCount||0,dc=a.dzenCount||0,sc=a.spellCount||0;let spellPart=settings.onlineSpelling?(spellStatus==='checking'?' · орфография: <b>проверяю…</b>':` · орфография: <b>${sc}</b>`):' · онлайн-орфография: выкл.';sum.innerHTML=a.warningCount?`Редакторских замечаний: <b>${ec}</b> · по правилам Дзена: <b>${dc}</b>${spellPart}.`:`<b>По локальным проверкам замечаний нет.</b>${spellPart} Финальная вычитка всё равно нужна.`;"
new = "function renderAnalysis(){const box=document.getElementById('analysisContent'),sum=document.getElementById('analysisSummary'),collapsed=document.getElementById('analysisCollapsedSummary'),a=currentAnalysis,ec=a.editorCount||0,ac=a.aiStyleCount||0,dc=a.dzenCount||0,sc=a.spellCount||0;let spellPart=settings.onlineSpelling?(spellStatus==='checking'?' · орфография: <b>проверяю…</b>':` · орфография: <b>${sc}</b>`):' · онлайн-орфография: выкл.';sum.innerHTML=a.warningCount?`Редакторских замечаний: <b>${ec}</b> · ИИ-стиль: <b>${ac}</b> · по правилам Дзена: <b>${dc}</b>${spellPart}.`:`<b>По локальным проверкам замечаний нет.</b>${spellPart} Финальная вычитка всё равно нужна.`;"
s = rep(s, old, new, 'analysis display counts')

s = rep(s, "if(i.type==='dzen')sev=i.severity==='critical'?'Высокий риск — проверить':'Проверить вручную';", "if(i.type==='dzen')sev=i.severity==='critical'?'Высокий риск — проверить':'Проверить вручную';if(i.type==='aiStyle')sev='Маркер машинного стиля — проверить';", 'AI severity label')
s = rep(s, "else if((i.type==='phrase'||i.type==='opening')&&Array.isArray(i.occurrences)&&i.occurrences.length>1)", "else if((i.type==='phrase'||i.type==='opening'||i.type==='aiStyle')&&Array.isArray(i.occurrences)&&i.occurrences.length>1)", 'AI navigation')

s = s.replace('Dzen-Text/1.5.0 Android', 'Dzen-Text/1.8.0 Android')
p.write_text(s, encoding='utf-8')

b = Path('app/build.gradle')
t = b.read_text(encoding='utf-8')
t = rep(t, 'versionCode 26', 'versionCode 27', 'versionCode')
t = rep(t, "versionName '1.7.0'", "versionName '1.8.0'", 'versionName')
b.write_text(t, encoding='utf-8')

r = Path('README.md')
readme = r.read_text(encoding='utf-8')
readme = rep(readme, 'Текущая версия: **v1.7.0**.', 'Текущая версия: **v1.8.0**.', 'README version')
needle = 'Из каждого замечания можно перейти прямо к нужному месту текста. Для повторов рядом, повторяющихся фраз и одинаковых начал доступна навигация по совпадениям со счётчиком и стрелками.\n'
section = needle + '''\n### Признаки ИИ-стиля\n\nОтдельный локальный слой ищет не «факт использования ИИ», а характерный машинный почерк. Он отключается в настройках и входит в общую кнопку проверки.\n\nСреди сигналов:\n\n- длинное тире `—`;\n- шаблонные вводные и клише вроде «В современном мире», «Подведём итоги», «Давайте разберёмся»;\n- метапереходы, которые анонсируют следующий абзац вместо новой мысли;\n- конструкции «это не просто X, а Y» и «не только X, но и Y»;\n- чрезмерное повторение связок «кроме того», «более того», «однако», «при этом»;\n- однообразная синтаксическая рамка большинства H2;\n- серия абзацев, каждый из которых заканчивается короткой фразой-слоганом.\n\nСрабатывание означает только повод отредактировать стиль. По таким признакам нельзя достоверно установить, кто написал текст — человек или модель. Для агрегированных сигналов доступна навигация по всем найденным местам.\n'''
readme = rep(readme, needle, section, 'README AI-style section')
r.write_text(readme, encoding='utf-8')

print('Patched Dzen Text to v1.8.0')
