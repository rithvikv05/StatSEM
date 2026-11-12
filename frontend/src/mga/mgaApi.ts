import { backendUrl } from '../utils/api';
import { getCachedTokenString } from '../utils/license';
import type {
  DataGroup,
  EligibleGroupColumn,
  GroupWarning,
  MgaReport,
  MgaReportSummary,
  PermutationReport,
  PlsSettings,
} from './types';

async function mgaFetch(path: string, init?: RequestInit): Promise<any> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has('Content-Type') && init?.method === 'POST') {
    headers.set('Content-Type', 'application/json');
  }
  try {
    const token = await getCachedTokenString();
    if (token && !headers.has('X-License-Token')) {
      headers.set('X-License-Token', token);
    }
  } catch {
    // ignore in browser dev mode
  }
  const res = await window.fetch(`${backendUrl()}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.error) {
    return { error: `Server error (${res.status})` };
  }
  return data;
}

export const mgaApi = {
  async inspectGroups(params: {
    projectPath?: string;
    datasetId?: string;
    columns: string[];
    rows: any[][];
    dataGroups: DataGroup[];
    spec?: any;
    significanceLevel?: number;
    minR2?: number;
  }): Promise<{
    eligibleColumns?: EligibleGroupColumn[];
    groups?: DataGroup[];
    arrows?: number;
    recommendedMinN?: number;
    warnings?: GroupWarning[];
    error?: string;
  }> {
    return mgaFetch('/mga/groups/inspect', {
      method: 'POST',
      body: JSON.stringify({
        project_path: params.projectPath,
        dataset_id: params.datasetId,
        columns: params.columns,
        rows: params.rows,
        dataGroups: params.dataGroups,
        spec: params.spec,
        significanceLevel: params.significanceLevel ?? 0.05,
        minR2: params.minR2 ?? 0.1,
      }),
    });
  },

  async previewGeneratedGroups(params: {
    columns: string[];
    rows: any[][];
    prefix: string;
    selectedColumns: string[];
    minimumCases: number;
  }): Promise<{
    totalCombinations?: number;
    keptCount?: number;
    prunedCount?: number;
    groups?: DataGroup[];
    error?: string;
  }> {
    return mgaFetch('/mga/groups/preview', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async generateGroups(params: {
    projectPath?: string;
    datasetId?: string;
    columns: string[];
    rows: any[][];
    dataGroups: DataGroup[];
    prefix: string;
    selectedColumns: string[];
    minimumCases: number;
  }): Promise<{
    totalCombinations?: number;
    keptCount?: number;
    prunedCount?: number;
    generatedGroups?: DataGroup[];
    dataGroups?: DataGroup[];
    error?: string;
  }> {
    return mgaFetch('/mga/groups/generate', {
      method: 'POST',
      body: JSON.stringify({
        project_path: params.projectPath,
        dataset_id: params.datasetId,
        columns: params.columns,
        rows: params.rows,
        dataGroups: params.dataGroups,
        prefix: params.prefix,
        selectedColumns: params.selectedColumns,
        minimumCases: params.minimumCases,
      }),
    });
  },

  async evaluateGroup(params: {
    columns: string[];
    rows: any[][];
    group: DataGroup;
  }): Promise<{ group?: DataGroup; error?: string }> {
    return mgaFetch('/mga/groups/evaluate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async saveGroups(params: {
    projectPath: string;
    datasetId?: string;
    columns: string[];
    rows: any[][];
    dataGroups: DataGroup[];
  }): Promise<{ status?: string; dataGroups?: DataGroup[]; error?: string }> {
    return mgaFetch('/mga/groups/save', {
      method: 'POST',
      body: JSON.stringify({
        project_path: params.projectPath,
        dataset_id: params.datasetId,
        columns: params.columns,
        rows: params.rows,
        dataGroups: params.dataGroups,
      }),
    });
  },

  async equalizeGroupSizes(params: {
    projectPath?: string;
    datasetId?: string;
    datasetName: string;
    columns: string[];
    rows: any[][];
    dataGroups: DataGroup[];
    groupA: DataGroup;
    groupB: DataGroup;
    seed?: number;
  }): Promise<{
    datasetId?: string;
    datasetName?: string;
    columns?: string[];
    rows?: any[][];
    dataGroups?: DataGroup[];
    targetN?: number;
    seed?: number;
    error?: string;
  }> {
    return mgaFetch('/mga/groups/equalize', {
      method: 'POST',
      body: JSON.stringify({
        project_path: params.projectPath,
        dataset_id: params.datasetId,
        datasetName: params.datasetName,
        columns: params.columns,
        rows: params.rows,
        dataGroups: params.dataGroups,
        groupA: params.groupA,
        groupB: params.groupB,
        seed: params.seed,
      }),
    });
  },

  async startPermutation(params: {
    projectPath?: string;
    modelId?: string;
    datasetId?: string;
    spec: any;
    columns: string[];
    rows: any[][];
    groupA: DataGroup;
    groupB: DataGroup;
    permutations: number;
    testType: 'two-tailed' | 'one-tailed';
    significanceLevel: number;
    parallelProcessing: boolean;
    seed: number | null;
    plsSettings: PlsSettings;
  }): Promise<{ status?: string; jobId?: string; total?: number; error?: string }> {
    return mgaFetch('/mga/permutation/start', {
      method: 'POST',
      body: JSON.stringify({
        project_path: params.projectPath,
        model_id: params.modelId,
        dataset_id: params.datasetId,
        spec: params.spec,
        columns: params.columns,
        rows: params.rows,
        groupA: params.groupA,
        groupB: params.groupB,
        permutations: params.permutations,
        testType: params.testType,
        significanceLevel: params.significanceLevel,
        parallelProcessing: params.parallelProcessing,
        seed: params.seed,
        plsSettings: params.plsSettings,
      }),
    });
  },

  async getPermutationStatus(jobId: string): Promise<{
    jobId?: string;
    status?: 'running' | 'completed' | 'cancelled' | 'failed';
    current?: number;
    total?: number;
    percent?: number;
    elapsedSec?: number;
    result?: PermutationReport;
    error?: string;
  }> {
    return mgaFetch(`/mga/permutation/status?job_id=${encodeURIComponent(jobId)}`);
  },

  async cancelPermutation(jobId: string): Promise<{ status?: string; error?: string }> {
    return mgaFetch(`/mga/permutation/cancel?job_id=${encodeURIComponent(jobId)}`, {
      method: 'POST',
    });
  },

  async startBootstrapMga(params: {
    projectPath?: string;
    modelId?: string;
    datasetId?: string;
    spec: any;
    columns: string[];
    rows: any[][];
    groupA: DataGroup;
    groupB: DataGroup;
    subsamples: number;
    testType: 'two-tailed' | 'one-tailed';
    significanceLevel: number;
    parallelProcessing: boolean;
    seed: number | null;
    plsSettings: PlsSettings;
  }): Promise<{ status?: string; jobId?: string; total?: number; error?: string }> {
    return mgaFetch('/mga/bootstrap/start', {
      method: 'POST',
      body: JSON.stringify({
        project_path: params.projectPath,
        model_id: params.modelId,
        dataset_id: params.datasetId,
        spec: params.spec,
        columns: params.columns,
        rows: params.rows,
        groupA: params.groupA,
        groupB: params.groupB,
        subsamples: params.subsamples,
        testType: params.testType,
        significanceLevel: params.significanceLevel,
        parallelProcessing: params.parallelProcessing,
        seed: params.seed,
        plsSettings: params.plsSettings,
      }),
    });
  },

  async getBootstrapMgaStatus(jobId: string): Promise<{
    jobId?: string;
    status?: 'running' | 'completed' | 'cancelled' | 'failed';
    phase?: string;
    current?: number;
    total?: number;
    percent?: number;
    elapsedSec?: number;
    result?: MgaReport;
    error?: string;
  }> {
    return mgaFetch(`/mga/bootstrap/status?job_id=${encodeURIComponent(jobId)}`);
  },

  async cancelBootstrapMga(jobId: string): Promise<{ status?: string; error?: string }> {
    return mgaFetch(`/mga/bootstrap/cancel?job_id=${encodeURIComponent(jobId)}`, {
      method: 'POST',
    });
  },

  async listReports(projectPath: string, modelId?: string): Promise<{
    reports?: MgaReportSummary[];
    error?: string;
  }> {
    let url = `/mga/reports/list?path=${encodeURIComponent(projectPath)}`;
    if (modelId) url += `&model_id=${encodeURIComponent(modelId)}`;
    return mgaFetch(url);
  },

  async getReport(projectPath: string, reportId: string): Promise<{
    report?: PermutationReport | MgaReport;
    error?: string;
  }> {
    return mgaFetch(
      `/mga/reports/get?path=${encodeURIComponent(projectPath)}&report_id=${encodeURIComponent(reportId)}`
    );
  },

  async deleteReport(projectPath: string, reportId: string): Promise<{ status?: string; error?: string }> {
    return mgaFetch('/mga/reports/delete', {
      method: 'POST',
      body: JSON.stringify({ project_path: projectPath, report_id: reportId }),
    });
  },
};

