# StatSEM Python-to-Rust backend migration plan

Status: migration in progress; not complete. Core PLS/PLSc, resampling, advanced effects, HCM, NCA, MGA/MICOM/CTA, power, FIMIX/POS, OTG/ex-post and integrated copula analyses have native implementations with development comparisons. Model/result/snapshot persistence is partial. Legacy analyses, full data services/persistence, reports, transport and desktop cutover remain pending. CB-SEM is explicitly deferred by the user (2026-11-08) and excluded from current completion requirements. Production still uses Python. See migration/README.md and verification-summary-release.json for current tested scope and migration/REFERENCE_CORRECTIONS.md for authorized corrections.
Repository inspected: `/Users/rithvik/Documents/StatSEM`.
Reference Git HEAD at inspection: `dceb0db4992981391ed57d84a74b26525fb4d340`.
Existing uncommitted sidecar/packaging changes must be included in the baseline, not overwritten.

## 1. Objective and acceptance contract

Replace the complete Python runtime backend with Rust while preserving the application's statistical methods, settings, observable behavior, saved projects, and frontend contracts. Keep the Python source as a development reference until all parity gates pass. Shipping Rust wrapped around Python, invoking Python, or retaining a PyInstaller executable does not satisfy completion.

Use operation-by-operation traceability rather than expecting identical source lines across languages. Each Python function and meaningful branch must map to a Rust implementation, an explicit compatibility wrapper, or a reviewed reason it is unreachable. The user explicitly authorized correcting confirmed Python defects. Preserve original hashes/snapshots, document intentional changes, and add regression evidence; do not silently equate corrected behavior with historical parity.

Numerical identity is a verification target, not an advance guarantee. Require exact agreement for structural outputs and discrete decisions. For floating-point outputs, attempt bitwise equality on a pinned platform first and record any necessary absolute/relative tolerances by statistic. Do not broaden tolerances merely to make a port pass. Cross-platform bitwise equality may require matching low-level numerical libraries and evaluation order.

## 2. Source-grounded scope

The initial inspection found 112 FastAPI route declarations in `backend/main.py` (including aliases and WebSockets), and approximately 28,900 lines across the inspected backend modules and tests. These counts are inventory observations, not proof of coverage.

| Area | Existing sources | Rust migration scope |
|---|---|---|
| Transport | `backend/main.py`, `server_entry.py` | HTTP, multipart, validation, response envelopes, binary exports, WebSocket progress, errors |
| Schemas and validation | `model_spec.py`, `model_validator.py`, `core/settings_schema.py`, `core/issues.py` | Aliases, defaults, coercion, constraints, graph validation, warnings, issue targets |
| Shared foundations | `core/stats_utils.py`, `rng.py`, `json_utils.py`, `thresholds.py` | Weighted moments, correlation, PSD repair, distributions, roots, RNG, nonfinite values |
| Data | `data/importer.py`, `datasets.py`, `imputation.py`, `screening.py`, `derived.py`, `groups.py` | Parsing, missing values, EM/kNN, diagnostics, roles, lineage, grouping |
| PLS core | `engine/pls/algorithm.py`, `effects.py`, `fit.py`, `plsc.py` | Mode A/B, weighting, initialization, weighted estimation, validity, fit, effects, PLSc |
| Inference | `bootstrap.py`, `ci.py`, `contrast.py` | Replicates, parameter extraction, jackknife, sign correction, tests and intervals |
| Advanced PLS | `blindfolding.py`, `mediation.py`, `moderation.py`, `quadratic.py`, `ipma.py`, `hcm.py`, `redundancy.py` | Every implemented variant and its outputs |
| Groups and segmentation | `cta.py`, `micom.py`, `mga.py`, `fimix.py`, `pos.py`, `otg.py`, `ex_post.py` | Tetrads, permutations, group inference, segmentation, follow-up analyses |
| Other analyses | `copula.py`, `nca.py`, `predict.py`, `power.py` | Ranking transforms, NCA, prediction, power and sample size |
| CB-SEM (deferred; excluded) | `engine/cbsem/algorithm.py` | Preserve Python source; no current Rust implementation requirement |
| Persistence | `project_io.py`, `workspace_io.py`, `settings_io.py` | SQLite `.pls` projects, schema migration, workspace files, snapshots, archives, move/copy/import/export |
| Interoperability | `smartpls_importer.py` | SmartPLS file detection/import and workspace conversion |
| Reporting | `reporting/tables.py`, `templates.py`, `narrative.py`, `pdf_export.py` | Tables, narrative wording, formatting, PDF layout and exports |
| Licensing | `license_guard.py`, `src-tauri/src/license/` | Existing token validation, feature gates and error semantics |
| Desktop lifecycle | `src-tauri/src/backend_runner.rs`, `lib.rs`, `tauri.conf.json`, `frontend/src/utils/api.ts` | Startup, readiness, shutdown, transport and removal of Python packaging |

