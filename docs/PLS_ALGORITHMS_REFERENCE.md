# Theoretical and Algorithmic Reference for PLS-SEM in StatSEM

This reference document outlines the mathematical models, estimation procedures, convergence criteria, and statistical diagnostics implemented in the **StatSEM** computation engine.

StatSEM implements variance-based Partial Least Squares Structural Equation Modeling (PLS-SEM) following the foundational formulations of Herman Wold (1982) and Jan-Bernd Lohmöller (1989), enriched with modern econometric developments (Dijkstra & Henseler, 2015; Henseler et al., 2015, 2016; Park & Gupta, 2012; Hair et al., 2022).

---

## 1. The General PLS-SEM Model

A PLS path model consists of two fundamental components:
1. **The Structural (Inner) Model**: Specifies the hypothesized linear relationships between unobserved latent variables.
2. **The Measurement (Outer) Model**: Specifies the relationships between each latent variable and its observed manifest indicators.

### 1.1 Structural Model Formulation
Let $\boldsymbol{\eta} = (\eta_1, \eta_2, \dots, \eta_J)^T$ be the vector of $J$ latent variables. The structural model is expressed as:
$$
\boldsymbol{\eta} = \mathbf{B} \boldsymbol{\eta} + \boldsymbol{\zeta}
$$
where:
- $\mathbf{B}$ is a $(J \times J)$ matrix of path coefficients with zeros on the diagonal (since constructs do not predict themselves) and strictly recursive (acyclic) lower-triangular or upper-triangular structure.
- $\boldsymbol{\zeta}$ is a vector of inner disturbance (error) terms, satisfying $E(\boldsymbol{\zeta}) = \mathbf{0}$ and $\text{Cov}(\boldsymbol{\zeta}, \boldsymbol{\eta}_{\text{pred}}) = \mathbf{0}$.

### 1.2 Measurement Model Formulation
For each latent variable $\eta_j$ with $K_j$ indicators $\mathbf{x}_j = (x_{j1}, x_{j2}, \dots, x_{jK_j})^T$:

- **Reflective Measurement (Mode A)**:
  Indicators are modeled as manifestations caused by the underlying construct:
  $$
  x_{jk} = \lambda_{jk} \eta_j + \varepsilon_{jk}
  $$
  where $\lambda_{jk}$ is the outer loading of indicator $k$ on construct $j$, and $\varepsilon_{jk}$ is the random measurement error satisfying $E(\varepsilon_{jk}) = 0$ and $\text{Cov}(\eta_j, \varepsilon_{jk}) = 0$.

- **Formative Measurement (Mode B)**:
  The construct is modeled as a linear combination of its defining indicators:
  $$
  \eta_j = \sum_{k=1}^{K_j} w_{jk} x_{jk} + \delta_j
  $$
  where $w_{jk}$ are outer weights and $\delta_j$ is an unmodeled disturbance term.

---

## 2. The Core PLS Iterative Algorithm

The primary objective of the PLS-SEM algorithm is to estimate proxy scores for all latent variables $\hat{\boldsymbol{\eta}}_j$ as linear combinations of their empirical indicators:
$$
\hat{\mathbf{Y}}_j = \mathbf{X}_j \mathbf{w}_j
$$
where $\mathbf{X}_j$ is the $(N \times K_j)$ standardized data matrix for construct $j$, and $\mathbf{w}_j$ is the $(K_j \times 1)$ vector of outer weights.

The algorithm executes an iterative four-stage estimation loop until the estimated outer weights reach numerical convergence.

```
+-----------------------------------------------------------+
| Stage 1: Outer Approximation of Latent Proxy Scores       |
|    Compute preliminary proxy Y_j = X_j * w_j              |
|    Standardize Y_j to zero mean and unit variance         |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
| Stage 2: Inner Approximation (Path, Factor, or Centroid)  |
|    Compute inner weights e_ji between adjacent constructs |
|    Synthesize inner proxy Z_j = sum(e_ji * Y_i)           |
|    Standardize Z_j to zero mean and unit variance         |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
| Stage 3: Outer Estimation (Mode A vs. Mode B)             |
|    Mode A (Reflective): w_jk = X_jk' * Z_j                |
|    Mode B (Formative):  w_j  = (X_j' * X_j)^(-1) X_j' Z_j|
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
| Stage 4: Convergence Check                                |
|    Evaluate max |w_jk^(s) - w_jk^(s-1)| < 10^(-7)         |
|    If converged: compute final OLS path coefficients      |
|    If not: loop back to Stage 1                           |
+-----------------------------------------------------------+
```

