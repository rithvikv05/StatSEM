//! Phase 1 — Data Groups generation, filtering, validation warnings, and group size equalization.
use crate::mga::adapter::max_incoming_arrows;
use crate::{model, rng};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GroupTerm {
    pub column: String,
    pub operator: String,
    pub value1: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value2: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataGroup {
    pub id: String,
    pub name: String,
    #[serde(default = "default_link_type", alias = "condition_link_type")]
    pub condition_link_type: String,
    #[serde(default)]
    pub terms: Vec<GroupTerm>,
    #[serde(default, alias = "record_count")]
    pub record_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "row_ids")]
    pub row_ids: Option<Vec<usize>>,
}

fn default_link_type() -> String {
    "AND".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UniqueValueItem {
    pub label: String,
    pub raw: Value,
    pub count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EligibleColumn {
    pub name: String,
    pub unique_count: usize,
    pub values: Vec<UniqueValueItem>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateGroupsResult {
    pub total_combinations: usize,
    pub kept_count: usize,
    pub pruned_count: usize,
    pub groups: Vec<DataGroup>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupWarning {
    pub kind: String, // "min_sample_size" | "comparable_size"
    pub severity: String, // "warning"
    pub message: String,
    pub group_names: Vec<String>,
}

/// Hair et al. (2014), Table 10.1 — Minimum sample size for 80% statistical power.
/// Rows: arrows 2..=10; Cols: (1%: .10,.25,.50,.75), (5%: .10,.25,.50,.75), (10%: .10,.25,.50,.75).
const MIN_N_TABLE: [[[usize; 4]; 3]; 9] = [
    // arrows = 2
    [[158, 75, 47, 38], [110, 52, 33, 26], [88, 41, 26, 21]],
    // arrows = 3
    [[176, 84, 53, 42], [124, 59, 38, 30], [100, 48, 30, 25]],
    // arrows = 4
    [[191, 91, 58, 46], [137, 65, 42, 33], [111, 53, 34, 27]],
    // arrows = 5
    [[205, 98, 62, 50], [147, 70, 45, 36], [120, 58, 37, 30]],
    // arrows = 6
    [[217, 103, 66, 53], [157, 75, 48, 39], [128, 62, 40, 32]],
    // arrows = 7
    [[228, 109, 69, 56], [166, 80, 51, 41], [136, 66, 42, 35]],
    // arrows = 8
    [[238, 114, 73, 59], [174, 84, 54, 44], [143, 69, 45, 37]],
    // arrows = 9
    [[247, 119, 76, 62], [181, 88, 57, 46], [150, 73, 47, 39]],
    // arrows = 10
    [[256, 123, 79, 64], [189, 91, 59, 48], [156, 76, 49, 41]],
];

/// Look up recommended minimum sample size per group from Hair et al. (2014) Table 10.1.
pub fn lookup_min_sample_size(arrows: usize, sig_level: f64, min_r2: f64) -> usize {
    let row = arrows.clamp(2, 10) - 2;
    let sig_idx = if (sig_level - 0.01).abs() < 0.005 {
        0
    } else if (sig_level - 0.10).abs() < 0.025 {
        2
    } else {
        1 // default 5%
    };
    let r2_idx = if (min_r2 - 0.25).abs() < 0.07 {
        1
    } else if (min_r2 - 0.50).abs() < 0.12 {
        2
    } else if (min_r2 - 0.75).abs() < 0.15 {
        3
    } else {
        0 // default 0.10
    };
    MIN_N_TABLE[row][sig_idx][r2_idx]
}

fn is_empty_or_missing_cell(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::String(s) => {
            let t = s.trim();
            t.is_empty()
                || t.eq_ignore_ascii_case("na")
                || t.eq_ignore_ascii_case("nan")
                || t.eq_ignore_ascii_case("null")
                || t == "-99"
        }
        Value::Number(n) => n.as_f64().is_some_and(|x| !x.is_finite() || x == -99.0),
        _ => false,
    }
}

fn try_numeric(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64().filter(|x| x.is_finite()),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                t.parse::<f64>().ok().filter(|x| x.is_finite())
            }
        }
        _ => None,
    }
}

