// The page's frame clock: everything that moves is drawn at a capped rate.
//
// Why. In this window a frame costs the same whatever is on it: the page lays out and
// paints, its compositor commits, the browser's display compositor draws, and the picture
// is presented, across three processes. Measured (docs/polish-checks.md section 2): two to
// three milliseconds of processor time a frame, so Doozer walking on a 120 Hz screen cost
// 37 to 40 % of one core, and 120 of those frames a second is far more than a small soft
// creature needs. Drawing the same motion 24 times a second costs about a fifth as much.
//
// How. The browser runs CSS animations, CSS transitions and Web Animations at the
// screen's rate and offers no way to slow them. But an animation that is paused costs
// nothing and can be set to any moment. So this clock takes each running animation over
// (pauses it, keeping its place) and from then on moves it forward itself, once per tick:
// `currentTime += the time that really passed`. The motion is the same motion, with the
// same easing and the same length; it is only drawn less often. Whatever a view moves by
// script asks this clock for its frames too (`request`), so that everything in the page
// changes on the same ticks: two things each drawn 30 times a second, out of step, would
// be 60 frames.
//
// A tick waits out most of its interval on a timer and then takes the screen's next
// frame, so every picture is shown for the same number of the screen's refreshes: 24 a
// second is every fifth refresh at 120 Hz, and on a 60 Hz screen it becomes every third
// (20 a second) rather than an uneven two-three-two. A frame that does not come (a hidden
// or covered window) is replaced by a timer after `FALLBACK_MS`, so nothing here ever
// waits on a frame for good.
//
// The rate. `AMBIENT_FPS` when nobody is there: 24, the rate of film and of drawn
// animation. `ATTENDED_FPS` (60) while the pointer is on something of Doozer's or was a
// moment ago (`attend`). The window is click-through everywhere else, so any pointer event
// the page sees means someone is at it. The numbers are a trade of smoothness against
// processor time and are the owner's to change (docs/polish-checks.md section 2 has what
// each costs): 30 instead of 24 costs about a third more for everything Doozer does alone.
//
// Never stuck. Nothing here decides when anything ends: scenes, faces and performances
// are ended by timers elsewhere (character/expression-state.ts, ui/lifecycle.ts). This
// file only decides how often the picture is redrawn, and it fails toward the browser's
// own behaviour:
//   - An animation it has not taken over simply runs as the browser runs it.
//   - If a tick throws on one animation, that animation is handed back (`play()`).
//   - It holds no timer when nothing is moving.
//   - Detaching hands everything back at once.
//
// Held animations. An element with `data-live="0"` (the rig's `setLive(false)`, a Card
// nobody is looking at) holds every CSS animation inside it exactly where it is. The
// stylesheet rule that used to do that (`animation-play-state: paused`) cannot reach an
// animation this clock has paused already, so the clock keeps the rule itself. Like that
// rule, it holds the looping CSS animations only: a transition or a one-shot started on a
// resting Doozer (its face changing with its mood) still runs to its end. A change of
// `data-live` anywhere wakes the clock.

import { realTimers, type Timers } from './character/timers';

/** Frames a second with nobody there. */
export const AMBIENT_FPS = 24;
/** Frames a second while the pointer is on Doozer or its things, and for `ATTEND_MS` after. */
export const ATTENDED_FPS = 60;
/** How long after the last sign of somebody the higher rate is kept. */
export const ATTEND_MS = 4000;
/** A frame that has not come after this long is not coming. */
export const FALLBACK_MS = 300;
/** A tick asks for its frame this long before it is due, so that it gets the refresh it is due on. */
const LEAD_MS = 5;
/** Every CSS animation inside an element matching this is held still. */
const HOLD = '[data-live="0"]';

export type FrameCallback = (now: number) => void;
/** Asks for one frame; returns the function that takes the request back. */
export type FrameSource = (callback: FrameCallback) => () => void;

