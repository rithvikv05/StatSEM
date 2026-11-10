//! Multi-equation finite-mixture regression and FIMIX retention diagnostics.
use crate::{linalg, matrix, model, pipeline, rng, sort, stats};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Deserialize)]
pub struct Equation {
    pub target: String,
    pub y: Vec<f64>,
    pub predictors: Vec<String>,
    #[serde(rename = "X_design")]
    pub design: Vec<Vec<f64>>,
}
#[derive(Clone, Deserialize)]
#[serde(default)]
pub struct EmOptions {
    pub n_segments: usize,
    pub n_samples: usize,
    pub n_repetitions: usize,
    pub max_iter: usize,
    pub tol: f64,
    pub seed: Option<u64>,
}
impl Default for EmOptions {
    fn default() -> Self {
        Self {
            n_segments: 2,
            n_samples: 0,
            n_repetitions: 10,
            max_iter: 2000,
            tol: 1e-5,
            seed: None,
        }
    }
}
fn logpdf(y: f64, mean: f64, sd: f64) -> f64 {
    let z = (y - mean) / sd;
    -z * z / 2.0 - (2.0 * std::f64::consts::PI).sqrt().ln() - sd.ln()
}
fn yvariance(y: &[f64]) -> f64 {
    let v = stats::variance(y, None, 0);
    if v == 0.0 {
        1.0
    } else {
        v
    }
}
fn argmax(row: &[f64]) -> usize {
    let mut best = 0;
    for i in 1..row.len() {
        if row[i] > row[best] {
            best = i;
        }
    }
    best
}
fn coef_map(eq: &Equation, coef: &[f64]) -> Value {
    let mut map = serde_json::Map::new();
    map.insert("_intercept".into(), json!(coef[0]));
    for (id, coef) in eq.predictors.iter().zip(&coef[1..]) {
        map.insert(id.clone(), json!(*coef));
    }
    Value::Object(map)
}

