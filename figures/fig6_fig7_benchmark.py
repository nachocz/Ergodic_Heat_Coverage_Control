"""Figs. 6 and 7: the simulation benchmark of Sec. VI on targets T1-T5.

    Fig. 6: ||e||_L2(Omega_ROI)(t) and controller computation time, one column per target.
    Fig. 7: T* and, for each method, the temperature at the snapshot nearest to step 1000
            with the trajectory up to that step (start: green circle, end: red square).

    python figures/fig6_fig7_benchmark.py      writes outputs/figures/fig6_*.pdf, fig7_*.pdf (and .png)

The runs are taken from outputs/benchmark (see examples/benchmark.py) and computed if
missing (about 10 min for all of them).
"""
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.gridspec as gridspec  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker as ticker  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import Normalize  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ehcc.benchmark import LABELS, METHODS, STYLE, TARGETS, cached, disturbances  # noqa: E402

OUT = os.path.join("outputs", "figures")
TWO_LINES = {"ehcc": "EHCC\n(ours)", "ehcc_na": "EHCC-NA\n(ours)", "greedy": "Greedy-A\n(ours)",
             "gtm": "GTM\n(Hu 2021)", "lqg_m": "LQG-M\n(Jon. 2003)", "mpdc": "MPDC\n(Mud. 2022)"}
SHADE = ["#ff6666", "#6699ff"]           # hot, cold
CUTOFF = 1000                            # trajectory shown up to this step in Fig. 7

plt.rcParams.update({
    "text.usetex": False, "font.family": "serif", "font.serif": ["DejaVu Serif", "Times New Roman", "Times"],
    "mathtext.fontset": "cm", "font.size": 22, "axes.labelsize": 22, "axes.titlesize": 22, "legend.fontsize": 22,
    "xtick.labelsize": 22, "ytick.labelsize": 22, "savefig.dpi": 300, "savefig.bbox": "tight",
    "savefig.pad_inches": 0.05, "axes.linewidth": 1.0, "lines.linewidth": 2.0,
    "legend.handlelength": 1.6, "legend.handletextpad": 1.5, "legend.columnspacing": 0.8,
})


def minsec(x, _):
    return f"{int(x) // 60}:{int(x) % 60:02d}"


def shade(ax):
    for i, dist in enumerate(disturbances()):
        ax.axvspan(dist.t_start, dist.t_end, color=SHADE[i], alpha=0.12, zorder=0)


def save(fig, name):
    os.makedirs(OUT, exist_ok=True)
    for ext in ("pdf", "png"):
        fig.savefig(os.path.join(OUT, f"{name}.{ext}"))
    plt.close(fig)
    print(f"written: {OUT}/{name}.pdf and .png")


def fig7(runs):
    fig, axes = plt.subplots(2, len(TARGETS), figsize=(5.0 * len(TARGETS), 6.0), sharex="col", squeeze=False)
    for c, target in enumerate(TARGETS):
        ax_l2, ax_ct = axes[0, c], axes[1, c]
        for method in METHODS:
            d = runs[target][method]
            color, ls, lw = STYLE[method]
            kw = dict(color=color, label=LABELS[method], linestyle=ls, linewidth=lw)
            ax_l2.plot(d["t"], 35.0 * np.sqrt(np.maximum(d["l2_error"], 0.0)), **kw)   # L = 35 cm
            ct = 1000.0 * d["ctrl_time"]
            win = min(50, max(1, len(ct) // 20))
            ax_ct.plot(d["t"], np.convolve(ct, np.ones(win) / win, mode="same"), **kw)
        shade(ax_l2)
        for ax in (ax_l2, ax_ct):
            ax.set_yscale("log")
            ax.grid(True, which="major", ls=":", lw=0.3, alpha=0.5)
        ax_l2.set_title(f"Target {target[1]}", fontweight="bold", pad=6)
        ax_ct.xaxis.set_major_formatter(ticker.FuncFormatter(minsec))
        ax_ct.set_xlabel("Time [min:s]")
        if c == 0:
            ax_l2.set_ylabel(r"$\|e\|_{L^2}$ [$^\circ$C$\cdot$cm]")
            ax_ct.set_ylabel("Cost [ms]")
    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=len(handles), framealpha=0.9, edgecolor="0.7",
               bbox_to_anchor=(0.5, -0.06))
    plt.subplots_adjust(wspace=0.32, hspace=0.15, left=0.08, right=0.98, top=0.92, bottom=0.22)
    save(fig, "fig6_l2_ctrl_time")


def fig8(runs):
    ncols, cell, label_w, cbar_w = 1 + len(METHODS), 3.0, 1.4, 0.6
    fig_w, fig_h = label_w + cell * ncols + cbar_w + 0.2, cell * len(TARGETS) + 1.4
    fig = plt.figure(figsize=(fig_w, fig_h))
    gs = gridspec.GridSpec(len(TARGETS), ncols + 1, width_ratios=[1] * ncols + [0.04], wspace=0.04, hspace=0.06,
                           left=label_w / fig_w, right=(fig_w - 0.15) / fig_w, top=(fig_h - 0.95) / fig_h, bottom=0.02)
    lo = min(float(runs[t]["ehcc"]["T_star"].min()) for t in TARGETS)
    hi = max(float(runs[t]["ehcc"]["T_star"].max()) * 1.04 for t in TARGETS)
    for r, target in enumerate(TARGETS):
        ax = fig.add_subplot(gs[r, 0])
        ax.imshow(runs[target]["ehcc"]["T_star"], origin="lower", extent=[0, 1, 0, 1], cmap="hot", vmin=lo, vmax=hi)
        ax.set_xticks([]); ax.set_yticks([])
        if r == 0:
            ax.set_title(r"$T^*$", fontsize=39, fontweight="bold", pad=10)
        ax.set_ylabel(f"Target {target[1]}", fontsize=36, fontweight="bold", labelpad=10)
        for c, method in enumerate(METHODS):
            d = runs[target][method]
            ax = fig.add_subplot(gs[r, c + 1])
            snap = int(np.argmin(np.abs(d["snapshot_steps"] - CUTOFF)))
            ax.imshow(d["snapshots"][snap], origin="lower", extent=[0, 1, 0, 1], cmap="hot", vmin=lo, vmax=hi)
            traj = d["trajectory"][:CUTOFF + 1]
            colors = plt.cm.viridis(np.linspace(0, 1, max(len(traj) - 1, 1)))
            for j in range(len(traj) - 1):
                ax.plot(traj[j:j + 2, 0], traj[j:j + 2, 1], color=colors[j], lw=0.40, alpha=0.85)
            ax.plot(*traj[0], "o", color="#00cc00", ms=5.0, zorder=5)
            ax.plot(*traj[-1], "s", color="#ee0000", ms=5.0, zorder=5)
            ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.set_xticks([]); ax.set_yticks([])
            if r == 0:
                ax.set_title(TWO_LINES[method], fontsize=36, fontweight="bold", pad=10, linespacing=0.9)
    sm = plt.cm.ScalarMappable(cmap="hot", norm=Normalize(lo, hi))
    cb = fig.colorbar(sm, cax=fig.add_subplot(gs[:, -1]))
    cb.set_label(r"$T$  [$^\circ$C]", fontsize=39)
    cb.ax.tick_params(labelsize=33)
    save(fig, "fig7_trajectories")


def main():
    runs = {t: {m: cached(t, m) for m in METHODS} for t in TARGETS}
    fig7(runs)
    fig8(runs)


if __name__ == "__main__":
    main()
