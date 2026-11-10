//! Gaussian copula ranking and regressor distribution diagnostics.
use crate::{inference, linalg, matrix, model, pipeline, rng, stats};
use serde_json::{json, Value};

pub fn ecdf(values: &[f64], f4: bool, decimals: Option<i32>) -> Vec<f64> {
    let rounded: Vec<_> = values
        .iter()
        .map(|&v| {
            if let Some(d) = decimals {
                let scale = 10f64.powi(d);
                (v * scale).round_ties_even() / scale
            } else {
                v
            }
        })
        .collect();
    let mut sorted = rounded.clone();
    sorted.sort_by(f64::total_cmp);
    let n = sorted.len() as f64;
    rounded
        .iter()
        .map(|v| {
            let count = sorted.partition_point(|x| x <= v) as f64;
            if f4 {
                1.0 / (2.0 * n) + (n - 1.0) / n.powi(2) * count
            } else {
                (count / n).clamp(1e-7, 1.0 - 1e-7)
            }
        })
        .collect()
}
pub fn term(values: &[f64], f4: bool, decimals: Option<i32>) -> Vec<f64> {
    ecdf(values, f4, decimals)
        .into_iter()
        .map(inference::normal_ppf)
        .collect()
}
pub fn transformed(
    columns: &[Vec<f64>],
    endogenous: usize,
    raw: bool,
    f4: bool,
    decimals: Option<i32>,
) -> Result<Vec<Vec<f64>>, String> {
    let n = columns.first().map_or(0, Vec::len);
    if endogenous > columns.len()
        || columns
            .iter()
            .any(|c| c.len() != n || c.iter().any(|x| !x.is_finite()))
    {
        return Err("Invalid copula score matrix".into());
    }
    if endogenous == 0 {
        return Ok(vec![Vec::new(); n]);
    }
    let terms: Vec<_> = columns.iter().map(|c| term(c, f4, decimals)).collect();
    if raw {
        return Ok(matrix::transpose(&terms[..endogenous]));
    }
    let centered: Vec<Vec<_>> = terms
        .iter()
        .map(|c| {
            let mean = stats::mean(c, None);
            c.iter().map(|x| x - mean).collect()
        })
        .collect();
    let mut covariance = linalg::symmetric_product(&centered, true)?;
    for row in &mut covariance {
        for x in row {
            *x /= n as f64 - 1.0;
        }
    }
    let singular =
        linalg::least_squares(&covariance, &vec![0.0; covariance.len()], None)?.singular_values;
    let condition = singular[0] / singular[singular.len() - 1];
    if condition > 1e8 || condition.is_nan() {
        return Err("Copula term for regressor is collinear with the regressors; endogeneity correction not possible".into());
    }
    let inverse = linalg::inverse(&covariance)?;
    let selected: Vec<Vec<_>> = inverse.iter().map(|r| r[..endogenous].to_vec()).collect();
    Ok(matrix::multiply(&matrix::transpose(&terms), &selected))
}
fn cvm_stat(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let n = values.len() as f64;
    let mean = stats::mean(&sorted, None);
    let sd = stats::std(&sorted, None, 1);
    1.0 / (12.0 * n)
        + stats::numpy_reduce(0, values.len(), &|i| {
            ((2.0 * (i + 1) as f64 - 1.0) / (2.0 * n)
                - inference::normal_cdf((sorted[i] - mean) / sd))
            .powi(2)
        })
}
pub fn cvm(values: &[f64], simulations: usize, seed: u64) -> Value {
    if values.len() < 4 || stats::std(values, None, 1) == 0.0 {
        return json!([0.0, 1.0]);
    }
    // Observed mean/std use the original order; simulations use sorted rows.
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let n = values.len() as f64;
    let mean = stats::mean(values, None);
    let sd = stats::std(values, None, 1);
    let observed = 1.0 / (12.0 * n)
        + stats::numpy_reduce(0, values.len(), &|i| {
            ((2.0 * (i + 1) as f64 - 1.0) / (2.0 * n)
                - inference::normal_cdf((sorted[i] - mean) / sd))
            .powi(2)
        });
    let mut generator = rng::Pcg64::new(&rng::integer_entropy(seed));
    let mut exceed = 0;
    for _ in 0..simulations {
        let sample: Vec<_> = (0..values.len()).map(|_| generator.normal()).collect();
        if cvm_stat(&sample) >= observed {
            exceed += 1;
        }
    }
    json!([observed, exceed as f64 / simulations as f64])
}
fn log_cdf(x: f64) -> f64 {
    if x > -35.0 {
        return inference::normal_cdf(x).ln();
    }
    let inverse = 1.0 / (x * x);
    let mut sum = 1.0;
    let mut term = 1.0;
    for k in 1..40 {
        let next = term * -((2 * k - 1) as f64) * inverse;
        if next.abs() > term.abs() {
            break;
        }
        sum += next;
        term = next;
        if term.abs() < sum.abs() * 1e-16 {
            break;
        }
    }
    -x * x / 2.0 - (-x).ln() - 0.5 * (2.0 * std::f64::consts::PI).ln() + sum.ln()
}
pub fn anderson(values: &[f64]) -> Value {
    if values.len() < 5 {
        return json!([0.0, 1.0]);
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let n = values.len() as f64;
    let mean = stats::mean(values, None);
    let sd = stats::std(values, None, 1);
    let statistic = -n
        - stats::numpy_reduce(0, values.len(), &|i| {
            (2.0 * (i + 1) as f64 - 1.0) / n
                * (log_cdf((sorted[i] - mean) / sd)
                    + log_cdf(-(sorted[values.len() - 1 - i] - mean) / sd))
        });
    // The installed SciPy reference interpolates its rounded normal critical
    // values, including the table's bounded 0.01..0.15 p-value range.
    let critical = [0.561, 0.631, 0.752, 0.873, 1.035].map(|v| {
        let x = v / (1.0 + 0.75 / n + 2.25 / n / n);
        (x * 1000.0).round_ties_even() / 1000.0
    });
    let p = [0.15, 0.1, 0.05, 0.025, 0.01];
    let value = if statistic.is_nan() {
        f64::NAN
    } else if statistic <= critical[0] {
        p[0]
    } else if statistic >= critical[4] {
        p[4]
    } else {
        let i = critical.partition_point(|&v| v < statistic) - 1;
        p[i] + (statistic - critical[i]) * (p[i + 1] - p[i]) / (critical[i + 1] - critical[i])
    };
    json!([statistic, value])
}

pub fn wald(coefficients: &Value, samples: &Value, targets: &Value) -> Result<Value, String> {
    let mut tests = Vec::new();
    let mut all = Vec::new();
    for (target, terms) in targets.as_object().into_iter().flatten() {
        let terms: Vec<_> = terms
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        if terms.is_empty() {
            continue;
        }
        let pairs: Vec<_> = terms
            .iter()
            .map(|term| (target.clone(), term.clone()))
            .collect();
        tests.push(wald_row(
            target,
            terms.join(", "),
            &pairs,
            coefficients,
            samples,
        )?);
        all.extend(pairs);
    }
    if !all.is_empty() {
        tests.push(wald_row(
            "Overall",
            all.iter()
                .map(|(t, c)| format!("{c}->{t}"))
                .collect::<Vec<_>>()
                .join(", "),
            &all,
            coefficients,
            samples,
        )?);
    }
    Ok(json!(tests))
}

pub fn attach(mut result: Value, boot: Value) -> Result<Value, String> {
    let Some(gc) = result.get_mut("gaussian_copula").filter(|v| v.is_object()) else {
        return Ok(result);
    };
    let mut parameters = boot["parameter_summary"]
        .as_object()
        .filter(|m| !m.is_empty())
        .or_else(|| boot["parameters"].as_object())
        .cloned()
        .unwrap_or_default();
    for path in boot["paths"].as_array().into_iter().flatten() {
        if let (Some(from), Some(to)) = (path["from"].as_str(), path["to"].as_str()) {
            parameters.insert(format!("path:{from}->{to}"), path.clone());
        }
    }
    let samples = boot["samples_dict"]
        .as_object()
        .filter(|m| !m.is_empty())
        .map(|m| Value::Object(m.clone()))
        .unwrap_or_else(|| boot["samples"].clone());
    let targets = gc["target_to_gc_names"].clone();
    for row in gc
        .get_mut("endogeneity_tests")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        let name = row["gc_construct"].as_str().unwrap_or("");
        let target = targets
            .as_object()
            .into_iter()
            .flatten()
            .find(|(_, names)| {
                names
                    .as_array()
                    .is_some_and(|names| names.iter().any(|n| n == name))
            })
            .map(|(key, _)| key.as_str())
            .unwrap_or_else(|| row["target"].as_str().unwrap_or(""));
        if let Some(summary) = parameters
            .get(&format!("path:{name}->{target}"))
            .or_else(|| parameters.get(&format!("{name} -> {target}")))
            .filter(|v| v.as_object().is_some_and(|v| !v.is_empty()))
        {
            row["mean"] = json!(matrix::round(
                summary["mean"]
                    .as_f64()
                    .unwrap_or_else(|| row["original"].as_f64().unwrap_or(0.0)),
                4
            ));
            for (field, default) in [
                ("se", 0.0),
                ("t_stat", 0.0),
                ("p_value", 1.0),
                ("ci_lower", 0.0),
                ("ci_upper", 0.0),
            ] {
                row[field] = json!(matrix::round(summary[field].as_f64().unwrap_or(default), 4));
            }
            row["is_significant"] = json!(row["p_value"].as_f64().unwrap_or(1.0) < 0.05);
        }
    }
    for row in gc
        .get_mut("effects_of_correction")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        let key = format!(
            "gc_diff:{}->{}",
            row["source"].as_str().unwrap_or(""),
            row["target"].as_str().unwrap_or("")
        );
        if let Some(draws) = samples[&key].as_array().filter(|v| !v.is_empty()) {
            let mut draws: Vec<_> = draws.iter().map(model::numeric).collect();
            let se = stats::std(&draws, None, 1);
            draws.sort_by(f64::total_cmp);
            let t = row["difference"].as_f64().unwrap_or(0.0) / if se == 0.0 { 1e-9 } else { se };
            row["diff_se"] = json!(matrix::round(se, 4));
            row["diff_ci_lower"] = json!(matrix::round(inference::percentile(&draws, 0.025), 4));
            row["diff_ci_upper"] = json!(matrix::round(inference::percentile(&draws, 0.975), 4));
            row["diff_pvalue"] = json!(matrix::round(
                2.0 * (1.0 - inference::normal_cdf(t.abs())),
                4
            ));
        }
    }
    let mut tests = wald(&gc["orig_gc_coefs"], &samples, &targets)?;
    let order: Vec<_> = gc["wald_tests"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| row["target"].as_str().map(str::to_string))
        .collect();
    tests.as_array_mut().unwrap().sort_by_key(|row| {
        order
            .iter()
            .position(|target| row["target"] == *target)
            .unwrap_or(usize::MAX)
    });
    if let Some(original) = gc["wald_tests"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|row| row["target"] == "Overall")
    {
        if let Some(overall) = tests
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|row| row["target"] == "Overall")
        {
            if let Some(label) = original.get("gc_terms").filter(|v| v.is_string()) {
                overall["gc_terms"] = label.clone();
            }
        }
    }
    gc["wald_tests"] = tests;
    Ok(result)
}
fn wald_row(
    target: &str,
    label: String,
    pairs: &[(String, String)],
    coefficients: &Value,
    samples: &Value,
) -> Result<Value, String> {
    let mut draws = Vec::new();
    let mut g = Vec::new();
    for (target, term) in pairs {
        g.push(coefficients[term].as_f64().unwrap_or(0.0));
        let values = samples[format!("path:{term}->{target}")].as_array();
        draws.push(
            values
                .filter(|v| !v.is_empty())
                .map(|v| v.iter().map(model::numeric).collect())
                .unwrap_or_else(|| vec![0.0; 10]),
        );
    }
    let n = draws[0].len();
    if draws.iter().any(|d| d.len() != n) {
        return Err("Wald bootstrap draw counts differ".into());
    }
    let mut statistic = None;
    let mut p = None;
    let mut note = "Requires bootstrap to compute covariance matrix V";
    if n > 1 {
        note = "Covariance matrix singular; not computable";
        let centered: Vec<Vec<_>> = draws
            .iter()
            .map(|d| {
                let mean = stats::mean(d, None);
                d.iter().map(|v| v - mean).collect()
            })
            .collect();
        let mut covariance = linalg::symmetric_product(&centered, false)?;
        for row in &mut covariance {
            for v in row {
                *v /= n as f64 - 1.0;
            }
        }
        let singular =
            linalg::least_squares(&covariance, &vec![0.0; g.len()], None)?.singular_values;
        let condition = singular[0] / singular[singular.len() - 1];
        if condition <= 1e12 {
            if let Ok(inverse) = linalg::inverse(&covariance) {
                let transformed = linalg::matvec(&matrix::transpose(&inverse), &g)?;
                let w = g.iter().zip(transformed).map(|(a, b)| a * b).sum::<f64>();
                let prob = chi_square_sf(w, g.len());
                statistic = Some(matrix::round(w, 4));
                p = Some(matrix::round(prob, 4));
                note="Significant result indicates endogeneity. Researchers should keep and interpret the copula model estimates even when GC terms are not significant due to low power.";
            }
        }
    }
    Ok(
        json!({"target":target,"gc_terms":label,"statistic":statistic,"df":g.len(),"p_value":p,"is_significant":p.is_some_and(|p|p<0.05),"note":note}),
    )
}
fn chi_square_sf(value: f64, df: usize) -> f64 {
    if value <= 0.0 {
        return 1.0;
    }
    let z = value / 2.0;
    let (mut a, mut q, mut density) = if df.is_multiple_of(2) {
        (1.0, (-z).exp(), z * (-z).exp())
    } else {
        (
            0.5,
            2.0 * inference::normal_cdf(-value.sqrt()),
            (z / std::f64::consts::PI).sqrt() * (-z).exp() * 2.0,
        )
    };
    while a < (df as f64) / 2.0 {
        q += density;
        a += 1.0;
        density *= z / a;
    }
    q.min(1.0)
}
struct Gc {
    source: String,
    target: String,
    source_name: String,
    target_name: String,
    name: String,
    indicator: String,
}
fn normalize(spec: &Value) -> Vec<Gc> {
    let constructs = spec["constructs"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let resolve = |text: &str| {
        if constructs.iter().any(|c| c["id"] == text) {
            return text.to_string();
        }
        constructs
            .iter()
            .rev()
            .find(|c| c["name"] == text)
            .and_then(|c| c["id"].as_str())
            .unwrap_or(text)
            .to_string()
    };
    let name = |id: &str| {
        constructs
            .iter()
            .find(|c| c["id"] == id)
            .and_then(|c| model::alias(c, &["name", "id"]))
            .unwrap_or(id)
            .to_string()
    };
    let mut out = Vec::new();
    for gc in ["gaussian_copulas", "gaussianCopulas"]
        .iter()
        .find_map(|k| spec[*k].as_array().filter(|v| !v.is_empty()))
        .into_iter()
        .flatten()
    {
        if !gc.is_object() {
            continue;
        }
        let source = resolve(
            model::alias(gc, &["source_construct", "sourceConstruct", "source"]).unwrap_or(""),
        );
        let target = resolve(
            model::alias(gc, &["target_construct", "targetConstruct", "target"]).unwrap_or(""),
        );
        let source_name = name(&source);
        let target_name = name(&target);
        let gcname = format!("GC ({source_name} -> {target_name})");
        let indicator = format!("gc_{source}_{target}");
        out.push(Gc {
            source,
            target,
            source_name,
            target_name,
            name: gcname,
            indicator,
        });
    }
    out
}
fn standardize(values: &[f64]) -> Vec<f64> {
    let mean = stats::mean(values, None);
    let sd = stats::std(values, None, 1);
    values
        .iter()
        .map(|v| {
            if sd > 1e-12 {
                (v - mean) / sd
            } else {
                v - mean
            }
        })
        .collect()
}

pub(crate) fn parameter_spec(spec: &Value) -> Value {
    let mut expanded = spec.clone();
    for gc in normalize(spec) {
        expanded["constructs"].as_array_mut().unwrap().push(json!({"id":gc.name,"name":gc.name,"indicators":[gc.indicator],"type":"reflective","outer_mode":"A"}));
        if !expanded["indicators"].is_array() {
            expanded["indicators"] = json!([]);
        }
        expanded["indicators"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":gc.indicator,"column":gc.indicator}));
        expanded["paths"]
            .as_array_mut()
            .unwrap()
            .push(json!({"from":gc.name,"to":gc.target}));
    }
    expanded
}

fn diagnostics(values: &[f64], id: &str, role: &str, distinct: Option<usize>) -> Value {
    let n = values.len();
    let mean = stats::mean(values, None);
    let variance = stats::variance(values, None, 0);
    let skew =
        stats::numpy_reduce(0, n, &|i| (values[i] - mean).powi(3)) / n as f64 / variance.powf(1.5);
    let kurt =
        stats::numpy_reduce(0, n, &|i| (values[i] - mean).powi(4)) / n as f64 / variance.powi(2)
            - 3.0;
    let ad = anderson(values);
    let cvm = cvm(values, 2000, 42);
    let normal =
        ad[1].as_f64().unwrap_or(f64::NAN) >= 0.05 && cvm[1].as_f64().unwrap_or(f64::NAN) >= 0.05;
    let mut flags = Vec::new();
    if normal {
        flags.push("Regressor appears normally distributed; the Gaussian copula approach needs sufficient non-normality.".into());
    }
    if n < 200 {
        flags.push(format!(
            "Small sample size (n = {n} < 200); copula estimates can be biased."
        ));
    }
    if let Some(distinct) = distinct.filter(|d| *d < 10) {
        flags.push(format!(
            "Construct has only {distinct} distinct values; caution with ties."
        ));
    }
    json!({"construct":id,"role":role,"skewness":matrix::round(skew,4),"excess_kurtosis":matrix::round(kurt,4),"ad_stat":ad[0].as_f64().map(|v|matrix::round(v,4)),"ad_pvalue":ad[1].as_f64().map(|v|matrix::round(v,4)),"cvm_stat":cvm[0].as_f64().map(|v|matrix::round(v,4)),"cvm_pvalue":cvm[1].as_f64().map(|v|matrix::round(v,4)),"corr_copula":matrix::round(stats::correlation(values,&term(values,true,Some(12)),None),4),"is_non_normal":!normal,"flag":if flags.is_empty(){"Adequate non-normality".into()}else{flags.join(" | ")}})
}

pub fn run(
    mut columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    settings: Value,
    compute_fit: bool,
) -> Result<Value, String> {
    let cfg = model::settings(&settings)?;
    let prepared = model::prepare_analysis_rows(&columns, rows, &spec, &cfg)?;
    let mut rows = prepared.rows;
    let gcs = normalize(&spec);
    let mut base_spec = spec.clone();
    base_spec["gaussian_copulas"] = json!([]);
    base_spec["gaussianCopulas"] = json!([]);
    let fit = |columns, rows, spec| {
        if compute_fit {
            pipeline::run(columns, rows, spec, cfg.clone())
        } else {
            pipeline::run_without_fit(columns, rows, spec, cfg.clone())
        }
    };
    let mut first = fit(columns.clone(), rows.clone(), base_spec.clone())?;
    let source_scores = first["construct_scores"]
        .as_object()
        .filter(|m| !m.is_empty())
        .or_else(|| first["results_pls_original"]["construct_scores"].as_object())
        .ok_or("Copula stage 1 has no construct scores")?;
    let scores: std::collections::HashMap<String, Vec<f64>> = source_scores
        .iter()
        .map(|(id, v)| {
            (
                id.clone(),
                standardize(
                    &v.as_array()
                        .into_iter()
                        .flatten()
                        .map(model::numeric)
                        .collect::<Vec<_>>(),
                ),
            )
        })
        .collect();
    let f4 = cfg["gc"]["ecdf"] == "F4";
    let transform = cfg["gc"]["copula_transform"].as_str().unwrap();
    let decimals = cfg["gc"]["round_decimals"].as_i64().map(|d| d as i32);
    let unscaled = cfg["gc"]["scale_normalization"] == "unscaled";
    let parsed = model::parse(&base_spec)?;
    let mut targets = Vec::new();
    for gc in &gcs {
        if !targets.contains(&gc.target) {
            targets.push(gc.target.clone());
        }
    }
    let mut roles: Vec<(String, String)> = Vec::new();
    let mut copulas = std::collections::HashMap::new();
    let mut scales = std::collections::HashMap::new();
    for target in targets {
        let selected: Vec<_> = gcs.iter().filter(|g| g.target == target).collect();
        let p: Vec<_> = selected.iter().map(|g| g.source.clone()).collect();
        let mut preds = Vec::new();
        for [from, to] in &parsed.paths {
            if to == &target && !preds.contains(from) {
                preds.push(from.clone());
            }
        }
        for effect in ["moderating_effects", "moderatingEffects"]
            .iter()
            .find_map(|key| base_spec[*key].as_array().filter(|v| !v.is_empty()))
            .into_iter()
            .flatten()
        {
            if model::alias(effect, &["target", "outcome"]) == Some(target.as_str()) {
                let term = effect["interaction_term"]
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| {
                        format!(
                            "{} x {}",
                            effect["moderator"].as_str().unwrap_or("None"),
                            effect["source"].as_str().unwrap_or("None")
                        )
                    });
                if scores.contains_key(&term) {
                    preds.push(term);
                }
            }
        }
        let w: Vec<_> = preds.into_iter().filter(|pred| !p.contains(pred)).collect();
        for cid in &p {
            if let Some((_, role)) = roles.iter_mut().find(|(id, _)| id == cid) {
                *role = "Endogenous (P)".into();
            } else {
                roles.push((cid.clone(), "Endogenous (P)".into()));
            }
        }
        for cid in &w {
            if !roles.iter().any(|(id, _)| id == cid) {
                roles.push((cid.clone(), "Exogenous (W)".into()));
            }
        }
        let values: Vec<_> = p
            .iter()
            .chain(&w)
            .map(|id| {
                scores
                    .get(id)
                    .cloned()
                    .ok_or_else(|| format!("Unknown copula regressor {id}"))
            })
            .collect::<Result<_, _>>()?;
        let transformed = match transformed(
            &values,
            p.len(),
            w.is_empty() || transform == "raw",
            f4,
            decimals,
        ) {
            Ok(v) => v,
            Err(error) if error.contains("collinear") => {
                first["gaussian_copula"] = json!({"error":error,"banner":error,"collinear":true});
                return Ok(first);
            }
            Err(error) => return Err(error),
        };
        for (i, gc) in selected.iter().enumerate() {
            let values: Vec<_> = transformed.iter().map(|r| r[i]).collect();
            scales.insert(gc.name.clone(), stats::std(&values, None, 1));
            copulas.insert(gc.indicator.clone(), standardize(&values));
        }
    }
    let mut diagnostic_rows = Vec::new();
    if compute_fit {
        for (id, role) in roles {
            let distinct = spec["constructs"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|c| c["id"] == id)
                .and_then(|c| c["indicators"].as_array())
                .filter(|v| v.len() == 1)
                .and_then(|v| v[0].as_str())
                .and_then(|name| columns.iter().position(|c| c == name))
                .map(|j| crate::grouping::distinct(&rows, j).len());
            diagnostic_rows.push(diagnostics(&scores[&id], &id, &role, distinct));
        }
    }
    for gc in &gcs {
        if let Some(j) = columns.iter().position(|c| c == &gc.indicator) {
            for (i, row) in rows.iter_mut().enumerate() {
                row[j] = json!(copulas[&gc.indicator][i]);
            }
        } else {
            columns.push(gc.indicator.clone());
            for (i, row) in rows.iter_mut().enumerate() {
                row.push(json!(copulas[&gc.indicator][i]));
            }
        }
        base_spec["constructs"].as_array_mut().ok_or("Missing constructs")?.push(json!({"id":gc.name,"name":gc.name,"type":"reflective","outer_mode":"A","indicators":[gc.indicator],"is_copula":true}));
        if !base_spec["indicators"].is_array() {
            base_spec["indicators"] = json!([]);
        }
        base_spec["indicators"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":gc.indicator,"name":gc.indicator,"column":gc.indicator}));
        base_spec["paths"]
            .as_array_mut()
            .ok_or("Missing paths")?
            .push(json!({"from":gc.name,"to":gc.target}));
    }
    let mut second = fit(columns, rows, base_spec)?;
    let mut tests = Vec::new();
    let mut effects = Vec::new();
    let mut coefficients = serde_json::Map::new();
    let mut target_names = json!({});
    for gc in &gcs {
        let scale = scales[&gc.name];
        if unscaled && scale > 1e-12 {
            for key in ["path_coefficients", "total_effects"] {
                if let Some(value) = second["structural"][key][&gc.target][&gc.name].as_f64() {
                    second["structural"][key][&gc.target][&gc.name] = json!(value / scale);
                }
            }
        }
        let beta = second["structural"]["path_coefficients"][&gc.target][&gc.name]
            .as_f64()
            .unwrap_or(0.0);
        coefficients.insert(gc.name.clone(), json!(beta));
        if !target_names[&gc.target].is_array() {
            target_names[&gc.target] = json!([]);
        }
        target_names[&gc.target]
            .as_array_mut()
            .unwrap()
            .push(json!(gc.name));
        let path = format!("{} -> {}", gc.source_name, gc.target_name);
        tests.push(json!({"source":gc.source_name,"target":gc.target_name,"path":path,"gc_construct":gc.name,"original":matrix::round(beta,4),"mean":null,"se":null,"t_stat":null,"p_value":null,"ci_lower":null,"ci_upper":null,"is_significant":false}));
        let b1 = first["structural"]["path_coefficients"][&gc.target][&gc.source]
            .as_f64()
            .unwrap_or(0.0);
        let b2 = second["structural"]["path_coefficients"][&gc.target][&gc.source]
            .as_f64()
            .unwrap_or(0.0);
        effects.push(json!({"source":gc.source_name,"target":gc.target_name,"path":path,"beta_s1":matrix::round(b1,4),"beta_s2":matrix::round(b2,4),"difference":matrix::round(b2-b1,4),"diff_se":null,"diff_ci_lower":null,"diff_ci_upper":null,"diff_pvalue":null}));
    }
    let coefficients = Value::Object(coefficients);
    let mut wald = wald(&coefficients, &json!({}), &target_names)?;
    // JSON object storage is sorted; response rows follow definition order.
    wald.as_array_mut().unwrap().sort_by_key(|row| {
        gcs.iter()
            .position(|gc| row["target"] == gc.target)
            .unwrap_or(usize::MAX)
    });
    let mut ordered_targets = Vec::new();
    for gc in &gcs {
        if !ordered_targets.contains(&gc.target) {
            ordered_targets.push(gc.target.clone());
        }
    }
    let mut all_terms = Vec::new();
    for target in ordered_targets {
        for gc in gcs.iter().filter(|gc| gc.target == target) {
            all_terms.push(format!("{}->{}", gc.name, gc.target));
        }
    }
    if let Some(overall) = wald
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|row| row["target"] == "Overall")
    {
        overall["gc_terms"] = json!(all_terms.join(", "));
    }
    second["gaussian_copula"] = json!({"endogeneity_tests":tests,"wald_tests":wald,"regressor_diagnostics":diagnostic_rows,"effects_of_correction":effects,"settings":cfg["gc"],"target_to_gc_names":target_names,"orig_gc_coefs":coefficients});
    if let Some(retained) = prepared.retained {
        second["retained_case_indices"] = json!(retained);
    }
    second["vif"] = second["structural"]
        .get("inner_vif")
        .cloned()
        .unwrap_or_else(|| json!({}));
    second["stage1"] = json!({"r_squared":first["structural"]["r_squared"],"path_coefficients":first["structural"]["path_coefficients"]});
    for key in [
        "construct_reliability",
        "reliability",
        "discriminant_validity",
        "htmt",
        "fornell_larcker",
    ] {
        if let Some(table) = second.get_mut(key).and_then(Value::as_object_mut) {
            for gc in &gcs {
                table.remove(&gc.name);
            }
        }
    }
    for key in [
        "cronbachs_alpha",
        "composite_reliability",
        "rho_a",
        "ave",
        "fornell_larcker",
        "htmt",
    ] {
        if let Some(table) = second
            .get_mut("reliability_and_validity")
            .and_then(|v| v.get_mut(key))
            .and_then(Value::as_object_mut)
        {
            for gc in &gcs {
                table.remove(&gc.name);
            }
            if ["fornell_larcker", "htmt"].contains(&key) {
                for row in table.values_mut().filter_map(Value::as_object_mut) {
                    for gc in &gcs {
                        row.remove(&gc.name);
                    }
                }
            }
        }
    }
    Ok(second)
}
