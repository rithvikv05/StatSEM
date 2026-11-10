use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// The license mode determines how the license is validated.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LicenseMode {
    /// Bound to specific machine(s) via fingerprint. Works fully offline.
    NodeLocked,
    /// Concurrent seat pool. Requires periodic server check-in.
    Floating,
}

/// The tier determines pricing and feature access.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LicenseTier {
    Trial,
    Student,
    Researcher,
    Lab,
    Institutional,
    Developer,
}

impl std::fmt::Display for LicenseTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LicenseTier::Trial => write!(f, "Trial"),
            LicenseTier::Student => write!(f, "Student"),
            LicenseTier::Researcher => write!(f, "Researcher"),
            LicenseTier::Lab => write!(f, "Lab"),
            LicenseTier::Institutional => write!(f, "Institutional"),
            LicenseTier::Developer => write!(f, "Developer"),
        }
    }
}

/// The payload inside a license token, containing all claims.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicensePayload {
    /// Unique license key (e.g., "STATSEM-XXXX-XXXX-XXXX")
    pub license_key: String,

    /// License mode: node_locked or floating
    pub mode: LicenseMode,

    /// Subscription tier
    pub tier: LicenseTier,

    /// Machine fingerprint (required for node_locked; optional for floating)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub machine_id: Option<String>,

    /// Who the license is issued to
    pub licensee: String,

    /// Email associated with the license
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,

    /// When the token was issued
    pub issued_at: DateTime<Utc>,

    /// When the token expires
    pub expires_at: DateTime<Utc>,

    /// Maximum machines allowed (node_locked mode)
    #[serde(default = "default_max_machines")]
    pub max_machines: u32,

    /// Maximum concurrent seats (floating mode)
    #[serde(default)]
    pub max_seats: u32,

    /// Feature flags this license enables
    pub features: Vec<String>,
}

fn default_max_machines() -> u32 {
    2
}

/// A signed license token: payload + Ed25519 signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedToken {
    /// Base64-encoded JSON payload
    pub payload_b64: String,
    /// Base64-encoded Ed25519 signature
    pub signature_b64: String,
}

impl SignedToken {
    /// Sign a payload with the given signing (private) key.
    pub fn sign(payload: &LicensePayload, signing_key: &SigningKey) -> Result<Self, String> {
        let payload_json = serde_json::to_string(payload)
            .map_err(|e| format!("Failed to serialize payload: {}", e))?;
        let payload_b64 = BASE64.encode(payload_json.as_bytes());

        let signature = signing_key.sign(payload_b64.as_bytes());
        let signature_b64 = BASE64.encode(signature.to_bytes());

        Ok(SignedToken {
            payload_b64,
            signature_b64,
        })
    }

    /// Verify the signature and decode the payload.
    pub fn verify(&self, verifying_key: &VerifyingKey) -> Result<LicensePayload, String> {
        // Decode signature
        let sig_bytes = BASE64
            .decode(&self.signature_b64)
            .map_err(|e| format!("Invalid signature encoding: {}", e))?;
        let signature = Signature::from_slice(&sig_bytes)
            .map_err(|e| format!("Invalid signature format: {}", e))?;

        // Verify signature against payload
        verifying_key
            .verify(self.payload_b64.as_bytes(), &signature)
            .map_err(|_| "Invalid signature: token may have been tampered with".to_string())?;

        // Decode payload
        let payload_json = BASE64
            .decode(&self.payload_b64)
            .map_err(|e| format!("Invalid payload encoding: {}", e))?;
        let payload: LicensePayload = serde_json::from_slice(&payload_json)
            .map_err(|e| format!("Invalid payload format: {}", e))?;

        Ok(payload)
    }

    /// Serialize the entire signed token to a portable string format.
    pub fn to_token_string(&self) -> String {
        let json = serde_json::to_string(self).unwrap_or_default();
        BASE64.encode(json.as_bytes())
    }

    /// Deserialize from the portable string format.
    pub fn from_token_string(token_str: &str) -> Result<Self, String> {
        let json_bytes = BASE64
            .decode(token_str)
            .map_err(|e| format!("Invalid token encoding: {}", e))?;
        serde_json::from_slice(&json_bytes).map_err(|e| format!("Invalid token format: {}", e))
    }
}

/// Validate a decoded payload against the current machine and time.
pub fn validate_payload(payload: &LicensePayload, current_machine_id: &str) -> Result<(), String> {
    let now = Utc::now();

    // Check expiry
    if now > payload.expires_at {
        return Err(format!(
            "License expired on {}",
            payload.expires_at.format("%Y-%m-%d")
        ));
    }

    // For node-locked licenses, verify machine binding
    if payload.mode == LicenseMode::NodeLocked {
        match &payload.machine_id {
            Some(bound_id) if bound_id != current_machine_id => {
                return Err(
                    "License is bound to a different machine. Please deactivate on the other machine first.".to_string()
                );
            }
            None => {
                // Token not yet bound — this is fine for first activation
            }
            _ => {
                // Machine ID matches — all good
            }
        }
    }
    // For floating licenses, we don't check machine_id here.
    // The license server manages seat counts.

    Ok(())
}

