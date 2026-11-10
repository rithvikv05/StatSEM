//! Confirmatory tetrad analysis with pivoted-QR selection and seeded inference.
use crate::{inference, linalg, matrix, model, rng, stats};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Serialize)]
pub struct Tetrad {
    original_index: usize,
    indices: [usize; 4],
    pair1: [usize; 2],
    pair2: [usize; 2],
    pair3: [usize; 2],
    pair4: [usize; 2],
    tetrad_name: String,
    label: String,
    names: [String; 4],
}
pub fn definitions(names: &[String]) -> Vec<Tetrad> {
    let p = names.len();
    let mut defs = Vec::new();
    for i in 0..p {
        for j in (i + 1)..p {
            for k in (j + 1)..p {
                for l in (k + 1)..p {
                    let names = [
                        names[i].clone(),
                        names[j].clone(),
                        names[k].clone(),
                        names[l].clone(),
                    ];
                    for (pairs, order) in [
                        ([[i, j], [k, l], [i, k], [j, l]], [i, j, k, l]),
                        ([[i, j], [k, l], [i, l], [j, k]], [i, j, l, k]),
                        ([[i, k], [j, l], [i, l], [j, k]], [i, k, l, j]),
                    ] {
                        let number = defs.len() + 1;
                        let pair_label = |pair: [usize; 2]| {
                            format!(
                                "({},{})",
                                names[[i, j, k, l].iter().position(|v| *v == pair[0]).unwrap()],
                                names[[i, j, k, l].iter().position(|v| *v == pair[1]).unwrap()]
                            )
                        };
                        let label = format!(
                            "τ_{number} {}{} - {}{}",
                            pair_label(pairs[0]),
                            pair_label(pairs[1]),
                            pair_label(pairs[2]),
                            pair_label(pairs[3])
                        );
                        defs.push(Tetrad {
                            original_index: number,
                            indices: [i, j, k, l],
                            pair1: pairs[0],
                            pair2: pairs[1],
                            pair3: pairs[2],
                            pair4: pairs[3],
                            tetrad_name: format!(
                                "τ_{}{}{}{}",
                                order[0] + 1,
                                order[1] + 1,
                                order[2] + 1,
                                order[3] + 1
                            ),
                            label,
                            names: names.clone(),
                        });
                    }
                }
            }
        }
    }
    defs
}
fn values(cov: &[Vec<f64>], defs: &[Tetrad]) -> Vec<f64> {
    defs.iter()
        .map(|t| {
            cov[t.pair1[0]][t.pair1[1]] * cov[t.pair2[0]][t.pair2[1]]
                - cov[t.pair3[0]][t.pair3[1]] * cov[t.pair4[0]][t.pair4[1]]
        })
        .collect()
}
fn covariance(rows: &[Vec<f64>], bootstrap_layout: bool) -> Result<Vec<Vec<f64>>, String> {
    if rows.len() < 2
        || rows.first().is_none_or(Vec::is_empty)
        || rows
            .iter()
            .any(|r| r.len() != rows[0].len() || r.iter().any(|v| !v.is_finite()))
    {
        return Err("CTA requires at least two finite complete cases".into());
    }
    let mut columns = matrix::transpose(rows);
    for column in &mut columns {
        let mean = if bootstrap_layout {
            column.iter().sum::<f64>() / column.len() as f64
        } else {
            stats::mean(column, None)
        };
        for x in column {
            *x -= mean;
        }
    }
    let mut cov = linalg::symmetric_product(&columns, bootstrap_layout)?;
    let factor = 1.0 / (rows.len() - 1) as f64;
    for row in &mut cov {
        for x in row {
            *x *= factor;
        }
    }
    Ok(cov)
}
fn select(cov: &[Vec<f64>], defs: &[Tetrad], p: usize) -> Result<Vec<usize>, String> {
    let expected = p * (p - 3) / 2;
    if defs.len() <= expected {
        return Ok((0..defs.len()).collect());
    }
    let pair_count = p * (p - 1) / 2;
    let pair_index = |[u, v]: [usize; 2]| {
        let (u, v) = (u.min(v), u.max(v));
        u * (2 * p - u - 1) / 2 + v - u - 1
    };
    let mut jacobian = vec![vec![0.0; pair_count]; defs.len()];
    for (row, t) in jacobian.iter_mut().zip(defs) {
        let [p1, p2, p3, p4] = [t.pair1, t.pair2, t.pair3, t.pair4];
        for (pair, value) in [
            (p1, cov[p2[0]][p2[1]]),
            (p2, cov[p1[0]][p1[1]]),
            (p3, -cov[p4[0]][p4[1]]),
            (p4, -cov[p3[0]][p3[1]]),
        ] {
            row[pair_index(pair)] += value;
        }
    }
    let pivots = linalg::pivoted_qr(&matrix::transpose(&jacobian))?;
    let mut selected = pivots[..expected].to_vec();
    selected.sort_unstable();
    Ok(selected)
}
pub fn diagnostics(rows: Vec<Vec<f64>>, names: Vec<String>) -> Result<Value, String> {
    if names.len() < 4 || rows.iter().any(|r| r.len() != names.len()) {
        return Err("Tetrad diagnostics need at least four named columns".into());
    }
    let cov = covariance(&rows, false)?;
    let all = definitions(&names);
    let indices = select(&cov, &all, names.len())?;
    let selected: Vec<_> = indices.iter().map(|&i| all[i].clone()).collect();
    Ok(
        json!({"covariance":cov,"all_tetrads":all,"selected_indices":indices,"selected_tetrads":selected,"values":values(&cov,&selected)}),
    )
}
#[derive(Deserialize)]
#[serde(default)]
pub struct Options {
    pub construct_id: Option<String>,
    pub n_boot: usize,
    pub seed: Option<u64>,
    pub alpha: f64,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            construct_id: None,
            n_boot: 5000,
            seed: Some(42),
            alpha: 0.10,
        }
    }
}

