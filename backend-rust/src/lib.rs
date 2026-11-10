//! Native numerical core. The Python oracle is development tooling only.
pub mod analysis;
pub mod blindfolding;
pub mod bootstrap;
pub mod contrast;
pub mod copula;
pub mod cta;
pub mod data_groups;
pub mod derived;
pub mod effects;
pub mod ex_post;
pub mod fimix;
pub mod fit;
pub mod grouping;
pub mod hcm;
pub mod imputation;
pub mod inference;
pub mod linalg;
pub mod matrix;
pub mod mga;
pub mod micom;
pub mod model;
pub mod moderation;
pub mod nca;
pub mod nonlinear;
pub mod otg;
pub mod pipeline;
pub mod pls;
pub mod pos;
pub mod power;
pub mod predict;
pub mod project_store;
pub mod python_json;
pub mod quadratic;
pub mod rng;
pub mod server;
pub mod sort;
pub mod sqlite;
pub mod stats;
mod ziggurat;

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    CategoricalGroups {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        column: String,
        minimum: usize,
        predictors: usize,
    },
    Derive {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        operation: String,
        params: Value,
    },
    CopulaAttach {
        result: Value,
        bootstrap: Value,
    },
    CopulaWald {
        coefficients: Value,
        samples: Value,
        targets: Value,
    },
    CopulaPrimitives {
        values: Vec<f64>,
        #[serde(default)]
        columns: Vec<Vec<f64>>,
        endogenous: usize,
        raw: bool,
        f4: bool,
        decimals: Option<i32>,
        simulations: usize,
        seed: u64,
    },
    MergeCategories {
        values: Vec<Value>,
        mapping: Vec<(Value, Value)>,
        minimum: usize,
    },
    SegmentOverlap {
        segments: Vec<i64>,
        categories: Vec<Value>,
    },
    SegmentLogistic {
        segments: Vec<i64>,
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
    },
    SegmentCompare {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        #[serde(default)]
        settings: Value,
        explanatory_col: String,
        pos: Value,
    },
    OtgThresholds {
        comparisons: usize,
        alpha: f64,
    },
    OtgFr {
        draws: Vec<Vec<f64>>,
    },
    Otg {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        #[serde(default)]
        settings: Value,
        #[serde(default)]
        options: otg::Options,
    },
    Pos {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        #[serde(default)]
        settings: Value,
        #[serde(default)]
        options: pos::Options,
    },
    FimixEm {
        equations: Vec<fimix::Equation>,
        options: fimix::EmOptions,
    },
    Fimix {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        #[serde(default)]
        settings: Value,
        #[serde(default)]
        options: fimix::Options,
    },
    RngDistributions {
        entropy: Vec<u32>,
        kind: String,
        count: usize,
        shape: Option<f64>,
        dimensions: Option<usize>,
    },
    NoncentralF {
        x: f64,
        dfn: f64,
        dfd: f64,
        lambda: f64,
    },
    Power {
        options: power::Options,
    },
    MinimumSample {
        options: power::Options,
    },
    PowerTable {
        alpha: f64,
        target: f64,
    },
    TenTimes {
        formative: usize,
        paths: usize,
    },
    ModelPower {
        samples: usize,
        spec: Value,
        r2: Value,
        alpha: f64,
    },
    TetradDiagnostics {
        rows: Vec<Vec<f64>>,
        names: Vec<String>,
    },
    Cta {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        #[serde(default)]
        options: cta::Options,
    },
    Configural {
        a: Value,
        b: Value,
        attestation: bool,
    },
    Micom {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        #[serde(default)]
        settings: Value,
        #[serde(default)]
        options: micom::Options,
    },
    MgaTests {
        beta: [f64; 2],
        se: [f64; 2],
        n: [usize; 2],
        x: Vec<f64>,
        y: Vec<f64>,
    },
    Mga {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        #[serde(default)]
        settings: Value,
        #[serde(default)]
        options: mga::Options,
    },
    ProjectScenario {
        timestamp: String,
        actions: Vec<Value>,
    },
    SpecHash {
        spec: Value,
    },
    Hcm {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        #[serde(default)]
        settings: Value,
        options: hcm::Options,
    },
    NcaDiagnostics {
        x: Vec<f64>,
        y: Vec<f64>,
    },
    Nca {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        predictor: String,
        outcome: String,
        #[serde(default)]
        settings: Value,
        #[serde(default)]
        options: nca::Options,
    },
    Contrast {
        options: contrast::Options,
    },
    QuadraticDiagnostics {
        options: nonlinear::QuadraticOptions,
    },
    SimpleSlopes {
        options: nonlinear::SlopesOptions,
    },
    NonlinearEffectSize {
        included: f64,
        excluded: f64,
        moderation: bool,
    },
    Predict {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        #[serde(default)]
        settings: Value,
        #[serde(default)]
        options: predict::Options,
    },
    Permutation {
        entropy: Vec<u32>,
        n: usize,
    },
    Blindfolding {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        #[serde(default)]
        settings: Value,
        #[serde(default)]
        options: blindfolding::Options,
    },
    Mediation {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        source: String,
        target: String,
        #[serde(default)]
        settings: Value,
        #[serde(default)]
        options: analysis::MediationOptions,
    },
    Ipma {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        target: String,
        scale_bounds: Value,
        level: String,
        #[serde(default)]
        settings: Value,
    },
    Argsort {
        x: Vec<Option<f64>>,
    },
    ImputeNumeric {
        x: Vec<Vec<Option<f64>>>,
        method: String,
        max_iter: usize,
        tol: f64,
        k: usize,
    },
    Bootstrap {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        #[serde(default)]
        options: bootstrap::Options,
    },
    RngDiagnostics {
        entropy: Vec<u32>,
        words: usize,
        bound: u64,
        count: usize,
    },
    ConfidenceIntervals {
        original: f64,
        samples: Vec<f64>,
        jackknife: Option<Vec<f64>>,
        alpha: f64,
        tails: String,
    },
    Distributions {
        x: f64,
        p: f64,
        df: f64,
    },
    RunPipeline {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
        spec: Value,
        #[serde(default)]
        settings: Value,
    },
    MatrixDiagnostics {
        x: Vec<Vec<f64>>,
    },
    EstimatePls {
        blocks: Vec<pls::Block>,
        paths: Vec<[String; 2]>,
        #[serde(default)]
        settings: pls::Settings,
        obs_weights: Option<Vec<f64>>,
    },
    LeastSquares {
        x: Vec<Vec<f64>>,
        y: Vec<f64>,
        weights: Option<Vec<f64>>,
    },
    Moments {
        x: Vec<f64>,
        weights: Option<Vec<f64>>,
        #[serde(default)]
        ddof: usize,
    },
    Correlation {
        x: Vec<f64>,
        y: Vec<f64>,
        weights: Option<Vec<f64>>,
    },
    Standardize {
        x: Vec<Vec<f64>>,
        weights: Option<Vec<f64>>,
    },
    PairwiseCorrelation {
        x: Vec<Vec<Option<f64>>>,
    },
    ProbGreater {
        x: Vec<f64>,
        y: Vec<f64>,
    },
    ChunkTasks {
        n_tasks: usize,
        n_workers: usize,
        #[serde(default = "min_chunk")]
        min_chunk_size: usize,
        #[serde(default = "max_chunk")]
        max_chunk_size: usize,
    },
}
fn min_chunk() -> usize {
    5
}
fn max_chunk() -> usize {
    50
}

