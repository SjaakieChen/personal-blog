// Fragment navigation against the real writer and a duplicate-media feed fixture.
// Every endpoint is local; no real drafts or publication services are contacted.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),fragment='media-evidence--ib-physics-extended-essay-page-16';
const linksSource=process.env.LINKS_SOURCE_REF
  ?execFileSync('git',['show',process.env.LINKS_SOURCE_REF+':assets/links.js'],{cwd:root,encoding:'utf8'})
  :fs.readFileSync(path.join(root,'assets/links.js'),'utf8');
const imagePath='/assets/evidence/test/lenses.png',publicImage='https://sjaakiechen.github.io/personal-blog'+imagePath;
const imageFragment='#media-image'+imagePath;
let cloud,origin;
const html=(images=false)=>fs.readFileSync(path.join(root,'write.html'),'utf8').replace(/^---[\s\S]*?---\s*/,'')
  .replace(/\{\{\s*'([^']*)'\s*\|\s*relative_url\s*\}\}/g,'$1').replace(/\?v=\{\{[^}]*\}\}/g,'')
  .replace(/<script src="\/assets\/evidence-media\.js"[^>]*><\/script>/,match=>images?match:'')
  .replace('data-index="/writing-index.json"','data-index="/writing-index.json" data-private-desk="true"');
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/session'){res.setHeader('Content-Type','application/json');res.end('{"connected":true}');return;}
  if(url.pathname==='/writing-index.json'){res.setHeader('Content-Type','application/json');res.end('{"posts":[],"pages":[]}');return;}
  if(url.pathname==='/api/drafts'){
    if(req.method==='POST'){let raw='';for await(const part of req)raw+=part;cloud={...JSON.parse(raw),revision:cloud.revision+1};}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(cloud));return;
  }
  if(url.pathname==='/write/'){res.setHeader('Content-Type','text/html');res.end(html(url.searchParams.has('images')));return;}
  if(url.pathname==='/assets/evidence/media.json'){res.setHeader('Content-Type','application/json');res.end('{}');return;}
  if(url.pathname==='/assets/links.js'){res.setHeader('Content-Type','application/javascript');res.end(linksSource);return;}
  if(url.pathname===imagePath){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#abcdef"/></svg>');return;}
  if(url.pathname==='/full.pdf'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Full PDF destination</title>Full PDF destination');return;}
  if(url.pathname==='/feed'){
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><script src="/assets/links.js" defer></script><a href="/full.pdf">Full PDF</a>'+[1,2].map(n=>
      '<article class="post" id="article-'+n+'"><div class="post-copy"><a href="#'+fragment+'" target="_blank">Figure '+n+'</a></div>'
      +'<aside class="post-media"><div style="height:900px"></div><figure id="'+fragment+'">Figure '+n+'</figure></aside></article>').join(''));return;
  }
  if(url.pathname==='/image-feed'){
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><link rel="stylesheet" href="/styles.css"><script src="/assets/links.js" defer></script><script src="/assets/evidence-media.js" defer></script>'
      +'<div class="blog-shell"><aside class="sidebar">Blog</aside><main class="main"><div class="reading-column">'+[1,2].map(n=>
        '<article class="post" id="image-article-'+n+'"><div class="post-copy"><h1>Image example '+n+'</h1><div class="post-body"><p><a href="'+(n===2?imageFragment:publicImage)+'">Image '+n+'</a></p></div></div><aside class="post-media" hidden></aside></article>').join('')+'</div></main></div>');return;
  }
  if(url.pathname==='/history-feed'){
    const prose='<p>Long-form writing gives the collapsed preview a reference farther down the post. Following that reference should not lose the original reading position.</p>';
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css">'
      +'<script src="/assets/links.js" defer></script><script src="/assets/evidence-media.js" defer></script><script src="/assets/feed.js" defer></script>'
      +'<div class="blog-shell"><aside class="sidebar">Blog</aside><main class="main"><div class="reading-column"><article class="post" id="history-post"><div class="post-copy"><h1>History example</h1>'
      +'<blockquote class="quote">Opening quotation <sup class="citation"><a href="#history-reference">[1]</a></sup>. <a href="'+imageFragment+'">Image reference</a></blockquote>'
      +'<div class="post-body" data-post-preview>'+prose.repeat(22)+'<p><a href="'+imageFragment+'">History illustration</a></p>'
      +'<section class="references"><h2>References</h2><ol><li id="history-reference">Source for the opening quote.</li></ol></section></div>'
      +'<button class="show-more" aria-expanded="false" hidden>Show more</button></div><aside class="post-media" hidden></aside></article>'
      +'<article class="post"><div class="post-copy"><h2>Following post</h2><div class="post-body">'+prose.repeat(10)+'</div></div></article></div></main></div>');return;
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
    cloud={revision:20,deleted:[],drafts:[{id:'image-fixture',kind:'page',title:'Image navigation',quote:'',doc:[{runs:[{text:'The '},{text:'two lenses',link:publicImage},{text:' are shown here.'}]}],createdAt:'2026-10-22T10:00:00Z',updatedAt:'2026-10-22T10:00:00Z'}]};
    const imagePage=await browser.newPage({viewport:{width:1100,height:800}});
    imagePage.on('pageerror',error=>errors.push(error.message));
    await imagePage.goto(origin+'/write/?images=1');
    await imagePage.locator('.post-media .evidence-image').waitFor();
    await imagePage.waitForFunction(()=>document.getElementById('connect-github').dataset.connected==='true');
    const imageBody=await imagePage.locator('#body').innerHTML(),imageURL=imagePage.url();
    await imagePage.evaluate(()=>{
      const target=document.querySelector('.post-media .evidence-image'),scroll=target.scrollIntoView.bind(target);
      target.scrollIntoView=options=>{window.imageScrolled=true;scroll(options);};
    });
    await imagePage.getByRole('link',{name:'two lenses',exact:true}).click();
    assert.equal(await imagePage.evaluate(()=>window.imageScrolled),true,'ordinary image text click scrolls to the displayed figure in the real writer');
    assert.equal(imagePage.context().pages().length,1,'image text opens no new tab');
    assert.equal(imagePage.url(),imageURL,'image text does not navigate away or rewrite the URL');
    assert.equal(await imagePage.locator('#body').innerHTML(),imageBody,'image text navigation preserves the editor document and original href');
    assert.equal(await imagePage.locator('.evidence-image img').getAttribute('src'),origin+imagePath,'own public image URL maps to the private preview');
    const modifier=await imagePage.getByRole('link',{name:'two lenses',exact:true}).evaluate(link=>{
      const target=document.querySelector('.evidence-image'),scroll=target.scrollIntoView;let scrolled=false,intercepted;
      target.scrollIntoView=()=>{scrolled=true;};
      link.addEventListener('click',event=>{intercepted=event.defaultPrevented;event.preventDefault();},{once:true});
      link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0,ctrlKey:true}));
      target.scrollIntoView=scroll;return {scrolled,intercepted,target:link.target};
    });
    assert.deepEqual(modifier,{scrolled:false,intercepted:false,target:'_blank'},'modifier click retains the full-size source link');
    const fullImagePromise=imagePage.waitForEvent('popup');
    await imagePage.getByRole('link',{name:'Open full-size image: two lenses',exact:true}).click();
    const fullImage=await fullImagePromise;await fullImage.waitForLoadState('domcontentloaded');
    assert.equal(fullImage.url(),origin+imagePath,'clicking the figure still opens the full-size image');
    assert.equal(await fullImage.evaluate(()=>window.opener),null);await fullImage.close();
    const fragmentSave=imagePage.waitForResponse(response=>new URL(response.url()).pathname==='/api/drafts' && response.request().method()==='POST');
    await imagePage.locator('#body').evaluate((body,fragment)=>{
      body.querySelector('a').setAttribute('href',fragment);body.dispatchEvent(new Event('input',{bubbles:true}));
    },imageFragment);
    await fragmentSave;
    assert.equal(cloud.drafts[0].doc[0].runs[1].link,imageFragment,'writer saves the actual same-page image fragment');
    await imagePage.reload();await imagePage.locator('.post-media .evidence-image').waitFor();
    assert.equal(await imagePage.locator('.evidence-image').getAttribute('id'),imageFragment.slice(1),'reload discovers the image from the fragment alone');
    assert.equal(await imagePage.getByRole('link',{name:'two lenses',exact:true}).getAttribute('href'),imageFragment);
    assert.equal(await imagePage.getByRole('link',{name:'two lenses',exact:true}).getAttribute('target'),null);
    await imagePage.getByRole('link',{name:'two lenses',exact:true}).click();
    assert.equal(new URL(imagePage.url()).hash,imageFragment,'normal click follows the real same-page fragment');
    assert.equal(imagePage.context().pages().length,1);
    const fragmentImagePromise=imagePage.waitForEvent('popup');
    await imagePage.getByRole('link',{name:'Open full-size image: two lenses',exact:true}).click();
    const fragmentImage=await fragmentImagePromise;await fragmentImage.waitForLoadState('domcontentloaded');
    assert.equal(fragmentImage.url(),origin+imagePath,'fragment-generated figure still opens the full-size image');await fragmentImage.close();
    await imagePage.goto(origin+'/image-feed');await imagePage.locator('#image-article-2 .evidence-image').waitFor();
    await imagePage.evaluate(()=>document.querySelectorAll('.evidence-image').forEach(target=>{
      const scroll=target.scrollIntoView.bind(target);target.scrollIntoView=options=>{window.imageArticle=target.closest('.post').id;scroll(options);};
    }));
    await imagePage.getByRole('link',{name:'Image 2',exact:true}).click();
    assert.equal(await imagePage.evaluate(()=>window.imageArticle),'image-article-2','public text resolves the image in its own article');
    await imagePage.getByRole('link',{name:'Image 1',exact:true}).click();
    assert.equal(await imagePage.evaluate(()=>window.imageArticle),'image-article-1');
    assert.equal(imagePage.context().pages().length,1,'public image pointers create no tabs');
    assert.equal(await imagePage.evaluate(()=>{
      const article=document.querySelector('#image-article-2');article.querySelector('.evidence-image').remove();
      return BlogEvidenceMedia.imageTarget(article.querySelector('.post-body a'));
    }),null,'a missing local figure never resolves to another article’s copy');
    await imagePage.route('**/assets/links.js',route=>route.fulfill({contentType:'application/javascript',body:'/* Simulate an unavailable or older click handler. */'}));
    await imagePage.goto(origin+'/image-feed');await imagePage.locator('#image-article-2 .evidence-image').waitFor();
    await imagePage.getByRole('link',{name:'Image 2',exact:true}).click();
    assert.equal(new URL(imagePage.url()).hash,imageFragment,'native fragment navigation works without the click-interception script');
    assert.equal(imagePage.context().pages().length,1,'native fragment never opens the raw image in another window');
    await imagePage.close();
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))));
    const readingPosition=()=>page.locator('.main').evaluate(main=>main.scrollTop);
    for(const width of [1280,390]){
      await page.setViewportSize({width,height:900});
      await page.goto(origin+'/history-feed');
      await page.locator('.show-more').waitFor({state:'visible'});
      await page.locator('.evidence-image img').evaluate(image=>{image.loading='eager';});
      await page.waitForFunction(()=>document.querySelector('.evidence-image img')?.naturalWidth>0);
      await page.evaluate(()=>{history.replaceState({...history.state,unrelated:{value:'preserved'}},'');document.querySelector('.main').scrollTop=0;});
      await settle();
      const before=await readingPosition();
      await page.locator('.citation a').click();
      await settle();
      assert.equal(new URL(page.url()).hash,'#history-reference');
      assert.equal(await page.locator('.show-more').getAttribute('aria-expanded'),'true','citation reveals its collapsed post');
      assert.ok(await readingPosition()>500,'citation moves the nested reading pane');
      await page.locator('.main').evaluate(main=>{main.scrollTop+=70;});
      await settle();const referencePosition=await readingPosition();
      await page.goBack();await settle();
      assert.equal(new URL(page.url()).hash,'');
      assert.ok(Math.abs(await readingPosition()-before)<2,width+'px Back restores the original citation reading position');
      assert.deepEqual(await page.evaluate(()=>history.state.unrelated),{value:'preserved'},'navigation preserves existing history state fields');
      await page.goForward();await settle();
      assert.ok(Math.abs(await readingPosition()-referencePosition)<2,width+'px Forward restores the reference reading position, including subsequent scrolling');

      await page.evaluate(()=>{history.replaceState({...history.state,mediaState:'kept'},'');document.querySelector('.main').scrollTop=0;});
      await settle();const beforeImage=await readingPosition();
      await page.getByRole('link',{name:'Image reference',exact:true}).click();
      await settle();
      assert.equal(new URL(page.url()).hash,imageFragment);
      assert.ok(await readingPosition()>500,'same-page image navigation scrolls the nested pane');
      assert.equal(await page.evaluate(()=>history.state.mediaState),'kept','media pushState keeps unrelated fields');
      await page.locator('.main').evaluate(main=>{main.scrollTop+=45;});
      await settle();const imagePosition=await readingPosition();
      await page.goBack();await settle();
      assert.ok(Math.abs(await readingPosition()-beforeImage)<2,width+'px Back restores the reading position before the media fragment');
      await page.goForward();await settle();
      assert.ok(Math.abs(await readingPosition()-imagePosition)<2,width+'px Forward restores the media reading position');
    }
    assert.deepEqual(errors,[]);
    console.log('Link browser checks passed: editable writer, media/citation history restoration on desktop/mobile, preserved history state/documents, full-size popups, modifier semantics and article isolation.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
