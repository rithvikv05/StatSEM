# Architecture Notes & Existing Code Map

## 1. Overview & Current Architecture
The backend is a FastAPI application supporting desktop PLS-SEM and CB-SEM estimation.
- **Root Entrypoint**: `backend/main.py`
- **Project File I/O**: `backend/project_io.py` using SQLite database (`.pls` file extension)
- **Model Spec Definition**: `backend/model_spec.py` (Pydantic models)
- **Model Validation**: `backend/model_validator.py` (DAG cycle detection, entity integrity)
- **PLS Engine**:
  - `backend/engine/pls/algorithm.py`: Wold's Lohmöller algorithm, Mode A/B, OLS path regression, $R^2$, $f^2$, VIF, Cronbach's alpha, CR, AVE, $\rho_A$, Fornell-Larcker, HTMT, construct scores.
  - `backend/engine/pls/bootstrap.py`: Multi-core parallel bootstrapping (`ProcessPoolExecutor`) for path coefficients, outer loadings, and outer weights.
- **CB-SEM Engine**: `backend/engine/cbsem/algorithm.py` (RAM notation, ML estimation, fit indices).

---

## 2. Endpoints in `main.py`
1. `GET /health` & `GET /`: Health and status.
2. `POST /data/import`: File upload (`.csv`, `.xls`, `.xlsx`), missing value marker replacement, preview table (first 20 rows).
3. `GET /project/diagnostics`: Column descriptives (`mean`, `std`, `min`, `max`, `skewness`, `kurtosis`, `non_normal_flag`) and missing counts/percentages.
4. `POST /project/treat-missing`: In-place missing treatment (`listwise` or `mean`) overwriting project data.
5. `POST /project/open`: Project open & register in recent projects.
6. `POST /project/save-data`: Upload and save data into project SQLite `raw_data`.
7. `POST /project/save-data-json`: Save tabular JSON data into `raw_data`.
8. `POST /project/delete-data`: Drop `raw_data` table and clear metadata.
9. `GET /project/load-data`: Read `raw_data` table and column names.
10. `GET /project/metadata`: Read project key-value metadata.
11. `GET /project/recent`: List recently opened `.pls` projects.
12. `POST /workspace/create`: Create new workspace folder with `.pls-workspace.json`.
13. `POST /workspace/open`: Open existing workspace.
14. `GET /workspace/recent`: List recent workspaces.
15. `POST /workspace/add-project`: Create and add `.pls` project to workspace.
16. `POST /workspace/remove-project`: Detach project from workspace JSON.
17. `POST /workspace/delete-project`: Remove project and delete `.pls` file.
18. `POST /workspace/delete`: Delete entire workspace folder.
19. `POST /model/validate`: Validate `ModelSpec` against dataset columns.
20. `POST /project/save-snapshot`: Save snapshot of model spec, results, and diagram layout.
21. `GET /project/list-snapshots`: List snapshots.
22. `GET /project/get-snapshot`: Retrieve specific snapshot.
23. `POST /project/delete-snapshot`: Delete snapshot.
24. `POST /project/create-model-from-snapshot`: Fork snapshot into new model.
25. `POST /project/save-model`: Save model spec & diagram layout (scoped to `model_id`).
26. `GET /project/load-model`: Load model spec & layout by `model_id`.
27. `POST /project/duplicate-model`: Duplicate model spec and results within project.
28. `POST /project/duplicate`: Clone entire `.pls` project file.
29. `POST /project/remap-model-ids`: Update `model_key` references in sqlite.
30. `POST /workspace/duplicate`: Clone workspace directory.
31. `POST /project/run-pls`: Execute PLS estimation and save results.
32. `GET /project/load-results`: Retrieve cached results by algorithm and `model_id`.
33. `POST /project/bootstrap-start`: Launch async parallel bootstrap job.
34. `POST /project/bootstrap-cancel`: Signal cancellation to running bootstrap job.
35. `GET /project/bootstrap-status`: Query current bootstrap progress and results.
36. `WS /ws/bootstrap-progress/{job_id}`: WebSocket streaming bootstrap progress.

---