Existing documentation is supporting material, not authoritative behavior: `ARCHITECTURE_NOTES.md` describes older single-dataset assumptions and defaults. Current source already has dataset modules and settings such as `max_iter=3000`. Reconcile all such discrepancies before implementation.

## 3. Milestone A: immutable reference and complete inventory

1. Record the working-tree diff and untracked files, including current packaging changes. Record source hashes, not only Git HEAD.
2. Preserve the copied repository independently of the original. Use temporary fixture directories and an isolated application-data location for all tests. Never run workspace deletion or archive tests against live user workspaces.
3. Capture actual installed versions, Python architecture, NumPy/SciPy configuration, BLAS/LAPACK implementation and thread settings. Several dependencies in `requirements.txt`, including SciPy, are unpinned; resolve from the working environment before locking a reference environment. Do not upgrade packages as part of baseline setup.
4. Enumerate all modules, functions, dynamic imports, endpoints, aliases, frontend callers, filesystem side effects and exported artifacts. Check source routes against `openapi.json`; WebSockets need a separate manifest.
5. For each function record inputs, output structure, defaults, ordering, exception/fallback behavior, numeric operations, callers, Rust target, fixtures and status.
6. Run the existing Python suite in isolation and record pass/fail/skip results. Record baseline defects without treating a failing reference as correct by default.
7. Inspect every existing SmartPLS JSON reference for actual benchmark values and dataset availability. The parity test explicitly permits skips when essential values are absent; a skipped reference is not evidence of parity.

Deliverables: `migration/inventory`, baseline manifest, locked development environment and baseline test report. Gate: every backend capability is accounted for, and baseline failures/skips have an explanation.

## 4. Milestone B: parity harness before translation

Create a development-only Python oracle and a Rust fixture runner with a shared input/output protocol. Keep the oracle outside production runtime paths.

Each fixture includes dataset bytes or canonical values, column/row ordering, model specification, fully resolved settings, seeds/random draws, reference outputs, warnings, provenance and intermediate traces. Preserve enough float precision for round trips. Distinguish missing values from ordinary strings, and internal NaN/infinity from the API's JSON representation.

The comparator must report the first divergent JSON path or intermediate calculation, maximum absolute and relative error, counts of mismatches and unexpected/missing fields. IDs and timing metadata may be normalized only using an explicit allowlist; do not normalize away meaningful order, signs, failed replicates or convergence behavior.

| Output | Acceptance rule |
|---|---|
| Names, IDs within a fixture, array order, shapes, settings, dataset bindings | Exact |
| Validation messages/codes, warnings, feature-gate decisions, missing-value masks | Exact, except explicitly approved nondeterministic metadata |
| Iteration count, convergence flags, retained observations, effective rank, significance classifications | Exact; investigate threshold-boundary discrepancies |
| Floating-point estimates and intermediate arrays | Per-statistic absolute plus relative tolerance, calibrated from stable reference runs; preserve unrounded values |
| Random samples, permutations, splits and initial assignments | Exact when seed compatibility is required |
| PDF/ZIP/SQLite containers | Semantic content parity; byte identity only where an external contract requires it |

Test normal and pathological inputs: weighted/unweighted, reflective/formative, single indicators, no paths, invalid DAGs, missing columns, constant/all-missing columns, near singularity, duplicated indicators, extreme scales, small N and high dimension. Include option combinations, not just one example per module. Compare against SmartPLS/textbook references as a second layer; Python parity and external validity answer different questions.

Gate: the harness detects deliberate numerical, ordering, schema and missing-value differences.

## 5. Milestone C: architecture and numerical feasibility

Proposed separation:

```text
Rust HTTP/WebSocket adapter (same initial frontend contract)
  -> application services, licensing and job management
      -> statistical engine and typed model/settings schemas
      -> dataset and project/workspace services
      -> reporting/export services
          -> numerical compatibility layer
```

Keep the statistical engine independent of Tauri and HTTP. Preserve the existing loopback API initially because the frontend contains many HTTP calls, license headers and bootstrap WebSocket consumers. Replacing every call with Tauri commands simultaneously would expand the migration and obscure failures. The final Rust API can run inside the Tauri process, with blocking computation dispatched to workers. A standalone Rust executable is useful for parity testing; it must not require Python.

Before choosing dependencies, run three proof-of-parity experiments:

1. Linear algebra: compare NumPy least squares/SVD, pseudoinverse, eigen decomposition and matrix square roots on singular and near-singular fixtures. Match rank thresholds and backend algorithms rather than substituting normal equations for `lstsq`.
2. RNG: reproduce `SeedSequence.generate_state(n)`, the bit generator selected by the pinned `default_rng`, and the actual distribution/sampling routines used by each module. Equal integer seeds alone are insufficient.
3. Deferred CB-SEM work, only if later reauthorized: compare the SciPy optimizer objective trace, finite-difference convention, bounds, stopping criteria and final information matrix. This is not a current feasibility or release gate.

