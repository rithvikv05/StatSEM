/**
 * StatSEM Model Canvas Engine
 * Pure Vanilla JS + SVG implementation for professional vector diagramming.
 */
import { performAutoLayout, resolveBadgePositions } from './semLayoutEngine';
import {
  formatNumber,
  formatPValue,
  normalizeDecimalDigits,
  DEFAULT_DECIMAL_DIGITS,
} from './number-format';

function getPrecisionSettings() {
  let settings = null;
  if (typeof window !== 'undefined' && window.__useStore) {
    try {
      settings = window.__useStore.getState()?.settings;
    } catch (e) {}
  }
  if (!settings && typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem('cspls-storage') || localStorage.getItem('statsem-storage');
      if (stored) {
        settings = JSON.parse(stored)?.state?.settings;
      }
    } catch (e) {}
  }
  return {
    decimalDigits: normalizeDecimalDigits(settings?.decimalDigits),
    decimalSystem: settings?.decimalSystem === 'comma' ? 'comma' : 'point',
  };
}

function formatCanvasNumber(val) {
  const { decimalDigits, decimalSystem } = getPrecisionSettings();
  return formatNumber(val, decimalDigits, decimalSystem);
}

function formatCanvasPEq(val) {
  const { decimalDigits, decimalSystem } = getPrecisionSettings();
  const formatted = formatPValue(val, decimalDigits, decimalSystem);
  return formatted.startsWith('<') ? `p ${formatted}` : `p = ${formatted}`;
}

export function getCanvasGridColors(bgColor) {
  const isDark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  let color = (bgColor || '').trim();

  // If no custom background color, fall back to theme defaults
  if (!color) {
    if (isDark) {
      return {
        dot: 'rgba(255, 255, 255, 0.40)',
        line: 'rgba(255, 255, 255, 0.24)'
      };
    } else {
      return {
        dot: 'rgba(71, 85, 105, 0.40)',
        line: 'rgba(100, 116, 139, 0.30)'
      };
    }
  }

  // Parse RGB components
  let r = 255, g = 255, b = 255;
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    if (hex.length >= 6) {
      r = parseInt(hex.slice(0, 2), 16) || 0;
      g = parseInt(hex.slice(2, 4), 16) || 0;
      b = parseInt(hex.slice(4, 6), 16) || 0;
    }
  } else if (color.startsWith('rgb')) {
    const match = color.match(/\(([^)]+)\)/);
    if (match) {
      const parts = match[1].split(',').map(p => parseFloat(p.trim()));
      r = Math.min(255, Math.max(0, parts[0] || 0));
      g = Math.min(255, Math.max(0, parts[1] || 0));
      b = Math.min(255, Math.max(0, parts[2] || 0));
    }
  } else if (typeof document !== 'undefined') {
    try {
      const temp = document.createElement('div');
      temp.style.color = color;
      document.body.appendChild(temp);
      const computed = window.getComputedStyle(temp).color;
      document.body.removeChild(temp);
      const match = computed.match(/\(([^)]+)\)/);
      if (match) {
        const parts = match[1].split(',').map(p => parseFloat(p.trim()));
        r = parts[0] || 0;
        g = parts[1] || 0;
        b = parts[2] || 0;
      }
    } catch (e) {}
  }

  // Calculate relative luminance using ITU-R BT.709 formula
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  if (luminance < 0.45) {
    // Dark background: use high-contrast white dots & lines
    const dotAlpha = luminance < 0.2 ? 0.50 : 0.42;
    const lineAlpha = luminance < 0.2 ? 0.32 : 0.25;
    return {
      dot: `rgba(255, 255, 255, ${dotAlpha})`,
      line: `rgba(255, 255, 255, ${lineAlpha})`
    };
  } else {
    // Light background: use dark slate dots & lines
    const dotAlpha = luminance > 0.85 ? 0.42 : 0.50;
    const lineAlpha = luminance > 0.85 ? 0.30 : 0.38;
    return {
      dot: `rgba(30, 41, 59, ${dotAlpha})`,
      line: `rgba(51, 65, 85, ${lineAlpha})`
    };
  }
}

