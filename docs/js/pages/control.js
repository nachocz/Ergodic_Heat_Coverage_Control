// Control demo: the closed loop of Fig. 2 (ergodic law + standoff law) on the
// distributed thermal model, in 2D and on 3D surfaces.
import { fieldPanel, maskContours } from '../lib/fieldview.js';
import { LinePlot } from '../lib/plot.js';
import { SurfaceScene } from '../lib/scene3d.js';
import { initPage, loadFields } from '../lib/shell.js';
import { alpha, onThemeChange, palette } from '../lib/theme.js';
import { button, card, clock, control, fmt, h, label, readouts, segmented, select, seriesLegend, slider, toggle } from '../lib/ui.js';
import { analyticTarget, defaultConfig, EHCCSimulation, ErgodicController, Surface } from '../sim/ehcc.js';

await initPage();
const fields = await loadFields();
const N = fields.N;
const cfg = defaultConfig();
const HOT_CENTER = [0.45, 0.65];
const BENCHMARK = [                                   // Sec. VI-A: 16:40-17:00 hot, 26:40-27:40 cold
    { center: HOT_CENTER, sigma: 0.12, P: 600, tStart: 1000, tEnd: 1020, Tsource: 150, scheduled: true },
    { center: HOT_CENTER, sigma: 0.12, P: -600, tStart: 1600, tEnd: 1660, Tsource: 20, scheduled: true },
];
const KI = { T1: 0.04, T2: 0.04, T3: 0.04, T4: 0.04, T5: 0.02, interleaved: 0.02 };
const MATERIAL = { T5: 'halves', interleaved: 'interleaved' };

const ui = { target: 'T4', surface: 'bump', material: 'uniform', schedule: true, show2d: true, show3d: true, running: false, stepsPerFrame: 6,
    distCenter: [...HOT_CENTER], trailSeconds: 300 };
let sim, roiLines, logs, trail2d, metalField = null;

// ------------------------------------------------------------------ construction
function targetData(name) { return fields.targets[name]?.data ?? analyticTarget(name, N, 20); }
function makeSurface(name) {
    if (name === 'sole_3d') { const s = fields.surfaces.sole_3d; return new Surface(s.height, s.domain_size, null, 'sole_3d'); }
    return Surface[name](N, 0.35);
}
function materialSpec() {
    if (ui.material === 'uniform') return null;
    return { metal: fields.materials[ui.material].metal,
        ratio: { lam: fields.metal.lam / fields.rubber.lam, kappa: fields.metal.kappa / fields.rubber.kappa } };
}
function disturbances() { return ui.schedule ? BENCHMARK.map((d) => ({ ...d })) : []; }

function build() {
    const surface = makeSurface(ui.surface);
    cfg.domainSize = surface.L;
    sim = new EHCCSimulation(cfg, targetData(ui.target), { material: materialSpec(), surface, disturbances: disturbances() });
    roiLines = maskContours(sim.domain.roi, N);
    metalField = materialSpec()?.metal ?? null;
    stale = true;
    logs = { t: [], e_mean: [], lo: [], hi: [], l2: [], px: [], py: [], d: [], d_lb: [], E: [], gate: [] };
    trail2d = [];
    for (const panel of Object.values(panels)) panel.view.set({ roi: roiLines, trail: null, start: cfg.ergodic.p0 });
    panels.T.view.set({ trail: trail2d });
    scene.setSurface(surface);
    scene.setRoi(roiLines);
    panels.aux.head.firstChild.textContent = metalField ? 'material: metal / rubber' : 'T*(x)';
    panels.aux.head.lastChild.textContent = metalField ? 'metal fraction' : '°C';
    panels.aux.view.cmap = metalField ? 'metal' : 'hot';
    panels.aux.view.digits = metalField ? 1 : 0;
    panels.aux.view.cbDigits = null;
}

// ------------------------------------------------------------------ toolbar
const loopCard = card('Closed loop', '');
const runButton = button('▶ Run', () => setRunning(!ui.running), { primary: true });
const stepButton = button('Step', () => { if (!ui.running) { advance(1); stale = true; } });
const resetButton = button('Reset', () => { setRunning(false); build(); });
const clockEl = h('span', { class: 'clock', title: 'simulated time (min:s)' }, '0:00');
const speed = slider({ label: 'speed', min: 1, max: 60, step: 1, value: ui.stepsPerFrame,
    format: (v) => `${v} steps/frame (≈ ×${Math.round(v * 60 * cfg.dt)})`, onInput: (v) => { ui.stepsPerFrame = v; } });
