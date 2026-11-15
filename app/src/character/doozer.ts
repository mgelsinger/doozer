// The 2D Doozer: one rig, two line styles, five palettes. This file is the thin DOM
// layer; what is showing and for how long is decided by ExpressionState, which is where
// the "nothing is ever left half-finished" guarantee lives.
//
// Used by the Pill, Room and Desktop views and by the UI kit's Card. It knows nothing
// about any of them, or about the brain.

import './rig.css';
import type { HatId, PaletteId } from '../core/contract';
import type { ExpressionName, Pose } from './expressions';
import { ExpressionState, type Look, type PerformanceOutcome } from './expression-state';
import { PALETTES, PALETTE_VARS, isPaletteId } from './palettes';
import { PERFORMANCES, type PartName, type PerformanceName } from './performances';
import { hatMarkup, rigMarkup } from './rig-markup';
import { realTimers, type Timers } from './timers';
import { frames } from '../frames';

/** Bold outline (Pill, Desktop) or soft and outline-free (Room). Same parts either way. */
export type LineStyle = 'bold' | 'soft';

export interface DoozerOptions {
  palette?: PaletteId;
  style?: LineStyle;
  /** Width in CSS pixels. The rig is square. Can also be left to CSS. */
  size?: number;
  hat?: HatId | null;
  /** Blink, flick an ear, wag the tail now and then. Default true. */
  fidget?: boolean;
  /** Default: whatever the system asks for. */
  reduceMotion?: boolean;
  timers?: Timers;
  random?: () => number;
}

export interface Doozer {
  /** The element to place in the page. Square; `pointer-events: none`. */
  readonly el: HTMLElement;
  readonly mood: ExpressionName;
  /** The expression whose face is showing right now. */
  readonly showing: ExpressionName;
  readonly pose: Pose;
  /** True while a flash or a performance is running. */
  readonly busy: boolean;
  readonly palette: PaletteId;
  readonly style: LineStyle;

  setPalette(id: PaletteId): void;
  setStyle(style: LineStyle): void;
  setSize(px: number): void;
  setHat(hat: HatId | null): void;
  setGlasses(on: boolean): void;
  /** Grubby marks, independent of the face (so Doozer can look grubby and happy). */
  setDirt(on: boolean): void;
  setReduceMotion(on: boolean): void;
  /** False pauses every loop and the fidgets: nothing redraws. For idle views and hidden ones. */
  setLive(on: boolean): void;

  /** The lasting, need-driven expression. */
  setMood(name: ExpressionName): void;
  /** A temporary face; always returns to the mood. */
  flash(name: ExpressionName, ms?: number): void;
  /** Hold a body pose (walk, carried, read...) until released with null. */
  setPose(pose: Pose | null, face?: ExpressionName | null): void;
  /** Which way Doozer is heading: -1 left, 0 toward you, 1 right. Steers the walk and the peek. */
  setFacing(dir: -1 | 0 | 1): void;
  /** Glance toward a point: x and y in -1..1. */
  lookAt(x: number, y: number): void;
  /** Length of one walk cycle in ms, to match the ground speed (see walkCycleMs). null = default. */
  setWalkCycle(ms: number | null): void;

  /** Play a one-shot. Always settles, with 'finished' or 'interrupted'. */
  perform(name: PerformanceName, strength?: number): Promise<PerformanceOutcome>;
  /**
   * A springy squash on top of whatever is showing (a poke, a pet, being set down).
   * Unlike `perform('squish')` it does not replace the current flash or performance.
   */
  squish(strength?: number): void;
  /**
   * Blink. `still` is the cheap form for a rig that is resting (`setLive(false)`): the eyes
   * shut and open in two redraws, with no animation in between, so it works while paused.
   */
  blink(still?: boolean): void;
  /** End anything temporary now and show the mood. */
  stop(): void;
  /** Stop everything and remove the element. */
  destroy(): void;
}

/** How long the eyes stay shut in a still blink. */
const STILL_BLINK_MS = 110;

/** Below this width the rig switches to its heavier small-size drawing. */
export const SMALL_SIZE_PX = 84;

/**
 * How long one walk cycle should take so the feet match the ground: Doozer covers about
 * a quarter of its own width per cycle at a walk, a bit under half at a trot.
 */
