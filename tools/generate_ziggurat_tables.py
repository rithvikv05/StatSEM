"""Generate Rust numeric tables from the pinned, BSD-licensed NumPy header.

Development only: the committed Rust tables need no Python during build/runtime.
Usage: python tools/generate_ziggurat_tables.py /path/to/ziggurat_constants.h
"""
import hashlib
from pathlib import Path
import re
import struct
import sys

SOURCE = "https://raw.githubusercontent.com/numpy/numpy/v2.3.4/numpy/random/src/distributions/ziggurat_constants.h"
EXPECTED_SHA256 = "9f8b114014b8475777e88c6af80e126654fe0753693d6eabba365d3c4051236c"


def main():
    source = Path(sys.argv[1]).read_bytes()
    if hashlib.sha256(source).hexdigest() != EXPECTED_SHA256:
        raise SystemExit("NumPy table source does not match pinned SHA-256")
    header = source.decode()
    output = ["//! Generated numeric Ziggurat tables; do not edit by hand.",
              f"//! Source: {SOURCE}", f"//! Source SHA-256: {EXPECTED_SHA256}",
              "//! BSD 3-Clause attribution: ../THIRD_PARTY_NOTICES.md.", ""]
    for name in ["ki_double", "wi_double", "fi_double", "ke_double", "we_double", "fe_double"]:
        body = re.search(rf"static const (?:uint64_t|double) {name}\[\] = \{{(.*?)\}};", header, re.S).group(1)
        values = [token.strip() for token in body.split(",") if token.strip()]
        if len(values) != 256:
            raise SystemExit(f"Unexpected table size: {name}")
        bits = [int(value.removesuffix("ULL"), 16) if name.startswith(("ki", "ke")) else struct.unpack("<Q", struct.pack("<d", float(value)))[0] for value in values]
        output.append(f"pub const {name.upper()}: [u64;256] = [")
        output.extend("    " + ", ".join(f"0x{value:016x}" for value in bits[i:i+4]) + "," for i in range(0,256,4))
        output.append("];\n")
    for name in ["ziggurat_nor_r", "ziggurat_nor_inv_r", "ziggurat_exp_r"]:
        literal = re.search(rf"static const double {name}\s*=\s*([^;]+);",header).group(1)
        bits = struct.unpack("<Q",struct.pack("<d",float(literal)))[0]
        output.append(f"pub const {name.upper()}: f64 = f64::from_bits(0x{bits:016x});")
    destination = Path(__file__).resolve().parents[1] / "backend-rust" / "src" / "ziggurat.rs"
    destination.write_text("\n".join(output)+"\n")
    print(f"Generated six pinned 256-entry tables in {destination}")


if __name__ == "__main__":
    main()
