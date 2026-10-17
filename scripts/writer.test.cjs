const test = require('node:test');
const assert = require('node:assert/strict');
const {prepare: build, render} = require('../assets/writer-core.js');
const {parseCitation}=require('../assets/writer-core.js');
const {renderNotes,usedNotes}=require('../assets/writer-core.js');
const prepare = draft => build(draft, new Date('2026-10-15T14:20:00Z'));
const draft = {id:'ab123456-7890',kind:'post',title:'A new thought',quote:'',date:'2026-10-15',body:'One paragraph.\n\nAnother paragraph.'};
const references=[{id:'source-1',title:'Paper <title>',url:'https://example.org/paper.pdf',author:'Author',details:'2026',savedUrl:'/personal-blog/reference/'}];

test('note citations survive source cleanup and use the same reference destination',()=>{
  const core=require('../assets/writer-core');
  const d={...draft,doc:[{runs:[{text:'A sentence.',note:'n'}]}],notes:[{id:'n',text:'Extra detail.',reference:'source-1'}],references:[{id:'unused',title:'Unused',url:'https://example.org/unused'},...references]};
  assert.deepEqual(core.usedReferences(d),references);
  const html=prepare(d).content;
  assert.match(html,/Extra detail\.<sup class="citation"/);
  assert.match(html,/href="#ref-ab123456-7890-1"/);
  assert.doesNotMatch(html,/example.org\/unused/);
  assert.throws(()=>prepare({...d,references:[]}),/explanation citation/);
  assert.deepEqual(core.usedReferences({...d,doc:[{runs:[{text:'No note'}]}]}),[]);
});

test('targeted JSON updates retain identity and history and reject stale writing',()=>{
  const core=require('../assets/writer-core');
  const base={...draft,doc:[{runs:[{text:'Original text'}]}],sourcePath:'_posts/original.md',sourceSha:'abc',createdAt:'2026-10-15T00:00:00Z'};
  const updated={...base,doc:[{runs:[{text:'Original text',reference:'source-1'}]}],references};
  const data={type:'blog-draft-update',version:1,id:base.id,base,updated};
  const result=core.applyDraftUpdate(base,data);
  assert.equal(result.id,base.id);assert.equal(result.sourceSha,'abc');assert.equal(result.sourcePath,base.sourcePath);assert.equal(result.createdAt,base.createdAt);
  assert.deepEqual(result.savedVersions,[base]);assert.equal(result.doc[0].runs[0].reference,'source-1');
  assert.equal(core.applyDraftUpdate(result,data),result,'reimport is idempotent');
  assert.throws(()=>core.applyDraftUpdate({...base,doc:[{runs:[{text:'New typing'}]}]},data),/newer edits/);
  assert.throws(()=>core.applyDraftUpdate(base,{...data,id:'different'}),/Invalid/);
  assert.throws(()=>core.applyDraftUpdate(base,{...data,updated:{...updated,title:'Duplicate'}}),/title and type/);
  assert.equal(base.doc[0].runs[0].text,'Original text');assert.equal(base.savedVersions,undefined);
});

test('references include only live body and opening-quote citations, with compact numbering',()=>{
  const refs=['unused','quote','body','named'].map(id=>({id,title:id,url:'https://example.org/'+id}));
  const doc=[{runs:[{text:'First',reference:'body'},{text:' Again',reference:'body'},{text:'',reference:'named',label:'demo',labelStyle:'small'}]}];
  const d={...draft,doc,references:refs,quote:'An opening quote',quoteReference:'quote'};
  assert.deepEqual(require('../assets/writer-core').usedReferences(d).map(r=>r.id),['quote','body','named']);
  const output=prepare(d).content;
  assert.ok(!output.includes('https://example.org/unused'));assert.match(output,/>\[2\]<\/a>/);
  assert.match(output,/data-label-style="small"/);
  const withoutQuote=prepare({...d,quote:''}).content;
  assert.ok(!withoutQuote.includes('https://example.org/quote'));assert.match(withoutQuote,/quote_reference: ""/);
  assert.match(withoutQuote,/>\[1\]<\/a>/);
  const withoutAny=prepare({...d,quote:'',doc:[{runs:[{text:'No citations.'}]}]}).content;
  assert.match(withoutAny,/references: \[\]/);assert.ok(!withoutAny.includes('aria-label="References"'));
  assert.equal(d.references.length,4,'local metadata remains available for Undo');
});

