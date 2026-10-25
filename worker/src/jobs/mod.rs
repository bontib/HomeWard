//! One file per job type. Each exposes `run` (and small helpers other jobs reuse).

pub mod check_device;
pub mod dev_noop;
pub mod import_kev;
pub mod recompute_status;
pub mod rescan_all;
pub mod search_products;
pub mod send_digest;
pub mod send_email;
pub mod update_trivy_db;
