import React, { useState, useMemo } from 'react';
import { api } from '../utils/api';
import type { ModelSpec } from '../utils/api';
import { Checkbox } from './Checkbox';
import type { DataGroup } from '../mga/types';
import { getGroupRows } from '../mga/groupUtils';
import type { ModelCalculationSettings } from './ModelCalculationModal';
import { PlsSetupTab, DataSetupTab, CalculationTabSlider, type PlsSetupSettings, type DataSetupSettings } from './CalculationCommonTabs';

export interface AnalysisModalProps {
  isOpen: boolean;
  analysisType: string;
  consistent?: boolean;
  projectPath: string;
  modelId?: string;
  datasetId?: string;
  spec?: ModelSpec;
  dataGroups?: DataGroup[];
  datasetHeaders?: string[];
  datasetRows?: unknown[][];
  initialSettings?: Partial<ModelCalculationSettings>;
  onComplete: (type: string, results: unknown) => void;
  onClose: () => void;
}

const titles: Record<string, string> = {
  ipma: 'Importance-Performance Map Analysis (IPMA)',
  cta: 'Confirmatory Tetrad Analysis (CTA)',
  predict: 'PLSpredict / CVPAT',
  pca: 'Principal Component Analysis (PCA)',
};

export const AnalysisModal: React.FC<AnalysisModalProps> = ({
  isOpen,
  analysisType,
  consistent = false,
  projectPath,
  modelId = 'default',
  datasetId,
  spec,
  dataGroups = [],
  datasetHeaders = [],
  datasetRows = [],
  initialSettings,
  onComplete,
  onClose,
}) => {
  const constructs: Array<{ id: string; name: string }> = useMemo(() => {
    return (spec?.constructs || []).map(c => ({ id: c.id || c.name, name: c.name || c.id }));
  }, [spec]);

  const indicators = useMemo(() => {
    return Array.from(new Set((spec?.constructs || []).flatMap(c => c.indicators))).map(id => {
      const match = spec?.indicators?.find(i => i.id === id);
      return { id, label: match?.column || id };
    });
  }, [spec]);

  // Initial tab selection based on analysisType
  const initialTab = analysisType === 'pca' ? 'data' : (analysisType === 'predict' ? 'predict' : analysisType);
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  // Common PLS & Data setups
  const [plsSetup, setPlsSetup] = useState<PlsSetupSettings>({
    inner_weighting: (initialSettings?.inner_weighting as any) || 'path',
    result_type: (initialSettings?.result_type as any) || 'standardized',
    initial_weights: (initialSettings?.initial_weights as any) || 'equal',
    individual_initial_weights: initialSettings?.individual_initial_weights,
    max_iter: initialSettings?.max_iter || 300,
    tolerance: initialSettings?.tolerance || 1e-7,
  });

  const [dataSetup, setDataSetup] = useState<DataSetupSettings>({
    missing_treatment: ['predict', 'pca', 'cta'].includes(analysisType)
      ? 'casewise'
      : (initialSettings?.missing_treatment === 'listwise' ? 'casewise' : (initialSettings?.missing_treatment as any) || 'mean'),
    selected_data_group_id: initialSettings?.selected_data_group_id || null,
    data_filter: initialSettings?.data_filter || null,
    weight_column: initialSettings?.weight_column || null,
  });

  // IPMA settings
  const [target, setTarget] = useState(constructs[0]?.id || '');
  const [ipmaPredecessors, setIpmaPredecessors] = useState<'all' | 'direct'>('all');
  const [scaleBounds, setScaleBounds] = useState<Record<string, { min: string; max: string }>>({});

  // CTA settings
  const [ctaConstruct, setCtaConstruct] = useState('');
  const [ctaSubsamples, setCtaSubsamples] = useState(500);
  const [ctaParallel, setCtaParallel] = useState(true);
  const [ctaTails, setCtaTails] = useState<'one' | 'two'>('two');
  const [ctaDirection, setCtaDirection] = useState<'positive' | 'negative'>('positive');
  const [ctaAlpha, setCtaAlpha] = useState(0.05);
  const [ctaRandomSeed, setCtaRandomSeed] = useState(false);
  const [ctaSeed, setCtaSeed] = useState(42);

  // PLSpredict settings
  const [folds, setFolds] = useState(10);
  const [repetitions, setRepetitions] = useState(10);
  const [antecedents, setAntecedents] = useState<'direct' | 'early'>('direct');
  const [predictRandomSeed, setPredictRandomSeed] = useState(false);
  const [predictSeed, setPredictSeed] = useState(42);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const observedRanges = useMemo(() => {
    if (!isOpen || analysisType !== 'ipma') return [];
    const indList = new Set((spec?.constructs || []).flatMap(c => c.indicators).map(id => spec?.indicators?.find(ind => ind.id === id)?.column || id));
    const ranges = Array.from(indList).map(column => ({ column, index: datasetHeaders.indexOf(column), min: Infinity, max: -Infinity })).filter(v => v.index >= 0);
    for (const row of datasetRows) {
      if (!Array.isArray(row)) continue;
      for (const r of ranges) {
        const val = Number(row[r.index]);
        if (Number.isFinite(val)) {
          if (val < r.min) r.min = val;
          if (val > r.max) r.max = val;
        }
      }
    }
    return ranges;
  }, [isOpen, analysisType, spec, datasetHeaders, datasetRows]);

  if (!isOpen) return null;

  const getTabs = () => {
    switch (analysisType) {
      case 'cta':
        return [
          { id: 'cta', label: 'CTA setup' },
          { id: 'pls', label: 'PLS setup' },
          { id: 'data', label: 'Data setup' },
        ];
      case 'ipma':
        return [
          { id: 'ipma', label: 'IPMA setup' },
          { id: 'pls', label: 'PLS setup' },
          { id: 'data', label: 'Data setup' },
        ];
      case 'predict':
        return [
          { id: 'predict', label: 'PLSpredict setup' },
          { id: 'pls', label: 'PLS setup' },
          { id: 'data', label: 'Data setup' },
        ];
      default:
        return [
          { id: 'pls', label: 'PLS setup' },
          { id: 'data', label: 'Data setup' },
        ];
    }
  };

  const tabs = getTabs();

  const run = async () => {
    setRunning(true);
    setError('');
    try {
      let chosenSeed = 42;
      if (analysisType === 'cta') {
        chosenSeed = ctaRandomSeed ? crypto.getRandomValues(new Uint32Array(1))[0] : ctaSeed;
      } else if (analysisType === 'predict') {
        chosenSeed = predictRandomSeed ? crypto.getRandomValues(new Uint32Array(1))[0] : predictSeed;
      }

      let effectiveFilter = dataSetup.data_filter;
      let effectiveRows = datasetRows;
      if (dataSetup.selected_data_group_id) {
        const group = dataGroups.find(g => g.id === dataSetup.selected_data_group_id);
        if (group) {
          if (group.terms?.length === 1 && group.terms[0].operator === 'is equal to') {
            effectiveFilter = { column: group.terms[0].column, value: group.terms[0].value1 };
          }
          if (datasetHeaders && datasetRows.length > 0) {
            const { rows: filtered } = getGroupRows(datasetHeaders, datasetRows as any[][], group);
            if (filtered.length === 0) {
              throw new Error('The selected data group has no observations.');
            }
            effectiveRows = filtered;
          }
        }
      }

      const missingTreatmentKey = (dataSetup.missing_treatment === 'casewise' || dataSetup.missing_treatment === 'pairwise')
        ? 'listwise'
        : (dataSetup.missing_treatment as any);

      const shared = {
        projectPath,
        modelId,
        datasetId,
        spec,
        columns: datasetHeaders,
        rows: effectiveRows,
        settings: {
          inner_weighting: plsSetup.inner_weighting,
          max_iter: plsSetup.max_iter,
          tolerance: plsSetup.tolerance,
          initial_weights: ['cta', 'pca'].includes(analysisType) ? 'equal' : plsSetup.initial_weights,
          individual_initial_weights: !['cta', 'pca'].includes(analysisType) && plsSetup.initial_weights === 'individual'
            ? plsSetup.individual_initial_weights
            : null,
          missing_treatment: ['predict', 'pca', 'cta'].includes(analysisType) ? 'listwise' : missingTreatmentKey,
          ipma_predecessors: ipmaPredecessors,
          data_filter: effectiveFilter,
          weight_column: analysisType === 'predict' ? null : dataSetup.weight_column,
        },
      };

      let res: { error?: string; results?: unknown };
      switch (analysisType) {
        case 'pca':
          res = await api.analyzePca(shared);
          break;

        case 'ipma': {
          if (!target) throw new Error('Select a target construct for IPMA.');
          const bounds: Record<string, [number, number]> = {};
          for (const [column, range] of Object.entries(scaleBounds)) {
            if (!range.min && !range.max) continue;
            const min = Number(range.min);
            const max = Number(range.max);
            if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
              throw new Error(`Enter valid minimum and maximum scale values for ${column}.`);
            }
            bounds[column] = [min, max];
          }
          res = await api.analyzeIpma({ ...shared, target, level: 'both', scaleBounds: bounds });
          break;
        }

        case 'cta':
          res = await api.analyzeCta({
            ...shared,
            constructId: ctaConstruct || undefined,
            nBoot: ctaSubsamples,
            seed: chosenSeed,
            alpha: ctaAlpha,
            parallel: ctaParallel,
            tails: ctaTails,
            direction: ctaDirection,
          });
          break;

        case 'predict':
          res = await api.analyzePredict({
            ...shared,
            kFolds: folds,
            repetitions,
            cvpatResamples: 500,
            antecedents,
            seed: chosenSeed,
          });
          break;

        default:
          throw new Error('This calculation is not available.');
      }

      if (res?.error) throw new Error(res.error);
      onComplete(analysisType, res?.results || res);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Calculation failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modal-overlay active calculation-overlay" role="presentation">
      <div
        className="modal calculation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="analysis-modal-title"
        style={{ maxWidth: 580, width: '94vw' }}
      >
        <div className="modal__header">
          <h2 className="modal__title" id="analysis-modal-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            {titles[analysisType] || 'Calculation'}
          </h2>
          {!running && (
            <button className="calculation-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          )}
        </div>

        <div className="modal__body">
          {error && <div className="results-notice results-notice--danger">{error}</div>}

          {tabs.length > 1 && (
            <CalculationTabSlider
              tabs={tabs}
              activeTab={activeTab}
              onChange={setActiveTab}
            />
          )}

          {/* CTA setup */}
          {activeTab === 'cta' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label className="modal__field" style={{ marginBottom: 0 }}>
                <span className="modal__label">Subsamples</span>
                <input
                  type="number"
                  min={100}
                  step={100}
                  className="modal__input"
                  value={ctaSubsamples}
                  onChange={e => setCtaSubsamples(Number(e.target.value))}
                />
              </label>

              <div className="calculation-check">
                <Checkbox id="cta-parallel" checked={ctaParallel} onChange={setCtaParallel} />
                <label htmlFor="cta-parallel">Parallel processing</label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Test type</span>
                  <select
                    className="modal__input"
                    value={ctaTails}
                    onChange={e => setCtaTails(e.target.value as 'one' | 'two')}
                  >
                    <option value="two">Two-tailed</option>
                    <option value="one">One-tailed</option>
                  </select>
                </label>

                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Significance level</span>
                  <select
                    className="modal__input"
                    value={ctaAlpha}
                    onChange={e => setCtaAlpha(Number(e.target.value))}
                  >
                    <option value={0.1}>0.10</option>
                    <option value={0.05}>0.05</option>
                    <option value={0.01}>0.01</option>
                  </select>
                </label>
              </div>

              {ctaTails === 'one' && (
                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Expected tetrad direction</span>
                  <select
                    className="modal__input"
                    value={ctaDirection}
                    onChange={e => setCtaDirection(e.target.value as 'positive' | 'negative')}
                  >
                    <option value="positive">Positive (+)</option>
                    <option value="negative">Negative (-)</option>
                  </select>
                </label>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="calculation-check">
                  <Checkbox id="cta-random-seed" checked={ctaRandomSeed} onChange={setCtaRandomSeed} />
                  <label htmlFor="cta-random-seed">Random seed</label>
                </div>
                {!ctaRandomSeed && (
                  <label className="modal__field" style={{ marginBottom: 0 }}>
                    <span className="modal__label">Fixed seed</span>
                    <input
                      type="number"
                      min={0}
                      className="modal__input"
                      value={ctaSeed}
                      onChange={e => setCtaSeed(Number(e.target.value))}
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {/* IPMA setup */}
          {activeTab === 'ipma' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label className="modal__field" style={{ marginBottom: 0 }}>
                <span className="modal__label">Target construct</span>
                <select
                  className="modal__input"
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                >
                  <option value="">Select a construct</option>
                  {constructs.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="modal__field" style={{ marginBottom: 0 }}>
                <span className="modal__label">Predecessors</span>
                <select
                  className="modal__input"
                  value={ipmaPredecessors}
                  onChange={e => setIpmaPredecessors(e.target.value as 'all' | 'direct')}
                >
                  <option value="all">All predecessors (direct and indirect)</option>
                  <option value="direct">Direct predecessors only</option>
                </select>
              </label>

              <div>
                <label className="modal__label" style={{ display: 'block', marginBottom: '6px' }}>
                  Indicator scale ranges
                </label>
                <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
                  Set minimum and maximum possible scale values to unscale indicator scores to 0-100.
                </div>
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--color-border-subtle)', borderRadius: 6 }}>
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <thead style={{ background: 'var(--color-bg-subtle)', position: 'sticky', top: 0 }}>
                      <tr>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Indicator</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Observed range</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Scale min</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Scale max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {observedRanges.map(r => (
                        <tr key={r.column} style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                          <td style={{ padding: '4px 8px', fontWeight: 500 }}>{r.column}</td>
                          <td style={{ padding: '4px 8px', color: 'var(--color-text-muted)' }}>
                            {Number.isFinite(r.min) ? `${r.min} - ${r.max}` : '-'}
                          </td>
                          <td style={{ padding: '4px 6px' }}>
                            <input
                              type="number"
                              className="modal__input"
                              style={{ height: '26px', fontSize: '11px', width: '70px' }}
                              placeholder={Number.isFinite(r.min) ? String(r.min) : ''}
                              value={scaleBounds[r.column]?.min || ''}
                              onChange={e => setScaleBounds(prev => ({
                                ...prev,
                                [r.column]: { min: e.target.value, max: prev[r.column]?.max || '' },
                              }))}
                            />
                          </td>
                          <td style={{ padding: '4px 6px' }}>
                            <input
                              type="number"
                              className="modal__input"
                              style={{ height: '26px', fontSize: '11px', width: '70px' }}
                              placeholder={Number.isFinite(r.max) ? String(r.max) : ''}
                              value={scaleBounds[r.column]?.max || ''}
                              onChange={e => setScaleBounds(prev => ({
                                ...prev,
                                [r.column]: { min: prev[r.column]?.min || '', max: e.target.value },
                              }))}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* PLSpredict setup */}
          {activeTab === 'predict' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Number of folds (k-folds)</span>
                  <input
                    type="number"
                    min={2}
                    className="modal__input"
                    value={folds}
                    onChange={e => setFolds(Number(e.target.value))}
                  />
                </label>

                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Number of repetitions</span>
                  <input
                    type="number"
                    min={1}
                    className="modal__input"
                    value={repetitions}
                    onChange={e => setRepetitions(Number(e.target.value))}
                  />
                </label>
              </div>

              <label className="modal__field" style={{ marginBottom: 0 }}>
                <span className="modal__label">Prediction type</span>
                <select
                  className="modal__input"
                  value={antecedents}
                  onChange={e => setAntecedents(e.target.value as 'direct' | 'early')}
                >
                  <option value="direct">Direct antecedents</option>
                  <option value="early">Earliest antecedents</option>
                </select>
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="calculation-check">
                  <Checkbox id="predict-random-seed" checked={predictRandomSeed} onChange={setPredictRandomSeed} />
                  <label htmlFor="predict-random-seed">Random seed</label>
                </div>
                {!predictRandomSeed && (
                  <label className="modal__field" style={{ marginBottom: 0 }}>
                    <span className="modal__label">Fixed seed</span>
                    <input
                      type="number"
                      min={0}
                      className="modal__input"
                      value={predictSeed}
                      onChange={e => setPredictSeed(Number(e.target.value))}
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {/* PLS setup tab */}
          {activeTab === 'pls' && (
            <PlsSetupTab
              settings={plsSetup}
              onChange={setPlsSetup}
              indicators={indicators}
            />
          )}

          {/* Data setup tab */}
          {activeTab === 'data' && (
            <DataSetupTab
              settings={dataSetup}
              onChange={setDataSetup}
              dataGroups={dataGroups}
              datasetHeaders={datasetHeaders}
              hideWeightingVector={analysisType === 'predict'}
            />
          )}
        </div>

        <div className="modal__footer">
          <button className="modal__btn-cancel" disabled={running} onClick={onClose}>
            Cancel
          </button>
          <button className="modal__btn-create" disabled={running} onClick={() => void run()}>
            {running ? 'Running…' : 'Run calculation'}
          </button>
        </div>
      </div>
    </div>
  );
};
export default AnalysisModal;
