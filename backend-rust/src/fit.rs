//! PLS fit evaluation and PLSc correction, preserving existing result contracts.
use crate::{
    effects, linalg,
    matrix::{self, Matrix},
    model,
    pls::Block,
    stats,
};
use serde_json::{json, Map, Value};

fn number(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}
fn rounded(v: f64) -> Value {
    if v.is_finite() {
        json!(v)
    } else {
        Value::Null
    }
}
fn threshold(v: f64, limit: f64) -> Value {
    if v.is_finite() {
        json!(v < limit)
    } else {
        Value::Null
    }
}
fn corr_value(correlations: &Value, a: &str, b: &str) -> f64 {
    correlations[a][b]
        .as_f64()
        .filter(|v| *v != 0.0)
        .or_else(|| correlations[b][a].as_f64())
        .unwrap_or(0.0)
}

pub fn plsc(original: Value, spec: &Value, n: usize) -> Result<Value, String> {
    let parsed = model::parse(spec)?;
    let blocks = &parsed.blocks;
    let ids: Vec<_> = blocks.iter().map(|b| b.id.clone()).collect();
    let mut factors = Map::new();
    let mut warnings = Vec::<String>::new();
    for b in blocks {
        let rho = original["reliability_and_validity"]["rho_a"][&b.id].as_f64();
        let factor = if b.measurement_type != "reflective" || b.indicators.len() < 2 {
            1.0
        } else {
            match rho {
                Some(r) if r.is_finite() && r > 0.0 && r <= 1.0 => r,
                Some(r) if r > 1.0 => {
                    warnings.push(format!(
                        "Construct '{}' has rho_A > 1 ({}). Capped at 1.0.",
                        b.id,
                        matrix::round(r, 4)
                    ));
                    1.0
                }
                _ => 1.0,
            }
        };
        factors.insert(b.id.clone(), json!(factor));
    }
    let correlations = &original["construct_correlations"];
    let mut consistent = matrix::identity(ids.len());
    for i in 0..ids.len() {
        for j in 0..ids.len() {
            if i != j {
                let denominator = (number(&factors[&ids[i]]) * number(&factors[&ids[j]]))
                    .sqrt()
                    .max(1e-6);
                consistent[i][j] =
                    (corr_value(correlations, &ids[i], &ids[j]) / denominator).clamp(-1.0, 1.0);
            }
        }
    }
    if linalg::symmetric_eigen(&consistent)?
        .0
        .iter()
        .any(|v| *v < 1e-6)
    {
        consistent = matrix::nearest_psd(&consistent, 1e-6)?;
        warnings.push(
            "Disattenuated construct correlation matrix required nearest-PSD correction.".into(),
        );
    }
    let weights = &original["measurement"]["outer_weights"];
    let mut loadings = Map::new();
    for b in blocks {
        let mut row = Map::new();
        let entries: Vec<_> = b
            .indicators
            .iter()
            .filter_map(|id| weights[&b.id][id].as_f64().map(|w| (id, w)))
            .collect();
        let squares: Vec<_> = entries.iter().map(|(_, w)| w * w).collect();
        let norm = stats::numpy_sum(&squares);
        let norm = if norm == 0.0 { 1.0 } else { norm };
        let factor = number(&factors[&b.id]);
        for (id, w) in entries {
            row.insert(
                id.clone(),
                if factor == 1.0 {
                    original["measurement"]["outer_loadings"][&b.id][id]
                        .as_f64()
                        .map(|v| json!(v))
                        .unwrap_or(json!(w))
                } else {
                    rounded(w * factor.sqrt() / norm)
                },
            );
        }
        loadings.insert(b.id.clone(), Value::Object(row));
    }
    let mut targets: Vec<(String, Vec<String>)> = Vec::new();
    // PLSc intentionally recognizes only from/from_node and to/to_node here.
    for p in spec["paths"].as_array().into_iter().flatten() {
        let from = model::alias(p, &["from", "from_node"]).ok_or("PLSc path source missing")?;
        let to = model::alias(p, &["to", "to_node"]).ok_or("PLSc path target missing")?;
        if let Some((_, preds)) = targets.iter_mut().find(|(target, _)| target == to) {
            if !preds.iter().any(|p| p == from) {
                preds.push(from.into());
            }
        } else {
            targets.push((to.into(), vec![from.into()]));
        }
    }
    let mut coefficients: Map<String, Value> =
        ids.iter().map(|id| (id.clone(), json!({}))).collect();
    let mut r2 = Map::new();
    let mut adjusted = Map::new();
    let mut path_matrix = vec![vec![0.0; ids.len()]; ids.len()];
    for (target, preds) in targets {
        let target_index = ids
            .iter()
            .position(|id| id == &target)
            .ok_or("Unknown PLSc target")?;
        let indices: Vec<_> = preds
            .iter()
            .map(|id| {
                ids.iter()
                    .position(|c| c == id)
                    .ok_or("Unknown PLSc source")
            })
            .collect::<Result<_, _>>()?;
        let pp: Matrix = indices
            .iter()
            .map(|&i| indices.iter().map(|&j| consistent[i][j]).collect())
            .collect();
        let py: Matrix = indices
            .iter()
            .map(|&i| vec![consistent[i][target_index]])
            .collect();
        let beta = linalg::pseudoinverse(&pp, 1e-15)
            .map(|pinv| matrix::multiply(&pinv, &py))
            .unwrap_or_else(|_| vec![vec![0.0]; preds.len()]);
        let explained = beta
            .iter()
            .zip(&py)
            .map(|(b, y)| b[0] * y[0])
            .sum::<f64>()
            .clamp(0.0, 1.0);
        for (i, id) in preds.iter().enumerate() {
            let value = beta[i][0];
            coefficients[&target][id] = json!(value);
            path_matrix[indices[i]][target_index] = value;
        }
        let adj = 1.0
            - (1.0 - explained) * (n - 1) as f64 / n.saturating_sub(preds.len() + 1).max(1) as f64;
        r2.insert(target.clone(), rounded(explained));
        adjusted.insert(target, rounded(adj));
    }
    let decomposition = effects::calculate(&path_matrix, &ids);
    let corr: Map<String, Value> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| {
            (
                id.clone(),
                Value::Object(
                    ids.iter()
                        .enumerate()
                        .map(|(j, c)| (c.clone(), rounded(consistent[i][j])))
                        .collect(),
                ),
            )
        })
        .collect();
    Ok(
        json!({"is_consistent":true,"warnings":warnings,"rho_factors":factors,
        "measurement":{"outer_loadings":loadings,"outer_weights":weights,"construct_correlations":corr,
            "reliability":original["measurement"].get("reliability").cloned().unwrap_or(json!({})),
            "discriminant_validity":original["measurement"].get("discriminant_validity").cloned().unwrap_or(json!({}))},
        "structural":{"path_coefficients":coefficients,"r_squared":r2,"r_squared_adj":adjusted,
            "effects":decomposition["effects_summary"],"specific_indirect":decomposition["specific_indirect"]},
        "effects_decomposition":decomposition,"results_pls_original":original}),
    )
}

