(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fields = ['kind','date','title','quote','body'];
  const key = 'jiaqi-writing-desk-v1';
  let drafts = [], active, storageError = false;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const newDraft = () => ({id:crypto.randomUUID(),kind:'post',date:today(),title:'',quote:'',body:''});
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved && Array.isArray(saved.drafts)) {
      drafts = saved.drafts.filter(d => d && typeof d.id === 'string' && fields.every(f => typeof d[f] === 'string') && ['post','page'].includes(d.kind));
      active = saved.active;
    }
  } catch { storageError = true; }
  if (!drafts.length) drafts.push(newDraft());
  if (!drafts.some(d => d.id === active)) active = drafts[0].id;
  const current = () => drafts.find(d => d.id === active);
  function save() {
    if (storageError) { $('save-status').textContent = 'Browser saving is unavailable. Download your draft to keep a copy.'; return; }
    try { localStorage.setItem(key, JSON.stringify({drafts,active})); $('save-status').textContent = 'Draft saved in this browser. Download a copy before clearing browser data.'; }
    catch { $('save-status').textContent = 'Could not save in this browser. Download your draft to keep it.'; }
  }
  function list() {
    $('drafts').replaceChildren(...drafts.map(d => { const option = document.createElement('option'); option.value = d.id; option.textContent = d.title || 'Untitled draft'; option.selected = d.id === active; return option; }));
  }
  function preview() {
    const draft = current();
    $('preview-title').textContent = draft.title || 'Your title';
    $('preview-date').textContent = draft.date && !Number.isNaN(Date.parse(draft.date)) ? new Date(draft.date + 'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '';
    $('preview-date').hidden = draft.kind === 'page';
    $('preview-quote').textContent = '“' + draft.quote + '”';
    $('preview-quote').hidden = !draft.quote.trim();
    $('preview-body').replaceChildren(...(draft.body.trim() || 'Your words will appear here.').split(/\n\s*\n/).map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
    $('publish-panel').hidden = true;
  }
  function load() { fields.forEach(f => { $(f).value = current()[f]; }); list(); preview(); }
  fields.forEach(f => $(f).addEventListener('input', () => { current()[f] = $(f).value; preview(); list(); save(); }));
  $('drafts').addEventListener('change', () => { active = $('drafts').value; load(); save(); });
  $('new-draft').addEventListener('click', () => { const draft = newDraft(); drafts.unshift(draft); active = draft.id; load(); save(); $('title').focus(); });
  $('post-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const post = BlogWriter.prepare(current());
      $('filename').value = post.filename;
      $('prepared').value = post.content;
      $('github-publish').href = post.url;
      $('copy-status').textContent = '';
      $('publish-panel').hidden = false;
      $('publish-panel').scrollIntoView({block:'start',behavior:'smooth'});
    } catch (error) { $('save-status').textContent = error.message; }
  });
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('prepared').value); $('copy-status').textContent = 'Copied. Open GitHub and paste into the file editor.'; }
    catch { $('prepared').focus(); $('prepared').select(); $('copy-status').textContent = 'Press Ctrl+C to copy the selected post, then open GitHub.'; }
  });
  $('download').addEventListener('click', () => {
    const data = current();
    // A text backup also works for unfinished drafts that cannot yet be published.
    let filename = 'unfinished-draft.txt', content = [data.title,data.date,data.quote,data.body].join('\n\n');
    try { const prepared = BlogWriter.prepare(data); filename = prepared.filename.split('/').pop(); content = prepared.content; } catch {}
    const url = URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  });
  load(); save();
})();
