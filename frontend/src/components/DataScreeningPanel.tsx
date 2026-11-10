import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { AlertTriangle, CheckCircle, BarChart2, ShieldAlert, FileText, Trash2, RefreshCw } from 'lucide-react';

interface DataScreeningPanelProps {
  projectPath: string;
  datasetId?: string;
  modelId?: string;
  availableModels?: Array<{ id: string; name: string }>;
  datasetName: string;
  totalRows: number;
  variables: Array<{ name: string; scaleType?: string }>;
  onDatasetUpdated?: () => void;
}

export const DataScreeningPanel: React.FC<DataScreeningPanelProps> = ({
  projectPath,
  datasetId,
  modelId,
  availableModels = [],
  datasetName,
  totalRows,
  variables,
  onDatasetUpdated,
}) => {
  const [activeScreeningTab, setActiveScreeningTab] = useState<'missing' | 'patterns' | 'outliers' | 'distributions' | 'directionality'>('missing');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Model selection for directionality
  const [selectedModelId, setSelectedModelId] = useState<string>(modelId || availableModels[0]?.id || '');

  useEffect(() => {
    if (modelId) {
      setSelectedModelId(modelId);
    } else if (availableModels.length > 0 && !selectedModelId) {
      setSelectedModelId(availableModels[0].id);
    }
  }, [modelId, availableModels]);

  // Data states
  const [missingData, setMissingData] = useState<any>(null);
  const [patternsData, setPatternsData] = useState<any>(null);
  const [outliersData, setOutliersData] = useState<any>(null);
  const [distData, setDistData] = useState<any>(null);
  const [directionalityData, setDirectionalityData] = useState<any>(null);

  // Selected column for histogram
  const [selectedHistCol, setSelectedHistCol] = useState<string>(variables[0]?.name || '');
  const [histData, setHistData] = useState<any>(null);
  const [isHistLoading, setIsHistLoading] = useState(false);

  // Action status
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchTabScreening = async (tab: typeof activeScreeningTab) => {
    setIsLoading(true);
    setError(null);
    try {
      if (tab === 'missing') {
        const res = await api.getScreeningMissing(projectPath, datasetId, modelId);
        if (res.error) setError(res.error);
        else setMissingData(res);
      } else if (tab === 'patterns') {
        const res = await api.getScreeningPatterns(projectPath, datasetId, modelId);
        if (res.error) setError(res.error);
        else setPatternsData(res);
      } else if (tab === 'outliers') {
        const res = await api.getScreeningOutliers(projectPath, datasetId);
        if (res.error) setError(res.error);
        else setOutliersData(res);
      } else if (tab === 'distributions') {
        const res = await api.getScreeningDistributions(projectPath, datasetId);
        if (res.error) setError(res.error);
        else setDistData(res);
      } else if (tab === 'directionality') {
        const targetModel = selectedModelId || modelId || availableModels[0]?.id;
        if (!targetModel) {
          // Do not treat lack of model as an error
          setDirectionalityData(null);
        } else {
          const res = await api.getScreeningDirectionality(projectPath, targetModel, datasetId);
          if (res.error) {
            setDirectionalityData(null);
          } else {
            setDirectionalityData(res);
          }
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load screening data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTabScreening(activeScreeningTab);
  }, [activeScreeningTab, projectPath, datasetId, modelId, selectedModelId]);

  // Load histogram when selected column changes
  useEffect(() => {
    if (activeScreeningTab === 'distributions' && selectedHistCol) {
      setIsHistLoading(true);
      api.getScreeningHistogram(projectPath, selectedHistCol, datasetId)
        .then(res => {
          if (!res.error) setHistData(res);
        })
        .finally(() => setIsHistLoading(false));
    }
  }, [activeScreeningTab, selectedHistCol, projectPath, datasetId]);

  const handleRemoveFlagged = async () => {
    if (!window.confirm('Create a new cleaned dataset excluding all cases exceeding the missing threshold?')) return;
    setIsLoading(true);
    try {
      const res = await api.removeFlaggedCases(projectPath, datasetId);
      if (res.error) {
        alert(res.error);
      } else {
        setActionMessage(`Cleaned dataset created (${res.removed_count || 0} cases removed).`);
        if (onDatasetUpdated) onDatasetUpdated();
        fetchTabScreening('missing');
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to clean dataset');
    } finally {
      setIsLoading(false);
    }
  };

  const fmt = (val: any, d = 3) => {
    if (val === undefined || val === null || isNaN(Number(val))) return '—';
    return Number(val).toFixed(d);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--color-bg-base)' }}>
      {/* Top Banner & Tab Navigation */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-surface)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={18} style={{ color: 'var(--color-accent)' }} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Data Screening &amp; Pre-flight Diagnostics
            </h3>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
            Systematic screening for missing values, response straightlining, extreme outliers, non-normality and reverse coding.
          </p>
        </div>

        {/* Screening subtabs */}
        <div style={{
          display: 'inline-flex',
          padding: 3,
          background: 'var(--color-bg-base)',
          borderRadius: 6,
          border: '1px solid var(--color-border-subtle)'
        }}>
          {(['missing', 'patterns', 'outliers', 'distributions', 'directionality'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveScreeningTab(tab)}
              style={{
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: activeScreeningTab === tab ? 600 : 500,
                color: activeScreeningTab === tab ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                background: activeScreeningTab === tab ? 'var(--color-accent-subtle)' : 'transparent',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                textTransform: 'capitalize'
              }}
            >
              {tab === 'missing' && 'Missing Data'}
              {tab === 'patterns' && 'Suspicious Patterns'}
              {tab === 'outliers' && 'Outliers'}
              {tab === 'distributions' && 'Distributions & Normality'}
              {tab === 'directionality' && 'Indicator Directionality'}
            </button>
          ))}
        </div>
      </div>

      {actionMessage && (
        <div style={{
          margin: '12px 24px 0',
          padding: '10px 14px',
          background: 'rgba(22, 163, 74, 0.1)',
          border: '1px solid rgba(22, 163, 74, 0.3)',
          borderRadius: 6,
          color: '#16a34a',
          fontSize: 13,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{actionMessage}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            style={{ background: 'transparent', border: 'none', color: '#16a34a', cursor: 'pointer', fontWeight: 600 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-muted)' }}>
            <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px', color: 'var(--color-accent)' }} />
            <p style={{ margin: 0, fontSize: 13 }}>Analyzing dataset characteristics...</p>
          </div>
        ) : error ? (
          <div style={{
            padding: 16,
            borderRadius: 8,
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            color: '#dc2626',
            fontSize: 13
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Screening Error</div>
            <div>{error}</div>
          </div>
        ) : (
          <>
            {/* 1. MISSING VALUES TAB */}
            {activeScreeningTab === 'missing' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
                  <div style={{ padding: 14, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Cases</div>
                    <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 2px' }}>{missingData?.total_cases ?? totalRows}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Observations inspected</div>
                  </div>
                  <div style={{ padding: 14, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Cases with Missing</div>
                    <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 2px', color: (missingData?.missing_cases_count || 0) > 0 ? '#f59e0b' : '#16a34a' }}>
                      {missingData?.missing_cases_count ?? 0}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                      {(((missingData?.missing_cases_count || 0) / (missingData?.total_cases || totalRows || 1)) * 100).toFixed(1)}% of total sample
                    </div>
                  </div>
                  <div style={{ padding: 14, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Cases &gt; 15% Missing</div>
                    <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 2px', color: (missingData?.flagged_cases?.length || 0) > 0 ? '#ef4444' : '#16a34a' }}>
                      {missingData?.flagged_cases?.length ?? 0}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Recommended for removal (Hair et al., 2017)</div>
                  </div>
                  <div style={{ padding: 14, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Indicators &gt; 5% Missing</div>
                    <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 2px' }}>
                      {missingData?.flagged_indicators?.length ?? 0}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Variables requiring imputation</div>
                  </div>
                </div>

                {/* Flagged Cases Action */}
                {(missingData?.flagged_cases?.length || 0) > 0 && (
                  <div style={{
                    marginBottom: 20,
                    padding: 14,
                    background: 'rgba(239, 68, 68, 0.05)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, color: '#ef4444', fontSize: 13 }}>
                        {missingData.flagged_cases.length} cases exceed the 15% missing data threshold
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        Row indices: {missingData.flagged_cases.slice(0, 10).join(', ')}{missingData.flagged_cases.length > 10 ? '...' : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveFlagged}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 14px',
                        background: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      <Trash2 size={13} />
                      <span>Create Clean Dataset</span>
                    </button>
                  </div>
                )}

                {/* Missing per column table */}
                <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>Indicator Missing Frequency</h4>
                <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
                  <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Variable</th>
                        <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Scale</th>
                        <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>Missing Count</th>
                        <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>Missing %</th>
                        <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(missingData?.indicator_missing || {}).map(([col, info]: [string, any]) => {
                        const pct = info.pct || 0;
                        const isFlagged = pct > 5.0;
                        return (
                          <tr key={col} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{col}</td>
                            <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)' }}>{variables.find(v => v.name === col)?.scaleType || 'metric'}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{info.count}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{pct.toFixed(2)}%</td>
                            <td style={{ padding: '8px 12px' }}>
                              {isFlagged ? (
                                <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 11 }}>Exceeds 5% Threshold</span>
                              ) : info.count > 0 ? (
                                <span style={{ color: '#f59e0b', fontSize: 11 }}>Acceptable (&lt; 5%)</span>
                              ) : (
                                <span style={{ color: '#16a34a', fontSize: 11 }}>Complete</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 2. SUSPICIOUS PATTERNS TAB */}
            {activeScreeningTab === 'patterns' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
                  <div style={{ padding: 14, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Straightlining Cases</div>
                    <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 2px', color: (patternsData?.straightlining_cases?.length || 0) > 0 ? '#ef4444' : '#16a34a' }}>
                      {patternsData?.straightlining_cases?.length ?? 0}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Identical responses across consecutive items</div>
                  </div>
                  <div style={{ padding: 14, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Zero-Variance Indicators</div>
                    <div style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 2px', color: (patternsData?.zero_variance_indicators?.length || 0) > 0 ? '#ef4444' : '#16a34a' }}>
                      {patternsData?.zero_variance_indicators?.length ?? 0}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Indicators with 0 standard deviation</div>
                  </div>
                </div>

                <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>Straightlining Responses</h4>
                {patternsData?.straightlining_cases?.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 8, color: '#16a34a' }}>
                    <CheckCircle size={24} style={{ margin: '0 auto 8px' }} />
                    <div style={{ fontWeight: 600 }}>No suspicious straightlining patterns detected.</div>
                  </div>
                ) : (
                  <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
                    <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                          <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Case / Row #</th>
                          <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Consecutive Length</th>
                          <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Repeated Response Value</th>
                          <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Affected Variables</th>
                        </tr>
                      </thead>
                      <tbody>
                        {patternsData?.straightlining_cases?.map((p: any, idx: number) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>Row {p.row_index + 1}</td>
                            <td style={{ padding: '8px 12px' }}>{p.length} items</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{p.value}</td>
                            <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                              {p.variables?.join(', ') || 'All scale items'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 3. OUTLIERS TAB */}
            {activeScreeningTab === 'outliers' && (
              <div>
                <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                  Outlier detection based on Tukey’s fences (1.5 × IQR for potential outliers, 3.0 × IQR for extreme outliers).
                </p>

                <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
                  <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Variable</th>
                        <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>Min / Max</th>
                        <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>Q1 (25%) / Q3 (75%)</th>
                        <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>IQR Fence [Low, High]</th>
                        <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>Outlier Count</th>
                        <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Assessment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(outliersData?.summary || {}).map(([col, stat]: [string, any]) => {
                        const count = stat.outlier_count || 0;
                        return (
                          <tr key={col} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{col}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(stat.min, 1)} / {fmt(stat.max, 1)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(stat.q1, 2)} / {fmt(stat.q3, 2)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                              [{fmt(stat.lower_fence, 2)}, {fmt(stat.upper_fence, 2)}]
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: count > 0 ? 600 : 400, color: count > 0 ? '#f59e0b' : 'inherit' }}>
                              {count}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              {count === 0 ? (
                                <span style={{ color: '#16a34a', fontSize: 11 }}>Normal range</span>
                              ) : (
                                <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 600 }}>{count} outliers flagged</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 4. DISTRIBUTIONS & NORMALITY TAB */}
            {activeScreeningTab === 'distributions' && (
              <div>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  {/* Left: Normality table */}
                  <div style={{ flex: '1 1 500px', minWidth: 320 }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>Skewness &amp; Excess Kurtosis</h4>
                    <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                      Textbook rule of thumb: Skewness between -1 and +1, Kurtosis between -1 and +1 indicates acceptable univariate normality (Hair et al., 2017).
                    </p>
                    <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden', maxHeight: 440, overflowY: 'auto' }}>
                      <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                          <tr style={{ background: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                            <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Variable</th>
                            <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>Skewness</th>
                            <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>Kurtosis</th>
                            <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Normality</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(distData?.variables || {}).map(([col, stat]: [string, any]) => {
                            const isSelected = selectedHistCol === col;
                            const isNormal = stat.is_normal ?? (Math.abs(stat.skewness) <= 1.0 && Math.abs(stat.kurtosis) <= 1.0);
                            return (
                              <tr
                                key={col}
                                onClick={() => setSelectedHistCol(col)}
                                style={{
                                  borderBottom: '1px solid var(--color-border-subtle)',
                                  cursor: 'pointer',
                                  background: isSelected ? 'var(--color-accent-subtle)' : 'transparent'
                                }}
                              >
                                <td style={{ padding: '8px 12px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{col}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(stat.skewness, 3)}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(stat.kurtosis, 3)}</td>
                                <td style={{ padding: '8px 12px' }}>
                                  {isNormal ? (
                                    <span style={{ color: '#16a34a', fontSize: 11, fontWeight: 600 }}>Acceptable</span>
                                  ) : (
                                    <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 600 }}>Non-normal</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Right: Distribution Histogram preview */}
                  <div style={{ flex: '1 1 340px', minWidth: 300, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 8, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Histogram: {selectedHistCol}</h4>
                      <select
                        value={selectedHistCol}
                        onChange={e => setSelectedHistCol(e.target.value)}
                        style={{
                          padding: '4px 8px',
                          fontSize: 12,
                          background: 'var(--color-bg-base)',
                          border: '1px solid var(--color-border-subtle)',
                          borderRadius: 4,
                          color: 'var(--color-text-primary)'
                        }}
                      >
                        {variables.map(v => (
                          <option key={v.name} value={v.name}>{v.name}</option>
                        ))}
                      </select>
                    </div>

                    {isHistLoading ? (
                      <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
                        Loading histogram...
                      </div>
                    ) : histData?.counts ? (
                      <div>
                        {/* CSS bar chart */}
                        <div style={{ display: 'flex', alignItems: 'flex-end', height: 180, gap: 4, borderBottom: '1px solid var(--color-border-subtle)', paddingBottom: 4 }}>
                          {histData.counts.map((cnt: number, i: number) => {
                            const maxCnt = Math.max(...histData.counts, 1);
                            const heightPct = (cnt / maxCnt) * 100;
                            return (
                              <div
                                key={i}
                                title={`Bin: ${fmt(histData.bins[i], 1)} to ${fmt(histData.bins[i + 1], 1)}\nCount: ${cnt}`}
                                style={{
                                  flex: 1,
                                  height: `${Math.max(heightPct, 3)}%`,
                                  background: 'var(--color-accent)',
                                  borderRadius: '2px 2px 0 0',
                                  transition: 'height 0.2s ease',
                                  opacity: 0.85
                                }}
                              />
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>
                          <span>{fmt(histData.bins?.[0], 1)}</span>
                          <span>{fmt(histData.bins?.[histData.bins.length - 1], 1)}</span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
                        Select an indicator to view frequency distribution
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 5. INDICATOR DIRECTIONALITY TAB */}
            {activeScreeningTab === 'directionality' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>Reflective Indicator Directionality</h4>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
                      Evaluates inter-indicator correlation within reflective constructs to identify reverse-coded items.
                    </p>
                  </div>
                  {availableModels && availableModels.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500 }}>Model:</span>
                      <select
                        value={selectedModelId}
                        onChange={e => {
                          const newMId = e.target.value;
                          setSelectedModelId(newMId);
                          if (newMId) {
                            setIsLoading(true);
                            api.getScreeningDirectionality(projectPath, newMId, datasetId)
                              .then(res => {
                                if (!res.error) setDirectionalityData(res);
                              })
                              .finally(() => setIsLoading(false));
                          }
                        }}
                        style={{
                          padding: '4px 10px',
                          fontSize: 12,
                          background: 'var(--color-bg-base)',
                          border: '1px solid var(--color-border-subtle)',
                          borderRadius: 6,
                          color: 'var(--color-text-primary)'
                        }}
                      >
                        <option value="">-- Choose a Model --</option>
                        {availableModels.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {!selectedModelId && (!availableModels || availableModels.length === 0) ? (
                  <div style={{ padding: '40px 24px', textAlign: 'center', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 8 }}>
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 24 }}>account_tree</span>
                    </div>
                    <h4 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      No Model Created in this Study Yet
                    </h4>
                    <p style={{ margin: '0 auto 16px', maxWidth: 480, fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                      Indicator directionality checks whether items assigned to the same reflective construct are positively correlated. Create or open a model in the model editor to link indicators to constructs.
                    </p>
                  </div>
                ) : !selectedModelId ? (
                  <div style={{ padding: '36px 24px', textAlign: 'center', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 8 }}>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
                      Select a model from the dropdown above to analyze indicator directionality.
                    </p>
                  </div>
                ) : directionalityData?.flagged_pairs?.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 8, color: '#16a34a' }}>
                    <CheckCircle size={24} style={{ margin: '0 auto 8px' }} />
                    <div style={{ fontWeight: 600 }}>All indicator inter-correlations are positive. Directionality is verified.</div>
                  </div>
                ) : (
                  <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
                    <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
                          <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Construct</th>
                          <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Indicator A</th>
                          <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Indicator B</th>
                          <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>Correlation (r)</th>
                          <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Recommendation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {directionalityData?.flagged_pairs?.map((item: any, idx: number) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>{item.construct_name || item.construct_id}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{item.var1}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{item.var2}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#ef4444', fontWeight: 600 }}>{fmt(item.r, 3)}</td>
                            <td style={{ padding: '8px 12px', fontSize: 12, color: '#f59e0b' }}>
                              Possible reverse-coded item. Recode variable before estimating reflective measurement model.
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
