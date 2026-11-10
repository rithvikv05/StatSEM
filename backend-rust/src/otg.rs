//! Omnibus group tests and pairwise permutations. Fits shared across paths.
use crate::{bootstrap, grouping, model, pipeline, rng, stats};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

pub fn thresholds(comparisons: usize, alpha: f64) -> Value {
    let m = comparisons.max(1) as f64;
    json!({"fwer":1.0-(1.0-alpha).powf(m),"sidak":1.0-(1.0-alpha).powf(1.0/m),"bonferroni":alpha/m})
}
pub fn fr(draws: &[Vec<f64>]) -> Result<f64, String> {
    let k = draws.len();
    if k < 2 {
        return Ok(0.0);
    }
    let b = draws.iter().map(Vec::len).min().unwrap();
    if b < 2 {
        return Err("OTG requires at least two bootstrap samples per group.".into());
    }
    // NumPy's noncontiguous axis-zero reduction is sequential.
    let means: Vec<_> = draws
        .iter()
        .map(|x| x[..b].iter().sum::<f64>() / b as f64)
        .collect();
    let grand = stats::mean(&means, None);
    let between = stats::numpy_reduce(0, k, &|i| (means[i] - grand).powi(2)) / (k - 1) as f64;
    let within = stats::numpy_reduce(0, b * k, &|i| (draws[i % k][i / k] - means[i % k]).powi(2))
        / (b - 1) as f64;
    Ok(k as f64 * b as f64 * between / within.max(1e-12))
}
#[derive(Deserialize)]
#[serde(default)]
pub struct Options {
    pub group_col: String,
    pub group_values: Option<Vec<Value>>,
    pub n_boot: usize,
    pub n_permutations: usize,
    pub alpha: f64,
    pub seed: Option<u64>,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            group_col: String::new(),
            group_values: None,
            n_boot: 500,
            n_permutations: 1000,
            alpha: 0.05,
            seed: Some(42),
        }
    }
}
pub fn run(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    settings: Value,
    o: Options,
    cancel: &AtomicBool,
) -> Result<Value, String> {
    if o.n_boot < 2 || o.n_permutations < 1 || !(0.0..1.0).contains(&o.alpha) || o.alpha == 0.0 {
        return Err("OTG requires n_boot >= 2, n_permutations >= 1, and 0 < alpha < 1.".into());
    }
    if rows.iter().any(|r| r.len() != columns.len()) {
        return Err("Dataset row width differs from columns".into());
    }
    let j = columns
        .iter()
        .position(|c| c == &o.group_col)
        .ok_or("Group column not found")?;
    let groups = o
        .group_values
        .clone()
        .unwrap_or_else(|| grouping::distinct(&rows, j));
    let k = groups.len();
    if k < 2 {
        return Err(format!(
            "OTG requires at least 2 groups (found {k} in column '{}').",
            o.group_col
        ));
    }
    let labels: Vec<_> = groups.iter().map(grouping::label).collect();
    let data: Vec<Vec<_>> = groups
        .iter()
        .map(|g| {
            rows.iter()
                .filter(|r| grouping::equal(&r[j], g))
                .cloned()
                .collect()
        })
        .collect();
    let mut sizes = serde_json::Map::new();
    for (g, rows) in labels.iter().zip(&data) {
        if rows.len() < 10 {
            return Err(format!(
                "Group '{g}' has only {} cases. Minimum 10 cases required for OTG.",
                rows.len()
            ));
        }
        sizes.insert(g.clone(), json!(rows.len()));
    }
    let cfg = model::settings(&settings)?;
    let paths = model::parse(&spec)?.paths;
    let mut fits = Vec::new();
    let mut boots = Vec::new();
    for (i, rows) in data.iter().enumerate() {
        check(cancel)?;
        fits.push(pipeline::run_without_fit(
            columns.clone(),
            rows.clone(),
            spec.clone(),
            cfg.clone(),
        )?);
        let seed = o
            .seed
            .map(|s| {
                s.checked_mul(100)
                    .and_then(|s| s.checked_add(i as u64 * 31))
                    .ok_or("OTG seed exceeds native unsigned 64-bit boundary")
            })
            .transpose()?;
        boots.push(bootstrap::run_with_control(
            columns.clone(),
            rows.clone(),
            spec.clone(),
            bootstrap::Options {
                seed,
                n_boot: o.n_boot,
                scheme: cfg["inner_weighting"].as_str().unwrap().into(),
                mode: "basic".into(),
                sign_change: "none".into(),
                alpha: Some(o.alpha),
                n_workers: Some(2),
                ..Default::default()
            },
            cancel,
            &|_, _| {},
        )?);
    }
    let seeds = rng::seed_sequence(
        &rng::integer_entropy(o.seed.filter(|s| *s != 0).unwrap_or(42)),
        o.n_permutations,
    );
    let mut omnibus = Vec::new();
    for [from, to] in &paths {
        let key = format!("path:{from}->{to}");
        let draws: Vec<Vec<f64>> = boots
            .iter()
            .map(|boot| {
                boot["samples_dict"][&key]
                    .as_array()
                    .map(|v| v.iter().map(model::numeric).collect())
                    .unwrap_or_else(|| vec![0.0; o.n_boot])
            })
            .collect();
        let observed = fr(&draws)?;
        let b = draws.iter().map(Vec::len).min().unwrap();
        let mut exceed = 0;
        for &seed in &seeds {
            check(cancel)?;
            let mut generator = rng::Pcg64::new(&[seed]);
            let mut perm = vec![vec![0.0; b]; k];
            for row in 0..b {
                let order = generator.permutation(k);
                for col in 0..k {
                    perm[col][row] = draws[order[col]][row];
                }
            }
            if fr(&perm)? >= observed {
                exceed += 1;
            }
        }
        let p = (exceed + 1) as f64 / (o.n_permutations + 1) as f64;
        omnibus.push(json!({"path":format!("{from} -> {to}"),"fr_statistic":observed,"p_value":p,"is_significant":p<o.alpha,"verdict":if p<o.alpha {"Group differences exist"}else{"No omnibus difference"}}));
    }
    let comparisons = k * (k - 1) / 2 * paths.len();
    let thresholds = thresholds(comparisons, o.alpha);
    let sidak = thresholds["sidak"].as_f64().unwrap();
    let bonf = thresholds["bonferroni"].as_f64().unwrap();
    let mut pairwise = Vec::new();
    for a in 0..k {
        for b in a + 1..k {
            let pooled: Vec<_> = data[a].iter().chain(&data[b]).cloned().collect();
            let observed: Vec<_> = paths
                .iter()
                .map(|[from, to]| coefficient(&fits[a], from, to) - coefficient(&fits[b], from, to))
                .collect();
            let mut exceed = vec![0; paths.len()];
            // The source refits the same permutation for every path. Reuse both fits.
            for &seed in &seeds {
                check(cancel)?;
                let order = rng::Pcg64::new(&[seed]).permutation(pooled.len());
                let left = order[..data[a].len()]
                    .iter()
                    .map(|&i| pooled[i].clone())
                    .collect();
                let right = order[data[a].len()..]
                    .iter()
                    .map(|&i| pooled[i].clone())
                    .collect();
                let left =
                    pipeline::run_without_fit(columns.clone(), left, spec.clone(), cfg.clone())?;
                let right =
                    pipeline::run_without_fit(columns.clone(), right, spec.clone(), cfg.clone())?;
                for (i, [from, to]) in paths.iter().enumerate() {
                    if (coefficient(&left, from, to) - coefficient(&right, from, to)).abs()
                        >= observed[i].abs()
                    {
                        exceed[i] += 1;
                    }
                }
            }
            for (i, [from, to]) in paths.iter().enumerate() {
                let p = (exceed[i] + 1) as f64 / (o.n_permutations + 1) as f64;
                pairwise.push(json!({"group_pair":format!("{} vs {}",labels[a],labels[b]),"group_1":labels[a],"group_2":labels[b],"path":format!("{from} -> {to}"),"beta_group_1":coefficient(&fits[a],from,to),"beta_group_2":coefficient(&fits[b],from,to),"difference":observed[i],"permutation_p_value":p,"sig_standard_05":p<0.05,"sig_sidak":p<sidak,"sig_bonferroni":p<bonf}));
            }
        }
    }
    Ok(
        json!({"group_column":o.group_col,"groups":labels,"n_groups":k,"group_sample_sizes":sizes,"n_boot":o.n_boot,"n_permutations":o.n_permutations,"omnibus_tests":omnibus,"pairwise_comparisons":pairwise,"multiple_testing":{"total_comparisons":comparisons,"nominal_alpha":o.alpha,"family_wise_error_rate":thresholds["fwer"].as_f64().unwrap(),"sidak_alpha":sidak,"bonferroni_alpha":bonf,"recommendation":"Šidák correction is preferred over Bonferroni due to superior statistical power (Hair et al. 2018)."},"note":"OTG is the non-parametric omnibus test of path differences across 3 or more groups (Sarstedt et al. 2011)."}),
    )
}
fn check(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err("OTG analysis cancelled by user.".into())
    } else {
        Ok(())
    }
}
fn coefficient(fit: &Value, from: &str, to: &str) -> f64 {
    fit["structural"]["path_coefficients"][to][from]
        .as_f64()
        .unwrap_or(0.0)
}
