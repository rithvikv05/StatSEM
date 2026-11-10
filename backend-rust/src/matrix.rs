//! Shared dense matrix operations used by fit, PLSc and imputation.
pub type Matrix = Vec<Vec<f64>>;

pub fn identity(n: usize) -> Matrix {
    (0..n)
        .map(|i| (0..n).map(|j| if i == j { 1.0 } else { 0.0 }).collect())
        .collect()
}
pub fn transpose(a: &[Vec<f64>]) -> Matrix {
    (0..a.first().map_or(0, Vec::len))
        .map(|j| a.iter().map(|r| r[j]).collect())
        .collect()
}
pub fn multiply(a: &[Vec<f64>], b: &[Vec<f64>]) -> Matrix {
    let columns = b.first().map_or(0, Vec::len);
    let mut result = vec![vec![0.0; columns]; a.len()];
    for (i, row) in a.iter().enumerate() {
        for (k, &value) in row.iter().enumerate() {
            for j in 0..columns {
                result[i][j] += value * b[k][j];
            }
        }
    }
    result
}
pub fn correlation_rows(rows: &[Vec<f64>]) -> Matrix {
    let columns = transpose(rows);
    columns
        .iter()
        .map(|x| {
            columns
                .iter()
                .map(|y| crate::stats::correlation(x, y, None))
                .collect()
        })
        .collect()
}
pub fn nearest_psd(a: &[Vec<f64>], epsilon: f64) -> Result<Matrix, String> {
    let n = a.len();
    let symmetric: Matrix = (0..n)
        .map(|i| (0..n).map(|j| (a[i][j] + a[j][i]) / 2.0).collect())
        .collect();
    let (eigenvalues, vectors) = crate::linalg::symmetric_eigen(&symmetric)?;
    let mut scaled = vectors.clone();
    for row in &mut scaled {
        for (v, &eigenvalue) in row.iter_mut().zip(&eigenvalues) {
            *v *= eigenvalue.max(epsilon);
        }
    }
    let mut result = multiply(&scaled, &transpose(&vectors));
    let diagonal: Vec<_> = (0..n)
        .map(|i| {
            let value = result[i][i].sqrt();
            if value == 0.0 {
                1.0
            } else {
                value
            }
        })
        .collect();
    for i in 0..n {
        for j in 0..n {
            result[i][j] /= diagonal[i] * diagonal[j];
        }
    }
    Ok(result)
}

/// Decimal rounding follows Python's round on the represented binary float.
pub fn round(value: f64, digits: usize) -> f64 {
    format!("{value:.digits$}").parse().unwrap_or(value)
}
