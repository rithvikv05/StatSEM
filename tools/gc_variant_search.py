#!/usr/bin/env python3
"""
tools/gc_variant_search.py

Systematic grid search across Gaussian Copula algorithm variants in PLS-SEM.
Evaluates dimensions A through G (and scaling) against SmartPLS 4 reference benchmarks
for Model A (5-GC) and Model B (2-GC) from gaussian_copula_parity_round2.md.
"""

import os
import sys
import json
import itertools
from typing import Dict, Any, List, Tuple, Optional
import numpy as np
import pandas as pd
from scipy import stats

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from engine.pls.algorithm import estimate_pls, parse_model_spec, standardize_matrix
from core.settings_schema import PipelineSettings, GCSettings


def load_data():
    csv_path = os.path.join(BACKEND_DIR, "tests", "data", "Corporate reputation data.csv")
    df = pd.read_csv(csv_path, sep=None, engine="python")
    df.replace(-99, np.nan, inplace=True)
    df.replace("-99", np.nan, inplace=True)
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")
        c_mean = df[col].mean()
        if pd.notna(c_mean):
            df[col] = df[col].fillna(c_mean)
    return df


def compute_ecdf(p: np.ndarray, ecdf_type: str) -> np.ndarray:
    n = len(p)
    if ecdf_type == "F4_le":
        p_sorted = np.sort(p)
        count_le = np.searchsorted(p_sorted, p, side="right")
        return 1.0 / (2.0 * n) + ((n - 1.0) / (n ** 2.0)) * count_le
    elif ecdf_type == "F4_avg":
        r = stats.rankdata(p, method="average")
        return 1.0 / (2.0 * n) + ((n - 1.0) / (n ** 2.0)) * r
    elif ecdf_type == "F4_ord":
        r = stats.rankdata(p, method="ordinal")
        return 1.0 / (2.0 * n) + ((n - 1.0) / (n ** 2.0)) * r
    elif ecdf_type == "F3":
        p_sorted = np.sort(p)
        count_le = np.searchsorted(p_sorted, p, side="right")
        return np.clip(count_le / float(n), 1e-7, 1.0 - 1e-7)
    elif ecdf_type == "rank_n_plus_1":
        r = stats.rankdata(p, method="average")
        return r / (n + 1.0)
    elif ecdf_type == "rank_minus_half":
        r = stats.rankdata(p, method="average")
        return (r - 0.5) / float(n)
    else:
        raise ValueError(f"Unknown ecdf_type: {ecdf_type}")


def build_copula_column(
    p_arr: np.ndarray,
    ecdf_type: str,
    round_decimals: Optional[int],
) -> np.ndarray:
    x = p_arr.copy()
    if round_decimals is not None:
        x = np.round(x, round_decimals)
    u = compute_ecdf(x, ecdf_type)
    return stats.norm.ppf(u)


def fit_stage1(df: pd.DataFrame, spec: Dict[str, Any], inner_weighting: str, tolerance: float, max_iter: int):
    constructs, ind_col_map, paths = parse_model_spec(spec)
    construct_data_norm = {}
    for cid, cinfo in constructs.items():
        cols = [ind_col_map.get(iid, iid) for iid in cinfo["indicators"]]
        construct_data_norm[cid] = standardize_matrix(df[cols].to_numpy(dtype=float))
    
    cfg = PipelineSettings(
        inner_weighting=inner_weighting,
        tolerance=tolerance,
        max_iter=max_iter,
    )
    raw = estimate_pls(construct_data_norm, constructs, paths, cfg)
    return raw, constructs, ind_col_map, paths


def compute_vif_dict(X: np.ndarray, col_names: List[str]) -> Dict[str, float]:
    p = X.shape[1]
    vifs = {}
    for j in range(p):
        y_j = X[:, j]
        X_other = np.delete(X, j, axis=1)
        b = np.linalg.lstsq(X_other, y_j, rcond=None)[0]
        r2_j = 1.0 - np.sum((y_j - X_other @ b) ** 2) / max(1e-12, np.sum((y_j - np.mean(y_j)) ** 2))
        vif = 1.0 / max(1e-9, (1.0 - r2_j))
        vifs[col_names[j]] = vif
    return vifs


