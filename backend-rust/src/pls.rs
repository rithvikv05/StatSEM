//! Port of algorithm.py::estimate_pls. Inputs are already prepared/standardized;
//! data ingestion, pipeline hooks, fit and PLSc remain separate migration work.
use crate::{effects, linalg, stats};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Deserialize)]
pub struct Block {
    pub id: String,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub measurement_type: String,
    pub indicators: Vec<String>,
    #[serde(default)]
    pub weighting: String,
    #[serde(default)]
    pub predefined_weights: BTreeMap<String, f64>,
    pub outer_mode: Option<String>,
    #[serde(default)]
    pub is_interaction: bool,
    pub metadata: Option<Value>,
    pub data: Vec<Vec<f64>>,
}

#[derive(Clone, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub inner_weighting: String,
    pub initial_weights: String,
    pub individual_initial_weights: Option<BTreeMap<String, f64>>,
    pub max_iter: usize,
    pub tolerance: f64,
    pub sign_convention: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            inner_weighting: "path".into(),
            initial_weights: "equal".into(),
            individual_initial_weights: None,
            max_iter: 3000,
            tolerance: 1e-7,
            sign_convention: "dominant".into(),
        }
    }
}

fn named(ids: &[String], values: impl IntoIterator<Item = Value>) -> Value {
    Value::Object(ids.iter().cloned().zip(values).collect())
}
fn named_numbers(ids: &[String], values: &[f64]) -> Value {
    named(ids, values.iter().map(|v| json!(v)))
}
fn linear_combination(columns: &[Vec<f64>], coefficients: &[f64]) -> Vec<f64> {
    let mut result = vec![0.0; columns[0].len()];
    for (column, &coefficient) in columns.iter().zip(coefficients) {
        for (value, &x) in result.iter_mut().zip(column) {
            *value += coefficient * x;
        }
    }
    result
}
fn standardize_score(mut x: Vec<f64>, obs: Option<&[f64]>) -> Vec<f64> {
    let center = stats::mean(&x, obs);
    let scale = stats::std(&x, obs, 0);
    let scale = if scale == 0.0 { 1.0 } else { scale };
    for v in &mut x {
        *v = (*v - center) / scale;
    }
    x
}
fn covariance(columns: &[Vec<f64>], y: &[f64], obs: Option<&[f64]>) -> Vec<f64> {
    let divisor = obs.map(stats::numpy_sum).unwrap_or(y.len() as f64);
    columns
        .iter()
        .map(|column| {
            column
                .iter()
                .zip(y)
                .enumerate()
                .fold(0.0, |sum, (i, (&x, &y))| {
                    sum + if let Some(w) = obs {
                        (x * (w[i] / divisor)) * y
                    } else {
                        x * y
                    }
                })
                / if obs.is_none() { divisor } else { 1.0 }
        })
        .collect()
}
fn correlations(columns: &[Vec<f64>]) -> Vec<Vec<f64>> {
    columns
        .iter()
        .map(|x| {
            columns
                .iter()
                .map(|y| stats::correlation(x, y, None))
                .collect()
        })
        .collect()
}
pub(crate) fn vif(columns: &[Vec<f64>]) -> Vec<f64> {
    if columns.len() <= 1 {
        return vec![1.0];
    }
    columns
        .iter()
        .enumerate()
        .map(|(j, target)| {
            let mut design = vec![vec![1.0; target.len()]];
            design.extend(
                columns
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != j)
                    .map(|(_, c)| c.clone()),
            );
            match linalg::least_squares(&design, target, None) {
                Ok(fit) => {
                    let predicted = linear_combination(&design, &fit.coefficients);
                    let total = total_ss(target);
                    let r2 = if total > 0.0 {
                        1.0 - residual_ss(target, &predicted) / total
                    } else {
                        0.0
                    };
                    1.0 / (1.0 - r2.clamp(0.0, 0.999999))
                }
                Err(_) => 1.0,
            }
        })
        .collect()
}
fn total_ss(x: &[f64]) -> f64 {
    let mean = stats::mean(x, None);
    stats::numpy_reduce(0, x.len(), &|i| (x[i] - mean).powi(2))
}
fn residual_ss(y: &[f64], prediction: &[f64]) -> f64 {
    stats::numpy_reduce(0, y.len(), &|i| (y[i] - prediction[i]).powi(2))
}

