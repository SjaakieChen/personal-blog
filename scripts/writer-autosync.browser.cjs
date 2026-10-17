// Integration checks against a local fake publisher; never publishes real posts.
// PLAYWRIGHT_MODULE can point to an existing playwright / playwright-core module.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
let cloud={revision:0,drafts:[],deleted:[]};
let failRead=1,failWrite=0,failIndex=0,failSession=0,holdRead=null,holdWrite=null;
const calls={reads:0,writes:0,index:0,session:0,unexpected:[]};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('Content-Type','application/json');
  const fail=message=>{res.writeHead(502);res.end(JSON.stringify({error:message}));};
  if(url.pathname==='/api/session'){
    calls.session++;res.end(JSON.stringify({connected:!(failSession>0 && failSession--)}));return;
  }
  if(url.pathname==='/writing-index.json'){
    calls.index++;if(failIndex>0){failIndex--;fail('Index unavailable');return;}
    res.end('{"posts":[],"pages":[]}');return;
  }
  if(url.pathname==='/api/drafts'){
    if(req.method==='POST'){
      calls.writes++;let raw='';for await(const chunk of req)raw+=chunk;
      if(holdWrite)await holdWrite;
      if(failWrite>0){failWrite--;fail('Draft save unavailable');return;}
      const data=JSON.parse(raw);
      if(data.revision!==cloud.revision){res.writeHead(409);res.end('{"error":"Conflict"}');return;}
      cloud={...data,revision:cloud.revision+1};
    }else{
      calls.reads++;
      if(holdRead)await holdRead;
      if(failRead>0){failRead--;fail('Draft load unavailable');return;}
    }
    res.end(JSON.stringify(cloud));return;
  }
  if(req.method!=='GET'){calls.unexpected.push(url.pathname);res.writeHead(405);res.end('{}');return;}
  if(url.pathname==='/write/'){
    const html=fs.readFileSync(path.join(root,'write.html'),'utf8').replace(/^---[\s\S]*?---\s*/,'').replace(/\{\{\s*'([^']*)'\s*\|\s*relative_url\s*\}\}/g,'$1').replace(/\?v=\{\{[^}]*\}\}/g,'').replace('data-index="/writing-index.json"','data-index="/writing-index.json" data-private-desk="true"');
    res.setHeader('Content-Type','text/html');res.end(html);return;
  }
  const file=path.join(root,url.pathname);
  if(!file.startsWith(root+path.sep) || !fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let n=0;n<100;n++){if(predicate())return;await delay(50);}assert.fail('Server condition did not become true');}
function deferred(){let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext(),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const url='http://127.0.0.1:'+server.address().port+'/write/';
    const green=()=>page.waitForFunction(()=>document.querySelector('#connect-github').dataset.connected==='true',null,{timeout:12000});
    const failed=text=>page.waitForFunction(text=>{const dot=document.querySelector('#connect-github');return dot.dataset.connected==='false' && dot.title.includes(text) && dot.title.includes('Retrying automatically');},text);
    // An initial unavailable server recovers without a click, edit or focus event.
    await page.goto(url);await failed('Draft load unavailable');await green();
    assert.equal(calls.index,1,'opening uses one published-index check');
    await page.locator('#title').fill('Saved writing');await page.locator('#body').fill('Original words.');await green();
    assert.ok(JSON.stringify(cloud.drafts).includes('Original words.'));
    let before=calls.index;await page.reload();await green();
    assert.equal(calls.index-before,1,'reload uses one published-index check');
    assert.equal(await page.locator('#body').textContent(),'Original words.');

    // Failures still retry when the draft upload itself has already succeeded.
    failIndex=1;await page.reload();await failed('GitHub could not be verified');await green();
    failSession=1;await page.reload();await failed('GitHub could not be verified');await green();

    // Failed writes back off, retry automatically, and never show green early.
    failWrite=2;before=calls.writes;
    await page.locator('#body').fill('Keep these exact words.');await failed('Draft save unavailable');
    await green();assert.equal(calls.writes-before,3);
    assert.ok(JSON.stringify(cloud.drafts).includes('Keep these exact words.'));

    // Typing while an upload is pending must cause another automatic upload.
    let gate=deferred();holdWrite=gate.promise;before=calls.writes;
    await page.locator('#body').fill('An in-flight version.');await until(()=>calls.writes>before);
    await page.locator('#body').fill('Typed during the upload.');
    assert.equal(await page.locator('#connect-github').getAttribute('data-connected'),'false');
    holdWrite=null;gate.release();await green();
    assert.ok(JSON.stringify(cloud.drafts).includes('Typed during the upload.'));

    // Offline edits stay local, then reconnect automatically without a dot click.
    await context.setOffline(true);await page.locator('#body').fill('Written offline.');
    await page.waitForFunction(()=>document.querySelector('#connect-github').title.startsWith('Offline.'));
    before=calls.writes;await delay(1100);assert.equal(calls.writes,before);
    await context.setOffline(false);await green();
    assert.ok(JSON.stringify(cloud.drafts).includes('Written offline.'));

    // Returning to the tab, window or a restored page immediately checks Yoga.
    for(const event of ['visibilitychange','focus','pageshow']){
      cloud.drafts[0].doc=[{runs:[{text:'Remote words after '+event+'.'}]}];
      cloud.drafts[0].updatedAt=new Date(Date.now()+1000).toISOString();cloud.revision++;
      before=calls.reads;
      await page.evaluate(event=>{
        if(event==='visibilitychange')document.dispatchEvent(new Event(event));
        else window.dispatchEvent(event==='pageshow'?new PageTransitionEvent(event,{persisted:true}):new Event(event));
      },event);
      await until(()=>calls.reads>before);await green();
      assert.equal(await page.locator('#body').textContent(),'Remote words after '+event+'.');
    }

    // Repeated resume events during a sync queue one follow-up, not parallel writes.
    gate=deferred();holdRead=gate.promise;before=calls.reads;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await until(()=>calls.reads>before);
    await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
    await delay(150);assert.equal(calls.reads,before+1);
    holdRead=null;gate.release();await until(()=>calls.reads===before+2);await green();

    // A hung request times out and retries. Only this test advances the browser clock.
    await page.clock.install();gate=deferred();holdRead=gate.promise;before=calls.reads;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await until(()=>calls.reads>before);
    await page.clock.fastForward(45001);await failed('Sync request timed out');
    holdRead=null;gate.release();await page.clock.fastForward(2001);await green();
    await page.clock.resume();

    // Manual refresh still works, and another browser restores the cloud copy.
    before=calls.reads;await page.locator('#connect-github').click();await until(()=>calls.reads>before);await green();
    const other=await browser.newContext(),restored=await other.newPage();await restored.goto(url);
    await restored.waitForFunction(()=>document.querySelector('#connect-github').dataset.connected==='true');
    assert.equal(await restored.locator('#body').textContent(),'Remote words after pageshow.');
    await other.close();
    assert.deepEqual(errors,[]);assert.deepEqual(calls.unexpected,[]);
    console.log('PASS: automatic startup/reload sync, failed read/write/index/session retries, offline recovery, edits during upload, tab/window/page resume, queued refresh, timeout recovery and fresh-browser restore; no publication.');
  }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.closeAllConnections();server.close();});
