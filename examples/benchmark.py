"""EHCC on the targets of the simulation benchmark (Sec. VI): the metrics of Tables II and III.

    python examples/benchmark.py                 T1-T5 and the interleaved case (about 4 s each)
    python examples/benchmark.py --target T4     one target

Each run lasts 10 000 steps of 0.2 s with a hot pulse (+600 W, 16:40-17:00) and a
cold sink (-600 W, 26:40-27:40) centred at (0.45, 0.65).
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ehcc import DEFAULT_MATERIAL, Config, Disturbance, EHCCSimulation, load_material, load_target  # noqa: E402

DISTURBANCES = [Disturbance((0.45, 0.65), 0.12, +600.0, 1000.0, 1020.0, 150.0),
                Disturbance((0.45, 0.65), 0.12, -600.0, 1600.0, 1660.0, 20.0)]
K_I = {"T1": 0.04, "T2": 0.04, "T3": 0.04, "T4": 0.04, "T5": 0.02, "interleaved": 0.02}


def run(target: str, config: Config = None):
    config = config or Config()
    config.standoff.k_I = K_I.get(target, config.standoff.k_I)
    material = load_material(DEFAULT_MATERIAL[target], config.N) if target in DEFAULT_MATERIAL else None
    # T_amb = 20 C, the floor of the targets, with the target resampled as in the benchmark runs
    sim = EHCCSimulation(config, load_target(target, config.N, floor=False), material, disturbances=DISTURBANCES, T_amb=20.0)
    return sim, sim.run()


def metrics(logs, domain_size: float = 0.35):
    """Integral of ||e||_L2 dt in degC cm s (as in Table II), and the time averages of e_bar and sigma_e."""
    l2 = 100.0 * domain_size * np.sqrt(np.maximum(logs["l2_error"], 0.0))
    trapezoid = getattr(np, "trapezoid", None) or np.trapz
    return {"l2_integral": float(trapezoid(l2, logs["t"])),
            "e_mean": float(np.mean(logs["e_mean"])), "e_std": float(np.mean(logs["e_std"]))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", choices=list(K_I), nargs="*", default=["T1", "T2", "T3", "T4", "T5", "interleaved"])
    args = parser.parse_args()
    print(f"{'target':12s} {'int ||e|| dt [x1e5]':>20s} {'<e_bar> [C]':>12s} {'<sigma_e> [C]':>14s}")
    for target in args.target:
        _, logs = run(target)
        m = metrics(logs)
        print(f"{target:12s} {m['l2_integral'] / 1e5:20.2f} {m['e_mean']:12.2f} {m['e_std']:14.2f}")


if __name__ == "__main__":
    main()
