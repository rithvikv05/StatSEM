//! Observable explanations of latent segments: overlap, logits and group fits.
use crate::{grouping, inference, linalg, matrix, model, pipeline};
use serde_json::{json, Map, Value};

pub fn merge(values: Vec<Value>, mapping: Vec<(Value, Value)>, minimum: usize) -> Value {
    let merged: Vec<_> = values
        .into_iter()
        .map(|v| {
            mapping
                .iter()
                .find(|(key, _)| grouping::equal(key, &v))
                .map_or(v, |(_, value)| value.clone())
        })
        .collect();
    let mut counts: Vec<(Value, usize)> = Vec::new();
    for value in &merged {
        if !value.is_null() {
            if let Some((_, count)) = counts.iter_mut().find(|(v, _)| grouping::equal(v, value)) {
                *count += 1;
            } else {
                counts.push((value.clone(), 1));
            }
        }
    }
    counts.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    let small = counts.iter().any(|(_, n)| *n < minimum);
    let warning = small.then(|| {
        let entries: Vec<_> = counts
            .iter()
            .map(|(v, n)| {
                let repr = if let Value::String(s) = v {
                    let quote = if s.contains('\'') && !s.contains('"') {
                        '"'
                    } else {
                        '\''
                    };
                    let mut out = quote.to_string();
                    for c in s.chars() {
                        match c {
                            '\\' => out.push_str("\\\\"),
                            '\n' => out.push_str("\\n"),
                            '\r' => out.push_str("\\r"),
                            '\t' => out.push_str("\\t"),
                            c if c == quote => {
                                out.push('\\');
                                out.push(c);
                            }
                            c => out.push(c),
                        }
                    }
                    out.push(quote);
                    out
                } else {
                    grouping::label(v)
                };
                format!("{repr}: {n}")
            })
            .collect();
        format!(
            "One or more merged groups have sample sizes below threshold ({minimum}): {{{}}}",
            entries.join(", ")
        )
    });
    let counts: Map<_, _> = counts
        .iter()
        .map(|(v, n)| (grouping::label(v), json!(n)))
        .collect();
    json!({"merged_series":merged,"group_counts":counts,"has_small_groups":small,"warning":warning})
}

fn sorted_unique(values: &[Value]) -> Vec<Value> {
    let mut out = Vec::new();
    for value in values {
        if !value.is_null() && !out.iter().any(|v| grouping::equal(v, value)) {
            out.push(value.clone());
        }
    }
    out.sort_by(|a, b| {
        if a.is_number() && b.is_number() {
            model::numeric(a).total_cmp(&model::numeric(b))
        } else {
            grouping::label(a).cmp(&grouping::label(b))
        }
    });
    out
}
pub fn overlap(segments: Vec<i64>, categories: Vec<Value>) -> Result<Value, String> {
    if segments.len() != categories.len() {
        return Err("Segment and category counts differ".into());
    }
    if categories.iter().any(Value::is_null) {
        return Err("Overlap requires nonmissing categories".into());
    }
    let mut unique = segments.clone();
    unique.sort();
    unique.dedup();
    let cats = sorted_unique(&categories);
    let counts: Vec<Vec<usize>> = cats
        .iter()
        .map(|c| {
            unique
                .iter()
                .map(|s| {
                    categories
                        .iter()
                        .zip(&segments)
                        .filter(|(cat, seg)| grouping::equal(c, cat) && s == *seg)
                        .count()
                })
                .collect()
        })
        .collect();
    let mut best = 0;
    let mut matching = Vec::new();
    if cats.len() <= unique.len() {
        // Cache each remaining assignment state. Ascending choices retain the
        // source's first lexicographic optimum without enumerating permutations.
        fn search(
            counts: &[Vec<usize>],
            row: usize,
            used: &mut Vec<bool>,
            memo: &mut std::collections::HashMap<Vec<bool>, (usize, Vec<usize>)>,
        ) -> (usize, Vec<usize>) {
            if row == counts.len() {
                return (0, Vec::new());
            }
            if let Some(v) = memo.get(used) {
                return v.clone();
            }
            let mut best = (0, Vec::new());
            for j in 0..used.len() {
                if !used[j] {
                    used[j] = true;
                    let (rest, path) = search(counts, row + 1, used, memo);
                    used[j] = false;
                    let score = counts[row][j] + rest;
                    if score > best.0 {
                        let mut full = vec![j];
                        full.extend(path);
                        best = (score, full);
                    }
                }
            }
            memo.insert(used.clone(), best.clone());
            best
        }
        (best, matching) = search(
            &counts,
            0,
            &mut vec![false; unique.len()],
            &mut Default::default(),
        );
    } else {
        for row in &counts {
            let index = (0..row.len())
                .max_by_key(|&j| (row[j], std::cmp::Reverse(j)))
                .unwrap();
            best += row[index];
            matching.push(index);
        }
    }
    let mapping: Map<_, _> = matching
        .iter()
        .enumerate()
        .map(|(i, &j)| (grouping::label(&cats[i]), json!(unique[j])))
        .collect();
    let table: Map<_, _> = unique
        .iter()
        .enumerate()
        .map(|(j, s)| {
            (
                s.to_string(),
                Value::Object(
                    cats.iter()
                        .enumerate()
                        .map(|(i, c)| (grouping::label(c), json!(counts[i][j])))
                        .collect(),
                ),
            )
        })
        .collect();
    let pct = matrix::round(best as f64 / segments.len().max(1) as f64 * 100.0, 2);
    let satisfactory = pct >= 60.0;
    let pct_text = crate::python_json::dumps(&json!(pct));
    Ok(
        json!({"n_samples":segments.len(),"n_segments":unique.len(),"n_categories":cats.len(),"contingency_table":table,"optimal_mapping":mapping,"best_matching_mapping":mapping,"matched_cases":best,"overlap_percentage":pct,"is_satisfactory":satisfactory,"satisfaction_verdict":if satisfactory {format!("Satisfactory overlap ({pct_text}% >= 60%): The explanatory variable substantially accounts for segment membership.")}else{format!("Insufficient overlap ({pct_text}% < 60%): The explanatory variable does not adequately capture the latent segments.")}}),
    )
}

