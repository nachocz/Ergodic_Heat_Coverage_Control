# Ergodic Heat Coverage Control (EHCC)

Code and interactive pages for the paper *Ergodic Heat Coverage Control: Model-Free Robotic Regulation of Temperature Distributions*.

A robot-mounted heat source drives the temperature field `T(x, t)` of a material surface to a target distribution `T*(x)` on a region of interest `Ω_ROI`, without a thermal model of the material. EHCC closes the loop on the measured error `e = T* − T` with two decoupled controllers: an ergodic coverage controller moves the focal point `p(t)` so that the time-averaged heat footprint matches the heat deficit `e₊`, and a standoff controller sets the source-to-surface distance `d(t)`, and with it the injected power, through an integral law on the mean error. The stability analysis establishes global uniform ultimate boundedness (GUUB) of the error.

- **`ehcc/`**: Python reference implementation (numpy, scipy): the thermal plant, the two controllers, the surface frame, and the 1D loop of the stability analysis, in the notation of the paper.
- **`docs/`**: interactive pages (static HTML and JavaScript), also suitable for GitHub Pages: an overview with Fig. 1 and the video, the problem setup and notation, a closed-loop control demo in 2D and on 3D surfaces, and an animated version of the stability analysis (Fig. 5).

Video of the experiments (7 min, 20× speed): [`docs/video/ehcc_experiments.mp4`](docs/video/ehcc_experiments.mp4), also on the overview page.

## Interactive pages

| Page | Content |
|---|---|
| `index.html` | summary, Fig. 1, video of the experiments, citation |
| `problem.html` | Sec. II: `Ω`, `Ω_ROI` from `T*`, error and heat deficit, heat equation (2), actuation `q_in = P η(d) K` (3)–(4), surface frame `R_s = [t₁, t₂, n]` (5); move the heat source by hand |
| `control.html` | Secs. III–IV: ergodic law (10)–(16) and standoff law (17)–(24) in closed loop; targets T1–T5 (T4, the "dignity" shape of Fig. 2, by default), the interleaved case, and the 3D sole trial; flat, bump, wave, or scanned surface; uniform or heterogeneous material; gains; hot and cold disturbances; 2D and 3D views |
| `stability.html` | Sec. V: the 1D loop of Fig. 5 (discrete and continuous gate laws), with the three steps of the analysis: reduction to the mean error, the monotone map `ē_ss(g)` and the Lyapunov function `V(g)`, the ultimate bound with a moving-source residual, and the discrete bound on `k_I` |

To open them locally (Python standard library only):

```bash
python run.py            # serves docs/ at http://127.0.0.1:8765 and opens the browser
```

For GitHub Pages, select *Deploy from a branch*, branch `main`, folder `/docs`. The pages need no build step: KaTeX (equations) and three.js r160 (3D views) are included in `docs/vendor/`. The ♪ button plays optional background music (calm piano pieces; public domain and CC BY 4.0, see `docs/audio/CREDITS.md`), and ◐ switches between the light and dark themes.

## Python package

```bash
pip install -r requirements.txt
python examples/run_2d.py            # T4 "dignity", hot and cold disturbances -> outputs/T4/summary.png
python examples/run_3d.py            # scanned sole surface and target of the 3D trial (Sec. VII)
python examples/run_3d.py --live     # with a live Open3D window (pip install open3d)
python examples/stability_1d.py      # Fig. 5 -> outputs/ki_comparison.png
python examples/benchmark.py         # metrics of Tables II and III for EHCC
python -m unittest discover tests -v
```

```python
from ehcc import Config, EHCCSimulation, load_target

sim = EHCCSimulation(Config(), load_target("T4"))     # Omega_ROI = {T* > T_amb}
logs = sim.run(3000)                                  # 10 min of simulated time
print(logs["e_mean"][-1], logs["d_lb"][-1])
```

The tests check the model (kernel normalization, monotone actuation, heat conservation of the diffusion step, spectral coefficients, orthonormal surface frame), reproduce the EHCC row of Table II for target T4 (⟨ē⟩ = −0.11 °C, ⟨σ_e⟩ = 2.82 °C, ∫‖e‖ dt = 1.11 × 10⁵), the monotone map of Lemma 1 and the regime equilibria of Fig. 5 (g* = 0.31, 0.03, 0.66), and the behaviour of the discrete gate for k_I = 0.1 and 20. `tests/test_web_parity.py` runs the JavaScript port of the pages with Node.js (skipped without it) and checks that it gives the same logs as the package.

