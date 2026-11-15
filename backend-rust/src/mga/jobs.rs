//! Async background jobs for Permutation + MICOM and Bootstrap-based MGA with progress & cancellation.
use crate::mga::adapter::PlsSettings;
use crate::mga::bootstrap_mga::{run_bootstrap_mga, validate_mga_settings, MgaSettings};
use crate::mga::groups::{validate_pair_for_comparison, DataGroup};
use crate::mga::micom::run_permutation_with_micom;
use crate::mga::permutation::{validate_permutation_settings, PermutationSettings};
use crate::server;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Instant;

struct MgaJob {
    status: String, // "running" | "completed" | "cancelled" | "failed"
    phase: String,
    current: usize,
    total: usize,
    started: Instant,
    cancel: Arc<AtomicBool>,
    result: Value,
    error: Option<String>,
}

static PERM_JOBS: OnceLock<Mutex<HashMap<String, Arc<Mutex<MgaJob>>>>> = OnceLock::new();
static BOOT_MGA_JOBS: OnceLock<Mutex<HashMap<String, Arc<Mutex<MgaJob>>>>> = OnceLock::new();

fn perm_jobs() -> &'static Mutex<HashMap<String, Arc<Mutex<MgaJob>>>> {
    PERM_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn boot_mga_jobs() -> &'static Mutex<HashMap<String, Arc<Mutex<MgaJob>>>> {
    BOOT_MGA_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn parse_pls_settings(body: &Value) -> PlsSettings {
    if let Some(v) = body.get("plsSettings").or_else(|| body.get("pls_settings")) {
        if let Ok(s) = serde_json::from_value::<PlsSettings>(v.clone()) {
            return s;
        }
    }
    PlsSettings::default()
}

fn optional_project_path(body: &Value, query: &HashMap<String, String>) -> Option<PathBuf> {
    server::text(body, query, "project_path")
        .or_else(|| server::text(body, query, "path"))
        .and_then(|raw| crate::project_store::resolve_user_path(&raw).ok())
}

pub fn start_permutation(body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    let (columns, rows, ds_id_val) = server::dataset(body, query)?;
    let spec = server::spec(body, query)?;
    let group_a: DataGroup = serde_json::from_value(
        body.get("groupA")
            .or_else(|| body.get("group_a"))
            .cloned()
            .ok_or("groupA is required")?,
    )
    .map_err(|e| format!("Invalid groupA: {e}"))?;
    let group_b: DataGroup = serde_json::from_value(
        body.get("groupB")
            .or_else(|| body.get("group_b"))
            .cloned()
            .ok_or("groupB is required")?,
    )
    .map_err(|e| format!("Invalid groupB: {e}"))?;

    let settings = PermutationSettings {
        group_a,
        group_b,
        permutations: body["permutations"].as_u64().unwrap_or(5000) as usize,
        test_type: body["testType"]
            .as_str()
            .or_else(|| body["test_type"].as_str())
            .unwrap_or("two-tailed")
            .to_string(),
        significance_level: body["significanceLevel"]
            .as_f64()
            .or_else(|| body["significance_level"].as_f64())
            .unwrap_or(0.05),
        parallel_processing: body["parallelProcessing"]
            .as_bool()
            .or_else(|| body["parallel_processing"].as_bool())
            .unwrap_or(true),
        seed: body["seed"].as_u64(),
        pls_settings: parse_pls_settings(body),
    };

    // Synchronous validation before spawning background thread (blocks Phase 9 edge cases immediately).
    validate_permutation_settings(&settings)?;
    let casewise = settings.pls_settings.missing_treatment_key() == "listwise";
    validate_pair_for_comparison(
        &columns,
        &rows,
        &spec,
        &settings.group_a,
        &settings.group_b,
        casewise,
    )?;

    let total = settings.permutations;
    let job_id = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    let job = Arc::new(Mutex::new(MgaJob {
        status: "running".into(),
        phase: "Running permutation".into(),
        current: 0,
        total,
        started: Instant::now(),
        cancel: cancel.clone(),
        result: Value::Null,
        error: None,
    }));
    perm_jobs()
        .lock()
        .map_err(|_| "Permutation jobs lock poisoned")?
        .insert(job_id.clone(), job.clone());

    let _project_path = optional_project_path(body, query);
    let model_id = server::text(body, query, "model_id")
        .or_else(|| server::text(body, query, "modelId"))
        .unwrap_or_else(|| "default".into());
    let dataset_id = ds_id_val
        .as_str()
        .map(str::to_owned)
        .or_else(|| server::text(body, query, "dataset_id"))
        .or_else(|| server::text(body, query, "datasetId"));

    thread::spawn(move || {
        let progress_job = job.clone();
        let res = run_permutation_with_micom(
            &columns,
            &rows,
            &spec,
            &settings,
            &model_id,
            dataset_id.as_deref(),
            &cancel,
            &move |done, tot| {
                if let Ok(mut j) = progress_job.lock() {
                    j.current = done;
                    j.total = tot;
                }
            },
        );

        match res {
            Ok(report) => {
                if cancel.load(Ordering::Relaxed) {
                    if let Ok(mut j) = job.lock() {
                        j.status = "cancelled".into();
                        j.result = Value::Null;
                    }
                    return;
                }
                let report_json = json!(report);
                if let Ok(mut j) = job.lock() {
                    j.status = "completed".into();
                    j.current = j.total;
                    j.result = report_json;
                }
            }
            Err(err) => {
                if let Ok(mut j) = job.lock() {
                    j.status = if cancel.load(Ordering::Relaxed) {
                        "cancelled".into()
                    } else {
                        "failed".into()
                    };
                    j.error = Some(err);
                    j.result = Value::Null;
                }
            }
        }
    });

    Ok(json!({
        "status": "started",
        "jobId": job_id,
        "total": total,
    }))
}

