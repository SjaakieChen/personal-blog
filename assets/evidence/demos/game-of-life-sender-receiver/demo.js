(function (root) {
  'use strict';
  // Pattern data: LifeWiki, Gosper glider gun and Eater 1 (see README.md).
  const GUN_RLE = '24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4bobo$10bo5bo7bo$11bo3bo$12b2o!';
  const EATER_RLE = '2o$obo$2bo$2b2o!';
  const key = (x, y) => x + ',' + y;
  const point = value => value.split(',').map(Number);
  function parseRLE(rle, dx = 0, dy = 0) {
    const result = new Set();
    let x = 0, y = 0, digits = '';
    for (const token of rle.replace(/\s/g, '')) {
      if (/\d/.test(token)) { digits += token; continue; }
      const count = Number(digits || 1); digits = '';
      if (token === 'o') { for (let n = 0; n < count; n++) result.add(key(dx + x + n, dy + y)); x += count; }
      else if (token === 'b') x += count;
      else if (token === '$') { y += count; x = 0; }
      else if (token === '!') break;
      else throw new Error('Invalid pattern data.');
    }
    return result;
  }
  // Finite exceptions to a uniform infinite background. This also handles B0:
  // an empty background may become alive everywhere without an infinite array.
  function isAlive(world, x, y) {
    return world.background !== world.cells.has(key(x, y));
  }
  function evolve(world, birth = [3], survival = [2, 3]) {
    const neighbors = new Map();
    for (const cell of world.cells) {
      if (!neighbors.has(cell)) neighbors.set(cell, 0); // Isolated cells need S0.
      const [x, y] = point(cell);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const neighbor = key(x + dx, y + dy);
        neighbors.set(neighbor, (neighbors.get(neighbor) || 0) + 1);
      }
    }
    const background = world.background ? survival.includes(8) : birth.includes(0);
    const next = new Set();
    for (const [cell, count] of neighbors) {
      const alive = world.background !== world.cells.has(cell);
      const total = world.background ? 8 - count : count;
      const nextAlive = (alive ? survival : birth).includes(total);
      if (nextAlive !== background) next.add(cell);
    }
    return {cells: next, background};
  }
  function step(cells) {
    return evolve({cells, background: false}).cells;
  }
  const GUN = [6, 8], RECEIVER = [56, 44];
  function preset() {
    return new Set([...parseRLE(GUN_RLE, ...GUN), ...parseRLE(EATER_RLE, ...RECEIVER)]);
  }
  const core = {GUN_RLE, EATER_RLE, GUN, RECEIVER, key, point, parseRLE, step, evolve, isAlive, preset};
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else root.LifeDemoCore = core;
})(typeof window === 'undefined' ? globalThis : window);