pub fn em(equations: Vec<Equation>, o: EmOptions, cancel: &AtomicBool) -> Result<Value, String> {
    let n = o.n_samples;
    let s = o.n_segments;
    let j = equations.len();
    if s == 0
        || n == 0
        || j == 0
        || equations.iter().any(|eq| {
            eq.y.len() != n
                || eq.design.len() != n
                || eq.design.iter().any(|r| r.len() != eq.predictors.len() + 1)
        })
    {
        return Err("Invalid FIMIX equation/sample dimensions".into());
    }
    let designs: Vec<_> = equations
        .iter()
        .map(|eq| matrix::transpose(&eq.design))
        .collect();
    let initial: Vec<_> = equations
        .iter()
        .zip(&designs)
        .map(|(eq, x)| linalg::least_squares(x, &eq.y, None).map(|fit| fit.coefficients))
        .collect::<Result<_, _>>()?;
    let k = s - 1 + s * designs.iter().map(|x| x.len() + 1).sum::<usize>();
    if s == 1 {
        let mut total_ll = 0.0;
        let mut eq_results = serde_json::Map::new();
        let mut r2_map = serde_json::Map::new();
        for ((eq, x), coefficients) in equations.iter().zip(&designs).zip(&initial) {
            let prediction = linalg::matvec(x, coefficients)?;
            let residuals: Vec<_> =
                eq.y.iter()
                    .zip(&prediction)
                    .map(|(y, m)| (y - m) * (y - m))
                    .collect();
            let var = stats::mean(&residuals, None);
            let var = if var == 0.0 { 1e-6 } else { var };
            let densities: Vec<_> =
                eq.y.iter()
                    .zip(prediction)
                    .map(|(&y, m)| logpdf(y, m, var.sqrt()))
                    .collect();
            total_ll += stats::numpy_sum(&densities);
            let r2 = (1.0 - var / yvariance(&eq.y)).max(0.0);
            r2_map.insert(eq.target.clone(), json!(r2));
            eq_results.insert(eq.target.clone(),json!({"coefficients":[coef_map(eq,coefficients)],"variances":[var],"r_squared":[r2]}));
        }
        return Ok(
            json!({"log_likelihood":total_ll,"free_parameters":k,"proportions":[1.0],"segment_sizes":[n],"equation_results":eq_results,"r_squared_per_segment":[r2_map],"weighted_r_squared":r2_map,"posteriors":vec![vec![1.0];n],"converged":true,"iterations":1,"local_optima_detected":false}),
        );
    }
    let mut best = Value::Null;
    let mut best_ll = f64::NEG_INFINITY;
    let mut repetition_lls = Vec::new();
    for rep in 0..o.n_repetitions {
        if cancel.load(Ordering::Relaxed) {
            return Err("FIMIX-PLS cancelled by user.".into());
        }
        let seed = o
            .seed
            .map(|seed| {
                seed.checked_mul(1000)
                    .and_then(|v| rep.checked_mul(17).and_then(|r| v.checked_add(r as u64)))
                    .ok_or("FIMIX seed exceeds native unsigned 64-bit boundary")
            })
            .transpose()?;
        let mut random = rng::Pcg64::from_optional_seed(seed)?;
        let mut post: Vec<_> = (0..n)
            .map(|_| random.dirichlet_ones(s))
            .collect::<Result<_, _>>()?;
        let mut pi = vec![1.0 / s as f64; s];
        let mut betas = vec![vec![Vec::new(); j]; s];
        let mut variances = vec![vec![0.0; j]; s];
        for (e, eq) in equations.iter().enumerate() {
            for segment in 0..s {
                betas[segment][e] = initial[e]
                    .iter()
                    .map(|&b| {
                        b + if segment > 0 {
                            0.05 * random.normal()
                        } else {
                            0.0
                        }
                    })
                    .collect();
                variances[segment][e] = yvariance(&eq.y);
            }
        }
        let mut previous = f64::NEG_INFINITY;
        let mut converged = false;
        let mut iterations = o.max_iter;
        for iteration in 0..o.max_iter {
            if cancel.load(Ordering::Relaxed) {
                return Err("FIMIX-PLS cancelled by user.".into());
            }
            for segment in 0..s {
                pi[segment] =
                    (post.iter().map(|r| r[segment]).sum::<f64>() / n as f64).clamp(1e-6, 1.0);
            }
            let sum = stats::numpy_sum(&pi);
            for p in &mut pi {
                *p /= sum;
            }
            for segment in 0..s {
                let w: Vec<_> = post.iter().map(|r| r[segment]).collect();
                let sum = stats::numpy_sum(&w);
                let roots: Vec<_> = w.iter().map(|v| v.max(1e-12).sqrt()).collect();
                for (e, eq) in equations.iter().enumerate() {
                    if sum > 1e-5 {
                        let design: Vec<Vec<f64>> = designs[e]
                            .iter()
                            .map(|col| col.iter().zip(&roots).map(|(x, w)| x * w).collect())
                            .collect();
                        let y: Vec<_> = eq.y.iter().zip(&roots).map(|(y, w)| y * w).collect();
                        betas[segment][e] = linalg::least_squares(&design, &y, None)?.coefficients;
                        let mean = linalg::matvec(&designs[e], &betas[segment][e])?;
                        variances[segment][e] =
                            (stats::numpy_reduce(0, n, &|i| w[i] * (eq.y[i] - mean[i]).powi(2))
                                / sum)
                                .max(1e-6);
                    } else {
                        variances[segment][e] = 1.0;
                    }
                }
            }
            let mut log_dens = vec![vec![0.0; s]; n];
            for segment in 0..s {
                for (e, eq) in equations.iter().enumerate() {
                    let mean = linalg::matvec(&designs[e], &betas[segment][e])?;
                    let sd = variances[segment][e].sqrt();
                    for i in 0..n {
                        log_dens[i][segment] += logpdf(eq.y[i], mean[i], sd);
                    }
                }
                for row in &mut log_dens {
                    row[segment] += pi[segment].ln();
                }
            }
            let mut log_sums = Vec::with_capacity(n);
            for (row, posterior) in log_dens.iter().zip(&mut post) {
                let max = row.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                let exp: Vec<_> = row.iter().map(|v| (v - max).exp()).collect();
                let sum = stats::numpy_sum(&exp);
                let sum = if sum == 0.0 { 1e-12 } else { sum };
                for (p, value) in posterior.iter_mut().zip(exp) {
                    *p = value / sum;
                }
                log_sums.push(max + sum.max(1e-12).ln());
            }
            let current = stats::numpy_sum(&log_sums);
            if iteration > 0 && (current - previous).abs() / (previous.abs() + 1e-12) < o.tol {
                converged = true;
                iterations = iteration + 1;
                previous = current;
                break;
            }
            previous = current;
        }
        repetition_lls.push(previous);
        if previous > best_ll {
            best_ll = previous;
            let mut order = sort::argsort(&pi);
            order.reverse();
            let sorted_pi: Vec<_> = order.iter().map(|&i| pi[i]).collect();
            let sorted_post: Vec<Vec<f64>> = post
                .iter()
                .map(|row| order.iter().map(|&i| row[i]).collect())
                .collect();
            let mut equations_out = serde_json::Map::new();
            let mut r2_segments = vec![serde_json::Map::new(); s];
            let mut weighted = serde_json::Map::new();
            for (e, eq) in equations.iter().enumerate() {
                let mut coefficients = Vec::new();
                let mut vars = Vec::new();
                let mut r2s = Vec::new();
                let yvar = yvariance(&eq.y);
                for (new, &old) in order.iter().enumerate() {
                    let variance = variances[old][e];
                    let r2 = (1.0 - variance / yvar).max(0.0);
                    coefficients.push(coef_map(eq, &betas[old][e]));
                    vars.push(variance);
                    r2s.push(r2);
                    r2_segments[new].insert(eq.target.clone(), json!(r2));
                }
                let wr2 = sorted_pi
                    .iter()
                    .zip(&r2s)
                    .map(|(p, r2)| p * r2)
                    .sum::<f64>();
                weighted.insert(eq.target.clone(), json!(wr2));
                equations_out.insert(
                    eq.target.clone(),
                    json!({"coefficients":coefficients,"variances":vars,"r_squared":r2s}),
                );
            }
            let mut counts = vec![0; s];
            for row in &sorted_post {
                counts[argmax(row)] += 1;
            }
            best = json!({"log_likelihood":best_ll,"free_parameters":k,"proportions":sorted_pi,"segment_sizes":counts,"equation_results":equations_out,"r_squared_per_segment":r2_segments,"weighted_r_squared":weighted,"posteriors":sorted_post,"converged":converged,"iterations":iterations});
        }
    }
    let valid: Vec<_> = repetition_lls
        .into_iter()
        .filter(|v| v.is_finite())
        .collect();
    let local = valid.len() > 1
        && valid.iter().copied().fold(f64::NEG_INFINITY, f64::max)
            - valid.iter().copied().fold(f64::INFINITY, f64::min)
            > 2.0;
    if !best.is_null() {
        best["local_optima_detected"] = json!(local);
        return Ok(best);
    }
    Ok(
        json!({"log_likelihood":-1e6,"free_parameters":k,"proportions":vec![1.0/s as f64;s],"segment_sizes":vec![n/s;s],"equation_results":{},"r_squared_per_segment":[],"weighted_r_squared":{},"posteriors":vec![vec![1.0/s as f64;s];n],"converged":false,"iterations":o.max_iter,"local_optima_detected":false}),
    )
}

