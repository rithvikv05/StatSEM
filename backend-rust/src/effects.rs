//! Structural effects and ordered DFS enumeration from engine/pls/effects.py.
use serde_json::{json, Value};

fn walk(
    adj: &[Vec<f64>],
    current: usize,
    target: usize,
    visited: &mut Vec<usize>,
    result: &mut Vec<Vec<usize>>,
) {
    if result.len() >= 1000 || visited.len() > 8 {
        return;
    }
    for next in 0..adj.len() {
        if adj[current][next].abs() <= 1e-12 {
            continue;
        }
        if next == target {
            if visited.len() >= 2 {
                let mut path = visited.clone();
                path.push(target);
                result.push(path);
            }
        } else if !visited.contains(&next) {
            visited.push(next);
            walk(adj, next, target, visited, result);
            visited.pop();
        }
    }
}

pub fn calculate(matrix: &[Vec<f64>], ids: &[String]) -> Value {
    let n = ids.len();
    let system: Vec<Vec<f64>> = (0..n)
        .map(|i| {
            (0..n)
                .map(|j| {
                    if i == j {
                        1.0 - matrix[i][j]
                    } else {
                        -matrix[i][j]
                    }
                })
                .collect()
        })
        .collect();
    let total = crate::linalg::inverse(&system)
        .map(|mut inverse| {
            for (i, row) in inverse.iter_mut().enumerate() {
                row[i] -= 1.0;
            }
            inverse
        })
        .unwrap_or_else(|_| matrix.to_vec());
    let indirect: Vec<Vec<f64>> = (0..n)
        .map(|i| (0..n).map(|j| total[i][j] - matrix[i][j]).collect())
        .collect();
    let mut paths = Vec::new();
    for i in 0..n {
        for j in 0..n {
            if i != j {
                walk(matrix, i, j, &mut vec![i], &mut paths);
            }
        }
    }
    let specific: Vec<Value> = paths.iter().map(|path| {
        let coefficient = path.windows(2).fold(1.0, |v, pair| v * matrix[pair[0]][pair[1]]);
        let names: Vec<_> = path.iter().map(|&i| ids[i].clone()).collect();
        json!({"source": names[0], "target": names[names.len()-1], "path": names.join(" -> "), "path_nodes": names, "effect": coefficient})
    }).collect();
    let mut summary = Vec::new();
    for i in 0..n {
        for j in 0..n {
            if matrix[i][j].abs() > 1e-7 || indirect[i][j].abs() > 1e-7 || total[i][j].abs() > 1e-7
            {
                let pair: Vec<_> = specific
                    .iter()
                    .filter(|v| v["source"] == ids[i] && v["target"] == ids[j])
                    .cloned()
                    .collect();
                summary.push(json!({"from": ids[i], "to": ids[j], "direct": matrix[i][j], "indirect": indirect[i][j], "total": total[i][j], "specific_indirect": pair}));
            }
        }
    }
    json!({"direct_matrix": matrix, "total_indirect_matrix": indirect, "total_effects_matrix": total, "specific_indirect": specific, "effects_summary": summary})
}
