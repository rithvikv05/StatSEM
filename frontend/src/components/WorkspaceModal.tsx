import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { processData } from '../utils/dataset-parser';
import { promptOpenWorkspaceFolder } from '../utils/workspace-import';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialImportProject?: string | null;
  initialProjectName?: string | null;
  onClearInitialImportProject?: () => void;
}

const WorkspaceModal = ({
  isOpen,
  onClose,
  initialImportProject,
  initialProjectName,
  onClearInitialImportProject,
}: WorkspaceModalProps) => {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { workspaces, addWorkspace, setActiveWorkspace, openTab, addStudy, setStudyDataset, setActiveStudy, addModel } = useStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      if (initialProjectName) {
        setName(initialProjectName);
      } else if (initialImportProject) {
        const folderName = initialImportProject.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || '';
        setName(folderName);
      } else {
        setName('');
      }
      setLocation('');
      setError(null);
      setIsCreating(false);
    }
  }, [isOpen, initialImportProject, initialProjectName]);

  if (!isOpen) return null;

  const handleBrowse = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Workspace Location'
      });
      if (selected && typeof selected === 'string') {
        setLocation(selected);
        if (!name.trim()) {
          const folderName = selected.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop();
          if (folderName) setName(folderName);
        }
      }
    } catch (err) {
      console.warn('Tauri dialog not available, falling back to prompt:', err);
      const fallback = window.prompt('Enter workspace directory path:', location || '~/StatSEM/Workspaces');
      if (fallback) {
        setLocation(fallback);
        if (!name.trim()) {
          const folderName = fallback.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop();
          if (folderName) setName(folderName);
        }
      }
    }
  };

  const cleanName = name.trim();
  const baseLoc = location.trim() || '~/StatSEM/Workspaces';
  const cleanLoc = baseLoc.replace(/[/\\]+$/, '');
  const lastFolder = cleanLoc.split(/[/\\]/).filter(Boolean).pop();
  const calculatedPath = cleanName ? ((lastFolder === cleanName) ? cleanLoc : `${cleanLoc}/${cleanName}`) : cleanLoc;

  const handleCreateWorkspace = async () => {
    if (!cleanName) return;
    setError(null);
    setIsCreating(true);

    try {
      const res = await api.createWorkspace(calculatedPath, cleanName);

      if (res?.error) {
        if (res.error.toLowerCase().includes('already exists')) {
          await api.openWorkspace(calculatedPath);
        } else {
          console.warn('Backend createWorkspace warning:', res.error);
        }
      }
    } catch (err: any) {
      console.warn('Backend createWorkspace connection error:', err);
    }

    const newId = calculatedPath;
    const existing = workspaces.find(w => w.path === calculatedPath);

    if (!existing) {
      addWorkspace({
        id: newId,
        name: cleanName,
        path: calculatedPath
      });
    }

    const workspaceId = existing ? existing.id : newId;

    // If an initial study/project is attached, import it into the new workspace
    if (initialImportProject) {
      try {
        let importRes: any = null;
        const det = await api.detectFolder(initialImportProject);
        if (det.kind === 'cspls_project') {
          if (initialImportProject.toLowerCase().endsWith('.zip')) {
            importRes = await api.importProjectZip(initialImportProject, calculatedPath, 'rename');
          } else {
            importRes = await api.importProjectFile(initialImportProject, calculatedPath, 'rename');
          }
        } else {
          importRes = await api.importSmartPls(initialImportProject, calculatedPath, cleanName);
        }

        if (importRes?.studies && importRes.studies.length > 0) {
          for (const s of importRes.studies) {
            addStudy({
              id: s.id,
              workspaceId,
              name: s.name,
              type: s.type || 'PLS-SEM',
              description: s.description || '',
              lastModified: s.lastModified || 'Just now',
              path: s.path,
              createdAt: s.createdAt,
              isArchived: s.isArchived || false,
              archivedAt: s.archivedAt,
            });
            try {
              const dRes = await api.loadProjectData(s.path);
              if (dRes?.rows && dRes?.columns) {
                const parsed = processData(dRes.dataset_name || s.name, dRes.columns, dRes.rows);
                setStudyDataset(s.id, parsed);
              }
            } catch (e) {
              console.warn('Could not load data for study', s.name, e);
            }
          }
          if (importRes.studies.length > 0) {
            setActiveStudy(importRes.studies[0].id);
          }
        }

        if (importRes?.models && importRes.models.length > 0) {
          for (const m of importRes.models) {
            addModel({
              id: m.id,
              studyId: m.studyId,
              name: m.name,
              type: m.type || 'PLS-SEM',
              lastModified: 'Just now',
            });
          }
        }
      } catch (importErr: any) {
        console.warn('Failed to import initial study:', importErr);
      }
    }

    setActiveWorkspace(workspaceId);

    openTab({
      type: 'workspace',
      title: cleanName,
      workspaceId,
    });
    setName('');
    setLocation('');
    setError(null);
    setIsCreating(false);
    onClose();
    navigate('/workspace');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cleanName && !isCreating) {
      handleCreateWorkspace();
    }
  };

  return (
    <div 
      className="modal-overlay active" 
      id="modal-overlay" 
      style={{ display: 'flex', zIndex: 9999 }} 
      onClick={onClose}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">Create New Workspace</div>
          <button className="icon-btn icon-btn--sm" onClick={onClose} type="button">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal__body">
            {initialImportProject && (
              <div
                style={{
                  marginBottom: '14px',
                  padding: '10px 12px',
                  background: 'var(--color-bg-base)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--color-accent)' }}>
                    inventory_2
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      Will import study:
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--color-text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {initialProjectName || initialImportProject}
                    </div>
                  </div>
                </div>
                {onClearInitialImportProject && (
                  <button
                    type="button"
                    onClick={onClearInitialImportProject}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      fontSize: '11px',
                      padding: '2px 4px',
                    }}
                    title="Remove study"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            <div className="modal__field">
              <label className="modal__label" htmlFor="modal-workspace-name">Workspace Name</label>
              <input
                className="modal__input"
                id="modal-workspace-name"
                type="text"
                placeholder="e.g., Academic_Research"
                autoComplete="off"
                spellCheck="false"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="modal__field">
              <label className="modal__label" htmlFor="modal-workspace-location">
                Location
              </label>
              <div className="modal__browse-row">
                <span className="modal__browse-icon material-symbols-outlined">folder_open</span>
                <input
                  className="modal__input modal__input--path"
                  id="modal-workspace-location"
                  type="text"
                  placeholder="~/StatSEM/Workspaces"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  spellCheck="false"
                />
                <button className="modal__browse-btn" id="modal-browse-btn" type="button" onClick={handleBrowse}>
                  Browse…
                </button>
              </div>
              {cleanName && (
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '6px', wordBreak: 'break-all' }}>
                  Full Path: <span style={{ fontFamily: 'var(--font-mono)' }}>{calculatedPath}</span>
                </div>
              )}
              {error && (
                <div style={{ color: 'var(--color-danger, #ef4444)', fontSize: '12px', marginTop: '10px' }}>
                  {error}
                </div>
              )}
            </div>

            <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--color-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                Or import workspace
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    onClose();
                    await promptOpenWorkspaceFolder('zip');
                  }}
                  disabled={isCreating}
                  title="Import an exported workspace or study archive (.zip)"
                  style={{
                    padding: '6px 10px',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border-subtle)',
                    background: 'var(--color-bg-base)',
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>archive</span>
                  <span>From Archive (.zip)</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    onClose();
                    await promptOpenWorkspaceFolder('folder');
                  }}
                  disabled={isCreating}
                  title="Open an existing workspace folder"
                  style={{
                    padding: '6px 10px',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border-subtle)',
                    background: 'var(--color-bg-base)',
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>folder_open</span>
                  <span>From Folder</span>
                </button>
              </div>
            </div>
          </div>

          <div className="modal__footer">
            <button className="modal__btn-cancel" id="modal-cancel-btn" type="button" onClick={onClose} disabled={isCreating}>
              Cancel
            </button>
            <button 
              className="modal__btn-create" 
              id="modal-create-btn" 
              type="submit" 
              disabled={!name.trim() || isCreating}
            >
              {isCreating ? 'Creating…' : (initialImportProject ? 'Create & Import Study' : 'Create Workspace')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default WorkspaceModal;
