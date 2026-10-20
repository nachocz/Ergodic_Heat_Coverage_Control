// EHCC closed loop in the browser: a line-by-line port of the Python package
// `ehcc` (config.py, domain.py, thermal.py, ergodic.py, standoff.py,
// surface.py, simulation.py). Equation numbers refer to the paper.
// Fields are Float64Array(N * N) indexed [iy * N + ix], y up.

// ------------------------------------------------------------------ parameters (config.py)
export function defaultConfig() {
    return {
        dt: 0.2, N: 100, domainSize: 0.35,
        heater: { P: 1200, etaMax: 0.9, etaMin: 0.0, sigmaMin: 0.02, sigmaMax: 0.04, Tsource: 150 },
        standoff: { dMin: 0.05, dMax: 0.45, kI: 0.04, dlb0: 0.2 },
        ergodic: { K: 15, s: 1.05, Kg: 0.4, uMax: 0.1, p0: [0.25, 0.35] },
        thermal: { lam: 1.0e-4, kappa: 0.1, h: 6.0, outsideCoupling: 0.4, roiThreshold: 0.01 },
    };
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ------------------------------------------------------------------ actuation model (thermal.py)
export function ratio(d, dMin, dMax) {
    const span = dMax - dMin;
    return span < 1e-12 ? 0 : clamp((d - dMin) / span, 0, 1);
}
export const efficiency = (d, heater, dMin, dMax) => heater.etaMax + (heater.etaMin - heater.etaMax) * ratio(d, dMin, dMax);
export const kernelWidth = (d, heater, dMin, dMax) => heater.sigmaMin + (heater.sigmaMax - heater.sigmaMin) * ratio(d, dMin, dMax);

// exp(-(x - c)^2 / (2 sigma^2)) on the N grid nodes of [0, 1].
export function profile1d(N, c, sigma, out = new Float64Array(N)) {
    const s2 = 2 * sigma * sigma;
    let sum = 0;
    for (let i = 0; i < N; i++) { const x = i / (N - 1) - c; out[i] = Math.exp(-(x * x) / s2); sum += out[i]; }
    out.sum = sum;
    return out;
}

// K(x; p, sigma) = gx(x) gy(y) / norm with sum(K) dx^2 = 1 (separable Gaussian).
export function kernelFactors(N, p, sigma) {
    const gx = profile1d(N, p[0], sigma), gy = profile1d(N, p[1], sigma);
    return { gx, gy, norm: gx.sum * gy.sum / ((N - 1) * (N - 1)) };
}

// ------------------------------------------------------------------ domain (domain.py)
export class Domain {
    constructor(Tstar, { lam = 1.0e-4, kappa = 0.1, metal = null, metalRatio = null, roiThreshold = 0.01,
        outsideCoupling = 0.4, valid = null } = {}) {
        const n2 = Tstar.length, N = Math.round(Math.sqrt(n2));
        this.N = N; this.dx = 1 / (N - 1);
        this.Tstar = Float64Array.from(Tstar);
        let Tamb = Infinity, Tmax = -Infinity;
        for (const v of this.Tstar) { if (v < Tamb) Tamb = v; if (v > Tmax) Tmax = v; }
        this.Tamb = Tamb; this.Tmax = Tmax;
        this.roi = new Uint8Array(n2);
        const idx = [];
        for (let i = 0; i < n2; i++) {
            this.roi[i] = this.Tstar[i] > Tamb + roiThreshold && (!valid || valid[i]) ? 1 : 0;
            if (this.roi[i]) idx.push(i);
        }
        this.roiIndex = Int32Array.from(idx);
        this.setProperties({ lam, kappa, metal, metalRatio, outsideCoupling });
        this.eMax = Math.max(1, Tmax - Tamb);        // (18)
        this.T = new Float64Array(n2).fill(Tamb);
        this.Phi = new Float64Array(n2);
    }

    // lambda(x), kappa(x): uniform, or rubber/metal mixed by the metal fraction m(x);
    // the coupling outside the ROI is reduced (insulating backing).
    setProperties({ lam, kappa, metal = null, metalRatio = null, outsideCoupling }) {
        const n2 = this.Tstar.length;
        this.lam = new Float64Array(n2); this.kappa = new Float64Array(n2);
        this.coupling = new Float64Array(n2);
        this.lamc = new Float64Array(n2);            // lambda * coupling
        this.alpha = new Float64Array(n2);           // diffusivity, reduced outside the ROI
        for (let i = 0; i < n2; i++) {
            const m = metal ? metal[i] : 0;
            this.lam[i] = lam * (1 + m * ((metalRatio?.lam ?? 1) - 1));
            this.kappa[i] = kappa * (1 + m * ((metalRatio?.kappa ?? 1) - 1));
            this.coupling[i] = this.roi[i] ? 1 : outsideCoupling;
            this.lamc[i] = this.lam[i] * this.coupling[i];
            this.alpha[i] = this.lam[i] * this.kappa[i] * this.coupling[i];
        }
    }

    meanError() {                                    // e_bar (19)
        let s = 0;
        for (const i of this.roiIndex) s += this.Tstar[i] - this.T[i];
        return this.roiIndex.length ? s / this.roiIndex.length : 0;
    }

    // Phi (10), unit sum; uniform when no deficit is left.
    heatingDensity() {
        const { Phi, T, Tstar, roi } = this;
        let total = 0;
        for (let i = 0; i < Phi.length; i++) {
            const e = roi[i] ? Tstar[i] - T[i] : 0;
            Phi[i] = e > 0 ? e : 0;
            total += Phi[i];
        }
        if (total <= 0) Phi.fill(1 / Phi.length);
        else for (let i = 0; i < Phi.length; i++) Phi[i] /= total;
        return Phi;
    }

    metrics() {
        let s = 0, s2 = 0, sp = 0;
        const n = this.roiIndex.length || 1;
        for (const i of this.roiIndex) {
            const e = this.Tstar[i] - this.T[i];
            s += e; s2 += e * e; sp += e > 0 ? e : 0;
        }
        const mean = s / n;
        return {
            e_mean: mean, e_std: Math.sqrt(Math.max(s2 / n - mean * mean, 0)), e_rms: Math.sqrt(s2 / n),
            e_plus_mean: sp / n, l2_error: s2 * this.dx * this.dx,
        };
    }

    sample(field, p) {                               // bilinear
        const N = this.N, gx = p[0] * (N - 1), gy = p[1] * (N - 1);
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const x1 = Math.min(x0 + 1, N - 1), y1 = Math.min(y0 + 1, N - 1);
        const wx = gx - x0, wy = gy - y0;
        return (1 - wx) * (1 - wy) * field[y0 * N + x0] + wx * (1 - wy) * field[y0 * N + x1]
            + (1 - wx) * wy * field[y1 * N + x0] + wx * wy * field[y1 * N + x1];
    }

    inRoi(p) {
        const N = this.N;
        const ix = clamp(Math.floor(p[0] * (N - 1) + 0.5), 0, N - 1), iy = clamp(Math.floor(p[1] * (N - 1) + 0.5), 0, N - 1);
        return this.roi[iy * N + ix] === 1;
    }
}

// ------------------------------------------------------------------ heat equation (thermal.py)
export class HeatEquation {
    constructor(domain, heater, h) {
        this.domain = domain; this.heater = heater; this.h = h;
        this.refresh();
        this.div = new Float64Array(domain.N * domain.N);
    }

    // Face diffusivities from domain.alpha (after Domain.setProperties).
    refresh() {
        const { N, alpha } = this.domain;
        this.ax = new Float64Array(N * (N - 1));     // faces between columns, [iy * (N - 1) + ix]
        this.ay = new Float64Array((N - 1) * N);     // faces between rows, [iy * N + ix]
        for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N - 1; ix++)
            this.ax[iy * (N - 1) + ix] = 0.5 * (alpha[iy * N + ix] + alpha[iy * N + ix + 1]);
        for (let iy = 0; iy < N - 1; iy++) for (let ix = 0; ix < N; ix++)
            this.ay[iy * N + ix] = 0.5 * (alpha[iy * N + ix] + alpha[(iy + 1) * N + ix]);
    }

    // lambda q_in with q_in = amplitude * gx gy / norm, times the absorbed fraction.
    heat(amplitude, k, dt) {
        const { N, T, lamc } = this.domain;
        const Ts = this.heater.Tsource, span = Math.max(Ts - this.domain.Tamb, 1e-9);
        const a = amplitude / k.norm * dt;
        for (let iy = 0; iy < N; iy++) {
            const fy = a * k.gy[iy];
            if (fy < 1e-300) continue;
            for (let ix = 0; ix < N; ix++) {
                const i = iy * N + ix;
                const absorbed = Math.max(Ts - T[i], 0) / span;
                T[i] += lamc[i] * fy * k.gx[ix] * absorbed;
            }
        }
    }

    lose(dt) {
        const { T, lamc, Tamb } = this.domain, h = this.h;
        for (let i = 0; i < T.length; i++) {
            T[i] -= lamc[i] * h * (T[i] - Tamb) * dt;
            if (T[i] < Tamb) T[i] = Tamb;
        }
    }

    diffuse(dt) {
        const { N, T, dx } = this.domain, { ax, ay, div } = this;
        div.fill(0);
        for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N - 1; ix++) {
            const i = iy * N + ix, f = ax[iy * (N - 1) + ix] * (T[i + 1] - T[i]);
            div[i] += f; div[i + 1] -= f;
        }
        for (let iy = 0; iy < N - 1; iy++) for (let ix = 0; ix < N; ix++) {
            const i = iy * N + ix, f = ay[i] * (T[i + N] - T[i]);
            div[i] += f; div[i + N] -= f;
        }
        const c = dt / (dx * dx);
        for (let i = 0; i < T.length; i++) T[i] += div[i] * c;
    }

    // Hot sources heat like the heater; cold sinks extract heat in proportion to T - T_amb.
    disturb(disturbances, t, dt) {
        const D = this.domain, { N, T, lamc, Tamb } = D;
        for (const dist of disturbances) {
            if (!(dist.tStart <= t && t <= dist.tEnd)) continue;
            const k = kernelFactors(N, dist.center, dist.sigma);
            let tmax = -Infinity;
            if (dist.P < 0) for (const v of T) if (v > tmax) tmax = v;
            const span = dist.P >= 0 ? Math.max(dist.Tsource - Tamb, 1e-9) : Math.max(tmax - Tamb, 1);
            const a = dist.P / k.norm * dt;
            for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
                const i = iy * N + ix;
                const absorbed = dist.P >= 0 ? Math.max(dist.Tsource - T[i], 0) / span : Math.max(T[i] - Tamb, 0) / span;
                T[i] += lamc[i] * a * k.gx[ix] * k.gy[iy] * absorbed;
            }
        }
    }
}

