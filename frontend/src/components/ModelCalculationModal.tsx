import React, { useState } from 'react';
import type { ModelSpec } from '../utils/api';

export type ModelCalculationSettings = {
  inner_weighting: 'path' | 'factor' | 'centroid';
  missing_treatment: 'mean' | 'listwise' | 'none';
  max_iter: number;
  tolerance: number;
  initial_weights?: 'equal' | 'individual';
  individual_initial_weights?: Record<string, number> | null;
  data_filter?: { column: string; value: string | number | boolean } | null;
  weight_column?: string | null;
};

const defaultModelSettings: ModelCalculationSettings = {
  inner_weighting: 'path', missing_treatment: 'mean', max_iter: 300, tolerance: 1e-7,
};

export function ModelCalculationModal({ isOpen, consistent, initialSettings, spec, datasetHeaders = [], datasetRows = [], onClose, onRun, submitLabel = 'Run model' }: {
  isOpen: boolean; consistent: boolean; initialSettings?: Partial<ModelCalculationSettings>; spec?: ModelSpec; datasetHeaders?: string[]; datasetRows?: unknown[][];
  onClose: () => void; onRun: (settings: ModelCalculationSettings) => void; submitLabel?: string;
}) {
  const [settings, setSettings] = useState<ModelCalculationSettings>(() => ({ ...defaultModelSettings, ...initialSettings }));
  const indicators = Array.from(new Set((spec?.constructs || []).flatMap(c => c.indicators)));
  const [groupColumn, setGroupColumn] = useState(initialSettings?.data_filter?.column ?? '');
  const groupValues = Array.from(new Set(datasetRows.map(row => row[datasetHeaders.indexOf(groupColumn)]).filter(value => value !== null && value !== undefined && value !== '' && ['string', 'number', 'boolean'].includes(typeof value)).map(value => JSON.stringify(value)))).slice(0, 500);
  if (!isOpen) return null;
  const validWeights = settings.initial_weights !== 'individual' || (spec?.constructs || []).every(c => c.indicators.every(id => Number.isFinite(settings.individual_initial_weights?.[id])) && c.indicators.some(id => settings.individual_initial_weights?.[id] !== 0));
  const valid = validWeights && (!groupColumn || !!settings.data_filter) && Number.isInteger(settings.max_iter) && settings.max_iter >= 1 && settings.max_iter <= 5000 && settings.tolerance > 0 && settings.tolerance <= 0.01;
  return <div className="modal-overlay active calculation-overlay" role="presentation">
    <div className="modal calculation-dialog" role="dialog" aria-modal="true" aria-labelledby="model-calculation-title">
      <div className="modal__header"><div><div className="modal__title" id="model-calculation-title">{consistent ? 'Consistent PLS-SEM' : 'PLS-SEM'}</div><div className="modal__subtitle">Choose how to estimate the model.</div></div><button className="calculation-close" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="modal__body">
        <label className="modal__field"><span className="modal__label">Structural weighting</span><select className="modal__input" value={settings.inner_weighting} onChange={e => setSettings({ ...settings, inner_weighting: e.target.value as ModelCalculationSettings['inner_weighting'] })}><option value="path">Path</option><option value="factor">Factor</option><option value="centroid">Centroid</option></select></label>
        <label className="modal__field"><span className="modal__label">Missing values</span><select className="modal__input" value={settings.missing_treatment} onChange={e => setSettings({ ...settings, missing_treatment: e.target.value as ModelCalculationSettings['missing_treatment'] })}><option value="mean">Replace with indicator mean</option><option value="listwise">Exclude incomplete cases</option><option value="none">No replacement (require complete data)</option></select></label>
        <details className="calculation-more"><summary>More options</summary><div className="calculation-more__fields"><label className="modal__field"><span className="modal__label">Starting weights</span><select className="modal__input" value={settings.initial_weights || 'equal'} onChange={e => setSettings({ ...settings, initial_weights: e.target.value as 'equal' | 'individual', individual_initial_weights: e.target.value === 'individual' ? Object.fromEntries(indicators.map(id => [id, settings.individual_initial_weights?.[id] ?? 1])) : null })}><option value="equal">Default</option><option value="individual">Individual</option></select></label>{settings.initial_weights === 'individual' && indicators.map(id => <label key={id} className="modal__field"><span className="modal__label">{spec?.indicators?.find(i => i.id === id)?.column || id}</span><input className="modal__input" type="number" step="any" value={settings.individual_initial_weights?.[id] ?? ''} onChange={e => setSettings({ ...settings, individual_initial_weights: { ...settings.individual_initial_weights, [id]: e.target.value === '' ? Number.NaN : Number(e.target.value) } })}/></label>)}<label className="modal__field"><span className="modal__label">Observation weights</span><select className="modal__input" value={settings.weight_column || ''} onChange={e => setSettings({ ...settings, weight_column: e.target.value || null })}><option value="">None</option>{datasetHeaders.map(column => <option key={column} value={column}>{column}</option>)}</select></label><label className="modal__field"><span className="modal__label">Data group</span><select className="modal__input" value={groupColumn} onChange={e => { setGroupColumn(e.target.value); setSettings({ ...settings, data_filter: null }); }}><option value="">All observations</option>{datasetHeaders.map(column => <option value={column} key={column}>{column}</option>)}</select></label>{groupColumn && <label className="modal__field"><span className="modal__label">Group value</span><select className="modal__input" value={settings.data_filter ? JSON.stringify(settings.data_filter.value) : ''} onChange={e => setSettings({ ...settings, data_filter: e.target.value ? { column: groupColumn, value: JSON.parse(e.target.value) } : null })}><option value="">Select a value</option>{groupValues.map(value => <option key={value} value={value}>{String(JSON.parse(value))}</option>)}</select></label>}<label className="modal__field"><span className="modal__label">Maximum iterations</span><input className="modal__input" type="number" min="1" max="5000" value={settings.max_iter} onChange={e => setSettings({ ...settings, max_iter: Number(e.target.value) })}/></label><label className="modal__field"><span className="modal__label">Convergence tolerance</span><input className="modal__input" type="number" min="0" max="0.01" step="any" value={settings.tolerance} onChange={e => setSettings({ ...settings, tolerance: Number(e.target.value) })}/></label></div></details>
        <p className="calculation-note">Estimates are standardized.{settings.weight_column && ' Model fit indices are not available with observation weights.'}</p>
      </div>
      <div className="modal__footer"><button className="modal__btn-cancel" onClick={onClose}>Cancel</button><button className="modal__btn-create" disabled={!valid} onClick={() => onRun(settings)}>{submitLabel}</button></div>
    </div>
  </div>;
}
