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

export interface TabItem {
  id: string;
  label: string;
}

export const CalculationTabSlider: React.FC<{
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
}> = ({ tabs, activeTab, onChange }) => {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        background: 'var(--color-bg-raised)',
        padding: '3px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-subtle)',
        boxSizing: 'border-box',
        marginBottom: '14px',
      }}
    >
      {tabs.map(t => {
        const isActive = activeTab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            style={{
              flex: '1 1 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '7px 8px',
              borderRadius: 'calc(var(--radius-md) - 2px)',
              border: 'none',
              background: isActive ? 'var(--color-accent)' : 'transparent',
              color: isActive ? '#ffffff' : 'var(--color-text-secondary)',
              fontSize: '12.5px',
              fontWeight: isActive ? 600 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
};

interface PlsSetupTabProps {
  settings: PlsSetupSettings;
  onChange: (settings: PlsSetupSettings) => void;
  indicators?: Array<{ id: string; label: string }>;
}

export const PlsSetupTab: React.FC<PlsSetupTabProps> = ({ settings, onChange, indicators = [] }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <label className="modal__field" style={{ marginBottom: 0 }}>
        <span className="modal__label">Path weighting algorithm</span>
        <select
          className="modal__input"
          value={settings.inner_weighting}
          onChange={e => onChange({ ...settings, inner_weighting: e.target.value as PlsSetupSettings['inner_weighting'] })}
        >
          <option value="path">Structural Path (Standard)</option>
          <option value="factor">Factor Analysis Mode</option>
          <option value="centroid">Component Analysis (Centroid / PCA)</option>
        </select>
      </label>

      <label className="modal__field" style={{ marginBottom: 0 }}>
        <span className="modal__label">Output metric &amp; scaling</span>
        <select
          className="modal__input"
          value={settings.result_type || 'standardized'}
          onChange={e => onChange({ ...settings, result_type: e.target.value as PlsSetupSettings['result_type'] })}
        >
          <option value="standardized">Standardized Scores (Z-score)</option>
          <option value="unstandardized">Unstandardized (Raw metric)</option>
          <option value="mean_centered">Mean-centered</option>
        </select>
      </label>

      <label className="modal__field" style={{ marginBottom: 0 }}>
        <span className="modal__label">Initial indicator weights</span>
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
          <option value="default">Default (Equal initialization)</option>
          <option value="individual">Individual (Custom indicator values)</option>
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
    </div>
  );
};

interface DataSetupTabProps {
  settings: DataSetupSettings;
  onChange: (settings: DataSetupSettings) => void;
  dataGroups?: DataGroup[];
  datasetHeaders?: string[];
  hideWeightingVector?: boolean;
  hideDataGroups?: boolean;
}

export const DataSetupTab: React.FC<DataSetupTabProps> = ({
  settings,
  onChange,
  dataGroups = [],
  datasetHeaders = [],
  hideWeightingVector = false,
  hideDataGroups = false,
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

      {!hideDataGroups && (
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
      )}

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
    </div>
  );
};
