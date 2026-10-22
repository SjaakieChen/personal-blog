// Local geometry regressions; all media requests are served or intercepted here.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const video = 'https://www.youtube.com/watch?v=Abc_123-Xyz';
const firstPost = fs.readFileSync(path.join(root, '_posts/2026-10-16-genesis-43e13b07.md'), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
const paragraph = '<p>Some context before the example. A reader should encounter this explanation before seeing the related media, even when changing the window width.</p>';
const writerText = paragraph.repeat(5) + '<p id="introduction">Here is the <a href="' + video + '">demonstration</a> with the necessary context.</p>'
  + paragraph.repeat(2) + '<p><a href="' + video + '">Repeated demonstration link</a>.</p>';
const sequenceText = paragraph + '<p><a href="/assets/evidence/test/slow.png">Tall example image</a></p>'
  + '<p>Now see the <a href="' + video + '">demonstration</a>.</p>';
const inlineText = paragraph.repeat(4) + '<p id="inline-context">The following chart illustrates this explanation.</p>'
  + '<figure><img src="/assets/evidence/test/inline.png" alt="Inline example"><figcaption>Inline chart caption</figcaption></figure>' + paragraph;
function html(mode) {
  const writer = mode === '/writer', feed = mode === '/feed';
  const text = mode === '/first' || feed ? firstPost : writer ? writerText : mode === '/sequence' ? sequenceText : inlineText;
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="stylesheet" href="/styles.css"><script src="/assets/evidence-media.js" defer></script>'
    + (feed ? '<script src="/assets/feed.js" defer></script>' : '')
    + '</head><body><div class="blog-shell"><aside class="sidebar">Blog</aside><main class="main"><div class="reading-column">'
    + '<article class="post"><div class="post-copy"><h1>A contextual media example</h1><div class="post-date">16 October 2026</div>'
    + '<blockquote class="quote">An introductory quotation.</blockquote><div class="post-body" '
    + (writer ? 'id="body" contenteditable="true"' : feed ? 'id="preview-first" data-post-preview' : '') + '>' + text + '</div>'
    + (feed ? '<button class="show-more" type="button" aria-expanded="false" aria-controls="preview-first" hidden>Show more</button>' : '')
    + '</div><aside class="post-media" aria-label="Media" ' + (writer ? 'id="evidence-media-preview"' : '') + ' hidden></aside></article>'
    + '</div></main></div></body></html>';
}
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (['/first', '/writer', '/sequence', '/feed', '/inline'].includes(pathname)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');res.end(html(pathname));return;
  }
  if (pathname === '/assets/evidence/media.json') {res.setHeader('Content-Type', 'application/json');res.end('{}');return;}
  if (pathname === '/assets/evidence/test/inline.png') {
    res.setHeader('Content-Type', 'image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#dce5eb"/></svg>');return;
  }
  if (['/styles.css', '/assets/evidence-media.js', '/assets/feed.js'].includes(pathname)) {
    res.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'application/javascript');
    res.end(fs.readFileSync(path.join(root, pathname)));return;
  }
  res.writeHead(404);res.end();
});

