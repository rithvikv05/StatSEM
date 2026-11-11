//! Dataset-to-results pipeline for ordinary PLS/PLSc. Advanced model expansion
//! is routed explicitly, so unsupported expansion is never silently ignored.
use crate::{fit, matrix, model, pls, stats};
use serde_json::{json, Value};

pub fn run(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    input_settings: Value,
) -> Result<Value, String> {
    run_inner(columns, rows, spec, input_settings, true)
}

/// Internal analyses that need only scores/coefficients can omit the fit SVDs.
pub(crate) fn run_without_fit(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    settings: Value,
) -> Result<Value, String> {
    run_inner(columns, rows, spec, settings, false)
}
fn run_inner(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    input_settings: Value,
    compute_fit: bool,
) -> Result<Value, String> {
    if rows.iter().any(|r| r.len() != columns.len()) {
        return Err("Dataset row width differs from columns".into());
    }
    for keys in [["gaussian_copulas", "gaussianCopulas"]] {
        if keys
            .iter()
            .any(|key| spec[*key].as_array().is_some_and(|v| !v.is_empty()))
        {
            return crate::copula::run(columns, rows, spec, input_settings, compute_fit);
        }
    }
    if [
        "quadratic_effects",
        "quadraticEffects",
        "moderating_effects",
        "moderatingEffects",
    ]
    .iter()
    .any(|key| spec[*key].as_array().is_some_and(|v| !v.is_empty()))
    {
        return crate::quadratic::run(columns, rows, spec, input_settings, compute_fit);
    }
    let settings = model::settings(&input_settings)?;
    let cfg: pls::Settings = serde_json::from_value(settings.clone()).map_err(|e| e.to_string())?;
    let mut parsed = model::parse(&spec)?;
    let mut required: Vec<String> = Vec::new();
    for block in &parsed.blocks {
        for iid in &block.indicators {
            let (_, column) = parsed
                .indicators
                .iter_mut()
                .find(|(id, _)| id == iid)
                .ok_or("Unmapped indicator")?;
            if !columns.contains(column) {
                if let Some(matched) = columns
                    .iter()
                    .rev()
                    .find(|col| col.trim().to_lowercase() == column.trim().to_lowercase())
                {
                    *column = matched.clone();
                } else {
                    return Err(format!("Indicator '{iid}' mapped to column '{column}' not found in dataset columns."));
                }
            }
            if !required.contains(column) {
                required.push(column.clone());
            }
        }
    }
    let positions: Vec<_> = required
        .iter()
        .map(|col| columns.iter().position(|c| c == col).unwrap())
        .collect();
    let codes: Vec<_> = settings["missing_codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(model::numeric)
        .filter(|v| !v.is_nan())
        .collect();
    let mut numeric: Vec<Vec<f64>> = rows
        .iter()
        .map(|r| {
            positions
                .iter()
                .map(|&i| {
                    let value = model::numeric(&r[i]);
                    if codes.contains(&value) {
                        f64::NAN
                    } else {
                        value
                    }
                })
                .collect()
        })
        .collect();
    if settings["missing_treatment"] == "none" && numeric.iter().flatten().any(|v| v.is_nan()) {
        return Err("Missing values found in model indicators; choose a missing-data treatment or provide complete data.".into());
    }
    if settings["missing_treatment"] != "listwise" && settings["missing_treatment"] != "none" {
        for j in 0..required.len() {
            let observed: Vec<_> = numeric
                .iter()
                .map(|r| r[j])
                .filter(|v| !v.is_nan())
                .collect();
            let mean = stats::mean(&observed, None);
            if !mean.is_nan() {
                for row in &mut numeric {
                    if row[j].is_nan() {
                        row[j] = mean;
                    }
                }
            }
        }
    }
    let retained: Vec<_> = numeric
        .iter()
        .enumerate()
        .filter(|(_, r)| r.iter().all(|v| !v.is_nan()))
        .map(|(i, _)| i)
        .collect();
    let prepared: Vec<_> = retained.iter().map(|&i| numeric[i].clone()).collect();
    let n = prepared.len();
    if n < 5 {
        return Err(format!(
            "Insufficient valid data rows ({n}) for PLS-SEM estimation."
        ));
    }
    let weights = settings["weight_column"]
        .as_str()
        .and_then(|col| columns.iter().position(|c| c == col))
        .map(|j| {
            let raw: Vec<_> = retained
                .iter()
                .map(|&i| {
                    let w = model::numeric(&rows[i][j]);
                    if w.is_nan() {
                        1.0
                    } else {
                        w
                    }
                })
                .collect();
            let mean = stats::mean(&raw, None);
            if mean > 0.0 {
                raw.iter().map(|v| v / mean).collect()
            } else {
                vec![1.0; n]
            }
        });
    for block in &mut parsed.blocks {
        let indices: Vec<_> = block
            .indicators
            .iter()
            .map(|iid| {
                let col = &parsed
                    .indicators
                    .iter()
                    .find(|(id, _)| id == iid)
                    .unwrap()
                    .1;
                required.iter().position(|c| c == col).unwrap()
            })
            .collect();
        // Pandas homogeneous column blocks feed a Fortran-contiguous ndarray;
        // reduce each column using the already-verified contiguous vector path.
        let standardized: Vec<Vec<f64>> = indices
            .iter()
            .map(|&j| {
                let column: Vec<_> = prepared.iter().map(|r| r[j]).collect();
                let mean = stats::mean(&column, weights.as_deref());
                let sd = stats::std(&column, weights.as_deref(), 0);
                let sd = if sd == 0.0 { 1.0 } else { sd };
                column.iter().map(|v| (v - mean) / sd).collect()
            })
            .collect();
        block.data = matrix::transpose(&standardized);
    }
    let has_weights = weights.is_some();
    let mut result = pls::estimate(parsed.blocks.clone(), parsed.paths.clone(), cfg, weights)?;
    if settings["consistent"] == true {
        result = fit::plsc(result, &spec, n)?;
    }
    if compute_fit {
        result["fit"] = if has_weights {
            json!({"error":"Model fit indices for observation-weighted models are not available."})
        } else { match fit::evaluate(&required, &prepared, &spec, &result) {
            Ok(fit) => fit,
            Err(error) => json!({"error":error}),
        }};
    }
    if let Some(card) = redundancy(&parsed.blocks, &parsed.paths, &result) {
        result["convergent_validity_redundancy"] = card.clone();
        result["quality_criteria"] = json!({"convergent_validity_redundancy":card});
    }
    let mut names = serde_json::Map::new();
    for block in &parsed.blocks {
        let mut name = block.name.clone().unwrap_or_else(|| block.id.clone());
        if name.is_empty() || name.starts_with("node_") || name.to_uppercase().starts_with("LATENT")
        {
            let stems: Vec<_> = block
                .indicators
                .iter()
                .map(|iid| {
                    let column = &parsed
                        .indicators
                        .iter()
                        .find(|(id, _)| id == iid)
                        .unwrap()
                        .1;
                    let a = column.rsplit_once('_').map(|(a, _)| a).unwrap_or(column);
                    a.rsplit_once('-').map(|(a, _)| a).unwrap_or(a).to_string()
                })
                .collect();
            if !stems.is_empty()
                && stems
                    .iter()
                    .all(|s| s.to_uppercase() == stems[0].to_uppercase())
            {
                name = stems[0].to_uppercase();
            }
        }
        names.insert(
            block.id.clone(),
            json!(if name.is_empty() { &block.id } else { &name }),
        );
    }
    result["algorithm"] = json!("pls");
    result["construct_names"] = Value::Object(names);
    // Output names use the resolved indicator-column mapping, like Python.
    result["indicator_names"] = Value::Object(
        parsed
            .indicators
            .into_iter()
            .map(|(i, c)| (i, json!(c)))
            .collect(),
    );
    result["settings"] = settings;
    Ok(result)
}

fn redundancy(blocks: &[pls::Block], paths: &[[String; 2]], result: &Value) -> Option<Value> {
    if paths.is_empty() {
        return None;
    }
    let mut rows = Vec::new();
    for [source, target] in paths {
        let src = blocks.iter().find(|b| &b.id == source)?;
        let tgt = blocks.iter().find(|b| &b.id == target)?;
        if (src.measurement_type != "formative" && src.outer_mode.as_deref() != Some("B"))
            || src.indicators.len() < 2
            || tgt.indicators.len() != 1
            || paths.iter().filter(|[_, t]| t == source).count() != 0
            || paths.iter().filter(|[s, _]| s == source).count() != 1
            || paths.iter().filter(|[_, t]| t == target).count() != 1
            || paths.iter().filter(|[s, _]| s == target).count() != 0
        {
            return None;
        }
        let beta = result["structural"]["path_coefficients"][target][source]
            .as_f64()
            .unwrap_or(0.0);
        let r2 = result["structural"]["r_squared"][target]
            .as_f64()
            .unwrap_or(beta * beta);
        rows.push(json!({"formative_construct":src.name.as_ref().unwrap_or(source),"formative_id":source,
            "global_construct":tgt.name.as_ref().unwrap_or(target),"global_id":target,"path_coefficient":beta,"r_squared":r2,
            "threshold":0.70,"supported":beta >= 0.70,"result":if beta >= 0.70 { "Supported (>= 0.70)" } else { "Not supported (< 0.70)" },
            "note":"Hair et al. (2022): path coefficient of at least 0.70 (R² of at least 0.50). If not met, consider adding indicators that cover the domain of the construct."}));
    }
    Some(json!(rows))
}