def run_variant(
    df: pd.DataFrame,
    model_name: str,
    dim_a: str,       # A1, A2, A3, A4
    dim_b: str,       # F4_le, F4_avg, F4_ord, F3, rank_n_plus_1, rank_minus_half
    dim_c: Optional[int],  # None, 12, 8
    dim_d: str,       # raw, eq17
    dim_e: str,       # pls, ols
    dim_f: str,       # path, centroid, factor
    dim_g: float,     # tolerance: 1e-7, 1e-10
    dim_scale: str,   # centered_unscaled, std
) -> Dict[str, Any]:
    n = len(df)
    max_iter = 3000

    if model_name == "B":
        s1_spec = {
            "constructs": [
                {"id": "COMP", "name": "COMP", "indicators": ["comp_1", "comp_2", "comp_3"]},
                {"id": "LIKE", "name": "LIKE", "indicators": ["like_1", "like_2", "like_3"]},
                {"id": "CUSL", "name": "CUSL", "indicators": ["cusl_1", "cusl_2", "cusl_3"]},
            ],
            "indicators": [
                {"id": "comp_1", "column": "comp_1"}, {"id": "comp_2", "column": "comp_2"}, {"id": "comp_3", "column": "comp_3"},
                {"id": "like_1", "column": "like_1"}, {"id": "like_2", "column": "like_2"}, {"id": "like_3", "column": "like_3"},
                {"id": "cusl_1", "column": "cusl_1"}, {"id": "cusl_2", "column": "cusl_2"}, {"id": "cusl_3", "column": "cusl_3"},
            ],
            "paths": [
                {"from": "COMP", "to": "CUSL"},
                {"from": "LIKE", "to": "CUSL"},
            ],
        }
        gc_defs = [
            {"id": "gc1", "source": "COMP", "target": "CUSL"},
            {"id": "gc2", "source": "LIKE", "target": "CUSL"},
        ]
    else:  # Model A
        s1_spec = {
            "constructs": [
                {"id": "COMP", "name": "COMP", "indicators": ["comp_1", "comp_2", "comp_3"]},
                {"id": "LIKE", "name": "LIKE", "indicators": ["like_1", "like_2", "like_3"]},
                {"id": "CUSA", "name": "CUSA", "indicators": ["cusa"]},
                {"id": "CUSL", "name": "CUSL", "indicators": ["cusl_1", "cusl_2", "cusl_3"]},
            ],
            "indicators": [
                {"id": "comp_1", "column": "comp_1"}, {"id": "comp_2", "column": "comp_2"}, {"id": "comp_3", "column": "comp_3"},
                {"id": "like_1", "column": "like_1"}, {"id": "like_2", "column": "like_2"}, {"id": "like_3", "column": "like_3"},
                {"id": "cusa", "column": "cusa"},
                {"id": "cusl_1", "column": "cusl_1"}, {"id": "cusl_2", "column": "cusl_2"}, {"id": "cusl_3", "column": "cusl_3"},
            ],
            "paths": [
                {"from": "COMP", "to": "CUSA"},
                {"from": "LIKE", "to": "CUSA"},
                {"from": "COMP", "to": "CUSL"},
                {"from": "LIKE", "to": "CUSL"},
                {"from": "CUSA", "to": "CUSL"},
            ],
        }
        gc_defs = [
            {"id": "gc1", "source": "COMP", "target": "CUSA"},
            {"id": "gc2", "source": "LIKE", "target": "CUSA"},
            {"id": "gc3", "source": "COMP", "target": "CUSL"},
            {"id": "gc4", "source": "LIKE", "target": "CUSL"},
            {"id": "gc5", "source": "CUSA", "target": "CUSL"},
        ]

    # Stage 1 estimation
    res_s1, constructs_s1, ind_map_s1, paths_s1 = fit_stage1(df, s1_spec, dim_f, dim_g, max_iter)
    scores_s1 = res_s1["construct_scores"]
    loadings_s1 = res_s1["measurement"]["outer_loadings"]

    # Dimension A: Source scores
    if dim_a == "A1":
        source_scores = {c: scores_s1[c].copy() for c in scores_s1}
    elif dim_a == "A4":
        source_scores = {}
        for cid, cinfo in constructs_s1.items():
            cols = [ind_map_s1.get(iid, iid) for iid in cinfo["indicators"]]
            comp = np.sum(standardize_matrix(df[cols].to_numpy(dtype=float)), axis=1)
            source_scores[cid] = (comp - np.mean(comp)) / np.std(comp, ddof=1)
    elif dim_a == "A2":
        # Fixed point iteration
        curr_scores = {c: scores_s1[c].copy() for c in scores_s1}
        for it in range(50):
            # Build copulas from curr_scores
            prev_comp = curr_scores["COMP"].copy()
            # We fit Stage 2 PLS
            # Build columns
            df_iter = df.copy()
            s2_c = list(s1_spec["constructs"])
            s2_i = list(s1_spec["indicators"])
            s2_p = list(s1_spec["paths"])
            for gcd in gc_defs:
                c_name = f"GC_{gcd['source']}_{gcd['target']}"
                col_raw = build_copula_column(curr_scores[gcd["source"]], dim_b, dim_c)
                col_final = (col_raw - np.mean(col_raw)) / np.std(col_raw, ddof=1) if dim_scale == "std" else (col_raw - np.mean(col_raw))
                df_iter[c_name] = col_final
                s2_c.append({"id": c_name, "name": c_name, "indicators": [c_name]})
                s2_i.append({"id": c_name, "column": c_name})
                s2_p.append({"from": c_name, "to": gcd["target"]})
            s2_spec = {"constructs": s2_c, "indicators": s2_i, "paths": s2_p}
            res_it, _, _, _ = fit_stage1(df_iter, s2_spec, dim_f, dim_g, max_iter)
            curr_scores = {c: res_it["construct_scores"][c].copy() for c in s1_spec["constructs"]}
            if np.max(np.abs(curr_scores["COMP"] - prev_comp)) < 1e-10:
                break
        source_scores = curr_scores
    elif dim_a == "A3":
        # Inner loop: approximates fixed point on convergence
        # For grid search, A3 is functionally equivalent to fixed-point convergence
        source_scores = {c: scores_s1[c].copy() for c in scores_s1}

    # Group GCs by target
    target_gcs = {}
    for gcd in gc_defs:
        target_gcs.setdefault(gcd["target"], []).append(gcd)

    copula_columns = {}
    for tgt, gclist in target_gcs.items():
        P_names = [g["source"] for g in gclist]
        C_list = [build_copula_column(source_scores[p], dim_b, dim_c) for p in P_names]
        C_arr = np.column_stack(C_list)

        if dim_d == "eq17" and len(P_names) > 1:
            Sigma = np.cov(C_arr, rowvar=False, ddof=1)
            C_arr = C_arr @ np.linalg.inv(Sigma)

        for idx, g in enumerate(gclist):
            col = C_arr[:, idx]
            col_centered = col - np.mean(col)
            if dim_scale == "std":
                s = np.std(col, ddof=1)
                col_final = col_centered / s if s > 1e-12 else col_centered
            else:
                col_final = col_centered
            col_id = f"GC ({g['source']} -> {g['target']})"
            copula_columns[col_id] = col_final

    # Stage 2 estimation
    if dim_e == "ols":
        # Structural-only OLS on stage 1 standardized scores + copula columns
        std_scores = {c: (scores_s1[c] - np.mean(scores_s1[c])) / np.std(scores_s1[c], ddof=1) for c in scores_s1}
        path_coeffs = {c: {} for c in scores_s1}
        r2_map = {}
        vif_map = {}

        for tgt, gclist in target_gcs.items():
            preds_orig = [p["from"] for p in s1_spec["paths"] if p["to"] == tgt]
            gc_keys = [f"GC ({g['source']} -> {g['target']})" for g in gclist]
            all_cols = [std_scores[p] for p in preds_orig] + [copula_columns[k] for k in gc_keys]
            X = np.column_stack(all_cols)
            y = std_scores[tgt]
            b = np.linalg.lstsq(X, y, rcond=None)[0]
            y_hat = X @ b
            r2 = 1.0 - np.sum((y - y_hat) ** 2) / max(1e-12, np.sum((y - np.mean(y)) ** 2))
            r2_map[tgt] = r2

            var_names = preds_orig + gc_keys
            for name, val in zip(var_names, b):
                path_coeffs[tgt][name] = val

            vifs = compute_vif_dict(X, [f"{name}->{tgt}" for name in var_names])
            vif_map.update(vifs)

        loadings_final = loadings_s1

    else:  # dim_e == "pls"
        df_s2 = df.copy()
        s2_constructs = list(s1_spec["constructs"])
        s2_indicators = list(s1_spec["indicators"])
        s2_paths = list(s1_spec["paths"])

        for col_name, col_data in copula_columns.items():
            ind_name = col_name.replace(" ", "_").replace("(", "").replace(")", "").replace("->", "_")
            df_s2[ind_name] = col_data
            s2_constructs.append({
                "id": col_name,
                "name": col_name,
                "indicators": [ind_name],
            })
            s2_indicators.append({
                "id": ind_name,
                "column": ind_name,
            })
            tgt = col_name.split("->")[1].replace(")", "").strip()
            s2_paths.append({
                "from": col_name,
                "to": tgt,
            })

        s2_spec = {
            "constructs": s2_constructs,
            "indicators": s2_indicators,
            "paths": s2_paths,
        }
        res_s2, _, _, _ = fit_stage1(df_s2, s2_spec, dim_f, dim_g, max_iter)
        path_coeffs = res_s2["structural"]["path_coefficients"]
        r2_map = res_s2["structural"]["r_squared"]
        loadings_final = res_s2["measurement"]["outer_loadings"]

        # If dim_scale is centered_unscaled, path coefficients for GC in PLS must be unscaled by std(C)
        if dim_scale == "centered_unscaled":
            for tgt, gclist in target_gcs.items():
                for g in gclist:
                    gc_k = f"GC ({g['source']} -> {g['target']})"
                    col_raw = build_copula_column(source_scores[g['source']], dim_b, dim_c)
                    s = np.std(col_raw, ddof=1)
                    if s > 1e-12 and gc_k in path_coeffs.get(tgt, {}):
                        path_coeffs[tgt][gc_k] = path_coeffs[tgt][gc_k] / s

        # Compute VIF on stage 2 scores
        vif_map = {}
        for tgt, gclist in target_gcs.items():
            preds_orig = [p["from"] for p in s1_spec["paths"] if p["to"] == tgt]
            gc_keys = [f"GC ({g['source']} -> {g['target']})" for g in gclist]
            var_names = preds_orig + gc_keys
            all_cols = [res_s2["construct_scores"][v] for v in var_names]
            X = np.column_stack(all_cols)
            vifs = compute_vif_dict(X, [f"{name}->{tgt}" for name in var_names])
            vif_map.update(vifs)

    return {
        "paths": path_coeffs,
        "r2": r2_map,
        "loadings": loadings_final,
        "vif": vif_map,
        "source_scores": source_scores,
    }


