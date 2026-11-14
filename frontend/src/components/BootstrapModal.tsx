import React, { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../utils/api';
import { Checkbox } from './Checkbox';
import type { ModelSpec } from '../utils/api';
import type { DataGroup } from '../mga/types';
import type { ModelCalculationSettings } from './ModelCalculationModal';
import { getGroupRows } from '../mga/groupUtils';
import { PlsSetupTab, DataSetupTab, CalculationTabSlider, type PlsSetupSettings, type DataSetupSettings } from './CalculationCommonTabs';

interface BootstrapModalProps {
  isOpen: boolean;
  consistent?: boolean;
  projectPath: string;
  spec?: ModelSpec;
  dataGroups?: DataGroup[];
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
  dataGroups = [],
  datasetHeaders = [],
  datasetRows = [],
  datasetName,
  modelId,
  diagramLayout,
  initialSettings,
  onComplete,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'bootstrap' | 'pls' | 'data'>('bootstrap');
  const [stage, setStage] = useState<'config' | 'running' | 'completed' | 'cancelled' | 'error'>('config');

  // Bootstrap parameters
  const [nBoot, setNBoot] = useState<number>(5000);
  const [seed, setSeed] = useState<number>(42);
  const [randomSeed, setRandomSeed] = useState(false);
  const [parallel, setParallel] = useState(true);
  const [mode, setMode] = useState<'basic' | 'complete'>('complete');
  const [ciMethod, setCiMethod] = useState<'percentile' | 'bias_corrected' | 'bca' | 'studentized'>('percentile');
  const [studentizedResamples, setStudentizedResamples] = useState(50);
  const [alpha, setAlpha] = useState(0.05);
  const [tails, setTails] = useState<'one' | 'two'>('two');
  const [direction, setDirection] = useState<'positive' | 'negative'>('positive');

  // PLS setup state
  const [plsSetup, setPlsSetup] = useState<PlsSetupSettings>({
    inner_weighting: (initialSettings?.inner_weighting as any) || 'path',
    result_type: (initialSettings?.result_type as any) || 'standardized',
    initial_weights: (initialSettings?.initial_weights as any) || 'equal',
    individual_initial_weights: initialSettings?.individual_initial_weights,
    max_iter: initialSettings?.max_iter || 300,
    tolerance: initialSettings?.tolerance || 1e-7,
  });

  // Data setup state
  const [dataSetup, setDataSetup] = useState<DataSetupSettings>({
    missing_treatment: initialSettings?.missing_treatment === 'listwise' ? 'casewise' : (initialSettings?.missing_treatment as any) || 'mean',
    selected_data_group_id: initialSettings?.selected_data_group_id || null,
    data_filter: initialSettings?.data_filter || null,
    weight_column: initialSettings?.weight_column || null,
  });

  const [jobId, setJobId] = useState<string | null>(null);
  const [current, setCurrent] = useState<number>(0);
  const [total, setTotal] = useState<number>(5000);
  const [percent, setPercent] = useState<number>(0);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pollIntervalRef = useRef<any>(null);
  const hasCompletedRef = useRef<boolean>(false);

  const indicators = useMemo(() => {
    return Array.from(new Set((spec?.constructs || []).flatMap(c => c.indicators))).map(id => {
      const match = spec?.indicators?.find(i => i.id === id);
      return { id, label: match?.column || id };
    });
  }, [spec]);

  useEffect(() => {
    if (isOpen) {
      setPlsSetup({
        inner_weighting: (initialSettings?.inner_weighting as any) || 'path',
        result_type: (initialSettings?.result_type as any) || 'standardized',
        initial_weights: (initialSettings?.initial_weights as any) || 'equal',
        individual_initial_weights: initialSettings?.individual_initial_weights,
        max_iter: initialSettings?.max_iter || 300,
        tolerance: initialSettings?.tolerance || 1e-7,
      });
      setDataSetup({
        missing_treatment: initialSettings?.missing_treatment === 'listwise' ? 'casewise' : (initialSettings?.missing_treatment as any) || 'mean',
        selected_data_group_id: initialSettings?.selected_data_group_id || null,
        data_filter: initialSettings?.data_filter || null,
        weight_column: initialSettings?.weight_column || null,
      });
      setActiveTab('bootstrap');
    } else {
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
      if (
        !Number.isInteger(nBoot) ||
        nBoot < 2 ||
        !Number.isSafeInteger(seed) ||
        seed < 0 ||
        alpha <= 0 ||
        alpha >= 0.5 ||
        (ciMethod === 'studentized' && (!Number.isInteger(studentizedResamples) || studentizedResamples < 10))
      ) {
        setStage('error');
        setErrorMsg('Enter valid resampling counts, seed, and significance level. Studentized intervals require at least 10 inner resamples.');
        return;
      }
      hasCompletedRef.current = false;
      setStage('running');
      setCurrent(0);
      setTotal(nBoot);
      setPercent(0);
      setElapsedSec(0);
      setErrorMsg(null);

      // Derive effective data_filter and filter rows if data group selected
      let effectiveFilter = dataSetup.data_filter;
      let effectiveRows = datasetRows;
      if (dataSetup.selected_data_group_id) {
        const group = dataGroups.find(g => g.id === dataSetup.selected_data_group_id);
        if (group) {
          if (group.terms?.length === 1 && group.terms[0].operator === 'is equal to') {
            effectiveFilter = { column: group.terms[0].column, value: group.terms[0].value1 };
          }
          if (datasetHeaders && datasetRows.length > 0) {
            const { rows: filtered } = getGroupRows(datasetHeaders, datasetRows, group);
            if (filtered.length === 0) {
              setStage('error');
              setErrorMsg('The selected data group has no observations.');
              return;
            }
            effectiveRows = filtered;
          }
        }
      }

      const effectiveSettings: Partial<ModelCalculationSettings> = {
        inner_weighting: plsSetup.inner_weighting,
        result_type: plsSetup.result_type,
        initial_weights: plsSetup.initial_weights,
        individual_initial_weights: plsSetup.individual_initial_weights,
        max_iter: plsSetup.max_iter,
        tolerance: plsSetup.tolerance,
        missing_treatment: dataSetup.missing_treatment === 'casewise' || dataSetup.missing_treatment === 'pairwise'
          ? 'listwise'
          : (dataSetup.missing_treatment as any),
        data_filter: effectiveFilter,
        weight_column: dataSetup.weight_column,
      };

      const startRes = await api.startBootstrap(projectPath, spec, {
        n_boot: nBoot,
        consistent,
        seed: randomSeed ? crypto.getRandomValues(new Uint32Array(1))[0] : seed,
        parallel,
        mode,
        ci_method: ciMethod,
        studentized_resamples: studentizedResamples,
        significance_level: alpha,
        tails,
        direction,
        settings: effectiveSettings,
        scheme: plsSetup.inner_weighting,
        columns: datasetHeaders,
        rows: effectiveRows,
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
          onClose();
        }
      };

      const ws = api.createBootstrapWebSocket(
        currentJobId,
        (msg) => {
          if (msg.type === 'progress') {
            if (!hasCompletedRef.current) {
              setCurrent(msg.current);
              setTotal(msg.total);
              setPercent(msg.percent);
              setElapsedSec(msg.elapsed_sec);
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
        () => {}
      );

      wsRef.current = ws;

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
        } catch {}
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
      } catch {}
    }
    if (jobId) {
      await api.cancelBootstrap(jobId);
    }
    setStage('cancelled');
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay active calculation-overlay" role="presentation">
      <div
        className="modal calculation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bootstrap-title"
        style={{ maxWidth: 540, width: '92vw' }}
      >
        <div className="modal__header">
          <h2 className="modal__title" id="bootstrap-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            {consistent ? 'Consistent Bootstrapping (PLSc)' : 'Bootstrapping'}
          </h2>
          {stage !== 'running' && (
            <button className="calculation-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          )}
        </div>

        <div className="modal__body">
          {stage === 'running' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  Running bootstrap resamples...
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-accent)' }}>
                  {percent.toFixed(1)}%
                </span>
              </div>

              <div style={{
                width: '100%',
                height: '8px',
                backgroundColor: 'var(--color-bg-raised)',
                borderRadius: '999px',
                overflow: 'hidden',
                border: '1px solid var(--color-border-subtle)',
              }}>
                <div style={{
                  width: `${Math.min(100, percent)}%`,
                  height: '100%',
                  backgroundColor: 'var(--color-accent)',
                  transition: 'width 0.2s ease',
                }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                <span>Iteration {current.toLocaleString()} of {total.toLocaleString()}</span>
                <span>Elapsed: {elapsedSec.toFixed(1)}s</span>
              </div>
            </div>
          ) : (
            <>
              {errorMsg && <div className="results-notice results-notice--danger">{errorMsg}</div>}

              <CalculationTabSlider
                tabs={[
                  { id: 'bootstrap', label: 'Bootstrapping' },
                  { id: 'pls', label: 'PLS setup' },
                  { id: 'data', label: 'Data setup' },
                ]}
                activeTab={activeTab}
                onChange={t => setActiveTab(t as any)}
              />

              {activeTab === 'bootstrap' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <label className="modal__field" style={{ marginBottom: 0 }}>
                    <span className="modal__label">Subsamples</span>
                    <input
                      type="number"
                      min={2}
                      step={100}
                      className="modal__input"
                      value={nBoot}
                      onChange={e => setNBoot(Number(e.target.value))}
                    />
                  </label>

                  <div className="calculation-check">
                    <Checkbox id="boot-parallel" checked={parallel} onChange={setParallel} />
                    <label htmlFor="boot-parallel">Parallel processing</label>
                  </div>

                  <label className="modal__field" style={{ marginBottom: 0 }}>
                    <span className="modal__label">Amount of results</span>
                    <select
                      className="modal__input"
                      value={mode}
                      onChange={e => setMode(e.target.value as 'basic' | 'complete')}
                    >
                      <option value="complete">Complete</option>
                      <option value="basic">Most important (Basic)</option>
                    </select>
                  </label>

                  <label className="modal__field" style={{ marginBottom: 0 }}>
                    <span className="modal__label">Confidence interval method</span>
                    <select
                      className="modal__input"
                      value={ciMethod}
                      onChange={e => setCiMethod(e.target.value as typeof ciMethod)}
                    >
                      <option value="percentile">Percentile bootstrap</option>
                      <option value="studentized">Studentized bootstrap</option>
                      <option value="bca">Bias-corrected and accelerated (BCa) bootstrap</option>
                    </select>
                  </label>

                  {ciMethod === 'studentized' && (
                    <label className="modal__field" style={{ marginBottom: 0 }}>
                      <span className="modal__label">Inner studentized resamples</span>
                      <input
                        type="number"
                        min={10}
                        className="modal__input"
                        value={studentizedResamples}
                        onChange={e => setStudentizedResamples(Number(e.target.value))}
                      />
                    </label>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <label className="modal__field" style={{ marginBottom: 0 }}>
                      <span className="modal__label">Test type</span>
                      <select
                        className="modal__input"
                        value={tails}
                        onChange={e => setTails(e.target.value as 'one' | 'two')}
                      >
                        <option value="two">Two-tailed</option>
                        <option value="one">One-tailed</option>
                      </select>
                    </label>

                    <label className="modal__field" style={{ marginBottom: 0 }}>
                      <span className="modal__label">Significance level</span>
                      <select
                        className="modal__input"
                        value={alpha}
                        onChange={e => setAlpha(Number(e.target.value))}
                      >
                        <option value={0.01}>0.01 (99% CI)</option>
                        <option value={0.05}>0.05 (95% CI)</option>
                        <option value={0.1}>0.10 (90% CI)</option>
                      </select>
                    </label>
                  </div>

                  {tails === 'one' && (
                    <label className="modal__field" style={{ marginBottom: 0 }}>
                      <span className="modal__label">Expected direction</span>
                      <select
                        className="modal__input"
                        value={direction}
                        onChange={e => setDirection(e.target.value as 'positive' | 'negative')}
                      >
                        <option value="positive">Positive</option>
                        <option value="negative">Negative</option>
                      </select>
                    </label>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div className="calculation-check">
                      <Checkbox id="boot-random-seed" checked={randomSeed} onChange={setRandomSeed} />
                      <label htmlFor="boot-random-seed">Random seed</label>
                    </div>
                    {!randomSeed && (
                      <label className="modal__field" style={{ marginBottom: 0 }}>
                        <span className="modal__label">Fixed seed</span>
                        <input
                          type="number"
                          min={0}
                          className="modal__input"
                          value={seed}
                          onChange={e => setSeed(Number(e.target.value))}
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'pls' && (
                <PlsSetupTab
                  settings={plsSetup}
                  onChange={setPlsSetup}
                  indicators={indicators}
                />
              )}

              {activeTab === 'data' && (
                <DataSetupTab
                  settings={dataSetup}
                  onChange={setDataSetup}
                  dataGroups={dataGroups}
                  datasetHeaders={datasetHeaders}
                />
              )}
            </>
          )}
        </div>

        <div className="modal__footer">
          {stage === 'running' ? (
            <button className="modal__btn-cancel" onClick={handleCancel}>
              Cancel Calculation
            </button>
          ) : (
            <>
              <button className="modal__btn-cancel" onClick={onClose}>
                Cancel
              </button>
              <button className="modal__btn-create" onClick={handleStart}>
                Start calculation
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
