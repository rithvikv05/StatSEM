//! Sequential prediction-oriented segmentation. Global scores are invariant
//! across candidate moves and are fitted once instead of once per segment/move.
use crate::{fimix, matrix::round, model, pipeline, rng};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    sync::atomic::{AtomicBool, Ordering},
};

#[derive(Clone, Deserialize)]
#[serde(default)]
pub struct Options {
    pub n_segments: usize,
    pub initial_separation: String,
    pub fimix_assignments: Option<Vec<usize>>,
    pub criterion: String,
    pub optimization_criterion: Option<String>,
    pub target_construct: Option<String>,
    pub pre_segmentation: bool,
    pub search_depth: Option<usize>,
    pub max_iter: Option<usize>,
    pub min_segment_size: usize,
    pub n_repetitions: usize,
    pub seed: Option<u64>,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            n_segments: 2,
            initial_separation: "random".into(),
            fimix_assignments: None,
            criterion: "weighted_r2".into(),
            optimization_criterion: None,
            target_construct: None,
            pre_segmentation: false,
            search_depth: None,
            max_iter: None,
            min_segment_size: 15,
            n_repetitions: 10,
            seed: Some(42),
        }
    }
}
struct Objective {
    value: f64,
    models: Vec<Value>,
    weighted: Value,
}
impl Objective {
    fn invalid() -> Self {
        Self {
            value: f64::NEG_INFINITY,
            models: Vec::new(),
            weighted: json!({}),
        }
    }
}
struct Context<'a> {
    columns: &'a [String],
    rows: &'a [Vec<Value>],
    spec: &'a Value,
    settings: &'a Value,
    scores: &'a Value,
    targets: Vec<(String, Vec<String>)>,
    o: &'a Options,
    cancel: &'a AtomicBool,
}
impl Context<'_> {
    fn evaluate(&self, assignments: &[usize]) -> Objective {
        let n = self.rows.len();
        let s = self.o.n_segments;
        let mut sizes = Vec::new();
        let mut models = Vec::new();
        for segment in 0..s {
            let rows: Vec<_> = self
                .rows
                .iter()
                .zip(assignments)
                .filter(|(_, a)| **a == segment)
                .map(|(r, _)| r.clone())
                .collect();
            sizes.push(rows.len());
            if rows.len() < 3 {
                return Objective::invalid();
            }
            match pipeline::run_without_fit(
                self.columns.to_vec(),
                rows,
                self.spec.clone(),
                self.settings.clone(),
            ) {
                Ok(result) => models.push(result),
                Err(_) => return Objective::invalid(),
            }
        }
        let mut weighted = serde_json::Map::new();
        for (target, _) in &self.targets {
            let value = models
                .iter()
                .zip(&sizes)
                .map(|(model, &size)| {
                    size as f64 / n as f64
                        * model["structural"]["r_squared"][target]
                            .as_f64()
                            .unwrap_or(0.0)
                })
                .sum::<f64>();
            weighted.insert(target.clone(), json!(round(value, 4)));
        }
        let value = if self.o.criterion == "sum_r2" {
            models
                .iter()
                .map(|model| {
                    self.targets
                        .iter()
                        .map(|(id, _)| model["structural"]["r_squared"][id].as_f64().unwrap_or(0.0))
                        .sum::<f64>()
                })
                .sum()
        } else if self.o.criterion == "target_r2"
            && self
                .o
                .target_construct
                .as_ref()
                .is_some_and(|id| !id.is_empty())
        {
            weighted
                .get(self.o.target_construct.as_ref().unwrap())
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
        } else {
            weighted.values().map(|v| v.as_f64().unwrap()).sum()
        };
        Objective {
            value,
            models,
            weighted: Value::Object(weighted),
        }
    }
    fn distances(&self, models: &[Value]) -> Result<Vec<Vec<f64>>, String> {
        let n = self.rows.len();
        let mut distance = vec![vec![0.0; self.o.n_segments]; n];
        for (s, model) in models.iter().enumerate() {
            for (target, pred) in &self.targets {
                let actual = self.scores[target]
                    .as_array()
                    .ok_or("POS target scores missing")?;
                if actual.len() != n {
                    return Err("POS score row count differs from prepared dataset".into());
                }
                let mut predicted = vec![0.0; n];
                for source in pred {
                    let coefficient = model["structural"]["path_coefficients"][target][source]
                        .as_f64()
                        .unwrap_or(0.0);
                    let scores = self.scores[source]
                        .as_array()
                        .ok_or("POS predictor scores missing")?;
                    for (p, x) in predicted.iter_mut().zip(scores) {
                        *p += coefficient * crate::model::numeric(x);
                    }
                }
                for i in 0..n {
                    distance[i][s] += (crate::model::numeric(&actual[i]) - predicted[i]).powi(2);
                }
            }
        }
        Ok(distance)
    }
    fn single(&self, mut assignments: Vec<usize>, pre: bool) -> Result<Value, String> {
        let n = self.rows.len();
        let s = self.o.n_segments;
        if assignments.len() != n || assignments.iter().any(|&a| a >= s) {
            return Err("Invalid POS initial partition".into());
        }
        let mut current = self.evaluate(&assignments);
        if current.models.is_empty() || current.value == f64::NEG_INFINITY {
            return Ok(json!({"objective":null,"converged":false,"iterations":0}));
        }
        let mut history = vec![round(current.value, 4)];
        let mut converged = false;
        if pre {
            let dist = self.distances(&current.models)?;
            let pre_assign: Vec<_> = dist.iter().map(|row| argmin(row)).collect();
            if (0..s)
                .all(|s| pre_assign.iter().filter(|&&a| a == s).count() >= self.o.min_segment_size)
            {
                let next = self.evaluate(&pre_assign);
                if next.value > current.value {
                    assignments = pre_assign;
                    current = next;
                    history.push(round(current.value, 4));
                }
            }
        }
        for _ in 0..self.o.max_iter.unwrap_or(1000.max(2 * n)) {
            if self.cancel.load(Ordering::Relaxed) {
                return Err("PLS-POS cancelled by user.".into());
            }
            let dist = self.distances(&current.models)?;
            let mut candidates = Vec::new();
            for i in 0..n {
                let source = assignments[i];
                let others: Vec<_> = (0..s).filter(|&s| s != source).collect();
                let values: Vec<_> = others.iter().map(|&s| dist[i][s]).collect();
                let target = others[argmin(&values)];
                let improvement = dist[i][source] - dist[i][target];
                if improvement > 1e-6 {
                    candidates.push((i, source, target, improvement));
                }
            }
            if candidates.is_empty() {
                converged = true;
                break;
            }
            candidates.sort_by(|a, b| b.3.total_cmp(&a.3));
            candidates.truncate(self.o.search_depth.unwrap_or(n).min(n));
            let mut moved = false;
            for (i, source, target, _) in candidates {
                if assignments.iter().filter(|&&a| a == source).count() <= self.o.min_segment_size {
                    continue;
                }
                assignments[i] = target;
                let next = self.evaluate(&assignments);
                if next.value > current.value + 1e-7 {
                    current = next;
                    history.push(round(current.value, 4));
                    moved = true;
                    break;
                }
                assignments[i] = source;
            }
            if !moved {
                converged = true;
                break;
            }
        }
        let mut segments = Vec::new();
        for s in 0..s {
            let size = assignments.iter().filter(|&&a| a == s).count();
            segments.push(json!({"segment":s+1,"sample_size":size,"relative_size":round(size as f64/n as f64,4),"r_squared":rounded_map(&current.models[s]["structural"]["r_squared"]),"path_coefficients":current.models[s]["structural"]["path_coefficients"]}));
        }
        let mut diffs = serde_json::Map::new();
        for (target, pred) in current.models[0]["structural"]["path_coefficients"]
            .as_object()
            .ok_or("POS structural results missing")?
        {
            let mut row = serde_json::Map::new();
            for (source, b1) in pred.as_object().ok_or("POS path map invalid")? {
                row.insert(
                    source.clone(),
                    json!(round(
                        b1.as_f64().unwrap_or(0.0)
                            - current.models[1]["structural"]["path_coefficients"][target][source]
                                .as_f64()
                                .unwrap_or(0.0),
                        4
                    )),
                );
            }
            diffs.insert(target.clone(), Value::Object(row));
        }
        Ok(
            json!({"objective":current.value,"objective_history":history,"converged":converged,"iterations":history.len()-1,"assignments":assignments,"segments":segments,"signed_path_differences":diffs,"weighted_r_squared":current.weighted}),
        )
    }
}
fn argmin(row: &[f64]) -> usize {
    let mut best = 0;
    for i in 1..row.len() {
        if row[i] < row[best] || row[i].is_nan() && !row[best].is_nan() {
            best = i;
        }
    }
    best
}
fn rounded_map(value: &Value) -> Value {
    Value::Object(
        value
            .as_object()
            .into_iter()
            .flatten()
            .map(|(k, v)| (k.clone(), json!(round(v.as_f64().unwrap_or(f64::NAN), 4))))
            .collect(),
    )
}

