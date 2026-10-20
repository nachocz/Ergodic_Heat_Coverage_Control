// Stability analysis: the idealized 1D loop of Fig. 5, and the three steps of Sec. V.
import { LinePlot } from '../lib/plot.js';
import { initPage } from '../lib/shell.js';
import { alpha, onThemeChange, palette } from '../lib/theme.js';
import { renderMath } from '../lib/math.js';
import { button, card, control, fmt, h, label, readouts, segmented, seriesLegend, slider, toggle } from '../lib/ui.js';
import { Loop1D, REGIMES } from '../sim/loop1d.js';

await initPage();
const loop = new Loop1D();
const DT = 0.01;

// ------------------------------------------------------------------ steady-state maps per regime (Lemma 1)
const maps = { 0: loop.map(null), 18: loop.map(loop.regimeDisturbance(18)), '-18': loop.map(loop.regimeDisturbance(-18)) };
const mapOf = (A) => maps[A];
let mE = Infinity;                                     // uniform slope bound m_e (29) of the undisturbed map
for (let i = 1; i < maps[0].g.length; i++) mE = Math.min(mE, -(maps[0].e[i] - maps[0].e[i - 1]) / (maps[0].g[i] - maps[0].g[i - 1]));
const regimeAt = (t) => REGIMES.find((r) => t <= r.t1) ?? REGIMES[REGIMES.length - 1];
const interp = (xs, ys, x) => {
    const n = xs.length, u = Math.min(Math.max((x - xs[0]) / (xs[n - 1] - xs[0]), 0), 1) * (n - 1), j = Math.min(n - 2, Math.floor(u)), w = u - j;
    return ys[j] * (1 - w) + ys[j + 1] * w;
};
const muTh = loop.alpha / ((loop.roi[1] - loop.roi[0]) / Math.PI) ** 2 + loop.h;     // mu_0 (32) of the 1D loop

// ------------------------------------------------------------------ state
const state = { kI: 0.1, continuous: false, disturbances: true, tauErg: 0, g0: 1, playing: false, time: 0, speed: 4, tab: 'step1' };
let run = null, compare = null, token = 0;
const derived = {};

// ------------------------------------------------------------------ controls
const mainCard = card('Idealized 1D loop (Sec. V-B, Fig. 5)', '');
const playButton = button('▶ Play', () => setPlaying(!state.playing), { primary: true });
const restartButton = button('Restart', () => { state.time = 0; setPlaying(true); });
const timeSlider = slider({ label: 'time $t$', min: 0, max: 100, step: 0.01, value: 0, format: (v) => `${v.toFixed(1)} s`,
    onInput: (v) => { state.time = v; setPlaying(false); draw(); } });
timeSlider.el.style.cssText = 'flex:1;min-width:220px;margin:0';
const speedSeg = segmented({ options: [{ value: 1, label: '1×' }, { value: 4, label: '4×' }, { value: 10, label: '10×' }], value: state.speed, onChange: (v) => { state.speed = v; } });
const progress = h('div', { class: 'progress', style: 'margin-top:8px' }, h('i'));
const modeSeg = segmented({ options: [{ value: false, label: 'discrete (41)' }, { value: true, label: 'continuous (24)' }], value: false,
    onChange: (v) => { state.continuous = v; recompute(); } });
const kISlider = slider({ label: 'integral gain $k_I$', min: 0.01, max: 50, log: true, value: state.kI, format: (v) => (v < 1 ? v.toFixed(3) : v.toFixed(1)),
    onChange: (v) => { state.kI = v; recompute(); } });
const g0Slider = slider({ label: 'initial gate $g(0)$', min: 0, max: 1, step: 0.01, value: state.g0, onChange: (v) => { state.g0 = v; recompute(); } });
const tauSlider = slider({ label: 'sweep period $\\tau_{\\mathrm{erg}}$ of a moving source', description: '0: ideal distributed heating (27). $\\tau_{\\mathrm{th}}=1/\\mu_0\\approx' + (1 / muTh).toFixed(1) + '$ s (32).',
    min: 0, max: 2, step: 0.05, value: 0, format: (v) => (v === 0 ? 'ideal' : `${v.toFixed(2)} s`), onChange: (v) => { state.tauErg = v; recompute(); } });
