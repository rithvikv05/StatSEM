use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use rand::RngCore;
use std::fs;
use std::path::PathBuf;

use super::token::SignedToken;

/// Derives a 256-bit AES key from the machine ID using Argon2id.
/// This ensures the keystore can only be decrypted on the same machine.
fn derive_key(machine_id: &str) -> [u8; 32] {
    let salt = b"statsem_keystore_v1_salt"; // Fixed salt is fine here since machine_id is unique
    let mut key = [0u8; 32];
    let argon2 = Argon2::default();
    argon2
        .hash_password_into(machine_id.as_bytes(), salt, &mut key)
        .expect("Argon2 key derivation failed");
    key
}

/// Get the path to the keystore file.
fn keystore_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("StatSEM");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("license.dat")
}

/// Store an encrypted license token to disk.
/// The token is encrypted with AES-256-GCM using a key derived from the machine ID.
pub fn store_token(token: &SignedToken, machine_id: &str) -> Result<(), String> {
    let key_bytes = derive_key(machine_id);
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Generate random nonce (96 bits)
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Serialize the token
    let token_json =
        serde_json::to_vec(token).map_err(|e| format!("Failed to serialize token: {}", e))?;

    // Encrypt
    let ciphertext = cipher
        .encrypt(nonce, token_json.as_ref())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Write: nonce (12 bytes) + ciphertext
    let mut data = Vec::with_capacity(12 + ciphertext.len());
    data.extend_from_slice(&nonce_bytes);
    data.extend_from_slice(&ciphertext);

    let path = keystore_path();
    fs::write(&path, &data)
        .map_err(|e| format!("Failed to write keystore at {:?}: {}", path, e))?;

    log::info!("License token stored at {:?}", path);
    Ok(())
}

/// Load and decrypt the license token from disk.
/// Returns None if no keystore file exists.
pub fn load_token(machine_id: &str) -> Result<Option<SignedToken>, String> {
    let path = keystore_path();

    if !path.exists() {
        return Ok(None);
    }

    let data =
        fs::read(&path).map_err(|e| format!("Failed to read keystore at {:?}: {}", path, e))?;

    if data.len() < 13 {
        return Err("Keystore file is corrupted (too short)".to_string());
    }

    let key_bytes = derive_key(machine_id);
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    let nonce = Nonce::from_slice(&data[..12]);
    let ciphertext = &data[12..];

    let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|_| {
        "Failed to decrypt license: this license was activated on a different machine".to_string()
    })?;

    let token: SignedToken =
        serde_json::from_slice(&plaintext).map_err(|e| format!("Corrupted license data: {}", e))?;

    Ok(Some(token))
}

/// Delete the keystore file (deactivate license).
pub fn clear_token() -> Result<(), String> {
    let path = keystore_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to remove keystore: {}", e))?;
        log::info!("License token cleared from {:?}", path);
    }
    Ok(())
}

/// Check if a keystore file exists.
pub fn has_token() -> bool {
    keystore_path().exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::license::token::{
        generate_keypair, LicenseMode, LicensePayload, LicenseTier, SignedToken,
    };
    use chrono::{Duration, Utc};

    fn make_test_token() -> SignedToken {
        let (signing_key, _) = generate_keypair();
        let payload = LicensePayload {
            license_key: "STATSEM-TEST-KS-0001".to_string(),
            mode: LicenseMode::NodeLocked,
            tier: LicenseTier::Developer,
            machine_id: Some("sha256:test_keystore".to_string()),
            licensee: "Keystore Test".to_string(),
            email: None,
            issued_at: Utc::now(),
            expires_at: Utc::now() + Duration::days(30),
            max_machines: 1,
            max_seats: 0,
            features: vec!["pls_basic".to_string()],
        };
        SignedToken::sign(&payload, &signing_key).unwrap()
    }

    static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn test_store_and_load() {
        let _guard = TEST_LOCK.lock().unwrap();
        let token = make_test_token();
        let machine_id = "sha256:test_machine_for_keystore";

        store_token(&token, machine_id).unwrap();
        let loaded = load_token(machine_id).unwrap().unwrap();

        assert_eq!(loaded.payload_b64, token.payload_b64);
        assert_eq!(loaded.signature_b64, token.signature_b64);

        // Cleanup
        clear_token().unwrap();
    }

    #[test]
    fn test_wrong_machine_cannot_decrypt() {
        let _guard = TEST_LOCK.lock().unwrap();
        let token = make_test_token();
        let machine_id = "sha256:correct_machine";
        let wrong_machine = "sha256:wrong_machine";

        store_token(&token, machine_id).unwrap();
        let result = load_token(wrong_machine);

        assert!(result.is_err());

        // Cleanup
        clear_token().unwrap();
    }

    #[test]
    fn test_clear_token() {
        let _guard = TEST_LOCK.lock().unwrap();
        let token = make_test_token();
        store_token(&token, "sha256:temp").unwrap();
        assert!(has_token());
        clear_token().unwrap();
        assert!(!has_token());
    }
}
