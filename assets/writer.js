(() => {
  'use strict';
  const $=id=>document.getElementById(id), core=BlogWriter;
  const key='jiaqi-writing-desk-v1', backupKey=key+'-backup';
  let drafts=[], active, published=[], selectionRange=null, saveFailed=false;
  const newDraft=()=>({id:crypto.randomUUID(),kind:'post',title:'',quote:'',doc:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  function acceptDraft(d) {
    return d && typeof d.id==='string' && typeof d.title==='string' && typeof d.quote==='string' && ['post','page'].includes(d.kind) && (core.validDocument(d.doc) || typeof d.body==='string');
  }
  function restore(value) {
    if(!value || !Array.isArray(value.drafts) || !value.drafts.every(acceptDraft)) throw new Error('Invalid draft backup.');
    drafts=value.drafts.map(d=>({...d,doc:d.doc || core.plainDocument(d.body)})); active=value.active;
  }
  try {
    const saved=localStorage.getItem(key);
    if(saved) { try { restore(JSON.parse(saved)); } catch { restore(JSON.parse(localStorage.getItem(backupKey))); } }
  } catch { $('index-status').textContent='Could not read stored drafts. Restore a backup if needed.'; saveFailed=true; }
  if(!drafts.length) drafts.push(newDraft());
  if(!drafts.some(d=>d.id===active)) active=drafts[0].id;
  const current=()=>drafts.find(d=>d.id===active);
  function readDocument(container) {
    const blocks=[]; let runs=[];
    const flush=()=>{if(runs.length){blocks.push({runs});runs=[];}};
    function walk(node,marks={}) {
      if(node.nodeType===Node.TEXT_NODE) {
        if(node.parentNode===container && !node.textContent.trim()) return;
        if(node.textContent) runs.push({text:node.textContent,...marks}); return;
      }
      if(node.nodeType!==Node.ELEMENT_NODE) return;
      const tag=node.tagName.toLowerCase();
      if(node.hasAttribute('data-references')) return;
      if(node.dataset.reference) {
        const citation={reference:node.dataset.reference,locator:node.dataset.locator || ''};
        if(runs.at(-1)?.quoted) Object.assign(runs.at(-1),citation);
        else runs.push({text:'',...citation});
        return;
      }
      if(tag==='q') {runs.push({text:node.textContent,quoted:true});return;}
      if(['script','style','iframe','object','svg','math','img','video','audio'].includes(tag)) return;
      if(tag==='br') { runs.push({text:'\n',...marks});return; }
      const block=['p','div','li','h1','h2','h3','blockquote'].includes(tag);
      if(block) flush();
      const next={...marks};
      if(tag==='a' && core.safeURL(node.getAttribute('href'))) next.link=node.getAttribute('href');
      if(['b','strong'].includes(tag) || (node.style.fontWeight==='bold' || Number(node.style.fontWeight)>=600)) next.bold=true;
      if(['i','em'].includes(tag) || node.style.fontStyle==='italic') next.italic=true;
      if(tag==='u' || node.style.textDecoration.includes('underline')) next.underline=true;
      const before=blocks.length;
      node.childNodes.forEach(child=>walk(child,next));
      if(block) {flush(); if(blocks.length===before) blocks.push({runs:[{text:''}]});}
    }
    container.childNodes.forEach(child=>walk(child)); flush(); return blocks;
  }
  function save() {
    if(saveFailed) { $('save-status').textContent='Autosave unavailable. Use Backup drafts before closing.'; return; }
    try {
      const previous=localStorage.getItem(key);
      if(previous) localStorage.setItem(backupKey,previous);
      localStorage.setItem(key,JSON.stringify({version:2,drafts,active}));
      $('save-status').textContent='Saved on this device'+(current().updatedAt?' · '+new Date(current().updatedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'');
    } catch { $('save-status').textContent='Could not save. Use Backup drafts before closing.'; }
  }
  function renderNav() {
    const nav=$('writing-nav'); nav.replaceChildren();
    function heading(text) {const el=document.createElement('span');el.className='nav-date';el.textContent=text;nav.append(el);}
    function item(title,id,click,label) {
      const b=document.createElement('button');b.type='button';b.textContent=title || 'Untitled draft';
      if(id===active) b.setAttribute('aria-current','page');
      if(label) {const small=document.createElement('span');small.className='draft-label';small.textContent=label;b.append(small);}
      b.addEventListener('click',click);nav.append(b);
    }
    heading('Drafts');
    drafts.forEach(d=>item(d.title,d.id,()=>{active=d.id;load();save();},d.kind==='page'?'Reference page'+(d.sourcePath?' · Unpublished edits':' · Draft'):d.sourcePath?'Unpublished edits':null));
    if(published.length) heading('Published');
    published.forEach(entry=>item(entry.title,entry.path,()=>openPublished(entry),entry.kind==='page'?'Reference page':null));
  }
  function timestamp(entry) {
    if(!entry.publishedAt) {$('post-time').textContent='Publication time is added automatically.';return;}
    const format=s=>{const d=new Date(s);return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'long',year:'numeric'}).format(d)+' · '+new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(d);};
    $('post-time').textContent=format(entry.publishedAt)+(entry.editedAt?' · Edited '+format(entry.editedAt):'');
  }
  function empties() {for(const id of ['title','quote','body']) $(id).dataset.empty=String(!$(id).textContent.trim());}
  function load() {
    const d=current();$('title').textContent=d.title;$('quote').textContent=d.quote;
    $('body').innerHTML=core.render(d.doc,d.references,core.referenceKey(d));$('quote').hidden=!d.quote.trim();$('kind').value=d.kind;$('kind').disabled=!!d.sourcePath || !!d.targetPath;
    $('publish-panel').hidden=true;selectionRange=null;timestamp(d);empties();renderNav();
    renderReferencePreview();
  }
  function changed() {
    const d=current();d.title=$('title').textContent;d.quote=$('quote').textContent;d.doc=readDocument($('body'));d.kind=$('kind').value;d.updatedAt=new Date().toISOString();
    $('publish-panel').hidden=true;empties();renderNav();renderReferencePreview();save();
  }
  for(const id of ['title','quote','body']) $(id).addEventListener('input',changed);
  for(const id of ['title','quote']) $(id).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('body').focus();}});
  $('kind').addEventListener('change',changed);
  $('add-quote').addEventListener('click',()=>{$('quote').hidden=false;$('quote-block').hidden=false;$('quote-source').hidden=false;$('quote').focus();});
  $('quote').addEventListener('blur',()=>{if(!$('quote').textContent.trim()){$('quote').hidden=true;$('quote-block').hidden=true;}});
  $('body').addEventListener('paste',e=>{
    e.preventDefault(); const html=e.clipboardData.getData('text/html'); let doc;
    if(html) {const template=document.createElement('template');template.innerHTML=html;doc=readDocument(template.content);}
    else doc=core.plainDocument(e.clipboardData.getData('text/plain'));
    doc.forEach(b=>b.runs.forEach(r=>{delete r.reference;delete r.locator;delete r.quoted;}));
    document.execCommand('insertHTML',false,core.render(doc));changed();
  });
  $('body').addEventListener('drop',e=>e.preventDefault());
  document.execCommand('defaultParagraphSeparator',false,'p');
  document.execCommand('styleWithCSS',false,false);
  document.addEventListener('selectionchange',()=>{
    const s=window.getSelection();
    if(s.rangeCount && $('body').contains(s.anchorNode) && $('body').contains(s.focusNode)) {
      selectionRange=s.getRangeAt(0).cloneRange();
      document.querySelectorAll('[data-command]').forEach(b=>b.setAttribute('aria-pressed',String(document.queryCommandState(b.dataset.command))));
    }
  });
  document.querySelectorAll('[data-command]').forEach(button=>{
    button.addEventListener('mousedown',e=>e.preventDefault());
    button.addEventListener('click',()=>{
      $('body').focus();
      if(selectionRange && $('body').contains(selectionRange.commonAncestorContainer)) {const s=window.getSelection();s.removeAllRanges();s.addRange(selectionRange);}
      document.execCommand(button.dataset.command,false,null);changed();
    });
  });
  $('new-draft').addEventListener('click',()=>{const d=newDraft();drafts.unshift(d);active=d.id;load();save();$('title').focus();});
  function openPublished(entry) {
    const existing=drafts.find(d=>d.sourcePath===entry.path);
    if(existing) active=existing.id;
    else {
      const template=document.createElement('template');template.innerHTML=entry.html;
      const d={...newDraft(),title:entry.title,quote:entry.quote || '',kind:entry.kind,doc:readDocument(template.content),references:entry.references || [],referenceKey:entry.referenceKey,quoteReference:entry.quoteReference,quoteLocator:entry.quoteLocator,sourcePath:entry.path,originalDate:entry.date,permalink:entry.permalink,publishedAt:entry.publishedAt,editedAt:entry.editedAt};
      drafts.unshift(d);active=d.id;
    }
    load();save();
  }
  $('publish').addEventListener('click',()=>{
    try {
      changed();const d=current(), post=core.prepare(d);d.targetPath=post.filename;
      const existing=published.find(p=>p.path===post.filename);if(existing) {d.sourcePath=existing.path;d.originalDate=existing.date;d.permalink=existing.permalink;}
      const prepared=core.prepare(d);$('filename').value=prepared.filename;$('prepared').value=prepared.content;$('github-publish').href=prepared.url;$('copy-status').textContent='';$('publish-panel').hidden=false;save();$('publish-panel').scrollIntoView({block:'start'});
    } catch(e) {$('save-status').textContent=e.message;}
  });
  let referenceTarget='body', referenceRange=null;
  function renderReferencePreview() {
    const d=current(), refs=d.references || [], key=core.referenceKey(d);
    $('reference-preview').innerHTML=core.renderReferences(refs,key);
    $('quote-source').hidden=!d.quote.trim();
    $('quote-block').hidden=!d.quote.trim();
    $('quote-citation').innerHTML=d.quoteReference?core.citation(d.quoteReference,refs,key,d.quoteLocator || ''):'';
    $('cite-quote').textContent=d.quoteReference?'Edit quote source':'Choose quote source';
    $('reference-preview').querySelectorAll('li').forEach((li,i)=>{
      const button=document.createElement('button');button.type='button';button.className='edit-reference';button.textContent='Edit source';
      button.addEventListener('click',()=>openReference('edit',refs[i].id));li.append(button);
    });
  }
  function fillReference(r={}) {
    for(const [field,name] of [['title','title'],['url','url'],['author','author'],['details','details'],['saved','savedUrl'],['note','note']]) $('reference-'+field).value=r[name] || '';
  }
  function openReference(target='body',id='') {
    referenceTarget=target;referenceRange=selectionRange?.cloneRange();
    const d=current(), refs=d.references || [];
    $('reference-form').reset();$('reference-error').textContent='';
    $('reference-existing').replaceChildren(new Option('New source',''),...refs.map(r=>new Option(r.title,r.id)));
    $('reference-page').replaceChildren(new Option('Choose a page (optional)',''),...published.filter(p=>p.kind==='page').map(p=>new Option(p.title,p.url)));
    $('reference-existing').value=id || (target==='quote'?d.quoteReference || '':'');
    fillReference(refs.find(r=>r.id===$('reference-existing').value));
    $('reference-locator').value=target==='quote'?d.quoteLocator || '':'';
    $('reference-quoted').parentElement.hidden=target!=='body';
    $('reference-quoted').disabled=!referenceRange || referenceRange.collapsed;
    $('reference-form').querySelector('[type=submit]').textContent=target==='edit'?'Save source':target==='quote'?'Use for quote':'Insert reference';
    $('reference-heading').textContent=target==='quote'?'Quote source':target==='edit'?'Edit source':'Add a reference';
    $('reference-dialog').showModal();
  }
  $('add-reference').addEventListener('click',()=>openReference());
  $('cite-quote').addEventListener('click',()=>openReference('quote'));
  $('reference-cancel').addEventListener('click',()=>$('reference-dialog').close());
  $('reference-existing').addEventListener('change',()=>fillReference((current().references || []).find(r=>r.id===$('reference-existing').value)));
  $('reference-page').addEventListener('change',()=>{
    const page=published.find(p=>p.url===$('reference-page').value);
    if(page){$('reference-existing').value='';fillReference({title:page.title,url:page.url});}
  });
  $('new-reference-page').addEventListener('click',()=>{
    changed();const d={...newDraft(),kind:'page'};drafts.unshift(d);active=d.id;$('reference-dialog').close();load();save();$('title').focus();
  });
  $('reference-form').addEventListener('submit',e=>{
    e.preventDefault();const d=current();
    const r={id:$('reference-existing').value || crypto.randomUUID()};
    for(const [field,name] of [['title','title'],['url','url'],['author','author'],['details','details'],['saved','savedUrl'],['note','note']]) r[name]=$('reference-'+field).value.trim();
    if(!r.title || !core.safeURL(r.url) || (r.savedUrl && !core.safeURL(r.savedUrl))) {$('reference-error').textContent='Add a title and a valid https:// URL or site path.';return;}
    d.references ||= [];const i=d.references.findIndex(ref=>ref.id===r.id);if(i<0)d.references.push(r);else d.references[i]=r;
    const locator=$('reference-locator').value.trim();
    if(referenceTarget==='quote') {d.quoteReference=r.id;d.quoteLocator=locator;}
    $('reference-dialog').close();
    if(referenceTarget==='body') {
      $('body').focus();const selection=window.getSelection();
      if(referenceRange && $('body').contains(referenceRange.commonAncestorContainer)) {selection.removeAllRanges();selection.addRange(referenceRange);}
      else {const range=document.createRange();range.selectNodeContents($('body'));range.collapse(false);selection.removeAllRanges();selection.addRange(range);}
      const quoted=$('reference-quoted').checked, text=quoted?selection.toString():'';
      if(!quoted)selection.collapseToEnd();
      const html=(quoted?'<q>'+core.escapeHTML(text)+'</q>':'')+core.citation(r.id,d.references,core.referenceKey(d),locator)+'&nbsp;';
      document.execCommand('insertHTML',false,html);
    }
    changed();
  });
  $('copy').addEventListener('click',async()=>{
    try {await navigator.clipboard.writeText($('prepared').value);$('copy-status').textContent='Copied. Open GitHub and paste.';}
    catch {$('prepared').parentElement.open=true;$('prepared').focus();$('prepared').select();$('copy-status').textContent='Press Ctrl+C to copy the selected post.';}
  });
  $('download').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify({version:2,drafts,active},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='blog-drafts-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $('restore').addEventListener('click',()=>$('restore-file').click());
  $('restore-file').addEventListener('change',async()=>{
    const file=$('restore-file').files[0];if(!file)return;
    try {
      if(file.size>10000000)throw new Error('Backup is too large.');
      const data=JSON.parse(await file.text());if(!data || !Array.isArray(data.drafts) || !data.drafts.every(acceptDraft))throw new Error('Invalid backup.');
      for(const incoming of data.drafts) {
        const same=drafts.find(d=>d.id===incoming.id);
        if(same && JSON.stringify(same)===JSON.stringify(incoming))continue;
        drafts.push({...incoming,id:same?crypto.randomUUID():incoming.id,doc:incoming.doc || core.plainDocument(incoming.body)});
      }
      saveFailed=false;renderNav();save();$('index-status').textContent='Backup restored. Existing drafts kept.';
    }catch(e){$('index-status').textContent=e.message;}finally{$('restore-file').value='';}
  });
  load();save();
  fetch(document.body.dataset.index,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{
    published=[...(data.posts || []),...(data.pages || [])];renderNav();
  }).catch(()=>{$('index-status').textContent='Published posts could not load. Your saved drafts are still available.';});
})();