const distToggle = toggle({ label: 'hot and cold disturbances $D_{\\mathrm{ext}}$', value: true, onChange: (v) => { state.disturbances = v; recompute(); } });
const compareButton = button('Compare the four cases (Fig. 5)', () => computeCompare(), { small: true });
mainCard.body.append(
    h('div', { class: 'toolbar' }, playButton, restartButton, h('span', { class: 'hint' }, 'speed'), speedSeg.el, h('span', { class: 'toolbar-divider' }), timeSlider.el),
    progress,
    h('div', { class: 'two-col', style: 'gap:18px;margin-top:12px' },
        h('div', {}, control('gate law', modeSeg.el), kISlider.el, g0Slider.el),
        h('div', {}, tauSlider.el, distToggle.el, h('div', { class: 'toolbar' }, compareButton))));

const profileCard = card('Temperature $T(x,t)$ on $\\Omega=[0,1]$', '');
const profileCanvas = h('canvas', { class: 'plot-canvas tall', style: 'height:300px' });
const profilePlot = new LinePlot(profileCanvas, { xLabel: 'x', yLabel: 'T(x, t) [°C]', x: [0, 1], y: [-15, 105] });
profileCard.body.append(profileCanvas, seriesLegend([
    { label: '$T(x,t)$, earlier profiles of the regime fainter', color: palette().sDlow }, { label: '$T^\\star(x)$', color: palette().tstar, dash: 'dashed' },
    { label: '$\\Omega_{\\mathrm{ROI}}$', color: 'orange', dash: 'band' }, { label: '$T_{\\mathrm{src}}$', color: 'firebrick', dash: 'dashed' },
    { label: '$T_{\\mathrm{amb}}$', color: palette().muted, dash: 'dotted' }, { label: '$D_{\\mathrm{ext}}$ profile (at 0)', color: palette().hot, dash: 'band' }]));

function plotCard(title, opts, legend = null, size = '') {
    const c = card(title, '');
    const canvas = h('canvas', { class: `plot-canvas ${size}` });
    const plot = new LinePlot(canvas, { xLabel: 't [s]', x: [0, 100], ...opts });
    c.body.append(canvas);
    if (legend) c.legendBox = c.body.appendChild(seriesLegend(legend));
    c.plot = plot;
    return c;
}
const bottom = {
    g: plotCard('Gate $g(t)$ and equilibria $g^\\star_r$', { y: [-0.05, 1.08] }),
    Q: plotCard('Injected heat $Q_{\\mathrm{in}}(t)=\\int_{\\Omega_{\\mathrm{ROI}}}q_{\\mathrm{in}}\\,dx$', {}),
    e: plotCard('Mean error $\\bar e(t)$ (19)', { y: [-2.5, 5] }),
    V: plotCard('$V(g(t))=\\tfrac12(g-g^\\star_r)^2$', { logY: true, y: [1e-5, 1] }),
};
const compareLegend = h('div');

// ------------------------------------------------------------------ step panels
const tabs = [['step1', 'Step 1', 'Reduction to the mean'], ['step2', 'Step 2', 'Ideal convergence'], ['step3', 'Step 3', 'Ultimate boundedness'], ['discrete', 'Sec. V-D', 'Discrete gain bound']];
const tabBar = h('div', { class: 'steps', role: 'tablist' }, tabs.map(([id, k, name]) => h('button', {
    class: 'step-tab', role: 'tab', type: 'button', 'aria-selected': String(id === state.tab), 'data-tab': id,
    onclick: () => { state.tab = id; for (const b of tabBar.children) b.setAttribute('aria-selected', String(b.dataset.tab === id)); for (const [pid, panel] of Object.entries(panels)) panel.hidden = pid !== id; draw(); },
}, h('b', {}, k), h('span', {}, name))));

const s1a = plotCard('Norms of the error over $\\Omega_{\\mathrm{ROI}}$ (25)', { yLabel: '°C' }, [
    { label: '$\\lVert e\\rVert_{L^2}$', color: palette().ink }, { label: '$|\\Omega_{\\mathrm{ROI}}|^{1/2}|\\bar e|$', color: palette().ebar },
    { label: '$\\lVert e^\\perp\\rVert_{L^2}$', color: palette().heater }]);
