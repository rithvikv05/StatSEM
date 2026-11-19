import React from 'react';
import { useStore } from '../store';
import { formatNumber, formatPValue, normalizeDecimalDigits } from '../utils/number-format';

export const standaloneAnalysisTitles: Record<string, string> = {
  predict: 'PLSpredict / CVPAT', cta: 'Confirmatory tetrad analysis',
  ipma: 'Importance-performance analysis', pca: 'Principal component analysis',
};

export function standaloneAnalysisSections(id: string, data: any): string[] {
  if (id === 'predict') return ['Prediction errors', ...(data?.cvpat ? ['Predictive ability comparison'] : [])];
  if (id === 'ipma') return ['Constructs', ...(data?.indicators?.length ? ['Indicators'] : [])];
  if (id === 'cta') return (Array.isArray(data?.constructs) ? data.constructs : data ? [data] : []).map((item: any) => item.construct_name || item.construct_id || 'Tetrads');
  if (id === 'pca') return (data?.constructs || []).flatMap((item: any, index: number) => {
    const name = item.name || item.id || `Construct ${index + 1}`;
    return [`${name} · variance`, `${name} · loadings`];
  });
  return [];
}

export const standaloneAnalysisSectionIndex = (tab: string) => {
  const index = Number(tab.split('::')[1]);
  return Number.isInteger(index) && index >= 0 ? index : 0;
};