pub fn permutation_status(job_id: &str) -> Result<Value, String> {
    let job = perm_jobs()
        .lock()
        .map_err(|_| "Permutation jobs lock poisoned")?
        .get(job_id)
        .cloned()
        .ok_or("Permutation job not found")?;
    let j = job.lock().map_err(|_| "Permutation job lock poisoned")?;
    let percent = if j.total == 0 {
        0.0
    } else {
        (j.current as f64 / j.total as f64) * 100.0
    };
    Ok(json!({
        "jobId": job_id,
        "status": j.status,
        "phase": j.phase,
        "current": j.current,
        "total": j.total,
        "percent": percent,
        "elapsedSec": j.started.elapsed().as_secs_f64(),
        "result": j.result,
        "error": j.error,
    }))
}

pub fn cancel_permutation(job_id: &str) -> Result<Value, String> {
    let job = perm_jobs()
        .lock()
        .map_err(|_| "Permutation jobs lock poisoned")?
        .get(job_id)
        .cloned()
        .ok_or("Permutation job not found")?;
    let mut j = job.lock().map_err(|_| "Permutation job lock poisoned")?;
    j.cancel.store(true, Ordering::Relaxed);
    j.status = "cancelled".into();
    j.result = Value::Null;
    Ok(json!({"status": "cancelled", "jobId": job_id}))
}

