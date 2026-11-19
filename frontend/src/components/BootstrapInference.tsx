import React from 'react';
import { useStore } from '../store';
import { formatNumber, formatPValue, normalizeDecimalDigits } from '../utils/number-format';

export const BootstrapInference: React.FC<{
  results: any;
  section: 'paths' | 'loadings';
  constructName: (id: string) => string;
  indicatorName: (id: string) => string;
}> = ({ results, section, constructName, indicatorName }) => {
  const { settings } = useStore();
  const digits = normalizeDecimalDigits(settings.decimalDigits);
  const fmt = (v: unknown) => formatNumber(v, digits, settings.decimalSystem);
  const fmtP = (v: unknown) => formatPValue(v, digits, settings.decimalSystem);
  const significance = results?.significance || results?.bootstrap;
  const data = section === 'paths' ? significance?.paths : significance?.loadings || significance?.outer_loadings;
  const rows = Array.isArray(data) ? data : [];
  const colorClass = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    return value < 0.001 ? 'cell-sig--p001' : value < 0.01 ? 'cell-sig--p01' : value < 0.05 ? 'cell-sig--p05' : '';
  };
  const ciMethod = significance?.settings?.ci_method;
  const ciNames: Record<string, string> = { percentile: 'Percentile', bias_corrected: 'Bias-corrected', bca: 'BCa', studentized: 'Studentized' };
  const alpha = significance?.settings?.significance_level;
  const intervalLabel = typeof alpha === 'number' ? `${fmt((1 - alpha) * 100)}% CI` : 'Confidence interval';
  return <>
    <table className="scientific-table">
      <thead><tr><th>{section === 'paths' ? 'Path' : 'Construct'}</th>{section === 'loadings' && <th>Indicator</th>}<th>Original</th><th>Sample mean</th><th>Std. error</th><th>t-statistic</th><th>p-value</th><th>{intervalLabel}</th></tr></thead>
      <tbody>{rows.length ? rows.map((row: any, index: number) => {
        const p = row.p_value;
        const low = row.ci_low ?? row.ci_lower, high = row.ci_high ?? row.ci_upper;
        return <tr key={index}>
          <td>{section === 'paths' ? `${row.from_name || constructName(row.from)} → ${row.to_name || constructName(row.to)}` : row.construct_name || constructName(row.construct)}</td>
          {section === 'loadings' && <td>{indicatorName(row.indicator) || row.indicator_name}</td>}
          <td className={colorClass(p)}>{fmt(row.original)}</td><td>{fmt(row.mean)}</td><td>{fmt(row.se ?? row.standard_error)}</td><td>{fmt(row.t_stat ?? row.t_statistic)}</td><td className={colorClass(p)}>{fmtP(p)}</td>
          <td>{low != null && high != null ? `[${fmt(low)}, ${fmt(high)}]` : '—'}</td>
        </tr>;
      }) : <tr><td colSpan={section === 'paths' ? 7 : 8}>No bootstrap results available.</td></tr>}</tbody>
    </table>
    <div className="sig-legend-minimal">
      <span className="sig-legend-minimal__label">p-value:</span>
      <span className="sig-legend-minimal__item"><span className="sig-legend-minimal__dot sig-legend-minimal__dot--p001" /> &lt; 0.001</span>
      <span className="sig-legend-minimal__item"><span className="sig-legend-minimal__dot sig-legend-minimal__dot--p01" /> &lt; 0.01</span>
      <span className="sig-legend-minimal__item"><span className="sig-legend-minimal__dot sig-legend-minimal__dot--p05" /> &lt; 0.05</span>
      <span className="sig-legend-minimal__item"><span className="sig-legend-minimal__dot sig-legend-minimal__dot--ns" /> ≥ 0.05</span>
      {ciMethod && <span className="bootstrap-method-label">{ciNames[ciMethod] || ciMethod} interval</span>}
    </div>
  </>;
};
