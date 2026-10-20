"""Controllers compared with EHCC in the simulation benchmark (Sec. VI, Table I).

All of them act on the same plant as EHCC and differ only in how p(t) and d(t)
are computed. Greedy-A keeps the standoff law of EHCC; GTM, LQG-M, and MPDC set
the standoff themselves and use the heater model (kernel and efficiency), and
MPDC also the thermal parameters (lambda, h).

- Greedy-A: moves toward the point of largest positive error (Sec. VI-B).
- GTM (Hu et al.): Jacobian ascent of the kernel-error overlap (43), in p and d.
- LQG-M (Jones et al.): open-loop boustrophedon raster; d maximizes eta(d) <K, e>.
- MPDC (Muddassir et al.): same raster; d minimizes a predicted error (44).
The parameters are those of Table IX.
"""
from __future__ import annotations

from typing import Optional, Tuple

import numpy as np

from .config import Config
from .domain import Domain
from .thermal import efficiency, kernel_width


def raster_waypoints(passes: int = 10, margin: float = 0.05):
    """Boustrophedon path over [margin, 1 - margin]^2 with `passes` horizontal strips."""
    points = []
    for i, y in enumerate(np.linspace(margin, 1.0 - margin, passes)):
        row = [np.array([margin, y]), np.array([1.0 - margin, y])]
        points += row if i % 2 == 0 else row[::-1]
    return points


class _Raster:
    """Constant-speed motion through the raster waypoints (open loop in the temperature)."""

    def __init__(self, u_max: float):
        self.u_max = u_max
        self.waypoints = raster_waypoints()
        self.index = 0

    def velocity(self, p: np.ndarray) -> np.ndarray:
        goal = self.waypoints[self.index % len(self.waypoints)]
        diff = goal - p
        dist = np.linalg.norm(diff)
        if dist < 0.02:
            self.index += 1
            goal = self.waypoints[self.index % len(self.waypoints)]
            diff = goal - p
            dist = np.linalg.norm(diff)
        return diff / dist * self.u_max if dist > 1e-8 else np.zeros(2)


class Greedy:
    """Greedy-A: steer toward argmax of e on Omega_ROI, speed proportional to the distance."""
    sets_standoff = False

    def __init__(self, cfg: Config, domain: Domain):
        self.u_max, self.dt = cfg.ergodic.u_max, cfg.dt
        self.xs = np.linspace(0.0, 1.0, domain.N)

    def step(self, domain: Domain, p: np.ndarray, d: float) -> Tuple[np.ndarray, Optional[float]]:
        error = np.where(domain.roi, domain.T_star - domain.T, 0.0)
        iy, ix = np.unravel_index(np.argmax(error), error.shape)
        diff = np.array([self.xs[ix], self.xs[iy]]) - p
        if np.linalg.norm(diff) <= 1e-8:
            return np.zeros(2), None
        u = diff / self.dt
        speed = np.linalg.norm(u)
        return (u / speed * self.u_max if speed > self.u_max else u), None


class _Model:
    """Heater model shared by the model-based baselines."""

    def __init__(self, cfg: Config, domain: Domain):
        self.cfg, self.domain = cfg, domain
        self.d_min, self.d_max = cfg.standoff.d_min, cfg.standoff.d_max
        self.u_max, self.dt = cfg.ergodic.u_max, cfg.dt
        self.dx2 = domain.dx**2

    def sigma(self, d: float) -> float:
        return kernel_width(d, self.cfg.heater, self.d_min, self.d_max)

    def eta(self, d: float) -> float:
        return efficiency(d, self.cfg.heater, self.d_min, self.d_max)

    def dist_sq(self, p) -> np.ndarray:
        return (self.domain.X - p[0]) ** 2 + (self.domain.Y - p[1]) ** 2

    def overlap(self, p, sigma: float, e: np.ndarray) -> float:
        """Integral of exp(-|x - p|^2 / (2 sigma^2)) e(x) dx."""
        return float(np.sum(np.exp(-self.dist_sq(p) / (2.0 * sigma**2)) * e) * self.dx2)


