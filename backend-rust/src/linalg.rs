//! Narrow LAPACK boundary. macOS uses the same system Accelerate provider as
//! the captured NumPy build. Other platform providers remain a migration gate.

#[cfg(target_os = "macos")]
#[link(name = "Accelerate", kind = "framework")]
extern "C" {
    #[link_name = "cblas_dgemv$NEWLAPACK"]
    fn cblas_dgemv(
        order: i32,
        trans: i32,
        m: i32,
        n: i32,
        alpha: f64,
        a: *const f64,
        lda: i32,
        x: *const f64,
        incx: i32,
        beta: f64,
        y: *mut f64,
        incy: i32,
    );
    #[link_name = "dgeqp3$NEWLAPACK"]
    fn dgeqp3(
        m: *const i32,
        n: *const i32,
        a: *mut f64,
        lda: *const i32,
        pivots: *mut i32,
        tau: *mut f64,
        work: *mut f64,
        lwork: *const i32,
        info: *mut i32,
    );
    #[link_name = "cblas_dsyrk$NEWLAPACK"]
    fn cblas_dsyrk(
        order: i32,
        uplo: i32,
        trans: i32,
        n: i32,
        k: i32,
        alpha: f64,
        a: *const f64,
        lda: i32,
        beta: f64,
        c: *mut f64,
        ldc: i32,
    );
    #[link_name = "dgesdd$NEWLAPACK"]
    fn dgesdd(
        job: *const u8,
        m: *const i32,
        n: *const i32,
        a: *mut f64,
        lda: *const i32,
        s: *mut f64,
        u: *mut f64,
        ldu: *const i32,
        vt: *mut f64,
        ldvt: *const i32,
        work: *mut f64,
        lwork: *const i32,
        iwork: *mut i32,
        info: *mut i32,
    );
    #[link_name = "dsyevd$NEWLAPACK"]
    fn dsyevd(
        job: *const u8,
        uplo: *const u8,
        n: *const i32,
        a: *mut f64,
        lda: *const i32,
        w: *mut f64,
        work: *mut f64,
        lwork: *const i32,
        iwork: *mut i32,
        liwork: *const i32,
        info: *mut i32,
    );
    #[link_name = "dgeev$NEWLAPACK"]
    fn dgeev(
        left: *const u8,
        right: *const u8,
        n: *const i32,
        a: *mut f64,
        lda: *const i32,
        wr: *mut f64,
        wi: *mut f64,
        vl: *mut f64,
        ldvl: *const i32,
        vr: *mut f64,
        ldvr: *const i32,
        work: *mut f64,
        lwork: *const i32,
        info: *mut i32,
    );
    #[link_name = "dgelsd$NEWLAPACK"]
    fn dgelsd(
        m: *const i32,
        n: *const i32,
        nrhs: *const i32,
        a: *mut f64,
        lda: *const i32,
        b: *mut f64,
        ldb: *const i32,
        s: *mut f64,
        rcond: *const f64,
        rank: *mut i32,
        work: *mut f64,
        lwork: *const i32,
        iwork: *mut i32,
        info: *mut i32,
    );
    #[link_name = "dgesv$NEWLAPACK"]
    fn dgesv(
        n: *const i32,
        nrhs: *const i32,
        a: *mut f64,
        lda: *const i32,
        ipiv: *mut i32,
        b: *mut f64,
        ldb: *const i32,
        info: *mut i32,
    );
}

fn validate_matrix(rows: &[Vec<f64>], square: bool) -> Result<(i32, i32), String> {
    let columns = rows.first().map_or(0, Vec::len);
    if rows.is_empty()
        || columns == 0
        || rows
            .iter()
            .any(|r| r.len() != columns || r.iter().any(|v| !v.is_finite()))
        || (square && rows.len() != columns)
    {
        return Err("Invalid numerical matrix".into());
    }
    Ok((
        i32::try_from(rows.len()).map_err(|_| "Matrix too large")?,
        i32::try_from(columns).map_err(|_| "Matrix too large")?,
    ))
}
fn column_major(rows: &[Vec<f64>]) -> Vec<f64> {
    (0..rows[0].len())
        .flat_map(|j| rows.iter().map(move |r| r[j]))
        .collect()
}

