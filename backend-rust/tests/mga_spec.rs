//! Phase 9 & Phase 10 MGA Verification Suite (§11 & §12 of MGA_IMPLEMENTATION_SPEC.md).

use serde_json::{json, Value};
use statsem_engine::mga::adapter::{find_constant_or_missing_indicators, run_pls, PlsSettings};
use statsem_engine::mga::bootstrap_mga::{run_bootstrap_mga, MgaSettings};
use statsem_engine::mga::groups::{
    generate_data_groups, validate_groups, validate_pair_for_comparison, DataGroup, GroupTerm,
};
use statsem_engine::mga::math::SeededRng;
use statsem_engine::mga::micom::run_permutation_with_micom;
use statsem_engine::mga::permutation::{
    prepare_original_fits, run_permutation_loop, PermutationSettings,
};
use statsem_engine::mga::routes;
use statsem_engine::project_store::{Dataset, Store};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

fn rand_uniform(rng: &mut SeededRng) -> f64 {
    (rng.next_u64() as f64) / ((u64::MAX as f64) + 1.0)
}

fn rand_std_normal(rng: &mut SeededRng) -> f64 {
    let u1 = rand_uniform(rng).clamp(1e-12, 1.0 - 1e-12);
    let u2 = rand_uniform(rng);
    (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
}

fn three_construct_spec() -> Value {
    json!({
        "constructs": [
            { "id": "X", "name": "Exogenous X", "type": "reflective", "outer_mode": "A", "indicators": ["x1", "x2", "x3"] },
            { "id": "M", "name": "Mediator M", "type": "reflective", "outer_mode": "A", "indicators": ["m1", "m2", "m3"] },
            { "id": "Y", "name": "Outcome Y", "type": "reflective", "outer_mode": "A", "indicators": ["y1", "y2", "y3"] }
        ],
        "indicators": [
            { "id": "x1", "column": "x1" }, { "id": "x2", "column": "x2" }, { "id": "x3", "column": "x3" },
            { "id": "m1", "column": "m1" }, { "id": "m2", "column": "m2" }, { "id": "m3", "column": "m3" },
            { "id": "y1", "column": "y1" }, { "id": "y2", "column": "y2" }, { "id": "y3", "column": "y3" }
        ],
        "paths": [
            { "from": "X", "to": "M" },
            { "from": "X", "to": "Y" },
            { "from": "M", "to": "Y" }
        ]
    })
}

#[allow(clippy::too_many_arguments)]
fn generate_two_group_3c_dataset(
    seed: u64,
    n_a: usize,
    n_b: usize,
    xm_a: f64,
    xy_a: f64,
    my_a: f64,
    xm_b: f64,
    xy_b: f64,
    my_b: f64,
    x_sd_b: f64,
) -> (Vec<String>, Vec<Vec<Value>>) {
    let mut rng = SeededRng::from_seed(seed);
    let cols = vec![
        "GRP".into(),
        "x1".into(),
        "x2".into(),
        "x3".into(),
        "m1".into(),
        "m2".into(),
        "m3".into(),
        "y1".into(),
        "y2".into(),
        "y3".into(),
    ];
    let mut rows = Vec::with_capacity(n_a + n_b);

    let mut push_obs = |grp: &str, xm: f64, xy: f64, my: f64, x_scale: f64| {
        let lx = rand_std_normal(&mut rng);
        let lm = xm * lx + (1.0 - xm * xm).max(0.1).sqrt() * rand_std_normal(&mut rng);
        let ly = xy * lx + my * lm + 0.55 * rand_std_normal(&mut rng);
        let x1 = x_scale * (0.85 * lx + 0.28 * rand_std_normal(&mut rng));
        let x2 = x_scale * (0.82 * lx + 0.30 * rand_std_normal(&mut rng));
        let x3 = x_scale * (0.88 * lx + 0.25 * rand_std_normal(&mut rng));
        let m1 = 0.86 * lm + 0.26 * rand_std_normal(&mut rng);
        let m2 = 0.84 * lm + 0.28 * rand_std_normal(&mut rng);
        let m3 = 0.87 * lm + 0.24 * rand_std_normal(&mut rng);
        let y1 = 0.88 * ly + 0.24 * rand_std_normal(&mut rng);
        let y2 = 0.83 * ly + 0.29 * rand_std_normal(&mut rng);
        let y3 = 0.85 * ly + 0.27 * rand_std_normal(&mut rng);
        rows.push(vec![
            json!(grp),
            json!(x1),
            json!(x2),
            json!(x3),
            json!(m1),
            json!(m2),
            json!(m3),
            json!(y1),
            json!(y2),
            json!(y3),
        ]);
    };

    for _ in 0..n_a {
        push_obs("A", xm_a, xy_a, my_a, 1.0);
    }
    for _ in 0..n_b {
        push_obs("B", xm_b, xy_b, my_b, x_sd_b);
    }
    (cols, rows)
}

fn eq_group(id: &str, col: &str, val: Value) -> DataGroup {
    DataGroup {
        id: id.into(),
        name: format!("[{col}={val}]"),
        condition_link_type: "AND".into(),
        terms: vec![GroupTerm {
            column: col.into(),
            operator: "=".into(),
            value1: val,
            value2: None,
        }],
        record_count: 0,
        row_ids: None,
    }
}

#[test]
fn phase10_identical_groups_full_invariance_and_nominal_alpha_fpr() {
    let spec = three_construct_spec();
    let (cols, rows) =
        generate_two_group_3c_dataset(1102, 150, 150, 0.45, 0.20, 0.40, 0.45, 0.20, 0.40, 1.0);
    let grp_a = eq_group("gA", "GRP", json!("A"));
    let grp_b = eq_group("gB", "GRP", json!("B"));

    let perm_settings = PermutationSettings {
        group_a: grp_a.clone(),
        group_b: grp_b.clone(),
        permutations: 300,
        test_type: "two-tailed".into(),
        significance_level: 0.05,
        parallel_processing: true,
        seed: Some(777),
        pls_settings: PlsSettings::default(),
    };
    let perm_report = run_permutation_with_micom(
        &cols,
        &rows,
        &spec,
        &perm_settings,
        "m1",
        None,
        &AtomicBool::new(false),
        &|_, _| {},
    )
    .expect("permutation succeeds");

    assert!(perm_report.micom.step1.passed);
    assert!(
        perm_report.micom.step2.iter().all(|r| r.passed),
        "all constructs should pass Step 2 compositional invariance for identical DGP: {:?}",
        perm_report.micom.step2
    );
    assert!(
        perm_report.micom.all_invariant,
        "identical DGP should achieve full invariance: {:?}",
        perm_report.micom.summary
    );

    let mga_settings = MgaSettings {
        group_a: grp_a,
        group_b: grp_b,
        subsamples: 300,
        test_type: "two-tailed".into(),
        significance_level: 0.05,
        parallel_processing: true,
        seed: Some(777),
        pls_settings: PlsSettings::default(),
    };
    let mga_report = run_bootstrap_mga(
        &cols,
        &rows,
        &spec,
        &mga_settings,
        "m1",
        None,
        &AtomicBool::new(false),
        &|_, _, _| {},
    )
    .expect("bootstrap MGA succeeds");
    assert!(
        mga_report
            .path_coefficients
            .iter()
            .all(|r| r.parametric_p > 0.05 && r.welch_p > 0.05),
        "identical groups should show non-significant parametric/welch path diffs"
    );

    // Repeat across 15 random half-splits (15 * 3 = 45 path tests & 45 MICOM tests) to check FPR ~ 5% (< 15%).
    let mut false_positives = 0usize;
    let mut total_tests = 0usize;
    let mut micom_mean_rejects = 0usize;
    let mut micom_var_rejects = 0usize;
    let mut micom_step2_rejects = 0usize;
    let mut micom_construct_tests = 0usize;
    for split in 0..15u64 {
        let (split_cols, mut split_rows) =
            generate_two_group_3c_dataset(2000 + split, 140, 140, 0.45, 0.25, 0.40, 0.45, 0.25, 0.40, 1.0);
        // Shuffle GRP labels deterministically so both subgroups come from the exact same population
        for (idx, r) in split_rows.iter_mut().enumerate() {
            r[0] = json!(if (idx + split as usize) % 2 == 0 { "A" } else { "B" });
        }
        let s_perm = PermutationSettings {
            group_a: eq_group("gA", "GRP", json!("A")),
            group_b: eq_group("gB", "GRP", json!("B")),
            permutations: 150,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(500 + split),
            pls_settings: PlsSettings::default(),
        };
        let rpt = run_permutation_with_micom(
            &split_cols,
            &split_rows,
            &spec,
            &s_perm,
            "m_fpr",
            None,
            &AtomicBool::new(false),
            &|_, _| {},
        )
        .expect("split permutation runs");
        for p in &rpt.path_coefficients {
            total_tests += 1;
            if p.significant {
                false_positives += 1;
            }
        }
        for s in &rpt.micom.summary {
            micom_construct_tests += 1;
            if !s.compositional {
                micom_step2_rejects += 1;
            }
            if s.equal_mean == Some(false) {
                micom_mean_rejects += 1;
            }
            if s.equal_variance == Some(false) {
                micom_var_rejects += 1;
            }
        }
    }
    let fpr = false_positives as f64 / total_tests as f64;
    let mean_fpr = micom_mean_rejects as f64 / micom_construct_tests as f64;
    let var_fpr = micom_var_rejects as f64 / micom_construct_tests as f64;
    let step2_fpr = micom_step2_rejects as f64 / micom_construct_tests as f64;
    assert!(
        fpr <= 0.15,
        "path false-positive rate {fpr:.3} ({false_positives}/{total_tests}) too high for alpha=0.05"
    );
    assert!(
        step2_fpr <= 0.15 && mean_fpr <= 0.15 && var_fpr <= 0.15,
        "MICOM false-rejection rates too high: step2={step2_fpr:.3}, mean={mean_fpr:.3}, var={var_fpr:.3}"
    );
}

#[test]
fn phase10_planted_structural_difference_significant_across_all_four_tests() {
    let spec = three_construct_spec();
    // Plant strong difference in X -> M (0.60 vs 0.05), keep X -> Y and M -> Y equal
    let (cols, rows) =
        generate_two_group_3c_dataset(3302, 150, 150, 0.60, 0.25, 0.40, 0.05, 0.25, 0.40, 1.0);
    let grp_a = eq_group("gA", "GRP", json!("A"));
    let grp_b = eq_group("gB", "GRP", json!("B"));

    let perm = run_permutation_with_micom(
        &cols,
        &rows,
        &spec,
        &PermutationSettings {
            group_a: grp_a.clone(),
            group_b: grp_b.clone(),
            permutations: 300,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(42),
            pls_settings: PlsSettings::default(),
        },
        "m1",
        None,
        &AtomicBool::new(false),
        &|_, _| {},
    )
    .expect("permutation succeeds");

    let mga = run_bootstrap_mga(
        &cols,
        &rows,
        &spec,
        &MgaSettings {
            group_a: grp_a,
            group_b: grp_b,
            subsamples: 300,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(42),
            pls_settings: PlsSettings::default(),
        },
        "m1",
        None,
        &AtomicBool::new(false),
        &|_, _, _| {},
    )
    .expect("MGA succeeds");

    let xm_perm = perm.path_coefficients.iter().find(|r| r.key == "X->M").unwrap();
    assert!(xm_perm.significant && xm_perm.p_value < 0.05, "xm_perm: {:?}", xm_perm);
    for r in perm.path_coefficients.iter().filter(|r| r.key != "X->M") {
        assert!(!r.significant && r.p_value > 0.05, "unexpected sig on {}: {:?}", r.key, r);
    }

    let xm_mga = mga.path_coefficients.iter().find(|r| r.key == "X->M").unwrap();
    assert!(xm_mga.parametric_significant && xm_mga.parametric_p < 0.05);
    assert!(xm_mga.welch_significant && xm_mga.welch_p < 0.05);
    assert_eq!(xm_mga.henseler_result, "A > B");
    assert!(xm_mga.henseler_p_greater > 0.95);
    for r in mga.path_coefficients.iter().filter(|r| r.key != "X->M") {
        assert!(
            !r.parametric_significant && !r.welch_significant && r.henseler_result == "n.s.",
            "unexpected MGA sig on {}: {:?}",
            r.key,
            r
        );
    }
}

#[test]
fn phase10_reproducibility_same_seed_vs_different_seed() {
    let spec = three_construct_spec();
    let (cols, rows) =
        generate_two_group_3c_dataset(4401, 100, 100, 0.50, 0.25, 0.40, 0.25, 0.25, 0.40, 1.0);
    let make_settings = |seed| PermutationSettings {
        group_a: eq_group("gA", "GRP", json!("A")),
        group_b: eq_group("gB", "GRP", json!("B")),
        permutations: 100,
        test_type: "two-tailed".into(),
        significance_level: 0.05,
        parallel_processing: true,
        seed: Some(seed),
        pls_settings: PlsSettings::default(),
    };

    let r1 = run_permutation_with_micom(
        &cols,
        &rows,
        &spec,
        &make_settings(12345),
        "m1",
        None,
        &AtomicBool::new(false),
        &|_, _| {},
    )
    .unwrap();
    let r2 = run_permutation_with_micom(
        &cols,
        &rows,
        &spec,
        &make_settings(12345),
        "m1",
        None,
        &AtomicBool::new(false),
        &|_, _| {},
    )
    .unwrap();
    let r3 = run_permutation_with_micom(
        &cols,
        &rows,
        &spec,
        &make_settings(98765),
        "m1",
        None,
        &AtomicBool::new(false),
        &|_, _| {},
    )
    .unwrap();

    for (a, b) in r1.path_coefficients.iter().zip(r2.path_coefficients.iter()) {
        assert_eq!(a.p_value.to_bits(), b.p_value.to_bits());
        assert_eq!(a.permutation_mean_difference.to_bits(), b.permutation_mean_difference.to_bits());
    }
    for (a, b) in r1.micom.step2.iter().zip(r2.micom.step2.iter()) {
        assert_eq!(a.p_value.to_bits(), b.p_value.to_bits());
    }
    let differs = r1
        .path_coefficients
        .iter()
        .zip(r3.path_coefficients.iter())
        .any(|(a, b)| a.permutation_mean_difference.to_bits() != b.permutation_mean_difference.to_bits());
    assert!(differs, "different seed should produce distinct permutation distribution");
}

#[test]
fn phase10_matthews_2017_shape_sanity_benchmark_partial_invariance() {
    // N = 235 (n_A = 134, n_B = 101), 1 strong path diff, 2 equal paths,
    // and construct X has raw indicator SD scaled 2.2x in Group B -> Step 2 passes, Step 3 variance fails -> Partial invariance.
    let spec = three_construct_spec();
    let (cols, rows) =
        generate_two_group_3c_dataset(5501, 134, 101, 0.58, 0.25, 0.35, 0.12, 0.25, 0.35, 2.2);
    let grp_a = eq_group("gA", "GRP", json!("A"));
    let grp_b = eq_group("gB", "GRP", json!("B"));

    let perm = run_permutation_with_micom(
        &cols,
        &rows,
        &spec,
        &PermutationSettings {
            group_a: grp_a.clone(),
            group_b: grp_b.clone(),
            permutations: 250,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(2017),
            pls_settings: PlsSettings::default(),
        },
        "matthews",
        None,
        &AtomicBool::new(false),
        &|_, _| {},
    )
    .expect("benchmark permutation");

    assert_eq!(perm.n_a, 134);
    assert_eq!(perm.n_b, 101);
    assert!(perm.micom.step1.passed);
    assert!(perm.micom.step2.iter().all(|s| s.passed));
    let x_var = perm
        .micom
        .step3_variances
        .iter()
        .find(|r| r.construct_id == "X")
        .unwrap();
    assert!(!x_var.passed, "X raw composite variance differs between groups");
    let x_summary = perm
        .micom
        .summary
        .iter()
        .find(|r| r.construct_id == "X")
        .unwrap();
    assert_eq!(x_summary.verdict, "Partial measurement invariance");
    assert!(!perm.micom.all_invariant);
    assert!(!perm.micom.any_no_invariance);

    let mga = run_bootstrap_mga(
        &cols,
        &rows,
        &spec,
        &MgaSettings {
            group_a: grp_a,
            group_b: grp_b,
            subsamples: 250,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(2017),
            pls_settings: PlsSettings::default(),
        },
        "matthews",
        None,
        &AtomicBool::new(false),
        &|_, _, _| {},
    )
    .expect("benchmark MGA");

    let xm_perm = perm.path_coefficients.iter().find(|r| r.key == "X->M").unwrap();
    let xm_mga = mga.path_coefficients.iter().find(|r| r.key == "X->M").unwrap();
    assert!(xm_perm.significant && xm_mga.parametric_significant && xm_mga.welch_significant);
}

#[test]
fn phase9_edge_cases_validation_casewise_text_numeric_and_nonconvergence() {
    let spec = three_construct_spec();
    let (cols, mut rows) =
        generate_two_group_3c_dataset(6601, 20, 20, 0.5, 0.2, 0.3, 0.5, 0.2, 0.3, 1.0);
    let grp_a = eq_group("gA", "GRP", json!("A"));
    let grp_b = eq_group("gB", "GRP", json!("B"));

    // #1 Group A == Group B blocked
    let err1 = validate_pair_for_comparison(&cols, &rows, &spec, &grp_a, &grp_a, false)
        .expect_err("identical group id must fail");
    assert!(err1.contains("different"));

    // #2 Overlapping groups blocked
    let grp_overlap = DataGroup {
        id: "gAll".into(),
        name: "All".into(),
        condition_link_type: "OR".into(),
        terms: vec![
            GroupTerm { column: "GRP".into(), operator: "=".into(), value1: json!("A"), value2: None },
            GroupTerm { column: "GRP".into(), operator: "=".into(), value1: json!("B"), value2: None },
        ],
        record_count: 40,
        row_ids: None,
    };
    let err2 = validate_pair_for_comparison(&cols, &rows, &spec, &grp_a, &grp_overlap, false)
        .expect_err("overlapping groups must fail");
    assert_eq!(err2, "Groups must not share cases.");

    // #3 Group smaller than max(10, max indicators) blocked
    let small_rows: Vec<Vec<Value>> = rows.iter().take(28).cloned().collect(); // 20 A, 8 B
    let err3 = validate_pair_for_comparison(&cols, &small_rows, &spec, &grp_a, &grp_b, false)
        .expect_err("group with 8 < 10 rows must fail");
    assert!(err3.contains("minimum of 10"));

    // Also test 12-indicator construct requiring min 12 cases when n=11
    let mut big_ind_cols = vec!["GRP".to_string()];
    let mut inds_json = Vec::new();
    let mut c_inds = Vec::new();
    for i in 1..=12 {
        let name = format!("i{i}");
        big_ind_cols.push(name.clone());
        inds_json.push(json!({"id": name, "column": name}));
        c_inds.push(json!(format!("i{i}")));
    }
    big_ind_cols.push("y1".into());
    inds_json.push(json!({"id": "y1", "column": "y1"}));
    let big_ind_spec = json!({
        "constructs": [
            {"id": "Big", "type": "reflective", "outer_mode": "A", "indicators": c_inds},
            {"id": "Out", "type": "reflective", "outer_mode": "A", "indicators": ["y1"]}
        ],
        "indicators": inds_json,
        "paths": [{"from": "Big", "to": "Out"}]
    });
    let mut big_rows = Vec::new();
    for g in ["A", "B"] {
        for r in 0..11 {
            let mut row = vec![json!(g)];
            for c in 1..=13 {
                row.push(json!((r + c) as f64));
            }
            big_rows.push(row);
        }
    }
    let err3b = validate_pair_for_comparison(&big_ind_cols, &big_rows, &big_ind_spec, &grp_a, &grp_b, false)
        .expect_err("12-indicator model requires >=12 cases even though >=10");
    assert!(err3b.contains("minimum of 12"));

    // #6 Casewise missing deletion applied BEFORE group checks, shrinking nA
    let mut casewise_rows = rows.clone();
    // Inject missing values into first 12 rows of A -> leaves 8 usable rows in A (< 10) -> blocked!
    for r in casewise_rows.iter_mut().take(12) {
        r[1] = Value::Null;
    }
    let err6 = validate_pair_for_comparison(&cols, &casewise_rows, &spec, &grp_a, &grp_b, true)
        .expect_err("casewise deletion reducing group below min_required must fail");
    assert!(err6.contains("8 usable cases"));

    // Only 3 missing rows -> 17 usable rows in A, 20 in B
    let mut casewise_ok = rows.clone();
    for r in casewise_ok.iter_mut().take(3) {
        r[1] = Value::Null;
    }
    let (ok_a, ok_b) =
        validate_pair_for_comparison(&cols, &casewise_ok, &spec, &grp_a, &grp_b, true).unwrap();
    assert_eq!(ok_a.len(), 17);
    assert_eq!(ok_b.len(), 20);

    // #4 Constant indicator in subgroup A -> non-converged + detected
    for r in rows.iter_mut().take(20) {
        r[1] = json!(5.0);
    }
    let bad = find_constant_or_missing_indicators(&cols, &rows[..20], &spec).unwrap();
    assert!(bad.contains(&"x1".to_string()));
    let pls_const = run_pls(&cols, &rows[..20], &spec, &PlsSettings::default()).unwrap();
    assert!(!pls_const.converged);

    // #5 Original group non-convergence aborts cleanly without NaNs (both Permutation and MGA)
    let (_, clean_rows) =
        generate_two_group_3c_dataset(6602, 20, 20, 0.5, 0.2, 0.3, 0.5, 0.2, 0.3, 1.0);
    let (_, n_a, n_b, mut orig_a, orig_b, orig_p) = prepare_original_fits(
        &cols,
        &clean_rows,
        &spec,
        &PermutationSettings {
            group_a: grp_a.clone(),
            group_b: grp_b.clone(),
            permutations: 20,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: false,
            seed: Some(1),
            pls_settings: PlsSettings::default(),
        },
    )
    .unwrap();
    orig_a.converged = false;
    let err5 = run_permutation_loop(
        &cols,
        &spec,
        &PermutationSettings {
            group_a: grp_a,
            group_b: grp_b,
            permutations: 20,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: false,
            seed: Some(1),
            pls_settings: PlsSettings::default(),
        },
        clean_rows,
        n_a,
        n_b,
        orig_a,
        orig_b,
        orig_p,
        &AtomicBool::new(false),
        &|_, _| {},
    )
    .expect_err("non-converged original subgroup must abort");
    assert!(err5.contains("converge"));

    // #8 Categorical numeric (1, 2, 1.0) vs text ("Female", "Male") group generation
    let num_cols = vec!["GENDER_NUM".to_string(), "GENDER_TXT".to_string()];
    let mut num_rows = Vec::new();
    for i in 0..30 {
        num_rows.push(vec![
            json!(if i < 15 { 1 } else { 2 }),
            json!(if i < 15 { "Female" } else { "Male" }),
        ]);
    }
    let g_num =
        generate_data_groups(&num_cols, &num_rows, "GROUP", &["GENDER_NUM".into()], 10).unwrap();
    assert_eq!(g_num.groups.len(), 2);
    assert_eq!(g_num.groups[0].name, "GROUP_GENDER_NUM(1.0)");
    assert_eq!(g_num.groups[1].name, "GROUP_GENDER_NUM(2.0)");

    let g_txt =
        generate_data_groups(&num_cols, &num_rows, "GROUP", &["GENDER_TXT".into()], 10).unwrap();
    assert_eq!(g_txt.groups[0].name, "GROUP_GENDER_TXT(Female)");
    assert_eq!(g_txt.groups[1].name, "GROUP_GENDER_TXT(Male)");

    let (_arrows, min_n, warnings) = validate_groups(&g_num.groups, Some(&spec), 0.05, 0.25);
    assert_eq!(min_n, 52);
    assert!(warnings.iter().any(|w| w.kind == "min_sample_size"));
}

#[test]
fn phase9_minimal_single_path_single_indicator_moderation_hcm_and_persistence_cancel() {
    let mut rng = SeededRng::from_seed(7701);
    // 1. Minimal 1-endogenous, 1-path model with single indicator on outcome Y (#7 + #11)
    let min_spec = json!({
        "constructs": [
            { "id": "X", "name": "Predictor X", "type": "reflective", "outer_mode": "A", "indicators": ["x1", "x2"] },
            { "id": "Y", "name": "SingleY", "type": "reflective", "outer_mode": "A", "indicators": ["y1"] }
        ],
        "indicators": [
            { "id": "x1", "column": "x1" },
            { "id": "x2", "column": "x2" },
            { "id": "y1", "column": "y1" }
        ],
        "paths": [{ "from": "X", "to": "Y" }]
    });
    let cols = vec![
        "GRP".into(),
        "x1".into(),
        "x2".into(),
        "z1".into(),
        "z2".into(),
        "y1".into(),
    ];
    let mut rows = Vec::new();
    for g in ["A", "B"] {
        for _ in 0..40 {
            let lx = rand_std_normal(&mut rng);
            let lz = rand_std_normal(&mut rng);
            let beta = if g == "A" { 0.65 } else { 0.15 };
            let ly = beta * lx + 0.25 * lz + 0.20 * lx * lz + 0.5 * rand_std_normal(&mut rng);
            rows.push(vec![
                json!(g),
                json!(0.86 * lx + 0.25 * rand_std_normal(&mut rng)),
                json!(0.84 * lx + 0.27 * rand_std_normal(&mut rng)),
                json!(0.85 * lz + 0.25 * rand_std_normal(&mut rng)),
                json!(0.87 * lz + 0.24 * rand_std_normal(&mut rng)),
                json!(0.90 * ly + 0.20 * rand_std_normal(&mut rng)),
            ]);
        }
    }
    let grp_a = eq_group("gA", "GRP", json!("A"));
    let grp_b = eq_group("gB", "GRP", json!("B"));

    let perm_min = run_permutation_with_micom(
        &cols,
        &rows,
        &min_spec,
        &PermutationSettings {
            group_a: grp_a.clone(),
            group_b: grp_b.clone(),
            permutations: 60,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(99),
            pls_settings: PlsSettings::default(),
        },
        "min_model",
        None,
        &AtomicBool::new(false),
        &|_, _| {},
    )
    .expect("1-path minimal model permutation works");
    assert_eq!(perm_min.path_coefficients.len(), 1);
    let y_step2 = perm_min
        .micom
        .step2
        .iter()
        .find(|r| r.construct_id == "Y")
        .unwrap();
    assert!(y_step2.single_indicator);
    assert!((y_step2.original_correlation - 1.0).abs() < 1e-12);
    assert!(y_step2.passed);
    assert!(perm_min.micom.step3_means.iter().any(|r| r.construct_id == "Y"));
    assert!(perm_min.micom.step3_variances.iter().any(|r| r.construct_id == "Y"));

    let mga_min = run_bootstrap_mga(
        &cols,
        &rows,
        &min_spec,
        &MgaSettings {
            group_a: grp_a.clone(),
            group_b: grp_b.clone(),
            subsamples: 60,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(99),
            pls_settings: PlsSettings::default(),
        },
        "min_model",
        None,
        &AtomicBool::new(false),
        &|_, _, _| {},
    )
    .expect("1-path minimal model bootstrap MGA works");
    assert_eq!(mga_min.path_coefficients.len(), 1);

    // 2. Model with moderator (two-stage) works in PLS & MGA while MICOM evaluates declared constructs only (#12)
    let mod_spec = json!({
        "constructs": [
            { "id": "X", "name": "X", "type": "reflective", "outer_mode": "A", "indicators": ["x1", "x2"] },
            { "id": "Z", "name": "Z", "type": "reflective", "outer_mode": "A", "indicators": ["z1", "z2"] },
            { "id": "Y", "name": "Y", "type": "reflective", "outer_mode": "A", "indicators": ["y1"] }
        ],
        "indicators": [
            { "id": "x1", "column": "x1" },
            { "id": "x2", "column": "x2" },
            { "id": "z1", "column": "z1" },
            { "id": "z2", "column": "z2" },
            { "id": "y1", "column": "y1" }
        ],
        "paths": [
            { "from": "X", "to": "Y" },
            { "from": "Z", "to": "Y" }
        ],
        "moderating_effects": [
            { "id": "XZ", "moderator": "Z", "source": "X", "target": "Y", "method": "two_stage", "standardize": true }
        ]
    });
    let perm_mod = run_permutation_with_micom(
        &cols,
        &rows,
        &mod_spec,
        &PermutationSettings {
            group_a: grp_a.clone(),
            group_b: grp_b.clone(),
            permutations: 40,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(12),
            pls_settings: PlsSettings::default(),
        },
        "mod_model",
        None,
        &AtomicBool::new(false),
        &|_, _| {},
    )
    .expect("moderation model permutation + MICOM works");
    assert_eq!(perm_mod.path_coefficients.len(), 3, "includes interaction path");
    assert_eq!(perm_mod.micom.summary.len(), 3, "MICOM evaluates declared constructs X, Z, Y only");

    let mga_mod = run_bootstrap_mga(
        &cols,
        &rows,
        &mod_spec,
        &MgaSettings {
            group_a: grp_a.clone(),
            group_b: grp_b.clone(),
            subsamples: 40,
            test_type: "two-tailed".into(),
            significance_level: 0.05,
            parallel_processing: true,
            seed: Some(12),
            pls_settings: PlsSettings::default(),
        },
        "mod_model",
        None,
        &AtomicBool::new(false),
        &|_, _, _| {},
    )
    .expect("moderation model bootstrap MGA works");
    assert_eq!(mga_mod.path_coefficients.len(), 3);

    // 3. Unsupported higher-order construct without direct indicators -> "Not supported in MGA."
    let hcm_spec = json!({
        "constructs": [
            { "id": "X", "indicators": ["x1", "x2"] },
            { "id": "HOC", "order": "higher", "components": ["X"], "indicators": [] },
            { "id": "Y", "indicators": ["y1"] }
        ],
        "indicators": [
            { "id": "x1", "column": "x1" },
            { "id": "x2", "column": "x2" },
            { "id": "y1", "column": "y1" }
        ],
        "paths": [{ "from": "HOC", "to": "Y" }]
    });
    let err_hcm = run_pls(&cols, &rows[..40], &hcm_spec, &PlsSettings::default())
        .expect_err("empty higher-order construct must say Not supported in MGA.");
    assert_eq!(err_hcm, "Not supported in MGA.");

    // 4. End-to-end SQLite .pls persistence + async HTTP routes + cancel leaves no saved report (#9 & #10)
    let temp_pls = std::env::temp_dir().join(format!("statsem_mga_test_{}.pls", std::process::id()));
    let _ = std::fs::remove_file(&temp_pls);
    let path_str = temp_pls.to_string_lossy().to_string();
    let store = Store::new(&temp_pls);
    store.create("TestStudy").unwrap();
    store
        .save_dataset(Dataset {
            id: Some("ds1".into()),
            name: "MainData".into(),
            columns: cols.clone(),
            rows: rows.clone(),
            ..Default::default()
        })
        .unwrap();

    // Save groups via route and reload project to verify groups persistence
    routes::handle(
        "/mga/groups/save",
        &json!({
            "project_path": path_str,
            "dataset_id": "ds1",
            "dataGroups": [grp_a, grp_b],
        }),
        &HashMap::new(),
    )
    .unwrap();
    let reopened = Store::new(&temp_pls);
    let loaded_ds = reopened.dataset(Some("ds1")).unwrap();
    assert_eq!(loaded_ds["dataGroups"].as_array().unwrap().len(), 2);

    // Start job & cancel -> no partial report stored in .pls
    let start_cancel = routes::handle(
        "/mga/permutation/start",
        &json!({
            "project_path": path_str,
            "model_id": "m_cancel",
            "dataset_id": "ds1",
            "spec": min_spec,
            "columns": cols,
            "rows": rows,
            "groupA": grp_a,
            "groupB": grp_b,
            "permutations": 1000,
            "parallelProcessing": true,
            "seed": 5
        }),
        &HashMap::new(),
    )
    .unwrap();
    let cancel_job_id = start_cancel["jobId"].as_str().unwrap().to_string();
    let cancel_res = routes::handle(
        "/mga/permutation/cancel",
        &json!({ "job_id": cancel_job_id }),
        &HashMap::new(),
    )
    .unwrap();
    assert_eq!(cancel_res["status"], "cancelled");
    std::thread::sleep(Duration::from_millis(80));
    let reports_after_cancel = routes::handle(
        "/mga/reports/list",
        &json!({ "project_path": path_str, "model_id": "m_cancel" }),
        &HashMap::new(),
    )
    .unwrap();
    assert_eq!(reports_after_cancel["reports"].as_array().unwrap().len(), 0);

    // Run completed permutation job -> saved in .pls -> list / get / delete cleanly
    let start_ok = routes::handle(
        "/mga/permutation/start",
        &json!({
            "project_path": path_str,
            "model_id": "m_save",
            "dataset_id": "ds1",
            "spec": min_spec,
            "columns": cols,
            "rows": rows,
            "groupA": grp_a,
            "groupB": grp_b,
            "permutations": 25,
            "parallelProcessing": false,
            "seed": 77
        }),
        &HashMap::new(),
    )
    .unwrap();
    let ok_job_id = start_ok["jobId"].as_str().unwrap().to_string();
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut completed_report_id = String::new();
    while Instant::now() < deadline {
        let st = routes::handle(
            "/mga/permutation/status",
            &json!({ "job_id": ok_job_id }),
            &HashMap::new(),
        )
        .unwrap();
        if st["status"] == "completed" {
            completed_report_id = st["result"]["id"].as_str().unwrap().to_string();
            break;
        }
        assert_ne!(st["status"], "failed", "unexpected fail: {:?}", st["error"]);
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(!completed_report_id.is_empty());

    let listed = routes::handle(
        "/mga/reports/list",
        &json!({ "project_path": path_str }),
        &HashMap::new(),
    )
    .unwrap();
    assert_eq!(listed["reports"].as_array().unwrap().len(), 1);
    let fetched = routes::handle(
        "/mga/reports/get",
        &json!({ "project_path": path_str, "report_id": completed_report_id }),
        &HashMap::new(),
    )
    .unwrap();
    assert_eq!(fetched["report"]["reportType"], "permutation");
    routes::handle(
        "/mga/reports/delete",
        &json!({ "project_path": path_str, "report_id": completed_report_id }),
        &HashMap::new(),
    )
    .unwrap();
    let listed_empty = routes::handle(
        "/mga/reports/list",
        &json!({ "project_path": path_str }),
        &HashMap::new(),
    )
    .unwrap();
    assert_eq!(listed_empty["reports"].as_array().unwrap().len(), 0);

    let _ = std::fs::remove_file(&temp_pls);
}
