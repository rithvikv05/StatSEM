//! Native seeded bootstrap, parameter extraction and inference. Replicate
//! indices remain ordered independently of worker completion order.
use crate::{inference, model, pipeline, rng, stats};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Mutex,
};

type Parameters = Vec<(String, f64)>;
fn put(params: &mut Parameters, key: String, value: f64) {
    if let Some((_, old)) = params.iter_mut().find(|(k, _)| k == &key) {
        *old = value;
    } else {
        params.push((key, value));
    }
}
fn get(params: &Parameters, key: &str) -> f64 {
    params
        .iter()
        .find(|(k, _)| k == key)
        .map_or(0.0, |(_, v)| *v)
}

pub fn extract(result: &Value, spec: &Value, mode: &str) -> Result<Parameters, String> {
    let original_model = model::parse(spec)?;
    let copula_spec = crate::copula::parameter_spec(spec);
    let parsed = model::parse(result.get("_expanded_spec").unwrap_or(&copula_spec))?;
    let mut params = Vec::new();
    let ids: Vec<_> = parsed.blocks.iter().map(|b| &b.id).collect();
    for [from, to] in &original_model.paths {
        put(
            &mut params,
            format!("path:{from}->{to}"),
            result["structural"]["path_coefficients"][to][from]
                .as_f64()
                .unwrap_or(0.0),
        );
    }
    for to in &ids {
        for from in &ids {
            if let Some(value) = result["structural"]["path_coefficients"][*to][*from].as_f64() {
                let key = format!("path:{from}->{to}");
                if !params.iter().any(|(k, _)| k == &key) {
                    put(&mut params, key, value);
                }
            }
        }
    }
    for moderation in result["moderation"]["moderating_effects"]
        .as_array()
        .into_iter()
        .flatten()
    {
        let term = moderation["interaction_term"].as_str().unwrap_or("");
        let target = moderation["target"].as_str().unwrap_or("");
        for slope in moderation["simple_slopes"].as_array().into_iter().flatten() {
            let level = slope["moderator_level"]
                .as_str()
                .unwrap_or("")
                .split(' ')
                .next()
                .unwrap_or("");
            put(
                &mut params,
                format!("simple_slope:{term}->{target}:{level}"),
                slope["slope"].as_f64().unwrap_or(0.0),
            );
        }
    }
    for effect in result["moderation"]["conditional_indirect_effects"]
        .as_array()
        .into_iter()
        .flatten()
    {
        let chain = effect["chain"].as_str().unwrap_or("");
        let moderator = effect["moderator"].as_str().unwrap_or("");
        put(
            &mut params,
            format!("index_of_moderated_mediation:{chain}({moderator})"),
            effect["index_of_moderated_mediation"]
                .as_f64()
                .unwrap_or(0.0),
        );
        for row in effect["conditional_effects"]
            .as_array()
            .into_iter()
            .flatten()
        {
            let level = row["w_label"]
                .as_str()
                .unwrap_or("")
                .split(' ')
                .next()
                .unwrap_or("");
            for (prefix, field) in [
                ("cond_indirect", "indirect_effect"),
                ("cond_direct", "direct_effect"),
                ("cond_total", "total_effect"),
            ] {
                put(
                    &mut params,
                    format!("{prefix}:{chain}({moderator}):{level}"),
                    row[field].as_f64().unwrap_or(0.0),
                );
            }
        }
    }
    for effect in result["gaussian_copula"]["effects_of_correction"]
        .as_array()
        .into_iter()
        .flatten()
    {
        put(
            &mut params,
            format!(
                "gc_diff:{}->{}",
                effect["source"].as_str().unwrap_or(""),
                effect["target"].as_str().unwrap_or("")
            ),
            effect["difference"].as_f64().unwrap_or(0.0),
        );
    }
    for b in &parsed.blocks {
        for iid in &b.indicators {
            if let Some(value) = result["measurement"]["outer_loadings"][&b.id][iid].as_f64() {
                put(&mut params, format!("loading:{}->{iid}", b.id), value);
                put(
                    &mut params,
                    format!("weight:{}->{iid}", b.id),
                    result["measurement"]["outer_weights"][&b.id][iid]
                        .as_f64()
                        .unwrap_or(0.0),
                );
            }
        }
    }
    let summary = result["effects_decomposition"]["effects_summary"]
        .as_array()
        .or_else(|| result["structural"]["effects"].as_array());
    for effect in summary.into_iter().flatten() {
        if let (Some(from), Some(to)) = (effect["from"].as_str(), effect["to"].as_str()) {
            for (prefix, field) in [
                ("total_effect", "total"),
                ("total_indirect", "indirect"),
                ("direct_effect", "direct"),
            ] {
                put(
                    &mut params,
                    format!("{prefix}:{from}->{to}"),
                    effect[field].as_f64().unwrap_or(0.0),
                );
            }
        }
    }
    if mode == "basic" {
        return Ok(params);
    }
    for effect in result["effects_decomposition"]["specific_indirect"]
        .as_array()
        .into_iter()
        .flatten()
    {
        if let Some(path) = effect["path"].as_str() {
            put(
                &mut params,
                format!("specific_indirect:{path}"),
                effect["effect"].as_f64().unwrap_or(0.0),
            );
        }
    }
    for id in &ids {
        if let Some(value) = result["structural"]["r_squared"][*id].as_f64() {
            put(&mut params, format!("r2:{id}"), value);
            if let Some(value) = result["structural"]["r_squared_adj"][*id].as_f64() {
                put(&mut params, format!("r2_adj:{id}"), value);
            }
        }
    }
    for to in &ids {
        for from in &ids {
            if let Some(value) = result["structural"]["f_squared"][*to][*from].as_f64() {
                put(&mut params, format!("f2:{from}->{to}"), value);
            }
        }
    }
    for (prefix, metric) in [
        ("alpha", "cronbachs_alpha"),
        ("rho_a", "rho_a"),
        ("cr", "composite_reliability"),
        ("ave", "ave"),
    ] {
        for id in &ids {
            if let Some(value) = result["reliability_and_validity"][metric][*id].as_f64() {
                put(&mut params, format!("{prefix}:{id}"), value);
            }
        }
    }
    for c1 in &ids {
        for c2 in &ids {
            if c1 != c2 {
                if let Some(value) = result["reliability_and_validity"]["htmt"][*c1][*c2].as_f64() {
                    let mut pair = [*c1, *c2];
                    pair.sort();
                    put(
                        &mut params,
                        format!("htmt:{}<->{}", pair[0], pair[1]),
                        value,
                    );
                }
            }
        }
    }
    Ok(params)
}

