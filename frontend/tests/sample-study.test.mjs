import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('bundled sample preserves the built diagrams, datasets and result snapshot', async () => {
  const sample = JSON.parse(await readFile(new URL('../src/assets/service-experience.json', import.meta.url), 'utf8'));
  assert.equal(sample.datasets.length, 2);
  assert.equal(sample.models.length, 8);
  assert.equal(sample.snapshots.length, 1);
  const datasetIds = new Set(sample.datasets.map(dataset => dataset.id));
  for (const dataset of sample.datasets) {
    assert.equal(dataset.rows.length, 360);
    assert.ok(dataset.rows.every(row => row.length === dataset.columns.length));
    assert.equal(dataset.groups.length, 2);
  }
  for (const model of sample.models) {
    assert.ok(datasetIds.has(model.spec.dataset_id));
    assert.ok(model.layout.nodes.length > 0);
    assert.ok(model.layout.edges.length > 0);
  }
  assert.ok(sample.models.some(model => model.layout.moderatingEffects?.length));
  assert.ok(sample.models.some(model => model.layout.gaussianCopulas?.length));
  assert.ok(sample.models.some(model => model.layout.quadraticEffects?.length));
  const snapshot = sample.snapshots[0];
  assert.ok(sample.models.some(model => model.id === snapshot.sourceModelId));
  assert.ok(snapshot.results.structural);
  assert.ok(snapshot.layout.nodes.length > 0);
});
