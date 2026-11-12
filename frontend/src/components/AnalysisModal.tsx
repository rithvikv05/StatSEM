import React, { useState, useMemo } from 'react';
import { api } from '../utils/api';
import type { ModelSpec } from '../utils/api';
import { Checkbox } from './Checkbox';
import type { DataGroup } from '../mga/types';
import { getGroupRows } from '../mga/groupUtils';
import type { ModelCalculationSettings } from './ModelCalculationModal';
import { PlsSetupTab, DataSetupTab, type PlsSetupSettings, type DataSetupSettings } from './CalculationCommonTabs';

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
  fimix: 'Finite Mixture Segmentation (FIMIX)',
  pos: 'Prediction-Oriented Segmentation (POS)',
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

  // FIMIX settings
  const [minSegments, setMinSegments] = useState(1);
  const [maxSegments, setMaxSegments] = useState(4);
  const [fimixIterations, setFimixIterations] = useState(2000);
  const [fimixToleranceExp, setFimixToleranceExp] = useState(5);
  const [fimixRepetitions, setFimixRepetitions] = useState(10);
  const [fimixRandomSeed, setFimixRandomSeed] = useState(false);
  const [fimixSeed, setFimixSeed] = useState(42);

  // POS settings
  const [nSegments, setNSegments] = useState(2);
  const [posIterations, setPosIterations] = useState(50);
  const [searchDepth, setSearchDepth] = useState(10);
  const [initialSeparation, setInitialSeparation] = useState<'random' | 'fimix'>('random');
  const [preSegmentation, setPreSegmentation] = useState(false);
  const [criterion, setCriterion] = useState<'weighted_r2' | 'sum_r2' | 'target_r2'>('weighted_r2');
  const [posTarget, setPosTarget] = useState('');
  const [posRandomSeed, setPosRandomSeed] = useState(false);
  const [posSeed, setPosSeed] = useState(42);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const observedRanges = useMemo(() => {
    if (!isOpen || analysisType !== 'ipma') return [];
    const indList = new Set((spec?.constructs || []).flatMap(c => c.indicators).map(id => spec?.indicators?.find(ind => ind.id === id)?.column || id));
    const ranges = Array.from(indList).map(column => ({ column, index: datasetHeaders.indexOf(column), min: Infinity, max: -Infinity })).filter(v => v.index >= 0);
    for (const row of datasetRows) {
      for (const range of ranges) {
        const raw = row[range.index];
        if (raw === null || raw === undefined || raw === '') continue;
        const value = Number(raw);
        if (Number.isFinite(value) && value !== -99) {
          range.min = Math.min(range.min, value);
          range.max = Math.max(range.max, value);
        }
      }
    }
    return ranges;
  }, [isOpen, analysisType, spec, datasetHeaders, datasetRows]);

  if (!isOpen) return null;

  // Determine available tabs
  const getTabs = () => {
    switch (analysisType) {
      case 'pca':
        return [{ id: 'data', label: 'Data setup' }];
      case 'cta':
        return [
          { id: 'cta', label: 'CTA setup' },
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
      case 'fimix':
        return [
          { id: 'fimix', label: 'FIMIX setup' },
          { id: 'pls', label: 'PLS setup' },
          { id: 'data', label: 'Data setup' },
        ];
      case 'pos': {
        const list = [
          { id: 'pos', label: 'POS setup' },
          { id: 'pls', label: 'PLS setup' },
          { id: 'data', label: 'Data setup' },
        ];
        if (initialSeparation === 'fimix') {
          list.push({ id: 'fimix_init', label: 'FIMIX setup' });
        }
        return list;
      }
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
      } else if (analysisType === 'fimix') {
        chosenSeed = fimixRandomSeed ? crypto.getRandomValues(new Uint32Array(1))[0] : fimixSeed;
      } else if (analysisType === 'pos') {
        chosenSeed = posRandomSeed ? crypto.getRandomValues(new Uint32Array(1))[0] : posSeed;
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

        case 'fimix': {
          const tol = Math.pow(10, -fimixToleranceExp);
          res = await api.analyzeFimix({
            ...shared,
            minSegments,
            maxSegments,
            maxIter: fimixIterations,
            tolerance: tol,
            repetitions: fimixRepetitions,
            seed: chosenSeed,
          });
          break;
        }

        case 'pos': {
          if (criterion === 'target_r2' && !posTarget) {
            throw new Error('Select an outcome construct for the target R² optimization.');
          }
          const tol = Math.pow(10, -fimixToleranceExp);
          res = await api.analyzePos({
            ...shared,
            nSegments,
            maxIter: posIterations,
            searchDepth,
            initialSeparation,
            criterion,
            targetConstruct: posTarget || undefined,
            preSegmentation,
            fimixOptions: initialSeparation === 'fimix' ? {
              max_iter: fimixIterations,
              tol,
              n_repetitions: fimixRepetitions,
            } : undefined,
            seed: chosenSeed,
          });
          break;
        }

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
          <div>
            <h3 className="modal__title" id="analysis-modal-title">
              {titles[analysisType] || 'Calculation'}
            </h3>
            <p className="modal__subtitle">Configure settings and run estimation</p>
          </div>
          {!running && (
            <button className="calculation-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          )}
        </div>

        <div className="modal__body">
          {error && <div className="results-notice results-notice--danger">{error}</div>}

          {tabs.length > 1 && (
            <div className="view-toggle" role="tablist" style={{ alignSelf: 'flex-start' }}>
              {tabs.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.id}
                  className={`view-toggle__btn ${activeTab === t.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
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
                    <option value={0.01}>0.01 (99% CI)</option>
                    <option value={0.05}>0.05 (95% CI)</option>
                    <option value={0.1}>0.10 (90% CI)</option>
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
                    <option value="positive">Positive</option>
                    <option value="negative">Negative</option>
                  </select>
                </label>
              )}

              <label className="modal__field" style={{ marginBottom: 0 }}>
                <span className="modal__label">Construct</span>
                <select
                  className="modal__input"
                  value={ctaConstruct}
                  onChange={e => setCtaConstruct(e.target.value)}
                >
                  <option value="">All eligible constructs</option>
                  {constructs.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

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
                  <option value="">Select a target construct</option>
                  {constructs.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="modal__field" style={{ marginBottom: 0 }}>
                <span className="modal__label">IPMA results</span>
                <select
                  className="modal__input"
                  value={ipmaPredecessors}
                  onChange={e => setIpmaPredecessors(e.target.value as 'all' | 'direct')}
                >
                  <option value="all">All predecessors</option>
                  <option value="direct">Direct predecessors</option>
                </select>
              </label>

              <div style={{
                border: '1px solid var(--color-border-subtle)',
                borderRadius: '8px',
                padding: '10px 12px',
                background: 'var(--color-bg-surface)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                  Scale Min / Max &amp; Observed Ranges
                </span>
                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '11.5px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left', color: 'var(--color-text-muted)' }}>
                        <th style={{ padding: '4px 6px' }}>Indicator</th>
                        <th style={{ padding: '4px 6px' }}>Observed</th>
                        <th style={{ padding: '4px 6px' }}>Scale Min</th>
                        <th style={{ padding: '4px 6px' }}>Scale Max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {observedRanges.map(r => (
                        <tr key={r.column} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                          <td style={{ padding: '4px 6px', fontWeight: 500 }}>{r.column}</td>
                          <td style={{ padding: '4px 6px', color: 'var(--color-text-muted)' }}>
                            {Number.isFinite(r.min) ? `${r.min}–${r.max}` : '—'}
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

          {/* FIMIX setup */}
          {activeTab === 'fimix' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Minimum segments</span>
                  <input
                    type="number"
                    min={1}
                    className="modal__input"
                    value={minSegments}
                    onChange={e => setMinSegments(Number(e.target.value))}
                  />
                </label>

                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Maximum segments</span>
                  <input
                    type="number"
                    min={minSegments}
                    className="modal__input"
                    value={maxSegments}
                    onChange={e => setMaxSegments(Number(e.target.value))}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Maximum iterations</span>
                  <input
                    type="number"
                    min={10}
                    className="modal__input"
                    value={fimixIterations}
                    onChange={e => setFimixIterations(Number(e.target.value))}
                  />
                </label>

                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Stop criterion (10⁻ˣ)</span>
                  <input
                    type="number"
                    min={3}
                    max={10}
                    className="modal__input"
                    value={fimixToleranceExp}
                    onChange={e => setFimixToleranceExp(Number(e.target.value))}
                  />
                </label>
              </div>

              <label className="modal__field" style={{ marginBottom: 0 }}>
                <span className="modal__label">Number of repetitions</span>
                <input
                  type="number"
                  min={1}
                  className="modal__input"
                  value={fimixRepetitions}
                  onChange={e => setFimixRepetitions(Number(e.target.value))}
                />
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="calculation-check">
                  <Checkbox id="fimix-random-seed" checked={fimixRandomSeed} onChange={setFimixRandomSeed} />
                  <label htmlFor="fimix-random-seed">Random seed</label>
                </div>
                {!fimixRandomSeed && (
                  <label className="modal__field" style={{ marginBottom: 0 }}>
                    <span className="modal__label">Fixed seed</span>
                    <input
                      type="number"
                      min={0}
                      className="modal__input"
                      value={fimixSeed}
                      onChange={e => setFimixSeed(Number(e.target.value))}
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {/* POS setup */}
          {activeTab === 'pos' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Groups / Segments</span>
                  <input
                    type="number"
                    min={2}
                    className="modal__input"
                    value={nSegments}
                    onChange={e => setNSegments(Number(e.target.value))}
                  />
                </label>

                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Maximum iterations</span>
                  <input
                    type="number"
                    min={1}
                    className="modal__input"
                    value={posIterations}
                    onChange={e => setPosIterations(Number(e.target.value))}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Search depth</span>
                  <input
                    type="number"
                    min={1}
                    className="modal__input"
                    value={searchDepth}
                    onChange={e => setSearchDepth(Number(e.target.value))}
                  />
                </label>

                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Initial separation</span>
                  <select
                    className="modal__input"
                    value={initialSeparation}
                    onChange={e => setInitialSeparation(e.target.value as 'random' | 'fimix')}
                  >
                    <option value="random">Random</option>
                    <option value="fimix">FIMIX</option>
                  </select>
                </label>
              </div>

              <div className="calculation-check">
                <Checkbox id="pos-preseg" checked={preSegmentation} onChange={setPreSegmentation} />
                <label htmlFor="pos-preseg">Pre-segmentation on</label>
              </div>

              <label className="modal__field" style={{ marginBottom: 0 }}>
                <span className="modal__label">Optimization criterion</span>
                <select
                  className="modal__input"
                  value={criterion}
                  onChange={e => setCriterion(e.target.value as any)}
                >
                  <option value="weighted_r2">Weighted explained variance (R²)</option>
                  <option value="sum_r2">Sum of explained variance (R²)</option>
                  <option value="target_r2">Target explained variance (R²)</option>
                </select>
              </label>

              {criterion === 'target_r2' && (
                <label className="modal__field" style={{ marginBottom: 0 }}>
                  <span className="modal__label">Target construct</span>
                  <select
                    className="modal__input"
                    value={posTarget}
                    onChange={e => setPosTarget(e.target.value)}
                  >
                    <option value="">Select an outcome construct</option>
                    {constructs.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="calculation-check">
                  <Checkbox id="pos-random-seed" checked={posRandomSeed} onChange={setPosRandomSeed} />
                  <label htmlFor="pos-random-seed">Random seed</label>
                </div>
                {!posRandomSeed && (
                  <label className="modal__field" style={{ marginBottom: 0 }}>
                    <span className="modal__label">Fixed seed</span>
                    <input
                      type="number"
                      min={0}
                      className="modal__input"
                      value={posSeed}
                      onChange={e => setPosSeed(Number(e.target.value))}
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {/* FIMIX setup for POS initial separation */}
          {activeTab === 'fimix_init' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label className="modal__field" style={{ marginBottom: 0 }}>
                <span className="modal__label">FIMIX maximum iterations</span>
                <input
                  type="number"
                  min={10}
                  className="modal__input"
                  value={fimixIterations}
                  onChange={e => setFimixIterations(Number(e.target.value))}
                />
              </label>

              <label className="modal__field" style={{ marginBottom: 0 }}>
                <span className="modal__label">FIMIX stop criterion (10⁻ˣ)</span>
                <input
                  type="number"
                  min={3}
                  max={10}
                  className="modal__input"
                  value={fimixToleranceExp}
                  onChange={e => setFimixToleranceExp(Number(e.target.value))}
                />
              </label>

              <label className="modal__field" style={{ marginBottom: 0 }}>
                <span className="modal__label">FIMIX repetitions</span>
                <input
                  type="number"
                  min={1}
                  className="modal__input"
                  value={fimixRepetitions}
                  onChange={e => setFimixRepetitions(Number(e.target.value))}
                />
              </label>
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