#[cfg(target_os = "macos")]
pub fn matvec(columns: &[Vec<f64>], coefficients: &[f64]) -> Result<Vec<f64>, String> {
    let (n, m) = validate_matrix(columns, false)?;
    if coefficients.len() != n as usize || coefficients.iter().any(|v| !v.is_finite()) {
        return Err("Invalid matrix-vector dimensions or coefficients".into());
    }
    let data = column_major(columns);
    let mut result = vec![0.0; m as usize];
    // SAFETY: row-major m*n matrix, n-vector and m-result are shape checked.
    // NoTrans, lda=n and unit vector increments use the modern i32 interface.
    unsafe {
        cblas_dgemv(
            101,
            111,
            m,
            n,
            1.0,
            data.as_ptr(),
            n,
            coefficients.as_ptr(),
            1,
            0.0,
            result.as_mut_ptr(),
            1,
        );
    }
    Ok(result)
}
#[cfg(not(target_os = "macos"))]
pub fn matvec(_columns: &[Vec<f64>], _coefficients: &[f64]) -> Result<Vec<f64>, String> {
    Err("Native matrix-vector provider has not been verified on this platform".into())
}

#[cfg(target_os = "macos")]
pub fn pivoted_qr(rows: &[Vec<f64>]) -> Result<Vec<usize>, String> {
    let (m, n) = validate_matrix(rows, false)?;
    let mut a = column_major(rows);
    let mut pivots = vec![0; n as usize];
    let mut tau = vec![0.0; m.min(n) as usize];
    let mut query = [0.0];
    let mut info = 0;
    // SAFETY: finite checked column-major matrix, m leading dimension, one
    // pivot per column and min(m,n) reflector coefficients, i32 LAPACK ABI.
    unsafe {
        dgeqp3(
            &m,
            &n,
            a.as_mut_ptr(),
            &m,
            pivots.as_mut_ptr(),
            tau.as_mut_ptr(),
            query.as_mut_ptr(),
            &-1,
            &mut info,
        );
    }
    let size = workspace_size(query[0], info)?;
    let mut work = vec![0.0; size as usize];
    // SAFETY: workspace size is the checked LAPACK query result.
    unsafe {
        dgeqp3(
            &m,
            &n,
            a.as_mut_ptr(),
            &m,
            pivots.as_mut_ptr(),
            tau.as_mut_ptr(),
            work.as_mut_ptr(),
            &size,
            &mut info,
        );
    }
    if info != 0 {
        return Err(format!("LAPACK pivoted QR failed ({info})"));
    }
    if pivots.iter().any(|p| *p < 1 || *p > n) {
        return Err("LAPACK returned an invalid QR permutation".into());
    }
    Ok(pivots.into_iter().map(|p| p as usize - 1).collect())
}
#[cfg(not(target_os = "macos"))]
pub fn pivoted_qr(_rows: &[Vec<f64>]) -> Result<Vec<usize>, String> {
    Err("Native pivoted-QR provider has not been verified on this platform".into())
}

/// NumPy's real X @ X.T uses the symmetric rank-k BLAS path, not scalar dots.
#[cfg(target_os = "macos")]
pub fn symmetric_product(
    rows: &[Vec<f64>],
    transpose_storage: bool,
) -> Result<Vec<Vec<f64>>, String> {
    let (m, n) = validate_matrix(rows, false)?;
    let a: Vec<_> = if transpose_storage {
        column_major(rows)
    } else {
        rows.iter().flatten().copied().collect()
    };
    let total = (m as usize)
        .checked_mul(m as usize)
        .ok_or("Matrix too large")?;
    let mut result = vec![0.0; total];
    // SAFETY: row-major m*n A, m*m result, leading dimensions n/m, Upper and
    // NoTrans match checked shapes. CBLAS uses the modern i32 interface.
    unsafe {
        cblas_dsyrk(
            101,
            121,
            if transpose_storage { 112 } else { 111 },
            m,
            n,
            1.0,
            a.as_ptr(),
            if transpose_storage { m } else { n },
            0.0,
            result.as_mut_ptr(),
            m,
        );
    }
    Ok((0..m as usize)
        .map(|i| {
            (0..m as usize)
                .map(|j| {
                    if i <= j {
                        result[i * m as usize + j]
                    } else {
                        result[j * m as usize + i]
                    }
                })
                .collect()
        })
        .collect())
}
#[cfg(not(target_os = "macos"))]
pub fn symmetric_product(
    _rows: &[Vec<f64>],
    _transpose_storage: bool,
) -> Result<Vec<Vec<f64>>, String> {
    Err("Native symmetric-product provider has not been verified on this platform".into())
}

