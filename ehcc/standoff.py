"""Standoff (power) controller (Sec. IV): the normal input u_n = dd/dt.

    e_p(t)  = e_+(p(t), t)                                         (17)
    d(t)    = d_max - (d_max - d_lb(t)) e_p(t) / e_max             (18)
    e_bar   = mean of e over Omega_ROI                              (19)
    d_lb(t) = d_min - k_I int_0^t e_bar dtau,  in [d_min, d_max]   (20)-(21)
    g(t)    = (d_max - d_lb(t)) / (d_max - d_min)                   (22), the gate of Sec. IV-B
"""
from __future__ import annotations

import numpy as np

from .config import StandoffConfig
from .domain import Domain


class StandoffController:
    def __init__(self, cfg: StandoffConfig):
        self.cfg = cfg
        self.reset()

    def reset(self) -> None:
        cfg = self.cfg
        self.d_lb = cfg.d_min if cfg.d_lb0 is None else float(np.clip(cfg.d_lb0, cfg.d_min, cfg.d_max))
        self.d = cfg.d_max
        self.e_p = 0.0

    @property
    def gate(self) -> float:
        """g (22): 1 = full heating range, 0 = no active heating."""
        return (self.cfg.d_max - self.d_lb) / (self.cfg.d_max - self.cfg.d_min)

    def update(self, domain: Domain, p, dt: float) -> float:
        cfg = self.cfg
        # (21) with saturation (anti-windup) at both limits
        self.d_lb = float(np.clip(self.d_lb - cfg.k_I * domain.mean_error() * dt, cfg.d_min, cfg.d_max))
        # (17)-(18); outside Omega_ROI the source retreats to d_max
        if domain.in_roi(p):
            e = domain.sample(domain.T_star, p) - domain.sample(domain.T, p)
            self.e_p = max(e, 0.0)
        else:
            self.e_p = 0.0
        self.d = cfg.d_max - (cfg.d_max - self.d_lb) * min(self.e_p / domain.e_max, 1.0)
        return self.d
