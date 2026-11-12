import type { Brain, BrainEvents, BrainOptions } from '../../src/core';
import { createBrain } from '../../src/core';

export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Wednesday 11 November 2026, 09:00 local time. Built from local parts so tests do not depend on the time zone. */
export const START = new Date(2026, 10, 11, 9, 0, 0).getTime();

export function at(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0).getTime();
}

export interface FakeClock {
  now: () => number;
  /** Move the clock forward (or back, with a negative number). */
  advance(ms: number): void;
  set(ms: number): void;
}

export function fakeClock(start = START): FakeClock {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => void (t += ms),
    set: (ms) => void (t = ms),
  };
}

/** A small deterministic random source (mulberry32). */
export function seeded(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Recorded = { [E in keyof BrainEvents]: { type: E; detail: BrainEvents[E] } }[keyof BrainEvents];

const EVENT_TYPES: (keyof BrainEvents)[] = ['change', 'mood', 'need', 'action', 'refuse', 'focus', 'away', 'settings'];

/** Subscribe to everything and collect it in order. */
export function record(brain: Brain): Recorded[] {
  const seen: Recorded[] = [];
  for (const type of EVENT_TYPES) {
    brain.on(type, (detail) => void seen.push({ type, detail } as Recorded));
  }
  return seen;
}

export function of<E extends keyof BrainEvents>(seen: Recorded[], type: E): BrainEvents[E][] {
  return seen.filter((e) => e.type === type).map((e) => e.detail as BrainEvents[E]);
}

export interface Rig {
  brain: Brain;
  clock: FakeClock;
  events: Recorded[];
  debug: NonNullable<Brain['debug']>;
  /** Move the clock forward and tick once. */
  pass(ms: number): void;
  /** Move the clock forward in small steps, ticking after each, the way the running app does. */
  live(ms: number, stepMs?: number): void;
  /** Forget the events recorded so far. */
  clear(): void;
  /** Save, then start a new brain from that save on the same clock (optionally later). */
  restart(afterMs?: number): Rig;
}

export function rig(options: BrainOptions & { clock?: FakeClock; seed?: number } = {}): Rig {
  const clock = options.clock ?? fakeClock();
  const brain = createBrain({
    save: options.save,
    now: options.now ?? clock.now,
    random: options.random ?? seeded(options.seed ?? 1),
    debug: options.debug ?? true,
  });
  const events = record(brain);
  const self: Rig = {
    brain,
    clock,
    events,
    debug: brain.debug as NonNullable<Brain['debug']>,
    pass(ms) {
      clock.advance(ms);
      brain.tick();
    },
    live(ms, stepMs = 30 * SEC) {
      let left = ms;
      while (left > 0) {
        const step = Math.min(left, stepMs);
        clock.advance(step);
        brain.tick();
        left -= step;
      }
    },
    clear() {
      events.length = 0;
    },
    restart(afterMs = 0) {
      const save = JSON.parse(JSON.stringify(brain.serialize())) as unknown;
      clock.advance(afterMs);
      return rig({ ...options, save, clock });
    },
  };
  return self;
}

/** The exact (unrounded) numbers inside a save, for comparing two pets closely. */
export function exact(brain: Brain): { needs: Record<string, number>; bond: number; bowl: number; asleep: boolean; treats: number } {
  const save = brain.serialize() as { pet: { needs: Record<string, number>; bond: number; bowl: number; asleep: boolean; treats: number } };
  return save.pet;
}