### Stage 1: Outer Approximation
At iteration $s=1$, initial weights $\mathbf{w}_j^{(0)}$ are initialized (by default $w_{j1} = 1$ and $w_{jk} = 0$ for $k > 1$, or equal weights $w_{jk} = 1/\sqrt{K_j}$). Latent proxy scores are computed:
$$
\tilde{\mathbf{Y}}_j^{(s)} = \mathbf{X}_j \mathbf{w}_j^{(s-1)}
$$
Each proxy vector is then standardized to mean 0 and variance 1:
$$
\mathbf{Y}_j^{(s)} = \frac{\tilde{\mathbf{Y}}_j^{(s)} - \bar{\tilde{\mathbf{Y}}}_j^{(s)}}{\sigma(\tilde{\mathbf{Y}}_j^{(s)})}
$$

### Stage 2: Inner Approximation
The inner proxy scores $\mathbf{Z}_j^{(s)}$ are constructed by taking weighted linear combinations of adjacent latent variables $\mathbf{Y}_i^{(s)}$ connected to construct $j$ in the structural network:
$$
\tilde{\mathbf{Z}}_j^{(s)} = \sum_{i \in \text{Adj}(j)} e_{ji}^{(s)} \mathbf{Y}_i^{(s)}
$$
where $e_{ji}$ is the inner weight determining the contribution of construct $i$ to construct $j$. StatSEM provides three classic inner weighting schemes:

#### 1. Path Weighting Scheme (Recommended)
The path scheme explicitly differentiates whether an adjacent construct is a predecessor or a successor:
- For a **predecessor** construct ($i \to j$), $e_{ji}$ is the partial regression coefficient obtained from regressing $\mathbf{Y}_j$ onto all adjacent predecessor proxies:
  $$
  e_{ji} = \hat{\beta}_{ji} \quad \text{from} \quad \mathbf{Y}_j = \sum_{k \to j} \beta_{jk} \mathbf{Y}_k + \mathbf{u}
  $$
- For a **successor** construct ($j \to i$), $e_{ji}$ is the simple bivariate correlation between $\mathbf{Y}_i$ and $\mathbf{Y}_j$:
  $$
  e_{ji} = r(\mathbf{Y}_i, \mathbf{Y}_j)
  $$

#### 2. Factor Weighting Scheme
The inner weights correspond directly to bivariate sample correlations between adjacent constructs, irrespective of structural path direction:
$$
e_{ji} = r(\mathbf{Y}_i, \mathbf{Y}_j)
$$

#### 3. Centroid Weighting Scheme
Wold's original heuristic inner weighting scheme, taking only the algebraic sign of the correlation:
$$
e_{ji} = \text{sign}(r(\mathbf{Y}_i, \mathbf{Y}_j))
$$

Once $\tilde{\mathbf{Z}}_j^{(s)}$ is formed, it is standardized to unit variance:
$$
\mathbf{Z}_j^{(s)} = \frac{\tilde{\mathbf{Z}}_j^{(s)}}{\|\tilde{\mathbf{Z}}_j^{(s)}\|}
$$

### Stage 3: Outer Estimation
Updated outer weights $\mathbf{w}_j^{(s)}$ are derived by relating the standardized data matrix $\mathbf{X}_j$ to the inner proxy score $\mathbf{Z}_j^{(s)}$:

- **Mode A (Reflective Mode)**:
  Weights are calculated via bivariate simple regressions of indicators on the inner proxy:
  $$
  \mathbf{w}_j^{(s)} = \frac{1}{N} \mathbf{X}_j^T \mathbf{Z}_j^{(s)}
  $$
  Each element $w_{jk}^{(s)}$ equals the sample covariance between indicator $x_{jk}$ and the inner estimate $\mathbf{Z}_j^{(s)}$.

- **Mode B (Formative Mode)**:
  Weights are obtained via multiple ordinary least squares (OLS) regression of the inner proxy $\mathbf{Z}_j^{(s)}$ onto the block of indicators $\mathbf{X}_j$:
  $$
  \mathbf{w}_j^{(s)} = \left(\mathbf{X}_j^T \mathbf{X}_j\right)^{-1} \mathbf{X}_j^T \mathbf{Z}_j^{(s)}
  $$