pub fn estimate(
    blocks: Vec<Block>,
    paths: Vec<[String; 2]>,
    cfg: Settings,
    obs_weights: Option<Vec<f64>>,
) -> Result<Value, String> {
    let count = blocks.len();
    let n = blocks.first().map_or(0, |b| b.data.len());
    if count == 0 || n < 2 {
        return Err("PLS needs nonempty blocks and at least two observations".into());
    }
    if cfg.max_iter > 5000
        || !cfg.tolerance.is_finite()
        || cfg.tolerance <= 0.0
        || cfg.tolerance > 0.01
    {
        return Err("Invalid estimation iteration/tolerance settings".into());
    }
    if !["path", "centroid", "factor"].contains(&cfg.inner_weighting.as_str())
        || !["equal", "lohmoller", "individual", "sum_scores"]
            .contains(&cfg.initial_weights.as_str())
        || !["dominant", "none"].contains(&cfg.sign_convention.as_str())
    {
        return Err("Unknown PLS estimation setting".into());
    }
    let obs = obs_weights.as_deref();
    stats::check_weights(n, obs)?;
    if obs
        .is_some_and(|w| w.iter().any(|v| !v.is_finite() || *v < 0.0) || stats::numpy_sum(w) <= 0.0)
    {
        return Err("Invalid observation weights".into());
    }
    let mut seen = HashSet::new();
    for b in &blocks {
        if !seen.insert(&b.id)
            || b.indicators.is_empty()
            || b.data.len() != n
            || b.data
                .iter()
                .any(|r| r.len() != b.indicators.len() || r.iter().any(|v| !v.is_finite()))
        {
            return Err("Invalid construct ID, data shape or non-finite prepared data".into());
        }
    }
    let ids: Vec<_> = blocks.iter().map(|b| b.id.clone()).collect();
    let x: Vec<Vec<Vec<f64>>> = blocks
        .iter()
        .map(|b| {
            (0..b.indicators.len())
                .map(|j| b.data.iter().map(|r| r[j]).collect())
                .collect()
        })
        .collect();
    let mut adjacency = vec![vec![false; count]; count];
    for [from, to] in paths {
        if let (Some(i), Some(j)) = (
            ids.iter().position(|id| id == &from),
            ids.iter().position(|id| id == &to),
        ) {
            adjacency[i][j] = true;
        }
    }
    // Graph structure is fixed across every Wold iteration; compute it once.
    let predecessors: Vec<Vec<usize>> = (0..count)
        .map(|j| (0..count).filter(|&i| adjacency[i][j]).collect())
        .collect();
    let successors: Vec<Vec<usize>> = (0..count)
        .map(|j| (0..count).filter(|&i| adjacency[j][i]).collect())
        .collect();
    let mut weights: Vec<Vec<f64>> = blocks
        .iter()
        .enumerate()
        .map(|(j, b)| {
            let k = b.indicators.len();
            let default = 1.0 / (k as f64).sqrt();
            let mut w = if b.weighting == "predefined" && !b.predefined_weights.is_empty() {
                b.indicators
                    .iter()
                    .map(|id| b.predefined_weights.get(id).copied().unwrap_or(default))
                    .collect()
            } else if cfg.initial_weights == "lohmoller" {
                let mut w = vec![1.0; k];
                if k > 1 {
                    w[k - 1] = -1.0;
                }
                w
            } else if cfg.initial_weights == "individual"
                && cfg
                    .individual_initial_weights
                    .as_ref()
                    .is_some_and(|w| !w.is_empty())
            {
                b.indicators
                    .iter()
                    .map(|id| {
                        cfg.individual_initial_weights
                            .as_ref()
                            .unwrap()
                            .get(id)
                            .copied()
                            .unwrap_or(default)
                    })
                    .collect()
            } else if cfg.initial_weights == "sum_scores" || b.weighting == "sum_scores" {
                vec![1.0; k]
            } else {
                vec![default; k]
            };
            let sd = stats::std(&linear_combination(&x[j], &w), obs, 0);
            let sd = if sd > 0.0 { sd } else { 1.0 };
            for v in &mut w {
                *v /= sd;
            }
            w
        })
        .collect();
    let mut scores: Vec<Vec<f64>> = (0..count)
        .map(|j| standardize_score(linear_combination(&x[j], &weights[j]), obs))
        .collect();
    let skip = cfg.max_iter == 0 || blocks.iter().all(|b| b.weighting == "sum_scores");
    let mut converged = skip;
    let mut history = Vec::new();
    let mut e = vec![vec![0.0; count]; count];
    let mut proxies = vec![vec![0.0; n]; count];
    while history.len() < cfg.max_iter && !converged {
        let corr = correlations(&scores);
        for row in &mut e {
            row.fill(0.0);
        }
        for j in 0..count {
            if cfg.inner_weighting == "factor" || cfg.inner_weighting == "centroid" {
                for i in 0..count {
                    if adjacency[i][j] || adjacency[j][i] {
                        let r = if corr[i][j].is_nan() { 0.0 } else { corr[i][j] };
                        e[i][j] = if cfg.inner_weighting == "factor" {
                            r
                        } else if r < 0.0 {
                            -1.0
                        } else {
                            1.0
                        };
                    }
                }
            } else {
                let preds = &predecessors[j];
                if preds.len() == 1 {
                    e[preds[0]][j] = if corr[preds[0]][j].is_nan() {
                        0.0
                    } else {
                        corr[preds[0]][j]
                    };
                } else if !preds.is_empty() {
                    let design: Vec<_> = preds.iter().map(|&i| scores[i].clone()).collect();
                    let beta = linalg::least_squares(&design, &scores[j], None)
                        .map(|fit| fit.coefficients)
                        .unwrap_or_else(|_| {
                            preds
                                .iter()
                                .map(|&i| if corr[i][j].is_nan() { 0.0 } else { corr[i][j] })
                                .collect()
                        });
                    for (&i, value) in preds.iter().zip(beta) {
                        e[i][j] = value;
                    }
                }
                for &k in &successors[j] {
                    e[k][j] = if corr[k][j].is_nan() { 0.0 } else { corr[k][j] };
                }
            }
        }
        for j in 0..count {
            proxies[j].fill(0.0);
            let mut connected = false;
            for i in 0..count {
                if e[i][j] != 0.0 {
                    connected = true;
                    for (v, y) in proxies[j].iter_mut().zip(&scores[i]) {
                        *v += e[i][j] * y;
                    }
                }
            }
            if !connected {
                proxies[j].copy_from_slice(&scores[j]);
            }
            proxies[j] = standardize_score(std::mem::take(&mut proxies[j]), obs);
        }
        let mut change = 0.0;
        for j in 0..count {
            if blocks[j].weighting == "sum_scores" {
                continue;
            }
            let mode_a = blocks[j]
                .outer_mode
                .as_ref()
                .map(|mode| mode.eq_ignore_ascii_case("A"))
                .unwrap_or(blocks[j].measurement_type == "reflective");
            let mut updated = if mode_a {
                covariance(&x[j], &proxies[j], obs)
            } else {
                linalg::least_squares(&x[j], &proxies[j], obs)
                    .map(|fit| fit.coefficients)
                    .unwrap_or_else(|_| covariance(&x[j], &proxies[j], None))
            };
            let sd = stats::std(&linear_combination(&x[j], &updated), obs, 0);
            if sd > 1e-12 {
                for v in &mut updated {
                    *v /= sd;
                }
            } else {
                let equal = 1.0 / (updated.len() as f64).sqrt();
                updated.fill(equal);
            }
            change +=
                stats::numpy_reduce(0, updated.len(), &|i| (updated[i] - weights[j][i]).abs());
            weights[j] = updated;
        }
        for j in 0..count {
            scores[j] = standardize_score(linear_combination(&x[j], &weights[j]), obs);
        }
        history.push(json!({"iteration": history.len() + 1, "change": change}));
        converged = change < cfg.tolerance;
    }
    let mut loadings: Vec<_> = (0..count)
        .map(|j| covariance(&x[j], &scores[j], obs))
        .collect();
    for j in 0..count {
        if cfg.sign_convention == "dominant" && stats::numpy_sum(&loadings[j]) < 0.0 {
            for v in &mut weights[j] {
                *v = -*v;
            }
            for v in &mut scores[j] {
                *v = -*v;
            }
            for v in &mut loadings[j] {
                *v = -*v;
            }
        }
    }

    let mut path_coefs = vec![Map::new(); count];
    let mut path_matrix = vec![vec![0.0; count]; count];
    let mut r2 = Map::new();
    let mut r2_adj = Map::new();
    let mut f2 = vec![Map::new(); count];
    let mut inner_vif = vec![Map::new(); count];
    let mut path_list = Vec::new();
    for j in 0..count {
        let preds = &predecessors[j];
        if preds.is_empty() {
            continue;
        }
        let design: Vec<_> = preds.iter().map(|&i| scores[i].clone()).collect();
        let beta = linalg::least_squares(&design, &scores[j], obs)?.coefficients;
        let total = total_ss(&scores[j]);
        let explained = if total > 0.0 {
            1.0 - residual_ss(&scores[j], &linear_combination(&design, &beta)) / total
        } else {
            0.0
        }
        .clamp(0.0, 1.0);
        r2.insert(ids[j].clone(), json!(explained));
        let adjusted = if n > preds.len() + 1 {
            1.0 - (1.0 - explained) * (n - 1) as f64 / (n - preds.len() - 1) as f64
        } else {
            explained
        };
        r2_adj.insert(ids[j].clone(), json!(adjusted.max(0.0)));
        for (&i, &value) in preds.iter().zip(&beta) {
            path_coefs[j].insert(ids[i].clone(), json!(value));
            path_matrix[i][j] = value;
            path_list.push(json!({"from": ids[i], "to": ids[j], "beta": value}));
        }
        if explained < 1.0 {
            for &i in preds {
                let effect = if preds.len() == 1 {
                    explained / (1.0 - explained)
                } else {
                    let reduced: Vec<_> = preds
                        .iter()
                        .filter(|&&p| p != i)
                        .map(|&p| scores[p].clone())
                        .collect();
                    let fit = linalg::least_squares(&reduced, &scores[j], obs)?.coefficients;
                    let excluded = (1.0
                        - residual_ss(&scores[j], &linear_combination(&reduced, &fit)) / total)
                        .max(0.0);
                    (explained - excluded) / (1.0 - explained)
                };
                f2[j].insert(ids[i].clone(), json!(effect.max(0.0)));
            }
        }
        for (&i, value) in preds.iter().zip(vif(&design)) {
            inner_vif[j].insert(ids[i].clone(), json!(value));
        }
    }
    let decomposition = effects::calculate(&path_matrix, &ids);
    let outer_weights = named(
        &ids,
        (0..count).map(|j| named_numbers(&blocks[j].indicators, &weights[j])),
    );
    let outer_loadings = named(
        &ids,
        (0..count).map(|j| named_numbers(&blocks[j].indicators, &loadings[j])),
    );
    let indicator_reliability = named(
        &ids,
        (0..count).map(|j| {
            named_numbers(
                &blocks[j].indicators,
                &loadings[j].iter().map(|v| v * v).collect::<Vec<_>>(),
            )
        }),
    );
    let outer_vif = named(
        &ids,
        (0..count).map(|j| named_numbers(&blocks[j].indicators, &vif(&x[j]))),
    );
    let mut alpha = Vec::new();
    let mut cr = Vec::new();
    let mut rho_a = Vec::new();
    let mut ave = Vec::new();
    let within: Vec<_> = x.iter().map(|b| correlations(b)).collect();
    for j in 0..count {
        let k = blocks[j].indicators.len();
        if k == 1 {
            alpha.push(json!(1.0));
            cr.push(json!(1.0));
            rho_a.push(json!(1.0));
            ave.push(json!(1.0));
            continue;
        }
        if blocks[j].measurement_type != "reflective" {
            alpha.push(Value::Null);
            cr.push(Value::Null);
            rho_a.push(json!(1.0));
            ave.push(Value::Null);
            continue;
        }
        let l = &loadings[j];
        let sum_l = stats::numpy_sum(l);
        let sum_error = stats::numpy_reduce(0, k, &|i| 1.0 - l[i] * l[i]);
        let denom_cr = sum_l * sum_l + sum_error;
        let reliability = if denom_cr > 0.0 {
            sum_l * sum_l / denom_cr
        } else {
            0.0
        };
        cr.push(json!(reliability));
        ave.push(json!(
            stats::numpy_reduce(0, k, &|i| l[i] * l[i]) / k as f64
        ));
        let flat: Vec<_> = within[j].iter().flatten().copied().collect();
        let sum_corr = stats::numpy_sum(&flat);
        let a = if sum_corr > 0.0 {
            (k as f64 / (k - 1) as f64) * (1.0 - k as f64 / sum_corr)
        } else {
            0.0
        };
        alpha.push(json!(a.clamp(0.0, 1.0)));
        let w = &weights[j];
        let squared_sum = stats::numpy_reduce(0, k, &|i| w[i] * w[i]);
        let diagonal = stats::numpy_reduce(0, k, &|i| w[i] * w[i] * within[j][i][i]);
        let product: Vec<_> = (0..k)
            .map(|column| (0..k).fold(0.0, |v, row| v + w[row] * within[j][row][column]))
            .collect();
        let quadratic_form = product.iter().zip(w).fold(0.0, |sum, (a, b)| sum + a * b);
        let denominator = squared_sum * squared_sum - stats::numpy_reduce(0, k, &|i| w[i].powi(4));
        let rho = if denominator.abs() > 1e-12 {
            squared_sum * squared_sum * (quadratic_form - diagonal) / denominator
        } else {
            reliability
        };
        // Python max(0, min(NaN, 1)) returns the first max argument, zero.
        rho_a.push(json!(if rho.is_nan() {
            0.0
        } else {
            rho.clamp(0.0, 1.0)
        }));
    }
    let mut cross = Map::new();
    for j in 0..count {
        for (indicator, column) in blocks[j].indicators.iter().zip(&x[j]) {
            cross.insert(
                indicator.clone(),
                named_numbers(
                    &ids,
                    &scores
                        .iter()
                        .map(|score| stats::correlation(column, score, None))
                        .collect::<Vec<_>>(),
                ),
            );
        }
    }
    // Python special-cases a one-construct score matrix to [[1]], including a
    // constant construct; ordinary corrcoef would produce NaN in that case.
    let construct_corr = if count == 1 {
        vec![vec![1.0]]
    } else {
        correlations(&scores)
    };
    let fornell = named(
        &ids,
        (0..count).map(|i| {
            named(
                &ids,
                (0..count).map(|j| {
                    if i != j {
                        json!(construct_corr[i][j])
                    } else if blocks[i].measurement_type == "reflective"
                        && blocks[i].indicators.len() > 1
                    {
                        json!(ave[i].as_f64().unwrap_or(0.0).max(0.0).sqrt())
                    } else {
                        Value::Null
                    }
                }),
            )
        }),
    );
    let mean_within: Vec<f64> = within
        .iter()
        .map(|matrix| {
            if matrix.len() == 1 {
                return 1.0;
            }
            let values: Vec<_> = matrix
                .iter()
                .enumerate()
                .flat_map(|(i, row)| row[..i].iter().map(|v| v.abs()))
                .collect();
            stats::mean(&values, None)
        })
        .collect();
    let htmt = named(
        &ids,
        (0..count).map(|i| {
            named(
                &ids,
                (0..count).map(|j| {
                    if i == j {
                        return json!(1.0);
                    }
                    let cross: Vec<_> = x[i]
                        .iter()
                        .flat_map(|a| {
                            x[j].iter()
                                .map(move |b| stats::correlation(a, b, None).abs())
                        })
                        .collect();
                    json!(
                        stats::mean(&cross, None)
                            / (mean_within[i] * mean_within[j]).max(1e-12).sqrt()
                    )
                }),
            )
        }),
    );
    let score_dict = named(&ids, scores.iter().map(|s| json!(s)));
    let f2 = named(&ids, f2.into_iter().map(Value::Object));
    let inner_vif = named(&ids, inner_vif.into_iter().map(Value::Object));
    let latent: Vec<_> = blocks
        .iter()
        .map(|b| {
            json!({"id": b.id, "name": b.name.as_ref().unwrap_or(&b.id), "type": b.measurement_type,
        "is_interaction": b.is_interaction || b.id.contains(" x "), "metadata": b.metadata})
        })
        .collect();
    Ok(
        json!({"converged": converged, "iterations": history.len(), "stop_criterion_history": history, "n_samples": n,
        "construct_scores": score_dict, "construct_correlations": named(&ids, construct_corr.iter().map(|r| named_numbers(&ids, r))),
        "structural": {"path_coefficients": named(&ids, path_coefs.into_iter().map(Value::Object)), "r_squared": r2,
            "r_squared_adj": r2_adj, "f_squared": f2, "inner_vif": inner_vif, "effects": decomposition["effects_summary"], "specific_indirect": decomposition["specific_indirect"]},
        "effects_decomposition": decomposition,
        "measurement": {"outer_weights": outer_weights, "outer_loadings": outer_loadings, "indicator_reliability": indicator_reliability, "outer_vif": outer_vif, "cross_loadings": cross},
        "reliability_and_validity": {"cronbachs_alpha": named(&ids, alpha), "composite_reliability": named(&ids, cr), "rho_a": named(&ids, rho_a), "ave": named(&ids, ave), "fornell_larcker": fornell, "htmt": htmt},
        "latent_variables": latent, "paths": path_list, "scores": score_dict, "r2": r2, "f2": f2, "vif": inner_vif}),
    )
}
