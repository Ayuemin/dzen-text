(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.P0Core=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const WORD_RE=/[A-Za-zА-Яа-яЁё0-9]+(?:[-’'][A-Za-zА-Яа-яЁё0-9]+)*/g;

  function textHash(value){
    const s=String(value==null?'':value);
    let h=2166136261>>>0;
    for(let i=0;i<s.length;i++){
      h^=s.charCodeAt(i);
      h=Math.imul(h,16777619)>>>0;
    }
    return ('00000000'+h.toString(16)).slice(-8)+':'+s.length;
  }

  function words(source){
    const src=String(source||'');
    return Array.from(src.matchAll(WORD_RE),m=>({
      text:m[0],
      lower:m[0].toLocaleLowerCase('ru-RU'),
      start:m.index,
      end:m.index+m[0].length
    }));
  }

  function findRepeatedWords(source){
    const src=String(source||'');
    const tokens=words(src);
    const out=[];
    for(let i=1;i<tokens.length;i++){
      const a=tokens[i-1],b=tokens[i];
      if(a.lower!==b.lower)continue;
      const between=src.slice(a.end,b.start);
      // Adjacent lexical tokens may be separated by whitespace, a line break,
      // or punctuation. If another letter/digit appears, they are not adjacent.
      if(/[A-Za-zА-Яа-яЁё0-9]/.test(between))continue;
      if(between.length>24)continue;
      out.push({
        ruleId:'style.repeated-word',
        start:b.start,
        end:b.end,
        firstStart:a.start,
        firstEnd:a.end,
        fragment:src.slice(b.start,b.end),
        firstFragment:src.slice(a.start,a.end),
        separator:between
      });
    }
    return out;
  }

  function normalizeSnapshot(snapshot){
    const s=snapshot||{};
    return {
      documentId:String(s.documentId||''),
      revision:Math.max(0,Number(s.revision)||0),
      textHash:String(s.textHash||textHash(s.text||'')),
      settingsVersion:String(s.settingsVersion||''),
      rulesVersion:String(s.rulesVersion||'')
    };
  }

  function snapshotMatches(expected,current,options){
    const a=normalizeSnapshot(expected),b=normalizeSnapshot(current);
    const opts=options||{};
    if(!a.documentId||a.documentId!==b.documentId)return false;
    if(a.revision!==b.revision)return false;
    if(a.textHash!==b.textHash)return false;
    if(opts.settings!==false&&a.settingsVersion!==b.settingsVersion)return false;
    if(opts.rules!==false&&a.rulesVersion!==b.rulesVersion)return false;
    return true;
  }

  function validateRange(text,start,end,expected){
    const src=String(text||'');
    const a=Number(start),b=Number(end);
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<a||b>src.length){
      return {ok:false,error:'range'};
    }
    const fragment=src.slice(a,b);
    if(expected!=null&&fragment!==String(expected))return {ok:false,error:'fragment',fragment};
    return {ok:true,fragment};
  }

  function applyEdits(text,edits){
    const src=String(text||'');
    if(!Array.isArray(edits)||!edits.length)return {ok:true,text:src,count:0};
    const prepared=[];
    for(let i=0;i<edits.length;i++){
      const e=edits[i]||{};
      const check=validateRange(src,Number(e.start),Number(e.end),Object.prototype.hasOwnProperty.call(e,'expected')?e.expected:null);
      if(!check.ok)return {ok:false,error:check.error,index:i,text:src,count:0};
      prepared.push({start:Number(e.start),end:Number(e.end),replacement:String(e.replacement==null?'':e.replacement),index:i});
    }
    prepared.sort((a,b)=>b.start-a.start||b.end-a.end);
    for(let i=1;i<prepared.length;i++){
      const right=prepared[i-1],left=prepared[i];
      if(left.end>right.start)return {ok:false,error:'overlap',index:left.index,text:src,count:0};
    }
    let result=src;
    for(const e of prepared)result=result.slice(0,e.start)+e.replacement+result.slice(e.end);
    return {ok:true,text:result,count:prepared.length};
  }

  return {textHash,words,findRepeatedWords,normalizeSnapshot,snapshotMatches,validateRange,applyEdits};
});