### Paper and code

| Paper | Code |
|---|---|
| `Ω_ROI`, `χ_ROI`, error `e` (1), heat deficit `e₊` (9), mean error `ē` (19) | `domain.Domain`, `domain.roi_mask` |
| heat equation (2), Neumann boundaries | `thermal.HeatEquation` |
| actuation `q_in = P η(d) K(x; p, d)` (3), `Q_in = P η(d)` (4) | `thermal.efficiency`, `thermal.kernel_width`, `thermal.heat_kernel` |
| surface `s(x)`, frame `R_s = [t₁, t₂, n]` (5), pose `r = s(p) + d n` | `surface.Surface` |
| heating density `Φ` (10) | `domain.Domain.heating_density` |
| basis (11), coefficients (12)–(13), ergodic metric (14)–(15), tangential law (16) | `ergodic.ErgodicController` |
| local deficit (17), standoff map (18), `d_lb` (20)–(21), gate (22) | `standoff.StandoffController` |
| closed loop (Fig. 2) and disturbances (Sec. VI-A) | `simulation.EHCCSimulation`, `thermal.Disturbance` |
| idealized loop (27), `ē_ss(g)` (28), `g*`, `V(g)` (30), discrete gate (41)–(42) | `stability.Loop1D` |

## Notes on the simulation

- The dynamics evolve on the parametric domain `Ω = [0, 1]²` (100 × 100 grid, explicit Euler steps of 0.2 s); the 3D surface changes only the pose of the end effector. Distances on the surface are normalized; `domain_size` is the side of `Ω` in metres (0.35 m, or 0.47 m for the scanned surface).
- `Ω_ROI` is the set where the target is above ambient, `T* > T_amb + 0.01 °C`, with `T_amb = min T*`. Outside `Ω_ROI` the material is an insulating backing: its coupling to the source, to the environment, and to its neighbours is reduced to 0.4.
- The default parameters (`config.yaml`) are those of the simulation benchmark: `P = 1200 W`, `η ∈ [0, 0.9]`, `σ ∈ [0.02, 0.04]`, `d ∈ [0.05, 0.45] m`, `K = 15`, `s = 1.05`, `K_g = 0.4`, `u_max = 0.1` domain lengths per second, `k_I = 0.04` (0.02 for T5 and the interleaved case), `λ = 10⁻⁴`, `κ = 0.1`, `h = 6`, and `d_lb(0) = 0.2 m`. The heterogeneous layouts use rubber (`λ = 1.2 × 10⁻⁴`, `κ = 0.03`) and metal (twice the coupling, 8/3 of the conductivity).
- The scanned surface is the height field reconstructed from the RGB-D depth points of the 3D sole trial (`assets/surfaces/sole_3d_surface.npz`), and `assets/targets/sole_3d.npy` is the target of that trial (25–31 °C).
- The controllers use only `T`, `T*`, and the surface geometry; the thermal parameters are used only by the simulated plant.

## Repository layout

```
ehcc/                 Python package (config, domain, thermal, ergodic, standoff, surface, simulation, stability, plotting, viewer3d)
examples/             run_2d.py, run_3d.py, stability_1d.py, benchmark.py, export_web_data.py
tests/                unit tests, Table II row, Fig. 5 equilibria, parity of the web port
assets/               targets T1-T5, interleaved case, 3D trial; material layouts; scanned surface
docs/                 interactive pages: html, css, js/sim (port of ehcc), js/lib, js/pages, data, img, audio, vendor
config.yaml           default parameters
run.py                local server for docs/
```

`docs/data/fields.json` holds the targets, material layouts, and scanned surface resampled to the simulation grid; regenerate it with `python examples/export_web_data.py`.

## Citation

```bibtex
@article{ehcc,
  author  = {<Author 1> and <Author 2>},
  title   = {Ergodic Heat Coverage Control: Model-Free Robotic Regulation of Temperature Distributions},
  journal = {<Journal>},
  year    = {<year>},
  volume  = {<volume>},
  number  = {<number>},
  pages   = {<pages>},
  doi     = {<doi>},
}
```

## Third-party files

- KaTeX (MIT license), `docs/vendor/katex/`.
- three.js r160 (MIT license), `docs/vendor/three/`; see the README there for the one-line change to `OrbitControls.js`.
- Background music: Erik Satie in public-domain recordings, and Kevin MacLeod (incompetech.com) under CC BY 4.0; attributions in `docs/audio/CREDITS.md`.
