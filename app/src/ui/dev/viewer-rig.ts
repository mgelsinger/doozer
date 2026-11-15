// Development viewer, part 1: the rig. Every expression in both line styles and every
// palette, every animation on a loop, the walk against a moving ground, and the hats.

import type { HatId, PaletteId } from '../../core/contract';
import {
  EXPRESSION_NAMES, PALETTES, PALETTE_IDS, PERFORMANCE_NAMES, PERFORMANCES, createDoozer, walkCycleMs,
  type Doozer, type ExpressionName, type LineStyle, type PerformanceName, type Pose, type Timers,
} from '../../character';

export interface ViewerControls {
  palette: PaletteId;
  style: LineStyle;
  size: number;
  reduceMotion: boolean;
  live: boolean;
  /** 'all' = every palette side by side; 'one' = the chosen palette as a contact sheet. */
  matrix: 'all' | 'one';
}

type Cleanup = () => void;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, ...rest } = props;
  if (className) node.className = className;
  Object.assign(node, rest);
  node.append(...children);
  return node;
}

export function section(id: string, title: string, blurb: string): { root: HTMLElement; body: HTMLElement } {
  const body = el('div');
  const root = el('section', { class: 'vw-section', id }, [el('h2', {}, [title]), el('p', {}, [blurb]), body]);
  return { root, body };
}

const STYLES: readonly LineStyle[] = ['bold', 'soft'];

/** Poses shown as loops, with the face that usually goes with them. */
const LOOPS: readonly { label: string; spec: string; pose: Pose | null; mood: ExpressionName; facing?: -1 | 0 | 1; glasses?: boolean }[] = [
  { label: 'idle breathe', spec: 'idle breathe · blink', pose: null, mood: 'content' },
  { label: 'walk', spec: 'walk (calm waddle)', pose: 'walk', mood: 'content', facing: 1 },
  { label: 'trot', spec: 'walk (lively)', pose: 'trot', mood: 'joyful', facing: -1 },
  { label: 'hop', spec: 'hop (loop)', pose: 'hop', mood: 'cheer' },
  { label: 'eat', spec: 'eat', pose: 'eat', mood: 'eat' },
  { label: 'play', spec: 'play', pose: 'play', mood: 'cheer' },
  { label: 'shake', spec: 'wash / shake', pose: 'shake', mood: 'shake' },
  { label: 'sleep', spec: 'sleep', pose: null, mood: 'asleep' },
  { label: 'sulk', spec: 'sulk', pose: null, mood: 'hungry' },
  { label: 'drowsy', spec: 'sulk (sleepy)', pose: null, mood: 'sleepy' },
  { label: 'carried', spec: 'carried', pose: 'carried', mood: 'wow' },
  { label: 'wave', spec: 'wave (loop)', pose: 'wave', mood: 'joyful' },
  { label: 'read', spec: 'read (Room)', pose: 'read', mood: 'focus', glasses: true },
  { label: 'peek', spec: 'peek (Desktop)', pose: 'peek', mood: 'love', facing: 1 },
  { label: 'no', spec: 'refusal head-shake', pose: 'no', mood: 'no' },
  { label: 'settle', spec: 'focus (settled)', pose: null, mood: 'focus' },
];

/** What each one-shot starts from, so it is shown in context. */
const ONE_SHOT_MOOD: Partial<Record<PerformanceName, { before: ExpressionName; after: ExpressionName }>> = {
  'fall-asleep': { before: 'sleepy', after: 'asleep' },
  wake: { before: 'asleep', after: 'content' },
  stir: { before: 'asleep', after: 'asleep' },
};
const ONE_SHOT_SPEC: Record<PerformanceName, string> = {
  squish: 'set-down squish', hop: 'hop', celebrate: 'celebrate', wave: 'wave', yawn: 'yawn',
  'fall-asleep': 'fall asleep', wake: 'wake / stretch', 'shake-off': 'wash / shake (dry off)',
  stir: 'refusal while asleep', nod: 'nod', 'pop-out': 'view switch: out', 'pop-in': 'view switch: in',
};


