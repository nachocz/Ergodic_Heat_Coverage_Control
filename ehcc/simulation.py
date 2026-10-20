"""Closed loop of EHCC on the distributed thermal model (Fig. 2).

One step of length dt:
  1. standoff law (17)-(21): d(t) from e_p and the adaptive lower bound d_lb,
  2. heat equation (2) with q_in = P eta(d) K(x; p, d) (3), and external disturbances,
  3. heating density Phi (10) recomputed from the measured error, target coefficients (12),
  4. ergodic law (16): u_tau, and p <- p + u_tau dt,
  5. pose on the surface: r = s(p) + d n, R = R_s(p) (5).
"""
from __future__ import annotations

from typing import Dict, Iterable, List, Optional

import numpy as np

from .config import Config
from .domain import Domain
from .ergodic import ErgodicController
from .standoff import StandoffController
from .surface import Surface
from .thermal import Disturbance, HeatEquation, efficiency, heat_kernel, kernel_width

LOG_KEYS = ("t", "px", "py", "d", "d_lb", "gate", "eta", "Q_in", "e_p", "E",
            "e_mean", "e_std", "e_rms", "e_plus_mean", "l2_error", "rx", "ry", "rz")


class EHCCSimulation:
    def __init__(self, config: Config, T_star: np.ndarray, material: Optional[np.ndarray] = None,
                 surface: Optional[Surface] = None, disturbances: Iterable[Disturbance] = (),
                 T_amb: Optional[float] = None):
        self.cfg = config
        th = config.thermal
        if T_star.shape[0] != config.N:
            raise ValueError(f"T_star is {T_star.shape}, the grid is {config.N} x {config.N}")
        self.surface = surface if surface is not None else Surface.flat(config.N, config.domain_size)
        self.domain = Domain(T_star, th.lam, th.kappa, material, th.roi_threshold,
                             th.outside_roi_coupling, valid=self.surface.valid, T_amb=T_amb)
        self.heat = HeatEquation(self.domain, config.heater, th.h)
        self.standoff = StandoffController(config.standoff)
        self.ergodic = ErgodicController(config.ergodic, config.N, config.dt)
        self.disturbances: List[Disturbance] = list(disturbances)
        self.p = np.array(config.ergodic.p0, dtype=float)
        self.k = 0                       # step counter; t = k dt
        self.t = 0.0
        self.trajectory = [self.p.copy()]
        self.log: Dict[str, List[float]] = {key: [] for key in LOG_KEYS}

    def q_in(self, d: float) -> np.ndarray:
        """q_in(x) = P eta(d) K(x; p, d) (3)."""
        cfg = self.cfg
        lo, hi = cfg.standoff.d_min, cfg.standoff.d_max
        eta = efficiency(d, cfg.heater, lo, hi)
        return cfg.heater.P * eta * heat_kernel(cfg.N, self.p, kernel_width(d, cfg.heater, lo, hi))

    def step(self) -> Dict[str, float]:
        cfg, D = self.cfg, self.domain
        self.k += 1
        self.t = self.k * cfg.dt
        d = self.standoff.update(D, self.p, cfg.dt)
        self.heat.step(self.q_in(d), cfg.dt, self.t, self.disturbances)
        self.ergodic.set_target(D.heating_density())
        u, E = self.ergodic.step(self.p)
        p_now = self.p.copy()
        self.p = np.clip(self.p + u * cfg.dt, 0.01, 0.99)
        self.trajectory.append(self.p.copy())
        r, _ = self.surface.pose(p_now, d)
        eta = efficiency(d, cfg.heater, cfg.standoff.d_min, cfg.standoff.d_max)
        row = {"t": self.t, "px": p_now[0], "py": p_now[1], "d": d, "d_lb": self.standoff.d_lb,
               "gate": self.standoff.gate, "eta": eta, "Q_in": cfg.heater.P * eta, "e_p": self.standoff.e_p,
               "E": E, "rx": r[0], "ry": r[1], "rz": r[2], **D.metrics()}
        for key in LOG_KEYS:
            self.log[key].append(float(row[key]))
        return row

    def run(self, steps: Optional[int] = None, progress: int = 0) -> Dict[str, np.ndarray]:
        steps = self.cfg.steps if steps is None else steps
        for i in range(steps):
            row = self.step()
            if progress and i % progress == 0:
                print(f"t = {row['t']:7.1f} s   e_bar = {row['e_mean']:+6.2f} C   "
                      f"d = {100 * row['d']:5.1f} cm   d_lb = {100 * row['d_lb']:5.1f} cm   E = {row['E']:.4f}")
        return self.logs()

    def logs(self) -> Dict[str, np.ndarray]:
        return {key: np.asarray(values) for key, values in self.log.items()}

    def save(self, path: str) -> None:
        """Logs, final field, target, Omega_ROI, and trajectory in one .npz file."""
        np.savez_compressed(path, T=self.domain.T, T_star=self.domain.T_star, roi=self.domain.roi,
                            trajectory=np.asarray(self.trajectory), height=self.surface.height,
                            **{f"log_{k}": v for k, v in self.logs().items()})
