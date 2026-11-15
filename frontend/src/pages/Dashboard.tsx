import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore, getStudyDatasets, type Study } from '../store';
import WorkspaceModal from '../components/WorkspaceModal';
import StudyModal from '../components/StudyModal';
import StudyWorkspaceDropdown from '../components/StudyWorkspaceDropdown';
import InputDialog from '../components/InputDialog';
import { parseDatasetFile } from '../utils/dataset-parser';
import type { ParsedDataset } from '../utils/dataset-parser';
import { api } from '../utils/api';
import { mgaApi } from '../mga/mgaApi';
import AppSidebar from '../components/AppSidebar';

export const formatModelType = (type?: string): string => {
  if (!type) return 'PLS-SEM';
  const clean = type.trim().toLowerCase().replace(/[-_\s]+/g, '');
  if (clean === 'pls' || clean === 'plssem') return 'PLS-SEM';
  if (clean === 'cbsem' || clean === 'cb') return 'CB-SEM';
  if (clean === 'regression') return 'Regression';
  return type.toUpperCase();
};

const Dashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    workspaces, archivedWorkspaces, activeWorkspaceId, setActiveWorkspace,
    studies, setActiveStudy, models, setActiveModel, addModel,
    datasetsByStudy, setStudyDataset, addStudyDataset, touchStudy, archiveWorkspace, restoreWorkspace, renameWorkspace,
    deleteWorkspace, deleteStudy, deleteModel, deleteDataset, requestDelete,
    archiveStudy, restoreStudy,
    renameStudy, duplicateStudy, renameModel, duplicateModel, openTab,
    togglePinStudy,
    snapshotsByStudy, setStudySnapshots, removeStudySnapshot,
    mgaReportsByStudy, setStudyMgaReports, removeStudyMgaReport,
    lastUsedDatasetByStudy,
    setStudyLastDatasetId,
    isSidebarCollapsed, toggleSidebar
  } = useStore();
  const snapshotsInFlight = useRef(new Set<string>());
  const mgaReportsInFlight = useRef(new Set<string>());
  
  useEffect(() => {
    if (!activeWorkspaceId && workspaces.length > 0) {
      setActiveWorkspace(workspaces[0].id);
    }
  }, [activeWorkspaceId, workspaces, setActiveWorkspace]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    const wsStudies = studies.filter(s => s.workspaceId === activeWorkspaceId);
    wsStudies.forEach(study => {
      if (study.path && !snapshotsInFlight.current.has(study.path)) {
        const path = study.path;
        snapshotsInFlight.current.add(path);
        api.listSnapshots(path).then(snaps => {
          if (Array.isArray(snaps)) {
            setStudySnapshots(path, snaps);
            if (study.id) {
              setStudySnapshots(study.id, snaps);
            }
          }
        }).catch(() => {}).finally(() => snapshotsInFlight.current.delete(path));
      }
      if (study.path && !mgaReportsByStudy[study.path] && !mgaReportsInFlight.current.has(study.path)) {
        const path = study.path;
        mgaReportsInFlight.current.add(path);
        mgaApi.listReports(path).then(res => {
          if (res && Array.isArray(res.reports)) {
            setStudyMgaReports(path, res.reports);
          }
        }).catch(() => {}).finally(() => mgaReportsInFlight.current.delete(path));
      }
    });
  }, [activeWorkspaceId, studies, setStudySnapshots, mgaReportsByStudy, setStudyMgaReports]);

  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [isWorkspaceSearchOpen, setIsWorkspaceSearchOpen] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [isStudySearchOpen, setIsStudySearchOpen] = useState(false);
  const [studyQuery, setStudyQuery] = useState('');
  const [expandedStudies, setExpandedStudies] = useState<Set<string>>(new Set());
  
  const [isStudyModalOpen, setIsStudyModalOpen] = useState(false);
  const [workspaceDropdownConfig, setWorkspaceDropdownConfig] = useState<{
    isOpen: boolean;
    mode: 'move' | 'copy';
    study: Study | null;
    position: { x: number; y: number } | null;
  }>({
    isOpen: false,
    mode: 'move',
    study: null,
    position: null,
  });
  const [inputDialogConfig, setInputDialogConfig] = useState<{isOpen: boolean; title: string; placeholder: string; submitLabel: string; initialValue?: string; onSubmit: (val: string) => void}>({
    isOpen: false, title: '', placeholder: '', submitLabel: '', onSubmit: () => {}
  });
  
  const [isModelModalOpen, setModelModalOpen] = useState(false);
  const [modelModalStudyId, setModelModalStudyId] = useState<string>('');
  const [modelName, setModelName] = useState('');
  const [modelType, setModelType] = useState('PLS-SEM');

  const [workspaceSubTab, setWorkspaceSubTab] = useState<'studies' | 'archive'>('studies');

  const formatDisplayDate = (isoStr?: string) => {
    try {
      const d = isoStr ? new Date(isoStr) : new Date();
      if (isNaN(d.getTime())) {
        return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      }
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  const formatFullDate = (isoStr?: string) => {
    try {
      const d = isoStr ? new Date(isoStr) : new Date();
      if (isNaN(d.getTime())) {
        return new Date().toLocaleString();
      }
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } catch {
      return new Date().toLocaleString();
    }
  };

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);
  const allWorkspaceStudies = studies.filter(s => s.workspaceId === activeWorkspaceId);
  const activeStudies = allWorkspaceStudies.filter(s => !s.isArchived);
  const archivedStudies = allWorkspaceStudies.filter(s => s.isArchived);

  const displayedStudies = workspaceSubTab === 'studies' ? activeStudies : archivedStudies;
  const filteredWorkspaces = workspaces.filter(workspace => workspace.name.toLocaleLowerCase().includes(workspaceQuery.toLocaleLowerCase()));
  const filteredStudies = displayedStudies.filter(study => study.name.toLocaleLowerCase().includes(studyQuery.toLocaleLowerCase()));

  // Sorting state for studies
  type SortField = 'name' | 'modified' | 'created';
  type SortOrder = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('modified');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setIsSortMenuOpen(false);
      }
    };
    if (isSortMenuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [isSortMenuOpen]);

  const sortedStudies = [...filteredStudies].sort((a, b) => {
    if (workspaceSubTab === 'archive') {
      const aTime = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
      const bTime = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
      if (aTime && bTime && aTime !== bTime) {
        return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      }
    }
    const aPinned = Boolean(a.isPinned);
    const bPinned = Boolean(b.isPinned);
    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }
    let comparison = 0;
    if (sortField === 'name') {
      comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    } else if (sortField === 'created') {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      comparison = aTime - bTime;
      if (comparison === 0) {
        comparison = a.name.localeCompare(b.name);
      }
    } else {
      // modified
      const aDate = Date.parse(a.lastModified);
      const bDate = Date.parse(b.lastModified);
      if (!isNaN(aDate) && !isNaN(bDate)) {
        comparison = aDate - bDate;
      } else {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        comparison = aTime - bTime;
      }
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  // Inline rename state for study, dataset, and model
  const [editingStudyId, setEditingStudyId] = useState<string | null>(null);
  const [editStudyName, setEditStudyName] = useState('');

  const [editingDatasetKey, setEditingDatasetKey] = useState<string | null>(null);
  const [editDatasetName, setEditDatasetName] = useState('');

  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editModelName, setEditModelName] = useState('');

  const commitStudyRename = (id: string) => {
    if (editStudyName.trim()) {
      renameStudy(id, editStudyName.trim());
    }
    setEditingStudyId(null);
  };

  const commitDatasetRename = (studyId: string, currentDataset: ParsedDataset) => {
    if (editDatasetName.trim() && editDatasetName.trim() !== currentDataset.filename) {
      const updated = { ...currentDataset, filename: editDatasetName.trim() };
      setStudyDataset(studyId, updated);
      touchStudy(studyId);
    }
    setEditingDatasetKey(null);
  };

  const commitModelRename = (id: string) => {
    if (editModelName.trim()) {
      renameModel(id, editModelName.trim());
    }
    setEditingModelId(null);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importingStudyId, setImportingStudyId] = useState<string | null>(null);

  // Inline workspace title renaming
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editWorkspaceTitle, setEditWorkspaceTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  useEffect(() => {
    setIsEditingTitle(false);
  }, [activeWorkspaceId]);

  const commitTitleRename = () => {
    if (activeWorkspace && editWorkspaceTitle.trim() && editWorkspaceTitle.trim() !== activeWorkspace.name) {
      renameWorkspace(activeWorkspace.id, editWorkspaceTitle.trim());
    }
    setIsEditingTitle(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseDatasetFile(file);
      if (importingStudyId) {
        await handleImportComplete(parsed);
        openTab({
          type: 'dataset',
          title: parsed.filename,
          studyId: importingStudyId,
          workspaceId: activeWorkspaceId,
        });
      }
    } catch (err) {
      alert("Error importing file: " + err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImportComplete = async (dataset: ParsedDataset) => {
    if (!importingStudyId) return;
    const dsId = dataset.id || `ds_${Date.now()}`;
    const newDs = { ...dataset, id: dsId };
    addStudyDataset(importingStudyId, newDs);
    touchStudy(importingStudyId);
    const study = studies.find((s) => s.id === importingStudyId);
    if (study?.path) {
      try {
        const headers = dataset.variables.map((v) => v.name);
        await api.saveProjectDataJson(study.path, dataset.filename, headers, dataset.rows, undefined, undefined, dsId);
      } catch (err) {
        console.warn('Failed to save dataset to project in Dashboard:', err);
      }
    }
    setImportingStudyId(null);
  };

  const handleExportProject = async (study: Study) => {
    if (!study.path) {
      alert('This project does not have a saved file on disk.');
      return;
    }
    try {
      let selected: string | null = null;
      const safeName = (study.name || 'Project').replace(/[/\\?%*:|"<>]/g, '_');
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        selected = await save({
          title: 'Export Project Archive',
          defaultPath: `${safeName}.zip`,
          filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
        });
      } catch {
        selected = window.prompt('Enter destination file path for .zip archive:', `${safeName}.zip`);
      }

      if (!selected) return;

      const outZipPath = selected.endsWith('.zip') ? selected : `${selected}.zip`;
      const res = await api.exportProjectZip(study.path, outZipPath);
      if (res?.error) {
        alert(`Export failed: ${res.error}`);
      }
    } catch (err: any) {
      console.error('Failed to export project:', err);
      alert(`Failed to export project: ${err?.message || err}`);
    }
  };

  const handleExportWorkspace = async (ws: { id: string; name: string; path?: string }) => {
    if (!ws.path) {
      alert('This workspace does not have a saved directory path on disk.');
      return;
    }
    try {
      let selected: string | null = null;
      const safeName = (ws.name || 'Workspace').replace(/[/\\?%*:|"<>]/g, '_');
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        selected = await save({
          title: 'Export Workspace Archive',
          defaultPath: `${safeName}.zip`,
          filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
        });
      } catch {
        selected = window.prompt('Enter destination file path for .zip archive:', `${safeName}.zip`);
      }

      if (!selected) return;

      const outZipPath = selected.endsWith('.zip') ? selected : `${selected}.zip`;
      const res = await api.exportWorkspaceZip(ws.path, outZipPath);
      if (res?.error) {
        alert(`Export failed: ${res.error}`);
      }
    } catch (err: any) {
      console.error('Failed to export workspace:', err);
      alert(`Failed to export workspace: ${err?.message || err}`);
    }
  };

  const handleCreateStudy = () => {
    setIsStudyModalOpen(true);
  };

  const openWorkspaceContextMenu = (e: React.MouseEvent, ws: { id: string; name: string; path?: string }) => {
    e.preventDefault();
    e.stopPropagation();
    useStore.getState().openContextMenu(e.clientX, e.clientY, [
      {
        id: 'new-study',
        label: 'New Study',
        icon: 'create_new_folder',
        action: () => handleCreateStudy(),
      },
      {
        id: 'rename',
        label: 'Rename Workspace',
        icon: 'edit',
        action: () => {
          setEditWorkspaceTitle(ws.name);
          setIsEditingTitle(true);
        },
      },
      {
        id: 'duplicate',
        label: 'Duplicate Workspace',
        icon: 'content_copy',
        action: () => useStore.getState().duplicateWorkspace(ws.id),
      },
      {
        id: 'export-workspace',
        label: 'Export Workspace…',
        icon: 'archive',
        action: () => handleExportWorkspace(ws),
      },
      {
        id: 'archive',
        label: 'Archive Workspace',
        icon: 'inventory_2',
        action: () => archiveWorkspace(ws.id),
      },
      {
        id: 'delete',
        label: 'Delete Workspace',
        icon: 'delete',
        danger: true,
        action: () => {
          requestDelete({
            title: 'Delete Workspace',
            itemName: ws.name,
            message:
              'Are you sure? This workspace and all its contents will be permanently deleted and cannot be recovered.',
            onConfirm: async () => {
              if (ws.path) {
                try {
                  await api.deleteWorkspace(ws.path);
                } catch (e) {
                  console.warn('Failed to delete workspace on disk:', e);
                }
              }
              deleteWorkspace(ws.id);
            },
          });
        },
      },
    ]);
  };

  const toggleStudy = (studyId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedStudies);
    if (newExpanded.has(studyId)) {
      newExpanded.delete(studyId);
    } else {
      newExpanded.add(studyId);
    }
    setExpandedStudies(newExpanded);
  };

  const openModelModal = (studyId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setModelModalStudyId(studyId);
    setModelName('');
    setModelType('PLS-SEM');
    setModelModalOpen(true);
  };

  const rename = (title: string, initialValue: string, onSubmit: (name: string) => void) => {
    setInputDialogConfig({ isOpen: true, title, placeholder: 'Enter a name', submitLabel: 'Save', initialValue, onSubmit });
  };

  const handleCreateModel = () => {
    if (modelName.trim() && modelModalStudyId) {
      const id = 'model' + Date.now();
      const studyDatasets = getStudyDatasets(datasetsByStudy, modelModalStudyId);
      const lastUsedDsId = lastUsedDatasetByStudy[modelModalStudyId]
        || models.find(m => m.studyId === modelModalStudyId && m.datasetId)?.datasetId;
      const boundDataset = (lastUsedDsId && studyDatasets.find(d => d.id === lastUsedDsId))
        || (studyDatasets.length === 1 ? studyDatasets[0] : null);

      if (boundDataset?.id) {
        setStudyLastDatasetId(modelModalStudyId, boundDataset.id);
      }

      addModel({
        id,
        studyId: modelModalStudyId,
        name: modelName.trim(),
        type: modelType,
        datasetId: boundDataset?.id,
        lastModified: 'Just now'
      });
      setModelModalOpen(false);
      setActiveStudy(modelModalStudyId);
      setActiveModel(id);
      openTab({
        type: 'model',
        title: modelName.trim(),
        modelId: id,
        studyId: modelModalStudyId,
        workspaceId: activeWorkspaceId,
      });
    }
  };

  return (
    <>
      <div className="app-body">
        <AppSidebar activeNav="workspace" />

        <main className="ws-main">
          <div className="ws-inner ws-inner--workspace">
            
            <div className="ws-header animate-fade-in">
              <div className="ws-header__left">
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    className="ws-title-rename-input"
                    value={editWorkspaceTitle}
                    size={Math.max(editWorkspaceTitle.length, 1)}
                    onChange={(e) => setEditWorkspaceTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitTitleRename();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setIsEditingTitle(false);
                      }
                    }}
                    onBlur={commitTitleRename}
                  />
                ) : (
                  <h1
                    className="ws-title-editable"
                    onDoubleClick={() => {
                      if (activeWorkspace) {
                        setEditWorkspaceTitle(activeWorkspace.name);
                        setIsEditingTitle(true);
                      }
                    }}
                    onContextMenu={(e) => {
                      if (activeWorkspace) {
                        openWorkspaceContextMenu(e, activeWorkspace);
                      }
                    }}
                    title="Double-click to rename workspace, right-click for options"
                  >
                    {activeWorkspace?.name || 'Workspace'}
                  </h1>
                )}
              </div>
              <div className="ws-header__actions">
                <button className="btn-ws-primary" type="button" onClick={handleCreateStudy} title="Import or create new study">
                  <span className="material-symbols-outlined">add</span>
                  <span>Import/New Study</span>
                  <kbd className="kbd">⌘S</kbd>
                </button>
              </div>
            </div>

            <div style={{flex: '1', display: 'flex', flexDirection: 'column'}}>
              <div className="studies-header">
                <div className="studies-header__left" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {isStudySearchOpen ? (
                    <div className="inline-search-wrap">
                      <input
                        autoFocus
                        className="studies-inline-search"
                        value={studyQuery}
                        onChange={(event) => setStudyQuery(event.target.value)}
                        onBlur={() => {
                          if (!studyQuery) setIsStudySearchOpen(false);
                        }}
                        placeholder={workspaceSubTab === 'studies' ? "Filter studies…" : "Filter archive…"}
                      />
                      {studyQuery && (
                        <button
                          className="inline-search-clear"
                          type="button"
                          aria-label="Clear study search"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => setStudyQuery('')}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{workspaceSubTab === 'studies' ? 'Studies' : 'Workspace Archive'}</span>
                      <span className="study-row__count" style={{ fontSize: '10px', padding: '1px 5px' }}>
                        {displayedStudies.length}
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    style={{
                      padding: '2px',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                    title="Filter studies"
                    onClick={() => {
                      setIsStudySearchOpen((open) => !open);
                      if (isStudySearchOpen) setStudyQuery('');
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                      search
                    </span>
                  </button>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
                  {/* Inline Sort Control */}
                  <div style={{ position: 'relative' }} ref={sortMenuRef}>
                    <button
                      type="button"
                      onClick={() => setIsSortMenuOpen((prev) => !prev)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        color: isSortMenuOpen ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-xs)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        cursor: 'pointer',
                        transition: 'color 0.15s ease',
                      }}
                      title="Sort studies"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '14px', color: 'currentColor' }}>
                        sort
                      </span>
                      <span>
                        {sortField === 'name' ? 'Name' : sortField === 'created' ? 'Date Created' : 'Date Modified'}
                      </span>
                      <span className="material-symbols-outlined" style={{ fontSize: '14px', color: 'currentColor' }}>
                        {sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                      </span>
                    </button>

                    {isSortMenuOpen && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 8px)',
                          right: 0,
                          zIndex: 1000,
                          backgroundColor: 'var(--color-bg-base)',
                          border: '1px solid var(--color-border-subtle)',
                          borderRadius: 'var(--radius-md, 6px)',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.05)',
                          minWidth: '160px',
                          padding: '4px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                        }}
                      >
                        {[
                          { field: 'modified' as const, label: 'Date Modified' },
                          { field: 'created' as const, label: 'Date Created' },
                          { field: 'name' as const, label: 'Name' },
                        ].map((opt) => {
                          const isSelected = sortField === opt.field;
                          return (
                            <button
                              key={opt.field}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
                                } else {
                                  setSortField(opt.field);
                                  setSortOrder(opt.field === 'name' ? 'asc' : 'desc');
                                }
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '6px 8px',
                                borderRadius: 'var(--radius-sm, 4px)',
                                border: 'none',
                                background: isSelected ? 'var(--color-accent-subtle)' : 'transparent',
                                color: isSelected ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: 'var(--text-xs)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                cursor: 'pointer',
                                textAlign: 'left',
                                width: '100%',
                                transition: 'background-color 0.15s ease, color 0.15s ease',
                              }}
                            >
                              <span>{opt.label}</span>
                              {isSelected && (
                                <span className="material-symbols-outlined" style={{ fontSize: '13px', color: 'var(--color-accent)' }}>
                                  {sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                </div>
              </div>

              <div className="studies-list" id="studies-container">
                {sortedStudies.length === 0 && (
                  <div className="empty-state animate-fade-in" style={{ padding: '32px 16px', textAlign: 'center' }}>
                    <div style={{fontSize: 'var(--text-md)', color: studyQuery ? 'var(--color-danger)' : 'var(--color-text-secondary)'}}>
                      {studyQuery ? 'No studies found' : (workspaceSubTab === 'archive' ? 'No archived studies in this workspace.' : 'Create a new study to get started.')}
                    </div>
                  </div>
                )}
                
                {sortedStudies.map(study => {
                  const studyModels = models.filter(m => m.studyId === study.id);
                  const studyDatasets = getStudyDatasets(datasetsByStudy, study.id);
                  const studySnapshots = (study.path ? snapshotsByStudy[study.path] : null) || snapshotsByStudy[study.id] || [];
                  const totalItems = studyModels.length + studyDatasets.length + studySnapshots.length;
                  const isEmpty = totalItems === 0;
                  const isExpanded = expandedStudies.has(study.id);
                  
                  return (
                    <div key={study.id} className={`study-entry ${study.isArchived ? 'archive-entry' : ''}`}>
                          <div 
                            key={study.id} 
                            className={`study-row ${study.isPinned ? 'study-row--pinned' : ''}`}
                            onClick={(e) => toggleStudy(study.id, e)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (study.isArchived) {
                                useStore.getState().openContextMenu(e.clientX, e.clientY, [
                                  {
                                    id: 'restore-study',
                                    label: 'Restore Study',
                                    icon: 'unarchive',
                                    action: () => restoreStudy(study.id),
                                  },
                                  {
                                    id: 'export-project',
                                    label: 'Export Project…',
                                    icon: 'archive',
                                    action: () => handleExportProject(study),
                                  },
                                  {
                                    id: 'delete-permanent',
                                    label: 'Delete Permanently',
                                    icon: 'delete',
                                    danger: true,
                                    action: () => {
                                      requestDelete({
                                        title: 'Delete Archived Study',
                                        itemName: study.name,
                                        message: 'Are you sure? This archived study and all its models and datasets will be permanently deleted and cannot be recovered.',
                                        onConfirm: () => deleteStudy(study.id),
                                      });
                                    }
                                  }
                                ]);
                                return;
                              }
                              useStore.getState().openContextMenu(e.clientX, e.clientY, [
                                {
                                  id: 'pin-study',
                                  label: study.isPinned ? 'Unpin Study' : 'Pin Study to Top',
                                  icon: 'push_pin',
                                  action: () => togglePinStudy(study.id),
                                },
                                {
                                  id: 'create-model',
                                  label: 'Create Model',
                                  icon: 'add',
                                  action: () => { setModelModalStudyId(study.id); setModelName(''); setModelType('PLS-SEM'); setModelModalOpen(true); },
                                },
                                {
                                  id: 'new-study',
                                  label: 'New Study',
                                  icon: 'create_new_folder',
                                  action: () => handleCreateStudy(),
                                },
                                { id: 'import-dataset', label: 'Import Dataset', icon: 'upload_file', action: () => { setImportingStudyId(study.id); fileInputRef.current?.click(); } },
                                { 
                                  id: 'rename', 
                                  label: 'Rename Study', 
                                  icon: 'edit', 
                                  action: () => {
                                    setEditingStudyId(study.id);
                                    setEditStudyName(study.name);
                                  } 
                                },
                                { id: 'duplicate', label: 'Duplicate Study', icon: 'content_copy', action: () => duplicateStudy(study.id) },
                                {
                                  id: 'archive-study',
                                  label: 'Archive Study',
                                  icon: 'inventory_2',
                                  action: () => archiveStudy(study.id),
                                },
                                {
                                  id: 'move-study',
                                  label: 'Move to Workspace…',
                                  icon: 'drive_file_move',
                                  action: () => setWorkspaceDropdownConfig({ isOpen: true, mode: 'move', study, position: { x: e.clientX, y: e.clientY } }),
                                },
                                {
                                  id: 'copy-study',
                                  label: 'Copy to Workspace…',
                                  icon: 'file_copy',
                                  action: () => setWorkspaceDropdownConfig({ isOpen: true, mode: 'copy', study, position: { x: e.clientX, y: e.clientY } }),
                                },
                                {
                                  id: 'export-project',
                                  label: 'Export Project…',
                                  icon: 'archive',
                                  action: () => handleExportProject(study),
                                },
                                {
                                  id: 'delete', 
                                  label: 'Delete Study', 
                                  icon: 'delete', 
                                  danger: true, 
                                  action: () => {
                                    requestDelete({
                                      title: 'Delete Study',
                                      itemName: study.name,
                                      message: 'Are you sure? This study and all its models and datasets will be permanently deleted and cannot be recovered.',
                                      onConfirm: () => deleteStudy(study.id),
                                    });
                                  } 
                                }
                              ]);
                            }}
                          >
                        <div className="study-row__left">
                          <span 
                            className="material-symbols-outlined study-folder" 
                            style={isEmpty ? {color: 'var(--color-text-hint)', fontVariationSettings: "'FILL' 0"} : {}}
                          >
                            {study.isArchived ? 'inventory_2' : (isExpanded && !isEmpty ? 'folder_open' : 'folder')}
                          </span>
                          {editingStudyId === study.id ? (
                            <input
                              autoFocus
                              type="text"
                              className="inline-seamless-rename-input"
                              value={editStudyName}
                              size={Math.max(editStudyName.length, 1)}
                              onChange={(e) => setEditStudyName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitStudyRename(study.id);
                                else if (e.key === 'Escape') setEditingStudyId(null);
                              }}
                              onBlur={() => commitStudyRename(study.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span 
                              className="study-row__name" 
                              style={isEmpty ? {color: 'var(--color-text-secondary)', fontWeight: 400} : {}}
                            >
                              {study.name}
                            </span>
                          )}
                          {!study.isArchived && (
                            <span className="study-row__count">
                              {isEmpty ? 'Empty' : `${totalItems} item${totalItems === 1 ? '' : 's'}`}
                            </span>
                          )}
                          {!study.isArchived && isEmpty && (
                            <div className="study-row__actions" onClick={(e) => e.stopPropagation()}>
                              <button className="study-action-btn" type="button" onClick={(e) => { e.stopPropagation(); setImportingStudyId(study.id); fileInputRef.current?.click(); }}>
                                <span className="material-symbols-outlined">upload_file</span>
                                <span>Import Dataset</span>
                              </button>
                              <button className="study-action-btn" type="button" onClick={(e) => openModelModal(study.id, e)}>
                                <span className="material-symbols-outlined">add</span>
                                <span>Create Model</span>
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="study-row__meta" style={study.isArchived ? { gap: '8px', alignItems: 'center' } : undefined}>
                          {study.isArchived ? (
                            <>
                              <span
                                className="file-row__time"
                                style={{
                                  fontSize: '11.5px',
                                  color: 'var(--color-text-muted)',
                                  marginRight: '2px',
                                  cursor: 'default',
                                }}
                                title={formatFullDate(study.archivedAt)}
                              >
                                {formatDisplayDate(study.archivedAt)}
                              </span>
                              <button 
                                className="archive-restore-btn" 
                                type="button" 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  restoreStudy(study.id); 
                                }}
                              >
                                Restore
                              </button>
                              <span className="study-row__chevron" style={{ marginLeft: '-2px' }}>
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  style={{
                                    width: 14,
                                    height: 14,
                                    transform: isExpanded ? 'rotate(180deg)' : 'none',
                                    transition: 'transform var(--transition-fast)',
                                    color: 'var(--color-text-muted)'
                                  }}
                                >
                                  <polyline points="6 9 12 15 18 9" />
                                </svg>
                              </span>
                            </>
                          ) : (
                            <>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <button
                                  type="button"
                                  className="study-pin-btn"
                                  title="Archive study"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    archiveStudy(study.id);
                                  }}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>inventory_2</span>
                                </button>
                                <button
                                  type="button"
                                  className={`study-pin-btn ${study.isPinned ? 'active' : ''}`}
                                  title={study.isPinned ? 'Unpin study' : 'Pin study to top'}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    togglePinStudy(study.id);
                                  }}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>push_pin</span>
                                </button>
                              </span>
                              <span className="study-row__time">{study.lastModified}</span>
                              <span className="study-row__chevron">
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  style={{
                                    width: 14,
                                    height: 14,
                                    transform: isExpanded && !isEmpty ? 'rotate(90deg)' : 'none',
                                    transition: 'transform var(--transition-fast)',
                                    color: 'var(--color-text-muted)'
                                  }}
                                >
                                  <polyline points="9 18 15 12 9 6" />
                                </svg>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      
                      <div className={`study-children ${study.isArchived ? 'archive-children' : ''} ${!isExpanded ? 'hidden' : ''}`} id={`study-children-${study.id}`}>
                        {study.isArchived ? (
                          isEmpty ? (
                            <div className="archive-empty">No datasets or models in this study.</div>
                          ) : (
                            <>
                              {studyDatasets.map((ds) => (
                                <div className="file-row archive-readonly" key={ds.id || ds.filename}>
                                  <div className="file-row__left">
                                    <span className="material-symbols-outlined">dataset</span>
                                    <span>{ds.filename}</span>
                                    <span className="file-badge file-badge--default">
                                      {ds.rows?.length ?? 0} rows
                                    </span>
                                  </div>
                                </div>
                              ))}
                              {studyModels.map((model) => (
                                <div className="file-row archive-readonly" key={model.id}>
                                  <div className="file-row__left">
                                    <span className="material-symbols-outlined">account_tree</span>
                                    <span>{model.name}</span>
                                    <span className="file-badge file-badge--model-tag">
                                      {formatModelType(model.type)}
                                    </span>
                                  </div>
                                  <div className="file-row__meta">
                                    <span className="file-row__time">{model.lastModified}</span>
                                  </div>
                                </div>
                              ))}
                            </>
                          )
                        ) : isEmpty ? (
                          <div style={{padding: '10px 16px', marginLeft: '26px'}}>
                            <div style={{color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', fontStyle: 'italic'}}>
                              No files yet.
                            </div>
                          </div>
                        ) : (
                          <>
                            {studyDatasets.map((studyDataset) => {
                              const dsKey = `${study.id}:${studyDataset.id || studyDataset.filename}`;
                              return (
                                <div
                                  key={studyDataset.id || studyDataset.filename}
                                  className="file-row file-row--muted"
                                  onClick={() => {
                                    setActiveStudy(study.id);
                                    openTab({
                                      type: 'dataset',
                                      title: studyDataset.filename,
                                      studyId: study.id,
                                      datasetId: studyDataset.id,
                                      workspaceId: activeWorkspaceId,
                                    });
                                  }}
                                  onContextMenu={e => {
                                    e.preventDefault();
                                    e.stopPropagation();

                                    useStore.getState().openContextMenu(
                                      e.clientX,
                                      e.clientY,
                                      [
                                        {
                                          id: 'open-tab',
                                          label: 'Open in Tab',
                                          icon: 'tab',
                                          action: () => {
                                            setActiveStudy(study.id);
                                            openTab({
                                              type: 'dataset',
                                              title: studyDataset.filename,
                                              studyId: study.id,
                                              datasetId: studyDataset.id,
                                              workspaceId: activeWorkspaceId,
                                            });
                                          }
                                        },
                                        {
                                          id: 'quick-edit',
                                          label: 'Edit Settings...',
                                          icon: 'tune',
                                          action: () => {
                                            setActiveStudy(study.id);
                                            openTab({
                                              type: 'dataset',
                                              title: studyDataset.filename,
                                              studyId: study.id,
                                              datasetId: studyDataset.id,
                                              workspaceId: activeWorkspaceId,
                                            });
                                          }
                                        },
                                        {
                                          id: 'rename',
                                          label: 'Rename Dataset',
                                          icon: 'edit',
                                          action: () => {
                                            setEditingDatasetKey(dsKey);
                                            setEditDatasetName(studyDataset.filename);
                                          }
                                        },
                                        {
                                          id: 'delete',
                                          label: 'Delete Dataset',
                                          icon: 'delete',
                                          danger: true,
                                          action: () => {
                                            requestDelete({
                                              title: 'Delete Dataset',
                                              itemName: studyDataset.filename,
                                              message:
                                                'Are you sure? This dataset will be permanently deleted and cannot be recovered.',
                                              onConfirm: () => {
                                                deleteDataset(study.id, studyDataset.id);
                                                touchStudy(study.id);

                                                if (study.path) {
                                                  api.deleteProjectData(study.path, studyDataset.id).catch(console.warn);
                                                }
                                              }
                                            });
                                          }
                                        }
                                      ]
                                    );
                                  }}
                                >
                                  <div className="file-row__left">
                                    <span className="material-symbols-outlined">dataset</span>
                                    {editingDatasetKey === dsKey ? (
                                      <input
                                        autoFocus
                                        type="text"
                                        className="inline-seamless-rename-input"
                                        value={editDatasetName}
                                        size={Math.max(editDatasetName.length, 1)}
                                        onChange={(e) => setEditDatasetName(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') commitDatasetRename(study.id, studyDataset);
                                          else if (e.key === 'Escape') setEditingDatasetKey(null);
                                        }}
                                        onBlur={() => commitDatasetRename(study.id, studyDataset)}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    ) : (
                                      <span>{studyDataset.filename}</span>
                                    )}
                                    <span className="file-badge file-badge--default">{studyDataset.rows.length} rows</span>
                                    <span className="file-badge file-badge--default">Dataset</span>
                                  </div>
                                  <div className="file-row__meta"><span className="file-row__time">{study.lastModified}</span><span style={{width: '16px'}}></span></div>
                                </div>
                              );
                            })}
                            {studyModels.map(model => (
                              <div key={model.id} className="file-row" onClick={() => {
                                setActiveStudy(study.id);
                                setActiveModel(model.id);
                                openTab({
                                  type: 'model',
                                  title: model.name,
                                  modelId: model.id,
                                  studyId: study.id,
                                  workspaceId: activeWorkspaceId,
                                });
                              }} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); useStore.getState().openContextMenu(e.clientX, e.clientY, [{ id: 'rename', label: 'Rename Model', icon: 'edit', action: () => { setEditingModelId(model.id); setEditModelName(model.name); } }, { id: 'duplicate', label: 'Duplicate Model', icon: 'content_copy', action: () => duplicateModel(model.id) }, { id: 'delete', label: 'Delete Model', icon: 'delete', danger: true, action: () => { requestDelete({ title: 'Delete Model', itemName: model.name, message: 'Are you sure? This model will be permanently deleted and cannot be recovered.', onConfirm: () => deleteModel(model.id) }); } }]); }}>
                                <div className="file-row__left">
                                  <span className="material-symbols-outlined">{model.type === 'Dataset' ? 'dataset' : 'account_tree'}</span>
                                  {editingModelId === model.id ? (
                                    <input
                                      autoFocus
                                      type="text"
                                      className="inline-seamless-rename-input"
                                      value={editModelName}
                                      size={Math.max(editModelName.length, 1)}
                                      onChange={(e) => setEditModelName(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') commitModelRename(model.id);
                                        else if (e.key === 'Escape') setEditingModelId(null);
                                      }}
                                      onBlur={() => commitModelRename(model.id)}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  ) : (
                                    <span>{model.name}</span>
                                  )}
                                  <span className="file-badge file-badge--model-tag">{formatModelType(model.type)}</span>
                                </div>
                                <div className="file-row__meta">
                                  <span className="file-row__time">{model.lastModified}</span>
                                  <span style={{width: '16px'}}></span>
                                </div>
                              </div>
                            ))}
                            {studySnapshots.map(snapshot => (
                              <div
                                key={snapshot.id}
                                className="file-row"
                                onClick={() => {
                                  setActiveStudy(study.id);
                                  openTab({
                                    type: 'snapshot',
                                    title: snapshot.name,
                                    snapshotId: snapshot.id,
                                    studyId: study.id,
                                    workspaceId: activeWorkspaceId,
                                  });
                                }}
                                onContextMenu={e => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  useStore.getState().openContextMenu(e.clientX, e.clientY, [
                                    {
                                      id: 'open-snapshot',
                                      label: 'Open Snapshot',
                                      icon: 'visibility',
                                      action: () => {
                                        setActiveStudy(study.id);
                                        openTab({
                                          type: 'snapshot',
                                          title: snapshot.name,
                                          snapshotId: snapshot.id,
                                          studyId: study.id,
                                          workspaceId: activeWorkspaceId,
                                        });
                                      }
                                    },
                                    {
                                      id: 'delete-snapshot',
                                      label: 'Delete Snapshot',
                                      icon: 'delete',
                                      danger: true,
                                      action: () => {
                                        requestDelete({
                                          title: 'Delete Snapshot',
                                          itemName: snapshot.name,
                                          message: 'Are you sure? This snapshot will be permanently deleted.',
                                          onConfirm: async () => {
                                            if (study.path) {
                                              await api.deleteSnapshot(study.path, snapshot.id);
                                              removeStudySnapshot(study.path, snapshot.id);
                                              if (study.id) removeStudySnapshot(study.id, snapshot.id);
                                            }
                                          }
                                        });
                                      }
                                    }
                                  ]);
                                }}
                              >
                                <div className="file-row__left">
                                  <span className="material-symbols-outlined" style={{ color: 'var(--color-accent)' }}>history</span>
                                  <span>{snapshot.name}</span>
                                  <span className="file-badge file-badge--accent" style={{ fontSize: '10px' }}>Snapshot</span>
                                </div>
                                <div className="file-row__meta">
                                  <span className="file-row__time">{new Date(snapshot.created_at).toLocaleDateString()}</span>
                                  <span style={{ width: '16px' }}></span>
                                </div>
                              </div>
                            ))}
                            <div style={{display: 'flex', gap: '8px', margin: '8px 0 8px 26px', alignItems: 'center'}}>
                              <button className="study-action-btn" type="button" onClick={(e) => { e.stopPropagation(); setImportingStudyId(study.id); fileInputRef.current?.click(); }}>
                                <span className="material-symbols-outlined">upload_file</span>
                                <span>Import Dataset</span>
                              </button>
                              <button className="study-action-btn" type="button" onClick={(e) => openModelModal(study.id, e)}>
                                <span className="material-symbols-outlined">add</span>
                                <span>Create Model</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="workspace-bottom-tabs">
                <button
                  type="button"
                  className={`workspace-bottom-tab ${workspaceSubTab === 'studies' ? 'active' : ''}`}
                  onClick={() => setWorkspaceSubTab('studies')}
                >
                  <span className="material-symbols-outlined">folder</span>
                  <span>Studies</span>
                  <span className="workspace-bottom-tab__count">{activeStudies.length}</span>
                </button>
                <button
                  type="button"
                  className={`workspace-bottom-tab ${workspaceSubTab === 'archive' ? 'active' : ''}`}
                  onClick={() => setWorkspaceSubTab('archive')}
                >
                  <span className="material-symbols-outlined">inventory_2</span>
                  <span>Archive</span>
                  {archivedStudies.length > 0 && (
                    <span className="workspace-bottom-tab__count">{archivedStudies.length}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        style={{ display: 'none' }} 
        accept=".csv,.xlsx,.xls,.sav"
      />

      <WorkspaceModal isOpen={isWorkspaceModalOpen} onClose={() => setIsWorkspaceModalOpen(false)} />
      <StudyModal 
        isOpen={isStudyModalOpen} 
        onClose={() => setIsStudyModalOpen(false)} 
        workspaceId={activeWorkspaceId || ''} 
      />
      <StudyWorkspaceDropdown
        isOpen={workspaceDropdownConfig.isOpen}
        onClose={() => setWorkspaceDropdownConfig((prev) => ({ ...prev, isOpen: false }))}
        mode={workspaceDropdownConfig.mode}
        study={workspaceDropdownConfig.study}
        position={workspaceDropdownConfig.position}
      />
      <InputDialog 
        isOpen={inputDialogConfig.isOpen} 
        onClose={() => setInputDialogConfig(prev => ({...prev, isOpen: false}))}
        title={inputDialogConfig.title}
        placeholder={inputDialogConfig.placeholder}
        submitLabel={inputDialogConfig.submitLabel}
        initialValue={inputDialogConfig.initialValue}
        onSubmit={inputDialogConfig.onSubmit}
      />

      {isModelModalOpen && (
      <div className="modal-overlay active" id="modal-model-overlay" style={{display: 'flex'}}>
        <div className="modal">
          <div className="modal__header">
            <div className="modal__title">Create New Model</div>
            <button className="icon-btn icon-btn--sm" onClick={() => setModelModalOpen(false)} type="button">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <div className="modal__body">
            <div className="modal__field">
              <label className="modal__label" htmlFor="modal-model-study">Study</label>
              <div style={{display: 'flex', gap: '8px'}}>
                <select className="modal__input" id="modal-model-study" style={{flex: '1', cursor: 'pointer'}} value={modelModalStudyId} onChange={(e) => setModelModalStudyId(e.target.value)}>
                  {activeStudies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="modal__field">
              <label className="modal__label" htmlFor="modal-model-name">Model Name</label>
              <input className="modal__input" id="modal-model-name" value={modelName} onChange={e => setModelName(e.target.value)} type="text" placeholder="e.g., Structural Model" autoComplete="off" spellCheck="false" autoFocus />
            </div>
            <div className="modal__field">
              <label className="modal__label">Model Type</label>
              <div
                className="subheader__switcher"
                style={{
                  display: 'flex',
                  width: '100%',
                  padding: '3px',
                  borderRadius: 'var(--radius-md, 6px)',
                  background: 'var(--color-bg-raised, rgba(0, 0, 0, 0.04))',
                  border: '1px solid var(--color-border-subtle)',
                  boxSizing: 'border-box',
                  gap: '4px'
                }}
              >
                <button
                  type="button"
                  className="subheader__switcher-btn active"
                  style={{
                    flex: 1,
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    background: 'var(--color-bg-base)',
                    color: 'var(--color-accent, #6B4EE6)',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
                    cursor: 'default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span>PLS-SEM</span>
                </button>
                <button
                  type="button"
                  disabled
                  className="subheader__switcher-btn"
                  style={{
                    flex: 1,
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: '4px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-text-muted)',
                    opacity: 0.45,
                    cursor: 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="CB-SEM is under development"
                >
                  <span>CB-SEM</span>
                </button>
                <button
                  type="button"
                  disabled
                  className="subheader__switcher-btn"
                  style={{
                    flex: 1,
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: '4px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-text-muted)',
                    opacity: 0.45,
                    cursor: 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Regression is under development"
                >
                  <span>Regression</span>
                </button>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>info</span>
                <span>CB-SEM and Regression are under development.</span>
              </div>
            </div>
          </div>
          <div className="modal__footer">
            <button className="modal__btn-cancel" id="modal-model-cancel-btn" type="button" onClick={() => setModelModalOpen(false)}>Cancel</button>
            <button className="modal__btn-create" id="modal-model-create-btn" type="button" disabled={!modelName.trim() || !modelModalStudyId} onClick={handleCreateModel}>Create Model</button>
          </div>
        </div>
      </div>
      )}
    </>
  );
};

export default Dashboard;
