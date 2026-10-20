// Problem setup: the plant of Sec. II driven by hand. The focal point p follows
// the pointer on the large map, and the source heats while the button is pressed.
import { fieldPanel, maskContours } from '../lib/fieldview.js';
import { LinePlot } from '../lib/plot.js';
import { SurfaceScene } from '../lib/scene3d.js';
import { initPage, loadFields } from '../lib/shell.js';
import { alpha, onThemeChange, palette } from '../lib/theme.js';
import { card, fmt, h, label, readouts, segmented, select, seriesLegend, slider, toggle } from '../lib/ui.js';
import { analyticTarget, clamp, defaultConfig, Domain, efficiency, HeatEquation, kernelFactors, kernelWidth, Surface } from '../sim/ehcc.js';

await initPage();
const fields = await loadFields();
const N = fields.N;
const cfg = defaultConfig();
const { heater, standoff } = cfg;

// ------------------------------------------------------------------ state
const TARGETS = [...Object.entries(fields.targets).map(([k, v]) => ({ value: k, label: v.label })),
    { value: 'gaussian', label: 'Gaussian' }, { value: 'ring', label: 'Ring' }];
const SURFACES = [{ value: 'flat', label: 'Flat' }, { value: 'bump', label: 'Gaussian bump' }, { value: 'wave', label: 'Wave' },
    { value: 'sole_3d', label: 'Scanned sole (Sec. VII)' }];
const state = { target: 'T4', surface: 'bump', field: 'e', p: [0.42, 0.45], d: 0.2, pressed: false, always: false, speed: 4, t: 0 };
let D, heat, roiLines, history;

function targetData(name) { return fields.targets[name]?.data ?? analyticTarget(name, N, 20); }
function makeSurface(name) {
    if (name === 'sole_3d') return new Surface(fields.surfaces.sole_3d.height, fields.surfaces.sole_3d.domain_size, null, 'sole_3d');
    return Surface[name](N, cfg.domainSize);
}
function reset() {
    D = new Domain(targetData(state.target), { lam: cfg.thermal.lam, kappa: cfg.thermal.kappa, outsideCoupling: cfg.thermal.outsideCoupling });
    heat = new HeatEquation(D, heater, cfg.thermal.h);
    roiLines = maskContours(D.roi, N);
    state.t = 0;
    history = { t: [], mean: [], lo: [], hi: [] };
    for (const panel of panels) panel.view.set({ roi: roiLines });
    main.view.set({ roi: roiLines });
    scene.setRoi(roiLines);
}

// ------------------------------------------------------------------ main map
const FIELD_OPTIONS = [
    { value: 'T', label: '$T$', title: 'measured temperature' }, { value: 'Tstar', label: '$T^\\star$', title: 'target' },
    { value: 'e', label: '$e$', title: 'error T* - T' }, { value: 'eplus', label: '$e_+$', title: 'heat deficit' },
    { value: 'Phi', label: '$\\Phi$', title: 'heating density (10)' }, { value: 'K', label: '$q_{\\mathrm{in}}$', title: 'injected flux P eta K' },
];
const CMAP = { T: 'hot', Tstar: 'hot', e: 'rdbu', eplus: 'need', Phi: 'need', K: 'need' };
const TITLE = { T: 'T(x, t)', Tstar: 'T*(x)', e: 'e = T* − T', eplus: 'e₊', Phi: 'Φ ∝ e₊', K: 'q_in = P η(d) K' };
const UNIT = { T: '°C', Tstar: '°C', e: '°C', eplus: '°C', Phi: 'per unit area', K: 'kW per unit area' };

const mapCard = card('Heat the surface by hand', 'Ω = [0, 1]²');
const fieldSwitch = segmented({ options: FIELD_OPTIONS, value: state.field, onChange: (v) => { state.field = v; setMainField(); } });
const main = fieldPanel(h('span', {}, ''), h('span', {}, ''), { N, onPointer, digits: 0, wheel: true });
main.el.classList.add('big');
const out = readouts([
    { key: 'd', label: 'standoff $d$' }, { key: 'eta', label: '$\\eta(d)$' }, { key: 'sigma', label: '$\\sigma(d)\\,L$' },
    { key: 'Q', label: '$Q_{\\mathrm{in}}=P\\eta$' }, { key: 'ep', label: '$e_+(\\mathbf p)$' }, { key: 'ebar', label: '$\\bar e$' },
]);
const dSlider = slider({ label: 'standoff $d$', min: standoff.dMin, max: standoff.dMax, step: 0.005, value: state.d,
    format: (v) => `${(100 * v).toFixed(1)} cm`, onInput: (v) => { state.d = v; } });
