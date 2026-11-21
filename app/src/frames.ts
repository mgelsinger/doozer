// The page's frame clock: everything that moves is drawn at a capped rate.
//
// Why. In this window a frame costs the same whatever is on it: the page lays out and
// paints, its compositor commits, the browser's display compositor draws, and the picture
// is presented, across three processes. Measured (docs/polish-checks.md section 2): two to
// three milliseconds of processor time a frame, so Doozer walking on a 120 Hz screen cost
// about a third of one core, and 120 of those frames a second is far more than a small soft
// creature needs. Drawing the same motion 24 times a second costs about a quarter as much.
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
// A tick waits out most of its interval on a timer and then takes the screen's frame it
// was aiming for, so every picture is shown for the same number of the screen's
// refreshes: 24 a second is every fifth refresh at 120 Hz, and on a 60 Hz screen it
// becomes every third (20 a second) rather than an uneven two-three-two. Two things make
// that true, both found by looking at when the pictures really reached the screen
// (docs/polish-checks.md section 6): the wait is taken in short hops, because the
// browser lets a long timer slip; and a frame that belongs to an earlier refresh than
// the one aimed for (the browser hands a page that has been idle the frame it just
// missed, at once) is passed over for the next. A frame that does not come (a hidden or
// covered window) is replaced by a timer after `FALLBACK_MS`, so nothing here ever waits
// on a frame for good.
//
// Whole refreshes. A frame passed over is a frame asked for and thrown away, and on a
// screen whose refresh the rate does not divide (24 a second at 60 or 90 Hz, 60 a second at
// 75, 144 or 165 Hz) that was one for every picture. But a frame passed over and the one
// taken after it are two refreshes in a row, so the gap between their stamps is the
// screen's refresh interval, measured for nothing. Once a few of those agree the clock
// knows the screen (`refresh`), and from then on aims each tick a whole number of
// refreshes after the last (`whole`): the fewest that do not go over the rate asked for,
// which is the very refresh the passing-over was arriving at. The pictures come exactly
// when they did, and no frame is wasted on the way. On a screen the rate already divides
// nothing is ever passed over, so nothing is measured and nothing changes. On a screen
// that does not keep one interval (a variable or unsteady refresh) the measurements do not
// agree, none is believed, and the clock goes on as before; and a believed interval that
// stops fitting (the window carried to another monitor) is forgotten and measured again.
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
/** An interval at least this long is one the page goes idle in; see `schedule`. */
const IDLE_MS = 30;
/** How long after the refresh aimed for an idle page asks for its frame. */
const AFTER_MS = 1;
/** A frame stamped more than this long before the moment aimed for belongs to an earlier refresh. */
const EARLY_MS = 2;
/** The longest single timer a tick waits on; see `waitUntil`. */
const HOP_MS = 24;
/** How many measurements of the screen's refresh interval, one after another, must agree before it is believed. */
const REFRESH_SAMPLES = 3;
/** After being wrong about a screen, the clock asks for more agreement the next time: up to this many. */
const REFRESH_SAMPLES_MOST = 24;
/** Two measurements agree if they are within this share of each other (and a tenth of a millisecond for the stamps' own coarseness). */
const REFRESH_AGREES = 0.04;
/** A refresh interval outside these is not a screen's (20 to 500 Hz). */
const REFRESH_RANGE = [2, 50] as const;
/** A picture stamped within this of the moment aimed for was on the refresh aimed for. */
const ON_AIM_MS = 1;
/** This many pictures off their aim, without a good run between, and the refresh interval is no longer believed. */
const MISSES_MOST = 4;
/** A run of pictures on their aim this long clears the slate. */
const CLEAN_RUN = 48;
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
  requestFrame?: ((callback: (frameTime?: number) => void) => unknown) | null;
  cancelFrame?: (handle: unknown) => void;
}

