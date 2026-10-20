// Idealized 1D loop of the stability analysis (Sec. V, Fig. 4): port of ehcc/stability.py.
//   dT/dt = alpha T'' - h (T - T_amb) + g k_p e_+ + D_ext,    dg/dt = k_I e_bar,  g in [0, 1].
// The "continuous" mode integrates the same equations with sub-steps small enough
// that k_I dt is negligible, as a stand-in for the adaptive ODE solver of the paper.

export const REGIMES = [
    { t0: 0, t1: 20, A: 0, name: 'start-up' }, { t0: 20, t1: 40, A: 18, name: 'hot disturbance' },
    { t0: 40, t1: 60, A: 0, name: 'recovery' }, { t0: 60, t1: 80, A: -18, name: 'cold disturbance' },
    { t0: 80, t1: 100, A: 0, name: 'recovery' },
];

export class Loop1D {
    constructor({ N = 201, roi = [0.2, 0.6], Tamb = 20, Tsource = 100, alpha = 1e-3, h = 0.5, kp = 20, tEnd = 100,
        steps = [[0.2, 0.3, 80], [0.3, 0.6, 30]],
        pulses = [{ t0: 30, A: 18 }, { t0: 70, A: -18 }], x0 = 0.4, sigmaX = 0.1, halfWidth = 10, sigmaEdge = 0.5 } = {}) {
        Object.assign(this, { N, roi, Tamb, Tsource, alpha, h, kp, tEnd, x0, sigmaX, halfWidth, sigmaEdge });
        this.pulses = pulses.map((p) => ({ ...p }));
        this.x = Float64Array.from({ length: N }, (_, i) => i / (N - 1));
        this.dx = 1 / (N - 1);
        this.mask = new Uint8Array(N);
        this.Tstar = new Float64Array(N).fill(NaN);
        const idx = [];
        for (let i = 0; i < N; i++) {
            const xi = this.x[i];
            this.mask[i] = xi >= roi[0] && xi <= roi[1] ? 1 : 0;
            if (this.mask[i]) idx.push(i);
            for (const [lo, hi, v] of steps) if (xi >= lo && (hi < roi[1] ? xi < hi : xi <= hi)) this.Tstar[i] = v;
        }
        this.roiIndex = Int32Array.from(idx);
        this.shape = Float64Array.from(this.x, (xi) => Math.exp(-(((xi - x0) / sigmaX) ** 2)));
    }

    envelope(pulse, t) {
        const edge = Math.max(0, Math.abs(t - pulse.t0) - this.halfWidth);
        return Math.exp(-((edge / this.sigmaEdge) ** 2));
    }

    disturbance(t, out = new Float64Array(this.N)) {
        out.fill(0);
        for (const p of this.pulses) {
            const a = p.A * this.envelope(p, t);
            if (Math.abs(a) < 1e-14) continue;
            for (let i = 0; i < this.N; i++) out[i] += a * this.shape[i];
        }
        return out;
    }

    regimeDisturbance(A) { return Float64Array.from(this.shape, (s) => A * s); }

    meanError(T) {
        let s = 0;
        for (const i of this.roiIndex) s += this.Tstar[i] - T[i];
        return s / this.roiIndex.length;
    }

    ePlus(T, i) { return this.mask[i] ? Math.max(this.Tstar[i] - T[i], 0) : 0; }

