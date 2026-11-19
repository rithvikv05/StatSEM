import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let components;
before(async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.window = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, atob: globalThis.atob, btoa: globalThis.btoa };
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  components = Object.assign({}, ...await Promise.all([
    'ResultsNavigation', 'CalculationMenu', 'ModelFitResults', 'SpecificIndirectResults', 'RunDetails', 'ModerationDetails', 'AdvancedResultPanels', 'InlineAnalysisResults', 'StandaloneAnalysisResults', 'BootstrapInference', 'CollinearityResults',
  ].map(name => server.ssrLoadModule(`/src/components/${name}.tsx`))));
  Object.assign(components, await server.ssrLoadModule('/src/utils/result-search.ts'));
  Object.assign(components, await server.ssrLoadModule('/src/utils/window-drag.ts'));
  Object.assign(components, await server.ssrLoadModule('/src/utils/diagram-export.ts'));
  Object.assign(components, await server.ssrLoadModule('/src/utils/reportGenerator.ts'));
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
  assert.match(html, /Path coefficients/);
  assert.match(html, /Specific indirect effects/);
  assert.match(html, /Run details/);
  assert.doesNotMatch(html, /Advanced Analyses|FIMIX|Gaussian Copula/);
  assert.match(html, /aria-current="page"/);
  const simple = render(components.ResultsNavigation, { activeTab: 'path_coefficients', onSelect() {} });
  assert.doesNotMatch(simple, /Specific indirect effects|Run details/);
});

test('calculation navigation only shows sections belonging to the selected result', () => {
  const saved = ['pls', '_saved_bootstrap', '_saved_mga', '_saved_permutation', 'cta', 'ipma', 'predict', 'pca'];
  for (const id of ['cta', 'ipma', 'predict', 'pca']) {
    const html = render(components.ResultsNavigation, { activeTab: `analysis_${id}`, activeCalculation: id, savedCalculations: saved, analysisOnly: true, onSelect() {} });
    assert.doesNotMatch(html, /Model checks|Outer loadings|Bootstrap inference|MICOM/);
    assert.match(html, /Select saved calculation/);
  }
  const normal = render(components.ResultsNavigation, { activeTab: 'path_coefficients', onSelect() {}, hasBootstrap: false });
  assert.doesNotMatch(normal, /Bootstrap inference/);
  const bootstrap = render(components.ResultsNavigation, { activeTab: 'path_coefficients', onSelect() {}, hasBootstrap: true });
  assert.match(bootstrap, /Bootstrap inference/);
  const permutation = render(components.ResultsNavigation, { activeTab: 'path_coefficients__permutation_test', onSelect() {}, isMga: true, hasMicom: true, mgaAvailable: ['path_coefficients'] });
  assert.match(permutation, /Permutation test/);
  assert.doesNotMatch(permutation, /Total effects|Outer loadings|Bootstrap MGA|Confidence intervals/);
});

test('run details use the same separated navigation for standard and MGA results', () => {
  for (const props of [{}, { isMga: true, hasMicom: true, mgaAvailable: ['path_coefficients'] }]) {
    const html = render(components.ResultsNavigation, { activeTab: 'run_details', onSelect() {}, hasRunDetails: true, ...props });
    assert.match(html, /class="results-run-details-nav"/);
    assert.match(html, /aria-current="page"[^>]*>Run details/);
  }
});

test('bootstrap navigation and separate tables are available in live and snapshot results', () => {
  for (const snapshot of [false, true]) {
    const html = render(components.ResultsNavigation, { activeTab: 'bootstrap_paths', onSelect() {}, hasBootstrap: true, snapshot });
    assert.match(html, /Bootstrap inference/);
    assert.match(html, /Structural paths/);
    assert.match(html, /Outer loadings/);
  }
  const results = { significance: {
    paths: [{ from: 'A', to: 'B', original: 0.5, p_value: 0.000002, ci_low: 0.2, ci_high: 0.7 }],
    loadings: [{ construct: 'A', indicator: 'a1', original: 0.8, p_value: 0.02, ci_low: 0.6, ci_high: 0.9 }],
  } };
  const props = { results, constructName: id => id, indicatorName: id => id };
  const paths = render(components.BootstrapInference, { ...props, section: 'paths' });
  const loadings = render(components.BootstrapInference, { ...props, section: 'loadings' });
  assert.match(paths, /A → B/);
  assert.doesNotMatch(paths, /a1|<th>Significance/);
  assert.match(loadings, /a1/);
  assert.doesNotMatch(loadings, /A → B|<th>Significance/);
  for (const html of [paths, loadings]) assert.match(html, /sig-legend-minimal/);
  const sections = components.compileReportData({ modelName: 'Model', plsResults: results }).sections;
  assert.ok(sections.some(section => section.title === 'Bootstrapping: Path Coefficients'));
  assert.ok(sections.some(section => section.title === 'Bootstrapping: Outer Loadings'));
});

