const test = require('node:test');
const assert = require('node:assert/strict');
const {youtubeId, imageURL, imageFragment, videoURL, videoFragment, demoURL, pdfManifest, knownPdf, alignPane, mediaIn, renderPane, videoTarget, mediaFragmentTarget, revealMediaFragment} = require('../assets/evidence-media');

test('native videos accept only safe MP4 evidence assets and keep stable media fragments', () => {
  const relative = 'entrepreneur/spark-demonstration.mp4';
  const fragment = '#media-video/assets/evidence/' + relative;
  const publicURL = 'https://sjaakiechen.github.io/personal-blog/assets/evidence/' + relative;
  for (const [base, assets, expected] of [
    ['https://private.example:8446/archive/', 'https://private.example:8446/', 'https://private.example:8446/assets/evidence/' + relative],
    ['https://sjaakiechen.github.io/personal-blog/archive/', 'https://sjaakiechen.github.io/personal-blog/', publicURL],
    ['http://127.0.0.1:8787/archive/', 'http://127.0.0.1:8787/', 'http://127.0.0.1:8787/assets/evidence/' + relative]
  ]) {
    assert.equal(videoURL(fragment, base, assets), expected);
    assert.equal(videoURL(publicURL + '?v=1#view', base, assets), expected);
    assert.equal(videoURL(expected, base, assets), expected);
    assert.equal(videoFragment(expected, base, assets), fragment);
  }
  const base = 'https://private.example:8446/archive/';
  for (const invalid of [
    'https://external.example/assets/evidence/movie.mp4',
    'https://user@private.example:8446/assets/evidence/movie.mp4',
    'https://private.example:8447/assets/evidence/movie.mp4',
    'http://private.example:8446/assets/evidence/movie.mp4',
    '/assets/movie.mp4', '/assets/evidence-other/movie.mp4',
    '/assets/evidence/../movie.mp4', '/assets/evidence/one/../movie.mp4',
    '/assets/evidence/one/%2e%2e/movie.mp4', '/assets/evidence/movie%2emp4',
    '/assets/evidence/movie.mov', '/assets/evidence/movie.html',
    '/assets/evidence/movie.mp4/extra', '/assets/evidence/movie.mp4\\extra',
    'data:video/mp4;base64,AAAA', 'javascript:alert(1)', null,
    '#media-video/assets/evidence/movie.mp4?autoplay=1',
    '#media-video/assets/evidence/movie.mp4#other',
    publicURL.replace('sjaakiechen.github.io', 'sjaakiechen.github.io.example.org'),
    publicURL.replace('sjaakiechen.github.io', 'other.github.io')
  ]) assert.equal(videoURL(invalid, base), null, String(invalid));
  assert.equal(videoURL('/assets/evidence/movie.mp4', 'http://private.example/archive/'), null);
  assert.equal(videoFragment('https://external.example/movie.mp4', base), null);
});

