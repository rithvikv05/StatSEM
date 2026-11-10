//! Single-group analyses composed from the verified pipeline and bootstrap.
use crate::{bootstrap, inference, matrix, model, pipeline, stats};
use serde::Deserialize;
use serde_json::{json, Map, Value};

pub fn classify(
    indirect: bool,
    direct: bool,
    indirect_coef: f64,
    direct_coef: f64,
) -> (&'static str, &'static str) {
    match (indirect,direct) {
        (true,true) if indirect_coef*direct_coef > 0.0 => ("Complementary (partial mediation)","Both indirect and direct effects are significant and point in the same direction. The mediator partially explains the relationship between source and target."),
        (true,true) => ("Competitive (partial mediation)","Both indirect and direct effects are significant but point in opposite directions. The mediator acts as a suppressor variable."),
        (true,false) => ("Indirect-only (full mediation)","The indirect effect is significant while the direct effect is not. The mediator fully accounts for the relationship between source and target."),
        (false,true) => ("Direct-only (no mediation)","The direct effect is significant while the indirect effect is not. There is no evidence of mediation via the proposed path."),
        _ => ("No-effect (no mediation)","Neither the direct effect nor the indirect effect is significant. There is no relationship between source and target."),
    }
}
fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}
fn r(v: f64) -> f64 {
    matrix::round(v, 4)
}
fn effect_stat(coefficient: f64, stat: &Value, alpha: f64) -> Value {
    let p = stat["p_value"].as_f64().unwrap_or(1.0);
    json!({"coefficient":r(coefficient),"standard_error":r(num(&stat["standard_error"])),"t_statistic":r(num(&stat["t_statistic"])),
        "p_value":r(p),"ci_lower":r(num(&stat["ci_lower"])),"ci_upper":r(num(&stat["ci_upper"])),"is_significant":p < alpha})
}
#[derive(Deserialize)]
#[serde(default)]
pub struct MediationOptions {
    pub n_boot: usize,
    pub seed: Option<u64>,
    pub alpha: f64,
    pub include_sobel: bool,
}
impl Default for MediationOptions {
    fn default() -> Self {
        Self {
            n_boot: 500,
            seed: Some(42),
            alpha: 0.05,
            include_sobel: false,
        }
    }
}
pub fn mediation(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    source: String,
    target: String,
    settings: Value,
    options: MediationOptions,
) -> Result<Value, String> {
    if source.is_empty() || target.is_empty() {
        return Err("Both source and target constructs must be specified.".into());
    }
    let cfg = model::settings(&settings)?;
    let main = pipeline::run(columns.clone(), rows.clone(), spec.clone(), cfg.clone())?;
    let direct = num(&main["structural"]["path_coefficients"][&target][&source]);
    let specific: Vec<_> = main["effects_decomposition"]["specific_indirect"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["source"] == source && p["target"] == target)
        .cloned()
        .collect();
    let indirect: f64 = specific.iter().map(|p| num(&p["effect"])).sum();
    let total = direct + indirect;
    let bootstrap = bootstrap::run(
        columns.clone(),
        rows.clone(),
        spec.clone(),
        bootstrap::Options {
            n_boot: options.n_boot,
            seed: options.seed,
            scheme: cfg["inner_weighting"].as_str().unwrap().into(),
            significance_level: options.alpha,
            ..bootstrap::Options::default()
        },
    )?;
    let summary = &bootstrap["parameter_summary"];
    let direct_stat = &summary[format!("path:{source}->{target}")];
    let indirect_stat = &summary[format!("total_indirect:{source}->{target}")];
    let direct_sig = direct_stat["p_value"].as_f64().unwrap_or(1.0) < options.alpha;
    let indirect_sig = indirect_stat["p_value"].as_f64().unwrap_or(1.0) < options.alpha;
    let mut entries = Vec::new();
    for path in &specific {
        let path_name = path["path"].as_str().unwrap_or("");
        let coefficient = num(&path["effect"]);
        let stat = &summary[format!("specific_indirect:{path_name}")];
        let p = stat["p_value"].as_f64().unwrap_or(1.0);
        let classification = classify(p < options.alpha, direct_sig, coefficient, direct);
        let mut entry = json!({"path":path_name,"path_nodes":path["path_nodes"],"original_effect":r(coefficient),
            "bootstrap_mean":r(stat["bootstrap_mean"].as_f64().unwrap_or(coefficient)),"standard_error":r(num(&stat["standard_error"])),
            "t_statistic":r(num(&stat["t_statistic"])),"p_value":r(p),"ci_lower":r(num(&stat["ci_lower"])),"ci_upper":r(num(&stat["ci_upper"])),
            "is_significant":p < options.alpha,"classification":classification.0,"interpretation":classification.1});
        if options.include_sobel
            && path["path_nodes"]
                .as_array()
                .is_some_and(|nodes| nodes.len() == 3)
        {
            let mediator = path["path_nodes"][1].as_str().unwrap_or("");
            let a = &summary[format!("path:{source}->{mediator}")];
            let b = &summary[format!("path:{mediator}->{target}")];
            if a.is_object() && b.is_object() {
                let a_coef = num(&a["original"]);
                let b_coef = num(&b["original"]);
                let denominator = (b_coef.powi(2) * num(&a["standard_error"]).powi(2)
                    + a_coef.powi(2) * num(&b["standard_error"]).powi(2))
                .max(1e-12)
                .sqrt();
                let z = a_coef * b_coef / denominator;
                let p = 2.0 * (1.0 - inference::normal_cdf(z.abs()));
                entry["sobel_test"] = json!({"z_statistic":r(z),"p_value":r(p),"is_significant":p < 0.05,
                    "warning":"The Sobel test assumes a normal distribution for the indirect product term, which is frequently violated in finite samples. Non-parametric bootstrapping (BCa confidence interval) is strongly recommended as the primary basis for inference."});
            }
        }
        entries.push(entry);
    }
    let classification = classify(indirect_sig, direct_sig, indirect, direct);
    let mut mediators = Vec::<String>::new();
    for path in &specific {
        if let Some(nodes) = path["path_nodes"].as_array() {
            for node in &nodes[1..nodes.len() - 1] {
                if let Some(id) = node.as_str() {
                    mediators.push(id.into());
                }
            }
        }
    }
    let mut reduced = spec.clone();
    reduced["paths"] = json!(spec["paths"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| {
            !model::alias(p, &["from", "from_node"])
                .is_some_and(|id| mediators.iter().any(|m| m == id))
                && !model::alias(p, &["to", "to_node"])
                    .is_some_and(|id| mediators.iter().any(|m| m == id))
        })
        .collect::<Vec<_>>());
    let auxiliary = pipeline::run(columns, rows, reduced, cfg)
        .ok()
        .map(|result| {
            r(num(
                &result["structural"]["path_coefficients"][&target][&source]
            ))
        });
    Ok(
        json!({"source":source,"target":target,"direct_effect":effect_stat(direct,direct_stat,options.alpha),
        "total_indirect_effect":effect_stat(indirect,indirect_stat,options.alpha),"total_effect":{"coefficient":r(total)},
        "direct_effect_without_mediators":auxiliary,"specific_indirect_effects":entries,"overall_classification":classification.0,"overall_interpretation":classification.1,
        "vaf_percentage":if total.abs() > 1e-12 { Some(matrix::round(indirect/total*100.0,2)) } else { None },
        "vaf_note":"VAF (Variance Accounted For) is reported for informational purposes; modern guidelines rely on bootstrap confidence intervals for classification (Zhao et al. 2010; Hair et al. 2017)."}),
    )
}

