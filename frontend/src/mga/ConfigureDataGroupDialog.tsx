import React, { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { DataGroup, GroupTerm, GroupTermOperator } from './types';
import { getEligibleGroupColumns, getGroupRows } from './groupUtils';

interface ConfigureDataGroupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  columns: string[];
  rows: any[][];
  initialGroup: DataGroup | null;
  onSave: (group: DataGroup) => void;
}

const OPERATORS: GroupTermOperator[] = [
  'is equal to',
  'is not equal to',
  'is greater than',
  'is less than',
  'is between',
  'is not between',
];

export const ConfigureDataGroupDialog: React.FC<ConfigureDataGroupDialogProps> = ({
  isOpen,
  onClose,
  columns,
  rows,
  initialGroup,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [linkType, setLinkType] = useState<'AND' | 'OR'>('AND');
  const [terms, setTerms] = useState<GroupTerm[]>([]);
  const [error, setError] = useState<string | null>(null);

  const uniqueMap = useMemo(() => {
    const map = new Map<string, Array<{ label: string; raw: any }>>();
    if (!isOpen) return map;
    for (const col of getEligibleGroupColumns(columns, rows)) {
      map.set(col.name, col.values.map(v => ({ label: v.label, raw: v.raw })));
    }
    return map;
  }, [isOpen, columns, rows]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (initialGroup) {
        setName(initialGroup.name);
        setLinkType(initialGroup.conditionLinkType || 'AND');
        setTerms(
          initialGroup.terms.length > 0
            ? initialGroup.terms.map(t => ({ ...t }))
            : [{ column: columns[0] || '', operator: 'is equal to', value1: '' }]
        );
      } else {
        setName('New Group');
        setLinkType('AND');
        const firstCol = columns[0] || '';
        const firstVal = uniqueMap.get(firstCol)?.[0]?.raw ?? '';
        setTerms([{ column: firstCol, operator: 'is equal to', value1: firstVal }]);
      }
    }
  }, [isOpen, initialGroup, columns, uniqueMap]);

  const previewCount = useMemo(() => {
    if (!isOpen) return 0;
    const candidate: DataGroup = {
      id: initialGroup?.id || 'preview',
      name: name.trim() || 'Group',
      conditionLinkType: linkType,
      terms,
      recordCount: 0,
      rowIds: initialGroup?.rowIds,
    };
    return getGroupRows(columns, rows, candidate).indices.length;
  }, [isOpen, columns, rows, initialGroup, name, linkType, terms]);

  if (!isOpen) return null;

  const updateTerm = (idx: number, patch: Partial<GroupTerm>) => {
    setTerms(prev => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const addTerm = () => {
    const defaultCol = columns[0] || '';
    const defaultVal = uniqueMap.get(defaultCol)?.[0]?.raw ?? '';
    setTerms(prev => [...prev, { column: defaultCol, operator: 'is equal to', value1: defaultVal }]);
  };

  const removeTerm = (idx: number) => {
    setTerms(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Group Name is required.');
      return;
    }
    if (terms.length === 0 && !initialGroup?.rowIds) {
      setError('Add at least one filter term.');
      return;
    }
    const id =
      initialGroup?.id ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    const finalized: DataGroup = {
      id,
      name: name.trim(),
      conditionLinkType: linkType,
      terms: terms.map(t => ({
        ...t,
        value2: (t.operator === 'is between' || t.operator === 'is not between') ? t.value2 ?? '' : undefined,
      })),
      recordCount: previewCount,
      rowIds: initialGroup?.rowIds,
    };
    onSave(finalized);
    onClose();
  };

  return (
    <div className="modal-overlay active" style={{ display: 'flex', zIndex: 9999 }} onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '660px', width: '94vw' }}>
        <div className="modal__header">
          <h2 className="modal__title">Configure Data Group</h2>
          <button className="icon-btn icon-btn--sm" type="button" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '70vh', overflowY: 'auto' }}>
            {error && (
              <div style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#dc2626', fontSize: '12px' }}>
                {error}
              </div>
            )}

            <div className="modal__field" style={{ marginBottom: 0 }}>
              <label className="modal__label" htmlFor="cfg-group-name">Group Name</label>
              <input
                id="cfg-group-name"
                type="text"
                className="modal__input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Male"
              />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span className="modal__label" style={{ margin: 0 }}>Group Terms</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {terms.map((term, idx) => {
                  const colSuggestions = uniqueMap.get(term.column);
                  const useDropdown =
                    Boolean(colSuggestions && colSuggestions.length > 0) &&
                    (term.operator === 'is equal to' || term.operator === 'is not equal to');
                  const isBetweenOp = term.operator === 'is between' || term.operator === 'is not between';

                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          isBetweenOp
                            ? (terms.length > 1
                                ? 'minmax(120px, 1.2fr) minmax(140px, 1.1fr) 1fr 1fr 28px'
                                : 'minmax(120px, 1.2fr) minmax(140px, 1.1fr) 1fr 1fr')
                            : (terms.length > 1
                                ? 'minmax(130px, 1.2fr) minmax(140px, 1.1fr) 1.4fr 28px'
                                : 'minmax(130px, 1.2fr) minmax(140px, 1.1fr) 1.4fr'),
                        gap: '8px',
                        alignItems: 'center',
                      }}
                    >
                      <select
                        className="modal__input"
                        value={term.column}
                        onChange={e => {
                          const newCol = e.target.value;
                          const sug = uniqueMap.get(newCol)?.[0]?.raw;
                          updateTerm(idx, {
                            column: newCol,
                            value1: sug !== undefined ? sug : term.value1,
                          });
                        }}
                      >
                        {columns.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>

                      <select
                        className="modal__input"
                        value={term.operator}
                        onChange={e => updateTerm(idx, { operator: e.target.value as GroupTermOperator })}
                      >
                        {OPERATORS.map(op => (
                          <option key={op} value={op}>{op}</option>
                        ))}
                      </select>

                      {useDropdown && colSuggestions ? (
                        <select
                          className="modal__input"
                          value={String(term.value1 ?? '')}
                          onChange={e => {
                            const found = colSuggestions.find(s => String(s.raw) === e.target.value || s.label === e.target.value);
                            updateTerm(idx, { value1: found ? found.raw : e.target.value });
                          }}
                        >
                          {!colSuggestions.some(s => String(s.raw) === String(term.value1)) && (
                            <option value={String(term.value1 ?? '')}>{String(term.value1 ?? '')}</option>
                          )}
                          {colSuggestions.map(s => (
                            <option key={s.label} value={String(s.raw)}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          className="modal__input"
                          value={term.value1 ?? ''}
                          onChange={e => updateTerm(idx, { value1: e.target.value })}
                          placeholder={isBetweenOp ? 'Min' : 'Value'}
                        />
                      )}

                      {isBetweenOp && (
                        <input
                          type="text"
                          className="modal__input"
                          value={term.value2 ?? ''}
                          onChange={e => updateTerm(idx, { value2: e.target.value })}
                          placeholder="Max"
                        />
                      )}

                      {terms.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeTerm(idx)}
                          title="Remove term"
                          style={{
                            width: '28px',
                            height: '28px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: 'none',
                            background: 'transparent',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <button
                  type="button"
                  onClick={addTerm}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border-subtle)',
                    background: 'var(--color-bg-surface)',
                    color: 'var(--color-text-primary)',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  + Add Term
                </button>
                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  Matching records: <strong style={{ color: 'var(--color-text-primary)' }}>{previewCount}</strong>
                </span>
              </div>
            </div>
          </div>

          <div className="modal__footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              {terms.length >= 2 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>Link terms:</span>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: 'var(--color-bg-base)',
                      padding: '2px',
                      borderRadius: '20px',
                      border: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setLinkType('AND')}
                      style={{
                        padding: '3px 12px',
                        borderRadius: '16px',
                        border: 'none',
                        fontSize: '11.5px',
                        fontWeight: linkType === 'AND' ? 600 : 500,
                        background: linkType === 'AND' ? 'var(--color-accent)' : 'transparent',
                        color: linkType === 'AND' ? '#ffffff' : 'var(--color-text-muted)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      AND
                    </button>
                    <button
                      type="button"
                      onClick={() => setLinkType('OR')}
                      style={{
                        padding: '3px 12px',
                        borderRadius: '16px',
                        border: 'none',
                        fontSize: '11.5px',
                        fontWeight: linkType === 'OR' ? 600 : 500,
                        background: linkType === 'OR' ? 'var(--color-accent)' : 'transparent',
                        color: linkType === 'OR' ? '#ffffff' : 'var(--color-text-muted)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      OR
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button className="modal__btn-cancel" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="modal__btn-create" type="submit">
                Add
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

