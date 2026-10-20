"""Heat equation (2) and actuation model (3)-(4).

    dT/dt = div(alpha grad T) + lambda (q_in - q_loss),    q_loss = h (T - T_amb),
    q_in(x, t) = P eta(d) K(x; p, d),                      integral of K over Omega = 1,

on the normalized domain with Neumann (zero-flux) boundaries, integrated with
explicit Euler steps in the order heating, losses, diffusion. The controller
never uses this model: it only produces the "measured" field T. The operations
follow the order of the benchmark code of Sec. VI, so that its runs, including
the chaotic ones of the baselines, are reproduced to rounding.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np

from .config import HeaterConfig
from .domain import Domain, grid


def ratio(d: float, d_min: float, d_max: float) -> float:
    """Position of d in [d_min, d_max], in [0, 1]."""
    span = d_max - d_min
    return 0.0 if span < 1e-12 else float(np.clip((d - d_min) / span, 0.0, 1.0))


def efficiency(d: float, heater: HeaterConfig, d_min: float, d_max: float) -> float:
    """eta(d), strictly decreasing in d (linear between eta(d_min) and eta(d_max))."""
    return heater.eta_max + (heater.eta_min - heater.eta_max) * ratio(d, d_min, d_max)


def kernel_width(d: float, heater: HeaterConfig, d_min: float, d_max: float) -> float:
    """sigma(d), increasing with the standoff."""
    return heater.sigma_min + (heater.sigma_max - heater.sigma_min) * ratio(d, d_min, d_max)


def gaussian(X: np.ndarray, Y: np.ndarray, center, sigma: float) -> np.ndarray:
    """exp(-|x - center|^2 / (2 sigma^2)) on the grid nodes X, Y."""
    dist_sq = (X - center[0]) ** 2 + (Y - center[1]) ** 2
    return np.exp(-dist_sq / (2.0 * sigma**2))


def power_density(X: np.ndarray, Y: np.ndarray, center, sigma: float, power: float) -> np.ndarray:
    """power * K(x; center, sigma), with K normalized so that sum(K) dx^2 = 1."""
    g = gaussian(X, Y, center, sigma)
    dx = 1.0 / (X.shape[0] - 1)
    return power * g / (np.sum(g) * dx**2)


def heat_kernel(N: int, p, sigma: float) -> np.ndarray:
    """K(x; p, d) on the N x N grid, sum(K) dx^2 = 1."""
    X, Y = grid(N)
    return power_density(X, Y, p, sigma, 1.0)


@dataclass
class Disturbance:
    """External heat source (P > 0) or sink (P < 0) with a Gaussian footprint (Sec. VI-A)."""
    center: tuple = (0.45, 0.65)
    sigma: float = 0.12
    P: float = 600.0             # [W]
    t_start: float = 0.0         # [s]
    t_end: float = 0.0           # [s]
    T_source: float = 150.0      # emitter temperature of a hot source [degC]

    def active(self, t: float) -> bool:
        return self.t_start <= t <= self.t_end


class HeatEquation:
    """Explicit-Euler integrator of (2) on a Domain."""

    def __init__(self, domain: Domain, heater: HeaterConfig, h: float):
        self.domain = domain
        self.heater = heater
        self.h = h

    def _couple(self, q: np.ndarray) -> np.ndarray:
        """Flux reduced outside Omega_ROI (insulating backing)."""
        D = self.domain
        return np.where(D.roi, q, q * D.outside_roi_coupling)

    def heat(self, q_in: np.ndarray, dt: float) -> None:
        """lambda q_in, with the absorbed fraction (T_source - T) / (T_source - T_amb)."""
        D = self.domain
        T_source = self.heater.T_source
        span = T_source - D.T_amb
        absorbed = np.maximum(T_source - D.T, 0.0) / span if span > 0 else 0.0
        D.T += D.lam * self._couple(q_in * absorbed) * dt

    def lose(self, dt: float) -> None:
        """-lambda q_loss(T), Newton cooling to the ambient."""
        D = self.domain
        D.T -= D.lam * self._couple(self.h * (D.T - D.T_amb)) * dt
        np.maximum(D.T, D.T_amb, out=D.T)

    def diffuse(self, dt: float) -> None:
        """div(alpha grad T): conservative 5-point scheme, face diffusivities by averaging."""
        D = self.domain
        T, a = D.T, D.alpha
        dx2 = D.dx**2
        ax = 0.5 * (a[:, :-1] + a[:, 1:])           # faces between columns
        ay = 0.5 * (a[:-1, :] + a[1:, :])           # faces between rows
        div = np.zeros_like(T)
        div[:, 1:-1] += (ax[:, 1:] * (T[:, 2:] - T[:, 1:-1]) - ax[:, :-1] * (T[:, 1:-1] - T[:, :-2])) / dx2
        div[:, 0] += ax[:, 0] * (T[:, 1] - T[:, 0]) / dx2          # zero flux through the boundary
        div[:, -1] += -ax[:, -1] * (T[:, -1] - T[:, -2]) / dx2
        div[1:-1, :] += (ay[1:, :] * (T[2:, :] - T[1:-1, :]) - ay[:-1, :] * (T[1:-1, :] - T[:-2, :])) / dx2
        div[0, :] += ay[0, :] * (T[1, :] - T[0, :]) / dx2
        div[-1, :] += -ay[-1, :] * (T[-1, :] - T[-2, :]) / dx2
        T += div * dt

    def disturb(self, disturbances: Iterable[Disturbance], t: float, dt: float) -> None:
        """Hot sources heat like the heater; cold sinks extract heat in proportion to T - T_amb."""
        D = self.domain
        for dist in disturbances:
            if not dist.active(t):
                continue
            density = power_density(D.X, D.Y, dist.center, dist.sigma, dist.P)
            if dist.P >= 0.0:
                span = dist.T_source - D.T_amb
                absorbed = np.maximum(dist.T_source - D.T, 0.0) / span if span > 0 else np.zeros_like(D.T)
            else:
                absorbed = np.maximum(D.T - D.T_amb, 0.0) / max(float(np.max(D.T)) - D.T_amb, 1.0)
            D.T += D.lam * self._couple(density * absorbed) * dt

    def step(self, q_in: np.ndarray, dt: float, t: float = 0.0, disturbances: Iterable[Disturbance] = ()) -> None:
        self.heat(q_in, dt)
        self.lose(dt)
        self.diffuse(dt)
        self.disturb(disturbances, t, dt)
