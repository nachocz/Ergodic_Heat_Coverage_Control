// Common start of every page: player frame, theme, music, citation, navigation, maths.
import { sandboxed } from './bridge.js';
import { citeDialog } from './cite.js';
import { enterPlayer, syncPlayer } from './frame.js';
import { renderMath } from './math.js';
import { initMusic } from './music.js';
import { initTheme, toggleTheme } from './theme.js';

// A host that serves the pages in a sandboxed origin (e.g., anonymous.4open.science)
// blocks downloads; there, the links to files open them in a new tab instead.
function openDownloadsInTabs() {
    for (const link of document.querySelectorAll('a[download]')) {
        link.removeAttribute('download');
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = link.textContent.replace(/^Download/, 'Open');
    }
}

// On a sandboxed host the pages run without player.html and without storage: a link
// to another page carries the theme and the music that is playing (?theme=, ?music=).
function carryStateInLinks(music) {
    document.addEventListener('click', (event) => {
        const link = event.target.closest?.('a[href]');
        const match = link && /^(index|problem|control|stability)\.html(\?[^#]*)?(#.*)?$/.exec(link.getAttribute('href'));
        if (!match) return;
        const params = new URLSearchParams(match[2] || '');
        params.set('theme', document.documentElement.dataset.theme);
        if (music?.on) params.set('music', `${music.position.track}-${music.position.time.toFixed(1)}`);
        else params.delete('music');
        link.setAttribute('href', `${match[1]}.html?${params}${match[3] || ''}`);
    }, true);
}

export async function initPage() {
    if (enterPlayer()) await new Promise(() => {});        // reloading inside player.html
    syncPlayer();
    initTheme();
    document.getElementById('themeButton')?.addEventListener('click', toggleTheme);
    const music = initMusic(document.getElementById('musicButton'));
    for (const el of document.querySelectorAll('[data-cite]')) el.addEventListener('click', () => citeDialog());
    const page = location.pathname.split('/').pop() || 'index.html';
    for (const link of document.querySelectorAll('.topbar-nav a')) {
        if (link.getAttribute('href') === page) link.setAttribute('aria-current', 'page');
    }
    if (sandboxed()) {
        openDownloadsInTabs();
        carryStateInLinks(music);
    }
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
