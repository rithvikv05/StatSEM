import React from 'react';
import { useStore } from '../store';
import { formatNumber, normalizeDecimalDigits } from '../utils/number-format';
import type { ResultsData } from '../utils/results-types';
import type { MgaReport, PermutationReport } from '../mga/types';

export const RunDetails: React.FC<{ results?: ResultsData | null; report?: MgaReport | PermutationReport }> = ({ results, report }) => {
  const { settings } = useStore();
  const run = results?.results_pls_original ?? results;
  const history = Array.isArray(run?.stop_criterion_history) ? run.stop_criterion_history : [];
  const lastChange = history.length ? history[history.length - 1] : null;
  const rows = report ? [
    ['Estimator', `${report.plsSettings?.consistent ? 'Consistent ' : ''}${report.reportType === 'permutation' ? 'Permutation MGA' : 'Bootstrap MGA'}`],
    ['Group A', report.groupAName],
    ['Group A cases', report.nA],
    ['Group B', report.groupBName],
    ['Group B cases', report.nB],
    ...(report.reportType === 'permutation' ? [
      ['Permutations requested', report.permutationsRequested],
      ['Permutations completed', report.permutationsCompleted],
      ['Failed runs', report.failedRuns],
    ] : [
      ['Subsamples requested', report.subsamplesRequested],
      ['Subsamples completed (A)', report.subsamplesCompletedA],
      ['Subsamples completed (B)', report.subsamplesCompletedB],
    ]),
    ['Random seed', report.seed],
    ['Test type', report.testType],
    ['Significance level', report.significanceLevel],
    ['Parallel processing', report.parallelProcessing == null ? null : report.parallelProcessing ? 'Enabled' : 'Disabled'],
    ['Weighting scheme', report.plsSettings?.weightingScheme],
    ['Maximum iterations', report.plsSettings?.maxIterations],
    ['Stop criterion', report.plsSettings?.stopCriterionExponent == null ? null : `1e-${report.plsSettings.stopCriterionExponent}`],
    ['Missing values', report.plsSettings?.missingValues],
  ].filter(([, value]) => value != null) : [
    ['Estimator', results?.is_consistent ? 'Consistent PLS-SEM' : results?.algorithm === 'pls' ? 'PLS-SEM' : null],
    ['Convergence', run?.converged == null ? null : run.converged ? 'Converged' : 'Stopped before convergence'],
    ['Iterations', run?.iterations],
    ['Cases used', run?.n_samples ?? run?.sample_size],
    ['Final change', lastChange == null ? null : Math.abs(Number(lastChange)) < 1e-4 && Number(lastChange) !== 0
      ? Number(lastChange).toExponential(3) : formatNumber(lastChange, normalizeDecimalDigits(settings.decimalDigits), settings.decimalSystem)],
  ].filter(([, value]) => value != null);
  return <table className="scientific-table"><thead><tr><th>Run detail</th><th>Value</th></tr></thead><tbody>{rows.map(([label, value]) => <tr key={String(label)}><td style={{ fontWeight: 600 }}>{label}</td><td>{String(value)}</td></tr>)}</tbody></table>;
};
