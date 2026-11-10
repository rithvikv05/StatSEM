//! Repeated-indicator, disjoint two-stage and collect-type HCM analysis.
use crate::{matrix, model, moderation, pipeline, pls, stats};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct Options {
    pub hoc_id: String,
    pub loc_ids: Vec<String>,
    #[serde(default = "default_type")]
    pub hoc_type: String,
    #[serde(default = "default_approach")]
    pub approach: String,
    pub inner_weighting: Option<String>,
}
fn default_type() -> String {
    "RR".into()
}
fn default_approach() -> String {
    "repeated_indicators".into()
}
fn formative(kind: &str) -> bool {
    kind == "RF" || kind == "FF"
}
fn endpoint(p: &Value, from: bool) -> &str {
    model::alias(
        p,
        if from {
            &["from", "from_node"]
        } else {
            &["to", "to_node"]
        },
    )
    .unwrap_or("")
}
fn scores(result: &Value) -> &Value {
    result
        .get("construct_scores")
        .unwrap_or(&result["results_pls_original"]["construct_scores"])
}
fn score(result: &Value, id: &str) -> Result<Vec<f64>, String> {
    scores(result)[id]
        .as_array()
        .ok_or_else(|| format!("HCM score vector '{id}' missing"))
        .map(|v| v.iter().map(model::numeric).collect())
}
fn new_spec(spec: &Value) -> Value {
    json!({"constructs":spec["constructs"],"indicators":spec.get("indicators").cloned().unwrap_or(json!([])),"paths":spec.get("paths").cloned().unwrap_or(json!([]))})
}
fn hoc_construct(o: &Options, indicators: Vec<String>) -> Value {
    json!({"id":o.hoc_id,"name":o.hoc_id,"type":if formative(&o.hoc_type) {"formative"} else {"reflective"},"outer_mode":if formative(&o.hoc_type) {"B"} else {"A"},"order":"higher","components":o.loc_ids,"hoc_type":o.hoc_type,"indicators":indicators})
}
pub fn repeated_spec(spec: &Value, o: &Options) -> Result<(Value, Vec<String>), String> {
    let parsed = model::parse(spec)?;
    let mut locs = Vec::new();
    let mut indicators = Vec::new();
    for id in &o.loc_ids {
        if let Some(block) = parsed.blocks.iter().find(|b| &b.id == id) {
            let columns: Vec<_> = block
                .indicators
                .iter()
                .map(|iid| {
                    parsed
                        .indicators
                        .iter()
                        .find(|(id, _)| id == iid)
                        .unwrap()
                        .1
                        .clone()
                })
                .collect();
            for col in &columns {
                if !indicators.contains(col) {
                    indicators.push(col.clone());
                }
            }
            locs.push((id, columns.len()));
        }
    }
    let mut warnings = Vec::new();
    if locs
        .first()
        .is_some_and(|(_, n)| locs.iter().any(|(_, m)| n != m))
    {
        let counts = format!(
            "{{{}}}",
            locs.iter()
                .map(|(id, n)| format!("'{id}': {n}"))
                .collect::<Vec<_>>()
                .join(", ")
        );
        warnings.push(format!("LOC indicator counts are unequal ({counts}). The HOC will be disproportionately biased toward the LOC with more indicators. Consider equalizing indicators or using the two-stage approach (Hair et al. 2018)."));
    }
    let external: Vec<_> = spec["paths"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| {
            endpoint(p, false) == o.hoc_id && !o.loc_ids.iter().any(|id| id == endpoint(p, true))
        })
        .map(|p| endpoint(p, true))
        .collect();
    if formative(&o.hoc_type) && !external.is_empty() {
        let ants = format!(
            "[{}]",
            external
                .iter()
                .map(|id| format!("'{id}'"))
                .collect::<Vec<_>>()
                .join(", ")
        );
        warnings.push(format!("INADMISSIBLE SETUP (Exhibit 2.12): Formative HOC '{}' has external antecedent constructs ({ants}). The LOCs will explain almost 100% of the HOC variance (R² ≈ 1.0), forcing antecedent paths near zero and rendering them non-significant. Use the Becker et al. (2012) total effects analysis or the two-stage approach instead.",o.hoc_id));
    }
    let mut result = new_spec(spec);
    let mut found = false;
    for c in result["constructs"].as_array_mut().unwrap() {
        if c["id"] == o.hoc_id {
            let replacement = hoc_construct(o, indicators.clone());
            for (key, value) in replacement.as_object().unwrap() {
                if key != "id" && key != "name" {
                    c[key] = value.clone();
                }
            }
            found = true;
        }
    }
    if !found {
        result["constructs"]
            .as_array_mut()
            .unwrap()
            .push(hoc_construct(o, indicators));
    }
    for loc in &o.loc_ids {
        let (from, to) = if formative(&o.hoc_type) {
            (loc.as_str(), o.hoc_id.as_str())
        } else {
            (o.hoc_id.as_str(), loc.as_str())
        };
        moderation::add_path(&mut result, from, to);
    }
    Ok((result, warnings))
}
fn collect_spec(spec: &Value, o: &Options) -> Value {
    let mut result = new_spec(spec);
    let mut ants = Vec::new();
    let mut targets = Vec::new();
    for p in spec["paths"].as_array().into_iter().flatten() {
        let from = endpoint(p, true);
        let to = endpoint(p, false);
        if to == o.hoc_id && !o.loc_ids.iter().any(|id| id == from) && !ants.contains(&from) {
            ants.push(from);
        } else if from == o.hoc_id && !o.loc_ids.iter().any(|id| id == to) && !targets.contains(&to)
        {
            targets.push(to);
        }
    }
    for ant in ants {
        for loc in &o.loc_ids {
            moderation::add_path(&mut result, ant, loc);
        }
    }
    for target in targets {
        for loc in &o.loc_ids {
            moderation::add_path(&mut result, loc, target);
        }
    }
    result
}
pub fn reliability(loadings: &[f64], corr: &[Vec<f64>]) -> Value {
    if loadings.is_empty() {
        return json!({"ave":0.0,"composite_reliability":0.0,"cronbachs_alpha":0.0});
    }
    let squared: Vec<_> = loadings.iter().map(|v| v * v).collect();
    let sum = stats::numpy_sum(loadings);
    let error: Vec<_> = squared.iter().map(|v| 1.0 - v).collect();
    let denominator = sum * sum + stats::numpy_sum(&error);
    let cr = if denominator > 1e-12 {
        sum * sum / denominator
    } else {
        0.0
    };
    let m = loadings.len();
    let alpha = if m > 1 && corr.len() > 1 {
        let off: Vec<_> = (0..m)
            .flat_map(|i| ((i + 1)..m).map(move |j| corr[i][j]))
            .collect();
        let r = stats::mean(&off, None);
        m as f64 * r / (1.0 + (m as f64 - 1.0) * r)
    } else {
        1.0
    };
    json!({"ave":stats::mean(&squared,None),"composite_reliability":cr,"cronbachs_alpha":alpha})
}
fn vifs(ids: &[String], cols: &[Vec<f64>]) -> Value {
    Value::Object(
        ids.iter()
            .zip(pls::vif(cols))
            .map(|(id, v)| (id.clone(), json!(v)))
            .collect(),
    )
}

