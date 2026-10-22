// Real writing-desk lifecycle against a local fake publisher. No real API writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),core=require('../assets/writer-core');
const privatePDF='https://yoga-jiaqi.taile0df21.ts.net:8446/assets/evidence/drafts/example/paper.pdf';
const privateImage='https://yoga-jiaqi.taile0df21.ts.net:8446/assets/evidence/drafts/example/image.png';
const privateFragment='#media-image/assets/evidence/drafts/example/image.png';
const publicPDF='https://sjaakiechen.github.io/personal-blog/assets/evidence/example/paper.pdf';
const publicImage='https://sjaakiechen.github.io/personal-blog/assets/evidence/example/image.png';
const publicFragment='#media-image/assets/evidence/example/image.png';
const replacements={[privatePDF]:publicPDF,[privateImage]:publicImage,[privateFragment]:publicFragment};
const draft=id=>({id,kind:'page',title:'Media '+id,quote:'',doc:[{runs:[{text:'Read '},{text:'complete paper',link:privatePDF,underline:true},{text:' and '},{text:'figure',link:privateFragment},{text:'.'}]},{runs:[{text:'',reference:'image',label:'Image'}]},{runs:[{text:'Editable note.',note:'explanation'}]}],notes:[{id:'explanation',text:'Exact explanation.',citations:[{reference:'image',locator:'Figure 1'},{reference:'paper',locator:'p. 16'}]}],references:[{id:'image',title:'Original preview',url:privateImage,savedUrl:privatePDF,note:'Literal '+privatePDF},{id:'paper',title:'Complete paper',url:privatePDF}],savedVersions:[{doc:[{runs:[{text:'Original',link:privatePDF}]}]}],createdAt:'2026-10-01T10:00:00Z',updatedAt:'2026-10-01T10:00:00Z'});
let cloud,entries,pending,requests,publishMode='delay';
function commit(data){
 let content=data.content;
 for(const [from,to] of Object.entries(replacements))content=content.replaceAll(from,to);
 const [,front,html]=content.split('---\n'),meta={};
 for(const line of front.trim().split('\n')){const i=line.indexOf(':');if(i<0)continue;try{meta[line.slice(0,i)]=JSON.parse(line.slice(i+1));}catch{meta[line.slice(0,i)]=line.slice(i+1).trim();}}
 const old=entries.find(e=>e.path===data.path),sha=crypto.createHash('sha1').update('blob '+Buffer.byteLength(content)+'\0'+content).digest('hex'),time='2026-10-22T12:00:00Z';
 entries=[{kind:meta.layout,title:meta.title,quote:meta.quote,html,references:meta.references,notes:meta.notes,quoteReference:meta.quote_reference,quoteLocator:meta.quote_locator,referenceKey:meta.reference_key,path:data.path,sourceSha:sha,date:meta.date,permalink:meta.permalink,publishedAt:old?.publishedAt || time},...entries.filter(e=>e.path!==data.path)];
 return {sha,time,unchanged:old?.sourceSha===sha,linkReplacements:replacements,mediaPublished:true};
}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
 if(url.pathname==='/api/session'){res.end('{"connected":true}');return;}
 if(url.pathname==='/writing-index.json'){res.end(JSON.stringify({posts:[],pages:entries}));return;}
 if(url.pathname==='/assets/evidence/media.json'){res.end('{}');return;}
 if(url.pathname==='/api/drafts'){
  if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);if(data.revision!==cloud.revision){res.writeHead(409);res.end('{"error":"Conflict"}');return;}cloud={...data,revision:cloud.revision+1};}
  res.end(JSON.stringify(cloud));return;
 }
 if(url.pathname==='/api/publish'){
  let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);requests.push(data);
  if(publishMode==='lost'){commit(data);res.destroy();}
  else if(publishMode==='immediate')res.end(JSON.stringify(commit(data)));
  else pending=()=>res.end(JSON.stringify(commit(data)));
  return;
 }
 if(url.pathname==='/write/'){
  res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(path.join(root,'write.html'),'utf8').replace(/^---[\s\S]*?---\s*/,'').replace(/\{\{\s*'([^']*)'\s*\|\s*relative_url\s*\}\}/g,'$1').replace(/\?v=\{\{[^}]*\}\}/g,'').replace('data-index="/writing-index.json"','data-index="/writing-index.json" data-private-desk="true"'));return;
 }
 const file=path.join(root,url.pathname);if(req.method!=='GET' || !file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
const green=page=>page.waitForFunction(()=>document.querySelector('#connect-github').dataset.connected==='true');
const completed=page=>page.waitForFunction(()=>document.querySelector('#publish-heading').textContent==='Saved to GitHub' && !document.querySelector('#publish').disabled);
const state=(page,id)=>page.evaluate(id=>JSON.parse(localStorage.getItem('jiaqi-writing-desk-v1-synced-v3')).drafts.find(d=>d.id===id),id);
const navCount=(page,title,group)=>page.locator('#writing-nav [data-writing-state="'+group+'"]').filter({hasText:title}).count();
async function start(browser,id,mode='delay',shortTimeout=false){
 cloud={revision:0,drafts:[draft(id)],deleted:[]};entries=[];pending=null;requests=[];publishMode=mode;
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(short=>{window.mediaEvents=0;window.addEventListener('blog-media-published',()=>window.mediaEvents++);if(short){const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===120000?100:ms,...args);}},shortTimeout);
 await page.goto('http://127.0.0.1:'+server.address().port+'/write/');await green(page);
 assert.equal(await page.locator('#title').textContent(),'Media '+id);
 return {context,page,errors};
}
async function begin(page){const request=page.waitForRequest(r=>r.url().endsWith('/api/publish'));await page.locator('#publish').click();await request;}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  {
   const {context,page,errors}=await start(browser,'clean');
   assert.equal(await page.locator('#note-preview .citation').count(),2);
   await page.locator('#note-preview').getByRole('button',{name:'Edit note'}).click();
   await page.locator('#note-text').fill('Updated explanation.\nSecond line.');await page.locator('#note-form [type="submit"]').click();await green(page);
   assert.deepEqual((await state(page,'clean')).notes[0].citations,draft('clean').notes[0].citations,'editing note prose retains its multiple source citations');
   await begin(page);
   await page.locator('#body').evaluate(body=>{const text=body.lastElementChild.firstChild;window.savedCaretNode=text;body.focus();const range=document.createRange();range.setStart(text,4);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);});
   pending();await completed(page);await green(page);
   const saved=await state(page,'clean');
   assert.equal(saved.doc[0].runs[1].link,publicPDF);assert.equal(saved.doc[0].runs[3].link,publicFragment);
   assert.equal(saved.references[0].url,publicImage);assert.equal(saved.references[0].savedUrl,publicPDF);
   assert.equal(saved.references[0].note,'Literal '+privatePDF);assert.deepEqual(saved.savedVersions,draft('clean').savedVersions);
   assert.equal(saved.notes[0].text,'Updated explanation.\nSecond line.');assert.deepEqual(saved.notes[0].citations,draft('clean').notes[0].citations);
   assert.equal(await page.locator('#note-preview .citation').count(),2);
   assert.equal(saved.sourceSha,entries[0].sourceSha);assert.equal(saved.pendingPublication,undefined);
   assert.equal(await navCount(page,'Media clean','edits'),0);assert.equal(await navCount(page,'Media clean','published'),1);
   assert.equal(await page.locator('#body a').first().getAttribute('href'),publicPDF);
   assert.equal(await page.locator('#body .text-citation a').getAttribute('href'),publicImage);
   assert.equal(await page.evaluate(()=>getSelection().anchorNode===window.savedCaretNode && getSelection().anchorOffset===4),true,'promotion preserves the actual caret text node');
   assert.equal(await page.evaluate(()=>window.mediaEvents),1);assert.deepEqual(errors,[]);await context.close();
  }
  {
   const {context,page,errors}=await start(browser,'later');await begin(page);
   const laterURL='https://example.org/revised-paper.pdf';
   await page.locator('#body').evaluate((body,url)=>{body.querySelector('a').setAttribute('href',url);body.lastElementChild.append(' Typed while publishing.');body.dispatchEvent(new InputEvent('input',{bubbles:true}));},laterURL);await green(page);
   pending();await completed(page);await green(page);const saved=await state(page,'later');
   assert.equal(saved.doc[0].runs[1].link,laterURL);assert.equal(saved.doc[0].runs[3].link,publicFragment);assert.equal(saved.references[0].url,publicImage);
   assert.match(saved.doc.at(-1).runs.map(r=>r.text).join(''),/Typed while publishing/);
   assert.equal(await page.locator('#body a').first().getAttribute('href'),laterURL);assert.match(await page.locator('#body').textContent(),/Typed while publishing/);
   assert.equal(await navCount(page,'Media later','edits'),1);assert.equal(await navCount(page,'Media later','published'),1);
   assert.ok(entries[0].html.includes(publicPDF));assert.ok(!entries[0].html.includes(laterURL));assert.ok(!entries[0].html.includes('Typed while publishing'));
   assert.equal(saved.pendingPublication,undefined);assert.deepEqual(errors,[]);await context.close();
  }
  {
   const {context,page,errors}=await start(browser,'retry','lost');await begin(page);
   await page.waitForFunction(()=>document.querySelector('#publish-heading').textContent==='Not published');await green(page);
   const original=structuredClone(requests[0]),before=await state(page,'retry');assert.equal(before.pendingPublication.baseSha,null);
   assert.equal(before.pendingPublication.content,original.content);
   await page.reload();await green(page);assert.equal((await state(page,'retry')).sourceSha,entries[0].sourceSha,'reconciliation learns the committed SHA before retry');
   publishMode='immediate';await begin(page);await completed(page);await green(page);
   assert.deepEqual(requests[1],original,'lost-response retry retains the exact original body and base SHA');
   const saved=await state(page,'retry');assert.equal(saved.doc[0].runs[1].link,publicPDF);assert.equal(saved.pendingPublication,undefined);
   assert.equal(await navCount(page,'Media retry','edits'),0);assert.equal(await navCount(page,'Media retry','published'),1);
   assert.equal(entries.length,1);assert.equal(cloud.drafts.length,1);assert.match(await page.locator('#publication-status').textContent(),/already saved/);
   assert.deepEqual(errors,[]);await context.close();
  }
  {
   const {context,page,errors}=await start(browser,'timeout','delay',true);await begin(page);
   await page.waitForFunction(()=>document.querySelector('#publish-heading').textContent==='Not published');
   assert.equal(await page.locator('#publication-status').textContent(),'Publishing response timed out. Your draft is saved; retry safely.');
   const original=structuredClone(requests[0]);assert.equal((await state(page,'timeout')).pendingPublication.content,original.content);
   publishMode='immediate';await begin(page);await completed(page);await green(page);
   assert.deepEqual(requests[1],original);assert.equal(await navCount(page,'Media timeout','edits'),0);assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS: media promotion preserves prose/history/caret, current edits and changed links; clean drafts become Published; lost-response and timeout retries retain the exact persisted request.');
 }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.closeAllConnections();server.close();});
