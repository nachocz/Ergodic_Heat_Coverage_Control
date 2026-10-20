"""The parametric domain Omega = [0, 1]^2: grid, target T*, Omega_ROI, and material maps.

Fields are arrays of shape (N, N) indexed [iy, ix], with y increasing with the
row index (an image shown with origin="lower").
"""
from __future__ import annotations

import os
from typing import Dict, Optional, Tuple

import numpy as np
from scipy.ndimage import zoom

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

# Target temperature distributions of the paper, in assets/targets/.
TARGETS: Dict[str, str] = {
    "T1": "T1.npy",                     # Sec. VI, Fig. 7
    "T2": "T2.npy",
    "T3": "T3.npy",
    "T4": "T4_dignity.npy",             # the "dignity" shape of Fig. 2
    "T5": "T5.npy",                     # heterogeneous domain (left half metallic)
    "interleaved": "T_interleaved.npy",  # Sec. VI-E, Fig. 8
    "sole_3d": "sole_3d.npy",           # experiment on the scanned 3D sole, Sec. VII, Fig. 15
}
# Material maps (lambda, kappa) per cell, in assets/materials/.
MATERIALS: Dict[str, str] = {"halves": "T5_halves.npy", "interleaved": "interleaved.npy"}
DEFAULT_MATERIAL = {"T5": "halves", "interleaved": "interleaved"}


def grid(N: int) -> Tuple[np.ndarray, np.ndarray]:
    """Coordinates X, Y of the N x N nodes of [0, 1]^2."""
    xs = np.linspace(0.0, 1.0, N)
    return np.meshgrid(xs, xs)


def resize(field: np.ndarray, N: int) -> np.ndarray:
    """Cubic-spline resampling of an (M, M[, C]) array to (N, N[, C])."""
    field = np.asarray(field, dtype=float)
    if field.shape[0] == N:
        return field.copy()
    factor = (N / field.shape[0], N / field.shape[1]) + (1,) * (field.ndim - 2)
    return zoom(field, factor)


def load_target(name: str, N: int = 100, floor: bool = True) -> np.ndarray:
    """A target T* by name (see TARGETS) or from a .npy path, resampled to N x N.

    With `floor`, the resampled field is clipped from below at the floor of the data,
    so that the spline does not undershoot the ambient temperature (which would move
    T_amb and Omega_ROI); the values inside Omega_ROI are left as resampled.
    """
    path = os.path.join(ASSETS, "targets", TARGETS[name]) if name in TARGETS else name
    raw = np.asarray(np.load(path), dtype=float)
    out = resize(raw, N)
    return np.maximum(out, raw.min()) if floor else out


def load_material(name: str, N: int = 100) -> np.ndarray:
    """A material map of shape (N, N, 2): [..., 0] = lambda, [..., 1] = kappa."""
    path = os.path.join(ASSETS, "materials", MATERIALS[name]) if name in MATERIALS else name
    return resize(np.load(path), N)


def ambient_temperature(T_star: np.ndarray) -> float:
    """T_amb is the floor of the target (outside Omega_ROI, T* = T_amb)."""
    return float(np.min(T_star))


def roi_mask(T_star: np.ndarray, T_amb: Optional[float] = None, threshold: float = 0.01) -> np.ndarray:
    """Indicator chi_ROI of Omega_ROI: the cells where the target is above ambient."""
    T_amb = ambient_temperature(T_star) if T_amb is None else T_amb
    return T_star > T_amb + threshold


def gaussian_target(N: int = 100, T_amb: float = 20.0, dT: float = 10.0,
                    center=(0.5, 0.5), sigma: float = 0.15, floor: float = 0.05) -> np.ndarray:
    """A Gaussian bump, cut to T_amb where it is below `floor` of its peak."""
    X, Y = grid(N)
    g = np.exp(-((X - center[0]) ** 2 + (Y - center[1]) ** 2) / (2.0 * sigma**2))
    return T_amb + dT * np.where(g > floor, g, 0.0)


def ring_target(N: int = 100, T_amb: float = 20.0, dT: float = 8.0,
                center=(0.5, 0.5), radius: float = 0.3, width: float = 0.07, floor: float = 0.05) -> np.ndarray:
    X, Y = grid(N)
    r = np.hypot(X - center[0], Y - center[1])
    g = np.exp(-((r - radius) ** 2) / (2.0 * width**2))
    return T_amb + dT * np.where(g > floor, g, 0.0)


