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

  function lineRecords(source){
    const src=String(source||'');
    const out=[];
    let start=0;
    while(start<src.length){
      let nl=src.indexOf('\n',start);
      if(nl<0)nl=src.length;
      let textEnd=nl;
      if(textEnd>start&&src.charCodeAt(textEnd-1)===13)textEnd--;
      const end=nl<src.length?nl+1:nl;
      out.push({start,end,textStart:start,textEnd,text:textEnd>start?src.slice(start,textEnd):''});
      start=end;
    }
    if(src.length===0||src.endsWith('\n'))out.push({start:src.length,end:src.length,textStart:src.length,textEnd:src.length,text:''});
    return out;
  }

  function mergeRanges(ranges){
    const items=(ranges||[]).map(r=>({start:Number(r.start)||0,end:Number(r.end)||0,kind:r.kind||'excluded'}))
      .filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start||a.end-b.end);
    const out=[];
    for(const item of items){
      const last=out[out.length-1];
      if(last&&item.start<=last.end){
        if(item.end>last.end)last.end=item.end;
        if(last.kind!==item.kind)last.kind='mixed';
      }else out.push({...item});
    }
    return out;
  }

  function fenceRanges(source,lines){
    const src=String(source||'');
    const out=[];
    let open=null;
    for(const line of lines){
      const m=line.text.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
      if(!open){
        if(m)open={char:m[1][0],len:m[1].length,start:line.start};
        continue;
      }
      const close=line.text.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
      if(close&&close[1][0]===open.char&&close[1].length>=open.len){
        out.push({start:open.start,end:line.end,kind:'code-block'});
        open=null;
      }
    }
    if(open)out.push({start:open.start,end:src.length,kind:'code-block'});
    return out;
  }

  function rangeContains(ranges,pos){
    for(const r of ranges){
      if(pos<r.start)return false;
      if(pos>=r.start&&pos<r.end)return true;
    }
    return false;
  }

  function collectInlineCode(source,baseExcluded){
    const src=String(source||'');
    const out=[];
    for(let i=0;i<src.length;){
      if(src[i]!=='`'||rangeContains(baseExcluded,i)){i++;continue}
      let run=1;while(i+run<src.length&&src[i+run]==='`')run++;
      const marker='`'.repeat(run);
      let j=src.indexOf(marker,i+run);
      while(j>=0&&rangeContains(baseExcluded,j))j=src.indexOf(marker,j+run);
      if(j<0){i+=run;continue}
      const end=j+run;
      out.push({start:i,end,kind:'inline-code'});
      i=end;
    }
    return out;
  }

  function collectRegexRanges(source,re,group,kind,baseExcluded){
    const src=String(source||'');
    const out=[];
    re.lastIndex=0;
    let m;
    while((m=re.exec(src))){
      const value=group?m[group]:m[0];
      if(!value){if(re.lastIndex===m.index)re.lastIndex++;continue}
      const rel=group?m[0].indexOf(value):0;
      const start=m.index+rel,end=start+value.length;
      if(!rangeContains(baseExcluded,start))out.push({start,end,kind});
      if(re.lastIndex===m.index)re.lastIndex++;
    }
    return out;
  }

  function excludedLanguageRanges(source){
    const src=String(source||'');
    const lines=lineRecords(src);
    const fenced=mergeRanges(fenceRanges(src,lines));
    const inline=collectInlineCode(src,fenced);
    const base=mergeRanges(fenced.concat(inline));
    const links=collectRegexRanges(src,/\[[^\]\n]*\]\(([^)\n]+)\)/g,1,'link-destination',base);
    const urls=collectRegexRanges(src,/(?:https?|ftp):\/\/[^\s<>()\]]+/gi,0,'url',base);
    const win=collectRegexRanges(src,/\b[A-Za-z]:\\(?:[^\\\s<>:"|?*]+\\)*[^\\\s<>:"|?*]+/g,0,'path',base);
    const unix=collectRegexRanges(src,/(?:^|[\s("'])((?:~\/|\/)[A-Za-zА-Яа-яЁё0-9._-]+(?:\/[A-Za-zА-Яа-яЁё0-9._-]+)+)/gm,1,'path',base);
    const relative=collectRegexRanges(src,/\]\(((?:\.\.?\/|[A-Za-zА-Яа-яЁё0-9._-]+\/)[^)\s]+)\)/g,1,'path',base);
    return mergeRanges(base.concat(links,urls,win,unix,relative));
  }

  function blockType(line){
    const text=String(line||'');
    const h=text.match(/^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)/);
    if(h)return {type:'heading',level:h[1].length};
    if(/^[ \t]{0,3}>/.test(text))return {type:'quote'};
    if(/^[ \t]{0,3}(?:[-*+]\s+|\d+[.)]\s+)/.test(text))return {type:'list'};
    return {type:'paragraph'};
  }

  function documentModel(source){
    const src=String(source||'');
    const lines=lineRecords(src);
    const excluded=excludedLanguageRanges(src);
    const blocks=[];
    let i=0;
    while(i<lines.length){
      const line=lines[i];
      if(line.start===line.end&&line.start===src.length){i++;continue}
      if(!line.text.trim()){i++;continue}
      const code=excluded.find(r=>r.kind==='code-block'&&line.start>=r.start&&line.start<r.end);
      if(code){
        if(!blocks.some(b=>b.type==='code'&&b.start===code.start))blocks.push({type:'code',start:code.start,end:code.end,excluded:true});
        while(i<lines.length&&lines[i].start<code.end)i++;
        continue;
      }
      const info=blockType(line.text);
      let start=line.start,end=line.end;
      if(info.type==='paragraph'){
        let j=i+1;
        while(j<lines.length){
          const next=lines[j];
          if(!next.text.trim())break;
          if(excluded.some(r=>r.kind==='code-block'&&next.start>=r.start&&next.start<r.end))break;
          if(blockType(next.text).type!=='paragraph')break;
          end=next.end;j++;
        }
        i=j;
      }else if(info.type==='quote'||info.type==='list'){
        let j=i+1;
        while(j<lines.length&&lines[j].text.trim()&&blockType(lines[j].text).type===info.type){end=lines[j].end;j++}
        i=j;
      }else i++;
      const block={type:info.type,start,end,excluded:false};
      if(info.level)block.level=info.level;
      blocks.push(block);
    }
    return {textLength:src.length,blocks,excluded};
  }

  function analysisSpans(source,model){
    const src=String(source||'');
    const m=model||documentModel(src);
    const out=[];
    for(const block of m.blocks){
      if(block.excluded||block.type==='code')continue;
      let cursor=block.start;
      for(const ex of m.excluded){
        if(ex.end<=block.start)continue;
        if(ex.start>=block.end)break;
        const a=Math.max(block.start,ex.start),b=Math.min(block.end,ex.end);
        if(a>cursor)out.push({start:cursor,end:a,type:block.type,level:block.level||0});
        if(b>cursor)cursor=b;
      }
      if(cursor<block.end)out.push({start:cursor,end:block.end,type:block.type,level:block.level||0});
    }
    return out.filter(s=>/\S/.test(src.slice(s.start,s.end)));
  }

  function languageWords(source,model){
    const src=String(source||'');
    const out=[];
    for(const span of analysisSpans(src,model)){
      for(const token of words(src.slice(span.start,span.end))){
        out.push({...token,start:token.start+span.start,end:token.end+span.start,blockType:span.type,headingLevel:span.level||0});
      }
    }
    return out;
  }

  function rangeIsExcluded(model,start,end){
    const a=Math.max(0,Number(start)||0),b=Math.max(a,Number(end)||a);
    return !!(model&&Array.isArray(model.excluded)&&model.excluded.some(r=>a<r.end&&b>r.start));
  }

  function findRepeatedWords(source){
    const src=String(source||'');
    const model=documentModel(src);
    const tokens=languageWords(src,model);
    const out=[];
    for(let i=1;i<tokens.length;i++){
      const a=tokens[i-1],b=tokens[i];
      if(a.lower!==b.lower)continue;
      const between=src.slice(a.end,b.start);
      if(/[A-Za-zА-Яа-яЁё0-9]/.test(between))continue;
      if(between.length>24)continue;
      if(rangeIsExcluded(model,a.end,b.start))continue;
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

  function publicationParts(value){
    const original=String(value==null?'':value).replace(/^\uFEFF/,'');
    const src=original.replace(/\r\n?/g,'\n');
    const lines=src.split('\n');
    let title='',titleIndex=-1,titleMode='none';
    for(let i=0;i<lines.length;i++){
      const trimmed=lines[i].trim();
      if(!trimmed)continue;
      const h1=trimmed.match(/^#\s+(.+)$/);
      if(h1){title=h1[1].trim();titleIndex=i;titleMode='h1';break}
      if(/^(?:#{2,6}\s|>|```|~~~|[-*+]\s|\d+[.)]\s)/.test(trimmed))break;
      title=trimmed;titleIndex=i;titleMode='plain';
      break;
    }
    if(titleIndex<0)return {title:'',body:src,titleMode:'none'};
    const bodyLines=lines.slice();
    bodyLines.splice(titleIndex,1);
    while(bodyLines.length&&bodyLines[0].trim()==='')bodyLines.shift();
    return {title,body:bodyLines.join('\n'),titleMode};
  }

  function composePublication(title,bodyHtml,bodyPlain,mode){
    const t=String(title||'').trim();
    const html=String(bodyHtml||'').trim();
    const plain=String(bodyPlain||'').trim();
    const kind=mode==='title'||mode==='body'?mode:'all';
    if(kind==='title')return {html:t?'<h1>'+escapeBasicHtml(t)+'</h1>':'',plain:t};
    if(kind==='body')return {html,plain};
    return {
      html:(t?'<h1>'+escapeBasicHtml(t)+'</h1>\n':'')+html,
      plain:(t?t+(plain?'\n\n':''):'')+plain
    };
  }

  function escapeBasicHtml(value){
    return String(value==null?'':value)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  return {
    textHash,words,lineRecords,excludedLanguageRanges,documentModel,analysisSpans,languageWords,rangeIsExcluded,
    findRepeatedWords,normalizeSnapshot,snapshotMatches,validateRange,applyEdits,
    publicationParts,composePublication,escapeBasicHtml
  };
});