// ------------------------------------------------------------------ ergodic controller (ergodic.py)
export class ErgodicController {
    constructor(cfg, N, dt) {
        this.cfg = cfg; this.N = N; this.dt = dt;
        const K = cfg.K;
        this.K = K;
        this.Lambda = new Float64Array(K * K);
        for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) this.Lambda[a * K + b] = (1 + a * a + b * b) ** -cfg.s;
        this.C = new Float64Array(K * N);             // cos(k pi x_i)
        for (let k = 0; k < K; k++) for (let i = 0; i < N; i++) this.C[k * N + i] = Math.cos(Math.PI * k * i / (N - 1));
        this.phi = new Float64Array(K * K);
        this.A = new Float64Array(N * K);
        this.cx = new Float64Array(K); this.sx = new Float64Array(K);
        this.cy = new Float64Array(K); this.sy = new Float64Array(K);
        this.reset();
    }

    reset() {
        const K2 = this.K * this.K;
        this.cSum = new Float64Array(K2); this.c = new Float64Array(K2);
        this.t = this.dt;
    }

    // phi[k1, k2] = sum_iy sum_ix cos(k1 pi x) cos(k2 pi y) Phi[iy, ix]   (12)
    setTarget(Phi) {
        const { N, K, C, A, phi } = this;
        for (let iy = 0; iy < N; iy++) for (let k1 = 0; k1 < K; k1++) {
            let s = 0;
            const row = iy * N, ck = k1 * N;
            for (let ix = 0; ix < N; ix++) s += Phi[row + ix] * C[ck + ix];
            A[iy * K + k1] = s;
        }
        for (let k1 = 0; k1 < K; k1++) for (let k2 = 0; k2 < K; k2++) {
            let s = 0;
            for (let iy = 0; iy < N; iy++) s += C[k2 * N + iy] * A[iy * K + k1];
            phi[k1 * K + k2] = s;
        }
    }

    trig(p) {
        for (let k = 0; k < this.K; k++) {
            this.cx[k] = Math.cos(Math.PI * k * p[0]); this.sx[k] = Math.sin(Math.PI * k * p[0]);
            this.cy[k] = Math.cos(Math.PI * k * p[1]); this.sy[k] = Math.sin(Math.PI * k * p[1]);
        }
    }

    metric() {                                       // E(t) (14)
        let s = 0;
        for (let i = 0; i < this.c.length; i++) { const d = this.c[i] - this.phi[i]; s += this.Lambda[i] * d * d; }
        return s;
    }

    control(p) {                                     // u_tau (16), saturated at u_max
        const { K, cx, sx, cy, sy } = this;
        this.trig(p);
        let ux = 0, uy = 0;
        for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) {
            const i = a * K + b, w = this.Lambda[i] * (this.c[i] - this.phi[i]);
            ux += w * (-Math.PI * a * sx[a] * cy[b]);
            uy += w * (-Math.PI * b * cx[a] * sy[b]);
        }
        let u = [-this.cfg.Kg * ux, -this.cfg.Kg * uy];
        const norm = Math.hypot(u[0], u[1]);
        if (norm > this.cfg.uMax) u = [u[0] * this.cfg.uMax / norm, u[1] * this.cfg.uMax / norm];
        return u;
    }

    step(p) {                                        // (13), then (16)
        const { K, cx, cy } = this;
        this.trig(p);
        this.t += this.dt;
        for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) {
            const i = a * K + b;
            this.cSum[i] += cx[a] * cy[b] * this.dt;
            this.c[i] = this.cSum[i] / this.t;
        }
        return { u: this.control(p), E: this.metric() };
    }
}

