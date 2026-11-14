// The view's timers, each with a name. Arming a name again replaces the timer that had
// it, so there is never more than one of a kind; and "nothing of this view is running"
// (tucked away, unmounted) can be checked, because the names that are armed can be listed.

import type { Timers } from '../../character/timers';

export class NamedTimers {
  private readonly armed = new Map<string, unknown>();
  private dead = false;

  constructor(private readonly timers: Timers) {}

  /** Run `fn` once, `ms` from now. Replaces any timer of the same name. */
  arm(name: string, ms: number, fn: () => void): void {
    this.disarm(name);
    if (this.dead) return;
    const handle = this.timers.set(() => {
      if (this.armed.get(name) !== handle) return;
      this.armed.delete(name);
      fn();
    }, Math.max(0, Number.isFinite(ms) ? ms : 0));
    this.armed.set(name, handle);
  }

  disarm(name: string): void {
    if (!this.armed.has(name)) return;
    this.timers.clear(this.armed.get(name));
    this.armed.delete(name);
  }

  has(name: string): boolean {
    return this.armed.has(name);
  }

  names(): string[] {
    return [...this.armed.keys()];
  }

  /** Stop every timer. More can be armed afterwards. */
  clear(): void {
    for (const name of [...this.armed.keys()]) this.disarm(name);
  }

  /** Stop every timer, for good. */
  dispose(): void {
    this.clear();
    this.dead = true;
  }
}
