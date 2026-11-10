//! Necessary-condition ceilings, bottlenecks, and seeded permutation inference.
use crate::{linalg, matrix::round, model, pipeline, rng, sort, stats};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

pub fn ceiling(x: &[f64], y: &[f64]) -> Result<(Vec<f64>, Vec<f64>, f64, f64), String> {
    if x.is_empty() || x.len() != y.len() || x.iter().chain(y).any(|v| !v.is_finite()) {
        return Err("NCA requires equal nonempty finite vectors".into());
    }
    let (xmin, xmax) = bounds(x);
    let (ymin, ymax) = bounds(y);
    if xmin == xmax || ymin == ymax {
        return Err("NCA requires nonzero ranges for both predictor and outcome.".into());
    }
    let scope = ((xmax - xmin) * (ymax - ymin)).max(1e-12);
    let mut px = Vec::new();
    let mut py = Vec::new();
    let mut high = f64::NEG_INFINITY;
    let indices = sort::argsort(x);
    let mut i = 0;
    while i < indices.len() {
        let mut j = i + 1;
        while j < indices.len() && x[indices[j]] == x[indices[i]] {
            j += 1;
        }
        let group_max = indices[i..j]
            .iter()
            .map(|&k| y[k])
            .fold(f64::NEG_INFINITY, f64::max);
        if group_max > high {
            px.push(x[indices[i]]);
            py.push(group_max);
            high = group_max;
        }
        i = j;
    }
    let mut below = 0.0;
    let mut prev_x = xmin;
    let mut prev_y = ymin;
    for (&x, &y) in px.iter().zip(&py) {
        below += ((x - prev_x) * (prev_y - ymin)).max(0.0);
        prev_x = x;
        prev_y = y;
    }
    below += ((xmax - prev_x) * (prev_y - ymin)).max(0.0);
    let area = (scope - below).max(0.0);
    Ok((px, py, area, area / scope))
}
fn bounds(x: &[f64]) -> (f64, f64) {
    (
        x.iter().copied().fold(f64::INFINITY, f64::min),
        x.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    )
}
fn cr(px: &[f64], py: &[f64], xb: (f64, f64), yb: (f64, f64)) -> Result<(f64, f64, f64), String> {
    let (xmin, xmax) = xb;
    let (ymin, ymax) = yb;
    let (slope, intercept) = if px.len() >= 2 {
        // np.polyfit scales Vandermonde columns before its SVD solve.
        let norm = stats::numpy_sum(&px.iter().map(|x| x * x).collect::<Vec<_>>()).sqrt();
        let ones = (px.len() as f64).sqrt();
        let design = vec![
            px.iter().map(|x| x / norm).collect(),
            vec![1.0 / ones; px.len()],
        ];
        let result = linalg::least_squares(&design, py, None)?;
        (result.coefficients[0] / norm, result.coefficients[1] / ones)
    } else {
        (0.0, py.first().copied().unwrap_or(ymin))
    };
    let step = (xmax - xmin) / 199.0;
    let grid: Vec<_> = (0..200)
        .map(|i| {
            if i == 199 {
                xmax
            } else {
                xmin + i as f64 * step
            }
        })
        .collect();
    let values: Vec<_> = grid
        .iter()
        .map(|x| (slope * x + intercept).clamp(ymin, ymax) - ymin)
        .collect();
    let areas: Vec<_> = (0..199)
        .map(|i| (grid[i + 1] - grid[i]) * (values[i + 1] + values[i]) / 2.0)
        .collect();
    let scope = ((xmax - xmin) * (ymax - ymin)).max(1e-12);
    Ok((
        slope,
        intercept,
        (scope - stats::numpy_sum(&areas)).max(0.0) / scope,
    ))
}
fn rounded_text(x: f64, digits: usize) -> String {
    let text = round(x, digits).to_string();
    if text.contains('.') {
        text
    } else {
        format!("{text}.0")
    }
}
fn bottleneck(px: &[f64], py: &[f64], xb: (f64, f64), yb: (f64, f64)) -> Vec<Value> {
    let (xmin, xmax) = xb;
    let (ymin, ymax) = yb;
    (0..=10).map(|i| {
        let target=ymin+(i as f64*10.0/100.0)*(ymax-ymin);
        let required=px.iter().zip(py).filter(|(_,y)|**y>=target).map(|(x,_)|*x).reduce(f64::min);
        let percentage=required.map(|x|((x-xmin)/(xmax-xmin).max(1e-12)*100.0).clamp(0.0,100.0));
        json!({"outcome_level_pct":i*10,"outcome_value":round(target,4),"required_predictor_pct":percentage.map(|x|format!("{}%",rounded_text(x,1))).unwrap_or("NN".into()),"is_bottleneck":percentage.is_some_and(|v|v>0.0)})
    }).collect()
}
pub fn diagnostics(x: Vec<f64>, y: Vec<f64>) -> Result<Value, String> {
    let (px, py, area, d) = ceiling(&x, &y)?;
    let xb = bounds(&x);
    let yb = bounds(&y);
    let (slope, intercept, cr) = cr(&px, &py, xb, yb)?;
    Ok(
        json!({"peer_x":px,"peer_y":py,"ceiling_area":area,"effect_size_d":d,"slope":slope,"intercept":intercept,"cr_effect_size_d":cr,"bottleneck_table":bottleneck(&px,&py,xb,yb)}),
    )
}

