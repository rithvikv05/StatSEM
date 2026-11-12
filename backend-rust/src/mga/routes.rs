//! HTTP routes for the MGA module, keeping server.rs minimal.
use crate::mga::groups::{
    count_group_rows, eligible_group_columns, equalize_group_sizes, generate_data_groups,
    refresh_group_counts, validate_groups, DataGroup,
};
use crate::mga::jobs;
use crate::project_store::Dataset;
use crate::server;
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn handle(
    path: &str,
    body: &Value,
    query: &HashMap<String, String>,
) -> Result<Value, String> {
    match path {
        "/mga/groups/inspect" => groups_inspect(body, query),
        "/mga/groups/preview" => groups_preview(body, query),
        "/mga/groups/generate" => groups_generate(body, query),
        "/mga/groups/evaluate" => groups_evaluate(body, query),
        "/mga/groups/save" => groups_save(body, query),
        "/mga/groups/equalize" => groups_equalize(body, query),
        "/mga/permutation/start" => jobs::start_permutation(body, query),
        "/mga/permutation/status" => {
            let job_id = server::text(body, query, "job_id").ok_or("job_id required")?;
            jobs::permutation_status(&job_id)
        }
        "/mga/permutation/cancel" => {
            let job_id = server::text(body, query, "job_id").ok_or("job_id required")?;
            jobs::cancel_permutation(&job_id)
        }
        "/mga/bootstrap/start" => jobs::start_bootstrap_mga(body, query),
        "/mga/bootstrap/status" => {
            let job_id = server::text(body, query, "job_id").ok_or("job_id required")?;
            jobs::bootstrap_mga_status(&job_id)
        }
        "/mga/bootstrap/cancel" => {
            let job_id = server::text(body, query, "job_id").ok_or("job_id required")?;
            jobs::cancel_bootstrap_mga(&job_id)
        }
        "/mga/reports/list" => {
            let store = server::project(body, query)?;
            let model_id = server::text(body, query, "model_id");
            let reports = store.list_mga_reports(model_id.as_deref())?;
            Ok(json!({ "reports": reports }))
        }
        "/mga/reports/get" => {
            let store = server::project(body, query)?;
            let report_id = server::text(body, query, "report_id").ok_or("report_id required")?;
            let report = store.get_mga_report(&report_id)?;
            if report.is_null() {
                Err("Report not found".into())
            } else {
                Ok(json!({ "report": report }))
            }
        }
        "/mga/reports/delete" => {
            let store = server::project(body, query)?;
            let report_id = server::text(body, query, "report_id").ok_or("report_id required")?;
            store.delete_mga_report(&report_id)?;
            Ok(json!({ "status": "success" }))
        }
        _ => Err(format!("Unknown MGA route: {path}")),
    }
}

fn load_groups_from_body(body: &Value) -> Result<Vec<DataGroup>, String> {
    let raw = body
        .get("dataGroups")
        .or_else(|| body.get("data_groups"))
        .or_else(|| body.get("groups"))
        .cloned()
        .unwrap_or_else(|| json!([]));
    serde_json::from_value(raw).map_err(|e| e.to_string())
}

fn optional_spec(body: &Value, query: &HashMap<String, String>) -> Option<Value> {
    if body["spec"].is_object() {
        return Some(body["spec"].clone());
    }
    server::spec(body, query).ok()
}

fn groups_inspect(body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    let (columns, rows, _) = server::dataset(body, query)?;
    let eligible = eligible_group_columns(&columns, &rows);
    let mut groups = load_groups_from_body(body)?;
    refresh_group_counts(&columns, &rows, &mut groups);
    let sig_level = body["significanceLevel"]
        .as_f64()
        .or_else(|| body["significance_level"].as_f64())
        .unwrap_or(0.05);
    let min_r2 = body["minR2"]
        .as_f64()
        .or_else(|| body["min_r2"].as_f64())
        .unwrap_or(0.10);
    let spec = optional_spec(body, query);
    let (arrows, min_n, warnings) = validate_groups(&groups, spec.as_ref(), sig_level, min_r2);
    Ok(json!({
        "eligibleColumns": eligible,
        "groups": groups,
        "arrows": arrows,
        "recommendedMinN": min_n,
        "warnings": warnings,
    }))
}

fn selected_columns_from_body(body: &Value) -> Vec<String> {
    if let Some(arr) = body
        .get("selectedColumns")
        .or_else(|| body.get("columns_selected"))
        .and_then(Value::as_array)
    {
        return arr
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
    }
    let mut cols = Vec::new();
    for key in ["column0", "column1", "column2"] {
        if let Some(c) = body.get(key).and_then(Value::as_str) {
            if !c.trim().is_empty() && !c.eq_ignore_ascii_case("none") {
                cols.push(c.to_string());
            }
        }
    }
    cols
}

fn groups_preview(body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    let (columns, rows, _) = server::dataset(body, query)?;
    let prefix = body["prefix"].as_str().unwrap_or("GROUP");
    let selected = selected_columns_from_body(body);
    let min_cases = body["minimumCases"]
        .as_u64()
        .or_else(|| body["minimum_cases"].as_u64())
        .unwrap_or(10) as usize;
    let res = generate_data_groups(&columns, &rows, prefix, &selected, min_cases)?;
    Ok(json!(res))
}

