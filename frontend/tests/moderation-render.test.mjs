import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

test('moderation rendering completes with and without chained effects', () => {
  const source = readFileSync(new URL('../src/utils/model-canvas.js', import.meta.url), 'utf8');
  const start = source.indexOf('    const pathModMap = new Map();');
  const end = source.indexOf('    // Render all moderation path coefficient badges', start);
  assert.ok(start >= 0 && end > start, 'moderation rendering block exists');
  const block = source.slice(start, end);
  const createElement = () => ({ style: {}, classList: { add() {} }, setAttribute() {}, removeAttribute() {}, addEventListener() {} });
  for (const moderatingEffects of [
    [{ id: 'm1', source: 'a', target: 'b' }],
    [{ id: 'm1', source: 'a', target: 'b' }, { id: 'm2', source: 'a', target: 'b', attachToModId: 'm1' }],
  ]) {
    const appended = [];
    const context = { mode: 'select', moderatingEffects, selectedIds: new Set(), document: { documentElement: { getAttribute: () => 'light' }, createElementNS: createElement }, edgesLayer: { appendChild: element => appended.push(element) }, getModerationLineGeometry: () => ({ startX: 0, startY: 0, landX: 10, landY: 10, midX: 5, midY: 5, path: 'M 0 0 L 10 10' }), getOrCreateMarker: () => 'marker', getModerationDetails: () => null };
    assert.doesNotThrow(() => vm.runInNewContext(`{ ${block} }`, context));
    assert.ok(appended.length >= 3 * moderatingEffects.length);
    appended.length = 0;
    context.mode = 'copula';
    assert.doesNotThrow(() => vm.runInNewContext(`{ ${block} }`, context));
    assert.ok(appended.every(element => element.style.pointerEvents === 'none'));
  }
});
