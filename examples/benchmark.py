"""Simulation benchmark of Sec. VI: all six methods on T1-T5 (Table II) and on the
interleaved heterogeneity case (Table III).

    python examples/benchmark.py                          all runs (about 10 min), then the tables
    python examples/benchmark.py --targets T4 --methods ehcc gtm
    python examples/benchmark.py --force                  run again even if saved

Each run is saved to outputs/benchmark/<target>/<method>.npz and reused by
figures/fig6_fig7_benchmark.py and figures/fig8_interleaved.py. The computation
times (Cost columns) depend on the machine.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ehcc.benchmark import LABELS, METHODS, TARGETS, cached, metrics  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--targets", nargs="*", default=list(TARGETS) + ["interleaved"])
    parser.add_argument("--methods", nargs="*", default=list(METHODS), choices=METHODS)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    rows = []
    for target in args.targets:
        for method in args.methods:
            rows.append((target, method, metrics(cached(target, method, force=args.force))))
    print(f"\n{'target':12s} {'method':18s} {'int||e||dt [1e5]':>16s} {'<e_bar> [C]':>12s} "
          f"{'<sigma_e> [C]':>14s} {'cost mean/max [ms]':>19s}")
    for target, method, m in rows:
        print(f"{target:12s} {LABELS[method]:18s} {m['l2_integral'] / 1e5:16.2f} {m['e_mean']:12.2f} "
              f"{m['e_std']:14.2f} {m['cost_mean']:10.2f}/{m['cost_max']:.2f}")


if __name__ == "__main__":
    main()
