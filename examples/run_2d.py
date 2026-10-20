"""EHCC on the "dignity" target T4 (Fig. 2), with the hot and cold disturbances of Sec. VI.

    python examples/run_2d.py                       full run (33 min 20 s simulated, a few seconds)
    python examples/run_2d.py --target T2 --steps 4000
    python examples/run_2d.py --target my_target.npy

Writes outputs/<target>/summary.png and run.npz.
"""
import argparse
import os
import sys

import matplotlib

matplotlib.use("Agg")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ehcc import DEFAULT_MATERIAL, TARGETS, Config, EHCCSimulation, load_material, load_target  # noqa: E402
from ehcc.plotting import summary  # noqa: E402
from benchmark import DISTURBANCES, K_I  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", default="T4", help=f"{', '.join(TARGETS)}, or a .npy file")
    parser.add_argument("--steps", type=int, default=None)
    parser.add_argument("--config", default=None, help="YAML file (see config.yaml)")
    parser.add_argument("--no-disturbances", action="store_true")
    args = parser.parse_args()

    config = Config.from_yaml(args.config) if args.config else Config()
    config.standoff.k_I = K_I.get(args.target, config.standoff.k_I)
    material = load_material(DEFAULT_MATERIAL[args.target], config.N) if args.target in DEFAULT_MATERIAL else None
    disturbances = [] if args.no_disturbances else DISTURBANCES
    sim = EHCCSimulation(config, load_target(args.target, config.N), material, disturbances=disturbances)
    sim.run(args.steps, progress=1000)

    name = os.path.splitext(os.path.basename(args.target))[0]
    out = os.path.join("outputs", name)
    os.makedirs(out, exist_ok=True)
    sim.save(os.path.join(out, "run.npz"))
    summary(sim, os.path.join(out, "summary.png"), disturbances)
    print(f"written: {out}/summary.png, {out}/run.npz")


if __name__ == "__main__":
    main()
