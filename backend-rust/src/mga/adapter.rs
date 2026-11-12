//! Phase 0 — Adapter layer bridging StatSEM's existing PLS and Bootstrap engines with MGA.
use crate::{bootstrap, model, pipeline, stats};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::AtomicBool;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlsSettings {
    #[serde(default = "default_weighting_scheme", alias = "weighting_scheme")]
    pub weighting_scheme: String,
    #[serde(default = "default_max_iterations", alias = "max_iterations")]
    pub max_iterations: usize,
    #[serde(default = "default_stop_criterion", alias = "stop_criterion_exponent")]
    pub stop_criterion_exponent: u32,
    #[serde(default = "default_missing_values", alias = "missing_values")]
    pub missing_values: String,
    #[serde(default)]
    pub consistent: bool,
}

fn default_weighting_scheme() -> String {
    "path".into()
}
fn default_max_iterations() -> usize {
    5000
}
fn default_stop_criterion() -> u32 {
    7
}
fn default_missing_values() -> String {
    "mean".into()
}

impl Default for PlsSettings {
    fn default() -> Self {
        Self {
            weighting_scheme: default_weighting_scheme(),
            max_iterations: default_max_iterations(),
            stop_criterion_exponent: default_stop_criterion(),
            missing_values: default_missing_values(),
            consistent: false,
        }
    }
}

impl PlsSettings {
    pub fn tolerance(&self) -> f64 {
        10f64.powi(-(self.stop_criterion_exponent.clamp(1, 12) as i32))
    }

    pub fn missing_treatment_key(&self) -> &'static str {
        match self.missing_values.trim().to_lowercase().as_str() {
            "casewise" | "listwise" => "listwise",
            "pairwise" => "pairwise",
            _ => "mean",
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        let scheme = self.weighting_scheme.trim().to_lowercase();
        if !["path", "centroid", "factor"].contains(&scheme.as_str()) {
            return Err(format!("Unsupported PLS weighting scheme: {}", self.weighting_scheme));
        }
        if self.max_iterations == 0 || self.max_iterations > 5000 {
            return Err("maxIterations must be between 1 and 5000".into());
        }
        if self.stop_criterion_exponent < 3 || self.stop_criterion_exponent > 12 {
            return Err("stopCriterionExponent must be between 3 and 12".into());
        }
        let mv = self.missing_values.trim().to_lowercase();
        if !["mean", "casewise", "listwise", "pairwise"].contains(&mv.as_str()) {
            return Err(format!("Unsupported missingValues mode: {}", self.missing_values));
        }
        Ok(())
    }

