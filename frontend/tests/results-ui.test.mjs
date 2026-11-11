import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let components;
before(async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.window = { fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  components = Object.assign({}, ...await Promise.all([
    'ResultsNavigation', 'CalculationMenu', 'ModelFitResults', 'SpecificIndirectResults', 'RunDetails', 'ModerationDetails', 'AdvancedResultPanels',
  ].map(name => server.ssrLoadModule(`/src/components/${name}.tsx`))));
  Object.assign(components, await server.ssrLoadModule('/src/utils/result-search.ts'));
  Object.assign(components, await server.ssrLoadModule('/src/utils/window-drag.ts'));
  Object.assign(components, await server.ssrLoadModule('/src/utils/diagram-export.ts'));
});
after(async () => { await server?.close(); });

const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test('diagram export resolves theme styles, removes canvas backgrounds and hides indicators', () => {
  class FakeElement {
    constructor(tagName, attrs = {}, computed = {}, children = []) {
      this.tagName = tagName; this.attrs = { ...attrs }; this.computed = computed; this.children = children;
      this.style = { values: {}, setProperty: (key, value) => { this.style.values[key] = value; } };
      for (const child of children) child.parent = this;
    }
    cloneNode() { return new FakeElement(this.tagName, this.attrs, this.computed, this.children.map(child => child.cloneNode(true))); }
    setAttribute(key, value) { this.attrs[key] = value; }
    get firstChild() { return this.children[0] || null; }
    appendChild(child) { child.parent = this; this.children.push(child); }
    insertBefore(child, before) { child.parent = this; const i = this.children.indexOf(before); this.children.splice(i < 0 ? this.children.length : i, 0, child); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    matches(selector) {
      return selector.split(',').some(part => { const p = part.trim(); return p === '*' || (p.startsWith('#') && this.attrs.id === p.slice(1)) || (p === '[data-export-indicator="true"]' && this.attrs['data-export-indicator'] === 'true'); });
    }
    closest(selector) { for (let node = this; node; node = node.parent) if (node.matches(selector) || (selector === 'marker' && node.tagName === 'marker')) return node; return null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const source = new FakeElement('svg', {}, {}, [
    new FakeElement('rect', { id: 'bg-color-rect' }, { fill: 'rgb(0, 0, 0)' }),
    new FakeElement('rect', { id: 'bg-rect' }, { fill: 'rgb(0, 0, 0)' }),
    new FakeElement('g', { id: 'zoom-layer' }, {}, [
      new FakeElement('g', { id: 'edges-layer' }, {}, [new FakeElement('path', { id: 'edge' }, { stroke: 'rgb(255, 255, 255)', fill: 'none' })]),
      new FakeElement('g', { id: 'node' }, { fill: 'rgb(20, 30, 40)' }, [new FakeElement('circle', { id: 'shape' }, { fill: 'rgb(20, 30, 40)', stroke: 'rgb(90, 20, 30)' })]),
      new FakeElement('g', { id: 'indicator', 'data-export-indicator': 'true' }),
    ]),
  ]);
  const originalDocument = globalThis.document;
  const originalComputedStyle = globalThis.window.getComputedStyle;
  globalThis.document = { createElementNS: (_ns, tag) => new FakeElement(tag) };
  globalThis.window.getComputedStyle = element => ({ getPropertyValue: property => element.computed[property] || '' });
  try {
    const result = components.prepareDiagramSvg(source, { width: 800, height: 600, appearance: 'color', background: 'white', includeIndicators: false });
    assert.equal(result.querySelector('#bg-color-rect'), null);
    assert.equal(result.querySelector('#bg-rect'), null);
    assert.equal(result.querySelector('#indicator'), null);
    assert.equal(result.querySelector('#node').style.values.fill, 'rgb(20, 30, 40)');
    assert.equal(result.querySelector('#edge').style.values.stroke, '#1f2937');
    assert.ok(result.children.some(child => child.tagName === 'rect' && child.attrs.fill === '#ffffff'));
    assert.ok(source.querySelector('#indicator'));
    const transparent = components.prepareDiagramSvg(source, { width: 800, height: 600, appearance: 'monochrome', background: 'transparent', includeIndicators: true });
    assert.ok(transparent.querySelector('#indicator'));
    assert.equal(transparent.querySelector('#edge').style.values.stroke, '#000000');
    assert.equal(transparent.querySelector('#shape').style.values.fill, '#ffffff');
    assert.equal(transparent.querySelector('#shape').style.values.stroke, '#000000');
    assert.ok(!transparent.children.some(child => child.tagName === 'rect' && child.attrs.fill === '#ffffff'));
  } finally { globalThis.document = originalDocument; globalThis.window.getComputedStyle = originalComputedStyle; }
});

test('window dragging is limited to explicitly marked background elements', () => {
  const originalElement = globalThis.Element;
  globalThis.Element = class { constructor(marked) { this.marked = marked; } hasAttribute(name) { return name === 'data-window-drag-surface' && this.marked; } };
  try {
    assert.equal(components.isWindowDragBackground(new globalThis.Element(true)), true);
    assert.equal(components.isWindowDragBackground(new globalThis.Element(false)), false);
    assert.equal(components.isWindowDragBackground(null), false);
  } finally { globalThis.Element = originalElement; }
});

test('results navigation keeps core output and leaves advanced analyses out of the sidebar', () => {
  const html = render(components.ResultsNavigation, { activeTab: 'path_coefficients', onSelect() {}, hasRunDetails: true, hasSpecificIndirect: true });
  assert.match(html, /Direct paths/);
  assert.match(html, /Individual indirect paths/);
  assert.match(html, /Run details/);
  assert.doesNotMatch(html, /Advanced Analyses|FIMIX|Gaussian Copula/);
  assert.match(html, /aria-current="page"/);
  const simple = render(components.ResultsNavigation, { activeTab: 'path_coefficients', onSelect() {} });
  assert.doesNotMatch(simple, /Individual indirect paths|Run details/);
});

test('result and calculation search matches labels and identifiers without case sensitivity', () => {
  assert.equal(components.matchesResultSearch('  BOOTSTRAP ', 'Bootstrap inference', 'bootstrap significance'), true);
  assert.equal(components.matchesResultSearch('confidence', 'Model fit', 'SRMR'), false);
  assert.equal(components.matchesResultSearch('', 'Model fit'), true);
});

test('calculation menu contains only the requested supported analyses', () => {
  const html = render(components.CalculationMenu, { onSelect() {} });
  assert.doesNotMatch(html, /<details|Search calculations|disabled/);
  for (const label of ['PLS-SEM', 'Bootstrap inference', 'Consistent PLS-SEM', 'Prediction and CVPAT', 'IPMA', 'tetrad', 'Multigroup', 'FIMIX', 'segmentation']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /Blindfolding|Mediation|Measurement invariance|Omnibus|endogeneity|Sample size|redundancy|Model fit/);
});

test('model fit reads the native backend’s nested saturated and estimated values', () => {
  const html = render(components.ModelFitResults, { results: { fit: {
    saturated_model: { srmr: 0.045, d_uls: 0.12 },
    estimated_model: { srmr: 0.067, d_uls: 0.34 }, gof: { gof: 0.41 },
  } } });
  for (const value of ['0.0450', '0.0670', '0.1200', '0.3400', '0.4100']) assert.ok(html.includes(value), value);
});

test('indirect-path inference is combined only with the matching estimate', () => {
  const base = { effects_decomposition: { specific_indirect: [{ path: 'A -> M -> B', path_nodes: ['A', 'M', 'B'], effect: 0.2 }] } };
  const mediation = { specific_indirect_effects: [{ path: 'A -> M -> B', original_effect: 0.2, p_value: 0.03 }] };
  const matching = render(components.SpecificIndirectResults, { results: base, mediation });
  assert.match(matching, /0\.0300/);
  assert.doesNotMatch(matching, /Mediation run/);
  const changed = render(components.SpecificIndirectResults, { results: base, mediation: {
    specific_indirect_effects: [{ path: 'A -> M -> B', original_effect: 0.3, p_value: 0.02 }],
  } });
  assert.match(changed, /Mediation run/);
  assert.match(changed, /0\.2000/);
  assert.match(changed, /0\.3000/);
  const stale = render(components.SpecificIndirectResults, { results: base, mediation, mediationStale: true });
  assert.match(stale, /previous version/);
  assert.match(stale, /Mediation run/);
  const legacy = render(components.SpecificIndirectResults, { results: {
    effects_decomposition: { specific_indirect: [] },
    structural: { specific_indirect: [{ path: 'A -> M -> B', effect: 0.4 }] },
  } });
  assert.match(legacy, /0\.4000/);
});

test('IPMA displays the engine’s quadrant instead of applying unrelated fixed cutoffs', () => {
  const html = render(components.AdvancedResultPanels, { activeTab: 'ipma', results: {}, analysisResults: { ipma: {
    target_construct: 'B', constructs: [{ construct_id: 'A', construct_name: 'Alpha', importance: 0.1, performance: 50, quadrant: 'keep_up_good_work' }],
  } } });
  assert.match(html, /Alpha/);
  assert.match(html, /Keep up the good work/);
  assert.doesNotMatch(html, /Low priority/);
});

test('prediction output uses the native metrics and never defaults to high power', () => {
  const html = render(components.AdvancedResultPanels, { activeTab: 'predict', results: {}, analysisResults: { predict: {
    overall_predictive_power: 'low',
    indicator_metrics: [{ indicator: 'Q1', rmse_pls: 0.9, rmse_lm: 0.7, q2_predict: -0.1, pls_beats_lm: false }],
  } } });
  assert.match(html, /Q1/);
  assert.match(html, /0\.9000/);
  assert.match(html, /No \(LM better\)/);
  assert.doesNotMatch(html, /High Predictive Power|majority of indicators/);
});

test('prediction results show paired CVPAT losses and significance', () => {
  const html = render(components.AdvancedResultPanels, { activeTab: 'predict', results: {}, analysisResults: { predict: {
    indicator_metrics: [], cvpat: { overall: { versus_indicator_mean: { mean_pls_loss: 1.1, mean_benchmark_loss: 1.4, mean_difference: -0.3, p_one_sided: 0.04 }, versus_linear_model: { mean_pls_loss: 1.1, mean_benchmark_loss: 1.2, mean_difference: -0.1, p_one_sided: 0.2 } }, constructs: [] },
  } } });
  for (const value of ['Predictive ability test', 'Indicator mean', 'Linear model', '-0.3000', '0.0400']) assert.ok(html.includes(value), value);
});

test('group comparisons show the backend estimates and test p-values', () => {
  const html = render(components.AdvancedResultPanels, { activeTab: 'mga', results: {}, analysisResults: { mga: {
    is_consistent: true, group_1: 'A', group_2: 'B', n_group_1: 20, n_group_2: 25,
    path_comparisons: [{ path: 'X → Y', beta_group_1: 0.42, beta_group_2: 0.21, difference: 0.21,
      henseler_pls_mga: { p_value_two_tailed: 0.03 }, permutation_test: { p_value: 0.04 }, welch_test: { p_value: 0.07 } }],
  } } });
  for (const value of ['Consistent group comparison', '20 observations', '25 observations', '0.4200', '0.2100', '0.0300', '0.0400', '0.0700']) assert.ok(html.includes(value), value);
});

test('principal component results show variance and indicator loadings', () => {
  const html = render(components.AdvancedResultPanels, { activeTab: 'pca', results: {}, analysisResults: { pca: {
    constructs: [{ id: 'A', name: 'Alpha', n_samples: 24, components: [{ component: 1, eigenvalue: 1.8, variance_explained: 0.9, cumulative_variance: 0.9, loadings: [{ indicator: 'x', loading: 0.95 }] }] }],
  } } });
  for (const value of ['Alpha', '24 observations', '1.8000', '90.0000%', '0.9500']) assert.ok(html.includes(value), value);
});

test('run details and moderation do not invent missing significance values', () => {
  const run = render(components.RunDetails, { results: { converged: true, iterations: 12, stop_criterion_history: [0.0000001] } });
  assert.match(run, /Converged/);
  assert.match(run, /1\.000e-7/);
  const moderation = render(components.ModerationDetails, { results: {}, data: { moderating_effects: [{
    source: 'A', target: 'B', moderator: 'M', simple_slopes: [{ moderator_level: 'Low', slope: 0.25, p_value: null }],
  }] } });
  assert.match(moderation, /0\.2500/);
  assert.match(moderation, /—/);
  assert.doesNotMatch(moderation, /&lt; 0\.0001/);
  const inferred = render(components.ModerationDetails, {
    results: { significance: { parameter_summary: { 'simple_slope:A x M->B:-1': { p_value: 0.02 } } } },
    data: { moderating_effects: [{ source: 'A', target: 'B', moderator: 'M', interaction_term: 'A x M',
      simple_slopes: [{ moderator_level: '-1 SD (Low)', slope: 0.25 }] }] },
  });
  assert.match(inferred, /0\.0200/);
});