#[cfg(target_os = "macos")]
pub fn pseudoinverse(rows: &[Vec<f64>], rcond: f64) -> Result<Vec<Vec<f64>>, String> {
    let (m, n) = validate_matrix(rows, false)?;
    let k = m.min(n);
    let mut a = column_major(rows);
    let mut singular = vec![0.0; k as usize];
    let mut u = vec![0.0; (m * k) as usize];
    let mut vt = vec![0.0; (k * n) as usize];
    let mut iwork = vec![0; 8 * k as usize];
    let mut query = [0.0];
    let mut info = 0;
    // SAFETY: reduced SVD buffers have documented m*k and k*n dimensions;
    // all matrices are finite, column-major, and LAPACK uses the i32 ABI.
    unsafe {
        dgesdd(
            &b'S',
            &m,
            &n,
            a.as_mut_ptr(),
            &m,
            singular.as_mut_ptr(),
            u.as_mut_ptr(),
            &m,
            vt.as_mut_ptr(),
            &k,
            query.as_mut_ptr(),
            &-1,
            iwork.as_mut_ptr(),
            &mut info,
        );
    }
    let size = workspace_size(query[0], info)?;
    let mut work = vec![0.0; size as usize];
    // SAFETY: floating workspace is allocated using the checked query result.
    unsafe {
        dgesdd(
            &b'S',
            &m,
            &n,
            a.as_mut_ptr(),
            &m,
            singular.as_mut_ptr(),
            u.as_mut_ptr(),
            &m,
            vt.as_mut_ptr(),
            &k,
            work.as_mut_ptr(),
            &size,
            iwork.as_mut_ptr(),
            &mut info,
        );
    }
    if info != 0 {
        return Err(format!("DGESDD failed: {info}"));
    }
    let threshold = rcond * singular[0];
    let mut result = vec![vec![0.0; m as usize]; n as usize];
    for i in 0..n as usize {
        for j in 0..m as usize {
            for s in 0..k as usize {
                let inverse = if singular[s] > threshold {
                    1.0 / singular[s]
                } else {
                    0.0
                };
                result[i][j] += vt[i * k as usize + s] * (inverse * u[s * m as usize + j]);
            }
        }
    }
    Ok(result)
}
fn workspace_size(query: f64, info: i32) -> Result<i32, String> {
    if info != 0 || !query.is_finite() || query < 1.0 || query > i32::MAX as f64 {
        return Err(format!("Invalid LAPACK workspace: {info}"));
    }
    Ok(query.ceil() as i32)
}

#[cfg(target_os = "macos")]
pub fn symmetric_eigen(rows: &[Vec<f64>]) -> Result<(Vec<f64>, Vec<Vec<f64>>), String> {
    let (n, _) = validate_matrix(rows, true)?;
    let mut a = column_major(rows);
    let mut values = vec![0.0; n as usize];
    let mut query = [0.0];
    let mut iquery = [0];
    let mut info = 0;
    // SAFETY: square finite matrix, n eigenvalues; both workspace queries have
    // one writable entry, as required for lwork=liwork=-1.
    unsafe {
        dsyevd(
            &b'V',
            &b'L',
            &n,
            a.as_mut_ptr(),
            &n,
            values.as_mut_ptr(),
            query.as_mut_ptr(),
            &-1,
            iquery.as_mut_ptr(),
            &-1,
            &mut info,
        );
    }
    let size = workspace_size(query[0], info)?;
    if iquery[0] < 1 {
        return Err("Invalid eigen integer workspace".into());
    }
    let mut work = vec![0.0; size as usize];
    let mut iwork = vec![0; iquery[0] as usize];
    // SAFETY: checked workspaces are allocated with the queried sizes.
    unsafe {
        dsyevd(
            &b'V',
            &b'L',
            &n,
            a.as_mut_ptr(),
            &n,
            values.as_mut_ptr(),
            work.as_mut_ptr(),
            &size,
            iwork.as_mut_ptr(),
            &iquery[0],
            &mut info,
        );
    }
    if info != 0 {
        return Err(format!("DSYEVD failed: {info}"));
    }
    let vectors = (0..n as usize)
        .map(|i| (0..n as usize).map(|j| a[j * n as usize + i]).collect())
        .collect();
    Ok((values, vectors))
}

