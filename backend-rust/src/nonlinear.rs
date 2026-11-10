//! Quadratic and moderation diagnostics. Estimation/term expansion is separate.
use crate::{inference, matrix::round, stats};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct QuadraticOptions {
    pub b1_linear: f64,
    pub b2_quad_unstd: f64,
    pub scale: f64,
    pub mean_sq: f64,
    pub predictor_scores: Vec<f64>,
    pub b_linear_stage1: Option<f64>,
    pub f2_info: Option<Value>,
    pub p_value: Option<f64>,
    pub ci_lower: Option<f64>,
    pub ci_upper: Option<f64>,
}

pub fn effect_size(included: f64, excluded: f64, moderation: bool) -> Value {
    let f2 = ((included - excluded) / (1.0 - included).max(1e-12)).max(0.0);
    let magnitude = if f2 >= 0.025 {
        "large"
    } else if f2 >= 0.010 {
        "medium"
    } else if f2 >= 0.005 {
        "small"
    } else {
        "none"
    };
    if moderation {
        json!({"f_squared":f2,"magnitude":magnitude,"r_squared_included":included,"r_squared_excluded":excluded,
            "thresholds":{"small":0.005,"medium":0.010,"large":0.025},"note":"Kenny (2016) thresholds for moderation: 0.005 (small), 0.010 (medium), 0.025 (large)."})
    } else {
        let rating = match magnitude {
            "large" => "Large (>= 0.025)",
            "medium" => "Medium (0.010 - 0.025)",
            "small" => "Small (0.005 - 0.010)",
            _ => "None (< 0.005)",
        };
        json!({"f_squared":f2,"f_squared_raw":f2,"rating":rating,"r2_included":included,"r2_excluded":excluded})
    }
}

/// Python's str(round(float, n)) includes a decimal for integral f64 values.
fn rounded_text(x: f64, digits: usize) -> String {
    let text = round(x, digits).to_string();
    if text.contains('.') || !x.is_finite() {
        text
    } else {
        format!("{text}.0")
    }
}

pub fn quadratic(o: QuadraticOptions) -> Value {
    let b1 = o.b1_linear;
    let b2 = o.b2_quad_unstd;
    let (min, max) = if o.predictor_scores.is_empty() {
        (-2.5, 2.5)
    } else {
        (
            o.predictor_scores
                .iter()
                .copied()
                .fold(f64::INFINITY, f64::min),
            o.predictor_scores
                .iter()
                .copied()
                .fold(f64::NEG_INFINITY, f64::max),
        )
    };
    let turning = (b2.abs() > 1e-9).then(|| -b1 / (2.0 * b2));
    let in_range = turning.is_some_and(|v| min <= v && v <= max);
    let significant = o.p_value.is_some_and(|p| p < 0.05)
        || o.ci_lower
            .zip(o.ci_upper)
            .is_some_and(|(lo, hi)| lo > 0.0 || hi < 0.0);
    let no_curvature = !significant && o.p_value.is_some();
    let shape = if no_curvature {
        "Linear (no significant curvature)"
    } else if b2 < 0.0 {
        "Inverted U-shape (diminishing returns)"
    } else {
        "U-shape (accelerating returns)"
    };
    let interpretation = if no_curvature {
        "The quadratic term is not statistically significant. A linear relationship is supported; the nonlinear term can be disregarded.".to_owned()
    } else {
        let point = if in_range {
            format!(
                "The turning point x* = {} SD lies within the observed range ({} to {}).",
                rounded_text(turning.unwrap(), 3),
                rounded_text(min, 2),
                rounded_text(max, 2)
            )
        } else {
            "The turning point lies outside the observed range; the observed relationship is monotonic within the data.".to_owned()
        };
        let evidence = if significant {
            format!("A significant quadratic effect ({shape}) is observed.")
        } else {
            format!("The estimated quadratic relationship has a {shape}. Statistical significance has not been established.")
        };
        format!("{evidence} {point} Direction and strength of the effect vary depending on the level of the predictor.")
    };
    let marginal:Vec<_> = [("Min (Observed)",min),("-1 SD (Low)",-1.0),("Mean (0 SD)",0.0),("+1 SD (High)",1.0),("Max (Observed)",max)].into_iter().map(|(level,x)| {
        json!({"level":level,"x":x,"slope":b1+2.0*b2*x,"predicted_y":b1*x+b2*(x*x-o.mean_sq)})
    }).collect();
    let low = min.max(-3.0);
    let high = max.min(3.0);
    let step = (high - low) / 50.0;
    let curve:Vec<_>=(0..=50).map(|i| {
        let x=if i==50 {high} else {low+i as f64*step};
        json!({"x":x,"y_nonlinear":b1*x+b2*(x*x-o.mean_sq),"y_linear":o.b_linear_stage1.unwrap_or(b1)*x})
    }).collect();
    let f2 = o.f2_info.unwrap_or(Value::Null);
    json!({"linear_effect":b1,"quadratic_effect":b2,"quadratic_effect_std":b2*o.scale,"scale":o.scale,"mean_sq":o.mean_sq,
        "turning_point":turning,"turning_point_in_range":in_range,"shape":shape,"interpretation":interpretation,
        "marginal_effects":marginal,"curve_points":curve,"f_squared":f2["f_squared"],"f_squared_rating":f2["rating"],
        "p_value":o.p_value,"ci_lower":o.ci_lower,"ci_upper":o.ci_upper,"is_significant":significant})
}

