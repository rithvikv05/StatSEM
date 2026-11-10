import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useStore, getStudyDatasets } from '../store';
import { processData, type ParsedDataset, type ParsedVariable } from '../utils/dataset-parser';
import { EditableCell } from '../components/EditableCell';
import { Checkbox } from '../components/Checkbox';
import { api } from '../utils/api';
import AppSidebar from '../components/AppSidebar';
import { DataScreeningPanel } from '../components/DataScreeningPanel';

export const DatasetView: React.FC = () => {
  const {
    tabs,
    activeTabId,
    workspaces,
    activeWorkspaceId,
    studies,
    activeStudyId,
    models,
    datasetsByStudy,
    setStudyDataset,
    touchStudy,
    openTab
  } = useStore();

  const activeTab = tabs.find(t => t.id === activeTabId);
  const currentStudyId = activeTab?.studyId || activeStudyId || '';
  const activeWorkspace = workspaces.find(w => w.id === (activeTab?.workspaceId || activeWorkspaceId));
  const activeStudy = studies.find(s => s.id === currentStudyId);
  const studyModels = useMemo(() => models.filter(m => m.studyId === currentStudyId), [models, currentStudyId]);

  const studyDatasets = useMemo(() => getStudyDatasets(datasetsByStudy, currentStudyId), [datasetsByStudy, currentStudyId]);
  const activeDataset = useMemo(() => {
    if (activeTab?.datasetId) {
      return studyDatasets.find(d => d.id === activeTab.datasetId) || studyDatasets[0] || null;
    }
    return studyDatasets[0] || null;
  }, [studyDatasets, activeTab?.datasetId]);

  const [dataset, setDataset] = useState<ParsedDataset | null>(activeDataset);
  const [currentView, setCurrentView] = useState<'variables' | 'data' | 'screening'>('variables');
  const [searchFilter, setSearchFilter] = useState('');
  const [isVariableSearchOpen, setIsVariableSearchOpen] = useState(false);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [saveToast, setSaveToast] = useState<string | null>(null);

  useEffect(() => {
    if (activeDataset) setDataset(activeDataset);
  }, [activeDataset]);

  const detectedMarker = useMemo(() => {
    if (!dataset?.rows) return '';
    for (const row of dataset.rows) {
      for (const val of row || []) {
        if (val === -99 || val === '-99') return '-99';
      }
    }
    return '';
  }, [dataset?.rows]);

  const [missingMarker, setMissingMarker] = useState(detectedMarker || '');
  const [treatment, setTreatment] = useState<'none' | 'listwise' | 'mean'>('none');

  const persistChanges = (updated: ParsedDataset) => {
    setDataset(updated);
    if (currentStudyId) {
      setStudyDataset(currentStudyId, updated);
      touchStudy(currentStudyId);
      if (activeStudy?.path) {
        const headers = updated.variables.map(v => v.name);
        api.saveProjectDataJson(activeStudy.path, updated.filename, headers, updated.rows, updated.id)
          .catch(err => console.warn('Failed auto-saving dataset:', err));
      }
    }
  };

  const applyMissingSettings = (marker: string, treat: 'none' | 'listwise' | 'mean') => {
    if (!dataset) return;
    const headers = dataset.variables.map(v => v.name);
    const reprocessed = processData(dataset.filename, headers, dataset.rows, {
      missingValueMarker: marker,
      treatment: treat
    });
    const currentVarsMap = new Map(dataset.variables.map(v => [v.name, v]));
    const mergedVars = reprocessed.variables.map(v => {
      const existing = currentVarsMap.get(v.name);
      return existing ? { ...v, selected: existing.selected, scaleType: v.scaleType, name: existing.name } : v;
    });
    persistChanges({ ...reprocessed, filename: dataset.filename, variables: mergedVars });
  };

  const handleMissingMarkerChange = (val: string) => { setMissingMarker(val); applyMissingSettings(val, treatment); };
  const handleTreatmentChange = (val: 'none' | 'listwise' | 'mean') => { setTreatment(val); applyMissingSettings(missingMarker, val); };

  const toggleVariableSelection = (colIdx: number) => {
    if (!dataset) return;
    const newVars = [...dataset.variables];
    newVars[colIdx] = { ...newVars[colIdx], selected: !newVars[colIdx].selected };
    persistChanges({ ...dataset, variables: newVars });
  };

  const toggleAllVariables = () => {
    if (!dataset) return;
    const shouldSelect = dataset.variables.some(v => !v.selected);
    persistChanges({ ...dataset, variables: dataset.variables.map(v => ({ ...v, selected: shouldSelect })) });
  };

  const setVariableScale = (colIdx: number, scaleType: ParsedVariable['scaleType']) => {
    if (!dataset) return;
    const newVars = [...dataset.variables];
    newVars[colIdx] = { ...newVars[colIdx], scaleType };
    persistChanges({ ...dataset, variables: newVars });
  };

  const updateVariableName = (colIdx: number, newName: string) => {
    if (!dataset || !newName.trim()) return;
    const newVars = [...dataset.variables];
    newVars[colIdx] = { ...newVars[colIdx], name: newName.trim() };
    persistChanges({ ...dataset, variables: newVars });
    setSaveToast('Saved');
    setTimeout(() => setSaveToast(null), 1800);
  };

  const filteredVariables = useMemo(() => {
    if (!dataset?.variables) return [];
    if (!searchFilter.trim()) return dataset.variables;
    const q = searchFilter.toLowerCase();
    return dataset.variables.filter(v => v.name.toLowerCase().includes(q) || (v.scaleType && v.scaleType.toLowerCase().includes(q)));
  }, [dataset?.variables, searchFilter]);

  const sortedRows = useMemo(() => {
    if (!dataset?.rows) return [];
    if (sortCol === null) return dataset.rows;
    return [...dataset.rows].sort((a, b) => {
      const valA = a[sortCol], valB = b[sortCol];
      if (valA == null || valA === '') return 1;
      if (valB == null || valB === '') return -1;
      const numA = Number(valA), numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB)) return sortDirection === 'asc' ? numA - numB : numB - numA;
      return sortDirection === 'asc' ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
    });
  }, [dataset?.rows, sortCol, sortDirection]);

  const statsMap = useMemo(() => {
    if (!dataset?.rows || !dataset?.variables) return new Map<number, { mean?: number; median?: number; stdDev?: number }>();
    const map = new Map<number, { mean?: number; median?: number; stdDev?: number }>();
    dataset.variables.forEach((_, colIdx) => {
      const vals: number[] = [];
      for (const row of dataset.rows) {
        const val = row[colIdx];
        if (val != null && val !== '') { const num = Number(val); if (!isNaN(num)) vals.push(num); }
      }
      if (vals.length > 0) {
        vals.sort((a, b) => a - b);
        const mean = vals.reduce((a, x) => a + x, 0) / vals.length;
        const median = vals.length % 2 === 1 ? vals[Math.floor(vals.length / 2)] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
        const stdDev = Math.sqrt(vals.reduce((a, x) => a + Math.pow(x - mean, 2), 0) / vals.length);
        map.set(colIdx, { mean, median, stdDev });
      }
    });
    return map;
  }, [dataset?.rows, dataset?.variables]);

  const handleSort = (colIdx: number) => {
    if (sortCol === colIdx) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else { setSortCol(null); setSortDirection('asc'); }
    } else { setSortCol(colIdx); setSortDirection('asc'); }
  };

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!dataset) {
    return (
      <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
        <AppSidebar activeNav="workspace" />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'var(--color-bg-base)', color: 'var(--color-text-muted)' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '36px' }}>dataset</span>
          <p style={{ fontSize: '13px', margin: 0, color: 'var(--color-text-secondary)' }}>No dataset loaded for this study.</p>
        </div>
      </div>
    );
  }

  const selectedCount = dataset.variables.filter(v => v.selected).length;

  // Shared th style
  const th: React.CSSProperties = {
    padding: '0 14px',
    height: '34px',
    fontWeight: 600,
    fontSize: '10.5px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--color-text-muted)',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--color-border-subtle)',
    background: 'var(--color-bg-raised)',
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
      <AppSidebar activeNav="workspace" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--color-bg-base)' }}>

        {/* ── Sub-header ── */}
        <div className="subheader">
          {/* Breadcrumb */}
          <div className="subheader__breadcrumb">
            <span className="subheader__breadcrumb-link" onClick={() => activeWorkspace && openTab({ type: 'workspace', title: activeWorkspace.name, workspaceId: activeWorkspace.id })}>
              {activeWorkspace?.name || 'Workspace'}
            </span>
            <span className="subheader__breadcrumb-sep">/</span>
            <span className="subheader__breadcrumb-link" onClick={() => activeWorkspace && openTab({ type: 'workspace', title: activeWorkspace.name, workspaceId: activeWorkspace.id })}>
              {activeStudy?.name || 'Study'}
            </span>
            <span className="subheader__breadcrumb-sep">/</span>
            <span className="subheader__breadcrumb-current">{dataset.filename}</span>
          </div>

          {/* Right: switcher + inline controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Missing value inline control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: 'var(--color-text-muted)' }}>
              <span>Missing:</span>
              <input
                type="text"
                value={missingMarker}
                onChange={e => handleMissingMarkerChange(e.target.value)}
                placeholder="—"
                style={{ width: '44px', height: '24px', padding: '0 6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-raised)', fontSize: '11.5px', color: 'var(--color-text-primary)', outline: 'none', fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div className="subheader__divider" />
            <select
              value={treatment}
              onChange={e => handleTreatmentChange(e.target.value as any)}
              style={{ height: '24px', padding: '0 6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-raised)', fontSize: '11.5px', color: 'var(--color-text-muted)', cursor: 'pointer', outline: 'none', fontFamily: 'inherit' }}
            >
              <option value="none">No treatment</option>
              <option value="mean">Mean replacement</option>
              <option value="listwise">Listwise deletion</option>
            </select>
            <div className="subheader__divider" />
            {/* View switcher */}
            <div className="subheader__switcher" style={{ marginRight: 0 }}>
              <button type="button" className={`subheader__switcher-btn ${currentView === 'variables' ? 'active' : ''}`} onClick={() => setCurrentView('variables')}>
                Variables <span style={{ opacity: 0.55, fontWeight: 400 }}>({dataset.variables.length})</span>
              </button>
              <button type="button" className={`subheader__switcher-btn ${currentView === 'data' ? 'active' : ''}`} onClick={() => setCurrentView('data')}>
                Data <span style={{ opacity: 0.55, fontWeight: 400 }}>({dataset.rows.length})</span>
              </button>
              <button type="button" className={`subheader__switcher-btn ${currentView === 'screening' ? 'active' : ''}`} onClick={() => setCurrentView('screening')}>
                Data Screening
              </button>
            </div>
          </div>
        </div>

        {/* ── View content ── */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {currentView === 'variables' ? (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ width: '100%', minWidth: '820px', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: '40px', padding: '0 12px' }}>
                      <Checkbox
                        checked={selectedCount === dataset.variables.length}
                        indeterminate={selectedCount > 0 && selectedCount < dataset.variables.length}
                        onChange={toggleAllVariables}
                        ariaLabel="Select all variables"
                      />
                    </th>
                    <th style={{ ...th, width: '220px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {isVariableSearchOpen ? (
                          <div className="inline-search-wrap" style={{ maxWidth: '160px' }}>
                            <input autoFocus className="studies-inline-search" value={searchFilter} onChange={e => setSearchFilter(e.target.value)} onBlur={() => { if (!searchFilter) setIsVariableSearchOpen(false); }} placeholder="Filter…" />
                            {searchFilter && <button className="inline-search-clear" type="button" onMouseDown={e => e.preventDefault()} onClick={() => setSearchFilter('')}>×</button>}
                          </div>
                        ) : <span>Variable</span>}
                        <button type="button" style={{ padding: '2px', borderRadius: 'var(--radius-sm)', color: isVariableSearchOpen ? 'var(--color-accent)' : 'var(--color-text-muted)', display: 'flex', alignItems: 'center', border: 'none', background: 'transparent', cursor: 'pointer' }} title="Filter variables" onClick={() => { setIsVariableSearchOpen(o => !o); if (isVariableSearchOpen) setSearchFilter(''); }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>search</span>
                        </button>
                      </div>
                    </th>
                    <th style={{ ...th, width: '160px' }}>Scale</th>
                    <th style={{ ...th, textAlign: 'right' as const }}>Missing</th>
                    <th style={{ ...th, textAlign: 'right' as const }}>Mean</th>
                    <th style={{ ...th, textAlign: 'right' as const }}>Median</th>
                    <th style={{ ...th, textAlign: 'right' as const }}>Min</th>
                    <th style={{ ...th, textAlign: 'right' as const }}>Max</th>
                    <th style={{ ...th, textAlign: 'right' as const }}>SD</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVariables.map((v, i) => {
                    const idx = dataset.variables.findIndex(o => o.name === v.name);
                    const colIdx = idx >= 0 ? idx : i;
                    const missingPct = dataset.rows.length > 0 ? ((v.missingCount / dataset.rows.length) * 100).toFixed(1) : '0.0';
                    const stats = statsMap.get(colIdx);
                    return (
                      <tr key={v.name + i} style={{ borderBottom: '1px solid var(--color-border-subtle)', opacity: v.selected ? 1 : 0.45, transition: 'opacity 0.15s' }}>
                        <td style={{ padding: '0 12px', height: '34px' }}>
                          <Checkbox
                            checked={v.selected}
                            onChange={() => toggleVariableSelection(colIdx)}
                            ariaLabel={`Select ${v.name}`}
                          />
                        </td>
                        <td style={{ padding: '0 14px', height: '34px', fontWeight: 500, color: 'var(--color-text-primary)', maxWidth: '220px', overflow: 'hidden' }}>
                          <EditableCell value={v.name} onChange={newName => updateVariableName(colIdx, newName)} />
                        </td>
                        <td style={{ padding: '0 14px', height: '34px' }}>
                          {(() => {
                            const scales: ParsedVariable['scaleType'][] = ['Metric', 'Ordinal', 'Categorical'];
                            const labels: Record<string, string> = { Metric: 'Continuous', Ordinal: 'Ordinal', Categorical: 'Categorical' };
                            const current = v.scaleType || 'Metric';
                            const nextScale = scales[(scales.indexOf(current) + 1) % scales.length];
                            return (
                              <button
                                type="button"
                                title={`Click to change — next: ${labels[nextScale]}`}
                                onClick={() => setVariableScale(colIdx, nextScale)}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', height: '20px', padding: '0 7px', borderRadius: '10px', border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-raised)', fontSize: '10.5px', fontWeight: 500, color: 'var(--color-text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', transition: 'border-color 0.12s, color 0.12s' }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-accent)'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-subtle)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'; }}
                              >
                                {labels[current]}
                              </button>
                            );
                          })()}
                        </td>
                        <td style={{ padding: '0 14px', textAlign: 'right', color: v.missingCount > 0 ? 'var(--color-danger, #ef4444)' : 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums', fontSize: '11.5px' }}>
                          {v.missingCount > 0 ? `${v.missingCount} (${missingPct}%)` : '—'}
                        </td>
                        <td style={{ padding: '0 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: '11.5px' }}>{stats?.mean !== undefined ? stats.mean.toFixed(3) : '—'}</td>
                        <td style={{ padding: '0 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: '11.5px' }}>{stats?.median !== undefined ? stats.median.toFixed(3) : '—'}</td>
                        <td style={{ padding: '0 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: '11.5px' }}>{v.min ?? '—'}</td>
                        <td style={{ padding: '0 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: '11.5px' }}>{v.max ?? '—'}</td>
                        <td style={{ padding: '0 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: '11.5px' }}>{stats?.stdDev !== undefined ? stats.stdDev.toFixed(3) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : currentView === 'data' ? (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: '48px', textAlign: 'center', borderRight: '1px solid var(--color-border-subtle)' }}>#</th>
                    {dataset.variables.map((v, colIdx) => (
                      <th key={v.name} onClick={() => handleSort(colIdx)} style={{ ...th, textAlign: 'right', cursor: 'pointer', color: sortCol === colIdx ? 'var(--color-accent)' : 'var(--color-text-muted)', userSelect: 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '3px' }}>
                          {v.name}
                          {sortCol === colIdx && <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>{sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, rowIdx) => (
                    <tr key={rowIdx} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <td style={{ padding: '0 10px', height: '30px', textAlign: 'center', color: 'var(--color-text-muted)', borderRight: '1px solid var(--color-border-subtle)', fontVariantNumeric: 'tabular-nums', fontSize: '11px', background: 'var(--color-bg-raised)' }}>{rowIdx + 1}</td>
                      {row.map((val, cellIdx) => (
                        <td key={cellIdx} style={{ padding: '0 14px', height: '30px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: val === null || val === undefined || val === '' ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>
                          {val === null || val === undefined || val === '' ? '—' : String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <DataScreeningPanel
              projectPath={activeStudy?.path || ''}
              datasetId={dataset.id || dataset.filename}
              modelId={studyModels[0]?.id || undefined}
              availableModels={studyModels}
              datasetName={dataset.filename}
              totalRows={dataset.rows.length}
              variables={dataset.variables}
              onDatasetUpdated={() => {
                if (activeStudy?.path) {
                  api.loadProjectData(activeStudy.path)
                    .then(res => {
                      if (res && res.columns && res.rows) {
                        const reprocessed = processData(res.dataset_name || dataset.filename, res.columns, res.rows);
                        persistChanges(reprocessed);
                      }
                    });
                }
              }}
            />
          )}
        </div>

        {/* ── Slim status footer ── */}
        <div style={{ height: '24px', borderTop: '1px solid var(--color-border-subtle)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '16px', fontSize: '11px', color: 'var(--color-text-muted)', flexShrink: 0, background: 'var(--color-bg-base)' }}>
          <span>{dataset.variables.length} variables</span>
          <span style={{ width: '1px', height: '10px', background: 'var(--color-border-subtle)' }} />
          <span>{dataset.rows.length} observations</span>
          <span style={{ width: '1px', height: '10px', background: 'var(--color-border-subtle)' }} />
          <span style={{ color: 'var(--color-accent)' }}>{selectedCount} active</span>
        </div>
      </div>

      {/* Toast */}
      {saveToast && (
        <div style={{ position: 'fixed', bottom: '32px', right: '20px', background: 'var(--color-bg-elevated)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)', padding: '7px 14px', borderRadius: 'var(--radius-md)', fontSize: '12px', fontWeight: 500, boxShadow: 'var(--shadow-float)', zIndex: 9999, display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ color: '#10b981', fontSize: '14px' }}>✓</span> {saveToast}
        </div>
      )}
    </div>
  );
};

export default DatasetView;
