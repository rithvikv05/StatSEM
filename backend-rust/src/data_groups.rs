//! Categorical group summaries and sample-size diagnostics.
use crate::{grouping, model};
use serde_json::{json, Value};

pub fn categorical(
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    column: String,
    minimum: usize,
    predictors: usize,
) -> Result<Value, String> {
    if rows.iter().any(|r| r.len() != columns.len()) {
        return Err("Dataset row width differs from columns".into());
    }
    let j = columns
        .iter()
        .position(|c| c == &column)
        .ok_or_else(|| format!("Column '{column}' not found in dataset."))?;
    let numeric = rows.iter().all(|r| r[j].is_number() || r[j].is_null());
    let mut groups = grouping::distinct(&rows, j);
    if numeric {
        groups.retain(|g| model::numeric(g) != -99.0);
    }
    groups.sort_by(|a, b| {
        if numeric {
            model::numeric(a).total_cmp(&model::numeric(b))
        } else {
            grouping::label(a).cmp(&grouping::label(b))
        }
    });
    let missing = rows
        .iter()
        .filter(|r| r[j].is_null() || numeric && model::numeric(&r[j]) == -99.0)
        .count();
    let valid = rows.len() - missing;
    let ten = predictors
        .checked_mul(10)
        .ok_or("Predictor count too large")?;
    let mut critical = Vec::new();
    let mut warnings = Vec::new();
    let mut summary = Vec::new();
    for group in &groups {
        let count = rows
            .iter()
            .filter(|r| grouping::equal(group, &r[j]))
            .count();
        let label = grouping::label(group);
        if count < minimum {
            critical.push(format!(
                "Group '{label}' has only {count} observations (minimum required is {minimum})."
            ));
        } else if count < ten {
            warnings.push(format!(
                "Group '{label}' has {count} cases, below 10-times rule threshold ({ten})."
            ));
        } else if count < 54 {
            warnings.push(format!("Group '{label}' has {count} cases, below Cohen (1992) 80% statistical power threshold (54)."));
        }
        let repr = if let Value::String(s) = group {
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
                    c if c.is_control() || matches!(c, '\u{2028}' | '\u{2029}') => {
                        let value = c as u32;
                        out.push_str(&if value < 256 {
                            format!("\\x{value:02x}")
                        } else {
                            format!("\\u{value:04x}")
                        });
                    }
                    c => out.push(c),
                }
            }
            out.push(quote);
            out
        } else {
            label.clone()
        };
        summary.push(json!({"name":format!("{column}={label}"),"value":group,"count":count,"percentage":count as f64/rows.len() as f64*100.0,"valid_percentage":count as f64/valid as f64*100.0,"filter_expression":format!("df['{column}'] == {repr}"),"is_valid_size":count>=minimum,"power_status":if count>=54{"adequate"}else if count>=ten{"caution"}else{"low_power"}}));
    }
    Ok(
        json!({"column":column,"total_observations":rows.len(),"total_samples":rows.len(),"valid_observations":valid,"missing_count":missing,"n_groups":groups.len(),"groups":summary,"has_critical_error":!critical.is_empty(),"critical_errors":critical,"power_warnings":warnings,"ten_times_threshold":ten,"cohen_threshold":54}),
    )
}
