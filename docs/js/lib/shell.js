// Common start of every page: player frame, theme, music, citation, navigation, maths.
import { citeDialog } from './cite.js';
import { enterPlayer, syncPlayer } from './frame.js';
import { renderMath } from './math.js';
import { initMusic } from './music.js';
import { initTheme, toggleTheme } from './theme.js';

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
    renderMath(document);
}

let fields = null;
// Targets, material layouts, and the scanned surface (docs/data/fields.json).
export async function loadFields() {
    if (!fields) {
        const { decodeFields } = await import('../sim/ehcc.js');
        const response = await fetch('data/fields.json');
        fields = decodeFields(await response.json());
    }
    return fields;
}