#[derive(Deserialize)]
#[serde(default)]
pub struct Options {
    pub n_boot: usize,
    pub seed: Option<u64>,
    pub scheme: String,
    pub max_iter: usize,
    pub tol: f64,
    pub mode: String,
    pub sign_change: String,
    pub test_distribution: String,
    pub significance_level: f64,
    pub tails: String,
    pub ci_method: String,
    pub n_workers: Option<usize>,
    pub sign_alignment: Option<bool>,
    pub alpha: Option<f64>,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            n_boot: 5000,
            seed: Some(42),
            scheme: "path".into(),
            max_iter: 300,
            tol: 1e-7,
            mode: "complete".into(),
            sign_change: "none".into(),
            test_distribution: "t".into(),
            significance_level: 0.05,
            tails: "two".into(),
            ci_method: "bca".into(),
            n_workers: None,
            sign_alignment: None,
            alpha: None,
        }
    }
}

pub fn run(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    options: Options,
) -> Result<Value, String> {
    run_with_control(
        columns,
        rows,
        spec,
        options,
        &AtomicBool::new(false),
        &|_, _| {},
    )
}
pub fn run_with_control(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    mut options: Options,
    cancel: &AtomicBool,
    progress: &(dyn Fn(usize, usize) + Sync),
) -> Result<Value, String> {
    if let Some(alpha) = options.alpha {
        options.significance_level = alpha;
    }
    if options.sign_change == "none" && options.sign_alignment == Some(true) {
        options.sign_change = "construct".into();
    }
    if !(0.0..1.0).contains(&options.significance_level)
        || !["none", "individual", "construct"].contains(&options.sign_change.as_str())
    {
        return Err("Invalid bootstrap settings".into());
    }
    let settings = json!({"inner_weighting":options.scheme,"max_iter":options.max_iter,"tolerance":options.tol,
        "sign_convention":if options.sign_change == "none" { "none" } else { "dominant" },"missing_treatment":"mean"});
    let base = pipeline::run_without_fit(
        columns.clone(),
        rows.clone(),
        spec.clone(),
        settings.clone(),
    )?;
    let original = extract(&base, &spec, &options.mode)?;
    let parsed = model::parse(&spec)?;
    let mut used = Vec::new();
    for b in &parsed.blocks {
        for id in &b.indicators {
            let column = parsed
                .indicators
                .iter()
                .find(|(iid, _)| iid == id)
                .map(|(_, c)| c.clone())
                .unwrap_or(id.clone());
            used.push(column);
        }
    }
    if used.iter().enumerate().any(|(i, c)| used[..i].contains(c)) {
        return Err("Duplicate bootstrap dataset columns require compatibility handling".into());
    }
    let positions: Vec<_> = used
        .iter()
        .map(|c| {
            columns
                .iter()
                .position(|column| column == c)
                .ok_or_else(|| format!("Missing bootstrap column: {c}"))
        })
        .collect::<Result<_, _>>()?;
    let mut clean: Vec<Vec<f64>> = rows
        .iter()
        .map(|row| {
            positions
                .iter()
                .map(|&i| {
                    let value = model::numeric(&row[i]);
                    if value == -99.0 {
                        f64::NAN
                    } else {
                        value
                    }
                })
                .collect()
        })
        .collect();
    for j in 0..used.len() {
        let observed: Vec<_> = clean.iter().map(|r| r[j]).filter(|v| !v.is_nan()).collect();
        let mean = stats::mean(&observed, None);
        if !mean.is_nan() {
            for row in &mut clean {
                if row[j].is_nan() {
                    row[j] = mean;
                }
            }
        }
    }
    let clean: Vec<Vec<Value>> = clean
        .into_iter()
        .filter(|r| r.iter().all(|v| !v.is_nan()))
        .map(|r| r.into_iter().map(|v| json!(v)).collect())
        .collect();
    let n = clean.len();
    let entropy = rng::integer_entropy(options.seed.unwrap_or(42));
    let seeds = rng::seed_sequence(&entropy, options.n_boot);
    let next = AtomicUsize::new(0);
    let samples: Mutex<Vec<Option<Parameters>>> = Mutex::new(vec![None; options.n_boot]);
    let completed = AtomicUsize::new(0);
    let workers = options
        .n_workers
        .unwrap_or_else(|| {
            std::thread::available_parallelism().map_or(1, |n| n.get().saturating_sub(1).max(1))
        })
        .max(1)
        .min(options.n_boot.max(1));
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= seeds.len() {
                    break;
                }
                let mut random = rng::Pcg64::new(&[seeds[i]]);
                let resampled: Vec<_> = (0..n)
                    .map(|_| clean[random.bounded(n as u64).unwrap() as usize].clone())
                    .collect();
                let sample = pipeline::run_without_fit(
                    used.clone(),
                    resampled,
                    spec.clone(),
                    settings.clone(),
                )
                .and_then(|result| extract(&result, &spec, &options.mode))
                .ok()
                .map(|mut params| {
                    align(&mut params, &original, &parsed, &options.sign_change);
                    params
                });
                let mut results = samples.lock().unwrap();
                results[i] = sample;
                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                progress(done, options.n_boot);
            });
        }
    });
    if cancel.load(Ordering::Relaxed) {
        return Err("Bootstrapping was cancelled by the user.".into());
    }
    let samples: Vec<_> = samples
        .into_inner()
        .unwrap()
        .into_iter()
        .flatten()
        .collect();
    let names: Vec<_> = original.iter().map(|(k, _)| k.clone()).collect();
    let mut jack = Vec::<Parameters>::new();
    if options.ci_method == "bca" && n <= 500 {
        let mut settings = settings.clone();
        settings["sign_convention"] = json!("dominant");
        for i in 0..n {
            if cancel.load(Ordering::Relaxed) {
                return Err("Bootstrapping was cancelled by the user.".into());
            }
            let subset = clean
                .iter()
                .enumerate()
                .filter(|(j, _)| *j != i)
                .map(|(_, r)| r.clone())
                .collect();
            if let Ok(result) =
                pipeline::run_without_fit(used.clone(), subset, spec.clone(), settings.clone())
                    .and_then(|r| extract(&r, &spec, &options.mode))
            {
                jack.push(result);
            }
        }
    }
    let mut parameters = Map::new();
    let mut samples_dict = Map::new();
    for (key, &original_value) in original.iter().map(|(k, v)| (k, v)) {
        let distribution: Vec<_> = samples
            .iter()
            .filter_map(|sample| sample.iter().find(|(k, _)| k == key).map(|(_, v)| *v))
            .collect();
        samples_dict.insert(key.clone(), json!(distribution));
        if distribution.is_empty() {
            parameters.insert(key.clone(),json!({"original":original_value,"mean":original_value,"se":0.0,"t_stat":0.0,"p_value":1.0,"ci_low":original_value,"ci_high":original_value,"significance":"ns","df":n.saturating_sub(1)}));
            continue;
        }
        let se = stats::std(&distribution, None, 1);
        let t = if se > 1e-9 { original_value / se } else { 0.0 };
        let df = if key.starts_with("path:") {
            let predictors = base["structural"]["path_coefficients"]
                .as_object()
                .into_iter()
                .flatten()
                .find(|(target, from)| {
                    from.as_object().is_some_and(|from| {
                        from.keys()
                            .any(|from| key == &format!("path:{from}->{target}"))
                    })
                })
                .map(|(_, from)| from.as_object().unwrap().len())
                .unwrap_or(1);
            n.saturating_sub(predictors + 1).max(1)
        } else {
            n.saturating_sub(1).max(1)
        };
        let statistic = if options.tails == "one" { t } else { t.abs() };
        let cdf = if options.test_distribution == "t" {
            inference::student_t_cdf(statistic, df as f64)
        } else {
            inference::normal_cdf(statistic)
        };
        let p = (1.0 - cdf) * if options.tails == "one" { 1.0 } else { 2.0 };
        let jackknife: Vec<_> = jack
            .iter()
            .filter_map(|sample| sample.iter().find(|(k, _)| k == key).map(|(_, v)| *v))
            .collect();
        let intervals = inference::intervals(
            original_value,
            &distribution,
            if jackknife.is_empty() {
                None
            } else {
                Some(&jackknife)
            },
            options.significance_level,
            &options.tails,
        )?;
        let chosen = intervals
            .get(&options.ci_method)
            .unwrap_or(&intervals["percentile"]);
        let significance = if p < 0.001 {
            "***"
        } else if p < 0.01 {
            "**"
        } else if p < options.significance_level {
            "*"
        } else {
            "ns"
        };
        parameters.insert(key.clone(),json!({"original":original_value,"mean":stats::mean(&distribution,None),"se":se,"standard_error":se,
            "t_stat":t,"t_statistic":t,"p_value":p,"ci_low":chosen[0],"ci_lower":chosen[0],"ci_high":chosen[1],"ci_upper":chosen[1],
            "confidence_intervals":intervals,"significance":significance,"df":df}));
    }
    let mut paths = Vec::new();
    for [from, to] in &parsed.paths {
        let mut item = parameters
            .get(&format!("path:{from}->{to}"))
            .cloned()
            .unwrap_or(json!({}));
        item["from"] = json!(from);
        item["to"] = json!(to);
        item["from_name"] = base["construct_names"][from].clone();
        item["to_name"] = base["construct_names"][to].clone();
        paths.push(item);
    }
    for name in &names {
        let pair = base["structural"]["path_coefficients"]
            .as_object()
            .into_iter()
            .flatten()
            .find_map(|(to, from)| {
                from.as_object().and_then(|from| {
                    from.keys()
                        .find(|from| name == &format!("path:{from}->{to}"))
                        .map(|from| (from.as_str(), to.as_str()))
                })
            });
        if let Some((from, to)) = pair {
            if parsed.paths.iter().any(|[a, b]| a == from && b == to) {
                continue;
            }
            let mut item = parameters[name].clone();
            item["from"] = json!(from);
            item["to"] = json!(to);
            item["from_name"] = base["construct_names"]
                .get(from)
                .cloned()
                .unwrap_or(json!(from));
            item["to_name"] = base["construct_names"]
                .get(to)
                .cloned()
                .unwrap_or(json!(to));
            paths.push(item);
        }
    }
    let mut loadings = Vec::new();
    let mut weights = Vec::new();
    for b in &parsed.blocks {
        for iid in &b.indicators {
            for (prefix, output) in [("loading", &mut loadings), ("weight", &mut weights)] {
                if let Some(summary) = parameters.get(&format!("{prefix}:{}->{iid}", b.id)) {
                    let mut item = summary.clone();
                    item["construct"] = json!(b.id);
                    item["indicator"] = json!(iid);
                    item["construct_name"] = base["construct_names"][&b.id].clone();
                    item["indicator_name"] = base["indicator_names"][iid].clone();
                    output.push(item);
                }
            }
        }
    }
    let indirect: Vec<_> = names
        .iter()
        .filter(|k| k.starts_with("specific_indirect:") || k.starts_with("total_indirect:"))
        .map(|k| {
            let mut item = parameters[k].clone();
            item["parameter"] = json!(k);
            item
        })
        .collect();
    let matrix: Vec<Vec<f64>> = samples
        .iter()
        .map(|sample| names.iter().map(|k| get(sample, k)).collect())
        .collect();
    Ok(
        json!({"n_boot":options.n_boot,"actual_samples":samples.len(),"settings":{"mode":options.mode,"sign_change":options.sign_change,
        "test_distribution":options.test_distribution,"significance_level":options.significance_level,"tails":options.tails,"ci_method":options.ci_method},
        "parameters":parameters,"parameter_summary":parameters,"paths":paths,"loadings":loadings,"weights":weights,"indirect_effects":indirect,
        "samples_matrix":matrix,"samples_dict":samples_dict,"parameter_names":names}),
    )
}

