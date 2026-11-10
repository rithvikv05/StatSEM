//! Interaction normalization, term generation and moderation diagnostics.
use crate::{linalg, matrix, model, nonlinear, pipeline, stats};
use serde_json::{json, Value};

fn field<'a>(v: &'a Value, keys: &[&str]) -> &'a str {
    model::alias(v, keys).unwrap_or("")
}
fn truth(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}
pub fn normalize(spec: &Value) -> Vec<Value> {
    let cs = spec["constructs"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let resolve = |s: &str| {
        let s = s.trim();
        if cs.iter().any(|c| c["id"] == s) {
            s.to_owned()
        } else {
            cs.iter()
                .rev()
                .find(|c| c["name"] == s)
                .and_then(|c| c["id"].as_str())
                .unwrap_or(s)
                .to_owned()
        }
    };
    let display = |id: &str| {
        cs.iter()
            .find(|c| c["id"] == id)
            .map(|c| field(c, &["name", "id"]))
            .unwrap_or(id)
            .to_owned()
    };
    let mut raw = Vec::new();
    // The reference normalizer consumes snake_case; model-schema alias handling
    // is a separate compatibility layer.
    for (i, m) in spec["moderating_effects"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        let source = field(m, &["source", "predictor", "predictor_lv"]);
        let moderator = field(m, &["moderator", "moderator_lv"]);
        let target = field(m, &["target", "outcome", "outcome_lv"]);
        if source.trim().is_empty() || moderator.trim().is_empty() || target.trim().is_empty() {
            continue;
        }
        raw.push(json!({"id":model::alias(m,&["id"]).map(str::to_owned).unwrap_or_else(||format!("mod_{}_{}_{}_{}",source.trim(),moderator.trim(),target.trim(),i)),
            "source":resolve(source),"moderator":resolve(moderator),"target":resolve(target),
            "method":model::alias(m,&["method"]).unwrap_or("two_stage").to_lowercase(),
            "standardize":m.get("standardize").map(truth).unwrap_or(true),"attach_to_mod_id":model::alias(m,&["attachToModId","attach_to_mod_id"])}));
    }
    let mut output: Vec<Value> = Vec::new();
    for m in &raw {
        let mut m = m.clone();
        let mut chain = vec![m["moderator"].as_str().unwrap().to_owned()];
        let mut attach = m["attach_to_mod_id"].as_str().map(str::to_owned);
        let mut visited = vec![m["id"].as_str().unwrap().to_owned()];
        while let Some(ref id) = attach {
            if visited.contains(id) {
                break;
            }
            let Some(parent) = raw.iter().rev().find(|p| p["id"] == *id) else {
                break;
            };
            visited.push(id.clone());
            chain.push(parent["moderator"].as_str().unwrap().to_owned());
            m["source"] = parent["source"].clone();
            m["target"] = parent["target"].clone();
            attach = parent["attach_to_mod_id"].as_str().map(str::to_owned);
        }
        chain.reverse();
        chain.sort_by_key(|id| display(id));
        m["chain"] = json!(chain);
        m["interaction_term"] = json!(format!(
            "{} x {}",
            chain
                .iter()
                .map(|w| display(w))
                .collect::<Vec<_>>()
                .join(" x "),
            display(m["source"].as_str().unwrap())
        ));
        if !output.iter().any(|p| {
            p["chain"] == m["chain"] && p["source"] == m["source"] && p["target"] == m["target"]
        }) {
            output.push(m);
        }
    }
    output
}

pub(crate) fn add_path(spec: &mut Value, source: &str, target: &str) {
    if !spec["paths"].as_array().unwrap().iter().any(|p| {
        model::alias(p, &["from", "from_node"]) == Some(source)
            && model::alias(p, &["to", "to_node"]) == Some(target)
    }) {
        spec["paths"]
            .as_array_mut()
            .unwrap()
            .push(json!({"from":source,"to":target}));
    }
}
pub(crate) fn assign(
    columns: &mut Vec<String>,
    rows: &mut [Vec<Value>],
    column: &str,
    values: &[f64],
) -> Result<(), String> {
    if values.len() != rows.len() {
        return Err(
            "Interaction score count differs from dataset rows after missing-data treatment".into(),
        );
    }
    if let Some(j) = columns.iter().position(|c| c == column) {
        for (row, v) in rows.iter_mut().zip(values) {
            row[j] = json!(v);
        }
    } else {
        columns.push(column.into());
        for (row, v) in rows.iter_mut().zip(values) {
            row.push(json!(v));
        }
    }
    Ok(())
}
pub(crate) fn add_construct(
    spec: &mut Value,
    id: &str,
    cols: &[String],
    metadata: Value,
    constituent: bool,
) {
    let mut construct = json!({"id":id,"name":id,"type":"reflective","indicators":cols,"outer_mode":"A","is_interaction":true});
    if !metadata.is_null() {
        construct["metadata"] = metadata;
    }
    if constituent {
        construct["is_constituent"] = json!(true);
    }
    spec["constructs"].as_array_mut().unwrap().push(construct);
    for col in cols {
        spec["indicators"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":col,"column":col,"construct_id":id}));
    }
}
fn centered(values: &[f64], ddof: usize) -> (Vec<f64>, f64) {
    let observed: Vec<_> = values.iter().copied().filter(|v| !v.is_nan()).collect();
    let mean = stats::mean(&observed, None);
    let centered: Vec<_> = values.iter().map(|v| v - mean).collect();
    let observed: Vec<_> = centered.iter().copied().filter(|v| !v.is_nan()).collect();
    let sd = stats::std(&observed, None, ddof);
    (centered, if sd > 1e-12 { sd } else { 1.0 })
}
fn standardized(values: &[f64]) -> Vec<f64> {
    let (v, sd) = centered(values, 1);
    v.iter().map(|x| x / sd).collect()
}

pub(crate) fn stage1_paths(base: &mut Value, mods: &[Value]) {
    for m in mods {
        for w in m["chain"].as_array().unwrap() {
            add_path(base, w.as_str().unwrap(), m["target"].as_str().unwrap());
        }
    }
}
pub(crate) fn score_terms(
    columns: &mut Vec<String>,
    rows: &mut [Vec<Value>],
    spec: &mut Value,
    scores: &Value,
    mods: &[Value],
) -> Result<serde_json::Map<String, Value>, String> {
    let mut scales = serde_json::Map::new();
    for m in mods {
        let src = m["source"].as_str().unwrap();
        let target = m["target"].as_str().unwrap();
        let term = m["interaction_term"].as_str().unwrap();
        let mut product: Vec<_> = scores[src]
            .as_array()
            .ok_or("Moderation source scores missing")?
            .iter()
            .map(model::numeric)
            .collect();
        for w in m["chain"].as_array().unwrap() {
            let ws = scores[w.as_str().unwrap()]
                .as_array()
                .ok_or("Moderator scores missing")?;
            if product.len() != ws.len() {
                return Err("Moderator score vectors differ in length".into());
            }
            for (p, w) in product.iter_mut().zip(ws) {
                *p *= model::numeric(w);
            }
        }
        let (mut values, sd) = centered(&product, 1);
        if m["standardize"] == true {
            for v in &mut values {
                *v /= sd;
            }
        }
        scales.insert(term.into(), json!({"scale":sd}));
        let column = if m["chain"].as_array().unwrap().len() <= 1 {
            format!("int_{}_{}", src, m["moderator"].as_str().unwrap())
        } else {
            format!("int_{}", term.replace(' ', "_"))
        };
        assign(columns, rows, &column, &values)?;
        add_construct(
            spec,
            term,
            &[column],
            json!({"moderator":m["moderator"],"chain":m["chain"],"predictor":src,"outcome":target,"method":m["method"]}),
            false,
        );
        add_path(spec, term, target);
    }
    // Include every moderator-only lower-order product required by higher-order
    // interactions. Combination count is bounded by input size and checked.
    let mut targets = Vec::new();
    for m in mods {
        let target = m["target"].as_str().unwrap();
        if !targets.contains(&target) {
            targets.push(target);
        }
    }
    for target in targets {
        let mut combinations: Vec<Vec<String>> = Vec::new();
        for m in mods.iter().filter(|m| m["target"] == target) {
            let chain = m["chain"].as_array().unwrap();
            if chain.len() < 2 {
                continue;
            }
            if chain.len() > 20 {
                return Err("Higher-order moderation has too many constituent combinations".into());
            }
            for mask in 0..(1usize << chain.len()) {
                if mask.count_ones() < 2 {
                    continue;
                }
                let mut combination: Vec<_> = chain
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| mask & (1 << i) != 0)
                    .map(|(_, v)| v.as_str().unwrap().to_owned())
                    .collect();
                combination.sort_by_key(|id| {
                    spec["constructs"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|c| c["id"] == *id)
                        .map(|c| field(c, &["name", "id"]).to_owned())
                        .unwrap_or(id.clone())
                });
                if !combinations.contains(&combination) {
                    combinations.push(combination);
                }
            }
        }
        combinations.sort_by(|a, b| a.len().cmp(&b.len()).then(a.cmp(b)));
        for combination in combinations {
            let term = combination
                .iter()
                .map(|id| {
                    spec["constructs"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|c| c["id"] == *id)
                        .map(|c| field(c, &["name", "id"]).to_owned())
                        .unwrap_or(id.clone())
                })
                .collect::<Vec<_>>()
                .join(" x ");
            if columns.contains(&term)
                || spec["constructs"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|c| c["id"] == term)
            {
                continue;
            }
            let mut product = vec![1.0; rows.len()];
            for w in &combination {
                let ws = scores[w].as_array().ok_or("Constituent scores missing")?;
                if ws.len() != rows.len() {
                    return Err("Constituent score count differs from rows".into());
                }
                for (p, w) in product.iter_mut().zip(ws) {
                    *p *= model::numeric(w);
                }
            }
            let (values, sd) = centered(&product, 1);
            let values: Vec<_> = values.iter().map(|v| v / sd).collect();
            let col = format!("const_{}", term.replace(' ', "_"));
            assign(columns, rows, &col, &values)?;
            scales.insert(term.clone(), json!({"scale":sd}));
            add_construct(spec, &term, &[col], Value::Null, true);
            add_path(spec, &term, target);
        }
    }
    Ok(scales)
}

pub(crate) fn product_expanded(
    columns: &[String],
    rows: &[Vec<Value>],
    base: &Value,
    settings: &Value,
    mods: &[Value],
    fit: bool,
) -> Result<Value, String> {
    let mut columns = columns.to_vec();
    let mut rows = rows.to_vec();
    let mut spec = json!({"constructs":base["constructs"],"indicators":base.get("indicators").cloned().unwrap_or(json!([])),"paths":base.get("paths").cloned().unwrap_or(json!([]))});
    for m in mods {
        stage1_paths(&mut spec, std::slice::from_ref(m));
        let source = m["source"].as_str().unwrap();
        let moderator = m["moderator"].as_str().unwrap();
        let term = m["interaction_term"].as_str().unwrap();
        let get_columns = |id: &str| -> Vec<String> {
            base["constructs"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["id"] == id)
                .and_then(|c| c["indicators"].as_array())
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str())
                .map(|iid| {
                    base["indicators"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .find(|i| model::alias(i, &["id", "name", "column"]) == Some(iid))
                        .map(|i| field(i, &["column", "name", "id"]))
                        .unwrap_or(iid)
                        .to_owned()
                })
                .filter(|col| columns.contains(col))
                .collect()
        };
        let pred = get_columns(source);
        let mods_cols = get_columns(moderator);
        if pred.is_empty() || mods_cols.is_empty() {
            return Err(format!("Cannot generate interaction indicators: Missing indicators for {source} or {moderator}."));
        }
        let transform = |col: &String| {
            let j = columns.iter().position(|c| c == col).unwrap();
            let values: Vec<_> = rows.iter().map(|r| model::numeric(&r[j])).collect();
            if m["standardize"] == true {
                standardized(&values)
            } else {
                values
            }
        };
        let a: Vec<_> = pred.iter().map(transform).collect();
        let b: Vec<_> = mods_cols.iter().map(transform).collect();
        let mut basis = vec![vec![1.0; rows.len()]];
        basis.extend(a.clone());
        basis.extend(b.clone());
        let mut cols = Vec::new();
        for (i, pi) in pred.iter().enumerate() {
            for (j, mi) in mods_cols.iter().enumerate() {
                let mut product: Vec<_> = a[i].iter().zip(&b[j]).map(|(a, b)| a * b).collect();
                if m["method"] == "orthogonalizing" {
                    if let Ok(fit) = linalg::least_squares(&basis, &product, None) {
                        for (r, v) in product.iter_mut().enumerate() {
                            *v -= basis
                                .iter()
                                .zip(&fit.coefficients)
                                .map(|(col, b)| col[r] * b)
                                .sum::<f64>();
                        }
                    }
                }
                if m["standardize"] == true {
                    product = standardized(&product);
                }
                let col = format!("prod_{source}_{moderator}_{pi}_{mi}");
                assign(&mut columns, &mut rows, &col, &product)?;
                cols.push(col);
            }
        }
        add_construct(
            &mut spec,
            term,
            &cols,
            json!({"moderator":moderator,"predictor":source,"outcome":m["target"],"method":m["method"]}),
            false,
        );
        add_path(&mut spec, term, m["target"].as_str().unwrap());
    }
    let mut result = if fit {
        pipeline::run(
            columns.clone(),
            rows.clone(),
            spec.clone(),
            settings.clone(),
        )?
    } else {
        pipeline::run_without_fit(
            columns.clone(),
            rows.clone(),
            spec.clone(),
            settings.clone(),
        )?
    };
    if result.get("construct_scores").is_none() {
        result["construct_scores"] = result["results_pls_original"]
            .get("construct_scores")
            .cloned()
            .unwrap_or(json!({}));
    }
    result["_expanded_spec"] = spec;
    result["_expanded_df"] = json!({"columns":columns,"rows":rows});
    Ok(result)
}

pub(crate) fn diagnostics(
    result: &mut Value,
    mods: &[Value],
    f2: serde_json::Map<String, Value>,
) -> Result<(), String> {
    let matrix = &result["structural"]["path_coefficients"];
    let mut details = Vec::new();
    let mut by_mod = serde_json::Map::new();
    for m in mods {
        let target = m["target"].as_str().unwrap();
        let term = m["interaction_term"].as_str().unwrap();
        let coefficient = |key: &str| {
            matrix[target][m[key].as_str().unwrap()]
                .as_f64()
                .unwrap_or(0.0)
        };
        let b1 = coefficient("source");
        let bw = coefficient("moderator");
        let b3 = coefficient("interaction_term");
        let slopes = nonlinear::slopes(nonlinear::SlopesOptions {
            beta_source: b1,
            beta_moderator: bw,
            beta_interaction: b3,
            boot_source_reps: None,
            boot_int_reps: None,
            alpha: 0.05,
        })?;
        by_mod.insert(m["id"].as_str().unwrap().into(), slopes.clone());
        details.push(json!({"id":m["id"],"source":m["source"],"moderator":m["moderator"],"target":target,"interaction_term":term,"method":m["method"],
            "estimates":{"beta_source":matrix::round(b1,4),"beta_moderator":matrix::round(bw,4),"beta_interaction":matrix::round(b3,4)},
            "f_squared":f2[term],"simple_slopes":slopes["simple_slopes"],"plot_data":{"x_range":slopes["x_range"],"lines":slopes["simple_slopes"]}}));
    }
    let mut conditional = Vec::new();
    let paths: Vec<_> = result["_expanded_spec"]["paths"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (field(p, &["from", "source"]), field(p, &["to", "target"])))
        .collect();
    for &(a, b) in &paths {
        for &(_, c) in paths
            .iter()
            .filter(|(from, c)| *from == b && *c != a && *c != b && a != b)
        {
            let mods_a: Vec<_> = mods
                .iter()
                .filter(|m| m["source"] == a && m["target"] == b)
                .collect();
            let mods_b: Vec<_> = mods
                .iter()
                .filter(|m| m["source"] == b && m["target"] == c)
                .collect();
            let mut ws = Vec::new();
            for m in mods_a.iter().chain(&mods_b) {
                let w = m["moderator"].as_str().unwrap();
                if !ws.contains(&w) {
                    ws.push(w);
                }
            }
            for w in ws {
                let am = mods_a.iter().find(|m| m["moderator"] == w);
                let bm = mods_b.iter().find(|m| m["moderator"] == w);
                let dm = mods
                    .iter()
                    .find(|m| m["source"] == a && m["target"] == c && m["moderator"] == w);
                let has_direct = paths.contains(&(a, c));
                let beta =
                    |target: &str, source: &str| matrix[target][source].as_f64().unwrap_or(0.0);
                let a1 = beta(b, a);
                let a3 = am
                    .map(|m| beta(b, m["interaction_term"].as_str().unwrap()))
                    .unwrap_or(0.0);
                let b1 = beta(c, b);
                let b3 = bm
                    .map(|m| beta(c, m["interaction_term"].as_str().unwrap()))
                    .unwrap_or(0.0);
                let c1 = if has_direct { beta(c, a) } else { 0.0 };
                let c3 = dm
                    .map(|m| beta(c, m["interaction_term"].as_str().unwrap()))
                    .unwrap_or(0.0);
                let curvature = if am.is_some() && bm.is_some() {
                    a3 * b3
                } else {
                    0.0
                };
                let index = a3 * b1 + a1 * b3;
                let effects:Vec<_>=[(-1.0,"-1 SD (Low)"),(0.0,"Mean (Average)"),(1.0,"+1 SD (High)")].into_iter().map(|(w,label)| {let indirect=(a1+a3*w)*(b1+b3*w);let direct=if has_direct {c1+c3*w} else {0.0};json!({"w_value":w,"w_label":label,"indirect_effect":indirect,"direct_effect":direct,"total_effect":indirect+direct})}).collect();
                conditional.push(json!({"chain":format!("{a} -> {b} -> {c}"),"moderator":w,"a_path_moderated":am.is_some(),"b_path_moderated":bm.is_some(),"direct_path_moderated":dm.is_some(),
                "index_type":if am.is_some() && bm.is_some() {"quadratic"} else {"linear"},"index_of_moderated_mediation":index,"index_at_w":{"-1 SD":index-2.0*curvature,"Mean":index,"+1 SD":index+2.0*curvature},"curvature":curvature,"conditional_effects":effects,"bootstrap_inference":null}));
            }
        }
    }
    result["moderation"] = json!({"moderating_effects":details,"f2_effect_sizes":f2,"simple_slopes":by_mod,"conditional_indirect_effects":conditional});
    Ok(())
}