export interface FrameClockOptions {
  timers?: Timers;
  /** Milliseconds, monotonic. */
  now?: () => number;
  /** The screen's own frames. Null: there are none (a test without a DOM), and ticks run on timers alone. */
  requestFrame?: ((callback: () => void) => unknown) | null;
  cancelFrame?: (handle: unknown) => void;
}

/** What the clock has been doing. For the measurements and the tests. */
export interface FrameStats {
  /** Ticks that came with a frame of the screen's, and ticks a timer had to stand in for. */
  ticks: number;
  fallbacks: number;
  /** Animations taken over, finished by the clock, and handed back after an error. */
  adopted: number;
  finished: number;
  released: number;
  /** Animations moved forward on the last tick. */
  moving: number;
  pacing: boolean;
  running: boolean;
  fps: number;
}

interface Owned {
  /** When it was last moved on (or looked at while held). */
  last: number;
  /** Where it has been moved to: its own time, in ms. Kept here so that it never has to be read back. */
  at: number;
  /** It loops for ever: there is no end to look for. */
  endless: boolean;
}

type AnimationSource = { getAnimations(): Animation[]; timeline?: AnimationTimeline | null };

/** Is this a CSS animation (a rule in a stylesheet), inside something that is resting? */
function held(animation: Animation): boolean {
  if (!('animationName' in animation)) return false;
  const target = (animation.effect as KeyframeEffect | null)?.target ?? null;
  return !!target && typeof target.closest === 'function' && target.closest(HOLD) !== null;
}

const globalFrame = (): ((callback: () => void) => unknown) | null =>
  typeof requestAnimationFrame === 'function' ? (callback) => requestAnimationFrame(() => callback()) : null;

export class FrameClock {
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly requestFrame: ((callback: () => void) => unknown) | null;
  private readonly cancelFrame: (handle: unknown) => void;

  private readonly callbacks = new Map<number, FrameCallback>();
  private nextId = 1;
  private owned = new WeakMap<Animation, Owned>();
  /** Animations that could not be moved: handed back for good, never taken over again. */
  private readonly givenUp = new WeakSet<Animation>();
  /** The clock was at rest before this tick: no time has passed for anything it holds. */
  private rested = true;
  private source: AnimationSource | null = null;
  private detach: (() => void) | null = null;

  private pacing_ = false;
  private running_ = false;
  private last = -Infinity;
  private waiting: unknown = null;
  private frame: unknown = null;
  private fallback: unknown = null;
  private attendedUntil = -Infinity;
  private ambient = AMBIENT_FPS;
  private attended = ATTENDED_FPS;
  private readonly stats_ = { ticks: 0, fallbacks: 0, adopted: 0, finished: 0, released: 0, moving: 0 };

