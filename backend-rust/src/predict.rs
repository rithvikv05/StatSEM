//! Cross-validated PLSpredict with the existing Python result semantics.
use crate::{inference, linalg, model, pipeline, rng, stats};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashSet;

// Trace each target back to its own earliest antecedents, not unrelated roots.
fn earliest_antecedents(target: &str, paths: &[[String; 2]], visiting: &mut HashSet<String>) -> Result<Vec<String>, String> {
    if !visiting.insert(target.to_owned()) { return Err("Prediction requires an acyclic structural model".into()); }
    let parents: Vec<_> = paths.iter().filter(|p| p[1] == target).map(|p| p[0].as_str()).collect();
    let mut roots = Vec::new();
    if parents.is_empty() { roots.push(target.to_owned()); }
    for parent in parents {
        for root in earliest_antecedents(parent, paths, visiting)? {
            if !roots.contains(&root) { roots.push(root); }
        }
    }
    visiting.remove(target);
    Ok(roots)
}

fn predicted_score(target: &str, paths: &[[String; 2]], scores: &Map<String, Value>, coefficients: &Value, size: usize, visiting: &mut HashSet<String>) -> Result<Vec<f64>, String> {
    if !visiting.insert(target.to_owned()) { return Err("Prediction requires an acyclic structural model".into()); }
    let parents: Vec<_> = paths.iter().filter(|p| p[1] == target).map(|p| p[0].as_str()).collect();
    let mut predicted = vec![0.0; size];
    if parents.is_empty() {
        let observed = scores.get(target).and_then(Value::as_array).ok_or_else(|| format!("Missing antecedent scores for {target}"))?;
        for (out, value) in predicted.iter_mut().zip(observed) { *out = value.as_f64().ok_or("Invalid antecedent score")?; }
    } else {
        for parent in parents {
            let beta = coefficients[target][parent].as_f64().ok_or_else(|| format!("Prediction path is unavailable for {parent} → {target}"))?;
            let parent_scores = predicted_score(parent, paths, scores, coefficients, size, visiting)?;
            for (out, value) in predicted.iter_mut().zip(parent_scores) { *out += beta * value; }
        }
    }
    visiting.remove(target);
    Ok(predicted)
}

#[derive(Deserialize, Clone)]
#[serde(default)]
pub struct Options {
    pub k_folds: usize,
    pub repetitions: usize,
    pub seed: Option<u64>,
    pub antecedents: String,
    pub cvpat_resamples: usize,
    pub include_case_losses: bool,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            k_folds: 10,
            repetitions: 10,
            seed: Some(42),
            antecedents: "direct".into(),
            cvpat_resamples: 500,
            include_case_losses: false,
        }
    }
}
#[derive(Default, Clone)]
struct Accumulator {
    case_indices: Vec<usize>,
    actual: Vec<f64>,
    pls: Vec<f64>,
    lm: Vec<f64>,
    naive: Vec<f64>,
}

