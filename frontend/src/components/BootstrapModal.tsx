import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import { Checkbox } from './Checkbox';
import type { ModelSpec } from '../utils/api';
import { ModelCalculationModal } from './ModelCalculationModal';
import type { ModelCalculationSettings } from './ModelCalculationModal';

interface BootstrapModalProps {
  isOpen: boolean;
  consistent?: boolean;
  projectPath: string;
  spec?: ModelSpec;
  datasetHeaders?: string[];
  datasetRows?: any[][];
  datasetName?: string;
  modelId?: string;
  diagramLayout?: any;
  initialSettings?: Partial<ModelCalculationSettings>;
  onComplete: (results: any) => void;
  onClose: () => void;
}

export const BootstrapModal: React.FC<BootstrapModalProps> = ({
  isOpen,
  consistent = false,
  projectPath,
  spec,
  datasetHeaders,
  datasetRows,
  datasetName,
  modelId,
  diagramLayout,
  initialSettings,
  onComplete,
  onClose,
}) => {
  const [stage, setStage] = useState<'config' | 'running' | 'completed' | 'cancelled' | 'error'>('config');
  const [nBoot, setNBoot] = useState<number>(500);
  const [seed, setSeed] = useState<number>(42);
  const [randomSeed, setRandomSeed] = useState(false);
  const [parallel, setParallel] = useState(true);
  const [mode, setMode] = useState<'basic' | 'complete'>('complete');
  const [ciMethod, setCiMethod] = useState<'percentile' | 'bias_corrected' | 'bca' | 'studentized'>('percentile');
  const [studentizedResamples, setStudentizedResamples] = useState(50);
  const [alpha, setAlpha] = useState(0.05);
  const [tails, setTails] = useState<'one' | 'two'>('two');
  const [direction, setDirection] = useState<'positive' | 'negative'>('positive');
  const [modelSettings, setModelSettings] = useState<Partial<ModelCalculationSettings>>({});
  const [editModelSettings, setEditModelSettings] = useState(false);
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
    if (isOpen) setModelSettings(initialSettings || {});
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
      if (!Number.isInteger(nBoot) || nBoot < 2 || !Number.isSafeInteger(seed) || seed < 0 || alpha <= 0 || alpha >= 0.5 || (ciMethod === 'studentized' && (!Number.isInteger(studentizedResamples) || studentizedResamples < 10))) { setStage('error'); setErrorMsg('Enter valid resampling counts, seed, and significance level. Studentized intervals require at least 10 inner resamples.'); return; }
      hasCompletedRef.current = false;
      setStage('running');
      setCurrent(0);
      setTotal(nBoot);
      setPercent(0);
      setElapsedSec(0);
      setErrorMsg(null);

      const startRes = await api.startBootstrap(projectPath, spec, {
        n_boot: nBoot,
        consistent,
        seed: randomSeed ? crypto.getRandomValues(new Uint32Array(1))[0] : seed,
        parallel, mode, ci_method: ciMethod, studentized_resamples: studentizedResamples, significance_level: alpha, tails, direction,
        settings: modelSettings,
        scheme: 'path',
        columns: datasetHeaders,
        rows: datasetRows,
        dataset_name: datasetName,
        model_id: modelId,
        diagram_layout: diagramLayout,

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
    <div className="calculation-overlay calculation-existing" style={{
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
              {consistent ? 'Consistent bootstrap' : 'Bootstrap inference'}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--color-text-muted, #64748b)' }}>
              Estimate uncertainty in model results
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
            <div className="calculation-fields">
              <label className="modal__field"><span className="modal__label">Resamples</span><input className="modal__input" type="number" min="2" step="1" value={nBoot} onChange={e => setNBoot(Number(e.target.value))}/></label>
              <button type="button" className="modal__btn-cancel" onClick={() => setEditModelSettings(true)}>Model and data settings</button>
              <label className="modal__field"><span className="modal__label">Confidence interval</span><select className="modal__input" value={ciMethod} onChange={e => setCiMethod(e.target.value as typeof ciMethod)}><option value="percentile">Percentile</option><option value="bias_corrected">Bias corrected</option><option value="bca">Bias corrected and accelerated (BCa)</option><option value="studentized">Studentized</option></select></label>
              {ciMethod === 'studentized' && <><label className="modal__field"><span className="modal__label">Inner resamples</span><input className="modal__input" type="number" min="10" step="1" value={studentizedResamples} onChange={e => setStudentizedResamples(Number(e.target.value))}/></label><p className="calculation-note">Each resample is bootstrapped again to estimate its standard error. This can take substantially longer. Intervals are unavailable for estimates with too few successful or nonzero standard errors.</p></>}
              <details className="calculation-more"><summary>More options</summary><div className="calculation-more__fields">
                <label className="modal__field"><span className="modal__label">Results</span><select className="modal__input" value={mode} onChange={e => setMode(e.target.value as 'basic' | 'complete')}><option value="complete">All supported estimates</option><option value="basic">Essential estimates</option></select></label>
                <label className="modal__field"><span className="modal__label">Significance level</span><input className="modal__input" type="number" min="0.001" max="0.499" step="0.01" value={alpha} onChange={e => setAlpha(Number(e.target.value))}/></label>
                <label className="modal__field"><span className="modal__label">Hypothesis test</span><select className="modal__input" value={tails} onChange={e => setTails(e.target.value as 'one' | 'two')}><option value="two">Two-sided</option><option value="one">One-sided</option></select></label>
                {tails === 'one' && <label className="modal__field"><span className="modal__label">Expected direction</span><select className="modal__input" value={direction} onChange={e => setDirection(e.target.value as 'positive' | 'negative')}><option value="positive">Positive</option><option value="negative">Negative</option></select></label>}
                <div className="calculation-check"><Checkbox id="bootstrap-parallel" checked={parallel} onChange={setParallel}/><label htmlFor="bootstrap-parallel">Use parallel processing</label></div>
                <div className="calculation-check"><Checkbox id="bootstrap-random-seed" checked={randomSeed} onChange={setRandomSeed}/><label htmlFor="bootstrap-random-seed">Generate a random seed</label></div>
                {!randomSeed && <label className="modal__field"><span className="modal__label">Seed</span><input className="modal__input" type="number" min="0" step="1" value={seed} onChange={e => setSeed(Number(e.target.value))}/></label>}
              </div></details>
              {ciMethod === 'bca' && <p className="calculation-note">BCa requires complete data and at most 500 observations.</p>}
              <p className="calculation-note">Uses {consistent ? 'consistent' : 'standard'} PLS with the selected model and data settings. A one-sided direction applies to all estimates. Running it replaces the current model results.</p>
              {hasGcTerms && <p className="calculation-note">Copula options use the engine defaults.</p>}
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
                Run bootstrapping
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
      {editModelSettings && <ModelCalculationModal isOpen consistent={consistent} submitLabel="Use settings" initialSettings={modelSettings} spec={spec} datasetHeaders={datasetHeaders} datasetRows={datasetRows} onClose={() => setEditModelSettings(false)} onRun={settings => { setModelSettings(settings); setEditModelSettings(false); }} />}
    </div>
  );
};
