import React, { useState, useEffect, useMemo } from 'react';
import { Layers, AlertTriangle, CheckCircle, HelpCircle, X, ArrowRight, Play } from 'lucide-react';
import type { ParsedDataset } from '../utils/dataset-parser';
import { backendUrl } from '../utils/api';

export interface RedundancyWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetConstructId: string | null;
  nodes: any[];
  dataset: ParsedDataset | null;
  projectPath: string;
  onModelsCreated: (createdModels: any[], calculateNow: boolean) => void;
}

interface ConstructItem {
  id: string;
  name: string;
  type: string;
  indicators: string[];
}

export const RedundancyWizardModal: React.FC<RedundancyWizardModalProps> = ({
  isOpen,
  onClose,
  targetConstructId,
  nodes,
  dataset,
  projectPath,
  onModelsCreated,
}) => {
  // Extract all formative constructs from canvas nodes
  const formativeConstructs = useMemo<ConstructItem[]>(() => {
    const latents = nodes.filter(n => n.isLatent && !n.isText);
    return latents
      .filter(n => n.type === 'formative' || n.outer_mode === 'B')
      .map(n => {
        const childInds = nodes.filter(c => c.parentId === n.id && !c.isLatent);
        const inds = childInds.map(c => c.label || c.name || c.id);
        return {
          id: n.id,
          name: n.label || n.name || n.id,
          type: n.type || 'formative',
          indicators: inds,
        };
      });
  }, [nodes]);

  // All variables available in the dataset
  const datasetVariables = useMemo<string[]>(() => {
    if (!dataset) return [];
    return dataset.variables.map(v => v.name);
  }, [dataset]);

  const [createForAll, setCreateForAll] = useState(false);
  const [selectedConstructId, setSelectedConstructId] = useState<string>('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [calculateNow, setCalculateNow] = useState(false);
  const [validationMap, setValidationMap] = useState<Record<string, { isValid: boolean; warnings: string[]; errors: string[] }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalItemSearch, setGlobalItemSearch] = useState('');

  // Auto-suggestion helper
  const suggestGlobalItem = (constructName: string, indicators: string[]): string => {
    const cNameClean = constructName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    // 1. Look for a variable containing construct name and 'global'
    const match1 = datasetVariables.find(v => {
      const vLower = v.toLowerCase();
      return vLower.includes('global') && (vLower.includes(cNameClean) || cNameClean.includes(vLower.replace(/[^a-zA-Z0-9]/g, '').replace('global', '')));
    });
    if (match1 && !indicators.includes(match1)) return match1;

    // 2. Look for any variable containing 'global'
    const match2 = datasetVariables.find(v => v.toLowerCase().includes('global') && !indicators.includes(v));
    if (match2) return match2;

    // 3. Fallback to any variable not in indicators
    return datasetVariables.find(v => !indicators.includes(v)) || '';
  };

  // Initialize selected construct and auto-suggestions
  useEffect(() => {
    if (!isOpen) return;

    const initialConstruct = targetConstructId && formativeConstructs.some(c => c.id === targetConstructId)
      ? targetConstructId
      : (formativeConstructs[0]?.id || '');

    setSelectedConstructId(initialConstruct);

    const newMap: Record<string, string> = {};
    formativeConstructs.forEach(c => {
      newMap[c.id] = suggestGlobalItem(c.name, c.indicators);
    });
    setMapping(newMap);
  }, [isOpen, targetConstructId, formativeConstructs, datasetVariables]);

  // Validate mappings against dataset
  useEffect(() => {
    if (!dataset || !isOpen) return;

    const newValidation: Record<string, { isValid: boolean; warnings: string[]; errors: string[] }> = {};

    formativeConstructs.forEach(c => {
      const gItem = mapping[c.id];
      const errors: string[] = [];
      const warnings: string[] = [];

      if (c.indicators.length < 2) {
        errors.push('Construct must have at least 2 indicators.');
      }

      if (!gItem) {
        errors.push('No global item selected.');
      } else {
        if (c.indicators.includes(gItem)) {
          errors.push('Global item cannot be one of the construct\'s formative indicators.');
        }

        const vMeta = dataset.variables.find(v => v.name === gItem);
        if (!vMeta) {
          errors.push(`Variable "${gItem}" not found in dataset.`);
        } else {
          if (vMeta.type === 'string' || vMeta.scaleType === 'Categorical') {
            warnings.push('Global item should ideally be metric/continuous.');
          }
          // Check variance
          if (vMeta.min === vMeta.max) {
            errors.push('Global item has zero variance.');
          }
        }
      }

      newValidation[c.id] = {
        isValid: errors.length === 0,
        errors,
        warnings,
      };
    });

    setValidationMap(newValidation);
  }, [mapping, formativeConstructs, dataset, isOpen]);

  if (!isOpen) return null;

  const currentConstruct = formativeConstructs.find(c => c.id === selectedConstructId) || formativeConstructs[0];

  const handleGlobalItemSelect = (constructId: string, globalItem: string) => {
    setMapping(prev => ({
      ...prev,
      [constructId]: globalItem,
    }));
  };

  const handleCreate = async () => {
    const targets = createForAll
      ? formativeConstructs
      : (currentConstruct ? [currentConstruct] : []);

    if (targets.length === 0) return;

    // Check validity
    for (const t of targets) {
      const val = validationMap[t.id];
      if (val && !val.isValid) {
        alert(`Cannot create redundancy model for "${t.name}": ${val.errors.join(' ')}`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const mappingsPayload = targets.map(t => ({
        construct_id: t.id,
        construct_name: t.name,
        indicators: t.indicators,
        global_item: mapping[t.id],
      }));

      const res = await fetch(`${backendUrl()}/project/create-redundancy-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: projectPath,
          dataset_id: dataset?.id,
          mappings: mappingsPayload,
          calculate_now: calculateNow,
        }),
      });

      const data = await res.json();
      if (data.error) {
        alert('Failed to create redundancy model: ' + data.error);
        return;
      }

      onModelsCreated(data.created_models || [], calculateNow);
      onClose();
    } catch (err: any) {
      alert('Error creating redundancy model: ' + err?.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredGlobalVariables = datasetVariables.filter(v =>
    v.toLowerCase().includes(globalItemSearch.toLowerCase())
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: createForAll ? '780px' : '560px',
          maxHeight: '90vh',
          backgroundColor: 'var(--color-bg-base, #ffffff)',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08)',
          border: '1px solid var(--color-border-subtle, #e2e8f0)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'max-width 0.2s ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--color-border-subtle, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--color-bg-subtle, #f8fafc)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: 'rgba(107, 78, 230, 0.12)',
                color: 'var(--color-accent, #6B4EE6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Layers size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary, #0f172a)' }}>
                Create Redundancy Analysis
              </h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-secondary, #64748b)' }}>
                Assess convergent validity of formative constructs (Hair et al., 2022)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-muted, #94a3b8)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {formativeConstructs.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                borderRadius: '8px',
                backgroundColor: 'rgba(234, 179, 8, 0.1)',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                color: '#854d0e',
              }}
            >
              <AlertTriangle size={28} style={{ margin: '0 auto 8px', color: '#eab308' }} />
              <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>No Formative Constructs Found</div>
              <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                Redundancy analysis requires at least one formative (Mode B) construct with 2 or more indicators.
                Right-click a construct on canvas and select <strong>Make Formative</strong> first.
              </div>
            </div>
          ) : (
            <>
              {/* Batch option toggle */}
              {formativeConstructs.length > 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--color-bg-subtle, #f8fafc)',
                    border: '1px solid var(--color-border-subtle, #e2e8f0)',
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={createForAll}
                      onChange={e => setCreateForAll(e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: 'var(--color-accent, #6B4EE6)' }}
                    />
                    <span>Create for all formative constructs ({formativeConstructs.length} constructs)</span>
                  </label>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)' }}>
                    {createForAll ? 'Creates 1 model per construct' : 'Single construct'}
                  </span>
                </div>
              )}

              {/* Single construct mode */}
              {!createForAll ? (
                currentConstruct && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {/* Construct picker */}
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
                        Formative Construct to Validate:
                      </label>
                      <select
                        value={selectedConstructId}
                        onChange={e => setSelectedConstructId(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: '6px',
                          border: '1px solid var(--color-border-default, #cbd5e1)',
                          backgroundColor: 'var(--color-bg-base, #ffffff)',
                          fontSize: '13px',
                          fontWeight: 500,
                        }}
                      >
                        {formativeConstructs.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.indicators.length} formative indicators)
                          </option>
                        ))}
                      </select>
                      <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                        Indicators: {currentConstruct.indicators.join(', ')}
                      </div>
                    </div>

                    {/* Global item picker */}
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
                        Global Single-Item Construct:
                      </label>
                      <div style={{ position: 'relative' }}>
                        <select
                          value={mapping[currentConstruct.id] || ''}
                          onChange={e => handleGlobalItemSelect(currentConstruct.id, e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid var(--color-border-default, #cbd5e1)',
                            backgroundColor: 'var(--color-bg-base, #ffffff)',
                            fontSize: '13px',
                            fontWeight: 500,
                          }}
                        >
                          <option value="">-- Select Global Item Variable --</option>
                          {datasetVariables.map(v => (
                            <option
                              key={v}
                              value={v}
                              disabled={currentConstruct.indicators.includes(v)}
                            >
                              {v} {currentConstruct.indicators.includes(v) ? '(already an indicator)' : (v.toLowerCase().includes('global') ? '★ [global]' : '')}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Model structure preview pill */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '12px',
                        padding: '12px',
                        borderRadius: '8px',
                        backgroundColor: 'var(--color-bg-subtle, #f8fafc)',
                        border: '1px dashed var(--color-border-default, #cbd5e1)',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      <div style={{ padding: '6px 12px', borderRadius: '20px', backgroundColor: '#e0e7ff', color: '#4338ca' }}>
                        {currentConstruct.name}_F (Mode B)
                      </div>
                      <ArrowRight size={16} style={{ color: 'var(--color-text-muted)' }} />
                      <div style={{ padding: '6px 12px', borderRadius: '20px', backgroundColor: '#dcfce7', color: '#15803d' }}>
                        {currentConstruct.name}_G ({mapping[currentConstruct.id] || 'global_item'})
                      </div>
                    </div>

                    {/* Validation feedback */}
                    {validationMap[currentConstruct.id] && (
                      <div>
                        {validationMap[currentConstruct.id].errors.map((err, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                            <AlertTriangle size={14} />
                            <span>{err}</span>
                          </div>
                        ))}
                        {validationMap[currentConstruct.id].warnings.map((warn, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#d97706', fontSize: '12px', marginTop: '4px' }}>
                            <HelpCircle size={14} />
                            <span>{warn}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              ) : (
                /* Batch mapping table */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                    Map each formative construct to its corresponding global single-item variable:
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border-default, #cbd5e1)', textAlign: 'left', color: 'var(--color-text-muted)' }}>
                        <th style={{ padding: '8px 10px', fontSize: '11px', textTransform: 'uppercase' }}>Formative Construct</th>
                        <th style={{ padding: '8px 10px', fontSize: '11px', textTransform: 'uppercase' }}>Indicators</th>
                        <th style={{ padding: '8px 10px', fontSize: '11px', textTransform: 'uppercase' }}>Global Item Variable</th>
                        <th style={{ padding: '8px 10px', fontSize: '11px', textTransform: 'uppercase', width: '70px' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formativeConstructs.map(c => {
                        const val = validationMap[c.id];
                        return (
                          <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border-subtle, #f1f5f9)' }}>
                            <td style={{ padding: '8px 10px', fontWeight: 600 }}>{c.name}</td>
                            <td style={{ padding: '8px 10px', fontSize: '11px', color: 'var(--color-text-secondary)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.indicators.join(', ')}>
                              {c.indicators.join(', ')}
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <select
                                value={mapping[c.id] || ''}
                                onChange={e => handleGlobalItemSelect(c.id, e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '5px 8px',
                                  borderRadius: '4px',
                                  border: '1px solid var(--color-border-default, #cbd5e1)',
                                  backgroundColor: 'var(--color-bg-base, #ffffff)',
                                  fontSize: '12px',
                                }}
                              >
                                <option value="">-- Select Global Item --</option>
                                {datasetVariables.map(v => (
                                  <option key={v} value={v} disabled={c.indicators.includes(v)}>
                                    {v} {v.toLowerCase().includes('global') ? '★' : ''}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                              {val?.isValid ? (
                                <span title={val.warnings.join(' ') || 'Valid'} style={{ color: val.warnings.length > 0 ? '#d97706' : '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {val.warnings.length > 0 ? <HelpCircle size={16} /> : <CheckCircle size={16} />}
                                </span>
                              ) : (
                                <span title={val?.errors.join(' ')} style={{ color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <AlertTriangle size={16} />
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Calculate now checkbox */}
              <div
                style={{
                  paddingTop: '10px',
                  borderTop: '1px solid var(--color-border-subtle, #e2e8f0)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={calculateNow}
                    onChange={e => setCalculateNow(e.target.checked)}
                    style={{ cursor: 'pointer', accentColor: 'var(--color-accent, #6B4EE6)' }}
                  />
                  <span>Calculate now (run PLS-SEM algorithm immediately after creating model)</span>
                </label>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--color-border-subtle, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--color-bg-subtle, #f8fafc)',
          }}
        >
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
            Threshold: Path &ge; 0.70 (R² &ge; 0.50)
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 14px',
                borderRadius: '6px',
                border: '1px solid var(--color-border-default, #cbd5e1)',
                backgroundColor: 'var(--color-bg-base, #ffffff)',
                color: 'var(--color-text-secondary, #475569)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={isSubmitting || formativeConstructs.length === 0}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: 'var(--color-accent, #6B4EE6)',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isSubmitting || formativeConstructs.length === 0 ? 'not-allowed' : 'pointer',
                opacity: isSubmitting || formativeConstructs.length === 0 ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {calculateNow && <Play size={13} fill="#ffffff" />}
              <span>
                {isSubmitting
                  ? 'Creating...'
                  : createForAll
                  ? `Create ${formativeConstructs.length} Redundancy Models`
                  : 'Create Redundancy Model'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RedundancyWizardModal;