pub fn logistic(
    segments: Vec<i64>,
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
) -> Result<Value, String> {
    if rows.len() != segments.len()
        || rows.is_empty()
        || rows.iter().any(|r| r.len() != columns.len())
    {
        return Err("Invalid segment regression data".into());
    }
    let mut groups = segments.clone();
    groups.sort();
    groups.dedup();
    if groups.len() < 2 {
        return Err("Logistic segment regression requires at least two segments".into());
    }
    if groups.len() > 2 {
        let mut pairwise = Map::new();
        for &alt in &groups[1..] {
            let selected: Vec<_> = segments
                .iter()
                .enumerate()
                .filter(|(_, s)| **s == groups[0] || **s == alt)
                .map(|(i, _)| i)
                .collect();
            pairwise.insert(
                format!("Segment {alt} vs Reference Segment {}", groups[0]),
                logistic(
                    selected.iter().map(|&i| segments[i]).collect(),
                    columns.clone(),
                    selected.iter().map(|&i| rows[i].clone()).collect(),
                )?,
            );
        }
        return Ok(
            json!({"type":"multinomial_logistic_pairwise","reference_segment":groups[0],"pairwise_models":pairwise}),
        );
    }
    let categorical: Vec<_> = (0..columns.len())
        .filter(|&j| rows.iter().any(|r| r[j].is_string()))
        .collect();
    let mut names = vec!["Intercept".to_string()];
    let mut design = vec![vec![1.0]; rows.len()];
    for (j, name) in columns.iter().enumerate() {
        if !categorical.contains(&j) {
            names.push(name.clone());
            for (out, row) in design.iter_mut().zip(&rows) {
                out.push(model::numeric(&row[j]));
            }
        }
    }
    for j in categorical {
        let values: Vec<_> = rows.iter().map(|r| r[j].clone()).collect();
        for cat in sorted_unique(&values).iter().skip(1) {
            names.push(format!("{}_{}", columns[j], grouping::label(cat)));
            for (out, row) in design.iter_mut().zip(&rows) {
                out.push(if grouping::equal(cat, &row[j]) {
                    1.0
                } else {
                    0.0
                });
            }
        }
    }
    if design.iter().flatten().any(|v| !v.is_finite()) {
        return Err("Logistic predictors must be finite".into());
    }
    let p = names.len();
    let mut beta = vec![0.0; p];
    let mut hessian = vec![vec![0.0; p]; p];
    let mut converged = false;
    for _ in 0..50 {
        let eta = linalg::matvec(&matrix::transpose(&design), &beta)?;
        let probabilities: Vec<_> = eta
            .iter()
            .map(|e| 1.0 / (1.0 + (-e.clamp(-30.0, 30.0)).exp()))
            .collect();
        let weights: Vec<_> = probabilities
            .iter()
            .map(|p| (p * (1.0 - p)).max(1e-6))
            .collect();
        let score: Vec<_> = (0..p)
            .map(|j| {
                design
                    .iter()
                    .zip(&segments)
                    .zip(&probabilities)
                    .map(|((r, s), prob)| r[j] * ((if *s == groups[1] { 1.0 } else { 0.0 }) - prob))
                    .sum::<f64>()
            })
            .collect();
        for j in 0..p {
            for k in 0..p {
                hessian[j][k] = design
                    .iter()
                    .zip(&weights)
                    .map(|(r, w)| r[j] * (r[k] * w))
                    .sum();
            }
        }
        let delta = match linalg::solve(&hessian, &score) {
            Ok(v) => v,
            Err(_) => break,
        };
        for (beta, delta) in beta.iter_mut().zip(&delta) {
            *beta += delta;
        }
        if delta.iter().all(|d| d.abs() < 1e-5) {
            converged = true;
            break;
        }
    }
    let se = match linalg::inverse(&hessian) {
        Ok(inv) => (0..p).map(|j| inv[j][j].sqrt()).collect(),
        Err(_) => vec![1.0; p],
    };
    let coefficients:Vec<_>=(0..p).map(|j|{
        let z=beta[j]/se[j].max(1e-12);let prob=2.0*(1.0-inference::normal_cdf(z.abs()));
        json!({"predictor":names[j],"coefficient":matrix::round(beta[j],4),"std_error":matrix::round(se[j],4),"z_statistic":matrix::round(z,4),"p_value":matrix::round(prob,4),"odds_ratio":matrix::round(beta[j].clamp(-10.0,10.0).exp(),4),"is_significant":prob<0.05})
    }).collect();
    Ok(
        json!({"type":"binary_logistic","reference_segment":groups[0],"target_segment":groups[1],"n_samples":rows.len(),"coefficients_table":coefficients,"coefficients":coefficients,"converged":converged}),
    )
}

