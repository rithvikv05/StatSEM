import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import type { ModelSpec } from '../utils/api';

interface BootstrapModalProps {
  isOpen: boolean;
  projectPath: string;
  spec?: ModelSpec;
  datasetHeaders?: string[];
  datasetRows?: any[][];
  datasetName?: string;
  modelId?: string;
  diagramLayout?: any;
  onComplete: (results: any) => void;
  onClose: () => void;
}

export const BootstrapModal: React.FC<BootstrapModalProps> = ({
  isOpen,
  projectPath,
  spec,
  datasetHeaders,
  datasetRows,
  datasetName,
  modelId,
  diagramLayout,
  onComplete,
  onClose,
}) => {
  const [stage, setStage] = useState<'config' | 'running' | 'completed' | 'cancelled' | 'error'>('config');
  const [nBoot, setNBoot] = useState<number>(500);
  const [seed, setSeed] = useState<number>(42);
  const [ecdfMethod, setEcdfMethod] = useState<'F4' | 'F3'>('F4');
  const [copulaTransform, setCopulaTransform] = useState<'raw' | 'eq17'>('raw');
  const [jobId, setJobId] = useState<string | null>(null);

  const gcList = (spec as any)?.gaussian_copulas || (spec as any)?.gaussianCopulas || [];
  const hasGcTerms = Array.isArray(gcList) && gcList.length > 0;
  const [current, setCurrent] = useState<number>(0);
  const [total, setTotal] = useState<number>(500);
  const [percent, setPercent] = useState<number>(0);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pollIntervalRef = useRef<any>(null);
  const hasCompletedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isOpen) {
      // Reset modal state on close
      setStage('config');
      setCurrent(0);
      setPercent(0);
      setElapsedSec(0);
      setErrorMsg(null);
      hasCompletedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  }, [isOpen]);

  const handleStart = async () => {
    try {
      hasCompletedRef.current = false;
      setStage('running');
      setCurrent(0);
      setTotal(nBoot);
      setPercent(0);
      setElapsedSec(0);
      setErrorMsg(null);

      const startRes = await api.startBootstrap(projectPath, spec, {
        n_boot: nBoot,
        seed: seed,
        scheme: 'path',
        columns: datasetHeaders,
        rows: datasetRows,
        dataset_name: datasetName,
        model_id: modelId,
        diagram_layout: diagramLayout,
        settings: hasGcTerms ? {
          gc: {
            ecdf: ecdfMethod,
            copula_transform: copulaTransform,
          }
        } : undefined,
      });

      if (startRes.error || !startRes.job_id) {
        setStage('error');
        setErrorMsg(startRes.error || 'Failed to initialize bootstrap job.');
        return;
      }

      const currentJobId = startRes.job_id;
      setJobId(currentJobId);

      const markJobCompleted = (data: { total?: number; elapsed_sec?: number; results?: any }) => {
        if (hasCompletedRef.current) return;
        hasCompletedRef.current = true;
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        if (wsRef.current) {
          try { wsRef.current.close(); } catch {}
          wsRef.current = null;
        }
        setCurrent(data.total || nBoot);
        setPercent(100);
        setElapsedSec(data.elapsed_sec || 0);
        setStage('completed');
        if (data.results) {
          onComplete(data.results);
        }
      };

      // Connect WebSocket
      const ws = api.createBootstrapWebSocket(
        currentJobId,
        (msg: any) => {
          if (msg.type === 'progress') {
            if (!hasCompletedRef.current) {
              if (typeof msg.current === 'number') setCurrent(msg.current);
              if (typeof msg.total === 'number') setTotal(msg.total);
              if (typeof msg.percent === 'number') setPercent(msg.percent);
              if (typeof msg.elapsed_sec === 'number') setElapsedSec(msg.elapsed_sec);
            }
          } else if (msg.type === 'completed') {
            markJobCompleted(msg);
          } else if (msg.type === 'cancelled') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setStage('cancelled');
          } else if (msg.type === 'failed') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setStage('error');
            setErrorMsg(msg.error || 'Bootstrapping process encountered an error.');
          }
        },
        (err) => {
          console.warn('Bootstrap WebSocket error:', err);
        },
        () => {
          // Closed
        }
      );

      wsRef.current = ws;

      // Status polling fallback to ensure modal completes even if WS drops packets
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusRes = await api.getBootstrapStatus(currentJobId);
          if (!statusRes) return;

          if (statusRes.status === 'completed') {
            markJobCompleted(statusRes);
          } else if (statusRes.status === 'failed') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setStage('error');
            setErrorMsg(statusRes.error || 'Bootstrapping process encountered an error.');
          } else if (statusRes.status === 'cancelled') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setStage('cancelled');
          } else if (statusRes.status === 'running') {
            if (!hasCompletedRef.current) {
              if (typeof statusRes.current === 'number') setCurrent(statusRes.current);
              if (typeof statusRes.total === 'number') setTotal(statusRes.total);
              if (typeof statusRes.percent === 'number') setPercent(statusRes.percent);
              if (typeof statusRes.elapsed_sec === 'number') setElapsedSec(statusRes.elapsed_sec);
            }
          }
        } catch {
          // ignore network polling hiccups
        }
      }, 500);
    } catch (err: any) {
      setStage('error');
      setErrorMsg(err?.message || 'Failed to start bootstrapping.');
    }
  };

  const handleCancel = async () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ action: 'cancel' }));
      } catch (e) {
        // ignore
      }
    }
    if (jobId) {
      await api.cancelBootstrap(jobId);
    }
    setStage('cancelled');
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div style={{
        backgroundColor: 'var(--color-bg-base, #ffffff)',
        borderRadius: '14px',
        width: '520px',
        maxWidth: '92vw',
        boxShadow: 'var(--shadow-float, 0 20px 25px -5px rgba(0, 0, 0, 0.2))',
        border: '1px solid var(--color-border-subtle, #e2e8f0)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid var(--color-border-subtle, #f1f5f9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--color-bg-surface, #f8fafc)',
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary, #0f172a)' }}>
              PLS-SEM Bootstrapping
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--color-text-muted, #64748b)' }}>
              Multi-core significance testing for path coefficients &amp; loadings
            </p>
          </div>
          {stage !== 'running' && (
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                color: 'var(--color-text-muted, #94a3b8)',
                padding: '4px 8px',
                borderRadius: '6px',
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Content Body */}
        <div style={{ padding: '24px' }}>
          {stage === 'config' && (
            <div>
              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary, #334155)', marginBottom: '6px' }}>
                  Bootstrap Subsamples
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  {[500, 1000, 2500, 5000].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setNBoot(count)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 600,
                        border: nBoot === count ? '2px solid var(--color-accent)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                        backgroundColor: nBoot === count ? 'var(--color-accent-subtle)' : 'var(--color-bg-base, #ffffff)',
                        color: nBoot === count ? 'var(--color-accent)' : 'var(--color-text-secondary, #475569)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {count.toLocaleString()}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted, #64748b)', marginTop: '4px', display: 'block' }}>
                  500 is ideal for quick checks; 5,000 is recommended for final academic publishing.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '16px', marginBottom: '18px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary, #334155)', marginBottom: '6px' }}>
                    Random Seed
                  </label>
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(parseInt(e.target.value) || 42)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border-subtle, #cbd5e1)',
                      backgroundColor: 'var(--color-bg-base, #ffffff)',
                      color: 'var(--color-text-primary, #0f172a)',
                      fontSize: '13px',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'var(--color-accent)';
                      e.currentTarget.style.boxShadow = '0 0 0 2px var(--color-accent-subtle)';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'var(--color-border-subtle, #cbd5e1)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted, #64748b)', marginTop: '2px', display: 'block' }}>
                    Ensures reproducible bootstrap distributions.
                  </span>
                </div>

                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary, #334155)', marginBottom: '6px' }}>
                    Test Type &amp; Scheme
                  </label>
                  <div style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--color-bg-surface, #f8fafc)',
                    border: '1px solid var(--color-border-subtle, #e2e8f0)',
                    fontSize: '12px',
                    color: 'var(--color-text-secondary, #475569)',
                    lineHeight: '1.4',
                  }}>
                    Two-tailed test (α = 0.05)<br />
                    <strong>Path Weighting</strong>
                  </div>
                </div>
              </div>

              {hasGcTerms && (
                <div style={{
                  marginBottom: '16px',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--color-bg-surface, #f8fafc)',
                  border: '1px solid var(--color-border-subtle, #e2e8f0)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-primary, #0f172a)' }}>
                      Gaussian Copula ({gcList.length} active)
                    </span>
                    <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(107,78,230,0.12)', color: 'var(--color-accent)', fontWeight: 600 }}>
                      Endogeneity
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                    {gcList.map((gc: any, idx: number) => {
                      const src = gc.source_construct || gc.source;
                      const tgt = gc.target_construct || gc.target;
                      return (
                        <span key={gc.id || idx} style={{
                          fontSize: '11px',
                          fontFamily: 'monospace',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          backgroundColor: 'var(--color-bg-base, #ffffff)',
                          border: '1px solid var(--color-border-subtle, #cbd5e1)',
                          color: 'var(--color-text-primary, #1e293b)'
                        }}>
                          GC ({src} → {tgt})
                        </span>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '14px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary, #475569)', marginBottom: '4px' }}>
                        ECDF Method
                      </label>
                      <select
                        value={ecdfMethod}
                        onChange={(e) => setEcdfMethod(e.target.value as any)}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          fontSize: '12px',
                          borderRadius: '6px',
                          border: '1px solid var(--color-border-subtle, #cbd5e1)',
                          backgroundColor: 'var(--color-bg-base, #ffffff)',
                          color: 'var(--color-text-primary, #0f172a)'
                        }}
                      >
                        <option value="F4">F4 (Adjusted - Recommended)</option>
                        <option value="F3">F3 (Endpoint-adjusted)</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary, #475569)', marginBottom: '4px' }}>
                        Copula Transform
                      </label>
                      <select
                        value={copulaTransform}
                        onChange={(e) => setCopulaTransform(e.target.value as any)}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          fontSize: '12px',
                          borderRadius: '6px',
                          border: '1px solid var(--color-border-subtle, #cbd5e1)',
                          backgroundColor: 'var(--color-bg-base, #ffffff)',
                          color: 'var(--color-text-primary, #0f172a)'
                        }}
                      >
                        <option value="raw">Raw C(P) (SmartPLS 4 calibrated)</option>
                        <option value="eq17">Eq. 17 (Sigma^-1 Inv)</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div style={{
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '8px',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}>
                <span style={{ fontSize: '16px' }}>⚡</span>
                <span style={{ fontSize: '12px', color: '#166534', lineHeight: '1.4' }}>
                  Parallel CPU acceleration enabled. Resamples are distributed across all available CPU cores.
                </span>
              </div>
            </div>
          )}

          {stage === 'running' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary, #1e293b)' }}>
                  {hasGcTerms ? 'Bootstrapping with Gaussian copulas...' : 'Running Resamples...'}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-accent)' }}>
                  {percent.toFixed(1)}%
                </span>
              </div>

              {/* Progress Track */}
              <div style={{
                width: '100%',
                height: '10px',
                backgroundColor: 'var(--color-bg-surface, #f1f5f9)',
                borderRadius: '9999px',
                overflow: 'hidden',
                position: 'relative',
              }}>
                <div style={{
                  width: `${percent}%`,
                  height: '100%',
                  backgroundColor: 'var(--color-accent)',
                  borderRadius: '9999px',
                  transition: 'width 0.2s ease',
                  backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent)',
                  backgroundSize: '1rem 1rem',
                }} />
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '10px',
                fontSize: '12px',
                color: '#64748b',
              }}>
                <span>Iteration {current.toLocaleString()} of {total.toLocaleString()}</span>
                <span>Elapsed: {elapsedSec.toFixed(1)}s</span>
              </div>
            </div>
          )}

          {stage === 'completed' && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: '#dcfce7',
                color: '#16a34a',
                fontSize: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
              }}>
                ✓
              </div>
              <h4 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
                Bootstrapping Complete!
              </h4>
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                Successfully computed standard errors, t-values, and p-values for {total.toLocaleString()} resamples in {elapsedSec.toFixed(1)}s.
              </p>
            </div>
          )}

          {stage === 'cancelled' && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: '#fef3c7',
                color: '#d97706',
                fontSize: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
              }}>
                !
              </div>
              <h4 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
                Bootstrapping Cancelled
              </h4>
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                Execution was cancelled mid-run. No changes were saved.
              </p>
            </div>
          )}

          {stage === 'error' && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: '#fee2e2',
                color: '#dc2626',
                fontSize: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
              }}>
                ✕
              </div>
              <h4 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 600, color: '#991b1b' }}>
                Bootstrapping Failed
              </h4>
              <p style={{ margin: 0, fontSize: '12px', color: '#b91c1c' }}>
                {errorMsg}
              </p>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--color-border-subtle, #f1f5f9)',
          backgroundColor: 'var(--color-bg-surface, #f8fafc)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
        }}>
          {stage === 'config' && (
            <>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border-subtle, #cbd5e1)',
                  backgroundColor: 'var(--color-bg-base, #ffffff)',
                  color: 'var(--color-text-secondary, #475569)',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStart}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: 'var(--color-accent)',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: 'var(--shadow-xs, 0 1px 2px 0 rgba(0, 0, 0, 0.05))',
                  transition: 'background-color var(--transition-fast)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-accent-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-accent)')}
              >
                Start Bootstrapping
              </button>
            </>
          )}

          {stage === 'running' && (
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: '1px solid #fca5a5',
                backgroundColor: '#fef2f2',
                color: '#b91c1c',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel Run
            </button>
          )}

          {(stage === 'completed' || stage === 'cancelled' || stage === 'error') && (
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--color-accent)',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: 'var(--shadow-xs, 0 1px 2px 0 rgba(0, 0, 0, 0.05))',
                transition: 'background-color var(--transition-fast)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-accent-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-accent)')}
            >
              {stage === 'completed' ? 'View Results' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
