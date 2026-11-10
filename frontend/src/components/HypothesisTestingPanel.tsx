import React, { useState, useMemo } from 'react';

interface HypothesisTestingPanelProps {
  results: any;
  model?: any;
  onExportExcel?: () => void;
}

interface HypothesisRow {
  id: string;
  label: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  direction: '+' | '-' | '+/-';
  beta: number;
  mean?: number;
  se?: number;
  tStat?: number;
  pValue?: number;
  ciLow?: number;
  ciHigh?: number;
  f2?: number;
  vif?: number;
  supported: 'Supported' | 'Not Supported' | 'Pending Bootstrapping';
}

export const HypothesisTestingPanel: React.FC<HypothesisTestingPanelProps> = ({
  results,
  model,
  onExportExcel,
}) => {
  const [copied, setCopied] = useState(false);
  const [directions, setDirections] = useState<Record<string, '+' | '-' | '+/-'>>({});
  const [customLabels, setCustomLabels] = useState<Record<string, string>>({});

  // Helper to resolve construct display names
  const constructNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (model?.nodes) {
      model.nodes.forEach((n: any) => {
        if (n.id) map[n.id] = n.name || n.label || n.id;
      });
    }
    return map;
  }, [model]);

  const getName = (id: string) => constructNameMap[id] || id;

  // Extract hypothesis rows from results
  const hypotheses: HypothesisRow[] = useMemo(() => {
    if (!results) return [];

    const rows: HypothesisRow[] = [];
    const struct = results.structural || {};
    const sig = results.significance || {};
    const qual = results.quality_criteria || {};
    const f2Map = qual.f_squared || struct.f_squared || {};
    const vifMap = qual.inner_vif || struct.inner_vif || {};
    const params = sig.parameters || {};

    // 1. If sig.paths is populated (standard bootstrap output)
    if (Array.isArray(sig.paths) && sig.paths.length > 0) {
      sig.paths.forEach((p: any, idx: number) => {
        const from = p.from;
        const to = p.to;
        const key = `${from}->${to}`;
        const defaultLabel = `H${idx + 1}`;
        const dir = directions[key] || '+';

        // lookup f2 (could be indexed [to][from] or [from][to])
        const f2 = f2Map[to]?.[from] ?? f2Map[from]?.[to];
        const vif = vifMap[to]?.[from] ?? vifMap[from]?.[to];

        const beta = p.original ?? 0;
        const pVal = p.p_value;
        const isSignificant = pVal !== undefined && pVal < 0.05;

        let supported: 'Supported' | 'Not Supported' | 'Pending Bootstrapping' = 'Not Supported';
        if (pVal === undefined) {
          supported = 'Pending Bootstrapping';
        } else if (dir === '+') {
          supported = isSignificant && beta > 0 ? 'Supported' : 'Not Supported';
        } else if (dir === '-') {
          supported = isSignificant && beta < 0 ? 'Supported' : 'Not Supported';
        } else {
          supported = isSignificant ? 'Supported' : 'Not Supported';
        }

        rows.push({
          id: key,
          label: customLabels[key] || defaultLabel,
          from,
          to,
          fromName: p.from_name || getName(from),
          toName: p.to_name || getName(to),
          direction: dir,
          beta,
          mean: p.mean,
          se: p.se,
          tStat: p.t_stat,
          pValue: pVal,
          ciLow: p.ci_low ?? p.ci_percentile?.[0] ?? p.ci_bca?.[0],
          ciHigh: p.ci_high ?? p.ci_percentile?.[1] ?? p.ci_bca?.[1],
          f2,
          vif,
          supported,
        });
      });
      return rows;
    }

    // 2. Fallback to path_coefficients matrix
    const pathCoeffs = struct.path_coefficients || results.path_coefficients || {};
    let count = 1;

    Object.entries(pathCoeffs).forEach(([target, preds]: [string, any]) => {
      if (typeof preds === 'object' && preds !== null) {
        Object.entries(preds).forEach(([source, betaVal]: [string, any]) => {
          const from = source;
          const to = target;
          const key = `${from}->${to}`;
          const defaultLabel = `H${count++}`;
          const dir = directions[key] || '+';

          const paramKey = `path:${from}->${to}`;
          const pData = params[paramKey] || {};

          const f2 = f2Map[to]?.[from] ?? f2Map[from]?.[to];
          const vif = vifMap[to]?.[from] ?? vifMap[from]?.[to];

          const beta = Number(betaVal);
          const pVal = pData.p_value;
          const isSignificant = pVal !== undefined && pVal < 0.05;

          let supported: 'Supported' | 'Not Supported' | 'Pending Bootstrapping' = 'Pending Bootstrapping';
          if (pVal !== undefined) {
            if (dir === '+') {
              supported = isSignificant && beta > 0 ? 'Supported' : 'Not Supported';
            } else if (dir === '-') {
              supported = isSignificant && beta < 0 ? 'Supported' : 'Not Supported';
            } else {
              supported = isSignificant ? 'Supported' : 'Not Supported';
            }
          }

          rows.push({
            id: key,
            label: customLabels[key] || defaultLabel,
            from,
            to,
            fromName: getName(from),
            toName: getName(to),
            direction: dir,
            beta,
            mean: pData.mean,
            se: pData.se,
            tStat: pData.t_stat,
            pValue: pVal,
            ciLow: pData.ci_low ?? pData.ci_percentile?.[0],
            ciHigh: pData.ci_high ?? pData.ci_percentile?.[1],
            f2,
            vif,
            supported,
          });
        });
      }
    });

    return rows;
  }, [results, model, directions, customLabels, constructNameMap]);

  const getEffectSizeRating = (f2: number | undefined) => {
    if (f2 === undefined || isNaN(f2)) return '—';
    if (f2 >= 0.35) return 'Large';
    if (f2 >= 0.15) return 'Medium';
    if (f2 >= 0.02) return 'Small';
    return 'None';
  };

  const fmt = (v: number | undefined, decimals = 3) => {
    if (v === undefined || v === null || isNaN(v)) return '—';
    return v.toFixed(decimals);
  };

  const handleDirectionChange = (id: string, newDir: '+' | '-' | '+/-') => {
    setDirections(prev => ({ ...prev, [id]: newDir }));
  };

  const handleLabelChange = (id: string, newLabel: string) => {
    setCustomLabels(prev => ({ ...prev, [id]: newLabel }));
  };

  // 1-Click APA 7th Table Copy to Clipboard
  const handleCopyApaTable = async () => {
    try {
      // Build APA HTML Table
      const html = `
        <table style="border-collapse: collapse; font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: #000; width: 100%;">
          <caption style="text-align: left; font-style: italic; margin-bottom: 6px; font-weight: bold;">
            Table. Structural Model Assessment and Hypotheses Testing Summary
          </caption>
          <thead>
            <tr style="border-top: 1.5pt solid black; border-bottom: 1pt solid black;">
              <th style="padding: 6px 8px; text-align: left;">Hypothesis</th>
              <th style="padding: 6px 8px; text-align: left;">Structural Relationship</th>
              <th style="padding: 6px 8px; text-align: center;">Direct.</th>
              <th style="padding: 6px 8px; text-align: right;">Std. Beta (β)</th>
              <th style="padding: 6px 8px; text-align: right;">Sample Mean</th>
              <th style="padding: 6px 8px; text-align: right;">Std. Error</th>
              <th style="padding: 6px 8px; text-align: right;">t-Value</th>
              <th style="padding: 6px 8px; text-align: right;">p-Value</th>
              <th style="padding: 6px 8px; text-align: center;">95% BCa CI</th>
              <th style="padding: 6px 8px; text-align: right;">f²</th>
              <th style="padding: 6px 8px; text-align: left;">Effect Size</th>
              <th style="padding: 6px 8px; text-align: center;">Decision</th>
            </tr>
          </thead>
          <tbody>
            ${hypotheses.map(h => `
              <tr style="border-bottom: 0.5pt solid #ddd;">
                <td style="padding: 5px 8px; font-weight: bold;">${h.label}</td>
                <td style="padding: 5px 8px;">${h.fromName} → ${h.toName}</td>
                <td style="padding: 5px 8px; text-align: center;">${h.direction}</td>
                <td style="padding: 5px 8px; text-align: right;">${fmt(h.beta, 3)}</td>
                <td style="padding: 5px 8px; text-align: right;">${fmt(h.mean, 3)}</td>
                <td style="padding: 5px 8px; text-align: right;">${fmt(h.se, 3)}</td>
                <td style="padding: 5px 8px; text-align: right;">${fmt(h.tStat, 3)}</td>
                <td style="padding: 5px 8px; text-align: right;">${h.pValue !== undefined ? (h.pValue < 0.001 ? '< .001' : fmt(h.pValue, 3)) : '—'}</td>
                <td style="padding: 5px 8px; text-align: center;">[${fmt(h.ciLow, 3)}, ${fmt(h.ciHigh, 3)}]</td>
                <td style="padding: 5px 8px; text-align: right;">${fmt(h.f2, 3)}</td>
                <td style="padding: 5px 8px;">${getEffectSizeRating(h.f2)}</td>
                <td style="padding: 5px 8px; text-align: center; font-weight: bold;">${h.supported}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr style="border-top: 1.5pt solid black;">
              <td colspan="12" style="padding-top: 6px; font-size: 9.5pt; font-style: italic; color: #333;">
                Note. N = ${results?.sample_size || '—'}. Bootstrap resamples = 5,000. BCa CI = Bias-corrected and accelerated confidence interval. *p &lt; .05, **p &lt; .01, ***p &lt; .001. Decision based on α = .05 (one-tailed or two-tailed as indicated).
              </td>
            </tr>
          </tfoot>
        </table>
      `;

      // Build Plain Text Tab-Delimited
      const text = [
        'Hypothesis\tStructural Relationship\tDirect.\tStd. Beta (β)\tSample Mean\tStd. Error\tt-Value\tp-Value\t95% BCa CI\tf²\tEffect Size\tDecision',
        ...hypotheses.map(h =>
          `${h.label}\t${h.fromName} -> ${h.toName}\t${h.direction}\t${fmt(h.beta, 3)}\t${fmt(h.mean, 3)}\t${fmt(h.se, 3)}\t${fmt(h.tStat, 3)}\t${h.pValue !== undefined ? fmt(h.pValue, 3) : '—'}\t[${fmt(h.ciLow, 3)}, ${fmt(h.ciHigh, 3)}]\t${fmt(h.f2, 3)}\t${getEffectSizeRating(h.f2)}\t${h.supported}`
        ),
      ].join('\n');

      if (navigator.clipboard && window.ClipboardItem) {
        const textBlob = new Blob([text], { type: 'text/plain' });
        const htmlBlob = new Blob([html], { type: 'text/html' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': textBlob,
            'text/html': htmlBlob,
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }

      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy APA table:', err);
    }
  };

  const supportedCount = hypotheses.filter(h => h.supported === 'Supported').length;
  const notSupportedCount = hypotheses.filter(h => h.supported === 'Not Supported').length;

  return (
    <div className="results-content-pane" style={{ animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Banner / Actions */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              Automated Hypothesis Testing Summary Table
            </h3>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 6,
              background: 'rgba(99, 102, 241, 0.1)',
              color: 'var(--color-accent)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
            }}>
              APA 7th Ready
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Empirical evaluation of hypothesized structural relationships with significance testing, 95% BCa CIs, and Cohen's effect sizes.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="results-tool-btn results-tool-btn--accent"
            onClick={handleCopyApaTable}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {copied ? (
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </>
              )}
            </svg>
            {copied ? 'Copied APA Table!' : 'Copy APA 7th Table'}
          </button>

          {onExportExcel && (
            <button
              type="button"
              className="results-tool-btn"
              onClick={onExportExcel}
            >
              Export Excel
            </button>
          )}
        </div>
      </div>

      {/* Overview Stat Badges */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 20,
      }}>
        <div style={{
          padding: '12px 16px',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Total Hypotheses</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', marginTop: 2 }}>
            {hypotheses.length}
          </div>
        </div>

        <div style={{
          padding: '12px 16px',
          background: 'rgba(16, 185, 129, 0.05)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>Supported Hypotheses</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#10b981', marginTop: 2 }}>
            {supportedCount} <span style={{ fontSize: 13, fontWeight: 500 }}>({hypotheses.length > 0 ? Math.round((supportedCount / hypotheses.length) * 100) : 0}%)</span>
          </div>
        </div>

        <div style={{
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.05)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>Not Supported</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444', marginTop: 2 }}>
            {notSupportedCount}
          </div>
        </div>

        <div style={{
          padding: '12px 16px',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Significance Threshold</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 6 }}>
            α = 0.05 (95% CI)
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div style={{
        overflowX: 'auto',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
      }}>
        <table className="scientific-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ width: '60px' }}>Hyp.</th>
              <th>Structural Relationship</th>
              <th style={{ textAlign: 'center', width: '75px' }}>Direct.</th>
              <th style={{ textAlign: 'right' }}>Std. β</th>
              <th style={{ textAlign: 'right' }}>Mean</th>
              <th style={{ textAlign: 'right' }}>SE</th>
              <th style={{ textAlign: 'right' }}>t-Stat</th>
              <th style={{ textAlign: 'right' }}>p-Value</th>
              <th style={{ textAlign: 'center' }}>95% BCa CI</th>
              <th style={{ textAlign: 'right' }}>f²</th>
              <th>Effect Size</th>
              <th style={{ textAlign: 'center', width: '120px' }}>Decision</th>
            </tr>
          </thead>
          <tbody>
            {hypotheses.length === 0 ? (
              <tr>
                <td colSpan={12} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--color-text-muted)' }}>
                  No structural relationships detected in current model.
                </td>
              </tr>
            ) : (
              hypotheses.map((h) => {
                const isSig = h.pValue !== undefined && h.pValue < 0.05;
                const isVerySig = h.pValue !== undefined && h.pValue < 0.001;

                return (
                  <tr key={h.id}>
                    <td>
                      <input
                        type="text"
                        value={h.label}
                        onChange={(e) => handleLabelChange(h.id, e.target.value)}
                        style={{
                          width: '42px',
                          padding: '2px 4px',
                          fontSize: 12,
                          fontWeight: 700,
                          textAlign: 'center',
                          borderRadius: 4,
                          border: '1px solid var(--color-border-subtle)',
                          background: 'var(--color-bg-base)',
                          color: 'var(--color-text-primary)',
                        }}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                        <span>{h.fromName}</span>
                        <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>→</span>
                        <span>{h.toName}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <select
                        value={h.direction}
                        onChange={(e) => handleDirectionChange(h.id, e.target.value as any)}
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '2px 4px',
                          borderRadius: 4,
                          border: '1px solid var(--color-border-subtle)',
                          background: 'var(--color-bg-base)',
                          color: 'var(--color-text-primary)',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="+">(+) Pos</option>
                        <option value="-">(-) Neg</option>
                        <option value="+/-">(±) Two</option>
                      </select>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: h.beta >= 0 ? 'var(--color-text-primary)' : '#ef4444' }}>
                      {fmt(h.beta, 3)}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                      {fmt(h.mean, 3)}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                      {fmt(h.se, 3)}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {h.tStat !== undefined ? (
                        <span style={{ color: (h.tStat >= 1.96 || h.tStat <= -1.96) ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                          {fmt(h.tStat, 3)}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {h.pValue !== undefined ? (
                        <span style={{
                          fontWeight: 600,
                          color: isVerySig ? '#10b981' : (isSig ? '#059669' : 'var(--color-text-muted)'),
                        }}>
                          {h.pValue < 0.001 ? '< .001' : fmt(h.pValue, 3)}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Pending Boot</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', fontSize: 12, fontFamily: 'monospace' }}>
                      {h.ciLow !== undefined && h.ciHigh !== undefined ? (
                        <span>[{fmt(h.ciLow, 3)}, {fmt(h.ciHigh, 3)}]</span>
                      ) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 500 }}>
                      {fmt(h.f2, 3)}
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: h.f2 && h.f2 >= 0.15 ? 'rgba(99, 102, 241, 0.12)' : 'var(--color-bg-base)',
                        color: h.f2 && h.f2 >= 0.15 ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        fontWeight: 600,
                      }}>
                        {getEffectSizeRating(h.f2)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {h.supported === 'Supported' ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 8px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 700,
                          background: 'rgba(16, 185, 129, 0.12)',
                          color: '#059669',
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                        }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Supported
                        </span>
                      ) : h.supported === 'Not Supported' ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 8px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 700,
                          background: 'rgba(239, 68, 68, 0.1)',
                          color: '#dc2626',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                        }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                          Not Supported
                        </span>
                      ) : (
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 600,
                          background: 'var(--color-bg-base)',
                          color: 'var(--color-text-muted)',
                          border: '1px solid var(--color-border-subtle)',
                        }}>
                          Pending Boot
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Academic Citation Note */}
      <div style={{
        marginTop: 16,
        padding: '12px 16px',
        borderRadius: 8,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        fontSize: 12,
        color: 'var(--color-text-muted)',
        lineHeight: 1.6,
      }}>
        <strong>Reporting Standards Note:</strong> Hypotheses decision criteria follow Hair, J. F., Hult, G. T. M., Ringle, C. M., &amp; Sarstedt, M. (2022). <em>A Primer on Partial Least Squares Structural Equation Modeling (PLS-SEM)</em> (3rd ed.). SAGE. Cohen's <em>f</em>² guidelines: 0.02 (small), 0.15 (medium), 0.35 (large). Confidence intervals are 95% bias-corrected and accelerated (BCa) based on 5,000 bootstrap resamples.
      </div>
    </div>
  );
};
