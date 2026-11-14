// app/src/core/contract.ts
// The only surface the rest of the app may use to talk to the pet brain.

// ---- identifiers ---------------------------------------------------------------

export type NeedKey = 'tummy' | 'fun' | 'energy' | 'clean';
export type Mood = 'asleep' | 'hungry' | 'bored' | 'sleepy' | 'dirty' | 'joyful' | 'content' | 'meh';
export type NeedLevel = 'ok' | 'low' | 'urgent';

export type ViewId = 'pill' | 'room' | 'island' | 'desktop';
export type PaletteId = 'peach' | 'mint' | 'lavender' | 'butter' | 'sky';

/** Everyday food. Always available; one is picked at random for each meal. */
export type MealId = 'apple' | 'bread' | 'carrot';
/** Earned by focusing. 'biscuit' is available from the start; the rest are unlocks. */
export type TreatId = 'biscuit' | 'cookie' | 'donut' | 'strawberry' | 'onigiri';
export type FoodId = MealId | TreatId;
/** 'ball' is available from the start. 'duck' is a bath toy, not a play toy. */
export type ToyId = 'ball' | 'yarn' | 'duck';
export type HatId = 'nightcap' | 'bow';
export type UnlockId = TreatId | ToyId | HatId;

export type FocusMinutes = 15 | 25 | 50;

export type Refusal =
  | 'asleep'         // feed, treat, play, wash, start focus while asleep
  | 'full'           // feed when tummy is above 94
  | 'tired'          // play when energy is below 10
  | 'no-treats'      // treat jar is empty
  | 'not-sleepy'     // sleep when energy is above 92
  | 'bowl-full'      // bowl already holds LIMITS.bowl servings
  | 'focus-running'; // start focus while a session is running or paused

// ---- constants the UI may rely on ----------------------------------------------

export interface Limits {
  readonly bowl: number;     // servings the bowl holds (3)
  readonly treats: number;   // treat jar cap (20)
  readonly low: number;      // a need below this is 'low' (30)
  readonly urgent: number;   // a need below this is 'urgent' (12)
}

/** What a completed focus session earns (DESIGN_SPEC.md 4.2), so a view can say so before it starts. */
export interface FocusRewards {
  readonly treats: Readonly<Record<FocusMinutes, number>>;   // 15 -> 1, 25 -> 2, 50 -> 4
  readonly firstOfDay: number;                               // extra for the first completed session of the day (1)
}

// ---- state ----------------------------------------------------------------------

export interface FocusState {
  readonly status: 'idle' | 'running' | 'paused';
  /** The chosen session length. */
  readonly minutes: FocusMinutes;
  /** Time left. Equals the full length while idle. */
  readonly remainingMs: number;
  /** 0 when idle or just started, 1 when complete. */
  readonly progress: number;
}

/**
 * An immutable snapshot. `brain.state` returns the same object until something
 * changes, then a new one - so `prev !== next` is a valid "did anything change" test.
 */
export interface PetState {
  readonly name: string;
  readonly bornAt: number;                               // ms since epoch
  readonly needs: Readonly<Record<NeedKey, number>>;     // each 0..100, higher is better
  readonly asleep: boolean;

  // derived
  readonly mood: Mood;
  readonly wellbeing: number;                            // average of the four needs
  readonly lowest: { readonly key: NeedKey; readonly value: number };

  // food
  readonly bowl: number;                                 // servings waiting, 0..LIMITS.bowl
  readonly treats: number;                               // 0..LIMITS.treats
  readonly favourite: TreatId;

  // focus & progress
  readonly focus: FocusState;
  readonly streak: { readonly current: number; readonly best: number };
  readonly sessionsCompleted: number;                    // lifetime
  readonly unlocked: readonly UnlockId[];
  readonly nextUnlock: { readonly id: UnlockId; readonly atSessions: number } | null;

  /** nightcap while asleep (once unlocked); otherwise the hat chosen in settings; otherwise null. */
  readonly wearing: HatId | null;
  /** True while a focus session is running. Views must go quiet: no wandering, no emotes, no sound. */
  readonly quiet: boolean;
}

// ---- settings -------------------------------------------------------------------

export type SizeId = 'small' | 'medium' | 'large';

