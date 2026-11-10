//! Regression power and discrete minimum sample sizes, without SciPy runtime.
use crate::{inference, model};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Clone, Deserialize)]
#[serde(default)]
pub struct Options {
    pub n_samples: usize,
    pub n_predictors: usize,
    pub r_squared: Option<f64>,
    pub effect_size_f2: Option<f64>,
    pub alpha: f64,
    pub target_power: f64,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            n_samples: 100,
            n_predictors: 1,
            r_squared: None,
            effect_size_f2: None,
            alpha: 0.05,
            target_power: 0.80,
        }
    }
}
pub fn compute(o: &Options) -> Result<f64, String> {
    let f2 = if let Some(f2) = o.effect_size_f2 {
        f2.max(1e-4)
    } else {
        let Some(r2) = o.r_squared.filter(|r2| *r2 > 0.0) else {
            return Ok(0.0);
        };
        let r2 = r2.clamp(0.001, 0.999);
        r2 / (1.0 - r2)
    };
    let u = o.n_predictors.max(1);
    let v = o.n_samples.saturating_sub(u.saturating_add(1)).max(1);
    inference::regression_power(u as f64, v as f64, f2 * o.n_samples as f64, o.alpha)
}
pub fn minimum(o: &Options) -> Result<usize, String> {
    let mut opts = o.clone();
    opts.n_predictors = opts.n_predictors.max(1);
    if opts.effect_size_f2.is_none() {
        let r2 = opts.r_squared.unwrap_or(0.25).clamp(0.001, 0.999);
        opts.effect_size_f2 = Some(r2 / (1.0 - r2));
    }
    let mut low = opts.n_predictors.saturating_add(5);
    let mut high = 5000;
    opts.n_samples = high;
    if compute(&opts)? < o.target_power {
        return Ok(high);
    }
    while low < high {
        let mid = (low + high) / 2;
        opts.n_samples = mid;
        if compute(&opts)? >= o.target_power {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    Ok(low.min(5000))
}
pub fn ten_times(formative: usize, paths: usize) -> Value {
    let formative = formative.max(1);
    let paths = paths.max(1);
    json!({"ten_times_rule_min_n":10*formative.max(paths),"max_formative_indicators":formative,"max_paths_into_construct":paths,
        "inverse_square_root_method":{"min_path_0_10":(2.486_f64/0.10).powi(2).ceil() as usize,"min_path_0_20":(2.486_f64/0.20).powi(2).ceil() as usize},
        "note":"The 10-times rule is a rough rule of thumb. Modern recommendations favor power analyses based on noncentral F distributions or the inverse square root method (Hair et al. 2017; Kock & Hadaya 2018)."})
}
pub fn table(alpha: f64, target: f64) -> Result<Value, String> {
    let mut rows = Vec::new();
    for predictors in 1..=10 {
        let mut row = json!({"predictors":predictors});
        for r2 in [0.10, 0.25, 0.50, 0.75] {
            row[format!("r2_{}", (r2 * 100.0) as usize)] = json!(minimum(&Options {
                n_predictors: predictors,
                r_squared: Some(r2),
                alpha,
                target_power: target,
                ..Options::default()
            })?);
        }
        rows.push(row);
    }
    Ok(
        json!({"target_power":target,"significance_level":alpha,"table":rows,"reference":"Hair, Hult, Ringle, Sarstedt (2017) Appendix C & Cohen (1992)."}),
    )
}
pub fn evaluate(samples: usize, spec: Value, r2: Value, alpha: f64) -> Result<Value, String> {
    let mut targets: Vec<(String, Vec<String>)> = Vec::new();
    for path in spec["paths"].as_array().into_iter().flatten() {
        let source = model::alias(path, &["from", "from_node"]).unwrap_or("None");
        let target = model::alias(path, &["to", "to_node"]).unwrap_or("None");
        if let Some((_, preds)) = targets.iter_mut().find(|(id, _)| id == target) {
            preds.push(source.into());
        } else {
            targets.push((target.into(), vec![source.into()]));
        }
    }
    let mut evaluations = Vec::new();
    let mut all = true;
    for (target, preds) in targets {
        let o = Options {
            n_samples: samples,
            n_predictors: preds.len(),
            r_squared: Some(0.25),
            alpha,
            ..Options::default()
        };
        let benchmark = compute(&o)?;
        let required = minimum(&o)?;
        let observed = r2[&target].as_f64();
        let observed_power = if let Some(r2) = observed.filter(|r2| *r2 > 0.0) {
            Some(compute(&Options {
                r_squared: Some(r2),
                ..o
            })?)
        } else {
            None
        };
        let adequate = observed_power.unwrap_or(benchmark) >= 0.80;
        all &= adequate;
        evaluations.push(json!({"endogenous_construct":target,"n_predictors":preds.len(),"predictors":preds,"observed_r_squared":observed,"observed_power":observed_power,"power_at_benchmark_r2_0_25":benchmark,"n_required_for_power_80_percent":required,"has_adequate_power":adequate}));
    }
    Ok(
        json!({"n_samples":samples,"alpha":alpha,"construct_evaluations":evaluations,"general_adequate":all}),
    )
}
