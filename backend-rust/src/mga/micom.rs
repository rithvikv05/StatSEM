//! Phase 4 — MICOM (Measurement Invariance of Composite Models): Steps 1, 2, 3a, 3b & Summary.
use crate::mga::adapter::{
    find_constant_or_missing_indicators, resolve_model_indicator_columns, PlsSettings,
};
use crate::mga::groups::validate_pair_for_comparison;
use crate::mga::math::{
    correlation, mean, percentile, shuffle_in_place, std_dev, variance, SeededRng,
};
use crate::mga::permutation::{
    prepare_original_fits, run_permutation_loop, validate_permutation_settings, PermutationParamRow,
    PermutationSettings,
};
use crate::model;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicomStep1Check {
    pub label: String,
    pub passed: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicomStep1Result {
    pub passed: bool,
    pub checks: Vec<MicomStep1Check>,
    pub qualitative_note: String,
    pub stop_message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicomStep2Row {
    pub construct_id: String,
    pub construct_name: String,
    pub single_indicator: boolean_alias::BoolType,
    pub original_correlation: f64,
    pub permutation_mean: f64,
    pub quantile_5_pct: f64,
    pub p_value: f64,
    pub passed: bool,
    pub note: Option<String>,
}

mod boolean_alias {
    pub type BoolType = bool;
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicomStep3Row {
    pub construct_id: String,
    pub construct_name: String,
    pub original_difference: f64,
    pub permutation_mean_difference: f64,
    pub ci_lower: f64,
    pub ci_upper: f64,
    pub p_value: f64,
    pub passed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicomSummaryRow {
    pub construct_id: String,
    pub construct_name: String,
    pub configural: bool,
    pub compositional: bool,
    pub equal_mean: Option<bool>,
    pub equal_variance: Option<bool>,
    pub verdict: String,
    pub explanation: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicomResult {
    pub step1: MicomStep1Result,
    pub step2: Vec<MicomStep2Row>,
    pub step3_means: Vec<MicomStep3Row>,
    pub step3_variances: Vec<MicomStep3Row>,
    pub summary: Vec<MicomSummaryRow>,
    pub failed_compositional_constructs: Vec<String>,
    pub any_no_invariance: bool,
    pub all_invariant: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermutationReport {
    pub id: String,
    pub report_type: String,
    pub title: String,
    pub created_at: String,
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dataset_id: Option<String>,
    pub group_a_name: String,
    pub group_b_name: String,
    pub n_a: usize,
    pub n_b: usize,
    pub permutations_requested: usize,
    pub permutations_completed: usize,
    pub failed_runs: usize,
    pub failed_run_warning: Option<String>,
    pub test_type: String,
    pub significance_level: f64,
    #[serde(default = "default_true")]
    pub parallel_processing: bool,
    pub seed: u64,
    pub pls_settings: PlsSettings,
    pub path_coefficients: Vec<PermutationParamRow>,
    pub outer_loadings: Vec<PermutationParamRow>,
    pub outer_weights: Vec<PermutationParamRow>,
    pub micom: MicomResult,
}

/// Evaluate MICOM Step 1 — Configural invariance checks.
pub fn evaluate_step1(
    columns: &[String],
    rows_a: &[Vec<Value>],
    rows_b: &[Vec<Value>],
    model_spec: &Value,
    settings: &PlsSettings,
) -> Result<MicomStep1Result, String> {
    let bad_a = find_constant_or_missing_indicators(columns, rows_a, model_spec)?;
    let bad_b = find_constant_or_missing_indicators(columns, rows_b, model_spec)?;

    let item1_passed = bad_a.is_empty() && bad_b.is_empty();
    let item1_detail = if item1_passed {
        "Both groups use identical indicators per measurement model with valid non-constant data."
            .to_string()
    } else {
        let mut parts = Vec::new();
        if !bad_a.is_empty() {
            parts.push(format!("Group A constant/missing: {}", bad_a.join(", ")));
        }
        if !bad_b.is_empty() {
            parts.push(format!("Group B constant/missing: {}", bad_b.join(", ")));
        }
        parts.join("; ")
    };

    let checks = vec![
        MicomStep1Check {
            label: "Identical indicators per measurement model".into(),
            passed: item1_passed,
            detail: item1_detail.clone(),
        },
        MicomStep1Check {
            label: "Identical data treatment".into(),
            passed: true,
            detail: format!("Missing value handling: {}", settings.missing_values),
        },
        MicomStep1Check {
            label: "Identical algorithm settings".into(),
            passed: true,
            detail: format!(
                "Weighting: {}, max iterations: {}, stop criterion: 10^-{}",
                settings.weighting_scheme, settings.max_iterations, settings.stop_criterion_exponent
            ),
        },
    ];

    let passed = checks.iter().all(|c| c.passed);
    let stop_message = if passed {
        None
    } else {
        Some(format!(
            "Configural invariance failed ({item1_detail}). Steps 2 and 3 cannot proceed."
        ))
    };

    Ok(MicomStep1Result {
        passed,
        checks,
        qualitative_note: "Qualitative checks (identical translation, coding, outlier treatment) must be confirmed by the researcher.".into(),
        stop_message,
    })
}

/// Extract numeric indicator matrix for a construct from `pooled_rows`, applying pooled mean imputation
/// for any missing values (matching `pipeline.rs` when `missing_treatment != "listwise"`), and standardize
/// each column with `ddof = 1`.
fn standardized_pooled_indicators(
    columns: &[String],
    pooled_rows: &[Vec<Value>],
    model_spec: &Value,
    indicator_ids: &[String],
) -> Result<Vec<Vec<f64>>, String> {
    let resolved = resolve_model_indicator_columns(columns, model_spec)?;
    let col_lookup: HashMap<String, usize> = resolved
        .into_iter()
        .map(|(iid, col_idx, _)| (iid, col_idx))
        .collect();

    let mut cols_data: Vec<Vec<f64>> = Vec::with_capacity(indicator_ids.len());
    for iid in indicator_ids {
        let &col_idx = col_lookup
            .get(iid)
            .ok_or_else(|| format!("Indicator '{iid}' missing from resolved model columns"))?;
        let mut raw: Vec<f64> = pooled_rows
            .iter()
            .map(|r| {
                let v = model::numeric(&r[col_idx]);
                if v == -99.0 {
                    f64::NAN
                } else {
                    v
                }
            })
            .collect();
        let valid: Vec<f64> = raw.iter().copied().filter(|v| !v.is_nan()).collect();
        let m = if valid.is_empty() { 0.0 } else { mean(&valid) };
        for v in &mut raw {
            if v.is_nan() {
                *v = m;
            }
        }
        let m_all = mean(&raw);
        let sd_all = std_dev(&raw, 1);
        let denom = if sd_all.is_finite() && sd_all > 1e-12 {
            sd_all
        } else {
            1.0
        };
        cols_data.push(raw.into_iter().map(|v| (v - m_all) / denom).collect());
    }
    Ok(cols_data)
}

/// Compute c(wA, wB) = (wA' Sigma wB) / sqrt((wA' Sigma wA) * (wB' Sigma wB)).
fn compositional_correlation(w_a: &[f64], w_b: &[f64], sigma: &[Vec<f64>]) -> f64 {
    let k = w_a.len();
    if k <= 1 {
        return 1.0;
    }
    let quad = |u: &[f64], v: &[f64]| -> f64 {
        let mut s = 0.0;
        for i in 0..k {
            for j in 0..k {
                s += u[i] * sigma[i][j] * v[j];
            }
        }
        s
    };
    let num = quad(w_a, w_b);
    let den_a = quad(w_a, w_a);
    let den_b = quad(w_b, w_b);
    let denom = (den_a * den_b).sqrt();
    if !denom.is_finite() || denom <= 1e-15 {
        return 1.0;
    }
    (num / denom).clamp(-1.0, 1.0)
}

/// Run Permutation + MICOM (Steps 1-3) together cleanly.
#[allow(clippy::too_many_arguments)]
pub fn run_permutation_with_micom(
    columns: &[String],
    rows: &[Vec<Value>],
    model_spec: &Value,
    settings: &PermutationSettings,
    model_id: &str,
    dataset_id: Option<&str>,
    cancel: &AtomicBool,
    progress: &(dyn Fn(usize, usize) + Sync),
) -> Result<PermutationReport, String> {
    validate_permutation_settings(settings)?;
    let casewise = settings.pls_settings.missing_treatment_key() == "listwise";
    let (rows_a, rows_b) = validate_pair_for_comparison(
        columns,
        rows,
        model_spec,
        &settings.group_a,
        &settings.group_b,
        casewise,
    )?;

    // Step 1 — Configural Invariance
    let step1 = evaluate_step1(columns, &rows_a, &rows_b, model_spec, &settings.pls_settings)?;
    let orig_parsed = model::parse(model_spec)?;
    let declared_constructs: Vec<(String, String)> = orig_parsed
        .blocks
        .iter()
        .filter(|b| !b.is_interaction)
        .map(|b| (b.id.clone(), b.name.clone().unwrap_or_else(|| b.id.clone())))
        .collect();

    if !step1.passed {
        let summary: Vec<MicomSummaryRow> = declared_constructs
            .iter()
            .map(|(cid, cname)| MicomSummaryRow {
                construct_id: cid.clone(),
                construct_name: cname.clone(),
                configural: false,
                compositional: false,
                equal_mean: None,
                equal_variance: None,
                verdict: "No invariance".into(),
                explanation: "Do not compare path coefficients involving this construct.".into(),
            })
            .collect();
        return Ok(PermutationReport {
            id: uuid::Uuid::new_v4().to_string(),
            report_type: "permutation".into(),
            title: format!(
                "Permutation: {} vs {}",
                settings.group_a.name, settings.group_b.name
            ),
            created_at: chrono::Utc::now().to_rfc3339(),
            model_id: model_id.to_string(),
            dataset_id: dataset_id.map(str::to_owned),
            group_a_name: settings.group_a.name.clone(),
            group_b_name: settings.group_b.name.clone(),
            n_a: rows_a.len(),
            n_b: rows_b.len(),
            permutations_requested: settings.permutations,
            permutations_completed: 0,
            failed_runs: 0,
            failed_run_warning: step1.stop_message.clone(),
            test_type: settings.test_type.clone(),
            significance_level: settings.significance_level,
            parallel_processing: settings.parallel_processing,
            seed: settings.seed.unwrap_or(0),
            pls_settings: settings.pls_settings.clone(),
            path_coefficients: Vec::new(),
            outer_loadings: Vec::new(),
            outer_weights: Vec::new(),
            micom: MicomResult {
                step1,
                step2: Vec::new(),
                step3_means: Vec::new(),
                step3_variances: Vec::new(),
                summary,
                failed_compositional_constructs: Vec::new(),
                any_no_invariance: true,
                all_invariant: false,
            },
        });
    }

    // Run Phase 3 Permutation Engine
    let (pooled, n_a, n_b, orig_a, orig_b, orig_pooled) =
        prepare_original_fits(columns, rows, model_spec, settings)?;
    let perm_res = run_permutation_loop(
        columns,
        model_spec,
        settings,
        pooled,
        n_a,
        n_b,
        orig_a,
        orig_b,
        orig_pooled,
        cancel,
        progress,
    )?;

    let n_completed = perm_res.permutations_completed;
    let n_total = n_a + n_b;
    let alpha = settings.significance_level.clamp(1e-6, 0.49);

    // Precompute permutation indices once for Step 3 reuse (Phase 4 §6.3: same idx as Phase 3 for run u)
    let perm_indices: Vec<Vec<usize>> = perm_res
        .samples
        .iter()
        .map(|s| {
            let mut sub_rng = SeededRng::from_seed(perm_res.seed_used.wrapping_add(s.u as u64));
            let mut idx: Vec<usize> = (0..n_total).collect();
            shuffle_in_place(&mut idx, &mut sub_rng);
            idx
        })
        .collect();

    // Step 2 & Step 3 per declared construct (Phase 9 #12: MICOM runs on declared constructs only)
    let mut step2_rows = Vec::new();
    let mut step3_mean_rows = Vec::new();
    let mut step3_var_rows = Vec::new();
    let mut summary_rows = Vec::new();
    let mut failed_compositional_constructs = Vec::new();

    for cid in &perm_res.orig_a.declared_constructs {
        let cname = perm_res
            .orig_a
            .construct_names
            .get(cid)
            .cloned()
            .unwrap_or_else(|| cid.clone());
        let inds = perm_res
            .orig_a
            .indicators_of
            .get(cid)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let single_indicator = inds.len() == 1;

        let z_cols = standardized_pooled_indicators(columns, &perm_res.pooled_rows, model_spec, inds)?;

        // Compute pooled indicator correlation matrix Sigma_k
        let k = inds.len();
        let mut sigma = vec![vec![1.0; k]; k];
        for i in 0..k {
            for j in (i + 1)..k {
                let r = correlation(&z_cols[i], &z_cols[j]);
                let val = if r.is_finite() { r } else { 0.0 };
                sigma[i][j] = val;
                sigma[j][i] = val;
            }
        }

        let w_a0 = perm_res
            .orig_a
            .weights
            .get(cid)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let w_b0 = perm_res
            .orig_b
            .weights
            .get(cid)
            .map(Vec::as_slice)
            .unwrap_or(&[]);

        let (c0, c_dist, c_mean, c_q5, c_p, step2_pass, note) = if single_indicator {
            (
                1.0,
                vec![1.0; n_completed],
                1.0,
                1.0,
                1.0,
                true,
                Some("Not applicable (single indicator)".to_string()),
            )
        } else {
            let c0 = compositional_correlation(w_a0, w_b0, &sigma);
            let mut c_dist: Vec<f64> = perm_res
                .samples
                .iter()
                .map(|s| {
                    let wa = s.weights_a.get(cid).map(Vec::as_slice).unwrap_or(&[]);
                    let wb = s.weights_b.get(cid).map(Vec::as_slice).unwrap_or(&[]);
                    compositional_correlation(wa, wb, &sigma)
                })
                .collect();
            let c_mean = mean(&c_dist);
            let count_le = c_dist.iter().filter(|&&v| v <= c0).count();
            let c_p = count_le as f64 / n_completed as f64;
            c_dist.sort_by(f64::total_cmp);
            let c_q5 = percentile(&c_dist, 0.05);
            let step2_pass = c0 >= c_q5;
            (c0, c_dist, c_mean, c_q5, c_p, step2_pass, None)
        };
        let _ = c_dist;

        step2_rows.push(MicomStep2Row {
            construct_id: cid.clone(),
            construct_name: cname.clone(),
            single_indicator,
            original_correlation: c0,
            permutation_mean: c_mean,
            quantile_5_pct: c_q5,
            p_value: c_p,
            passed: step2_pass,
            note,
        });

        if !step2_pass {
            failed_compositional_constructs.push(cname.clone());
            summary_rows.push(MicomSummaryRow {
                construct_id: cid.clone(),
                construct_name: cname,
                configural: true,
                compositional: false,
                equal_mean: None,
                equal_variance: None,
                verdict: "No invariance".into(),
                explanation: "Do not compare path coefficients involving this construct.".into(),
            });
            continue;
        }

        // Step 3 — Equality of composite means & variances (only for constructs passing Step 2)
        let w_p = perm_res
            .orig_pooled
            .weights
            .get(cid)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let mut raw_score = vec![0.0; n_total];
        for (j, col) in z_cols.iter().enumerate() {
            let wj = w_p.get(j).copied().unwrap_or(0.0);
            for (r, &z_val) in col.iter().enumerate() {
                raw_score[r] += z_val * wj;
            }
        }
        let score_mean = mean(&raw_score);
        let score_sd = std_dev(&raw_score, 1);
        let score_denom = if score_sd.is_finite() && score_sd > 1e-12 {
            score_sd
        } else {
            1.0
        };
        let score: Vec<f64> = raw_score
            .into_iter()
            .map(|v| (v - score_mean) / score_denom)
            .collect();

        let score_a = &score[..n_a];
        let score_b = &score[n_a..];
        let mean_diff0 = mean(score_a) - mean(score_b);
        let var_a0 = variance(score_a, 1).max(1e-15);
        let var_b0 = variance(score_b, 1).max(1e-15);
        let var_diff0 = var_a0.ln() - var_b0.ln();

        let mut mean_dist = Vec::with_capacity(n_completed);
        let mut var_dist = Vec::with_capacity(n_completed);
        for idx in &perm_indices {
            let s_a: Vec<f64> = idx[..n_a].iter().map(|&i| score[i]).collect();
            let s_b: Vec<f64> = idx[n_a..].iter().map(|&i| score[i]).collect();
            mean_dist.push(mean(&s_a) - mean(&s_b));
            let va = variance(&s_a, 1).max(1e-15);
            let vb = variance(&s_b, 1).max(1e-15);
            var_dist.push(va.ln() - vb.ln());
        }

        let mean_perm_mean = mean(&mean_dist);
        let mean_p =
            mean_dist.iter().filter(|&&v| v.abs() >= mean_diff0.abs()).count() as f64 / n_completed as f64;
        mean_dist.sort_by(f64::total_cmp);
        let mean_lo = percentile(&mean_dist, alpha / 2.0);
        let mean_hi = percentile(&mean_dist, 1.0 - alpha / 2.0);
        let mean_pass = mean_lo <= mean_diff0 && mean_diff0 <= mean_hi;

        let var_perm_mean = mean(&var_dist);
        let var_p =
            var_dist.iter().filter(|&&v| v.abs() >= var_diff0.abs()).count() as f64 / n_completed as f64;
        var_dist.sort_by(f64::total_cmp);
        let var_lo = percentile(&var_dist, alpha / 2.0);
        let var_hi = percentile(&var_dist, 1.0 - alpha / 2.0);
        let var_pass = var_lo <= var_diff0 && var_diff0 <= var_hi;

        step3_mean_rows.push(MicomStep3Row {
            construct_id: cid.clone(),
            construct_name: cname.clone(),
            original_difference: mean_diff0,
            permutation_mean_difference: mean_perm_mean,
            ci_lower: mean_lo,
            ci_upper: mean_hi,
            p_value: mean_p,
            passed: mean_pass,
        });
        step3_var_rows.push(MicomStep3Row {
            construct_id: cid.clone(),
            construct_name: cname.clone(),
            original_difference: var_diff0,
            permutation_mean_difference: var_perm_mean,
            ci_lower: var_lo,
            ci_upper: var_hi,
            p_value: var_p,
            passed: var_pass,
        });

        let (verdict, explanation) = if mean_pass && var_pass {
            (
                "Full measurement invariance".to_string(),
                "Groups may be pooled; differences in model estimates are not due to measurement differences.".to_string(),
            )
        } else {
            (
                "Partial measurement invariance".to_string(),
                "Path coefficients can be compared across groups; do not pool the data.".to_string(),
            )
        };

        summary_rows.push(MicomSummaryRow {
            construct_id: cid.clone(),
            construct_name: cname,
            configural: true,
            compositional: true,
            equal_mean: Some(mean_pass),
            equal_variance: Some(var_pass),
            verdict,
            explanation,
        });
    }

    let any_no_invariance = summary_rows.iter().any(|r| r.verdict == "No invariance");
    let all_invariant = !any_no_invariance
        && summary_rows
            .iter()
            .all(|r| r.verdict == "Full measurement invariance");

    Ok(PermutationReport {
        id: uuid::Uuid::new_v4().to_string(),
        report_type: "permutation".into(),
        title: format!(
            "Permutation: {} vs {}",
            settings.group_a.name, settings.group_b.name
        ),
        created_at: chrono::Utc::now().to_rfc3339(),
        model_id: model_id.to_string(),
        dataset_id: dataset_id.map(str::to_owned),
        group_a_name: settings.group_a.name.clone(),
        group_b_name: settings.group_b.name.clone(),
        n_a,
        n_b,
        permutations_requested: perm_res.permutations_requested,
        permutations_completed: perm_res.permutations_completed,
        failed_runs: perm_res.failed_runs,
        failed_run_warning: perm_res.failed_run_warning,
        test_type: settings.test_type.clone(),
        significance_level: settings.significance_level,
        parallel_processing: settings.parallel_processing,
        seed: perm_res.seed_used,
        pls_settings: settings.pls_settings.clone(),
        path_coefficients: perm_res.path_coefficients,
        outer_loadings: perm_res.outer_loadings,
        outer_weights: perm_res.outer_weights,
        micom: MicomResult {
            step1,
            step2: step2_rows,
            step3_means: step3_mean_rows,
            step3_variances: step3_var_rows,
            summary: summary_rows,
            failed_compositional_constructs,
            any_no_invariance,
            all_invariant,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mga::groups::{DataGroup, GroupTerm};
    use serde_json::json;

    fn build_micom_test_data(
        n: usize,
        shift_x_g2: f64,
        corrupt_x_weights_g2: bool,
        seed: u64,
    ) -> (Vec<String>, Vec<Vec<Value>>, Value, DataGroup, DataGroup) {
        let mut rng = SeededRng::from_seed(seed);
        let normal = |r: &mut SeededRng| -> f64 {
            let u1 = ((r.next_u64() >> 11) as f64 + 1.0) / (9007199254740992.0 + 1.0);
            let u2 = (r.next_u64() >> 11) as f64 / 9007199254740992.0;
            (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
        };

        let cols = vec![
            "GRP".into(),
            "x1".into(),
            "x2".into(),
            "x3".into(),
            "y1".into(),
            "y2".into(),
            "y3".into(),
            "s1".into(),
        ];
        let mut rows = Vec::with_capacity(n * 2);
        for g in [1, 2] {
            for _ in 0..n {
                let x = normal(&mut rng);
                let s = 0.3 * x + normal(&mut rng);
                let y = 0.5 * x + 0.25 * s + 0.5 * normal(&mut rng);
                let shift = if g == 2 { shift_x_g2 } else { 0.0 };
                let (x1v, x2v, x3v) = if g == 2 && corrupt_x_weights_g2 {
                    // Plant strong measurement difference on X in group 2 by making x2 orthogonal/inverted
                    // and decoupling x3 relative to x1 while still predicting Y differently.
                    let alt = normal(&mut rng);
                    (
                        x + 0.1 * normal(&mut rng),
                        -1.5 * alt + 0.2 * normal(&mut rng),
                        3.0 * y + 0.1 * normal(&mut rng),
                    )
                } else {
                    (
                        shift + x + 0.2 * normal(&mut rng),
                        shift + 0.95 * x + 0.2 * normal(&mut rng),
                        shift + 0.9 * x + 0.2 * normal(&mut rng),
                    )
                };
                rows.push(vec![
                    json!(g),
                    json!(x1v),
                    json!(x2v),
                    json!(x3v),
                    json!(y + 0.2 * normal(&mut rng)),
                    json!(0.95 * y + 0.2 * normal(&mut rng)),
                    json!(0.9 * y + 0.2 * normal(&mut rng)),
                    json!(s),
                ]);
            }
        }
        let spec = json!({
            "constructs": [
                {"id": "X", "name": "X", "type": "formative", "outer_mode": "B", "indicators": ["x1", "x2", "x3"]},
                {"id": "S", "name": "S", "type": "reflective", "indicators": ["s1"]},
                {"id": "Y", "name": "Y", "type": "reflective", "indicators": ["y1", "y2", "y3"]}
            ],
            "paths": [
                {"from": "X", "to": "Y"},
                {"from": "S", "to": "Y"}
            ]
        });
        let ga = DataGroup {
            id: "a".into(),
            name: "Group 1".into(),
            condition_link_type: "AND".into(),
            terms: vec![GroupTerm {
                column: "GRP".into(),
                operator: "is equal to".into(),
                value1: json!(1),
                value2: None,
            }],
            record_count: n,
            row_ids: None,
        };
        let gb = DataGroup {
            id: "b".into(),
            name: "Group 2".into(),
            condition_link_type: "AND".into(),
            terms: vec![GroupTerm {
                column: "GRP".into(),
                operator: "is equal to".into(),
                value1: json!(2),
                value2: None,
            }],
            record_count: n,
            row_ids: None,
        };
        (cols, rows, spec, ga, gb)
    }

    #[test]
    fn phase4_micom_identical_groups_and_single_indicator() {
        let (cols, rows, spec, ga, gb) = build_micom_test_data(120, 0.0, false, 101);
        let settings = PermutationSettings {
            group_a: ga,
            group_b: gb,
            permutations: 150,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(42),
            pls_settings: PlsSettings::default(),
        };
        let cancel = AtomicBool::new(false);
        let report = run_permutation_with_micom(
            &cols,
            &rows,
            &spec,
            &settings,
            "m1",
            None,
            &cancel,
            &|_, _| {},
        )
        .unwrap();

        assert!(report.micom.step1.passed);
        assert!(report.micom.all_invariant);
        assert!(report.micom.step2.iter().all(|r| r.passed));
        let single = report
            .micom
            .step2
            .iter()
            .find(|r| r.construct_id == "S")
            .unwrap();
        assert!(single.single_indicator);
        assert!((single.original_correlation - 1.0).abs() < 1e-12);
        // Single-indicator construct still gets Step 3 computed (Phase 9 #7)
        assert!(report
            .micom
            .step3_means
            .iter()
            .any(|r| r.construct_id == "S"));
    }

    #[test]
    fn phase4_micom_mean_shift_gives_partial_invariance() {
        let (cols, rows, spec, ga, gb) = build_micom_test_data(120, 1.2, false, 202);
        let settings = PermutationSettings {
            group_a: ga,
            group_b: gb,
            permutations: 150,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(42),
            pls_settings: PlsSettings::default(),
        };
        let cancel = AtomicBool::new(false);
        let report = run_permutation_with_micom(
            &cols,
            &rows,
            &spec,
            &settings,
            "m1",
            None,
            &cancel,
            &|_, _| {},
        )
        .unwrap();

        let x_step2 = report
            .micom
            .step2
            .iter()
            .find(|r| r.construct_id == "X")
            .unwrap();
        assert!(x_step2.passed, "Step 2 should pass under uniform mean shift");
        let x_mean = report
            .micom
            .step3_means
            .iter()
            .find(|r| r.construct_id == "X")
            .unwrap();
        assert!(!x_mean.passed, "Step 3 mean test should fail after +1.2 SD shift");
        let x_sum = report
            .micom
            .summary
            .iter()
            .find(|r| r.construct_id == "X")
            .unwrap();
        assert_eq!(x_sum.verdict, "Partial measurement invariance");
    }

    #[test]
    fn phase4_micom_planted_measurement_difference_fails_step2() {
        let (cols, rows, spec, ga, gb) = build_micom_test_data(120, 0.0, true, 303);
        let settings = PermutationSettings {
            group_a: ga,
            group_b: gb,
            permutations: 150,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(42),
            pls_settings: PlsSettings::default(),
        };
        let cancel = AtomicBool::new(false);
        let report = run_permutation_with_micom(
            &cols,
            &rows,
            &spec,
            &settings,
            "m1",
            None,
            &cancel,
            &|_, _| {},
        )
        .unwrap();

        let x_step2 = report
            .micom
            .step2
            .iter()
            .find(|r| r.construct_id == "X")
            .unwrap();
        assert!(
            !x_step2.passed,
            "Step 2 should fail for X when measurement weights diverge (c={}, q5={})",
            x_step2.original_correlation, x_step2.quantile_5_pct
        );
        let x_sum = report
            .micom
            .summary
            .iter()
            .find(|r| r.construct_id == "X")
            .unwrap();
        assert_eq!(x_sum.verdict, "No invariance");
        assert!(report.micom.any_no_invariance);
    }
}
