// Optional background music: calm piano pieces, Erik Satie in public-domain
// recordings and Kevin MacLeod under CC BY 4.0 (see audio/CREDITS.md). Every
// visit starts silent: the music plays only after the user turns it on.
//
// The pages normally run inside player.html, which owns one music engine for
// the whole visit, so the music continues without a break while the pages
// change. A page opened on its own (outside the player) gets its own engine,
// also silent until turned on, which then resumes the saved track and position.

const TRACKS = [
    { src: 'audio/meditation-impromptu-01.mp3', title: 'Kevin MacLeod, Meditation Impromptu 01 (CC BY 4.0)' },
    { src: 'audio/gymnopedie1.mp3', title: 'Erik Satie, Gymnopédie No. 1 (Robin Alciatore)' },
    { src: 'audio/clean-soul.mp3', title: 'Kevin MacLeod, Clean Soul (CC BY 4.0)' },
    { src: 'audio/gnossienne1.mp3', title: 'Erik Satie, Gnossienne No. 1 (La Pianista)' },
    { src: 'audio/light-thought-1.mp3', title: 'Kevin MacLeod, Light Thought var 1 (CC BY 4.0)' },
    { src: 'audio/meditation-impromptu-02.mp3', title: 'Kevin MacLeod, Meditation Impromptu 02 (CC BY 4.0)' },
    { src: 'audio/gnossienne3.mp3', title: 'Erik Satie, Gnossienne No. 3 (La Pianista)' },
];
const POSITION = 'ehcc-music-position'; // sessionStorage: {track, time}
const VOLUME = 0.3;

const store = (storage, key, value) => { try { storage.setItem(key, value); } catch { /* unavailable */ } };
const load = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };

// One audio element, a playlist, fades, and listeners for the button(s).
export function createMusicEngine() {
    const audio = new Audio();
    audio.preload = 'auto';
    const listeners = new Set();
    let on = false;                               // silent until the user turns it on
    let blocked = false, fader = null;
    // A new visit starts with a random piece; within the same tab, the saved
    // track and position are resumed.
    let track = Math.floor(Math.random() * TRACKS.length), startAt = 0;
    try {
        const saved = JSON.parse(load(sessionStorage, POSITION) || 'null');
        if (saved && Number.isInteger(saved.track) && TRACKS[saved.track]) { track = saved.track; startAt = saved.time || 0; }
    } catch { /* ignore */ }

    const notify = () => listeners.forEach((fn) => { try { fn(); } catch { listeners.delete(fn); } });
    function setTrack(time = 0) {
        audio.src = TRACKS[track].src;
        if (time > 0) {
            audio.addEventListener('loadedmetadata', () => {
                try { audio.currentTime = Math.min(time, Math.max(0, audio.duration - 2)); } catch { /* not seekable */ }
            }, { once: true });
        }
    }
    function savePosition() {
        if (audio.src) store(sessionStorage, POSITION, JSON.stringify({ track, time: audio.currentTime || 0 }));
    }
    function fadeTo(target, ms, then) {
        clearInterval(fader);
        const from = audio.volume, steps = Math.max(1, Math.round(ms / 50));
        let i = 0;
        fader = setInterval(() => {
            i += 1;
            audio.volume = Math.min(1, Math.max(0, from + (target - from) * i / steps));
            if (i >= steps) { clearInterval(fader); if (then) then(); }
        }, 50);
    }
    async function play(fadeMs) {
        audio.volume = 0;
        try {
            await audio.play();
            blocked = false;
            fadeTo(VOLUME, fadeMs);
        } catch {
            blocked = true;                       // autoplay policy: wait for a gesture
        }
        notify();
    }

    audio.addEventListener('ended', () => {
        track = (track + 1) % TRACKS.length;
        setTrack(0);
        if (on) play(1500);
    });
    window.addEventListener('pagehide', savePosition);
    setInterval(() => { if (!audio.paused) savePosition(); }, 2000);

    const engine = {
        get on() { return on; },
        get blocked() { return blocked; },
        get playing() { return !audio.paused; },
        get title() { return TRACKS[track].title; },
        toggle() {
            on = !on;
            if (on) {
                if (!audio.src) setTrack(startAt);
                play(1500);
            } else {
                savePosition();
                blocked = false;
                fadeTo(0, 500, () => audio.pause());
                notify();
            }
        },
        // Called on any click or key press: starts playback that the browser blocked.
        gesture() { if (on && blocked && audio.paused) play(1500); },
        // Skip to the next piece: short fade out, then fade in the next one.
        next() {
            if (!on) return;
            const advance = () => {
                track = (track + 1) % TRACKS.length;
                setTrack(0);
                play(800);
            };
            if (audio.paused) advance();
            else fadeTo(0, 300, advance);
        },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
    return engine;
}

// The engine of the enclosing player, if this page runs inside player.html.
function playerEngine() {
    try {
        if (window.top !== window && window.top.ehccMusic) return window.top.ehccMusic;
    } catch { /* not same-origin */ }
    return null;
}

// Bind the top-bar button to the player's engine (or to a page-local one).
export function initMusic(button) {
    if (!button) return;
    const engine = playerEngine() || createMusicEngine();
    // A small "next song" arrow beside the button, shown while the music is on.
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'button music-next';
    next.textContent = '›';
    next.setAttribute('aria-label', 'Next song');
    next.addEventListener('click', () => engine.next());
    button.after(next);
    function sync() {
        next.hidden = !engine.on;
        next.title = `Next song (now playing: ${engine.title})`;
        button.setAttribute('aria-pressed', String(engine.on));
        button.classList.toggle('music-on', engine.on);
        button.title = !engine.on ? 'Background music: off (click to play calm piano pieces, public domain and CC BY)'
            : engine.blocked ? 'Background music: on. Click anywhere on the page to start it.'
                : `Background music: on, ${engine.title}. Click to turn off.`;
    }
    button.addEventListener('click', () => engine.toggle());
    const gesture = (event) => { if (event.target !== button && event.target !== next) engine.gesture(); };
    document.addEventListener('pointerdown', gesture, true);
    document.addEventListener('keydown', gesture, true);
    const unsubscribe = engine.subscribe(sync);
    window.addEventListener('pagehide', unsubscribe);   // the player outlives this page
    sync();
}
