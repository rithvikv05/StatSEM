import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { api } from '../utils/api';
import AppSidebar from '../components/AppSidebar';
import {
  History,
  Edit3,
  Download,
  Copy,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  AlertCircle,
  FileSpreadsheet,
  FileText,
  Code,
  FileCheck,
  LayoutGrid,
  RotateCcw,
  GitCompare,
} from 'lucide-react';
import { getCanvasGridColors } from '../utils/model-canvas';
import { HypothesisTestingPanel } from '../components/HypothesisTestingPanel';
import { DiagramExportModal } from '../components/DiagramExportModal';
import { ModelComparisonModal } from '../components/ModelComparisonModal';
import { performAutoLayout, resolveBadgePositions } from '../utils/semLayoutEngine';
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

export const SnapshotView: React.FC = () => {
  const { tabs, activeTabId, studies, workspaces, models, addModel, openTab, settings, theme } = useStore();
  const activeTab = tabs.find(t => t.id === activeTabId);

  const activeStudy = studies.find(s => s.id === activeTab?.studyId) ||
    studies.find(s => s.path && activeTab?.snapshotId);
  const activeWorkspace = workspaces.find(w => w.id === activeTab?.workspaceId);

  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [currentView, setCurrentView] = useState<'results' | 'diagram'>('diagram');
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

  // Diagram Zoom & Pan state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isSnapping, setIsSnapping] = useState(true);
  const [canvasBgColor, setCanvasBgColor] = useState<string>(settings?.canvasBgColor || '');
  const [canvasGrid, setCanvasGrid] = useState<string>(settings?.canvasGrid || 'dots');
  const [hudConfirm, setHudConfirm] = useState<'reset' | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState<boolean>(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number; targetNodeId?: string | null } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hoveredLatent, setHoveredLatent] = useState<{
    name: string;
    r2: number | null;
    r2Adj: number | null;
    cr: number | null;
    ave: number | null;
    alpha: number | null;
    x: number;
    y: number;
  } | null>(null);

  const originalLayoutNodesRef = useRef<any[]>([]);
  const panStartRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Dynamic grid colors matching background contrast
  const gridColors = useMemo(() => {
    return getCanvasGridColors(canvasBgColor);
  }, [canvasBgColor, theme, settings?.theme]);

  // Dragging and interactive layout nodes
  const [layoutNodes, setLayoutNodes] = useState<any[]>([]);
  const [layoutEdges, setLayoutEdges] = useState<any[]>([]);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const initialNodesPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Edit Model Dialog
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [newModelName, setNewModelName] = useState('');
  const [isCreatingModel, setIsCreatingModel] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchSnapshot = async () => {
      if (!activeStudy?.path || !activeTab?.snapshotId) {
        setError('Missing study or snapshot reference.');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const res = await api.getSnapshot(activeStudy.path, activeTab.snapshotId);
        if (!isMounted) return;
        if (res.error) {
          setError(res.error);
        } else {
          setSnapshot(res);
          setNewModelName(`${res.name || 'Model'} (Editable)`);
        }
      } catch (err: any) {
        if (isMounted) setError(err?.message || 'Failed to load snapshot');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchSnapshot();
    return () => {
      isMounted = false;
    };
  }, [activeStudy?.path, activeTab?.snapshotId]);

  const results = snapshot?.results;
  const spec = snapshot?.spec || snapshot?.model_spec;
  const layout = snapshot?.diagram_layout;

  const centerDiagram = (nodesList: any[]) => {
    if (!nodesList || nodesList.length === 0) return;
    const xs = nodesList.map((n: any) => n.x);
    const ys = nodesList.map((n: any) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const container = containerRef.current;
    const w = container?.clientWidth || 900;
    const h = container?.clientHeight || 600;
    setPanOffset({ x: w / 2 - midX, y: h / 2 - midY });
  };

  // Initialize layoutNodes and auto-center diagram view when diagram layout is loaded
  useEffect(() => {
    if (layout?.nodes && layout.nodes.length > 0) {
      const cloned = JSON.parse(JSON.stringify(layout.nodes));
      originalLayoutNodesRef.current = JSON.parse(JSON.stringify(layout.nodes));
      setLayoutNodes(cloned);
      if (layout.edges) {
        setLayoutEdges(JSON.parse(JSON.stringify(layout.edges)));
      }
      setTimeout(() => {
        centerDiagram(cloned);
      }, 50);
    }
  }, [layout]);

  // Helper to process wheel events for pinch-to-zoom and two-finger move
  const processWheel = (
    e: { clientX: number; clientY: number; deltaX: number; deltaY: number; ctrlKey: boolean; metaKey: boolean },
    container: HTMLElement
  ) => {
    if (e.ctrlKey || e.metaKey) {
      // Pinch to zoom (trackpad pinch gesture or Ctrl/Cmd + wheel)
      const zoomIntensity = 0.008;
      const zoomFactor = Math.exp(-e.deltaY * zoomIntensity);

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setZoomLevel(prevK => {
        const newK = Math.max(0.1, Math.min(3, prevK * zoomFactor));
        const ratio = newK / prevK;
        setPanOffset(prevPan => ({
          x: mouseX - (mouseX - prevPan.x) * ratio,
          y: mouseY - (mouseY - prevPan.y) * ratio,
        }));
        return newK;
      });
    } else {
      // Moving two fingers on trackpad or scrolling mouse wheel -> pan canvas
      setPanOffset(prev => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  };

  // Touchpad two-finger move across to pan, and pinch to zoom (matching Model Editor)
  useEffect(() => {
    if (currentView !== 'diagram' || loading) return;
    const container = containerRef.current;
    if (!container) return;

    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      processWheel(e, container);
    };

    container.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheelNative);
    };
  }, [currentView, loading, snapshot]);

  // Spacebar pan & global click to close popovers/menus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const isInput = e.target && (
          (e.target as HTMLElement).tagName === 'INPUT' ||
          (e.target as HTMLElement).tagName === 'TEXTAREA' ||
          (e.target as HTMLElement).isContentEditable
        );
        if (!isInput) {
          setIsSpacePressed(true);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    const handleGlobalClick = () => {
      setContextMenuPos(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('click', handleGlobalClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('click', handleGlobalClick);
    };
  }, []);

  // Revert to Default layout & styles
  const handleRevertToDefault = () => {
    const base = originalLayoutNodesRef.current.length > 0
      ? originalLayoutNodesRef.current
      : (layout?.nodes || []);
    if (base.length > 0) {
      const restored = JSON.parse(JSON.stringify(base));
      setLayoutNodes(restored);
      setZoomLevel(1);
      centerDiagram(restored);
    }
    setCanvasBgColor('');
    setCanvasGrid('dots');
    setIsSnapping(true);
    setHudConfirm(null);
    setToastMsg('Canvas reverted to default layout and styles');
    setTimeout(() => setToastMsg(null), 2500);
  };

  // --- Geometric intersection offset helper matching model-canvas.js ---
  const getNodeIntersectionOffset = (node: any, ptX: number, ptY: number) => {
    const dx = ptX - node.x;
    const dy = ptY - node.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return { x: 0, y: 0 };

    const isLatent = node.isLatent !== false && !node.isText;
    const shape = node.shape || (isLatent ? 'circle' : 'rect');
    const w = node.width || (isLatent ? (node.r ? node.r * 2 : 72) : 70);
    const h = node.height || (isLatent ? (node.r ? node.r * 2 : 72) : 28);

    if (shape === 'circle') {
      const rx = w / 2;
      const ry = h / 2;
      return { x: (dx / distance) * rx, y: (dy / distance) * ry };
    } else {
      const rx = w / 2;
      const ry = h / 2;
      if (Math.abs(dx) * ry > Math.abs(dy) * rx) {
        return { x: Math.sign(dx) * rx, y: dy * (rx / Math.abs(dx)) };
      } else {
        return { x: dx * (ry / Math.abs(dy)), y: Math.sign(dy) * ry };
      }
    }
  };

  const getPortOffset = (
    node: any,
    targetPt: { x: number; y: number },
    edgeIdx: number,
    totalEdges: number,
    isTarget: boolean
  ) => {
    const dx = targetPt.x - node.x;
    const dy = targetPt.y - node.y;

    const isLatent = node.isLatent !== false && !node.isText;
    const shape = node.shape || (isLatent ? 'circle' : 'rect');

    if (shape === 'circle') {
      let baseAngle = Math.atan2(dy, dx);
      if (totalEdges > 1) {
        const maxSpread = Math.min(0.55, (totalEdges - 1) * 0.16);
        const offset = -maxSpread / 2 + (edgeIdx / (totalEdges - 1)) * maxSpread;
        baseAngle += isTarget ? -offset : offset;
      }
      const r = node.r || 36;
      return { x: r * Math.cos(baseAngle), y: r * Math.sin(baseAngle) };
    } else {
      return getNodeIntersectionOffset(node, targetPt.x, targetPt.y);
    }
  };

  // Helper to extract outer loading / weight matching model-canvas.js
  const getOuterLoading = (parentNode: any, indNode: any): number | null => {
    if (!results) return null;
    const loadings = results.measurement?.outer_loadings || results.outer_loadings || {};
    const weights = results.measurement?.outer_weights || results.outer_weights || {};
    const pKeys = [parentNode.label, parentNode.id, parentNode.label?.toUpperCase()].filter(Boolean);
    const iKeys = [indNode.label, indNode.id, indNode.label?.toUpperCase(), indNode.label?.toLowerCase()].filter(Boolean);

    const isFormative = parentNode.type === 'formative';
    const dict = isFormative ? (Object.keys(weights).length ? weights : loadings) : loadings;

    for (const p of pKeys) {
      if (dict[p]) {
        for (const i of iKeys) {
          if (dict[p][i] !== undefined && dict[p][i] !== null) {
            return Number(dict[p][i]);
          }
        }
      }
    }
    return null;
  };

  // Helper to extract structural path coefficient
  const getPathCoefficient = (srcNode: any, tgtNode: any): number | null => {
    if (!results) return null;
    const paths = results.structural?.path_coefficients || results.path_coefficients || {};
    const sKeys = [srcNode.label, srcNode.id, srcNode.label?.toUpperCase()].filter(Boolean);
    const tKeys = [tgtNode.label, tgtNode.id, tgtNode.label?.toUpperCase()].filter(Boolean);

    for (const t of tKeys) {
      if (paths[t]) {
        for (const s of sKeys) {
          if (paths[t][s] !== undefined && paths[t][s] !== null) {
            return Number(paths[t][s]);
          }
        }
      }
    }
    return null;
  };

  // Helper to align indicators around a latent construct parent
  const alignIndicators = (direction: 'left' | 'right' | 'top' | 'bottom', parentId: string) => {
    const parent = layoutNodes.find(n => n.id === parentId);
    if (!parent) return;

    const indicators = layoutNodes.filter(n => n.parentId === parentId && !n.isLatent);
    if (indicators.length === 0) return;

    const indWidth = 70;
    const indHeight = 28;
    const gap = 16;
    const spacing = (direction === 'left' || direction === 'right') ? indHeight + gap : indWidth + gap;
    const offset = (direction === 'top' || direction === 'bottom') ? 140 : 155;
    const totalLength = (indicators.length - 1) * spacing;
    const start = -totalLength / 2;

    const updated = layoutNodes.map(node => {
      const idx = indicators.findIndex(ind => ind.id === node.id);
      if (idx === -1) return node;
      const clone = { ...node };
      if (direction === 'right') {
        clone.x = parent.x + offset;
        clone.y = parent.y + start + (idx * spacing);
      } else if (direction === 'left') {
        clone.x = parent.x - offset;
        clone.y = parent.y + start + (idx * spacing);
      } else if (direction === 'top') {
        clone.x = parent.x + start + (idx * spacing);
        clone.y = parent.y - offset;
      } else if (direction === 'bottom') {
        clone.x = parent.x + start + (idx * spacing);
        clone.y = parent.y + offset;
      }
      return clone;
    });

    setLayoutNodes(updated);
    setToastMsg(`Indicators aligned to ${direction}`);
    setTimeout(() => setToastMsg(null), 2000);
  };

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingNodeId(nodeId);
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    const map = new Map<string, { x: number; y: number }>();
    layoutNodes.forEach((n: any) => {
      map.set(n.id, { x: n.x, y: n.y });
    });
    initialNodesPosRef.current = map;
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (draggingNodeId) {
      const dx = (e.clientX - dragStartPosRef.current.x) / zoomLevel;
      const dy = (e.clientY - dragStartPosRef.current.y) / zoomLevel;
      const initialPos = initialNodesPosRef.current.get(draggingNodeId);
      if (!initialPos) return;

      // Snap to 10px grid if snapping is active
      const rawNewX = initialPos.x + dx;
      const rawNewY = initialPos.y + dy;
      const snappedX = isSnapping ? Math.round(rawNewX / 10) * 10 : rawNewX;
      const snappedY = isSnapping ? Math.round(rawNewY / 10) * 10 : rawNewY;
      const actualDx = snappedX - initialPos.x;
      const actualDy = snappedY - initialPos.y;

      setLayoutNodes(prev =>
        prev.map(n => {
          if (n.id === draggingNodeId) {
            return { ...n, x: snappedX, y: snappedY };
          }
          // If dragging a latent node, move its attached indicators too
          if (n.parentId === draggingNodeId) {
            const childInit = initialNodesPosRef.current.get(n.id);
            if (childInit) {
              return { ...n, x: childInit.x + actualDx, y: childInit.y + actualDy };
            }
          }
          return n;
        })
      );
      return;
    }

    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
    }
  };

  const handleCanvasMouseUp = () => {
    setDraggingNodeId(null);
    setIsPanning(false);
  };

  const handleAutoAlign = () => {
    if (!layoutNodes || layoutNodes.length === 0) return;
    const container = containerRef.current;
    const width = container?.clientWidth || 1000;
    const height = container?.clientHeight || 700;

    const currentEdges = layoutEdges.length > 0 ? layoutEdges : (layout?.edges || []);
    const { nodes: alignedNodes, edges: alignedEdges } = performAutoLayout(layoutNodes, currentEdges, {
      containerWidth: width,
      containerHeight: height,
    });

    setLayoutNodes(alignedNodes);
    if (alignedEdges) {
      setLayoutEdges(alignedEdges);
      if (layout) {
        layout.edges = alignedEdges;
      }
    }
    centerDiagram(alignedNodes);
  };

  const handleDownloadPNG = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    try {
      const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
      const bbox = svgEl.getBoundingClientRect();
      const width = bbox.width || 1200;
      const height = bbox.height || 800;

      svgClone.setAttribute('width', String(width));
      svgClone.setAttribute('height', String(height));

      const svgData = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const URL = window.URL || window.webkitURL || window;
      const blobURL = URL.createObjectURL(svgBlob);

      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = 2;
        canvas.width = width * scale;
        canvas.height = height * scale;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.scale(scale, scale);
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        context.fillStyle = canvasBgColor || (isDark ? '#0f172a' : '#ffffff');
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0);

        const pngUrl = canvas.toDataURL('image/png');
        const downloadLink = document.createElement('a');
        downloadLink.download = `${(snapshot?.name || 'model').replace(/\s+/g, '_')}.png`;
        downloadLink.href = pngUrl;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(blobURL);
      };
      image.src = blobURL;
    } catch (e) {
      console.error('Error generating PNG export:', e);
      alert('Failed to export PNG');
    }
  };

  const allIndicators = useMemo(() => {
    if (!results) return [];
    const set = new Set<string>();
    Object.values(results.measurement?.outer_loadings || {}).forEach((m: any) => {
      Object.keys(m || {}).forEach(k => set.add(k));
    });
    Object.values(results.measurement?.outer_weights || {}).forEach((m: any) => {
      Object.keys(m || {}).forEach(k => set.add(k));
    });
    return Array.from(set).sort();
  }, [results]);

  const getIndicatorName = (iid: string) => {
    if (!iid) return '';
    return results?.indicator_names?.[iid] || iid;
  };

  const fmt = (val: any, decimals: number = 4): string => {
    if (val === undefined || val === null || isNaN(Number(val))) return '—';
    return Number(val).toFixed(decimals);
  };

  const reportTabDetails = useMemo(() => {
    switch (activeResultTab) {
      case 'path_coefficients':
        return {
          title: 'Path Coefficients',
          badge: 'β (beta)',
          subtitle: 'Standardized beta coefficients between endogenous and exogenous latent constructs.',
        };
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
      case 'construct_reliability':
      case 'reliability':
        return {
          title: 'Construct Reliability & Validity',
          badge: 'α, CR, ρA, AVE',
          subtitle: 'Internal consistency reliability (Cronbach\'s α, CR, rho_A) and convergent validity (AVE).',
        };
      case 'htmt':
        return {
          title: 'Discriminant Validity (HTMT)',
          badge: 'Heterotrait-Monotrait Ratio',
          subtitle: 'HTMT ratios of correlations. Values strictly below 0.85 (or 0.90) indicate distinct construct validity.',
        };
      case 'fornell_larcker':
        return {
          title: 'Fornell-Larcker Criterion',
          badge: '√AVE vs Correlations',
          subtitle: 'Square root of AVE (on diagonal) compared against inter-construct correlations (off-diagonal).',
        };
      case 'f_squared':
        return {
          title: 'f-Square Effect Sizes',
          badge: 'f²',
          subtitle: 'Cohen\'s f² effect size of omitted predictor on endogenous construct R².',
        };
      case 'collinearity':
        return {
          title: 'Collinearity Statistics (VIF)',
          badge: 'Variance Inflation Factor',
          subtitle: 'Variance Inflation Factor (VIF) evaluating multicollinearity among predictors. Ideal VIF < 3.3.',
        };
      case 'construct_scores':
        return {
          title: 'Latent Variable Scores',
          badge: 'Standardized Scores',
          subtitle: 'Calculated standardized case scores for each latent variable in the model.',
        };
      case 'model_fit':
        return {
          title: 'Model Fit (SRMR)',
          badge: 'Global Fit',
          subtitle: 'Standardized Root Mean Square Residual (SRMR) measuring global model fit. Values < 0.08 indicate good fit.',
        };
      default:
        return {
          title: activeResultTab.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          badge: 'Results',
          subtitle: `Saved snapshot calculation results for ${snapshot?.name || 'Model'}.`,
        };
    }
  }, [activeResultTab, snapshot?.name]);

  const isInteractionConstruct = (cid: string): boolean => {
    if (!cid) return false;
    if (cid.includes(' x ')) return true;
    if (Array.isArray(results?.latent_variables)) {
      const lv = results.latent_variables.find((v: any) => v.id === cid || v.name === cid);
      if (lv?.is_interaction) return true;
    }
    return false;
  };

  const getConstructName = (key: string) => {
    if (!key) return '';
    if (results?.construct_names?.[key]) return results.construct_names[key];
    if (key.includes(' x ')) {
      const parts = key.split(' x ');
      const mName = results?.construct_names?.[parts[0]] || parts[0];
      const pName = results?.construct_names?.[parts[1]] || parts[1];
      return `${mName} x ${pName}`;
    }
    return key;
  };

  const renderConstructLabel = (cid: string) => {
    const isInt = isInteractionConstruct(cid);
    const label = getConstructName(cid);
    return (
      <div className="construct-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <div className="construct-dot" style={{ background: isInt ? '#ec4899' : (constructPalette[cid] || '#6366f1') }} />
        <span className="construct-name">{label}</span>
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
      </div>
    );
  };

  const resultConstructs = useMemo(() => {
    if (!results) return [];
    const set = new Set<string>();

    if (Array.isArray(results.latent_variables)) {
      results.latent_variables.forEach((lv: any) => {
        if (lv?.id) set.add(String(lv.id));
      });
    }

    const struct = results.structural || {};
    Object.keys(struct.r_squared || {}).forEach(c => set.add(c));
    if (struct.path_coefficients) {
      Object.keys(struct.path_coefficients).forEach(target => {
        set.add(target);
        Object.keys(struct.path_coefficients[target] || {}).forEach(src => set.add(src));
      });
    }

    Object.keys(results.measurement?.outer_loadings || {}).forEach(c => set.add(c));
    Object.keys(results.measurement?.outer_weights || {}).forEach(c => set.add(c));
    Object.keys(results.construct_scores || {}).forEach(c => set.add(c));

    return Array.from(set).sort();
  }, [results]);

  const targetConstructs = useMemo(() => {
    return resultConstructs.filter(c => !isInteractionConstruct(c));
  }, [resultConstructs]);

  const constructPalette: Record<string, string> = useMemo(() => {
    const defaultColors = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
    const p: Record<string, string> = {};
    resultConstructs.forEach((c, idx) => {
      p[c] = defaultColors[idx % defaultColors.length];
    });
    return p;
  }, [resultConstructs]);

  const handleCreateModel = async () => {
    if (!activeStudy?.path || !snapshot?.id) return;
    try {
      setIsCreatingModel(true);
      const newModelId = `model_${Date.now()}`;
      const name = newModelName.trim() || `${snapshot.name} (Editable)`;
      const res = await api.createModelFromSnapshot(activeStudy.path, snapshot.id, newModelId, name);
      if (res.error) {
        alert('Failed to create model from snapshot: ' + res.error);
        return;
      }

      // Add new model into Zustand store
      addModel({
        id: newModelId,
        studyId: activeStudy.id,
        name,
        type: 'PLS-SEM',
        lastModified: 'Just now',
      });
      useStore.getState().setActiveModel(newModelId);

      setIsEditModalOpen(false);

      // Open new model tab
      openTab({
        type: 'model',
        title: name,
        modelId: newModelId,
        studyId: activeStudy.id,
        workspaceId: activeWorkspace?.id,
      });
    } catch (err: any) {
      alert('Error creating editable model: ' + err?.message);
    } finally {
      setIsCreatingModel(false);
    }
  };

  const handleExportJSON = () => {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${snapshot.name.replace(/\s+/g, '_')}_snapshot.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyTable = () => {
    const table = document.querySelector('.scientific-table');
    if (!table) return;
    let tsv = '';
    const rows = table.querySelectorAll('tr');
    rows.forEach(r => {
      const cells = r.querySelectorAll('th, td');
      const rowVals: string[] = [];
      cells.forEach(c => rowVals.push(c.textContent?.trim() || ''));
      tsv += rowVals.join('\t') + '\n';
    });
    navigator.clipboard.writeText(tsv).then(() => {
      setCopyToast('Table copied to clipboard');
      setTimeout(() => setCopyToast(null), 2500);
    });
  };

  const handleExportCSV = () => {
    const table = document.querySelector('.scientific-table');
    if (!table) return;
    let csv = '';
    const rows = table.querySelectorAll('tr');
    rows.forEach(r => {
      const cells = r.querySelectorAll('th, td');
      const rowVals: string[] = [];
      cells.forEach(c => {
        let text = c.textContent?.trim() || '';
        if (text.includes(',') || text.includes('"')) {
          text = `"${text.replace(/"/g, '""')}"`;
        }
        rowVals.push(text);
      });
      csv += rowVals.join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${snapshot.name}_${activeResultTab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="app-body" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <AppSidebar activeNav="workspace" />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>
          <div style={{ textAlign: 'center' }}>
            <History size={32} style={{ margin: '0 auto 12px', opacity: 0.6 }} />
            <div>Loading snapshot data...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="app-body" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <AppSidebar activeNav="workspace" />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
          <div style={{ textAlign: 'center', maxWidth: '420px', padding: '24px' }}>
            <AlertCircle size={36} style={{ margin: '0 auto 12px' }} />
            <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>Snapshot Load Error</h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>{error || 'Unable to find snapshot details.'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-body" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <AppSidebar activeNav="workspace" />
      <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ═══ SUB-HEADER / CONTROL BAR ═══ */}
        <div className="subheader">
          <div className="subheader__breadcrumb">
            <span
              className="subheader__breadcrumb-link"
              onClick={() => {
                if (activeWorkspace) {
                  openTab({ type: 'workspace', title: activeWorkspace.name, workspaceId: activeWorkspace.id });
                }
              }}
            >
              {activeWorkspace?.name || 'Workspace'}
            </span>
            <span className="subheader__breadcrumb-sep">/</span>
            <span
              className="subheader__breadcrumb-link"
              onClick={() => {
                if (activeWorkspace) {
                  openTab({ type: 'workspace', title: activeWorkspace.name, workspaceId: activeWorkspace.id });
                }
              }}
            >
              {activeStudy?.name || 'Study'}
            </span>
            <span className="subheader__breadcrumb-sep">/</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <History size={13} style={{ color: 'var(--color-accent)' }} />
              <span className="subheader__breadcrumb-link" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>
                {snapshot.name}
              </span>
            </div>
            <div className="subheader__divider" style={{ margin: '0 8px' }} />
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
              Captured {new Date(snapshot.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          <div className="subheader__actions">
            {/* View Switcher: Diagram vs Results */}
            <div className="subheader__switcher">
              <button
                type="button"
                className={`subheader__switcher-btn ${currentView === 'diagram' ? 'active' : ''}`}
                onClick={() => setCurrentView('diagram')}
              >
                Model
              </button>
              <button
                type="button"
                className={`subheader__switcher-btn ${currentView === 'results' ? 'active' : ''}`}
                onClick={() => setCurrentView('results')}
              >
                Results
              </button>
            </div>

            {/* Edit Model Action */}
            <button
              className="subheader__btn subheader__btn--primary"
              type="button"
              onClick={() => setIsEditModalOpen(true)}
              style={{ gap: 6, fontWeight: 500 }}
              title="Create a new editable model initialized from this snapshot"
            >
              <Edit3 size={13} />
              <span>Edit Model</span>
            </button>
          </div>
        </div>

        {/* ═══ APP BODY ═══ */}
        {currentView === 'results' ? (
          <div id="view-results" className="view-panel" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div className="app-body" style={{ width: '100%', height: '100%' }}>
              {/* Left Navigation Tree */}
              <aside className="results-sidebar" id="results-sidebar">
                <div className="results-sidebar__search">
                  <div className="results-sidebar__search-wrap">
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                      Snapshot Tables
                    </span>
                  </div>
                </div>
                <div className="results-sidebar__tree">
                  {/* Final Results Section */}
                  <div className="tree-section">
                    <div className="tree-section__header">
                      <span>Final results</span>
                    </div>
                    <div className="tree-section__items">
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'path_coefficients' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('path_coefficients'); }}
                      >
                        Path coefficients
                      </a>
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'hypotheses' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('hypotheses'); }}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <span>Hypotheses Testing</span>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: 'rgba(99, 102, 241, 0.15)',
                          color: 'var(--color-accent)',
                        }}>
                          APA
                        </span>
                      </a>
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'total_indirect_effects' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('total_indirect_effects'); }}
                      >
                        Total indirect effects
                      </a>
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'total_effects' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('total_effects'); }}
                      >
                        Total effects
                      </a>
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'outer_loadings' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('outer_loadings'); }}
                      >
                        Outer loadings
                      </a>
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'outer_weights' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('outer_weights'); }}
                      >
                        Outer weights
                      </a>
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'construct_scores' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('construct_scores'); }}
                      >
                        Latent variable scores
                      </a>
                    </div>
                  </div>

                  {/* Quality Criteria Section */}
                  <div className="tree-section">
                    <div className="tree-section__header">
                      <span>Quality criteria</span>
                    </div>
                    <div className="tree-section__items">
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'r_squared' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('r_squared'); }}
                      >
                        R-square (R²)
                      </a>
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'construct_reliability' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('construct_reliability'); }}
                      >
                        Construct reliability & validity
                      </a>
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'htmt' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('htmt'); }}
                      >
                        Discriminant validity (HTMT)
                      </a>
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'fornell_larcker' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('fornell_larcker'); }}
                      >
                        Fornell-Larcker criterion
                      </a>
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'f_squared' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('f_squared'); }}
                      >
                        f-square (f²) effect sizes
                      </a>
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'collinearity' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('collinearity'); }}
                      >
                        Collinearity (VIF)
                      </a>
                      {results?.convergent_validity_redundancy && (
                        <a
                          href="#"
                          className={`tree-item ${activeResultTab === 'convergent_validity_redundancy' ? 'active' : ''}`}
                          onClick={(e) => { e.preventDefault(); setActiveResultTab('convergent_validity_redundancy'); }}
                        >
                          Convergent validity (redundancy)
                        </a>
                      )}
                      <a
                        href="#"
                        className={`tree-item ${activeResultTab === 'model_fit' ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); setActiveResultTab('model_fit'); }}
                      >
                        Model fit (SRMR)
                      </a>
                    </div>
                  </div>
                </div>
              </aside>

              {/* Main Content Area */}
              <main className="results-main" style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
                {/* Secondary Header inline with search */}
                <div className="results-secondary-header">
                  <button
                    className="results-tool-btn results-tool-btn--accent"
                    type="button"
                    onClick={() => setIsEditModalOpen(true)}
                    title="Create a new editable model from this snapshot"
                  >
                    <Edit3 size={13} />
                    <span>Edit Model</span>
                  </button>
                  <button
                    className="results-tool-btn"
                    type="button"
                    onClick={handleExportCSV}
                    title="Export CSV"
                  >
                    <FileSpreadsheet size={13} />
                    <span>Excel</span>
                  </button>
                  <button
                    className="results-tool-btn"
                    type="button"
                    onClick={() => window.print()}
                    title="Print or create report"
                  >
                    <FileCheck size={13} />
                    <span>Create Report</span>
                  </button>
                  <button
                    className="results-tool-btn"
                    type="button"
                    onClick={handleExportJSON}
                    title="Download snapshot JSON"
                  >
                    <Download size={13} />
                    <span>Export JSON</span>
                  </button>
                  <button
                    className="results-tool-btn results-tool-btn--accent"
                    type="button"
                    onClick={() => setIsCompareModalOpen(true)}
                    title="Compare models side-by-side"
                  >
                    <GitCompare size={13} />
                    <span>Compare Models</span>
                  </button>
                </div>

                {/* Header Area with Inline Title and Table Actions */}
                <div className="report-header">
                  <div className="report-header__top">
                    <div>
                      <h1 className="report-header__title">
                        {reportTabDetails.title}
                        <span className="report-header__title-sub">{reportTabDetails.badge}</span>
                      </h1>
                      <p className="report-header__subtitle">
                        {reportTabDetails.subtitle}
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <button
                        className="results-tool-btn"
                        type="button"
                        onClick={handleCopyTable}
                        title="Copy table to clipboard"
                      >
                        <Copy size={13} />
                        <span>Copy Table</span>
                      </button>
                      <button
                        className="results-tool-btn"
                        type="button"
                        onClick={handleExportCSV}
                        title="Export CSV"
                      >
                        <Download size={13} />
                        <span>Export CSV</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Table Container */}
                <div className="table-container">
                  <div className="scientific-table-wrap">
                    {activeResultTab === 'hypotheses' ? (
                      <HypothesisTestingPanel
                        results={results}
                        model={snapshot?.model_state || snapshot?.model}
                        onExportExcel={handleExportCSV}
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
                              {resultConstructs.map(c => (
                                <th key={c}>{getConstructName(c)}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {resultConstructs.map(sourceC => (
                              <tr key={sourceC}>
                                <td>
                                  <div className="construct-label">
                                    <div className="construct-dot" style={{ background: constructPalette[sourceC] || '#6366f1' }} />
                                    <span className="construct-name">{getConstructName(sourceC)}</span>
                                  </div>
                                </td>
                                {resultConstructs.map(targetC => {
                                  const val = results?.structural?.path_coefficients?.[targetC]?.[sourceC];
                                  if (val !== undefined && val !== null) {
                                    return (
                                      <td key={targetC} className="cell-sig">
                                        <div className="cell-value">{fmt(val, 4)}</div>
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
                            {Object.entries(results?.structural?.path_coefficients || {}).flatMap(([target, preds]: [string, any]) =>
                              Object.entries(preds || {}).map(([pred, val]: [string, any]) => {
                                const f2 = results?.quality_criteria?.f_squared?.[target]?.[pred] ?? results?.structural?.f_squared?.[target]?.[pred];
                                const vif = results?.quality_criteria?.inner_vif?.[target]?.[pred] ?? results?.structural?.inner_vif?.[target]?.[pred];
                                return (
                                  <tr key={`${pred}->${target}`}>
                                    <td>
                                      <div className="construct-label">
                                        <div className="construct-dot" style={{ background: constructPalette[pred] || '#6366f1' }} />
                                        <span className="construct-name">{getConstructName(pred)}</span>
                                      </div>
                                    </td>
                                    <td>
                                      <div className="construct-label">
                                        <div className="construct-dot" style={{ background: constructPalette[target] || '#0ea5e9' }} />
                                        <span className="construct-name">{getConstructName(target)}</span>
                                      </div>
                                    </td>
                                    <td className="cell-sig">
                                      <div className="cell-value">{fmt(val, 4)}</div>
                                    </td>
                                    <td>{fmt(f2, 4)}</td>
                                    <td>{vif !== undefined ? fmt(vif, 4) : '—'}</td>
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
                              {resultConstructs.map(c => (
                                <th key={c}>{getConstructName(c)}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {resultConstructs.map(sourceC => (
                              <tr key={sourceC}>
                                <td>
                                  <div className="construct-label">
                                    <div className="construct-dot" style={{ background: constructPalette[sourceC] || '#6366f1' }} />
                                    <span className="construct-name">{getConstructName(sourceC)}</span>
                                  </div>
                                </td>
                                {resultConstructs.map(targetC => {
                                  if (sourceC === targetC) return <td key={targetC} className="cell-empty">—</td>;
                                  const eff = (results?.structural?.effects || []).find((e: any) => e.from === sourceC && e.to === targetC);
                                  if (eff && eff.indirect !== undefined && eff.indirect !== null) {
                                    return (
                                      <td key={targetC} className="cell-sig">
                                        <div className="cell-value">{fmt(eff.indirect, 4)}</div>
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
                            {(results?.structural?.effects || []).map((eff: any, idx: number) => (
                              <tr key={idx}>
                                <td>
                                  <div className="construct-label">
                                    <div className="construct-dot" style={{ background: constructPalette[eff.from] || '#6366f1' }} />
                                    <span className="construct-name">{getConstructName(eff.from)}</span>
                                  </div>
                                </td>
                                <td>
                                  <div className="construct-label">
                                    <div className="construct-dot" style={{ background: constructPalette[eff.to] || '#0ea5e9' }} />
                                    <span className="construct-name">{getConstructName(eff.to)}</span>
                                  </div>
                                </td>
                                <td className="cell-sig">
                                  <div className="cell-value">{fmt(eff.indirect, 4)}</div>
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
                              {resultConstructs.map(c => (
                                <th key={c}>{getConstructName(c)}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {resultConstructs.map(sourceC => (
                              <tr key={sourceC}>
                                <td>
                                  <div className="construct-label">
                                    <div className="construct-dot" style={{ background: constructPalette[sourceC] || '#6366f1' }} />
                                    <span className="construct-name">{getConstructName(sourceC)}</span>
                                  </div>
                                </td>
                                {resultConstructs.map(targetC => {
                                  if (sourceC === targetC) return <td key={targetC} className="cell-empty">—</td>;
                                  const eff = (results?.structural?.effects || []).find((e: any) => e.from === sourceC && e.to === targetC);
                                  const val = eff?.total ?? results?.structural?.total_effects?.[targetC]?.[sourceC];
                                  if (val !== undefined && val !== null) {
                                    return (
                                      <td key={targetC} className="cell-sig">
                                        <div className="cell-value">{fmt(val, 4)}</div>
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
                            {(results?.structural?.effects || []).map((eff: any, idx: number) => (
                              <tr key={idx}>
                                <td>
                                  <div className="construct-label">
                                    <div className="construct-dot" style={{ background: constructPalette[eff.from] || '#6366f1' }} />
                                    <span className="construct-name">{getConstructName(eff.from)}</span>
                                  </div>
                                </td>
                                <td>
                                  <div className="construct-label">
                                    <div className="construct-dot" style={{ background: constructPalette[eff.to] || '#0ea5e9' }} />
                                    <span className="construct-name">{getConstructName(eff.to)}</span>
                                  </div>
                                </td>
                                <td>{fmt(eff.direct, 4)}</td>
                                <td>{fmt(eff.indirect, 4)}</td>
                                <td className="cell-sig">
                                  <div className="cell-value">{fmt(eff.total, 4)}</div>
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
                                  const val = results?.measurement?.outer_loadings?.[cid]?.[iid];
                                  if (val !== undefined && val !== null) {
                                    const num = Number(val);
                                    const isHigh = num >= 0.708;
                                    return (
                                      <td key={cid} className={isHigh ? 'cell-sig' : 'cell-ns'}>
                                        <div className="cell-value">{fmt(num, 4)}</div>
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
                            {Object.entries(results?.measurement?.outer_loadings || {}).flatMap(([cid, loads]: [string, any]) =>
                              Object.entries(loads || {}).map(([iid, val]: [string, any]) => {
                                const loadNum = Number(val);
                                const rel = results?.measurement?.indicator_reliability?.[cid]?.[iid] ?? (loadNum * loadNum);
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
                                      <div className="cell-value">{fmt(loadNum, 4)}</div>
                                    </td>
                                    <td>{fmt(rel, 4)}</td>
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
                                  const val = results?.measurement?.outer_weights?.[cid]?.[iid];
                                  if (val !== undefined && val !== null) {
                                    return (
                                      <td key={cid} className="cell-sig">
                                        <div className="cell-value">{fmt(val, 4)}</div>
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
                            {Object.entries(results?.measurement?.outer_weights || {}).flatMap(([cid, weights]: [string, any]) =>
                              Object.entries(weights || {}).map(([iid, val]: [string, any]) => {
                                const vif = results?.measurement?.outer_vif?.[cid]?.[iid];
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
                                      <div className="cell-value">{fmt(val, 4)}</div>
                                    </td>
                                    <td>{vif !== undefined ? fmt(vif, 4) : '1.0000'}</td>
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
                            <th>R² (Variance Explained)</th>
                            <th>R² Adjusted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(results?.structural?.r_squared || {}).map(([c, r2]: [string, any]) => (
                            <tr key={c}>
                              <td>{getConstructName(c)}</td>
                              <td><strong>{fmt(r2, 4)}</strong></td>
                              <td>{fmt(results?.structural?.r_squared_adj?.[c], 4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : activeResultTab === 'construct_reliability' ? (
                      <table className="scientific-table">
                        <thead>
                          <tr>
                            <th>Construct</th>
                            <th>Cronbach's Alpha (α)</th>
                            <th>Composite Reliability (rho_a)</th>
                            <th>Composite Reliability (rho_c)</th>
                            <th>Average Variance Extracted (AVE)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resultConstructs.map(c => {
                            const rel = results?.reliability_and_validity || {};
                            return (
                              <tr key={c}>
                                <td>{getConstructName(c)}</td>
                                <td>{fmt(rel.cronbach_alpha?.[c] ?? rel.cronbachs_alpha?.[c], 4)}</td>
                                <td>{fmt(rel.rho_a?.[c], 4)}</td>
                                <td>{fmt(rel.composite_reliability?.[c], 4)}</td>
                                <td>{fmt(rel.ave?.[c], 4)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : activeResultTab === 'htmt' ? (
                      getTableMode('htmt') === 'matrix' ? (
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
                              {resultConstructs.map(c => (
                                <th key={c}>{getConstructName(c)}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {resultConstructs.map(r => (
                              <tr key={r}>
                                <td>{getConstructName(r)}</td>
                                {resultConstructs.map(col => {
                                  if (r === col) return <td key={col} className="cell-empty">—</td>;
                                  const val = results?.reliability_and_validity?.htmt?.[r]?.[col];
                                  if (val !== undefined && val !== null) {
                                    const num = Number(val);
                                    const ok = num < 0.85;
                                    return (
                                      <td key={col} className={ok ? 'cell-sig' : 'cell-ns'}>
                                        <div className="cell-value">{fmt(num, 4)}</div>
                                      </td>
                                    );
                                  }
                                  return <td key={col} className="cell-empty">—</td>;
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
                            {resultConstructs.flatMap((c1, i) =>
                              resultConstructs.slice(i + 1).map(c2 => {
                                const val = results?.reliability_and_validity?.htmt?.[c1]?.[c2] ??
                                  results?.reliability_and_validity?.htmt?.[c2]?.[c1];
                                const num = val !== undefined && val !== null ? Number(val) : NaN;
                                const isStrict = !isNaN(num) && num < 0.85;
                                const isLiberal = !isNaN(num) && num < 0.90;
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
                                    <td className={isStrict ? 'cell-sig' : 'cell-ns'}>
                                      <div className="cell-value">{fmt(val, 4)}</div>
                                    </td>
                                    <td>
                                      <span style={{
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        backgroundColor: isStrict ? '#dcfce7' : (isLiberal ? '#fef3c7' : '#fee2e2'),
                                        color: isStrict ? '#166534' : (isLiberal ? '#92400e' : '#991b1b')
                                      }}>
                                        {isStrict ? 'Distinct (HTMT < 0.85)' : (isLiberal ? 'Acceptable (< 0.90)' : 'Discriminant Issue (≥ 0.90)')}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      )
                    ) : activeResultTab === 'fornell_larcker' ? (
                      <table className="scientific-table">
                        <thead>
                          <tr>
                            <th>Construct</th>
                            {resultConstructs.map(c => (
                              <th key={c}>{getConstructName(c)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {resultConstructs.map(r => (
                            <tr key={r}>
                              <td>{getConstructName(r)}</td>
                              {resultConstructs.map(col => {
                                const val = results?.reliability_and_validity?.fornell_larcker?.[r]?.[col];
                                return <td key={col}>{fmt(val, 4)}</td>;
                              })}
                            </tr>
                          ))}
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
                              {resultConstructs.map(c => (
                                <th key={c}>{getConstructName(c)}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {resultConstructs.map(pred => (
                              <tr key={pred}>
                                <td>
                                  <div className="construct-label">
                                    <div className="construct-dot" style={{ background: constructPalette[pred] || '#6366f1' }} />
                                    <span className="construct-name">{getConstructName(pred)}</span>
                                  </div>
                                </td>
                                {resultConstructs.map(tgt => {
                                  const val = results?.quality_criteria?.f_squared?.[tgt]?.[pred] ?? results?.structural?.f_squared?.[tgt]?.[pred];
                                  if (val !== undefined && val !== null) {
                                    const f2 = Number(val);
                                    const isHigh = f2 >= 0.15;
                                    return (
                                      <td key={tgt} className={isHigh ? 'cell-sig' : ''}>
                                        <div className="cell-value">{fmt(f2, 4)}</div>
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
                            {Object.entries(results?.quality_criteria?.f_squared || results?.structural?.f_squared || {}).flatMap(([target, preds]: [string, any]) =>
                              Object.entries(preds || {}).map(([pred, val]: [string, any]) => {
                                const f2 = Number(val);
                                const interp = f2 >= 0.35 ? 'Large effect (≥ 0.35)' : (f2 >= 0.15 ? 'Medium effect (≥ 0.15)' : (f2 >= 0.02 ? 'Small effect (≥ 0.02)' : 'Negligible (< 0.02)'));
                                return (
                                  <tr key={`${pred}->${target}`}>
                                    <td>
                                      <div className="construct-label">
                                        <div className="construct-dot" style={{ background: constructPalette[pred] || '#6366f1' }} />
                                        <span className="construct-name">{getConstructName(pred)}</span>
                                      </div>
                                    </td>
                                    <td>
                                      <div className="construct-label">
                                        <div className="construct-dot" style={{ background: constructPalette[target] || '#0ea5e9' }} />
                                        <span className="construct-name">{getConstructName(target)}</span>
                                      </div>
                                    </td>
                                    <td className="cell-sig">
                                      <div className="cell-value">{fmt(f2, 4)}</div>
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
                      )
                    ) : activeResultTab === 'collinearity' ? (
                      <table className="scientific-table">
                        <thead>
                          <tr>
                            <th>Construct / Indicator</th>
                            <th>Inner VIF</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(results?.quality_criteria?.inner_vif || results?.structural?.inner_vif || {}).map(([pair, vif]: [string, any]) => (
                            <tr key={pair}>
                              <td>{pair}</td>
                              <td><strong>{fmt(vif, 3)}</strong></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : activeResultTab === 'convergent_validity_redundancy' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <table className="scientific-table">
                          <thead>
                            <tr>
                              <th>Formative construct</th>
                              <th>Global item construct</th>
                              <th>Path coefficient</th>
                              {results?.convergent_validity_redundancy?.some((r: any) => r.bootstrap) && (
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
                            {(results?.convergent_validity_redundancy || []).map((row: any, idx: number) => {
                              const isSupported = row.supported || (row.path_coefficient >= 0.70);
                              const b = row.bootstrap;
                              return (
                                <tr key={idx}>
                                  <td><strong>{row.formative_construct}</strong></td>
                                  <td><strong>{row.global_construct}</strong></td>
                                  <td className="cell-sig"><div className="cell-value">{fmt(row.path_coefficient, 4)}</div></td>
                                  {results?.convergent_validity_redundancy?.some((r: any) => r.bootstrap) && (
                                    <>
                                      <td>{b ? fmt(b.mean, 4) : '—'}</td>
                                      <td>{b ? fmt(b.se, 4) : '—'}</td>
                                      <td>{b ? fmt(b.t_stat, 3) : '—'}</td>
                                      <td className={b && b.p_value < 0.05 ? 'cell-sig' : ''}>{b ? fmt(b.p_value, 4) : '—'}</td>
                                      <td>{b && b.ci_low !== undefined ? `[${fmt(b.ci_low, 3)}, ${fmt(b.ci_high, 3)}]` : '—'}</td>
                                    </>
                                  )}
                                  <td>{fmt(row.r_squared, 4)}</td>
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
                            <th>Case #</th>
                            {resultConstructs.map(c => (
                              <th key={c}>{getConstructName(c)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: Math.min(results?.n_samples || 20, 25) }).map((_, idx) => (
                            <tr key={idx}>
                              <td>{idx + 1}</td>
                              {resultConstructs.map(c => {
                                const score = results?.construct_scores?.[c]?.[idx];
                                return <td key={c}>{fmt(score, 4)}</td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : activeResultTab === 'model_fit' ? (
                      <table className="scientific-table">
                        <thead>
                          <tr>
                            <th>Fit Criterion</th>
                            <th>Saturated Model</th>
                            <th>Estimated Model</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>SRMR (Standardized Root Mean Square Residual)</td>
                            <td><strong>{fmt(results?.model_fit?.srmr, 4)}</strong></td>
                            <td>{fmt(results?.model_fit?.srmr, 4)}</td>
                          </tr>
                          <tr>
                            <td>d_ULS (Squared Euclidean distance)</td>
                            <td>{fmt(results?.model_fit?.d_uls, 4)}</td>
                            <td>{fmt(results?.model_fit?.d_uls, 4)}</td>
                          </tr>
                          <tr>
                            <td>d_G (Geodesic distance)</td>
                            <td>{fmt(results?.model_fit?.d_g, 4)}</td>
                            <td>{fmt(results?.model_fit?.d_g, 4)}</td>
                          </tr>
                          <tr>
                            <td>NFI (Normed Fit Index)</td>
                            <td>{fmt(results?.model_fit?.nfi, 4)}</td>
                            <td>{fmt(results?.model_fit?.nfi, 4)}</td>
                          </tr>
                        </tbody>
                      </table>
                    ) : null}
                  </div>
                </div>
              </main>
            </div>
          </div>
        ) : (
          /* ═══ MODEL DIAGRAM PREVIEW VIEW ═══ */
          <div
            ref={containerRef}
            style={{
              flex: 1,
              position: 'relative',
              backgroundColor: 'var(--color-bg-base)',
              overflow: 'hidden',
              cursor: isPanning ? 'grabbing' : (isSpacePressed ? 'grab' : (draggingNodeId ? 'move' : 'default'))
            }}
            onMouseDown={(e) => {
              if ((e.button === 0 || e.button === 1 || isSpacePressed) && !draggingNodeId) {
                setIsPanning(true);
                panStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
              }
            }}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            onWheel={(e) => {
              if (containerRef.current) {
                processWheel(e, containerRef.current);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenuPos({ x: e.clientX, y: e.clientY });
            }}
          >
            {/* Diagram HUD Floating Bar docked on bottom right */}
            <div
              className="canvas-hud"
              style={{
                position: 'absolute',
                bottom: '20px',
                right: '20px',
                left: 'auto',
                width: 'fit-content',
                transform: 'none',
                zIndex: 40,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <div className="hud-zoom">
                <div
                  className="hud-zoom__btn"
                  onClick={() => setZoomLevel(z => Math.max(0.1, z - 0.1))}
                  title="Zoom Out (−)"
                >
                  −
                </div>
                <div
                  className="hud-zoom__level"
                  onClick={() => {
                    setZoomLevel(1);
                    centerDiagram(layoutNodes.length > 0 ? layoutNodes : (layout?.nodes || []));
                  }}
                  title="Reset Zoom to 100%"
                >
                  {Math.round(zoomLevel * 100)}%
                </div>
                <div
                  className="hud-zoom__btn"
                  onClick={() => setZoomLevel(z => Math.min(3, z + 0.1))}
                  title="Zoom In (+)"
                >
                  +
                </div>
              </div>

              <div
                className="hud-btn"
                onClick={() => {
                  setZoomLevel(1);
                  centerDiagram(layoutNodes.length > 0 ? layoutNodes : (layout?.nodes || []));
                }}
                title="Fit to Center (Reset Pan & Zoom)"
              >
                <Maximize2 size={13} />
                <span>Fit</span>
              </div>

              <div className="hud-divider" />

              <div
                className={`hud-icon-btn ${isSnapping ? 'active' : ''}`}
                onClick={() => setIsSnapping(s => !s)}
                title={isSnapping ? "Disable Snap to Grid" : "Enable Snap to Grid (10px)"}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 14, height: 14 }}>
                  <circle cx="4" cy="4" r="2" />
                  <circle cx="12" cy="4" r="2" />
                  <circle cx="20" cy="4" r="2" />
                  <circle cx="4" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="20" cy="12" r="2" />
                  <circle cx="4" cy="20" r="2" />
                  <circle cx="12" cy="20" r="2" />
                  <circle cx="20" cy="20" r="2" />
                </svg>
              </div>

              <div className="hud-divider" />

              <div
                className="hud-btn"
                onClick={handleAutoAlign}
                title="Auto-Align Layout (Hierarchical Arrangement)"
              >
                <LayoutGrid size={13} />
                <span>Auto Align</span>
              </div>

              <div
                className="hud-btn"
                onClick={() => setIsExportModalOpen(true)}
                title="Export Diagram (Vector SVG, 300/600 DPI, Journal B&W)"
              >
                <Download size={13} />
                <span>Export Diagram</span>
              </div>

              <div
                className="hud-btn"
                onClick={() => setIsCompareModalOpen(true)}
                title="Compare this model side-by-side with other models"
              >
                <GitCompare size={13} />
                <span>Compare</span>
              </div>

              <div className="hud-divider" />

              <div
                className="hud-btn"
                id="hud-reset"
                title="Reset to Default Layout & Styles"
                onClick={(e) => {
                  e.stopPropagation();
                  setHudConfirm(c => c === 'reset' ? null : 'reset');
                }}
                style={{ color: 'var(--color-text-secondary)', padding: '0 6px', position: 'relative' }}
              >
                <RotateCcw size={14} />
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
                  onClick={(e) => e.stopPropagation()}
                >
                  <span style={{ color: 'var(--color-text-primary)', fontWeight: 500, fontSize: '12px' }}>
                    Revert to default layout &amp; styles?
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => setHudConfirm(null)}
                      title="Keep current changes"
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
                      onClick={handleRevertToDefault}
                      title="Confirm revert back to initial snapshot layout"
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
                      Revert
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Context Menu on Right Click (Latent Node or Canvas) */}
            {contextMenuPos && (() => {
              const targetNode = contextMenuPos.targetNodeId ? layoutNodes.find(n => n.id === contextMenuPos.targetNodeId) : null;
              const isLatent = targetNode && targetNode.isLatent !== false && !targetNode.isText;

              if (isLatent) {
                const areIndicatorsHidden = !!targetNode.indicatorsHidden;
                const childInds = layoutNodes.filter(n => n.parentId === targetNode.id && !n.isLatent);
                const hasIndicators = childInds.length > 0;

                return (
                  <div
                    className="canvas-ctx-menu"
                    style={{
                      display: 'block',
                      position: 'fixed',
                      left: Math.min(contextMenuPos.x, window.innerWidth - 240),
                      top: Math.min(contextMenuPos.y, window.innerHeight - 340),
                      zIndex: 10000,
                      backgroundColor: 'var(--color-bg-elevated)',
                      backdropFilter: 'blur(12px)',
                      border: '1px solid var(--color-border-default)',
                      borderRadius: 'var(--radius-md, 8px)',
                      boxShadow: 'var(--shadow-float, 0 8px 24px rgba(15, 23, 42, 0.12))',
                      padding: '4px',
                      minWidth: '220px',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ padding: '6px 10px', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', background: 'var(--color-accent-subtle)', color: 'var(--color-accent)', fontWeight: 700 }}>LATENT</span>
                      <span style={{ color: 'var(--color-text-primary)' }}>{targetNode.label}</span>
                    </div>
                    <div className="canvas-ctx-divider" />

                    {/* Move Name Inside / Outside */}
                    <div
                      className="canvas-ctx-item"
                      title={targetNode.textInside ? 'Move name outside construct' : 'Move name inside construct'}
                      onClick={() => {
                        setContextMenuPos(null);
                        const isInside = !!targetNode.textInside;
                        setLayoutNodes(prev => prev.map(n => n.id === targetNode.id ? { ...n, textInside: !isInside } : n));
                        setToastMsg(!isInside ? 'Name moved inside' : 'Name moved outside');
                        setTimeout(() => setToastMsg(null), 2000);
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                        {targetNode.textInside ? 'open_in_new' : 'vertical_align_center'}
                      </span>
                      <span style={{ flex: 1 }}>{targetNode.textInside ? 'Move Name Outside' : 'Move Name Inside'}</span>
                    </div>

                    {!targetNode.textInside && (
                      <>
                        <div
                          className="canvas-ctx-item"
                          onClick={() => {
                            setContextMenuPos(null);
                            setLayoutNodes(prev => prev.map(n => n.id === targetNode.id ? { ...n, textInside: false, textPosition: 'top' } : n));
                            setToastMsg('Name positioned top');
                            setTimeout(() => setToastMsg(null), 2000);
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>align_vertical_top</span>
                          <span style={{ flex: 1 }}>Move Name Top</span>
                        </div>

                        <div
                          className="canvas-ctx-item"
                          onClick={() => {
                            setContextMenuPos(null);
                            setLayoutNodes(prev => prev.map(n => n.id === targetNode.id ? { ...n, textInside: false, textPosition: 'bottom' } : n));
                            setToastMsg('Name positioned bottom');
                            setTimeout(() => setToastMsg(null), 2000);
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>align_vertical_bottom</span>
                          <span style={{ flex: 1 }}>Move Name Bottom</span>
                        </div>

                        <div
                          className="canvas-ctx-item"
                          onClick={() => {
                            setContextMenuPos(null);
                            setLayoutNodes(prev => prev.map(n => n.id === targetNode.id ? { ...n, textInside: false, textPosition: 'left' } : n));
                            setToastMsg('Name positioned left');
                            setTimeout(() => setToastMsg(null), 2000);
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>align_horizontal_left</span>
                          <span style={{ flex: 1 }}>Move Name Left</span>
                        </div>

                        <div
                          className="canvas-ctx-item"
                          onClick={() => {
                            setContextMenuPos(null);
                            setLayoutNodes(prev => prev.map(n => n.id === targetNode.id ? { ...n, textInside: false, textPosition: 'right' } : n));
                            setToastMsg('Name positioned right');
                            setTimeout(() => setToastMsg(null), 2000);
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>align_horizontal_right</span>
                          <span style={{ flex: 1 }}>Move Name Right</span>
                        </div>
                      </>
                    )}

                    <div className="canvas-ctx-divider" />

                    {/* 2. Hide Indicators */}
                    <div
                      className={`canvas-ctx-item ${!hasIndicators ? 'disabled' : ''}`}
                      title={areIndicatorsHidden ? 'Show construct indicators' : 'Hide construct indicators'}
                      onClick={() => {
                        if (!hasIndicators) return;
                        setContextMenuPos(null);
                        setLayoutNodes(prev => prev.map(n => n.id === targetNode.id ? { ...n, indicatorsHidden: !areIndicatorsHidden } : n));
                        setToastMsg(areIndicatorsHidden ? 'Indicators visible' : 'Indicators hidden');
                        setTimeout(() => setToastMsg(null), 2000);
                      }}
                      style={{ opacity: hasIndicators ? 1 : 0.5, cursor: hasIndicators ? 'pointer' : 'default' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                        {areIndicatorsHidden ? 'visibility' : 'visibility_off'}
                      </span>
                      <span style={{ flex: 1 }}>{areIndicatorsHidden ? 'Show Indicators' : 'Hide Indicators'}</span>
                    </div>

                    <div className="canvas-ctx-divider" />

                    {/* 3. Align Indicators Left */}
                    <div
                      className={`canvas-ctx-item ${!hasIndicators ? 'disabled' : ''}`}
                      title="Align indicators vertically to the left"
                      onClick={() => {
                        if (!hasIndicators) return;
                        setContextMenuPos(null);
                        alignIndicators('left', targetNode.id);
                      }}
                      style={{ opacity: hasIndicators ? 1 : 0.5, cursor: hasIndicators ? 'pointer' : 'default' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>align_horizontal_left</span>
                      <span style={{ flex: 1 }}>Align Indicators Left</span>
                    </div>

                    {/* 4. Align Indicators Right */}
                    <div
                      className={`canvas-ctx-item ${!hasIndicators ? 'disabled' : ''}`}
                      title="Align indicators vertically to the right"
                      onClick={() => {
                        if (!hasIndicators) return;
                        setContextMenuPos(null);
                        alignIndicators('right', targetNode.id);
                      }}
                      style={{ opacity: hasIndicators ? 1 : 0.5, cursor: hasIndicators ? 'pointer' : 'default' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>align_horizontal_right</span>
                      <span style={{ flex: 1 }}>Align Indicators Right</span>
                    </div>

                    {/* 5. Align Indicators Top */}
                    <div
                      className={`canvas-ctx-item ${!hasIndicators ? 'disabled' : ''}`}
                      title="Align indicators horizontally on top"
                      onClick={() => {
                        if (!hasIndicators) return;
                        setContextMenuPos(null);
                        alignIndicators('top', targetNode.id);
                      }}
                      style={{ opacity: hasIndicators ? 1 : 0.5, cursor: hasIndicators ? 'pointer' : 'default' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>align_vertical_top</span>
                      <span style={{ flex: 1 }}>Align Indicators Top</span>
                    </div>

                    {/* 6. Align Indicators Bottom */}
                    <div
                      className={`canvas-ctx-item ${!hasIndicators ? 'disabled' : ''}`}
                      title="Align indicators horizontally on bottom"
                      onClick={() => {
                        if (!hasIndicators) return;
                        setContextMenuPos(null);
                        alignIndicators('bottom', targetNode.id);
                      }}
                      style={{ opacity: hasIndicators ? 1 : 0.5, cursor: hasIndicators ? 'pointer' : 'default' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>align_vertical_bottom</span>
                      <span style={{ flex: 1 }}>Align Indicators Bottom</span>
                    </div>

                    <div className="canvas-ctx-divider" />

                    <div
                      className="canvas-ctx-item"
                      title="Fit diagram to center"
                      onClick={() => {
                        setContextMenuPos(null);
                        setZoomLevel(1);
                        centerDiagram(layoutNodes.length > 0 ? layoutNodes : (layout?.nodes || []));
                      }}
                    >
                      <Maximize2 size={15} style={{ color: 'var(--color-text-secondary)' }} />
                      <span style={{ flex: 1 }}>Fit Screen</span>
                    </div>
                  </div>
                );
              }

              const isIndicator = targetNode && !targetNode.isLatent && !targetNode.isText;
              if (isIndicator) {
                const isIndInside = targetNode.textInside !== undefined ? targetNode.textInside : true;
                return (
                  <div
                    className="canvas-ctx-menu"
                    style={{
                      display: 'block',
                      position: 'fixed',
                      left: Math.min(contextMenuPos.x, window.innerWidth - 220),
                      top: Math.min(contextMenuPos.y, window.innerHeight - 240),
                      zIndex: 10000,
                      backgroundColor: 'var(--color-bg-elevated)',
                      backdropFilter: 'blur(12px)',
                      border: '1px solid var(--color-border-default)',
                      borderRadius: 'var(--radius-md, 8px)',
                      boxShadow: 'var(--shadow-float, 0 8px 24px rgba(15, 23, 42, 0.12))',
                      padding: '4px',
                      minWidth: '200px',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ padding: '6px 10px', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(234, 179, 8, 0.15)', color: '#ca8a04', fontWeight: 700 }}>INDICATOR</span>
                      <span style={{ color: 'var(--color-text-primary)' }}>{targetNode.label}</span>
                    </div>
                    <div className="canvas-ctx-divider" />

                    {/* Move Name Inside / Outside */}
                    <div
                      className="canvas-ctx-item"
                      title={isIndInside ? 'Move label outside indicator box' : 'Move label inside indicator box'}
                      onClick={() => {
                        setContextMenuPos(null);
                        setLayoutNodes(prev => prev.map(n => n.id === targetNode.id ? { ...n, textInside: !isIndInside } : n));
                        setToastMsg(isIndInside ? 'Name moved outside' : 'Name moved inside');
                        setTimeout(() => setToastMsg(null), 2000);
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                        {isIndInside ? 'open_in_new' : 'vertical_align_center'}
                      </span>
                      <span style={{ flex: 1 }}>{isIndInside ? 'Move Name Outside' : 'Move Name Inside'}</span>
                    </div>

                    {!isIndInside && (
                      <>
                        <div
                          className="canvas-ctx-item"
                          onClick={() => {
                            setContextMenuPos(null);
                            setLayoutNodes(prev => prev.map(n => n.id === targetNode.id ? { ...n, textInside: false, textPosition: 'top' } : n));
                            setToastMsg('Name positioned top');
                            setTimeout(() => setToastMsg(null), 2000);
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>align_vertical_top</span>
                          <span style={{ flex: 1 }}>Move Name Top</span>
                        </div>

                        <div
                          className="canvas-ctx-item"
                          onClick={() => {
                            setContextMenuPos(null);
                            setLayoutNodes(prev => prev.map(n => n.id === targetNode.id ? { ...n, textInside: false, textPosition: 'bottom' } : n));
                            setToastMsg('Name positioned bottom');
                            setTimeout(() => setToastMsg(null), 2000);
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>align_vertical_bottom</span>
                          <span style={{ flex: 1 }}>Move Name Bottom</span>
                        </div>

                        <div
                          className="canvas-ctx-item"
                          onClick={() => {
                            setContextMenuPos(null);
                            setLayoutNodes(prev => prev.map(n => n.id === targetNode.id ? { ...n, textInside: false, textPosition: 'left' } : n));
                            setToastMsg('Name positioned left');
                            setTimeout(() => setToastMsg(null), 2000);
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>align_horizontal_left</span>
                          <span style={{ flex: 1 }}>Move Name Left</span>
                        </div>

                        <div
                          className="canvas-ctx-item"
                          onClick={() => {
                            setContextMenuPos(null);
                            setLayoutNodes(prev => prev.map(n => n.id === targetNode.id ? { ...n, textInside: false, textPosition: 'right' } : n));
                            setToastMsg('Name positioned right');
                            setTimeout(() => setToastMsg(null), 2000);
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>align_horizontal_right</span>
                          <span style={{ flex: 1 }}>Move Name Right</span>
                        </div>
                      </>
                    )}

                    <div className="canvas-ctx-divider" />

                    <div
                      className="canvas-ctx-item"
                      title="Fit diagram to center"
                      onClick={() => {
                        setContextMenuPos(null);
                        setZoomLevel(1);
                        centerDiagram(layoutNodes.length > 0 ? layoutNodes : (layout?.nodes || []));
                      }}
                    >
                      <Maximize2 size={15} style={{ color: 'var(--color-text-secondary)' }} />
                      <span style={{ flex: 1 }}>Fit Screen</span>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  className="canvas-ctx-menu"
                  style={{
                    display: 'block',
                    position: 'fixed',
                    left: Math.min(contextMenuPos.x, window.innerWidth - 220),
                    top: Math.min(contextMenuPos.y, window.innerHeight - 280),
                    zIndex: 10000,
                    backgroundColor: 'var(--color-bg-elevated)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 'var(--radius-md, 8px)',
                    boxShadow: 'var(--shadow-float, 0 8px 24px rgba(15, 23, 42, 0.12))',
                    padding: '4px',
                    minWidth: '200px',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    className="canvas-ctx-item"
                    title="Fit diagram to center"
                    onClick={() => {
                      setContextMenuPos(null);
                      setZoomLevel(1);
                      centerDiagram(layoutNodes.length > 0 ? layoutNodes : (layout?.nodes || []));
                    }}
                  >
                    <Maximize2 size={15} style={{ color: 'var(--color-text-secondary)' }} />
                    <span style={{ flex: 1 }}>Fit Screen</span>
                  </div>
                  <div
                    className="canvas-ctx-item"
                    title="Export diagram as high-resolution image"
                    onClick={() => {
                      setContextMenuPos(null);
                      setIsExportModalOpen(true);
                    }}
                  >
                    <Download size={15} style={{ color: 'var(--color-text-secondary)' }} />
                    <span style={{ flex: 1 }}>Export Publication Diagram</span>
                  </div>

                  <div className="canvas-ctx-divider" />

                  <div
                    className="canvas-ctx-item"
                    title={isSnapping ? "Disable 10px grid snapping" : "Enable 10px grid snapping"}
                    onClick={() => {
                      setContextMenuPos(null);
                      setIsSnapping(s => !s);
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      {isSnapping ? 'grid_off' : 'grid_on'}
                    </span>
                    <span style={{ flex: 1 }}>{isSnapping ? 'Disable Snap to Grid' : 'Enable Snap to Grid'}</span>
                  </div>

                  <div className="canvas-ctx-divider" />

                  {/* Grid Pattern Options */}
                  <div style={{ padding: '4px 8px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-hint)', textTransform: 'uppercase', marginBottom: '4px' }}>
                      Grid Pattern
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {[
                        { id: 'dots', label: 'Dots', title: 'Dots Pattern Grid' },
                        { id: 'lines', label: 'Lines', title: 'Lines Pattern Grid' },
                        { id: 'none', label: 'None', title: 'Blank Canvas (No Grid)' },
                      ].map(opt => (
                        <button
                          key={opt.id}
                          type="button"
                          title={opt.title}
                          onClick={() => setCanvasGrid(opt.id)}
                          style={{
                            flex: 1,
                            height: '22px',
                            border: canvasGrid === opt.id ? '1px solid var(--color-accent)' : '1px solid var(--color-border-subtle)',
                            background: canvasGrid === opt.id ? 'var(--color-accent-subtle)' : 'var(--color-bg-base)',
                            color: canvasGrid === opt.id ? 'var(--color-accent)' : 'var(--color-text-primary)',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: canvasGrid === opt.id ? 600 : 400,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="canvas-ctx-divider" />

                  {/* Canvas Background Color Options */}
                  <div style={{ padding: '4px 8px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-hint)', textTransform: 'uppercase', marginBottom: '4px' }}>
                      Background Color
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {[
                        { id: '', bg: theme === 'dark' ? '#0f172a' : '#ffffff', title: 'Default Canvas Background' },
                        { id: theme === 'dark' ? '#1e293b' : '#f8fafc', bg: theme === 'dark' ? '#1e293b' : '#f8fafc', title: 'Soft Contrast Background' },
                      ].map(opt => (
                        <button
                          key={opt.title}
                          type="button"
                          title={opt.title}
                          onClick={() => setCanvasBgColor(opt.id)}
                          style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: opt.bg,
                            border: canvasBgColor.toLowerCase() === opt.id.toLowerCase() ? '2px solid var(--color-accent)' : '1px solid rgba(0,0,0,0.2)',
                            boxShadow: canvasBgColor.toLowerCase() === opt.id.toLowerCase() ? '0 0 0 2px var(--color-accent-subtle)' : 'none',
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        />
                      ))}
                      {/* Custom color picker */}
                      <label
                        title="Custom Background Color"
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: 'transparent',
                          border: '1px dashed var(--color-border-subtle)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--color-text-secondary)',
                          position: 'relative',
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        <span style={{ fontSize: '12px', lineHeight: 1 }}>+</span>
                        <input
                          type="color"
                          title="Custom Canvas Color"
                          value={canvasBgColor || (theme === 'dark' ? '#0f172a' : '#ffffff')}
                          onChange={(e) => setCanvasBgColor(e.target.value)}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            opacity: 0,
                            cursor: 'pointer',
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="canvas-ctx-divider" />

                  <div
                    className="canvas-ctx-item"
                    title="Revert canvas layout and styles to default"
                    onClick={() => {
                      setContextMenuPos(null);
                      handleRevertToDefault();
                    }}
                  >
                    <RotateCcw size={15} style={{ color: 'var(--color-text-secondary)' }} />
                    <span style={{ flex: 1 }}>Revert to Default</span>
                  </div>
                </div>
              );
            })()}

            {/* Floating Toast Notification */}
            {toastMsg && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '72px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: 'var(--color-bg-elevated)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-default)',
                  borderRadius: 'var(--radius-xl, 20px)',
                  boxShadow: 'var(--shadow-float, 0 8px 24px rgba(15, 23, 42, 0.12))',
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: 500,
                  zIndex: 100,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  pointerEvents: 'none',
                  backdropFilter: 'blur(12px)',
                }}
              >
                <RotateCcw size={14} style={{ color: 'var(--color-accent)' }} />
                <span>{toastMsg}</span>
              </div>
            )}

            {/* Interactive SVG Renderer */}
            {(() => {
              const displayNodes = layoutNodes.length > 0 ? layoutNodes : (layout?.nodes || []);
              return (
                <svg
                  ref={svgRef}
                  width="100%"
                  height="100%"
                  style={{ display: 'block', width: '100%', height: '100%' }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenuPos({ x: e.clientX, y: e.clientY });
                  }}
                >
                  <defs>
                    <pattern id="dot-grid-snap" width={20} height={20} patternUnits="userSpaceOnUse">
                      <circle cx={2} cy={2} r={1.2} fill={gridColors.dot} />
                    </pattern>
                    <pattern id="line-grid-snap" width={20} height={20} patternUnits="userSpaceOnUse">
                      <path d="M 20 0 L 0 0 0 20" fill="none" stroke={gridColors.line} strokeWidth="1" />
                    </pattern>
                    <marker id="snap-arrowhead" markerWidth={9} markerHeight={7} refX={7.5} refY={3.5} orient="auto">
                      <polygon points="1 1, 7.5 3.5, 1 6" fill="var(--canvas-edge-stroke, #64748b)" />
                    </marker>
                  </defs>
                  <rect width="100%" height="100%" fill={canvasBgColor || 'transparent'} />
                  <rect width="100%" height="100%" fill={canvasGrid === 'none' ? 'transparent' : canvasGrid === 'lines' ? 'url(#line-grid-snap)' : 'url(#dot-grid-snap)'} />

                  <g transform={`translate(${panOffset.x}, ${panOffset.y}) scale(${zoomLevel})`}>
                    {/* 1. Measurement Indicator Lines (Parent Latent to Indicator) */}
                    {displayNodes
                      .filter((n: any) => !n.isLatent && n.parentId)
                      .filter((indNode: any) => {
                        const parentNode = displayNodes.find((n: any) => n.id === indNode.parentId);
                        return parentNode && !parentNode.indicatorsHidden;
                      })
                      .map((indNode: any) => {
                        const parentNode = displayNodes.find((n: any) => n.id === indNode.parentId);
                        if (!parentNode) return null;
                        const isFormative = parentNode.type === 'formative';
                        const source = isFormative ? indNode : parentNode;
                        const target = isFormative ? parentNode : indNode;

                        const srcOff = getNodeIntersectionOffset(source, target.x, target.y);
                        const tgtOff = getNodeIntersectionOffset(target, source.x, source.y);
                        const x1 = source.x + srcOff.x;
                        const y1 = source.y + srcOff.y;
                        const x2 = target.x + tgtOff.x;
                        const y2 = target.y + tgtOff.y;

                        const indMidX = (x1 + x2) / 2;
                        const indMidY = (y1 + y2) / 2;
                        const loading = getOuterLoading(parentNode, indNode);
                        const pillW = loading !== null ? Math.max(30, loading.toFixed(3).length * 6.5 + 8) : 32;
                        const pillH = 15;

                        return (
                          <g key={`ind-link-${indNode.id}`}>
                            <title>{isFormative ? `${indNode.label} → ${parentNode.label} (Formative weight${loading !== null ? `: ${loading.toFixed(3)}` : ''})` : `${parentNode.label} → ${indNode.label} (Reflective loading${loading !== null ? `: ${loading.toFixed(3)}` : ''})`}</title>
                            <line
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke="var(--canvas-edge-stroke, #64748b)"
                              strokeWidth="1.5"
                              markerEnd="url(#snap-arrowhead)"
                            />
                            {loading !== null && (
                              <g transform={`translate(${indMidX}, ${indMidY})`} pointerEvents="none">
                                <rect
                                  x={-pillW / 2}
                                  y={-pillH / 2}
                                  width={pillW}
                                  height={pillH}
                                  rx="3"
                                  fill="var(--canvas-badge-bg, #ffffff)"
                                  stroke="var(--canvas-badge-border, #cbd5e1)"
                                  strokeWidth="0.75"
                                />
                                <text
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  fontSize="9.5"
                                  fontFamily="var(--font-mono)"
                                  fontWeight="500"
                                  fill="var(--canvas-badge-text, #0f172a)"
                                >
                                  {loading.toFixed(3)}
                                </text>
                              </g>
                            )}
                          </g>
                        );
                      })}

                    {/* 2. Structural Paths (Latent to Latent Edges) */}
                    {(() => {
                      const activeEdges = layoutEdges.length > 0 ? layoutEdges : (layout?.edges || []);
                      const edgesWithCoords = activeEdges.map((edge: any) => {
                        const srcNode = displayNodes.find((n: any) => n.id === edge.sourceId);
                        const tgtNode = displayNodes.find((n: any) => n.id === edge.targetId);
                        if (!srcNode || !tgtNode) return null;

                        const outgoing = activeEdges.filter((e: any) => e.sourceId === srcNode.id);
                        outgoing.sort((a: any, b: any) => (displayNodes.find((n: any) => n.id === a.targetId)?.y || 0) - (displayNodes.find((n: any) => n.id === b.targetId)?.y || 0));
                        const srcIdx = outgoing.findIndex((e: any) => e.id === edge.id || (e.sourceId === edge.sourceId && e.targetId === edge.targetId));

                        const incoming = activeEdges.filter((e: any) => e.targetId === tgtNode.id);
                        incoming.sort((a: any, b: any) => (displayNodes.find((n: any) => n.id === a.sourceId)?.y || 0) - (displayNodes.find((n: any) => n.id === b.sourceId)?.y || 0));
                        const tgtIdx = incoming.findIndex((e: any) => e.id === edge.id || (e.sourceId === edge.sourceId && e.targetId === edge.targetId));

                        const srcOff = getPortOffset(srcNode, tgtNode, srcIdx, outgoing.length, false);
                        const tgtOff = getPortOffset(tgtNode, srcNode, tgtIdx, incoming.length, true);
                        const coef = getPathCoefficient(srcNode, tgtNode);

                        return {
                          ...edge,
                          srcNode,
                          tgtNode,
                          x1: srcNode.x + srcOff.x,
                          y1: srcNode.y + srcOff.y,
                          x2: tgtNode.x + tgtOff.x,
                          y2: tgtNode.y + tgtOff.y,
                          hasBadge: coef !== null,
                          coef,
                        };
                      }).filter(Boolean);

                      const badgePosMap = resolveBadgePositions(edgesWithCoords);

                      return edgesWithCoords.map((edge: any) => {
                        const { x1, y1, x2, y2, srcNode, tgtNode, coef } = edge;

                        let d = `M ${x1} ${y1}`;
                        if (edge.curved) {
                          const mx = (x1 + x2) / 2;
                          const my = (y1 + y2) / 2;
                          const dx = x2 - x1;
                          const dy = y2 - y1;
                          const len = Math.hypot(dx, dy) || 1;
                          const curveVal = typeof edge.curvature === 'number' ? edge.curvature : 40;
                          const cx = mx + (-dy / len) * curveVal;
                          const cy = my + (dx / len) * curveVal;
                          d += ` Q ${cx} ${cy} ${x2} ${y2}`;
                        } else {
                          d += ` L ${x2} ${y2}`;
                        }

                        const badgeKey = edge.id || `${edge.sourceId}->${edge.targetId}`;
                        const badgePos = badgePosMap.get(badgeKey);
                        const badgeX = badgePos ? badgePos.x : (x1 + x2) / 2;
                        const badgeY = badgePos ? badgePos.y : (y1 + y2) / 2;

                        const pillW = coef !== null ? Math.max(34, coef.toFixed(3).length * 7.5 + 10) : 34;
                        const pillH = 18;

                        return (
                          <g key={edge.id || `${edge.sourceId}-${edge.targetId}`}>
                            <title>{srcNode.label} → {tgtNode.label}{coef !== null ? ` (Path Coefficient β = ${coef.toFixed(3)})` : ''}</title>
                            <path
                              d={d}
                              fill="none"
                              stroke="var(--canvas-edge-stroke, #64748b)"
                              strokeWidth="2"
                              markerEnd="url(#snap-arrowhead)"
                            />
                            {coef !== null && (
                              <g transform={`translate(${badgeX}, ${badgeY})`} pointerEvents="none">
                                <rect
                                  x={-pillW / 2}
                                  y={-pillH / 2}
                                  width={pillW}
                                  height={pillH}
                                  rx="4"
                                  fill="var(--canvas-badge-bg, #ffffff)"
                                  stroke="var(--canvas-badge-border, #cbd5e1)"
                                  strokeWidth="1"
                                />
                                <text
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  fontSize="10.5"
                                  fontFamily="var(--font-mono)"
                                  fontWeight="600"
                                  fill="var(--canvas-badge-text, #0f172a)"
                                >
                                  {coef.toFixed(3)}
                                </text>
                              </g>
                            )}
                          </g>
                        );
                      });
                    })()}

                    {/* 3. Nodes */}
                    {displayNodes
                      .filter((node: any) => {
                        if (!node.isLatent && node.parentId) {
                          const parent = displayNodes.find((p: any) => p.id === node.parentId);
                          if (parent && parent.indicatorsHidden) return false;
                        }
                        return true;
                      })
                      .map((node: any) => {
                        const isLatent = node.isLatent !== false && !node.isText;
                        const isText = !!node.isText;
                        const r2 = results?.structural?.r_squared?.[node.label] ?? results?.structural?.r_squared?.[node.id] ?? results?.r_squared?.[node.label];

                        if (isText) {
                          return (
                            <g
                              key={node.id}
                              transform={`translate(${node.x}, ${node.y})`}
                              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                              style={{ cursor: 'move', pointerEvents: 'all' }}
                            >
                              <title>Text Note: {node.label || node.text}</title>
                              <text
                                fontSize={node.fontSize || 13}
                                fill="var(--color-text-primary)"
                                style={{ userSelect: 'none' }}
                              >
                                {node.label || node.text}
                              </text>
                            </g>
                          );
                        }

                        if (isLatent) {
                          return (
                            <g
                              key={node.id}
                              transform={`translate(${node.x}, ${node.y})`}
                              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setHoveredLatent(null);
                                setContextMenuPos({ x: e.clientX, y: e.clientY, targetNodeId: node.id });
                              }}
                              onPointerEnter={() => {
                                const r2Val = results?.structural?.r_squared?.[node.label] ?? results?.structural?.r_squared?.[node.id] ?? results?.r_squared?.[node.label];
                                const r2AdjVal = results?.structural?.r_squared_adj?.[node.label] ?? results?.structural?.r_squared_adj?.[node.id] ?? results?.r_squared_adj?.[node.label];
                                const rel = results?.reliability_and_validity || {};
                                const crVal = rel.composite_reliability?.[node.label] ?? results?.composite_reliability?.[node.label];
                                const aveVal = rel.ave?.[node.label] ?? results?.ave?.[node.label];
                                const alphaVal = rel.cronbachs_alpha?.[node.label] ?? results?.cronbachs_alpha?.[node.label];

                                const screenX = panOffset.x + node.x * zoomLevel;
                                const screenY = panOffset.y + (node.y - (node.r || 36)) * zoomLevel;

                                setHoveredLatent({
                                  name: node.label,
                                  r2: (r2Val !== undefined && r2Val !== null && !isNaN(Number(r2Val))) ? Number(r2Val) : null,
                                  r2Adj: (r2AdjVal !== undefined && r2AdjVal !== null && !isNaN(Number(r2AdjVal))) ? Number(r2AdjVal) : null,
                                  cr: (crVal !== undefined && crVal !== null && !isNaN(Number(crVal))) ? Number(crVal) : null,
                                  ave: (aveVal !== undefined && aveVal !== null && !isNaN(Number(aveVal))) ? Number(aveVal) : null,
                                  alpha: (alphaVal !== undefined && alphaVal !== null && !isNaN(Number(alphaVal))) ? Number(alphaVal) : null,
                                  x: screenX,
                                  y: screenY,
                                });
                              }}
                              onPointerLeave={() => setHoveredLatent(null)}
                              style={{ cursor: 'move', pointerEvents: 'all' }}
                            >
                              <title>{node.label} ({node.type === 'formative' ? 'Formative' : 'Reflective'} Construct{r2 !== undefined ? `, R² = ${fmt(r2, 3)}` : ''})</title>
                              <circle
                                r={node.r || 36}
                                fill={node.fill || "var(--canvas-latent-fill, #334155)"}
                                stroke={node.stroke || "var(--canvas-latent-stroke, #1e293b)"}
                                strokeWidth="2"
                              />
                              {node.textInside !== false ? (
                                <>
                                  <text
                                    textAnchor="middle"
                                    y={r2 !== undefined ? -6 : 0}
                                    dominantBaseline={r2 !== undefined ? "auto" : "central"}
                                    fontSize={r2 !== undefined ? "12" : "13"}
                                    fontWeight="600"
                                    fill={node.textColor || "var(--canvas-latent-text, #ffffff)"}
                                    style={{ userSelect: 'none' }}
                                  >
                                    {node.label}
                                  </text>
                                  {r2 !== undefined && (
                                    <text
                                      textAnchor="middle"
                                      y="12"
                                      fontSize="11"
                                      fontWeight="500"
                                      fill="var(--canvas-latent-r2, #a5b4fc)"
                                      style={{ userSelect: 'none' }}
                                    >
                                      R² = {fmt(r2, 3)}
                                    </text>
                                  )}
                                </>
                              ) : (
                                <>
                                  {(() => {
                                    const r = node.r || 36;
                                    const textPos = node.textPosition || 'bottom';
                                    let lx = 0;
                                    let ly = r + 18;
                                    let tAnchor: "middle" | "start" | "end" = "middle";

                                    if (textPos === 'top') {
                                      lx = 0;
                                      ly = -r - 10;
                                      tAnchor = "middle";
                                    } else if (textPos === 'left') {
                                      lx = -r - 10;
                                      ly = 4;
                                      tAnchor = "end";
                                    } else if (textPos === 'right') {
                                      lx = r + 10;
                                      ly = 4;
                                      tAnchor = "start";
                                    } else { // 'bottom'
                                      lx = 0;
                                      ly = r + 18;
                                      tAnchor = "middle";
                                    }

                                    return (
                                      <text
                                        x={lx}
                                        y={ly}
                                        textAnchor={tAnchor}
                                        fontSize="12"
                                        fontWeight="600"
                                        fill="var(--color-text-primary, #0f172a)"
                                        style={{ userSelect: 'none' }}
                                      >
                                        {node.label}
                                      </text>
                                    );
                                  })()}
                                  {r2 !== undefined && (
                                    <text
                                      textAnchor="middle"
                                      y="4"
                                      fontSize="11"
                                      fontWeight="600"
                                      fill="var(--color-accent, #6366f1)"
                                      style={{ userSelect: 'none' }}
                                    >
                                      R² = {fmt(r2, 3)}
                                    </text>
                                  )}
                                </>
                              )}

                              {/* If indicators are hidden, render a clean purple eye icon beside the label */}
                              {node.indicatorsHidden && (() => {
                                const childInds = displayNodes.filter((n: any) => n.parentId === node.id && !n.isLatent);
                                if (childInds.length === 0) return null;
                                const labelLen = (node.label || '').length * 8;
                                const r = node.r || 36;
                                const textPos = node.textPosition || 'bottom';
                                let eyeX = (labelLen / 2) + 12;
                                let eyeY = r + 18;

                                if (node.textInside) {
                                  eyeX = (labelLen / 2) + 12;
                                  eyeY = r2 !== undefined ? -4 : 4;
                                } else {
                                  if (textPos === 'top') {
                                    eyeX = (labelLen / 2) + 12;
                                    eyeY = -r - 10;
                                  } else if (textPos === 'left') {
                                    eyeX = -r - 10 + 12;
                                    eyeY = 4;
                                  } else if (textPos === 'right') {
                                    eyeX = r + 10 + labelLen + 12;
                                    eyeY = 4;
                                  } else {
                                    eyeX = (labelLen / 2) + 12;
                                    eyeY = r + 18;
                                  }
                                }
                                return (
                                  <g
                                    className="canvas-hidden-indicators-icon-btn"
                                    transform={`translate(${eyeX}, ${eyeY - 9})`}
                                    style={{ cursor: 'pointer', pointerEvents: 'all' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setLayoutNodes(prev => prev.map(n => n.id === node.id ? { ...n, indicatorsHidden: false } : n));
                                      setToastMsg('Indicators visible');
                                      setTimeout(() => setToastMsg(null), 2000);
                                    }}
                                  >
                                    <title>{childInds.length} indicators hidden. Click to show.</title>
                                    <rect x="-4" y="-3" width="24" height="20" fill="transparent" />
                                    <g transform="scale(0.7) translate(-2, 0)">
                                      <path
                                        d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
                                        fill="var(--color-accent, #6B4EE6)"
                                        fillRule="evenodd"
                                      />
                                    </g>
                                  </g>
                                );
                              })()}
                            </g>
                          );
                        }

                        // Indicator (Manifest variable)
                        const parentNode = displayNodes.find((n: any) => n.id === node.parentId);
                        const isIndInside = node.textInside !== undefined ? node.textInside : true;
                        return (
                          <g
                            key={node.id}
                            transform={`translate(${node.x - 35}, ${node.y - 14})`}
                            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setHoveredLatent(null);
                              setContextMenuPos({ x: e.clientX, y: e.clientY, targetNodeId: node.id });
                            }}
                            style={{ cursor: 'move', pointerEvents: 'all' }}
                          >
                            <title>{node.label} (Indicator of {parentNode?.label || 'construct'})</title>
                            <rect
                              width="70"
                              height="28"
                              rx="4"
                              fill={node.fill || "var(--canvas-manifest-fill, #fef08a)"}
                              stroke={node.stroke || "var(--canvas-manifest-stroke, #ca8a04)"}
                              strokeWidth="1.5"
                            />
                            {isIndInside ? (
                              <text
                                x="35"
                                y="18"
                                textAnchor="middle"
                                fontSize="11"
                                fontWeight="500"
                                fill={node.textColor || "var(--canvas-manifest-text, #422006)"}
                                style={{ userSelect: 'none' }}
                              >
                                {node.label}
                              </text>
                            ) : (() => {
                              const pos = node.textPosition || 'bottom';
                              let ix = 35;
                              let iy = 42;
                              let iAnchor: "middle" | "start" | "end" = "middle";

                              if (pos === 'top') {
                                ix = 35;
                                iy = -8;
                                iAnchor = "middle";
                              } else if (pos === 'left') {
                                ix = -8;
                                iy = 18;
                                iAnchor = "end";
                              } else if (pos === 'right') {
                                ix = 78;
                                iy = 18;
                                iAnchor = "start";
                              } else { // 'bottom'
                                ix = 35;
                                iy = 42;
                                iAnchor = "middle";
                              }

                              return (
                                <text
                                  x={ix}
                                  y={iy}
                                  textAnchor={iAnchor}
                                  fontSize="11"
                                  fontWeight="500"
                                  fill="var(--color-text-primary, #0f172a)"
                                  style={{ userSelect: 'none' }}
                                >
                                  {node.label}
                                </text>
                              );
                            })()}
                          </g>
                        );
                      })}
                  </g>
                </svg>
              );
            })()}

            {/* Hovered Latent Variable Metrics Popup matching model-canvas */}
            {hoveredLatent && (
              <div
                className="canvas-latent-popup visible"
                style={{
                  position: 'absolute',
                  left: `${hoveredLatent.x}px`,
                  top: `${hoveredLatent.y - 8}px`,
                  transform: 'translate(-50%, -100%) scale(1)',
                  display: 'block',
                  zIndex: 9000,
                  pointerEvents: 'none'
                }}
              >
                <div className="canvas-latent-popup__header">
                  <span className="canvas-latent-popup__badge">LATENT</span>
                  <span className="canvas-latent-popup__title">{hoveredLatent.name}</span>
                </div>
                <div className="canvas-latent-popup__grid">
                  {hoveredLatent.r2 !== null && (
                    <>
                      <div className="canvas-latent-popup__item">
                        <span className="canvas-latent-popup__label">R²</span>
                        <span className="canvas-latent-popup__val highlight">{hoveredLatent.r2.toFixed(4)}</span>
                      </div>
                      <div className="canvas-latent-popup__item">
                        <span className="canvas-latent-popup__label">R² Adjusted</span>
                        <span className="canvas-latent-popup__val">{hoveredLatent.r2Adj !== null ? hoveredLatent.r2Adj.toFixed(4) : '—'}</span>
                      </div>
                    </>
                  )}
                  <div className="canvas-latent-popup__item">
                    <span className="canvas-latent-popup__label">Composite Reliability</span>
                    <span className="canvas-latent-popup__val">{hoveredLatent.cr !== null ? hoveredLatent.cr.toFixed(4) : '—'}</span>
                  </div>
                  <div className="canvas-latent-popup__item">
                    <span className="canvas-latent-popup__label">Avg Variance Extracted</span>
                    <span className="canvas-latent-popup__val">{hoveredLatent.ave !== null ? hoveredLatent.ave.toFixed(4) : '—'}</span>
                  </div>
                  <div className="canvas-latent-popup__item">
                    <span className="canvas-latent-popup__label">Cronbach's Alpha (α)</span>
                    <span className="canvas-latent-popup__val">{hoveredLatent.alpha !== null ? hoveredLatent.alpha.toFixed(4) : '—'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ EDIT MODEL MODAL ═══ */}
        {isEditModalOpen && (
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
              width: '440px',
              maxWidth: '92vw',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08)',
              overflow: 'hidden',
              border: '1px solid var(--color-border-subtle)',
            }}>
              <div style={{
                padding: '18px 20px',
                borderBottom: '1px solid var(--color-border-subtle)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--color-accent-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-accent)',
                  flexShrink: 0,
                }}>
                  <Edit3 size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    Create Editable Model from Snapshot
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                    Creates a new model in this study initialized with this snapshot's diagram
                  </p>
                </div>
              </div>

              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                    New Model Name
                  </label>
                  <input
                    type="text"
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    placeholder="Enter model name..."
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

                <div style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  backgroundColor: 'var(--color-bg-raised)',
                  border: '1px solid var(--color-border-subtle)',
                  fontSize: '12px',
                  color: 'var(--color-text-secondary)'
                }}>
                  Target Study: <strong style={{ color: 'var(--color-text-primary)' }}>{activeStudy?.name}</strong>
                </div>
              </div>

              <div style={{
                padding: '12px 20px',
                backgroundColor: 'var(--color-bg-raised)',
                borderTop: '1px solid var(--color-border-subtle)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
              }}>
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  disabled={isCreatingModel}
                  style={{
                    padding: '7px 14px',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateModel}
                  disabled={isCreatingModel || !newModelName.trim()}
                  style={{
                    padding: '7px 16px',
                    backgroundColor: 'var(--color-accent)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: isCreatingModel || !newModelName.trim() ? 'not-allowed' : 'pointer',
                    opacity: isCreatingModel || !newModelName.trim() ? 0.6 : 1,
                  }}
                >
                  {isCreatingModel ? 'Creating...' : 'Create & Open Model'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Copy Toast Notification ═══ */}
        {copyToast && (
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
            <span style={{ color: '#10b981' }}>✓</span> {copyToast}
          </div>
        )}

        {/* ═══ Publication Diagram Exporter Modal ═══ */}
        <DiagramExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          svgElement={svgRef.current}
          modelName={snapshot?.name || 'snapshot_model'}
          results={results}
        />

        {/* ═══ Multi-Model Comparison Modal ═══ */}
        <ModelComparisonModal
          isOpen={isCompareModalOpen}
          onClose={() => setIsCompareModalOpen(false)}
          projectPath={activeStudy?.path || ''}
          initialSnapshotId={activeTab?.snapshotId || snapshot?.id}
          studyName={activeStudy?.name}
        />

      </div>
    </div>
  );
};

export default SnapshotView;