class GTM(_Model):
    """Thermal servo of Hu et al., adapted to domain coverage: the view factor becomes the
    overlap S(p, d) = eta(d) <K(.; p, d), e> (43); p and d follow its finite-difference
    Jacobian with smooth saturation, plus boundary compensation."""
    sets_standoff = True

    def __init__(self, cfg: Config, domain: Domain):
        super().__init__(cfg, domain)
        self.eps = 1.0 / domain.N            # finite-difference step in p
        self.L_scale = 1e-4                  # |L| at which the speed is u_max / 2
        self.eps_d, self.d_speed_max, self.Ld_scale = 0.005, 0.5, 2e-4
        self.wall_margin, self.wall_gain = 0.08, 1.5

    def step(self, domain: Domain, p: np.ndarray, d: float) -> Tuple[np.ndarray, Optional[float]]:
        error_d = domain.T_star - domain.T                     # unmasked, for the standoff
        error = np.where(domain.roi, error_d, 0.0)
        sigma, eps = self.sigma(d), self.eps
        lo_x, hi_x = max(p[0] - eps, 0.0), min(p[0] + eps, 1.0)
        lo_y, hi_y = max(p[1] - eps, 0.0), min(p[1] + eps, 1.0)

        def S(q):
            return self.overlap(np.asarray(q), sigma, error)

        Lx = (S([hi_x, p[1]]) - S([lo_x, p[1]])) / (hi_x - lo_x) if hi_x - lo_x > 1e-12 else 0.0
        Ly = (S([p[0], hi_y]) - S([p[0], lo_y])) / (hi_y - lo_y) if hi_y - lo_y > 1e-12 else 0.0
        L = np.array([Lx, Ly])
        m = self.wall_margin
        for k in range(2):                   # damp the wall-pointing component near the walls
            lo, hi = max(p[k], 0.005), max(1.0 - p[k], 0.005)
            if lo < m and L[k] < 0:
                L[k] *= (lo / m) ** 2
            if hi < m and L[k] > 0:
                L[k] *= (hi / m) ** 2
        g = self.wall_gain * self.u_max
        for k in range(2):                   # soft repulsion from the walls
            lo, hi = max(p[k], 0.005), max(1.0 - p[k], 0.005)
            if lo < m:
                t = (m - lo) / m
                L[k] += g * t * t
            if hi < m:
                t = (m - hi) / m
                L[k] -= g * t * t
        norm = np.linalg.norm(L)
        u = self.u_max * norm / (norm + self.L_scale) * (L / norm) if norm > 1e-12 else np.zeros(2)
        speed = np.linalg.norm(u)
        if speed > self.u_max:
            u = u / speed * self.u_max

        def S_eff(dd):
            return self.eta(dd) * self.overlap(p, self.sigma(dd), error_d)

        d_hi, d_lo = min(d + self.eps_d, self.d_max), max(d - self.eps_d, self.d_min)
        L_d = (S_eff(d_hi) - S_eff(d_lo)) / (d_hi - d_lo) if d_hi - d_lo > 1e-12 else 0.0
        if S_eff(d) < -1e-6 and L_d < 0:     # over-heating: leave the valley of S_eff near d_min
            L_d = abs(L_d)
        a = abs(L_d)
        d_vel = self.d_speed_max * a / (a + self.Ld_scale) * np.sign(L_d) if a > 1e-12 else 0.0
        return u, float(np.clip(d + d_vel * self.dt, self.d_min, self.d_max))


class LQGM(_Model):
    """Fixed raster path (Jones et al.); the standoff, analog of the wire feed rate, maximizes
    eta(d) <K(.; p, d), e> over 8 candidates, smoothed by an exponential moving average."""
    sets_standoff = True

    def __init__(self, cfg: Config, domain: Domain):
        super().__init__(cfg, domain)
        self.raster = _Raster(self.u_max)
        self.candidates = np.linspace(self.d_min, self.d_max, 8)
        self.sigmas = np.array([self.sigma(c) for c in self.candidates])
        self.etas = np.array([self.eta(c) for c in self.candidates])
        self.alpha = 0.3

    def step(self, domain: Domain, p: np.ndarray, d: float) -> Tuple[np.ndarray, Optional[float]]:
        u = self.raster.velocity(p)
        e = np.where(domain.roi, domain.T_star - domain.T, 0.0).ravel()
        kernels = np.exp(-self.dist_sq(p).ravel()[None, :] / (2.0 * self.sigmas[:, None] ** 2))
        best = self.candidates[np.argmax(self.etas * (kernels.dot(e) * self.dx2))]
        return u, float(np.clip(self.alpha * best + (1.0 - self.alpha) * d, self.d_min, self.d_max))


class MPDC(_Model):
    """Fixed raster path (Muddassir et al.); for each of 16 standoff candidates, the local
    temperature is predicted over H = 5 steps with the heating and loss model (44), and the
    standoff minimizes the kernel-weighted squared error (over-shoot weighted 10 times)."""
    sets_standoff = True

    def __init__(self, cfg: Config, domain: Domain):
        super().__init__(cfg, domain)
        self.raster = _Raster(self.u_max)
        self.candidates = np.linspace(self.d_min, self.d_max, 16)
        self.sigmas = np.array([self.sigma(c) for c in self.candidates])
        self.etas = np.array([self.eta(c) for c in self.candidates])
        self.horizon, self.overshoot, self.alpha = 5, 10.0, 0.5
        # nominal model: uniform lambda and h of the configuration, ambient of the domain
        self.lam, self.h = cfg.thermal.lam, cfg.thermal.h
        self.T_amb, self.T_source, self.P = domain.T_amb, cfg.heater.T_source, cfg.heater.P

    def step(self, domain: Domain, p: np.ndarray, d: float) -> Tuple[np.ndarray, Optional[float]]:
        u = self.raster.velocity(p)
        r2 = self.dist_sq(p)
        cool = self.h * self.lam * self.dt
        span = self.T_source - self.T_amb
        best_d, best_cost = self.d_max, np.inf
        for dc, eta, sigma in zip(self.candidates, self.etas, self.sigmas):
            kernel = np.exp(-r2 / (2.0 * sigma**2))
            total = np.sum(kernel) * self.dx2
            density = self.P * eta * kernel / total if total > 1e-12 else np.zeros_like(kernel)
            T = domain.T.copy()
            for _ in range(self.horizon):
                absorbed = np.maximum(self.T_source - T, 0.0) / span if span > 0 else np.ones_like(T)
                T = T + self.lam * density * absorbed * self.dt - cool * np.maximum(T - self.T_amb, 0.0)
            weight = np.where(T > domain.T_star, self.overshoot, 1.0)
            ksum = np.sum(kernel)
            cost = float(np.sum(kernel * weight * (domain.T_star - T) ** 2) / ksum) if ksum > 1e-12 else np.inf
            if cost < best_cost:
                best_cost, best_d = cost, dc
        return u, float(np.clip(self.alpha * best_d + (1.0 - self.alpha) * d, self.d_min, self.d_max))


BASELINES = {"greedy": Greedy, "gtm": GTM, "lqg_m": LQGM, "mpdc": MPDC}
