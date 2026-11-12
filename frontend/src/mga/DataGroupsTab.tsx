import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Edit3, Plus, Scale, Trash2, Users } from 'lucide-react';
import type { ParsedDataset } from '../utils/dataset-parser';
import { processData } from '../utils/dataset-parser';
import { api } from '../utils/api';
import { useStore } from '../store';
import type { DataGroup } from './types';
import { maxArrowsFromSpec, validateDataGroupsLocal } from './groupUtils';
import { mgaApi } from './mgaApi';
import { GenerateDataGroupsDialog } from './GenerateDataGroupsDialog';
import { ConfigureDataGroupDialog } from './ConfigureDataGroupDialog';

interface DataGroupsTabProps {
  dataset: ParsedDataset;
  studyId?: string;
  projectPath?: string;
  studyModels?: Array<{ id: string; name: string }>;
  onGroupsUpdated: (updatedGroups: DataGroup[]) => void;
  onDatasetCreated?: (newDataset: ParsedDataset) => void;
}

export const DataGroupsTab: React.FC<DataGroupsTabProps> = ({
  dataset,
  projectPath,
  studyModels = [],
  onGroupsUpdated,
  onDatasetCreated,
}) => {
  const { requestDelete } = useStore();
  const groups = dataset.dataGroups || [];
  const columns = useMemo(() => dataset.variables.map(v => v.name), [dataset.variables]);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(groups[0]?.id || null);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DataGroup | null | 'new'>(null);

  // Power check controls (§3.5a)
  const [sigLevel, setSigLevel] = useState<'0.01' | '0.05' | '0.10'>('0.05');
  const [minR2, setMinR2] = useState<'0.10' | '0.25' | '0.50' | '0.75'>('0.10');
  const [modelArrows, setModelArrows] = useState<number>(2);

  // Equalize group sizes modal (§3.5c)
  const [isEqualizeOpen, setIsEqualizeOpen] = useState(false);
  const [eqGroupAId, setEqGroupAId] = useState('');
  const [eqGroupBId, setEqGroupBId] = useState('');
  const [eqSeed, setEqSeed] = useState<number>(42);
  const [isEqualizing, setIsEqualizing] = useState(false);
  const [eqError, setEqError] = useState<string | null>(null);
  const [infoBanner, setInfoBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedGroupId || !groups.some(g => g.id === selectedGroupId)) {
      setSelectedGroupId(groups[0]?.id || null);
    }
  }, [groups, selectedGroupId]);

  useEffect(() => {
    if (!projectPath || studyModels.length === 0) {
      setModelArrows(2);
      return;
    }
    api.loadProjectModel(projectPath, studyModels[0]?.id)
      .then(res => {
        if (res?.spec) {
          setModelArrows(maxArrowsFromSpec(res.spec));
        }
      })
      .catch(() => {});
  }, [projectPath, studyModels]);

  const totalMissingValues = useMemo(
    () => dataset.variables.reduce((sum, v) => sum + (v.missingCount || 0), 0),
    [dataset.variables]
  );

  const selectedGroup = groups.find(g => g.id === selectedGroupId) || null;

  const { minN, warnings } = useMemo(
    () => validateDataGroupsLocal(groups, modelArrows, sigLevel, minR2),
    [groups, modelArrows, sigLevel, minR2]
  );

  const persistGroups = async (nextGroups: DataGroup[]) => {
    onGroupsUpdated(nextGroups);
    if (projectPath) {
      await mgaApi
        .saveGroups({
          projectPath,
          datasetId: dataset.id,
          columns,
          rows: dataset.rows,
          dataGroups: nextGroups,
        })
        .catch(() => {});
    }
  };

  const handleGenerated = (newGroups: DataGroup[]) => {
    const next = [...groups, ...newGroups];
    persistGroups(next);
    if (newGroups[0]) {
      setSelectedGroupId(newGroups[0].id);
    }
  };

  const handleSaveGroup = (saved: DataGroup) => {
    const exists = groups.some(g => g.id === saved.id);
    const next = exists
      ? groups.map(g => (g.id === saved.id ? saved : g))
      : [...groups, saved];
    persistGroups(next);
    setSelectedGroupId(saved.id);
  };

  const handleDeleteSelected = () => {
    if (!selectedGroup) return;
    requestDelete({
      title: 'Delete Data Group',
      itemName: selectedGroup.name,
      message: `Are you sure you want to delete the data group "${selectedGroup.name}"?`,
      onConfirm: () => {
        const next = groups.filter(g => g.id !== selectedGroup.id);
        persistGroups(next);
      },
    });
  };

  const openEqualizeModal = () => {
    if (groups.length < 2) return;
    setEqGroupAId(groups[0].id);
    setEqGroupBId(groups[1].id);
    setEqSeed(Math.floor(Math.random() * 900000) + 100000);
    setEqError(null);
    setIsEqualizeOpen(true);
  };

  const handleEqualize = async (e: React.FormEvent) => {
    e.preventDefault();
    const gA = groups.find(g => g.id === eqGroupAId);
    const gB = groups.find(g => g.id === eqGroupBId);
    if (!gA || !gB || gA.id === gB.id) {
      setEqError('Select two distinct groups.');
      return;
    }
    setIsEqualizing(true);
    setEqError(null);
    try {
      const res = await mgaApi.equalizeGroupSizes({
        projectPath,
        datasetId: dataset.id,
        datasetName: dataset.filename,
        columns,
        rows: dataset.rows,
        dataGroups: groups,
        groupA: gA,
        groupB: gB,
        seed: eqSeed,
      });
      if (res.error) {
        setEqError(res.error);
        setIsEqualizing(false);
        return;
      }
      if (res.columns && res.rows) {
        const balanced = processData(res.datasetName || `${dataset.filename}_balanced`, res.columns, res.rows);
        balanced.id = res.datasetId || `ds_bal_${Date.now()}`;
        balanced.dataGroups = res.dataGroups || groups;
        onDatasetCreated?.(balanced);
        setInfoBanner(
          `Created balanced dataset "${balanced.filename}" (each group equalized to n=${res.targetN}, seed=${res.seed}).`
        );
      }
      setIsEqualizeOpen(false);
    } catch (err: any) {
      setEqError(err?.message || 'Failed to equalize group sizes.');
    } finally {
      setIsEqualizing(false);
    }
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Header Summary + Toolbar (§3.3, §3.4) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '14px 16px',
        borderRadius: '10px',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={18} style={{ color: 'var(--color-accent)' }} />
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Data Groups
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            <span>Sample size: <strong style={{ color: 'var(--color-text-primary)' }}>{dataset.rows.length}</strong></span>
            <span>Indicators: <strong style={{ color: 'var(--color-text-primary)' }}>{dataset.variables.length}</strong></span>
            <span>Missing values: <strong style={{ color: 'var(--color-text-primary)' }}>{totalMissingValues}</strong></span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setIsGenerateOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--color-accent)',
              color: '#fff',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Users size={14} />
            <span>Generate Data Groups</span>
          </button>
          <button
            type="button"
            onClick={() => setEditingGroup('new')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 12px',
              borderRadius: '8px',
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-base)',
              color: 'var(--color-text-primary)',
              fontSize: '12.5px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <Plus size={14} />
            <span>Add Group</span>
          </button>
          {groups.length >= 2 && (
            <button
              type="button"
              onClick={openEqualizeModal}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 12px',
                borderRadius: '8px',
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-base)',
                color: 'var(--color-text-secondary)',
                fontSize: '12.5px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
              title="Randomly remove cases from the larger group down to the smaller group's size"
            >
              <Scale size={14} />
              <span>Randomly equalize group sizes</span>
            </button>
          )}
        </div>
      </div>

      {infoBanner && (
        <div style={{
          padding: '10px 14px',
          borderRadius: '8px',
          background: 'rgba(22, 163, 74, 0.08)',
          border: '1px solid rgba(22, 163, 74, 0.25)',
          color: '#15803d',
          fontSize: '12.5px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span>{infoBanner}</span>
          <button type="button" onClick={() => setInfoBanner(null)} style={{ background: 'none', border: 'none', color: '#15803d', cursor: 'pointer', fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* Groups Table + Selected Row Action Buttons (§3.4) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '14px', alignItems: 'start' }}>
        <div style={{
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '10px',
          overflow: 'hidden',
          background: 'var(--color-bg-surface)',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-raised)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
                  Name
                </th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', width: '140px' }}>
                  Records
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={2} style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '12.5px' }}>
                    No data groups defined yet. Click <strong>Generate Data Groups</strong> to create groups from a categorical column.
                  </td>
                </tr>
              ) : (
                groups.map(g => {
                  const isSelected = g.id === selectedGroupId;
                  return (
                    <tr
                      key={g.id}
                      onClick={() => setSelectedGroupId(g.id)}
                      onDoubleClick={() => setEditingGroup(g)}
                      style={{
                        borderBottom: '1px solid var(--color-border-subtle)',
                        background: isSelected ? 'var(--color-accent-subtle)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: isSelected ? 600 : 500, color: 'var(--color-text-primary)' }}>
                        <div>{g.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                          {g.terms.map(t => `${t.column} ${t.operator} ${t.value1}${t.operator === 'is between' ? ` .. ${t.value2}` : ''}`).join(` ${g.conditionLinkType} `)}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {g.recordCount}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Selected Row Buttons on the Right (§3.4) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '110px' }}>
          <button
            type="button"
            disabled={!selectedGroup}
            onClick={() => selectedGroup && setEditingGroup(selectedGroup)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-surface)',
              color: selectedGroup ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              fontSize: '12.5px',
              fontWeight: 500,
              cursor: selectedGroup ? 'pointer' : 'not-allowed',
              opacity: selectedGroup ? 1 : 0.5,
            }}
          >
            <Edit3 size={14} />
            <span>Edit</span>
          </button>
          <button
            type="button"
            disabled={!selectedGroup}
            onClick={handleDeleteSelected}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              background: 'rgba(239, 68, 68, 0.06)',
              color: '#dc2626',
              fontSize: '12.5px',
              fontWeight: 500,
              cursor: selectedGroup ? 'pointer' : 'not-allowed',
              opacity: selectedGroup ? 1 : 0.5,
            }}
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {/* Group Validation Panel (§3.5) */}
      <div style={{
        padding: '16px',
        borderRadius: '10px',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Group Validation &amp; Statistical Power Check (Hair et al., 2014 Table 10.1)
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
              Max arrows pointing at a construct: <strong>{modelArrows}</strong> · Recommended minimum per group for 80% power: <strong>{minN}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '12px' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-secondary)' }}>
              <span>Significance level:</span>
              <select
                value={sigLevel}
                onChange={e => setSigLevel(e.target.value as '0.01' | '0.05' | '0.10')}
                style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-base)', color: 'var(--color-text-primary)', fontSize: '12px' }}
              >
                <option value="0.01">1%</option>
                <option value="0.05">5%</option>
                <option value="0.10">10%</option>
              </select>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-secondary)' }}>
              <span>Minimum R²:</span>
              <select
                value={minR2}
                onChange={e => setMinR2(e.target.value as '0.10' | '0.25' | '0.50' | '0.75')}
                style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-base)', color: 'var(--color-text-primary)', fontSize: '12px' }}
              >
                <option value="0.10">0.10</option>
                <option value="0.25">0.25</option>
                <option value="0.50">0.50</option>
                <option value="0.75">0.75</option>
              </select>
            </label>
          </div>
        </div>

        {groups.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
            Create at least two data groups to validate sample sizes and group balance.
          </div>
        ) : warnings.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'rgba(22, 163, 74, 0.08)',
            border: '1px solid rgba(22, 163, 74, 0.25)',
            color: '#15803d',
            fontSize: '12.5px',
          }}>
            <CheckCircle2 size={16} />
            <span>All groups meet the recommended minimum sample size (n ≥ {minN}) and are comparable in size (≤ 50% difference).</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {warnings.map((w, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  color: '#b45309',
                  fontSize: '12.5px',
                  lineHeight: 1.45,
                }}
              >
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <GenerateDataGroupsDialog
        isOpen={isGenerateOpen}
        onClose={() => setIsGenerateOpen(false)}
        columns={columns}
        rows={dataset.rows}
        existingGroups={groups}
        projectPath={projectPath}
        datasetId={dataset.id}
        onGenerated={handleGenerated}
      />

      <ConfigureDataGroupDialog
        isOpen={editingGroup !== null}
        onClose={() => setEditingGroup(null)}
        columns={columns}
        rows={dataset.rows}
        initialGroup={editingGroup === 'new' ? null : editingGroup}
        onSave={handleSaveGroup}
      />

      {isEqualizeOpen && (
        <div className="modal-overlay active" style={{ display: 'flex', zIndex: 9999 }} onClick={() => setIsEqualizeOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px', width: '92vw' }}>
            <div className="modal__header">
              <h2 className="modal__title">Randomly Equalize Group Sizes</h2>
              <button className="icon-btn icon-btn--sm" type="button" onClick={() => setIsEqualizeOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleEqualize}>
              <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {eqError && (
                  <div style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#dc2626', fontSize: '12px' }}>
                    {eqError}
                  </div>
                )}
                <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Creates a derived dataset named <strong>{dataset.filename.replace(/\.[^.]+$/, '')}_balanced</strong> by randomly subsampling the larger group down to the smaller group&apos;s size.
                </p>
                <div className="modal__field" style={{ marginBottom: 0 }}>
                  <label className="modal__label">Group A</label>
                  <select className="modal__input" value={eqGroupAId} onChange={e => setEqGroupAId(e.target.value)}>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>{g.name} (n={g.recordCount})</option>
                    ))}
                  </select>
                </div>
                <div className="modal__field" style={{ marginBottom: 0 }}>
                  <label className="modal__label">Group B</label>
                  <select className="modal__input" value={eqGroupBId} onChange={e => setEqGroupBId(e.target.value)}>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>{g.name} (n={g.recordCount})</option>
                    ))}
                  </select>
                </div>
                <div className="modal__field" style={{ marginBottom: 0 }}>
                  <label className="modal__label">Random Seed</label>
                  <input
                    type="number"
                    className="modal__input"
                    value={eqSeed}
                    onChange={e => setEqSeed(parseInt(e.target.value || '42', 10) || 42)}
                  />
                </div>
              </div>
              <div className="modal__footer">
                <button className="modal__btn-cancel" type="button" onClick={() => setIsEqualizeOpen(false)} disabled={isEqualizing}>
                  Cancel
                </button>
                <button className="modal__btn-create" type="submit" disabled={isEqualizing || eqGroupAId === eqGroupBId}>
                  {isEqualizing ? 'Equalizing…' : 'Create Balanced Dataset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

