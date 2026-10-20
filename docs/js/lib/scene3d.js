// 3D view (three.js): the surface s(Omega) coloured by a field, Omega_ROI dotted,
// the heat source at r = s(p) + d n with the frame R_s = [t1, t2, n] (red, green,
// blue), its heat cone and footprint, the end-effector trail, and disturbances.
import * as THREE from '../../vendor/three/three.module.min.js';
import { OrbitControls } from '../../vendor/three/OrbitControls.js';
import { COLORMAPS } from './colormap.js';
import { palette } from './theme.js';

const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const LINEAR = Object.fromEntries(Object.entries(COLORMAPS).map(([k, lut]) => [k, Float32Array.from(lut, toLinear)]));

export class SurfaceScene {
    constructor(container, { trailCapacity = 6000 } = {}) {
        this.container = container;
        try {
            this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        } catch {
            container.append(Object.assign(document.createElement('p'), { className: 'view3d-hint', textContent: 'WebGL is not available in this browser.' }));
            this.failed = true;
            return;
        }
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        container.prepend(this.renderer.domElement);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(34, 1, 0.01, 20);
        this.camera.up.set(0, 0, 1);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.12;
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 2.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(-0.6, -0.4, 1.2);
        this.scene.add(sun);
        this.root = new THREE.Group();
        this.scene.add(this.root);
        this.trailCapacity = trailCapacity;
        this.buildHeater();
        this.buildTrail();
        this.dirty = true;
        new ResizeObserver(() => this.resize()).observe(container);
        this.controls.addEventListener('change', () => { this.dirty = true; });
        const loop = () => {
            if (this.disposed) return;
            if (this.controls.update() || this.dirty) { this.renderer.render(this.scene, this.camera); this.dirty = false; }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    resize() {
        if (this.failed) return;
        const w = this.container.clientWidth, h = this.container.clientHeight;
        if (!w || !h) return;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.dirty = true;
    }

    // ---------------------------------------------------------------- surface
    setSurface(surface) {
        if (this.failed) return;
        this.surface = surface;
        const { N, L, height } = surface;
        if (this.mesh) { this.root.remove(this.mesh, this.grid); this.mesh.geometry.dispose(); this.grid.geometry.dispose(); }
        const pos = new Float32Array(N * N * 3);
        for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
            const i = iy * N + ix;
            pos[3 * i] = ix / (N - 1) * L; pos[3 * i + 1] = iy / (N - 1) * L; pos[3 * i + 2] = height[i];
        }
        const index = [];
        for (let iy = 0; iy < N - 1; iy++) for (let ix = 0; ix < N - 1; ix++) {
            const a = iy * N + ix;
            index.push(a, a + 1, a + N, a + 1, a + N + 1, a + N);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.colors = new Float32Array(N * N * 3).fill(0.05);
        geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
        geometry.setIndex(index);
        geometry.computeVertexNormals();
        this.mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
        // light coordinate lines every tenth of the domain, slightly above the surface
        const lines = [], lift = 0.0008, step = Math.max(1, Math.round((N - 1) / 10));
        for (let k = 0; k < N; k += step) for (let j = 0; j < N - 1; j++) {
            for (const [a, b] of [[k * N + j, k * N + j + 1], [j * N + k, (j + 1) * N + k]])
                lines.push(pos[3 * a], pos[3 * a + 1], pos[3 * a + 2] + lift, pos[3 * b], pos[3 * b + 1], pos[3 * b + 2] + lift);
        }
        const gridGeometry = new THREE.BufferGeometry();
        gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
        this.grid = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1 }));
        this.root.add(this.mesh, this.grid);
        this.root.position.set(-L / 2, -L / 2, 0);
        this.clearTrail();
        if (!this.framed) this.frameCamera();
        this.dirty = true;
    }

    frameCamera() {
        const L = this.surface.L;
        // the whole surface and the source up to about 0.45 m above it
        this.camera.position.set(-0.35 * L, -2.0 * L, 0.55 + 0.6 * L);
        this.controls.target.set(0, 0, 0.13);
        this.controls.update();
        this.framed = true;
    }

    setColors(field, cmap, lo, hi) {
        if (this.failed || !this.mesh) return;
        const lut = LINEAR[cmap], span = (hi - lo) || 1, c = this.colors;
        for (let i = 0; i < field.length; i++) {
            const k = 3 * Math.max(0, Math.min(255, Math.round(255 * (field[i] - lo) / span)));
            c[3 * i] = lut[k]; c[3 * i + 1] = lut[k + 1]; c[3 * i + 2] = lut[k + 2];
        }
        this.mesh.geometry.attributes.color.needsUpdate = true;
        this.dirty = true;
    }

    // Omega_ROI boundary as dots on the surface (polylines in normalized coordinates).
    setRoi(lines) {
        if (this.failed || !this.surface) return;
        if (this.roi) { this.root.remove(this.roi); this.roi.geometry.dispose(); }
        const pts = [], spacing = 0.008, s = this.surface;
        for (const line of lines) {
            let carry = 0;
            for (let i = 1; i < line.length; i++) {
                const [x0, y0] = line[i - 1], [x1, y1] = line[i];
                const len = Math.hypot(x1 - x0, y1 - y0);
                for (let u = carry; u < len; u += spacing) {
                    const q = [x0 + (x1 - x0) * u / len, y0 + (y1 - y0) * u / len];
                    const [X, Y, Z] = s.point(q);
                    pts.push(X, Y, Z + 0.002);
                }
                carry = (carry - len) % spacing; if (carry < 0) carry += spacing;
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        this.roi = new THREE.Points(geometry, new THREE.PointsMaterial({ color: new THREE.Color(palette().roi), size: 3.2, sizeAttenuation: false }));
        this.root.add(this.roi);
        this.dirty = true;
    }

    // ---------------------------------------------------------------- heat source
    buildHeater() {
        const g = new THREE.Group();
        const L = 0.05;
        this.axes = ['t1', 't2', 'nrm'].map((name) => {
            const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(L, 0, 0)]);
            const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: new THREE.Color(palette()[name]) }));
            line.frustumCulled = false;
            g.add(line);
            return line;
        });
        this.sphere = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 20, 14), new THREE.MeshLambertMaterial({ color: new THREE.Color(palette().heater) }));
        this.nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.011, 0.07, 24, 1, true),
            new THREE.MeshLambertMaterial({ color: 0x3a3c42, side: THREE.DoubleSide }));
        this.cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 40, 1, true),
            new THREE.MeshBasicMaterial({ color: 0xffc35c, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
        this.footprint = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
        const standoff = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
        this.standoffLine = new THREE.Line(standoff, new THREE.LineDashedMaterial({ color: 0xeeeeee, dashSize: 0.006, gapSize: 0.005 }));
        this.standoffLine.frustumCulled = false;
        g.add(this.sphere, this.nozzle, this.cone, this.footprint, this.standoffLine);
        this.heater = g;
        this.scene.add(g);
        g.visible = false;
    }

    // p in [0, 1]^2, standoff d [m], kernel width sigma (normalized), strength in [0, 1] (eta / eta_max).
    setHeater({ p, d, sigma, strength = 1, visible = true }) {
        if (this.failed || !this.surface) return;
        this.heater.visible = visible;
        if (!visible) { this.dirty = true; return; }
        const { r, R, s } = this.surface.pose(p, d);
        const o = this.root.position;
        const at = (v) => new THREE.Vector3(v[0] + o.x, v[1] + o.y, v[2] + o.z);
        const rv = at(r), sv = at(s);
        const n = new THREE.Vector3(...R.n), t1 = new THREE.Vector3(...R.t1), t2 = new THREE.Vector3(...R.t2);
        this.sphere.position.copy(rv);
        [t1, t2, n].forEach((dir, i) => {
            const attr = this.axes[i].geometry.attributes.position;
            const end = rv.clone().addScaledVector(dir, 0.055);
            attr.setXYZ(0, rv.x, rv.y, rv.z); attr.setXYZ(1, end.x, end.y, end.z); attr.needsUpdate = true;
        });
        const up = new THREE.Vector3(0, 1, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(up, n);
        this.nozzle.quaternion.copy(q);
        this.nozzle.position.copy(rv).addScaledVector(n, 0.042);
        // heat cone from the nozzle tip to the footprint of radius 2 sigma L on the surface
        const radius = Math.max(2 * sigma * this.surface.L, 0.002);
        this.cone.quaternion.copy(q);
        this.cone.scale.set(radius, Math.max(d, 1e-3), radius);
        this.cone.position.copy(sv).addScaledVector(n, d / 2);
        this.cone.material.opacity = 0.05 + 0.3 * strength;
        this.footprint.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
        this.footprint.scale.set(radius, radius, 1);
        this.footprint.position.copy(sv).addScaledVector(n, 0.002);
        this.footprint.material.opacity = 0.15 + 0.55 * strength;
        const attr = this.standoffLine.geometry.attributes.position;
        attr.setXYZ(0, sv.x, sv.y, sv.z); attr.setXYZ(1, rv.x, rv.y, rv.z); attr.needsUpdate = true;
        this.standoffLine.computeLineDistances();
        this.dirty = true;
    }

    // ---------------------------------------------------------------- trail of r(t)
    buildTrail() {
        const geometry = new THREE.BufferGeometry();
        this.trailPos = new Float32Array(this.trailCapacity * 3);
        this.trailCol = new Float32Array(this.trailCapacity * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
        geometry.setDrawRange(0, 0);
        this.trail = new THREE.Line(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
        this.trail.frustumCulled = false;
        this.scene.add(this.trail);
        this.trailCount = 0;
    }

    clearTrail() { if (this.trail) { this.trailCount = 0; this.trail.geometry.setDrawRange(0, 0); this.dirty = true; } }

    pushTrail(r) {
        if (this.failed || !this.surface) return;
        const o = this.root.position, cap = this.trailCapacity;
        if (this.trailCount === cap) { this.trailPos.copyWithin(0, 3 * Math.floor(cap / 4)); this.trailCount = cap - Math.floor(cap / 4); }
        const i = this.trailCount++;
        this.trailPos[3 * i] = r[0] + o.x; this.trailPos[3 * i + 1] = r[1] + o.y; this.trailPos[3 * i + 2] = r[2] + o.z;
        this.trailDirty = true;
    }

    // Colours old -> recent from pale yellow to blue (as in the 3D renders of the paper).
    refreshTrail() {
        if (!this.trailDirty || this.failed) return;
        const n = this.trailCount, c = this.trailCol;
        for (let i = 0; i < n; i++) {
            const t = n > 1 ? i / (n - 1) : 1;
            c[3 * i] = 0.98 - 0.85 * t; c[3 * i + 1] = 0.92 - 0.62 * t; c[3 * i + 2] = 0.45 + 0.5 * t;
        }
        const geometry = this.trail.geometry;
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        geometry.setDrawRange(0, n);
        this.trailDirty = false;
        this.dirty = true;
    }

    // ---------------------------------------------------------------- disturbance
    setDisturbance(dist) {
        if (this.failed || !this.surface) return;
        if (!this.dist) {
            this.dist = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, 2 * Math.PI, 0, Math.PI / 2),
                new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
            this.scene.add(this.dist);
        }
        this.dist.visible = !!(dist && dist.active);
        if (dist && dist.active) {
            const [x, y, z] = this.surface.point(dist.center), o = this.root.position, rad = dist.sigma * this.surface.L;
            this.dist.position.set(x + o.x, y + o.y, z + o.z);
            this.dist.scale.set(rad, rad, rad * 0.5);
            this.dist.material.color = new THREE.Color(dist.P >= 0 ? palette().hot : palette().cold);
        }
        this.dirty = true;
    }

    refreshTheme() {
        if (this.failed) return;
        const p = palette();
        ['t1', 't2', 'nrm'].forEach((name, i) => this.axes[i].material.color.set(p[name]));
        this.sphere.material.color.set(p.heater);
        if (this.roi) this.roi.material.color.set(p.roi);
        this.dirty = true;
    }

    snapshot() { return this.failed ? null : this.renderer.domElement; }
}
