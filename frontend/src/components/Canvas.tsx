import React, { useEffect } from 'react';
import '../model-canvas.css';
import { initModelCanvas } from '../utils/model-canvas';

const Canvas = () => {
  useEffect(() => {
    // We need to wait a tick for the Toolbar and Sidebar DOM elements to be ready
    // before initModelCanvas binds its event listeners.
    const timer = setTimeout(() => {
      initModelCanvas();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <svg id="model-svg" width="100%" height="100%" style={{ display: 'block' }}>
        <defs>
          <pattern id="dot-grid" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="translate(0, 0) scale(1)">
            <circle cx="2" cy="2" r="1.5" fill="var(--color-border-divider)" />
          </pattern>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
          </marker>
          {/* User Defined Markers */}
          <marker id="arrow-solid" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
            <polygon points="0 1.5, 9 5, 0 8.5" fill="currentColor"/>
          </marker>
          <marker id="arrow-solid-selected" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
            <polygon points="0 1.5, 9 5, 0 8.5" fill="var(--color-accent)"/>
          </marker>
          
          <marker id="arrow-open" markerWidth="10" markerHeight="10" refX="8.5" refY="5" orient="auto">
            <path d="M 1 1.5 L 8.5 5 L 1 8.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </marker>
          <marker id="arrow-open-selected" markerWidth="10" markerHeight="10" refX="8.5" refY="5" orient="auto">
            <path d="M 1 1.5 L 8.5 5 L 1 8.5" fill="none" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </marker>

          <marker id="arrow-diamond" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
            <polygon points="1 5, 5 1.8, 9 5, 5 8.2" fill="currentColor"/>
          </marker>
          <marker id="arrow-diamond-selected" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
            <polygon points="1 5, 5 1.8, 9 5, 5 8.2" fill="var(--color-accent)"/>
          </marker>

          <marker id="arrow-circle" markerWidth="10" markerHeight="10" refX="8.5" refY="5" orient="auto">
            <circle cx="5" cy="5" r="3.5" fill="currentColor"/>
          </marker>
          <marker id="arrow-circle-selected" markerWidth="10" markerHeight="10" refX="8.5" refY="5" orient="auto">
            <circle cx="5" cy="5" r="3.5" fill="var(--color-accent)"/>
          </marker>
        </defs>
        <rect id="bg-rect" x="-5000" y="-5000" width="10000" height="10000" fill="url(#dot-grid)" />
        <g id="zoom-layer" transform="translate(0, 0) scale(1)">
          <g id="guides-layer"></g>
          <g id="edges-layer"></g>
          <g id="nodes-layer"></g>
        </g>
      </svg>

      <div id="canvas-empty-hint" style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        color: 'var(--color-text-muted)',
        fontSize: '14px',
        pointerEvents: 'none'
      }}>
        Drag variables here to create your model
      </div>

      <div className="canvas-hud">
        <div className="hud-zoom">
          <div className="hud-zoom__btn" id="hud-snap" title="Toggle Grid Snap" style={{ borderRight: '1px solid var(--color-border-divider)', padding: '0 8px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px', verticalAlign: 'middle' }}>grid_on</span>
          </div>
          <div className="hud-zoom__btn" id="hud-zoom-out">−</div>
          <div className="hud-zoom__level" id="hud-zoom-level">100%</div>
          <div className="hud-zoom__btn" id="hud-zoom-in">+</div>
        </div>
        <div className="hud-controls">
          <button className="hud-btn" id="hud-fit">Fit to Screen</button>
        </div>
      </div>
    </div>
  );
};

export default Canvas;