speed.el.style.cssText = 'min-width:240px;margin:0;flex:1';
const view2d = toggle({ label: '2D views', value: true, onChange: (v) => { ui.show2d = v; fieldsCard.el.classList.toggle('hidden', !v); stale = true; } });
const view3d = toggle({ label: '3D view', value: true, onChange: (v) => { ui.show3d = v; sceneCard.el.classList.toggle('hidden', !v); stale = true; } });
const out = readouts([
    { key: 't', label: 'time' }, { key: 'ebar', label: '$\\bar e$' }, { key: 'sig', label: '$\\sigma_e$' },
    { key: 'd', label: '$d$' }, { key: 'dlb', label: '$d_{\\mathrm{lb}}$' }, { key: 'g', label: 'gate $g$' }, { key: 'E', label: '$\\mathcal E$' },
]);
loopCard.body.append(h('div', { class: 'toolbar' }, runButton, stepButton, resetButton, clockEl, h('span', { class: 'toolbar-divider' }), speed.el,
    h('span', { class: 'toolbar-divider' }), view2d.el, view3d.el), h('div', { style: 'margin-top:12px' }, out.el));

function setRunning(on) {
    ui.running = on;
    runButton.replaceChildren(label(on ? '❚❚ Pause' : '▶ Run'));
}

// ------------------------------------------------------------------ 2D views
const fieldsCard = card('Fields on Ω = [0, 1]²', 'click on T to place a disturbance');
const panels = {
    T: fieldPanel(h('span', {}, 'T(x, t) and p(t)'), h('span', {}, '°C'), { N, cmap: 'hot', onPointer: (ev) => {
        if (ev.type === 'down') { ui.distCenter = ev.p; stale = true; }
    } }),
    e: fieldPanel(h('span', {}, 'e = T* − T'), h('span', {}, 'red: deficit'), { N, cmap: 'rdbu' }),
    Phi: fieldPanel(h('span', {}, 'Φ ∝ e₊ (10)'), h('span', {}, 'per unit area'), { N, cmap: 'need', digits: 1 }),
    aux: fieldPanel(h('span', {}, 'T*(x)'), h('span', {}, '°C'), { N, cmap: 'hot' }),
};
fieldsCard.body.append(h('div', { class: 'field-grid' }, Object.values(panels).map((p) => p.el)),
    h('div', { class: 'legend' },
        h('span', { class: 'legend-item' }, h('i', { class: 'swatch dotted', style: `color:${palette().roi}` }), label('$\\partial\\Omega_{\\mathrm{ROI}}$')),
        h('span', { class: 'legend-item' }, h('i', { class: 'swatch dot', style: `color:${palette().heater}` }), label('$\\mathbf p(t)$, dashed circle $2\\sigma(d)$')),
        h('span', { class: 'legend-item' }, h('i', { class: 'swatch dot', style: `color:${palette().start}` }), label('$\\mathbf p(0)$')),
        h('span', { class: 'legend-item' }, h('i', { class: 'swatch', style: 'color:#9fd3ff' }), 'last 5 min of p(t)')));

// ------------------------------------------------------------------ 3D view
const sceneCard = card('End effector over the surface $\\mathbf s(\\Omega)$', 'drag to rotate · scroll to zoom');
const sceneBox = h('div', { class: 'view3d' });
sceneBox.append(h('div', { class: 'view3d-legend' },
    h('span', {}, h('i', { style: 'background:linear-gradient(90deg,#300,#c00,#fb0,#fff)' }), 'T(x, t)'),
    h('span', { style: `color:${palette().roi}` }, h('i', { class: 'dotted' }), h('span', { style: 'color:#e8e6e3' }, '∂Ω_ROI')),
    h('span', {}, h('i', { class: 'dot', style: `background:${palette().heater}` }), 'r = s(p) + d n, frame R_s'),
    h('span', {}, h('i', { style: 'background:linear-gradient(90deg,#fbeb73,#2a4cf0)' }), 'r(t), old → recent')));
sceneBox.append(h('span', { class: 'view3d-hint' }, 'left drag: rotate · right drag: pan · wheel: zoom'));
sceneCard.body.append(sceneBox);
const scene = new SurfaceScene(sceneBox);

