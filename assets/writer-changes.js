(function(root) {
  'use strict';
  // Bound the comparison work for long posts. Common beginnings/endings remain
  // exact; a very large rewritten middle is shown as one replacement.
  function diff(before,after) {
    const tokens=text=>text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) || [];
    const a=tokens(before),b=tokens(after),parts=[];
    const add=(type,text)=>{if(!text)return;if(parts.at(-1)?.type===type)parts.at(-1).text+=text;else parts.push({type,text});};
    let start=0,endA=a.length,endB=b.length;
    while(start<endA && start<endB && a[start]===b[start])start++;
    while(endA>start && endB>start && a[endA-1]===b[endB-1]){endA--;endB--;}
    add('same',a.slice(0,start).join(''));
    const n=endA-start,m=endB-start;
    if(!n || !m || n*m>250000) {add('removed',a.slice(start,endA).join(''));add('added',b.slice(start,endB).join(''));}
    else {
      const rows=Array.from({length:n+1},()=>new Uint32Array(m+1));
      for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)rows[i][j]=a[start+i]===b[start+j]?rows[i+1][j+1]+1:Math.max(rows[i+1][j],rows[i][j+1]);
      let i=0,j=0;
      while(i<n || j<m) {
        if(i<n && j<m && a[start+i]===b[start+j]){add('same',a[start+i]);i++;j++;}
        else if(i<n && (j===m || rows[i+1][j]>=rows[i][j+1]))add('removed',a[start+i++]);
        else add('added',b[start+j++]);
      }
    }
    add('same',a.slice(endA).join(''));return parts;
  }
  // Include visible paragraph and line breaks, retaining DOM offsets for paint.
  function textMap(element) {
    let text='';const nodes=[];
    const newline=()=>{if(text && !text.endsWith('\n'))text+='\n';};
    function walk(node) {
      if(node.nodeType===3){
        if(!node.data.trim() && node.parentNode===element && element.querySelector('p,div,li,h1,h2,h3,blockquote'))return;
        nodes.push({node,start:text.length,end:text.length+node.length});text+=node.data;return;
      }
      if(node.nodeType!==1)return;
      if(node.tagName==='BR'){text+='\n';return;}
      const block=/^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(node.tagName);
      if(block)newline();for(const child of node.childNodes)walk(child);if(block)newline();
    }
    for(const child of element.childNodes)walk(child);
    return {text:text.replace(/\n$/,''),nodes};
  }
  function ranges(map,parts) {
    const result=[];let offset=0;
    for(const part of parts) {
      if(part.type==='removed')continue;
      const end=offset+part.text.length;
      if(part.type==='added')for(const item of map.nodes) {
        const from=Math.max(offset,item.start),to=Math.min(end,item.end);
        if(from<to){const range=document.createRange();range.setStart(item.node,from-item.start);range.setEnd(item.node,to-item.start);result.push(range);}
      }
      offset=end;
    }
    return result;
  }
  function update(draft,original) {
    const panel=document.getElementById('edit-changes');
    if(!panel)return;
    const highlights=root.CSS?.highlights;
    highlights?.delete('writing-added');
    if(!draft || !original){panel.hidden=true;panel.open=false;panel.removeAttribute('data-draft');return;}
    if(panel.dataset.draft!==draft.id)panel.open=false;
    panel.dataset.draft=draft.id;
    const core=root.BlogWriter,fragment=document.createDocumentFragment(),paint=[];
    let count=0;
    const fromHTML=html=>{const el=document.createElement('div');el.innerHTML=html;return el;};
    function section(label,before,after,target,beforeHTML,afterHTML) {
      const parts=diff(before,after),textChanged=parts.some(p=>p.type!=='same');
      if(!textChanged && beforeHTML===afterHTML)return;
      count++;
      const heading=document.createElement('h3');heading.textContent=label;fragment.append(heading);
      if(textChanged) {
        const content=document.createElement('p');content.className='change-text';
        parts.forEach((part,i)=>{
          const node=document.createElement(part.type==='added'?'ins':part.type==='removed'?'del':'span');
          let text=part.text;
          if(part.type==='same' && text.length>160)text=i===0?'…'+text.slice(-80):i===parts.length-1?text.slice(0,80)+'…':text.slice(0,60)+' … '+text.slice(-60);
          node.textContent=text;content.append(node);
        });fragment.append(content);
        if(target)paint.push(...ranges(textMap(target),parts));
      }
      // Show actual formatting/link changes even when their visible words match.
      if(beforeHTML!==afterHTML && !textChanged) {
        const note=document.createElement('p');note.textContent='Formatting, layout or links changed.';fragment.append(note);
        for(const [name,html] of [['Published',beforeHTML],['Edited',afterHTML]]) {
          const label=document.createElement('p');label.className='change-version';label.textContent=name;
          const preview=fromHTML(html);preview.className='change-format-preview';
          preview.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
          preview.querySelectorAll('a').forEach(el=>{const url=el.getAttribute('href');if(url && !url.startsWith('#'))el.append(document.createTextNode(' ('+url+')'));else if(el.title)el.append(document.createTextNode(' ('+el.title+')'));});
          fragment.append(label,preview);
        }
      }
    }
    for(const [id,label] of [['title','Title'],['quote','Opening quote']])section(label,original[id] || '',document.getElementById(id).textContent,document.getElementById(id));
    const bodyHTML=d=>core.render(d.doc,core.usedReferences(d),'comparison',d.notes);
    const oldBody=bodyHTML(original),newBody=bodyHTML(draft),body=document.getElementById('body');
    section('Text',textMap(fromHTML(oldBody)).text,textMap(body).text,body,oldBody,newBody);
    for(const [label,render] of [
      ['References',d=>core.renderReferences(core.usedReferences(d),'comparison')],
      ['Notes',d=>core.renderNotes(d.doc,d.notes,'comparison',core.usedReferences(d))]
    ]) {
      const before=render(original),after=render(draft);
      section(label,textMap(fromHTML(before)).text,textMap(fromHTML(after)).text,null,before,after);
    }
    const quoteSource=d=>{const source=d.quote?.trim() && core.usedReferences(d).find(r=>r.id===d.quoteReference);return source?[source.title,d.quoteLocator,source.url].filter(Boolean).join(' · '):'';};
    section('Quote source',quoteSource(original),quoteSource(draft));
    panel.hidden=!count;
    if(count) {
      const list=document.getElementById('edit-change-list'),preview=document.createElement('div');preview.append(fragment);
      if(list.innerHTML!==preview.innerHTML){const scroll=list.scrollTop;list.replaceChildren(...preview.childNodes);list.scrollTop=scroll;}
      if(highlights && root.Highlight)highlights.set('writing-added',new Highlight(...paint));
    }else panel.open=false;
  }
  const api={diff,textMap,update};root.BlogWritingChanges=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
