// Bounds are in diagram coordinates, before the canvas pan and zoom transform.
export function getCanvasFitTransform(bounds, width, height) {
  if (!bounds || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return null;
  const padding = Math.min(48, width * 0.08, height * 0.08);
  const scale = Math.min((width - padding * 2) / Math.max(bounds.width, 1), (height - padding * 2) / Math.max(bounds.height, 1), 1.2);
  const k = Math.max(scale, 0.001);
  return { x: width / 2 - (bounds.x + bounds.width / 2) * k, y: height / 2 - (bounds.y + bounds.height / 2) * k, k };
}
