//! Model parsing and resolved settings matching the ordinary PLS pipeline.
use crate::pls::Block;
use serde_json::{json, Value};

pub fn default_settings() -> Value {
    json!({"inner_weighting":"path", "max_iter":3000, "tolerance":1e-7,
        "initial_weights":"equal", "individual_initial_weights":null,
        "missing_treatment":"mean", "missing_codes":[-99,"-99"], "weight_column":null,
        "consistent":false, "sign_convention":"dominant", "moderation_method":"two_stage",
        "hcm_method":"repeated_indicators", "significance_level":0.05, "tails":"two",
        "ci_method":"percentile", "sign_change":"none", "dataset_id":null,
        "gc":{"ecdf":"F4", "copula_transform":"raw", "stage2_method":"pls", "round_decimals":12, "scale_normalization":"unscaled"}})
}

pub fn settings(input: &Value) -> Result<Value, String> {
    let mut resolved = default_settings();
    if input.is_null() {
        return Ok(resolved);
    }
    let provided = input.as_object().ok_or("Settings must be an object")?;
    for (key, value) in provided {
        if key == "gc" {
            for (key, value) in value.as_object().ok_or("gc settings must be an object")? {
                if resolved["gc"].get(key).is_some() {
                    resolved["gc"][key] = value.clone();
                }
            }
        } else if resolved.get(key).is_some() {
            resolved[key] = value.clone();
        }
    }
    for (key, choices) in [
        ("inner_weighting", vec!["path", "factor", "centroid"]),
        (
            "initial_weights",
            vec!["equal", "lohmoller", "individual", "sum_scores"],
        ),
        (
            "missing_treatment",
            vec!["mean", "listwise", "none", "pairwise", "em", "knn"],
        ),
        ("sign_convention", vec!["dominant", "none"]),
        (
            "moderation_method",
            vec!["two_stage", "product_indicator", "orthogonalizing"],
        ),
        ("hcm_method", vec!["repeated_indicators", "two_stage"]),
        ("tails", vec!["two", "one"]),
        (
            "ci_method",
            vec!["percentile", "bias_corrected", "bca", "studentized"],
        ),
        ("sign_change", vec!["none", "individual", "construct"]),
    ] {
        if !resolved[key].as_str().is_some_and(|v| choices.contains(&v)) {
            return Err(format!("Invalid setting: {key}"));
        }
    }
    let iterations = numeric(&resolved["max_iter"]);
    if !iterations.is_finite() || iterations.fract() != 0.0 || !(0.0..=5000.0).contains(&iterations)
    {
        return Err("Invalid max_iter".into());
    }
    resolved["max_iter"] = json!(iterations as usize);
    for key in ["tolerance", "significance_level"] {
        let value = numeric(&resolved[key]);
        if !value.is_finite()
            || value <= 0.0
            || (key == "tolerance" && value > 0.01)
            || (key == "significance_level" && value >= 0.5)
        {
            return Err(format!("Invalid {key}"));
        }
        resolved[key] = json!(value);
    }
    if !resolved["missing_codes"].is_array() {
        return Err("missing_codes must be an array".into());
    }
    if !resolved["consistent"].is_boolean() {
        resolved["consistent"] = match resolved["consistent"]
            .as_str()
            .map(str::to_lowercase)
            .as_deref()
        {
            Some("true" | "1" | "yes" | "on") => json!(true),
            Some("false" | "0" | "no" | "off") => json!(false),
            _ => return Err("Invalid consistent flag".into()),
        };
    }
    for (key, choices) in [
        ("ecdf", vec!["F4", "F3"]),
        ("copula_transform", vec!["raw", "eq17"]),
        ("stage2_method", vec!["pls", "ols"]),
        ("scale_normalization", vec!["unscaled", "standardized"]),
    ] {
        if !resolved["gc"][key]
            .as_str()
            .is_some_and(|v| choices.contains(&v))
        {
            return Err(format!("Invalid gc setting: {key}"));
        }
    }
    Ok(resolved)
}

pub fn numeric(value: &Value) -> f64 {
    match value {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Value::String(s) => s.trim().parse().unwrap_or(f64::NAN),
        _ => f64::NAN,
    }
}
pub fn alias<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .filter_map(|k| value[*k].as_str())
        .find(|s| !s.is_empty())
}

pub struct ParsedModel {
    pub blocks: Vec<Block>,
    pub indicators: Vec<(String, String)>,
    pub paths: Vec<[String; 2]>,
}