pub fn evaluate(request: Request) -> Result<Value, String> {
    match request {
        Request::CategoricalGroups {
            columns,
            rows,
            column,
            minimum,
            predictors,
        } => data_groups::categorical(columns, rows, column, minimum, predictors),
        Request::Derive {
            columns,
            rows,
            operation,
            params,
        } => derived::apply(columns, rows, &operation, params),
        Request::CopulaAttach { result, bootstrap } => copula::attach(result, bootstrap),
        Request::CopulaWald {
            coefficients,
            samples,
            targets,
        } => copula::wald(&coefficients, &samples, &targets),
        Request::CopulaPrimitives {
            values,
            columns,
            endogenous,
            raw,
            f4,
            decimals,
            simulations,
            seed,
        } => Ok(
            json!({"ecdf":copula::ecdf(&values,f4,decimals),"term":copula::term(&values,f4,decimals),"matrix":copula::transformed(&columns,endogenous,raw,f4,decimals)?,"cvm":copula::cvm(&values,simulations,seed),"ad":copula::anderson(&values)}),
        ),
        Request::MergeCategories {
            values,
            mapping,
            minimum,
        } => Ok(ex_post::merge(values, mapping, minimum)),
        Request::SegmentOverlap {
            segments,
            categories,
        } => ex_post::overlap(segments, categories),
        Request::SegmentLogistic {
            segments,
            columns,
            rows,
        } => ex_post::logistic(segments, columns, rows),
        Request::SegmentCompare {
            columns,
            rows,
            spec,
            settings,
            explanatory_col,
            pos,
        } => ex_post::compare(columns, rows, spec, settings, explanatory_col, pos),
        Request::OtgThresholds { comparisons, alpha } => Ok(otg::thresholds(comparisons, alpha)),
        Request::OtgFr { draws } => Ok(json!(otg::fr(&draws)?)),
        Request::Otg {
            columns,
            rows,
            spec,
            settings,
            options,
        } => otg::run(
            columns,
            rows,
            spec,
            settings,
            options,
            &std::sync::atomic::AtomicBool::new(false),
        ),
        Request::Pos {
            columns,
            rows,
            spec,
            settings,
            options,
        } => pos::run(
            columns,
            rows,
            spec,
            settings,
            options,
            &std::sync::atomic::AtomicBool::new(false),
            &|_| {},
        ),
        Request::FimixEm { equations, options } => fimix::em(
            equations,
            options,
            &std::sync::atomic::AtomicBool::new(false),
        ),
        Request::Fimix {
            columns,
            rows,
            spec,
            settings,
            options,
        } => fimix::run(
            columns,
            rows,
            spec,
            settings,
            options,
            &std::sync::atomic::AtomicBool::new(false),
            &|_| {},
        ),
        Request::RngDistributions {
            entropy,
            kind,
            count,
            shape,
            dimensions,
        } => {
            let mut random = rng::Pcg64::new(&entropy);
            let mut values = Vec::new();
            for _ in 0..count {
                values.push(match kind.as_str() {
                    "normal" => json!(random.normal()),
                    "exponential" => json!(random.exponential()),
                    "gamma" => json!(random.gamma(shape.unwrap_or(1.0))?),
                    "dirichlet" => json!(random.dirichlet_ones(dimensions.unwrap_or(3))?),
                    "mixed" => json!([
                        json!(random.bounded(7)?),
                        json!(random.normal()),
                        json!(random.exponential()),
                        json!(random.gamma(0.3)?),
                        json!(random.dirichlet_ones(4)?),
                        json!(random.bounded(19)?)
                    ]),
                    _ => return Err("Unknown random distribution".into()),
                });
            }
            Ok(json!({"values":values,"next_raw":random.next_u64()}))
        }
        Request::NoncentralF {
            x,
            dfn,
            dfd,
            lambda,
        } => Ok(json!(inference::noncentral_f_cdf(x, dfn, dfd, lambda)?)),
        Request::Power { options } => Ok(json!(power::compute(&options)?)),
        Request::MinimumSample { options } => Ok(json!(power::minimum(&options)?)),
        Request::PowerTable { alpha, target } => power::table(alpha, target),
        Request::TenTimes { formative, paths } => Ok(power::ten_times(formative, paths)),
        Request::ModelPower {
            samples,
            spec,
            r2,
            alpha,
        } => power::evaluate(samples, spec, r2, alpha),
        Request::TetradDiagnostics { rows, names } => cta::diagnostics(rows, names),
        Request::Cta {
            columns,
            rows,
            spec,
            options,
        } => cta::run(
            columns,
            rows,
            spec,
            options,
            &std::sync::atomic::AtomicBool::new(false),
            &|_| {},
        ),
        Request::Configural { a, b, attestation } => micom::configural(&a, &b, attestation),
        Request::Micom {
            columns,
            rows,
            spec,
            settings,
            options,
        } => micom::run(
            columns,
            rows,
            spec,
            settings,
            options,
            &std::sync::atomic::AtomicBool::new(false),
            &|_| {},
        ),
        Request::MgaTests { beta, se, n, x, y } => {
            let mut tests = mga::tests(beta, se, n)?;
            tests["henseler"] = mga::henseler(&x, &y);
            Ok(tests)
        }
        Request::Mga {
            columns,
            rows,
            spec,
            settings,
            options,
        } => mga::run(
            columns,
            rows,
            spec,
            settings,
            options,
            &std::sync::atomic::AtomicBool::new(false),
            &|_| {},
        ),
        Request::ProjectScenario { timestamp, actions } => {
            project_store::scenario(timestamp, actions)
        }
        Request::SpecHash { spec } => {
            Ok(json!({"serialized":python_json::dumps(&spec),"hash":python_json::spec_hash(&spec)}))
        }
        Request::Hcm {
            columns,
            rows,
            spec,
            settings,
            options,
        } => hcm::run(columns, rows, spec, settings, options),
        Request::NcaDiagnostics { x, y } => nca::diagnostics(x, y),
        Request::Nca {
            columns,
            rows,
            spec,
            predictor,
            outcome,
            settings,
            options,
        } => nca::analyze(
            columns,
            rows,
            spec,
            [predictor, outcome],
            settings,
            options,
            &std::sync::atomic::AtomicBool::new(false),
        ),
        Request::Contrast { options } => contrast::compute(options),
        Request::QuadraticDiagnostics { options } => Ok(nonlinear::quadratic(options)),
        Request::SimpleSlopes { options } => nonlinear::slopes(options),
        Request::NonlinearEffectSize {
            included,
            excluded,
            moderation,
        } => Ok(nonlinear::effect_size(included, excluded, moderation)),
        Request::Predict {
            columns,
            rows,
            spec,
            settings,
            options,
        } => predict::run(columns, rows, spec, settings, options),
        Request::Permutation { entropy, n } => Ok(json!(rng::Pcg64::new(&entropy).permutation(n))),
        Request::Blindfolding {
            columns,
            rows,
            spec,
            settings,
            options,
        } => blindfolding::run(columns, rows, spec, settings, options),
        Request::Mediation {
            columns,
            rows,
            spec,
            source,
            target,
            settings,
            options,
        } => analysis::mediation(columns, rows, spec, source, target, settings, options),
        Request::Ipma {
            columns,
            rows,
            spec,
            target,
            scale_bounds,
            level,
            settings,
        } => analysis::ipma(columns, rows, spec, target, scale_bounds, level, settings),
        Request::Argsort { x } => Ok(json!(sort::argsort(
            &x.iter().map(|v| v.unwrap_or(f64::NAN)).collect::<Vec<_>>()
        ))),
        Request::ImputeNumeric {
            x,
            method,
            max_iter,
            tol,
            k,
        } => imputation::run(x, &method, max_iter, tol, k),
        Request::Bootstrap {
            columns,
            rows,
            spec,
            options,
        } => bootstrap::run(columns, rows, spec, options),
        Request::RngDiagnostics {
            entropy,
            words,
            bound,
            count,
        } => {
            let mut raw = rng::Pcg64::new(&entropy);
            let mut uniform = rng::Pcg64::new(&entropy);
            let mut bounded = rng::Pcg64::new(&entropy);
            Ok(
                json!({"seeds":rng::seed_sequence(&entropy,words),"raw":(0..count).map(|_| raw.next_u64()).collect::<Vec<_>>(),
                "uniform":(0..count).map(|_| uniform.uniform()).collect::<Vec<_>>(),"indices":(0..count).map(|_| bounded.bounded(bound)).collect::<Result<Vec<_>,_>>()?}),
            )
        }
        Request::ConfidenceIntervals {
            original,
            samples,
            jackknife,
            alpha,
            tails,
        } => inference::intervals(original, &samples, jackknife.as_deref(), alpha, &tails),
        Request::Distributions { x, p, df } => Ok(
            json!({"normal_cdf":inference::normal_cdf(x),"normal_ppf":inference::normal_ppf(p),"student_t_cdf":inference::student_t_cdf(x,df)}),
        ),
        Request::RunPipeline {
            columns,
            rows,
            spec,
            settings,
        } => pipeline::run(columns, rows, spec, settings),
        Request::MatrixDiagnostics { x } => Ok(
            json!({"pinv":linalg::pseudoinverse(&x,1e-15)?,"eigen_real":linalg::eigenvalues_real(&x)?,"nearest_psd":matrix::nearest_psd(&x,1e-6)?}),
        ),
        Request::EstimatePls {
            blocks,
            paths,
            settings,
            obs_weights,
        } => pls::estimate(blocks, paths, settings, obs_weights),
        Request::LeastSquares { x, y, weights } => {
            if x.len() != y.len()
                || x.first().is_none_or(Vec::is_empty)
                || x.iter().any(|r| r.len() != x[0].len())
            {
                return Err("Invalid least-squares matrix".into());
            }
            let columns: Vec<Vec<f64>> = (0..x[0].len())
                .map(|j| x.iter().map(|r| r[j]).collect())
                .collect();
            let result = linalg::least_squares(&columns, &y, weights.as_deref())?;
            Ok(
                json!({"coefficients": result.coefficients, "rank": result.rank, "singular_values": result.singular_values}),
            )
        }
        Request::Moments { x, weights, ddof } => {
            stats::check_weights(x.len(), weights.as_deref())?;
            Ok(
                json!({"mean": stats::mean(&x, weights.as_deref()), "std": stats::std(&x, weights.as_deref(), ddof)}),
            )
        }
        Request::Correlation { x, y, weights } => {
            if x.len() != y.len() {
                return Err("Vector lengths differ".into());
            }
            stats::check_weights(x.len(), weights.as_deref())?;
            Ok(json!(stats::correlation(&x, &y, weights.as_deref())))
        }
        Request::Standardize { x, weights } => {
            Ok(json!(stats::standardize(&x, weights.as_deref())?))
        }
        Request::PairwiseCorrelation { x } => {
            let (r, n) = stats::pairwise_correlation(&x)?;
            Ok(json!({"correlations": r, "counts": n}))
        }
        Request::ProbGreater { x, mut y } => {
            // Python uses sorted search, counting ties in P(X <= Y).
            y.sort_by(f64::total_cmp);
            let count: usize = x
                .iter()
                .map(|v| y.len() - y.partition_point(|w| w < v))
                .sum();
            Ok(json!(count as f64 / (x.len() * y.len()) as f64))
        }
        Request::ChunkTasks {
            n_tasks,
            n_workers,
            min_chunk_size,
            max_chunk_size,
        } => {
            if min_chunk_size == 0 || max_chunk_size < min_chunk_size {
                return Err("Invalid chunk bounds".into());
            }
            let target = n_workers.saturating_mul(4).max(1);
            let chunk = n_tasks
                .div_ceil(target)
                .clamp(min_chunk_size, max_chunk_size);
            Ok(json!((0..n_tasks)
                .step_by(chunk)
                .map(|start| [start, start.saturating_add(chunk).min(n_tasks)])
                .collect::<Vec<_>>()))
        }
    }
}
