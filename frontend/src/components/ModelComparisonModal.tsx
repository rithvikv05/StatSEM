import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../utils/api';
import { X, GitCompare, Trophy, Check, Download, Copy, AlertCircle } from 'lucide-react';

interface ModelComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
  initialSnapshotId?: string;
  studyName?: string;
}

export const ModelComparisonModal: React.FC<ModelComparisonModalProps> = ({
  isOpen,
  onClose,
  projectPath,
  initialSnapshotId,
  studyName = 'Study',
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [snapshotDetails, setSnapshotDetails] = useState<Record<string, any>>({});
  const [copied, setCopied] = useState<boolean>(false);

  // 1. Fetch snapshot list on open
  useEffect(() => {
    if (!isOpen || !projectPath) return;

    let active = true;
    setLoading(true);

    api.listSnapshots(projectPath).then(async (snaps) => {
      if (!active) return;
      if (Array.isArray(snaps)) {
        setSnapshots(snaps);

        // Preselect initial snapshot + second snapshot if available
        const preselected: string[] = [];
        if (initialSnapshotId && snaps.some(s => s.id === initialSnapshotId)) {
          preselected.push(initialSnapshotId);
        }
        for (const s of snaps) {
          if (preselected.length >= 2) break;
          if (!preselected.includes(s.id)) {
            preselected.push(s.id);
          }
        }
        setSelectedIds(preselected);

        // Load details for preselected snapshots
        const detailsMap: Record<string, any> = {};
        for (const id of preselected) {
          const detail = await api.getSnapshot(projectPath, id);
          if (detail && !detail.error) {
            detailsMap[id] = detail;
          }
        }
        if (active) {
          setSnapshotDetails(detailsMap);
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    }).catch(err => {
      if (active) setLoading(false);
      console.error('Failed to list snapshots for comparison:', err);
    });

    return () => {
      active = false;
    };
  }, [isOpen, projectPath, initialSnapshotId]);

  // Toggle snapshot selection
  const handleToggleSnapshot = async (id: string) => {
    if (selectedIds.includes(id)) {
      if (selectedIds.length <= 2) return; // Maintain at least 2 for comparison
      setSelectedIds(prev => prev.filter(x => x !== id));
    } else {
      if (selectedIds.length >= 5) return; // Cap at 5 for side-by-side readability
      setSelectedIds(prev => [...prev, id]);
      if (!snapshotDetails[id]) {
        const detail = await api.getSnapshot(projectPath, id);
        if (detail && !detail.error) {
          setSnapshotDetails(prev => ({ ...prev, [id]: detail }));
        }
      }
    }
  };

  // Extract models being compared
  const comparedModels = useMemo(() => {
    return selectedIds.map(id => {
      const snap = snapshots.find(s => s.id === id);
      const detail = snapshotDetails[id] || {};
      const res = detail.results || {};
      const struct = res.structural || {};
      const fit = res.fit || {};
      const qual = res.quality_criteria || {};

      return {
        id,
        name: snap?.name || detail.name || id,
        timestamp: snap?.timestamp || detail.timestamp,
        results: res,
        struct,
        fit,
        qual,
      };
    });
  }, [selectedIds, snapshots, snapshotDetails]);

  // Collect all unique endogenous constructs across all models
  const allEndogenous = useMemo(() => {
    const set = new Set<string>();
    comparedModels.forEach(m => {
      const r2 = m.struct.r_squared || {};
      Object.keys(r2).forEach(k => set.add(k));
    });
    return Array.from(set);
  }, [comparedModels]);

  // Collect all unique structural paths across all models
  const allPaths = useMemo(() => {
    const pathKeys = new Set<string>();
    comparedModels.forEach(m => {
      const paths = m.struct.path_coefficients || {};
      Object.entries(paths).forEach(([tgt, preds]: [string, any]) => {
        if (typeof preds === 'object' && preds !== null) {
          Object.keys(preds).forEach(src => pathKeys.add(`${src}->${tgt}`));
        }
      });
    });
    return Array.from(pathKeys);
  }, [comparedModels]);

  if (!isOpen) return null;

  const fmt = (v: any, decimals = 3) => {
    if (v === undefined || v === null || isNaN(Number(v))) return '—';
    return Number(v).toFixed(decimals);
  };

  // Determine winner for a metric (lower is better for SRMR, AIC, BIC; higher is better for R2)
  const getBestMetricId = (keyPath: string, lowerIsBetter: boolean) => {
    let bestVal = lowerIsBetter ? Infinity : -Infinity;
    let bestId: string | null = null;

    comparedModels.forEach(m => {
      let val: number | undefined;
      if (keyPath === 'srmr') {
        val = m.fit?.srmr ?? m.fit?.saturated_model?.srmr;
      } else if (keyPath === 'aic') {
        val = m.fit?.aic ?? m.fit?.information_criteria?.aic;
      } else if (keyPath === 'bic') {
        val = m.fit?.bic ?? m.fit?.information_criteria?.bic;
      }

      if (val !== undefined && !isNaN(val)) {
        if (lowerIsBetter && val < bestVal) {
          bestVal = val;
          bestId = m.id;
        } else if (!lowerIsBetter && val > bestVal) {
          bestVal = val;
          bestId = m.id;
        }
      }
    });

    return bestId;
  };

  const bestSrmrId = getBestMetricId('srmr', true);
  const bestAicId = getBestMetricId('aic', true);
  const bestBicId = getBestMetricId('bic', true);

  const handleCopyComparison = async () => {
    try {
      const headers = ['Metric', ...comparedModels.map(m => m.name)].join('\t');
      const rows: string[] = [];

      // SRMR
      rows.push(['SRMR', ...comparedModels.map(m => fmt(m.fit?.srmr ?? m.fit?.saturated_model?.srmr))].join('\t'));

      // R2
      allEndogenous.forEach(c => {
        rows.push([`R² (${c})`, ...comparedModels.map(m => fmt(m.struct.r_squared?.[c]))].join('\t'));
      });

      // Paths
      allPaths.forEach(p => {
        const [src, tgt] = p.split('->');
        rows.push([`Path ${src} -> ${tgt}`, ...comparedModels.map(m => fmt(m.struct.path_coefficients?.[tgt]?.[src]))].join('\t'));
      });

      const fullText = [headers, ...rows].join('\n');
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy comparison:', err);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(15, 23, 42, 0.72)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      padding: 24,
    }}>
      <div style={{
        background: 'var(--color-bg-surface, #ffffff)',
        color: 'var(--color-text-primary, #0f172a)',
        borderRadius: 14,
        width: '100%',
        maxWidth: 1040,
        boxShadow: '0 24px 48px rgba(0, 0, 0, 0.3)',
        border: '1px solid var(--color-border-subtle, #e2e8f0)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '92vh',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid var(--color-border-subtle, #e2e8f0)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'rgba(99, 102, 241, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-accent, #6366f1)',
            }}>
              <GitCompare size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                Multi-Model Comparison &amp; Benchmarking Matrix
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted, #64748b)' }}>
                Side-by-side evaluation of competing theoretical models across explanatory power, information criteria, and fit.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="results-tool-btn results-tool-btn--accent"
              onClick={handleCopyComparison}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied Matrix!' : 'Copy Matrix'}
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted, #64748b)',
                padding: 6,
                borderRadius: 6,
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Snapshot Selector Chips */}
        <div style={{
          padding: '12px 24px',
          background: 'var(--color-bg-base, #f8fafc)',
          borderBottom: '1px solid var(--color-border-subtle, #e2e8f0)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted, #64748b)' }}>
            Select Competing Snapshots ({selectedIds.length}/5):
          </span>
          {snapshots.map(s => {
            const isSelected = selectedIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handleToggleSnapshot(s.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: isSelected ? '1.5px solid var(--color-accent, #6366f1)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                  background: isSelected ? 'rgba(99, 102, 241, 0.1)' : 'var(--color-bg-surface, #ffffff)',
                  color: isSelected ? 'var(--color-accent, #6366f1)' : 'var(--color-text-primary, #0f172a)',
                  transition: 'all 0.15s ease',
                }}
              >
                {isSelected && <Check size={12} />}
                <span>{s.name}</span>
              </button>
            );
          })}
        </div>

        {/* Body Matrix Table */}
        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted, #94a3b8)' }}>
              Loading model snapshots...
            </div>
          ) : comparedModels.length < 2 ? (
            <div style={{
              textAlign: 'center',
              padding: '60px 20px',
              color: 'var(--color-text-muted, #94a3b8)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}>
              <AlertCircle size={32} />
              <div style={{ fontSize: 15, fontWeight: 600 }}>At least 2 snapshots are required for comparison</div>
              <p style={{ margin: 0, fontSize: 13 }}>Please select two or more model snapshots using the chips above.</p>
            </div>
          ) : (
            <div style={{
              background: 'var(--color-bg-surface, #ffffff)',
              borderRadius: 10,
              border: '1px solid var(--color-border-subtle, #e2e8f0)',
              overflowX: 'auto',
            }}>
              <table className="scientific-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg-base, #f8fafc)' }}>
                    <th style={{ width: '280px', textAlign: 'left', padding: '10px 14px' }}>Evaluation Metric / Criterion</th>
                    {comparedModels.map((m, idx) => (
                      <th key={m.id} style={{ textAlign: 'center', padding: '10px 14px' }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{m.name}</div>
                        <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-muted, #64748b)' }}>
                          {idx === 0 ? 'Baseline Model' : `Alternative Model ${idx}`}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Category: Global Model Fit */}
                  <tr style={{ background: 'rgba(99, 102, 241, 0.04)' }}>
                    <td colSpan={comparedModels.length + 1} style={{ fontWeight: 700, fontSize: 12, padding: '8px 14px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-accent, #6366f1)' }}>
                      1. Global Model Fit &amp; Discrepancy Measures
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 14px' }}>
                      <strong>SRMR</strong> (Standardized Root Mean Square Residual &lt; 0.08)
                    </td>
                    {comparedModels.map(m => {
                      const val = m.fit?.srmr ?? m.fit?.saturated_model?.srmr;
                      const isBest = m.id === bestSrmrId;
                      return (
                        <td key={m.id} style={{ textAlign: 'center', padding: '8px 14px' }}>
                          <span style={{ fontWeight: 600, color: val && val < 0.08 ? '#10b981' : 'inherit' }}>
                            {fmt(val)}
                          </span>
                          {isBest && (
                            <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.15)', color: '#059669', fontWeight: 700 }}>
                              Best Fit
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 14px' }}><strong>d_ULS</strong> (Unweighted Least Squares Discrepancy)</td>
                    {comparedModels.map(m => (
                      <td key={m.id} style={{ textAlign: 'center', padding: '8px 14px' }}>
                        {fmt(m.fit?.d_uls ?? m.fit?.saturated_model?.d_uls)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 14px' }}><strong>d_G</strong> (Geodesic Discrepancy)</td>
                    {comparedModels.map(m => (
                      <td key={m.id} style={{ textAlign: 'center', padding: '8px 14px' }}>
                        {fmt(m.fit?.d_g ?? m.fit?.saturated_model?.d_g)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 14px' }}><strong>NFI</strong> (Normed Fit Index &gt; 0.90)</td>
                    {comparedModels.map(m => (
                      <td key={m.id} style={{ textAlign: 'center', padding: '8px 14px' }}>
                        {fmt(m.fit?.nfi ?? m.fit?.saturated_model?.nfi)}
                      </td>
                    ))}
                  </tr>

                  {/* Category: Explanatory Power */}
                  <tr style={{ background: 'rgba(99, 102, 241, 0.04)' }}>
                    <td colSpan={comparedModels.length + 1} style={{ fontWeight: 700, fontSize: 12, padding: '8px 14px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-accent, #6366f1)' }}>
                      2. Explanatory Power (Coefficients of Determination R²)
                    </td>
                  </tr>
                  {allEndogenous.map(c => {
                    // Find model with maximum R2
                    let maxR2 = -1;
                    let bestModelId = '';
                    comparedModels.forEach(m => {
                      const r2Val = m.struct.r_squared?.[c];
                      if (r2Val !== undefined && r2Val > maxR2) {
                        maxR2 = r2Val;
                        bestModelId = m.id;
                      }
                    });

                    return (
                      <tr key={c}>
                        <td style={{ padding: '8px 14px' }}>
                          <strong>R²: {c}</strong>
                        </td>
                        {comparedModels.map((m, idx) => {
                          const r2 = m.struct.r_squared?.[c];
                          const baselineR2 = comparedModels[0].struct.r_squared?.[c];
                          const delta = (idx > 0 && r2 !== undefined && baselineR2 !== undefined) ? r2 - baselineR2 : null;
                          const isBest = m.id === bestModelId && comparedModels.length > 1;

                          return (
                            <td key={m.id} style={{ textAlign: 'center', padding: '8px 14px' }}>
                              <span style={{ fontWeight: 700, fontSize: 13.5 }}>
                                {fmt(r2)}
                              </span>
                              {delta !== null && (
                                <div style={{
                                  fontSize: 10.5,
                                  fontWeight: 600,
                                  color: delta > 0 ? '#10b981' : (delta < 0 ? '#ef4444' : 'var(--color-text-muted)'),
                                  marginTop: 2,
                                }}>
                                  {delta > 0 ? `+${fmt(delta)}` : fmt(delta)} vs Baseline
                                </div>
                              )}
                              {isBest && (
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                  fontSize: 10,
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  background: 'rgba(99, 102, 241, 0.12)',
                                  color: 'var(--color-accent)',
                                  fontWeight: 700,
                                  marginTop: 3,
                                }}>
                                  <Trophy size={10} />
                                  Highest R²
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}

                  {/* Category: Information Criteria (Parsimony) */}
                  <tr style={{ background: 'rgba(99, 102, 241, 0.04)' }}>
                    <td colSpan={comparedModels.length + 1} style={{ fontWeight: 700, fontSize: 12, padding: '8px 14px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-accent, #6366f1)' }}>
                      3. Information Criteria (Parsimony &amp; Model Selection)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 14px' }}><strong>AIC</strong> (Akaike Information Criterion - Lower is better)</td>
                    {comparedModels.map(m => {
                      const val = m.fit?.aic ?? m.fit?.information_criteria?.aic;
                      const isBest = m.id === bestAicId;
                      return (
                        <td key={m.id} style={{ textAlign: 'center', padding: '8px 14px' }}>
                          <span style={{ fontWeight: 600 }}>{fmt(val)}</span>
                          {isBest && (
                            <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.15)', color: '#059669', fontWeight: 700 }}>
                              Best Parsimony
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 14px' }}><strong>BIC</strong> (Bayesian Information Criterion - Lower is better)</td>
                    {comparedModels.map(m => {
                      const val = m.fit?.bic ?? m.fit?.information_criteria?.bic;
                      const isBest = m.id === bestBicId;
                      return (
                        <td key={m.id} style={{ textAlign: 'center', padding: '8px 14px' }}>
                          <span style={{ fontWeight: 600 }}>{fmt(val)}</span>
                          {isBest && (
                            <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.15)', color: '#059669', fontWeight: 700 }}>
                              Best Parsimony
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Category: Key Structural Relationships */}
                  <tr style={{ background: 'rgba(99, 102, 241, 0.04)' }}>
                    <td colSpan={comparedModels.length + 1} style={{ fontWeight: 700, fontSize: 12, padding: '8px 14px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-accent, #6366f1)' }}>
                      4. Structural Path Coefficients Comparison (β)
                    </td>
                  </tr>
                  {allPaths.map(p => {
                    const [src, tgt] = p.split('->');
                    return (
                      <tr key={p}>
                        <td style={{ padding: '8px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                            <span>{src}</span>
                            <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>→</span>
                            <span>{tgt}</span>
                          </div>
                        </td>
                        {comparedModels.map(m => {
                          const beta = m.struct.path_coefficients?.[tgt]?.[src];
                          return (
                            <td key={m.id} style={{ textAlign: 'center', padding: '8px 14px' }}>
                              {beta !== undefined ? (
                                <span style={{ fontWeight: 600 }}>{fmt(beta)}</span>
                              ) : (
                                <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>Excluded</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--color-border-subtle, #e2e8f0)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--color-bg-surface, #ffffff)',
        }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Comparing {comparedModels.length} models across explanatory power and information-theoretic criteria.
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--color-accent, #6366f1)',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Close Comparison
          </button>
        </div>
      </div>
    </div>
  );
};