    // ---------------------------------------------------------------- steady state (Lemma 1)
    // T_g: 0 = alpha T'' - h (T - T_amb) + g k_p e_+(T) + D, by semi-smooth Newton steps
    // with a tridiagonal (Thomas) solve.
    equilibrium(g, D = null) {
        const { N, alpha, h, kp, Tamb } = this, c = alpha / (this.dx * this.dx);
        const T = new Float64Array(N).fill(Tamb), F = new Float64Array(N);
        const a = new Float64Array(N), b = new Float64Array(N), cc = new Float64Array(N);
        const cp = new Float64Array(N), dp = new Float64Array(N);
        for (let it = 0; it < 50; it++) {
            for (let i = 0; i < N; i++) {
                const lap = i === 0 ? 2 * (T[1] - T[0]) : i === N - 1 ? 2 * (T[N - 2] - T[N - 1]) : T[i + 1] - 2 * T[i] + T[i - 1];
                const active = this.mask[i] && this.Tstar[i] > T[i];
                F[i] = c * lap - h * (T[i] - Tamb) + g * kp * this.ePlus(T, i) + (D ? D[i] : 0);
                b[i] = -2 * c - h - (active ? g * kp : 0);
                a[i] = i === 0 ? 0 : i === N - 1 ? 2 * c : c;          // sub-diagonal
                cc[i] = i === N - 1 ? 0 : i === 0 ? 2 * c : c;         // super-diagonal
            }
            cp[0] = cc[0] / b[0]; dp[0] = F[0] / b[0];
            for (let i = 1; i < N; i++) {
                const m = b[i] - a[i] * cp[i - 1];
                cp[i] = cc[i] / m; dp[i] = (F[i] - a[i] * dp[i - 1]) / m;
            }
            let worst = 0;
            for (let i = N - 1; i >= 0; i--) {
                const step = i === N - 1 ? dp[i] : dp[i] - cp[i] * dp[i + 1];
                dp[i] = step;
                T[i] -= step;
                worst = Math.max(worst, Math.abs(step));
            }
            if (worst < 1e-10) break;
        }
        return T;
    }

    eSs(g, D = null) { return this.meanError(this.equilibrium(g, D)); }           // (28)

    equilibriumGate(D = null) {                                                  // g*: e_ss(g*) = 0
        let lo = 0, hi = 1;
        if (this.eSs(lo, D) <= 0) return 0;
        if (this.eSs(hi, D) >= 0) return 1;
        while (hi - lo > 1e-9) { const mid = 0.5 * (lo + hi); if (this.eSs(mid, D) > 0) lo = mid; else hi = mid; }
        return 0.5 * (lo + hi);
    }

    slope(g, D = null, delta = 1e-4) {
        const a = Math.max(g - delta, 0), b = Math.min(g + delta, 1);
        return (this.eSs(b, D) - this.eSs(a, D)) / (b - a);
    }

    // e_ss on a grid of g, and V(g) = -int_{g*}^{g} e_ss (30) by the trapezoidal rule.
    map(D = null, n = 101) {
        const g = Float64Array.from({ length: n }, (_, i) => i / (n - 1));
        const e = Float64Array.from(g, (gi) => this.eSs(gi, D));
        const cum = new Float64Array(n);
        for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + 0.5 * (e[i] + e[i - 1]) * (g[i] - g[i - 1]);
        const gStar = this.equilibriumGate(D);
        const at = (x) => { const j = Math.min(n - 2, Math.floor(x * (n - 1))), w = x * (n - 1) - j; return cum[j] * (1 - w) + cum[j + 1] * w; };
        const c0 = at(gStar);
        return { g, e, V: Float64Array.from(cum, (v) => -(v - c0)), gStar, slope: this.slope(gStar, D) };
    }

    // ---------------------------------------------------------------- transient runs
    // Moving-source residual (Step 3): instead of heating all of Omega_ROI at once, the
    // heating g k_p e_+ is concentrated around a point x_c(t) that sweeps Omega_ROI with
    // period tau: q = g k_p e_+ S(x, t), with S = G(x - x_c(t)) / <G>_tau, so that the time
    // average of S over a sweep is 1 and the residual q - g k_p e_+ averages out.
    sweep(tau, width = 0.05) {
        const [a, b] = this.roi, n = 400;
        const xc = (t) => a + (b - a) * 0.5 * (1 - Math.cos(2 * Math.PI * t / tau));
        const mean = new Float64Array(this.N);
        for (let j = 0; j < n; j++) {
            const c = xc(j / n * tau);
            for (let i = 0; i < this.N; i++) mean[i] += Math.exp(-(((this.x[i] - c) / width) ** 2)) / n;
        }
        return { tau, width, xc, mean };
    }