/** What the clock has been doing. For the measurements and the tests. */
export interface FrameStats {
  /** Ticks that came with a frame of the screen's, and ticks a timer had to stand in for. */
  ticks: number;
  fallbacks: number;
  /** Frames passed over because they belonged to an earlier refresh than the one aimed for, and pictures that came a refresh late. */
  passedOver: number;
  late: number;
  /** The screen's refresh interval in ms, once it has been measured and believed; and how many of them a picture is now held for (0: the rate as asked). */
  refresh: number | null;
  wholes: number;
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

const globalFrame = (): ((callback: (frameTime?: number) => void) => unknown) | null =>
  typeof requestAnimationFrame === 'function' ? (callback) => requestAnimationFrame((frameTime) => callback(frameTime)) : null;

export class FrameClock {
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly requestFrame: ((callback: (frameTime?: number) => void) => unknown) | null;
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
  /** The moment the next tick is aiming for. */
  private aim = -Infinity;
  /** The interval the ticks are being spaced at, and what has been learnt of the page at that rate. */
  private interval = 0;
  /** True: the page goes idle between ticks and is handed a missed frame at once. Null: not known yet. */
  private idle: boolean | null = null;
  /** This tick's frame is being asked for just after the moment aimed for, not just before. */
  private after = false;
  /** The screen's refresh interval, measured from frames that came one after another. Null: not known, or never needed. */
  private refresh: number | null = null;
  /** How many refreshes the interval in force is, when it was worked out from `refresh`; 0 when it is the rate as asked. */
  private wholes = 0;
  /** Measurements of the refresh interval that agree so far, and how many it takes. */
  private samples: number[] = [];
  private samplesNeeded = REFRESH_SAMPLES;
  /** The stamp of a frame just passed over: the next one is the next refresh. */
  private passedAt: number | null = null;
  /** Pictures off their aim since the refresh was believed, and pictures on it in a row. */
  private misses = 0;
  private clean = 0;
  private waiting: unknown = null;
  private frame: unknown = null;
  private fallback: unknown = null;
  private attendedUntil = -Infinity;
  private readonly arrivals = new Set<() => void>();
  private ambient = AMBIENT_FPS;
  private attended = ATTENDED_FPS;
  private readonly stats_ = { ticks: 0, fallbacks: 0, passedOver: 0, late: 0, adopted: 0, finished: 0, released: 0, moving: 0 };

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
    const now = this.now();
    const arriving = now >= this.attendedUntil;
    const until = now + Math.max(0, ms);
    if (until > this.attendedUntil) this.attendedUntil = until;
    if (arriving && now < this.attendedUntil) {
      for (const listener of [...this.arrivals]) {
        try { listener(); } catch (error) { console.error('[frames] an arrival listener threw', error); }
      }
    }
  }

  /** Is somebody there: was there a sign of them in the last few seconds? */
  get attendedNow(): boolean {
    return this.now() < this.attendedUntil;
  }

  /**
   * Call `listener` when somebody arrives after nobody was there. For whatever else goes
   * slower with nobody looking (the host's clock). Returns the function that stops it.
   */
  onArrive(listener: () => void): () => void {
    this.arrivals.add(listener);
    return () => { this.arrivals.delete(listener); };
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
    return { ...this.stats_, refresh: this.refresh, wholes: this.wholes, pacing: this.pacing_, running: this.running_, fps: this.fps };
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
    const interval = this.whole(1000 / Math.min(240, Math.max(1, this.fps)));
    // (A different rate, that is: the measured refresh is corrected by hairs all the time,
    // and that is no reason to forget how the page behaves at this one.)
    if (Math.abs(interval - this.interval) > 0.5) this.idle = null;
    this.interval = interval;
    this.aim = this.last + interval;
    // At a quick rate the page is still being offered every refresh, and a frame asked for
    // a little before the one aimed for is that one. At a slow rate the page has gone idle
    // by then, and is handed the refresh it has just missed the moment it asks: asked for
    // a little *after* the one aimed for, that is the very one, with nothing to pass over.
    // Which of the two the page is, at this rate, is learnt from what the last frame turned
    // out to be (`askFrame`); until then it is guessed from the length of the interval.
    this.after = this.requestFrame !== null && (this.idle ?? interval >= IDLE_MS);
    const lead = !this.requestFrame ? 0 : this.after ? -AFTER_MS : LEAD_MS;
    this.waitUntil(this.aim - lead);
  }

  /**
   * The interval to space the ticks at, for a rate that asks for `asked` ms: `asked` itself
   * until the screen's refresh interval is known, and then a whole number of refreshes.
   *
   * The rate asked for is a ceiling, not a target: the fewest refreshes that do not go
   * over it (give or take `EARLY_MS`, as `askFrame` does). That is the refresh the clock
   * was arriving at anyway, by passing over the one before it, so knowing the screen
   * changes how many frames are asked for and not when the pictures come: 24 a second is
   * every third refresh at 60 Hz, every fourth at 90, every seventh at 165; 60 a second is
   * every second refresh at 75 Hz and every third at 144 and 165.
   */
  private whole(asked: number): number {
    const refresh = this.refresh;
    if (refresh === null) { this.wholes = 0; return asked; }
    const wholes = Math.max(1, Math.ceil((asked - EARLY_MS) / refresh));
    this.wholes = wholes;
    const interval = wholes * refresh;
    // The rate as asked is already a whole number of this screen's refreshes (24 a second
    // at 120 or 144 Hz): leave it exactly as asked, measurement and all.
    return Math.abs(interval - asked) < 0.02 * asked ? asked : interval;
  }

  /** One more measurement of the screen's refresh interval: two frames, one straight after the other. */
  private measure(gap: number): void {
    if (!(gap >= REFRESH_RANGE[0] && gap <= REFRESH_RANGE[1])) return;
    const first = this.samples[0];
    if (first !== undefined && Math.abs(gap - first) > REFRESH_AGREES * first + 0.1) this.samples = [];
    this.samples.push(gap);
    if (this.samples.length < this.samplesNeeded) return;
    this.refresh = this.samples.reduce((sum, sample) => sum + sample, 0) / this.samples.length;
    this.samples = [];
    this.misses = 0;
    this.clean = 0;
  }

