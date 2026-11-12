// The vector Doozer: one rig, many moods. Used by the Desk Buddy, Cozy Room and
// Pill mockups and by the gallery. Colours come from CSS variables so a palette
// swap is instant; poses are CSS animations selected by data-pose.

import { PALETTES } from './art.js';

let uid = 0;

const STYLE = /* css */ `
.dz { position: relative; width: 120px; aspect-ratio: 1; pointer-events: none; flex: none;
  --dz-look-x: 0; --dz-look-y: 0; --dz-tuft: 0deg; }
.dz-svg { width: 100%; height: 100%; display: block; overflow: visible; }
.dz-svg * { transform-box: fill-box; transform-origin: center; }
.dz-svg .dz-vb { transform-box: view-box; }
/* Shapes that carry their own SVG transform attribute must keep the plain SVG origin. */
.dz-svg .dz-raw { transform-box: view-box; transform-origin: 0 0; }

.dz-fill { fill: var(--dz-body); }
.dz-fill-shade { fill: var(--dz-shade); }
.dz-stroke { stroke: var(--dz-line); stroke-width: 4.5; stroke-linejoin: round; stroke-linecap: round; }
.dz[data-outline="0"] .dz-stroke { stroke: none; }
.dz-shadow { fill: rgba(50, 30, 70, .16); }
.dz-belly { fill: var(--dz-belly); opacity: .92; }
.dz-ear-in { fill: var(--dz-ear); }
.dz-cheek { fill: var(--dz-cheek); opacity: .62; transition: opacity .3s; }
.dz[data-blush="1"] .dz-cheek { opacity: .95; }
.dz-tuft-out { fill: none; stroke: var(--dz-line); stroke-width: 14; stroke-linecap: round; stroke-linejoin: round; }
.dz-tuft-in { fill: none; stroke: var(--dz-shade); stroke-width: 6.5; stroke-linecap: round; stroke-linejoin: round; }
.dz[data-outline="0"] .dz-tuft-out { stroke: none; }
.dz[data-outline="0"] .dz-tuft-in { stroke-width: 8; }

/* Parts that follow the pointer or the mood */
.dz-face { transform: translate(calc(var(--dz-look-x) * 8px), calc(var(--dz-look-y) * 5px)); transition: transform .28s ease-out; }
.dz-belly { transform: translate(calc(var(--dz-look-x) * 3px), 0); transition: transform .28s ease-out; }
.dz-tuft { transform-origin: 100px 50px; transform: rotate(var(--dz-tuft)); transition: transform .7s cubic-bezier(.3, 1.6, .5, 1); }
.dz-root, .dz-bodywrap { transform-origin: 100px 186px; }

/* Eyes */
.dz .e-ball { fill: var(--dz-ink); }
.dz .e-hl { fill: #fff; }
.dz .e-line { fill: none; stroke: var(--dz-ink); stroke-width: 5; stroke-linecap: round; display: none; }
.dz .e-open { transition: transform .07s; }
.dz.is-blink .e-open { transform: scaleY(.08); }
.dz[data-eyes="happy"] .e-open, .dz[data-eyes="closed"] .e-open { display: none; }
.dz[data-eyes="happy"] .e-happy { display: block; }
.dz[data-eyes="closed"] .e-closed { display: block; }
.dz[data-eyes="sad"] .e-brow { display: block; }
.dz[data-eyes="sad"] .e-open { transform: scale(.92); }
.dz[data-eyes="wide"] .e-open { transform: scale(1.2); }
.dz[data-eyes="half"] .e-open { transform: scaleY(.5); }
.dz[data-eyes="half"].is-blink .e-open { transform: scaleY(.08); }

/* Mouths */
.dz .m { display: none; }
.dz .m-line { fill: none; stroke: var(--dz-ink); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.dz .m-fill { fill: #7A2E3A; stroke: var(--dz-ink); stroke-width: 3; stroke-linejoin: round; }
.dz .m-tongue { fill: #FF8FA3; }
.dz[data-mouth="w"] .m-w, .dz[data-mouth="smile"] .m-smile, .dz[data-mouth="open"] .m-open,
.dz[data-mouth="o"] .m-o, .dz[data-mouth="flat"] .m-flat, .dz[data-mouth="frown"] .m-frown { display: block; }

/* ---- Poses -------------------------------------------------------------- */
@keyframes dz-breathe { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.028, .972); } }
@keyframes dz-tuft-sway { 0%, 100% { rotate: -3deg; } 50% { rotate: 4deg; } }
.dz[data-pose="idle"] .dz-bodywrap { animation: dz-breathe 2.8s ease-in-out infinite; }
.dz-tuft-sway { animation: dz-tuft-sway 3.4s ease-in-out infinite; transform-origin: 100px 50px; }

@keyframes dz-walk-body { 0%, 100% { transform: translateY(0) rotate(-3deg); } 25% { transform: translateY(-5px) rotate(0); }
  50% { transform: translateY(0) rotate(3deg); } 75% { transform: translateY(-5px) rotate(0); } }
@keyframes dz-step { 0%, 100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-9px) rotate(-8deg); } }
@keyframes dz-swing-l { 0%, 100% { transform: rotate(16deg); } 50% { transform: rotate(-12deg); } }
@keyframes dz-swing-r { 0%, 100% { transform: rotate(-16deg); } 50% { transform: rotate(12deg); } }
.dz[data-pose="walk"] .dz-bodywrap { animation: dz-walk-body .5s linear infinite; }
.dz[data-pose="walk"] .dz-foot-l { animation: dz-step .5s ease-in-out infinite; }
.dz[data-pose="walk"] .dz-foot-r { animation: dz-step .5s ease-in-out infinite -.25s; }
.dz[data-pose="walk"] .dz-arm-l { animation: dz-swing-l .5s ease-in-out infinite; }
.dz[data-pose="walk"] .dz-arm-r { animation: dz-swing-r .5s ease-in-out infinite; }

@keyframes dz-hop { 0% { transform: translateY(0) scale(1.1, .88); } 28% { transform: translateY(-34px) scale(.93, 1.09); }
  52% { transform: translateY(-40px) scale(1, 1); } 82% { transform: translateY(0) scale(1.12, .86); } 100% { transform: translateY(0) scale(1, 1); } }
@keyframes dz-hop-shadow { 0%, 82%, 100% { transform: scale(1); opacity: 1; } 40% { transform: scale(.7); opacity: .55; } }
@keyframes dz-arms-up-l { 0%, 100% { transform: rotate(0); } 30%, 60% { transform: rotate(60deg) translateY(-6px); } }
@keyframes dz-arms-up-r { 0%, 100% { transform: rotate(0); } 30%, 60% { transform: rotate(-60deg) translateY(-6px); } }
.dz[data-pose="hop"] .dz-root { animation: dz-hop .62s cubic-bezier(.3, .6, .4, 1) infinite; }
.dz[data-pose="hop"] .dz-shadow { animation: dz-hop-shadow .62s ease-in-out infinite; }
.dz[data-pose="hop"] .dz-arm-l { animation: dz-arms-up-l .62s ease-in-out infinite; }
.dz[data-pose="hop"] .dz-arm-r { animation: dz-arms-up-r .62s ease-in-out infinite; }

@keyframes dz-sleep { 0%, 100% { transform: scale(1.1, .84); } 50% { transform: scale(1.135, .8); } }
.dz[data-pose="sleep"] .dz-bodywrap { animation: dz-sleep 3.8s ease-in-out infinite; }

@keyframes dz-eat { 0%, 100% { transform: translateY(0) scale(1, 1); } 50% { transform: translateY(3px) scale(1.04, .95); } }
.dz[data-pose="eat"] .dz-bodywrap { animation: dz-eat .3s ease-in-out infinite; }

@keyframes dz-dangle { 0%, 100% { transform: rotate(-16deg) translateY(4px); } 50% { transform: rotate(16deg) translateY(4px); } }
@keyframes dz-held-body { 0%, 100% { transform: rotate(-4deg) scale(.95, 1.07); } 50% { transform: rotate(4deg) scale(.95, 1.07); } }
.dz[data-pose="held"] .dz-bodywrap { animation: dz-held-body .9s ease-in-out infinite; transform-origin: 100px 60px; }
.dz[data-pose="held"] .dz-foot-l { animation: dz-dangle .45s ease-in-out infinite; transform-origin: 50% 0; }
.dz[data-pose="held"] .dz-foot-r { animation: dz-dangle .45s ease-in-out infinite -.22s; transform-origin: 50% 0; }
.dz[data-pose="held"] .dz-arm-l { transform: rotate(70deg) translateY(-8px); }
.dz[data-pose="held"] .dz-arm-r { transform: rotate(-70deg) translateY(-8px); }
.dz[data-pose="held"] .dz-shadow { opacity: 0; }

@keyframes dz-shake { 0%, 100% { transform: rotate(-7deg); } 50% { transform: rotate(7deg); } }
.dz[data-pose="shake"] .dz-bodywrap { animation: dz-shake .16s linear infinite; }

@keyframes dz-sulk { 0%, 100% { transform: scale(1.03, .95) rotate(-1.5deg); } 50% { transform: scale(1.04, .94) rotate(1.5deg); } }
.dz[data-pose="sulk"] .dz-bodywrap { animation: dz-sulk 4s ease-in-out infinite; }

@keyframes dz-wave { 0%, 100% { transform: rotate(-95deg) translateY(-4px); } 50% { transform: rotate(-135deg) translateY(-4px); } }
.dz[data-pose="wave"] .dz-bodywrap { animation: dz-breathe 2.8s ease-in-out infinite; }
.dz[data-pose="wave"] .dz-arm-r { animation: dz-wave .36s ease-in-out infinite; transform-origin: 30% 80%; }

.dz-arm, .dz-foot { transition: transform .2s; }
.dz-shadow { transition: opacity .2s; }

@media (prefers-reduced-motion: reduce) {
  .dz[data-pose] .dz-bodywrap, .dz[data-pose] .dz-root, .dz-tuft-sway { animation-duration: 6s; }
}
`;

