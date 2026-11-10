use sha2::{Digest, Sha256};
use sysinfo::System;

/// Generate a deterministic machine fingerprint by hashing hardware identifiers.
/// This ID is used to bind license tokens to a specific device.
pub fn get_machine_id() -> String {
    let mut sys = System::new_all();
    sys.refresh_all();

    let mut hasher = Sha256::new();

    // CPU brand/model
    let cpus = sys.cpus();
    if let Some(cpu) = cpus.first() {
        hasher.update(cpu.brand().as_bytes());
    }

    // CPU count (physical)
    let cpu_count = sys.cpus().len();
    hasher.update(cpu_count.to_string().as_bytes());

    // Total system memory (rounded to nearest GB for stability)
    let total_mem_gb = sys.total_memory() / (1024 * 1024 * 1024);
    hasher.update(total_mem_gb.to_string().as_bytes());

    // Hostname
    if let Some(hostname) = System::host_name() {
        hasher.update(hostname.as_bytes());
    }

    // OS name + version for additional entropy
    if let Some(os_name) = System::name() {
        hasher.update(os_name.as_bytes());
    }
    if let Some(os_version) = System::os_version() {
        hasher.update(os_version.as_bytes());
    }

    // Kernel version
    if let Some(kernel) = System::kernel_version() {
        hasher.update(kernel.as_bytes());
    }

    let result = hasher.finalize();
    format!("sha256:{}", hex::encode(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_machine_id_is_deterministic() {
        let id1 = get_machine_id();
        let id2 = get_machine_id();
        assert_eq!(id1, id2);
        assert!(id1.starts_with("sha256:"));
        assert_eq!(id1.len(), 7 + 64); // "sha256:" + 64 hex chars
    }
}
