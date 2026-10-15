(function (root) {
  'use strict';
  const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function prepare(draft) {
    if (!draft.title.trim() || !draft.body.trim()) throw new Error('Add a title and some writing first.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || Number.isNaN(Date.parse(draft.date + 'T12:00:00Z')) || new Date(draft.date + 'T12:00:00Z').toISOString().slice(0,10) !== draft.date) throw new Error('Choose a valid date.');
    if (!['post','page'].includes(draft.kind)) throw new Error('Choose a post or a page.');
    const slug = draft.title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,65).replace(/-$/,'') || 'entry';
    const suffix = draft.id.replace(/[^a-zA-Z0-9]/g,'').slice(0,8);
    if (!suffix) throw new Error('This draft needs a valid ID.');
    const name = slug + '-' + suffix;
    const filename = draft.kind === 'post' ? `_posts/${draft.date}-${name}.md` : `pages/${name}.md`;
    const metadata = ['---', `layout: ${draft.kind}`, `title: ${JSON.stringify(draft.title.trim())}`, `quote: ${JSON.stringify(draft.quote.trim())}`, 'render_with_liquid: false'];
    if (draft.kind === 'post') metadata.push(`date: ${draft.date} 00:00:00 +0000`);
    else metadata.push(`permalink: /${name}/`);
    const paragraphs = draft.body.trim().split(/\n\s*\n/).map(p => '<p>' + escapeHTML(p).replace(/\n/g,'<br>\n') + '</p>').join('\n\n');
    // Numeric entities keep Liquid-looking text literal even in older Jekyll builds.
    const content = metadata.concat(['---','',paragraphs.replace(/{/g,'&#123;').replace(/}/g,'&#125;'),'']).join('\n');
    return {filename,content,url:'https://github.com/SjaakieChen/personal-blog/new/main?filename='+encodeURIComponent(filename)};
  }
  root.BlogWriter = {prepare};
  if (typeof module !== 'undefined' && module.exports) module.exports = {prepare};
})(typeof window !== 'undefined' ? window : globalThis);