function ensureStyle() {
  if (document.getElementById('dz-style')) return;
  const style = document.createElement('style');
  style.id = 'dz-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function eye(cx) {
  const inner = cx < 100 ? 1 : -1; // brows tilt up toward the middle
  return `
    <g class="dz-eye">
      <g class="e-open">
        <ellipse class="e-ball" cx="${cx}" cy="106" rx="8.600" ry="10.800"/>
        <circle class="e-hl" cx="${cx + 3}" cy="101.400" r="3.300"/>
        <circle class="e-hl" cx="${cx - 2.600}" cy="110" r="1.500"/>
      </g>
      <path class="e-line e-happy" d="M${cx - 9} 109 Q${cx} 96 ${cx + 9} 109"/>
      <path class="e-line e-closed" d="M${cx - 9} 104 Q${cx} 113 ${cx + 9} 104"/>
      <path class="e-line e-brow" d="M${cx - 9 * inner} 93 L${cx + 9 * inner} 87"/>
    </g>`;
}

const MARKUP = (id) => `
<svg class="dz-svg" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="${id}-g" cx="36%" cy="28%" r="85%">
      <stop offset="0" style="stop-color: var(--dz-light)"/>
      <stop offset=".5" style="stop-color: var(--dz-body)"/>
      <stop offset="1" style="stop-color: var(--dz-shade)"/>
    </radialGradient>
  </defs>
  <ellipse class="dz-shadow" cx="100" cy="188" rx="52" ry="7"/>
  <g class="dz-root dz-vb">
    <g class="dz-foot dz-foot-l"><ellipse class="dz-fill-shade dz-stroke" cx="75" cy="180" rx="18" ry="9.500"/></g>
    <g class="dz-foot dz-foot-r"><ellipse class="dz-fill-shade dz-stroke" cx="125" cy="180" rx="18" ry="9.500"/></g>
    <g class="dz-bodywrap dz-vb">
      <circle class="dz-tail dz-fill-shade dz-stroke" cx="158" cy="154" r="10"/>
      <g class="dz-ear dz-ear-l"><circle class="dz-fill dz-stroke" cx="60" cy="60" r="19"/><circle class="dz-ear-in" cx="60" cy="61" r="9.500"/></g>
      <g class="dz-ear dz-ear-r"><circle class="dz-fill dz-stroke" cx="140" cy="60" r="19"/><circle class="dz-ear-in" cx="140" cy="61" r="9.500"/></g>
      <g class="dz-tuft dz-vb"><g class="dz-tuft-sway dz-vb">
        <path class="dz-tuft-out" d="M100 52 C95 36 104 22 115 27 C123 31 119 43 111 39"/>
        <path class="dz-tuft-in" d="M100 52 C95 36 104 22 115 27 C123 31 119 43 111 39"/>
      </g></g>
      <path class="dz-body dz-stroke" fill="url(#${id}-g)" d="M100 44 C142 44 164 82 164 122 C164 162 140 184 100 184 C60 184 36 162 36 122 C36 82 58 44 100 44 Z"/>
      <ellipse class="dz-belly" cx="100" cy="148" rx="37" ry="27"/>
      <g class="dz-arm dz-arm-l" style="transform-origin: 70% 15%"><ellipse class="dz-fill dz-stroke dz-raw" cx="41" cy="134" rx="10.500" ry="15" transform="rotate(18 41 134)"/></g>
      <g class="dz-arm dz-arm-r" style="transform-origin: 30% 15%"><ellipse class="dz-fill dz-stroke dz-raw" cx="159" cy="134" rx="10.500" ry="15" transform="rotate(-18 159 134)"/></g>
      <g class="dz-face">
        <ellipse class="dz-cheek" cx="60" cy="124" rx="11.500" ry="7.500"/>
        <ellipse class="dz-cheek" cx="140" cy="124" rx="11.500" ry="7.500"/>
        ${eye(74)}
        ${eye(126)}
        <g class="dz-mouth">
          <path class="m m-line m-w" d="M90 120 Q95 127.500 100 120 Q105 127.500 110 120"/>
          <path class="m m-line m-smile" d="M91 120 Q100 130 109 120"/>
          <g class="m m-open"><path class="m-fill" d="M89 119 Q100 141 111 119 Z"/><ellipse class="m-tongue" cx="100" cy="128.500" rx="5" ry="3.200"/></g>
          <ellipse class="m m-fill m-o" cx="100" cy="124" rx="4.600" ry="5.600"/>
          <path class="m m-line m-flat" d="M93 123 L107 123"/>
          <path class="m m-line m-frown" d="M92 127 Q100 119 108 127"/>
        </g>
        <g class="dz-acc"></g>
      </g>
    </g>
  </g>
</svg>`;