const s1b = plotCard('Error profile $e(x,t)$ on $\\Omega_{\\mathrm{ROI}}$ at time $t$', { xLabel: 'x', x: [0.2, 0.6], yLabel: '°C' }, [
    { label: '$e(x,t)$', color: palette().ink }, { label: '$\\bar e(t)$', color: palette().ebar, dash: 'dashed' }, { label: '$e^\\perp=e-\\bar e$', color: palette().heater, dash: 'band' }]);
const s1out = readouts([{ key: 'n', label: '$\\lVert e\\rVert$' }, { key: 'm', label: '$|\\Omega|^{1/2}|\\bar e|$' }, { key: 'p', label: '$\\lVert e^\\perp\\rVert$' }, { key: 'c', label: '$|\\Omega|\\bar e^2+\\lVert e^\\perp\\rVert^2-\\lVert e\\rVert^2$' }]);

const s2a = plotCard('Steady-state map $\\bar e_{\\mathrm{ss}}(g)$ (28) of each regime', { xLabel: 'g', x: [0, 1], yLabel: '°C' }, [
    { label: 'no disturbance', color: palette().ink }, { label: 'hot', color: palette().hot }, { label: 'cold', color: palette().cold }, { label: '$(g(t),\\bar e(t))$', color: palette().heater }]);
const s2b = plotCard('Lyapunov function $V(g)$ (30) of the current regime', { xLabel: 'g', x: [0, 1], yLabel: 'V' });
const s2out = readouts([{ key: 'r', label: 'regime' }, { key: 'gs', label: '$g^\\star_r$' }, { key: 'sl', label: "$\\bar e_{\\mathrm{ss}}'(g^\\star_r)$" }, { key: 'g', label: '$g(t)$' }, { key: 'V', label: '$V(g(t))$' }]);

const s3a = plotCard('Residual $\\Delta(t)=\\bar e(t)-\\bar e_{\\mathrm{ss}}(g(t))$ (35)', { yLabel: '°C' }, [
    { label: '$\\bar e(t)$', color: palette().ebar }, { label: '$\\bar e_{\\mathrm{ss}}(g(t))$', color: palette().ink, dash: 'dashed' },
    { label: '$\\Delta(t)$', color: palette().heater }, { label: '$\\pm\\bar\\Delta$', color: palette().heater, dash: 'dotted' }]);
const s3b = plotCard('Ultimate set (37): $|\\bar e_{\\mathrm{ss}}(g)|\\le\\bar\\Delta$, $|g-g^\\star|\\le\\bar\\Delta/m_e$', { xLabel: 'g', x: [0, 1], yLabel: '°C' }, [
    { label: '$\\bar e_{\\mathrm{ss}}(g)$', color: palette().ink }, { label: 'bands', color: palette().heater, dash: 'band' }, { label: '$g(t)$ after 5 s', color: palette().heater }]);
const s3out = readouts([{ key: 'D', label: '$\\bar\\Delta$ (after 5 s)' }, { key: 'me', label: '$m_e$ (29)' }, { key: 'gb', label: '$\\bar\\Delta/m_e$' }, { key: 'go', label: 'max $|g-g^\\star|$' },
    { key: 'eb', label: '$2\\bar\\Delta$' }, { key: 'eo', label: 'max $|\\bar e|$' }]);

const tableBox = h('div');
const sdA = plotCard('Gate $g(t)$: discrete versus continuous', { y: [-0.05, 1.08] }, null, 'tall');
sdA.body.append(compareLegend);

