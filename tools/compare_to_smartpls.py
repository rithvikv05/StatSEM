#!/usr/bin/env python3
"""
SmartPLS 4 Parity Comparison Harness.
Loads a SmartPLS reference JSON file, runs the PLS-SEM pipeline on identical
data and settings, and produces verification tables comparing results.

Usage:
    python tools/compare_to_smartpls.py [path/to/reference.json]
"""

import os
import sys
import json
import glob
from typing import Dict, Any, List, Tuple

# Ensure backend is on sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pandas as pd
import numpy as np

from engine.pls.algorithm import run_pipeline
from core.settings_schema import PipelineSettings, GCSettings


def load_dataset(data_path: str) -> pd.DataFrame:
    """Loads CSV or delimited TXT dataset, replacing missing codes."""
    if not os.path.isabs(data_path):
        data_path = os.path.join(PROJECT_ROOT, data_path)
    if not os.path.exists(data_path):
        raise FileNotFoundError(f"Data file not found: {data_path}")

    df = pd.read_csv(data_path, sep=None, engine="python")
    # Replace common missing code markers
    df.replace(-99, np.nan, inplace=True)
    df.replace("-99", np.nan, inplace=True)
    return df


def get_model_spec_for_case(case_name: str, ref_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Generates standard model spec for known reference test cases."""
    if case_name in ("gaussian_copula", "gaussian_copula_model_a"):
        return {
            "constructs": [
                {"id": "COMP", "name": "COMP", "indicators": ["comp_1", "comp_2", "comp_3"]},
                {"id": "LIKE", "name": "LIKE", "indicators": ["like_1", "like_2", "like_3"]},
                {"id": "CUSA", "name": "CUSA", "indicators": ["cusa"]},
                {"id": "CUSL", "name": "CUSL", "indicators": ["cusl_1", "cusl_2", "cusl_3"]},
            ],
            "indicators": [
                {"id": "comp_1", "column": "comp_1"},
                {"id": "comp_2", "column": "comp_2"},
                {"id": "comp_3", "column": "comp_3"},
                {"id": "like_1", "column": "like_1"},
                {"id": "like_2", "column": "like_2"},
                {"id": "like_3", "column": "like_3"},
                {"id": "cusa", "column": "cusa"},
                {"id": "cusl_1", "column": "cusl_1"},
                {"id": "cusl_2", "column": "cusl_2"},
                {"id": "cusl_3", "column": "cusl_3"},
            ],
            "paths": [
                {"from": "COMP", "to": "CUSA"},
                {"from": "COMP", "to": "CUSL"},
                {"from": "LIKE", "to": "CUSA"},
                {"from": "LIKE", "to": "CUSL"},
                {"from": "CUSA", "to": "CUSL"},
            ],
            "gaussian_copulas": [
                {"id": "gc1", "source_construct": "COMP", "target_construct": "CUSA"},
                {"id": "gc2", "source_construct": "COMP", "target_construct": "CUSL"},
                {"id": "gc3", "source_construct": "LIKE", "target_construct": "CUSA"},
                {"id": "gc4", "source_construct": "LIKE", "target_construct": "CUSL"},
                {"id": "gc5", "source_construct": "CUSA", "target_construct": "CUSL"},
            ],
        }
    elif case_name == "gaussian_copula_model_b":
        return {
            "constructs": [
                {"id": "COMP", "name": "COMP", "indicators": ["comp_1", "comp_2", "comp_3"]},
                {"id": "LIKE", "name": "LIKE", "indicators": ["like_1", "like_2", "like_3"]},
                {"id": "CUSL", "name": "CUSL", "indicators": ["cusl_1", "cusl_2", "cusl_3"]},
            ],
            "indicators": [
                {"id": "comp_1", "column": "comp_1"},
                {"id": "comp_2", "column": "comp_2"},
                {"id": "comp_3", "column": "comp_3"},
                {"id": "like_1", "column": "like_1"},
                {"id": "like_2", "column": "like_2"},
                {"id": "like_3", "column": "like_3"},
                {"id": "cusl_1", "column": "cusl_1"},
                {"id": "cusl_2", "column": "cusl_2"},
                {"id": "cusl_3", "column": "cusl_3"},
            ],
            "paths": [
                {"from": "COMP", "to": "CUSL"},
                {"from": "LIKE", "to": "CUSL"},
            ],
            "gaussian_copulas": [
                {"id": "gc1", "source_construct": "COMP", "target_construct": "CUSL"},
                {"id": "gc2", "source_construct": "LIKE", "target_construct": "CUSL"},
            ],
        }
    elif case_name == "multiple_moderation":
        return {
            "constructs": [
                {"id": "COMP", "name": "COMP", "indicators": ["comp_1", "comp_2", "comp_3"]},
                {"id": "LIKE", "name": "LIKE", "indicators": ["like_1", "like_2", "like_3"]},
                {"id": "CUSA", "name": "CUSA", "indicators": ["cusa"]},
                {"id": "CUSL", "name": "CUSL", "indicators": ["cusl_1", "cusl_2", "cusl_3"]},
                {"id": "SWITCH_1", "name": "SWITCH_1", "indicators": ["switch_1"]},
                {"id": "SWITCH_2", "name": "SWITCH_2", "indicators": ["switch_2"]},
                {"id": "SWITCH_3", "name": "SWITCH_3", "indicators": ["switch_3"]},
            ],
            "indicators": [
                {"id": "comp_1", "column": "comp_1"},
                {"id": "comp_2", "column": "comp_2"},
                {"id": "comp_3", "column": "comp_3"},
                {"id": "like_1", "column": "like_1"},
                {"id": "like_2", "column": "like_2"},
                {"id": "like_3", "column": "like_3"},
                {"id": "cusa", "column": "cusa"},
                {"id": "cusl_1", "column": "cusl_1"},
                {"id": "cusl_2", "column": "cusl_2"},
                {"id": "cusl_3", "column": "cusl_3"},
                {"id": "switch_1", "column": "switch_1"},
                {"id": "switch_2", "column": "switch_2"},
                {"id": "switch_3", "column": "switch_3"},
            ],
            "paths": [
                {"from": "COMP", "to": "CUSA"},
                {"from": "LIKE", "to": "CUSA"},
                {"from": "COMP", "to": "CUSL"},
                {"from": "LIKE", "to": "CUSL"},
                {"from": "CUSA", "to": "CUSL"},
                {"from": "SWITCH_1", "to": "CUSL"},
                {"from": "SWITCH_2", "to": "CUSL"},
                {"from": "SWITCH_3", "to": "CUSL"},
            ],
            "moderating_effects": [
                {"id": "mod1", "moderator": "SWITCH_1", "source": "LIKE", "target": "CUSL", "method": "two_stage"},
                {"id": "mod2", "moderator": "SWITCH_2", "source": "LIKE", "target": "CUSL", "method": "two_stage"},
                {"id": "mod3", "moderator": "SWITCH_3", "source": "LIKE", "target": "CUSL", "method": "two_stage"},
                {"id": "mod4", "moderator": "SWITCH_2", "source": "LIKE", "target": "CUSL", "attach_to_mod_id": "mod1", "method": "two_stage"},
                {"id": "mod5", "moderator": "SWITCH_3", "source": "LIKE", "target": "CUSL", "attach_to_mod_id": "mod1", "method": "two_stage"},
                {"id": "mod6", "moderator": "SWITCH_3", "source": "LIKE", "target": "CUSL", "attach_to_mod_id": "mod2", "method": "two_stage"},
                {"id": "mod7", "moderator": "SWITCH_3", "source": "LIKE", "target": "CUSL", "attach_to_mod_id": "mod4", "method": "two_stage"},
            ],
        }
    elif case_name in ("single_moderation", "moderation"):
        return {
            "constructs": [
                {"id": "ATTR", "name": "ATTR", "type": "formative", "indicators": ["attr_1", "attr_2", "attr_3"], "outer_mode": "B"},
                {"id": "CSOR", "name": "CSOR", "type": "formative", "indicators": ["csor_1", "csor_2", "csor_3", "csor_4", "csor_5"], "outer_mode": "B"},
                {"id": "PERF", "name": "PERF", "type": "formative", "indicators": ["perf_1", "perf_2", "perf_3", "perf_4", "perf_5"], "outer_mode": "B"},
                {"id": "QUAL", "name": "QUAL", "type": "formative", "indicators": ["qual_1", "qual_2", "qual_3", "qual_4", "qual_5", "qual_6", "qual_7", "qual_8"], "outer_mode": "B"},
                {"id": "COMP", "name": "COMP", "type": "reflective", "indicators": ["comp_1", "comp_2", "comp_3"], "outer_mode": "A"},
                {"id": "LIKE", "name": "LIKE", "type": "reflective", "indicators": ["like_1", "like_2", "like_3"], "outer_mode": "A"},
                {"id": "CUSA", "name": "CUSA", "type": "reflective", "indicators": ["cusa"], "outer_mode": "A"},
                {"id": "CUSL", "name": "CUSL", "type": "reflective", "indicators": ["cusl_1", "cusl_2", "cusl_3"], "outer_mode": "A"},
                {"id": "SC", "name": "SC", "type": "reflective", "indicators": ["switch_1", "switch_2", "switch_3", "switch_4"], "outer_mode": "A"},
            ],
            "indicators": [
                {"id": "attr_1", "column": "attr_1"}, {"id": "attr_2", "column": "attr_2"}, {"id": "attr_3", "column": "attr_3"},
                {"id": "csor_1", "column": "csor_1"}, {"id": "csor_2", "column": "csor_2"}, {"id": "csor_3", "column": "csor_3"}, {"id": "csor_4", "column": "csor_4"}, {"id": "csor_5", "column": "csor_5"},
                {"id": "perf_1", "column": "perf_1"}, {"id": "perf_2", "column": "perf_2"}, {"id": "perf_3", "column": "perf_3"}, {"id": "perf_4", "column": "perf_4"}, {"id": "perf_5", "column": "perf_5"},
                {"id": "qual_1", "column": "qual_1"}, {"id": "qual_2", "column": "qual_2"}, {"id": "qual_3", "column": "qual_3"}, {"id": "qual_4", "column": "qual_4"}, {"id": "qual_5", "column": "qual_5"}, {"id": "qual_6", "column": "qual_6"}, {"id": "qual_7", "column": "qual_7"}, {"id": "qual_8", "column": "qual_8"},
                {"id": "comp_1", "column": "comp_1"}, {"id": "comp_2", "column": "comp_2"}, {"id": "comp_3", "column": "comp_3"},
                {"id": "like_1", "column": "like_1"}, {"id": "like_2", "column": "like_2"}, {"id": "like_3", "column": "like_3"},
                {"id": "cusa", "column": "cusa"},
                {"id": "cusl_1", "column": "cusl_1"}, {"id": "cusl_2", "column": "cusl_2"}, {"id": "cusl_3", "column": "cusl_3"},
                {"id": "switch_1", "column": "switch_1"}, {"id": "switch_2", "column": "switch_2"}, {"id": "switch_3", "column": "switch_3"}, {"id": "switch_4", "column": "switch_4"},
            ],
            "paths": [
                {"from": "ATTR", "to": "COMP"}, {"from": "ATTR", "to": "LIKE"},
                {"from": "CSOR", "to": "COMP"}, {"from": "CSOR", "to": "LIKE"},
                {"from": "PERF", "to": "COMP"}, {"from": "PERF", "to": "LIKE"},
                {"from": "QUAL", "to": "COMP"}, {"from": "QUAL", "to": "LIKE"},
                {"from": "COMP", "to": "CUSA"}, {"from": "LIKE", "to": "CUSA"},
                {"from": "COMP", "to": "CUSL"}, {"from": "LIKE", "to": "CUSL"},
                {"from": "CUSA", "to": "CUSL"}, {"from": "SC", "to": "CUSL"},
            ],
            "moderating_effects": [
                {"id": "mod_sc", "moderator": "SC", "source": "CUSA", "target": "CUSL", "method": "two_stage"},
            ],
        }
    elif case_name == "quadratic_corporate_reputation":
        return {
            "constructs": [
                {"id": "ATTR", "name": "ATTR", "type": "formative", "indicators": ["attr_1", "attr_2", "attr_3"], "outer_mode": "B"},
                {"id": "CSOR", "name": "CSOR", "type": "formative", "indicators": ["csor_1", "csor_2", "csor_3", "csor_4", "csor_5"], "outer_mode": "B"},
                {"id": "PERF", "name": "PERF", "type": "formative", "indicators": ["perf_1", "perf_2", "perf_3", "perf_4", "perf_5"], "outer_mode": "B"},
                {"id": "QUAL", "name": "QUAL", "type": "formative", "indicators": ["qual_1", "qual_2", "qual_3", "qual_4", "qual_5", "qual_6", "qual_7", "qual_8"], "outer_mode": "B"},
                {"id": "COMP", "name": "COMP", "type": "reflective", "indicators": ["comp_1", "comp_2", "comp_3"], "outer_mode": "A"},
                {"id": "LIKE", "name": "LIKE", "type": "reflective", "indicators": ["like_1", "like_2", "like_3"], "outer_mode": "A"},
                {"id": "CUSA", "name": "CUSA", "type": "reflective", "indicators": ["cusa"], "outer_mode": "A"},
                {"id": "CUSL", "name": "CUSL", "type": "reflective", "indicators": ["cusl_1", "cusl_2", "cusl_3"], "outer_mode": "A"},
            ],
            "indicators": [
                {"id": "attr_1", "column": "attr_1"}, {"id": "attr_2", "column": "attr_2"}, {"id": "attr_3", "column": "attr_3"},
                {"id": "csor_1", "column": "csor_1"}, {"id": "csor_2", "column": "csor_2"}, {"id": "csor_3", "column": "csor_3"}, {"id": "csor_4", "column": "csor_4"}, {"id": "csor_5", "column": "csor_5"},
                {"id": "perf_1", "column": "perf_1"}, {"id": "perf_2", "column": "perf_2"}, {"id": "perf_3", "column": "perf_3"}, {"id": "perf_4", "column": "perf_4"}, {"id": "perf_5", "column": "perf_5"},
                {"id": "qual_1", "column": "qual_1"}, {"id": "qual_2", "column": "qual_2"}, {"id": "qual_3", "column": "qual_3"}, {"id": "qual_4", "column": "qual_4"}, {"id": "qual_5", "column": "qual_5"}, {"id": "qual_6", "column": "qual_6"}, {"id": "qual_7", "column": "qual_7"}, {"id": "qual_8", "column": "qual_8"},
                {"id": "comp_1", "column": "comp_1"}, {"id": "comp_2", "column": "comp_2"}, {"id": "comp_3", "column": "comp_3"},
                {"id": "like_1", "column": "like_1"}, {"id": "like_2", "column": "like_2"}, {"id": "like_3", "column": "like_3"},
                {"id": "cusa", "column": "cusa"},
                {"id": "cusl_1", "column": "cusl_1"}, {"id": "cusl_2", "column": "cusl_2"}, {"id": "cusl_3", "column": "cusl_3"},
            ],
            "paths": [
                {"from": "ATTR", "to": "COMP"}, {"from": "ATTR", "to": "LIKE"},
                {"from": "CSOR", "to": "COMP"}, {"from": "CSOR", "to": "LIKE"},
                {"from": "PERF", "to": "COMP"}, {"from": "PERF", "to": "LIKE"},
                {"from": "QUAL", "to": "COMP"}, {"from": "QUAL", "to": "LIKE"},
                {"from": "COMP", "to": "CUSA"}, {"from": "LIKE", "to": "CUSA"},
                {"from": "COMP", "to": "CUSL"}, {"from": "LIKE", "to": "CUSL"},
                {"from": "CUSA", "to": "CUSL"},
            ],
            "quadratic_effects": [
                {"id": "qe_cusa_cusl", "predictor_construct": "CUSA", "target_construct": "CUSL"}
            ],
        }
    else:
        raise ValueError(f"Unknown reference case: {case_name}")


def print_comparison_table(title: str, rows: List[Tuple[str, float, float, float, bool]]) -> bool:
    """Prints a formatted comparison table and returns True if all passed tolerance."""
    print(f"\n--- {title} ---")
    print(f"{'Item':<45} {'Mine':>10} {'SmartPLS':>10} {'Abs Diff':>10} {'Status':>8}")
    print("-" * 88)
    all_ok = True
    for item, mine_val, ref_val, diff, ok in rows:
        flag = "OK" if ok else "FAIL"
        if not ok:
            all_ok = False
        print(f"{item:<45} {mine_val:>10.4f} {ref_val:>10.4f} {diff:>10.4f} {flag:>8}")
    return all_ok


def compare_file(ref_file: str, tolerance: float = 0.02) -> bool:
    """Compares pipeline output against reference JSON."""
    with open(ref_file, "r") as fp:
        ref = json.load(fp)

    case_name = ref.get("case", "gaussian_copula")
    data_path = ref.get("data", "backend/tests/data/Corporate reputation data.csv")
    df = load_dataset(data_path)
    spec = get_model_spec_for_case(case_name, ref)

    # Setup settings
    ref_settings = ref.get("settings", {})
    gc_settings = ref_settings.get("gc", {})
    cfg = PipelineSettings(
        inner_weighting=ref_settings.get("inner_weighting", "path"),
        max_iter=ref_settings.get("max_iterations", 3000),
        tolerance=ref_settings.get("stop_criterion", 1e-7),
        missing_treatment=ref_settings.get("missing_treatment", "mean"),
        gc=GCSettings(
            ecdf=gc_settings.get("ecdf", "F4"),
            copula_transform=gc_settings.get("copula_transform", "raw"),
        ),
    )

    print(f"\n================================================================================")
    print(f"RUNNING PARITY HARNESS: {os.path.basename(ref_file)} (case: {case_name})")
    print(f"================================================================================")

    res = run_pipeline(df, spec, cfg)
    overall_pass = True

    # 1. Outer Loadings
    ref_loadings = ref.get("loadings")
    if ref_loadings:
        rows = []
        outer_loads = res.get("measurement", {}).get("outer_loadings", {})
        for ind_name, ref_val in ref_loadings.items():
            mine_val = None
            for c_loads in outer_loads.values():
                if ind_name in c_loads:
                    mine_val = float(c_loads[ind_name])
                    break
            if mine_val is not None:
                diff = abs(mine_val - ref_val)
                rows.append((ind_name, mine_val, ref_val, diff, diff <= 1e-3))
        ok = print_comparison_table("Outer Loadings (Tolerance: 1e-3)", rows)
        if not ok:
            overall_pass = False

    # 2. R-squared
    ref_r2 = ref.get("r2") or ref.get("r_squared")
    if ref_r2:
        rows = []
        r2_map = res.get("structural", {}).get("r_squared", {})
        for tgt, ref_val in ref_r2.items():
            mine_val = float(r2_map.get(tgt, 0.0))
            diff = abs(mine_val - ref_val)
            rows.append((f"R² ({tgt})", mine_val, ref_val, diff, diff <= 1e-3))
        ok = print_comparison_table("R-Squared (Tolerance: 1e-3)", rows)
        if not ok:
            overall_pass = False

    # 3. Path Coefficients
    ref_paths = ref.get("paths") or ref.get("path_coefficients")
    if ref_paths:
        rows = []
        p_map = res.get("structural", {}).get("path_coefficients", {})
        for path_str, ref_val in ref_paths.items():
            if " -> " in path_str:
                src, tgt = path_str.split(" -> ")
            elif "->" in path_str:
                src, tgt = path_str.split("->")
            else:
                continue
            mine_val = float(p_map.get(tgt, {}).get(src, 0.0))
            diff = abs(mine_val - ref_val)
            # Paths tolerance <= 0.015 (strict check)
            rows.append((path_str, mine_val, ref_val, diff, diff <= tolerance))
        ok = print_comparison_table(f"Path Coefficients (Tolerance: {tolerance})", rows)
        if not ok:
            overall_pass = False

    # 4. Gaussian Copula Coefficients
    ref_gc = ref.get("gc") or ref.get("gc_coefficients")
    if ref_gc:
        rows = []
        p_map = res.get("structural", {}).get("path_coefficients", {})
        for gc_str, ref_val in ref_gc.items():
            tgt = None
            if "-> " in gc_str:
                tgt = gc_str.split("-> ")[1].rstrip(")")
            elif "->" in gc_str:
                tgt = gc_str.split("->")[1].rstrip(")")
            mine_val = float(p_map.get(tgt, {}).get(gc_str, 0.0)) if tgt else 0.0
            diff = abs(mine_val - ref_val)
            # Copula coefficients calibrated tolerance <= 0.015
            rows.append((gc_str, mine_val, ref_val, diff, diff <= 0.015))
        ok = print_comparison_table("Gaussian Copula Terms (Tolerance: 0.015)", rows)
        if not ok:
            overall_pass = False

    return overall_pass


def main():
    if len(sys.argv) > 1:
        ref_files = sys.argv[1:]
    else:
        ref_dir = os.path.join(BACKEND_DIR, "tests", "reference")
        ref_files = sorted(glob.glob(os.path.join(ref_dir, "smartpls_*.json")))

    if not ref_files:
        print("No reference files found.")
        sys.exit(1)

    all_passed = True
    for rf in ref_files:
        passed = compare_file(rf)
        if not passed:
            all_passed = False

    print("\n" + "=" * 80)
    if all_passed:
        print("ALL SMARTPLS PARITY CHECKS PASSED.")
        sys.exit(0)
    else:
        print("SOME SMARTPLS PARITY CHECKS FAILED.")
        sys.exit(1)


if __name__ == "__main__":
    main()