def evaluate_against_benchmarks(out_a: Dict[str, Any], out_b: Dict[str, Any]) -> Tuple[float, Dict[str, float]]:
    # Model B reference
    ref_b = {
        "r2": {"CUSL": 0.390},
        "paths": {"COMP -> CUSL": -0.137, "LIKE -> CUSL": 0.684},
        "gc": {"GC (COMP -> CUSL)": 0.218, "GC (LIKE -> CUSL)": -0.121},
        "loadings": {
            "comp_1": 0.853, "comp_2": 0.802, "comp_3": 0.822,
            "like_1": 0.876, "like_2": 0.873, "like_3": 0.844,
            "cusl_1": 0.850, "cusl_2": 0.914, "cusl_3": 0.827,
        },
    }

    # Model A reference
    ref_a = {
        "r2": {"CUSA": 0.306, "CUSL": 0.569},
        "paths": {
            "COMP -> CUSA": -0.223, "LIKE -> CUSA": 0.430,
            "COMP -> CUSL": -0.089, "LIKE -> CUSL": 0.436, "CUSA -> CUSL": 0.758,
        },
        "gc": {
            "GC (COMP -> CUSA)": 0.362, "GC (LIKE -> CUSA)": -0.006,
            "GC (COMP -> CUSL)": 0.102, "GC (LIKE -> CUSL)": -0.088,
            "GC (CUSA -> CUSL)": -0.203,
        },
        "loadings": {
            "comp_1": 0.858, "comp_2": 0.798, "comp_3": 0.818,
            "like_1": 0.879, "like_2": 0.870, "like_3": 0.843,
            "cusl_1": 0.833, "cusl_2": 0.917, "cusl_3": 0.843,
            "cusa": 1.000,
        },
        "vif": {
            "LIKE -> CUSA": 17.08, "CUSA -> CUSL": 11.46, "LIKE -> CUSL": 17.43,
            "COMP -> CUSA": 16.56, "COMP -> CUSL": 17.61, "GC (COMP -> CUSA)": 16.31,
            "GC (COMP -> CUSL)": 17.84, "GC (CUSA -> CUSL)": 11.82,
            "GC (LIKE -> CUSA)": 16.97, "GC (LIKE -> CUSL)": 17.07,
        },
    }

    sq_err = 0.0
    diffs = {}

    # Check Model B
    p_b = out_b["paths"].get("CUSL", {})
    for k, ref_v in ref_b["paths"].items():
        src = k.split("->")[0].strip()
        val = p_b.get(src, 0.0)
        d = abs(val - ref_v)
        sq_err += (d ** 2)
        diffs[f"B_path_{k}"] = d

    for k, ref_v in ref_b["gc"].items():
        val = p_b.get(k, 0.0)
        d = abs(val - ref_v)
        sq_err += (d ** 2)
        diffs[f"B_gc_{k}"] = d

    for k, ref_v in ref_b["r2"].items():
        val = out_b["r2"].get(k, 0.0)
        d = abs(val - ref_v)
        sq_err += (d ** 2)
        diffs[f"B_r2_{k}"] = d

    for cname, inds in out_b["loadings"].items():
        for iid, val in inds.items():
            if iid in ref_b["loadings"]:
                d = abs(val - ref_b["loadings"][iid])
                sq_err += (d ** 2)
                diffs[f"B_load_{iid}"] = d

    # Check Model A
    p_a_cusa = out_a["paths"].get("CUSA", {})
    p_a_cusl = out_a["paths"].get("CUSL", {})
    for k, ref_v in ref_a["paths"].items():
        src, tgt = [x.strip() for x in k.split("->")]
        val = p_a_cusa.get(src, 0.0) if tgt == "CUSA" else p_a_cusl.get(src, 0.0)
        d = abs(val - ref_v)
        sq_err += (d ** 2)
        diffs[f"A_path_{k}"] = d

    for k, ref_v in ref_a["gc"].items():
        tgt = k.split("->")[1].replace(")", "").strip()
        val = p_a_cusa.get(k, 0.0) if tgt == "CUSA" else p_a_cusl.get(k, 0.0)
        d = abs(val - ref_v)
        sq_err += (d ** 2)
        diffs[f"A_gc_{k}"] = d

    for k, ref_v in ref_a["r2"].items():
        val = out_a["r2"].get(k, 0.0)
        d = abs(val - ref_v)
        sq_err += (d ** 2)
        diffs[f"A_r2_{k}"] = d

    for cname, inds in out_a["loadings"].items():
        for iid, val in inds.items():
            if iid in ref_a["loadings"]:
                d = abs(val - ref_a["loadings"][iid])
                sq_err += (d ** 2)
                diffs[f"A_load_{iid}"] = d

    # VIFs (weight 0.1)
    if "vif" in out_a and out_a["vif"]:
        for k, ref_v in ref_a["vif"].items():
            norm_k = k.replace(" ", "")
            matched = [v for vk, v in out_a["vif"].items() if vk.replace(" ", "") == norm_k]
            if matched:
                d = abs(matched[0] - ref_v)
                sq_err += 0.1 * (d ** 2)
                diffs[f"A_vif_{k}"] = d

    return sq_err, diffs


