//! Shared scalar group identity and pandas-compatible numeric group labels.
use crate::{model, python_json};
use serde_json::{json, Value};
pub fn equal(a: &Value, b: &Value) -> bool {
    if (a.is_number() || a.is_boolean()) && (b.is_number() || b.is_boolean()) {
        model::numeric(a) == model::numeric(b)
    } else {
        a == b
    }
}
pub fn label(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => {
            if *b {
                "True".into()
            } else {
                "False".into()
            }
        }
        _ => python_json::dumps(v),
    }
}
pub fn distinct(rows: &[Vec<Value>], j: usize) -> Vec<Value> {
    let floating = rows.iter().all(|r| r[j].is_number() || r[j].is_null())
        && rows
            .iter()
            .any(|r| r[j].is_null() || r[j].as_number().is_some_and(|n| n.is_f64()));
    let mut groups = Vec::new();
    for row in rows {
        let v = &row[j];
        if !v.is_null() && !groups.iter().any(|g| equal(g, v)) {
            groups.push(if floating {
                json!(model::numeric(v))
            } else {
                v.clone()
            });
        }
    }
    groups
}