  /** A picture came on the refresh it was aimed at, `gap` ms after the last one. */
  private onAim(gap: number): void {
    if (this.refresh === null) return;
    // The stamps are only so fine: let the gaps between pictures keep correcting the figure.
    if (this.wholes > 0 && Number.isFinite(gap) && gap > 0) {
      const seen = gap / this.wholes;
      if (Math.abs(seen - this.refresh) < REFRESH_AGREES * this.refresh) this.refresh += (seen - this.refresh) * 0.1;
    }
    if (++this.clean >= CLEAN_RUN) {
      this.misses = 0;
      if (this.clean >= CLEAN_RUN * 5) this.samplesNeeded = REFRESH_SAMPLES;
    }
  }

  /** A picture did not come on the refresh it was aimed at. Too many of those and the screen is not what was measured. */
  private offAim(): void {
    this.clean = 0;
    if (this.refresh === null || ++this.misses < MISSES_MOST) return;
    this.refresh = null;
    this.samples = [];
    this.misses = 0;
    this.samplesNeeded = Math.min(REFRESH_SAMPLES_MOST, this.samplesNeeded * 2);
  }

  /**
   * Wait until `due`, then ask for the frame. A long wait is taken in hops of at most
   * `HOP_MS`: the browser keeps a timer to the millisecond only if it is short (under
   * about 32 ms on Windows) and otherwise lets it slip to the system's 15.6 ms beat, which
   * at 24 pictures a second showed one picture for four refreshes of the screen and the
   * next for six (docs/polish-checks.md section 6).
   */
  private waitUntil(due: number): void {
    const left = due - this.now();
    if (left <= 2) { this.ask(); return; }
    const hop = left > HOP_MS ? left / Math.ceil(left / HOP_MS) : left;
    this.waiting = this.timers.set(() => { this.waiting = null; this.waitUntil(due); }, hop);
  }

  private ask(): void {
    this.askFrame(true);
    this.fallback = this.timers.set(() => { this.fallback = null; this.tick(false); }, this.requestFrame ? FALLBACK_MS : 0);
  }

  /**
   * Take the screen's frame, if it is the one this tick is aiming for. The browser stamps
   * a frame with the moment of the refresh it belongs to. A page that has been idle for a
   * few refreshes is handed, at once, the frame of the refresh it has just missed: drawn
   * on that one, pictures come whenever the timer happened to fire and are shown for four
   * refreshes or six as it falls. So a frame from before the aimed-for refresh is passed
   * over, once, for the next one, which is the refresh itself.
   */
  private askFrame(mayPassOver: boolean): void {
    if (!this.requestFrame) return;
    this.frame = this.requestFrame((frameTime) => {
      this.frame = null;
      const now = this.now();
      // A stamp is believed only if it is a moment ago on this clock.
      const stamped = typeof frameTime === 'number' && frameTime <= now + 1 && now - frameTime < 100;
      // (Only a frame near the moment aimed for says anything: after a rest there was no aim.)
      const near = stamped && Math.abs(frameTime - this.aim) < 40;
      // The frame after one passed over is the very next refresh: the gap is the screen's interval.
      const passedAt = this.passedAt;
      this.passedAt = null;
      if (!mayPassOver && stamped && passedAt !== null) this.measure(frameTime - passedAt);
      if (near && frameTime < this.aim - EARLY_MS) {
        // The refresh before the one aimed for: the page had gone idle and was handed it at once.
        this.idle = true;
        if (mayPassOver) {
          this.stats_.passedOver++;
          this.offAim();
          this.passedAt = frameTime;
          this.askFrame(false);
          return;
        }
      } else if (near && this.after && frameTime > this.aim + EARLY_MS) {
        // Asked just after the refresh aimed for, and given the next one: the page was not
        // idle after all. This picture is a refresh late; the next is asked for beforehand.
        this.idle = false;
        this.stats_.late++;
        this.offAim();
      } else if (near && mayPassOver) {
        if (Math.abs(frameTime - this.aim) <= ON_AIM_MS) this.onAim(frameTime - this.last);
        else if (this.wholes > 0) this.offAim();
      }
      this.tick(true, stamped ? frameTime : now);
    });
  }

  private tick(framed: boolean, frameTime?: number): void {
    this.clear();
    if (!this.running_) return;
    const now = this.now();
    // Counting from the refresh the picture belongs to, not from when its turn came, keeps
    // the ticks in step with the screen instead of drifting across it.
    // (With no stamp to go by, a tick that came just after the moment it aimed for counts as that moment.)
    this.last = frameTime ?? (now >= this.aim && now - this.aim < 8 ? this.aim : now);
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
