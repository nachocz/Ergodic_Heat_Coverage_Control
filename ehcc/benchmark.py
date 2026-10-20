"""Simulation benchmark of Sec. VI: EHCC, its two ablations, and three literature baselines
on the same plant (Tables I-III, Figs. 7-9).

Every run lasts 10 000 steps of 0.2 s, with a hot pulse (+600 W, 16:40-17:00) and a cold
sink (-600 W, 26:40-27:40) centred at (0.45, 0.65). Methods:

    ehcc     EHCC (ergodic law + adaptive standoff)
    ehcc_na  EHCC-NA: k_I = 0, d_lb = d_min (Sec. VI-B)
    greedy   Greedy-A: greedy pursuit + adaptive standoff
    gtm      GTM (Hu et al.)
    lqg_m    LQG-M (Jones et al.)
    mpdc     MPDC (Muddassir et al.)
"""
from __future__ import annotations

import copy
import os
import time
from typing import Dict, Optional

import numpy as np

from .baselines import BASELINES
from .config import Config
from .domain import DEFAULT_MATERIAL, load_material, load_target
from .simulation import EHCCSimulation
from .thermal import Disturbance

METHODS = ("ehcc", "ehcc_na", "greedy", "gtm", "lqg_m", "mpdc")
LABELS = {"ehcc": "EHCC (ours)", "ehcc_na": "EHCC-NA (ours)", "greedy": "Greedy-A (ours)",
          "gtm": "GTM (Hu 2021)", "lqg_m": "LQG-M (Jon. 2003)", "mpdc": "MPDC (Mud. 2022)"}
STYLE = {"ehcc": ("#2ca02c", "-", 1.4), "ehcc_na": ("#ff7f0e", "--", 1.1), "greedy": ("#d62728", ":", 1.2),
         "gtm": ("#9467bd", "--", 1.1), "lqg_m": ("#8c564b", "-.", 1.1), "mpdc": ("#17becf", "-.", 1.1)}
TARGETS = ("T1", "T2", "T3", "T4", "T5")
K_I = {"T5": 0.02, "interleaved": 0.02}          # 0.04 for T1-T4 (Config default)


def disturbances() -> list:
    """Hot pulse and cold sink of Sec. VI-A."""
    return [Disturbance((0.45, 0.65), 0.12, +600.0, 1000.0, 1020.0, 150.0),
            Disturbance((0.45, 0.65), 0.12, -600.0, 1600.0, 1660.0, 20.0)]


