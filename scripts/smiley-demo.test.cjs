const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/evidence/demos/joy-checkpoint-5850-live/demo.js'), 'utf8');

for (const hasProgress of [false, true]) {
  test(`smiley initializes and reports failures with ${hasProgress ? 'current' : 'cached older'} markup`, () => {
    const messages = [], frames = new Map();
    let nextFrame = 0;
    const context = {
      createImageData: (width, height) => ({data: new Uint8ClampedArray(width * height * 4)}),
      putImageData() {}
    };
    const canvas = () => ({getContext: () => context, addEventListener() {}});
    const elements = {
      '[data-simulation]': canvas(), '[data-target]': canvas(),
      '[data-reset]': {addEventListener() {}},
      '[data-announcement]': {textContent: ''}, '[data-failure]': {hidden: true, textContent: ''},
      '[data-progress]': hasProgress ? {dataset: {}} : null
    };
    const root = {querySelector: selector => elements[selector]};
    const sandbox = {
      document: {getElementById: () => root, hidden: false, addEventListener() {}},
      parent: {postMessage: message => messages.push(message)},
      addEventListener() {},
      requestAnimationFrame: callback => {frames.set(++nextFrame, callback); return nextFrame;},
      cancelAnimationFrame: id => frames.delete(id),
      atob: value => Buffer.from(value, 'base64').toString('binary'),
      performance: {now: () => 0}, setTimeout, clearTimeout
    };
    sandbox.window = sandbox;
    vm.runInNewContext(source, sandbox);
    assert.ok(root.demo, 'the model initializes even without the optional progress element');
    assert.ok(messages.some(message => message.type === 'blog-demo-ready'));
    assert.equal(root.demo.running, true);

    root.demo.engine.step = () => {throw new Error('Test inference failure');};
    const callback = frames.values().next().value;
    assert.doesNotThrow(() => callback(100));
    assert.equal(root.demo.running, false);
    assert.ok(messages.some(message => message.type === 'blog-demo-error' && message.message === 'Test inference failure'),
      'error reporting still works if optional display markup is absent');
  });
}
