//! In-memory dataset derivations. Persistence/lineage uses a separate service.
use crate::{grouping, imputation, inference, model, stats};
use serde_json::{json, Value};

pub fn apply(
    mut columns: Vec<String>,
    mut rows: Vec<Vec<Value>>,
    operation: &str,
    params: Value,
) -> Result<Value, String> {
    if rows.iter().any(|r| r.len() != columns.len()) {
        return Err("Dataset row width differs from columns".into());
    }
    let initial = rows.len();
    let op = operation.to_lowercase();
    let mut meta = json!({"operation":op,"params":params});
    let selected = |columns: &[String], numeric: bool, empty_is_all: bool| -> Vec<usize> {
        let requested = params["columns"].as_array();
        let positions: Vec<_> = match requested {
            Some(list) if !list.is_empty() || !empty_is_all => list
                .iter()
                .filter_map(|v| columns.iter().position(|c| Some(c.as_str()) == v.as_str()))
                .collect(),
            _ => (0..columns.len()).collect(),
        };
        positions
            .into_iter()
            .filter(|&j| {
                !numeric
                    || rows.iter().all(|r| r[j].is_number() || r[j].is_null())
                        && rows.iter().any(|r| r[j].is_number())
                    || numeric && rows.iter().all(|r| r[j].is_boolean())
            })
            .collect()
    };
    match op.as_str() {
        "filter_rows" => {
            for filter in params["filters"].as_array().into_iter().flatten() {
                let Some(j) = columns
                    .iter()
                    .position(|c| Some(c.as_str()) == filter["column"].as_str())
                else {
                    continue;
                };
                let value = &filter["value"];
                let operator = filter["op"].as_str().unwrap_or("==");
                rows.retain(|r| {
                    let x = &r[j];
                    let xn = model::numeric(x);
                    let yn = model::numeric(value);
                    match operator {
                        "==" => !x.is_null() && !value.is_null() && grouping::equal(x, value),
                        "!=" => x.is_null() || value.is_null() || !grouping::equal(x, value),
                        ">" => xn > yn,
                        ">=" => xn >= yn,
                        "<" => xn < yn,
                        "<=" => xn <= yn,
                        "in" | "not_in" => {
                            let contains = value.as_array().map_or_else(
                                || grouping::equal(x, value),
                                |v| v.iter().any(|v| grouping::equal(x, v)),
                            );
                            contains == (operator == "in")
                        }
                        _ => true,
                    }
                });
            }
        }
        "select_columns" => {
            let positions: Vec<_> = params["columns"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| columns.iter().position(|c| Some(c.as_str()) == v.as_str()))
                .collect();
            if !positions.is_empty() {
                columns = positions.iter().map(|&j| columns[j].clone()).collect();
                rows = rows
                    .iter()
                    .map(|r| positions.iter().map(|&j| r[j].clone()).collect())
                    .collect();
            }
        }
        "casewise_deletion" => {
            let positions = selected(&columns, false, false);
            let maximum = params["max_missing_pct"].as_f64().unwrap_or(0.0);
            rows.retain(|r| {
                let count = positions.iter().filter(|&&j| r[j].is_null()).count();
                if maximum == 0.0 {
                    count == 0
                } else {
                    count as f64 / positions.len() as f64 * 100.0 <= maximum
                }
            });
        }
        "remove_cases" => {
            let remove = params["row_indices"].as_array();
            rows = rows
                .into_iter()
                .enumerate()
                .filter(|(i, _)| {
                    !remove.is_some_and(|v| v.iter().any(|v| v.as_u64() == Some(*i as u64)))
                })
                .map(|(_, r)| r)
                .collect();
        }
        "mean_replace" | "em_impute" | "knn_impute" => {
            let positions = selected(&columns, true, true);
            let input = rows
                .iter()
                .map(|r| {
                    positions
                        .iter()
                        .map(|&j| {
                            if r[j].is_null() {
                                None
                            } else {
                                Some(model::numeric(&r[j]))
                            }
                        })
                        .collect()
                })
                .collect();
            let method = match op.as_str() {
                "mean_replace" => "mean",
                "em_impute" => "em",
                _ => "knn",
            };
            let imputed = imputation::run(
                input,
                method,
                params["max_iter"].as_u64().unwrap_or(100) as usize,
                params["tol"].as_f64().unwrap_or(1e-4),
                params["k"].as_u64().unwrap_or(5) as usize,
            )?;
            for (i, row) in rows.iter_mut().enumerate() {
                for (p, &j) in positions.iter().enumerate() {
                    if imputed["imputed"].as_u64().unwrap_or(0) > 0
                        && (method != "mean" || row[j].is_null())
                    {
                        row[j] = imputed["rows"][i][p].clone();
                    }
                }
            }
            meta["cells_imputed"] = imputed["imputed"].clone();
            if method == "em" {
                meta["iterations"] = imputed["iterations"].clone();
            }
        }
        "median_split" | "mean_split" => {
            let name = params["column"].as_str().unwrap_or("None");
            let j = columns
                .iter()
                .position(|c| c == name)
                .ok_or_else(|| format!("Column '{name}' not found for split."))?;
            let mut observed: Vec<_> = rows
                .iter()
                .map(|r| model::numeric(&r[j]))
                .filter(|v| !v.is_nan())
                .collect();
            let split = if op == "mean_split" {
                stats::mean(&observed, None)
            } else {
                observed.sort_by(f64::total_cmp);
                if observed.is_empty() {
                    f64::NAN
                } else {
                    inference::percentile(&observed, 0.5)
                }
            };
            let group = params["group"].as_str().unwrap_or("high");
            rows.retain(|r| {
                let x = model::numeric(&r[j]);
                if group == "high" {
                    x >= split
                } else {
                    x < split
                }
            });
            meta["split_value"] = json!(split);
            meta["selected_group"] = json!(group);
        }
        _ => return Err(format!("Unsupported derivation operation: '{operation}'")),
    }
    meta["initial_rows"] = json!(initial);
    meta["final_rows"] = json!(rows.len());
    Ok(json!({"columns":columns,"rows":rows,"meta":meta}))
}
