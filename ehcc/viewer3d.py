"""Optional live 3D view with Open3D (pip install open3d): the surface coloured by T,
the end-effector trail, and the frame R_s = [t_1, t_2, n] in red, green, blue.
The web pages in docs/ show the same scene with three.js, without Open3D."""
from __future__ import annotations

import matplotlib
import numpy as np


class Viewer3D:
    def __init__(self, surface, T_amb: float, T_max: float):
        self.surface, self.T_amb, self.T_max = surface, T_amb, max(T_max, T_amb + 1.0)
        self.enabled = False
        try:
            import open3d as o3d
        except ImportError:
            print("Open3D is not installed: no live 3D view (pip install open3d).")
            return
        self.o3d = o3d
        self.vis = o3d.visualization.Visualizer()
        self.vis.create_window(window_name="EHCC", width=1200, height=860)
        vertices, faces = surface.mesh()
        self.mesh = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(vertices), o3d.utility.Vector3iVector(faces))
        self.mesh.compute_vertex_normals()
        self.frame = o3d.geometry.LineSet()
        self.frame.lines = o3d.utility.Vector2iVector([[0, 1], [0, 2], [0, 3]])
        self.frame.colors = o3d.utility.Vector3dVector([[0.9, 0.2, 0.2], [0.2, 0.8, 0.2], [0.2, 0.3, 1.0]])
        self.trail = o3d.geometry.LineSet()
        for geometry in (self.mesh, self.frame, self.trail):
            self.vis.add_geometry(geometry)
        self.vis.get_render_option().background_color = np.array([0.09, 0.1, 0.13])
        self.cmap = matplotlib.colormaps["hot"]
        self.enabled = True

    def update(self, T: np.ndarray, trail: np.ndarray, r: np.ndarray, R: np.ndarray) -> None:
        if not self.enabled:
            return
        o3d = self.o3d
        level = np.clip((T.ravel() - self.T_amb) / (self.T_max - self.T_amb), 0.0, 1.0)
        self.mesh.vertex_colors = o3d.utility.Vector3dVector(self.cmap(level)[:, :3])
        length = 0.08 * self.surface.L
        self.frame.points = o3d.utility.Vector3dVector([r, r + length * R[:, 0], r + length * R[:, 1], r + length * R[:, 2]])
        if len(trail) > 1:
            self.trail.points = o3d.utility.Vector3dVector(trail)
            self.trail.lines = o3d.utility.Vector2iVector([[i, i + 1] for i in range(len(trail) - 1)])
            shade = np.linspace(0.0, 1.0, len(trail) - 1)[:, None]
            self.trail.colors = o3d.utility.Vector3dVector((1 - shade) * [1.0, 0.95, 0.6] + shade * [0.2, 0.35, 0.95])
        for geometry in (self.mesh, self.frame, self.trail):
            self.vis.update_geometry(geometry)
        self.vis.poll_events()
        self.vis.update_renderer()

    def close(self) -> None:
        if self.enabled:
            self.vis.destroy_window()
            self.enabled = False
