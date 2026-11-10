//! Numeric mean/EM/kNN imputation corresponding to data/imputation.py.
use crate::{
    linalg,
    matrix::{self, Matrix},
    stats,
};
use serde_json::{json, Value};

fn moments(x: &Matrix) -> (Vec<f64>, Matrix) {
    let cols = matrix::transpose(x);
    let mean: Vec<_> = cols.iter().map(|c| stats::mean(c, None)).collect();
    let centered: Matrix = x
        .iter()
        .map(|r| r.iter().zip(&mean).map(|(v, m)| v - m).collect())
        .collect();
    (mean, centered)
}
pub fn run(
    input: Vec<Vec<Option<f64>>>,
    method: &str,
    max_iter: usize,
    tol: f64,
    k: usize,
) -> Result<Value, String> {
    let n = input.len();
    let p = input.first().map_or(0, Vec::len);
    if input.iter().any(|r| r.len() != p) {
        return Err("Ragged imputation matrix".into());
    }
    let original: Matrix = input
        .iter()
        .map(|r| r.iter().map(|v| v.unwrap_or(f64::NAN)).collect())
        .collect();
    let missing: Vec<Vec<bool>> = original
        .iter()
        .map(|r| r.iter().map(|v| v.is_nan()).collect())
        .collect();
    let count = missing.iter().flatten().filter(|m| **m).count();
    let mut x = original.clone();
    if p == 0 || count == 0 {
        return Ok(json!({"rows":x,"imputed":0,"iterations":0}));
    }
    let mut means = vec![0.0; p];
    let mut stds = vec![0.0; p];
    let mut minima = vec![f64::NAN; p];
    let mut maxima = vec![f64::NAN; p];
    for j in 0..p {
        let observed: Vec<_> = original
            .iter()
            .map(|r| r[j])
            .filter(|v| !v.is_nan())
            .collect();
        means[j] = stats::mean(&observed, None);
        stds[j] = stats::std(&observed, None, 0);
        if stds[j] == 0.0 {
            stds[j] = 1.0;
        }
        for &v in &observed {
            if minima[j].is_nan() || v < minima[j] {
                minima[j] = v;
            }
            if maxima[j].is_nan() || v > maxima[j] {
                maxima[j] = v;
            }
        }
    }
    match method {
        "mean" => {
            for i in 0..n {
                for j in 0..p {
                    if missing[i][j] {
                        x[i][j] = means[j];
                    }
                }
            }
            Ok(json!({"rows":x,"imputed":count,"iterations":0}))
        }
        "knn" => {
            if k == 0 {
                return Err("k must be positive".into());
            }
            let normalized: Matrix = original
                .iter()
                .map(|r| {
                    r.iter()
                        .enumerate()
                        .map(|(j, v)| (v - means[j]) / stds[j])
                        .collect()
                })
                .collect();
            for i in 0..n {
                let observed: Vec<_> = (0..p).filter(|&j| !missing[i][j]).collect();
                for j in 0..p {
                    if missing[i][j] {
                        if observed.is_empty() {
                            x[i][j] = means[j];
                            continue;
                        }
                        let donors: Vec<_> = (0..n).filter(|&d| !missing[d][j] && d != i).collect();
                        if donors.is_empty() {
                            x[i][j] = means[j];
                            continue;
                        }
                        let distances: Vec<_> = donors
                            .iter()
                            .map(|&d| {
                                let mutual: Vec<_> = observed
                                    .iter()
                                    .copied()
                                    .filter(|&c| !missing[d][c])
                                    .collect();
                                if mutual.is_empty() {
                                    return 1e6;
                                }
                                let squared: Vec<_> = mutual
                                    .iter()
                                    .map(|&c| (normalized[i][c] - normalized[d][c]).powi(2))
                                    .collect();
                                (p as f64 / mutual.len() as f64 * stats::numpy_sum(&squared)).sqrt()
                            })
                            .collect();
                        let order = crate::sort::argsort(&distances);
                        let values: Vec<_> = order
                            .iter()
                            .take(k.min(donors.len()))
                            .map(|&d| original[donors[d]][j])
                            .collect();
                        let value = stats::mean(&values, None);
                        x[i][j] = if value.is_nan() {
                            value
                        } else {
                            value.clamp(minima[j], maxima[j])
                        };
                    }
                }
            }
            Ok(json!({"rows":x,"imputed":count,"iterations":0}))
        }
        "em" => {
            if max_iter > 0 && means.iter().any(|v| !v.is_finite()) {
                return Err("EM requires an observed value in every selected column".into());
            }
            for i in 0..n {
                for j in 0..p {
                    if missing[i][j] {
                        x[i][j] = means[j];
                    }
                }
            }
            let (mut mu, centered) = moments(&x);
            let mut covariance = matrix::multiply(&matrix::transpose(&centered), &centered);
            for row in &mut covariance {
                for value in row {
                    *value /= (n - 1) as f64;
                }
            }
            let mut iterations = 0;
            for iteration in 1..=max_iter {
                iterations = iteration;
                let old_mu = mu.clone();
                let old_covariance = covariance.clone();
                for i in 0..n {
                    let absent: Vec<_> = (0..p).filter(|&j| missing[i][j]).collect();
                    if absent.is_empty() {
                        continue;
                    }
                    let observed: Vec<_> = (0..p).filter(|&j| !missing[i][j]).collect();
                    if observed.is_empty() {
                        for &j in &absent {
                            x[i][j] = mu[j];
                        }
                        continue;
                    }
                    let oo: Matrix = observed
                        .iter()
                        .map(|&a| observed.iter().map(|&b| covariance[a][b]).collect())
                        .collect();
                    let mo: Matrix = absent
                        .iter()
                        .map(|&a| observed.iter().map(|&b| covariance[a][b]).collect())
                        .collect();
                    let difference: Matrix = observed
                        .iter()
                        .map(|&j| vec![original[i][j] - mu[j]])
                        .collect();
                    match linalg::pseudoinverse(&oo, 1e-15) {
                        Ok(inverse) => {
                            let offset =
                                matrix::multiply(&matrix::multiply(&mo, &inverse), &difference);
                            for (m, &j) in absent.iter().enumerate() {
                                x[i][j] = (mu[j] + offset[m][0]).clamp(minima[j], maxima[j]);
                            }
                        }
                        Err(_) => {
                            for &j in &absent {
                                x[i][j] = mu[j];
                            }
                        }
                    }
                }
                let (new_mu, centered) = moments(&x);
                mu = new_mu;
                covariance = matrix::multiply(&matrix::transpose(&centered), &centered);
                for row in &mut covariance {
                    for value in row {
                        *value /= n as f64;
                    }
                }
                covariance = matrix::nearest_psd(&covariance, 1e-6)?;
                let mu_change = mu
                    .iter()
                    .zip(old_mu)
                    .map(|(a, b)| (a - b).abs())
                    .fold(0.0, f64::max);
                let cov_change = covariance
                    .iter()
                    .flatten()
                    .zip(old_covariance.iter().flatten())
                    .map(|(a, b)| (a - b).abs())
                    .fold(0.0, f64::max);
                if mu_change.max(cov_change) < tol {
                    break;
                }
            }
            Ok(json!({"rows":x,"imputed":count,"iterations":iterations}))
        }
        _ => Err("Unknown imputation method".into()),
    }
}
