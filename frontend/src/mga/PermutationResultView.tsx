import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { useStore } from '../store';
import { matchesResultSearch } from '../utils/result-search';
import type { PermutationParamRow, PermutationReport } from './types';
import { fmt3, TableExportBar, type ExportTablePayload } from './exportUtils';
import { MicomPanel } from './MicomPanel';

interface PermutationResultViewProps {
  report: PermutationReport;
}

type PermTreeTab = 'paths' | 'loadings' | 'weights' | 'micom' | 'group_info';

export const PermutationResultView: React.FC<PermutationResultViewProps> = ({ report }) => {
  const { settings } = useStore();
  const decimalSystem = settings.decimalSystem;
  const f3 = (v: unknown) => fmt3(v, decimalSystem);

  const [activeTab, setActiveTab] = useState<PermTreeTab>('paths');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const term = query.trim().toLowerCase();

  const alpha = report.significanceLevel || 0.05;
  const loPct = `${((alpha / 2) * 100).toFixed(1)}%`;
  const hiPct = `${((1 - alpha / 2) * 100).toFixed(1)}%`;

  const buildParamPayload = (
    sheetName: string,
    title: string,
    firstColHeader: string,
    rows: PermutationParamRow[]
  ): ExportTablePayload => ({
    sheetName,
    title,
    subtitle: `Group A = ${report.groupAName} (n=${report.nA}), Group B = ${report.groupBName} (n=${report.nB}), ${report.permutationsCompleted} permutations, seed = ${report.seed}`,
    headers: [
      firstColHeader,
      `Original (${report.groupAName})`,
      `Original (${report.groupBName})`,
      'Original difference (A - B)',
      'Permutation mean difference (A - B)',
      loPct,
      hiPct,
      'Permutation p-value',
      'Significant',
    ],
    rows: rows.map(r => [
      r.parameter,
      r.originalA,
      r.originalB,
      r.originalDifference,
      r.permutationMeanDifference,
      r.ciLower,
      r.ciUpper,
      r.pValue,
      r.significant ? 'Yes' : 'No',
    ]),
  });

  const pathPayload = useMemo(
    () => buildParamPayload('Permutation - Path coefficients', 'Permutation — Path Coefficients', 'Path', report.pathCoefficients),
    [report]
  );
  const loadingPayload = useMemo(
    () => buildParamPayload('Permutation - Outer loadings', 'Permutation — Outer Loadings', 'Indicator ← Construct', report.outerLoadings),
    [report]
  );
  const weightPayload = useMemo(
    () => buildParamPayload('Permutation - Outer weights', 'Permutation — Outer Weights', 'Indicator → Construct', report.outerWeights),
    [report]
  );

  const groupInfoPayload: ExportTablePayload = useMemo(
    () => ({
      sheetName: 'Permutation - Group info',
      title: 'Permutation — Group & Run Info',
      headers: ['Setting / Metric', 'Value'],
      rows: [
        ['Group A', `${report.groupAName} (n = ${report.nA})`],
        ['Group B', `${report.groupBName} (n = ${report.nB})`],
        ['Permutations requested', report.permutationsRequested],
        ['Permutations completed', report.permutationsCompleted],
        ['Failed runs', report.failedRuns],
        ['Random seed', report.seed],
        ['Test type', report.testType],
        ['Significance level', report.significanceLevel],
        ['Parallel processing', report.parallelProcessing === false ? 'Disabled' : 'Enabled'],
        ['PLS mode', report.plsSettings.consistent ? 'Consistent PLS-SEM (PLSc)' : 'Standard PLS-SEM'],
        ['PLS weighting scheme', report.plsSettings.weightingScheme],
        ['PLS max iterations', report.plsSettings.maxIterations],
        ['PLS stop criterion', `1e-${report.plsSettings.stopCriterionExponent}`],
        ['Missing values', report.plsSettings.missingValues],
      ],
    }),
    [report]
  );

  const renderParamTable = (
    firstColHeader: string,
    rows: PermutationParamRow[],
    payload: ExportTablePayload
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
          Highlighting rows with p &lt; {alpha} ({report.testType}).
        </div>
        <TableExportBar payload={payload} />
      </div>

      <div className="scientific-table-wrap">
        <table className="scientific-table scientific-table--sticky-first">
          <thead>
            <tr>
              <th>{firstColHeader}</th>
              <th style={{ textAlign: 'right' }}>Original ({report.groupAName})</th>
              <th style={{ textAlign: 'right' }}>Original ({report.groupBName})</th>
              <th style={{ textAlign: 'right' }}>Original diff (A − B)</th>
              <th style={{ textAlign: 'right' }}>Permutation mean diff</th>
              <th style={{ textAlign: 'right' }}>{loPct}</th>
              <th style={{ textAlign: 'right' }}>{hiPct}</th>
              <th style={{ textAlign: 'right' }}>Permutation p</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
                  No rows available.
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={r.key}>
                  <td>{r.parameter}</td>
                  <td style={{ textAlign: 'right' }}>{f3(r.originalA)}</td>
                  <td style={{ textAlign: 'right' }}>{f3(r.originalB)}</td>
                  <td style={{ textAlign: 'right' }}>{f3(r.originalDifference)}</td>
                  <td style={{ textAlign: 'right' }}>{f3(r.permutationMeanDifference)}</td>
                  <td style={{ textAlign: 'right' }}>{f3(r.ciLower)}</td>
                  <td style={{ textAlign: 'right' }}>{f3(r.ciUpper)}</td>
                  <td
                    className={r.significant ? 'cell-sig--p05 cell-value' : 'cell-ns'}
                    style={{ textAlign: 'right' }}
                  >
                    {f3(r.pValue)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const tabDetails: Record<PermTreeTab, { title: string; subtitle: string }> = {
    paths: {
      title: 'Path Coefficients — Permutation Test',
      subtitle: 'Non-parametric permutation comparison of structural path coefficients across Group A and Group B.',
    },
    loadings: {
      title: 'Outer Loadings — Permutation Test',
      subtitle: 'Permutation comparison of outer indicator loadings between Group A and Group B.',
    },
    weights: {
      title: 'Outer Weights — Permutation Test',
      subtitle: 'Permutation comparison of outer indicator weights between Group A and Group B.',
    },
    micom: {
      title: 'MICOM — Measurement Invariance of Composite Models',
      subtitle: 'Three-step procedure (Configural, Compositional, Equal Means & Variances) per Henseler et al. (2016).',
    },
    group_info: {
      title: 'Group & Calculation Info',
      subtitle: 'Group sample sizes, permutation seed, convergence summary, and PLS algorithm configuration.',
    },
  };

  const rawNavGroups: Array<{ label: string; items: Array<{ id: PermTreeTab; label: string; badge?: string }> }> = [
    {
      label: 'Final results',
      items: [
        { id: 'paths', label: 'Path coefficients' },
        { id: 'loadings', label: 'Outer loadings' },
        { id: 'weights', label: 'Outer weights' },
      ],
    },
    {
      label: 'Measurement invariance',
      items: [
        {
          id: 'micom',
          label: 'MICOM',
          badge: report.micom.allInvariant ? 'Full' : report.micom.anyNoInvariance ? 'Check' : 'Partial',
        },
      ],
    },
    {
      label: 'Calculation',
      items: [{ id: 'group_info', label: 'Setting & group info' }],
    },
  ];
  const navGroups = rawNavGroups
    .map(g => ({
      ...g,
      items: g.items.filter(item => matchesResultSearch(term, item.label, item.id)),
    }))
    .filter(g => g.items.length > 0);

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <aside className="results-sidebar" aria-label="Permutation report">
        <div className="results-sidebar__search">
          <div className="results-sidebar__search-wrap">
            <svg className="results-sidebar__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <circle cx={11} cy={11} r={8} />
              <line x1={21} y1={21} x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              className="results-sidebar__search-input"
              placeholder="Filter results..."
              aria-label="Filter results"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="results-sidebar__tree">
          {navGroups.length === 0 && <p className="results-sidebar__empty">No results match your search.</p>}
          {navGroups.map(group => {
            const open = !!term || !collapsed.includes(group.label);
            return (
              <div className="tree-section" key={group.label}>
                <button
                  type="button"
                  className="tree-section__header tree-section__toggle"
                  aria-expanded={open}
                  disabled={!!term}
                  onClick={() =>
                    setCollapsed(prev =>
                      prev.includes(group.label) ? prev.filter(l => l !== group.label) : [...prev, group.label]
                    )
                  }
                >
                  <svg className={open ? 'open' : ''} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  <span>{group.label}</span>
                </button>
                {open && (
                  <div className="tree-section__items">
                    {group.items.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className={`tree-item ${activeTab === item.id ? 'active' : ''}`}
                        aria-current={activeTab === item.id ? 'page' : undefined}
                        onClick={() => setActiveTab(item.id)}
                      >
                        <span>{item.label}</span>
                        {item.badge && (
                          <span className="tree-item__size">{item.badge}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main Results Content */}
      <main className="results-main">
        <div className="report-header">
          <div className="report-header__top" style={{ alignItems: 'center' }}>
            <div>
              <h1 className="report-header__title">
                {tabDetails[activeTab].title}
                <span className="report-header__title-sub">
                  {report.groupAName} vs {report.groupBName}
                </span>
              </h1>
              <p className="report-header__subtitle">{tabDetails[activeTab].subtitle}</p>
            </div>
            <div
              title="Number of random reshuffles of group labels. 5000 recommended."
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: 'var(--color-text-muted)', cursor: 'help', fontFamily: 'var(--font-mono)' }}
            >
              <HelpCircle size={13} />
              <span>{report.permutationsCompleted} / {report.permutationsRequested} perms</span>
            </div>
          </div>
        </div>

        <div className="table-container" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {report.failedRunWarning && (
            <div className="results-notice results-notice--warn">
              <AlertTriangle size={15} />
              <span>{report.failedRunWarning}</span>
            </div>
          )}

          {activeTab === 'paths' && (
            report.micom.anyNoInvariance ? (
              <div className="results-notice results-notice--danger">
                <AlertTriangle size={15} />
                <span>
                  Measurement invariance not established for {report.micom.failedCompositionalConstructs.join(', ') || 'all constructs'}. Interpret group differences with caution.
                </span>
              </div>
            ) : (
              <div className="results-notice results-notice--success">
                <CheckCircle2 size={15} />
                <span>Measurement invariance established. Group differences below can be interpreted.</span>
              </div>
            )
          )}

          {activeTab === 'paths' && renderParamTable('Path', report.pathCoefficients, pathPayload)}
          {activeTab === 'loadings' && renderParamTable('Indicator ← Construct', report.outerLoadings, loadingPayload)}
          {activeTab === 'weights' && renderParamTable('Indicator → Construct', report.outerWeights, weightPayload)}
          {activeTab === 'micom' && <MicomPanel report={report} />}

          {activeTab === 'group_info' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <TableExportBar payload={groupInfoPayload} />
              </div>
              <div className="scientific-table-wrap">
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>Setting / Metric</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupInfoPayload.rows.map(([k, v], idx) => (
                      <tr key={idx}>
                        <td>{String(k)}</td>
                        <td>{String(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <footer className="results-footer">
          <div className="results-footer__left">
            <span>
              {report.groupAName} (n = <strong>{report.nA}</strong>) vs {report.groupBName} (n = <strong>{report.nB}</strong>)
            </span>
            <span className="results-footer__sep">·</span>
            <span>{report.permutationsCompleted.toLocaleString()} permutations</span>
            <span className="results-footer__sep">·</span>
            <span>seed {report.seed}</span>
          </div>
          <div className="results-footer__right">
            <span>{new Date(report.createdAt).toLocaleString()}</span>
          </div>
        </footer>
      </main>
    </div>
  );
};