Evaluate Rust library candidates against these experiments, supported targets, distribution licenses and bundled native dependencies. Record versions in the eventual lockfile. Rust bindings to native numerical code are acceptable if they eliminate Python and package reliably. Avoid premature dependency commitments.

Gate: the highest-risk compatibility mechanisms have a demonstrated route to implementation.

## 6. Milestone D: schemas, data and numerical primitives

Port Pydantic behavior explicitly: renamed fields such as `from`/`to`, optional versus null values, enum aliases, unknown-field handling, defaults, numeric constraints and coercion. Preserve stable construct/indicator order using ordered structures; unordered Rust maps must not silently change matrix or parameter order.

Port shared moments, standardization, correlation, regression, rank/quantile helpers, distributions, root solvers, PSD projection, thresholds and JSON sanitization first. Preserve existing `ddof` differences: the PLS standardizer uses population variance while CB-SEM sample covariance uses `ddof=1`. Preserve fallback constants such as zero-variance handling and VIF caps.

Then port parsing and preprocessing: delimiters, decimal marks, quoting, BOM/encoding, empty cells, numeric conversion, column naming, missing codes, preview and commit consistency, EM/kNN details, weighting, grouping and derived-dataset lineage. Inventory actual accepted file formats from code paths; do not infer support from a UI extension list.

Gate: canonical matrices, missing masks and all primitive outputs match before running PLS comparisons.

## 7. Milestone E: deterministic PLS and measurement/structural results

Port in this order:

1. Model parsing and graph validation.
2. `estimate_pls`: initialization variants; path/factor/centroid inner weights; Mode A/B outer weights; normalization and weighted behavior.
3. Convergence and score-sign conventions. Compare every iteration's weights and scores on diagnostic fixtures, not only final rounded coefficients.
4. Structural OLS, intercept conventions, R²/adjusted R²/f², VIF, direct/indirect/total effects.
5. Outer loadings/weights, reliability, rho_A/rho_c, AVE, HTMT, cross-loadings and Fornell-Larcker, including null/N/A reasons.
6. Fit metrics and PLSc correction, then `run_pipeline` composition and result serialization.

First acceptance fixture: the existing Corporate Reputation case, followed by all supported settings and difficult synthetic cases. Textbook agreement at three decimals is useful but does not replace unrounded Python comparison.

Gate: core estimation, intermediate traces and full result payloads pass parity.

## 8. Milestone F: inference and reproducible parallel jobs

First replay Python-exported resampling indices in Rust to isolate estimator differences. Then validate the native compatible RNG so production seeded calls also reproduce the reference. Inventory every module's RNG use separately, including legacy/global RNG calls and unseeded paths.

Preserve bootstrap sample size, seed expansion, parameter-vector order, reference estimates, sign correction, rejected/failed replicate behavior, standard deviation convention, degrees of freedom, tails, percentile interpolation, bias correction and BCa jackknife acceleration.

The current bootstrap gathers futures with `as_completed`; verify whether completion order affects stored sample arrays or summaries. Do not assume the RNG helper's reproducibility comment proves worker-count independence. Assign logical replicate IDs, compare repeated baseline runs, and document any existing unstable order before deciding how to preserve the observable contract.

Port job status transitions, progress messages, polling, subscriptions, cancellation and persisted results. Validate cancellation during computation, completion/cancel races and cleanup. Initially run serially; add bounded parallelism only after serial parity passes. Avoid nested numerical-thread oversubscription.

Gate: replicate-level and summary parity; reproducibility across supported worker counts; matching cancellation and job lifecycle behavior.

## 9. Milestone G: advanced PLS analyses

Use dependency inventory to confirm exact order; planned waves are:

1. Blindfolding, prediction, mediation, contrasts, redundancy and IPMA.
2. Moderation (two-stage/product-indicator/orthogonalizing), quadratic effects and HCM variants.
3. CTA, MICOM, MGA and permutation/group inference.
4. FIMIX, POS, OTG and ex-post segmentation analysis, including initialization/restarts and selected solutions.
5. Gaussian copula, NCA and power/sample-size methods.
6. CB-SEM is deferred and excluded. Preserve its Python implementation for possible future work; do not allocate current migration work to its optimizer or fitting pipeline.

Gaussian copula needs dedicated fixtures: current settings include F3/F4 ECDF variants, raw/eq17 transforms, PLS/OLS stage two, unscaled/standardized coefficients and default rounding to 12 decimals before ranking. Port Python tie-breaking/rounding behavior explicitly, including negative halfway cases; small differences can split ranks and alter results.