// ------------------------------------------------------------------ setup rail
const TARGETS = [...Object.entries(fields.targets).map(([k, v]) => ({ value: k, label: v.label })),
    { value: 'gaussian', label: 'Gaussian' }, { value: 'ring', label: 'Ring' }];
const setupCard = card('Target and surface');
const targetSel = select({ options: TARGETS, value: ui.target, onChange: (v) => applyTarget(v) });
const surfaceSel = select({ options: [{ value: 'flat', label: 'Flat' }, { value: 'bump', label: 'Gaussian bump' }, { value: 'wave', label: 'Wave' },
    { value: 'sole_3d', label: 'Scanned sole (Sec. VII)' }], value: ui.surface, onChange: (v) => { ui.surface = v; setRunning(false); build(); } });
const schedule = toggle({ label: 'benchmark disturbances (16:40 hot, 26:40 cold)', value: ui.schedule, onChange: (v) => {
    ui.schedule = v;
    sim.disturbances = sim.disturbances.filter((d) => !d.scheduled).concat(v ? BENCHMARK.map((d) => ({ ...d })) : []);
} });
setupCard.body.append(control('target $T^\\star$ ($\\Omega_{\\mathrm{ROI}}=\\{T^\\star>T_{\\mathrm{amb}}\\}$)', targetSel.el),
    control('surface $\\mathbf s(\\Omega)$ (3D view and pose)', surfaceSel.el), schedule.el);

const matCard = card('Material (unknown to the controller)');
const matSeg = segmented({ options: [{ value: 'uniform', label: 'uniform' }, { value: 'halves', label: 'halves (T5)' }, { value: 'interleaved', label: 'interleaved' }],
    value: ui.material, onChange: (v) => { ui.material = v; setBaseMaterial(); setRunning(false); build(); } });
const kappa = slider({ label: 'conductivity $\\kappa$', min: 0.02, max: 0.4, step: 0.005, value: cfg.thermal.kappa, format: (v) => v.toFixed(3),
    onInput: (v) => { cfg.thermal.kappa = v; updateMaterial(); } });
const lam = slider({ label: 'coupling $\\lambda=1/(c\\rho)$', min: 0.5e-4, max: 2.5e-4, step: 0.05e-4, value: cfg.thermal.lam, format: (v) => v.toExponential(2),
    onInput: (v) => { cfg.thermal.lam = v; updateMaterial(); } });
const hConv = slider({ label: 'convection $h$', min: 1, max: 20, step: 0.5, value: cfg.thermal.h, format: (v) => v.toFixed(1),
    onInput: (v) => { cfg.thermal.h = v; sim.heat.h = v; } });
const power = slider({ label: 'source power $P$', min: 600, max: 2000, step: 50, value: cfg.heater.P, format: (v) => `${v.toFixed(0)} W`,
    onInput: (v) => { cfg.heater.P = v; } });
matCard.body.append(control('layout', matSeg.el, 'metal: twice the coupling and 8/3 the conductivity of rubber (Sec. VI)'),
    kappa.el, lam.el, hConv.el, power.el);

const ctrlCard = card('Controller');
const Kg = slider({ label: 'gain $K_g$ (16)', min: 0.05, max: 2, step: 0.05, value: cfg.ergodic.Kg, onInput: (v) => { cfg.ergodic.Kg = v; } });
const umax = slider({ label: '$u_{\\max}$ [domain lengths / s]', min: 0.02, max: 0.3, step: 0.01, value: cfg.ergodic.uMax, onInput: (v) => { cfg.ergodic.uMax = v; } });
const modes = slider({ label: 'modes $K$ per axis', description: 'changing $K$ restarts the coverage statistics $c_{\\mathbf k}$', min: 4, max: 24, step: 1,
    value: cfg.ergodic.K, format: (v) => v.toFixed(0), onChange: (v) => { cfg.ergodic.K = v; sim.ergodic = new ErgodicController(cfg.ergodic, N, cfg.dt); } });
const kI = slider({ label: 'integral gain $k_I$ (21)', min: 0, max: 0.2, step: 0.005, value: cfg.standoff.kI, format: (v) => v.toFixed(3),
    onInput: (v) => { cfg.standoff.kI = v; } });
