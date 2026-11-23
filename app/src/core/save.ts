// The save format, its migrations, and a loader that never throws.
//
// Version history
//   1  The flat shape written by the Phase 1 mockups (mockups/shared/sim.js): needs,
//      bond, treats, messes. No bowl, no focus, no settings.
//   2  First app format: { v, lastSeen, pet, focus, progress, settings }.
//
// To change the format: bump SAVE_VERSION, add one function to MIGRATIONS that turns
// the previous version into the new one, and add a test with a sample of the old shape.
// Migrations only reshape; `sanitise` below is what makes every field trustworthy.

import type {
  FocusMinutes,
  HatId,
  NeedKey,
  PaletteId,
  Settings,
  SizeId,
  TreatId,
  ViewId,
} from './contract';
import {
  DEFAULT_FOCUS_MINUTES,
  FOCUS_LENGTHS,
  FRESH,
  LIMITS,
  NEED_KEYS,
  TREATS,
  defaultSettings,
} from './tuning';

export const SAVE_VERSION = 2;

// ---- the brain's private, mutable state ------------------------------------------

export interface FocusCore {
  minutes: FocusMinutes;
  status: 'idle' | 'running' | 'paused';
  /** While running: the moment the session completes (ms since epoch). */
  endsAt: number;
  /** While paused: the time that was left when it was paused. */
  remainingMs: number;
}

export interface PetCore {
  name: string;
  bornAt: number;
  /** Exact values. `state.needs` shows these rounded to whole numbers. */
  needs: Record<NeedKey, number>;
  asleep: boolean;
  bond: number;
  bowl: number;
  /** Seconds until Doozer will take another serving from the bowl. */
  bowlWait: number;
  treats: number;
  favourite: TreatId;
  focus: FocusCore;
  sessions: number;
  streak: number;
  best: number;
  /** localDay() of the last completed session, or null if there has never been one. */
  lastDay: number | null;
}

export interface Loaded {
  pet: PetCore;
  settings: Settings;
  /** The moment the pet's state was last brought up to date. */
  lastSeen: number;
  /** True when there was no usable save and this is a newly hatched Doozer. */
  fresh: boolean;
}

type Bag = Record<string, unknown>;

// ---- small readers ----------------------------------------------------------------

