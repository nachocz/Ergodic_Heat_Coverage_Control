"""The browser port (docs/js/sim) against the Python package: same inputs, same logs.

Runs tests/web_parity.mjs with Node.js; skipped if `node` is not on the PATH.
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import unittest

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from ehcc import Config, Disturbance, EHCCSimulation, Loop1D  # noqa: E402
from ehcc.surface import Surface  # noqa: E402

NODE = shutil.which("node")


def node(*args):
    result = subprocess.run([NODE, os.path.join(ROOT, "tests", "web_parity.mjs"), *map(str, args)],
                            capture_output=True, text=True, check=True, cwd=ROOT)
    return json.loads(result.stdout)


def decode(b64):
    return np.frombuffer(base64.b64decode(b64), dtype="<f4").astype(float).reshape(100, 100)


@unittest.skipIf(NODE is None, "Node.js not found")
class WebParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(ROOT, "docs", "data", "fields.json"), encoding="utf-8") as handle:
            cls.fields = json.load(handle)

    def python_run(self, target, steps, material=None, surface=None):
        cfg = Config()
        mat = None
        if material:
            f = decode(self.fields["materials"][material]["metal_fraction"])
            r, m = self.fields["rubber"], self.fields["metal"]
            mat = np.stack([r["lam"] + f * (m["lam"] - r["lam"]), r["kappa"] + f * (m["kappa"] - r["kappa"])], axis=-1)
        surf = None
        if surface == "sole_3d":
            s = self.fields["surfaces"]["sole_3d"]
            surf = Surface(decode(s["height"]), s["domain_size"])
            cfg.domain_size = s["domain_size"]
        elif surface == "bump":
            surf = Surface.bump(cfg.N, cfg.domain_size)
        dist = [Disturbance((0.45, 0.65), 0.12, 600.0, 100.0, 140.0, 150.0),
                Disturbance((0.45, 0.65), 0.12, -600.0, 200.0, 260.0, 20.0)]
        sim = EHCCSimulation(cfg, decode(self.fields["targets"][target]["data"]), mat, surf, dist)
        return sim, sim.run(steps)

    def compare(self, target, steps, material=None, surface=None, tol=1e-7):
        sim, logs = self.python_run(target, steps, material, surface)
        js = node("ehcc", target, steps, material or "none", surface or "flat")
        for key in ("px", "py", "d", "d_lb", "E", "e_mean", "e_std", "l2_error", "rx", "ry", "rz"):
            np.testing.assert_allclose(np.asarray(js["log"][key]), logs[key], rtol=0, atol=tol, err_msg=key)
        np.testing.assert_allclose(np.asarray(js["T"]).reshape(100, 100), sim.domain.T, rtol=0, atol=tol)

    def test_dignity_flat(self):
        self.compare("T4", 1500)

    def test_heterogeneous_halves(self):
        self.compare("T5", 800, material="halves")

    def test_scanned_surface_pose(self):
        self.compare("sole_3d", 600, surface="sole_3d")

    def test_loop1d(self):
        loop = Loop1D()
        js = node("loop1d", 20, "discrete")
        ref = loop.run_discrete(20.0)
        np.testing.assert_allclose(js["gate"], ref["gate"], atol=1e-8)
        np.testing.assert_allclose(js["gStar"], [loop.equilibrium_gate(loop.regime_disturbance(A)) for A in (0.0, 18.0, -18.0)], atol=1e-6)
        cont = node("loop1d", 20, "continuous")
        lsoda = loop.run_continuous(20.0, n_out=1001)
        # sub-stepped Euler against LSODA: the gate agrees once each regime has settled
        g_js = np.interp(lsoda["t"], cont["t"], cont["gate"])
        settled = np.isin(np.round(lsoda["t"]), [15, 35, 55, 75, 95])
        np.testing.assert_allclose(g_js[settled], lsoda["gate"][settled], atol=5e-3)


if __name__ == "__main__":
    unittest.main()
