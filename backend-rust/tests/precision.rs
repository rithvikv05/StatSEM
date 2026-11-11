use serde_json::{json, Value};
use statsem_engine::{analysis, blindfolding, cta, pipeline, power, predict};
use std::sync::atomic::AtomicBool;

fn sample_model() -> (Vec<String>, Vec<Vec<Value>>, Value) {
    let columns = vec![
        "a1".into(),
        "a2".into(),
        "a3".into(),
        "a4".into(),
        "m1".into(),
        "m2".into(),
        "m3".into(),
        "b1".into(),
        "b2".into(),
        "b3".into(),
    ];
    let mut rows = Vec::new();
    for i in 0..48 {
        let x = (i as f64) * 0.137 - 3.1;
        let z1 = ((i * 7 + 3) % 19) as f64 / 19.0 - 0.5;
        let z2 = ((i * 11 + 5) % 23) as f64 / 23.0 - 0.5;
        let z3 = ((i * 13 + 7) % 29) as f64 / 29.0 - 0.5;
        let a = x + 0.25 * z1;
        let m = 0.61 * a + 0.35 * z2;
        let b = 0.43 * a + 0.39 * m + 0.30 * z3;
        rows.push(vec![
            json!(1.0 + a + 0.18 * z1),
            json!(1.1 + 0.92 * a - 0.14 * z2),
            json!(0.9 + 1.07 * a + 0.11 * z3),
            json!(1.05 + 0.87 * a - 0.09 * z1 + 0.07 * z3),
            json!(2.0 + m + 0.15 * z2),
            json!(2.1 + 0.94 * m - 0.12 * z3),
            json!(1.9 + 1.04 * m + 0.09 * z1),
            json!(3.0 + b + 0.16 * z3),
            json!(3.1 + 0.96 * b - 0.13 * z1),
            json!(2.9 + 1.05 * b + 0.10 * z2),
        ]);
    }
    let spec = json!({
        "constructs": [
            {"id": "A", "name": "A", "type": "reflective", "indicators": ["a1", "a2", "a3", "a4"]},
            {"id": "M", "name": "M", "type": "reflective", "indicators": ["m1", "m2", "m3"]},
            {"id": "B", "name": "B", "type": "reflective", "indicators": ["b1", "b2", "b3"]}
        ],
        "paths": [
            {"from": "A", "to": "M"},
            {"from": "M", "to": "B"},
            {"from": "A", "to": "B"}
        ]
    });
    (columns, rows, spec)
}

fn has_more_than_4_decimals(v: f64) -> bool {
    let scaled = v * 10_000.0;
    (scaled - scaled.round()).abs() > 1e-6
}

