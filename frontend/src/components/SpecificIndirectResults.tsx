import React from 'react';
import { useStore } from '../store';
import { formatNumber, formatPValue, normalizeDecimalDigits } from '../utils/number-format';
import type { IndirectPath, MediationData, ResultsData } from '../utils/results-types';

export const SpecificIndirectResults: React.FC<{ results: ResultsData | null | undefined; mediation?: MediationData; mediationStale?: boolean }> = ({ results, mediation, mediationStale = false }) => {
  const { settings } = useStore();
  const digits = normalizeDecimalDigits(settings.decimalDigits);
  const decomposedPaths = results?.effects_decomposition?.specific_indirect;
  const base = decomposedPaths?.length ? decomposedPaths : results?.structural?.specific_indirect ?? [];
  const mediationPaths = mediation?.specific_indirect_effects ?? [];
  const summary = results?.significance?.parameter_summary ?? results?.bootstrap?.parameter_summary ?? {};
  const basePaths = Array.isArray(base) ? base : [];
  const matches = (a: IndirectPath, b: IndirectPath) => {
    const first = Number(a?.effect ?? a?.original_effect);
    const second = Number(b?.original_effect ?? b?.effect);
    return !mediationStale && a.path === b.path && Number.isFinite(first) && Number.isFinite(second)
      && Math.abs(first - second) <= 1e-9 * (1 + Math.max(Math.abs(first), Math.abs(second)));
  };
  const paths = [
    ...basePaths.map(path => ({ path, source: 'Model', stats: mediationPaths.find(item => matches(path, item)) ?? summaryFor(path) })),
    ...mediationPaths.filter(item => !basePaths.some(path => matches(path, item)))
      .map(path => ({ path, source: 'Mediation run', stats: path })),
  ];
  function summaryFor(path: IndirectPath) { return summary[`specific_indirect:${path.path}`]; }
  const hasInference = paths.some(entry => entry.stats != null);
  const multipleSources = paths.some(entry => entry.source === 'Mediation run') && basePaths.length > 0;
  const fmt = (value: unknown) => formatNumber(value, digits, settings.decimalSystem);
  const fmtP = (value: unknown) => formatPValue(value, digits, settings.decimalSystem);

  if (!paths.length) return <p className="results-empty-note">No indirect paths are available for this model.</p>;
  return (<>
    {mediationStale && <p className="results-empty-note">The mediation analysis was calculated for a previous version of the model.</p>}
    <table className="scientific-table">
      <thead><tr><th>Path</th>{multipleSources && <th>Run</th>}<th>Indirect effect</th>{hasInference && <><th>Standard error</th><th>t statistic</th><th>p value</th><th>Confidence interval</th></>}</tr></thead>
      <tbody>
        {paths.map(({ path, source, stats }, index) => {
          const nodes = Array.isArray(path.path_nodes) ? path.path_nodes : null;
          const label = nodes ? nodes.map((id: string) => results?.construct_names?.[id] || id).join(' → ') : path.path;
          const low = stats?.ci_lower ?? stats?.ci_low;
          const high = stats?.ci_upper ?? stats?.ci_high;
          return <tr key={`${path.path}-${index}`}>
            <td>{label}</td>{multipleSources && <td>{source}</td>}<td>{fmt(path.effect ?? path.original_effect)}</td>
            {hasInference && <><td>{fmt(stats?.standard_error ?? stats?.se)}</td><td>{fmt(stats?.t_statistic ?? stats?.t_stat)}</td><td>{fmtP(stats?.p_value)}</td><td>{low != null && high != null ? `[${fmt(low)}, ${fmt(high)}]` : '—'}</td></>}
          </tr>;
        })}
      </tbody>
    </table>
  </>);
};