## 3. Data Flow
1. **Import**: `POST /data/import` or `POST /project/save-data` parses file bytes into `pd.DataFrame`, replaces missing markers (e.g. `-99`), and calls `project_io.save_data()`.
2. **Storage**: `save_data()` drops any existing `raw_data` table and creates a single `raw_data` SQL table where column types are mapped to `REAL` or `TEXT`.
3. **Execution**:
   - `run_project_pls` or `start_bootstrap_job` loads rows from `raw_data`.
   - Resolves `ModelSpec` from request or `project_io.load_model_spec(model_id)`.
   - Validates spec using `validate_model_spec()`.
   - Instantiates `PLSAlgorithm` with options (`scheme`, `max_iter`, `tol`, `missing_treatment`, `missing_values`).
   - `PLSAlgorithm.fit()` extracts needed columns, replaces `-99`, applies `missing_treatment`, standardizes ($ddof=0$), iterates Wold outer/inner approximations until convergence, and computes structural/measurement metrics.
   - Result dictionary is saved via `project_io.save_results()` under table `results`.

---

## 4. Single-Dataset Assumptions to Refactor (P0-5)
The codebase currently assumes a single dataset per project in the following places:
1. `backend/project_io.py`:
   - Line 56: `cur.execute("DROP TABLE IF EXISTS raw_data")` — directly hardcodes single table `raw_data`.
   - Line 64: `CREATE TABLE raw_data (...)`.
   - Line 81: `SELECT name FROM sqlite_master WHERE type='table' AND name='raw_data'`.
   - Line 104: `delete_data()` drops `raw_data`.
   - Metadata key `'dataset_name'` stores only one dataset name.
2. `backend/main.py`:
   - `/project/diagnostics`: loads `project_io.load_data(path)` with no `dataset_id`.
   - `/project/treat-missing`: overwrites single `raw_data`.
   - `/project/save-data` & `/project/save-data-json`: overwrites single `raw_data`.
   - `/project/run-pls` & `/project/bootstrap-start`: loads data unconditionally from `project_io.load_data(path)`.
   - `ModelSpec`: has no `dataset_id` field binding a model to a dataset.

Refactoring plan:
- Introduce `datasets` metadata table and `data_<dataset_id>` tables.
- Add `dataset_columns` table storing roles, scales, and reverse-coding flags.
- Migrate legacy `raw_data` to `datasets` table with `id="default"`, `name="Imported data"`.
- Support `dataset_id` in `ModelSpec`, `RunPlsRequest`, `BootstrapStartRequest`, and all diagnostics.

---

## 5. Current Settings Keys vs Extended Schema (P0-2)
Currently, settings are dispersed across:
- `RunPlsRequest`: `scheme`, `max_iter`, `tol`, `bootstrap`, `n_boot`, `missing_treatment`, `missing_values`, `model_id`.
- `BootstrapStartRequest`: `scheme`, `max_iter`, `tol`, `n_boot`, `seed`, `sign_alignment`, `missing_treatment`, `missing_values`, `model_id`.
- `PLSAlgorithm.__init__`: `scheme`, `max_iter`, `tol`, `sign_alignment`, `missing_treatment`, `missing_values`.

Extended schema (`core/settings_schema.py`) will unify all settings into a single standard model:
- `inner_weighting`: `path` (default), `factor`, `centroid`
- `max_iter`: 300
- `tolerance`: 1e-7
- `initial_weights`: `equal` (default), `lohmoller`, `individual`, `sum_scores`
- `individual_initial_weights`: Optional[Dict[str, float]]
- `missing_treatment`: `mean` (default), `listwise`, `pairwise`, `em`, `knn`
- `missing_codes`: List[Any] (default `[-99, "-99"]`)
- `weight_column`: Optional[str]
- `consistent`: bool (default False for standard PLS, True for PLSc)
- `sign_convention`: `dominant` (default), `none`
- `moderation_method`: `two_stage` (default), `product_indicator`, `orthogonalizing`
- `hcm_method`: `repeated_indicators` (default), `two_stage`
- `significance_level`: 0.05
- `tails`: `two` (default) or `one`
- `dataset_id`: Optional[str]
- `ci_method`: `percentile` (default), `bias_corrected`, `bca`, `studentized`