/** Timers that only move when told to, so a performance can be frozen at any moment. */
function manualTimers(): Timers & { advance(ms: number): void } {
  let now = 0;
  let nextId = 0;
  const queue = new Map<number, { at: number; fn: () => void }>();
  return {
    set(fn, ms) { queue.set(++nextId, { at: now + Math.max(0, ms), fn }); return nextId; },
    clear(handle) { queue.delete(handle as number); },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of queue) if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry;
        if (!due) break;
        queue.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
  };
}

/**
 * Freeze every animation on a rig at one moment (ms). The rig must already be in the page.
 * Done synchronously, never in an animation frame: a browser pane that is not visible
 * does not run frames at all, and the strips must still come out right.
 */
function freezeAt(doozer: Doozer, ms: number): void {
  for (const animation of doozer.el.getAnimations({ subtree: true })) {
    if (animation instanceof CSSTransition) { animation.finish(); continue; }
    animation.pause();
    animation.currentTime = ms;
  }
}

export function mountRig(host: HTMLElement, controls: ViewerControls): Cleanup {
  const cleanups: Cleanup[] = [];
  const doozers: Doozer[] = [];
  const make = (opts: Parameters<typeof createDoozer>[0] = {}): Doozer => {
    const d = createDoozer({ palette: controls.palette, style: controls.style, size: controls.size, reduceMotion: controls.reduceMotion, ...opts });
    d.setLive(controls.live);
    doozers.push(d);
    return d;
  };
  const every = (ms: number, fn: () => void) => {
    const id = setInterval(fn, ms);
    cleanups.push(() => clearInterval(id));
  };

  // ---- Expressions: the whole matrix ------------------------------------------------
  const matrix = section('expressions', 'Expressions',
    'Every expression (rows) in every palette and both line styles (columns), drawn at the size chosen above. Click one to see it large below.');
  const grid = el('div', { class: 'vw-matrix vw-bg' });
  grid.style.gridTemplateColumns = `auto repeat(${PALETTE_IDS.length * STYLES.length}, max-content)`;
  grid.append(el('span'));
  for (const p of PALETTE_IDS) for (const s of STYLES) grid.append(el('span', { class: 'vw-head' }, [`${PALETTES[p].name} · ${s}`]));

  const big = el('div', { class: 'vw-grid vw-bg' });
  const bigDoozers: Doozer[] = [];
  let pickedExpression: ExpressionName = 'content';
  let pickedPalette: PaletteId = controls.palette;
  const showBig = () => {
    for (const d of bigDoozers.splice(0)) d.destroy();
    big.replaceChildren();
    for (const size of [190, 112, 62]) {
      for (const s of STYLES) {
        const d = createDoozer({ palette: pickedPalette, style: s, size, reduceMotion: controls.reduceMotion });
        d.setMood(pickedExpression);
        d.setLive(controls.live);
        bigDoozers.push(d);
        big.append(el('div', { class: 'vw-tile' }, [d.el, el('div', { class: 'vw-cap' }, [`${pickedExpression} · ${s} · ${size}px`])]));
      }
    }
  };
  cleanups.push(() => { for (const d of bigDoozers.splice(0)) d.destroy(); });

  if (controls.matrix === 'all') {
    for (const name of EXPRESSION_NAMES) {
      grid.append(el('span', { class: 'vw-row' }, [name]));
      for (const p of PALETTE_IDS) {
        for (const s of STYLES) {
          const d = make({ palette: p, style: s });
          d.setMood(name);
          const cell = el('div', { class: 'vw-cell', title: `${name} · ${PALETTES[p].name} · ${s}` }, [d.el]);
          cell.addEventListener('click', () => { pickedExpression = name; pickedPalette = p; showBig(); });
          grid.append(cell);
        }
      }
    }
  } else {
    // Contact sheet: one palette, each expression as a bold + soft pair.
    grid.className = 'vw-grid vw-bg';
    grid.style.gridTemplateColumns = '';
    grid.replaceChildren();
    for (const name of EXPRESSION_NAMES) {
      const pair = el('div', { class: 'vw-pair' });
      for (const s of STYLES) {
        const d = make({ style: s });
        d.setMood(name);
        pair.append(d.el);
      }
      const tile = el('div', { class: 'vw-tile vw-cell' }, [pair, el('div', { class: 'vw-cap' }, [name])]);
      tile.addEventListener('click', () => { pickedExpression = name; pickedPalette = controls.palette; showBig(); });
      grid.append(tile);
    }
  }
  showBig();
  matrix.body.append(grid, el('p', {}, ['']), big);
  host.append(matrix.root);

  // ---- Animations: loops and one-shots -----------------------------------------------
  const anim = section('animations', 'Animations',
    'Loops run continuously. One-shots replay every few seconds and always return to the mood on their own. Names in small type are the spec section 7 names.');
  const loops = el('div', { class: 'vw-grid vw-bg' });
  for (const loop of LOOPS) {
    const d = make();
    d.setMood(loop.mood);
    if (loop.pose) d.setPose(loop.pose);
    if (loop.facing) { d.setFacing(loop.facing); d.lookAt(loop.facing * 0.8, 0); }
    if (loop.glasses) d.setGlasses(true);
    loops.append(el('div', { class: 'vw-tile' }, [d.el, el('div', { class: 'vw-cap' }, [loop.label, el('small', {}, [loop.spec])])]));
  }
  // look-at: the face follows a slowly circling point
  {
    const d = make();
    let t = 0;
    every(120, () => { t += 0.12; d.lookAt(Math.cos(t), Math.sin(t * 1.3)); });
    loops.append(el('div', { class: 'vw-tile' }, [d.el, el('div', { class: 'vw-cap' }, ['look-at', el('small', {}, ['look-at'])])]));
  }

  const shots = el('div', { class: 'vw-grid vw-bg' });
  for (const name of PERFORMANCE_NAMES) {
    const d = make();
    const moods = ONE_SHOT_MOOD[name];
    const status = el('small', {}, [ONE_SHOT_SPEC[name]]);
    const run = () => {
      d.setMood(moods?.before ?? 'content');
      // The mood the scene ends in is set first, exactly as the presenter does it.
      if (moods) d.setMood(moods.after);
      void d.perform(name, 1.2);
    };
    const gap = PERFORMANCES[name].duration + 1500;
    if (moods && moods.before !== moods.after) {
      // alternate so the before/after states are both seen
      let flip = false;
      d.setMood(moods.before);
      every(gap, () => {
        flip = !flip;
        if (flip) run(); else d.setMood(moods.before);
      });
    } else {
      d.setMood(moods?.before ?? 'content');
      every(gap, run);
    }
    const tile = el('div', { class: 'vw-tile', title: 'Click to play now' }, [d.el, el('div', { class: 'vw-cap' }, [name, status])]);
    tile.style.cursor = 'pointer';
    tile.style.pointerEvents = 'auto';
    tile.addEventListener('click', run);
    shots.append(tile);
  }
  anim.body.append(el('h3', {}, ['Loops']), loops, el('h3', {}, ['One-shots']), shots);
  host.append(anim.root);

  // ---- The walk, against the ground --------------------------------------------------
  const walk = section('walk', 'Walk cycle',
    'Spec 6.4: a gentle waddle at about 30 px/s for a 110 px Doozer. The cycle length is matched to the ground speed so the feet do not slide. The second track is the lively gait, close to the mockup.');
  const tracks: { gait: 'walk' | 'trot'; speed: number; label: string }[] = [
    { gait: 'walk', speed: 30, label: 'Calm · 30 px/s' },
    { gait: 'trot', speed: 95, label: 'Lively · 95 px/s' },
  ];
  for (const t of tracks) {
    const size = Math.max(controls.size, 62);
    const speed = t.speed * (size / 112);
    const d = make({ size });
    d.setMood(t.gait === 'walk' ? 'content' : 'joyful');
    d.setWalkCycle(walkCycleMs(size, speed, t.gait));
    const track = el('div', { class: 'vw-track vw-bg' }, [el('div', { class: 'vw-cap' }, [`${t.label} (${Math.round(speed)} px/s at ${size}px)`]), d.el]);
    track.style.height = `${size + 40}px`;
    let x = 20;
    let dir: 1 | -1 = 1;
    let resting = 0;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const max = track.clientWidth - size - 20;
      if (resting > 0) {
        resting -= dt;
        if (resting <= 0) { d.setPose(t.gait); d.setFacing(dir); d.lookAt(dir * 0.8, 0); }
      } else if (controls.live) {
        x += dir * speed * dt;
        if (x >= max || x <= 20) {
          x = Math.min(max, Math.max(20, x));
          dir = dir === 1 ? -1 : 1;
          resting = 1.6;
          d.setPose(null); d.setFacing(0); d.lookAt(0, 0);
        }
      }
      d.el.style.translate = `${x}px 0`;
      raf = requestAnimationFrame(step);
    };
    d.setPose(t.gait); d.setFacing(1); d.lookAt(0.8, 0);
    raf = requestAnimationFrame(step);
    cleanups.push(() => cancelAnimationFrame(raf));
    walk.body.append(track);
  }
  host.append(walk.root);


  // ---- Frame by frame ------------------------------------------------------------------
  // The same animations as stills, so they can be judged without watching them move
  // (and in a browser pane that is not drawing frames).
  // `?strip=24` (or 30, 60) shows instead every picture as the app draws it at that many
  // frames a second (src/frames.ts): the timing pass of Phase 10 was judged from these.
  const stripFps = Number(new URLSearchParams(location.search).get('strip')) || 0;
  const frameMs = stripFps > 0 ? 1000 / stripFps : 0;
  const frames = section('frames', 'Frame by frame', stripFps > 0
    ? `Every picture of each animation as it is drawn at ${stripFps} frames a second (one every ${frameMs.toFixed(1)} ms), left to right. Loops show one cycle, or a quarter of a second if the cycle is shorter.`
    : 'Each strip is one animation frozen at evenly spaced moments, left to right. The walk strips cover one full cycle. Add ?strip=24 to the address to see every picture as the app draws it at 24 frames a second.');
  const freezers: (() => void)[] = [];
  const strip = (label: string, count: number, build: (index: number) => { doozer: Doozer; at: number }) => {
    const row = el('div', { class: 'vw-grid vw-bg vw-strip' });
    for (let i = 0; i < count; i++) {
      const { doozer, at } = build(i);
      row.append(doozer.el);
      freezers.push(() => freezeAt(doozer, at));
    }
    frames.body.append(el('div', { class: 'vw-cap vw-strip-cap' }, [label]), row);
  };
  const stripSize = Math.min(controls.size, stripFps > 0 ? 64 : 88);
  for (const gait of ['walk', 'trot'] as const) {
    const cycle = gait === 'walk' ? 1000 : 500;
    const count = stripFps > 0 ? Math.ceil(cycle / frameMs) : 8;
    strip(`${gait}: one cycle, heading right (${cycle} ms${stripFps > 0 ? `, ${count} pictures` : ''})`, count, (i) => {
      const d = make({ size: stripSize, fidget: false, reduceMotion: false });
      d.setPose(gait); d.setFacing(1); d.lookAt(0.8, 0);
      d.setLive(true);
      return { doozer: d, at: stripFps > 0 ? i * frameMs : (cycle * i) / 8 };
    });
  }
  if (stripFps > 0) {
    // The other loops: how long one cycle of each is, and the face that goes with it.
    const cycles: readonly { pose: Pose; ms: number; mood: ExpressionName; note?: string }[] = [
      { pose: 'idle', ms: 2800, mood: 'content', note: 'every other picture' },
      { pose: 'eat', ms: 1000 / 3, mood: 'eat' },
      { pose: 'play', ms: 1000, mood: 'cheer' },
      { pose: 'hop', ms: 625, mood: 'cheer' },
      { pose: 'shake', ms: 1000 / 6, mood: 'shake' },
      { pose: 'no', ms: 1000 / 3, mood: 'no' },
      { pose: 'carried', ms: 1000, mood: 'wow' },
      { pose: 'wave', ms: 5000 / 12, mood: 'joyful' },
      { pose: 'peek', ms: 1800, mood: 'content', note: 'every other picture' },
    ];
    for (const loop of cycles) {
      const stride = loop.note ? 2 : 1;
      const span = Math.max(loop.ms, 250);
      const count = Math.min(36, Math.ceil(span / (frameMs * stride) - 0.01));
      strip(`${loop.pose}: a cycle of ${Math.round(loop.ms)} ms (${count} pictures${loop.note ? `, ${loop.note}` : ''})`, count, (i) => {
        const d = make({ size: stripSize, fidget: false, reduceMotion: false });
        d.setMood(loop.mood);
        d.setPose(loop.pose); d.setFacing(loop.pose === 'peek' ? 1 : 0);
        d.setLive(true);
        return { doozer: d, at: i * frameMs * stride };
      });
    }
  }
  for (const name of PERFORMANCE_NAMES) {
    const spec = PERFORMANCES[name];
    const moods = ONE_SHOT_MOOD[name];
    const stride = stripFps > 0 && spec.duration > 1000 ? 2 : 1;
    const count = stripFps > 0 ? Math.ceil(spec.duration / (frameMs * stride)) : 7;
    strip(`${name} (${spec.duration} ms${stripFps > 0 ? `, ${count} pictures${stride > 1 ? ', every other one' : ''}` : ''})`, count, (i) => {
      const clock = manualTimers();
      const d = createDoozer({ palette: controls.palette, style: controls.style, size: stripSize, fidget: false, reduceMotion: false, timers: clock });
      doozers.push(d);
      d.setMood(moods?.after ?? 'content');
      const at = stripFps > 0 ? Math.min(spec.duration - 1, i * frameMs * stride) : (spec.duration * (i + 0.5)) / 7;
      void d.perform(name, 1.2);
      clock.advance(at);
      return { doozer: d, at };
    });
  }
  host.append(frames.root);
  for (const freeze of freezers) freeze();

  // ---- Hats ------------------------------------------------------------------------------
  const hats = section('hats', 'Hats', 'The hat attachment point with both unlockable hats, awake and asleep, in both line styles.');
  const hatGrid = el('div', { class: 'vw-grid vw-bg' });
  const HATS: readonly HatId[] = ['nightcap', 'bow'];
  for (const hat of HATS) {
    for (const s of STYLES) {
      for (const mood of ['content', 'asleep', 'joyful'] as const) {
        for (const size of [62, 112, 190]) {
          if (mood === 'joyful' && size !== 112) continue;
          const d = createDoozer({ palette: controls.palette, style: s, size, hat, reduceMotion: controls.reduceMotion });
          d.setMood(mood);
          d.setLive(controls.live);
          doozers.push(d);
          hatGrid.append(el('div', { class: 'vw-tile' }, [d.el, el('div', { class: 'vw-cap' }, [`${hat} · ${mood}`, el('small', {}, [`${s} · ${size}px`])])]));
        }
      }
    }
  }
  hats.body.append(hatGrid);
  host.append(hats.root);

  return () => {
    for (const fn of cleanups) fn();
    for (const d of doozers) d.destroy();
    matrix.root.remove(); anim.root.remove(); walk.root.remove(); frames.root.remove(); hats.root.remove();
  };
}
