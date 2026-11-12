// A tiny timer interface so anything time-based can be driven by a fake clock in tests.

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Looks the globals up at call time, so Vitest's fake timers take effect too. */
export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
