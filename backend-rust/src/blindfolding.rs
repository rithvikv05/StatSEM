//! Omission-round Q² and q² effects, composed from native PLS.
use crate::{model, pipeline, stats};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Deserialize)]
#[serde(default)]
pub struct Options {
    pub omission_distance: usize,
    pub compute_q2_effects: bool,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            omission_distance: 7,
            compute_q2_effects: true,
        }
    }
}
struct Context {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    indicator_positions: Vec<usize>,
    groups: Vec<(String, String, Vec<usize>)>,
    indicator_ids: Vec<String>,
    endogenous: Vec<String>,
    settings: Value,
    distance: usize,
}
fn rounded(value: f64) -> f64 {
    value
}
impl Context {
    fn pass(
        &self,
        spec: &Value,
        cancel: &AtomicBool,
        progress: Option<&(dyn Fn(usize, usize) + Sync)>,
    ) -> Result<Value, String> {
        let n = self.rows.len();
        let k = self.indicator_positions.len();
        let raw: Vec<Vec<f64>> = self
            .rows
            .iter()
            .map(|r| {
                self.indicator_positions
                    .iter()
                    .map(|&j| model::numeric(&r[j]))
                    .collect()
            })
            .collect();
        let mut owner = vec![0; k];
        for (g, (_, _, inds)) in self.groups.iter().enumerate() {
            for &i in inds {
                owner[i] = g;
            }
        }
        let parsed = model::parse(spec)?;
        let mut sse_red = vec![0.0; k];
        let mut sso_red = vec![0.0; k];
        let mut sse_comm = vec![0.0; k];
        let mut sso_comm = vec![0.0; k];
        for d in 0..self.distance {
            if cancel.load(Ordering::Relaxed) {
                return Err("Blindfolding calculation cancelled by user.".into());
            }
            if let Some(progress) = progress {
                progress(d, self.distance);
            }
            let mut round = self.rows.clone();
            let mut means = vec![0.0; k];
            let mut scales = vec![1.0; k];
            for j in 0..k {
                let retained: Vec<_> = (0..n)
                    .filter(|&i| (i * k + j) % self.distance != d && !raw[i][j].is_nan())
                    .map(|i| raw[i][j])
                    .collect();
                means[j] = if retained.is_empty() {
                    0.0
                } else {
                    stats::mean(&retained, None)
                };
                scales[j] = if retained.is_empty() {
                    1.0
                } else {
                    stats::std(&retained, None, 0).max(1e-6)
                };
                for i in 0..n {
                    if (i * k + j) % self.distance == d && !raw[i][j].is_nan() {
                        round[i][self.indicator_positions[j]] = json!(means[j]);
                    }
                }
            }
            let mut settings = self.settings.clone();
            settings["missing_treatment"] = json!("mean");
            let result =
                pipeline::run_without_fit(self.columns.clone(), round, spec.clone(), settings)?;
            for j in 0..k {
                let cid = &self.groups[owner[j]].0;
                let col = &self.columns[self.indicator_positions[j]];
                let lambda = result["measurement"]["outer_loadings"][cid][&self.indicator_ids[j]]
                    .as_f64()
                    .or_else(|| result["measurement"]["outer_loadings"][cid][col].as_f64())
                    .unwrap_or(0.0);
                let preds: Vec<_> = parsed
                    .paths
                    .iter()
                    .filter(|[_, to]| to == cid)
                    .map(|[from, _]| from)
                    .collect();
                for i in 0..n {
                    if (i * k + j) % self.distance == d && !raw[i][j].is_nan() {
                        let score = result["construct_scores"][cid]
                            .as_array()
                            .map(|v| {
                                v.get(i)
                                    .and_then(Value::as_f64)
                                    .ok_or("Blindfolding score length mismatch")
                            })
                            .transpose()?
                            .unwrap_or(0.0);
                        let predicted = means[j] + scales[j] * lambda * score;
                        sse_comm[j] += (raw[i][j] - predicted).powi(2);
                        sso_comm[j] += (raw[i][j] - means[j]).powi(2);
                        if !preds.is_empty() && self.endogenous.contains(cid) {
                            let predicted_score: f64 = preds
                                .iter()
                                .map(|from| {
                                    result["structural"]["path_coefficients"][cid][*from]
                                        .as_f64()
                                        .unwrap_or(0.0)
                                        * result["construct_scores"][*from][i]
                                            .as_f64()
                                            .unwrap_or(0.0)
                                })
                                .sum();
                            let predicted = means[j] + scales[j] * lambda * predicted_score;
                            sse_red[j] += (raw[i][j] - predicted).powi(2);
                            sso_red[j] += (raw[i][j] - means[j]).powi(2);
                        }
                    }
                }
            }
        }
        let mut constructs = serde_json::Map::new();
        let mut indicators = Vec::new();
        for (cid, name, inds) in &self.groups {
            let endogenous = self.endogenous.contains(cid);
            let red_sse: f64 = inds.iter().map(|&i| sse_red[i]).sum();
            let red_sso: f64 = inds.iter().map(|&i| sso_red[i]).sum();
            let comm_sse: f64 = inds.iter().map(|&i| sse_comm[i]).sum();
            let comm_sso: f64 = inds.iter().map(|&i| sso_comm[i]).sum();
            let qred = if endogenous && red_sso > 1e-12 {
                Some(1.0 - red_sse / red_sso)
            } else {
                None
            };
            let qcomm = if comm_sso > 1e-12 {
                Some(1.0 - comm_sse / comm_sso)
            } else {
                None
            };
            constructs.insert(cid.clone(),json!({"construct_id":cid,"construct_name":name,"is_endogenous":endogenous,
                "sso":rounded(if endogenous { red_sso } else { comm_sso }),"sse":rounded(if endogenous { red_sse } else { comm_sse }),
                "q2":qred.or(qcomm).map(rounded),"sso_redundancy":if endogenous { Some(rounded(red_sso)) } else { None },
                "sse_redundancy":if endogenous { Some(rounded(red_sse)) } else { None },"q2_redundancy":qred.map(rounded),"predictive_relevance":qred.map(|v| v > 0.0),
                "sso_communality":rounded(comm_sso),"sse_communality":rounded(comm_sse),"q2_communality":qcomm.map(rounded)}));
            for &i in inds {
                let qred = if endogenous && sso_red[i] > 1e-12 {
                    Some(1.0 - sse_red[i] / sso_red[i])
                } else {
                    None
                };
                let qcomm = if sso_comm[i] > 1e-12 {
                    Some(1.0 - sse_comm[i] / sso_comm[i])
                } else {
                    None
                };
                indicators.push(json!({"indicator":self.columns[self.indicator_positions[i]],"indicator_id":self.indicator_ids[i],"construct_id":cid,
                    "sso_redundancy":if endogenous { Some(rounded(sso_red[i])) } else { None },"sse_redundancy":if endogenous { Some(rounded(sse_red[i])) } else { None },
                    "q2_redundancy":qred.map(rounded),"sso_communality":rounded(sso_comm[i]),"sse_communality":rounded(sse_comm[i]),"q2_communality":qcomm.map(rounded)}));
            }
        }
        Ok(json!({"constructs":constructs,"indicators":indicators}))
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
    let mut all_cols = Vec::new();
    let mut reflective = Vec::new();
    let mut groups = Vec::new();
    for block in &parsed.blocks {
        let mut indices = Vec::new();
        for iid in &block.indicators {
            let col = &parsed
                .indicators
                .iter()
                .find(|(id, _)| id == iid)
                .unwrap()
                .1;
            let actual = columns.iter().find(|c| *c == col).or_else(|| {
                columns
                    .iter()
                    .rev()
                    .find(|c| c.trim().to_lowercase() == col.trim().to_lowercase())
            });
            if let Some(column) = actual {
                if !all_cols.contains(column) {
                    all_cols.push(column.clone());
                }
                if block.measurement_type == "reflective" {
                    let index = if let Some(i) = reflective.iter().position(|c| c == column) {
                        i
                    } else {
                        reflective.push(column.clone());
                        reflective.len() - 1
                    };
                    if !indices.contains(&index) {
                        indices.push(index);
                    }
                }
            }
        }
        if !indices.is_empty() {
            groups.push((
                block.id.clone(),
                block.name.clone().unwrap_or(block.id.clone()),
                indices,
            ));
        }
    }
    if groups.is_empty() {
        return Err(
            "No reflective constructs with matching dataset columns found for blindfolding.".into(),
        );
    }
    let codes: Vec<_> = cfg["missing_codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(model::numeric)
        .collect();
    let positions: Vec<_> = all_cols
        .iter()
        .map(|c| columns.iter().position(|v| v == c).unwrap())
        .collect();
    let reflective_positions: Vec<_> = reflective
        .iter()
        .map(|c| all_cols.iter().position(|v| v == c).unwrap())
        .collect();
    let mut clean: Vec<Vec<f64>> = rows
        .iter()
        .map(|r| {
            positions
                .iter()
                .map(|&j| {
                    let v = model::numeric(&r[j]);
                    if codes.contains(&v) {
                        f64::NAN
                    } else {
                        v
                    }
                })
                .collect()
        })
        .collect();
    if cfg["missing_treatment"] == "mean" {
        for j in 0..all_cols.len() {
            let observed: Vec<_> = clean.iter().map(|r| r[j]).filter(|v| !v.is_nan()).collect();
            let mean = stats::mean(&observed, None);
            for row in &mut clean {
                if row[j].is_nan() {
                    row[j] = mean;
                }
            }
        }
    } else {
        clean.retain(|r| reflective_positions.iter().all(|&j| !r[j].is_nan()));
    }
    let n = clean.len();
    let d = options.omission_distance;
    if !(5..=10).contains(&d) {
        return Err(format!(
            "Omission distance D must be between 5 and 10 (got {d})."
        ));
    }
    if n.is_multiple_of(d) {
        let valid = (5..=10)
            .filter(|distance| !n.is_multiple_of(*distance))
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!("Omission distance D={d} is invalid because N/D is an integer ({n}/{d} = {}). Suggested valid omission distances for N={n}: {valid}",n/d));
    }
    let endo: Vec<_> = groups
        .iter()
        .filter(|(id, _, _)| parsed.paths.iter().any(|[_, to]| to == id))
        .map(|(id, _, _)| id.clone())
        .collect();
    let ids: Vec<_> = reflective
        .iter()
        .map(|column| {
            parsed
                .indicators
                .iter()
                .rev()
                .find(|(_, col)| col == column)
                .map(|(id, _)| id.clone())
                .unwrap_or(column.clone())
        })
        .collect();
    let context = Context {
        columns: all_cols,
        rows: clean
            .iter()
            .map(|r| r.iter().map(|v| json!(v)).collect())
            .collect(),
        indicator_positions: reflective_positions,
        groups,
        indicator_ids: ids,
        endogenous: endo,
        settings: cfg,
        distance: d,
    };
    let base = context.pass(&spec, cancel, Some(progress))?;
    let mut effects = Vec::new();
    if options.compute_q2_effects {
        let mut targets: Vec<String> = Vec::new();
        for [_, to] in &parsed.paths {
            if context.endogenous.contains(to) && !targets.contains(to) {
                targets.push(to.clone());
            }
        }
        for target in targets {
            let Some(included) = base["constructs"][&target]["q2_redundancy"]
                .as_f64()
                .filter(|v| *v < 1.0)
            else {
                continue;
            };
            for [source, _] in parsed.paths.iter().filter(|[_, to]| to == &target) {
                let mut reduced = spec.clone();
                reduced["paths"] = json!(spec["paths"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(
                        |p| !(model::alias(p, &["from", "from_node"]) == Some(source)
                            && model::alias(p, &["to", "to_node"]) == Some(&target))
                    )
                    .collect::<Vec<_>>());
                let reduced = context.pass(&reduced, cancel, None)?;
                let excluded = reduced["constructs"][&target]["q2_redundancy"]
                    .as_f64()
                    .unwrap_or(0.0);
                let effect = ((included - excluded) / (1.0 - included)).max(0.0);
                let (label, rating) = if effect >= 0.35 {
                    ("large", "Large")
                } else if effect >= 0.15 {
                    ("medium", "Medium")
                } else if effect >= 0.02 {
                    ("small", "Small")
                } else {
                    ("none", "None")
                };
                let name = |id: &String| {
                    parsed
                        .blocks
                        .iter()
                        .find(|b| &b.id == id)
                        .and_then(|b| b.name.clone())
                        .unwrap_or(id.clone())
                };
                effects.push(json!({"target":name(&target),"target_id":target,"source":name(source),"predictor":name(source),"predictor_id":source,
                    "q2_included":rounded(included),"q2_excluded":rounded(excluded),"q2_effect_size":rounded(effect),"q2_effect":rounded(effect),"magnitude":label,"rating":rating}));
            }
        }
    }
    let constructs: Vec<_> = context
        .groups
        .iter()
        .map(|(id, _, _)| base["constructs"][id].clone())
        .collect();
    Ok(
        json!({"omission_distance":d,"n_samples":n,"constructs":constructs,"indicators":base["indicators"],"q2_effects":effects,"q2_effect_sizes":effects,"thresholds":{},
        "notes":["Q^2 > 0 indicates predictive relevance of the endogenous construct (Stone 1974; Geisser 1974; Hair et al. 2017).","q^2 values of 0.02, 0.15, and 0.35 signify small, medium, and large effect sizes (Hair et al. 2017)."]}),
    )
}