pub struct AnalysisRows {
    pub rows: Vec<Vec<Value>>,
    pub retained: Option<Vec<usize>>,
    pub has_missing: bool,
}
pub fn prepare_analysis_rows(
    columns: &[String],
    rows: Vec<Vec<Value>>,
    spec: &Value,
    settings: &Value,
) -> Result<AnalysisRows, String> {
    if rows.iter().any(|r| r.len() != columns.len()) {
        return Err("Dataset row width differs from columns".into());
    }
    let parsed = parse(spec)?;
    let mut required = Vec::new();
    for block in &parsed.blocks {
        for iid in &block.indicators {
            let col = &parsed
                .indicators
                .iter()
                .find(|(id, _)| id == iid)
                .unwrap()
                .1;
            if let Some(j) = columns.iter().position(|c| c == col).or_else(|| {
                columns
                    .iter()
                    .rposition(|c| c.trim().to_lowercase() == col.trim().to_lowercase())
            }) {
                if !required.contains(&j) {
                    required.push(j);
                }
            }
        }
    }
    let codes: Vec<_> = settings["missing_codes"]
        .as_array()
        .ok_or("Missing codes must be an array")?
        .iter()
        .map(numeric)
        .filter(|v| !v.is_nan())
        .collect();
    let valid = |row: &Vec<Value>| {
        required.iter().all(|&j| {
            let value = numeric(&row[j]);
            !value.is_nan() && !codes.contains(&value)
        })
    };
    let has_missing = rows.iter().any(|row| !valid(row));
    if settings["missing_treatment"] == "none" && has_missing {
        return Err("Missing values found in model indicators; choose a missing-data treatment or provide complete data.".into());
    }
    if settings["missing_treatment"] == "listwise" {
        let retained: Vec<_> = rows
            .iter()
            .enumerate()
            .filter(|(_, r)| valid(r))
            .map(|(i, _)| i)
            .collect();
        let rows = retained.iter().map(|&i| rows[i].clone()).collect();
        Ok(AnalysisRows {
            rows,
            retained: Some(retained),
            has_missing,
        })
    } else {
        Ok(AnalysisRows {
            rows,
            retained: None,
            has_missing,
        })
    }
}
pub fn parse(spec: &Value) -> Result<ParsedModel, String> {
    let constructs = spec["constructs"]
        .as_array()
        .ok_or("Model needs a constructs array")?;
    let mut blocks: Vec<Block> = Vec::new();
    for c in constructs {
        let id = c["id"]
            .as_str()
            .ok_or("Construct needs a string ID")?
            .to_string();
        let formative = c["type"]
            .as_str()
            .unwrap_or("reflective")
            .to_lowercase()
            .contains("formative");
        let outer_mode = c["outer_mode"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| {
                if s.to_uppercase().contains('B') {
                    "B"
                } else {
                    "A"
                }
            })
            .unwrap_or(if formative { "B" } else { "A" });
        let mut metadata = c.get("metadata").cloned().unwrap_or(Value::Null);
        if (metadata.is_null() || metadata.as_object().is_some_and(|m| m.is_empty()))
            && id.contains(" x ")
        {
            let parts: Vec<_> = id.split(" x ").collect();
            metadata = json!({"moderator":parts[0].trim(),"predictor":parts[1].trim(),"outcome":"","method":"two_stage"});
        }
        let block = Block {
            id: id.clone(),
            name: c
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or(Some(id.clone())),
            measurement_type: if formative {
                "formative".into()
            } else {
                "reflective".into()
            },
            indicators: c["indicators"]
                .as_array()
                .map(|v| {
                    v.iter()
                        .map(|v| v.as_str().unwrap_or("").to_string())
                        .collect()
                })
                .unwrap_or_default(),
            weighting: c["weighting"].as_str().unwrap_or("estimated").into(),
            predefined_weights: c
                .get("predefined_weights")
                .filter(|v| !v.is_null())
                .map(|v| serde_json::from_value(v.clone()))
                .transpose()
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            outer_mode: Some(outer_mode.into()),
            is_interaction: c["is_interaction"].as_bool().unwrap_or(false) || id.contains(" x "),
            metadata: if metadata.is_null() {
                None
            } else {
                Some(metadata)
            },
            data: Vec::new(),
        };
        if let Some(i) = blocks.iter().position(|b| b.id == id) {
            blocks[i] = block;
        } else {
            blocks.push(block);
        }
    }
    let mut indicators: Vec<(String, String)> = Vec::new();
    for i in spec["indicators"].as_array().into_iter().flatten() {
        let id = alias(i, &["id", "name", "column"])
            .unwrap_or("None")
            .to_string();
        let column = alias(i, &["column", "name"]).unwrap_or(&id).to_string();
        if let Some(index) = indicators.iter().position(|(iid, _)| iid == &id) {
            indicators[index].1 = column;
        } else {
            indicators.push((id, column));
        }
    }
    for block in &blocks {
        for id in &block.indicators {
            if !indicators.iter().any(|(iid, _)| iid == id) {
                indicators.push((id.clone(), id.clone()));
            }
        }
    }
    let paths = spec["paths"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            Some([
                alias(p, &["from", "from_node", "source"])?.to_string(),
                alias(p, &["to", "to_node", "target"])?.to_string(),
            ])
        })
        .collect();
    Ok(ParsedModel {
        blocks,
        indicators,
        paths,
    })
}
