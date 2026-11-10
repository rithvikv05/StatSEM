import { getCachedTokenString } from './license';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_DECIMAL_DIGITS, normalizeDecimalDigits } from './number-format';

// Tauri supplies the port chosen by the Rust sidecar. Browser-only development
// can still use a manually started backend on the historical development port.
let API_BASE = 'http://127.0.0.1:8721';

export async function initializeBackend(): Promise<void> {
  if ('__TAURI_INTERNALS__' in window) {
    API_BASE = await invoke<string>('backend_url');
  }
}

export function backendUrl(): string {
  return API_BASE;
}

const nativeFetch = window.fetch.bind(window);

async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  try {
    const token = await getCachedTokenString();
    if (token && !headers.has('X-License-Token')) {
      headers.set('X-License-Token', token);
    }
  } catch {
    // Ignore in case Tauri invoke fails or in browser environment
  }
  return nativeFetch(input, { ...init, headers });
}

export interface WorkspaceMetadata {
  name: string;
  created_at: string;
  modified_at: string;
  projects: Array<{ path: string; name: string }>;
  archived_projects?: Array<{ path: string; name: string; archived_at?: string }>;
}

export interface WorkspaceResponse {
  status?: string;
  path?: string;
  workspace?: WorkspaceMetadata;
  error?: string;
}

export interface RecentWorkspace {
  path: string;
  name: string;
  modified_at: string;
  workspace_count: number;
}

export interface ProjectResponse {
  status?: string;
  project_path?: string;
  project_name?: string;
  workspace?: WorkspaceMetadata;
  error?: string;
}

export interface ConstructSpec {
  id: string;
  name: string;
  type: 'reflective' | 'formative';
  indicators: string[];
}

export interface IndicatorSpec {
  id: string;
  column: string;
}

export interface PathSpec {
  from: string;
  to: string;
}

export interface ModelSpec {
  constructs: ConstructSpec[];
  indicators: IndicatorSpec[];
  paths: PathSpec[];
  dataset_id?: string;
  [key: string]: any;
}

export interface ValidationResponse {
  is_valid: boolean;
  errors: string[];
  warnings: string[];
  exogenous_constructs: string[];
  endogenous_constructs: string[];
  isolated_constructs: string[];
  error?: string;
}

export interface SaveModelResponse {
  status?: string;
  validation?: ValidationResponse;
  error?: string;
}

export interface LoadModelResponse {
  spec?: ModelSpec | null;
  diagram_layout?: any | null;
  updated_at?: string | null;
  error?: string;
}

