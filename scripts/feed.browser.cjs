// Feed scroll-position and sidebar styling checks using only a local fixture.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const feed = process.env.FEED_SOURCE_REF
  ? execFileSync('git', ['show', process.env.FEED_SOURCE_REF + ':assets/feed.js'], {cwd: root, encoding: 'utf8'})
  : fs.readFileSync(path.join(root, 'assets/feed.js'), 'utf8');
const paragraph = '<p>A longer paragraph gives this post enough content to expand. The following article should remain at the same reading position when this one is folded again.</p>';
const post = (id, media = false) => '<article class="post" id="post-' + id + '"><div class="post-copy"><h2>Post ' + id + '</h2>'
  + '<div class="post-body" data-post-preview id="preview-' + id + '">' + paragraph.repeat(16)
  + (media ? '<p><a href="/assets/evidence/test/tall.png">Tall illustration</a></p>' : '')
  + '<p><a href="#post-2">An ordinary body link</a></p></div>'
  + '<button class="show-more" aria-expanded="false" aria-controls="preview-' + id + '" hidden>Show more</button></div>'
  + '<aside class="post-media" hidden></aside></article>';
function html(media, writer = false) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="stylesheet" href="/styles.css">' + (writer ? '<link rel="stylesheet" href="/assets/writer.css">' : '')
    + '<script src="/assets/evidence-media.js" defer></script><script src="/assets/feed.js" defer></script></head>'
    + '<body><div class="blog-shell"><aside class="sidebar"><nav class="timeline"><a href="#post-1">First post</a>'
    + '<a href="#post-2" aria-current="page">Current post</a><button aria-current="page">Draft post</button></nav></aside>'
    + '<main class="main"><div class="reading-column">' + post(1, media) + post(2) + post(3) + '</div></main></div></body></html>';
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/') {res.setHeader('Content-Type', 'text/html');res.end(html(url.searchParams.has('media'), url.searchParams.has('writer')));return;}
  if (url.pathname === '/assets/evidence/media.json') {res.setHeader('Content-Type', 'application/json');res.end('{}');return;}
  if (url.pathname === '/assets/evidence/test/tall.png') {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="1200"><rect width="400" height="1200" fill="#dce5eb"/></svg>');return;
  }
  if (url.pathname === '/assets/feed.js') {res.setHeader('Content-Type', 'application/javascript');res.end(feed);return;}
  if (['/styles.css', '/assets/writer.css', '/assets/evidence-media.js'].includes(url.pathname)) {
    res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript');
    res.end(fs.readFileSync(path.join(root, url.pathname)));return;
  }
  res.writeHead(404);res.end();
});
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const top = (page, selector) => page.locator(selector).evaluate(element => element.getBoundingClientRect().top);
async function place(page, selector, offset) {
  await page.locator(selector).evaluate((element, desired) => {
    const main = document.querySelector('.main');
    main.scrollTop += element.getBoundingClientRect().top - main.getBoundingClientRect().top - desired;
  }, offset);
  await settle(page);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [1280, 390]) {
      await page.setViewportSize({width, height: 900});
      await page.goto(origin);
      const firstToggle = page.locator('#post-1 .show-more');
      await firstToggle.waitFor({state: 'visible'});
      for (let repeat = 0; repeat < 2; repeat++) {
        await firstToggle.click();
        await place(page, '#post-2', 410);
        const before = await top(page, '#post-2');
        await firstToggle.click();
        await settle(page);
        assert.ok(Math.abs(await top(page, '#post-2') - before) < 2, width + 'px collapse preserves the following post position');
        assert.equal(await firstToggle.getAttribute('aria-expanded'), 'false');
        assert.ok(await page.locator('.main').evaluate(main => main.scrollTop > 0), 'collapse does not jump to the feed top');
      }
      const lastToggle = page.locator('#post-3 .show-more');
      await lastToggle.click();
      await page.locator('.main').evaluate(main => {main.scrollTop = main.scrollHeight;});
      await settle(page);
      const lastTop = await top(page, '#post-3 .show-more');
      await lastToggle.click();
      await settle(page);
      assert.ok(Math.abs(await top(page, '#post-3 .show-more') - lastTop) < 2, width + 'px final post keeps its toggle visible at the end of the feed');

      await page.goto(origin + '/?media');
      await firstToggle.waitFor({state: 'visible'});
      await firstToggle.click();
      await page.locator('#post-1 .post-media img').evaluate(image => {image.loading = 'eager';});
      await page.waitForFunction(() => document.querySelector('#post-1 .post-media img')?.complete
        && document.querySelector('#post-1 .post-media img').naturalWidth > 0);
      await settle(page);
      await place(page, '#post-1 .show-more', 240);
      const buttonTop = await top(page, '#post-1 .show-more');
      assert.ok(await page.locator('#post-2').evaluate(post => post.getBoundingClientRect().top > document.querySelector('.main').getBoundingClientRect().bottom), 'tall media puts the following post outside the viewport');
      await firstToggle.click();
      await settle(page);
      assert.ok(Math.abs(await top(page, '#post-1 .show-more') - buttonTop) < 2, width + 'px media collapse preserves the clicked control position');
      assert.equal(await page.locator('#post-1 .post-media img').isVisible(), false, 'concealed media reflows before scroll compensation');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow feed has no horizontal overflow');
    }
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(origin);
    const rotatingToggle = page.locator('#post-1 .show-more');
    await rotatingToggle.click();
    await place(page, '#post-1 .post-body p:nth-child(8)', 260);
    await page.setViewportSize({width: 844, height: 390});
    await settle(page);
    assert.equal(await rotatingToggle.getAttribute('aria-expanded'), 'true', 'phone rotation preserves the expanded article');
    assert.equal(await rotatingToggle.textContent(), 'Show less');
    assert.equal(await page.locator('#post-1 .post-body').evaluate(body => body.classList.contains('post-collapsed')), false);
    await page.setViewportSize({width: 1280, height: 900});
    await settle(page);
    assert.equal(await rotatingToggle.getAttribute('aria-expanded'), 'true', 'desktop resize also preserves the expanded article');
    await page.goto(origin + '/?writer');
    for (const selector of ['.timeline a', '.timeline button']) {
      const item = page.locator(selector).first();
      assert.equal(await item.evaluate(element => getComputedStyle(element).textDecorationLine), 'none');
      await item.hover();
      assert.equal(await item.evaluate(element => getComputedStyle(element).textDecorationLine), 'none', 'sidebar hover remains ununderlined');
      await item.focus();
      assert.equal(await item.evaluate(element => getComputedStyle(element).outlineStyle), 'solid', 'keyboard focus remains visible');
    }
    assert.equal(await page.locator('.post-body a').first().evaluate(element => getComputedStyle(element).textDecorationLine), 'underline', 'article link styling is unchanged');
    assert.deepEqual(errors, []);
    console.log('Feed browser checks passed: stable next-post and final-toggle positions, repeated desktop/mobile collapse, tall-media reflow, and sidebar links/buttons without underlines.');
  } finally {await browser.close();await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);server.close();process.exitCode = 1;});
