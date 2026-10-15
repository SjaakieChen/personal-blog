const test = require('node:test');
const assert = require('node:assert/strict');
const {prepare: build, render} = require('../assets/writer-core.js');
const prepare = draft => build(draft, new Date('2026-10-15T14:20:00Z'));
const draft = {id:'ab123456-7890',kind:'post',title:'A new thought',quote:'',date:'2026-10-15',body:'One paragraph.\n\nAnother paragraph.'};
const references=[{id:'source-1',title:'Paper <title>',url:'https://example.org/paper.pdf',author:'Author',details:'2026',savedUrl:'/personal-blog/reference/'}];
test('quotes require a source, while repeated citations share a target',()=>{
  assert.throws(()=>prepare({...draft,quote:'Quoted text'}),/reference for the opening quote/);
  assert.throws(()=>prepare({...draft,doc:[{runs:[{text:'Quoted',quoted:true}]}]}),/quotation and citation/);
  const p=prepare({...draft,references,quote:'Quoted text',quoteReference:'source-1',doc:[{runs:[{text:'One',reference:'source-1'},{text:'Two',reference:'source-1',locator:'p. 2'}]}]});
  assert.equal((p.content.match(/href="#ref-ab123456-7890-1"/g)||[]).length,2);
  assert.match(p.content,/id="ref-ab123456-7890-1"/);
  assert.match(p.content,/Paper &lt;title&gt;/);
  assert.match(p.content,/Saved copy/);
});
test('rejects unsafe source URLs and unresolved citations',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,bad','//evil.example','/\\evil.example'])assert.throws(()=>prepare({...draft,references:[{...references[0],url}]}),/valid source link/);
  assert.throws(()=>prepare({...draft,doc:[{runs:[{text:'Text',reference:'missing'}]}]}),/citation needs a reference/);
});
test('prepares a post for the correct repository and path', () => {
  const p = prepare(draft);
  assert.equal(p.filename, '_posts/2026-10-15-a-new-thought-ab123456.md');
  assert.equal(new URL(p.url).searchParams.get('filename'), p.filename);
  assert.match(p.content, /layout: post/);
  assert.match(p.content, /<p>One paragraph.<\/p>\n<p>Another paragraph.<\/p>/);
});
test('keeps HTML, Liquid, and YAML-looking input as text', () => {
  const p = prepare({...draft,title:'Hello\nlayout: evil',body:'<script>alert(1)</script>\n{{ site.secret }}\n{% include bad %}',quote:''});
  assert.ok(!p.content.includes('<script>'));
  assert.ok(!p.content.includes('{{'));
  assert.ok(!p.content.includes('{%'));
  assert.match(p.content,/title: "Hello\\nlayout: evil"/);
  assert.match(p.content,/&lt;script&gt;/);
});
test('rejects empty writing and infers time instead of trusting a typed date', () => {
  for (const patch of [{title:' '},{body:' '}]) assert.throws(() => prepare({...draft,...patch}));
  assert.match(prepare({...draft,date:'bad'}).content, /2026-10-15T14:20:00.000Z/);
});
test('standalone pages have their own URL and stable filenames', () => {
  const p = prepare({...draft,kind:'page',title:'About me'});
  assert.equal(p.filename,'pages/about-me-ab123456.md');
  assert.match(p.content,/permalink: "\/about-me-ab123456\//);
  assert.equal(prepare({...draft,body:'Changed body'}).filename,prepare(draft).filename);
  assert.notEqual(prepare({...draft,id:'different-id'}).filename,prepare(draft).filename);
});

test('rich text roundtrips formatting while escaping executable markup', () => {
  const doc=[{runs:[{text:'Bold',bold:true},{text:'Italic',italic:true},{text:'Underline',underline:true},{text:'<img onerror=alert(1)>',bold:true,italic:true,underline:true}]}];
  const html=render(doc);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>Italic<\/em>/);
  assert.match(html, /<u>Underline<\/u>/);
  assert.ok(!html.includes('<img'));
  assert.ok(prepare({...draft,doc}).content.includes(html));
});
test('editing an existing post keeps its file and original date', () => {
  const p=prepare({...draft,title:'Renamed',sourcePath:'_posts/2026-09-01-original.md',originalDate:'2026-09-01T12:00:00Z'});
  assert.equal(p.filename,'_posts/2026-09-01-original.md');
  assert.match(p.url,/edit\/main\/_posts/);
  assert.match(p.content,/2026-09-01T12:00:00Z/);
});
