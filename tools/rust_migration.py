"""Capture the Python reference and compare native Rust primitives.

Run with backend/venv/bin/python tools/rust_migration.py baseline|verify.
Only writes beneath migration/. Does not start the server or touch project files.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import io
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
OUTPUT = ROOT / "migration"


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def register_corrections(files):
    """Explicitly register authorized fixes; never infer new approved hashes."""
    baseline = json.loads((OUTPUT / "baseline.json").read_text())
    path = OUTPUT / "reference-corrections.json"
    corrections = json.loads(path.read_text()) if path.exists() else {}
    for name in files:
        original = baseline["source_sha256"].get(name)
        if original is None or not name.startswith("backend/"):
            raise SystemExit(f"Not a baselined backend file: {name}")
        snapshot = OUTPUT / "python-reference-v1" / name.removeprefix("backend/")
        if not snapshot.exists() or hashlib.sha256(snapshot.read_bytes()).hexdigest() != original:
            raise SystemExit(f"Missing or changed original snapshot: {snapshot}")
        corrections[name] = {"original_sha256":original,"corrected_sha256":hashlib.sha256((ROOT / name).read_bytes()).hexdigest(),
                             "original_snapshot":str(snapshot.relative_to(ROOT)),"authorization":"User explicitly authorized fixing confirmed Python mistakes during migration."}
    write_json(path,corrections)
    print(f"Registered {len(files)} explicit reference corrections; original baseline preserved.")


def check_reference():
    baseline = json.loads((OUTPUT / "baseline.json").read_text())
    correction_path = OUTPUT / "reference-corrections.json"
    corrections = json.loads(correction_path.read_text()) if correction_path.exists() else {}
    for name, digest in baseline["source_sha256"].items():
        current = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        if current == digest:
            continue
        correction = corrections.get(name,{})
        snapshot = ROOT / correction.get("original_snapshot", "missing-reference-snapshot")
        if correction.get("original_sha256") != digest or correction.get("corrected_sha256") != current or not snapshot.is_file() or hashlib.sha256(snapshot.read_bytes()).hexdigest() != digest:
            raise SystemExit(f"Unregistered Python reference change: {name}")


def capture_baseline():
    import importlib.metadata
    import numpy as np

    destination = OUTPUT / "baseline.json"
    if destination.exists():
        raise SystemExit("Baseline already exists; preserve it rather than replacing the reference.")
    inventory = []
    hashes = {}
    for source in sorted((ROOT / "backend").rglob("*.py")):
        relative = source.relative_to(ROOT).as_posix()
        if any(part in {"venv", "build", "dist", "__pycache__", "~"} for part in source.parts):
            continue
        content = source.read_bytes()
        hashes[relative] = hashlib.sha256(content).hexdigest()
        tree = ast.parse(content, filename=relative)
        entries = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                entries.append({"name": node.name, "line": node.lineno, "kind": type(node).__name__,
                                "decorators": [ast.unparse(d) for d in node.decorator_list]})
        inventory.append({"file": relative, "definitions": entries})
    config = io.StringIO()
    with redirect_stdout(config):
        np.show_config()
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=ROOT, text=True)
    packages = {d.metadata["Name"]: d.version for d in importlib.metadata.distributions() if d.metadata["Name"]}
    OUTPUT.mkdir(exist_ok=True)
    write_json(OUTPUT / "inventory.json", inventory)
    write_json(destination, {"python": sys.version, "executable": sys.executable,
                            "platform": platform.platform(), "machine": platform.machine(),
                            "git_head": git("rev-parse", "HEAD").strip(), "git_status": git("status", "--short"),
                            "tracked_diff": git("diff", "--binary", "HEAD"),
                            "packages": packages, "numpy_config": config.getvalue(),
                            "thread_environment": {k: os.environ.get(k) for k in ["OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"]},
                            "source_sha256": hashes})
    print(f"Captured {len(hashes)} Python files and installed dependency versions.")


def cases():
    import numpy as np
    rng = np.random.default_rng(8127)
    for size in [1, 2, 3, 5, 8, 17, 128, 344, 1025]:
        x = rng.normal(size=size).tolist()
        y = rng.normal(size=size).tolist()
        for weights in [None, [1.0] * size, rng.uniform(0.01, 10, size=size).tolist()]:
            for ddof in [0, 1]:
                yield {"op": "moments", "x": x, "weights": weights, "ddof": ddof}
            yield {"op": "correlation", "x": x, "y": y, "weights": weights}
            yield {"op": "standardize", "x": [[a, b, 7.0] for a, b in zip(x, y)], "weights": weights}
        yield {"op": "pairwise_correlation", "x": [[a, b if i % 3 else None, 7.0] for i, (a, b) in enumerate(zip(x, y))]}
    for x in [[], [4.0] * 5, [1e-9, 2e-9, 3e-9], [1e12 + i for i in range(8)]]:
        for weights in [None, [0.0] * len(x), [1.0] * len(x)]:
            yield {"op": "moments", "x": x, "weights": weights, "ddof": 0}
            yield {"op": "correlation", "x": x, "y": x, "weights": weights}
    for x, y in [([1, 2, 2, 4], [2, 2, 3]), ([3], [3]), ([], [1])]:
        yield {"op": "prob_greater", "x": x, "y": y}
    for n in [0, 1, 5, 51, 100, 5001]:
        for workers in [0, 1, 2, 8]:
            yield {"op": "chunk_tasks", "n_tasks": n, "n_workers": workers}


def linalg_cases():
    import numpy as np
    rng = np.random.default_rng(11293)
    for rows, columns in [(1, 1), (2, 4), (5, 2), (17, 4), (128, 9), (344, 5)]:
        matrix = rng.normal(size=(rows, columns))
        target = rng.normal(size=rows)
        for weights in [None, rng.uniform(0.1, 3, size=rows).tolist()]:
            yield {"op": "least_squares", "x": matrix.tolist(), "y": target.tolist(), "weights": weights}
    for matrix in [np.zeros((5, 3)), np.ones((8, 3)), np.array([[1., 0., 0.], [0., 1e-12, 0.], [0., 0., 1e-18]])]:
        yield {"op": "least_squares", "x": matrix.tolist(), "y": rng.normal(size=len(matrix)).tolist()}
    base = rng.normal(size=64)
    matrix = np.column_stack([base, base, rng.normal(size=64)])
    yield {"op": "least_squares", "x": matrix.tolist(), "y": rng.normal(size=64).tolist()}


def estimator_cases():
    import copy
    import numpy as np
    from core.settings_schema import PipelineSettings
    from engine.pls.algorithm import parse_model_spec, standardize_matrix
    reference = json.loads((OUTPUT / "pls-reference.json").read_text())
    rows = np.array(reference["rows"], dtype=float)
    indices = {name: i for i, name in enumerate(reference["columns"])}

    def prepared(name, model, options):
        settings = PipelineSettings(**options)
        constructs, columns, paths = parse_model_spec(model)
        obs = rows[:, indices[settings.weight_column]] if settings.weight_column else None
        blocks = []
        for cid, construct in constructs.items():
            x = rows[:, [indices[columns[iid]] for iid in construct["indicators"]]]
            blocks.append({**construct, "data": standardize_matrix(x, obs).tolist()})
        return {"op": "estimate_pls", "case_name": name, "blocks": blocks, "paths": paths,
                "settings": settings.model_dump(mode="json"), "obs_weights": None if obs is None else obs.tolist()}

    for i, case in enumerate(reference["cases"]):
        yield prepared(f"pipeline-settings-{i}", reference["model"], case["options"])
    for weighted in [False, True]:
        model = copy.deepcopy(reference["model"])
        model["constructs"][0]["type"] = "formative"
        yield prepared(f"mode-b-weighted-{weighted}", model, {"weight_column": "survey_weight"} if weighted else {})
    model = copy.deepcopy(reference["model"])
    model["constructs"][0]["indicators"] = ["x1"]
    model["constructs"][1]["weighting"] = "sum_scores"
    yield prepared("single-item-and-mixed-sum-scores", model, {})
    model = copy.deepcopy(reference["model"])
    for construct in model["constructs"]:
        construct["weighting"] = "sum_scores"
    yield prepared("all-sum-scores", model, {})
    model = copy.deepcopy(reference["model"])
    model["constructs"][0]["weighting"] = "predefined"
    model["constructs"][0]["predefined_weights"] = {"x1": -0.3, "x2": 0.8, "x3": 1.2}
    yield prepared("predefined-initial-weights", model, {})
    yield prepared("individual-initial-weights", reference["model"], {"initial_weights": "individual", "individual_initial_weights": {"x1": -0.3, "m2": 0.8}})
    yield prepared("no-sign-alignment", reference["model"], {"initial_weights": "lohmoller", "sign_convention": "none"})
    yield prepared("non-convergence-limit", reference["model"], {"max_iter": 1, "tolerance": 1e-12})
    model = copy.deepcopy(reference["model"])
    model["paths"] = []
    yield prepared("disconnected-constructs", model, {})
    model["constructs"] = model["constructs"][:1]
    yield prepared("single-construct", model, {})
    model = copy.deepcopy(reference["model"])
    model["constructs"][0]["indicators"] = ["x1", "x1", "x2"]
    model["constructs"][0]["type"] = "formative"
    yield prepared("rank-deficient-formative", model, {})
    case = prepared("constant-construct", reference["model"], {})
    case["blocks"][0]["data"] = np.zeros((len(rows), 3)).tolist()
    yield case


def estimator_benchmarks():
    """Real-data core checks and degenerate/tie cases beyond the initial corpus."""
    import copy
    import numpy as np
    import pandas as pd
    from core.settings_schema import PipelineSettings
    from engine.pls.algorithm import parse_model_spec, standardize_matrix
    path = ROOT / "backend/tests/data/Corporate reputation data.csv"
    frame = pd.read_csv(path, sep=";").replace(-99, np.nan)
    groups = {"COMP": ["comp_1", "comp_2", "comp_3"], "LIKE": ["like_1", "like_2", "like_3"],
              "CUSA": ["cusa"], "CUSL": ["cusl_1", "cusl_2", "cusl_3"]}
    simple_paths = [["COMP", "CUSA"], ["LIKE", "CUSA"], ["COMP", "CUSL"], ["LIKE", "CUSL"], ["CUSA", "CUSL"]]
    for extended in [False, True]:
        groups = copy.deepcopy(groups)
        paths = copy.deepcopy(simple_paths)
        if extended:
            groups.update({"QUAL": [f"qual_{i}" for i in range(1, 9)], "PERF": [f"perf_{i}" for i in range(1, 6)],
                           "CSOR": [f"csor_{i}" for i in range(1, 6)], "ATTR": [f"attr_{i}" for i in range(1, 4)]})
            paths.extend([[source, target] for source in ["QUAL", "PERF", "CSOR", "ATTR"] for target in ["COMP", "LIKE"]])
        for treatment in ["mean", "listwise"]:
            used = list(dict.fromkeys(column for columns in groups.values() for column in columns))
            data = frame[used].copy()
            data = data.fillna(data.mean()) if treatment == "mean" else data.dropna()
            for scheme in ["path", "factor", "centroid"]:
                for formative in [False, True] if extended else [False]:
                    model = {"constructs": [{"id": cid, "type": "formative" if formative and cid in ["QUAL", "PERF", "CSOR", "ATTR"] else "reflective", "indicators": indicators} for cid, indicators in groups.items()]}
                    constructs, _, _ = parse_model_spec(model)
                    settings = PipelineSettings(inner_weighting=scheme)
                    blocks = [{**c, "data": standardize_matrix(data[c["indicators"]].to_numpy(dtype=float)).tolist()} for c in constructs.values()]
                    yield {"op": "estimate_pls", "case_name": f"corporate-extended-{extended}-{treatment}-{scheme}-formative-{formative}", "blocks": blocks, "paths": paths, "settings": settings.model_dump(mode="json"), "obs_weights": None,
                           "dataset_sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    original = next(estimator_cases())
    for name, mutation in [
        ("single-constant-construct", "single"), ("negative-dominant-loadings", "negative"),
        ("constant-single-indicator", "indicator"), ("perfectly-collinear-constructs", "collinear")]:
        case = copy.deepcopy(original)
        case["case_name"] = name
        if mutation == "single":
            case["blocks"] = case["blocks"][:1]
            case["blocks"][0]["data"] = np.zeros((128, 3)).tolist()
            case["paths"] = []
        elif mutation == "negative":
            case["blocks"][0]["data"] = (-np.array(case["blocks"][0]["data"])).tolist()
            case["settings"]["initial_weights"] = "individual"
            case["settings"]["individual_initial_weights"] = {"x1": -1., "x2": -1., "x3": -1.}
        elif mutation == "indicator":
            case["blocks"][0]["indicators"] = ["x1"]
            case["blocks"][0]["data"] = np.zeros((128, 1)).tolist()
        else:
            case["blocks"][1]["data"] = copy.deepcopy(case["blocks"][0]["data"])
        yield case


def pipeline_cases():
    import copy
    reference = json.loads((OUTPUT / "pls-reference.json").read_text())
    base = {"op":"run_pipeline", "columns":reference["columns"], "rows":reference["rows"], "spec":reference["model"]}
    for i, case in enumerate(reference["cases"]):
        yield {**base, "case_name":f"frozen-pipeline-{i}", "settings":case["options"]}
    for treatment in ["mean","listwise","pairwise","em","knn"]:
        case = copy.deepcopy(base)
        case["case_name"] = f"missing-{treatment}"
        case["rows"][0][0] = None
        case["rows"][1][1] = -99
        case["rows"][2][2] = "-99"
        case["rows"][3][3] = "not numeric"
        case["settings"] = {"missing_treatment":treatment}
        yield case
    case = copy.deepcopy(base)
    case["case_name"] = "column-aliases-and-friendly-names"
    case["columns"][0] = " X1 "
    case["spec"]["constructs"][0]["name"] = "node_123"
    case["settings"] = {}
    yield case
    case = copy.deepcopy(base)
    case["case_name"] = "redundancy-pipeline"
    case["spec"]["constructs"] = case["spec"]["constructs"][:2]
    case["spec"]["constructs"][0]["type"] = "formative"
    case["spec"]["constructs"][1]["indicators"] = ["m1"]
    case["spec"]["paths"] = [{"from":"X","to":"M"}]
    case["settings"] = {}
    yield case
    for index, prepared in enumerate(estimator_benchmarks()):
        if not prepared["case_name"].startswith("corporate-"):
            continue
        # Already-prepared real-data matrices still exercise the native pipeline
        # normalization/fit composition; original missing-code inputs are below.
        case = {"op":"run_pipeline","case_name":f"real-data-{index}","columns":[],"rows":[],
                "spec":{"constructs":[],"paths":[{"from":a,"to":b} for a,b in prepared["paths"]]},"settings":{}}
        for b in prepared["blocks"]:
            start = len(case["columns"])
            case["columns"].extend(b["indicators"])
            if not case["rows"]:
                case["rows"] = [[] for _ in b["data"]]
            for row, block_row in zip(case["rows"],b["data"]): row.extend(block_row)
            case["spec"]["constructs"].append({k:v for k,v in b.items() if k != "data"})
        yield case


def matrix_cases():
    import numpy as np
    rng = np.random.default_rng(7533)
    for n in [1,2,4,9]:
        x = rng.normal(size=(n,n))
        for matrix in [x, x @ x.T + np.eye(n)*0.1]:
            yield {"op":"matrix_diagnostics","x":matrix.tolist()}
    for matrix in [[[1.,1.],[1.,1.]], [[1.,1.2],[1.2,1.]], [[1.,0.],[0.,1e-16]]]:
        yield {"op":"matrix_diagnostics","x":matrix}


def inference_cases():
    import numpy as np
    rng = np.random.default_rng(90031)
    probabilities = [1e-12, 1e-6,0.01,0.1,0.5,0.9,0.99,1-1e-6,1-1e-12]
    for df in [1,2,3,5,30,343,999,5000,1e6]:
        for i, x in enumerate([-10000,-10,-3,-1,-0.1,0,0.1,1,3,10,10000]):
            yield {"op":"distributions","x":x,"p":probabilities[i % len(probabilities)],"df":df}
    for size in [0,1,2,5,10,64,344]:
        samples = rng.normal(size=size).tolist()
        for jackknife in [None,[1.0]*10,rng.normal(size=40).tolist()]:
            for alpha in [0.01,0.05,0.1]:
                for tails in ["one","two"]:
                    yield {"op":"confidence_intervals","original":0.3,"samples":samples,"jackknife":jackknife,"alpha":alpha,"tails":tails}


def rng_cases():
    for entropy in [[0],[42],[4294967295],[12345,67890],[1,2,3,4,5,6,7,8],[]]:
        for bound in [1,2,3,344,2147483649,4294967296,4294967297,9223372036854775825,18446744073709551615]:
            yield {"op":"rng_diagnostics","entropy":entropy,"words":37,"bound":bound,"count":41}


def bootstrap_cases():
    import copy
    reference = json.loads((OUTPUT / "pls-reference.json").read_text())
    for sign in ["none","individual","construct"]:
        for ci in ["percentile","bias_corrected","bca"]:
            yield {"op":"bootstrap","case_name":f"bootstrap-{sign}-{ci}","columns":reference["columns"],
                   "rows":reference["rows"][:24],"spec":reference["model"],
                   "options":{"n_boot":12,"seed":42,"n_workers":2,"sign_change":sign,"ci_method":ci}}
    for options in [{"n_boot":0},{"mode":"basic","tails":"one","test_distribution":"normal"},{"seed":None,"sign_alignment":True}]:
        settings = {"n_boot":8,"n_workers":2,"ci_method":"percentile",**options}
        yield {"op":"bootstrap","case_name":f"bootstrap-options-{options}","columns":reference["columns"],
               "rows":reference["rows"][:24],"spec":reference["model"],"options":settings}


def imputation_cases():
    import numpy as np
    rng = np.random.default_rng(1388)
    for n,p in [(8,1),(12,3),(40,5)]:
        x = rng.normal(size=(n,p))
        mask = rng.random((n,p)) < 0.2
        mask[0] = False
        x[mask] = np.nan
        for method in ["mean","knn","em"]:
            yield {"op":"impute_numeric","x":np.where(np.isnan(x),None,x).tolist(),"method":method,"max_iter":100,"tol":1e-4,"k":5}
    tied = [[None,0.,0.]]+[[float(i),0.,0.] for i in range(1,31)]
    for method in ["mean","knn","em"]:
        yield {"op":"impute_numeric","x":tied,"method":method,"max_iter":100,"tol":1e-4,"k":5}
    for method in ["mean","knn"]:
        yield {"op":"impute_numeric","x":[[None,1.],[None,2.],[None,3.]],"method":method,"max_iter":100,"tol":1e-4,"k":5}


def sorting_cases():
    import numpy as np
    rng = np.random.default_rng(9022)
    for n in [0,1,7,15,16,17,30,100,1024]:
        for x in [rng.normal(size=n),rng.integers(0,5,size=n).astype(float),np.zeros(n),np.arange(n,dtype=float)[::-1]]:
            yield {"op":"argsort","x":x.tolist()}
    yield {"op":"argsort","x":[1.0,None,0.0,None,-1.0]*20}


def analysis_cases():
    import copy
    reference = json.loads((OUTPUT / "pls-reference.json").read_text())
    base = {"columns":reference["columns"],"rows":reference["rows"][:24],"spec":reference["model"],"settings":{}}
    for alpha in [0.05,0.1]:
        yield {**base,"op":"mediation","case_name":f"mediation-{alpha}","source":"X","target":"Y","options":{"n_boot":12,"seed":42,"alpha":alpha,"include_sobel":True}}
    for target in ["M","Y"]:
        for level in ["construct","indicator","both"]:
            yield {**base,"op":"ipma","case_name":f"ipma-{target}-{level}","target":target,"level":level,"scale_bounds":{}}
    case = copy.deepcopy(base)
    case.update({"op":"ipma","case_name":"ipma-bounds","target":"Y","level":"both","scale_bounds":{"x1":[-3.,3.],"m2":[-2.,2.]}})
    yield case
    case = copy.deepcopy(base)
    case["spec"]["constructs"][0]["type"] = "formative"
    case.update({"op":"ipma","case_name":"ipma-formative","target":"Y","level":"both","scale_bounds":{}})
    yield case


def blindfolding_cases():
    import copy
    reference = json.loads((OUTPUT / "pls-reference.json").read_text())
    base = {"op":"blindfolding","columns":reference["columns"],"rows":reference["rows"][:32],"spec":reference["model"],"settings":{}}
    for distance in [5,7,9]:
        for effects in [False,True]:
            yield {**base,"case_name":f"blindfold-{distance}-{effects}","options":{"omission_distance":distance,"compute_q2_effects":effects}}
    case = copy.deepcopy(base)
    case["case_name"] = "blindfold-formative-and-missing"
    case["spec"]["constructs"][0]["type"] = "formative"
    case["rows"][0][0] = -99
    case["rows"][2][4] = None
    case["options"] = {"omission_distance":7,"compute_q2_effects":True}
    yield case


def permutation_cases():
    for entropy in [[0],[42],[12345,67890]]:
        for n in [0,1,2,5,17,128,344,1025]:
            yield {"op":"permutation","entropy":entropy,"n":n}


def prediction_cases():
    import copy
    reference = json.loads((OUTPUT / "pls-reference.json").read_text())
    base = {"op":"predict","columns":reference["columns"],"rows":reference["rows"][:64],"spec":reference["model"],"settings":{}}
    for folds,repetitions in [(3,2),(10,1),(100,1),(3,0)]:
        yield {**base,"case_name":f"predict-{folds}-{repetitions}","options":{"k_folds":folds,"repetitions":repetitions,"seed":42}}
    case = copy.deepcopy(base)
    case["rows"][0][0] = None
    case["rows"][1][1] = -99
    case["case_name"] = "predict-missing"
    case["options"] = {"k_folds":3,"repetitions":1,"seed":123,"antecedents":"all"}
    yield case


def derivation_type_cases():
    for operation in ["mean_replace","knn_impute","em_impute"]:
        for rows in [[[True,1,"a"],[False,2,"b"]],[[True,1.,"a"],[False,None,"b"],[True,3.,"c"]]]:
            yield {"op":"derive","columns":["flag","x","category"],"rows":rows,"operation":operation,"params":{}}


def categorical_group_cases():
    for values,minimum,predictors in [(["a"]*12+["b"]*23+["c"]*55+[None],10,2),([1]*9+[2]*21+[-99,None],10,2),([1.5]*14+[2.5]*60,5,3),(["can't","two\nlines","can't",None],1,2),([-99,None],10,2),([],10,2),([True,False,True],1,0)]:
        yield {"op":"categorical_groups","columns":["group"],"rows":[[v] for v in values],"column":"group","minimum":minimum,"predictors":predictors}


def derivation_cases():
    rows=[[1.,4.,"a"],[2.,None,"b"],[None,6.,"a"],[4.,8.,None],[5.,10.,"b"],[6.,12.,"a"]]
    for operation,params in [("filter_rows",{"filters":[{"column":"x","op":">=","value":2},{"column":"group","op":"not_in","value":["b"]}]}),("filter_rows",{"filters":[{"column":"group","op":"in","value":["a",None]}]}),("filter_rows",{"filters":[{"column":"x","op":"!=","value":2}]}),("select_columns",{"columns":["group","x","missing"]}),("select_columns",{"columns":[]}),("casewise_deletion",{}),("casewise_deletion",{"columns":["x","y"],"max_missing_pct":50}),("casewise_deletion",{"columns":[],"max_missing_pct":10}),("remove_cases",{"row_indices":[0,2,8,-1]}),("mean_replace",{}),("mean_replace",{"columns":["y"]}),("em_impute",{"max_iter":20}),("knn_impute",{"k":2}),("knn_impute",{"columns":["y","x"],"k":2}),("median_split",{"column":"y","group":"low"}),("median_split",{"column":"x"}),("mean_split",{"column":"y","group":"low"}),("mean_split",{"column":"x"})]:
        yield {"op":"derive","columns":["x","y","group"],"rows":rows,"operation":operation,"params":params}


def copula_pipeline_cases():
    import copy
    reference=json.loads((OUTPUT/"pls-reference.json").read_text())
    for mode in ["raw","f3","eq17","standardized","consistent","listwise"]:
        case={"op":"run_pipeline","case_name":mode,"columns":reference["columns"],"rows":copy.deepcopy(reference["rows"][:64]),"spec":copy.deepcopy(reference["model"]),"settings":{}}
        case["spec"]["gaussian_copulas"]=[{"source":"X","target":"Y"}]
        if mode=="f3":case["settings"]={"gc":{"ecdf":"F3"}}
        if mode=="eq17":case["settings"]={"gc":{"copula_transform":"eq17"}}
        if mode=="standardized":case["settings"]={"gc":{"scale_normalization":"standardized"}}
        if mode=="consistent":case["settings"]={"consistent":True}
        if mode=="listwise":case["settings"]={"missing_treatment":"listwise"};case["rows"][3][0]=None;case["rows"][7][1]=-99
        yield case


def copula_bootstrap_cases():
    for i,case in enumerate(copula_pipeline_cases()):
        if i not in [0,1]:continue
        case["op"]="bootstrap";case["options"]={"n_boot":8,"seed":42,"n_workers":2,"sign_change":"none","ci_method":"percentile"};case.pop("settings")
        yield case


def copula_integration_cases():
    import copy
    base=next(copula_pipeline_cases())
    for mode in ["two-sources","two-targets","display-aliases","moderation","collinear"]:
        case=copy.deepcopy(base);case["case_name"]=mode
        if mode=="two-sources":case["spec"]["gaussian_copulas"].append({"source":"M","target":"Y"})
        if mode=="two-targets":case["spec"]["gaussian_copulas"].append({"source":"X","target":"M"})
        if mode=="display-aliases":
            case["spec"]["constructs"][0]["name"]="Predictor"
            case["spec"]["constructs"][2]["name"]="Outcome"
            case["spec"]["gaussian_copulas"]=[{"sourceConstruct":"Predictor","targetConstruct":"Outcome"}]
        if mode=="moderation":case["spec"]["moderating_effects"]=[{"source":"X","moderator":"M","target":"Y"}];case["settings"]={"gc":{"copula_transform":"eq17"}}
        if mode=="collinear":
            case["settings"]={"gc":{"copula_transform":"eq17"}}
            for row in case["rows"]:row[3:6]=row[:3]
        yield case


def copula_wald_cases():
    import numpy as np
    rng=np.random.default_rng(381)
    for k in [1,2,3,4,7]:
        terms=[f"gc{i}" for i in range(k)]
        yield {"op":"copula_wald","coefficients":{c:float(rng.uniform(.01,.15)) for c in terms},"samples":{f"path:{c}->Y":rng.normal(scale=.1,size=40).tolist() for c in terms},"targets":{"Y":terms}}
    yield {"op":"copula_wald","coefficients":{"gc":.2},"samples":{},"targets":{"Y":["gc"]}}


def copula_attach_cases():
    import copy
    for mode in ["summary","paths","display-name","empty"]:
        name="GC (Predictor -> Outcome)";target="Y"
        result={"gaussian_copula":{"endogeneity_tests":[{"gc_construct":name,"target":"Outcome" if mode=="display-name" else target,"original":.1}],"effects_of_correction":[{"source":"Predictor","target":"Outcome","difference":.2}],"orig_gc_coefs":{name:.1},"target_to_gc_names":{target:[name]},"wald_tests":[{"target":target},{"target":"Overall"}]}}
        summary={"mean":.11,"se":.03,"t_stat":3.3,"p_value":.02,"ci_lower":.01,"ci_upper":.2}
        bootstrap={"samples_dict":{f"path:{name}->{target}":[.1,.2,.08,.15,.13],"gc_diff:Predictor->Outcome":[.1,.15,.2,.3,.4]}}
        if mode=="paths":bootstrap["paths"]=[{"from":name,"to":target,**summary}]
        else:bootstrap["parameter_summary"]={f"path:{name}->{target}":summary}
        if mode=="empty":bootstrap={}
        yield {"op":"copula_attach","case_name":mode,"result":result,"bootstrap":bootstrap}


def copula_cases():
    import numpy as np
    rng=np.random.default_rng(187)
    for n in [3,8,17,64,129]:
        for f4,raw in [(True,True),(True,False),(False,True),(False,False)]:
            x=rng.exponential(size=n).tolist();w=rng.normal(size=n).tolist()
            yield {"op":"copula_primitives","values":x,"columns":[x,w],"endogenous":1,"raw":raw,"f4":f4,"decimals":12,"simulations":37,"seed":42}
    for x in [[2.0]*8,[1,1,1,2,2,2,3,3],[1,1+1e-13,2,3,4,5],[-1e3,*range(129)]]:
        yield {"op":"copula_primitives","values":x,"columns":[x],"endogenous":1,"raw":True,"f4":True,"decimals":12,"simulations":37,"seed":42}


def ex_post_merge_cases():
    for values,mapping,minimum in [(["a","b","a","c"],[["b","a"]],3),([1,2,1,3],[[3,2]],2),(["can't","a\nb",None,"can't"],[],4),([],[],4)]:
        yield {"op":"merge_categories","values":values,"mapping":mapping,"minimum":minimum}


def ex_post_cases():
    import numpy as np
    for segments,categories in [([1,1,2,2],["a","a","b","b"]),([1,2,3,1,2,3],["b","a","c","a","b","c"]),([1,1,2,2,2,1],["a","b","c","d","a","c"]),([1,2,3,1,2,3],["a"]*6),([],[])]:
        yield {"op":"segment_overlap","segments":segments,"categories":categories}
    rng=np.random.default_rng(193)
    rows=[[float(rng.normal()),["a","b","c"][i%3],bool(i%2)] for i in range(120)]
    for groups in [2,3,4]:
        yield {"op":"segment_logistic","segments":[int(i%groups)+1 for i in rng.permutation(120)],"columns":["x","category","flag"],"rows":rows}
    yield {"op":"segment_logistic","segments":[1,2]*20,"columns":["constant"],"rows":[[1.0]]*40}
    reference=json.loads((OUTPUT/"pls-reference.json").read_text())
    for groups in [2,3]:
        yield {"op":"segment_compare","columns":[*reference["columns"],"category"],"rows":[[*r,f"g{i%groups}"] for i,r in enumerate(reference["rows"][:72])],"spec":reference["model"],"settings":{},"explanatory_col":"category","pos":{"weighted_r_squared":{"Y":.99},"segments":[{"segment":1,"path_coefficients":{"Y":{"X":.7}}}]}}


def otg_cases():
    import copy
    import numpy as np
    for comparisons in [0,1,3,15,100]:
        yield {"op":"otg_thresholds","comparisons":comparisons,"alpha":0.05}
    rng=np.random.default_rng(334)
    for k,b in [(1,5),(2,8),(3,17),(4,129)]:
        yield {"op":"otg_fr","draws":[rng.normal(loc=i*.3,size=b+i).tolist() for i in range(k)]}
    reference=json.loads((OUTPUT/"pls-reference.json").read_text())
    for mode in ["three-groups","two-groups-aliases","selected-groups"]:
        n=72;k=2 if mode=="two-groups-aliases" else 3
        model=copy.deepcopy(reference["model"])
        if mode=="two-groups-aliases":model["paths"]=[{"from_node":p["from"],"to_node":p["to"]} for p in model["paths"]]
        options={"group_col":"group","n_boot":8,"n_permutations":7,"seed":42}
        if mode=="selected-groups":options["group_values"]=["g2","g0"]
        yield {"op":"otg","case_name":mode,"columns":[*reference["columns"],"group"],"rows":[[*r,f"g{i%k}"] for i,r in enumerate(reference["rows"][:n])],"spec":model,"settings":{},"options":options}


def pos_cases():
    import copy
    reference=json.loads((OUTPUT/"pls-reference.json").read_text())
    for mode in ["weighted","presegmentation","sum","target","fimix-partition","listwise-consistent"]:
        case={"op":"pos","case_name":f"pos-{mode}","columns":reference["columns"],"rows":copy.deepcopy(reference["rows"][:48]),"spec":reference["model"],"settings":{},"options":{"n_segments":2,"n_repetitions":1,"max_iter":3,"search_depth":8,"min_segment_size":8,"seed":42}}
        if mode=="presegmentation":case["options"]["pre_segmentation"]=True
        if mode=="sum":case["options"]["criterion"]="sum_r2"
        if mode=="target":case["options"].update(optimization_criterion="Target R2",target_construct="Y")
        if mode=="fimix-partition":case["options"].update(initial_separation="fimix",fimix_assignments=[1]*24+[2]*24,pre_segmentation=True)
        if mode=="listwise-consistent":
            case["settings"]={"consistent":True,"missing_treatment":"listwise"};case["rows"][3][0]=None;case["rows"][7][2]=-99
        yield case


def fimix_cases():
    import copy
    import numpy as np
    rng=np.random.default_rng(614)
    n=64;x=rng.normal(size=n);w=rng.normal(size=n)
    y=np.where(np.arange(n)<n//2,0.8*x,-0.6*x)+rng.normal(scale=.2,size=n)
    z=.4*y+.3*w+rng.normal(scale=.3,size=n)
    eq1={"target":"Y","y":y.tolist(),"predictors":["X"],"X_design":np.column_stack([np.ones(n),x]).tolist()}
    eq2={"target":"Z","y":z.tolist(),"predictors":["Y","W"],"X_design":np.column_stack([np.ones(n),y,w]).tolist()}
    for segments,repetitions,iterations,joint in [(1,2,60,False),(2,1,1,False),(2,2,60,False),(3,2,80,False),(2,2,60,True),(2,0,20,False)]:
        yield {"op":"fimix_em","case_name":f"fimix-em-{segments}-{repetitions}-{iterations}-{joint}","equations":[eq1,eq2] if joint else [eq1],"options":{"n_segments":segments,"n_samples":n,"n_repetitions":repetitions,"max_iter":iterations,"tol":1e-5,"seed":42}}
    reference=json.loads((OUTPUT/"pls-reference.json").read_text())
    for mode in ["single","multi","listwise-consistent"]:
        case={"op":"fimix","case_name":f"fimix-pipeline-{mode}","columns":reference["columns"],"rows":copy.deepcopy(reference["rows"][:64]),"spec":reference["model"],"settings":{},"options":{"min_segments":1,"max_segments":1 if mode!="multi" else 2,"n_repetitions":2,"max_iter":60,"tol":1e-5,"min_sample_size":10,"seed":42}}
        if mode=="listwise-consistent":
            case["rows"][3][0]=None;case["rows"][7][2]=-99
            case["settings"]={"consistent":True,"missing_treatment":"listwise"}
        yield case


def rng_distribution_cases():
    for entropy in [[0],[42],[12345,67890]]:
        for kind in ["normal","exponential"]:
            for count in [0,1,32,4096,50000]:yield {"op":"rng_distributions","entropy":entropy,"kind":kind,"count":count}
        for shape in [0.0,0.1,0.5,1.0,2.0,10.0]:yield {"op":"rng_distributions","entropy":entropy,"kind":"gamma","count":128,"shape":shape}
        for dimensions in [1,2,3,5]:yield {"op":"rng_distributions","entropy":entropy,"kind":"dirichlet","count":50,"dimensions":dimensions}
        yield {"op":"rng_distributions","entropy":entropy,"kind":"mixed","count":128}


def power_cases():
    for dfn,dfd in [(1,1),(1,30),(5,100),(20,1000)]:
        for ncp in [0.0,0.5,10.0,1000.0]:
            for x in [0.1,1.0,10.0]:
                yield {"op":"noncentral_f","x":x,"dfn":dfn,"dfd":dfd,"lambda":ncp}
    yield {"op":"noncentral_f","x":1e4,"dfn":1,"dfd":1,"lambda":1e5}
    for n in [20,100,1000,5000]:
        for k in [1,5,20]:
            for r2 in [0.0,0.10,0.25,0.75]:
                yield {"op":"power","options":{"n_samples":n,"n_predictors":k,"r_squared":r2,"alpha":0.05}}
    for k in [1,2,5,10]:
        for r2 in [0.0,0.10,0.25,0.50,0.75]:
            yield {"op":"minimum_sample","options":{"n_predictors":k,"r_squared":r2,"target_power":0.8,"alpha":0.05}}
    for k,f2,alpha,target in [(1,.0001,.05,.8),(3,.15,.01,.9),(5,.35,.10,.8)]:
        yield {"op":"minimum_sample","options":{"n_predictors":k,"effect_size_f2":f2,"target_power":target,"alpha":alpha}}
    for formative,paths in [(0,0),(3,5),(10,2)]:yield {"op":"ten_times","formative":formative,"paths":paths}
    yield {"op":"power_table","alpha":0.05,"target":0.8}
    reference=json.loads((OUTPUT/"pls-reference.json").read_text())
    for observed in [{},{"M":0.4,"Y":0.1}]:yield {"op":"model_power","samples":100,"spec":reference["model"],"r2":observed,"alpha":0.05}


def cta_cases():
    import numpy as np
    rng=np.random.default_rng(4271)
    for p,n in [(4,48),(5,64),(6,150)]:
        names=[f"q_{i+1}" for i in range(p)]
        latent=rng.normal(size=n)
        rows=np.column_stack([0.7*latent+rng.normal(scale=0.5,size=n) for _ in range(p)]).tolist()
        yield {"op":"tetrad_diagnostics","rows":rows,"names":names}
        for kind in ["reflective","formative"]:
            yield {"op":"cta","case_name":f"cta-{p}-{kind}","columns":names,"rows":rows,"spec":{"constructs":[{"id":"A","name":"Construct A","type":kind,"indicators":names}],"paths":[]},"options":{"n_boot":19,"seed":42,"alpha":0.10}}
    yield {"op":"cta","case_name":"cta-ineligible","columns":["a","b"],"rows":[[1,2],[2,3]],"spec":{"constructs":[{"id":"A","indicators":["a","b"]}],"paths":[]},"options":{"n_boot":19,"seed":42,"alpha":0.10}}


def micom_cases():
    import copy
    reference=json.loads((OUTPUT/"pls-reference.json").read_text())
    base=reference["model"]
    for mode in ["same","no-attestation","indicators","measurement","paths","aliases"]:
        changed=copy.deepcopy(base)
        if mode=="indicators":changed["constructs"][0]["indicators"]=["different"]
        if mode=="measurement":changed["constructs"][0]["type"]="formative"
        if mode=="paths":changed["paths"]=changed["paths"][:1]
        if mode=="aliases":changed["paths"]=[{"from_node":p["from"],"to_node":p["to"]} for p in changed["paths"]]
        yield {"op":"configural","a":base,"b":changed,"attestation":mode!="no-attestation"}
    for count,settings in [(9,{}),(19,{"inner_weighting":"factor"}),(11,{"consistent":True})]:
        yield {"op":"micom","case_name":f"micom-{count}-{settings}","columns":[*reference["columns"],"group"],"rows":[[*r,"a" if i<32 else "b"] for i,r in enumerate(reference["rows"][:64])],"spec":base,"settings":settings,"options":{"group_col":"group","n_permutations":count,"seed":42,"alpha":0.05}}
    spec=copy.deepcopy(base)
    for c in spec["constructs"]:c["indicators"]=c["indicators"][:1]
    yield {"op":"micom","case_name":"micom-single-indicators","columns":[*reference["columns"],"group"],"rows":[[*r,"a" if i<32 else "b"] for i,r in enumerate(reference["rows"][:64])],"spec":spec,"settings":{},"options":{"group_col":"group","n_permutations":9,"seed":42,"alpha":0.05}}


def mga_cases():
    import copy
    import numpy as np
    rng=np.random.default_rng(7129)
    for n in [[10,10],[30,100],[344,400]]:
        for beta,se in [([0.3,0.1],[0.05,0.1]),([0.1,0.1],[0.0,0.0]),([-0.3,0.4],[0.2,0.03])]:
            yield {"op":"mga_tests","beta":beta,"se":se,"n":n,"x":np.round(rng.normal(size=17),1).tolist(),"y":np.round(rng.normal(size=21),1).tolist()}
    reference=json.loads((OUTPUT/"pls-reference.json").read_text())
    for boot,perm,seed in [(0,0,42),(8,9,42),(8,11,None)]:
        yield {"op":"mga","case_name":f"mga-{boot}-{perm}-{seed}","columns":[*reference["columns"],"group"],"rows":[[*r,"first" if i<32 else "second"] for i,r in enumerate(reference["rows"][:64])],"spec":reference["model"],"settings":{},"options":{"group_col":"group","n_boot":boot,"n_permutations":perm,"seed":seed,"alpha":0.05}}
    case={"op":"mga","case_name":"mga-numeric-missing-groups","columns":[*reference["columns"],"group"],"rows":[[*r,None if i==0 else 1 if i<32 else 2] for i,r in enumerate(reference["rows"][:64])],"spec":reference["model"],"settings":{},"options":{"group_col":"group","n_boot":0,"n_permutations":3,"seed":0,"alpha":0.05}}
    yield case


def snapshot_store_cases():
    spec={"name":"Original","constructs":[],"indicators":[],"paths":[]}
    first="00000000-0000-4000-8000-000000000001"
    second="00000000-0000-4000-8000-000000000002"
    save={"action":"save_snapshot","id":first,"name":"Snapshot 🔬","algorithm":"pls","results":{"value":0.4},"spec":spec,"diagram_layout":{"zoom":1.0},"description":"Saved","source_model_id":"default"}
    scripts=[
        [{"action":"create","name":"Study"},{"action":"list_snapshots"},save,{"action":"get_snapshot","id":first},{"action":"list_snapshots"},{"action":"get_snapshot","id":second}],
        [{"action":"create","name":"Study"},save,{"action":"delete_snapshot","id":first},{"action":"delete_snapshot","id":first},{"action":"get_snapshot","id":first},{"action":"list_snapshots"}],
        [{"action":"create","name":"Study"},save,{"action":"model_from_snapshot","id":first,"model_id":"restored","name":"Restored model"},{"action":"load_model","model_id":"restored"},{"action":"load_results","model_id":"restored"},{"action":"model_from_snapshot","id":second,"model_id":"missing","name":"Missing"}],
        [{"action":"create","name":"Study"},save,save,{**save,"id":second,"name":"Second","results":{},"diagram_layout":None},{"action":"list_snapshots"},{"action":"get_snapshot","id":second}],
    ]
    for i,actions in enumerate(scripts):yield {"op":"project_scenario","case_name":f"snapshot-store-{i}","timestamp":"2026-11-08T00:00:00.123456+00:00","actions":actions}


def project_store_cases():
    spec={"name":"研究 model", "constructs":[{"id":"X","indicators":["x"],"position":{"x":1e-7}}],"paths":[]}
    layout={"X":{"x":120.25,"y":0}}
    common=[{"action":"create","name":"Study"},{"action":"metadata"},{"action":"load_model"},
        {"action":"save_model","model_id":"model-a","spec":spec,"diagram_layout":layout},
        {"action":"load_model","model_id":"model-a"}]
    scripts=[
        [{"action":"create","name":"First"},{"action":"create","name":"Second"},{"action":"metadata"}],
        common+[{"action":"save_model","spec":spec},{"action":"load_model"},{"action":"load_model","model_id":"absent"}],
        common+[{"action":"rename_model","model_id":"model-a","name":"  Renamed 🔬  "},{"action":"load_model","model_id":"model-a"}],
        common+[{"action":"rename_model","model_id":"absent","name":"New"},{"action":"rename_model","model_id":"model-a","name":"  "}],
        common+[{"action":"save_results","model_id":"model-a","results":{"paths":[],"value":0.7},"spec":spec,"diagram_layout":layout,"dataset_id":"1","dataset_hash":"abc","params":{"alpha":0.05}},
                {"action":"load_results","model_id":"model-a"},{"action":"load_results","model_id":"absent"},
                {"action":"rename_model","model_id":"model-a","name":"Changed"},{"action":"load_results","model_id":"model-a"}],
        common+[{"action":"save_results","model_id":"model-a","results":{"kind":"pls"},"spec":spec},
                {"action":"save_results","model_id":"model-a","analysis_type":"bootstrap","results":{"kind":"bootstrap"},"spec":spec},
                {"action":"load_results","model_id":"model-a","analysis_type":"pls"},{"action":"load_results","model_id":"model-a","analysis_type":"bootstrap"},
                {"action":"save_results","model_id":"model-a","results":{"kind":"updated"},"spec":spec},{"action":"load_results","model_id":"model-a"}],
        common+[{"action":"save_results","model_id":"model-a","results":{"value":1.0},"spec":spec},
                {"action":"duplicate_model","source":"model-a","target":"copy"},{"action":"load_model","model_id":"copy"},{"action":"load_results","model_id":"copy"}],
        common+[{"action":"duplicate_model","source":"absent","target":"copy-default"},{"action":"load_model","model_id":"copy-default"}],
    ]
    for i,actions in enumerate(scripts):yield {"op":"project_scenario","case_name":f"project-store-{i}","timestamp":"2026-11-08T00:00:00.123456+00:00","actions":actions}


def spec_hash_random_cases():
    import numpy as np
    rng=np.random.default_rng(84216)
    count=0
    while count<256:
        value=rng.integers(0,2**64,dtype=np.uint64).view(np.float64).item()
        if not math.isfinite(value):continue
        yield {"op":"spec_hash","spec":{"value":value,"name":"a\u0000b\\\"c","nested":{"right":True,"left":None}}}
        count+=1


def spec_hash_cases():
    for spec in [None,{},[],False,0,"",{"name":"研究 🔬\n\u007f","paths":[{"to":"Y","from":"X"}]}, *[{"value":v} for v in [1,1.0,-0.0,1e-3,1e-4,1e-5,1e-6,1e-7,1e15,1e16,1e20,1e100,1.2345678901234567,1.234e-100,2.2250738585072014e-308,5e-324,1.7976931348623157e308]]]:
        yield {"op":"spec_hash","spec":spec}
    reference=json.loads((OUTPUT/"pls-reference.json").read_text())
    yield {"op":"spec_hash","spec":reference["model"]}


def hcm_cases():
    import copy
    reference=json.loads((OUTPUT/"pls-reference.json").read_text())
    for approach in ["repeated_indicators","two_stage","total_effects"]:
        for kind in ["RR","RF","FR","FF"]:
            spec=copy.deepcopy(reference["model"])
            spec["constructs"].append({"id":"HOC","name":"Higher-order","indicators":[]})
            spec["paths"]=[{"from":"HOC","to":"Y"}]
            if kind in ["FR","FF"]:
                for c in spec["constructs"][:2]:c["type"]="formative"
            yield {"op":"hcm","case_name":f"hcm-{approach}-{kind}","columns":reference["columns"],"rows":reference["rows"][:64],"spec":spec,"settings":{},"options":{"hoc_id":"HOC","loc_ids":["X","M"],"hoc_type":kind,"approach":approach}}
    spec=copy.deepcopy(reference["model"])
    spec["constructs"][1]["indicators"]=spec["constructs"][1]["indicators"][:2]
    spec["constructs"].extend([{"id":"HOC","indicators":[]},{"id":"ANT","indicators":["survey_weight"]}])
    spec["paths"]=[{"from":"ANT","to":"HOC"},{"from":"HOC","to":"Y"}]
    for approach in ["repeated_indicators","total_effects"]:
        yield {"op":"hcm","case_name":f"hcm-unbalanced-{approach}","columns":reference["columns"],"rows":reference["rows"][:64],"spec":spec,"settings":{"inner_weighting":"factor"},"options":{"hoc_id":"HOC","loc_ids":["X","M"],"hoc_type":"RF","approach":approach}}


def hcm_consistent_cases():
    import copy
    for base in list(hcm_cases())[:12]:
        case=copy.deepcopy(base)
        case["settings"]={"consistent":True}
        case["case_name"]+="-consistent"
        yield case


def nca_cases():
    import copy
    import numpy as np
    rng=np.random.default_rng(529)
    for n in [5,24,130]:
        for tied in [False,True]:
            x=rng.normal(size=n);y=0.5*x+rng.normal(size=n)
            if tied: x=np.round(x)
            yield {"op":"nca_diagnostics","x":x.tolist(),"y":y.tolist()}
    reference=json.loads((OUTPUT/"pls-reference.json").read_text())
    for count,seed in [(0,42),(19,42),(29,123),(11,0)]:
        yield {"op":"nca","case_name":f"nca-{count}-{seed}","columns":reference["columns"],"rows":reference["rows"][:64],"spec":reference["model"],"predictor":"X","outcome":"Y","settings":{},"options":{"n_permutations":count,"seed":seed,"alpha":0.05}}


def contrast_cases():
    for matrix in [False,True]:
        for tails in ["one","two"]:
            for method in ["percentile","bias_corrected","bca"]:
                draws={"a":[0.1,0.2,0.1,0.5,-0.1],"b":[-0.1,0.2,0.05,0.1,0.4]}
                yield {"op":"contrast","options":{"original_parameters":{"a":0.3,"b":0.1},"samples":[list(row) for row in zip(draws["a"],draws["b"])] if matrix else draws,
                    "coefficients":[["a",1.0],["b",-1.0]],"parameter_names":["a","b"],"alpha":0.05,"tails":tails,"ci_method":method}}
    for values in [[0.2],[0.3]*5,[-0.1,0.0,0.1,0.2]]:
        yield {"op":"contrast","options":{"original_parameters":{"a":0.3},"samples":{"a":values},"coefficients":[["a",2.0]],"alpha":0.05,"tails":"two","ci_method":"percentile"}}


def expansion_bootstrap_cases():
    import copy
    cases=list(moderation_cases())
    for index in [1,3,5,6,8,9]:
        case=copy.deepcopy(cases[index]);case["op"]="bootstrap";case.pop("settings")
        case["rows"]=case["rows"][:24]
        case["case_name"]="bootstrap-"+case["case_name"]
        case["options"]={"n_boot":8,"n_workers":2,"seed":42,"ci_method":"percentile","sign_change":"none"}
        yield case
    case=copy.deepcopy(next(quadratic_cases()));case["op"]="bootstrap";case.pop("settings")
    case["case_name"]="bootstrap-quadratic";case["rows"]=case["rows"][:24]
    case["options"]={"n_boot":8,"n_workers":2,"seed":42,"ci_method":"bca","sign_change":"construct"}
    yield case


def moderation_cases():
    import copy
    import numpy as np
    rng=np.random.default_rng(742)
    n=64
    x=rng.normal(size=n);w=rng.normal(size=n);v=rng.normal(size=n)
    med=0.5*x+0.2*w+0.35*x*w+rng.normal(scale=0.5,size=n)
    y=0.5*med+0.2*x-0.3*w*med+rng.normal(scale=0.5,size=n)
    columns=[f"{cid.lower()}{j}" for cid in ["X","W","V","M","Y"] for j in [1,2]]
    rows=np.column_stack([value+rng.normal(scale=0.15,size=n) for value in [x,w,v,med,y] for _ in [1,2]]).tolist()
    spec={"constructs":[{"id":cid,"name":name,"type":"reflective","indicators":[f"{cid.lower()}1",f"{cid.lower()}2"]} for cid,name in [("X","Predictor"),("W","Moderator"),("V","Other Moderator"),("M","Mediator"),("Y","Outcome")]],"paths":[{"from":"X","to":"M"},{"from":"M","to":"Y"},{"from":"X","to":"Y"}]}
    base={"op":"run_pipeline","columns":columns,"rows":rows,"spec":spec,"settings":{}}
    for method in ["two_stage","product_indicator","orthogonalizing"]:
        for standardize in [False,True]:
            case=copy.deepcopy(base)
            case["case_name"]=f"moderation-{method}-{standardize}"
            case["spec"]["moderating_effects"]=[{"id":"mod1","source":"X","moderator":"W","target":"M","method":method,"standardize":standardize}]
            yield case
    for mode in ["mediation-both","multiple-moderators","higher-order","mixed-quadratic","consistent","consistent-product","consistent-ortho"]:
        case=copy.deepcopy(base);case["case_name"]=f"moderation-{mode}"
        mods=[{"id":"mod1","source":"X","moderator":"W","target":"M","method":"two_stage"}]
        if mode=="mediation-both":mods.append({"id":"mod2","source":"M","moderator":"W","target":"Y","method":"two_stage"})
        if mode in ["multiple-moderators","higher-order"]:mods.append({"id":"mod2","source":"X","moderator":"V","target":"M","method":"two_stage",**({"attachToModId":"mod1"} if mode=="higher-order" else {})})
        if mode=="mixed-quadratic":case["spec"]["quadratic_effects"]=[{"predictor_construct":"M","target_construct":"Y"}]
        if mode.startswith("consistent"):
            case["settings"]={"consistent":True}
            if mode=="consistent-product":mods[0]["method"]="product_indicator"
            if mode=="consistent-ortho":mods[0]["method"]="orthogonalizing"
        case["spec"]["moderating_effects"]=mods
        yield case


def quadratic_cases():
    import copy
    reference = json.loads((OUTPUT / "pls-reference.json").read_text())
    base = {"op":"run_pipeline","columns":reference["columns"],"rows":reference["rows"][:64],"spec":reference["model"],"settings":{}}
    paths = base["spec"]["paths"]
    for i,settings in enumerate([{}, {"inner_weighting":"factor"},{"inner_weighting":"centroid"},{"consistent":True},{"initial_weights":"lohmoller"}]):
        case=copy.deepcopy(base)
        case.update(case_name=f"quadratic-pipeline-{i}",settings=settings)
        case["spec"]["quadratic_effects"]=[{"id":"q1","predictor_construct":paths[0]["from"],"target_construct":paths[0]["to"],"node_x":17,"node_y":42}]
        yield case
    case=copy.deepcopy(base)
    case["case_name"]="quadratic-multiple-terms"
    chosen=[]
    for p in paths:
        if p["from"] not in [q["predictor_construct"] for q in chosen]:
            chosen.append({"id":f"q{len(chosen)}","predictor_construct":p["from"],"target_construct":p["to"]})
        if len(chosen)==2: break
    case["spec"]["quadratic_effects"]=chosen
    yield case
    case=copy.deepcopy(base)
    case["case_name"]="quadratic-alias-mean-missing"
    case["rows"][1][0]=None
    names={c["id"]:c["name"] for c in case["spec"]["constructs"]}
    case["spec"]["quadraticEffects"]=[{"source":names[paths[0]["from"]],"outcome":names[paths[0]["to"]],"method":"product_indicator"}]
    yield case


def nonlinear_cases():
    import copy
    for included,excluded in [(0.5,0.49),(0.5,0.4),(0.0,0.2),(1.0,0.8),(0.3,0.3),(0.2,0.199)]:
        for moderation in [False,True]:
            yield {"op":"nonlinear_effect_size","included":included,"excluded":excluded,"moderation":moderation}
    for b1,b2 in [(0.3,-0.2),(0.4,0.1),(-0.8,0.0),(0.3,1e-10),(0.3,-2.0)]:
        for evidence in [{},{"p_value":0.3},{"p_value":0.01,"ci_lower":-0.8,"ci_upper":-0.1},{"ci_lower":0.01,"ci_upper":0.4}]:
            options={"b1_linear":b1,"b2_quad_unstd":b2,"scale":1.24,"mean_sq":0.8,"predictor_scores":[-2.3,-1.1,0.0,0.3,1.9],"b_linear_stage1":0.35,**evidence}
            yield {"op":"quadratic_diagnostics","case_name":f"quad-{b1}-{b2}-{evidence}","options":options}
    yield {"op":"quadratic_diagnostics","options":{"b1_linear":0.5,"b2_quad_unstd":-0.2,"scale":1.0,"mean_sq":1.0,"predictor_scores":[]}}
    for b1,b2 in [(0.3,-0.2),(0.0,0.0),(-0.4,0.2)]:
        for draws in [False,True]:
            options={"beta_source":b1,"beta_moderator":0.13,"beta_interaction":b2,"alpha":0.05}
            if draws:
                options.update(boot_source_reps=[0.32,0.1,0.4,-0.2,0.5],boot_int_reps=[-0.4,0.2,-0.1,0.0,0.2])
            yield {"op":"simple_slopes","options":options}


def oracle(request):
    import numpy as np
    from core import stats_utils as stats
    from core.json_utils import sanitize_for_json
    from core.rng import chunk_tasks
    from engine.pls.algorithm import standardize_matrix
    op = request["op"]
    x = np.array(request.get("x", []), dtype=float)
    w = request.get("weights")
    w = None if w is None else np.array(w, dtype=float)
    with np.errstate(all="ignore"):
        if op == "categorical_groups":
            import pandas as pd
            from data.groups import generate_categorical_groups
            result=generate_categorical_groups(pd.DataFrame(request["rows"],columns=request["columns"]),request["column"],request["minimum"],request["predictors"])
        elif op == "derive":
            import pandas as pd
            from data.derived import apply_derivation
            frame,meta=apply_derivation(pd.DataFrame(request["rows"],columns=request["columns"]),request["operation"],request["params"])
            result={"columns":list(frame.columns),"rows":frame.values.tolist(),"meta":meta}
        elif op == "copula_attach":
            import copy
            from engine.pls.copula import attach_bootstrap_to_copula
            result=copy.deepcopy(request["result"]);attach_bootstrap_to_copula(result,request["bootstrap"])
        elif op == "copula_wald":
            from engine.pls.copula import compute_wald_test
            result=compute_wald_test(request["coefficients"],{k:np.array(v) for k,v in request["samples"].items()},request["targets"])
        elif op == "copula_primitives":
            from engine.pls.copula import f4_ecdf,f3_ecdf,copula_term,copula_matrix,cvm_mc_test,anderson_darling_test
            choice="F4" if request["f4"] else "F3";decimals=request["decimals"]
            scores={str(i):np.array(c) for i,c in enumerate(request["columns"])}
            p=[str(i) for i in range(request["endogenous"])];w=[str(i) for i in range(request["endogenous"],len(scores))]
            result={"ecdf":(f4_ecdf if request["f4"] else f3_ecdf)(request["values"],decimals),"term":copula_term(request["values"],choice,decimals),"matrix":copula_matrix(scores,p,w,"raw" if request["raw"] else "decorrelated",choice,decimals),"cvm":cvm_mc_test(request["values"],request["simulations"],request["seed"]),"ad":anderson_darling_test(request["values"])}
        elif op == "merge_categories":
            import pandas as pd
            from engine.pls.ex_post import merge_categories
            result=merge_categories(pd.Series(request["values"]),dict(request["mapping"]),request["minimum"])
            result["merged_series"]=result["merged_series"].tolist()
        elif op == "segment_overlap":
            from engine.pls.ex_post import compute_crosstab_overlap
            result=compute_crosstab_overlap(request["segments"],request["categories"])
        elif op == "segment_logistic":
            import pandas as pd
            from engine.pls.ex_post import run_logistic_segment_regression
            result=run_logistic_segment_regression(request["segments"],pd.DataFrame(request["rows"],columns=request["columns"]))
        elif op == "segment_compare":
            import pandas as pd
            from engine.pls.ex_post import compare_explanatory_groups_with_pos
            from core.settings_schema import PipelineSettings
            result=compare_explanatory_groups_with_pos(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],request["explanatory_col"],request["pos"],settings=PipelineSettings(**request["settings"]))
        elif op == "otg_thresholds":
            from engine.pls.otg import calculate_fwer,calculate_sidak_alpha,calculate_bonferroni_alpha
            args=(request["comparisons"],request["alpha"])
            result={"fwer":calculate_fwer(*args),"sidak":calculate_sidak_alpha(*args),"bonferroni":calculate_bonferroni_alpha(*args)}
        elif op == "otg_fr":
            from engine.pls.otg import compute_otg_fr_statistic
            result=compute_otg_fr_statistic([np.array(x) for x in request["draws"]])
        elif op == "otg":
            import pandas as pd
            import engine.pls.otg as otg
            from core.settings_schema import PipelineSettings
            from engine.pls.bootstrap import ParallelBootstrapper
            original=otg.ParallelBootstrapper
            try:
                otg.ParallelBootstrapper=lambda:ParallelBootstrapper(n_workers=1)
                result=otg.run_otg_analysis(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],settings=PipelineSettings(**request["settings"]),**request["options"])
            finally:otg.ParallelBootstrapper=original
        elif op == "pos":
            import pandas as pd
            from engine.pls.pos import analyze_pos
            from core.settings_schema import PipelineSettings
            result=analyze_pos(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],settings=PipelineSettings(**request["settings"]),**request["options"])
        elif op == "fimix_em":
            from engine.pls.fimix import _fit_multi_equation_fimix_em
            equations=[{**eq,"y":np.array(eq["y"]),"X_design":np.array(eq["X_design"])} for eq in request["equations"]]
            result=_fit_multi_equation_fimix_em(equations,**request["options"])
        elif op == "fimix":
            import pandas as pd
            from engine.pls.fimix import analyze_fimix
            from core.settings_schema import PipelineSettings
            result=analyze_fimix(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],settings=PipelineSettings(**request["settings"]),**request["options"])
        elif op == "rng_distributions":
            generator=np.random.Generator(np.random.PCG64(np.random.SeedSequence(request["entropy"])))
            kind=request["kind"];count=request["count"]
            if kind=="normal":values=generator.standard_normal(count)
            elif kind=="exponential":values=generator.standard_exponential(count)
            elif kind=="gamma":values=generator.standard_gamma(request["shape"],count)
            elif kind=="dirichlet":values=generator.dirichlet(np.ones(request["dimensions"]),size=count)
            else:values=[[int(generator.integers(7)),generator.standard_normal(),generator.standard_exponential(),generator.standard_gamma(0.3),generator.dirichlet(np.ones(4)),int(generator.integers(19))] for _ in range(count)]
            result={"values":values,"next_raw":int(generator.bit_generator.random_raw())}
        elif op == "noncentral_f":
            from scipy import stats as scipy_stats
            result=scipy_stats.ncf.cdf(request["x"],request["dfn"],request["dfd"],request["lambda"])
        elif op in ["power","minimum_sample","ten_times","power_table","model_power"]:
            from engine.pls.power import compute_statistical_power,solve_minimum_sample_size,calculate_ten_times_rule,get_cohen_appendix_c_table,evaluate_model_power
            if op=="power":result=compute_statistical_power(**request["options"])
            elif op=="minimum_sample":result=solve_minimum_sample_size(**request["options"])
            elif op=="ten_times":result=calculate_ten_times_rule(request["formative"],request["paths"])
            elif op=="power_table":result=get_cohen_appendix_c_table(request["target"],request["alpha"])
            else:result=evaluate_model_power(request["samples"],request["spec"],request["r2"],request["alpha"])
        elif op == "tetrad_diagnostics":
            import pandas as pd
            from engine.pls.cta import generate_all_tetrads_for_block,select_nonredundant_tetrads,compute_tetrad_values
            names=request["names"]
            frame=pd.DataFrame(request["rows"],columns=names)
            x=frame[names].dropna().values.astype(float)
            cov=np.cov(x,rowvar=False)
            defs=generate_all_tetrads_for_block(names)
            selected,indices=select_nonredundant_tetrads(cov,defs,len(names))
            result={"covariance":cov,"all_tetrads":defs,"selected_indices":indices,"selected_tetrads":selected,"values":compute_tetrad_values(cov,selected)}
        elif op == "cta":
            import pandas as pd
            from engine.pls.cta import run_cta_pls
            result=run_cta_pls(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],**request["options"])
        elif op == "configural":
            from engine.pls.micom import check_configural_invariance
            result=check_configural_invariance(request["a"],request["b"],request["attestation"])
        elif op == "micom":
            import pandas as pd
            from engine.pls.micom import run_micom
            from core.settings_schema import PipelineSettings
            result=run_micom(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],settings=PipelineSettings(**request["settings"]),**request["options"])
        elif op == "mga_tests":
            from engine.pls.mga import compute_parametric_test,compute_welch_satterthwaite_test,compute_henseler_pls_mga
            args=[*request["beta"],*request["se"],*request["n"]]
            result={"parametric":compute_parametric_test(*args),"welch":compute_welch_satterthwaite_test(*args),"henseler":compute_henseler_pls_mga(np.array(request["x"]),np.array(request["y"]))}
        elif op == "mga":
            import pandas as pd
            import engine.pls.mga as mga
            from core.settings_schema import PipelineSettings
            from engine.pls.bootstrap import ParallelBootstrapper
            original=mga.ParallelBootstrapper
            try:
                mga.ParallelBootstrapper=lambda:ParallelBootstrapper(n_workers=1)
                result=mga.analyze_mga(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],settings=PipelineSettings(**request["settings"]),**request["options"])
            finally:mga.ParallelBootstrapper=original
        elif op == "project_scenario":
            import project_io
            from datetime import datetime
            from unittest.mock import patch
            class FrozenDatetime(datetime):
                @classmethod
                def now(cls,tz=None): return datetime.fromisoformat(request["timestamp"])
            with tempfile.TemporaryDirectory(prefix="statsem-python-store-") as directory, patch.object(project_io,"datetime",FrozenDatetime):
                path=str(Path(directory)/"project.pls")
                result=[]
                for action in request["actions"]:
                    key=action.get("model_id")
                    try:
                        op_name=action["action"]
                        if op_name=="create":item=project_io.create_project(path,action["name"])
                        elif op_name=="metadata":item=project_io.load_metadata(path)
                        elif op_name=="save_model":item=project_io.save_model_spec(path,action["spec"],action.get("diagram_layout"),key)
                        elif op_name=="load_model":item=project_io.load_model_spec(path,key)
                        elif op_name=="rename_model":item=project_io.rename_model(path,key or "default",action["name"])
                        elif op_name=="duplicate_model":item=project_io.duplicate_model_spec(path,action["source"],action["target"])
                        elif op_name=="save_results":
                            options={k:v for k,v in action.items() if k not in ["action","results","algorithm"]}
                            item=project_io.save_results(path,action.get("algorithm","pls"),action["results"],**options)
                        elif op_name=="load_results":item=project_io.load_results(path,action.get("algorithm","pls"),key,action.get("analysis_type"))
                        elif op_name=="save_snapshot":
                            from uuid import UUID
                            options={k:v for k,v in action.items() if k not in ["action","id"]}
                            with patch("uuid.uuid4",return_value=UUID(action["id"])):item=project_io.save_snapshot(path,**options)
                        elif op_name=="list_snapshots":item=project_io.list_snapshots(path)
                        elif op_name=="get_snapshot":item=project_io.get_snapshot(path,action["id"])
                        elif op_name=="delete_snapshot":item=project_io.delete_snapshot(path,action["id"])
                        elif op_name=="model_from_snapshot":item=project_io.create_model_from_snapshot(path,action["id"],key,action["name"])
                        else:raise ValueError(op_name)
                    except Exception as exc:item={"error":str(exc)}
                    result.append(item)
        elif op == "spec_hash":
            from project_io import compute_spec_hash
            result={"serialized":json.dumps(request["spec"],sort_keys=True),"hash":compute_spec_hash(request["spec"])}
        elif op == "hcm":
            import pandas as pd
            from engine.pls.hcm import analyze_hcm
            from core.settings_schema import PipelineSettings
            result=analyze_hcm(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],settings=PipelineSettings(**request["settings"]),**request["options"])
        elif op == "nca":
            import pandas as pd
            from engine.pls.nca import analyze_nca
            from core.settings_schema import PipelineSettings
            result=analyze_nca(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],predictor=request["predictor"],outcome=request["outcome"],settings=PipelineSettings(**request["settings"]),**request["options"])
        elif op == "nca_diagnostics":
            from engine.pls.nca import compute_ce_fdh,compute_cr_fdh,generate_bottleneck_table
            y=np.array(request["y"])
            px,py,area,d=compute_ce_fdh(x,y)
            bounds=(float(x.min()),float(x.max()),float(y.min()),float(y.max()))
            slope,intercept,cr=compute_cr_fdh(px,py,*bounds)
            result={"peer_x":px,"peer_y":py,"ceiling_area":area,"effect_size_d":d,"slope":slope,"intercept":intercept,"cr_effect_size_d":cr,"bottleneck_table":generate_bottleneck_table(px,py,*bounds)}
        elif op == "contrast":
            from engine.pls.contrast import compute_contrast
            options=dict(request["options"])
            options["samples_matrix"]=options.pop("samples")
            options["contrast_coefficients"]=dict(options.pop("coefficients"))
            result=compute_contrast(**options)
        elif op == "quadratic_diagnostics":
            from engine.pls.quadratic import compute_quadratic_diagnostics
            result = compute_quadratic_diagnostics(**request["options"])
        elif op == "simple_slopes":
            from engine.pls.moderation import compute_simple_slopes
            result = compute_simple_slopes(**request["options"])
        elif op == "nonlinear_effect_size":
            from engine.pls.quadratic import calculate_kenny_f2
            from engine.pls.moderation import calculate_moderation_f2
            result = (calculate_moderation_f2 if request["moderation"] else calculate_kenny_f2)(request["included"],request["excluded"])
        elif op == "predict":
            import pandas as pd
            from engine.pls.predict import run_pls_predict
            result = run_pls_predict(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],settings=request["settings"],**request["options"])
        elif op == "permutation":
            result = np.random.Generator(np.random.PCG64(np.random.SeedSequence(request["entropy"]))).permutation(request["n"])
        elif op == "blindfolding":
            import pandas as pd
            from engine.pls.blindfolding import run_blindfolding
            from core.settings_schema import PipelineSettings
            result = run_blindfolding(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],settings=PipelineSettings(**request["settings"]),**request["options"])
        elif op in ["mediation","ipma"]:
            import pandas as pd
            from core.settings_schema import PipelineSettings
            frame = pd.DataFrame(request["rows"],columns=request["columns"])
            cfg = PipelineSettings(**request["settings"])
            if op == "ipma":
                from engine.pls.ipma import analyze_ipma
                result = analyze_ipma(frame,request["spec"],request["target"],scale_bounds=request["scale_bounds"],level=request["level"],settings=cfg)
            else:
                import engine.pls.mediation as mediation
                from engine.pls.bootstrap import ParallelBootstrapper
                original = mediation.ParallelBootstrapper
                try:
                    mediation.ParallelBootstrapper = lambda: ParallelBootstrapper(n_workers=1)
                    result = mediation.analyze_mediation(frame,request["spec"],source=request["source"],target=request["target"],settings=cfg,**request["options"])
                finally:
                    mediation.ParallelBootstrapper = original
        elif op == "argsort":
            result = np.argsort(x)
        elif op == "impute_numeric":
            import pandas as pd
            from data.imputation import mean_imputation,em_imputation,knn_imputation
            frame = pd.DataFrame(np.array(request["x"],dtype=float))
            iterations = 0
            if request["method"] == "em":
                data,count,iterations = em_imputation(frame,max_iter=request["max_iter"],tol=request["tol"])
            elif request["method"] == "knn":
                data,count = knn_imputation(frame,k=request["k"])
            else:
                data,count = mean_imputation(frame)
            result = {"rows":data.to_numpy(),"imputed":count,"iterations":iterations}
        elif op == "bootstrap":
            import pandas as pd
            from engine.pls.bootstrap import ParallelBootstrapper
            options = dict(request["options"])
            options.pop("n_workers",None)
            # Freeze the Python serial worker stream: source parallel future
            # completion order is not deterministic. Rust must reproduce these
            # draws and summaries regardless of its own worker count.
            result = ParallelBootstrapper(n_workers=1).run(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],**options)
        elif op == "rng_diagnostics":
            sequence = np.random.SeedSequence(request["entropy"])
            def generator(): return np.random.Generator(np.random.PCG64(sequence))
            result = {"seeds":sequence.generate_state(request["words"]),
                      "raw":generator().bit_generator.random_raw(request["count"]),
                      "uniform":generator().random(request["count"]),
                      "indices":generator().integers(request["bound"],size=request["count"],dtype=np.uint64)}
        elif op == "distributions":
            from scipy import stats
            result = {"normal_cdf":stats.norm.cdf(request["x"]),"normal_ppf":stats.norm.ppf(request["p"]),"student_t_cdf":stats.t.cdf(request["x"],request["df"])}
        elif op == "confidence_intervals":
            from engine.pls.ci import compute_all_confidence_intervals
            result = compute_all_confidence_intervals(request["original"],np.array(request["samples"]),
                None if request["jackknife"] is None else np.array(request["jackknife"]),alpha=request["alpha"],tails=request["tails"])
        elif op == "run_pipeline":
            if request["case_name"].startswith("frozen-pipeline-"):
                index = int(request["case_name"].rsplit("-",1)[1])
                return json.loads((OUTPUT / "pls-reference.json").read_text())["cases"][index]["expected"]
            import pandas as pd
            from engine.pls.algorithm import run_pipeline
            result = run_pipeline(pd.DataFrame(request["rows"],columns=request["columns"]),request["spec"],request["settings"])
        elif op == "matrix_diagnostics":
            from core.stats_utils import nearest_psd
            result = {"pinv":np.linalg.pinv(x),"eigen_real":np.linalg.eigvals(x).real,"nearest_psd":nearest_psd(x)}
        elif op == "estimate_pls":
            from core.settings_schema import PipelineSettings
            from engine.pls.algorithm import estimate_pls
            constructs = {b["id"]: {k: v for k, v in b.items() if k != "data"} for b in request["blocks"]}
            data = {b["id"]: np.array(b["data"], dtype=float) for b in request["blocks"]}
            result = estimate_pls(data, constructs, request["paths"], PipelineSettings(**request["settings"]),
                                  None if request["obs_weights"] is None else np.array(request["obs_weights"]))
        elif op == "least_squares":
            y = np.array(request["y"], dtype=float)
            if w is not None:
                x = x * np.sqrt(w)[:, None]
                y = y * np.sqrt(w)
            beta, _, rank, singular = np.linalg.lstsq(x, y, rcond=None)
            result = {"coefficients": beta, "rank": rank, "singular_values": singular}
        elif op == "moments":
            result = {"mean": stats.weighted_mean(x, w), "std": stats.weighted_std(x, w, ddof=request["ddof"])}
        elif op == "correlation":
            result = stats.weighted_corr(x, np.array(request["y"], dtype=float), w)
        elif op == "standardize":
            result = standardize_matrix(x, w)
        elif op == "pairwise_correlation":
            r, n = stats.pairwise_correlation_matrix(x)
            result = {"correlations": r, "counts": n}
        elif op == "prob_greater":
            result = stats.prob_greater(x, np.array(request["y"], dtype=float))
        elif op == "chunk_tasks":
            result = chunk_tasks(request["n_tasks"], request["n_workers"])
        else:
            raise ValueError(op)
    # Internal expanded frames are not JSON API payloads. Compare their full
    # ordered contents explicitly rather than dropping them from the fixture.
    def encode_frames(value):
        import pandas as pd
        if isinstance(value,pd.DataFrame):
            return {"columns":list(value.columns),"rows":value.to_numpy().tolist()}
        if isinstance(value,dict): return {k:encode_frames(v) for k,v in value.items()}
        if isinstance(value,list): return [encode_frames(v) for v in value]
        return value
    return json.loads(json.dumps(sanitize_for_json(encode_frames(result))))


def compare(expected, actual, path="$", errors=None):
    errors = [] if errors is None else errors
    if isinstance(expected,int) and not isinstance(expected,bool):
        if not isinstance(actual,int) or isinstance(actual,bool) or expected!=actual:
            errors.append(f"{path}: integer mismatch: {expected!r} != {actual!r}")
    elif isinstance(expected, float):
        if not isinstance(actual, (int, float)) or isinstance(actual, bool):
            errors.append(f"{path}: expected number {expected!r}, got {actual!r}")
        elif isinstance(expected, int):
            if expected != actual:
                errors.append(f"{path}: {expected} != {actual}")
        elif not math.isclose(expected, actual, abs_tol=2e-12, rel_tol=2e-12):
            errors.append(f"{path}: {expected!r} != {actual!r}; abs error {abs(expected - actual):.3g}")
    elif isinstance(expected, dict) and isinstance(actual, dict) and expected.keys() == actual.keys():
        for key in expected:
            compare(expected[key], actual[key], f"{path}.{key}", errors)
    elif isinstance(expected, list) and isinstance(actual, list) and len(expected) == len(actual):
        for i, (a, b) in enumerate(zip(expected, actual)):
            compare(a, b, f"{path}[{i}]", errors)
    elif type(expected) is not type(actual) or expected != actual:
        errors.append(f"{path}: shape/type/value mismatch: {repr(expected)[:500]} != {repr(actual)[:500]}")
    return errors


def verify(release=False, suite="foundations"):
    import warnings
    # Ensure the comparator cannot silently accept schema, null, order or numeric changes.
    for a, b in [(1.0, 1.01), (2**63+1,2**63), (None, 0), ({"a": 1}, {}), ([1, 2], [2, 1])]:
        assert compare(a, b), (a, b)
    check_reference()
    fixture_file = OUTPUT / f"{suite}-fixtures.json"
    if fixture_file.exists():
        fixtures = json.loads(fixture_file.read_text())
    else:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            source = SUITES[suite]()
            fixtures = [{"input": request, "expected": oracle(request)} for request in source]
        write_json(fixture_file, fixtures)
    manifest = ROOT / "backend-rust" / "Cargo.toml"
    build = ["cargo", "build", "--offline", "--manifest-path", str(manifest)]
    if release:
        build.append("--release")
    subprocess.run(build, check=True)
    profile = "release" if release else "debug"
    binary = ROOT / "backend-rust" / "target" / profile / ("statsem-engine.exe" if os.name == "nt" else "statsem-engine")
    execution = subprocess.run([str(binary)], input="".join(json.dumps(f["input"]) + "\n" for f in fixtures), text=True, capture_output=True, check=True)
    replies = execution.stdout.splitlines()
    if len(replies) != len(fixtures):
        raise SystemExit(f"Expected {len(fixtures)} responses; got {len(replies)}")
    failures = []
    for i, (fixture, line) in enumerate(zip(fixtures, replies)):
        reply = json.loads(line)
        errors = [f"Rust error: {reply['error']}"] if "error" in reply else compare(fixture["expected"], reply["result"])
        if errors:
            failures.append({"case": i, "input": fixture["input"].get("case_name", fixture["input"]), "error_count": len(errors), "errors": errors[:20]})
    correction_path = OUTPUT / "reference-corrections.json"
    report = {"scope": suite, "profile": profile, "cases": len(fixtures), "passed": len(fixtures) - len(failures), "abs_tolerance": 2e-12, "rel_tolerance": 2e-12,
              "reference_corrections_sha256":hashlib.sha256(correction_path.read_bytes()).hexdigest() if correction_path.exists() else None,"failures": failures}
    write_json(OUTPUT / f"{suite}-parity{'-release' if release else ''}.json", report)
    print(json.dumps(report, indent=2))
    if failures:
        raise SystemExit(1)


def baseline_tests():
    import pytest
    import settings_io
    # Storage tests register recent projects; direct these writes away from the
    # real desktop settings without changing HOME or the reference source.
    with tempfile.TemporaryDirectory(prefix="statsem-reference-") as directory:
        settings_io.SETTINGS_PATH = str(Path(directory) / "settings.json")
        report = "python-corrected-tests.xml" if (OUTPUT / "reference-corrections.json").exists() else "python-baseline-tests.xml"
        result = pytest.main([str(ROOT / "backend" / "tests"), "-q", "-p", "no:cacheprovider",
                              f"--junitxml={OUTPUT / report}"])
    raise SystemExit(result)


def capture_pls():
    """Freeze full unrounded pipeline outputs for the next engine milestone."""
    import copy
    import numpy as np
    import pandas as pd
    from core.json_utils import sanitize_for_json
    from core.settings_schema import PipelineSettings
    from engine.pls.algorithm import run_pipeline

    destination = OUTPUT / "pls-reference.json"
    if destination.exists():
        raise SystemExit("PLS reference already exists; preserve it.")
    rng = np.random.default_rng(6913)
    n = 128
    x = rng.normal(size=n)
    mediator = 0.6 * x + rng.normal(size=n) * 0.7
    y = 0.25 * x + 0.5 * mediator + rng.normal(size=n) * 0.6
    columns = [f"{name}{i}" for name in ["x", "m", "y"] for i in range(1, 4)]
    matrix = np.column_stack([loading * scores + rng.normal(size=n) * 0.35
                              for scores in [x, mediator, y] for loading in [0.7, 0.85, 0.95]])
    frame = pd.DataFrame(matrix, columns=columns)
    frame["survey_weight"] = rng.uniform(0.5, 2, size=n)
    model = {"constructs": [{"id": name.upper(), "name": name.upper(), "type": "reflective",
                              "indicators": [f"{name}{i}" for i in range(1, 4)]} for name in ["x", "m", "y"]],
             "indicators": [{"id": column, "column": column} for column in columns],
             "paths": [{"from": "X", "to": "M"}, {"from": "M", "to": "Y"}, {"from": "X", "to": "Y"}]}
    configurations = [{"inner_weighting": scheme, "initial_weights": initialization}
                      for scheme in ["path", "factor", "centroid"]
                      for initialization in ["equal", "lohmoller", "sum_scores"]]
    configurations.extend([{"weight_column": "survey_weight"}, {"consistent": True}, {"max_iter": 0}])
    fixtures = []
    for options in configurations:
        settings = PipelineSettings(**options)
        result = run_pipeline(frame.copy(), copy.deepcopy(model), settings)
        fixtures.append({"options": options, "resolved_settings": settings.model_dump(mode="json"),
                         "expected": sanitize_for_json(result)})
    write_json(destination, {"columns": list(frame.columns), "rows": frame.values.tolist(), "model": model,
                             "cases": fixtures, "status": "Python reference only; Rust PLS estimator not yet implemented"})
    print(f"Captured {len(fixtures)} full PLS pipeline references.")


SUITES = {"foundations":cases,"matrix":matrix_cases,"pipeline":pipeline_cases,"linalg":linalg_cases,
          "estimator":estimator_cases,"estimator-benchmarks":estimator_benchmarks,"inference":inference_cases,"rng":rng_cases,"bootstrap":bootstrap_cases,"imputation":imputation_cases,"sorting":sorting_cases,"analysis":analysis_cases,"blindfolding":blindfolding_cases,"permutation":permutation_cases,"prediction-v2":prediction_cases,"nonlinear":nonlinear_cases,"quadratic":quadratic_cases,"moderation":moderation_cases,"expansion-bootstrap":expansion_bootstrap_cases,"contrast":contrast_cases,"nca":nca_cases,"hcm":hcm_cases,"hcm-consistent":hcm_consistent_cases,"spec-hash":spec_hash_cases,"spec-hash-random":spec_hash_random_cases,"project-store":project_store_cases,"snapshot-store-v2":snapshot_store_cases,"mga":mga_cases,"micom-v2":micom_cases,"cta":cta_cases,"power":power_cases,"rng-distributions":rng_distribution_cases,"fimix":fimix_cases,"pos":pos_cases}

SUITES["otg"] = otg_cases
SUITES["ex-post"] = ex_post_cases
SUITES["ex-post-merge"] = ex_post_merge_cases
SUITES["copula-primitives"] = copula_cases
SUITES["copula-pipeline"] = copula_pipeline_cases
SUITES["copula-wald"] = copula_wald_cases
SUITES["copula-bootstrap-v2"] = copula_bootstrap_cases
SUITES["expansion-bootstrap-v2"] = SUITES.pop("expansion-bootstrap")
SUITES["copula-attach"] = copula_attach_cases
SUITES["copula-integration"] = copula_integration_cases
SUITES["derivation"] = derivation_cases
SUITES["categorical-groups"] = categorical_group_cases
SUITES["derivation-types"] = derivation_type_cases

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["baseline", "register-corrections", "verify", "verify-all", "baseline-tests", "capture-pls", *[f"verify-{name}" for name in SUITES]])
    parser.add_argument("--corrected-file",action="append",default=[],help="Explicit baselined Python file to register after preserving its original snapshot")
    parser.add_argument("--release", action="store_true", help="Compare an optimized Rust binary (verify only)")
    arguments = parser.parse_args()
    if arguments.command == "baseline":
        capture_baseline()
    elif arguments.command == "register-corrections":
        if not arguments.corrected_file: parser.error("register-corrections requires --corrected-file")
        register_corrections(arguments.corrected_file)
    elif arguments.command == "verify":
        verify(arguments.release)
    elif arguments.command == "verify-all":
        reports=[]
        for suite in SUITES:
            verify(arguments.release,suite)
            path=OUTPUT / f"{suite}-parity{'-release' if arguments.release else ''}.json"
            report=json.loads(path.read_text())
            reports.append({"scope":suite,"cases":report["cases"],"passed":report["passed"],"report":path.name,"sha256":hashlib.sha256(path.read_bytes()).hexdigest()})
        native_sources={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/"backend-rust"/"src").glob("*.rs"))}
        native_sources["backend-rust/Cargo.lock"]=hashlib.sha256((ROOT/"backend-rust"/"Cargo.lock").read_bytes()).hexdigest()
        write_json(OUTPUT/f"verification-summary{'-release' if arguments.release else ''}.json",{"suites":reports,"cases":sum(r["cases"] for r in reports),"passed":sum(r["passed"] for r in reports),"native_sources_sha256":native_sources,"reference_corrections_sha256":hashlib.sha256((OUTPUT/"reference-corrections.json").read_bytes()).hexdigest()})
    elif arguments.command.startswith("verify-"):
        verify(arguments.release, arguments.command.removeprefix("verify-"))
    elif arguments.command == "baseline-tests":
        baseline_tests()
    else:
        capture_pls()