// Use the first client rect: a long inline link may wrap onto several lines.
async function videoGeometry(page, id = 'Abc_123-Xyz') {
  return page.evaluate(id => {
    const anchor = [...document.querySelectorAll('.post-body a[href]')].find(a => a.href.includes(id) && !a.closest('.references, .explanation-notes'));
    const frame = document.querySelector('.post-media iframe');
    if (!anchor || !frame) return null;
    const block = frame.closest('figure'), mention = anchor.getClientRects()[0], box = block.getBoundingClientRect();
    return {mention: mention.top, media: box.top, bottom: box.bottom, visible: box.height > 0 && getComputedStyle(block).visibility !== 'hidden'};
  }, id);
}
async function waitForAlignedVideo(page, id = 'Abc_123-Xyz', close = false) {
  await page.waitForFunction(({id, close}) => {
    const anchor = [...document.querySelectorAll('.post-body a[href]')].find(a => a.href.includes(id) && !a.closest('.references, .explanation-notes'));
    const frame = document.querySelector('.post-media iframe');
    if (!anchor || !frame) return false;
    const box = frame.closest('figure').getBoundingClientRect(), mention = anchor.getClientRects()[0];
    return box.height > 0 && box.top >= mention.top - 1 && (!close || box.top <= mention.top + 2);
  }, {id, close});
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    await context.route('https://www.youtube-nocookie.com/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Local test video</title>'}));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = 'http://127.0.0.1:' + server.address().port;

    await page.goto(origin + '/first');
    await waitForAlignedVideo(page, '7p5LxFdc-Qg', true);
    assert.equal(await page.locator('.post-media iframe').count(), 1, 'the real Tesla citation produces one video');
    const tesla = await videoGeometry(page, '7p5LxFdc-Qg');
    assert.ok(tesla.media >= tesla.mention - 1, 'Tesla begins at its actual mention, below the introductory prose');

    await page.goto(origin + '/writer');
    await waitForAlignedVideo(page, 'Abc_123-Xyz', true);
    assert.equal(await page.locator('.post-media iframe').count(), 1, 'repeated links produce one player anchored to the first mention');
    assert.equal(await page.locator('#body').innerHTML(), writerText, 'alignment does not alter saved editor content');
    await page.evaluate(() => {window.originalPlayer = document.querySelector('.post-media iframe');});
    const beforeEdit = await videoGeometry(page);
    await page.locator('#body').evaluate((body, text) => body.insertAdjacentHTML('afterbegin', text), paragraph.repeat(3));
    await waitForAlignedVideo(page, 'Abc_123-Xyz', true);
    const afterEdit = await videoGeometry(page);
    assert.ok(afterEdit.media > beforeEdit.media + 100, 'inserting prose before a mention moves the player down');
    assert.equal(await page.evaluate(() => originalPlayer === document.querySelector('.post-media iframe')), true, 'editing preserves the existing player');
    await page.locator('h1').evaluate(title => {title.textContent = 'A much longer title that wraps across multiple lines and changes the height of the opening material';});
    await waitForAlignedVideo(page, 'Abc_123-Xyz', true);

    await page.setViewportSize({width: 390, height: 844});
    await page.waitForFunction(() => {
      const copy = document.querySelector('.post-copy').getBoundingClientRect(), media = document.querySelector('.post-media > :first-child').getBoundingClientRect();
      return media.top >= copy.bottom && media.top <= copy.bottom + 36;
    });
    const mobile = await page.evaluate(() => ({width: innerWidth, page: document.documentElement.scrollWidth, main: document.querySelector('.main').clientWidth, scroll: document.querySelector('.main').scrollWidth}));
    assert.ok(mobile.page <= mobile.width && mobile.scroll <= mobile.main + 1, 'mobile stacking has no horizontal overflow');
    await page.setViewportSize({width: 1280, height: 900});
    await waitForAlignedVideo(page, 'Abc_123-Xyz', true);
    assert.equal(await page.evaluate(() => originalPlayer === document.querySelector('.post-media iframe')), true, 'responsive alignment preserves playback');

    let delayedImage;
    await page.route('**/assets/evidence/test/slow.png', route => {delayedImage = route;});
    await page.goto(origin + '/sequence', {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('.post-media iframe');
    await waitForAlignedVideo(page);
    const beforeLoad = await videoGeometry(page);
    assert.ok(delayedImage, 'image request is held while initial layout completes');
    await delayedImage.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#dce5eb"/></svg>'});
    await page.waitForFunction(() => {
      const image = document.querySelector('.post-media img'), blocks = [...document.querySelector('.post-media').children];
      return image.complete && image.naturalHeight === 1200 && blocks[1].getBoundingClientRect().top >= blocks[0].getBoundingClientRect().bottom;
    });
    const afterLoad = await videoGeometry(page);
    assert.ok(afterLoad.media > beforeLoad.media + 100, 'late image dimensions push downstream media down');
    await page.locator('.post-media img').evaluate(image => {image.style.height = '900px';});
    await page.waitForFunction(() => {
      const blocks = [...document.querySelector('.post-media').children];
      return blocks[1].getBoundingClientRect().top >= blocks[0].getBoundingClientRect().bottom;
    });
    assert.ok((await videoGeometry(page)).media > afterLoad.media, 'media height changes also reflow downstream blocks');

    await page.goto(origin + '/feed');
    await page.waitForSelector('.post-collapsed');
    await page.waitForFunction(() => document.querySelector('.post-media iframe')?.closest('figure').getBoundingClientRect().height === 0);
    const collapsedHeight = await page.locator('article').evaluate(article => article.getBoundingClientRect().height);
    assert.ok(collapsedHeight < 1000, 'a concealed Tesla mention does not leave a tall blank media column');
    await page.getByRole('button', {name: 'Show more', exact: true}).click();
    await waitForAlignedVideo(page, '7p5LxFdc-Qg', true);
    await page.getByRole('button', {name: 'Show less', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('.post-media iframe')?.closest('figure').getBoundingClientRect().height === 0);
    await page.setViewportSize({width: 390, height: 844});
    await page.waitForFunction(() => document.querySelector('.post-media iframe')?.closest('figure').getBoundingClientRect().height === 0);
    await page.getByRole('button', {name: 'Show more', exact: true}).click();
    await page.waitForFunction(() => {
      const copy = document.querySelector('.post-copy').getBoundingClientRect(), frame = document.querySelector('.post-media iframe').getBoundingClientRect();
      return frame.height > 0 && frame.top >= copy.bottom;
    });

    await page.setViewportSize({width: 1280, height: 900});
    await page.goto(origin + '/inline');
    await page.waitForSelector('.post-media img');
    await page.waitForFunction(() => document.querySelector('.post-media img').getBoundingClientRect().top >= document.querySelector('#inline-context').getBoundingClientRect().bottom - 1);
    assert.equal(await page.locator('.post-body img').count(), 0, 'public inline images move into the media pane');
    await page.setViewportSize({width: 972, height: 900});
    await page.waitForFunction(() => document.querySelector('.post-media img').getBoundingClientRect().top >= document.querySelector('#inline-context').getBoundingClientRect().bottom - 1);
    assert.deepEqual(errors, [], 'no browser errors during alignment updates');
    console.log('Media position browser checks passed: real Tesla mention, duplicate links, editor changes, responsive layout, image reflow, collapsed feed and inline media.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error);server.close();process.exitCode = 1;});
