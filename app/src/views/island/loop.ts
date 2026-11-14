// Render on demand, with a capped frame rate (WORK_PLAN.md section 11, task 5).
//
// The loop only exists while there is something to draw. `wake()` starts it; it calls
// `step(seconds, draw)` once per frame and goes back to sleep the first time `step`
// answers false. Asleep, it holds no timer and asks for no frame: the page costs nothing.
//
// The frame rate is capped by waiting before asking for the next frame, so a 120 Hz
// screen is not woken 120 times a second to draw 30.
//
// Never stuck: a frame that does not come (the window is hidden, covered or tucked away,
// and the page is not told) is replaced by a timer after `FALLBACK_MS`. Time then still
// passes for the simulation, with `draw` false, so a hop still lands, a scene still
// reaches its end and the loop still goes back to sleep. No DOM in this file.

import { realTimers, type Timers } from '../../character/timers';

export interface FrameLoopOptions {
  /** One frame: advance by `seconds` and, if `draw`, draw. Return true to be called again. */
  step(seconds: number, draw: boolean): boolean;
  /** The most frames per second wanted right now. Asked before every frame. */
  fps(): number;
  requestFrame(callback: () => void): unknown;
  cancelFrame(handle: unknown): void;
  timers?: Timers;
  /** Milliseconds, monotonic. */
  now?: () => number;
}

/** A frame that has not come after this long is not coming. */
export const FALLBACK_MS = 300;
/** The longest stretch of time one step is ever given. */
const MAX_STEP_MS = 250;

export class FrameLoop {
  private running_ = false;
  private last = 0;
  private frame: unknown = null;
  private waiting: unknown = null;
  private fallback: unknown = null;
  private dead = false;
  private fresh = false;
  private readonly timers: Timers;
  private readonly now: () => number;
  /** Frames drawn and steps taken without drawing, for the measurements and the tests. */
  drawn = 0;
  undrawn = 0;

  constructor(private readonly options: FrameLoopOptions) {
    this.timers = options.timers ?? realTimers;
    this.now = options.now ?? (() => performance.now());
  }

  get running(): boolean { return this.running_; }

  /** Something changed: draw until `step` says there is nothing left to do. */
  wake(): void {
    if (this.dead || this.running_) return;
    this.running_ = true;
    this.fresh = true;
    this.last = this.now();
    this.request();
  }

  /** Go quiet now. `wake()` starts it again. */
  sleep(): void {
    this.running_ = false;
    this.clear();
  }

  destroy(): void {
    this.dead = true;
    this.sleep();
  }

  private clear(): void {
    if (this.frame !== null) this.options.cancelFrame(this.frame);
    if (this.waiting !== null) this.timers.clear(this.waiting);
    if (this.fallback !== null) this.timers.clear(this.fallback);
    this.frame = null; this.waiting = null; this.fallback = null;
  }

  private cap(): number {
    const fps = this.options.fps();
    return Number.isFinite(fps) ? Math.max(1, Math.min(240, fps)) : 60;
  }

  private schedule(): void {
    // Wait out most of the interval, then take the next frame the screen offers.
    const wait = 1000 / this.cap() - (this.now() - this.last) - 5;
    if (wait > 3) this.waiting = this.timers.set(() => { this.waiting = null; this.request(); }, wait);
    else this.request();
  }

  private request(): void {
    this.frame = this.options.requestFrame(() => { this.frame = null; this.tick(true); });
    this.fallback = this.timers.set(() => { this.fallback = null; this.tick(false); }, FALLBACK_MS);
  }

  private tick(draw: boolean): void {
    this.clear();
    if (!this.running_ || this.dead) return;
    const t = this.now();
    // A frame the screen offered too soon is passed over: the cap is a cap on any screen.
    // (Not the first one after waking: whatever woke the loop is answered at once.)
    if (draw && !this.fresh && t - this.last < 1000 / this.cap() - 1.5) { this.request(); return; }
    this.fresh = false;
    const elapsed = Math.max(0, Math.min(MAX_STEP_MS, t - this.last));
    this.last = t;
    let more = false;
    try {
      more = this.options.step(elapsed / 1000, draw);
    } catch (error) {
      // A frame that throws must not leave the loop believing it is still running.
      this.running_ = false;
      throw error;
    }
    if (draw) this.drawn++; else this.undrawn++;
    if (!this.running_ || this.dead) return;
    if (more) this.schedule();
    else this.running_ = false;
  }
}
