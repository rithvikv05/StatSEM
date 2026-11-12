import React, { useMemo, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { useStore } from '../store';
import type { PermutationReport } from './types';
import { fmt3, TableExportBar, type ExportTablePayload } from './exportUtils';

interface MicomPanelProps {
  report: PermutationReport;
}

type MicomSubTab = 'summary' | 'step1' | 'step2' | 'step3a' | 'step3b';

export const MicomPanel: React.FC<MicomPanelProps> = ({ report }) => {
  const { settings } = useStore();
  const decimalSystem = settings.decimalSystem;
  const f3 = (v: unknown) => fmt3(v, decimalSystem);
  const { micom } = report;

  const [subTab, setSubTab] = useState<MicomSubTab>('summary');

  const alpha = report.significanceLevel || 0.05;
  const loPct = `${((alpha / 2) * 100).toFixed(2)}%`;
  const hiPct = `${((1 - alpha / 2) * 100).toFixed(2)}%`;

  const summaryPayload: ExportTablePayload = useMemo(
    () => ({
      sheetName: 'MICOM Summary',
      title: `MICOM Summary (${report.groupAName} vs ${report.groupBName})`,
      subtitle: `Permutations: ${report.permutationsCompleted} | Seed: ${report.seed}`,
      headers: ['Construct', 'Configural', 'Compositional', 'Equal mean', 'Equal variance', 'Verdict', 'Explanation'],
      rows: micom.summary.map(r => [
        r.constructName,
        r.configural ? 'Yes' : 'No',
        r.compositional ? 'Yes' : 'No',
        r.equalMean === null ? 'N/A' : r.equalMean ? 'Yes' : 'No',
        r.equalVariance === null ? 'N/A' : r.equalVariance ? 'Yes' : 'No',
        r.verdict,
        r.explanation,
      ]),
    }),
    [micom.summary, report]
  );

  const step1Payload: ExportTablePayload = useMemo(
    () => ({
      sheetName: 'MICOM Step 1',
      title: 'MICOM Step 1 — Configural Invariance',
      subtitle: micom.step1.qualitativeNote,
      headers: ['Criterion', 'Status', 'Details'],
      rows: micom.step1.checks.map(c => [c.label, c.passed ? 'Pass' : 'Fail', c.detail]),
    }),
    [micom.step1]
  );

  const step2Payload: ExportTablePayload = useMemo(
    () => ({
      sheetName: 'MICOM Step 2',
      title: 'MICOM Step 2 — Compositional Invariance',
      subtitle: `Original correlation c compared against 5.00% quantile (${report.permutationsCompleted} permutations)`,
      headers: [
        'Construct',
        'Original correlation',
        'Correlation permutation mean',
        '5.00%',
        'Permutation p-value',
        'Compositional invariance',
      ],
      rows: micom.step2.map(r => [
        r.constructName,
        r.originalCorrelation,
        r.singleIndicator ? 'N/A' : r.permutationMean,
        r.singleIndicator ? 'N/A' : r.quantile5Pct,
        r.singleIndicator ? 'N/A' : r.pValue,
        r.singleIndicator ? 'Not applicable (single indicator)' : r.passed ? 'Established' : 'Not established',
      ]),
    }),
    [micom.step2, report.permutationsCompleted]
  );

  const step3aPayload: ExportTablePayload = useMemo(
    () => ({
      sheetName: 'MICOM Step 3a',
      title: `MICOM Step 3a — Equality of Composite Means (${report.groupAName} - ${report.groupBName})`,
      headers: [
        'Construct',
        'Mean original difference (A - B)',
        'Mean permutation mean difference (A - B)',
        loPct,
        hiPct,
        'Permutation p-value',
        'Equal means',
      ],
      rows: micom.step3Means.map(r => [
        r.constructName,
        r.originalDifference,
        r.permutationMeanDifference,
        r.ciLower,
        r.ciUpper,
        r.pValue,
        r.passed ? 'Yes' : 'No',
      ]),
    }),
    [micom.step3Means, report.groupAName, report.groupBName, loPct, hiPct]
  );

  const step3bPayload: ExportTablePayload = useMemo(
    () => ({
      sheetName: 'MICOM Step 3b',
      title: `MICOM Step 3b — Equality of Composite Variances (${report.groupAName} - ${report.groupBName})`,
      headers: [
        'Construct',
        'Variance original difference (A - B)',
        'Variance permutation mean difference (A - B)',
        loPct,
        hiPct,
        'Permutation p-value',
        'Equal variances',
      ],
      rows: micom.step3Variances.map(r => [
        r.constructName,
        r.originalDifference,
        r.permutationMeanDifference,
        r.ciLower,
        r.ciUpper,
        r.pValue,
        r.passed ? 'Yes' : 'No',
      ]),
    }),
    [micom.step3Variances, report.groupAName, report.groupBName, loPct, hiPct]
  );

  const activePayload =
    subTab === 'summary'
      ? summaryPayload
      : subTab === 'step1'
        ? step1Payload
        : subTab === 'step2'
          ? step2Payload
          : subTab === 'step3a'
            ? step3aPayload
            : step3bPayload;

  const tabs: Array<{ id: MicomSubTab; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'step1', label: 'Step 1 (Configural)' },
    { id: 'step2', label: 'Step 2 (Compositional)' },
    { id: 'step3a', label: 'Step 3a (Means)' },
    { id: 'step3b', label: 'Step 3b (Variances)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Sub-tabs bar + Export Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div className="view-toggle" role="tablist" aria-label="MICOM steps">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={subTab === t.id}
              className={`view-toggle__btn ${subTab === t.id ? 'active' : ''}`}
              onClick={() => setSubTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <TableExportBar payload={activePayload} />
      </div>

      {/* Warning banner when Step 2 fails for any construct (§6.2) */}
      {micom.failedCompositionalConstructs.length > 0 && (
        <div className="results-notice results-notice--danger">
          <AlertTriangle size={15} />
          <span>
            Compositional invariance not established for <strong>{micom.failedCompositionalConstructs.join(', ')}</strong>. Group comparison is not recommended. Consider removing items from the construct(s) or removing the construct from the comparison.
          </span>
        </div>
      )}

      {/* Sub-tab 1: Summary */}
      {subTab === 'summary' && (
        <div className="scientific-table-wrap">
          <table className="scientific-table scientific-table--sticky-first">
            <thead>
              <tr>
                <th>Construct</th>
                <th>Configural</th>
                <th>Compositional</th>
                <th>Equal mean</th>
                <th>Equal variance</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {micom.summary.map(row => {
                const verdictClass =
                  row.verdict === 'Full measurement invariance'
                    ? 'sig-badge--p001'
                    : row.verdict === 'Partial measurement invariance'
                      ? 'sig-badge--warn'
                      : 'sig-badge--danger';
                const renderBool = (v: boolean | null) =>
                  v === null ? (
                    <span className="cell-empty">—</span>
                  ) : v ? (
                    <span className="sig-badge sig-badge--p001">Yes</span>
                  ) : (
                    <span className="sig-badge sig-badge--danger">No</span>
                  );
                return (
                  <tr key={row.constructId}>
                    <td>{row.constructName}</td>
                    <td>{renderBool(row.configural)}</td>
                    <td>{renderBool(row.compositional)}</td>
                    <td>{renderBool(row.equalMean)}</td>
                    <td>{renderBool(row.equalVariance)}</td>
                    <td style={{ fontFamily: 'var(--font-sans)', whiteSpace: 'normal' }}>
                      <span className={`sig-badge ${verdictClass}`}>{row.verdict}</span>
                      <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                        {row.explanation}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sub-tab 2: Step 1 (Configural) */}
      {subTab === 'step1' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {micom.step1.stopMessage && (
            <div className="results-notice results-notice--danger">
              {micom.step1.stopMessage}
            </div>
          )}

          <div className="scientific-table-wrap">
            <table className="scientific-table scientific-table--sticky-first">
              <thead>
                <tr>
                  <th>Configural Check</th>
                  <th style={{ width: '90px' }}>Result</th>
                  <th style={{ textAlign: 'left' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {micom.step1.checks.map((c, idx) => (
                  <tr key={idx}>
                    <td>{c.label}</td>
                    <td>
                      {c.passed ? (
                        <span className="sig-badge sig-badge--p001">Pass</span>
                      ) : (
                        <span className="sig-badge sig-badge--danger">Fail</span>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--font-sans)', textAlign: 'left', whiteSpace: 'normal', color: 'var(--color-text-secondary)' }}>
                      {c.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="results-notice">
            <Info size={15} />
            <span>{micom.step1.qualitativeNote}</span>
          </div>
        </div>
      )}

      {/* Sub-tab 3: Step 2 (Compositional) */}
      {subTab === 'step2' && (
        <div className="scientific-table-wrap">
          <table className="scientific-table scientific-table--sticky-first">
            <thead>
              <tr>
                <th>Construct</th>
                <th style={{ textAlign: 'right' }}>Original correlation</th>
                <th style={{ textAlign: 'right' }}>Permutation mean</th>
                <th style={{ textAlign: 'right' }}>5.00% quantile</th>
                <th style={{ textAlign: 'right' }}>Permutation p</th>
                <th>Compositional invariance</th>
              </tr>
            </thead>
            <tbody>
              {micom.step2.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
                    Step 2 was not run because Step 1 (Configural invariance) failed.
                  </td>
                </tr>
              ) : (
                micom.step2.map(r => (
                  <tr key={r.constructId}>
                    <td>{r.constructName}</td>
                    <td style={{ textAlign: 'right' }}>{f3(r.originalCorrelation)}</td>
                    <td style={{ textAlign: 'right' }}>{r.singleIndicator ? 'N/A' : f3(r.permutationMean)}</td>
                    <td style={{ textAlign: 'right' }}>{r.singleIndicator ? 'N/A' : f3(r.quantile5Pct)}</td>
                    <td
                      className={r.singleIndicator ? 'cell-ns' : r.passed ? 'cell-value' : 'cell-sig--p05 cell-value'}
                      style={{ textAlign: 'right' }}
                    >
                      {r.singleIndicator ? 'N/A' : f3(r.pValue)}
                    </td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>
                      {r.singleIndicator ? (
                        <span className="sig-badge sig-badge--ns">
                          {r.note || 'Single indicator'}
                        </span>
                      ) : r.passed ? (
                        <span className="sig-badge sig-badge--p001">Established</span>
                      ) : (
                        <span className="sig-badge sig-badge--danger">Not established</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Sub-tab 4: Step 3a (Means) */}
      {subTab === 'step3a' && (
        <div className="scientific-table-wrap">
          <table className="scientific-table scientific-table--sticky-first">
            <thead>
              <tr>
                <th>Construct</th>
                <th style={{ textAlign: 'right' }}>Mean original diff ({report.groupAName} − {report.groupBName})</th>
                <th style={{ textAlign: 'right' }}>Permutation mean diff</th>
                <th style={{ textAlign: 'right' }}>{loPct}</th>
                <th style={{ textAlign: 'right' }}>{hiPct}</th>
                <th style={{ textAlign: 'right' }}>Permutation p</th>
              </tr>
            </thead>
            <tbody>
              {micom.step3Means.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
                    No constructs passed Step 2 to evaluate equality of composite means.
                  </td>
                </tr>
              ) : (
                micom.step3Means.map(r => (
                  <tr key={r.constructId}>
                    <td>{r.constructName}</td>
                    <td className={r.passed ? undefined : 'cell-sig--p05 cell-value'} style={{ textAlign: 'right' }}>
                      {f3(r.originalDifference)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{f3(r.permutationMeanDifference)}</td>
                    <td style={{ textAlign: 'right' }}>{f3(r.ciLower)}</td>
                    <td style={{ textAlign: 'right' }}>{f3(r.ciUpper)}</td>
                    <td className={r.passed ? 'cell-ns' : 'cell-sig--p05 cell-value'} style={{ textAlign: 'right' }}>
                      {f3(r.pValue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Sub-tab 5: Step 3b (Variances) */}
      {subTab === 'step3b' && (
        <div className="scientific-table-wrap">
          <table className="scientific-table scientific-table--sticky-first">
            <thead>
              <tr>
                <th>Construct</th>
                <th style={{ textAlign: 'right' }}>Variance original diff ({report.groupAName} − {report.groupBName})</th>
                <th style={{ textAlign: 'right' }}>Permutation mean diff</th>
                <th style={{ textAlign: 'right' }}>{loPct}</th>
                <th style={{ textAlign: 'right' }}>{hiPct}</th>
                <th style={{ textAlign: 'right' }}>Permutation p</th>
              </tr>
            </thead>
            <tbody>
              {micom.step3Variances.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
                    No constructs passed Step 2 to evaluate equality of composite variances.
                  </td>
                </tr>
              ) : (
                micom.step3Variances.map(r => (
                  <tr key={r.constructId}>
                    <td>{r.constructName}</td>
                    <td className={r.passed ? undefined : 'cell-sig--p05 cell-value'} style={{ textAlign: 'right' }}>
                      {f3(r.originalDifference)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{f3(r.permutationMeanDifference)}</td>
                    <td style={{ textAlign: 'right' }}>{f3(r.ciLower)}</td>
                    <td style={{ textAlign: 'right' }}>{f3(r.ciUpper)}</td>
                    <td className={r.passed ? 'cell-ns' : 'cell-sig--p05 cell-value'} style={{ textAlign: 'right' }}>
                      {f3(r.pValue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

