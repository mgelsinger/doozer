// Every number the pet's rules use, in one place.
// Tuned with the week simulation (tests/core/week-sim.ts); the reasoning for each
// value that differs from the first-guess table in DESIGN_SPEC.md 3.1 is written
// up in docs/brain-week-sim.md. Change numbers here and nowhere else.

import type {
  FocusMinutes,
  FocusRewards,
  Limits,
  MealId,
  Mood,
  NeedKey,
  Settings,
  ToyId,
  TreatId,
  UnlockId,
} from './contract';

export const NEED_KEYS: readonly NeedKey[] = ['tummy', 'fun', 'energy', 'clean'];

export const LOW_MOOD: Readonly<Record<NeedKey, Mood>> = {
  tummy: 'hungry',
  fun: 'bored',
  energy: 'sleepy',
  clean: 'dirty',
};

export const LIMITS: Limits = Object.freeze({
  bowl: 3,
  treats: 20,
  low: 30,
  urgent: 12,
});

export const TUNING = Object.freeze({
  /** Points lost per hour while awake. */
  drain: Object.freeze({ tummy: 14, fun: 6, energy: 8, clean: 4.5 }),
  /** While asleep the other three needs drain at this fraction of the awake rate. */
  asleepFactor: Object.freeze({ tummy: 0.5, fun: 0.15, clean: 0.5 }),
  /** Energy gained per hour asleep. */
  sleepGain: 60,
  /** Doozer falls asleep on its own when energy reaches this. */
  collapse: 4,
  /** ...and wakes on its own at this. */
  rested: 100,

  meal: Object.freeze({ tummy: 32 }),
  treat: Object.freeze({ tummy: 10, fun: 16 }),
  play: Object.freeze({ fun: 28, energy: -7, tummy: -4 }),
  pet: Object.freeze({ fun: 3 }),

  /** Refusals compare against the whole-number values shown in `state.needs`. */
  fullAbove: 94, // feed refused when tummy is above this
  tiredBelow: 10, // play refused when energy is below this
  notSleepyAbove: 92, // sleep refused when energy is above this

  /** Doozer eats from the bowl when awake and tummy is below this. */
  bowlEatBelow: 70,
  /** Seconds Doozer waits after a bowl serving before going back for another. */
  bowlPaceSeconds: 300,

  /**
   * Bond is hidden (0..100). It creeps up while Doozer is well (average need above
   * bondWellAbove, nothing urgent) and with each interaction, and slips while any need
   * is urgent. Paced so that good care fills it in two to three weeks, not two days.
   */
  bondGainPerHour: 0.1,
  bondLossPerHour: 1,
  bondWellAbove: 60,
  bondFor: Object.freeze({ feed: 0.3, treat: 0.5, play: 0.4, wash: 0.2, pet: 0.05 }),

  /** A gap longer than this between two looks at the clock counts as "left alone". */
  awaySeconds: 90,
  /** Time away is simulated up to this many hours and no further. */
  maxCatchUpHours: 12,

  moodJoyfulAbove: 78,
  moodContentAbove: 50,
});

export const FRESH = Object.freeze({
  name: 'Doozer',
  needs: Object.freeze({ tummy: 72, fun: 64, energy: 80, clean: 88 }),
  bond: 12,
  bowl: 0,
  treats: 2,
});

export const MEALS: readonly MealId[] = ['apple', 'bread', 'carrot'];
export const TREATS: readonly TreatId[] = ['biscuit', 'cookie', 'donut', 'strawberry', 'onigiri'];
export const PLAY_TOYS: readonly Exclude<ToyId, 'duck'>[] = ['ball', 'yarn'];

/** Available before any focus session has been completed. */
export const STARTER_UNLOCKS: readonly UnlockId[] = ['biscuit', 'ball'];

/** Lifetime completed sessions -> what that unlocks. Must stay sorted by `atSessions`. */
export const UNLOCK_TABLE: readonly { readonly atSessions: number; readonly id: UnlockId }[] = Object.freeze([
  { atSessions: 1, id: 'cookie' },
  { atSessions: 3, id: 'donut' },
  { atSessions: 6, id: 'yarn' },
  { atSessions: 10, id: 'strawberry' },
  { atSessions: 15, id: 'nightcap' },
  { atSessions: 25, id: 'duck' },
  { atSessions: 40, id: 'onigiri' },
  { atSessions: 60, id: 'bow' },
] as const);

export const FOCUS_LENGTHS: readonly FocusMinutes[] = [15, 25, 50];
export const DEFAULT_FOCUS_MINUTES: FocusMinutes = 25;
export const FOCUS_TREATS: Readonly<Record<FocusMinutes, number>> = { 15: 1, 25: 2, 50: 4 };
export const FIRST_OF_DAY_BONUS = 1;
/** The same two numbers in the shape views read them (`brain.rewards`). */
export const REWARDS: FocusRewards = Object.freeze({ treats: Object.freeze({ ...FOCUS_TREATS }), firstOfDay: FIRST_OF_DAY_BONUS });

export function defaultSettings(): Settings {
  return {
    palette: 'peach',
    size: { pill: 'medium', room: 'medium', island: 'medium', desktop: 'medium' },
    pillDock: 'top-center',
    desktopActivity: 'calm',
    sound: false,
    soundAsked: false,
    onFocusEnd: 'quiet',
    alwaysOnTop: true,
    tuckAwayInFullscreen: true,
    startWithWindows: false,
    reduceMotion: 'system',
    uiScale: 'normal',
    hat: null,
    lastView: 'pill',
  };
}