test('native MP4 links render controlled inline video, deduplicate and preserve playback on rerender', t => {
  const globals = ['ResizeObserver', 'MutationObserver', 'requestAnimationFrame', 'addEventListener'];
  const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const key of globals) {
      if (originals.get(key)) Object.defineProperty(globalThis, key, originals.get(key));
      else delete globalThis[key];
    }
  });
  globalThis.ResizeObserver = globalThis.MutationObserver = class {observe() {} disconnect() {}};
  globalThis.requestAnimationFrame = () => {};
  globalThis.addEventListener = () => {};
  const nodes = [];
  const doc = {baseURI: 'https://example.test/archive/', fullscreenElement: null,
    getElementById: id => nodes.find(node => node.id === id) || null,
    createElement(tagName) {
      const attributes = new Map(), style = new Map();
      const node = {tagName, ownerDocument: doc, children: [], dataset: {}, hidden: false, autoplay: false,
        className: '', classList: {contains: name => node.className.split(' ').includes(name)},
        style: {getPropertyValue: key => style.get(key), setProperty: (key, value) => style.set(key, value),
          removeProperty: key => style.delete(key)},
        append(...children) {for (const child of children) {child.parentElement = this;this.children.push(child);}},
        insertBefore(child, next) {child.parentElement = this;this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, child);},
        setAttribute: (name, value) => attributes.set(name, value),
        getAttribute: name => attributes.get(name), hasAttribute: name => attributes.has(name),
        querySelector: selector => node.children.find(child => child.tagName === selector) || null,
        getBoundingClientRect: () => ({top: 100, bottom: 400, left: 550}),
      };
      nodes.push(node);return node;
    }};
  const pane = doc.createElement('aside'), copy = {getBoundingClientRect: () => ({right: 500})};
  copy.closest = () => ({querySelector: () => pane});
  const href = '/assets/evidence/entrepreneur/spark-demonstration.mp4';
  const makeLink = value => ({ownerDocument: doc, textContent: 'Wooden tile demonstration',
    getAttribute: () => value, closest: selector => selector === '.post-copy' ? copy : null,
    getClientRects: () => [{top: 150, bottom: 170}]});
  const links = [makeLink(href), makeLink(href + '?v=2#view')];
  const body = {ownerDocument: doc, closest: () => copy, contains: link => links.includes(link),
    querySelectorAll: () => links, classList: {contains: () => false},
    getBoundingClientRect: () => ({top: 100, bottom: 1000})};
  assert.equal(mediaIn(body).length, 1, 'query and fragment variants produce one player');
  renderPane(body, pane);
  assert.equal(pane.children.length, 1);
  const block = pane.children[0], video = block.querySelector('video');
  assert.ok(video, 'MP4 evidence uses a native player');
  assert.equal(block.querySelector('iframe'), null);
  assert.equal(video.src, 'https://example.test' + href);
  assert.equal(video.controls, true);
  assert.equal(video.preload, 'metadata');
  assert.equal(video.playsInline, true);
  assert.equal(video.autoplay, false, 'loading a page never starts the recording');
  assert.equal(video.getAttribute('aria-label'), 'Wooden tile demonstration');
  assert.equal(block.id, 'media-video/assets/evidence/entrepreneur/spark-demonstration.mp4');
  assert.equal(videoTarget(links[0]), block, 'clicking the original asset link locates its inline player');
  video.currentTime = 12;
  links[0].textContent = 'Updated demonstration caption';
  renderPane(body, pane);
  assert.equal(pane.children[0].querySelector('video'), video, 'text edits preserve the live player');
  assert.equal(video.currentTime, 12);
  assert.equal(video.getAttribute('aria-label'), 'Updated demonstration caption');
  assert.equal(block.querySelector('figcaption').textContent, 'Updated demonstration caption');
  block.hidden = true;
  assert.equal(videoTarget(links[0]), null, 'collapsed media keeps normal link behavior until expanded');
});

test('collapsed previews hide complete media blocks that would cross Show more', () => {
  let collapsed = true;
  const doc = {fullscreenElement: null};
  const copy = {getBoundingClientRect: () => ({right: 500})};
  const body = {ownerDocument: doc, closest: () => copy, contains: () => true,
    classList: {contains: () => collapsed}, getBoundingClientRect: () => ({top: 100, bottom: 720})};
  const anchors = new WeakMap();
  function block(top, height, mentionTop) {
    let offset = '';
    const node = {hidden: false, style: {
      getPropertyValue: () => offset, setProperty: (_, value) => {offset = value;}, removeProperty: () => {offset = '';}
    }, getBoundingClientRect: () => ({top: top + (parseFloat(offset) || 0), bottom: top + (parseFloat(offset) || 0) + height})};
    anchors.set(node, {getClientRects: () => [{top: mentionTop, bottom: mentionTop + 20}]});
    return node;
  }
  const fitting = block(100, 250, 150), overflowing = block(400, 400, 450), boundary = block(600, 120, 600);
  const pane = {children: [fitting, overflowing, boundary], getBoundingClientRect: () => ({left: 550})};
  alignPane(body, pane, anchors);
  assert.equal(fitting.hidden, false, 'a complete preview that fits remains visible');
  assert.equal(overflowing.hidden, true, 'a visible mention does not authorize a figure crossing the cutoff');
  assert.equal(boundary.hidden, false, 'a figure ending exactly at the cutoff fits');
  alignPane(body, pane, anchors);
  assert.equal(overflowing.hidden, true, 'repeated layout leaves the oversized block hidden');
  collapsed = false;alignPane(body, pane, anchors);
  assert.ok(pane.children.every(node => !node.hidden), 'expanded and standalone posts retain all media');
  collapsed = true;alignPane(body, pane, anchors);
  assert.equal(overflowing.hidden, true, 'Show less restores the whole-post bound');
  pane.getBoundingClientRect = () => ({left: 0});
  overflowing.getBoundingClientRect = () => ({top: 800, bottom: 1200});
  alignPane(body, pane, anchors);
  assert.equal(overflowing.hidden, true, 'mobile media below the collapsed text stays hidden');
});

