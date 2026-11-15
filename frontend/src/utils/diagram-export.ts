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
    const isEdge = !!original.closest('#edges-layer, [data-export-edge]') && !original.closest('.edge-result-badge, [data-export-badge]');
    const isMarker = !!original.closest('marker');
    for (const property of STYLE_PROPERTIES) {
      let value = style.getPropertyValue(property);
      if (!value) continue;
      // Dark canvas edges and arrowheads need contrast when placed on white paper.
      if (options.background === 'white' && (isEdge || isMarker) && (property === 'stroke' || (isMarker && property === 'fill') || (isEdge && original.tagName.toLowerCase() === 'text' && property === 'fill')) && isNearWhite(value)) value = '#1f2937';
      copy.style.setProperty(property, value);
    }
    if (options.appearance === 'monochrome') {
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
  clone.querySelectorAll('#bg-color-rect, #bg-rect, #guides-layer, [data-export-ui], .selection-marquee, .canvas-hidden-indicators-icon-btn, .copula-hover-indicator, .quadratic-hover-indicator').forEach(element => element.remove());
  if (!options.includeIndicators) clone.querySelectorAll('[data-export-indicator="true"], .indicator-badge').forEach(element => element.remove());

  // Determine true diagram bounds without user zoom/pan clipping
  const zoomLayer = clone.querySelector('#zoom-layer') as SVGGraphicsElement | null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  if (zoomLayer) {
    // Reset any transform on zoom layer so coordinates are in true canvas space
    if (typeof zoomLayer.removeAttribute === 'function') {
      zoomLayer.removeAttribute('transform');
    } else if (typeof zoomLayer.setAttribute === 'function') {
      zoomLayer.setAttribute('transform', '');
    }

    // Attempt getBBox by mounting clone offscreen in the document
    if (typeof document !== 'undefined' && document.body && typeof document.createElement === 'function') {
      const tempWrapper = document.createElement('div');
      tempWrapper.style.position = 'fixed';
      tempWrapper.style.top = '-99999px';
      tempWrapper.style.left = '-99999px';
      tempWrapper.style.visibility = 'hidden';
      tempWrapper.style.display = 'block';
      tempWrapper.appendChild(clone);
      document.body.appendChild(tempWrapper);
      try {
        if (typeof zoomLayer.getBBox === 'function') {
          const rawBox = zoomLayer.getBBox();
          if (rawBox && rawBox.width > 20 && rawBox.height > 20) {
            minX = rawBox.x;
            minY = rawBox.y;
            maxX = rawBox.x + rawBox.width;
            maxY = rawBox.y + rawBox.height;
          }
        }
      } catch (e) {
        // Fall back to coordinate parsing below
      } finally {
        if (typeof tempWrapper.remove === 'function') {
          tempWrapper.remove();
        } else if (tempWrapper.parentNode) {
          tempWrapper.parentNode.removeChild(tempWrapper);
        }
      }
    }

    // Fallback: parse transform translate coordinates from nodes and circles if getBBox didn't work
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX) {
      clone.querySelectorAll('#nodes-layer > g, #edges-layer > path').forEach(el => {
        const trans = el.getAttribute('transform');
        if (trans) {
          const match = trans.match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/);
          if (match) {
            const x = Number(match[1]);
            const y = Number(match[2]);
            if (Number.isFinite(x) && Number.isFinite(y)) {
              minX = Math.min(minX, x - 70);
              minY = Math.min(minY, y - 70);
              maxX = Math.max(maxX, x + 70);
              maxY = Math.max(maxY, y + 70);
            }
          }
        }
      });
    }
  }

  // If bounds couldn't be determined, use options width/height
  const pad = 40;
  let finalX = 0;
  let finalY = 0;
  let finalWidth = options.width || 800;
  let finalHeight = options.height || 500;

  if (Number.isFinite(minX) && Number.isFinite(maxX) && maxX > minX && maxY > minY) {
    finalX = Math.round(minX - pad);
    finalY = Math.round(minY - pad);
    finalWidth = Math.round(maxX - minX + pad * 2);
    finalHeight = Math.round(maxY - minY + pad * 2);
  }

  clone.setAttribute('width', String(finalWidth));
  clone.setAttribute('height', String(finalHeight));
  clone.setAttribute('viewBox', `${finalX} ${finalY} ${finalWidth} ${finalHeight}`);
  clone.style.width = `${finalWidth}px`;
  clone.style.height = `${finalHeight}px`;
  clone.style.background = 'transparent';

  if (options.background === 'white') {
    const background = document.createElementNS(SVG_NS, 'rect');
    background.setAttribute('x', String(finalX));
    background.setAttribute('y', String(finalY));
    background.setAttribute('width', String(finalWidth));
    background.setAttribute('height', String(finalHeight));
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