pub fn run(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    settings: Value,
    o: Options,
) -> Result<Value, String> {
    let mut cfg = model::settings(&settings)?;
    if let Some(scheme) = &o.inner_weighting {
        cfg["inner_weighting"] = json!(scheme);
    } else if cfg["inner_weighting"] == "centroid" {
        return Err("Centroid weighting is not supported for Hierarchical Component Models (A18-HCM-07). Please select 'factor' (recommended by Hair et al. 2018) or 'path' weighting.".into());
    }
    let mut premature = Vec::new();
    if cfg["inner_weighting"] == "path" {
        premature.push(if !formative(&o.hoc_type) {"Lohmöller caution: Mode A for LOCs and HOC with LOC -> HOC relationships and path weighting can exhibit premature convergence depending on initial starting values. Factor weighting is recommended."} else {"Lohmöller caution: Mode A for LOCs and Mode B for HOC with HOC -> LOC relationships and path weighting can exhibit premature convergence. Factor weighting is recommended (Hair et al. 2018)."}.to_owned());
    }
    if o.approach == "two_stage" {
        return two_stage(columns, rows, spec, cfg, o);
    }
    let base = if o.approach == "total_effects" {
        collect_spec(&spec, &o)
    } else {
        spec
    };
    let (expanded, mut warnings) = repeated_spec(&base, &o)?;
    warnings.extend(premature);
    let result = pipeline::run(columns, rows, expanded, cfg)?;
    let loc_scores: Vec<_> = o
        .loc_ids
        .iter()
        .map(|id| score(&result, id))
        .collect::<Result<_, _>>()?;
    if o.approach == "total_effects" {
        let effects: Vec<_> = result["structural"]["effects"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|v| v["to"] == o.hoc_id)
            .cloned()
            .collect();
        return Ok(
            json!({"hoc_id":o.hoc_id,"loc_ids":o.loc_ids,"hoc_type":o.hoc_type,"approach":"total_effects","warnings":warnings,"hoc_total_effects":effects,"loc_vifs":vifs(&o.loc_ids,&loc_scores),"results":result}),
        );
    }
    let hoc = score(&result, &o.hoc_id)?;
    let mut loadings = serde_json::Map::new();
    let mut values = Vec::new();
    for (id, score) in o.loc_ids.iter().zip(&loc_scores) {
        let correlation = if stats::std(&hoc, None, 0) > 1e-12 && stats::std(score, None, 0) > 1e-12
        {
            stats::correlation(&hoc, score, None)
        } else {
            1.0
        };
        values.push(correlation);
        loadings.insert(id.clone(), json!(correlation));
    }
    let corr = matrix::correlation_rows(&matrix::transpose(&loc_scores));
    let metrics = reliability(&values, &corr);
    let mut assessment = json!({"hoc_type":o.hoc_type,"approach":"repeated_indicators","hoc_loc_loadings":loadings,"manual_ave":metrics["ave"],"manual_composite_reliability":metrics["composite_reliability"],"manual_cronbachs_alpha":metrics["cronbachs_alpha"],
        "loc_correlation_supports_reflective":if o.loc_ids.len()>=2 {corr[0][1]>0.5} else {true},"outer_weights":result["measurement"]["outer_weights"][&o.hoc_id],"outer_loadings":result["measurement"]["outer_loadings"][&o.hoc_id]});
    if formative(&o.hoc_type) {
        assessment["loc_collinearity_vif"] = vifs(&o.loc_ids, &loc_scores);
    }
    Ok(
        json!({"hoc_id":o.hoc_id,"loc_ids":o.loc_ids,"hoc_type":o.hoc_type,"approach":"repeated_indicators","warnings":warnings,"hoc_assessment":assessment,"results":result}),
    )
}