#[derive(Clone, Deserialize)]
#[serde(default)]
pub struct Options {
    pub min_segments: usize,
    pub max_segments: usize,
    pub n_repetitions: usize,
    pub max_iter: usize,
    pub tol: f64,
    pub min_sample_size: usize,
    pub seed: Option<u64>,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            min_segments: 1,
            max_segments: 4,
            n_repetitions: 10,
            max_iter: 2000,
            tol: 1e-5,
            min_sample_size: 54,
            seed: Some(42),
        }
    }
}

pub fn run(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    settings: Value,
    o: Options,
    cancel: &AtomicBool,
    progress: &(dyn Fn(usize) + Sync),
) -> Result<Value, String> {
    if rows.iter().any(|r| r.len() != columns.len()) {
        return Err("Dataset row width differs from columns".into());
    }
    let cfg = model::settings(&settings)?;
    let parsed = model::parse(&spec)?;
    let listwise = cfg["missing_treatment"] == "listwise";
    let prepared = model::prepare_analysis_rows(&columns, rows, &spec, &cfg)?;
    let missing = prepared.has_missing;
    let retained = prepared.retained;
    let rows = prepared.rows;
    let global = pipeline::run_without_fit(columns.clone(), rows.clone(), spec.clone(), cfg)?;
    let scores = global
        .get("construct_scores")
        .unwrap_or(&global["results_pls_original"]["construct_scores"]);
    let n = rows.len();
    let upper = (n / o.min_sample_size.max(10)).max(1);
    let maximum = o.max_segments.min(upper);
    if o.min_segments == 0 || o.min_segments > maximum {
        return Err("No admissible FIMIX segment-count range".into());
    }
    let mut targets: Vec<(String, Vec<String>)> = Vec::new();
    for [from, to] in parsed.paths {
        if let Some((_, preds)) = targets.iter_mut().find(|(id, _)| id == &to) {
            if !preds.contains(&from) {
                preds.push(from);
            }
        } else {
            targets.push((to, vec![from]));
        }
    }
    if targets.is_empty() {
        return Err("Model contains no structural paths into endogenous constructs.".into());
    }
    let vector = |id: &str| -> Result<Vec<f64>, String> {
        scores[id]
            .as_array()
            .ok_or_else(|| format!("FIMIX construct scores '{id}' missing"))
            .map(|v| v.iter().map(model::numeric).collect())
    };
    let mut equations = Vec::new();
    for (target, preds) in &targets {
        let y = vector(target)?;
        let mut design = vec![vec![1.0; n]];
        for pred in preds {
            design.push(vector(pred)?);
        }
        equations.push(Equation {
            target: target.clone(),
            predictors: preds.clone(),
            y,
            design: matrix::transpose(&design),
        });
    }
    let mut solutions = Vec::new();
    let mut table = Vec::new();
    for s in o.min_segments..=maximum {
        if cancel.load(Ordering::Relaxed) {
            return Err("FIMIX-PLS cancelled by user.".into());
        }
        let seed = o
            .seed
            .map(|seed| {
                s.checked_mul(13)
                    .and_then(|v| seed.checked_add(v as u64))
                    .ok_or("FIMIX seed exceeds native unsigned 64-bit boundary")
            })
            .transpose()?;
        let solution = em(
            equations.clone(),
            EmOptions {
                n_segments: s,
                n_samples: n,
                n_repetitions: o.n_repetitions,
                max_iter: o.max_iter,
                tol: o.tol,
                seed,
            },
            cancel,
        )?;
        let ll = solution["log_likelihood"].as_f64().unwrap();
        let k = solution["free_parameters"].as_u64().unwrap() as f64;
        let post: Vec<Vec<f64>> =
            serde_json::from_value(solution["posteriors"].clone()).map_err(|e| e.to_string())?;
        let entropy = if s > 1 {
            -stats::numpy_reduce(0, n * s, &|i| {
                let p = post[i / s][i % s];
                p * p.max(1e-12).ln()
            })
        } else {
            0.0
        };
        let en = if s > 1 {
            (1.0 - entropy / (n as f64 * (s as f64).ln())).clamp(0.0, 1.0)
        } else {
            1.0
        };
        let mut row = json!({"segments":s,"log_likelihood":ll,"free_parameters":k as usize,"entropy_normalized":en,"EN":en,"segment_proportions":solution["proportions"],"segment_sizes":solution["segment_sizes"],"has_small_segment":solution["segment_sizes"].as_array().unwrap().iter().any(|v|v.as_u64().unwrap()<(o.min_sample_size as u64)),"converged":solution["converged"],"iterations":solution["iterations"],"local_optima_detected":solution["local_optima_detected"]});
        for (name, value) in [
            ("aic", -2.0 * ll + 2.0 * k),
            ("aic3", -2.0 * ll + 3.0 * k),
            ("aic4", -2.0 * ll + 4.0 * k),
            ("bic", -2.0 * ll + k * (n as f64).ln()),
            ("caic", -2.0 * ll + k * ((n as f64).ln() + 1.0)),
            ("mdl5", -2.0 * ll + 5.0 * k * (n as f64).ln()),
        ] {
            let value = json!(value);
            row[name] = value.clone();
            row[name.to_uppercase()] = value;
        }
        table.push(row);
        solutions.push(solution);
        progress((s - o.min_segments + 1) * 100 / (maximum - o.min_segments + 1));
    }
    for criterion in ["aic", "aic3", "aic4", "bic", "caic", "mdl5"] {
        let minimum = table
            .iter()
            .map(|r| model::numeric(&r[criterion]))
            .fold(f64::INFINITY, f64::min);
        for row in &mut table {
            row[format!("is_best_{criterion}")] = json!(model::numeric(&row[criterion]) == minimum);
        }
    }
    let max_entropy = table
        .iter()
        .filter(|r| r["segments"].as_u64().unwrap() > 1)
        .map(|r| model::numeric(&r["entropy_normalized"]))
        .reduce(f64::max)
        .unwrap_or(1.0);
    for row in &mut table {
        row["is_best_entropy"] = json!(
            row["segments"].as_u64().unwrap() > 1
                && model::numeric(&row["entropy_normalized"]) == max_entropy
        );
    }
    let best = |name: &str| {
        let mut best = 0;
        for i in 1..table.len() {
            if model::numeric(&table[i][name]) < model::numeric(&table[best][name]) {
                best = i;
            }
        }
        table[best]["segments"].as_u64().unwrap() as usize
    };
    let aic3 = best("aic3");
    let caic = best("caic");
    let bic = best("bic");
    let recommended = if aic3 == caic {
        aic3
    } else if caic > 1 {
        caic
    } else {
        bic
    };
    let mut rationale = if aic3 == caic {
        format!("Segment solution S={recommended} is consistently indicated by both AIC3 and CAIC. This represents the optimal empirical trade-off between model fit and parsimony (Sarstedt et al. 2011).")
    } else {
        format!("AIC3 indicates S={aic3} (tendency to overestimate) while CAIC indicates S={caic} and BIC indicates S={bic} (tendency to underestimate). Following Exhibit 5.3 rules of thumb, consider S={recommended} jointly with segment sizes and entropy.")
    };
    if table[recommended - o.min_segments]["has_small_segment"] == true {
        rationale.push_str(&format!(" WARNING: One or more segments in S={recommended} fall below the minimum statistical power sample size ({}). A more parsimonious solution is strongly recommended.",o.min_sample_size));
    }
    let solution = &solutions[recommended - o.min_segments];
    let posterior: Vec<Vec<f64>> =
        serde_json::from_value(solution["posteriors"].clone()).map_err(|e| e.to_string())?;
    let full_r2 = Value::Object(
        targets
            .iter()
            .map(|(target, _)| {
                (
                    target.clone(),
                    json!(
                        global["structural"]["r_squared"][target]
                            .as_f64()
                            .unwrap_or(0.0)
                    ),
                )
            })
            .collect(),
    );
    let mut result = json!({"endogenous_constructs":targets.iter().map(|(t,_)|t).collect::<Vec<_>>(),"n_samples":n,"min_sample_size_threshold":o.min_sample_size,"theoretical_max_segments":upper,"segment_retention_table":table,"recommended_segments":recommended,"recommendation":rationale,
        "recommended_solution":{"segments":recommended,"proportions":solution["proportions"],"segment_sizes":solution["segment_sizes"],"equation_results":solution["equation_results"],"r_squared_per_segment":solution["r_squared_per_segment"],"weighted_r_squared":solution["weighted_r_squared"],"full_sample_r_squared":full_r2},
        "case_assignments":posterior.iter().map(|r|argmax(r)+1).collect::<Vec<_>>(),"membership_probabilities":solution["posteriors"],"missing_warning":if missing && !listwise {json!("Missing values detected and non-casewise treatment selected. Hair et al. (2018) strongly advise using casewise deletion with FIMIX-PLS, as mean replacement can artificially create missing-value latent segments.")} else {Value::Null},
        "criteria_performance_guide":{"AIC":"Weak; strong tendency to overestimate; use as upper limit","AIC3":"Fair to good; works well in joint combination with CAIC and BIC","AIC4":"Good; tends to both over- and underestimate","BIC":"Good; tends to underestimate; evaluate jointly with AIC3","CAIC":"Good; tends to underestimate; evaluate jointly with AIC3","MDL5":"Weak; strong tendency to underestimate; use as lower limit","EN":"Normed entropy (> 0.50 indicates clear-cut segmentation separation)"}});
    if let Some(retained) = retained {
        result["retained_case_indices"] = json!(retained);
    }
    Ok(result)
}
