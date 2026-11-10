pub mod fingerprint;
pub mod keystore;
pub mod token;

use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use fingerprint::get_machine_id;
use token::{
    decode_signing_key, decode_verifying_key, encode_signing_key, encode_verifying_key,
    generate_keypair, validate_payload, LicenseMode, LicensePayload, LicenseTier, SignedToken,
};

// ─── Embedded Public Key ───────────────────────────────────────────────
// In production, this would be a hardcoded constant compiled into the binary.
// For development, we load it from the dev keypair file.
// When you're ready for production, replace this with:
//   const PROD_VERIFYING_KEY: &str = "your_base64_encoded_public_key";

/// Get the path to the dev keypair directory.
fn dev_keys_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("StatSEM")
        .join("dev_keys")
}

/// Ensure a dev keypair exists; generate one if not.
fn ensure_dev_keypair() -> Result<(String, String), String> {
    let dir = dev_keys_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dev_keys dir: {}", e))?;

    let sk_path = dir.join("signing_key.b64");
    let vk_path = dir.join("verifying_key.b64");

    if sk_path.exists() && vk_path.exists() {
        let sk = fs::read_to_string(&sk_path)
            .map_err(|e| format!("Failed to read signing key: {}", e))?;
        let vk = fs::read_to_string(&vk_path)
            .map_err(|e| format!("Failed to read verifying key: {}", e))?;
        return Ok((sk.trim().to_string(), vk.trim().to_string()));
    }

    log::info!("Generating new dev keypair...");
    let (signing_key, verifying_key) = generate_keypair();
    let sk_b64 = encode_signing_key(&signing_key);
    let vk_b64 = encode_verifying_key(&verifying_key);

    fs::write(&sk_path, &sk_b64).map_err(|e| format!("Failed to write signing key: {}", e))?;
    fs::write(&vk_path, &vk_b64).map_err(|e| format!("Failed to write verifying key: {}", e))?;

    log::info!("Dev keypair written to {:?}", dir);
    Ok((sk_b64, vk_b64))
}

/// Get the verifying (public) key.
/// In debug mode: loads from dev keypair file.
/// In release mode: would use the embedded constant.
fn get_verifying_key_b64() -> Result<String, String> {
    // In debug (dev) mode, use the dev keypair
    if cfg!(debug_assertions) {
        let (_, vk_b64) = ensure_dev_keypair()?;
        return Ok(vk_b64);
    }

    // In release mode, you would use a hardcoded key:
    // return Ok(PROD_VERIFYING_KEY.to_string());

    // For now, fall back to dev keypair even in release
    // TODO: Replace with hardcoded production key before shipping
    let (_, vk_b64) = ensure_dev_keypair()?;
    Ok(vk_b64)
}

// ─── License Status (returned to frontend) ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseStatus {
    pub is_valid: bool,
    pub tier: String,
    pub mode: String,
    pub licensee: String,
    pub email: String,
    pub license_key: String,
    pub expires_at: String,
    pub days_remaining: i64,
    pub features: Vec<String>,
    pub machine_id: String,
    pub max_machines: u32,
    pub max_seats: u32,
    pub error: Option<String>,
}

impl LicenseStatus {
    fn invalid(machine_id: &str, error: &str) -> Self {
        LicenseStatus {
            is_valid: false,
            tier: "none".to_string(),
            mode: "none".to_string(),
            licensee: String::new(),
            email: String::new(),
            license_key: String::new(),
            expires_at: String::new(),
            days_remaining: 0,
            features: vec![],
            machine_id: machine_id.to_string(),
            max_machines: 0,
            max_seats: 0,
            error: Some(error.to_string()),
        }
    }

    fn from_payload(payload: &LicensePayload, machine_id: &str) -> Self {
        let now = Utc::now();
        let days_remaining = (payload.expires_at - now).num_days().max(0);

        LicenseStatus {
            is_valid: true,
            tier: payload.tier.to_string(),
            mode: match payload.mode {
                LicenseMode::NodeLocked => "node_locked".to_string(),
                LicenseMode::Floating => "floating".to_string(),
            },
            licensee: payload.licensee.clone(),
            email: payload.email.clone().unwrap_or_default(),
            license_key: payload.license_key.clone(),
            expires_at: payload.expires_at.to_rfc3339(),
            days_remaining,
            features: payload.features.clone(),
            machine_id: machine_id.to_string(),
            max_machines: payload.max_machines,
            max_seats: payload.max_seats,
            error: None,
        }
    }
}

// ─── Global license cache ──────────────────────────────────────────────

