import test from 'node:test';
import assert from 'node:assert/strict';
import { makeResultIndicatorNames } from '../src/utils/result-indicator-names.js';

test('generated effect indicators use their construct names across measurement tables', () => {
  const results = { measurement: {
    outer_loadings: {
      'GC (QUALITY -> LOYALTY)': { gc_id_quality_id_loyalty: 1 },
      'QUALITY x QUALITY': { q_id_quality_id_loyalty: 1 },
      'VALUE x SATISFACTION': { int_id_satisfaction_id_value: 1 },
      QUALITY: { q_survey_question: 0.8 },
    },
    outer_weights: { 'VALUE x VALUE': { q_id_value_id_loyalty: 1 } },
  } };
  assert.deepEqual(makeResultIndicatorNames(results), {
    gc_id_quality_id_loyalty: 'GC (QUALITY -> LOYALTY) indicator',
    q_id_quality_id_loyalty: 'QUALITY x QUALITY indicator',
    int_id_satisfaction_id_value: 'VALUE x SATISFACTION indicator',
    q_id_value_id_loyalty: 'VALUE x VALUE indicator',
  });
});

test('uses resolved construct names without changing numerical lookup keys', () => {
  const results = { measurement: { outer_loadings: { generated: { q_internal_id: 1 } } }, latent_variables: [{ id: 'generated', is_quadratic: true }] };
  assert.deepEqual(makeResultIndicatorNames(results, id => id === 'generated' ? 'VALUE x VALUE' : id), { q_internal_id: 'VALUE x VALUE indicator' });
  assert.equal(results.measurement.outer_loadings.generated.q_internal_id, 1);
});
