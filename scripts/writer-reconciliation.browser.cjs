// Startup/reload reconciliation against a local fake publisher. Never writes live posts.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),core=require('../assets/writer-core');
const make=(id,title,text)=>({id,kind:'post',title,quote:'',doc:[{runs:[{text}]}],createdAt:'2026-10-01T10:00:00Z',updatedAt:'2026-10-01T10:00:00Z'});
const fingerprint=d=>JSON.stringify([d.kind,d.title.trim(),d.quote,core.render(d.doc,core.usedReferences(d),'comparison',d.notes),core.usedReferences(d),'','',core.usedNotes(d.doc,d.notes)]);
const orphan={...make('legacy','Genesis','test'),sourcePath:'_posts/deleted-legacy.md',sourceSha:'b'.repeat(40)};
const live={...make('live','Renamed live post','Current writing.'),sourcePath:'_posts/live.md',sourceSha:'a'.repeat(40),savedVersions:[make('history','Genesis','test')]};
live.publishedFingerprint=fingerprint(live);
const edited={...make('edited','Recovered writing','Unpublished newer words.'),sourcePath:'_posts/deleted-edits.md',sourceSha:'c'.repeat(40),targetPath:'_posts/deleted-edits.md',publishedFingerprint:fingerprint(make('edited','Recovered writing','Old public words.'))};
const clean={...make('clean','Deleted clean post','Published words.'),sourcePath:'_posts/deleted-clean.md',sourceSha:'d'.repeat(40)};clean.publishedFingerprint=fingerprint(clean);
let cloud={revision:0,drafts:structuredClone([live,orphan,edited,clean]),deleted:[]},indexMode='failed',publishCalls=0;
const entries=[{kind:'post',title:live.title,path:live.sourcePath,sourceSha:live.sourceSha,publishedAt:'2026-10-01T10:00:00Z',date:'2026-10-01T10:00:00Z',html:core.render(live.doc)}];
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
 if(url.pathname==='/api/session'){res.end('{"connected":true}');return;}
 if(url.pathname==='/writing-index.json'){
  if(indexMode==='failed'){res.writeHead(502);res.end('{}');}
  else res.end(JSON.stringify(indexMode==='partial'?{posts:[]}:{posts:entries,pages:[]}));return;
 }
 if(url.pathname==='/api/drafts'){
  if(req.method==='POST'){
   let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);
   if(data.revision!==cloud.revision){res.writeHead(409);res.end('{"error":"Conflict"}');return;}
   cloud={...data,revision:cloud.revision+1};
  }
  res.end(JSON.stringify(cloud));return;
 }
 if(url.pathname==='/api/publish'){publishCalls++;res.writeHead(500);res.end('{}');return;}
 if(req.method!=='GET'){res.writeHead(405);res.end('{}');return;}
 if(url.pathname==='/write/'){
  const html=fs.readFileSync(path.join(root,'write.html'),'utf8').replace(/^---[\s\S]*?---\s*/,'').replace(/\{\{\s*'([^']*)'\s*\|\s*relative_url\s*\}\}/g,'$1').replace(/\?v=\{\{[^}]*\}\}/g,'').replace('data-index="/writing-index.json"','data-index="/writing-index.json" data-private-desk="true"');
  res.setHeader('Content-Type','text/html');res.end(html);return;
 }
 const file=path.join(root,url.pathname);
 if(!file.startsWith(root+path.sep) || !fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext(),staleContext=await browser.newContext(),page=await context.newPage(),stale=await staleContext.newPage(),errors=[];
  for(const p of [page,stale])p.on('pageerror',error=>errors.push(error.message));
  const url='http://127.0.0.1:'+server.address().port+'/write/';
  const green=p=>p.waitForFunction(()=>document.querySelector('#connect-github').dataset.connected==='true',null,{timeout:15000});
  const failed=p=>p.waitForFunction(()=>document.querySelector('#connect-github').title.includes('GitHub could not be verified'));
  const focus=p=>p.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const groups=()=>page.locator('#writing-nav').evaluate(nav=>{let group;const result={};for(const el of nav.children){if(el.classList.contains('nav-date'))result[group=el.textContent]=[];else if(el.tagName==='BUTTON')result[group].push(el.firstChild.textContent);}return result;});
  const removedWriting=()=>cloud.deleted.filter(id=>['live','legacy','edited','clean'].includes(id)).sort();
  await page.goto(url);await failed(page);await stale.goto(url);await failed(stale);
  await staleContext.setOffline(true);
  assert.deepEqual(removedWriting(),[],'failed index leaves all source-linked writing untouched');
  assert.equal(cloud.drafts.find(d=>d.id==='legacy').sourcePath,orphan.sourcePath);
  indexMode='partial';await focus(page);await failed(page);
  assert.deepEqual(removedWriting(),[],'partial index cannot authorize cleanup');
  assert.equal(cloud.drafts.find(d=>d.id==='edited').sourcePath,edited.sourcePath);
  indexMode='complete';await focus(page);await green(page);
  assert.deepEqual(removedWriting(),['clean','edited','legacy']);
  assert.equal(cloud.drafts.length,2);
  const survivor=cloud.drafts.find(d=>d.id==='live'),recovered=cloud.drafts.find(d=>d.recoveredFrom?.id==='edited');
  assert.ok(survivor.savedVersions.some(v=>v.id==='legacy' && v.sourceSha===orphan.sourceSha));
  assert.ok(recovered);assert.deepEqual(recovered.doc,edited.doc);assert.equal(recovered.sourcePath,undefined);assert.equal(recovered.targetPath,undefined);
  assert.ok(recovered.savedVersions.some(v=>v.id==='edited' && v.sourcePath===edited.sourcePath));
  assert.deepEqual(await groups(),{Drafts:['Recovered writing'],Edits:[],Published:['Renamed live post']});
  await page.getByRole('button',{name:'Recovered writing',exact:true}).click();
  assert.equal(await page.locator('#body').textContent(),'Unpublished newer words.');
  assert.match(await page.locator('#post-time').textContent(),/Recovered unpublished writing/);
  await page.reload();await green(page);
  assert.equal(await page.locator('#body').textContent(),'Unpublished newer words.');
  // An old offline tab still has the old source paths; tombstones win on return.
  await staleContext.setOffline(false);await focus(stale);await green(stale);
  assert.equal(cloud.drafts.some(d=>['legacy','edited','clean'].includes(d.id)),false);
  assert.deepEqual(cloud.drafts.find(d=>d.id===recovered.id).doc,edited.doc);
  const fresh=await browser.newContext(),freshPage=await fresh.newPage();await freshPage.goto(url);await green(freshPage);
  assert.equal(await freshPage.locator('#writing-nav [data-writing-state="edits"]').count(),0);
  assert.equal(await freshPage.locator('#writing-nav').getByRole('button',{name:'Genesis',exact:true}).count(),0);
  // A clean active publication refreshes immediately when another device publishes.
  await page.getByRole('button',{name:'Renamed live post',exact:true}).click();await green(page);
  const remote={...make('live','Remote title','Remote body.'),quote:'Remote opening quote',quoteReference:'remote-reference',quoteLocator:'p. 2',referenceKey:'remote-key',references:[{id:'remote-reference',title:'Remote source',url:'https://example.org/source'}],notes:[{id:'remote-note',text:'Remote note'}],doc:[{runs:[{text:'Remote body.',reference:'remote-reference',note:'remote-note'}]}]};
  const remoteEntry=(sha,text,title=remote.title)=>({...entries[0],...remote,title,sourceSha:sha.repeat(40),permalink:'/posts/remote/',editedAt:'2026-10-21T12:00:00Z',html:core.render([{runs:[{text,reference:'remote-reference',note:'remote-note'}]}],remote.references,'ref-remote-key',remote.notes)});
  entries[0]=remoteEntry('e','Remote body.');await focus(page);await green(page);
  assert.equal(await page.locator('#title').textContent(),'Remote title','clean active title must update on focus');
  assert.match(await page.locator('#body').textContent(),/^Remote body\./);
  let synced=cloud.drafts.find(d=>d.id==='live');
  assert.equal(synced.sourceSha,'e'.repeat(40));assert.equal(synced.quote,remote.quote);assert.equal(synced.permalink,'/posts/remote/');
  assert.deepEqual(synced.references,remote.references);assert.deepEqual(synced.notes,remote.notes);assert.equal(synced.referenceKey,remote.referenceKey);
  entries[0]=remoteEntry('f','Second remote body.');await page.reload();await green(page);
  assert.match(await page.locator('#body').textContent(),/^Second remote body\./,'clean active writing updates on reload');
  // Real local edits retain their base revision; the Published preview stays current.
  await page.locator('#body').fill('My unpublished writing.');await green(page);
  const privateWriting=structuredClone(cloud.drafts.find(d=>d.id==='live'));
  entries[0]=remoteEntry('1','Third remote body.','Remote renamed title');await focus(page);await green(page);
  assert.equal(await page.locator('#body').textContent(),'My unpublished writing.');
  assert.equal(cloud.drafts.find(d=>d.id==='live').sourceSha,privateWriting.sourceSha);
  assert.deepEqual(cloud.drafts.find(d=>d.id==='live').doc,privateWriting.doc);
  await page.locator('#writing-nav [data-writing-state="published"]').filter({hasText:'Remote renamed title'}).click();await green(page);
  assert.equal(await page.locator('#body').getAttribute('contenteditable'),'false');
  assert.match(await page.locator('#body').textContent(),/^Third remote body\./);
  entries[0]=remoteEntry('2','Fourth remote body.','Newest remote title');await focus(page);await green(page);
  assert.match(await page.locator('#body').textContent(),/^Fourth remote body\./);
  assert.equal(await page.locator('#body').getAttribute('contenteditable'),'false');
  await page.locator('#resume-edits').click();
  assert.equal(await page.locator('#body').textContent(),'My unpublished writing.');
  assert.deepEqual(cloud.drafts.find(d=>d.id==='live').doc,privateWriting.doc);
  assert.equal(publishCalls,0,'reconciliation never publishes recovered writing');
  assert.deepEqual(errors,[]);
  console.log('PASS: startup/reload/focus reconcile legacy history and refresh clean remote publications; real edits and read-only Published previews remain separate; failed/partial indexes preserve data; clean deletions and stale-tab tombstones hold; no automatic publication.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
