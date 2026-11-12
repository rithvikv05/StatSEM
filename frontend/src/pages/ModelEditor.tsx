import { ModelCalculationModal } from '../components/ModelCalculationModal';
import type { ModelCalculationSettings } from '../components/ModelCalculationModal';
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, getStudyDatasets } from '../store';
import { initModelCanvas, exportModelSpec, getModelCanvasState, loadModelCanvasState, setCanvasResults, renderModelCanvas, clearModelCanvas, resetModelStyles, setCanvasDatasetColumns, updateModeratingEffect, deleteModeratingEffect, getSelectedModeratingEffect, hasInvalidLatentVariables, getCanvasGridColors } from '../utils/model-canvas';
import { BootstrapModal } from '../components/BootstrapModal';
import { AnalysisModal } from '../components/AnalysisModal';
import { ModelComparisonModal } from '../components/ModelComparisonModal';
import { CalculationMenu } from '../components/CalculationMenu';
import { ModelFitResults } from '../components/ModelFitResults';
import { ResultsNavigation } from '../components/ResultsNavigation';
import { SpecificIndirectResults } from '../components/SpecificIndirectResults';
import { RunDetails } from '../components/RunDetails';
import { hasRunDetails } from '../utils/run-details';
import { InlineAnalysisResults } from '../components/InlineAnalysisResults';
import RedundancyWizardModal from '../components/RedundancyWizardModal';
import { HypothesisTestingPanel } from '../components/HypothesisTestingPanel';
import { DiagramExportModal } from '../components/DiagramExportModal';
import { PermutationDialog } from '../mga/PermutationDialog';
import { MgaDialog } from '../mga/MgaDialog';
import type { ParsedDataset } from '../utils/dataset-parser';
import { parseDatasetFile, processData } from '../utils/dataset-parser';
import { api, type ValidationResponse } from '../utils/api';
import { formatNumber, formatPValue, normalizeDecimalDigits } from '../utils/number-format';

import {
  Upload, Trash2, RotateCcw, AlertTriangle, History, Check,
  GitCompare, Copy, Download
} from 'lucide-react';
import AppSidebar from '../components/AppSidebar';
import '../model-canvas.css';
import '../results.css';

interface TableHeaderToggleProps {
  label: React.ReactNode;
  mode: 'matrix' | 'list';
  onToggle: (mode: 'matrix' | 'list') => void;
}

const TableHeaderToggle: React.FC<TableHeaderToggleProps> = ({ label, mode, onToggle }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: '120px' }}>
    <span>{label}</span>
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        padding: '2px',
        backgroundColor: 'var(--color-bg-base)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: '5px',
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        title="Matrix View"
        onClick={(e) => { e.stopPropagation(); onToggle('matrix'); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2px 4px',
          borderRadius: '3px',
          border: 'none',
          backgroundColor: mode === 'matrix' ? 'var(--color-accent-subtle)' : 'transparent',
          color: mode === 'matrix' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
          cursor: 'pointer',
        }}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      </button>
      <button
        type="button"
        title="List View"
        onClick={(e) => { e.stopPropagation(); onToggle('list'); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2px 4px',
          borderRadius: '3px',
          border: 'none',
          backgroundColor: mode === 'list' ? 'var(--color-accent-subtle)' : 'transparent',
          color: mode === 'list' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
          cursor: 'pointer',
        }}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
      </button>
    </div>
  </div>
);

function isModelTopologyEqual(specA: any, specB: any): boolean {
  if (!specA || !specB) return false;

  // 1. Constructs: ID, measurement type, and attached indicators
  const cA = (specA.constructs || []).map((c: any) => {
    const rawType = typeof c.type === 'string' ? c.type : (c.type?.value || 'reflective');
    const inds = (c.indicators || []).slice().sort().join(',');
    return `${c.id}:${rawType.toLowerCase()}:${inds}`;
  }).sort();

  const cB = (specB.constructs || []).map((c: any) => {
    const rawType = typeof c.type === 'string' ? c.type : (c.type?.value || 'reflective');
    const inds = (c.indicators || []).slice().sort().join(',');
    return `${c.id}:${rawType.toLowerCase()}:${inds}`;
  }).sort();

  if (cA.length !== cB.length || cA.some((val: string, idx: number) => val !== cB[idx])) {
    return false;
  }

  // 2. Indicators
  const iA = (specA.indicators || []).map((i: any) => `${i.id}:${i.column || i.name || i.id}`).sort();
  const iB = (specB.indicators || []).map((i: any) => `${i.id}:${i.column || i.name || i.id}`).sort();
  if (iA.length !== iB.length || iA.some((val: string, idx: number) => val !== iB[idx])) {
    return false;
  }

  // 3. Paths (support both from/to and from_node/to_node)
  const pA = (specA.paths || []).map((p: any) => `${p.from || p.from_node}->${p.to || p.to_node}`).sort();
  const pB = (specB.paths || []).map((p: any) => `${p.from || p.from_node}->${p.to || p.to_node}`).sort();
  if (pA.length !== pB.length || pA.some((val: string, idx: number) => val !== pB[idx])) {
    return false;
  }

  return true;
}