pub fn start_bootstrap_mga(body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    let (columns, rows, ds_id_val) = server::dataset(body, query)?;
    let spec = server::spec(body, query)?;
    let group_a: DataGroup = serde_json::from_value(
        body.get("groupA")
            .or_else(|| body.get("group_a"))
            .cloned()
            .ok_or("groupA is required")?,
    )
    .map_err(|e| format!("Invalid groupA: {e}"))?;
    let group_b: DataGroup = serde_json::from_value(
        body.get("groupB")
            .or_else(|| body.get("group_b"))
            .cloned()
            .ok_or("groupB is required")?,
    )
    .map_err(|e| format!("Invalid groupB: {e}"))?;

    let settings = MgaSettings {
        group_a,
        group_b,
        subsamples: body["subsamples"].as_u64().unwrap_or(5000) as usize,
        test_type: body["testType"]
            .as_str()
            .or_else(|| body["test_type"].as_str())
            .unwrap_or("two-tailed")
            .to_string(),
        significance_level: body["significanceLevel"]
            .as_f64()
            .or_else(|| body["significance_level"].as_f64())
            .unwrap_or(0.05),
        parallel_processing: body["parallelProcessing"]
            .as_bool()
            .or_else(|| body["parallel_processing"].as_bool())
            .unwrap_or(true),
        seed: body["seed"].as_u64(),
        pls_settings: parse_pls_settings(body),
    };

    validate_mga_settings(&settings)?;
    let casewise = settings.pls_settings.missing_treatment_key() == "listwise";
    validate_pair_for_comparison(
        &columns,
        &rows,
        &spec,
        &settings.group_a,
        &settings.group_b,
        casewise,
    )?;

    let total = settings.subsamples * 2;
    let job_id = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    let job = Arc::new(Mutex::new(MgaJob {
        status: "running".into(),
        phase: "Bootstrapping Group A".into(),
        current: 0,
        total,
        started: Instant::now(),
        cancel: cancel.clone(),
        result: Value::Null,
        error: None,
    }));
    boot_mga_jobs()
        .lock()
        .map_err(|_| "Bootstrap MGA jobs lock poisoned")?
        .insert(job_id.clone(), job.clone());

    let _project_path = optional_project_path(body, query);
    let model_id = server::text(body, query, "model_id")
        .or_else(|| server::text(body, query, "modelId"))
        .unwrap_or_else(|| "default".into());
    let dataset_id = ds_id_val
        .as_str()
        .map(str::to_owned)
        .or_else(|| server::text(body, query, "dataset_id"))
        .or_else(|| server::text(body, query, "datasetId"));

    thread::spawn(move || {
        let progress_job = job.clone();
        let res = run_bootstrap_mga(
            &columns,
            &rows,
            &spec,
            &settings,
            &model_id,
            dataset_id.as_deref(),
            &cancel,
            &move |done, tot, phase| {
                if let Ok(mut j) = progress_job.lock() {
                    j.current = done;
                    j.total = tot;
                    j.phase = format!("Bootstrapping {phase}");
                }
            },
        );

        match res {
            Ok(report) => {
                if cancel.load(Ordering::Relaxed) {
                    if let Ok(mut j) = job.lock() {
                        j.status = "cancelled".into();
                        j.result = Value::Null;
                    }
                    return;
                }
                let report_json = json!(report);
                if let Ok(mut j) = job.lock() {
                    j.status = "completed".into();
                    j.current = j.total;
                    j.result = report_json;
                }
            }
            Err(err) => {
                if let Ok(mut j) = job.lock() {
                    j.status = if cancel.load(Ordering::Relaxed) {
                        "cancelled".into()
                    } else {
                        "failed".into()
                    };
                    j.error = Some(err);
                    j.result = Value::Null;
                }
            }
        }
    });

    Ok(json!({
        "status": "started",
        "jobId": job_id,
        "total": total,
    }))
}

pub fn bootstrap_mga_status(job_id: &str) -> Result<Value, String> {
    let job = boot_mga_jobs()
        .lock()
        .map_err(|_| "Bootstrap MGA jobs lock poisoned")?
        .get(job_id)
        .cloned()
        .ok_or("MGA job not found")?;
    let j = job.lock().map_err(|_| "MGA job lock poisoned")?;
    let percent = if j.total == 0 {
        0.0
    } else {
        (j.current as f64 / j.total as f64) * 100.0
    };
    Ok(json!({
        "jobId": job_id,
        "status": j.status,
        "phase": j.phase,
        "current": j.current,
        "total": j.total,
        "percent": percent,
        "elapsedSec": j.started.elapsed().as_secs_f64(),
        "result": j.result,
        "error": j.error,
    }))
}

pub fn cancel_bootstrap_mga(job_id: &str) -> Result<Value, String> {
    let job = boot_mga_jobs()
        .lock()
        .map_err(|_| "Bootstrap MGA jobs lock poisoned")?
        .get(job_id)
        .cloned()
        .ok_or("MGA job not found")?;
    let mut j = job.lock().map_err(|_| "MGA job lock poisoned")?;
    j.cancel.store(true, Ordering::Relaxed);
    j.status = "cancelled".into();
    j.result = Value::Null;
    Ok(json!({"status": "cancelled", "jobId": job_id}))
}