const statement = (html) => { const el = h('p', { class: 'statement', html }); return el; };
const panels = {
    step1: h('div', { class: 'step-panel' }, statement('<b>Step 1.</b> The squared norm of the error splits into the part carried by the mean, <span class="tex">|\\ROI|\\,\\ebar^2</span>, and the zero-mean part <span class="tex">\\norm{e^\\perp}^2</span>. Diffusion keeps the second bounded; the gate acts on the first.'),
        h('section', { class: 'plots', style: 'margin-top:0' }, s1a.el, s1b.el), h('div', { class: 'card', style: 'margin-top:12px' }, s1out.el)),
    step2: h('div', { class: 'step-panel', hidden: true }, statement('<b>Step 2.</b> At a fixed gate, the steady mean error <span class="tex">\\ess(g)</span> decreases strictly with <span class="tex">g</span> (Lemma 1) and crosses zero at <span class="tex">g^\\star</span>. The integral law <span class="tex">\\dot g=k_I\\ebar</span> then descends <span class="tex">V(g)</span>: <span class="tex">\\dot V=-k_I\\ess^2\\le0</span> (Theorem 1).'),
        h('section', { class: 'plots', style: 'margin-top:0' }, s2a.el, s2b.el), h('div', { class: 'card', style: 'margin-top:12px' }, s2out.el)),
    step3: h('div', { class: 'step-panel', hidden: true }, statement('<b>Step 3.</b> With a moving source and disturbances, <span class="tex">\\ebar=\\ess(g)+\\Delta</span> with <span class="tex">|\\Delta|\\le\\bar\\Delta</span>. Outside the band <span class="tex">|\\ess(g)|\\le\\bar\\Delta</span>, <span class="tex">V</span> still decreases, so the state reaches the band and stays there (Theorem 2). Here <span class="tex">\\Delta</span> is measured against the undisturbed map, so it contains <span class="tex">\\Dext</span>; switch the disturbances off and set a sweep period <span class="tex">\\tau_{\\mathrm{erg}}&gt;0</span> to isolate the coverage residual.'),
        h('section', { class: 'plots', style: 'margin-top:0' }, s3a.el, s3b.el), h('div', { class: 'card', style: 'margin-top:12px' }, s3out.el)),
    discrete: h('div', { class: 'step-panel', hidden: true }, statement('<b>Discrete gate.</b> The explicit-Euler update (41) with <span class="tex">\\Delta t=0.01</span> s, linearized at <span class="tex">g^\\star_r</span>, gives the bounds (42) for each regime. The continuous law (24) converges for any <span class="tex">k_I&gt;0</span>.'),
        h('div', { class: 'card' }, tableBox), h('section', { class: 'plots' }, sdA.el)),
};
const stepsCard = card('', '');
stepsCard.body.append(tabBar, ...Object.values(panels));
renderMath(stepsCard.el);

document.getElementById('workspace').append(mainCard.el, h('div', { style: 'margin-top:12px' }, profileCard.el),
    h('section', { class: 'plots four' }, Object.values(bottom).map((c) => c.el)), h('div', { style: 'margin-top:14px' }, stepsCard.el));

// ------------------------------------------------------------------ computation
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
async function execute(kI, opts, onProgress) {
    const it = loop.runner(kI, { chunk: 200, ...opts });
    for (;;) {
        const t0 = performance.now();
        let r;
        do { r = it.next(); } while (!r.done && performance.now() - t0 < 12);
        if (r.done) return r.value;
        onProgress(r.value);
        await nextFrame();
    }
}
function setProgress(f) { progress.firstChild.style.width = `${(100 * f).toFixed(1)}%`; progress.style.opacity = f >= 1 ? 0 : 1; }

async function recompute() {
    const my = ++token;
    setProgress(0);
    const out = await execute(state.kI, { continuous: state.continuous, g0: state.g0, disturbances: state.disturbances, tauErg: state.tauErg },
        (f) => { if (my === token) setProgress(f); });
    if (my !== token) return;
    setProgress(1);
    run = out;
    derive();
    if (!state.playing && state.time === 0) setPlaying(true);
    draw();
}

async function computeCompare() {
    const my = ++token;
    compareButton.disabled = true;
    const cases = [['d_low', false, 0.1], ['d_high', false, 20], ['c_low', true, 0.1], ['c_high', true, 20]];
    const res = {};
    for (let i = 0; i < cases.length; i++) {
        const [key, continuous, kI] = cases[i];
        res[key] = await execute(kI, { continuous, disturbances: true }, (f) => setProgress((i + f) / cases.length));
        if (my !== token) { compareButton.disabled = false; return; }
    }
    compare = res;
    setProgress(1);
    compareButton.disabled = false;
    state.kI = 0.1; state.continuous = false; state.tauErg = 0; state.disturbances = true; state.g0 = 1;
    kISlider.set(0.1); modeSeg.set(false); tauSlider.set(0); distToggle.set(true); g0Slider.set(1);
    run = res.d_low; derive();
    for (const b of tabBar.children) if (b.dataset.tab === 'discrete') b.click();
    draw();
}

