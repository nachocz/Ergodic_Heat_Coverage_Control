// The pages run inside player.html, which keeps the background music playing
// while the pages change. A page opened on its own is moved into the player
// (append ?standalone to the address to prevent this); inside the player, the
// page keeps the address bar and the tab title in step with what is shown.

const PLAYER = 'player.html';
export const PAGES = ['index.html', 'problem.html', 'control.html', 'stability.html'];

function currentPage() {
    const page = location.pathname.split('/').pop() || 'index.html';
    const params = new URLSearchParams(location.search);
    params.delete('standalone');
    const query = params.toString();
    return page + (query ? `?${query}` : '') + location.hash;
}

// True if the page is being replaced by the player (stop initializing).
export function enterPlayer() {
    if (window.top !== window) return false;
    if (new URLSearchParams(location.search).has('standalone')) return false;
    location.replace(`${PLAYER}?p=${encodeURIComponent(currentPage())}`);
    return true;
}

// Inside the player: mirror this page's address and title in the top window.
export function syncPlayer() {
    if (window.top === window) return;
    try {
        const page = currentPage();
        window.top.history.replaceState(null, '', page.startsWith('index.html') ? PLAYER : `${PLAYER}?p=${encodeURIComponent(page)}`);
        window.top.document.title = document.title;
    } catch { /* not same-origin */ }
}
