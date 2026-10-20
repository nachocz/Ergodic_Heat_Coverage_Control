"""Fig. 6: ergodic metric E(t) (14) of EHCC on target T3 under a hot (+1200 W) and a cold
(-1200 W) disturbance, for ablations of the baseline parameters (P, h, lambda, k_I).
The inset zooms on the second half, with dotted lines at 2 E_0 (E_0: 90th percentile of
E(t) over the second half).

    python figures/fig6_ablation.py      writes outputs/figures/fig6_ablation.pdf (and .png), about 1 min

Setup of this study: T3 scaled to [20, 98] degC, lambda = 1.2e-4, coupling 0.1 outside
Omega_ROI, k_I = 0.004, and the other parameters of the benchmark. The ablation labelled
alpha changes lambda, which scales the diffusivity alpha = lambda kappa.
"""
import copy
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker as ticker  # noqa: E402
import numpy as np  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ehcc import Config, Disturbance, EHCCSimulation, load_target  # noqa: E402

OUT = os.path.join("outputs", "figures")
CASES = [("Baseline", {}), ("$P$=600 W", {"P": 600.0}), ("$P$=1800 W", {"P": 1800.0}), ("$h$=15", {"h": 15.0}),
         (r"$\alpha$=3e-4", {"lam": 3.0e-4}), (r"$\alpha$=5e-5", {"lam": 5.0e-5}), (r"$k_I$=0.04", {"k_I": 0.04})]
PALETTE = ["#000000", "#E69F00", "#56B4E9", "#009E73", "#D55E00", "#CC79A7", "#0072B2"]
LINESTYLES = ["-", "--", "-.", ":", "-", "--", "-."]
SMOOTH = 50                                   # moving-average window [steps]


def config(overrides: dict) -> Config:
    cfg = Config()
    cfg.thermal.lam, cfg.thermal.outside_roi_coupling, cfg.standoff.k_I = 1.2e-4, 0.1, 0.004
    cfg.heater.P = overrides.get("P", cfg.heater.P)
    cfg.thermal.h = overrides.get("h", cfg.thermal.h)
    cfg.thermal.lam = overrides.get("lam", cfg.thermal.lam)
    cfg.standoff.k_I = overrides.get("k_I", cfg.standoff.k_I)
    return cfg


def target() -> np.ndarray:
    """T3 scaled to [T_amb, T_amb + 0.6 (T_source - T_amb)] = [20, 98] degC."""
    raw = load_target("T3")
    lo, hi = raw.min(), raw.max()
    T = 20.0 + (raw - lo) / (hi - lo) * (0.6 * (150.0 - 20.0))
    T[raw <= lo + 0.01 * (hi - lo)] = 20.0
    return T


def disturbances(total: float) -> list:
    return [Disturbance((0.45, 0.65), 0.12, +1200.0, 0.50 * total, 0.55 * total, 150.0),
            Disturbance((0.45, 0.65), 0.12, -1200.0, 0.75 * total, 0.82 * total, 20.0)]


def smooth(x, w=SMOOTH):
    cs = np.insert(np.cumsum(x), 0, 0.0)
    out = np.full_like(x, np.nan, dtype=float)
    out[w // 2: w // 2 + len(x) - w + 1] = (cs[w:] - cs[:-w]) / w
    return out


def main():
    T_star = target()
    runs = []
    for label, overrides in CASES:
        cfg = config(overrides)
        total = cfg.steps * cfg.dt
        print(f"  {label} ...", flush=True)
        sim = EHCCSimulation(copy.deepcopy(cfg), T_star, disturbances=disturbances(total))
        runs.append((label, sim.run()))
    total = Config().steps * Config().dt

    plt.rcParams.update({"text.usetex": False, "font.family": "serif", "font.serif": ["DejaVu Serif", "Times New Roman"],
                         "mathtext.fontset": "cm", "font.size": 18, "axes.labelsize": 16, "legend.fontsize": 14,
                         "xtick.labelsize": 13, "ytick.labelsize": 13, "axes.linewidth": 0.8, "lines.linewidth": 1.4,
                         "savefig.dpi": 600, "savefig.bbox": "tight", "savefig.pad_inches": 0.02})
    fig, ax = plt.subplots(1, 1, figsize=(7.16, 2.4))
    inset = ax.inset_axes([0.62, 0.40, 0.35, 0.55])
    for a in (ax, inset):
        for i, dist in enumerate(disturbances(total)):
            a.axvspan(dist.t_start, dist.t_end, color=["#ff6666", "#6699ff"][i], alpha=0.12, zorder=0)
    bounds, peaks = [], []
    for i, (label, logs) in enumerate(runs):
        t, E = logs["t"], smooth(logs["E"])
        E0 = float(np.percentile(logs["E"][len(logs["E"]) // 2:], 90))
        zoom = int(len(t) * 0.45)
        ax.plot(t, E, color=PALETTE[i], ls=LINESTYLES[i], label=label)
        inset.plot(t[zoom:], E[zoom:], color=PALETTE[i], ls=LINESTYLES[i], lw=0.9)
        inset.axhline(2.0 * E0, color=PALETTE[i], ls=":", lw=0.7, alpha=0.65)
        bounds.append(2.0 * E0)
        peaks.append(np.nanmax(E[zoom:]))
    fmt = ticker.FuncFormatter(lambda x, _: f"{int(x) // 60}:{int(x) % 60:02d}")
    ax.set_xlabel("Time [m:s]")
    ax.set_ylabel(r"$\mathcal{E}(t)$")
    ax.xaxis.set_major_formatter(fmt)
    ax.xaxis.set_major_locator(ticker.MaxNLocator(nbins=6))
    ax.yaxis.set_major_locator(ticker.MaxNLocator(nbins=5))
    ax.set_ylim(bottom=0)
    ax.grid(True, alpha=0.25)
    ax.legend(loc="upper left", bbox_to_anchor=(0.01, 1.0), framealpha=0.92, ncol=2, fontsize=8.5, handlelength=1.4,
              handletextpad=0.4, borderpad=0.25, labelspacing=0.15, columnspacing=0.8)
    inset.xaxis.set_major_formatter(fmt)
    inset.xaxis.set_major_locator(ticker.MaxNLocator(nbins=2))
    inset.yaxis.set_major_locator(ticker.MaxNLocator(nbins=3))
    inset.ticklabel_format(axis="y", style="scientific", scilimits=(0, 0))
    inset.yaxis.get_offset_text().set_fontsize(8)
    inset.tick_params(labelsize=9, width=0.5, length=2.5)
    inset.set_ylim(0, 1.3 * max(max(bounds), max(peaks)))
    inset.grid(True, alpha=0.2, linewidth=0.3)
    inset.set_facecolor("#fafafa")
    ax.indicate_inset_zoom(inset, edgecolor="0.4", linewidth=0.5, linestyle="--", alpha=0.6)
    fig.subplots_adjust(left=0.07, right=0.985, bottom=0.20, top=0.97)
    os.makedirs(OUT, exist_ok=True)
    for ext in ("pdf", "png"):
        fig.savefig(os.path.join(OUT, f"fig6_ablation.{ext}"))
    print(f"written: {OUT}/fig6_ablation.pdf and .png")


if __name__ == "__main__":
    main()
