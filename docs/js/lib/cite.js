// Citation dialog. The article is on IEEE Xplore (Early Access); the volume and the
// final page numbers are added when it is assigned to an issue.
import { h } from './ui.js';

const TITLE = 'Ergodic Heat Coverage Control: Model-Free Robotic Regulation of Temperature Distributions';
const DOI = '10.1109/TRO.2026.3752259';

const CITATION = `I. Cuiral-Zueco, J. Thomas, and Y. Mezouar, "${TITLE}," IEEE Transactions on Robotics, pp. 1–20, 2026, doi: ${DOI}.`;
const BIBTEX = [
    '@article{cuiralzueco2026ehcc,',
    '  author  = {Cuiral-Zueco, Ignacio and Thomas, John and Mezouar, Youcef},',
    `  title   = {${TITLE}},`,
    '  journal = {IEEE Transactions on Robotics},',
    '  year    = {2026},',
    '  pages   = {1--20},',
    `  doi     = {${DOI}},`,
    '}',
].join('\n');

async function copy(text, button) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const area = h('textarea', { style: 'position:fixed;opacity:0' });
        area.value = text;
        document.body.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
    }
    button.textContent = 'Copied ✓';
    setTimeout(() => { button.textContent = 'Copy'; }, 1400);
}

export function citeDialog() {
    const block = (title, text) => {
        const copyButton = h('button', { class: 'button small', type: 'button' }, 'Copy');
        copyButton.addEventListener('click', () => copy(text, copyButton));
        return h('div', { class: 'cite-block' }, h('div', { class: 'cite-block-head' }, h('span', {}, title), copyButton), h('pre', {}, text));
    };
    const close = h('button', { class: 'button', type: 'button' }, 'Close');
    const dialog = h('dialog', { class: 'cite-dialog', 'aria-labelledby': 'citeTitle' },
        h('p', { class: 'kicker' }, 'Citation'),
        h('h2', { id: 'citeTitle' }, 'Cite the paper'),
        h('p', { class: 'cite-note' }, 'IEEE Transactions on Robotics (T-RO), Early Access on IEEE Xplore: ',
            h('a', { href: `https://doi.org/${DOI}`, target: '_blank', rel: 'noopener noreferrer' }, `doi.org/${DOI}`), '.'),
        block('Reference', CITATION),
        block('BibTeX', BIBTEX),
        h('div', { class: 'cite-actions' }, close));
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {           // a click on the backdrop closes
        const r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
}
