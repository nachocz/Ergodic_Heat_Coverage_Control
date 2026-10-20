"""Simulation and controller parameters.

The defaults are the values of the simulation benchmark of the paper (Sec. VI)
for targets T1-T4; T5 and the interleaved case use k_I = 0.02 (see
examples/benchmark.py). Lengths on the surface are normalized: the parametric
domain is Omega = [0, 1]^2, and `domain_size` gives its physical side length
L [m]. The standoff d is in metres.
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field, fields, is_dataclass
from typing import Any, Dict, Optional

import yaml


@dataclass
class HeaterConfig:
    """Actuation model (3)-(4): q_in = P eta(d) K(x; p, d)."""
    P: float = 1200.0            # nominal power [W]
    eta_max: float = 0.9         # efficiency eta(d_min)
    eta_min: float = 0.0         # efficiency eta(d_max), "the source does not heat"
    sigma_min: float = 0.02      # kernel width sigma(d_min) [normalized]
    sigma_max: float = 0.04      # kernel width sigma(d_max) [normalized]
    T_source: float = 150.0      # source temperature: absorption vanishes at T = T_source [degC]


@dataclass
class StandoffConfig:
    """Standoff controller (18)-(21)."""
    d_min: float = 0.05          # [m]
    d_max: float = 0.45          # [m]
    k_I: float = 0.04            # integral gain of d_lb [m/(s degC)]
    d_lb0: Optional[float] = 0.2   # d_lb(0) [m]; None means d_min


@dataclass
class ErgodicConfig:
    """Ergodic coverage controller (10)-(16)."""
    K: int = 15                  # spectral modes per dimension
    s: float = 1.05              # Sobolev exponent in Lambda_k (15)
    K_g: float = 0.4             # gain of the tangential law (16)
    u_max: float = 0.1           # speed limit [domain lengths / s]
    p0: tuple = (0.25, 0.35)     # initial focal point p(0); not the centre or a corner (Sec. III-C)


@dataclass
class ThermalConfig:
    """Heat equation (2), with uniform properties unless a material map is given."""
    lam: float = 1.0e-4          # thermal coupling lambda = 1/(c rho)
    kappa: float = 0.1           # conductivity; diffusivity alpha = lambda kappa
    h: float = 6.0               # convection coefficient, q_loss = h (T - T_amb)
    outside_roi_coupling: float = 0.4  # coupling of the backing material outside Omega_ROI
    roi_threshold: float = 0.01  # Omega_ROI = {x : T*(x) > T_amb + roi_threshold} [degC]


@dataclass
class Config:
    dt: float = 0.2              # time step [s]
    steps: int = 10_000          # 33 min 20 s
    N: int = 100                 # grid points per axis
    domain_size: float = 0.35    # side length L of Omega [m]
    heater: HeaterConfig = field(default_factory=HeaterConfig)
    standoff: StandoffConfig = field(default_factory=StandoffConfig)
    ergodic: ErgodicConfig = field(default_factory=ErgodicConfig)
    thermal: ThermalConfig = field(default_factory=ThermalConfig)

    @property
    def dx(self) -> float:
        return 1.0 / (self.N - 1)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "Config":
        return _build(cls, raw or {})

    @classmethod
    def from_yaml(cls, path: str) -> "Config":
        if not os.path.exists(path):
            raise FileNotFoundError(path)
        with open(path, "r", encoding="utf-8") as handle:
            return cls.from_dict(yaml.safe_load(handle))

    def to_yaml(self, path: str) -> None:
        payload = self.to_dict()
        payload["ergodic"]["p0"] = list(payload["ergodic"]["p0"])
        with open(path, "w", encoding="utf-8") as handle:
            yaml.safe_dump(payload, handle, sort_keys=False)


def _build(cls, raw: Dict[str, Any]):
    """Dataclass from a (possibly partial) nested dict; unknown keys are an error."""
    kwargs = {}
    known = {f.name: f for f in fields(cls)}
    for key, value in raw.items():
        if key not in known:
            raise KeyError(f"unknown parameter '{key}' for {cls.__name__}")
        default = known[key].default_factory() if callable(known[key].default_factory) else None
        if is_dataclass(default) and isinstance(value, dict):
            value = _build(type(default), value)
        if key == "p0":
            value = tuple(value)
        kwargs[key] = value
    return cls(**kwargs)