// ------------------------------------------------------------------ standoff controller (standoff.py)
export class StandoffController {
    constructor(cfg) { this.cfg = cfg; this.reset(); }

    reset() {
        const c = this.cfg;
        this.dlb = c.dlb0 == null ? c.dMin : clamp(c.dlb0, c.dMin, c.dMax);
        this.d = c.dMax; this.ep = 0;
    }

    get gate() { return (this.cfg.dMax - this.dlb) / (this.cfg.dMax - this.cfg.dMin); }     // (22)

    update(domain, p, dt) {
        const c = this.cfg;
        this.dlb = clamp(this.dlb - c.kI * domain.meanError() * dt, c.dMin, c.dMax);       // (21)
        this.ep = domain.inRoi(p) ? Math.max(domain.sample(domain.Tstar, p) - domain.sample(domain.T, p), 0) : 0;   // (17)
        this.d = c.dMax - (c.dMax - this.dlb) * Math.min(this.ep / domain.eMax, 1);          // (18)
        return this.d;
    }
}

// ------------------------------------------------------------------ surface (surface.py)
export class Surface {
    constructor(height, domainSize = 0.35, valid = null, name = 'surface') {
        this.height = Float64Array.from(height);
        this.N = Math.round(Math.sqrt(height.length));
        this.L = domainSize; this.valid = valid; this.name = name;
        const N = this.N, hstep = this.L / (N - 1);
        this.dzdx = new Float64Array(N * N); this.dzdy = new Float64Array(N * N);
        // numpy.gradient: central differences inside, one-sided at the edges
        for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
            const i = iy * N + ix, z = this.height;
            this.dzdx[i] = ix === 0 ? (z[i + 1] - z[i]) / hstep : ix === N - 1 ? (z[i] - z[i - 1]) / hstep : (z[i + 1] - z[i - 1]) / (2 * hstep);
            this.dzdy[i] = iy === 0 ? (z[i + N] - z[i]) / hstep : iy === N - 1 ? (z[i] - z[i - N]) / hstep : (z[i + N] - z[i - N]) / (2 * hstep);
        }
    }

    static flat(N = 100, L = 0.35) { return new Surface(new Float64Array(N * N), L, null, 'flat'); }

    static bump(N = 100, L = 0.35, amplitude = 0.05, sigma = 0.18, c = [0.5, 0.5]) {
        const z = new Float64Array(N * N);
        for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
            const x = ix / (N - 1) - c[0], y = iy / (N - 1) - c[1];
            z[iy * N + ix] = amplitude * Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
        }
        return new Surface(z, L, null, 'bump');
    }

    static wave(N = 100, L = 0.35, amplitude = 0.02, frequency = 1) {
        const z = new Float64Array(N * N);
        for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++)
            z[iy * N + ix] = amplitude * Math.sin(2 * Math.PI * frequency * ix / (N - 1)) * Math.sin(2 * Math.PI * frequency * iy / (N - 1));
        return new Surface(z, L, null, 'wave');
    }

    bilinear(field, p) {
        const N = this.N, gx = clamp(p[0], 0, 1) * (N - 1), gy = clamp(p[1], 0, 1) * (N - 1);
        const x0 = Math.min(Math.floor(gx), N - 2), y0 = Math.min(Math.floor(gy), N - 2);
        const wx = gx - x0, wy = gy - y0, i = y0 * N + x0;
        return (1 - wx) * (1 - wy) * field[i] + wx * (1 - wy) * field[i + 1] + (1 - wx) * wy * field[i + N] + wx * wy * field[i + N + 1];
    }

    point(p) { return [p[0] * this.L, p[1] * this.L, this.bilinear(this.height, p)]; }

    // R_s(p) = [t1, t2, n] as three column vectors (5).
    frame(p) {
        const zx = this.bilinear(this.dzdx, p), zy = this.bilinear(this.dzdy, p);
        let n = [-zx, -zy, 1];
        const nn = Math.hypot(...n); n = n.map((v) => v / nn);
        let t1 = [1, 0, zx];
        const dot = t1[0] * n[0] + t1[1] * n[1] + t1[2] * n[2];
        t1 = t1.map((v, i) => v - dot * n[i]);
        const tn = Math.hypot(...t1); t1 = t1.map((v) => v / tn);
        const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
        return { t1, t2, n };
    }

    pose(p, d) {                                     // r = s(p) + d n
        const R = this.frame(p), s = this.point(p);
        return { r: s.map((v, i) => v + d * R.n[i]), R, s };
    }
}

