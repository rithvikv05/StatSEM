//! Bootstrap interval and distribution helpers, independent of resampling.
use crate::stats;
use serde_json::{json, Value};

extern "C" {
    fn erfc(x: f64) -> f64;
    fn lgamma(x: f64) -> f64;
}
pub fn normal_cdf(x: f64) -> f64 {
    // SAFETY: libm functions accept every f64 value and retain no pointers.
    unsafe { 0.5 * erfc(-x / std::f64::consts::SQRT_2) }
}
pub fn normal_ppf(p: f64) -> f64 {
    if p == 0.0 {
        return f64::NEG_INFINITY;
    }
    if p == 1.0 {
        return f64::INFINITY;
    }
    if !(0.0..1.0).contains(&p) {
        return f64::NAN;
    }
    let target = if p > 0.5 { 1.0 - p } else { p };
    let mut low = -40.0;
    let mut high = 0.0;
    for _ in 0..100 {
        let mid = (low + high) / 2.0;
        if mid == low || mid == high {
            break;
        }
        if normal_cdf(mid) < target {
            low = mid;
        } else {
            high = mid;
        }
    }
    let result = (low + high) / 2.0;
    if p > 0.5 {
        -result
    } else {
        result
    }
}
fn beta_fraction(a: f64, b: f64, x: f64) -> f64 {
    let qab = a + b;
    let qap = a + 1.0;
    let qam = a - 1.0;
    let tiny = 1e-300;
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < tiny {
        d = tiny;
    }
    d = 1.0 / d;
    let mut result = d;
    for m in 1..=10000 {
        let m = m as f64;
        let m2 = 2.0 * m;
        for (step, coefficient) in [
            m * (b - m) * x / ((qam + m2) * (a + m2)),
            -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)),
        ]
        .into_iter()
        .enumerate()
        {
            d = 1.0 + coefficient * d;
            if d.abs() < tiny {
                d = tiny;
            }
            c = 1.0 + coefficient / c;
            if c.abs() < tiny {
                c = tiny;
            }
            d = 1.0 / d;
            let delta = d * c;
            result *= delta;
            if step == 1 && (delta - 1.0).abs() < 3e-15 {
                return result;
            }
        }
    }
    result
}
pub fn regularized_beta(a: f64, b: f64, x: f64) -> f64 {
    if a <= 0.0 || b <= 0.0 || !(0.0..=1.0).contains(&x) {
        return f64::NAN;
    }
    if x == 0.0 || x == 1.0 {
        return x;
    }
    // SAFETY: positive gamma arguments, scalar libm function.
    let half_partner = if a == 0.5 {
        b
    } else if b == 0.5 {
        a
    } else {
        0.0
    };
    let log_beta = if half_partner > 100.0 {
        // Gamma-ratio expansion avoids catastrophic cancellation of lgamma
        // terms for high Student-t degrees of freedom.
        let z = half_partner;
        0.5 * std::f64::consts::PI.ln() - 0.5 * z.ln() + 1.0 / (8.0 * z) - 1.0 / (192.0 * z.powi(3))
            + 1.0 / (640.0 * z.powi(5))
            - 17.0 / (14336.0 * z.powi(7))
    } else {
        unsafe { lgamma(a) + lgamma(b) - lgamma(a + b) }
    };
    let front = (a * x.ln() + b * (-x).ln_1p() - log_beta).exp();
    if x < (a + 1.0) / (a + b + 2.0) {
        front * beta_fraction(a, b, x) / a
    } else {
        1.0 - front * beta_fraction(b, a, 1.0 - x) / b
    }
}
pub fn student_t_cdf(t: f64, df: f64) -> f64 {
    if df <= 0.0 || t.is_nan() {
        return f64::NAN;
    }
    if t == 0.0 {
        return 0.5;
    }
    if t.abs() <= df.sqrt() {
        let central = 0.5 * regularized_beta(0.5, df / 2.0, t * t / (df + t * t));
        if t > 0.0 {
            0.5 + central
        } else {
            0.5 - central
        }
    } else {
        let tail = 0.5 * regularized_beta(df / 2.0, 0.5, df / (df + t * t));
        if t > 0.0 {
            1.0 - tail
        } else {
            tail
        }
    }
}

