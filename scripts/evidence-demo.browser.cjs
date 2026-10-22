// Local-only manual/inline loading and sandbox checks. No real draft requests.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const demoPath = '/assets/evidence/drafts/demos/example/';
const source = '<p>Explore the <a href="' + demoPath + 'index.html">3D machine emulator</a>.</p>'
  + '<p><a href="' + demoPath + 'index.html#again">Same emulator</a></p>';
// A later opt-in reference should select inline mode for the same canonical
// demo without duplicating it or changing the editable source links.
const autoSource = '<p>Run the <a href="' + demoPath + 'index.html">Laughing / crying NCA</a>.</p>'
  + '<p><a href="' + demoPath + 'index.html?load=auto#again">Same live demo</a></p>';
const requests = [];
const twoSources = (prefix, privateAssets) => ['example', 'game-of-life-sender-receiver'].map((name, index) =>
  '<p' + (index ? ' style="margin-top:1100px"' : '') + '>Explore <a href="' + prefix + '/assets/evidence/' + (privateAssets ? 'drafts/' : '') + 'demos/' + name + '/index.html?load=auto">' + (index ? 'Game of Life' : 'Neural cellular automaton') + '</a>.</p>').join('');
let origin;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (/^\/(?:personal-blog\/)?assets\/evidence\/(?:drafts\/)?demos\/[A-Za-z0-9_-]+\/(?:index\.html|demo\.js|demo\.css)$/.test(pathname)) {
    requests.push(pathname);
    res.setHeader('Content-Security-Policy', `sandbox allow-scripts; default-src 'none'; script-src ${origin}; style-src ${origin}; img-src ${origin} data:; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`);
    if (pathname.endsWith('/index.html')) {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head><link rel="stylesheet" href="demo.css"><script src="demo.js" defer></script></head><body><button id="ready">Initialize</button><button id="fail">Fail</button></body></html>');return;
    }
    if (pathname.endsWith('/demo.js')) {
      res.setHeader('Content-Type', 'application/javascript');
      res.end("document.getElementById('ready').onclick = () => parent.postMessage({type:'blog-demo-ready'}, '*');document.getElementById('fail').onclick = () => parent.postMessage({type:'blog-demo-error'}, '*');try {parent.document.body;document.body.dataset.parent = 'accessible';} catch {document.body.dataset.parent = 'denied';}try {localStorage.getItem('private');document.body.dataset.storage = 'accessible';} catch {document.body.dataset.storage = 'denied';}document.body.dataset.initialized = 'yes';");return;
    }
    if (pathname.endsWith('/demo.css')) {res.setHeader('Content-Type', 'text/css');res.end('body{background:rgb(230,240,250);margin:12px}');return;}
  }
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (['/writer-two', '/personal-blog/archive-two', '/personal-blog/feed-two'].includes(pathname)) {
    const writer = pathname === '/writer-two', prefix = writer ? '' : '/personal-blog', content = twoSources(prefix, writer);
    const article = id => '<article id="' + id + '" class="post"><div class="post-copy"><h1>Two demos</h1><div class="post-body" ' + (writer ? 'id="body" contenteditable="true"' : '') + '>' + content + '</div></div><aside class="post-media" ' + (writer ? 'id="evidence-media-preview"' : '') + ' hidden></aside></article>';
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="' + prefix + '/styles.css"><script src="' + prefix + '/assets/links.js" defer></script><script src="' + prefix + '/assets/evidence-media.js" defer></script><div class="reading-column">' + article('first') + (pathname.endsWith('/feed-two') ? article('second') : '') + '</div>');return;
  }
  if (['/writer', '/archive', '/writer-auto', '/archive-auto'].includes(pathname)) {
    const writer = pathname.startsWith('/writer'), content = pathname.endsWith('-auto') ? autoSource : source;
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><script src="/assets/evidence-media.js' + (pathname === '/writer-auto' ? '?v=fixture-version' : '') + '" defer></script><div class="reading-column"><article class="post"><div class="post-copy"><h1>Research</h1><div class="post-body" ' + (writer ? 'id="body" contenteditable="true"' : '') + '>' + content + '</div></div><aside class="post-media" ' + (writer ? 'id="evidence-media-preview"' : '') + ' hidden></aside></article></div>');return;
  }
  const localPath = pathname.replace(/^\/personal-blog(?=\/)/, '');
  if (localPath === '/assets/evidence/media.json') {res.setHeader('Content-Type', 'application/json');res.end('{}');return;}
  if (['/styles.css', '/assets/evidence-media.js', '/assets/links.js'].includes(localPath)) {
    res.setHeader('Content-Type', localPath.endsWith('.js') ? 'application/javascript' : 'text/css');res.end(fs.readFileSync(path.join(root, localPath)));return;
  }
  res.writeHead(404);res.end();
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/writer');
    const pane = page.locator('.evidence-demo');
    await pane.waitFor();
    assert.equal(await pane.count(), 1, 'duplicate entry links create one placeholder');
    assert.equal(await page.locator('#body').innerHTML(), source, 'normal links remain editable and serialized unchanged');
    assert.equal(await page.locator('iframe').count(), 0);
    assert.deepEqual(requests, [], 'entry, scripts and CSS are not requested before reader clicks');
    await pane.getByRole('button', {name: 'Load emulator', exact: true}).click();
    const frame = page.frameLocator('.evidence-demo iframe');
    await frame.locator('body[data-initialized="yes"]').waitFor();
    assert.deepEqual(new Set(requests), new Set(['index.html', 'demo.js', 'demo.css'].map(name => demoPath + name)));
    assert.equal(await pane.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    assert.equal(await frame.locator('body').getAttribute('data-parent'), 'denied', 'sandbox cannot read private parent document');
    assert.equal(await frame.locator('body').getAttribute('data-storage'), 'denied', 'sandbox cannot read private localStorage');
    assert.equal(await frame.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgb(230, 240, 250)', 'explicit-origin CSP permits classic JS and CSS in opaque-origin sandbox');
    await page.evaluate(() => dispatchEvent(new MessageEvent('message', {source: window, data: {type: 'blog-demo-ready'}})));
    assert.equal(await pane.getAttribute('data-state'), 'loading', 'unrelated ready messages cannot finish initialization');
    await frame.getByRole('button', {name: 'Initialize'}).click();
    await page.waitForFunction(() => document.querySelector('.evidence-demo').dataset.state === 'ready');
    assert.equal(await pane.getByRole('button', {name: 'Fullscreen'}).isVisible(), true);
    const initialRequests = requests.length;
    await page.evaluate(() => { window.originalDemoFrame = document.querySelector('.evidence-demo iframe'); });
    await page.locator('#body a').first().evaluate(link => { link.textContent = 'Updated machine caption'; });
    await page.waitForFunction(() => document.querySelector('.evidence-demo iframe').title === 'Updated machine caption');
    assert.equal(await page.evaluate(() => originalDemoFrame === document.querySelector('.evidence-demo iframe')), true);
    assert.equal(requests.length, initialRequests, 'editor redraws preserve the running emulator');
    await pane.getByRole('button', {name: 'Fullscreen'}).click();
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('evidence-demo'));
    await pane.getByRole('button', {name: 'Exit fullscreen', exact: true}).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    await pane.getByRole('button', {name: 'Fullscreen', exact: true}).click();
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('evidence-demo'));
    await page.evaluate(() => document.exitFullscreen());
    await pane.getByRole('button', {name: 'Fullscreen', exact: true}).waitFor();
    await frame.getByRole('button', {name: 'Fail', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('.evidence-demo').dataset.state === 'error');
    assert.equal(await pane.locator('iframe').count(), 0, 'failed emulator is unloaded');
    await pane.getByRole('button', {name: 'Retry', exact: true}).click();
    await frame.locator('body[data-initialized="yes"]').waitFor();
    assert.equal(requests.length, initialRequests + 3, 'retry loads a new document and bundle');
    await frame.getByRole('button', {name: 'Initialize'}).click();
    await page.waitForFunction(() => document.querySelector('.evidence-demo').dataset.state === 'ready');
    await pane.getByRole('button', {name: 'Fullscreen', exact: true}).click();
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('evidence-demo'));
    await pane.getByRole('button', {name: 'Unload', exact: true}).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await pane.locator('iframe').count(), 0);
    assert.equal(await pane.getAttribute('data-state'), 'idle');
    assert.equal(await pane.getByRole('link', {name: 'Open emulator'}).getAttribute('href'), origin + demoPath + 'index.html');
    await page.locator('#body').evaluate(body => {body.innerHTML = '<p>Plain writing.</p>';});
    await page.waitForFunction(() => document.querySelector('.post-media').hidden);
    assert.equal(await pane.count(), 0);

    // Opt-in inline demos request their document immediately, retaining the
    // sandbox/readiness protocol while removing the emulator loading wrapper.
    const assertInlineControls = async (expectRetry = false) => {
      assert.equal(await pane.getByRole('button', {name: /^(?:Load|Loading|Unload)\b/i}).count(), 0,
        'inline media has no visible load or unload gate');
      assert.doesNotMatch(await pane.innerText(), /\bemulator\b/i, 'inline media does not use emulator-specific chrome');
      assert.equal(await pane.getByRole('button', {name: 'Retry', exact: true}).count(), expectRetry ? 1 : 0);
      assert.equal(await pane.getByRole('button').count(), expectRetry ? 1 : 0,
        'inline media exposes only Retry after failure, with no fullscreen control');
      assert.equal(await pane.getByRole('link').count(), 0, 'inline media has no Open demo link');
      assert.equal(await pane.locator('figcaption:visible').count(), 0, 'inline media has no visible caption');
      assert.equal(await pane.getByRole('status').count(), expectRetry ? 1 : 0,
        'inline media shows host status only for a recoverable error');
      if (!expectRetry) assert.equal((await pane.innerText()).trim(), '',
        'loading and ready inline media show only the embedded demo, with no host text');
    };
    const beforeAuto = requests.length;
    await page.goto(origin + '/writer-auto');
    await frame.locator('body[data-initialized="yes"]').waitFor();
    assert.equal(await pane.count(), 1, 'mixed manual/automatic links deduplicate to one inline demo');
    assert.equal(await pane.getAttribute('data-load-mode'), 'auto');
    assert.equal(await pane.locator('iframe').getAttribute('src'), origin + demoPath + 'index.html?v=fixture-version',
      'demo documents use the host build version without changing content links');
    assert.equal(await page.locator('#body').innerHTML(), autoSource, 'automatic loading preserves serialized draft links');
    assert.equal(requests.length, beforeAuto + 3, 'inline entry, JS and CSS load without a parent-button click');
    assert.equal(await pane.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    assert.equal(await frame.locator('body').getAttribute('data-parent'), 'denied');
    assert.equal(await frame.locator('body').getAttribute('data-storage'), 'denied');
    await assertInlineControls();
    await page.evaluate(() => dispatchEvent(new MessageEvent('message', {source: window, data: {type: 'blog-demo-ready'}})));
    assert.equal(await pane.getAttribute('data-state'), 'loading', 'inline mode still rejects unrelated ready messages');
    await frame.getByRole('button', {name: 'Initialize'}).click();
    await page.waitForFunction(() => document.querySelector('.evidence-demo').dataset.state === 'ready');
    await assertInlineControls();
    assert.equal(await pane.getByRole('status').count(), 0, 'ready inline media has no visible host status wrapper');
    const autoRequests = requests.length;
    await page.evaluate(() => { window.originalInlineFrame = document.querySelector('.evidence-demo iframe'); });
    await page.locator('#body a').first().evaluate(link => { link.textContent = 'Updated NCA caption'; });
    await page.waitForFunction(() => document.querySelector('.evidence-demo iframe').title === 'Updated NCA caption');
    await page.evaluate(() => BlogEvidenceMedia.renderPane(document.getElementById('body'), document.getElementById('evidence-media-preview')));
    assert.equal(await page.evaluate(() => originalInlineFrame === document.querySelector('.evidence-demo iframe')), true,
      'inline caption edits and explicit redraws preserve the live frame');
    assert.equal(requests.length, autoRequests, 'inline editor redraws do not restart the simulation');
    await frame.getByRole('button', {name: 'Fail', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('.evidence-demo').dataset.state === 'error');
    assert.equal(await pane.locator('iframe').count(), 0, 'failed inline content is removed');
    await assertInlineControls(true);
    assert.match(await pane.getByRole('status').textContent(), /could not load/i);
    await pane.getByRole('button', {name: 'Retry', exact: true}).click();
    await frame.locator('body[data-initialized="yes"]').waitFor();
    assert.equal(requests.length, autoRequests + 3, 'inline retry loads one fresh document and bundle');
    await assertInlineControls();
    await frame.getByRole('button', {name: 'Initialize'}).click();
    await page.waitForFunction(() => document.querySelector('.evidence-demo').dataset.state === 'ready');
    await assertInlineControls();

    // Removing the sole opt-in reference restores the original manual mode.
    // Restoring the marker creates one new automatic frame; the old one dies.
    const beforeModeChange = requests.length;
    await page.locator('#body a').last().evaluate(link => { link.href = link.pathname + '#again'; });
    await pane.getByRole('button', {name: 'Load emulator', exact: true}).waitFor();
    assert.equal(await pane.getAttribute('data-load-mode'), 'manual');
    assert.equal(await pane.locator('iframe').count(), 0, 'switching to manual mode disposes the active inline frame');
    assert.equal(requests.length, beforeModeChange, 'manual mode does not request a replacement frame');
    await page.locator('#body a').last().evaluate(link => { link.href = link.pathname + '?load=auto#again'; });
    await frame.locator('body[data-initialized="yes"]').waitFor();
    assert.equal(requests.length, beforeModeChange + 3, 'opting back in starts one new frame');
    await frame.getByRole('button', {name: 'Initialize'}).click();
    await page.waitForFunction(() => document.querySelector('.evidence-demo').dataset.state === 'ready');
    await assertInlineControls();
    await page.locator('#body').evaluate(body => { body.innerHTML = '<p>Plain writing.</p>'; });
    await page.waitForFunction(() => document.querySelector('.post-media').hidden);
    assert.equal(await pane.count(), 0, 'removing inline references disposes the frame and media block');
    const beforeReinsert = requests.length;
    await page.locator('#body').evaluate((body, html) => { body.innerHTML = html; }, autoSource);
    await frame.locator('body[data-initialized="yes"]').waitFor();
    assert.equal(requests.length, beforeReinsert + 3, 'reinserting inline content starts exactly one fresh frame');
    await frame.getByRole('button', {name: 'Initialize'}).click();
    await page.waitForFunction(() => document.querySelector('.evidence-demo').dataset.state === 'ready');
    await assertInlineControls();
    await page.setViewportSize({width: 390, height: 844});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'inline media fits narrow screens');
    await page.setViewportSize({width: 1280, height: 900});

    // Demo-supplied captions sit in the parent figure, outside the iframe's
    // border, and survive title edits without restarting the running demo.
    for (const route of ['/writer-auto', '/archive-auto']) {
      await page.goto(origin + route);
      await frame.locator('body[data-initialized="yes"]').waitFor();
      const captionText = 'my very own cellular automata trained by me :)';
      await frame.locator('body').evaluate((body, caption) => {
        parent.postMessage({type: 'blog-demo-ready', caption}, '*');
      }, captionText);
      await page.waitForFunction(text => document.querySelector('.evidence-demo > figcaption')?.textContent === text, captionText);
      const caption = pane.locator(':scope > figcaption');
      assert.equal(await caption.isVisible(), true, 'an explicit ready caption is visible in private and public inline media');
      assert.equal(await pane.locator('.evidence-demo-stage figcaption').count(), 0, 'caption is outside the bordered demo stage');
      for (const width of [1280, 390]) {
        await page.setViewportSize({width, height: 900});
        assert.ok(await caption.evaluate(element => element.getBoundingClientRect().top
          >= element.parentElement.querySelector('iframe').getBoundingClientRect().bottom), 'caption sits below the iframe border on desktop and mobile');
      }
      await page.setViewportSize({width: 1280, height: 900});
      const beforeCaptionRedraw = requests.length;
      await page.evaluate(() => { window.captionFrame = document.querySelector('.evidence-demo iframe'); });
      await page.locator('.post-body a').first().evaluate(link => { link.textContent = 'Updated accessible demo title'; });
      await page.evaluate(() => BlogEvidenceMedia.renderPane(document.querySelector('.post-body'), document.querySelector('.post-media')));
      assert.equal(await caption.textContent(), captionText, 'explicit caption survives an editor redraw and link title change');
      assert.equal(await pane.locator('iframe').getAttribute('title'), 'Updated accessible demo title');
      assert.equal(await page.evaluate(() => captionFrame === document.querySelector('.evidence-demo iframe')), true);
      assert.equal(requests.length, beforeCaptionRedraw, 'caption redraw keeps the existing simulation running');
      await page.evaluate(() => dispatchEvent(new MessageEvent('message', {
        source: window, data: {type: 'blog-demo-ready', caption: 'Forged caption'}
      })));
      assert.equal(await caption.textContent(), captionText, 'a message from another window cannot replace the caption');
      const literalCaption = '<em>Caption is plain text</em>';
      await frame.locator('body').evaluate((body, caption) => {
        parent.postMessage({type: 'blog-demo-ready', caption}, '*');
      }, literalCaption);
      await page.waitForFunction(text => document.querySelector('.evidence-demo > figcaption')?.textContent === text, literalCaption);
      assert.equal(await caption.locator('*').count(), 0, 'caption markup is displayed literally, never interpreted as HTML');
      await frame.getByRole('button', {name: 'Initialize'}).click();
      await page.waitForFunction(() => document.querySelector('.evidence-demo > figcaption').hidden);
      await assertInlineControls();
    }

    // Exercise the real link handler in its normal script order. Two distinct
    // text links select their own existing frame in editable and public pages.
    for (const route of ['/writer-two', '/personal-blog/archive-two', '/personal-blog/feed-two']) {
      await page.goto(origin + route);
      const frames = page.locator('.evidence-demo iframe');
      await page.waitForFunction(count => document.querySelectorAll('.evidence-demo iframe').length === count,
        route.endsWith('/feed-two') ? 4 : 2);
      for (const iframe of await frames.all()) await iframe.contentFrame().getByRole('button', {name: 'Initialize'}).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.evidence-demo')].every(block => block.dataset.state === 'ready'));
      const originalBodies = await page.locator('.post-body').evaluateAll(bodies => bodies.map(body => body.innerHTML));
      const beforeClick = requests.length, pagesBefore = page.context().pages().length, urlBefore = page.url();
      await page.evaluate(() => {
        window.originalFrames = [...document.querySelectorAll('.evidence-demo iframe')];
        window.selectedDemo = null;
        document.addEventListener('blog-media-reveal', event => { window.selectedDemo = event.target; });
      });
      const articles = await page.locator('.post').all();
      for (const [articleIndex, article] of articles.entries()) {
        assert.deepEqual(await article.locator('.evidence-demo').evaluateAll(blocks => blocks.map(block => block.id)),
          ['media-demo-example', 'media-demo-game-of-life-sender-receiver'].map(id => id + (articleIndex ? '--instance-2' : '')),
          'demo anchors remain stable across draft/public routes; repeated feed instances have unique anchors');
        for (let index = 0; index < 2; index++) {
          await article.locator('.post-body a').nth(index).click();
          assert.equal(await article.evaluate((post, i) => window.selectedDemo === post.querySelectorAll('.evidence-demo')[i], index), true,
            'the text link reveals only its same-article frame');
          assert.equal(page.url(), urlBefore);assert.equal(page.context().pages().length, pagesBefore);
        }
      }
      assert.equal(requests.length, beforeClick, 'text links do not navigate or request another copy of the demo');
      assert.equal(await page.locator('.evidence-demo').evaluateAll(blocks => new Set(blocks.map(block => block.id)).size === blocks.length), true);
      assert.equal(await page.evaluate(() => originalFrames.every((frame, i) => frame === document.querySelectorAll('.evidence-demo iframe')[i])), true,
        'the same live iframe and its simulation state survive navigation');
      assert.deepEqual(await page.locator('.post-body').evaluateAll(bodies => bodies.map(body => body.innerHTML)), originalBodies,
        'demo link navigation leaves serialized writing untouched');
      const modifiers = await page.locator('.post-body a').first().evaluate(link => ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'].map(modifier => {
        let prevented;
        const stop = event => { prevented = event.defaultPrevented;event.preventDefault(); };
        document.addEventListener('click', stop, {capture: true, once: true});
        link.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, [modifier]: true}));
        return prevented;
      }));
      assert.deepEqual(modifiers, [false, false, false, false], 'modifier clicks retain ordinary link behavior');
      if (route === '/writer-two') {
        await page.locator('#body a').last().evaluate(link => { link.href = link.pathname; });
        const second = page.locator('.evidence-demo').last();
        await second.getByRole('button', {name: 'Load emulator', exact: true}).waitFor();
        const beforeLazyClick = requests.length;
        await page.locator('#body a').last().click();
        assert.equal(await second.getAttribute('data-state'), 'idle');assert.equal(await second.locator('iframe').count(), 0);
        assert.equal(requests.length, beforeLazyClick, 'text navigation preserves the explicit lazy-loading gate');
      }
    }

    // Shorten only the host readiness timeout, then exercise a silent iframe.
    await page.addInitScript(() => {
      const originalTimeout = window.setTimeout;
      window.setTimeout = (fn, delay, ...args) => originalTimeout(fn, delay === 20000 ? 200 : delay, ...args);
    });
    await page.goto(origin + '/archive');
    await pane.waitFor();
    const before = requests.length;
    assert.equal(await page.locator('.post-body').innerHTML(), source);
    assert.equal(await page.locator('iframe').count(), 0);
    assert.equal(requests.length, before);
    await pane.getByRole('button', {name: 'Load emulator', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('.evidence-demo').dataset.state === 'error');
    assert.match(await pane.locator('[role="status"]').textContent(), /could not load/);
    assert.equal(await pane.locator('iframe').count(), 0);
    await page.setViewportSize({width: 390, height: 844});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'controls do not overflow narrow screens');

    // Public inline content eagerly loads too, but a missing ready handshake
    // still produces a recoverable error instead of a permanent blank frame.
    const beforePublicAuto = requests.length;
    await page.goto(origin + '/archive-auto');
    await page.waitForFunction(() => document.querySelector('.evidence-demo')?.dataset.state === 'error');
    assert.equal(await page.locator('.post-body').innerHTML(), autoSource);
    assert.equal(requests.length, beforePublicAuto + 3, 'public inline media also loads without any click');
    assert.equal(await pane.locator('iframe').count(), 0, 'timed-out inline frame is disposed');
    await assertInlineControls(true);
    assert.match(await pane.getByRole('status').textContent(), /could not load/i);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'inline retry state fits narrow screens');
    assert.deepEqual(errors, []);
    console.log('Demo browser checks passed: same-article text-link navigation for two demos in editable/public/feed pages, stable unique anchors, unchanged frames/links, modifier semantics, manual lazy loading/fullscreen, opt-in inline autoload, exact-window readiness, CSP isolation, redraw preservation, mode changes, retry and timeout.');
  } finally {await browser.close();await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);server.close();process.exitCode = 1;});
