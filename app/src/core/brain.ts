// The pet brain: one Doozer, its rules, and nothing about how it is drawn.
// No DOM, no storage, no timers. The clock and the dice are handed in.

import type {
  ActionResult,
  Brain,
  BrainEvents,
  BrainOptions,
  FocusMinutes,
  FocusState,
  HatId,
  Mood,
  NeedKey,
  NeedLevel,
  PetState,
  Refusal,
  Settings,
  TreatId,
  ToyId,
  UnlockId,
} from './contract';
import { advance, clamp, pick, type AdvanceLog } from './rules';
import { freshPet, loadSave, readSetting, toSave, type PetCore } from './save';
import { localDay } from './time';
import {
  FIRST_OF_DAY_BONUS,
  FOCUS_LENGTHS,
  FOCUS_TREATS,
  REWARDS,
  LIMITS,
  LOW_MOOD,
  MEALS,
  NEED_KEYS,
  PLAY_TOYS,
  STARTER_UNLOCKS,
  TREATS,
  TUNING,
  UNLOCK_TABLE,
} from './tuning';

type Queued = { [E in keyof BrainEvents]: readonly [E, BrainEvents[E]] }[keyof BrainEvents];
type AnyHandler = (detail: unknown) => void;

const OK: ActionResult = Object.freeze({ ok: true });
const LEVEL_RANK: Readonly<Record<NeedLevel, number>> = { ok: 0, low: 1, urgent: 2 };