#[derive(Deserialize)]
#[serde(default)]
pub struct Options {
    pub n_permutations: usize,
    pub seed: Option<u64>,
    pub alpha: f64,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            n_permutations: 500,
            seed: Some(42),
            alpha: 0.05,
        }
    }
}

pub fn analyze(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    relationship: [String; 2],
    settings: Value,
    options: Options,
    cancel: &AtomicBool,
) -> Result<Value, String> {
    let [predictor, outcome] = relationship;
    let n = rows.len();
    let result = pipeline::run_without_fit(columns, rows, spec, settings)?;
    let scores = &result["construct_scores"];
    let score = |id: &str| {
        scores[id]
            .as_array()
            .ok_or_else(|| {
                format!("Constructs '{predictor}' and '{outcome}' must exist in the model.")
            })
            .map(|v| v.iter().map(model::numeric).collect::<Vec<_>>())
    };
    let x = score(&predictor)?;
    let y = score(&outcome)?;
    let xb = bounds(&x);
    let yb = bounds(&y);
    let scope = ((xb.1 - xb.0) * (yb.1 - yb.0)).max(1e-12);
    let (px, py, area, d) = ceiling(&x, &y)?;
    let (slope, intercept, dcr) = cr(&px, &py, xb, yb)?;
    let accuracy = x
        .iter()
        .zip(&y)
        .filter(|(x, y)| **y <= slope * **x + intercept + 1e-6)
        .count() as f64
        / x.len() as f64
        * 100.0;
    let seed = options.seed.filter(|s| *s != 0).unwrap_or(42);
    let seeds = rng::seed_sequence(&rng::integer_entropy(seed), options.n_permutations);
    let mut greater = 0;
    for seed in seeds {
        if cancel.load(Ordering::Relaxed) {
            return Err("NCA cancelled by user.".into());
        }
        let perm = rng::Pcg64::new(&[seed]).permutation(y.len());
        let yp: Vec<_> = perm.into_iter().map(|i| y[i]).collect();
        if ceiling(&x, &yp)?.3 >= d {
            greater += 1;
        }
    }
    let p = (greater + 1) as f64 / (options.n_permutations + 1) as f64;
    let necessary = d >= 0.10 && p < options.alpha;
    let magnitude = if d >= 0.50 {
        "large"
    } else if d >= 0.30 {
        "medium"
    } else if d >= 0.10 {
        "small"
    } else {
        "negligible"
    };
    let interpretation=format!("Construct '{predictor}' {} for '{outcome}' (CE-FDH d = {}, p = {}, {magnitude} effect). {}",if necessary {"is a necessary condition"} else {"is not a necessary condition"},rounded_text(d,4),rounded_text(p,4),if necessary {format!("Without sufficient levels of {predictor}, high levels of {outcome} are impossible (Dul 2016).")} else {String::new()});
    Ok(
        json!({"predictor":predictor,"outcome":outcome,"n_samples":n,"scope":round(scope,4),"effect_size_d_ce":round(d,4),"effect_size_d_cr":round(dcr,4),"p_value":round(p,4),"is_necessary":necessary,
        "ce_fdh":{"ceiling_zone_area":round(area,4),"effect_size_d":round(d,4),"p_value":round(p,4),"is_necessary":necessary,"magnitude":magnitude,"accuracy":100.0},
        "cr_fdh":{"slope":round(slope,4),"intercept":round(intercept,4),"effect_size_d":round(dcr,4),"accuracy_pct":round(accuracy,2)},"bottleneck_table":bottleneck(&px,&py,xb,yb),"interpretation":interpretation}),
    )
}
