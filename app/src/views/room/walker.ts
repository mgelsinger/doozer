// Where Doozer is on the floor, as a function of time. No DOM and no animation frames:
// a walk is "from here to there, starting now, taking this long", the page draws it as
// one CSS transition, and where Doozer is at any moment is worked out from the clock.
//
// That is what makes a walk safe to interrupt: `stop()` freezes Doozer exactly where it
// has got to, and there is no loop that could be left running. When a walk has arrived
// is decided by whoever started it, with a timer; the walker only answers questions.

export interface WalkerOptions {
  x: number;
  /** Milliseconds, monotonic. */
  now: () => number;
  /** Draw Doozer at `x`, getting there over `ms` (0: at once). */
  apply(x: number, ms: number): void;
  min?: number;
  max?: number;
}

export class Walker {
  private from: number;
  private to: number;
  private startedAt = 0;
  private duration = 0;
  private readonly min: number;
  private readonly max: number;

  constructor(private readonly options: WalkerOptions) {
    this.min = options.min ?? -Infinity;
    this.max = options.max ?? Infinity;
    this.from = this.to = this.clamp(options.x);
    options.apply(this.to, 0);
  }

  /** Where Doozer is right now. */
  get x(): number {
    if (this.duration <= 0) return this.to;
    const t = (this.options.now() - this.startedAt) / this.duration;
    if (!(t < 1)) return this.to;
    return this.from + (this.to - this.from) * Math.max(0, t);
  }

  /** Where it is heading. The same as `x` when it is standing still. */
  get target(): number { return this.to; }

  get moving(): boolean {
    return this.duration > 0 && this.options.now() - this.startedAt < this.duration;
  }

  /** Start walking. Returns how long it will take, in milliseconds. */
  walkTo(x: number, pxPerSecond: number): number {
    const from = this.x;
    const to = this.clamp(x);
    const ms = pxPerSecond > 0 ? Math.round((Math.abs(to - from) / pxPerSecond) * 1000) : 0;
    this.from = from;
    this.to = to;
    this.startedAt = this.options.now();
    this.duration = ms;
    // Pin the starting point first, so the transition runs from where Doozer really is.
    this.options.apply(from, 0);
    if (ms > 0) this.options.apply(to, ms);
    return ms;
  }

  /** Stand still, exactly where it has got to. */
  stop(): void {
    this.place(this.x);
  }

  /** Be at `x`, now. */
  place(x: number): void {
    this.from = this.to = this.clamp(x);
    this.duration = 0;
    this.options.apply(this.to, 0);
  }

  private clamp(x: number): number {
    return Math.min(this.max, Math.max(this.min, Number.isFinite(x) ? x : this.to ?? 0));
  }
}