    fn to_pipeline_json(&self, sign_convention: &str) -> Value {
        json!({
            "inner_weighting": self.weighting_scheme.trim().to_lowercase(),
            "max_iter": self.max_iterations,
            "tolerance": self.tolerance(),
            "missing_treatment": self.missing_treatment_key(),
            "sign_convention": sign_convention,
            "consistent": self.consistent,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlsResult {
    pub converged: bool,
    pub constructs: Vec<String>,
    pub declared_constructs: Vec<String>,
    pub construct_names: BTreeMap<String, String>,
    #[serde(default)]
    pub construct_types: BTreeMap<String, String>,
    #[serde(default)]
    pub interaction_constructs: HashSet<String>,
    pub indicators_of: BTreeMap<String, Vec<String>>,
    pub indicator_names: BTreeMap<String, String>,
    pub weights: BTreeMap<String, Vec<f64>>,
    pub loadings: BTreeMap<String, Vec<f64>>,
    pub paths: BTreeMap<String, f64>,
    pub path_order: Vec<[String; 2]>,
    /// Matrix [n_rows x n_constructs] ordered by `constructs`.
    pub composite_scores: Vec<Vec<f64>>,
    pub n_used: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapSample {
    pub weights: BTreeMap<String, Vec<f64>>,
    pub loadings: BTreeMap<String, Vec<f64>>,
    pub paths: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStdErrors {
    pub paths: BTreeMap<String, f64>,
    pub loadings: BTreeMap<String, Vec<f64>>,
    pub weights: BTreeMap<String, Vec<f64>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapResult {
    pub original: PlsResult,
    pub samples: Vec<BootstrapSample>,
    pub std_error: BootstrapStdErrors,
    pub n_used: usize,
    pub failed_runs: usize,
}

/// Resolve each required indicator column in the dataset and return `(indicator_id, column_idx, column_name)`.
pub fn resolve_model_indicator_columns(
    columns: &[String],
    spec: &Value,
) -> Result<Vec<(String, usize, String)>, String> {
    if let Some(constructs) = spec["constructs"].as_array() {
        for c in constructs {
            let is_higher = c.get("order").and_then(Value::as_str) == Some("higher")
                || c.get("components").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
            let has_inds = c["indicators"].as_array().is_some_and(|a| !a.is_empty());
            if is_higher && !has_inds {
                return Err("Not supported in MGA.".into());
            }
        }
    }
    let parsed = model::parse(spec)?;
    let mut resolved = Vec::new();
    let mut seen_iids = HashSet::new();
    for block in &parsed.blocks {
        if !block.is_interaction && block.indicators.is_empty() {
            return Err("Not supported in MGA.".into());
        }
        for iid in &block.indicators {
            if !seen_iids.insert(iid.clone()) {
                continue;
            }
            let mapped = parsed
                .indicators
                .iter()
                .find(|(id, _)| id == iid)
                .map(|(_, c)| c.clone())
                .unwrap_or_else(|| iid.clone());
            let pos = columns
                .iter()
                .position(|c| c == &mapped)
                .or_else(|| {
                    columns
                        .iter()
                        .rposition(|c| c.trim().to_lowercase() == mapped.trim().to_lowercase())
                })
                .ok_or_else(|| {
                    format!("Indicator '{iid}' mapped to column '{mapped}' not found in dataset columns.")
                })?;
            resolved.push((iid.clone(), pos, columns[pos].clone()));
        }
    }
    Ok(resolved)
}

pub fn is_missing_cell(cell: &Value) -> bool {
    let num = model::numeric(cell);
    num.is_nan() || num == -99.0
}

/// Filter dataset rows using casewise deletion across the model's required indicator columns.
pub fn filter_casewise_rows(
    columns: &[String],
    rows: &[Vec<Value>],
    spec: &Value,
) -> Result<Vec<Vec<Value>>, String> {
    let required = resolve_model_indicator_columns(columns, spec)?;
    let retained = rows
        .iter()
        .filter(|row| {
            row.len() == columns.len()
                && required.iter().all(|(_, col_idx, _)| !is_missing_cell(&row[*col_idx]))
        })
        .cloned()
        .collect();
    Ok(retained)
}

/// Returns indicator IDs that are entirely missing or constant (zero variance) in `rows`.
pub fn find_constant_or_missing_indicators(
    columns: &[String],
    rows: &[Vec<Value>],
    spec: &Value,
) -> Result<Vec<String>, String> {
    let required = resolve_model_indicator_columns(columns, spec)?;
    let mut bad = Vec::new();
    for (iid, col_idx, col_name) in required {
        let vals: Vec<f64> = rows
            .iter()
            .filter_map(|r| {
                r.get(col_idx).and_then(|v| {
                    let num = model::numeric(v);
                    if num.is_nan() || num == -99.0 {
                        None
                    } else {
                        Some(num)
                    }
                })
            })
            .collect();
        if vals.len() < 2 {
            bad.push(col_name);
            continue;
        }
        let min = vals.iter().copied().fold(f64::INFINITY, f64::min);
        let max = vals.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        if (max - min).abs() <= 1e-12 {
            bad.push(col_name);
        } else {
            let _ = iid;
        }
    }
    Ok(bad)
}

/// Compute the maximum number of incoming structural paths to any endogenous construct (clamped [2, 10]).
pub fn max_incoming_arrows(spec: &Value) -> usize {
    let Ok(parsed) = model::parse(spec) else {
        return 2;
    };
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for [_, to] in &parsed.paths {
        *counts.entry(to.clone()).or_insert(0) += 1;
    }
    counts.values().copied().max().unwrap_or(2).clamp(2, 10)
}

fn non_converged_stub(spec: &Value, n_used: usize) -> Result<PlsResult, String> {
    let parsed = model::parse(spec)?;
    let constructs: Vec<String> = parsed.blocks.iter().map(|b| b.id.clone()).collect();
    let mut construct_names = BTreeMap::new();
    let mut construct_types = BTreeMap::new();
    let mut interaction_constructs = HashSet::new();
    let mut indicators_of = BTreeMap::new();
    let mut indicator_names = BTreeMap::new();
    let mut weights = BTreeMap::new();
    let mut loadings = BTreeMap::new();
    for b in &parsed.blocks {
        construct_names.insert(b.id.clone(), b.name.clone().unwrap_or_else(|| b.id.clone()));
        let is_formative = b.measurement_type.eq_ignore_ascii_case("formative")
            || b.outer_mode
                .as_deref()
                .is_some_and(|m| m.eq_ignore_ascii_case("B"));
        construct_types.insert(
            b.id.clone(),
            if is_formative { "formative" } else { "reflective" }.into(),
        );
        if b.is_interaction {
            interaction_constructs.insert(b.id.clone());
        }
        indicators_of.insert(b.id.clone(), b.indicators.clone());
        weights.insert(b.id.clone(), vec![0.0; b.indicators.len()]);
        loadings.insert(b.id.clone(), vec![0.0; b.indicators.len()]);
    }
    for (iid, col) in &parsed.indicators {
        indicator_names.insert(iid.clone(), col.clone());
    }
    let mut paths = BTreeMap::new();
    for [from, to] in &parsed.paths {
        paths.insert(format!("{from}->{to}"), 0.0);
    }
    Ok(PlsResult {
        converged: false,
        constructs: constructs.clone(),
        declared_constructs: constructs,
        construct_names,
        construct_types,
        interaction_constructs,
        indicators_of,
        indicator_names,
        weights,
        loadings,
        paths,
        path_order: parsed.paths,
        composite_scores: Vec::new(),
        n_used,
    })
}

fn extract_pls_result(raw: &Value, orig_spec: &Value) -> Result<PlsResult, String> {
    let orig_parsed = model::parse(orig_spec)?;
    let expanded_spec = raw.get("_expanded_spec").unwrap_or(orig_spec);
    let parsed = model::parse(expanded_spec)?;

    let declared_constructs: Vec<String> = orig_parsed
        .blocks
        .iter()
        .filter(|b| !b.is_interaction)
        .map(|b| b.id.clone())
        .collect();
    let constructs: Vec<String> = parsed.blocks.iter().map(|b| b.id.clone()).collect();

    let mut construct_names = BTreeMap::new();
    let mut construct_types = BTreeMap::new();
    let mut interaction_constructs = HashSet::new();
    let mut indicators_of = BTreeMap::new();
    let mut indicator_names = BTreeMap::new();
    let mut weights = BTreeMap::new();
    let mut loadings = BTreeMap::new();

    for block in &parsed.blocks {
        let cname = raw["construct_names"][&block.id]
            .as_str()
            .map(str::to_owned)
            .or_else(|| block.name.clone())
            .unwrap_or_else(|| block.id.clone());
        construct_names.insert(block.id.clone(), cname);
        let is_formative = block.measurement_type.eq_ignore_ascii_case("formative")
            || block
                .outer_mode
                .as_deref()
                .is_some_and(|m| m.eq_ignore_ascii_case("B"));
        construct_types.insert(
            block.id.clone(),
            if is_formative { "formative" } else { "reflective" }.into(),
        );
        if block.is_interaction {
            interaction_constructs.insert(block.id.clone());
        }
        indicators_of.insert(block.id.clone(), block.indicators.clone());

        let w_vec: Vec<f64> = block
            .indicators
            .iter()
            .map(|iid| {
                raw["measurement"]["outer_weights"][&block.id][iid]
                    .as_f64()
                    .unwrap_or(0.0)
            })
            .collect();
        let l_vec: Vec<f64> = block
            .indicators
            .iter()
            .map(|iid| {
                raw["measurement"]["outer_loadings"][&block.id][iid]
                    .as_f64()
                    .unwrap_or(0.0)
            })
            .collect();
        weights.insert(block.id.clone(), w_vec);
        loadings.insert(block.id.clone(), l_vec);
    }

    for (iid, col) in &parsed.indicators {
        let name = raw["indicator_names"][iid]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| col.clone());
        indicator_names.insert(iid.clone(), name);
    }

    let mut path_order = Vec::new();
    let mut paths = BTreeMap::new();
    let mut seen_paths = HashSet::new();

    for [from, to] in orig_parsed.paths.iter().chain(parsed.paths.iter()) {
        let key = format!("{from}->{to}");
        if seen_paths.insert(key.clone()) {
            let val = raw["structural"]["path_coefficients"][to][from]
                .as_f64()
                .unwrap_or(0.0);
            paths.insert(key, val);
            path_order.push([from.clone(), to.clone()]);
        }
    }
    if let Some(obj) = raw["structural"]["path_coefficients"].as_object() {
        for (to, from_map) in obj {
            if let Some(from_obj) = from_map.as_object() {
                for (from, val) in from_obj {
                    let key = format!("{from}->{to}");
                    if seen_paths.insert(key.clone()) {
                        if let Some(beta) = val.as_f64() {
                            paths.insert(key, beta);
                            path_order.push([from.clone(), to.clone()]);
                        }
                    }
                }
            }
        }
    }

    let n_used = raw["n_samples"].as_u64().unwrap_or(0) as usize;
    let mut score_cols: Vec<Vec<f64>> = Vec::with_capacity(constructs.len());
    for cid in &constructs {
        let vec = raw["construct_scores"][cid]
            .as_array()
            .map(|arr| arr.iter().map(model::numeric).collect::<Vec<_>>())
            .unwrap_or_else(|| vec![0.0; n_used]);
        score_cols.push(vec);
    }
    let n_rows = score_cols.first().map_or(n_used, Vec::len);
    let mut composite_scores = vec![vec![0.0; constructs.len()]; n_rows];
    for (c_idx, col) in score_cols.iter().enumerate() {
        for (r_idx, &val) in col.iter().enumerate() {
            if r_idx < n_rows {
                composite_scores[r_idx][c_idx] = val;
            }
        }
    }

    let converged = raw["converged"].as_bool().unwrap_or(false);
    Ok(PlsResult {
        converged,
        constructs,
        declared_constructs,
        construct_names,
        construct_types,
        interaction_constructs,
        indicators_of,
        indicator_names,
        weights,
        loadings,
        paths,
        path_order,
        composite_scores,
        n_used: n_rows,
    })
}

/// Phase 0 adapter: runPLS(dataRows, model, settings) -> PLSResult
pub fn run_pls(
    columns: &[String],
    rows: &[Vec<Value>],
    model_spec: &Value,
    settings: &PlsSettings,
) -> Result<PlsResult, String> {
    settings.validate()?;
    if rows.iter().any(|r| r.len() != columns.len()) {
        return Err("Dataset row width differs from columns".into());
    }

    let working_rows: Vec<Vec<Value>> = if settings.missing_treatment_key() == "listwise" {
        filter_casewise_rows(columns, rows, model_spec)?
    } else {
        rows.to_vec()
    };

    if working_rows.len() < 5 {
        return non_converged_stub(model_spec, working_rows.len());
    }

    // Constant or completely missing indicator in this subset -> treat as non-converged/failed run (Phase 9 #4).
    let bad_inds = find_constant_or_missing_indicators(columns, &working_rows, model_spec)?;
    if !bad_inds.is_empty() {
        return non_converged_stub(model_spec, working_rows.len());
    }

    let raw = match pipeline::run_without_fit(
        columns.to_vec(),
        working_rows.clone(),
        model_spec.clone(),
        settings.to_pipeline_json("dominant"),
    ) {
        Ok(v) => v,
        Err(_) => return non_converged_stub(model_spec, working_rows.len()),
    };

    extract_pls_result(&raw, model_spec)
}

/// Phase 0 adapter: alignSigns(result, referenceResult)
pub fn align_signs(mut result: PlsResult, reference: &PlsResult) -> PlsResult {
    let mut signs: BTreeMap<String, f64> = BTreeMap::new();
    for k in &result.constructs {
        let w = result.weights.get(k);
        let rw = reference.weights.get(k);
        let d = match (w, rw) {
            (Some(a), Some(b)) => a.iter().zip(b.iter()).map(|(x, y)| x * y).sum::<f64>(),
            _ => 1.0,
        };
        signs.insert(k.clone(), if d < 0.0 { -1.0 } else { 1.0 });
    }

    for (idx, k) in result.constructs.iter().enumerate() {
        let s = signs.get(k).copied().unwrap_or(1.0);
        if s < 0.0 {
            if let Some(w) = result.weights.get_mut(k) {
                for v in w.iter_mut() {
                    *v = -*v;
                }
            }
            if let Some(l) = result.loadings.get_mut(k) {
                for v in l.iter_mut() {
                    *v = -*v;
                }
            }
            for row in &mut result.composite_scores {
                if let Some(cell) = row.get_mut(idx) {
                    *cell = -*cell;
                }
            }
        }
    }

    for [from, to] in &result.path_order {
        let key = format!("{from}->{to}");
        if let Some(val) = result.paths.get_mut(&key) {
            let si = signs.get(from).copied().unwrap_or(1.0);
            let sj = signs.get(to).copied().unwrap_or(1.0);
            *val *= si * sj;
        }
    }

    result
}

/// Apply the exact same sign-alignment formula to a lightweight bootstrap sample.
pub fn align_sample_signs(mut sample: BootstrapSample, reference: &PlsResult) -> BootstrapSample {
    let mut signs: BTreeMap<String, f64> = BTreeMap::new();
    for k in &reference.constructs {
        let d = match (sample.weights.get(k), reference.weights.get(k)) {
            (Some(a), Some(b)) => a.iter().zip(b.iter()).map(|(x, y)| x * y).sum::<f64>(),
            _ => 1.0,
        };
        signs.insert(k.clone(), if d < 0.0 { -1.0 } else { 1.0 });
    }

    for k in &reference.constructs {
        let s = signs.get(k).copied().unwrap_or(1.0);
        if s < 0.0 {
            if let Some(w) = sample.weights.get_mut(k) {
                for v in w.iter_mut() {
                    *v = -*v;
                }
            }
            if let Some(l) = sample.loadings.get_mut(k) {
                for v in l.iter_mut() {
                    *v = -*v;
                }
            }
        }
    }

    for [from, to] in &reference.path_order {
        let key = format!("{from}->{to}");
        if let Some(val) = sample.paths.get_mut(&key) {
            let si = signs.get(from).copied().unwrap_or(1.0);
            let sj = signs.get(to).copied().unwrap_or(1.0);
            *val *= si * sj;
        }
    }

    sample
}

/// Phase 0 adapter: runBootstrap(dataRows, model, settings, nSubsamples, seed) -> BootstrapResult
pub fn run_bootstrap(
    columns: &[String],
    rows: &[Vec<Value>],
    model_spec: &Value,
    settings: &PlsSettings,
    n_subsamples: usize,
    seed: u64,
) -> Result<BootstrapResult, String> {
    run_bootstrap_with_control(
        columns,
        rows,
        model_spec,
        settings,
        n_subsamples,
        seed,
        true,
        &AtomicBool::new(false),
        &|_, _| {},
    )
}

#[allow(clippy::too_many_arguments)]
pub fn run_bootstrap_with_control(
    columns: &[String],
    rows: &[Vec<Value>],
    model_spec: &Value,
    settings: &PlsSettings,
    n_subsamples: usize,
    seed: u64,
    parallel: bool,
    cancel: &AtomicBool,
    progress: &(dyn Fn(usize, usize) + Sync),
) -> Result<BootstrapResult, String> {
    settings.validate()?;
    if n_subsamples == 0 {
        return Err("nSubsamples must be greater than 0".into());
    }
    if rows.iter().any(|r| r.len() != columns.len()) {
        return Err("Dataset row width differs from columns".into());
    }

    let working_rows: Vec<Vec<Value>> = if settings.missing_treatment_key() == "listwise" {
        filter_casewise_rows(columns, rows, model_spec)?
    } else {
        rows.to_vec()
    };

    let original = run_pls(columns, &working_rows, model_spec, settings)?;
    if !original.converged {
        return Err("Original PLS estimation failed to converge or encountered constant/missing indicators.".into());
    }

    // Ensure column headers match the exact strings expected by bootstrap.rs (handles case-insensitive header resolution).
    let parsed = model::parse(model_spec)?;
    let mut boot_columns = columns.to_vec();
    for (_, mapped) in &parsed.indicators {
        if !boot_columns.contains(mapped) {
            if let Some(pos) = boot_columns
                .iter()
                .rposition(|c| c.trim().to_lowercase() == mapped.trim().to_lowercase())
            {
                boot_columns[pos] = mapped.clone();
            }
        }
    }

    let boot_opts = bootstrap::Options {
        n_boot: n_subsamples,
        seed: Some(seed),
        scheme: settings.weighting_scheme.trim().to_lowercase(),
        consistent: settings.consistent,
        max_iter: settings.max_iterations,
        tol: settings.tolerance(),
        mode: "basic".into(),
        sign_change: "none".into(),
        test_distribution: "t".into(),
        significance_level: 0.05,
        tails: "two".into(),
        ci_method: "percentile".into(),
        n_workers: if parallel { None } else { Some(1) },
        sign_alignment: None,
        alpha: None,
        model_settings: json!({
            "missing_treatment": if settings.missing_treatment_key() == "listwise" { "listwise" } else { "mean" },
        }),
        ..bootstrap::Options::default()
    };

    let raw_boot = bootstrap::run_with_control(
        boot_columns,
        working_rows.clone(),
        model_spec.clone(),
        boot_opts,
        cancel,
        progress,
    )
    .map_err(|e| {
        if e.contains("Duplicate bootstrap dataset columns") {
            "Not supported in MGA.".to_string()
        } else {
            e
        }
    })?;

    let param_names = raw_boot["parameter_names"]
        .as_array()
        .ok_or("Bootstrap output missing parameter_names")?;
    let param_index: BTreeMap<String, usize> = param_names
        .iter()
        .enumerate()
        .filter_map(|(idx, v)| v.as_str().map(|s| (s.to_string(), idx)))
        .collect();

    let matrix = raw_boot["samples_matrix"]
        .as_array()
        .ok_or("Bootstrap output missing samples_matrix")?;

    let mut samples = Vec::with_capacity(matrix.len());
    for row_val in matrix {
        let Some(row) = row_val.as_array() else {
            continue;
        };
        let get_val = |key: &str| -> f64 {
            param_index
                .get(key)
                .and_then(|&idx| row.get(idx))
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
        };

        let mut weights = BTreeMap::new();
        let mut loadings = BTreeMap::new();
        for c in &original.constructs {
            let inds = original
                .indicators_of
                .get(c)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            weights.insert(
                c.clone(),
                inds.iter()
                    .map(|iid| get_val(&format!("weight:{c}->{iid}")))
                    .collect(),
            );
            loadings.insert(
                c.clone(),
                inds.iter()
                    .map(|iid| get_val(&format!("loading:{c}->{iid}")))
                    .collect(),
            );
        }

        let mut paths = BTreeMap::new();
        for [from, to] in &original.path_order {
            let key = format!("{from}->{to}");
            paths.insert(key, get_val(&format!("path:{from}->{to}")));
        }

        samples.push(align_sample_signs(
            BootstrapSample {
                weights,
                loadings,
                paths,
            },
            &original,
        ));
    }

    if samples.is_empty() {
        return Err("All bootstrap subsamples failed to converge.".into());
    }

    let failed_runs = n_subsamples.saturating_sub(samples.len());
    let mut se_paths = BTreeMap::new();
    for [from, to] in &original.path_order {
        let key = format!("{from}->{to}");
        let vals: Vec<f64> = samples
            .iter()
            .filter_map(|s| s.paths.get(&key).copied())
            .collect();
        let se = if vals.len() > 1 {
            stats::std(&vals, None, 1)
        } else {
            0.0
        };
        se_paths.insert(key, se);
    }

    let mut se_loadings = BTreeMap::new();
    let mut se_weights = BTreeMap::new();
    for c in &original.constructs {
        let k = original.indicators_of.get(c).map_or(0, Vec::len);
        let mut l_se = Vec::with_capacity(k);
        let mut w_se = Vec::with_capacity(k);
        for idx in 0..k {
            let l_vals: Vec<f64> = samples
                .iter()
                .filter_map(|s| s.loadings.get(c).and_then(|v| v.get(idx)).copied())
                .collect();
            let w_vals: Vec<f64> = samples
                .iter()
                .filter_map(|s| s.weights.get(c).and_then(|v| v.get(idx)).copied())
                .collect();
            l_se.push(if l_vals.len() > 1 {
                stats::std(&l_vals, None, 1)
            } else {
                0.0
            });
            w_se.push(if w_vals.len() > 1 {
                stats::std(&w_vals, None, 1)
            } else {
                0.0
            });
        }
        se_loadings.insert(c.clone(), l_se);
        se_weights.insert(c.clone(), w_se);
    }

    Ok(BootstrapResult {
        n_used: original.n_used,
        original,
        samples,
        std_error: BootstrapStdErrors {
            paths: se_paths,
            loadings: se_loadings,
            weights: se_weights,
        },
        failed_runs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_dataset() -> (Vec<String>, Vec<Vec<Value>>, Value) {
        let columns = vec![
            "x1".into(),
            "x2".into(),
            "m1".into(),
            "m2".into(),
            "y1".into(),
            "y2".into(),
        ];
        let mut rows = Vec::new();
        for i in 0..80 {
            let t = (i as f64) * 0.1 - 4.0;
            let n1 = ((i * 7 + 1) % 13) as f64 / 13.0 - 0.5;
            let n2 = ((i * 11 + 3) % 17) as f64 / 17.0 - 0.5;
            let n3 = ((i * 5 + 2) % 11) as f64 / 11.0 - 0.5;
            let x = t + 0.3 * n1;
            let m = 0.55 * x + 0.4 * n2;
            let y = 0.35 * x + 0.45 * m + 0.35 * n3;
            rows.push(vec![
                json!(3.0 + x + 0.15 * n2),
                json!(3.1 + 0.9 * x - 0.15 * n3),
                json!(2.5 + m + 0.12 * n1),
                json!(2.6 + 0.95 * m - 0.12 * n3),
                json!(4.0 + y + 0.14 * n1),
                json!(4.1 + 0.92 * y - 0.14 * n2),
            ]);
        }
        let spec = json!({
            "constructs": [
                {"id": "X", "name": "X", "type": "reflective", "indicators": ["x1", "x2"]},
                {"id": "M", "name": "M", "type": "reflective", "indicators": ["m1", "m2"]},
                {"id": "Y", "name": "Y", "type": "reflective", "indicators": ["y1", "y2"]}
            ],
            "indicators": [
                {"id": "x1", "column": "x1"},
                {"id": "x2", "column": "x2"},
                {"id": "m1", "column": "m1"},
                {"id": "m2", "column": "m2"},
                {"id": "y1", "column": "y1"},
                {"id": "y2", "column": "y2"}
            ],
            "paths": [
                {"from": "X", "to": "M"},
                {"from": "X", "to": "Y"},
                {"from": "M", "to": "Y"}
            ]
        });
        (columns, rows, spec)
    }

    #[test]
    fn phase0_run_pls_and_align_signs_restore_flipped_construct() {
        let (cols, rows, spec) = synthetic_dataset();
        let settings = PlsSettings::default();
        let orig = run_pls(&cols, &rows, &spec, &settings).expect("run_pls should succeed");
        assert!(orig.converged);
        assert_eq!(orig.constructs, vec!["X", "M", "Y"]);
        assert_eq!(orig.composite_scores.len(), rows.len());
        assert_eq!(orig.composite_scores[0].len(), 3);
        assert!(orig.paths.contains_key("X->M"));

        // Force-flip construct M weights, loadings, and attached paths X->M and M->Y.
        let mut flipped = orig.clone();
        for w in flipped.weights.get_mut("M").unwrap() {
            *w = -*w;
        }
        for l in flipped.loadings.get_mut("M").unwrap() {
            *l = -*l;
        }
        *flipped.paths.get_mut("X->M").unwrap() *= -1.0;
        *flipped.paths.get_mut("M->Y").unwrap() *= -1.0;

        let restored = align_signs(flipped, &orig);
        assert_eq!(restored.weights["M"], orig.weights["M"]);
        assert_eq!(restored.loadings["M"], orig.loadings["M"]);
        assert!((restored.paths["X->M"] - orig.paths["X->M"]).abs() < 1e-12);
        assert!((restored.paths["M->Y"] - orig.paths["M->Y"]).abs() < 1e-12);
        assert!((restored.paths["X->Y"] - orig.paths["X->Y"]).abs() < 1e-12);
    }

    #[test]
    fn phase0_run_bootstrap_exposes_raw_samples_and_std_errors() {
        let (cols, rows, spec) = synthetic_dataset();
        let settings = PlsSettings::default();
        let boot = run_bootstrap(&cols, &rows, &spec, &settings, 40, 1234).expect("bootstrap should work");
        assert_eq!(boot.samples.len(), 40);
        assert!(boot.std_error.paths["X->M"] > 0.0);
        assert_eq!(boot.std_error.loadings["X"].len(), 2);
        assert_eq!(boot.std_error.weights["X"].len(), 2);
    }

    #[test]
    fn phase0_constant_indicator_marks_run_non_converged() {
        let (cols, mut rows, spec) = synthetic_dataset();
        for r in &mut rows {
            r[0] = json!(3.0);
        }
        let res = run_pls(&cols, &rows, &spec, &PlsSettings::default()).unwrap();
        assert!(!res.converged);
    }
}
