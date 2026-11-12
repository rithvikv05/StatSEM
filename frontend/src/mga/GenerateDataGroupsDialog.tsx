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
  const [col0, setCol0] = useState('');
  const [col1, setCol1] = useState('');
  const [col2, setCol2] = useState('');
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
      setCol0(preferred);
      setCol1('');
      setCol2('');
      setMinimumCases(10);
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen, eligibleColumns]);

  const selectedCols = useMemo(
    () => [col0, col1, col2].filter(c => Boolean(c && c !== 'none')),
    [col0, col1, col2]
  );

  const livePreview = useMemo(() => {
    if (!isOpen || selectedCols.length === 0) {
      return { totalCombinations: 0, keptCount: 0, prunedCount: 0, groups: [] as DataGroup[] };
    }
    return generateDataGroupsLocal(columns, rows, prefix, selectedCols, Math.max(0, minimumCases));
  }, [isOpen, columns, rows, prefix, selectedCols, minimumCases]);

  if (!isOpen) return null;

  const handleOk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!col0) {
      setError('Please select Group column 0.');
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
                  <label className="modal__label" htmlFor="mga-gen-col0">Group column 0 (required)</label>
                  <select
                    id="mga-gen-col0"
                    className="modal__input"
                    value={col0}
                    onChange={e => setCol0(e.target.value)}
                    style={{ cursor: 'pointer' }}
                  >
                    <option value="">Select column…</option>
                    {eligibleColumns.map(c => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({c.uniqueCount} unique values)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="modal__field" style={{ marginBottom: 0 }}>
                  <label className="modal__label" htmlFor="mga-gen-col1">Group column 1 (optional)</label>
                  <select
                    id="mga-gen-col1"
                    className="modal__input"
                    value={col1}
                    onChange={e => setCol1(e.target.value)}
                    style={{ cursor: 'pointer' }}
                  >
                    <option value="">None</option>
                    {eligibleColumns
                      .filter(c => c.name !== col0)
                      .map(c => (
                        <option key={c.name} value={c.name}>
                          {c.name} ({c.uniqueCount} unique values)
                        </option>
                      ))}
                  </select>
                </div>

                <div className="modal__field" style={{ marginBottom: 0 }}>
                  <label className="modal__label" htmlFor="mga-gen-col2">Group column 2 (optional)</label>
                  <select
                    id="mga-gen-col2"
                    className="modal__input"
                    value={col2}
                    onChange={e => setCol2(e.target.value)}
                    style={{ cursor: 'pointer' }}
                  >
                    <option value="">None</option>
                    {eligibleColumns
                      .filter(c => c.name !== col0 && c.name !== col1)
                      .map(c => (
                        <option key={c.name} value={c.name}>
                          {c.name} ({c.uniqueCount} unique values)
                        </option>
                      ))}
                  </select>
                </div>

                <div style={{
                  padding: '12px 14px',
                  borderRadius: '8px',
                  background: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    Prune groups
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'center' }}>
                    <div style={{ fontSize: '12.5px', color: 'var(--color-text-secondary)' }}>
                      <div>Total: <strong style={{ color: 'var(--color-text-primary)' }}>{livePreview.totalCombinations}</strong></div>
                      <div style={{ marginTop: '2px', fontSize: '11.5px', color: 'var(--color-text-muted)' }}>
                        After pruning: <strong style={{ color: livePreview.keptCount > 0 ? '#16a34a' : '#dc2626' }}>{livePreview.keptCount}</strong>
                        {livePreview.prunedCount > 0 ? ` (${livePreview.prunedCount} removed)` : ''}
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
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="modal__footer">
            <button className="modal__btn-cancel" type="button" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              className="modal__btn-create"
              type="submit"
              disabled={isSubmitting || !col0 || livePreview.keptCount === 0}
            >
              {isSubmitting ? 'Generating…' : 'OK'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

