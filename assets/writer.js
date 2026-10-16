(() => {
  'use strict';
  const $=id=>document.getElementById(id), core=BlogWriter;
  const key='jiaqi-writing-desk-v1', backupKey=key+'-backup';
  let drafts=[], active, published=[], selectionRange=null, saveFailed=false;
  const newDraft=()=>({id:crypto.randomUUID(),kind:'post',title:'',quote:'',doc:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  function acceptDraft(d) {
    return d && typeof d.id==='string' && typeof d.title==='string' && typeof d.quote==='string' && ['post','page'].includes(d.kind) && core.validNotes(d.notes || []) && (core.validDocument(d.doc) || typeof d.body==='string');
  }
  function restore(value) {
    if(!value || !Array.isArray(value.drafts) || !value.drafts.every(acceptDraft)) throw new Error('Invalid draft backup.');
    drafts=value.drafts.map(d=>({...d,doc:d.doc || core.plainDocument(d.body)})); active=value.active;
  }
  try {
    const saved=localStorage.getItem(key);
    if(saved) { try { restore(JSON.parse(saved)); } catch { restore(JSON.parse(localStorage.getItem(backupKey))); } }
  } catch { $('index-status').textContent='Could not read stored drafts. Use Import JSON if needed.'; saveFailed=true; }
  if(!drafts.length) drafts.push(newDraft());
  if(!drafts.some(d=>d.id===active)) active=drafts[0].id;
  const current=()=>drafts.find(d=>d.id===active);
  const privateOrigin='https://yoga-jiaqi.taile0df21.ts.net:8446';
  const isPrivate=document.body.dataset.privateDesk==='true';
  let publishing=false, authPolling=false, pendingPublishId=null;
  const removedPaths=new Set();
  function connectionStatus(connected) {
    $('connect-github').dataset.connected=String(connected);
    const label=isPrivate?(connected?'GitHub connected':'GitHub disconnected — click to connect'):'Open private writing desk';
    $('connect-github').setAttribute('aria-label',label);$('connect-github').title=label;
  }
  async function api(path,body) {
    const response=await fetch(path,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const data=await response.json();
    if(!response.ok){const error=new Error(data.error || 'The server could not complete the request.');error.status=response.status;throw error;}
    return data;
  }
  function publicationStatus(text,heading='Publish') {
    $('publish-panel').hidden=false;$('publish-heading').textContent=heading;$('publication-status').textContent=text;
  }
  function handoff(shouldPublish) {
    changed();
    const desk=window.open(privateOrigin+'/write/?import=1','jiaqi-private-writer');
    if(!desk){publicationStatus('Allow this site to open the private writing desk, then click Publish again.');return;}
    publicationStatus('Opening your private desk on Yoga. Tailscale must be connected. Your drafts remain saved here.');
    const transfer={version:2,drafts,active};
    function receive(event) {
      if(event.origin!==privateOrigin || event.source!==desk)return;
      if(event.data?.type==='blog-desk-ready')desk.postMessage({type:'blog-desk-import',data:transfer,publish:shouldPublish},privateOrigin);
      if(event.data?.type==='blog-desk-imported'){window.removeEventListener('message',receive);publicationStatus('Drafts transferred. Continue in the private writing desk on Yoga.');}
    }
    window.addEventListener('message',receive);setTimeout(()=>window.removeEventListener('message',receive),120000);
  }
  async function connectGitHub() {
    if(!isPrivate){handoff(false);return;}
    if(authPolling)return;
    authPolling=true;$('connect-github').disabled=true;
    try {
      const session=await api('/api/session');
      connectionStatus(session.connected);
      if(session.connected){publicationStatus('Connected as '+session.login+'. Click Publish to send your post.');return;}
      await api('/api/auth/start',{});
      publicationStatus('Preparing GitHub sign-in…','Connect GitHub');
      for(let attempt=0;attempt<300;attempt++) {
        await new Promise(resolve=>setTimeout(resolve,3000));
        const state=await api('/api/session');
        if(state.connected) {
          $('github-login').hidden=true;connectionStatus(true);
          publicationStatus('Connected as '+state.login+'. Yoga will remember this connection.');
          const pending=pendingPublishId;pendingPublishId=null;
          if(pending && active===pending)await publishCurrent();
          return;
        }
        if(state.code){$('github-code').textContent=state.code;$('github-login').hidden=false;publicationStatus('Finish sign-in on GitHub, then return here.','Connect GitHub');}
        if(state.error)throw new Error(state.error);
      }
      throw new Error('Sign-in timed out. Click Connect GitHub to try again.');
    }catch(error){connectionStatus(false);publicationStatus(error.message,'Connection needed');}
    finally{authPolling=false;$('connect-github').disabled=false;}
  }
  async function watchDeployment(commit,title,removed=false) {
    for(let attempt=0;attempt<36;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,5000));
      try {
        const result=await api('/api/deployment?commit='+encodeURIComponent(commit));
        if(result.status==='completed') {
          publicationStatus(result.conclusion==='success'?'“'+title+'” '+(removed?'has been removed from the public blog.':'is live.'):result.conclusion==='cancelled'?'Saved to GitHub. A newer site update replaced this build.':'Saved to GitHub, but the site build failed. Your writing is safe in GitHub.',result.conclusion==='success'?(removed?'Deleted':'Published'):'Saved to GitHub');
          if(result.conclusion==='success')refreshIndex();
          return;
        }
      }catch{publicationStatus('Saved to GitHub. Deployment status is unavailable; the site may still be updating.','Saved to GitHub');return;}
    }
    publicationStatus('Saved to GitHub. The site is still updating; check the blog shortly.','Saved to GitHub');
  }
  async function publishCurrent() {
    if(publishing)return;
    let publishingDraft;
    try {
      changed();const d=current();publishingDraft=d;core.prepare(d);
      if(!isPrivate){handoff(true);return;}
      publishing=true;$('publish').disabled=true;$('publish').textContent='Publishing…';$('view-published').hidden=true;
      const session=await api('/api/session');
      connectionStatus(session.connected);
      if(!session.connected){pendingPublishId=d.id;publishing=false;$('publish').disabled=false;$('publish').textContent='Publish';await connectGitHub();return;}
      // Keep the exact request for a safe retry if the response is lost.
      const fingerprint=JSON.stringify([d.title,d.quote,d.doc,d.kind,d.references,d.quoteReference,d.quoteLocator,d.notes]);
      if(!d.pendingPublication || d.pendingPublication.fingerprint!==fingerprint) {
        const prepared=core.prepare(d);d.targetPath=prepared.filename;
        d.pendingPublication={fingerprint,path:prepared.filename,content:prepared.content};
      }
      save();publicationStatus('Sending “'+d.title+'” to GitHub…');
      const prepared=d.pendingPublication;
      const originalDate=d.kind==='post'?JSON.parse(prepared.content.match(/^date: (.+)$/m)[1]):null;
      const permalink=d.kind==='page'?JSON.parse(prepared.content.match(/^permalink: (.+)$/m)[1]):null;
      const result=await api('/api/publish',{path:prepared.path,content:prepared.content,baseSha:d.sourceSha || null});
      const wasPublished=!!d.sourcePath;
      d.sourcePath=prepared.path;d.sourceSha=result.sha;
      removedPaths.delete(prepared.path);
      if(d.kind==='post')d.originalDate=originalDate;
      else d.permalink=permalink;
      if(!result.unchanged){if(wasPublished)d.editedAt=result.time;else d.publishedAt=result.time;}
      delete d.pendingPublication;save();renderNav();if(current()===d){timestamp(d);$('kind').disabled=true;updateDeleteButton();}
      const slug=prepared.path.split('/').pop().replace(/^\d{4}-\d{2}-\d{2}-/,'').replace(/\.md$/,'');
      $('view-published').href='https://sjaakiechen.github.io/personal-blog'+(d.kind==='page'?d.permalink:'/posts/'+slug+'/');$('view-published').hidden=false;
      publicationStatus(result.unchanged?'This version is already saved on GitHub.':'Saved to GitHub. The blog is updating…','Saved to GitHub');
      if(result.commit)watchDeployment(result.commit,d.title);
    }catch(error){if(error.status===409 && publishingDraft){publishingDraft.conflict=true;save();refreshIndex();}publicationStatus(error.message || 'Publishing failed. Your draft is still saved.','Not published');}
    finally{publishing=false;$('publish').disabled=false;$('publish').textContent='Publish';updateDeleteButton();}
  }
  function updateDeleteButton() {
    $('delete-draft').disabled=publishing;
    $('delete-post').hidden=!isPrivate || !current().sourcePath;
    $('delete-post').disabled=publishing || !current().sourceSha;
    $('delete-post').textContent=current().kind==='page'?'Delete page':'Delete post';
  }
  let deletionTarget=null;
  $('delete-draft').addEventListener('click',()=>{
    if(publishing)return;
    changed();const d=current();deletionTarget={id:d.id,draftOnly:true};
    $('delete-heading').textContent='Delete draft?';
    $('delete-description').textContent='Delete “'+(d.title || 'Untitled draft')+'” from this device?';
    $('delete-detail').textContent='This removes the local draft and any unpublished edits. A published version, if any, stays on the blog.';
    $('confirm-delete').textContent='Delete draft';
    $('delete-dialog').showModal();
  });
  $('delete-post').addEventListener('click',()=>{
    if(publishing || !current().sourcePath || !current().sourceSha)return;
    changed();const d=current();deletionTarget={id:d.id,path:d.sourcePath,sha:d.sourceSha,title:d.title};
    $('delete-heading').textContent=d.kind==='page'?'Delete reference page?':'Delete published post?';
    $('delete-description').textContent='Remove “'+d.title+'” from the public blog?'+(d.kind==='page'?' Existing references to this page will stop working.':'');
    $('delete-detail').textContent='A copy stays in your drafts. The public blog updates after deployment; the original also remains recoverable from GitHub history.';
    $('confirm-delete').textContent='Delete from blog';
    $('delete-dialog').showModal();
  });
  $('cancel-delete').addEventListener('click',()=>$('delete-dialog').close());
  $('confirm-delete').addEventListener('click',async()=>{
    if(publishing || !deletionTarget)return;
    const target=deletionTarget;deletionTarget=null;$('delete-dialog').close();
    if(target.draftOnly){
      const remaining=drafts.filter(d=>d.id!==target.id);
      if(!remaining.length)remaining.push(newDraft());
      const nextActive=remaining.some(d=>d.id===active)?active:remaining[0].id;
      try {
        if(saveFailed)throw new Error('Draft storage is unavailable.');
        const previous=localStorage.getItem(key);
        if(previous)localStorage.setItem(backupKey,previous);
        localStorage.setItem(key,JSON.stringify({version:2,drafts:remaining,active:nextActive}));
      }catch{
        $('save-status').textContent='Could not save the deletion. Your draft has been kept. Use Save JSON before closing.';
        return;
      }
      drafts=remaining;active=nextActive;
      if(pendingPublishId===target.id)pendingPublishId=null;
      load();$('save-status').textContent='Draft deleted from this device.';
      return;
    }
    publishing=true;$('publish').disabled=true;updateDeleteButton();$('view-published').hidden=true;
    try {
      publicationStatus('Removing “'+target.title+'” from GitHub…','Deleting');
      const result=await api('/api/delete',{path:target.path,baseSha:target.sha});
      removedPaths.add(target.path);published=published.filter(p=>p.path!==target.path);
      for(const d of drafts)if(d.sourcePath===target.path){d.targetPath=target.path;delete d.sourcePath;delete d.sourceSha;delete d.publishedAt;delete d.editedAt;delete d.pendingPublication;delete d.conflict;}
      save();renderNav();timestamp(current());
      publicationStatus(result.alreadyRemoved?'Already removed from GitHub. A copy remains in your drafts.':'Removed from GitHub. A copy remains in your drafts; the public blog is updating…','Deleted from GitHub');
      if(result.commit)watchDeployment(result.commit,target.title,true);
    }catch(error){
      if(error.status===409){const d=drafts.find(d=>d.id===target.id);if(d)d.conflict=true;save();refreshIndex();}
      if(error.status===401)connectionStatus(false);
      publicationStatus(error.message,'Deletion not confirmed');
    }finally{publishing=false;$('publish').disabled=false;updateDeleteButton();}
  });
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
      if(node.hasAttribute('data-references') || node.hasAttribute('data-notes')) return;
      if(node.dataset.note) {runs.push({text:'',note:node.dataset.note});return;}
      if(node.dataset.reference) {
        const citation={reference:node.dataset.reference,locator:node.dataset.locator || ''};
        if(node.dataset.label){citation.label=node.dataset.label;citation.labelStyle=node.dataset.labelStyle==='small'?'small':'normal';}
        if(!citation.label && runs.at(-1)?.quoted) Object.assign(runs.at(-1),citation);
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
    if(saveFailed) { $('save-status').textContent='Autosave unavailable. Use Save JSON before closing.'; return; }
    try {
      const previous=localStorage.getItem(key);
      if(previous) localStorage.setItem(backupKey,previous);
      localStorage.setItem(key,JSON.stringify({version:2,drafts,active}));
      $('save-status').textContent='Saved on this device'+(current().updatedAt?' · '+new Date(current().updatedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'');
    } catch { $('save-status').textContent='Could not save. Use Save JSON before closing.'; }
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
    const format=s=>{const d=new Date(s);return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'long',year:'numeric'}).format(d);};
    $('post-time').textContent=format(entry.publishedAt)+(entry.editedAt?' · Edited '+format(entry.editedAt):'');
  }
  function empties() {for(const id of ['title','quote','body']) $(id).dataset.empty=String(!$(id).textContent.trim());}
  function load() {
    const d=current();$('title').textContent=d.title;$('quote').textContent=d.quote;
    $('body').innerHTML=core.render(d.doc,d.references,core.referenceKey(d),d.notes);$('kind').value=d.kind;$('kind').disabled=!!d.sourcePath || !!d.targetPath;
    $('publish-panel').hidden=true;$('view-published').hidden=true;selectionRange=null;timestamp(d);empties();renderNav();
    renderReferencePreview();
    updateDeleteButton();
  }
  function changed() {
    const d=current();d.title=$('title').textContent;d.quote=$('quote').textContent;d.doc=readDocument($('body'));d.kind=$('kind').value;d.updatedAt=new Date().toISOString();
    $('publish-panel').hidden=true;empties();renderNav();renderReferencePreview();save();
  }
  function resetTypingFormat() {
    // At the new caret position, change typing state without touching the previous line.
    for(const command of ['underline','italic','bold']) {
      if(document.queryCommandState(command)) document.execCommand(command,false,null);
      document.querySelector('[data-command="'+command+'"]').setAttribute('aria-pressed','false');
    }
  }
  $('body').addEventListener('beforeinput',event=>{
    if(!['insertParagraph','insertLineBreak'].includes(event.inputType) || !event.cancelable) return;
    event.preventDefault();
    document.execCommand(event.inputType,false,null);
    resetTypingFormat();
    changed();
  });
  const toolbar=document.querySelector('.editor-tools');
  new ResizeObserver(()=>{
    $('writing-main').style.scrollPaddingTop=(toolbar.offsetHeight+16)+'px';
  }).observe(toolbar);
  for(const id of ['title','quote','body']) $(id).addEventListener('input',changed);
  for(const id of ['title','quote']) $(id).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('body').focus();}});
  $('kind').addEventListener('change',changed);
  $('body').addEventListener('paste',e=>{
    e.preventDefault(); const html=e.clipboardData.getData('text/html'); let doc;
    if(html) {const template=document.createElement('template');template.innerHTML=html;doc=readDocument(template.content);}
    else doc=core.plainDocument(e.clipboardData.getData('text/plain'));
    doc.forEach(b=>b.runs.forEach(r=>{if(r.label)r.text+=r.label;delete r.label;delete r.labelStyle;delete r.reference;delete r.locator;delete r.quoted;delete r.note;}));
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
      $('body').focus({preventScroll:true});
      if(selectionRange && $('body').contains(selectionRange.commonAncestorContainer)) {const s=window.getSelection();s.removeAllRanges();s.addRange(selectionRange);}
      document.execCommand(button.dataset.command,false,null);changed();
    });
  });
  $('new-draft').addEventListener('click',()=>{const d=newDraft();drafts.unshift(d);active=d.id;load();save();$('title').focus();});
  function openPublished(entry) {
    const existing=drafts.find(d=>d.sourcePath===entry.path && !d.conflict && d.sourceSha);
    if(existing) active=existing.id;
    else {
      const template=document.createElement('template');template.innerHTML=entry.html;
      const d={...newDraft(),title:entry.title,quote:entry.quote || '',kind:entry.kind,doc:readDocument(template.content),references:entry.references || [],notes:entry.notes || [],referenceKey:entry.referenceKey,quoteReference:entry.quoteReference,quoteLocator:entry.quoteLocator,sourcePath:entry.path,sourceSha:entry.sourceSha,originalDate:entry.date,permalink:entry.permalink,publishedAt:entry.publishedAt,editedAt:entry.editedAt};
      drafts.unshift(d);active=d.id;
    }
    load();save();
  }
  $('publish').addEventListener('click',publishCurrent);
  $('connect-github').addEventListener('click',connectGitHub);
  function captureWriterView() {
    return {draft:active,positions:[$('writing-main'),document.querySelector('.sidebar')].map(el=>({el,top:el.scrollTop,left:el.scrollLeft}))};
  }
  function restoreWriterView(view) {
    const restore=()=>{if(view?.draft===active)for(const p of view.positions)p.el.scrollTo(p.left,p.top);};
    restore();requestAnimationFrame(restore);
  }
  let referenceTarget='body', referenceRange=null, importedCitation=false, referenceView=null;
  let editingNote=null, noteRange=null, noteView=null;
  for(const id of ['add-reference','add-note','restore']) $(id).addEventListener('mousedown',event=>event.preventDefault());
  $('reference-dialog').addEventListener('close',()=>restoreWriterView(referenceView));
  $('note-dialog').addEventListener('close',()=>restoreWriterView(noteView));
  function openNote(id=null) {
    noteView=captureWriterView();
    editingNote=id;noteRange=selectionRange?.cloneRange();
    $('note-heading').textContent=id?'Edit explanation':'Add an explanation';
    $('note-text').value=id?(current().notes || []).find(n=>n.id===id)?.text || '':'';
    $('note-error').textContent='';$('note-remove').hidden=!id;
    $('note-dialog').showModal();$('note-text').focus();restoreWriterView(noteView);
  }
  $('add-note').addEventListener('click',()=>openNote());
  $('note-cancel').addEventListener('click',()=>$('note-dialog').close());
  $('note-form').addEventListener('submit',e=>{
    e.preventDefault();const text=$('note-text').value.trim();
    if(!text){$('note-error').textContent='Write an explanation first.';return;}
    const d=current();d.notes ||= [];
    if(editingNote){const note=d.notes.find(n=>n.id===editingNote);if(note)note.text=text;}
    else {
      const note={id:crypto.randomUUID(),text};d.notes.push(note);
      $('note-dialog').close();$('body').focus({preventScroll:true});const selection=window.getSelection();
      const range=noteRange && $('body').contains(noteRange.commonAncestorContainer)?noteRange:document.createRange();
      if(range!==noteRange)range.selectNodeContents($('body'));
      range.collapse(false);selection.removeAllRanges();selection.addRange(range);
      document.execCommand('insertHTML',false,core.noteMarker(note.id,d.notes,core.referenceKey(d)).replace(' contenteditable="false"','')+'&nbsp;');
      $('body').querySelectorAll('[data-note]').forEach(marker=>marker.contentEditable='false');
    }
    $('note-dialog').close();changed();restoreWriterView(noteView);
  });
  $('note-remove').addEventListener('click',()=>{
    if(!editingNote)return;
    current().notes=(current().notes || []).filter(n=>n.id!==editingNote);
    $('body').querySelectorAll('[data-note]').forEach(marker=>{if(marker.dataset.note===editingNote)marker.remove();});
    $('note-dialog').close();changed();restoreWriterView(noteView);
  });
  function renderNotePreview() {
    const d=current(), key=core.referenceKey(d), notes=core.usedNotes(d.doc,d.notes);
    $('note-preview').innerHTML=core.renderNotes(d.doc,d.notes,key);
    $('body').querySelectorAll('[data-note]').forEach(marker=>{
      const i=notes.findIndex(n=>n.id===marker.dataset.note), a=marker.querySelector('a');
      if(a){a.textContent=i<0?'*?':'*'.repeat(i+1);a.href='#'+key+'-note-'+(i+1);a.setAttribute('aria-label','Explanation '+(i+1));}
    });
    $('note-preview').querySelectorAll('li').forEach((li,i)=>{
      const button=document.createElement('button');button.type='button';button.className='edit-reference';button.textContent='Edit note';
      button.addEventListener('click',()=>openNote(notes[i].id));li.querySelector('.note-text').append(button);
    });
  }
  function renderReferencePreview() {
    renderNotePreview();
    // Keep source metadata in the local draft so Undo can restore a deleted citation.
    // Only sources still cited belong in the visible or published reference list.
    const d=current(), refs=core.usedReferences(d), key=core.referenceKey(d);
    $('body').querySelectorAll('[data-reference]').forEach(marker=>{
      const index=refs.findIndex(r=>r.id===marker.dataset.reference), source=refs[index], link=marker.querySelector('a');
      if(!source || !link)return;
      if(marker.dataset.label){link.href=core.safeURL(source.url);link.title=source.title+(marker.dataset.locator?' — '+marker.dataset.locator:'');}
      else {link.textContent='['+(index+1)+']';link.href='#'+key+'-'+(index+1);link.setAttribute('aria-label','Reference '+(index+1)+(marker.dataset.locator?', '+marker.dataset.locator:''));}
    });
    $('reference-preview').innerHTML=core.renderReferences(refs,key);
    $('quote-source').hidden=!d.quote.trim();
    $('quote-block').hidden=false;
    $('quote-citation').innerHTML=d.quote.trim() && d.quoteReference?core.citation(d.quoteReference,refs,key,d.quoteLocator || ''):'';
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
    referenceView=captureWriterView();
    referenceTarget=target;referenceRange=selectionRange?.cloneRange();
    importedCitation=false;$('imported-citation').hidden=true;
    const d=current(), refs=core.usedReferences(d);
    $('reference-form').reset();$('reference-error').textContent='';
    $('reference-display-field').hidden=target!=='body';
    $('reference-existing').replaceChildren(new Option('New source',''),...refs.map(r=>new Option(r.title,r.id)));
    $('reference-page').replaceChildren(new Option('Choose a page (optional)',''),...published.filter(p=>p.kind==='page').map(p=>new Option(p.title,p.url)));
    $('reference-existing').value=id || (target==='quote'?d.quoteReference || '':'');
    fillReference(refs.find(r=>r.id===$('reference-existing').value));
    $('reference-locator').value=target==='quote'?d.quoteLocator || '':'';
    $('reference-quoted').parentElement.hidden=target!=='body';
    $('reference-quoted').disabled=!referenceRange || referenceRange.collapsed;
    $('reference-form').querySelector('[type=submit]').textContent=target==='edit'?'Save source':target==='quote'?'Use for quote':'Insert reference';
    $('reference-heading').textContent=target==='quote'?'Quote source':target==='edit'?'Edit source':'Add a reference';
    $('reference-dialog').showModal();restoreWriterView(referenceView);
  }
  function importCitation(data) {
    const citation=core.parseCitation(data);
    const originalView=$('reference-dialog').open?referenceView:captureWriterView();
    const target=$('reference-dialog').open && referenceTarget==='quote'?'quote':'body';
    if($('reference-dialog').open)$('reference-dialog').close();
    openReference(target);
    referenceView=originalView;
    const existing=(current().references || []).find(r=>r.url===citation.source.url);
    if(existing && !Array.from($('reference-existing').options).some(option=>option.value===existing.id))$('reference-existing').add(new Option(existing.title,existing.id));
    $('reference-existing').value=existing?.id || '';
    fillReference(citation.source);$('reference-locator').value=citation.locator;
    importedCitation=true;$('imported-citation').hidden=false;
    $('citation-text').value=citation.quote;
    $('reference-display-text').value=citation.displayText;
    $('reference-display-style').value=citation.displayStyle;
    $('citation-placement').value=target==='quote'?'opening-quote':citation.displayText?'body-link':!citation.quote || (referenceRange && !referenceRange.collapsed)?'body-reference':'body-quote';
    updateCitationFields();
    $('reference-quoted').parentElement.hidden=true;
    $('reference-heading').textContent='Review citation';
    $('reference-form').querySelector('[type=submit]').textContent='Insert citation';
  }
  function updateCitationFields() {
    const placement=$('citation-placement').value;
    $('reference-display-field').hidden=placement!=='body-link';
    $('citation-quote-field').hidden=!['body-quote','opening-quote'].includes(placement);
  }
  $('citation-placement').addEventListener('change',updateCitationFields);
  $('import-citation').addEventListener('click',()=>$('restore-file').click());
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
    const placement=importedCitation?$('citation-placement').value:null;
    const importedQuote=importedCitation?$('citation-text').value.trim():'';
    const label=(!importedCitation && referenceTarget==='body') || placement==='body-link'?$('reference-display-text').value.trim():'';
    if(placement==='body-link' && !label){$('reference-error').textContent='Add the text to display for this link.';return;}
    if(importedCitation && ['body-quote','opening-quote'].includes(placement) && !importedQuote){$('reference-error').textContent='Add quoted text, or choose Reference only.';return;}
    if(importedCitation)referenceTarget=placement==='opening-quote'?'quote':'body';
    const r={id:$('reference-existing').value || crypto.randomUUID()};
    for(const [field,name] of [['title','title'],['url','url'],['author','author'],['details','details'],['saved','savedUrl'],['note','note']]) r[name]=$('reference-'+field).value.trim();
    if(!r.title || !core.safeURL(r.url) || (r.savedUrl && !core.safeURL(r.savedUrl))) {$('reference-error').textContent='Add a title and a valid https:// URL or site path.';return;}
    d.references ||= [];const i=d.references.findIndex(ref=>ref.id===r.id);if(i<0)d.references.push(r);else d.references[i]=r;
    const locator=$('reference-locator').value.trim();
    if(referenceTarget==='quote') {
      if(importedCitation)$('quote').textContent=importedQuote;
      d.quoteReference=r.id;d.quoteLocator=locator;
    }
    $('reference-dialog').close();
    if(referenceTarget==='body') {
      $('body').focus({preventScroll:true});const selection=window.getSelection();
      if(referenceRange && $('body').contains(referenceRange.commonAncestorContainer)) {selection.removeAllRanges();selection.addRange(referenceRange);}
      else {const range=document.createRange();range.selectNodeContents($('body'));range.collapse(false);selection.removeAllRanges();selection.addRange(range);}
      const quoted=!label && (importedCitation?placement==='body-quote':$('reference-quoted').checked);
      const text=importedCitation?importedQuote:quoted?selection.toString():'';
      if(!quoted && !label)selection.collapseToEnd();
      const html=(quoted?'<q>'+core.escapeHTML(text)+'</q>':'')+core.citation(r.id,d.references,core.referenceKey(d),locator,label,$('reference-display-style').value)+'&nbsp;';
      // Chromium can move a non-editable fragment outside the paragraph during insertion.
      // Insert it inline first, then protect the citation from accidental text edits.
      document.execCommand('insertHTML',false,html.replace(' contenteditable="false"',''));
      $('body').querySelectorAll('[data-reference]').forEach(marker=>marker.contentEditable='false');
    }
    changed();restoreWriterView(referenceView);
  });
  $('download').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify({version:2,drafts,active},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='blog-drafts-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $('restore').addEventListener('click',()=>$('restore-file').click());
  $('restore-file').addEventListener('change',async()=>{
    const file=$('restore-file').files[0];if(!file)return;
    try {
      if(file.size>10000000)throw new Error('Backup is too large.');
      const data=JSON.parse(await file.text());
      if(data?.type==='blog-citation'){importCitation(data);return;}
      if($('reference-dialog').open)throw new Error('Choose a citation JSON file here. Import draft files from the main toolbar.');
      if(!data || !Array.isArray(data.drafts) || !data.drafts.every(acceptDraft))throw new Error('Invalid draft or citation JSON.');
      for(const incoming of data.drafts) {
        const same=drafts.find(d=>d.id===incoming.id);
        if(same && JSON.stringify(same)===JSON.stringify(incoming))continue;
        drafts.push({...incoming,id:same?crypto.randomUUID():incoming.id,doc:incoming.doc || core.plainDocument(incoming.body)});
      }
      saveFailed=false;renderNav();save();$('index-status').textContent='JSON imported. Existing drafts kept.';
    }catch(e){($('reference-dialog').open?$('reference-error'):$('index-status')).textContent=e.message;}finally{$('restore-file').value='';}
  });
  function refreshIndex(){return fetch(document.body.dataset.index,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{
    published=[...(data.posts || []),...(data.pages || [])].filter(p=>!removedPaths.has(p.path));renderNav();
  }).catch(()=>{$('index-status').textContent='Published posts could not load. Your saved drafts are still available.';});}
  load();save();refreshIndex();
  if(location.hash)requestAnimationFrame(()=>document.getElementById(location.hash.slice(1))?.scrollIntoView({block:'center'}));
  if(isPrivate) {
    const checkConnection=()=>api('/api/session').then(s=>connectionStatus(s.connected)).catch(()=>connectionStatus(false));
    checkConnection();setInterval(checkConnection,60000);
    if(window.opener && new URLSearchParams(location.search).has('import')) {
      const receive=event=>{
        if(event.origin!=='https://sjaakiechen.github.io' || event.source!==window.opener || event.data?.type!=='blog-desk-import')return;
        const data=event.data.data;if(!data || !Array.isArray(data.drafts) || !data.drafts.every(acceptDraft))return;
        for(const incoming of data.drafts) {
          const existing=drafts.find(d=>d.id===incoming.id);
          let id=incoming.id;
          if(existing && JSON.stringify(existing)!==JSON.stringify(incoming))id=crypto.randomUUID();
          if(!existing || id!==incoming.id)drafts.push({...incoming,id,referenceKey:incoming.referenceKey || incoming.id,doc:incoming.doc || core.plainDocument(incoming.body)});
          if(incoming.id===data.active)active=id;
        }
        load();save();event.source.postMessage({type:'blog-desk-imported'},event.origin);window.removeEventListener('message',receive);
        history.replaceState(null,'','/write/');if(event.data.publish)publishCurrent();
      };
      window.addEventListener('message',receive);window.opener.postMessage({type:'blog-desk-ready'},'https://sjaakiechen.github.io');
    }
  }
})();