export function initModelCanvas() {
  window.toggleVarCat = function(catEl) {
    const items = catEl.querySelector('.var-items');
    const chevron = catEl.querySelector('.cat-chevron');
    if (items) items.classList.toggle('hidden');
    if (chevron) chevron.classList.toggle('rotated');
  };

  // ─── DOM References ──────────────────────────────────────────────────────
  const svg = document.getElementById('model-svg');
  if (!svg) return;

  if (window.__canvasCleanup) {
    try { window.__canvasCleanup(); } catch (e) {}
  }
  const ac = new AbortController();
  const { signal } = ac;
  window.__canvasCleanup = () => ac.abort();


  const zoomLayer = document.getElementById('zoom-layer');
  const nodesLayer = document.getElementById('nodes-layer');
  const edgesLayer = document.getElementById('edges-layer');
  const guidesLayer = document.getElementById('guides-layer');
  const emptyHint = document.getElementById('canvas-empty-hint');
  const bgRect = document.getElementById('bg-rect');
  const bgColorRect = document.getElementById('bg-color-rect');
  const canvasArea = document.querySelector('.canvas-area');

  // Helper for dynamic colored arrowhead markers
  function getOrCreateMarker(type, color) {
    if (!type || type === 'none') return '';
    const safeColor = String(color || '#0f172a').replace(/[^a-zA-Z0-9]/g, '_');
    const markerId = `arrow-${type}-${safeColor}`;
    if (!defs.querySelector(`#${markerId}`)) {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', markerId);
      marker.setAttribute('orient', 'auto');
      if (type === 'solid') {
        marker.setAttribute('markerWidth', '9');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('refX', '7.5');
        marker.setAttribute('refY', '3.5');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        p.setAttribute('points', '1 1, 7.5 3.5, 1 6');
        p.setAttribute('fill', color);
        marker.appendChild(p);
      } else if (type === 'open') {
        marker.setAttribute('markerWidth', '9');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('refX', '7.5');
        marker.setAttribute('refY', '3.5');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', 'M 1 0.8 L 7.5 3.5 L 1 6.2');
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', color);
        p.setAttribute('stroke-width', '1.0');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        marker.appendChild(p);
      } else if (type === 'diamond') {
        marker.setAttribute('markerWidth', '9');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '3.5');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        p.setAttribute('points', '1 3.5, 4.5 1.2, 8 3.5, 4.5 5.8');
        p.setAttribute('fill', color);
        marker.appendChild(p);
      } else if (type === 'circle') {
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '8');
        marker.setAttribute('refX', '7');
        marker.setAttribute('refY', '4');
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', '4');
        c.setAttribute('cy', '4');
        c.setAttribute('r', '3');
        c.setAttribute('fill', color);
        marker.appendChild(c);
      }
      defs.appendChild(marker);
    }
    return markerId;
  }

  // Canvas Grid & Background Color management
  let currentGrid = 'dots';
  let currentBgColor = '';
  let currentRecentBgColors = [];
  let currentDecimalDigits = DEFAULT_DECIMAL_DIGITS;
  let currentDecimalSystem = 'point';

  function updateCanvasGridColors(bgColor) {
    const colors = getCanvasGridColors(bgColor);
    const targetCanvasArea = document.querySelector('.canvas-area') || canvasArea;
    if (targetCanvasArea) {
      targetCanvasArea.style.setProperty('--canvas-dot-color', colors.dot);
      targetCanvasArea.style.setProperty('--canvas-line-color', colors.line);
    }
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--canvas-dot-color', colors.dot);
      document.documentElement.style.setProperty('--canvas-line-color', colors.line);
    }

    const dotGridEl = document.getElementById('dot-grid');
    if (dotGridEl) {
      const circle = dotGridEl.querySelector('circle');
      if (circle) circle.setAttribute('fill', colors.dot);
    }
    const lineGridEl = document.getElementById('line-grid');
    if (lineGridEl) {
      const path = lineGridEl.querySelector('path');
      if (path) {
        path.setAttribute('stroke', colors.line);
        path.removeAttribute('opacity');
      }
    }
  }

  function applyGrid(grid) {
    currentGrid = grid || 'dots';
    const targetBgRect = document.getElementById('bg-rect') || bgRect;
    if (!targetBgRect) return;
    if (currentGrid === 'blank') {
      targetBgRect.setAttribute('fill', 'transparent');
    } else if (currentGrid === 'grid') {
      targetBgRect.setAttribute('fill', 'url(#line-grid)');
    } else {
      targetBgRect.setAttribute('fill', 'url(#dot-grid)');
    }
    updateCanvasGridColors(currentBgColor);
  }

  function applyBgColor(color) {
    currentBgColor = color || '';
    const targetBgColorRect = document.getElementById('bg-color-rect') || bgColorRect;
    if (targetBgColorRect) {
      targetBgColorRect.setAttribute('fill', currentBgColor || 'transparent');
    }
    const targetCanvasArea = document.querySelector('.canvas-area') || canvasArea;
    if (targetCanvasArea) {
      targetCanvasArea.style.backgroundColor = currentBgColor || 'var(--color-bg-base)';
    }
    updateCanvasGridColors(currentBgColor);
  }

  function getCanvasSettingsFromStore() {
    if (typeof window !== 'undefined' && window.__useStore) {
      try {
        return window.__useStore.getState()?.settings;
      } catch (e) {}
    }
    try {
      const stored = localStorage.getItem('cspls-storage') || localStorage.getItem('statsem-storage');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.state?.settings) return parsed.state.settings;
      }
    } catch (e) {}
    return null;
  }

  function loadCanvasSettings() {
    const s = getCanvasSettingsFromStore();
    if (s) {
      if (s.canvasGrid) currentGrid = s.canvasGrid;
      if (s.canvasBgColor !== undefined) currentBgColor = s.canvasBgColor;
      if (Array.isArray(s.canvasRecentBgColors)) currentRecentBgColors = s.canvasRecentBgColors;
      currentDecimalDigits = normalizeDecimalDigits(s.decimalDigits);
      currentDecimalSystem = s.decimalSystem === 'comma' ? 'comma' : 'point';
    }
    applyGrid(currentGrid);
    applyBgColor(currentBgColor);
  }

  function saveCanvasSettings(updates) {
    if (typeof window !== 'undefined' && window.__useStore) {
      try {
        window.__useStore.getState().updateSettings(updates);
      } catch (e) {}
    }
    try {
      ['cspls-storage', 'statsem-storage'].forEach(key => {
        const stored = localStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.state?.settings) {
            parsed.state.settings = { ...parsed.state.settings, ...updates };
            localStorage.setItem(key, JSON.stringify(parsed));
          }
        }
      });
    } catch (e) {}
  }

  loadCanvasSettings();

  if (typeof window !== 'undefined' && window.__useStore) {
    window.__useStore.subscribe((state, prevState) => {
      if (state?.settings?.canvasGrid && state.settings.canvasGrid !== currentGrid) {
        applyGrid(state.settings.canvasGrid);
      }
      if (state?.settings?.canvasBgColor !== undefined && state.settings.canvasBgColor !== currentBgColor) {
        applyBgColor(state.settings.canvasBgColor);
      }
      if (Array.isArray(state?.settings?.canvasRecentBgColors)) {
        currentRecentBgColors = state.settings.canvasRecentBgColors;
      }
      const nextDigits = normalizeDecimalDigits(state?.settings?.decimalDigits);
      const nextSystem = state?.settings?.decimalSystem === 'comma' ? 'comma' : 'point';
      if (nextDigits !== currentDecimalDigits || nextSystem !== currentDecimalSystem) {
        currentDecimalDigits = nextDigits;
        currentDecimalSystem = nextSystem;
        if (typeof window !== 'undefined' && typeof window.renderModelCanvas === 'function') {
          window.renderModelCanvas();
        }
      }
    });
  }

  window.addEventListener('canvas-grid-change', (e) => {
    if (e.detail?.grid) {
      applyGrid(e.detail.grid);
      saveCanvasSettings({ canvasGrid: e.detail.grid });
    }
  }, { signal });

  window.addEventListener('canvas-bg-change', (e) => {
    if (e.detail?.color !== undefined) {
      applyBgColor(e.detail.color);
      saveCanvasSettings({ canvasBgColor: e.detail.color });
    }
  }, { signal });

  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const themeObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-theme') {
          updateCanvasGridColors(currentBgColor);
        }
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    signal.addEventListener('abort', () => themeObserver.disconnect());
  }

  // Ensure all arrowhead markers exist in SVG defs
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  const requiredMarkers = [
    { id: 'arrow-solid', tag: 'polygon', attrs: { points: '0 1.5, 9 5, 0 8.5', fill: 'var(--color-text-primary, #1e293b)' }, refX: '9', refY: '5' },
    { id: 'arrow-solid-selected', tag: 'polygon', attrs: { points: '0 1.5, 9 5, 0 8.5', fill: 'var(--color-accent, #6B4EE6)' }, refX: '9', refY: '5' },
    { id: 'arrow-open', tag: 'path', attrs: { d: 'M 1 1.5 L 8.5 5 L 1 8.5', fill: 'none', stroke: 'var(--color-text-primary, #1e293b)', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, refX: '8.5', refY: '5' },
    { id: 'arrow-open-selected', tag: 'path', attrs: { d: 'M 1 1.5 L 8.5 5 L 1 8.5', fill: 'none', stroke: 'var(--color-accent, #6B4EE6)', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, refX: '8.5', refY: '5' },
    { id: 'arrow-diamond', tag: 'polygon', attrs: { points: '1 5, 5 1.8, 9 5, 5 8.2', fill: 'var(--color-text-primary, #1e293b)' }, refX: '9', refY: '5' },
    { id: 'arrow-diamond-selected', tag: 'polygon', attrs: { points: '1 5, 5 1.8, 9 5, 5 8.2', fill: 'var(--color-accent, #6B4EE6)' }, refX: '9', refY: '5' },
    { id: 'arrow-circle', tag: 'circle', attrs: { cx: '5', cy: '5', r: '3.5', fill: 'var(--color-text-primary, #1e293b)' }, refX: '8.5', refY: '5' },
    { id: 'arrow-circle-selected', tag: 'circle', attrs: { cx: '5', cy: '5', r: '3.5', fill: 'var(--color-accent, #6B4EE6)' }, refX: '8.5', refY: '5' },
  ];
  requiredMarkers.forEach(m => {
    if (!defs.querySelector(`#${m.id}`)) {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', m.id);
      marker.setAttribute('markerWidth', '10');
      marker.setAttribute('markerHeight', '10');
      marker.setAttribute('refX', m.refX);
      marker.setAttribute('refY', m.refY);
      marker.setAttribute('orient', 'auto');
      const child = document.createElementNS('http://www.w3.org/2000/svg', m.tag);
      Object.entries(m.attrs).forEach(([k, v]) => child.setAttribute(k, v));
      marker.appendChild(child);
      defs.appendChild(marker);
    }
  });

  // State
  let nodes = [];
  let edges = [];
  let moderatingEffects = [];
  let gaussianCopulas = [];
  let quadraticEffects = [];
  let pendingModeratorNode = null;
  let draggingGC = null;
  let draggingQE = null;
  let mode = 'select'; // select, connect, moderation, copula, quadratic, erase
  let transform = { x: 0, y: 0, k: 1 };
  let selectedIds = new Set();
  
  // History
  let history = [];
  let historyIndex = -1;
  let isUndoRedo = false;

  function pushHistory() {
    if (isUndoRedo) return;
    const state = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
      moderatingEffects: JSON.parse(JSON.stringify(moderatingEffects)),
      gaussianCopulas: JSON.parse(JSON.stringify(gaussianCopulas)),
      quadraticEffects: JSON.parse(JSON.stringify(quadraticEffects))
    };
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1);
    }
    if (history.length > 0) {
      const last = history[history.length - 1];
      if (JSON.stringify(last) === JSON.stringify(state)) return;
    }
    history.push(state);
    if (history.length > 50) history.shift();
    historyIndex = history.length - 1;

    try {
      window.dispatchEvent(new CustomEvent('canvas-changed', {
        detail: {
          nodeCount: nodes.length,
          edgeCount: edges.length
        }
      }));
    } catch (e) {}
  }
  
  setTimeout(() => pushHistory(), 500);
  
  // Settings
  let isSnapping = true;
  let showGrid = true;

  // Constants
  const NODE_R = 36; // circle radius for latent
  const SNAP_THRESHOLD = 5;

  // Generate ID
  const generateId = () => 'id_' + Math.random().toString(36).substr(2, 9);

  // Update transform
  function applyTransform() {
    hideLatentHoverPopup();
    zoomLayer.setAttribute('transform', `translate(${transform.x}, ${transform.y}) scale(${transform.k})`);
    
    // Update HUD
    const zoomLevelEl = document.getElementById('hud-zoom-level');
    if (zoomLevelEl && !zoomLevelEl.querySelector('input')) {
      zoomLevelEl.textContent = Math.round(transform.k * 100) + '%';
    }
    
    // Scale background pattern
    ['dot-grid', 'line-grid'].forEach(gridId => {
      const pattern = document.getElementById(gridId);
      if (pattern) {
        pattern.setAttribute('patternTransform', `translate(${transform.x}, ${transform.y}) scale(${transform.k})`);
      }
    });
  }

  function getModelCenterOfMass() {
    const validNodes = nodes.filter(n => typeof n.x === 'number' && !isNaN(n.x) && typeof n.y === 'number' && !isNaN(n.y));
    if (validNodes.length === 0) return null;
    let sumX = 0;
    let sumY = 0;
    validNodes.forEach(n => {
      sumX += n.x;
      sumY += n.y;
    });
    return {
      x: sumX / validNodes.length,
      y: sumY / validNodes.length
    };
  }

  function zoomToCenterOfMass(newK) {
    newK = Math.max(0.1, Math.min(newK, 3));
    const rect = svg.getBoundingClientRect();
    const com = getModelCenterOfMass();

    if (com) {
      // Center of mass placed right at the center of the canvas viewport
      transform.x = (rect.width / 2) - (com.x * newK);
      transform.y = (rect.height / 2) - (com.y * newK);
    } else {
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const ratio = newK / transform.k;
      transform.x = centerX - (centerX - transform.x) * ratio;
      transform.y = centerY - (centerY - transform.y) * ratio;
    }
    transform.k = newK;
    applyTransform();
  }

  // --- Zoom & Pan (Trackpad two-finger move to pan, pinch to zoom) ---
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Pinch to zoom (trackpad pinch gesture or Ctrl/Cmd + wheel)
      const zoomIntensity = 0.008;
      const zoomFactor = Math.exp(-e.deltaY * zoomIntensity);
      const newK = Math.max(0.1, Math.min(transform.k * zoomFactor, 3));
      
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const ratio = newK / transform.k;
      transform.x = mouseX - (mouseX - transform.x) * ratio;
      transform.y = mouseY - (mouseY - transform.y) * ratio;
      transform.k = newK;
      applyTransform();

      const zoomLevelEl = document.getElementById('hud-zoom-level');
      if (zoomLevelEl) zoomLevelEl.textContent = `${Math.round(transform.k * 100)}%`;
    } else {
      // Moving two fingers on trackpad or scrolling mouse wheel -> pan canvas
      transform.x -= e.deltaX;
      transform.y -= e.deltaY;
      applyTransform();
    }
  }, { passive: false });

  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let panTransformStart = { x: 0, y: 0 };
  let isSpacePressed = false;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) {
      const isInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (!isInput) {
        isSpacePressed = true;
        svg.style.cursor = 'grab';
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      isSpacePressed = false;
      if (!isPanning) {
        svg.style.cursor = 'default';
      }
    }
  });

  let isMarquee = false;
  let marqueeStart = { x: 0, y: 0 };
  let marqueeInitialSelected = new Set();
  let marqueeEl = null;

  svg.addEventListener('mousedown', (e) => {
    const activeRenameInput = document.getElementById('canvas-direct-inline-rename');
    if (activeRenameInput) {
      activeRenameInput.blur();
    }

    // Prevent browser native text selection dragging on canvas
    e.preventDefault();

    const isCanvasBg = e.target === svg || e.target === bgRect || e.target?.id === 'bg-rect' || e.target?.id === 'bg-color-rect';

    if (e.button === 1 || (e.button === 0 && isSpacePressed)) { // Middle click or Space+Left
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY };
      panTransformStart = { x: transform.x, y: transform.y };
      svg.style.cursor = 'grabbing';
    } else if (mode === 'text' && (isCanvasBg || e.target.tagName === 'svg' || e.target.tagName === 'rect')) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      createAndEditNewTextNode(svgPt.x, svgPt.y);
      setMode('select');
      updateToolbarUI(document.querySelector('.tb-btn[title*="Select"]'));
    } else if (mode === 'select' && e.button === 0 && isCanvasBg) {
      // Marquee drag-to-select on empty canvas
      isMarquee = true;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      marqueeStart = { x: svgPt.x, y: svgPt.y };
      marqueeInitialSelected = e.shiftKey ? new Set(selectedIds) : new Set();
      if (!e.shiftKey) {
        selectedIds.clear();
      }

      if (!marqueeEl) {
        marqueeEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        marqueeEl.setAttribute('class', 'selection-marquee');
        marqueeEl.style.fill = 'rgba(107, 78, 230, 0.12)';
        marqueeEl.style.stroke = 'var(--color-accent, #6B4EE6)';
        marqueeEl.style.strokeWidth = '1.5px';
        marqueeEl.style.strokeDasharray = '4 4';
        marqueeEl.style.pointerEvents = 'none';
      }
      marqueeEl.setAttribute('x', marqueeStart.x);
      marqueeEl.setAttribute('y', marqueeStart.y);
      marqueeEl.setAttribute('width', 0);
      marqueeEl.setAttribute('height', 0);
      guidesLayer.appendChild(marqueeEl);
      render();
    } else if (mode === 'connect' && tempConnecting && connectStartNode) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      const modTarget = findModerationTargetUnderPoint(svgPt, connectStartNode.id);
      if (modTarget) {
        if (modTarget.type === 'path') {
          handleModerationOnEdge(modTarget.edge, connectStartNode);
        } else if (modTarget.type === 'moderation') {
          handleModerationOnMod(modTarget.mod, connectStartNode);
        }
        cancelTempConnecting();
        return;
      }
      if (isCanvasBg) {
        cancelTempConnecting();
        clearSelection();
        return;
      }
    } else if (isCanvasBg) {
      if (mode === 'moderation') {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
        const modTarget = findModerationTargetUnderPoint(svgPt, pendingModeratorNode ? pendingModeratorNode.id : null);
        if (modTarget) {
          if (modTarget.type === 'path') {
            handleModerationOnEdge(modTarget.edge);
          } else if (modTarget.type === 'moderation') {
            handleModerationOnMod(modTarget.mod);
          }
          return;
        }
      }
      clearSelection();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      transform.x = panTransformStart.x + dx;
      transform.y = panTransformStart.y + dy;
      applyTransform();
      return;
    }

    if (isMarquee && marqueeEl) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());

      const minX = Math.min(marqueeStart.x, svgPt.x);
      const minY = Math.min(marqueeStart.y, svgPt.y);
      const width = Math.abs(svgPt.x - marqueeStart.x);
      const height = Math.abs(svgPt.y - marqueeStart.y);

      marqueeEl.setAttribute('x', minX);
      marqueeEl.setAttribute('y', minY);
      marqueeEl.setAttribute('width', width);
      marqueeEl.setAttribute('height', height);

      selectedIds.clear();
      marqueeInitialSelected.forEach(id => selectedIds.add(id));

      nodes.forEach(n => {
        // Exclude indicators whose parent latent variable has hidden indicators
        if (n.parentId) {
          const parent = nodes.find(p => p.id === n.parentId);
          if (parent && parent.indicatorsHidden) return;
        }

        const nw = n.width || (n.isLatent !== false ? (NODE_R * 2) : 64);
        const nh = n.height || (n.isLatent !== false ? (NODE_R * 2) : 24);
        const nx1 = n.x - nw / 2;
        const ny1 = n.y - nh / 2;
        const nx2 = n.x + nw / 2;
        const ny2 = n.y + nh / 2;

        const intersects = (nx2 >= minX && nx1 <= minX + width && ny2 >= minY && ny1 <= minY + height);
        if (intersects) {
          selectedIds.add(n.id);
        }
      });

      edges.forEach(edge => {
        if (selectedIds.has(edge.sourceId) && selectedIds.has(edge.targetId)) {
          selectedIds.add(edge.id);
        }
      });

      render();
      return;
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (isPanning) {
      isPanning = false;
      svg.style.cursor = isSpacePressed ? 'grab' : 'default';
    }
    if (isMarquee) {
      isMarquee = false;
      if (marqueeEl && marqueeEl.parentNode) {
        marqueeEl.parentNode.removeChild(marqueeEl);
      }
      marqueeEl = null;
      render();
    }
  });

  // HUD Controls
  document.getElementById('hud-zoom-in')?.addEventListener('click', () => {
    const currentPct = Math.round(transform.k * 100);
    const nextPct = Math.min(300, Math.floor((currentPct + 10) / 10) * 10);
    zoomToCenterOfMass(nextPct / 100);
  });
  document.getElementById('hud-zoom-out')?.addEventListener('click', () => {
    const currentPct = Math.round(transform.k * 100);
    const nextPct = Math.max(10, Math.ceil((currentPct - 10) / 10) * 10);
    zoomToCenterOfMass(nextPct / 100);
  });
  function fitToScreen() {
    if (nodes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const halfW = (n.width || (n.isLatent !== false ? 64 : 64)) / 2 + 24;
      const halfH = (n.height || (n.isLatent !== false ? 64 : 24)) / 2 + 24;
      minX = Math.min(minX, n.x - halfW);
      minY = Math.min(minY, n.y - halfH);
      maxX = Math.max(maxX, n.x + halfW);
      maxY = Math.max(maxY, n.y + halfH);
    });
    const rect = svg.getBoundingClientRect();
    const modelWidth = Math.max(maxX - minX, 100);
    const modelHeight = Math.max(maxY - minY, 100);
    const padding = 60;
    const availW = Math.max(rect.width - padding * 2, 100);
    const availH = Math.max(rect.height - padding * 2, 100);
    const scale = Math.min(availW / modelWidth, availH / modelHeight, 1.2);
    const k = Math.max(Math.min(scale, 1.2), 0.2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    transform = {
      x: (rect.width / 2) - (cx * k),
      y: (rect.height / 2) - (cy * k),
      k: k
    };
    applyTransform();
  }
  document.getElementById('hud-fit')?.addEventListener('click', fitToScreen);

  const zoomLevelEl = document.getElementById('hud-zoom-level');
  if (zoomLevelEl) {
    zoomLevelEl.title = "Click to edit zoom %";
    zoomLevelEl.addEventListener('click', function(e) {
      if (this.querySelector('input')) return;
      const currentPct = Math.round(transform.k * 100);
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'hud-zoom__level-input';
      input.value = `${currentPct}%`;

      this.innerHTML = '';
      this.appendChild(input);
      input.focus();
      input.select();

      let finished = false;
      const finishZoom = (valToApply) => {
        if (finished) return;
        finished = true;
        if (valToApply !== undefined && !isNaN(valToApply) && valToApply > 0) {
          const clamped = Math.max(10, Math.min(valToApply, 300));
          zoomToCenterOfMass(clamped / 100);
        }
        zoomLevelEl.textContent = `${Math.round(transform.k * 100)}%`;
      };

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          ev.stopPropagation();
          const valStr = input.value.replace(/[^0-9.]/g, '');
          const val = parseFloat(valStr);
          finishZoom(val);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          finishZoom();
        }
      });
      input.addEventListener('blur', () => {
        const valStr = input.value.replace(/[^0-9.]/g, '');
        const val = parseFloat(valStr);
        finishZoom(val);
      });
    });
  }

  function toggleSnapToGrid() {
    isSnapping = !isSnapping;
    const snapBtn = document.getElementById('hud-snap');
    if (snapBtn) snapBtn.classList.toggle('active', isSnapping);
  }
  document.getElementById('hud-snap')?.addEventListener('click', toggleSnapToGrid);

  function exportCanvasAsImage() {
    if (typeof window !== 'undefined' && typeof window.openExportDiagramModal === 'function') {
      window.openExportDiagramModal();
      return;
    }
    try {
      const svgClone = svg.cloneNode(true);
      const hints = svgClone.querySelector('#canvas-empty-hint');
      if (hints) hints.remove();
      const guides = svgClone.querySelector('#guides-layer');
      if (guides) guides.remove();

      const rect = svg.getBoundingClientRect();
      const scale = 2; // high-resolution export
      const canvas = document.createElement('canvas');
      canvas.width = rect.width * scale;
      canvas.height = rect.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, rect.width, rect.height);

      const xml = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        URL.revokeObjectURL(url);
        const link = document.createElement('a');
        link.download = `statsem_model_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      };
      img.src = url;
    } catch (err) {
      console.error('[Canvas] Failed to export diagram as image:', err);
    }
  }
  
  function resetModelStyles() {
    nodes.forEach(n => {
      delete n.fill;
      delete n.stroke;
      delete n.strokeWidth;
      delete n.color;
      delete n.fontSize;
      delete n.fontFamily;
      delete n.bold;
      delete n.italic;
      delete n.underline;
      delete n.shape;
      delete n.width;
      delete n.height;
      delete n.textInside;
      delete n.textAlign;
      delete n.verticalAlign;
      delete n.edgeColor;
      delete n.edgeStrokeWidth;
      delete n.edgeStrokeDasharray;
      delete n.edgeArrowhead;
      delete n.edgeCurved;
      delete n.edgeWaypoints;
    });
    edges.forEach(e => {
      delete e.color;
      delete e.waypoints;
      delete e.strokeWidth;
      delete e.strokeDasharray;
      delete e.arrowhead;
    });
    moderatingEffects.forEach(m => {
      delete m.color;
      delete m.strokeWidth;
      delete m.strokeDasharray;
      delete m.arrowhead;
    });

    // Reset canvas background and grid to default
    currentBgColor = '';
    currentGrid = 'dots';
    applyBgColor('');
    applyGrid('dots');
    saveCanvasSettings({ canvasBgColor: '', canvasGrid: 'dots' });
    window.dispatchEvent(new CustomEvent('canvas-bg-change', { detail: { color: '' } }));
    window.dispatchEvent(new CustomEvent('canvas-grid-change', { detail: { grid: 'dots' } }));

    render();
    pushHistory();
    window.dispatchEvent(new CustomEvent('canvas-changed'));
    window.dispatchEvent(new CustomEvent('model-styles-reset'));
  }

  document.getElementById('hud-reset')?.addEventListener('click', function(e) {
    if (nodes.length === 0 && edges.length === 0) return;
    if (window._customResetStylesHandler) {
      window._customResetStylesHandler(e);
      return;
    }
    resetModelStyles();
  });

  function clearModelCanvas() {
    hideLatentHoverPopup(true);
    nodes.length = 0;
    edges.length = 0;
    moderatingEffects.length = 0;
    gaussianCopulas.length = 0;
    quadraticEffects.length = 0;
    selectedIds.clear();
    transform.x = 0;
    transform.y = 0;
    transform.k = 1;
    applyTransform();
    const zoomLevelEl = document.getElementById('hud-zoom-level');
    if (zoomLevelEl) zoomLevelEl.textContent = `${Math.round(transform.k * 100)}%`;
    if (emptyHint) emptyHint.style.display = 'block';
    setCanvasResults(null);
    render();
    pushHistory();
    window.dispatchEvent(new CustomEvent('canvas-changed'));
  }

  document.getElementById('hud-clear')?.addEventListener('click', function(e) {
    if (nodes.length === 0 && edges.length === 0) return;
    // If handled by React or custom dialog, stop
    if (window._customClearCanvasHandler) {
      window._customClearCanvasHandler(e);
      return;
    }
    if (confirm("Are you sure you want to clear the entire canvas and results?")) {
      clearModelCanvas();
    }
  });

  function undo() {
    if (historyIndex > 0) {
      isUndoRedo = true;
      historyIndex--;
      nodes = JSON.parse(JSON.stringify(history[historyIndex].nodes));
      edges = JSON.parse(JSON.stringify(history[historyIndex].edges));
      moderatingEffects = JSON.parse(JSON.stringify(history[historyIndex].moderatingEffects || []));
      gaussianCopulas = JSON.parse(JSON.stringify(history[historyIndex].gaussianCopulas || []));
      quadraticEffects = JSON.parse(JSON.stringify(history[historyIndex].quadraticEffects || []));
      selectedIds.clear();
      render();
      isUndoRedo = false;
    }
  }

  function redo() {
    if (historyIndex < history.length - 1) {
      isUndoRedo = true;
      historyIndex++;
      nodes = JSON.parse(JSON.stringify(history[historyIndex].nodes));
      edges = JSON.parse(JSON.stringify(history[historyIndex].edges));
      moderatingEffects = JSON.parse(JSON.stringify(history[historyIndex].moderatingEffects || []));
      gaussianCopulas = JSON.parse(JSON.stringify(history[historyIndex].gaussianCopulas || []));
      quadraticEffects = JSON.parse(JSON.stringify(history[historyIndex].quadraticEffects || []));
      selectedIds.clear();
      render();
      isUndoRedo = false;
    }
  }

  document.getElementById('btn-undo')?.addEventListener('click', (e) => {
    e.preventDefault();
    undo();
  });

  document.getElementById('btn-redo')?.addEventListener('click', (e) => {
    e.preventDefault();
    redo();
  });

  document.getElementById('btn-delete')?.addEventListener('click', (e) => {
    e.preventDefault();
    deleteSelected();
  });

  document.getElementById('hud-delete')?.addEventListener('click', (e) => {
    e.preventDefault();
    deleteSelected();
  });

  function isLatentConnectedInModel(node) {
    if (!node || !node.isLatent || node.isText) return true;
    // 1. Direct structural edge connection to another latent variable
    const hasEdge = edges.some(edge => {
      if (edge.sourceId === node.id) {
        const other = nodes.find(n => n.id === edge.targetId);
        return other && other.isLatent && !other.isText;
      }
      if (edge.targetId === node.id) {
        const other = nodes.find(n => n.id === edge.sourceId);
        return other && other.isLatent && !other.isText;
      }
      return false;
    });
    if (hasEdge) return true;

    // 2. Moderation effect connection: construct participates as moderator, predictor, or outcome
    return moderatingEffects.some(m => {
      const isParticipant = (
        m.moderator === node.id || m.moderator === node.label ||
        m.source === node.id || m.source === node.label ||
        m.target === node.id || m.target === node.label
      );
      if (!isParticipant) return false;
      // If this construct is the moderator, ensure the source and target constructs exist in the model
      if (m.moderator === node.id || m.moderator === node.label) {
        const srcExists = nodes.some(n => (n.id === m.source || n.label === m.source) && n.isLatent && !n.isText);
        const tgtExists = nodes.some(n => (n.id === m.target || n.label === m.target) && n.isLatent && !n.isText);
        return srcExists && tgtExists;
      }
      return true;
    });
  }

  let lastLatentCreateTime = 0;

  function startInlineNodeRename(node) {
    if (!node) return;
    const existing = document.getElementById('canvas-direct-inline-rename');
    if (existing) existing.remove();

    // 1. Measure the exact screen bounding rect of the CURRENT rendered text element BEFORE hiding it!
    const nodeG = nodesLayer.querySelector(`g[data-id="${node.id}"]`);
    const textEl = nodeG ? nodeG.querySelector('text') : null;

    let screenCenterX = 0;
    let screenCenterY = 0;

    if (textEl && textEl.getBoundingClientRect().width > 0) {
      const rect = textEl.getBoundingClientRect();
      screenCenterX = rect.left + rect.width / 2;
      screenCenterY = rect.top + rect.height / 2;
    } else {
      const pt = svg.createSVGPoint();
      pt.x = node.x;
      if (node.isLatent) {
        const w = node.width || NODE_R * 2;
        const h = node.height || NODE_R * 2;
        if (node.textInside) {
          pt.y = node.y + 1;
        } else {
          const pos = node.textPosition || 'bottom';
          if (pos === 'top') {
            pt.y = node.y - h / 2 - 12;
          } else if (pos === 'left') {
            pt.x = node.x - w / 2 - 12;
            pt.y = node.y + 1;
          } else if (pos === 'right') {
            pt.x = node.x + w / 2 + 12;
            pt.y = node.y + 1;
          } else {
            pt.y = node.y + h / 2 + 19;
          }
        }
      } else if (node.isText) {
        pt.y = node.y;
      } else {
        const isIndInside = node.textInside !== undefined ? node.textInside : true;
        const w = node.width || 80;
        const h = node.height || 28;
        if (isIndInside) {
          pt.y = node.y;
        } else {
          const pos = node.textPosition || 'bottom';
          if (pos === 'top') {
            pt.y = node.y - h / 2 - 8;
          } else if (pos === 'left') {
            pt.x = node.x - w / 2 - 8;
            pt.y = node.y;
          } else if (pos === 'right') {
            pt.x = node.x + w / 2 + 8;
            pt.y = node.y;
          } else {
            pt.y = node.y + h / 2 + 14;
          }
        }
      }
      const screenPt = pt.matrixTransform(zoomLayer.getScreenCTM());
      screenCenterX = screenPt.x;
      screenCenterY = screenPt.y;
    }

    // Now mark node as renaming and re-render so the underlying SVG text is hidden
    node._isRenaming = true;
    render();

    const input = document.createElement('input');
    input.id = 'canvas-direct-inline-rename';
    input.className = 'inline-seamless-rename-input';
    input.type = 'text';
    input.value = node.label || '';
    input.style.position = 'fixed';
    input.style.left = `${screenCenterX}px`;
    input.style.top = `${screenCenterY}px`;
    input.style.transform = 'translate(-50%, -50%)';
    input.style.zIndex = '10000';
    input.style.background = 'transparent';
    input.style.border = 'none';
    input.style.outline = 'none';
    input.style.boxShadow = 'none';
    input.style.padding = '0';
    input.style.margin = '0';
    input.style.textAlign = node.isText ? (node.textAlign === 'left' ? 'left' : (node.textAlign === 'right' ? 'right' : (node.textAlign === 'justify' ? 'justify' : 'center'))) : 'center';
    input.style.lineHeight = '1';
    input.style.caretColor = 'var(--color-accent, #6B4EE6)';

    const baseFontSize = node.fontSize || (node.isLatent ? 14 : (node.isText ? 14 : 10));
    const scaledFontSize = Math.max(9, baseFontSize * transform.k);
    input.style.fontSize = `${scaledFontSize}px`;
    input.style.fontFamily = node.fontFamily || (node.isLatent ? 'var(--font-sans)' : (node.isText ? 'var(--font-sans)' : 'var(--font-mono)'));
    input.style.fontWeight = node.bold ? '700' : (node.isLatent ? '600' : '500');
    if (node.italic) input.style.fontStyle = 'italic';
    if (node.underline) input.style.textDecoration = 'underline';

    if (node.isLatent) {
      input.style.color = node.color || (node.textInside ? 'var(--canvas-latent-text)' : 'var(--color-text-primary)');
    } else if (node.isText) {
      input.style.color = node.color || 'var(--color-text-primary)';
    } else {
      const isIndInside = node.textInside !== undefined ? node.textInside : true;
      input.style.color = node.isMissingInDataset ? '#ef4444' : (node.color || (isIndInside ? 'var(--canvas-manifest-text)' : 'var(--color-text-primary)'));
    }

    const updateWidth = () => {
      const len = Math.max(2, (input.value || '').length);
      input.style.width = `${Math.max(40, len * (scaledFontSize * 0.75) + 20)}px`;
    };
    updateWidth();
    input.addEventListener('input', updateWidth);

    document.body.appendChild(input);
    input.focus();
    input.select();

    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());

    let finished = false;
    const finishEdit = () => {
      if (finished) return;
      finished = true;
      delete node._isRenaming;
      const newVal = input.value.trim();
      if (newVal) {
        if (newVal !== node.label) {
          node.label = newVal;
          if (!node.isLatent && !node.isText) {
            const charW = (node.fontSize ? Number(node.fontSize) * 0.72 : 7.2);
            const neededW = Math.max(64, Math.ceil(newVal.length * charW + 20));
            if (neededW > (node.width || 64)) {
              node.width = neededW;
            }
          } else if (node.isText) {
            const charW = (node.fontSize ? Number(node.fontSize) * 0.65 : 9);
            const neededW = Math.max(80, Math.ceil(newVal.length * charW + 24));
            if (!node.rectBox) node.rectBox = { width: 100, height: 40 };
            if (neededW > node.rectBox.width) {
              node.rectBox.width = neededW;
            }
          }
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        }
      } else {
        // If user didn't type a name or left it empty, preserve and fix the default name
        if (!node.label) {
          node.label = node.isLatent ? 'LV_1' : (node.isText ? 'Note' : 'Var');
        }
      }
      if (input.parentNode) input.remove();
      render();
    };

    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') {
        finishEdit();
      } else if (ke.key === 'Escape') {
        finished = true;
        delete node._isRenaming;
        if (input.parentNode) input.remove();
        render();
      }
    });
  }

  // Global capture listener to ensure inline rename commits before clicking elsewhere
  document.addEventListener('mousedown', (e) => {
    const active = document.getElementById('canvas-direct-inline-rename');
    if (active && e.target !== active) {
      active.blur();
    }
  }, true);

  function findNonIntersectingPosition(startX, startY, minDistance = 150) {
    if (!nodes || nodes.length === 0) {
      return { x: Math.round(startX), y: Math.round(startY) };
    }

    const collides = (px, py) => {
      for (const n of nodes) {
        if (typeof n.x !== 'number' || typeof n.y !== 'number') continue;
        const dist = Math.hypot(px - n.x, py - n.y);
        const threshold = n.isLatent ? minDistance : 110;
        if (dist < threshold) {
          return true;
        }
      }
      return false;
    };

    if (!collides(startX, startY)) {
      return { x: Math.round(startX), y: Math.round(startY) };
    }

    // Radial spiral search outward from startX, startY
    const stepAngle = Math.PI / 8; // 16 directions
    for (let r = 110; r <= 1600; r += 50) {
      for (let angle = 0; angle < 2 * Math.PI; angle += stepAngle) {
        const candX = startX + r * Math.cos(angle);
        const candY = startY + r * Math.sin(angle);
        if (candX > 90 && candY > 90 && !collides(candX, candY)) {
          return { x: Math.round(candX), y: Math.round(candY) };
        }
      }
    }

    return { x: Math.round(startX + 180), y: Math.round(startY + 180) };
  }

  function createAndEditNewLatentNode(x, y) {
    const now = Date.now();
    if (now - lastLatentCreateTime < 400) return;
    lastLatentCreateTime = now;

    setMode('select');
    const selectBtn = document.querySelector('.tb-btn[title*="Select"]');
    if (selectBtn) updateToolbarUI(selectBtn);

    let targetX = x;
    let targetY = y;
    if (typeof targetX !== 'number' || isNaN(targetX) || typeof targetY !== 'number' || isNaN(targetY)) {
      const center = getSvgCenter();
      targetX = center.x;
      targetY = center.y;
    }

    const pos = findNonIntersectingPosition(targetX, targetY, 150);

    const latentCount = nodes.filter(n => n.isLatent && !n.isText).length;
    const newName = `LV_${latentCount + 1}`;
    const newNode = {
      id: generateId(),
      label: newName,
      x: pos.x,
      y: pos.y,
      isLatent: true,
      type: 'reflective'
    };

    nodes.push(newNode);
    if (emptyHint) emptyHint.style.display = 'none';
    selectedIds.clear();
    selectedIds.add(newNode.id);
    render();
    pushHistory();
    window.dispatchEvent(new CustomEvent('canvas-changed'));

    setTimeout(() => {
      startInlineNodeRename(newNode);
    }, 60);

    return newNode;
  }
  window.createAndEditNewLatentNode = createAndEditNewLatentNode;

  function createAndEditNewTextNode(x, y) {
    setMode('select');
    const selectBtn = document.querySelector('.tb-btn[title*="Select"]');
    if (selectBtn) updateToolbarUI(selectBtn);

    let targetX = x;
    let targetY = y;
    if (typeof targetX !== 'number' || isNaN(targetX) || typeof targetY !== 'number' || isNaN(targetY)) {
      const center = getSvgCenter();
      targetX = center.x;
      targetY = center.y;
    }

    const pos = findNonIntersectingPosition(targetX, targetY, 120);
    const textCount = nodes.filter(n => n.isText).length;
    const defaultLabel = textCount === 0 ? 'Text Note' : `Text Note ${textCount + 1}`;

    const newNode = {
      id: generateId(),
      label: defaultLabel,
      x: pos.x,
      y: pos.y,
      isLatent: null,
      isText: true,
      bold: false,
      italic: false,
      fontSize: 14,
      fill: 'transparent',
      stroke: 'transparent',
      color: 'var(--color-text-primary)'
    };

    nodes.push(newNode);
    if (emptyHint) emptyHint.style.display = 'none';
    selectedIds.clear();
    selectedIds.add(newNode.id);
    render();
    pushHistory();
    window.dispatchEvent(new CustomEvent('canvas-changed'));

    setTimeout(() => {
      startInlineNodeRename(newNode);
    }, 60);

    return newNode;
  }
  window.createAndEditNewTextNode = createAndEditNewTextNode;

  function hasInvalidLatentVariables() {
    const latentNodes = nodes.filter(n => n.isLatent !== false && !n.isText);
    if (latentNodes.length === 0) return false;
    return latentNodes.some(ln => {
      // Disconnected from other latent variables in model
      if (!isLatentConnectedInModel(ln)) return true;
      // Missing indicators
      const childInds = nodes.filter(ind => ind.parentId === ln.id && !ind.isLatent && !ind.isText);
      if (childInds.length === 0) return true;
      return false;
    });
  }
  window.hasInvalidLatentVariables = hasInvalidLatentVariables;

  function duplicateNode(node) {
    if (!node) return;
    const copy = JSON.parse(JSON.stringify(node));
    copy.id = generateId();
    copy.x = (node.x || 0) + 40;
    copy.y = (node.y || 0) + 40;
    // Only append _copy for latent variables, NEVER for dataset indicators!
    if (copy.isLatent && !copy.isText && copy.label) {
      copy.label = `${copy.label}_copy`;
    }
    if (copy.edgeWaypoints) copy.edgeWaypoints = [];
    nodes.push(copy);
    selectedIds.clear();
    selectedIds.add(copy.id);
    render();
    pushHistory();
    window.dispatchEvent(new CustomEvent('canvas-changed'));
  }

  function selectCanvasNodesByVarNames(varNames) {
    if (!varNames || !Array.isArray(varNames) || varNames.length === 0) {
      selectedIds.clear();
      render();
      return;
    }
    const set = new Set(varNames.map(v => String(v).trim().toLowerCase()));
    selectedIds.clear();
    nodes.forEach(n => {
      const label = String(n.label || '').trim().toLowerCase();
      if (set.has(label)) {
        selectedIds.add(n.id);
      }
    });
    render();
  }
  window.selectCanvasNodesByVarNames = selectCanvasNodesByVarNames;

  // --- Toolbar Modes ---
  const toolBtns = document.querySelectorAll('.canvas-toolbar .tb-btn');
  toolBtns.forEach(btn => {
    if (btn.dataset.canvasListenerBound === 'true') return;
    btn.dataset.canvasListenerBound = 'true';
    btn.addEventListener('click', function() {
      const title = this.getAttribute('title') || '';
      if (title.includes('Select') || this.id === 'btn-select') {
        setMode('select');
        updateToolbarUI(this);
      } else if (title.includes('Connect') || title.includes('Path Connector') || this.id === 'btn-connect') {
        setMode('connect');
        updateToolbarUI(this);
      } else if (title.includes('Erase') || this.id === 'btn-erase') {
        setMode('erase');
        updateToolbarUI(this);
      } else if (title.includes('Moderation Effect')) {
        setMode('connect');
        const connectBtn = document.getElementById('btn-connect') || document.querySelector('.canvas-toolbar .tb-btn[title*="Connect"], .canvas-toolbar .tb-btn[title*="Path Connector"]');
        updateToolbarUI(connectBtn || this);
        try {
          window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Connect mode active: Drag from a construct to the middle of a path to add moderation.' } }));
        } catch (err) {}
      } else if (title.includes('Gaussian') || this.id === 'btn-copula') {
        if (mode === 'copula') {
          setMode('select');
          updateToolbarUI(document.querySelector('.canvas-toolbar .tb-btn[title*="Select"]'));
        } else {
          setMode('copula');
          updateToolbarUI(this);
          try {
            window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Gaussian copula mode: Click on any structural path to toggle a copula term.' } }));
          } catch (err) {}
        }
      } else if (title.includes('Quadratic') || this.id === 'btn-quadratic') {
        if (mode === 'quadratic') {
          setMode('select');
          updateToolbarUI(document.querySelector('.canvas-toolbar .tb-btn[title*="Select"]'));
        } else {
          setMode('quadratic');
          updateToolbarUI(this);
          try {
            window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Quadratic effect mode: Click on any structural path to toggle a quadratic effect.' } }));
          } catch (err) {}
        }
      } else if (title.includes('Latent variable') || this.id === 'btn-add-latent') {
        createAndEditNewLatentNode();
      } else if (title.includes('Text Note') || this.getAttribute('data-action') === 'add-text-note' || this.id === 'btn-add-text-note') {
        createAndEditNewTextNode();
      } else if (title.includes('Add Comment')) {
        createAndEditNewTextNode();
      }
    });
  });

  // Auto-Align Model
  document.querySelector('.tb-btn[title="Auto-Align Model"]')?.addEventListener('click', () => {
    if (nodes.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const result = performAutoLayout(nodes, edges, {
      containerWidth: rect.width || 1200,
      containerHeight: rect.height || 800,
    });

    // Update nodes in-place to preserve references
    result.nodes.forEach(rn => {
      const existing = nodes.find(n => n.id === rn.id);
      if (existing) {
        existing.x = rn.x;
        existing.y = rn.y;
      }
    });

    result.edges.forEach(re => {
      const existing = edges.find(e => e.id === re.id || (e.sourceId === re.sourceId && e.targetId === re.targetId));
      if (existing) {
        delete existing.waypoints;
      }
    });

    selectedIds.clear();

    // Synchronously compute fit & center transform to eliminate model jump/glitch
    if (nodes.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(n => {
        const halfW = (n.width || (n.isLatent !== false ? 64 : 64)) / 2 + 24;
        const halfH = (n.height || (n.isLatent !== false ? 64 : 24)) / 2 + 24;
        minX = Math.min(minX, n.x - halfW);
        minY = Math.min(minY, n.y - halfH);
        maxX = Math.max(maxX, n.x + halfW);
        maxY = Math.max(maxY, n.y + halfH);
      });
      const rect = svg.getBoundingClientRect();
      const modelWidth = Math.max(maxX - minX, 100);
      const modelHeight = Math.max(maxY - minY, 100);
      const padding = 60;
      const availW = Math.max(rect.width - padding * 2, 100);
      const availH = Math.max(rect.height - padding * 2, 100);
      const scale = Math.min(availW / modelWidth, availH / modelHeight, 1.2);
      const k = Math.max(Math.min(scale, 1.2), 0.2);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      transform = {
        x: (rect.width / 2) - (cx * k),
        y: (rect.height / 2) - (cy * k),
        k: k
      };
      applyTransform();
    }

    render();
    pushHistory();
  });

  // Colors and Font Size (Using Global Event Delegation)
  document.addEventListener('color-picker-input', (e) => {
    const { id, color } = e.detail;
    if (id === 'picker-fill') {
      nodes.filter(n => selectedIds.has(n.id)).forEach(n => n.fill = color);
      render();
    } else if (id === 'picker-border') {
      nodes.filter(n => selectedIds.has(n.id)).forEach(n => n.stroke = color);
      render();
    } else if (id === 'picker-text') {
      nodes.filter(n => selectedIds.has(n.id)).forEach(n => n.color = color);
      render();
    }
  }, { signal });

  document.addEventListener('color-picker-closed', (e) => {
    const { id } = e.detail;
    if (id === 'picker-fill' || id === 'picker-border' || id === 'picker-text') {
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
    }
  }, { signal });

  document.addEventListener('border-weight-change', (e) => {
    const weight = e.detail?.weight;
    if (weight !== undefined) {
      nodes.filter(n => selectedIds.has(n.id)).forEach(n => {
        n.strokeWidth = weight;
      });
      render();
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
    }
  }, { signal });

  document.addEventListener('textbox-align-change', (e) => {
    const align = e.detail?.align;
    if (align) {
      nodes.filter(n => selectedIds.has(n.id) && n.isText).forEach(n => {
        n.textAlign = align;
      });
      render();
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
    }
  }, { signal });

  document.addEventListener('textbox-valign-change', (e) => {
    const valign = e.detail?.valign;
    if (valign) {
      nodes.filter(n => selectedIds.has(n.id) && n.isText).forEach(n => {
        n.verticalAlign = valign;
      });
      render();
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
    }
  }, { signal });

  // Alignment, Style, and Text Format Dropdown Actions
  document.addEventListener('click', (e) => {
    // Handle item clicks globally
    const item = e.target.closest('.tb-dropdown-item, .tb-font-btn, [data-edge-action]');
    if (item) {
      const action = item.getAttribute('data-action') || item.getAttribute('data-edge-action');
      if (action) {
        if (action === 'align-top') alignIndicators('top');
        else if (action === 'align-bottom') alignIndicators('bottom');
        else if (action === 'align-left') alignIndicators('left');
        else if (action === 'align-right') alignIndicators('right');
        
        else if (action === 'shape-circle') {
          nodes.filter(n => selectedIds.has(n.id) && !n.isText).forEach(n => n.shape = 'circle');
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
          document.dispatchEvent(new CustomEvent('selectionChange'));
          window.dispatchEvent(new CustomEvent('selectionChange'));
        } else if (action === 'shape-rect') {
          nodes.filter(n => selectedIds.has(n.id) && !n.isText).forEach(n => n.shape = 'rect');
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
          document.dispatchEvent(new CustomEvent('selectionChange'));
          window.dispatchEvent(new CustomEvent('selectionChange'));
        } else if (action === 'shape-rounded') {
          nodes.filter(n => selectedIds.has(n.id) && !n.isText).forEach(n => n.shape = 'rounded');
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
          document.dispatchEvent(new CustomEvent('selectionChange'));
          window.dispatchEvent(new CustomEvent('selectionChange'));
        } else if (action === 'shape-hex') {
          nodes.filter(n => selectedIds.has(n.id) && !n.isText).forEach(n => n.shape = 'hexagon');
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
          document.dispatchEvent(new CustomEvent('selectionChange'));
          window.dispatchEvent(new CustomEvent('selectionChange'));
        } else if (action === 'shape-oct') {
          nodes.filter(n => selectedIds.has(n.id) && !n.isText).forEach(n => n.shape = 'octagon');
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
          document.dispatchEvent(new CustomEvent('selectionChange'));
          window.dispatchEvent(new CustomEvent('selectionChange'));
        }
        
        else if (action === 'text-bold') {
          nodes.filter(n => selectedIds.has(n.id)).forEach(n => n.bold = !n.bold);
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        } else if (action === 'text-italic') {
          nodes.filter(n => selectedIds.has(n.id)).forEach(n => n.italic = !n.italic);
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        } else if (action === 'text-underline') {
          nodes.filter(n => selectedIds.has(n.id)).forEach(n => n.underline = !n.underline);
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        } else if (action === 'font-inc') {
          nodes.filter(n => selectedIds.has(n.id)).forEach(n => n.fontSize = (n.fontSize || 14) + 2);
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        } else if (action === 'font-dec') {
          nodes.filter(n => selectedIds.has(n.id)).forEach(n => n.fontSize = Math.max(6, (n.fontSize || 14) - 2));
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        } else if (action === 'text-increase') {
          nodes.filter(n => selectedIds.has(n.id)).forEach(n => n.fontSize = (n.fontSize || 14) + 2);
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        } else if (action === 'text-decrease') {
          nodes.filter(n => selectedIds.has(n.id)).forEach(n => n.fontSize = Math.max(6, (n.fontSize || 14) - 2));
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        } else if (action === 'text-inside') {
          nodes.filter(n => selectedIds.has(n.id) && !n.isText).forEach(n => {
            if (n.isLatent) {
              const metrics = getConstructMetrics(n);
              const hasR2 = !!(metrics && metrics.r2 !== null && metrics.r2 !== undefined);
              if (hasR2 && !n.textInside) {
                // Disallow moving inside when R² is displayed inside construct
                return;
              }
              n.textInside = !n.textInside;
            } else {
              // Indicator: default is inside (true)
              const currentInside = n.textInside !== undefined ? n.textInside : true;
              n.textInside = !currentInside;
            }
          });
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        } else if (action.startsWith('text-pos-')) {
          const pos = action.replace('text-pos-', '');
          nodes.filter(n => selectedIds.has(n.id) && !n.isText).forEach(n => {
            n.textInside = false;
            n.textPosition = pos;
          });
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        }
        
        // Edge styling (structural, moderation, and indicator edges)
        else if (action.startsWith('arrowhead-')) {
          const arrowType = action.replace('arrowhead-', '');
          edges.filter(edge => selectedIds.has(edge.id)).forEach(edge => edge.arrowhead = arrowType);
          moderatingEffects.filter(m => selectedIds.has(m.id)).forEach(m => m.arrowhead = arrowType);
          nodes.filter(n => selectedIds.has(`edge_ind_${n.id}`)).forEach(n => n.edgeArrowhead = arrowType);
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        } else if (action.startsWith('line-')) {
          const style = action.replace('line-', '');
          edges.filter(edge => selectedIds.has(edge.id)).forEach(edge => {
            edge.curved = false; // Reset curve by default
            if (style === 'solid') edge.strokeDasharray = '';
            if (style === 'dashed') edge.strokeDasharray = '8 8';
            if (style === 'dotted') edge.strokeDasharray = '2 4';
            if (style === 'curved') {
              edge.strokeDasharray = '';
              edge.curved = true;
              edge.waypoints = [];
            }
          });
          moderatingEffects.filter(m => selectedIds.has(m.id)).forEach(m => {
            m.curved = false;
            if (style === 'solid') m.strokeDasharray = '';
            if (style === 'dashed') m.strokeDasharray = '8 8';
            if (style === 'dotted') m.strokeDasharray = '2 4';
            if (style === 'curved') {
              m.strokeDasharray = '';
              m.curved = true;
              m.waypoints = [];
            }
          });
          nodes.filter(n => selectedIds.has(`edge_ind_${n.id}`)).forEach(n => {
            n.edgeCurved = false;
            if (style === 'solid') n.edgeStrokeDasharray = '';
            if (style === 'dashed') n.edgeStrokeDasharray = '8 8';
            if (style === 'dotted') n.edgeStrokeDasharray = '2 4';
            if (style === 'curved') {
              n.edgeStrokeDasharray = '';
              n.edgeCurved = true;
            }
          });
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        } else if (action.startsWith('weight-')) {
          const w = parseFloat(action.replace('weight-', ''));
          edges.filter(edge => selectedIds.has(edge.id)).forEach(edge => edge.strokeWidth = w);
          moderatingEffects.filter(m => selectedIds.has(m.id)).forEach(m => m.strokeWidth = w);
          nodes.filter(n => selectedIds.has(`edge_ind_${n.id}`)).forEach(n => n.edgeStrokeWidth = w);
          render();
          pushHistory();
          window.dispatchEvent(new CustomEvent('canvas-changed'));
        }
      }
      // Update UI after any formatting action
      document.dispatchEvent(new CustomEvent('selectionChange'));
    }
  }, { signal });

  document.addEventListener('edge-color-change', (e) => {
    const color = e.detail?.color;
    if (color !== undefined) {
      edges.filter(edge => selectedIds.has(edge.id)).forEach(edge => edge.color = color);
      moderatingEffects.filter(m => selectedIds.has(m.id)).forEach(m => m.color = color);
      nodes.filter(n => selectedIds.has(`edge_ind_${n.id}`)).forEach(n => n.edgeColor = color);
      render();
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
      document.dispatchEvent(new CustomEvent('selectionChange'));
      window.dispatchEvent(new CustomEvent('selectionChange'));
    }
  }, { signal });

  document.addEventListener('edge-line-style-change', (e) => {
    const style = e.detail?.style;
    if (style) {
      edges.filter(edge => selectedIds.has(edge.id)).forEach(edge => {
        edge.curved = false;
        if (style === 'solid') edge.strokeDasharray = '';
        if (style === 'dashed') edge.strokeDasharray = '8 8';
        if (style === 'dotted') edge.strokeDasharray = '2 4';
        if (style === 'curved') {
          edge.strokeDasharray = '';
          edge.curved = true;
          edge.waypoints = [];
        }
      });
      moderatingEffects.filter(m => selectedIds.has(m.id)).forEach(m => {
        m.curved = false;
        if (style === 'solid') m.strokeDasharray = '';
        if (style === 'dashed') m.strokeDasharray = '8 8';
        if (style === 'dotted') m.strokeDasharray = '2 4';
        if (style === 'curved') {
          m.strokeDasharray = '';
          m.curved = true;
          m.waypoints = [];
        }
      });
      nodes.filter(n => selectedIds.has(`edge_ind_${n.id}`)).forEach(n => {
        n.edgeCurved = false;
        if (style === 'solid') n.edgeStrokeDasharray = '';
        if (style === 'dashed') n.edgeStrokeDasharray = '8 8';
        if (style === 'dotted') n.edgeStrokeDasharray = '2 4';
        if (style === 'curved') {
          n.edgeStrokeDasharray = '';
          n.edgeCurved = true;
        }
      });
      render();
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
      document.dispatchEvent(new CustomEvent('selectionChange'));
      window.dispatchEvent(new CustomEvent('selectionChange'));
    }
  }, { signal });

  document.addEventListener('edge-arrowhead-change', (e) => {
    const arrowType = e.detail?.arrowhead;
    if (arrowType) {
      edges.filter(edge => selectedIds.has(edge.id)).forEach(edge => edge.arrowhead = arrowType);
      moderatingEffects.filter(m => selectedIds.has(m.id)).forEach(m => m.arrowhead = arrowType);
      nodes.filter(n => selectedIds.has(`edge_ind_${n.id}`)).forEach(n => n.edgeArrowhead = arrowType);
      render();
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
      document.dispatchEvent(new CustomEvent('selectionChange'));
      window.dispatchEvent(new CustomEvent('selectionChange'));
    }
  }, { signal });

  document.addEventListener('edge-stroke-width-change', (e) => {
    const w = e.detail?.width;
    if (w !== undefined) {
      const numW = parseFloat(w) || 1.5;
      edges.filter(edge => selectedIds.has(edge.id)).forEach(edge => edge.strokeWidth = numW);
      moderatingEffects.filter(m => selectedIds.has(m.id)).forEach(m => m.strokeWidth = numW);
      nodes.filter(n => selectedIds.has(`edge_ind_${n.id}`)).forEach(n => n.edgeStrokeWidth = numW);
      render();
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
      document.dispatchEvent(new CustomEvent('selectionChange'));
      window.dispatchEvent(new CustomEvent('selectionChange'));
    }
  }, { signal });

  document.addEventListener('node-shape-change', (e) => {
    const shape = e.detail?.shape;
    if (shape) {
      nodes.filter(n => selectedIds.has(n.id) && !n.isText).forEach(n => n.shape = shape);
      render();
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
      document.dispatchEvent(new CustomEvent('selectionChange'));
      window.dispatchEvent(new CustomEvent('selectionChange'));
    }
  }, { signal });

  // Global change listener for inputs that might be re-rendered
  document.addEventListener('change', (e) => {
    if (e.target.id === 'input-font-size') {
      let size = parseInt(e.target.value);
      if (!isNaN(size) && size > 0) {
        nodes.filter(n => selectedIds.has(n.id)).forEach(n => n.fontSize = size);
        render();
        pushHistory();
        window.dispatchEvent(new CustomEvent('canvas-changed'));
      }
    } else if (e.target.id === 'input-font-family') {
      const family = e.target.value;
      nodes.filter(n => selectedIds.has(n.id)).forEach(n => n.fontFamily = family);
      render();
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
    }
  }, { signal });

  function alignIndicators(direction, targetParentId = null) {
    if (selectedIds.size > 1 && !targetParentId) {
      // Multi-node alignment (aligns all selected nodes together)
      const selNodes = nodes.filter(n => selectedIds.has(n.id));
      if (selNodes.length > 1) {
        if (direction === 'top') {
          const minY = Math.min(...selNodes.map(n => n.y));
          selNodes.forEach(n => n.y = minY);
        } else if (direction === 'bottom') {
          const maxY = Math.max(...selNodes.map(n => n.y));
          selNodes.forEach(n => n.y = maxY);
        } else if (direction === 'left') {
          const minX = Math.min(...selNodes.map(n => n.x));
          selNodes.forEach(n => n.x = minX);
        } else if (direction === 'right') {
          const maxX = Math.max(...selNodes.map(n => n.x));
          selNodes.forEach(n => n.x = maxX);
        }
        render();
        pushHistory();
        window.dispatchEvent(new CustomEvent('canvas-changed'));
        return;
      }
    }

    let parentId = targetParentId || (selectedIds.size === 1 ? Array.from(selectedIds)[0] : null);
    if (!parentId) return;
    let parent = nodes.find(n => n.id === parentId);
    if (!parent) return;
    if (!parent.isLatent && parent.parentId) {
      parentId = parent.parentId;
      parent = nodes.find(n => n.id === parentId);
    }
    if (!parent || !parent.isLatent) return;
    
    const indicators = nodes.filter(n => n.parentId === parentId && !n.isLatent);
    if (indicators.length === 0) return;
    
    const indWidth = 64;
    const indHeight = 24;
    const gap = 16;
    
    let spacing;
    if (direction === 'left' || direction === 'right') {
      spacing = indHeight + gap;
    } else {
      spacing = indWidth + gap;
    }
    
    const offset = (direction === 'top' || direction === 'bottom') ? 140 : 155;
    
    const totalLength = (indicators.length - 1) * spacing;
    const start = -totalLength / 2;
    
    indicators.forEach((ind, idx) => {
      delete ind.edgeWaypoints;
      if (direction === 'right') {
        ind.x = parent.x + offset;
        ind.y = parent.y + start + (idx * spacing);
      } else if (direction === 'left') {
        ind.x = parent.x - offset;
        ind.y = parent.y + start + (idx * spacing);
      } else if (direction === 'top') {
        ind.x = parent.x + start + (idx * spacing);
        ind.y = parent.y - offset;
      } else if (direction === 'bottom') {
        ind.x = parent.x + start + (idx * spacing);
        ind.y = parent.y + offset;
      }
    });
    
    render();
    pushHistory();
  }

  function updateToolbarUI(activeBtn) {
    if (!activeBtn) return;
    toolBtns.forEach(b => b.classList.remove('active'));
    activeBtn.classList.add('active');
  }

  function setMode(newMode) {
    mode = newMode;
    if (mode !== 'connect') {
      if (typeof cancelTempConnecting === 'function') cancelTempConnecting();
    }
    if (mode !== 'moderation') {
      pendingModeratorNode = null;
    }
    if (mode === 'connect' || mode === 'moderation' || mode === 'copula' || mode === 'quadratic') {
      svg.style.cursor = 'crosshair';
    } else if (mode === 'erase') {
      svg.style.cursor = 'crosshair';
    } else {
      svg.style.cursor = 'default';
    }
    render();
  }

  function getSvgCenter() {
    const rect = svg.getBoundingClientRect();
    const pt = svg.createSVGPoint();
    pt.x = rect.width / 2;
    pt.y = rect.height / 2;
    return pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
  }

  // --- Drag & Drop Variables ---
  window.bindVariableDragEvents = () => {
    const varItems = document.querySelectorAll('.var-item');
    varItems.forEach(item => {
      item.setAttribute('draggable', 'true');
    });
  };
  window.bindVariableDragEvents();

  function cleanIndicatorStem(name) {
    if (!name) return '';
    const cleaned = name.replace(/[_\-\s.]*\d+$/i, '').trim();
    return cleaned || name;
  }

  function deriveConstructName(indicatorNames) {
    if (!indicatorNames || indicatorNames.length === 0) return '';
    // A single-item construct should retain the indicator's meaningful suffix.
    // `switch_1` and `switch_2` represent different constructs, not two
    // indicators of an unnamed `SWITCH` construct.
    if (indicatorNames.length === 1) return indicatorNames[0].toUpperCase();
    const stems = indicatorNames.map(cleanIndicatorStem).filter(Boolean);
    if (stems.length === 0) return '';
    
    const first = stems[0].toUpperCase();
    const allMatch = stems.every(s => s.toUpperCase() === first);
    if (allMatch) return first;
    
    // Find longest common prefix
    let prefix = stems[0];
    for (let i = 1; i < stems.length; i++) {
      while (!stems[i].toUpperCase().startsWith(prefix.toUpperCase()) && prefix.length > 0) {
        prefix = prefix.slice(0, -1);
      }
    }
    prefix = prefix.replace(/[_\-\s.]+$/, '').trim();
    if (prefix.length >= 2) return prefix.toUpperCase();
    return first;
  }

  function isDefaultOrDerivedName(label) {
    if (!label) return true;
    const l = label.trim().toUpperCase();
    return l.startsWith('LATENT') || l.startsWith('NEW_CONSTRUCT') || l.startsWith('CONSTRUCT') || l.startsWith('NODE_') || l.startsWith('LV_');
  }

  window.dropModelVariable = (payload, clientX, clientY) => {
    if (!payload) return;
    
    // Normalize payload to a list of variable names and an optional construct title
    let varList = [];
    let customTitle = '';

    if (Array.isArray(payload)) {
      varList = payload.filter(Boolean).map(String);
    } else if (typeof payload === 'object' && payload !== null) {
      if (Array.isArray(payload.vars)) {
        varList = payload.vars.filter(Boolean).map(String);
      }
      if (payload.name) {
        customTitle = String(payload.name).trim();
      }
    } else if (typeof payload === 'string') {
      const trimmed = payload.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            varList = parsed.filter(Boolean).map(String);
          } else if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.vars)) varList = parsed.vars.filter(Boolean).map(String);
            if (parsed.name) customTitle = String(parsed.name).trim();
          }
        } catch (e) {
          varList = [trimmed];
        }
      } else if (trimmed.includes(',')) {
        varList = trimmed.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        varList = [trimmed];
      }
    }

    if (varList.length === 0) return;

    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
    
    // Check if dropped on an existing latent node
    const targetNode = nodes.find(n => {
      if (n.isLatent === false || n.isText) return false;
      const dx = n.x - svgPt.x;
      const dy = n.y - svgPt.y;
      return Math.sqrt(dx*dx + dy*dy) <= NODE_R;
    });

    if (targetNode) {
      const existingIndicators = nodes.filter(n => !n.isLatent && n.parentId === targetNode.id);
      let addedAny = false;
      varList.forEach((name) => {
        if (!existingIndicators.some(n => n.label === name) && !nodes.some(n => n.parentId === targetNode.id && n.label === name)) {
          const countNow = nodes.filter(n => !n.isLatent && n.parentId === targetNode.id).length;
          nodes.push({
            id: generateId(),
            label: name,
            isLatent: false,
            parentId: targetNode.id,
            x: targetNode.x + 155,
            y: targetNode.y + (countNow * 40)
          });
          addedAny = true;
        }
      });

      if (addedAny) {
        // Automatically refine construct name if default or derived
        const allCurrentInds = nodes.filter(n => !n.isLatent && n.parentId === targetNode.id).map(i => i.label);
        const derived = deriveConstructName(allCurrentInds);
        if (derived && isDefaultOrDerivedName(targetNode.label)) {
          targetNode.label = derived;
        }
        emptyHint.style.display = 'none';
        render();
        pushHistory();
      }
    } else {
      // Dropping onto empty space: create latent node and attach all variables as its indicators
      const stem = customTitle || deriveConstructName(varList) || (varList[0] ? varList[0].toUpperCase().replace(/[_\-\s.]*[0-9]+$/, '') : 'NEW_CONSTRUCT');
      const newLatent = addNode(stem, svgPt.x, svgPt.y);

      const indHeight = 24;
      const gap = 16;
      const spacing = indHeight + gap;
      const totalLength = (varList.length - 1) * spacing;
      const start = -totalLength / 2;

      varList.forEach((name, idx) => {
        nodes.push({
          id: generateId(),
          label: name,
          isLatent: false,
          parentId: newLatent.id,
          x: newLatent.x + 155,
          y: newLatent.y + start + (idx * spacing)
        });
      });

      emptyHint.style.display = 'none';
      render();
      pushHistory();
    }
  };

  // --- Nodes & Rendering ---
  function addNode(label, x, y) {
    // Avoid exact duplicate names by appending increment
    let finalLabel = label;
    let count = 1;
    while(nodes.some(n => n.label === finalLabel)) {
      finalLabel = label + '_' + count;
      count++;
    }

    const node = { id: generateId(), label: finalLabel, x, y, isLatent: true, type: 'reflective' };
    nodes.push(node);
    emptyHint.style.display = 'none';
    render();
    return node;
  }

  function createNodeShape(node, defaultW, defaultH, defaultFill, defaultStroke, isSelected) {
    let w = node.width || defaultW;
    let h = node.height || defaultH;
    let shape = node.shape || (node.isLatent ? 'circle' : 'rect');
    let fill = node.fill;
    let stroke = node.stroke;
    if (node.isLatent) {
      if (!fill || fill === '#334155' || fill === '#1e293b' || fill === '#1e1b4b' || fill === '#e2e8f0' || (typeof fill === 'string' && fill.includes('var(--canvas-latent-fill)'))) {
        fill = defaultFill;
      }
      if (!stroke || stroke === '#1e293b' || stroke === '#475569' || stroke === '#94a3b8' || stroke === 'none' || (typeof stroke === 'string' && stroke.includes('var(--canvas-latent-stroke)'))) {
        stroke = defaultStroke;
      }
    } else if (node.isLatent === false && !node.isText) {
      if (!node.fill || node.fill === '#fef08a' || node.fill === '#451a03' || (typeof node.fill === 'string' && node.fill.includes('var(--canvas-manifest-fill)'))) {
        fill = defaultFill;
      }
      if (!node.stroke || node.stroke === '#ca8a04' || node.stroke === '#b45309' || (typeof node.stroke === 'string' && node.stroke.includes('var(--canvas-manifest-stroke)'))) {
        stroke = defaultStroke;
      }
    } else {
      fill = node.fill || defaultFill;
      stroke = node.stroke || defaultStroke;
    }
    let strokeW = node.strokeWidth !== undefined ? String(node.strokeWidth) : (node.isText ? '0' : '1.5');
    let sw = parseFloat(strokeW) || 0;
    // To ensure the border expands strictly inwards (so it never overlaps arrowheads or outer boundary):
    let insetW = Math.max(0, sw / 2);
    let el;
    
    if (shape === 'rect') {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      el.setAttribute('x', -w/2 + insetW);
      el.setAttribute('y', -h/2 + insetW);
      el.setAttribute('width', Math.max(0, w - sw));
      el.setAttribute('height', Math.max(0, h - sw));
      el.setAttribute('rx', '0');
    } else if (shape === 'rounded') {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      el.setAttribute('x', -w/2 + insetW);
      el.setAttribute('y', -h/2 + insetW);
      el.setAttribute('width', Math.max(0, w - sw));
      el.setAttribute('height', Math.max(0, h - sw));
      el.setAttribute('rx', node.isLatent ? '12' : '6');
    } else if (shape === 'hexagon') {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      const scaleX = w > sw ? (w - sw) / w : 0;
      const scaleY = h > sw ? (h - sw) / h : 0;
      const points = [
        [0, (-h/2) * scaleY], [(w/2) * scaleX, (-h/4) * scaleY], [(w/2) * scaleX, (h/4) * scaleY],
        [0, (h/2) * scaleY], [(-w/2) * scaleX, (h/4) * scaleY], [(-w/2) * scaleX, (-h/4) * scaleY]
      ].map(p => p.join(',')).join(' ');
      el.setAttribute('points', points);
    } else if (shape === 'octagon') {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      const scaleX = w > sw ? (w - sw) / w : 0;
      const scaleY = h > sw ? (h - sw) / h : 0;
      const aW = (w/2 * 0.414) * scaleX;
      const aH = (h/2 * 0.414) * scaleY;
      const points = [
        [-aW, (-h/2) * scaleY], [aW, (-h/2) * scaleY], [(w/2) * scaleX, -aH], [(w/2) * scaleX, aH],
        [aW, (h/2) * scaleY], [-aW, (h/2) * scaleY], [(-w/2) * scaleX, aH], [(-w/2) * scaleX, -aH]
      ].map(p => p.join(',')).join(' ');
      el.setAttribute('points', points);
    } else { // circle or ellipse
      el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      el.setAttribute('rx', Math.max(0, w/2 - insetW));
      el.setAttribute('ry', Math.max(0, h/2 - insetW));
    }
    
    el.setAttribute('fill', fill);
    el.style.fill = fill;
    const isDisconnectedLatent = node.isLatent && !node.isText && !isLatentConnectedInModel(node);
    if (isDisconnectedLatent) {
      el.setAttribute('stroke', '#ef4444');
      el.style.stroke = '#ef4444';
      el.setAttribute('stroke-width', '2.5');
      if (!isSelected) {
        el.setAttribute('stroke-dasharray', '4 2');
      }
    } else {
      el.setAttribute('stroke', isSelected ? 'var(--color-accent)' : stroke);
      el.style.stroke = isSelected ? 'var(--color-accent)' : stroke;
      el.setAttribute('stroke-width', strokeW);
      el.style.strokeWidth = strokeW;
    }
    return el;
  }

  // ── Calculation Results State & Helpers ──────────────────────────
  let activeResults = (typeof window !== 'undefined' && window._canvasActiveResults) || null;

  function setCanvasResults(results) {
    activeResults = results;
    if (typeof window !== 'undefined') {
      window._canvasActiveResults = results;
    }
    render();
  }

  function findConstructKey(node) {
    if (!activeResults || !node) return null;
    const struct = activeResults.structural || {};
    const rel = activeResults.reliability_and_validity || {};
    const names = activeResults.construct_names || {};

    if (struct.r_squared?.[node.id] !== undefined || rel.composite_reliability?.[node.id] !== undefined) {
      return node.id;
    }
    if (node.label) {
      if (struct.r_squared?.[node.label] !== undefined || rel.composite_reliability?.[node.label] !== undefined) {
        return node.label;
      }
      const upper = node.label.toUpperCase();
      if (struct.r_squared?.[upper] !== undefined || rel.composite_reliability?.[upper] !== undefined) {
        return upper;
      }
    }
    for (const [cid, cname] of Object.entries(names)) {
      if (cid === node.id || (node.label && cname && cname.toUpperCase() === node.label.toUpperCase())) {
        return cid;
      }
    }
    return null;
  }

  function getConstructMetrics(node) {
    if (!activeResults || !node) return null;
    const key = findConstructKey(node);
    if (!key) return null;

    const struct = activeResults.structural || {};
    const rel = activeResults.reliability_and_validity || {};
    const names = activeResults.construct_names || {};

    const r2 = struct.r_squared?.[key];
    const r2Adj = struct.r_squared_adj?.[key];
    const cr = rel.composite_reliability?.[key];
    const ave = rel.ave?.[key];
    const alpha = rel.cronbachs_alpha?.[key];

    return {
      key,
      name: node.label || names[key] || key,
      r2: (r2 !== undefined && r2 !== null && !isNaN(Number(r2))) ? Number(r2) : null,
      r2Adj: (r2Adj !== undefined && r2Adj !== null && !isNaN(Number(r2Adj))) ? Number(r2Adj) : null,
      cr: (cr !== undefined && cr !== null && !isNaN(Number(cr))) ? Number(cr) : null,
      ave: (ave !== undefined && ave !== null && !isNaN(Number(ave))) ? Number(ave) : null,
      alpha: (alpha !== undefined && alpha !== null && !isNaN(Number(alpha))) ? Number(alpha) : null,
    };
  }

  function getPathCoefficient(sourceNode, targetNode) {
    if (!activeResults?.structural?.path_coefficients || !sourceNode || !targetNode) return null;
    const paths = activeResults.structural.path_coefficients;
    const sKey = findConstructKey(sourceNode);
    const tKey = findConstructKey(targetNode);

    if (tKey && sKey && paths[tKey]?.[sKey] !== undefined) {
      return Number(paths[tKey][sKey]);
    }
    const sCandidates = [sKey, sourceNode.id, sourceNode.label, sourceNode.label?.toUpperCase()].filter(Boolean);
    const tCandidates = [tKey, targetNode.id, targetNode.label, targetNode.label?.toUpperCase()].filter(Boolean);

    for (const t of tCandidates) {
      if (paths[t]) {
        for (const s of sCandidates) {
          if (paths[t][s] !== undefined) {
            return Number(paths[t][s]);
          }
        }
      }
    }
    return null;
  }

  function getModerationDetails(mod) {
    if (!activeResults || !mod) return null;
    const modNode = nodes.find(n => n.id === mod.moderator);
    const sNode = nodes.find(n => n.id === mod.source);
    const tNode = nodes.find(n => n.id === mod.target);
    if (!modNode || !sNode || !tNode) return null;

    const mKey = findConstructKey(modNode) || modNode.id;
    const sKey = findConstructKey(sNode) || sNode.id;
    const tKey = findConstructKey(tNode) || tNode.id;

    const mName = modNode.label || mKey;
    const sName = sNode.label || sKey;
    const tName = tNode.label || tKey;

    // Resolve chained moderator path if attached
    const chainLabels = [mName];
    const chainKeys = [mKey];
    let curr = mod;
    const visited = new Set([mod.id]);
    while (curr && curr.attachToModId) {
      const parent = moderatingEffects.find(m => m.id === curr.attachToModId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      const parentNode = nodes.find(n => n.id === parent.moderator);
      const pk = parentNode ? (findConstructKey(parentNode) || parentNode.id) : parent.moderator;
      const pl = parentNode ? (parentNode.label || pk) : parent.moderator;
      chainLabels.unshift(pl);
      chainKeys.unshift(pk);
      curr = parent;
    }
    const chainedLabelTerm = `${chainLabels.join(' x ')} x ${sName}`;
    const sortedChainLabelTerm = `${[...chainLabels].sort().join(' x ')} x ${sName}`;
    const chainedKeyTerm = `${chainKeys.join(' x ')} x ${sKey}`;
    const sortedChainKeyTerm = `${[...chainKeys].sort().join(' x ')} x ${sKey}`;

    // 0. Check activeResults.moderation?.moderating_effects directly if available
    const modEffects = activeResults.moderation?.moderating_effects;
    if (Array.isArray(modEffects)) {
      const match = modEffects.find(eff =>
        (eff.id && eff.id === mod.id) ||
        (eff.interaction_term && (
          eff.interaction_term === chainedLabelTerm ||
          eff.interaction_term === sortedChainLabelTerm ||
          eff.interaction_term === chainedKeyTerm ||
          eff.interaction_term === sortedChainKeyTerm
        )) ||
        (
          !mod.attachToModId &&
          (eff.moderator === mod.moderator || eff.moderator === mKey || eff.moderator === mName) &&
          (eff.source === mod.source || eff.source === sKey || eff.source === sName) &&
          (eff.target === mod.target || eff.target === tKey || eff.target === tName)
        )
      );
      if (match && match.estimates && match.estimates.beta_interaction !== undefined && match.estimates.beta_interaction !== null) {
        return {
          beta: Number(match.estimates.beta_interaction),
          term: match.interaction_term || chainedLabelTerm,
          target: tName,
          t: match.estimates.interaction_t !== undefined ? Number(match.estimates.interaction_t) : null,
          p: match.estimates.interaction_p_value !== undefined ? Number(match.estimates.interaction_p_value) : null
        };
      }
    }

    // Possible terms for interaction LV (moderator x predictor)
    const termCandidates = [
      chainedLabelTerm,
      sortedChainLabelTerm,
      chainedKeyTerm,
      sortedChainKeyTerm,
      `${mName} x ${sName}`,
      `${mKey} x ${sKey}`,
      `${mName.toUpperCase()} x ${sName.toUpperCase()}`,
      `${mKey.toUpperCase()} x ${sKey.toUpperCase()}`,
      `${mName}_x_${sName}`,
      `${mKey}_x_${sKey}`,
      `${sName} x ${mName}`,
      `${sKey} x ${mKey}`
    ];

    const targetCandidates = [
      tKey,
      tName,
      tNode.id,
      tName.toUpperCase(),
      tKey.toUpperCase()
    ].filter(Boolean);

    let beta = null;
    let termUsed = `${mName} x ${sName}`;

    // 1. Check activeResults.paths or activeResults.structural?.paths
    const pathsList = activeResults.paths || activeResults.structural?.paths;
    if (Array.isArray(pathsList)) {
      for (const p of pathsList) {
        if (targetCandidates.some(t => t === p.to) && termCandidates.some(tc => tc.toLowerCase() === (p.from || '').toLowerCase())) {
          beta = Number(p.beta ?? p.original ?? p.path_coefficient);
          termUsed = p.from;
          break;
        }
      }
    }

    // 2. Check activeResults.structural?.path_coefficients[target][source]
    if (beta === null && activeResults.structural?.path_coefficients) {
      const paths = activeResults.structural.path_coefficients;
      for (const t of targetCandidates) {
        if (paths[t]) {
          for (const tc of termCandidates) {
            if (paths[t][tc] !== undefined) {
              beta = Number(paths[t][tc]);
              termUsed = tc;
              break;
            }
          }
          if (beta !== null) break;
          for (const srcKey of Object.keys(paths[t])) {
            if (termCandidates.some(tc => tc.toLowerCase() === srcKey.toLowerCase())) {
              beta = Number(paths[t][srcKey]);
              termUsed = srcKey;
              break;
            }
          }
          if (beta !== null) break;
        }
      }
    }

    if (beta === null) return null;

    // Look for bootstrap significance if available
    let tStat = null;
    let pVal = null;
    const bootPaths = activeResults.bootstrap?.path_coefficients ||
                      activeResults.significance?.path_coefficients ||
                      activeResults.bootstrap_significance?.path_coefficients;
    if (Array.isArray(bootPaths)) {
      for (const bp of bootPaths) {
        const pStr = bp.path || `${bp.from} -> ${bp.to}`;
        if (termCandidates.some(tc => pStr.toLowerCase().includes(tc.toLowerCase())) &&
            targetCandidates.some(t => pStr.toLowerCase().includes(t.toLowerCase()))) {
          tStat = bp.t_statistic ?? bp.t_stat ?? bp.t;
          pVal = bp.p_value ?? bp.p ?? bp.pval;
          break;
        }
      }
    }

    return {
      beta,
      term: termUsed,
      target: tName,
      t: tStat !== null && tStat !== undefined ? Number(tStat) : null,
      p: pVal !== null && pVal !== undefined ? Number(pVal) : null
    };
  }

  function getOuterLoading(parentNode, indicatorNode) {
    if (!activeResults?.measurement || !parentNode || !indicatorNode) return null;
    const childInds = nodes.filter(n => n.parentId === parentNode.id && !n.isLatent);
    if (childInds.length === 1) {
      return 1.000;
    }

    const isFormative = parentNode.type === 'formative';
    const measMap = isFormative
      ? (activeResults.measurement.outer_weights || activeResults.measurement.outer_loadings)
      : (activeResults.measurement.outer_loadings || activeResults.measurement.outer_weights);
    if (!measMap) return null;

    const indNames = activeResults.indicator_names || {};
    const pKey = findConstructKey(parentNode);

    const pCandidates = [pKey, parentNode.id, parentNode.label, parentNode.label?.toUpperCase()].filter(Boolean);
    const iCandidates = [
      indicatorNode.id,
      indicatorNode.label,
      indicatorNode.name,
      indicatorNode.label?.toUpperCase(),
      indicatorNode.label?.toLowerCase()
    ].filter(Boolean);

    for (const p of pCandidates) {
      if (measMap[p]) {
        for (const i of iCandidates) {
          if (measMap[p][i] !== undefined) {
            return Number(measMap[p][i]);
          }
        }
        for (const [iid, iname] of Object.entries(indNames)) {
          if ((iid === indicatorNode.id || iname === indicatorNode.label || iname === indicatorNode.name) && measMap[p][iid] !== undefined) {
            return Number(measMap[p][iid]);
          }
        }
      }
    }
    return null;
  }

  let activeHoverNodeId = null;

  function showLatentHoverPopup(node, metrics) {
    if (contextMenu?.style.display === 'block') return;
    activeHoverNodeId = node.id;
    let popupEl = document.getElementById('canvas-latent-popup');
    if (!popupEl) {
      popupEl = document.createElement('div');
      popupEl.id = 'canvas-latent-popup';
      popupEl.className = 'canvas-latent-popup';
      const container = svg.parentElement || document.body;
      container.appendChild(popupEl);
    }

    const fmtVal = (val) => formatCanvasNumber(val);

    let r2Rows = '';
    if (metrics.r2 !== null) {
      r2Rows = `
        <div class="canvas-latent-popup__item">
          <span class="canvas-latent-popup__label">R²</span>
          <span class="canvas-latent-popup__val highlight">${fmtVal(metrics.r2)}</span>
        </div>
        <div class="canvas-latent-popup__item">
          <span class="canvas-latent-popup__label">R² Adjusted</span>
          <span class="canvas-latent-popup__val">${fmtVal(metrics.r2Adj)}</span>
        </div>
      `;
    }

    popupEl.innerHTML = `
      <div class="canvas-latent-popup__header">
        <span class="canvas-latent-popup__badge">LATENT</span>
        <span class="canvas-latent-popup__title">${metrics.name || 'Construct'}</span>
      </div>
      <div class="canvas-latent-popup__grid">
        ${r2Rows}
        <div class="canvas-latent-popup__item">
          <span class="canvas-latent-popup__label">Composite Reliability</span>
          <span class="canvas-latent-popup__val">${fmtVal(metrics.cr)}</span>
        </div>
        <div class="canvas-latent-popup__item">
          <span class="canvas-latent-popup__label">Avg Variance Extracted</span>
          <span class="canvas-latent-popup__val">${fmtVal(metrics.ave)}</span>
        </div>
        <div class="canvas-latent-popup__item">
          <span class="canvas-latent-popup__label">Cronbach's Alpha (α)</span>
          <span class="canvas-latent-popup__val">${fmtVal(metrics.alpha)}</span>
        </div>
      </div>
    `;

    const CTM = zoomLayer.getScreenCTM();
    if (CTM) {
      const pt = svg.createSVGPoint();
      pt.x = node.x;
      const h = node.height || (NODE_R * 2);
      pt.y = node.y - h / 2;
      const screenPt = pt.matrixTransform(CTM);
      const containerRect = (svg.parentElement || svg).getBoundingClientRect();

      const posX = screenPt.x - containerRect.left;
      const posY = screenPt.y - containerRect.top;

      popupEl.style.left = `${posX}px`;
      
      const flipUnder = (posY - 150) < 0;
      if (flipUnder) {
        popupEl.style.top = `${posY + h + 12}px`;
        popupEl.style.transform = 'translate(-50%, 0) scale(1)';
      } else {
        popupEl.style.top = `${posY - 8}px`;
        popupEl.style.transform = 'translate(-50%, -100%) scale(1)';
      }
    }

    popupEl.style.display = 'block';
    requestAnimationFrame(() => {
      if (activeHoverNodeId === node.id && contextMenu?.style.display !== 'block') popupEl.classList.add('visible');
    });
  }

  function hideLatentHoverPopup(immediate = false) {
    activeHoverNodeId = null;
    const popupEl = document.getElementById('canvas-latent-popup');
    if (!popupEl) return;
    popupEl.classList.remove('visible');
    if (immediate) {
      popupEl.style.display = 'none';
    } else {
      setTimeout(() => {
        if (!popupEl.classList.contains('visible')) {
          popupEl.style.display = 'none';
        }
      }, 160);
    }
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  function showConnectTooltip(x, y, text) {
    // Disabled: red warning line is used instead of text tooltips
  }

  function hideConnectTooltip() {
    const tip = document.getElementById('canvas-connect-tooltip');
    if (tip) {
      tip.style.display = 'none';
      tip.style.opacity = '0';
    }
  }

  function wouldCreateCycle(sourceId, targetId, currentEdges) {
    if (sourceId === targetId) return true;
    const visited = new Set();
    const queue = [targetId];

    while (queue.length > 0) {
      const curr = queue.shift();
      if (curr === sourceId) return true;
      if (visited.has(curr)) continue;
      visited.add(curr);

      for (const edge of currentEdges) {
        if (edge.sourceId === curr) {
          const nextTarget = edge.targetId;
          const targetNode = nodes.find(n => n.id === nextTarget);
          if (targetNode && targetNode.isLatent !== false && !targetNode.isText) {
            if (!visited.has(nextTarget)) {
              queue.push(nextTarget);
            }
          }
        }
      }
    }
    return false;
  }

  function getEdgeMidpointAndPoints(sNode, tNode, edge) {
    const { x1, y1, x2, y2 } = getEdgeCoordinates(sNode, tNode, edge);
    let midX = (x1 + x2) / 2;
    let midY = (y1 + y2) / 2;
    let segments = [];

    if (edge.waypoints && edge.waypoints.length > 0) {
      const pts = [{ x: x1, y: y1 }, ...edge.waypoints, { x: x2, y: y2 }];
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push([pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y]);
      }
      let totalLen = 0;
      const lens = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const segLen = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        lens.push(segLen);
        totalLen += segLen;
      }
      const targetHalf = totalLen / 2;
      let acc = 0;
      for (let i = 0; i < lens.length; i++) {
        if (acc + lens[i] >= targetHalf) {
          const rem = targetHalf - acc;
          const ratio = lens[i] > 0 ? rem / lens[i] : 0;
          midX = pts[i].x + ratio * (pts[i + 1].x - pts[i].x);
          midY = pts[i].y + ratio * (pts[i + 1].y - pts[i].y);
          break;
        }
        acc += lens[i];
      }
    } else if (edge.curved) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const curveVal = typeof edge.curvature === 'number' ? edge.curvature : 40;
      const cx = mx + (-dy / len) * curveVal;
      const cy = my + (dx / len) * curveVal;

      const samplePts = [];
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const invT = 1 - t;
        const px = invT * invT * x1 + 2 * invT * t * cx + t * t * x2;
        const py = invT * invT * y1 + 2 * invT * t * cy + t * t * y2;
        samplePts.push({ x: px, y: py });
      }
      for (let i = 0; i < samplePts.length - 1; i++) {
        segments.push([samplePts[i].x, samplePts[i].y, samplePts[i + 1].x, samplePts[i + 1].y]);
      }
      midX = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
      midY = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
    } else {
      segments.push([x1, y1, x2, y2]);
      midX = (x1 + x2) / 2;
      midY = (y1 + y2) / 2;
    }

    return { midX, midY, segments };
  }

  /**
   * Compute the geometry (start/land points) for a moderation dashed line.
   * Handles base moderations (landing at the structural path midpoint)
   * AND chained moderations (landing at the midpoint of parent moderation dashed line).
   * Supports multiple moderators converging cleanly at the exact same landing point.
   */
  function getModerationLineGeometry(mod, visited = new Set()) {
    if (!mod || visited.has(mod.id)) return null;
    visited.add(mod.id);

    const modNode = nodes.find(n => n.id === mod.moderator);
    if (!modNode) return null;

    let landX, landY;

    if (mod.attachToModId) {
      const parentMod = moderatingEffects.find(m => m.id === mod.attachToModId);
      if (!parentMod) return null;
      const parentGeo = getModerationLineGeometry(parentMod, visited);
      if (!parentGeo) return null;
      // Landing point: midpoint of the parent dashed arrow line
      landX = parentGeo.midX;
      landY = parentGeo.midY;
    } else {
      const sNode   = nodes.find(n => n.id === mod.source);
      const tNode   = nodes.find(n => n.id === mod.target);
      const targetEdge = edges.find(e => e.sourceId === mod.source && e.targetId === mod.target);
      if (!sNode || !tNode || !targetEdge) return null;

      const midpoint = getEdgeMidpointAndPoints(sNode, tNode, targetEdge);
      landX = midpoint.midX;
      landY = midpoint.midY;
    }

    // Start point: on moderator construct boundary toward landing point
    const mdx  = landX - modNode.x;
    const mdy  = landY - modNode.y;
    const mlen = Math.hypot(mdx, mdy) || 1;
    const modR = (modNode.width ? modNode.width / 2 : NODE_R);
    const startX = modNode.x + (mdx / mlen) * modR;
    const startY = modNode.y + (mdy / mlen) * modR;

    let points = [{ x: startX, y: startY }, ...(mod.waypoints || []), { x: landX, y: landY }];
    let path = `M ${startX} ${startY}`;
    if (mod.curved && !mod.waypoints?.length) {
      const dx = landX - startX, dy = landY - startY, length = Math.hypot(dx, dy) || 1;
      const curvature = typeof mod.curvature === 'number' ? mod.curvature : 40;
      const cx = (startX + landX) / 2 - dy / length * curvature;
      const cy = (startY + landY) / 2 + dx / length * curvature;
      path += ` Q ${cx} ${cy} ${landX} ${landY}`;
      points = Array.from({ length: 21 }, (_, i) => { const t = i / 20, u = 1 - t; return { x: u*u*startX + 2*u*t*cx + t*t*landX, y: u*u*startY + 2*u*t*cy + t*t*landY }; });
    } else {
      points.slice(1).forEach(point => { path += ` L ${point.x} ${point.y}`; });
    }
    const segments = points.slice(1).map((point, i) => [points[i].x, points[i].y, point.x, point.y]);
    const lengths = segments.map(([x1, y1, x2, y2]) => Math.hypot(x2 - x1, y2 - y1));
    const half = lengths.reduce((sum, length) => sum + length, 0) / 2;
    let remaining = half, midX = startX, midY = startY;
    for (let i = 0; i < segments.length; i++) {
      if (remaining <= lengths[i] || i === segments.length - 1) {
        const [x1, y1, x2, y2] = segments[i];
        const t = lengths[i] ? remaining / lengths[i] : 0;
        midX = x1 + t * (x2 - x1); midY = y1 + t * (y2 - y1); break;
      }
      remaining -= lengths[i];
    }
    return { startX, startY, landX, landY, midX, midY, path, segments };
  }

  /**
   * Find an existing moderation dashed line near svgPt.
   * Generous 32px tolerance for easy clicking and snapping.
   */
  function findModerationLineUnderPoint(svgPt, excludeModeratorId = null, excludeModId = null) {
    let best = null;
    let minDistance = 32;

    for (const mod of moderatingEffects) {
      if (excludeModId && mod.id === excludeModId) continue;
      if (excludeModeratorId && mod.moderator === excludeModeratorId) continue;
      const geo = getModerationLineGeometry(mod);
      if (!geo) continue;
      const { midX, midY } = geo;
      const dist = Math.min(...geo.segments.map(([x1, y1, x2, y2]) => distToSegment(svgPt.x, svgPt.y, x1, y1, x2, y2)));
      const distToMid = Math.hypot(svgPt.x - midX, svgPt.y - midY);

      if (dist <= 32 || distToMid <= 28) {
        let effectiveDist = dist;
        // Strong priority if cursor is near the midpoint of the dotted arrow (where chained arrows connect!)
        if (distToMid <= 28) effectiveDist -= 45;
        // Priority for root moderation if multiple overlap
        if (!mod.attachToModId) effectiveDist -= 10;

        if (effectiveDist < minDistance) {
          minDistance = effectiveDist;
          best = {
            mod,
            midX,
            midY,
            dist,
            distToMid,
            inSnapZone: distToMid <= 28
          };
        }
      }
    }
    return best;
  }

  function findPathTargetUnderPoint(svgPt) {
    let best = null;
    let minDistance = Infinity;

    for (const edge of edges) {
      const sNode = nodes.find(n => n.id === edge.sourceId);
      const tNode = nodes.find(n => n.id === edge.targetId);
      if (!sNode || !tNode) continue;
      // Must be structural path between latent constructs
      if (sNode.isLatent === false || tNode.isLatent === false || sNode.isText || tNode.isText) continue;

      const { midX, midY, segments } = getEdgeMidpointAndPoints(sNode, tNode, edge);

      // Check distance to any segment of this edge
      let distToEdge = Infinity;
      for (const [x1, y1, x2, y2] of segments) {
        const d = distToSegment(svgPt.x, svgPt.y, x1, y1, x2, y2);
        if (d < distToEdge) distToEdge = d;
      }

      const distToMid = Math.hypot(svgPt.x - midX, svgPt.y - midY);

      // Snap zone: within 28px of midpoint
      const inSnapZone = distToMid <= 28;
      // Near edge: within 24px of edge line
      const nearEdge = distToEdge <= 24;

      if (inSnapZone || nearEdge) {
        // Priority: snap zone gets strong preference
        const effectiveDist = inSnapZone ? distToMid - 50 : distToEdge;
        if (effectiveDist < minDistance) {
          minDistance = effectiveDist;
          best = { edge, sNode, tNode, midX, midY, inSnapZone, distToEdge, distToMid };
        }
      }
    }
    return best;
  }

  /**
   * Unified target resolver: determines whether the pointer is aiming at a
   * structural path or a moderation arrow.
   */
  function findModerationTargetUnderPoint(svgPt, moderatorNodeId = null) {
    const pathTarget = findPathTargetUnderPoint(svgPt);
    const modLineTarget = findModerationLineUnderPoint(svgPt, moderatorNodeId);

    // Rule 1: If cursor is specifically in the snap zone of a moderation arrow's midpoint:
    if (modLineTarget && modLineTarget.inSnapZone && (!pathTarget || !pathTarget.inSnapZone)) {
      return { type: 'moderation', ...modLineTarget };
    }

    // Rule 2: If cursor is in the snap zone of the structural path midpoint:
    if (pathTarget && pathTarget.inSnapZone && (!modLineTarget || !modLineTarget.inSnapZone)) {
      return { type: 'path', ...pathTarget };
    }

    // Rule 3: If both are near or neither in snap zone, pick the closer one:
    if (modLineTarget && (!pathTarget || modLineTarget.dist < pathTarget.distToEdge)) {
      return { type: 'moderation', ...modLineTarget };
    }

    if (pathTarget) {
      return { type: 'path', ...pathTarget };
    }

    if (modLineTarget) {
      return { type: 'moderation', ...modLineTarget };
    }

    return null;
  }

  function handleModerationOnEdge(edge, moderatorNode = null) {
    const modNode = moderatorNode || pendingModeratorNode;
    if (!modNode) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Click a moderator construct first, then click a path.' } }));
      } catch (err) {}
      return false;
    }
    const sNode = nodes.find(n => n.id === edge.sourceId);
    const tNode = nodes.find(n => n.id === edge.targetId);
    if (!sNode || !tNode || sNode.isLatent === false || tNode.isLatent === false || sNode.isText || tNode.isText) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Moderation requires a structural path between latent constructs.' } }));
      } catch (err) {}
      return false;
    }
    if (modNode.id === sNode.id || modNode.id === tNode.id) {
      if (modNode.id === sNode.id) {
        // Dragged/connected from predictor to its own outgoing path -> Quadratic effect!
        return handleQuadraticOnEdge(edge);
      }
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Moderator cannot be the outcome of the path.' } }));
      } catch (err) {}
      return false;
    }
    if (wouldCreateCycle(modNode.id, tNode.id, edges)) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Cannot add moderation: would create a circular dependency.' } }));
      } catch (err) {}
      return false;
    }

    // Check if this construct already moderates this path directly
    const existingDirect = moderatingEffects.find(m => 
      m.moderator === modNode.id && 
      m.source === sNode.id && 
      m.target === tNode.id && 
      !m.attachToModId
    );
    if (existingDirect) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'This construct already moderates this path directly.' } }));
      } catch (err) {}
      return false;
    }

    const newMod = {
      id: generateId(),
      moderator: modNode.id,
      source: sNode.id,
      target: tNode.id,
      method: 'two_stage',
      standardize: true
    };
    moderatingEffects.push(newMod);
    render();
    pushHistory();
    try {
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: `Added moderation: ${modNode.label} on ${sNode.label} → ${tNode.label}` } }));
    } catch (err) {}
    return true;
  }

  function handleModerationOnMod(parentMod, moderatorNode = null) {
    const modNode = moderatorNode || pendingModeratorNode;
    if (!modNode) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Click a moderator construct first, then click a path or moderation arrow.' } }));
      } catch (err) {}
      return false;
    }
    const sNode = nodes.find(n => n.id === parentMod.source);
    const tNode = nodes.find(n => n.id === parentMod.target);
    if (!sNode || !tNode) return false;

    // A moderator construct cannot connect to its own moderation arrow
    if (modNode.id === parentMod.moderator) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'A moderator construct cannot connect to its own moderation arrow.' } }));
      } catch (err) {}
      return false;
    }

    if (modNode.id === sNode.id || modNode.id === tNode.id) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Moderator cannot be predictor or outcome of the path.' } }));
      } catch (err) {}
      return false;
    }

    // Check circular dependencies in moderation chain:
    // Ensure parentMod does not chain back to modNode
    let curr = parentMod;
    const visited = new Set();
    while (curr && curr.attachToModId) {
      if (curr.moderator === modNode.id || visited.has(curr.id)) {
        try {
          window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Cannot add moderation: would create a circular dependency.' } }));
        } catch (err) {}
        return false;
      }
      visited.add(curr.id);
      curr = moderatingEffects.find(m => m.id === curr.attachToModId);
    }

    if (wouldCreateCycle(modNode.id, tNode.id, edges)) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Cannot add moderation: would create a circular dependency.' } }));
      } catch (err) {}
      return false;
    }

    // Check if modNode is already connected to THIS specific moderation arrow
    const existingOnParent = moderatingEffects.find(m => m.moderator === modNode.id && m.attachToModId === parentMod.id);
    if (existingOnParent) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'This construct is already connected to this moderation arrow.' } }));
      } catch (err) {}
      return false;
    }

    const newMod = {
      id: generateId(),
      moderator: modNode.id,
      source: sNode.id,
      target: tNode.id,
      method: 'two_stage',
      standardize: true,
      attachToModId: parentMod.id
    };
    moderatingEffects.push(newMod);
    render();
    pushHistory();
    try {
      const parentModNode = nodes.find(n => n.id === parentMod.moderator);
      window.dispatchEvent(new CustomEvent('toast', { 
        detail: { message: `Connected moderation: ${modNode.label} to ${parentModNode ? parentModNode.label : 'moderator'} arrow` } 
      }));
    } catch (err) {}
    return true;
  }

  function getGaussianCopulaGeometry(gc) {
    const sId = gc.source_construct || gc.source;
    const tId = gc.target_construct || gc.target;
    const sNode = nodes.find(n => n.id === sId || n.label === sId);
    const tNode = nodes.find(n => n.id === tId || n.label === tId);
    if (!sNode || !tNode) return null;

    const edge = edges.find(e =>
      (e.sourceId === sNode.id && e.targetId === tNode.id) ||
      (e.sourceId === sId && e.targetId === tId)
    );
    if (!edge) return null;

    const { x1, y1, x2, y2 } = getEdgeCoordinates(sNode, tNode, edge);

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    const hasMod = moderatingEffects.some(m =>
      (m.source === sNode.id || m.source === sId) &&
      (m.target === tNode.id || m.target === tId)
    );

    let midX = (x1 + x2) / 2;
    let midY = (y1 + y2) / 2;

    if (edge.waypoints && edge.waypoints.length > 0) {
      const numJoints = edge.waypoints.length;
      if (numJoints % 2 === 1) {
        const midIdx = Math.floor(numJoints / 2);
        midX = edge.waypoints[midIdx].x;
        midY = edge.waypoints[midIdx].y;
      } else {
        const idx1 = numJoints / 2 - 1;
        const idx2 = numJoints / 2;
        midX = (edge.waypoints[idx1].x + edge.waypoints[idx2].x) / 2;
        midY = (edge.waypoints[idx1].y + edge.waypoints[idx2].y) / 2;
      }
    } else if (edge.curved) {
      const curveVal = typeof edge.curvature === 'number' ? edge.curvature : 40;
      const cx = midX + (-dy / len) * curveVal;
      const cy = midY + (dx / len) * curveVal;
      midX = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
      midY = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
    }

    let landX = midX;
    let landY = midY;
    if (hasMod) {
      landX += ux * 12;
      landY += uy * 12;
    }

    let nodeX = gc.node_x !== undefined ? gc.node_x : gc.x;
    let nodeY = gc.node_y !== undefined ? gc.node_y : gc.y;

    if (nodeX === undefined || nodeY === undefined || isNaN(nodeX) || isNaN(nodeY)) {
      const cand1 = { x: midX + nx * 110, y: midY + ny * 110 };
      const cand2 = { x: midX - nx * 110, y: midY - ny * 110 };

      const getMinDist = (pt) => {
        let minDist = Infinity;
        nodes.forEach(n => {
          const d = Math.hypot(n.x - pt.x, n.y - pt.y);
          if (d < minDist) minDist = d;
        });
        gaussianCopulas.forEach(other => {
          if (other.id !== gc.id && other.node_x !== undefined) {
            const d = Math.hypot(other.node_x - pt.x, other.node_y - pt.y);
            if (d < minDist) minDist = d;
          }
        });
        return minDist;
      };

      const dist1 = getMinDist(cand1);
      const dist2 = getMinDist(cand2);
      const chosen = dist1 >= dist2 ? cand1 : cand2;
      nodeX = chosen.x;
      nodeY = chosen.y;
      gc.node_x = nodeX;
      gc.node_y = nodeY;
    }

    const gcRadius = NODE_R * 0.55;
    const lineDx = landX - nodeX;
    const lineDy = landY - nodeY;
    const lineDist = Math.hypot(lineDx, lineDy) || 1;

    const startX = nodeX + (lineDx / lineDist) * gcRadius;
    const startY = nodeY + (lineDy / lineDist) * gcRadius;

    return {
      sNode,
      tNode,
      edge,
      nodeX,
      nodeY,
      gcRadius,
      startX,
      startY,
      landX,
      landY
    };
  }

  function getGaussianCopulaDetails(gc) {
    if (!activeResults) return null;
    const sId = gc.source_construct || gc.source;
    const tId = gc.target_construct || gc.target;
    const sNode = nodes.find(n => n.id === sId || n.label === sId);
    const tNode = nodes.find(n => n.id === tId || n.label === tId);
    const sName = sNode ? sNode.label : sId;
    const tName = tNode ? tNode.label : tId;
    const sKey = sNode ? (findConstructKey(sNode) || sId) : sId;
    const tKey = tNode ? (findConstructKey(tNode) || tId) : tId;

    const endoTests = activeResults.gaussian_copula?.endogeneity_tests;
    if (Array.isArray(endoTests)) {
      const match = endoTests.find(row =>
        (row.source === sId || row.source === sName || row.source === sKey) &&
        (row.target === tId || row.target === tName || row.target === tKey)
      );
      if (match && match.original !== undefined) {
        return {
          beta: Number(match.original),
          se: match.se,
          t: match.t_stat,
          p: match.p_value,
          term: match.gc_construct || `GC (${sName} -> ${tName})`,
          target: tName
        };
      }
    }

    const gcConstructNames = [
      `GC (${sName} -> ${tName})`,
      `GC (${sKey} -> ${tKey})`,
      `GC (${sName.toUpperCase()} -> ${tName.toUpperCase()})`,
      `GC (${sKey.toUpperCase()} -> ${tKey.toUpperCase()})`,
      `GC (${sId} -> ${tId})`,
      `gc_${sName}_${tName}`,
      `gc_${sKey}_${tKey}`
    ];
    const targetCandidates = [tName, tKey, tId, tName.toUpperCase(), tKey.toUpperCase()];

    const pathsList = activeResults.paths || activeResults.structural?.paths;
    if (Array.isArray(pathsList)) {
      for (const p of pathsList) {
        if (targetCandidates.some(t => t === p.to) &&
            gcConstructNames.some(gcn => gcn.toLowerCase() === (p.from || '').toLowerCase())) {
          return {
            beta: Number(p.beta ?? p.original ?? p.path_coefficient),
            se: p.se,
            t: p.t_stat ?? p.t,
            p: p.p_value ?? p.p,
            term: p.from,
            target: tName
          };
        }
      }
    }

    const pathCoefs = activeResults.structural?.path_coefficients;
    if (pathCoefs) {
      for (const t of targetCandidates) {
        if (pathCoefs[t]) {
          for (const gcn of gcConstructNames) {
            if (pathCoefs[t][gcn] !== undefined) {
              return {
                beta: Number(pathCoefs[t][gcn]),
                term: gcn,
                target: tName
              };
            }
          }
        }
      }
    }

    return null;
  }

  function handleCopulaOnEdge(edge) {
    const sNode = nodes.find(n => n.id === edge.sourceId);
    const tNode = nodes.find(n => n.id === edge.targetId);
    if (!sNode || !tNode || sNode.isLatent === false || tNode.isLatent === false || sNode.isText || tNode.isText) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Gaussian copula requires a structural path between latent constructs.' } }));
      } catch (err) {}
      return false;
    }
    if (sNode.label?.startsWith('GC (') || sNode.label?.includes(' x ') || sNode.isInteraction || sNode.isCopula) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Gaussian copula cannot be added to an interaction or copula construct.' } }));
      } catch (err) {}
      return false;
    }

    const existingIdx = gaussianCopulas.findIndex(gc =>
      (gc.source_construct === sNode.id || gc.source === sNode.id) &&
      (gc.target_construct === tNode.id || gc.target === tNode.id)
    );

    if (existingIdx >= 0) {
      const removed = gaussianCopulas.splice(existingIdx, 1)[0];
      selectedIds.delete(removed.id);
      render();
      pushHistory();
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: `Removed Gaussian copula on ${sNode.label || sNode.id} → ${tNode.label || tNode.id}` } }));
      } catch (err) {}
      return true;
    }

    const newGc = {
      id: generateId(),
      source_construct: sNode.id,
      target_construct: tNode.id,
      source: sNode.id,
      target: tNode.id
    };
    gaussianCopulas.push(newGc);
    render();
    pushHistory();
    try {
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: `Added Gaussian copula on ${sNode.label || sNode.id} → ${tNode.label || tNode.id}` } }));
    } catch (err) {}
    return true;
  }

  function getQuadraticEffectGeometry(qe) {
    const pId = qe.predictor_construct || qe.predictor || qe.source;
    const tId = qe.target_construct || qe.target;
    const pNode = nodes.find(n => n.id === pId || n.label === pId);
    const tNode = nodes.find(n => n.id === tId || n.label === tId);
    if (!pNode || !tNode) return null;

    const edge = edges.find(e =>
      (e.sourceId === pNode.id && e.targetId === tNode.id) ||
      (e.sourceId === pId && e.targetId === tId)
    );
    if (!edge) return null;

    const { x1, y1, x2, y2 } = getEdgeCoordinates(pNode, tNode, edge);

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    let midX = (x1 + x2) / 2;
    let midY = (y1 + y2) / 2;

    if (edge.waypoints && edge.waypoints.length > 0) {
      const numJoints = edge.waypoints.length;
      if (numJoints % 2 === 1) {
        const midIdx = Math.floor(numJoints / 2);
        midX = edge.waypoints[midIdx].x;
        midY = edge.waypoints[midIdx].y;
      } else {
        const idx1 = numJoints / 2 - 1;
        const idx2 = numJoints / 2;
        midX = (edge.waypoints[idx1].x + edge.waypoints[idx2].x) / 2;
        midY = (edge.waypoints[idx1].y + edge.waypoints[idx2].y) / 2;
      }
    } else if (edge.curved) {
      const curveVal = typeof edge.curvature === 'number' ? edge.curvature : 40;
      const cx = midX + (-dy / len) * curveVal;
      const cy = midY + (dx / len) * curveVal;
      midX = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
      midY = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
    }

    const hasMod = moderatingEffects.some(m =>
      (m.source === pNode.id || m.source === pId) &&
      (m.target === tNode.id || m.target === tId)
    );
    const hasGc = gaussianCopulas.some(gc =>
      (gc.source_construct === pNode.id || gc.source === pId) &&
      (gc.target_construct === tNode.id || gc.target === tId)
    );

    let landX = midX;
    let landY = midY;
    if (hasMod) {
      landX += ux * 10;
      landY += uy * 10;
    }
    if (hasGc) {
      landX -= ux * 10;
      landY -= uy * 10;
    }

    // Results node placement
    let nodeX = qe.node_x !== undefined ? qe.node_x : qe.x;
    let nodeY = qe.node_y !== undefined ? qe.node_y : qe.y;

    if (nodeX === undefined || nodeY === undefined || isNaN(nodeX) || isNaN(nodeY)) {
      const cand1 = { x: midX + nx * 115, y: midY + ny * 115 };
      const cand2 = { x: midX - nx * 115, y: midY - ny * 115 };

      const getMinDist = (pt) => {
        let minDist = Infinity;
        nodes.forEach(n => {
          const d = Math.hypot(n.x - pt.x, n.y - pt.y);
          if (d < minDist) minDist = d;
        });
        gaussianCopulas.forEach(other => {
          if (other.node_x !== undefined) {
            const d = Math.hypot(other.node_x - pt.x, other.node_y - pt.y);
            if (d < minDist) minDist = d;
          }
        });
        quadraticEffects.forEach(other => {
          if (other.id !== qe.id && other.node_x !== undefined) {
            const d = Math.hypot(other.node_x - pt.x, other.node_y - pt.y);
            if (d < minDist) minDist = d;
          }
        });
        return minDist;
      };

      const dist1 = getMinDist(cand1);
      const dist2 = getMinDist(cand2);
      const chosen = dist1 >= dist2 ? cand1 : cand2;
      nodeX = chosen.x;
      nodeY = chosen.y;
      qe.node_x = nodeX;
      qe.node_y = nodeY;
    }

    const qeRadius = NODE_R * 0.7;
    const lineDx = landX - nodeX;
    const lineDy = landY - nodeY;
    const lineDist = Math.hypot(lineDx, lineDy) || 1;

    const startX = nodeX + (lineDx / lineDist) * qeRadius;
    const startY = nodeY + (lineDy / lineDist) * qeRadius;

    // Editor mode curved arc control points from predictor construct to landX, landY
    const pRadius = pNode.width ? Math.max(pNode.width, pNode.height) / 2 : NODE_R;
    const arcStartX = pNode.x + nx * (pRadius + 2);
    const arcStartY = pNode.y + ny * (pRadius + 2);

    const arcMidX = (arcStartX + landX) / 2 + nx * 38;
    const arcMidY = (arcStartY + landY) / 2 + ny * 38;

    // Badge location on the bezier curve (t = 0.5)
    const badgeX = 0.25 * arcStartX + 0.5 * arcMidX + 0.25 * landX;
    const badgeY = 0.25 * arcStartY + 0.5 * arcMidY + 0.25 * landY;

    return {
      pNode,
      tNode,
      edge,
      nodeX,
      nodeY,
      qeRadius,
      startX,
      startY,
      landX,
      landY,
      arcStartX,
      arcStartY,
      arcMidX,
      arcMidY,
      badgeX,
      badgeY,
      nx,
      ny
    };
  }

  function getQuadraticEffectDetails(qe) {
    if (!activeResults) return null;
    const pId = qe.predictor_construct || qe.predictor || qe.source;
    const tId = qe.target_construct || qe.target;
    const pNode = nodes.find(n => n.id === pId || n.label === pId);
    const tNode = nodes.find(n => n.id === tId || n.label === tId);
    const pName = pNode ? pNode.label : pId;
    const tName = tNode ? tNode.label : tId;

    const nlList = activeResults.nonlinear_effects;
    if (Array.isArray(nlList)) {
      const match = nlList.find(row =>
        (row.predictor === pId || row.predictor === pName) &&
        (row.target === tId || row.target === tName)
      );
      if (match) {
        return {
          beta: Number(match.quadratic_effect ?? match.b2_quadratic ?? match.b2_unstandardized ?? match.beta ?? 0),
          linearBeta: Number(match.linear_effect ?? match.b1_linear ?? 0),
          se: match.standard_error ?? match.se,
          t: match.t_statistic ?? match.t_stat ?? match.t,
          p: match.p_value ?? match.p,
          ciLow: match.ci_lower ?? match.ci_low,
          ciHigh: match.ci_upper ?? match.ci_high,
          f2: match.f2 ?? match.f_squared,
          rating: match.f2_rating,
          term: match.quad_construct_name || `${pName} x ${pName}`,
          target: tName
        };
      }
    }

    const termNames = [
      `${pName} x ${pName}`,
      `${pId} x ${pId}`,
      `${pName} x ${pName} -> ${tName}`,
      `qe_${pName}_${tName}`,
    ];
    const targetCandidates = [tName, tId, tName.toUpperCase(), tId.toUpperCase()];

    const pathsList = activeResults.paths || activeResults.structural?.paths;
    if (Array.isArray(pathsList)) {
      for (const p of pathsList) {
        if (targetCandidates.some(t => t === p.to) &&
            termNames.some(tn => tn.toLowerCase() === (p.from || '').toLowerCase())) {
          return {
            beta: Number(p.beta ?? p.original ?? p.path_coefficient),
            se: p.se,
            t: p.t_stat ?? p.t,
            p: p.p_value ?? p.p,
            term: p.from,
            target: p.to
          };
        }
      }
    }

    const coefs = activeResults.structural?.path_coefficients;
    if (coefs && typeof coefs === 'object') {
      for (const tgt of targetCandidates) {
        const fromMap = coefs[tgt];
        if (fromMap && typeof fromMap === 'object') {
          for (const tn of termNames) {
            if (fromMap[tn] !== undefined) {
              return {
                beta: Number(fromMap[tn]),
                term: tn,
                target: tgt
              };
            }
          }
        }
      }
    }

    return null;
  }

  function handleQuadraticOnEdge(edge) {
    const sNode = nodes.find(n => n.id === edge.sourceId);
    const tNode = nodes.find(n => n.id === edge.targetId);
    if (!sNode || !tNode || sNode.isLatent === false || tNode.isLatent === false || sNode.isText || tNode.isText) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Quadratic effect requires a structural path between latent constructs.' } }));
      } catch (err) {}
      return false;
    }
    if (sNode.label?.includes(' x ') || sNode.isInteraction || sNode.label?.startsWith('GC (')) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Quadratic effect cannot be added to an interaction or copula construct.' } }));
      } catch (err) {}
      return false;
    }

    const existingIdx = quadraticEffects.findIndex(qe =>
      (qe.predictor_construct === sNode.id || qe.predictor === sNode.id || qe.source === sNode.id) &&
      (qe.target_construct === tNode.id || qe.target === tNode.id)
    );

    if (existingIdx >= 0) {
      const removed = quadraticEffects.splice(existingIdx, 1)[0];
      selectedIds.delete(removed.id);
      render();
      pushHistory();
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: `Removed quadratic effect on ${sNode.label || sNode.id} → ${tNode.label || tNode.id}` } }));
      } catch (err) {}
      return true;
    }

    const newQe = {
      id: generateId(),
      predictor_construct: sNode.id,
      target_construct: tNode.id,
      predictor: sNode.id,
      target: tNode.id
    };
    quadraticEffects.push(newQe);
    render();
    pushHistory();
    try {
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: `Added quadratic effect on ${sNode.label || sNode.id} → ${tNode.label || tNode.id}` } }));
    } catch (err) {}
    return true;
  }


  function render() {
    if ((activeHoverNodeId && !nodes.some(n => n.id === activeHoverNodeId)) || !activeResults) {
      hideLatentHoverPopup(true);
    }
    nodesLayer.innerHTML = '';
    edgesLayer.innerHTML = '';
    
    // Pre-calculate edge coordinates and anti-collision badge positions
    const edgesWithCoords = edges.map(edge => {
      const source = nodes.find(n => n.id === edge.sourceId);
      const target = nodes.find(n => n.id === edge.targetId);
      if (!source || !target) return null;
      const { x1, y1, x2, y2 } = getEdgeCoordinates(source, target, edge);
      const coef = getPathCoefficient(source, target);
      return {
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        x1, y1, x2, y2,
        curved: edge.curved,
        curvature: edge.curvature,
        hasBadge: coef !== null && coef !== undefined,
      };
    }).filter(Boolean);

    const badgePosMap = resolveBadgePositions(edgesWithCoords);

    // Edges
    edges.forEach(edge => {
      const source = nodes.find(n => n.id === edge.sourceId);
      const target = nodes.find(n => n.id === edge.targetId);
      if (!source || !target) return;
      
      const { x1, y1, x2, y2 } = getEdgeCoordinates(source, target, edge);
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      
      let d = `M ${x1} ${y1}`;
      if (edge.curved) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx*dx + dy*dy) || 1;
        const curveVal = typeof edge.curvature === 'number' ? edge.curvature : 40;
        const cx = mx + (-dy / len) * curveVal;
        const cy = my + (dx / len) * curveVal;
        d += ` Q ${cx} ${cy} ${x2} ${y2}`;
      } else {
        if (edge.waypoints && edge.waypoints.length > 0) {
          edge.waypoints.forEach(wp => {
            d += ` L ${wp.x} ${wp.y}`;
          });
        }
        d += ` L ${x2} ${y2}`;
      }
      
      const isSelected = selectedIds.has(edge.id);
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const defEdgeColor = isDark ? '#ffffff' : '#0f172a';
      const effectiveEdgeColor = edge.color || defEdgeColor;

      if (isSelected) {
        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        halo.setAttribute('d', d);
        halo.setAttribute('fill', 'none');
        halo.setAttribute('stroke', 'var(--color-accent, #6B4EE6)');
        halo.setAttribute('stroke-width', String((parseFloat(edge.strokeWidth || '2')) + 5));
        halo.setAttribute('stroke-opacity', '0.45');
        halo.setAttribute('stroke-linecap', 'round');
        edgesLayer.appendChild(halo);
      }

      path.setAttribute('d', d);
      path.setAttribute('class', isSelected ? 'edge-path selected' : 'edge-path');
      
      const arrowType = edge.arrowhead !== undefined ? edge.arrowhead : 'solid';
      if (arrowType && arrowType !== 'none') {
        const markerId = getOrCreateMarker(arrowType, effectiveEdgeColor);
        path.setAttribute('marker-end', `url(#${markerId})`);
      } else {
        path.removeAttribute('marker-end');
      }

      path.style.stroke = effectiveEdgeColor;
      path.style.color = effectiveEdgeColor;
      path.style.strokeWidth = edge.strokeWidth || '2';
      if (edge.strokeDasharray) {
        path.style.strokeDasharray = edge.strokeDasharray;
      } else {
        path.style.strokeDasharray = '';
      }
      
      path.style.fill = 'none';
      path.style.cursor = 'pointer';
      edgesLayer.appendChild(path);
      
      const clickPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      clickPath.setAttribute('d', d);
      clickPath.style.stroke = 'rgba(0,0,0,0.01)';
      clickPath.style.strokeWidth = '16';
      clickPath.style.fill = 'none';
      clickPath.style.cursor = 'pointer';
      
      clickPath.addEventListener('click', (e) => {
        e.stopPropagation();
        if (mode === 'erase') {
          selectedIds.clear();
          selectedIds.add(edge.id);
          deleteSelected();
          return;
        }
        if (mode === 'copula') {
          handleCopulaOnEdge(edge);
          return;
        }
        if (mode === 'quadratic') {
          handleQuadraticOnEdge(edge);
          return;
        }
        if (mode === 'moderation') {
          handleModerationOnEdge(edge);
          return;
        }
        if (mode === 'connect' && connectStartNode) {
          if (connectStartNode.id === edge.sourceId) {
            handleQuadraticOnEdge(edge);
            cancelTempConnecting();
            return;
          }
          handleModerationOnEdge(edge, connectStartNode);
          cancelTempConnecting();
          return;
        }
        if (mode === 'select') {
          if (!e.shiftKey) clearSelection();
          selectedIds.add(edge.id);
          render();
        }
      });
      clickPath.addEventListener('contextmenu', (e) => showContextMenu(e, edge.id));
      edgesLayer.appendChild(clickPath);

      // In Copula mode: display click indicator icon on structural paths
      if (mode === 'copula') {
        const isEligible = source.isLatent && !source.isText && target.isLatent && !target.isText && !source.label?.startsWith('GC (') && !source.label?.includes(' x ');
        if (!isEligible) {
          clickPath.style.cursor = 'not-allowed';
          clickPath.setAttribute('title', 'Gaussian copula cannot be added: path must connect standard latent constructs');
        } else {
          clickPath.style.cursor = 'pointer';
          const hasExistingGc = gaussianCopulas.some(gc => (gc.source_construct === edge.sourceId || gc.source === edge.sourceId) && (gc.target_construct === edge.targetId || gc.target === edge.targetId));
          const hoverMidX = (x1 + x2) / 2;
          const hoverMidY = (y1 + y2) / 2;

          const copulaInd = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          copulaInd.setAttribute('class', 'copula-hover-indicator');
          copulaInd.setAttribute('transform', `translate(${hoverMidX}, ${hoverMidY})`);
          copulaInd.style.cursor = 'pointer';

          const indCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          indCircle.setAttribute('r', '11');
          indCircle.setAttribute('fill', hasExistingGc ? '#ef4444' : 'var(--color-accent, #6B4EE6)');
          indCircle.setAttribute('stroke', '#ffffff');
          indCircle.setAttribute('stroke-width', '1.5');
          copulaInd.appendChild(indCircle);

          const indText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          indText.setAttribute('text-anchor', 'middle');
          indText.setAttribute('dominant-baseline', 'central');
          indText.setAttribute('fill', '#ffffff');
          indText.setAttribute('font-size', '12');
          indText.setAttribute('font-weight', '700');
          indText.textContent = hasExistingGc ? '×' : '+';
          copulaInd.appendChild(indText);

          copulaInd.addEventListener('click', (e) => {
            e.stopPropagation();
            handleCopulaOnEdge(edge);
          });
          edgesLayer.appendChild(copulaInd);
        }
      }

      // In Quadratic mode: display click indicator icon on structural paths
      if (mode === 'quadratic') {
        const isEligible = source.isLatent && !source.isText && target.isLatent && !target.isText && !source.label?.includes(' x ') && !source.isInteraction;
        if (!isEligible) {
          clickPath.style.cursor = 'not-allowed';
          clickPath.setAttribute('title', 'Quadratic effect cannot be added: path must connect standard latent constructs');
        } else {
          clickPath.style.cursor = 'pointer';
          const hasExistingQe = quadraticEffects.some(qe => (qe.predictor_construct === edge.sourceId || qe.predictor === edge.sourceId || qe.source === edge.sourceId) && (qe.target_construct === edge.targetId || qe.target === edge.targetId));
          const hoverMidX = (x1 + x2) / 2;
          const hoverMidY = (y1 + y2) / 2;

          const quadInd = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          quadInd.setAttribute('class', 'quadratic-hover-indicator');
          quadInd.setAttribute('transform', `translate(${hoverMidX}, ${hoverMidY})`);
          quadInd.style.cursor = 'pointer';

          const indCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          indCircle.setAttribute('r', '11');
          indCircle.setAttribute('fill', hasExistingQe ? '#ef4444' : '#10b981');
          indCircle.setAttribute('stroke', '#ffffff');
          indCircle.setAttribute('stroke-width', '1.5');
          quadInd.appendChild(indCircle);

          const indText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          indText.setAttribute('text-anchor', 'middle');
          indText.setAttribute('dominant-baseline', 'central');
          indText.setAttribute('fill', '#ffffff');
          indText.setAttribute('font-size', '10');
          indText.setAttribute('font-weight', '700');
          indText.textContent = hasExistingQe ? '−' : 'x²';
          quadInd.appendChild(indText);

          quadInd.addEventListener('click', (ev) => {
            ev.stopPropagation();
            handleQuadraticOnEdge(edge);
          });
          edgesLayer.appendChild(quadInd);
        }
      }

      // Structural path coefficient badge (between latent variables)
      const coef = getPathCoefficient(source, target);
      if (coef !== null && coef !== undefined) {
        const isModerated = moderatingEffects.some(m => m.source === edge.sourceId && m.target === edge.targetId);
        const hasGc = gaussianCopulas.some(gc => (gc.source_construct === edge.sourceId || gc.source === edge.sourceId) && (gc.target_construct === edge.targetId || gc.target === edge.targetId));
        const hasQe = quadraticEffects.some(qe => (qe.predictor_construct === edge.sourceId || qe.predictor === edge.sourceId || qe.source === edge.sourceId) && (qe.target_construct === edge.targetId || qe.target === edge.targetId));
        let midX = (x1 + x2) / 2;
        let midY = (y1 + y2) / 2;

        if (isModerated || hasGc || hasQe) {
          // Position at 32% (or 25% if multiple) from source along path so landing dots at midpoint do not cover it
          const countAttached = (isModerated ? 1 : 0) + (hasGc ? 1 : 0) + (hasQe ? 1 : 0);
          const t = countAttached > 1 ? 0.25 : 0.32;
          if (edge.waypoints && edge.waypoints.length > 0) {
            const pts = [{ x: x1, y: y1 }, ...edge.waypoints, { x: x2, y: y2 }];
            let totalLen = 0;
            const lens = [];
            for (let i = 0; i < pts.length - 1; i++) {
              const segLen = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
              lens.push(segLen);
              totalLen += segLen;
            }
            const targetDist = totalLen * t;
            let acc = 0;
            for (let i = 0; i < lens.length; i++) {
              if (acc + lens[i] >= targetDist) {
                const rem = targetDist - acc;
                const ratio = lens[i] > 0 ? rem / lens[i] : 0;
                midX = pts[i].x + ratio * (pts[i + 1].x - pts[i].x);
                midY = pts[i].y + ratio * (pts[i + 1].y - pts[i].y);
                break;
              }
              acc += lens[i];
            }
          } else if (edge.curved) {
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const curveVal = typeof edge.curvature === 'number' ? edge.curvature : 40;
            const cx = mx + (-dy / len) * curveVal;
            const cy = my + (dx / len) * curveVal;
            const invT = 1 - t;
            midX = invT * invT * x1 + 2 * invT * t * cx + t * t * x2;
            midY = invT * invT * y1 + 2 * invT * t * cy + t * t * y2;
          } else {
            midX = x1 + t * (x2 - x1);
            midY = y1 + t * (y2 - y1);
          }
        } else {
          if (edge.waypoints && edge.waypoints.length > 0) {
            const numJoints = edge.waypoints.length;
            if (numJoints % 2 === 1) {
              const midIdx = Math.floor(numJoints / 2);
              midX = edge.waypoints[midIdx].x;
              midY = edge.waypoints[midIdx].y;
            } else {
              const idx1 = numJoints / 2 - 1;
              const idx2 = numJoints / 2;
              midX = (edge.waypoints[idx1].x + edge.waypoints[idx2].x) / 2;
              midY = (edge.waypoints[idx1].y + edge.waypoints[idx2].y) / 2;
            }
          } else if (edge.curved) {
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const curveVal = typeof edge.curvature === 'number' ? edge.curvature : 40;
            const cx = mx + (-dy / len) * curveVal;
            const cy = my + (dx / len) * curveVal;
            midX = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
            midY = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
          } else {
            const badgeKey = edge.id || `${edge.sourceId}->${edge.targetId}`;
            const bPos = badgePosMap.get(badgeKey);
            if (bPos) {
              midX = bPos.x;
              midY = bPos.y;
            } else {
              midX = (x1 + x2) / 2;
              midY = (y1 + y2) / 2;
            }
          }
        }

        const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        badgeG.setAttribute('class', 'edge-result-badge');
        badgeG.setAttribute('transform', `translate(${midX}, ${midY})`);
        badgeG.setAttribute('pointer-events', 'none');

        const textVal = formatCanvasNumber(coef);
        const pillW = Math.max(34, textVal.length * 7.5 + 10);
        const pillH = 18;

        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', -pillW / 2);
        bg.setAttribute('y', -pillH / 2);
        bg.setAttribute('width', pillW);
        bg.setAttribute('height', pillH);
        bg.setAttribute('rx', '4');
        bg.setAttribute('fill', 'var(--canvas-badge-bg)');
        bg.style.fill = 'var(--canvas-badge-bg)';
        bg.setAttribute('stroke', selectedIds.has(edge.id) ? 'var(--color-accent)' : 'var(--canvas-badge-border)');
        bg.style.stroke = selectedIds.has(edge.id) ? 'var(--color-accent)' : 'var(--canvas-badge-border)';
        bg.setAttribute('stroke-width', '1');
        badgeG.appendChild(bg);

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('dominant-baseline', 'central');
        txt.setAttribute('font-size', '10.5');
        txt.setAttribute('font-family', 'var(--font-mono)');
        txt.setAttribute('font-weight', '600');
        txt.setAttribute('fill', 'var(--canvas-badge-text)');
        txt.style.fill = 'var(--canvas-badge-text)';
        txt.textContent = textVal;
        badgeG.appendChild(txt);

        edgesLayer.appendChild(badgeG);
      }
      
      
      // Draw handles if selected
      if (selectedIds.has(edge.id)) {
        if (edge.curved) {
          const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy) || 1;
          const curvature = typeof edge.curvature === 'number' ? edge.curvature : 40;
          const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          handle.setAttribute('cx', (x1 + x2) / 2 - dy / length * curvature / 2);
          handle.setAttribute('cy', (y1 + y2) / 2 + dx / length * curvature / 2);
          handle.setAttribute('r', 5);
          handle.setAttribute('fill', 'var(--color-accent, #6B4EE6)');
          handle.setAttribute('data-export-ui', 'true');
          handle.style.cursor = 'move';
          handle.addEventListener('mousedown', (event) => { if (event.button === 0) { event.stopPropagation(); draggingCurve = edge; } });
          edgesLayer.appendChild(handle);
        }
        if (!edge.curved && edge.waypoints) {
          edge.waypoints.forEach((wp, idx) => {
            const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            handle.setAttribute('cx', wp.x);
            handle.setAttribute('cy', wp.y);
            handle.setAttribute('r', 5);
            handle.setAttribute('fill', 'var(--color-accent, #6B4EE6)');
            handle.style.cursor = 'move';
            
            handle.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              draggingWaypoint = { edge, idx };
            });
            edgesLayer.appendChild(handle);
          });
        }
        
        if (!edge.curved) {
          const pts = [{x: x1, y: y1}, ...(edge.waypoints || []), {x: x2, y: y2}];
          for (let i = 0; i < pts.length - 1; i++) {
            const midX = (pts[i].x + pts[i+1].x) / 2;
            const midY = (pts[i].y + pts[i+1].y) / 2;
            const midHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            midHandle.setAttribute('cx', midX);
            midHandle.setAttribute('cy', midY);
            midHandle.setAttribute('r', 5);
            midHandle.setAttribute('fill', 'rgba(168,85,247,0.8)');
            midHandle.style.cursor = 'crosshair';
            
            midHandle.addEventListener('mousedown', (e) => {
               e.stopPropagation();
               pendingWaypoint = { edge, idx: i, midX, midY };
            });
            edgesLayer.appendChild(midHandle);
          }
        }
      }
    });

    // Render Moderating Effects (SmartPLS 4 style dashed lines ending at midpoint of target path with dot)
    const pathModMap = new Map();
    moderatingEffects.forEach(mod => {
      const key = `${mod.source}->${mod.target}`;
      if (!pathModMap.has(key)) pathModMap.set(key, []);
      pathModMap.get(key).push(mod);
    });

    const moderationBadgesToRender = [];

    moderatingEffects.forEach(mod => {
      const geo = getModerationLineGeometry(mod);
      if (!geo) return;
      const { startX, startY, landX: mx, landY: my } = geo;

      const isSelected = selectedIds.has(mod.id);
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const defModColor = isDark ? '#cbd5e1' : 'rgba(107, 78, 230, 0.75)';
      const effectiveModColor = mod.color || defModColor;

      if (isSelected) {
        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        halo.setAttribute('d', geo.path);
        halo.setAttribute('fill', 'none');
        halo.setAttribute('stroke', 'var(--color-accent, #6B4EE6)');
        halo.setAttribute('stroke-width', String((parseFloat(mod.strokeWidth || '1.5')) + 5));
        halo.setAttribute('stroke-opacity', '0.45');
        halo.setAttribute('stroke-linecap', 'round');
        edgesLayer.appendChild(halo);
      }

      // 1. Dashed line from moderator to midpoint
      const dashLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      dashLine.setAttribute('d', geo.path);
      dashLine.setAttribute('class', isSelected ? 'moderation-line selected' : 'moderation-line');
      dashLine.style.stroke = effectiveModColor;
      dashLine.style.color = effectiveModColor;
      dashLine.style.strokeWidth = mod.strokeWidth ? String(mod.strokeWidth) : '1.5';
      dashLine.style.strokeDasharray = mod.strokeDasharray !== undefined ? mod.strokeDasharray : '2 4';
      dashLine.style.fill = 'none';
      dashLine.style.cursor = 'pointer';

      const modArrow = mod.arrowhead !== undefined ? mod.arrowhead : 'open';
      if (modArrow && modArrow !== 'none') {
        const mId = getOrCreateMarker(modArrow, effectiveModColor);
        dashLine.setAttribute('marker-end', `url(#${mId})`);
      } else {
        dashLine.removeAttribute('marker-end');
      }
      edgesLayer.appendChild(dashLine);

      // 2. Landing Dot (small circle where dashed line lands on the path or parent arrow)
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', mx);
      dot.setAttribute('cy', my);
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', effectiveModColor);
      dot.setAttribute('stroke', '#ffffff');
      dot.setAttribute('stroke-width', '1.5');
      dot.style.cursor = 'pointer';
      edgesLayer.appendChild(dot);

      // 2b. If other moderations chain onto this moderation, render a midpoint dot where they connect
      const hasChildren = moderatingEffects.some(m => m.attachToModId === mod.id);
      const midDotX = geo.midX;
      const midDotY = geo.midY;

      const midDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      midDot.setAttribute('cx', midDotX);
      midDot.setAttribute('cy', midDotY);
      midDot.setAttribute('r', hasChildren ? '5' : '4');
      midDot.setAttribute('fill', hasChildren ? effectiveModColor : (isDark ? '#1e293b' : '#ffffff'));
      midDot.setAttribute('stroke', effectiveModColor);
      midDot.setAttribute('stroke-width', '1.5');
      if (!hasChildren) midDot.setAttribute('stroke-dasharray', '2 2');
      midDot.style.cursor = 'pointer';
      edgesLayer.appendChild(midDot);

      // 3. Invisible wide clickable hit-target for moderation line and dot
      const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitPath.setAttribute('d', geo.path);
      hitPath.style.stroke = 'rgba(0,0,0,0.001)';
      hitPath.style.strokeWidth = '32';
      hitPath.style.fill = 'none';
      hitPath.style.cursor = 'pointer';

      const handleModClick = (e) => {
        e.stopPropagation();
        if (mode === 'erase') {
          selectedIds.clear();
          selectedIds.add(mod.id);
          deleteSelected();
          return;
        }
        if (mode === 'moderation') {
          handleModerationOnMod(mod);
          return;
        }
        if (mode === 'connect' && connectStartNode) {
          handleModerationOnMod(mod, connectStartNode);
          cancelTempConnecting();
          return;
        }
        if (mode === 'select') {
          if (!e.shiftKey) clearSelection();
          selectedIds.add(mod.id);
          render();
        }
      };

      hitPath.addEventListener('click', handleModClick);
      dot.addEventListener('click', handleModClick);
      midDot.addEventListener('click', handleModClick);
      hitPath.addEventListener('contextmenu', (e) => showContextMenu(e, mod.id));
      dot.addEventListener('contextmenu', (e) => showContextMenu(e, mod.id));
      edgesLayer.appendChild(hitPath);
      if (isSelected) {
        if (mod.curved) {
          const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          handle.setAttribute('cx', geo.midX); handle.setAttribute('cy', geo.midY); handle.setAttribute('r', 5);
          handle.setAttribute('fill', 'var(--color-accent, #6B4EE6)'); handle.setAttribute('data-export-ui', 'true');
          handle.style.cursor = 'move';
          handle.addEventListener('mousedown', event => { if (event.button === 0) { event.stopPropagation(); draggingCurve = mod; } });
          edgesLayer.appendChild(handle);
        } else {
          (mod.waypoints || []).forEach((point, index) => {
            const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            handle.setAttribute('cx', point.x); handle.setAttribute('cy', point.y); handle.setAttribute('r', 5);
            handle.setAttribute('fill', 'var(--color-accent, #6B4EE6)'); handle.setAttribute('data-export-ui', 'true');
            handle.style.cursor = 'move';
            handle.addEventListener('mousedown', event => { if (event.button === 0) { event.stopPropagation(); draggingWaypoint = { edge: mod, idx: index }; } });
            edgesLayer.appendChild(handle);
          });
          const points = [{ x: startX, y: startY }, ...(mod.waypoints || []), { x: mx, y: my }];
          points.slice(1).forEach((point, index) => {
            const midX = (points[index].x + point.x) / 2, midY = (points[index].y + point.y) / 2;
            const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            handle.setAttribute('cx', midX); handle.setAttribute('cy', midY); handle.setAttribute('r', 5);
            handle.setAttribute('fill', 'rgba(168,85,247,0.8)'); handle.setAttribute('data-export-ui', 'true');
            handle.style.cursor = 'crosshair';
            handle.addEventListener('mousedown', event => { if (event.button === 0) { event.stopPropagation(); pendingWaypoint = { edge: mod, idx: index, midX, midY }; } });
            edgesLayer.appendChild(handle);
          });
        }
      }

      // 4. Collect moderation path coefficient badge to render in top pass
      const modDetails = getModerationDetails(mod);
      if (modDetails && modDetails.beta !== null && modDetails.beta !== undefined) {
        moderationBadgesToRender.push({
          mod,
          modDetails,
          startX,
          startY,
          mx,
          my,
          isSelected,
          handleModClick,
          hitPath
        });
      }
    });

    // Render all moderation path coefficient badges on top, offset to 35% from moderator construct
    // so the midpoint connection dot at 50% does not cover the values (just like normal path arrows)
    moderationBadgesToRender.forEach(({
      mod,
      modDetails,
      startX,
      startY,
      mx,
      my,
      isSelected,
      handleModClick,
      hitPath
    }) => {
      // Position at 35% from moderator construct along the moderation arrow so midpoint connection dot at 50% does not cover it
      const t = 0.35;
      const badgeX = startX + t * (mx - startX);
      const badgeY = startY + t * (my - startY);

      const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      badgeG.setAttribute('class', 'edge-result-badge moderation-badge');
      badgeG.setAttribute('transform', `translate(${badgeX}, ${badgeY})`);
      badgeG.setAttribute('pointer-events', 'auto');
      badgeG.style.cursor = 'pointer';

      const textVal = formatCanvasNumber(modDetails.beta);
      const pillW = Math.max(34, textVal.length * 7.5 + 10);
      const pillH = 18;

      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', -pillW / 2);
      bg.setAttribute('y', -pillH / 2);
      bg.setAttribute('width', pillW);
      bg.setAttribute('height', pillH);
      bg.setAttribute('rx', '4');
      bg.setAttribute('fill', 'var(--canvas-badge-bg)');
      bg.style.fill = 'var(--canvas-badge-bg)';
      bg.setAttribute('stroke', isSelected ? 'var(--color-accent)' : 'rgba(107, 78, 230, 0.7)');
      bg.style.stroke = isSelected ? 'var(--color-accent)' : 'rgba(107, 78, 230, 0.7)';
      bg.setAttribute('stroke-width', isSelected ? '1.5' : '1');
      badgeG.appendChild(bg);

      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('dominant-baseline', 'central');
      txt.setAttribute('font-size', '10.5');
      txt.setAttribute('font-family', 'var(--font-mono, monospace)');
      txt.setAttribute('font-weight', '600');
      txt.setAttribute('fill', 'var(--canvas-badge-text)');
      txt.style.fill = 'var(--canvas-badge-text)';
      txt.textContent = textVal;
      badgeG.appendChild(txt);

      let tooltipText = `${modDetails.term} → ${modDetails.target}: β = ${formatCanvasNumber(modDetails.beta)}`;
      if (modDetails.t !== null) tooltipText += `, t = ${formatCanvasNumber(modDetails.t)}`;
      if (modDetails.p !== null) tooltipText += `, ${formatCanvasPEq(modDetails.p)}`;

      const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titleEl.textContent = tooltipText;
      badgeG.appendChild(titleEl);

      const lineTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      lineTitle.textContent = tooltipText;
      hitPath.appendChild(lineTitle);

      badgeG.addEventListener('click', handleModClick);
      edgesLayer.appendChild(badgeG);
    });

    // Render Gaussian Copulas (SmartPLS 4 style: small circle 'GC' with dotted line to path midpoint)
    const copulaBadgesToRender = [];

    gaussianCopulas.forEach(gc => {
      const geo = getGaussianCopulaGeometry(gc);
      if (!geo) return;
      const { nodeX, nodeY, gcRadius, startX, startY, landX, landY } = geo;

      const isSelected = selectedIds.has(gc.id);
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const defGcColor = isDark ? '#e2e8f0' : '#334155';

      if (isSelected) {
        const haloLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        haloLine.setAttribute('d', `M ${startX} ${startY} L ${landX} ${landY}`);
        haloLine.setAttribute('fill', 'none');
        haloLine.setAttribute('stroke', 'var(--color-accent, #6B4EE6)');
        haloLine.setAttribute('stroke-width', '6.5');
        haloLine.setAttribute('stroke-opacity', '0.45');
        haloLine.setAttribute('stroke-linecap', 'round');
        edgesLayer.appendChild(haloLine);

        const haloNode = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        haloNode.setAttribute('cx', nodeX);
        haloNode.setAttribute('cy', nodeY);
        haloNode.setAttribute('r', String(gcRadius + 4));
        haloNode.setAttribute('fill', 'none');
        haloNode.setAttribute('stroke', 'var(--color-accent, #6B4EE6)');
        haloNode.setAttribute('stroke-width', '3');
        haloNode.setAttribute('stroke-opacity', '0.6');
        edgesLayer.appendChild(haloNode);
      }

      // 1. Dotted line from GC node to path midpoint
      const dotLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      dotLine.setAttribute('d', `M ${startX} ${startY} L ${landX} ${landY}`);
      dotLine.setAttribute('class', isSelected ? 'copula-line selected' : 'copula-line');
      dotLine.style.stroke = defGcColor;
      dotLine.style.strokeWidth = '1.5';
      dotLine.style.strokeDasharray = '2 4';
      dotLine.style.fill = 'none';
      dotLine.style.cursor = 'pointer';
      edgesLayer.appendChild(dotLine);

      // 2. Landing dot on the path midpoint
      const landDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      landDot.setAttribute('cx', landX);
      landDot.setAttribute('cy', landY);
      landDot.setAttribute('r', '4');
      landDot.setAttribute('fill', defGcColor);
      landDot.setAttribute('stroke', '#ffffff');
      landDot.setAttribute('stroke-width', '1.5');
      landDot.style.cursor = 'pointer';
      edgesLayer.appendChild(landDot);

      // 3. Wide invisible hit path for line & landing dot
      const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitPath.setAttribute('d', `M ${startX} ${startY} L ${landX} ${landY}`);
      hitPath.style.stroke = 'rgba(0,0,0,0.001)';
      hitPath.style.strokeWidth = '24';
      hitPath.style.fill = 'none';
      hitPath.style.cursor = 'pointer';

      const handleGcClick = (e) => {
        e.stopPropagation();
        if (mode === 'erase') {
          selectedIds.clear();
          selectedIds.add(gc.id);
          deleteSelected();
          return;
        }
        if (mode === 'select' || mode === 'copula') {
          if (!e.shiftKey) clearSelection();
          selectedIds.add(gc.id);
          render();
        }
      };

      hitPath.addEventListener('click', handleGcClick);
      landDot.addEventListener('click', handleGcClick);
      hitPath.addEventListener('contextmenu', (e) => showContextMenu(e, gc.id));
      landDot.addEventListener('contextmenu', (e) => showContextMenu(e, gc.id));
      edgesLayer.appendChild(hitPath);

      // 4. GC Node Circle
      const gcGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      gcGroup.setAttribute('class', isSelected ? 'copula-node selected' : 'copula-node');
      gcGroup.style.cursor = 'move';

      const gcCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      gcCircle.setAttribute('cx', nodeX);
      gcCircle.setAttribute('cy', nodeY);
      gcCircle.setAttribute('r', String(gcRadius));
      gcCircle.setAttribute('fill', isDark ? '#0f172a' : '#1e293b');
      gcCircle.setAttribute('stroke', isSelected ? 'var(--color-accent, #6B4EE6)' : '#ffffff');
      gcCircle.setAttribute('stroke-width', '2');
      gcGroup.appendChild(gcCircle);

      const gcText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      gcText.setAttribute('x', nodeX);
      gcText.setAttribute('y', nodeY);
      gcText.setAttribute('text-anchor', 'middle');
      gcText.setAttribute('dominant-baseline', 'central');
      gcText.setAttribute('fill', '#ffffff');
      gcText.setAttribute('font-size', '11');
      gcText.setAttribute('font-weight', '700');
      gcText.setAttribute('font-family', 'var(--font-sans, system-ui)');
      gcText.setAttribute('pointer-events', 'none');
      gcText.textContent = 'GC';
      gcGroup.appendChild(gcText);

      // Mouse drag handler for GC node
      gcCircle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
        draggingGC = {
          gc,
          offsetX: svgPt.x - nodeX,
          offsetY: svgPt.y - nodeY
        };
        if (!e.shiftKey && !selectedIds.has(gc.id)) {
          clearSelection();
        }
        selectedIds.add(gc.id);
        render();
      });

      gcCircle.addEventListener('click', handleGcClick);
      gcCircle.addEventListener('contextmenu', (e) => showContextMenu(e, gc.id));
      edgesLayer.appendChild(gcGroup);

      // 5. Collect result badge for GC dotted line
      const gcDetails = getGaussianCopulaDetails(gc);
      if (gcDetails && gcDetails.beta !== null && gcDetails.beta !== undefined) {
        copulaBadgesToRender.push({
          gc,
          gcDetails,
          badgeX: (startX + landX) / 2,
          badgeY: (startY + landY) / 2,
          isSelected,
          handleGcClick,
          hitPath
        });
      }
    });

    // Render GC badges on top
    copulaBadgesToRender.forEach(({
      gc,
      gcDetails,
      badgeX,
      badgeY,
      isSelected,
      handleGcClick,
      hitPath
    }) => {
      const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      badgeG.setAttribute('class', 'edge-result-badge copula-badge');
      badgeG.setAttribute('transform', `translate(${badgeX}, ${badgeY})`);
      badgeG.setAttribute('pointer-events', 'auto');
      badgeG.style.cursor = 'pointer';

      const textVal = formatCanvasNumber(gcDetails.beta);
      const pillW = Math.max(34, textVal.length * 7.5 + 10);
      const pillH = 18;

      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', -pillW / 2);
      bg.setAttribute('y', -pillH / 2);
      bg.setAttribute('width', pillW);
      bg.setAttribute('height', pillH);
      bg.setAttribute('rx', '4');
      bg.setAttribute('fill', 'var(--canvas-badge-bg)');
      bg.style.fill = 'var(--canvas-badge-bg)';
      bg.setAttribute('stroke', isSelected ? 'var(--color-accent)' : 'var(--canvas-badge-border)');
      bg.style.stroke = isSelected ? 'var(--color-accent)' : 'var(--canvas-badge-border)';
      bg.setAttribute('stroke-width', '1');
      badgeG.appendChild(bg);

      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('dominant-baseline', 'central');
      txt.setAttribute('font-size', '10.5');
      txt.setAttribute('font-family', 'var(--font-mono, monospace)');
      txt.setAttribute('font-weight', '600');
      txt.setAttribute('fill', 'var(--canvas-badge-text)');
      txt.style.fill = 'var(--canvas-badge-text)';
      txt.textContent = textVal;
      badgeG.appendChild(txt);

      let tooltipText = `${gcDetails.term} → ${gcDetails.target}: β = ${formatCanvasNumber(gcDetails.beta)}`;
      if (gcDetails.t !== null && gcDetails.t !== undefined) tooltipText += `, t = ${formatCanvasNumber(gcDetails.t)}`;
      if (gcDetails.p !== null && gcDetails.p !== undefined) tooltipText += `, ${formatCanvasPEq(gcDetails.p)}`;

      const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titleEl.textContent = tooltipText;
      badgeG.appendChild(titleEl);

      const lineTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      lineTitle.textContent = tooltipText;
      hitPath.appendChild(lineTitle);

      badgeG.addEventListener('click', handleGcClick);
      edgesLayer.appendChild(badgeG);
    });

    // Render Quadratic Effects
    const quadBadgesToRender = [];

    quadraticEffects.forEach(qe => {
      const geo = getQuadraticEffectGeometry(qe);
      if (!geo) return;
      const { pNode, tNode, nodeX, nodeY, qeRadius, startX, startY, landX, landY, arcStartX, arcStartY, arcMidX, arcMidY, badgeX, badgeY } = geo;
      const isSelected = selectedIds.has(qe.id);
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

      const handleQeClick = (e) => {
        e.stopPropagation();
        if (mode === 'erase') {
          selectedIds.clear();
          selectedIds.add(qe.id);
          deleteSelected();
          return;
        }
        if (!e.shiftKey) clearSelection();
        selectedIds.add(qe.id);
        render();
      };

      if (!activeResults) {
        // --- EDITOR MODE: Curved arc from predictor to path midpoint with x² badge ---
        if (isSelected) {
          const halo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          halo.setAttribute('d', `M ${arcStartX} ${arcStartY} Q ${arcMidX} ${arcMidY} ${landX} ${landY}`);
          halo.setAttribute('fill', 'none');
          halo.setAttribute('stroke', '#10b981');
          halo.setAttribute('stroke-width', '6.5');
          halo.setAttribute('stroke-opacity', '0.35');
          halo.setAttribute('stroke-linecap', 'round');
          edgesLayer.appendChild(halo);
        }

        const arcPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        arcPath.setAttribute('d', `M ${arcStartX} ${arcStartY} Q ${arcMidX} ${arcMidY} ${landX} ${landY}`);
        arcPath.setAttribute('fill', 'none');
        arcPath.setAttribute('stroke', '#10b981');
        arcPath.setAttribute('stroke-width', '1.8');
        arcPath.setAttribute('stroke-dasharray', '5 4');
        edgesLayer.appendChild(arcPath);

        const landDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        landDot.setAttribute('cx', landX);
        landDot.setAttribute('cy', landY);
        landDot.setAttribute('r', '3.5');
        landDot.setAttribute('fill', '#10b981');
        edgesLayer.appendChild(landDot);

        // Clickable hit area
        const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitPath.setAttribute('d', `M ${arcStartX} ${arcStartY} Q ${arcMidX} ${arcMidY} ${landX} ${landY}`);
        hitPath.setAttribute('fill', 'none');
        hitPath.setAttribute('stroke', 'rgba(0,0,0,0.01)');
        hitPath.setAttribute('stroke-width', '16');
        hitPath.style.cursor = 'pointer';
        hitPath.addEventListener('click', handleQeClick);
        hitPath.addEventListener('contextmenu', (e) => showContextMenu(e, qe.id));
        edgesLayer.appendChild(hitPath);

        // Badge with x²
        const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        badgeG.setAttribute('transform', `translate(${badgeX}, ${badgeY})`);
        badgeG.style.cursor = 'pointer';

        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', '-12');
        bg.setAttribute('y', '-9');
        bg.setAttribute('width', '24');
        bg.setAttribute('height', '18');
        bg.setAttribute('rx', '4');
        bg.setAttribute('fill', isDark ? '#064e3b' : '#ecfdf5');
        bg.setAttribute('stroke', isSelected ? 'var(--color-accent, #6B4EE6)' : '#10b981');
        bg.setAttribute('stroke-width', isSelected ? '2' : '1.2');
        badgeG.appendChild(bg);

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('dominant-baseline', 'central');
        txt.setAttribute('font-size', '11');
        txt.setAttribute('font-weight', '700');
        txt.setAttribute('fill', isDark ? '#a7f3d0' : '#059669');
        txt.textContent = 'x²';
        badgeG.appendChild(txt);

        badgeG.addEventListener('click', handleQeClick);
        badgeG.addEventListener('contextmenu', (e) => showContextMenu(e, qe.id));
        edgesLayer.appendChild(badgeG);
      } else {
        // --- RESULTS MODE: SmartPLS 4 style green circle construct labeled '{P} x / {P}' with dashed line ---
        if (isSelected) {
          const haloLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          haloLine.setAttribute('d', `M ${startX} ${startY} L ${landX} ${landY}`);
          haloLine.setAttribute('fill', 'none');
          haloLine.setAttribute('stroke', '#10b981');
          haloLine.setAttribute('stroke-width', '6.5');
          haloLine.setAttribute('stroke-opacity', '0.45');
          haloLine.setAttribute('stroke-linecap', 'round');
          edgesLayer.appendChild(haloLine);

          const haloNode = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          haloNode.setAttribute('cx', nodeX);
          haloNode.setAttribute('cy', nodeY);
          haloNode.setAttribute('r', String(qeRadius + 4));
          haloNode.setAttribute('fill', 'none');
          haloNode.setAttribute('stroke', '#10b981');
          haloNode.setAttribute('stroke-width', '3');
          haloNode.setAttribute('stroke-opacity', '0.6');
          edgesLayer.appendChild(haloNode);
        }

        // Dashed line from circle to path midpoint
        const dotLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        dotLine.setAttribute('d', `M ${startX} ${startY} L ${landX} ${landY}`);
        dotLine.setAttribute('class', isSelected ? 'quadratic-line selected' : 'quadratic-line');
        dotLine.style.stroke = '#10b981';
        dotLine.style.strokeWidth = '1.8';
        dotLine.style.strokeDasharray = '4 4';
        dotLine.style.fill = 'none';
        dotLine.style.cursor = 'pointer';
        edgesLayer.appendChild(dotLine);

        // Landing dot on the path midpoint
        const landDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        landDot.setAttribute('cx', landX);
        landDot.setAttribute('cy', landY);
        landDot.setAttribute('r', '4');
        landDot.setAttribute('fill', '#10b981');
        edgesLayer.appendChild(landDot);

        // Hit path
        const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitPath.setAttribute('d', `M ${startX} ${startY} L ${landX} ${landY}`);
        hitPath.style.stroke = 'rgba(0,0,0,0.01)';
        hitPath.style.strokeWidth = '16';
        hitPath.style.fill = 'none';
        hitPath.style.cursor = 'pointer';
        hitPath.addEventListener('click', handleQeClick);
        hitPath.addEventListener('contextmenu', (e) => showContextMenu(e, qe.id));
        edgesLayer.appendChild(hitPath);

        // Circle node group (draggable)
        const qeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        qeGroup.setAttribute('class', 'quadratic-node-group');
        qeGroup.style.cursor = 'move';

        const qeCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        qeCircle.setAttribute('cx', nodeX);
        qeCircle.setAttribute('cy', nodeY);
        qeCircle.setAttribute('r', String(qeRadius));
        qeCircle.setAttribute('fill', isDark ? '#064e3b' : '#ecfdf5');
        qeCircle.setAttribute('stroke', isSelected ? 'var(--color-accent, #6B4EE6)' : '#10b981');
        qeCircle.setAttribute('stroke-width', '2.5');
        qeGroup.appendChild(qeCircle);

        const qeText1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        qeText1.setAttribute('x', nodeX);
        qeText1.setAttribute('y', nodeY - 6);
        qeText1.setAttribute('text-anchor', 'middle');
        qeText1.setAttribute('dominant-baseline', 'central');
        qeText1.setAttribute('fill', isDark ? '#a7f3d0' : '#065f46');
        qeText1.setAttribute('font-size', '10.5');
        qeText1.setAttribute('font-weight', '700');
        qeText1.setAttribute('font-family', 'var(--font-sans, system-ui)');
        qeText1.setAttribute('pointer-events', 'none');
        qeText1.textContent = `${pNode.label} x`;
        qeGroup.appendChild(qeText1);

        const qeText2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        qeText2.setAttribute('x', nodeX);
        qeText2.setAttribute('y', nodeY + 8);
        qeText2.setAttribute('text-anchor', 'middle');
        qeText2.setAttribute('dominant-baseline', 'central');
        qeText2.setAttribute('fill', isDark ? '#a7f3d0' : '#065f46');
        qeText2.setAttribute('font-size', '10.5');
        qeText2.setAttribute('font-weight', '700');
        qeText2.setAttribute('font-family', 'var(--font-sans, system-ui)');
        qeText2.setAttribute('pointer-events', 'none');
        qeText2.textContent = `${pNode.label}`;
        qeGroup.appendChild(qeText2);

        // Mouse drag handler for Quadratic node
        qeCircle.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();
          const pt = svg.createSVGPoint();
          pt.x = e.clientX;
          pt.y = e.clientY;
          const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
          draggingQE = {
            qe,
            offsetX: svgPt.x - nodeX,
            offsetY: svgPt.y - nodeY
          };
          if (!e.shiftKey && !selectedIds.has(qe.id)) {
            clearSelection();
          }
          selectedIds.add(qe.id);
          render();
        });

        qeCircle.addEventListener('click', handleQeClick);
        qeCircle.addEventListener('contextmenu', (e) => showContextMenu(e, qe.id));
        edgesLayer.appendChild(qeGroup);

        // Collect result badge for Quadratic dashed line
        const qeDetails = getQuadraticEffectDetails(qe);
        if (qeDetails && qeDetails.beta !== null && qeDetails.beta !== undefined) {
          quadBadgesToRender.push({
            qe,
            qeDetails,
            badgeX: (startX + landX) / 2,
            badgeY: (startY + landY) / 2,
            isSelected,
            handleQeClick,
            hitPath
          });
        }
      }
    });

    // Render Quadratic badges on top
    quadBadgesToRender.forEach(({
      qe,
      qeDetails,
      badgeX,
      badgeY,
      isSelected,
      handleQeClick,
      hitPath
    }) => {
      const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      badgeG.setAttribute('class', 'edge-result-badge quadratic-badge');
      badgeG.setAttribute('transform', `translate(${badgeX}, ${badgeY})`);
      badgeG.setAttribute('pointer-events', 'auto');
      badgeG.style.cursor = 'pointer';

      const textVal = formatCanvasNumber(qeDetails.beta);
      const pillW = Math.max(34, textVal.length * 7.5 + 10);
      const pillH = 18;

      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', -pillW / 2);
      bg.setAttribute('y', -pillH / 2);
      bg.setAttribute('width', pillW);
      bg.setAttribute('height', pillH);
      bg.setAttribute('rx', '4');
      bg.setAttribute('fill', 'var(--canvas-badge-bg)');
      bg.style.fill = 'var(--canvas-badge-bg)';
      bg.setAttribute('stroke', isSelected ? 'var(--color-accent)' : '#10b981');
      bg.style.stroke = isSelected ? 'var(--color-accent)' : '#10b981';
      bg.setAttribute('stroke-width', '1.5');
      badgeG.appendChild(bg);

      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('dominant-baseline', 'central');
      txt.setAttribute('font-size', '10.5');
      txt.setAttribute('font-family', 'var(--font-mono, monospace)');
      txt.setAttribute('font-weight', '700');
      txt.setAttribute('fill', '#059669');
      txt.style.fill = '#059669';
      txt.textContent = textVal;
      badgeG.appendChild(txt);

      let tooltipText = `${qeDetails.term} → ${qeDetails.target}: β = ${formatCanvasNumber(qeDetails.beta)}`;
      if (qeDetails.t !== null && qeDetails.t !== undefined) tooltipText += `, t = ${formatCanvasNumber(qeDetails.t)}`;
      if (qeDetails.p !== null && qeDetails.p !== undefined) tooltipText += `, ${formatCanvasPEq(qeDetails.p)}`;

      const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titleEl.textContent = tooltipText;
      badgeG.appendChild(titleEl);

      const lineTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      lineTitle.textContent = tooltipText;
      hitPath.appendChild(lineTitle);

      badgeG.addEventListener('click', handleQeClick);
      edgesLayer.appendChild(badgeG);
    });

    // Nodes
    nodes.forEach(node => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      g.setAttribute('class', 'construct-node');
      g.setAttribute('data-id', node.id);
      g.setAttribute('pointer-events', 'all');
      g.style.pointerEvents = 'all';
      g.style.cursor = mode === 'select' ? 'move' : (mode === 'connect' ? 'crosshair' : (mode === 'erase' ? 'pointer' : 'default'));

      const isSelected = selectedIds.has(node.id);

      if (node.isLatent) {
        let w = node.width || NODE_R * 2;
        let h = node.height || NODE_R * 2;
        g.appendChild(createNodeShape(node, NODE_R * 2, NODE_R * 2, 'var(--canvas-latent-fill)', 'var(--canvas-latent-stroke)', isSelected));

        // Visual indicator for pending moderator construct
        if (pendingModeratorNode && pendingModeratorNode.id === node.id) {
          const modRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          modRing.setAttribute('r', (NODE_R + 6));
          modRing.setAttribute('fill', 'none');
          modRing.setAttribute('stroke', 'var(--color-accent, #6B4EE6)');
          modRing.setAttribute('stroke-width', '2.5');
          modRing.setAttribute('stroke-dasharray', '4 4');
          g.appendChild(modRing);
        }
        
        // Selection box (Dotted shape)
        if (isSelected) {
          const gap = 8;
          const selShape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          selShape.setAttribute('x', -(w/2 + gap));
          selShape.setAttribute('y', -(h/2 + gap));
          selShape.setAttribute('width', w + gap*2);
          selShape.setAttribute('height', h + gap*2);
          selShape.setAttribute('rx', '12');
          selShape.setAttribute('fill', 'none');
          selShape.setAttribute('stroke', 'var(--color-accent, #6B4EE6)');
          selShape.setAttribute('stroke-width', '1.5');
          selShape.setAttribute('stroke-dasharray', '6 6');
          g.appendChild(selShape);
          
          // Resize handle
          const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          handle.setAttribute('x', w/2 + gap - 4);
          handle.setAttribute('y', h/2 + gap - 4);
          handle.setAttribute('width', '8');
          handle.setAttribute('height', '8');
          handle.setAttribute('fill', 'var(--color-accent, #6B4EE6)');
          handle.style.cursor = 'se-resize';
          handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            resizingNode = node;
            const pt = svg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
            resizeStartWidth = w;
            resizeStartHeight = h;
            resizeStartPt = svgPt;
          });
          g.appendChild(handle);
        }

        // Label
        const metrics = getConstructMetrics(node);
        const hasR2 = !!(metrics && metrics.r2 !== null && metrics.r2 !== undefined);
        const isTextInside = node.textInside === true;

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.textContent = node.label;
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('pointer-events', 'none');
        text.style.userSelect = 'none';
        text.style.webkitUserSelect = 'none';
        
        const textPos = node.textPosition || 'bottom';
        let labelX = 0;
        let labelY = h/2 + 24;
        let textAnchor = 'middle';

        if (isTextInside) {
          labelX = 0;
          labelY = hasR2 ? -6 : 0;
          textAnchor = 'middle';
          text.setAttribute('x', '0');
          text.setAttribute('y', String(labelY));
          if (!hasR2) {
            text.setAttribute('dominant-baseline', 'central');
          }
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('fill', node.color || 'var(--canvas-latent-text)');
          text.style.fill = node.color || 'var(--canvas-latent-text)';
        } else {
          if (textPos === 'top') {
            labelX = 0;
            labelY = -h / 2 - 12;
            textAnchor = 'middle';
          } else if (textPos === 'left') {
            labelX = -w / 2 - 12;
            labelY = 5;
            textAnchor = 'end';
          } else if (textPos === 'right') {
            labelX = w / 2 + 12;
            labelY = 5;
            textAnchor = 'start';
          } else { // 'bottom'
            labelX = 0;
            labelY = h / 2 + 24;
            textAnchor = 'middle';
          }
          text.setAttribute('x', String(labelX));
          text.setAttribute('y', String(labelY));
          text.setAttribute('text-anchor', textAnchor);
          text.setAttribute('fill', node.color || 'var(--color-text-primary)');
          text.style.fill = node.color || 'var(--color-text-primary)';
        }
        text.setAttribute('font-size', node.fontSize || '14');
        if (node.bold) text.setAttribute('font-weight', 'bold');
        else text.setAttribute('font-weight', '600');
        if (node.italic) text.setAttribute('font-style', 'italic');
        if (node.underline) text.setAttribute('text-decoration', 'underline');
        text.setAttribute('font-family', node.fontFamily || 'var(--font-sans)');
        if (node._isRenaming) {
          text.style.visibility = 'hidden';
        }
        g.appendChild(text);

        // If indicators are hidden, render a clean minimal no-background vector eye icon in purple beside the text
        if (node.indicatorsHidden) {
          const childInds = nodes.filter(n => n.parentId === node.id && !n.isLatent);
          if (childInds.length > 0 && !node._isRenaming) {
            let textLen = 0;
            try {
              textLen = text.getComputedTextLength();
            } catch (e) {}
            if (!textLen || textLen <= 0) {
              textLen = (node.label || '').length * 8.2;
            }
            const textFontSize = Number(node.fontSize) || 14;
            const visualMidY = labelY - (textFontSize * 0.36);
            const iconScale = (textFontSize * 1.15) / 24;
            const iconX = (textLen / 2) + 6;

            const hideBtn = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            hideBtn.setAttribute('class', 'canvas-hidden-indicators-icon-btn');
            hideBtn.setAttribute('transform', `translate(${iconX + 8}, ${visualMidY})`);
            hideBtn.style.cursor = 'pointer';
            hideBtn.style.pointerEvents = 'all';

            // Invisible hit rect for easy, responsive clicking without visual clutter
            const hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            hitRect.setAttribute('x', '-10');
            hitRect.setAttribute('y', '-10');
            hitRect.setAttribute('width', '20');
            hitRect.setAttribute('height', '20');
            hitRect.setAttribute('fill', 'transparent');
            hitRect.setAttribute('pointer-events', 'all');
            hideBtn.appendChild(hitRect);

            // Exact Material Symbols 'visibility' vector (from right-click menu, without dash), precisely centered
            const pathGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            pathGroup.setAttribute('transform', `scale(${iconScale}) translate(-12, -12)`);

            const eyePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            eyePath.setAttribute('d', 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z');
            eyePath.setAttribute('fill', 'var(--color-accent, #6B4EE6)');
            eyePath.setAttribute('fill-rule', 'evenodd');
            pathGroup.appendChild(eyePath);

            hideBtn.appendChild(pathGroup);

            const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            titleEl.textContent = `${childInds.length} indicators hidden. Click to show.`;
            hideBtn.appendChild(titleEl);

            hideBtn.addEventListener('mouseenter', () => {
              hideBtn.style.opacity = '0.7';
            });
            hideBtn.addEventListener('mouseleave', () => {
              hideBtn.style.opacity = '1';
            });

            // Reliable unhide logic
            const triggerUnhide = (ev) => {
              if (ev) {
                ev.stopPropagation();
                ev.preventDefault();
              }
              node.indicatorsHidden = false;
              render();
              pushHistory();
              window.dispatchEvent(new CustomEvent('canvas-changed'));
            };

            let isDownOnHide = false;
            hideBtn.addEventListener('mousedown', (ev) => {
              ev.stopPropagation();
              if (ev.button === 0) isDownOnHide = true;
            });
            hideBtn.addEventListener('mouseup', (ev) => {
              ev.stopPropagation();
              if (isDownOnHide) {
                isDownOnHide = false;
                triggerUnhide(ev);
              }
            });
            hideBtn.addEventListener('click', triggerUnhide);

            g.appendChild(hideBtn);
          }
        }

        // Display R² inside circle for endogenous latent constructs
        if (hasR2) {
          const r2Group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          r2Group.setAttribute('class', 'latent-r2-display');
          r2Group.setAttribute('pointer-events', 'none');

          const r2Val = formatCanvasNumber(metrics.r2);

          if (node.textInside === true) {
            const r2Text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            r2Text.setAttribute('text-anchor', 'middle');
            r2Text.setAttribute('dominant-baseline', 'central');
            r2Text.setAttribute('y', 14);
            r2Text.setAttribute('font-size', '10.5');
            r2Text.setAttribute('font-weight', '500');
            r2Text.setAttribute('font-family', 'var(--font-mono)');
            r2Text.setAttribute('fill', 'var(--canvas-latent-r2, #a5b4fc)');
            r2Text.style.fill = 'var(--canvas-latent-r2, #a5b4fc)';
            r2Text.textContent = `R²: ${r2Val}`;
            r2Group.appendChild(r2Text);
          } else {
            const r2Label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            r2Label.setAttribute('text-anchor', 'middle');
            r2Label.setAttribute('dominant-baseline', 'central');
            r2Label.setAttribute('y', -10);
            r2Label.setAttribute('font-size', '9');
            r2Label.setAttribute('font-weight', '600');
            r2Label.setAttribute('font-family', 'var(--font-sans)');
            r2Label.setAttribute('fill', 'var(--canvas-latent-text)');
            r2Label.style.fill = 'var(--canvas-latent-text)';
            r2Label.style.opacity = '0.85';
            r2Label.textContent = 'R²';
            r2Group.appendChild(r2Label);

            const r2Text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            r2Text.setAttribute('text-anchor', 'middle');
            r2Text.setAttribute('dominant-baseline', 'central');
            r2Text.setAttribute('y', 8);
            r2Text.setAttribute('font-size', '12.5');
            r2Text.setAttribute('font-weight', '600');
            r2Text.setAttribute('font-family', 'var(--font-mono)');
            r2Text.setAttribute('fill', 'var(--canvas-latent-text)');
            r2Text.style.fill = 'var(--canvas-latent-text)';
            r2Text.textContent = r2Val;
            r2Group.appendChild(r2Text);
          }
          g.appendChild(r2Group);
        }

        const isDisconnectedLatent = !isLatentConnectedInModel(node);
        if (isDisconnectedLatent) {
          const warnG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          warnG.setAttribute('transform', `translate(${w/2 - 4}, ${-h/2 + 4})`);
          warnG.setAttribute('pointer-events', 'auto');
          const warnCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          warnCircle.setAttribute('r', '8');
          warnCircle.setAttribute('fill', '#ef4444');
          warnCircle.setAttribute('stroke', '#ffffff');
          warnCircle.setAttribute('stroke-width', '1.5');
          const warnExcl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          warnExcl.setAttribute('text-anchor', 'middle');
          warnExcl.setAttribute('dominant-baseline', 'central');
          warnExcl.setAttribute('fill', '#ffffff');
          warnExcl.setAttribute('font-size', '10');
          warnExcl.setAttribute('font-weight', 'bold');
          warnExcl.textContent = '!';
          const warnTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          warnTitle.textContent = 'Disconnected latent variable: Not connected to any other latent variable in the model';
          warnG.appendChild(warnCircle);
          warnG.appendChild(warnExcl);
          warnG.appendChild(warnTitle);
          g.appendChild(warnG);
        }
      } else if (node.isText) {
        const rectBox = node.rectBox || {width: 100, height: 40};
        
        // Background shape for text box
        const shapeEl = createNodeShape(node, rectBox.width, rectBox.height, node.fill || 'transparent', node.stroke || 'transparent', isSelected);
        shapeEl.setAttribute('pointer-events', 'all');
        shapeEl.style.pointerEvents = 'all';
        if (!node.stroke && !isSelected) shapeEl.setAttribute('stroke', 'transparent');
        g.appendChild(shapeEl);

        // Text Note Rendering
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.textContent = node.label;

        const textAlign = node.textAlign || 'center';
        const verticalAlign = node.verticalAlign || 'middle';
        const padX = 8;
        const padY = 8;

        if (textAlign === 'left') {
          text.setAttribute('x', -rectBox.width / 2 + padX);
          text.setAttribute('text-anchor', 'start');
        } else if (textAlign === 'right') {
          text.setAttribute('x', rectBox.width / 2 - padX);
          text.setAttribute('text-anchor', 'end');
        } else if (textAlign === 'justify') {
          text.setAttribute('x', -rectBox.width / 2 + padX);
          text.setAttribute('text-anchor', 'start');
          text.setAttribute('textLength', Math.max(10, rectBox.width - padX * 2));
          text.setAttribute('lengthAdjust', 'spacing');
        } else {
          // center
          text.setAttribute('x', '0');
          text.setAttribute('text-anchor', 'middle');
        }

        const fontSizeNum = Number(node.fontSize) || 14;
        if (verticalAlign === 'top') {
          text.setAttribute('y', -rectBox.height / 2 + padY + fontSizeNum * 0.85);
          text.setAttribute('dominant-baseline', 'alphabetic');
        } else if (verticalAlign === 'bottom') {
          text.setAttribute('y', rectBox.height / 2 - padY);
          text.setAttribute('dominant-baseline', 'alphabetic');
        } else {
          // middle
          text.setAttribute('y', '0');
          text.setAttribute('dominant-baseline', 'central');
        }

        text.setAttribute('fill', node.color || 'var(--color-text-primary)');
        text.setAttribute('font-size', String(fontSizeNum));
        if (node.bold) text.setAttribute('font-weight', 'bold');
        if (node.italic) text.setAttribute('font-style', 'italic');
        if (node.underline) text.setAttribute('text-decoration', 'underline');
        text.setAttribute('font-family', node.fontFamily || 'var(--font-sans)');
        text.setAttribute('pointer-events', 'none');
        text.style.pointerEvents = 'none';
        if (node._isRenaming) text.style.visibility = 'hidden';
        g.appendChild(text);
        
        if (isSelected) {
          const gap = 8;
          const selShape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          selShape.setAttribute('x', -(rectBox.width/2 + gap));
          selShape.setAttribute('y', -(rectBox.height/2 + gap));
          selShape.setAttribute('width', rectBox.width + gap*2);
          selShape.setAttribute('height', rectBox.height + gap*2);
          selShape.setAttribute('rx', '4');
          selShape.setAttribute('fill', 'none');
          selShape.setAttribute('stroke', 'var(--color-accent, #6B4EE6)');
          selShape.setAttribute('stroke-width', '2');
          selShape.setAttribute('stroke-dasharray', '6 6');
          g.appendChild(selShape);
          
          // Resize handle
          const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          handle.setAttribute('x', rectBox.width/2 + gap - 4);
          handle.setAttribute('y', rectBox.height/2 + gap - 4);
          handle.setAttribute('width', '8');
          handle.setAttribute('height', '8');
          handle.setAttribute('fill', 'var(--color-accent, #6B4EE6)');
          handle.style.cursor = 'se-resize';
          handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            resizingNode = node;
            resizeStartWidth = rectBox.width;
            resizeStartHeight = rectBox.height;
            const pt = svg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            resizeStartPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
          });
          g.appendChild(handle);
        }
        g.appendChild(text);
      } else {
        // Indicator
        g.setAttribute('data-export-indicator', 'true');
        if (node.parentId) {
          const parent = nodes.find(n => n.id === node.parentId);
          if (parent && parent.indicatorsHidden) {
            return;
          }
        }
        const indMinW = 64;
        const indHeight = 24;
        const charW = (node.fontSize ? Number(node.fontSize) * 0.72 : 7.2);
        const autoW = Math.max(indMinW, Math.ceil((node.label || '').length * charW + 20));
        let w = Math.max(node.width || indMinW, autoW);
        node.width = w; // Automatically resize width if label length exceeds box
        let h = node.height || indHeight;
        
        const defaultFill = node.isMissingInDataset ? 'var(--canvas-missing-fill, #fef2f2)' : 'var(--canvas-manifest-fill)';
        const defaultStroke = node.isMissingInDataset ? '#ef4444' : 'var(--canvas-manifest-stroke)';
        g.appendChild(createNodeShape(node, w, h, defaultFill, defaultStroke, isSelected));

        if (isSelected) {
          const gap = 8;
          const selShape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          selShape.setAttribute('x', -(w/2 + gap));
          selShape.setAttribute('y', -(h/2 + gap));
          selShape.setAttribute('width', w + gap*2);
          selShape.setAttribute('height', h + gap*2);
          selShape.setAttribute('rx', '4');
          selShape.setAttribute('fill', 'none');
          selShape.setAttribute('stroke', node.isMissingInDataset ? '#ef4444' : 'var(--color-accent, #6B4EE6)');
          selShape.setAttribute('stroke-width', '2');
          selShape.setAttribute('stroke-dasharray', '6 6');
          g.appendChild(selShape);
          
          // Resize handle
          const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          handle.setAttribute('x', w/2 + gap - 4);
          handle.setAttribute('y', h/2 + gap - 4);
          handle.setAttribute('width', '8');
          handle.setAttribute('height', '8');
          handle.setAttribute('fill', node.isMissingInDataset ? '#ef4444' : 'var(--color-accent, #6B4EE6)');
          handle.style.cursor = 'se-resize';
          handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            resizingNode = node;
            const pt = svg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
            resizeStartWidth = w;
            resizeStartHeight = h;
            resizeStartPt = svgPt;
          });
          g.appendChild(handle);
        }
        
        const isIndInside = node.textInside !== undefined ? node.textInside : true;
        const indText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        indText.textContent = node.label;
        
        const indTextPos = node.textPosition || 'bottom';
        let indX = 0;
        let indY = 4;
        let indAnchor = 'middle';

        if (isIndInside) {
          indX = 0;
          indY = 4;
          indAnchor = 'middle';
          indText.setAttribute('fill', node.isMissingInDataset ? '#ef4444' : (node.color || 'var(--canvas-manifest-text)'));
        } else {
          if (indTextPos === 'top') {
            indX = 0;
            indY = -h / 2 - 8;
            indAnchor = 'middle';
          } else if (indTextPos === 'left') {
            indX = -w / 2 - 8;
            indY = 4;
            indAnchor = 'end';
          } else if (indTextPos === 'right') {
            indX = w / 2 + 8;
            indY = 4;
            indAnchor = 'start';
          } else { // 'bottom'
            indX = 0;
            indY = h / 2 + 14;
            indAnchor = 'middle';
          }
          indText.setAttribute('fill', node.isMissingInDataset ? '#ef4444' : (node.color || 'var(--color-text-primary)'));
        }
        indText.setAttribute('x', String(indX));
        indText.setAttribute('y', String(indY));
        indText.setAttribute('text-anchor', indAnchor);
        indText.setAttribute('font-size', node.fontSize || '10');
        if (node.bold) indText.setAttribute('font-weight', 'bold');
        if (node.italic) indText.setAttribute('font-style', 'italic');
        if (node.underline) indText.setAttribute('text-decoration', 'underline');
        indText.setAttribute('font-family', node.fontFamily || 'var(--font-mono)');
        if (node._isRenaming) indText.style.visibility = 'hidden';
        g.appendChild(indText);

        if (node.isMissingInDataset) {
          const warnBadge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          warnBadge.setAttribute('transform', `translate(${w/2 - 4}, ${-h/2 + 4})`);
          warnBadge.style.cursor = 'help';
          
          const warnCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          warnCircle.setAttribute('r', '6');
          warnCircle.setAttribute('fill', '#ef4444');
          warnCircle.setAttribute('stroke', '#ffffff');
          warnCircle.setAttribute('stroke-width', '1.2');
          
          const warnText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          warnText.textContent = '!';
          warnText.setAttribute('text-anchor', 'middle');
          warnText.setAttribute('dominant-baseline', 'central');
          warnText.setAttribute('fill', '#ffffff');
          warnText.setAttribute('font-size', '9');
          warnText.setAttribute('font-weight', 'bold');
          
          const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          titleEl.textContent = node.datasetError || `Column "${node.label}" not found in current dataset`;
          warnBadge.appendChild(titleEl);

          warnBadge.appendChild(warnCircle);
          warnBadge.appendChild(warnText);
          g.appendChild(warnBadge);
        }
        g.appendChild(indText);
        
        // Path between parent latent and this indicator
        if (node.parentId) {
          const parent = nodes.find(n => n.id === node.parentId);
          if (parent) {
            const isFormative = parent.type === 'formative';
            const indEdgeId = `edge_ind_${node.id}`;
            const indEdgeObj = {
              id: indEdgeId,
              isIndicatorEdge: true,
              indicatorNode: node,
              parentNode: parent,
              waypoints: node.edgeWaypoints || (node.edgeWaypoints = [])
            };
            const source = isFormative ? node : parent;
            const target = isFormative ? parent : node;
            const { x1, y1, x2, y2 } = getEdgeCoordinates(source, target, indEdgeObj);

            let d = `M ${x1} ${y1}`;
            if (node.edgeCurved) {
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;
              const dx = x2 - x1;
              const dy = y2 - y1;
              const len = Math.sqrt(dx*dx + dy*dy) || 1;
              const cx = mx + (-dy / len) * 30;
              const cy = my + (dx / len) * 30;
              d += ` Q ${cx} ${cy} ${x2} ${y2}`;
            } else {
              if (indEdgeObj.waypoints && indEdgeObj.waypoints.length > 0) {
                indEdgeObj.waypoints.forEach(wp => {
                  d += ` L ${wp.x} ${wp.y}`;
                });
              }
              d += ` L ${x2} ${y2}`;
            }

            const isIndEdgeSelected = selectedIds.has(indEdgeId) || isSelected;
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const defIndColor = isDark ? '#cbd5e1' : 'var(--canvas-edge-stroke)';
            const effectiveIndColor = node.edgeColor || defIndColor;

            if (isIndEdgeSelected) {
              const halo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              halo.setAttribute('data-export-indicator', 'true');
              halo.setAttribute('d', d);
              halo.setAttribute('fill', 'none');
              halo.setAttribute('stroke', 'var(--color-accent, #6B4EE6)');
              halo.setAttribute('stroke-width', String((parseFloat(node.edgeStrokeWidth || '1.5')) + 5));
              halo.setAttribute('stroke-opacity', '0.45');
              halo.setAttribute('stroke-linecap', 'round');
              edgesLayer.appendChild(halo);
            }

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('data-export-indicator', 'true');
            path.setAttribute('d', d);
            path.setAttribute('stroke', effectiveIndColor);
            path.style.stroke = effectiveIndColor;
            path.style.color = effectiveIndColor;
            path.setAttribute('stroke-width', node.edgeStrokeWidth || '1.5');
            if (node.edgeStrokeDasharray) {
              path.style.strokeDasharray = node.edgeStrokeDasharray;
            }
            const childInds = nodes.filter(n => n.parentId === parent.id && !n.isLatent);
            const isSingleItem = childInds.length === 1;
            const indArrow = isSingleItem ? 'none' : (node.edgeArrowhead || 'solid');
            if (indArrow !== 'none') {
              const mId = getOrCreateMarker(indArrow, effectiveIndColor);
              path.setAttribute('marker-end', `url(#${mId})`);
            } else {
              path.removeAttribute('marker-end');
            }
            path.style.fill = 'none';
            edgesLayer.appendChild(path);

            const clickPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            clickPath.setAttribute('data-export-indicator', 'true');
            clickPath.setAttribute('d', d);
            clickPath.style.stroke = 'rgba(0,0,0,0.01)';
            clickPath.style.strokeWidth = '16';
            clickPath.style.fill = 'none';
            clickPath.style.cursor = 'pointer';
            clickPath.addEventListener('click', (e) => {
              e.stopPropagation();
              if (mode === 'erase') {
                node.edgeWaypoints = [];
                render();
                pushHistory();
                return;
              }
              if (!e.shiftKey) clearSelection();
              selectedIds.add(indEdgeId);
              render();
            });
            clickPath.addEventListener('contextmenu', (e) => showContextMenu(e, indEdgeId));
            edgesLayer.appendChild(clickPath);

            // Bending handles when indicator or its arrow is selected
            if (isIndEdgeSelected) {
              if (indEdgeObj.waypoints && indEdgeObj.waypoints.length > 0) {
                indEdgeObj.waypoints.forEach((wp, idx) => {
                  const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                  handle.setAttribute('data-export-indicator', 'true');
                  handle.setAttribute('cx', wp.x);
                  handle.setAttribute('cy', wp.y);
                  handle.setAttribute('r', 5);
                  handle.setAttribute('fill', 'var(--color-accent, #6B4EE6)');
                  handle.style.cursor = 'move';
                  handle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    draggingWaypoint = { edge: indEdgeObj, idx };
                  });
                  edgesLayer.appendChild(handle);
                });
              }
              const pts = [{ x: x1, y: y1 }, ...(indEdgeObj.waypoints || []), { x: x2, y: y2 }];
              for (let i = 0; i < pts.length - 1; i++) {
                const midX = (pts[i].x + pts[i + 1].x) / 2;
                const midY = (pts[i].y + pts[i + 1].y) / 2;
                const midHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                midHandle.setAttribute('data-export-indicator', 'true');
                midHandle.setAttribute('cx', midX);
                midHandle.setAttribute('cy', midY);
                midHandle.setAttribute('r', 5);
                midHandle.setAttribute('fill', 'rgba(168,85,247,0.8)');
                midHandle.style.cursor = 'crosshair';
                midHandle.addEventListener('mousedown', (e) => {
                  e.stopPropagation();
                  pendingWaypoint = { edge: indEdgeObj, idx: i, midX, midY };
                });
                edgesLayer.appendChild(midHandle);
              }
            }

            // Measurement outer loading badge
            const loading = getOuterLoading(parent, node);
            if (loading !== null && loading !== undefined) {
              let indMidX = (x1 + x2) / 2;
              let indMidY = (y1 + y2) / 2;
              if (indEdgeObj.waypoints && indEdgeObj.waypoints.length > 0) {
                const nw = indEdgeObj.waypoints.length;
                if (nw % 2 === 1) {
                  const mIdx = Math.floor(nw / 2);
                  indMidX = indEdgeObj.waypoints[mIdx].x;
                  indMidY = indEdgeObj.waypoints[mIdx].y;
                } else {
                  const i1 = nw / 2 - 1;
                  const i2 = nw / 2;
                  indMidX = (indEdgeObj.waypoints[i1].x + indEdgeObj.waypoints[i2].x) / 2;
                  indMidY = (indEdgeObj.waypoints[i1].y + indEdgeObj.waypoints[i2].y) / 2;
                }
              }

              const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
              badgeG.setAttribute('data-export-indicator', 'true');
              badgeG.setAttribute('class', 'edge-result-badge indicator-badge');
              badgeG.setAttribute('transform', `translate(${indMidX}, ${indMidY})`);
              badgeG.setAttribute('pointer-events', 'none');

              const textVal = formatCanvasNumber(loading);
              const pillW = Math.max(30, textVal.length * 6.5 + 8);
              const pillH = 15;

              const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              bg.setAttribute('x', -pillW / 2);
              bg.setAttribute('y', -pillH / 2);
              bg.setAttribute('width', pillW);
              bg.setAttribute('height', pillH);
              bg.setAttribute('rx', '3');
              bg.setAttribute('fill', 'var(--canvas-badge-bg)');
              bg.setAttribute('stroke', 'var(--canvas-badge-border)');
              bg.setAttribute('stroke-width', '0.75');
              badgeG.appendChild(bg);

              const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              txt.setAttribute('text-anchor', 'middle');
              txt.setAttribute('dominant-baseline', 'central');
              txt.setAttribute('font-size', '9.5');
              txt.setAttribute('font-family', 'var(--font-mono)');
              txt.setAttribute('font-weight', '500');
              txt.setAttribute('fill', 'var(--canvas-badge-text)');
              txt.textContent = textVal;
              badgeG.appendChild(txt);

              edgesLayer.appendChild(badgeG);
            }
          }
        }
      }
      
      // Interaction
      if (node.isLatent) {
        g.addEventListener('pointerenter', () => {
          if (!activeResults) return;
          const m = getConstructMetrics(node);
          if (m) showLatentHoverPopup(node, m);
        });
        g.addEventListener('pointerleave', () => {
          hideLatentHoverPopup();
        });
      }
      g.addEventListener('mousedown', (e) => handleNodeMouseDown(e, node));
      g.addEventListener('contextmenu', (e) => showContextMenu(e, node.id));
      g.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        e.preventDefault();
        setTimeout(() => {
          startInlineNodeRename(node);
        }, 30);
      });

      nodesLayer.appendChild(g);
    });

    const nodeFormattingTools = document.getElementById('node-formatting-tools');
    const edgeFormattingTools = document.getElementById('edge-formatting-tools');
    const formattingDivider = document.getElementById('formatting-divider');
    const containerAlign = document.getElementById('container-align');
    const containerTextboxAlign = document.getElementById('container-textbox-align');
    const containerStyle = document.getElementById('container-style');
    const containerColors = document.getElementById('container-colors');
    const containerText = document.getElementById('container-text');

    if (selectedIds.size === 1) {
      const selectedId = Array.from(selectedIds)[0];
      const selectedNode = nodes.find(n => n.id === selectedId);
      const selectedEdge = edges.find(e => e.id === selectedId) ||
                           moderatingEffects.find(m => m.id === selectedId) ||
                           (selectedId.startsWith('edge_ind_') ? { id: selectedId } : null);
      
      if (selectedNode) {
        if (formattingDivider) formattingDivider.style.display = 'block';
        if (nodeFormattingTools) nodeFormattingTools.style.display = 'flex';
        if (edgeFormattingTools) edgeFormattingTools.style.display = 'none';

        if (selectedNode.isLatent && !selectedNode.isText) {
          // Latent Variable selected: extend toolbar with Align, Style/Shape, Colors, Typography
          if (containerAlign) containerAlign.style.display = 'block';
          if (containerTextboxAlign) containerTextboxAlign.style.display = 'none';
          if (containerStyle) containerStyle.style.display = 'block';
          if (containerColors) containerColors.style.display = 'block';
          if (containerText) containerText.style.display = 'block';
        } else if (selectedNode.isText) {
          // Text Note selected: hide indicator align, show textbox text align, hide shape
          if (containerAlign) containerAlign.style.display = 'none';
          if (containerTextboxAlign) containerTextboxAlign.style.display = 'block';
          if (containerStyle) containerStyle.style.display = 'none';
          if (containerColors) containerColors.style.display = 'block';
          if (containerText) containerText.style.display = 'block';
        } else {
          // Indicator selected: extend toolbar with Align, Style/Shape, Colors, Typography
          if (containerAlign) containerAlign.style.display = 'block';
          if (containerTextboxAlign) containerTextboxAlign.style.display = 'none';
          if (containerStyle) containerStyle.style.display = 'block';
          if (containerColors) containerColors.style.display = 'block';
          if (containerText) containerText.style.display = 'block';
        }

        const pickerFill = document.getElementById('picker-fill');
        const pickerBorder = document.getElementById('picker-border');
        const pickerText = document.getElementById('picker-text');
        const inputFont = document.getElementById('input-font-size');
        const rowTextInside = document.getElementById('row-text-inside');
        const textInsideLabel = document.getElementById('text-inside-label');
        
        if (pickerFill) {
          let defFill = '#334155';
          if (selectedNode.isText) defFill = '#ffffff';
          else if (selectedNode.isLatent === false) defFill = '#fef08a';
          pickerFill.value = selectedNode.fill || defFill;
        }
        if (pickerBorder) {
          let defStroke = 'transparent';
          if (selectedNode.isText) defStroke = '#ffffff';
          else if (selectedNode.isLatent === false) defStroke = '#ca8a04';
          pickerBorder.value = selectedNode.stroke || defStroke;
        }
        if (pickerText) {
          let defText = '#1e293b';
          if (selectedNode.isText) defText = '#0f172a';
          else if (selectedNode.isLatent === false) defText = '#422006';
          else if (selectedNode.isLatent) defText = '#ffffff';
          pickerText.value = selectedNode.color || defText;
        }
        if (inputFont) inputFont.value = selectedNode.fontSize || 14;
        
        if (rowTextInside) {
          if (!selectedNode.isText) {
            rowTextInside.style.display = 'flex';
            let isInside = false;
            let canMoveInside = true;
            let disableReason = '';

            if (selectedNode.isLatent) {
              isInside = !!selectedNode.textInside;
              const metrics = getConstructMetrics(selectedNode);
              const hasR2 = !!(metrics && metrics.r2 !== null && metrics.r2 !== undefined);
              if (hasR2 && !isInside) {
                canMoveInside = false;
                disableReason = 'Move inside disabled: R² result is displayed inside construct';
              }
            } else {
              // Indicator: default is inside
              isInside = selectedNode.textInside !== undefined ? selectedNode.textInside : true;
            }

            const containerOutsidePos = document.getElementById('container-text-outside-pos');
            const btnTextInside = rowTextInside.querySelector('button[data-action="text-inside"]');

            if (isInside) {
              if (containerOutsidePos) containerOutsidePos.style.display = 'none';
              if (btnTextInside) {
                btnTextInside.style.width = '100%';
                btnTextInside.style.flex = 'none';
              }
              if (textInsideLabel) {
                textInsideLabel.textContent = 'Move Outside';
              }
            } else {
              if (containerOutsidePos) {
                containerOutsidePos.style.display = 'flex';
                const currentPos = selectedNode.textPosition || 'bottom';
                containerOutsidePos.querySelectorAll('button[data-action^="text-pos-"]').forEach(btn => {
                  const btnPos = btn.getAttribute('data-action').replace('text-pos-', '');
                  if (btnPos === currentPos) {
                    btn.style.background = 'var(--color-accent-subtle, rgba(79, 70, 229, 0.12))';
                    btn.style.color = 'var(--color-accent, #4f46e5)';
                  } else {
                    btn.style.background = 'transparent';
                    btn.style.color = 'var(--color-text-secondary, #64748b)';
                  }
                });
              }
              if (btnTextInside) {
                btnTextInside.style.width = 'auto';
                btnTextInside.style.flex = '1';
              }
              if (textInsideLabel) {
                textInsideLabel.textContent = 'Move Inside';
              }
            }

            if (btnTextInside) {
              if (!canMoveInside) {
                btnTextInside.disabled = true;
                btnTextInside.style.opacity = '0.35';
                btnTextInside.style.cursor = 'not-allowed';
                btnTextInside.title = disableReason;
              } else {
                btnTextInside.disabled = false;
                btnTextInside.style.opacity = '1';
                btnTextInside.style.cursor = 'pointer';
                btnTextInside.title = isInside ? 'Move text label outside' : 'Move text label inside';
              }
            }
          } else {
            rowTextInside.style.display = 'none';
          }
        }
        
        const btnBold = document.querySelector('.tb-font-btn[data-action="text-bold"]');
        const btnItalic = document.querySelector('.tb-font-btn[data-action="text-italic"]');
        const btnUnderline = document.querySelector('.tb-font-btn[data-action="text-underline"]');
        if (btnBold) {
          btnBold.style.background = selectedNode.bold ? 'rgba(79, 70, 229, 0.1)' : 'transparent';
          btnBold.style.color = selectedNode.bold ? '#4f46e5' : 'inherit';
        }
        if (btnItalic) {
          btnItalic.style.background = selectedNode.italic ? 'rgba(79, 70, 229, 0.1)' : 'transparent';
          btnItalic.style.color = selectedNode.italic ? '#4f46e5' : 'inherit';
        }
        if (btnUnderline) {
          btnUnderline.style.background = selectedNode.underline ? 'rgba(79, 70, 229, 0.1)' : 'transparent';
          btnUnderline.style.color = selectedNode.underline ? '#4f46e5' : 'inherit';
        }

        document.querySelectorAll('.tb-font-size-label').forEach(el => {
          el.textContent = (selectedNode.fontSize || 14) + (el.textContent.includes('px') ? 'px' : '');
        });
        
        const inputFontFamily = document.getElementById('input-font-family');
        if (inputFontFamily) {
          inputFontFamily.value = selectedNode.fontFamily || 'Inter';
        }

        if (window.syncColorPickers) {
          window.syncColorPickers(pickerFill?.value, pickerBorder?.value, pickerText?.value);
        }
        document.dispatchEvent(new CustomEvent('selectionChange'));
        window.dispatchEvent(new CustomEvent('selectionChange'));
      } else if (selectedEdge) {
        if (formattingDivider) formattingDivider.style.display = 'block';
        if (nodeFormattingTools) nodeFormattingTools.style.display = 'none';
        if (edgeFormattingTools) edgeFormattingTools.style.display = 'flex';
        document.dispatchEvent(new CustomEvent('selectionChange'));
        window.dispatchEvent(new CustomEvent('selectionChange'));
      }
    } else if (selectedIds.size > 1) {
      const selectedNodes = nodes.filter(n => selectedIds.has(n.id));
      const selectedEdgesList = [...edges, ...moderatingEffects].filter(e => selectedIds.has(e.id));
      const selectedIndicatorEdges = nodes.some(n => selectedIds.has(`edge_ind_${n.id}`));
      if (selectedNodes.length > 0 && selectedEdgesList.length === 0 && !selectedIndicatorEdges) {
        if (formattingDivider) formattingDivider.style.display = 'block';
        if (nodeFormattingTools) nodeFormattingTools.style.display = 'flex';
        if (edgeFormattingTools) edgeFormattingTools.style.display = 'none';
        const allText = selectedNodes.every(n => n.isText);
        if (containerAlign) containerAlign.style.display = allText ? 'none' : 'block';
        if (containerTextboxAlign) containerTextboxAlign.style.display = allText ? 'block' : 'none';
        const hasLatent = selectedNodes.some(n => n.isLatent && !n.isText);
        if (containerStyle) containerStyle.style.display = hasLatent ? 'block' : 'none';
        if (containerColors) containerColors.style.display = 'block';
        if (containerText) containerText.style.display = 'block';
      } else if ((selectedEdgesList.length > 0 || selectedIndicatorEdges) && selectedNodes.length === 0) {
        if (formattingDivider) formattingDivider.style.display = 'block';
        if (nodeFormattingTools) nodeFormattingTools.style.display = 'none';
        if (edgeFormattingTools) edgeFormattingTools.style.display = 'flex';
      } else {
        if (formattingDivider) formattingDivider.style.display = 'none';
        if (nodeFormattingTools) nodeFormattingTools.style.display = 'none';
        if (edgeFormattingTools) edgeFormattingTools.style.display = 'none';
      }
    } else {
      // DEFAULT (0 items selected): only show up to Textbox and Undo/Redo
      if (formattingDivider) formattingDivider.style.display = 'none';
      if (nodeFormattingTools) nodeFormattingTools.style.display = 'none';
      if (edgeFormattingTools) edgeFormattingTools.style.display = 'none';
    }

    updateToolbarAndHudStates();
  }

  function updateToolbarAndHudStates() {
    const hasElements = nodes.length > 0 || edges.length > 0;
    const hasNodes = nodes.length > 0;
    const latentCount = nodes.filter(n => n.isLatent && !n.isText).length;
    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;

    const setBtnState = (el, enabled) => {
      if (!el) return;
      el.classList.toggle('disabled', !enabled);
      el.style.opacity = enabled ? '1' : '0.35';
      el.style.pointerEvents = enabled ? 'auto' : 'none';
      el.style.cursor = enabled ? 'pointer' : 'not-allowed';
      if (!enabled) {
        el.setAttribute('aria-disabled', 'true');
      } else {
        el.removeAttribute('aria-disabled');
      }
    };

    // 1. Bottom Tool HUD: Reset, Clear, Fit
    setBtnState(document.getElementById('hud-reset'), hasElements);
    setBtnState(document.getElementById('hud-clear'), hasElements);
    setBtnState(document.getElementById('hud-fit'), hasNodes);

    // 2. Top Toolbar: Undo & Redo
    setBtnState(document.getElementById('btn-undo'), canUndo);
    setBtnState(document.getElementById('btn-redo'), canRedo);

    // 3. Top Toolbar: Erase Element (E)
    const btnErase = document.getElementById('btn-erase') || document.querySelector('.tb-btn[title*="Erase"]');
    setBtnState(btnErase, hasElements);
    if (!hasElements && mode === 'erase') {
      setMode('select');
      updateToolbarUI(document.querySelector('.tb-btn[title*="Select"]'));
    }

    // 4. Top Toolbar: Auto-Align Model
    const btnAutoAlign = document.querySelector('.tb-btn[title*="Auto-Align"]');
    setBtnState(btnAutoAlign, hasNodes);

    // 5. Top Toolbar: Connect (P)
    // Connect mode is a primary tool (like Select) and remains accessible so users can switch tools freely.

    // 6. Top Toolbar: Moderation Effect (M), Quadratic Effect (Q), Gaussian Copula
    const btnModeration = document.querySelector('.tb-btn[title*="Moderation"]');
    setBtnState(btnModeration, latentCount >= 2 && edges.length > 0);

    const btnQuadratic = document.querySelector('.tb-btn[title*="Quadratic"]');
    setBtnState(btnQuadratic, latentCount >= 1);

    const btnGaussian = document.querySelector('.tb-btn[title*="Gaussian"]');
    setBtnState(btnGaussian, latentCount >= 1);

    // 7. Top Toolbar formatting dropdowns: Alignment, Style, Color, Typography
    setBtnState(document.getElementById('btn-align'), hasNodes);
    setBtnState(document.getElementById('btn-style'), hasNodes);
    setBtnState(document.getElementById('btn-colors'), hasNodes);
    setBtnState(document.getElementById('btn-text'), hasNodes);
  }

  // --- Node Dragging & Connect Logic ---
  let draggingNode = null;
  let draggingWaypoint = null;
  let pendingWaypoint = null;
  let draggingCurve = null;
  let dragOffset = { x: 0, y: 0 };
  let resizingNode = null;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;
  let resizeStartPt = null;
  
  let tempConnecting = false;
  let tempLine = null;
  let connectStartNode = null;
  let connectStartPt = null;
  let lastNodeClickTime = 0;
  let lastNodeClickId = null;

  function cancelTempConnecting() {
    tempConnecting = false;
    connectStartNode = null;
    connectStartPt = null;
    if (tempLine) {
      tempLine.remove();
      tempLine = null;
    }
    guidesLayer.innerHTML = '';
    hideConnectTooltip();
    svg.style.cursor = (mode === 'connect' || mode === 'moderation') ? 'crosshair' : '';
  }

  function handleNodeMouseDown(e, node) {
    const activeRenameInput = document.getElementById('canvas-direct-inline-rename');
    if (activeRenameInput) {
      activeRenameInput.blur();
    }
    hideLatentHoverPopup();
    e.stopPropagation();

    // Context selection happens once in the context-menu handler.
    if (e.button !== 0) return;

    e.preventDefault();

    // Double click detection (timestamp based across DOM re-renders)
    const now = Date.now();
    if (lastNodeClickId === node.id && (now - lastNodeClickTime) < 400 && e.button === 0) {
      lastNodeClickTime = 0;
      lastNodeClickId = null;
      draggingNode = null;
      e.stopPropagation();
      e.preventDefault();
      setTimeout(() => {
        startInlineNodeRename(node);
      }, 10);
      return;
    }
    lastNodeClickTime = now;
    lastNodeClickId = node.id;
    
    if (mode === 'erase') {
      selectedIds.clear();
      selectedIds.add(node.id);
      deleteSelected();
      return;
    }

    if (mode === 'moderation') {
      if (node.isLatent !== false && !node.isText) {
        pendingModeratorNode = node;
        render();
        try {
          window.dispatchEvent(new CustomEvent('toast', { detail: { message: `Moderator "${node.label}" selected. Now click an existing structural path.` } }));
        } catch (err) {}
      }
      return;
    }

    if (mode === 'select') {
      if (!e.shiftKey && !selectedIds.has(node.id)) {
        clearSelection();
      }
      selectedIds.add(node.id);
      
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      
      draggingNode = node;
      dragOffset = { x: svgPt.x - node.x, y: svgPt.y - node.y };
      render();
    } else if (mode === 'connect') {
      if (tempConnecting && connectStartNode && connectStartNode.id !== node.id) {
        // Construct-to-construct connection via click-click!
        let sId = connectStartNode.id;
        let tId = node.id;
        const isIllegal = (
          node.isLatent === false ||
          connectStartNode.isLatent === false ||
          node.isText === true ||
          connectStartNode.isText === true ||
          edges.some(edge => 
            (edge.sourceId === sId && edge.targetId === tId) ||
            (edge.sourceId === tId && edge.targetId === sId)
          )
        );
        if (!isIllegal) {
          edges.push({
            id: generateId(),
            sourceId: sId,
            targetId: tId
          });
          render();
          pushHistory();
        }
        cancelTempConnecting();
        return;
      }

      tempConnecting = true;
      connectStartNode = node;
      connectStartPt = { x: e.clientX, y: e.clientY };

      if (tempLine) tempLine.remove();
      tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tempLine.setAttribute('x1', node.x);
      tempLine.setAttribute('y1', node.y);
      tempLine.setAttribute('x2', node.x);
      tempLine.setAttribute('y2', node.y);
      tempLine.setAttribute('stroke', 'var(--color-text-primary)');
      tempLine.setAttribute('stroke-width', '2');
      tempLine.setAttribute('stroke-dasharray', '5 5');
      tempLine.style.pointerEvents = 'none';
      edgesLayer.appendChild(tempLine);
    }
  }

  window.addEventListener('mousemove', (e) => {
    // If context menu is open, completely freeze any node movement!
    if (contextMenu && contextMenu.style.display === 'block') {
      draggingNode = null;
      isMarquee = false;
      return;
    }

    if (draggingCurve) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const cursor = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      const source = nodes.find(node => node.id === draggingCurve.sourceId);
      const target = nodes.find(node => node.id === draggingCurve.targetId);
      const modGeometry = draggingCurve.moderator ? getModerationLineGeometry(draggingCurve) : null;
      if (modGeometry || (source && target)) {
        const { x1, y1, x2, y2 } = modGeometry
          ? { x1: modGeometry.startX, y1: modGeometry.startY, x2: modGeometry.landX, y2: modGeometry.landY }
          : getEdgeCoordinates(source, target, draggingCurve);
        const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy) || 1;
        draggingCurve.curvature = 2 * ((cursor.x - (x1 + x2) / 2) * (-dy / length) + (cursor.y - (y1 + y2) / 2) * (dx / length));
        render();
      }
      return;
    }
    if (pendingWaypoint) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      if (Math.abs(svgPt.x - pendingWaypoint.midX) > 2 || Math.abs(svgPt.y - pendingWaypoint.midY) > 2) {
        if (!pendingWaypoint.edge.waypoints) pendingWaypoint.edge.waypoints = [];
        pendingWaypoint.edge.waypoints.splice(pendingWaypoint.idx, 0, { x: pendingWaypoint.midX, y: pendingWaypoint.midY });
        draggingWaypoint = { edge: pendingWaypoint.edge, idx: pendingWaypoint.idx };
        pendingWaypoint = null;
        render();
      }
      return;
    }

    if (draggingWaypoint) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      draggingWaypoint.edge.waypoints[draggingWaypoint.idx].x = svgPt.x;
      draggingWaypoint.edge.waypoints[draggingWaypoint.idx].y = svgPt.y;
      render();
      return;
    }
    
    if (resizingNode) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      const dx = svgPt.x - resizeStartPt.x;
      const dy = svgPt.y - resizeStartPt.y;
      
      let newW = Math.max(20, resizeStartWidth + dx * 2);
      let newH = Math.max(20, resizeStartHeight + dy * 2);
      
      guidesLayer.innerHTML = '';
      if (isSnapping) {
        if (Math.abs(newW - newH) < 15) {
          newW = newH = Math.max(newW, newH);
          
          const cx = resizingNode.x;
          const cy = resizingNode.y;
          const r = newW / 2;
          
          let d = `M ${cx - r} ${cy - r} L ${cx + r} ${cy + r} M ${cx - r} ${cy + r} L ${cx + r} ${cy - r}`;
          if (resizingNode.isLatent !== false && (!resizingNode.shape || resizingNode.shape === 'circle')) {
            d += ` M ${cx - r} ${cy} L ${cx + r} ${cy} M ${cx} ${cy - r} L ${cx} ${cy + r}`;
          }
          
          const guide = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          guide.setAttribute('d', d);
          guide.setAttribute('stroke', '#ef4444');
          guide.setAttribute('stroke-width', '1.5');
          guide.setAttribute('stroke-dasharray', '4 4');
          guide.setAttribute('fill', 'none');
          guidesLayer.appendChild(guide);
        }
      }
      
      resizingNode.width = newW;
      resizingNode.height = newH;
      
      if (resizingNode.isText) {
        if (!resizingNode.rectBox) resizingNode.rectBox = {width: 100, height: 40};
        resizingNode.rectBox.width = resizingNode.width;
        resizingNode.rectBox.height = resizingNode.height;
      }
      
      render();
      return;
    }

    if (draggingGC) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      draggingGC.gc.node_x = svgPt.x - draggingGC.offsetX;
      draggingGC.gc.node_y = svgPt.y - draggingGC.offsetY;
      render();
      return;
    }

    if (draggingQE) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      draggingQE.qe.node_x = svgPt.x - draggingQE.offsetX;
      draggingQE.qe.node_y = svgPt.y - draggingQE.offsetY;
      render();
      return;
    }

    if (draggingNode && mode === 'select') {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      
      let newX = svgPt.x - dragOffset.x;
      let newY = svgPt.y - dragOffset.y;
      
      // Snapping
      guidesLayer.innerHTML = '';
      if (isSnapping) {
        const getBB = (n) => {
          const w = n.width || (n.isLatent !== false ? 64 : 64);
          const h = n.height || (n.isLatent !== false ? 64 : 24);
          return { left: n.x - w/2, right: n.x + w/2, top: n.y - h/2, bottom: n.y + h/2, cx: n.x, cy: n.y };
        };
        
        let snappedX = false;
        let snappedY = false;

        nodes.forEach(n => {
          if (n.id === draggingNode.id) return;
          const bb = getBB(n);
          const activeBB = getBB({ ...draggingNode, x: newX, y: newY });
          
          if (!snappedX) {
            const xs = [bb.cx, bb.left, bb.right];
            const myXs = [activeBB.cx, activeBB.left, activeBB.right];
            for (let target of xs) {
              for (let me of myXs) {
                if (Math.abs(target - me) < SNAP_THRESHOLD) {
                  newX += (target - me);
                  snappedX = true;
                  drawLineGuide(target, -5000, target, 5000);
                  break;
                }
              }
              if (snappedX) break;
            }
          }

          if (!snappedY) {
            const ys = [bb.cy, bb.top, bb.bottom];
            const myYs = [activeBB.cy, activeBB.top, activeBB.bottom];
            for (let target of ys) {
              for (let me of myYs) {
                if (Math.abs(target - me) < SNAP_THRESHOLD) {
                  newY += (target - me);
                  snappedY = true;
                  drawLineGuide(-5000, target, 5000, target);
                  break;
                }
              }
              if (snappedY) break;
            }
          }
        });

        if (!snappedX) {
          for (let n1 of nodes) {
            if (n1.id === draggingNode.id) continue;
            for (let n2 of nodes) {
              if (n2.id === draggingNode.id || n1.id === n2.id) continue;
              const dx = Math.abs(n1.x - n2.x);
              if (dx < 10) continue;
              if (Math.abs(Math.abs(newX - n1.x) - dx) < SNAP_THRESHOLD) {
                newX = newX > n1.x ? n1.x + dx : n1.x - dx;
                snappedX = true;
                drawLineGuide(n2.x, n1.y, newX, n1.y);
                break;
              }
            }
            if (snappedX) break;
          }
        }

        if (!snappedY) {
          for (let n1 of nodes) {
            if (n1.id === draggingNode.id) continue;
            for (let n2 of nodes) {
              if (n2.id === draggingNode.id || n1.id === n2.id) continue;
              const dy = Math.abs(n1.y - n2.y);
              if (dy < 10) continue;
              if (Math.abs(Math.abs(newY - n1.y) - dy) < SNAP_THRESHOLD) {
                newY = newY > n1.y ? n1.y + dy : n1.y - dy;
                snappedY = true;
                drawLineGuide(n1.x, n2.y, n1.x, newY);
                break;
              }
            }
            if (snappedY) break;
          }
        }

        if (!snappedX) {
          const grid = 20;
          const snappedGrid = Math.round(newX / grid) * grid;
          if (Math.abs(newX - snappedGrid) < 5) {
            newX = snappedGrid;
            snappedX = true;
          }
        }
        if (!snappedY) {
          const grid = 20;
          const snappedGrid = Math.round(newY / grid) * grid;
          if (Math.abs(newY - snappedGrid) < 5) {
            newY = snappedGrid;
            snappedY = true;
          }
        }
      }
      
      const dx = newX - draggingNode.x;
      const dy = newY - draggingNode.y;
      if (dx !== 0 || dy !== 0) {
        const nodesToMove = new Set(selectedIds);
        nodes.forEach(n => {
          if (n.parentId && nodesToMove.has(n.parentId)) {
            nodesToMove.add(n.id);
          }
        });
        nodes.forEach(n => {
          if (nodesToMove.has(n.id)) {
            n.x += dx;
            n.y += dy;
          }
        });
      }
      render();
    }
    
    if (tempConnecting && mode === 'connect') {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      
      // Resolution order: (1) construct or indicator under cursor
      const targetNode = nodes.find(n => {
        if (n.id === connectStartNode.id) return false;
        if (n.isLatent === false) {
          const halfW = (n.width || 64) / 2;
          const halfH = (n.height || 24) / 2;
          return Math.abs(n.x - svgPt.x) <= halfW + 8 && Math.abs(n.y - svgPt.y) <= halfH + 8;
        }
        const dx = n.x - svgPt.x;
        const dy = n.y - svgPt.y;
        return Math.sqrt(dx*dx + dy*dy) <= Math.max(NODE_R, (n.width ? n.width/2 : 40));
      });

      if (targetNode) {
        guidesLayer.innerHTML = '';
        hideConnectTooltip();
        tempLine.setAttribute('x2', targetNode.x);
        tempLine.setAttribute('y2', targetNode.y);
        tempLine.setAttribute('stroke-width', '2');

        const isIllegal = (
          targetNode.isText === true || 
          connectStartNode.isText === true ||
          targetNode.isLatent === false ||
          connectStartNode.isLatent === false ||
          edges.some(edge => 
            (edge.sourceId === connectStartNode.id && edge.targetId === targetNode.id) ||
            (edge.sourceId === targetNode.id && edge.targetId === connectStartNode.id)
          )
        );
        if (isIllegal) {
          tempLine.setAttribute('stroke', '#ef4444');
          tempLine.setAttribute('stroke-dasharray', '4 4');
          svg.style.cursor = 'not-allowed';
        } else {
          tempLine.setAttribute('stroke', 'var(--color-accent, #6B4EE6)');
          tempLine.setAttribute('stroke-dasharray', '');
          svg.style.cursor = 'crosshair';
        }
      } else if (connectStartNode.isLatent !== false && !connectStartNode.isText) {
        const modTarget = findModerationTargetUnderPoint(svgPt, connectStartNode.id);
        if (modTarget) {
          const modId = connectStartNode.id;
          let invalidReason = null;
          const midX = modTarget.midX;
          const midY = modTarget.midY;

          if (modTarget.type === 'path') {
            const { sNode, tNode } = modTarget;
            if (modId === sNode.id || modId === tNode.id) {
              invalidReason = 'Moderator cannot be predictor or outcome of the path';
            } else if (wouldCreateCycle(modId, tNode.id, edges)) {
              invalidReason = 'Cannot add moderation: would create a circular dependency';
            }
          } else if (modTarget.type === 'moderation') {
            const parentMod = modTarget.mod;
            if (modId === parentMod.moderator) {
              invalidReason = 'A moderator construct cannot connect to its own moderation arrow';
            } else if (wouldCreateCycle(modId, parentMod.target, edges)) {
              invalidReason = 'Cannot add moderation: would create a circular dependency';
            }
          }

          if (invalidReason) {
            guidesLayer.innerHTML = '';
            tempLine.setAttribute('x2', svgPt.x);
            tempLine.setAttribute('y2', svgPt.y);
            tempLine.setAttribute('stroke', '#ef4444');
            tempLine.setAttribute('stroke-dasharray', '4 4');
            tempLine.setAttribute('stroke-width', '2');
            svg.style.cursor = 'not-allowed';
            hideConnectTooltip();
          } else {
            hideConnectTooltip();
            tempLine.setAttribute('x2', midX);
            tempLine.setAttribute('y2', midY);
            tempLine.setAttribute('stroke', 'var(--color-accent, #6B4EE6)');
            tempLine.setAttribute('stroke-dasharray', '4 4');
            tempLine.setAttribute('stroke-width', '2');
            svg.style.cursor = 'copy';

            guidesLayer.innerHTML = '';
            const snapCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            snapCircle.setAttribute('cx', midX);
            snapCircle.setAttribute('cy', midY);
            snapCircle.setAttribute('r', '7');
            snapCircle.setAttribute('fill', 'var(--color-accent, #6B4EE6)');
            snapCircle.setAttribute('stroke', '#ffffff');
            snapCircle.setAttribute('stroke-width', '2');
            snapCircle.style.pointerEvents = 'none';
            guidesLayer.appendChild(snapCircle);
          }
        } else {
          guidesLayer.innerHTML = '';
          hideConnectTooltip();
          tempLine.setAttribute('x2', svgPt.x);
          tempLine.setAttribute('y2', svgPt.y);
          tempLine.setAttribute('stroke', 'var(--color-text-primary)');
          tempLine.setAttribute('stroke-dasharray', '5 5');
          tempLine.setAttribute('stroke-width', '2');
          svg.style.cursor = 'crosshair';
        }
      } else {
        guidesLayer.innerHTML = '';
        hideConnectTooltip();
        tempLine.setAttribute('x2', svgPt.x);
        tempLine.setAttribute('y2', svgPt.y);
        tempLine.setAttribute('stroke', 'var(--color-text-primary)');
        tempLine.setAttribute('stroke-dasharray', '5 5');
        tempLine.setAttribute('stroke-width', '2');
        svg.style.cursor = 'crosshair';
      }
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (draggingCurve) {
      draggingCurve = null;
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
      return;
    }
    if (pendingWaypoint) {
      pendingWaypoint = null;
    }
    if (draggingWaypoint) {
      draggingWaypoint = null;
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
      return;
    }
    
    if (resizingNode) {
      resizingNode = null;
      guidesLayer.innerHTML = '';
      pushHistory();
      return;
    }
    
    if (draggingGC) {
      draggingGC = null;
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
    }

    if (draggingQE) {
      draggingQE = null;
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
    }

    if (draggingNode) {
      draggingNode = null;
      guidesLayer.innerHTML = ''; // clear guides
      pushHistory();
      window.dispatchEvent(new CustomEvent('canvas-changed'));
    }
    
    if (tempConnecting) {
      guidesLayer.innerHTML = '';
      hideConnectTooltip();
      svg.style.cursor = '';

      // Find what we dropped on
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      
      // Resolution order: (1) construct or indicator under cursor
      const targetNode = nodes.find(n => {
        if (n.id === connectStartNode.id) return false;
        if (n.isLatent === false) {
          const halfW = (n.width || 64) / 2;
          const halfH = (n.height || 24) / 2;
          return Math.abs(n.x - svgPt.x) <= halfW + 8 && Math.abs(n.y - svgPt.y) <= halfH + 8;
        }
        const dx = n.x - svgPt.x;
        const dy = n.y - svgPt.y;
        return Math.sqrt(dx*dx + dy*dy) <= Math.max(NODE_R, (n.width ? n.width/2 : 40));
      });
      
      // Check if mouse moved enough to be considered a drag (> 6px)
      const didDrag = connectStartPt && Math.hypot(e.clientX - connectStartPt.x, e.clientY - connectStartPt.y) > 6;

      if (didDrag) {
        const modTarget = (connectStartNode.isLatent !== false && !connectStartNode.isText)
          ? findModerationTargetUnderPoint(svgPt, connectStartNode.id)
          : null;

        // Disambiguation: if cursor was dropped on a moderation arrow or path snap zone,
        // or dropped near the moderator/source/target of that arrow, prioritize moderation!
        const isTargetingModeration = modTarget && (
          modTarget.inSnapZone ||
          !targetNode ||
          (targetNode && (
            (modTarget.mod && targetNode.id === modTarget.mod.moderator) ||
            (modTarget.edge && (targetNode.id === modTarget.edge.sourceId || targetNode.id === modTarget.edge.targetId))
          ))
        );

        if (isTargetingModeration) {
          if (modTarget.type === 'path') {
            handleModerationOnEdge(modTarget.edge, connectStartNode);
          } else if (modTarget.type === 'moderation') {
            handleModerationOnMod(modTarget.mod, connectStartNode);
          }
          cancelTempConnecting();
        } else if (targetNode && !targetNode.isText && !connectStartNode.isText) {
          let sId = connectStartNode.id;
          let tId = targetNode.id;

          const isIllegal = (
            targetNode.isLatent === false ||
            connectStartNode.isLatent === false ||
            edges.some(edge => 
              (edge.sourceId === sId && edge.targetId === tId) ||
              (edge.sourceId === tId && edge.targetId === sId)
            )
          );
          
          if (!isIllegal) {
            edges.push({
              id: generateId(),
              sourceId: sId,
              targetId: tId
            });
            render();
            pushHistory();
          }
          cancelTempConnecting();
        } else if (modTarget) {
          if (modTarget.type === 'path') {
            handleModerationOnEdge(modTarget.edge, connectStartNode);
          } else if (modTarget.type === 'moderation') {
            handleModerationOnMod(modTarget.mod, connectStartNode);
          }
          cancelTempConnecting();
        } else {
          cancelTempConnecting();
        }
      } else {
        // Just clicked on the node: leave tempLine active so user can click destination
      }
      
      render();
    }
  });

  function drawLineGuide(x1, y1, x2, y2) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', '#ef4444'); // Red alignment guide
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '4 4');
    guidesLayer.appendChild(line);
  }

  function clearSelection() {
    hideLatentHoverPopup(true);
    selectedIds.clear();
    render();
    try {
      window.dispatchEvent(new CustomEvent('selectionChange', { detail: { type: null } }));
      window.dispatchEvent(new CustomEvent('moderation-selected', { detail: { moderation: null } }));
    } catch (err) {}
  }

  // --- Geometry Helpers ---
  function getEdgeCoordinates(source, target, edge = null) {
    let tX = target.x, tY = target.y;
    let sX = source.x, sY = source.y;
    
    if (edge && edge.waypoints && edge.waypoints.length > 0) {
      tX = edge.waypoints[0].x;
      tY = edge.waypoints[0].y;
      sX = edge.waypoints[edge.waypoints.length - 1].x;
      sY = edge.waypoints[edge.waypoints.length - 1].y;
    }
    
    let srcPortAngle = 0;
    let tgtPortAngle = 0;
    if (edge && Array.isArray(edges) && !edge.waypoints?.length) {
      if (source.shape !== 'rectangle' && source.isLatent !== false) {
        const outgoing = edges.filter(e => e && e.sourceId === source.id && !e.targetEdgeId && !e.sourceEdgeId);
        if (outgoing.length > 1) {
          outgoing.sort((a, b) => {
            const tA = nodes.find(n => n.id === a.targetId);
            const tB = nodes.find(n => n.id === b.targetId);
            return (tA ? tA.y : 0) - (tB ? tB.y : 0);
          });
          const idx = outgoing.findIndex(e => e.id === edge.id || (e.sourceId === edge.sourceId && e.targetId === edge.targetId));
          if (idx !== -1) {
            const maxSpread = 0.28;
            srcPortAngle = -maxSpread / 2 + (idx / (outgoing.length - 1)) * maxSpread;
          }
        }
      }
      if (target.shape !== 'rectangle' && target.isLatent !== false) {
        const incoming = edges.filter(e => e && e.targetId === target.id && !e.targetEdgeId && !e.sourceEdgeId);
        if (incoming.length > 1) {
          incoming.sort((a, b) => {
            const sA = nodes.find(n => n.id === a.sourceId);
            const sB = nodes.find(n => n.id === b.sourceId);
            return (sA ? sA.y : 0) - (sB ? sB.y : 0);
          });
          const idx = incoming.findIndex(e => e.id === edge.id || (e.sourceId === edge.sourceId && e.targetId === edge.targetId));
          if (idx !== -1) {
            const maxSpread = 0.28;
            tgtPortAngle = -maxSpread / 2 + (idx / (incoming.length - 1)) * maxSpread;
          }
        }
      }
    }

    const getIntersectionOffset = (node, ptX, ptY, isTarget) => {
      const dx = ptX - node.x;
      const dy = ptY - node.y;
      const distance = Math.sqrt(dx*dx + dy*dy);
      if (distance === 0) return { x: 0, y: 0 };
      
      const w = node.width || (node.isLatent !== false ? 64 : 64);
      const h = node.height || (node.isLatent !== false ? 64 : 24);
      const shape = node.shape || 'circle';
      const dirX = isTarget ? dx : dx;
      const dirY = isTarget ? dy : dy;
      
      if (shape === 'circle') {
        const rx = w / 2;
        const ry = h / 2;
        const portOffset = isTarget ? tgtPortAngle : srcPortAngle;
        if (portOffset !== 0) {
          const baseAngle = Math.atan2(dirY, dirX);
          const angle = baseAngle + portOffset;
          return { x: Math.cos(angle) * rx, y: Math.sin(angle) * ry };
        }
        return { x: (dirX / distance) * rx, y: (dirY / distance) * ry };
      } else {
        const rx = w / 2;
        const ry = h / 2;
        if (Math.abs(dirX) * ry > Math.abs(dirY) * rx) {
          return { x: Math.sign(dirX) * rx, y: dirY * (rx / Math.abs(dirX)) };
        } else {
          return { x: dirX * (ry / Math.abs(dirY)), y: Math.sign(dirY) * ry };
        }
      }
    };
    
    const srcOff = getIntersectionOffset(source, tX, tY, false);
    const tgtOff = getIntersectionOffset(target, sX, sY, true);
    
    let x1 = source.x + srcOff.x;
    let y1 = source.y + srcOff.y;
    let x2 = target.x + tgtOff.x;
    let y2 = target.y + tgtOff.y;

    if (edge && edge.curved) {
      // 1st pass: straight line approximation
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const mx = (source.x + target.x) / 2;
      const my = (source.y + target.y) / 2;
      const curveVal = typeof edge.curvature === 'number' ? edge.curvature : 40;
      const cx = mx + (-dy / len) * curveVal;
      const cy = my + (dx / len) * curveVal;

      // 2nd pass: intersect from control point
      const newSrcOff = getIntersectionOffset(source, cx, cy, false);
      const newTgtOff = getIntersectionOffset(target, cx, cy, true);
      x1 = source.x + newSrcOff.x;
      y1 = source.y + newSrcOff.y;
      x2 = target.x + newTgtOff.x;
      y2 = target.y + newTgtOff.y;
    }

    return { x1, y1, x2, y2 };
  }

  // --- Context Menu ---
  let contextMenu = document.getElementById('canvas-context-menu');
  if (!contextMenu) {
    contextMenu = document.createElement('div');
    contextMenu.id = 'canvas-context-menu';
    contextMenu.className = 'canvas-context-menu';
    document.body.appendChild(contextMenu);
  }
  contextMenu.addEventListener('click', (ev) => {
    ev.stopPropagation();
  });

  function hideContextMenu() {
    contextMenu.style.display = 'none';
    contextMenu.innerHTML = '';
    draggingNode = null;
    isMarquee = false;
  }

  window.addEventListener('click', hideContextMenu);

  let contextMenuMousePos = null;
  let ctxTargetId = null;

  function hasClipboardData() {
    let payload = window.__statsem_clipboard;
    if (!payload) {
      try {
        const stored = localStorage.getItem('statsem_model_clipboard');
        if (stored) payload = JSON.parse(stored);
      } catch (e) {}
    }
    return !!(payload && payload.nodes && payload.nodes.length > 0);
  }

  function createGridPatternCtxElement() {
    const container = document.createElement('div');
    container.style.padding = '4px 8px 6px';
    container.style.userSelect = 'none';

    const label = document.createElement('div');
    label.style.fontSize = '10px';
    label.style.fontWeight = '600';
    label.style.textTransform = 'uppercase';
    label.style.letterSpacing = '0.05em';
    label.style.color = 'var(--color-text-hint)';
    label.style.marginBottom = '6px';
    label.style.paddingLeft = '2px';
    label.textContent = 'Grid Pattern';
    container.appendChild(label);

    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '4px';
    btnGroup.style.background = 'var(--color-bg-base)';
    btnGroup.style.padding = '2px';
    btnGroup.style.borderRadius = '6px';
    btnGroup.style.border = '1px solid var(--color-border-subtle, #e2e8f0)';

    const options = [
      { id: 'blank', label: 'Blank', icon: 'crop_free' },
      { id: 'dots', label: 'Dotted', icon: 'grain' },
      { id: 'grid', label: 'Ruled', icon: 'grid_4x4' }
    ];

    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = currentGrid === opt.id;
      btn.style.flex = '1';
      btn.style.height = '26px';
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.style.justifyContent = 'center';
      btn.style.gap = '4px';
      btn.style.border = isActive ? '1px solid var(--color-accent-subtle)' : 'none';
      btn.style.borderRadius = '4px';
      btn.style.background = isActive ? 'var(--color-accent-subtle, rgba(107, 78, 230, 0.12))' : 'transparent';
      btn.style.color = isActive ? 'var(--color-accent, #6B4EE6)' : 'var(--color-text-secondary)';
      btn.style.fontSize = '11px';
      btn.style.fontWeight = isActive ? '600' : '500';
      btn.style.cursor = 'pointer';
      btn.style.transition = 'all 0.15s ease';

      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.style.fontSize = '14px';
      icon.textContent = opt.icon;
      btn.appendChild(icon);

      const txt = document.createElement('span');
      txt.textContent = opt.label;
      btn.appendChild(txt);

      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        applyGrid(opt.id);
        saveCanvasSettings({ canvasGrid: opt.id });
        window.dispatchEvent(new CustomEvent('canvas-grid-change', { detail: { grid: opt.id } }));
        hideContextMenu();
      });

      btnGroup.appendChild(btn);
    });

    container.appendChild(btnGroup);
    return container;
  }

  function createCanvasBgCtxElement() {
    const container = document.createElement('div');
    container.style.padding = '4px 8px 6px';
    container.style.userSelect = 'none';

    const label = document.createElement('div');
    label.style.fontSize = '10px';
    label.style.fontWeight = '600';
    label.style.textTransform = 'uppercase';
    label.style.letterSpacing = '0.05em';
    label.style.color = 'var(--color-text-hint)';
    label.style.marginBottom = '6px';
    label.style.paddingLeft = '2px';
    label.textContent = 'Canvas Background';
    container.appendChild(label);

    const swatchRow = document.createElement('div');
    swatchRow.style.display = 'flex';
    swatchRow.style.alignItems = 'center';
    swatchRow.style.gap = '8px';
    swatchRow.style.paddingLeft = '2px';

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const defaultColors = [
      { id: '', label: 'Default', bg: isDark ? '#0f172a' : '#ffffff' },
      { id: isDark ? '#1e293b' : '#f8fafc', label: 'Soft', bg: isDark ? '#1e293b' : '#f8fafc' }
    ];

    defaultColors.forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isSelected = (!currentBgColor && item.id === '') || (currentBgColor && currentBgColor.toLowerCase() === item.id.toLowerCase());
      btn.title = item.label;
      btn.style.width = '22px';
      btn.style.height = '22px';
      btn.style.borderRadius = '50%';
      btn.style.background = item.bg;
      btn.style.border = isSelected ? '2px solid var(--color-accent, #6B4EE6)' : '1px solid rgba(0,0,0,0.2)';
      btn.style.boxShadow = isSelected ? '0 0 0 2px var(--color-accent-subtle)' : 'none';
      btn.style.cursor = 'pointer';
      btn.style.flexShrink = '0';

      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        applyBgColor(item.id);
        saveCanvasSettings({ canvasBgColor: item.id });
        window.dispatchEvent(new CustomEvent('canvas-bg-change', { detail: { color: item.id } }));
        hideContextMenu();
      });
      swatchRow.appendChild(btn);
    });

    // 1 History swatch (if set and not in defaults)
    const defHexes = ['', isDark ? '#1e293b' : '#f8fafc', '#ffffff', '#0f172a'];
    const recentColor = currentRecentBgColors.find(c => c && !defHexes.some(d => d.toLowerCase() === c.toLowerCase()));
    if (recentColor) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isSelected = currentBgColor && currentBgColor.toLowerCase() === recentColor.toLowerCase();
      btn.title = `Recent: ${recentColor}`;
      btn.style.width = '22px';
      btn.style.height = '22px';
      btn.style.borderRadius = '50%';
      btn.style.background = recentColor;
      btn.style.border = isSelected ? '2px solid var(--color-accent, #6B4EE6)' : '1px solid rgba(0,0,0,0.2)';
      btn.style.boxShadow = isSelected ? '0 0 0 2px var(--color-accent-subtle)' : 'none';
      btn.style.cursor = 'pointer';
      btn.style.flexShrink = '0';

      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        applyBgColor(recentColor);
        saveCanvasSettings({ canvasBgColor: recentColor });
        window.dispatchEvent(new CustomEvent('canvas-bg-change', { detail: { color: recentColor } }));
        hideContextMenu();
      });
      swatchRow.appendChild(btn);
    }

    // Custom Color "+" button
    const plusLabel = document.createElement('label');
    plusLabel.title = 'Custom Canvas Color';
    plusLabel.style.width = '22px';
    plusLabel.style.height = '22px';
    plusLabel.style.borderRadius = '50%';
    plusLabel.style.background = 'transparent';
    plusLabel.style.border = '1px dashed var(--color-border-subtle, #cbd5e1)';
    plusLabel.style.display = 'inline-flex';
    plusLabel.style.alignItems = 'center';
    plusLabel.style.justifyContent = 'center';
    plusLabel.style.color = 'var(--color-text-secondary)';
    plusLabel.style.position = 'relative';
    plusLabel.style.cursor = 'pointer';
    plusLabel.style.flexShrink = '0';
    plusLabel.addEventListener('click', (ev) => {
      ev.stopPropagation();
    });

    const plusSign = document.createElement('span');
    plusSign.style.fontSize = '14px';
    plusSign.style.lineHeight = '1';
    plusSign.style.pointerEvents = 'none';
    plusSign.textContent = '+';
    plusLabel.appendChild(plusSign);

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = currentBgColor || (isDark ? '#0f172a' : '#ffffff');
    colorInput.style.position = 'absolute';
    colorInput.style.top = '0';
    colorInput.style.left = '0';
    colorInput.style.width = '100%';
    colorInput.style.height = '100%';
    colorInput.style.opacity = '0';
    colorInput.style.cursor = 'pointer';
    colorInput.addEventListener('click', (ev) => {
      ev.stopPropagation();
    });

    const onColorPick = (val) => {
      applyBgColor(val);
      if (!defHexes.some(d => d.toLowerCase() === val.toLowerCase())) {
        currentRecentBgColors = [val];
      }
      saveCanvasSettings({ canvasBgColor: val, canvasRecentBgColors: currentRecentBgColors });
      window.dispatchEvent(new CustomEvent('canvas-bg-change', { detail: { color: val } }));
    };

    colorInput.addEventListener('input', (ev) => {
      ev.stopPropagation();
      onColorPick(ev.target.value);
    });
    colorInput.addEventListener('change', (ev) => {
      ev.stopPropagation();
      onColorPick(ev.target.value);
      hideContextMenu();
    });
    plusLabel.appendChild(colorInput);
    swatchRow.appendChild(plusLabel);

    container.appendChild(swatchRow);
    return container;
  }

  function renderContextMenuItems(items) {
    contextMenu.innerHTML = '';
    items.forEach(item => {
      if (item.custom) {
        if (typeof item.render === 'function') {
          const customEl = item.render();
          if (customEl) contextMenu.appendChild(customEl);
        }
        return;
      }
      if (item.divider) {
        const div = document.createElement('div');
        div.className = 'canvas-ctx-divider';
        contextMenu.appendChild(div);
        return;
      }
      const el = document.createElement('div');
      el.className = `canvas-ctx-item ${item.danger ? 'canvas-ctx-item--danger' : ''} ${item.disabled ? 'canvas-ctx-item--disabled' : ''}`;
      if (item.id) el.id = item.id;
      if (item.disabled) {
        el.setAttribute('aria-disabled', 'true');
        el.style.opacity = '0.35';
        el.style.cursor = 'not-allowed';
        el.style.pointerEvents = 'none';
      }

      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.textContent = item.icon;
      el.appendChild(icon);

      const label = document.createElement('span');
      label.textContent = item.label;
      label.style.flex = '1';
      el.appendChild(label);

      if (item.shortcut) {
        const sc = document.createElement('span');
        sc.className = 'canvas-ctx-shortcut';
        sc.textContent = item.shortcut;
        el.appendChild(sc);
      }

      if (!item.disabled) {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          hideContextMenu();
          if (item.action) item.action();
        });
      }

      contextMenu.appendChild(el);
    });
  }

  function positionContextMenu(clientX, clientY) {
    contextMenu.style.display = 'block';
    contextMenu.style.visibility = 'hidden';
    const menuRect = contextMenu.getBoundingClientRect();
    let x = clientX;
    let y = clientY;
    if (x + menuRect.width > window.innerWidth - 10) {
      x = window.innerWidth - menuRect.width - 10;
    }
    if (y + menuRect.height > window.innerHeight - 10) {
      y = window.innerHeight - menuRect.height - 10;
    }
    contextMenu.style.left = `${Math.max(10, x)}px`;
    contextMenu.style.top = `${Math.max(10, y)}px`;
    contextMenu.style.visibility = 'visible';
  }

  function showContextMenu(e, id) {
    e.preventDefault();
    e.stopPropagation();
    hideLatentHoverPopup(true);
    if (contextMenu.style.display === 'block') { hideContextMenu(); return; }
    draggingNode = null;
    isMarquee = false;
    ctxTargetId = id;

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    contextMenuMousePos = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());

    if (id) {
      if (!e.shiftKey && !selectedIds.has(id)) {
        clearSelection();
      }
      selectedIds.add(id);
      render();
    }

    const isCopula = gaussianCopulas.some(gc => gc.id === id);
    const isQuadratic = quadraticEffects.some(qe => qe.id === id);
    const isEdge = edges.some(edge => edge.id === id) || moderatingEffects.some(m => m.id === id);
    const isIndEdge = id && String(id).startsWith('edge_ind_');
    const targetNode = nodes.find(n => n.id === id);
    const isLatent = !isEdge && !isIndEdge && !isCopula && !isQuadratic && targetNode && targetNode.isLatent !== false && !targetNode.isText;
    const isIndicator = !isEdge && !isIndEdge && !isCopula && !isQuadratic && targetNode && !targetNode.isLatent && !targetNode.isText;

    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;
    const hasClipboard = hasClipboardData();
    const hasCanvasElements = nodes.length > 0;
    const hasSelectable = nodes.length > 0 || edges.length > 0;

    let items = [];

    if (!id || id === 'canvas') {
      // ─── Empty Canvas Menu ───
      items = [
        { id: 'ctx-undo', label: 'Undo', icon: 'undo', shortcut: '⌘Z', disabled: !canUndo, action: () => undo() },
        { id: 'ctx-redo', label: 'Redo', icon: 'redo', shortcut: '⌘⇧Z', disabled: !canRedo, action: () => redo() },
        { divider: true },
        { id: 'ctx-new-latent', label: 'New Latent Variable', icon: 'add_circle', shortcut: 'O', action: () => createAndEditNewLatentNode(contextMenuMousePos?.x, contextMenuMousePos?.y) },
        { id: 'ctx-paste', label: 'Paste', icon: 'content_paste', shortcut: '⌘V', disabled: !hasClipboard, action: () => pasteClipboard() },
        { id: 'ctx-clear-all', label: 'Clear All', icon: 'delete_sweep', danger: true, disabled: !hasCanvasElements, action: () => {
            if (window._customClearCanvasHandler) {
              window._customClearCanvasHandler();
            } else if (confirm('Are you sure you want to clear the entire canvas?')) {
              nodes = [];
              edges = [];
              selectedIds.clear();
              if (emptyHint) emptyHint.style.display = 'block';
              render();
              pushHistory();
              window.dispatchEvent(new CustomEvent('canvas-changed'));
            }
          }
        },
        { divider: true },
        { id: 'ctx-fit', label: 'Fit Screen', icon: 'fit_screen', disabled: !hasCanvasElements, action: () => fitToScreen() },
        { id: 'ctx-export', label: 'Export as Image', icon: 'image', disabled: !hasCanvasElements, action: () => exportCanvasAsImage() },
        { divider: true },
        { id: 'ctx-snap', label: isSnapping ? 'Disable Snap to Grid' : 'Enable Snap to Grid', icon: isSnapping ? 'grid_off' : 'grid_on', action: () => toggleSnapToGrid() },
        { divider: true },
        { custom: true, render: () => createGridPatternCtxElement() },
        { divider: true },
        { custom: true, render: () => createCanvasBgCtxElement() },
        { divider: true },
        { id: 'ctx-reset-styles', label: 'Reset Default Styles', icon: 'restart_alt', disabled: !hasCanvasElements && !currentBgColor && currentGrid === 'dots', action: () => {
            if (window._customResetStylesHandler) {
              window._customResetStylesHandler();
            } else {
              resetModelStyles();
            }
          }
        }
      ];
    } else if (selectedIds.size > 1 && selectedIds.has(id)) {
      const selectedNodes = nodes.filter(node => selectedIds.has(node.id));
      const latents = selectedNodes.filter(node => node.isLatent && !node.isText);
      const allLatent = selectedNodes.length > 0 && latents.length === selectedNodes.length;
      const allIndicators = selectedNodes.length > 0 && selectedNodes.every(node => !node.isLatent && !node.isText);
      const allEdges = [...selectedIds].every(selected => edges.some(edge => edge.id === selected) || moderatingEffects.some(mod => mod.id === selected) || String(selected).startsWith('edge_ind_'));
      const selectedParents = latents.filter(node => nodes.some(indicator => indicator.parentId === node.id && !indicator.isLatent));
      const updateSelected = (update) => { update(); render(); pushHistory(); window.dispatchEvent(new CustomEvent('canvas-changed')); };
      items = [
        ...(selectedNodes.length ? [
          { id: 'ctx-copy', label: 'Copy selection', icon: 'content_copy', action: () => copySelected() },
          { id: 'ctx-duplicate', label: 'Duplicate selection', icon: 'control_point_duplicate', action: () => { copySelected(); pasteClipboard(); } },
        ] : []),
        ...(selectedNodes.length > 1 ? [
          { divider: true },
          ...['left', 'right', 'top', 'bottom'].map(direction => ({ id: `ctx-align-selected-${direction}`, label: `Align selected ${direction}`, icon: 'align_horizontal_left', action: () => alignIndicators(direction) })),
        ] : []),
        ...(allLatent || allIndicators ? [
          { divider: true },
          { id: 'ctx-names-inside', label: 'Move names inside', icon: 'vertical_align_center', action: () => updateSelected(() => selectedNodes.forEach(node => { node.textInside = true; })) },
          { id: 'ctx-names-outside', label: 'Move names outside', icon: 'open_in_new', action: () => updateSelected(() => selectedNodes.forEach(node => { node.textInside = false; })) },
        ] : []),
        ...(allLatent && selectedParents.length ? [
          { id: 'ctx-hide-selected-indicators', label: selectedParents.every(node => node.indicatorsHidden) ? 'Show indicators' : 'Hide indicators', icon: 'visibility_off', action: () => updateSelected(() => {
            const hide = !selectedParents.every(node => node.indicatorsHidden);
            selectedParents.forEach(node => { node.indicatorsHidden = hide; });
            if (hide) nodes.filter(node => selectedParents.some(parent => parent.id === node.parentId)).forEach(node => { selectedIds.delete(node.id); selectedIds.delete(`edge_ind_${node.id}`); });
          }) },
        ] : []),
        { divider: true },
        { id: 'ctx-delete-selection', label: allEdges ? 'Delete connections' : 'Delete selection', icon: 'delete', danger: true, action: () => deleteSelected() },
      ];
    } else if (isLatent) {
      // ─── Latent Variable Menu ───
      const isReflective = targetNode.type !== 'formative';
      const areIndicatorsHidden = !!targetNode.indicatorsHidden;
      const childInds = nodes.filter(n => n.parentId === targetNode.id && !n.isLatent);
      const hasIndicators = childInds.length > 0;
      const isInside = !!targetNode.textInside;
      const metrics = getConstructMetrics(targetNode);
      const hasR2 = !!(metrics && metrics.r2 !== null && metrics.r2 !== undefined);
      const canMoveInside = !(hasR2 && !isInside);

      items = [
        { id: 'ctx-copy', label: 'Copy', icon: 'content_copy', shortcut: '⌘C', action: () => copySelected() },
        { id: 'ctx-paste', label: 'Paste', icon: 'content_paste', shortcut: '⌘V', disabled: !hasClipboard, action: () => pasteClipboard() },
        { id: 'ctx-duplicate', label: 'Duplicate', icon: 'control_point_duplicate', shortcut: '⌘D', action: () => duplicateNode(targetNode) },
        { divider: true },
        { id: 'ctx-rename', label: 'Rename', icon: 'edit', action: () => startInlineNodeRename(targetNode) },
        { id: 'ctx-text-inside', label: isInside ? 'Move Name Outside' : 'Move Name Inside', icon: isInside ? 'open_in_new' : 'vertical_align_center', disabled: !isInside && !canMoveInside, title: (!isInside && !canMoveInside) ? 'Move inside disabled: R² is displayed inside construct' : '', action: () => {
            if (!isInside && !canMoveInside) return;
            targetNode.textInside = !isInside;
            render();
            pushHistory();
            window.dispatchEvent(new CustomEvent('canvas-changed'));
          }
        },
        ...(!isInside ? [
          { id: 'ctx-name-top', label: 'Move Name Top', icon: 'align_vertical_top', action: () => {
              targetNode.textInside = false;
              targetNode.textPosition = 'top';
              render();
              pushHistory();
              window.dispatchEvent(new CustomEvent('canvas-changed'));
            }
          },
          { id: 'ctx-name-bottom', label: 'Move Name Bottom', icon: 'align_vertical_bottom', action: () => {
              targetNode.textInside = false;
              targetNode.textPosition = 'bottom';
              render();
              pushHistory();
              window.dispatchEvent(new CustomEvent('canvas-changed'));
            }
          },
          { id: 'ctx-name-left', label: 'Move Name Left', icon: 'align_horizontal_left', action: () => {
              targetNode.textInside = false;
              targetNode.textPosition = 'left';
              render();
              pushHistory();
              window.dispatchEvent(new CustomEvent('canvas-changed'));
            }
          },
          { id: 'ctx-name-right', label: 'Move Name Right', icon: 'align_horizontal_right', action: () => {
              targetNode.textInside = false;
              targetNode.textPosition = 'right';
              render();
              pushHistory();
              window.dispatchEvent(new CustomEvent('canvas-changed'));
            }
          }
        ] : []),
        { divider: true },
        { id: 'ctx-mode', label: isReflective ? 'Make Formative (Mode B)' : 'Make Reflective (Mode A)', icon: 'swap_horiz', action: () => {
            targetNode.type = isReflective ? 'formative' : 'reflective';
            targetNode.outer_mode = isReflective ? 'B' : 'A';
            render();
            pushHistory();
          }
        },
        { divider: true },
        { id: 'ctx-hide-ind', label: areIndicatorsHidden ? 'Show Indicators' : 'Hide Indicators', icon: areIndicatorsHidden ? 'visibility' : 'visibility_off', disabled: !hasIndicators, action: () => {
            targetNode.indicatorsHidden = !targetNode.indicatorsHidden;
            if (targetNode.indicatorsHidden) {
              // Deselect child indicators so selection state isn't dirty
              childInds.forEach(c => {
                selectedIds.delete(c.id);
                selectedIds.delete(`edge_ind_${c.id}`);
              });
            }
            render();
            pushHistory();
            window.dispatchEvent(new CustomEvent('canvas-changed'));
          }
        },
        { divider: true },
        ...(!areIndicatorsHidden && hasIndicators ? [
        { id: 'ctx-align-left', label: 'Align Indicators Left', icon: 'align_horizontal_left', disabled: !hasIndicators, action: () => alignIndicators('left', targetNode.id) },
        { id: 'ctx-align-right', label: 'Align Indicators Right', icon: 'align_horizontal_right', disabled: !hasIndicators, action: () => alignIndicators('right', targetNode.id) },
        { id: 'ctx-align-top', label: 'Align Indicators Top', icon: 'align_vertical_top', disabled: !hasIndicators, action: () => alignIndicators('top', targetNode.id) },
        { id: 'ctx-align-bottom', label: 'Align Indicators Bottom', icon: 'align_vertical_bottom', disabled: !hasIndicators, action: () => alignIndicators('bottom', targetNode.id) },
        { divider: true },
        ] : []),
        { id: 'ctx-delete', label: 'Delete', icon: 'delete', danger: true, shortcut: 'Del', action: () => deleteSelected() }
      ];
    } else if (isIndicator) {
      // ─── Indicator Node Menu ───
      const isIndInside = targetNode.textInside !== undefined ? targetNode.textInside : true;
      items = [
        { id: 'ctx-copy', label: 'Copy', icon: 'content_copy', shortcut: '⌘C', action: () => copySelected() },
        { id: 'ctx-paste', label: 'Paste', icon: 'content_paste', shortcut: '⌘V', disabled: !hasClipboard, action: () => pasteClipboard() },
        { id: 'ctx-duplicate', label: 'Duplicate', icon: 'control_point_duplicate', shortcut: '⌘D', action: () => duplicateNode(targetNode) },
        { divider: true },
        { id: 'ctx-rename', label: 'Rename', icon: 'edit', action: () => startInlineNodeRename(targetNode) },
        { id: 'ctx-text-inside', label: isIndInside ? 'Move Name Outside' : 'Move Name Inside', icon: isIndInside ? 'open_in_new' : 'vertical_align_center', action: () => {
            targetNode.textInside = !isIndInside;
            render();
            pushHistory();
            window.dispatchEvent(new CustomEvent('canvas-changed'));
          }
        },
        ...(!isIndInside ? [
          { id: 'ctx-name-top', label: 'Move Name Top', icon: 'align_vertical_top', action: () => {
              targetNode.textInside = false;
              targetNode.textPosition = 'top';
              render();
              pushHistory();
              window.dispatchEvent(new CustomEvent('canvas-changed'));
            }
          },
          { id: 'ctx-name-bottom', label: 'Move Name Bottom', icon: 'align_vertical_bottom', action: () => {
              targetNode.textInside = false;
              targetNode.textPosition = 'bottom';
              render();
              pushHistory();
              window.dispatchEvent(new CustomEvent('canvas-changed'));
            }
          },
          { id: 'ctx-name-left', label: 'Move Name Left', icon: 'align_horizontal_left', action: () => {
              targetNode.textInside = false;
              targetNode.textPosition = 'left';
              render();
              pushHistory();
              window.dispatchEvent(new CustomEvent('canvas-changed'));
            }
          },
          { id: 'ctx-name-right', label: 'Move Name Right', icon: 'align_horizontal_right', action: () => {
              targetNode.textInside = false;
              targetNode.textPosition = 'right';
              render();
              pushHistory();
              window.dispatchEvent(new CustomEvent('canvas-changed'));
            }
          }
        ] : []),
        { divider: true },
        { id: 'ctx-delete', label: 'Delete', icon: 'delete', danger: true, shortcut: 'Del', action: () => deleteSelected() }
      ];
    } else if (isIndEdge) {
      // ─── Indicator Arrow Menu ───
      const indId = String(id).replace('edge_ind_', '');
      const indNode = nodes.find(n => n.id === indId);
      const hasWaypoints = !!(indNode && indNode.edgeWaypoints && indNode.edgeWaypoints.length > 0);
      items = [
        { id: 'ctx-reset-bend', label: 'Reset Arrow Bend', icon: 'restart_alt', danger: true, disabled: !hasWaypoints, action: () => {
            if (indNode) {
              indNode.edgeWaypoints = [];
              render();
              pushHistory();
            }
          }
        }
      ];
    } else if (isCopula) {
      // ─── Gaussian Copula Menu ───
      items = [
        { id: 'ctx-delete-copula', label: 'Remove', icon: 'delete', danger: true, shortcut: 'Del', action: () => deleteSelected() },
        { id: 'ctx-select-all-outgoing', label: 'Select all outgoing paths of this source', icon: 'arrow_forward', action: () => {
            const gc = gaussianCopulas.find(c => c.id === id);
            if (gc) {
              const srcId = gc.source_construct || gc.source;
              edges.filter(e => e.sourceId === srcId).forEach(e => selectedIds.add(e.id));
              render();
            }
          }
        }
      ];
    } else if (isQuadratic) {
      // ─── Quadratic Effect Menu ───
      items = [
        { id: 'ctx-delete-quadratic', label: 'Remove Quadratic Effect', icon: 'delete', danger: true, shortcut: 'Del', action: () => deleteSelected() }
      ];
    } else if (isEdge) {
      // ─── Structural Edge Menu ───
      items = [
        { id: 'ctx-delete-edge', label: 'Delete Connection', icon: 'delete', danger: true, shortcut: 'Del', action: () => deleteSelected() }
      ];
    } else {
      // General node fallback (e.g. text notes)
      items = [
        { id: 'ctx-copy', label: 'Copy', icon: 'content_copy', shortcut: '⌘C', action: () => copySelected() },
        { id: 'ctx-paste', label: 'Paste', icon: 'content_paste', shortcut: '⌘V', disabled: !hasClipboard, action: () => pasteClipboard() },
        { id: 'ctx-duplicate', label: 'Duplicate', icon: 'control_point_duplicate', shortcut: '⌘D', action: () => duplicateNode(targetNode) },
        { divider: true },
        { id: 'ctx-rename', label: 'Rename', icon: 'edit', action: () => startInlineNodeRename(targetNode) },
        { divider: true },
        { id: 'ctx-delete', label: 'Delete', icon: 'delete', danger: true, shortcut: 'Del', action: () => deleteSelected() }
      ];
    }

    renderContextMenuItems(items);
    positionContextMenu(e.clientX, e.clientY);
  }

  svg.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, null);
  });
  if (emptyHint) {
    emptyHint.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e, null);
    });
  }

  function copySelected() {
    if (selectedIds.size === 0) return;
    
    // Find all selected latent and text nodes
    const selectedNodes = nodes.filter(n => selectedIds.has(n.id));
    
    // Automatically include child indicators of copied latent constructs
    const latentIds = new Set(selectedNodes.filter(n => n.isLatent).map(n => n.id));
    const childIndicators = nodes.filter(n => n.parentId && latentIds.has(n.parentId));
    
    const allNodesToCopy = [...selectedNodes];
    childIndicators.forEach(ind => {
      if (!allNodesToCopy.some(n => n.id === ind.id)) {
        allNodesToCopy.push(ind);
      }
    });

    const copiedNodeIds = new Set(allNodesToCopy.map(n => n.id));

    // Copy edges between any of these nodes
    const copiedEdges = edges.filter(e => copiedNodeIds.has(e.sourceId) && copiedNodeIds.has(e.targetId));

    const payload = {
      version: '1.0',
      timestamp: Date.now(),
      nodes: JSON.parse(JSON.stringify(allNodesToCopy)),
      edges: JSON.parse(JSON.stringify(copiedEdges)),
      datasetColumns: window.__activeDatasetColumns || []
    };

    window.__statsem_clipboard = payload;
    try {
      localStorage.setItem('statsem_model_clipboard', JSON.stringify(payload));
    } catch (e) {}

    console.log(`[Canvas] Copied ${allNodesToCopy.length} nodes and ${copiedEdges.length} edges.`);
  }

  function pasteClipboard() {
    let payload = window.__statsem_clipboard;
    if (!payload) {
      try {
        const stored = localStorage.getItem('statsem_model_clipboard');
        if (stored) payload = JSON.parse(stored);
      } catch (e) {}
    }

    if (!payload || !payload.nodes || payload.nodes.length === 0) return;

    // Determine current active dataset columns
    const currentDatasetCols = (window.__activeDatasetColumns || []).map(c => String(c).trim().toLowerCase());
    const hasDataset = currentDatasetCols.length > 0;

    // Calculate bounding box of copied elements
    let copiedMinX = Infinity, copiedMaxX = -Infinity;
    let copiedMinY = Infinity, copiedMaxY = -Infinity;
    payload.nodes.forEach(n => {
      copiedMinX = Math.min(copiedMinX, n.x);
      copiedMaxX = Math.max(copiedMaxX, n.x);
      copiedMinY = Math.min(copiedMinY, n.y);
      copiedMaxY = Math.max(copiedMaxY, n.y);
    });
    const copiedCenterX = (copiedMinX + copiedMaxX) / 2;
    const copiedCenterY = (copiedMinY + copiedMaxY) / 2;

    const isSameModel = payload.nodes.some(pn => nodes.some(n => n.id === pn.id));

    let shiftX = 0;
    let shiftY = 0;

    if (contextMenuMousePos) {
      // User right-clicked on canvas to paste -> place center at right-click location!
      shiftX = contextMenuMousePos.x - copiedCenterX;
      shiftY = contextMenuMousePos.y - copiedCenterY;
      contextMenuMousePos = null;
    } else if (isSameModel) {
      // Pasting within the same model -> offset slightly
      shiftX = 40;
      shiftY = 40;
    } else if (nodes.length > 0) {
      // Cross-model paste into a canvas that has an existing model:
      // Find bounding box of the existing model
      let existMinX = Infinity, existMaxX = -Infinity;
      let existMinY = Infinity, existMaxY = -Infinity;
      nodes.forEach(n => {
        existMinX = Math.min(existMinX, n.x);
        existMaxX = Math.max(existMaxX, n.x);
        existMinY = Math.min(existMinY, n.y);
        existMaxY = Math.max(existMaxY, n.y);
      });

      // Place neatly to the right of the existing model (with 80px gap), top-aligned
      shiftX = (existMaxX + 80) - copiedMinX;
      shiftY = existMinY - copiedMinY;
    } else {
      // Target model is empty -> center in the visible viewport!
      const rect = svg.getBoundingClientRect();
      const pt = svg.createSVGPoint();
      pt.x = rect.left + rect.width / 2;
      pt.y = rect.top + rect.height / 2;
      const viewCenter = pt.matrixTransform(zoomLayer.getScreenCTM().inverse());
      shiftX = viewCenter.x - copiedCenterX;
      shiftY = viewCenter.y - copiedCenterY;
    }

    const idMap = new Map();

    // Generate new unique IDs
    payload.nodes.forEach(n => {
      idMap.set(n.id, generateId());
    });

    const newNodes = [];
    let hasMissingVariables = false;

    payload.nodes.forEach(oldNode => {
      const newNode = JSON.parse(JSON.stringify(oldNode));
      newNode.id = idMap.get(oldNode.id);
      if (oldNode.parentId && idMap.has(oldNode.parentId)) {
        newNode.parentId = idMap.get(oldNode.parentId);
      }
      newNode.x = (oldNode.x || 0) + shiftX;
      newNode.y = (oldNode.y || 0) + shiftY;

      // Dataset compatibility check:
      // If indicator, check if its label exists in current dataset!
      if (!newNode.isLatent && !newNode.isText) {
        const colName = String(newNode.label || '').trim().toLowerCase();
        if (hasDataset && !currentDatasetCols.includes(colName)) {
          newNode.isMissingInDataset = true;
          newNode.datasetError = `Column "${newNode.label}" is missing from active dataset`;
          newNode.stroke = '#ef4444';
          newNode.fill = '#fef2f2';
          hasMissingVariables = true;
        } else {
          newNode.isMissingInDataset = false;
        }
      }

      newNodes.push(newNode);
    });

    const newEdges = [];
    payload.edges.forEach(oldEdge => {
      const newSource = idMap.get(oldEdge.sourceId);
      const newTarget = idMap.get(oldEdge.targetId);
      if (newSource && newTarget) {
        const newEdge = JSON.parse(JSON.stringify(oldEdge));
        newEdge.id = generateId();
        newEdge.sourceId = newSource;
        newEdge.targetId = newTarget;
        if (newEdge.waypoints) {
          newEdge.waypoints.forEach(wp => {
            wp.x += shiftX;
            wp.y += shiftY;
          });
        }
        newEdges.push(newEdge);
      }
    });

    // Add to canvas
    nodes.push(...newNodes);
    edges.push(...newEdges);

    // Select the pasted elements
    selectedIds.clear();
    newNodes.forEach(n => selectedIds.add(n.id));

    if (emptyHint) {
      emptyHint.style.display = nodes.length === 0 ? 'block' : 'none';
    }

    render();
    pushHistory();
    window.dispatchEvent(new CustomEvent('canvas-changed'));

    if (hasMissingVariables) {
      console.warn('[Canvas] Pasted elements contain indicators not in active dataset (marked in red).');
    }
  }

  function validateDatasetVariables() {
    const currentDatasetCols = (window.__activeDatasetColumns || []).map(c => String(c).trim().toLowerCase());
    if (currentDatasetCols.length === 0) return;
    nodes.forEach(n => {
      if (n.isLatent === false && !n.isText) {
        const colName = String(n.label || '').trim().toLowerCase();
        if (!currentDatasetCols.includes(colName)) {
          n.isMissingInDataset = true;
          n.datasetError = `Column "${n.label}" is missing from active dataset`;
        } else {
          n.isMissingInDataset = false;
          n.datasetError = null;
        }
      }
    });
  }

  function deleteSelected() {
    hideLatentHoverPopup(true);
    if (selectedIds.size === 0) return;

    // Reset bent indicator arrows if selected
    nodes.forEach(n => {
      if (selectedIds.has(`edge_ind_${n.id}`)) {
        n.edgeWaypoints = [];
        selectedIds.delete(`edge_ind_${n.id}`);
      }
    });

    const selectedEdges = edges.filter(e => selectedIds.has(e.id));
    const nodesToDelete = new Set(selectedIds);
    
    // Cascade delete indicators if parent construct is deleted
    nodes.forEach(n => {
      if (n.parentId && nodesToDelete.has(n.parentId)) {
        nodesToDelete.add(n.id);
      }
    });

    selectedEdges.forEach(edge => {
      const sourceNode = nodes.find(n => n.id === edge.sourceId);
      if (sourceNode && sourceNode.isLatent === false) {
         nodesToDelete.add(sourceNode.id);
      }
    });
    
    nodes = nodes.filter(n => !nodesToDelete.has(n.id));
    edges = edges.filter(e => !selectedIds.has(e.id) && !nodesToDelete.has(e.sourceId) && !nodesToDelete.has(e.targetId));

    // Handle moderating effects deletion & cascade deletion
    const initialModCount = moderatingEffects.length;
    let explicitModDeleted = false;
    let cascadeModDeleted = false;

    // Collect IDs of mods being explicitly deleted (to cascade-delete their children)
    const deletedModIds = new Set(
      moderatingEffects.filter(m => selectedIds.has(m.id)).map(m => m.id)
    );

    moderatingEffects = moderatingEffects.filter(m => {
      if (selectedIds.has(m.id)) {
        explicitModDeleted = true;
        return false;
      }
      // Cascade-delete child mods whose parent moderation is being deleted
      if (m.attachToModId && deletedModIds.has(m.attachToModId)) {
        cascadeModDeleted = true;
        return false;
      }
      if (nodesToDelete.has(m.moderator) || nodesToDelete.has(m.source) || nodesToDelete.has(m.target)) {
        cascadeModDeleted = true;
        return false;
      }
      const pathEdgeStillExists = edges.some(e => e.sourceId === m.source && e.targetId === m.target);
      if (!pathEdgeStillExists) {
        cascadeModDeleted = true;
        return false;
      }
      return true;
    });

    if (cascadeModDeleted) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Moderation effect removed (cascade)' } }));
      } catch (e) {}
    } else if (explicitModDeleted) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Moderation effect deleted' } }));
      } catch (e) {}
    }

    // Handle Gaussian copula deletion & cascade deletion
    let explicitGcDeleted = false;
    let cascadeGcDeleted = false;

    gaussianCopulas = gaussianCopulas.filter(gc => {
      if (selectedIds.has(gc.id)) {
        explicitGcDeleted = true;
        return false;
      }
      const sId = gc.source_construct || gc.source;
      const tId = gc.target_construct || gc.target;
      if (nodesToDelete.has(sId) || nodesToDelete.has(tId)) {
        cascadeGcDeleted = true;
        return false;
      }
      const pathEdgeStillExists = edges.some(e => e.sourceId === sId && e.targetId === tId);
      if (!pathEdgeStillExists) {
        cascadeGcDeleted = true;
        return false;
      }
      return true;
    });

    if (cascadeGcDeleted) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Gaussian copula removed (cascade)' } }));
      } catch (e) {}
    } else if (explicitGcDeleted) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Gaussian copula deleted' } }));
      } catch (e) {}
    }

    // Handle Quadratic effect deletion & cascade deletion
    let explicitQeDeleted = false;
    let cascadeQeDeleted = false;

    quadraticEffects = quadraticEffects.filter(qe => {
      if (selectedIds.has(qe.id)) {
        explicitQeDeleted = true;
        return false;
      }
      const pId = qe.predictor_construct || qe.predictor || qe.source;
      const tId = qe.target_construct || qe.target;
      if (nodesToDelete.has(pId) || nodesToDelete.has(tId)) {
        cascadeQeDeleted = true;
        return false;
      }
      const pathEdgeStillExists = edges.some(e => e.sourceId === pId && e.targetId === tId);
      if (!pathEdgeStillExists) {
        cascadeQeDeleted = true;
        return false;
      }
      return true;
    });

    if (cascadeQeDeleted) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Quadratic effect removed (cascade)' } }));
      } catch (e) {}
    } else if (explicitQeDeleted) {
      try {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Quadratic effect deleted' } }));
      } catch (e) {}
    }

    selectedIds.clear();
    
    if (nodes.length === 0) {
      emptyHint.style.display = 'block';
    }
    render();
    pushHistory();
  }

  // Delete key handler
  if (window._canvasKeydownHandler) {
    window.removeEventListener('keydown', window._canvasKeydownHandler);
  }
  window._canvasKeydownHandler = (e) => {
    // Check if target is input/textarea/contentEditable
    const isInput = e.target && (
      e.target.tagName === 'INPUT' || 
      e.target.tagName === 'TEXTAREA' || 
      e.target.isContentEditable ||
      e.target.getAttribute('contenteditable') === 'true'
    );
    if (isInput) return;

    if (e.key === 'Escape') {
      cancelTempConnecting();
      pendingModeratorNode = null;
      setMode('select');
      updateToolbarUI(document.querySelector('.canvas-toolbar .tb-btn[title*="Select"]'));
      render();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      if (selectedIds.size > 0) {
        deleteSelected();
      }
      return;
    }

    if (!e.metaKey && !e.ctrlKey) {
      if (e.key.toLowerCase() === 'v') {
        setMode('select');
        updateToolbarUI(document.getElementById('btn-select') || document.querySelector('.canvas-toolbar .tb-btn[title*="Select"]'));
      } else if (e.key.toLowerCase() === 'p') {
        setMode('connect');
        updateToolbarUI(document.getElementById('btn-connect') || document.querySelector('.canvas-toolbar .tb-btn[title*="Connect"], .canvas-toolbar .tb-btn[title*="Path Connector"]'));
      } else if (e.key.toLowerCase() === 'm') {
        setMode('connect');
        updateToolbarUI(document.getElementById('btn-connect') || document.querySelector('.canvas-toolbar .tb-btn[title*="Connect"], .canvas-toolbar .tb-btn[title*="Path Connector"]'));
        try {
          window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Connect mode active: Drag from a construct to the middle of a path to add moderation.' } }));
        } catch (err) {}
      } else if (e.key.toLowerCase() === 'e') {
        setMode('erase');
        updateToolbarUI(document.querySelector('.canvas-toolbar .tb-btn[title*="Erase"]'));
      } else if (e.key.toLowerCase() === 'o') {
        createAndEditNewLatentNode();
      } else if (e.key.toLowerCase() === 't') {
        createAndEditNewTextNode();
      }
    }

    // Classic Undo & Redo shortcuts
    if (e.metaKey || e.ctrlKey) {
      if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        e.stopPropagation();
        if (selectedIds.size === 1) {
          const id = Array.from(selectedIds)[0];
          const node = nodes.find(n => n.id === id);
          if (node) duplicateNode(node);
        }
        return;
      }
      if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        e.stopPropagation();
        copySelected();
        return;
      }
      if (e.key.toLowerCase() === 'v') {
        e.preventDefault();
        e.stopPropagation();
        pasteClipboard();
        return;
      }
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        e.stopPropagation();
        selectedIds.clear();
        nodes.forEach(n => selectedIds.add(n.id));
        render();
        return;
      }
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        e.stopPropagation();
        redo();
        return;
      }
    }
    
    if (selectedIds.size > 0) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        nodes.filter(n => selectedIds.has(n.id)).forEach(n => { n.bold = !n.bold; });
        render();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        nodes.filter(n => selectedIds.has(n.id)).forEach(n => { n.italic = !n.italic; });
        render();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        nodes.filter(n => selectedIds.has(n.id)).forEach(n => { n.underline = !n.underline; });
        render();
      }
      if (e.key === '=' || e.key === '+') {
        nodes.filter(n => selectedIds.has(n.id)).forEach(n => { n.fontSize = (n.fontSize || 14) + 2; });
        render();
      }
      if (e.key === '-' || e.key === '_') {
        nodes.filter(n => selectedIds.has(n.id)).forEach(n => { n.fontSize = Math.max(8, (n.fontSize || 14) - 2); });
        render();
      }
    }
  };
  window.addEventListener('keydown', window._canvasKeydownHandler);

  function exportModelSpec() {
    const latentNodes = nodes.filter(n => n.isLatent !== false && !n.isText);
    const indicatorNodes = nodes.filter(n => n.isLatent === false && !n.isText);

    const constructs = latentNodes.map(ln => {
      const childInds = indicatorNodes.filter(ind => ind.parentId === ln.id);
      const indicators = childInds.map(ind => ind.id);
      let cname = ln.label;
      if (!cname || isDefaultOrDerivedName(cname)) {
        const derived = deriveConstructName(childInds.map(i => i.label));
        if (derived) cname = derived;
      }
      return {
        id: ln.id,
        name: cname || ln.label || ln.id,
        type: ln.type === 'formative' ? 'formative' : 'reflective',
        outer_mode: ln.outer_mode || (ln.type === 'formative' ? 'B' : 'A'),
        indicators
      };
    });

    const indicators = indicatorNodes.map(ind => ({
      id: ind.id,
      column: ind.label
    }));

    const latentIds = new Set(latentNodes.map(ln => ln.id));
    const paths = edges
      .filter(e => latentIds.has(e.sourceId) && latentIds.has(e.targetId))
      .map(e => ({
        from: e.sourceId,
        to: e.targetId
      }));

    const moderating_effects = moderatingEffects.map(m => ({
      id: m.id,
      moderator: m.moderator,
      source: m.source,
      target: m.target,
      method: m.method || 'two_stage',
      standardize: m.standardize !== false,
      ...(m.attachToModId ? { attachToModId: m.attachToModId } : {})
    }));

    const gaussian_copulas = gaussianCopulas.map(gc => ({
      id: gc.id,
      source_construct: gc.source_construct || gc.source,
      target_construct: gc.target_construct || gc.target,
      node_x: gc.node_x !== undefined ? gc.node_x : gc.x,
      node_y: gc.node_y !== undefined ? gc.node_y : gc.y
    }));

    const quadratic_effects = quadraticEffects.map(qe => ({
      id: qe.id,
      predictor_construct: qe.predictor_construct || qe.predictor || qe.source,
      target_construct: qe.target_construct || qe.target,
      node_x: qe.node_x !== undefined ? qe.node_x : qe.x,
      node_y: qe.node_y !== undefined ? qe.node_y : qe.y
    }));

    return {
      constructs,
      indicators,
      paths,
      moderating_effects,
      gaussian_copulas,
      quadratic_effects
    };
  }

  function getModelCanvasState() {
    return {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
      moderatingEffects: JSON.parse(JSON.stringify(moderatingEffects)),
      gaussianCopulas: JSON.parse(JSON.stringify(gaussianCopulas)),
      quadraticEffects: JSON.parse(JSON.stringify(quadraticEffects)),
      transform: { ...transform }
    };
  }

  function loadModelCanvasState(state) {
    if (!state) return;
    if (state.nodes && Array.isArray(state.nodes)) {
      nodes = JSON.parse(JSON.stringify(state.nodes));
      // Earlier versions stripped numeric suffixes from single-item names and
      // then numbered collisions. Repair only complete, unambiguous sequences.
      const groups = new Map();
      for (const node of nodes) {
        if (node.isLatent === false || node.isText) continue;
        const children = nodes.filter(child => child.isLatent === false && child.parentId === node.id);
        if (children.length !== 1) continue;
        const match = /^(.+?)[_\-\s](\d+)$/.exec(children[0].label || '');
        if (!match) continue;
        const stem = match[1].toUpperCase();
        if (!groups.has(stem)) groups.set(stem, []);
        groups.get(stem).push({ node, indicator: children[0], number: Number(match[2]) });
      }
      for (const [stem, group] of groups) {
        if (group.length < 2) continue;
        group.sort((a, b) => a.number - b.number);
        if (!group.every(({ node }, index) => node.label === (index === 0 ? stem : `${stem}_${index}`))) continue;
        const ids = new Set(group.map(({ node }) => node.id));
        const names = group.map(({ indicator }) => indicator.label.toUpperCase());
        if (new Set(names).size !== names.length) continue;
        if (nodes.some(node => node.isLatent !== false && !ids.has(node.id) && names.includes(node.label))) continue;
        group.forEach(({ node, indicator }) => { node.label = indicator.label.toUpperCase(); });
      }
    }
    if (state.edges && Array.isArray(state.edges)) {
      edges = JSON.parse(JSON.stringify(state.edges));
    }
    if (state.moderatingEffects && Array.isArray(state.moderatingEffects)) {
      moderatingEffects = JSON.parse(JSON.stringify(state.moderatingEffects));
    } else if (state.moderating_effects && Array.isArray(state.moderating_effects)) {
      moderatingEffects = JSON.parse(JSON.stringify(state.moderating_effects));
    } else {
      moderatingEffects = [];
    }
    if (state.gaussianCopulas && Array.isArray(state.gaussianCopulas)) {
      gaussianCopulas = JSON.parse(JSON.stringify(state.gaussianCopulas));
    } else if (state.gaussian_copulas && Array.isArray(state.gaussian_copulas)) {
      gaussianCopulas = JSON.parse(JSON.stringify(state.gaussian_copulas));
    } else {
      gaussianCopulas = [];
    }
    if (state.quadraticEffects && Array.isArray(state.quadraticEffects)) {
      quadraticEffects = JSON.parse(JSON.stringify(state.quadraticEffects));
    } else if (state.quadratic_effects && Array.isArray(state.quadratic_effects)) {
      quadraticEffects = JSON.parse(JSON.stringify(state.quadratic_effects));
    } else {
      quadraticEffects = [];
    }
    if (state.transform) {
      transform = { ...state.transform };
      applyTransform();
    }
    selectedIds.clear();
    if (emptyHint) {
      emptyHint.style.display = nodes.length === 0 ? 'block' : 'none';
    }
    render();
    pushHistory();
  }

  function toggleMeasurementMode(nodeId) {
    const id = nodeId || Array.from(selectedIds)[0];
    if (!id) return;
    const node = nodes.find(n => n.id === id);
    if (node && node.isLatent !== false && !node.isText) {
      node.type = node.type === 'formative' ? 'reflective' : 'formative';
      render();
      pushHistory();
    }
  }

  function getQuadraticEffects() {
    return JSON.parse(JSON.stringify(quadraticEffects));
  }
  function setQuadraticEffects(list) {
    quadraticEffects = JSON.parse(JSON.stringify(list || []));
    render();
    pushHistory();
  }
  function deleteQuadraticEffect(id) {
    quadraticEffects = quadraticEffects.filter(q => q.id !== id);
    selectedIds.delete(id);
    render();
    pushHistory();
  }

  function getModeratingEffects() {
    return JSON.parse(JSON.stringify(moderatingEffects));
  }
  function setModeratingEffects(list) {
    moderatingEffects = JSON.parse(JSON.stringify(list || []));
    render();
    pushHistory();
  }
  function updateModeratingEffect(id, patch) {
    const mod = moderatingEffects.find(m => m.id === id);
    if (mod) {
      Object.assign(mod, patch);
      render();
      pushHistory();
    }
  }
  function deleteModeratingEffect(id) {
    moderatingEffects = moderatingEffects.filter(m => m.id !== id);
    selectedIds.delete(id);
    render();
    pushHistory();
  }
  function getSelectedModeratingEffect() {
    for (const id of selectedIds) {
      const mod = moderatingEffects.find(m => m.id === id);
      if (mod) return JSON.parse(JSON.stringify(mod));
    }
    return null;
  }

  function getGaussianCopulas() {
    return JSON.parse(JSON.stringify(gaussianCopulas));
  }
  function setGaussianCopulas(list) {
    gaussianCopulas = JSON.parse(JSON.stringify(list || []));
    render();
    pushHistory();
  }
  function deleteGaussianCopula(id) {
    gaussianCopulas = gaussianCopulas.filter(g => g.id !== id);
    selectedIds.delete(id);
    render();
    pushHistory();
  }

  window.getGaussianCopulas = getGaussianCopulas;
  window.setGaussianCopulas = setGaussianCopulas;
  window.deleteGaussianCopula = deleteGaussianCopula;
  window.getQuadraticEffects = getQuadraticEffects;
  window.setQuadraticEffects = setQuadraticEffects;
  window.deleteQuadraticEffect = deleteQuadraticEffect;
  window.handleQuadraticOnEdge = handleQuadraticOnEdge;
  window.toggleQuadraticEffectOnEdge = handleQuadraticOnEdge;
  window.getModeratingEffects = getModeratingEffects;
  window.setModeratingEffects = setModeratingEffects;
  window.updateModeratingEffect = updateModeratingEffect;
  window.deleteModeratingEffect = deleteModeratingEffect;
  window.getSelectedModeratingEffect = getSelectedModeratingEffect;
  window.exportModelSpec = exportModelSpec;
  window.getModelCanvasState = getModelCanvasState;
  window.loadModelCanvasState = loadModelCanvasState;
  window.toggleMeasurementMode = toggleMeasurementMode;
  window.deleteSelectedModelPart = deleteSelected;
  window.canvasUndo = undo;
  window.canvasRedo = redo;
  window.copySelected = copySelected;
  window.pasteClipboard = pasteClipboard;
  window.validateDatasetVariables = validateDatasetVariables;
  window.setCanvasResults = setCanvasResults;
  window.renderModelCanvas = render;
  window.clearModelCanvas = clearModelCanvas;
  window.resetModelStyles = resetModelStyles;
  window.fitToScreen = fitToScreen;
  window.toggleSnapToGrid = toggleSnapToGrid;
  window.exportCanvasAsImage = exportCanvasAsImage;
  window.createAndEditNewLatentNode = createAndEditNewLatentNode;
  window.selectCanvasNodesByVarNames = selectCanvasNodesByVarNames;
  window.startInlineNodeRename = startInlineNodeRename;
  window.getSelectedEdgeInfo = function() {
    if (selectedIds.size !== 1) return null;
    const selId = Array.from(selectedIds)[0];
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const defEdgeColor = isDark ? '#ffffff' : '#0f172a';

    const edge = edges.find(e => e.id === selId);
    if (edge) {
      const lineStyle = edge.curved ? 'curved' : (edge.strokeDasharray === '8 8' ? 'dashed' : (edge.strokeDasharray === '2 4' ? 'dotted' : 'solid'));
      const arrowhead = edge.arrowhead || 'solid';
      const color = edge.color || defEdgeColor;
      const strokeWidth = edge.strokeWidth !== undefined ? edge.strokeWidth : 2;
      return { lineStyle, arrowhead, color, strokeWidth };
    }
    const mod = moderatingEffects.find(m => m.id === selId);
    if (mod) {
      const lineStyle = mod.curved ? 'curved' : (mod.strokeDasharray === '8 8' ? 'dashed' : (mod.strokeDasharray === '2 4' ? 'dotted' : (mod.strokeDasharray === '4 4' ? 'dashed' : (mod.strokeDasharray === undefined ? 'dotted' : 'solid'))));
      const arrowhead = mod.arrowhead || 'open';
      const color = mod.color || (isDark ? '#cbd5e1' : 'rgba(107, 78, 230, 0.75)');
      const strokeWidth = mod.strokeWidth !== undefined ? mod.strokeWidth : 1.5;
      return { lineStyle, arrowhead, color, strokeWidth };
    }
    if (typeof selId === 'string' && selId.startsWith('edge_ind_')) {
      const node = nodes.find(n => `edge_ind_${n.id}` === selId);
      if (node) {
        const lineStyle = node.edgeCurved ? 'curved' : (node.edgeStrokeDasharray === '8 8' ? 'dashed' : (node.edgeStrokeDasharray === '2 4' ? 'dotted' : 'solid'));
        const arrowhead = node.edgeArrowhead || 'solid';
        const color = node.edgeColor || (isDark ? '#cbd5e1' : '#64748b');
        const strokeWidth = node.edgeStrokeWidth !== undefined ? node.edgeStrokeWidth : 1.5;
        return { lineStyle, arrowhead, color, strokeWidth };
      }
    }
    return null;
  };
  window.getSelectedNodeInfo = function() {
    if (selectedIds.size !== 1) return null;
    const selId = Array.from(selectedIds)[0];
    const node = nodes.find(n => n.id === selId);
    if (node) {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      let defFill = node.isText ? 'transparent' : (node.isLatent ? (isDark ? '#ffffff' : '#334155') : (isDark ? '#451a03' : '#fef08a'));
      let defStroke = node.isText ? 'transparent' : (node.isLatent ? (isDark ? '#ffffff' : '#1e293b') : (isDark ? '#b45309' : '#ca8a04'));
      let defColor = node.isText ? (isDark ? '#ffffff' : '#0f172a') : (node.isLatent ? (isDark ? '#0f172a' : '#ffffff') : (isDark ? '#fef08a' : '#422006'));

      const fill = node.fill !== undefined ? node.fill : defFill;
      const stroke = node.stroke !== undefined ? node.stroke : defStroke;
      const color = node.color !== undefined ? node.color : defColor;

      return {
        strokeWidth: node.strokeWidth !== undefined ? node.strokeWidth : (node.isText ? 0 : 1.5),
        textAlign: node.textAlign || 'center',
        verticalAlign: node.verticalAlign || 'middle',
        fill: fill,
        stroke: stroke,
        color: color,
        fontSize: node.fontSize || 14,
        fontFamily: node.fontFamily || 'Inter',
        bold: !!node.bold,
        italic: !!node.italic,
        underline: !!node.underline,
        textInside: node.isLatent ? !!node.textInside : (node.textInside !== undefined ? node.textInside : true),
        labelInside: node.isLatent ? !!node.textInside : (node.textInside !== undefined ? node.textInside : true),
        textPosition: node.textPosition || 'bottom',
        shape: node.shape || (node.isLatent ? 'circle' : 'rect'),
        isText: !!node.isText,
        isLatent: !!node.isLatent
      };
    }
    return null;
  };

  try {
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      const themeObserver = new MutationObserver(() => {
        render();
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-dark-variant']
      });
    }
  } catch (e) {}
}