test('standalone analysis output displays native results without nested disclosure tables', () => {
  const data = {
    predict: { indicator_metrics: [{ indicator: 'x1', rmse_pls: 0.5, rmse_lm: 0.7 }], cvpat: { overall: { versus_linear_model: { mean_difference: -0.2, p_one_sided: 0.02 } } } },
    cta: { constructs: [{ construct_name: 'Quality', tetrads: [{ tetrad_name: 'T1', original_value: 0.3, p_value: 0.02 }] }, { construct_name: 'Value', applicable: false, na_reason: 'Four indicators required' }] },
    ipma: { constructs: [{ construct_name: 'Quality', importance: 0.2, performance: 50 }], indicators: [{ indicator: 'x1', construct_id: 'Quality' }] },
    pca: { constructs: [{ name: 'Quality', components: [{ component: 1, eigenvalue: 2, variance_explained: 0.5, cumulative_variance: 0.5, loadings: [{ indicator: 'x1', loading: 0.8 }] }] }] },
  };
  for (const [id, input] of Object.entries(data)) {
    const html = render(components.StandaloneAnalysisResults, { id, data: input });
    assert.match(html, /scientific-table/);
    assert.doesNotMatch(html, /<details|inline-analysis/);
  }
  assert.match(render(components.StandaloneAnalysisResults, { id: 'cta', data: data.cta }), /Four indicators required/);
  assert.match(render(components.StandaloneAnalysisResults, { id: 'predict', data: data.predict }), /Predictive ability comparison/);
  for (const [id, input] of Object.entries(data)) {
    const labels = components.standaloneAnalysisSections(id, input);
    const nav = render(components.ResultsNavigation, { activeTab: `analysis_${id}::0`, activeCalculation: id, analysisOnly: true, analysisTitle: id, analysisSections: labels, onSelect() {} });
    for (const label of labels) assert.ok(nav.includes(label), label);
    for (let index = 0; index < labels.length; index++) {
      const html = render(components.StandaloneAnalysisResults, { id, data: input, section: index });
      assert.ok((html.match(/<table/g) || []).length <= 1);
    }
  }
});

test('model check and moderation tables have separate navigation and data', () => {
  const html = render(components.ResultsNavigation, { activeTab: 'collinearity_outer', onSelect() {}, hasModeration: true, moderationSections: [{ id: 'moderation::0', label: 'A to B' }, { id: 'moderation::indirect', label: 'Conditional indirect effects' }] });
  for (const label of ['HTMT', 'Fornell-Larcker', 'Inner model', 'Outer model', 'Conditional indirect effects']) assert.ok(html.includes(label), label);
  const results = { structural: { inner_vif: { B: { A: 1.2 } } }, measurement: { outer_vif: { A: { x1: 1.8 } } } };
  const props = { results, constructName: id => id, indicatorName: id => id };
  const inner = render(components.CollinearityResults, { ...props, section: 'inner' });
  const outer = render(components.CollinearityResults, { ...props, section: 'outer' });
  assert.match(inner, /1\.2000/);
  assert.doesNotMatch(inner, /x1/);
  assert.match(outer, /x1/);
  assert.doesNotMatch(outer, /1\.2000/);
  const micom = render(components.ResultsNavigation, { activeTab: 'micom__step2', onSelect() {}, isMga: true, hasMicom: true });
  for (const label of ['Configural invariance', 'Compositional invariance', 'Equal means', 'Equal variances']) assert.ok(micom.includes(label), label);
  const moderation = { moderating_effects: [{ source: 'A', target: 'B', moderator: 'C', simple_slopes: [{ moderator_level: 'Low', slope: 0.2 }] }], conditional_indirect_effects: [{ chain: 'A -> B', moderator: 'C', conditional_effects: [{ w_label: 'Low', indirect_effect: 0.1 }] }] };
  const direct = render(components.ModerationDetails, { data: moderation, results: {}, section: '0' });
  const indirect = render(components.ModerationDetails, { data: moderation, results: {}, section: 'indirect' });
  assert.doesNotMatch(direct, /Conditional indirect effects/);
  assert.match(indirect, /Conditional indirect effects/);
  assert.doesNotMatch(indirect, /Conditional direct effects/);
});