#[test]
fn pipeline_fit_and_advanced_outputs_preserve_full_precision() {
    let (columns, rows, spec) = sample_model();

    let res = pipeline::run(columns.clone(), rows.clone(), spec.clone(), json!({}))
        .expect("pipeline should succeed");

    let path_am = res["structural"]["path_coefficients"]["M"]["A"]
        .as_f64()
        .expect("path A->M missing");
    assert!(
        has_more_than_4_decimals(path_am),
        "expected >4 decimal precision for path A->M, got {path_am}"
    );

    let r2_b = res["structural"]["r_squared"]["B"]
        .as_f64()
        .expect("r2 B missing");
    assert!(
        has_more_than_4_decimals(r2_b),
        "expected >4 decimal precision for r2 B, got {r2_b}"
    );

    let srmr = res["fit"]["saturated_model"]["srmr"]
        .as_f64()
        .expect("fit srmr missing");
    let d_uls = res["fit"]["saturated_model"]["d_uls"]
        .as_f64()
        .expect("fit d_uls missing");
    let d_g = res["fit"]["saturated_model"]["d_g"]
        .as_f64()
        .expect("fit d_g missing");
    let rms_theta = res["fit"]["rms_theta"]
        .as_f64()
        .expect("fit rms_theta missing");
    let gof = res["fit"]["gof"]["gof"].as_f64().expect("fit gof missing");
    assert!(has_more_than_4_decimals(srmr), "SRMR was truncated: {srmr}");
    assert!(has_more_than_4_decimals(d_uls), "d_ULS was truncated: {d_uls}");
    assert!(has_more_than_4_decimals(d_g), "d_G was truncated: {d_g}");
    assert!(
        has_more_than_4_decimals(rms_theta),
        "RMS_theta was truncated: {rms_theta}"
    );
    assert!(has_more_than_4_decimals(gof), "GoF was truncated: {gof}");

    let blind = blindfolding::run(
        columns.clone(),
        rows.clone(),
        spec.clone(),
        json!({}),
        blindfolding::Options {
            omission_distance: 7,
            compute_q2_effects: true,
        },
    )
    .expect("blindfolding should succeed");
    let b_blind = blind["constructs"]
        .as_array()
        .expect("blindfolding constructs array missing")
        .iter()
        .find(|item| item["construct_id"] == "B")
        .expect("blindfolding construct B missing");
    let q2_b = b_blind["q2"].as_f64().expect("blindfolding B q2 missing");
    let sse_b = b_blind["sse"].as_f64().expect("blindfolding B sse missing");
    assert!(
        has_more_than_4_decimals(q2_b),
        "blindfolding B q2 was truncated: {q2_b}"
    );
    assert!(
        has_more_than_4_decimals(sse_b),
        "blindfolding B sse was truncated: {sse_b}"
    );

    let pred = predict::run(
        columns.clone(),
        rows.clone(),
        spec.clone(),
        json!({}),
        predict::Options {
            k_folds: 4,
            repetitions: 2,
            seed: Some(42),
            antecedents: "direct".into(),
            ..predict::Options::default()
        },
    )
    .expect("predict should succeed");
    assert_eq!(pred["cvpat"]["overall"]["versus_linear_model"]["n"], rows.len());
    let early = predict::run(columns.clone(), rows.clone(), spec.clone(), json!({}), predict::Options {
        k_folds: 4, repetitions: 2, seed: Some(42), antecedents: "early".into(), ..predict::Options::default()
    }).expect("early antecedent prediction should succeed");
    assert_eq!(early["antecedents"], "early");
    let early_b = early["indicator_metrics"].as_array().unwrap().iter().find(|v| v["indicator"] == "b1").unwrap()["rmse_pls"].as_f64().unwrap();
    let direct_b = pred["indicator_metrics"].as_array().unwrap().iter().find(|v| v["indicator"] == "b1").unwrap()["rmse_pls"].as_f64().unwrap();
    assert!((early_b - direct_b).abs() > 1e-8);
    let compared = predict::compare(columns.clone(), rows.clone(), [spec.clone(), spec.clone()], json!({}), predict::Options {
        k_folds: 4, repetitions: 2, seed: Some(42), cvpat_resamples: 30, ..predict::Options::default()
    }).expect("identical models should be comparable");
    assert_eq!(compared["n_samples"], rows.len());
    assert_eq!(compared["comparison"]["mean_difference"], 0.0);
    assert!(compared["comparison"]["p_one_sided"].is_null());
    let mut incompatible = spec.clone();
    incompatible["paths"] = json!([{"from":"A","to":"B"}]);
    assert!(predict::compare(columns.clone(), rows.clone(), [spec.clone(), incompatible], json!({}), predict::Options::default()).unwrap_err().contains("same outcome"));
    let mut mediated = spec.clone();
    mediated["paths"] = json!([{"from":"A","to":"M"},{"from":"M","to":"B"}]);
    let all = analysis::ipma(columns.clone(), rows.clone(), mediated.clone(), "B".into(), Value::Null, "both".into(), json!({"ipma_predecessors":"all"})).unwrap();
    let direct = analysis::ipma(columns.clone(), rows.clone(), mediated, "B".into(), Value::Null, "both".into(), json!({"ipma_predecessors":"direct"})).unwrap();
    assert!(all["constructs"].as_array().unwrap().iter().any(|c| c["construct_id"] == "A"));
    assert!(!direct["constructs"].as_array().unwrap().iter().any(|c| c["construct_id"] == "A"));
    assert!(direct["constructs"].as_array().unwrap().iter().any(|c| c["construct_id"] == "M"));
    assert!(pred["cvpat"]["overall"]["versus_linear_model"]["mean_difference"].is_number());
    let rmse_pls = pred["indicator_metrics"][0]["rmse_pls"]
        .as_f64()
        .expect("rmse_pls missing");
    assert!(
        has_more_than_4_decimals(rmse_pls),
        "PLSpredict rmse_pls was truncated: {rmse_pls}"
    );

    let cancel = AtomicBool::new(false);
    let noop = |_pct: usize| {};
    let cta_res = cta::run(
        columns.clone(),
        rows.clone(),
        spec.clone(),
        cta::Options {
            construct_id: None,
            n_boot: 50,
            seed: Some(42),
            alpha: 0.05,
            ..cta::Options::default()
        },
        &cancel,
        &noop,
    )
    .expect("CTA should succeed");
    let cta_parallel = cta::run(columns.clone(), rows.clone(), spec.clone(), cta::Options { construct_id: None, n_boot: 50, seed: Some(42), alpha: 0.05, parallel: true, ..cta::Options::default() }, &cancel, &noop).unwrap();
    assert_eq!(cta_res["constructs"], cta_parallel["constructs"]);
    let cta_positive = cta::run(columns.clone(), rows.clone(), spec.clone(), cta::Options { construct_id: None, n_boot: 50, seed: Some(42), alpha: 0.05, tails: "one".into(), direction: "positive".into(), ..cta::Options::default() }, &cancel, &noop).unwrap();
    let cta_negative = cta::run(columns.clone(), rows.clone(), spec.clone(), cta::Options { construct_id: None, n_boot: 50, seed: Some(42), alpha: 0.05, tails: "one".into(), direction: "negative".into(), ..cta::Options::default() }, &cancel, &noop).unwrap();
    let plus = &cta_positive["constructs"][0]["tetrads"][0];
    let minus = &cta_negative["constructs"][0]["tetrads"][0];
    assert!((plus["p_value"].as_f64().unwrap() + minus["p_value"].as_f64().unwrap() - 1.0).abs() < 1e-12);
    assert!(plus["ci_upper_adjusted"].is_null() && minus["ci_lower_adjusted"].is_null());
    let tetrad_val = cta_res["constructs"][0]["tetrads"][0]["original_value"]
        .as_f64()
        .expect("CTA tetrad value missing");
    assert!(
        has_more_than_4_decimals(tetrad_val),
        "CTA tetrad value was truncated: {tetrad_val}"
    );

    let pow = power::evaluate(
        rows.len(),
        spec.clone(),
        res["structural"]["r_squared"].clone(),
        0.05,
    )
    .expect("power evaluate should succeed");
    let bench_power = pow["construct_evaluations"][0]["power_at_benchmark_r2_0_25"]
        .as_f64()
        .expect("power benchmark missing");
    assert!(
        has_more_than_4_decimals(bench_power),
        "power benchmark was truncated: {bench_power}"
    );

    let med = analysis::mediation(
        columns,
        rows,
        spec,
        "A".into(),
        "B".into(),
        json!({}),
        analysis::MediationOptions {
            n_boot: 50,
            seed: Some(42),
            alpha: 0.05,
            include_sobel: true,
        },
    )
    .expect("mediation should succeed");
    let vaf = med["vaf_percentage"]
        .as_f64()
        .expect("vaf_percentage missing");
    let total_coef = med["total_effect"]["coefficient"]
        .as_f64()
        .expect("mediation total_effect missing");
    assert!(
        has_more_than_4_decimals(vaf),
        "mediation vaf_percentage was truncated: {vaf}"
    );
    assert!(
        has_more_than_4_decimals(total_coef),
        "mediation total_effect coefficient was truncated: {total_coef}"
    );
}
