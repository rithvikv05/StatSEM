import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDataGroupsLocal,
  getGroupRows,
  lookupMinSampleSize,
  validateDataGroupsLocal,
} from './groupUtils.ts';

test('lookupMinSampleSize matches Hair et al. (2014) Table 10.1 spot checks', () => {
  assert.equal(lookupMinSampleSize(2, '0.05', '0.25'), 52);
  assert.equal(lookupMinSampleSize(5, '0.05', '0.25'), 70);
  assert.equal(lookupMinSampleSize(10, '0.01', '0.10'), 256);
  assert.equal(lookupMinSampleSize(1, '0.10', '0.75'), 21); // clamped to 2 arrows
});

test('generateDataGroupsLocal supports categorical text, numeric .0 formatting, 2-column Cartesian & min pruning', () => {
  const cols = ['GENDER', 'TIER', 'SMALL_CAT'];
  const rows: any[][] = [];
  for (let i = 0; i < 40; i++) {
    rows.push([
      i < 20 ? 'Female' : 'Male',
      i % 2 === 0 ? 1 : 2,
      i < 3 ? 'Rare' : 'Common',
    ]);
  }

  // Single text column
  const textRes = generateDataGroupsLocal(cols, rows, 'GROUP', ['GENDER'], 10);
  assert.equal(textRes.totalCombinations, 2);
  assert.equal(textRes.prunedCount, 0);
  assert.deepEqual(
    textRes.groups.map((g) => g.name),
    ['GROUP_GENDER(Female)', 'GROUP_GENDER(Male)']
  );

  // Numeric categorical formatting -> .0 suffix
  const numRes = generateDataGroupsLocal(cols, rows, 'GROUP', ['TIER'], 10);
  assert.deepEqual(
    numRes.groups.map((g) => g.name),
    ['GROUP_TIER(1.0)', 'GROUP_TIER(2.0)']
  );

  // 2-column Cartesian product (2 x 2 = 4 groups, each n = 10)
  const cartRes = generateDataGroupsLocal(cols, rows, 'GROUP', ['GENDER', 'TIER'], 10);
  assert.equal(cartRes.totalCombinations, 4);
  assert.equal(cartRes.groups.length, 4);
  for (const g of cartRes.groups) {
    assert.equal(g.recordCount, 10);
    assert.equal(getGroupRows(cols, rows, g).indices.length, 10);
  }

  // Prune sparse cells below minimumCases = 10
  const pruneRes = generateDataGroupsLocal(cols, rows, 'GROUP', ['SMALL_CAT'], 10);
  assert.equal(pruneRes.totalCombinations, 2);
  assert.equal(pruneRes.prunedCount, 1);
  assert.equal(pruneRes.groups.length, 1);
  assert.equal(pruneRes.groups[0].name, 'GROUP_SMALL_CAT(Common)');
});

test('validateDataGroupsLocal emits sample-size and 50% size-imbalance warnings', () => {
  const groups = [
    { id: '1', name: 'Small', conditionLinkType: 'AND' as const, terms: [], recordCount: 20 },
    { id: '2', name: 'Large', conditionLinkType: 'AND' as const, terms: [], recordCount: 65 },
  ];
  const { minN, warnings } = validateDataGroupsLocal(groups, 2, '0.05', '0.25');
  assert.equal(minN, 52);
  assert.ok(warnings.some((w) => w.kind === 'min_sample_size'));
  assert.ok(warnings.some((w) => w.kind === 'comparable_size'));
});
