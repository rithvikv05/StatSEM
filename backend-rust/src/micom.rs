//! Configural/compositional invariance and equality of composite moments.
use crate::{grouping, inference, model, pipeline, rng, stats};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

pub fn configural(a: &Value, b: &Value, attestation: bool) -> Result<Value, String> {
    let constructs = |spec: &Value| {
        let mut ids: Vec<_> = spec["constructs"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|c| c["id"].clone())
            .collect();
        ids.sort_by_key(Value::to_string);
        ids
    };
    let paths = |spec: &Value| {
        let mut paths: Vec<_> = spec["paths"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| {
                format!(
                    "{}->{}",
                    model::alias(p, &["from", "from_node"]).unwrap_or("None"),
                    model::alias(p, &["to", "to_node"]).unwrap_or("None")
                )
            })
            .collect();
        paths.sort();
        paths
    };
    let signatures = |spec: &Value| -> Result<(Value, Value), String> {
        let mut spec = spec.clone();
        if spec.get("constructs").is_none() {
            spec["constructs"] = json!([]);
        }
        let parsed = model::parse(&spec)?;
        let mut inds = serde_json::Map::new();
        let mut meas = serde_json::Map::new();
        for block in &parsed.blocks {
            let mut columns: Vec<_> = block
                .indicators
                .iter()
                .map(|iid| {
                    parsed
                        .indicators
                        .iter()
                        .find(|(id, _)| id == iid)
                        .map(|(_, col)| col.clone())
                        .unwrap_or(iid.clone())
                })
                .collect();
            columns.sort();
            inds.insert(block.id.clone(), json!(columns));
            meas.insert(
                block.id.clone(),
                json!([
                    block.measurement_type,
                    block.outer_mode,
                    block.weighting,
                    block.predefined_weights
                ]),
            );
        }
        Ok((Value::Object(inds), Value::Object(meas)))
    };
    let ca = constructs(a);
    let cb = constructs(b);
    let pa = paths(a);
    let pb = paths(b);
    let (ia, ma) = signatures(a)?;
    let (ib, mb) = signatures(b)?;
    let passed = ca == cb && pa == pb && ia == ib && ma == mb && attestation;
    Ok(
        json!({"passed":passed,"auto_verified":{"same_constructs":ca==cb,"same_paths":pa==pb,"same_indicators":ia==ib,"same_measurement":ma==mb,"construct_count":ca.len(),"path_count":pa.len()},
        "needs_attestation":{"identical_questionnaire":attestation,"identical_data_collection":attestation},"interpretation":if passed {"Configural invariance established: Groups share identical constructs, indicators, and structural paths."} else {"Configural invariance failed: Groups differ in construct specifications or data collection attestations."}}),
    )
}
#[derive(Deserialize)]
#[serde(default)]
pub struct Options {
    pub group_col: String,
    pub group_values: Option<[Value; 2]>,
    pub n_permutations: usize,
    pub alpha: f64,
    pub seed: Option<u64>,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            group_col: String::new(),
            group_values: None,
            n_permutations: 1000,
            alpha: 0.05,
            seed: Some(42),
        }
    }
}
fn correlation(a: &[f64], b: &[f64], single: bool) -> f64 {
    if a == b {
        return 1.0;
    }
    if a.iter().zip(b).all(|(a, b)| *a == -*b) {
        return -1.0;
    }
    if stats::std(a, None, 0) > 1e-12 && stats::std(b, None, 0) > 1e-12 {
        if single {
            return if a.iter().zip(b).map(|(a, b)| a * b).sum::<f64>() >= 0.0 {
                1.0
            } else {
                -1.0
            };
        }
        stats::correlation(a, b, None)
    } else {
        1.0
    }
}
fn score(columns: &[Vec<f64>], weights: &[f64]) -> Vec<f64> {
    let mut result = vec![0.0; columns[0].len()];
    for (column, &weight) in columns.iter().zip(weights) {
        for (value, x) in result.iter_mut().zip(column) {
            *value += x * weight;
        }
    }
    result
}
fn moments(y: &[f64], a: &[usize], b: &[usize]) -> [f64; 2] {
    let a: Vec<_> = a.iter().map(|&i| y[i]).collect();
    let b: Vec<_> = b.iter().map(|&i| y[i]).collect();
    let va = stats::variance(&a, None, 1);
    let vb = stats::variance(&b, None, 1);
    let va = if va == 0.0 { 1e-6 } else { va };
    let vb = if vb == 0.0 { 1e-6 } else { vb };
    [
        stats::mean(&a, None) - stats::mean(&b, None),
        (va / vb).ln(),
    ]
}
struct Composite {
    id: String,
    normalized: Vec<Vec<f64>>,
    indicator_ids: Vec<String>,
    pooled: Vec<f64>,
    observed: [f64; 3],
    distributions: [Vec<f64>; 3],
}
fn weights(result: &Value, id: &str, indicators: &[String]) -> Vec<f64> {
    indicators
        .iter()
        .map(|iid| {
            result["measurement"]["outer_weights"][id][iid]
                .as_f64()
                .unwrap_or(0.0)
        })
        .collect()
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
    if o.n_permutations == 0 {
        return Err("MICOM requires at least one permutation".into());
    }
    if rows.iter().any(|r| r.len() != columns.len()) {
        return Err("Dataset row width differs from columns".into());
    }
    let j = columns
        .iter()
        .position(|c| c == &o.group_col)
        .ok_or("Group column not found")?;
    let groups = if let Some(groups) = o.group_values {
        groups
    } else {
        let values = grouping::distinct(&rows, j);
        if values.len() < 2 {
            return Err(format!(
                "Group column '{}' must have at least 2 categories (found {}).",
                o.group_col,
                values.len()
            ));
        }
        [values[0].clone(), values[1].clone()]
    };
    let a: Vec<_> = rows
        .iter()
        .filter(|r| grouping::equal(&r[j], &groups[0]))
        .cloned()
        .collect();
    let b: Vec<_> = rows
        .iter()
        .filter(|r| grouping::equal(&r[j], &groups[1]))
        .cloned()
        .collect();
    let n1 = a.len();
    let n2 = b.len();
    if n1 < 10 || n2 < 10 {
        return Err(format!("Sample size too small for MICOM: Group 1 has N={n1}, Group 2 has N={n2}. Minimum N=10 required."));
    }
    let cfg = model::settings(&settings)?;
    let r1 = pipeline::run_without_fit(columns.clone(), a.clone(), spec.clone(), cfg.clone())?;
    let r2 = pipeline::run_without_fit(columns.clone(), b.clone(), spec.clone(), cfg.clone())?;
    let mut pooled = a;
    pooled.extend(b);
    let rp = pipeline::run_without_fit(columns.clone(), pooled.clone(), spec.clone(), cfg.clone())?;
    let parsed = model::parse(&spec)?;
    let mut composites = Vec::new();
    let first: Vec<_> = (0..n1).collect();
    let second: Vec<_> = (n1..pooled.len()).collect();
    for block in &parsed.blocks {
        let mut cols = Vec::new();
        for iid in &block.indicators {
            let col = &parsed
                .indicators
                .iter()
                .find(|(id, _)| id == iid)
                .unwrap()
                .1;
            if columns.contains(col) && !cols.contains(col) {
                cols.push(col.clone());
            }
        }
        if cols.is_empty() {
            return Err(format!(
                "MICOM construct '{}' has no dataset indicators",
                block.id
            ));
        }
        let indicators: Vec<_> = cols
            .iter()
            .map(|col| {
                parsed
                    .indicators
                    .iter()
                    .rev()
                    .find(|(_, c)| c == col)
                    .unwrap()
                    .0
                    .clone()
            })
            .collect();
        let normalized: Vec<Vec<f64>> = cols
            .iter()
            .map(|col| {
                let j = columns.iter().position(|c| c == col).unwrap();
                let x: Vec<_> = pooled.iter().map(|r| model::numeric(&r[j])).collect();
                let mean = stats::mean(&x, None);
                let sd = stats::std(&x, None, 0);
                let sd = if sd <= 1e-12 { 1.0 } else { sd };
                x.iter().map(|v| (v - mean) / sd).collect()
            })
            .collect();
        let y1 = score(&normalized, &weights(&r1, &block.id, &indicators));
        let y2 = score(&normalized, &weights(&r2, &block.id, &indicators));
        let yp = score(&normalized, &weights(&rp, &block.id, &indicators));
        let [mean, logvar] = moments(&yp, &first, &second);
        let single = normalized.len() == 1;
        composites.push(Composite {
            id: block.id.clone(),
            normalized,
            indicator_ids: indicators,
            pooled: yp,
            observed: [correlation(&y1, &y2, single), mean, logvar],
            distributions: std::array::from_fn(|_| Vec::with_capacity(o.n_permutations)),
        });
    }
    let seed = o.seed.filter(|s| *s != 0).unwrap_or(42);
    for (p, seed) in rng::seed_sequence(&rng::integer_entropy(seed), o.n_permutations)
        .into_iter()
        .enumerate()
    {
        if cancel.load(Ordering::Relaxed) {
            return Err("MICOM cancelled by user.".into());
        }
        let order = rng::Pcg64::new(&[seed]).permutation(pooled.len());
        let a = &order[..n1];
        let b = &order[n1..];
        let ra = pipeline::run_without_fit(
            columns.clone(),
            a.iter().map(|&i| pooled[i].clone()).collect(),
            spec.clone(),
            cfg.clone(),
        )?;
        let rb = pipeline::run_without_fit(
            columns.clone(),
            b.iter().map(|&i| pooled[i].clone()).collect(),
            spec.clone(),
            cfg.clone(),
        )?;
        for c in &mut composites {
            let ya = score(&c.normalized, &weights(&ra, &c.id, &c.indicator_ids));
            let yb = score(&c.normalized, &weights(&rb, &c.id, &c.indicator_ids));
            let [mean, logvar] = moments(&c.pooled, a, b);
            for (distribution, value) in c.distributions.iter_mut().zip([
                correlation(&ya, &yb, c.normalized.len() == 1),
                mean,
                logvar,
            ]) {
                distribution.push(value);
            }
        }
        if p % 50 == 0 {
            progress(p * 100 / o.n_permutations);
        }
    }
    let mut evaluations = Vec::new();
    let mut eligible = true;
    for c in composites {
        let mut dist = c.distributions.clone();
        for distribution in &mut dist {
            distribution.sort_by(f64::total_cmp);
        }
        let quantile = inference::percentile(&dist[0], 0.05);
        let pass2 = c.observed[0] >= quantile;
        let pvalue = |i: usize, absolute: bool| {
            (c.distributions[i]
                .iter()
                .filter(|&&v| {
                    if absolute {
                        v.abs() >= c.observed[i].abs()
                    } else {
                        v <= c.observed[i]
                    }
                })
                .count()
                + 1) as f64
                / (o.n_permutations + 1) as f64
        };
        let mean_ci = [
            inference::percentile(&dist[1], o.alpha / 2.0),
            inference::percentile(&dist[1], 1.0 - o.alpha / 2.0),
        ];
        let var_ci = [
            inference::percentile(&dist[2], o.alpha / 2.0),
            inference::percentile(&dist[2], 1.0 - o.alpha / 2.0),
        ];
        let mean_equal = mean_ci[0] <= c.observed[1] && c.observed[1] <= mean_ci[1];
        let var_equal = var_ci[0] <= c.observed[2] && c.observed[2] <= var_ci[1];
        let (status, recommendation) = if !pass2 {
            ("No invariance","Do not compare path coefficients or latent means across groups for this construct.")
        } else if !mean_equal || !var_equal {
            ("Partial measurement invariance","You can compare standardized path coefficients across groups (MGA), but do not pool groups or compare latent means.")
        } else {
            ("Full measurement invariance","You can compare path coefficients and latent means, and pooling group data is permitted.")
        };
        eligible &= pass2;
        evaluations.push(json!({"construct_id":c.id,"step2_compositional":{"c_correlation":c.observed[0],"threshold_5pct":quantile,"p_value":pvalue(0,false),"passed":pass2},
            "step3_equal_means":{"mean_difference":c.observed[1],"ci_lower":mean_ci[0],"ci_upper":mean_ci[1],"p_value":pvalue(1,true),"passed":mean_equal},
            "step3_equal_variances":{"log_variance_ratio":c.observed[2],"ci_lower":var_ci[0],"ci_upper":var_ci[1],"p_value":pvalue(2,true),"passed":var_equal},"invariance_status":status,"recommendation":recommendation}));
    }
    Ok(
        json!({"group_column":o.group_col,"group_1":grouping::label(&groups[0]),"group_2":grouping::label(&groups[1]),"n_group_1":n1,"n_group_2":n2,"n_permutations":o.n_permutations,
        "configural_invariance":configural(&spec,&spec,true)?,"constructs":evaluations,"overall_summary":{"all_partial_or_full":eligible,"mga_eligible":eligible}}),
    )
}
