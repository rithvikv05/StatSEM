use serde_json::{json, Value};

#[test]
fn corporate_reputation_two_stage_matches_smartpls_paths() {
    // Seven-decimal coefficients exported from SmartPLS for the primer's
    // "Moderation - multiple interactions" model.
    let csv = include_str!("data/Corporate reputation data.csv");
    let mut records = csv.split(['\r', '\n']).filter(|line| !line.is_empty());
    let headers: Vec<_> = records.next().unwrap().split(';').collect();
    let blocks = [
        ("COMP", vec!["comp_1", "comp_2", "comp_3"]),
        ("LIKE", vec!["like_1", "like_2", "like_3"]),
        ("CUSA", vec!["cusa"]),
        ("CUSL", vec!["cusl_1", "cusl_2", "cusl_3"]),
        ("SWITCH_1", vec!["switch_1"]),
        ("SWITCH_2", vec!["switch_2"]),
        ("SWITCH_3", vec!["switch_3"]),
    ];
    let columns: Vec<String> = blocks
        .iter()
        .flat_map(|(_, indicators)| indicators.iter().map(|item| (*item).to_owned()))
        .collect();
    let positions: Vec<_> = columns
        .iter()
        .map(|column| headers.iter().position(|header| header == column).unwrap())
        .collect();
    let rows: Vec<Vec<Value>> = records
        .map(|record| {
            let fields: Vec<_> = record.split(';').collect();
            positions
                .iter()
                .map(|&index| json!(fields[index].parse::<f64>().unwrap()))
                .collect()
        })
        .collect();
    assert_eq!(rows.len(), 344);
    let constructs: Vec<_> = blocks
        .iter()
        .map(|(id, indicators)| {
            json!({"id": id, "name": id, "type": "reflective", "indicators": indicators})
        })
        .collect();
    let indicators: Vec<_> = columns
        .iter()
        .map(|column| json!({"id": column, "column": column}))
        .collect();
    let paths: Vec<_> = [
        ("COMP", "CUSA"),
        ("COMP", "CUSL"),
        ("LIKE", "CUSA"),
        ("LIKE", "CUSL"),
        ("CUSA", "CUSL"),
    ]
    .iter()
    .map(|(from, to)| json!({"from": from, "to": to}))
    .collect();
    let effects = json!([
        {"id":"m1","moderator":"SWITCH_1","source":"LIKE","target":"CUSL","method":"two_stage"},
        {"id":"m2","moderator":"SWITCH_2","source":"LIKE","target":"CUSL","method":"two_stage"},
        {"id":"m3","moderator":"SWITCH_3","source":"LIKE","target":"CUSL","method":"two_stage"},
        {"id":"m4","moderator":"SWITCH_2","source":"LIKE","target":"CUSL","method":"two_stage","attach_to_mod_id":"m1"},
        {"id":"m5","moderator":"SWITCH_3","source":"LIKE","target":"CUSL","method":"two_stage","attach_to_mod_id":"m1"},
        {"id":"m6","moderator":"SWITCH_3","source":"LIKE","target":"CUSL","method":"two_stage","attach_to_mod_id":"m2"},
        {"id":"m7","moderator":"SWITCH_3","source":"LIKE","target":"CUSL","method":"two_stage","attach_to_mod_id":"m4"}
    ]);
    let result = statsem_engine::pipeline::run(
        columns,
        rows,
        json!({"constructs":constructs,"indicators":indicators,"paths":paths,"moderating_effects":effects}),
        json!({"missing_treatment":"mean","missing_codes":[-99],"inner_weighting":"path","max_iter":3000,"tolerance":1e-7}),
    )
    .unwrap();
    let expected = [
        ("COMP", "CUSA", 0.1620527),
        ("LIKE", "CUSA", 0.4238673),
        ("COMP", "CUSL", -0.0088070),
        ("CUSA", "CUSL", 0.4895022),
        ("LIKE", "CUSL", 0.2404840),
        ("SWITCH_1", "CUSL", 0.0518546),
        ("SWITCH_2", "CUSL", 0.0846669),
        ("SWITCH_3", "CUSL", -0.0209021),
        ("SWITCH_1 x LIKE", "CUSL", 0.0595702),
        ("SWITCH_2 x LIKE", "CUSL", -0.1154840),
        ("SWITCH_3 x LIKE", "CUSL", -0.0026877),
        ("SWITCH_1 x SWITCH_2 x LIKE", "CUSL", 0.0014428),
        ("SWITCH_1 x SWITCH_3 x LIKE", "CUSL", -0.0188377),
        ("SWITCH_2 x SWITCH_3 x LIKE", "CUSL", 0.0957003),
        ("SWITCH_1 x SWITCH_2 x SWITCH_3 x LIKE", "CUSL", -0.0693473),
        ("SWITCH_1 x SWITCH_2", "CUSL", 0.1542959),
        ("SWITCH_1 x SWITCH_3", "CUSL", -0.0893776),
        ("SWITCH_2 x SWITCH_3", "CUSL", 0.0465971),
        ("SWITCH_1 x SWITCH_2 x SWITCH_3", "CUSL", -0.1058260),
    ];
    for (from, to, coefficient) in expected {
        let actual = result["structural"]["path_coefficients"][to][from]
            .as_f64()
            .unwrap();
        assert!(
            (actual - coefficient).abs() < 5e-8,
            "{from} -> {to}: expected {coefficient}, got {actual}"
        );
    }
}