/// Format a group value label following SmartPLS convention:
/// numeric-looking integers get `.0` (e.g. `1` -> `"1.0"`), strings stay as text.
pub fn format_group_value_label(v: &Value) -> String {
    if let Some(num) = try_numeric(v) {
        if (num - num.trunc()).abs() < 1e-12 {
            let rounded = if num == 0.0 { 0.0 } else { num.trunc() };
            return format!("{rounded:.1}");
        }
        return num.to_string();
    }
    match v {
        Value::String(s) => s.trim().to_string(),
        Value::Bool(b) => {
            if *b {
                "true".into()
            } else {
                "false".into()
            }
        }
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn values_equal(cell: &Value, target: &Value) -> bool {
    if is_empty_or_missing_cell(cell) || is_empty_or_missing_cell(target) {
        return false;
    }
    if let (Some(a), Some(b)) = (try_numeric(cell), try_numeric(target)) {
        return (a - b).abs() < 1e-12;
    }
    format_group_value_label(cell) == format_group_value_label(target)
}

fn eval_term(row: &[Value], columns: &[String], term: &GroupTerm) -> bool {
    let Some(col_idx) = columns.iter().position(|c| c == &term.column) else {
        return false;
    };
    let Some(cell) = row.get(col_idx) else {
        return false;
    };
    if is_empty_or_missing_cell(cell) {
        return false;
    }
    let op = term.operator.trim().to_lowercase();
    match op.as_str() {
        "is equal to" | "==" | "=" | "equals" => values_equal(cell, &term.value1),
        "is not equal to" | "!=" | "<>" | "not equals" => !values_equal(cell, &term.value1),
        "is greater than" | ">" => match (try_numeric(cell), try_numeric(&term.value1)) {
            (Some(a), Some(b)) => a > b,
            _ => false,
        },
        "is less than" | "<" => match (try_numeric(cell), try_numeric(&term.value1)) {
            (Some(a), Some(b)) => a < b,
            _ => false,
        },
        "is between" | "between" => {
            let Some(v2) = term.value2.as_ref() else {
                return false;
            };
            match (try_numeric(cell), try_numeric(&term.value1), try_numeric(v2)) {
                (Some(a), Some(b1), Some(b2)) => {
                    let lo = b1.min(b2);
                    let hi = b1.max(b2);
                    a >= lo && a <= hi
                }
                _ => false,
            }
        }
        "is not between" | "not between" => {
            let Some(v2) = term.value2.as_ref() else {
                return false;
            };
            match (try_numeric(cell), try_numeric(&term.value1), try_numeric(v2)) {
                (Some(a), Some(b1), Some(b2)) => {
                    let lo = b1.min(b2);
                    let hi = b1.max(b2);
                    a < lo || a > hi
                }
                _ => false,
            }
        }
        _ => false,
    }
}

/// Phase 1: `getGroupRows(dataRows, group) -> (matched_row_indices, matched_rows)`.
pub fn get_group_rows(
    columns: &[String],
    rows: &[Vec<Value>],
    group: &DataGroup,
) -> (Vec<usize>, Vec<Vec<Value>>) {
    let row_id_set: Option<HashSet<usize>> = group
        .row_ids
        .as_ref()
        .map(|ids| ids.iter().copied().collect());
    if group.terms.is_empty() && row_id_set.is_none() {
        return (Vec::new(), Vec::new());
    }
    let is_or = group.condition_link_type.trim().eq_ignore_ascii_case("OR");
    let mut indices = Vec::new();
    let mut matched = Vec::new();
    for (idx, row) in rows.iter().enumerate() {
        if let Some(allowed) = &row_id_set {
            if !allowed.contains(&idx) {
                continue;
            }
        }
        let ok = if group.terms.is_empty() {
            true
        } else if is_or {
            group.terms.iter().any(|t| eval_term(row, columns, t))
        } else {
            group.terms.iter().all(|t| eval_term(row, columns, t))
        };
        if ok {
            indices.push(idx);
            matched.push(row.clone());
        }
    }
    (indices, matched)
}

pub fn count_group_rows(columns: &[String], rows: &[Vec<Value>], group: &DataGroup) -> usize {
    get_group_rows(columns, rows, group).0.len()
}

pub fn refresh_group_counts(
    columns: &[String],
    rows: &[Vec<Value>],
    groups: &mut [DataGroup],
) {
    for g in groups.iter_mut() {
        g.record_count = count_group_rows(columns, rows, g);
    }
}

/// Collect columns with 1..=20 unique non-missing values (for Generate Data Groups dropdowns).
pub fn eligible_group_columns(columns: &[String], rows: &[Vec<Value>]) -> Vec<EligibleColumn> {
    let mut out = Vec::new();
    for (col_idx, col_name) in columns.iter().enumerate() {
        let mut counts: BTreeMap<String, (Value, usize)> = BTreeMap::new();
        let mut too_many = false;
        for row in rows {
            let Some(cell) = row.get(col_idx) else {
                continue;
            };
            if is_empty_or_missing_cell(cell) {
                continue;
            }
            let lbl = format_group_value_label(cell);
            if lbl.is_empty() {
                continue;
            }
            if let Some(entry) = counts.get_mut(&lbl) {
                entry.1 += 1;
            } else {
                if counts.len() >= 20 {
                    too_many = true;
                    break;
                }
                let raw = if let Some(num) = try_numeric(cell) {
                    json!(num)
                } else {
                    Value::String(lbl.clone())
                };
                counts.insert(lbl, (raw, 1));
            }
        }
        if !too_many && !counts.is_empty() {
            let mut items: Vec<UniqueValueItem> = counts
                .into_iter()
                .map(|(label, (raw, count))| UniqueValueItem { label, raw, count })
                .collect();
            let all_numeric = items.iter().all(|item| try_numeric(&item.raw).is_some());
            if all_numeric {
                items.sort_by(|a, b| {
                    try_numeric(&a.raw)
                        .unwrap_or(0.0)
                        .total_cmp(&try_numeric(&b.raw).unwrap_or(0.0))
                });
            } else {
                items.sort_by(|a, b| a.label.cmp(&b.label));
            }
            out.push(EligibleColumn {
                name: col_name.clone(),
                unique_count: items.len(),
                values: items,
            });
        }
    }
    out
}

/// Generate Cartesian-product data groups from 1..3 columns and prune below `minimum_cases`.
pub fn generate_data_groups(
    columns: &[String],
    rows: &[Vec<Value>],
    prefix: &str,
    selected_columns: &[String],
    minimum_cases: usize,
) -> Result<GenerateGroupsResult, String> {
    let clean_prefix = if prefix.trim().is_empty() {
        "GROUP".to_string()
    } else {
        prefix.trim().to_string()
    };
    let mut chosen: Vec<String> = Vec::new();
    for col in selected_columns {
        let trimmed = col.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("none") {
            continue;
        }
        if !columns.iter().any(|c| c == trimmed) {
            return Err(format!("Grouping column '{trimmed}' not found in dataset."));
        }
        if !chosen.iter().any(|c| c == trimmed) {
            chosen.push(trimmed.to_string());
        }
    }
    if chosen.is_empty() {
        return Err("At least one grouping column must be selected.".into());
    }
    if chosen.len() > 3 {
        return Err("At most 3 grouping columns can be combined.".into());
    }

    let eligible = eligible_group_columns(columns, rows);
    let mut per_col_values: Vec<(String, Vec<UniqueValueItem>)> = Vec::new();
    for col in &chosen {
        let found = eligible
            .iter()
            .find(|c| &c.name == col)
            .ok_or_else(|| format!("Column '{col}' has more than 20 unique values or no valid values."))?;
        per_col_values.push((col.clone(), found.values.clone()));
    }

    // Cartesian product across selected columns.
    let mut combos: Vec<Vec<(String, UniqueValueItem)>> = vec![Vec::new()];
    for (col_name, vals) in &per_col_values {
        let mut next = Vec::with_capacity(combos.len() * vals.len());
        for existing in &combos {
            for val in vals {
                let mut row = existing.clone();
                row.push((col_name.clone(), val.clone()));
                next.push(row);
            }
        }
        combos = next;
    }

    let total_combinations = combos.len();
    let mut groups = Vec::new();
    let mut pruned_count = 0usize;

    for combo in combos {
        let terms: Vec<GroupTerm> = combo
            .iter()
            .map(|(col, item)| GroupTerm {
                column: col.clone(),
                operator: "is equal to".into(),
                value1: item.raw.clone(),
                value2: None,
            })
            .collect();
        let suffix: Vec<String> = combo
            .iter()
            .map(|(col, item)| format!("{col}({})", item.label))
            .collect();
        let name = format!("{clean_prefix}_{}", suffix.join("_"));
        let mut group = DataGroup {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            condition_link_type: "AND".into(),
            terms,
            record_count: 0,
            row_ids: None,
        };
        let count = count_group_rows(columns, rows, &group);
        if count == 0 || count < minimum_cases {
            pruned_count += 1;
            continue;
        }
        group.record_count = count;
        groups.push(group);
    }

    let kept_count = groups.len();
    Ok(GenerateGroupsResult {
        total_combinations,
        kept_count,
        pruned_count,
        groups,
    })
}

/// Phase 1 (§3.5): Group validation warnings (Hair et al. 2014 Table 10.1 + 50% comparability rule).
pub fn validate_groups(
    groups: &[DataGroup],
    spec: Option<&Value>,
    sig_level: f64,
    min_r2: f64,
) -> (usize, usize, Vec<GroupWarning>) {
    let arrows = spec.map(max_incoming_arrows).unwrap_or(2);
    let min_n = lookup_min_sample_size(arrows, sig_level, min_r2);
    let mut warnings = Vec::new();

    for g in groups {
        if g.record_count < min_n {
            warnings.push(GroupWarning {
                kind: "min_sample_size".into(),
                severity: "warning".into(),
                message: format!(
                    "Group '{}' has {} cases; the recommended minimum for 80% power is {}.",
                    g.name, g.record_count, min_n
                ),
                group_names: vec![g.name.clone()],
            });
        }
    }

    for i in 0..groups.len() {
        for j in (i + 1)..groups.len() {
            let n_a = groups[i].record_count;
            let n_b = groups[j].record_count;
            let min_sz = n_a.min(n_b);
            let max_sz = n_a.max(n_b);
            if min_sz == 0 || (max_sz as f64) > 1.5 * (min_sz as f64) {
                warnings.push(GroupWarning {
                    kind: "comparable_size".into(),
                    severity: "warning".into(),
                    message: format!(
                        "Group sizes for '{}' (n={}) and '{}' (n={}) differ by more than 50% — results of the group comparison may be biased. Consider randomly removing cases from the larger group or collecting more data.",
                        groups[i].name, n_a, groups[j].name, n_b
                    ),
                    group_names: vec![groups[i].name.clone(), groups[j].name.clone()],
                });
            }
        }
    }

    (arrows, min_n, warnings)
}

/// Phase 1 (§3.5c): Randomly equalize two group sizes (seeded), returning a balanced dataset rows subset.
pub fn equalize_group_sizes(
    columns: &[String],
    rows: &[Vec<Value>],
    group_a: &DataGroup,
    group_b: &DataGroup,
    seed: u64,
) -> Result<(Vec<Vec<Value>>, usize), String> {
    if group_a.id == group_b.id {
        return Err("Select two distinct groups to equalize.".into());
    }
    let (idx_a, _) = get_group_rows(columns, rows, group_a);
    let (idx_b, _) = get_group_rows(columns, rows, group_b);
    let set_a: HashSet<usize> = idx_a.iter().copied().collect();
    if idx_b.iter().any(|id| set_a.contains(id)) {
        return Err("Groups must not share cases.".into());
    }
    if idx_a.is_empty() || idx_b.is_empty() {
        return Err("Both groups must contain at least one case.".into());
    }
    let target_n = idx_a.len().min(idx_b.len());
    let mut drop_set = HashSet::new();
    let mut gen = rng::Pcg64::new(&rng::integer_entropy(seed));
    if idx_a.len() > target_n {
        let perm = gen.permutation(idx_a.len());
        for &pos in &perm[target_n..] {
            drop_set.insert(idx_a[pos]);
        }
    } else if idx_b.len() > target_n {
        let perm = gen.permutation(idx_b.len());
        for &pos in &perm[target_n..] {
            drop_set.insert(idx_b[pos]);
        }
    }

    let balanced_rows: Vec<Vec<Value>> = rows
        .iter()
        .enumerate()
        .filter(|(idx, _)| !drop_set.contains(idx))
        .map(|(_, row)| row.clone())
        .collect();

    Ok((balanced_rows, target_n))
}

/// Validate that model & data groups satisfy Phase 9 constraints before Permutation or MGA runs.
pub fn validate_pair_for_comparison(
    columns: &[String],
    rows: &[Vec<Value>],
    spec: &Value,
    group_a: &DataGroup,
    group_b: &DataGroup,
    casewise_deletion: bool,
) -> Result<(Vec<Vec<Value>>, Vec<Vec<Value>>), String> {
    if group_a.id == group_b.id {
        return Err("Group A and Group B must be different.".into());
    }
    let (idx_a, mut rows_a) = get_group_rows(columns, rows, group_a);
    let (idx_b, mut rows_b) = get_group_rows(columns, rows, group_b);

    let set_a: HashSet<usize> = idx_a.iter().copied().collect();
    if idx_b.iter().any(|idx| set_a.contains(idx)) {
        return Err("Groups must not share cases.".into());
    }

    if casewise_deletion {
        rows_a = crate::mga::adapter::filter_casewise_rows(columns, &rows_a, spec)?;
        rows_b = crate::mga::adapter::filter_casewise_rows(columns, &rows_b, spec)?;
    }

    let parsed = model::parse(spec)?;
    let max_inds = parsed
        .blocks
        .iter()
        .map(|b| b.indicators.len())
        .max()
        .unwrap_or(1);
    let min_required = 10usize.max(max_inds);

    if rows_a.len() < min_required {
        return Err(format!(
            "Group '{}' has {} usable cases, fewer than the required minimum of {} (max(10, largest construct indicators = {})).",
            group_a.name, rows_a.len(), min_required, max_inds
        ));
    }
    if rows_b.len() < min_required {
        return Err(format!(
            "Group '{}' has {} usable cases, fewer than the required minimum of {} (max(10, largest construct indicators = {})).",
            group_b.name, rows_b.len(), min_required, max_inds
        ));
    }

    Ok((rows_a, rows_b))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_table() -> (Vec<String>, Vec<Vec<Value>>) {
        let cols = vec![
            "GENDER".into(),
            "MARITAL".into(),
            "AGE".into(),
            "COUNTRY".into(),
        ];
        let mut rows = Vec::new();
        for i in 0..30 {
            let gender = if i < 18 { 1 } else { 2 };
            let marital = if i % 3 == 0 { 1 } else { 2 };
            let age = 20 + (i % 40);
            let country = if i % 2 == 0 { "US" } else { "DE" };
            rows.push(vec![
                json!(gender),
                json!(marital),
                json!(age),
                json!(country),
            ]);
        }
        (cols, rows)
    }

    #[test]
    fn phase1_generate_single_column_groups_and_naming() {
        let (cols, rows) = sample_table();
        let res = generate_data_groups(&cols, &rows, "GROUP", &["GENDER".into()], 10).unwrap();
        assert_eq!(res.total_combinations, 2);
        assert_eq!(res.kept_count, 2);
        assert_eq!(res.groups[0].name, "GROUP_GENDER(1.0)");
        assert_eq!(res.groups[0].record_count, 18);
        assert_eq!(res.groups[1].name, "GROUP_GENDER(2.0)");
        assert_eq!(res.groups[1].record_count, 12);
    }

    #[test]
    fn phase1_generate_two_columns_cartesian_and_pruning() {
        let (cols, rows) = sample_table();
        // Combinations:
        // (1,1): 6 cases, (1,2): 12 cases, (2,1): 4 cases, (2,2): 8 cases -> min 10 keeps only (1,2) with 12 cases.
        let res = generate_data_groups(
            &cols,
            &rows,
            "GROUP",
            &["GENDER".into(), "MARITAL".into()],
            10,
        )
        .unwrap();
        assert_eq!(res.total_combinations, 4);
        assert_eq!(res.kept_count, 1);
        assert_eq!(res.pruned_count, 3);
        assert_eq!(res.groups[0].name, "GROUP_GENDER(1.0)_MARITAL(2.0)");
        assert_eq!(res.groups[0].record_count, 12);
    }

    #[test]
    fn phase1_text_categorical_and_operators() {
        let (cols, rows) = sample_table();
        let g_or = DataGroup {
            id: "g1".into(),
            name: "US or Older".into(),
            condition_link_type: "OR".into(),
            terms: vec![
                GroupTerm {
                    column: "COUNTRY".into(),
                    operator: "is equal to".into(),
                    value1: json!("US"),
                    value2: None,
                },
                GroupTerm {
                    column: "AGE".into(),
                    operator: "is between".into(),
                    value1: json!(50),
                    value2: Some(json!(60)),
                },
            ],
            record_count: 0,
            row_ids: None,
        };
        let (_, matched) = get_group_rows(&cols, &rows, &g_or);
        assert!(matched.len() >= 15);

        let g_gt = DataGroup {
            id: "g2".into(),
            name: "Age > 40".into(),
            condition_link_type: "AND".into(),
            terms: vec![GroupTerm {
                column: "AGE".into(),
                operator: "is greater than".into(),
                value1: json!(40),
                value2: None,
            }],
            record_count: 0,
            row_ids: None,
        };
        let (_, gt_rows) = get_group_rows(&cols, &rows, &g_gt);
        assert!(gt_rows.iter().all(|r| r[2].as_i64().unwrap() > 40));
    }

    #[test]
    fn phase1_hair_table_lookup_and_warnings() {
        assert_eq!(lookup_min_sample_size(2, 0.05, 0.10), 110);
        assert_eq!(lookup_min_sample_size(1, 0.05, 0.10), 110);
        assert_eq!(lookup_min_sample_size(10, 0.01, 0.75), 64);
        assert_eq!(lookup_min_sample_size(25, 0.10, 0.25), 76); // capped at 10

        let groups = vec![
            DataGroup {
                id: "a".into(),
                name: "Male".into(),
                condition_link_type: "AND".into(),
                terms: vec![],
                record_count: 160,
                row_ids: None,
            },
            DataGroup {
                id: "b".into(),
                name: "Female".into(),
                condition_link_type: "AND".into(),
                terms: vec![],
                record_count: 80,
                row_ids: None,
            },
        ];
        let (_, min_n, warnings) = validate_groups(&groups, None, 0.05, 0.10);
        assert_eq!(min_n, 110);
        assert!(warnings.iter().any(|w| w.kind == "min_sample_size" && w.message.contains("Female")));
        assert!(warnings.iter().any(|w| w.kind == "comparable_size" && w.message.contains("50%")));
    }

    #[test]
    fn phase1_equalize_group_sizes_balances_deterministically() {
        let (cols, rows) = sample_table();
        let gen = generate_data_groups(&cols, &rows, "GROUP", &["GENDER".into()], 1).unwrap();
        let (balanced, target_n) =
            equalize_group_sizes(&cols, &rows, &gen.groups[0], &gen.groups[1], 42).unwrap();
        assert_eq!(target_n, 12);
        assert_eq!(count_group_rows(&cols, &balanced, &gen.groups[0]), 12);
        assert_eq!(count_group_rows(&cols, &balanced, &gen.groups[1]), 12);
    }

    #[test]
    fn phase1_data_groups_persist_in_pls_project_store() {
        let dir = std::env::temp_dir().join(format!("statsem-mga-grp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("study.pls");
        let store = crate::project_store::Store::new(&path);
        store.create("MGA Study").unwrap();

        let (cols, rows) = sample_table();
        let gen = generate_data_groups(&cols, &rows, "GROUP", &["GENDER".into()], 10).unwrap();
        store
            .save_dataset(crate::project_store::Dataset {
                id: Some("ds1".into()),
                name: "Sample".into(),
                columns: cols,
                rows,
                data_groups: json!(gen.groups),
                ..Default::default()
            })
            .unwrap();

        let loaded = store.dataset(Some("ds1")).unwrap();
        let groups: Vec<DataGroup> = serde_json::from_value(loaded["dataGroups"].clone()).unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].name, "GROUP_GENDER(1.0)");
        assert_eq!(groups[0].record_count, 18);

        std::fs::remove_dir_all(dir).unwrap();
    }
}
