import React, { useEffect, useMemo, useState } from 'react';
import type { DataGroup, EligibleGroupColumn } from './types';
import { generateDataGroupsLocal, getEligibleGroupColumns } from './groupUtils';
import { mgaApi } from './mgaApi';

interface GenerateDataGroupsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  columns: string[];
  rows: any[][];
  existingGroups: DataGroup[];
  projectPath?: string;
  datasetId?: string;
  onGenerated: (newGroups: DataGroup[]) => void;
}

export const GenerateDataGroupsDialog: React.FC<GenerateDataGroupsDialogProps> = ({
  isOpen,
  onClose,
  columns,
  rows,
  existingGroups,
  projectPath,
  datasetId,
  onGenerated,
}) => {
  const eligibleColumns: EligibleGroupColumn[] = useMemo(
    () => (isOpen ? getEligibleGroupColumns(columns, rows) : []),
    [isOpen, columns, rows]
  );

  const [prefix, setPrefix] = useState('GROUP');
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [minimumCases, setMinimumCases] = useState<number>(10);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPrefix('GROUP');
      const preferred =
        eligibleColumns.find(c => /gender|sex|group|type|segment|marital/i.test(c.name))?.name ||
        eligibleColumns[0]?.name ||
        '';
      setSelectedCols(preferred ? [preferred] : []);
      setMinimumCases(10);
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen, eligibleColumns]);

  const toggleColumn = (colName: string) => {
    setSelectedCols(prev =>
      prev.includes(colName) ? prev.filter(c => c !== colName) : [...prev, colName]
    );
  };

  const livePreview = useMemo(() => {
    if (!isOpen || selectedCols.length === 0) {
      return { totalCombinations: 0, keptCount: 0, prunedCount: 0, groups: [] as DataGroup[] };
    }
    return generateDataGroupsLocal(columns, rows, prefix, selectedCols, Math.max(0, minimumCases));
  }, [isOpen, columns, rows, prefix, selectedCols, minimumCases]);

  if (!isOpen) return null;

  const handleOk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCols.length === 0) {
      setError('Please select at least one grouping column.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      if (projectPath) {
        const res = await mgaApi.generateGroups({
          projectPath,
          datasetId,
          columns,
          rows,
          dataGroups: existingGroups,
          prefix: prefix.trim() || 'GROUP',
          selectedColumns: selectedCols,
          minimumCases: Math.max(0, minimumCases),
        });
        if (res.error) {
          setError(res.error);
          setIsSubmitting(false);
          return;
        }
        onGenerated(res.generatedGroups || livePreview.groups);
      } else {
        onGenerated(livePreview.groups);
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to generate data groups.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay active" style={{ display: 'flex', zIndex: 9999 }} onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px', width: '92vw' }}>
        <div className="modal__header">
          <h2 className="modal__title">Generate Data Groups</h2>
          <button className="icon-btn icon-btn--sm" type="button" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleOk}>
          <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {error && (
              <div style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#dc2626', fontSize: '12px' }}>
                {error}
              </div>
            )}

            {eligibleColumns.length === 0 ? (
              <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#b45309', fontSize: '12.5px' }}>
                No columns with ≤ 20 unique values were found in this dataset. Add or import a categorical grouping variable, or create a group manually.
              </div>
            ) : (
              <>
                <div className="modal__field" style={{ marginBottom: 0 }}>
                  <label className="modal__label" htmlFor="mga-gen-prefix">Name prefix</label>
                  <input
                    id="mga-gen-prefix"
                    type="text"
                    className="modal__input"
                    value={prefix}
                    onChange={e => setPrefix(e.target.value)}
                    placeholder="GROUP"
                  />
                </div>

                <div className="modal__field" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <label className="modal__label" style={{ margin: 0 }}>Group columns</label>
                    {eligibleColumns.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedCols.length === eligibleColumns.length) {
                            setSelectedCols([]);
                          } else {
                            setSelectedCols(eligibleColumns.map(c => c.name));
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          fontSize: '11px',
                          color: 'var(--color-accent)',
                          cursor: 'pointer',
                        }}
                      >
                        {selectedCols.length === eligibleColumns.length ? 'Deselect all' : 'Select all'}
                      </button>
                    )}
                  </div>
                  <div
                    style={{
                      maxHeight: '180px',
                      overflowY: 'auto',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border-subtle)',
                      background: 'var(--color-bg-base)',
                      padding: '4px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    {eligibleColumns.map(c => {
                      const isChecked = selectedCols.includes(c.name);
                      return (
                        <label
                          key={c.name}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            background: isChecked ? 'var(--color-accent-subtle)' : 'transparent',
                            transition: 'background 0.12s ease',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleColumn(c.name)}
                            style={{ cursor: 'pointer', accentColor: 'var(--color-accent)' }}
                          />
                          <span style={{ fontSize: '12.5px', color: 'var(--color-text-primary)', fontWeight: isChecked ? 600 : 400 }}>
                            {c.name}
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                            {c.uniqueCount} unique values
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="modal__field" style={{ marginBottom: 0 }}>
                  <label className="modal__label" htmlFor="mga-gen-min">Minimum cases</label>
                  <input
                    id="mga-gen-min"
                    type="number"
                    min={0}
                    className="modal__input"
                    value={minimumCases}
                    onChange={e => setMinimumCases(Math.max(0, parseInt(e.target.value || '0', 10) || 0))}
                  />
                </div>

                <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)', display: 'flex', gap: '18px', alignItems: 'center', paddingTop: '2px' }}>
                  <span>Total combinations: <strong style={{ color: 'var(--color-text-primary)' }}>{livePreview.totalCombinations}</strong></span>
                  <span>After pruning: <strong style={{ color: livePreview.keptCount > 0 ? '#16a34a' : 'var(--color-text-primary)' }}>{livePreview.keptCount}</strong>{livePreview.prunedCount > 0 ? ` (${livePreview.prunedCount} pruned)` : ''}</span>
                </div>
              </>
            )}
          </div>

          <div className="modal__footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
            {selectedCols.length === 0 && (
              <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 500, marginRight: '4px' }}>
                Select at least one
              </span>
            )}
            <button className="modal__btn-cancel" type="button" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              className="modal__btn-create"
              type="submit"
              disabled={isSubmitting || selectedCols.length === 0 || livePreview.keptCount === 0}
              style={{
                opacity: (isSubmitting || selectedCols.length === 0 || livePreview.keptCount === 0) ? 0.45 : 1,
                cursor: (isSubmitting || selectedCols.length === 0 || livePreview.keptCount === 0) ? 'not-allowed' : 'pointer',
                filter: (selectedCols.length === 0 || livePreview.keptCount === 0) ? 'grayscale(0.6)' : 'none',
              }}
            >
              {isSubmitting ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