const always = toggle({ label: 'heat without pressing', value: false, onChange: (v) => { state.always = v; } });
const speed = segmented({ options: [{ value: 1, label: '1×' }, { value: 4, label: '4×' }, { value: 16, label: '16×' }], value: state.speed,
    onChange: (v) => { state.speed = v; } });
const resetButton = h('button', { class: 'button small', type: 'button', onclick: () => reset() }, 'Reset T');
mapCard.body.append(
    h('p', { class: 'interaction-guide' }, label('Move the pointer to move $\\mathbf p$; press and drag to heat; scroll to change $d$. The colour bar is in the units of the field.')),
    h('div', { class: 'toolbar', style: 'margin-bottom:8px' }, fieldSwitch.el),
    main.el,
    h('div', { class: 'toolbar', style: 'margin-top:10px' }, h('span', { class: 'hint' }, 'speed'), speed.el, h('span', { class: 'toolbar-divider' }), always.el, resetButton),
    h('div', { style: 'margin-top:10px' }, dSlider.el), out.el);

function onPointer(ev) {
    if (ev.type === 'wheel') { state.d = clamp(state.d + 0.01 * ev.delta, standoff.dMin, standoff.dMax); dSlider.set(state.d); return; }
    state.p = ev.p;
    if (ev.type === 'down') state.pressed = true;
    if (ev.type === 'up') state.pressed = false;
}

// ------------------------------------------------------------------ 3D view
const sceneCard = card('Embedded surface $\\mathbf s(\\Omega)$ and pose of the source', 'drag to rotate · scroll to zoom');
const view3d = h('div', { class: 'view3d' });
view3d.append(h('div', { class: 'view3d-legend' },
    h('span', {}, h('i', { style: 'background:linear-gradient(90deg,#300,#c00,#fb0,#fff)' }), 'T(x, t) on s(Ω)'),
    h('span', { style: `color:${palette().roi}` }, h('i', { class: 'dotted' }), h('span', { style: 'color:#e8e6e3' }, '∂Ω_ROI')),
    h('span', {}, h('i', { class: 'dot', style: `background:${palette().heater}` }), 'r = s(p) + d n'),
    h('span', {}, h('i', { style: `background:${palette().t1}` }), h('i', { style: `background:${palette().t2};margin-left:-4px` }),
        h('i', { style: `background:${palette().nrm};margin-left:-4px` }), 'R_s = [t₁, t₂, n]')));
view3d.append(h('span', { class: 'view3d-hint' }, 'left drag: rotate · right drag: pan · wheel: zoom'));
const surfaceSelect = select({ options: SURFACES, value: state.surface, onChange: (v) => { state.surface = v; scene.setSurface(makeSurface(v)); scene.setRoi(roiLines); } });
const targetSelect = select({ options: TARGETS, value: state.target, onChange: (v) => { state.target = v; reset(); } });
sceneCard.body.append(view3d, h('div', { class: 'two-col', style: 'gap:10px;margin-top:10px' },
    h('div', { class: 'control' }, h('div', { class: 'control-head' }, h('label', {}, label('surface $\\mathbf s$'))), surfaceSelect.el),
    h('div', { class: 'control' }, h('div', { class: 'control-head' }, h('label', {}, label('target $T^\\star$'))), targetSelect.el)),
h('p', { class: 'control-help' }, label('The heat equation evolves on $\\Omega=[0,1]^2$; the surface only changes the pose $\\mathbf r$, $\\mathbf R_s$ of the end effector. $\\Omega_{\\mathrm{ROI}}$ follows from the target.')));

// ------------------------------------------------------------------ small multiples and plots
const fieldsCard = card('All fields at once', 'Ω_ROI dotted');
const panels = ['Tstar', 'T', 'e', 'eplus', 'Phi'].map((key) => {
    const panel = fieldPanel(h('span', {}, TITLE[key]), h('span', {}, UNIT[key]), { N, cmap: CMAP[key] });
    panel.key = key;
    return panel;
});
fieldsCard.body.append(h('div', { class: 'field-grid' }, panels.map((p) => p.el)));