fn groups_generate(body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    let (columns, rows, dataset_id) = server::dataset(body, query)?;
    let prefix = body["prefix"].as_str().unwrap_or("GROUP");
    let selected = selected_columns_from_body(body);
    let min_cases = body["minimumCases"]
        .as_u64()
        .or_else(|| body["minimum_cases"].as_u64())
        .unwrap_or(10) as usize;
    let res = generate_data_groups(&columns, &rows, prefix, &selected, min_cases)?;

    let mut existing = load_groups_from_body(body)?;
    existing.extend(res.groups.clone());

    if let Ok(store) = server::project(body, query) {
        let ds_id = dataset_id
            .as_str()
            .map(str::to_owned)
            .or_else(|| server::text(body, query, "dataset_id"));
        let _ = store.update_dataset_groups(ds_id.as_deref(), &json!(existing));
    }

    Ok(json!({
        "totalCombinations": res.total_combinations,
        "keptCount": res.kept_count,
        "prunedCount": res.pruned_count,
        "generatedGroups": res.groups,
        "dataGroups": existing,
    }))
}

fn groups_evaluate(body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    let (columns, rows, _) = server::dataset(body, query)?;
    if let Some(group_val) = body.get("group") {
        let mut group: DataGroup =
            serde_json::from_value(group_val.clone()).map_err(|e| e.to_string())?;
        group.record_count = count_group_rows(&columns, &rows, &group);
        return Ok(json!({ "group": group }));
    }
    let mut groups = load_groups_from_body(body)?;
    refresh_group_counts(&columns, &rows, &mut groups);
    let sig_level = body["significanceLevel"]
        .as_f64()
        .or_else(|| body["significance_level"].as_f64())
        .unwrap_or(0.05);
    let min_r2 = body["minR2"]
        .as_f64()
        .or_else(|| body["min_r2"].as_f64())
        .unwrap_or(0.10);
    let spec = optional_spec(body, query);
    let (arrows, min_n, warnings) = validate_groups(&groups, spec.as_ref(), sig_level, min_r2);
    Ok(json!({
        "dataGroups": groups,
        "arrows": arrows,
        "recommendedMinN": min_n,
        "warnings": warnings,
    }))
}

fn groups_save(body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    let (columns, rows, dataset_id) = server::dataset(body, query)?;
    let mut groups = load_groups_from_body(body)?;
    refresh_group_counts(&columns, &rows, &mut groups);
    let groups_val = json!(groups);
    let store = server::project(body, query)?;
    let ds_id = dataset_id
        .as_str()
        .map(str::to_owned)
        .or_else(|| server::text(body, query, "dataset_id"));
    store.update_dataset_groups(ds_id.as_deref(), &groups_val)?;
    Ok(json!({
        "status": "success",
        "dataGroups": groups_val,
    }))
}

fn groups_equalize(body: &Value, query: &HashMap<String, String>) -> Result<Value, String> {
    let (columns, rows, parent_id) = server::dataset(body, query)?;
    let group_a: DataGroup =
        serde_json::from_value(body["groupA"].clone()).map_err(|e| e.to_string())?;
    let group_b: DataGroup =
        serde_json::from_value(body["groupB"].clone()).map_err(|e| e.to_string())?;
    let seed = body["seed"]
        .as_u64()
        .unwrap_or_else(|| crate::rng::Pcg64::from_optional_seed(None).map(|mut r| r.next_u64()).unwrap_or(42));
    let (balanced_rows, target_n) =
        equalize_group_sizes(&columns, &rows, &group_a, &group_b, seed)?;

    let mut copied_groups = load_groups_from_body(body)?;
    if copied_groups.is_empty() {
        copied_groups = vec![group_a.clone(), group_b.clone()];
    }
    refresh_group_counts(&columns, &balanced_rows, &mut copied_groups);

    let orig_name = body["datasetName"]
        .as_str()
        .or_else(|| body["dataset_name"].as_str())
        .unwrap_or("dataset");
    let stem = orig_name
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(orig_name);
    let new_name = format!("{stem}_balanced");
    let new_id = body["newDatasetId"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| format!("ds_bal_{}", uuid::Uuid::new_v4()));

    if let Ok(store) = server::project(body, query) {
        let _ = store.save_dataset(Dataset {
            id: Some(new_id.clone()),
            name: new_name.clone(),
            columns: columns.clone(),
            rows: balanced_rows.clone(),
            parent_id: parent_id.as_str().map(str::to_owned),
            kind: "derived".into(),
            derivation: json!({
                "operation": "equalize_group_sizes",
                "groupA": group_a.name,
                "groupB": group_b.name,
                "targetN": target_n,
                "seed": seed,
            }),
            settings: Value::Null,
            data_groups: json!(copied_groups),
        });
    }

    Ok(json!({
        "status": "success",
        "datasetId": new_id,
        "datasetName": new_name,
        "columns": columns,
        "rows": balanced_rows,
        "dataGroups": copied_groups,
        "targetN": target_n,
        "seed": seed,
    }))
}
