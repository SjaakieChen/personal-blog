const test = require('node:test');
const assert = require('node:assert/strict');
const {youtubeId, pdfManifest, knownPdf} = require('../assets/evidence-media');

test('YouTube URLs use exact HTTPS hosts and one valid video identifier', () => {
  const id = 'Abc_123-Xyz';
  for (const url of [
    `https://youtu.be/${id}?si=example`,
    `https://www.youtube.com/watch?v=${id}&t=30`,
    `https://youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}`
  ]) assert.equal(youtubeId(url), id, url);
  for (const url of [
    `http://youtu.be/${id}`, `https://youtu.be.example.com/${id}`,
    `https://youtube.com.example.com/watch?v=${id}`, `https://example.com/watch?v=${id}`,
    `https://user@youtu.be/${id}`, `https://youtu.be:444/${id}`,
    `https://youtu.be/${id}/other`, `https://youtube.com/embed/${id}`,
    `https://youtube.com/watch?v=${id}&v=${id}`, `https://youtube.com/watch?v=${id}%22`,
    'https://youtu.be/short', 'https://youtu.be/Abc_123-Xyz2',
    'javascript:alert(1)', '//youtu.be/Abc_123-Xyz', null, {}
  ]) assert.equal(youtubeId(url), null, String(url));
});

test('known PDF previews resolve on the current site and keep a stable public download', () => {
  const data = {'/evidence/example/': {pdf: '/assets/evidence/example/poster.pdf',
    public_pdf: 'https://public.example/blog/assets/evidence/example/poster.pdf',
    title: 'Example poster', previews: ['/assets/evidence/example/page-1.webp']}};
  const entries = pdfManifest(data, 'https://private.example/');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].previews[0], 'https://private.example/assets/evidence/example/page-1.webp');
  assert.equal(entries[0].downloadURL.href, data['/evidence/example/'].public_pdf);
  assert.deepEqual(entries[0].pages, [1]);
  assert.equal(entries[0].totalPages, 1);
  assert.equal(knownPdf(data['/evidence/example/'].public_pdf + '#page=1', entries, 'https://private.example/'), entries[0]);
  assert.equal(knownPdf('/assets/evidence/example/poster.pdf', entries, 'https://private.example/'), entries[0]);
  assert.equal(knownPdf('https://unrelated.example/blog/assets/evidence/example/poster.pdf', entries, 'https://private.example/'), null);
  assert.equal(knownPdf('https://user@public.example/blog/assets/evidence/example/poster.pdf', entries, 'https://private.example/'), null);
  for (const previews of [['https://unrelated.example/image.png'], ['/assets/evidence/../private.png'], ['/assets/evidence/example/file.pdf']]) {
    assert.deepEqual(pdfManifest({'/bad/': {...data['/evidence/example/'], previews}}, 'https://private.example/'), []);
  }
});

test('private PDF links keep their authenticated host and representative page numbers', () => {
  const item = {pdf: '/assets/evidence/drafts/example/paper.pdf',
    public_pdf: 'https://public.example/unused.pdf',
    download_url: 'https://private.example:8446/assets/evidence/drafts/example/paper.pdf',
    title: 'Private example paper', previews: [1, 10, 16].map(page => '/assets/evidence/drafts/example/page-' + page + '.webp'),
    preview_pages: [1, 10, 16], total_pages: 22};
  const entries = pdfManifest({'/private-example/': item}, 'https://private.example:8446/');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].downloadURL.href, item.download_url, 'private URL overrides legacy public field');
  assert.deepEqual(entries[0].pages, [1, 10, 16]);
  assert.equal(entries[0].totalPages, 22);
  assert.equal(knownPdf(item.download_url, entries, 'https://private.example:8446/'), entries[0]);
  assert.equal(knownPdf(item.public_pdf, entries, 'https://private.example:8446/'), null);
  const relative = pdfManifest({'/private-example/': {...item, download_url: item.pdf}}, 'https://private.example:8446/');
  assert.equal(relative[0].downloadURL.href, item.download_url);
  for (const invalid of [{preview_pages: [1, 10]}, {preview_pages: [0, 10, 16]}, {total_pages: 15}, {total_pages: 22.5}, {download_url: 'javascript:alert(1)'}]) {
    assert.deepEqual(pdfManifest({'/private-example/': {...item, ...invalid}}, 'https://private.example:8446/'), []);
  }
});
