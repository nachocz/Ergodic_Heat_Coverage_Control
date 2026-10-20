"""Model, controllers, and the numbers of the paper that the package reproduces.

    python -m unittest discover tests -v
"""
import os
import sys
import unittest

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "examples"))
from ehcc import (Config, Domain, EHCCSimulation, ErgodicController, HeatEquation, Loop1D, Surface,  # noqa: E402
                  efficiency, heat_kernel, kernel_width, load_target, roi_mask)


class Model(unittest.TestCase):
    def test_roi_is_the_support_of_the_target(self):
        T = load_target("T4")
        roi = roi_mask(T)
        self.assertEqual(T.min(), 20.0)
        self.assertTrue(np.all(T[~roi] <= 20.01) and np.all(T[roi] > 20.01))
        self.assertAlmostEqual(roi.mean(), 0.2896, places=3)

    def test_resampled_targets_keep_the_ambient_floor(self):
        """Resampling 200 x 200 targets to the grid must not move T_amb or enlarge Omega_ROI."""
        from ehcc.domain import ASSETS, TARGETS
        for name, file in TARGETS.items():
            raw = np.load(os.path.join(ASSETS, "targets", file))
            T = load_target(name)
            self.assertEqual(T.min(), raw.min(), name)
            self.assertAlmostEqual(roi_mask(T).mean(), roi_mask(raw).mean(), delta=0.02, msg=name)

    def test_kernel_has_unit_integral_and_actuation_is_monotone(self):
        cfg = Config()
        for p, sigma in (((0.5, 0.5), 0.02), ((0.05, 0.9), 0.04)):
            self.assertAlmostEqual(heat_kernel(cfg.N, p, sigma).sum() * cfg.dx**2, 1.0, places=12)
        ds = np.linspace(cfg.standoff.d_min, cfg.standoff.d_max, 9)
        eta = [efficiency(d, cfg.heater, cfg.standoff.d_min, cfg.standoff.d_max) for d in ds]
        sigma = [kernel_width(d, cfg.heater, cfg.standoff.d_min, cfg.standoff.d_max) for d in ds]
        self.assertTrue(np.all(np.diff(eta) < 0) and np.all(np.diff(sigma) > 0))
        self.assertEqual(eta[-1], 0.0)                  # eta(d_max) = 0: the source does not heat

    def test_diffusion_conserves_heat_with_neumann_boundaries(self):
        D = Domain(load_target("T2"))
        rng = np.random.default_rng(0)
        D.T = D.T + rng.random(D.T.shape)
        total = D.T.sum()
        HeatEquation(D, Config().heater, h=0.0).diffuse(0.2)
        self.assertAlmostEqual(D.T.sum(), total, places=8)

    def test_target_coefficients_match_the_direct_sum(self):
        cfg = Config()
        D = Domain(load_target("T1"))
        erg = ErgodicController(cfg.ergodic, cfg.N, cfg.dt)
        Phi = D.heating_density()
        erg.set_target(Phi)
        k1, k2 = 3, 7
        direct = np.sum(Phi * np.cos(k1 * np.pi * D.X) * np.cos(k2 * np.pi * D.Y))
        self.assertAlmostEqual(erg.phi[k1 * cfg.ergodic.K + k2], direct, places=12)
        self.assertAlmostEqual(erg.phi[0], 1.0, places=12)

    def test_frame_is_orthonormal_and_normal_points_up(self):
        surf = Surface.scanned_sole()
        for p in ((0.3, 0.4), (0.7, 0.2), (0.5, 0.5)):
            R = surf.frame(p)
            np.testing.assert_allclose(R.T @ R, np.eye(3), atol=1e-12)
            self.assertAlmostEqual(np.linalg.det(R), 1.0, places=12)
            self.assertGreater(R[2, 2], 0.0)
            r, _ = surf.pose(p, 0.2)
            self.assertAlmostEqual(np.linalg.norm(r - surf.point(p)), 0.2, places=12)


class ClosedLoop(unittest.TestCase):
    def test_table_II_row_T4(self):
        """EHCC on T4 (Table II): <e_bar> = -0.11 C, <sigma_e> = 2.82 C, int ||e|| dt = 1.11e5."""
        from benchmark import metrics, run
        _, logs = run("T4")
        m = metrics(logs)
        self.assertAlmostEqual(m["e_mean"], -0.11, delta=0.005)
        self.assertAlmostEqual(m["e_std"], 2.82, delta=0.005)
        self.assertAlmostEqual(m["l2_integral"] / 1e5, 1.11, delta=0.005)

    def test_gate_stays_in_unit_interval_and_d_in_its_range(self):
        cfg = Config()
        logs = EHCCSimulation(cfg, load_target("T2")).run(1500)
        self.assertTrue(np.all((logs["gate"] >= 0) & (logs["gate"] <= 1)))
        self.assertTrue(np.all(logs["d"] >= logs["d_lb"] - 1e-12) and np.all(logs["d"] <= cfg.standoff.d_max + 1e-12))


class Stability(unittest.TestCase):
    loop = Loop1D()

    def test_steady_state_map_is_strictly_decreasing(self):
        """Lemma 1: e_ss is strictly decreasing on [0, 1]."""
        values = [self.loop.e_ss(g) for g in np.linspace(0.0, 1.0, 21)]
        self.assertTrue(np.all(np.diff(values) < 0))

    def test_regime_equilibria_of_fig5(self):
        """g*_r = 0.31 (no disturbance), 0.03 (hot), 0.66 (cold), as in the caption of Fig. 5."""
        for A, expected in ((0.0, 0.31), (18.0, 0.03), (-18.0, 0.66)):
            g = self.loop.equilibrium_gate(self.loop.regime_disturbance(A))
            self.assertAlmostEqual(g, expected, delta=0.005)

    def test_discrete_gate_converges_for_small_gain_and_cycles_for_large_gain(self):
        g_star = self.loop.equilibrium_gate()
        slow = self.loop.run_discrete(0.1)
        fast = self.loop.run_discrete(20.0)
        last = slow["t"] > 95.0
        self.assertLess(np.max(np.abs(slow["gate"][last] - g_star)), 1e-3)
        self.assertGreater(np.ptp(fast["gate"][last]), 0.3)

    def test_lyapunov_function_is_nonnegative_and_zero_at_equilibrium(self):
        g_star = self.loop.equilibrium_gate()
        gs = np.linspace(0.0, 1.0, 41)
        V = self.loop.lyapunov(gs, g_star)
        self.assertTrue(np.all(V >= -1e-9))
        self.assertAlmostEqual(float(self.loop.lyapunov(np.array([g_star]), g_star)[0]), 0.0, places=9)


if __name__ == "__main__":
    unittest.main()