// Series derived from a run: decimated time series, V, Delta, and the bounds of Step 3.
function derive() {
    const n = run.t.length, stride = Math.max(1, Math.floor(n / 2000));
    const idx = [];
    for (let i = 0; i < n; i += stride) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    const pick = (a) => idx.map((i) => a[i]);
    const gStarAt = (t) => mapOf(state.disturbances ? regimeAt(t).A : 0).gStar;
    const sq = Math.sqrt(run.roiMeasure);
    const ess = (g) => interp(maps[0].g, maps[0].e, g);
    derived.t = pick(run.t);
    derived.g = pick(run.gate); derived.Q = pick(run.Qin); derived.e = pick(run.eMean);
    derived.V = idx.map((i) => Math.max(0.5 * (run.gate[i] - gStarAt(run.t[i])) ** 2, 1e-5));
    derived.n = pick(run.eNorm); derived.p = pick(run.ePerp); derived.m = idx.map((i) => sq * Math.abs(run.eMean[i]));
    derived.ess = idx.map((i) => ess(run.gate[i]));
    derived.D = idx.map((i, k) => run.eMean[i] - derived.ess[k]);
    let Dbar = 0, go = 0, eo = 0;
    for (let i = 0; i < n; i++) {
        if (run.t[i] < 5) continue;
        Dbar = Math.max(Dbar, Math.abs(run.eMean[i] - ess(run.gate[i])));
        go = Math.max(go, Math.abs(run.gate[i] - maps[0].gStar));
        eo = Math.max(eo, Math.abs(run.eMean[i]));
    }
    Object.assign(derived, { Dbar, go, eo });
    derived.traj = idx.filter((i) => run.t[i] >= 5).map((i) => [run.gate[i], ess(run.gate[i])]);
}

// ------------------------------------------------------------------ drawing
function regimeSpans(p) {
    return state.disturbances ? REGIMES.filter((r) => r.A).map((r) => ({ x0: r.t0, x1: r.t1, color: r.A > 0 ? p.hotSoft : p.coldSoft })) : [];
}
const COLORS = (p) => ({ d_low: p.sDlow, d_high: p.sDhigh, c_low: p.sClow, c_high: p.sChigh });

