"""EHCC on a 3D surface: the dynamics evolve on Omega = [0, 1]^2, and the end effector
follows r = s(p) + d n with orientation R_s(p) = [t_1, t_2, n] (5).

    python examples/run_3d.py                                   scanned sole surface and target (Sec. VII)
    python examples/run_3d.py --surface bump --target T4
    python examples/run_3d.py --live                            live Open3D view (pip install open3d)
"""
import argparse
import os
import sys

import matplotlib
import numpy as np

matplotlib.use("Agg")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ehcc import Config, EHCCSimulation, load_target, make_surface  # noqa: E402
from ehcc.plotting import summary  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--surface", default="sole_3d", help="flat, bump, wave, sole_3d, or a .npz height field")
    parser.add_argument("--target", default="sole_3d")
    parser.add_argument("--steps", type=int, default=6000)
    parser.add_argument("--live", action="store_true", help="Open3D window, refreshed every 10 steps")
    args = parser.parse_args()

    config = Config()
    surface = make_surface(args.surface, config.N, config.domain_size)
    config.domain_size = surface.L
    sim = EHCCSimulation(config, load_target(args.target, config.N), surface=surface)

    viewer = None
    if args.live:
        from ehcc.viewer3d import Viewer3D
        viewer = Viewer3D(surface, sim.domain.T_amb, float(sim.domain.T_star.max()))
    trail = []
    for k in range(args.steps):
        row = sim.step()
        trail.append([row["rx"], row["ry"], row["rz"]])
        if viewer is not None and k % 10 == 0:
            viewer.update(sim.domain.T, np.asarray(trail[-1500:]), np.asarray(trail[-1]), surface.frame(sim.p))
        if k % 1000 == 0:
            print(f"t = {row['t']:7.1f} s   e_bar = {row['e_mean']:+6.2f} C   d = {100 * row['d']:5.1f} cm   "
                  f"r = ({row['rx']:.3f}, {row['ry']:.3f}, {row['rz']:.3f}) m")
    if viewer is not None:
        viewer.close()
    out = os.path.join("outputs", f"3d_{args.surface}_{os.path.splitext(os.path.basename(args.target))[0]}")
    os.makedirs(out, exist_ok=True)
    sim.save(os.path.join(out, "run.npz"))
    summary(sim, os.path.join(out, "summary.png"))
    print(f"written: {out}/summary.png, {out}/run.npz")


if __name__ == "__main__":
    main()
