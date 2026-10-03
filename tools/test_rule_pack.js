const fs=require('fs');
const vm=require('vm');
const path=require('path');

const root=process.env.RULE_PACK_ROOT?path.resolve(process.env.RULE_PACK_ROOT):path.resolve(__dirname,'..');
const source=fs.readFileSync(process.env.RULE_PACK_SOURCE||path.join(root,'app/src/main/assets/www/js/04-rules-analysis.js'),'utf8');
const storage=new Map();
const context={console,JSON,Set,Map,Math,Array,String,Number,RegExp,Object,Date,Promise};
context.escapeHtml=s=>String(s??'');
context.toast=()=>{};
context.localStorage={getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
context.addSimpleIssue=(issues,type,title,detail,start,end,severity='warning')=>{const issue={type,title,detail,start,end,severity};issues.push(issue);return issue};
context.addIssue=context.addSimpleIssue;
context.document={getElementById:()=>null,querySelector:()=>null,createElement:()=>({}),body:{appendChild:()=>{}}};
context.window={};
vm.createContext(context);
vm.runInContext(source,context,{filename:'04-rules-analysis.js'});

function headingsFromSource(src){const out=[];const re=/^(#{1,6})[ \t]+(.+)$/gm;let m;while((m=re.exec(src))){const text=m[2].trim();const textStart=m.index+m[0].indexOf(m[2]);out.push({level:m[1].length,text,start:textStart,end:textStart+m[2].length,lineStart:m.index})}return out}
function validate(pack){const vr=context.validateRulePackObject(pack);if(!vr.ok)throw new Error('validation failed: '+vr.errors.join('; '));return JSON.parse(JSON.stringify(vr.pack))}
function analyze(pack,text){context.__pack=pack;context.__src=text;context.__headings=headingsFromSource(text);context.__issues=[];vm.runInContext('activeRulePack=__pack; __diag=analyzeRulePack(__src,__headings,__issues);',context);return {issues:context.__issues,diag:context.__diag}}
function ids(result){return result.issues.map(x=>x.ruleId)}
function assert(cond,msg){if(!cond)throw new Error(msg)}
function check(name,pack,text,expectedIds=[],unexpectedIds=[]){const result=analyze(pack,text),got=ids(result);for(const id of expectedIds)assert(got.includes(id),`${name}: expected ${id}, got ${JSON.stringify(got)}`);for(const id of unexpectedIds)assert(!got.includes(id),`${name}: did not expect ${id}, got ${JSON.stringify(got)}`);console.log('ok -',name,got.join(', ')||'no matches');return result}
function oneRule(rule){return validate({schema:'editorial-rule-pack-v1',id:'test-pack',name:'Test',version:'1',rules:[rule]})}
const base=(id,type,extra={})=>({id,title:id,type,scope:'all',severity:'warning',message:id,...extra});

const template=JSON.parse(context.rulePackTemplate());
const templateValidated=context.validateRulePackObject(template);
assert(templateValidated.ok,'download template must be valid: '+templateValidated.errors.join('; '));
const fileTemplate=JSON.parse(fs.readFileSync(path.join(root,'rules/editorial-rule-pack-example.json'),'utf8'));
const fileTemplateValidated=context.validateRulePackObject(fileTemplate);
assert(fileTemplateValidated.ok,'rules template file must be valid: '+fileTemplateValidated.errors.join('; '));
assert(JSON.stringify(fileTemplateValidated.pack)===JSON.stringify(templateValidated.pack),'rules template file must match downloaded template');
console.log('ok - template valid and synchronized');

check('word fires with boundaries',oneRule(base('word','word',{values:['запрещено']})),'Это ЗАПРЕЩЕНО правилами.',['word']);
check('word does not fire inside another word',oneRule(base('word','word',{values:['запрещено']})),'Это незапрещено. ',[],['word']);
check('phrase is case-insensitive',oneRule(base('phrase','phrase',{values:['гарантированный доход']})),'Обещан ГАРАНТИРОВАННЫЙ ДОХОД каждому.',['phrase']);
check('phrase_any needs one alternative',oneRule(base('any','phrase_any',{values:['красный флаг','вы не поверите']})),'Сегодня: ВЫ НЕ ПОВЕРИТЕ.',['any']);
check('phrase_all positive',oneRule(base('all','phrase_all',{values:['первая фраза','вторая фраза']})),'Первая фраза здесь, затем ВТОРАЯ ФРАЗА.',['all']);
check('phrase_all negative',oneRule(base('all','phrase_all',{values:['первая фраза','вторая фраза']})),'Только первая фраза.',[],['all']);
const stemPack=oneRule(base('stem','stem',{values:['реклам']}));
for(const text of ['Это реклама.','Это рекламный текст.','Нельзя рекламировать товар.'])check('stem positive: '+text,stemPack,text,['stem']);
check('stem respects left word boundary',stemPack,'Это предрекламный маркер.',[],['stem']);

const contextRule=base('context','context',{stems:['доход'],required_nearby:['без риска','гарантирован'],exclude_nearby:['не гарантируется','можно потерять'],window:45,min_score:2});
const contextPack=oneRule(contextRule);
check('context positive with required_nearby',contextPack,'Доход без риска гарантирован каждому.',['context']);
check('context exclude_nearby suppresses',contextPack,'Доход без риска, но можно потерять деньги.',[],['context']);
check('context window is respected',contextPack,'Доход '+'.'.repeat(80)+' без риска.',[],['context']);
const strictScore=oneRule(base('strict-context','context',{stems:['доход'],required_nearby:[],exclude_nearby:[],window:50,min_score:2}));
check('context min_score is respected',strictScore,'Доход возможен.',[],['strict-context']);

const titleLen=oneRule(base('title-length','title_length',{scope:'title',max:12}));
check('title_length markdown H1',titleLen,'# Очень длинный заголовок\nТекст.',['title-length']);
check('title_length first non-empty line',titleLen,'\n  Очень длинный заголовок  \nТекст.',['title-length']);
const titlePhrase=oneRule(base('title-phrase','phrase_any',{scope:'title',values:['вы не поверите']}));
check('scope title markdown H1',titlePhrase,'# Вы не поверите сегодня\nОбычный текст.',['title-phrase']);
check('scope title plain first line',titlePhrase,'\nВы не поверите сегодня\nОбычный текст.',['title-phrase']);

const bodyWord=oneRule(base('body-word','word',{scope:'body',values:['банан']}));
check('scope body ignores plain title',bodyWord,'Банан в заголовке\nВ теле яблоко.',[],['body-word']);
check('scope body ignores markdown H1',bodyWord,'# Банан в заголовке\nВ теле яблоко.',[],['body-word']);
const bodyHit=check('scope body finds body with original offsets',bodyWord,'Банан в заголовке\nВ теле есть банан.',['body-word']);
const bodyIssue=bodyHit.issues.find(x=>x.ruleId==='body-word');assert('Банан в заголовке\nВ теле есть банан.'.slice(bodyIssue.start,bodyIssue.end).toLowerCase()==='банан','body start/end must map to original textarea');

const links=oneRule(base('links','link_count',{max:1}));
check('link_count over limit',links,'https://a.example x https://b.example',['links']);
check('link_count at limit',links,'https://a.example',[],['links']);
const caps=oneRule(base('caps','caps_ratio',{max_ratio:0.5,min_letters:8}));
check('caps_ratio high',caps,'ЭТО ОЧЕНЬ ГРОМКИЙ ТЕКСТ',['caps']);
check('caps_ratio normal',caps,'Это обычный спокойный текст',[],['caps']);
const manual=oneRule({id:'manual',title:'Manual',type:'manual',severity:'warning',message:'manual only'});
check('manual never auto-fires',manual,'Manual manual manual',[],['manual']);

const simple=oneRule(base('forbidden-word','word',{values:['банан'],title:'Найдено контрольное слово',message:'Слово банан запрещено этим тестовым пакетом.'}));
const acceptance=check('acceptance banana scenario',simple,'Сегодня я купил банан в магазине.',['forbidden-word']);
const banana=acceptance.issues.find(x=>x.ruleId==='forbidden-word');assert('Сегодня я купил банан в магазине.'.slice(banana.start,banana.end)==='банан','acceptance issue must select exactly банан');

const persisted=validate({schema:'editorial-rule-pack-v1',id:'persist',name:'Persist',version:'1',rules:[base('persist-word','word',{values:['сохранилось']})]});
context.__persisted=persisted;assert(vm.runInContext('saveRulePack(__persisted)',context)===true,'saveRulePack failed');const loaded=vm.runInContext('loadRulePack()',context);assert(loaded&&loaded.id==='persist','loadRulePack failed after serialization');check('serialize reload preserves behavior',JSON.parse(JSON.stringify(loaded)),'Всё сохранилось после перезапуска.',['persist-word']);

const templateClean=JSON.parse(JSON.stringify(templateValidated.pack));
const sample=check('downloaded template self-check',templateClean,templateClean.test_text,['forbidden-word','title-clickbait','finance-context','title-too-long','too-many-links'],['manual-title']);
assert(sample.diag.checked===5,'template should check five automatic rules');assert(sample.diag.matches>=5,'template should produce several matches');

const invalidMinMax=context.validateRulePackObject({schema:'editorial-rule-pack-v1',id:'bad',name:'Bad',version:'1',rules:[base('bad-len','title_length',{min:20,max:10})]});assert(!invalidMinMax.ok,'title_length min > max must be rejected');
const invalidCaps=context.validateRulePackObject({schema:'editorial-rule-pack-v1',id:'bad-caps',name:'Bad',version:'1',rules:[base('bad-caps-rule','caps_ratio',{max_ratio:2})]});assert(!invalidCaps.ok,'caps_ratio > 1 must be rejected');
console.log('ok - executable validation guards');

const good=base('good','word',{values:['банан']}),broken=base('broken','phrase',{values:null});
const protectedPack={schema:'editorial-rule-pack-v1',id:'runtime',name:'Runtime',version:'1',rules:[good,broken]};
const protectedResult=analyze(protectedPack,'банан');assert(ids(protectedResult).includes('good'),'valid rule must still run when another rule throws');assert(protectedResult.diag.errors.length===1&&protectedResult.diag.errors[0].ruleId==='broken','runtime rule error must be diagnosed');console.log('ok - per-rule runtime errors are isolated');

console.log('Rule pack behavior OK');