/// Noncentral-beta CDF as a normalized Poisson mixture, starting at its mode.
/// Relative weights avoid underflow and log-gamma cancellation. See the
/// mathematical mixture described by Boost's noncentral-beta documentation:
/// https://www.boost.org/doc/libs/latest/libs/math/doc/html/math_toolkit/dist_ref/dists/nc_beta_dist.html
fn noncentral_beta(
    x: f64,
    q: f64,
    a: f64,
    b: f64,
    lambda: f64,
    complement_argument: bool,
) -> Result<f64, String> {
    let beta = |j: usize| {
        if complement_argument {
            1.0 - regularized_beta(b, a + j as f64, q)
        } else {
            regularized_beta(a + j as f64, b, x)
        }
    };
    if lambda == 0.0 {
        return Ok(beta(0));
    }
    let mu = lambda / 2.0;
    if !mu.is_finite() || mu > usize::MAX as f64 {
        return Err("Noncentrality exceeds native distribution range".into());
    }
    let mode = mu.floor() as usize;
    struct Sum {
        value: f64,
        error: f64,
    }
    impl Sum {
        fn add(&mut self, x: f64) {
            let adjusted = x - self.error;
            let total = self.value + adjusted;
            self.error = (total - self.value) - adjusted;
            self.value = total;
        }
    }
    let mut mass = Sum {
        value: 1.0,
        error: 0.0,
    };
    let mut probability = Sum {
        value: beta(mode),
        error: 0.0,
    };
    let mut weight = 1.0;
    let mut j = mode;
    let mut iterations = 0usize;
    while j > 0 {
        weight *= j as f64 / mu;
        j -= 1;
        mass.add(weight);
        probability.add(weight * beta(j));
        iterations += 1;
        let ratio = j as f64 / mu;
        if ratio < 1.0 && weight * ratio / (1.0 - ratio) < 1e-16 * mass.value {
            break;
        }
        if iterations > 1_000_000 {
            return Err("Noncentral-beta lower-tail series did not converge".into());
        }
    }
    weight = 1.0;
    j = mode;
    iterations = 0;
    loop {
        j = j
            .checked_add(1)
            .ok_or("Noncentral-beta series index overflow")?;
        weight *= mu / j as f64;
        mass.add(weight);
        probability.add(weight * beta(j));
        iterations += 1;
        let ratio = mu / (j as f64 + 1.0);
        if ratio < 1.0 && weight * ratio / (1.0 - ratio) < 1e-16 * mass.value {
            break;
        }
        if iterations > 1_000_000 {
            return Err("Noncentral-beta upper-tail series did not converge".into());
        }
    }
    Ok((probability.value / mass.value).clamp(0.0, 1.0))
}
pub fn noncentral_f_cdf(f: f64, dfn: f64, dfd: f64, lambda: f64) -> Result<f64, String> {
    if dfn <= 0.0
        || dfd <= 0.0
        || lambda < 0.0
        || [dfn, dfd, lambda].iter().any(|v| !v.is_finite())
        || f.is_nan()
    {
        return Err("Invalid noncentral-F parameters".into());
    }
    if f <= 0.0 {
        return Ok(0.0);
    }
    let z = f * (dfn / dfd);
    let (x, q) = if z <= 1.0 {
        let x = z / (1.0 + z);
        (x, 1.0 - x)
    } else {
        let q = 1.0 / (1.0 + z);
        (1.0 - q, q)
    };
    noncentral_beta(x, q, dfn / 2.0, dfd / 2.0, lambda, z > 1.0)
}
fn beta_quantile(a: f64, b: f64, p: f64) -> f64 {
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..256 {
        let mid = (low + high) / 2.0;
        if mid == low || mid == high {
            break;
        }
        if regularized_beta(a, b, mid) < p {
            low = mid;
        } else {
            high = mid;
        }
    }
    (low + high) / 2.0
}
pub fn regression_power(dfn: f64, dfd: f64, lambda: f64, alpha: f64) -> Result<f64, String> {
    if !(0.0..1.0).contains(&alpha) || alpha == 0.0 {
        return Err("Power alpha must lie between zero and one".into());
    }
    let a = dfn / 2.0;
    let b = dfd / 2.0;
    let x = beta_quantile(a, b, 1.0 - alpha);
    let (x, q, complement) = if x > 0.5 {
        let q = beta_quantile(b, a, alpha);
        (1.0 - q, q, true)
    } else {
        (x, 1.0 - x, false)
    };
    Ok((1.0 - noncentral_beta(x, q, a, b, lambda, complement)?).clamp(0.0, 1.0))
}

pub fn percentile(sorted: &[f64], p: f64) -> f64 {
    let index = p.clamp(0.0, 1.0) * (sorted.len() - 1) as f64;
    let lower = index.floor() as usize;
    let upper = index.ceil() as usize;
    let fraction = index - lower as f64;
    let difference = sorted[upper] - sorted[lower];
    if fraction >= 0.5 {
        sorted[upper] - difference * (1.0 - fraction)
    } else {
        sorted[lower] + difference * fraction
    }
}
pub fn intervals(
    original: f64,
    sample: &[f64],
    jackknife: Option<&[f64]>,
    alpha: f64,
    tails: &str,
) -> Result<Value, String> {
    if !(0.0..1.0).contains(&alpha)
        || (tails != "one" && tails != "two")
        || sample.iter().any(|v| !v.is_finite())
    {
        return Err("Invalid interval inputs".into());
    }
    if sample.is_empty() {
        return Ok(json!({"percentile":[0.0,0.0],"bias_corrected":[0.0,0.0],"bca":[0.0,0.0]}));
    }
    let mut sorted = sample.to_vec();
    sorted.sort_by(f64::total_cmp);
    let low = if tails == "one" { alpha } else { alpha / 2.0 };
    let high = 1.0 - low;
    let plain = [percentile(&sorted, low), percentile(&sorted, high)];
    let b = sample.len() as f64;
    let below = sample.iter().filter(|v| **v < original).count() as f64 / b;
    let z0 = normal_ppf(below.clamp(1.0 / (2.0 * b), 1.0 - 1.0 / (2.0 * b)));
    let bc = [low, high].map(|p| percentile(&sorted, normal_cdf(2.0 * z0 + normal_ppf(p))));
    let mut acceleration = 0.0;
    if let Some(j) = jackknife.filter(|j| j.len() > 1) {
        let mean = stats::mean(j, None);
        let numerator = stats::numpy_reduce(0, j.len(), &|i| (mean - j[i]).powi(3));
        let denominator =
            6.0 * stats::numpy_reduce(0, j.len(), &|i| (mean - j[i]).powi(2)).powf(1.5);
        if denominator.abs() > 1e-12 {
            acceleration = numerator / denominator;
        }
    }
    let bca = [low, high].map(|p| {
        let z = normal_ppf(p);
        let mut denominator = 1.0 - acceleration * (z0 + z);
        if denominator.abs() < 1e-6 {
            denominator = if denominator >= 0.0 { 1e-6 } else { -1e-6 };
        }
        percentile(&sorted, normal_cdf(z0 + (z0 + z) / denominator))
    });
    Ok(json!({"percentile":plain,"bias_corrected":bc,"bca":bca}))
}
