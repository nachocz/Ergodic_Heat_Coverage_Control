"""Fig. 4: the idealized 1D loop of Sec. V with the continuous gate law (24) and its
explicit-Euler version (41), each at k_I = 0.1 and k_I = 20, over five 20 s regimes
(start-up, hot disturbance, recovery, cold disturbance, recovery).

    python figures/fig4_ki_comparison.py      writes outputs/figures/fig4_ki_comparison.pdf and .png (about 10 s)
"""
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ehcc import Loop1D  # noqa: E402
from ehcc.plotting import STABILITY, style  # noqa: E402

REGIMES = [(0, 20, 0.0), (20, 40, 18.0), (40, 60, 0.0), (60, 80, -18.0), (80, 100, 0.0)]
CASES = {"d_low": ("Discrete", 0.1), "d_high": ("Discrete", 20.0), "c_low": ("Continuous", 0.1), "c_high": ("Continuous", 20.0)}


def main() -> None:
    loop = Loop1D()
    runs = {}
    for key, (kind, k_I) in CASES.items():
        print(f"{kind:10s} k_I = {k_I:g}")
        runs[key] = loop.run_discrete(k_I) if kind == "Discrete" else loop.run_continuous(k_I)
    g_star = [loop.equilibrium_gate(loop.regime_disturbance(A)) for *_, A in REGIMES]
    print("g*_r =", ", ".join(f"{g:.2f}" for g in g_star))

    style()
    fig = plt.figure(figsize=(13.5, 4.6))
    gs = fig.add_gridspec(2, 4, height_ratios=[1.15, 1.0], hspace=0.38, wspace=0.3)
    x = loop.x
    for col, (key, (kind, k_I)) in enumerate(CASES.items()):
        ax = fig.add_subplot(gs[0, col])
        run = runs[key]
        snaps = [np.argmin(np.abs(run["t"] - t)) for t0, *_ in REGIMES for t in t0 + np.geomspace(0.05, 19.5, 10)]
        for i, a in zip(snaps, np.linspace(0.18, 0.85, len(snaps))):
            ax.plot(x, run["T"][i], color=STABILITY[key], alpha=a, lw=0.9)
        for pulse, color in zip(loop.pulses, ("firebrick", "steelblue")):
            bump = np.sign(pulse.A) * 8.0 * np.exp(-(((x - pulse.x0) / pulse.sigma_x) ** 2))
            ax.fill_between(x, 0, bump, color=color, alpha=0.22, lw=0)
        ax.plot(x, loop.T_star, "k--", lw=1.0, label=r"$T^\star(x)$")
        ax.axvspan(*loop.roi, color="orange", alpha=0.12, label=r"$\Omega_{\mathrm{ROI}}$")
        ax.axhline(loop.T_source, color="firebrick", lw=0.8, ls="-.", label=r"$T_{\mathrm{src}}$")
        ax.axhline(loop.T_amb, color="0.4", lw=0.8, ls=":", label=r"$T_{\mathrm{amb}}$")
        ax.set(xlim=(0, 1), ylim=(-15, 105), xlabel=r"$x$", title=f"{kind}, $k_I={k_I:g}$")
        ax.grid(alpha=0.3)
        if col == 0:
            ax.set_ylabel(r"$T(x,t)$ [$^\circ$C]")
        if col == 3:
            ax.legend(loc="center right", fontsize=7.5)

    axes = [fig.add_subplot(gs[1, i]) for i in range(4)]
    ylabels = [r"$g(t)$", r"$Q_{\mathrm{in}}(t)$", r"$\bar e(t)$", r"$V(g(t))$"]
    for key, run in runs.items():
        kind, k_I = CASES[key]
        t = run["t"]
        g_ref = np.select([t < b for _, b, _ in REGIMES], g_star, g_star[-1])
        V = np.maximum(0.5 * (run["gate"] - g_ref) ** 2, 1e-5)    # quadratic form of (30), as in Fig. 4
        style_kw = dict(color=STABILITY[key], ls="-" if kind == "Discrete" else "--",
                        lw=1.1 if key == "d_high" else 1.5, alpha=0.45 if key == "d_high" else 1.0)
        for ax, y in zip(axes, (run["gate"], run["Q_in"], run["e_mean"], V)):
            ax.plot(t, y, label=f"{kind[:5]}., $k_I={k_I:g}$", **style_kw)
    for (a, b, _), g in zip(REGIMES, g_star):
        axes[0].hlines(g, a, b, colors="k", linestyles=(0, (4, 2)), lw=1.0)
    for ax, label in zip(axes, ylabels):
        for a, b, A in REGIMES:
            if A:
                ax.axvspan(a, b, color="firebrick" if A > 0 else "steelblue", alpha=0.08, lw=0)
        ax.set(xlim=(0, 100), xlabel=r"$t$ [s]", ylabel=label)
        ax.grid(alpha=0.3)
    axes[0].set_ylim(-0.05, 1.1)
    axes[2].set_ylim(-2.0, 4.5)
    axes[3].set_yscale("log")
    axes[3].set_ylim(1e-5, 1.0)
    axes[2].legend(loc="upper right", ncol=2, fontsize=7)

    out = os.path.join("outputs", "figures")
    os.makedirs(out, exist_ok=True)
    for ext in ("png", "pdf"):
        fig.savefig(os.path.join(out, f"fig4_ki_comparison.{ext}"), dpi=200, bbox_inches="tight")
    print(f"written: {out}/fig4_ki_comparison.pdf and .png")


if __name__ == "__main__":
    main()
