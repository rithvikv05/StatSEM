import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Checkbox } from './Checkbox';
import { rasterizeDiagram, serializeDiagram } from '../utils/diagram-export';
import type { DiagramAppearance, DiagramBackground } from '../utils/diagram-export';
import './diagram-export.css';

interface DiagramExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  svgElement: SVGSVGElement | null;
  modelName?: string;
}

type ExportFormat = 'png' | 'svg' | 'jpg';

export const DiagramExportModal: React.FC<DiagramExportModalProps> = ({ isOpen, onClose, svgElement, modelName = 'model_diagram' }) => {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(2);
  const [appearance, setAppearance] = useState<DiagramAppearance>('color');
  const [background, setBackground] = useState<DiagramBackground>('white');
  const [includeIndicators, setIncludeIndicators] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const previewRef = useRef<HTMLImageElement>(null);

  const dimensions = useMemo(() => {
    if (!isOpen || !svgElement) return null;
    const bounds = svgElement.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return null;
    return { width: Math.round(bounds.width), height: Math.round(bounds.height) };
  }, [isOpen, svgElement]);
  const effectiveBackground = format === 'jpg' ? 'white' : background;

  useEffect(() => {
    if (!isOpen || !svgElement || !dimensions) return;
    const blob = serializeDiagram(svgElement, { ...dimensions, appearance, background: effectiveBackground, includeIndicators });
    const url = URL.createObjectURL(blob);
    if (previewRef.current) previewRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [isOpen, svgElement, dimensions, appearance, effectiveBackground, includeIndicators]);

  if (!isOpen) return null;
  const download = async () => {
    if (!svgElement || !dimensions) { setError('Open the model canvas to export its diagram.'); return; }
    setExporting(true); setError('');
    try {
      const svg = serializeDiagram(svgElement, { ...dimensions, appearance, background: effectiveBackground, includeIndicators });
      const blob = format === 'svg' ? svg : await rasterizeDiagram(svg, dimensions.width * scale, dimensions.height * scale, format);
      const filename = `${modelName.replace(/[\\/:*?"<>|\s]+/g, '_') || 'model_diagram'}.${format}`;
      if (isTauri()) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const destination = await save({ defaultPath: filename, filters: [{ name: format === 'svg' ? 'SVG image' : format === 'jpg' ? 'JPEG image' : 'PNG image', extensions: [format] }] });
        if (!destination) return;
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(destination, new Uint8Array(await blob.arrayBuffer()));
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not export the diagram.'); }
    finally { setExporting(false); }
  };

  return <div className="modal-overlay active diagram-export-overlay" role="presentation">
    <div className="modal diagram-export" role="dialog" aria-modal="true" aria-labelledby="diagram-export-title">
      <div className="modal__header"><div className="modal__title" id="diagram-export-title">Export diagram</div><button type="button" className="diagram-export__close" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="diagram-export__body">
        <div className="diagram-export__preview" data-transparent={effectiveBackground === 'transparent'}>
          {dimensions ? <img ref={previewRef} alt="Diagram export preview" onError={() => setError('Could not render the preview.')} /> : <p>Open the model canvas to preview the diagram.</p>}
        </div>
        <div className="diagram-export__settings">
          <label className="modal__field"><span className="modal__label">Format</span><select className="modal__input" value={format} onChange={e => { setFormat(e.target.value as ExportFormat); setError(''); }}><option value="png">PNG</option><option value="svg">SVG</option><option value="jpg">JPEG</option></select></label>
          {format !== 'svg' && <label className="modal__field"><span className="modal__label">Image scale</span><select className="modal__input" value={scale} onChange={e => setScale(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={3}>3×</option></select></label>}
            <label className="modal__field"><span className="modal__label">Appearance</span><select className="modal__input" value={appearance} onChange={e => setAppearance(e.target.value as DiagramAppearance)}><option value="color">Color</option><option value="monochrome">Black and white</option></select></label>
            {format !== 'jpg' && <label className="modal__field"><span className="modal__label">Background</span><select className="modal__input" value={background} onChange={e => setBackground(e.target.value as DiagramBackground)}><option value="white">White</option><option value="transparent">Transparent</option></select></label>}
            <div className="calculation-check"><Checkbox id="export-indicators" checked={includeIndicators} onChange={setIncludeIndicators}/><label htmlFor="export-indicators">Include indicators</label></div>
          {dimensions && <p className="diagram-export__hint">{format === 'svg' ? 'Vector image' : `${dimensions.width * scale} × ${dimensions.height * scale} px`}</p>}
        </div>
      </div>
      {error && <p className="diagram-export__error" role="alert">{error}</p>}
      <div className="modal__footer"><button type="button" className="modal__btn-cancel" onClick={onClose} disabled={exporting}>Cancel</button><button type="button" className="modal__btn-create" onClick={() => void download()} disabled={exporting || !dimensions}>{exporting ? 'Exporting…' : 'Export'}</button></div>
    </div>
  </div>;
};
