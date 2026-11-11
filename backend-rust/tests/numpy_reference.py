"""Independent NumPy checks for a single-indicator PLS regression model.

Run after `cargo build`: python3 tests/numpy_reference.py
Requires NumPy and SciPy; these are optional reference-check dependencies.
"""
import json
import subprocess
from pathlib import Path
import numpy as np
from scipy.stats import norm

binary = Path(__file__).resolve().parents[1] / "target" / "debug" / "statsem-engine"
n = 72
x = np.linspace(-2.5, 2.5, n)
y = 0.7 * x + 0.42 * np.sin(np.arange(n) * 1.37)
rows = np.column_stack([x, y])
spec = {"constructs": [{"id": "X", "indicators": ["x"]}, {"id": "Y", "indicators": ["y"]}], "paths": [{"from": "X", "to": "Y"}]}
base = {"columns": ["x", "y"], "rows": rows.tolist(), "spec": spec}
requests = [
    {"op": "bootstrap", **base, "options": {"n_boot": 120, "seed": 42, "n_workers": 1, "mode": "basic"}},
    {"op": "predict", **base, "options": {"k_folds": 4, "repetitions": 2, "seed": 42, "cvpat_resamples": 50, "antecedents": "direct"}},
    {"op": "bootstrap", **base, "options": {"n_boot": 30, "seed": 42, "n_workers": 1, "mode": "basic", "ci_method": "studentized", "studentized_resamples": 20}},
]
cta_data = np.column_stack([x + 0.1*np.sin(np.arange(n)*frequency) for frequency in [0.4, 0.7, 1.1, 1.7]])
cta_spec = {"constructs": [{"id": "A", "indicators": ["a", "b", "c", "d"]}], "paths": []}
requests.append({"op": "cta", "columns": ["a", "b", "c", "d"], "rows": cta_data.tolist(), "spec": cta_spec, "options": {"n_boot": 80, "seed": 42, "alpha": 0.05, "parallel": True}})
process = subprocess.run([str(binary)], input="".join(json.dumps(r) + "\n" for r in requests), text=True, capture_output=True, check=True)
replies = [json.loads(line) for line in process.stdout.splitlines()]
for reply in replies:
    if "error" in reply:
        raise AssertionError(reply["error"])
boot, prediction, studentized, cta = [reply["result"] for reply in replies]

# A standardized path between two single-indicator constructs equals Pearson's r.
seeds = np.random.SeedSequence(42).generate_state(120)
samples = []
for seed in seeds:
    index = np.random.default_rng(int(seed)).integers(0, n, size=n)
    samples.append(np.corrcoef(x[index], y[index])[0, 1])
path = boot["parameters"]["path:X->Y"]
np.testing.assert_allclose(path["original"], np.corrcoef(x, y)[0, 1], atol=1e-10)
np.testing.assert_allclose(boot["samples_dict"]["path:X->Y"], samples, atol=1e-9)
np.testing.assert_allclose(path["se"], np.std(samples, ddof=1), atol=1e-10)
np.testing.assert_allclose([path["ci_low"], path["ci_high"]], np.quantile(samples, [0.025, 0.975]), atol=1e-9)

# Independently reproduce the nested bootstrap-t pivots and percentile limits.
outer_estimates, pivots, inner_errors = [], [], []
original = np.corrcoef(x, y)[0, 1]
for seed in np.random.SeedSequence(42).generate_state(30):
    rng = np.random.default_rng(int(seed))
    index = rng.integers(0, n, size=n)
    xb, yb = x[index], y[index]
    estimate = np.corrcoef(xb, yb)[0, 1]
    inner = []
    for _ in range(20):
        nested = rng.integers(0, n, size=n)
        inner.append(np.corrcoef(xb[nested], yb[nested])[0, 1])
    outer_estimates.append(estimate)
    inner_errors.append(np.std(inner, ddof=1))
    pivots.append((estimate - original) / inner_errors[-1])
se = np.std(outer_estimates, ddof=1)
limits = original - se * np.quantile(pivots, [0.975, 0.025])
student_path = studentized["parameters"]["path:X->Y"]
np.testing.assert_allclose([student_path["ci_low"], student_path["ci_high"]], limits, atol=1e-9)

# In this model, PLS prediction is ordinary least squares with an intercept.
seeds = np.random.default_rng(42).integers(0, 1_000_000, size=2)
actual, estimates, means = [], [], []
for seed in seeds:
    order = np.random.default_rng(int(seed)).permutation(n)
    for held in np.array_split(order, 4):
        train = np.setdiff1d(np.arange(n), held)
        coefficients = np.linalg.lstsq(np.column_stack([np.ones(len(train)), x[train]]), y[train], rcond=None)[0]
        actual.extend(y[held]); estimates.extend(coefficients[0] + coefficients[1] * x[held]); means.extend(np.repeat(np.mean(y[train]), len(held)))
actual, estimates, means = map(np.asarray, (actual, estimates, means))
metric = next(item for item in prediction["indicator_metrics"] if item["indicator"] == "y")
np.testing.assert_allclose(metric["rmse_pls"], np.sqrt(np.mean((actual - estimates) ** 2)), atol=1e-9)
np.testing.assert_allclose(metric["q2_predict"], 1 - np.sum((actual - estimates) ** 2) / np.sum((actual - means) ** 2), atol=1e-9)
cov = np.cov(cta_data, rowvar=False, ddof=1)
tetrads = [cov[0,1]*cov[2,3] - cov[0,2]*cov[1,3], cov[0,1]*cov[2,3] - cov[0,3]*cov[1,2], cov[0,2]*cov[1,3] - cov[0,3]*cov[1,2]]
for item in cta["constructs"][0]["tetrads"]:
    assert min(abs(item["original_value"] - expected) for expected in tetrads) < 1e-9
    np.testing.assert_allclose(item["p_value"], 2 * norm.sf(abs(item["t_statistic"])), atol=1e-7)
print("NumPy/SciPy checks passed: bootstrap estimates, SE, percentile and studentized intervals, prediction RMSE and Q², CTA tetrads and p-values.")
