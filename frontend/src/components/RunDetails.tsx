import React from 'react';
import { useStore } from '../store';
import { formatNumber, normalizeDecimalDigits } from '../utils/number-format';
import type { ResultsData } from '../utils/results-types';

export const RunDetails: React.FC<{ results: ResultsData | null | undefined }> = ({ results }) => {
  const { settings } = useStore();
  const run = results?.results_pls_original ?? results;
  const history = Array.isArray(run?.stop_criterion_history) ? run.stop_criterion_history : [];
  const lastChange = history.length ? history[history.length - 1] : null;
  const rows = [
    ['Estimator', results?.is_consistent ? 'Consistent PLS-SEM' : results?.algorithm === 'pls' ? 'PLS-SEM' : null],
    ['Convergence', run?.converged == null ? null : run.converged ? 'Converged' : 'Stopped before convergence'],
    ['Iterations', run?.iterations],
    ['Cases used', run?.n_samples ?? run?.sample_size],
    ['Final change', lastChange == null ? null : Math.abs(Number(lastChange)) < 1e-4 && Number(lastChange) !== 0
      ? Number(lastChange).toExponential(3) : formatNumber(lastChange, normalizeDecimalDigits(settings.decimalDigits), settings.decimalSystem)],
  ].filter(([, value]) => value != null);
  return <table className="scientific-table"><thead><tr><th>Run detail</th><th>Value</th></tr></thead><tbody>{rows.map(([label, value]) => <tr key={String(label)}><td style={{ fontWeight: 600 }}>{label}</td><td>{String(value)}</td></tr>)}</tbody></table>;
};
