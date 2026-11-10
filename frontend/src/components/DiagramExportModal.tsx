import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Download, Image as ImageIcon, Sliders, CheckCircle2, FileCode } from 'lucide-react';

interface DiagramExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  svgElement: SVGSVGElement | null;
  modelName?: string;
  results?: any;
}

export const DiagramExportModal: React.FC<DiagramExportModalProps> = ({
  isOpen,
  onClose,
  svgElement,
  modelName = 'model_diagram',
  results,
}) => {
  const [format, setFormat] = useState<'png' | 'svg' | 'jpg'>('png');
  const [dpi, setDpi] = useState<number>(300);
  const [themeMode, setThemeMode] = useState<'color' | 'monochrome'>('color');
  const [bgMode, setBgMode] = useState<'white' | 'transparent'>('white');
  const [includeIndicators, setIncludeIndicators] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  // Calculate resolution scale from DPI
  // Standard base screen is ~96 DPI.
  // 150 DPI = 1.56x ~ 2x
  // 300 DPI = 3.125x ~ 4x
  // 600 DPI = 6.25x ~ 8x
  const scale = useMemo(() => {
    if (dpi === 600) return 6;
    if (dpi === 300) return 3;
    return 1.5;
  }, [dpi]);

  // Dimensions
  const baseDimensions = useMemo(() => {
    if (!svgElement) return { width: 1200, height: 800 };
    const rect = svgElement.getBoundingClientRect();
    return {
      width: Math.max(Math.round(rect.width) || 1200, 600),
      height: Math.max(Math.round(rect.height) || 800, 400),
    };
  }, [svgElement]);

  const exportPx = useMemo(() => {
    return {
      width: Math.round(baseDimensions.width * scale),
      height: Math.round(baseDimensions.height * scale),
    };
  }, [baseDimensions, scale]);

  const physicalDimensionsCm = useMemo(() => {
    const inchesW = exportPx.width / dpi;
    const inchesH = exportPx.height / dpi;
    return {
      wCm: (inchesW * 2.54).toFixed(1),
      hCm: (inchesH * 2.54).toFixed(1),
      wIn: inchesW.toFixed(1),
      hIn: inchesH.toFixed(1),
    };
  }, [exportPx, dpi]);

  // Clone and prepare SVG with styles applied
  const prepareSvgClone = (): SVGSVGElement | null => {
    if (!svgElement) return null;
    const clone = svgElement.cloneNode(true) as SVGSVGElement;

    // Remove UI helpers
    const unwanted = clone.querySelectorAll(
      '#canvas-empty-hint, #guides-layer, .selection-box, .guide-line, .hud-overlay'
    );
    unwanted.forEach(el => el.remove());

    if (!includeIndicators) {
      const indicators = clone.querySelectorAll('[data-type="indicator"], [data-element="indicator"], .indicator-node');
      indicators.forEach(el => el.remove());
    }

    if (themeMode === 'monochrome') {
      // 1. Shapes (nodes, constructs, indicators)
      const shapes = clone.querySelectorAll('rect, circle, polygon, ellipse');
      shapes.forEach((shape: any) => {
        // Skip background rects
        if (shape.id === 'canvas-bg' || shape.classList.contains('bg-rect')) return;
        shape.setAttribute('fill', '#ffffff');
        shape.setAttribute('stroke', '#000000');
        shape.setAttribute('stroke-width', '1.5');
      });

      // 2. Paths / Lines
      const lines = clone.querySelectorAll('path, line');
      lines.forEach((p: any) => {
        const isStructuralPath = p.classList.contains('structural-path') || p.getAttribute('data-type') === 'path';
        p.setAttribute('stroke', '#000000');
        if (isStructuralPath) {
          p.setAttribute('stroke-width', '1.5');
          // If non-significant according to results, make dashed
          const pVal = p.getAttribute('data-p-value');
          if (pVal && parseFloat(pVal) >= 0.05) {
            p.setAttribute('stroke-dasharray', '5,5');
          }
        }
      });

      // 3. Text labels
      const texts = clone.querySelectorAll('text');
      texts.forEach((txt: any) => {
        txt.setAttribute('fill', '#000000');
        txt.setAttribute('font-family', "'Times New Roman', Times, serif");
        txt.style.fill = '#000000';
        txt.style.fontFamily = "'Times New Roman', Times, serif";
      });
    }

    clone.setAttribute('width', String(baseDimensions.width));
    clone.setAttribute('height', String(baseDimensions.height));
    return clone;
  };

  // Generate live preview
  useEffect(() => {
    if (!isOpen || !svgElement) return;

    let active = true;
    const clone = prepareSvgClone();
    if (!clone) return;

    const xml = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      if (!active) {
        URL.revokeObjectURL(blobUrl);
        return;
      }
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = baseDimensions.width;
      previewCanvas.height = baseDimensions.height;
      const ctx = previewCanvas.getContext('2d');
      if (ctx) {
        if (bgMode === 'white' || format === 'jpg' || themeMode === 'monochrome') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, baseDimensions.width, baseDimensions.height);
        }
        ctx.drawImage(img, 0, 0, baseDimensions.width, baseDimensions.height);
        setPreviewDataUrl(previewCanvas.toDataURL('image/png'));
      }
      URL.revokeObjectURL(blobUrl);
    };
    img.src = blobUrl;

    return () => {
      active = false;
    };
  }, [isOpen, svgElement, format, dpi, themeMode, bgMode, includeIndicators, baseDimensions]);

  if (!isOpen) return null;

  const handleDownload = async () => {
    if (!svgElement) return;
    setIsExporting(true);

    try {
      const clone = prepareSvgClone();
      if (!clone) return;

      const filename = `${modelName.replace(/\s+/g, '_')}_${themeMode}_${dpi}dpi.${format}`;

      if (format === 'svg') {
        // Pure Vector SVG
        const xml = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = filename;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setIsExporting(false);
        onClose();
        return;
      }

      // Raster PNG or JPEG at selected DPI scale
      const xml = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = exportPx.width;
        canvas.height = exportPx.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.scale(scale, scale);

        if (bgMode === 'white' || format === 'jpg' || themeMode === 'monochrome') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, baseDimensions.width, baseDimensions.height);
        }

        ctx.drawImage(img, 0, 0, baseDimensions.width, baseDimensions.height);
        URL.revokeObjectURL(blobUrl);

        const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
        const dataUrl = canvas.toDataURL(mimeType, 0.95);

        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setIsExporting(false);
        onClose();
      };
      img.src = blobUrl;
    } catch (err) {
      console.error('Export diagram error:', err);
      setIsExporting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(15, 23, 42, 0.7)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      padding: 20,
    }}>
      <div style={{
        background: 'var(--color-bg-surface, #ffffff)',
        color: 'var(--color-text-primary, #0f172a)',
        borderRadius: 14,
        width: '100%',
        maxWidth: 820,
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
        border: '1px solid var(--color-border-subtle, #e2e8f0)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '92vh',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid var(--color-border-subtle, #e2e8f0)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'rgba(99, 102, 241, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-accent, #6366f1)',
            }}>
              <ImageIcon size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Export Publication Diagram</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted, #64748b)' }}>
                Peer-review ready vector &amp; high-DPI diagram exporter complying with journal criteria.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted, #64748b)',
              padding: 6,
              borderRadius: 6,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body (2 columns: Controls + Live Preview) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr',
          gap: 20,
          padding: 24,
          overflowY: 'auto',
          flex: 1,
        }}>
          {/* Controls Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Format Selection */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted, #64748b)' }}>
                Export Format
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 6 }}>
                {[
                  { id: 'png', label: 'PNG', desc: 'Raster' },
                  { id: 'svg', label: 'SVG', desc: 'Vector' },
                  { id: 'jpg', label: 'JPEG', desc: 'Print' },
                ].map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFormat(opt.id as any)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: format === opt.id ? '2px solid var(--color-accent, #6366f1)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                      background: format === opt.id ? 'rgba(99, 102, 241, 0.08)' : 'var(--color-bg-base, #f8fafc)',
                      color: format === opt.id ? 'var(--color-accent, #6366f1)' : 'var(--color-text-primary, #0f172a)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 13 }}>{opt.label}</div>
                    <div style={{ fontSize: 10, opacity: 0.75 }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* DPI Resolution (if raster) */}
            {format !== 'svg' && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted, #64748b)' }}>
                  Print Resolution (DPI)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 6 }}>
                  {[
                    { val: 150, label: '150 DPI', sub: 'Web / Slide' },
                    { val: 300, label: '300 DPI', sub: 'Journal' },
                    { val: 600, label: '600 DPI', sub: 'High Print' },
                  ].map(opt => (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => setDpi(opt.val)}
                      style={{
                        padding: '8px 6px',
                        borderRadius: 8,
                        border: dpi === opt.val ? '2px solid var(--color-accent, #6366f1)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                        background: dpi === opt.val ? 'rgba(99, 102, 241, 0.08)' : 'var(--color-bg-base, #f8fafc)',
                        color: dpi === opt.val ? 'var(--color-accent, #6366f1)' : 'var(--color-text-primary, #0f172a)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 12 }}>{opt.label}</div>
                      <div style={{ fontSize: 9.5, opacity: 0.75 }}>{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Appearance Theme */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted, #64748b)' }}>
                Appearance Style
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setThemeMode('color')}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: themeMode === 'color' ? '2px solid var(--color-accent, #6366f1)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                    background: themeMode === 'color' ? 'rgba(99, 102, 241, 0.08)' : 'var(--color-bg-base, #f8fafc)',
                    color: themeMode === 'color' ? 'var(--color-accent, #6366f1)' : 'var(--color-text-primary, #0f172a)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Presentation Color
                </button>
                <button
                  type="button"
                  onClick={() => setThemeMode('monochrome')}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: themeMode === 'monochrome' ? '2px solid var(--color-accent, #6366f1)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                    background: themeMode === 'monochrome' ? 'rgba(99, 102, 241, 0.08)' : 'var(--color-bg-base, #f8fafc)',
                    color: themeMode === 'monochrome' ? 'var(--color-accent, #6366f1)' : 'var(--color-text-primary, #0f172a)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Journal B&amp;W Mode
                </button>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--color-text-muted, #64748b)' }}>
                {themeMode === 'monochrome'
                  ? 'High-contrast monochrome strokes, white fills, and dashed lines for non-significant paths.'
                  : 'Maintains current canvas theme, custom construct colors, and stroke styles.'}
              </p>
            </div>

            {/* Background */}
            {format !== 'jpg' && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted, #64748b)' }}>
                  Background
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => setBgMode('white')}
                    style={{
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: bgMode === 'white' ? '2px solid var(--color-accent, #6366f1)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                      background: bgMode === 'white' ? 'rgba(99, 102, 241, 0.08)' : 'var(--color-bg-base, #f8fafc)',
                      color: bgMode === 'white' ? 'var(--color-accent, #6366f1)' : 'var(--color-text-primary, #0f172a)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Solid White (#FFF)
                  </button>
                  <button
                    type="button"
                    onClick={() => setBgMode('transparent')}
                    style={{
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: bgMode === 'transparent' ? '2px solid var(--color-accent, #6366f1)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                      background: bgMode === 'transparent' ? 'rgba(99, 102, 241, 0.08)' : 'var(--color-bg-base, #f8fafc)',
                      color: bgMode === 'transparent' ? 'var(--color-accent, #6366f1)' : 'var(--color-text-primary, #0f172a)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Transparent
                  </button>
                </div>
              </div>
            )}

            {/* Indicator Blocks Checkbox */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <input
                type="checkbox"
                id="inc-indicators"
                checked={includeIndicators}
                onChange={(e) => setIncludeIndicators(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="inc-indicators" style={{ fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
                Include measurement indicators &amp; outer loadings
              </label>
            </div>

            {/* Calculated Dimension Info Card */}
            <div style={{
              background: 'var(--color-bg-base, #f8fafc)',
              borderRadius: 8,
              padding: '10px 14px',
              border: '1px solid var(--color-border-subtle, #e2e8f0)',
              fontSize: 11.5,
              color: 'var(--color-text-muted, #64748b)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}>
              <div><strong>Pixel Dimensions:</strong> {exportPx.width} × {exportPx.height} px</div>
              <div><strong>Print Physical Size:</strong> {physicalDimensionsCm.wCm} × {physicalDimensionsCm.hCm} cm ({physicalDimensionsCm.wIn} × {physicalDimensionsCm.hIn} in)</div>
            </div>
          </div>

          {/* Live Preview Column */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--color-bg-base, #f1f5f9)',
            borderRadius: 10,
            border: '1px solid var(--color-border-subtle, #e2e8f0)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--color-border-subtle, #e2e8f0)',
              fontSize: 11.5,
              fontWeight: 600,
              color: 'var(--color-text-muted, #64748b)',
              display: 'flex',
              justifyContent: 'space-between',
            }}>
              <span>Live Export Preview</span>
              <span>{themeMode === 'monochrome' ? 'Journal B&W' : 'Color'}</span>
            </div>

            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              background: bgMode === 'transparent' && format !== 'jpg' ? 'repeating-conic-gradient(#e2e8f0 0% 25%, #fff 0% 50%) 50% / 16px 16px' : '#ffffff',
              minHeight: 280,
              overflow: 'hidden',
            }}>
              {previewDataUrl ? (
                <img
                  src={previewDataUrl}
                  alt="Diagram Preview"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '320px',
                    objectFit: 'contain',
                    borderRadius: 4,
                    boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
                  }}
                />
              ) : (
                <div style={{ fontSize: 13, color: 'var(--color-text-muted, #94a3b8)' }}>
                  Loading preview...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--color-border-subtle, #e2e8f0)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--color-bg-surface, #ffffff)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--color-border-subtle, #e2e8f0)',
              background: 'transparent',
              color: 'var(--color-text-primary, #0f172a)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={isExporting}
            style={{
              padding: '9px 20px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--color-accent, #6366f1)',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              cursor: isExporting ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 2px 8px rgba(99, 102, 241, 0.35)',
            }}
          >
            <Download size={15} />
            {isExporting ? 'Generating...' : `Export ${format.toUpperCase()} (${dpi} DPI)`}
          </button>
        </div>
      </div>
    </div>
  );
};
