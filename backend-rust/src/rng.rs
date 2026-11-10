//! NumPy-compatible default SeedSequence/PCG64 and bounded integer draws.
//! Derived from NumPy v2.3.4 reference algorithms; verified against the pinned
//! installed NumPy oracle, not assumed compatible solely from seed equality.
//! Attribution and license terms: ../THIRD_PARTY_NOTICES.md.

fn hashmix(mut value: u32, constant: &mut u32) -> u32 {
    value ^= *constant;
    *constant = constant.wrapping_mul(0x931e8875);
    value = value.wrapping_mul(*constant);
    value ^ (value >> 16)
}
fn mix(x: u32, y: u32) -> u32 {
    let result = 0xca01f9ddu32
        .wrapping_mul(x)
        .wrapping_sub(0x4973f715u32.wrapping_mul(y));
    result ^ (result >> 16)
}
pub fn seed_sequence(entropy: &[u32], words: usize) -> Vec<u32> {
    let mut pool = [0u32; 4];
    let mut constant = 0x43b0d7e5;
    for (i, value) in pool.iter_mut().enumerate() {
        *value = hashmix(entropy.get(i).copied().unwrap_or(0), &mut constant);
    }
    for source in 0..4 {
        for target in 0..4 {
            if source != target {
                pool[target] = mix(pool[target], hashmix(pool[source], &mut constant));
            }
        }
    }
    for &word in entropy.iter().skip(4) {
        for value in &mut pool {
            *value = mix(*value, hashmix(word, &mut constant));
        }
    }
    let mut constant = 0x8b51f9ddu32;
    (0..words)
        .map(|i| {
            let value = pool[i % 4] ^ constant;
            constant = constant.wrapping_mul(0x58f38ded);
            let value = value.wrapping_mul(constant);
            value ^ (value >> 16)
        })
        .collect()
}
pub fn integer_entropy(mut seed: u64) -> Vec<u32> {
    let mut words = vec![seed as u32];
    seed >>= 32;
    if seed != 0 {
        words.push(seed as u32);
    }
    words
}
pub struct Pcg64 {
    state: u128,
    increment: u128,
    buffered: Option<u32>,
}
impl Pcg64 {
    pub fn from_optional_seed(seed: Option<u64>) -> Result<Self, String> {
        if let Some(seed) = seed {
            return Ok(Self::new(&integer_entropy(seed)));
        }
        #[cfg(unix)]
        {
            use std::io::Read;
            let mut bytes = [0u8; 16];
            std::fs::File::open("/dev/urandom")
                .and_then(|mut file| file.read_exact(&mut bytes))
                .map_err(|e| e.to_string())?;
            let entropy: Vec<_> = bytes
                .as_chunks::<4>()
                .0
                .iter()
                .map(|word| u32::from_le_bytes(*word))
                .collect();
            Ok(Self::new(&entropy))
        }
        #[cfg(not(unix))]
        {
            Err("OS entropy provider for this target has not been configured".into())
        }
    }
    pub fn new(entropy: &[u32]) -> Self {
        let words = seed_sequence(entropy, 8);
        let values: Vec<u64> = words
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| pair[0] as u64 | ((pair[1] as u64) << 32))
            .collect();
        let initial = ((values[0] as u128) << 64) | values[1] as u128;
        let sequence = ((values[2] as u128) << 64) | values[3] as u128;
        let mut rng = Self {
            state: 0,
            increment: sequence.wrapping_shl(1) | 1,
            buffered: None,
        };
        rng.step();
        rng.state = rng.state.wrapping_add(initial);
        rng.step();
        rng
    }
    fn step(&mut self) {
        const MULTIPLIER: u128 = ((2549297995355413924u128) << 64) | 4865540595714422341u128;
        self.state = self
            .state
            .wrapping_mul(MULTIPLIER)
            .wrapping_add(self.increment);
    }
    pub fn next_u64(&mut self) -> u64 {
        self.step();
        ((self.state >> 64) as u64 ^ self.state as u64).rotate_right((self.state >> 122) as u32)
    }
    pub fn next_u32(&mut self) -> u32 {
        if let Some(value) = self.buffered.take() {
            return value;
        }
        let value = self.next_u64();
        self.buffered = Some((value >> 32) as u32);
        value as u32
    }
    pub fn uniform(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / 9007199254740992.0)
    }
    pub fn normal(&mut self) -> f64 {
        use crate::ziggurat::*;
        loop {
            let mut r = self.next_u64();
            let i = (r & 0xff) as usize;
            r >>= 8;
            let sign = r & 1;
            let absolute = (r >> 1) & 0x000f_ffff_ffff_ffff;
            let mut x = absolute as f64 * f64::from_bits(WI_DOUBLE[i]);
            if sign != 0 {
                x = -x;
            }
            if absolute < KI_DOUBLE[i] {
                return x;
            }
            if i == 0 {
                loop {
                    let xx = -ZIGGURAT_NOR_INV_R * (-self.uniform()).ln_1p();
                    let yy = -(-self.uniform()).ln_1p();
                    if yy + yy > xx * xx {
                        let value = ZIGGURAT_NOR_R + xx;
                        return if (absolute >> 8) & 1 != 0 {
                            -value
                        } else {
                            value
                        };
                    }
                }
            } else if (f64::from_bits(FI_DOUBLE[i - 1]) - f64::from_bits(FI_DOUBLE[i]))
                * self.uniform()
                + f64::from_bits(FI_DOUBLE[i])
                < (-0.5 * x * x).exp()
            {
                return x;
            }
        }
    }
    pub fn exponential(&mut self) -> f64 {
        use crate::ziggurat::*;
        loop {
            let mut r = self.next_u64() >> 3;
            let i = (r & 0xff) as usize;
            r >>= 8;
            let x = r as f64 * f64::from_bits(WE_DOUBLE[i]);
            if r < KE_DOUBLE[i] {
                return x;
            }
            if i == 0 {
                return ZIGGURAT_EXP_R - (-self.uniform()).ln_1p();
            }
            if (f64::from_bits(FE_DOUBLE[i - 1]) - f64::from_bits(FE_DOUBLE[i])) * self.uniform()
                + f64::from_bits(FE_DOUBLE[i])
                < (-x).exp()
            {
                return x;
            }
        }
    }
    pub fn gamma(&mut self, shape: f64) -> Result<f64, String> {
        if shape < 0.0 || !shape.is_finite() {
            return Err("Gamma shape must be nonnegative and finite".into());
        }
        if shape == 1.0 {
            return Ok(self.exponential());
        }
        if shape == 0.0 {
            return Ok(0.0);
        }
        if shape < 1.0 {
            loop {
                let u = self.uniform();
                let v = self.exponential();
                if u <= 1.0 - shape {
                    let x = u.powf(1.0 / shape);
                    if x <= v {
                        return Ok(x);
                    }
                } else {
                    let y = -((1.0 - u) / shape).ln();
                    let x = (1.0 - shape + shape * y).powf(1.0 / shape);
                    if x <= v + y {
                        return Ok(x);
                    }
                }
            }
        }
        let b = shape - 1.0 / 3.0;
        let c = 1.0 / (9.0 * b).sqrt();
        loop {
            let (x, mut v) = loop {
                let x = self.normal();
                let v = 1.0 + c * x;
                if v > 0.0 {
                    break (x, v);
                }
            };
            v = v * v * v;
            let u = self.uniform();
            if u < 1.0 - 0.0331 * (x * x) * (x * x) || u.ln() < 0.5 * x * x + b * (1.0 - v + v.ln())
            {
                return Ok(b * v);
            }
        }
    }
    pub fn dirichlet_ones(&mut self, dimensions: usize) -> Result<Vec<f64>, String> {
        if dimensions == 0 {
            return Err("Dirichlet requires at least one component".into());
        }
        let mut values = Vec::with_capacity(dimensions);
        let mut sum = 0.0;
        for _ in 0..dimensions {
            let value = self.exponential();
            sum += value;
            values.push(value);
        }
        let inverse = 1.0 / sum;
        for value in &mut values {
            *value *= inverse;
        }
        Ok(values)
    }
    pub fn permutation(&mut self, n: usize) -> Vec<usize> {
        let mut result: Vec<_> = (0..n).collect();
        for i in (1..n).rev() {
            let maximum = i as u64;
            let mut mask = maximum;
            for shift in [1, 2, 4, 8, 16, 32] {
                mask |= mask >> shift;
            }
            let selected = loop {
                let bits = if maximum <= u32::MAX as u64 {
                    self.next_u32() as u64
                } else {
                    self.next_u64()
                };
                let value = bits & mask;
                if value <= maximum {
                    break value as usize;
                }
            };
            result.swap(i, selected);
        }
        result
    }
    pub fn bounded(&mut self, bound: u64) -> Result<u64, String> {
        if bound == 0 {
            return Err("Integer upper bound must be positive".into());
        }
        if bound == 1 {
            return Ok(0);
        }
        if bound <= (1u64 << 32) {
            if bound == 1u64 << 32 {
                return Ok(self.next_u32() as u64);
            }
            let bound32 = bound as u32;
            let threshold = bound32.wrapping_neg() % bound32;
            loop {
                let product = (self.next_u32() as u64) * bound;
                if product as u32 >= threshold {
                    return Ok(product >> 32);
                }
            }
        }
        let threshold = bound.wrapping_neg() % bound;
        loop {
            let product = (self.next_u64() as u128) * (bound as u128);
            if product as u64 >= threshold {
                return Ok((product >> 64) as u64);
            }
        }
    }
}