fn discrepancy(s: &[Vec<f64>], sigma: &[Vec<f64>]) -> (f64, f64, f64) {
    let squared: Vec<_> = (0..s.len())
        .flat_map(|i| (i..s.len()).map(move |j| (s[i][j] - sigma[i][j]).powi(2)))
        .collect();
    let total = stats::numpy_sum(&squared);
    let dg = linalg::pseudoinverse(s, 1e-15)
        .and_then(|p| linalg::eigenvalues_real(&matrix::multiply(&p, sigma)))
        .map(|e| {
            0.5 * e
                .into_iter()
                .filter(|v| *v > 1e-9)
                .map(|v| v.ln().powi(2))
                .sum::<f64>()
        })
        .unwrap_or(0.0);
    ((total / squared.len() as f64).sqrt(), 0.5 * total, dg)
}

pub fn evaluate(
    columns: &[String],
    rows: &[Vec<f64>],
    spec: &Value,
    results: &Value,
) -> Result<Value, String> {
    let parsed = model::parse(spec)?;
    let mut groups: Vec<(&Block, Vec<String>, Map<String, Value>)> = Vec::new();
    let mut indicators: Vec<String> = Vec::new();
    for block in &parsed.blocks {
        let mut used = Vec::new();
        let mut loadings = Map::new();
        for iid in &block.indicators {
            let col = parsed
                .indicators
                .iter()
                .find(|(id, _)| id == iid)
                .map(|(_, c)| c)
                .unwrap_or(iid);
            if !columns.contains(col) {
                continue;
            }
            if !used.contains(col) {
                used.push(col.clone());
            }
            if !indicators.contains(col) {
                indicators.push(col.clone());
            }
            let value = results["measurement"]["outer_loadings"][&block.id][iid]
                .as_f64()
                .or_else(|| results["measurement"]["outer_loadings"][&block.id][col].as_f64())
                .unwrap_or(0.0);
            loadings.insert(col.clone(), json!(value));
            loadings.insert(iid.clone(), json!(value));
        }
        if !used.is_empty() {
            groups.push((block, used, loadings));
        }
    }
    if indicators.len() < 2 {
        return Ok(
            json!({"note":"Model fit requires at least two valid indicators across constructs."}),
        );
    }
    let indices: Vec<_> = indicators
        .iter()
        .map(|col| columns.iter().position(|c| c == col).unwrap())
        .collect();
    let x: Matrix = rows
        .iter()
        .filter(|row| indices.iter().all(|&i| !row[i].is_nan()))
        .map(|row| indices.iter().map(|&i| row[i]).collect())
        .collect();
    let s = matrix::correlation_rows(&x);
    let count = groups.len();
    let correlations = if results["construct_correlations"].is_object() {
        &results["construct_correlations"]
    } else {
        &results["measurement"]["construct_correlations"]
    };
    let mut rc = matrix::identity(count);
    let mut system = matrix::identity(count);
    for i in 0..count {
        for j in 0..count {
            if i != j {
                rc[i][j] = corr_value(correlations, &groups[i].0.id, &groups[j].0.id);
            }
            system[i][j] -= number(
                &results["structural"]["path_coefficients"][&groups[i].0.id][&groups[j].0.id],
            );
        }
    }
    let estimated = linalg::inverse(&system)
        .map(|inverse| {
            let residual =
                matrix::multiply(&matrix::multiply(&system, &rc), &matrix::transpose(&system));
            let diagonal: Matrix = (0..count)
                .map(|i| {
                    (0..count)
                        .map(|j| if i == j { residual[i][i] } else { 0.0 })
                        .collect()
                })
                .collect();
            let mut implied = matrix::multiply(
                &matrix::multiply(&inverse, &diagonal),
                &matrix::transpose(&inverse),
            );
            let scale: Vec<_> = (0..count)
                .map(|i| {
                    let sd = implied[i][i].sqrt();
                    if sd == 0.0 {
                        1.0
                    } else {
                        sd
                    }
                })
                .collect();
            for i in 0..count {
                for j in 0..count {
                    implied[i][j] /= scale[i] * scale[j];
                }
            }
            implied
        })
        .unwrap_or_else(|_| rc.clone());
    let mut saturated = s.clone();
    let mut sigma_est = s.clone();
    for i in 0..count {
        for j in 0..count {
            if i != j {
                for a in &groups[i].1 {
                    for b in &groups[j].1 {
                        let ai = indicators.iter().position(|c| c == a).unwrap();
                        let bi = indicators.iter().position(|c| c == b).unwrap();
                        let product = number(&groups[i].2[a]) * number(&groups[j].2[b]);
                        saturated[ai][bi] = product * rc[i][j];
                        sigma_est[ai][bi] = product * estimated[i][j];
                    }
                }
            }
        }
    }
    let sat = discrepancy(&s, &saturated);
    let est = discrepancy(&s, &sigma_est);
    let scores = if results["construct_scores"].is_object() {
        &results["construct_scores"]
    } else {
        &results["structural"]["construct_scores"]
    };
    let mut residuals: Vec<Vec<f64>> = Vec::new();
    for (block, _, loadings) in &groups {
        if block.measurement_type != "reflective" || block.indicators.len() <= 1 {
            continue;
        }
        let Some(score) = scores[&block.id].as_array() else {
            continue;
        };
        for iid in &block.indicators {
            let col = parsed
                .indicators
                .iter()
                .find(|(id, _)| id == iid)
                .map(|(_, c)| c)
                .unwrap_or(iid);
            let Some(index) = columns.iter().position(|c| c == col) else {
                continue;
            };
            let values: Vec<_> = rows
                .iter()
                .map(|r| r[index])
                .filter(|v| !v.is_nan())
                .collect();
            if values.len() != score.len() {
                continue;
            }
            let mean = stats::mean(&values, None);
            let sd = stats::std(&values, None, 0);
            let scale = if sd > 1e-12 { sd } else { 1.0 };
            let lambda = loadings[iid]
                .as_f64()
                .or_else(|| loadings[col].as_f64())
                .unwrap_or(0.0);
            let residual: Vec<_> = values
                .iter()
                .zip(score)
                .map(|(x, y)| (x - mean) / scale - lambda * number(y))
                .collect();
            if stats::std(&residual, None, 1) > 1e-8 {
                residuals.push(residual);
            }
        }
    }
    let mut pairs = Vec::new();
    for i in 0..residuals.len() {
        for j in i + 1..residuals.len() {
            let correlation = stats::correlation(&residuals[i], &residuals[j], None);
            if correlation.is_finite() {
                pairs.push(correlation * correlation);
            }
        }
    }
    let rms = stats::mean(&pairs, None).sqrt();
    let reliability = if results["reliability_and_validity"].is_object() {
        &results["reliability_and_validity"]
    } else {
        &results["measurement"]["reliability"]
    };
    let av: Vec<_> = reliability["ave"]
        .as_object()
        .into_iter()
        .flat_map(|v| v.values())
        .filter_map(Value::as_f64)
        .filter(|v| !v.is_nan())
        .collect();
    let rv: Vec<_> = results["structural"]["r_squared"]
        .as_object()
        .into_iter()
        .flat_map(|v| v.values())
        .filter_map(Value::as_f64)
        .filter(|v| !v.is_nan())
        .collect();
    let gof = if av.is_empty() || rv.is_empty() {
        json!({"gof":null,"mean_communality":null,"mean_r2":null,"note":"GoF cannot be calculated when communalities or R2 values are absent."})
    } else {
        let a = stats::mean(&av, None);
        let r = stats::mean(&rv, None);
        json!({"gof":rounded((a*r).sqrt()),"mean_communality":rounded(a),"mean_r2":rounded(r),"note":"Not recommended as a model fit criterion: Tenenhaus GoF cannot distinguish valid from invalid models (Henseler & Sarstedt, 2013)."})
    };
    Ok(
        json!({"saturated_model":{"srmr":rounded(sat.0),"srmr_ok":threshold(sat.0,0.08),"d_uls":rounded(sat.1),"d_g":rounded(sat.2)},
        "estimated_model":{"srmr":rounded(est.0),"srmr_ok":threshold(est.0,0.08),"d_uls":rounded(est.1),"d_g":rounded(est.2)},
        "rms_theta":rounded(rms),"rms_theta_ok":threshold(rms,0.12),"gof":gof,"thresholds":{"srmr":0.08,"rms_theta":0.12},
        "notes":["SRMR < 0.08 indicates acceptable model fit (Hu & Bentler 1999; Hair et al. 2017).","RMS_theta < 0.12 indicates good outer model residual covariance (Lohmöller 1989).",gof["note"]]}),
    )
}