### Stage 4: Convergence Checking
After each iteration, the vector of changes in outer weights is evaluated:
$$
\Delta^{(s)} = \max_{j, k} \left| w_{jk}^{(s)} - w_{jk}^{(s-1)} \right|
$$
If $\Delta^{(s)} < \epsilon$ (where default tolerance $\epsilon = 10^{-7}$), the iterative algorithm terminates. If the maximum iteration limit (default: 300) is exceeded without meeting $\epsilon$, StatSEM alerts the researcher of non-convergence.

### Computation of Final Structural Path Coefficients
Upon convergence, final construct scores $\hat{\mathbf{Y}}$ are computed using the final converged weights $\mathbf{w}^*$. For every endogenous construct $\eta_j$ with predecessors $\mathcal{P}_j = \{i : \eta_i \to \eta_j\}$, path coefficients are estimated via multiple OLS regression:
$$
\hat{\boldsymbol{\beta}}_j = \left( \hat{\mathbf{Y}}_{\mathcal{P}_j}^T \hat{\mathbf{Y}}_{\mathcal{P}_j} \right)^{-1} \hat{\mathbf{Y}}_{\mathcal{P}_j}^T \hat{\mathbf{Y}}_j
$$

---

## 3. Evaluation of Measurement (Outer) Models

### 3.1 Reflective Measurement Model Assessment
Reflective constructs are evaluated for indicator reliability, internal consistency, convergent validity, and discriminant validity.

#### 1. Indicator Reliability
Each indicator loading $\lambda_{jk}$ represents the bivariate correlation between indicator $x_{jk}$ and latent score $\hat{\mathbf{Y}}_j$:
$$
\lambda_{jk} = \frac{\mathbf{x}_{jk}^T \hat{\mathbf{Y}}_j}{N}
$$
Indicator reliability is defined as $\lambda_{jk}^2$. Following Hair et al. (2022), outer loadings should ideally exceed $0.708$ ($\lambda_{jk}^2 \ge 0.50$), indicating the construct accounts for at least 50% of the indicator's variance.

#### 2. Internal Consistency Reliability
StatSEM reports three reliability coefficients:
- **Cronbach's Alpha ($\alpha$)**:
  $$
  \alpha = \frac{K}{K - 1} \left( 1 - \frac{\sum_{k=1}^K \text{Var}(x_k)}{\text{Var}\left(\sum_{k=1}^K x_k\right)} \right)
  $$
  *Limitation*: Assumes tau-equivalence (all loadings equal), often underestimating true reliability.

- **Dijkstra-Henseler's $\rho_A$**:
  $$
  \rho_A = \left( \hat{\mathbf{w}}^T \hat{\mathbf{w}} \right)^2 \frac{\hat{\mathbf{w}}^T (\mathbf{S} - \text{diag}(\mathbf{S})) \hat{\mathbf{w}}}{\hat{\mathbf{w}}^T (\hat{\mathbf{w}} \hat{\mathbf{w}}^T - \text{diag}(\hat{\mathbf{w}} \hat{\mathbf{w}}^T)) \hat{\mathbf{w}}}
  $$
  where $\mathbf{S}$ is the empirical indicator correlation matrix. $\rho_A$ provides an asymptotically unbiased measure of construct reliability.

