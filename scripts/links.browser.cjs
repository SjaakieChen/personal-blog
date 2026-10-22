// Fragment navigation against the real writer and a duplicate-media feed fixture.
// Every endpoint is local; no real drafts or publication services are contacted.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),fragment='media-evidence--ib-physics-extended-essay-page-16';
let cloud,origin;
const html=()=>fs.readFileSync(path.join(root,'write.html'),'utf8').replace(/^---[\s\S]*?---\s*/,'')
  .replace(/\{\{\s*'([^']*)'\s*\|\s*relative_url\s*\}\}/g,'$1').replace(/\?v=\{\{[^}]*\}\}/g,'')
  .replace(/<script src="\/assets\/evidence-media\.js"[^>]*><\/script>/,'')
  .replace('data-index="/writing-index.json"','data-index="/writing-index.json" data-private-desk="true"');
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/session'){res.setHeader('Content-Type','application/json');res.end('{"connected":true}');return;}
  if(url.pathname==='/writing-index.json'){res.setHeader('Content-Type','application/json');res.end('{"posts":[],"pages":[]}');return;}
  if(url.pathname==='/api/drafts'){
    if(req.method==='POST'){let raw='';for await(const part of req)raw+=part;cloud={...JSON.parse(raw),revision:cloud.revision+1};}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(cloud));return;
  }
  if(url.pathname==='/write/'){res.setHeader('Content-Type','text/html');res.end(html());return;}
  if(url.pathname==='/full.pdf'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Full PDF destination</title>Full PDF destination');return;}
  if(url.pathname==='/feed'){
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><script src="/assets/links.js" defer></script><a href="/full.pdf">Full PDF</a>'+[1,2].map(n=>
      '<article class="post" id="article-'+n+'"><div class="post-copy"><a href="#'+fragment+'" target="_blank">Figure '+n+'</a></div>'
      +'<aside class="post-media"><div style="height:900px"></div><figure id="'+fragment+'">Figure '+n+'</figure></aside></article>').join(''));return;
  }
  const file=path.resolve(root,'.'+url.pathname);
  if(req.method==='GET' && file.startsWith(root+path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()){
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));return;
  }
  res.writeHead(404);res.end();
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const doc=[{runs:[{text:'Results figure',link:'#'+fragment,underline:true}]},{runs:[{text:'Full PDF',link:origin+'/full.pdf'}]}];
  cloud={revision:1,deleted:[],drafts:[{id:'fragment-fixture',kind:'page',title:'Figure navigation',quote:'',doc,createdAt:'2026-10-22T10:00:00Z',updatedAt:'2026-10-22T10:00:00Z'}]};
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/write/');await page.locator('#body a').first().waitFor();
    await page.waitForFunction(()=>document.getElementById('connect-github').dataset.connected==='true');
    assert.equal(await page.locator('#body').getAttribute('contenteditable'),'true','test uses the actual editable writer');
    const before=await page.locator('#body').innerHTML();
    await page.evaluate(fragment=>{
      const pane=document.getElementById('evidence-media-preview');pane.hidden=false;
      pane.innerHTML='<div style="height:1100px"></div><figure id="'+fragment+'" hidden><figcaption>Results preview</figcaption><div style="height:600px"></div></figure>';
      const target=pane.querySelector('figure'),scroll=target.scrollIntoView.bind(target);
      target.addEventListener('blog-media-reveal',event=>{window.revealTargetMatches=event.detail.target===target;target.hidden=false;});
      target.scrollIntoView=options=>{window.visibleBeforeScroll=!target.hidden;scroll(options);};
    },fragment);
    await page.getByRole('link',{name:'Results figure',exact:true}).click();
    assert.equal(page.url(),origin+'/write/#'+fragment);
    assert.equal(await page.locator('#body a').first().getAttribute('target'),null);
    assert.equal(page.context().pages().length,1,'in-page figure opens no window');
    assert.deepEqual(await page.evaluate(()=>[window.revealTargetMatches,window.visibleBeforeScroll]),[true,true],'hidden slide is revealed synchronously before scrolling');
    const target=page.locator('#'+fragment);
    assert.ok((await target.boundingBox()).y<800,'figure enters the viewport');
    assert.equal(await page.locator('#body').innerHTML(),before,'navigation leaves editable rich text unchanged');
    const save=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/drafts' && response.request().method()==='POST');
    await page.locator('#body').evaluate(body=>{body.lastElementChild.append(' Saved edit.');body.dispatchEvent(new Event('input',{bubbles:true}));});
    await save;
    assert.equal(cloud.drafts[0].doc[0].runs[0].link,'#'+fragment,'editor roundtrip retains the fragment');
    assert.equal(await page.getByRole('link',{name:'Full PDF',exact:true}).getAttribute('target'),'_blank','editor retains existing full-PDF link behavior');
    const editorPopupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'Full PDF',exact:true}).click();
    const editorPopup=await editorPopupPromise;await editorPopup.waitForLoadState('domcontentloaded');
    assert.equal(editorPopup.url(),origin+'/full.pdf','normal full-PDF click in the editable writer opens a separate tab');
    assert.equal(await editorPopup.evaluate(()=>window.opener),null,'document tab has no access to its opener');
    assert.equal(await editorPopup.evaluate(()=>document.referrer),'','document tab receives no referrer');
    assert.equal(page.url(),origin+'/write/#'+fragment,'opening the document leaves the editor on the same draft');
    await editorPopup.close();
    const modified=await page.getByRole('link',{name:'Full PDF',exact:true}).evaluate(link=>{
      const original=window.open,calls=[];window.open=(...args)=>calls.push(args);
      const event=new MouseEvent('click',{bubbles:true,cancelable:true,button:0,ctrlKey:true});
      // Cancel in a later listener only to avoid launching a real modifier tab.
      let intercepted;link.addEventListener('click',e=>{intercepted=e.defaultPrevented;e.preventDefault();},{once:true});
      link.dispatchEvent(event);window.open=original;return {calls:calls.length,intercepted};
    });
    assert.deepEqual(modified,{calls:0,intercepted:false},'modified clicks retain browser behavior');
    await page.goto(origin+'/feed');
    const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'Full PDF',exact:true}).click();
    const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');
    assert.equal(popup.url(),origin+'/full.pdf','complete PDF remains a separate tab');await popup.close();
    await page.evaluate(()=>document.querySelectorAll('.post-media figure').forEach(target=>{
      const scroll=target.scrollIntoView.bind(target);target.scrollIntoView=options=>{window.scrolledArticle=target.closest('.post').id;scroll(options);};
    }));
    await page.getByRole('link',{name:'Figure 2',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.scrolledArticle),'article-2','duplicate media IDs resolve within the clicked article');
    await page.getByRole('link',{name:'Figure 1',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.scrolledArticle),'article-1','repeat same-hash click still scrolls its own figure');
    assert.deepEqual(errors,[]);
    console.log('Fragment browser checks passed: real editable writer, reveal-before-scroll, clean roundtrip, actual secure full-PDF popups, modifier semantics, article-scoped feed navigation.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
