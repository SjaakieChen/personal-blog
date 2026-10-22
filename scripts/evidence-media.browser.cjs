// Local layout/DOM checks; no real video, mailbox, draft or publisher requests.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const pdf = 'https://public.example/blog/assets/evidence/example/poster.pdf';
const manifest = {'/evidence/example/': {pdf: '/assets/evidence/example/poster.pdf', public_pdf: pdf,
  title: 'Example group project poster', previews: [1, 2, 3].map(page => '/assets/evidence/example/page-' + page + '.webp')},
  '/private-example/': {pdf: '/assets/evidence/drafts/example/paper.pdf', download_url: '/assets/evidence/drafts/example/paper.pdf',
    title: 'Private example paper', previews: [1, 10, 16].map(page => '/assets/evidence/drafts/example/page-' + page + '.webp'),
    preview_pages: [1, 10, 16], total_pages: 22}};
Object.assign(manifest, require('../_data/evidence.json'));
const ct = manifest['/evidence/ct-scanner/'];
const ownPublicImage = 'https://sjaakiechen.github.io/personal-blog/assets/evidence/example/knight.png';
const privateText = '<p>Read the <a href="/assets/evidence/drafts/example/paper.pdf">full private paper</a>.</p>'
  + '<p><a href="' + ownPublicImage + '">Knight shadow</a></p>'
  + '<p><a href="/assets/evidence/example/knight.png">Same local preview</a></p>'
  + '<p><a href="https://sjaakiechen.github.io.example.org/personal-blog/assets/evidence/example/knight.png">Unrelated host</a></p>';
const screenshot = '/assets/evidence/drafts/imec/alignment.webp';
const staticText = '<p><a href="' + ownPublicImage + '">Knight shadow</a></p><p><a href="' + pdf + '">Original poster PDF</a></p>';
const staticPane = '<div data-original-pdf class="evidence-pdf" data-media-key="pdf:/assets/evidence/example/poster.pdf" data-static-media>'
  + [1, 2, 3].map(page => '<figure><a href="' + pdf + '"><img src="/assets/evidence/example/page-' + page + '.webp" alt="Server-rendered poster, page ' + page + '"></a><figcaption>Original poster · ' + page + ' / 3</figcaption></figure>').join('') + '</div>'
  + '<div data-media-key="inline:fallback" data-static-media><img src="/assets/evidence/example/page-2.webp" alt="Unreferenced fallback"></div>';
const text = '<p>See the <a class="text-citation" data-reference="demo" data-label="demo" href="https://www.youtube.com/watch?v=Abc_123-Xyz">demo</a> for the alignment procedure.</p>'
  + '<p><a href="https://youtu.be/Abc_123-Xyz">Another link to the same demo</a>.</p>'
  + '<p>Read the <a href="' + pdf + '">original poster PDF</a>.</p>'
  + '<p><a href="https://youtube.com.example.org/watch?v=Zyx-321_cbA">Unsupported link</a></p>'
  + '<p><a href="' + screenshot + '">Camera-guided placement</a></p>'
  + '<p><a href="' + screenshot + '#full-size">Same screenshot again</a></p>'
  + '<p><a href="https://external.example' + screenshot + '">External image stays a link</a></p>'
  + '<div class="references"><p><a href="https://youtu.be/Zyx-321_cbA">Reference only</a></p></div>';
const ctText = '<p>Our scanner setup.<sup class="citation" data-reference="ct-poster"><a href="#ref-ct-1">[1]</a></sup></p>'
  + '<p><a href="https://youtu.be/Abc_123-Xyz">Submission video</a></p>'
  + '<p><a href="' + ownPublicImage + '">Knight shadow</a></p>'
  + '<p><a href="' + ct.public_pdf + '">Download the original poster</a></p>';
