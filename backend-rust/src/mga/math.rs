//! Phase 2 — Shared math utilities, Lentz regularized incomplete beta / Student's t-CDF,
//! binary search counting, and seeded Fisher-Yates shuffling.
use std::time::{SystemTime, UNIX_EPOCH};

extern "C" {
    fn lgamma(x: f64) -> f64;
}

/// Deterministic 64-bit seeded RNG (SplitMix64 state mixer + Xorshift64* output).
/// Consecutive integer seeds `seed + u` are thoroughly mixed on initialization so
/// parallel workers receive independent streams.
#[derive(Clone, Debug)]
pub struct SeededRng {
    state: u64,
}

impl SeededRng {
    pub fn from_seed(seed: u64) -> Self {
        let mut z = seed.wrapping_add(0x9e37_79b9_7f4a_7c15);
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^= z >> 31;
        if z == 0 {
            z = 0x9e37_79b9_7f4a_7c15;
        }
        Self { state: z }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// Unbiased uniform integer in `[0, bound)`.
    pub fn next_usize(&mut self, bound: usize) -> usize {
        if bound <= 1 {
            return 0;
        }
        let b = bound as u64;
        let threshold = b.wrapping_neg() % b;
        loop {
            let r = self.next_u64();
            if r >= threshold {
                return (r % b) as usize;
            }
        }
    }
}

/// Generate a fresh non-zero random 64-bit seed using OS entropy (falling back to clock nanos).
pub fn random_seed() -> u64 {
    #[cfg(unix)]
    {
        use std::io::Read;
        let mut buf = [0u8; 8];
        if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
            if f.read_exact(&mut buf).is_ok() {
                let val = u64::from_le_bytes(buf);
                if val != 0 {
                    // Keep seed friendly to JS safe integers (<= 2^53 - 1) so UI round-trips cleanly.
                    return (val & 0x001f_ffff_ffff_ffff).max(1);
                }
            }
        }
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(123456);
    (nanos & 0x001f_ffff_ffff_ffff).max(1)
}

pub fn mean(x: &[f64]) -> f64 {
    if x.is_empty() {
        return f64::NAN;
    }
    x.iter().sum::<f64>() / x.len() as f64
}

pub fn variance(x: &[f64], ddof: usize) -> f64 {
    if x.len() <= ddof {
        return f64::NAN;
    }
    let m = mean(x);
    let ss: f64 = x.iter().map(|&v| (v - m) * (v - m)).sum();
    ss / (x.len() - ddof) as f64
}

pub fn std_dev(x: &[f64], ddof: usize) -> f64 {
    let v = variance(x, ddof);
    if v.is_nan() {
        f64::NAN
    } else {
        v.max(0.0).sqrt()
    }
}

/// Linear interpolation percentile on an already-sorted slice; p in [0, 1].
/// pos = p * (n - 1); lo = floor(pos); hi = ceil(pos);
/// return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo)
pub fn percentile(sorted_array: &[f64], p: f64) -> f64 {
    if sorted_array.is_empty() {
        return f64::NAN;
    }
    if sorted_array.len() == 1 {
        return sorted_array[0];
    }
    let p = p.clamp(0.0, 1.0);
    let pos = p * (sorted_array.len() - 1) as f64;
    let lo = pos.floor() as usize;
    let hi = pos.ceil() as usize;
    if lo == hi {
        return sorted_array[lo];
    }
    sorted_array[lo] + (sorted_array[hi] - sorted_array[lo]) * (pos - lo as f64)
}

/// Pearson correlation between `x` and `y`.
pub fn correlation(x: &[f64], y: &[f64]) -> f64 {
    if x.len() != y.len() || x.len() < 2 {
        return f64::NAN;
    }
    let mx = mean(x);
    let my = mean(y);
    let mut sxx = 0.0;
    let mut syy = 0.0;
    let mut sxy = 0.0;
    for (&xi, &yi) in x.iter().zip(y.iter()) {
        let dx = xi - mx;
        let dy = yi - my;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
    }
    if sxx <= 0.0 || syy <= 0.0 {
        return f64::NAN;
    }
    (sxy / (sxx * syy).sqrt()).clamp(-1.0, 1.0)
}

/// Numerical Recipes `betacf` — modified Lentz continued-fraction evaluation for incomplete beta.
pub fn betacf(a: f64, b: f64, x: f64) -> f64 {
    const MAXIT: usize = 10_000;
    const EPS: f64 = 3e-15;
    const FPMIN: f64 = 1e-300;

    let qab = a + b;
    let qap = a + 1.0;
    let qam = a - 1.0;

    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < FPMIN {
        d = FPMIN;
    }
    d = 1.0 / d;
    let mut h = d;

    for m in 1..=MAXIT {
        let mf = m as f64;
        let m2 = 2.0 * mf;

        // Even step
        let aa = mf * (b - mf) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < FPMIN {
            d = FPMIN;
        }
        c = 1.0 + aa / c;
        if c.abs() < FPMIN {
            c = FPMIN;
        }
        d = 1.0 / d;
        h *= d * c;

        // Odd step
        let aa = -(a + mf) * (qab + mf) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if d.abs() < FPMIN {
            d = FPMIN;
        }
        c = 1.0 + aa / c;
        if c.abs() < FPMIN {
            c = FPMIN;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() <= EPS {
            break;
        }
    }
    h
}

/// Regularized incomplete beta function I_x(a, b).
pub fn regularized_incomplete_beta(a: f64, b: f64, x: f64) -> f64 {
    if a <= 0.0 || b <= 0.0 || !(0.0..=1.0).contains(&x) || x.is_nan() {
        return f64::NAN;
    }
    if x == 0.0 || x == 1.0 {
        return x;
    }
    let half_partner = if (a - 0.5).abs() < 1e-12 {
        b
    } else if (b - 0.5).abs() < 1e-12 {
        a
    } else {
        0.0
    };
    let log_beta = if half_partner > 100.0 {
        // Asymptotic expansion of log B(0.5, z) avoids lgamma cancellation for large df.
        let z = half_partner;
        0.5 * std::f64::consts::PI.ln() - 0.5 * z.ln() + 1.0 / (8.0 * z)
            - 1.0 / (192.0 * z.powi(3))
            + 1.0 / (640.0 * z.powi(5))
            - 17.0 / (14336.0 * z.powi(7))
    } else {
        unsafe { lgamma(a) + lgamma(b) - lgamma(a + b) }
    };
    let bt = (a * x.ln() + b * (-x).ln_1p() - log_beta).exp();
    if x < (a + 1.0) / (a + b + 2.0) {
        bt * betacf(a, b, x) / a
    } else {
        1.0 - bt * betacf(b, a, 1.0 - x) / b
    }
}

/// Student's t cumulative distribution function accepting real-valued `df > 0`.
pub fn student_t_cdf(t: f64, df: f64) -> f64 {
    if df <= 0.0 || t.is_nan() || df.is_nan() {
        return f64::NAN;
    }
    if t == 0.0 {
        return 0.5;
    }
    if t.is_infinite() {
        return if t.is_sign_positive() { 1.0 } else { 0.0 };
    }
    let x = df / (df + t * t);
    let ibeta = regularized_incomplete_beta(df / 2.0, 0.5, x);
    let tail = 0.5 * ibeta;
    if t > 0.0 {
        1.0 - tail
    } else {
        tail
    }
}

/// twoTailedP_t(t, df) = 2 * (1 - studentTCdf(abs(t), df))
pub fn two_tailed_p_t(t: f64, df: f64) -> f64 {
    (2.0 * (1.0 - student_t_cdf(t.abs(), df))).clamp(0.0, 1.0)
}

/// One-tailed upper p-value: 1 - studentTCdf(abs(t), df)
pub fn one_tailed_p_t(t: f64, df: f64) -> f64 {
    (1.0 - student_t_cdf(t.abs(), df)).clamp(0.0, 1.0)
}

/// Fisher-Yates in-place shuffle using the seeded RNG.
pub fn shuffle_in_place<T>(array: &mut [T], rng: &mut SeededRng) {
    for i in (1..array.len()).rev() {
        let j = rng.next_usize(i + 1);
        array.swap(i, j);
    }
}

/// Number of elements strictly less than `v` in a sorted slice, via binary search.
pub fn sorted_lower_count(sorted_arr: &[f64], v: f64) -> usize {
    sorted_arr.partition_point(|&x| x < v)
}

/// Number of elements less than or equal to `v` in a sorted slice, via binary search.
pub fn sorted_upper_count(sorted_arr: &[f64], v: f64) -> usize {
    sorted_arr.partition_point(|&x| x <= v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase2_moments_and_correlation() {
        let x = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
        assert!((mean(&x) - 5.0).abs() < 1e-12);
        assert!((variance(&x, 0) - 4.0).abs() < 1e-12);
        assert!((std_dev(&x, 0) - 2.0).abs() < 1e-12);
        assert!((variance(&x, 1) - 32.0 / 7.0).abs() < 1e-12);
        assert!((std_dev(&x, 1) - (32.0f64 / 7.0).sqrt()).abs() < 1e-12);

        let y = [4.0, 8.0, 8.0, 8.0, 10.0, 10.0, 14.0, 18.0];
        assert!((correlation(&x, &y) - 1.0).abs() < 1e-12);
        let z: Vec<f64> = y.iter().map(|v| -v).collect();
        assert!((correlation(&x, &z) + 1.0).abs() < 1e-12);
    }

    #[test]
    fn phase2_percentile_exact_spec_cases() {
        assert!((percentile(&[1.0, 2.0, 3.0, 4.0, 5.0], 0.25) - 2.0).abs() < 1e-12);
        assert!((percentile(&[1.0, 2.0, 3.0, 4.0], 0.5) - 2.5).abs() < 1e-12);
        assert!((percentile(&[10.0], 0.5) - 10.0).abs() < 1e-12);
    }

    #[test]
    fn phase2_student_t_cdf_exact_spec_cases() {
        let p1 = two_tailed_p_t(2.0, 10.0);
        assert!((p1 - 0.0734).abs() < 0.001, "expected ~0.0734, got {p1}");

        let p2 = two_tailed_p_t(1.96, 1000.0);
        assert!((p2 - 0.0502).abs() < 0.001, "expected ~0.0502, got {p2}");

        // Non-integer df (Welch-Satterthwaite)
        let p3 = two_tailed_p_t(1.9146, 150.02);
        assert!((p3 - 0.0574).abs() < 0.001, "expected ~0.0574, got {p3}");
    }

    #[test]
    fn phase2_binary_search_counts_and_shuffle() {
        let arr = [1.0, 2.0, 2.0, 3.0, 5.0];
        assert_eq!(sorted_lower_count(&arr, 2.0), 1);
        assert_eq!(sorted_upper_count(&arr, 2.0), 3);
        assert_eq!(sorted_lower_count(&arr, 1.0), 0);
        assert_eq!(sorted_upper_count(&arr, 5.0), 5);
        assert_eq!(sorted_lower_count(&arr, 6.0), 5);

        let mut a1: Vec<usize> = (0..50).collect();
        let mut a2: Vec<usize> = (0..50).collect();
        let mut r1 = SeededRng::from_seed(12345);
        let mut r2 = SeededRng::from_seed(12345);
        shuffle_in_place(&mut a1, &mut r1);
        shuffle_in_place(&mut a2, &mut r2);
        assert_eq!(a1, a2);
        assert_ne!(a1, (0..50).collect::<Vec<_>>());
    }
}

