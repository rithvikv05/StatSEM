//! Axis-zero primitives corresponding to core/stats_utils.py and
//! engine/pls/algorithm.py::standardize_matrix. Matrix solvers are not ported yet.

pub fn check_weights(n: usize, weights: Option<&[f64]>) -> Result<(), String> {
    if weights.is_some_and(|w| w.len() != n) {
        return Err("Weight count differs from observation count".into());
    }
    Ok(())
}

// NumPy contiguous f64 reductions use eight accumulators in blocks of 128.
// Axis-zero reductions of a multi-column C-order matrix are sequential instead.
// Preserve this distinction: a rounding difference in a constant column can
// become order-one after dividing by an almost-zero standard deviation.
pub(crate) fn numpy_sum(x: &[f64]) -> f64 {
    numpy_reduce(0, x.len(), &|i| x[i])
}

// Transform values lazily with the same reduction order. This avoids allocating
// temporary product/squared-deviation arrays for every weighted moment.
pub(crate) fn numpy_reduce(start: usize, length: usize, value: &impl Fn(usize) -> f64) -> f64 {
    if length < 8 {
        return (start..start + length).fold(-0.0, |sum, i| sum + value(i));
    }
    if length <= 128 {
        let mut lanes: [f64; 8] = std::array::from_fn(|i| value(start + i));
        let end = length - length % 8;
        for block in (8..end).step_by(8) {
            for (i, lane) in lanes.iter_mut().enumerate() {
                *lane += value(start + block + i);
            }
        }
        let mut sum = ((lanes[0] + lanes[1]) + (lanes[2] + lanes[3]))
            + ((lanes[4] + lanes[5]) + (lanes[6] + lanes[7]));
        for i in end..length {
            sum += value(start + i);
        }
        sum
    } else {
        let half = (length / 2) / 8 * 8;
        numpy_reduce(start, half, value) + numpy_reduce(start + half, length - half, value)
    }
}

pub fn mean(x: &[f64], weights: Option<&[f64]>) -> f64 {
    match weights {
        Some(w) => numpy_reduce(0, x.len(), &|i| x[i] * w[i]) / numpy_sum(w),
        None => numpy_sum(x) / x.len() as f64,
    }
}

pub fn std(x: &[f64], weights: Option<&[f64]>, ddof: usize) -> f64 {
    variance(x, weights, ddof).sqrt()
}

pub fn variance(x: &[f64], weights: Option<&[f64]>, ddof: usize) -> f64 {
    let center = mean(x, weights);
    if let Some(w) = weights {
        let sum = numpy_sum(w);
        let mut variance = numpy_reduce(0, x.len(), &|i| (w[i] / sum) * (x[i] - center).powi(2));
        if ddof > 0 {
            let effective_n = sum.powi(2) / numpy_reduce(0, w.len(), &|i| w[i] * w[i]);
            if effective_n > ddof as f64 {
                variance *= effective_n / (effective_n - ddof as f64);
            }
        }
        // np.maximum propagates NaN; f64::max alone does not.
        if variance.is_nan() {
            f64::NAN
        } else {
            variance.max(0.0)
        }
    } else {
        numpy_reduce(0, x.len(), &|i| (x[i] - center).powi(2))
            / (x.len().saturating_sub(ddof)) as f64
    }
}

pub fn correlation(x: &[f64], y: &[f64], weights: Option<&[f64]>) -> f64 {
    let mx = mean(x, weights);
    let my = mean(y, weights);
    let mut vx = 0.0;
    let mut vy = 0.0;
    let mut covariance = 0.0;
    let weight_sum = weights.map(numpy_sum).unwrap_or(x.len() as f64);
    for i in 0..x.len() {
        let w = weights.map(|w| w[i]).unwrap_or(1.0) / weight_sum;
        let dx = x[i] - mx;
        let dy = y[i] - my;
        vx += w * dx * dx;
        vy += w * dy * dy;
        covariance += w * dx * dy;
    }
    if weights.is_some() {
        if vx <= 1e-12 || vy <= 1e-12 {
            return 0.0;
        }
        covariance / (vx * vy).sqrt()
    } else {
        // NumPy corrcoef divides sequentially and clips real correlations.
        let result = covariance / vx.sqrt() / vy.sqrt();
        if result.is_nan() {
            result
        } else {
            result.clamp(-1.0, 1.0)
        }
    }
}

pub fn standardize(x: &[Vec<f64>], weights: Option<&[f64]>) -> Result<Vec<Vec<f64>>, String> {
    check_weights(x.len(), weights)?;
    let columns = x.first().map_or(0, Vec::len);
    if x.iter().any(|row| row.len() != columns) {
        return Err("Ragged matrix".into());
    }
    let mut result = vec![vec![0.0; columns]; x.len()];
    let mut column = Vec::with_capacity(x.len());
    for j in 0..columns {
        column.clear();
        column.extend(x.iter().map(|row| row[j]));
        let (center, scale) = if columns == 1 {
            (mean(&column, weights), std(&column, weights, 0))
        } else {
            let divisor = weights.map(numpy_sum).unwrap_or(x.len() as f64);
            let center = column.iter().enumerate().fold(0.0, |sum, (i, v)| {
                sum + v * weights.map(|w| w[i]).unwrap_or(1.0)
            }) / divisor;
            let variance = column.iter().enumerate().fold(0.0, |sum, (i, v)| {
                let squared = (v - center).powi(2);
                sum + if let Some(w) = weights {
                    (w[i] / divisor) * squared
                } else {
                    squared
                }
            });
            let variance = if weights.is_none() {
                variance / divisor
            } else {
                variance
            };
            (
                center,
                if variance.is_nan() {
                    f64::NAN
                } else {
                    variance.max(0.0).sqrt()
                },
            )
        };
        let scale = if scale == 0.0 { 1.0 } else { scale };
        for (i, value) in column.iter().enumerate() {
            result[i][j] = (value - center) / scale;
        }
    }
    Ok(result)
}

pub type CorrelationMatrices = (Vec<Vec<f64>>, Vec<Vec<usize>>);
pub fn pairwise_correlation(x: &[Vec<Option<f64>>]) -> Result<CorrelationMatrices, String> {
    let columns = x.first().map_or(0, Vec::len);
    if x.iter().any(|row| row.len() != columns) {
        return Err("Ragged matrix".into());
    }
    let mut r = vec![vec![0.0; columns]; columns];
    let mut n = vec![vec![0; columns]; columns];
    for i in 0..columns {
        r[i][i] = 1.0;
        n[i][i] = x.iter().filter(|row| row[i].is_some()).count();
        for j in i + 1..columns {
            let pairs: Vec<_> = x.iter().filter_map(|row| row[i].zip(row[j])).collect();
            n[i][j] = pairs.len();
            n[j][i] = pairs.len();
            if pairs.len() >= 3 {
                let a: Vec<_> = pairs.iter().map(|p| p.0).collect();
                let b: Vec<_> = pairs.iter().map(|p| p.1).collect();
                let value = correlation(&a, &b, None);
                r[i][j] = if value.is_nan() { 0.0 } else { value };
                r[j][i] = r[i][j];
            }
        }
    }
    Ok((r, n))
}
