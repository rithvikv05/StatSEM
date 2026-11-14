export type DiagramAppearance = 'color' | 'monochrome';
export type DiagramBackground = 'white' | 'transparent';

export interface DiagramExportOptions {
  width: number;
  height: number;
  appearance: DiagramAppearance;
  background: DiagramBackground;
  includeIndicators: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_PROPERTIES = ['fill', 'stroke', 'color', 'fill-opacity', 'stroke-opacity', 'opacity', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'visibility', 'display', 'paint-order'] as const;

/** Is this resolved CSS color close enough to white to disappear on white paper? */
export function isNearWhite(color: string): boolean {
  const match = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return !!match && Number(match[1]) > 235 && Number(match[2]) > 235 && Number(match[3]) > 235;
}

/** Clone the visible diagram and make its styles independent of the application theme. */
export function prepareDiagramSvg(source: SVGSVGElement, options: DiagramExportOptions): SVGSVGElement {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const originals = [source, ...Array.from(source.querySelectorAll('*'))];
  const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];
  originals.forEach((original, index) => {
    const copy = copies[index] as SVGElement | undefined;
    if (!copy?.style) return;
    const style = window.getComputedStyle(original);
    const strokeVal = style.getPropertyValue('stroke') || '';
    const strokeW = style.getPropertyValue('stroke-width') || '';
    const isHitPath = strokeVal.includes('0.001') || strokeVal.includes('0.01') || (parseFloat(strokeW) >= 16 && strokeVal.includes('rgba('));

    const isEdge = !!original.closest('#edges-layer, [data-export-edge]') && !original.closest('.edge-result-badge, [data-export-badge]');
    const isMarker = !!original.closest('marker');
    for (const property of STYLE_PROPERTIES) {
      let value = style.getPropertyValue(property);
      if (!value) continue;
      // Dark canvas edges and arrowheads need contrast when placed on white paper.
      if (options.background === 'white' && (isEdge || isMarker) && (property === 'stroke' || (isMarker && property === 'fill') || (isEdge && original.tagName.toLowerCase() === 'text' && property === 'fill')) && isNearWhite(value)) value = '#1f2937';
      copy.style.setProperty(property, value);
    }
    if (options.appearance === 'monochrome' && !isHitPath) {
      const tag = original.tagName.toLowerCase();
      const fill = style.getPropertyValue('fill');
      const stroke = style.getPropertyValue('stroke');
      if (tag === 'text' || tag === 'tspan') copy.style.setProperty('fill', '#000000');
      else if (['rect', 'circle', 'ellipse', 'polygon', 'path'].includes(tag) && fill && fill !== 'none') {
        copy.style.setProperty('fill', isMarker || tag === 'path' ? '#000000' : '#ffffff');
        if (!isMarker && tag !== 'path') copy.style.setProperty('stroke', '#000000');
      }
      if (stroke && stroke !== 'none') copy.style.setProperty('stroke', '#000000');
    }
  });

  // Remove non-exportable and invisible hit elements after style resolution so 1-to-1 index stays intact
  clone.querySelectorAll(
    '#bg-color-rect, #bg-rect, #guides-layer, [data-export-ui], .selection-marquee, ' +
    '.canvas-hidden-indicators-icon-btn, .copula-hover-indicator, .quadratic-hover-indicator, ' +
    '.edge-halo, .hit-path, [data-hit-path]'
  ).forEach(element => element.remove());

  clone.querySelectorAll('path').forEach(p => {
    const s = p.getAttribute('style') || '';
    if (s.includes('0.001') || s.includes('0.01') || p.style.stroke?.includes('0.001') || p.style.stroke?.includes('0.01')) {
      p.remove();
    }
  });

  if (!options.includeIndicators) clone.querySelectorAll('[data-export-indicator="true"], .indicator-badge').forEach(element => element.remove());
  clone.setAttribute('width', String(options.width));
  clone.setAttribute('height', String(options.height));
  clone.setAttribute('viewBox', `0 0 ${options.width} ${options.height}`);
  clone.style.width = `${options.width}px`;
  clone.style.height = `${options.height}px`;
  clone.style.background = 'transparent';
  if (options.background === 'white') {
    const background = document.createElementNS(SVG_NS, 'rect');
    background.setAttribute('width', '100%');
    background.setAttribute('height', '100%');
    background.setAttribute('fill', '#ffffff');
    clone.insertBefore(background, clone.querySelector('#zoom-layer'));
  }
  return clone;
}

export function serializeDiagram(svg: SVGSVGElement, options: DiagramExportOptions): Blob {
  return new Blob([new XMLSerializer().serializeToString(prepareDiagramSvg(svg, options))], { type: 'image/svg+xml;charset=utf-8' });
}

export async function rasterizeDiagram(svg: Blob, width: number, height: number, format: 'png' | 'jpg'): Promise<Blob> {
  if (width * height > 64_000_000 || width > 16384 || height > 16384) throw new Error('The image is too large. Choose a smaller scale.');
  const url = URL.createObjectURL(svg);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not render the diagram.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create an image canvas.');
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the image.')), format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95));
  } finally { URL.revokeObjectURL(url); }
}