fn cvpat_comparison(pls: &[f64], benchmark: &[f64], resamples: usize, seed: Option<u64>, cancel: &AtomicBool) -> Result<Value, String> {
    if pls.len() != benchmark.len() || pls.len() < 2 || resamples < 2 { return Err("CVPAT requires paired losses and at least two resamples".into()); }
    let differences: Vec<_> = pls.iter().zip(benchmark).map(|(p, b)| p - b).collect();
    if differences.iter().any(|d| !d.is_finite()) { return Err("CVPAT losses must be finite".into()); }
    let mean = stats::mean(&differences, None);
    let n = differences.len();
    let mut random = rng::Pcg64::from_optional_seed(seed)?;
    let mut bootstrap_means = Vec::with_capacity(resamples);
    for _ in 0..resamples {
        if cancel.load(Ordering::Relaxed) { return Err("CVPAT cancelled by user".into()); }
        let mut sum = 0.0;
        for _ in 0..n { sum += differences[random.bounded(n as u64)? as usize] - mean; }
        bootstrap_means.push(sum / n as f64);
    }
    let se = stats::std(&bootstrap_means, None, 1);
    let statistic = if se > 1e-12 { Some(mean / se) } else { None };
    let p = statistic.map(|t| inference::student_t_cdf(t, (n - 1) as f64));
    Ok(json!({"n":n,"mean_pls_loss":stats::mean(pls,None),"mean_benchmark_loss":stats::mean(benchmark,None),"mean_difference":mean,"standard_error":if se > 1e-12 { Some(se) } else { None },"t_statistic":statistic,"p_one_sided":p,"hypothesis":"PLS loss is lower"}))
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
    if options.k_folds < 2 || options.k_folds > n || options.repetitions == 0 || options.cvpat_resamples < 2 {
        return Err("Invalid prediction folds, repetitions, or CVPAT resample count".into());
    }
    if !["direct", "early"].contains(&options.antecedents.as_str()) { return Err("Prediction antecedents must be direct or early".into()); }
    for (target, _) in &endogenous { earliest_antecedents(target, &parsed.paths, &mut HashSet::new())?; }
    let k = options.k_folds;
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
                        .as_f64().ok_or_else(|| format!("Prediction weight is unavailable for {cid}: {iid}"))?;
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
            for (target, preds) in &endogenous {
                let mut predicted = vec![0.0; size];
                if options.antecedents == "early" {
                    predicted = predicted_score(target, &parsed.paths, &holdout_scores, &result["structural"]["path_coefficients"], size, &mut HashSet::new())?;
                } else { for source in preds {
                    // Structural coefficients are indexed target -> source.
                    // Intentional correction shared with the Python reference.
                    let beta = result["structural"]["path_coefficients"][target][source]
                        .as_f64().ok_or_else(|| format!("Prediction path is unavailable for {source} → {target}"))?;
                    for (i, value) in predicted.iter_mut().enumerate() {
                        *value += beta * holdout_scores[source][i].as_f64().unwrap_or(0.0);
                    }
                }}
                let predictor_ids = if options.antecedents == "early" { earliest_antecedents(target, &parsed.paths, &mut HashSet::new())? } else { preds.clone() };
                let mut benchmark_indices = Vec::new();
                for (id, inds) in &groups { if predictor_ids.contains(id) { for (_, col) in inds {
                    let index = needed.iter().position(|c| c == col).unwrap();
                    if !benchmark_indices.contains(&index) { benchmark_indices.push(index); }
                }}}
                let mut design = vec![vec![1.0; train.len()]];
                design.extend(benchmark_indices.iter().map(|&j| train.iter().map(|&i| clean[i][j]).collect()));
                let group = &groups
                    .iter()
                    .find(|(cid, _)| cid == target)
                    .ok_or("Unknown prediction target")?
                    .1;
                for (iid, col) in group {
                    let j = needed.iter().position(|c| c == col).unwrap();
                    let lambda = result["measurement"]["outer_loadings"][target][iid]
                        .as_f64().ok_or_else(|| format!("Prediction loading is unavailable for {target}: {iid}"))?;
                    let fit = if benchmark_indices.is_empty() {
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
                                    + benchmark_indices
                                        .iter()
                                        .enumerate()
                                        .map(|(c, &j)| beta[c + 1] * clean[i][j])
                                        .sum::<f64>()
                            })
                            .unwrap_or(means[j]);
                        accum[j].actual.push(clean[i][j]);
                        accum[j].case_indices.push(i);
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
            q2s.push(q2);
            indicators.push(json!({"indicator":col,"construct":target,"q2_predict":q2,"q2_predict_positive":q2 > 0.0,
                "rmse_pls":rmse_pls,"rmse_lm":rmse_lm,"rmse_diff":rmse_pls-rmse_lm,
                "mae_pls":mae_pls,"mae_lm":mae_lm,"mae_diff":mae_pls-mae_lm,"pls_beats_lm":better}));
        }
        if !q2s.is_empty() {
            let classification = verdict(better_count, q2s.len());
            let description = match classification { "high"=>"High predictive power: PLS-SEM outperforms LM for all indicators.","medium"=>"Medium predictive power: PLS-SEM outperforms LM for the majority of indicators.","low"=>"Low predictive power: PLS-SEM outperforms LM for a minority of indicators.",_=>"No predictive power: LM outperforms PLS-SEM for all indicators." };
            constructs.insert(target.clone(),json!({"construct":target,"n_indicators":q2s.len(),"n_pls_beats_lm":better_count,"predictive_power":classification,"description":description,"mean_q2_predict":stats::mean(&q2s,None)}));
        }
    }
    let cv_seeds = rng::seed_sequence(&rng::integer_entropy(options.seed.unwrap_or(42)), (endogenous.len() + 1) * 2);
    let mut cvpat_constructs = Vec::new();
    let mut overall_pls = vec![0.0; n];
    let mut overall_lm = vec![0.0; n];
    let mut overall_naive = vec![0.0; n];
    for (group_index, (target, _)) in endogenous.iter().enumerate() {
        let group = &groups.iter().find(|(id, _)| id == target).ok_or("Unknown prediction target")?.1;
        if group.is_empty() { return Err(format!("No prediction indicators for {target}")); }
        let mut losses_pls = vec![0.0; n];
        let mut losses_lm = vec![0.0; n];
        let mut losses_naive = vec![0.0; n];
        for (_, col) in group {
            let j = needed.iter().position(|c| c == col).ok_or("Prediction indicator not found")?;
            let accumulator = &accum[j];
            let mut counts = vec![0usize; n];
            let mut predicted_pls = vec![0.0; n];
            let mut predicted_lm = vec![0.0; n];
            let mut predicted_naive = vec![0.0; n];
            for (index, &case) in accumulator.case_indices.iter().enumerate() {
                counts[case] += 1;
                predicted_pls[case] += accumulator.pls[index];
                predicted_lm[case] += accumulator.lm[index];
                predicted_naive[case] += accumulator.naive[index];
            }
            for i in 0..n {
                if counts[i] != options.repetitions { return Err("Incomplete repeated predictions for CVPAT".into()); }
                let count = counts[i] as f64;
                losses_pls[i] += (clean[i][j] - predicted_pls[i] / count).powi(2) / group.len() as f64;
                losses_lm[i] += (clean[i][j] - predicted_lm[i] / count).powi(2) / group.len() as f64;
                losses_naive[i] += (clean[i][j] - predicted_naive[i] / count).powi(2) / group.len() as f64;
            }
        }
        for i in 0..n {
            overall_pls[i] += losses_pls[i] / endogenous.len() as f64;
            overall_lm[i] += losses_lm[i] / endogenous.len() as f64;
            overall_naive[i] += losses_naive[i] / endogenous.len() as f64;
        }
        cvpat_constructs.push(json!({"construct":target,
            "versus_indicator_mean":cvpat_comparison(&losses_pls, &losses_naive, options.cvpat_resamples, Some(cv_seeds[group_index * 2] as u64), cancel)?,
            "versus_linear_model":cvpat_comparison(&losses_pls, &losses_lm, options.cvpat_resamples, Some(cv_seeds[group_index * 2 + 1] as u64), cancel)?}));
    }
    let seed_index = endogenous.len() * 2;
    let cvpat = json!({"resamples":options.cvpat_resamples,"loss":"mean squared prediction error", "constructs":cvpat_constructs,
        "overall":{"versus_indicator_mean":cvpat_comparison(&overall_pls, &overall_naive, options.cvpat_resamples, Some(cv_seeds[seed_index] as u64), cancel)?,
        "versus_linear_model":cvpat_comparison(&overall_pls, &overall_lm, options.cvpat_resamples, Some(cv_seeds[seed_index+1] as u64), cancel)?}});
    let mut output = json!({"k_folds":k,"repetitions":options.repetitions,"n_samples":n,"antecedents":options.antecedents,"warning":warning,
        "indicator_metrics":indicators,"construct_summary":constructs,"overall_predictive_power":verdict(total_better,indicators.len()),"cvpat":cvpat,
        "interpretation":{"high":"PLS-SEM has higher predictive power than LM on all indicator benchmarks.","medium":"PLS-SEM outperforms LM on majority of indicator benchmarks.","low":"PLS-SEM outperforms LM on minority of indicator benchmarks.","none":"No predictive power: LM benchmark matches or exceeds PLS-SEM across indicators."}});
    if options.include_case_losses { output["_case_losses"] = json!(overall_pls); }
    Ok(output)
}