// Thread-safe cache for validated license payload
static LICENSE_CACHE: Mutex<Option<LicensePayload>> = Mutex::new(None);

// ─── Tauri Commands ────────────────────────────────────────────────────

/// Check current license status without requiring activation.
#[tauri::command]
pub async fn get_license_status() -> Result<LicenseStatus, String> {
    tauri::async_runtime::spawn_blocking(get_license_status_sync)
        .await
        .map_err(|e| e.to_string())?
}

fn get_license_status_sync() -> Result<LicenseStatus, String> {
    let machine_id = get_machine_id();

    // Check cache first
    if let Ok(cache) = LICENSE_CACHE.lock() {
        if let Some(ref payload) = *cache {
            if validate_payload(payload, &machine_id).is_ok() {
                return Ok(LicenseStatus::from_payload(payload, &machine_id));
            }
        }
    }

    // In dev mode, auto-generate a license if none exists
    if cfg!(debug_assertions) && !keystore::has_token() {
        log::info!("Dev mode: auto-generating developer license");
        if let Ok(status) = auto_activate_dev(&machine_id) {
            return Ok(status);
        }
    }

    // Try to load from keystore
    match keystore::load_token(&machine_id) {
        Ok(Some(signed_token)) => {
            let vk_b64 = get_verifying_key_b64()?;
            let vk = decode_verifying_key(&vk_b64)?;

            match signed_token.verify(&vk) {
                Ok(payload) => {
                    match validate_payload(&payload, &machine_id) {
                        Ok(()) => {
                            // Cache the valid payload
                            if let Ok(mut cache) = LICENSE_CACHE.lock() {
                                *cache = Some(payload.clone());
                            }
                            Ok(LicenseStatus::from_payload(&payload, &machine_id))
                        }
                        Err(e) => Ok(LicenseStatus::invalid(&machine_id, &e)),
                    }
                }
                Err(e) => Ok(LicenseStatus::invalid(&machine_id, &e)),
            }
        }
        Ok(None) => Ok(LicenseStatus::invalid(
            &machine_id,
            "No license activated. Please enter your license key.",
        )),
        Err(e) => Ok(LicenseStatus::invalid(&machine_id, &e)),
    }
}

/// Activate a license using a token string.
/// In the future, this will contact the license server with just a key.
/// For now, it accepts a full signed token string (for dev/testing).
#[tauri::command]
pub async fn activate_license(token_string: String) -> Result<LicenseStatus, String> {
    tauri::async_runtime::spawn_blocking(move || activate_license_sync(token_string))
        .await
        .map_err(|e| e.to_string())?
}

fn activate_license_sync(token_string: String) -> Result<LicenseStatus, String> {
    let machine_id = get_machine_id();

    // Parse the signed token
    let signed_token = SignedToken::from_token_string(&token_string)?;

    // Verify signature
    let vk_b64 = get_verifying_key_b64()?;
    let vk = decode_verifying_key(&vk_b64)?;
    let payload = signed_token.verify(&vk)?;

    // Validate payload (expiry, machine binding)
    validate_payload(&payload, &machine_id)?;

    // Store encrypted on disk
    keystore::store_token(&signed_token, &machine_id)?;

    // Update cache
    if let Ok(mut cache) = LICENSE_CACHE.lock() {
        *cache = Some(payload.clone());
    }

    log::info!(
        "License activated: {} ({})",
        payload.license_key,
        payload.tier
    );
    Ok(LicenseStatus::from_payload(&payload, &machine_id))
}

/// Deactivate the current license (clear from disk and cache).
#[tauri::command]
pub async fn deactivate_license() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(deactivate_license_sync)
        .await
        .map_err(|e| e.to_string())?
}

fn deactivate_license_sync() -> Result<(), String> {
    keystore::clear_token()?;
    if let Ok(mut cache) = LICENSE_CACHE.lock() {
        *cache = None;
    }
    log::info!("License deactivated");
    Ok(())
}

/// Get the machine fingerprint ID for this device.
#[tauri::command]
pub async fn get_machine_fingerprint() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(get_machine_id)
        .await
        .map_err(|e| e.to_string())
}

/// Export the current license token string (for backup/transfer).
#[tauri::command]
pub async fn export_license_token() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(export_license_token_sync)
        .await
        .map_err(|e| e.to_string())?
}

fn export_license_token_sync() -> Result<String, String> {
    let machine_id = get_machine_id();
    match keystore::load_token(&machine_id)? {
        Some(token) => Ok(token.to_token_string()),
        None => Err("No active license to export".to_string()),
    }
}