#[derive(Deserialize)]
pub struct SlopesOptions {
    pub beta_source: f64,
    pub beta_moderator: f64,
    pub beta_interaction: f64,
    pub boot_source_reps: Option<Vec<f64>>,
    pub boot_int_reps: Option<Vec<f64>>,
    #[serde(default = "default_alpha")]
    pub alpha: f64,
}
fn default_alpha() -> f64 {
    0.05
}

pub fn slopes(o: SlopesOptions) -> Result<Value, String> {
    if !(0.0..1.0).contains(&o.alpha) {
        return Err("Simple slope alpha must lie between zero and one".into());
    }
    let reps = o.boot_source_reps.zip(o.boot_int_reps);
    if let Some((ref a, ref b)) = reps {
        if a.len() != b.len() {
            return Err("Simple slope bootstrap vectors must have equal lengths".into());
        }
    }
    let values:Vec<_>=[(-1.0,"-1 SD (Low)"),(0.0,"Mean (Average)"),(1.0,"+1 SD (High)")].into_iter().map(|(m,name)| {
        let slope=o.beta_source+o.beta_interaction*m;
        let mut se=None;
        let mut t=None;
        let mut p=None;
        let mut lo=None;
        let mut hi=None;
        if let Some((ref a,ref b))=reps { if !a.is_empty() {
            let mut draws:Vec<_>=a.iter().zip(b).map(|(a,b)|a+b*m).collect();
            let sd=stats::std(&draws,None,1);
            let statistic=if sd>1e-12 {slope/sd} else {0.0};
            se=Some(sd); t=Some(statistic); p=Some(2.0*(1.0-inference::normal_cdf(statistic.abs())));
            draws.sort_by(f64::total_cmp);
            lo=Some(inference::percentile(&draws,o.alpha/2.0));
            hi=Some(inference::percentile(&draws,1.0-o.alpha/2.0));
        } }
        let line:Vec<_>=(0..=20).map(|i| {let x=if i==20 {2.0} else {-2.0+i as f64*0.2}; json!({"x":round(x,2),"y":slope*x+o.beta_moderator*m})}).collect();
        json!({"moderator_level":name,"moderator_value":m,"slope":slope,"standard_error":se,"t_statistic":t,"p_value":p,"ci_lower":lo,"ci_upper":hi,"line_points":line})
    }).collect();
    Ok(json!({"x_range":[-2.0,2.0],"simple_slopes":values}))
}
