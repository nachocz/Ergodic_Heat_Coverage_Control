"""Fig. 9: interleaved material heterogeneity (Sec. VI-E): T*, the material layout
(metal/rubber checkerboard with a centred metal disk in a rubber annulus), and, for each
method, the final temperature with the first 7000 steps of the trajectory (start: green).

    python figures/fig9_interleaved.py           writes outputs/figures/fig9_interleaved.pdf (and .png)
    python figures/fig9_interleaved.py --full    adds ||e||_L2(t) and the computation cost

The runs are taken from outputs/benchmark/interleaved (see examples/benchmark.py) and
computed if missing; the metrics of Table III are printed.
"""
import argparse
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.gridspec as gridspec  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker as ticker  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.collections import LineCollection  # noqa: E402
from matplotlib.colors import ListedColormap, Normalize  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ehcc.benchmark import LABELS, METHODS, STYLE, cached, disturbances, metrics  # noqa: E402

OUT = os.path.join("outputs", "figures")
TITLES = {"ehcc": "EHCC (ours)","ehcc_na": "EHCC-NA (ours)", "greedy": "Greedy-A (ours)",
          "gtm": "GTM (Hu 2021)", "lqg_m": "LQG-M (Jon. 2003)", "mpdc": "MPDC (Mud. 2022)"}
RUBBER, METAL = "#3b5b92", "#c24a3d"
CUTOFF, MAX_POINTS = 7000, 2000

plt.rcParams.update({
    "text.usetex": False, "font.family": "serif", "font.serif": ["DejaVu Serif", "Times New Roman", "Times"],
    "mathtext.fontset": "cm", "font.size": 15, "axes.labelsize": 16, "axes.titlesize": 16, "legend.fontsize": 15,
    "xtick.labelsize": 13, "ytick.labelsize": 13, "savefig.dpi": 300, "savefig.bbox": "tight",
    "savefig.pad_inches": 0.05, "axes.linewidth": 1.0, "lines.linewidth": 2.0,
})


