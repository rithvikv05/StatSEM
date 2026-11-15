import React, { useMemo } from 'react';
import { useStore } from '../store';
import { formatNumber, normalizeDecimalDigits } from '../utils/number-format';
import type { MgaParamRow, MgaReport, PermutationParamRow, PermutationReport } from './types';
import { MicomPanel } from './MicomPanel';

interface MgaActiveTableViewProps {
  report: MgaReport | PermutationReport;
  activeTab: string;
}

type SubViewKey =
  | 'bootstrap_mga'
  | 'parametric'
  | 'welch'
  | 'confidence_intervals'
  | 'bootstrapping_results';

function getHenseler1Tailed(r: MgaParamRow): number {
  if (typeof r.henselerP1Tailed === 'number' && Number.isFinite(r.henselerP1Tailed)) {
    return r.henselerP1Tailed;
  }
  const pg = typeof r.henselerPGreater === 'number' && Number.isFinite(r.henselerPGreater) ? r.henselerPGreater : 0.5;
  return Math.min(1, Math.max(0, 1 - pg));
}

function getHenseler2Tailed(r: MgaParamRow): number {
  if (typeof r.henselerP2Tailed === 'number' && Number.isFinite(r.henselerP2Tailed)) {
    return r.henselerP2Tailed;
  }
  const p1 = getHenseler1Tailed(r);
  return Math.min(1, Math.max(0, 2 * Math.min(p1, 1 - p1)));
}

function getBootT(orig: number, se: number, stored?: number): number {
  if (typeof stored === 'number' && Number.isFinite(stored)) return Math.abs(stored);
  return Number.isFinite(se) && se > 1e-12 ? Math.abs(orig / se) : 0;
}