const ModelEditor = () => {
  const navigate = useNavigate();
  const {
    workspaces,
    activeWorkspaceId,
    studies,
    activeStudyId,
    activeModelId,
    models,
    datasetsByStudy,
    setStudyDataset,
    addStudyDataset,
    setStudyDatasets,
    setModelDatasetId,
    lastUsedDatasetByStudy,
    setStudyLastDatasetId,
    touchStudy,
    openTab,
    addStudySnapshot,
    addStudyMgaReport,
    cacheMgaReport,
    addModel,
    setActiveModel,
    theme,
    settings,
    tabs,
    activeTabId,
  } = useStore();
  
  const currentTab = tabs.find(t => t.id === activeTabId);
  const effectiveModelId = currentTab?.modelId || activeModelId;
  const effectiveStudyId = currentTab?.studyId || activeStudyId;
  const activeWorkspace = workspaces.find(w => w.id === (currentTab?.workspaceId || activeWorkspaceId));
  const activeStudy = studies.find(s => s.id === effectiveStudyId);
  const activeModel = models.find(model => model.id === effectiveModelId);
  const isCanvasLoadingRef = useRef(true);

  const studyDatasets = useMemo(
    () => getStudyDatasets(datasetsByStudy, effectiveStudyId || ''),
    [datasetsByStudy, effectiveStudyId]
  );

  const canvasGridColors = useMemo(() => {
    return getCanvasGridColors(settings?.canvasBgColor);
  }, [settings?.canvasBgColor, theme, settings?.theme]);

  useEffect(() => {
    renderModelCanvas();
  }, [theme, settings?.theme, settings?.darkVariant]);

  const [currentView, setCurrentView] = useState<'model' | 'results'>('model');
  const [activeDataset, setActiveDataset] = useState<ParsedDataset | null>(() => {
    if (!effectiveStudyId) return null;
    const list = getStudyDatasets(datasetsByStudy, effectiveStudyId || '');
    if (activeModel?.datasetId) {
      const found = list.find(d => d.id === activeModel.datasetId);
      if (found) return found;
    }
    const lastUsedDsId = lastUsedDatasetByStudy[effectiveStudyId]
      || models.find(m => m.studyId === effectiveStudyId && m.datasetId)?.datasetId;
    if (lastUsedDsId) {
      const found = list.find(d => d.id === lastUsedDsId);
      if (found) return found;
    }
    if (list.length === 1) return list[0];
    return null;
  });

  const activeDatasetRef = useRef<ParsedDataset | null>(activeDataset);
  useEffect(() => {
    activeDatasetRef.current = activeDataset;
  }, [activeDataset]);

  const [isDatasetMenuOpen, setIsDatasetMenuOpen] = useState(false);
  const datasetDropdownRef = useRef<HTMLDivElement>(null);
  const datasetButtonRef = useRef<HTMLButtonElement>(null);

  const [isImporting, setIsImporting] = useState(false);
  const [isBootstrapModalOpen, setIsBootstrapModalOpen] = useState(false);
  const [bootstrapConsistent, setBootstrapConsistent] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelSettingsConsistent, setModelSettingsConsistent] = useState(false);
  const [isPermutationModalOpen, setIsPermutationModalOpen] = useState(false);
  const [isMgaModalOpen, setIsMgaModalOpen] = useState(false);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [analysisModalType, setAnalysisModalType] = useState<string>('predict');
  const [analysisResultsMap, setAnalysisResultsMap] = useState<Record<string, any>>({});
  const [availableAnalyses, setAvailableAnalyses] = useState<string[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState<Record<string, boolean>>({});
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>({});
  const [analysisStale, setAnalysisStale] = useState<Record<string, boolean>>({});
  const [latestAnalysis, setLatestAnalysis] = useState<{ id: string; revision: number }>();
  const analysisModelKey = `${activeStudy?.path || ''}::${effectiveModelId || 'default'}`;
  const analysisModelKeyRef = useRef(analysisModelKey);
  analysisModelKeyRef.current = analysisModelKey;
  useEffect(() => {
    let cancelled = false;
    setAnalysisResultsMap({});
    setAvailableAnalyses([]);
    setAnalysisLoading({});
    setAnalysisErrors({});
    setAnalysisStale({});
    setLatestAnalysis(undefined);
    if (activeStudy?.path) {
      void api.listProjectAnalyses(activeStudy.path, effectiveModelId || undefined).then(analyses => {
        if (!cancelled) setAvailableAnalyses(previous => Array.from(new Set([...previous, ...analyses])));
      });
    }
    return () => { cancelled = true; };
  }, [effectiveModelId, activeStudy?.path]);

  const loadAnalysis = async (id: string) => {
    if (!activeStudy?.path) return;
    const requestedModel = analysisModelKey;
    setAnalysisLoading(previous => ({ ...previous, [id]: true }));
    setAnalysisErrors(previous => ({ ...previous, [id]: '' }));
    const response = await api.loadProjectResults(activeStudy.path, 'pls', effectiveModelId || undefined, id);
    if (analysisModelKeyRef.current !== requestedModel) return;
    setAnalysisLoading(previous => ({ ...previous, [id]: false }));
    if (response?.results != null) {
      setAnalysisResultsMap(previous => ({ ...previous, [id]: response.results }));
      setAnalysisStale(previous => ({ ...previous, [id]: !!response.stale }));
    } else {
      setAnalysisErrors(previous => ({ ...previous, [id]: response?.error || 'Could not load this analysis.' }));
    }
  };
  const [variableFilter, setVariableFilter] = useState('');
  const [isVarSearchOpen, setIsVarSearchOpen] = useState(false);
  const [isCalcMenuOpen, setIsCalcMenuOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const [areCategoriesCollapsed, setAreCategoriesCollapsed] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [selectedVarNames, setSelectedVarNames] = useState<Set<string>>(new Set());
  const [lastSelectedVar, setLastSelectedVar] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const calcDropdownRef = useRef<HTMLDivElement>(null);
  const autoSaveTimerRef = useRef<any>(null);
  const [isRulesDrawerOpen, setIsRulesDrawerOpen] = useState(false);
  const [isGlossaryModalOpen, setIsGlossaryModalOpen] = useState(false);
  const [selectedModeration, setSelectedModeration] = useState<any | null>(null);

  const moderationHelper = useMemo(() => {
    if (!selectedModeration) return null;
    let canvasNodes: any[] = [];
    try {
      const state = getModelCanvasState();
      canvasNodes = state?.nodes || [];
    } catch (e) {}

    const modNode = canvasNodes.find((n: any) => n.id === selectedModeration.moderator);
    const predNode = canvasNodes.find((n: any) => n.id === selectedModeration.source);
    const outNode = canvasNodes.find((n: any) => n.id === selectedModeration.target);

    const modLabel = modNode?.label || selectedModeration.moderator;
    const predLabel = predNode?.label || selectedModeration.source;
    const outLabel = outNode?.label || selectedModeration.target;

    const isModSingleItem = (modNode?.indicators?.length ?? 1) === 1;
    const isPredMultiItem = (predNode?.indicators?.length ?? 1) > 1;
    const showWarning = isModSingleItem && isPredMultiItem && (selectedModeration.method === 'orthogonalizing' || selectedModeration.method === 'product_indicator');

    return {
      modLabel,
      predLabel,
      outLabel,
      isModSingleItem,
      isPredMultiItem,
      showWarning
    };
  }, [selectedModeration]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (calcDropdownRef.current && !calcDropdownRef.current.contains(e.target as Node)) {
        setIsCalcMenuOpen(false);
      }
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
      if (
        datasetDropdownRef.current &&
        !datasetDropdownRef.current.contains(e.target as Node) &&
        datasetButtonRef.current &&
        !datasetButtonRef.current.contains(e.target as Node)
      ) {
        setIsDatasetMenuOpen(false);
      }
    };
    if (isCalcMenuOpen || isDatasetMenuOpen || isExportMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCalcMenuOpen, isDatasetMenuOpen, isExportMenuOpen]);

  useEffect(() => {
    // Default to collapsed sidebar in canvas/results page to maximize space if not locked
    if (!useStore.getState().settings.lockExpandedSidebar) {
      useStore.getState().setSidebarCollapsed(true);
    }
  }, []);

  const [selectedNodeType, setSelectedNodeType] = useState<'latent' | 'indicator' | 'text'>('latent');

  const fixedFills = selectedNodeType === 'indicator'
    ? ['transparent', '#fef08a', '#ffffff']
    : ['transparent', '#334155', '#ffffff'];

  const fixedBorders = selectedNodeType === 'indicator'
    ? ['transparent', '#ca8a04', '#1e293b']
    : ['transparent', '#1e293b', '#ffffff'];

  const fixedTexts = selectedNodeType === 'indicator'
    ? ['#422006', '#0f172a', '#ffffff']
    : (selectedNodeType === 'latent' ? ['#ffffff', '#0f172a', '#334155'] : ['#0f172a', '#334155', '#ffffff']);

  const [recentFills, setRecentFills] = useState<string[]>([]);
  const [recentBorders, setRecentBorders] = useState<string[]>([]);
  const [recentTextColors, setRecentTextColors] = useState<string[]>([]);
  
  const [activeFill, setActiveFill] = useState<string>('#334155');
  const [activeBorder, setActiveBorder] = useState<string>('#1e293b');
  const [activeText, setActiveText] = useState<string>('#ffffff');

  const [activeBorderWeight, setActiveBorderWeight] = useState<number>(1.5);
  const [textboxAlign, setTextboxAlign] = useState<'left' | 'center' | 'right' | 'justify'>('center');
  const [textboxValign, setTextboxValign] = useState<'top' | 'middle' | 'bottom'>('middle');
  const [edgeLineStyle, setEdgeLineStyle] = useState<'solid' | 'dashed' | 'dotted' | 'curved'>('solid');
  const [edgeArrowhead, setEdgeArrowhead] = useState<'solid' | 'open' | 'diamond' | 'circle'>('solid');
  const [activeNodeShape, setActiveNodeShape] = useState<string>('circle');
  const [edgeStrokeWidth, setEdgeStrokeWidth] = useState<number>(1.5);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const fixedArrowColors = ['#0f172a', '#334155', '#ffffff'];
  const [recentArrowColors, setRecentArrowColors] = useState<string[]>([]);
  const [activeArrowColor, setActiveArrowColor] = useState<string>('#0f172a');

  const isDefaultColor = (color: string) => {
    if (!color) return true;
    const defaults = [
      'transparent',
      '#334155', '#1e293b', '#ffffff', '#0f172a', '#64748b',
      '#fef08a', '#ca8a04', '#422006', '#451a03', '#b45309'
    ];
    return defaults.some(d => d.toLowerCase() === color.toLowerCase());
  };

  const handleArrowColorSelect = (color: string) => {
    setActiveArrowColor(color);
    if (!isDefaultColor(color)) {
      setRecentArrowColors(prev => [...prev.filter(c => c.toLowerCase() !== color.toLowerCase()), color].slice(-3));
    }
    document.dispatchEvent(new CustomEvent('edge-color-change', { detail: { color } }));
  };

  const handleFillColorSelect = (color: string) => {
    setActiveFill(color);
    if (!isDefaultColor(color)) {
      setRecentFills(prev => [...prev.filter(c => c.toLowerCase() !== color.toLowerCase()), color].slice(-3));
    }
    document.dispatchEvent(new CustomEvent('color-picker-input', { detail: { id: 'picker-fill', color } }));
    document.dispatchEvent(new CustomEvent('color-picker-closed', { detail: { id: 'picker-fill', color } }));
  };

  const handleBorderColorSelect = (color: string) => {
    setActiveBorder(color);
    if (!isDefaultColor(color)) {
      setRecentBorders(prev => [...prev.filter(c => c.toLowerCase() !== color.toLowerCase()), color].slice(-3));
    }
    document.dispatchEvent(new CustomEvent('color-picker-input', { detail: { id: 'picker-border', color } }));
    document.dispatchEvent(new CustomEvent('color-picker-closed', { detail: { id: 'picker-border', color } }));
  };

  const handleTextColorSelect = (color: string) => {
    setActiveText(color);
    if (!isDefaultColor(color)) {
      setRecentTextColors(prev => [...prev.filter(c => c.toLowerCase() !== color.toLowerCase()), color].slice(-3));
    }
    document.dispatchEvent(new CustomEvent('color-picker-input', { detail: { id: 'picker-text', color } }));
    document.dispatchEvent(new CustomEvent('color-picker-closed', { detail: { id: 'picker-text', color } }));
  };

  useEffect(() => {
    const handleClose = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.tb-dropdown-container')) {
        setOpenDropdown(null);
      }
    };
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      if (typeof window !== 'undefined' && (window as any).getSelectedEdgeInfo) {
        const info = (window as any).getSelectedEdgeInfo();
        if (info) {
          if (info.lineStyle) setEdgeLineStyle(info.lineStyle);
          if (info.arrowhead) setEdgeArrowhead(info.arrowhead);
          if (info.color) setActiveArrowColor(info.color);
          if (info.strokeWidth !== undefined) setEdgeStrokeWidth(info.strokeWidth);
        }
      }
      if (typeof window !== 'undefined' && (window as any).getSelectedNodeInfo) {
        const nInfo = (window as any).getSelectedNodeInfo();
        if (nInfo) {
          setSelectedNodeType(nInfo.isText ? 'text' : (nInfo.isLatent ? 'latent' : 'indicator'));
          if (nInfo.strokeWidth !== undefined) setActiveBorderWeight(nInfo.strokeWidth);
          if (nInfo.shape) setActiveNodeShape(nInfo.shape);
          if (nInfo.textAlign) setTextboxAlign(nInfo.textAlign);
          if (nInfo.verticalAlign) setTextboxValign(nInfo.verticalAlign);
          if (nInfo.fill) setActiveFill(nInfo.fill);
          if (nInfo.stroke) setActiveBorder(nInfo.stroke);
          if (nInfo.color) setActiveText(nInfo.color);
        }
      }
    };
    window.addEventListener('selectionChange', handleSelectionChange);
    document.addEventListener('selectionChange', handleSelectionChange);
    return () => {
      window.removeEventListener('selectionChange', handleSelectionChange);
      document.removeEventListener('selectionChange', handleSelectionChange);
    };
  }, []);

  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'error' | null>('saved');
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [validationModal, setValidationModal] = useState<ValidationResponse | null>(null);
  const [validationSuccessToast, setValidationSuccessToast] = useState<string | null>(null);
  const [plsResults, setPlsResults] = useState<any>(null);
  const plsResultsRef = useRef<any>(null);
  const [activeResultTab, setActiveResultTab] = useState<string>('path_coefficients');
  const [tableModes, setTableModes] = useState<Record<string, 'matrix' | 'list'>>({
    path_coefficients: 'matrix',
    total_indirect_effects: 'matrix',
    total_effects: 'matrix',
    outer_loadings: 'matrix',
    outer_weights: 'matrix',
    f_squared: 'matrix',
    htmt: 'matrix',
  });

  const getTableMode = (key: string): 'matrix' | 'list' => tableModes[key] || 'matrix';
  const setTableMode = (key: string, mode: 'matrix' | 'list') => {
    setTableModes(prev => ({ ...prev, [key]: mode }));
  };

  // Canvas HUD confirmation popovers ('reset' | 'clear' | null)
  const [hudConfirm, setHudConfirm] = useState<'reset' | 'clear' | null>(null);

  // Model Outdated & Revert Tracking
  const [isModelOutdated, setIsModelOutdated] = useState(false);
  const [lastCalculatedModel, setLastCalculatedModel] = useState<{ spec: any; layout: any } | null>(null);
  const lastCalculatedModelRef = useRef<{ spec: any; layout: any } | null>(null);

  // Live Auto-Recalculate After First Calculation
  const [hasCalculatedOnce, setHasCalculatedOnce] = useState(false);
  const hasCalculatedOnceRef = useRef(false);
  const isAutoCalculatingRef = useRef(false);

  // Snapshot modal state
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);

  // Redundancy Analysis Wizard state
  const [isRedundancyWizardOpen, setIsRedundancyWizardOpen] = useState(false);
  const [wizardTargetConstructId, setWizardTargetConstructId] = useState<string | null>(null);

  useEffect(() => {
    (window as any)._openRedundancyWizard = (constructId: string) => {
      setWizardTargetConstructId(constructId);
      setIsRedundancyWizardOpen(true);
    };
    return () => {
      delete (window as any)._openRedundancyWizard;
    };
  }, []);
  const [snapshotName, setSnapshotName] = useState('');
  const [snapshotTargetStudyId, setSnapshotTargetStudyId] = useState<string>('');
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  useEffect(() => {
    (window as any).openExportDiagramModal = () => setIsExportModalOpen(true);
    (window as any)._customClearCanvasHandler = (e: any) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      setHudConfirm('clear');
    };
    (window as any)._customResetStylesHandler = (e: any) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      setHudConfirm('reset');
    };
    return () => {
      delete (window as any)._customClearCanvasHandler;
      delete (window as any)._customResetStylesHandler;
    };
  }, []);

  // Auto-close confirmation popups when tapping/clicking outside (e.g. on canvas) or pressing Escape
  useEffect(() => {
    if (!hudConfirm) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest('.canvas-hud-confirm-popover') ||
        target.closest('#hud-reset') ||
        target.closest('#hud-clear')
      ) {
        return;
      }
      setHudConfirm(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHudConfirm(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hudConfirm]);


  useEffect(() => {
    if (!effectiveStudyId) {
      setActiveDataset(null);
      activeDatasetRef.current = null;
      return;
    }

    const currentDatasets = getStudyDatasets(datasetsByStudy, effectiveStudyId || '');

    if (currentDatasets.length > 0) {
      // 1. If model has an assigned datasetId, use it
      if (activeModel?.datasetId) {
        const found = currentDatasets.find(d => d.id === activeModel.datasetId);
        if (found) {
          setActiveDataset(found);
          activeDatasetRef.current = found;
          return;
        }
      }

      // 2. If study has a last-used dataset or any model in this study used a dataset, or only 1 dataset, remember and use it!
      const lastUsedDsId = lastUsedDatasetByStudy[effectiveStudyId]
        || models.find(m => m.studyId === effectiveStudyId && m.datasetId)?.datasetId;
      const fallbackDs = (lastUsedDsId && currentDatasets.find(d => d.id === lastUsedDsId))
        || (currentDatasets.length === 1 ? currentDatasets[0] : null);

      if (fallbackDs) {
        setActiveDataset(fallbackDs);
        activeDatasetRef.current = fallbackDs;
        if (effectiveModelId && fallbackDs.id) {
          setModelDatasetId(effectiveModelId, fallbackDs.id);
        }
        return;
      }

      // 3. Otherwise (multiple datasets and none chosen yet for this study), show picker
      setActiveDataset(null);
      activeDatasetRef.current = null;
      return;
    }

    // If store has no datasets for this study yet, try to load from backend SQLite
    if (activeStudy?.path) {
      api.listProjectDatasets(activeStudy.path).then(async (res) => {
        if (res && Array.isArray(res.datasets) && res.datasets.length > 0) {
          const loaded: ParsedDataset[] = [];
          for (const summary of res.datasets) {
            try {
              const dataRes = await api.loadProjectData(activeStudy.path, summary.id);
              if (dataRes && Array.isArray(dataRes.columns) && Array.isArray(dataRes.rows)) {
                const parsed = processData(dataRes.dataset_name || summary.name || 'Dataset', dataRes.columns, dataRes.rows);
                parsed.id = summary.id;
                parsed.dataGroups = dataRes.dataGroups || dataRes.data_groups || [];
                loaded.push(parsed);
              }
            } catch (err) {
              console.warn('Failed loading dataset item:', summary.id, err);
            }
          }
          if (loaded.length > 0) {
            setStudyDatasets(effectiveStudyId, loaded);
            const targetDsId = activeModel?.datasetId
              || lastUsedDatasetByStudy[effectiveStudyId]
              || models.find(m => m.studyId === effectiveStudyId && m.datasetId)?.datasetId;
            const found = (targetDsId && loaded.find(d => d.id === targetDsId))
              || (loaded.length === 1 ? loaded[0] : null);
            if (found) {
              setActiveDataset(found);
              activeDatasetRef.current = found;
              if (effectiveModelId && found.id) {
                setModelDatasetId(effectiveModelId, found.id);
              }
            } else {
              setActiveDataset(null);
              activeDatasetRef.current = null;
            }
          }
        } else {
          // Fallback to legacy single loadProjectData
          api.loadProjectData(activeStudy.path).then((dataRes) => {
            if (dataRes && Array.isArray(dataRes.columns) && Array.isArray(dataRes.rows) && dataRes.rows.length > 0) {
              const datasetName = dataRes.dataset_name || `${activeStudy.name} Data`;
              const parsed = processData(datasetName, dataRes.columns, dataRes.rows);
              parsed.id = (dataRes as any).dataset_id || dataRes.id || `ds_${Date.now()}`;
              parsed.dataGroups = dataRes.dataGroups || dataRes.data_groups || [];
              setStudyDatasets(effectiveStudyId, [parsed]);
              setActiveDataset(parsed);
              activeDatasetRef.current = parsed;
              if (effectiveModelId && parsed.id) {
                setModelDatasetId(effectiveModelId, parsed.id);
              }
            } else {
              setActiveDataset(null);
              activeDatasetRef.current = null;
            }
          }).catch(() => {
            setActiveDataset(null);
            activeDatasetRef.current = null;
          });
        }
      }).catch(console.warn);
    } else {
      setActiveDataset(null);
      activeDatasetRef.current = null;
    }
  }, [effectiveStudyId, activeModel?.datasetId, activeStudy?.path, datasetsByStudy, lastUsedDatasetByStudy]);

  useEffect(() => {
    const cols = activeDataset?.variables?.map(v => v.name) || [];
    setCanvasDatasetColumns(cols);
  }, [activeDataset]);

  const handleSelectDataset = async (dataset: ParsedDataset) => {
    setActiveDataset(dataset);
    activeDatasetRef.current = dataset;
    if (effectiveModelId && dataset.id) {
      setModelDatasetId(effectiveModelId, dataset.id);
    }
    if (effectiveStudyId && dataset.id) {
      setStudyLastDatasetId(effectiveStudyId, dataset.id);
    }
    const cols = dataset.variables.map(v => v.name);
    setCanvasDatasetColumns(cols);

    // Save model spec with dataset_id directly to disk immediately!
    if (activeStudy?.path) {
      try {
        const spec = exportModelSpec();
        spec.dataset_id = dataset.id;
        const layout = getModelCanvasState();
        await api.saveProjectModel(activeStudy.path, spec, layout, effectiveModelId || undefined);
        setAutoSaveStatus('saved');
      } catch (err) {
        console.warn('Failed to save dataset_id with model:', err);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsImporting(true);
      const parsed = await parseDatasetFile(file);
      await handleImportComplete(parsed);
      if (effectiveStudyId) {
        openTab({
          type: 'dataset',
          title: parsed.filename,
          studyId: effectiveStudyId,
          datasetId: parsed.id,
          workspaceId: activeWorkspaceId,
        });
      }
    } catch (err) {
      alert("Error importing file: " + err);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImportComplete = async (dataset: ParsedDataset) => {
    const dsId = dataset.id || `ds_${Date.now()}`;
    const newDs = { ...dataset, id: dsId };
    setActiveDataset(newDs);
    activeDatasetRef.current = newDs;
    if (effectiveStudyId) {
      addStudyDataset(effectiveStudyId, newDs);
      setStudyLastDatasetId(effectiveStudyId, dsId);
      touchStudy(effectiveStudyId);
      if (effectiveModelId) {
        setModelDatasetId(effectiveModelId, dsId);
      }
      if (activeStudy?.path) {
        try {
          const headers = newDs.variables.map(v => v.name);
          await api.saveProjectDataJson(activeStudy.path, newDs.filename, headers, newDs.rows, undefined, undefined, dsId);
          // Also save model spec with dataset_id
          const spec = exportModelSpec();
          spec.dataset_id = dsId;
          const layout = getModelCanvasState();
          await api.saveProjectModel(activeStudy.path, spec, layout, effectiveModelId || undefined);
        } catch (err) {
          console.warn('Failed to save dataset to project in ModelEditor:', err);
        }
      }
    }
    const cols = newDs.variables.map(v => v.name);
    setCanvasDatasetColumns(cols);
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(performAutoSave, 300);
  };

  const visibleVariables = (activeDataset?.variables ?? []).filter(variable =>
    variable?.selected && (!variableFilter || String(variable.name ?? '').toLocaleLowerCase().includes(variableFilter.toLocaleLowerCase()))
  );
  const categories = Array.from(new Set(visibleVariables.map(variable => String(variable.category ?? 'General'))));

  const toggleCategory = (category: string) => {
    setCollapsedCategories(current => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const handleVariableClick = (event: React.MouseEvent, variableName: string) => {
    let next: Set<string>;
    if (event.shiftKey && lastSelectedVar) {
      const allNames = visibleVariables.map(v => String(v.name));
      const idx1 = allNames.indexOf(lastSelectedVar);
      const idx2 = allNames.indexOf(variableName);
      if (idx1 !== -1 && idx2 !== -1) {
        const start = Math.min(idx1, idx2);
        const end = Math.max(idx1, idx2);
        const range = allNames.slice(start, end + 1);
        next = new Set(range);
        setSelectedVarNames(next);
        (window as any).selectCanvasNodesByVarNames?.(Array.from(next));
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      next = new Set(selectedVarNames);
      if (next.has(variableName)) next.delete(variableName);
      else next.add(variableName);
      setLastSelectedVar(variableName);
    } else {
      next = new Set([variableName]);
      setLastSelectedVar(variableName);
    }
    setSelectedVarNames(next);
    (window as any).selectCanvasNodesByVarNames?.(Array.from(next));
  };

  const handleVariableDragStart = (event: React.DragEvent<HTMLDivElement>, variableName: string) => {
    let itemsToDrag: string[] = [variableName];
    if (selectedVarNames.has(variableName) && selectedVarNames.size > 1) {
      itemsToDrag = Array.from(selectedVarNames);
    } else {
      setSelectedVarNames(new Set([variableName]));
      setLastSelectedVar(variableName);
    }

    const payload = JSON.stringify({ type: 'variable-list', vars: itemsToDrag });
    try {
      event.dataTransfer.setData('text/plain', payload);
      event.dataTransfer.setData('application/json', payload);
      event.dataTransfer.effectAllowed = 'copy';
    } catch (e) {}
    (window as any).__draggedPayload = payload;
  };

  const handleCategoryDragStart = (event: React.DragEvent<HTMLDivElement>, category: string, catVars: string[]) => {
    const payload = JSON.stringify({
      type: 'variable-group',
      name: category,
      vars: catVars
    });
    try {
      event.dataTransfer.setData('text/plain', payload);
      event.dataTransfer.setData('application/json', payload);
      event.dataTransfer.effectAllowed = 'copy';
    } catch (e) {}
    (window as any).__draggedPayload = payload;
  };

  const handleCanvasDrop = (event: React.DragEvent<any>) => {
    event.preventDefault();
    event.stopPropagation();
    let payload = '';
    try {
      payload = event.dataTransfer?.getData('application/json') || event.dataTransfer?.getData('text/plain') || '';
    } catch (e) {}
    if (!payload) {
      payload = (window as any).__draggedPayload || '';
    }
    (window as any).__draggedPayload = null;
    if (payload) {
      (window as any).dropModelVariable?.(payload, event.clientX, event.clientY);
    }
  };

  const performAutoSave = async () => {
    if (isCanvasLoadingRef.current || !activeStudy?.path) return;
    try {
      setAutoSaveStatus('saving');
      const spec = exportModelSpec();
      const currentDs = activeDatasetRef.current || activeDataset;
      if (currentDs?.id) {
        spec.dataset_id = currentDs.id;
      }
      const layout = getModelCanvasState();
      const res = await api.saveProjectModel(activeStudy.path, spec, layout, effectiveModelId || undefined);
      if (res.error) {
        console.warn('Auto-save failed:', res.error);
        setAutoSaveError(res.error);
        setAutoSaveStatus('error');
      } else {
        setAutoSaveError(null);
        setAutoSaveStatus('saved');
        if (hasCalculatedOnceRef.current) {
          performSilentRecalculate();
        }
      }
    } catch (err: any) {
      console.warn('Auto-save error:', err);
      setAutoSaveError(err?.message || 'Unknown save error');
      setAutoSaveStatus('error');
    }
  };

  const performSilentRecalculate = async () => {
    if (!hasCalculatedOnceRef.current || isAutoCalculatingRef.current || !activeStudy?.path) return;
    if (hasInvalidLatentVariables()) {
      setIsModelOutdated(true);
      return;
    }
    try {
      isAutoCalculatingRef.current = true;
      const spec = exportModelSpec();
      const currentDs = activeDatasetRef.current || activeDataset;
      if (currentDs?.id) {
        spec.dataset_id = currentDs.id;
      }
      const layout = getModelCanvasState();
      const datasetHeaders = currentDs?.variables?.map(v => v.name);

      // Validate quietly - if model is currently invalid/incomplete while editing, skip gracefully
      const valRes = await api.validateModel(spec, activeStudy.path, datasetHeaders);
      if (!valRes.is_valid) {
        setIsModelOutdated(true);
        return;
      }

      const runRes = await api.runPlsModel(activeStudy.path, spec, {
        columns: datasetHeaders,
        rows: currentDs?.rows,
        dataset_name: currentDs?.filename,
        model_id: effectiveModelId || undefined,
        diagram_layout: layout,
        consistent: !!plsResultsRef.current?.is_consistent,
        settings: plsResultsRef.current?.settings,
      });

      if (runRes && runRes.results) {
        setPlsResults(runRes.results);
        plsResultsRef.current = runRes.results;
        setCanvasResults(runRes.results);
        const calculatedSnapshot = { spec, layout };
        setLastCalculatedModel(calculatedSnapshot);
        lastCalculatedModelRef.current = calculatedSnapshot;
        setIsModelOutdated(false);
      }
    } catch (err) {
      console.debug('Silent recalculate skipped:', err);
    } finally {
      isAutoCalculatingRef.current = false;
    }
  };

  const triggerDebouncedAutoSave = () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    setAutoSaveStatus('saving');
    autoSaveTimerRef.current = setTimeout(() => {
      performAutoSave();
    }, 600);
  };

  const switchView = (view: 'model' | 'results') => {
    setCurrentView(view);
    const viewSlider = document.getElementById('main-view-slider');
    const viewModel = document.getElementById('view-model');
    const viewResults = document.getElementById('view-results');
    const sliderBtns = viewSlider?.querySelectorAll('.view-slider__btn');
    const sliderBg = viewSlider?.querySelector('.view-slider__bg');
    if (viewModel && viewResults) {
      if (view === 'model') {
        (viewModel as HTMLElement).style.display = 'flex';
        (viewResults as HTMLElement).style.display = 'none';
        if (plsResults) {
          setCanvasResults(plsResults);
        }
        if (sliderBg && sliderBtns && sliderBtns.length >= 2) {
          (sliderBg as HTMLElement).style.transform = 'translateX(0)';
          sliderBtns[0]?.classList.add('active');
          sliderBtns[1]?.classList.remove('active');
        }
      } else {
        (viewModel as HTMLElement).style.display = 'none';
        (viewResults as HTMLElement).style.display = 'flex';
        if (sliderBg && sliderBtns && sliderBtns.length >= 2) {
          (sliderBg as HTMLElement).style.transform = 'translateX(100%)';
          sliderBtns[1]?.classList.add('active');
          sliderBtns[0]?.classList.remove('active');
        }
      }
    }
  };

  const handleSaveModel = async () => {
    if (!activeStudy?.path) {
      alert('Please open or select an active project study first.');
      return;
    }
    try {
      setIsSaving(true);
      await performAutoSave();
      setSaveToast('Model saved successfully');
      setTimeout(() => setSaveToast(null), 2500);
    } catch (err: any) {
      alert('Error saving model: ' + err?.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCalculate = async (consistent = false, settings?: ModelCalculationSettings) => {
    if (!activeStudy?.path) {
      alert('Please open or select an active project study first.');
      return;
    }
    if (hasInvalidLatentVariables()) {
      alert('Cannot calculate model: all latent variables must be connected and have indicators assigned.');
      return;
    }
    try {
      setIsCalculating(true);
      const spec = exportModelSpec();
      if (activeDataset?.id) {
        spec.dataset_id = activeDataset.id;
      }
      const layout = getModelCanvasState();

      // Ensure dataset is saved to project file if activeDataset is present
      const datasetHeaders = activeDataset?.variables?.map(v => v.name);
      if (activeDataset && Array.isArray(activeDataset.rows) && activeDataset.rows.length > 0) {
        try {
          await api.saveProjectDataJson(
            activeStudy.path,
            activeDataset.filename || 'dataset',
            datasetHeaders || [],
            activeDataset.rows,
            undefined,
            undefined,
            activeDataset.id,
            activeDataset.dataGroups
          );
        } catch (err) {
          console.warn('Failed auto-saving active dataset before calculate:', err);
        }
      }

      // 1. Validate model spec with backend
      const valRes = await api.validateModel(spec, activeStudy.path, datasetHeaders);
      if (!valRes.is_valid) {
        setValidationModal(valRes);
        return;
      }

      // 2. Auto-save model
      await api.saveProjectModel(activeStudy.path, spec, layout, effectiveModelId || undefined);

      // 3. Execute PLS-SEM algorithm
      const runRes = await api.runPlsModel(activeStudy.path, spec, {
        columns: datasetHeaders,
        rows: activeDataset?.rows,
        dataset_name: activeDataset?.filename,
        model_id: effectiveModelId || undefined,
        diagram_layout: layout,
        consistent,
        settings: settings || plsResultsRef.current?.settings,
      });
      if (runRes.error) {
        alert('PLS-SEM calculation failed: ' + runRes.error);
        return;
      }

      if (runRes.results) {
        setPlsResults(runRes.results);
        plsResultsRef.current = runRes.results;
        setCanvasResults(runRes.results);
        const calculatedSnapshot = { spec, layout };
        setLastCalculatedModel(calculatedSnapshot);
        lastCalculatedModelRef.current = calculatedSnapshot;
        setIsModelOutdated(false);
        setHasCalculatedOnce(true);
        hasCalculatedOnceRef.current = true;
      }

      setValidationSuccessToast(`PLS-SEM Calculation Complete! Converged in ${runRes.results?.iterations || 0} iterations`);
      setTimeout(() => setValidationSuccessToast(null), 3500);

      switchView('results');
    } catch (err: any) {
      alert('Error calculating model: ' + err?.message);
    } finally {
      setIsCalculating(false);
    }
  };

  useEffect(() => {
    if (activeStudy?.path) {
      api.loadProjectResults(activeStudy.path, 'pls', effectiveModelId || undefined).then((res) => {
        if (res && res.results) {
          setPlsResults(res.results);
          plsResultsRef.current = res.results;
          setHasCalculatedOnce(true);
          hasCalculatedOnceRef.current = true;
          const calculatedSpec = res.spec || exportModelSpec();
          const calculatedLayout = res.diagram_layout || getModelCanvasState();
          const calculatedSnapshot = { spec: calculatedSpec, layout: calculatedLayout };
          setLastCalculatedModel(calculatedSnapshot);
          lastCalculatedModelRef.current = calculatedSnapshot;

          // Only compare if canvas is fully loaded; otherwise wait for canvas loader to complete
          if (!isCanvasLoadingRef.current && res.spec) {
            try {
              const currentSpec = exportModelSpec();
              if (!isModelTopologyEqual(currentSpec, calculatedSpec)) {
                setIsModelOutdated(true);
                setCanvasResults(res.results);
              } else {
                setCanvasResults(res.results);
                setIsModelOutdated(false);
              }
            } catch (e) {
              setCanvasResults(res.results);
              setIsModelOutdated(false);
            }
          } else {
            setCanvasResults(res.results);
            setIsModelOutdated(false);
          }

          const viewSlider = document.getElementById('main-view-slider');
          if (viewSlider) {
            (viewSlider as HTMLElement).style.display = 'flex';
          }
        } else {
          setHasCalculatedOnce(false);
          hasCalculatedOnceRef.current = false;
          setPlsResults(null);
          plsResultsRef.current = null;
          setCanvasResults(null);
          setLastCalculatedModel(null);
          lastCalculatedModelRef.current = null;
          setIsModelOutdated(false);
        }
      }).catch(() => {
        setHasCalculatedOnce(false);
        hasCalculatedOnceRef.current = false;
        setPlsResults(null);
        plsResultsRef.current = null;
        setCanvasResults(null);
        setLastCalculatedModel(null);
        lastCalculatedModelRef.current = null;
        setIsModelOutdated(false);
      });
    } else {
      setPlsResults(null);
      plsResultsRef.current = null;
      setCanvasResults(null);
      setLastCalculatedModel(null);
      lastCalculatedModelRef.current = null;
      setIsModelOutdated(false);
    }
  }, [activeStudy?.path, effectiveModelId]);

  const handleRevertToCalculatedModel = () => {
    if (!lastCalculatedModel?.layout) return;
    loadModelCanvasState(lastCalculatedModel.layout);
    if (plsResults) {
      setCanvasResults(plsResults);
    }
    setIsModelOutdated(false);
    setSaveToast('Canvas reverted to calculated model state');
    setTimeout(() => setSaveToast(null), 2500);
    switchView('model');
  };

  const handleConfirmClearCanvas = () => {
    setHudConfirm(null);
    clearModelCanvas();
    setPlsResults(null);
    setCanvasResults(null);
    setLastCalculatedModel(null);
    lastCalculatedModelRef.current = null;
    setIsModelOutdated(false);
    triggerDebouncedAutoSave();
    setSaveToast('Canvas and results cleared');
    setTimeout(() => setSaveToast(null), 2500);
  };

  const handleOpenSnapshotModal = () => {
    const defaultName = `${activeModel?.name || 'Model'} - Snapshot ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    setSnapshotName(defaultName);
    setSnapshotTargetStudyId(activeStudyId || studies[0]?.id || '');
    setIsSnapshotModalOpen(true);
  };

  const handleSaveSnapshot = async () => {
    const targetStudy = studies.find(s => s.id === snapshotTargetStudyId) || activeStudy;
    if (!targetStudy?.path || !plsResults) return;
    try {
      setIsSavingSnapshot(true);
      const spec = lastCalculatedModel?.spec || exportModelSpec();
      const layout = lastCalculatedModel?.layout || getModelCanvasState();
      const res = await api.saveSnapshot({
        projectPath: targetStudy.path,
        name: snapshotName.trim() || `Snapshot ${new Date().toLocaleDateString()}`,
        description: '',
        algorithm: 'pls',
        results: plsResults,
        spec,
        diagramLayout: layout,
        sourceModelId: effectiveModelId || undefined,
      });
      if (res.error) {
        alert('Failed to save snapshot: ' + res.error);
        return;
      }
      if (res.snapshot) {
        addStudySnapshot(targetStudy.path, res.snapshot);
      }
      setIsSnapshotModalOpen(false);
      setSaveToast('Snapshot saved successfully');
      setTimeout(() => setSaveToast(null), 3000);
    } catch (err: any) {
      alert('Error saving snapshot: ' + err?.message);
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  const handleCreateDataFile = () => {
    if (!plsResults) {
      alert('Please calculate results first before creating a data file.');
      return;
    }
    try {
      const scores = plsResults.construct_scores || {};
      const constructs = Object.keys(scores);
      if (constructs.length === 0) {
        alert('No construct scores available to create a data file.');
        return;
      }
      const nSamples = plsResults.n_samples || 0;
      const cnamesMap = plsResults.construct_names || {};

      // SmartPLS 4 naming: LV scores - <CONSTRUCT>
      const scoreColNames = constructs.map(c => `LV scores - ${cnamesMap[c] || c}`);

      // Collect original data columns and rows
      const origVars = activeDataset ? activeDataset.variables.map(v => v.name) : [];
      const origRows = activeDataset ? activeDataset.rows : [];

      const combinedHeaders = [...origVars, ...scoreColNames];
      const combinedRows: any[][] = [];

      for (let i = 0; i < nSamples; i++) {
        const rowBase = origRows && origRows[i] ? [...origRows[i]] : [];
        const scoreVals = constructs.map(c => {
          const val = scores[c]?.[i];
          if (val !== undefined && val !== null && !isNaN(Number(val))) {
            return Number(val);
          }
          return '';
        });
        combinedRows.push([...rowBase, ...scoreVals]);
      }

      // Generate CSV string with proper escaping
      const escapeCsv = (v: any) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };
      let csvContent = combinedHeaders.map(escapeCsv).join(',') + '\n';
      for (const row of combinedRows) {
        csvContent += row.map(escapeCsv).join(',') + '\n';
      }

      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeModel?.name || 'Model'}_with_LV_scores.csv`;
      a.click();
      URL.revokeObjectURL(url);

      // Save dataset into project and store so it is immediately available
      const newDatasetName = `${activeStudy?.name || 'Dataset'} with LV scores`;
      const newDsId = `ds_lv_${Date.now()}`;
      const newParsed = processData(newDatasetName, combinedHeaders, combinedRows);
      newParsed.id = newDsId;

      if (effectiveStudyId) {
        addStudyDataset(effectiveStudyId, newParsed);
      }

      if (activeStudy?.path) {
        api.saveProjectDataJson(
          activeStudy.path,
          newDatasetName,
          combinedHeaders,
          combinedRows,
          undefined,
          undefined,
          newDsId
        ).catch(err => console.warn('Auto-save LV scores dataset failed:', err));
      }

      setSaveToast('Created data file with LV scores and added to project');
      setTimeout(() => setSaveToast(null), 3000);
    } catch (e: any) {
      alert('Error creating data file: ' + e?.message);
    }
  };

  const handleRedundancyModelsCreated = (createdModels: any[], calculateNow: boolean) => {
    if (!createdModels || createdModels.length === 0) return;

    createdModels.forEach(m => {
      addModel({
        id: m.model_id,
        studyId: effectiveStudyId || '',
        name: m.name,
        type: 'pls',
        datasetId: activeDataset?.id,
        lastModified: 'Just now',
      });
    });

    if (effectiveStudyId) {
      touchStudy(effectiveStudyId);
    }

    const first = createdModels[0];
    if (first) {
      setActiveModel(first.model_id);
      openTab({
        type: 'model',
        title: first.name,
        modelId: first.model_id,
        studyId: effectiveStudyId || '',
        workspaceId: activeWorkspaceId,
      });

      if (calculateNow && first.results) {
        setPlsResults(first.results);
        setCanvasResults(first.results);
        setCurrentView('results');
      }
    }

    setSaveToast(
      createdModels.length === 1
        ? `Created model "${first?.name}"`
        : `Created ${createdModels.length} redundancy analysis models`
    );
    setTimeout(() => setSaveToast(null), 3000);
  };

  const handleExportExcel = async () => {
    if (!plsResults) return;
    const table = document.querySelector('.scientific-table');
    if (!table) {
      alert('No active table to export.');
      return;
    }
    try {
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Results');
      table.querySelectorAll('tr').forEach(row => {
        sheet.addRow(Array.from(row.querySelectorAll('th, td'), cell => cell.textContent?.trim() || ''));
      });
      const bytes = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${activeModel?.name || 'Model'}_${activeResultTab}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      setSaveToast('Excel report downloaded');
      setTimeout(() => setSaveToast(null), 2500);
    } catch (error) {
      console.error('Excel export failed:', error);
      alert('Could not export the table to Excel.');
    }
  };

  const handleExportHtml = () => {
    if (!plsResults) return;
    const table = document.querySelector('.scientific-table');
    if (!table) return;
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${activeModel?.name || 'Model'} Results - ${reportTabDetails.title}</title>
  <style>
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 32px; color: #1e293b; }
    h1 { margin-bottom: 4px; font-size: 20px; font-weight: 600; }
    p { margin-top: 0; color: #64748b; font-size: 14px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
    td:not(:first-child) { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
    th { background: #f8fafc; font-weight: 600; }
    tr:nth-child(even) { background: #f8fafc; }
  </style>
</head>
<body>
  <h1>${reportTabDetails.title}</h1>
  <p>Model: ${activeModel?.name || 'Model'} | Study: ${activeStudy?.name || 'Study'} | Generated: ${new Date().toLocaleString()}</p>
  ${table.outerHTML}
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeModel?.name || 'Model'}_${activeResultTab}.html`;
    a.click();
    URL.revokeObjectURL(url);
    setSaveToast('HTML report downloaded');
    setTimeout(() => setSaveToast(null), 2500);
  };

  const handleCreateReport = () => {
    window.print();
  };

  const handleCompare = () => {
    alert('Model comparison: Snapshots and current runs can be viewed side-by-side by opening snapshots from the study workspace.');
  };

  const decimalDigits = normalizeDecimalDigits(settings.decimalDigits);
  const decimalSystem = settings.decimalSystem;

  const fmt = (val: any, decimals: number = decimalDigits): string =>
    formatNumber(val, decimals, decimalSystem);

  const fmtP = (val: any, decimals: number = decimalDigits): string =>
    formatPValue(val, decimals, decimalSystem);

  const { constructNameMap, indicatorNameMap, legacyConstructNames } = useMemo(() => {
    const cMap: Record<string, string> = {};
    const iMap: Record<string, string> = {};
    const aliases: Record<string, string> = {};

    const cleanStem = (name: string) => {
      if (!name) return '';
      return name.replace(/[_\-\s.]*\d+$/i, '').trim() || name;
    };

    const deriveName = (indicatorNames: string[]) => {
      if (!indicatorNames || indicatorNames.length === 0) return '';
      const stems = indicatorNames.map(cleanStem).filter(Boolean);
      if (stems.length === 0) return '';
      const first = stems[0].toUpperCase();
      if (stems.every(s => s.toUpperCase() === first)) return first;
      let prefix = stems[0];
      for (let i = 1; i < stems.length; i++) {
        while (!stems[i].toUpperCase().startsWith(prefix.toUpperCase()) && prefix.length > 0) {
          prefix = prefix.slice(0, -1);
        }
      }
      prefix = prefix.replace(/[_\-\s.]+$/, '').trim();
      return prefix.length >= 2 ? prefix.toUpperCase() : first;
    };

    // 1. From canvas state
    try {
      const canvasState = getModelCanvasState();
      if (canvasState && Array.isArray(canvasState.nodes)) {
        const latentNodes = canvasState.nodes.filter((n: any) => n.isLatent !== false && !n.isText);
        const indNodes = canvasState.nodes.filter((n: any) => n.isLatent === false && !n.isText);

        indNodes.forEach((ind: any) => {
          iMap[ind.id] = ind.label;
        });

        latentNodes.forEach((ln: any) => {
          const childInds = indNodes.filter((i: any) => i.parentId === ln.id).map((i: any) => i.label);
          let name = ln.label;
          if (!name || name.startsWith('node_') || name.toUpperCase().startsWith('LATENT') || name.toUpperCase().startsWith('LV_')) {
            const derived = deriveName(childInds);
            if (derived) name = derived;
          }
          cMap[ln.id] = name || ln.id;
        });
      }
    } catch (e) {}

    // 2. From plsResults if backend returned them
    if (plsResults?.construct_names) {
      Object.entries(plsResults.construct_names).forEach(([cid, cname]) => {
        if (!cMap[cid] || cMap[cid].startsWith('node_')) {
          cMap[cid] = String(cname);
        }
      });
    }
    if (plsResults?.indicator_names) {
      Object.entries(plsResults.indicator_names).forEach(([iid, iname]) => {
        if (!iMap[iid]) {
          iMap[iid] = String(iname);
        }
      });
    }

    if (Array.isArray(plsResults?.latent_variables)) {
      plsResults.latent_variables.forEach((latent: any) => {
        const oldName = String(latent?.name || '');
        const currentName = cMap[String(latent?.id || '')];
        if (oldName && currentName && oldName !== currentName) aliases[oldName] = currentName;
      });
    }

    return { constructNameMap: cMap, indicatorNameMap: iMap, legacyConstructNames: aliases };
  }, [plsResults]);

  const getConstructName = (cid: string): string => {
    if (!cid) return '';
    if (constructNameMap[cid]) return constructNameMap[cid];
    if (cid.includes(' x ')) {
      return cid.split(' x ').map(part => legacyConstructNames[part] || constructNameMap[part] || part).join(' x ');
    }
    return legacyConstructNames[cid] || cid;
  };
  const getIndicatorName = (iid: string): string => indicatorNameMap[iid] || iid;

  const isInteractionConstruct = (cid: string): boolean => {
    if (!cid) return false;
    if (cid.includes(' x ')) return true;
    if (Array.isArray(plsResults?.latent_variables)) {
      const lv = plsResults.latent_variables.find((v: any) => v.id === cid || v.name === cid);
      if (lv?.is_interaction) return true;
    }
    return false;
  };

  const isCopulaConstruct = (cid: string): boolean => {
    if (!cid) return false;
    if (cid.startsWith('GC (') || cid.startsWith('gc_')) return true;
    if (Array.isArray(plsResults?.latent_variables)) {
      const lv = plsResults.latent_variables.find((v: any) => v.id === cid || v.name === cid);
      if (lv?.is_copula) return true;
    }
    return false;
  };

  const isQuadraticConstruct = (cid: string) => {
    if (!plsResults) return false;
    if (cid.includes(' x ') && cid.split(' x ')[0].trim() === cid.split(' x ')[1].trim()) return true;
    if (Array.isArray(plsResults.latent_variables)) {
      const lv = plsResults.latent_variables.find((v: any) => v.id === cid || v.name === cid);
      if (lv?.is_quadratic) return true;
    }
    return false;
  };

  const renderConstructLabel = (cid: string, customName?: string) => {
    const isQuad = isQuadraticConstruct(cid);
    const isInt = !isQuad && isInteractionConstruct(cid);
    const isCop = isCopulaConstruct(cid);
    const label = customName || getConstructName(cid);
    return (
      <div className="construct-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <div className="construct-dot" style={{ background: isQuad ? '#10b981' : (isInt ? '#ec4899' : (isCop ? '#8b5cf6' : (constructPalette[cid] || '#6366f1'))) }} />
        <span className="construct-name">{label}</span>
        {isQuad && (
          <span
            className="quadratic-badge"
            style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: '4px',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#059669',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              lineHeight: 1.3,
            }}
          >
            x²
          </span>
        )}
        {isInt && (
          <span
            className="interaction-badge"
            style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: '4px',
              background: 'rgba(236, 72, 153, 0.12)',
              color: '#db2777',
              border: '1px solid rgba(236, 72, 153, 0.25)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              lineHeight: 1.3,
            }}
          >
            interaction
          </span>
        )}
        {isCop && (
          <span
            className="copula-badge"
            style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: '4px',
              background: 'rgba(139, 92, 246, 0.15)',
              color: '#7c3aed',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              lineHeight: 1.3,
            }}
          >
            copula
          </span>
        )}
      </div>
    );
  };

  const resultConstructs: string[] = useMemo(() => {
    if (!plsResults) return [];
    const set = new Set<string>();

    if (Array.isArray(plsResults.latent_variables)) {
      plsResults.latent_variables.forEach((lv: any) => {
        if (lv?.id) set.add(String(lv.id));
      });
    }

    if (plsResults.structural?.path_coefficients) {
      Object.entries(plsResults.structural.path_coefficients).forEach(([tgt, sources]: [string, any]) => {
        set.add(tgt);
        if (sources && typeof sources === 'object') {
          Object.keys(sources).forEach(s => set.add(s));
        }
      });
    }

    Object.keys(plsResults.measurement?.outer_loadings || {}).forEach(c => set.add(c));
    Object.keys(plsResults.measurement?.outer_weights || {}).forEach(c => set.add(c));
    Object.keys(plsResults.construct_scores || {}).forEach(c => set.add(c));
    Object.keys(plsResults.structural?.r_squared || {}).forEach(c => set.add(c));
    Object.keys(plsResults.reliability_and_validity?.ave || {}).forEach(c => set.add(c));

    const ordered: string[] = [];
    if (Array.isArray(plsResults.latent_variables)) {
      plsResults.latent_variables.forEach((lv: any) => {
        const id = lv?.id ? String(lv.id) : '';
        if (id && set.has(id)) {
          ordered.push(id);
          set.delete(id);
        }
      });
    }
    Array.from(set).sort().forEach(c => ordered.push(c));
    return ordered;
  }, [plsResults]);

  const targetConstructs: string[] = useMemo(() => {
    return resultConstructs.filter(c => !isInteractionConstruct(c) && !isCopulaConstruct(c));
  }, [resultConstructs]);

  const measurementConstructs: string[] = useMemo(() => {
    return resultConstructs.filter(c => !isInteractionConstruct(c) && !isCopulaConstruct(c));
  }, [resultConstructs]);

  const constructPalette: Record<string, string> = useMemo(() => {
    const colors = ['#6366f1', '#0ea5e9', '#f59e0b', '#10b981', '#a855f7', '#f43f5e', '#14b8a6', '#ec4899', '#8b5cf6'];
    const map: Record<string, string> = {};
    resultConstructs.forEach((c, idx) => {
      map[c] = colors[idx % colors.length];
    });
    return map;
  }, [resultConstructs]);

  const allIndicators = useMemo(() => {
    if (!plsResults) return [];
    const set = new Set<string>();
    Object.values(plsResults.measurement?.outer_loadings || {}).forEach((m: any) => {
      Object.keys(m || {}).forEach(k => set.add(k));
    });
    Object.values(plsResults.measurement?.outer_weights || {}).forEach((m: any) => {
      Object.keys(m || {}).forEach(k => set.add(k));
    });
    return Array.from(set).sort();
  }, [plsResults]);

  const reportTabDetails = useMemo(() => {
    switch (activeResultTab) {
      case 'path_coefficients':
        return {
          title: 'Path Coefficients',
          badge: 'β (beta)',
          subtitle: 'Standardized beta coefficients between endogenous and exogenous latent constructs.',
        };
      case 'specific_indirect_effects':
        return { title: 'Individual Indirect Paths', badge: 'Indirect effects', subtitle: 'Estimates for each distinct mediation path.' };
      case 'run_details':
        return { title: 'Calculation Details', badge: 'Run information', subtitle: 'Convergence and iteration information reported by the engine.' };
      case 'total_indirect_effects':
        return {
          title: 'Total Indirect Effects',
          badge: 'Indirect',
          subtitle: 'Specific and cumulative indirect mediation pathways across constructs.',
        };
      case 'total_effects':
        return {
          title: 'Total Effects',
          badge: 'Direct + Indirect',
          subtitle: 'Cumulative relationships and mediation decomposition across the structural model.',
        };
      case 'outer_loadings':
        return {
          title: 'Outer Loadings',
          badge: 'λ (lambda)',
          subtitle: 'Bivariate correlations between each indicator and its associated latent construct score.',
        };
      case 'outer_weights':
        return {
          title: 'Outer Weights',
          badge: 'w',
          subtitle: 'Relative contribution weights of indicators to their latent construct scores.',
        };
      case 'r_squared':
        return {
          title: 'R-Square (R²)',
          badge: 'R² & Adj R²',
          subtitle: 'Coefficient of determination measuring variance explained for endogenous constructs.',
        };
      case 'f_squared':
        return {
          title: 'f-Square Effect Sizes',
          badge: 'f²',
          subtitle: 'Cohen\'s f² effect size of omitted predictor on endogenous construct R².',
        };
      case 'reliability':
        return {
          title: 'Construct Reliability & Validity',
          badge: 'α, CR, ρA, AVE',
          subtitle: 'Internal consistency reliability (Cronbach\'s α, CR, rho_A) and convergent validity (AVE).',
        };
      case 'discriminant':
        return {
          title: 'Discriminant Validity',
          badge: 'HTMT & Fornell-Larcker',
          subtitle: 'Assessment of construct distinction via Heterotrait-Monotrait ratio and Fornell-Larcker criterion.',
        };
      case 'collinearity':
        return {
          title: 'Collinearity Statistics (VIF)',
          badge: 'VIF',
          subtitle: 'Variance Inflation Factors evaluating multicollinearity among predictors and indicators.',
        };
      case 'construct_scores':
        return {
          title: 'Latent Variable Scores',
          badge: 'Y (standardized)',
          subtitle: 'Estimated case-level construct scores standardized to zero mean and unit variance.',
        };
      case 'model_fit':
        return {
          title: 'Model Fit',
          badge: 'SRMR & discrepancy',
          subtitle: 'Model fit statistics and reference values.',
        };
      case 'bootstrap_significance':
        return {
          title: 'Bootstrap Significance Testing',
          badge: 'p-values, t-stats, 95% CI',
          subtitle: 'Non-parametric bootstrap distributions, standard errors, t-statistics, p-values, and 95% confidence intervals.',
        };
      default:
        return {
          title: 'PLS-SEM Results',
          badge: 'PLS',
          subtitle: 'Estimation results from the PLS-SEM engine.',
        };
    }
  }, [activeResultTab]);

  const handleCopyCurrentTable = () => {
    const tableEl = document.querySelector('.scientific-table');
    if (!tableEl) return;
    let tsv = '';
    const rows = tableEl.querySelectorAll('tr');
    rows.forEach(r => {
      const cells = r.querySelectorAll('th, td');
      const line = Array.from(cells).map(c => c.textContent?.trim().replace(/\s+/g, ' ') || '').join('\t');
      tsv += line + '\n';
    });
    navigator.clipboard.writeText(tsv);
    setValidationSuccessToast('Table copied to clipboard (TSV format)');
    setTimeout(() => setValidationSuccessToast(null), 2500);
  };

  const handleExportCurrentTable = () => {
    const tableEl = document.querySelector('.scientific-table');
    if (!tableEl) return;
    let csv = '';
    const rows = tableEl.querySelectorAll('tr');
    rows.forEach(r => {
      const cells = r.querySelectorAll('th, td');
      const line = Array.from(cells).map(c => {
        let txt = c.textContent?.trim().replace(/\s+/g, ' ') || '';
        if (txt.includes(',') || txt.includes('"')) {
          txt = `"${txt.replace(/"/g, '""')}"`;
        }
        return txt;
      }).join(',');
      csv += line + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeResultTab}_results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportModel = () => {
    try {
      const spec = exportModelSpec();
      const jsonStr = JSON.stringify(spec, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeStudy?.name || 'model'}_spec.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Error exporting model: ' + err?.message);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLElement && (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable ||
        (e.target as any).dataset?.editable
      );

      if ((e.key === 'Backspace' || e.key === 'Delete') && !isInput) {
        e.preventDefault();
        if ((window as any).deleteSelectedModelPart) {
          (window as any).deleteSelectedModelPart();
        }
      }

      if ((e.metaKey || e.ctrlKey) && !isInput) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            (window as any).canvasRedo?.();
          } else {
            (window as any).canvasUndo?.();
          }
        } else if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          (window as any).canvasRedo?.();
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveModel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeStudy?.path]);

  useEffect(() => {
    // Add global sync method for color pickers
    (window as any).syncColorPickers = (fill: string, border: string, text: string) => {
      if (fill) setActiveFill(fill);
      if (border) setActiveBorder(border);
      if (text) setActiveText(text);
    };

    isCanvasLoadingRef.current = true;
    loadModelCanvasState({ nodes: [], edges: [] });

    // Add a tiny delay to ensure DOM is ready
    const timer = setTimeout(async () => {
      initModelCanvas();

      if (activeStudy?.path) {
        try {
          const modelRes = await api.loadProjectModel(activeStudy.path, effectiveModelId || undefined);
          if (modelRes && modelRes.diagram_layout && modelRes.diagram_layout.nodes) {
            loadModelCanvasState(modelRes.diagram_layout);
          } else {
            loadModelCanvasState({ nodes: [], edges: [] });
          }
          if (modelRes && modelRes.spec && modelRes.spec.dataset_id && effectiveModelId) {
            const boundDsId = modelRes.spec.dataset_id;
            setModelDatasetId(effectiveModelId, boundDsId);
            if (effectiveStudyId) {
              setStudyLastDatasetId(effectiveStudyId, boundDsId);
            }
            const currentList = getStudyDatasets(useStore.getState().datasetsByStudy, effectiveStudyId || '');
            let matching = currentList.find(d => d.id === boundDsId);
            if (!matching && activeStudy?.path && effectiveStudyId) {
              try {
                const dataRes = await api.loadProjectData(activeStudy.path, boundDsId);
                if (dataRes && Array.isArray(dataRes.columns) && Array.isArray(dataRes.rows)) {
                  matching = processData(dataRes.dataset_name || 'Dataset', dataRes.columns, dataRes.rows);
                  matching.id = boundDsId;
                  matching.dataGroups = dataRes.dataGroups || dataRes.data_groups || [];
                  addStudyDataset(effectiveStudyId, matching);
                }
              } catch (e) {
                console.warn('Could not load bound dataset directly:', e);
              }
            }
            if (matching) {
              setActiveDataset(matching);
              activeDatasetRef.current = matching;
              setCanvasDatasetColumns(matching.variables.map(v => v.name));
            }
          }
        } catch (err) {
          console.warn('Could not load saved model layout:', err);
        } finally {
          isCanvasLoadingRef.current = false;
          if (lastCalculatedModelRef.current?.spec) {
            try {
              const currentSpec = exportModelSpec();
              if (!isModelTopologyEqual(currentSpec, lastCalculatedModelRef.current.spec)) {
                setCanvasResults(null);
                setIsModelOutdated(true);
              } else {
                setIsModelOutdated(false);
                if (plsResultsRef.current || plsResults) {
                  setCanvasResults(plsResultsRef.current || plsResults);
                }
              }
            } catch (e) {}
          }
        }
      } else {
        isCanvasLoadingRef.current = false;
      }

      const viewSlider = document.getElementById('main-view-slider');
      const sliderBtns = viewSlider?.querySelectorAll('.view-slider__btn');
      if (sliderBtns) {
        sliderBtns.forEach(btn => {
          btn.addEventListener('click', (e) => {
            const target = e.currentTarget as HTMLElement | null;
            switchView(target?.dataset?.view === 'results' ? 'results' : 'model');
          });
        });
      }
    }, 120);


    const handleColorPickerClosed = (e: any) => {
      const { id, color } = e.detail;
      if (!color) return;
      if (id === 'picker-fill') {
        setActiveFill(color);
        if (!isDefaultColor(color)) {
          setRecentFills(prev => [...prev.filter(c => c.toLowerCase() !== color.toLowerCase()), color].slice(-3));
        }
      } else if (id === 'picker-border') {
        setActiveBorder(color);
        if (!isDefaultColor(color)) {
          setRecentBorders(prev => [...prev.filter(c => c.toLowerCase() !== color.toLowerCase()), color].slice(-3));
        }
      } else if (id === 'picker-text') {
        setActiveText(color);
        if (!isDefaultColor(color)) {
          setRecentTextColors(prev => [...prev.filter(c => c.toLowerCase() !== color.toLowerCase()), color].slice(-3));
        }
      }
    };
    
    const handleCanvasChanged = () => {
      if (isCanvasLoadingRef.current) return;
      triggerDebouncedAutoSave();
      if (lastCalculatedModelRef.current?.spec) {
        try {
          const currentSpec = exportModelSpec();
          if (!isModelTopologyEqual(currentSpec, lastCalculatedModelRef.current.spec)) {
            setIsModelOutdated(true);
            if (!hasCalculatedOnceRef.current) {
              setCanvasResults(null);
            }
          } else {
            setIsModelOutdated(false);
            if (plsResultsRef.current || plsResults) {
              setCanvasResults(plsResultsRef.current || plsResults);
            }
          }
        } catch (e) {}
      }
    };

    document.addEventListener('color-picker-closed', handleColorPickerClosed);
    window.addEventListener('canvas-changed', handleCanvasChanged);

    const handleModSelected = (e: any) => {
      setSelectedModeration(e.detail?.moderation || null);
    };
    const handleSelectionChange = (e: any) => {
      if (e.detail?.type !== 'moderation') {
        setSelectedModeration(null);
      }
    };
    const handleKeyDownMod = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedModeration(null);
      }
    };

    const handleModelStylesReset = () => {
      setActiveFill('#ffffff');
      setActiveBorder('#334155');
      setActiveText('#0f172a');
      setActiveArrowColor('#0f172a');
      setActiveBorderWeight(1.5);
      setEdgeLineStyle('solid');
      setEdgeArrowhead('solid');
    };

    window.addEventListener('moderation-selected', handleModSelected);
    window.addEventListener('selectionChange', handleSelectionChange);
    window.addEventListener('keydown', handleKeyDownMod);
    window.addEventListener('model-styles-reset', handleModelStylesReset);

    return () => {
      clearTimeout(timer);
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      document.removeEventListener('color-picker-closed', handleColorPickerClosed);
      window.removeEventListener('canvas-changed', handleCanvasChanged);
      window.removeEventListener('moderation-selected', handleModSelected);
      window.removeEventListener('selectionChange', handleSelectionChange);
      window.removeEventListener('keydown', handleKeyDownMod);
      window.removeEventListener('model-styles-reset', handleModelStylesReset);
      setCanvasResults(null);
      loadModelCanvasState({ nodes: [], edges: [] });
    };
  }, [activeStudy?.path, effectiveModelId]);

  return (
    <div className="app-body" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <AppSidebar activeNav="workspace" />
      <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

  {/* ═══ SUB-HEADER / CONTROL BAR ═══ */}
  <div className="subheader">
    <div className="subheader__breadcrumb">
      <span
        className="subheader__breadcrumb-link"
        id="current-model-workspace"
        onClick={() => {
          if (activeWorkspaceId) {
            openTab({ type: 'workspace', title: activeWorkspace?.name || 'Workspace', workspaceId: activeWorkspaceId });
          }
        }}
      >
        {activeWorkspace?.name || 'Active_Workspace'}
      </span>
      <span className="subheader__breadcrumb-sep">/</span>
      <span
        className="subheader__breadcrumb-link"
        id="current-model-study"
        onClick={() => {
          if (activeWorkspaceId) {
            openTab({ type: 'workspace', title: activeWorkspace?.name || 'Workspace', workspaceId: activeWorkspaceId });
          }
        }}
      >
        {activeStudy?.name || 'Active_Study'}
      </span>
      <span className="subheader__breadcrumb-sep">/</span>
      <span className="subheader__breadcrumb-link" style={{color: 'var(--color-accent)', fontWeight: 600}}>
        {activeModel ? `${activeModel.name}.splsm` : 'Untitled model.splsm'}
      </span>

      <div className="subheader__divider" style={{ margin: '0 8px' }} />

      {/* Auto-Save Live Status Indicator docked beside breadcrumb */}
      <div
        className="subheader__autosave-status"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          color: autoSaveStatus === 'error' ? '#ef4444' : 'var(--color-text-muted)',
          userSelect: 'none',
        }}
        title={
          autoSaveStatus === 'saving'
            ? 'Saving changes...'
            : autoSaveStatus === 'error'
            ? (autoSaveError ? `Auto-save error: ${autoSaveError}` : 'Failed to auto-save')
            : 'All changes saved automatically'
        }
      >
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: autoSaveStatus === 'saving' ? '#eab308' : (autoSaveStatus === 'error' ? '#ef4444' : '#22c55e'),
            display: 'inline-block',
            flexShrink: 0
          }}
        />
        <span style={{ whiteSpace: 'nowrap' }}>{autoSaveStatus === 'saving' ? 'Saving...' : (autoSaveStatus === 'error' ? 'Save error' : 'Saved')}</span>
      </div>
    </div>
    <div className="subheader__actions">
      {/* Inline Model | Results Switcher */}
      <div className="subheader__switcher">
        <button
          type="button"
          className={`subheader__switcher-btn ${currentView === 'model' ? 'active' : ''}`}
          onClick={() => switchView('model')}
        >
          Model
        </button>
        <button
          type="button"
          className={`subheader__switcher-btn ${currentView === 'results' ? 'active' : ''}`}
          onClick={() => {
            if (plsResults || availableAnalyses.length || Object.keys(analysisResultsMap).length) {
              switchView('results');
            }
          }}
          disabled={!plsResults && !availableAnalyses.length && !Object.keys(analysisResultsMap).length}
          title={plsResults || availableAnalyses.length || Object.keys(analysisResultsMap).length ? 'View Results' : 'Please calculate the model first'}
        >
          Results
        </button>
      </div>

      {/* Inline Calculate Dropdown */}
      <div className="subheader__dropdown-container" ref={calcDropdownRef}>
        <button
          className="subheader__btn subheader__btn--primary"
          id="calculate-btn"
          type="button"
          onClick={() => setIsCalcMenuOpen(prev => !prev)}
          disabled={isValidating || isCalculating}
          title="Calculate Options"
          aria-expanded={isCalcMenuOpen}
          aria-haspopup="true"
          style={{ gap: 4 }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: 13, height: 13 }}><polygon points="5 3 19 12 5 21 5 3" /></svg>
          <span>{isCalculating ? 'Calculating...' : (isValidating ? 'Validating...' : 'Calculate')}</span>
          <span className="material-symbols-outlined" style={{ fontSize: 16, marginLeft: -1 }}>expand_more</span>
        </button>
        {isCalcMenuOpen && (
          <CalculationMenu
            dataGroupsCount={activeDataset?.dataGroups?.length ?? 0}
            onSelect={(id) => {
              setIsCalcMenuOpen(false);
              if (id === 'pls' || id === 'consistent_pls') {
                setModelSettingsConsistent(id === 'consistent_pls');
                setModelSettingsOpen(true);
              } else if (id === 'bootstrap' || id === 'consistent_bootstrap') {
                setBootstrapConsistent(id === 'consistent_bootstrap');
                setIsBootstrapModalOpen(true);
              } else if (id === 'compare') {
                setIsCompareModalOpen(true);
              } else if (id === 'permutation') {
                setIsPermutationModalOpen(true);
              } else if (id === 'mga_groups') {
                setIsMgaModalOpen(true);
              } else {
                setAnalysisModalType(id);
                setIsAnalysisModalOpen(true);
              }
            }}
          />
        )}
      </div>
    </div>
  </div>
  {/* ═══ APP BODY ═══ */}
  <div id="view-model" className="view-panel" style={{ display: currentView === 'model' ? 'flex' : 'none' }}>
    <div className="app-body">
      {/* ─── Variable Sidebar (Left) ─── */}
      <aside className="var-sidebar" id="var-sidebar">
        {activeDataset ? (
          <div className="var-sidebar__header">
            {isVarSearchOpen ? (
              <div className="inline-search-wrap">
                <input
                  autoFocus
                  type="text"
                  className="sidebar-inline-search"
                  value={variableFilter}
                  onChange={(e) => setVariableFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsVarSearchOpen(false);
                      setVariableFilter('');
                    }
                  }}
                  onBlur={() => {
                    if (!variableFilter) setIsVarSearchOpen(false);
                  }}
                  placeholder="Filter variables…"
                />
                {variableFilter && (
                  <button
                    className="inline-search-clear"
                    type="button"
                    aria-label="Clear variable search"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setVariableFilter('')}
                  >
                    ×
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, flex: 1 }}>
                <span className="var-sidebar__header-label" title={activeDataset.filename}>
                  {activeDataset.filename}
                </span>
                <button
                  ref={datasetButtonRef}
                  className="icon-btn icon-btn--sm"
                  title="Change Dataset"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDatasetMenuOpen((prev) => !prev);
                  }}
                  style={{
                    flexShrink: 0,
                    padding: '2px',
                    width: '24px',
                    height: '24px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                    color: isDatasetMenuOpen ? 'var(--color-primary)' : 'inherit',
                    background: isDatasetMenuOpen ? 'var(--color-bg-hover, rgba(0,0,0,0.06))' : 'transparent',
                    cursor: 'pointer'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>swap_horiz</span>
                </button>
              </div>
            )}
            <div className="var-sidebar__header-actions">
              <button
                className={`icon-btn icon-btn--sm ${isVarSearchOpen ? 'active' : ''}`}
                title="Filter variables"
                type="button"
                onClick={() => {
                  setIsVarSearchOpen((open) => !open);
                  if (isVarSearchOpen) setVariableFilter('');
                }}
              >
                <span className="material-symbols-outlined">search</span>
              </button>
              <button
                className="icon-btn icon-btn--sm"
                title={areCategoriesCollapsed ? 'Expand categories' : 'Collapse categories'}
                type="button"
                onClick={() => setAreCategoriesCollapsed((current) => !current)}
              >
                <span className="material-symbols-outlined">
                  {areCategoriesCollapsed ? 'unfold_more' : 'unfold_less'}
                </span>
              </button>
              <span
                className="sidebar-item__badge"
                title={`${activeDataset.variables.filter((v) => v?.selected).length} variables`}
              >
                {activeDataset.variables.filter((v) => v?.selected).length}
              </span>
            </div>
          </div>
        ) : null}

        {/* Floating Dataset Switch Dropdown attached to sidebar */}
        {isDatasetMenuOpen && activeDataset && (
          <div
            ref={datasetDropdownRef}
            className="canvas-dataset-dropdown animate-scale-in"
            style={{
              position: 'absolute',
              top: '42px',
              left: '8px',
              right: '8px',
              width: 'calc(100% - 16px)',
              maxWidth: 'none',
              zIndex: 99999,
              boxShadow: '0 8px 24px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.1)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="canvas-dataset-dropdown__header">Switch Dataset</div>
            <div className="canvas-dataset-dropdown__list">
              {studyDatasets.map((ds) => {
                const isCurrent = ds.id === activeDataset.id || ds.filename === activeDataset.filename;
                return (
                  <div
                    key={ds.id || ds.filename}
                    className={`canvas-dataset-dropdown__item ${isCurrent ? 'selected' : ''}`}
                    onClick={() => {
                      handleSelectDataset(ds);
                      setIsDatasetMenuOpen(false);
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: isCurrent ? 'var(--color-primary)' : 'inherit' }}>
                      {isCurrent ? 'check_circle' : 'dataset'}
                    </span>
                    <div className="canvas-dataset-dropdown__item-info">
                      <span className="canvas-dataset-dropdown__item-name">{ds.filename}</span>
                      <span className="canvas-dataset-dropdown__item-meta">{ds.rows?.length || 0} rows • {ds.variables?.length || 0} vars</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="canvas-dataset-dropdown__footer">
              <button
                type="button"
                className="canvas-dataset-dropdown__add-btn"
                onClick={() => {
                  setIsDatasetMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
                <span>Import New Dataset…</span>
              </button>
            </div>
          </div>
        )}

        {activeDataset ? (
          <div className="var-sidebar__list" id="var-list">
            {isVarSearchOpen && variableFilter && visibleVariables.length === 0 && (
              <span className="inline-search-empty">No variables found</span>
            )}
            {categories.map(cat => {
              const varsInCat = visibleVariables.filter(v => String(v.category ?? 'General') === cat);
              if (varsInCat.length === 0) return null;
              return (
                <div className="var-cat" key={cat}>
                  <div
                    className="var-cat__header"
                    draggable
                    onDragStart={(event) => handleCategoryDragStart(event, cat, varsInCat.map(v => String(v.name)))}
                    onClick={() => toggleCategory(cat)}
                  >
                    <div className="var-cat__header-left">
                      <svg className={`cat-chevron ${areCategoriesCollapsed || collapsedCategories.has(cat) ? 'rotated' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="6 9 12 15 18 9" /></svg>
                      <span className="var-cat__name">{cat}</span>
                    </div>
                    <span className="var-cat__count">{varsInCat.length}</span>
                  </div>
                  <div className={`var-items ${areCategoriesCollapsed || collapsedCategories.has(cat) ? 'hidden' : ''}`}>
                    {varsInCat.map(v => {
                      const vName = String(v.name ?? '');
                      const isSelected = selectedVarNames.has(vName);
                      return (
                        <div
                          className={`var-item ${isSelected ? 'selected' : ''}`}
                          key={v.name}
                          data-variable-name={vName}
                          draggable
                          onClick={(event) => handleVariableClick(event, vName)}
                          onDragStart={event => handleVariableDragStart(event, vName)}
                        >
                          <span className="var-item__name">{v.name}</span>
                          <span className="var-item__type">{String(v.scaleType ?? 'Unknown').slice(0, 3).toUpperCase()}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="dataset-picker-sidebar animate-fade-in">
            <div className="var-sidebar__header">
              <span className="var-sidebar__header-label" style={{ fontWeight: 600 }}>Available Datasets</span>
              <div className="var-sidebar__header-actions">
                <span className="sidebar-item__badge">{studyDatasets.length}</span>
              </div>
            </div>
            
            <div className="dataset-picker-content">
              <div className="dataset-picker-intro">
                Select a dataset for this model to populate indicators:
              </div>

              {studyDatasets.length > 0 ? (
                <div className="dataset-picker-list">
                  {studyDatasets.map((ds) => (
                    <div
                      key={ds.id || ds.filename}
                      className="dataset-picker-card"
                      onClick={() => handleSelectDataset(ds)}
                      title={`Click to use ${ds.filename}`}
                    >
                      <div className="dataset-picker-card__icon">
                        <span className="material-symbols-outlined">dataset</span>
                      </div>
                      <div className="dataset-picker-card__details">
                        <div className="dataset-picker-card__title">{ds.filename}</div>
                        <div className="dataset-picker-card__meta">
                          <span className="file-badge file-badge--default">{ds.rows?.length || 0} rows</span>
                          <span className="file-badge file-badge--default">{ds.variables?.length || 0} vars</span>
                        </div>
                      </div>
                      <div className="dataset-picker-card__arrow">
                        <span className="material-symbols-outlined">chevron_right</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '16px 8px', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                  No datasets imported yet.
                </div>
              )}

              <div className="dataset-picker-divider" />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="var-sidebar__insert-btn"
                style={{ marginTop: '4px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>upload_file</span>
                <span>{isImporting ? 'Parsing...' : 'Import New Dataset'}</span>
              </button>
            </div>
          </div>
        )}
        <input 
          type="file" 
          accept=".csv,.txt,.xlsx,.xls,.sav"
          ref={fileInputRef}
          onChange={handleFileUpload}
          style={{ display: 'none' }}
        />
      </aside>
      {/* ─── Center Canvas Area ─── */}
      <main
        className="canvas-area"
        style={{ backgroundColor: settings.canvasBgColor || undefined }}
        onDragEnter={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
        onDrop={handleCanvasDrop}
      >
        {/* Toolbar Pill */}
        <div className="canvas-toolbar">
          {/* Group 1: Select, Connect, Erase, Auto-Align */}
          <div className="tb-btn active" id="btn-select" title="Select (V)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /><path d="M13 13l6 6" /></svg></div>
          <div className="tb-btn" id="btn-connect" title="Connect (P) - Connect constructs or drag to the middle of a path for moderation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1={5} y1={12} x2={19} y2={12} /><polyline points="12 5 19 12 12 19" /></svg></div>
          <div className="tb-btn" title="Erase Element (E)" id="btn-erase">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: 16, height: 16 }}>
              <line x1={18} y1={6} x2={6} y2={18} strokeLinecap="round" strokeLinejoin="round" />
              <line x1={6} y1={6} x2={18} y2={18} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="tb-btn" title="Auto-Align Model">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: 16, height: 16 }}>
              <rect x={4} y={4} width={6} height={6} rx={1} />
              <rect x={14} y={14} width={6} height={6} rx={1} />
              <line x1={10} y1={7} x2={17} y2={7} />
              <line x1={17} y1={7} x2={17} y2={14} />
            </svg>
          </div>
          
          <div className="tb-divider" />

          {/* Group 2: Latent, Moderation, Quadratic, Gaussian, Text */}
          <div
            className="tb-btn"
            id="btn-add-latent"
            title="Latent variable (O)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx={12} cy={12} r={8} />
            </svg>
          </div>
          <div className="tb-btn" title="Moderation Effect (M)" style={{ display: 'none' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx={12} cy={12} r={10} /><line x1={12} y1={8} x2={12} y2={16} /><line x1={8} y1={12} x2={16} y2={12} /></svg></div>
          <div className="tb-btn" title="Quadratic Effect (Q)"><span className="tb-btn--text">x²</span></div>
          <div className="tb-btn" title="Gaussian Copula"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4" /><polyline points="14 2 14 8 20 8" /><path d="M2 15h10" /><path d="M6 11l-4 4 4 4" /></svg></div>
          <div className="tb-btn" id="btn-add-text-note" title="Text Note (T)" data-action="add-text-note"><span className="tb-btn--text">T</span></div>
          
          <div className="tb-divider" />
          <button className="tb-btn" type="button" title="Undo (Cmd+Z / Ctrl+Z)" id="btn-undo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{width: 16, height: 16}}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7v6h6" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
          </button>
          <button className="tb-btn" type="button" title="Redo (Cmd+Shift+Z / Ctrl+Y)" id="btn-redo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{width: 16, height: 16}}><path strokeLinecap="round" strokeLinejoin="round" d="M21 7v6h-6" /><path strokeLinecap="round" strokeLinejoin="round" d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></svg>
          </button>

          <div className="tb-divider" id="formatting-divider" style={{display: 'none'}} />
          <div id="node-formatting-tools" style={{display: 'none', gap: '4px'}}>
          {/* Construct Indicator Alignment (Latent & Indicator variables) */}
          <div className="tb-dropdown-container" id="container-align">
            <button
              className={`tb-dropdown-btn ${openDropdown === 'align' ? 'active' : ''}`}
              type="button"
              title="Alignment"
              id="btn-align"
              onClick={(e) => { e.stopPropagation(); setOpenDropdown(prev => prev === 'align' ? null : 'align'); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1={21} y1={6} x2={3} y2={6} /><line x1={15} y1={12} x2={3} y2={12} /><line x1={17} y1={18} x2={3} y2={18} /></svg>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div
              className={`tb-dropdown-menu ${openDropdown === 'align' ? 'show' : ''}`}
              id="menu-align"
              style={{ display: openDropdown === 'align' ? 'flex' : 'none' }}
              onClick={() => setOpenDropdown(null)}
            >
              <div className="tb-dropdown-item" data-action="align-top"><span className="material-symbols-outlined">align_vertical_top</span> Align Top</div>
              <div className="tb-dropdown-item" data-action="align-bottom"><span className="material-symbols-outlined">align_vertical_bottom</span> Align Bottom</div>
              <div className="tb-dropdown-item" data-action="align-left"><span className="material-symbols-outlined">align_horizontal_left</span> Align Left</div>
              <div className="tb-dropdown-item" data-action="align-right"><span className="material-symbols-outlined">align_horizontal_right</span> Align Right</div>
            </div>
          </div>

          {/* Textbox Text Alignment (Left, Center, Right, Justify & Top, Middle, Bottom) */}
          <div className="tb-dropdown-container" id="container-textbox-align" style={{ display: 'none' }}>
            <button
              className={`tb-dropdown-btn ${openDropdown === 'textbox-align' ? 'active' : ''}`}
              type="button"
              title="Text Alignment"
              id="btn-textbox-align"
              onClick={(e) => { e.stopPropagation(); setOpenDropdown(prev => prev === 'textbox-align' ? null : 'textbox-align'); }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                {textboxAlign === 'left' ? 'format_align_left' : (textboxAlign === 'right' ? 'format_align_right' : (textboxAlign === 'justify' ? 'format_align_justify' : 'format_align_center'))}
              </span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: 14, height: 14 }}><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div
              className={`tb-dropdown-menu ${openDropdown === 'textbox-align' ? 'show' : ''}`}
              id="menu-textbox-align"
              style={{ width: '180px', padding: '10px 12px', display: openDropdown === 'textbox-align' ? 'flex' : 'none', flexDirection: 'column' }}
            >
              <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-hint)', marginBottom: '6px' }}>
                Horizontal Alignment
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', marginBottom: '10px' }}>
                {[
                  { id: 'left', icon: 'format_align_left', label: 'Left' },
                  { id: 'center', icon: 'format_align_center', label: 'Center' },
                  { id: 'right', icon: 'format_align_right', label: 'Right' },
                  { id: 'justify', icon: 'format_align_justify', label: 'Justify' },
                ].map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    data-textbox-action={`align-${opt.id}`}
                    title={opt.label}
                    onClick={() => {
                      setTextboxAlign(opt.id as any);
                      document.dispatchEvent(new CustomEvent('textbox-align-change', { detail: { align: opt.id } }));
                    }}
                    style={{
                      height: '28px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: textboxAlign === opt.id ? '1px solid var(--color-accent)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                      background: textboxAlign === opt.id ? 'var(--color-accent-subtle)' : 'transparent',
                      color: textboxAlign === opt.id ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>{opt.icon}</span>
                  </button>
                ))}
              </div>

              <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-hint)', marginBottom: '6px' }}>
                Vertical Alignment
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                {[
                  { id: 'top', icon: 'vertical_align_top', label: 'Top' },
                  { id: 'middle', icon: 'vertical_align_center', label: 'Center' },
                  { id: 'bottom', icon: 'vertical_align_bottom', label: 'Bottom' },
                ].map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    data-textbox-action={`valign-${opt.id}`}
                    title={opt.label}
                    onClick={() => {
                      setTextboxValign(opt.id as any);
                      document.dispatchEvent(new CustomEvent('textbox-valign-change', { detail: { valign: opt.id } }));
                    }}
                    style={{
                      height: '28px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: textboxValign === opt.id ? '1px solid var(--color-accent)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                      background: textboxValign === opt.id ? 'var(--color-accent-subtle)' : 'transparent',
                      color: textboxValign === opt.id ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>{opt.icon}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="tb-dropdown-container" id="container-style">
            <button
              className={`tb-dropdown-btn ${openDropdown === 'style' ? 'active' : ''}`}
              type="button"
              title="Style"
              id="btn-style"
              onClick={(e) => { e.stopPropagation(); setOpenDropdown(prev => prev === 'style' ? null : 'style'); }}
            >
              <div className="tb-shape-preview" />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div
              className={`tb-dropdown-menu ${openDropdown === 'style' ? 'show' : ''}`}
              id="menu-style"
              style={{ display: openDropdown === 'style' ? 'flex' : 'none' }}
              onClick={() => setOpenDropdown(null)}
            >
              {[
                { id: 'circle', action: 'shape-circle', icon: 'radio_button_unchecked', label: 'Circle' },
                { id: 'rect', action: 'shape-rect', icon: 'crop_square', label: 'Rectangle' },
                { id: 'rounded', action: 'shape-rounded', icon: 'rectangle', label: 'Rounded Rect' },
                { id: 'hexagon', action: 'shape-hex', icon: 'hexagon', label: 'Hexagon' },
                { id: 'octagon', action: 'shape-oct', icon: 'stop_circle', label: 'Octagon' },
              ].map(opt => (
                <div
                  key={opt.id}
                  className={`tb-dropdown-item ${activeNodeShape === opt.id ? 'active-edge-option' : ''}`}
                  data-action={opt.action}
                  onClick={() => {
                    setActiveNodeShape(opt.id);
                    document.dispatchEvent(new CustomEvent('node-shape-change', { detail: { shape: opt.id } }));
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    height: '32px',
                    borderRadius: '6px',
                    marginBottom: '2px',
                    background: activeNodeShape === opt.id ? 'var(--color-accent-subtle)' : 'transparent',
                    border: activeNodeShape === opt.id ? '1px solid var(--color-accent)' : '1px solid transparent',
                    color: activeNodeShape === opt.id ? 'var(--color-accent)' : 'var(--color-text-primary)',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>{opt.icon}</span>
                    <span style={{ fontSize: '11px', fontWeight: 500 }}>{opt.label}</span>
                  </div>
                  {activeNodeShape === opt.id && (
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-accent)' }}>check</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="tb-dropdown-container" id="container-colors">
            <button
              className={`tb-dropdown-btn ${openDropdown === 'colors' ? 'active' : ''}`}
              type="button"
              title="Color &amp; Stroke Styling"
              id="btn-colors"
              onClick={(e) => { e.stopPropagation(); setOpenDropdown(prev => prev === 'colors' ? null : 'colors'); }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>palette</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{width: 14, height: 14}}><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div
              className={`tb-dropdown-menu ${openDropdown === 'colors' ? 'show' : ''}`}
              id="menu-colors"
              style={{ width: '202px', boxSizing: 'border-box', padding: '10px 12px', display: openDropdown === 'colors' ? 'flex' : 'none', flexDirection: 'column' }}
            >
              <div style={{marginBottom: '10px'}}>
                <div style={{fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-hint)', marginBottom: '6px'}}>Fill Color</div>
                <div style={{display: 'flex', gap: '6px', flexWrap: 'nowrap', alignItems: 'center'}}>
                  {[...fixedFills, ...recentFills.filter(c => !isDefaultColor(c))].map((color, i) => (
                    <button
                      key={'fill'+i}
                      type="button"
                      style={{
                        width: '20px',
                        height: '20px',
                        flexShrink: 0,
                        borderRadius: '50%',
                        background: color === 'transparent' ? 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQIW2NkYGD4z8DAwMgAI0AMDA4YAQc0D+oAAAAASUVORK5CYII=)' : color,
                        border: activeFill?.toLowerCase() === color.toLowerCase() ? '2px solid var(--color-accent)' : '1px solid rgba(0,0,0,0.12)',
                        boxShadow: activeFill?.toLowerCase() === color.toLowerCase() ? '0 0 0 2px var(--color-accent-subtle)' : 'none',
                        cursor: 'pointer'
                      }}
                      onClick={() => handleFillColorSelect(color)}
                      title={color}
                    />
                  ))}
                  <button type="button" style={{width: '20px', height: '20px', flexShrink: 0, borderRadius: '50%', background: 'transparent', border: '1px dashed var(--color-border-subtle, #cbd5e1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', position: 'relative', cursor: 'pointer'}} title="Custom Color">
                    <span style={{fontSize: '12px', lineHeight: 1}}>+</span>
                    <input
                      type="color"
                      id="picker-fill"
                      title="Fill Color"
                      defaultValue="#f8fafc"
                      style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer'}} 
                      onInput={(e: any) => handleFillColorSelect(e.target.value)}
                      onChange={(e: any) => handleFillColorSelect(e.target.value)}
                    />
                  </button>
                </div>
              </div>

              <div className="tb-divider" style={{width: '100%', height: '1px', margin: '4px 0 8px', opacity: 0.2}}></div>

              <div style={{marginBottom: '10px'}}>
                <div style={{fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-hint)', marginBottom: '6px'}}>Border Color</div>
                <div style={{display: 'flex', gap: '6px', flexWrap: 'nowrap', alignItems: 'center'}}>
                  {[...fixedBorders, ...recentBorders.filter(c => !isDefaultColor(c))].map((color, i) => (
                    <button
                      key={'border'+i}
                      type="button"
                      style={{
                        width: '20px',
                        height: '20px',
                        flexShrink: 0,
                        borderRadius: '50%',
                        background: color === 'transparent' ? 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQIW2NkYGD4z8DAwMgAI0AMDA4YAQc0D+oAAAAASUVORK5CYII=)' : color,
                        border: activeBorder?.toLowerCase() === color.toLowerCase() ? '2px solid var(--color-accent)' : '1px solid rgba(0,0,0,0.12)',
                        boxShadow: activeBorder?.toLowerCase() === color.toLowerCase() ? '0 0 0 2px var(--color-accent-subtle)' : 'none',
                        cursor: 'pointer'
                      }}
                      onClick={() => handleBorderColorSelect(color)}
                      title={color}
                    />
                  ))}
                  <button type="button" style={{width: '20px', height: '20px', flexShrink: 0, borderRadius: '50%', background: 'transparent', border: '1px dashed var(--color-border-subtle, #cbd5e1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', position: 'relative', cursor: 'pointer'}} title="Custom Color">
                    <span style={{fontSize: '12px', lineHeight: 1}}>+</span>
                    <input
                      type="color"
                      id="picker-border"
                      title="Border Color"
                      defaultValue="#cbd5e1"
                      style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer'}}
                      onInput={(e: any) => handleBorderColorSelect(e.target.value)}
                      onChange={(e: any) => handleBorderColorSelect(e.target.value)}
                    />
                  </button>
                </div>
              </div>

              <div className="tb-divider" style={{width: '100%', height: '1px', margin: '4px 0 8px', opacity: 0.2}}></div>

              <label className="modal__field">
                <span className="modal__label">Border weight</span>
                <input key={activeBorderWeight} type="number" className="modal__input" min="0" max="20" step="0.25" defaultValue={activeBorderWeight} aria-label="Border weight in pixels" onBlur={(event) => {
                  const raw = event.currentTarget.value.trim();
                  const value = Number(raw);
                  if (!raw || !Number.isFinite(value) || value < 0 || value > 20) { event.currentTarget.value = String(activeBorderWeight); return; }
                  setActiveBorderWeight(value);
                  document.dispatchEvent(new CustomEvent('border-weight-change', { detail: { weight: value } }));
                }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = String(activeBorderWeight); event.currentTarget.blur(); } }} />
              </label>
            </div>
          </div>
          
          <div className="tb-dropdown-container" id="container-text">
            <button
              className={`tb-dropdown-btn ${openDropdown === 'text' ? 'active' : ''}`}
              type="button"
              title="Typography Settings"
              id="btn-text"
              onClick={(e) => { e.stopPropagation(); setOpenDropdown(prev => prev === 'text' ? null : 'text'); }}
            >
              <span style={{fontWeight: 600, fontSize: '13px', color: 'var(--color-text-primary)'}}>Aa</span>
              <span className="tb-font-size-label" style={{fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--color-text-hint)', marginLeft: '2px'}}>14</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{width: 14, height: 14, marginLeft: '2px'}}><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div
              className={`tb-dropdown-menu ${openDropdown === 'text' ? 'show' : ''}`}
              id="menu-text"
              style={{ width: '236px', padding: '10px 12px', display: openDropdown === 'text' ? 'flex' : 'none', flexDirection: 'column' }}
            >
              <div style={{marginBottom: '10px'}}>
                <div style={{fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-hint)', marginBottom: '5px'}}>Font Family</div>
                <select
                  id="input-font-family"
                  style={{
                    width: '100%',
                    background: 'var(--color-bg-base)',
                    border: '1px solid var(--color-border-subtle, #e2e8f0)',
                    borderRadius: '6px',
                    padding: '4px 6px',
                    fontSize: '11px',
                    color: 'var(--color-text-primary)',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="Inter">Inter (Sans-Serif)</option>
                  <option value="JetBrains Mono">JetBrains Mono</option>
                  <option value="Roboto">Roboto</option>
                  <option value="system-ui">System Default</option>
                </select>
              </div>

              <div className="tb-divider" style={{width: '100%', height: '1px', margin: '4px 0 8px', opacity: 0.2}}></div>
              
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginBottom: '10px'}}>
                <div>
                  <div style={{fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-hint)', marginBottom: '5px'}}>Size</div>
                  <div className="tb-font-size" style={{background: 'var(--color-bg-base)', borderRadius: '6px', border: '1px solid var(--color-border-subtle, #e2e8f0)', padding: '2px', display: 'flex', alignItems: 'center'}}>
                    <button className="tb-font-btn" data-action="font-dec" style={{width: '20px', height: '20px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)'}}>−</button>
                    <input type="number" className="tb-font-input" id="input-font-size" defaultValue={14} style={{display: 'none'}} />
                    <span className="tb-font-size-label" style={{fontFamily: 'var(--font-mono)', fontSize: '11px', width: '28px', textAlign: 'center', fontWeight: 600, color: 'var(--color-text-primary)'}}>14px</span>
                    <button className="tb-font-btn" data-action="font-inc" style={{width: '20px', height: '20px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)'}}>+</button>
                  </div>
                </div>
                <div>
                  <div style={{fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-hint)', marginBottom: '5px'}}>Style</div>
                  <div style={{display: 'flex', background: 'var(--color-bg-base)', borderRadius: '6px', border: '1px solid var(--color-border-subtle, #e2e8f0)', padding: '2px', gap: '2px'}}>
                    <button className="tb-font-btn" data-action="text-bold" style={{width: '22px', height: '20px', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 700, fontSize: '11px', borderRadius: '4px'}} title="Bold">B</button>
                    <button className="tb-font-btn" data-action="text-italic" style={{width: '22px', height: '20px', border: 'none', background: 'transparent', cursor: 'pointer', fontStyle: 'italic', fontSize: '11px', borderRadius: '4px'}} title="Italic">I</button>
                    <button className="tb-font-btn" data-action="text-underline" style={{width: '22px', height: '20px', border: 'none', background: 'transparent', cursor: 'pointer', textDecoration: 'underline', fontSize: '11px', borderRadius: '4px'}} title="Underline">U</button>
                  </div>
                </div>
              </div>

              <div className="tb-divider" style={{width: '100%', height: '1px', margin: '4px 0 8px', opacity: 0.2}}></div>

              <div style={{marginBottom: '8px'}}>
                <div style={{fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-hint)', marginBottom: '6px'}}>Text Color</div>
                <div style={{display: 'flex', gap: '6px', flexWrap: 'nowrap', alignItems: 'center'}}>
                  {[...fixedTexts, ...recentTextColors.filter(c => !isDefaultColor(c))].map((color, i) => (
                    <button
                      key={'text'+i}
                      type="button"
                      style={{
                        width: '20px',
                        height: '20px',
                        flexShrink: 0,
                        borderRadius: '50%',
                        background: color === 'transparent' ? 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQIW2NkYGD4z8DAwMgAI0AMDA4YAQc0D+oAAAAASUVORK5CYII=)' : color,
                        border: activeText?.toLowerCase() === color.toLowerCase() ? '2px solid var(--color-accent)' : '1px solid rgba(0,0,0,0.12)',
                        cursor: 'pointer',
                        boxShadow: activeText?.toLowerCase() === color.toLowerCase() ? '0 0 0 2px var(--color-accent-subtle)' : 'none'
                      }}
                      onClick={() => handleTextColorSelect(color)}
                      title={color}
                    />
                  ))}
                  <button type="button" style={{width: '20px', height: '20px', flexShrink: 0, borderRadius: '50%', background: 'transparent', border: '1px dashed var(--color-border-subtle, #cbd5e1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', cursor: 'pointer', position: 'relative'}} title="Custom Color">
                    <span style={{fontSize: '12px', lineHeight: 1}}>+</span>
                    <input
                      type="color"
                      id="picker-text"
                      title="Text Color"
                      defaultValue="#0f172a"
                      style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer'}}
                      onInput={(e: any) => handleTextColorSelect(e.target.value)}
                      onChange={(e: any) => handleTextColorSelect(e.target.value)}
                    />
                  </button>
                </div>
              </div>

              <div id="row-text-inside" style={{borderTop: '1px solid var(--color-border-subtle, #e2e8f0)', paddingTop: '8px', marginTop: '2px', display: 'none', alignItems: 'center', gap: '6px'}}>
                <button
                  className="tb-font-btn"
                  data-action="text-inside"
                  type="button"
                  style={{
                    flex: 1,
                    height: '28px',
                    border: '1px solid var(--color-border-subtle, #e2e8f0)',
                    background: 'var(--color-bg-base)',
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    fontWeight: 500,
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                    padding: '0 8px'
                  }}
                  title="Toggle text label position inside or outside"
                >
                  <span className="material-symbols-outlined" style={{fontSize: '15px', color: 'var(--color-accent)'}}>vertical_align_center</span>
                  <span id="text-inside-label">Move Inside</span>
                </button>
                <div id="container-text-outside-pos" style={{display: 'none', alignItems: 'center', gap: '2px', background: 'var(--color-bg-base)', borderRadius: '6px', border: '1px solid var(--color-border-subtle, #e2e8f0)', padding: '2px', height: '28px', boxSizing: 'border-box'}}>
                  <button className="tb-font-btn" data-action="text-pos-top" type="button" style={{width: '22px', height: '22px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', padding: 0}} title="Position Top">
                    <span className="material-symbols-outlined" style={{fontSize: '15px'}}>align_vertical_top</span>
                  </button>
                  <button className="tb-font-btn" data-action="text-pos-bottom" type="button" style={{width: '22px', height: '22px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', padding: 0}} title="Position Bottom">
                    <span className="material-symbols-outlined" style={{fontSize: '15px'}}>align_vertical_bottom</span>
                  </button>
                  <button className="tb-font-btn" data-action="text-pos-left" type="button" style={{width: '22px', height: '22px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', padding: 0}} title="Position Left">
                    <span className="material-symbols-outlined" style={{fontSize: '15px'}}>align_horizontal_left</span>
                  </button>
                  <button className="tb-font-btn" data-action="text-pos-right" type="button" style={{width: '22px', height: '22px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', padding: 0}} title="Position Right">
                    <span className="material-symbols-outlined" style={{fontSize: '15px'}}>align_horizontal_right</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          </div>
          
          {/* Edge Formatting Tools (Line style & Arrowhead with active selection highlight) */}
          <div id="edge-formatting-tools" style={{display: 'none', gap: '4px'}}>
            {/* Line Style Dropdown */}
            <div className="tb-dropdown-container">
              <button
                className={`tb-dropdown-btn ${openDropdown === 'line' ? 'active' : ''}`}
                type="button"
                title="Line Style"
                id="btn-line-style"
                onClick={(e) => { e.stopPropagation(); setOpenDropdown(prev => prev === 'line' ? null : 'line'); }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{width: 16, height: 16}}><path d="M5 12h14" /></svg>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{width: 14, height: 14, marginLeft: '2px'}}><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              
              <div
                className={`tb-dropdown-menu ${openDropdown === 'line' ? 'show' : ''}`}
                id="menu-line-style"
                style={{
                  width: '150px',
                  padding: '6px',
                  borderRadius: '8px',
                  boxShadow: 'var(--shadow-float, 0 8px 24px rgba(15, 23, 42, 0.12))',
                  border: '1px solid var(--color-border-default, #e2e8f0)',
                  left: 0,
                  display: openDropdown === 'line' ? 'flex' : 'none',
                  flexDirection: 'column'
                }}
              >
                {[
                  {
                    id: 'solid',
                    label: 'Solid',
                    svg: <svg width="60" height="20" style={{flexShrink: 0}}><line x1="0" y1="10" x2="60" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="edge-stroke-preview" /></svg>
                  },
                  {
                    id: 'dashed',
                    label: 'Dashed',
                    svg: <svg width="60" height="20" style={{flexShrink: 0}}><line x1="0" y1="10" x2="60" y2="10" stroke="currentColor" strokeWidth="2" strokeDasharray="6,4" strokeLinecap="round" className="edge-stroke-preview" /></svg>
                  },
                  {
                    id: 'dotted',
                    label: 'Dotted',
                    svg: <svg width="60" height="20" style={{flexShrink: 0}}><line x1="0" y1="10" x2="60" y2="10" stroke="currentColor" strokeWidth="2" strokeDasharray="2,4" strokeLinecap="round" className="edge-stroke-preview" /></svg>
                  },
                  {
                    id: 'curved',
                    label: 'Curved',
                    svg: <svg width="60" height="20" style={{flexShrink: 0}}><path d="M 0 14 Q 30 2 60 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="edge-stroke-preview" /></svg>
                  }
                ].map(opt => (
                  <div
                    key={opt.id}
                    className={`tb-dropdown-item ${edgeLineStyle === opt.id ? 'active-edge-option' : ''}`}
                    data-edge-action={`line-${opt.id}`}
                    onClick={() => {
                      setEdgeLineStyle(opt.id as any);
                      document.dispatchEvent(new CustomEvent('edge-line-style-change', { detail: { style: opt.id } }));
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      height: '32px',
                      borderRadius: '6px',
                      marginBottom: '2px',
                      background: edgeLineStyle === opt.id ? 'var(--color-accent-subtle)' : 'transparent',
                      border: edgeLineStyle === opt.id ? '1px solid var(--color-accent)' : '1px solid transparent',
                      color: edgeLineStyle === opt.id ? 'var(--color-accent)' : 'var(--color-text-primary)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                      {opt.svg}
                      <span style={{fontSize: '11px', fontWeight: 500}}>{opt.label}</span>
                    </div>
                    {edgeLineStyle === opt.id && (
                      <span className="material-symbols-outlined" style={{fontSize: '16px', color: 'var(--color-accent)'}}>check</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Arrowhead Style Dropdown */}
            <div className="tb-dropdown-container">
              <button
                className={`tb-dropdown-btn ${openDropdown === 'arrowhead' ? 'active' : ''}`}
                type="button"
                title="Arrowhead Style"
                id="btn-arrowhead-style"
                onClick={(e) => { e.stopPropagation(); setOpenDropdown(prev => prev === 'arrowhead' ? null : 'arrowhead'); }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{width: 16, height: 16}}><path d="M5 12h14" /><path d="M15 16l4-4-4-4" /></svg>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{width: 14, height: 14, marginLeft: '2px'}}><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              
              <div
                className={`tb-dropdown-menu ${openDropdown === 'arrowhead' ? 'show' : ''}`}
                id="menu-arrowhead-style"
                style={{
                  width: '150px',
                  padding: '6px',
                  borderRadius: '8px',
                  boxShadow: 'var(--shadow-float, 0 8px 24px rgba(15, 23, 42, 0.12))',
                  border: '1px solid var(--color-border-default, #e2e8f0)',
                  left: 0,
                  display: openDropdown === 'arrowhead' ? 'flex' : 'none',
                  flexDirection: 'column'
                }}
              >
                {[
                  {
                    id: 'solid',
                    label: 'Solid',
                    svg: (
                      <svg width="60" height="20" style={{flexShrink: 0}}>
                        <line x1="0" y1="10" x2="48" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="edge-stroke-preview" />
                        <polygon points="48,6 58,10 48,14" fill="currentColor" className="edge-fill-preview" />
                      </svg>
                    )
                  },
                  {
                    id: 'open',
                    label: 'Open',
                    svg: (
                      <svg width="60" height="20" style={{flexShrink: 0}}>
                        <line x1="0" y1="10" x2="52" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="edge-stroke-preview" />
                        <path d="M 48 6 L 56 10 L 48 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="edge-stroke-preview" />
                      </svg>
                    )
                  },
                  {
                    id: 'diamond',
                    label: 'Diamond',
                    svg: (
                      <svg width="60" height="20" style={{flexShrink: 0}}>
                        <line x1="0" y1="10" x2="46" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="edge-stroke-preview" />
                        <polygon points="50,5 57,10 50,15 43,10" fill="currentColor" className="edge-fill-preview" />
                      </svg>
                    )
                  },
                  {
                    id: 'circle',
                    label: 'Circle',
                    svg: (
                      <svg width="60" height="20" style={{flexShrink: 0}}>
                        <line x1="0" y1="10" x2="50" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="edge-stroke-preview" />
                        <circle cx="53" cy="10" r="4" fill="currentColor" className="edge-fill-preview" />
                      </svg>
                    )
                  }
                ].map(opt => (
                  <div
                    key={opt.id}
                    className={`tb-dropdown-item ${edgeArrowhead === opt.id ? 'active-edge-option' : ''}`}
                    data-edge-action={`arrowhead-${opt.id}`}
                    onClick={() => {
                      setEdgeArrowhead(opt.id as any);
                      document.dispatchEvent(new CustomEvent('edge-arrowhead-change', { detail: { arrowhead: opt.id } }));
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      height: '32px',
                      borderRadius: '6px',
                      marginBottom: '2px',
                      background: edgeArrowhead === opt.id ? 'var(--color-accent-subtle)' : 'transparent',
                      border: edgeArrowhead === opt.id ? '1px solid var(--color-accent)' : '1px solid transparent',
                      color: edgeArrowhead === opt.id ? 'var(--color-accent)' : 'var(--color-text-primary)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                      {opt.svg}
                      <span style={{fontSize: '11px', fontWeight: 500}}>{opt.label}</span>
                    </div>
                    {edgeArrowhead === opt.id && (
                      <span className="material-symbols-outlined" style={{fontSize: '16px', color: 'var(--color-accent)'}}>check</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Arrow Color Dropdown */}
            <div className="tb-dropdown-container">
              <button
                className={`tb-dropdown-btn ${openDropdown === 'arrow-color' ? 'active' : ''}`}
                type="button"
                title="Arrow Color"
                id="btn-arrow-color"
                onClick={(e) => { e.stopPropagation(); setOpenDropdown(prev => prev === 'arrow-color' ? null : 'arrow-color'); }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>palette</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{width: 14, height: 14, marginLeft: '2px'}}><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              
              <div
                className={`tb-dropdown-menu ${openDropdown === 'arrow-color' ? 'show' : ''}`}
                id="menu-arrow-color"
                style={{
                  width: '202px',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  boxShadow: 'var(--shadow-float, 0 8px 24px rgba(15, 23, 42, 0.12))',
                  border: '1px solid var(--color-border-default, #e2e8f0)',
                  left: 0,
                  display: openDropdown === 'arrow-color' ? 'flex' : 'none',
                  flexDirection: 'column'
                }}
              >
                <div style={{marginBottom: '10px'}}>
                  <div style={{fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-hint)', marginBottom: '6px'}}>
                    Line Weight
                  </div>
                  <div style={{display: 'flex', gap: '4px', alignItems: 'center'}}>
                    {[1, 1.5, 2, 3, 4].map((w) => (
                      <button
                        key={w}
                        type="button"
                        style={{
                          flex: 1,
                          height: '24px',
                          border: edgeStrokeWidth === w ? '1px solid var(--color-accent)' : '1px solid var(--color-border-subtle, #cbd5e1)',
                          background: edgeStrokeWidth === w ? 'var(--color-accent-subtle)' : 'var(--color-bg-base)',
                          color: edgeStrokeWidth === w ? 'var(--color-accent)' : 'var(--color-text-primary)',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: edgeStrokeWidth === w ? 600 : 400,
                          cursor: 'pointer',
                          padding: 0
                        }}
                        onClick={() => {
                          setEdgeStrokeWidth(w);
                          document.dispatchEvent(new CustomEvent('edge-stroke-width-change', { detail: { width: w } }));
                        }}
                      >
                        {w}px
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-hint)', marginBottom: '6px'}}>
                  Arrow Color
                </div>
                <div style={{display: 'flex', gap: '6px', flexWrap: 'nowrap', alignItems: 'center'}}>
                  {[...fixedArrowColors, ...recentArrowColors.filter(c => !isDefaultColor(c))].map((color, i) => (
                    <button
                      key={'arrow-color-'+i}
                      type="button"
                      style={{
                        width: '20px',
                        height: '20px',
                        flexShrink: 0,
                        borderRadius: '50%',
                        background: color,
                        border: activeArrowColor?.toLowerCase() === color.toLowerCase() ? '2px solid var(--color-accent)' : '1px solid rgba(0,0,0,0.12)',
                        boxShadow: activeArrowColor?.toLowerCase() === color.toLowerCase() ? '0 0 0 2px var(--color-accent-subtle)' : 'none',
                        cursor: 'pointer'
                      }}
                      onClick={() => handleArrowColorSelect(color)}
                      title={color}
                    />
                  ))}
                  <button type="button" style={{width: '20px', height: '20px', flexShrink: 0, borderRadius: '50%', background: 'transparent', border: '1px dashed var(--color-border-subtle, #cbd5e1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', position: 'relative', cursor: 'pointer'}} title="Custom Color">
                    <span style={{fontSize: '12px', lineHeight: 1}}>+</span>
                    <input
                      type="color"
                      id="picker-arrow-color"
                      title="Arrow Color"
                      defaultValue="#0f172a"
                      style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer'}}
                      onInput={(e: any) => handleArrowColorSelect(e.target.value)}
                      onChange={(e: any) => handleArrowColorSelect(e.target.value)}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Zoom HUD */}
        <div className="canvas-hud">
          <div className="hud-zoom">
            <div className="hud-zoom__btn" id="hud-zoom-out" title="Zoom Out">−</div>
            <div className="hud-zoom__level" id="hud-zoom-level" title="Reset Zoom">100%</div>
            <div className="hud-zoom__btn" id="hud-zoom-in" title="Zoom In">+</div>
          </div>
          <div className="hud-btn" id="hud-fit" title="Fit to Screen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="4 14 4 20 10 20" /><polyline points="20 10 20 4 14 4" /><line x1={14} y1={10} x2={21} y2={3} /><line x1={3} y1={21} x2={10} y2={14} /></svg> Fit</div>
          <div className="hud-divider" />
          <div className="hud-icon-btn active" id="hud-snap" title="Snap to Grid"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="4" r="2" /><circle cx="12" cy="4" r="2" /><circle cx="20" cy="4" r="2" /><circle cx="4" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="20" cy="12" r="2" /><circle cx="4" cy="20" r="2" /><circle cx="12" cy="20" r="2" /><circle cx="20" cy="20" r="2" /></svg></div>
          <div className="hud-divider" />
          <div
            className="hud-btn"
            id="hud-reset"
            title="Reset Default Styles"
            onClick={(e) => {
              if ((e.currentTarget as HTMLElement).classList.contains('disabled')) return;
              setHudConfirm(c => c === 'reset' ? null : 'reset');
            }}
            style={{ color: 'var(--color-text-secondary)', padding: '0 6px', position: 'relative' }}
          >
            <RotateCcw size={15} />
          </div>
          <div
            className="hud-btn"
            id="hud-clear"
            title="Clear Canvas and Results"
            onClick={(e) => {
              if ((e.currentTarget as HTMLElement).classList.contains('disabled')) return;
              setHudConfirm(c => c === 'clear' ? null : 'clear');
            }}
            style={{ color: '#ef4444', padding: '0 6px', position: 'relative' }}
          >
            <Trash2 size={16} color="#ef4444" />
          </div>

          <div className="hud-divider" />
          <div
            className="hud-btn"
            id="hud-export-diagram"
            title="Export Publication Diagram (Vector SVG, 300/600 DPI, Journal B&W)"
            onClick={() => setIsExportModalOpen(true)}
            style={{ color: 'var(--color-accent)', padding: '0 8px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Download size={14} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>Export</span>
          </div>

          {/* Popover confirmation matching canvas-hud pill dimensions & aesthetic */}
          {hudConfirm === 'reset' && (
            <div
              className="canvas-hud-confirm-popover"
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                left: 0,
                right: 0,
                height: '38px',
                backgroundColor: 'var(--color-bg-elevated)',
                backdropFilter: 'blur(12px)',
                border: '1px solid var(--color-border-default)',
                boxShadow: 'var(--shadow-float)',
                borderRadius: 'var(--radius-xl)',
                padding: '4px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxSizing: 'border-box',
                whiteSpace: 'nowrap',
                zIndex: 100,
              }}
            >
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 500, fontSize: '12px' }}>
                Reset styles to default?
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setHudConfirm(null)}
                  style={{
                    height: '24px',
                    padding: '0 8px',
                    borderRadius: 'var(--radius-md, 6px)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-secondary)',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetModelStyles();
                    setHudConfirm(null);
                    setSaveToast('Model styles reset to default');
                    setTimeout(() => setSaveToast(null), 2500);
                  }}
                  style={{
                    height: '24px',
                    padding: '0 10px',
                    borderRadius: 'var(--radius-md, 6px)',
                    backgroundColor: 'var(--color-accent)',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(107, 78, 230, 0.3)',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          {hudConfirm === 'clear' && (
            <div
              className="canvas-hud-confirm-popover"
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                left: 0,
                right: 0,
                height: '38px',
                backgroundColor: 'var(--color-bg-elevated)',
                backdropFilter: 'blur(12px)',
                border: '1px solid var(--color-border-default)',
                boxShadow: 'var(--shadow-float)',
                borderRadius: 'var(--radius-xl)',
                padding: '4px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxSizing: 'border-box',
                whiteSpace: 'nowrap',
                zIndex: 100,
              }}
            >
              <span style={{ color: '#ef4444', fontWeight: 500, fontSize: '12px' }}>
                Clear canvas & results?
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setHudConfirm(null)}
                  style={{
                    height: '24px',
                    padding: '0 8px',
                    borderRadius: 'var(--radius-md, 6px)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-secondary)',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleConfirmClearCanvas();
                    setHudConfirm(null);
                  }}
                  style={{
                    height: '24px',
                    padding: '0 10px',
                    borderRadius: 'var(--radius-md, 6px)',
                    backgroundColor: '#ef4444',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(239, 68, 68, 0.3)',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
        {/* SVG Engine Engine */}
        <svg id="model-svg" width="100%" height="100%" style={{display: 'block'}} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={handleCanvasDrop}>
          <defs>
            <pattern id="dot-grid" width={20} height={20} patternUnits="userSpaceOnUse">
              <circle cx={2} cy={2} r={1.2} fill={canvasGridColors.dot} />
            </pattern>
            <pattern id="line-grid" width={20} height={20} patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke={canvasGridColors.line} strokeWidth="1" />
            </pattern>
            <marker id="arrowhead" markerWidth={10} markerHeight={7} refX={9} refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--color-text-secondary)" style={{pointerEvents: 'none'}} />
            </marker>
            <marker id="arrowhead-selected" markerWidth={10} markerHeight={7} refX={9} refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--color-accent)" style={{pointerEvents: 'none'}} />
            </marker>
            <marker id="arrow-solid" markerWidth={10} markerHeight={10} refX={9} refY={5} orient="auto">
              <polygon points="0 1.5, 9 5, 0 8.5" fill="currentColor" />
            </marker>
            <marker id="arrow-solid-selected" markerWidth={10} markerHeight={10} refX={9} refY={5} orient="auto">
              <polygon points="0 1.5, 9 5, 0 8.5" fill="var(--color-accent)" />
            </marker>
            <marker id="arrow-open" markerWidth={10} markerHeight={10} refX={8.5} refY={5} orient="auto">
              <path d="M 1 1.5 L 8.5 5 L 1 8.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
            <marker id="arrow-open-selected" markerWidth={10} markerHeight={10} refX={8.5} refY={5} orient="auto">
              <path d="M 1 1.5 L 8.5 5 L 1 8.5" fill="none" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
            <marker id="arrow-diamond" markerWidth={10} markerHeight={10} refX={9} refY={5} orient="auto">
              <polygon points="1 5, 5 1.8, 9 5, 5 8.2" fill="currentColor" />
            </marker>
            <marker id="arrow-diamond-selected" markerWidth={10} markerHeight={10} refX={9} refY={5} orient="auto">
              <polygon points="1 5, 5 1.8, 9 5, 5 8.2" fill="var(--color-accent)" />
            </marker>
            <marker id="arrow-circle" markerWidth={10} markerHeight={10} refX={8.5} refY={5} orient="auto">
              <circle cx={5} cy={5} r={3.5} fill="currentColor" />
            </marker>
            <marker id="arrow-circle-selected" markerWidth={10} markerHeight={10} refX={8.5} refY={5} orient="auto">
              <circle cx={5} cy={5} r={3.5} fill="var(--color-accent)" />
            </marker>
          </defs>
          <rect id="bg-color-rect" width="100%" height="100%" fill={settings.canvasBgColor || 'transparent'} />
          <rect id="bg-rect" width="100%" height="100%" fill={settings.canvasGrid === 'blank' ? 'transparent' : settings.canvasGrid === 'grid' ? 'url(#line-grid)' : 'url(#dot-grid)'} />
          <g id="zoom-layer">
            <g id="edges-layer" />
            <g id="nodes-layer" />
            <g id="guides-layer" />
          </g>
        </svg>
        <div className="canvas-empty-hint" id="canvas-empty-hint">Drag variables from the left panel to create constructs</div>


      </main>
    </div>{/* /app-body */}
  </div>{/* /view-model */}
  <div id="view-results" className="view-panel" style={{ display: currentView === 'results' ? 'flex' : 'none' }}>
    {/* ═══ APP BODY ═══ */}
    <div className="app-body">
      {/* ─── Results Hierarchy Tree (Left) ─── */}
      <ResultsNavigation
        activeTab={activeResultTab}
        onSelect={(id) => {
          setActiveResultTab(id);
          if (id === 'specific_indirect_effects' && availableAnalyses.includes('mediation') && !analysisResultsMap.mediation && !analysisLoading.mediation) {
            void loadAnalysis('mediation');
          }
        }}
        hasRedundancy={!!plsResults?.convergent_validity_redundancy}
        hasRunDetails={hasRunDetails(plsResults)}
        hasSpecificIndirect={!!(plsResults?.effects_decomposition?.specific_indirect?.length || plsResults?.structural?.specific_indirect?.length || availableAnalyses.includes('mediation') || analysisResultsMap.mediation)}
      />
      {/* ─── Center Results Area ─── */}
      <main className="results-main">
        {/* Secondary Header inline with filter search */}
        <div className="results-secondary-header">
          <button
            className="results-tool-btn results-tool-btn--accent"
            type="button"
            onClick={handleOpenSnapshotModal}
            title="Save results and model diagram as a snapshot in this study"
          >
            <History size={13} />
            <span>Save Snapshot</span>
          </button>
          <button
            className="results-tool-btn"
            type="button"
            onClick={handleCompare}
            title="Compare models and snapshots"
          >
            <GitCompare size={13} />
            <span>Compare</span>
          </button>
          <div className="subheader__dropdown-container" ref={exportDropdownRef}>
            <button
              className="results-tool-btn"
              type="button"
              aria-expanded={isExportMenuOpen}
              aria-haspopup="menu"
              onClick={() => setIsExportMenuOpen(prev => !prev)}
            >
              <Download size={13} />
              <span>Export</span>
              <span className="material-symbols-outlined" style={{ fontSize: 14, marginLeft: -2 }}>expand_more</span>
            </button>
            {isExportMenuOpen && (
              <div className="subheader__dropdown-menu" role="menu" style={{ left: 0, right: 'auto', minWidth: 190 }}>
                <button type="button" className="subheader__dropdown-item" role="menuitem" onClick={() => { setIsExportMenuOpen(false); handleExportCurrentTable(); }}>Current table as CSV</button>
                <button type="button" className="subheader__dropdown-item" role="menuitem" onClick={() => { setIsExportMenuOpen(false); void handleExportExcel(); }}>Current table as Excel</button>
                <button type="button" className="subheader__dropdown-item" role="menuitem" onClick={() => { setIsExportMenuOpen(false); handleExportHtml(); }}>Current table as HTML</button>
                <div style={{ height: 1, background: 'var(--color-border-subtle)', margin: '2px 0' }} />
                <button type="button" className="subheader__dropdown-item" role="menuitem" onClick={() => { setIsExportMenuOpen(false); handleCreateDataFile(); }}>Construct scores as CSV</button>
                <button type="button" className="subheader__dropdown-item" role="menuitem" onClick={() => { setIsExportMenuOpen(false); handleCreateReport(); }}>Print / save as PDF</button>
              </div>
            )}
          </div>
        </div>

        {/* Outdated Calculation Notice Banner */}
        {isModelOutdated && (
          <div
            style={{
              margin: '12px 24px 0',
              padding: '12px 16px',
              borderRadius: '8px',
              backgroundColor: 'rgba(234, 179, 8, 0.1)',
              border: '1px solid rgba(234, 179, 8, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              fontSize: '13px',
              color: 'var(--color-text-primary)',
              flexShrink: 0
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertTriangle size={20} color="#eab308" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Previous Calculation Results</div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                  The model was modified after these results were calculated. These figures correspond to a previous version of the model.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {lastCalculatedModel && (
                <button
                  type="button"
                  onClick={handleRevertToCalculatedModel}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: '6px',
                    border: '1px solid var(--color-border-default)',
                    background: 'var(--color-bg-base)',
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                  title="Revert model canvas to the state used for these results"
                >
                  <RotateCcw size={13} />
                  <span>Revert Canvas to This Model</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleCalculate(!!plsResults?.is_consistent)}
                disabled={isCalculating}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 500,
                  borderRadius: '6px',
                  border: 'none',
                  background: 'var(--color-accent)',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                {isCalculating ? 'Recalculating...' : 'Recalculate Current Model'}
              </button>
            </div>
          </div>
        )}

        {/* Header Area with Inline Title and Table Actions */}
        <div className="report-header">
          <div className="report-header__top">
            <div>
              <h1 className="report-header__title">
                {reportTabDetails.title}
                <span className="report-header__title-sub">{reportTabDetails.badge}</span>
                {plsResults?.is_consistent && <span className="report-header__title-sub">Consistent PLS</span>}
              </h1>
              <p className="report-header__subtitle">{reportTabDetails.subtitle}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <button
                className="results-tool-btn"
                type="button"
                onClick={handleCopyCurrentTable}
                title="Copy table to clipboard"
              >
                <Copy size={13} />
                <span>Copy Table</span>
              </button>

            </div>
          </div>
        </div>

        {/* Dynamic Table Area */}
        <div className="table-container">
          <div className="scientific-table-wrap">
            {activeResultTab === 'specific_indirect_effects' && (plsResults || analysisResultsMap.mediation || analysisLoading.mediation || analysisErrors.mediation) ? (
              <>
                {analysisLoading.mediation && <p className="results-empty-note">Loading mediation results...</p>}
                {analysisErrors.mediation && <p className="results-empty-note">{analysisErrors.mediation} <button type="button" onClick={() => void loadAnalysis('mediation')}>Retry</button></p>}
                <SpecificIndirectResults results={plsResults} mediation={analysisResultsMap.mediation} mediationStale={analysisStale.mediation} />
              </>
            ) : !plsResults ? (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
                <svg style={{ width: 48, height: 48, margin: '0 auto 16px', color: '#94a3b8' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 600, color: '#334155' }}>Model estimates unavailable</h3>
                <p style={{ margin: 0, fontSize: '13px' }}>Run the PLS-SEM algorithm to display the core model estimates. Any completed analysis output is shown below.</p>
              </div>
            ) : activeResultTab === 'hypotheses' ? (
              <HypothesisTestingPanel
                results={plsResults}
              />
            ) : activeResultTab === 'path_coefficients' ? (
              getTableMode('path_coefficients') === 'matrix' ? (
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>
                        <TableHeaderToggle
                          label="Source \ Target"
                          mode={getTableMode('path_coefficients')}
                          onToggle={(m) => setTableMode('path_coefficients', m)}
                        />
                      </th>
                      {targetConstructs.map(c => (
                        <th key={c}>{getConstructName(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultConstructs.map(sourceC => (
                      <tr key={sourceC}>
                        <td>
                          {renderConstructLabel(sourceC)}
                        </td>
                        {targetConstructs.map(targetC => {
                          const val = plsResults.structural?.path_coefficients?.[targetC]?.[sourceC];
                          if (val !== undefined && val !== null) {
                            return (
                              <td key={targetC} className="cell-sig">
                                <div className="cell-value">{fmt(val)}</div>
                              </td>
                            );
                          }
                          return <td key={targetC} className="cell-empty">—</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>
                        <TableHeaderToggle
                          label="Predictor (From)"
                          mode={getTableMode('path_coefficients')}
                          onToggle={(m) => setTableMode('path_coefficients', m)}
                        />
                      </th>
                      <th>Target (To)</th>
                      <th>Path Coefficient (β)</th>
                      <th>f² Effect Size</th>
                      <th>Inner VIF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(plsResults.structural?.path_coefficients || {}).flatMap(([target, preds]: [string, any]) =>
                      Object.entries(preds || {}).map(([pred, val]: [string, any]) => {
                        const f2 = plsResults.structural?.f_squared?.[target]?.[pred];
                        const vif = plsResults.structural?.inner_vif?.[target]?.[pred];
                        return (
                          <tr key={`${pred}->${target}`}>
                            <td>
                              {renderConstructLabel(pred)}
                            </td>
                            <td>
                              {renderConstructLabel(target)}
                            </td>
                            <td className="cell-sig">
                              <div className="cell-value">{fmt(val)}</div>
                            </td>
                            <td>{f2 !== undefined ? fmt(f2) : '—'}</td>
                            <td>{vif != null ? fmt(vif) : '—'}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )
            ) : activeResultTab === 'total_indirect_effects' ? (
              getTableMode('total_indirect_effects') === 'matrix' ? (
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>
                        <TableHeaderToggle
                          label="Source \ Target"
                          mode={getTableMode('total_indirect_effects')}
                          onToggle={(m) => setTableMode('total_indirect_effects', m)}
                        />
                      </th>
                      {targetConstructs.map(c => (
                        <th key={c}>{getConstructName(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultConstructs.map(sourceC => (
                      <tr key={sourceC}>
                        <td>
                          {renderConstructLabel(sourceC)}
                        </td>
                        {targetConstructs.map(targetC => {
                          if (sourceC === targetC) return <td key={targetC} className="cell-empty">—</td>;
                          const eff = (plsResults.structural?.effects || []).find((e: any) => e.from === sourceC && e.to === targetC);
                          if (eff && eff.indirect !== undefined && eff.indirect !== null) {
                            return (
                              <td key={targetC} className="cell-sig">
                                <div className="cell-value">{fmt(eff.indirect)}</div>
                              </td>
                            );
                          }
                          return <td key={targetC} className="cell-empty">—</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>
                        <TableHeaderToggle
                          label="Source (From)"
                          mode={getTableMode('total_indirect_effects')}
                          onToggle={(m) => setTableMode('total_indirect_effects', m)}
                        />
                      </th>
                      <th>Target (To)</th>
                      <th>Indirect Effect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(plsResults.structural?.effects || []).map((eff: any, idx: number) => (
                      <tr key={idx}>
                        <td>
                          {renderConstructLabel(eff.from)}
                        </td>
                        <td>
                          {renderConstructLabel(eff.to)}
                        </td>
                        <td className="cell-sig">
                          <div className="cell-value">{fmt(eff.indirect)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : activeResultTab === 'total_effects' ? (
              getTableMode('total_effects') === 'matrix' ? (
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>
                        <TableHeaderToggle
                          label="Source \ Target"
                          mode={getTableMode('total_effects')}
                          onToggle={(m) => setTableMode('total_effects', m)}
                        />
                      </th>
                      {targetConstructs.map(c => (
                        <th key={c}>{getConstructName(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultConstructs.map(sourceC => (
                      <tr key={sourceC}>
                        <td>
                          {renderConstructLabel(sourceC)}
                        </td>
                        {targetConstructs.map(targetC => {
                          if (sourceC === targetC) return <td key={targetC} className="cell-empty">—</td>;
                          const eff = (plsResults.structural?.effects || []).find((e: any) => e.from === sourceC && e.to === targetC);
                          if (eff && eff.total !== undefined && eff.total !== null) {
                            return (
                              <td key={targetC} className="cell-sig">
                                <div className="cell-value">{fmt(eff.total)}</div>
                              </td>
                            );
                          }
                          return <td key={targetC} className="cell-empty">—</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>
                        <TableHeaderToggle
                          label="Source (From)"
                          mode={getTableMode('total_effects')}
                          onToggle={(m) => setTableMode('total_effects', m)}
                        />
                      </th>
                      <th>Target (To)</th>
                      <th>Direct Effect</th>
                      <th>Indirect Effect</th>
                      <th>Total Effect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(plsResults.structural?.effects || []).map((eff: any, idx: number) => (
                      <tr key={idx}>
                        <td>
                          {renderConstructLabel(eff.from)}
                        </td>
                        <td>
                          {renderConstructLabel(eff.to)}
                        </td>
                        <td>{fmt(eff.direct)}</td>
                        <td>{fmt(eff.indirect)}</td>
                        <td className="cell-sig">
                          <div className="cell-value">{fmt(eff.total)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : activeResultTab === 'outer_loadings' ? (
              getTableMode('outer_loadings') === 'matrix' ? (
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>
                        <TableHeaderToggle
                          label="Indicator \ Construct"
                          mode={getTableMode('outer_loadings')}
                          onToggle={(m) => setTableMode('outer_loadings', m)}
                        />
                      </th>
                      {resultConstructs.map(c => (
                        <th key={c}>{getConstructName(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allIndicators.map(iid => (
                      <tr key={iid}>
                        <td><strong>{getIndicatorName(iid)}</strong></td>
                        {resultConstructs.map(cid => {
                          const val = plsResults.measurement?.outer_loadings?.[cid]?.[iid];
                          if (val !== undefined && val !== null) {
                            const num = Number(val);
                            const isHigh = num >= 0.708;
                            return (
                              <td key={cid} className={isHigh ? 'cell-sig' : 'cell-ns'}>
                                <div className="cell-value">{fmt(num)}</div>
                              </td>
                            );
                          }
                          return <td key={cid} className="cell-empty">—</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>
                        <TableHeaderToggle
                          label="Construct"
                          mode={getTableMode('outer_loadings')}
                          onToggle={(m) => setTableMode('outer_loadings', m)}
                        />
                      </th>
                      <th>Indicator</th>
                      <th>Outer Loading (λ)</th>
                      <th>Indicator Reliability (λ²)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(plsResults.measurement?.outer_loadings || {}).flatMap(([cid, loads]: [string, any]) =>
                      Object.entries(loads || {}).map(([iid, val]: [string, any]) => {
                        const loadNum = Number(val);
                        const rel = plsResults.measurement?.indicator_reliability?.[cid]?.[iid] ?? (loadNum * loadNum);
                        const isHigh = loadNum >= 0.708;
                        return (
                          <tr key={`${cid}-${iid}`}>
                            <td>
                              <div className="construct-label">
                                <div className="construct-dot" style={{ background: constructPalette[cid] || '#6366f1' }} />
                                <span className="construct-name">{getConstructName(cid)}</span>
                              </div>
                            </td>
                            <td><strong>{getIndicatorName(iid)}</strong></td>
                            <td className={isHigh ? 'cell-sig' : 'cell-ns'}>
                              <div className="cell-value">{fmt(loadNum)}</div>
                            </td>
                            <td>{fmt(rel)}</td>
                            <td>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 600,
                                backgroundColor: isHigh ? '#dcfce7' : (loadNum >= 0.6 ? '#fef3c7' : '#fee2e2'),
                                color: isHigh ? '#166534' : (loadNum >= 0.6 ? '#92400e' : '#991b1b')
                              }}>
                                {isHigh ? 'Established (λ ≥ 0.708)' : (loadNum >= 0.6 ? 'Acceptable' : 'Low (< 0.60)')}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )
            ) : activeResultTab === 'outer_weights' ? (
              getTableMode('outer_weights') === 'matrix' ? (
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>
                        <TableHeaderToggle
                          label="Indicator \ Construct"
                          mode={getTableMode('outer_weights')}
                          onToggle={(m) => setTableMode('outer_weights', m)}
                        />
                      </th>
                      {resultConstructs.map(c => (
                        <th key={c}>{getConstructName(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allIndicators.map(iid => (
                      <tr key={iid}>
                        <td><strong>{getIndicatorName(iid)}</strong></td>
                        {resultConstructs.map(cid => {
                          const val = plsResults.measurement?.outer_weights?.[cid]?.[iid];
                          if (val !== undefined && val !== null) {
                            return (
                              <td key={cid} className="cell-sig">
                                <div className="cell-value">{fmt(val)}</div>
                              </td>
                            );
                          }
                          return <td key={cid} className="cell-empty">—</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>
                        <TableHeaderToggle
                          label="Construct"
                          mode={getTableMode('outer_weights')}
                          onToggle={(m) => setTableMode('outer_weights', m)}
                        />
                      </th>
                      <th>Indicator</th>
                      <th>Outer Weight (w)</th>
                      <th>Outer VIF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(plsResults.measurement?.outer_weights || {}).flatMap(([cid, weights]: [string, any]) =>
                      Object.entries(weights || {}).map(([iid, val]: [string, any]) => {
                        const vif = plsResults.measurement?.outer_vif?.[cid]?.[iid];
                        return (
                          <tr key={`${cid}-${iid}`}>
                            <td>
                              <div className="construct-label">
                                <div className="construct-dot" style={{ background: constructPalette[cid] || '#6366f1' }} />
                                <span className="construct-name">{getConstructName(cid)}</span>
                              </div>
                            </td>
                            <td><strong>{getIndicatorName(iid)}</strong></td>
                            <td className="cell-sig">
                              <div className="cell-value">{fmt(val)}</div>
                            </td>
                            <td>{vif != null ? fmt(vif) : '—'}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )
            ) : activeResultTab === 'r_squared' ? (
              <table className="scientific-table">
                <thead>
                  <tr>
                    <th>Endogenous Construct</th>
                    <th>R-Square (R²)</th>
                    <th>R-Square Adjusted</th>
                    <th>Variance Explained</th>
                    <th>Explanatory Power</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(plsResults.structural?.r_squared || {}).map(([cid, val]: [string, any]) => {
                    const r2 = Number(val);
                    const r2Adj = Number(plsResults.structural?.r_squared_adj?.[cid] ?? r2);
                    const power = r2 >= 0.67 ? 'Substantial' : (r2 >= 0.33 ? 'Moderate' : (r2 >= 0.19 ? 'Weak' : 'Very weak'));
                    return (
                      <tr key={cid}>
                        <td>
                          <div className="construct-label">
                            <div className="construct-dot" style={{ background: constructPalette[cid] || '#6366f1' }} />
                            <span className="construct-name">{getConstructName(cid)}</span>
                          </div>
                        </td>
                        <td className="cell-sig">
                          <div className="cell-value">{fmt(r2)}</div>
                        </td>
                        <td>{fmt(r2Adj)}</td>
                        <td>{fmt(r2 * 100)}%</td>
                        <td>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            backgroundColor: r2 >= 0.33 ? '#dcfce7' : '#fef3c7',
                            color: r2 >= 0.33 ? '#166534' : '#92400e'
                          }}>
                            {power}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : activeResultTab === 'f_squared' ? (
              getTableMode('f_squared') === 'matrix' ? (
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>
                        <TableHeaderToggle
                          label="Predictor \ Target"
                          mode={getTableMode('f_squared')}
                          onToggle={(m) => setTableMode('f_squared', m)}
                        />
                      </th>
                      {targetConstructs.map(c => (
                        <th key={c}>{getConstructName(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultConstructs.map(pred => (
                      <tr key={pred}>
                        <td>
                          {renderConstructLabel(pred)}
                        </td>
                        {targetConstructs.map(tgt => {
                          const val = plsResults.structural?.f_squared?.[tgt]?.[pred];
                          if (val !== undefined && val !== null) {
                            const f2 = Number(val);
                            const isHigh = f2 >= 0.15;
                            return (
                              <td key={tgt} className={isHigh ? 'cell-sig' : ''}>
                                <div className="cell-value">{fmt(f2)}</div>
                              </td>
                            );
                          }
                          return <td key={tgt} className="cell-empty">—</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>
                        <TableHeaderToggle
                          label="Predictor (From)"
                          mode={getTableMode('f_squared')}
                          onToggle={(m) => setTableMode('f_squared', m)}
                        />
                      </th>
                      <th>Target (To)</th>
                      <th>f² Value</th>
                      <th>Effect Size Interpretation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(plsResults.structural?.f_squared || {}).flatMap(([target, preds]: [string, any]) =>
                      Object.entries(preds || {}).map(([pred, val]: [string, any]) => {
                        const f2 = Number(val);
                        const interp = f2 >= 0.35 ? 'Large effect (≥ 0.35)' : (f2 >= 0.15 ? 'Medium effect (≥ 0.15)' : (f2 >= 0.02 ? 'Small effect (≥ 0.02)' : 'Negligible (< 0.02)'));
                        return (
                          <tr key={`${pred}->${target}`}>
                            <td>
                              {renderConstructLabel(pred)}
                            </td>
                            <td>
                              {renderConstructLabel(target)}
                            </td>
                            <td className="cell-sig">
                              <div className="cell-value">{fmt(f2)}</div>
                            </td>
                            <td>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 600,
                                backgroundColor: f2 >= 0.15 ? '#dcfce7' : (f2 >= 0.02 ? '#fef3c7' : '#f1f5f9'),
                                color: f2 >= 0.15 ? '#166534' : (f2 >= 0.02 ? '#92400e' : '#475569')
                              }}>
                                {interp}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )) : activeResultTab === 'reliability' ? (
              <table className="scientific-table">
                <thead>
                  <tr>
                    <th>Construct</th>
                    <th>Cronbach's Alpha (α)</th>
                    <th>Composite Reliability (CR)</th>
                    <th>rho_A (ρA)</th>
                    <th>AVE</th>
                    <th>Evaluation</th>
                  </tr>
                </thead>
                <tbody>
                  {measurementConstructs.map(cid => {
                    const rv = plsResults.reliability_and_validity || {};
                    const construct = (plsResults.latent_variables || []).find((item: any) => item.id === cid);
                    const formative = String(construct?.type || '').toLowerCase() === 'formative';
                    const alpha = formative ? null : rv.cronbachs_alpha?.[cid] ?? null;
                    const cr = formative ? null : rv.composite_reliability?.[cid] ?? null;
                    const rhoA = formative ? null : rv.rho_a?.[cid] ?? null;
                    const ave = formative ? null : rv.ave?.[cid] ?? null;
                    const isGood = cr == null || ave == null ? null : cr >= 0.7 && ave >= 0.5;
                    return (
                      <tr key={cid}>
                        <td>
                          <div className="construct-label">
                            <div className="construct-dot" style={{ background: constructPalette[cid] || '#6366f1' }} />
                            <span className="construct-name">{getConstructName(cid)}</span>
                          </div>
                        </td>
                        <td className={alpha == null ? '' : alpha >= 0.7 ? 'cell-sig' : 'cell-ns'}>{fmt(alpha)}</td>
                        <td className={cr == null ? '' : cr >= 0.7 ? 'cell-sig' : 'cell-ns'}>{fmt(cr)}</td>
                        <td>{fmt(rhoA)}</td>
                        <td className={ave == null ? '' : ave >= 0.5 ? 'cell-sig' : 'cell-ns'}>{fmt(ave)}</td>
                        <td>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            backgroundColor: isGood == null ? 'var(--color-bg-raised)' : isGood ? '#dcfce7' : '#fee2e2',
                            color: isGood == null ? 'var(--color-text-muted)' : isGood ? '#166534' : '#991b1b'
                          }}>
                            {formative ? 'Not applicable to formative constructs' : isGood == null ? 'Not available' : isGood ? 'Meets CR and AVE references' : 'Review model'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : activeResultTab === 'discriminant' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                <div>
                  <h4 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>
                    Heterotrait-Monotrait Ratio (HTMT)
                    <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 400, color: '#64748b' }}>(Threshold &lt; 0.85 / 0.90)</span>
                  </h4>
                  {getTableMode('htmt') === 'matrix' ? (
                    <table className="scientific-table">
                      <thead>
                        <tr>
                          <th>
                            <TableHeaderToggle
                              label="Construct"
                              mode={getTableMode('htmt')}
                              onToggle={(m) => setTableMode('htmt', m)}
                            />
                          </th>
                          {measurementConstructs.map(c => <th key={c}>{getConstructName(c)}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {measurementConstructs.map(c1 => (
                          <tr key={c1}>
                            <td>
                              <div className="construct-label">
                                <div className="construct-dot" style={{ background: constructPalette[c1] || '#6366f1' }} />
                                <span className="construct-name">{getConstructName(c1)}</span>
                              </div>
                            </td>
                            {measurementConstructs.map(c2 => {
                              if (c1 === c2) return <td key={c2} className="cell-empty">—</td>;
                              const htmtVal = plsResults.reliability_and_validity?.htmt?.[c1]?.[c2];
                              if (htmtVal !== undefined) {
                                const num = Number(htmtVal);
                                const ok = num < 0.85;
                                return (
                                  <td key={c2} className={ok ? 'cell-sig' : 'cell-ns'}>
                                    <div className="cell-value">{fmt(num)}</div>
                                  </td>
                                );
                              }
                              return <td key={c2} className="cell-empty">—</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="scientific-table">
                      <thead>
                        <tr>
                          <th>
                            <TableHeaderToggle
                              label="Construct 1"
                              mode={getTableMode('htmt')}
                              onToggle={(m) => setTableMode('htmt', m)}
                            />
                          </th>
                          <th>Construct 2</th>
                          <th>HTMT Ratio</th>
                          <th>Evaluation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {measurementConstructs.flatMap((c1, i) =>
                          measurementConstructs.slice(i + 1).map(c2 => {
                            const val = plsResults.reliability_and_validity?.htmt?.[c1]?.[c2] ??
                                        plsResults.reliability_and_validity?.htmt?.[c2]?.[c1];
                            if (val === undefined || val === null) return null;
                            const num = Number(val);
                            const isOk = num < 0.85;
                            const isAcceptable = num < 0.90;
                            return (
                              <tr key={`${c1}-${c2}`}>
                                <td>
                                  <div className="construct-label">
                                    <div className="construct-dot" style={{ background: constructPalette[c1] || '#6366f1' }} />
                                    <span className="construct-name">{getConstructName(c1)}</span>
                                  </div>
                                </td>
                                <td>
                                  <div className="construct-label">
                                    <div className="construct-dot" style={{ background: constructPalette[c2] || '#0ea5e9' }} />
                                    <span className="construct-name">{getConstructName(c2)}</span>
                                  </div>
                                </td>
                                <td className={isOk ? 'cell-sig' : 'cell-ns'}>
                                  <div className="cell-value">{fmt(num)}</div>
                                </td>
                                <td>
                                  <span style={{
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    backgroundColor: isOk ? '#dcfce7' : (isAcceptable ? '#fef3c7' : '#fee2e2'),
                                    color: isOk ? '#166534' : (isAcceptable ? '#92400e' : '#991b1b')
                                  }}>
                                    {isOk ? 'Established (< 0.85)' : (isAcceptable ? 'Acceptable (< 0.90)' : 'High (≥ 0.90)')}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        ).filter(Boolean)}
                      </tbody>
                    </table>
                  )}
                </div>

                <div>
                  <h4 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>
                    Fornell-Larcker Criterion
                    <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 400, color: '#64748b' }}>(Diagonal: √AVE, Off-diagonal: construct correlations)</span>
                  </h4>
                  <table className="scientific-table">
                    <thead>
                      <tr>
                        <th>Construct</th>
                        {measurementConstructs.map(c => <th key={c}>{getConstructName(c)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {measurementConstructs.map(c1 => (
                        <tr key={c1}>
                          <td>
                            <div className="construct-label">
                              <div className="construct-dot" style={{ background: constructPalette[c1] || '#6366f1' }} />
                              <span className="construct-name">{getConstructName(c1)}</span>
                            </div>
                          </td>
                          {measurementConstructs.map(c2 => {
                            const flVal = plsResults.reliability_and_validity?.fornell_larcker?.[c1]?.[c2];
                            if (flVal !== undefined) {
                              const isDiag = c1 === c2;
                              return (
                                <td key={c2} style={isDiag ? { backgroundColor: '#f1f5f9', fontWeight: 700 } : {}}>
                                  <div>{fmt(flVal)}</div>
                                </td>
                              );
                            }
                            return <td key={c2} className="cell-empty">—</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : activeResultTab === 'collinearity' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                <div>
                  <h4 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>Inner Model VIF (Predictors of Endogenous Constructs)</h4>
                  <table className="scientific-table">
                    <thead>
                      <tr>
                        <th>Target Construct</th>
                        <th>Predictor Construct</th>
                        <th>Inner VIF</th>
                        <th>Collinearity Evaluation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(plsResults.structural?.inner_vif || {}).flatMap(([target, preds]: [string, any]) =>
                        Object.entries(preds || {}).map(([pred, val]: [string, any]) => {
                          const vif = Number(val);
                          const ok = vif < 3.3;
                          return (
                            <tr key={`${pred}->${target}`}>
                              <td>{renderConstructLabel(target)}</td>
                              <td>{renderConstructLabel(pred)}</td>
                              <td className={ok ? 'cell-sig' : 'cell-ns'}>{fmt(vif)}</td>
                              <td>
                                <span style={{
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  backgroundColor: ok ? '#dcfce7' : '#fee2e2',
                                  color: ok ? '#166534' : '#991b1b'
                                }}>
                                  {ok ? 'No Collinearity Issue (VIF < 3.3)' : 'Potential Multicollinearity (VIF ≥ 3.3)'}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>Outer Model VIF (Indicators)</h4>
                  <table className="scientific-table">
                    <thead>
                      <tr>
                        <th>Construct</th>
                        <th>Indicator</th>
                        <th>Outer VIF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(plsResults.measurement?.outer_vif || {}).flatMap(([cid, vifs]: [string, any]) =>
                        Object.entries(vifs || {}).map(([iid, val]: [string, any]) => (
                          <tr key={`${cid}-${iid}`}>
                            <td>{renderConstructLabel(cid)}</td>
                            <td><strong>{getIndicatorName(iid)}</strong></td>
                            <td>{fmt(val)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : activeResultTab === 'convergent_validity_redundancy' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>
                    Convergent Validity of Formative Constructs (Redundancy Analysis)
                  </h4>
                </div>
                <table className="scientific-table">
                  <thead>
                    <tr>
                      <th>Formative construct</th>
                      <th>Global item construct</th>
                      <th>Path coefficient</th>
                      {plsResults.convergent_validity_redundancy?.some((r: any) => r.bootstrap) && (
                        <>
                          <th>Mean</th>
                          <th>SD</th>
                          <th>t Value</th>
                          <th>p Value</th>
                          <th>95% CI</th>
                        </>
                      )}
                      <th>R² of global item</th>
                      <th>Threshold</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(plsResults.convergent_validity_redundancy || []).map((row: any, idx: number) => {
                      const isSupported = row.supported || (row.path_coefficient >= 0.70);
                      const b = row.bootstrap;
                      return (
                        <tr key={idx}>
                          <td>
                            <strong>{row.formative_construct}</strong>
                          </td>
                          <td>
                            <strong>{row.global_construct}</strong>
                          </td>
                          <td className="cell-sig">
                            <div className="cell-value">{fmt(row.path_coefficient)}</div>
                          </td>
                          {plsResults.convergent_validity_redundancy?.some((r: any) => r.bootstrap) && (
                            <>
                              <td>{b ? fmt(b.mean) : '—'}</td>
                              <td>{b ? fmt(b.se) : '—'}</td>
                              <td>{b ? fmt(b.t_stat) : '—'}</td>
                              <td className={b && b.p_value < 0.05 ? 'cell-sig' : ''}>
                                {b ? fmtP(b.p_value) : '—'}
                              </td>
                              <td>
                                {b && b.ci_low !== undefined ? `[${fmt(b.ci_low)}, ${fmt(b.ci_high)}]` : '—'}
                              </td>
                            </>
                          )}
                          <td>{fmt(row.r_squared)}</td>
                          <td>&ge; 0.70</td>
                          <td>
                            <span style={{
                              padding: '3px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              backgroundColor: isSupported ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: isSupported ? '#15803d' : '#b91c1c',
                              border: `1px solid ${isSupported ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                            }}>
                              {row.result || (isSupported ? 'Supported (>= 0.70)' : 'Not supported (< 0.70)')}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--color-bg-base)',
                  border: '1px solid var(--color-border-subtle)',
                  fontSize: '12px',
                  lineHeight: '1.5',
                  color: 'var(--color-text-secondary)'
                }}>
                  <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--color-text-primary)' }}>
                    Assessment Guide (Hair et al., 2022)
                  </div>
                  <div>
                    Hair et al. (2022): path coefficient of at least 0.70 (R² of at least 0.50). If not met, consider adding indicators that cover the domain of the construct.
                  </div>
                </div>
              </div>
            ) : activeResultTab === 'construct_scores' ? (
              <table className="scientific-table">
                <thead>
                  <tr>
                    <th>Observation #</th>
                    {resultConstructs.map(c => (
                      <th key={c}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <span>{getConstructName(c)}</span>
                          {isInteractionConstruct(c) && (
                            <span
                              className="interaction-badge"
                              style={{
                                fontSize: '9px',
                                fontWeight: 600,
                                padding: '1px 4px',
                                borderRadius: '3px',
                                background: 'rgba(236, 72, 153, 0.12)',
                                color: '#db2777',
                                textTransform: 'uppercase',
                              }}
                            >
                              interaction
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: Math.min(25, (plsResults.construct_scores?.[resultConstructs[0]] || []).length) }).map((_, rIdx) => (
                    <tr key={rIdx}>
                      <td><strong>Case #{rIdx + 1}</strong></td>
                      {resultConstructs.map(c => {
                        const val = plsResults.construct_scores?.[c]?.[rIdx];
                        return <td key={c}>{fmt(val)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : activeResultTab === 'bootstrap_significance' ? (
              !plsResults.significance ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
                  <svg style={{ width: 48, height: 48, margin: '0 auto 16px', color: '#94a3b8' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M18 20V10M12 20V4M6 20v-6" />
                  </svg>
                  <h3 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 600, color: '#334155' }}>No Bootstrapping Run Yet</h3>
                  <p style={{ margin: 0, fontSize: '13px' }}>Click the <strong>Bootstrap</strong> button in the top bar to run multi-core significance testing for standard errors, t-statistics, and p-values.</p>
                </div>
              ) : (
                <div>
                  {/* Summary Bar */}
                  <div style={{
                    display: 'flex',
                    gap: '20px',
                    padding: '10px 16px',
                    backgroundColor: 'var(--color-bg-raised, #f8fafc)',
                    border: '1px solid var(--color-border-subtle, #e2e8f0)',
                    borderRadius: 'var(--radius-sm, 6px)',
                    marginBottom: '18px',
                    alignItems: 'center',
                    fontSize: '12px',
                    color: 'var(--color-text-secondary, #334155)',
                  }}>
                    <span>Bootstrap Subsamples: <strong style={{ color: 'var(--color-text-primary)' }}>{plsResults.significance.n_boot?.toLocaleString()}</strong></span>
                    <span>Test: <strong style={{ color: 'var(--color-text-primary)' }}>Two-Tailed (α = 0.05)</strong></span>
                    <span>Confidence Interval: <strong style={{ color: 'var(--color-text-primary)' }}>95% Percentile</strong></span>
                  </div>

                  {/* Path Coefficients Significance Table */}
                  <h4 style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    Structural Path Significance
                  </h4>
                  <table className="scientific-table" style={{ marginBottom: '28px' }}>
                    <thead>
                      <tr>
                        <th>Path (Predictor → Target)</th>
                        <th>Original (β)</th>
                        <th>Sample Mean</th>
                        <th>Std Error (SE)</th>
                        <th>t-Statistic</th>
                        <th>p-Value</th>
                        <th>95% Confidence Interval</th>
                        <th>Significance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(plsResults.significance.paths || []).map((p: any, idx: number) => {
                        const cellSigClass = p.p_value < 0.001 ? 'cell-sig--p001' : (p.p_value < 0.01 ? 'cell-sig--p01' : (p.p_value < 0.05 ? 'cell-sig--p05' : ''));
                        return (
                          <tr key={idx}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {renderConstructLabel(p.from, p.from_name)}
                                <span style={{ color: '#94a3b8' }}>→</span>
                                {renderConstructLabel(p.to, p.to_name)}
                              </div>
                            </td>
                            <td className={cellSigClass}>
                              <div className="cell-value">{fmt(p.original)}</div>
                            </td>
                            <td>{fmt(p.mean)}</td>
                            <td>{fmt(p.se)}</td>
                            <td><strong>{fmt(p.t_stat)}</strong></td>
                            <td className={cellSigClass} style={{ fontWeight: 600 }}>
                              {fmtP(p.p_value)}
                            </td>
                            <td>[{fmt(p.ci_low)}, {fmt(p.ci_high)}]</td>
                            <td>
                              {p.p_value < 0.001 ? (
                                <span className="sig-badge sig-badge--p001">p &lt; 0.001</span>
                              ) : p.p_value < 0.01 ? (
                                <span className="sig-badge sig-badge--p01">p &lt; 0.01</span>
                              ) : p.p_value < 0.05 ? (
                                <span className="sig-badge sig-badge--p05">p &lt; 0.05</span>
                              ) : (
                                <span className="sig-badge sig-badge--ns">ns</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Outer Loadings Significance Table */}
                  <h4 style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    Outer Loadings Significance
                  </h4>
                  <table className="scientific-table">
                    <thead>
                      <tr>
                        <th>Construct</th>
                        <th>Indicator</th>
                        <th>Outer Loading (λ)</th>
                        <th>Sample Mean</th>
                        <th>Std Error (SE)</th>
                        <th>t-Statistic</th>
                        <th>p-Value</th>
                        <th>95% Confidence Interval</th>
                        <th>Sig.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(plsResults.significance.loadings || []).map((l: any, idx: number) => {
                        const cellSigClass = l.p_value < 0.001 ? 'cell-sig--p001' : (l.p_value < 0.01 ? 'cell-sig--p01' : (l.p_value < 0.05 ? 'cell-sig--p05' : ''));
                        return (
                          <tr key={idx}>
                            <td>{l.construct_name || getConstructName(l.construct)}</td>
                            <td><strong>{l.indicator_name || getIndicatorName(l.indicator)}</strong></td>
                            <td className={cellSigClass}>
                              <div className="cell-value">{fmt(l.original)}</div>
                            </td>
                            <td>{fmt(l.mean)}</td>
                            <td>{fmt(l.se)}</td>
                            <td>{fmt(l.t_stat)}</td>
                            <td className={cellSigClass} style={{ fontWeight: 600 }}>
                              {fmtP(l.p_value)}
                            </td>
                            <td>[{fmt(l.ci_low)}, {fmt(l.ci_high)}]</td>
                            <td>
                              {l.p_value < 0.001 ? (
                                <span className="sig-badge sig-badge--p001">p &lt; 0.001</span>
                              ) : l.p_value < 0.01 ? (
                                <span className="sig-badge sig-badge--p01">p &lt; 0.01</span>
                              ) : l.p_value < 0.05 ? (
                                <span className="sig-badge sig-badge--p05">p &lt; 0.05</span>
                              ) : (
                                <span className="sig-badge sig-badge--ns">ns</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="sig-legend-minimal">
                    <span className="sig-legend-minimal__label">Significance:</span>
                    <div className="sig-legend-minimal__item"><span className="sig-legend-minimal__dot sig-legend-minimal__dot--p001" /> p &lt; 0.001</div>
                    <div className="sig-legend-minimal__item"><span className="sig-legend-minimal__dot sig-legend-minimal__dot--p01" /> p &lt; 0.01</div>
                    <div className="sig-legend-minimal__item"><span className="sig-legend-minimal__dot sig-legend-minimal__dot--p05" /> p &lt; 0.05</div>
                    <div className="sig-legend-minimal__item"><span className="sig-legend-minimal__dot sig-legend-minimal__dot--ns" /> ns (≥ 0.05)</div>
                    <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--color-text-muted)' }}>{plsResults.significance.settings?.tails === 'one' ? `One-sided ${plsResults.significance.settings?.direction === 'negative' ? 'negative' : 'positive'}` : 'Two-sided'} bootstrap test ({plsResults.significance.n_boot?.toLocaleString()} subsamples)</span>
                  </div>
                </div>
              )
            ) : activeResultTab === 'run_details' ? (
              <RunDetails results={plsResults} />
            ) : activeResultTab === 'model_fit' ? (
              <ModelFitResults results={plsResults} />
            ) : null}
          </div>
          {activeResultTab === 'path_coefficients' && (
            <InlineAnalysisResults results={plsResults} analyses={analysisResultsMap} available={availableAnalyses} latest={latestAnalysis}
              loading={analysisLoading} errors={analysisErrors} stale={analysisStale} onLoad={id => void loadAnalysis(id)} />
          )}
        </div>
      </main>
    </div>{/* /app-body */}
  </div>{/* /view-results */}

  {modelSettingsOpen && <ModelCalculationModal
    isOpen={modelSettingsOpen}
    consistent={modelSettingsConsistent}
    initialSettings={plsResults?.settings}
    spec={exportModelSpec()}
    datasetHeaders={activeDataset?.variables?.map(v => v.name)}
    datasetRows={activeDataset?.rows}
    onClose={() => setModelSettingsOpen(false)}
    onRun={(settings) => { setModelSettingsOpen(false); void handleCalculate(modelSettingsConsistent, settings); }}
  />}

  <BootstrapModal
    isOpen={isBootstrapModalOpen}
    consistent={bootstrapConsistent}
    projectPath={activeStudy?.path || ''}
    spec={exportModelSpec()}
    modelId={effectiveModelId || undefined}
    diagramLayout={getModelCanvasState()}
    initialSettings={plsResults?.settings}
    datasetHeaders={activeDataset?.variables?.map(v => v.name)}
    datasetRows={activeDataset?.rows}
    datasetName={activeDataset?.filename}
    onComplete={(results) => {
      setPlsResults(results);
      plsResultsRef.current = results;
      setCanvasResults(results);
      const calculatedSnapshot = { spec: exportModelSpec(), layout: getModelCanvasState() };
      setLastCalculatedModel(calculatedSnapshot);
      lastCalculatedModelRef.current = calculatedSnapshot;
      setIsModelOutdated(false);
      setActiveResultTab('bootstrap_significance');
      const viewSlider = document.getElementById('main-view-slider');
      if (viewSlider) {
        (viewSlider as HTMLElement).style.display = 'flex';
      }
      switchView('results');
      setValidationSuccessToast('Bootstrapping complete! Results updated.');
      setTimeout(() => setValidationSuccessToast(null), 3500);
    }}
    onClose={() => setIsBootstrapModalOpen(false)}
  />

  {isCompareModalOpen && <ModelComparisonModal isOpen onClose={() => setIsCompareModalOpen(false)} projectPath={activeStudy?.path || ''} studyName={activeStudy?.name} />}

  {isAnalysisModalOpen && <AnalysisModal
    isOpen={isAnalysisModalOpen}
    analysisType={analysisModalType === 'mga_consistent' ? 'mga' : analysisModalType}
    initialSettings={plsResults?.settings}
    consistent={analysisModalType === 'mga_consistent'}
    projectPath={activeStudy?.path || ''}
    modelId={effectiveModelId || undefined}
    datasetId={activeDataset?.id || undefined}
    spec={exportModelSpec()}
    datasetHeaders={activeDataset?.variables?.map(v => v.name)}
    datasetRows={activeDataset?.rows}
    onComplete={(type, results) => {
      setIsAnalysisModalOpen(false);
      setAnalysisResultsMap(previous => ({ ...previous, [type]: results }));
      setAvailableAnalyses(previous => Array.from(new Set([...previous, type])));
      setAnalysisStale(previous => ({ ...previous, [type]: false }));
      setLatestAnalysis({ id: type, revision: Date.now() });
      setActiveResultTab('path_coefficients');
      switchView('results');
      setValidationSuccessToast('Calculation completed successfully!');
      setTimeout(() => setValidationSuccessToast(null), 3500);
    }}
    onClose={() => setIsAnalysisModalOpen(false)}
  />}

  <PermutationDialog
    isOpen={isPermutationModalOpen}
    onClose={() => setIsPermutationModalOpen(false)}
    projectPath={activeStudy?.path || undefined}
    modelId={effectiveModelId || undefined}
    datasetId={activeDataset?.id || undefined}
    spec={exportModelSpec()}
    columns={activeDataset?.variables?.map(v => v.name) || []}
    rows={activeDataset?.rows || []}
    dataGroups={activeDataset?.dataGroups || []}
    initialSettings={plsResults?.settings}
    onComplete={(report) => {
      setIsPermutationModalOpen(false);
      cacheMgaReport(report);
      const studyKey = activeStudy?.path || effectiveStudyId || '';
      if (studyKey) {
        addStudyMgaReport(studyKey, {
          id: report.id,
          reportType: report.reportType,
          title: report.title,
          modelKey: report.modelId,
          datasetId: report.datasetId,
          createdAt: report.createdAt,
        });
      }
      openTab({
        type: 'mga-report',
        title: report.title,
        reportId: report.id,
        reportType: report.reportType,
        modelId: effectiveModelId,
        studyId: effectiveStudyId,
        workspaceId: currentTab?.workspaceId || activeWorkspaceId,
      });
    }}
  />

  <MgaDialog
    isOpen={isMgaModalOpen}
    onClose={() => setIsMgaModalOpen(false)}
    projectPath={activeStudy?.path || undefined}
    modelId={effectiveModelId || undefined}
    datasetId={activeDataset?.id || undefined}
    spec={exportModelSpec()}
    columns={activeDataset?.variables?.map(v => v.name) || []}
    rows={activeDataset?.rows || []}
    dataGroups={activeDataset?.dataGroups || []}
    initialSettings={plsResults?.settings}
    onComplete={(report) => {
      setIsMgaModalOpen(false);
      cacheMgaReport(report);
      const studyKey = activeStudy?.path || effectiveStudyId || '';
      if (studyKey) {
        addStudyMgaReport(studyKey, {
          id: report.id,
          reportType: report.reportType,
          title: report.title,
          modelKey: report.modelId,
          datasetId: report.datasetId,
          createdAt: report.createdAt,
        });
      }
      openTab({
        type: 'mga-report',
        title: report.title,
        reportId: report.id,
        reportType: report.reportType,
        modelId: effectiveModelId,
        studyId: effectiveStudyId,
        workspaceId: currentTab?.workspaceId || activeWorkspaceId,
      });
    }}
  />

  <RedundancyWizardModal
    isOpen={isRedundancyWizardOpen}
    onClose={() => setIsRedundancyWizardOpen(false)}
    targetConstructId={wizardTargetConstructId}
    nodes={getModelCanvasState()?.nodes || []}
    dataset={activeDataset}
    projectPath={activeStudy?.path || ''}
    onModelsCreated={handleRedundancyModelsCreated}
  />

  <DiagramExportModal
    isOpen={isExportModalOpen}
    onClose={() => setIsExportModalOpen(false)}
    svgElement={typeof document !== 'undefined' ? (document.getElementById('model-svg') as unknown as SVGSVGElement) : null}
    modelName={activeModel?.name || 'model_diagram'}
  />

  {/* ─── Validation Error Modal ─── */}
  {validationModal && (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        width: '480px',
        maxWidth: '90vw',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
      }}>
        <div style={{
          padding: '18px 20px',
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          backgroundColor: '#fff1f2',
        }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            backgroundColor: '#ffe4e6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#e11d48',
            flexShrink: 0,
          }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#9f1239' }}>Model Validation Issues</h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#be123c' }}>Please fix the following issues before running analysis:</p>
          </div>
        </div>
        
        <div style={{ padding: '16px 20px', maxHeight: '340px', overflowY: 'auto' }}>
          {validationModal.errors && validationModal.errors.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#e11d48', marginBottom: '8px', letterSpacing: '0.05em' }}>
                Errors ({validationModal.errors.length})
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {validationModal.errors.map((err, idx) => (
                  <li key={idx} style={{ fontSize: '13px', color: '#334155', lineHeight: '1.4' }}>
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validationModal.warnings && validationModal.warnings.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#d97706', marginBottom: '8px', letterSpacing: '0.05em' }}>
                Warnings ({validationModal.warnings.length})
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {validationModal.warnings.map((warn, idx) => (
                  <li key={idx} style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.4' }}>
                    {warn}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div style={{
          padding: '12px 20px',
          backgroundColor: '#f8fafc',
          borderTop: '1px solid #f1f5f9',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <button
            type="button"
            onClick={() => setValidationModal(null)}
            style={{
              padding: '8px 16px',
              backgroundColor: '#0f172a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Back to Canvas
          </button>
        </div>
      </div>
    </div>
  )}

  {/* ─── Save Results Snapshot Modal ─── */}
  {isSnapshotModalOpen && (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div style={{
        backgroundColor: 'var(--color-bg-base)',
        color: 'var(--color-text-primary)',
        borderRadius: '12px',
        width: '420px',
        maxWidth: '92vw',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08)',
        overflow: 'hidden',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            backgroundColor: 'var(--color-accent-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-accent)',
            flexShrink: 0,
          }}>
            <History size={18} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)' }}>Save Snapshot</h3>
          </div>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
              Project / Study
            </label>
            <select
              value={snapshotTargetStudyId}
              onChange={(e) => setSnapshotTargetStudyId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                borderRadius: '6px',
                border: '1px solid var(--color-border-default)',
                background: 'var(--color-bg-raised)',
                color: 'var(--color-text-primary)',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            >
              {studies.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
              Snapshot Name
            </label>
            <input
              type="text"
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              placeholder="e.g. Model Run 1 - Final Baseline"
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                borderRadius: '6px',
                border: '1px solid var(--color-border-default)',
                background: 'var(--color-bg-raised)',
                color: 'var(--color-text-primary)',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              autoFocus
            />
          </div>
        </div>

        <div style={{
          padding: '12px 20px',
          backgroundColor: 'var(--color-bg-raised)',
          borderTop: '1px solid var(--color-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
        }}>
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
            Workspace: {activeWorkspace?.name || 'Default Workspace'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setIsSnapshotModalOpen(false)}
              disabled={isSavingSnapshot}
              style={{
                padding: '6px 12px',
                backgroundColor: 'transparent',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-default)',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveSnapshot}
              disabled={isSavingSnapshot || !snapshotName.trim()}
              style={{
                padding: '6px 14px',
                backgroundColor: 'var(--color-accent)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: isSavingSnapshot || !snapshotName.trim() ? 'not-allowed' : 'pointer',
                opacity: isSavingSnapshot || !snapshotName.trim() ? 0.6 : 1,
              }}
            >
              {isSavingSnapshot ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )}

  {/* ─── Toast Notifications ─── */}
  {saveToast && (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      backgroundColor: '#0f172a',
      color: '#ffffff',
      padding: '10px 18px',
      borderRadius: '8px',
      fontSize: '13px',
      fontWeight: 500,
      boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      zIndex: 9999,
    }}>
      <span style={{ color: '#10b981' }}>✓</span> {saveToast}
    </div>
  )}
  {validationSuccessToast && (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      backgroundColor: '#065f46',
      color: '#ffffff',
      padding: '10px 18px',
      borderRadius: '8px',
      fontSize: '13px',
      fontWeight: 500,
      boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      zIndex: 9999,
    }}>
      <span style={{ color: '#34d399' }}>✓</span> {validationSuccessToast}
    </div>
  )}

    </div>
    </div>
  );
};

export default ModelEditor;