class BenchmarkSimulation(EHCCSimulation):
    """EHCCSimulation with a choice of controller. The plant, heater model, and step order
    are those of EHCC; only p(t) and d(t) differ between methods."""

    def __init__(self, config: Config, T_star: np.ndarray, method: str = "ehcc",
                 material: Optional[np.ndarray] = None, disturbances=(), T_amb: Optional[float] = None,
                 n_snapshots: int = 6):
        config = copy.deepcopy(config)
        if method == "ehcc_na":
            config.standoff.k_I, config.standoff.d_lb0 = 0.0, config.standoff.d_min
        super().__init__(config, T_star, material, None, disturbances, T_amb)
        if method not in METHODS:
            raise ValueError(f"unknown method '{method}', choose from {METHODS}")
        self.method = method
        self.controller = BASELINES[method](config, self.domain) if method in BASELINES else None
        st = config.standoff
        self.d = st.d_max if st.d_lb0 is None else st.d_lb0     # initial standoff of GTM, LQG-M, MPDC
        self.ctrl_time = []
        self.snapshot_steps = [int(round(i * config.steps / n_snapshots)) for i in range(1, n_snapshots + 1)]
        self.snapshots = []

    def step(self) -> Dict[str, float]:
        cfg, D = self.cfg, self.domain
        self.k += 1
        self.t = self.k * cfg.dt
        sets_standoff = self.controller is not None and self.controller.sets_standoff
        d = self.d if sets_standoff else self.standoff.update(D, self.p, cfg.dt)
        self.heat.step(self.q_in(d), cfg.dt, self.t, self.disturbances)
        if self.controller is None:
            self.ergodic.set_target(D.heating_density())
        start = time.perf_counter()
        if self.controller is None:
            u, E = self.ergodic.step(self.p)
        else:
            u, d_command = self.controller.step(D, self.p, d)
            E = 0.0
            if d_command is not None:     # applied from the next step on
                self.d = d = float(np.clip(d_command, cfg.standoff.d_min, cfg.standoff.d_max))
        self.ctrl_time.append(time.perf_counter() - start)
        row = self._move_and_record(u, d, E)
        if self.k in self.snapshot_steps:
            self.snapshots.append(self.domain.T.copy())
        return row

    def logs(self) -> Dict[str, np.ndarray]:
        out = super().logs()
        out["ctrl_time"] = np.asarray(self.ctrl_time)
        return out

    def save(self, path: str) -> None:
        """Logs, trajectory, snapshots, final field, target, Omega_ROI, and material in one .npz file."""
        np.savez_compressed(path, T=self.domain.T, T_star=self.domain.T_star, roi=self.domain.roi,
                            lam=self.domain.lam, trajectory=np.asarray(self.trajectory),
                            snapshot_steps=np.asarray(self.snapshot_steps), snapshots=np.asarray(self.snapshots),
                            **{f"log_{k}": v for k, v in self.logs().items()})


def run(target: str, method: str = "ehcc", config: Optional[Config] = None, steps: Optional[int] = None,
        progress: int = 0) -> BenchmarkSimulation:
    """One run of the benchmark protocol: target T1-T5 or 'interleaved', with its material layout."""
    config = copy.deepcopy(config or Config())
    config.standoff.k_I = K_I.get(target, config.standoff.k_I)
    material = load_material(DEFAULT_MATERIAL[target], config.N) if target in DEFAULT_MATERIAL else None
    # T_amb = 20 C, the floor of the targets; the targets are resampled as in the benchmark runs
    sim = BenchmarkSimulation(config, load_target(target, config.N, floor=False), method, material,
                              disturbances(), T_amb=20.0)
    sim.run(steps, progress)
    return sim


def metrics(logs: Dict[str, np.ndarray], domain_size: float = 0.35) -> Dict[str, float]:
    """Metrics of Tables II-III: integral of ||e||_L2 dt [degC cm s], time averages of e_bar and
    sigma_e [degC], and the mean and maximum computation time of the controller [ms]."""
    l2 = 100.0 * domain_size * np.sqrt(np.maximum(logs["l2_error"], 0.0))
    trapezoid = getattr(np, "trapezoid", None) or np.trapz
    out = {"l2_integral": float(trapezoid(l2, logs["t"])), "e_mean": float(np.mean(logs["e_mean"])),
           "e_std": float(np.mean(logs["e_std"]))}
    if "ctrl_time" in logs:
        out.update(cost_mean=1e3 * float(np.mean(logs["ctrl_time"])), cost_max=1e3 * float(np.max(logs["ctrl_time"])))
    return out


def load(path: str) -> Dict[str, np.ndarray]:
    """A saved run as a dict: logs under their names, and the arrays of BenchmarkSimulation.save."""
    data = np.load(path)
    return {(k[4:] if k.startswith("log_") else k): data[k] for k in data.files}


def result_path(root: str, target: str, method: str) -> str:
    return os.path.join(root, target, f"{method}.npz")


def cached(target: str, method: str, root: str = os.path.join("outputs", "benchmark"),
           force: bool = False) -> Dict[str, np.ndarray]:
    """The saved run of (target, method) under root, computed and saved first if needed."""
    path = result_path(root, target, method)
    if force or not os.path.exists(path):
        print(f"  running {target:11s} {method:8s} ...", flush=True)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        run(target, method).save(path)
    return load(path)
