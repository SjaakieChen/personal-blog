const test = require('node:test');
const assert = require('node:assert/strict');
const {prepare} = require('../assets/writer-core.js');
const draft = {id:'ab123456-7890',kind:'post',title:'A new thought',quote:'A quiet beginning',date:'2026-10-15',body:'One paragraph.\n\nAnother paragraph.'};
test('prepares a post for the correct repository and path', () => {
  const p = prepare(draft);
  assert.equal(p.filename, '_posts/2026-10-15-a-new-thought-ab123456.md');
  assert.equal(new URL(p.url).searchParams.get('filename'), p.filename);
  assert.match(p.content, /layout: post/);
  assert.match(p.content, /<p>One paragraph.<\/p>\n\n<p>Another paragraph.<\/p>/);
});
test('keeps HTML, Liquid, and YAML-looking input as text', () => {
  const p = prepare({...draft,title:'Hello\nlayout: evil',body:'<script>alert(1)</script>\n{{ site.secret }}\n{% include bad %}',quote:'"\n---'});
  assert.ok(!p.content.includes('<script>'));
  assert.ok(!p.content.includes('{{'));
  assert.ok(!p.content.includes('{%'));
  assert.match(p.content,/title: "Hello\\nlayout: evil"/);
  assert.match(p.content,/&lt;script&gt;/);
});
test('does not accept empty content or impossible dates', () => {
  for (const patch of [{title:' '},{body:' '},{date:'2026-02-30'},{date:'bad'}]) assert.throws(() => prepare({...draft,...patch}));
});
test('standalone pages have their own URL and stable filenames', () => {
  const p = prepare({...draft,kind:'page',title:'About me'});
  assert.equal(p.filename,'pages/about-me-ab123456.md');
  assert.match(p.content,/permalink: \/about-me-ab123456\//);
  assert.equal(prepare({...draft,body:'Changed body'}).filename,prepare(draft).filename);
  assert.notEqual(prepare({...draft,id:'different-id'}).filename,prepare(draft).filename);
});