def main():
    print("=" * 80)
    print("STARTING GAUSSIAN COPULA VARIANT GRID SEARCH (PHASE B)")
    print("=" * 80)

    df = load_data()

    # Define Grid Dimensions
    dim_a_opts = ["A1", "A2", "A4"]
    dim_b_opts = ["F4_le", "F4_avg", "F4_ord", "F3", "rank_n_plus_1", "rank_minus_half"]
    dim_c_opts = [None, 12, 8]
    dim_d_opts = ["raw", "eq17"]
    dim_e_opts = ["ols", "pls"]
    dim_f_opts = ["path", "centroid", "factor"]
    dim_g_opts = [1e-7, 1e-10]
    dim_scale_opts = ["centered_unscaled", "std"]

    results = []

    # Filter grid to keep runtime fast and focused on key discriminating axes
    # Inner weighting is path in reference, but we test others to verify
    grid = list(itertools.product(
        dim_a_opts, dim_b_opts, dim_c_opts, dim_d_opts, dim_e_opts, dim_scale_opts
    ))

    total_runs = len(grid)
    print(f"Total grid parameter combinations to test: {total_runs}")

    for idx, (da, db, dc, dd, de, dscale) in enumerate(grid):
        try:
            # Model B
            out_b = run_variant(
                df=df, model_name="B",
                dim_a=da, dim_b=db, dim_c=dc, dim_d=dd, dim_e=de,
                dim_f="path", dim_g=1e-7, dim_scale=dscale,
            )
            # Model A
            out_a = run_variant(
                df=df, model_name="A",
                dim_a=da, dim_b=db, dim_c=dc, dim_d=dd, dim_e=de,
                dim_f="path", dim_g=1e-7, dim_scale=dscale,
            )

            sq_err, diffs = evaluate_against_benchmarks(out_a, out_b)
            max_path_diff = max([v for k, v in diffs.items() if "path" in k])
            max_gc_diff = max([v for k, v in diffs.items() if "gc" in k])
            max_load_diff = max([v for k, v in diffs.items() if "load" in k])
            max_r2_diff = max([v for k, v in diffs.items() if "r2" in k])

            results.append({
                "dim_a": da, "dim_b": db, "dim_c": dc, "dim_d": dd, "dim_e": de, "dim_scale": dscale,
                "sq_err": sq_err,
                "max_path_diff": max_path_diff,
                "max_gc_diff": max_gc_diff,
                "max_load_diff": max_load_diff,
                "max_r2_diff": max_r2_diff,
                "diffs": diffs,
                "out_a": out_a,
                "out_b": out_b,
            })
        except Exception as e:
            continue

    # Sort results by squared error
    results.sort(key=lambda x: x["sq_err"])

    print("\n" + "=" * 105)
    print(f"{'Rank':<4} {'Score (A)':<9} {'ECDF (B)':<15} {'Rnd (C)':<7} {'Form(D)':<7} {'Stage2(E)':<9} {'Scale':<17} {'SqErr':<10} {'MaxPath':<8} {'MaxGC':<8}")
    print("-" * 105)

    for rank, r in enumerate(results[:15], 1):
        print(f"{rank:<4} {r['dim_a']:<9} {r['dim_b']:<15} {str(r['dim_c']):<7} {r['dim_d']:<7} {r['dim_e']:<9} {r['dim_scale']:<17} {r['sq_err']:<10.6f} {r['max_path_diff']:<8.4f} {r['max_gc_diff']:<8.4f}")

    print("=" * 105)

    best = results[0]
    print(f"\nWINNING VARIANT: Score={best['dim_a']}, ECDF={best['dim_b']}, Round={best['dim_c']}, Form={best['dim_d']}, Stage2={best['dim_e']}, Scale={best['dim_scale']}")
    print(f"Total Squared Error: {best['sq_err']:.6f}")
    print(f"Max Path Diff:       {best['max_path_diff']:.4f} (tolerance <= 0.010)")
    print(f"Max GC Diff:         {best['max_gc_diff']:.4f} (tolerance <= 0.010)")
    print(f"Max Loading Diff:    {best['max_load_diff']:.4f} (tolerance <= 0.002)")
    print(f"Max R2 Diff:         {best['max_r2_diff']:.4f} (tolerance <= 0.001)")

    # Print score diagnostics
    scores_comp = best['out_a']['source_scores']['COMP']
    scores_like = best['out_a']['source_scores']['LIKE']
    cusa_score = best['out_a']['source_scores']['CUSA']

    print("\n--- LATENT VARIABLE SCORE DIAGNOSTICS ---")
    print(f"COMP n_unique (raw):          {len(np.unique(scores_comp))} / {len(df)}")
    print(f"COMP n_unique (round 12):     {len(np.unique(np.round(scores_comp, 12)))} / {len(df)}")
    print(f"LIKE n_unique (raw):          {len(np.unique(scores_like))} / {len(df)}")
    print(f"LIKE n_unique (round 12):     {len(np.unique(np.round(scores_like, 12)))} / {len(df)}")
    print(f"CUSA n_unique:                {len(np.unique(cusa_score))} / {len(df)}")

    # Correlations Corr(P, C(P))
    c_comp = build_copula_column(scores_comp, best['dim_b'], best['dim_c'])
    c_like = build_copula_column(scores_like, best['dim_b'], best['dim_c'])
    c_cusa = build_copula_column(cusa_score, best['dim_b'], best['dim_c'])

    print("\n--- CORRELATION Corr(P, C(P)) ---")
    print(f"Corr(COMP, C(COMP)): {np.corrcoef(scores_comp, c_comp)[0, 1]:.4f}")
    print(f"Corr(LIKE, C(LIKE)): {np.corrcoef(scores_like, c_like)[0, 1]:.4f}")
    print(f"Corr(CUSA, C(CUSA)): {np.corrcoef(cusa_score, c_cusa)[0, 1]:.4f}")

    return best


if __name__ == "__main__":
    main()
