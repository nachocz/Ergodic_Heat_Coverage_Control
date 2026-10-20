// Landing page: previews of the three interactive pages.
import { FieldView, maskContours } from '../lib/fieldview.js';
import { initPage, loadFields } from '../lib/shell.js';
import { onThemeChange, palette } from '../lib/theme.js';
import { defaultConfig, EHCCSimulation } from '../sim/ehcc.js';
import { Loop1D } from '../sim/loop1d.js';

await initPage();
const fields = await loadFields();
const T4 = fields.targets.T4;

// Two square field views side by side on a card canvas; setup(a, b) returns the views.
function pairPreview(canvas, setup) {
    const left = document.createElement('canvas'), right = document.createElement('canvas');
    const paint = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = palette().canvas; ctx.fillRect(0, 0, w, h);
        const side = h - 20, gap = 14, x0 = (w - 2 * side - gap) / 2;
        for (const [c, x] of [[left, x0], [right, x0 + side + gap]]) {
            c.style.width = `${side}px`; c.style.height = `${side}px`;
            ctx.drawImage(c, x, 10, side, side);
        }
    };
    // detached canvases need a size: emulate clientWidth / clientHeight
    for (const c of [left, right]) Object.defineProperties(c, { clientWidth: { get: () => canvas.clientHeight - 20 }, clientHeight: { get: () => canvas.clientHeight - 20 } });
    const views = setup(left, right);
    const draw = () => { views.forEach((v) => v.draw()); paint(); };
    new ResizeObserver(draw).observe(canvas);
    onThemeChange(draw);
}

const roi = new Uint8Array(T4.data.length);
T4.data.forEach((v, i) => { roi[i] = v > T4.T_amb + 0.01 ? 1 : 0; });
const roiLines = maskContours(roi, fields.N);

// 1: target and Omega_ROI, and the error with the heater footprint
pairPreview(document.getElementById('preview1'), (a, b) => {
    const va = new FieldView(a, { cmap: 'hot' });
    va.setRange(T4.T_amb, T4.T_max); va.setField(T4.data); va.set({ roi: roiLines, label: 'T*  and  Ω_ROI' });
    const vb = new FieldView(b, { cmap: 'rdbu' });
    const e = Float64Array.from(T4.data, (v, i) => {
        const ix = i % 100, iy = Math.floor(i / 100), x = ix / 99 - 0.42, y = iy / 99 - 0.45;
        return roi[i] ? (v - T4.T_amb) * (1 - 1.5 * Math.exp(-(x * x + y * y) / 0.01)) : 0;
    });
    vb.setRange(-10, 10); vb.setField(e); vb.set({ roi: roiLines, heater: { p: [0.42, 0.45], sigma: 0.03 }, label: 'e = T* − T' });
    return [va, vb];
});

// 2: a short closed-loop run on T4
const sim = new EHCCSimulation(defaultConfig(), T4.data);
const trail = [];
for (let k = 0; k < 900; k++) { const row = sim.step(); if (k % 2 === 0) trail.push([row.px, row.py]); }
pairPreview(document.getElementById('preview2'), (a, b) => {
    const va = new FieldView(a, { cmap: 'hot' });
    va.setRange(T4.T_amb, T4.T_max); va.setField(sim.domain.T); va.set({ roi: roiLines, trail, start: [0.25, 0.35], heater: { p: sim.p, sigma: 0.03 }, label: 'T(x, 3 min)' });
    const vb = new FieldView(b, { cmap: 'need' });
    const Phi = sim.domain.heatingDensity();
    let max = 0; for (const v of Phi) max = Math.max(max, v);
    vb.setRange(0, max); vb.setField(Phi); vb.set({ roi: roiLines, label: 'Φ ∝ e₊' });
    return [va, vb];
});

// 3: equilibrium profiles T_g of the 1D loop for increasing gate values
const loop = new Loop1D();
const profiles = [0.05, 0.15, 0.31, 0.6, 1].map((g) => ({ g, T: loop.equilibrium(g) }));
const c3 = document.getElementById('preview3');
function draw3() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = c3.clientWidth, h = c3.clientHeight;
    if (!w || !h) return;
    c3.width = Math.round(w * dpr); c3.height = Math.round(h * dpr);
    const ctx = c3.getContext('2d'), p = palette();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = p.canvas; ctx.fillRect(0, 0, w, h);
    const X = (x) => 16 + x * (w - 32), Y = (T) => h - 14 - (T - 15) / 75 * (h - 28);
    ctx.fillStyle = p.roi1d; ctx.fillRect(X(0.2), 8, X(0.6) - X(0.2), h - 22);
    profiles.forEach(({ T }, j) => {
        ctx.strokeStyle = p.sDlow; ctx.globalAlpha = 0.25 + 0.75 * j / (profiles.length - 1); ctx.lineWidth = 1.6;
        ctx.beginPath(); T.forEach((v, i) => (i ? ctx.lineTo(X(loop.x[i]), Y(v)) : ctx.moveTo(X(loop.x[i]), Y(v)))); ctx.stroke();
    });
    ctx.globalAlpha = 1; ctx.strokeStyle = p.tstar; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4;
    ctx.beginPath(); let pen = false;
    loop.Tstar.forEach((v, i) => { if (!Number.isFinite(v)) { pen = false; return; } if (pen) ctx.lineTo(X(loop.x[i]), Y(v)); else { ctx.moveTo(X(loop.x[i]), Y(v)); pen = true; } });
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = p.muted; ctx.font = `600 10px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillText('T_g(x) for g = 0.05 … 1, and T*(x)', 20, 20);
}
new ResizeObserver(draw3).observe(c3);
onThemeChange(draw3);
