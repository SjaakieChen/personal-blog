(function(root) {
  'use strict';
  const escapeHTML = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const plainDocument = text => String(text).split(/\n\s*\n/).map(text=>({runs:[{text}]}));
  function validDocument(doc) {
    return Array.isArray(doc) && doc.every(block=>block && Array.isArray(block.runs) && block.runs.every(run=>run && typeof run.text==='string'));
  }
  function render(doc) {
    if (!validDocument(doc)) throw new Error('Invalid draft text.');
    return doc.map(block=>'<p>'+block.runs.map(run=>{
      let text=escapeHTML(run.text).replace(/\n/g,'<br>');
      if(run.underline) text='<u>'+text+'</u>';
      if(run.italic) text='<em>'+text+'</em>';
      if(run.bold) text='<strong>'+text+'</strong>';
      return text;
    }).join('')+'</p>').join('\n');
  }
  function prepare(draft, now=new Date()) {
    const doc=draft.doc || plainDocument(draft.body || '');
    if(!draft.title.trim() || !validDocument(doc) || !doc.some(b=>b.runs.some(r=>r.text.trim()))) throw new Error('Add a title and some writing first.');
    if(!['post','page'].includes(draft.kind)) throw new Error('Choose a post or a page.');
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    const slug=draft.title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,65).replace(/-$/,'') || 'entry';
    const suffix=draft.id.replace(/[^a-zA-Z0-9]/g,'').slice(0,8);
    if(!suffix) throw new Error('Invalid draft ID.');
    const name=slug+'-'+suffix;
    const filename=draft.sourcePath || draft.targetPath || (draft.kind==='post'?`_posts/${day}-${name}.md`:`pages/${name}.md`);
    if(!/^(?:_posts|pages)\/[a-zA-Z0-9_-]+\.md$/.test(filename)) throw new Error('Unsupported publishing filename.');
    const metadata=['---',`layout: ${draft.kind}`,`title: ${JSON.stringify(draft.title.trim())}`,`quote: ${JSON.stringify((draft.quote || '').trim())}`,'render_with_liquid: false'];
    if(draft.kind==='post') metadata.push(`date: ${JSON.stringify(draft.originalDate || now.toISOString())}`);
    else metadata.push(`permalink: ${JSON.stringify(draft.permalink || '/'+name+'/')}`);
    const html=render(doc).replace(/{/g,'&#123;').replace(/}/g,'&#125;');
    const content=metadata.concat(['---','',html,'']).join('\n');
    const url=draft.sourcePath ? 'https://github.com/SjaakieChen/personal-blog/edit/main/'+filename : 'https://github.com/SjaakieChen/personal-blog/new/main?filename='+encodeURIComponent(filename);
    return {filename,content,url};
  }
  const api={escapeHTML,plainDocument,validDocument,render,prepare};
  root.BlogWriter=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
