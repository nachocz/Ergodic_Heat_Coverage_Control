"""Idealized one-dimensional loop of the stability analysis (Sec. V, Fig. 4).

Distributed heating q_in = g k_p e_+ (27) on Omega = [0, 1], Omega_ROI = [0.2, 0.6]:

    dT/dt = alpha T'' - h (T - T_amb) + g k_p e_+ + D_ext(x, t),     Neumann boundaries,
    dg/dt = k_I e_bar,  g in [0, 1]                                    (24),

with the explicit-Euler version g_{k+1} = Pi_[0,1](g_k + k_I dt e_bar_k) (41). The
steady-state mean error e_ss(g) (28) of Lemma 1 is computed directly from the
elliptic problem at constant g, which gives the equilibrium gate g* and the
discrete bound k_I < 2 / (dt |e_ss'(g*)|) (42).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

import numpy as np
from scipy.integrate import solve_ivp
from scipy.linalg import solve_banded


@dataclass
class Pulse:
    """Persistent disturbance: Gaussian in x, flat top in t with smooth edges."""
    t0: float
    A: float                     # amplitude [degC/s]; > 0 hot, < 0 cold
    x0: float = 0.4
    sigma_x: float = 0.1
    half_width: float = 10.0
    sigma_edge: float = 0.5

    def envelope(self, t: float) -> float:
        edge = max(0.0, abs(t - self.t0) - self.half_width)
        return float(np.exp(-((edge / self.sigma_edge) ** 2)))


@dataclass
class Loop1D:
    N: int = 201
    roi: tuple = (0.2, 0.6)
    T_amb: float = 20.0
    T_source: float = 100.0
    alpha: float = 1e-3
    h: float = 0.5
    k_p: float = 20.0
    t_end: float = 100.0
    steps: Sequence[tuple] = ((0.2, 0.3, 80.0), (0.3, 0.6, 30.0))   # (x_from, x_to, T*)
    pulses: List[Pulse] = field(default_factory=lambda: [Pulse(30.0, 18.0), Pulse(70.0, -18.0)])

    def __post_init__(self):
        self.x = np.linspace(0.0, 1.0, self.N)
        self.dx = self.x[1] - self.x[0]
        self.mask = (self.x >= self.roi[0]) & (self.x <= self.roi[1])
        self.T_star = np.full(self.N, np.nan)
        for lo, hi, value in self.steps:
            sel = (self.x >= lo) & ((self.x < hi) if hi < self.roi[1] else (self.x <= hi))
            self.T_star[sel] = value

    # ------------------------------------------------------------------ model
    def laplacian(self, T: np.ndarray) -> np.ndarray:
        lap = np.empty_like(T)
        lap[1:-1] = T[2:] - 2.0 * T[1:-1] + T[:-2]
        lap[0] = 2.0 * (T[1] - T[0])
        lap[-1] = 2.0 * (T[-2] - T[-1])
        return lap / self.dx**2

    def disturbance(self, t: float) -> np.ndarray:
        D = np.zeros(self.N)
        for pulse in self.pulses:
            D += pulse.A * pulse.envelope(t) * np.exp(-(((self.x - pulse.x0) / pulse.sigma_x) ** 2))
        return D

    def e_plus(self, T: np.ndarray) -> np.ndarray:
        out = np.zeros(self.N)
        out[self.mask] = np.maximum(self.T_star[self.mask] - T[self.mask], 0.0)
        return out

    def mean_error(self, T: np.ndarray) -> float:
        return float(np.mean(self.T_star[self.mask] - T[self.mask]))

    def q_in_total(self, T: np.ndarray, g: float) -> float:
        """Q_in = integral of q_in over Omega_ROI (trapezoidal rule)."""
        q = g * self.k_p * self.e_plus(T)[self.mask]
        return float(np.sum(0.5 * (q[1:] + q[:-1])) * self.dx)

    # ------------------------------------------------------------------ steady state
    def equilibrium(self, g: float, D: Optional[np.ndarray] = None, iterations: int = 50) -> np.ndarray:
        """T_g: solution of 0 = alpha T'' - h (T - T_amb) + g k_p e_+(T) + D (semi-smooth Newton)."""
        D = np.zeros(self.N) if D is None else D
        T = np.full(self.N, self.T_amb)
        c = self.alpha / self.dx**2
        for _ in range(iterations):
            active = self.mask & (self.T_star > T)
            F = self.alpha * self.laplacian(T) - self.h * (T - self.T_amb) + g * self.k_p * self.e_plus(T) + D
            diag = -2.0 * c - self.h - g * self.k_p * active
            upper, lower = np.full(self.N - 1, c), np.full(self.N - 1, c)
            upper[0] = lower[-1] = 2.0 * c        # Neumann rows
            ab = np.zeros((3, self.N))
            ab[0, 1:], ab[1], ab[2, :-1] = upper, diag, lower
            step = solve_banded((1, 1), ab, F)
            T = T - step
            if np.max(np.abs(step)) < 1e-10:
                break
        return T

    def e_ss(self, g: float, D: Optional[np.ndarray] = None) -> float:
        """Steady-state mean error (28)."""
        return self.mean_error(self.equilibrium(g, D))

    def regime_disturbance(self, A: float) -> np.ndarray:
        """A persistent disturbance at full amplitude (the plateau of a pulse)."""
        pulse = self.pulses[0]
        return A * np.exp(-(((self.x - pulse.x0) / pulse.sigma_x) ** 2))

    def equilibrium_gate(self, D: Optional[np.ndarray] = None, tol: float = 1e-10) -> float:
        """g* with e_ss(g*) = 0 (Assumption 1), by bisection on the decreasing map; clipped to [0, 1]."""
        lo, hi = 0.0, 1.0
        if self.e_ss(lo, D) <= 0.0:
            return 0.0
        if self.e_ss(hi, D) >= 0.0:
            return 1.0
        while hi - lo > tol:
            mid = 0.5 * (lo + hi)
            if self.e_ss(mid, D) > 0.0:
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)

    def slope(self, g: float, D: Optional[np.ndarray] = None, delta: float = 1e-4) -> float:
        """e_ss'(g), central difference."""
        return (self.e_ss(min(g + delta, 1.0), D) - self.e_ss(max(g - delta, 0.0), D)) / (
            min(g + delta, 1.0) - max(g - delta, 0.0))

    def lyapunov(self, gs: np.ndarray, g_star: float, D: Optional[np.ndarray] = None) -> np.ndarray:
        """V(g) = -int_{g*}^{g} e_ss(s) ds (30), by the trapezoidal rule on a grid of g."""
        grid = np.linspace(0.0, 1.0, 401)
        values = np.array([self.e_ss(g, D) for g in grid])
        cumulative = np.concatenate([[0.0], np.cumsum(0.5 * (values[1:] + values[:-1]) * np.diff(grid))])
        return -(np.interp(gs, grid, cumulative) - np.interp(g_star, grid, cumulative))

    # ------------------------------------------------------------------ transient runs
    def run_discrete(self, k_I: float, dt: Optional[float] = None, g0: float = 1.0) -> Dict[str, np.ndarray]:
        """Explicit Euler for T and g (41), with the gate saturated to [0, 1]."""
        dt = min(0.01, 0.8 * 0.5 * self.dx**2 / self.alpha) if dt is None else dt
        n = int(round(self.t_end / dt))
        T, g = np.full(self.N, self.T_amb), g0
        out = {key: np.empty(n) for key in ("t", "gate", "e_mean", "Q_in")}
        out["T"] = np.empty((n, self.N))
        for i in range(n):
            e_bar = self.mean_error(T)
            q = g * self.k_p * self.e_plus(T)
            q = np.minimum(q, np.maximum((self.T_source - T) / dt, 0.0))   # no single-step overshoot of T_source
            T = T + dt * (self.alpha * self.laplacian(T) - self.h * (T - self.T_amb) + q + self.disturbance(i * dt))
            g = float(np.clip(g + k_I * e_bar * dt, 0.0, 1.0))
            out["t"][i], out["gate"][i], out["e_mean"][i] = (i + 1) * dt, g, e_bar
            out["Q_in"][i] = float(np.sum(0.5 * (q[self.mask][1:] + q[self.mask][:-1])) * self.dx)
            out["T"][i] = T
        out["dt"] = dt
        return out

    def run_continuous(self, k_I: float, n_out: int = 3600, g0: float = 1.0) -> Dict[str, np.ndarray]:
        """The continuous-time loop (24), integrated with LSODA; the gate stops at the limits."""
        def rhs(t, y):
            T, g = y[:-1], y[-1]
            gc = min(max(g, 0.0), 1.0)
            e_bar = self.mean_error(T)
            dT = self.alpha * self.laplacian(T) - self.h * (T - self.T_amb) + gc * self.k_p * self.e_plus(T) + self.disturbance(t)
            dg = k_I * e_bar
            if (g <= 0.0 and dg < 0.0) or (g >= 1.0 and dg > 0.0):
                dg = 0.0
            return np.append(dT, dg)

        t_eval = np.linspace(0.0, self.t_end, n_out)
        y0 = np.append(np.full(self.N, self.T_amb), g0)
        sol = solve_ivp(rhs, (0.0, self.t_end), y0, method="LSODA", t_eval=t_eval, rtol=1e-6, atol=1e-8)
        if not sol.success:
            raise RuntimeError(sol.message)
        T_hist = sol.y[:-1].T
        gate = np.clip(sol.y[-1], 0.0, 1.0)
        return {"t": sol.t, "gate": gate, "T": T_hist,
                "e_mean": np.array([self.mean_error(T) for T in T_hist]),
                "Q_in": np.array([self.q_in_total(T, g) for T, g in zip(T_hist, gate)])}
