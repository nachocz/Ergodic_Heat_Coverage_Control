"""Write docs/data/fields.json: the targets, material layouts, and scanned surface used by
the web pages, resampled to the simulation grid (100 x 100) as base64 float32 arrays.

    python examples/export_web_data.py
"""
import base64
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from ehcc import TARGETS, load_material, load_target  # noqa: E402
from ehcc.surface import Surface  # noqa: E402

N = 100
LABELS = {
    "T4": "T4 · dignity (Fig. 2)", "T1": "T1 · strokes", "T2": "T2 · disc and arc", "T3": "T3 · frame and dot",
    "T5": "T5 · nested squares", "interleaved": "Interleaved plateau (Fig. 9)", "sole_3d": "Sole (3D trial, Fig. 16)",
}
RUBBER = {"lam": 1.2e-4, "kappa": 0.03}      # material maps of T5 and Fig. 9
METAL = {"lam": 2.4e-4, "kappa": 0.08}


def encode(array: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(array, dtype="<f4").tobytes()).decode("ascii")


def main() -> None:
    out = {"N": N, "targets": {}, "materials": {}, "surfaces": {}, "rubber": RUBBER, "metal": METAL}
    for name in LABELS:
        T = load_target(name, N)
        out["targets"][name] = {"label": LABELS[name], "data": encode(T),
                                "T_amb": float(T.min()), "T_max": float(T.max())}
    for name in ("halves", "interleaved"):
        lam = load_material(name, N)[..., 0]
        out["materials"][name] = {"metal_fraction": encode((lam - RUBBER["lam"]) / (METAL["lam"] - RUBBER["lam"]))}
    sole = Surface.scanned_sole(N)
    out["surfaces"]["sole_3d"] = {"label": "Scanned sole (Sec. VII)", "height": encode(sole.height),
                                  "domain_size": sole.L}
    path = os.path.join(ROOT, "docs", "data", "fields.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(out, handle, separators=(",", ":"))
    print(f"written: {path} ({os.path.getsize(path) / 1024:.0f} kB); targets: {', '.join(LABELS)} (of {len(TARGETS)})")


if __name__ == "__main__":
    main()
