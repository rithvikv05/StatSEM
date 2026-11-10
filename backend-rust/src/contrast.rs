//! Paired bootstrap linear contrasts and path differences.
use crate::{inference, stats};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct Options {
    pub original_parameters: Value,
    pub samples: Value,
    pub coefficients: Vec<(String, f64)>,
    pub parameter_names: Option<Vec<String>>,
    #[serde(default = "alpha")]
    pub alpha: f64,
    #[serde(default = "tails")]
    pub tails: String,
    #[serde(default = "ci")]
    pub ci_method: String,
}
fn alpha() -> f64 {
    0.05
}
fn tails() -> String {
    "two".into()
}
fn ci() -> String {
    "percentile".into()
}

pub fn compute(o: Options) -> Result<Value, String> {
    if o.coefficients.is_empty() {
        return Err("No parameters selected for contrast calculation".into());
    }
    let mut draws = Vec::new();
    let mut original = 0.0;
    let mut coefficients = serde_json::Map::new();
    for (name, weight) in &o.coefficients {
        original += weight * o.original_parameters[name].as_f64().unwrap_or(0.0);
        coefficients.insert(name.clone(), json!(weight));
        let values = if o.samples.is_array() {
            let names = o
                .parameter_names
                .as_ref()
                .ok_or("parameter_names must be provided for a samples matrix")?;
            let index = names
                .iter()
                .position(|p| p == name)
                .ok_or_else(|| format!("Parameter '{name}' not found in bootstrap samples"))?;
            o.samples
                .as_array()
                .unwrap()
                .iter()
                .map(|row| row[index].as_f64().ok_or("Invalid contrast sample"))
                .collect::<Result<Vec<_>, _>>()?
        } else {
            o.samples[name]
                .as_array()
                .ok_or_else(|| format!("Parameter '{name}' not found in bootstrap samples"))?
                .iter()
                .map(|v| v.as_f64().ok_or("Invalid contrast sample"))
                .collect::<Result<Vec<_>, _>>()?
        };
        draws.push(values);
    }
    let n = draws.iter().map(Vec::len).min().unwrap();
    if n == 0 {
        return Err("No bootstrap samples available for contrast calculation.".into());
    }
    let mut samples = vec![0.0; n];
    for ((_, weight), draw) in o.coefficients.iter().zip(draws) {
        for (value, draw) in samples.iter_mut().zip(draw) {
            *value += weight * draw;
        }
    }
    let se = stats::std(&samples, None, 1);
    let t = if se > 1e-9 { original / se } else { 0.0 };
    let less = samples.iter().filter(|&&s| s <= 0.0).count() as f64 / n as f64;
    let greater = samples.iter().filter(|&&s| s >= 0.0).count() as f64 / n as f64;
    let p = if o.tails == "one" {
        less.min(greater)
    } else {
        (2.0 * less.min(greater)).min(1.0)
    };
    let cis = inference::intervals(original, &samples, None, o.alpha, &o.tails)?;
    let chosen = cis.get(&o.ci_method).unwrap_or(&cis["percentile"]);
    let significance = if p < 0.001 {
        "***"
    } else if p < 0.01 {
        "**"
    } else if p < o.alpha {
        "*"
    } else {
        "ns"
    };
    Ok(
        json!({"contrast_coefficients":coefficients,"original":original,"mean":stats::mean(&samples,None),"se":se,"t_stat":t,"p_value":p,
        "ci_low":chosen[0],"ci_high":chosen[1],"confidence_intervals":cis,"significance":significance,"n_samples":n}),
    )
}