export const api = {
  async getHealth(): Promise<{ status?: string; backend?: string; home_dir?: string | null } | null> {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  async createWorkspace(folderPath: string, name: string): Promise<WorkspaceResponse> {
    try {
      const res = await fetch(
        `${API_BASE}/workspace/create?folder_path=${encodeURIComponent(folderPath)}&name=${encodeURIComponent(name)}`,
        { method: 'POST' }
      );
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to connect to backend server' };
    }
  },

  async openWorkspace(folderPath: string): Promise<WorkspaceResponse> {
    try {
      const res = await fetch(
        `${API_BASE}/workspace/open?folder_path=${encodeURIComponent(folderPath)}`,
        { method: 'POST' }
      );
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to connect to backend server' };
    }
  },

  async getRecentWorkspaces(): Promise<RecentWorkspace[]> {
    try {
      const res = await fetch(`${API_BASE}/workspace/recent`);
      return await res.json();
    } catch {
      return [];
    }
  },

  async deleteWorkspace(folderPath: string): Promise<{ status?: string; error?: string }> {
    try {
      const res = await fetch(
        `${API_BASE}/workspace/delete?folder_path=${encodeURIComponent(folderPath)}`,
        { method: 'POST' }
      );
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to delete workspace' };
    }
  },

  async addProject(folderPath: string, projectName: string): Promise<ProjectResponse> {
    try {
      const res = await fetch(
        `${API_BASE}/workspace/add-project?folder_path=${encodeURIComponent(folderPath)}&project_name=${encodeURIComponent(projectName)}`,
        { method: 'POST' }
      );
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to connect to backend server' };
    }
  },

  async removeProject(folderPath: string, projectFilename: string): Promise<{ status?: string; workspace?: WorkspaceMetadata; error?: string }> {
    try {
      const res = await fetch(
        `${API_BASE}/workspace/remove-project?folder_path=${encodeURIComponent(folderPath)}&project_filename=${encodeURIComponent(projectFilename)}`,
        { method: 'POST' }
      );
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to remove project from workspace' };
    }
  },

  async deleteProject(folderPath: string, projectFilename: string): Promise<{ status?: string; workspace?: WorkspaceMetadata; error?: string }> {
    try {
      const res = await fetch(
        `${API_BASE}/workspace/delete-project?folder_path=${encodeURIComponent(folderPath)}&project_filename=${encodeURIComponent(projectFilename)}`,
        { method: 'POST' }
      );
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to delete project' };
    }
  },

  async archiveProject(folderPath: string, projectFilename: string): Promise<{ status?: string; workspace?: WorkspaceMetadata; new_path?: string; error?: string }> {
    try {
      const res = await fetch(
        `${API_BASE}/workspace/archive-project?folder_path=${encodeURIComponent(folderPath)}&project_filename=${encodeURIComponent(projectFilename)}`,
        { method: 'POST' }
      );
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to archive project' };
    }
  },

  async restoreProject(folderPath: string, projectFilename: string): Promise<{ status?: string; workspace?: WorkspaceMetadata; new_path?: string; error?: string }> {
    try {
      const res = await fetch(
        `${API_BASE}/workspace/restore-project?folder_path=${encodeURIComponent(folderPath)}&project_filename=${encodeURIComponent(projectFilename)}`,
        { method: 'POST' }
      );
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to restore project' };
    }
  },

  async deleteArchivedProject(folderPath: string, projectFilename: string): Promise<{ status?: string; workspace?: WorkspaceMetadata; error?: string }> {
    try {
      const res = await fetch(
        `${API_BASE}/workspace/delete-archived-project?folder_path=${encodeURIComponent(folderPath)}&project_filename=${encodeURIComponent(projectFilename)}`,
        { method: 'POST' }
      );
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to delete archived project' };
    }
  },

  async archiveWorkspace(folderPath: string): Promise<{ status?: string; old_path?: string; new_path?: string; name?: string; error?: string }> {
    try {
      const res = await fetch(
        `${API_BASE}/workspace/archive?folder_path=${encodeURIComponent(folderPath)}`,
        { method: 'POST' }
      );
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to archive workspace' };
    }
  },

  async restoreWorkspace(folderPath: string): Promise<{ status?: string; old_path?: string; new_path?: string; name?: string; error?: string }> {
    try {
      const res = await fetch(
        `${API_BASE}/workspace/restore?folder_path=${encodeURIComponent(folderPath)}`,
        { method: 'POST' }
      );
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to restore workspace' };
    }
  },

  async listArchivedWorkspaces(): Promise<{ status?: string; workspaces: Array<{ id: string; path: string; name: string; original_path?: string; archived_at?: string; project_count?: number }>; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/workspace/archived-list`);
      return await res.json();
    } catch (err: any) {
      return { workspaces: [], error: err?.message || 'Failed to list archived workspaces' };
    }
  },

  async openProject(path: string): Promise<{ status?: string; path?: string; error?: string }> {
    try {
      const res = await fetch(
        `${API_BASE}/project/open?path=${encodeURIComponent(path)}`,
        { method: 'POST' }
      );
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to open project' };
    }
  },

  async getRecentProjects(): Promise<Array<{ path: string; name: string; modified_at: string }>> {
    try {
      const res = await fetch(`${API_BASE}/project/recent`);
      return await res.json();
    } catch {
      return [];
    }
  },

  async saveProjectData(
    path: string,
    file: File,
    missingValue?: string,
    treatment?: string
  ): Promise<{ status?: string; row_count?: number; dataset_name?: string; error?: string }> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      let url = `${API_BASE}/project/save-data?path=${encodeURIComponent(path)}`;
      if (missingValue) url += `&missing_value=${encodeURIComponent(missingValue)}`;
      if (treatment && treatment !== 'none') url += `&treatment=${encodeURIComponent(treatment)}`;

      const res = await fetch(url, {
        method: 'POST',
        body: formData,
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to save project data' };
    }
  },

  async saveProjectDataJson(
    path: string,
    datasetName: string,
    columns: string[],
    rows: any[][],
    missingValue?: string,
    treatment?: string,
    datasetId?: string
  ): Promise<{ status?: string; row_count?: number; dataset_name?: string; dataset_id?: string; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/project/save-data-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          dataset_id: datasetId,
          dataset_name: datasetName,
          columns,
          rows,
          missing_value: missingValue,
          treatment: treatment && treatment !== 'none' ? treatment : undefined
        })
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to save project data' };
    }
  },

  async treatMissing(
    path: string,
    method: 'listwise' | 'mean',
    missingValue?: string
  ): Promise<{ status?: string; method?: string; original_row_count?: number; cleaned_row_count?: number; rows_dropped?: number; error?: string }> {
    try {
      let url = `${API_BASE}/project/treat-missing?path=${encodeURIComponent(path)}&method=${method}`;
      if (missingValue) url += `&missing_value=${encodeURIComponent(missingValue)}`;
      const res = await fetch(url, { method: 'POST' });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to treat missing values' };
    }
  },

  async listProjectDatasets(path: string): Promise<{ datasets?: Array<{ id: string; name: string; n_rows: number; n_cols: number; hash: string }>; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/project/datasets?path=${encodeURIComponent(path)}`);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to list project datasets' };
    }
  },

  async loadProjectData(path: string, datasetId?: string): Promise<{ id?: string; columns?: string[]; rows?: any[][]; dataset_name?: string; error?: string }> {
    try {
      const query = datasetId ? `&dataset_id=${encodeURIComponent(datasetId)}` : '';
      const res = await fetch(`${API_BASE}/project/load-data?path=${encodeURIComponent(path)}${query}`);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to load project data' };
    }
  },

  async deleteProjectData(path: string, datasetId?: string): Promise<{ status?: string; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/project/delete-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, dataset_id: datasetId })
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to delete project data' };
    }
  },

  async validateModel(
    spec: ModelSpec,
    projectPath?: string,
    datasetColumns?: string[]
  ): Promise<ValidationResponse> {
    try {
      const res = await fetch(`${API_BASE}/model/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec,
          project_path: projectPath,
          dataset_columns: datasetColumns,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return {
        is_valid: false,
        errors: [err?.message || 'Failed to connect to backend server'],
        warnings: [],
        exogenous_constructs: [],
        endogenous_constructs: [],
        isolated_constructs: [],
        error: err?.message,
      };
    }
  },

  async saveProjectModel(
    projectPath: string,
    spec: ModelSpec,
    diagramLayout?: any,
    modelId?: string
  ): Promise<SaveModelResponse> {
    try {
      const res = await fetch(`${API_BASE}/project/save-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: projectPath,
          spec,
          diagram_layout: diagramLayout,
          model_id: modelId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMsg = data?.error || data?.detail?.[0]?.msg || (typeof data?.detail === 'string' ? data.detail : null) || `Server error (${res.status})`;
        return { error: errorMsg };
      }
      return data;
    } catch (err: any) {
      return { error: err?.message || `Cannot connect to backend server at ${API_BASE}` };
    }
  },

  async loadProjectModel(projectPath: string, modelId?: string): Promise<LoadModelResponse> {
    try {
      const url = modelId
        ? `${API_BASE}/project/load-model?path=${encodeURIComponent(projectPath)}&model_id=${encodeURIComponent(modelId)}`
        : `${API_BASE}/project/load-model?path=${encodeURIComponent(projectPath)}`;
      const res = await fetch(url);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to load model' };
    }
  },

  async duplicateModel(projectPath: string, sourceModelId: string, newModelId: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/project/duplicate-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: projectPath,
          source_model_id: sourceModelId,
          new_model_id: newModelId,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to duplicate model' };
    }
  },

  async duplicateProject(folderPath: string, sourcePath: string, newName: string, modelIdMap?: Record<string, string>): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/project/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_path: folderPath,
          source_path: sourcePath,
          new_name: newName,
          model_id_map: modelIdMap,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to duplicate study' };
    }
  },

  async moveProject(sourceWorkspacePath: string, targetWorkspacePath: string, sourcePath: string, projectName?: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/project/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_workspace_path: sourceWorkspacePath,
          target_workspace_path: targetWorkspacePath,
          source_path: sourcePath,
          project_name: projectName,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to move study' };
    }
  },

  async remapModelIds(projectPath: string, modelIdMap: Record<string, string>): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/project/remap-model-ids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: projectPath,
          model_id_map: modelIdMap,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to remap model ids' };
    }
  },

  async duplicateWorkspace(sourceFolderPath: string, newName: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/workspace/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_folder_path: sourceFolderPath,
          new_name: newName,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to duplicate workspace' };
    }
  },

  async runPlsModel(
    projectPath: string,
    spec?: ModelSpec,
    options?: {
      scheme?: string;
      max_iter?: number;
      tol?: number;
      bootstrap?: boolean;
      n_boot?: number;
      columns?: string[];
      rows?: any[][];
      dataset_name?: string;
      model_id?: string;
      diagram_layout?: any;
    }
  ): Promise<{ status?: string; algorithm?: string; results?: any; validation?: ValidationResponse; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/project/run-pls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: projectPath,
          spec: spec || undefined,
          scheme: options?.scheme || 'path',
          max_iter: options?.max_iter || 300,
          tol: options?.tol || 1e-7,
          bootstrap: options?.bootstrap || false,
          n_boot: options?.n_boot || 500,
          columns: options?.columns || undefined,
          rows: options?.rows || undefined,
          dataset_name: options?.dataset_name || undefined,
          model_id: options?.model_id || undefined,
          diagram_layout: options?.diagram_layout || undefined,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to execute PLS-SEM calculation' };
    }
  },

  async loadProjectResults(
    projectPath: string,
    algorithm: string = 'pls',
    modelId?: string
  ): Promise<{ algorithm?: string; results?: any; created_at?: string; spec?: any; diagram_layout?: any; error?: string }> {
    try {
      let url = `${API_BASE}/project/load-results?path=${encodeURIComponent(projectPath)}&algorithm=${encodeURIComponent(algorithm)}`;
      if (modelId) {
        url += `&model_id=${encodeURIComponent(modelId)}`;
      }
      const res = await fetch(url);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to load calculation results' };
    }
  },

  async startBootstrap(
    projectPath: string,
    spec?: ModelSpec,
    options?: {
      n_boot?: number;
      seed?: number;
      scheme?: string;
      columns?: string[];
      rows?: any[][];
      dataset_name?: string;
      model_id?: string;
      diagram_layout?: any;
      settings?: any;
    }
  ): Promise<{ status?: string; job_id?: string; n_boot?: number; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/project/bootstrap-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: projectPath,
          spec: spec || undefined,
          n_boot: options?.n_boot || 500,
          seed: options?.seed !== undefined ? options.seed : 42,
          scheme: options?.scheme || 'path',
          columns: options?.columns || undefined,
          rows: options?.rows || undefined,
          dataset_name: options?.dataset_name || undefined,
          model_id: options?.model_id || undefined,
          diagram_layout: options?.diagram_layout || undefined,
          settings: options?.settings || undefined,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to start bootstrapping' };
    }
  },

  async cancelBootstrap(jobId: string): Promise<{ status?: string; job_id?: string; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/project/bootstrap-cancel?job_id=${encodeURIComponent(jobId)}`, {
        method: 'POST',
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to cancel bootstrapping' };
    }
  },

  async getBootstrapStatus(jobId: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/project/bootstrap-status?job_id=${encodeURIComponent(jobId)}`);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to get bootstrap status' };
    }
  },

  createBootstrapWebSocket(
    jobId: string,
    onMessage: (data: any) => void,
    onError?: (err: any) => void,
    onClose?: () => void
  ): WebSocket {
    const wsUrl = `${API_BASE.replace(/^http/, 'ws')}/ws/bootstrap-progress/${encodeURIComponent(jobId)}`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };
    if (onError) ws.onerror = onError;
    if (onClose) ws.onclose = onClose;
    return ws;
  },

  async saveSnapshot(data: {
    projectPath: string;
    name: string;
    description?: string;
    algorithm?: string;
    results: any;
    spec: any;
    diagramLayout: any;
    sourceModelId?: string;
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/project/save-snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          name: data.name,
          description: data.description || '',
          algorithm: data.algorithm || 'pls',
          results: data.results,
          spec: data.spec,
          diagram_layout: data.diagramLayout,
          source_model_id: data.sourceModelId,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to save snapshot' };
    }
  },

  async listSnapshots(projectPath: string): Promise<any[]> {
    try {
      const res = await fetch(`${API_BASE}/project/list-snapshots?path=${encodeURIComponent(projectPath)}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      console.warn('Failed to list snapshots:', err);
      return [];
    }
  },

  async getSnapshot(projectPath: string, snapshotId: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/project/get-snapshot?path=${encodeURIComponent(projectPath)}&snapshot_id=${encodeURIComponent(snapshotId)}`);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to get snapshot' };
    }
  },

  async deleteSnapshot(projectPath: string, snapshotId: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/project/delete-snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: projectPath,
          snapshot_id: snapshotId,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to delete snapshot' };
    }
  },

  async createModelFromSnapshot(projectPath: string, snapshotId: string, newModelId: string, newModelName: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/project/create-model-from-snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: projectPath,
          snapshot_id: snapshotId,
          new_model_id: newModelId,
          new_model_name: newModelName,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to create model from snapshot' };
    }
  },

  async detectSmartPls(folderPath: string): Promise<{
    valid?: boolean;
    project_name?: string;
    folder_path?: string;
    models_count?: number;
    models?: Array<{ file: string; name: string }>;
    datasets_count?: number;
    datasets?: string[];
    error?: string;
  }> {
    try {
      const res = await fetch(`${API_BASE}/project/smartpls/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: folderPath }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to detect SmartPLS project' };
    }
  },

  async importSmartPls(folderPath: string, targetWorkspaceFolder?: string, workspaceName?: string): Promise<{
    status?: string;
    workspace?: {
      id: string;
      name: string;
      path: string;
      createdAt?: string;
      modifiedAt?: string;
    };
    studies?: Array<{
      id: string;
      workspaceId: string;
      name: string;
      type: string;
      description: string;
      lastModified: string;
      path: string;
      dataset_rows: number;
      dataset_columns: string[];
      createdAt?: string;
    }>;
    models?: Array<{
      id: string;
      studyId: string;
      name: string;
      type: string;
      lastModified: string;
    }>;
    imported_from?: string;
    error?: string;
  }> {
    try {
      const res = await fetch(`${API_BASE}/project/smartpls/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_path: folderPath,
          target_workspace_folder: targetWorkspaceFolder || undefined,
          workspace_name: workspaceName || undefined,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to import SmartPLS project' };
    }
  },

  async detectFolder(folderPath: string): Promise<{
    kind?: 'cspls_workspace' | 'cspls_workspace_zip' | 'cspls_project' | 'smartpls_workspace' | 'smartpls_project' | 'unknown' | 'file' | 'not_found' | 'error';
    valid?: boolean;
    name?: string;
    path?: string;
    is_zip?: boolean;
    project_name?: string;
    projects_count?: number;
    projects?: any[];
    models_count?: number;
    datasets_count?: number;
    error?: string;
  }> {
    try {
      const res = await fetch(`${API_BASE}/workspace/detect_folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: folderPath }),
      });
      return await res.json();
    } catch (err: any) {
      return { kind: 'error', error: err?.message || 'Failed to detect folder type' };
    }
  },

  async importSmartPlsWorkspace(folderPath: string): Promise<{
    status?: string;
    workspace?: {
      id: string;
      name: string;
      path: string;
      createdAt?: string;
      modifiedAt?: string;
      projects?: any[];
    };
    studies?: any[];
    models?: any[];
    error?: string;
  }> {
    try {
      const res = await fetch(`${API_BASE}/workspace/smartpls/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: folderPath }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to import SmartPLS workspace' };
    }
  },

  async exportProjectZip(projectPath: string, outZipPath: string): Promise<{ status?: string; zip_path?: string; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/project/export-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath, out_path: outZipPath, include_results: true }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to export project archive' };
    }
  },

  async exportWorkspaceZip(workspacePath: string, outZipPath: string): Promise<{ status?: string; zip_path?: string; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/workspace/export-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_path: workspacePath, out_path: outZipPath }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to export workspace archive' };
    }
  },

  async importWorkspaceZip(zipPath: string, targetParentFolder?: string): Promise<{
    status?: string;
    path?: string;
    workspace?: {
      id: string;
      name: string;
      path: string;
      projects?: any[];
    };
    studies?: any[];
    models?: any[];
    error?: string;
  }> {
    try {
      const res = await fetch(`${API_BASE}/workspace/import-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zip_path: zipPath,
          target_parent_folder: targetParentFolder || undefined,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to import workspace archive' };
    }
  },

  async importProjectZip(zipPath: string, workspaceDir: string, onConflict: string = 'rename'): Promise<{
    status?: string;
    project_path?: string;
    studies?: any[];
    models?: any[];
    error?: string;
  }> {
    try {
      const res = await fetch(`${API_BASE}/project/import-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zip_path: zipPath,
          workspace_dir: workspaceDir,
          on_conflict: onConflict,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to import project archive' };
    }
  },

  async importProjectFile(filePath: string, workspaceDir: string, onConflict: string = 'rename'): Promise<{
    status?: string;
    project_path?: string;
    studies?: any[];
    models?: any[];
    error?: string;
  }> {
    try {
      const res = await fetch(`${API_BASE}/project/import-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: filePath,
          workspace_dir: workspaceDir,
          on_conflict: onConflict,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to import project file' };
    }
  },

  // --- Phase 3-6 Advanced PLS-SEM Analyses ---
  async runBlindfolding(data: {
    projectPath: string;
    modelId?: string;
    datasetId?: string;
    omissionDistance?: number;
    computeQ2Effects?: boolean;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/blindfolding/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          dataset_id: data.datasetId,
          omission_distance: data.omissionDistance || 7,
          compute_q2_effects: data.computeQ2Effects !== false,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run blindfolding' };
    }
  },

  async analyzeMediation(data: {
    projectPath: string;
    modelId?: string;
    source: string;
    target: string;
    datasetId?: string;
    nBoot?: number;
    seed?: number;
    alpha?: number;
    includeSobel?: boolean;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/mediation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          source: data.source,
          target: data.target,
          dataset_id: data.datasetId,
          n_boot: data.nBoot || 500,
          seed: data.seed ?? 42,
          alpha: data.alpha || 0.05,
          include_sobel: !!data.includeSobel,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run mediation analysis' };
    }
  },

  async analyzeModeration(data: {
    projectPath: string;
    modelId?: string;
    source: string;
    moderator: string;
    target: string;
    datasetId?: string;
    method?: string;
    nBoot?: number;
    seed?: number;
    alpha?: number;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/moderation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          source: data.source,
          moderator: data.moderator,
          target: data.target,
          dataset_id: data.datasetId,
          method: data.method || 'two_stage',
          n_boot: data.nBoot || 500,
          seed: data.seed ?? 42,
          alpha: data.alpha || 0.05,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run moderation analysis' };
    }
  },

  async analyzeQuadratic(data: {
    projectPath: string;
    modelId?: string;
    source: string;
    target: string;
    datasetId?: string;
    nBoot?: number;
    seed?: number;
    alpha?: number;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/quadratic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          source: data.source,
          target: data.target,
          dataset_id: data.datasetId,
          n_boot: data.nBoot || 500,
          seed: data.seed ?? 42,
          alpha: data.alpha || 0.05,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run quadratic analysis' };
    }
  },

  async analyzeIpma(data: {
    projectPath: string;
    modelId?: string;
    target: string;
    datasetId?: string;
    scaleBounds?: Record<string, any>;
    level?: string;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/ipma`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          target: data.target,
          dataset_id: data.datasetId,
          scale_bounds: data.scaleBounds,
          level: data.level || 'both',
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run IPMA' };
    }
  },

  async analyzeHcm(data: {
    projectPath: string;
    modelId?: string;
    hocId: string;
    locIds: string[];
    datasetId?: string;
    hocType?: string;
    approach?: string;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/hcm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          hoc_id: data.hocId,
          loc_ids: data.locIds,
          dataset_id: data.datasetId,
          hoc_type: data.hocType || 'RR',
          approach: data.approach || 'repeated_indicators',
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run HCM analysis' };
    }
  },

  async analyzeCta(data: {
    projectPath: string;
    modelId?: string;
    constructId?: string;
    datasetId?: string;
    nBoot?: number;
    seed?: number;
    alpha?: number;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/cta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          construct_id: data.constructId,
          dataset_id: data.datasetId,
          n_boot: data.nBoot || 500,
          seed: data.seed ?? 42,
          alpha: data.alpha || 0.05,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run CTA-PLS' };
    }
  },

  async analyzeMicom(data: {
    projectPath: string;
    modelId?: string;
    groupCol: string;
    groupValues?: any[];
    datasetId?: string;
    nPermutations?: number;
    alpha?: number;
    seed?: number;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/micom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          group_col: data.groupCol,
          group_values: data.groupValues,
          dataset_id: data.datasetId,
          n_permutations: data.nPermutations || 500,
          alpha: data.alpha || 0.05,
          seed: data.seed ?? 42,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run MICOM' };
    }
  },

  async analyzeMga(data: {
    projectPath: string;
    modelId?: string;
    groupCol: string;
    groupValues?: any[];
    datasetId?: string;
    nBoot?: number;
    nPermutations?: number;
    seed?: number;
    alpha?: number;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/mga`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          group_col: data.groupCol,
          group_values: data.groupValues,
          dataset_id: data.datasetId,
          n_boot: data.nBoot || 500,
          n_permutations: data.nPermutations || 500,
          seed: data.seed ?? 42,
          alpha: data.alpha || 0.05,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run MGA' };
    }
  },

  async analyzeFimix(data: {
    projectPath: string;
    modelId?: string;
    minSegments?: number;
    maxSegments?: number;
    datasetId?: string;
    seed?: number;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/fimix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          min_segments: data.minSegments || 1,
          max_segments: data.maxSegments || 4,
          dataset_id: data.datasetId,
          seed: data.seed ?? 42,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run FIMIX-PLS' };
    }
  },

  async analyzePos(data: {
    projectPath: string;
    modelId?: string;
    nSegments?: number;
    maxIter?: number;
    minSegmentSize?: number;
    datasetId?: string;
    seed?: number;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/pos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          n_segments: data.nSegments || 2,
          max_iter: data.maxIter || 50,
          min_segment_size: data.minSegmentSize || 15,
          dataset_id: data.datasetId,
          seed: data.seed ?? 42,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run PLS-POS' };
    }
  },

  async analyzeOtg(data: {
    projectPath: string;
    modelId?: string;
    groupCol: string;
    groupValues?: any[];
    nBoot?: number;
    nPermutations?: number;
    datasetId?: string;
    seed?: number;
    alpha?: number;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/otg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          group_col: data.groupCol,
          group_values: data.groupValues,
          n_boot: data.nBoot || 500,
          n_permutations: data.nPermutations || 1000,
          dataset_id: data.datasetId,
          seed: data.seed ?? 42,
          alpha: data.alpha ?? 0.05,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run OTG analysis' };
    }
  },

  async analyzeExPost(data: {
    projectPath: string;
    modelId?: string;
    segmentCol: string;
    explanatoryCols: string[];
    crosstabCatCol?: string;
    runPosComparison?: boolean;
    minSampleSize?: number;
    datasetId?: string;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/ex-post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId || 'default',
          segment_col: data.segmentCol,
          explanatory_cols: data.explanatoryCols,
          crosstab_cat_col: data.crosstabCatCol,
          run_pos_comparison: data.runPosComparison ?? true,
          min_sample_size: data.minSampleSize ?? 54,
          dataset_id: data.datasetId,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run Ex Post segmentation' };
    }
  },

  async generateDataGroups(data: {
    path: string;
    datasetId?: string;
    column: string;
    minSize?: number;
    maxPathsPredictors?: number;
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/data/groups/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: data.path,
          dataset_id: data.datasetId,
          column: data.column,
          min_size: data.minSize ?? 10,
          max_paths_predictors: data.maxPathsPredictors ?? 2,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to generate data groups' };
    }
  },

  async appendDatasetColumn(data: {
    path: string;
    datasetId: string;
    columnName: string;
    values: any[];
    role?: string;
    label?: string;
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/data/append-column`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: data.path,
          dataset_id: data.datasetId,
          column_name: data.columnName,
          values: data.values,
          role: data.role || 'group',
          label: data.label,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to append column' };
    }
  },

  async loadCorporateReputationTemplate(path: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/project/load-template/corporate-reputation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to load Corporate Reputation template' };
    }
  },

  async calculatePower(params: {
    nSamples?: number;
    nPredictors?: number;
    rSquared?: number;
    effectSizeF2?: number;
    targetPower?: number;
    alpha?: number;
    maxFormativeIndicators?: number;
    maxPathsIntoConstruct?: number;
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/power/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          n_samples: params.nSamples,
          n_predictors: params.nPredictors,
          r_squared: params.rSquared,
          effect_size_f2: params.effectSizeF2,
          target_power: params.targetPower || 0.80,
          alpha: params.alpha || 0.05,
          max_formative_indicators: params.maxFormativeIndicators,
          max_paths_into_construct: params.maxPathsIntoConstruct,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to calculate power' };
    }
  },

  async getPowerTable(targetPower: number = 0.80, alpha: number = 0.05): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/power/table?target_power=${targetPower}&alpha=${alpha}`);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to fetch power table' };
    }
  },

  async analyzeCopula(data: {
    projectPath: string;
    modelId: string;
    candidatePredictor: string;
    targetConstruct: string;
    datasetId?: string;
    nBoot?: number;
    seed?: number;
    alpha?: number;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/copula`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId,
          candidate_predictor: data.candidatePredictor,
          target_construct: data.targetConstruct,
          dataset_id: data.datasetId,
          n_boot: data.nBoot || 200,
          seed: data.seed ?? 42,
          alpha: data.alpha || 0.05,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run Copula analysis' };
    }
  },

  async analyzeNca(data: {
    projectPath: string;
    modelId: string;
    predictor: string;
    outcome: string;
    datasetId?: string;
    nPermutations?: number;
    seed?: number;
    alpha?: number;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/nca`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId,
          predictor: data.predictor,
          outcome: data.outcome,
          dataset_id: data.datasetId,
          n_permutations: data.nPermutations || 500,
          seed: data.seed ?? 42,
          alpha: data.alpha || 0.05,
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run NCA analysis' };
    }
  },

  async analyzePredict(data: {
    projectPath: string;
    modelId: string;
    datasetId?: string;
    kFolds?: number;
    repetitions?: number;
    seed?: number;
    antecedents?: string;
    spec?: any;
    columns?: string[];
    rows?: any[][];
  }): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/analysis/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId,
          dataset_id: data.datasetId,
          k_folds: data.kFolds || 10,
          repetitions: data.repetitions || 10,
          seed: data.seed ?? 42,
          antecedents: data.antecedents || 'direct',
          spec: data.spec,
          columns: data.columns,
          rows: data.rows,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to run PLSpredict' };
    }
  },

  async exportReportPdf(data: {
    projectPath: string;
    modelId?: string;
    datasetId?: string;
    projectName?: string;
    datasetName?: string;
    modelName?: string;
    author?: string;
  }): Promise<Blob | { error: string }> {
    try {
      const res = await fetch(`${API_BASE}/export/report-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: data.projectPath,
          model_id: data.modelId,
          dataset_id: data.datasetId,
          project_name: data.projectName,
          dataset_name: data.datasetName,
          model_name: data.modelName,
          author: data.author,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json();
        return { error: errJson.error || 'Failed to generate PDF report' };
      }
      return await res.blob();
    } catch (err: any) {
      return { error: err?.message || 'Failed to download PDF report' };
    }
  },

  async generateNarrative(data: {
    results?: any;
    projectPath?: string;
    modelId?: string;
    style?: string;
    sections?: string[];
  }): Promise<{ full_text?: string; sections?: Record<string, { title: string; content: string }>; error?: string }> {
    try {
      const res = await fetch(`${API_BASE}/reporting/narrative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          results: data.results,
          project_path: data.projectPath,
          model_id: data.modelId,
          style: data.style || 'apa',
          sections: data.sections,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to generate narrative report' };
    }
  },

  async exportTable(params: {
    projectPath: string;
    tableName: string;
    format?: string;
    decimals?: number;
    modelId?: string;
  }): Promise<Blob | { error: string }> {
    try {
      const query = new URLSearchParams({
        project_path: params.projectPath,
        table_name: params.tableName,
        format: params.format || 'csv',
        decimals: String(normalizeDecimalDigits(params.decimals ?? DEFAULT_DECIMAL_DIGITS)),
      });
      if (params.modelId) query.append('model_id', params.modelId);
      const res = await fetch(`${API_BASE}/export/table?${query.toString()}`);
      if (!res.ok) {
        const errJson = await res.json();
        return { error: errJson.error || 'Failed to export table' };
      }
      return await res.blob();
    } catch (err: any) {
      return { error: err?.message || 'Failed to export table' };
    }
  },

  // --- Data Screening Endpoints ---
  async getScreeningMissing(projectPath: string, datasetId?: string, modelId?: string, caseThreshold: number = 15.0, indicatorThreshold: number = 5.0): Promise<any> {
    try {
      let url = `${API_BASE}/screening/missing?path=${encodeURIComponent(projectPath)}&case_threshold=${caseThreshold}&indicator_threshold=${indicatorThreshold}`;
      if (datasetId) url += `&dataset_id=${encodeURIComponent(datasetId)}`;
      if (modelId) url += `&model_id=${encodeURIComponent(modelId)}`;
      const res = await fetch(url);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to load missing data screening' };
    }
  },

  async removeFlaggedCases(projectPath: string, datasetId?: string, newDatasetName?: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/screening/remove-flagged-cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          dataset_id: datasetId,
          new_dataset_name: newDatasetName,
        }),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to remove flagged cases' };
    }
  },

  async getScreeningPatterns(projectPath: string, datasetId?: string, modelId?: string): Promise<any> {
    try {
      let url = `${API_BASE}/screening/patterns?path=${encodeURIComponent(projectPath)}`;
      if (datasetId) url += `&dataset_id=${encodeURIComponent(datasetId)}`;
      if (modelId) url += `&model_id=${encodeURIComponent(modelId)}`;
      const res = await fetch(url);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to load response patterns' };
    }
  },

  async getScreeningOutliers(projectPath: string, datasetId?: string, columns?: string): Promise<any> {
    try {
      let url = `${API_BASE}/screening/outliers?path=${encodeURIComponent(projectPath)}`;
      if (datasetId) url += `&dataset_id=${encodeURIComponent(datasetId)}`;
      if (columns) url += `&columns=${encodeURIComponent(columns)}`;
      const res = await fetch(url);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to load outliers' };
    }
  },

  async getScreeningDistributions(projectPath: string, datasetId?: string, ruleSet: string = 'textbook'): Promise<any> {
    try {
      let url = `${API_BASE}/screening/distributions?path=${encodeURIComponent(projectPath)}&rule_set=${encodeURIComponent(ruleSet)}`;
      if (datasetId) url += `&dataset_id=${encodeURIComponent(datasetId)}`;
      const res = await fetch(url);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to load distributions' };
    }
  },

  async getScreeningHistogram(projectPath: string, column: string, datasetId?: string, bins: string = 'auto'): Promise<any> {
    try {
      let url = `${API_BASE}/screening/histogram?path=${encodeURIComponent(projectPath)}&column=${encodeURIComponent(column)}&bins=${encodeURIComponent(bins)}`;
      if (datasetId) url += `&dataset_id=${encodeURIComponent(datasetId)}`;
      const res = await fetch(url);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to load histogram' };
    }
  },

  async getScreeningDirectionality(projectPath: string, modelId: string, datasetId?: string): Promise<any> {
    try {
      let url = `${API_BASE}/screening/directionality?path=${encodeURIComponent(projectPath)}&model_id=${encodeURIComponent(modelId)}`;
      if (datasetId) url += `&dataset_id=${encodeURIComponent(datasetId)}`;
      const res = await fetch(url);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to load directionality' };
    }
  },

  async getDataCorrelations(projectPath: string, datasetId?: string): Promise<any> {
    try {
      let url = `${API_BASE}/data/correlations?path=${encodeURIComponent(projectPath)}`;
      if (datasetId) url += `&dataset_id=${encodeURIComponent(datasetId)}`;
      const res = await fetch(url);
      return await res.json();
    } catch (err: any) {
      return { error: err?.message || 'Failed to load correlations' };
    }
  },
};