  constructor(options: FrameClockOptions = {}) {
    this.timers = options.timers ?? realTimers;
    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame === undefined ? globalFrame() : options.requestFrame;
    this.cancelFrame = options.cancelFrame ?? ((handle) => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle as number); });
  }

  // ---- for whatever moves things by script ------------------------------------------

  /**
   * One frame, no sooner than the cap allows. Like `requestAnimationFrame`, but shared:
   * everything asked for is run on the same tick, just before the animations are moved on.
   */
  readonly request: FrameSource = (callback) => {
    if (!this.pacing_) {
      // Not pacing (a test, a dev page, or switched off): the screen's own frames, as they come.
      if (!this.requestFrame) return () => {};
      const handle = this.requestFrame(() => callback(this.now()));
      return () => this.cancelFrame(handle);
    }
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    this.wake();
    return () => { this.callbacks.delete(id); };
  };

  /** `request`, or null where there are no frames at all (so callers fall back to their timers). */
  frameSource(): FrameSource | null {
    return this.pacing_ || this.requestFrame ? this.request : null;
  }

  /** Something may have started moving: look on the next tick. Cheap; call it freely. */
  wake(): void {
    if (this.running_ || !this.pacing_) return;
    this.running_ = true;
    this.rested = true;
    this.schedule();
  }

  /** Somebody is there: draw at the higher rate for a while. */
  attend(ms: number = ATTEND_MS): void {
    const until = this.now() + Math.max(0, ms);
    if (until > this.attendedUntil) this.attendedUntil = until;
  }

  /** The cap right now. */
  get fps(): number {
    return this.now() < this.attendedUntil ? this.attended : this.ambient;
  }

  /** Change the two rates (experiments, tests). */
  setRates(rates: { ambient?: number; attended?: number }): void {
    if (rates.ambient !== undefined && rates.ambient > 0) this.ambient = rates.ambient;
    if (rates.attended !== undefined && rates.attended > 0) this.attended = rates.attended;
  }

  // ---- taking the page's animations over ----------------------------------------------

  /**
   * Start pacing a document's animations. Returns the function that stops it and hands
   * every animation back to the browser.
   */
  attach(doc: Document): () => void {
    this.detach?.();
    if (typeof doc.getAnimations !== 'function') return () => {};
    this.source = doc;
    this.pacing_ = true;
    const wake = (): void => this.wake();
    const attend = (): void => { this.attend(); };
    const wakers = ['animationstart', 'animationiteration', 'transitionrun'] as const;
    const signs = ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const;
    for (const type of wakers) doc.addEventListener(type, wake, true);
    for (const type of signs) doc.addEventListener(type, attend, { capture: true, passive: true });
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(wake) : null;
    observer?.observe(doc.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-live'] });
    const detach = (): void => {
      if (this.detach !== detach) return;
      this.detach = null;
      for (const type of wakers) doc.removeEventListener(type, wake, true);
      for (const type of signs) doc.removeEventListener(type, attend, true);
      observer?.disconnect();
      this.pacing_ = false;
      this.releaseAll();
      this.source = null;
      // Whoever was waiting for a paced frame gets the screen's next one instead.
      const due = [...this.callbacks.values()];
      this.callbacks.clear();
      this.clear();
      this.running_ = false;
      for (const callback of due) this.request(callback);
    };
    this.detach = detach;
    this.wake();
    return detach;
  }

  get pacing(): boolean { return this.pacing_; }

  get stats(): FrameStats {
    return { ...this.stats_, pacing: this.pacing_, running: this.running_, fps: this.fps };
  }

  /** Stop everything. For tests and hot reload. */
  dispose(): void {
    this.detach?.();
    this.callbacks.clear();
    this.clear();
    this.running_ = false;
  }

  // ---- the tick -------------------------------------------------------------------------

  private clear(): void {
    if (this.waiting !== null) this.timers.clear(this.waiting);
    if (this.frame !== null) this.cancelFrame(this.frame);
    if (this.fallback !== null) this.timers.clear(this.fallback);
    this.waiting = null; this.frame = null; this.fallback = null;
  }

  private schedule(): void {
    // Wait out most of the interval, then take the next frame the screen offers. After a
    // rest the wait is over already, and whatever woke the clock is answered at once.
    const lead = this.requestFrame ? LEAD_MS : 0;
    const wait = 1000 / Math.min(240, Math.max(1, this.fps)) - (this.now() - this.last) - lead;
    if (wait > 2) this.waiting = this.timers.set(() => { this.waiting = null; this.ask(); }, wait);
    else this.ask();
  }

  private ask(): void {
    if (this.requestFrame) this.frame = this.requestFrame(() => { this.frame = null; this.tick(true); });
    this.fallback = this.timers.set(() => { this.fallback = null; this.tick(false); }, this.requestFrame ? FALLBACK_MS : 0);
  }

  private tick(framed: boolean): void {
    this.clear();
    if (!this.running_) return;
    const now = this.now();
    this.last = now;
    if (framed) this.stats_.ticks++; else this.stats_.fallbacks++;

    // The animations first, while nothing in the page has been touched yet: looking at
    // them after a callback has moved something would make the browser work out the
    // page's styles there and then, and again for the frame.
    const moving = this.pacing_ ? this.pace(now) : 0;
    this.stats_.moving = moving;

    if (this.callbacks.size > 0) {
      const due = [...this.callbacks.values()];
      this.callbacks.clear();
      for (const callback of due) {
        try { callback(now); } catch (error) { console.error('[frames] a frame callback threw', error); }
      }
    }

    if (this.pacing_ && (this.callbacks.size > 0 || moving > 0)) this.schedule();
    else this.running_ = false;
  }

  /**
   * Move every animation on to `now`. Returns how many still need another tick.
   *
   * Everything is read first and written afterwards: reading an animation's state after
   * another one's time has been written makes the browser work out the page's styles
   * again, once for every animation (measured: 380 times a second instead of 60).
   */
  private pace(now: number): number {
    const source = this.source;
    if (!source) return 0;
    let list: Animation[];
    try { list = source.getAnimations(); } catch { return 0; }
    const adopt: Array<[Animation, number]> = [];
    const move: Array<[Animation, number]> = [];
    const finish: Animation[] = [];
    // After a rest, everything this clock holds was held the whole time (it only rests
    // when nothing is moving): no time has passed for it, however long the rest was.
    const rested = this.rested;
    this.rested = false;
    for (const animation of list) {
      try {
        const owned = this.owned.get(animation);
        if (!owned) {
          // Paused by whoever made it, finished, or not on the page's own clock: not ours.
          if (animation.playState !== 'running' || this.givenUp.has(animation)) continue;
          if (source.timeline && animation.timeline !== source.timeline) continue;
          const read = Number(animation.currentTime ?? 0);
          const at = Number.isFinite(read) ? read : 0;
          const end = Number(animation.effect?.getComputedTiming().endTime ?? Infinity);
          this.owned.set(animation, { last: now, at, endless: !Number.isFinite(end) });
          adopt.push([animation, at]);
          continue;
        }
        if (animation.playState !== 'paused') {
          // Somebody else has played or finished it since: it is theirs again.
          this.owned.delete(animation);
          continue;
        }
        const elapsed = rested ? 0 : now - owned.last;
        owned.last = now;
        if (held(animation)) continue;
        const next = owned.at + elapsed * animation.playbackRate;
        owned.at = next;
        if (!owned.endless && next >= Number(animation.effect?.getComputedTiming().endTime ?? Infinity)) finish.push(animation);
        else move.push([animation, next]);
      } catch {
        this.release(animation);
      }
    }
    for (const [animation, at] of adopt) {
      try {
        animation.pause();
        // Setting the time completes the pause at once, exactly here.
        animation.currentTime = at;
        this.stats_.adopted++;
      } catch { this.release(animation); }
    }
    for (const [animation, next] of move) {
      try { animation.currentTime = next; } catch { this.release(animation); }
    }
    for (const animation of finish) {
      this.owned.delete(animation);
      this.stats_.finished++;
      try { animation.finish(); } catch { /* it is gone */ }
    }
    return adopt.length + move.length;
  }

  /** Whatever went wrong, the browser can run this one itself, and is left to. */
  private release(animation: Animation): void {
    this.owned.delete(animation);
    this.givenUp.add(animation);
    this.stats_.released++;
    try { animation.play(); } catch { /* it is gone */ }
  }

  private releaseAll(): void {
    const source = this.source;
    if (!source) return;
    let list: Animation[] = [];
    try { list = source.getAnimations(); } catch { /* nothing to hand back */ }
    for (const animation of list) {
      if (!this.owned.has(animation)) continue;
      this.owned.delete(animation);
      try { animation.play(); } catch { /* gone */ }
    }
    this.owned = new WeakMap();
  }
}

/** The one clock of the page. Until `attach` is called it only passes frames through. */
export const frames = new FrameClock();
