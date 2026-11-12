import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Checkbox } from '../components/Checkbox';
import type { DataGroup, PermutationReport } from './types';
import { checkGroupPairPreflight, getGroupRows, type InitialPlsLikeSettings } from './groupUtils';
import { mgaApi } from './mgaApi';
import {
  CalculationTabSlider,
  PlsSetupTab,
  DataSetupTab,
  type PlsSetupSettings,
  type DataSetupSettings,
} from '../components/CalculationCommonTabs';

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
  const [activeTab, setActiveTab] = useState<'permutation' | 'pls' | 'data'>('permutation');
  const [stage, setStage] = useState<'config' | 'running' | 'error'>('config');

  const [selectedGroupAIds, setSelectedGroupAIds] = useState<string[]>([]);
  const [selectedGroupBIds, setSelectedGroupBIds] = useState<string[]>([]);
  const [permutationsText, setPermutationsText] = useState<string>('5000');
  const [testType, setTestType] = useState<'two-tailed' | 'one-tailed'>('two-tailed');
  const [sigLevelText, setSigLevelText] = useState<string>('0.05');
  const [parallelProcessing, setParallelProcessing] = useState<boolean>(true);
  const [seedText, setSeedText] = useState<string>('');

  const [plsSettings, setPlsSettings] = useState<PlsSetupSettings>({
    inner_weighting: (initialSettings?.inner_weighting as any) || 'path',
    result_type: 'standardized',
    initial_weights: 'equal',
    max_iter: initialSettings?.max_iter || 300,
    tolerance: 1e-7,
  });

  const [dataSettings, setDataSettings] = useState<DataSetupSettings>({
    missing_treatment: (initialSettings?.missing_treatment as any) || 'none',
    weight_column: null,
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
      setSelectedGroupAIds(dataGroups[0]?.id ? [dataGroups[0].id] : []);
      setSelectedGroupBIds(dataGroups[1]?.id ? [dataGroups[1].id] : []);
      setPermutationsText('5000');
      setTestType('two-tailed');
      setSigLevelText('0.05');
      setParallelProcessing(true);
      setSeedText('');
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
  }, [isOpen, dataGroups]);

  const groupA: DataGroup | null = useMemo(() => {
    const chosen = dataGroups.filter(g => selectedGroupAIds.includes(g.id));
    if (chosen.length === 0) return null;
    if (chosen.length === 1) return chosen[0];
    const allIndices = new Set<number>();
    for (const g of chosen) {
      const { indices } = getGroupRows(columns, rows, g);
      indices.forEach(i => allIndices.add(i));
    }
    const rowIds = Array.from(allIndices).sort((a, b) => a - b);
    return {
      id: `composite_a_${chosen.map(g => g.id).join('_')}`,
      name: chosen.map(g => g.name).join(' + '),
      conditionLinkType: 'OR',
      terms: [],
      recordCount: rowIds.length,
      rowIds,
    };
  }, [dataGroups, selectedGroupAIds, columns, rows]);

  const groupB: DataGroup | null = useMemo(() => {
    const chosen = dataGroups.filter(g => selectedGroupBIds.includes(g.id));
    if (chosen.length === 0) return null;
    if (chosen.length === 1) return chosen[0];
    const allIndices = new Set<number>();
    for (const g of chosen) {
      const { indices } = getGroupRows(columns, rows, g);
      indices.forEach(i => allIndices.add(i));
    }
    const rowIds = Array.from(allIndices).sort((a, b) => a - b);
    return {
      id: `composite_b_${chosen.map(g => g.id).join('_')}`,
      name: chosen.map(g => g.name).join(' + '),
      conditionLinkType: 'OR',
      terms: [],
      recordCount: rowIds.length,
      rowIds,
    };
  }, [dataGroups, selectedGroupBIds, columns, rows]);

  const parsedSigLevel = useMemo(() => {
    const val = parseFloat(sigLevelText.trim());
    return Number.isFinite(val) && val > 0 && val < 1 ? val : 0.05;
  }, [sigLevelText]);

  const preflight = useMemo(
    () => (isOpen ? checkGroupPairPreflight(columns, rows, spec, groupA || undefined, groupB || undefined, parsedSigLevel) : { blockingError: null, warnings: [] }),
    [isOpen, columns, rows, spec, groupA, groupB, parsedSigLevel]
  );

  if (!isOpen) return null;

  const handleRun = async () => {
    if (!groupA || !groupB) {
      setErrorMsg('Please select at least one data group for Group A and Group B.');
      return;
    }
    const overlap = selectedGroupAIds.some(id => selectedGroupBIds.includes(id));
    if (overlap && selectedGroupAIds.length === 1 && selectedGroupBIds.length === 1) {
      setErrorMsg('Group A and Group B must not be the same group.');
      return;
    }
    if (preflight.blockingError) {
      setErrorMsg(preflight.blockingError);
      return;
    }

    const perms = Number(permutationsText.trim());
    if (!Number.isInteger(perms) || perms < 10 || perms > 20000) {
      setErrorMsg('Permutations must be an integer between 10 and 20,000.');
      return;
    }

    const sigVal = parseFloat(sigLevelText.trim());
    if (Number.isNaN(sigVal) || sigVal <= 0 || sigVal >= 1) {
      setErrorMsg('Significance level must be a valid number between 0 and 1 (e.g. 0.05).');
      return;
    }

    let parsedSeed: number | null = null;
    if (seedText.trim() !== '') {
      const n = Number(seedText.trim());
      if (!Number.isSafeInteger(n) || n < 0) {
        setErrorMsg('Random seed must be a non-negative integer.');
        return;
      }
      parsedSeed = n;
    }

    cancelledRef.current = false;
    setErrorMsg(null);
    setStage('running');
    setCurrent(0);
    setTotal(perms);
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
        permutations: perms,
        testType,
        significanceLevel: sigVal,
        parallelProcessing,
        seed: parsedSeed,
        plsSettings: {
          weightingScheme: plsSettings.inner_weighting === 'centroid' ? 'centroid' : plsSettings.inner_weighting === 'factor' ? 'factor' : 'path',
          maxIterations: plsSettings.max_iter,
          stopCriterionExponent: 7,
          missingValues: dataSettings.missing_treatment === 'casewise' || dataSettings.missing_treatment === 'listwise'
            ? 'casewise'
            : dataSettings.missing_treatment === 'pairwise'
            ? 'pairwise'
            : 'mean',
          consistent,
        },
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
      <div className="modal calculation-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', width: '94vw' }}>
        <div className="modal__header">
          <h2 className="modal__title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            {consistent ? 'Consistent Permutation MGA' : 'Permutation MGA'}
          </h2>
          {stage !== 'running' && (
            <button className="calculation-close" type="button" aria-label="Close" onClick={onClose}>×</button>
          )}
        </div>

        <div className="modal__body">
          {errorMsg && (
            <div className="results-notice results-notice--danger" style={{ marginBottom: '12px' }}>{errorMsg}</div>
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
              <CalculationTabSlider
                tabs={[
                  { id: 'permutation', label: 'Permutation setup' },
                  { id: 'pls', label: 'PLS setup' },
                  { id: 'data', label: 'Data setup' },
                ]}
                activeTab={activeTab}
                onChange={t => setActiveTab(t as any)}
              />

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
                    {/* Group A Box */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: '8px',
                      padding: '12px',
                      background: 'var(--color-bg-base)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Group A</span>
                        <span style={{ fontSize: '11.5px', color: 'var(--color-text-muted)' }}>
                          n = {groupA?.recordCount ?? 0}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                        {dataGroups.map(g => {
                          const checked = selectedGroupAIds.includes(g.id);
                          return (
                            <label
                              key={g.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '5px 8px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                background: checked ? 'var(--color-accent-subtle)' : 'transparent',
                                fontSize: '12.5px',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setSelectedGroupAIds(prev =>
                                    prev.includes(g.id) ? prev.filter(id => id !== g.id) : [...prev, g.id]
                                  );
                                }}
                                style={{ cursor: 'pointer', accentColor: 'var(--color-accent)' }}
                              />
                              <span style={{ color: 'var(--color-text-primary)', fontWeight: checked ? 600 : 400 }}>
                                {g.name}
                              </span>
                              <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                                {g.recordCount}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Group B Box */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: '8px',
                      padding: '12px',
                      background: 'var(--color-bg-base)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Group B</span>
                        <span style={{ fontSize: '11.5px', color: 'var(--color-text-muted)' }}>
                          n = {groupB?.recordCount ?? 0}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                        {dataGroups.map(g => {
                          const checked = selectedGroupBIds.includes(g.id);
                          return (
                            <label
                              key={g.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '5px 8px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                background: checked ? 'var(--color-accent-subtle)' : 'transparent',
                                fontSize: '12.5px',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setSelectedGroupBIds(prev =>
                                    prev.includes(g.id) ? prev.filter(id => id !== g.id) : [...prev, g.id]
                                  );
                                }}
                                style={{ cursor: 'pointer', accentColor: 'var(--color-accent)' }}
                              />
                              <span style={{ color: 'var(--color-text-primary)', fontWeight: checked ? 600 : 400 }}>
                                {g.name}
                              </span>
                              <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                                {g.recordCount}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="modal__field" style={{ marginBottom: 0 }}>
                      <label className="modal__label">Permutations</label>
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
                      <label className="modal__label">Significance level</label>
                      <input
                        type="text"
                        className="modal__input"
                        value={sigLevelText}
                        onChange={e => setSigLevelText(e.target.value)}
                        placeholder="0.05"
                      />
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
                <PlsSetupTab settings={plsSettings} onChange={setPlsSettings} />
              )}

              {activeTab === 'data' && (
                <DataSetupTab
                  settings={dataSettings}
                  onChange={setDataSettings}
                  datasetHeaders={columns}
                  hideDataGroups={true}
                />
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
                disabled={Boolean(!groupA || !groupB || (selectedGroupAIds.length === 1 && selectedGroupBIds.length === 1 && selectedGroupAIds[0] === selectedGroupBIds[0]) || preflight.blockingError)}
              >
                Calculate
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
