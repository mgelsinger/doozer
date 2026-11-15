# Brain contract

The interface between the **pet brain** (`app/src/core/`, Phase 4) and **everything that draws Doozer** (the rig, the UI kit and the four views, Phases 5–9).

It exists so those phases can be built at the same time. The brain is written *to* this interface; the UI kit is written *against* it, using a fake brain until the real one lands.

**Rules**

1. The TypeScript below is the content of `app/src/core/contract.ts`. Whichever session needs that file first creates it **verbatim** from this document.
2. Nobody edits `contract.ts` without changing this document in the same commit and adding a line to the change log at the bottom.
3. The brain imports nothing from outside `core/`. Nothing outside `core/` reaches into the brain except through this interface.
4. Behaviour (what the numbers are, when Doozer refuses) is defined by [DESIGN_SPEC.md](../DESIGN_SPEC.md) sections 3 and 4. This file only fixes the *shape*.

---

## The contract

```ts
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
  uiScale: 'normal' | 'large' | 'larger';                // default 'normal'; the size of everything (Phase 10)
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
```

---

## What the host does (not the brain)

- Calls `tick()` on an interval, and after resume.
- Subscribes to events and mounts the view **before** the first `tick()`: the `away` event and a focus session that completed while the app was closed are delivered on that first tick.
- Persists `serialize()` and passes it back as `save` on the next start. **Shortly after anything happens** (an `action`, `focus`, `settings` or `away` event: within a second, debounced), **when quitting, and when tucking away**. A `change` with none of those is only time passing (needs draining, a countdown moving); the brain works that out again from `lastSeen` on the next start, so it is written lazily, within five minutes. Settings are not part of `state`, so a setting on its own fires `settings` but not `change`. The host wraps the brain's document in its own (`{ brain, host }`, `app/src/host/store.ts`) so the window positions travel in the same file.
- Owns anything that is about the *window* rather than the *pet*: per-view window positions, which monitor, tray state, and whether a newly hatched pet has been welcomed yet.
- Tells views which view is on screen. The brain only knows the *last* view (`settings.lastView`, which the host sets after every switch); the Card and the settings panel are given a `currentView()` callback by the view that mounts them.

## What a view does (not the brain)

- Reads `state` and `settings`; calls actions; subscribes to events.
- Decides *how* to show an `action` event — the Island drops a 3D donut, the Room has Doozer walk to the bowl — but never *whether* it happened.
- Keeps its own short-lived things (where the ball rolled, whether a menu is open) and throws them away on `unmount`.
- Honours `state.quiet`.

## What the UI kit does

- Takes a `Brain` and plain callbacks for anything outside the brain (`onSwitchView`, `onOpenSettings`, `onQuit`). It imports nothing from `views/` or `shell.ts`.

---

## How the real brain behaves

Things the types cannot say, fixed by the Phase 4 implementation in `app/src/core/`. The numbers live in `app/src/core/tuning.ts`.

- **`state.needs` are whole numbers** (the exact value, rounded). That is why `state` stays the same object for a while: with nothing happening it changes about once a minute, and once a second while a focus session runs (`remainingMs` moves in whole seconds). `mood`, `wellbeing`, `lowest` and the refusals are all worked out from these same whole numbers, so a view can predict a refusal from `state` alone: `feed` is refused when `needs.tummy > 94`, `play` when `needs.energy < 10`, `sleep` when `needs.energy > 92`.
- **Order of events.** State is always fully updated before any handler runs. Within one call the order is: `away`, then `action` / `refuse` / `focus` / `settings` in the order they happened, then `need`, then `mood`, then `change`.
- **`need` events are held back, not dropped,** while `quiet` or asleep: one fires when the session ends or Doozer wakes, if the need is still worse than the last level announced. None fire for time away; `away` covers that.
- **`refuse.action`** is the name of the Brain method that was called: `'feed'`, `'fillBowl'`, `'giveTreat'`, `'play'`, `'wash'`, `'sleep'`, `'startFocus'`.
- **`unlocked`** starts as `['biscuit', 'ball']` and gains each unlock in the order it is earned.
- **The bowl.** Filling it while Doozer is awake and below 70 makes it eat one serving at once (`fill-bowl` then `auto-eat` in the same call), then one more every five minutes while it is still below 70. `fillBowl` works while Doozer is asleep.
- **`sleep()` when already asleep and `wake()` when already awake** return `{ ok: true }` and fire nothing. Waking Doozer at energy 4 or less is allowed; it dozes straight off again (`wake` then `sleep` with `why: 'exhausted'`).
- **Focus and the clock.** `startFocus` is refused with `'focus-running'` before `'asleep'`. A session that ran out while the app was closed completes on start-up and counts for the day it ended on. `focus.complete.treats` is what was earned, even if the jar was too full to hold it all. If the system clock is moved back, a running session keeps the time it had left.
- **Streak.** `streak.current` drops to 0 once a whole calendar day has passed with no completed session.
- **Time away** is simulated for at most 12 hours, always at real speed (the debug time scale only stretches live ticks).
- **A handler that throws** does not stop the others; the first error is rethrown from the call once every event has been delivered.

---

## Change log

- **2026-11-11** — First version, written from DESIGN_SPEC.md sections 3–5 and 9.
- **2026-11-11** — Phase 4 (brain). `BrainOptions.debug` added: the contract said `brain.debug` is absent in production but gave no way to choose. The `away` comment now says when it is delivered (first `tick()`, and after a long gap between ticks). Host notes: subscribe before the first tick; persist on `settings` as well as `change`. New section "How the real brain behaves". No existing type changed.
- **2026-11-13** — Phase 6 (Pill view and app basics). `Brain.rewards` (`FocusRewards`) added, so the Card can say what a session earns without a view hard-coding a rule; the numbers are `FOCUS_TREATS` and `FIRST_OF_DAY_BONUS` in `tuning.ts`. Host notes rewritten to say exactly when the save is written and that the host wraps the brain's document. No existing type changed.
