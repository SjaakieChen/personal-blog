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
let origin;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (pathname.startsWith(demoPath)) {
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
  if (['/writer', '/archive', '/writer-auto', '/archive-auto'].includes(pathname)) {
    const writer = pathname.startsWith('/writer'), content = pathname.endsWith('-auto') ? autoSource : source;
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><script src="/assets/evidence-media.js" defer></script><div class="reading-column"><article class="post"><div class="post-copy"><h1>Research</h1><div class="post-body" ' + (writer ? 'id="body" contenteditable="true"' : '') + '>' + content + '</div></div><aside class="post-media" ' + (writer ? 'id="evidence-media-preview"' : '') + ' hidden></aside></article></div>');return;
  }
  if (pathname === '/assets/evidence/media.json') {res.setHeader('Content-Type', 'application/json');res.end('{}');return;}
  if (pathname === '/styles.css' || pathname === '/assets/evidence-media.js') {
    res.setHeader('Content-Type', pathname.endsWith('.js') ? 'application/javascript' : 'text/css');res.end(fs.readFileSync(path.join(root, pathname)));return;
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
    console.log('Demo browser checks passed: manual lazy loading/fullscreen, opt-in inline autoload without host controls/captions/status, exact-window readiness, CSP isolation, redraw preservation, mode changes, lifecycle, retry, timeout, and clean draft links.');
  } finally {await browser.close();await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);server.close();process.exitCode = 1;});