/// Compare models on the same cases, outcome indicator groups and random folds.
pub fn compare(columns: Vec<String>, rows: Vec<Vec<Value>>, specs: [Value; 2], settings: Value, mut options: Options) -> Result<Value, String> {
    let parsed = [model::parse(&specs[0])?, model::parse(&specs[1])?];
    let outcome_groups = |m: &model::ParsedModel| -> Result<Vec<Vec<String>>, String> {
        let mut groups = Vec::new();
        for block in &m.blocks {
            if m.paths.iter().any(|p| p[1] == block.id) {
                let mut group: Vec<String> = block.indicators.iter().map(|id| m.indicators.iter().find(|(iid, _)| iid == id).map(|(_, col)| col.clone()).ok_or_else(|| format!("Unknown indicator {id}"))).collect::<Result<_, _>>()?;
                group.sort(); groups.push(group);
            }
        }
        groups.sort(); Ok(groups)
    };
    let outcomes = outcome_groups(&parsed[0])?;
    if outcomes.is_empty() || outcomes != outcome_groups(&parsed[1])? { return Err("The models must predict the same outcome indicator groups for a paired comparison.".into()); }
    let mut used = Vec::new();
    for model in &parsed { for (id, col) in &model.indicators { if model.blocks.iter().any(|block| block.indicators.contains(id)) && !used.contains(col) { used.push(col.clone()); } } }
    let indices: Vec<_> = used.iter().map(|c| columns.iter().position(|x| x == c).ok_or_else(|| format!("Dataset is missing indicator {c}"))).collect::<Result<_, _>>()?;
    let cfg = model::settings(&settings)?;
    let missing: Vec<_> = cfg["missing_codes"].as_array().unwrap().iter().map(model::numeric).filter(|v| v.is_finite()).collect();
    if rows.iter().any(|r| r.len() != columns.len()) { return Err("Dataset row width differs from columns".into()); }
    let common: Vec<_> = rows.into_iter().filter(|row| indices.iter().all(|&i| { let value = model::numeric(&row[i]); value.is_finite() && !missing.contains(&value) })).collect();
    options.include_case_losses = true;
    let first = run(columns.clone(), common.clone(), specs[0].clone(), settings.clone(), options.clone())?;
    let second = run(columns, common, specs[1].clone(), settings, options.clone())?;
    let losses = |result: &Value| -> Result<Vec<f64>, String> { result["_case_losses"].as_array().ok_or("Missing prediction losses")?.iter().map(|v| v.as_f64().ok_or_else(|| "Invalid prediction loss".to_owned())).collect() };
    let a = losses(&first)?; let b = losses(&second)?;
    let test = cvpat_comparison(&a, &b, options.cvpat_resamples, options.seed, &AtomicBool::new(false))?;
    Ok(json!({"n_samples":a.len(),"k_folds":options.k_folds,"repetitions":options.repetitions,"antecedents":options.antecedents,"outcome_indicator_groups":outcomes,"comparison":test,"first_indicator_metrics":first["indicator_metrics"],"second_indicator_metrics":second["indicator_metrics"]}))
}