class Domain:
    """Temperature field T, target T*, Omega_ROI, and thermal property maps.

    The material outside Omega_ROI is modelled as an insulating backing: its
    coupling to the heat source, to the environment, and to its neighbours is
    reduced by `outside_roi_coupling` (as in the benchmark of Sec. VI).
    """

    def __init__(self, T_star: np.ndarray, lam: float = 1.0e-4, kappa: float = 0.1,
                 material: Optional[np.ndarray] = None, roi_threshold: float = 0.01,
                 outside_roi_coupling: float = 0.4, valid: Optional[np.ndarray] = None,
                 T_amb: Optional[float] = None):
        self.T_star = np.asarray(T_star, dtype=float)
        self.N = self.T_star.shape[0]
        self.dx = 1.0 / (self.N - 1)
        self.X, self.Y = grid(self.N)
        self.T_amb = ambient_temperature(self.T_star) if T_amb is None else float(T_amb)
        self.roi = roi_mask(self.T_star, self.T_amb, roi_threshold)
        if valid is not None:                       # surface points without measurements
            self.roi &= np.asarray(valid, dtype=bool)
        if material is None:
            self.lam = np.full((self.N, self.N), lam)
            self.kappa = np.full((self.N, self.N), kappa)
        else:
            self.lam = np.asarray(material[..., 0], dtype=float)
            self.kappa = np.asarray(material[..., 1], dtype=float)
        self.outside_roi_coupling = float(outside_roi_coupling)
        self.coupling = np.where(self.roi, 1.0, outside_roi_coupling)
        self.alpha = self.lam * self.kappa * self.coupling      # diffusivity alpha(x)
        self.e_max = max(1.0, float(np.max(self.T_star - self.T_amb)))   # (18): max e_+(x, 0)
        self.T = np.full((self.N, self.N), self.T_amb)

    # ------------------------------------------------------------------ errors
    def error(self) -> np.ndarray:
        """e = T* - T (1)."""
        return self.T_star - self.T

    def positive_error(self) -> np.ndarray:
        """e_+ (9): the heat deficit on Omega_ROI, zero elsewhere."""
        return np.where(self.roi, np.maximum(self.error(), 0.0), 0.0)

    def heating_density(self) -> np.ndarray:
        """Phi (10), normalized to unit sum over the grid nodes.

        Where no heat deficit is left (e_+ = 0 everywhere), Phi is uniform.
        """
        e_plus = self.positive_error()
        total = e_plus.sum()
        if total <= 0.0:
            return np.full_like(e_plus, 1.0 / e_plus.size)
        return e_plus / total

    def mean_error(self) -> float:
        """e_bar (19): spatial mean of e over Omega_ROI."""
        return float(np.mean(self.error()[self.roi]))

    def metrics(self) -> Dict[str, float]:
        e = self.error()[self.roi]
        return {
            "e_mean": float(np.mean(e)),
            "e_std": float(np.std(e)),
            "e_rms": float(np.sqrt(np.mean(e**2))),
            "e_plus_mean": float(np.mean(np.maximum(e, 0.0))),
            # ||e||_{L^2(Omega_ROI)}^2 on the normalized domain
            "l2_error": float(np.sum(e**2) * self.dx**2),
        }

    # ------------------------------------------------------------------ sampling
    def sample(self, field: np.ndarray, p: np.ndarray) -> float:
        """Bilinear interpolation of a field at p in [0, 1]^2."""
        gx, gy = p[0] * (self.N - 1), p[1] * (self.N - 1)
        x0, y0 = int(np.floor(gx)), int(np.floor(gy))
        x1, y1 = min(x0 + 1, self.N - 1), min(y0 + 1, self.N - 1)
        wx, wy = gx - x0, gy - y0
        return float((1 - wx) * (1 - wy) * field[y0, x0] + wx * (1 - wy) * field[y0, x1]
                     + (1 - wx) * wy * field[y1, x0] + wx * wy * field[y1, x1])

    def in_roi(self, p: np.ndarray) -> bool:
        """chi_ROI at the grid node nearest to p."""
        ix = int(np.clip(np.floor(p[0] * (self.N - 1) + 0.5), 0, self.N - 1))
        iy = int(np.clip(np.floor(p[1] * (self.N - 1) + 0.5), 0, self.N - 1))
        return bool(self.roi[iy, ix])