fn align(params: &mut Parameters, original: &Parameters, parsed: &model::ParsedModel, mode: &str) {
    if mode == "individual" {
        for (key, value) in params {
            let orig = get(original, key);
            if (orig > 0.0 && *value < 0.0) || (orig < 0.0 && *value > 0.0) {
                *value = -*value;
            }
        }
    } else if mode == "construct" {
        let signs: Vec<_> = parsed
            .blocks
            .iter()
            .map(|b| {
                let prefix = format!("loading:{}->", b.id);
                let mut plus = 0.0;
                let mut minus = 0.0;
                for (key, value) in params.iter().filter(|(key, _)| key.starts_with(&prefix)) {
                    let orig = get(original, key);
                    plus += (value - orig).powi(2);
                    minus += (-value - orig).powi(2);
                }
                (&b.id, if minus < plus { -1.0 } else { 1.0 })
            })
            .collect();
        let sign = |id: &str| {
            signs
                .iter()
                .find(|(c, _)| *c == id)
                .map_or(1.0, |(_, s)| *s)
        };
        for (key, value) in params {
            let components: Vec<_> = key.split(':').nth(1).unwrap_or("").split("->").collect();
            if key.starts_with("loading:") || key.starts_with("weight:") {
                *value *= sign(components[0]);
            } else if (key.starts_with("path:")
                || key.starts_with("total_effect:")
                || key.starts_with("total_indirect:"))
                && components.len() > 1
            {
                *value *= sign(components[0]) * sign(components[1]);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Vec<String>, Vec<Vec<Value>>, Value) {
        let rows = (0..24)
            .map(|i| {
                let x = i as f64;
                vec![json!(x), json!(0.7 * x + (i % 3) as f64)]
            })
            .collect();
        (
            vec!["x".into(), "y".into()],
            rows,
            json!({"constructs":[{"id":"X","name":"X","indicators":["x"]},{"id":"Y","name":"Y","indicators":["y"]}],"paths":[{"from":"X","to":"Y"}]}),
        )
    }
    #[test]
    fn results_are_identical_across_worker_counts() {
        let (columns, rows, spec) = fixture();
        let options = |workers| Options {
            n_boot: 12,
            n_workers: Some(workers),
            ci_method: "percentile".into(),
            ..Options::default()
        };
        let serial = run(columns.clone(), rows.clone(), spec.clone(), options(1)).unwrap();
        let parallel = run(columns, rows, spec, options(3)).unwrap();
        assert_eq!(serial, parallel);
    }
    #[test]
    fn cancellation_discards_partial_result() {
        let (columns, rows, spec) = fixture();
        let cancel = AtomicBool::new(false);
        let result = run_with_control(
            columns,
            rows,
            spec,
            Options {
                n_boot: 50,
                n_workers: Some(2),
                ci_method: "percentile".into(),
                ..Options::default()
            },
            &cancel,
            &|_, _| {
                cancel.store(true, Ordering::Relaxed);
            },
        );
        assert_eq!(
            result.unwrap_err(),
            "Bootstrapping was cancelled by the user."
        );
    }
}
