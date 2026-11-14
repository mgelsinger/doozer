// Render on demand (DESIGN_SPEC.md section 10: "nothing animates when nothing is
// happening"). An animation that never stops costs 13-26 % of a processor core in this
// window (docs/shell-spike.md 2.1), so Doozer only moves while there is a reason to:
// the pointer is near, something just happened, or the Card was just opened.
//
// `Attention` is that reason, with a time limit on it. Each `poke` says "lively for at
// least this much longer"; when the time runs out the view goes still. There is no
// state to get stuck in: lively is simply "the deadline has not passed", ended by a timer.
// No DOM in this file.

import { realTimers, type Timers } from '../../character/timers';

export interface AttentionOptions {
  /** Called whenever lively changes. */
  onChange(lively: boolean): void;
  timers?: Timers;
  now?: () => number;
  /** No single poke may keep the view lively longer than this. */
  maxMs?: number;
}

export class Attention {
  private until = -Infinity;
  private timer: unknown = null;
  private on = false;
  private enabled = true;
  private dead = false;
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly maxMs: number;

  constructor(private readonly options: AttentionOptions) {
    this.timers = options.timers ?? realTimers;
    this.now = options.now ?? (() => performance.now());
    this.maxMs = options.maxMs ?? 30_000;
  }

  get lively(): boolean { return this.on; }

  /** Stay lively for at least `ms` from now. A shorter poke never cuts a longer one short. */
  poke(ms: number): void {
    if (this.dead || !this.enabled || !(ms > 0)) return;
    const until = this.now() + Math.min(ms, this.maxMs);
    if (until <= this.until) return;
    this.until = until;
    this.arm();
    this.set(true);
  }

  /** Go still now (the view was tucked away). */
  rest(): void {
    this.disarm();
    this.until = -Infinity;
    this.set(false);
  }

  /** While disabled, pokes are ignored and the view stays still. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.rest();
  }

  destroy(): void {
    this.dead = true;
    this.disarm();
    this.on = false;
  }

  private arm(): void {
    this.disarm();
    this.timer = this.timers.set(() => {
      this.timer = null;
      // The deadline may have moved while the timer ran.
      if (this.now() < this.until - 1) this.arm();
      else this.set(false);
    }, Math.max(0, this.until - this.now()));
  }

  private disarm(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private set(on: boolean): void {
    if (this.on === on || this.dead) return;
    this.on = on;
    this.options.onChange(on);
  }
}