export function copySelected() {
  if (typeof window !== 'undefined' && window.copySelected) {
    window.copySelected();
  }
}

export function pasteClipboard() {
  if (typeof window !== 'undefined' && window.pasteClipboard) {
    window.pasteClipboard();
  }
}

export function setCanvasDatasetColumns(columns) {
  if (typeof window !== 'undefined') {
    window.__activeDatasetColumns = columns || [];
    if (window.validateDatasetVariables) {
      window.validateDatasetVariables();
      if (window.renderModelCanvas) window.renderModelCanvas();
    }
  }
}

export function resetModelStyles() {
  if (typeof window !== 'undefined' && window.resetModelStyles) {
    window.resetModelStyles();
  }
}

export function clearModelCanvas() {
  if (typeof window !== 'undefined' && window.clearModelCanvas) {
    window.clearModelCanvas();
  }
}

export function renderModelCanvas() {
  if (typeof window !== 'undefined' && window.renderModelCanvas) {
    window.renderModelCanvas();
  }
}

export function setCanvasResults(results) {
  if (typeof window !== 'undefined') {
    window._canvasActiveResults = results;
    if (window.setCanvasResults) {
      window.setCanvasResults(results);
    }
  }
}

export function exportModelSpec() {
  if (typeof window !== 'undefined' && window.exportModelSpec) {
    return window.exportModelSpec();
  }
  return { constructs: [], indicators: [], paths: [] };
}

