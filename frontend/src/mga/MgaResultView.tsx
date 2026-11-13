import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { formatNumber, normalizeDecimalDigits } from '../utils/number-format';
import { matchesResultSearch } from '../utils/result-search';
import type { MgaParamRow, MgaReport } from './types';
import { TableExportBar, type ExportTablePayload } from './exportUtils';

interface MgaResultViewProps {
  report: MgaReport;
}

type ParamCategoryKey =
  | 'path_coefficients'
  | 'total_indirect_effects'
  | 'specific_indirect_effects'
  | 'total_effects'
  | 'outer_loadings'
  | 'outer_weights';

type SubViewKey =
  | 'bootstrap_mga'
  | 'parametric'
  | 'welch'
  | 'confidence_intervals'
  | 'bootstrapping_results';

type SidebarSelection =
  | { kind: 'param'; category: ParamCategoryKey; subView: SubViewKey }
  | { kind: 'setting' };

interface CategoryDef {
  key: ParamCategoryKey;
  label: string;
  shortLabel: string;
}

const CATEGORIES: CategoryDef[] = [
  { key: 'path_coefficients', label: 'Path coefficients', shortLabel: 'Path coeff.' },
  { key: 'total_indirect_effects', label: 'Total indirect effects', shortLabel: 'Total indirect' },
  { key: 'specific_indirect_effects', label: 'Specific indirect effects', shortLabel: 'Specific ind.' },
  { key: 'total_effects', label: 'Total effects', shortLabel: 'Total effects' },
  { key: 'outer_loadings', label: 'Outer loadings', shortLabel: 'Outer loadings' },
  { key: 'outer_weights', label: 'Outer weights', shortLabel: 'Outer weights' },
];

const SUB_VIEWS: Array<{ key: SubViewKey; label: string; shortLabel: string }> = [
  { key: 'bootstrap_mga', label: 'Bootstrap MGA', shortLabel: 'Bootstrap MGA' },
  { key: 'parametric', label: 'Parametric test', shortLabel: 'Parametric' },
  { key: 'welch', label: 'Welch-Satterthwaite test', shortLabel: 'Welch' },
  { key: 'confidence_intervals', label: 'Confidence intervals (bias corrected)', shortLabel: 'CI (BC)' },
  { key: 'bootstrapping_results', label: 'Bootstrapping results', shortLabel: 'Bootstrapping' },
];

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

function formatCiPercent(p: number): string {
  const pct = p * 100;
  return Number.isInteger(pct) ? `${pct.toFixed(1)}%` : `${Number(pct.toFixed(2))}%`;
}