// ------------------------------------------------------------------ closed loop (simulation.py)
export const LOG_KEYS = ['t', 'px', 'py', 'd', 'd_lb', 'gate', 'eta', 'Q_in', 'e_p', 'E',
    'e_mean', 'e_std', 'e_rms', 'e_plus_mean', 'l2_error', 'rx', 'ry', 'rz'];

export class EHCCSimulation {
    // material: {metal: Float64Array (metal fraction), ratio: {lam, kappa}} or null.
    constructor(cfg, Tstar, { material = null, surface = null, disturbances = [] } = {}) {
        this.cfg = cfg;
        const th = cfg.thermal;
        this.surface = surface || Surface.flat(cfg.N, cfg.domainSize);
        this.domain = new Domain(Tstar, {
            lam: th.lam, kappa: th.kappa, metal: material?.metal ?? null, metalRatio: material?.ratio ?? null,
            roiThreshold: th.roiThreshold, outsideCoupling: th.outsideCoupling, valid: this.surface.valid,
        });
        this.heat = new HeatEquation(this.domain, cfg.heater, th.h);
        this.standoff = new StandoffController(cfg.standoff);
        this.ergodic = new ErgodicController(cfg.ergodic, cfg.N, cfg.dt);
        this.disturbances = disturbances;
        this.p = [...cfg.ergodic.p0];
        this.k = 0; this.t = 0;
        this.last = null;
    }

