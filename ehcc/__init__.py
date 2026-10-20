"""Ergodic Heat Coverage Control (EHCC): reference implementation.

    from ehcc import Config, EHCCSimulation, load_target
    sim = EHCCSimulation(Config(), load_target("T4"))
    logs = sim.run()

Equation numbers in the docstrings refer to the paper.
"""
from .config import Config, ErgodicConfig, HeaterConfig, StandoffConfig, ThermalConfig
from .domain import DEFAULT_MATERIAL, TARGETS, Domain, load_material, load_target, roi_mask
from .ergodic import ErgodicController
from .simulation import EHCCSimulation
from .stability import Loop1D, Pulse
from .standoff import StandoffController
from .surface import Surface, make_surface
from .thermal import Disturbance, HeatEquation, efficiency, heat_kernel, kernel_width

__all__ = [
    "Config", "ErgodicConfig", "HeaterConfig", "StandoffConfig", "ThermalConfig",
    "Domain", "TARGETS", "DEFAULT_MATERIAL", "load_target", "load_material", "roi_mask",
    "ErgodicController", "StandoffController", "HeatEquation", "Disturbance",
    "efficiency", "kernel_width", "heat_kernel", "Surface", "make_surface",
    "EHCCSimulation", "Loop1D", "Pulse",
]
