// How much Doozer moves of its own accord (DESIGN_SPEC.md 6.4 and 9): Still, Calm, Lively.
// Pure numbers, in one place, so that the owner's choice of default and any later tuning
// is a change to this table and nothing else.
//
//   Still  - never moves from its spot. It still blinks and glances about.
//   Calm   - the spec's default: mostly stays put; every 45-120 s it may take a short slow
//            stroll (at most ~300 px, ~30 px/s) and settle again; peekaboo roughly every
//            ten minutes; plays with the ball where it stands.
//   Lively - close to the Desk Buddy mockup (mockups/v3-buddy): a second or three after
//            arriving it is off again, anywhere along the taskbar, at the mockup's speeds;
//            it runs to its food and chases the ball.

import type { Settings } from '../../core/contract';
import type { Stage } from './stage';

export type PaceId = Settings['desktopActivity'];
export type Gait = 'walk' | 'trot';
type Range = readonly [number, number];

export interface Pace {
  /** Takes strolls on its own. */
  readonly strolls: boolean;
  /** How long it rests before it next thinks about moving, in ms. */
  readonly rest: Range;
  /** The chance that it then does. */
  readonly strollChance: number;
  /** How far one stroll goes, in px. A null top means anywhere along the line. */
  readonly strollPx: readonly [number, number | null];
  /** How far from its spot a stroll may take it. Null: anywhere. */
  readonly roamPx: number | null;
  readonly strollSpeed: number;
  readonly strollGait: Gait;
  /** How long between peekaboos, in ms. Null: never. */
  readonly peekEvery: Range | null;
  readonly peekSpeed: number;
  readonly peekGait: Gait;
  /** Where it settles after a peek: back at its spot, or a little way in from the edge. */
  readonly peekReturn: 'home' | 'near-edge';
  /** How long between small gestures while resting (a glance, a yawn, a wave), in ms. */
  readonly gestureEvery: Range;
  /** Waves hello when it is in a good mood. */
  readonly waves: boolean;
  /** Food lands a little way off and Doozer runs to it; otherwise it lands in reach. */
  readonly runsToFood: boolean;
  readonly foodSpeed: number;
  /** Runs after the ball; otherwise bats it about where it stands. */
  readonly chasesBall: boolean;
  readonly chaseSpeed: number;
}

export const PACES: Readonly<Record<PaceId, Pace>> = {
  still: {
    strolls: false, rest: [45_000, 120_000], strollChance: 0, strollPx: [0, 0], roamPx: 0,
    strollSpeed: 30, strollGait: 'walk',
    peekEvery: null, peekSpeed: 60, peekGait: 'walk', peekReturn: 'home',
    gestureEvery: [14_000, 34_000], waves: false,
    runsToFood: false, foodSpeed: 0, chasesBall: false, chaseSpeed: 0,
  },
  calm: {
    strolls: true, rest: [45_000, 120_000], strollChance: 0.75, strollPx: [60, 300], roamPx: 300,
    strollSpeed: 30, strollGait: 'walk',
    // "Roughly once every ten minutes." The walk to the edge is brisker than a stroll: at
    // 30 px/s the trip across half a wide screen would take the best part of a minute.
    peekEvery: [7 * 60_000, 13 * 60_000], peekSpeed: 60, peekGait: 'walk', peekReturn: 'home',
    gestureEvery: [14_000, 34_000], waves: false,
    runsToFood: false, foodSpeed: 0, chasesBall: false, chaseSpeed: 0,
  },
  lively: {
    // The mockup rested 1-3 s after a walk and 2.2-4.5 s after standing about, and walked
    // on 46 of every 74 such decisions when it had only the ground to walk on.
    strolls: true, rest: [1_000, 4_500], strollChance: 0.62, strollPx: [24, null], roamPx: null,
    strollSpeed: 46, strollGait: 'trot',
    // The mockup peeked on a quarter of its decisions. That is the one number not kept:
    // it would be a peek every quarter of a minute.
    peekEvery: [50_000, 110_000], peekSpeed: 70, peekGait: 'trot', peekReturn: 'near-edge',
    gestureEvery: [4_000, 9_000], waves: true,
    runsToFood: true, foodSpeed: 95, chasesBall: true, chaseSpeed: 150,
  },
};

export function paceFor(id: PaceId): Pace {
  return PACES[id] ?? PACES.calm;
}

/** A value in a range, from a 0..1 random source. */
export function within(range: Range, random: () => number): number {
  return range[0] + random() * (range[1] - range[0]);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** A walk shorter than this is not worth the fuss of setting off. */
export const SHORTEST_WALK_PX = 24;

/**
 * Where the next stroll goes, or null when there is nowhere worth going. `x` is where
 * Doozer stands and `home` the spot it was last put down at, which a Calm stroll never
 * strays far from.
 */
export function strollTarget(pace: Pace, stage: Stage, x: number, home: number, random: () => number): number | null {
  if (!pace.strolls) return null;
  const lo = pace.roamPx === null ? stage.minX : Math.max(stage.minX, home - pace.roamPx);
  const hi = pace.roamPx === null ? stage.maxX : Math.min(stage.maxX, home + pace.roamPx);
  if (!(hi - lo >= SHORTEST_WALK_PX)) return null;
  const [near, far] = pace.strollPx;
  if (far === null) {
    // Anywhere along the line, as the mockup did.
    const target = lo + random() * (hi - lo);
    return Math.abs(target - x) >= Math.max(near, SHORTEST_WALK_PX) ? target : null;
  }
  const distance = near + random() * (far - near);
  const first = random() < 0.5 ? -1 : 1;
  for (const dir of [first, -first]) {
    const target = clamp(x + dir * distance, lo, hi);
    if (Math.abs(target - x) >= SHORTEST_WALK_PX) return target;
  }
  return null;
}

/** How long a walk of `px` at `speed` px/s takes, in ms. */
export function walkMs(px: number, speed: number): number {
  return (Math.abs(px) / Math.max(1, speed)) * 1000;
}

/** A peek is skipped when the edge is further away than this at the pace's speed. */
export const LONGEST_PEEK_WALK_MS = 40_000;

/** Which edge a peek goes to: the nearer one, or null if it is too far to bother. */
export function peekEdge(pace: Pace, stage: Stage, x: number): -1 | 1 | null {
  if (pace.peekEvery === null) return null;
  const side = x <= stage.w / 2 ? -1 : 1;
  const distance = side < 0 ? x : stage.w - x;
  return walkMs(distance, pace.peekSpeed) <= LONGEST_PEEK_WALK_MS ? side : null;
}
