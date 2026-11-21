// A stand-in for the pet brain, for developing and testing the UI kit before the real
// one (app/src/core, Phase 4) lands. It implements the `Brain` interface from
// core/contract.ts and follows DESIGN_SPEC.md sections 3 and 4 closely enough to be
// believable, but it is NOT the rules: no save format, no offline catch-up, no bond.
// Development only - nothing in the app may import this.

import type {
  ActionResult, Brain, BrainEvents, BrainOptions, FocusMinutes, FocusState, HatId, Limits, MealId, Mood,
  NeedKey, NeedLevel, PetState, Refusal, Settings, TreatId, UnlockId,
} from '../../core/contract';

export const FAKE_LIMITS: Limits = { bowl: 3, treats: 20, low: 30, urgent: 12 };

const DRAIN_PER_HOUR: Record<NeedKey, number> = { tummy: 22, fun: 26, energy: 11, clean: 8 };
const ASLEEP_FRACTION = 0.35;
const SLEEP_GAIN_PER_HOUR = 60;
const LOW_MOOD: Record<NeedKey, Mood> = { tummy: 'hungry', fun: 'bored', energy: 'sleepy', clean: 'dirty' };
const NEEDS: readonly NeedKey[] = ['tummy', 'fun', 'energy', 'clean'];
const MEALS: readonly MealId[] = ['apple', 'bread', 'carrot'];
const REWARD: Record<FocusMinutes, number> = { 15: 1, 25: 2, 50: 4 };
const UNLOCKS: readonly { id: UnlockId; atSessions: number }[] = [
  { id: 'cookie', atSessions: 1 }, { id: 'donut', atSessions: 3 }, { id: 'yarn', atSessions: 6 },
  { id: 'strawberry', atSessions: 10 }, { id: 'nightcap', atSessions: 15 }, { id: 'duck', atSessions: 25 },
  { id: 'onigiri', atSessions: 40 }, { id: 'bow', atSessions: 60 },
];
const TREAT_IDS: readonly TreatId[] = ['biscuit', 'cookie', 'donut', 'strawberry', 'onigiri'];

export const DEFAULT_SETTINGS: Settings = {
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

/** Starting values for a fake brain, so the viewer and the tests can open in any state. */
export interface FakeBrainPreset {
  needs?: Partial<Record<NeedKey, number>>;
  asleep?: boolean;
  bowl?: number;
  treats?: number;
  favourite?: TreatId;
  sessionsCompleted?: number;
  streak?: { current: number; best: number };
  settings?: Partial<Settings>;
  /** Start with a focus session already 'running' or 'paused'. */
  focus?: { status: 'running' | 'paused'; minutes?: FocusMinutes; elapsedMs?: number };
}

export interface FakeBrainOptions extends BrainOptions {
  preset?: FakeBrainPreset;
}

type Handlers = { [E in keyof BrainEvents]: Set<(detail: BrainEvents[E]) => void> };

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const dayNumber = (ms: number) => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / 86_400_000);