#[cfg(test)]
mod cvpat_tests {
    use super::*;
    #[test]
    fn earliest_prediction_propagates_through_mediators_and_excludes_unrelated_roots() {
        let paths = vec![["A".into(), "M".into()], ["M".into(), "Y".into()], ["A".into(), "Y".into()], ["Z".into(), "W".into()]];
        assert_eq!(earliest_antecedents("Y", &paths, &mut HashSet::new()).unwrap(), vec!["A"]);
        let scores = json!({"A":[2.0, 4.0], "M":[99.0, 99.0]}).as_object().unwrap().clone();
        let coefficients = json!({"M":{"A":0.5}, "Y":{"M":0.4, "A":0.3}});
        let predicted = predicted_score("Y", &paths, &scores, &coefficients, 2, &mut HashSet::new()).unwrap();
        assert!((predicted[0] - 1.0).abs() < 1e-12);
        assert!((predicted[1] - 2.0).abs() < 1e-12);
        let cycle = vec![["A".into(), "M".into()], ["M".into(), "A".into()]];
        assert!(earliest_antecedents("A", &cycle, &mut HashSet::new()).is_err());
    }
    #[test]
    fn paired_test_preserves_direction_and_handles_zero_variance() {
        let cancel = AtomicBool::new(false);
        let pls = [1.0, 2.0, 3.0, 4.0, 1.5, 2.5];
        let benchmark = [4.0, 5.0, 7.0, 6.0, 4.0, 8.0];
        let better = cvpat_comparison(&pls, &benchmark, 500, Some(42), &cancel).unwrap();
        let worse = cvpat_comparison(&benchmark, &pls, 500, Some(42), &cancel).unwrap();
        assert!(better["mean_difference"].as_f64().unwrap() < 0.0);
        assert!(better["p_one_sided"].as_f64().unwrap() < 0.05);
        assert!(worse["p_one_sided"].as_f64().unwrap() > 0.95);
        assert_eq!(better, cvpat_comparison(&pls, &benchmark, 500, Some(42), &cancel).unwrap());
        let equal = cvpat_comparison(&pls, &pls, 10, Some(42), &cancel).unwrap();
        assert!(equal["p_one_sided"].is_null());
    }
}
