//! Multi-Group Analysis (MGA) for PLS-SEM following MGA_IMPLEMENTATION_SPEC.md.
//!
//! Legacy compatibility functions are preserved in `legacy` so existing
//! IPC/JSON-lines callers continue working unchanged.

pub mod adapter;
pub mod bootstrap_mga;
pub mod groups;
pub mod jobs;
pub mod legacy;
pub mod math;
pub mod micom;
pub mod permutation;
pub mod routes;

pub use legacy::{henseler, run, tests, Options};
