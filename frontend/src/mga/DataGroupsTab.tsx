import React, { useEffect, useMemo, useState } from 'react';
import { Edit3, Plus, Trash2, Users } from 'lucide-react';
import type { ParsedDataset } from '../utils/dataset-parser';
import { useStore } from '../store';
import type { DataGroup } from './types';
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
  onGroupsUpdated,
}) => {
  const { requestDelete } = useStore();
  const groups = dataset.dataGroups || [];
  const columns = useMemo(() => dataset.variables.map(v => v.name), [dataset.variables]);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(groups[0]?.id || null);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DataGroup | null | 'new'>(null);

  useEffect(() => {
    if (!selectedGroupId || !groups.some(g => g.id === selectedGroupId)) {
      setSelectedGroupId(groups[0]?.id || null);
    }
  }, [groups, selectedGroupId]);

  const totalMissingValues = useMemo(
    () => dataset.variables.reduce((sum, v) => sum + (v.missingCount || 0), 0),
    [dataset.variables]
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

  const handleDeleteGroup = (g: DataGroup) => {
    requestDelete({
      title: 'Delete Data Group',
      itemName: g.name,
      message: `Are you sure you want to delete the data group "${g.name}"?`,
      onConfirm: () => {
        const next = groups.filter(item => item.id !== g.id);
        persistGroups(next);
      },
    });
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Header Summary + Toolbar */}
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
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Data Groups
          </span>
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
        </div>
      </div>

      {/* Groups Table with integrated edit and delete row actions */}
      <div style={{
        border: '1px solid var(--color-border-subtle)',
        borderRadius: '10px',
        overflow: 'hidden',
        background: 'var(--color-bg-surface)',
        width: '100%',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg-raised)', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
                Name
              </th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', width: '120px' }}>
                Records
              </th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', width: '90px' }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '12.5px' }}>
                  No data groups defined yet. Click <strong>Generate Data Groups</strong> or <strong>Add Group</strong> to create groups.
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
                        {g.terms.map(t => `${t.column} ${t.operator} ${t.value1}${t.operator === 'is between' || t.operator === 'is not between' ? ` .. ${t.value2}` : ''}`).join(` ${g.conditionLinkType} `)}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {g.recordCount}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setEditingGroup(g)}
                          title="Edit group"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '28px',
                            height: '28px',
                            borderRadius: '6px',
                            border: 'none',
                            background: 'var(--color-accent-subtle)',
                            color: 'var(--color-accent)',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteGroup(g)}
                          title="Delete group"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '28px',
                            height: '28px',
                            borderRadius: '6px',
                            border: 'none',
                            background: 'rgba(239, 68, 68, 0.08)',
                            color: '#ef4444',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
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
    </div>
  );
};