function draw() {
    if (!run) return;
    const p = palette();
    const k = Math.min(run.t.length - 1, Math.max(0, Math.round(state.time / DT) - 1));
    const t = run.t[k];
    const regime = state.disturbances ? regimeAt(t) : REGIMES[0];
    const caseColor = state.continuous ? (state.kI > 1 ? p.sChigh : p.sClow) : (state.kI > 1 ? p.sDhigh : p.sDlow);
    const cursor = [{ x: t, color: alpha(p.ink, 0.55), dash: [3, 3] }];
    const spans = regimeSpans(p);
    timeSlider.set(state.time);
    mainCard.note.textContent = `t = ${t.toFixed(1)} s · ${regime.name}${state.continuous ? ' · continuous' : ' · discrete'} · k_I = ${fmt(state.kI, state.kI < 1 ? 3 : 1)}${run.substeps > 1 ? ` (${run.substeps} sub-steps)` : ''}`;

    // profile with earlier snapshots of the regime
    const snapIndex = (time) => Math.min(run.snapTimes.length - 1, Math.max(0, Math.round((time - run.snapTimes[0]) / (run.snapTimes[1] - run.snapTimes[0]))));
    const t0 = state.disturbances ? regime.t0 : 0;
    const times = [0.05, 0.12, 0.3, 0.7, 1.5, 3, 6, 12].map((o) => t0 + o).filter((s) => s < t);
    const xs = Array.from(loop.x);
    const series = times.map((s, j) => ({ x: xs, y: Array.from(run.snaps[snapIndex(s)]), color: caseColor, width: 1, alpha: 0.15 + 0.4 * j / Math.max(1, times.length) }));
    series.push({ x: xs, y: Array.from(run.snaps[snapIndex(t)]), color: caseColor, width: 2.4 });
    series.push({ x: xs, y: Array.from(loop.Tstar), color: p.tstar, width: 1.4, dash: [5, 4] });
    const env = state.disturbances ? loop.pulses.map((q) => q.A / 18 * 8 * loop.envelope(q, t)).reduce((a, b) => a + b, 0) : 0;
    const fills = Math.abs(env) > 0.05 ? [{ x: xs, lo: xs.map(() => 0), hi: xs.map((_, i) => env * loop.shape[i]), color: alpha(env > 0 ? p.hot : p.cold, 0.35) }] : [];
    const markers = Number.isFinite(run.xc[k]) ? [{ x: run.xc[k], y: 95, color: p.heater, r: 6 }] : [];
    profilePlot.set({ series, fills, markers, spans: [{ x0: loop.roi[0], x1: loop.roi[1], color: p.roi1d }],
        hlines: [{ y: loop.Tsource, color: 'firebrick', dash: [6, 3, 1, 3] }, { y: loop.Tamb, color: p.muted, dash: [1, 3] }, { y: 0, color: alpha(p.ink, 0.25), dash: [] }] });

    // bottom row of Fig. 5
    const gLines = (state.disturbances ? REGIMES : [{ t0: 0, t1: 100, A: 0 }]).map((r) => ({ y: mapOf(r.A).gStar, x0: r.t0, x1: r.t1, color: p.ink, dash: [5, 3], width: 1.2 }));
    const runSeries = (key) => [{ x: derived.t, y: derived[key], color: caseColor, width: 1.6 }];
    let gSeries = runSeries('g'), QSeries = runSeries('Q'), eSeries = runSeries('e'), VSeries = runSeries('V');
    if (compare) {
        const cols = COLORS(p), vs = (r, key) => r[key];
        const comp = (key, f) => Object.entries(compare).map(([name, r]) => ({ x: Array.from(r.t).filter((_, i) => i % 5 === 0), y: f(r).filter((_, i) => i % 5 === 0),
            color: cols[name], width: name === 'd_high' ? 1 : 1.5, alpha: name === 'd_high' ? 0.45 : 1, dash: name.startsWith('c') ? [6, 3] : [] }));
        const gs = (r) => Array.from(r.t, (tt, i) => Math.max(0.5 * (r.gate[i] - mapOf(regimeAt(tt).A).gStar) ** 2, 1e-5));
        gSeries = comp('g', (r) => Array.from(vs(r, 'gate'))); QSeries = comp('Q', (r) => Array.from(r.Qin)); eSeries = comp('e', (r) => Array.from(r.eMean)); VSeries = comp('V', gs);
    }
    bottom.g.plot.set({ series: gSeries, hlines: gLines, vlines: cursor, spans });
    const qs = QSeries.flatMap((q) => q.y).filter(Number.isFinite).sort((a, b) => a - b);
    bottom.Q.plot.opts.y = [0, 1.15 * (qs[Math.floor(0.99 * (qs.length - 1))] || 1)];      // as in Fig. 5, the start-up peak is clipped
    bottom.Q.plot.set({ series: QSeries, vlines: cursor, spans });
    bottom.e.plot.opts.y = compare || state.tauErg === 0 ? [-2.5, 5] : null;
    bottom.e.plot.set({ series: eSeries, vlines: cursor, spans, hlines: [{ y: 0, color: alpha(p.ink, 0.4), dash: [2, 3] }] });
    bottom.V.plot.set({ series: VSeries, vlines: cursor, spans });
    compareLegend.replaceChildren(compare ? seriesLegend([{ label: 'Disc., $k_I=0.1$', color: p.sDlow }, { label: 'Disc., $k_I=20$', color: p.sDhigh },
        { label: 'Cont., $k_I=0.1$', color: p.sClow, dash: 'dashed' }, { label: 'Cont., $k_I=20$', color: p.sChigh, dash: 'dashed' }]) : '');

    const kk = Math.min(derived.t.length - 1, derived.t.findIndex((v) => v >= t));
    if (state.tab === 'step1') {
        s1a.plot.set({ series: [{ x: derived.t, y: derived.n, color: p.ink, width: 3.4, alpha: 0.35 }, { x: derived.t, y: derived.m, color: p.ebar, width: 1.6 },
            { x: derived.t, y: derived.p, color: p.heater, width: 1.6 }], vlines: cursor, spans });
        const T = run.snaps[snapIndex(t)], ri = Array.from(loop.roiIndex);
        const ex = ri.map((i) => loop.x[i]), ev = ri.map((i) => loop.Tstar[i] - T[i]);
        const eb = ev.reduce((a, b) => a + b, 0) / ev.length;
        s1b.plot.set({ series: [{ x: ex, y: ev, color: p.ink, width: 2 }], fills: [{ x: ex, lo: ex.map(() => eb), hi: ev, color: alpha(p.heater, 0.3) }],
            hlines: [{ y: eb, color: p.ebar, dash: [6, 3], width: 2 }, { y: 0, color: alpha(p.ink, 0.3), dash: [2, 3] }] });
        const n2 = run.eNorm[k] ** 2, m2 = run.roiMeasure * run.eMean[k] ** 2, p2 = run.ePerp[k] ** 2;
        s1out.set('n', fmt(run.eNorm[k], 2)); s1out.set('m', fmt(Math.sqrt(m2), 2)); s1out.set('p', fmt(run.ePerp[k], 2));
        s1out.set('c', (m2 + p2 - n2).toExponential(1));
    } else if (state.tab === 'step2') {
        const cur = mapOf(regime.A);
        s2a.plot.set({ series: [0, 18, -18].map((A) => ({ x: Array.from(maps[A].g), y: Array.from(maps[A].e), color: A === 0 ? p.ink : A > 0 ? p.hot : p.cold, width: A === regime.A ? 2.6 : 1.4 })),
            markers: [...[0, 18, -18].map((A) => ({ x: maps[A].gStar, y: 0, color: A === 0 ? p.ink : A > 0 ? p.hot : p.cold, r: 4 })), { x: run.gate[k], y: run.eMean[k], color: p.heater, r: 6 }],
            hlines: [{ y: 0, color: alpha(p.ink, 0.4), dash: [2, 3] }] });
        const Vg = interp(cur.g, cur.V, run.gate[k]);
        s2b.plot.opts.y = [0, Math.max(...cur.V) * 1.05];
        s2b.plot.set({ series: [{ x: Array.from(cur.g), y: Array.from(cur.V), color: regime.A === 0 ? p.ink : regime.A > 0 ? p.hot : p.cold, width: 2.2 }],
            markers: [{ x: cur.gStar, y: 0, color: p.ink, r: 4 }, { x: run.gate[k], y: Vg, color: p.heater, r: 7 }] });
        s2out.set('r', regime.name); s2out.set('gs', fmt(cur.gStar, 3)); s2out.set('sl', fmt(cur.slope, 2));
        s2out.set('g', fmt(run.gate[k], 3)); s2out.set('V', Vg.toExponential(2));
    } else if (state.tab === 'step3') {
        const D = derived.Dbar;
        s3a.plot.set({ series: [{ x: derived.t, y: derived.e, color: p.ebar, width: 1.5 }, { x: derived.t, y: derived.ess, color: p.ink, width: 1.3, dash: [5, 3] },
            { x: derived.t, y: derived.D, color: p.heater, width: 1.3 }],
            hlines: [{ y: D, color: p.heater, dash: [1, 3], width: 1.6 }, { y: -D, color: p.heater, dash: [1, 3], width: 1.6 }, { y: 0, color: alpha(p.ink, 0.3), dash: [2, 3] }],
            vlines: cursor, spans });
        const gs = maps[0].gStar, gb = D / mE;
        s3b.plot.set({ series: [{ x: Array.from(maps[0].g), y: Array.from(maps[0].e), color: p.ink, width: 2 },
            { x: derived.traj.map((q) => q[0]), y: derived.traj.map((q) => q[1]), color: p.heater, width: 1.2, alpha: 0.7 }],
            fills: [{ x: [0, 1], lo: [-D, -D], hi: [D, D], color: alpha(p.heater, 0.14) }],
            spans: [{ x0: Math.max(0, gs - gb), x1: Math.min(1, gs + gb), color: alpha(p.heater, 0.12) }],
            markers: [{ x: gs, y: 0, color: p.ink, r: 4 }, { x: run.gate[k], y: interp(maps[0].g, maps[0].e, run.gate[k]), color: p.heater, r: 6 }],
            hlines: [{ y: 0, color: alpha(p.ink, 0.35), dash: [2, 3] }] });
        s3out.set('D', `${fmt(D, 2)} °C`); s3out.set('me', fmt(mE, 2)); s3out.set('gb', fmt(gb, 2));
        s3out.set('go', fmt(derived.go, 2), derived.go <= gb + 1e-9 ? 'good' : 'bad');
        s3out.set('eb', `${fmt(2 * D, 2)} °C`); s3out.set('eo', `${fmt(derived.eo, 2)} °C`, derived.eo <= 2 * D + 1e-9 ? 'good' : 'bad');
    } else {
        drawTable(p);
        const ser = compare ? Object.entries(compare).map(([name, r]) => ({ x: Array.from(r.t).filter((_, i) => i % 5 === 0), y: Array.from(r.gate).filter((_, i) => i % 5 === 0),
            color: COLORS(p)[name], width: name === 'd_high' ? 1 : 1.6, alpha: name === 'd_high' ? 0.45 : 1, dash: name.startsWith('c') ? [6, 3] : [] }))
            : [{ x: derived.t, y: derived.g, color: caseColor, width: 1.6 }];
        sdA.plot.set({ series: ser, hlines: gLines, vlines: cursor, spans: regimeSpans(p) });
    }
}