fn two_stage(
    mut columns: Vec<String>,
    mut rows: Vec<Vec<Value>>,
    spec: Value,
    cfg: Value,
    o: Options,
) -> Result<Value, String> {
    let mut stage1 = new_spec(&spec);
    stage1["constructs"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c["id"] != o.hoc_id);
    let mut paths = Vec::new();
    for p in spec["paths"].as_array().into_iter().flatten() {
        let from = endpoint(p, true);
        let to = endpoint(p, false);
        if from == o.hoc_id {
            for loc in &o.loc_ids {
                paths.push(json!({"from":loc,"to":to}));
            }
        } else if to == o.hoc_id {
            for loc in &o.loc_ids {
                paths.push(json!({"from":from,"to":loc}));
            }
        } else {
            paths.push(p.clone());
        }
    }
    stage1["paths"] = json!(paths);
    let result1 = pipeline::run(columns.clone(), rows.clone(), stage1.clone(), cfg.clone())?;
    let mut hoc_inds = Vec::new();
    let mut loc_scores = Vec::new();
    for loc in &o.loc_ids {
        let scores = score(&result1, loc)?;
        let mean = stats::mean(&scores, None);
        let sd = stats::std(&scores, None, 0);
        let sd = if sd == 0.0 { 1.0 } else { sd };
        let values: Vec<_> = scores.iter().map(|v| (v - mean) / sd).collect();
        let col = format!("score_{loc}");
        moderation::assign(&mut columns, &mut rows, &col, &values)?;
        loc_scores.push(values);
        hoc_inds.push(col);
    }
    stage1["constructs"]
        .as_array_mut()
        .unwrap()
        .retain(|c| !o.loc_ids.iter().any(|id| c["id"] == *id));
    stage1["constructs"]
        .as_array_mut()
        .unwrap()
        .push(hoc_construct(&o, hoc_inds.clone()));
    stage1["paths"] = json!(spec["paths"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| !o
            .loc_ids
            .iter()
            .any(|id| id == endpoint(p, true) || id == endpoint(p, false)))
        .cloned()
        .collect::<Vec<_>>());
    stage1["indicators"].as_array_mut().unwrap().retain(|i| {
        !o.loc_ids
            .iter()
            .any(|id| model::alias(i, &["construct_id", "construct"]) == Some(id))
    });
    for col in &hoc_inds {
        stage1["indicators"]
            .as_array_mut()
            .unwrap()
            .push(json!({"name":col,"construct_id":o.hoc_id}));
    }
    let result2 = pipeline::run(columns, rows, stage1, cfg)?;
    let mut assessment = json!({"hoc_type":o.hoc_type,"approach":"two_stage","loc_indicators":hoc_inds,"outer_weights":result2["measurement"]["outer_weights"][&o.hoc_id],"outer_loadings":result2["measurement"]["outer_loadings"][&o.hoc_id]});
    if formative(&o.hoc_type) {
        if o.loc_ids.len() > 1 {
            assessment["collinearity_vif"] = vifs(&o.loc_ids, &loc_scores);
        }
    } else {
        for metric in ["cronbachs_alpha", "composite_reliability", "ave"] {
            assessment[metric] = result2["reliability_and_validity"][metric][&o.hoc_id].clone();
        }
    }
    Ok(
        json!({"hoc_id":o.hoc_id,"loc_ids":o.loc_ids,"hoc_type":o.hoc_type,"approach":"two_stage","hoc_assessment":assessment,"stage1_results":result1,"stage2_results":result2,"stage2_structural":result2["structural"],"stage2_scores":scores(&result2)}),
    )
}
