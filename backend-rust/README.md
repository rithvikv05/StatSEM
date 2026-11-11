# Native StatSEM core — migration in progress

The Rust crate has no Python runtime dependency. It currently exposes a
development JSON-lines protocol. The desktop still uses Python: transport,
persistence, reporting, remaining estimators and Tauri cutover are unfinished.
Passing this corpus does not establish complete backend parity.

## Implemented and compared

- Weighted/unweighted moments, correlations, pairwise missing-data correlations
  and standardization, preserving material NumPy reduction ordering.
- SVD least squares, inverse, pseudoinverse, symmetric/general eigensolvers and
  nearest-PSD repair using macOS Accelerate.
- PLS Mode A/B, all three weighting schemes, initialization variants, sum
  scores, weighted fits, convergence/sign alignment, structural effects,
  measurement results, reliability, validity, fit and PLSc.
- Ordinary pipeline preparation: column resolution, missing codes, mean/listwise
  handling and weights. The source pipeline's fallback to mean for
  pairwise/em/knn settings is retained; standalone EM/kNN helpers are separate.
- NumPy SeedSequence, PCG64, bounded draws, permutation and indirect sorting.
- Seeded parallel bootstrap, sign correction, normal/Student inference,
  percentile/BC/BCa intervals, jackknife, contrasts and cancellation.
- Mediation, IPMA, blindfolding and corrected PLSpredict.
- Quadratic/moderation expansion: two-stage, product-indicator, orthogonalizing,
  higher-order constituents, mixed quadratic models, simple slopes, conditional
  indirect effects and expanded-model bootstrapping.
- Repeated-indicator, disjoint two-stage and collect-type HCM, all four HCM
  types including PLSc, reliability and VIF diagnostics.
- NCA ceilings, bottlenecks, regression ceiling and seeded permutations.
- MGA, MICOM, confirmatory tetrads, regression power and sample-size analysis.
- NumPy-compatible normal/exponential/gamma/Dirichlet sampling; FIMIX EM and
  PLS-POS with missing-row assignment tracking and PLSc score support.
- OTG omnibus and pairwise tests; segment overlap, category merging,
  binary/pairwise logistic regression and explanatory group comparisons.
- Gaussian copula transforms, seeded normality diagnostics, two-stage fits,
  Wald tests, bootstrap parameters and inference attachment.
- Native SQLite model/result/snapshot storage and Python-compatible spec hashes.
- In-memory dataset derivations, categorical group summaries and size warnings.

Current suite counts and combined verification are recorded in
[`migration/README.md`](../migration/README.md) and the generated
`migration/verification-summary-release.json` after a complete successful run.
Structure, order, counts, flags and nulls are exact; numerical values use
absolute/relative tolerances of 2e-12. This is fixture coverage, not exhaustive
proof or a substitute for external statistical benchmarks.

## Reference corrections

The user authorized confirmed Python bug fixes. Original hashes and source
snapshots remain preserved; corrected hashes are separately registered. See
[migration corrections](../migration/REFERENCE_CORRECTIONS.md).

Original PLSpredict fixtures remain archived. The prediction-v2 suite checks
corrected coefficient orientation, missing codes and training-only score scale.
Internal expanded pandas DataFrames are represented as ordered columns/rows in
the development protocol, with their complete contents checked.

## Verification

From the repository root:

```sh
backend/venv/bin/python tools/rust_migration.py verify-all --release
backend/venv/bin/python tools/rust_migration.py baseline-tests
cargo test --offline --manifest-path backend-rust/Cargo.toml
cargo clippy --offline --manifest-path backend-rust/Cargo.toml -- -D warnings
```

The Python test launcher redirects settings to a temporary location and retains
original baseline XML separately. Fixtures are captured once. Verification
rejects unregistered source changes. Bootstrap fixtures freeze Python worker
ordering while checking Rust with multiple workers.

## Remaining release gates

Legacy standalone copula/Shapiro endpoints,
complete data import/screening/derivation/grouping, full schema validation,
SQLite/workspace/archive operations, SmartPLS import, reporting, licensing,
HTTP/WebSocket/jobs and Tauri packaging remain unfinished.

CB-SEM is explicitly deferred by the user and is outside the current migration
scope. Its Python implementation remains preserved.

Model/result/snapshot persistence is implemented; dataset persistence and legacy
database conversion remain gates. Unsupported legacy conversion rejects the file
before modification. Copula/bootstrap sign correction for names containing
delimiters still needs dedicated coverage beyond the default sign mode.

The current provider requires macOS 13.3+ modern Accelerate LAPACK, matching the
NumPy reference environment. Other platforms require verified providers. Protocol
seeds currently support unsigned 64-bit integers. No unverified fallback is used.

See [migration evidence](../migration/README.md) and the
[migration plan](../docs/RUST_BACKEND_MIGRATION_PLAN.md). The desktop must not
switch to this crate until the remaining gates pass.