export function getModelCanvasState() {
  if (typeof window !== 'undefined' && window.getModelCanvasState) {
    return window.getModelCanvasState();
  }
  return null;
}

export function loadModelCanvasState(state) {
  if (typeof window !== 'undefined' && window.loadModelCanvasState) {
    window.loadModelCanvasState(state);
  }
}

export function toggleMeasurementMode(nodeId) {
  if (typeof window !== 'undefined' && window.toggleMeasurementMode) {
    window.toggleMeasurementMode(nodeId);
  }
}

export function deleteSelectedModelPart() {
  if (typeof window !== 'undefined' && window.deleteSelectedModelPart) {
    window.deleteSelectedModelPart();
  }
}

export function canvasUndo() {
  if (typeof window !== 'undefined' && window.canvasUndo) {
    window.canvasUndo();
  }
}

export function canvasRedo() {
  if (typeof window !== 'undefined' && window.canvasRedo) {
    window.canvasRedo();
  }
}

export function fitToScreen() {
  if (typeof window !== 'undefined' && window.fitToScreen) {
    window.fitToScreen();
  }
}

export function exportCanvasAsImage() {
  if (typeof window !== 'undefined' && window.exportCanvasAsImage) {
    window.exportCanvasAsImage();
  }
}

export function createAndEditNewLatentNode(x, y) {
  if (typeof window !== 'undefined' && window.createAndEditNewLatentNode) {
    return window.createAndEditNewLatentNode(x, y);
  }
}

