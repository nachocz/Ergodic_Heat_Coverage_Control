// Equations with KaTeX (vendored, offline), in the notation of the paper.

export const MACROS = {
    '\\R': '\\mathbb{R}',
    '\\vx': '\\mathbf{x}', '\\vp': '\\mathbf{p}', '\\vr': '\\mathbf{r}', '\\vs': '\\mathbf{s}', '\\vk': '\\mathbf{k}',
    '\\vn': '\\mathbf{n}', '\\vt': '\\mathbf{t}', '\\vu': '\\mathbf{u}', '\\vv': '\\mathbf{v}', '\\vR': '\\mathbf{R}',
    '\\ROI': '\\Omega_{\\mathrm{ROI}}', '\\chiROI': '\\chi_{\\mathrm{ROI}}', '\\Ts': 'T^{\\star}',
    '\\qin': 'q_{\\mathrm{in}}', '\\Qin': 'Q_{\\mathrm{in}}', '\\qloss': 'q_{\\mathrm{loss}}',
    '\\Tamb': 'T_{\\mathrm{amb}}', '\\Tsrc': 'T_{\\mathrm{src}}', '\\dlb': 'd_{\\mathrm{lb}}', '\\dmin': 'd_{\\min}',
    '\\dmax': 'd_{\\max}', '\\drng': 'd_{\\mathrm{rng}}', '\\emax': 'e_{\\max}', '\\ebar': '\\bar e', '\\ess': '\\bar e_{\\mathrm{ss}}',
    '\\Dext': 'D_{\\mathrm{ext}}', '\\K': '\\mathcal{K}', '\\E': '\\mathcal{E}', '\\Lk': '\\Lambda_{\\mathbf{k}}',
    '\\norm': '\\lVert #1 \\rVert',
};

export function tex(source, display = false) {
    return window.katex.renderToString(source, {
        displayMode: display, macros: { ...MACROS }, throwOnError: false, strict: 'ignore',
    });
}

// Render every <span class="tex"> (inline) and <div class="tex-block"> (display) below root, once.
export function renderMath(root = document) {
    for (const el of root.querySelectorAll('.tex, .tex-block')) {
        if (el.dataset.rendered) continue;
        const ref = el.dataset.eq ? `<span class="eq-ref">(${el.dataset.eq})</span>` : '';
        el.innerHTML = tex(el.textContent, el.classList.contains('tex-block')) + ref;
        el.dataset.rendered = '1';
    }
}
