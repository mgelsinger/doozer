// What the pill says: the name, one status line, and a ring (DESIGN_SPEC.md 6.1).
// Pure, so it is tested without a page. Nothing here decides a rule: it only words
// and colours what the brain's state already says.

import type { Limits, Mood, NeedKey, PetState, TreatId } from '../../core/contract';
import { formatClock, quietClock } from '../../ui/format';
import type { IconName } from '../../ui/icons';
import { NEED_ART, needLevel, needTone, type NeedTone } from '../../ui/needs';

export type StatusTone = 'plain' | 'low' | 'urgent' | 'focus';

export interface PillFace {
  readonly name: string;
  /** "is content", "is hungry", or the countdown while a session runs. */
  readonly status: string;
  readonly statusTone: StatusTone;
  readonly ring: {
    /** Wellbeing normally; session progress while focusing. */
    readonly kind: 'wellbeing' | 'focus';
    /** 0..100. */
    readonly percent: number;
    readonly tone: NeedTone | 'focus';
    /** What sits in the middle of the ring. */
    readonly icon: IconName;
  };
  /** The whole face in words, for a screen reader. */
  readonly label: string;
}

const STATUS: Readonly<Record<Mood, string>> = {
  asleep: 'is napping',
  hungry: 'is hungry',
  bored: 'wants to play',
  sleepy: 'is sleepy',
  dirty: 'needs a bath',
  joyful: 'is overjoyed',
  content: 'is content',
  meh: 'is so-so',
};

/** The same four, when the need is urgent. The words change too: colour is never the only signal. */
const URGENT: Readonly<Record<NeedKey, string>> = {
  tummy: 'is very hungry',
  fun: 'is very bored',
  energy: 'is worn out',
  clean: 'is very grubby',
};

const LOW_MOODS: readonly Mood[] = ['hungry', 'bored', 'sleepy', 'dirty'];

const clampPercent = (value: number): number => (Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : 0);

/**
 * `precise` is whether someone is looking. While nobody is, a running session is counted
 * in whole minutes ("25 min"), so that the pill changes once a minute and not once a
 * second (ui/format.ts, `quietClock`).
 */
export function pillFace(state: PetState, limits: Limits, precise = true): PillFace {
  const focus = state.focus;
  const wellbeing = clampPercent(state.wellbeing);

  // During a session the pill is a timer. A need running low shows only in Doozer's
  // own face (spec 4.5), so neither the words nor the ring change colour.
  if (focus.status !== 'idle') {
    const running = focus.status === 'running';
    const clock = running && !precise ? quietClock(focus.remainingMs) : formatClock(focus.remainingMs);
    const percent = clampPercent(focus.progress * 100);
    return {
      name: state.name,
      status: running ? clock : `paused · ${clock}`,
      statusTone: running ? 'focus' : 'plain',
      ring: { kind: 'focus', percent, tone: 'focus', icon: 'timer' },
      label: running
        ? `${state.name} is focusing. ${clock} left of ${focus.minutes} minutes.`
        : `${state.name}'s focus session is paused with ${clock} left.`,
    };
  }

  const lowestLevel = needLevel(state.lowest.value, limits);
  const needy = !state.asleep && LOW_MOODS.includes(state.mood);
  const urgent = needy && lowestLevel === 'urgent';
  const status = urgent ? URGENT[state.lowest.key] : STATUS[state.mood];
  // The ring's length is the average; its colour follows the worst need once one is
  // low, so a long green ring never sits beside "is very hungry".
  const tone = lowestLevel === 'ok' ? needTone(wellbeing, limits) : needTone(state.lowest.value, limits);
  const icon: IconName = state.asleep ? 'z' : needy ? NEED_ART[state.lowest.key].icon : 'heart';
  return {
    name: state.name,
    status,
    statusTone: urgent ? 'urgent' : needy ? 'low' : 'plain',
    ring: { kind: 'wellbeing', percent: wellbeing, tone, icon },
    label: `${state.name} ${status}. Wellbeing ${wellbeing}%.`,
  };
}

const FAVOURITE: Readonly<Record<TreatId, string>> = {
  biscuit: 'loves biscuits',
  cookie: 'loves cookies',
  donut: 'loves donuts',
  strawberry: 'loves strawberries',
  onigiri: 'loves onigiri',
};

/** The status line while a newly hatched Doozer shows which snack is its favourite. */
export function favouriteLine(favourite: TreatId): string {
  return FAVOURITE[favourite];
}
