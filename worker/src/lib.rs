//! HomeGuard worker library. The binary in `main.rs` wires these modules together.

pub mod config;
pub mod context;
pub mod contract;
pub mod cpe;
pub mod data_source;
pub mod db;
pub mod error;
pub mod heartbeat;
pub mod hooks;
pub mod jobs;
pub mod kev;
pub mod limiter;
pub mod nvd;
pub mod nvd_parse;
pub mod products;
pub mod queue;
pub mod runner;
pub mod sbom;
pub mod sbom_import;
pub mod scheduler;
pub mod status;
pub mod trivy;
pub mod version;
pub mod vulns;

/// reqwest is built without a bundled crypto provider; use `ring`, the one sqlx already uses.
/// Safe to call many times.
pub fn install_crypto_provider() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        // Err means a provider was installed already, which is fine.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}