const actCard = card('Actuation model', 'linear in d, as in the benchmark');
const actCanvas = h('canvas', { class: 'plot-canvas' });
const actPlot = new LinePlot(actCanvas, { xLabel: 'standoff d [m]', x: [standoff.dMin, standoff.dMax], y: [0, 1.05] });
actCard.body.append(actCanvas, seriesLegend([
    { label: '$\\eta(d)$', color: palette().hot }, { label: '$\\sigma(d)/\\sigma(d_{\\max})$', color: palette().ebar, dash: 'dashed' }]));

const kernelCard = card('Injected flux along $x$ through $\\mathbf p$', 'q_in(x, p_y)');
const kernelCanvas = h('canvas', { class: 'plot-canvas' });
const kernelPlot = new LinePlot(kernelCanvas, { xLabel: 'x', x: [0, 1], yLabel: 'kW per unit area' });
kernelCard.body.append(kernelCanvas);

const histCard = card('Error during this session', 'e over Ω_ROI');
const histCanvas = h('canvas', { class: 'plot-canvas' });
const histPlot = new LinePlot(histCanvas, { xLabel: 't [s]', yLabel: '°C' });
histCard.body.append(histCanvas, seriesLegend([{ label: '$\\bar e(t)$', color: palette().ebar }, { label: '$\\bar e\\pm\\sigma_e$', color: palette().ebar, dash: 'band' }]));

const workspace = document.getElementById('workspace');
workspace.append(h('div', { class: 'stage two' }, mapCard.el, sceneCard.el), h('div', { style: 'margin-top:14px' }, fieldsCard.el),
    h('section', { class: 'plots' }, actCard.el, kernelCard.el, histCard.el));

const scene = new SurfaceScene(view3d);
scene.setSurface(makeSurface(state.surface));
reset();

// Rows of the notation table switch the large map.
for (const row of document.querySelectorAll('#notation tr[data-field]')) {
    row.setAttribute('data-show', '');
    row.title = 'Show on the large map';
    row.addEventListener('click', () => { state.field = row.dataset.field; fieldSwitch.set(state.field); setMainField(); });
}

// ------------------------------------------------------------------ fields
const buf = { e: new Float64Array(N * N), eplus: new Float64Array(N * N), K: new Float64Array(N * N), Phi: new Float64Array(N * N) };
function compute() {
    const dT = D.Tmax - D.Tamb;
    for (let i = 0; i < N * N; i++) {
        const e = D.roi[i] ? D.Tstar[i] - D.T[i] : 0;
        buf.e[i] = e; buf.eplus[i] = Math.max(e, 0);
    }
    const eta = efficiency(state.d, heater, standoff.dMin, standoff.dMax), sigma = kernelWidth(state.d, heater, standoff.dMin, standoff.dMax);
    const k = kernelFactors(N, state.p, sigma);
    const a = heater.P * eta / k.norm;
    let kmax = 0;
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) { const v = a * k.gx[ix] * k.gy[iy] / 1000; buf.K[iy * N + ix] = v; if (v > kmax) kmax = v; }
    const Phi = D.heatingDensity();          // unit sum over the nodes; shown as a density on [0, 1]^2
    let pmax = 0;
    for (let i = 0; i < Phi.length; i++) { buf.Phi[i] = Phi[i] * (N - 1) * (N - 1); pmax = Math.max(pmax, buf.Phi[i]); }
    return {
        T: { data: D.T, lo: D.Tamb, hi: D.Tmax + 2 }, Tstar: { data: D.Tstar, lo: D.Tamb, hi: D.Tmax + 2 },
        e: { data: buf.e, lo: -dT, hi: dT }, eplus: { data: buf.eplus, lo: 0, hi: dT },
        Phi: { data: buf.Phi, lo: 0, hi: Math.max(pmax, 1e-9) }, K: { data: buf.K, lo: 0, hi: 430 },
        eta, sigma, kernel: k, a,
    };
}

function setMainField() {
    main.head.firstChild.textContent = TITLE[state.field];
    main.head.lastChild.textContent = UNIT[state.field] || 'normalized';
    main.view.cmap = CMAP[state.field];
}

// ------------------------------------------------------------------ loop
let last = performance.now(), due = 0, frame = 0;
function tick(now) {
    due = Math.min(due + (now - last) / 1000 * 5 * state.speed, 40);       // 5 steps of 0.2 s per second = real time
    last = now;
    const heating = state.pressed || state.always;
    while (due >= 1) {
        due -= 1;
        if (heating) {
            const eta = efficiency(state.d, heater, standoff.dMin, standoff.dMax);
            heat.heat(heater.P * eta, kernelFactors(N, state.p, kernelWidth(state.d, heater, standoff.dMin, standoff.dMax)), cfg.dt);
        }
        heat.lose(cfg.dt);
        heat.diffuse(cfg.dt);
        state.t += cfg.dt;
        const m = D.metrics();
        history.t.push(state.t); history.mean.push(m.e_mean); history.lo.push(m.e_mean - m.e_std); history.hi.push(m.e_mean + m.e_std);
    }
    render(heating);
    frame += 1;
    requestAnimationFrame(tick);
}