const dmin = slider({ label: '$d_{\\min}$', min: 0.02, max: 0.2, step: 0.005, value: cfg.standoff.dMin, format: (v) => `${(100 * v).toFixed(1)} cm`,
    onInput: (v) => { cfg.standoff.dMin = Math.min(v, cfg.standoff.dMax - 0.05); } });
const dmax = slider({ label: '$d_{\\max}$ ($\\eta(d_{\\max})=0$)', min: 0.2, max: 0.6, step: 0.005, value: cfg.standoff.dMax, format: (v) => `${(100 * v).toFixed(1)} cm`,
    onInput: (v) => { cfg.standoff.dMax = Math.max(v, cfg.standoff.dMin + 0.05); } });
const na = button('EHCC-NA', () => { cfg.standoff.kI = 0; kI.set(0); sim.standoff.dlb = cfg.standoff.dMin; stale = true; },
    { small: true, title: 'ablation of Sec. VI-B: k_I = 0 and d_lb = d_min' });
const restore = button('benchmark gains', () => {
    const d = defaultConfig();
    Object.assign(cfg.ergodic, { Kg: d.ergodic.Kg, uMax: d.ergodic.uMax });
    Object.assign(cfg.standoff, { kI: KI[ui.target] ?? d.standoff.kI, dMin: d.standoff.dMin, dMax: d.standoff.dMax });
    [Kg, umax, kI, dmin, dmax].forEach((s, i) => s.set([cfg.ergodic.Kg, cfg.ergodic.uMax, cfg.standoff.kI, cfg.standoff.dMin, cfg.standoff.dMax][i]));
}, { small: true });
ctrlCard.body.append(h('p', { class: 'group-label' }, 'ergodic coverage'), Kg.el, umax.el, modes.el,
    h('p', { class: 'group-label' }, 'standoff'), kI.el, dmin.el, dmax.el, h('div', { class: 'toolbar' }, na, restore));

const distCard = card('Disturbances');
const hotButton = button('Hot source +600 W, 20 s', () => addDisturbance(600, 20), { small: true });
const coldButton = button('Cold sink −600 W, 60 s', () => addDisturbance(-600, 60), { small: true });
distCard.body.append(h('p', { class: 'control-help' }, label('Applied at the point clicked on the $T$ map (dashed circle), with a Gaussian footprint of width 0.12, as in Sec. VI-A.')),
    h('div', { class: 'toolbar' }, hotButton, coldButton));
function addDisturbance(P, duration) {
    sim.disturbances.push({ center: [...ui.distCenter], sigma: 0.12, P, tStart: sim.t, tEnd: sim.t + duration, Tsource: P > 0 ? 150 : 20 });
    if (!ui.running) setRunning(true);
}

// ------------------------------------------------------------------ plots
const p0 = palette();
const plotDefs = {
    e: { title: 'Mean error and spread over $\\Omega_{\\mathrm{ROI}}$', y: '°C', legend: [{ label: '$\\bar e(t)$', color: p0.ebar }, { label: '$\\bar e\\pm\\sigma_e$', color: p0.ebar, dash: 'band' }] },
    l2: { title: '$\\lVert e\\rVert_{L^2(\\Omega_{\\mathrm{ROI}})}$', y: '°C·cm', legend: [] },
    p: { title: 'Focal point $\\mathbf p(t)$', y: '', legend: [{ label: '$p_x$', color: p0.px }, { label: '$p_y$', color: p0.py }] },
    d: { title: 'Standoff $d(t)$ and lower bound $d_{\\mathrm{lb}}(t)$', y: 'm', legend: [{ label: '$d$', color: p0.dCol }, { label: '$d_{\\mathrm{lb}}$', color: p0.dCol, dash: 'dashed' }] },
    E: { title: 'Ergodic metric $\\mathcal E(t)$ (14)', y: '', legend: [], logY: true },
    g: { title: 'Gate $g(t)$ (22)', y: '', legend: [] },
};
const plots = {};
const plotCards = Object.entries(plotDefs).map(([key, def]) => {
    const c = card(def.title, key === 'e' ? 'blue band: σ_e' : '');
    const canvas = h('canvas', { class: 'plot-canvas' });
    plots[key] = new LinePlot(canvas, { xLabel: 't [min]', yLabel: def.y, logY: def.logY, yIncludeZero: !def.logY, yMin: 1e-4,
        xFormat: (v) => String(Number(v.toPrecision(3))) });
    c.body.append(canvas);
    if (def.legend.length) c.body.append(seriesLegend(def.legend));
    return c;
});

