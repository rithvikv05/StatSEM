import React, { useEffect, useState } from 'react';
import { Checkbox } from '../components/Checkbox';
import type { PlsSettings } from './types';

interface PlsAndMissingTabsProps {
  tab: 'pls' | 'missing';
  plsSettings: PlsSettings;
  onChange: (next: PlsSettings) => void;
}

export const PlsAndMissingTabs: React.FC<PlsAndMissingTabsProps> = ({
  tab,
  plsSettings,
  onChange,
}) => {
  const [maxIterText, setMaxIterText] = useState(String(plsSettings.maxIterations));
  const [stopExpText, setStopExpText] = useState(String(plsSettings.stopCriterionExponent));

  useEffect(() => {
    setMaxIterText(String(plsSettings.maxIterations));
  }, [plsSettings.maxIterations]);

  useEffect(() => {
    setStopExpText(String(plsSettings.stopCriterionExponent));
  }, [plsSettings.stopCriterionExponent]);

  if (tab === 'pls') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div className="modal__field" style={{ marginBottom: 0 }}>
          <label className="modal__label">Weighting scheme</label>
          <select
            className="modal__input"
            value={plsSettings.weightingScheme}
            onChange={e =>
              onChange({
                ...plsSettings,
                weightingScheme: e.target.value as PlsSettings['weightingScheme'],
              })
            }
          >
            <option value="path">Path (Recommended)</option>
            <option value="centroid">Centroid</option>
            <option value="factor">Factor</option>
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="modal__field" style={{ marginBottom: 0 }}>
            <label className="modal__label">Maximum iterations</label>
            <input
              type="number"
              min={1}
              max={5000}
              className="modal__input"
              value={maxIterText}
              onChange={e => {
                const raw = e.target.value;
                setMaxIterText(raw);
                const parsed = Number(raw);
                if (raw.trim() !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 5000) {
                  onChange({ ...plsSettings, maxIterations: parsed });
                }
              }}
              onBlur={() => {
                const parsed = parseInt(maxIterText, 10);
                const clamped = Number.isFinite(parsed) ? Math.min(5000, Math.max(1, parsed)) : 5000;
                setMaxIterText(String(clamped));
                if (clamped !== plsSettings.maxIterations) {
                  onChange({ ...plsSettings, maxIterations: clamped });
                }
              }}
            />
          </div>

          <div className="modal__field" style={{ marginBottom: 0 }}>
            <label className="modal__label">Stop criterion (10⁻ˣ)</label>
            <input
              type="number"
              min={3}
              max={12}
              className="modal__input"
              value={stopExpText}
              onChange={e => {
                const raw = e.target.value;
                setStopExpText(raw);
                const parsed = Number(raw);
                if (raw.trim() !== '' && Number.isInteger(parsed) && parsed >= 3 && parsed <= 12) {
                  onChange({ ...plsSettings, stopCriterionExponent: parsed });
                }
              }}
              onBlur={() => {
                const parsed = parseInt(stopExpText, 10);
                const clamped = Number.isFinite(parsed) ? Math.min(12, Math.max(3, parsed)) : 7;
                setStopExpText(String(clamped));
                if (clamped !== plsSettings.stopCriterionExponent) {
                  onChange({ ...plsSettings, stopCriterionExponent: clamped });
                }
              }}
            />
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '3px', display: 'block' }}>
              7 means 10⁻⁷ (1e-7)
            </span>
          </div>
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
          <Checkbox
            checked={Boolean(plsSettings.consistent)}
            onChange={checked => onChange({ ...plsSettings, consistent: checked })}
          />
          <span>Consistent PLS-SEM (PLSc)</span>
        </label>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="modal__label" style={{ marginBottom: 0 }}>Missing value algorithm</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {[
          { value: 'mean', label: 'Mean replacement' },
          { value: 'casewise', label: 'Casewise deletion' },
          { value: 'pairwise', label: 'Pairwise deletion' },
        ].map(opt => (
          <label
            key={opt.value}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 12px',
              borderRadius: '8px',
              border:
                plsSettings.missingValues === opt.value
                  ? '1px solid var(--color-accent)'
                  : '1px solid var(--color-border-subtle)',
              background:
                plsSettings.missingValues === opt.value
                  ? 'var(--color-accent-subtle)'
                  : 'var(--color-bg-surface)',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'var(--color-text-primary)',
              fontWeight: plsSettings.missingValues === opt.value ? 600 : 400,
            }}
          >
            <input
              type="radio"
              name="mga-missing-values"
              checked={plsSettings.missingValues === opt.value}
              onChange={() =>
                onChange({
                  ...plsSettings,
                  missingValues: opt.value as PlsSettings['missingValues'],
                })
              }
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
      <div style={{
        padding: '10px 12px',
        borderRadius: '8px',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        fontSize: '12px',
        color: 'var(--color-text-muted)',
      }}>
        Mean replacement is recommended when &lt;5% of values per indicator are missing.
      </div>
    </div>
  );
};