    // Explicit Euler with step dt (41), or with dt/m sub-steps ("continuous").
    // A generator: yields the progress in [0, 1] every `chunk` steps of dt, returns the series.
    *runner(kI, { continuous = false, dt = 0.01, g0 = 1, snapEvery = 10, disturbances = true, tauErg = 0, chunk = 250 } = {}) {
        const { N, alpha, h, kp, Tamb, Tsource } = this;
        const m = continuous ? Math.max(1, Math.ceil(kI * dt / 0.004)) : 1;
        const ds = dt / m, c = alpha / (this.dx * this.dx);
        const n = Math.round(this.tEnd / dt);
        const sweep = tauErg > 0 ? this.sweep(tauErg) : null;
        const out = { t: new Float64Array(n), gate: new Float64Array(n), eMean: new Float64Array(n), Qin: new Float64Array(n),
            eNorm: new Float64Array(n), ePerp: new Float64Array(n), xc: new Float64Array(n),
            snaps: [], snapTimes: [], dt, substeps: m, kI, continuous, tauErg };
        let T = new Float64Array(N).fill(Tamb), Tn = new Float64Array(N);
        const q = new Float64Array(N), Dx = new Float64Array(N);
        let g = g0;
        const w = this.dx, nRoi = this.roiIndex.length;
        for (let k = 0; k < n; k++) {
            let eBar = 0;
            for (let j = 0; j < m; j++) {
                const t = k * dt + j * ds;
                eBar = this.meanError(T);
                if (disturbances) this.disturbance(t, Dx); else Dx.fill(0);
                const xc = sweep ? sweep.xc(t) : 0;
                for (let i = 0; i < N; i++) {
                    let qi = g * kp * this.ePlus(T, i);
                    if (sweep) qi *= Math.exp(-(((this.x[i] - xc) / sweep.width) ** 2)) / Math.max(sweep.mean[i], 1e-6);
                    if (!continuous) qi = Math.min(qi, Math.max((Tsource - T[i]) / ds, 0));   // no overshoot of T_source in one step
                    q[i] = qi;
                    const lap = i === 0 ? 2 * (T[1] - T[0]) : i === N - 1 ? 2 * (T[N - 2] - T[N - 1]) : T[i + 1] - 2 * T[i] + T[i - 1];
                    Tn[i] = T[i] + ds * (c * lap - h * (T[i] - Tamb) + qi + Dx[i]);
                }
                [T, Tn] = [Tn, T];
                g = Math.min(1, Math.max(0, g + kI * eBar * ds));
            }
            let Q = 0, s2 = 0, sp = 0;
            const eb = this.meanError(T);
            for (let r = 0; r < nRoi; r++) {
                const i = this.roiIndex[r], e = this.Tstar[i] - T[i];
                s2 += e * e * w; sp += (e - eb) * (e - eb) * w;
                if (r) Q += 0.5 * (q[i] + q[this.roiIndex[r - 1]]) * w;
            }
            out.t[k] = (k + 1) * dt; out.gate[k] = g; out.eMean[k] = eBar; out.Qin[k] = Q;
            out.eNorm[k] = Math.sqrt(s2); out.ePerp[k] = Math.sqrt(sp); out.xc[k] = sweep ? sweep.xc(k * dt) : NaN;
            if (k % snapEvery === 0 || k === n - 1) { out.snaps.push(Float32Array.from(T)); out.snapTimes.push((k + 1) * dt); }
            if (k % chunk === chunk - 1) yield (k + 1) / n;
        }
        out.roiMeasure = nRoi * w;                    // |Omega_ROI| in the same quadrature
        return out;
    }

    run(kI, options = {}) {
        const it = this.runner(kI, options);
        for (;;) { const r = it.next(); if (r.done) return r.value; }
    }
}