- **Composite Reliability ($\rho_C$ / Jöreskog's $\rho$)**:
  $$
  \rho_C = \frac{\left( \sum_{k=1}^K \lambda_k \right)^2}{\left( \sum_{k=1}^K \lambda_k \right)^2 + \sum_{k=1}^K (1 - \lambda_k^2)}
  $$
  *Threshold*: Values between $0.70$ and $0.95$ indicate satisfactory to good reliability.

#### 3. Convergent Validity (Average Variance Extracted - AVE)
$$
\text{AVE}_j = \frac{\sum_{k=1}^{K_j} \lambda_{jk}^2}{K_j}
$$
*Threshold*: An $\text{AVE} \ge 0.50$ confirms that the construct explains more than half of the indicator variance on average.

### 3.2 Discriminant Validity

#### 1. Fornell-Larcker Criterion
The square root of each construct's AVE ($\sqrt{\text{AVE}_j}$) must be strictly greater than its highest bivariate correlation with any other latent construct:
$$
\sqrt{\text{AVE}_j} > |r_{ji}| \quad \forall i \neq j
$$

#### 2. Cross-Loadings
Each indicator must correlate higher with its assigned construct than with any other construct:
$$
\lambda_{jk} > \text{Corr}(x_{jk}, \hat{\mathbf{Y}}_i) \quad \forall i \neq j
$$

#### 3. Heterotrait-Monotrait Ratio (HTMT and HTMT2)
The HTMT ratio evaluates the average correlation between indicators measuring different constructs relative to the geometric mean of average correlations between indicators measuring the same construct:
$$
\text{HTMT}_{ij} = \frac{\frac{1}{K_i K_j} \sum_{g=1}^{K_i} \sum_{h=1}^{K_j} |r_{ig, jh}|}{\sqrt{\left( \frac{2}{K_i(K_i-1)} \sum_{g=1}^{K_i-1} \sum_{g'=g+1}^{K_i} |r_{ig, ig'}| \right) \left( \frac{2}{K_j(K_j-1)} \sum_{h=1}^{K_j-1} \sum_{h'=h+1}^{K_j} |r_{jh, jh'}| \right)}}
$$
- **HTMT2 Correction**: Uses geometric means of indicator inter-correlations rather than arithmetic means to maintain robustness across varying loadings.
- *Thresholds*: An $\text{HTMT} < 0.85$ (conservative) or $< 0.90$ (liberal) indicates distinct constructs.

---

## 4. Evaluation of Structural (Inner) Models

### 4.1 Collinearity Diagnostics (VIF)
To ensure regression coefficients are not distorted by multicollinearity, Variance Inflation Factors (VIF) are computed for each predictor set $\mathcal{P}_j$:
$$
\text{VIF}_i = \frac{1}{1 - R_i^2}
$$
where $R_i^2$ is obtained from regressing predictor $\hat{\mathbf{Y}}_i$ on all other predictors in the same block.
- *Threshold*: $\text{VIF} < 3.0$ is ideal; $\text{VIF} < 5.0$ is acceptable.

### 4.2 Coefficient of Determination ($R^2$ and $R^2_{\text{adj}}$)
$$
R^2_j = \hat{\boldsymbol{\beta}}_j^T \mathbf{R}_{\mathcal{P}_j} \hat{\boldsymbol{\beta}}_j
$$
$$
R^2_{j, \text{adj}} = 1 - (1 - R^2_j) \frac{N - 1}{N - |\mathcal{P}_j| - 1}
$$

### 4.3 Effect Size ($f^2$)
Measures the change in $R^2$ when a specific exogenous construct is omitted from the structural equation:
$$
f^2 = \frac{R^2_{\text{included}} - R^2_{\text{excluded}}}{1 - R^2_{\text{included}}}
$$
- *Benchmarks*: $0.02 \le f^2 < 0.15$ (small), $0.15 \le f^2 < 0.35$ (medium), $f^2 \ge 0.35$ (large).

---

## 5. Advanced Methodological Extensions

### 5.1 Two-Stage Moderation Analysis
To assess the moderating effect of $M$ on the relationship $X \to Y$:
1. **Stage 1**: Run the main PLS model to extract standardized latent variable scores $\hat{\mathbf{Y}}_X$ and $\hat{\mathbf{Y}}_M$.
2. **Stage 2**: Construct the single interaction proxy as the element-wise product:
   $$
   \hat{\mathbf{Y}}_{X \times M} = \hat{\mathbf{Y}}_X \odot \hat{\mathbf{Y}}_M
   $$
3. Regress the outcome score $\hat{\mathbf{Y}}_Y$ on $\hat{\mathbf{Y}}_X$, $\hat{\mathbf{Y}}_M$, and $\hat{\mathbf{Y}}_{X \times M}$:
   $$
   \hat{\mathbf{Y}}_Y = \beta_1 \hat{\mathbf{Y}}_X + \beta_2 \hat{\mathbf{Y}}_M + \beta_3 \hat{\mathbf{Y}}_{X \times M} + \boldsymbol{\zeta}
   $$
   A statistically significant $\beta_3$ confirms moderating interaction.

### 5.2 Quadratic Nonlinear Effects
To detect non-linear curves (such as diminishing returns or inverted-U relationships):
1. Extract the standardized construct score $\hat{\mathbf{Y}}_X$.
2. Generate the squared polynomial term:
   $$
   \hat{\mathbf{Y}}_{X^2} = (\hat{\mathbf{Y}}_X)^2 - \overline{(\hat{\mathbf{Y}}_X)^2}
   $$
3. Estimate the quadratic regression:
   $$
   \hat{\mathbf{Y}}_Y = \beta_1 \hat{\mathbf{Y}}_X + \beta_2 \hat{\mathbf{Y}}_{X^2} + \dots + \boldsymbol{\zeta}
   $$
   The turning point (inflection peak or trough) is located at $X^* = -\frac{\beta_1}{2 \beta_2}$.

### 5.3 Gaussian Copula Endogeneity Assessment
To test and correct for potential endogeneity without instrument variables (Park & Gupta, 2012):
1. Check that the suspected endogenous construct score $\hat{\mathbf{Y}}_X$ is non-normally distributed (via Shapiro-Wilk or Kolmogorov-Smirnov test).
2. Estimate the empirical cumulative distribution function $\hat{F}(x)$.
3. Transform the distribution into a Gaussian Copula control variable using the inverse standard normal distribution:
   $$
   C^* = \Phi^{-1}(\hat{F}(\hat{\mathbf{Y}}_X))
   $$
4. Include $C^*$ as an auxiliary regressor in the structural equation. If the path coefficient for $C^*$ is statistically significant via bootstrapping, endogeneity is present and corrected by the copula term.

---

## 6. Resampling and Multigroup Analysis (MGA)

### 6.1 Parallel Bootstrapping
StatSEM generates $B$ bootstrap samples (typically $B = 5,000$) drawn randomly with replacement from the original observations ($N$). For each sample $b$:
1. The full PLS algorithm is re-estimated, yielding $\hat{\theta}^{(b)}$.
2. Standard errors are computed:
   $$
   \text{SE}(\hat{\theta}) = \sqrt{\frac{1}{B-1} \sum_{b=1}^B \left( \hat{\theta}^{(b)} - \bar{\theta}^* \right)^2}
   $$
3. **Bias-Corrected and Accelerated (BCa) Confidence Intervals**:
   $$
   \text{CI}_{\text{BCa}} = \left( \hat{\theta}^{(\alpha_1)}, \hat{\theta}^{(\alpha_2)} \right)
   $$
   with endpoints adjusted for median bias $z_0 = \Phi^{-1}\left( \frac{1}{B} \sum_{b=1}^B \mathbb{I}(\hat{\theta}^{(b)} < \hat{\theta}) \right)$ and acceleration parameter $a$ estimated via jackknife resampling.

### 6.2 Multigroup Invariance & Comparison (MICOM & MGA)

#### The MICOM 3-Step Procedure
1. **Configural Invariance**: Confirms identical indicators, coding, and structural relations across groups.
2. **Compositional Invariance**: Assesses whether composite scores differ across groups by computing original correlation $c = \mathbf{w}_1^T \mathbf{S}_{12} \mathbf{w}_2$ and testing against permutation distribution $H_0: c = 1$.
3. **Equality of Composite Means and Variances**: Evaluates whether composite scores share identical location and dispersion parameters.

#### Henseler's MGA Permutation Test
Randomly permutes group assignments across observations to build the non-parametric null distribution:
$$
p_{\text{MGA}} = P\left( |\hat{\theta}^{(1)} - \hat{\theta}^{(2)}|_{\text{perm}} \ge |\hat{\theta}^{(1)} - \hat{\theta}^{(2)}|_{\text{observed}} \right)
$$

---

## 7. Academic References

1. **Dijkstra, T. K., & Henseler, J. (2015).** Consistent Partial Least Squares Path Modeling. *MIS Quarterly*, 39(2), 297–316.
2. **Hair, J. F., Hult, G. T. M., Ringle, C. M., & Sarstedt, M. (2022).** *A Primer on Partial Least Squares Structural Equation Modeling (PLS-SEM)* (3rd ed.). Thousand Oaks: Sage.
3. **Henseler, J., Ringle, C. M., & Sarstedt, M. (2015).** A new criterion for assessing discriminant validity in variance-based structural equation modeling. *Journal of the Academy of Marketing Science*, 43(1), 115–135.
4. **Henseler, J., Ringle, C. M., & Sarstedt, M. (2016).** Testing measurement invariance of composites using partial least squares. *International Marketing Review*, 33(3), 405–431.
5. **Lohmöller, J.-B. (1989).** *Latent Variable Path Modeling with Partial Least Squares*. Heidelberg: Physica.
6. **Park, S., & Gupta, S. (2012).** Handling endogenous regressors by a copula-based approach: Theory and applications. *Marketing Science*, 31(4), 567–586.
7. **Sarstedt, M., Hair, J. F., Nitzl, C., Ringle, C. M., & Howard, M. C. (2020).** Beyond a tandem approach of confirmatory factor analysis and structural equation modeling. *International Journal of Research in Marketing*, 37(4), 690–709.
8. **Wold, H. (1982).** Soft modeling: The basic design and some extensions. In K. G. Jöreskog & H. Wold (Eds.), *Systems Under Indirect Observation: Causality, Structure, Prediction* (Part II, pp. 1–54). Amsterdam: North-Holland.
