"""Fig. 4: single-column principle figure of EHCC (Sec. III).

Top:    heating density Phi ~ e_+ on Omega_ROI, ergodic trajectory p(t) from the
        tangential control law (Sec. III), and time-averaged heat footprint
        along p(t) (~ Phi).
Bottom: closed-loop EHCC simulation of the distributed model on the same 2D
        domain: heat equation with the moving Gaussian source (Sec. II), ergodic
        law with Phi recomputed from the measured error (Sec. III), and standoff
        mapping with the integral lower bound d_lb (Sec. IV-A). Left:
        temperature T(x,t) along the section marked in the top-left panel.
        Right: standoff d(t) and d_lb(t), with a cold disturbance (increased
        convective loss, blue shading).

All data are computed here (about one minute); run:  python figures/fig4_principle.py
Output: outputs/figures/fig4_principle.pdf (and .png)
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from scipy.ndimage import gaussian_filter

OUT_DIR = os.path.join("outputs", "figures")
os.makedirs(OUT_DIR, exist_ok=True)
OUT = os.path.join(OUT_DIR, "fig4_principle.pdf")

# ---------------------------------------------------------------- style
INK, MUTED, GRID = "#1f1f1f", "#5f5f5f", "#d9d9d9"
RED, BLUE, TEAL = "#c62828", "#1f5fa8", "#1fbf8f"
GREEN = "#1b6e20"                              # d(t), d_lb(t) as in Figs. 11-17
SLICE, SLICE_FILL = "#e08a2e", "#f6d7b0"      # slice line and its ROI band
COLD_FILL = "#cfe0f3"
plt.rcParams.update({
    "font.family": "sans-serif", "font.sans-serif": ["cmss10"],
    "mathtext.fontset": "cm", "axes.unicode_minus": False,
    "font.size": 6.5, "axes.titlesize": 7.0, "axes.labelsize": 6.5,
    "xtick.labelsize": 5.8, "ytick.labelsize": 5.8,
    "axes.edgecolor": MUTED, "axes.linewidth": 0.5,
    "xtick.color": MUTED, "ytick.color": MUTED,
    "xtick.major.width": 0.5, "ytick.major.width": 0.5,
    "xtick.major.size": 2, "ytick.major.size": 2,
    "legend.fontsize": 5.8, "pdf.fonttype": 42,
})
need_cmap = LinearSegmentedColormap.from_list(
    "need", ["#ffffff", "#f8c9b8", "#e8705a", "#b71c1c", "#5c0a0a"])

# ---------------------------------------------------------------- 2D target
N = 120
xs = np.linspace(0, 1, N)
dx = xs[1] - xs[0]
X, Y = np.meshgrid(xs, xs)
Y0 = 0.52                                     # section shown in the bottom row
X_ROI = (0.10, 0.90)
lobe = ((X - 0.33) / 0.17) ** 2 + ((Y - 0.55) / 0.24) ** 2 <= 1.0
bar = (X >= 0.58) & (X <= 0.82) & (Y >= 0.30) & (Y <= 0.72)
e_plus = np.where(lobe, 6.0, 0.0) + np.where(bar & ~lobe, 3.0, 0.0)
e_plus = gaussian_filter(e_plus, 0.8)
roi = gaussian_filter(((X > X_ROI[0]) & (X < X_ROI[1]) & (Y > 0.20) & (Y < 0.84)).astype(float), 3) > 0.5
Phi = e_plus / (e_plus.sum() / N**2)          # unit-mass density on [0,1]^2

# ---------------------------------------------------------------- ergodic law (16)
K = 12
k1, k2 = np.meshgrid(np.arange(K), np.arange(K), indexing="ij")
k1, k2 = k1.ravel(), k2.ravel()
hk = np.sqrt(np.where(k1 > 0, 0.5, 1.0) * np.where(k2 > 0, 0.5, 1.0))
Lam = (1.0 + k1**2 + k2**2) ** (-1.5)
basis = np.cos(np.pi * k1[:, None, None] * X) * np.cos(np.pi * k2[:, None, None] * Y) / hk[:, None, None]
phi_k = (basis * Phi).sum(axis=(1, 2)) / N**2

def psi_and_grad(p):
    cx, cy = np.cos(np.pi * k1 * p[0]), np.cos(np.pi * k2 * p[1])
    sx, sy = np.sin(np.pi * k1 * p[0]), np.sin(np.pi * k2 * p[1])
    psi = cx * cy / hk
    grad = np.stack([-np.pi * k1 * sx * cy, -np.pi * k2 * cx * sy], axis=1) / hk[:, None]
    return psi, grad

dt, umax, steps = 0.004, 0.7, 40000
p = np.array([0.22, 0.30])
S = np.zeros_like(phi_k)
traj = np.zeros((steps, 2))
for i in range(steps):
    psi, grad = psi_and_grad(p)
    S += psi * dt
    c_k = S / ((i + 1) * dt)
    B = (Lam * (c_k - phi_k)) @ grad
    nb = np.linalg.norm(B)
    u = -umax * B / nb if nb > 1e-12 else np.zeros(2)
    p = np.clip(p + u * dt, 0.01, 0.99)
    traj[i] = p

# time-averaged footprint (1/t) int K(x; p(tau)) dtau, Gaussian kernel
SIG = 0.045
H, _, _ = np.histogram2d(traj[:, 1], traj[:, 0], bins=N, range=[[0, 1], [0, 1]])
visit = gaussian_filter(H, SIG * N)
visit = visit / (visit.sum() / N**2)

# ---------------------------------------------------------------- closed-loop EHCC run
# Distributed model on [0,1]^2 (lambda absorbed into q_in and h):
#   dT/dt = alpha lap(T) + P eta(d) K(x; p, sigma(d)) - h(x,t) (T - T_amb),
# Neumann boundaries, eta and sigma linear in d with eta(d_max) = 0.
Tamb = 25.0
Tstar = Tamb + e_plus
e_max = e_plus[roi].max()
alpha, P_eta, h0 = 2e-6, 0.05, 1.0 / 300.0    # diffusivity, P*eta(d_min), loss rate
d_min, d_max = 0.05, 0.40                     # standoff interval [m]
s_min, s_max = 0.04, 0.07                     # kernel width sigma(d_min), sigma(d_max)
kI, u_cl = 1.5e-3, 0.25                       # integral gain, speed limit
dt_cl, t_end = 0.05, 1800.0
dist = (900.0, 1200.0)                        # cold disturbance: 8x convection
cold = ((X - 0.33) ** 2 + (Y - 0.55) ** 2) <= 0.25 ** 2
t_snap = [10.0, 25.0, 60.0, 880.0, t_end - dt_cl]
Lam_cl = (1.0 + k1**2 + k2**2) ** (-1.05)
basis_cl = (np.cos(np.pi * k1[:, None, None] * X) * np.cos(np.pi * k2[:, None, None] * Y)).reshape(len(k1), -1)
iy0 = np.argmin(abs(xs - Y0))

def lap2(T):
    Tp = np.pad(T, 1, mode="edge")              # Neumann boundaries
    return (Tp[2:, 1:-1] + Tp[:-2, 1:-1] + Tp[1:-1, 2:] + Tp[1:-1, :-2] - 4 * T) / dx**2

T = np.full((N, N), Tamb)
p = np.array([0.22, 0.30])
S = np.zeros(len(k1))
d_lb = d_min                                  # d_lb(0) = d_min, Sec. IV-A
n_cl = int(round(t_end / dt_cl))
log = np.zeros((n_cl, 4))
snaps = []
for i in range(n_cl):
    t = i * dt_cl
    e = Tstar - T
    ep = np.where(roi, np.maximum(e, 0.0), 0.0)
    phi_cl = basis_cl @ (ep / (ep.sum() * dx**2 + 1e-9)).ravel() * dx**2
    cx, cy = np.cos(np.pi * k1 * p[0]), np.cos(np.pi * k2 * p[1])
    sx, sy = np.sin(np.pi * k1 * p[0]), np.sin(np.pi * k2 * p[1])
    S += cx * cy * dt_cl
    w = Lam_cl * (S / ((i + 1) * dt_cl) - phi_cl)
    B = np.array([np.sum(w * -np.pi * k1 * sx * cy), np.sum(w * -np.pi * k2 * cx * sy)])
    nb = np.linalg.norm(B)
    u = -u_cl * B / nb if nb > 1e-12 else np.zeros(2)
    # standoff law: d = d_max - (d_max - d_lb) e_p / e_max, d_lb' = -k_I e_bar
    e_p = ep[int(round(p[1] * (N - 1))), int(round(p[0] * (N - 1)))]
    e_bar = e[roi].mean()
    d_lb = float(np.clip(d_lb - kI * e_bar * dt_cl, d_min, d_max))
    d = d_max - (d_max - d_lb) * min(e_p, e_max) / e_max
    r = (d - d_min) / (d_max - d_min)
    sig = s_min + (s_max - s_min) * r
    Kp = np.exp(-((X - p[0]) ** 2 + (Y - p[1]) ** 2) / (2 * sig**2))
    q_in = P_eta * (1.0 - r) * Kp / (Kp.sum() * dx**2)
    h = h0 * np.where(cold & (dist[0] <= t < dist[1]), 8.0, 1.0)
    T = T + dt_cl * (alpha * lap2(T) + q_in - h * (T - Tamb))
    p = np.clip(p + u * dt_cl, 0.01, 0.99)
    log[i] = (t, d, d_lb, e_bar)
    if len(snaps) < len(t_snap) and t >= t_snap[len(snaps)]:
        snaps.append(T[iy0].copy())
tl, dl, dlbl, ebl = log.T
print("d_lb: before dist %.3f  min during dist %.3f  end %.3f;  e_bar before dist %+.2f  end %+.2f"
      % (dlbl[tl < dist[0]][-1], dlbl[(tl >= dist[0]) & (tl < dist[1] + 100)].min(), dlbl[-1],
         ebl[tl < dist[0]][-1], ebl[-1]))

# ---------------------------------------------------------------- figure
fig = plt.figure(figsize=(3.45, 2.25))
gs = fig.add_gridspec(2, 3, height_ratios=[1.0, 0.95], hspace=0.30, wspace=0.30,
                      left=0.085, right=0.985, top=0.93, bottom=0.12)
axa, axb, axc = (fig.add_subplot(gs[0, i]) for i in range(3))
gsb = gs[1, :].subgridspec(1, 2, width_ratios=[1.9, 1.0], wspace=0.34)
axd, axe = fig.add_subplot(gsb[0]), fig.add_subplot(gsb[1])

def roi_outline(ax):
    ax.contour(xs, xs, roi.astype(float), levels=[0.5], colors=TEAL,
               linewidths=0.9, linestyles=[(0, (1.2, 1.2))])

vmax = np.percentile(Phi, 99.5)
axa.imshow(Phi, origin="lower", extent=(0, 1, 0, 1), cmap=need_cmap, vmin=0, vmax=vmax)
roi_outline(axa)
axa.plot(X_ROI, [Y0, Y0], color=SLICE, lw=1.4, solid_capstyle="butt")
# section line (chain line, thick ends) and viewing-direction arrows
XS = (0.03, 0.97)
axa.plot(XS, [Y0, Y0], color=INK, lw=0.5, ls=(0, (7, 1.6, 1.2, 1.6)))
for xa, xb in ((XS[0], XS[0] + 0.06), (XS[1] - 0.06, XS[1])):
    axa.plot([xa, xb], [Y0, Y0], color=INK, lw=1.3, solid_capstyle="butt")
    xm = 0.5 * (xa + xb)
    axa.annotate("", xy=(xm, Y0 - 0.01), xytext=(xm, Y0 - 0.19),
                 arrowprops=dict(arrowstyle="-|>", color=INK, lw=0.6,
                                 mutation_scale=5, shrinkA=0, shrinkB=0))
axa.text(0.88, 0.86, r"$\Omega_{\mathrm{ROI}}$", ha="right", va="bottom", fontsize=6, color=TEAL)
axa.set_title(r"$\Phi\propto e_+$", pad=3)

axb.imshow(Phi, origin="lower", extent=(0, 1, 0, 1), cmap=need_cmap, vmin=0, vmax=vmax, alpha=0.18)
n_show = 4000
seg_t = np.linspace(0.25, 1.0, n_show)
for j in range(0, n_show - 1, 6):
    axb.plot(traj[j:j + 7, 0], traj[j:j + 7, 1], color=str(0.75 - 0.6 * seg_t[j]), lw=0.45,
             solid_capstyle="round")
axb.plot(*traj[0], "o", ms=2.6, color="#2e9e3e", mec="white", mew=0.4)
axb.set_title(r"$\mathbf{p}(t)$", pad=3)

axc.imshow(visit, origin="lower", extent=(0, 1, 0, 1), cmap=need_cmap, vmin=0, vmax=vmax)
roi_outline(axc)
axc.set_title(r"$\langle\mathcal{K}(\mathbf{x};\mathbf{p}(t))\rangle_t$", pad=3)

for ax in (axa, axb, axc):
    ax.set_xticks([]); ax.set_yticks([])
    for s in ax.spines.values():
        s.set_color(GRID)

# bottom left: temperature along the section (closed-loop run)
axd.axvspan(*X_ROI, color=SLICE_FILL, alpha=0.7, lw=0)
alphas = np.linspace(0.25, 1.0, len(snaps))
for k, (Ts, a) in enumerate(zip(snaps, alphas)):
    axd.plot(xs, Ts, color=RED, lw=0.9, alpha=a,
             label=r"$T(x,t)$" if k == len(snaps) - 1 else None)
axd.plot(xs, Tstar[iy0], color=INK, lw=0.9, ls=(0, (3, 1.6)), label=r"$T^\star(x)$")
axd.set_xlim(0, 1)
axd.set_ylim(Tamb - 0.4, Tamb + 7.6)
axd.set_xlabel(r"$x$", labelpad=0.5)
axd.set_ylabel(r"$T$ [$^\circ$C]", labelpad=1)
axd.set_yticks([25, 28, 31]); axd.set_xticks([0, 0.5, 1])
axd.legend(loc="upper right", frameon=False, handlelength=1.6, borderaxespad=0.1,
           labelspacing=0.2)

# bottom right: standoff and its adaptive lower bound under a cold disturbance
axe.axvspan(*dist, color=COLD_FILL, lw=0)
axe.plot(tl, dl, color=GREEN, lw=0.3, label=r"$d$")
axe.plot(tl, dlbl, color=GREEN, lw=0.9, ls=(0, (3, 1.4)), label=r"$d_{\mathrm{lb}}$")
axe.set_xlim(0, t_end)
axe.set_ylim(d_min - 0.02, d_max + 0.02)
axe.set_xlabel(r"$t$", labelpad=0.5)
axe.set_yticks([d_min, d_max]); axe.set_yticklabels([r"$d_{\min}$", r"$d_{\max}$"])
axe.set_xticks([])
axe.legend(loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=2, frameon=False,
           handlelength=1.6, borderaxespad=0.1, columnspacing=1.0)

for ax in (axd, axe):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)

fig.savefig(OUT)
fig.savefig(OUT.replace(".pdf", ".png"), dpi=300)
print("saved", os.path.normpath(OUT))
