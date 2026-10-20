// Colour maps of the paper figures as 256-entry RGB tables:
//   hot     temperature T and T* (matplotlib "hot")
//   rdbu    error e = T* - T, red = heat deficit, blue = over-heated (matplotlib "RdBu_r")
//   need    heating density Phi ~ e_+ (Fig. 4)
//   viridis height of the surface
//   metal   material layout: rubber blue, metal red (Fig. 9)

function fromStops(stops) {                     // stops: [[t, '#rrggbb'], ...]
    const lut = new Uint8ClampedArray(256 * 3);
    const rgb = stops.map(([t, c]) => [t, [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))]);
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        let j = 0;
        while (j < rgb.length - 2 && t > rgb[j + 1][0]) j++;
        const [ta, ca] = rgb[j], [tb, cb] = rgb[j + 1];
        const w = Math.min(1, Math.max(0, (t - ta) / (tb - ta || 1)));
        for (let k = 0; k < 3; k++) lut[3 * i + k] = Math.round(ca[k] + (cb[k] - ca[k]) * w);
    }
    return lut;
}

function hot() {                                // matplotlib _hot_data
    const lut = new Uint8ClampedArray(256 * 3);
    const seg = (x, x0, x1, y0) => (x <= x0 ? y0 : x >= x1 ? 1 : y0 + (1 - y0) * (x - x0) / (x1 - x0));
    for (let i = 0; i < 256; i++) {
        const x = i / 255;
        lut[3 * i] = 255 * seg(x, 0, 0.365079, 0.0416);
        lut[3 * i + 1] = x <= 0.365079 ? 0 : 255 * seg(x, 0.365079, 0.746032, 0);
        lut[3 * i + 2] = x <= 0.746032 ? 0 : 255 * seg(x, 0.746032, 1, 0);
    }
    return lut;
}

const RDBU = ['#053061', '#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b', '#67001f'];

export const COLORMAPS = {
    hot: hot(),
    rdbu: fromStops(RDBU.map((c, i) => [i / (RDBU.length - 1), c])),
    need: fromStops([[0, '#ffffff'], [0.25, '#f8c9b8'], [0.5, '#e8705a'], [0.75, '#b71c1c'], [1, '#5c0a0a']]),
    viridis: fromStops([[0, '#440154'], [0.25, '#3b528b'], [0.5, '#21918c'], [0.75, '#5ec962'], [1, '#fde725']]),
    metal: fromStops([[0, '#4a68b0'], [1, '#c8553d']]),
};

// RGB in [0, 255] of value v on [lo, hi].
export function colorAt(name, v, lo, hi) {
    const lut = COLORMAPS[name];
    const i = Math.max(0, Math.min(255, Math.round(255 * (v - lo) / ((hi - lo) || 1))));
    return [lut[3 * i], lut[3 * i + 1], lut[3 * i + 2]];
}

export function cssColor(name, t) {
    const [r, g, b] = colorAt(name, t, 0, 1);
    return `rgb(${r}, ${g}, ${b})`;
}
