"""Figures in the style of the paper: temperature (hot), error e = T* - T (RdBu_r,
red = heat deficit), Omega_ROI dotted, mean error with its spread, p(t), d(t) and d_lb(t)."""
from __future__ import annotations

from typing import Iterable, Optional

import matplotlib.pyplot as plt
import numpy as np

ROI = "#1fbf8f"            # Omega_ROI outline (Figs. 2-4)
D_GREEN = "#1b6e20"        # d(t), d_lb(t) (Figs. 11-16)
P_X, P_Y = "#e41a1c", "#1f3fd1"
E_BLUE = "#1f77b4"
HOT, COLD = "#c62828", "#1f5fa8"
# Fig. 5: discrete k_I = 0.1 / 20, continuous k_I = 0.1 / 20
STABILITY = {"d_low": "#1f6feb", "d_high": "#d62728", "c_low": "#2ca02c", "c_high": "#9467bd"}


def style() -> None:
    plt.rcParams.update({"font.family": "serif", "mathtext.fontset": "cm", "font.size": 9,
                         "axes.titlesize": 10, "axes.linewidth": 0.6, "legend.frameon": False})


def roi_outline(ax, roi: np.ndarray) -> None:
    xs = np.linspace(0.0, 1.0, roi.shape[0])
    ax.contour(xs, xs, roi.astype(float), levels=[0.5], colors=ROI, linewidths=1.2,
               linestyles=[(0, (1.2, 1.4))])


def show_field(ax, data, roi, cmap, vmin, vmax, title, trajectory=None):
    im = ax.imshow(data, origin="lower", extent=(0, 1, 0, 1), cmap=cmap, vmin=vmin, vmax=vmax)
    roi_outline(ax, roi)
    if trajectory is not None and len(trajectory) > 1:
        ax.plot(trajectory[:, 0], trajectory[:, 1], color="#bfe3ff", lw=0.5, alpha=0.8)
        ax.plot(*trajectory[0], "o", ms=4, color="#2e9e3e", mec="white", mew=0.5)
    ax.set_title(title)
    ax.set_xticks([])
    ax.set_yticks([])
    return im


def shade(ax, disturbances: Iterable, scale: float = 1.0) -> None:
    """Red / blue bands over the active interval of hot / cold disturbances."""
    for dist in disturbances:
        ax.axvspan(dist.t_start * scale, dist.t_end * scale, color=HOT if dist.P > 0 else COLD, alpha=0.12, lw=0)


def summary(sim, path: Optional[str] = None, disturbances: Iterable = ()):
    """T, T*, e, E(t), and the time histories of a finished EHCCSimulation."""
    style()
    D, logs = sim.domain, sim.logs()
    disturbances = list(disturbances)
    traj = np.asarray(sim.trajectory)
    t = logs["t"] / 60.0
    vmax = float(np.max(D.T_star))
    fig = plt.figure(figsize=(12, 6.6))
    gs = fig.add_gridspec(3, 4, height_ratios=[1.25, 1, 1], hspace=0.55, wspace=0.5)

    im = show_field(fig.add_subplot(gs[0, 0]), D.T, D.roi, "hot", D.T_amb, vmax, r"$T(\mathbf{x},t_{\mathrm{end}})$", traj)
    fig.colorbar(im, ax=im.axes, fraction=0.046, pad=0.03)
    im = show_field(fig.add_subplot(gs[0, 1]), D.T_star, D.roi, "hot", D.T_amb, vmax, r"$T^\star(\mathbf{x})$")
    fig.colorbar(im, ax=im.axes, fraction=0.046, pad=0.03)
    e = np.where(D.roi, D.error(), 0.0)
    lim = max(1.0, float(np.percentile(np.abs(e[D.roi]), 99)))
    im = show_field(fig.add_subplot(gs[0, 2]), e, D.roi, "RdBu_r", -lim, lim, r"$e=T^\star-T$")
    fig.colorbar(im, ax=im.axes, fraction=0.046, pad=0.03)
    ax_E = fig.add_subplot(gs[0, 3])
    ax_E.semilogy(t, np.maximum(logs["E"], 1e-8), color="k", lw=0.8)
    ax_E.set_title(r"$\mathcal{E}(t)$")

    ax_e = fig.add_subplot(gs[1, :])
    ax_e.fill_between(t, logs["e_mean"] - logs["e_std"], logs["e_mean"] + logs["e_std"],
                      color=E_BLUE, alpha=0.15, lw=0, label=r"$\bar e\pm\sigma_e$")
    ax_e.plot(t, logs["e_mean"], color=E_BLUE, lw=1.1, label=r"$\bar e(t)$")
    ax_e.axhline(0.0, color="0.4", lw=0.6, ls=":")
    ax_e.set_ylabel(r"$e(\mathbf{x},t)$ [$^\circ$C]", color=E_BLUE)

    ax_p = fig.add_subplot(gs[2, :2])
    ax_p.plot(t, logs["px"], color=P_X, lw=0.8, label=r"$p_x$")
    ax_p.plot(t, logs["py"], color=P_Y, lw=0.8, label=r"$p_y$")
    ax_p.set_ylabel(r"$\mathbf{p}(t)$")

    ax_d = fig.add_subplot(gs[2, 2:])
    ax_d.plot(t, logs["d"], color=D_GREEN, lw=0.6, label=r"$d$")
    ax_d.plot(t, logs["d_lb"], color=D_GREEN, lw=1.2, ls="--", label=r"$d_{\mathrm{lb}}$")
    ax_d.set_ylabel(r"$d(t)$ [m]", color=D_GREEN)

    for ax in (ax_E, ax_e, ax_p, ax_d):
        ax.grid(alpha=0.3)
        ax.set_xlabel("t [min]")
        shade(ax, disturbances, 1.0 / 60.0)
        if ax is not ax_E:
            ax.legend(loc="upper right", ncol=2, frameon=True, framealpha=0.85, fontsize=8)
    if path:
        fig.savefig(path, dpi=180, bbox_inches="tight")
    return fig
