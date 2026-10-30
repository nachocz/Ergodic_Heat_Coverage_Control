// Citation dialog. The article is accepted in the IEEE Transactions on Robotics;
// volume, pages, and DOI are placeholders until it appears on IEEE Xplore.
import { h } from './ui.js';

const TITLE = 'Ergodic Heat Coverage Control: Model-Free Robotic Regulation of Temperature Distributions';

const CITATION = `I. Cuiral-Zueco, J. Thomas, and Y. Mezouar, "${TITLE}," IEEE Transactions on Robotics, vol. <volume>, pp. <pages>, 2026, doi: <doi>.`;
const BIBTEX = [
    '@article{cuiralzueco2026ehcc,',
    '  author  = {Cuiral-Zueco, Ignacio and Thomas, John and Mezouar, Youcef},',
    `  title   = {${TITLE}},`,
    '  journal = {IEEE Transactions on Robotics},',
    '  year    = {2026},',
    '  volume  = {<volume>},',
    '  pages   = {<pages>},',
    '  doi     = {<doi>},',
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
        h('p', { class: 'cite-note' }, 'Accepted for publication in the IEEE Transactions on Robotics (T-RO). Volume, pages, and DOI will be added when the article appears on IEEE Xplore.'),
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
