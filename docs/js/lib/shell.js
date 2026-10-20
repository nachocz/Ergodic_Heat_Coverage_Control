// Common start of every page: player frame, theme, music, citation, navigation, maths.
import { citeDialog } from './cite.js';
import { enterPlayer, syncPlayer } from './frame.js';
import { renderMath } from './math.js';
import { initMusic } from './music.js';
import { initTheme, toggleTheme } from './theme.js';

// A host that serves the pages in a sandboxed origin (e.g., anonymous.4open.science)
// blocks downloads; there, the links to files open them in a new tab instead.
function openDownloadsInTabs() {
    if (window.origin !== 'null' || location.protocol === 'file:') return;
    for (const link of document.querySelectorAll('a[download]')) {
        link.removeAttribute('download');
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = link.textContent.replace(/^Download/, 'Open');
    }
}

export async function initPage() {
    if (enterPlayer()) await new Promise(() => {});        // reloading inside player.html
    syncPlayer();
    initTheme();
    document.getElementById('themeButton')?.addEventListener('click', toggleTheme);
    initMusic(document.getElementById('musicButton'));
    for (const el of document.querySelectorAll('[data-cite]')) el.addEventListener('click', () => citeDialog());
    const page = location.pathname.split('/').pop() || 'index.html';
    for (const link of document.querySelectorAll('.topbar-nav a')) {
        if (link.getAttribute('href') === page) link.setAttribute('aria-current', 'page');
    }
    openDownloadsInTabs();
    renderMath(document);
}

let fields = null;
// Targets, material layouts, and the scanned surface (docs/data/fields.json). The built
// pages contain them as window.EHCC_FIELDS (tools/build_web.py); a fetch, which fails
// on sandboxed hosts and on file:// addresses, is only the fallback.
export async function loadFields() {
    if (!fields) {
        const { decodeFields } = await import('../sim/ehcc.js');
        fields = decodeFields(window.EHCC_FIELDS || await (await fetch('data/fields.json')).json());
    }
    return fields;
}