/// Generate a new Ed25519 keypair for development/testing.
pub fn generate_keypair() -> (SigningKey, VerifyingKey) {
    let mut rng = rand::thread_rng();
    let signing_key = SigningKey::generate(&mut rng);
    let verifying_key = signing_key.verifying_key();
    (signing_key, verifying_key)
}

/// Encode a signing key to base64 for storage.
pub fn encode_signing_key(key: &SigningKey) -> String {
    BASE64.encode(key.to_bytes())
}

/// Decode a signing key from base64.
pub fn decode_signing_key(encoded: &str) -> Result<SigningKey, String> {
    let bytes = BASE64
        .decode(encoded)
        .map_err(|e| format!("Invalid key encoding: {}", e))?;
    let byte_array: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Invalid key length".to_string())?;
    Ok(SigningKey::from_bytes(&byte_array))
}

/// Encode a verifying key to base64 for embedding.
pub fn encode_verifying_key(key: &VerifyingKey) -> String {
    BASE64.encode(key.to_bytes())
}

/// Decode a verifying key from base64.
pub fn decode_verifying_key(encoded: &str) -> Result<VerifyingKey, String> {
    let bytes = BASE64
        .decode(encoded)
        .map_err(|e| format!("Invalid key encoding: {}", e))?;
    let byte_array: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Invalid key length".to_string())?;
    VerifyingKey::from_bytes(&byte_array).map_err(|e| format!("Invalid verifying key: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn make_test_payload() -> LicensePayload {
        LicensePayload {
            license_key: "STATSEM-TEST-0001-DEV".to_string(),
            mode: LicenseMode::NodeLocked,
            tier: LicenseTier::Developer,
            machine_id: Some("sha256:testmachine123".to_string()),
            licensee: "Test User".to_string(),
            email: Some("test@example.com".to_string()),
            issued_at: Utc::now(),
            expires_at: Utc::now() + Duration::days(365),
            max_machines: 2,
            max_seats: 0,
            features: vec!["pls_basic".to_string(), "bootstrap".to_string()],
        }
    }

    #[test]
    fn test_sign_and_verify() {
        let (signing_key, verifying_key) = generate_keypair();
        let payload = make_test_payload();

        let token = SignedToken::sign(&payload, &signing_key).unwrap();
        let decoded = token.verify(&verifying_key).unwrap();

        assert_eq!(decoded.license_key, payload.license_key);
        assert_eq!(decoded.tier, LicenseTier::Developer);
    }

    #[test]
    fn test_tampered_token_fails() {
        let (signing_key, verifying_key) = generate_keypair();
        let payload = make_test_payload();

        let mut token = SignedToken::sign(&payload, &signing_key).unwrap();
        // Tamper with the payload
        token.payload_b64 = BASE64.encode(b"tampered data");

        assert!(token.verify(&verifying_key).is_err());
    }

    #[test]
    fn test_wrong_key_fails() {
        let (signing_key, _) = generate_keypair();
        let (_, wrong_verifying_key) = generate_keypair();
        let payload = make_test_payload();

        let token = SignedToken::sign(&payload, &signing_key).unwrap();
        assert!(token.verify(&wrong_verifying_key).is_err());
    }

    #[test]
    fn test_token_string_roundtrip() {
        let (signing_key, verifying_key) = generate_keypair();
        let payload = make_test_payload();

        let token = SignedToken::sign(&payload, &signing_key).unwrap();
        let token_str = token.to_token_string();
        let restored = SignedToken::from_token_string(&token_str).unwrap();
        let decoded = restored.verify(&verifying_key).unwrap();

        assert_eq!(decoded.license_key, payload.license_key);
    }

    #[test]
    fn test_expired_payload_rejected() {
        let payload = LicensePayload {
            expires_at: Utc::now() - Duration::days(1),
            ..make_test_payload()
        };
        let result = validate_payload(&payload, "sha256:testmachine123");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("expired"));
    }

    #[test]
    fn test_wrong_machine_rejected() {
        let payload = make_test_payload();
        let result = validate_payload(&payload, "sha256:different_machine");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("different machine"));
    }

    #[test]
    fn test_keypair_encoding_roundtrip() {
        let (signing_key, verifying_key) = generate_keypair();
        let sk_enc = encode_signing_key(&signing_key);
        let vk_enc = encode_verifying_key(&verifying_key);

        let sk_dec = decode_signing_key(&sk_enc).unwrap();
        let vk_dec = decode_verifying_key(&vk_enc).unwrap();

        assert_eq!(signing_key.to_bytes(), sk_dec.to_bytes());
        assert_eq!(verifying_key.to_bytes(), vk_dec.to_bytes());
    }
}
