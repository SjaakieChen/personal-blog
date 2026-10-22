// Cold-cache carousel checks using only local, deliberately delayed image responses.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const pdf = '/assets/evidence/carousel/poster.pdf';
const previews = [1, 2, 3].map(n => '/assets/evidence/carousel/page-' + n + '.webp');
const entry = {pdf, public_pdf: 'https://public.example/poster.pdf', title: 'Test poster', previews};
const pending = new Map(), requests = new Map(), waiting = [];
function received(number, count = 1) {
  if ((requests.get(number) || 0) >= count) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Page ' + number + ' was not preloaded')), 5000);
    waiting.push(() => { if ((requests.get(number) || 0) >= count) {clearTimeout(timer);resolve();} });
  });
}
function release(number, status = 200) {
  const dimensions = [[2000, 1500], [900, 1600], [3000, 1200]][number - 1];
  for (const response of pending.get(number) || []) {
    response.writeHead(status, {'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store'});
    response.end(status === 200 ? '<svg xmlns="http://www.w3.org/2000/svg" width="' + dimensions[0] + '" height="' + dimensions[1] + '"><rect width="100%" height="100%" fill="#ccddee"/></svg>' : 'Unavailable');
  }
  pending.set(number, []);
}
const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><script src="/assets/evidence-media.js" defer></script>'
  + '<div class="blog-shell"><aside class="sidebar">Blog</aside><main class="main"><div class="reading-column"><article class="post"><div class="post-copy"><h1>Poster</h1><div class="post-body"><p><a href="' + pdf + '">Original poster</a></p></div></div>'
  + '<aside class="post-media"><div class="evidence-pdf" data-media-key="pdf:' + pdf + '" data-static-media>'
  + previews.map((src, n) => '<figure><a href="' + entry.public_pdf + '"><img loading="lazy" src="' + src + '" alt="Poster page ' + (n + 1) + '"></a><figcaption>' + (n === 2 ? 'A substantially longer page caption that wraps on a narrow screen and must not shift the carousel controls.' : 'Page ' + (n + 1)) + '</figcaption></figure>').join('')
  + '</div><div data-media-key="inline:following" data-static-media>Following content</div></aside></article></div></main></div>';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'), match = url.pathname.match(/page-([123])\.webp$/);
  if (match) {
    const n = Number(match[1]);pending.set(n, [...pending.get(n) || [], res]);requests.set(n, (requests.get(n) || 0) + 1);
    waiting.forEach(check => check());return;
  }
  if (url.pathname === '/') {res.setHeader('Content-Type', 'text/html');res.end(html);return;}
  if (url.pathname === '/assets/evidence/media.json') {res.setHeader('Content-Type', 'application/json');res.end(JSON.stringify({'/poster/': entry}));return;}
  if (['/styles.css', '/assets/evidence-media.js'].includes(url.pathname)) {
    res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css');res.end(fs.readFileSync(path.join(root, url.pathname)));return;
  }
  res.writeHead(404);res.end();
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port, {waitUntil: 'domcontentloaded'});
    const carousel = page.locator('.evidence-pdf-carousel'), active = carousel.locator('figure.is-current');
    await carousel.waitFor();await Promise.all([received(1), received(2), received(3)]);
    const layout = () => page.evaluate(() => {
      const selectors = ['.evidence-pdf-carousel', '.is-current .evidence-pdf-frame', '.evidence-pdf-controls', '[data-media-key="inline:following"]'];
      return selectors.map(selector => {const r = document.querySelector(selector).getBoundingClientRect();return {x: r.x, y: r.y + document.querySelector('.main').scrollTop, width: r.width, height: r.height};});
    });
    const stable = async baseline => {
      const actual = await layout();
      actual.forEach((box, n) => Object.keys(box).forEach(key => assert.ok(Math.abs(box[key] - baseline[n][key]) < 1, 'stable box ' + n + ' ' + key + ': ' + baseline[n][key] + ' -> ' + box[key])));
    };
    const initial = await layout();
    assert.ok(initial[1].height > 200, 'cold cache reserves the complete frame');
    assert.equal(await active.locator('.evidence-pdf-frame').getAttribute('data-state'), 'loading');
    assert.equal(await active.getByText('Open PDF', {exact: true}).getAttribute('href'), entry.public_pdf);
    await carousel.getByRole('button', {name: 'Next page', exact: true}).click();
    assert.equal(await carousel.getByRole('status').textContent(), 'Page 2 of 3');await stable(initial);
    await carousel.getByRole('button', {name: 'Next page', exact: true}).press('Enter');
    await carousel.getByRole('button', {name: 'Previous page', exact: true}).press('Space');
    assert.equal(await carousel.getByRole('status').textContent(), 'Page 2 of 3');await stable(initial);
    release(1);release(3, 503);release(2);
    await page.waitForFunction(() => document.querySelector('.is-current .evidence-pdf-frame').dataset.state === 'ready');
    await stable(initial);
    assert.equal(await active.locator('img').evaluate(img => img.naturalWidth), 900);
    assert.equal(await active.locator('img').evaluate(img => getComputedStyle(img).objectFit), 'contain');
    assert.equal(await carousel.getByRole('status').textContent(), 'Page 2 of 3', 'late responses do not change the requested page');
    await carousel.getByRole('button', {name: 'Next page', exact: true}).click();
    await active.getByRole('button', {name: 'Retry page 3 preview'}).waitFor();await stable(initial);
    assert.match(await active.locator('.evidence-pdf-feedback').textContent(), /could not load/);
    await active.getByRole('button', {name: 'Retry page 3 preview'}).press('Enter');
    await received(3, 2);await stable(initial);
    release(3);
    await page.waitForFunction(() => document.querySelector('.is-current .evidence-pdf-frame').dataset.state === 'ready');
    await stable(initial);
    assert.equal(await active.locator('img').evaluate(img => img.naturalWidth), 3000);
    assert.equal(await active.locator('.evidence-pdf-frame > a').getAttribute('href'), entry.public_pdf);
    await carousel.locator('figure').first().evaluate(target => target.dispatchEvent(new CustomEvent('blog-media-reveal', {bubbles: true, detail: {target}})));
    assert.equal(await carousel.getByRole('status').textContent(), 'Page 1 of 3', 'same-page links reveal their target synchronously');await stable(initial);
    await carousel.getByRole('button', {name: 'Next page', exact: true}).click();
    await carousel.getByRole('button', {name: 'Next page', exact: true}).click();
    for (const width of [390, 320]) {
      await page.setViewportSize({width, height: 844});
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const mobile = await layout();
      await carousel.getByRole('button', {name: 'Previous page', exact: true}).click();await stable(mobile);
      await carousel.getByRole('button', {name: 'Previous page', exact: true}).click();await stable(mobile);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await carousel.getByRole('button', {name: 'Next page', exact: true}).click();
      await carousel.getByRole('button', {name: 'Next page', exact: true}).click();
    }
    assert.deepEqual(errors, []);
    console.log('Carousel cold-cache checks passed: reserved frame, eager loading, delayed decode, aspect ratios, stable captions/controls, failure/retry, rapid and keyboard navigation, desktop/mobile.');
  } finally {
    for (const number of pending.keys()) release(number, 503);
    await browser.close();await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error);server.close();process.exitCode = 1;});
