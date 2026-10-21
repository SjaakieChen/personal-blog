// Local layout/DOM checks; no real video, mailbox, draft or publisher requests.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const pdf = 'https://public.example/blog/assets/evidence/example/poster.pdf';
const manifest = {'/evidence/example/': {pdf: '/assets/evidence/example/poster.pdf', public_pdf: pdf,
  title: 'Example group project poster', previews: ['/assets/evidence/example/page-1.webp', '/assets/evidence/example/page-2.webp']},
  '/private-example/': {pdf: '/assets/evidence/drafts/example/paper.pdf', download_url: '/assets/evidence/drafts/example/paper.pdf',
    title: 'Private example paper', previews: [1, 10, 16].map(page => '/assets/evidence/drafts/example/page-' + page + '.webp'),
    preview_pages: [1, 10, 16], total_pages: 22}};
const privateText = '<p>Read the <a href="/assets/evidence/drafts/example/paper.pdf">full private paper</a>.</p>';
const text = '<p>See the <a class="text-citation" data-reference="demo" data-label="demo" href="https://www.youtube.com/watch?v=Abc_123-Xyz">demo</a> for the alignment procedure.</p>'
  + '<p><a href="https://youtu.be/Abc_123-Xyz">Another link to the same demo</a>.</p>'
  + '<p>Read the <a href="' + pdf + '">original poster PDF</a>.</p>'
  + '<p><a href="https://youtube.com.example.org/watch?v=Zyx-321_cbA">Unsupported link</a></p>'
  + '<div class="references"><p><a href="https://youtu.be/Zyx-321_cbA">Reference only</a></p></div>';