function drawTable(p) {
    const rows = [['no disturbance', 0], ['hot', 18], ['cold', -18]].map(([name, A]) => {
        const m = maps[A], s = Math.abs(m.slope), b2 = 2 / (DT * s), b1 = 1 / (DT * s);
        const mark = (ok) => h('span', { style: `color:${ok ? p.good : p.bad};font-weight:800` }, ok ? '✓' : '✗');
        return h('tr', {}, h('td', {}, name), h('td', {}, fmt(m.gStar, 3)), h('td', {}, fmt(s, 2)), h('td', {}, fmt(b2, 1)), h('td', {}, fmt(b1, 1)),
            h('td', {}, mark(state.kI < b2), ' ', mark(state.kI < b1)));
    });
    tableBox.replaceChildren(h('table', { class: 'notation' },
        h('thead', {}, h('tr', {}, ['regime', '$g^\\star_r$', "$|\\bar e_{\\mathrm{ss}}'(g^\\star_r)|$", "$2/(\\Delta t\\,|\\bar e_{\\mathrm{ss}}'|)$",
            "$1/(\\Delta t\\,|\\bar e_{\\mathrm{ss}}'|)$", `$k_I=${fmt(state.kI, state.kI < 1 ? 3 : 1)}$`]
            .map((c) => h('th', { style: 'text-transform:none;letter-spacing:0;font-size:0.76rem' }, label(c))))),
        h('tbody', {}, rows)),
    h('p', { class: 'control-help', style: 'margin-top:8px' }, label('Bounds (42) from the slope of the computed map at $g^\\star_r$, with $\\Delta t=0.01$ s; ✓/✗: stability, then non-oscillatory convergence of the linearized discrete gate. The bounds are local: $|\\bar e_{\\mathrm{ss}}\'|$ grows toward $g=0$ (compare the hot regime), so a large oscillation of the gate meets lower local bounds than the ones at $g^\\star_r$.')));
}

// ------------------------------------------------------------------ animation
function setPlaying(on) { state.playing = on; playButton.replaceChildren(label(on ? '❚❚ Pause' : '▶ Play')); }
let last = performance.now();
function tick(now) {
    const dtReal = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state.playing && run) {
        state.time = Math.min(100, state.time + dtReal * state.speed);
        if (state.time >= 100) setPlaying(false);
        draw();
    }
    requestAnimationFrame(tick);
}
onThemeChange(draw);
recompute();
requestAnimationFrame(tick);