function render(heating) {
    const f = compute(), p = palette();
    const sel = f[state.field];
    main.view.setRange(sel.lo, sel.hi);
    main.view.digits = state.field === 'Phi' ? 1 : 0;
    main.view.setField(sel.data);
    main.view.set({ heater: { p: state.p, sigma: f.sigma, strength: heating ? 1 : 0.25 } });
    main.view.draw();
    for (const panel of panels) {
        const s = f[panel.key];
        panel.view.setRange(s.lo, s.hi); panel.view.digits = panel.key === 'Phi' ? 1 : 0;
        panel.view.setField(s.data);
        panel.view.set({ heater: { p: state.p, sigma: f.sigma, strength: heating ? 1 : 0.25 } });
        panel.view.draw();
    }
    scene.setColors(D.T, 'hot', D.Tamb, D.Tmax + 2);
    scene.setHeater({ p: state.p, d: state.d, sigma: f.sigma, strength: heating ? f.eta / heater.etaMax : 0 });
    const m = D.metrics();
    out.set('d', `${(100 * state.d).toFixed(1)} cm`);
    out.set('eta', fmt(f.eta, 2));
    out.set('sigma', `${(100 * f.sigma * cfg.domainSize).toFixed(1)} cm`);
    out.set('Q', heating ? `${(heater.P * f.eta).toFixed(0)} W` : '0 W (off)');
    out.set('ep', D.inRoi(state.p) ? `${fmt(Math.max(D.sample(D.Tstar, state.p) - D.sample(D.T, state.p), 0), 1)} °C` : '0 (outside)');
    out.set('ebar', `${fmt(m.e_mean, 2)} °C`, Math.abs(m.e_mean) < 0.5 ? 'good' : '');
    if (frame % 6 === 0) drawPlots(f, p);
}

function drawPlots(f, p) {
    const ds = Array.from({ length: 81 }, (_, i) => standoff.dMin + (standoff.dMax - standoff.dMin) * i / 80);
    actPlot.set({
        series: [{ x: ds, y: ds.map((d) => efficiency(d, heater, standoff.dMin, standoff.dMax)), color: p.hot, width: 2 },
            { x: ds, y: ds.map((d) => kernelWidth(d, heater, standoff.dMin, standoff.dMax) / heater.sigmaMax), color: p.ebar, width: 2, dash: [5, 4] }],
        markers: [{ x: state.d, y: f.eta, color: p.hot }, { x: state.d, y: f.sigma / heater.sigmaMax, color: p.ebar }],
        vlines: [{ x: state.d, color: alpha(p.ink, 0.35) }],
    });
    const xs = Array.from({ length: N }, (_, i) => i / (N - 1));
    const iy = Math.round(state.p[1] * (N - 1));
    kernelPlot.opts.y = [0, Math.max(10, 1.1 * heater.P * heater.etaMax / (2 * Math.PI * heater.sigmaMin ** 2) / 1000)];
    kernelPlot.set({
        series: [{ x: xs, y: xs.map((_, ix) => f.a * f.kernel.gx[ix] * f.kernel.gy[iy] / 1000), color: p.heater, width: 2.2 }],
        spans: [{ x0: state.p[0] - 2 * f.sigma, x1: state.p[0] + 2 * f.sigma, color: alpha(p.heater, 0.12) }],
    });
    const n = history.t.length, stride = Math.max(1, Math.floor(n / 1500));
    const pick = (a) => a.filter((_, i) => i % stride === 0);
    histPlot.set({
        series: [{ x: pick(history.t), y: pick(history.mean), color: p.ebar, width: 1.8 }],
        fills: [{ x: pick(history.t), lo: pick(history.lo), hi: pick(history.hi), color: alpha(p.ebar, 0.15) }],
        hlines: [{ y: 0, color: alpha(p.ink, 0.35), dash: [2, 3] }],
    });
}

onThemeChange(() => { scene.refreshTheme(); for (const v of [main, ...panels]) v.view.drawColorbar(); });
setMainField();
requestAnimationFrame(tick);