pub fn run(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    o: Options,
    cancel: &AtomicBool,
    progress: &(dyn Fn(usize) + Sync),
) -> Result<Value, String> {
    if rows.iter().any(|r| r.len() != columns.len()) {
        return Err("Dataset row width differs from columns".into());
    }
    let parsed = model::parse(&spec)?;
    let mut results = Vec::new();
    let confidence = ((1.0 - o.alpha) * 100.0) as usize;
    for block in &parsed.blocks {
        if o.construct_id.as_ref().is_some_and(|id| id != &block.id) {
            continue;
        }
        let name = block.name.as_ref().unwrap_or(&block.id);
        let mut inds = Vec::new();
        for iid in &block.indicators {
            let col = &parsed
                .indicators
                .iter()
                .find(|(id, _)| id == iid)
                .unwrap()
                .1;
            if columns.contains(col) && !inds.contains(col) {
                inds.push(col.clone());
            }
        }
        let p = inds.len();
        if p < 4 {
            results.push(json!({"construct_id":block.id,"construct_name":name,"drawn_type":block.measurement_type,"applicable":false,"na_reason":format!("Construct '{name}' has {p} indicators. CTA-PLS requires at least 4 indicators to form vanishing tetrads (Hair et al. 2018). ").trim_end()}));
            continue;
        }
        if o.n_boot == 0 {
            return Err("CTA requires at least one bootstrap sample".into());
        }
        let positions: Vec<_> = inds
            .iter()
            .map(|col| columns.iter().position(|c| c == col).unwrap())
            .collect();
        let x: Vec<Vec<f64>> = rows
            .iter()
            .filter(|r| positions.iter().all(|&j| !r[j].is_null()))
            .map(|r| positions.iter().map(|&j| model::numeric(&r[j])).collect())
            .collect();
        let cov = covariance(&x, false)?;
        let all = definitions(&inds);
        let indices = select(&cov, &all, p)?;
        let defs: Vec<_> = indices.iter().map(|&i| all[i].clone()).collect();
        let r = defs.len();
        let original = values(&cov, &defs);
        let mut minimum = f64::INFINITY;
        for u in 0..p {
            for v in (u + 1)..p {
                let denominator = cov[u][u].sqrt() * cov[v][v].sqrt();
                let correlation = if denominator != 0.0 {
                    cov[u][v] / denominator
                } else {
                    0.0
                };
                minimum = minimum.min(correlation);
            }
        }
        let alpha = o.alpha / r.max(1) as f64;
        let mut draws = vec![Vec::with_capacity(o.n_boot); r];
        let seed = o.seed.filter(|s| *s != 0).unwrap_or(42);
        for (b, seed) in rng::seed_sequence(&rng::integer_entropy(seed), o.n_boot)
            .into_iter()
            .enumerate()
        {
            if cancel.load(Ordering::Relaxed) {
                return Err("CTA-PLS cancelled by user.".into());
            }
            let mut random = rng::Pcg64::new(&[seed]);
            let sample: Vec<_> = (0..x.len())
                .map(|_| {
                    random
                        .bounded(x.len() as u64)
                        .map(|i| x[i as usize].clone())
                })
                .collect::<Result<_, _>>()?;
            let vals = values(&covariance(&sample, true)?, &defs);
            for (draw, value) in draws.iter_mut().zip(vals) {
                draw.push(value);
            }
            if b % 100 == 0 {
                progress(b * 100 / o.n_boot);
            }
        }
        let mut tetrads = Vec::new();
        let mut significant = Vec::new();
        for ((def, draw), original) in defs.iter().zip(draws).zip(original) {
            let sd = stats::std(&draw, None, 1);
            let statistic = if sd > 1e-12 { original / sd } else { 0.0 };
            let pvalue = 2.0 * (1.0 - inference::normal_cdf(statistic.abs()));
            let below = (draw.iter().filter(|&&v| v < original).count() as f64 / draw.len() as f64)
                .clamp(1e-5, 1.0 - 1e-5);
            let z0 = inference::normal_ppf(below);
            let low = (inference::normal_cdf(2.0 * z0 + inference::normal_ppf(alpha / 2.0))
                * 100.0)
                .clamp(0.01, 99.99);
            let high = (inference::normal_cdf(2.0 * z0 + inference::normal_ppf(1.0 - alpha / 2.0))
                * 100.0)
                .clamp(0.01, 99.99);
            let mut sorted = draw.clone();
            sorted.sort_by(f64::total_cmp);
            let low = inference::percentile(&sorted, low / 100.0);
            let high = inference::percentile(&sorted, high / 100.0);
            let includes = low <= 0.0 && high >= 0.0;
            if !includes {
                significant.push(def.original_index);
            }
            tetrads.push(json!({"tetrad_number":def.original_index,"tetrad_name":def.tetrad_name,"tetrad_label":def.label,"indicators":def.names,"original_value":original,"bootstrap_mean":stats::mean(&draw,None),"standard_error":sd,"t_statistic":statistic,"p_value":pvalue,"ci_lower_adjusted":low,"ci_upper_adjusted":high,"includes_zero":includes,"is_significant":!includes}));
        }
        let verdict = if significant.is_empty() {
            "Reflective specification supported"
        } else {
            "Formative specification supported (reflective rejected)"
        };
        let interpretation = if significant.is_empty() {
            format!("All {r} nonredundant vanishing tetrads hold (none of the Bonferroni-adjusted {confidence}% CIs exclude zero). The empirical data support a reflective measurement model (Hair et al. 2018).")
        } else {
            format!("Significant vanishing tetrad(s) detected: {significant:?}. At least one nonredundant tetrad statistically differs from zero at the adjusted {confidence}% level. The reflective null is rejected, supporting a formative specification (Hair et al. 2018; Gudergan et al. 2008).")
        };
        results.push(json!({"construct_id":block.id,"construct_name":name,"drawn_type":block.measurement_type,"applicable":true,"n_indicators":p,"total_possible_tetrads":all.len(),"n_nonredundant_tetrads":r,"min_indicator_correlation":minimum,"indicator_correlations_adequate":minimum>0.10,"bonferroni_alpha":alpha,"verdict":verdict,"interpretation":interpretation,"has_significant_tetrads":!significant.is_empty(),"significant_tetrad_numbers":significant,"tetrads":tetrads}));
    }
    Ok(
        json!({"constructs":results,"n_boot":o.n_boot,"nominal_alpha":o.alpha,"confidence_level":format!("{confidence}%"),"decision_rules_help":{
        "causality_direction":"Do indicators define the construct (formative) or are they consequences of the construct (reflective)?","interchangeability":"Are indicators interchangeable with identical content (reflective) or each capturing a unique facet (formative)?","covariation":"Are indicators expected to covary strongly (reflective) or can they vary independently (formative)?","nomological_net":"Do indicators share the same antecedents and consequences (reflective) or distinct ones (formative)?","source":"Jarvis, MacKenzie & Podsakoff (2003) & Bollen & Diamantopoulos (2017)."},
        "note":"CTA-PLS empirically evaluates vanishing tetrads. Any non-vanishing tetrad rejects reflective measurement in favor of formative, provided theory aligns (Hair et al. 2018)."}),
    )
}
