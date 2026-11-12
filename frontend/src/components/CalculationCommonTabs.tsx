import React from 'react';
import type { DataGroup } from '../mga/types';

export interface PlsSetupSettings {
  inner_weighting: 'path' | 'factor' | 'centroid';
  result_type?: 'standardized' | 'unstandardized' | 'mean_centered';
  initial_weights: 'equal' | 'individual';
  individual_initial_weights?: Record<string, number> | null;
  max_iter: number;
  tolerance: number;
}

export interface DataSetupSettings {
  missing_treatment: 'mean' | 'casewise' | 'listwise' | 'pairwise' | 'none';
  selected_data_group_id?: string | null;
  data_filter?: { column: string; value: string | number | boolean } | null;
  weight_column?: string | null;
}

interface PlsSetupTabProps {
  settings: PlsSetupSettings;
  onChange: (settings: PlsSetupSettings) => void;
  indicators?: Array<{ id: string; label: string }>;
}

export const PlsSetupTab: React.FC<PlsSetupTabProps> = ({ settings, onChange, indicators = [] }) => {
  const stopExponent = Math.max(3, Math.min(12, Math.round(-Math.log10(settings.tolerance || 1e-7))));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <label className="modal__field" style={{ marginBottom: 0 }}>
        <span className="modal__label">Weighting scheme</span>
        <select
          className="modal__input"
          value={settings.inner_weighting}
          onChange={e => onChange({ ...settings, inner_weighting: e.target.value as PlsSetupSettings['inner_weighting'] })}
        >
          <option value="path">Path (Recommended)</option>
          <option value="factor">Factor</option>
          <option value="centroid">Centroid (PCA)</option>
        </select>
      </label>

      <label className="modal__field" style={{ marginBottom: 0 }}>
        <span className="modal__label">Type of results</span>
        <select
          className="modal__input"
          value={settings.result_type || 'standardized'}
          onChange={e => onChange({ ...settings, result_type: e.target.value as PlsSetupSettings['result_type'] })}
        >
          <option value="standardized">Standardized</option>
          <option value="unstandardized">Unstandardized</option>
          <option value="mean_centered">Mean centered</option>
        </select>
      </label>

      <label className="modal__field" style={{ marginBottom: 0 }}>
        <span className="modal__label">Initial weight</span>
        <select
          className="modal__input"
          value={settings.initial_weights === 'individual' ? 'individual' : 'default'}
          onChange={e => {
            const isIndividual = e.target.value === 'individual';
            const individualWeights = isIndividual
              ? Object.fromEntries(indicators.map(i => [i.id, settings.individual_initial_weights?.[i.id] ?? 1]))
              : null;
            onChange({
              ...settings,
              initial_weights: isIndividual ? 'individual' : 'equal',
              individual_initial_weights: individualWeights,
            });
          }}
        >
          <option value="default">Default</option>
          <option value="individual">Individual</option>
        </select>
      </label>

      {settings.initial_weights === 'individual' && indicators.length > 0 && (
        <div style={{
          maxHeight: 180,
          overflowY: 'auto',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '8px',
          padding: '10px 12px',
          background: 'var(--color-bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
            Indicator Starting Weights
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
            {indicators.map(i => (
              <label key={i.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px' }}>
                <span style={{ color: 'var(--color-text-secondary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={i.label}>{i.label}</span>
                <input
                  type="number"
                  step="any"
                  className="modal__input"
                  style={{ height: '28px', fontSize: '12px' }}
                  value={settings.individual_initial_weights?.[i.id] ?? 1}
                  onChange={e => onChange({
                    ...settings,
                    individual_initial_weights: {
                      ...settings.individual_initial_weights,
                      [i.id]: e.target.value === '' ? Number.NaN : Number(e.target.value),
                    },
                  })}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <label className="modal__field" style={{ marginBottom: 0 }}>
          <span className="modal__label">Maximum iterations</span>
          <input
            type="number"
            min={1}
            max={5000}
            className="modal__input"
            value={settings.max_iter}
            onChange={e => onChange({ ...settings, max_iter: Math.max(1, Math.min(5000, Number(e.target.value) || 300)) })}
          />
        </label>
        <label className="modal__field" style={{ marginBottom: 0 }}>
          <span className="modal__label">Stop criterion (10⁻ˣ)</span>
          <input
            type="number"
            min={3}
            max={12}
            className="modal__input"
            value={stopExponent}
            onChange={e => {
              const exp = Math.max(3, Math.min(12, Number(e.target.value) || 7));
              onChange({ ...settings, tolerance: Math.pow(10, -exp) });
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px', display: 'block' }}>
            {stopExponent} means 10⁻{stopExponent}
          </span>
        </label>
      </div>
    </div>
  );
};

interface DataSetupTabProps {
  settings: DataSetupSettings;
  onChange: (settings: DataSetupSettings) => void;
  dataGroups?: DataGroup[];
  datasetHeaders?: string[];
  hideWeightingVector?: boolean;
}

export const DataSetupTab: React.FC<DataSetupTabProps> = ({
  settings,
  onChange,
  dataGroups = [],
  datasetHeaders = [],
  hideWeightingVector = false,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <label className="modal__field" style={{ marginBottom: 0 }}>
        <span className="modal__label">Missing value algorithm</span>
        <select
          className="modal__input"
          value={settings.missing_treatment}
          onChange={e => onChange({ ...settings, missing_treatment: e.target.value as DataSetupSettings['missing_treatment'] })}
        >
          <option value="none">None (require complete data)</option>
          <option value="mean">Mean replacement</option>
          <option value="casewise">Casewise deletion (Listwise)</option>
          <option value="pairwise">Pairwise deletion</option>
        </select>
      </label>

      <label className="modal__field" style={{ marginBottom: 0 }}>
        <span className="modal__label">Data groups</span>
        <select
          className="modal__input"
          value={settings.selected_data_group_id || ''}
          onChange={e => {
            const val = e.target.value;
            onChange({
              ...settings,
              selected_data_group_id: val || null,
            });
          }}
        >
          <option value="">Base (All observations)</option>
          {dataGroups.length > 0 && (
            <optgroup label="Data Groups">
              {dataGroups.map(g => (
                <option key={g.id} value={g.id}>
                  {g.name} (n={g.recordCount})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      {!hideWeightingVector && (
        <label className="modal__field" style={{ marginBottom: 0 }}>
          <span className="modal__label">Weighting vector</span>
          <select
            className="modal__input"
            value={settings.weight_column || ''}
            onChange={e => onChange({ ...settings, weight_column: e.target.value || null })}
          >
            <option value="">None</option>
            {datasetHeaders.map(col => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
        </label>
      )}

      <div style={{
        padding: '10px 12px',
        borderRadius: '8px',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        fontSize: '12px',
        color: 'var(--color-text-muted)',
      }}>
        {settings.missing_treatment === 'mean' && 'Mean replacement is recommended when <5% of values per indicator are missing.'}
        {settings.missing_treatment === 'casewise' && 'Cases with any missing indicator in the model are excluded.'}
        {settings.missing_treatment === 'pairwise' && 'Calculates correlations using all valid pairs of observations.'}
        {settings.missing_treatment === 'none' && 'Estimation requires full data without missing values.'}
      </div>
    </div>
  );
};

