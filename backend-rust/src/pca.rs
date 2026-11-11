//! Principal components of standardized indicators, computed per model construct.
use crate::{matrix, model, stats};
use serde_json::{json, Value};

fn eigen_symmetric(mut a: Vec<Vec<f64>>) -> Result<(Vec<f64>, Vec<Vec<f64>>), String> {
    let n = a.len();
    if n == 0 || a.iter().any(|row| row.len() != n || row.iter().any(|v| !v.is_finite())) {
        return Err("Invalid correlation matrix".into());
    }
    let mut vectors = matrix::identity(n);
    let max_steps = 100 * n * n;
    let mut converged = n == 1;
    for _ in 0..max_steps {
        let mut p = 0;
        let mut q = 0;
        let mut largest = 0.0_f64;
        for i in 0..n { for j in i + 1..n { if a[i][j].abs() > largest { largest = a[i][j].abs(); p = i; q = j; } } }
        if largest < 1e-12 { converged = true; break; }
        let angle = 0.5 * (2.0 * a[p][q]).atan2(a[q][q] - a[p][p]);
        let (s, c) = angle.sin_cos();
        let (app, aqq, apq) = (a[p][p], a[q][q], a[p][q]);
        a[p][p] = c*c*app - 2.0*s*c*apq + s*s*aqq;
        a[q][q] = s*s*app + 2.0*s*c*apq + c*c*aqq;
        a[p][q] = 0.0; a[q][p] = 0.0;
        for k in 0..n {
            if k != p && k != q {
                let (akp, akq) = (a[k][p], a[k][q]);
                a[k][p] = c*akp - s*akq; a[p][k] = a[k][p];
                a[k][q] = s*akp + c*akq; a[q][k] = a[k][q];
            }
            let (vkp, vkq) = (vectors[k][p], vectors[k][q]);
            vectors[k][p] = c*vkp - s*vkq;
            vectors[k][q] = s*vkp + c*vkq;
        }
    }
    if !converged { return Err("PCA eigendecomposition did not converge".into()); }
    Ok(((0..n).map(|i| a[i][i]).collect(), vectors))
}

pub fn run(columns: &[String], rows: &[Vec<Value>], spec: &Value) -> Result<Value, String> {
    if rows.iter().any(|row| row.len() != columns.len()) { return Err("Dataset row width differs from columns".into()); }
    let parsed = model::parse(spec)?;
    let mut constructs = Vec::new();
    for block in &parsed.blocks {
        if block.indicators.is_empty() { continue; }
        if block.indicators.len() > 200 { return Err("PCA supports up to 200 indicators per construct".into()); }
        let mut names = Vec::new();
        let positions: Vec<usize> = block.indicators.iter().map(|id| {
            let column = parsed.indicators.iter().find(|(iid, _)| iid == id).map(|(_, c)| c).ok_or_else(|| format!("Unknown indicator: {id}"))?;
            names.push(column.clone());
            columns.iter().position(|c| c == column).ok_or_else(|| format!("Missing indicator column: {column}"))
        }).collect::<Result<_,_>>()?;
        let data: Vec<Vec<f64>> = rows.iter().map(|row| positions.iter().map(|&i| model::numeric(&row[i])).collect::<Vec<_>>()).filter(|row| row.iter().all(|v| v.is_finite() && *v != -99.0)).collect();
        if data.len() < 3 { return Err(format!("At least three complete cases are required for {}", block.id)); }
        let samples = matrix::transpose(&data);
        if samples.iter().any(|x| stats::std(x, None, 0) <= 1e-12) { return Err(format!("PCA requires nonconstant indicators for {}", block.id)); }
        let corr = matrix::correlation_rows(&data);
        let (values, vectors) = eigen_symmetric(corr)?;
        let mut order: Vec<usize> = (0..values.len()).collect();
        order.sort_by(|&a, &b| values[b].total_cmp(&values[a]));
        let sum: f64 = values.iter().sum();
        let mut cumulative = 0.0;
        let mut components = Vec::new();
        for (index, &k) in order.iter().enumerate() {
            let eigenvalue = values[k].max(0.0);
            let proportion = eigenvalue / sum;
            cumulative += proportion;
            let pivot = (0..names.len()).max_by(|&a, &b| vectors[a][k].abs().total_cmp(&vectors[b][k].abs())).unwrap();
            let sign = if vectors[pivot][k] < 0.0 { -1.0 } else { 1.0 };
            let loadings: Vec<_> = names.iter().enumerate().map(|(i, name)| json!({"indicator":name,"loading":sign * vectors[i][k] * eigenvalue.sqrt()})).collect();
            components.push(json!({"component":index+1,"eigenvalue":eigenvalue,"variance_explained":proportion,"cumulative_variance":cumulative,"loadings":loadings}));
        }
        constructs.push(json!({"id":block.id,"name":block.name.as_deref().unwrap_or(&block.id),"n_samples":data.len(),"components":components}));
    }
    if constructs.is_empty() { return Err("No indicators available for PCA".into()); }
    Ok(json!({"method":"standardized_pca","missing_treatment":"complete_cases","constructs":constructs}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn eigendecomposition_recovers_correlated_reference() {
        let (v, vectors) = eigen_symmetric(vec![vec![1.0, 0.8], vec![0.8, 1.0]]).unwrap();
        assert!((v[0] - 0.2).abs() < 1e-10);
        assert!((v[1] - 1.8).abs() < 1e-10);
        assert!((vectors[0][1].abs() - 1.0 / 2.0_f64.sqrt()).abs() < 1e-10);
    }
    #[test]
    fn pca_reports_variance_and_uses_complete_cases() {
        let columns = vec!["x".into(), "y".into()];
        let rows = vec![vec![json!(1), json!(2)], vec![json!(2), json!(4)], vec![json!(3), json!(6)], vec![Value::Null, json!(8)]];
        let spec = json!({"constructs":[{"id":"A","name":"Alpha","indicators":["x","y"]}],"paths":[]});
        let out = run(&columns, &rows, &spec).unwrap();
        assert_eq!(out["constructs"][0]["n_samples"], 3);
        assert!((out["constructs"][0]["components"][0]["eigenvalue"].as_f64().unwrap() - 2.0).abs() < 1e-10);
        assert!((out["constructs"][0]["components"][0]["variance_explained"].as_f64().unwrap() - 1.0).abs() < 1e-10);
    }
}
