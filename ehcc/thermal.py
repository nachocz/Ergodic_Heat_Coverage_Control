"""Heat equation (2) and actuation model (3)-(4).

    dT/dt = div(alpha grad T) + lambda (q_in - q_loss),    q_loss = h (T - T_amb),
    q_in(x, t) = P eta(d) K(x; p, d),                      integral of K over Omega = 1,

on the normalized domain with Neumann (zero-flux) boundaries, integrated with
explicit Euler steps in the order heating, losses, diffusion. The controller
never uses this model: it only produces the "measured" field T.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np

from .config import HeaterConfig
from .domain import Domain


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


def gaussian(N: int, center, sigma: float) -> np.ndarray:
    """exp(-|x - center|^2 / (2 sigma^2)) on the grid, as an outer product of two 1D profiles."""
    xs = np.linspace(0.0, 1.0, N)
    gx = np.exp(-((xs - center[0]) ** 2) / (2.0 * sigma**2))
    gy = np.exp(-((xs - center[1]) ** 2) / (2.0 * sigma**2))
    return np.outer(gy, gx)


def heat_kernel(N: int, p, sigma: float) -> np.ndarray:
    """K(x; p, d): Gaussian centred at p, normalized so that sum(K) dx^2 = 1."""
    g = gaussian(N, p, sigma)
    return g / (g.sum() / (N - 1) ** 2)


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

    def absorption(self, T_source: float) -> np.ndarray:
        """Fraction of the incident flux absorbed: 1 at T_amb, 0 at T_source."""
        T, T_amb = self.domain.T, self.domain.T_amb
        return np.maximum(T_source - T, 0.0) / max(T_source - T_amb, 1e-9)

    def heat(self, q_in: np.ndarray, dt: float) -> None:
        """lambda q_in, with q_in in [W per unit normalized area]."""
        D = self.domain
        D.T += D.lam * D.coupling * q_in * self.absorption(self.heater.T_source) * dt

    def lose(self, dt: float) -> None:
        """-lambda q_loss(T), Newton cooling to the ambient."""
        D = self.domain
        D.T -= D.lam * D.coupling * self.h * (D.T - D.T_amb) * dt
        np.maximum(D.T, D.T_amb, out=D.T)

    def diffuse(self, dt: float) -> None:
        """div(alpha grad T): conservative 5-point scheme, face diffusivities by averaging."""
        D = self.domain
        T, a = D.T, D.alpha
        ax = 0.5 * (a[:, :-1] + a[:, 1:])           # faces between columns
        ay = 0.5 * (a[:-1, :] + a[1:, :])           # faces between rows
        fx = ax * (T[:, 1:] - T[:, :-1])            # flux across each face (zero at the boundary)
        fy = ay * (T[1:, :] - T[:-1, :])
        div = np.zeros_like(T)
        div[:, :-1] += fx
        div[:, 1:] -= fx
        div[:-1, :] += fy
        div[1:, :] -= fy
        T += div * dt / D.dx**2

    def disturb(self, disturbances: Iterable[Disturbance], t: float, dt: float) -> None:
        """Hot sources heat like the heater; cold sinks extract heat in proportion to T - T_amb."""
        D = self.domain
        for dist in disturbances:
            if not dist.active(t):
                continue
            density = dist.P * heat_kernel(D.N, dist.center, dist.sigma)
            if dist.P >= 0.0:
                absorbed = self.absorption(dist.T_source)
            else:
                absorbed = np.maximum(D.T - D.T_amb, 0.0) / max(float(D.T.max()) - D.T_amb, 1.0)
            D.T += D.lam * D.coupling * density * absorbed * dt

    def step(self, q_in: np.ndarray, dt: float, t: float = 0.0, disturbances: Iterable[Disturbance] = ()) -> None:
        self.heat(q_in, dt)
        self.lose(dt)
        self.diffuse(dt)
        self.disturb(disturbances, t, dt)