#[cfg(target_os = "macos")]
pub fn eigenvalues_real(rows: &[Vec<f64>]) -> Result<Vec<f64>, String> {
    let (n, _) = validate_matrix(rows, true)?;
    let mut a = column_major(rows);
    let mut real = vec![0.0; n as usize];
    let mut imaginary = vec![0.0; n as usize];
    let mut left = [0.0];
    let mut right = [0.0];
    let mut query = [0.0];
    let mut info = 0;
    // SAFETY: eigenvectors are disabled (N,N), permitting one-element dummy
    // buffers and leading dimensions of one. Eigenvalue buffers contain n entries.
    unsafe {
        dgeev(
            &b'N',
            &b'N',
            &n,
            a.as_mut_ptr(),
            &n,
            real.as_mut_ptr(),
            imaginary.as_mut_ptr(),
            left.as_mut_ptr(),
            &1,
            right.as_mut_ptr(),
            &1,
            query.as_mut_ptr(),
            &-1,
            &mut info,
        );
    }
    let size = workspace_size(query[0], info)?;
    let mut work = vec![0.0; size as usize];
    // SAFETY: same validated buffers, with queried workspace.
    unsafe {
        dgeev(
            &b'N',
            &b'N',
            &n,
            a.as_mut_ptr(),
            &n,
            real.as_mut_ptr(),
            imaginary.as_mut_ptr(),
            left.as_mut_ptr(),
            &1,
            right.as_mut_ptr(),
            &1,
            work.as_mut_ptr(),
            &size,
            &mut info,
        );
    }
    if info != 0 {
        return Err(format!("DGEEV failed: {info}"));
    }
    Ok(real)
}

#[cfg(not(target_os = "macos"))]
pub fn pseudoinverse(_: &[Vec<f64>], _: f64) -> Result<Vec<Vec<f64>>, String> {
    Err("Numerical provider not verified for this platform".into())
}
#[cfg(not(target_os = "macos"))]
pub fn symmetric_eigen(_: &[Vec<f64>]) -> Result<(Vec<f64>, Vec<Vec<f64>>), String> {
    Err("Numerical provider not verified for this platform".into())
}
#[cfg(not(target_os = "macos"))]
pub fn eigenvalues_real(_: &[Vec<f64>]) -> Result<Vec<f64>, String> {
    Err("Numerical provider not verified for this platform".into())
}

pub struct LeastSquares {
    pub coefficients: Vec<f64>,
    pub rank: usize,
    pub singular_values: Vec<f64>,
}

/// NumPy lstsq(rcond=None): epsilon * max(M,N) rank threshold; never normal equations.
#[cfg(target_os = "macos")]
pub fn least_squares(
    columns: &[Vec<f64>],
    target: &[f64],
    weights: Option<&[f64]>,
) -> Result<LeastSquares, String> {
    let rows = target.len();
    let cols = columns.len();
    if rows == 0 || cols == 0 || columns.iter().any(|c| c.len() != rows) {
        return Err("Invalid least-squares dimensions".into());
    }
    crate::stats::check_weights(rows, weights)?;
    let m = i32::try_from(rows).map_err(|_| "Too many rows for LAPACK")?;
    let n = i32::try_from(cols).map_err(|_| "Too many columns for LAPACK")?;
    let ldb = m.max(n);
    let sqrt_weights = weights.map(|w| w.iter().map(|v| v.sqrt()).collect::<Vec<_>>());
    let mut a = Vec::with_capacity(rows * cols);
    for column in columns {
        a.extend(
            column
                .iter()
                .enumerate()
                .map(|(i, value)| value * sqrt_weights.as_ref().map(|w| w[i]).unwrap_or(1.0)),
        );
    }
    let mut b = vec![0.0; ldb as usize];
    for i in 0..rows {
        b[i] = target[i] * sqrt_weights.as_ref().map(|w| w[i]).unwrap_or(1.0);
    }
    if a.iter().chain(&b).any(|v| !v.is_finite()) {
        return Err("Non-finite least-squares input".into());
    }
    let mut singular_values = vec![0.0; rows.min(cols)];
    // Conservative bound for DGELSD's recursive integer workspace. Each level
    // costs 3*min(M,N); 64 levels exceeds the possible depth for i32 dimensions.
    let mut iwork = vec![
        0;
        rows.min(cols)
            .checked_mul(203)
            .ok_or("Workspace overflow")?
    ];
    let rcond = f64::EPSILON * rows.max(cols) as f64;
    let mut rank = 0;
    let mut info = 0;
    let mut query = [0.0];
    // SAFETY: all input/output buffers match the documented column-major
    // dimensions, integer ABI and workspace sizes; LAPACK does not retain them.
    unsafe {
        dgelsd(
            &m,
            &n,
            &1,
            a.as_mut_ptr(),
            &m,
            b.as_mut_ptr(),
            &ldb,
            singular_values.as_mut_ptr(),
            &rcond,
            &mut rank,
            query.as_mut_ptr(),
            &-1,
            iwork.as_mut_ptr(),
            &mut info,
        );
    }
    if info != 0 || !query[0].is_finite() || query[0] < 1.0 || query[0] > i32::MAX as f64 {
        return Err(format!("DGELSD workspace query failed: {info}"));
    }
    let lwork = query[0].ceil() as i32;
    let mut work = vec![0.0; lwork as usize];
    // SAFETY: same validated buffers, now with queried floating workspace.
    unsafe {
        dgelsd(
            &m,
            &n,
            &1,
            a.as_mut_ptr(),
            &m,
            b.as_mut_ptr(),
            &ldb,
            singular_values.as_mut_ptr(),
            &rcond,
            &mut rank,
            work.as_mut_ptr(),
            &lwork,
            iwork.as_mut_ptr(),
            &mut info,
        );
    }
    if info != 0 {
        return Err(format!("DGELSD failed: {info}"));
    }
    Ok(LeastSquares {
        coefficients: b[..cols].to_vec(),
        rank: rank as usize,
        singular_values,
    })
}

