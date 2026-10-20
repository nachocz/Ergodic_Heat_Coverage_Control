"""Ergodic coverage controller (Sec. III): the tangential input u_tau = dp/dt.

    Psi_k(x)   = cos(k1 pi x) cos(k2 pi y)                         (11)
    phi_k(t)   = int Phi(x, t) Psi_k(x) dx                         (12)
    c_k(t)     = (1/t) int_0^t Psi_k(p(tau)) dtau                  (13)
    E(t)       = sum_k Lambda_k (c_k - phi_k)^2                    (14)
    Lambda_k   = (1 + |k|^2)^(-s)                                  (15)
    u_tau(t)   = -K_g sum_k Lambda_k (c_k - phi_k) grad Psi_k(p)   (16), saturated at u_max
"""
from __future__ import annotations

from typing import Tuple

import numpy as np

from .config import ErgodicConfig


class ErgodicController:
    def __init__(self, cfg: ErgodicConfig, N: int, dt: float):
        self.cfg = cfg
        self.dt = dt
        k = np.arange(cfg.K)
        self.k1, self.k2 = (a.ravel() for a in np.meshgrid(k, k, indexing="ij"))
        self.Lambda = 1.0 / (1.0 + self.k1**2 + self.k2**2) ** cfg.s
        xs = np.linspace(0.0, 1.0, N)
        X, Y = np.meshgrid(xs, xs)
        # Psi_k on the grid nodes, one column per mode (k1 outer, k2 inner)
        self.basis = np.stack([np.cos(a * np.pi * X) * np.cos(b * np.pi * Y)
                               for a, b in zip(self.k1, self.k2)], axis=-1).reshape(N * N, -1)
        self.phi = np.zeros(cfg.K**2)
        self.reset()

    def reset(self) -> None:
        self.c_sum = np.zeros(self.cfg.K**2)
        self.t = self.dt                    # time horizon of the average (13), starts at dt
        self.c = np.zeros(self.cfg.K**2)

    def set_target(self, Phi: np.ndarray) -> None:
        """phi_k of a density Phi given on the grid with unit sum (discrete form of (12)).

        phi[k1, k2] = sum_iy sum_ix cos(k1 pi x_ix) cos(k2 pi y_iy) Phi[iy, ix].
        """
        self.phi = Phi.reshape(-1) @ self.basis

    def psi(self, p) -> np.ndarray:
        return np.cos(np.pi * self.k1 * p[0]) * np.cos(np.pi * self.k2 * p[1])

    def grad_psi(self, p) -> Tuple[np.ndarray, np.ndarray]:
        cx, sx = np.cos(np.pi * self.k1 * p[0]), np.sin(np.pi * self.k1 * p[0])
        cy, sy = np.cos(np.pi * self.k2 * p[1]), np.sin(np.pi * self.k2 * p[1])
        return -np.pi * self.k1 * sx * cy, -np.pi * self.k2 * cx * sy

    def metric(self) -> float:
        """E(t) (14)."""
        return float(np.sum(self.Lambda * (self.c - self.phi) ** 2))

    def control(self, p) -> np.ndarray:
        """u_tau (16), saturated at u_max."""
        w = self.Lambda * (self.c - self.phi)
        gx, gy = self.grad_psi(p)
        u = -self.cfg.K_g * np.array([np.sum(w * gx), np.sum(w * gy)])
        norm = float(np.linalg.norm(u))
        if norm > self.cfg.u_max:
            u *= self.cfg.u_max / norm
        return u

    def step(self, p) -> Tuple[np.ndarray, float]:
        """Add p(t) to the coverage statistics (13), then return (u_tau, E)."""
        self.c_sum += self.psi(p) * self.dt
        self.t += self.dt
        self.c = self.c_sum / self.t
        return self.control(p), self.metric()