function levelOf(value: number): NeedLevel {
  return value < LIMITS.urgent ? 'urgent' : value < LIMITS.low ? 'low' : 'ok';
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * What the outside world sees of a need: the exact value as a whole number. Everything
 * a person can see or be refused by (levels, mood, "too full") is worked out from these,
 * so the meters and the behaviour can never disagree.
 */
function shownValue(exact: number): number {
  // Drains like 5 an hour land exactly on .5 again and again. Settle the last few
  // digits first, so floating-point dust cannot decide which way such a value rounds.
  return Math.round(Math.round(clamp(exact) * 1e6) / 1e6);
}

function unlockedAt(sessions: number): UnlockId[] {
  return [...STARTER_UNLOCKS, ...UNLOCK_TABLE.filter((u) => u.atSessions <= sessions).map((u) => u.id)];
}

export function createBrain(options: BrainOptions = {}): Brain {
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  const random = typeof options.random === 'function' ? options.random : Math.random;

  const readClock = (): number | null => {
    const t = clock();
    return typeof t === 'number' && Number.isFinite(t) ? t : null;
  };

  const loaded = loadSave(options.save, readClock() ?? Date.now(), random);
  let pet: PetCore = loaded.pet;
  let settings: Readonly<Settings> = deepFreeze(loaded.settings);
  /** The moment `pet` was last brought up to date. */
  let lastSeen = loaded.lastSeen;
  let timeScale = 1;

  // ---- events ---------------------------------------------------------------------

  const handlers = new Map<keyof BrainEvents, Set<AnyHandler>>();
  let queue: Queued[] = [];
  /** Events from the start-up catch-up, held until the first tick() so someone can hear them. */
  let heldForFirstTick: Queued[] | null = [];
  let flushing = false;

  function emit<E extends keyof BrainEvents>(type: E, detail: BrainEvents[E]): void {
    queue.push([type, detail] as Queued);
  }

  /** Deliver queued events. Every handler runs even if one throws; the first error is rethrown after. */
  function flush(): void {
    if (flushing) return; // a handler called back in: the outer loop will deliver it
    flushing = true;
    let failed = false;
    let failure: unknown;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [type, detail] = next;
        const set = handlers.get(type);
        if (!set) continue;
        for (const handler of [...set]) {
          try {
            handler(detail);
          } catch (error) {
            if (!failed) {
              failed = true;
              failure = error;
            }
          }
        }
      }
    } finally {
      flushing = false;
    }
    if (failed) throw failure;
  }

  // ---- the published snapshot -------------------------------------------------------

  const shown = (key: NeedKey): number => shownValue(pet.needs[key]);
  const has = (id: UnlockId): boolean => unlockedAt(pet.sessions).includes(id);

  function focusState(): FocusState {
    const f = pet.focus;
    const total = f.minutes * 60_000;
    if (f.status === 'idle') return { status: 'idle', minutes: f.minutes, remainingMs: total, progress: 0 };
    const left = f.status === 'running' ? f.endsAt - lastSeen : f.remainingMs;
    // Whole seconds, rounded up: a fresh 25-minute session reads 25:00, and the
    // snapshot changes once a second rather than on every tick.
    const remainingMs = Math.min(total, Math.max(0, Math.ceil(left / 1000) * 1000));
    return { status: f.status, minutes: f.minutes, remainingMs, progress: 1 - remainingMs / total };
  }

  function buildState(): PetState {
    const needs = { tummy: shown('tummy'), fun: shown('fun'), energy: shown('energy'), clean: shown('clean') };
    let lowestKey: NeedKey = 'tummy';
    for (const key of NEED_KEYS) if (needs[key] < needs[lowestKey]) lowestKey = key;
    const lowest = { key: lowestKey, value: needs[lowestKey] };
    const wellbeing = (needs.tummy + needs.fun + needs.energy + needs.clean) / NEED_KEYS.length;

    let mood: Mood;
    if (pet.asleep) mood = 'asleep';
    else if (lowest.value < LIMITS.low) mood = LOW_MOOD[lowest.key];
    else if (wellbeing > TUNING.moodJoyfulAbove) mood = 'joyful';
    else if (wellbeing > TUNING.moodContentAbove) mood = 'content';
    else mood = 'meh';

    const unlocked = unlockedAt(pet.sessions);
    const next = UNLOCK_TABLE.find((u) => u.atSessions > pet.sessions);
    const focus = focusState();

    let wearing: HatId | null = null;
    if (pet.asleep && unlocked.includes('nightcap')) wearing = 'nightcap';
    else if (settings.hat !== null && unlocked.includes(settings.hat)) wearing = settings.hat;

    return {
      name: pet.name,
      bornAt: pet.bornAt,
      needs,
      asleep: pet.asleep,
      mood,
      wellbeing,
      lowest,
      bowl: pet.bowl,
      treats: pet.treats,
      favourite: pet.favourite,
      focus,
      streak: { current: pet.streak, best: pet.best },
      sessionsCompleted: pet.sessions,
      unlocked,
      nextUnlock: next ? { id: next.id, atSessions: next.atSessions } : null,
      wearing,
      quiet: focus.status === 'running',
    };
  }

  let state: PetState;
  let stateKey: string;
  /** The level of each need that listeners have been told about (or could see at start-up). */
  let announced: Record<NeedKey, NeedLevel>;

  function levelsNow(): Record<NeedKey, NeedLevel> {
    const n = state.needs;
    return { tummy: levelOf(n.tummy), fun: levelOf(n.fun), energy: levelOf(n.energy), clean: levelOf(n.clean) };
  }

  /**
   * Replace the snapshot if anything visible changed, then queue `need`, `mood` and
   * `change`. With `greeting` true (after time away) need events are skipped: the
   * `away` event is what tells views that Doozer was left alone.
   */
  function publish(greeting = false): void {
    const previousMood = state.mood;
    const next = buildState();
    const key = JSON.stringify(next);
    const changed = key !== stateKey;
    if (changed) {
      state = deepFreeze(next);
      stateKey = key;
    }

    const levels = levelsNow();
    for (const need of NEED_KEYS) {
      const level = levels[need];
      const worse = LEVEL_RANK[level] > LEVEL_RANK[announced[need]];
      if (!worse || greeting) announced[need] = level;
      else if (!state.quiet && !state.asleep && level !== 'ok') {
        // Held back while focusing or asleep, so it is said once things are no longer quiet.
        announced[need] = level;
        emit('need', { need, level });
      }
    }
    if (state.mood !== previousMood) emit('mood', { mood: state.mood, from: previousMood });
    if (changed) emit('change', {});
  }

  // ---- time -----------------------------------------------------------------------

  function tidyStreak(now: number): void {
    if (pet.lastDay === null || pet.streak === 0) return;
    const gap = localDay(now) - pet.lastDay;
    // Yesterday's session still counts until today ends. "Tomorrow" can only be a
    // clock or time-zone hop and is treated as today.
    if (gap > 1 || gap < -1) pet.streak = 0;
  }

  function completeFocus(at: number): void {
    const minutes = pet.focus.minutes;
    const day = localDay(at);
    const gap = pet.lastDay === null ? null : day - pet.lastDay;
    const alreadyToday = gap === 0 || gap === -1;
    if (!alreadyToday) {
      pet.streak = gap === 1 ? pet.streak + 1 : 1;
      pet.lastDay = day;
    }
    pet.best = Math.max(pet.best, pet.streak);

    const before = pet.sessions;
    pet.sessions = before + 1;
    const unlocked = UNLOCK_TABLE.filter((u) => u.atSessions > before && u.atSessions <= pet.sessions).map((u) => u.id);

    const treats = FOCUS_TREATS[minutes] + (alreadyToday ? 0 : FIRST_OF_DAY_BONUS);
    pet.treats = Math.min(LIMITS.treats, pet.treats + treats);
    pet.focus = { minutes, status: 'idle', endsAt: 0, remainingMs: 0 };
    emit('focus', { type: 'complete', treats, streak: pet.streak, unlocked });
  }

  function emitSelfActions(log: AdvanceLog): void {
    for (const action of log.actions) emit('action', action);
  }

  /**
   * Bring the pet up to the present. Returns true if the gap was long enough to count
   * as time away. `startUp` is the catch-up inside createBrain, which is always silent.
   */
  function catchUp(startUp = false): boolean {
    const now = readClock();
    if (now === null) return false;
    const elapsedMs = now - lastSeen;

    if (elapsedMs <= 0) {
      // The clock went backwards. No pet time passes, and a running session keeps
      // exactly the time it had left instead of gaining the difference.
      if (elapsedMs < 0 && pet.focus.status === 'running') pet.focus.endsAt += elapsedMs;
      lastSeen = now;
      tidyStreak(now);
      return false;
    }

    const seconds = elapsedMs / 1000;
    const away = seconds > TUNING.awaySeconds;
    const log: AdvanceLog = { actions: [], slept: false };
    // Time away always passes at real speed and is capped; only live ticks are
    // stretched by the debug time scale.
    const petSeconds = away || startUp ? Math.min(seconds, TUNING.maxCatchUpHours * 3600) : seconds * timeScale;
    advance(pet, petSeconds, random, log);

    const previous = lastSeen;
    lastSeen = now;

    if (away) {
      const ateFromBowl = log.actions.filter((a) => a.type === 'auto-eat').length;
      emit('away', { seconds, ateFromBowl, slept: log.slept });
    } else if (!startUp) {
      emitSelfActions(log);
    }

    const f = pet.focus;
    if (f.status === 'running' && now >= f.endsAt) {
      // It finished at endsAt, which may be a different day from today.
      completeFocus(Math.min(now, Math.max(previous, f.endsAt)));
    }
    tidyStreak(now);
    return away;
  }

  /** Let anything that is due right now happen (eating, dozing off), then publish. */
  function finish(greeting = false): void {
    const log: AdvanceLog = { actions: [], slept: false };
    advance(pet, 0, random, log);
    emitSelfActions(log);
    publish(greeting);
    flush();
  }

  // ---- start-up -------------------------------------------------------------------

  catchUp(true);
  advance(pet, 0, random, { actions: [], slept: false });
  state = deepFreeze(buildState());
  stateKey = JSON.stringify(state);
  announced = levelsNow();
  heldForFirstTick = queue.filter(([type, detail]) => type === 'away' || (type === 'focus' && detail.type === 'complete'));
  queue = [];

  // ---- actions --------------------------------------------------------------------

  const bump = (key: NeedKey, by: number): void => {
    pet.needs[key] = clamp(pet.needs[key] + by);
  };
  const bond = (by: number): void => {
    pet.bond = clamp(pet.bond + by);
  };

  /** Run a care action: catch up, try it, report a refusal if there is one, publish. */
  function act(name: string, attempt: () => Refusal | null): ActionResult {
    const greeting = catchUp();
    const reason = attempt();
    if (reason) emit('refuse', { action: name, reason });
    finish(greeting);
    return reason ? { ok: false, reason } : OK;
  }

  /** The same for things that cannot be refused. */
  function change(apply: () => void): void {
    const greeting = catchUp();
    apply();
    finish(greeting);
  }

  function sleep(): ActionResult {
    return act('sleep', () => {
      if (pet.asleep) return null;
      if (shown('energy') > TUNING.notSleepyAbove) return 'not-sleepy';
      pet.asleep = true;
      emit('action', { type: 'sleep', why: 'tucked-in' });
      return null;
    });
  }

  function wake(): ActionResult {
    return act('wake', () => {
      if (!pet.asleep) return null;
      pet.asleep = false;
      emit('action', { type: 'wake', why: 'woken' });
      return null;
    });
  }

  const brain: Brain = {
    get state() {
      return state;
    },
    get settings() {
      return settings;
    },
    limits: LIMITS,
    rewards: REWARDS,

    feed: () =>
      act('feed', () => {
        if (pet.asleep) return 'asleep';
        if (shown('tummy') > TUNING.fullAbove) return 'full';
        bump('tummy', TUNING.meal.tummy);
        bond(TUNING.bondFor.feed);
        emit('action', { type: 'feed', food: pick(MEALS, random, 'apple') });
        return null;
      }),

    fillBowl: () =>
      act('fillBowl', () => {
        if (pet.bowl >= LIMITS.bowl) return 'bowl-full';
        pet.bowl = LIMITS.bowl;
        emit('action', { type: 'fill-bowl' });
        return null;
      }),

    giveTreat: () =>
      act('giveTreat', () => {
        if (pet.asleep) return 'asleep';
        if (pet.treats <= 0) return 'no-treats';
        const available = TREATS.filter((t) => has(t));
        const food: TreatId = pick(available, random, 'biscuit');
        pet.treats -= 1;
        bump('tummy', TUNING.treat.tummy);
        bump('fun', TUNING.treat.fun);
        bond(TUNING.bondFor.treat);
        emit('action', { type: 'treat', food, favourite: food === pet.favourite });
        return null;
      }),

    play: () =>
      act('play', () => {
        if (pet.asleep) return 'asleep';
        if (shown('energy') < TUNING.tiredBelow) return 'tired';
        const toys = PLAY_TOYS.filter((t) => has(t));
        const toy: Exclude<ToyId, 'duck'> = pick(toys, random, 'ball');
        bump('fun', TUNING.play.fun);
        bump('energy', TUNING.play.energy);
        bump('tummy', TUNING.play.tummy);
        bond(TUNING.bondFor.play);
        emit('action', { type: 'play', toy });
        return null;
      }),

    wash: () =>
      act('wash', () => {
        if (pet.asleep) return 'asleep';
        pet.needs.clean = 100;
        bond(TUNING.bondFor.wash);
        emit('action', { type: 'wash', duck: has('duck') });
        return null;
      }),

    pet: () =>
      act('pet', () => {
        bump('fun', TUNING.pet.fun);
        bond(TUNING.bondFor.pet);
        emit('action', { type: 'pet' });
        return null;
      }),

    sleep,
    wake,
    toggleSleep: () => (pet.asleep ? wake() : sleep()),

    setFocusLength(minutes: FocusMinutes): void {
      change(() => {
        if (pet.focus.status !== 'idle' || !FOCUS_LENGTHS.includes(minutes)) return;
        pet.focus.minutes = minutes;
      });
    },

    startFocus: () =>
      act('startFocus', () => {
        if (pet.focus.status !== 'idle') return 'focus-running';
        if (pet.asleep) return 'asleep';
        pet.focus.status = 'running';
        pet.focus.endsAt = lastSeen + pet.focus.minutes * 60_000;
        emit('focus', { type: 'start' });
        return null;
      }),

    pauseFocus(): void {
      change(() => {
        const f = pet.focus;
        if (f.status !== 'running') return;
        f.remainingMs = Math.max(1, f.endsAt - lastSeen);
        f.status = 'paused';
        emit('focus', { type: 'pause' });
      });
    },

    resumeFocus(): void {
      change(() => {
        const f = pet.focus;
        if (f.status !== 'paused') return;
        f.endsAt = lastSeen + f.remainingMs;
        f.status = 'running';
        emit('focus', { type: 'resume' });
      });
    },

    stopFocus(): void {
      change(() => {
        if (pet.focus.status === 'idle') return;
        pet.focus = { minutes: pet.focus.minutes, status: 'idle', endsAt: 0, remainingMs: 0 };
        emit('focus', { type: 'stop' });
      });
    },

    setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
      const valid = readSetting(key, value);
      if (valid === undefined) return; // not a setting, or not a value it can take
      if (JSON.stringify(valid) === JSON.stringify(settings[key])) return;
      change(() => {
        settings = deepFreeze({ ...settings, [key]: valid });
        emit('settings', { key });
      });
    },

    tick(): void {
      if (heldForFirstTick) {
        queue.unshift(...heldForFirstTick);
        heldForFirstTick = null;
      }
      finish(catchUp());
    },

    on<E extends keyof BrainEvents>(type: E, handler: (detail: BrainEvents[E]) => void): () => void {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      const entry = handler as AnyHandler;
      set.add(entry);
      return () => void handlers.get(type)?.delete(entry);
    },

    serialize: () => toSave(pet, settings, lastSeen),
  };

  if (options.debug !== true) return brain;

  return Object.assign(brain, {
    debug: {
      setNeeds(values: Partial<Record<NeedKey, number>>): void {
        change(() => {
          for (const key of NEED_KEYS) {
            const v = values?.[key];
            if (typeof v === 'number' && Number.isFinite(v)) pet.needs[key] = clamp(v);
          }
        });
      },
      setTimeScale(multiplier: number): void {
        // Catch up first so the time already passed is counted at the old speed.
        change(() => {
          if (Number.isFinite(multiplier)) timeScale = Math.min(100_000, Math.max(0, multiplier));
        });
      },
      addTreats(count: number): void {
        change(() => {
          if (Number.isFinite(count)) pet.treats = clamp(pet.treats + Math.trunc(count), 0, LIMITS.treats);
        });
      },
      finishFocusNow(): void {
        change(() => {
          if (pet.focus.status !== 'idle') completeFocus(lastSeen);
        });
      },
      reset(): void {
        // A newly hatched Doozer. Settings belong to the person, not the pet, and stay.
        change(() => {
          pet = freshPet(lastSeen, random);
        });
      },
    },
  });
}
