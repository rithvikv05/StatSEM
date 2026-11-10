// Theme and accent color management

export interface AccentPreset {
  id: string;
  name: string;
  color: string;
  isDefault?: boolean;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'purple', name: 'Purple', color: '#6B4EE6', isDefault: true },
  { id: 'blue', name: 'Blue', color: '#3B82F6' },
  { id: 'red', name: 'Red', color: '#F43F5E' },
  { id: 'yellow', name: 'Yellow', color: '#F59E0B' },
  { id: 'green', name: 'Green', color: '#10B981' },
];

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const cleanHex = hex.replace(/^#/, '').trim();
  let fullHex = cleanHex;
  if (cleanHex.length === 3) {
    fullHex = cleanHex.split('').map(c => c + c).join('');
  }
  if (fullHex.length !== 6) return null;
  const num = parseInt(fullHex, 16);
  if (isNaN(num)) return null;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function adjustLightness(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const adjust = (val: number) => Math.min(255, Math.max(0, Math.round(val + (255 * percent) / 100)));
  const r = adjust(rgb.r).toString(16).padStart(2, '0');
  const g = adjust(rgb.g).toString(16).padStart(2, '0');
  const b = adjust(rgb.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function getContrastTextColor(hex: string): '#FFFFFF' | '#09090B' {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#FFFFFF';
  // Relative luminance calculation
  const yiq = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return yiq >= 160 ? '#09090B' : '#FFFFFF';
}

/**
 * Dynamically applies the chosen accent color to document.documentElement
 * updating all derived CSS custom properties across light & dark themes.
 */
export function applyAccentColor(hexColor: string, isDark?: boolean) {
  const color = hexColor || '#6B4EE6';
  const rgb = hexToRgb(color) || { r: 107, g: 78, b: 230 };

  // Calculate hover shade (darker for light mode, slightly lighter for dark mode)
  const hoverColor = isDark ? adjustLightness(color, 12) : adjustLightness(color, -10);

  // Opacities calibrated for optimal readability and elegance
  const subtleAlpha = isDark ? 0.16 : 0.08;
  const mutedAlpha = isDark ? 0.26 : 0.15;
  const borderAlpha = isDark ? 0.35 : 0.25;
  const focusAlpha = isDark ? 0.35 : 0.25;

  const root = document.documentElement;
  root.style.setProperty('--color-accent', color);
  root.style.setProperty('--color-primary', color);
  root.style.setProperty('--color-accent-hover', hoverColor);
  root.style.setProperty('--color-accent-subtle', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${subtleAlpha})`);
  root.style.setProperty('--color-accent-muted', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${mutedAlpha})`);
  root.style.setProperty('--color-accent-border', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${borderAlpha})`);
  root.style.setProperty('--color-accent-focus', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${focusAlpha})`);
  root.style.setProperty('--color-accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  root.style.setProperty('--color-accent-contrast', getContrastTextColor(color));
}
