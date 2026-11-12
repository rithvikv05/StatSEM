//! Phase 3 — Seeded multi-worker permutation engine for path coefficients, loadings, and weights.
use crate::mga::adapter::{align_signs, run_pls, PlsResult, PlsSettings};
use crate::mga::groups::{validate_pair_for_comparison, DataGroup};
use crate::mga::math::{mean, percentile, random_seed, shuffle_in_place, SeededRng};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermutationSettings {
    pub group_a: DataGroup,
    pub group_b: DataGroup,
    #[serde(default = "default_permutations")]
    pub permutations: usize,
    #[serde(default = "default_test_type")]
    pub test_type: String, // "two-tailed" | "one-tailed"
    #[serde(default = "default_sig_level")]
    pub significance_level: f64,
    #[serde(default = "default_true")]
    pub parallel_processing: bool,
    pub seed: Option<u64>,
    #[serde(default)]
    pub pls_settings: PlsSettings,
}

fn default_permutations() -> usize {
    5000
}
fn default_test_type() -> String {
    "two-tailed".into()
}
fn default_sig_level() -> f64 {
    0.05
}
fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermutationParamRow {
    pub key: String,
    pub parameter: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub construct: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indicator: Option<String>,
    pub original_a: f64,
    pub original_b: f64,
    pub original_difference: f64,
    pub permutation_mean_difference: f64,
    pub ci_lower: f64,
    pub ci_upper: f64,
    pub p_value: f64,
    pub significant: bool,
}

#[derive(Clone, Debug)]
pub struct CompletedPermSample {
    pub u: usize,
    pub weights_a: BTreeMap<String, Vec<f64>>,
    pub weights_b: BTreeMap<String, Vec<f64>>,
    pub diff_paths: Vec<f64>,
    pub diff_loadings: Vec<Vec<f64>>,
    pub diff_weights: Vec<Vec<f64>>,
}

#[derive(Clone, Debug)]
pub struct PermutationCoreResult {
    pub seed_used: u64,
    pub n_a: usize,
    pub n_b: usize,
    pub pooled_rows: Vec<Vec<Value>>,
    pub orig_a: PlsResult,
    pub orig_b: PlsResult,
    pub orig_pooled: PlsResult,
    pub permutations_requested: usize,
    pub permutations_completed: usize,
    pub failed_runs: usize,
    pub failed_run_warning: Option<String>,
    pub samples: Vec<CompletedPermSample>,
    pub path_coefficients: Vec<PermutationParamRow>,
    pub outer_loadings: Vec<PermutationParamRow>,
    pub outer_weights: Vec<PermutationParamRow>,
}

pub fn compute_param_stats(
    d0: f64,
    diffs: &[f64],
    test_type: &str,
    significance_level: f64,
) -> (f64, f64, f64, f64, bool) {
    let n = diffs.len();
    if n == 0 {
        return (0.0, d0, d0, 1.0, false);
    }
    let perm_mean = mean(diffs);
    let mut sorted = diffs.to_vec();
    sorted.sort_by(f64::total_cmp);
    let alpha = significance_level.clamp(1e-6, 0.49);
    let ci_lower = percentile(&sorted, alpha / 2.0);
    let ci_upper = percentile(&sorted, 1.0 - alpha / 2.0);

    let count = if test_type.trim().eq_ignore_ascii_case("one-tailed") {
        if d0 >= 0.0 {
            diffs.iter().filter(|&&v| v >= d0).count()
        } else {
            diffs.iter().filter(|&&v| v <= d0).count()
        }
    } else {
        let abs_d0 = d0.abs();
        diffs.iter().filter(|&&v| v.abs() >= abs_d0).count()
    };

    let p_value = count as f64 / n as f64;
    let significant = p_value < significance_level;
    (perm_mean, ci_lower, ci_upper, p_value, significant)
}

pub fn validate_permutation_settings(settings: &PermutationSettings) -> Result<(), String> {
    settings.pls_settings.validate()?;
    if settings.permutations == 0 {
        return Err("Number of permutations must be greater than 0.".into());
    }
    if !(0.0..0.5).contains(&settings.significance_level) {
        return Err("Significance level must be between 0 and 0.5.".into());
    }
    let tt = settings.test_type.trim().to_lowercase();
    if tt != "two-tailed" && tt != "one-tailed" {
        return Err(format!("Unsupported testType: {}", settings.test_type));
    }
    Ok(())
}