test('media fragments wait for generated targets and reveal a hidden carousel page without opening media', () => {
  const actions = [], nodes = new Map();
  const doc = {getElementById: id => nodes.get(id), defaultView: {CustomEvent: class {constructor(type, options) {this.type=type;Object.assign(this,options);}}}};
  assert.equal(mediaFragmentTarget(doc, '#media-evidence--example-page-3'), null, 'an unfetched manifest has no target yet');
  assert.equal(revealMediaFragment(doc, '#media-evidence--example-page-3'), false);
  let collapsed = true;
  const body = {ownerDocument: doc, classList: {contains: () => collapsed}, nextElementSibling: {click() {collapsed=false;actions.push('expand');}},
    closest: () => ({getBoundingClientRect: () => ({right: 500})}), getBoundingClientRect: () => ({bottom: 1200})};
  const pane = {children: [], getBoundingClientRect: () => ({left: 550}), closest: () => ({querySelector: () => body})};
  const target = {closest: selector => selector === '.post-media' ? pane : null,
    dispatchEvent(event) {assert.equal(event.type,'blog-media-reveal');assert.equal(event.detail.target,this);actions.push('select-page');},
    scrollIntoView(options) {assert.equal(options.block,'start');actions.push('scroll');}};
  nodes.set('media-evidence--example-page-3',target);
  assert.equal(revealMediaFragment(doc, '#media-evidence--example-page-3'), true);
  assert.deepEqual(actions,['expand','select-page','scroll'], 'expand and select the target before calculating the scroll');
  assert.equal(revealMediaFragment(doc, '#ref-citation'),false,'ordinary article anchors are not intercepted');
  assert.equal(revealMediaFragment(doc, '#media-bad%'),false,'malformed fragments are ignored');
  nodes.set('media-outside',{closest: () => null});
  assert.equal(revealMediaFragment(doc, '#media-outside'),false,'only targets in a media pane qualify');
});

test('interactive demos accept only same-site evidence entry documents', () => {
  const base = 'https://private.example:8446/write/', entry = '/assets/evidence/drafts/demos/imec-alignment/index.html';
  assert.equal(demoURL(entry, base), 'https://private.example:8446' + entry);
  assert.equal(demoURL('https://sjaakiechen.github.io/personal-blog/assets/evidence/demos/joy-checkpoint-5850-live/index.html?load=auto', base), 'https://private.example:8446/assets/evidence/demos/joy-checkpoint-5850-live/index.html');
  assert.equal(demoURL('https://sjaakiechen.github.io/personal-blog/assets/evidence/drafts/demos/private/index.html', base), null);
  assert.equal(demoURL(entry + '?v=1#view', base), 'https://private.example:8446' + entry);
  assert.equal(demoURL('/personal-blog/assets/evidence/demos/imec-alignment/index.html', 'https://public.example/personal-blog/posts/one/', 'https://public.example/personal-blog/'), 'https://public.example/personal-blog/assets/evidence/demos/imec-alignment/index.html');
  assert.equal(demoURL(entry, 'http://127.0.0.1:8787/write/'), 'http://127.0.0.1:8787' + entry);
  for (const value of ['https://external.example' + entry, 'https://user@private.example:8446' + entry, 'http://private.example:8446' + entry, '/assets/evidence/other/index.html', '/assets/evidence/drafts/demos/imec-alignment/demo.js', '/assets/evidence/drafts/demos/imec-alignment/../secret.html', '/assets/evidence/drafts/demos/nested/name/index.html', '/write/', 'data:text/html,hello', null]) assert.equal(demoURL(value, base), null, String(value));
  assert.equal(demoURL(entry, 'http://private.example:8446/write/'), null);
});

test('direct image links stay inside this site evidence assets and deduplicate URL fragments', () => {
  const base = 'https://private.example:8446/write/', image = '/assets/evidence/drafts/imec/alignment.webp';
  assert.equal(imageURL(image, base), 'https://private.example:8446' + image);
  assert.equal(imageURL(image + '?v=1#view', base), 'https://private.example:8446' + image);
  for (const suffix of ['png', 'jpg', 'jpeg', 'webp']) assert.ok(imageURL('/assets/evidence/imec/screenshot.' + suffix, base));
  assert.equal(imageURL('/personal-blog/assets/evidence/imec/screenshot.png', 'https://public.example/personal-blog/posts/one/', 'https://public.example/personal-blog/'), 'https://public.example/personal-blog/assets/evidence/imec/screenshot.png');
  assert.equal(imageURL(image, 'http://127.0.0.1:8787/write/'), 'http://127.0.0.1:8787' + image);
  for (const value of ['https://external.example' + image, 'https://user@private.example:8446' + image, 'http://private.example:8446' + image, '/assets/secret.png', '/assets/evidence/../../private.png', '/assets/evidence/drafts/imec/file.svg', '/assets/evidence/drafts/imec/file.pdf', '/assets/evidence/drafts/imec/file%2epng', 'data:image/png;base64,AAAA', 'javascript:alert(1)', null]) assert.equal(imageURL(value, base), null, String(value));
  assert.equal(imageURL(image, 'http://private.example:8446/write/'), null, 'real hosts require HTTPS');
});

