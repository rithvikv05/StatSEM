/**
 * Cross-platform workspace/project path resolution helpers for the frontend.
 * Resolves the real OS home directory via Tauri's path API (with backend `/health`
 * fallback for pure browser dev mode) so workspace paths never remain literal `~`.
 */
import { api } from './api';

let cachedHomeDir: string | null = null;

function stripTrailingSeparators(p: string): string {
  if (p === '/' || /^[A-Za-z]:[\\/]?$/.test(p)) {
    return p;
  }
  return p.replace(/[/\\]+$/, '');
}

function getSeparator(basePath: string): '/' | '\\' {
  return basePath.includes('\\') ? '\\' : '/';
}

/**
 * Resolve and cache the user's home directory, preferring Tauri's native path
 * API and falling back to the backend `/health` endpoint.
 */
export async function resolveHomeDir(): Promise<string | null> {
  if (cachedHomeDir) {
    return cachedHomeDir;
  }
  try {
    const { homeDir } = await import('@tauri-apps/api/path');
    const dir = await homeDir();
    if (dir && typeof dir === 'string') {
      cachedHomeDir = stripTrailingSeparators(dir);
      return cachedHomeDir;
    }
  } catch {
    // Browser dev mode without Tauri runtime falls back to backend /health.
  }

  const health = await api.getHealth();
  if (health?.home_dir && typeof health.home_dir === 'string') {
    cachedHomeDir = stripTrailingSeparators(health.home_dir);
    return cachedHomeDir;
  }
  return null;
}

/**
 * Join segments onto a base directory using its native separator.
 */
export function joinUserPath(base: string, ...segments: string[]): string {
  const sep = getSeparator(base);
  let result = stripTrailingSeparators(base);
  for (const segment of segments) {
    const clean = segment.replace(/^[/\\]+|[/\\]+$/g, '');
    if (clean) {
      result = result ? `${result}${sep}${clean}` : clean;
    }
  }
  return result;
}

/**
 * Expand a leading `~` or `~/` (or legacy `src-tauri/~/`) path using `home` when available.
 */
export function expandLeadingTilde(rawPath: string, home: string | null): string {
  const trimmed = rawPath.trim();
  if (!home || !trimmed) {
    return trimmed;
  }
  const cleanHome = stripTrailingSeparators(home);
  if (trimmed === '~') {
    return cleanHome;
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    const rest = trimmed.slice(2).replace(/^[/\\]+/, '');
    return rest ? joinUserPath(cleanHome, rest) : cleanHome;
  }
  const legacyMatch = trimmed.match(/(?:^|[/\\])src-tauri[/\\]~[/\\](.*)$/);
  if (legacyMatch) {
    const rest = legacyMatch[1].replace(/^[/\\]+/, '');
    return rest ? joinUserPath(cleanHome, rest) : cleanHome;
  }
  return trimmed;
}

/**
 * Compute the default StatSEM workspace root (`<HOME>/StatSEM/Workspaces`).
 */
export function getDefaultWorkspacesDir(home: string | null): string {
  if (!home) {
    return '~/StatSEM/Workspaces';
  }
  return joinUserPath(home, 'StatSEM', 'Workspaces');
}

