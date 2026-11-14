import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

test('quadratic curve follows a freely moved midpoint while its endpoints remain attached', () => {
  const source = readFileSync(new URL('../src/utils/model-canvas.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function getQuadraticEffectGeometry(qe) {');
  const end = source.indexOf('  function getQuadraticEffectDetails(qe) {', start);
  assert.ok(start >= 0 && end > start);
  const qe = { id: 'q', predictor: 'a', target: 'b', curved: true, waypoints: [{ x: 900, y: 900 }] };
  const context = { qe, nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 0 }], edges: [{ sourceId: 'a', targetId: 'b' }], moderatingEffects: [], gaussianCopulas: [], quadraticEffects: [qe], NODE_R: 36, getEdgeCoordinates: () => ({ x1: 36, y1: 0, x2: 264, y2: 0 }), getEdgePolylineMidpoint: () => ({ x: 150, y: 0 }) };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const before = vm.runInContext('getQuadraticEffectGeometry(qe)', context);
  assert.equal(before.isCurved, true);
  assert.equal(before.waypoints.length, 0);
  const desired = { x: before.handleX + 25, y: before.handleY - 30 };
  qe.curveOffsetX = 2 * (desired.x - (before.arcStartX + before.landX) / 2);
  qe.curveOffsetY = 2 * (desired.y - (before.arcStartY + before.landY) / 2);
  const after = vm.runInContext('getQuadraticEffectGeometry(qe)', context);
  assert.ok(Math.abs(after.handleX - desired.x) < 1e-9);
  assert.ok(Math.abs(after.handleY - desired.y) < 1e-9);
  assert.equal(after.landX, before.landX);
  assert.equal(after.landY, before.landY);
});

test('quadratic result with a curved editor effect renders its coefficient badge', () => {
  const source = readFileSync(new URL('../src/utils/model-canvas.js', import.meta.url), 'utf8');
  const start = source.indexOf('    const quadBadgesToRender = [];');
  const end = source.indexOf('    // Render Quadratic badges on top', start);
  assert.ok(start >= 0 && end > start);
  const elements = [];
  const createElement = tag => { const element = { tag, style: {}, classList: { add() {} }, setAttribute() {}, removeAttribute() {}, addEventListener() {}, appendChild() {} }; elements.push(element); return element; };
  const context = {
    quadraticEffects: [{ id: 'q', curved: true }], activeResults: {}, selectedIds: new Set(), mode: 'select',
    document: { documentElement: { getAttribute: () => 'light' }, createElementNS: (_ns, tag) => createElement(tag) },
    edgesLayer: { appendChild() {} }, getOrCreateMarker: () => 'marker',
    getQuadraticEffectGeometry: () => ({ pNode: { label: 'Quality' }, tNode: { label: 'Loyalty' }, nodeX: 0, nodeY: 0, qeRadius: 20, startX: 0, startY: 0, landX: 100, landY: 20, isCurved: true, waypoints: [] }),
    getQuadraticEffectDetails: () => ({ beta: 0.25 }),
  };
  const output = vm.runInNewContext(`(() => { ${source.slice(start, end)} return quadBadgesToRender; })()`, context);
  assert.equal(output.length, 1);
  assert.equal(output[0].badgeX, 35);
  assert.equal(output[0].badgeY, 7);
  assert.ok(elements.some(element => element.tag === 'text' && element.textContent === 'QE'));
  assert.ok(!elements.some(element => element.textContent === 'Quality x'));
});

test('quadratic result badge uses the normal theme text color', () => {
  const source = readFileSync(new URL('../src/utils/model-canvas.js', import.meta.url), 'utf8');
  const start = source.indexOf('    // Render Quadratic badges on top');
  const end = source.indexOf('    // Nodes', start);
  assert.ok(start >= 0 && end > start);
  const elements = [];
  const createElement = tag => { const e = { tag, style: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, appendChild() {}, addEventListener() {} }; elements.push(e); return e; };
  const context = { quadBadgesToRender: [{ qe: {}, qeDetails: { beta: 0.25, term: 'x²', target: 'y' }, badgeX: 0, badgeY: 0, isSelected: false, handleQeClick() {}, hitPath: { appendChild() {} } }], document: { createElementNS: (_ns, tag) => createElement(tag) }, edgesLayer: { appendChild() {} }, formatCanvasNumber: n => String(n) };
  vm.runInNewContext(source.slice(start, end), context);
  const text = elements.find(e => e.tag === 'text');
  assert.equal(text.style.fill, 'var(--canvas-badge-text)');
});