/// Prepare validated group rows, concatenated pooled rows, and original PLS fits.
pub fn prepare_original_fits(
    columns: &[String],
    rows: &[Vec<Value>],
    model_spec: &Value,
    settings: &PermutationSettings,
) -> Result<(Vec<Vec<Value>>, usize, usize, PlsResult, PlsResult, PlsResult), String> {
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
    let n_a = rows_a.len();
    let n_b = rows_b.len();
    let mut pooled = Vec::with_capacity(n_a + n_b);
    pooled.extend(rows_a.iter().cloned());
    pooled.extend(rows_b.iter().cloned());

    let orig_a = run_pls(columns, &rows_a, model_spec, &settings.pls_settings)?;
    let orig_b = run_pls(columns, &rows_b, model_spec, &settings.pls_settings)?;
    let orig_pooled = run_pls(columns, &pooled, model_spec, &settings.pls_settings)?;

    Ok((pooled, n_a, n_b, orig_a, orig_b, orig_pooled))
}

/// Run the permutation loop given already-validated `pooled` rows and original estimates.
pub fn run_permutation_loop(
    columns: &[String],
    model_spec: &Value,
    settings: &PermutationSettings,
    pooled: Vec<Vec<Value>>,
    n_a: usize,
    n_b: usize,
    orig_a: PlsResult,
    orig_b: PlsResult,
    orig_pooled: PlsResult,
    cancel: &AtomicBool,
    progress: &(dyn Fn(usize, usize) + Sync),
) -> Result<PermutationCoreResult, String> {
    if !orig_a.converged || !orig_b.converged || !orig_pooled.converged {
        return Err("Original PLS model failed to converge (or encountered a constant/missing indicator) in one of the groups.".into());
    }

    let seed_used = settings.seed.unwrap_or_else(random_seed);
    let total_perms = settings.permutations;
    let n_total = n_a + n_b;

    let workers = if settings.parallel_processing {
        std::thread::available_parallelism().map_or(1, |n| n.get().saturating_sub(1).max(1))
    } else {
        1
    }
    .min(total_perms.max(1));

    let next_u = AtomicUsize::new(1);
    let completed_count = AtomicUsize::new(0);
    let failed_count = AtomicUsize::new(0);
    let slots: Mutex<Vec<Option<CompletedPermSample>>> = Mutex::new(vec![None; total_perms]);
    let worker_err: Mutex<Option<String>> = Mutex::new(None);

    let path_keys: Vec<String> = orig_a
        .path_order
        .iter()
        .map(|[f, t]| format!("{f}->{t}"))
        .collect();

    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                if worker_err.lock().unwrap().is_some() {
                    break;
                }
                let u = next_u.fetch_add(1, Ordering::Relaxed);
                if u > total_perms {
                    break;
                }

                let mut sub_rng = SeededRng::from_seed(seed_used.wrapping_add(u as u64));
                let mut idx: Vec<usize> = (0..n_total).collect();
                shuffle_in_place(&mut idx, &mut sub_rng);

                let perm_a: Vec<Vec<Value>> =
                    idx[..n_a].iter().map(|&i| pooled[i].clone()).collect();
                let perm_b: Vec<Vec<Value>> =
                    idx[n_a..].iter().map(|&i| pooled[i].clone()).collect();

                let r_a = match run_pls(columns, &perm_a, model_spec, &settings.pls_settings) {
                    Ok(v) => v,
                    Err(e) => {
                        let mut err = worker_err.lock().unwrap();
                        if err.is_none() {
                            *err = Some(e);
                        }
                        break;
                    }
                };
                let r_b = match run_pls(columns, &perm_b, model_spec, &settings.pls_settings) {
                    Ok(v) => v,
                    Err(e) => {
                        let mut err = worker_err.lock().unwrap();
                        if err.is_none() {
                            *err = Some(e);
                        }
                        break;
                    }
                };

                if !r_a.converged || !r_b.converged {
                    failed_count.fetch_add(1, Ordering::Relaxed);
                } else {
                    let r_a = align_signs(r_a, &orig_a);
                    let r_b = align_signs(r_b, &orig_b);

                    let diff_paths: Vec<f64> = path_keys
                        .iter()
                        .map(|k| {
                            r_a.paths.get(k).copied().unwrap_or(0.0)
                                - r_b.paths.get(k).copied().unwrap_or(0.0)
                        })
                        .collect();

                    let mut diff_loadings = Vec::with_capacity(orig_a.constructs.len());
                    let mut diff_weights = Vec::with_capacity(orig_a.constructs.len());
                    for c in &orig_a.constructs {
                        let l_a = r_a.loadings.get(c).map(Vec::as_slice).unwrap_or(&[]);
                        let l_b = r_b.loadings.get(c).map(Vec::as_slice).unwrap_or(&[]);
                        diff_loadings.push(l_a.iter().zip(l_b.iter()).map(|(a, b)| a - b).collect());

                        let w_a = r_a.weights.get(c).map(Vec::as_slice).unwrap_or(&[]);
                        let w_b = r_b.weights.get(c).map(Vec::as_slice).unwrap_or(&[]);
                        diff_weights.push(w_a.iter().zip(w_b.iter()).map(|(a, b)| a - b).collect());
                    }

                    let sample = CompletedPermSample {
                        u,
                        weights_a: r_a.weights,
                        weights_b: r_b.weights,
                        diff_paths,
                        diff_loadings,
                        diff_weights,
                    };
                    slots.lock().unwrap()[u - 1] = Some(sample);
                }

                let done = completed_count.fetch_add(1, Ordering::Relaxed) + 1;
                progress(done, total_perms);
            });
        }
    });

    if cancel.load(Ordering::Relaxed) {
        return Err("Permutation test cancelled by user.".into());
    }
    if let Some(err) = worker_err.into_inner().unwrap() {
        return Err(err);
    }

    let samples: Vec<CompletedPermSample> = slots
        .into_inner()
        .unwrap()
        .into_iter()
        .flatten()
        .collect();
    let failed_runs = failed_count.load(Ordering::Relaxed);
    let completed = samples.len();

    if completed == 0 {
        return Err("All permutation runs failed to converge.".into());
    }

    let failed_run_warning = if failed_runs * 20 > total_perms {
        let pct = (failed_runs as f64 / total_perms as f64) * 100.0;
        Some(format!(
            "{failed_runs} of {total_perms} permutation runs ({pct:.1}%) failed to converge or encountered constant indicators and were skipped."
        ))
    } else {
        None
    };

    // Build Path Coefficients table
    let mut path_coefficients = Vec::with_capacity(path_keys.len());
    for (p_idx, [from, to]) in orig_a.path_order.iter().enumerate() {
        let key = format!("{from}->{to}");
        let from_name = orig_a
            .construct_names
            .get(from)
            .cloned()
            .unwrap_or_else(|| from.clone());
        let to_name = orig_a
            .construct_names
            .get(to)
            .cloned()
            .unwrap_or_else(|| to.clone());
        let a_val = orig_a.paths.get(&key).copied().unwrap_or(0.0);
        let b_val = orig_b.paths.get(&key).copied().unwrap_or(0.0);
        let d0 = a_val - b_val;
        let diffs: Vec<f64> = samples.iter().map(|s| s.diff_paths[p_idx]).collect();
        let (perm_mean, ci_lower, ci_upper, p_value, significant) = compute_param_stats(
            d0,
            &diffs,
            &settings.test_type,
            settings.significance_level,
        );
        path_coefficients.push(PermutationParamRow {
            key,
            parameter: format!("{from_name} → {to_name}"),
            construct: None,
            indicator: None,
            original_a: a_val,
            original_b: b_val,
            original_difference: d0,
            permutation_mean_difference: perm_mean,
            ci_lower,
            ci_upper,
            p_value,
            significant,
        });
    }

    // Build Outer Loadings and Outer Weights tables
    let mut outer_loadings = Vec::new();
    let mut outer_weights = Vec::new();
    for (c_idx, cid) in orig_a.constructs.iter().enumerate() {
        let cname = orig_a
            .construct_names
            .get(cid)
            .cloned()
            .unwrap_or_else(|| cid.clone());
        let inds = orig_a
            .indicators_of
            .get(cid)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        for (i_idx, iid) in inds.iter().enumerate() {
            let iname = orig_a
                .indicator_names
                .get(iid)
                .cloned()
                .unwrap_or_else(|| iid.clone());

            let la = orig_a
                .loadings
                .get(cid)
                .and_then(|v| v.get(i_idx))
                .copied()
                .unwrap_or(0.0);
            let lb = orig_b
                .loadings
                .get(cid)
                .and_then(|v| v.get(i_idx))
                .copied()
                .unwrap_or(0.0);
            let l_d0 = la - lb;
            let l_diffs: Vec<f64> = samples
                .iter()
                .filter_map(|s| {
                    s.diff_loadings
                        .get(c_idx)
                        .and_then(|v| v.get(i_idx))
                        .copied()
                })
                .collect();
            let (l_mean, l_lo, l_hi, l_p, l_sig) = compute_param_stats(
                l_d0,
                &l_diffs,
                &settings.test_type,
                settings.significance_level,
            );
            outer_loadings.push(PermutationParamRow {
                key: format!("{cid}->{iid}"),
                parameter: format!("{iname} ← {cname}"),
                construct: Some(cname.clone()),
                indicator: Some(iname.clone()),
                original_a: la,
                original_b: lb,
                original_difference: l_d0,
                permutation_mean_difference: l_mean,
                ci_lower: l_lo,
                ci_upper: l_hi,
                p_value: l_p,
                significant: l_sig,
            });

            let wa = orig_a
                .weights
                .get(cid)
                .and_then(|v| v.get(i_idx))
                .copied()
                .unwrap_or(0.0);
            let wb = orig_b
                .weights
                .get(cid)
                .and_then(|v| v.get(i_idx))
                .copied()
                .unwrap_or(0.0);
            let w_d0 = wa - wb;
            let w_diffs: Vec<f64> = samples
                .iter()
                .filter_map(|s| {
                    s.diff_weights
                        .get(c_idx)
                        .and_then(|v| v.get(i_idx))
                        .copied()
                })
                .collect();
            let (w_mean, w_lo, w_hi, w_p, w_sig) = compute_param_stats(
                w_d0,
                &w_diffs,
                &settings.test_type,
                settings.significance_level,
            );
            outer_weights.push(PermutationParamRow {
                key: format!("{cid}->{iid}"),
                parameter: format!("{iname} → {cname}"),
                construct: Some(cname.clone()),
                indicator: Some(iname),
                original_a: wa,
                original_b: wb,
                original_difference: w_d0,
                permutation_mean_difference: w_mean,
                ci_lower: w_lo,
                ci_upper: w_hi,
                p_value: w_p,
                significant: w_sig,
            });
        }
    }

    Ok(PermutationCoreResult {
        seed_used,
        n_a,
        n_b,
        pooled_rows: pooled,
        orig_a,
        orig_b,
        orig_pooled,
        permutations_requested: total_perms,
        permutations_completed: completed,
        failed_runs,
        failed_run_warning,
        samples,
        path_coefficients,
        outer_loadings,
        outer_weights,
    })
}