pub fn run(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    settings: Value,
    mut o: Options,
    cancel: &AtomicBool,
    progress: &(dyn Fn(usize) + Sync),
) -> Result<Value, String> {
    if o.n_segments < 2 {
        return Err("PLS-POS requires at least 2 segments.".into());
    }
    if let Some(criterion) = &o.optimization_criterion {
        let lower = criterion.to_lowercase();
        o.criterion = if lower.contains("weight") {
            "weighted_r2".into()
        } else if lower.contains("sum") {
            "sum_r2".into()
        } else if lower.contains("target") {
            "target_r2".into()
        } else {
            criterion.clone()
        };
    }
    let cfg = model::settings(&settings)?;
    let prepared = model::prepare_analysis_rows(&columns, rows, &spec, &cfg)?;
    let rows = prepared.rows;
    let n = rows.len();
    let parsed = model::parse(&spec)?;
    let targets_set: BTreeSet<_> = parsed
        .paths
        .iter()
        .map(|[_, target]| target.clone())
        .collect();
    let mut targets = Vec::new();
    for target in targets_set {
        let mut preds = Vec::new();
        for [from, to] in &parsed.paths {
            if to == &target && !preds.contains(from) {
                preds.push(from.clone());
            }
        }
        targets.push((target, preds));
    }
    let global =
        pipeline::run_without_fit(columns.clone(), rows.clone(), spec.clone(), cfg.clone())?;
    let global_r2 = rounded_map(&global["structural"]["r_squared"]);
    let scores = global
        .get("construct_scores")
        .unwrap_or(&global["results_pls_original"]["construct_scores"]);
    let context = Context {
        columns: &columns,
        rows: &rows,
        spec: &spec,
        settings: &cfg,
        scores,
        targets,
        o: &o,
        cancel,
    };
    let mut best = Value::Null;
    let mut objective = f64::NEG_INFINITY;
    if o.initial_separation == "fimix" {
        let assignments = if let Some(a) = o.fimix_assignments.as_ref().filter(|a| a.len() == n) {
            a.clone()
        } else {
            let result = fimix::run(
                columns.clone(),
                rows.clone(),
                spec.clone(),
                cfg.clone(),
                fimix::Options {
                    min_segments: o.n_segments,
                    max_segments: o.n_segments,
                    seed: o.seed,
                    ..fimix::Options::default()
                },
                cancel,
                &|_| {},
            )?;
            serde_json::from_value(result["case_assignments"].clone()).map_err(|e| e.to_string())?
        };
        let assignments = assignments
            .into_iter()
            .map(|v| {
                v.checked_sub(1)
                    .ok_or("FIMIX assignments must be one-based")
            })
            .collect::<Result<_, _>>()?;
        best = context.single(assignments, false)?;
        objective = best["objective"].as_f64().unwrap_or(f64::NEG_INFINITY);
    } else {
        let reps = o.n_repetitions.max(1);
        let mut random = rng::Pcg64::from_optional_seed(o.seed)?;
        for rep in 0..reps {
            if cancel.load(Ordering::Relaxed) {
                return Err("PLS-POS cancelled by user.".into());
            }
            let mut partition = None;
            for _ in 0..50 {
                let a: Vec<_> = (0..n)
                    .map(|_| random.bounded(o.n_segments as u64).map(|v| v as usize))
                    .collect::<Result<_, _>>()?;
                if (0..o.n_segments)
                    .all(|s| a.iter().filter(|&&i| i == s).count() >= o.min_segment_size)
                {
                    partition = Some(a);
                    break;
                }
            }
            let partition = partition.unwrap_or_else(|| (0..n).map(|i| i % o.n_segments).collect());
            let result = context.single(partition, o.pre_segmentation)?;
            let value = result["objective"].as_f64().unwrap_or(f64::NEG_INFINITY);
            if value > objective {
                objective = value;
                best = result;
            }
            progress((rep + 1) * 100 / reps);
        }
    }
    if best.is_null() || objective == f64::NEG_INFINITY {
        return Err("PLS-POS failed to establish a valid segment solution.".into());
    }
    let substantial = global_r2.as_object().unwrap().iter().all(|(k, v)| {
        best["weighted_r_squared"][k].as_f64().unwrap_or(0.0) >= v.as_f64().unwrap_or(0.0)
    });
    let assignments: Vec<usize> =
        serde_json::from_value(best["assignments"].clone()).map_err(|e| e.to_string())?;
    let assignments: Vec<_> = assignments.iter().map(|a| a + 1).collect();
    let mut result = json!({"n_segments":o.n_segments,"n_samples":n,"initial_separation":o.initial_separation,"optimization_criterion":o.criterion,"converged":best["converged"],"iterations":best["iterations"],"final_objective":round(objective,4),"objective_history":best["objective_history"],"segments":best["segments"],"segment_sample_sizes":best["segments"].as_array().unwrap().iter().map(|s|s["sample_size"].clone()).collect::<Vec<_>>(),"signed_path_differences":best["signed_path_differences"],"weighted_r_squared":best["weighted_r_squared"],"full_sample_r_squared":global_r2,
        "quality_judgement":if substantial {"PLS-POS segmentation substantially improves variance explained (weighted R^2 exceeds global sample R^2)."} else {"Heterogeneity appears modest; segment-specific R^2 values are comparable to the full sample."},"case_assignments":assignments,"segment_assignments":assignments,"note":"PLS-POS reallocates cases using distance measures to maximize overall predictive power (Hair et al. 2018; Squillacciotti 2005)."});
    if let Some(retained) = prepared.retained {
        result["retained_case_indices"] = json!(retained);
    }
    Ok(result)
}
