# Dataset statistics

Open a dataset and select **Statistics → Distribution**. Normality is assessed
in the background for each numeric variable while the dataset page is open.
Select a variable to see skewness, excess kurtosis, a histogram with a fitted
normal curve, a normal Q–Q plot, and Shapiro–Wilk, Lilliefors-corrected
Kolmogorov–Smirnov and Jarque–Bera tests. Shapiro–Wilk is available for 3–5,000
observations, Lilliefors requires at least five, and Jarque–Bera at least eight.
Constant variables cannot be assessed. Ties and sample size affect the tests;
inspect the plots and measurement scale before drawing a conclusion.

Choose **Group tests** to run Welch's independent t-test, a paired t-test,
one-way ANOVA, ANCOVA, MANOVA, or MANCOVA. Grouping uses distinct values of
the selected dataset column. For ANCOVA and MANCOVA, select at least one
numeric covariate. MANOVA and MANCOVA require at least two distinct numeric
outcomes. The regression-based tests report the overall group effect after
adjusting for selected covariates. MANOVA and MANCOVA use Wilks' lambda and
its approximate F test.

Welch's test excludes missing observations separately by group; the paired
test uses complete pairs. The regression-based tests use complete cases across
the variables selected for the model. ANOVA and the regression-based tests
assume independent observations and appropriate residual distributions.
Ordinary ANOVA and ANCOVA assume equal variances, while MANOVA and MANCOVA
assume equal covariance matrices. Covariate models assume common slopes
across groups. ANCOVA reports a group-by-covariate interaction test for common
slopes when it is estimable. Independence and equality of covariance matrices
are not automatically tested.

One-way ANOVA includes pairwise Welch tests with Holm-adjusted p-values.
ANCOVA, MANOVA, and MANCOVA include model-based, outcome-specific pairwise
contrasts using the pooled residual variance and Holm adjustment.
Available diagnostics include Jarque–Bera tests of residuals or groups and
median-based Brown–Forsythe variance checks for t-tests and one-way ANOVA.
These checks do not prove that assumptions hold.

Group-test results are saved in the study under the dataset when calculated.
Use the saved results selector to reopen a run; the app checks the data used
by the run and flags changes. Normality assessments can be saved individually.
Both can be exported as CSV or Excel, including diagnostic and plot data when
available. Normality checks run again when a dataset is reopened or changed.

ANOVA, ANCOVA, MANOVA, and MANCOVA also support an optional second grouping
factor and an optional factor-by-factor interaction. Factor effects use
sum-to-zero coding and compare the full model against the model with that
effect removed. Pairwise contrasts compare equal-weighted marginal means,
adjusting for covariates where applicable. With an interaction, interpret the
marginal comparisons in that context. Holm adjustment covers all pairwise
contrasts across the factors and outcomes. The factorial model requires all
selected effects to be estimable; rank-deficient designs are rejected.

Factorial analysis supports up to two factors, with at most 12 levels per
factor and 40 combinations. More than two factors, higher-order interactions,
and group-specific covariate slopes in the fitted model are not supported.
