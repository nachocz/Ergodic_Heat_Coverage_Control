// Messages between a page and player.html, the window that holds it in a frame.
// The two windows do not access each other directly: some hosts (e.g., the
// anonymized pages of anonymous.4open.science) serve every document in its own
// sandboxed origin, where only messages pass between them. The messages carry
// only the music state, the theme, and the page name and title.

const TAG = 'ehcc';

// True if this page runs in a frame (normally the frame of player.html).
export const inFrame = () => window.parent !== window;

// Page side.
export function toPlayer(type, data = {}) {
    if (inFrame()) window.parent.postMessage({ [TAG]: type, ...data }, '*');
}
export function fromPlayer(type, fn) {
    window.addEventListener('message', (event) => {
        if (event.source === window.parent && event.data && event.data[TAG] === type) fn(event.data);
    });
}

// Player side: messages to and from the page in `frame`.
export function toPage(frame, type, data = {}) {
    frame.contentWindow?.postMessage({ [TAG]: type, ...data }, '*');
}
export function fromPage(frame, type, fn) {
    window.addEventListener('message', (event) => {
        if (event.source === frame.contentWindow && event.data && event.data[TAG] === type) fn(event.data);
    });
}