pub fn ipma(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    target: String,
    bounds: Value,
    level: String,
    settings: Value,
) -> Result<Value, String> {
    let result = pipeline::run(columns.clone(), rows.clone(), spec.clone(), settings)?;
    let parsed = model::parse(&spec)?;
    if !parsed.paths.iter().any(|[_, to]| to == &target) {
        return Err(format!(
            "IPMA target '{target}' is not an endogenous construct."
        ));
    }
    struct Indicator {
        col: String,
        iid: String,
        sd: f64,
        performance: f64,
        rescaled: Vec<f64>,
    }
    let mut indicators: Vec<Indicator> = Vec::new();
    let mut groups: Vec<(String, Vec<usize>)> = Vec::new();
    for block in &parsed.blocks {
        let mut used = Vec::new();
        for iid in &block.indicators {
            let col = &parsed
                .indicators
                .iter()
                .find(|(id, _)| id == iid)
                .unwrap()
                .1;
            let Some(j) = columns.iter().position(|c| c == col) else {
                continue;
            };
            let index = if let Some(index) = indicators.iter().position(|ind| &ind.col == col) {
                index
            } else {
                let iid = parsed
                    .indicators
                    .iter()
                    .rev()
                    .find(|(_, column)| column == col)
                    .map(|(id, _)| id.clone())
                    .unwrap_or(col.clone());
                let values: Vec<_> = rows
                    .iter()
                    .map(|r| model::numeric(&r[j]))
                    .filter(|v| !v.is_nan())
                    .collect();
                if values.is_empty() {
                    return Err("IPMA indicator has no valid values".into());
                }
                let range = bounds.get(col).or_else(|| bounds.get(&iid));
                let minimum = range
                    .and_then(|v| v[0].as_f64())
                    .unwrap_or_else(|| values.iter().copied().fold(f64::INFINITY, f64::min));
                let maximum = range
                    .and_then(|v| v[1].as_f64())
                    .unwrap_or_else(|| values.iter().copied().fold(f64::NEG_INFINITY, f64::max));
                let rescaled: Vec<_> = values
                    .iter()
                    .map(|v| {
                        ((v - minimum) / (maximum - minimum).max(1e-12) * 100.0).clamp(0.0, 100.0)
                    })
                    .collect();
                let sd = stats::std(&values, None, 0);
                let indicator = Indicator {
                    col: col.clone(),
                    iid,
                    sd: if sd == 0.0 { 1.0 } else { sd },
                    performance: stats::mean(&rescaled, None),
                    rescaled,
                };
                indicators.push(indicator);
                indicators.len() - 1
            };
            if !used.contains(&index) {
                used.push(index);
            }
        }
        groups.push((block.id.clone(), used));
    }
    let mut performances = Map::new();
    let mut deviations = Map::new();
    let mut unscaled = Map::new();
    let mut warnings = Vec::new();
    for (cid, indices) in &groups {
        if indices.is_empty() {
            continue;
        }
        let weights: Vec<_> = indices
            .iter()
            .map(|&i| {
                let ind = &indicators[i];
                result["measurement"]["outer_weights"][cid][&ind.iid]
                    .as_f64()
                    .or_else(|| result["measurement"]["outer_weights"][cid][&ind.col].as_f64())
                    .unwrap_or(0.0)
                    / ind.sd
            })
            .collect();
        let sum = stats::numpy_sum(&weights);
        let normalized: Vec<_> = if sum.abs() > 1e-12 {
            weights.iter().map(|w| w / sum).collect()
        } else {
            vec![1.0 / weights.len() as f64; weights.len()]
        };
        let mut map = Map::new();
        let n = indicators[indices[0]].rescaled.len();
        let mut score = vec![0.0; n];
        for (&index, &weight) in indices.iter().zip(&normalized) {
            let ind = &indicators[index];
            if ind.rescaled.len() != n {
                return Err("IPMA indicator lengths differ after dropping missing values".into());
            }
            map.insert(ind.col.clone(), json!(weight));
            if weight < 0.0 {
                warnings.push(format!("Indicator '{}' in construct '{}' has a negative unstandardized weight ({:?}). Verify indicator polarity/coding.",ind.col,cid,r(weight)));
            }
            for (value, x) in score.iter_mut().zip(&ind.rescaled) {
                *value += weight * x;
            }
        }
        for v in &mut score {
            *v = v.clamp(0.0, 100.0);
        }
        performances.insert(cid.clone(), json!(stats::mean(&score, None)));
        let sd = stats::std(&score, None, 0);
        deviations.insert(cid.clone(), json!(if sd == 0.0 { 1.0 } else { sd }));
        unscaled.insert(cid.clone(), Value::Object(map));
    }
    let target_perf = performances
        .get(&target)
        .ok_or("IPMA target scores unavailable")?;
    let target_sd = num(&deviations[&target]);
    let mut importance: Vec<(String, f64, f64)> = Vec::new();
    for effect in result["structural"]["effects"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|e| e["to"] == target)
    {
        let from = effect["from"].as_str().unwrap_or("").to_string();
        let coefficient = num(&effect["total"]);
        let sd = deviations.get(&from).and_then(Value::as_f64).unwrap_or(1.0);
        importance.push((from, coefficient * target_sd / sd, coefficient));
    }
    let mean_importance = if importance.is_empty() {
        0.0
    } else {
        stats::mean(
            &importance.iter().map(|(_, i, _)| *i).collect::<Vec<_>>(),
            None,
        )
    };
    let mean_performance = if importance.is_empty() {
        50.0
    } else {
        stats::mean(
            &importance
                .iter()
                .map(|(id, _, _)| num(&performances[id]))
                .collect::<Vec<_>>(),
            None,
        )
    };
    let mut constructs = Vec::new();
    let mut indicator_results = Vec::new();
    for (id, importance, standardized) in importance {
        let performance = num(&performances[&id]);
        let quadrant = match (
            importance >= mean_importance,
            performance >= mean_performance,
        ) {
            (true, false) => ("concentrate_here", "II"),
            (true, true) => ("keep_up_good_work", "I"),
            (false, false) => ("low_priority", "III"),
            _ => ("possible_overkill", "IV"),
        };
        let name = parsed
            .blocks
            .iter()
            .find(|b| b.id == id)
            .and_then(|b| b.name.as_ref())
            .unwrap_or(&id);
        constructs.push(json!({"construct_id":id,"construct_name":name,"importance":r(importance),"performance":r(performance),"importance_standardized":r(standardized),"quadrant":quadrant.0,"quadrant_number":quadrant.1}));
        if level == "indicator" || level == "both" {
            for &index in &groups.iter().find(|(cid, _)| cid == &id).unwrap().1 {
                let ind = &indicators[index];
                let weight = num(&unscaled[&id][&ind.col]);
                indicator_results.push(json!({"indicator":ind.col,"construct_id":id,"importance":r(importance*weight),"performance":r(ind.performance),"unstandardized_weight":r(weight)}));
            }
        }
    }
    Ok(
        json!({"target_construct":target,"target_performance":r(num(target_perf)),"mean_importance":r(mean_importance),"mean_performance":r(mean_performance),
        "constructs":constructs,"indicators":indicator_results,"warnings":warnings,"quadrant_definitions":{
            "concentrate_here":"Quadrant II: High Importance, Low Performance (Key area for improvement)","keep_up_good_work":"Quadrant I: High Importance, High Performance (Maintain current strength)",
            "low_priority":"Quadrant III: Low Importance, Low Performance (Secondary priority)","possible_overkill":"Quadrant IV: Low Importance, High Performance (Over-allocation of resources)"}}),
    )
}
