//! Python json.dumps(sort_keys=True) representation used by saved spec hashes.
//! Database JSON blobs need semantic parity; existing cache hashes also need
//! Python's spacing, Unicode escaping and float representation.
use serde_json::Value;
use sha2::{Digest, Sha256};

fn string(value: &str) -> String {
    let mut out = String::from("\"");
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000c}' => out.push_str("\\f"),
            ch if ch.is_ascii() && (' '..'\u{007f}').contains(&ch) => out.push(ch),
            ch => {
                let mut buf = [0; 2];
                for unit in ch.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
        }
    }
    out.push('"');
    out
}
pub fn dumps(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::String(s) => string(s),
        Value::Number(n) => {
            if n.is_f64() {
                let value = n.as_f64().unwrap();
                let text = format!("{value:?}");
                if let Some((mantissa, exponent)) = text.split_once('e') {
                    let exponent: i32 = exponent.parse().unwrap();
                    format!("{mantissa}e{exponent:+03}")
                } else {
                    text
                }
            } else {
                n.to_string()
            }
        }
        Value::Array(values) => format!(
            "[{}]",
            values.iter().map(dumps).collect::<Vec<_>>().join(", ")
        ),
        Value::Object(values) => format!(
            "{{{}}}",
            values
                .iter()
                .map(|(key, value)| format!("{}: {}", string(key), dumps(value)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}
pub fn spec_hash(spec: &Value) -> String {
    if spec.is_null()
        || spec.as_object().is_some_and(|v| v.is_empty())
        || spec.as_array().is_some_and(|v| v.is_empty())
        || spec == &Value::Bool(false)
        || spec.as_str() == Some("")
        || spec.as_f64() == Some(0.0)
    {
        return "empty".into();
    }
    let hash = Sha256::digest(dumps(spec).as_bytes());
    format!("{hash:x}")[..16].to_owned()
}