export interface Settings {
  palette: PaletteId;                                    // default 'peach'
  size: Record<ViewId, SizeId>;                          // default 'medium' for each
  pillDock: 'top-center' | 'top-left' | 'top-right' | 'bottom-right';   // default 'top-center'
  desktopActivity: 'still' | 'calm' | 'lively';          // default 'calm'
  sound: boolean;                                        // default false
  soundAsked: boolean;                                   // first-run question already shown
  onFocusEnd: 'quiet' | 'open-card';                     // default 'quiet'
  alwaysOnTop: boolean;                                  // default true
  tuckAwayInFullscreen: boolean;                         // default true
  startWithWindows: boolean;                             // default false
  reduceMotion: 'system' | 'on' | 'off';                 // default 'system'
  hat: HatId | null;                                     // default null; only unlocked hats take effect
  lastView: ViewId;                                      // default 'pill'
}

// ---- actions --------------------------------------------------------------------

export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: Refusal };

// ---- events ---------------------------------------------------------------------

export interface BrainEvents {
  /** Something in `state` changed. Fired at most once per tick or action, after the state is updated. */
  change: Record<string, never>;
  mood: { mood: Mood; from: Mood };
  /** A need crossed downward into 'low' or 'urgent'. Never fired while `quiet`. */
  need: { need: NeedKey; level: Exclude<NeedLevel, 'ok'> };
  /** Something happened that a view should play a little scene for. */
  action:
    | { type: 'feed'; food: MealId }
    | { type: 'treat'; food: TreatId; favourite: boolean }
    | { type: 'auto-eat'; food: MealId }                 // Doozer helped itself from the bowl
    | { type: 'fill-bowl' }
    | { type: 'play'; toy: Exclude<ToyId, 'duck'> }
    | { type: 'wash'; duck: boolean }
    | { type: 'pet' }
    | { type: 'sleep'; why: 'tucked-in' | 'exhausted' }
    | { type: 'wake'; why: 'woken' | 'rested' };
  /** An action was refused. Views show a head-shake and a "?" emote - never text. */
  refuse: { action: string; reason: Refusal };
  focus:
    | { type: 'start' | 'pause' | 'resume' | 'stop' }
    | { type: 'complete'; treats: number; streak: number; unlocked: readonly UnlockId[] };
  /**
   * Doozer was left alone for more than 90 seconds. Fired on the first `tick()` after
   * start-up if the app was closed that long (so subscribe before the first tick), and
   * again after any later gap of that size between two ticks, such as the machine sleeping.
   */
  away: { seconds: number; ateFromBowl: number; slept: boolean };
  settings: { key: keyof Settings };
}

// ---- the brain ------------------------------------------------------------------

export interface Brain {
  readonly state: PetState;
  readonly settings: Readonly<Settings>;
  readonly limits: Limits;
  readonly rewards: FocusRewards;

  // care
  feed(): ActionResult;            // hand-feed one meal now; does not touch the bowl
  fillBowl(): ActionResult;        // top the bowl up to LIMITS.bowl
  giveTreat(): ActionResult;
  play(): ActionResult;
  wash(): ActionResult;
  pet(): ActionResult;             // never refused; works while asleep
  sleep(): ActionResult;
  wake(): ActionResult;
  toggleSleep(): ActionResult;

  // focus
  setFocusLength(minutes: FocusMinutes): void;   // ignored while a session is running or paused
  startFocus(): ActionResult;
  pauseFocus(): void;
  resumeFocus(): void;
  stopFocus(): void;               // abandon: no reward, no penalty

  // settings
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;

  // time
  /**
   * Advance to "now". The host calls this about four times a second while the app is
   * running, and once immediately after the machine wakes from sleep. The brain works
   * out the elapsed time itself from its clock; calling more or less often must not
   * change the outcome.
   */
  tick(): void;

  // events
  on<E extends keyof BrainEvents>(type: E, handler: (detail: BrainEvents[E]) => void): () => void;

  // persistence
  /** A plain JSON-safe object. The host writes it to disk; the brain never touches storage. */
  serialize(): unknown;

  /** Development only. Present in dev builds and in the fake brain; absent in production. */
  readonly debug?: {
    setNeeds(values: Partial<Record<NeedKey, number>>): void;
    setTimeScale(multiplier: number): void;      // 60 = one real second is one pet minute
    addTreats(count: number): void;
    finishFocusNow(): void;
    reset(): void;
  };
}

export interface BrainOptions {
  /** Whatever `serialize()` returned last time, or undefined for a new pet. Bad data must not throw. */
  save?: unknown;
  now?: () => number;              // ms since epoch; defaults to Date.now
  random?: () => number;           // 0..1; defaults to Math.random
  debug?: boolean;                 // true adds `brain.debug`; leave it out in production
}

/** Implemented by app/src/core/index.ts. Runs the offline catch-up before returning. */
export type CreateBrain = (options?: BrainOptions) => Brain;