test('named citations display the requested words and keep source links and metadata',()=>{
  const data={type:'blog-citation',version:1,source:references[0],displayText:'our collective reaction'};
  const parsed=parseCitation(data);
  assert.equal(parsed.displayText,'our collective reaction');assert.equal(parsed.quote,'');
  assert.equal(parsed.displayStyle,'normal');
  assert.equal(parseCitation({...data,displayStyle:'small'}).displayStyle,'small');
  assert.throws(()=>parseCitation({...data,displayStyle:'huge'}),/small or normal/);
  assert.throws(()=>parseCitation({...data,displayText:{text:'invalid'}}),/display text/);
  const doc=[{runs:[{text:'',reference:'source-1',label:parsed.displayText,locator:'Section 2'}]}];
  const html=render(doc,references,'ref-example');
  assert.match(html,/class="text-citation"/);assert.match(html,/data-label="our collective reaction"/);
  assert.match(html,/href="https:\/\/example.org\/paper.pdf"/);assert.match(html,/>our collective reaction<\/a>/);
  assert.match(html,/target="_blank" rel="noopener noreferrer"/);assert.ok(!html.includes('[1]'));assert.ok(!html.includes('<q>'));
  assert.match(prepare({...draft,doc,references}).content,/aria-label="References"/);
  const small=render([{runs:[{text:'',reference:'source-1',label:'summary of our reaction',labelStyle:'small'}]}],references);
  assert.match(small,/<sup class="text-citation citation"/);
  assert.match(small,/data-label-style="small"/);
  assert.match(small,/>summary of our reaction<\/a>/);
  const escaped=render([{runs:[{text:'',reference:'source-1',label:'<img src=x onerror=alert(1)>'}]}],references);
  assert.ok(!escaped.includes('<img'));assert.match(escaped,/&lt;img/);
});

test('citation markers show only the number while preserving section details and targets',()=>{
  const {citation}=require('../assets/writer-core.js');
  const html=citation('source-1',references,'ref-test','Section: A long heading');
  assert.match(html,/>\[1\]<\/a>/);
  assert.ok(!html.includes('[1,'));
  assert.match(html,/data-locator="Section: A long heading"/);
  assert.match(html,/title="Section: A long heading"/);
  assert.match(html,/href="#ref-test-1"/);
});

test('explanation notes follow text order, remain separate from sources, and escape text',()=>{
  const notes=[{id:'later',text:'Second explanation'},{id:'first',text:'Extra <script>detail</script>\nNext line'},{id:'unused',text:'Not attached'}];
  const doc=[{runs:[{text:'First sentence.',note:'first'},{text:'Second sentence.',note:'later',reference:'source-1'}]}];
  assert.deepEqual(usedNotes(doc,notes).map(n=>n.id),['first','later']);
  const html=render(doc,references,'ref-test',notes);
  assert.match(html,/href="#ref-test-note-1"[^>]*>\*<\/a>/);
  assert.match(html,/href="#ref-test-note-2"[^>]*>\*\*<\/a>/);
  assert.match(html,/>\[1\]<\/a>/);
  const footer=renderNotes(doc,notes,'ref-test');
  assert.match(footer,/id="ref-test-note-1"/);assert.match(footer,/&lt;script&gt;detail&lt;\/script&gt;<br>Next line/);
  assert.ok(!footer.includes('Not attached'));
  const prepared=prepare({...draft,doc,notes,references});
  assert.match(prepared.content,/notes: \[\{"id":"first"/);
  assert.ok(prepared.content.indexOf('aria-label="Notes"')<prepared.content.indexOf('aria-label="References"'));
  assert.throws(()=>prepare({...draft,doc,notes:[],references}),/explanation is missing/);
  assert.throws(()=>prepare({...draft,notes:[{id:'bad',text:' '}]}),/explanation needs text/);
  assert.throws(()=>prepare({...draft,notes:[notes[0],notes[0]]}),/unique ID/);
});

test('source links open separately while citation and explanation anchors stay on the page',()=>{
  const notes=[{id:'note',text:'Explanation'}];
  const doc=[{runs:[{text:'Linked sentence',link:'/reference-page/',reference:'source-1',note:'note'}]}];
  const prepared=prepare({...draft,doc,references,notes});
  const links=prepared.content.match(/<a\b[^>]*>/g);
  assert.equal(links.length,5);
  const anchors=links.filter(a=>a.includes('href="#'));
  assert.equal(anchors.length,2);
  anchors.forEach(a=>assert.doesNotMatch(a,/target=/));
  links.filter(a=>!anchors.includes(a)).forEach(a=>{assert.match(a,/target="_blank"/);assert.match(a,/rel="noopener noreferrer"/);});
});

test('citation JSON validates schema and URLs and preserves the quoted text',()=>{
  const data=require('../assets/citations/genesis-1-3.json');
  const citation=parseCitation(data);
  assert.equal(citation.quote,'And God said, Let there be light: and there was light.');
  assert.equal(citation.locator,'Genesis 1:3');
  assert.equal(citation.source.author,'');
  assert.throws(()=>parseCitation({...data,version:2}),/version 1/);
  for(const url of ['javascript:alert(1)','data:text/html,test','//example.org','/\\example.org'])assert.throws(()=>parseCitation({...data,source:{...data.source,url}}),/valid source URL/);
  for(const value of [null,{},[],42,'a'.repeat(20001)])assert.throws(()=>parseCitation({...data,quote:value}),/Invalid citation quote/);
  assert.throws(()=>parseCitation({...data,source:{...data.source,title:''}}),/title/);
  const malicious=parseCitation({...data,quote:'<img src=x onerror=alert(1)>'});
  assert.ok(!render([{runs:[{text:malicious.quote,quoted:true}]}]).includes('<img'));
});
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