interface TableProps { title: string; headers: string[]; rows: React.ReactNode[][]; }
const AnalysisTable: React.FC<TableProps> = ({ title, headers, rows }) => (
  <section className="standalone-analysis__section">
    <h2>{title}</h2>
    {rows.length ? <div className="scientific-table-wrap"><table className="scientific-table">
      <thead><tr>{headers.map((header, index) => <th key={index}>{header}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
    </table></div> : <p className="results-empty-note">No results available.</p>}
  </section>
);

export const StandaloneAnalysisResults: React.FC<{ id: string; data: any; section?: number }> = ({ id, data, section }) => {
  const { settings } = useStore();
  const digits = normalizeDecimalDigits(settings.decimalDigits);
  const fmt = (value: unknown) => formatNumber(value, digits, settings.decimalSystem);
  const fmtP = (value: unknown) => formatPValue(value, digits, settings.decimalSystem);
  if (!data) return <p className="results-empty-note">No results available.</p>;

  if (id === 'predict') {
    const indicators = data.indicator_metrics ?? data.indicators ?? [];
    const scopes = data.cvpat ? [{ construct: 'Overall', ...data.cvpat.overall }, ...(data.cvpat.constructs || [])] : [];
    const comparisons = scopes.flatMap((scope: any) => [
      { label: 'Indicator mean', value: scope.versus_indicator_mean },
      { label: 'Linear model', value: scope.versus_linear_model },
    ].filter(item => item.value).map(item => [scope.construct, item.label, fmt(item.value.mean_pls_loss), fmt(item.value.mean_benchmark_loss), fmt(item.value.mean_difference), fmtP(item.value.p_one_sided)]));
    return <div className="standalone-analysis">
      {data.warning && <p className="standalone-analysis__note">{data.warning}</p>}
      {(section == null || section === 0) && <AnalysisTable title="Prediction errors" headers={['Indicator', 'PLS RMSE', 'Linear model RMSE', 'Q² predict', 'Lower than benchmark']} rows={indicators.map((row: any) => {
        const pls = row.pls_rmse ?? row.rmse_pls, lm = row.lm_rmse ?? row.rmse_lm;
        const better = row.pls_beats_lm ?? (pls != null && lm != null ? pls < lm : null);
        return [row.indicator || row.name || '—', fmt(pls), fmt(lm), fmt(row.q2_predict), better == null ? '—' : better ? 'Yes' : 'No'];
      })} />}
      {data.cvpat && (section == null || section === 1) && <AnalysisTable title="Predictive ability comparison" headers={['Scope', 'Benchmark', 'PLS loss', 'Benchmark loss', 'Difference', 'p-value']} rows={comparisons} />}
      {data.cvpat && (section == null || section === 1) && <p className="standalone-analysis__note">Negative loss differences favour PLS. P-values are one-sided.</p>}
    </div>;
  }

  if (id === 'ipma') {
    const constructs = data.construct_data || data.constructs || [];
    const quadrant: Record<string, string> = { concentrate_here: 'Concentrate here', keep_up_good_work: 'Maintain', low_priority: 'Lower priority', possible_overkill: 'Possible over-allocation' };
    return <div className="standalone-analysis">
      {data.target_construct && <p className="standalone-analysis__note">Target: {data.target_construct}</p>}
      {(section == null || section === 0) && <AnalysisTable title="Constructs" headers={['Construct', 'Importance', 'Performance', 'Quadrant']} rows={constructs.map((row: any) => [row.construct_name || row.name || row.construct_id, fmt(row.importance ?? row.total_effect), fmt(row.performance), quadrant[row.quadrant] || '—'])} />}
      {Array.isArray(data.indicators) && data.indicators.length > 0 && (section == null || section === 1) && <AnalysisTable title="Indicators" headers={['Indicator', 'Construct', 'Importance', 'Performance', 'Weight']} rows={data.indicators.map((row: any) => [row.indicator, row.construct_id, fmt(row.importance), fmt(row.performance), fmt(row.unstandardized_weight)])} />}
    </div>;
  }

  if (id === 'cta') {
    const constructs = Array.isArray(data.constructs) ? data.constructs : [data];
    return <div className="standalone-analysis">{constructs.map((construct: any, index: number) => (section == null || section === index) && <React.Fragment key={construct.construct_id || index}>
      <AnalysisTable title={construct.construct_name || construct.construct_id || 'Tetrads'} headers={['Tetrad', 'Indicators', 'Estimate', 'Std. error', 'CI lower', 'CI upper', 'p-value']} rows={(construct.tetrads || []).map((row: any) => [row.tetrad_name || row.tetrad_label || row.tetrad_id || `Tetrad ${row.tetrad_number ?? ''}`, Array.isArray(row.indicators) ? row.indicators.join(', ') : (row.formula || '—'), fmt(row.original_value ?? row.sample_tetrad), fmt(row.standard_error ?? row.std_error), fmt(row.ci_lower_adjusted ?? row.ci_lower ?? row.ci_low), fmt(row.ci_upper_adjusted ?? row.ci_upper ?? row.ci_high), fmtP(row.p_value)])} />
      {construct.applicable === false && (construct.na_reason || construct.reason) && <p className="standalone-analysis__note">{construct.na_reason || construct.reason}</p>}
    </React.Fragment>)}</div>;
  }

  if (id === 'pca') return <div className="standalone-analysis">{(data.constructs || []).map((construct: any, index: number) => {
    const components = construct.components || [];
    const name = construct.name || construct.id || `Construct ${index + 1}`;
    return <React.Fragment key={construct.id || index}>
      {(section == null || section === index * 2) && <AnalysisTable title={`${name} · variance`} headers={['Component', 'Eigenvalue', 'Explained variance', 'Cumulative variance']} rows={components.map((item: any) => [item.component, fmt(item.eigenvalue), `${fmt(item.variance_explained * 100)}%`, `${fmt(item.cumulative_variance * 100)}%`])} />}
      {(section == null || section === index * 2 + 1) && <AnalysisTable title={`${name} · loadings`} headers={['Indicator', ...components.map((item: any) => `Component ${item.component}`)]} rows={(components[0]?.loadings || []).map((loading: any, rowIndex: number) => [loading.indicator, ...components.map((item: any) => fmt(item.loadings?.[rowIndex]?.loading))])} />}
    </React.Fragment>;
  })}</div>;
  return <p className="results-empty-note">This analysis is not available.</p>;
};

export const AnalysisRunDetails: React.FC<{ id: string; data: any }> = ({ id, data }) => {
  const run = data?.run_settings || {};
  const model = run.model || {};
  const rows: Array<[string, unknown]> = [
    ['Calculation', standaloneAnalysisTitles[id] || id],
    ['Cases used', data?.n_samples], ['Folds', data?.k_folds ?? run.k_folds],
    ['Repetitions', data?.repetitions ?? run.repetitions],
    ['Subsamples', data?.n_boot ?? run.n_boot], ['Random seed', run.seed],
    ['Significance level', data?.nominal_alpha ?? run.alpha],
    ['Test type', data?.tails ?? run.tails], ['Direction', data?.direction ?? run.direction],
    ['Parallel processing', (data?.parallel ?? run.parallel) == null ? null : (data?.parallel ?? run.parallel) ? 'Enabled' : 'Disabled'],
    ['Weighting scheme', model.inner_weighting], ['Maximum iterations', model.max_iter],
    ['Stop criterion', model.tolerance], ['Missing values', model.missing_treatment],
  ];
  return <table className="scientific-table"><thead><tr><th>Run detail</th><th>Value</th></tr></thead><tbody>{rows.filter(([, value]) => value != null).map(([name, value]) => <tr key={name}><td style={{ fontWeight: 600 }}>{name}</td><td>{String(value)}</td></tr>)}</tbody></table>;
};
