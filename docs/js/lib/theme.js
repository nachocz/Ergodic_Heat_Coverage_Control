// Light / dark theme, and the colour palette read from the CSS variables, so that
// canvases, the 3D view, and HTML share one set of colours.

const KEY = 'ehcc-theme';
const listeners = new Set();
let cached = null;

export function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
    const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = saved || system;
    cached = null;
}

export function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
    cached = null;
    listeners.forEach((fn) => fn());
}

export function onThemeChange(fn) { listeners.add(fn); }

const NAMES = ['bg', 'surface', 'surface-soft', 'ink', 'ink-soft', 'muted', 'line', 'line-strong', 'accent', 'accent-strong',
    'accent-soft', 'canvas', 'grid', 'grid-strong', 'scene', 'roi', 'heater', 'start', 'traj', 'tstar', 'd-col', 'px', 'py',
    'ebar', 'hot', 'cold', 'hot-soft', 'cold-soft', 't1', 't2', 'nrm', 'roi1d', 's-dlow', 's-dhigh', 's-clow', 's-chigh',
    'good', 'bad'];

// palette().roi, palette().dCol, ... (CSS names in camelCase)
export function palette() {
    if (cached) return cached;
    const style = getComputedStyle(document.documentElement);
    const p = { dark: document.documentElement.dataset.theme === 'dark' };
    for (const name of NAMES) p[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = style.getPropertyValue(`--${name}`).trim();
    cached = p;
    return p;
}

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function alpha(color, a) {
    if (!color.startsWith('#')) return color;
    const [r, g, b] = toRgb(color);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}
export function mix(a, b, t) {
    const x = toRgb(a), y = toRgb(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
