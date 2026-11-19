# Study Planner

Open **Study Planner** under Resources on Home. Select a supported test and
enter an assumed effect size, significance level and desired power. The result
is the smallest integer sample size meeting the target under the stated model.

- **Multiple regression:** an overall or incremental F test using Cohen's f².
  Set the number tested equal to the total for an overall model test, or lower
  to test an incremental R² conditional on the other predictors.
- **One-way ANOVA:** the omnibus F test using Cohen's f and equal group sizes.
- **Independent t-test:** a pooled-variance test using Cohen's d
  and a chosen group 2/group 1 allocation ratio.
- **One-sample or paired t-test:** a test using Cohen's d. For
  paired observations, standardize the difference by its own standard deviation.
- **One-sample or independent-means z-test:** a test using the difference in
  means standardized by the known common standard deviation.
- **Chi-square goodness of fit or independence:** an asymptotic omnibus test
  using Cohen's w and the test's degrees of freedom.

T-tests support one- and two-sided alternatives. For one-sided tests, the
effect is assumed to be in the prespecified direction. Two-sided calculations
use the equivalence between squared noncentral t and noncentral F; one-sided
power integrates the noncentral t distribution. These calculations assume independence, the relevant
distributional assumptions, and no attrition. Plan separately for missing
data and dropout.

Study Planner currently implements these a priori designs only. It is
not a complete replacement for all test families and analysis modes in
G*Power. It does not yet offer exact tests,
or other power-analysis modes.