test('selected analysis does not append unrelated model analyses', () => {
  const html = render(components.InlineAnalysisResults, {
    results: { moderation: { moderating_effects: [] }, gaussian_copula: { present: true } },
    analyses: { pca: { constructs: [] } }, available: ['pca'], onlySelected: true,
    latest: { id: 'pca', revision: 1 }, loading: {}, errors: {}, stale: {}, onLoad() {},
  });
  assert.match(html, /Principal components/);
  assert.doesNotMatch(html, /Interaction and simple slopes|Endogeneity diagnostics/);
});

test('report exports only the sections selected, including an empty selection', () => {
  const config = { modelName: 'Model', plsResults: { structural: { path_coefficients: { B: { A: 0.5 } } } } };
  const all = components.compileReportData(config).sections;
  assert.ok(all.length > 0);
  assert.deepEqual(components.compileReportData({ ...config, sectionFilter: [] }).sections, []);
  const one = components.compileReportData({ ...config, sectionFilter: [all[0].title] }).sections;
  assert.deepEqual(one.map(section => section.title), [all[0].title]);
  const analysisTable = { title: 'Principal components', headers: ['Component', 'Eigenvalue'], rows: [['1', '2.3']] };
  const analysis = components.compileReportData({ ...config, providedSections: [analysisTable] }).sections;
  assert.deepEqual(analysis, [analysisTable]);
  assert.deepEqual(components.compileReportData({ ...config, providedSections: [analysisTable], sectionFilter: [] }).sections, []);
});

test('result and calculation search matches labels and identifiers without case sensitivity', () => {
  assert.equal(components.matchesResultSearch('  BOOTSTRAP ', 'Bootstrap inference', 'bootstrap significance'), true);
  assert.equal(components.matchesResultSearch('confidence', 'Model fit', 'SRMR'), false);
  assert.equal(components.matchesResultSearch('', 'Model fit'), true);
});

test('calculation menu contains only the requested supported analyses', () => {
  const html = render(components.CalculationMenu, { onSelect() {} });
  assert.doesNotMatch(html, /<details|Search calculations|disabled/);
  for (const label of ['PLS-SEM', 'Bootstrapping', 'Consistent PLS-SEM', 'PLSpredict', 'IPMA', 'Tetrad', 'Bootstrap MGA']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /FIMIX|POS|segmentation|Blindfolding|Mediation|Measurement invariance|Omnibus|endogeneity|Sample size|redundancy|Model fit/i);
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

test('moderation shows the matching bootstrap inference and exports its tables', () => {
  const data = { moderating_effects: [{ source: 'A', target: 'B', moderator: 'M', method: 'two_stage', interaction_term: 'A x M', estimates: { beta_source: 0.2, beta_interaction: 0.1 }, simple_slopes: [{ moderator_level: '-1 SD (Low)', slope: 0.1, line_points: [{ x: -1, y: -0.1 }, { x: 1, y: 0.1 }] }] }], conditional_indirect_effects: [{ chain: 'A -> B -> C', moderator: 'M', conditional_effects: [{ w_label: '-1 SD (Low)', indirect_effect: 0.03 }] }] };
  const results = { moderation: data, construct_names: { A: 'Quality', B: 'Value', C: 'Loyalty', M: 'Experience' }, significance: { parameter_summary: {
    'simple_slope:A x M->B:-1': { p_value: 0.0000002, ci_low: 0.02, ci_high: 0.18 },
    'cond_indirect:A -> B -> C(M):-1': { p_value: 0.012, ci_low: 0.01, ci_high: 0.05 },
  } } };
  const html = render(components.ModerationDetails, { data, results });
  assert.match(html, /Quality → Value/);
  assert.match(html, /2\.0000e-7/);
  assert.match(html, /0\.0120/);
  assert.match(html, /Simple slopes of Quality predicting Value/);
  const sections = components.compileReportData({ modelName: 'Model', plsResults: results }).sections;
  assert.ok(sections.some(section => section.title === 'Moderation: Conditional Direct Effects' && section.rows[0].includes('2.0000e-7')));
  assert.ok(sections.some(section => section.title === 'Moderation: Conditional Indirect Effects' && section.rows[0].includes('0.0120')));
});
