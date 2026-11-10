import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import type { ParsedDataset } from './utils/dataset-parser';
import { api } from './utils/api';
import {
  type LicenseStatus,
  getLicenseStatus,
  activateLicense,
  deactivateLicense,
  getMachineFingerprint,
  devMintToken,
  clearCachedToken,
} from './utils/license';

export type ShapeType = 'circle' | 'rect' | 'hexagon' | 'octagon';

export interface Workspace {
  id: string;
  name: string;
  path: string;
  originalPath?: string;
  archivedAt?: string;
  createdAt?: string;
  modifiedAt?: string;
  isPinned?: boolean;
}

export interface Model {
  id: string;
  studyId: string;
  name: string;
  type: string;
  lastModified: string;
  datasetId?: string;
}

export const getStudyDatasets = (
  datasetsByStudy: Record<string, any> | undefined,
  studyId: string
): ParsedDataset[] => {
  if (!datasetsByStudy) return [];
  const raw = datasetsByStudy[studyId];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
};

export interface Study {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  description: string;
  lastModified: string;
  path: string;
  createdAt?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  archivedAt?: string;
}

export interface Variable {
  id: string;
  name: string;
  category: string;
  type: string;
}

export interface NodeData {
  id: string;
  label: string;
  x: number;
  y: number;
  isLatent: boolean;
  shape?: ShapeType;
  isText?: boolean;
  parentId?: string; // For indicators
  // Formatting
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  width?: number; // Custom sizing
  height?: number; // Custom sizing
  radius?: number; // Custom sizing
  fillColor?: string; // Custom color
  formative?: boolean; // Mode B (formative) vs Mode A (reflective)
  hideIndicators?: boolean; // Toggle visibility of connected indicators
}

export interface EdgeData {
  id: string;
  sourceId: string;
  targetId: string;
}
export interface ContextMenuItem {
  id: string;
  label: string;
  icon: string;
  danger?: boolean;
  disabled?: boolean;
  action: () => void;
}

export interface AppSettings {
  version: string;
  websiteUrl: string;
  theme: 'light' | 'dark' | 'system';
  darkVariant: 'default' | 'grayscale' | 'true-black';
  fontFamily: 'Inter' | 'Roboto' | 'JetBrains Mono' | 'System';
  language: 'en' | 'es' | 'de' | 'fr' | 'zh';
  decimalSystem: 'point' | 'comma';
  decimalDigits: number;
  parallelProcessors: number | 'all';
  keyboardLayout: 'qwerty' | 'azerty' | 'qwertz';
  flipOrientation: boolean;
  accentColor: string;
  sidebarPosition: 'left' | 'right' | 'hidden';
  lockExpandedSidebar: boolean;
  canvasGrid?: 'dots' | 'grid' | 'blank';
  canvasBgColor?: string;
  canvasRecentBgColors?: string[];
}

export const LICENSE_INFO = {
  type: 'Faculty Multi-Seat',
  licensee: 'Academic Licensee',
  key: 'STATSEM-8492-7104-FAC-2026',
  expiryDate: 'Dec 31, 2026',
  daysRemaining: 108,
};

export interface DeleteConfirmDialog {
  title?: string;
  message?: string;
  itemName?: string;
  onConfirm: () => void;
}

export interface StudySnapshot {
  id: string;
  name: string;
  description?: string;
  algorithm: string;
  created_at: string;
  source_model_id?: string;
}

export interface AppTab {
  id: string;
  type: 'get-started' | 'workspace' | 'model' | 'archive' | 'dataset' | 'docs' | 'samples' | 'feedback' | 'changelog' | 'snapshot';
  title: string;
  workspaceId?: string | null;
  studyId?: string | null;
  modelId?: string | null;
  datasetId?: string | null;
  snapshotId?: string | null;
}

interface AppState {
  // Global & Settings
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  settingsActiveTab: 'about' | 'appearance' | 'calculation' | 'canvas';
  setSettingsActiveTab: (tab: 'about' | 'appearance' | 'calculation' | 'canvas') => void;
  openSettings: (tab?: 'about' | 'appearance' | 'calculation' | 'canvas') => void;
  isLicenseActive: boolean;
  setIsLicenseActive: (active: boolean) => void;
  licenseStatus: LicenseStatus | null;
  isLicenseLoading: boolean;
  machineFingerprint: string;
  loadLicenseStatus: () => Promise<void>;
  activateLicenseKey: (tokenString: string) => Promise<{ success: boolean; error?: string }>;
  deactivateLicenseKey: () => Promise<{ success: boolean; error?: string }>;
  devMintLicense: (licensee: string, tier: string, mode: string, daysValid: number) => Promise<string>;
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Deletion Confirmation Modal
  deleteConfirmation: DeleteConfirmDialog | null;
  requestDelete: (config: DeleteConfirmDialog) => void;
  closeDeleteConfirm: () => void;
  
