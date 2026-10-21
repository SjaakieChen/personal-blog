// Local DOM checks; no real video, mailbox, draft or publisher requests.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const script = path.resolve(__dirname, '../assets/evidence-media.js');
const link = '<p><a href="https://www.youtube.com/watch?v=Abc_123-Xyz">Alignment demonstration</a></p>';

(async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const context = await browser.newContext();
    await context.route('https://www.youtube-nocookie.com/**', route => route.fulfill({body: '<!doctype html><title>Test video</title>'}));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="body" contenteditable="true">' + link + '</div><section id="evidence-media-preview" hidden></section>');
    const source = await page.locator('#body').innerHTML();
    await page.addScriptTag({path: script});
    assert.equal(await page.locator('#body').innerHTML(), source, 'editable body is unchanged');
    assert.equal(await page.locator('#body iframe').count(), 0);
    assert.equal(await page.locator('#evidence-media-preview iframe').count(), 1);
    assert.equal(await page.locator('iframe').getAttribute('src'), 'https://www.youtube-nocookie.com/embed/Abc_123-Xyz');
    assert.equal(await page.locator('iframe').getAttribute('title'), 'Alignment demonstration');
    await page.evaluate(() => { window.originalFrame = document.querySelector('iframe'); });
    await page.locator('#body').evaluate(body => { body.innerHTML += '<p>Additional explanation.</p>'; });
    await page.waitForFunction(() => document.querySelector('#body p:last-child').textContent === 'Additional explanation.');
    assert.equal(await page.evaluate(() => originalFrame === document.querySelector('iframe')), true, 'unrelated edits preserve playback');
    await page.locator('#body a').evaluate(anchor => { anchor.textContent = 'Updated caption'; });
    await page.waitForFunction(() => document.querySelector('iframe').title === 'Updated caption');
    assert.equal(await page.evaluate(() => originalFrame === document.querySelector('iframe')), true, 'caption edits preserve playback');
    await page.locator('#body a').evaluate(anchor => { anchor.href = 'https://youtu.be/Zyx-321_cbA'; });
    await page.waitForFunction(() => document.querySelector('iframe').src.endsWith('/Zyx-321_cbA'));
    await page.locator('#body p').first().evaluate(paragraph => { paragraph.append(' is described here.'); });
    await page.waitForFunction(() => document.querySelector('#evidence-media-preview').hidden);
    assert.equal(await page.locator('iframe').count(), 0, 'inline links do not embed');

    await page.setContent('<div class="post-body">' + link
      + '<p><a href="https://youtu.be/Abc_123-Xyz">Inline link</a> with text.</p>'
      + '<p><a href="https://youtube.com.example.org/watch?v=Abc_123-Xyz">Unsupported</a></p>'
      + '<div class="references">' + link + '</div></div>');
    await page.addScriptTag({path: script});
    assert.equal(await page.locator('.post-body iframe').count(), 1);
    assert.equal(await page.locator('.post-body > p:first-child + .evidence-video').count(), 1, 'public player follows its source paragraph');
    assert.equal(await page.locator('.post-body > p:first-child a').count(), 1, 'fallback link remains');
    await page.evaluate(() => BlogEvidenceMedia.enhanceArchive(document.querySelector('.post-body')));
    assert.equal(await page.locator('iframe').count(), 1, 'enhancement is idempotent');
    assert.deepEqual(errors, []);
    console.log('Evidence media browser checks passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