if (typeof document !== 'undefined') (function () {
  'use strict';
  try {
    const L = window.LifeDemoCore;
    const $ = id => document.getElementById(id);
    const canvas = $('world'), context = canvas.getContext('2d', {alpha: false});
    if (!context) throw new Error('This browser could not start the drawing canvas.');
    const columns = 72, rows = 56;
    const receiver = L.parseRLE(L.EATER_RLE, ...L.RECEIVER);
    const startGeneration = 90;
    const startingCells = () => { let state = L.preset(); for (let n = 0; n < startGeneration; n++) state = L.step(state); return state; };
    let cells = startingCells(), background = false, generation = startGeneration, received = 0, disturbed = false;
    let birth = [3], survival = [2, 3];
    let running = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    let originalSetup = true, lastTime = 0, accumulator = 0;
    let geometry = {unit: 1, left: 0, top: 0, width: 1, height: 1};
    const signature = set => [...set].sort().join(';');
    const receiverSignature = signature(receiver);
    function receiverRegion() {
      return new Set([...cells].filter(cell => {
        const [x, y] = L.point(cell);
        return x >= 54 && x <= 61 && y >= 42 && y <= 49;
      }));
    }
    function update() {
      ({cells, background} = L.evolve({cells, background}, birth, survival)); generation++;
      if (originalSetup) {
        const recovered = signature(receiverRegion()) === receiverSignature;
        if (!recovered) disturbed = true;
        else if (disturbed) { received++; disturbed = false; }
      }
    }
    function resize() {
      const rectangle = canvas.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rectangle.width * ratio));
      canvas.height = Math.max(1, Math.round(rectangle.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const unit = Math.min((rectangle.width - 18) / columns, (rectangle.height - 18) / rows);
      geometry = {unit, left: (rectangle.width - unit * columns) / 2,
        top: (rectangle.height - unit * rows) / 2, width: rectangle.width, height: rectangle.height};
      draw();
    }
    function draw() {
      const {unit, left, top, width, height} = geometry;
      context.fillStyle = '#fbfaf6'; context.fillRect(0, 0, width, height);
      context.save(); context.translate(left, top);
      if (originalSetup) {
        context.fillStyle = '#eaf0e9'; context.fillRect(4 * unit, 6 * unit, 39 * unit, 14 * unit);
        context.fillStyle = '#e7f1e9'; context.fillRect(54 * unit, 42 * unit, 8 * unit, 8 * unit);
        context.setLineDash([3, 5]); context.strokeStyle = '#d6c7a9'; context.lineWidth = 1;
        context.beginPath(); context.moveTo(33 * unit, 21 * unit); context.lineTo(54 * unit, 42 * unit); context.stroke();
        context.setLineDash([]);
      }
      if (unit >= 4) {
        context.strokeStyle = '#e8e6de'; context.lineWidth = 0.5; context.beginPath();
        for (let x = 0; x <= columns; x++) { context.moveTo(x * unit, 0); context.lineTo(x * unit, rows * unit); }
        for (let y = 0; y <= rows; y++) { context.moveTo(0, y * unit); context.lineTo(columns * unit, y * unit); }
        context.stroke();
      }
      const inset = unit >= 4 ? 0.5 : 0;
      context.fillStyle = '#315c49';
      for (let index = 0; index < columns * rows; index++) {
        const x = index % columns, y = Math.floor(index / columns);
        if (!L.isAlive({cells, background}, x, y)) continue;
        context.fillRect(x * unit + inset, y * unit + inset, unit - inset * 2, unit - inset * 2);
      }
      context.restore();
    }
    const ruleName = () => 'B' + birth.join('') + '/S' + survival.join('');
    function showRules() {
      $('rule-code').textContent = ruleName();
      for (const button of document.querySelectorAll('[data-rule]')) {
        const selected = (button.dataset.rule === 'birth' ? birth : survival).includes(Number(button.dataset.neighbors));
        button.setAttribute('aria-pressed', String(selected));
      }
      canvas.setAttribute('aria-label', originalSetup
        ? 'Animated Game of Life: a glider gun sends gliders into an eater.'
        : 'Animated cellular automaton using rule ' + ruleName() + '. Reset restores the Conway sender and receiver.');
    }
    for (const kind of ['birth', 'survival']) for (let count = 0; count <= 8; count++) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'rule-choice'; button.textContent = count;
      button.dataset.rule = kind; button.dataset.neighbors = count;
      button.setAttribute('aria-label', (kind === 'birth' ? 'Birth' : 'Survival') + ' with ' + count + ' live neighbours');
      button.addEventListener('click', () => {
        const selected = kind === 'birth' ? birth : survival;
        const next = selected.includes(count) ? selected.filter(value => value !== count) : [...selected, count].sort((a, b) => a - b);
        if (kind === 'birth') birth = next; else survival = next;
        originalSetup = false; received = 0; disturbed = false;
        running = true; accumulator = 0; lastTime = 0; showRules(); draw();
      });
      $(kind + '-choices').append(button);
    }
    $('reset').addEventListener('click', () => {
      cells = startingCells(); background = false; generation = startGeneration; received = 0; disturbed = false; originalSetup = true;
      birth = [3]; survival = [2, 3];
      running = true; accumulator = 0; lastTime = 0; showRules(); draw();
    });
    canvas.addEventListener('click', event => {
      const rectangle = canvas.getBoundingClientRect();
      const {unit, left, top} = geometry;
      const x = Math.floor((event.clientX - rectangle.left - left) / unit);
      const y = Math.floor((event.clientY - rectangle.top - top) / unit);
      if (x < 0 || x >= columns || y < 0 || y >= rows) return;
      const cell = L.key(x, y);
      if (cells.has(cell)) cells.delete(cell); else cells.add(cell);
      originalSetup = false; received = 0; disturbed = false;
      showRules(); draw();
    });
    document.addEventListener('visibilitychange', () => { lastTime = 0; accumulator = 0; });
    function frame(time) {
      if (running && !document.hidden) {
        if (lastTime) accumulator += Math.min(time - lastTime, 250);
        const interval = 1000 / 30;
        const began = performance.now(); let steps = 0;
        while (accumulator >= interval && steps < 4 && performance.now() - began < 12) { update(); accumulator -= interval; steps++; }
        if (accumulator >= interval) accumulator = interval;
        if (steps) draw();
      }
      lastTime = time; requestAnimationFrame(frame);
    }
    new ResizeObserver(resize).observe(canvas);
    window.LifeDemo = {snapshot: () => ({generation, population: background ? null : cells.size, background, received, running, originalSetup, rule: ruleName(), birth: [...birth], survival: [...survival], cells: [...cells]})};
    showRules(); resize(); requestAnimationFrame(frame);
    parent.postMessage({type: 'blog-demo-ready', caption: 'Interactive demo (Game of life but with different rules)'}, '*');
  } catch (error) {
    parent.postMessage({type: 'blog-demo-error', message: error.message || 'Simulation initialization failed.'}, '*');
  }
})();