export const MgaResultView: React.FC<MgaResultViewProps> = ({ report }) => {
  const { settings } = useStore();
  const decimalSystem = settings.decimalSystem;
  const decimalDigits = normalizeDecimalDigits(settings.decimalDigits);
  const fmt = (v: unknown) => formatNumber(v, decimalDigits, decimalSystem);

  const [query, setQuery] = useState('');
  const [finalResultsOpen, setFinalResultsOpen] = useState<boolean>(true);
  const [algorithmOpen, setAlgorithmOpen] = useState<boolean>(true);
  const term = query.trim().toLowerCase();
  const [expandedCategories, setExpandedCategories] = useState<Record<ParamCategoryKey, boolean>>({
    path_coefficients: true,
    total_indirect_effects: true,
    specific_indirect_effects: true,
    total_effects: true,
    outer_loadings: true,
    outer_weights: true,
  });
  const [selection, setSelection] = useState<SidebarSelection>({
    kind: 'param',
    category: 'path_coefficients',
    subView: 'bootstrap_mga',
  });

  const alpha = report.significanceLevel || 0.05;
  const oneTailed = report.testType === 'one-tailed';
  const groupA = report.groupAName;
  const groupB = report.groupBName;

  const toggleCategory = (cat: ParamCategoryKey) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const rowsByCategory = useMemo<Record<ParamCategoryKey, MgaParamRow[]>>(
    () => ({
      path_coefficients: report.pathCoefficients ?? [],
      total_indirect_effects: report.totalIndirectEffects ?? [],
      specific_indirect_effects: report.specificIndirectEffects ?? [],
      total_effects: report.totalEffects ?? [],
      outer_loadings: report.outerLoadings ?? [],
      outer_weights: report.outerWeights ?? [],
    }),
    [report]
  );

  const [ciLowLabel, ciHighLabel] = useMemo(() => {
    const low = oneTailed ? alpha : alpha / 2;
    const high = 1 - low;
    return [formatCiPercent(low), formatCiPercent(high)];
  }, [alpha, oneTailed]);

  const currentTitle = useMemo(() => {
    if (selection.kind === 'setting') return 'Setting';
    const cat = CATEGORIES.find(c => c.key === selection.category);
    const sub = SUB_VIEWS.find(s => s.key === selection.subView);
    return `${cat?.label ?? ''} - ${sub?.label ?? ''}`;
  }, [selection]);

  const settingRows: Array<[string, string | number]> = useMemo(
    () => [
      ['Group A', `${groupA} (n = ${report.nA})`],
      ['Group B', `${groupB} (n = ${report.nB})`],
      ['Subsamples', report.subsamplesRequested],
      ['Completed subsamples (Group A)', report.subsamplesCompletedA],
      ['Completed subsamples (Group B)', report.subsamplesCompletedB],
      ['Test type', report.testType === 'one-tailed' ? 'One-tailed' : 'Two-tailed'],
      ['Significance level', report.significanceLevel],
      ['Parallel processing', report.parallelProcessing === false ? 'Disabled' : 'Enabled'],
      ['Random seed', report.seed],
      ['PLS mode', report.plsSettings.consistent ? 'Consistent PLS-SEM (PLSc)' : 'Standard PLS-SEM'],
      ['PLS weighting scheme', report.plsSettings.weightingScheme],
      ['PLS max iterations', report.plsSettings.maxIterations],
      ['PLS stop criterion (10^-x)', report.plsSettings.stopCriterionExponent],
      ['Missing values', report.plsSettings.missingValues],
    ],
    [groupA, groupB, report]
  );

  const activeTable = useMemo<{
    headers: string[];
    displayRows: Array<{
      key: string;
      parameter: string;
      cells: Array<{ raw: number | undefined; sig?: boolean; isP?: boolean }>;
    }>;
    exportPayload: ExportTablePayload;
  }>(() => {
    if (selection.kind === 'setting') {
      return {
        headers: ['Setting', 'Value'],
        displayRows: [],
        exportPayload: {
          sheetName: 'MGA - Setting',
          title: 'Bootstrap multigroup analysis (MGA) - Setting',
          subtitle: `${groupA} (n=${report.nA}) vs ${groupB} (n=${report.nB})`,
          headers: ['Setting', 'Value'],
          rows: settingRows.map(([k, v]) => [k, v]),
        },
      };
    }

    const { category, subView } = selection;
    const catMeta = CATEGORIES.find(c => c.key === category)!;
    const subMeta = SUB_VIEWS.find(s => s.key === subView)!;
    const rows = rowsByCategory[category];
    const title = `${catMeta.label} - ${subMeta.label}`;
    const sheetName = `${catMeta.shortLabel} - ${subMeta.shortLabel}`;
    const subtitle = `Group A = ${groupA} (n=${report.nA}), Group B = ${groupB} (n=${report.nB}), ${report.subsamplesRequested} subsamples, seed = ${report.seed}`;

    if (subView === 'bootstrap_mga') {
      const headers = [
        '',
        `Difference (${groupA} - ${groupB})`,
        `1-tailed (${groupA} vs ${groupB}) p value`,
        `2-tailed (${groupA} vs ${groupB}) p value`,
      ];
      return {
        headers,
        displayRows: rows.map(r => {
          const p1 = getHenseler1Tailed(r);
          const p2 = getHenseler2Tailed(r);
          return {
            key: r.key,
            parameter: r.parameter,
            cells: [
              { raw: r.difference },
              { raw: p1, isP: oneTailed, sig: oneTailed ? p1 < alpha : undefined },
              { raw: p2, isP: true, sig: p2 < alpha },
            ],
          };
        }),
        exportPayload: {
          sheetName,
          title,
          subtitle,
          headers: ['Parameter', ...headers.slice(1)],
          rows: rows.map(r => [r.parameter, r.difference, getHenseler1Tailed(r), getHenseler2Tailed(r)]),
        },
      };
    }

    if (subView === 'parametric') {
      const headers = [
        '',
        `Difference (${groupA} - ${groupB})`,
        `t value (|${groupA} vs ${groupB}|)`,
        `p value (${groupA} vs ${groupB})`,
      ];
      return {
        headers,
        displayRows: rows.map(r => ({
          key: r.key,
          parameter: r.parameter,
          cells: [
            { raw: r.difference },
            { raw: Math.abs(r.parametricT) },
            { raw: r.parametricP, isP: true, sig: r.parametricP < alpha },
          ],
        })),
        exportPayload: {
          sheetName,
          title,
          subtitle,
          headers: ['Parameter', ...headers.slice(1)],
          rows: rows.map(r => [r.parameter, r.difference, Math.abs(r.parametricT), r.parametricP]),
        },
      };
    }

    if (subView === 'welch') {
      const headers = [
        '',
        `Difference (${groupA} - ${groupB})`,
        `t value (|${groupA} vs ${groupB}|)`,
        `p value (${groupA} vs ${groupB})`,
      ];
      return {
        headers,
        displayRows: rows.map(r => ({
          key: r.key,
          parameter: r.parameter,
          cells: [
            { raw: r.difference },
            { raw: Math.abs(r.welchT) },
            { raw: r.welchP, isP: true, sig: r.welchP < alpha },
          ],
        })),
        exportPayload: {
          sheetName,
          title,
          subtitle,
          headers: ['Parameter', ...headers.slice(1)],
          rows: rows.map(r => [r.parameter, r.difference, Math.abs(r.welchT), r.welchP]),
        },
      };
    }

    if (subView === 'confidence_intervals') {
      const headers = [
        '',
        `${ciLowLabel} (${groupA})`,
        `${ciHighLabel} (${groupA})`,
        `${ciLowLabel} (${groupB})`,
        `${ciHighLabel} (${groupB})`,
      ];
      return {
        headers,
        displayRows: rows.map(r => ({
          key: r.key,
          parameter: r.parameter,
          cells: [
            { raw: r.ciLowerA },
            { raw: r.ciUpperA },
            { raw: r.ciLowerB },
            { raw: r.ciUpperB },
          ],
        })),
        exportPayload: {
          sheetName,
          title,
          subtitle,
          headers: ['Parameter', ...headers.slice(1)],
          rows: rows.map(r => [
            r.parameter,
            r.ciLowerA ?? null,
            r.ciUpperA ?? null,
            r.ciLowerB ?? null,
            r.ciUpperB ?? null,
          ]),
        },
      };
    }

    // Bootstrapping results
    const headers = [
      '',
      `Original (${groupA})`,
      `Original (${groupB})`,
      `Mean (${groupA})`,
      `Mean (${groupB})`,
      `STDEV (${groupA})`,
      `STDEV (${groupB})`,
      `t value (${groupA})`,
      `t value (${groupB})`,
      `p value (${groupA})`,
      `p value (${groupB})`,
    ];
    return {
      headers,
      displayRows: rows.map(r => {
        const ta = getBootT(r.originalA, r.seA, r.tValueA);
        const tb = getBootT(r.originalB, r.seB, r.tValueB);
        return {
          key: r.key,
          parameter: r.parameter,
          cells: [
            { raw: r.originalA },
            { raw: r.originalB },
            { raw: r.meanA },
            { raw: r.meanB },
            { raw: r.seA },
            { raw: r.seB },
            { raw: ta },
            { raw: tb },
            { raw: r.pValueA, isP: true, sig: typeof r.pValueA === 'number' ? r.pValueA < alpha : undefined },
            { raw: r.pValueB, isP: true, sig: typeof r.pValueB === 'number' ? r.pValueB < alpha : undefined },
          ],
        };
      }),
      exportPayload: {
        sheetName,
        title,
        subtitle,
        headers: ['Parameter', ...headers.slice(1)],
        rows: rows.map(r => [
          r.parameter,
          r.originalA,
          r.originalB,
          r.meanA,
          r.meanB,
          r.seA,
          r.seB,
          getBootT(r.originalA, r.seA, r.tValueA),
          getBootT(r.originalB, r.seB, r.tValueB),
          r.pValueA ?? null,
          r.pValueB ?? null,
        ]),
      },
    };
  }, [selection, rowsByCategory, groupA, groupB, report, alpha, oneTailed, ciLowLabel, ciHighLabel, settingRows]);

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <aside className="results-sidebar" aria-label="Bootstrap MGA results">
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
          {(() => {
            const visibleCategories = CATEGORIES.map(cat => ({
              cat,
              subs: SUB_VIEWS.filter(sub =>
                matchesResultSearch(term, `${cat.label} ${sub.label}`, `${cat.key} ${sub.key}`)
              ),
            })).filter(entry => entry.subs.length > 0);
            const showSettings = matchesResultSearch(term, 'Algorithm Setting', 'setting');

            if (visibleCategories.length === 0 && !showSettings) {
              return <p className="results-sidebar__empty">No results match your search.</p>;
            }

            const finalOpen = !!term || finalResultsOpen;
            const algoOpen = !!term || algorithmOpen;

            return (
              <>
                {visibleCategories.length > 0 && (
                  <div className="tree-section">
                    <button
                      type="button"
                      className="tree-section__header tree-section__toggle"
                      aria-expanded={finalOpen}
                      disabled={!!term}
                      onClick={() => setFinalResultsOpen(prev => !prev)}
                    >
                      <svg className={finalOpen ? 'open' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <span>Final results</span>
                    </button>

                    {finalOpen && (
                      <div className="tree-section__items">
                        {visibleCategories.map(({ cat, subs }) => {
                          const isExpanded = !!term || expandedCategories[cat.key];
                          return (
                            <div key={cat.key} className="tree-subgroup">
                              <button
                                type="button"
                                className="tree-subgroup__header"
                                aria-expanded={isExpanded}
                                disabled={!!term}
                                onClick={() => toggleCategory(cat.key)}
                              >
                                <svg className={isExpanded ? 'open' : ''} style={{ transform: isExpanded ? 'rotate(90deg)' : undefined, transition: 'transform var(--transition-fast)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <polyline points="9 18 15 12 9 6" />
                                </svg>
                                <span>{cat.label}</span>
                              </button>

                              {isExpanded && (
                                <div className="tree-subgroup__children">
                                  {subs.map(sub => {
                                    const isActive =
                                      selection.kind === 'param' &&
                                      selection.category === cat.key &&
                                      selection.subView === sub.key;
                                    return (
                                      <button
                                        key={sub.key}
                                        type="button"
                                        className={`tree-item ${isActive ? 'active' : ''}`}
                                        aria-current={isActive ? 'page' : undefined}
                                        onClick={() =>
                                          setSelection({
                                            kind: 'param',
                                            category: cat.key,
                                            subView: sub.key,
                                          })
                                        }
                                      >
                                        <span>{sub.label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {showSettings && (
                  <div className="tree-section">
                    <button
                      type="button"
                      className="tree-section__header tree-section__toggle"
                      aria-expanded={algoOpen}
                      disabled={!!term}
                      onClick={() => setAlgorithmOpen(prev => !prev)}
                    >
                      <svg className={algoOpen ? 'open' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <span>Calculation</span>
                    </button>

                    {algoOpen && (
                      <div className="tree-section__items">
                        <button
                          type="button"
                          className={`tree-item ${selection.kind === 'setting' ? 'active' : ''}`}
                          aria-current={selection.kind === 'setting' ? 'page' : undefined}
                          onClick={() => setSelection({ kind: 'setting' })}
                        >
                          <span>Setting</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </aside>

      <main className="results-main">
        <div className="report-header">
          <div className="report-header__top" style={{ alignItems: 'center' }}>
            <div>
              <h1 className="report-header__title">
                <span>{currentTitle}</span>
              </h1>
              <p className="report-header__subtitle">
                {groupA} (n = {report.nA}) vs {groupB} (n = {report.nB}) · {report.subsamplesRequested.toLocaleString()} subsamples · α = {alpha} ({report.testType})
              </p>
            </div>
            <TableExportBar payload={activeTable.exportPayload} />
          </div>
        </div>

        <div className="table-container">
          {selection.kind === 'setting' ? (
            <div className="scientific-table-wrap">
              <table className="scientific-table">
                <thead>
                  <tr>
                    <th>Setting</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {settingRows.map(([k, v], idx) => (
                    <tr key={idx}>
                      <td>{k}</td>
                      <td>{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="scientific-table-wrap">
              <table className="scientific-table scientific-table--sticky-first">
                <thead>
                  <tr>
                    {activeTable.headers.map((h, idx) => (
                      <th
                        key={idx}
                        style={idx === 0 ? { minWidth: '180px' } : { textAlign: 'right' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeTable.displayRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={activeTable.headers.length}
                        style={{
                          textAlign: 'center',
                          padding: '28px',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        No parameters available for this model section.
                      </td>
                    </tr>
                  ) : (
                    activeTable.displayRows.map(row => (
                      <tr key={row.key}>
                        <td>{row.parameter}</td>
                        {row.cells.map((cell, cIdx) => {
                          const hasVal = typeof cell.raw === 'number' && Number.isFinite(cell.raw);
                          const cellClass =
                            cell.isP && typeof cell.sig === 'boolean' && hasVal
                              ? cell.sig
                                ? 'cell-sig--p05 cell-value'
                                : 'cell-ns'
                              : undefined;
                          return (
                            <td
                              key={cIdx}
                              className={cellClass}
                              title={hasVal ? String(cell.raw) : undefined}
                              style={{ textAlign: 'right' }}
                            >
                              {hasVal ? fmt(cell.raw) : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="results-footer">
          <div className="results-footer__left">
            <span>
              {groupA} (n = <strong>{report.nA}</strong>) vs {groupB} (n = <strong>{report.nB}</strong>)
            </span>
            <span className="results-footer__sep">·</span>
            <span>{report.subsamplesRequested.toLocaleString()} subsamples</span>
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
