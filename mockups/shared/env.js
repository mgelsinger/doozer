// Mockup plumbing shared by every version: display modes, the desktop-shell
// bridge, and the "Review tools" panel. None of this is product code.

import { PALETTES, PALETTE_KEYS } from './art.js';
import { PetSim } from './sim.js';
import { sfx } from './sfx.js';

const params = new URLSearchParams(location.search);

/** Running inside the desktop shell (or asked to look like it): transparent, no fake desktop. */
export const BARE = params.has('bare') || !!window.doozerShell;
/** Running as a live preview inside the gallery: no saving, no sound, no panels. */
export const THUMB = params.has('thumb');

const root = document.documentElement;
root.classList.toggle('bare', BARE);
root.classList.toggle('thumb', THUMB);
root.classList.toggle('mock', !BARE);
if (THUMB) sfx.disable();

/** One shared Doozer across every mockup (thumbnails get a throwaway one). */
export function createSim() {
  const sim = new PetSim({ persist: !THUMB, speed: THUMB ? 60 : undefined });
  if (THUMB) sim.debugSetNeeds({ tummy: 78, fun: 82, energy: 85, clean: 90 });
  return sim.start();
}

/** Each version remembers its own colour so the gallery shows a spread by default. */
export function loadPalette(version, fallback) {
  try {
    const saved = localStorage.getItem(`doozer:palette:${version}`);
    if (saved && PALETTES[saved]) return saved;
  } catch { /* ignore */ }
  return fallback;
}

/**
 * Desktop shell bridge. The shell window is transparent; this tells it to let
 * clicks fall through wherever the page has nothing under the cursor.
 * An element with data-hit="custom" defers to window.__dzHit(x, y) (used by the 3D canvas).
 */
export function setupShell() {
  const shell = window.doozerShell;
  if (!shell) return;
  let through = null;
  let buttons = 0;
  const update = (x, y) => {
    // Never change click-through in the middle of a press or drag. A dragged thing can lag
    // one frame behind the cursor; flipping to pass-through then would swallow the mouse-up
    // and leave the drag stuck forever.
    if (buttons) return;
    const el = document.elementFromPoint(x, y);
    let hit = !!el && el !== document.documentElement && el !== document.body;
    if (hit && el.dataset.hit === 'custom' && typeof window.__dzHit === 'function') hit = !!window.__dzHit(x, y);
    if (through !== !hit) {
      through = !hit;
      shell.setClickThrough(through);
    }
  };
  addEventListener('mousemove', (e) => { buttons = e.buttons; update(e.clientX, e.clientY); }, { passive: true });
  addEventListener('mousedown', (e) => { buttons = e.buttons; }, true);
  addEventListener('mouseup', (e) => { buttons = e.buttons; update(e.clientX, e.clientY); }, true);
  addEventListener('blur', () => { buttons = 0; });
  addEventListener('contextmenu', (e) => { e.preventDefault(); shell.showMenu(); });
}

const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
};

/**
 * Caption + floating "Review tools" panel.
 * @param {PetSim} sim
 * @param {object} opts
 * @param {string} opts.version   storage key, e.g. "v1"
 * @param {string} opts.title     e.g. "V1 · Pocket Doozer"
 * @param {string} [opts.hint]    one-line "try this" text
 * @param {string} [opts.palette] current palette key
 * @param {(key: string) => void} [opts.onPalette]
 * @param {Array<{label: string, run: () => void}>} [opts.extra] version-specific buttons
 */
export function mountReview(sim, { version, title, hint = '', palette, onPalette, extra = [] }) {
  setupShell();
  if (BARE || THUMB) return;

  const caption = el('header', 'caption');
  caption.innerHTML = `<a href="../" class="caption-back" title="Back to the gallery">←</a><div><b>${title}</b><span>${hint}</span></div>`;
  document.body.appendChild(caption);

  const panel = el('details', 'review');
  panel.open = localStorage.getItem('doozer:review-open') !== '0';
  panel.addEventListener('toggle', () => localStorage.setItem('doozer:review-open', panel.open ? '1' : '0'));
  panel.appendChild(el('summary', '', 'Review tools'));
  const body = el('div', 'review-body');
  panel.appendChild(body);

  const row = (label) => {
    const r = el('div', 'review-row');
    r.appendChild(el('span', 'review-label', label));
    const group = el('div', 'review-group');
    r.appendChild(group);
    body.appendChild(r);
    return group;
  };
  const button = (group, label, run, title) => {
    const b = el('button', 'review-btn', label);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', run);
    group.appendChild(b);
    return b;
  };

  // Time warp
  const speeds = [[1, 'Real time'], [60, '60×'], [600, '600×']];
  const timeGroup = row('Time');
  const speedButtons = speeds.map(([value, label]) => button(timeGroup, label, () => { sim.setSpeed(value); paintSpeed(); },
    value === 1 ? 'One second is one second' : `One real second = ${value} pet seconds`));
  const paintSpeed = () => speedButtons.forEach((b, i) => b.classList.toggle('is-on', speeds[i][0] === sim.speed));
  paintSpeed();

  // State shortcuts
  const petGroup = row('Doozer');
  button(petGroup, 'Make needy', () => sim.debugSetNeeds({ tummy: 18, fun: 22, energy: 26, clean: 20 }), 'Drop every need so you can see the sad states');
  button(petGroup, 'Refill', () => sim.debugSetNeeds({ tummy: 96, fun: 96, energy: 96, clean: 96 }), 'Fill every need');
  button(petGroup, '+ Mess', () => sim.debugAddMess(), 'Make Doozer leave a little mess');
  for (const x of extra) button(petGroup, x.label, x.run, x.title);

  // Colour
  if (onPalette) {
    const colourGroup = row('Colour');
    let current = palette;
    const swatches = PALETTE_KEYS.map((key) => {
      const s = button(colourGroup, '', () => {
        current = key;
        try { localStorage.setItem(`doozer:palette:${version}`, key); } catch { /* ignore */ }
        onPalette(key);
        paint();
      }, PALETTES[key].name);
      s.classList.add('review-swatch');
      s.style.background = PALETTES[key].body;
      return s;
    });
    const paint = () => swatches.forEach((s, i) => s.classList.toggle('is-on', PALETTE_KEYS[i] === current));
    paint();
  }

  // Sound + reset
  const miscGroup = row('Other');
  const soundBtn = button(miscGroup, '', () => { sfx.setMuted(!sfx.muted); paintSound(); });
  const paintSound = () => { soundBtn.textContent = sfx.muted ? 'Sound: off' : 'Sound: on'; };
  paintSound();
  button(miscGroup, 'Reset pet', () => { sim.reset(); location.reload(); }, 'Start over with a fresh Doozer');

  document.body.appendChild(panel);
}

/** Small helpers the mockups all want. */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
