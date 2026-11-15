import test from 'node:test';
import assert from 'node:assert/strict';
import { getCanvasFitTransform } from '../src/utils/fit-canvas.js';

test('fits the entire diagram and centers it in small and large canvases', () => {
  const bounds = { x: -150, y: 20, width: 1600, height: 900 };
  for (const [width, height] of [[320, 200], [700, 400], [1600, 1000]]) {
    const { x, y, k } = getCanvasFitTransform(bounds, width, height);
    assert.ok(x + bounds.x * k >= 0);
    assert.ok(y + bounds.y * k >= 0);
    assert.ok(x + (bounds.x + bounds.width) * k <= width);
    assert.ok(y + (bounds.y + bounds.height) * k <= height);
    assert.ok(Math.abs(x + (bounds.x + bounds.width / 2) * k - width / 2) < 1e-9);
  }
});

test('fits large diagrams below 20% and ignores unavailable canvas sizes', () => {
  assert.ok(getCanvasFitTransform({ x: 0, y: 0, width: 10000, height: 5000 }, 300, 200).k < 0.2);
  assert.equal(getCanvasFitTransform({ x: 0, y: 0, width: 100, height: 100 }, 0, 200), null);
});