    step() {
        const { cfg, domain: D } = this, s = cfg.standoff;
        this.k += 1;
        this.t = this.k * cfg.dt;
        const d = this.standoff.update(D, this.p, cfg.dt);
        const eta = efficiency(d, cfg.heater, s.dMin, s.dMax);
        const sigma = kernelWidth(d, cfg.heater, s.dMin, s.dMax);
        const kern = kernelFactors(cfg.N, this.p, sigma);
        this.heat.heat(cfg.heater.P * eta, kern, cfg.dt);
        this.heat.lose(cfg.dt);
        this.heat.diffuse(cfg.dt);
        this.heat.disturb(this.disturbances, this.t, cfg.dt);
        this.ergodic.setTarget(D.heatingDensity());
        const { u, E } = this.ergodic.step(this.p);
        const pNow = this.p;
        this.p = [clamp(pNow[0] + u[0] * cfg.dt, 0.01, 0.99), clamp(pNow[1] + u[1] * cfg.dt, 0.01, 0.99)];
        const { r } = this.surface.pose(pNow, d);
        this.last = {
            t: this.t, px: pNow[0], py: pNow[1], d, d_lb: this.standoff.dlb, gate: this.standoff.gate, eta,
            Q_in: cfg.heater.P * eta, e_p: this.standoff.ep, E, rx: r[0], ry: r[1], rz: r[2],
            sigma, u, ...D.metrics(),
        };
        return this.last;
    }
}

