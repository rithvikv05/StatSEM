import React, { useState } from 'react';
import type { ModelSpec } from '../utils/api';
import type { DataGroup } from '../mga/types';
import { PlsSetupTab, DataSetupTab, type PlsSetupSettings, type DataSetupSettings } from './CalculationCommonTabs';

export type ModelCalculationSettings = {
  inner_weighting: 'path' | 'factor' | 'centroid';
  missing_treatment: 'mean' | 'listwise' | 'none';
  max_iter: number;
  tolerance: number;
  initial_weights?: 'equal' | 'individual';
  individual_initial_weights?: Record<string, number> | null;
  result_type?: 'standardized' | 'unstandardized' | 'mean_centered';
  selected_data_group_id?: string | null;
  data_filter?: { column: string; value: string | number | boolean } | null;
  weight_column?: string | null;
};

const defaultModelSettings: ModelCalculationSettings = {
  inner_weighting: 'path',
  missing_treatment: 'mean',
  max_iter: 300,
  tolerance: 1e-7,
  initial_weights: 'equal',
  result_type: 'standardized',
};

export function ModelCalculationModal({
  isOpen,
  consistent,
  initialSettings,
  spec,
  dataGroups = [],
  datasetHeaders = [],
  datasetRows = [],
  onClose,
  onRun,
  submitLabel = 'Run model',
}: {
  isOpen: boolean;
  consistent: boolean;
  initialSettings?: Partial<ModelCalculationSettings>;
  spec?: ModelSpec;
  dataGroups?: DataGroup[];
  datasetHeaders?: string[];
  datasetRows?: unknown[][];
  onClose: () => void;
  onRun: (settings: ModelCalculationSettings) => void;
  submitLabel?: string;
}) {
  const [activeTab, setActiveTab] = useState<'pls' | 'data'>('pls');
  const [settings, setSettings] = useState<ModelCalculationSettings>(() => ({
    ...defaultModelSettings,
    ...initialSettings,
  }));

  const indicators = React.useMemo(() => {
    return Array.from(new Set((spec?.constructs || []).flatMap(c => c.indicators))).map(id => {
      const match = spec?.indicators?.find(i => i.id === id);
      return { id, label: match?.column || id };
    });
  }, [spec]);

  if (!isOpen) return null;

  const validWeights =
    settings.initial_weights !== 'individual' ||
    (spec?.constructs || []).every(c =>
      c.indicators.every(id => Number.isFinite(settings.individual_initial_weights?.[id])) &&
      c.indicators.some(id => settings.individual_initial_weights?.[id] !== 0)
    );

  const valid =
    validWeights &&
    Number.isInteger(settings.max_iter) &&
    settings.max_iter >= 1 &&
    settings.max_iter <= 5000 &&
    settings.tolerance > 0 &&
    settings.tolerance <= 0.01;

  const plsValues: PlsSetupSettings = {
    inner_weighting: settings.inner_weighting,
    result_type: settings.result_type || 'standardized',
    initial_weights: settings.initial_weights === 'individual' ? 'individual' : 'equal',
    individual_initial_weights: settings.individual_initial_weights,
    max_iter: settings.max_iter,
    tolerance: settings.tolerance,
  };

  const dataValues: DataSetupSettings = {
    missing_treatment: settings.missing_treatment === 'listwise' ? 'casewise' : settings.missing_treatment,
    selected_data_group_id: settings.selected_data_group_id,
    data_filter: settings.data_filter,
    weight_column: settings.weight_column,
  };

  const handlePlsChange = (next: PlsSetupSettings) => {
    setSettings(prev => ({
      ...prev,
      inner_weighting: next.inner_weighting,
      result_type: next.result_type,
      initial_weights: next.initial_weights,
      individual_initial_weights: next.individual_initial_weights,
      max_iter: next.max_iter,
      tolerance: next.tolerance,
    }));
  };

  const handleDataChange = (next: DataSetupSettings) => {
    // Map 'casewise' to 'listwise' for backend compatibility
    const missingTreatment = (next.missing_treatment === 'casewise' || next.missing_treatment === 'pairwise')
      ? 'listwise'
      : (next.missing_treatment as 'mean' | 'listwise' | 'none');

    // If a DataGroup was chosen, derive data_filter if it has a simple single term
    let dataFilter = next.data_filter;
    if (next.selected_data_group_id) {
      const group = dataGroups.find(g => g.id === next.selected_data_group_id);
      if (group && group.terms && group.terms.length === 1 && group.terms[0].operator === 'is equal to') {
        dataFilter = { column: group.terms[0].column, value: group.terms[0].value1 };
      }
    } else {
      dataFilter = null;
    }

    setSettings(prev => ({
      ...prev,
      missing_treatment: missingTreatment,
      selected_data_group_id: next.selected_data_group_id,
      data_filter: dataFilter,
      weight_column: next.weight_column,
    }));
  };

  return (
    <div className="modal-overlay active calculation-overlay" role="presentation">
      <div className="modal calculation-dialog" role="dialog" aria-modal="true" aria-labelledby="model-calculation-title" style={{ maxWidth: 540, width: '92vw' }}>
        <div className="modal__header">
          <div>
            <div className="modal__title" id="model-calculation-title">
              {consistent ? 'Consistent PLS-SEM (PLSc)' : 'PLS-SEM Algorithm'}
            </div>
            <div className="modal__subtitle">
              Partial least squares structural equation modeling setup
            </div>
          </div>
          <button className="calculation-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal__body">
          <div className="view-toggle" role="tablist" style={{ alignSelf: 'flex-start' }}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'pls'}
              className={`view-toggle__btn ${activeTab === 'pls' ? 'active' : ''}`}
              onClick={() => setActiveTab('pls')}
            >
              PLS setup
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'data'}
              className={`view-toggle__btn ${activeTab === 'data' ? 'active' : ''}`}
              onClick={() => setActiveTab('data')}
            >
              Data setup
            </button>
          </div>

          {activeTab === 'pls' && (
            <PlsSetupTab
              settings={plsValues}
              onChange={handlePlsChange}
              indicators={indicators}
            />
          )}

          {activeTab === 'data' && (
            <DataSetupTab
              settings={dataValues}
              onChange={handleDataChange}
              dataGroups={dataGroups}
              datasetHeaders={datasetHeaders}
            />
          )}
        </div>

        <div className="modal__footer">
          <button className="modal__btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="modal__btn-create" disabled={!valid} onClick={() => onRun(settings)}>
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
