(function(){
'use strict';

function proofModel(src){return typeof P0Core!=='undefined'&&P0Core&&typeof P0Core.documentModel==='function'?P0Core.documentModel(src):null}
function proofExcluded(model,start,end){return !!(model&&typeof P0Core.rangeIsExcluded==='function'&&P0Core.rangeIsExcluded(model,start,end))}
function proofSmileyPunctuation(src,index,ch){
  if(ch!==':'&&ch!==';'&&ch!=='=')return false;
  return /^[:;=][-^']?[)(/\\DPpOo]/.test(src.slice(index,index+4));
}
function proofSmileyParen(src,index,ch){
  if(ch!==')'&&ch!=='(')return false;
  const left=src.slice(Math.max(0,index-3),index);
  const right=src.slice(index+1,index+4);
  if(ch===')'&&/(?:[:;=8xX][-^']?)$/.test(left))return true;
  if(ch==='('&&/(?:[:;=8][-^']?)$/.test(left))return true;
  if(ch==='('&&/^(?:[-^']?[:;=8])/.test(right))return true;
  return false;
}
function proofIssue(issues,ruleId,title,detail,start,end,replacement){
  const issue=addIssue(issues,'proof',title,detail,start,end,'warning');
  if(!issue)return null;
  issue.ruleId=ruleId;
  issue.kind='recommendation';
  issue.confidence=ruleId==='mechanics.mixed-alphabet'?0.72:0.98;
  if(replacement!=null){
    issue.replacement=String(replacement);
    issue.fixes=[{label:'Исправить',replacement:String(replacement)}];
  }
  return issue;
}

function analyzeProofLocalV2(src,issues){
  src=String(src||'');
  const model=proofModel(src);
  let m;

  const double=/[^\n ] {2,}(?=\S)/g;
  while((m=double.exec(src))){
    const st=m.index+1,en=m.index+m[0].length;
    if(proofExcluded(model,st,en))continue;
    proofIssue(issues,'mechanics.multiple-spaces','Несколько пробелов подряд','Оставьте один пробел',st,en,' ');
  }

  const before=/[ \t]+[,:;!?]/g;
  while((m=before.exec(src))){
    const punct=m[0].slice(-1),st=m.index,en=m.index+m[0].length,punctIndex=en-1;
    if(proofExcluded(model,st,en)||proofSmileyPunctuation(src,punctIndex,punct))continue;
    proofIssue(issues,'mechanics.space-before-punctuation','Пробел перед знаком препинания','Перед «'+punct+'» пробел обычно не нужен',st,en,punct);
  }

  const after=/[,:;!?](?=[A-Za-zА-Яа-яЁё])/g;
  while((m=after.exec(src))){
    const st=m.index,en=st+1;
    if(proofExcluded(model,st,en+1)||proofSmileyPunctuation(src,st,m[0]))continue;
    // ?! and similar combinations do not match because the next char is not a letter.
    proofIssue(issues,'mechanics.space-after-punctuation','Нет пробела после знака препинания','Между знаком препинания и следующим словом обычно нужен пробел',st,en,m[0]+' ');
  }

  const repeated=/([!?;,])\1+/g;
  while((m=repeated.exec(src))){
    if(proofExcluded(model,m.index,m.index+m[0].length))continue;
    proofIssue(issues,'mechanics.repeated-punctuation','Повторяющийся знак препинания','Найдено «'+m[0]+'». Сочетание ?! не считается повтором одного знака.',m.index,m.index+m[0].length,m[1]);
  }

  const mixed=/[A-Za-zА-Яа-яЁё]+/g;
  while((m=mixed.exec(src))){
    if(proofExcluded(model,m.index,m.index+m[0].length))continue;
    if(/[A-Za-z]/.test(m[0])&&/[А-Яа-яЁё]/.test(m[0])){
      proofIssue(issues,'mechanics.mixed-alphabet','Смешаны кириллица и латиница','Проверьте слово «'+m[0]+'». Для названий продуктов и технических терминов это может быть допустимо.',m.index,m.index+m[0].length,null);
    }
  }

  const pairs={')':'(',']':'[','}':'{'};
  const openSet=new Set(['(','[','{']);
  const stack=[];
  for(let i=0;i<src.length;i++){
    const ch=src[i];
    if(!openSet.has(ch)&&!Object.prototype.hasOwnProperty.call(pairs,ch))continue;
    if(proofExcluded(model,i,i+1)||proofSmileyParen(src,i,ch))continue;
    if(openSet.has(ch)){stack.push({ch,index:i});continue}
    const expected=pairs[ch],last=stack[stack.length-1];
    if(last&&last.ch===expected){stack.pop();continue}
    proofIssue(issues,'mechanics.unbalanced-bracket','Лишняя закрывающая скобка','Для этой скобки не найдена парная открывающая.',i,i+1,null);
  }
  for(const item of stack){
    proofIssue(issues,'mechanics.unbalanced-bracket','Незакрытая скобка','Для этой скобки не найдена парная закрывающая.',item.index,item.index+1,null);
  }
}

window.analyzeProofLocal=analyzeProofLocalV2;
try{analyzeProofLocal=analyzeProofLocalV2}catch(e){}
})();
