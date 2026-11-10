/**
 * License utilities — wraps Tauri invoke calls for license operations.
 * 
 * In dev mode (debug builds), the Rust backend auto-generates a developer
 * license, so no activation is needed during development.
 */

import { invoke } from '@tauri-apps/api/core';

// ─── Types ─────────────────────────────────────────────────────────────

export interface LicenseStatus {
  is_valid: boolean;
  tier: string;
  mode: string; // "node_locked" | "floating"
  licensee: string;
  email: string;
  license_key: string;
  expires_at: string;
  days_remaining: number;
  features: string[];
  machine_id: string;
  max_machines: number;
  max_seats: number;
  error: string | null;
}

// ─── Tauri Invoke Wrappers ─────────────────────────────────────────────

/**
 * Get the current license status.
 * In dev mode, this auto-activates a developer license on first call.
 */
export async function getLicenseStatus(): Promise<LicenseStatus> {
  try {
    return await invoke<LicenseStatus>('get_license_status');
  } catch (err) {
    console.error('[license] Failed to get status:', err);
    return {
      is_valid: false,
      tier: 'none',
      mode: 'none',
      licensee: '',
      email: '',
      license_key: '',
      expires_at: '',
      days_remaining: 0,
      features: [],
      machine_id: '',
      max_machines: 0,
      max_seats: 0,
      error: String(err),
    };
  }
}

/**
 * Activate a license with a token string.
 * For now, this accepts a full signed token string.
 * In the future, this will accept just a license key and contact the server.
 */
export async function activateLicense(tokenString: string): Promise<LicenseStatus> {
  return await invoke<LicenseStatus>('activate_license', { tokenString });
}

/**
 * Deactivate the current license (clear from disk).
 */
export async function deactivateLicense(): Promise<void> {
  return await invoke<void>('deactivate_license');
}

/**
 * Get the machine fingerprint ID for this device.
 */
export async function getMachineFingerprint(): Promise<string> {
  return await invoke<string>('get_machine_fingerprint');
}

/**
 * Export the current license token string (for backup/transfer).
 */
export async function exportLicenseToken(): Promise<string> {
  return await invoke<string>('export_license_token');
}

/**
 * [Dev only] Mint a test license token.
 */
export async function devMintToken(
  licensee: string,
  tier: string,
  mode: string,
  daysValid: number
): Promise<string> {
  return await invoke<string>('dev_mint_token', {
    licensee,
    tier,
    mode,
    daysValid,
  });
}

// ─── License Token Cache (for API calls) ───────────────────────────────

let _cachedTokenString: string | null = null;
let _tokenLoaded = false;
let _tokenRequest: Promise<string | null> | null = null;
let _tokenGeneration = 0;

/**
 * Get the cached license token string for API header injection.
 * Returns null if no license is activated.
 */
export async function getCachedTokenString(): Promise<string | null> {
  if (_tokenLoaded) return _cachedTokenString;
  if (_tokenRequest) return _tokenRequest;
  const generation = _tokenGeneration;
  const request = invoke<string>('export_license_token').catch(() => null).then(token => {
    if (generation === _tokenGeneration) {
      _cachedTokenString = token;
      _tokenLoaded = true;
      _tokenRequest = null;
    }
    return token;
  });
  _tokenRequest = request;
  return request;
}

/**
 * Clear the cached token (call after deactivation).
 */
export function clearCachedToken(): void {
  _tokenGeneration++;
  _cachedTokenString = null;
  _tokenLoaded = false;
  _tokenRequest = null;
}

/**
 * Check if a specific feature is available in the current license.
 */
export function hasFeature(status: LicenseStatus, feature: string): boolean {
  return status.is_valid && status.features.includes(feature);
}

/**
 * Get a human-readable description of the license tier.
 */
export function getTierLabel(tier: string): string {
  const labels: Record<string, string> = {
    trial: 'Free Trial',
    student: 'Student',
    researcher: 'Individual Researcher',
    lab: 'Lab / Team',
    institutional: 'Institutional',
    developer: 'Developer',
  };
  return labels[tier.toLowerCase()] || tier;
}

/**
 * Get a human-readable description of the license mode.
 */
export function getModeLabel(mode: string): string {
  return mode === 'floating' ? 'Floating (Concurrent Seats)' : 'Node-Locked (Machine-Bound)';
}
