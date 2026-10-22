// Publication feedback geometry in the real writer, using only a local fake API.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const message='This draft links to a private attachment. Promote the attachment to the public blog and replace its link before publishing. Your draft stays private.';
const doc=Array.from({length:50},()=>({runs:[{text:'Long article context. The writing must remain unchanged while publication feedback stays within view. '.repeat(4)}]}));
let cloud={revision:1,deleted:[],drafts:[{id:'status-fixture',kind:'page',title:'Long private article',quote:'',doc,createdAt:'2026-10-22T10:00:00Z',updatedAt:'2026-10-22T10:00:00Z'}]};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('Content-Type','application/json');
  if(url.pathname==='/api/session'){res.end('{"connected":true,"login":"Fixture"}');return;}
  if(url.pathname==='/writing-index.json'){res.end('{"posts":[],"pages":[]}');return;}
  if(url.pathname==='/assets/evidence/media.json'){res.end('{}');return;}
  if(url.pathname==='/api/drafts'){
    if(req.method==='POST'){let raw='';for await(const part of req)raw+=part;cloud={...JSON.parse(raw),revision:cloud.revision+1};}
    res.end(JSON.stringify(cloud));return;
  }
  if(url.pathname==='/api/publish'){for await(const part of req){}res.writeHead(422);res.end(JSON.stringify({error:message}));return;}
  if(url.pathname==='/write/'){
    res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(path.join(root,'write.html'),'utf8').replace(/^---[\s\S]*?---\s*/,'')
      .replace(/\{\{\s*'([^']*)'\s*\|\s*relative_url\s*\}\}/g,'$1').replace(/\?v=\{\{[^}]*\}\}/g,'')
      .replace('data-index="/writing-index.json"','data-index="/writing-index.json" data-private-desk="true"'));return;
  }
  const file=path.resolve(root,'.'+url.pathname);
  if(req.method==='GET' && file.startsWith(root+path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()){
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));return;
  }
  res.writeHead(404);res.end('{}');
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/write/');
    await page.waitForFunction(()=>document.querySelector('#connect-github').dataset.connected==='true');
    const before=await page.locator('#body').innerHTML();
    for(const width of [1280,390,320]){
      await page.setViewportSize({width,height:width===1280?900:844});
      for(const position of [0,1400]){
        await page.locator('#writing-main').evaluate((main,top)=>{main.scrollTop=top;},position);
        const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/publish');
        const publish=await page.locator('#publish').boundingBox();
        await page.mouse.click(publish.x+publish.width/2,publish.y+publish.height/2);await response;
        await page.waitForFunction(message=>document.querySelector('#publication-status').textContent===message && !document.querySelector('#publish').disabled,message);
        const box=await page.evaluate(()=>{
          const main=document.querySelector('#writing-main'),status=document.querySelector('#publication-status').getBoundingClientRect(),button=document.querySelector('#publish').getBoundingClientRect(),chrome=document.querySelector('.editor-chrome').getBoundingClientRect(),bounds=main.getBoundingClientRect();
          return {statusTop:status.top,statusBottom:status.bottom,buttonTop:button.top,buttonBottom:button.bottom,mainTop:bounds.top,mainBottom:bounds.bottom,chromeHeight:chrome.height,mainHeight:bounds.height,scroll:main.scrollTop,width:innerWidth,pageWidth:document.documentElement.scrollWidth,mainWidth:main.clientWidth,mainScrollWidth:main.scrollWidth};
        });
        assert.ok(box.statusTop>=box.mainTop && box.statusBottom<=box.mainBottom,'entire error is visible at '+width+'px and scroll '+position);
        assert.ok(box.buttonTop>=box.mainTop && box.buttonBottom<=box.mainBottom,'Publish remains in view');
        assert.ok(box.chromeHeight<box.mainHeight*0.8,'compact feedback leaves room for writing');
        assert.ok(box.pageWidth<=box.width && box.mainScrollWidth<=box.mainWidth+1,'no mobile horizontal overflow');
        if(position)assert.ok(box.scroll>1000,'reporting an error does not scroll back to the article top: '+JSON.stringify({width,position,box}));
        assert.equal(await page.locator('#body').innerHTML(),before,'publication feedback does not rewrite the article');
      }
    }
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(()=>document.querySelector('#connect-github').dataset.connected==='true');
    assert.equal(await page.locator('#publication-status').textContent(),message,'same-draft sync preserves the visible result');
    assert.equal(await page.locator('#publication-status').getAttribute('role'),'status');
    assert.equal(await page.locator('#publication-status').getAttribute('aria-atomic'),'true');
    await page.evaluate(()=>{
      document.querySelector('#github-login').hidden=false;document.querySelector('#github-code').textContent='TEST-CODE';
      const view=document.querySelector('#view-published');view.hidden=false;view.href='https://example.org/published';
    });
    await page.getByRole('link',{name:'Open GitHub sign-in'}).focus();
    assert.ok((await page.getByRole('link',{name:'Open GitHub sign-in'}).boundingBox()).y<844,'sign-in link remains reachable in the compact panel');
    await page.locator('#view-published').focus();
    assert.ok((await page.locator('#view-published').boundingBox()).y<844,'published link remains reachable');
    assert.deepEqual(cloud.drafts[0].doc,doc,'only draft metadata may change after failed publication');
    assert.deepEqual(errors,[]);
    console.log('Publication feedback checks passed: visible errors at top/scrolled desktop and mobile, retained writing/status, accessible sign-in and published links.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
