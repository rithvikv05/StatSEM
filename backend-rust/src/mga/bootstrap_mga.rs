//! Phase 5 — Bootstrap-based Multigroup Analysis (MGA):
//! Henseler's PLS-MGA, Parametric test (Keil et al. 2000), and Welch-Satterthwaite test.
use crate::mga::adapter::{
    align_sample_signs, align_signs, run_bootstrap_with_control, run_pls, BootstrapStdErrors,
    PlsSettings,
};
use crate::mga::groups::{validate_pair_for_comparison, DataGroup};
use crate::mga::math::{
    mean, one_tailed_p_t, random_seed, sorted_lower_count, std_dev, two_tailed_p_t,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MgaSettings {
    pub group_a: DataGroup,
    pub group_b: DataGroup,
    #[serde(default = "default_subsamples")]
    pub subsamples: usize,
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

fn default_subsamples() -> usize {
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

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MgaParamRow {
    pub key: String,
    pub parameter: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub construct: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indicator: Option<String>,
    pub original_a: f64,
    pub original_b: f64,
    pub difference: f64,
    pub abs_difference: f64,
    pub henseler_p_greater: f64,
    pub henseler_result: String, // "A > B" | "A < B" | "n.s."
    #[serde(default, rename = "henselerP1Tailed", alias = "henselerP1tailed")]
    pub henseler_p_1tailed: f64,
    #[serde(default, rename = "henselerP2Tailed", alias = "henselerP2tailed")]
    pub henseler_p_2tailed: f64,
    #[serde(default)]
    pub henseler_significant: bool,
    pub parametric_t: f64,
    pub parametric_df: f64,
    pub parametric_p: f64,
    pub parametric_significant: bool,
    pub welch_t: f64,
    pub welch_df: f64,
    pub welch_p: f64,
    pub welch_significant: bool,
    #[serde(default)]
    pub ci_lower_a: f64,
    #[serde(default)]
    pub ci_upper_a: f64,
    #[serde(default)]
    pub ci_lower_b: f64,
    #[serde(default)]
    pub ci_upper_b: f64,
    pub mean_a: f64,
    pub se_a: f64,
    pub mean_b: f64,
    pub se_b: f64,
    #[serde(default)]
    pub t_value_a: f64,
    #[serde(default)]
    pub p_value_a: f64,
    #[serde(default)]
    pub t_value_b: f64,
    #[serde(default)]
    pub p_value_b: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MgaReport {
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
    pub subsamples_requested: usize,
    pub subsamples_completed_a: usize,
    pub subsamples_completed_b: usize,
    pub test_type: String,
    pub significance_level: f64,
    #[serde(default = "default_true")]
    pub parallel_processing: bool,
    pub seed: u64,
    pub pls_settings: PlsSettings,
    pub path_coefficients: Vec<MgaParamRow>,
    #[serde(default)]
    pub total_indirect_effects: Vec<MgaParamRow>,
    #[serde(default)]
    pub specific_indirect_effects: Vec<MgaParamRow>,
    #[serde(default)]
    pub total_effects: Vec<MgaParamRow>,
    pub outer_loadings: Vec<MgaParamRow>,
    pub outer_weights: Vec<MgaParamRow>,
}

/// Henseler's PLS-MGA using O((J + I) log I) binary search over sorted Group B samples.
pub fn henseler_pls_mga(
    samples_a: &[f64],
    samples_b: &[f64],
    test_type: &str,
    alpha: f64,
) -> (f64, String) {
    if samples_a.is_empty() || samples_b.is_empty() {
        return (0.5, "n.s.".into());
    }
    let mut sorted_b = samples_b.to_vec();
    sorted_b.sort_by(f64::total_cmp);

    let pairs_a_greater: u128 = samples_a
        .iter()
        .map(|&a| sorted_lower_count(&sorted_b, a) as u128)
        .sum();
    let total_pairs = (samples_a.len() as u128) * (samples_b.len() as u128);
    let p_greater = pairs_a_greater as f64 / total_pairs as f64;

    let one_tailed = test_type.trim().eq_ignore_ascii_case("one-tailed");
    let thresh = if one_tailed { alpha } else { alpha / 2.0 };
    let result = if p_greater > 1.0 - thresh {
        "A > B"
    } else if p_greater < thresh {
        "A < B"
    } else {
        "n.s."
    };
    (p_greater, result.into())
}

/// SmartPLS 4 centered Henseler's PLS-MGA (Henseler et al. 2009 Eq. 11).
/// Returns `(p_greater, p_1tailed_a_le_b, p_2tailed, result_label, significant)`.
pub fn henseler_pls_mga_smartpls(
    theta_a: f64,
    samples_a: &[f64],
    theta_b: f64,
    samples_b: &[f64],
    test_type: &str,
    alpha: f64,
) -> (f64, f64, f64, String, bool) {
    if samples_a.is_empty() || samples_b.is_empty() {
        return (0.5, 0.5, 1.0, "n.s.".into(), false);
    }
    let sda = if samples_a.len() > 1 {
        std_dev(samples_a, 1)
    } else {
        0.0
    };
    let sdb = if samples_b.len() > 1 {
        std_dev(samples_b, 1)
    } else {
        0.0
    };
    if sda <= 1e-12 && sdb <= 1e-12 && (theta_a - theta_b).abs() <= 1e-12 {
        return (0.5, 0.5, 1.0, "n.s.".into(), false);
    }

    let ma = mean(samples_a);
    let mb = mean(samples_b);
    let centered_a: Vec<f64> = samples_a.iter().map(|&v| v - ma + theta_a).collect();
    let mut sorted_centered_b: Vec<f64> = samples_b.iter().map(|&v| v - mb + theta_b).collect();
    sorted_centered_b.sort_by(f64::total_cmp);

    let pairs_a_greater: u128 = centered_a
        .iter()
        .map(|&a| sorted_lower_count(&sorted_centered_b, a) as u128)
        .sum();
    let total_pairs = (centered_a.len() as u128) * (sorted_centered_b.len() as u128);
    let p_greater = pairs_a_greater as f64 / total_pairs as f64;
    let p_1tailed = (1.0 - p_greater).clamp(0.0, 1.0);
    let p_2tailed = (2.0 * p_1tailed.min(1.0 - p_1tailed)).clamp(0.0, 1.0);

    let one_tailed = test_type.trim().eq_ignore_ascii_case("one-tailed");
    let thresh = if one_tailed { alpha } else { alpha / 2.0 };
    let result = if p_greater > 1.0 - thresh {
        "A > B"
    } else if p_greater < thresh {
        "A < B"
    } else {
        "n.s."
    };
    let sig = if one_tailed {
        p_1tailed < alpha
    } else {
        p_2tailed < alpha
    };
    (p_greater, p_1tailed, p_2tailed, result.into(), sig)
}

/// Parametric test (Keil et al. 2000) assuming equal variances.
pub fn parametric_test(
    theta_a: f64,
    se_a: f64,
    n_a: usize,
    theta_b: f64,
    se_b: f64,
    n_b: usize,
    test_type: &str,
) -> (f64, f64, f64) {
    let n1 = n_a as f64;
    let n2 = n_b as f64;
    let df = (n1 + n2 - 2.0).max(1.0);
    let pooled_se = ((((n1 - 1.0).powi(2)) / df) * se_a.powi(2)
        + (((n2 - 1.0).powi(2)) / df) * se_b.powi(2))
    .sqrt();
    let denom = pooled_se * (1.0 / n1 + 1.0 / n2).sqrt();
    let t = if denom.is_finite() && denom > 1e-15 {
        (theta_a - theta_b) / denom
    } else {
        0.0
    };
    let p = if test_type.trim().eq_ignore_ascii_case("one-tailed") {
        one_tailed_p_t(t, df)
    } else {
        two_tailed_p_t(t, df)
    };
    (t, df, p)
}

/// Welch-Satterthwaite test allowing unequal variances (matching SmartPLS 4 / Sarstedt et al. 2011).
pub fn welch_satterthwaite_test(
    theta_a: f64,
    se_a: f64,
    n_a: usize,
    theta_b: f64,
    se_b: f64,
    n_b: usize,
    test_type: &str,
) -> (f64, f64, f64) {
    let n1 = n_a as f64;
    let n2 = n_b as f64;
    let v1 = ((n1 - 1.0) / n1) * se_a.powi(2);
    let v2 = ((n2 - 1.0) / n2) * se_b.powi(2);
    let sum_v = v1 + v2;
    let t = if sum_v.is_finite() && sum_v > 1e-15 {
        (theta_a - theta_b) / sum_v.sqrt()
    } else {
        0.0
    };
    let denom = ((n1 - 1.0) / n1.powi(2)) * se_a.powi(2)
        + ((n2 - 1.0) / n2.powi(2)) * se_b.powi(2);
    let df = if denom.is_finite() && denom > 1e-24 {
        ((sum_v / denom) - 2.0).round().max(1.0)
    } else {
        (n1 + n2 - 2.0).max(1.0)
    };
    let p = if test_type.trim().eq_ignore_ascii_case("one-tailed") {
        one_tailed_p_t(t, df)
    } else {
        two_tailed_p_t(t, df)
    };
    (t, df, p)
}

fn compute_bc_ci(theta: f64, samples: &[f64], alpha: f64, one_tailed: bool) -> (f64, f64) {
    let finite: Vec<f64> = samples.iter().copied().filter(|v| v.is_finite()).collect();
    if finite.is_empty() || !theta.is_finite() {
        return (theta, theta);
    }
    let tails = if one_tailed { "one" } else { "two" };
    match crate::inference::intervals(theta, &finite, None, alpha, tails) {
        Ok(val) => {
            let low = val["bias_corrected"][0].as_f64().unwrap_or(theta);
            let high = val["bias_corrected"][1].as_f64().unwrap_or(theta);
            (low, high)
        }
        Err(_) => (theta, theta),
    }
}

fn single_group_boot_stats(
    theta: f64,
    se: f64,
    n_samples: usize,
    one_tailed: bool,
) -> (f64, f64) {
    let t_val = if se.is_finite() && se > 1e-12 {
        (theta / se).abs()
    } else {
        0.0
    };
    let df = (n_samples.max(1)) as f64;
    let p_val = if se.is_finite() && se > 1e-12 {
        if one_tailed {
            one_tailed_p_t(t_val, df)
        } else {
            two_tailed_p_t(t_val, df)
        }
    } else {
        1.0
    };
    (t_val, p_val)
}

#[allow(clippy::too_many_arguments)]
fn build_row(
    key: String,
    parameter: String,
    construct: Option<String>,
    indicator: Option<String>,
    theta_a: f64,
    se_a: f64,
    samples_a: &[f64],
    n_a: usize,
    theta_b: f64,
    se_b: f64,
    samples_b: &[f64],
    n_b: usize,
    test_type: &str,
    alpha: f64,
) -> MgaParamRow {
    let diff = theta_a - theta_b;
    let one_tailed = test_type.trim().eq_ignore_ascii_case("one-tailed");
    let (
        henseler_p_greater,
        henseler_p_1tailed,
        henseler_p_2tailed,
        henseler_result,
        henseler_significant,
    ) = henseler_pls_mga_smartpls(theta_a, samples_a, theta_b, samples_b, test_type, alpha);
    let (parametric_t, parametric_df, parametric_p) =
        parametric_test(theta_a, se_a, n_a, theta_b, se_b, n_b, test_type);
    let (welch_t, welch_df, welch_p) =
        welch_satterthwaite_test(theta_a, se_a, n_a, theta_b, se_b, n_b, test_type);
    let (ci_lower_a, ci_upper_a) = compute_bc_ci(theta_a, samples_a, alpha, one_tailed);
    let (ci_lower_b, ci_upper_b) = compute_bc_ci(theta_b, samples_b, alpha, one_tailed);
    let (t_value_a, p_value_a) = single_group_boot_stats(theta_a, se_a, samples_a.len(), one_tailed);
    let (t_value_b, p_value_b) = single_group_boot_stats(theta_b, se_b, samples_b.len(), one_tailed);

    MgaParamRow {
        key,
        parameter,
        construct,
        indicator,
        original_a: theta_a,
        original_b: theta_b,
        difference: diff,
        abs_difference: diff.abs(),
        henseler_p_greater,
        henseler_result,
        henseler_p_1tailed,
        henseler_p_2tailed,
        henseler_significant,
        parametric_t,
        parametric_df,
        parametric_p,
        parametric_significant: parametric_p < alpha,
        welch_t,
        welch_df,
        welch_p,
        welch_significant: welch_p < alpha,
        ci_lower_a,
        ci_upper_a,
        ci_lower_b,
        ci_upper_b,
        mean_a: if samples_a.is_empty() {
            theta_a
        } else {
            mean(samples_a)
        },
        se_a,
        mean_b: if samples_b.is_empty() {
            theta_b
        } else {
            mean(samples_b)
        },
        se_b,
        t_value_a,
        p_value_a,
        t_value_b,
        p_value_b,
    }
}

pub fn validate_mga_settings(settings: &MgaSettings) -> Result<(), String> {
    settings.pls_settings.validate()?;
    if settings.subsamples == 0 {
        return Err("Number of bootstrap subsamples must be greater than 0.".into());
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

/// Recompute standard errors (sample std-dev with ddof=1) from a set of
/// sign-corrected bootstrap samples.  This must be called after cross-group
/// sign alignment so that the SE reflects the aligned distribution.
fn recompute_std_errors(
    original: &crate::mga::adapter::PlsResult,
    samples: &[crate::mga::adapter::BootstrapSample],
) -> BootstrapStdErrors {
    let mut se_paths = BTreeMap::new();
    for [from, to] in &original.path_order {
        let key = format!("{from}->{to}");
        let vals: Vec<f64> = samples
            .iter()
            .filter_map(|s| s.paths.get(&key).copied())
            .collect();
        se_paths.insert(key, if vals.len() > 1 { std_dev(&vals, 1) } else { 0.0 });
    }

    let mut se_loadings = BTreeMap::new();
    let mut se_weights = BTreeMap::new();
    for cid in &original.constructs {
        let k = original.indicators_of.get(cid).map_or(0, Vec::len);
        let mut l_se = Vec::with_capacity(k);
        let mut w_se = Vec::with_capacity(k);
        for idx in 0..k {
            let l_vals: Vec<f64> = samples
                .iter()
                .filter_map(|s| s.loadings.get(cid).and_then(|v| v.get(idx)).copied())
                .collect();
            let w_vals: Vec<f64> = samples
                .iter()
                .filter_map(|s| s.weights.get(cid).and_then(|v| v.get(idx)).copied())
                .collect();
            l_se.push(if l_vals.len() > 1 { std_dev(&l_vals, 1) } else { 0.0 });
            w_se.push(if w_vals.len() > 1 { std_dev(&w_vals, 1) } else { 0.0 });
        }
        se_loadings.insert(cid.clone(), l_se);
        se_weights.insert(cid.clone(), w_se);
    }

    BootstrapStdErrors {
        paths: se_paths,
        loadings: se_loadings,
        weights: se_weights,
    }
}

/// Run full bootstrap-based MGA (Henseler, Parametric, Welch-Satterthwaite) across Group A and Group B.
#[allow(clippy::too_many_arguments)]
pub fn run_bootstrap_mga(
    columns: &[String],
    rows: &[Vec<Value>],
    model_spec: &Value,
    settings: &MgaSettings,
    model_id: &str,
    dataset_id: Option<&str>,
    cancel: &AtomicBool,
    progress: &(dyn Fn(usize, usize, &str) + Sync),
) -> Result<MgaReport, String> {
    validate_mga_settings(settings)?;
    let casewise = settings.pls_settings.missing_treatment_key() == "listwise";
    let (rows_a, rows_b) = validate_pair_for_comparison(
        columns,
        rows,
        model_spec,
        &settings.group_a,
        &settings.group_b,
        casewise,
    )?;

    let seed_used = settings.seed.unwrap_or_else(random_seed);
    let total_steps = settings.subsamples * 2;

    let res_a = run_bootstrap_with_control(
        columns,
        &rows_a,
        model_spec,
        &settings.pls_settings,
        settings.subsamples,
        seed_used,
        settings.parallel_processing,
        cancel,
        &|done, _| progress(done, total_steps, "Group A"),
    )?;

    let res_b = run_bootstrap_with_control(
        columns,
        &rows_b,
        model_spec,
        &settings.pls_settings,
        settings.subsamples,
        seed_used.wrapping_add(1),
        settings.parallel_processing,
        cancel,
        &|done, _| progress(settings.subsamples + done, total_steps, "Group B"),
    )?;

    let n_a = res_a.n_used;
    let n_b = res_b.n_used;

    // ── Cross-group sign alignment ──────────────────────────────────────────
    // PLS has sign indeterminacy: when run independently on two subgroups the
    // composite scores (and thus path coefficients / loadings / weights) can
    // land in opposite sign conventions.  We fix this by running PLS on the
    // FULL POOLED sample and using it as the common reference, exactly as
    // SmartPLS 4 does.
    let mut pooled_rows = Vec::with_capacity(rows_a.len() + rows_b.len());
    pooled_rows.extend(rows_a.iter().cloned());
    pooled_rows.extend(rows_b.iter().cloned());
    let orig_pooled = run_pls(columns, &pooled_rows, model_spec, &settings.pls_settings)?;
    if !orig_pooled.converged {
        return Err(
            "Pooled PLS failed to converge. Cannot compute cross-group sign alignment.".into(),
        );
    }

    // Align both groups' originals to the pooled reference.
    let orig_a = align_signs(res_a.original, &orig_pooled);
    let orig_b = align_signs(res_b.original, &orig_pooled);

    // Align every bootstrap sample in both groups to the pooled reference.
    let samples_a: Vec<_> = res_a
        .samples
        .into_iter()
        .map(|s| align_sample_signs(s, &orig_pooled))
        .collect();
    let samples_b: Vec<_> = res_b
        .samples
        .into_iter()
        .map(|s| align_sample_signs(s, &orig_pooled))
        .collect();

    // Recompute std-errors from the sign-corrected sample distributions.
    let std_error_a = recompute_std_errors(&orig_a, &samples_a);
    let std_error_b = recompute_std_errors(&orig_b, &samples_b);
    // ───────────────────────────────────────────────────────────────────────

    // ── Structural effects decomposition helpers ────────────────────────────
    let constructs = &orig_pooled.constructs;
    let nc = constructs.len();
    let id_to_idx: BTreeMap<&str, usize> = constructs
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();
    let mut adj = vec![vec![false; nc]; nc];
    for [from, to] in &orig_pooled.path_order {
        if let (Some(&i), Some(&j)) = (id_to_idx.get(from.as_str()), id_to_idx.get(to.as_str())) {
            adj[i][j] = true;
        }
    }

    fn dfs_chains(
        adj: &[Vec<bool>],
        cur: usize,
        target: usize,
        visited: &mut Vec<usize>,
        out: &mut Vec<Vec<usize>>,
    ) {
        if out.len() >= 1000 || visited.len() > 8 {
            return;
        }
        for next in 0..adj.len() {
            if !adj[cur][next] {
                continue;
            }
            if next == target {
                if visited.len() >= 2 {
                    let mut path = visited.clone();
                    path.push(target);
                    out.push(path);
                }
            } else if !visited.contains(&next) {
                visited.push(next);
                dfs_chains(adj, next, target, visited, out);
                visited.pop();
            }
        }
    }

    let mut specific_chains: Vec<Vec<usize>> = Vec::new();
    for i in 0..nc {
        for j in 0..nc {
            if i != j {
                dfs_chains(&adj, i, j, &mut vec![i], &mut specific_chains);
            }
        }
    }
    let mut indirect_pairs: Vec<(usize, usize)> = Vec::new();
    let mut total_pairs: Vec<(usize, usize)> = Vec::new();
    for i in 0..nc {
        for j in 0..nc {
            if i == j {
                continue;
            }
            let has_indirect = specific_chains
                .iter()
                .any(|c| c.first() == Some(&i) && c.last() == Some(&j));
            if has_indirect {
                indirect_pairs.push((i, j));
            }
            if adj[i][j] || has_indirect {
                total_pairs.push((i, j));
            }
        }
    }

    let compute_effects = |paths_map: &BTreeMap<String, f64>| -> (Vec<Vec<f64>>, Vec<Vec<f64>>, Vec<f64>) {
        let mut direct = vec![vec![0.0; nc]; nc];
        for i in 0..nc {
            for j in 0..nc {
                if adj[i][j] {
                    let key = format!("{}->{}", constructs[i], constructs[j]);
                    direct[i][j] = paths_map.get(&key).copied().unwrap_or(0.0);
                }
            }
        }
        let system: Vec<Vec<f64>> = (0..nc)
            .map(|i| {
                (0..nc)
                    .map(|j| if i == j { 1.0 - direct[i][j] } else { -direct[i][j] })
                    .collect()
            })
            .collect();
        let total = crate::linalg::inverse(&system)
            .map(|mut inv| {
                for (i, row) in inv.iter_mut().enumerate() {
                    row[i] -= 1.0;
                }
                inv
            })
            .unwrap_or_else(|_| direct.clone());
        let indirect: Vec<Vec<f64>> = (0..nc)
            .map(|i| (0..nc).map(|j| total[i][j] - direct[i][j]).collect())
            .collect();
        let specific: Vec<f64> = specific_chains
            .iter()
            .map(|chain| {
                chain
                    .windows(2)
                    .fold(1.0, |acc, w| acc * direct[w[0]][w[1]])
            })
            .collect();
        (indirect, total, specific)
    };

    let (eff_ind_a, eff_tot_a, eff_spec_a) = compute_effects(&orig_a.paths);
    let (eff_ind_b, eff_tot_b, eff_spec_b) = compute_effects(&orig_b.paths);
    let sample_eff_a: Vec<_> = samples_a.iter().map(|s| compute_effects(&s.paths)).collect();
    let sample_eff_b: Vec<_> = samples_b.iter().map(|s| compute_effects(&s.paths)).collect();

    let cname_of = |cid: &str| -> String {
        orig_a
            .construct_names
            .get(cid)
            .cloned()
            .unwrap_or_else(|| cid.to_string())
    };
    let sort_rows = |list: &mut Vec<MgaParamRow>| {
        list.sort_by(|a, b| {
            a.parameter
                .to_lowercase()
                .cmp(&b.parameter.to_lowercase())
                .then_with(|| a.key.cmp(&b.key))
        });
    };

    // 1. Path coefficients
    let mut path_coefficients = Vec::new();
    for [from, to] in &orig_a.path_order {
        let key = format!("{from}->{to}");
        let from_name = cname_of(from);
        let to_name = cname_of(to);

        let theta_a = orig_a.paths.get(&key).copied().unwrap_or(0.0);
        let theta_b = orig_b.paths.get(&key).copied().unwrap_or(0.0);
        let se_a = std_error_a.paths.get(&key).copied().unwrap_or(0.0);
        let se_b = std_error_b.paths.get(&key).copied().unwrap_or(0.0);
        let samp_a: Vec<f64> = samples_a
            .iter()
            .filter_map(|s| s.paths.get(&key).copied())
            .collect();
        let samp_b: Vec<f64> = samples_b
            .iter()
            .filter_map(|s| s.paths.get(&key).copied())
            .collect();

        path_coefficients.push(build_row(
            key,
            format!("{from_name} → {to_name}"),
            None,
            None,
            theta_a,
            se_a,
            &samp_a,
            n_a,
            theta_b,
            se_b,
            &samp_b,
            n_b,
            &settings.test_type,
            settings.significance_level,
        ));
    }
    sort_rows(&mut path_coefficients);

    // 2. Total indirect effects
    let mut total_indirect_effects = Vec::new();
    for &(i, j) in &indirect_pairs {
        let from = &constructs[i];
        let to = &constructs[j];
        let key = format!("{from}->{to}");
        let label = format!("{} → {}", cname_of(from), cname_of(to));
        let theta_a = eff_ind_a[i][j];
        let theta_b = eff_ind_b[i][j];
        let samp_a: Vec<f64> = sample_eff_a.iter().map(|e| e.0[i][j]).collect();
        let samp_b: Vec<f64> = sample_eff_b.iter().map(|e| e.0[i][j]).collect();
        let se_a = if samp_a.len() > 1 { std_dev(&samp_a, 1) } else { 0.0 };
        let se_b = if samp_b.len() > 1 { std_dev(&samp_b, 1) } else { 0.0 };
        total_indirect_effects.push(build_row(
            key,
            label,
            None,
            None,
            theta_a,
            se_a,
            &samp_a,
            n_a,
            theta_b,
            se_b,
            &samp_b,
            n_b,
            &settings.test_type,
            settings.significance_level,
        ));
    }
    sort_rows(&mut total_indirect_effects);

    // 3. Specific indirect effects
    let mut specific_indirect_effects = Vec::new();
    for (c_idx, chain) in specific_chains.iter().enumerate() {
        let key = chain
            .iter()
            .map(|&idx| constructs[idx].clone())
            .collect::<Vec<_>>()
            .join("->");
        let label = chain
            .iter()
            .map(|&idx| cname_of(&constructs[idx]))
            .collect::<Vec<_>>()
            .join(" → ");
        let theta_a = eff_spec_a[c_idx];
        let theta_b = eff_spec_b[c_idx];
        let samp_a: Vec<f64> = sample_eff_a.iter().map(|e| e.2[c_idx]).collect();
        let samp_b: Vec<f64> = sample_eff_b.iter().map(|e| e.2[c_idx]).collect();
        let se_a = if samp_a.len() > 1 { std_dev(&samp_a, 1) } else { 0.0 };
        let se_b = if samp_b.len() > 1 { std_dev(&samp_b, 1) } else { 0.0 };
        specific_indirect_effects.push(build_row(
            key,
            label,
            None,
            None,
            theta_a,
            se_a,
            &samp_a,
            n_a,
            theta_b,
            se_b,
            &samp_b,
            n_b,
            &settings.test_type,
            settings.significance_level,
        ));
    }
    sort_rows(&mut specific_indirect_effects);

    // 4. Total effects
    let mut total_effects = Vec::new();
    for &(i, j) in &total_pairs {
        let from = &constructs[i];
        let to = &constructs[j];
        let key = format!("{from}->{to}");
        let label = format!("{} → {}", cname_of(from), cname_of(to));
        let theta_a = eff_tot_a[i][j];
        let theta_b = eff_tot_b[i][j];
        let samp_a: Vec<f64> = sample_eff_a.iter().map(|e| e.1[i][j]).collect();
        let samp_b: Vec<f64> = sample_eff_b.iter().map(|e| e.1[i][j]).collect();
        let se_a = if samp_a.len() > 1 { std_dev(&samp_a, 1) } else { 0.0 };
        let se_b = if samp_b.len() > 1 { std_dev(&samp_b, 1) } else { 0.0 };
        total_effects.push(build_row(
            key,
            label,
            None,
            None,
            theta_a,
            se_a,
            &samp_a,
            n_a,
            theta_b,
            se_b,
            &samp_b,
            n_b,
            &settings.test_type,
            settings.significance_level,
        ));
    }
    sort_rows(&mut total_effects);

    // 5. Outer loadings and 6. Outer weights (using SmartPLS arrow conventions)
    let mut outer_loadings = Vec::new();
    let mut outer_weights = Vec::new();
    for cid in &orig_a.constructs {
        let cname = orig_a
            .construct_names
            .get(cid)
            .cloned()
            .unwrap_or_else(|| cid.clone());
        let is_interaction = orig_a.interaction_constructs.contains(cid);
        let is_formative = orig_a
            .construct_types
            .get(cid)
            .is_some_and(|t| t == "formative");
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
            let label = if is_interaction {
                format!("{cname} → {cname}")
            } else if is_formative {
                format!("{iname} → {cname}")
            } else {
                format!("{iname} ← {cname}")
            };

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
            let l_se_a = std_error_a
                .loadings
                .get(cid)
                .and_then(|v| v.get(i_idx))
                .copied()
                .unwrap_or(0.0);
            let l_se_b = std_error_b
                .loadings
                .get(cid)
                .and_then(|v| v.get(i_idx))
                .copied()
                .unwrap_or(0.0);
            let l_sa: Vec<f64> = samples_a
                .iter()
                .filter_map(|s| s.loadings.get(cid).and_then(|v| v.get(i_idx)).copied())
                .collect();
            let l_sb: Vec<f64> = samples_b
                .iter()
                .filter_map(|s| s.loadings.get(cid).and_then(|v| v.get(i_idx)).copied())
                .collect();

            outer_loadings.push(build_row(
                format!("{cid}->{iid}"),
                label.clone(),
                Some(cname.clone()),
                Some(iname.clone()),
                la,
                l_se_a,
                &l_sa,
                n_a,
                lb,
                l_se_b,
                &l_sb,
                n_b,
                &settings.test_type,
                settings.significance_level,
            ));

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
            let w_se_a = std_error_a
                .weights
                .get(cid)
                .and_then(|v| v.get(i_idx))
                .copied()
                .unwrap_or(0.0);
            let w_se_b = std_error_b
                .weights
                .get(cid)
                .and_then(|v| v.get(i_idx))
                .copied()
                .unwrap_or(0.0);
            let w_sa: Vec<f64> = samples_a
                .iter()
                .filter_map(|s| s.weights.get(cid).and_then(|v| v.get(i_idx)).copied())
                .collect();
            let w_sb: Vec<f64> = samples_b
                .iter()
                .filter_map(|s| s.weights.get(cid).and_then(|v| v.get(i_idx)).copied())
                .collect();

            outer_weights.push(build_row(
                format!("{cid}->{iid}"),
                label,
                Some(cname.clone()),
                Some(iname),
                wa,
                w_se_a,
                &w_sa,
                n_a,
                wb,
                w_se_b,
                &w_sb,
                n_b,
                &settings.test_type,
                settings.significance_level,
            ));
        }
    }
    sort_rows(&mut outer_loadings);
    sort_rows(&mut outer_weights);

    Ok(MgaReport {
        id: uuid::Uuid::new_v4().to_string(),
        report_type: "mga".into(),
        title: format!(
            "MGA: {} vs {}",
            settings.group_a.name, settings.group_b.name
        ),
        created_at: chrono::Utc::now().to_rfc3339(),
        model_id: model_id.to_string(),
        dataset_id: dataset_id.map(str::to_owned),
        group_a_name: settings.group_a.name.clone(),
        group_b_name: settings.group_b.name.clone(),
        n_a,
        n_b,
        subsamples_requested: settings.subsamples,
        subsamples_completed_a: samples_a.len(),
        subsamples_completed_b: samples_b.len(),
        test_type: settings.test_type.clone(),
        significance_level: settings.significance_level,
        parallel_processing: settings.parallel_processing,
        seed: seed_used,
        pls_settings: settings.pls_settings.clone(),
        path_coefficients,
        total_indirect_effects,
        specific_indirect_effects,
        total_effects,
        outer_loadings,
        outer_weights,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mga::groups::GroupTerm;
    use crate::mga::math::SeededRng;
    use serde_json::json;

    #[test]
    fn phase5_matthews_table_10_8_parametric_and_welch() {
        // Matthews (2017), Table 10.8: Autonomy -> Skill discrepancy
        // Males: theta=0.471, se=0.072, n=134
        // Females: theta=0.171, se=0.14, n=101
        let (pt, pdf, pp) = parametric_test(0.471, 0.072, 134, 0.171, 0.14, 101, "two-tailed");
        assert!((pt - 2.05).abs() < 0.01, "parametric t expected ~2.05, got {pt}");
        assert!((pdf - 233.0).abs() < 0.01, "parametric df expected 233, got {pdf}");
        assert!((pp - 0.04).abs() < 0.01, "parametric p expected ~0.04, got {pp}");

        let (wt, wdf, wp) =
            welch_satterthwaite_test(0.471, 0.072, 134, 0.171, 0.14, 101, "two-tailed");
        assert!((wt - 1.92).abs() < 0.01, "welch t expected ~1.92, got {wt}");
        assert!((wdf - 104.0).abs() < 0.5, "SmartPLS 4 welch df expected 104, got {wdf}");
        assert!((wp - 0.0575).abs() < 0.01, "welch p expected ~0.0575, got {wp}");
    }

    #[test]
    fn phase5_smartpls4_exact_parametric_welch_bootstrap_and_henseler_formulas() {
        // Verified directly against SmartPLS 4 v4.1.1.8 screenshots on complete.csv
        // CUSA -> CUSL: Prepaid n=125 (orig=0.5845994, se=0.0749332) vs Contract n=219 (orig=0.4001578, se=0.0474005), 100 subsamples
        let (pt, pdf, pp) =
            parametric_test(0.5845994, 0.0749332, 125, 0.4001578, 0.0474005, 219, "two-tailed");
        assert!((pt.abs() - 2.1895941).abs() < 1e-5, "parametric t mismatch: {pt}");
        assert!((pdf - 342.0).abs() < 1e-9);
        assert!((pp - 0.0292289).abs() < 1e-6, "parametric p mismatch: {pp}");

        let (wt, wdf, wp) = welch_satterthwaite_test(
            0.5845994, 0.0749332, 125, 0.4001578, 0.0474005, 219, "two-tailed",
        );
        assert!((wt.abs() - 2.0875047).abs() < 1e-5, "welch t mismatch: {wt}");
        assert!((wdf - 141.0).abs() < 1e-9, "welch df mismatch: {wdf}");
        assert!((wp - 0.0386419).abs() < 1e-6, "welch p mismatch: {wp}");

        // Check all remaining 7 rows' SmartPLS 4 Welch p-values to 6+ decimals (using SmartPLS Image 7 Difference column)
        let welch_cases = [
            (0.0747812, 0.1149283, 0.0778971, 0.5404881, 143.0, 0.5897013),
            (-0.0746167, 0.0964852, 0.0582279, 0.6644765, 139.0, 0.5074862),
            (-0.0383489, 0.0700972, 0.0463530, 0.4579286, 142.0, 0.6477037),
            (-0.1110558, 0.0727835, 0.0505087, 1.2579005, 143.0, 0.2104779),
            (-0.0778647, 0.1070263, 0.0910107, 0.5560617, 151.0, 0.5789917),
            (0.0102149, 0.0359471, 0.0353704, 0.2031946, 157.0, 0.8392460),
            (0.0846551, 0.0938661, 0.0735019, 0.7124642, 147.0, 0.4773067),
        ];
        for (diff, se1, se2, exp_t, exp_df, exp_p) in welch_cases {
            let (t, df, p) = welch_satterthwaite_test(diff, se1, 125, 0.0, se2, 219, "two-tailed");
            assert!((t.abs() - exp_t).abs() < 1e-5, "welch t={t} expected {exp_t}");
            assert!((df - exp_df).abs() < 1e-9, "welch df={df} expected {exp_df}");
            assert!((p - exp_p).abs() < 1e-6, "welch p={p} expected {exp_p}");
        }

        // Bootstrapping results single-group t & p (df = n_subsamples = 100)
        let (tb, pb) = single_group_boot_stats(-0.0507674, 0.0353704, 100, false);
        assert!((tb - 1.4353089).abs() < 1e-5, "boot t mismatch: {tb}");
        assert!((pb - 0.1543195).abs() < 1e-6, "boot p mismatch: {pb}");
        let (ta, pa) = single_group_boot_stats(0.2149456, 0.1149283, 100, false);
        assert!((ta - 1.8702585).abs() < 1e-5, "boot t mismatch: {ta}");
        assert!((pa - 0.0643727).abs() < 1e-6, "boot p mismatch: {pa}");
    }

    #[test]
    fn phase5_henseler_exact_and_1000_random_trials_match_brute_force() {
        let (p, _) = henseler_pls_mga(&[1.0, 2.0, 3.0], &[2.0, 3.0, 4.0], "two-tailed", 0.05);
        assert!((p - 1.0 / 9.0).abs() < 1e-12);

        let mut rng = SeededRng::from_seed(55555);
        for _ in 0..1000 {
            let len_a = 1 + rng.next_usize(25);
            let len_b = 1 + rng.next_usize(25);
            let sa: Vec<f64> = (0..len_a)
                .map(|_| (rng.next_usize(15) as f64) / 5.0)
                .collect();
            let sb: Vec<f64> = (0..len_b)
                .map(|_| (rng.next_usize(15) as f64) / 5.0)
                .collect();
            let (fast_p, _) = henseler_pls_mga(&sa, &sb, "two-tailed", 0.05);

            let mut brute = 0usize;
            for &a in &sa {
                for &b in &sb {
                    if b < a {
                        brute += 1;
                    }
                }
            }
            let brute_p = brute as f64 / (len_a * len_b) as f64;
            assert!((fast_p - brute_p).abs() < 1e-12);
        }
    }

    #[test]
    fn phase5_bootstrap_mga_planted_difference_is_significant() {
        let mut rng = SeededRng::from_seed(8888);
        let normal = |r: &mut SeededRng| -> f64 {
            let u1 = ((r.next_u64() >> 11) as f64 + 1.0) / (9007199254740992.0 + 1.0);
            let u2 = (r.next_u64() >> 11) as f64 / 9007199254740992.0;
            (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
        };
        let cols = vec![
            "GRP".into(),
            "x1".into(),
            "x2".into(),
            "m1".into(),
            "m2".into(),
            "y1".into(),
            "y2".into(),
        ];
        let n = 150usize;
        let mut rows = Vec::with_capacity(n * 2);
        for g in [1, 2] {
            let bx = if g == 1 { 0.55 } else { 0.10 };
            for _ in 0..n {
                let x = normal(&mut rng);
                let m = bx * x + (1.0 - bx * bx).sqrt() * normal(&mut rng);
                let y = 0.35 * x + 0.45 * m + 0.55 * normal(&mut rng);
                rows.push(vec![
                    json!(g),
                    json!(x + 0.2 * normal(&mut rng)),
                    json!(0.95 * x + 0.2 * normal(&mut rng)),
                    json!(m + 0.2 * normal(&mut rng)),
                    json!(0.95 * m + 0.2 * normal(&mut rng)),
                    json!(y + 0.2 * normal(&mut rng)),
                    json!(0.95 * y + 0.2 * normal(&mut rng)),
                ]);
            }
        }
        let spec = json!({
            "constructs": [
                {"id": "X", "name": "X", "type": "reflective", "indicators": ["x1", "x2"]},
                {"id": "M", "name": "M", "type": "reflective", "indicators": ["m1", "m2"]},
                {"id": "Y", "name": "Y", "type": "reflective", "indicators": ["y1", "y2"]}
            ],
            "paths": [
                {"from": "X", "to": "M"},
                {"from": "X", "to": "Y"},
                {"from": "M", "to": "Y"}
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

        let settings = MgaSettings {
            group_a: ga,
            group_b: gb,
            subsamples: 200,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(42),
            pls_settings: PlsSettings::default(),
        };

        let cancel = AtomicBool::new(false);
        let report = run_bootstrap_mga(&cols, &rows, &spec, &settings, "m1", None, &cancel, &|_, _, _| {})
            .unwrap();
        let xm = report.path_coefficients.iter().find(|r| r.key == "X->M").unwrap();
        let xy = report.path_coefficients.iter().find(|r| r.key == "X->Y").unwrap();
        assert!(xm.parametric_significant, "X->M parametric should be significant (p={})", xm.parametric_p);
        assert!(xm.welch_significant, "X->M welch should be significant (p={})", xm.welch_p);
        assert!(xm.henseler_significant && xm.henseler_p_2tailed < 0.05, "X->M henseler should be significant");
        assert_ne!(xm.henseler_result, "n.s.", "X->M henseler should be significant (pGreater={})", xm.henseler_p_greater);
        assert!(!xy.parametric_significant, "X->Y should not be significant (p={})", xy.parametric_p);
        assert!(xm.ci_lower_a < xm.ci_upper_a && xm.ci_lower_b < xm.ci_upper_b);
        assert!(xm.t_value_a > 0.0 && xm.p_value_a < 0.05);

        // Indirect & Total effects populated for X -> M -> Y
        assert_eq!(report.total_indirect_effects.len(), 1);
        assert_eq!(report.total_indirect_effects[0].key, "X->Y");
        assert_eq!(report.specific_indirect_effects.len(), 1);
        assert_eq!(report.specific_indirect_effects[0].key, "X->M->Y");
        assert_eq!(report.total_effects.len(), 3);
    }
}