export function createAndEditNewTextNode(x, y) {
  if (typeof window !== 'undefined' && window.createAndEditNewTextNode) {
    return window.createAndEditNewTextNode(x, y);
  }
}

export function hasInvalidLatentVariables() {
  if (typeof window !== 'undefined' && window.hasInvalidLatentVariables) {
    return window.hasInvalidLatentVariables();
  }
  return false;
}

export function selectCanvasNodesByVarNames(varNames) {
  if (typeof window !== 'undefined' && window.selectCanvasNodesByVarNames) {
    window.selectCanvasNodesByVarNames(varNames);
  }
}

export function getModeratingEffects() {
  if (typeof window !== 'undefined' && window.getModeratingEffects) {
    return window.getModeratingEffects();
  }
  return [];
}

export function updateModeratingEffect(id, patch) {
  if (typeof window !== 'undefined' && window.updateModeratingEffect) {
    window.updateModeratingEffect(id, patch);
  }
}

export function deleteModeratingEffect(id) {
  if (typeof window !== 'undefined' && window.deleteModeratingEffect) {
    window.deleteModeratingEffect(id);
  }
}

export function getSelectedModeratingEffect() {
  if (typeof window !== 'undefined' && window.getSelectedModeratingEffect) {
    return window.getSelectedModeratingEffect();
  }
  return null;
}

export function getQuadraticEffects() {
  if (typeof window !== 'undefined' && window.getQuadraticEffects) {
    return window.getQuadraticEffects();
  }
  return [];
}

export function setQuadraticEffects(list) {
  if (typeof window !== 'undefined' && window.setQuadraticEffects) {
    window.setQuadraticEffects(list);
  }
}

export function deleteQuadraticEffect(id) {
  if (typeof window !== 'undefined' && window.deleteQuadraticEffect) {
    window.deleteQuadraticEffect(id);
  }
}

export function toggleQuadraticEffectOnEdge(edge) {
  if (typeof window !== 'undefined' && window.toggleQuadraticEffectOnEdge) {
    return window.toggleQuadraticEffectOnEdge(edge);
  }
  return false;
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}


