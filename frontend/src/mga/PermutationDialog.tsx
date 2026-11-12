import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Checkbox } from '../components/Checkbox';
import type { DataGroup, PermutationReport, PlsSettings } from './types';
import { checkGroupPairPreflight, plsSettingsFromInitial, type InitialPlsLikeSettings } from './groupUtils';
import { mgaApi } from './mgaApi';
import { WorkflowStepper } from './WorkflowStepper';
import { PlsAndMissingTabs } from './PlsAndMissingTabs';

interface PermutationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath?: string;
  modelId?: string;
  datasetId?: string;
  spec: any;
  columns: string[];
  rows: any[][];
  dataGroups: DataGroup[];
  initialSettings?: InitialPlsLikeSettings;
  consistent?: boolean;
  onComplete: (report: PermutationReport) => void;
}

export const PermutationDialog: React.FC<PermutationDialogProps> = ({
  isOpen,
  onClose,
  projectPath,
  modelId,
  datasetId,
  spec,
  columns,
  rows,
  dataGroups,
  initialSettings,
  consistent = false,
  onComplete,
}) => {
  const [activeTab, setActiveTab] = useState<'permutation' | 'pls' | 'missing'>('permutation');
  const [stage, setStage] = useState<'config' | 'running' | 'error'>('config');

  const [groupAId, setGroupAId] = useState('');
  const [groupBId, setGroupBId] = useState('');
  const [permutationsText, setPermutationsText] = useState<string>('5000');
  const [testType, setTestType] = useState<'two-tailed' | 'one-tailed'>('two-tailed');
  const [significanceLevel, setSignificanceLevel] = useState<number>(0.05);
  const [parallelProcessing, setParallelProcessing] = useState<boolean>(true);
  const [seedText, setSeedText] = useState<string>('');
  const [plsSettings, setPlsSettings] = useState<PlsSettings>(() => {
    const s = plsSettingsFromInitial(initialSettings);
    if (consistent) s.consistent = true;
    return s;
  });

  const [jobId, setJobId] = useState<string | null>(null);
  const [current, setCurrent] = useState<number>(0);
  const [total, setTotal] = useState<number>(5000);
  const [percent, setPercent] = useState<number>(0);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pollRef = useRef<any>(null);
  const cancelledRef = useRef(false);
  const wasOpenRef = useRef(false);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => clearPoll(), []);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      setActiveTab('permutation');
      setStage('config');
      setGroupAId(dataGroups[0]?.id || '');
      setGroupBId(dataGroups[1]?.id || '');
      setPermutationsText('5000');
      setTestType('two-tailed');
      setSignificanceLevel(0.05);
      setParallelProcessing(true);
      setSeedText('');
      setPlsSettings(plsSettingsFromInitial(initialSettings));
      setCurrent(0);
      setTotal(5000);
      setPercent(0);
      setElapsedSec(0);
      setErrorMsg(null);
      setJobId(null);
      cancelledRef.current = false;
    } else if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      clearPoll();
    }
  }, [isOpen, dataGroups, initialSettings]);

  useEffect(() => {
    if (!isOpen || stage !== 'config') return;
    if (groupAId && !dataGroups.some(g => g.id === groupAId)) {
      setGroupAId(dataGroups[0]?.id || '');
    }
    if (groupBId && !dataGroups.some(g => g.id === groupBId)) {
      setGroupBId(dataGroups.find(g => g.id !== groupAId)?.id || dataGroups[1]?.id || '');
    }
  }, [isOpen, stage, dataGroups, groupAId, groupBId]);

  const groupA = dataGroups.find(g => g.id === groupAId);
  const groupB = dataGroups.find(g => g.id === groupBId);

  const preflight = useMemo(
    () => (isOpen ? checkGroupPairPreflight(columns, rows, spec, groupA, groupB, significanceLevel) : { blockingError: null, warnings: [] }),
    [isOpen, columns, rows, spec, groupA, groupB, significanceLevel]
  );

  if (!isOpen) return null;

  const handleRun = async () => {
    if (!groupA || !groupB) {
      setErrorMsg('Please select both Group A and Group B.');
      return;
    }
    if (groupA.id === groupB.id) {
      setErrorMsg('Group A and Group B must be different.');
      return;
    }
    if (preflight.blockingError) {
      setErrorMsg(preflight.blockingError);
      return;
    }

    const permutations = Number(permutationsText.trim());
    if (!Number.isInteger(permutations) || permutations < 10 || permutations > 20000) {
      setErrorMsg('Number of permutations must be an integer between 10 and 20,000.');
      return;
    }
    if (!Number.isInteger(plsSettings.maxIterations) || plsSettings.maxIterations < 1 || plsSettings.maxIterations > 5000) {
      setErrorMsg('Maximum iterations must be an integer between 1 and 5,000.');
      return;
    }
    if (!Number.isInteger(plsSettings.stopCriterionExponent) || plsSettings.stopCriterionExponent < 3 || plsSettings.stopCriterionExponent > 12) {
      setErrorMsg('Stop criterion exponent must be an integer between 3 and 12.');
      return;
    }
    if (!Number.isFinite(significanceLevel) || significanceLevel <= 0 || significanceLevel >= 0.5) {
      setErrorMsg('Significance level must be between 0 and 0.5.');
      return;
    }

    let parsedSeed: number | null = null;
    if (seedText.trim() !== '') {
      const n = Number(seedText.trim());
      if (!Number.isSafeInteger(n) || n < 0) {
        setErrorMsg('Random seed must be a non-negative integer (or leave blank for random).');
        return;
      }
      parsedSeed = n;
    }

    cancelledRef.current = false;
    setErrorMsg(null);
    setStage('running');
    setCurrent(0);
    setTotal(permutations);
    setPercent(0);

    try {
      const startRes = await mgaApi.startPermutation({
        projectPath,
        modelId,
        datasetId,
        spec,
        columns,
        rows,
        groupA,
        groupB,
        permutations,
        testType,
        significanceLevel,
        parallelProcessing,
        seed: parsedSeed,
        plsSettings,
      });

      if (startRes.error || !startRes.jobId) {
        setStage('error');
        setErrorMsg(startRes.error || 'Failed to start permutation run.');
        return;
      }

      const id = startRes.jobId;
      setJobId(id);

      clearPoll();
      pollRef.current = setInterval(async () => {
        if (cancelledRef.current) return;
        try {
          const st = await mgaApi.getPermutationStatus(id);
          if (cancelledRef.current) return;
          if (typeof st.current === 'number') setCurrent(st.current);
          if (typeof st.total === 'number') setTotal(st.total);
          if (typeof st.percent === 'number') setPercent(st.percent);
          if (typeof st.elapsedSec === 'number') setElapsedSec(st.elapsedSec);

          if (st.status === 'completed' && st.result) {
            clearPoll();
            onComplete(st.result);
            onClose();
          } else if (st.status === 'cancelled') {
            clearPoll();
            onClose();
          } else if (st.status === 'failed' || st.error) {
            clearPoll();
            setStage('error');
            setErrorMsg(st.error || 'Permutation test failed.');
          }
        } catch {
          // ignore transient poll hiccup
        }
      }, 250);
    } catch (err: any) {
      setStage('error');
      setErrorMsg(err?.message || 'Failed to start permutation.');
    }
  };

  const handleCancel = async () => {
    cancelledRef.current = true;
    clearPoll();
    if (jobId) {
      await mgaApi.cancelPermutation(jobId).catch(() => {});
    }
    onClose();
  };

  return (
    <div className="modal-overlay active calculation-overlay" role="presentation" onClick={stage === 'running' ? undefined : onClose}>
      <div className="modal calculation-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ maxWidth: '580px', width: '94vw' }}>
        <div className="modal__header">
          <div>
            <h2 className="modal__title">
              {consistent ? 'Consistent Permutation MGA & MICOM (PLSc)' : 'Permutation Multigroup Analysis & MICOM'}
            </h2>
            <p className="modal__subtitle">
              Measurement invariance (MICOM Steps 1–3) &amp; permutation multigroup test
            </p>
          </div>
          {stage !== 'running' && (
            <button className="calculation-close" type="button" aria-label="Close" onClick={onClose}>×</button>
          )}
        </div>

        <div className="modal__body">
          <WorkflowStepper hasEnoughGroups={dataGroups.length >= 2} currentStep={2} />

          {errorMsg && (
            <div className="results-notice results-notice--danger">{errorMsg}</div>
          )}

          {stage === 'running' ? (
            <div style={{ padding: '14px 4px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                <span>Running permutation {current.toLocaleString()} / {total.toLocaleString()}</span>
                <span>{percent.toFixed(0)}%</span>
              </div>
              <div style={{ height: '8px', borderRadius: '999px', background: 'var(--color-bg-raised)', overflow: 'hidden', border: '1px solid var(--color-border-subtle)' }}>
                <div style={{ width: `${Math.min(100, percent)}%`, height: '100%', background: 'var(--color-accent)', transition: 'width 0.18s ease' }} />
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Comparing {groupA?.name} vs {groupB?.name}</span>
                <span>Elapsed: {elapsedSec.toFixed(1)}s</span>
              </div>
            </div>
          ) : (
            <>
              <div className="view-toggle" role="tablist" style={{ alignSelf: 'flex-start' }}>
                {[
                  { id: 'permutation', label: 'Permutation setup' },
                  { id: 'pls', label: 'PLS setup' },
                  { id: 'missing', label: 'Data setup' },
                ].map(t => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === t.id}
                    className={`view-toggle__btn ${activeTab === t.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(t.id as any)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {activeTab === 'permutation' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {dataGroups.length < 2 && (
                    <div className="results-notice results-notice--warn" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                      <span>
                        At least 2 data groups are required for Permutation MGA &amp; MICOM. Open your dataset tab and click <strong>Generate Data Groups</strong> to create groups.
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="modal__field" style={{ marginBottom: 0 }}>
                      <label className="modal__label">Group A</label>
                      <select className="modal__input" value={groupAId} onChange={e => setGroupAId(e.target.value)}>
                        {dataGroups.map(g => (
                          <option key={g.id} value={g.id}>{g.name} (n={g.recordCount})</option>
                        ))}
                      </select>
                    </div>
                    <div className="modal__field" style={{ marginBottom: 0 }}>
                      <label className="modal__label">Group B</label>
                      <select className="modal__input" value={groupBId} onChange={e => setGroupBId(e.target.value)}>
                        {dataGroups.map(g => (
                          <option key={g.id} value={g.id}>{g.name} (n={g.recordCount})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="modal__field" style={{ marginBottom: 0 }}>
                      <label className="modal__label" title="Number of random reshuffles of group labels. 5000 recommended." style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span>Permutations</span>
                        <HelpCircle size={13} style={{ color: 'var(--color-text-muted)' }} />
                      </label>
                      <input
                        type="number"
                        min={10}
                        max={20000}
                        className="modal__input"
                        value={permutationsText}
                        onChange={e => setPermutationsText(e.target.value)}
                      />
                    </div>

                    <div className="modal__field" style={{ marginBottom: 0 }}>
                      <label className="modal__label">Test type</label>
                      <select className="modal__input" value={testType} onChange={e => setTestType(e.target.value as any)}>
                        <option value="two-tailed">Two-tailed</option>
                        <option value="one-tailed">One-tailed</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="modal__field" style={{ marginBottom: 0 }}>
                      <label className="modal__label" title="Default 0.05. Two-tailed unless directional hypotheses." style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span>Significance level</span>
                        <HelpCircle size={13} style={{ color: 'var(--color-text-muted)' }} />
                      </label>
                      <select
                        className="modal__input"
                        value={String(significanceLevel)}
                        onChange={e => setSignificanceLevel(Number(e.target.value))}
                      >
                        <option value="0.01">0.01 (1%)</option>
                        <option value="0.05">0.05 (5%)</option>
                        <option value="0.1">0.10 (10%)</option>
                      </select>
                    </div>

                    <div className="modal__field" style={{ marginBottom: 0 }}>
                      <label className="modal__label">Random seed (optional)</label>
                      <input
                        type="number"
                        min={0}
                        className="modal__input"
                        value={seedText}
                        onChange={e => setSeedText(e.target.value)}
                        placeholder="Random (auto)"
                      />
                    </div>
                  </div>

                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                    <Checkbox checked={parallelProcessing} onChange={setParallelProcessing} />
                    <span>Parallel processing</span>
                  </label>

                  {preflight.blockingError && (
                    <div className="results-notice results-notice--danger">{preflight.blockingError}</div>
                  )}

                  {!preflight.blockingError && preflight.warnings.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {preflight.warnings.map((w, idx) => (
                        <div key={idx} className="results-notice results-notice--warn">
                          <AlertTriangle size={14} />
                          <span>{w.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'pls' && (
                <PlsAndMissingTabs tab="pls" plsSettings={plsSettings} onChange={setPlsSettings} />
              )}

              {activeTab === 'missing' && (
                <PlsAndMissingTabs tab="missing" plsSettings={plsSettings} onChange={setPlsSettings} />
              )}
            </>
          )}
        </div>

        <div className="modal__footer">
          {stage === 'running' ? (
            <button className="modal__btn-cancel" type="button" onClick={handleCancel}>
              Cancel
            </button>
          ) : (
            <>
              <button className="modal__btn-cancel" type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="modal__btn-create"
                type="button"
                onClick={handleRun}
                disabled={Boolean(!groupA || !groupB || groupAId === groupBId || preflight.blockingError)}
              >
                Start Calculation
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