def trajectory(ax, traj):
    traj = traj[:CUTOFF]
    idx = np.unique(np.linspace(0, len(traj) - 1, min(len(traj), MAX_POINTS), dtype=int))
    pts = traj[idx]
    seg = np.concatenate([pts[:-1, None, :], pts[1:, None, :]], axis=1)
    lc = LineCollection(seg, cmap="viridis", norm=Normalize(0, len(seg)), linewidth=0.22, alpha=0.42, zorder=3)
    lc.set_array(np.arange(len(seg)))
    ax.add_collection(lc)
    ax.plot(*pts[0], "o", color="#00e000", ms=5.0, mec="k", mew=0.5, zorder=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--full", action="store_true")
    args = parser.parse_args()
    runs = {m: cached("interleaved", m) for m in METHODS}
    ref = runs["ehcc"]
    lo = float(ref["T_star"].min())
    hi = 1.02 * max([float(ref["T_star"].max())] + [float(np.percentile(runs[m]["T"], 99.5)) for m in METHODS])

    fig = plt.figure(figsize=(15.5, 11.0 if args.full else 7.4))
    outer = gridspec.GridSpec(2 if args.full else 1, 1, height_ratios=[1.0, 0.72] if args.full else [1.0],
                              hspace=0.28, left=0.055, right=0.94, top=0.95, bottom=0.10 if args.full else 0.05)
    top = gridspec.GridSpecFromSubplotSpec(2, 5, subplot_spec=outer[0], width_ratios=[1, 1, 1, 1, 0.06],
                                           wspace=0.06, hspace=0.16)
    ax = fig.add_subplot(top[0, 0])
    ax.imshow(ref["T_star"], origin="lower", extent=[0, 1, 0, 1], cmap="hot", vmin=lo, vmax=hi)
    ax.set_title(r"$T^{*}$", fontweight="bold", pad=4)
    ax.set_xticks([]); ax.set_yticks([])
    ax = fig.add_subplot(top[1, 0])
    lam = ref["lam"]
    metal = (lam > 0.5 * (lam.min() + lam.max())).astype(float)
    ax.imshow(metal, origin="lower", extent=[0, 1, 0, 1], cmap=ListedColormap([RUBBER, METAL]), vmin=0, vmax=1,
              interpolation="nearest")
    ax.set_title("Material", fontweight="bold", pad=4)
    ax.set_xticks([]); ax.set_yticks([])
    ax.legend(handles=[Patch(facecolor=METAL, label="metal"), Patch(facecolor=RUBBER, label="rubber")],
              loc="upper center", bbox_to_anchor=(0.5, -0.04), ncol=2, fontsize=11, frameon=False,
              handlelength=1.0, columnspacing=1.0, handletextpad=0.4)
    for (r, c), method in zip([(0, 1), (0, 2), (0, 3), (1, 1), (1, 2), (1, 3)], METHODS):
        ax = fig.add_subplot(top[r, c])
        ax.imshow(runs[method]["T"], origin="lower", extent=[0, 1, 0, 1], cmap="hot", vmin=lo, vmax=hi)
        trajectory(ax, runs[method]["trajectory"])
        ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.set_xticks([]); ax.set_yticks([])
        ax.set_title(TITLES[method], fontweight="bold", pad=4)
    sm = plt.cm.ScalarMappable(cmap="hot", norm=Normalize(lo, hi))
    fig.colorbar(sm, cax=fig.add_subplot(top[:, 4])).set_label(r"$T$ [$^\circ$C]")

    if args.full:
        bottom = gridspec.GridSpecFromSubplotSpec(1, 2, subplot_spec=outer[1], wspace=0.22)
        ax_l2, ax_ct = fig.add_subplot(bottom[0, 0]), fig.add_subplot(bottom[0, 1])
        for method in METHODS:
            d, (color, ls, _) = runs[method], STYLE[method]
            kw = dict(color=color, label=LABELS[method], linestyle=ls, linewidth=1.6)
            ax_l2.plot(d["t"], 35.0 * np.sqrt(np.maximum(d["l2_error"], 0.0)), **kw)
            ct = 1000.0 * d["ctrl_time"]
            win = min(50, max(1, len(ct) // 20))
            ax_ct.plot(d["t"], np.convolve(ct, np.ones(win) / win, mode="same"), **kw)
        for ax in (ax_l2, ax_ct):
            for i, dist in enumerate(disturbances()):
                ax.axvspan(dist.t_start, dist.t_end, color=["#ff6666", "#6699ff"][i], alpha=0.13, zorder=0)
            ax.set_yscale("log")
            ax.grid(True, which="major", ls=":", lw=0.4, alpha=0.5)
            ax.xaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f"{int(x) // 60}:{int(x) % 60:02d}"))
            ax.set_xlabel("Time [min:s]")
        ax_l2.set_ylabel(r"$\|e\|_{L^2(\Omega_{\mathrm{ROI}})}$ [$^\circ$C$\cdot$cm]")
        ax_ct.set_ylabel("Controller cost [ms]")
        handles, labels = ax_l2.get_legend_handles_labels()
        fig.legend(handles, labels, loc="lower center", ncol=len(handles), framealpha=0.9, edgecolor="0.7",
                   bbox_to_anchor=(0.5, 0.005))

    os.makedirs(OUT, exist_ok=True)
    name = "fig9_interleaved_full" if args.full else "fig9_interleaved"
    for ext in ("pdf", "png"):
        fig.savefig(os.path.join(OUT, f"{name}.{ext}"))
    plt.close(fig)
    print(f"written: {OUT}/{name}.pdf and .png")
    print(f"\n{'method':18s} {'int||e||dt [1e5]':>16s} {'<e_bar> [C]':>12s} {'<sigma_e> [C]':>14s} {'cost mean/max [ms]':>19s}")
    for method in METHODS:
        m = metrics(runs[method])
        print(f"{LABELS[method]:18s} {m['l2_integral'] / 1e5:16.2f} {m['e_mean']:12.2f} {m['e_std']:14.2f} "
              f"{m['cost_mean']:10.2f}/{m['cost_max']:.2f}")


if __name__ == "__main__":
    main()
