const fs=require('fs');
const vm=require('vm');
const path=require('path');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app/src/main/assets/www/js/04-rules-analysis.js'),'utf8');
const context={console,JSON,Set,Math,Array,String,Number,RegExp,Object,Date};
context.escapeHtml=s=>String(s??'');
context.toast=()=>{};
context.localStorage={getItem:()=>null,setItem:()=>{}};
context.addSimpleIssue=(issues,type,title,detail,start,end,severity='warning')=>{
  const issue={type,title,detail,start,end,severity};
  issues.push(issue);
  return issue;
};
context.document={getElementById:()=>({})};
context.window={};
vm.createContext(context);
vm.runInContext(source,context,{filename:'04-rules-analysis.js'});

function headingsFromSource(src){
  const out=[];const re=/^(#{1,6})[ \t]+(.+)$/gm;let m;
  while((m=re.exec(src))){const text=m[2].trim();const textStart=m.index+m[0].indexOf(m[2]);out.push({level:m[1].length,text,start:textStart,end:textStart+m[2].length,lineStart:m.index});}
  return out;
}
function check(name,pack,text,expectedIds,unexpectedIds=[]){
  context.__pack=pack;context.__src=text;context.__headings=headingsFromSource(text);context.__issues=[];
  vm.runInContext('activeRulePack=__pack; analyzeRulePack(__src,__headings,__issues);',context);
  const ids=context.__issues.map(x=>x.ruleId);
  for(const id of expectedIds){if(!ids.includes(id))throw new Error(`${name}: expected ${id}, got ${JSON.stringify(ids)}`)}
  for(const id of unexpectedIds){if(ids.includes(id))throw new Error(`${name}: did not expect ${id}, got ${JSON.stringify(ids)}`)}
  console.log('ok -',name,ids.join(', ')||'no matches');
}

const pack={schema:'editorial-rule-pack-v1',id:'test-pack',name:'Test',version:'1',rules:[
  {id:'title-phrase',title:'Title phrase',type:'phrase_any',scope:'title',severity:'warning',values:['вы не поверите'],message:'title'},
  {id:'word',title:'Word',type:'word',scope:'all',severity:'warning',values:['запрещено'],message:'word'},
  {id:'stem',title:'Stem',type:'stem',scope:'body',severity:'warning',values:['реклам'],message:'stem'},
  {id:'all',title:'All phrases',type:'phrase_all',scope:'all',severity:'warning',values:['первая фраза','вторая фраза'],message:'all'},
  {id:'context',title:'Context',type:'context',scope:'all',severity:'warning',phrases:[],stems:['доход'],required_nearby:['без риска'],exclude_nearby:['можно потерять'],window:120,min_score:2,message:'context'},
  {id:'title-length',title:'Title len',type:'title_length',scope:'title',severity:'warning',max:12,message:'len'},
  {id:'links',title:'Links',type:'link_count',scope:'all',severity:'warning',max:1,message:'links'},
  {id:'caps',title:'Caps',type:'caps_ratio',scope:'all',severity:'warning',max_ratio:0.5,min_letters:8,message:'caps'},
  {id:'manual',title:'Manual',type:'manual',severity:'warning',message:'manual only'}
]};
const vr=context.validateRulePackObject(pack);
if(!vr.ok)throw new Error('validation failed: '+vr.errors.join('; '));
const clean=JSON.parse(JSON.stringify(vr.pack));

check('phrase in markdown title',clean,'# Вы не поверите сегодня\nОбычный текст.',['title-phrase']);
check('exact word boundaries',clean,'Это запрещено, но незапрещено.', ['word']);
check('stem in body',clean,'# Заголовок\nРекламный материал.', ['stem']);
check('phrase_all',clean,'Первая фраза здесь. Потом вторая фраза.', ['all']);
check('context positive',clean,'Доход без риска обещают всем.', ['context']);
check('context excluded',clean,'Доход без риска, но можно потерять деньги.', [], ['context']);
check('title length',clean,'# Очень длинный заголовок\nТекст.', ['title-length']);
check('link count',clean,'https://a.example x https://b.example', ['links']);
check('caps ratio',clean,'ЭТО ОЧЕНЬ ГРОМКИЙ ТЕКСТ', ['caps']);
check('manual never auto-fires',clean,'manual', [], ['manual']);

const sample=JSON.parse(context.rulePackTemplate());
const sampleResult=context.validateRulePackObject(sample);
if(!sampleResult.ok)throw new Error('template invalid: '+sampleResult.errors.join('; '));
check('downloaded template detects title example',JSON.parse(JSON.stringify(sampleResult.pack)),'# Вы не поверите: тест\nОбычный текст.',['title-clickbait']);
check('downloaded template detects finance example',JSON.parse(JSON.stringify(sampleResult.pack)),'Доход без риска: гарантированный доход.',['finance-context']);

console.log('Rule pack behavior OK');
