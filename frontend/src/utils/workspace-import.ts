import { api } from './api';
import { useStore } from '../store';
import { processData } from './dataset-parser';

type CreateWorkspaceWithProjectListener = (projectPath: string, projectName?: string) => void;
let createWsWithProjectListener: CreateWorkspaceWithProjectListener | null = null;

export function registerCreateWorkspaceWithProject(listener: CreateWorkspaceWithProjectListener) {
  createWsWithProjectListener = listener;
  return () => {
    if (createWsWithProjectListener === listener) {
      createWsWithProjectListener = null;
    }
  };
}

/**
 * Directly opens the native directory or archive selector to import or open a workspace.
 * - StatSEM Workspace Zip: Extracted, imported and opened immediately.
 * - StatSEM Workspace Folder: Opened immediately.
 * - SmartPLS Workspace: Imported and opened immediately.
 * - Project File / Archive: Prompts the Create New Workspace modal with that project attached.
 */
export async function promptOpenWorkspaceFolder(targetType: 'folder' | 'zip' = 'folder'): Promise<void> {
  let selectedPath: string | null = null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    if (targetType === 'zip') {
      const selected = await open({
        directory: false,
        multiple: false,
        title: 'Import Workspace or Project Archive (.zip)',
        filters: [{ name: 'Workspace or Project Archive', extensions: ['zip'] }],
      });
      if (selected && typeof selected === 'string') {
        selectedPath = selected;
      }
    } else {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Import / Open Workspace Folder',
      });
      if (selected && typeof selected === 'string') {
        selectedPath = selected;
      }
    }
  } catch (err) {
    console.warn('Tauri dialog not available, falling back to prompt:', err);
    const fallback = window.prompt(
      targetType === 'zip'
        ? 'Enter path to workspace or project .zip archive:'
        : 'Enter folder path to import / open workspace:'
    );
    if (fallback) {
      selectedPath = fallback;
    }
  }

  if (!selectedPath) return;

  try {
    const detection = await api.detectFolder(selectedPath);

    // 1. Exported StatSEM Workspace Zip Archive
    if (detection.kind === 'cspls_workspace_zip') {
      const res = await api.importWorkspaceZip(selectedPath);
      if (res?.error) {
        alert(`Failed to import workspace archive: ${res.error}`);
        return;
      }
      const ws = res.workspace;
      const wsPath = ws?.path || res.path || selectedPath;
      const wsName = ws?.name || detection.name || 'Workspace';
      const state = useStore.getState();
      const existing = state.workspaces.find(w => w.path === wsPath);
      if (!existing) {
        state.addWorkspace({
          id: wsPath,
          name: wsName,
          path: wsPath,
        });
      }
      if (res.studies && res.studies.length > 0) {
        for (const s of res.studies) {
          state.addStudy({
            id: s.id,
            workspaceId: wsPath,
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
              state.setStudyDataset(s.id, parsed);
            }
          } catch (e) {
            console.warn('Could not load data for study', s.name, e);
          }
        }
        state.setActiveStudy(res.studies[0].id);
      }
      if (res.models && res.models.length > 0) {
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
      state.setActiveWorkspace(wsPath);
      state.openTab({
        type: 'workspace',
        title: wsName,
        workspaceId: wsPath,
      });
      return;
    }

    // 2. Existing StatSEM Workspace Folder
    if (detection.kind === 'cspls_workspace') {
      const res = await api.openWorkspace(selectedPath);
      if (res?.error) {
        alert(`Failed to open workspace: ${res.error}`);
        return;
      }
      const wsName = detection.name || selectedPath.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || 'Workspace';
      const state = useStore.getState();
      const existing = state.workspaces.find(w => w.path === selectedPath);
      if (!existing) {
        state.addWorkspace({
          id: selectedPath,
          name: wsName,
          path: selectedPath,
        });
      }
      state.setActiveWorkspace(selectedPath);
      state.openTab({
        type: 'workspace',
        title: wsName,
        workspaceId: selectedPath,
      });
      return;
    }

    // 3. SmartPLS Workspace Folder
    if (detection.kind === 'smartpls_workspace') {
      const res = await api.importSmartPlsWorkspace(selectedPath);
      if (res?.error) {
        alert(`Failed to import workspace: ${res.error}`);
        return;
      }
      const wsName = res.workspace?.name || detection.name || 'Workspace';
      const state = useStore.getState();
      const existing = state.workspaces.find(w => w.path === selectedPath);
      if (!existing) {
        state.addWorkspace({
          id: selectedPath,
          name: wsName,
          path: selectedPath,
        });
      }
      if (res.studies && res.studies.length > 0) {
        for (const s of res.studies) {
          state.addStudy({
            id: s.id,
            workspaceId: selectedPath,
            name: s.name,
            type: s.type || 'PLS-SEM',
            description: s.description || '',
            lastModified: 'Just now',
            path: s.path,
            createdAt: s.createdAt,
          });
          try {
            const dRes = await api.loadProjectData(s.path);
            if (dRes?.rows && dRes?.columns) {
              const parsed = processData(dRes.dataset_name || s.name, dRes.columns, dRes.rows);
              state.setStudyDataset(s.id, parsed);
            }
          } catch (e) {
            console.warn('Could not load data for study', s.name, e);
          }
        }
        state.setActiveStudy(res.studies[0].id);
      }
      if (res.models && res.models.length > 0) {
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
      state.setActiveWorkspace(selectedPath);
      state.openTab({
        type: 'workspace',
        title: wsName,
        workspaceId: selectedPath,
      });
      return;
    }

    // 4. Project Archive (.zip) or Project Folder (.pls or .splsm)
    if (detection.kind === 'smartpls_project' || detection.kind === 'cspls_project') {
      if (createWsWithProjectListener) {
        createWsWithProjectListener(selectedPath, detection.project_name);
      } else {
        alert(`Selected file "${detection.project_name || selectedPath}" is a study project. Please create or open a workspace first.`);
      }
      return;
    }

    // 5. Default / unknown directory -> prompt Create Workspace dialog with this path
    if (createWsWithProjectListener && !selectedPath.endsWith('.zip')) {
      createWsWithProjectListener('', selectedPath.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop());
    } else {
      alert(detection.error || 'No compatible files found');
    }
  } catch (err: any) {
    console.error('Error opening/importing workspace:', err);
    alert(`Could not open or import workspace: ${err?.message || err}`);
  }
}

