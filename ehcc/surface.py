"""Embedded surface s: Omega -> R^3 as a height field, and the surface-aligned frame R_s (Sec. II-E).

    s(x)   = [L x, L y, z(x, y)]
    R_s(p) = [t_1, t_2, n] in SO(3)     (5), n the outward unit normal
    r      = s(p) + d n                 end-effector position at standoff d
"""
from __future__ import annotations

import os
from typing import Optional, Tuple

import numpy as np

from .domain import ASSETS, resize


class Surface:
    def __init__(self, height: np.ndarray, domain_size: float = 0.35,
                 valid: Optional[np.ndarray] = None, name: str = "surface"):
        self.height = np.asarray(height, dtype=float)
        self.N = self.height.shape[0]
        self.L = float(domain_size)
        self.valid = np.ones_like(self.height, dtype=bool) if valid is None else np.asarray(valid, dtype=bool)
        self.name = name
        # partial derivatives of z with respect to the physical coordinates
        h = self.L / (self.N - 1)
        self.dz_dy, self.dz_dx = np.gradient(self.height, h)

    # ------------------------------------------------------------------ constructors
    @classmethod
    def flat(cls, N: int = 100, domain_size: float = 0.35) -> "Surface":
        return cls(np.zeros((N, N)), domain_size, name="flat")

    @classmethod
    def bump(cls, N: int = 100, domain_size: float = 0.35, amplitude: float = 0.05,
             sigma: float = 0.18, center=(0.5, 0.5)) -> "Surface":
        xs = np.linspace(0.0, 1.0, N)
        X, Y = np.meshgrid(xs, xs)
        z = amplitude * np.exp(-((X - center[0]) ** 2 + (Y - center[1]) ** 2) / (2.0 * sigma**2))
        return cls(z, domain_size, name="bump")

    @classmethod
    def wave(cls, N: int = 100, domain_size: float = 0.35, amplitude: float = 0.02, frequency: float = 1.0) -> "Surface":
        xs = np.linspace(0.0, 1.0, N)
        X, Y = np.meshgrid(xs, xs)
        z = amplitude * np.sin(2.0 * np.pi * frequency * X) * np.sin(2.0 * np.pi * frequency * Y)
        return cls(z, domain_size, name="wave")

    @classmethod
    def scanned_sole(cls, N: int = 100) -> "Surface":
        """Height field reconstructed from the RGB-D depth points of the 3D sole trial (Sec. VII, Fig. 16)."""
        return cls.load(os.path.join(ASSETS, "surfaces", "sole_3d_surface.npz"), N, name="sole_3d")

    @classmethod
    def load(cls, path: str, N: Optional[int] = None, name: str = "surface") -> "Surface":
        data = np.load(path, allow_pickle=False)
        height = data["height_map"]
        valid = data["valid_mask"] if "valid_mask" in data.files else None
        if N is not None and height.shape[0] != N:
            height = resize(height, N)
            valid = None if valid is None else resize(valid.astype(float), N) > 0.5
        return cls(height, float(data["domain_size"]), valid, name)

    def save(self, path: str) -> None:
        np.savez_compressed(path, height_map=self.height, valid_mask=self.valid,
                            grid_resolution=self.N, domain_size=self.L)

    # ------------------------------------------------------------------ geometry
    def _bilinear(self, field: np.ndarray, p) -> float:
        gx = float(np.clip(p[0], 0.0, 1.0)) * (self.N - 1)
        gy = float(np.clip(p[1], 0.0, 1.0)) * (self.N - 1)
        x0, y0 = min(int(gx), self.N - 2), min(int(gy), self.N - 2)
        wx, wy = gx - x0, gy - y0
        return float((1 - wx) * (1 - wy) * field[y0, x0] + wx * (1 - wy) * field[y0, x0 + 1]
                     + (1 - wx) * wy * field[y0 + 1, x0] + wx * wy * field[y0 + 1, x0 + 1])

    def point(self, p) -> np.ndarray:
        """s(p)."""
        return np.array([p[0] * self.L, p[1] * self.L, self._bilinear(self.height, p)])

    def frame(self, p) -> np.ndarray:
        """R_s(p) = [t_1, t_2, n]: t_1 along the x-coordinate line, n outward (+z side)."""
        zx, zy = self._bilinear(self.dz_dx, p), self._bilinear(self.dz_dy, p)
        n = np.array([-zx, -zy, 1.0])
        n /= np.linalg.norm(n)
        t1 = np.array([1.0, 0.0, zx])
        t1 -= t1.dot(n) * n
        t1 /= np.linalg.norm(t1)
        return np.column_stack([t1, np.cross(n, t1), n])

    def pose(self, p, d: float) -> Tuple[np.ndarray, np.ndarray]:
        """End-effector position r = s(p) + d n and orientation R = R_s(p) (5)."""
        R = self.frame(p)
        return self.point(p) + d * R[:, 2], R

    def mesh(self) -> Tuple[np.ndarray, np.ndarray]:
        """Vertices (N^2, 3) and triangles over the valid cells."""
        xs = np.linspace(0.0, 1.0, self.N)
        X, Y = np.meshgrid(xs, xs)
        vertices = np.stack([X.ravel() * self.L, Y.ravel() * self.L, self.height.ravel()], axis=1)
        i, j = np.meshgrid(np.arange(self.N - 1), np.arange(self.N - 1), indexing="ij")
        ok = self.valid[:-1, :-1] & self.valid[:-1, 1:] & self.valid[1:, :-1] & self.valid[1:, 1:]
        a = (i * self.N + j)[ok]
        faces = np.concatenate([np.stack([a, a + 1, a + self.N], 1), np.stack([a + 1, a + self.N + 1, a + self.N], 1)])
        return vertices, faces.astype(np.int32)


SURFACES = {"flat": Surface.flat, "bump": Surface.bump, "wave": Surface.wave}


def make_surface(name: str, N: int = 100, domain_size: float = 0.35) -> Surface:
    """flat, bump, wave, sole_3d (scanned), or a path to a .npz height field."""
    if name in SURFACES:
        return SURFACES[name](N, domain_size)
    if name == "sole_3d":
        return Surface.scanned_sole(N)
    return Surface.load(name, N)