export function walkCycleMs(widthPx: number, speedPxPerSec: number, gait: 'walk' | 'trot' = 'walk'): number {
  const base = gait === 'walk' ? 960 : 520;
  if (!(speedPxPerSec > 0) || !(widthPx > 0)) return base;
  const stride = widthPx * (gait === 'walk' ? 0.26 : 0.42);
  const ms = (stride / speedPxPerSec) * 1000;
  return Math.round(Math.min(base * 1.5, Math.max(base * 0.6, ms)));
}

const PART_SELECTORS: Record<PartName, string> = {
  root: '.dz-root', body: '.dz-bodywrap', face: '.dz-face', shadow: '.dz-shadow', tail: '.dz-tail',
  'arm-l': '.dz-arm-l', 'arm-r': '.dz-arm-r', 'foot-l': '.dz-foot-l', 'foot-r': '.dz-foot-r',
  'ear-l': '.dz-ear-l', 'ear-r': '.dz-ear-r',
};

let uid = 0;

function systemPrefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createDoozer(options: DoozerOptions = {}): Doozer {
  const timers = options.timers ?? realTimers;
  const random = options.random ?? Math.random;

  const el = document.createElement('div');
  el.className = 'dz';
  el.innerHTML = rigMarkup(`dz${++uid}`);

  const part = (selector: string) => el.querySelector<SVGElement>(selector);
  const parts = Object.fromEntries(
    (Object.keys(PART_SELECTORS) as PartName[]).map((name) => [name, part(PART_SELECTORS[name])]),
  ) as Record<PartName, SVGElement | null>;
  const hatSlot = part('.dz-hat');
  const eyes = Array.from(el.querySelectorAll<SVGElement>('.e-open'));

  let paletteId: PaletteId = 'peach';
  let style: LineStyle = 'bold';
  let glasses = false;
  let live = true;
  let reduce = options.reduceMotion ?? systemPrefersReducedMotion();
  let destroyed = false;
  let fidgetTimer: unknown = null;
  let blinkTimer: unknown = null;
  let lastLook: Look | null = null;

  function paint(look: Look): void {
    lastLook = look;
    const d = el.dataset;
    d.expression = look.expression;
    d.eyes = look.eyes;
    d.mouth = look.mouth;
    d.pose = look.pose;
    d.blush = look.blush ? '1' : '0';
    d.glasses = look.glasses || glasses ? '1' : '0';
    d.extra = look.extra ?? '';
    el.style.setProperty('--dz-tuft', `${look.tuft}deg`);
  }

  const state = new ExpressionState({
    apply: paint,
    startPerformance(name, strength) {
      const spec = PERFORMANCES[name];
      const running: Animation[] = [];
      for (const track of spec.tracks(strength)) {
        const node = parts[track.part];
        if (!node || typeof node.animate !== 'function') continue;
        // CSS-style easing: applied between each pair of keyframes, not across the whole run.
        const keyframes = track.keyframes.map((frame) => ({ easing: track.easing ?? 'ease-in-out', ...frame }));
        running.push(node.animate(keyframes as Keyframe[], {
          duration: track.duration ?? spec.duration,
          delay: track.delay ?? 0,
          fill: 'none',
        }));
      }
      // The frame clock draws these at the capped rate; it has to be told they exist.
      frames.wake();
      return () => { for (const animation of running) animation.cancel(); };
    },
  }, { timers, reduceMotion: reduce });

  function quick(node: SVGElement | null | undefined, keyframes: Keyframe[], duration: number): void {
    if (!node || typeof node.animate !== 'function' || reduce || !live || destroyed) return;
    node.animate(keyframes, { duration, easing: 'ease-in-out', fill: 'none' });
    frames.wake();
  }

  function blink(still = false): void {
    if (still) {
      // Two redraws and a timer. Nothing here depends on an animation frame.
      if (destroyed || reduce || blinkTimer !== null) return;
      el.dataset.blink = '1';
      blinkTimer = timers.set(() => { blinkTimer = null; el.dataset.blink = '0'; }, STILL_BLINK_MS);
      return;
    }
    for (const eye of eyes) {
      quick(eye, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.08)', offset: 0.45 }, { transform: 'scaleY(1)' }], 150);
    }
  }

  function fidget(): void {
    blink();
    const roll = random();
    if (roll < 0.16) timers.set(() => blink(), 260);
    else if (roll < 0.3) {
      const left = random() < 0.5;
      const deg = left ? -13 : 13;
      quick(parts[left ? 'ear-l' : 'ear-r'], [{ transform: 'rotate(0deg)' }, { transform: `rotate(${deg}deg)`, offset: 0.3 }, { transform: `rotate(${-deg * 0.3}deg)`, offset: 0.65 }, { transform: 'rotate(0deg)' }], 340);
    } else if (roll < 0.4) {
      quick(parts.tail, [{ transform: 'translateX(0px)' }, { transform: 'translateX(3.500px)' }, { transform: 'translateX(-2.500px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0px)' }], 460);
    }
  }

  function scheduleFidget(): void {
    fidgetTimer = timers.set(() => {
      fidgetTimer = null;
      if (destroyed) return;
      // Asleep, paused or off the page: skip the beat but keep the (single) timer going.
      if (live && !reduce && el.isConnected && lastLook?.pose !== 'sleep') fidget();
      scheduleFidget();
    }, 1800 + random() * 4200);
  }

  const api: Doozer = {
    el,
    get mood() { return state.mood; },
    get showing() { return state.showing; },
    get pose() { return state.pose; },
    get busy() { return state.busy; },
    get palette() { return paletteId; },
    get style() { return style; },

    setPalette(id) {
      paletteId = isPaletteId(id) ? id : 'peach';
      const palette = PALETTES[paletteId];
      for (const key of PALETTE_VARS) el.style.setProperty(`--dz-${key}`, palette[key]);
      el.dataset.palette = paletteId;
    },
    setStyle(next) {
      style = next === 'soft' ? 'soft' : 'bold';
      el.dataset.style = style;
    },
    setSize(px) {
      if (!(px > 0)) return;
      el.style.width = `${px}px`;
      el.dataset.lod = px <= SMALL_SIZE_PX ? 'small' : 'normal';
    },
    setHat(hat) {
      const next = hat === 'nightcap' || hat === 'bow' ? hat : null;
      if ((el.dataset.hat ?? '') === (next ?? '')) return;
      el.dataset.hat = next ?? '';
      if (hatSlot) hatSlot.innerHTML = next ? hatMarkup(next) : '';
    },
    setGlasses(on) {
      glasses = on;
      el.dataset.glasses = (lastLook?.glasses ?? false) || glasses ? '1' : '0';
    },
    setDirt(on) { el.dataset.dirt = on ? '1' : '0'; },
    setReduceMotion(on) {
      reduce = on;
      el.dataset.motion = on ? 'reduce' : 'full';
      state.setReduceMotion(on);
    },
    setLive(on) {
      live = on;
      el.dataset.live = on ? '1' : '0';
    },

    setMood(name) { state.setMood(name); },
    flash(name, ms) { state.flash(name, ms); },
    setPose(pose, face = null) { state.setPose(pose, face); },
    setFacing(dir) { el.style.setProperty('--dz-dir', String(dir < 0 ? -1 : dir > 0 ? 1 : 0)); },
    lookAt(x, y) {
      const clamp = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
      el.style.setProperty('--dz-look-x', clamp(x).toFixed(2));
      el.style.setProperty('--dz-look-y', clamp(y).toFixed(2));
    },
    setWalkCycle(ms) {
      if (ms !== null && ms > 0) el.style.setProperty('--dz-walk-ms', `${Math.round(ms)}ms`);
      else el.style.removeProperty('--dz-walk-ms');
    },

    perform(name, strength) { return state.perform(name, strength); },
    squish(strength = 1) {
      const s = Number.isFinite(strength) ? Math.min(2, Math.max(0.2, strength)) : 1;
      for (const track of PERFORMANCES.squish.tracks(s)) {
        quick(parts[track.part], track.keyframes.map((frame) => ({ easing: 'ease-out', ...frame })) as Keyframe[], PERFORMANCES.squish.duration);
      }
    },
    blink,
    stop() { state.stop(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      state.destroy();
      if (fidgetTimer !== null) timers.clear(fidgetTimer);
      fidgetTimer = null;
      if (blinkTimer !== null) timers.clear(blinkTimer);
      blinkTimer = null;
      if (typeof el.getAnimations === 'function') {
        for (const animation of el.getAnimations({ subtree: true })) animation.cancel();
      }
      el.remove();
    },
  };

  api.setPalette(options.palette ?? 'peach');
  api.setStyle(options.style ?? 'bold');
  if (options.size) api.setSize(options.size);
  else el.dataset.lod = 'normal';
  api.setHat(options.hat ?? null);
  api.setDirt(false);
  api.setLive(true);
  api.setReduceMotion(reduce);
  state.setMood('content');
  if (options.fidget !== false) scheduleFidget();

  return api;
}
