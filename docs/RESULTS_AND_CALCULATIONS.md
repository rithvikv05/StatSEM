# Results and calculations

The results screen groups output by the estimate or diagnostic a researcher
needs. It shows each base estimate once and puts analysis-specific output in
expandable sections on the same screen. The labels and organization are
StatSEM's own; the statistical terms remain standard terminology.

## What belongs together

- **Direct, combined, and indirect effects:** Base PLS-SEM already supplies
  direct, total, total indirect and individual indirect path estimates.
  Bootstrapping supplies inference when available. Mediation analysis adds
  inference for the selected paths; it does not need another copy of the base
  coefficient tables. Results from different runs are labeled separately when
  their estimates differ or the saved analysis is stale. See the SmartPLS
  [mediation documentation](https://smartpls.com/documentation/algorithms-and-techniques/extended-relationships/mediation/).
- **Interactions:** Interaction coefficients belong in the model's path
  results. Simple slopes and conditional indirect effects add distinct
  information and appear inline when the engine reports them. Missing p-values
  and confidence intervals are shown as unavailable. See the SmartPLS
  [moderation guide](https://smartpls.com/faq/smartpls4/moderation/).
- **Model checks:** Loadings, reliability, AVE, discriminant validity, VIF,
  R², f², and fit measures serve different assessment purposes. Reliability
  and AVE should not be presented as reflective-model criteria for formative
  constructs. The Tenenhaus GoF is included only as a legacy value and is not
  recommended as a general model-fit criterion. See the SmartPLS
  [result thresholds](https://smartpls.com/documentation/functionalities/thresholds/)
  and [glossary](https://smartpls.com/documentation/literature/glossary/).
- **Calculation details:** Show convergence, iterations, case count and final
  change only when returned by the engine. No residuals, information criteria,
  execution log or settings are invented when absent. See the SmartPLS
  [PLS-SEM algorithm documentation](https://smartpls.com/documentation/algorithms-and-techniques/core-algorithm/pls/).
- **Distinct analyses:** Prediction errors, IPMA performance, segment
  membership and group differences cannot be reconstructed from ordinary path
  coefficients. They remain available as inline analysis details rather than
  permanent duplicate sidebar pages. See the SmartPLS documentation for
  [PLSpredict](https://smartpls.com/documentation/algorithms-and-techniques/prediction-and-segmentation/predict/),
  [IPMA](https://smartpls.com/documentation/algorithms-and-techniques/prediction-and-segmentation/ipma/),
  [group comparisons](https://smartpls.com/documentation/algorithms-and-techniques/heterogeneity-and-multigroup/multigroup-analysis/),
  and [FIMIX](https://smartpls.com/documentation/algorithms-and-techniques/prediction-and-segmentation/fimix-pls/).

## Current implementation limits

- Moderation and quadratic effects are configured on the model canvas; their
  separate legacy HTTP actions are unavailable in the current Rust server.
  Ex-post segmentation and the legacy PDF-report endpoint are also unavailable.
  The results toolbar supports printing/saving as PDF instead.
- Consistent PLS uses the engine's consistent estimator, including for bootstrap
  replicates and group comparisons. Some tables may have no data if the native
  consistent result does not provide the corresponding fields. Further external
  validation of these numerical methods is still required.
- Saved analysis types are loaded on demand for the selected model. Power
  calculations are currently session-only: their endpoint does not save them
  into the project. A saved analysis whose model specification changed is
  marked stale; dataset changes are not yet included in that staleness check.
- Snapshots contain the main stored results. Separate saved analysis records
  are not automatically embedded in a snapshot.
- This is a results organization and integration change, not a claim of full
  parity with another statistical package. The new indirect-effect, fit,
  run-detail and moderation tables display reported backend values. Other
  existing analysis panels require further validation against their native
  result schemas; availability still depends on the engine and model.

## Calculation settings

The model dialog offers the weighting schemes and missing-value treatments
implemented by the standard engine, plus convergence controls. These settings
are stored with results and reused during automatic recalculation. Model output
is standardized. PCA weighting and additional output scales are not yet offered. Individual
starting weights, positive observation weights and a selected data group are
available for model runs. Advanced PLS analyses expose individual starting
weights and a data-group filter; observation weights remain limited to model
estimation and bootstrap.
Model fit indices are not available for observation-weighted models.

The bootstrap dialog exposes resample count, percentile, bias-corrected,
BCa and studentized intervals, test direction, significance level, result
detail, processing mode, seed and model/data settings.
BCa requires complete data, at most 500 observations, and a successful full
jackknife; the limit avoids silently reporting an unaccelerated approximation.
Studentized intervals use nested resampling and can be substantially slower.
Missing-data treatment is performed within each bootstrap resample. A randomly
generated seed is recorded with the bootstrap output.

Advanced calculations offer model weighting, individual starting weights and
data-group filtering where applicable. Prediction and PCA use complete cases;
other analysis-specific settings vary, and advanced analyses do not currently
support observation-weighted data. IPMA supports explicit indicator scales.
POS can use FIMIX as an initialization in the underlying engine;
that is why FIMIX settings are available when using that initialization in POS. See the [POS documentation](https://smartpls.com/documentation/algorithms-and-techniques/prediction-and-segmentation/pos/).

Principal component analysis is available per construct using the correlation
matrix of its indicators. It reports unrotated eigenvalues, explained variance,
and loadings. The current implementation uses complete cases independently for
each construct and permits up to 200 indicators per construct. It does not offer
rotation; a data-group filter can be applied.

PLSpredict includes a CVPAT comparison against the indicator-mean and linear
model benchmarks. Prediction repetitions are averaged by observation before
construct and overall squared losses are compared. The test uses a paired
case-level bootstrap standard error and a one-sided Student t probability.
Direct or earliest antecedents can be selected. Comparisons between two saved
models use matching cases, outcomes and folds. The optional NumPy/SciPy reference
check covers a single-indicator model, studentized bootstrap intervals and CTA;
it does not establish broad parity for every model or analysis setting.
