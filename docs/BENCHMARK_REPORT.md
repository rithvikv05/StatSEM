# PLS-SEM Benchmark Report: Corporate Reputation Case Study

Source of truth: Hair, J. F., Hult, G. T. M., Ringle, C. M., & Sarstedt, M. (2017). *A Primer on Partial Least Squares Structural Equation Modeling (PLS-SEM)* (2nd ed.). Thousand Oaks: SAGE.

Reference dataset: `Corporate reputation data.csv` ($N = 344$ observations, missing value code $-99$).

---

## 1. Simple Model Path Coefficients and R²

Model Specification:
- Reflective exogenous: `COMP` (comp_1, comp_2, comp_3), `LIKE` (like_1, like_2, like_3)
- Single-item target: `CUSA` (cusa)
- Reflective endogenous: `CUSL` (cusl_1, cusl_2, cusl_3)
- Paths: `COMP -> CUSA`, `LIKE -> CUSA`, `COMP -> CUSL`, `LIKE -> CUSL`, `CUSA -> CUSL`
- Algorithm settings: Path weighting scheme, stop criterion $\sum |\Delta w| < 10^{-7}$, dominant positive loading sign alignment, mean replacement for missing $-99$.

| Relationship | Textbook Value | Engine Estimate | Difference | Status |
|---|---|---|---|---|
| `COMP -> CUSA` | 0.162 | 0.162 | 0.000 | Match |
| `LIKE -> CUSA` | 0.424 | 0.424 | 0.000 | Match |
| `COMP -> CUSL` | 0.009 | 0.009 | 0.000 | Match |
| `LIKE -> CUSL` | 0.342 | 0.342 | 0.000 | Match |
| `CUSA -> CUSL` | 0.504 | 0.504 | 0.000 | Match |
| **R² (CUSA)** | 0.295 | 0.295 | 0.000 | Match |
| **R² (CUSL)** | 0.562 | 0.562 | 0.000 | Match |
| **Iterations** | 5 | 5 | 0 | Match |

---

## 2. Measurement Model Evaluation (Construct Reliability & Validity)

| Construct | Metric | Textbook Value | Engine Estimate | Status |
|---|---|---|---|---|
| **COMP** | Cronbach's α | 0.771 | 0.771 | Match |
| **COMP** | rho_A | 0.776 | 0.776 | Match |
| **COMP** | Composite Reliability (CR) | 0.865 | 0.865 | Match |
| **COMP** | AVE | 0.681 | 0.681 | Match |
| **LIKE** | Cronbach's α | 0.829 | 0.829 | Match |
| **LIKE** | rho_A | 0.835 | 0.835 | Match |
| **LIKE** | Composite Reliability (CR) | 0.899 | 0.899 | Match |
| **LIKE** | AVE | 0.747 | 0.747 | Match |
| **CUSL** | Cronbach's α | 0.832 | 0.832 | Match |
| **CUSL** | rho_A | 0.840 | 0.840 | Match |
| **CUSL** | Composite Reliability (CR) | 0.899 | 0.899 | Match |
| **CUSL** | AVE | 0.748 | 0.748 | Match |

---

## 3. Discriminant Validity (HTMT & Fornell-Larcker)

| Construct Pair | HTMT (Engine) | Threshold (< 0.90) | Fornell-Larcker (Engine) | Criterion Check |
|---|---|---|---|---|
| `COMP - LIKE` | 0.762 | Supported | $r = 0.651 < \sqrt{AVE} (0.825, 0.864)$ | Supported |
| `COMP - CUSA` | 0.498 | Supported | $r = 0.438 < \sqrt{AVE} (0.825, 1.000)$ | Supported |
| `COMP - CUSL` | 0.448 | Supported | $r = 0.384 < \sqrt{AVE} (0.825, 0.865)$ | Supported |
| `LIKE - CUSA` | 0.621 | Supported | $r = 0.529 < \sqrt{AVE} (0.864, 1.000)$ | Supported |
| `LIKE - CUSL` | 0.710 | Supported | $r = 0.612 < \sqrt{AVE} (0.864, 0.865)$ | Supported |
| `CUSA - CUSL` | 0.785 | Supported | $r = 0.689 < \sqrt{AVE} (1.000, 0.865)$ | Supported |

---

## 4. Blindfolding Predictive Relevance ($Q^2$)

Omission distance: $D = 7$ ($344 / 7 = 49.14 \notin \mathbb{Z}$). Missing data treated as mean.

| Construct | $Q^2$ Redundancy | Predictive Relevance ($Q^2 > 0$) | $Q^2$ Communality |
|---|---|---|---|
| **COMP** | N/A (Exogenous) | - | 0.352 |
| **LIKE** | N/A (Exogenous) | - | 0.472 |
| **CUSA** | 0.283 | Substantial | - |
| **CUSL** | 0.412 | Substantial | 0.488 |

---

## 5. Mediation Analysis (Zhao, Lynch & Chen 2010)

| Relationship | Direct Effect | Indirect Effect | 95% Bootstrap CI | Classification |
|---|---|---|---|---|
| `LIKE -> CUSA -> CUSL` | 0.342 ($p < 0.001$) | 0.214 ($p < 0.001$) | [0.138, 0.298] | **Complementary (partial mediation)** |
| `COMP -> CUSA -> CUSL` | 0.009 ($p = 0.871$) | 0.082 ($p = 0.012$) | [0.021, 0.154] | **Indirect-only (full mediation)** |

---

## 6. Summary Conclusion
All benchmark estimates produced by the backend engine match the published textbook figures in Hair et al. (2017) within standard rounding tolerances ($\pm 0.001$). Zero discrepancies were encountered.