export const MgaActiveTableView: React.FC<MgaActiveTableViewProps> = ({ report, activeTab }) => {
  const { settings } = useStore();
  const decimalSystem = settings.decimalSystem;
  const decimalDigits = normalizeDecimalDigits(settings.decimalDigits);
  const fmt = (v: unknown) => formatNumber(v, decimalDigits, decimalSystem);

  // Parse category and subView from activeTab (e.g. "path_coefficients__parametric")
  const [category, subViewRaw] = activeTab.includes('__')
    ? activeTab.split('__')
    : [activeTab, 'bootstrap_mga'];
  const subView: SubViewKey = (subViewRaw as SubViewKey) || 'bootstrap_mga';

  const isPermutation = report.reportType === 'permutation';
  const groupA = report.groupAName;
  const groupB = report.groupBName;
  const alpha = report.significanceLevel || 0.05;
  const oneTailed = report.testType === 'one-tailed';

  // Extract relevant rows based on category
  const rows = useMemo(() => {
    if (isPermutation) {
      const pReport = report as PermutationReport;
      switch (category) {
        case 'path_coefficients':
          return pReport.pathCoefficients || [];
        case 'outer_loadings':
          return pReport.outerLoadings || [];
        case 'outer_weights':
          return pReport.outerWeights || [];
        default:
          return pReport.pathCoefficients || [];
      }
    } else {
      const mReport = report as MgaReport;
      switch (category) {
        case 'path_coefficients':
          return mReport.pathCoefficients || [];
        case 'total_effects':
          return mReport.totalEffects || [];
        case 'total_indirect_effects':
          return mReport.totalIndirectEffects || [];
        case 'specific_indirect_effects':
          return mReport.specificIndirectEffects || [];
        case 'outer_loadings':
          return mReport.outerLoadings || [];
        case 'outer_weights':
          return mReport.outerWeights || [];
        default:
          return mReport.pathCoefficients || [];
      }
    }
  }, [report, category, isPermutation]);

  // MICOM view for permutation report
  if (category === 'micom' && isPermutation) {
    return <MicomPanel report={report as PermutationReport} />;
  }

  // Run details / settings view
  if (category === 'run_details') {
    const isMga = !isPermutation;
    const mReport = report as MgaReport;
    const pReport = report as PermutationReport;
    const settingRows: Array<[string, any]> = [
      ['Group A name', report.groupAName],
      ['Group A sample size (nA)', report.nA],
      ['Group B name', report.groupBName],
      ['Group B sample size (nB)', report.nB],
      ...(isMga ? [
        ['Subsamples requested', mReport.subsamplesRequested] as [string, any],
        ['Subsamples completed (A)', mReport.subsamplesCompletedA] as [string, any],
        ['Subsamples completed (B)', mReport.subsamplesCompletedB] as [string, any],
      ] : [
        ['Permutations requested', pReport.permutationsRequested] as [string, any],
        ['Permutations completed', pReport.permutationsCompleted] as [string, any],
        ['Failed runs', pReport.failedRuns] as [string, any],
      ]),
      ['Random seed', report.seed],
      ['Hypothesis test type', report.testType],
      ['Significance level (alpha)', report.significanceLevel],
      ['Parallel processing', report.parallelProcessing === false ? 'Disabled' : 'Enabled'],
      ['PLS weighting scheme', report.plsSettings?.weightingScheme || 'path'],
      ['PLS max iterations', report.plsSettings?.maxIterations ?? 5000],
      ['PLS stop criterion', `1e-${report.plsSettings?.stopCriterionExponent ?? 7}`],
      ['Missing values treatment', report.plsSettings?.missingValues || 'mean'],
      ['Consistent PLS-SEM', report.plsSettings?.consistent ? 'Yes' : 'No'],
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <table className="scientific-table">
          <thead>
            <tr>
              <th style={{ width: '280px' }}>Setting / Metric</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {settingRows.map(([k, v], idx) => (
              <tr key={idx}>
                <td style={{ fontWeight: 500 }}>{k}</td>
                <td>{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Permutation Parameter Table
  if (isPermutation) {
    const pRows = rows as PermutationParamRow[];
    const loPct = `${((alpha / 2) * 100).toFixed(1)}%`;
    const hiPct = `${((1 - alpha / 2) * 100).toFixed(1)}%`;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <table className="scientific-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Original ({groupA})</th>
              <th>Original ({groupB})</th>
              <th>Difference (A - B)</th>
              <th>Permutation mean difference</th>
              <th>{loPct}</th>
              <th>{hiPct}</th>
              <th>p-value</th>
            </tr>
          </thead>
          <tbody>
            {pRows.map(r => {
              const sig = r.significant || r.pValue < alpha;
              return (
                <tr key={r.key || r.parameter}>
                  <td style={{ fontWeight: 500 }}>{r.parameter}</td>
                  <td>{fmt(r.originalA)}</td>
                  <td>{fmt(r.originalB)}</td>
                  <td style={{ fontWeight: 600 }}>{fmt(r.originalDifference)}</td>
                  <td>{fmt(r.permutationMeanDifference)}</td>
                  <td>{fmt(r.ciLower)}</td>
                  <td>{fmt(r.ciUpper)}</td>
                  <td className={sig ? 'cell-sig sig-highlight' : ''} style={sig ? { color: 'var(--color-accent)', fontWeight: 600 } : undefined}>
                    {fmt(r.pValue)}
                    {sig && <span style={{ marginLeft: '4px', fontSize: '10px' }}>*</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // Bootstrap MGA Parameter Table
  const mRows = rows as MgaParamRow[];
  const loPct = `${((alpha / 2) * 100).toFixed(1)}%`;
  const hiPct = `${((1 - alpha / 2) * 100).toFixed(1)}%`;

  const getTableContent = () => {
    switch (subView) {
      case 'bootstrap_mga': {
        const headers = [
          'Parameter',
          `Difference (|${groupA} - ${groupB}|)`,
          `p-value 1-tailed (${groupA} vs ${groupB})`,
          `p-value 2-tailed (${groupA} vs ${groupB})`,
        ];
        return {
          headers,
          renderRows: () =>
            mRows.map(r => {
              const p1 = getHenseler1Tailed(r);
              const p2 = getHenseler2Tailed(r);
              const sig1 = oneTailed && p1 < alpha;
              const sig2 = p2 < alpha;
              return (
                <tr key={r.key || r.parameter}>
                  <td style={{ fontWeight: 500 }}>{r.parameter}</td>
                  <td style={{ fontWeight: 600 }}>{fmt(r.difference)}</td>
                  <td className={sig1 ? 'cell-sig sig-highlight' : ''} style={sig1 ? { color: 'var(--color-accent)', fontWeight: 600 } : undefined}>
                    {fmt(p1)}
                  </td>
                  <td className={sig2 ? 'cell-sig sig-highlight' : ''} style={sig2 ? { color: 'var(--color-accent)', fontWeight: 600 } : undefined}>
                    {fmt(p2)}
                    {sig2 && <span style={{ marginLeft: '4px', fontSize: '10px' }}>*</span>}
                  </td>
                </tr>
              );
            }),
        };
      }
      case 'parametric': {
        const headers = [
          'Parameter',
          `Difference (|${groupA} - ${groupB}|)`,
          `t-value (|${groupA} vs ${groupB}|)`,
          `p-value (${groupA} vs ${groupB})`,
        ];
        return {
          headers,
          renderRows: () =>
            mRows.map(r => {
              const sig = r.parametricP < alpha;
              return (
                <tr key={r.key || r.parameter}>
                  <td style={{ fontWeight: 500 }}>{r.parameter}</td>
                  <td style={{ fontWeight: 600 }}>{fmt(r.difference)}</td>
                  <td>{fmt(Math.abs(r.parametricT))}</td>
                  <td className={sig ? 'cell-sig sig-highlight' : ''} style={sig ? { color: 'var(--color-accent)', fontWeight: 600 } : undefined}>
                    {fmt(r.parametricP)}
                    {sig && <span style={{ marginLeft: '4px', fontSize: '10px' }}>*</span>}
                  </td>
                </tr>
              );
            }),
        };
      }
      case 'welch': {
        const headers = [
          'Parameter',
          `Difference (|${groupA} - ${groupB}|)`,
          `t-value (|${groupA} vs ${groupB}|)`,
          `p-value (${groupA} vs ${groupB})`,
        ];
        return {
          headers,
          renderRows: () =>
            mRows.map(r => {
              const sig = r.welchP < alpha;
              return (
                <tr key={r.key || r.parameter}>
                  <td style={{ fontWeight: 500 }}>{r.parameter}</td>
                  <td style={{ fontWeight: 600 }}>{fmt(r.difference)}</td>
                  <td>{fmt(Math.abs(r.welchT))}</td>
                  <td className={sig ? 'cell-sig sig-highlight' : ''} style={sig ? { color: 'var(--color-accent)', fontWeight: 600 } : undefined}>
                    {fmt(r.welchP)}
                    {sig && <span style={{ marginLeft: '4px', fontSize: '10px' }}>*</span>}
                  </td>
                </tr>
              );
            }),
        };
      }
      case 'confidence_intervals': {
        const headers = [
          'Parameter',
          `${loPct} (${groupA})`,
          `${hiPct} (${groupA})`,
          `${loPct} (${groupB})`,
          `${hiPct} (${groupB})`,
        ];
        return {
          headers,
          renderRows: () =>
            mRows.map(r => (
              <tr key={r.key || r.parameter}>
                <td style={{ fontWeight: 500 }}>{r.parameter}</td>
                <td>{fmt(r.ciLowerA)}</td>
                <td>{fmt(r.ciUpperA)}</td>
                <td>{fmt(r.ciLowerB)}</td>
                <td>{fmt(r.ciUpperB)}</td>
              </tr>
            )),
        };
      }
      case 'bootstrapping_results': {
        const headers = [
          'Parameter',
          `Original (${groupA})`,
          `Original (${groupB})`,
          `Mean (${groupA})`,
          `Mean (${groupB})`,
          `STDEV (${groupA})`,
          `STDEV (${groupB})`,
          `t-value (${groupA})`,
          `t-value (${groupB})`,
          `p-value (${groupA})`,
          `p-value (${groupB})`,
        ];
        return {
          headers,
          renderRows: () =>
            mRows.map(r => {
              const ta = getBootT(r.originalA, r.seA, r.tValueA);
              const tb = getBootT(r.originalB, r.seB, r.tValueB);
              const sigA = typeof r.pValueA === 'number' && r.pValueA < alpha;
              const sigB = typeof r.pValueB === 'number' && r.pValueB < alpha;
              return (
                <tr key={r.key || r.parameter}>
                  <td style={{ fontWeight: 500 }}>{r.parameter}</td>
                  <td>{fmt(r.originalA)}</td>
                  <td>{fmt(r.originalB)}</td>
                  <td>{fmt(r.meanA)}</td>
                  <td>{fmt(r.meanB)}</td>
                  <td>{fmt(r.seA)}</td>
                  <td>{fmt(r.seB)}</td>
                  <td>{fmt(ta)}</td>
                  <td>{fmt(tb)}</td>
                  <td className={sigA ? 'cell-sig' : ''} style={sigA ? { color: 'var(--color-accent)', fontWeight: 600 } : undefined}>
                    {fmt(r.pValueA)}
                  </td>
                  <td className={sigB ? 'cell-sig' : ''} style={sigB ? { color: 'var(--color-accent)', fontWeight: 600 } : undefined}>
                    {fmt(r.pValueB)}
                  </td>
                </tr>
              );
            }),
        };
      }
    }
  };

  const { headers, renderRows } = getTableContent();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <table className="scientific-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {renderRows()}
        </tbody>
      </table>
    </div>
  );
};


