//! Two-stage quadratic estimation, including reduced-model diagnostics.
use crate::{effects, model, moderation, nonlinear, pipeline, stats};
use serde_json::{json, Value};

fn text(value: &Value, keys: &[&str]) -> String {
    model::alias(value, keys).unwrap_or("").to_owned()
}
pub fn normalize(spec: &Value) -> Vec<Value> {
    let constructs = spec["constructs"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let raw = ["quadratic_effects", "quadraticEffects"]
        .iter()
        .find_map(|k| spec[*k].as_array().filter(|v| !v.is_empty()));
    let mut output: Vec<Value> = Vec::new();
    for (i, q) in raw.into_iter().flatten().enumerate() {
        if !q.is_object() {
            continue;
        }
        let resolve = |id: String| {
            let id = id.trim();
            if constructs.iter().any(|c| c["id"] == id) {
                return id.to_owned();
            }
            constructs
                .iter()
                .rev()
                .find(|c| c["name"] == id)
                .and_then(|c| c["id"].as_str())
                .unwrap_or(id)
                .to_owned()
        };
        let pred = resolve(text(
            q,
            &[
                "predictor_construct",
                "predictorConstruct",
                "construct_id",
                "construct",
                "predictor",
                "source",
                "source_construct",
            ],
        ));
        let target = resolve(text(
            q,
            &["target_construct", "targetConstruct", "target", "outcome"],
        ));
        if pred.is_empty()
            || target.is_empty()
            || output
                .iter()
                .any(|v| v["predictor"] == pred && v["target"] == target)
        {
            continue;
        }
        let name = |id: &str| {
            constructs
                .iter()
                .find(|c| c["id"] == id)
                .and_then(|c| model::alias(c, &["name", "id"]))
                .unwrap_or(id)
                .to_owned()
        };
        let pred_name = name(&pred);
        let node = |a: &str, b: &str| {
            let v = &q[a];
            if !v.is_null() && v != &json!(0) {
                v.clone()
            } else {
                q[b].clone()
            }
        };
        output.push(json!({"id":model::alias(q,&["id"]).map(str::to_owned).unwrap_or_else(||format!("quad_{pred}_{target}_{i}")),
            "predictor":pred,"target":target,"predictor_name":pred_name,"target_name":name(&target),
            "quad_construct_name":format!("{pred_name} x {pred_name}"),"indicator_name":format!("q_{pred}_{target}"),
            "method":model::alias(q,&["method"]).unwrap_or("two_stage").to_lowercase(),"node_x":node("node_x","nodeX"),"node_y":node("node_y","nodeY")}));
    }
    output
}

fn ordinary(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    spec: Value,
    settings: Value,
    fit: bool,
) -> Result<Value, String> {
    if fit {
        pipeline::run(columns, rows, spec, settings)
    } else {
        pipeline::run_without_fit(columns, rows, spec, settings)
    }
}

fn scores(result: &Value) -> &Value {
    result
        .get("construct_scores")
        .unwrap_or(&result["results_pls_original"]["construct_scores"])
}

// SmartPLS two-stage moderation estimates the structural model from the
// first-stage construct scores. Interaction predictors are mean-centered raw
// products of those scores; they are not standardized before reporting betas.
fn fixed_score_moderation(
    stage1: &Value,
    expanded_spec: &Value,
    columns: &[String],
    rows: &[Vec<Value>],
    scales: &serde_json::Map<String, Value>,
    settings: &Value,
) -> Result<Value, String> {
    let constructs = expanded_spec["constructs"]
        .as_array()
        .ok_or("Expanded constructs must be an array")?;
    let indicators = expanded_spec["indicators"]
        .as_array()
        .ok_or("Expanded indicators must be an array")?;
    let n = rows.len();
    let mut synthetic_columns = Vec::with_capacity(constructs.len());
    let mut synthetic_constructs = Vec::with_capacity(constructs.len());
    let mut synthetic_indicators = Vec::with_capacity(constructs.len());
    let mut vectors = Vec::with_capacity(constructs.len());
    let mut raw_scales = serde_json::Map::new();

    for (index, construct) in constructs.iter().enumerate() {
        let id = construct["id"]
            .as_str()
            .ok_or("Expanded construct ID is missing")?;
        let values: Vec<f64> = if let Some(details) = scales.get(id) {
            let indicator_id = construct["indicators"][0]
                .as_str()
                .ok_or("Interaction indicator is missing")?;
            let column = indicators
                .iter()
                .find(|item| item["id"] == indicator_id)
                .and_then(|item| item["column"].as_str())
                .ok_or("Interaction indicator column is missing")?;
            let position = columns
                .iter()
                .position(|item| item == column)
                .ok_or("Interaction data column is missing")?;
            let sample_scale = model::numeric(&details["scale"]);
            let raw: Vec<_> = rows
                .iter()
                .map(|row| model::numeric(&row[position]) * sample_scale)
                .collect();
            let population_scale = stats::std(&raw, None, 0);
            raw_scales.insert(
                id.to_owned(),
                json!(if population_scale > 1e-12 {
                    population_scale
                } else {
                    1.0
                }),
            );
            raw
        } else {
            scores(stage1)[id]
                .as_array()
                .ok_or_else(|| format!("First-stage score for '{id}' is missing"))?
                .iter()
                .map(model::numeric)
                .collect()
        };
        if values.len() != n || values.iter().any(|value| !value.is_finite()) {
            return Err(format!("Invalid first-stage score vector for '{id}'"));
        }
        let column = format!("__stage2_score_{index}");
        synthetic_columns.push(column.clone());
        synthetic_constructs.push(json!({
            "id": id,
            "name": construct.get("name").unwrap_or(&construct["id"]),
            "type": "reflective",
            "indicators": [column],
            "is_interaction": construct["is_interaction"],
            "metadata": construct["metadata"]
        }));
        synthetic_indicators.push(json!({"id": column, "column": column}));
        vectors.push(values);
    }
    let synthetic_rows: Vec<Vec<Value>> = (0..n)
        .map(|row| vectors.iter().map(|column| json!(column[row])).collect())
        .collect();
    let synthetic_spec = json!({
        "constructs": synthetic_constructs,
        "indicators": synthetic_indicators,
        "paths": expanded_spec["paths"]
    });
    let mut result = pipeline::run_without_fit(
        synthetic_columns,
        synthetic_rows,
        synthetic_spec,
        settings.clone(),
    )?;

    for target in result["structural"]["path_coefficients"]
        .as_object_mut()
        .ok_or("Missing fixed-score path coefficients")?
        .values_mut()
    {
        if let Some(paths) = target.as_object_mut() {
            for (source, coefficient) in paths {
                if let Some(scale) = raw_scales.get(source) {
                    *coefficient = json!(model::numeric(coefficient) / model::numeric(scale));
                }
            }
        }
    }
    let ids: Vec<_> = constructs
        .iter()
        .map(|construct| construct["id"].as_str().unwrap().to_owned())
        .collect();
    let mut path_matrix = vec![vec![0.0; ids.len()]; ids.len()];
    let mut paths = Vec::new();
    for (to_index, target) in ids.iter().enumerate() {
        for (from_index, source) in ids.iter().enumerate() {
            if let Some(beta) = result["structural"]["path_coefficients"][target][source].as_f64() {
                path_matrix[from_index][to_index] = beta;
                paths.push(json!({"from": source, "to": target, "beta": beta}));
            }
        }
    }
    let decomposition = effects::calculate(&path_matrix, &ids);
    result["structural"]["effects"] = decomposition["effects_summary"].clone();
    result["structural"]["specific_indirect"] = decomposition["specific_indirect"].clone();
    result["effects_decomposition"] = decomposition;
    result["paths"] = json!(paths);
    Ok(result)
}

fn expanded(
    columns: &[String],
    rows: &[Vec<Value>],
    base: &Value,
    settings: &Value,
    quads: &[Value],
    mods: &[Value],
    fit: bool,
) -> Result<Value, String> {
    if !mods.is_empty() && quads.is_empty() && !mods.iter().any(|m| m["method"] == "two_stage") {
        return moderation::product_expanded(columns, rows, base, settings, mods, fit);
    }
    let mut stage1_spec = base.clone();
    moderation::stage1_paths(&mut stage1_spec, mods);
    let stage1 = ordinary(
        columns.to_vec(),
        rows.to_vec(),
        stage1_spec.clone(),
        settings.clone(),
        fit,
    )?;
    if quads.is_empty() && mods.is_empty() {
        return Ok(stage1);
    }
    let mut expanded_spec = json!({"constructs":stage1_spec["constructs"],"indicators":stage1_spec.get("indicators").cloned().unwrap_or(json!([])),"paths":stage1_spec.get("paths").cloned().unwrap_or(json!([]))});
    let mut columns = columns.to_vec();
    let mut rows = rows.to_vec();
    let int_scales = moderation::score_terms(
        &mut columns,
        &mut rows,
        &mut expanded_spec,
        scores(&stage1),
        mods,
    )?;
    let mut scales = serde_json::Map::new();
    for q in quads {
        let pred = q["predictor"].as_str().unwrap();
        let id = q["quad_construct_name"].as_str().unwrap();
        let column = q["indicator_name"].as_str().unwrap();
        let scores = scores(&stage1)[pred]
            .as_array()
            .ok_or_else(|| format!("Quadratic predictor '{pred}' has no scores"))?;
        if scores.len() != rows.len() {
            return Err(
                "Quadratic score count differs from dataset rows after missing-data treatment"
                    .into(),
            );
        }
        let raw: Vec<_> = scores
            .iter()
            .map(|v| {
                let x = model::numeric(v);
                x * x
            })
            .collect();
        let mean = stats::mean(&raw, None);
        let centered: Vec<_> = raw.iter().map(|v| v - mean).collect();
        let sd = stats::std(&centered, None, 0);
        let scale = if sd > 1e-12 { sd } else { 1.0 };
        scales.insert(id.into(), json!({"mean":mean,"scale":scale}));
        if let Some(j) = columns.iter().position(|c| c == column) {
            for (row, value) in rows.iter_mut().zip(&centered) {
                row[j] = json!(value / scale);
            }
        } else {
            columns.push(column.into());
            for (row, value) in rows.iter_mut().zip(&centered) {
                row.push(json!(value / scale));
            }
        }
        expanded_spec["constructs"].as_array_mut().unwrap().push(json!({"id":id,"name":id,"type":"reflective","indicators":[column],"outer_mode":"A","is_interaction":true,"is_quadratic":true,
            "metadata":{"predictor":pred,"outcome":q["target"],"target":q["target"],"method":q["method"],"mean":mean,"scale":scale}}));
        expanded_spec["indicators"]
            .as_array_mut()
            .ok_or("Model indicators must be an array")?
            .push(json!({"id":column,"column":column,"construct_id":id}));
        if !expanded_spec["paths"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| model::alias(p, &["from", "from_node"]) == Some(id) && p["to"] == q["target"])
        {
            expanded_spec["paths"]
                .as_array_mut()
                .unwrap()
                .push(json!({"from":id,"to":q["target"]}));
        }
    }
    let mut result = ordinary(
        columns.clone(),
        rows.clone(),
        expanded_spec.clone(),
        settings.clone(),
        fit,
    )?;
    for (term, details) in scales.iter().chain(&int_scales) {
        let scale = details["scale"].as_f64().unwrap();
        for field in [
            "path_coefficients",
            "original_coefficients",
            "total_effects",
        ] {
            if let Some(targets) = result
                .get_mut("structural")
                .and_then(|v| v.get_mut(field))
                .and_then(Value::as_object_mut)
            {
                for paths in targets.values_mut() {
                    if let Some(value) = paths.get_mut(term) {
                        *value = json!(model::numeric(value) / scale);
                    }
                }
            }
        }
        if let Some(paths) = result.get_mut("paths").and_then(Value::as_array_mut) {
            for path in paths {
                if path["from"] == *term {
                    path["beta"] = json!(model::numeric(&path["beta"]) / scale);
                }
            }
        }
    }
    let mut all_scales = scales.clone();
    for (k, v) in &int_scales {
        all_scales.insert(k.clone(), v.clone());
    }
    if quads.iter().all(|q| q["method"] == "two_stage")
        && mods
            .iter()
            .all(|moderation| moderation["method"] == "two_stage")
        && settings["consistent"] != true
        && settings["weight_column"].is_null()
    {
        let fixed = fixed_score_moderation(
            &stage1,
            &expanded_spec,
            &columns,
            &rows,
            &all_scales,
            settings,
        )?;
        result["structural"] = fixed["structural"].clone();
        result["effects_decomposition"] = fixed["effects_decomposition"].clone();
        result["construct_scores"] = fixed["construct_scores"].clone();
        result["construct_correlations"] = fixed["construct_correlations"].clone();
        result["paths"] = fixed["paths"].clone();
        for field in [
            "outer_weights",
            "outer_loadings",
            "indicator_reliability",
            "outer_vif",
        ] {
            if let Some(originals) = stage1["measurement"][field].as_object() {
                for (id, values) in originals {
                    result["measurement"][field][id] = values.clone();
                }
            }
        }
        result["reliability_and_validity"] = stage1["reliability_and_validity"].clone();
    }
    if result.get("construct_scores").is_none() {
        result["construct_scores"] = scores(&result).clone();
    }
    result["_stage1_results"] = stage1;
    result["_expanded_spec"] = expanded_spec;
    // The development protocol represents the internal DataFrame by its ordered
    // columns/rows; the Python oracle checks its full contents in the same form.
    result["_expanded_df"] = json!({"columns":columns,"rows":rows});
    result["_quad_scales"] = Value::Object(scales);
    Ok(result)
}

pub fn run(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    mut spec: Value,
    settings: Value,
    compute_fit: bool,
) -> Result<Value, String> {
    let quads = normalize(&spec);
    let mods = moderation::normalize(&spec);
    for key in [
        "quadratic_effects",
        "quadraticEffects",
        "moderating_effects",
        "moderatingEffects",
    ] {
        spec[key] = json!([]);
    }
    if quads.is_empty() && mods.is_empty() {
        return ordinary(columns, rows, spec, settings, compute_fit);
    }
    let mut result = expanded(
        &columns,
        &rows,
        &spec,
        &settings,
        &quads,
        &mods,
        compute_fit,
    )?;
    if !mods.is_empty() {
        let mut f2 = serde_json::Map::new();
        for m in &mods {
            let target = m["target"].as_str().unwrap();
            let others: Vec<_> = mods
                .iter()
                .filter(|v| v["id"] != m["id"])
                .cloned()
                .collect();
            let excluded = expanded(&columns, &rows, &spec, &settings, &quads, &others, false)?;
            f2.insert(
                m["interaction_term"].as_str().unwrap().into(),
                nonlinear::effect_size(
                    result["structural"]["r_squared"][target]
                        .as_f64()
                        .unwrap_or(0.0),
                    excluded["structural"]["r_squared"][target]
                        .as_f64()
                        .unwrap_or(0.0),
                    true,
                ),
            );
        }
        moderation::diagnostics(&mut result, &mods, f2)?;
    }
    let mut diagnostics = Vec::new();
    for q in &quads {
        let pred = q["predictor"].as_str().unwrap();
        let target = q["target"].as_str().unwrap();
        let term = q["quad_construct_name"].as_str().unwrap();
        let others: Vec<_> = quads
            .iter()
            .filter(|v| v["id"] != q["id"])
            .cloned()
            .collect();
        let r2_excluded = if others.is_empty() && mods.is_empty() {
            model::numeric(&result["_stage1_results"]["structural"]["r_squared"][target])
        } else {
            model::numeric(
                &expanded(&columns, &rows, &spec, &settings, &others, &mods, false)?["structural"]
                    ["r_squared"][target],
            )
        };
        let b1 = model::numeric(&result["structural"]["path_coefficients"][target][pred]);
        let mut diagnostic = nonlinear::quadratic(nonlinear::QuadraticOptions {
            b1_linear: b1,
            b2_quad_unstd: model::numeric(&result["structural"]["path_coefficients"][target][term]),
            scale: model::numeric(&result["_quad_scales"][term]["scale"]),
            mean_sq: model::numeric(&result["_quad_scales"][term]["mean"]),
            predictor_scores: scores(&result["_stage1_results"])[pred]
                .as_array()
                .unwrap()
                .iter()
                .map(model::numeric)
                .collect(),
            b_linear_stage1: Some(
                result["_stage1_results"]["structural"]["path_coefficients"][target][pred]
                    .as_f64()
                    .unwrap_or(b1),
            ),
            f2_info: Some(nonlinear::effect_size(
                model::numeric(&result["structural"]["r_squared"][target]),
                r2_excluded,
                false,
            )),
            p_value: None,
            ci_lower: None,
            ci_upper: None,
        });
        for key in [
            "id",
            "predictor",
            "target",
            "predictor_name",
            "target_name",
            "quad_construct_name",
            "method",
            "node_x",
            "node_y",
        ] {
            diagnostic[key] = q[key].clone();
        }
        diagnostics.push(diagnostic);
    }
    if !quads.is_empty() {
        result["nonlinear_effects"] = json!(diagnostics);
    }
    let constructs = result["_expanded_spec"]["constructs"]
        .as_array()
        .unwrap()
        .clone();
    let ids: Vec<_> = constructs
        .iter()
        .map(|c| c["id"].as_str().unwrap().to_owned())
        .collect();
    let mut latent = Vec::new();
    let mut paths = Vec::new();
    for c in &constructs {
        let id = c["id"].as_str().unwrap();
        let is_quad = quads.iter().any(|q| q["quad_construct_name"] == id);
        let is_int = c["is_interaction"] == true || id.contains(" x ") || is_quad;
        let metadata = if !c["metadata"].is_null() {
            c["metadata"].clone()
        } else if is_int && id.contains(" x ") {
            let (moderator, predictor) = id.split_once(" x ").unwrap();
            json!({"moderator":moderator.trim(),"predictor":predictor.split(" x ").next().unwrap().trim(),"outcome":"","method":"two_stage"})
        } else {
            Value::Null
        };
        let name = c.get("name").unwrap_or(&c["id"]).clone();
        latent.push(json!({"id":id,"name":name,"type":c.get("type").cloned().unwrap_or(json!("reflective")),"is_interaction":is_int,"is_quadratic":c["is_quadratic"]==true || is_quad,"metadata":metadata}));
        result["construct_names"][id] = name;
        // Python assembles path rows in construct/predictor insertion order.
        let sources = if result["is_consistent"] == true {
            let mut sources = Vec::new();
            for path in result["_expanded_spec"]["paths"].as_array().unwrap() {
                if model::alias(path, &["to", "to_node"]) == Some(id) {
                    if let Some(source) = model::alias(path, &["from", "from_node"]) {
                        if !sources.iter().any(|s| s == source) {
                            sources.push(source.to_owned());
                        }
                    }
                }
            }
            sources
        } else {
            ids.clone()
        };
        for source in &sources {
            if let Some(beta) = result["structural"]["path_coefficients"][id].get(source) {
                paths.push(json!({"from":source,"to":id,"beta":beta}));
            }
        }
    }
    result["latent_variables"] = json!(latent);
    result["paths"] = json!(paths);
    for (alias, source) in [
        ("scores", "construct_scores"),
        ("r2", "r_squared"),
        ("f2", "f_squared"),
        ("vif", "inner_vif"),
    ] {
        result[alias] = if alias == "scores" {
            result[source].clone()
        } else {
            result["structural"]
                .get(source)
                .cloned()
                .unwrap_or(json!({}))
        };
    }
    let excluded: Vec<_> = constructs
        .iter()
        .filter(|c| {
            c["is_interaction"] == true
                || c["is_quadratic"] == true
                || c["id"].as_str().is_some_and(|id| id.contains(" x "))
        })
        .map(|c| c["id"].as_str().unwrap())
        .collect();
    for metric in [
        "cronbachs_alpha",
        "composite_reliability",
        "rho_a",
        "ave",
        "fornell_larcker",
        "htmt",
    ] {
        if let Some(values) = result
            .get_mut("reliability_and_validity")
            .and_then(|v| v.get_mut(metric))
            .and_then(Value::as_object_mut)
        {
            values.retain(|id, _| !excluded.contains(&id.as_str()));
            if metric == "fornell_larcker" || metric == "htmt" {
                for row in values.values_mut() {
                    if let Some(row) = row.as_object_mut() {
                        row.retain(|id, _| !excluded.contains(&id.as_str()));
                    }
                }
            }
        }
    }
    Ok(result)
}