/** How each mood or reaction looks. tuft: negative = perky, positive = droopy. */
const EXPRESSIONS = {
  joyful:    { eyes: 'happy',  mouth: 'open',  tuft: -14, pose: 'idle', blush: 1 },
  content:   { eyes: 'open',   mouth: 'w',     tuft: 0,   pose: 'idle' },
  meh:       { eyes: 'open',   mouth: 'flat',  tuft: 22,  pose: 'idle' },
  hungry:    { eyes: 'sad',    mouth: 'o',     tuft: 38,  pose: 'sulk' },
  bored:     { eyes: 'half',   mouth: 'flat',  tuft: 30,  pose: 'sulk' },
  sleepy:    { eyes: 'half',   mouth: 'o',     tuft: 46,  pose: 'sulk' },
  dirty:     { eyes: 'sad',    mouth: 'frown', tuft: 40,  pose: 'sulk' },
  asleep:    { eyes: 'closed', mouth: 'smile', tuft: 62,  pose: 'sleep' },
  // reactions
  eat:       { eyes: 'happy',  mouth: 'open',  tuft: -8,  pose: 'eat', blush: 1 },
  love:      { eyes: 'happy',  mouth: 'smile', tuft: -16, blush: 1 },
  wow:       { eyes: 'wide',   mouth: 'o',     tuft: -20 },
  cheer:     { eyes: 'happy',  mouth: 'open',  tuft: -18, pose: 'hop', blush: 1 },
  no:        { eyes: 'sad',    mouth: 'flat',  tuft: 30 },
  shake:     { eyes: 'closed', mouth: 'smile', tuft: 10,  pose: 'shake' },
  held:      { eyes: 'wide',   mouth: 'o',     tuft: -24, pose: 'held' },
  yawn:      { eyes: 'closed', mouth: 'open',  tuft: 40 },
};

