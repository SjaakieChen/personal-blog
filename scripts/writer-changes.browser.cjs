// Local fixture only; never contacts the publisher or publishes writing.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const entry={kind:'post',title:'A small revision',quote:'',path:'_posts/2026-10-01-revision.md',sourceSha:'a'.repeat(40),publishedAt:'2026-10-01T10:00:00Z',html:'<p>The original sentence stays here.</p><p>A second paragraph remains unchanged.</p>'};
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1360,height:950}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      if(pathname==='/writing-index.json')return route.fulfill({json:{posts:[entry],pages:[]}});
      if(pathname==='/write/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'write.html'),'utf8').replace(/^---[\s\S]*?---\s*/,'').replace(/\{\{\s*'([^']*)'\s*\|\s*relative_url\s*\}\}/g,'$1').replace(/\?v=\{\{[^}]*\}\}/g,'')});
      const file=path.join(root,pathname);
      if(file.startsWith(root+path.sep) && fs.existsSync(file) && fs.statSync(file).isFile())return route.fulfill({path:file,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':undefined});
      throw new Error('Unexpected request: '+pathname);
    });
    await page.goto('http://localhost:43219/write/');
    await page.getByRole('button',{name:entry.title,exact:true}).click();
    const settle=()=>page.waitForTimeout(250);
    await settle();assert.equal(await page.locator('#edit-changes').isVisible(),false);
    await page.locator('#body').evaluate(el=>{
      window.originalEditorHTML=el.innerHTML;
      const node=el.querySelector('p').firstChild,r=document.createRange();r.setStart(node,4);r.setEnd(node,12);
      el.focus();const s=getSelection();s.removeAllRanges();s.addRange(r);
    });
    await page.keyboard.insertText('revised');await settle();
    assert.equal(await page.evaluate(()=>getSelection().anchorOffset),11,'comparison preserves typing position');
    assert.equal(await page.evaluate(()=>[...CSS.highlights.get('writing-added')].map(r=>r.toString()).join('')),'revised');
    await page.keyboard.press('Control+z');await settle();
    assert.equal(await page.locator('#body').innerHTML(),await page.evaluate(()=>window.originalEditorHTML),'Undo preserves original rich text');
    assert.equal(await page.locator('#edit-changes').isVisible(),false);
    await page.locator('#body').fill('The revised sentence stays here.\nA second paragraph remains unchanged.');await settle();
    await page.locator('#edit-changes summary').click();
    assert.match(await page.locator('#edit-change-list').textContent(),/originalrevised/);
    await page.screenshot({path:path.join(os.tmpdir(),'blog-edit-changes-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(os.tmpdir(),'blog-edit-changes-mobile.png'),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'comparison fits mobile width');
    await page.setViewportSize({width:1360,height:950});
    // Deletion-only changes remain discoverable even with no added range to paint.
    await page.locator('#body').fill('');await settle();
    assert.equal(await page.locator('#edit-changes').isVisible(),true);
    assert.match(await page.locator('#edit-change-list del').textContent(),/original sentence/);
    assert.equal(await page.evaluate(()=>CSS.highlights.get('writing-added').size),0);
    // Formatting-only changes show the original and edited appearance.
    await page.locator('#body').evaluate(el=>{el.innerHTML='<p>The <b>original</b> sentence stays here.</p><p>A second paragraph remains unchanged.</p>';el.dispatchEvent(new Event('input',{bubbles:true}));});await settle();
    assert.match(await page.locator('#edit-change-list').textContent(),/Formatting, layout or links changed/);
    assert.equal(await page.locator('.change-format-preview b,.change-format-preview strong').count(),1);
    // Title, quote and literal markup are compared safely as text.
    await page.locator('#title').fill('A smaller revision');await page.locator('#quote').fill('<img src=x onerror=alert(1)>');await settle();
    assert.equal(await page.locator('#edit-change-list img').count(),0);
    assert.ok((await page.locator('#edit-change-list').textContent()).includes('<img src=x onerror=alert(1)>'));
    // Metadata edits remain visible even when the body words match.
    const metadata=await page.evaluate(()=>{
      const original={id:'metadata',title:'Metadata',quote:'A quotation',quoteReference:'ref',quoteLocator:'p. 1',references:[{id:'ref',title:'Source',url:'https://example.com/old'}],notes:[{id:'note',text:'Original note'}],doc:[{runs:[{text:'Words',reference:'ref'},{text:'',note:'note'}]}]};
      const draft=structuredClone(original);draft.references[0].url='https://example.com/new';draft.notes[0].text='Revised note';draft.quoteLocator='p. 2';
      document.querySelector('#title').textContent=draft.title;document.querySelector('#quote').textContent=draft.quote;
      document.querySelector('#body').innerHTML=BlogWriter.render(draft.doc,draft.references,'comparison',draft.notes);
      BlogWritingChanges.update(draft,original);
      return document.querySelector('#edit-change-list').textContent;
    });
    assert.match(metadata,/https:\/\/example.com\/old/);assert.match(metadata,/https:\/\/example.com\/new/);
    assert.match(metadata,/OriginalRevised/);assert.match(metadata,/Quote source/);assert.match(metadata,/p\. 12/);
    await page.getByRole('button',{name:'New draft',exact:true}).click();await settle();
    assert.equal(await page.locator('#edit-changes').isVisible(),false);
    assert.equal(await page.evaluate(()=>CSS.highlights.has('writing-added')),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: text ranges, typing/Undo, deletion-only and formatting-only changes, title/quote, safe text, mobile layout and draft navigation. Screenshots in '+os.tmpdir());
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
