(function(root) {
  'use strict';
  const escapeHTML = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const plainDocument = text => String(text).split(/\n\s*\n/).map(text=>({runs:[{text}]}));
  function validDocument(doc) {
    return Array.isArray(doc) && doc.every(block=>block && Array.isArray(block.runs) && block.runs.every(run=>run && typeof run.text==='string' && (run.label===undefined || typeof run.label==='string')));
  }
  function safeURL(value) {
    if(typeof value!=='string' || /[\s\\<>]/.test(value)) return '';
    if(/^\/(?!\/)/.test(value)) return value;
    try {return ['https:','http:'].includes(new URL(value).protocol)?value:'';} catch {return '';}
  }
  function parseCitation(data) {
    if(!data || data.type!=='blog-citation' || data.version!==1 || !data.source || typeof data.source!=='object' || Array.isArray(data.source)) throw new Error('Use a version 1 blog-citation JSON file.');
    const text=(value,name)=>{
      if(value===undefined)return '';
      if(typeof value!=='string' || value.length>20000)throw new Error('Invalid citation '+name+'.');
      return value.trim();
    };
    const source={};
    for(const field of ['title','url','author','details','savedUrl','note'])source[field]=text(data.source[field],field);
    if(!source.title || !safeURL(source.url) || (source.savedUrl && !safeURL(source.savedUrl)))throw new Error('The citation needs a title and a valid source URL.');
    const displayStyle=data.displayStyle===undefined?'normal':data.displayStyle;
    if(!['small','normal'].includes(displayStyle))throw new Error('Choose small or normal display text.');
    return {source,quote:text(data.quote,'quote'),locator:text(data.locator,'locator'),displayText:text(data.displayText,'display text'),displayStyle};
  }
  const referenceKey = draft => 'ref-'+String(draft.referenceKey || draft.id).replace(/[^a-zA-Z0-9_-]/g,'');
  function citation(id, references=[], key='preview', locator='', label='', labelStyle='normal') {
    const i=references.findIndex(r=>r.id===id);
    if(i<0) return '<sup class="citation missing-reference">[?]</sup>';
    if(label) {
      const small=labelStyle==='small', tag=small?'sup':'span';
      return '<'+tag+' class="text-citation'+(small?' citation':'')+'" contenteditable="false" data-reference="'+escapeHTML(id)+'" data-locator="'+escapeHTML(locator)+'" data-label="'+escapeHTML(label)+'" data-label-style="'+(small?'small':'normal')+'"><a target="_blank" rel="noopener noreferrer" href="'+escapeHTML(safeURL(references[i].url))+'" title="'+escapeHTML(references[i].title+(locator?' — '+locator:''))+'">'+escapeHTML(label)+'</a></'+tag+'>';
    }
    return '<sup class="citation" contenteditable="false" data-reference="'+escapeHTML(id)+'" data-locator="'+escapeHTML(locator)+'"><a href="#'+escapeHTML(key)+'-'+(i+1)+'" aria-label="Reference '+(i+1)+(locator?', '+escapeHTML(locator):'')+'" title="'+escapeHTML(locator)+'">['+(i+1)+']</a></sup>';
  }
  function renderReferences(references=[], key='preview') {
    if(!references.length)return '';
    return '<section class="references" data-references="true" aria-label="References"><h2>References</h2><ol>'+references.map((r,i)=>{
      const link=(url,label)=>safeURL(url)?'<a target="_blank" rel="noopener noreferrer" href="'+escapeHTML(safeURL(url))+'">'+escapeHTML(label)+'</a>':'';
      return '<li id="'+escapeHTML(key)+'-'+(i+1)+'">'+(link(r.url,r.title)||escapeHTML(r.title || 'Untitled source'))+(r.author?' — '+escapeHTML(r.author):'')+(r.details?'. '+escapeHTML(r.details):'')+(r.savedUrl?' <span class="reference-copy">'+link(r.savedUrl,'Saved copy')+'</span>':'')+(r.note?'<p>'+escapeHTML(r.note)+'</p>':'')+'</li>';
    }).join('')+'</ol></section>';
  }
  function usedReferences(draft) {
    const doc=draft.doc || plainDocument(draft.body || '');
    const ids=new Set(doc.flatMap(block=>block.runs.map(run=>run.reference).filter(Boolean)));
    for(const note of usedNotes(doc,draft.notes))if(note.reference)ids.add(note.reference);
    if(draft.quote?.trim() && draft.quoteReference)ids.add(draft.quoteReference);
    return (draft.references || []).filter(reference=>ids.has(reference.id));
  }
  function validNotes(notes) {
    return Array.isArray(notes) && notes.every(n=>n && typeof n.id==='string' && n.id && typeof n.text==='string' && n.text.trim()) && new Set(notes.map(n=>n.id)).size===notes.length;
  }
  function usedNotes(doc, notes=[]) {
    const ids=[...new Set(doc.flatMap(b=>b.runs.map(r=>r.note).filter(Boolean)))];
    return ids.map(id=>notes.find(n=>n.id===id)).filter(Boolean);
  }
  function noteMarker(id, notes=[], key='preview') {
    const i=notes.findIndex(n=>n.id===id);
    return '<sup class="citation explanation-marker" contenteditable="false" data-note="'+escapeHTML(id)+'"><a href="#'+escapeHTML(key)+'-note-'+(i+1)+'" aria-label="Explanation '+(i+1)+'">'+(i<0?'*?':'*'.repeat(i+1))+'</a></sup>';
  }
  function renderNotes(doc, notes=[], key='preview', references=[]) {
    const used=usedNotes(doc,notes);
    if(!used.length)return '';
    return '<section class="explanation-notes" data-notes="true" aria-label="Notes"><h2>Notes</h2><ul>'+used.map((n,i)=>'<li id="'+escapeHTML(key)+'-note-'+(i+1)+'"><span class="note-symbol" aria-label="Explanation '+(i+1)+'">'+'*'.repeat(i+1)+'</span><div class="note-text">'+escapeHTML(n.text).replace(/\n/g,'<br>')+(n.reference?citation(n.reference,references,key,n.locator || ''):'')+'</div></li>').join('')+'</ul></section>';
  }
  function render(doc, references=[], key='preview', notes=[]) {
    if (!validDocument(doc)) throw new Error('Invalid draft text.');
    const used=usedNotes(doc,notes);
    return doc.map(block=>'<p>'+block.runs.map(run=>{
      let text=escapeHTML(run.text).replace(/\n/g,'<br>');
      if(run.underline) text='<u>'+text+'</u>';
      if(run.italic) text='<em>'+text+'</em>';
      if(run.bold) text='<strong>'+text+'</strong>';
      if(safeURL(run.link)) text='<a target="_blank" rel="noopener noreferrer" href="'+escapeHTML(run.link)+'">'+text+'</a>';
      if(run.quoted) text='<q>'+text+'</q>';
      if(run.reference) text+=citation(run.reference,references,key,run.locator || '',run.label || '',run.labelStyle || 'normal');
      if(run.note) text+=noteMarker(run.note,used,key);
      return text;
    }).join('')+'</p>').join('\n');
  }
  function prepare(draft, now=new Date()) {
    const doc=draft.doc || plainDocument(draft.body || '');
    if(!draft.title.trim() || !validDocument(doc) || !doc.some(b=>b.runs.some(r=>r.text.trim() || r.label?.trim()))) throw new Error('Add a title and some writing first.');
    if(!['post','page'].includes(draft.kind)) throw new Error('Choose a post or a page.');
    const availableReferences=draft.references || [];
    const notes=draft.notes || [];
    if(!validNotes(notes))throw new Error('Each explanation needs text and a unique ID.');
    if(!Array.isArray(availableReferences) || availableReferences.some(r=>!r || typeof r.id!=='string' || !r.title?.trim() || !safeURL(r.url) || (r.savedUrl && !safeURL(r.savedUrl))) || new Set(availableReferences.map(r=>r.id)).size!==availableReferences.length) throw new Error('Each reference needs a title and a valid source link.');
    const references=usedReferences(draft);
    const hasReference=id=>references.some(r=>r.id===id);
    if(usedNotes(doc,notes).some(n=>n.reference && !hasReference(n.reference)))throw new Error('An explanation citation is missing its reference.');
    if(draft.quote?.trim() && !hasReference(draft.quoteReference)) throw new Error('Choose a reference for the opening quote before publishing.');
    for(const block of doc)for(const run of block.runs) {
      if((run.reference && !hasReference(run.reference)) || (run.quoted && !hasReference(run.reference))) throw new Error('Every quotation and citation needs a reference.');
      if(run.note && !notes.some(n=>n.id===run.note))throw new Error('An explanation is missing. Edit or remove its asterisk before publishing.');
    }
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    const slug=draft.title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,65).replace(/-$/,'') || 'entry';
    const suffix=draft.id.replace(/[^a-zA-Z0-9]/g,'').slice(0,8);
    if(!suffix) throw new Error('Invalid draft ID.');
    const name=slug+'-'+suffix;
    const filename=draft.sourcePath || draft.targetPath || (draft.kind==='post'?`_posts/${day}-${name}.md`:`pages/${name}.md`);
    if(!/^(?:_posts|pages)\/[a-zA-Z0-9_-]+\.md$/.test(filename)) throw new Error('Unsupported publishing filename.');
    const metadata=['---',`layout: ${draft.kind}`,`title: ${JSON.stringify(draft.title.trim())}`,`quote: ${JSON.stringify((draft.quote || '').trim())}`,'render_with_liquid: false'];
    const key=referenceKey(draft);
    metadata.push('reference_key: '+JSON.stringify(key.replace(/^ref-/,'')), 'references: '+JSON.stringify(references), 'quote_reference: '+JSON.stringify(draft.quote?.trim()?draft.quoteReference || '':''), 'quote_locator: '+JSON.stringify(draft.quote?.trim()?draft.quoteLocator || '':''));
    metadata.push('notes: '+JSON.stringify(usedNotes(doc,notes)));
    if(draft.kind==='post') metadata.push(`date: ${JSON.stringify(draft.originalDate || now.toISOString())}`);
    else metadata.push(`permalink: ${JSON.stringify(draft.permalink || '/'+name+'/')}`);
    const html=(render(doc,references,key,notes)+'\n'+renderNotes(doc,notes,key,references)+'\n'+renderReferences(references,key)).replace(/{/g,'&#123;').replace(/}/g,'&#125;');
    const content=metadata.concat(['---','',html,'']).join('\n');
    const url=draft.sourcePath ? 'https://github.com/SjaakieChen/personal-blog/edit/main/'+filename : 'https://github.com/SjaakieChen/personal-blog/new/main?filename='+encodeURIComponent(filename);
    return {filename,content,url};
  }
  function updateSignature(d) {
    return JSON.stringify([d.title,d.kind,d.quote || '',render(d.doc || plainDocument(d.body || ''),d.references || [],'update',d.notes),d.references || [],d.quoteReference || '',d.quoteLocator || '',d.notes || []]);
  }
  function applyDraftUpdate(current, data, now=new Date()) {
    if(data?.type!=='blog-draft-update' || data.version!==1 || data.id!==current.id || !data.base || !data.updated)throw new Error('Invalid draft update JSON.');
    for(const value of [data.base,data.updated]) {
      if(value.title!==current.title || value.kind!==current.kind || typeof value.quote!=='string' || !validDocument(value.doc))throw new Error('This update must keep the draft title and type.');
      prepare({...current,...value,id:current.id,sourcePath:current.sourcePath,targetPath:current.targetPath});
    }
    if(updateSignature(current)===updateSignature(data.updated))return current;
    if(updateSignature(current)!==updateSignature(data.base))throw new Error('This draft has newer edits. Save JSON again so the update can include them. Nothing was replaced.');
    const {savedVersions:history,...previous}=current;
    const updated={...current,savedVersions:[...(history || []),previous],updatedAt:now.toISOString()};
    for(const field of ['quote','doc','references','notes','quoteReference','quoteLocator'])updated[field]=structuredClone(data.updated[field] ?? (['doc','references','notes'].includes(field)?[]:''));
    delete updated.pendingPublication;
    return updated;
  }
  const api={escapeHTML,plainDocument,validDocument,render,prepare,safeURL,referenceKey,citation,renderReferences,usedReferences,parseCitation,validNotes,usedNotes,noteMarker,renderNotes,updateSignature,applyDraftUpdate};
  root.BlogWriter=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