pub fn run_permutation_core(
    columns: &[String],
    rows: &[Vec<Value>],
    model_spec: &Value,
    settings: &PermutationSettings,
    cancel: &AtomicBool,
    progress: &(dyn Fn(usize, usize) + Sync),
) -> Result<PermutationCoreResult, String> {
    let (pooled, n_a, n_b, orig_a, orig_b, orig_pooled) =
        prepare_original_fits(columns, rows, model_spec, settings)?;
    run_permutation_loop(
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
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mga::groups::GroupTerm;
    use serde_json::json;

    fn make_two_group_data(
        n_per_group: usize,
        beta_xm_a: f64,
        beta_xm_b: f64,
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
            "m1".into(),
            "m2".into(),
            "m3".into(),
            "y1".into(),
            "y2".into(),
            "y3".into(),
        ];
        let mut rows = Vec::with_capacity(n_per_group * 2);
        for g in [1, 2] {
            let bx = if g == 1 { beta_xm_a } else { beta_xm_b };
            for _ in 0..n_per_group {
                let x = normal(&mut rng);
                let m = bx * x + (1.0 - bx * bx).max(0.1).sqrt() * normal(&mut rng);
                let y = 0.35 * x + 0.45 * m + 0.6 * normal(&mut rng);
                rows.push(vec![
                    json!(g),
                    json!(x + 0.25 * normal(&mut rng)),
                    json!(0.95 * x + 0.25 * normal(&mut rng)),
                    json!(0.9 * x + 0.25 * normal(&mut rng)),
                    json!(m + 0.25 * normal(&mut rng)),
                    json!(0.95 * m + 0.25 * normal(&mut rng)),
                    json!(0.9 * m + 0.25 * normal(&mut rng)),
                    json!(y + 0.25 * normal(&mut rng)),
                    json!(0.95 * y + 0.25 * normal(&mut rng)),
                    json!(0.9 * y + 0.25 * normal(&mut rng)),
                ]);
            }
        }
        let spec = json!({
            "constructs": [
                {"id": "X", "name": "X", "type": "reflective", "indicators": ["x1", "x2", "x3"]},
                {"id": "M", "name": "M", "type": "reflective", "indicators": ["m1", "m2", "m3"]},
                {"id": "Y", "name": "Y", "type": "reflective", "indicators": ["y1", "y2", "y3"]}
            ],
            "paths": [
                {"from": "X", "to": "M"},
                {"from": "X", "to": "Y"},
                {"from": "M", "to": "Y"}
            ]
        });
        let ga = DataGroup {
            id: "a".into(),
            name: "Group A".into(),
            condition_link_type: "AND".into(),
            terms: vec![GroupTerm {
                column: "GRP".into(),
                operator: "is equal to".into(),
                value1: json!(1),
                value2: None,
            }],
            record_count: n_per_group,
            row_ids: None,
        };
        let gb = DataGroup {
            id: "b".into(),
            name: "Group B".into(),
            condition_link_type: "AND".into(),
            terms: vec![GroupTerm {
                column: "GRP".into(),
                operator: "is equal to".into(),
                value1: json!(2),
                value2: None,
            }],
            record_count: n_per_group,
            row_ids: None,
        };
        (cols, rows, spec, ga, gb)
    }

    #[test]
    fn phase3_permutation_reproducibility_and_parallel_parity() {
        let (cols, rows, spec, ga, gb) = make_two_group_data(60, 0.5, 0.1, 777);
        let s_par = PermutationSettings {
            group_a: ga.clone(),
            group_b: gb.clone(),
            permutations: 60,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(999),
            pls_settings: PlsSettings::default(),
        };
        let mut s_ser = s_par.clone();
        s_ser.parallel_processing = false;

        let cancel = AtomicBool::new(false);
        let r_par = run_permutation_core(&cols, &rows, &spec, &s_par, &cancel, &|_, _| {}).unwrap();
        let r_ser = run_permutation_core(&cols, &rows, &spec, &s_ser, &cancel, &|_, _| {}).unwrap();
        assert_eq!(r_par.permutations_completed, 60);
        for (a, b) in r_par
            .path_coefficients
            .iter()
            .zip(r_ser.path_coefficients.iter())
        {
            assert!((a.p_value - b.p_value).abs() < 1e-12);
            assert!((a.ci_lower - b.ci_lower).abs() < 1e-12);
            assert!((a.ci_upper - b.ci_upper).abs() < 1e-12);
        }

        // Different seed produces slightly different permutation mean/p
        let mut s_other = s_par.clone();
        s_other.seed = Some(1000);
        let r_other =
            run_permutation_core(&cols, &rows, &spec, &s_other, &cancel, &|_, _| {}).unwrap();
        assert!(
            (r_par.path_coefficients[0].permutation_mean_difference
                - r_other.path_coefficients[0].permutation_mean_difference)
                .abs()
                > 1e-9
        );
    }

    #[test]
    fn phase3_permutation_detects_planted_difference_and_cancel_discards() {
        let (cols, rows, spec, ga, gb) = make_two_group_data(150, 0.5, 0.1, 2025);
        let settings = PermutationSettings {
            group_a: ga,
            group_b: gb,
            permutations: 200,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(42),
            pls_settings: PlsSettings::default(),
        };
        let cancel = AtomicBool::new(false);
        let res = run_permutation_core(&cols, &rows, &spec, &settings, &cancel, &|_, _| {}).unwrap();
        let xm = res
            .path_coefficients
            .iter()
            .find(|r| r.key == "X->M")
            .unwrap();
        let xy = res
            .path_coefficients
            .iter()
            .find(|r| r.key == "X->Y")
            .unwrap();
        assert!(xm.significant, "X->M should be significant (p={})", xm.p_value);
        assert!(!xy.significant, "X->Y should not be significant (p={})", xy.p_value);

        // Cancel stops execution and returns error
        let cancel_flag = AtomicBool::new(false);
        let cancelled = run_permutation_core(&cols, &rows, &spec, &settings, &cancel_flag, &|_, _| {
            cancel_flag.store(true, Ordering::Relaxed);
        });
        assert!(cancelled.is_err());
    }
}

