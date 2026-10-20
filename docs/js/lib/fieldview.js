// 2D views of fields on Omega = [0, 1]^2 (y up, as imshow with origin="lower"),
// with the overlays of the paper figures: Omega_ROI dotted, the focal point p and
// its kernel footprint, the trajectory, the start point, and disturbances.
import { COLORMAPS } from './colormap.js';
import { onThemeChange, palette } from './theme.js';

// Boundary of a binary mask (marching squares at level 1/2), chained into polylines
// in normalized coordinates.
export function maskContours(mask, N) {
    const segs = [];
    const P = (ix, iy) => [ix / (N - 1), iy / (N - 1)];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (let iy = 0; iy < N - 1; iy++) for (let ix = 0; ix < N - 1; ix++) {
        const a = mask[iy * N + ix], b = mask[iy * N + ix + 1], c = mask[(iy + 1) * N + ix + 1], d = mask[(iy + 1) * N + ix];
        const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const pa = P(ix, iy), pb = P(ix + 1, iy), pc = P(ix + 1, iy + 1), pd = P(ix, iy + 1);
        const e = { b: mid(pa, pb), r: mid(pb, pc), t: mid(pd, pc), l: mid(pa, pd) };
        const table = { 1: [['l', 'b']], 2: [['b', 'r']], 3: [['l', 'r']], 4: [['r', 't']], 5: [['l', 't'], ['b', 'r']], 6: [['b', 't']],
            7: [['l', 't']], 8: [['t', 'l']], 9: [['t', 'b']], 10: [['t', 'r'], ['l', 'b']], 11: [['t', 'r']], 12: [['r', 'l']],
            13: [['r', 'b']], 14: [['b', 'l']] };
        for (const [u, v] of table[code]) segs.push([e[u], e[v]]);
    }
    // chain segments sharing end points
    const key = (q) => `${Math.round(q[0] * 1e6)},${Math.round(q[1] * 1e6)}`;
    const ends = new Map();
    segs.forEach((s, i) => { for (const q of s) { const k = key(q); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
    const used = new Uint8Array(segs.length), lines = [];
    for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue;
        used[i] = 1;
        const line = [segs[i][0], segs[i][1]];
        for (const forward of [true, false]) {
            for (;;) {
                const tip = forward ? line[line.length - 1] : line[0];
                const next = (ends.get(key(tip)) || []).find((j) => !used[j]);
                if (next === undefined) break;
                used[next] = 1;
                const [q0, q1] = segs[next], other = key(q0) === key(tip) ? q1 : q0;
                if (forward) line.push(other); else line.unshift(other);
            }
        }
        lines.push(line);
    }
    return lines;
}

export class FieldView {
    constructor(canvas, { cmap = 'hot', N = 100, colorbar = null, unit = '°C', onPointer = null, digits = 0, wheel = false } = {}) {
        Object.assign(this, { canvas, cmap, N, colorbarCanvas: colorbar, unit, onPointer, digits, wheel });
        this.lo = 0; this.hi = 1;
        this.field = null;
        this.overlays = {};
        this.image = document.createElement('canvas');
        this.image.width = N; this.image.height = N;
        this.pixels = this.image.getContext('2d').createImageData(N, N);
        new ResizeObserver(() => this.draw()).observe(canvas);
        onThemeChange(() => this.draw());
        if (onPointer) this.bindPointer();
    }

    setRange(lo, hi) {
        if (lo === this.lo && hi === this.hi && this.cbDigits === this.digits) return;
        this.lo = lo; this.hi = hi; this.cbDigits = this.digits;
        this.drawColorbar();
    }

    setField(field) {
        this.field = field;
        const { N, pixels } = this, lut = COLORMAPS[this.cmap], span = (this.hi - this.lo) || 1;
        const data = pixels.data;
        for (let iy = 0; iy < N; iy++) {
            const row = (N - 1 - iy) * N;
            for (let ix = 0; ix < N; ix++) {
                const v = field[iy * N + ix];
                const c = 3 * Math.max(0, Math.min(255, Math.round(255 * (v - this.lo) / span)));
                const o = 4 * (row + ix);
                data[o] = lut[c]; data[o + 1] = lut[c + 1]; data[o + 2] = lut[c + 2]; data[o + 3] = 255;
            }
        }
        this.image.getContext('2d').putImageData(pixels, 0, 0);
    }

    set(overlays) { Object.assign(this.overlays, overlays); }

    size() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2), w = this.canvas.clientWidth, h = this.canvas.clientHeight;
        if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
            this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
        }
        return { w, h, dpr };
    }

    draw() {
        const { w, h, dpr } = this.size();
        if (!w || !h) return;
        const ctx = this.canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const N = this.N, half = 0.5 / (N - 1);
        if (this.field) {
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(this.image, -half * w, -half * h, w * (1 + 2 * half), h * (1 + 2 * half));
        }
        const p = palette(), o = this.overlays;
        const X = (x) => x * w, Y = (y) => (1 - y) * h;
        const poly = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); };
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';

        if (o.section) {                             // a section line
            ctx.strokeStyle = o.section.color || '#e08a2e'; ctx.lineWidth = 2;
            poly([[0.02, o.section.y], [0.98, o.section.y]]); ctx.stroke();
        }
        if (o.trail && o.trail.length > 1) {         // trajectory, older parts fainter
            const pts = o.trail, n = pts.length, chunks = 12;
            ctx.lineWidth = o.trailWidth || 1.1;
            for (let c = 0; c < chunks; c++) {
                const a = Math.floor(c * (n - 1) / chunks), b = Math.floor((c + 1) * (n - 1) / chunks) + 1;
                ctx.strokeStyle = o.trailColor || '#bfe3ff';
                ctx.globalAlpha = 0.15 + 0.75 * (c + 1) / chunks;
                poly(pts.slice(a, b + 1)); ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }
        if (o.roi) {                                 // Omega_ROI, dotted
            ctx.strokeStyle = p.roi; ctx.lineWidth = 2.2; ctx.setLineDash([0.1, 4.2]);
            for (const line of o.roi) { poly(line); ctx.stroke(); }
            ctx.setLineDash([]);
        }
        if (o.disturbance) {
            const dist = o.disturbance, color = dist.P >= 0 ? p.hot : p.cold;
            ctx.strokeStyle = color; ctx.lineWidth = dist.active ? 2.2 : 1.4; ctx.setLineDash(dist.active ? [] : [4, 3]);
            ctx.beginPath(); ctx.arc(X(dist.center[0]), Y(dist.center[1]), dist.sigma * w, 0, 2 * Math.PI); ctx.stroke();
            ctx.setLineDash([]);
            if (dist.active) { ctx.fillStyle = color; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1; }
            ctx.fillStyle = color; ctx.font = `700 10px ${getComputedStyle(document.body).fontFamily}`; ctx.textAlign = 'center';
            ctx.fillText(dist.P >= 0 ? 'hot' : 'cold', X(dist.center[0]), Y(dist.center[1]) - dist.sigma * w - 4);
        }
        if (o.start) {
            ctx.fillStyle = p.start; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(X(o.start[0]), Y(o.start[1]), 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        }
        if (o.heater) {                              // focal point p and the kernel footprint (2 sigma)
            const { p: hp, sigma, strength = 1 } = o.heater;
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
            ctx.globalAlpha = 0.35 + 0.6 * strength;
            ctx.beginPath(); ctx.arc(X(hp[0]), Y(hp[1]), 2 * sigma * w, 0, 2 * Math.PI); ctx.stroke();
            ctx.setLineDash([]); ctx.globalAlpha = 1;
            ctx.fillStyle = p.heater; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.3;
            ctx.beginPath(); ctx.arc(X(hp[0]), Y(hp[1]), 5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        }
        if (o.label) {
            ctx.font = `600 10px ${getComputedStyle(document.body).fontFamily}`; ctx.textAlign = 'left';
            ctx.fillStyle = 'rgba(0,0,0,0.45)'; const tw = ctx.measureText(o.label).width;
            ctx.fillRect(4, 4, tw + 8, 15); ctx.fillStyle = '#ffffff'; ctx.fillText(o.label, 8, 15);
        }
    }

    drawColorbar() {
        const c = this.colorbarCanvas;
        if (!c) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
        if (!w || !h) return;
        c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
        const ctx = c.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const lut = COLORMAPS[this.cmap], p = palette(), barW = 8, top = 6, bottom = h - 6;
        for (let y = top; y < bottom; y++) {
            const i = 3 * Math.round(255 * (bottom - y) / (bottom - top));
            ctx.fillStyle = `rgb(${lut[i]}, ${lut[i + 1]}, ${lut[i + 2]})`;
            ctx.fillRect(0, y, barW, 1);
        }
        ctx.strokeStyle = p.lineStrong; ctx.strokeRect(0.5, top + 0.5, barW - 1, bottom - top - 1);
        ctx.fillStyle = p.muted; ctx.font = `9.5px ${getComputedStyle(document.body).fontFamily}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const ticks = 4;
        for (let k = 0; k <= ticks; k++) {
            const v = this.lo + (this.hi - this.lo) * k / ticks, y = bottom - (bottom - top) * k / ticks;
            ctx.fillText(v.toFixed(this.digits), barW + 3, y);
        }
    }

    bindPointer() {
        const c = this.canvas;
        c.classList.add('interactive');
        const pos = (event) => {
            const r = c.getBoundingClientRect();
            return [Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (event.clientY - r.top) / r.height))];
        };
        let down = false;
        c.addEventListener('pointerdown', (e) => {
            down = true;
            try { c.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
            this.onPointer({ type: 'down', p: pos(e), shift: e.shiftKey });
        });
        c.addEventListener('pointermove', (e) => { this.onPointer({ type: down ? 'drag' : 'hover', p: pos(e), shift: e.shiftKey }); });
        const up = (e) => { if (!down) return; down = false; this.onPointer({ type: 'up', p: pos(e), shift: e.shiftKey }); };
        c.addEventListener('pointerup', up);
        c.addEventListener('pointercancel', up);
        if (this.wheel) c.addEventListener('wheel', (e) => { e.preventDefault(); this.onPointer({ type: 'wheel', delta: Math.sign(e.deltaY), p: pos(e) }); }, { passive: false });
    }
}

// A field panel: title, canvas, colour bar.
export function fieldPanel(title, note, opts) {
    const canvas = document.createElement('canvas');
    canvas.className = 'field-canvas';
    const bar = document.createElement('canvas');
    bar.className = 'colorbar';
    const el = document.createElement('div');
    el.className = 'field';
    const head = document.createElement('div');
    head.className = 'field-title';
    head.append(title, note);
    const body = document.createElement('div');
    body.className = 'field-body';
    body.append(canvas, bar);
    el.append(head, body);
    const view = new FieldView(canvas, { ...opts, colorbar: bar });
    new ResizeObserver(() => view.drawColorbar()).observe(bar);
    return { el, view, head };
}