test('own public evidence images map to the current asset base for private previews', () => {
  const prefix = 'https://sjaakiechen.github.io/personal-blog/assets/evidence/';
  const relative = 'ct-scanner/knight-shadow.png', value = prefix + relative;
  assert.equal(imageURL(value, 'https://private.example:8446/write/', 'https://private.example:8446/'), 'https://private.example:8446/assets/evidence/' + relative);
  assert.equal(imageURL(value + '?v=1#full-size', 'http://127.0.0.1:8787/write/', 'http://127.0.0.1:8787/'), 'http://127.0.0.1:8787/assets/evidence/' + relative);
  assert.equal(imageURL(value, 'https://sjaakiechen.github.io/personal-blog/evidence/ct-scanner/', 'https://sjaakiechen.github.io/personal-blog/'), value);
  for (const invalid of [value.replace('https:', 'http:'), value.replace('sjaakiechen.github.io', 'sjaakiechen.github.io.example.org'), value.replace('sjaakiechen.github.io', 'other.github.io'), value.replace('https://', 'https://user@'), value.replace('.io/', '.io:443/'), value.replace('.io/', '.io:8446/'), prefix + 'one/../knight.png', prefix + 'one/%2e%2e/knight.png', prefix + '../knight.png', prefix + 'knight.svg', prefix + 'knight%2epng']) {
    assert.equal(imageURL(invalid, 'https://private.example:8446/write/', 'https://private.example:8446/'), null, invalid);
  }
});

test('image fragments identify only safe evidence assets across private and public bases', () => {
  const fragment = '#media-image/assets/evidence/ct-scanner/knight-shadow.png';
  for (const [base, assets, expected] of [
    ['https://private.example:8446/write/', 'https://private.example:8446/', 'https://private.example:8446/assets/evidence/ct-scanner/knight-shadow.png'],
    ['https://sjaakiechen.github.io/personal-blog/evidence/ct-scanner/', 'https://sjaakiechen.github.io/personal-blog/', 'https://sjaakiechen.github.io/personal-blog/assets/evidence/ct-scanner/knight-shadow.png'],
    ['http://127.0.0.1:8787/write/', 'http://127.0.0.1:8787/', 'http://127.0.0.1:8787/assets/evidence/ct-scanner/knight-shadow.png']
  ]) {
    assert.equal(imageURL(fragment, base, assets), expected);
    assert.equal(imageFragment(expected, base, assets), fragment);
  }
  for (const invalid of ['#media-image/assets/evidence/../private.png', '#media-image/assets/evidence/%2e%2e/private.png', '#media-image/assets/evidence/image.svg', '#media-image/assets/evidence/image.png?x=1', '#media-image/assets/evidence/image.png#other', '#media-image/https://external.example/image.png']) {
    assert.equal(imageURL(invalid, 'https://private.example/write/'), null, invalid);
  }
});

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

test('legacy type-order metadata no longer changes a known PDF', () => {
  const entry = {pdf: '/assets/evidence/example/poster.pdf', title: 'Example poster',
    previews: ['/assets/evidence/example/page-1.webp']};
  const data = {'/evidence/example/': entry};
  assert.deepEqual(pdfManifest({'/evidence/example/': {...entry, media_order: ['pdf', 'image', 'video']}}, 'https://private.example/'),
    pdfManifest(data, 'https://private.example/'));
});

test('PDF page fragments use stable, distinct permalink IDs and only known preview pages', () => {
  const entry = {pdf: '/assets/evidence/drafts/ib-physics/paper.pdf', download_url: '/assets/evidence/drafts/ib-physics/paper.pdf',
    title: 'Physics essay', previews: [1, 10, 16].map(page => '/assets/evidence/drafts/ib-physics/page-' + page + '.webp'), preview_pages: [1, 10, 16], total_pages: 22};
  const entries = pdfManifest({'/evidence/ib-physics-extended-essay/': entry}, 'https://private.example/');
  assert.equal(entries[0].id, 'media-evidence--ib-physics-extended-essay');
  for (const page of [1, 10, 16]) assert.equal(knownPdf('#media-evidence--ib-physics-extended-essay-page-' + page, entries, 'https://private.example/write/'), entries[0]);
  for (const fragment of ['#media-evidence--ib-physics-extended-essay-page-2', '#media-evidence--ib-physics-extended-essay-page-01', '#ref-unknown', '#bad%']) assert.equal(knownPdf(fragment, entries, 'https://private.example/write/'), null);
  const routes = ['/', '/root/', '/a/b/', '/a--b/', '/a-/b/', '/a/-b/', '/a_b/', '/a_5f_b/'];
  const ids = routes.map(route => pdfManifest({[route]: entry}, 'https://private.example/')[0].id);
  assert.equal(new Set(ids).size, routes.length, 'route separators and literal escape markers cannot collide');
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