For every wave, compare intermediate transformations, stochastic draws, final metrics, curve coordinates, classification labels and response structure. Distinct wrappers around the same core must also be covered.

Gate: every analysis module and option branch has passing fixtures, with no silent fallback to Python.

## 10. Milestone H: storage, licensing, interoperability and reporting

Develop storage compatibility alongside algorithm work, but cut over writes only after round-trip gates pass. Preserve `.pls` SQLite schema version 2.0, legacy migrations, metadata, dataset/column tables, model/result scoping, snapshots and workspace JSON. Test Python-write/Rust-read and Rust-write/Python-read on disposable copies. Preserve timestamps, ID remapping, collision handling, dataset bindings and archive/move/copy behavior. Match SQL quoting and null/type conversions. Use transactions and safe file replacement without changing observable format.

Port SmartPLS detection/import using the existing eight reference JSON files and actual source import fixtures. Verify imported diagrams, model IDs, scales, paths and dataset bindings, not only estimates.

Preserve current licensing and feature gates, including `X-License-Token`, invalid/expired-token behavior and feature-specific permissions. Reuse compatible existing Rust licensing code where appropriate; do not remove backend enforcement during transport consolidation.

Port report extractors, ordering, precision, narrative templates, fonts, tables and page layout. PDF byte equality is generally unsuitable because metadata and producer details can differ; validate extracted text/numbers, page count and rendered layout. Verify CSV/JSON/Excel exports and ZIP contents semantically, including safe extraction and portable paths.

Gate: bidirectional project compatibility, all existing storage tests, imported models and report/export comparisons pass.

## 11. Milestone I: desktop cutover and distribution

1. Compare Python and Rust backends using isolated ports and separate fixture state. Verify the frontend against Rust with the current API contract.
2. Integrate Rust service startup/readiness/shutdown into Tauri; computation must not block UI or async executor threads. Check port ownership rather than treating any TCP listener as the correct backend.
3. Remove Python sidecar startup and `externalBin` configuration only when all capabilities are present. Preserve the user's existing packaging changes until their replacement is verified.
4. Exercise import -> edit -> estimate -> bootstrap/advanced analysis -> save -> reopen -> export in the packaged app. Also test cancellation, restart, missing files and invalid licensing states.
5. Test each supported OS/architecture independently, including clean environments with no Python installed. Bundle required native libraries, fonts and resources, and verify signing/notarization where applicable.
6. Benchmark startup, peak memory and analysis time after parity. Re-run affected parity checks after each optimization.

Gate: production app runs all supported workflows without Python, development oracle, PyInstaller or an externally running backend.

## 12. Tracking, sequencing and stopping rules

Use statuses: inventoried -> reference captured -> implemented -> primitive/algorithm parity passed -> API/storage parity passed -> packaged acceptance passed. Every item must reference its source function, fixture and validation evidence.

Dependency sequence: A -> B -> C -> D -> E -> F -> G, with storage/reporting work in H following its prerequisites, then I. CB-SEM is excluded from this sequence under the user's current scope. Do not set a calendar estimate until inventory and feasibility results establish the work and numerical compatibility costs.

Stop the affected module's cutover when an unexplained discrepancy appears. Reduce it to a fixture, locate the first divergent operation, resolve or document the reference defect, and rerun dependent comparisons. Do not hide discrepancies through rounding, label changes, widened tolerances or skipped tests.

Final sign-off requires: complete inventory, passing approved parity rules, explicit baseline failure/skip accounting, backward-compatible projects, matching frontend contracts, reproducible seeded analyses, valid packaged workflows and zero production Python dependencies. Keep the original project untouched and the reference artifacts available for future regression checks.

## 13. Authorized efficiency and redundancy work

The user has explicitly requested efficiency improvements and redundancy removal during conversion. Consolidate shared model/data preparation, result serialization, validation and statistical helpers behind typed interfaces. Use borrowed arrays, reusable scratch buffers and bounded workers where compatible with existing behavior. Separate internal restructuring from intentional changes to outputs.

For each numerical optimization, record the original operation, replacement, benchmark workload, speed/memory measurements and affected parity tests. Do not change reduction order, RNG stream assignment, optimizer behavior, missing-value handling or convergence conditions without resolving the resulting numerical compatibility question first. Remove duplicate implementations only after confirming they have identical semantics: similarly named confidence-interval routines in `core/stats_utils.py` and `engine/pls/ci.py` have different clipping/fallback rules and cannot simply be merged.

Initial observed example: NumPy's contiguous and matrix-axis reductions have different summation orders. An early Rust port produced an order-one standardization discrepancy for a weighted constant column. Matching the reduction behavior resolved the discrepancy across the current foundation fixture corpus. Algebraic equivalence alone is therefore insufficient for approving optimizations.
