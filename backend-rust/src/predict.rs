//! Cross-validated PLSpredict with the existing Python result semantics.
use crate::{linalg, matrix, model, pipeline, rng, stats};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Deserialize)]
#[serde(default)]
pub struct Options {
    pub k_folds: usize,
    pub repetitions: usize,
    pub seed: Option<u64>,
    pub antecedents: String,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            k_folds: 10,
            repetitions: 10,
            seed: Some(42),
            antecedents: "direct".into(),
        }
    }
}
#[derive(Default, Clone)]
struct Accumulator {
    actual: Vec<f64>,
    pls: Vec<f64>,
    lm: Vec<f64>,
    naive: Vec<f64>,
}
fn verdict(better: usize, total: usize) -> &'static str {
    if total == 0 {
        "none"
    } else if better == total {
        "high"
    } else if better * 2 >= total {
        "medium"
    } else if better > 0 {
        "low"
    } else {
        "none"
    }
}
pub fn run(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    settings: Value,
    options: Options,
) -> Result<Value, String> {
    run_with_control(
        columns,
        rows,
        spec,
        settings,
        options,
        &AtomicBool::new(false),
        &|_, _| {},
    )
}
pub fn run_with_control(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    settings: Value,
    options: Options,
    cancel: &AtomicBool,
    progress: &(dyn Fn(usize, usize) + Sync),
) -> Result<Value, String> {
    let cfg = model::settings(&settings)?;
    let parsed = model::parse(&spec)?;
    let mut endogenous: Vec<(String, Vec<String>)> = Vec::new();
    for [from, to] in &parsed.paths {
        if let Some((_, preds)) = endogenous.iter_mut().find(|(id, _)| id == to) {
            preds.push(from.clone());
        } else {
            endogenous.push((to.clone(), vec![from.clone()]));
        }
    }
    if endogenous.is_empty() {
        return Err(
            "PLSpredict requires at least one endogenous construct with incoming paths.".into(),
        );
    }
    let exogenous: Vec<_> = parsed
        .blocks
        .iter()
        .filter(|b| !endogenous.iter().any(|(id, _)| id == &b.id))
        .map(|b| &b.id)
        .collect();
    let mut needed: Vec<String> = Vec::new();
    let mut groups: Vec<(String, Vec<(String, String)>)> = Vec::new();
    for block in &parsed.blocks {
        let mut inds = Vec::new();
        for iid in &block.indicators {
            let col = &parsed
                .indicators
                .iter()
                .find(|(id, _)| id == iid)
                .unwrap()
                .1;
            if columns.contains(col) {
                if !needed.contains(col) {
                    needed.push(col.clone());
                }
                inds.push((iid.clone(), col.clone()));
            }
        }
        groups.push((block.id.clone(), inds));
    }
    let positions: Vec<_> = needed
        .iter()
        .map(|c| columns.iter().position(|v| v == c).unwrap())
        .collect();
    let missing_codes: Vec<_> = cfg["missing_codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(model::numeric)
        .filter(|v| !v.is_nan())
        .collect();
    let clean: Vec<Vec<f64>> = rows
        .iter()
        .map(|row| {
            positions
                .iter()
                .map(|&j| model::numeric(&row[j]))
                .collect::<Vec<_>>()
        })
        .filter(|r| r.iter().all(|v| !v.is_nan() && !missing_codes.contains(v)))
        .collect();
    let n = clean.len();
    if n < 30 {
        return Err(format!(
            "PLSpredict requires at least 30 complete cases (found {n})."
        ));
    }
    let k = options.k_folds.min(n / 5).max(2);
    let warning = if n as f64 / (k as f64) < 30.0 {
        Some(format!(
            "Sample size per fold ({}) is below recommended threshold of 30.",
            n / k
        ))
    } else {
        None
    };
    let mut random = rng::Pcg64::from_optional_seed(options.seed)?;
    let seeds: Vec<_> = (0..options.repetitions)
        .map(|_| random.bounded(1000000))
        .collect::<Result<_, _>>()?;
    let mut accum = vec![Accumulator::default(); needed.len()];
    let mut exog: Vec<usize> = Vec::new();
    for (id, inds) in &groups {
        if exogenous.contains(&id) {
            for (_, col) in inds {
                let index = needed.iter().position(|c| c == col).unwrap();
                if !exog.contains(&index) {
                    exog.push(index);
                }
            }
        }
    }
    if exog.is_empty() {
        exog = (0..needed.len())
            .filter(|&j| {
                !groups
                    .iter()
                    .filter(|(id, _)| endogenous.iter().any(|(target, _)| target == id))
                    .any(|(_, inds)| inds.iter().any(|(_, c)| c == &needed[j]))
            })
            .collect();
    }
    let mut step = 0;
    for seed in seeds {
        let mut random = rng::Pcg64::new(&rng::integer_entropy(seed));
        let shuffled = random.permutation(n);
        let mut start = 0;
        for fold in 0..k {
            if cancel.load(Ordering::Relaxed) {
                return Ok(json!({"status":"cancelled","message":"PLSpredict cancelled by user."}));
            }
            let size = n / k + usize::from(fold < n % k);
            let holdout = &shuffled[start..start + size];
            start += size;
            let mut mask = vec![true; n];
            for &i in holdout {
                mask[i] = false;
            }
            let train: Vec<_> = (0..n).filter(|&i| mask[i]).collect();
            let training: Vec<Vec<Value>> = train
                .iter()
                .map(|&i| clean[i].iter().map(|v| json!(v)).collect())
                .collect();
            let result =
                pipeline::run_without_fit(needed.clone(), training, spec.clone(), cfg.clone())?;
            let mut means = vec![0.0; needed.len()];
            let mut sds = vec![1.0; needed.len()];
            for j in 0..needed.len() {
                let values: Vec<_> = train.iter().map(|&i| clean[i][j]).collect();
                means[j] = stats::mean(&values, None);
                let sd = stats::std(&values, None, 0);
                sds[j] = if sd == 0.0 { 1.0 } else { sd };
            }
            let mut holdout_scores = Map::new();
            for (cid, inds) in &groups {
                let mut score = vec![0.0; size];
                let mut training_score = vec![0.0; train.len()];
                for (iid, col) in inds {
                    let j = needed.iter().position(|c| c == col).unwrap();
                    let weight = result["measurement"]["outer_weights"][cid][iid]
                        .as_f64()
                        .unwrap_or(1.0 / (inds.len() as f64).sqrt());
                    for (value, &i) in score.iter_mut().zip(holdout) {
                        *value += (clean[i][j] - means[j]) / sds[j] * weight;
                    }
                    for (value, &i) in training_score.iter_mut().zip(&train) {
                        *value += (clean[i][j] - means[j]) / sds[j] * weight;
                    }
                }
                let sd = stats::std(&training_score, None, 0);
                let sd = if sd == 0.0 { 1.0 } else { sd };
                for v in &mut score {
                    *v /= sd;
                }
                holdout_scores.insert(cid.clone(), json!(score));
            }
            let mut design = vec![vec![1.0; train.len()]];
            design.extend(
                exog.iter()
                    .map(|&j| train.iter().map(|&i| clean[i][j]).collect()),
            );
            for (target, preds) in &endogenous {
                let mut predicted = vec![0.0; size];
                for source in preds {
                    // Structural coefficients are indexed target -> source.
                    // Intentional correction shared with the Python reference.
                    let beta = result["structural"]["path_coefficients"][target][source]
                        .as_f64()
                        .unwrap_or(0.0);
                    for (i, value) in predicted.iter_mut().enumerate() {
                        *value += beta * holdout_scores[source][i].as_f64().unwrap_or(0.0);
                    }
                }
                let group = &groups
                    .iter()
                    .find(|(cid, _)| cid == target)
                    .ok_or("Unknown prediction target")?
                    .1;
                for (iid, col) in group {
                    let j = needed.iter().position(|c| c == col).unwrap();
                    let lambda = result["measurement"]["outer_loadings"][target][iid]
                        .as_f64()
                        .unwrap_or(0.70);
                    let fit = if exog.is_empty() {
                        None
                    } else {
                        Some(
                            linalg::least_squares(
                                &design,
                                &train.iter().map(|&i| clean[i][j]).collect::<Vec<_>>(),
                                None,
                            )?
                            .coefficients,
                        )
                    };
                    for (position, &i) in holdout.iter().enumerate() {
                        let lm = fit
                            .as_ref()
                            .map(|beta| {
                                beta[0]
                                    + exog
                                        .iter()
                                        .enumerate()
                                        .map(|(c, &j)| beta[c + 1] * clean[i][j])
                                        .sum::<f64>()
                            })
                            .unwrap_or(means[j]);
                        accum[j].actual.push(clean[i][j]);
                        accum[j]
                            .pls
                            .push(means[j] + sds[j] * lambda * predicted[position]);
                        accum[j].lm.push(lm);
                        accum[j].naive.push(means[j]);
                    }
                }
            }
            step += 1;
            progress(step, options.repetitions * k);
        }
    }
    let mut indicators = Vec::new();
    let mut constructs = Map::new();
    let mut total_better = 0;
    for (target, _) in &endogenous {
        let group = &groups.iter().find(|(cid, _)| cid == target).unwrap().1;
        let mut q2s = Vec::new();
        let mut better_count = 0;
        for (_, col) in group {
            let j = needed.iter().position(|c| c == col).unwrap();
            let a = &accum[j];
            if a.actual.is_empty() {
                continue;
            }
            let squares = |prediction: &[f64]| {
                stats::numpy_reduce(0, a.actual.len(), &|i| {
                    (a.actual[i] - prediction[i]).powi(2)
                })
            };
            let sse_pls = squares(&a.pls);
            let sse_lm = squares(&a.lm);
            let sse_naive = squares(&a.naive);
            let rmse_pls = (sse_pls / a.actual.len() as f64).sqrt();
            let rmse_lm = (sse_lm / a.actual.len() as f64).sqrt();
            let mae = |prediction: &[f64]| {
                stats::numpy_reduce(0, a.actual.len(), &|i| (a.actual[i] - prediction[i]).abs())
                    / a.actual.len() as f64
            };
            let mae_pls = mae(&a.pls);
            let mae_lm = mae(&a.lm);
            let q2 = if sse_naive > 1e-12 {
                1.0 - sse_pls / sse_naive
            } else {
                0.0
            };
            let better = rmse_pls < rmse_lm;
            if better {
                better_count += 1;
                total_better += 1;
            }
            q2s.push(matrix::round(q2, 4));
            indicators.push(json!({"indicator":col,"construct":target,"q2_predict":matrix::round(q2,4),"q2_predict_positive":q2 > 0.0,
                "rmse_pls":matrix::round(rmse_pls,4),"rmse_lm":matrix::round(rmse_lm,4),"rmse_diff":matrix::round(rmse_pls-rmse_lm,4),
                "mae_pls":matrix::round(mae_pls,4),"mae_lm":matrix::round(mae_lm,4),"mae_diff":matrix::round(mae_pls-mae_lm,4),"pls_beats_lm":better}));
        }
        if !q2s.is_empty() {
            let classification = verdict(better_count, q2s.len());
            let description = match classification { "high"=>"High predictive power: PLS-SEM outperforms LM for all indicators.","medium"=>"Medium predictive power: PLS-SEM outperforms LM for the majority of indicators.","low"=>"Low predictive power: PLS-SEM outperforms LM for a minority of indicators.",_=>"No predictive power: LM outperforms PLS-SEM for all indicators." };
            constructs.insert(target.clone(),json!({"construct":target,"n_indicators":q2s.len(),"n_pls_beats_lm":better_count,"predictive_power":classification,"description":description,"mean_q2_predict":matrix::round(stats::mean(&q2s,None),4)}));
        }
    }
    Ok(
        json!({"k_folds":k,"repetitions":options.repetitions,"n_samples":n,"antecedents":options.antecedents,"warning":warning,
        "indicator_metrics":indicators,"construct_summary":constructs,"overall_predictive_power":verdict(total_better,indicators.len()),
        "interpretation":{"high":"PLS-SEM has higher predictive power than LM on all indicator benchmarks.","medium":"PLS-SEM outperforms LM on majority of indicator benchmarks.","low":"PLS-SEM outperforms LM on minority of indicator benchmarks.","none":"No predictive power: LM benchmark matches or exceeds PLS-SEM across indicators."}}),
    )
}
