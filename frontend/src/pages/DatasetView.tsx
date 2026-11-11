import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useStore, getStudyDatasets } from '../store';
import { formatNumber, normalizeDecimalDigits } from '../utils/number-format';
import { processData, type ParsedDataset, type ParsedVariable } from '../utils/dataset-parser';
import { EditableCell } from '../components/EditableCell';
import { Checkbox } from '../components/Checkbox';
import { api } from '../utils/api';
import AppSidebar from '../components/AppSidebar';
import './dataset-view.css';

export const DatasetView: React.FC = () => {
  const {
    tabs,
    activeTabId,
    workspaces,
    activeWorkspaceId,
    studies,
    activeStudyId,
    datasetsByStudy,
    setStudyDataset,
    setStudyDatasets,
    updateTabTitle,
    touchStudy,
    settings
  } = useStore();
  const decimalDigits = normalizeDecimalDigits(settings.decimalDigits);
  const decimalSystem = settings.decimalSystem;

  const activeTab = tabs.find(t => t.id === activeTabId);
  const currentStudyId = activeTab?.studyId || activeStudyId || '';
  const activeWorkspace = workspaces.find(w => w.id === (activeTab?.workspaceId || activeWorkspaceId));
  const activeStudy = studies.find(s => s.id === currentStudyId);

  const studyDatasets = useMemo(() => getStudyDatasets(datasetsByStudy, currentStudyId), [datasetsByStudy, currentStudyId]);
  const activeDataset = useMemo(() => {
    if (activeTab?.datasetId) {
      return studyDatasets.find(d => d.id === activeTab.datasetId) || studyDatasets[0] || null;
    }
    return studyDatasets[0] || null;
  }, [studyDatasets, activeTab?.datasetId]);

  const [dataset, setDataset] = useState<ParsedDataset | null>(activeDataset);
  const [currentView, setCurrentView] = useState<'variables' | 'data'>('variables');
  const [searchFilter, setSearchFilter] = useState('');
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [isVariableSearchOpen, setIsVariableSearchOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const cancelledRename = useRef(false);
  const renameInProgress = useRef(false);

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
        api.saveProjectDataJson(activeStudy.path, updated.filename, headers, updated.rows, undefined, undefined, updated.id)
          .catch(err => console.warn('Failed auto-saving dataset:', err));
      }
    }
  };

  const commitDatasetRename = async () => {
    if (cancelledRename.current) { cancelledRename.current = false; return; }
    if (!dataset || renameInProgress.current) return;
    const name = editName.trim();
    setIsEditingName(false);
    if (!name || name === dataset.filename) return;
    renameInProgress.current = true;
    try {
      if (activeStudy?.path) {
        const response = await api.renameProjectDataset(activeStudy.path, dataset.id || '1', name);
        if (response.error) throw new Error(response.error);
      }
      const updated = { ...dataset, filename: name };
      setDataset(updated);
      if (currentStudyId) {
        setStudyDatasets(currentStudyId, studyDatasets.map(item => item === activeDataset || (!!dataset.id && item.id === dataset.id) ? updated : item));
        touchStudy(currentStudyId);
      }
      tabs.filter(tab => tab.type === 'dataset' && tab.studyId === currentStudyId && (dataset.id ? tab.datasetId === dataset.id : tab.id === activeTabId)).forEach(tab => updateTabTitle(tab.id, name));
      setSaveToast('Dataset renamed');
      setTimeout(() => setSaveToast(null), 1800);
    } catch (error) {
      alert(`Could not rename dataset: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally { renameInProgress.current = false; }
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
      <div className="dataset-layout">
        <AppSidebar activeNav="workspace" />
        <div className="dataset-empty">
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
    position: 'sticky',
    top: 0,
    zIndex: 1,
  };

  return (
    <div className="dataset-layout">
      <AppSidebar activeNav="workspace" />
      <main className="dataset-main">
        <header className="ws-header dataset-header">
          <div className="ws-header__left dataset-header__title">
            {isEditingName ? <input className="ws-title-rename-input" aria-label="Dataset name" value={editName} size={Math.max(editName.length, 1)} autoFocus onFocus={e => e.currentTarget.select()} onChange={e => setEditName(e.target.value)} onBlur={() => void commitDatasetRename()} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelledRename.current = true; setIsEditingName(false); } }} /> : <h1 className="ws-title-editable" title="Double-click to rename dataset" onDoubleClick={() => { cancelledRename.current = false; setEditName(dataset.filename); setIsEditingName(true); }}>{dataset.filename}</h1>}
          </div>
          <div className="ws-header__actions dataset-header__actions">
            <label className="dataset-control dataset-control--inline"><span>Missing value</span><input type="text" value={missingMarker} onChange={e => handleMissingMarkerChange(e.target.value)} placeholder="—" aria-label="Missing value marker" /></label>
            <label className="dataset-control dataset-control--inline"><span>Treatment</span><select value={treatment} onChange={e => handleTreatmentChange(e.target.value as 'none' | 'listwise' | 'mean')} aria-label="Missing value treatment"><option value="none">None</option><option value="mean">Mean replacement</option><option value="listwise">Listwise deletion</option></select></label>
            <div className="subheader__switcher dataset-view-switcher" role="group" aria-label="Dataset views">
              {([['variables', 'Variables'], ['data', 'Data']] as const).map(([view, label]) => <button key={view} type="button" className={`subheader__switcher-btn ${currentView === view ? 'active' : ''}`} aria-pressed={currentView === view} onClick={() => setCurrentView(view)}>{label}</button>)}
            </div>
          </div>
        </header>

        <section className="dataset-workspace" aria-label="Dataset workspace">
          <div className="dataset-panel">
        {/* ── View content ── */}
        <div className="dataset-content">
          {currentView === 'variables' ? (
            <div className="dataset-table-scroll">
              <table className="dataset-table dataset-table--variables" style={{ width: '100%', minWidth: '820px', borderCollapse: 'collapse', fontSize: '12.5px' }}>
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
                      <div className="dataset-variable-heading">
                        {isVariableSearchOpen ? <div className="inline-search-wrap"><input autoFocus className="studies-inline-search" value={searchFilter} onChange={e => setSearchFilter(e.target.value)} onBlur={() => { if (!searchFilter) setIsVariableSearchOpen(false); }} placeholder="Filter…" aria-label="Filter variables" />{searchFilter && <button className="inline-search-clear" type="button" onMouseDown={e => e.preventDefault()} onClick={() => setSearchFilter('')} aria-label="Clear filter">×</button>}</div> : <span>Variable</span>}
                        <button type="button" className={`dataset-filter-button ${isVariableSearchOpen ? 'active' : ''}`} title="Filter variables" aria-label="Filter variables" onClick={() => { setIsVariableSearchOpen(open => !open); if (isVariableSearchOpen) setSearchFilter(''); }}><span className="material-symbols-outlined" aria-hidden="true">search</span></button>
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
                        <td style={{ padding: '0 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: '11.5px' }}>{stats?.mean !== undefined ? formatNumber(stats.mean, decimalDigits, decimalSystem) : '—'}</td>
                        <td style={{ padding: '0 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: '11.5px' }}>{stats?.median !== undefined ? formatNumber(stats.median, decimalDigits, decimalSystem) : '—'}</td>
                        <td style={{ padding: '0 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: '11.5px' }}>{v.min ?? '—'}</td>
                        <td style={{ padding: '0 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: '11.5px' }}>{v.max ?? '—'}</td>
                        <td style={{ padding: '0 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: '11.5px' }}>{stats?.stdDev !== undefined ? formatNumber(stats.stdDev, decimalDigits, decimalSystem) : '—'}</td>
                      </tr>
                    );
                  })}
                  {filteredVariables.length === 0 && <tr><td colSpan={9} className="dataset-table__empty">No variables match your search.</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="dataset-table-scroll">
              <table className="dataset-table dataset-table--observations" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
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

          )}
        </div>

            <div className="dataset-status">
              <span className="dataset-status__path">{[activeWorkspace?.name || 'Workspace', activeStudy?.name || 'Study', dataset.filename].join(' / ')}</span>
              <span>{dataset.variables.length.toLocaleString()} variables</span>
              <span>{dataset.rows.length.toLocaleString()} observations</span>
              <span>{selectedCount.toLocaleString()} selected</span>
            </div>
          </div>
        </section>
      </main>

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
