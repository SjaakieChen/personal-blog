const assert = require('node:assert/strict');
const test = require('node:test');
const {modalRequest, withoutModal, reopenURL, outsideDialog, targetFor, requestFromLink, focusAfterClose} = require('../assets/archive-media-modal.js');

const origin = 'https://sjaakiechen.github.io/personal-blog';

test('current and legacy archive CV deep links enlarge while post routes stay ordinary', () => {
  const fragments = [
    'media-image/assets/evidence/entrepreneur/house.jpg',
    'media-video/assets/evidence/entrepreneur/spark-demonstration.mp4',
    'media-video-B5ln2s0bnAY', 'media-demo-joy-checkpoint-5850-live',
    'media-evidence--ct-scanner-page-3', 'media-archive--entrepreneur-page-1'
  ];
  for (const id of fragments) {
    assert.equal(modalRequest(origin + '/archive/example/?media=modal#' + id).id, id);
    assert.equal(modalRequest(origin + '/archive/example/#' + id).id, id);
    assert.equal(modalRequest(origin + '/archive/example/?media=inline#' + id), null);
  }
  for (const path of ['/archive/', '/#post', '/posts/example/', '/evidence/ct-scanner/']) {
    assert.equal(modalRequest(origin + path + '?media=modal#media-test'), null);
  }
  for (const suffix of ['?media=other#media-x', '?media=modal&media=modal#media-x', '?media=modal#ref-x',
    '?media=modal#media-%ZZ', '?media=modal#media-%00x', '?media=modal']) {
    assert.equal(modalRequest(origin + '/archive/example/' + suffix), null, suffix);
  }
});

test('dismissing current or legacy links keeps an explicit inline state and the exact media target', () => {
  const href = origin + '/archive/entrepreneur/?source=cv&media=modal#media-image/assets/evidence/entrepreneur/house.jpg';
  assert.equal(withoutModal(href), origin + '/archive/entrepreneur/?source=cv&media=inline#media-image/assets/evidence/entrepreneur/house.jpg');
  assert.equal(modalRequest(withoutModal(href)), null);
  const legacy = origin + '/archive/entrepreneur/#media-image/assets/evidence/entrepreneur/house.jpg';
  assert.equal(modalRequest(withoutModal(legacy)), null);
  assert.equal(new URL(withoutModal(legacy)).hash, new URL(legacy).hash);
  assert.equal(withoutModal(withoutModal(legacy)), withoutModal(legacy), 'closing is idempotent');
});

test('only generated media in its direct media pane can be enlarged', () => {
  const classes = (...values) => ({contains: value => values.includes(value)});
  const pane = {classList: classes('post-media')};
  const block = {parentElement: pane, classList: classes('evidence-image'), querySelectorAll: () => []};
  const target = {closest: () => block};
  const doc = {getElementById: id => id === 'media-image/good' ? target : null};
  assert.deepEqual(targetFor(doc, {id: 'media-image/good'}), {target, block});
  assert.equal(targetFor(doc, {id: 'media-image/missing'}), null);
  block.parentElement = {classList: classes('post-body')};
  assert.equal(targetFor(doc, {id: 'media-image/good'}), null, 'authored elements cannot impersonate generated media');
  block.parentElement = pane;
  block.classList = classes('evidence-pdf');block.querySelectorAll = () => [{}, {}, {}];
  assert.equal(targetFor(doc, {id: 'media-image/good'}), null, 'wait for manifest to enhance multi-page PDF');
  block.classList = classes('evidence-pdf', 'evidence-pdf-carousel');
  assert.deepEqual(targetFor(doc, {id: 'media-image/good'}), {target, block});
});

test('backdrop hit detection does not treat media or header clicks as dismissal', () => {
  const rect = {left: 20, right: 980, top: 30, bottom: 700};
  assert.equal(outsideDialog({clientX: 100, clientY: 50}, rect), false);
  assert.equal(outsideDialog({clientX: 20, clientY: 30}, rect), false);
  for (const [clientX, clientY] of [[19, 50], [981, 50], [100, 29], [100, 701]]) {
    assert.equal(outsideDialog({clientX, clientY}, rect), true);
  }
});

test('closing a page-three PDF returns focus to its current slide rather than inert page one', () => {
  const element = options => ({isConnected: true, disabled: false,
    closest: () => options?.inert ? {} : null,
    getClientRects: () => options?.hidden ? [] : [{}], ...options});
  const body = element(), pageOne = element({inert: true}), pageThree = element();
  const disabled = element({disabled: true}), next = element();
  const block = {querySelector: () => ({querySelectorAll: () => [pageThree]}),
    querySelectorAll: () => [pageOne, pageThree, disabled, next]};
  assert.equal(focusAfterClose(block, body, body), pageThree);
  assert.equal(focusAfterClose(block, pageOne, body), pageThree);
  const previous = element();
  assert.equal(focusAfterClose(block, previous, body), previous, 'preserve an existing visible focus target');
  pageThree.getClientRects = () => [];
  assert.equal(focusAfterClose(block, body, body), next, 'otherwise choose an enabled visible control');
});

test('a repeated archive media link reopens its existing target from the closed inline state', () => {
  const id = 'media-image/assets/evidence/entrepreneur/house.jpg';
  const legacy = origin + '/archive/entrepreneur/#' + id;
  const closed = withoutModal(legacy);
  const classes = (...values) => ({contains: value => values.includes(value)});
  const block = {parentElement: {classList: classes('post-media')}, classList: classes('evidence-image'),
    querySelectorAll: () => []};
  const target = {id, closest: () => block};
  const doc = {getElementById: value => value === id ? target : null};
  const link = {href: '#' + id, closest: () => null};
  const reopened = requestFromLink(doc, link, null, closed);
  assert.equal(reopened.id, id);
  assert.equal(modalRequest(reopened.href).id, id);
  assert.equal(new URL(reopened.href).searchParams.get('media'), 'modal');
  const imageLink = {href: origin + '/assets/evidence/entrepreneur/house.jpg', closest: () => null};
  assert.equal(requestFromLink(doc, imageLink, {imageTarget: () => target}, closed).href, reopened.href,
    'core media interception can be upgraded without following the raw file');
  assert.equal(requestFromLink(doc, {href: '#media-unknown', closest: () => null}, null, closed), null);
  assert.equal(requestFromLink(doc, {...link, closest: () => ({})}, null, closed), null,
    'links inside the viewer retain their original purpose');
  assert.equal(reopenURL(origin + '/posts/example/', id), null, 'post links are never upgraded');
});