// ------------------------------------------------------------------ layout
document.getElementById('workspace').append(loopCard.el,
    h('div', { class: 'stage wide-rail', style: 'margin-top:12px' },
        h('div', { class: 'stack' }, sceneCard.el, fieldsCard.el),
        h('div', { class: 'rail' }, setupCard.el, matCard.el, ctrlCard.el, distCard.el)),
    h('section', { class: 'plots' }, plotCards.map((c) => c.el)));

// ------------------------------------------------------------------ presets and live material changes
function setBaseMaterial() {
    const base = ui.material === 'uniform' ? { lam: 1.0e-4, kappa: 0.1 } : fields.rubber;
    cfg.thermal.lam = base.lam; cfg.thermal.kappa = base.kappa;
    lam.set(base.lam); kappa.set(base.kappa);
}
function applyTarget(name) {
    ui.target = name;
    ui.material = MATERIAL[name] ?? 'uniform';
    matSeg.set(ui.material);
    setBaseMaterial();
    cfg.standoff.kI = KI[name] ?? 0.04; kI.set(cfg.standoff.kI);
    if (name === 'sole_3d') { ui.surface = 'sole_3d'; surfaceSel.set('sole_3d'); }
    else if (ui.surface === 'sole_3d') { ui.surface = 'bump'; surfaceSel.set('bump'); }
    setRunning(false);
    build();
}
function updateMaterial() {
    const m = materialSpec();
    sim.domain.setProperties({ lam: cfg.thermal.lam, kappa: cfg.thermal.kappa, metal: m?.metal ?? null, metalRatio: m?.ratio ?? null,
        outsideCoupling: cfg.thermal.outsideCoupling });
    sim.heat.refresh();
}

// ------------------------------------------------------------------ simulation and rendering
function advance(n) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
        const r = sim.step();
        logs.t.push(r.t / 60); logs.e_mean.push(r.e_mean); logs.lo.push(r.e_mean - r.e_std); logs.hi.push(r.e_mean + r.e_std);
        logs.l2.push(100 * cfg.domainSize * Math.sqrt(r.l2_error)); logs.px.push(r.px); logs.py.push(r.py);
        logs.d.push(r.d); logs.d_lb.push(r.d_lb); logs.E.push(r.E); logs.gate.push(r.gate);
        trail2d.push([r.px, r.py]);
        scene.pushTrail([r.rx, r.ry, r.rz]);
        if (performance.now() - t0 > 14) break;          // keep the page responsive
    }
    const keep = Math.round(ui.trailSeconds / cfg.dt);
    if (trail2d.length > keep * 1.2) trail2d.splice(0, trail2d.length - keep);
}

const buf = { e: new Float64Array(N * N), Phi: new Float64Array(N * N) };
let frame = 0;
function render(force = false) {
    const D = sim.domain, r = sim.last, p = palette();
    const dT = D.Tmax - D.Tamb;
    const sigma = r?.sigma ?? cfg.heater.sigmaMax, strength = r ? r.eta / cfg.heater.etaMax : 0;
    const active = sim.disturbances.filter((d) => d.tStart <= sim.t && sim.t <= d.tEnd);
    const shownDist = active[active.length - 1] ?? { center: ui.distCenter, sigma: 0.12, P: 600, active: false };
    if (ui.show2d) {
        for (let i = 0; i < N * N; i++) buf.e[i] = D.roi[i] ? D.Tstar[i] - D.T[i] : 0;
        const Phi = D.heatingDensity();
        let pmax = 1e-9;
        for (let i = 0; i < Phi.length; i++) { buf.Phi[i] = Phi[i] * (N - 1) * (N - 1); if (buf.Phi[i] > pmax) pmax = buf.Phi[i]; }
        const heaterOverlay = { p: sim.p, sigma, strength };
        panels.T.view.setRange(D.Tamb, D.Tmax + 2); panels.T.view.setField(D.T);
        panels.T.view.set({ heater: heaterOverlay, trail: trail2d, disturbance: { ...shownDist, active: active.length > 0 } });
        panels.e.view.setRange(-dT, dT); panels.e.view.setField(buf.e); panels.e.view.set({ heater: heaterOverlay });
        panels.Phi.view.setRange(0, Math.max(pmax, 2)); panels.Phi.view.setField(buf.Phi); panels.Phi.view.set({ heater: heaterOverlay });
        if (metalField) { panels.aux.view.setRange(0, 1); panels.aux.view.setField(metalField); }
        else { panels.aux.view.setRange(D.Tamb, D.Tmax + 2); panels.aux.view.setField(D.Tstar); }
        Object.values(panels).forEach((panel) => panel.view.draw());
    }
    if (ui.show3d) {
        scene.setColors(D.T, 'hot', D.Tamb, D.Tmax + 2);
        scene.setHeater({ p: sim.p, d: r?.d ?? cfg.standoff.dMax, sigma, strength });
        scene.setDisturbance({ ...shownDist, active: active.length > 0 });
        scene.refreshTrail();
    }
    clockEl.textContent = clock(sim.t);
    if (r) {
        out.set('t', clock(sim.t));
        out.set('ebar', `${fmt(r.e_mean, 2)} °C`, Math.abs(r.e_mean) < 0.5 ? 'good' : '');
        out.set('sig', `${fmt(r.e_std, 2)} °C`);
        out.set('d', `${(100 * r.d).toFixed(1)} cm`);
        out.set('dlb', `${(100 * r.d_lb).toFixed(1)} cm`);
        out.set('g', fmt(r.gate, 2));
        out.set('E', r.E.toExponential(1));
    }
    if (force || frame % 4 === 0) drawPlots(p);
}

