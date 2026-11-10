import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import { api } from '../utils/api';
import { processData } from '../utils/dataset-parser';

interface StudyModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId?: string;
}

const getNextUniqueStudyName = (candidateName: string, workspaceId?: string, existingStudies: Array<{ name: string; workspaceId?: string }> = []): string => {
  const clean = candidateName.trim();
  if (!clean) return '';
  const wsStudies = existingStudies.filter(s => !workspaceId || s.workspaceId === workspaceId);
  const existingNames = new Set(wsStudies.map(s => s.name.trim().toLowerCase()));

  if (!existingNames.has(clean.toLowerCase())) {
    return clean;
  }

  const match = clean.match(/^(.*?)(?:\s*\(([0-9]+)\))?$/);
  const base = match ? match[1].trim() : clean;

  let counter = 1;
  while (existingNames.has(`${base}(${counter})`.toLowerCase())) {
    counter++;
  }
  return `${base}(${counter})`;
};

const StudyModal = ({ isOpen, onClose, workspaceId }: StudyModalProps) => {
  const [name, setName] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(workspaceId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { workspaces, activeWorkspaceId, addStudy, setActiveStudy, studies } = useStore();
  const currentWorkspaceId = selectedWorkspaceId || workspaceId || activeWorkspaceId;
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setSelectedWorkspaceId(workspaceId || activeWorkspaceId || workspaces[0]?.id || '');
      setError(null);
    }
  }, [isOpen, workspaceId, activeWorkspaceId, workspaces]);

  if (!isOpen) return null;

  const cleanName = name.trim();
  const effectiveName = getNextUniqueStudyName(cleanName, currentWorkspace?.id, studies);
  const isNameCollision = Boolean(cleanName && effectiveName && effectiveName.toLowerCase() !== cleanName.toLowerCase());

  const fileName = effectiveName ? `${effectiveName.replace(/[/\\?%*:|"<>]/g, '_')}.pls` : '';
  const wsPath = currentWorkspace?.path || '';
  const separator = wsPath.includes('\\') ? '\\' : '/';
  const studyFilePath = fileName && wsPath ? `${wsPath.replace(/[/\\]+$/, '')}${separator}${fileName}` : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanName || !currentWorkspace) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const res = await api.addProject(currentWorkspace.path, effectiveName);
      if (res?.error) {
        setError(res.error);
        setIsSubmitting(false);
        return;
      }

      const finalName = res.project_name || effectiveName;
      const projectPath = res.project_path || studyFilePath;
      const newId = projectPath || 'study_' + Date.now();
      addStudy({
        id: newId,
        workspaceId: currentWorkspace.id,
        name: finalName,
        type: 'PLS-SEM',
        description: '',
        lastModified: 'Just now',
        path: projectPath
      });
      setActiveStudy(newId);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create study');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImportStudy = async (targetType: 'file' | 'folder' = 'file') => {
    if (!currentWorkspace) return;
    setError(null);
    try {
      let selectedPath: string | null = null;

      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        if (targetType === 'folder') {
          const selected = await open({
            multiple: false,
            directory: true,
            title: 'Import Study Folder',
          });
          if (selected && typeof selected === 'string') {
            selectedPath = selected;
          }
        } else {
          const selected = await open({
            multiple: false,
            directory: false,
            title: 'Import Study File (.zip, .pls)',
            filters: [
              {
                name: 'Study Archive or Project',
                extensions: ['zip', 'pls', 'splsm'],
              },
            ],
          });
          if (selected && typeof selected === 'string') {
            selectedPath = selected;
          }
        }
      } catch (pickErr) {
        console.warn('Tauri open dialog error, falling back to prompt:', pickErr);
        const fallback = window.prompt(
          targetType === 'folder'
            ? 'Enter study folder directory path:'
            : 'Enter study file path (.zip, .pls):'
        );
        if (fallback) {
          selectedPath = fallback;
        }
      }

      if (!selectedPath) return;

      setIsSubmitting(true);
      const detection = await api.detectFolder(selectedPath);
      if (detection.kind === 'error' || (!detection.valid && detection.kind !== 'cspls_project' && detection.kind !== 'smartpls_project')) {
        setError(detection.error || 'No compatible files found');
        setIsSubmitting(false);
        return;
      }

      let res: any = null;
      if (detection.kind === 'cspls_project') {
        if (selectedPath.toLowerCase().endsWith('.zip')) {
          res = await api.importProjectZip(selectedPath, currentWorkspace.path, 'rename');
        } else {
          res = await api.importProjectFile(selectedPath, currentWorkspace.path, 'rename');
        }
      } else {
        res = await api.importSmartPls(selectedPath, currentWorkspace.path, currentWorkspace.name);
      }

      if (res?.error) {
        setError(res.error);
        setIsSubmitting(false);
        return;
      }

      if (res?.studies) {
        const state = useStore.getState();
        for (const s of res.studies) {
          state.addStudy({
            ...s,
            workspaceId: currentWorkspace.id,
            type: s.type || 'PLS-SEM',
          });
          try {
            const dataRes = await api.loadProjectData(s.path);
            if (dataRes && Array.isArray(dataRes.columns) && Array.isArray(dataRes.rows)) {
              const parsed = processData(dataRes.dataset_name || s.name, dataRes.columns, dataRes.rows);
              state.setStudyDataset(s.id, parsed);
            }
          } catch (e) {
            console.warn('Could not load data for study', s.name, e);
          }
        }
        if (res.studies.length > 0) {
          state.setActiveStudy(res.studies[0].id);
        }
      }

      if (res?.models && res.models.length > 0) {
        const state = useStore.getState();
        for (const m of res.models) {
          state.addModel({
            id: m.id,
            studyId: m.studyId,
            name: m.name,
            type: m.type || 'PLS-SEM',
            lastModified: 'Just now',
          });
        }
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to import study');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay active" style={{ display: 'flex' }} onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">Import / New Study</h2>
          <button className="icon-btn icon-btn--sm" type="button" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal__body">
            {workspaces.length > 1 && (
              <div className="modal__field">
                <label className="modal__label" htmlFor="study-workspace">Workspace</label>
                <select
                  id="study-workspace"
                  className="modal__input"
                  value={currentWorkspaceId || ''}
                  onChange={e => setSelectedWorkspaceId(e.target.value)}
                >
                  {workspaces.map(ws => (
                    <option key={ws.id} value={ws.id}>{ws.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="modal__field">
              <label className="modal__label" htmlFor="study-name">Study Name</label>
              <input
                type="text"
                id="study-name"
                className="modal__input"
                placeholder="e.g. Technology Acceptance Model"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
            </div>

            {studyFilePath && (
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{studyFilePath}</span>
              </div>
            )}

            {isNameCollision && (
              <div style={{ fontSize: '11px', color: 'var(--color-accent, #3b82f6)', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>info</span>
                <span>Name exists in this workspace; will be created as <strong>{effectiveName}</strong>.</span>
              </div>
            )}

            {error && (
              <div style={{ color: 'var(--color-danger, #ef4444)', fontSize: '12px' }}>{error}</div>
            )}

            <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--color-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                Or import study
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleImportStudy('file')}
                  disabled={isSubmitting}
                  title="Import a study archive (.zip) or project file (.pls)"
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
                    transition: 'border-color 0.12s, background 0.12s',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>draft</span>
                  <span>From File (.zip, .pls)</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleImportStudy('folder')}
                  disabled={isSubmitting}
                  title="Import an unzipped study directory"
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
                    transition: 'border-color 0.12s, background 0.12s',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>folder_open</span>
                  <span>From Folder</span>
                </button>
              </div>
            </div>
          </div>
          <div className="modal__footer">
            <button className="modal__btn-cancel" type="button" onClick={onClose} disabled={isSubmitting}>Cancel</button>
            <button className="modal__btn-create" type="submit" disabled={!cleanName || !currentWorkspaceId || isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create Study'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default StudyModal;
