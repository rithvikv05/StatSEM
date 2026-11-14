import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

test('copula and quadratic nodes snap to alignment guides and grid only when enabled', () => {
  const source = readFileSync(new URL('../src/utils/model-canvas.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function snapEffectPosition(');
  const end = source.indexOf('  function drawLineGuide(', start);
  assert.ok(start >= 0 && end > start);
  const guides = [];
  const context = vm.createContext({ isSnapping: true, activeResults: {}, SNAP_THRESHOLD: 5, nodes: [{ id: 'a', x: 101, y: 61, isLatent: true }], gaussianCopulas: [], quadraticEffects: [], guidesLayer: { innerHTML: '' }, drawLineGuide: (...line) => guides.push(line), getGaussianCopulaGeometry: () => null, getQuadraticEffectGeometry: () => null });
  vm.runInContext(source.slice(start, end), context);
  const aligned = vm.runInContext('snapEffectPosition(102, 62, {}, 25.2)', context);
  assert.equal(aligned.x, 101); assert.equal(aligned.y, 61); assert.equal(guides.length, 2);
  context.nodes = [];
  const grid = vm.runInContext('snapEffectPosition(41, 79, {}, 19.8)', context);
  assert.equal(grid.x, 40); assert.equal(grid.y, 80);
  context.isSnapping = false;
  const free = vm.runInContext('snapEffectPosition(41, 79, {}, 25.2)', context);
  assert.equal(free.x, 41); assert.equal(free.y, 79);
});
