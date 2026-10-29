const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/evidence/demos/game-of-life-sender-receiver/demo.js'), 'utf8');
const glider = (x, y) => [[0, -1], [1, 0], [-1, 1], [0, 1], [1, 1]].map(([dx, dy]) => `${x + dx},${y + dy}`);
const alive = (state, key) => state.background !== state.cells.includes(key);

// Run the real demo and its registered UI handlers; only browser services are fake.
function demo({width = 864, height = 500, ratio = 1} = {}) {
  const frames = [], messages = [], buttons = [];
  function element() {
    const handlers = new Map(), attributes = new Map();
    return {
      dataset: {}, textContent: '', children: [],
      addEventListener(name, callback) {handlers.set(name, callback);},
      setAttribute(name, value) {attributes.set(name, String(value));},
      getAttribute(name) {return attributes.get(name);},
      append(child) {this.children.push(child);},
      click(event = {}) {handlers.get('click')?.(event);}
    };
  }
  const elements = Object.fromEntries(['world', 'reset', 'toggle-running', 'rule-code', 'birth-choices', 'survival-choices'].map(id => [id, element()]));
  const rectangle = {left: 37, top: 81, width, height};
  const context = Object.fromEntries(['setTransform', 'fillRect', 'save', 'translate', 'setLineDash', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'restore'].map(name => [name, () => {}]));
  elements.world.getContext = () => context;
  elements.world.getBoundingClientRect = () => rectangle;
  const sandbox = {
    document: {
      hidden: false,
      getElementById: id => elements[id],
      createElement() {const button = element();buttons.push(button);return button;},
      querySelectorAll: () => buttons,
      addEventListener() {}
    },
    devicePixelRatio: ratio,
    matchMedia: () => ({matches: false}),
    ResizeObserver: class {observe() {}},
    requestAnimationFrame: callback => {frames.push(callback);},
    performance: {now: () => 0},
    parent: {postMessage: message => messages.push(message)}
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  assert.ok(sandbox.LifeDemo, messages.map(message => message.message || message.type).join('; '));
  return {
    elements,
    snapshot: () => JSON.parse(JSON.stringify(sandbox.LifeDemo.snapshot())),
    frame(time) {assert.ok(frames.length, 'an animation frame is scheduled');frames.shift()(time);},
    clickCell(x, y) {
      const unit = Math.min((width - 18) / 72, (height - 18) / 56);
      elements.world.click({clientX: rectangle.left + (width - unit * 72) / 2 + (x + 0.5) * unit,
        clientY: rectangle.top + (height - unit * 56) / 2 + (y + 0.5) * unit});
    },
    clickMargin() {elements.world.click({clientX: rectangle.left + 1, clientY: rectangle.top + 1});},
    rule(kind, count) {buttons.find(button => button.dataset.rule === kind && button.dataset.neighbors === count).click();}
  };
}

for (const options of [{width: 864, height: 500, ratio: 1}, {width: 310, height: 360, ratio: 2}]) {
  test(`click stamps and removes a persistent glider at ${options.width}px / DPR ${options.ratio}`, () => {
    const app = demo(options), before = app.snapshot(), pattern = glider(12, 40);
    assert.ok(pattern.every(cell => !alive(before, cell)), 'the test region starts empty');
    app.clickCell(12, 40);
    const placed = app.snapshot();
    assert.equal(placed.running, false, 'editing pauses evolution');
    assert.equal(app.elements['toggle-running'].textContent, 'Resume');
    assert.deepEqual(placed.cells.filter(cell => !before.cells.includes(cell)).sort(), [...pattern].sort(), 'exactly the five glider cells are added');
    assert.ok(before.cells.every(cell => placed.cells.includes(cell)), 'unrelated live cells are preserved');
    app.frame(100);app.frame(350);app.frame(600);
    assert.deepEqual(app.snapshot(), placed, 'animation frames cannot erase the edited pattern while paused');
    app.clickCell(12, 40);
    assert.deepEqual(app.snapshot().cells.slice().sort(), before.cells.slice().sort(), 'clicking the complete pattern removes it');
    assert.equal(app.snapshot().running, false);
  });
}

test('edge clicks place a complete glider and canvas margins do nothing', () => {
  const app = demo(), before = app.snapshot();
  app.clickMargin();
  assert.deepEqual(app.snapshot(), before, 'a margin click changes neither cells nor playback');
  app.clickCell(0, 55);
  const placed = app.snapshot(), pattern = glider(1, 54);
  assert.ok(pattern.every(cell => alive(placed, cell)), 'the glider is moved inside the bottom-left edge');
  assert.deepEqual(placed.cells.filter(cell => !before.cells.includes(cell)).sort(), [...pattern].sort());
});

test('the stamped glider moves diagonally after four resumed Conway generations', () => {
  const app = demo(), initialGeneration = app.snapshot().generation;
  app.clickCell(12, 40);
  app.elements['toggle-running'].click();
  for (const time of [100, 140, 180, 220, 260]) app.frame(time);
  const state = app.snapshot();
  assert.equal(state.generation, initialGeneration + 4);
  const localCells = state.cells.filter(cell => {
    const [x, y] = cell.split(',').map(Number);
    return x >= 10 && x <= 16 && y >= 38 && y <= 44;
  });
  assert.deepEqual(localCells.sort(), glider(13, 41).sort(), 'the pattern retains its shape one cell down and right');
});

test('Resume advances the edited board; rule changes retain pause; Reset restores playback and rules', () => {
  const app = demo(), initial = app.snapshot();
  app.clickCell(12, 40);
  app.rule('birth', 0);
  assert.equal(app.snapshot().rule, 'B03/S23');
  assert.equal(app.snapshot().running, false, 'changing rules does not silently resume an edit');
  app.frame(100);app.frame(300);
  assert.equal(app.snapshot().generation, initial.generation);
  app.elements['toggle-running'].click();
  assert.equal(app.snapshot().running, true);
  assert.equal(app.elements['toggle-running'].textContent, 'Pause');
  app.frame(400);app.frame(440);
  assert.ok(app.snapshot().generation > initial.generation, 'Resume restarts evolution');
  app.elements['reset'].click();
  assert.deepEqual(app.snapshot(), initial, 'Reset restores the complete original sender/receiver state');
});

test('stamping uses actual cell states when B0 makes the infinite background alive', () => {
  const app = demo(), pattern = glider(12, 40);
  app.rule('birth', 0);
  app.frame(100);app.frame(140);
  const before = app.snapshot();
  assert.equal(before.background, true);
  assert.ok(pattern.every(cell => alive(before, cell)), 'the empty-region background is alive after B0');
  app.clickCell(12, 40);
  const erased = app.snapshot();
  assert.equal(erased.running, false);
  assert.ok(pattern.every(cell => !alive(erased, cell)), 'clicking a live glider footprint erases it against an alive background');
  assert.ok(pattern.every(cell => erased.cells.includes(cell)), 'dead cells are represented as background exceptions');
  app.clickCell(12, 40);
  assert.ok(pattern.every(cell => alive(app.snapshot(), cell)), 'the second click restores all five live cells');
  assert.deepEqual(app.snapshot().cells.slice().sort(), before.cells.slice().sort(), 'unrelated background exceptions stay unchanged');
});