function isBag(v: unknown): v is Bag {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function ranged(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = num(v);
  return n === undefined ? fallback : clamp(n, lo, hi);
}

function count(v: unknown, hi: number, fallback: number): number {
  const n = num(v);
  return n === undefined ? fallback : clamp(Math.floor(n), 0, hi);
}

function oneOf<T>(allowed: readonly T[]): (v: unknown) => T | undefined {
  return (v) => (allowed.includes(v as T) ? (v as T) : undefined);
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

// ---- settings ---------------------------------------------------------------------

const VIEWS: readonly ViewId[] = ['pill', 'room', 'island', 'desktop'];
const SIZES: readonly SizeId[] = ['small', 'medium', 'large'];
const PALETTES: readonly PaletteId[] = ['peach', 'mint', 'lavender', 'butter', 'sky'];
const HATS: readonly (HatId | null)[] = ['nightcap', 'bow', null];

const readSize = oneOf(SIZES);

/** One checker per setting. Each returns the value if it is valid, otherwise undefined. */
const SETTING_READERS: { readonly [K in keyof Settings]: (v: unknown) => Settings[K] | undefined } = {
  palette: oneOf(PALETTES),
  size: (v) => {
    if (!isBag(v)) return undefined;
    const out = {} as Record<ViewId, SizeId>;
    for (const view of VIEWS) {
      const size = readSize(v[view]);
      if (size === undefined) return undefined;
      out[view] = size;
    }
    return out;
  },
  pillDock: oneOf(['top-center', 'top-left', 'top-right', 'bottom-right'] as const),
  desktopActivity: oneOf(['still', 'calm', 'lively'] as const),
  sound: bool,
  soundAsked: bool,
  onFocusEnd: oneOf(['quiet', 'open-card'] as const),
  alwaysOnTop: bool,
  tuckAwayInFullscreen: bool,
  startWithWindows: bool,
  reduceMotion: oneOf(['system', 'on', 'off'] as const),
  uiScale: oneOf(['normal', 'large', 'larger'] as const),
  frameRate: oneOf(['light', '30', '60', '120', '144'] as const),
  hat: oneOf(HATS),
  lastView: oneOf(VIEWS),
};

const SETTING_KEYS = Object.keys(SETTING_READERS) as (keyof Settings)[];

/** The value if `key` is a real setting and `value` is valid for it; otherwise undefined. */
export function readSetting<K extends keyof Settings>(key: K, value: unknown): Settings[K] | undefined {
  if (!Object.hasOwn(SETTING_READERS, key)) return undefined;
  return SETTING_READERS[key](value);
}

function sanitiseSettings(raw: unknown): Settings {
  const settings = defaultSettings();
  if (!isBag(raw)) return settings;
  const put = <K extends keyof Settings>(key: K): void => {
    const value = readSetting(key, raw[key]);
    if (value !== undefined) settings[key] = value;
  };
  for (const key of SETTING_KEYS) put(key);
  // A size record with one bad entry keeps its good ones.
  if (isBag(raw.size)) {
    for (const view of VIEWS) {
      const size = readSize(raw.size[view]);
      if (size !== undefined) settings.size[view] = size;
    }
  }
  return settings;
}

// ---- fresh pet --------------------------------------------------------------------

function pickFavourite(random: () => number): TreatId {
  const r = random();
  const i = Number.isFinite(r) ? clamp(Math.floor(r * TREATS.length), 0, TREATS.length - 1) : 0;
  return TREATS[i] ?? 'biscuit';
}

function idleFocus(minutes: FocusMinutes): FocusCore {
  return { minutes, status: 'idle', endsAt: 0, remainingMs: 0 };
}

export function freshPet(now: number, random: () => number): PetCore {
  return {
    name: FRESH.name,
    bornAt: now,
    needs: { ...FRESH.needs },
    asleep: false,
    bond: FRESH.bond,
    bowl: FRESH.bowl,
    bowlWait: 0,
    treats: FRESH.treats,
    favourite: pickFavourite(random),
    focus: idleFocus(DEFAULT_FOCUS_MINUTES),
    sessions: 0,
    streak: 0,
    best: 0,
    lastDay: null,
  };
}

function fresh(now: number, random: () => number): Loaded {
  return { pet: freshPet(now, random), settings: defaultSettings(), lastSeen: now, fresh: true };
}

// ---- migrations -------------------------------------------------------------------

/** MIGRATIONS[n] turns a version-n save into version n + 1. */
const MIGRATIONS: Readonly<Record<number, (old: Bag) => Bag>> = {
  // Phase 1 mockup save -> first app save. Messes and age are dropped; the bowl, the
  // favourite snack, focus, progress and settings did not exist and take their defaults.
  1: (old) => ({
    v: 2,
    lastSeen: old.lastSeen,
    pet: {
      name: old.name,
      bornAt: old.bornAt,
      needs: old.needs,
      asleep: old.asleep,
      bond: old.bond,
      treats: old.treats,
    },
  }),
};

// ---- load -------------------------------------------------------------------------

function sanitiseFocus(raw: unknown, lastSeen: number): FocusCore {
  if (!isBag(raw)) return idleFocus(DEFAULT_FOCUS_MINUTES);
  const minutes = oneOf(FOCUS_LENGTHS)(raw.minutes) ?? DEFAULT_FOCUS_MINUTES;
  const total = minutes * 60_000;
  if (raw.status === 'running') {
    const endsAt = num(raw.endsAt);
    if (endsAt === undefined) return idleFocus(minutes);
    // A session can never have more left than its own length.
    return { minutes, status: 'running', endsAt: Math.min(endsAt, lastSeen + total), remainingMs: 0 };
  }
  if (raw.status === 'paused') {
    const remainingMs = num(raw.remainingMs);
    if (remainingMs === undefined || remainingMs <= 0) return idleFocus(minutes);
    return { minutes, status: 'paused', endsAt: 0, remainingMs: Math.min(remainingMs, total) };
  }
  return idleFocus(minutes);
}

function sanitise(save: Bag, now: number, random: () => number): Loaded | null {
  const rawPet = save.pet;
  if (!isBag(rawPet) || !isBag(rawPet.needs)) return null;
  const rawNeeds = rawPet.needs;

  const base = freshPet(now, random);
  const lastSeenRaw = num(save.lastSeen);
  const lastSeen = lastSeenRaw !== undefined && lastSeenRaw > 0 ? lastSeenRaw : now;

  const needs = { ...base.needs };
  for (const key of NEED_KEYS) needs[key] = ranged(rawNeeds[key], 0, 100, base.needs[key]);

  const progress = isBag(save.progress) ? save.progress : {};
  const lastDayRaw = num(progress.lastDay);
  const lastDay = lastDayRaw === undefined ? null : Math.round(lastDayRaw);
  const streak = lastDay === null ? 0 : count(progress.streak, 1e6, 0);
  const best = Math.max(streak, count(progress.best, 1e6, 0));

  const name = typeof rawPet.name === 'string' ? rawPet.name.trim().slice(0, 24) : '';
  const bornAt = num(rawPet.bornAt);

  const pet: PetCore = {
    name: name || base.name,
    bornAt: bornAt !== undefined && bornAt > 0 ? bornAt : now,
    needs,
    asleep: rawPet.asleep === true,
    bond: ranged(rawPet.bond, 0, 100, base.bond),
    bowl: count(rawPet.bowl, LIMITS.bowl, 0),
    bowlWait: ranged(rawPet.bowlWait, 0, 3600, 0),
    treats: count(rawPet.treats, LIMITS.treats, base.treats),
    favourite: oneOf(TREATS)(rawPet.favourite) ?? base.favourite,
    focus: sanitiseFocus(save.focus, lastSeen),
    sessions: count(progress.sessions, 1e9, 0),
    streak,
    best,
    lastDay,
  };
  return { pet, settings: sanitiseSettings(save.settings), lastSeen, fresh: false };
}

/**
 * Turn whatever the host read from disk into a pet. Never throws: no save, a save
 * that is not ours, or one too damaged to read gives a newly hatched Doozer. A save
 * that is mostly fine keeps everything that is valid and takes defaults for the rest.
 */
export function loadSave(raw: unknown, now: number, random: () => number): Loaded {
  try {
    let data: unknown = raw;
    if (typeof data === 'string') data = JSON.parse(data);
    if (!isBag(data)) return fresh(now, random);

    let version = num(data.v);
    if (version === undefined || !Number.isInteger(version) || version < 1) return fresh(now, random);

    let save: Bag = data;
    while (version < SAVE_VERSION) {
      const migrate = MIGRATIONS[version];
      if (!migrate) return fresh(now, random);
      save = migrate(save);
      version += 1;
    }
    // A save from a newer build is read as far as this build understands it,
    // rather than thrown away.
    return sanitise(save, now, random) ?? fresh(now, random);
  } catch {
    return fresh(now, random);
  }
}

// ---- save -------------------------------------------------------------------------

/** A plain, JSON-safe copy of everything needed to bring this pet back. */
export function toSave(pet: PetCore, settings: Settings, lastSeen: number): unknown {
  return {
    v: SAVE_VERSION,
    lastSeen,
    pet: {
      name: pet.name,
      bornAt: pet.bornAt,
      needs: { ...pet.needs },
      asleep: pet.asleep,
      bond: pet.bond,
      bowl: pet.bowl,
      bowlWait: pet.bowlWait,
      treats: pet.treats,
      favourite: pet.favourite,
    },
    focus: { ...pet.focus },
    progress: { sessions: pet.sessions, streak: pet.streak, best: pet.best, lastDay: pet.lastDay },
    settings: { ...settings, size: { ...settings.size } },
  };
}