#[cfg(not(target_os = "macos"))]
pub fn least_squares(_: &[Vec<f64>], _: &[f64], _: Option<&[f64]>) -> Result<LeastSquares, String> {
    Err("LAPACK provider for this target has not passed migration parity".into())
}

#[cfg(target_os = "macos")]
pub fn solve(rows: &[Vec<f64>], rhs: &[f64]) -> Result<Vec<f64>, String> {
    let (n, _) = validate_matrix(rows, true)?;
    if rhs.len() != rows.len() || rhs.iter().any(|v| !v.is_finite()) {
        return Err("Invalid linear system right-hand side".into());
    }
    let mut a = column_major(rows);
    let mut b = rhs.to_vec();
    let mut pivot = vec![0; rows.len()];
    let mut info = 0;
    // SAFETY: checked square n*n A, one n-element RHS, and n pivot slots.
    // DGESV retains no pointers; its i32 ABI matches the selected provider.
    unsafe {
        dgesv(
            &n,
            &1,
            a.as_mut_ptr(),
            &n,
            pivot.as_mut_ptr(),
            b.as_mut_ptr(),
            &n,
            &mut info,
        );
    }
    if info != 0 {
        return Err(format!("DGESV failed: {info}"));
    }
    Ok(b)
}
#[cfg(not(target_os = "macos"))]
pub fn solve(_: &[Vec<f64>], _: &[f64]) -> Result<Vec<f64>, String> {
    Err("LAPACK provider for this target has not passed migration parity".into())
}

#[cfg(target_os = "macos")]
pub fn inverse(rows: &[Vec<f64>]) -> Result<Vec<Vec<f64>>, String> {
    let size = rows.len();
    if size == 0 || rows.iter().any(|r| r.len() != size) {
        return Err("Expected nonempty square matrix".into());
    }
    let n = i32::try_from(size).map_err(|_| "Too many rows for LAPACK")?;
    let mut a: Vec<f64> = (0..size)
        .flat_map(|j| rows.iter().map(move |r| r[j]))
        .collect();
    if a.iter().any(|v| !v.is_finite()) {
        return Err("Non-finite inverse input".into());
    }
    let mut b = vec![0.0; size * size];
    for i in 0..size {
        b[i * size + i] = 1.0;
    }
    let mut pivot = vec![0; size];
    let mut info = 0;
    // SAFETY: square column-major A and identity RHS each hold n*n entries;
    // pivots hold n entries. DGESV solves A*X=I in-place without retaining pointers.
    unsafe {
        dgesv(
            &n,
            &n,
            a.as_mut_ptr(),
            &n,
            pivot.as_mut_ptr(),
            b.as_mut_ptr(),
            &n,
            &mut info,
        );
    }
    if info != 0 {
        return Err(format!("DGESV failed: {info}"));
    }
    Ok((0..size)
        .map(|i| (0..size).map(|j| b[j * size + i]).collect())
        .collect())
}

#[cfg(not(target_os = "macos"))]
pub fn inverse(_: &[Vec<f64>]) -> Result<Vec<Vec<f64>>, String> {
    Err("LAPACK provider for this target has not passed migration parity".into())
}
