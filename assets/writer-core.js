(function(root) {
  'use strict';
  const escapeHTML = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const plainDocument = text => String(text).split(/\n\s*\n/).map(text=>({runs:[{text}]}));
  function validDocument(doc) {
    return Array.isArray(doc) && doc.every(block=>block && Array.isArray(block.runs) && block.runs.every(run=>run && typeof run.text==='string'));
  }
  function safeURL(value) {
    if(typeof value!=='string' || /[\s\\<>]/.test(value)) return '';
    if(/^\/(?!\/)/.test(value)) return value;
    try {return ['https:','http:'].includes(new URL(value).protocol)?value:'';} catch {return '';}
  }
  const referenceKey = draft => 'ref-'+String(draft.referenceKey || draft.id).replace(/[^a-zA-Z0-9_-]/g,'');
  function citation(id, references=[], key='preview', locator='') {
    const i=references.findIndex(r=>r.id===id);
    if(i<0) return '<sup class="citation missing-reference">[?]</sup>';
    return '<sup class="citation" contenteditable="false" data-reference="'+escapeHTML(id)+'" data-locator="'+escapeHTML(locator)+'"><a href="#'+escapeHTML(key)+'-'+(i+1)+'" aria-label="Reference '+(i+1)+(locator?', '+escapeHTML(locator):'')+'">['+(i+1)+(locator?', '+escapeHTML(locator):'')+']</a></sup>';
  }
  function renderReferences(references=[], key='preview') {
    if(!references.length)return '';
    return '<section class="references" data-references="true" aria-label="References"><h2>References</h2><ol>'+references.map((r,i)=>{
      const link=(url,label)=>safeURL(url)?'<a href="'+escapeHTML(safeURL(url))+'">'+escapeHTML(label)+'</a>':'';
      return '<li id="'+escapeHTML(key)+'-'+(i+1)+'">'+(link(r.url,r.title)||escapeHTML(r.title || 'Untitled source'))+(r.author?' — '+escapeHTML(r.author):'')+(r.details?'. '+escapeHTML(r.details):'')+(r.savedUrl?' <span class="reference-copy">'+link(r.savedUrl,'Saved copy')+'</span>':'')+(r.note?'<p>'+escapeHTML(r.note)+'</p>':'')+'</li>';
    }).join('')+'</ol></section>';
  }
  function render(doc, references=[], key='preview') {
    if (!validDocument(doc)) throw new Error('Invalid draft text.');
    return doc.map(block=>'<p>'+block.runs.map(run=>{
      let text=escapeHTML(run.text).replace(/\n/g,'<br>');
      if(run.underline) text='<u>'+text+'</u>';
      if(run.italic) text='<em>'+text+'</em>';
      if(run.bold) text='<strong>'+text+'</strong>';
      if(safeURL(run.link)) text='<a href="'+escapeHTML(run.link)+'">'+text+'</a>';
      if(run.quoted) text='<q>'+text+'</q>';
      if(run.reference) text+=citation(run.reference,references,key,run.locator || '');
      return text;
    }).join('')+'</p>').join('\n');
  }
  function prepare(draft, now=new Date()) {
    const doc=draft.doc || plainDocument(draft.body || '');
    if(!draft.title.trim() || !validDocument(doc) || !doc.some(b=>b.runs.some(r=>r.text.trim()))) throw new Error('Add a title and some writing first.');
    if(!['post','page'].includes(draft.kind)) throw new Error('Choose a post or a page.');
    const references=draft.references || [];
    if(!Array.isArray(references) || references.some(r=>!r || typeof r.id!=='string' || !r.title?.trim() || !safeURL(r.url) || (r.savedUrl && !safeURL(r.savedUrl))) || new Set(references.map(r=>r.id)).size!==references.length) throw new Error('Each reference needs a title and a valid source link.');
    const hasReference=id=>references.some(r=>r.id===id);
    if(draft.quote?.trim() && !hasReference(draft.quoteReference)) throw new Error('Choose a reference for the opening quote before publishing.');
    for(const block of doc)for(const run of block.runs) {
      if((run.reference && !hasReference(run.reference)) || (run.quoted && !hasReference(run.reference))) throw new Error('Every quotation and citation needs a reference.');
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
    metadata.push('reference_key: '+JSON.stringify(key.replace(/^ref-/,'')), 'references: '+JSON.stringify(references), 'quote_reference: '+JSON.stringify(draft.quoteReference || ''), 'quote_locator: '+JSON.stringify(draft.quoteLocator || ''));
    if(draft.kind==='post') metadata.push(`date: ${JSON.stringify(draft.originalDate || now.toISOString())}`);
    else metadata.push(`permalink: ${JSON.stringify(draft.permalink || '/'+name+'/')}`);
    const html=(render(doc,references,key)+'\n'+renderReferences(references,key)).replace(/{/g,'&#123;').replace(/}/g,'&#125;');
    const content=metadata.concat(['---','',html,'']).join('\n');
    const url=draft.sourcePath ? 'https://github.com/SjaakieChen/personal-blog/edit/main/'+filename : 'https://github.com/SjaakieChen/personal-blog/new/main?filename='+encodeURIComponent(filename);
    return {filename,content,url};
  }
  const api={escapeHTML,plainDocument,validDocument,render,prepare,safeURL,referenceKey,citation,renderReferences};
  root.BlogWriter=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