/**
 * Build a Doozer.
 * @param {object} [opts]
 * @param {string} [opts.palette] key of PALETTES
 * @param {boolean} [opts.outline] bold cartoon outline (true) or soft storybook shading (false)
 * @param {number} [opts.size] width in px (also settable from CSS)
 */
export function createDoozer({ palette = 'peach', outline = true, size } = {}) {
  ensureStyle();
  const id = `dz${++uid}`;
  const el = document.createElement('div');
  el.className = 'dz';
  el.dataset.outline = outline ? '1' : '0';
  el.dataset.eyes = 'open';
  el.dataset.mouth = 'w';
  el.dataset.pose = 'idle';
  if (size) el.style.width = `${size}px`;
  el.innerHTML = MARKUP(id);

  const q = (sel) => el.querySelector(sel);
  const parts = { root: q('.dz-root'), body: q('.dz-bodywrap'), face: q('.dz-face'), acc: q('.dz-acc'), tuft: q('.dz-tuft') };

  let mood = 'content';
  let flashTimer = 0;
  let poseOverride = null;
  let paletteKey = palette;

  function apply(exp) {
    el.dataset.eyes = exp.eyes;
    el.dataset.mouth = exp.mouth;
    el.dataset.blush = exp.blush ? '1' : '0';
    el.style.setProperty('--dz-tuft', `${exp.tuft}deg`);
    el.dataset.pose = poseOverride ?? exp.pose ?? EXPRESSIONS[mood]?.pose ?? 'idle';
  }

  const api = {
    el,
    parts,
    get mood() { return mood; },
    get palette() { return paletteKey; },

    /** The lasting, need-driven expression. */
    setMood(next) {
      mood = EXPRESSIONS[next] ? next : 'content';
      if (!flashTimer) apply(EXPRESSIONS[mood]);
    },

    /** A temporary reaction; returns to the mood afterwards. */
    flash(name, ms = 1200) {
      const exp = EXPRESSIONS[name];
      if (!exp) return;
      clearTimeout(flashTimer);
      apply(exp);
      flashTimer = setTimeout(() => { flashTimer = 0; apply(EXPRESSIONS[mood]); }, ms);
    },

    /** Force a body pose (walk, hop, held...) regardless of mood; null to release. */
    setPose(pose) {
      poseOverride = pose;
      el.dataset.pose = pose ?? EXPRESSIONS[mood]?.pose ?? 'idle';
    },

    setMouth(mouth) { el.dataset.mouth = mouth; },
    setEyes(eyes) { el.dataset.eyes = eyes; },

    /** Glance toward a point: x, y in -1..1. */
    look(x, y) {
      el.style.setProperty('--dz-look-x', Math.max(-1, Math.min(1, x)).toFixed(2));
      el.style.setProperty('--dz-look-y', Math.max(-1, Math.min(1, y)).toFixed(2));
    },

    blink() {
      el.classList.add('is-blink');
      setTimeout(() => el.classList.remove('is-blink'), 130);
    },

    /** A springy squash, e.g. when poked or on landing. strength ~0.5..2 */
    squish(strength = 1) {
      const s = Math.min(2, strength);
      parts.root.animate([
        { transform: `scale(${1 + 0.14 * s}, ${1 - 0.16 * s})` },
        { transform: `scale(${1 - 0.07 * s}, ${1 + 0.08 * s})`, offset: 0.4 },
        { transform: `scale(${1 + 0.03 * s}, ${1 - 0.03 * s})`, offset: 0.7 },
        { transform: 'scale(1, 1)' },
      ], { duration: 460, easing: 'ease-out' });
    },

    setPalette(key) {
      const p = PALETTES[key] ?? PALETTES.peach;
      paletteKey = PALETTES[key] ? key : 'peach';
      for (const k of ['body', 'light', 'shade', 'belly', 'cheek', 'ear', 'line', 'ink']) {
        el.style.setProperty(`--dz-${k}`, p[k]);
      }
    },
  };

  api.setPalette(palette);
  api.setMood('content');

  // Blink on its own.
  (function scheduleBlink() {
    setTimeout(() => {
      if (!el.isConnected && uid > 50) return; // stop for discarded instances
      api.blink();
      if (Math.random() < 0.18) setTimeout(() => api.blink(), 260);
      scheduleBlink();
    }, 1800 + Math.random() * 4200);
  })();

  return api;
}