function html(mode) {
  const writer = mode === '/writer' || mode === '/private-writer', plain = mode === '/plain';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css">'
    + '<script src="/assets/evidence-media.js" defer></script></head><body><div class="blog-shell"><aside class="sidebar">Blog</aside><main class="main"><div class="reading-column">'
    + '<article class="post"><div class="post-copy"><h1>Research evidence</h1><div ' + (writer ? 'id="body" contenteditable="true" ' : '') + 'class="post-body">'
    + (plain ? '<p>A plain text article without media.</p>' : mode === '/private-writer' ? privateText : text) + '</div></div><aside class="post-media" '
    + (writer ? 'id="evidence-media-preview" ' : '') + 'aria-label="Media" hidden></aside></article></div></main></div></body></html>';
}
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (['/writer', '/private-writer', '/archive', '/plain'].includes(pathname)) {res.setHeader('Content-Type', 'text/html');res.end(html(pathname));return;}
  if (pathname === '/assets/evidence/media.json') {res.setHeader('Content-Type', 'application/json');res.end(JSON.stringify(manifest));return;}
  if (/^\/assets\/evidence\/(drafts\/)?example\/page-\d+\.webp$/.test(pathname)) {
    res.setHeader('Content-Type', 'image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#e7edf1"/><text x="80" y="100" font-size="36">Project poster preview</text></svg>');return;
  }
  if (pathname === '/styles.css' || pathname === '/assets/evidence-media.js') {
    res.setHeader('Content-Type', pathname.endsWith('.js') ? 'application/javascript' : 'text/css');res.end(fs.readFileSync(path.join(root, pathname)));return;
  }
  res.writeHead(404);res.end();
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    await context.route('https://www.youtube-nocookie.com/**', route => route.fulfill({body: '<!doctype html><title>Test video</title><body style="background:#293b46;color:white">Video demonstration</body>'}));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = 'http://127.0.0.1:' + server.address().port;
    await page.goto(origin + '/writer');
    await page.waitForSelector('.post-media .evidence-pdf img');
    assert.equal(await page.locator('#body').innerHTML(), text, 'editable HTML and source links are unchanged');
    assert.equal(await page.locator('#body iframe, #body img').count(), 0, 'media never enters saved rich text');
    assert.equal(await page.locator('.post-media iframe').count(), 1, 'inline and named citation links deduplicate');
    assert.equal(await page.locator('.post-media .evidence-pdf img').count(), 2);
    assert.equal(await page.locator('.evidence-pdf a').first().getAttribute('href'), pdf, 'preview opens stable public PDF');
    assert.equal(await page.locator('.evidence-pdf img').first().getAttribute('src'), origin + '/assets/evidence/example/page-1.webp');
    const boxes = await page.evaluate(() => {
      const copy = document.querySelector('.post-copy').getBoundingClientRect(), media = document.querySelector('.post-media').getBoundingClientRect();
      return {copy: {left: copy.left, right: copy.right, top: copy.top, width: copy.width}, media: {left: media.left, top: media.top, width: media.width}};
    });
    assert.ok(boxes.media.left > boxes.copy.right, 'desktop media is to the right of text');
    assert.ok(Math.abs(boxes.media.top - boxes.copy.top) < 2, 'media begins beside title');
    assert.ok(boxes.copy.width >= 350 && boxes.media.width >= 350, 'both columns remain useful at 1280px');
    if (process.env.MEDIA_SCREENSHOT) await page.screenshot({path: process.env.MEDIA_SCREENSHOT});
    await page.evaluate(() => { window.originalFrame = document.querySelector('iframe'); });
    await page.locator('#body').evaluate(body => { body.innerHTML += '<p>Additional explanation.</p>'; });
    await page.waitForFunction(() => document.querySelector('#body > p:last-child').textContent === 'Additional explanation.');
    assert.equal(await page.evaluate(() => originalFrame === document.querySelector('iframe')), true, 'editor redraw preserves playback');
    await page.locator('#body a').first().evaluate(anchor => { anchor.textContent = 'Updated demo'; });
    await page.waitForFunction(() => document.querySelector('iframe').title === 'Updated demo');
    assert.equal(await page.evaluate(() => originalFrame === document.querySelector('iframe')), true, 'caption edit preserves playback');
    await page.locator('#body').evaluate(body => { body.innerHTML = '<p>Only words remain.</p>'; });
    await page.waitForFunction(() => document.querySelector('.post-media').hidden);
    assert.equal(await page.locator('.post-media iframe, .post-media img').count(), 0);
    assert.ok((await page.locator('.reading-column').boundingBox()).width <= 660, 'no empty media column remains');

    await page.goto(origin + '/private-writer');
    await page.waitForSelector('.evidence-pdf img');
    assert.equal(await page.locator('#body').innerHTML(), privateText, 'private draft text stays unchanged');
    assert.equal(await page.locator('.evidence-pdf img').count(), 3, 'only representative pages are shown');
    assert.deepEqual(await page.locator('.evidence-pdf img').evaluateAll(images => images.map(image => image.alt)),
      [1, 10, 16].map(number => 'Private example paper, page ' + number + ' of 22'));
    assert.deepEqual(await page.locator('.evidence-pdf figcaption').allTextContents(),
      [1, 10, 16].map(number => 'Private example paper · ' + number + ' / 22'));
    assert.deepEqual(await page.locator('.evidence-pdf a').evaluateAll(links => links.map(link => link.href)),
      Array(3).fill(origin + '/assets/evidence/drafts/example/paper.pdf'), 'all previews open the full private PDF');

    await page.goto(origin + '/archive');
    await page.waitForSelector('.evidence-pdf img');
    assert.equal(await page.locator('.post-body').innerHTML(), text, 'public fallback links stay in the text');
    await page.evaluate(() => BlogEvidenceMedia.enhanceArticle(document.querySelector('.post-body')));
    assert.equal(await page.locator('iframe').count(), 1, 'rendering is idempotent');
    await page.locator('.post-body').evaluate(body => {
      body.insertAdjacentHTML('beforeend', '<figure><img src="/assets/evidence/example/page-1.webp" alt="Inline chart"><figcaption>Chart caption</figcaption></figure>');
      BlogEvidenceMedia.enhanceArticle(body);
    });
    assert.equal(await page.locator('.post-body img').count(), 0, 'existing article images also move to the right');
    assert.equal(await page.locator('.post-media img[alt="Inline chart"]').count(), 1);
    await page.setViewportSize({width: 972, height: 900});
    const compactDesktop = await page.evaluate(() => {
      const copy = document.querySelector('.post-copy').getBoundingClientRect(), media = document.querySelector('.post-media').getBoundingClientRect();
      return {copyRight: copy.right, copyWidth: copy.width, mediaLeft: media.left, mediaWidth: media.width};
    });
    assert.ok(compactDesktop.mediaLeft > compactDesktop.copyRight && compactDesktop.copyWidth >= 280 && compactDesktop.mediaWidth >= 280, '972px browser still has a readable right pane');
    await page.setViewportSize({width: 390, height: 844});
    const mobile = await page.evaluate(() => {
      const copy = document.querySelector('.post-copy').getBoundingClientRect(), media = document.querySelector('.post-media').getBoundingClientRect(), main = document.querySelector('.main');
      return {copyBottom: copy.bottom, mediaTop: media.top, bodyWidth: document.documentElement.scrollWidth, viewport: innerWidth, mainWidth: main.clientWidth, mainScrollWidth: main.scrollWidth};
    });
    assert.ok(mobile.mediaTop >= mobile.copyBottom, 'mobile stacks media after text');
    assert.ok(mobile.bodyWidth <= mobile.viewport && mobile.mainScrollWidth <= mobile.mainWidth + 1, 'no mobile horizontal overflow');
    await page.setViewportSize({width: 1280, height: 900});
    await page.goto(origin + '/plain');
    assert.equal(await page.locator('.post-media').evaluate(pane => pane.hidden), true);
    assert.equal(await page.locator('.post-media').evaluate(pane => getComputedStyle(pane).display), 'none');
    assert.ok((await page.locator('.reading-column').boundingBox()).width <= 660);
    assert.deepEqual(errors, []);
    console.log('Media pane browser checks passed: inline links, PDF previews, clean editor, playback, desktop/mobile, text-only layout.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error);server.close();process.exitCode = 1; });