const ctReferences = '<div class="references"><ol><li id="ref-ct-1"><a href="' + ct.public_pdf + '#page=1">Poster reference</a></li></ol></div>';
const ctStaticPane = '<div data-ct-original-pdf class="evidence-pdf" data-media-key="pdf:' + ct.pdf + '" data-static-media>'
  + ct.previews.map((src, i) => '<figure><a href="' + ct.public_pdf + '"><img src="' + src + '" alt="Poster page ' + (i + 1) + '"></a><figcaption>Poster page ' + (i + 1) + '</figcaption></figure>').join('') + '</div>';
function html(mode) {
  const writer = ['/writer', '/private-writer', '/ct-writer'].includes(mode), plain = mode === '/plain';
  const ctMode = mode === '/ct-writer' || mode === '/ct-archive';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css">'
    + '<script src="/assets/evidence-media.js" defer></script></head><body><div class="blog-shell"><aside class="sidebar">Blog</aside><main class="main"><div class="reading-column">'
    + '<article class="post"><div class="post-copy"><h1>Research evidence</h1><div ' + (writer ? 'id="body" contenteditable="true" ' : '') + 'class="post-body">'
    + (plain ? '<p>A plain text article without media.</p>' : ctMode ? ctText + ctReferences : mode === '/private-writer' ? privateText : mode === '/static-archive' ? staticText : text) + '</div></div><aside class="post-media" '
    + (writer ? 'id="evidence-media-preview" ' : '') + 'aria-label="Media" hidden>' + (mode === '/static-archive' ? staticPane : mode === '/ct-archive' ? ctStaticPane : '') + '</aside></article></div></main></div></body></html>';
}
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (['/writer', '/private-writer', '/archive', '/static-archive', '/plain', '/ct-writer', '/ct-archive'].includes(pathname)) {res.setHeader('Content-Type', 'text/html');res.end(html(pathname));return;}
  if (pathname === '/assets/evidence/media.json') {res.setHeader('Content-Type', 'application/json');res.end(JSON.stringify(manifest));return;}
  if (pathname === screenshot || pathname === '/assets/evidence/example/knight.png' || ct.previews.includes(pathname) || /^\/assets\/evidence\/(drafts\/)?example\/page-\d+\.webp$/.test(pathname)) {
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
    assert.equal(await page.locator('.post-media .evidence-pdf img').count(), 3);
    const carousel = page.locator('.evidence-pdf-carousel');
    await carousel.waitFor();
    assert.deepEqual(await page.locator('.post-media > [data-media-key]').evaluateAll(blocks => blocks.map(block => block.dataset.mediaKey.split(':')[0])),
      ['video', 'pdf', 'image'], 'unconfigured PDFs preserve source order');
    assert.equal(await carousel.getAttribute('aria-roledescription'), 'carousel');
    assert.equal(await carousel.getAttribute('aria-label'), 'Example group project poster');
    assert.equal(await carousel.locator('figure:visible').count(), 1, 'one poster page is visible');
    assert.equal(await carousel.getByRole('status').textContent(), 'Page 1 of 3');
    assert.equal(await carousel.getByRole('button', {name: 'Previous page'}).isDisabled(), true);
    await carousel.getByRole('button', {name: 'Next page'}).click();
    assert.equal(await carousel.getByRole('status').textContent(), 'Page 2 of 3');
    assert.equal(await carousel.locator('figure:visible img').getAttribute('src'), origin + '/assets/evidence/example/page-2.webp');
    await carousel.getByRole('button', {name: 'Next page'}).press('Enter');
    assert.equal(await carousel.getByRole('status').textContent(), 'Page 3 of 3');
    assert.equal(await carousel.getByRole('button', {name: 'Next page'}).isDisabled(), true);
    await carousel.getByRole('button', {name: 'Previous page'}).press('Space');
    assert.equal(await carousel.getByRole('status').textContent(), 'Page 2 of 3', 'native controls work from the keyboard');
    assert.equal(await page.locator('.post-media .evidence-image img').count(), 1, 'ordinary image links deduplicate; external images do not embed');
    assert.equal(await page.locator('.evidence-image img').getAttribute('src'), origin + screenshot);
    assert.equal(await page.locator('.evidence-image img').getAttribute('alt'), 'Camera-guided placement');
    assert.equal(await page.locator('.evidence-image figcaption').textContent(), 'Camera-guided placement');
    assert.equal(await page.locator('.evidence-image a').getAttribute('href'), origin + screenshot);
    assert.equal(await page.locator('.evidence-image a').getAttribute('target'), '_blank', 'screenshot opens full size');
    assert.equal(await page.locator('.evidence-pdf a').first().getAttribute('href'), pdf, 'preview opens stable public PDF');
    assert.equal(await page.locator('.evidence-pdf img').first().getAttribute('src'), origin + '/assets/evidence/example/page-1.webp');
    const boxes = await page.evaluate(() => {
      const copy = document.querySelector('.post-copy').getBoundingClientRect(), media = document.querySelector('.post-media').getBoundingClientRect();
      return {copy: {left: copy.left, right: copy.right, top: copy.top, width: copy.width}, media: {left: media.left, top: media.top, width: media.width}};
    });
    assert.ok(boxes.media.left > boxes.copy.right, 'desktop media is to the right of text');
    assert.ok(await page.evaluate(() => document.querySelector('.evidence-video').getBoundingClientRect().top
      >= document.querySelector('#body a').getClientRects()[0].top - 1), 'video begins at or below its first mention');
    assert.ok(boxes.copy.width >= 350 && boxes.media.width >= 350, 'both columns remain useful at 1280px');
    if (process.env.MEDIA_SCREENSHOT) await page.screenshot({path: process.env.MEDIA_SCREENSHOT});
    await page.evaluate(() => { window.originalFrame = document.querySelector('iframe'); });
    await page.locator('#body').evaluate(body => { body.innerHTML += '<p>Additional explanation.</p>'; });
    await page.waitForFunction(() => document.querySelector('#body > p:last-child').textContent === 'Additional explanation.');
    assert.equal(await page.evaluate(() => originalFrame === document.querySelector('iframe')), true, 'editor redraw preserves playback');
    assert.equal(await carousel.getByRole('status').textContent(), 'Page 2 of 3', 'editor redraw preserves the selected poster page');
    assert.equal(await carousel.locator('.evidence-pdf-controls').count(), 1, 'editor redraw never duplicates controls');
    await page.locator('#body a').first().evaluate(anchor => { anchor.textContent = 'Updated demo'; });
    await page.waitForFunction(() => document.querySelector('iframe').title === 'Updated demo');
    assert.equal(await page.evaluate(() => originalFrame === document.querySelector('iframe')), true, 'caption edit preserves playback');
    await page.locator('#body a').filter({hasText:'Camera-guided placement'}).evaluate(anchor => { anchor.textContent = 'Updated screenshot caption'; });
    await page.waitForFunction(() => document.querySelector('.evidence-image figcaption').textContent === 'Updated screenshot caption');
    assert.equal(await page.locator('.evidence-image img').getAttribute('alt'), 'Updated screenshot caption');
    await page.locator('#body').evaluate(body => { body.innerHTML = '<p><a href="https://youtu.be/Abc_123-Xyz">Only video</a></p>'; });
    await page.waitForFunction(() => document.querySelectorAll('.post-media iframe').length === 1 && document.querySelectorAll('.post-media img').length === 0);
    await page.locator('#body').evaluate(body => { body.innerHTML = '<p>Only words remain.</p>'; });
    await page.waitForFunction(() => document.querySelector('.post-media').hidden);
    assert.equal(await page.locator('.post-media iframe, .post-media img').count(), 0);
    assert.ok((await page.locator('.reading-column').boundingBox()).width <= 660, 'no empty media column remains');

    await page.goto(origin + '/private-writer');
    await page.waitForSelector('.evidence-pdf img');
    assert.equal(await page.locator('#body').innerHTML(), privateText, 'private draft text stays unchanged');
    assert.equal(await page.locator('#body a').nth(1).getAttribute('href'), ownPublicImage, 'saved href retains its stable public address');
    assert.equal(await page.locator('.evidence-image img').count(), 1, 'own public and local image references deduplicate; lookalike host stays a link');
    assert.equal(await page.locator('.evidence-image img').getAttribute('src'), origin + '/assets/evidence/example/knight.png', 'private preview uses the locally deployed asset');
    assert.equal(await page.locator('.evidence-image a').getAttribute('href'), origin + '/assets/evidence/example/knight.png');
    assert.equal(await page.locator('.evidence-image figcaption').textContent(), 'Knight shadow');
    assert.equal(await page.locator('.evidence-pdf img').count(), 3, 'only representative pages are shown');
    assert.equal(await page.locator('.evidence-pdf-carousel').count(), 0, 'representative essay previews stay stacked');
    assert.equal(await page.locator('.evidence-pdf figure:visible').count(), 3);
    assert.deepEqual(await page.locator('.evidence-pdf img').evaluateAll(images => images.map(image => image.alt)),
      [1, 10, 16].map(number => 'Private example paper, page ' + number + ' of 22'));
    assert.deepEqual(await page.locator('.evidence-pdf figcaption').allTextContents(),
      [1, 10, 16].map(number => 'Private example paper · ' + number + ' / 22'));
    assert.deepEqual(await page.locator('.evidence-pdf a').evaluateAll(links => links.map(link => link.href)),
      Array(3).fill(origin + '/assets/evidence/drafts/example/paper.pdf'), 'all previews open the full private PDF');
    const essayIDs = [1, 10, 16].map(number => 'media-private-example-page-' + number);
    assert.deepEqual(await page.locator('.evidence-pdf > figure').evaluateAll(figures => figures.map(figure => figure.id)), essayIDs);
    const jumpText = '<p>Read <span class="text-citation" data-reference="essay-experiment"><a href="#' + essayIDs[0] + '">the experiment</a></span>, '
      + '<a href="#' + essayIDs[2] + '">the Gaussian result</a>, and <a href="#' + essayIDs[1] + '">the coupling bench</a>.</p>';
    await page.evaluate(text => {
      window.originalEssayFigure = document.querySelector('.evidence-pdf > figure');
      document.querySelector('#body').innerHTML = text;
    }, jumpText);
    await page.waitForFunction(() => document.querySelectorAll('.post-media > [data-media-key]').length === 1);
    assert.equal(await page.locator('#body').innerHTML(), jumpText, 'same-page media links remain unchanged in the draft');
    assert.equal(await page.evaluate(() => originalEssayFigure === document.querySelector('.evidence-pdf > figure')), true, 'fragment-only mentions reuse the existing preview figures');
    assert.equal(await page.evaluate(({manifest, origin}) => {
      const body = document.querySelector('#body'), items = BlogEvidenceMedia.mediaIn(body, BlogEvidenceMedia.pdfManifest(manifest, origin + '/'));
      return items.length === 1 && items[0].anchor === body.querySelector('.text-citation a');
    }, {manifest, origin}), true, 'named same-page media citations resolve directly and retain the first mention');
    assert.deepEqual(await page.locator('.evidence-pdf > figure').evaluateAll(figures => figures.map(figure => figure.id)), essayIDs, 'page IDs remain stable across rerenders');

    const privateEntry = manifest['/private-example/'];
    manifest['/private-example/'] = {...privateEntry,
      pdf: '/assets/evidence/example/paper.pdf', download_url: '/assets/evidence/example/paper.pdf',
      previews: privateEntry.previews.map(src => src.replace('/drafts/', '/'))};
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('blog-media-published')));
    await page.waitForFunction(() => document.querySelector('.evidence-pdf a')?.getAttribute('href').endsWith('/assets/evidence/example/paper.pdf'));
    assert.equal(await page.locator('#body').innerHTML(), jumpText, 'publishing media refreshes previews without changing writing');
    assert.deepEqual(await page.locator('.evidence-pdf > figure').evaluateAll(figures => figures.map(figure => figure.id)), essayIDs,
      'published previews retain the same in-page destinations');
    assert.deepEqual(await page.locator('.evidence-pdf img').evaluateAll(images => images.map(image => image.getAttribute('src'))),
      [1, 10, 16].map(number => origin + '/assets/evidence/example/page-' + number + '.webp'));
    manifest['/private-example/'] = privateEntry;

    await page.goto(origin + '/archive');
    await page.waitForSelector('.evidence-pdf img');
    assert.equal(await page.locator('.post-body').innerHTML(), text, 'public fallback links stay in the text');
    assert.equal(await page.locator('.post-media .evidence-image img').count(), 1, 'public image links also use the media pane');
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
    await page.goto(origin + '/static-archive');
    await page.waitForSelector('.evidence-image img');
    const linkedImageKey = 'image:' + origin + '/assets/evidence/example/knight.png';
    const pdfKey = 'pdf:/assets/evidence/example/poster.pdf';
    const mediaOrder = () => page.locator('.post-media > [data-media-key]').evaluateAll(blocks => blocks.map(block => block.dataset.mediaKey));
    assert.deepEqual(await mediaOrder(), [linkedImageKey, pdfKey, 'inline:fallback'], 'linked static PDF follows the photo in body order');
    assert.equal(await page.locator('[data-original-pdf]').count(), 1, 'existing server-rendered PDF is reused');
    assert.equal(await page.locator('[data-original-pdf].evidence-pdf-carousel').count(), 1, 'public static PDF gains the same carousel');
    assert.equal(await carousel.locator('figure:visible').count(), 1);
    await carousel.getByRole('button', {name: 'Next page'}).click();
    assert.equal(await carousel.locator('figure:visible .evidence-pdf-frame > a').getAttribute('href'), pdf, 'poster page still opens the original PDF');
    assert.equal(await page.locator('img[alt="Unreferenced fallback"]').count(), 1);
    assert.equal(await page.locator('.post-body').innerHTML(), staticText);
    await page.evaluate(({manifest, origin}) => {
      const body = document.querySelector('.post-body');
      window.originalStaticPdf = document.querySelector('[data-original-pdf]');
      body.prepend(body.lastElementChild);
      BlogEvidenceMedia.enhanceArticle(body, BlogEvidenceMedia.pdfManifest(manifest, origin + '/'));
    }, {manifest, origin});
    assert.deepEqual(await mediaOrder(), [pdfKey, linkedImageKey, 'inline:fallback'], 'reordered links move reused PDF to the corresponding position');
    assert.equal(await page.evaluate(() => originalStaticPdf === document.querySelector('[data-original-pdf]')), true);
    assert.equal(await carousel.getByRole('status').textContent(), 'Page 2 of 3', 'reordering preserves the selected page');
    await page.evaluate(({manifest, origin}) => {
      const body = document.querySelector('.post-body');body.firstElementChild.remove();
      BlogEvidenceMedia.enhanceArticle(body, BlogEvidenceMedia.pdfManifest(manifest, origin + '/'));
    }, {manifest, origin});
    assert.deepEqual(await mediaOrder(), [linkedImageKey, pdfKey, 'inline:fallback'], 'unreferenced static PDF and inline fallback remain available');
    assert.equal(await carousel.locator('.evidence-pdf-controls').count(), 1);
    for (const width of [390, 320]) {
      await page.setViewportSize({width, height: 844});
      await carousel.getByRole('button', {name: 'Previous page'}).scrollIntoViewIfNeeded();
      const dimensions = await page.evaluate(() => {
        const main = document.querySelector('.main'), controls = document.querySelector('.evidence-pdf-controls').getBoundingClientRect();
        return {page: document.documentElement.scrollWidth, viewport: innerWidth, main: main.clientWidth, scroll: main.scrollWidth, left: controls.left, right: controls.right};
      });
      assert.ok(dimensions.page <= width && dimensions.scroll <= dimensions.main + 1 && dimensions.left >= 0 && dimensions.right <= width, width + 'px carousel has no horizontal overflow');
    }
    await carousel.getByRole('button', {name: 'Previous page'}).click();
    assert.equal(await carousel.getByRole('status').textContent(), 'Page 1 of 3', 'mobile arrows remain operable');
    for (const mode of ['/ct-writer', '/ct-archive']) {
      await page.goto(origin + mode);
      await page.waitForSelector('.evidence-pdf-carousel');
      const expected = ['pdf:' + ct.pdf, 'video:Abc_123-Xyz', linkedImageKey];
      assert.deepEqual(await mediaOrder(), expected, mode + ' follows first mentions: numbered poster citation, video, picture');
      assert.equal(await page.locator('.post-body').innerHTML(), ctText + ctReferences, 'prose, links and citation markup stay unchanged');
      await carousel.getByRole('button', {name: 'Next page'}).click();
      await page.evaluate(({manifest, origin}) => {
        window.ctFrame = document.querySelector('iframe');window.ctPoster = document.querySelector('.evidence-pdf');
        const body = document.querySelector('.post-body');body.insertAdjacentHTML('beforeend', '<p>More text.</p>');
        BlogEvidenceMedia.renderPane(body, document.querySelector('.post-media'), BlogEvidenceMedia.pdfManifest(manifest, origin + '/'));
      }, {manifest, origin});
      assert.deepEqual(await mediaOrder(), expected);
      assert.equal(await page.evaluate(() => ctFrame === document.querySelector('iframe') && ctPoster === document.querySelector('.evidence-pdf')), true, 'ordered renders preserve the live player and poster nodes');
      assert.equal(await carousel.getByRole('status').textContent(), 'Page 2 of 3');
      await page.evaluate(({manifest, origin}) => {
        const body = document.querySelector('.post-body');body.querySelectorAll(':scope > p')[3].remove();
        BlogEvidenceMedia.renderPane(body, document.querySelector('.post-media'), BlogEvidenceMedia.pdfManifest(manifest, origin + '/'));
      }, {manifest, origin});
      assert.deepEqual(await mediaOrder(), expected, 'numbered citation still anchors the poster after its redundant download link is removed');
      assert.equal(await page.locator('.references').evaluate(element => element.outerHTML), ctReferences);
      await page.evaluate(({manifest, origin}) => {
        const body = document.querySelector('.post-body');body.querySelector(':scope > p').remove();
        BlogEvidenceMedia.renderPane(body, document.querySelector('.post-media'), BlogEvidenceMedia.pdfManifest(manifest, origin + '/'));
      }, {manifest, origin});
      if (mode === '/ct-archive') {
        assert.deepEqual(await mediaOrder(), ['video:Abc_123-Xyz', linkedImageKey, 'pdf:' + ct.pdf], 'unmentioned public static poster remains as a final fallback');
        assert.equal(await page.locator('[data-ct-original-pdf]').count(), 1);
        assert.equal(await carousel.getByRole('status').textContent(), 'Page 2 of 3');
      } else {
        assert.deepEqual(await mediaOrder(), ['video:Abc_123-Xyz', linkedImageKey], 'uncited reference-list PDFs do not create previews');
      }
    }
    await page.goto(origin + '/plain');
    assert.equal(await page.locator('.post-media').evaluate(pane => pane.hidden), true);
    assert.equal(await page.locator('.post-media').evaluate(pane => getComputedStyle(pane).display), 'none');
    assert.ok((await page.locator('.reading-column').boundingBox()).width <= 660);
    assert.deepEqual(errors, []);
    console.log('Media pane browser checks passed: poster carousel and keyboard controls, representative PDF previews, inline links, clean editor, playback, desktop/mobile, text-only layout.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error);server.close();process.exitCode = 1; });
