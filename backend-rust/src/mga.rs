//! Multigroup comparisons using native fits, bootstrap and seeded permutations.
use crate::{
    bootstrap,
    grouping::{self, equal, label},
    inference,
    matrix::round,
    model, pipeline, rng,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

pub fn tests(beta: [f64; 2], se: [f64; 2], n: [usize; 2]) -> Result<Value, String> {
    if n.iter().any(|&n| n < 2) {
        return Err("Multigroup tests require at least two cases per group".into());
    }
    let [n1, n2] = n.map(|n| n as f64);
    let [se1, se2] = se;
    let diff = beta[0] - beta[1];
    let df = n1 + n2 - 2.0;
    let pooled = ((n1 - 1.0).powi(2) / df) * se1.powi(2) + ((n2 - 1.0).powi(2) / df) * se2.powi(2);
    let se_diff = (pooled * (1.0 / n1 + 1.0 / n2)).max(1e-12).sqrt();
    let t = if se_diff > 1e-12 { diff / se_diff } else { 0.0 };
    let p = 2.0 * (1.0 - inference::student_t_cdf(t.abs(), df));
    let parametric = json!({"t_statistic":round(t,4),"degrees_of_freedom":df as usize,"p_value":round(p,4),"is_significant":p<0.05});
    let variance = ((n1 - 1.0) / n1) * se1.powi(2) + ((n2 - 1.0) / n2) * se2.powi(2);
    let t = diff / variance.max(1e-12).sqrt();
    let denominator =
        ((n1 - 1.0) / n1.powi(2)) * se1.powi(4) + ((n2 - 1.0) / n2.powi(2)) * se2.powi(4);
    let df = if denominator > 1e-12 {
        (variance.powi(2) / denominator - 2.0).max(1.0)
    } else {
        df
    };
    let p = 2.0 * (1.0 - inference::student_t_cdf(t.abs(), df));
    Ok(
        json!({"parametric":parametric,"welch":{"t_statistic":round(t,4),"degrees_of_freedom":round(df,2),"p_value":round(p,4),"is_significant":p<0.05}}),
    )
}
pub fn henseler(x: &[f64], y: &[f64]) -> Value {
    if x.is_empty() || y.is_empty() {
        return json!({"p_value_one_tailed":null,"p_value_two_tailed":null,"is_significant":false});
    }
    let mut x = x.to_vec();
    x.sort_by(f64::total_cmp);
    let count: u128 = y
        .iter()
        .map(|y| x.partition_point(|x| x <= y) as u128)
        .sum();
    let one = count as f64 / (x.len() as f64 * y.len() as f64);
    let two = 2.0 * one.min(1.0 - one);
    json!({"p_value_one_tailed":round(one,4),"p_value_two_tailed":round(two,4),"is_significant":two<0.05})
}
#[derive(Deserialize)]
#[serde(default)]
pub struct Options {
    pub group_col: String,
    pub group_values: Option<[Value; 2]>,
    pub n_boot: usize,
    pub n_permutations: usize,
    pub seed: Option<u64>,
    pub alpha: f64,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            group_col: String::new(),
            group_values: None,
            n_boot: 500,
            n_permutations: 500,
            seed: Some(42),
            alpha: 0.05,
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
    progress: &(dyn Fn(usize) + Sync),
) -> Result<Value, String> {
    if rows.iter().any(|r| r.len() != columns.len()) {
        return Err("Dataset row width differs from columns".into());
    }
    let j = columns
        .iter()
        .position(|c| c == &o.group_col)
        .ok_or("Group column not found")?;
    let groups = if let Some(groups) = &o.group_values {
        groups.clone()
    } else {
        let groups = grouping::distinct(&rows, j);
        if groups.len() < 2 {
            return Err(format!(
                "Group column '{}' must have at least 2 distinct categories.",
                o.group_col
            ));
        }
        [groups[0].clone(), groups[1].clone()]
    };
    let g1: Vec<_> = rows
        .iter()
        .filter(|r| equal(&r[j], &groups[0]))
        .cloned()
        .collect();
    let g2: Vec<_> = rows
        .iter()
        .filter(|r| equal(&r[j], &groups[1]))
        .cloned()
        .collect();
    let n1 = g1.len();
    let n2 = g2.len();
    let mut warnings = Vec::new();
    let ratio = n1.max(n2) as f64 / n1.min(n2).max(1) as f64;
    if ratio > 3.0 {
        warnings.push(format!("Group sample size ratio is {:.1}:1 (> 3:1). Extreme imbalance reduces statistical power.",round(ratio,1)));
    }
    if n1 < 10 || n2 < 10 {
        warnings.push("One or both groups have N < 10, violating minimum sample size requirements for reliable PLS-SEM estimation.".into());
    }
    let cfg = model::settings(&settings)?;
    let r1 = pipeline::run_without_fit(columns.clone(), g1.clone(), spec.clone(), cfg.clone())?;
    let r2 = pipeline::run_without_fit(columns.clone(), g2.clone(), spec.clone(), cfg.clone())?;
    let seed2 = o
        .seed
        .map(|s| {
            s.checked_add(1000)
                .ok_or("MGA seed exceeds native unsigned 64-bit boundary")
        })
        .transpose()?;
    let bootstrap_options = |seed| bootstrap::Options {
        n_boot: o.n_boot,
        seed,
        scheme: cfg["inner_weighting"].as_str().unwrap().into(),
        mode: "basic".into(),
        sign_change: "none".into(),
        alpha: Some(o.alpha),
        n_workers: Some(2),
        ..bootstrap::Options::default()
    };
    let boot1 = bootstrap::run_with_control(
        columns.clone(),
        g1.clone(),
        spec.clone(),
        bootstrap_options(o.seed),
        cancel,
        &|_, _| {},
    )?;
    let boot2 = bootstrap::run_with_control(
        columns.clone(),
        g2.clone(),
        spec.clone(),
        bootstrap_options(seed2),
        cancel,
        &|_, _| {},
    )?;
    let parsed = model::parse(&spec)?;
    let mut pooled = g1;
    pooled.extend(g2);
    let mut differences = vec![vec![0.0; o.n_permutations]; parsed.paths.len()];
    let seed = o
        .seed
        .filter(|s| *s != 0)
        .unwrap_or(42)
        .checked_add(2000)
        .ok_or("MGA seed exceeds native unsigned 64-bit boundary")?;
    for (i, seed) in rng::seed_sequence(&rng::integer_entropy(seed), o.n_permutations)
        .into_iter()
        .enumerate()
    {
        if cancel.load(Ordering::Relaxed) {
            return Err("MGA permutation test cancelled by user.".into());
        }
        let indices = rng::Pcg64::new(&[seed]).permutation(pooled.len());
        let a = indices[..n1].iter().map(|&i| pooled[i].clone()).collect();
        let b = indices[n1..].iter().map(|&i| pooled[i].clone()).collect();
        let a = pipeline::run_without_fit(columns.clone(), a, spec.clone(), cfg.clone())?;
        let b = pipeline::run_without_fit(columns.clone(), b, spec.clone(), cfg.clone())?;
        for (p, [from, to]) in parsed.paths.iter().enumerate() {
            differences[p][i] = a["structural"]["path_coefficients"][to][from]
                .as_f64()
                .unwrap_or(0.0)
                - b["structural"]["path_coefficients"][to][from]
                    .as_f64()
                    .unwrap_or(0.0);
        }
        if i % 50 == 0 {
            progress((i * 100) / o.n_permutations);
        }
    }
    let mut comparisons = Vec::new();
    for (i, [from, to]) in parsed.paths.iter().enumerate() {
        let b1 = r1["structural"]["path_coefficients"][to][from]
            .as_f64()
            .unwrap_or(0.0);
        let b2 = r2["structural"]["path_coefficients"][to][from]
            .as_f64()
            .unwrap_or(0.0);
        let diff = b1 - b2;
        let key = format!("path:{from}->{to}");
        let se = [
            boot1["parameter_summary"][&key]["standard_error"]
                .as_f64()
                .unwrap_or(0.0),
            boot2["parameter_summary"][&key]["standard_error"]
                .as_f64()
                .unwrap_or(0.0),
        ];
        let tests = tests([b1, b2], se, [n1, n2])?;
        let p = (differences[i]
            .iter()
            .filter(|&&d| d.abs() >= diff.abs())
            .count()
            + 1) as f64
            / (o.n_permutations + 1) as f64;
        let draws = |b: &Value| {
            b["samples_dict"][&key]
                .as_array()
                .map(|v| v.iter().map(model::numeric).collect::<Vec<_>>())
                .unwrap_or_default()
        };
        let henseler = henseler(&draws(&boot1), &draws(&boot2));
        let consensus = p < o.alpha || henseler["is_significant"] == true;
        comparisons.push(json!({"path":format!("{from} -> {to}"),"from":from,"to":to,"beta_group_1":round(b1,4),"beta_group_2":round(b2,4),"difference":round(diff,4),
            "parametric_test":tests["parametric"],"welch_test":tests["welch"],"welch_satterthwaite_test":tests["welch"],"permutation_test":{"p_value":round(p,4),"is_significant":p<o.alpha},"henseler_pls_mga":henseler,"consensus_significant":consensus,"consensus":consensus}));
    }
    Ok(
        json!({"group_column":o.group_col,"group_1":label(&groups[0]),"group_2":label(&groups[1]),"n_group_1":n1,"n_group_2":n2,"n_boot":o.n_boot,"n_permutations":o.n_permutations,"warnings":warnings,"path_comparisons":comparisons,
        "recommendation":"The Permutation test (Chin & Dibbern 2010) and Henseler's PLS-MGA (Henseler et al. 2009) are non-parametric and represent the recommended tests for PLS-SEM multigroup comparisons (Hair et al. 2017)."}),
    )
}