function drawPlots(p) {
    const n = logs.t.length, stride = Math.max(1, Math.ceil(n / 1800));
    const pick = (a) => { const o = []; for (let i = 0; i < n; i += stride) o.push(a[i]); if (n && (n - 1) % stride) o.push(a[n - 1]); return o; };
    const t = pick(logs.t);
    const tEnd = Math.max(1, sim.t / 60);
    const spans = sim.disturbances.filter((d) => d.tStart <= sim.t)
        .map((d) => ({ x0: d.tStart / 60, x1: Math.min(d.tEnd, sim.t) / 60, color: d.P > 0 ? p.hotSoft : p.coldSoft }));
    for (const plot of Object.values(plots)) plot.opts.x = [0, tEnd];
    plots.e.set({ series: [{ x: t, y: pick(logs.e_mean), color: p.ebar, width: 1.6 }],
        fills: [{ x: t, lo: pick(logs.lo), hi: pick(logs.hi), color: alpha(p.ebar, 0.16) }], spans, hlines: [{ y: 0, color: alpha(p.ink, 0.4), dash: [2, 3] }] });
    plots.l2.set({ series: [{ x: t, y: pick(logs.l2), color: p.ink, width: 1.4 }], spans });
    plots.p.set({ series: [{ x: t, y: pick(logs.px), color: p.px, width: 1 }, { x: t, y: pick(logs.py), color: p.py, width: 1 }], spans });
    plots.d.opts.y = [0, Math.max(cfg.standoff.dMax * 1.08, 0.1)];
    plots.d.set({ series: [{ x: t, y: pick(logs.d), color: p.dCol, width: 0.9, alpha: 0.85 }, { x: t, y: pick(logs.d_lb), color: p.dCol, width: 1.8, dash: [5, 3] }],
        spans, hlines: [{ y: cfg.standoff.dMin, color: alpha(p.ink, 0.35), label: 'd_min' }, { y: cfg.standoff.dMax, color: alpha(p.ink, 0.35), label: 'd_max' }] });
    plots.E.set({ series: [{ x: t, y: pick(logs.E), color: p.ink, width: 1 }], spans });
    plots.g.opts.y = [0, 1.05];
    plots.g.set({ series: [{ x: t, y: pick(logs.gate), color: p.accentStrong, width: 1.8 }], spans });
}

let stale = true;                                     // redraw once when paused and something changed
function tick() {
    if (ui.running) { advance(ui.stepsPerFrame); render(); }
    else if (stale) { render(true); stale = false; }
    frame += 1;
    requestAnimationFrame(tick);
}

onThemeChange(() => { scene.refreshTheme(); Object.values(panels).forEach((panel) => { panel.view.cbDigits = null; panel.view.drawColorbar(); }); stale = true; });
build();
if (new URLSearchParams(location.search).has('run')) setRunning(true);
requestAnimationFrame(tick);