  // Tabs (VSCode / Chrome Browser style)
  tabs: AppTab[];
  activeTabId: string;
  openTab: (tab: Omit<AppTab, 'id'> & { id?: string }) => void;
  closeTab: (id: string) => void;
  closeTabs: (ids: string[]) => void;
  setActiveTab: (id: string) => void;
  updateTabTitle: (id: string, title: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;

  // Workspaces & Studies
  workspaces: Workspace[];
  archivedWorkspaces: Workspace[];
  activeWorkspaceId: string | null;
  studies: Study[];
  activeStudyId: string | null;
  models: Model[];
  datasetsByStudy: Record<string, ParsedDataset[]>;
  snapshotsByStudy: Record<string, StudySnapshot[]>;
  setStudySnapshots: (studyId: string, snapshots: StudySnapshot[]) => void;
  addStudySnapshot: (studyId: string, snapshot: StudySnapshot) => void;
  removeStudySnapshot: (studyId: string, snapshotId: string) => void;
  activeModelId: string | null;
  addModel: (model: Model) => void;
  removeModel: (id: string) => void;
  renameModel: (id: string, name: string) => void;
  duplicateModel: (id: string) => void;
  setActiveModel: (id: string) => void;
  setModelDatasetId: (modelId: string, datasetId: string) => void;

  addWorkspace: (ws: Workspace) => void;
  removeWorkspace: (id: string) => void;
  archiveWorkspace: (id: string) => void | Promise<void>;
  restoreWorkspace: (id: string) => void | Promise<void>;
  deleteWorkspace: (id: string) => void | Promise<void>;
  deleteStudy: (id: string) => void;
  deleteModel: (id: string) => void;
  deleteDataset: (studyId: string, datasetId?: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  duplicateWorkspace: (id: string) => void | Promise<void>;
  togglePinWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;
  addStudy: (study: Study) => void;
  syncWorkspaceStudies: (workspaceId: string, diskProjects: Array<{ path: string; name: string; fullPath: string; isArchived?: boolean; archivedAt?: string }>) => void;
  removeStudy: (id: string) => void;
  archiveStudy: (id: string) => void;
  restoreStudy: (id: string) => void;
  renameStudy: (id: string, name: string) => void;
  duplicateStudy: (id: string) => void;
  togglePinStudy: (id: string) => void;
  moveStudyToWorkspace: (studyId: string, targetWorkspaceId: string, targetWorkspacePath: string) => Promise<{ success: boolean; error?: string }>;
  copyStudyToWorkspace: (studyId: string, targetWorkspaceId: string, targetWorkspacePath: string, newStudyName: string) => Promise<{ success: boolean; newStudyId?: string; error?: string }>;
  setActiveStudy: (id: string) => void;
  setStudyDataset: (studyId: string, dataset: ParsedDataset) => void;
  addStudyDataset: (studyId: string, dataset: ParsedDataset) => void;
  setStudyDatasets: (studyId: string, datasets: ParsedDataset[]) => void;
  removeStudyDataset: (studyId: string, datasetId?: string) => void;
  lastUsedDatasetByStudy: Record<string, string>;
  setStudyLastDatasetId: (studyId: string, datasetId: string) => void;
  touchStudy: (id: string) => void;
  
  // Variables (Sidebar)
  variables: Variable[];
  
  // Canvas State
  nodes: NodeData[];
  edges: EdgeData[];
  selectedIds: Set<string>;
  mode: 'select' | 'latent' | 'connect' | 'moderation' | 'quadratic' | 'copula' | 'text';
  zoom: number;
  pan: { x: number, y: number };
  
  // Canvas Actions
  addNode: (node: NodeData) => void;
  updateNode: (id: string, data: Partial<NodeData>) => void;
  removeNodes: (ids: string[]) => void;
  addEdge: (sourceId: string, targetId: string) => void;
  removeEdges: (ids: string[]) => void;
  setMode: (mode: AppState['mode']) => void;
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;

  // Context Menu
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null;
  openContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  closeContextMenu: () => void;
}

// Initial Mock Data removed in favor of empty starts
const INITIAL_WORKSPACES: Workspace[] = [];
const INITIAL_STUDIES: Study[] = [];
const INITIAL_MODELS: Model[] = [];
const INITIAL_VARIABLES: Variable[] = [
  { id: 'v1', name: 'QUAL_1', category: 'QUAL', type: 'ORD' },
  { id: 'v2', name: 'QUAL_2', category: 'QUAL', type: 'ORD' },
  { id: 'v3', name: 'QUAL_3', category: 'QUAL', type: 'ORD' },
  { id: 'v4', name: 'PERF_1', category: 'PERF', type: 'ORD' },
  { id: 'v5', name: 'PERF_2', category: 'PERF', type: 'ORD' },
  { id: 'v6', name: 'COMP_1', category: 'COMP', type: 'ORD' },
  { id: 'v7', name: 'COMP_2', category: 'COMP', type: 'ORD' },
  { id: 'v8', name: 'CSOR_1', category: 'CSOR', type: 'ORD' },
  { id: 'v9', name: 'CUSA_1', category: 'CUSA', type: 'ORD' },
];

const INITIAL_SETTINGS: AppSettings = {
  version: '0.1.0',
  websiteUrl: 'https://statsem.org',
  theme: 'light',
  darkVariant: 'default',
  fontFamily: 'Inter',
  language: 'en',
  decimalSystem: 'point',
  decimalDigits: 3,
  parallelProcessors: 'all',
  keyboardLayout: 'qwerty',
  flipOrientation: false,
  accentColor: '#6B4EE6',
  sidebarPosition: 'left',
  lockExpandedSidebar: false,
  canvasGrid: 'dots',
  canvasBgColor: '',
  canvasRecentBgColors: [],
};

type SavedState = Pick<AppState, 'workspaces' | 'archivedWorkspaces' | 'studies' | 'models' | 'datasetsByStudy' | 'lastUsedDatasetByStudy' | 'activeWorkspaceId' | 'theme' | 'settings' | 'isSidebarCollapsed' | 'isLicenseActive'>;

// Zustand invokes persistence on every state update, including transient
// canvas and menu updates. Avoid repeatedly serializing all dataset rows when
// none of the fields that we persist has changed.
let lastSavedState: SavedState | undefined;
const workspaceStorage: PersistStorage<SavedState> = {
  getItem: (name) => {
    const value = localStorage.getItem(name);
    return value ? JSON.parse(value) : null;
  },
  setItem: (name, value) => {
    const state = value.state;
    if (lastSavedState && (Object.keys(state) as (keyof SavedState)[]).every((key) => Object.is(state[key], lastSavedState?.[key]))) return;
    localStorage.setItem(name, JSON.stringify(value));
    lastSavedState = state;
  },
  removeItem: (name) => {
    lastSavedState = undefined;
    localStorage.removeItem(name);
  },
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Global & Settings
      theme: 'light',
      toggleTheme: () => set((state) => {
        const nextTheme: 'light' | 'dark' = state.theme === 'light' ? 'dark' : 'light';
        return {
          theme: nextTheme,
          settings: { ...state.settings, theme: nextTheme },
        };
      }),
      settings: INITIAL_SETTINGS,
      updateSettings: (partial) => set((state) => {
        let nextTheme = state.theme;
        if (partial.theme) {
          nextTheme = partial.theme === 'dark' ? 'dark' : 'light';
        }
        if (partial.sidebarPosition) {
          document.documentElement.dataset.sidebarPosition = partial.sidebarPosition;
        }
        let nextSidebarCollapsed = state.isSidebarCollapsed;
        if (partial.lockExpandedSidebar === true) {
          nextSidebarCollapsed = false;
        }
        return {
          settings: { ...state.settings, ...partial },
          theme: nextTheme,
          isSidebarCollapsed: nextSidebarCollapsed,
        };
      }),
      isSettingsOpen: false,
      setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),
      settingsActiveTab: 'about',
      setSettingsActiveTab: (tab) => set({ settingsActiveTab: tab }),
      openSettings: (tab = 'about') => set({ isSettingsOpen: true, settingsActiveTab: tab }),
      isLicenseActive: true,
      setIsLicenseActive: (active) => set({ isLicenseActive: active }),
      licenseStatus: null,
      isLicenseLoading: false,
      machineFingerprint: '',
      loadLicenseStatus: async () => {
        set({ isLicenseLoading: true });
        try {
          const [status, fp] = await Promise.all([
            getLicenseStatus(),
            getMachineFingerprint().catch(() => ''),
          ]);
          // License initialization can create a development token while an
          // early workspace request is still reading the old token state.
          clearCachedToken();
          set({
            licenseStatus: status,
            isLicenseActive: status.is_valid,
            machineFingerprint: fp || status.machine_id,
            isLicenseLoading: false,
          });
        } catch (err) {
          console.error('[store] loadLicenseStatus error:', err);
          set({ isLicenseLoading: false });
        }
      },
      activateLicenseKey: async (tokenString: string) => {
        set({ isLicenseLoading: true });
        try {
          const status = await activateLicense(tokenString);
          clearCachedToken();
          set({
            licenseStatus: status,
            isLicenseActive: status.is_valid,
            isLicenseLoading: false,
          });
          return { success: status.is_valid, error: status.error || undefined };
        } catch (err: any) {
          set({ isLicenseLoading: false });
          return { success: false, error: String(err?.message || err) };
        }
      },
      deactivateLicenseKey: async () => {
        set({ isLicenseLoading: true });
        try {
          await deactivateLicense();
          clearCachedToken();
          const status = await getLicenseStatus();
          set({
            licenseStatus: status,
            isLicenseActive: status.is_valid,
            isLicenseLoading: false,
          });
          return { success: true };
        } catch (err: any) {
          set({ isLicenseLoading: false });
          return { success: false, error: String(err?.message || err) };
        }
      },
      devMintLicense: async (licensee: string, tier: string, mode: string, daysValid: number) => {
        return await devMintToken(licensee, tier, mode, daysValid);
      },
      isSidebarCollapsed: false,
      toggleSidebar: () => set((state) => {
        if (state.settings.lockExpandedSidebar) {
          return { isSidebarCollapsed: false };
        }
        return { isSidebarCollapsed: !state.isSidebarCollapsed };
      }),
      setSidebarCollapsed: (collapsed) => set((state) => {
        if (state.settings.lockExpandedSidebar && collapsed) {
          return { isSidebarCollapsed: false };
        }
        return { isSidebarCollapsed: collapsed };
      }),

      // Deletion Confirmation Modal
      deleteConfirmation: null,
      requestDelete: (config) => set({ deleteConfirmation: config }),
      closeDeleteConfirm: () => set({ deleteConfirmation: null }),
      
      // Tabs (VSCode / Chrome Browser style)
      tabs: [{ id: 'get-started', type: 'get-started', title: 'Home' }],
      activeTabId: 'get-started',
      openTab: (tabInput) => set((state) => {
        const SINGLETON_TYPES = ['get-started', 'archive', 'docs', 'samples', 'feedback', 'changelog'] as const;
        if (SINGLETON_TYPES.includes(tabInput.type as any)) {
          const existing = state.tabs.find(t => t.type === tabInput.type);
          if (existing) {
            return { activeTabId: existing.id };
          }
          const id = tabInput.id || `tab-${tabInput.type}`;
          const title = tabInput.title || (
            tabInput.type === 'get-started' ? 'Home' :
            tabInput.type === 'archive' ? 'Archive' :
            tabInput.type === 'docs' ? 'Documentation' :
            tabInput.type === 'samples' ? 'Sample Studies' :
            tabInput.type === 'feedback' ? 'Feedback & Reports' :
            'Changelog'
          );
          const newTab: AppTab = { ...tabInput, id, title };
          return { tabs: [...state.tabs, newTab], activeTabId: id };
        }
        
        if (tabInput.type === 'workspace' && tabInput.workspaceId) {
          const existing = state.tabs.find(t => t.type === 'workspace' && t.workspaceId === tabInput.workspaceId);
          if (existing) {
            return { activeTabId: existing.id, activeWorkspaceId: tabInput.workspaceId };
          }
          const id = tabInput.id || `tab-ws-${tabInput.workspaceId}`;
          const newTab: AppTab = {
            id,
            type: 'workspace',
            title: tabInput.title || 'Workspace',
            workspaceId: tabInput.workspaceId,
          };
          return {
            tabs: [...state.tabs, newTab],
            activeTabId: id,
            activeWorkspaceId: tabInput.workspaceId,
          };
        }

        if (tabInput.type === 'model' && tabInput.modelId) {
          const existing = state.tabs.find(t => t.type === 'model' && t.modelId === tabInput.modelId);
          if (existing) {
            return {
              activeTabId: existing.id,
              activeModelId: tabInput.modelId,
              activeStudyId: tabInput.studyId ?? state.activeStudyId,
              activeWorkspaceId: tabInput.workspaceId ?? state.activeWorkspaceId,
            };
          }
          const id = tabInput.id || `tab-model-${tabInput.modelId}`;
          const newTab: AppTab = {
            id,
            type: 'model',
            title: tabInput.title || 'Model',
            workspaceId: tabInput.workspaceId,
            studyId: tabInput.studyId,
            modelId: tabInput.modelId,
          };
          return {
            tabs: [...state.tabs, newTab],
            activeTabId: id,
            activeModelId: tabInput.modelId,
            activeStudyId: tabInput.studyId ?? state.activeStudyId,
            activeWorkspaceId: tabInput.workspaceId ?? state.activeWorkspaceId,
          };
        }

        if (tabInput.type === 'dataset' && tabInput.studyId) {
          const existing = state.tabs.find(
            t => t.type === 'dataset' &&
                 t.studyId === tabInput.studyId &&
                 (tabInput.datasetId ? t.datasetId === tabInput.datasetId : true)
          );
          if (existing) {
            return {
              activeTabId: existing.id,
              activeStudyId: tabInput.studyId,
              activeWorkspaceId: tabInput.workspaceId ?? state.activeWorkspaceId,
            };
          }
          const id = tabInput.id || (tabInput.datasetId ? `tab-dataset-${tabInput.studyId}-${tabInput.datasetId}` : `tab-dataset-${tabInput.studyId}`);
          const newTab: AppTab = {
            id,
            type: 'dataset',
            title: tabInput.title || 'Dataset',
            workspaceId: tabInput.workspaceId,
            studyId: tabInput.studyId,
            datasetId: tabInput.datasetId,
          };
          return {
            tabs: [...state.tabs, newTab],
            activeTabId: id,
            activeStudyId: tabInput.studyId,
            activeWorkspaceId: tabInput.workspaceId ?? state.activeWorkspaceId,
          };
        }

        if (tabInput.type === 'snapshot' && tabInput.snapshotId) {
          const existing = state.tabs.find(t => t.type === 'snapshot' && t.snapshotId === tabInput.snapshotId);
          if (existing) {
            return {
              activeTabId: existing.id,
              activeStudyId: tabInput.studyId ?? state.activeStudyId,
              activeWorkspaceId: tabInput.workspaceId ?? state.activeWorkspaceId,
            };
          }
          const id = tabInput.id || `tab-snapshot-${tabInput.snapshotId}`;
          const newTab: AppTab = {
            id,
            type: 'snapshot',
            title: tabInput.title || 'Snapshot',
            workspaceId: tabInput.workspaceId,
            studyId: tabInput.studyId,
            snapshotId: tabInput.snapshotId,
          };
          return {
            tabs: [...state.tabs, newTab],
            activeTabId: id,
            activeStudyId: tabInput.studyId ?? state.activeStudyId,
            activeWorkspaceId: tabInput.workspaceId ?? state.activeWorkspaceId,
          };
        }

        const id = tabInput.id || `tab-${Date.now()}`;
        const newTab: AppTab = { ...tabInput, id };
        return { tabs: [...state.tabs, newTab], activeTabId: id };
      }),
      closeTab: (id) => set((state) => {
        const index = state.tabs.findIndex(t => t.id === id);
        if (index === -1) return state;

        const newTabs = state.tabs.filter(t => t.id !== id);
        if (newTabs.length === 0) {
          const homeTab: AppTab = { id: 'get-started', type: 'get-started', title: 'Home' };
          return { tabs: [homeTab], activeTabId: 'get-started' };
        }

        let nextActiveId = state.activeTabId;
        let nextWsId = state.activeWorkspaceId;
        let nextStudyId = state.activeStudyId;
        let nextModelId = state.activeModelId;

        if (state.activeTabId === id) {
          const nextTab = newTabs[Math.max(0, Math.min(index, newTabs.length - 1))];
          nextActiveId = nextTab.id;
          if (nextTab.type === 'workspace' && nextTab.workspaceId) {
            nextWsId = nextTab.workspaceId;
          } else if (nextTab.type === 'model') {
            nextModelId = nextTab.modelId ?? null;
            nextStudyId = nextTab.studyId ?? null;
            nextWsId = nextTab.workspaceId ?? null;
          } else if (nextTab.type === 'dataset') {
            nextStudyId = nextTab.studyId ?? null;
            nextWsId = nextTab.workspaceId ?? null;
          }
        }

        return {
          tabs: newTabs,
          activeTabId: nextActiveId,
          activeWorkspaceId: nextWsId,
          activeStudyId: nextStudyId,
          activeModelId: nextModelId,
        };
      }),
      closeTabs: (ids) => set((state) => {
        if (!ids || ids.length === 0) return state;
        const idsSet = new Set(ids);
        const newTabs = state.tabs.filter((t) => !idsSet.has(t.id));

        if (newTabs.length === 0) {
          const homeTab: AppTab = { id: 'get-started', type: 'get-started', title: 'Home' };
          return {
            tabs: [homeTab],
            activeTabId: 'get-started',
            activeWorkspaceId: null,
            activeStudyId: null,
            activeModelId: null,
          };
        }

        let nextActiveId = state.activeTabId;
        let nextWsId = state.activeWorkspaceId;
        let nextStudyId = state.activeStudyId;
        let nextModelId = state.activeModelId;

        if (state.activeTabId && idsSet.has(state.activeTabId)) {
          const oldIndex = state.tabs.findIndex((t) => t.id === state.activeTabId);
          const nextTab = newTabs[Math.max(0, Math.min(oldIndex, newTabs.length - 1))];
          nextActiveId = nextTab.id;
          if (nextTab.type === 'workspace' && nextTab.workspaceId) {
            nextWsId = nextTab.workspaceId;
          } else if (nextTab.type === 'model') {
            nextModelId = nextTab.modelId ?? null;
            nextStudyId = nextTab.studyId ?? null;
            nextWsId = nextTab.workspaceId ?? null;
          } else if (nextTab.type === 'dataset') {
            nextStudyId = nextTab.studyId ?? null;
            nextWsId = nextTab.workspaceId ?? null;
          } else {
            nextWsId = null;
            nextStudyId = null;
            nextModelId = null;
          }
        }

        return {
          tabs: newTabs,
          activeTabId: nextActiveId,
          activeWorkspaceId: nextWsId,
          activeStudyId: nextStudyId,
          activeModelId: nextModelId,
        };
      }),
      setActiveTab: (id) => set((state) => {
        const tab = state.tabs.find(t => t.id === id);
        if (!tab) return state;
        let nextWs = state.activeWorkspaceId;
        let nextStudy = state.activeStudyId;
        let nextModel = state.activeModelId;
        if (tab.type === 'workspace' && tab.workspaceId) {
          nextWs = tab.workspaceId;
        } else if (tab.type === 'model') {
          if (tab.workspaceId) nextWs = tab.workspaceId;
          if (tab.studyId) nextStudy = tab.studyId;
          if (tab.modelId) nextModel = tab.modelId;
        } else if (tab.type === 'dataset') {
          if (tab.workspaceId) nextWs = tab.workspaceId;
          if (tab.studyId) nextStudy = tab.studyId;
        }
        return {
          activeTabId: id,
          activeWorkspaceId: nextWs,
          activeStudyId: nextStudy,
          activeModelId: nextModel,
        };
      }),
      updateTabTitle: (id, title) => set((state) => ({
        tabs: state.tabs.map(t => t.id === id ? { ...t, title } : t)
      })),
      reorderTabs: (fromIndex, toIndex) => set((state) => {
        const tabs = [...state.tabs];
        const [moved] = tabs.splice(fromIndex, 1);
        tabs.splice(toIndex, 0, moved);
        return { tabs };
      }),

      // Workspaces & Studies
      workspaces: INITIAL_WORKSPACES,
      archivedWorkspaces: [],
      activeWorkspaceId: null,
      studies: INITIAL_STUDIES,
      activeStudyId: null,
      models: INITIAL_MODELS,
      datasetsByStudy: {},
      snapshotsByStudy: {},
      setStudySnapshots: (studyId, snapshots) =>
        set((state) => ({
          snapshotsByStudy: { ...state.snapshotsByStudy, [studyId]: snapshots },
        })),
      addStudySnapshot: (studyId, snapshot) =>
        set((state) => {
          const current = state.snapshotsByStudy[studyId] || [];
          return {
            snapshotsByStudy: {
              ...state.snapshotsByStudy,
              [studyId]: [snapshot, ...current.filter((s) => s.id !== snapshot.id)],
            },
          };
        }),
      removeStudySnapshot: (studyId, snapshotId) =>
        set((state) => ({
          snapshotsByStudy: {
            ...state.snapshotsByStudy,
            [studyId]: (state.snapshotsByStudy[studyId] || []).filter((s) => s.id !== snapshotId),
          },
        })),
      activeModelId: null,
      addModel: (model) => set((state) => ({ models: [...state.models, model] })),
      removeModel: (id) => set((state) => ({ models: state.models.filter(model => model.id !== id) })),
      renameModel: (id, name) => set((state) => ({
        models: state.models.map(model => model.id === id ? { ...model, name, lastModified: 'Just now' } : model),
        tabs: state.tabs.map(tab => tab.type === 'model' && tab.modelId === id ? { ...tab, title: name } : tab),
      })),
      duplicateModel: (id) => {
        const state = get();
        const model = state.models.find(item => item.id === id);
        if (!model) return;
        const newModelId = `model_${Date.now()}`;
        const newModelName = `${model.name} copy`;
        const duplicatedModel: Model = {
          ...model,
          id: newModelId,
          name: newModelName,
          lastModified: 'Just now'
        };

        const study = state.studies.find(s => s.id === model.studyId);
        if (study && study.path) {
          api.duplicateModel(study.path, id, newModelId).catch(console.warn);
        }

        set({ models: [...state.models, duplicatedModel] });
      },
      setActiveModel: (id) => set({ activeModelId: id }),

      addWorkspace: (ws) => set((state) => ({ 
        workspaces: [...state.workspaces, ws],
        activeWorkspaceId: ws.id 
      })),
      duplicateWorkspace: async (id) => {
        const state = get();
        const ws = state.workspaces.find(w => w.id === id);
        if (!ws) return;
        const newName = `${ws.name} copy`;
        let targetPath = ws.path;
        if (ws.path) {
          try {
            const res = await api.duplicateWorkspace(ws.path, newName);
            if (res && res.workspace_path) {
              targetPath = res.workspace_path;
            }
          } catch (err) {
            console.warn('Could not duplicate workspace on disk:', err);
          }
        }
        const newWsId = targetPath;
        const sourceStudies = state.studies.filter(s => s.workspaceId === id);
        const newStudies: Study[] = [];
        const newModels: Model[] = [];
        const newDatasetsByStudy: Record<string, ParsedDataset[]> = {};

        for (const s of sourceStudies) {
          const newStudyId = `study_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          const fileName = s.path ? s.path.replace(/\\/g, '/').split('/').pop() : `${s.name}.pls`;
          const newStudyPath = targetPath ? `${targetPath.replace(/[/\\]+$/, '')}/${fileName}` : s.path;

          newStudies.push({
            ...s,
            id: newStudyId,
            workspaceId: newWsId,
            path: newStudyPath,
            lastModified: 'Just now',
          });

          const studyModels = state.models.filter(m => m.studyId === s.id);
          const modelIdMap: Record<string, string> = {};
          studyModels.forEach((m, idx) => {
            const newModelId = `model_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 5)}`;
            modelIdMap[m.id] = newModelId;
            newModels.push({
              ...m,
              id: newModelId,
              studyId: newStudyId,
              lastModified: 'Just now',
            });
          });

          if (newStudyPath && Object.keys(modelIdMap).length > 0) {
            api.remapModelIds(newStudyPath, modelIdMap).catch(console.warn);
          }

          const sDatasets = getStudyDatasets(state.datasetsByStudy, s.id);
          if (sDatasets.length > 0) {
            newDatasetsByStudy[newStudyId] = sDatasets.map((dataset) => ({
              ...dataset,
              variables: dataset.variables.map((v) => ({ ...v })),
              rows: dataset.rows.map((r) => [...r]),
            }));
          }
        }

        set((curr) => ({
          workspaces: [...curr.workspaces, { ...ws, id: newWsId, name: newName, path: targetPath }],
          studies: [...curr.studies, ...newStudies],
          models: [...curr.models, ...newModels],
          datasetsByStudy: { ...curr.datasetsByStudy, ...newDatasetsByStudy },
          activeWorkspaceId: newWsId,
        }));

        state.openTab({
          type: 'workspace',
          title: newName,
          workspaceId: newWsId,
        });
      },
      removeWorkspace: (id) => set((state) => ({
        workspaces: state.workspaces.filter(w => w.id !== id),
        activeWorkspaceId: state.activeWorkspaceId === id ? (state.workspaces.find(w => w.id !== id)?.id || null) : state.activeWorkspaceId,
        studies: state.studies.filter(s => s.workspaceId !== id),
        datasetsByStudy: Object.fromEntries(Object.entries(state.datasetsByStudy).filter(([studyId]) => state.studies.find(study => study.id === studyId)?.workspaceId !== id)),
      })),
      archiveWorkspace: async (id) => {
        const state = get();
        const workspace = state.workspaces.find(item => item.id === id);
        if (!workspace) return;

        let newPath = workspace.path;
        let originalPath = workspace.path;
        if (workspace.path) {
          try {
            const res = await api.archiveWorkspace(workspace.path);
            if (res && res.new_path) {
              newPath = res.new_path;
              originalPath = res.old_path || workspace.path;
            }
          } catch (err) {
            console.warn('Could not physically archive workspace:', err);
          }
        }

        const nextActiveId = state.activeWorkspaceId === id ? (state.workspaces.find(item => item.id !== id)?.id || null) : state.activeWorkspaceId;
        const now = new Date().toISOString();

        set((curr) => ({
          workspaces: curr.workspaces.filter(item => item.id !== id),
          archivedWorkspaces: [
            ...curr.archivedWorkspaces.filter(item => item.id !== id && item.id !== newPath),
            { ...workspace, id: newPath, path: newPath, originalPath, archivedAt: now }
          ],
          activeWorkspaceId: nextActiveId,
          studies: curr.studies.map(s => s.workspaceId === id ? { ...s, workspaceId: newPath } : s),
        }));
      },
      restoreWorkspace: async (id) => {
        const state = get();
        const workspace = state.archivedWorkspaces.find(item => item.id === id);
        if (!workspace) return;

        let restoredPath = workspace.originalPath || workspace.path;
        if (workspace.path) {
          try {
            const res = await api.restoreWorkspace(workspace.path);
            if (res && res.new_path) {
              restoredPath = res.new_path;
            }
          } catch (err) {
            console.warn('Could not physically restore workspace:', err);
          }
        }

        set((curr) => ({
          workspaces: [
            ...curr.workspaces.filter(item => item.id !== restoredPath),
            { ...workspace, id: restoredPath, path: restoredPath, originalPath: undefined, archivedAt: undefined }
          ],
          archivedWorkspaces: curr.archivedWorkspaces.filter(item => item.id !== id),
          studies: curr.studies.map(s => s.workspaceId === id ? { ...s, workspaceId: restoredPath } : s),
        }));
      },
      deleteWorkspace: async (id) => {
        const state = get();
        const ws = state.workspaces.find(w => w.id === id) || state.archivedWorkspaces.find(w => w.id === id);
        if (ws?.path) {
          try {
            await api.deleteWorkspace(ws.path);
          } catch (err) {
            console.warn('Could not delete workspace on disk:', err);
          }
        }
        const workspaceStudies = state.studies.filter(study => study.workspaceId === id);
        const studyIds = new Set(workspaceStudies.map(study => study.id));
        const remainingTabs = state.tabs.filter(tab => tab.workspaceId !== id);
        const nextTabs = remainingTabs.length > 0 ? remainingTabs : [{ id: 'get-started', type: 'get-started' as const, title: 'Home' }];
        const nextActiveTabId = nextTabs.some(t => t.id === state.activeTabId) ? state.activeTabId : nextTabs[0].id;
        set((curr) => ({
          workspaces: curr.workspaces.filter(item => item.id !== id),
          archivedWorkspaces: curr.archivedWorkspaces.filter(item => item.id !== id),
          studies: curr.studies.filter(study => study.workspaceId !== id),
          models: curr.models.filter(model => !studyIds.has(model.studyId)),
          datasetsByStudy: Object.fromEntries(Object.entries(curr.datasetsByStudy).filter(([studyId]) => !studyIds.has(studyId))),
          activeWorkspaceId: curr.activeWorkspaceId === id ? curr.workspaces.find(item => item.id !== id)?.id ?? null : curr.activeWorkspaceId,
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
        }));
      },
      deleteStudy: (id) => {
        const state = get();
        const study = state.studies.find(item => item.id === id);
        if (study?.path) {
          const ws = state.workspaces.find(w => w.id === study.workspaceId);
          if (ws?.path) {
            const filename = study.path.split(/[/\\]/).pop();
            if (filename) {
              if (study.isArchived) {
                api.deleteArchivedProject(ws.path, filename).catch(console.warn);
              } else {
                api.deleteProject(ws.path, filename).catch(console.warn);
              }
            }
          }
        }
        const remainingTabs = state.tabs.filter(tab => tab.studyId !== id);
        const nextTabs = remainingTabs.length > 0 ? remainingTabs : [{ id: 'get-started', type: 'get-started' as const, title: 'Home' }];
        const nextActiveTabId = nextTabs.some(t => t.id === state.activeTabId) ? state.activeTabId : nextTabs[0].id;
        set({
          studies: state.studies.filter(item => item.id !== id),
          models: state.models.filter(model => model.studyId !== id),
          datasetsByStudy: Object.fromEntries(Object.entries(state.datasetsByStudy).filter(([studyId]) => studyId !== id)),
          activeStudyId: state.activeStudyId === id ? null : state.activeStudyId,
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
        });
      },
      archiveStudy: async (id) => {
        const state = get();
        const study = state.studies.find(s => s.id === id);
        if (!study) return;

        const remainingTabs = state.tabs.filter(tab => tab.studyId !== id);
        const nextTabs = remainingTabs.length > 0 ? remainingTabs : [{ id: 'get-started', type: 'get-started' as const, title: 'Home' }];
        const nextActiveTabId = nextTabs.some(t => t.id === state.activeTabId) ? state.activeTabId : nextTabs[0].id;

        const now = new Date().toISOString();
        set({
          studies: state.studies.map(s => s.id === id ? { ...s, isArchived: true, archivedAt: now, isPinned: false } : s),
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
        });

        if (study.path) {
          const ws = state.workspaces.find(w => w.id === study.workspaceId);
          if (ws?.path) {
            try {
              const res = await api.archiveProject(ws.path, study.path);
              if (res?.new_path) {
                const newPath = res.new_path;
                set((curr) => ({
                  studies: curr.studies.map((s) => s.id === id ? { ...s, path: newPath } : s),
                }));
              }
            } catch (err) {
              console.warn('Could not archive project on disk:', err);
            }
          }
        }
      },
      restoreStudy: async (id) => {
        const state = get();
        const study = state.studies.find(s => s.id === id);
        if (!study) return;

        set({
          studies: state.studies.map(s => s.id === id ? { ...s, isArchived: false, archivedAt: undefined } : s),
        });

        if (study.path) {
          const ws = state.workspaces.find(w => w.id === study.workspaceId);
          if (ws?.path) {
            try {
              const res = await api.restoreProject(ws.path, study.path);
              if (res?.new_path) {
                const newPath = res.new_path;
                set((curr) => ({
                  studies: curr.studies.map((s) => s.id === id ? { ...s, path: newPath } : s),
                }));
              }
            } catch (err) {
              console.warn('Could not restore project on disk:', err);
            }
          }
        }
      },
      deleteModel: (id) => set((state) => {
        const remainingTabs = state.tabs.filter(tab => tab.modelId !== id);
        const nextTabs = remainingTabs.length > 0 ? remainingTabs : [{ id: 'get-started', type: 'get-started' as const, title: 'Home' }];
        const nextActiveTabId = nextTabs.some(t => t.id === state.activeTabId) ? state.activeTabId : nextTabs[0].id;
        return {
          models: state.models.filter(item => item.id !== id),
          activeModelId: state.activeModelId === id ? null : state.activeModelId,
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
        };
      }),
      renameWorkspace: (id, name) => set((state) => ({
        workspaces: state.workspaces.map(workspace => workspace.id === id ? { ...workspace, name } : workspace),
        tabs: state.tabs.map(tab => tab.type === 'workspace' && tab.workspaceId === id ? { ...tab, title: name } : tab),
      })),
      togglePinWorkspace: (id) => set((state) => ({
        workspaces: state.workspaces.map(w => w.id === id ? { ...w, isPinned: !w.isPinned } : w),
      })),
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
      addStudy: (study) => set((state) => {
        // If it's the exact same study by ID or non-empty path, update it in place
        const existingIdx = state.studies.findIndex(
          s => s.id === study.id || (Boolean(study.path) && Boolean(s.path) && s.path === study.path)
        );
        if (existingIdx >= 0) {
          const updated = [...state.studies];
          updated[existingIdx] = { ...updated[existingIdx], ...study };
          return {
            studies: updated,
            activeStudyId: study.id
          };
        }

        // It's a new study; ensure unique name within the target workspace
        let uniqueName = study.name.trim();
        const wsStudies = state.studies.filter(s => s.workspaceId === study.workspaceId);
        const existingNames = new Set(wsStudies.map(s => s.name.trim().toLowerCase()));

        if (existingNames.has(uniqueName.toLowerCase())) {
          const match = uniqueName.match(/^(.*?)(?:\s*\(([0-9]+)\))?$/);
          const base = match ? match[1].trim() : uniqueName;
          let counter = 1;
          while (existingNames.has(`${base}(${counter})`.toLowerCase())) {
            counter++;
          }
          uniqueName = `${base}(${counter})`;
        }

        const studyWithUniqueName = uniqueName !== study.name ? { ...study, name: uniqueName } : study;

        return {
          studies: [...state.studies, studyWithUniqueName],
          activeStudyId: studyWithUniqueName.id
        };
      }),
      syncWorkspaceStudies: (workspaceId, diskProjects) => set((state) => {
        const otherStudies = state.studies.filter(s => s.workspaceId !== workspaceId);
        const currentStudies = state.studies.filter(s => s.workspaceId === workspaceId);

        const merged: Study[] = [];
        const seenKeys = new Set<string>();

        for (const dp of diskProjects) {
          const key = (dp.fullPath || dp.path || dp.name).toLowerCase();
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          const existing = currentStudies.find(
            s => s.id === dp.fullPath || s.path === dp.fullPath || s.name.toLowerCase() === dp.name.toLowerCase()
          );

          if (existing) {
            merged.push({
              ...existing,
              id: existing.id || dp.fullPath,
              name: dp.name,
              path: dp.fullPath,
              isArchived: dp.isArchived !== undefined ? dp.isArchived : existing.isArchived,
              archivedAt: dp.archivedAt !== undefined ? dp.archivedAt : existing.archivedAt,
            });
          } else {
            merged.push({
              id: dp.fullPath,
              workspaceId,
              name: dp.name,
              type: 'PLS-SEM',
              description: '',
              lastModified: dp.isArchived ? 'Archived' : 'Saved',
              path: dp.fullPath,
              isArchived: dp.isArchived || false,
              archivedAt: dp.archivedAt,
            });
          }
        }

        return {
          studies: [...otherStudies, ...merged]
        };
      }),
      removeStudy: (id) => set((state) => ({
        studies: state.studies.filter(s => s.id !== id),
        activeStudyId: state.activeStudyId === id ? null : state.activeStudyId,
        models: state.models.filter(m => m.studyId !== id),
        datasetsByStudy: Object.fromEntries(Object.entries(state.datasetsByStudy).filter(([studyId]) => studyId !== id)),
      })),
      renameStudy: (id, name) => set((state) => ({ studies: state.studies.map(study => study.id === id ? { ...study, name, lastModified: 'Just now' } : study) })),
      duplicateStudy: async (id) => {
        const state = get();
        const study = state.studies.find(item => item.id === id);
        if (!study) return;
        const studyId = `study_${Date.now()}`;
        const newStudyName = `${study.name} copy`;
        const sourceDatasets = getStudyDatasets(state.datasetsByStudy, id);

        const studyModels = state.models.filter(m => m.studyId === id);
        const modelIdMap: Record<string, string> = {};
        const clonedModels = studyModels.map(m => {
          const newModelId = `model_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          modelIdMap[m.id] = newModelId;
          return {
            ...m,
            id: newModelId,
            studyId,
            name: `${m.name} copy`,
            lastModified: 'Just now'
          };
        });

        let targetPath = study.path;
        const currentWs = state.workspaces.find(w => w.id === study.workspaceId);
        if (study.path && currentWs && currentWs.path) {
          try {
            const res = await api.duplicateProject(currentWs.path, study.path, newStudyName, modelIdMap);
            if (res && res.project_path) {
              targetPath = res.project_path;
            }
          } catch (err) {
            console.warn('Could not duplicate project file on disk:', err);
          }
        }

        set((curr) => ({
          studies: [...curr.studies, { ...study, id: studyId, name: newStudyName, path: targetPath, lastModified: 'Just now' }],
          models: [...curr.models, ...clonedModels],
          datasetsByStudy: sourceDatasets.length > 0 ? {
            ...curr.datasetsByStudy,
            [studyId]: sourceDatasets.map((dataset) => ({
              ...dataset,
              variables: dataset.variables.map((variable) => ({ ...variable })),
              rows: dataset.rows.map((row) => [...row]),
            })),
          } : curr.datasetsByStudy,
        }));
      },
      togglePinStudy: (id) => set((state) => ({
        studies: state.studies.map(s => s.id === id ? { ...s, isPinned: !s.isPinned } : s),
      })),
      moveStudyToWorkspace: async (studyId, targetWorkspaceId, targetWorkspacePath) => {
        const state = get();
        const study = state.studies.find((item) => item.id === studyId);
        if (!study) return { success: false, error: 'Study not found' };

        const sourceWs = state.workspaces.find((w) => w.id === study.workspaceId);
        const sourceWsPath = sourceWs?.path;
        if (!sourceWsPath) return { success: false, error: 'Source workspace path not found' };

        let targetPath = study.path;
        if (study.path && sourceWsPath && targetWorkspacePath) {
          try {
            const res = await api.moveProject(sourceWsPath, targetWorkspacePath, study.path, study.name);
            if (res?.error) {
              return { success: false, error: res.error };
            }
            if (res && res.project_path) {
              targetPath = res.project_path;
            }
          } catch (err: any) {
            console.warn('Could not move study file on disk:', err);
            return { success: false, error: err?.message || 'Failed to move study on disk' };
          }
        }

        set((curr) => ({
          studies: curr.studies.map((s) =>
            s.id === studyId
              ? {
                  ...s,
                  workspaceId: targetWorkspaceId,
                  path: targetPath,
                  lastModified: 'Just now',
                }
              : s
          ),
          tabs: curr.tabs.map((tab) =>
            tab.studyId === studyId
              ? {
                  ...tab,
                  workspaceId: targetWorkspaceId,
                }
              : tab
          ),
        }));

        return { success: true };
      },
      copyStudyToWorkspace: async (studyId, targetWorkspaceId, targetWorkspacePath, newStudyName) => {
        const state = get();
        const study = state.studies.find((item) => item.id === studyId);
        if (!study) return { success: false, error: 'Study not found' };

        const newStudyId = `study_${Date.now()}`;
        const dataset = state.datasetsByStudy[studyId];

        const studyModels = state.models.filter((m) => m.studyId === studyId);
        const modelIdMap: Record<string, string> = {};
        const clonedModels = studyModels.map((m) => {
          const newModelId = `model_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          modelIdMap[m.id] = newModelId;
          return {
            ...m,
            id: newModelId,
            studyId: newStudyId,
            name: m.name,
            lastModified: 'Just now',
          };
        });

        let targetPath = study.path;
        if (study.path && targetWorkspacePath) {
          try {
            const res = await api.duplicateProject(targetWorkspacePath, study.path, newStudyName, modelIdMap);
            if (res?.error) {
              return { success: false, error: res.error };
            }
            if (res && res.project_path) {
              targetPath = res.project_path;
            }
          } catch (err: any) {
            console.warn('Could not copy study file on disk:', err);
            return { success: false, error: err?.message || 'Failed to copy study file' };
          }
        }

        const sourceDatasets = getStudyDatasets(state.datasetsByStudy, studyId);
        set((curr) => ({
          studies: [
            ...curr.studies,
            {
              ...study,
              id: newStudyId,
              workspaceId: targetWorkspaceId,
              name: newStudyName,
              path: targetPath,
              lastModified: 'Just now',
            },
          ],
          models: [...curr.models, ...clonedModels],
          datasetsByStudy: sourceDatasets.length > 0
            ? {
                ...curr.datasetsByStudy,
                [newStudyId]: sourceDatasets.map((dataset) => ({
                  ...dataset,
                  variables: dataset.variables.map((variable) => ({ ...variable })),
                  rows: dataset.rows.map((row) => [...row]),
                })),
              }
            : curr.datasetsByStudy,
        }));

        return { success: true, newStudyId };
      },
      setActiveStudy: (id) => set({ activeStudyId: id }),
      setStudyDataset: (studyId, dataset) => set((state) => {
        const existing = getStudyDatasets(state.datasetsByStudy, studyId);
        const idx = existing.findIndex((d) => (d.id && d.id === dataset.id) || d.filename === dataset.filename);
        let updatedList: ParsedDataset[];
        if (idx >= 0) {
          updatedList = [...existing];
          updatedList[idx] = dataset;
        } else {
          updatedList = [...existing, dataset];
        }
        return {
          datasetsByStudy: { ...state.datasetsByStudy, [studyId]: updatedList },
        };
      }),
      addStudyDataset: (studyId, dataset) => set((state) => {
        const existing = getStudyDatasets(state.datasetsByStudy, studyId);
        const dsId = dataset.id || `ds_${Date.now()}`;
        const newDs = { ...dataset, id: dsId };
        return {
          datasetsByStudy: { ...state.datasetsByStudy, [studyId]: [...existing, newDs] },
        };
      }),
      setStudyDatasets: (studyId, datasets) => set((state) => ({
        datasetsByStudy: { ...state.datasetsByStudy, [studyId]: datasets },
      })),
      removeStudyDataset: (studyId, datasetId) => set((state) => {
        if (!datasetId) {
          return {
            datasetsByStudy: Object.fromEntries(
              Object.entries(state.datasetsByStudy).filter(([id]) => id !== studyId)
            ),
          };
        }
        const existing = getStudyDatasets(state.datasetsByStudy, studyId);
        const updatedList = existing.filter((d) => d.id !== datasetId && d.filename !== datasetId);
        return {
          datasetsByStudy: { ...state.datasetsByStudy, [studyId]: updatedList },
        };
      }),
      deleteDataset: (studyId, datasetId) => set((state) => {
        if (!datasetId) {
          return {
            datasetsByStudy: Object.fromEntries(
              Object.entries(state.datasetsByStudy).filter(([id]) => id !== studyId)
            ),
          };
        }
        const existing = getStudyDatasets(state.datasetsByStudy, studyId);
        const updatedList = existing.filter((d) => d.id !== datasetId && d.filename !== datasetId);
        return {
          datasetsByStudy: { ...state.datasetsByStudy, [studyId]: updatedList },
        };
      }),
      lastUsedDatasetByStudy: {},
      setStudyLastDatasetId: (studyId, datasetId) => set((state) => ({
        lastUsedDatasetByStudy: { ...state.lastUsedDatasetByStudy, [studyId]: datasetId }
      })),
      setModelDatasetId: (modelId, datasetId) => set((state) => {
        const model = state.models.find((m) => m.id === modelId);
        const studyId = model?.studyId;
        return {
          models: state.models.map((m) => m.id === modelId ? { ...m, datasetId } : m),
          lastUsedDatasetByStudy: studyId ? { ...state.lastUsedDatasetByStudy, [studyId]: datasetId } : state.lastUsedDatasetByStudy,
        };
      }),
      touchStudy: (id) => set((state) => ({ studies: state.studies.map(study => study.id === id ? { ...study, lastModified: 'Just now' } : study) })),
      
      // Variables
      variables: INITIAL_VARIABLES,
      
      // Canvas State
      nodes: [],
      edges: [],
      selectedIds: new Set(),
      mode: 'select',
      zoom: 1,
      pan: { x: 0, y: 0 },
      
      addNode: (node) => set((state) => ({ nodes: [...state.nodes, node] })),
      
      updateNode: (id, data) => set((state) => ({
        nodes: state.nodes.map(n => n.id === id ? { ...n, ...data } : n)
      })),
      
      removeNodes: (ids) => set((state) => ({
        nodes: state.nodes.filter(n => !ids.includes(n.id)),
        edges: state.edges.filter(e => !ids.includes(e.sourceId) && !ids.includes(e.targetId)),
        selectedIds: new Set([...state.selectedIds].filter(id => !ids.includes(id)))
      })),
      
      addEdge: (sourceId, targetId) => set((state) => {
        if (state.edges.some(e => e.sourceId === targetId && e.targetId === sourceId)) return state;
        if (state.edges.some(e => e.sourceId === sourceId && e.targetId === targetId)) return state;
        return { edges: [...state.edges, { id: `${sourceId}-${targetId}`, sourceId, targetId }] };
      }),
      
      removeEdges: (ids) => set((state) => ({
        edges: state.edges.filter(e => !ids.includes(e.id)),
        selectedIds: new Set([...state.selectedIds].filter(id => !ids.includes(id)))
      })),
      
      setMode: (mode) => set({ mode, selectedIds: new Set() }),
      setSelection: (ids) => set({ selectedIds: new Set(ids) }),
      clearSelection: () => set({ selectedIds: new Set() }),
      setZoom: (zoom) => set({ zoom }),
      setPan: (x, y) => set({ pan: { x, y } }),

      contextMenu: null,
      openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
      closeContextMenu: () => set({ contextMenu: null }),
    }),
    {
      name: 'cspls-storage', // name of the item in the storage (must be unique)
      storage: workspaceStorage,
      partialize: (state) => ({
        workspaces: state.workspaces,
        archivedWorkspaces: state.archivedWorkspaces,
        studies: state.studies,
        models: state.models,
        datasetsByStudy: state.datasetsByStudy,
        lastUsedDatasetByStudy: state.lastUsedDatasetByStudy,
        activeWorkspaceId: state.activeWorkspaceId,
        theme: state.theme,
        settings: state.settings,
        isSidebarCollapsed: state.isSidebarCollapsed,
        isLicenseActive: state.isLicenseActive,
      }), // only persist these fields
      merge: (persistedState: any, currentState: AppState) => ({
        ...currentState,
        ...persistedState,
        settings: {
          ...INITIAL_SETTINGS,
          ...(persistedState?.settings || {}),
        },
      }),
    }
  )
);

if (typeof window !== 'undefined') {
  (window as any).__useStore = useStore;
}