pub fn compare(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    settings: Value,
    explanatory_col: String,
    pos: Value,
) -> Result<Value, String> {
    if rows.is_empty() || rows.iter().any(|r| r.len() != columns.len()) {
        return Err("Invalid group comparison data".into());
    }
    let index = columns
        .iter()
        .position(|c| c == &explanatory_col)
        .ok_or("Explanatory column not found")?;
    let groups = sorted_unique(&rows.iter().map(|r| r[index].clone()).collect::<Vec<_>>());
    let cfg = model::settings(&settings)?;
    let paths = model::parse(&spec)?.paths;
    let mut fits = Map::new();
    let mut sizes = Map::new();
    let mut r2 = Map::new();
    for group in &groups {
        let subset: Vec<_> = rows
            .iter()
            .filter(|r| grouping::equal(&r[index], group))
            .cloned()
            .collect();
        let label = grouping::label(group);
        sizes.insert(label.clone(), json!(subset.len()));
        let fit = pipeline::run(columns.clone(), subset, spec.clone(), cfg.clone())?;
        let rounded: Map<_, _> = fit["structural"]["r_squared"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(k, v)| (k.clone(), json!(matrix::round(model::numeric(v), 4))))
            .collect();
        r2.insert(label.clone(), Value::Object(rounded));
        fits.insert(label, fit);
    }
    let global = pipeline::run(columns, rows.clone(), spec, cfg)?;
    let global_r2: Map<_, _> = global["structural"]["r_squared"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, v)| (k.clone(), json!(matrix::round(model::numeric(v), 4))))
        .collect();
    let mut targets: Vec<_> = paths.iter().map(|p| p[1].clone()).collect();
    targets.sort();
    targets.dedup();
    let mut weighted = Map::new();
    let mut reproduces = true;
    for target in targets {
        let value = matrix::round(
            groups
                .iter()
                .map(|g| {
                    let label = grouping::label(g);
                    model::numeric(&sizes[&label]) / rows.len() as f64
                        * r2[&label][&target].as_f64().unwrap_or(0.0)
                })
                .sum(),
            4,
        );
        reproduces &= value >= pos["weighted_r_squared"][&target].as_f64().unwrap_or(0.0) - 0.05;
        weighted.insert(target, json!(value));
    }
    let mut table = Vec::new();
    for [from, to] in paths {
        let mut row = Map::new();
        row.insert("path".into(), json!(format!("{from} -> {to}")));
        let coefficient = |fit: &Value| {
            json!(matrix::round(
                fit["structural"]["path_coefficients"][&to][&from]
                    .as_f64()
                    .unwrap_or(0.0),
                4
            ))
        };
        row.insert("full_sample".into(), coefficient(&global));
        for group in &groups {
            let label = grouping::label(group);
            row.insert(format!("group_{label}"), coefficient(&fits[&label]));
        }
        for segment in pos["segments"].as_array().into_iter().flatten() {
            row.insert(
                format!("pos_segment_{}", segment["segment"].as_i64().unwrap_or(1)),
                json!(matrix::round(
                    segment["path_coefficients"][&to][&from]
                        .as_f64()
                        .unwrap_or(0.0),
                    4
                )),
            );
        }
        table.push(row);
    }
    Ok(
        json!({"explanatory_variable":explanatory_col,"n_groups":groups.len(),"group_sizes":sizes,"path_comparisons_table":table,"comparison_table":table,"explanatory_groups":fits,"pos_solution":pos,"weighted_r_squared_explanatory":weighted,"weighted_r_squared_pos":pos["weighted_r_squared"].as_object().cloned().unwrap_or_default(),"global_r_squared":global_r2,"reproduction_quality":if reproduces{"Explanatory grouping closely reproduces POS latent segments."}else{"Explanatory grouping yields substantially lower variance explained than PLS-POS; segments are poorly reproduced."},"note":"Ex post analysis tests whether observable variables explain the unobserved segments uncovered by PLS-POS (Hair et al. 2018)."}),
    )
}
