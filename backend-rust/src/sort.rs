//! NumPy indirect introsort, including tie ordering. Charles R. Harris / NumPy;
//! see THIRD_PARTY_NOTICES.md for attribution and terms.
fn less(a: f64, b: f64) -> bool {
    a < b || (b.is_nan() && !a.is_nan())
}
fn heap(indices: &mut [usize], values: &[f64]) {
    let mut a = vec![0];
    a.extend_from_slice(indices);
    let mut n = indices.len();
    for root in (1..=n / 2).rev() {
        let temp = a[root];
        let mut i = root;
        let mut j = root * 2;
        while j <= n {
            if j < n && less(values[a[j]], values[a[j + 1]]) {
                j += 1;
            }
            if !less(values[temp], values[a[j]]) {
                break;
            }
            a[i] = a[j];
            i = j;
            j *= 2;
        }
        a[i] = temp;
    }
    while n > 1 {
        let temp = a[n];
        a[n] = a[1];
        n -= 1;
        let mut i = 1;
        let mut j = 2;
        while j <= n {
            if j < n && less(values[a[j]], values[a[j + 1]]) {
                j += 1;
            }
            if !less(values[temp], values[a[j]]) {
                break;
            }
            a[i] = a[j];
            i = j;
            j *= 2;
        }
        a[i] = temp;
    }
    indices.copy_from_slice(&a[1..]);
}
pub fn argsort(values: &[f64]) -> Vec<usize> {
    let mut indices: Vec<_> = (0..values.len()).collect();
    if values.len() < 2 {
        return indices;
    }
    let mut low = 0;
    let mut high = values.len() - 1;
    let mut depth = (usize::BITS - values.len().leading_zeros() - 1) as i32 * 2;
    let mut stack = Vec::new();
    loop {
        if depth < 0 {
            heap(&mut indices[low..=high], values);
        } else {
            while high - low > 15 {
                let middle = low + (high - low) / 2;
                if less(values[indices[middle]], values[indices[low]]) {
                    indices.swap(middle, low);
                }
                if less(values[indices[high]], values[indices[middle]]) {
                    indices.swap(high, middle);
                }
                if less(values[indices[middle]], values[indices[low]]) {
                    indices.swap(middle, low);
                }
                let pivot = values[indices[middle]];
                let mut i = low;
                let mut j = high - 1;
                indices.swap(middle, j);
                loop {
                    i += 1;
                    while less(values[indices[i]], pivot) {
                        i += 1;
                    }
                    j -= 1;
                    while less(pivot, values[indices[j]]) {
                        j -= 1;
                    }
                    if i >= j {
                        break;
                    }
                    indices.swap(i, j);
                }
                indices.swap(i, high - 1);
                depth -= 1;
                if i - low < high - i {
                    stack.push((i + 1, high, depth));
                    high = i - 1;
                } else {
                    stack.push((low, i - 1, depth));
                    low = i + 1;
                }
            }
            for i in low + 1..=high {
                let value = indices[i];
                let mut j = i;
                while j > low && less(values[value], values[indices[j - 1]]) {
                    indices[j] = indices[j - 1];
                    j -= 1;
                }
                indices[j] = value;
            }
        }
        if let Some((l, h, d)) = stack.pop() {
            low = l;
            high = h;
            depth = d;
        } else {
            break;
        }
    }
    indices
}
