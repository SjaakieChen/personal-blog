// Optional browser regression check: PLAYWRIGHT_MODULE may point to an installed
// playwright or playwright-core module. Uses a local fake publisher only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),core=require('../assets/writer-core');
const make=(id,title,text)=>({id,kind:'post',title,quote:'',doc:[{runs:[{text}]}],createdAt:'2026-10-01T10:00:00Z',updatedAt:'2026-10-01T10:00:00Z'});
let cloud={revision:0,drafts:[make('new','New writing','A draft.'),make('legacy','About me','Original words.')],deleted:[]};
let entries=[{kind:'post',title:'Live post',path:'_posts/2026-10-01-live.md',sourceSha:'a'.repeat(40),publishedAt:'2026-10-01T10:00:00Z',date:'2026-10-01T10:00:00Z',html:'<p>Published words.</p>'},{kind:'post',title:'About me',path:'_posts/2026-10-02-about.md',sourceSha:'b'.repeat(40),publishedAt:'2026-10-02T10:00:00Z',date:'2026-10-02T10:00:00Z',html:'<p>Original words.</p>'}];
let pendingPublish,delayPublish=false,failIndex=false;
function completePublish(res,data){
 const [,front,html]=data.content.split('---\n'),meta={};
 for(const line of front.trim().split('\n')){const i=line.indexOf(':');if(i<0)continue;try{meta[line.slice(0,i)]=JSON.parse(line.slice(i+1));}catch{meta[line.slice(0,i)]=line.slice(i+1).trim();}}
 const old=entries.find(e=>e.path===data.path),time=new Date().toISOString(),sha='c'.repeat(40);
 entries=[{kind:meta.layout,title:meta.title,quote:meta.quote,html,references:meta.references,notes:meta.notes,quoteReference:meta.quote_reference,quoteLocator:meta.quote_locator,referenceKey:meta.reference_key,path:data.path,sourceSha:sha,date:meta.date,permalink:meta.permalink,publishedAt:old?.publishedAt || time,editedAt:old?time:undefined},...entries.filter(e=>e.path!==data.path)];
 res.end(JSON.stringify({sha,time}));
}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
 if(url.pathname==='/api/session'){res.end('{"connected":true}');return;}
 if(url.pathname==='/writing-index.json'){if(failIndex){res.writeHead(502);res.end('{}');}else res.end(JSON.stringify({posts:entries,pages:[]}));return;}
 if(url.pathname==='/api/drafts'){
  if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);if(data.revision!==cloud.revision){res.writeHead(409);res.end('{"error":"Conflict"}');return;}cloud={...data,revision:cloud.revision+1};}
  res.end(JSON.stringify(cloud));return;
 }
 if(url.pathname==='/api/publish'){let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);if(delayPublish)pendingPublish=()=>completePublish(res,data);else completePublish(res,data);return;}
 if(req.method!=='GET'){res.writeHead(405);res.end('{}');return;}
 if(url.pathname==='/write/'){
  res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(path.join(root,'write.html'),'utf8').replace(/^---[\s\S]*?---\s*/,'').replace(/\{\{\s*'([^']*)'\s*\|\s*relative_url\s*\}\}/g,'$1').replace(/\?v=\{\{[^}]*\}\}/g,'').replace('data-index="/writing-index.json"','data-index="/writing-index.json" data-private-desk="true"'));return;
 }
 if(url.pathname==='/' || url.pathname==='/posts/one/'){
  const feed=url.pathname==='/';res.setHeader('Content-Type','text/html');
  res.end('<html><head><link rel="stylesheet" href="/styles.css"></head><body><div class="blog-shell"><aside class="sidebar"><nav><a data-feed-navigation href="'+(feed?'':'/')+'#one">One</a><a data-feed-navigation href="'+(feed?'':'/')+'#two">Two</a></nav></aside><main class="main"><article id="one" class="post"><h1><a class="post-title" href="#one">One</a></h1><div style="height:1200px">First post.</div></article>'+(feed?'<article id="two" class="post"><h2>Two</h2><p>Second post.</p><a id="external" href="https://example.org/">Source</a></article>':'')+'</main></div><script src="/assets/links.js"></script></body></html>');return;
 }
 const file=path.join(root,url.pathname);if(!file.startsWith(root) || !fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const origin='http://127.0.0.1:'+server.address().port;
  const groups=()=>page.locator('#writing-nav').evaluate(nav=>{let group;const result={};for(const el of nav.children){if(el.classList.contains('nav-date'))result[group=el.textContent]=[];else result[group].push(el.firstChild.textContent);}return result;});
  const green=()=>page.waitForFunction(()=>document.querySelector('#connect-github').dataset.connected==='true');
  const inGroup=async(title,group)=>{await page.waitForFunction(({title,group})=>{let label;return [...document.querySelector('#writing-nav').children].some(el=>{if(el.classList.contains('nav-date'))label=el.textContent;return el.tagName==='BUTTON' && el.firstChild.textContent===title && label===group;});},{title,group});};
  await page.goto(origin+'/write/');await green();
  assert.deepEqual(await groups(),{Drafts:['New writing'],Edits:[],Published:['About me','Live post']});
  assert.equal(cloud.drafts.find(d=>d.id==='legacy').doc[0].runs[0].text,'Original words.');
  await page.getByRole('button',{name:'Live post',exact:true}).click();await green();await inGroup('Live post','Published');
  assert.equal(await page.locator('#delete-draft').isVisible(),false);
  await page.locator('#body').fill('Unpublished changes.');await inGroup('Live post','Edits');await green();
  assert.equal((await groups()).Published.includes('Live post'),true);
  const editBefore=structuredClone(cloud.drafts.find(d=>d.sourcePath==='_posts/2026-10-01-live.md'));
  await page.locator('#writing-nav [data-writing-state="published"]').filter({hasText:'Live post'}).click();await green();
  assert.equal(await page.locator('#body').textContent(),'Published words.');
  assert.equal(await page.locator('#body').getAttribute('contenteditable'),'false');
  assert.equal(await page.locator('#publish').isVisible(),false);
  assert.equal(await page.locator('#writing-nav [aria-current]').count(),1);
  assert.equal(await page.locator('#writing-nav [aria-current]').getAttribute('data-writing-state'),'published');
  await page.locator('#connect-github').click();await green();
  assert.deepEqual(cloud.drafts.find(d=>d.id===editBefore.id).doc,editBefore.doc);
  await page.reload();await green();
  assert.equal(await page.locator('#body').textContent(),'Published words.');
  assert.equal(await page.locator('#body').getAttribute('contenteditable'),'false');
  await page.locator('#resume-edits').click();
  assert.equal(await page.locator('#body').textContent(),'Unpublished changes.');
  assert.equal(await page.locator('#body').getAttribute('contenteditable'),'true');
  assert.equal(await page.locator('#writing-nav [aria-current]').getAttribute('data-writing-state'),'edits');
  await page.locator('#writing-nav [data-writing-state="published"]').filter({hasText:'Live post'}).click();
  await page.locator('#writing-nav [data-writing-state="edits"]').filter({hasText:'Live post'}).click();
  await page.reload();await green();await inGroup('Live post','Edits');
  assert.equal(await page.locator('#body').textContent(),'Unpublished changes.');
  await page.getByRole('button',{name:'Discard edits',exact:true}).click();await page.locator('#confirm-delete').click();await green();await inGroup('Live post','Published');
  assert.equal(await page.locator('#body').textContent(),'Published words.');
  await page.getByRole('button',{name:'New writing',exact:true}).click();await page.locator('#publish').click();
  await inGroup('New writing','Published');await green();
  assert.equal((await groups()).Drafts.includes('New writing'),false);
  await page.locator('#body').fill('Later revision.');await green();await inGroup('New writing','Edits');
  delayPublish=true;const requested=page.waitForRequest(r=>r.url().endsWith('/api/publish'));await page.locator('#publish').click();await requested;
  await page.locator('#body').fill('Typed while publishing.');await green();
  pendingPublish();delayPublish=false;
  await page.waitForFunction(()=>!document.querySelector('#publish').disabled);await inGroup('New writing','Edits');await green();
  assert.equal(await page.locator('#body').textContent(),'Typed while publishing.');
  await page.locator('#publish').click();await inGroup('New writing','Published');await green();
  await page.waitForFunction(()=>!document.querySelector('#publish').disabled);
  await page.reload();await green();await inGroup('New writing','Published');
  assert.equal((await groups()).Drafts.length,0);assert.equal((await groups()).Edits.length,0);
  await page.locator('#new-draft').click();await page.locator('#kind').selectOption('page');await page.locator('#title').fill('Appendix');await page.locator('#body').fill('Supporting material.');
  await page.locator('#publish').click();await inGroup('Appendix','Published');await green();
  assert.match(await page.locator('#view-published').getAttribute('href'),/\/personal-blog\/appendix-[\w-]+\/$/);
  await page.reload();await green();await inGroup('Appendix','Published');
  // The feed is a single document; a permalink sidebar returns to that feed.
  const reader=await context.newPage();await reader.goto(origin+'/');const pages=context.pages().length;
  await reader.locator('.sidebar').getByRole('link',{name:'Two',exact:true}).click();
  assert.equal(context.pages().length,pages);assert.equal(reader.url(),origin+'/#two');assert.equal(await reader.locator('article.post').count(),2);
  assert.ok(await reader.locator('.main').evaluate(el=>el.scrollTop)>500);
  assert.equal(await reader.locator('#external').getAttribute('target'),'_blank');
  await reader.goto(origin+'/posts/one/');await reader.locator('.sidebar').getByRole('link',{name:'Two',exact:true}).click();
  assert.equal(reader.url(),origin+'/#two');assert.equal(context.pages().length,pages);assert.equal(await reader.locator('article.post').count(),2);
  assert.deepEqual(errors,[]);
  console.log('PASS: published and edit entries coexist; live preview and saved edits remain separate through navigation, sync and reload; resume, discard, publish, in-flight edits and continuous feed.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