export function createFakeBrain(options: FakeBrainOptions = {}): Brain {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const preset = options.preset ?? {};

  // ---- mutable internals ----
  let needs: Record<NeedKey, number>;
  let asleep: boolean;
  let bowl: number;
  let treats: number;
  let favourite: TreatId;
  let sessionsCompleted: number;
  let streak: { current: number; best: number };
  let lastSessionDay: number | null;
  let settings: Settings;
  let focusStatus: FocusState['status'];
  let focusMinutes: FocusMinutes;
  let focusElapsedMs: number;         // focus time already banked (pet time)
  let timeScale = 1;
  let lastTick = now();
  let bornAt = now();
  let state!: PetState;
  let dirty = false;

  const handlers: Handlers = {
    change: new Set(), mood: new Set(), need: new Set(), action: new Set(),
    refuse: new Set(), focus: new Set(), away: new Set(), settings: new Set(),
  };
  function emit<E extends keyof BrainEvents>(type: E, detail: BrainEvents[E]): void {
    for (const handler of [...handlers[type]]) handler(detail);
  }

  function init(p: FakeBrainPreset): void {
    needs = { tummy: 72, fun: 68, energy: 80, clean: 86, ...p.needs };
    for (const key of NEEDS) needs[key] = clamp(needs[key]);
    asleep = p.asleep ?? false;
    bowl = clamp(p.bowl ?? 1, 0, FAKE_LIMITS.bowl);
    treats = clamp(p.treats ?? 2, 0, FAKE_LIMITS.treats);
    favourite = p.favourite ?? TREAT_IDS[Math.floor(random() * TREAT_IDS.length)] ?? 'biscuit';
    sessionsCompleted = Math.max(0, p.sessionsCompleted ?? 0);
    streak = { current: p.streak?.current ?? 0, best: p.streak?.best ?? 0 };
    lastSessionDay = streak.current > 0 ? dayNumber(now()) - 1 : null;
    settings = { ...DEFAULT_SETTINGS, size: { ...DEFAULT_SETTINGS.size }, ...p.settings };
    focusStatus = p.focus?.status ?? 'idle';
    focusMinutes = p.focus?.minutes ?? 25;
    focusElapsedMs = p.focus?.elapsedMs ?? 0;
    lastTick = now();
    bornAt = now();
  }

  // ---- derived ----
  const levelOf = (v: number): NeedLevel => (v < FAKE_LIMITS.urgent ? 'urgent' : v < FAKE_LIMITS.low ? 'low' : 'ok');
  function unlockedNow(): UnlockId[] {
    return UNLOCKS.filter((u) => sessionsCompleted >= u.atSessions).map((u) => u.id);
  }
  function snapshot(): PetState {
    let lowestKey: NeedKey = 'tummy';
    for (const key of NEEDS) if (needs[key] < needs[lowestKey]) lowestKey = key;
    const wellbeing = NEEDS.reduce((sum, key) => sum + needs[key], 0) / NEEDS.length;
    const mood: Mood = asleep ? 'asleep'
      : needs[lowestKey] < FAKE_LIMITS.low ? LOW_MOOD[lowestKey]
      : wellbeing > 78 ? 'joyful' : wellbeing > 50 ? 'content' : 'meh';
    const unlocked = unlockedNow();
    const next = UNLOCKS.find((u) => sessionsCompleted < u.atSessions) ?? null;
    const totalMs = focusMinutes * 60_000;
    const remainingMs = focusStatus === 'idle' ? totalMs : Math.max(0, totalMs - focusElapsedMs);
    const hatChoice: HatId | null = settings.hat !== null && unlocked.includes(settings.hat) ? settings.hat : null;
    const wearing: HatId | null = asleep && unlocked.includes('nightcap') ? 'nightcap' : hatChoice;
    return {
      name: 'Doozer',
      bornAt,
      needs: { ...needs },
      asleep,
      mood,
      wellbeing,
      lowest: { key: lowestKey, value: needs[lowestKey] },
      bowl,
      treats,
      favourite,
      focus: {
        status: focusStatus,
        minutes: focusMinutes,
        remainingMs,
        progress: focusStatus === 'idle' ? 0 : clamp(focusElapsedMs / totalMs, 0, 1),
      },
      streak: { ...streak },
      sessionsCompleted,
      unlocked,
      nextUnlock: next ? { id: next.id, atSessions: next.atSessions } : null,
      wearing,
      quiet: focusStatus === 'running',
    };
  }

  /** Rebuild the snapshot and tell listeners, once, if anything was touched. */
  function commit(): void {
    if (!dirty) return;
    dirty = false;
    const previous = state;
    state = snapshot();
    if (previous && previous.mood !== state.mood) emit('mood', { mood: state.mood, from: previous.mood });
    emit('change', {});
  }
  const touch = () => { dirty = true; };
  const refuse = (action: string, reason: Refusal): ActionResult => {
    emit('refuse', { action, reason });
    return { ok: false, reason };
  };
  const OK: ActionResult = { ok: true };
  const add = (key: NeedKey, amount: number) => { needs[key] = clamp(needs[key] + amount); };
  const pickMeal = (): MealId => MEALS[Math.floor(random() * MEALS.length)] ?? 'apple';

  function completeFocus(): void {
    const minutes = focusMinutes;
    focusStatus = 'idle';
    focusElapsedMs = 0;
    const before = unlockedNow();
    sessionsCompleted += 1;
    const today = dayNumber(now());
    const firstToday = lastSessionDay !== today;
    if (firstToday) {
      streak.current = lastSessionDay === today - 1 ? streak.current + 1 : 1;
      streak.best = Math.max(streak.best, streak.current);
      lastSessionDay = today;
    }
    const earned = REWARD[minutes] + (firstToday ? 1 : 0);
    treats = clamp(treats + earned, 0, FAKE_LIMITS.treats);
    const unlocked = unlockedNow().filter((id) => !before.includes(id));
    touch();
    commit();
    emit('focus', { type: 'complete', treats: earned, streak: streak.current, unlocked });
  }

  function advance(petMs: number): void {
    if (!(petMs > 0)) return;
    const hours = petMs / 3_600_000;
    const wasQuiet = focusStatus === 'running';
    const before = { ...needs };

    for (const key of NEEDS) {
      if (asleep && key === 'energy') add('energy', SLEEP_GAIN_PER_HOUR * hours);
      else add(key, -DRAIN_PER_HOUR[key] * hours * (asleep ? ASLEEP_FRACTION : 1));
    }
    touch();

    if (!wasQuiet) {
      for (const key of NEEDS) {
        const was = levelOf(before[key]);
        const is = levelOf(needs[key]);
        if (is !== 'ok' && is !== was && needs[key] < before[key]) emit('need', { need: key, level: is });
      }
    }
    if (!asleep && needs.energy <= 4) {
      asleep = true;
      commit();
      emit('action', { type: 'sleep', why: 'exhausted' });
    } else if (asleep && needs.energy >= 100) {
      asleep = false;
      commit();
      emit('action', { type: 'wake', why: 'rested' });
    }
    if (!asleep && bowl > 0 && needs.tummy < 70) {
      bowl -= 1;
      add('tummy', 32);
      commit();
      emit('action', { type: 'auto-eat', food: pickMeal() });
    }
    if (focusStatus === 'running') {
      focusElapsedMs += petMs;
      if (focusElapsedMs >= focusMinutes * 60_000) completeFocus();
    }
  }

  init(preset);
  state = snapshot();

  const brain: Brain = {
    get state() { return state; },
    get settings() { return settings; },
    limits: FAKE_LIMITS,
    rewards: { treats: REWARD, firstOfDay: 1 },

    feed() {
      if (asleep) return refuse('feed', 'asleep');
      if (needs.tummy > 94) return refuse('feed', 'full');
      add('tummy', 32);
      touch(); commit();
      emit('action', { type: 'feed', food: pickMeal() });
      return OK;
    },
    fillBowl() {
      if (bowl >= FAKE_LIMITS.bowl) return refuse('fillBowl', 'bowl-full');
      bowl = FAKE_LIMITS.bowl;
      touch(); commit();
      emit('action', { type: 'fill-bowl' });
      return OK;
    },
    giveTreat() {
      if (asleep) return refuse('giveTreat', 'asleep');
      if (treats <= 0) return refuse('giveTreat', 'no-treats');
      const pool = TREAT_IDS.filter((id) => id === 'biscuit' || unlockedNow().includes(id));
      const food = pool[Math.floor(random() * pool.length)] ?? 'biscuit';
      treats -= 1;
      add('tummy', 10);
      add('fun', 16);
      touch(); commit();
      emit('action', { type: 'treat', food, favourite: food === favourite });
      return OK;
    },
    play() {
      if (asleep) return refuse('play', 'asleep');
      if (needs.energy < 10) return refuse('play', 'tired');
      add('fun', 28);
      add('energy', -6);
      touch(); commit();
      const toys = unlockedNow().includes('yarn') ? (['ball', 'yarn'] as const) : (['ball'] as const);
      emit('action', { type: 'play', toy: toys[Math.floor(random() * toys.length)] ?? 'ball' });
      return OK;
    },
    wash() {
      if (asleep) return refuse('wash', 'asleep');
      needs.clean = 100;
      touch(); commit();
      emit('action', { type: 'wash', duck: unlockedNow().includes('duck') });
      return OK;
    },
    pet() {
      add('fun', 3);
      touch(); commit();
      emit('action', { type: 'pet' });
      return OK;
    },
    sleep() {
      if (asleep) return OK;
      if (needs.energy > 92) return refuse('sleep', 'not-sleepy');
      asleep = true;
      touch(); commit();
      emit('action', { type: 'sleep', why: 'tucked-in' });
      return OK;
    },
    wake() {
      if (!asleep) return OK;
      asleep = false;
      touch(); commit();
      emit('action', { type: 'wake', why: 'woken' });
      return OK;
    },
    toggleSleep() {
      return asleep ? brain.wake() : brain.sleep();
    },

    setFocusLength(minutes) {
      if (focusStatus !== 'idle' || (minutes !== 15 && minutes !== 25 && minutes !== 50)) return;
      focusMinutes = minutes;
      touch(); commit();
    },
    startFocus() {
      if (asleep) return refuse('startFocus', 'asleep');
      if (focusStatus !== 'idle') return refuse('startFocus', 'focus-running');
      focusStatus = 'running';
      focusElapsedMs = 0;
      touch(); commit();
      emit('focus', { type: 'start' });
      return OK;
    },
    pauseFocus() {
      if (focusStatus !== 'running') return;
      focusStatus = 'paused';
      touch(); commit();
      emit('focus', { type: 'pause' });
    },
    resumeFocus() {
      if (focusStatus !== 'paused') return;
      focusStatus = 'running';
      touch(); commit();
      emit('focus', { type: 'resume' });
    },
    stopFocus() {
      if (focusStatus === 'idle') return;
      focusStatus = 'idle';
      focusElapsedMs = 0;
      touch(); commit();
      emit('focus', { type: 'stop' });
    },

    setSetting(key, value) {
      if (settings[key] === value) return;
      settings = { ...settings, [key]: value };
      touch(); commit();
      emit('settings', { key });
    },

    tick() {
      const t = now();
      const elapsed = Math.max(0, t - lastTick);
      lastTick = t;
      advance(elapsed * timeScale);
      commit();
    },

    focusEndsInMs() {
      return focusStatus === 'running' ? Math.max(0, focusMinutes * 60_000 - focusElapsedMs) : 0;
    },

    on(type, handler) {
      handlers[type].add(handler);
      return () => { handlers[type].delete(handler); };
    },

    serialize() {
      return { fake: true, needs: { ...needs }, asleep, bowl, treats, sessionsCompleted, streak: { ...streak }, settings };
    },

    debug: {
      setNeeds(values) {
        for (const key of NEEDS) {
          const value = values[key];
          if (typeof value === 'number') needs[key] = clamp(value);
        }
        touch(); commit();
      },
      setTimeScale(multiplier) { timeScale = Math.max(0, multiplier); },
      addTreats(count) {
        treats = clamp(treats + count, 0, FAKE_LIMITS.treats);
        touch(); commit();
      },
      finishFocusNow() {
        if (focusStatus !== 'idle') completeFocus();
      },
      reset() {
        init(preset);
        touch(); commit();
      },
    },
  };

  return brain;
}
