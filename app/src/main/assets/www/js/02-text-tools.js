function loadSettings(){try{return {...defaultSettings,...JSON.parse(localStorage.getItem('dzenSettings')||'{}')}}catch(e){return {...defaultSettings}}}
function escapeHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function inline(s){s=escapeHtml(s);s=s.replace(/`([^`]+)`/g,'<code>$1</code>');s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');s=s.replace(/__([^_]+)__/g,'<strong>$1</strong>');s=s.replace(/~~([^~]+)~~/g,'<del>$1</del>');s=s.replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>');s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2">$1</a>');return s}
function markdownToHtml(src){src=(src||'').replace(/\r\n?/g,'\n').trim();if(!src)return '';const lines=src.split('\n');let out=[],para=[],listType=null,quote=[];const flushPara=()=>{if(para.length){out.push('<p>'+inline(para.join(' '))+'</p>');para=[]}};const closeList=()=>{if(listType){out.push('</'+listType+'>');listType=null}};const flushQuote=()=>{if(quote.length){out.push('<blockquote><p>'+inline(quote.join(' '))+'</p></blockquote>');quote=[]}};for(let i=0;i<lines.length;i++){const raw=lines[i],t=raw.trim();if(!t){flushPara();closeList();flushQuote();continue}let m=t.match(/^(#{1,6})\s+(.+)$/);if(m){flushPara();closeList();flushQuote();let n=m[1].length;out.push(`<h${n}>${inline(m[2])}</h${n}>`);continue}if(/^([-*_])(?:\s*\1){2,}$/.test(t)){flushPara();closeList();flushQuote();out.push('<hr>');continue}m=t.match(/^>\s?(.*)$/);if(m){flushPara();closeList();quote.push(m[1]);continue}else flushQuote();m=t.match(/^[-*+]\s+(.+)$/);if(m){flushPara();if(listType!=='ul'){closeList();out.push('<ul>');listType='ul'}out.push('<li>'+inline(m[1])+'</li>');continue}m=t.match(/^\d+[.)]\s+(.+)$/);if(m){flushPara();if(listType!=='ol'){closeList();out.push('<ol>');listType='ol'}out.push('<li>'+inline(m[1])+'</li>');continue}closeList();para.push(t)}flushPara();closeList();flushQuote();return out.join('\n')}
function plainFromHtml(html){const d=document.createElement('div');d.innerHTML=html;return (d.innerText||d.textContent||'').replace(/\n{3,}/g,'\n\n').trim()}
function wordMatches(text){return Array.from(text.matchAll(/[A-Za-zА-Яа-яЁё0-9]+(?:[-’'][A-Za-zА-Яа-яЁё0-9]+)*/g))}
const stopWords=new Set(('и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем сказать всех никогда сегодня можно при про это эта эти тот та те такой такая такие же очень более менее также либо через после перед между над под без около среди каждый каждый раз ещё'.split(/\s+/)));

// Локальный словарь замен. Формы в каждой строке выровнены по падежу/числу или форме глагола.
const synonymForms={};
function addAlignedForms(sourceForms,...replacementFormSets){sourceForms.forEach((f,i)=>{synonymForms[f]=replacementFormSets.map(a=>a[i]).filter(Boolean)})}
addAlignedForms(['человек','человека','человеку','человеком','человеке','люди','людей','людям','людьми','людях'],
 ['пользователь','пользователя','пользователю','пользователем','пользователе','пользователи','пользователей','пользователям','пользователями','пользователях'],
 ['читатель','читателя','читателю','читателем','читателе','читатели','читателей','читателям','читателями','читателях'],
 ['собеседник','собеседника','собеседнику','собеседником','собеседнике','собеседники','собеседников','собеседникам','собеседниками','собеседниках']);
addAlignedForms(['способ','способа','способу','способом','способе','способы','способов','способам','способами','способах'],
 ['метод','метода','методу','методом','методе','методы','методов','методам','методами','методах'],
 ['вариант','варианта','варианту','вариантом','варианте','варианты','вариантов','вариантам','вариантами','вариантах'],
 ['приём','приёма','приёму','приёмом','приёме','приёмы','приёмов','приёмам','приёмами','приёмах']);
addAlignedForms(['результат','результата','результату','результатом','результате','результаты','результатов','результатам','результатами','результатах'],
 ['итог','итога','итогу','итогом','итоге','итоги','итогов','итогам','итогами','итогах'],
 ['эффект','эффекта','эффекту','эффектом','эффекте','эффекты','эффектов','эффектам','эффектами','эффектах'],
 ['вывод','вывода','выводу','выводом','выводе','выводы','выводов','выводам','выводами','выводах']);
addAlignedForms(['слово','слова','слову','словом','слове','слова','слов','словам','словами','словах'],
 ['выражение','выражения','выражению','выражением','выражении','выражения','выражений','выражениям','выражениями','выражениях'],
 ['понятие','понятия','понятию','понятием','понятии','понятия','понятий','понятиям','понятиями','понятиях'],
 ['определение','определения','определению','определением','определении','определения','определений','определениям','определениями','определениях']);
addAlignedForms(['приложение','приложения','приложению','приложением','приложении','приложения','приложений','приложениям','приложениями','приложениях'],
 ['решение','решения','решению','решением','решении','решения','решений','решениям','решениями','решениях'],
 ['средство','средства','средству','средством','средстве','средства','средств','средствам','средствами','средствах']);
addAlignedForms(['опыт','опыта','опыту','опытом','опыте','опыты','опытов','опытам','опытами','опытах'],
 ['практика','практики','практике','практикой','практике','практики','практик','практикам','практиками','практиках'],
 ['навык','навыка','навыку','навыком','навыке','навыки','навыков','навыкам','навыками','навыках'],
 ['стаж','стажа','стажу','стажем','стаже','стажи','стажей','стажам','стажами','стажах'],
 ['знание','знания','знанию','знанием','знании','знания','знаний','знаниям','знаниями','знаниях']);
addAlignedForms(['хочу','хочешь','хочет','хотим','хотите','хотят','хотел','хотела','хотело','хотели'],
 ['желаю','желаешь','желает','желаем','желаете','желают','желал','желала','желало','желали'],
 ['стремлюсь','стремишься','стремится','стремимся','стремитесь','стремятся','стремился','стремилась','стремилось','стремились']);
Object.assign(synonymForms,{
 'можно':['возможно','допустимо','получится'],'нужно':['стоит','следует','необходимо'],'важно':['существенно','принципиально','значимо'],
 'например':['к примеру','скажем'],'поэтому':['из-за этого','по этой причине'],'также':['ещё','кроме того'],'однако':['но','вместе с тем'],
 'работает':['действует','функционирует'],'работают':['действуют','функционируют'],'работал':['действовал','функционировал'],'работала':['действовала','функционировала'],
 'помогает':['позволяет','упрощает','облегчает'],'помогают':['позволяют','упрощают','облегчают'],'использовать':['применять','задействовать'],'использует':['применяет','задействует'],'используют':['применяют','задействуют'],
 'получить':['получить','добиться','обрести'],'показывает':['демонстрирует','отображает','показывает'],'показывают':['демонстрируют','отображают']
});
function loadUserSynonyms(){try{const raw=JSON.parse(localStorage.getItem(USER_SYNONYMS_KEY)||'{}');if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};const out={};for(const [k,v] of Object.entries(raw)){if(!Array.isArray(v))continue;const key=String(k||'').trim().toLocaleLowerCase('ru-RU');if(!key)continue;out[key]=v.map(x=>String(x||'').trim()).filter(Boolean).slice(0,20)}return out}catch(e){return {}}}
function userSynonymPairCount(){return Object.values(userSynonyms).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0)}
function saveUserSynonyms(){try{localStorage.setItem(USER_SYNONYMS_KEY,JSON.stringify(userSynonyms))}catch(e){}updateUserSynonymStatus()}
function rememberUserSynonym(source,replacement){const key=String(source||'').trim().toLocaleLowerCase('ru-RU'),val=String(replacement||'').trim();if(!key||!val||key===val.toLocaleLowerCase('ru-RU'))return;let arr=Array.isArray(userSynonyms[key])?userSynonyms[key].slice():[];arr=arr.filter(x=>String(x).toLocaleLowerCase('ru-RU')!==val.toLocaleLowerCase('ru-RU'));arr.unshift(val);userSynonyms[key]=arr.slice(0,20);saveUserSynonyms()}
function updateUserSynonymStatus(){const status=document.getElementById('userSynonymStatus'),list=document.getElementById('userSynonymList');if(!status&&!list)return;const pairs=[];for(const key of Object.keys(userSynonyms).sort((a,b)=>a.localeCompare(b,'ru'))){for(const v of userSynonyms[key]||[])pairs.push([key,v])}if(status)status.innerHTML=pairs.length?`Свои синонимы: <b>${pairs.length}</b> ${pairs.length%10===1&&pairs.length%100!==11?'пара':'пар'}`:'Свои синонимы: пока нет';if(list)list.textContent=pairs.length?pairs.slice(0,80).map(([k,v])=>`${k} → ${v}`).join('\n')+(pairs.length>80?`\n…ещё ${pairs.length-80}`:''):'Пока пусто.'}
function clearUserSynonyms(){const n=userSynonymPairCount();if(!n){toast('Накопленных синонимов пока нет');return}if(!confirm(`Удалить накопленные синонимы (${n})?`))return;userSynonyms={};try{localStorage.removeItem(USER_SYNONYMS_KEY)}catch(e){}updateUserSynonymStatus();if(replacementState)renderReplacement();toast('Накопленные синонимы удалены')}
function preserveCase(src,repl){if(!repl)return repl;if(src===src.toUpperCase()&&/[A-Za-zА-Яа-яЁё]/.test(src))return repl.toUpperCase();if(src[0]&&src[0]===src[0].toUpperCase())return repl.charAt(0).toUpperCase()+repl.slice(1);return repl}
function externalDictLookup(key){try{if(window.AndroidDictionary&&typeof AndroidDictionary.lookup==='function'){const raw=AndroidDictionary.lookup(key);const o=raw?JSON.parse(raw):null;return o&&Array.isArray(o.synonyms)?o.synonyms:[]}}catch(e){}return (window.browserSynonymMap&&window.browserSynonymMap[key])||[]}
function lemmaCandidates(w){
 const out=[w],seen=new Set(out);const add=x=>{if(x&&x.length>2&&!seen.has(x)){seen.add(x);out.push(x)}};
 const irregular={
  'хочу':'хотеть','хочешь':'хотеть','хочет':'хотеть','хотим':'хотеть','хотите':'хотеть','хотят':'хотеть','хотел':'хотеть','хотела':'хотеть','хотело':'хотеть','хотели':'хотеть',
  'могу':'мочь','можешь':'мочь','может':'мочь','можем':'мочь','можете':'мочь','могут':'мочь','мог':'мочь','могла':'мочь','могли':'мочь',
  'иду':'идти','идёшь':'идти','идет':'идти','идёт':'идти','идем':'идти','идём':'идти','идете':'идти','идёте':'идти','идут':'идти','шёл':'идти','шел':'идти','шла':'идти','шли':'идти',
  'вижу':'видеть','видишь':'видеть','видит':'видеть','видим':'видеть','видите':'видеть','видят':'видеть',
  'даю':'давать','даёшь':'давать','дает':'давать','даёт':'давать','даем':'давать','даём':'давать','даете':'давать','даёте':'давать','дают':'давать'
 };
 if(irregular[w])add(irregular[w]);
 const vrules=[
  ['етесь',['иться','аться','яться','еться']],['итесь',['иться']],['ятся',['иться']],['атся',['аться']],['ишься',['иться']],['ится',['иться']],['имся',['иться']],['юсь',['иться','аться','яться','еться']],['усь',['иться','аться']],
  ['ете',['ать','ять','еть']],['ешь',['ать','ять','еть']],['ет',['ать','ять','еть']],['ем',['ать','ять','еть']],['ют',['ать','ять']],['ают',['ать']],['яют',['ять']],
  ['ите',['ить']],['ишь',['ить']],['ит',['ить']],['им',['ить']],['ят',['ить']],['ат',['ать','ить']],
  ['ю',['ть','ить','ать','ять']],['у',['ть','ить','ать']],['ла',['ть']],['ло',['ть']],['ли',['ть']],['л',['ть']]
 ];
 for(const [end,adds] of vrules){if(w.endsWith(end)&&w.length>end.length+1){const stem=w.slice(0,-end.length);for(const a of adds)add(stem+a)}}
 const nrules=[['ами',['','а']],['ями',['я','ь','й']],['ого',['ый','ий','ой']],['ему',['ый','ий']],['ому',['ый','ой']],['ыми',['ый','ий']],['ими',['ий']],['ых',['ый']],['их',['ий']],['ую',['ая']],['юю',['яя']],['ая',['ый']],['яя',['ий']],['ые',['ый']],['ие',['ий']],['ов',['']],['ев',['й','ь','']],['ей',['я','ь','й','']],['ам',['','а']],['ям',['я','ь','й']],['ах',['','а']],['ях',['я','ь','й']],['ом',['']],['ем',['ь','й','е','']],['у',['']],['ю',['я','й','ь','']],['а',['']],['я',['','ь','й','е']],['ы',['','а']],['и',['','а','я','ь','й']],['е',['','а','о','я','ь']]];
 for(const [end,adds] of nrules){if(w.endsWith(end)&&w.length>end.length+2){const stem=w.slice(0,-end.length);for(const a of adds)add(stem+a)}}
 return out.slice(0,32)
}
function nounForms(lemma){const x=lemma.toLocaleLowerCase('ru-RU'),f={nom_sg:x};const hard=i=>/[гкхжчшщц]$/i.test(i);if(x.endsWith('а')){const st=x.slice(0,-1),g=st+(hard(st)?'и':'ы');Object.assign(f,{gen_sg:g,dat_sg:st+'е',acc_sg:st+'у',ins_sg:st+'ой',prep_sg:st+'е',nom_pl:g,gen_pl:st,dat_pl:st+'ам',ins_pl:st+'ами',prep_pl:st+'ах'})}else if(x.endsWith('я')){const st=x.slice(0,-1);Object.assign(f,{gen_sg:st+'и',dat_sg:st+'е',acc_sg:st+'ю',ins_sg:st+'ей',prep_sg:st+'е',nom_pl:st+'и',gen_pl:st+'ь',dat_pl:st+'ям',ins_pl:st+'ями',prep_pl:st+'ях'})}else if(x.endsWith('о')){const st=x.slice(0,-1);Object.assign(f,{gen_sg:st+'а',dat_sg:st+'у',acc_sg:x,ins_sg:st+'ом',prep_sg:st+'е',nom_pl:st+'а',gen_pl:st,dat_pl:st+'ам',ins_pl:st+'ами',prep_pl:st+'ах'})}else if(x.endsWith('е')){const st=x.slice(0,-1);Object.assign(f,{gen_sg:st+'я',dat_sg:st+'ю',acc_sg:x,ins_sg:st+'ем',prep_sg:st+'е',nom_pl:st+'я',gen_pl:st+'й',dat_pl:st+'ям',ins_pl:st+'ями',prep_pl:st+'ях'})}else if(x.endsWith('й')){const st=x.slice(0,-1);Object.assign(f,{gen_sg:st+'я',dat_sg:st+'ю',acc_sg:x,ins_sg:st+'ем',prep_sg:st+'е',nom_pl:st+'и',gen_pl:st+'ев',dat_pl:st+'ям',ins_pl:st+'ями',prep_pl:st+'ях'})}else if(x.endsWith('ь')){const st=x.slice(0,-1);Object.assign(f,{gen_sg:st+'я',dat_sg:st+'ю',acc_sg:x,ins_sg:st+'ем',prep_sg:st+'е',nom_pl:st+'и',gen_pl:st+'ей',dat_pl:st+'ям',ins_pl:st+'ями',prep_pl:st+'ях'})}else{const st=x,pl=st+(hard(st)?'и':'ы');Object.assign(f,{gen_sg:st+'а',dat_sg:st+'у',acc_sg:x,ins_sg:st+'ом',prep_sg:st+'е',nom_pl:pl,gen_pl:st+'ов',dat_pl:st+'ам',ins_pl:st+'ами',prep_pl:st+'ах'})}return f}
function adaptExternalForm(surface,matchedLemma,candidate){if(!candidate||/\s|[-–—]/.test(candidate))return candidate;const sf=nounForms(matchedLemma);let tag=null;const low=surface.toLocaleLowerCase('ru-RU');for(const [k,v] of Object.entries(sf)){if(v===low){tag=k;break}}if(!tag||tag==='nom_sg')return candidate;const cf=nounForms(candidate);return cf[tag]||candidate}
function suggestionsForWord(word){const lower=word.toLocaleLowerCase('ru-RU'),out=[];const add=x=>{if(x&&x.toLocaleLowerCase('ru-RU')!==lower&&!out.some(y=>y.toLocaleLowerCase('ru-RU')===x.toLocaleLowerCase('ru-RU')))out.push(x)};(userSynonyms[lower]||[]).forEach(add);(synonymForms[lower]||[]).forEach(add);let matched=null,ext=[];for(const k of lemmaCandidates(lower)){const arr=externalDictLookup(k);if(arr&&arr.length){matched=k;ext=arr;break}}if(matched)ext.forEach(x=>add(adaptExternalForm(lower,matched,String(x).trim())));return out.map(x=>preserveCase(word,x)).slice(0,10)}
let replacementState=null;