// ─── Dev-only: Auto-activate a developer license ───────────────────────

fn auto_activate_dev(machine_id: &str) -> Result<LicenseStatus, String> {
    let (sk_b64, _) = ensure_dev_keypair()?;
    let signing_key = decode_signing_key(&sk_b64)?;

    let payload = LicensePayload {
        license_key: format!("STATSEM-DEV-{}", &machine_id[7..15]),
        mode: LicenseMode::NodeLocked,
        tier: LicenseTier::Developer,
        machine_id: Some(machine_id.to_string()),
        licensee: "Developer".to_string(),
        email: Some("dev@statsem.local".to_string()),
        issued_at: Utc::now(),
        expires_at: Utc::now() + Duration::days(3650), // 10 years for dev
        max_machines: 99,
        max_seats: 0,
        features: vec![
            "pls_basic".to_string(),
            "bootstrap".to_string(),
            "mediation".to_string(),
            "moderation".to_string(),
            "quadratic".to_string(),
            "ipma".to_string(),
            "mga".to_string(),
            "fimix".to_string(),
            "cta".to_string(),
            "micom".to_string(),
            "hcm".to_string(),
            "blindfolding".to_string(),
            "power_analysis".to_string(),
        ],
    };

    let signed_token = SignedToken::sign(&payload, &signing_key)?;
    keystore::store_token(&signed_token, machine_id)?;

    if let Ok(mut cache) = LICENSE_CACHE.lock() {
        *cache = Some(payload.clone());
    }

    log::info!("Dev license auto-activated: {}", payload.license_key);
    Ok(LicenseStatus::from_payload(&payload, machine_id))
}

// ─── Dev-only: Mint a test license token ───────────────────────────────

/// Generate a signed license token for testing purposes.
/// Only available in debug builds.
#[tauri::command]
pub async fn dev_mint_token(
    licensee: String,
    tier: String,
    mode: String,
    days_valid: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        dev_mint_token_sync(licensee, tier, mode, days_valid)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn dev_mint_token_sync(
    licensee: String,
    tier: String,
    mode: String,
    days_valid: u32,
) -> Result<String, String> {
    if !cfg!(debug_assertions) {
        return Err("Token minting is only available in development builds".to_string());
    }

    let (sk_b64, _) = ensure_dev_keypair()?;
    let signing_key = decode_signing_key(&sk_b64)?;
    let machine_id = get_machine_id();

    let license_tier = match tier.to_lowercase().as_str() {
        "trial" => LicenseTier::Trial,
        "student" => LicenseTier::Student,
        "researcher" => LicenseTier::Researcher,
        "lab" => LicenseTier::Lab,
        "institutional" => LicenseTier::Institutional,
        "developer" => LicenseTier::Developer,
        _ => return Err(format!("Unknown tier: {}", tier)),
    };

    let license_mode = match mode.to_lowercase().as_str() {
        "node_locked" | "nodelocked" => LicenseMode::NodeLocked,
        "floating" => LicenseMode::Floating,
        _ => {
            return Err(format!(
                "Unknown mode: {}. Use 'node_locked' or 'floating'",
                mode
            ))
        }
    };

    let key_id = uuid::Uuid::new_v4().to_string().replace("-", "");
    let license_key = format!(
        "STATSEM-{}-{}-{}",
        &key_id[..4].to_uppercase(),
        &key_id[4..8].to_uppercase(),
        &key_id[8..12].to_uppercase()
    );

    let payload = LicensePayload {
        license_key,
        mode: license_mode.clone(),
        tier: license_tier,
        machine_id: if license_mode == LicenseMode::NodeLocked {
            Some(machine_id)
        } else {
            None
        },
        licensee,
        email: None,
        issued_at: Utc::now(),
        expires_at: Utc::now() + Duration::days(days_valid as i64),
        max_machines: 3,
        max_seats: if license_mode == LicenseMode::Floating {
            10
        } else {
            0
        },
        features: vec![
            "pls_basic".to_string(),
            "bootstrap".to_string(),
            "mediation".to_string(),
            "moderation".to_string(),
            "quadratic".to_string(),
            "ipma".to_string(),
            "mga".to_string(),
            "fimix".to_string(),
            "cta".to_string(),
            "micom".to_string(),
            "hcm".to_string(),
            "blindfolding".to_string(),
            "power_analysis".to_string(),
        ],
    };

    let signed_token = SignedToken::sign(&payload, &signing_key)?;
    Ok(signed_token.to_token_string())
}
