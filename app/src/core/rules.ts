// How Doozer changes when nobody is touching it: needs drain, it eats from the bowl,
// it falls asleep and wakes.
//
// Time is not chopped into fixed steps. Between two "things happening" every need
// moves in a straight line, so `advance` works out when the next thing will happen
// (energy runs out, tummy drops to the bowl line, a need hits a threshold), jumps
// exactly there, applies it, and repeats. That is what makes one twelve-hour jump give
// the same answer as 172,800 quarter-second ticks.

import type { MealId, NeedKey } from './contract';
import type { PetCore } from './save';
import { LIMITS, MEALS, NEED_KEYS, TUNING } from './tuning';

/** Things Doozer did by itself while time passed, in the order they happened. */
export type SelfAction =
  | { type: 'auto-eat'; food: MealId }
  | { type: 'sleep'; why: 'exhausted' }
  | { type: 'wake'; why: 'rested' };

export interface AdvanceLog {
  actions: SelfAction[];
  /** True if Doozer was asleep at any moment during the advance. */
  slept: boolean;
}

/** Boundaries closer than this (in seconds) are not worth stopping for. */
const EPS = 1e-6;
/** Far more stops than twelve hours can ever need; a guard against a logic slip, not a limit. */
const MAX_STOPS = 100_000;

export function clamp(v: number, lo = 0, hi = 100): number {
  return Math.min(hi, Math.max(lo, v));
}

export function pick<T>(items: readonly T[], random: () => number, fallback: T): T {
  const r = random();
  const i = Number.isFinite(r) ? Math.min(items.length - 1, Math.max(0, Math.floor(r * items.length))) : 0;
  return items[i] ?? fallback;
}

function eatFromBowl(pet: PetCore, random: () => number, log: AdvanceLog): void {
  pet.bowl -= 1;
  pet.needs.tummy = clamp(pet.needs.tummy + TUNING.meal.tummy);
  pet.bowlWait = TUNING.bowlPaceSeconds;
  log.actions.push({ type: 'auto-eat', food: pick(MEALS, random, 'apple') });
}

function fallAsleep(pet: PetCore, log: AdvanceLog): void {
  pet.asleep = true;
  log.slept = true;
  log.actions.push({ type: 'sleep', why: 'exhausted' });
}

function wakeRested(pet: PetCore, log: AdvanceLog): void {
  pet.asleep = false;
  log.actions.push({ type: 'wake', why: 'rested' });
}

/** Apply everything that is already due, without any time passing. */
function settle(pet: PetCore, random: () => number, log: AdvanceLog): void {
  for (let i = 0; i < 16; i++) {
    const n = pet.needs;
    if (!pet.asleep && n.energy <= TUNING.collapse) fallAsleep(pet, log);
    else if (pet.asleep && n.energy >= TUNING.rested) wakeRested(pet, log);
    else if (!pet.asleep && pet.bowl > 0 && pet.bowlWait <= 0 && n.tummy < TUNING.bowlEatBelow) {
      eatFromBowl(pet, random, log);
    } else return;
  }
}

/** Points per second each need is moving at right now (zero when pinned at 0 or 100). */
function ratesNow(pet: PetCore): Record<NeedKey, number> {
  const d = TUNING.drain;
  const f = TUNING.asleepFactor;
  const perHour: Record<NeedKey, number> = pet.asleep
    ? { tummy: -d.tummy * f.tummy, fun: -d.fun * f.fun, energy: TUNING.sleepGain, clean: -d.clean * f.clean }
    : { tummy: -d.tummy, fun: -d.fun, energy: -d.energy, clean: -d.clean };
  const out = { tummy: 0, fun: 0, energy: 0, clean: 0 };
  for (const key of NEED_KEYS) {
    const r = perHour[key];
    const v = pet.needs[key];
    out[key] = (r < 0 && v <= 0) || (r > 0 && v >= 100) ? 0 : r / 3600;
  }
  return out;
}

function average(needs: Record<NeedKey, number>): number {
  return (needs.tummy + needs.fun + needs.energy + needs.clean) / NEED_KEYS.length;
}

/**
 * Move the pet forward by `seconds` of pet time. Mutates `pet`; reports what Doozer
 * did on its own in `log`. Calling it once with a long time or many times with short
 * ones gives the same pet.
 */
export function advance(pet: PetCore, seconds: number, random: () => number, log: AdvanceLog): void {
  let remaining = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (pet.asleep) log.slept = true;

  for (let stop = 0; stop < MAX_STOPS; stop++) {
    settle(pet, random, log);
    if (remaining <= 0) return;

    const n = pet.needs;
    const rate = ratesNow(pet);

    // Find the nearest moment at which something changes.
    let dt = remaining;
    let hit: (() => void) | null = null;
    const consider = (t: number, apply: (() => void) | null): void => {
      if (t < dt) {
        dt = t;
        hit = apply;
      }
    };
    /** A line to stop at only so the straight-line maths stays valid. Nothing happens there. */
    const boundary = (key: NeedKey, level: number): void => {
      const r = rate[key];
      if (r === 0) return;
      const t = (level - n[key]) / r;
      if (t > EPS) consider(t, () => void (n[key] = level));
    };

    for (const key of NEED_KEYS) {
      boundary(key, rate[key] < 0 ? 0 : 100); // pinned from here on
      boundary(key, LIMITS.urgent); // bond behaves differently on each side
    }
    const wellRate = average(rate);
    if (wellRate !== 0) {
      const t = (TUNING.bondWellAbove - average(n)) / wellRate;
      if (t > EPS) consider(t, null);
    }

    // Things that change what Doozer is doing. These may be due at t = 0.
    if (pet.asleep) {
      if (rate.energy > 0) {
        consider(Math.max(0, (TUNING.rested - n.energy) / rate.energy), () => {
          n.energy = TUNING.rested;
          wakeRested(pet, log);
        });
      }
    } else {
      if (rate.energy < 0) {
        consider(Math.max(0, (TUNING.collapse - n.energy) / rate.energy), () => {
          n.energy = TUNING.collapse;
          fallAsleep(pet, log);
        });
      }
      if (pet.bowl > 0) {
        if (pet.bowlWait > 0) {
          consider(pet.bowlWait, () => void (pet.bowlWait = 0));
        } else if (rate.tummy < 0) {
          consider(Math.max(0, (TUNING.bowlEatBelow - n.tummy) / rate.tummy), () => {
            n.tummy = TUNING.bowlEatBelow;
            eatFromBowl(pet, random, log);
          });
        }
      }
    }

    // Bond: one rule holds for the whole stretch, so judge it at the midpoint.
    const mid = { tummy: 0, fun: 0, energy: 0, clean: 0 };
    for (const key of NEED_KEYS) mid[key] = clamp(n[key] + rate[key] * dt * 0.5);
    const worst = Math.min(mid.tummy, mid.fun, mid.energy, mid.clean);
    const hours = dt / 3600;
    if (worst < LIMITS.urgent) pet.bond = clamp(pet.bond - TUNING.bondLossPerHour * hours);
    else if (average(mid) > TUNING.bondWellAbove) pet.bond = clamp(pet.bond + TUNING.bondGainPerHour * hours);

    // Move.
    for (const key of NEED_KEYS) n[key] = clamp(n[key] + rate[key] * dt);
    pet.bowlWait = Math.max(0, pet.bowlWait - dt);
    if (pet.asleep) log.slept = true;
    remaining -= dt;
    (hit as (() => void) | null)?.();
  }
}
