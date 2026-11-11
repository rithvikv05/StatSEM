import React, { useState } from 'react';
import { api } from '../utils/api';
import type { ModelSpec } from '../utils/api';
import { Checkbox } from './Checkbox';
import type { ModelCalculationSettings } from './ModelCalculationModal';

export interface AnalysisModalProps {
  isOpen: boolean;
  analysisType: string;
  consistent?: boolean;
  projectPath: string;
  modelId?: string;
  datasetId?: string;
  spec?: ModelSpec;
  datasetHeaders?: string[];
  datasetRows?: unknown[][];
  initialSettings?: Partial<ModelCalculationSettings>;
  onComplete: (type: string, results: unknown) => void;
  onClose: () => void;
}

const titles: Record<string, string> = {
  ipma: 'Importance and performance', cta: 'Confirmatory tetrad analysis',
  mga: 'Multigroup analysis', fimix: 'Finite mixture segmentation',
  pos: 'Prediction-oriented segmentation', predict: 'Prediction and CVPAT', pca: 'Principal component analysis',
};

export const AnalysisModal: React.FC<AnalysisModalProps> = ({ isOpen, analysisType, consistent = false, projectPath, modelId = 'default', datasetId, spec, datasetHeaders = [], datasetRows = [], initialSettings, onComplete, onClose }) => {
  const constructs: Array<{id: string; name: string}> = (spec?.constructs || []).map(c => ({ id: c.id || c.name, name: c.name || c.id }));
  const [target, setTarget] = useState('');
  const [ipmaPredecessors, setIpmaPredecessors] = useState<'all' | 'direct'>('all');
  const [scaleBounds, setScaleBounds] = useState<Record<string, { min: string; max: string }>>({});
  const [source, setSource] = useState('');
  const [groupCol, setGroupCol] = useState('');
  const [group1, setGroup1] = useState('');
  const [group2, setGroup2] = useState('');
  const [filterColumn, setFilterColumn] = useState(initialSettings?.data_filter?.column || '');
  const [filterValue, setFilterValue] = useState(initialSettings?.data_filter ? JSON.stringify(initialSettings.data_filter.value) : '');
  const [nBoot, setNBoot] = useState(500);
  const [nPermutations, setNPermutations] = useState(500);
  const [seed, setSeed] = useState(42);
  const [randomSeed, setRandomSeed] = useState(false);
  const [fimixIterations, setFimixIterations] = useState(2000);
  const [fimixTolerance, setFimixTolerance] = useState(0.00001);
  const [fimixRepetitions, setFimixRepetitions] = useState(10);
  const [posIterations, setPosIterations] = useState(50);
  const [searchDepth, setSearchDepth] = useState(10);
  const [initialSeparation, setInitialSeparation] = useState<'random' | 'fimix'>('random');
  const [criterion, setCriterion] = useState<'weighted_r2' | 'sum_r2' | 'target_r2'>('weighted_r2');
  const [preSegmentation, setPreSegmentation] = useState(false);
  const [alpha, setAlpha] = useState(0.05);
  const [tails, setTails] = useState<'one' | 'two'>('two');
  const [direction, setDirection] = useState<'positive' | 'negative'>('positive');
  const [minSegments, setMinSegments] = useState(1);
  const [maxSegments, setMaxSegments] = useState(4);
  const [nSegments, setNSegments] = useState(2);
  const [folds, setFolds] = useState(10);
  const [antecedents, setAntecedents] = useState<'direct' | 'early'>('direct');
  const [repetitions, setRepetitions] = useState(10);
  const [cvpatResamples, setCvpatResamples] = useState(500);
  const [weighting, setWeighting] = useState<'path' | 'factor' | 'centroid'>(initialSettings?.inner_weighting || 'path');
  const [modelIterations, setModelIterations] = useState(initialSettings?.max_iter || 300);
  const [modelTolerance, setModelTolerance] = useState(initialSettings?.tolerance || 1e-7);
  const [missingTreatment, setMissingTreatment] = useState<'mean' | 'listwise' | 'none'>(initialSettings?.missing_treatment || 'mean');
  const [initialWeights, setInitialWeights] = useState<'equal' | 'individual'>(initialSettings?.initial_weights || 'equal');
  const [individualWeights, setIndividualWeights] = useState<Record<string, number>>(initialSettings?.individual_initial_weights || {});
  const [parallel, setParallel] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const observedRanges = React.useMemo(() => {
    if (!isOpen || analysisType !== 'ipma') return [];
    const indicators = new Set((spec?.constructs || []).flatMap(c => c.indicators).map(id => spec?.indicators?.find(ind => ind.id === id)?.column || id));
    const ranges = Array.from(indicators).map(column => ({ column, index: datasetHeaders.indexOf(column), min: Infinity, max: -Infinity })).filter(v => v.index >= 0);
    for (const row of datasetRows) for (const range of ranges) { const raw = row[range.index]; if (raw === null || raw === undefined || raw === '') continue; const value = Number(raw); if (Number.isFinite(value) && value !== -99) { range.min = Math.min(range.min, value); range.max = Math.max(range.max, value); } }
    return ranges;
  }, [isOpen, analysisType, spec, datasetHeaders, datasetRows]);
  if (!isOpen) return null;
  const uniqueValues = (column: string) => {
    const index = datasetHeaders.indexOf(column);
    if (!column || index < 0) return [];
    const values = new Set<string>();
    for (const row of datasetRows) {
      const value = row[index];
      if (value !== null && value !== undefined && value !== '' && ['string', 'number', 'boolean'].includes(typeof value)) values.add(JSON.stringify(value));
      if (values.size >= 500) break;
    }
    return [...values];
  };
  const groupValues = uniqueValues(groupCol);
  const filterValues = uniqueValues(filterColumn);
  const shared = { projectPath, modelId, datasetId, spec, columns: datasetHeaders, rows: datasetRows, settings: { inner_weighting: weighting, max_iter: modelIterations, tolerance: modelTolerance, initial_weights: ['cta', 'pca'].includes(analysisType) ? 'equal' : initialWeights, individual_initial_weights: !['cta', 'pca'].includes(analysisType) && initialWeights === 'individual' ? individualWeights : null, missing_treatment: ['predict', 'pca', 'cta'].includes(analysisType) ? 'listwise' : missingTreatment, ipma_predecessors: ipmaPredecessors, data_filter: filterColumn && filterValue ? { column: filterColumn, value: JSON.parse(filterValue) } : null } };
  const run = async () => {
    setRunning(true); setError('');
    try {
      const chosenSeed = randomSeed ? crypto.getRandomValues(new Uint32Array(1))[0] : seed;
      if (!Number.isSafeInteger(chosenSeed) || chosenSeed < 0) throw new Error('Enter a valid non-negative seed.');
      if (filterColumn && !filterValue) throw new Error('Select a value for the data group.');
      if (!Number.isInteger(modelIterations) || modelIterations < 1 || modelIterations > 5000 || !Number.isFinite(modelTolerance) || modelTolerance <= 0 || modelTolerance > 0.01) throw new Error('Enter a valid PLS iteration limit and tolerance.');
      if (['predict', 'ipma', 'mga', 'fimix', 'pos'].includes(analysisType) && initialWeights === 'individual' && !(spec?.constructs || []).every(c => c.indicators.every(id => Number.isFinite(individualWeights[id])) && c.indicators.some(id => individualWeights[id] !== 0))) throw new Error('Enter finite starting weights, with at least one nonzero weight per construct.');
      if (analysisType === 'fimix' && (!Number.isInteger(minSegments) || minSegments < 1 || !Number.isInteger(maxSegments) || maxSegments < minSegments || !Number.isInteger(fimixIterations) || fimixIterations < 1 || !Number.isInteger(fimixRepetitions) || fimixRepetitions < 1 || fimixTolerance <= 0)) throw new Error('Enter a valid segment range, iteration limit, tolerance and repetition count.');
      if (analysisType === 'pos' && criterion === 'target_r2' && !target) throw new Error('Select an outcome construct for the optimization.');
      if (analysisType === 'pos' && initialSeparation === 'fimix' && (!Number.isInteger(fimixIterations) || fimixIterations < 1 || !Number.isInteger(fimixRepetitions) || fimixRepetitions < 1 || fimixTolerance <= 0)) throw new Error('Enter valid FIMIX initialization settings.');
      if (analysisType === 'pos' && (!Number.isInteger(nSegments) || nSegments < 2 || !Number.isInteger(posIterations) || posIterations < 1 || !Number.isInteger(searchDepth) || searchDepth < 1)) throw new Error('Enter valid segment, iteration and search limits.');
      let res: { error?: string; results?: unknown };
      switch (analysisType) {
        case 'pca': res = await api.analyzePca(shared); break;
        case 'ipma':
          if (!target) throw new Error('Select a target construct.');
          { const bounds: Record<string, [number, number]> = {};
            for (const [column, range] of Object.entries(scaleBounds)) {
              if (!range.min && !range.max) continue;
              const min = Number(range.min), max = Number(range.max);
              if (!range.min || !range.max || !Number.isFinite(min) || !Number.isFinite(max) || min >= max) throw new Error(`Enter valid minimum and maximum scale values for ${column}.`);
              bounds[column] = [min, max];
            }
            res = await api.analyzeIpma({ ...shared, target, level: 'both', scaleBounds: bounds }); break; }
        case 'cta': res = await api.analyzeCta({ ...shared, constructId: source || undefined, nBoot, seed: chosenSeed, alpha, parallel, tails, direction }); break;
        case 'predict': res = await api.analyzePredict({ ...shared, kFolds: folds, repetitions, cvpatResamples, antecedents, seed: chosenSeed }); break;
        case 'fimix': res = await api.analyzeFimix({ ...shared, minSegments, maxSegments, maxIter: fimixIterations, tolerance: fimixTolerance, repetitions: fimixRepetitions, seed: chosenSeed }); break;
        case 'pos': res = await api.analyzePos({ ...shared, nSegments, maxIter: posIterations, searchDepth, initialSeparation, criterion, targetConstruct: target || undefined, preSegmentation, fimixOptions: initialSeparation === 'fimix' ? { max_iter: fimixIterations, tol: fimixTolerance, n_repetitions: fimixRepetitions } : undefined, seed: chosenSeed }); break;
        case 'mga':
          if (!groupCol) throw new Error('Select a group variable.');
          if ((!!group1 !== !!group2) || (group1 && group1 === group2)) throw new Error('Select two different groups, or leave both on automatic selection.');
          res = await api.analyzeMga({ ...shared, groupCol, groupValues: group1 && group2 ? [JSON.parse(group1), JSON.parse(group2)] : undefined, nBoot, nPermutations, seed: chosenSeed, alpha, tails, direction, consistent }); break;
        default: throw new Error('This analysis is not available.');
      }
      if (res?.error) throw new Error(res.error);
      onComplete(analysisType, res?.results || res); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Calculation failed.'); }
    finally { setRunning(false); }
  };
  const field = (label: string, value: number, set: (n: number) => void, min = 1, step = '1') => <label className="modal__field"><span className="modal__label">{label}</span><input className="modal__input" type="number" min={min} step={step} value={value} onChange={e => set(Number(e.target.value))}/></label>;
  return <div className="modal-overlay active calculation-overlay"><div className="modal calculation-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-title">
    <div className="modal__header"><div><div className="modal__title" id="analysis-title">{consistent ? 'Consistent multigroup analysis' : titles[analysisType]}</div><div className="modal__subtitle">Choose the settings for this calculation.</div></div>{!running && <button className="calculation-close" onClick={onClose} aria-label="Close">×</button>}</div>
    <div className="modal__body">
      {error && <p role="alert" className="calculation-error">{error}</p>}
      {analysisType === 'pca' && <p className="calculation-note">Calculates standardized components for each construct using complete cases.</p>}
      {analysisType === 'predict' && <p className="calculation-note">Prediction uses complete cases.</p>}
      <details className="calculation-more"><summary>Data group</summary><div className="calculation-more__fields"><label className="modal__field"><span className="modal__label">Group variable</span><select className="modal__input" value={filterColumn} onChange={e => { setFilterColumn(e.target.value); setFilterValue(''); }}><option value="">All observations</option>{datasetHeaders.map(column => <option key={column} value={column}>{column}</option>)}</select></label>{filterColumn && <label className="modal__field"><span className="modal__label">Group value</span><select className="modal__input" value={filterValue} onChange={e => setFilterValue(e.target.value)}><option value="">Select a value</option>{filterValues.map(value => <option key={value} value={value}>{String(JSON.parse(value))}</option>)}</select></label>}</div></details>
      {analysisType === 'ipma' && <label className="modal__field"><span className="modal__label">Target construct</span><select className="modal__input" value={target} onChange={e => setTarget(e.target.value)}><option value="">Select a construct</option>{constructs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {analysisType === 'ipma' && <label className="modal__field"><span className="modal__label">Show predecessors</span><select className="modal__input" value={ipmaPredecessors} onChange={e => setIpmaPredecessors(e.target.value as 'all' | 'direct')}><option value="all">All predecessors</option><option value="direct">Direct predecessors</option></select></label>}
      {analysisType === 'ipma' && <details className="calculation-more"><summary>Indicator scale ranges</summary><p className="calculation-note">Leave a range blank to use observed values. Set both bounds to use a known scale.</p><div style={{ maxHeight: 220, overflowY: 'auto' }}><table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>Indicator</th><th>Observed (all rows)</th><th>Scale minimum</th><th>Scale maximum</th></tr></thead><tbody>{observedRanges.map(range => <tr key={range.column}><td>{range.column}</td><td>{Number.isFinite(range.min) ? `${range.min}–${range.max}` : '—'}</td>{(['min', 'max'] as const).map(key => <td key={key}><input aria-label={`${range.column} scale ${key}`} className="modal__input" type="number" value={scaleBounds[range.column]?.[key] || ''} onChange={e => setScaleBounds(previous => ({ ...previous, [range.column]: { min: previous[range.column]?.min || '', max: previous[range.column]?.max || '', [key]: e.target.value } }))}/></td>)}</tr>)}</tbody></table></div></details>}
      {analysisType === 'cta' && <label className="modal__field"><span className="modal__label">Construct</span><select className="modal__input" value={source} onChange={e => setSource(e.target.value)}><option value="">All eligible constructs</option>{constructs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {analysisType === 'mga' && <><label className="modal__field"><span className="modal__label">Group variable</span><select className="modal__input" value={groupCol} onChange={e => { setGroupCol(e.target.value); setGroup1(''); setGroup2(''); }}><option value="">Select a variable</option>{datasetHeaders.map(h => <option key={h} value={h}>{h}</option>)}</select></label>{[{ label: 'First group', value: group1, set: setGroup1 }, { label: 'Second group', value: group2, set: setGroup2 }].map(f => <label key={f.label} className="modal__field"><span className="modal__label">{f.label}</span><select className="modal__input" value={f.value} onChange={e => f.set(e.target.value)}><option value="">Automatic</option>{groupValues.map(v => <option key={v} value={v}>{String(JSON.parse(v))}</option>)}</select></label>)}<p className="calculation-note">Runs bootstrap and permutation group comparisons.</p></>}
      {analysisType === 'predict' && <>{field('Folds', folds, setFolds, 2)}{field('Repetitions', repetitions, setRepetitions)}<label className="modal__field"><span className="modal__label">Prediction inputs</span><select className="modal__input" value={antecedents} onChange={e => setAntecedents(e.target.value as 'direct' | 'early')}><option value="direct">Direct antecedents</option><option value="early">Earliest antecedents</option></select></label></>}
      {analysisType === 'fimix' && <>{field('Minimum segments', minSegments, setMinSegments)}{field('Maximum segments', maxSegments, setMaxSegments)}</>}
      {analysisType === 'pos' && field('Segments', nSegments, setNSegments, 2)}
      {['cta', 'mga'].includes(analysisType) && field('Bootstrap resamples', nBoot, setNBoot)}
      {['predict', 'ipma', 'mga', 'fimix', 'pos'].includes(analysisType) && <details className="calculation-more"><summary>PLS estimation</summary><div className="calculation-more__fields"><label className="modal__field"><span className="modal__label">Structural weighting</span><select className="modal__input" value={weighting} onChange={e => setWeighting(e.target.value as typeof weighting)}><option value="path">Path</option><option value="factor">Factor</option><option value="centroid">Centroid</option></select></label>{field('Maximum iterations', modelIterations, setModelIterations)}{field('Convergence tolerance', modelTolerance, setModelTolerance, 0.00000001, 'any')}</div></details>}
      {['predict', 'ipma', 'mga', 'fimix', 'pos'].includes(analysisType) && <details className="calculation-more"><summary>Starting weights</summary><div className="calculation-more__fields"><label className="modal__field"><span className="modal__label">Initial weights</span><select className="modal__input" value={initialWeights} onChange={e => { const mode = e.target.value as typeof initialWeights; setInitialWeights(mode); if (mode === 'individual') setIndividualWeights(previous => { const next = { ...previous }; for (const construct of spec?.constructs || []) for (const id of construct.indicators) if (!Number.isFinite(next[id])) next[id] = 1; return next; }); }}><option value="equal">Default</option><option value="individual">Individual</option></select></label>{initialWeights === 'individual' && Array.from(new Set((spec?.constructs || []).flatMap(c => c.indicators))).map(id => <label className="modal__field" key={id}><span className="modal__label">{spec?.indicators?.find(ind => ind.id === id)?.column || id}</span><input className="modal__input" type="number" step="any" value={Number.isFinite(individualWeights[id]) ? individualWeights[id] : ''} onChange={e => setIndividualWeights(previous => ({ ...previous, [id]: e.target.value === '' ? Number.NaN : Number(e.target.value) }))}/></label>)}</div></details>}
      {['ipma', 'mga', 'fimix', 'pos'].includes(analysisType) && <label className="modal__field"><span className="modal__label">Missing values</span><select className="modal__input" value={missingTreatment} onChange={e => setMissingTreatment(e.target.value as typeof missingTreatment)}><option value="mean">Replace with indicator mean</option><option value="listwise">Exclude incomplete cases</option><option value="none">Require complete data</option></select></label>}
      {analysisType === 'mga' && field('Permutations', nPermutations, setNPermutations)}
      {['cta', 'mga', 'predict', 'fimix', 'pos'].includes(analysisType) && <details className="calculation-more"><summary>More options</summary><div className="calculation-more__fields">
        {analysisType === 'predict' && field('CVPAT resamples', cvpatResamples, setCvpatResamples, 2)}
        {analysisType === 'fimix' && <>{field('Maximum iterations', fimixIterations, setFimixIterations)}{field('Convergence tolerance', fimixTolerance, setFimixTolerance, 0.00000001, 'any')}{field('Starting repetitions', fimixRepetitions, setFimixRepetitions)}</>}
        {analysisType === 'pos' && <>{field('Maximum iterations', posIterations, setPosIterations)}{field('Search depth', searchDepth, setSearchDepth)}
          <label className="modal__field"><span className="modal__label">Initial groups</span><select className="modal__input" value={initialSeparation} onChange={e => setInitialSeparation(e.target.value as 'random' | 'fimix')}><option value="random">Random</option><option value="fimix">FIMIX</option></select></label>
          <label className="modal__field"><span className="modal__label">Optimization</span><select className="modal__input" value={criterion} onChange={e => setCriterion(e.target.value as 'weighted_r2' | 'sum_r2' | 'target_r2')}><option value="weighted_r2">Weighted explained variance</option><option value="sum_r2">Sum of explained variance</option><option value="target_r2">Target explained variance</option></select></label>
          {criterion === 'target_r2' && <label className="modal__field"><span className="modal__label">Target construct</span><select className="modal__input" value={target} onChange={e => setTarget(e.target.value)}><option value="">Select an outcome</option>{constructs.filter(c => spec?.paths.some(p => p.to === c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          <div className="calculation-check"><Checkbox id="pos-presegmentation" checked={preSegmentation} onChange={setPreSegmentation}/><label htmlFor="pos-presegmentation">Use pre-segmentation</label></div>
          {initialSeparation === 'fimix' && <>{field('FIMIX maximum iterations', fimixIterations, setFimixIterations)}{field('FIMIX convergence tolerance', fimixTolerance, setFimixTolerance, 0.00000001, 'any')}{field('FIMIX starting repetitions', fimixRepetitions, setFimixRepetitions)}</>}
        </>}
        <div className="calculation-check"><Checkbox id="analysis-random-seed" checked={randomSeed} onChange={setRandomSeed}/><label htmlFor="analysis-random-seed">Generate a random seed</label></div>
        {!randomSeed && field('Random seed', seed, setSeed, 0)}
        {['cta', 'mga'].includes(analysisType) && field('Significance level', alpha, setAlpha, 0.001, '0.01')}
        {['mga', 'cta'].includes(analysisType) && <><label className="modal__field"><span className="modal__label">Hypothesis test</span><select className="modal__input" value={tails} onChange={e => setTails(e.target.value as typeof tails)}><option value="two">Two-sided</option><option value="one">One-sided</option></select></label>{tails === 'one' && <label className="modal__field"><span className="modal__label">{analysisType === 'mga' ? 'Expected first minus second group' : 'Expected tetrad direction'}</span><select className="modal__input" value={direction} onChange={e => setDirection(e.target.value as typeof direction)}><option value="positive">Positive</option><option value="negative">Negative</option></select></label>}{analysisType === 'cta' && tails === 'one' && <p className="calculation-note">The chosen direction applies to every tetrad; its sign depends on the indicator order.</p>}{analysisType === 'cta' && <div className="calculation-check"><Checkbox id="cta-parallel" checked={parallel} onChange={setParallel}/><label htmlFor="cta-parallel">Use parallel processing</label></div>}</>}
      </div></details>}
    </div>
    <div className="modal__footer"><button className="modal__btn-cancel" disabled={running} onClick={onClose}>Cancel</button><button className="modal__btn-create" disabled={running} onClick={() => void run()}>{running ? 'Running…' : 'Run calculation'}</button></div>
  </div></div>;
};
