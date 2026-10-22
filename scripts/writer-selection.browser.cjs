// Caret and selection regression checks against a local fake publisher only.
// PLAYWRIGHT_MODULE selects an existing Playwright installation. Set
// WRITER_SOURCE_REF=HEAD to demonstrate a failure against an older writer.js.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),syncKey='jiaqi-writing-desk-v1-synced-v3';
const writerSource=process.env.WRITER_SOURCE_REF
  ?execFileSync('git',['show',process.env.WRITER_SOURCE_REF+':assets/writer.js'],{cwd:root,encoding:'utf8'})
  :fs.readFileSync(path.join(root,'assets/writer.js'),'utf8');
const richDoc=[
  {runs:[{text:'Alpha '},{text:'bold',bold:true},{text:' middle\nline tail.'}]},
  {runs:[{text:'Second '},{text:'italic',italic:true},{text:' ending.'}]}
];
const make=()=>({id:'selection-draft',kind:'post',title:'Selection regression',quote:'An opening quotation.',doc:structuredClone(richDoc),createdAt:'2026-10-01T10:00:00Z',updatedAt:'2026-10-01T10:00:00Z'});
let cloud={revision:0,drafts:[make()],deleted:[]},metadataVersion=0;
const requests={reads:0,writes:0,publish:0};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
  if(url.pathname==='/api/session'){res.end('{"connected":true}');return;}
  if(url.pathname==='/writing-index.json'){res.end('{"posts":[],"pages":[]}');return;}
  if(url.pathname==='/api/drafts'){
    if(req.method==='POST'){
      requests.writes++;let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);
      if(data.revision!==cloud.revision){res.writeHead(409);res.end('{"error":"Conflict"}');return;}
      cloud={...data,revision:cloud.revision+1};
    }else requests.reads++;
    res.end(JSON.stringify(cloud));return;
  }
  if(req.method!=='GET'){requests.publish++;res.writeHead(405);res.end('{}');return;}
  if(url.pathname==='/storage-fixture'){
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Storage event fixture</title>');return;
  }
  if(url.pathname==='/write/'){
    const html=fs.readFileSync(path.join(root,'write.html'),'utf8').replace(/^---[\s\S]*?---\s*/,'').replace(/\{\{\s*'([^']*)'\s*\|\s*relative_url\s*\}\}/g,'$1').replace(/\?v=\{\{[^}]*\}\}/g,'').replace('data-index="/writing-index.json"','data-index="/writing-index.json" data-private-desk="true"');
    res.setHeader('Content-Type','text/html');res.end(html);return;
  }
  if(url.pathname==='/assets/writer.js'){res.setHeader('Content-Type','application/javascript');res.end(writerSource);return;}
  const file=path.join(root,url.pathname);
  if(!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext(),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const origin='http://127.0.0.1:'+server.address().port;
    const green=()=>page.waitForFunction(()=>document.querySelector('#connect-github').dataset.connected==='true',null,{timeout:15000});
    const sync=async()=>{
      const before=requests.reads;
      const read=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/drafts' && r.request().method()==='GET');
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await read;await green();
      assert.ok(requests.reads>before,'a fresh sync must finish before checking the caret');
    };
    const remember=async(field,anchor,anchorOffset,focus=anchor,focusOffset=anchorOffset)=>page.evaluate(({field,anchor,anchorOffset,focus,focusOffset})=>{
      const el=document.getElementById(field),resolve=path=>path.reduce((node,index)=>node.childNodes[index],el);
      el.focus({preventScroll:true});
      const selection=window.getSelection(),a=resolve(anchor),f=resolve(focus);
      selection.setBaseAndExtent(a,anchorOffset,f,focusOffset);
      const main=document.getElementById('writing-main');
      window.selectionFixture={field,anchorNode:a,anchorOffset,focusNode:f,focusOffset,firstChild:el.firstChild,text:selection.toString(),scrollTop:main.scrollTop};
    },{field,anchor,anchorOffset,focus,focusOffset});
    const inspect=()=>page.evaluate(()=>{
      const selection=window.getSelection(),saved=window.selectionFixture,el=document.getElementById(saved.field);
      const describe=(node,offset)=>({node:node?.nodeName,text:node?.textContent,offset});
      return {field:document.activeElement.id,anchorSame:selection.anchorNode===saved.anchorNode && selection.anchorOffset===saved.anchorOffset,focusSame:selection.focusNode===saved.focusNode && selection.focusOffset===saved.focusOffset,firstChildSame:el.firstChild===saved.firstChild,text:selection.toString(),expectedText:saved.text,anchor:describe(selection.anchorNode,selection.anchorOffset),focus:describe(selection.focusNode,selection.focusOffset),scrollSame:document.getElementById('writing-main').scrollTop===saved.scrollTop};
    });
    const assertUnchanged=async(label)=>{
      const view=await inspect();
      assert.equal(view.anchorSame && view.focusSame,true,label+': exact caret/selection changed: '+JSON.stringify(view));
      assert.equal(view.firstChildSame,true,label+': an unchanged editable DOM must not be rebuilt');
      assert.equal(view.field,await page.evaluate(()=>window.selectionFixture.field),label+': focused field changed');
      assert.equal(view.text,view.expectedText,label+': selected writing changed');
      assert.equal(view.scrollSame,true,label+': writing scroll changed');
    };
    const metadataSync=async()=>{
      const draft=cloud.drafts.find(d=>d.id==='selection-draft');
      draft.savedVersions=[...(draft.savedVersions || []),{...make(),id:'history-'+(++metadataVersion)}];
      cloud.revision++;await sync();
    };
    const remoteDoc=async doc=>{
      cloud.drafts.find(d=>d.id==='selection-draft').doc=structuredClone(doc);cloud.revision++;await sync();
    };
    await page.goto(origin+'/write/');await green();

    // A history-only cloud update must preserve the live browser text nodes,
    // caret and next keystroke. This reproduces the original jump to offset 0.
    await remember('body',[0,1,0],2);
    await metadataSync();await assertUnchanged('history-only cloud update in the body');
    await page.keyboard.insertText('X');await green();
    assert.equal(await page.locator('#body strong').textContent(),'boXld','typing continues at the saved caret instead of the start');
    console.log('PASS: body caret and next insertion survive a history-only cloud update.');

    // Title and quote are separate contenteditable fields, so preserving only
    // the body Range would leave the same bug in either of these fields.
    for(const [field,offset] of [['title',9],['quote',3]]){
      await remember(field,[0],offset);await metadataSync();await assertUnchanged(field+' metadata update');
      const before=await page.locator('#'+field).textContent();await page.keyboard.insertText('X');await green();
      assert.equal(await page.locator('#'+field).textContent(),before.slice(0,offset)+'X'+before.slice(offset),field+' continues at its original caret');
    }
    console.log('PASS: title and quote carets survive background synchronization.');

    // Backwards ranges must retain direction and both endpoints across rich
    // paragraphs. This selection includes a real line break in the first block.
    await remoteDoc(richDoc);
    await remember('body',[2,1,0],4,[0,2],4);
    await metadataSync();await assertUnchanged('backwards rich multi-paragraph range');
    assert.match((await inspect()).text,/\n/,'the selection includes a rendered line break');

    // A caret at a BR boundary can be represented by a parent element offset.
    // A harmless refresh must not reinterpret it as the text before the break.
    await remember('body',[0],4);
    await metadataSync();await assertUnchanged('caret immediately after a line break');
    await page.keyboard.insertText('Z');await green();
    assert.match(await page.locator('#body p').first().innerHTML(),/<br>Zline tail\./,'typing after a line break stays on the second line');
    console.log('PASS: backwards rich selection and line-break caret survive synchronization.');

    // A second same-origin tab writes the shared store, producing a genuine
    // storage event in the editor. It has no editor script or network sync.
    const other=await context.newPage();await other.goto(origin+'/storage-fixture');await green();
    await remember('body',[0,0],3);
    const uploaded=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/drafts' && r.method()==='POST');
    await other.evaluate(key=>{
      const state=JSON.parse(localStorage.getItem(key)),draft=state.drafts.find(d=>d.id==='selection-draft');
      draft.quote='Quote updated from another tab.';
      draft.savedVersions=[...(draft.savedVersions || []),{...draft,savedVersions:undefined,id:'other-tab-history'}];
      localStorage.setItem(key,JSON.stringify(state));
    },syncKey);
    await page.waitForFunction(()=>document.getElementById('quote').textContent==='Quote updated from another tab.');
    await uploaded;await green();await assertUnchanged('cross-tab update to a different writing field');
    await other.close();
    console.log('PASS: genuine cross-tab storage refresh preserves the active body caret.');

    // Background refresh must leave the modal's own editing state alone. Its
    // input selection is independent of the body selection saved for insertion.
    for(const [button,dialog,input,cancel] of [
      ['add-reference','reference-dialog','reference-title','reference-cancel'],
      ['add-note','note-dialog','note-text','note-cancel']
    ]){
      await remember('body',[0,0],3);await page.locator('#'+button).click();
      const text='Unfinished '+input+' text';await page.locator('#'+input).fill(text);
      await page.locator('#'+input).evaluate(el=>el.setSelectionRange(4,9,'backward'));
      await metadataSync();
      assert.deepEqual(await page.evaluate(({dialog,input})=>{
        const el=document.getElementById(input);
        return {open:document.getElementById(dialog).open,focus:document.activeElement.id,value:el.value,start:el.selectionStart,end:el.selectionEnd,direction:el.selectionDirection};
      },{dialog,input}),{open:true,focus:input,value:text,start:4,end:9,direction:'backward'},dialog+' retains focused input, unfinished value and selection');
      await page.locator('#'+cancel).click();
    }
    console.log('PASS: reference and note dialogs retain focused input and unfinished text during metadata sync.');

    // A surviving DOM path can now identify different text after a remote
    // formatting edit. Restore by logical text position when structure changes.
    await remoteDoc([{runs:[{text:'Alpha '},{text:'bold',bold:true},{text:' tail'}]}]);
    await remember('body',[0,2],3);
    await remoteDoc([{runs:[{text:'Alpha '},{text:'bo',bold:true},{text:'ld '},{text:'ta',italic:true},{text:'il'}]}]);
    assert.deepEqual(await page.evaluate(()=>{
      const body=document.getElementById('body'),s=getSelection(),prefix=document.createRange();
      prefix.selectNodeContents(body);prefix.setEnd(s.anchorNode,s.anchorOffset);
      return {field:document.activeElement.id,offset:prefix.toString().length,collapsed:s.isCollapsed};
    }),{field:'body',offset:13,collapsed:true},'remote reformatting retains the logical caret instead of reusing a stale DOM path');
    await page.keyboard.insertText('X');await green();
    assert.equal(await page.locator('#body').textContent(),'Alpha bold taXil','next insertion after remote reformatting uses the same text position');
    console.log('PASS: actual remote formatting changes preserve caret position when an old DOM path points at different text.');

    // Real remote body changes need new DOM, but should restore a valid logical
    // caret position, clamping it to the end when the replacement is shorter.
    await remoteDoc([{runs:[{text:'Original editable paragraph.'}]}]);
    await remember('body',[0,0],7);
    await remoteDoc([{runs:[{text:'Changed editable paragraph with extra words.'}]}]);
    assert.deepEqual(await page.evaluate(()=>{const s=getSelection();return {field:document.activeElement.id,text:s.anchorNode.textContent,anchor:s.anchorOffset,focus:s.focusOffset,collapsed:s.isCollapsed};}),{field:'body',text:'Changed editable paragraph with extra words.',anchor:7,focus:7,collapsed:true},'actual content refresh restores the logical caret offset');
    await remoteDoc([{runs:[{text:'Tiny'}]}]);
    assert.deepEqual(await page.evaluate(()=>{const s=getSelection();return {field:document.activeElement.id,text:s.anchorNode.textContent,anchor:s.anchorOffset,focus:s.focusOffset,collapsed:s.isCollapsed};}),{field:'body',text:'Tiny',anchor:4,focus:4,collapsed:true},'shorter remote writing clamps the caret to a valid end position');
    await page.keyboard.insertText('!');await green();assert.equal(await page.locator('#body').textContent(),'Tiny!');
    await metadataSync();await page.keyboard.press('Control+z');await green();
    assert.equal(await page.locator('#body').textContent(),'Tiny','metadata sync preserves native Undo for the latest typing');
    console.log('PASS: native Ctrl+Z still undoes the latest typing after metadata-only synchronization.');
    assert.equal(requests.publish,0,'the suite must never publish or call a mutating endpoint except its fake draft store');
    assert.deepEqual(errors,[]);
    console.log('PASS: actual remote content changes restore and clamp the caret; no live server or publication is used.');
  }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.closeAllConnections();server.close();});