// ------------------------------------------------------------------ data (docs/data/fields.json)
export function decodeFloat32(b64) {
    const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return Float64Array.from(new Float32Array(bytes.buffer));
}

// Targets, material layouts, and the scanned surface, decoded.
export function decodeFields(raw) {
    const out = { N: raw.N, targets: {}, materials: {}, surfaces: {}, rubber: raw.rubber, metal: raw.metal };
    for (const [k, v] of Object.entries(raw.targets)) out.targets[k] = { ...v, data: decodeFloat32(v.data) };
    for (const [k, v] of Object.entries(raw.materials)) out.materials[k] = { metal: decodeFloat32(v.metal_fraction) };
    for (const [k, v] of Object.entries(raw.surfaces)) out.surfaces[k] = { ...v, height: decodeFloat32(v.height) };
    return out;
}

// Analytic targets (domain.py: gaussian_target, ring_target).
export function analyticTarget(kind, N = 100, Tamb = 20) {
    const T = new Float64Array(N * N);
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
        const x = ix / (N - 1) - 0.5, y = iy / (N - 1) - 0.5;
        let g;
        if (kind === 'ring') { const r = Math.hypot(x, y) - 0.3; g = 8 * Math.exp(-(r * r) / (2 * 0.07 * 0.07)); g = g > 0.4 ? g : 0; }
        else { g = Math.exp(-(x * x + y * y) / (2 * 0.15 * 0.15)); g = g > 0.05 ? 10 * g : 0; }
        T[iy * N + ix] = Tamb + g;
    }
    return T;
}
