// A week in Doozer's life with nobody at the keyboard except for short visits.
// Headless: it drives the real brain with a fake clock. Used two ways:
//   - tests/core/week-sim.test.ts holds the tuning targets as assertions
//   - tests/core/week-sim.run.mjs prints the curves (see docs/brain-week-sim.md)

import type { Brain, Mood, NeedKey, PetState } from '../../src/core';
import { createBrain } from '../../src/core';
import { seeded } from './helpers';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STEP = 5 * MIN;
const NEEDS: readonly NeedKey[] = ['tummy', 'fun', 'energy', 'clean'];

export interface WeekOptions {
  /** Visits per day, spread evenly from 08:00 to 22:00 (one visit: 18:00). */
  visitsPerDay: number;
  days?: number;
  /** Days (1-based) on which nobody visits at all. */
  skipDays?: readonly number[];
  /** 25-minute focus sessions per day, started at the first visits of the day. */
  focusPerDay?: number;
  /** Whether the visitor tops the bowl up. */
  fillBowl?: boolean;
  /** Leave the app running between visits instead of closing it. */
  appOpen?: boolean;
  /** Each visit lands up to this many minutes early or late. Real people are not punctual. */
  jitterMinutes?: number;
  seed?: number;
}

export interface Sample {
  t: number;
  day: number;
  minuteOfDay: number;
  needs: Readonly<Record<NeedKey, number>>;
  wellbeing: number;
  asleep: boolean;
  mood: Mood;
  bowl: number;
  treats: number;
}

export interface Glimpse {
  mood: Mood;
  needs: Readonly<Record<NeedKey, number>>;
  wellbeing: number;
  asleep: boolean;
}

export interface Visit {
  t: number;
  day: number;
  clock: string;
  arrive: Glimpse;
  leave: Glimpse;
  did: string[];
  /** True for the first visit after a day with no visits. */
  afterMissedDay: boolean;
}

export interface WeekSummary {
  hours: number;
  moodShare: Record<Mood, number>;
  /** Share of the time Doozer was joyful, content or asleep. */
  fineShare: number;
  averageWellbeing: number;
  lowest: Record<NeedKey, number>;
  lowHours: Record<NeedKey, number>;
  urgentHours: Record<NeedKey, number>;
  bond: { start: number; end: number };
  treatsEnd: number;
  sessions: number;
}

export interface WeekResult {
  options: Required<WeekOptions>;
  samples: Sample[];
  visits: Visit[];
  summary: WeekSummary;
}

function glimpse(s: PetState): Glimpse {
  return { mood: s.mood, needs: s.needs, wellbeing: s.wellbeing, asleep: s.asleep };
}

function clockText(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Minutes after midnight for each visit of a day. */
export function visitTimes(visitsPerDay: number): number[] {
  if (visitsPerDay <= 0) return [];
  if (visitsPerDay === 1) return [18 * 60];
  const first = 8 * 60;
  const last = 22 * 60;
  return Array.from({ length: visitsPerDay }, (_, i) => {
    const exact = first + ((last - first) * i) / (visitsPerDay - 1);
    return Math.round(exact / 5) * 5;
  });
}

/**
 * What a caring person does in a short visit: about a minute of clicking.
 * Nothing clever, and nothing a real player could not see to do from the Card.
 */
export function shortVisit(brain: Brain, fill: boolean): string[] {
  const did: string[] = [];
  const count = (label: string, n: number): void => {
    if (n > 0) did.push(n > 1 ? `${label} x${n}` : label);
  };

  if (brain.state.asleep) {
    const n = brain.state.needs;
    const rested = n.energy >= 50;
    const needsLookingAfter = n.tummy < 30 || n.clean < 30;
    if (!rested && !needsLookingAfter) {
      // Let it sleep. Leave food for when it wakes.
      brain.pet();
      did.push('pet');
      if (fill && brain.fillBowl().ok) did.push('fill bowl');
      return did;
    }
    brain.wake();
    did.push('wake');
  }

  if (fill && brain.fillBowl().ok) did.push('fill bowl');

  let meals = 0;
  while (meals < 4 && brain.state.needs.tummy <= 62 && brain.feed().ok) meals++;
  count('feed', meals);

  if (brain.state.needs.clean < 75 && brain.wash().ok) did.push('wash');

  // Play until it is happy, but do not wear it out.
  let plays = 0;
  while (plays < 4 && brain.state.needs.fun <= 80 && brain.state.needs.energy >= 20 && brain.play().ok) plays++;
  count('play', plays);

  if (brain.state.treats > 0 && brain.state.needs.fun <= 80 && brain.giveTreat().ok) did.push('treat');

  // A couple of strokes always; a proper fuss if it is bored and too tired to play.
  let pets = 0;
  while (pets < 2 || (pets < 8 && brain.state.needs.fun < 60)) {
    brain.pet();
    pets++;
  }
  count('pet', pets);

  if (fill && brain.fillBowl().ok) did.push('top up bowl');
  if (brain.state.needs.energy < 30 && brain.sleep().ok) did.push('tuck in');
  return did;
}

export function simulateWeek(input: WeekOptions): WeekResult {
  const options: Required<WeekOptions> = {
    visitsPerDay: input.visitsPerDay,
    days: input.days ?? 7,
    skipDays: input.skipDays ?? [],
    focusPerDay: input.focusPerDay ?? 0,
    fillBowl: input.fillBowl ?? true,
    appOpen: input.appOpen ?? false,
    jitterMinutes: input.jitterMinutes ?? 0,
    seed: input.seed ?? 7,
  };

  // Monday 2 November 2026, 08:00 local time: Doozer hatches and gets its first visit.
  const midnight = new Date(2026, 10, 2, 0, 0, 0).getTime();
  const start = midnight + 8 * HOUR;
  const end = start + options.days * DAY;
  const random = seeded(options.seed);

  // Every visit of the week, as a time on the 5-minute grid.
  const lateness = seeded(options.seed + 1000);
  const planned = new Map<number, number>(); // time -> index of that visit within its day
  for (let d = 0; d < options.days + 1; d++) {
    if (options.skipDays.includes(d + 1)) continue;
    visitTimes(options.visitsPerDay).forEach((minute, index) => {
      const jitter = Math.round(((lateness() * 2 - 1) * options.jitterMinutes) / 5) * 5;
      const t = midnight + d * DAY + (minute + jitter) * MIN;
      if (t > start) planned.set(t, index);
    });
  }

  let now = start;
  const clock = (): number => now;
  let save: unknown;
  /** The running app, or null while it is closed. */
  let open: Brain | null = null;
  let closeAt = Infinity;

  const launch = (): Brain => createBrain({ save, now: clock, random });
  const peek = (): PetState => (open ? open.state : createBrain({ save, now: clock, random: seeded(1) }).state);
  const bondOf = (value: unknown): number => (value as { pet: { bond: number } }).pet.bond;

  const samples: Sample[] = [];
  const visits: Visit[] = [];
  let lastVisitDay = 0;
  let bondStart = 0;

  for (; now < end; now += STEP) {
    const sinceMidnight = now - midnight;
    const day = Math.floor(sinceMidnight / DAY) + 1;
    const minuteOfDay = Math.round((sinceMidnight % DAY) / MIN);

    if (open) {
      open.tick();
      if (now >= closeAt && !options.appOpen) {
        // The focus session has just ended at the desk: one treat, then close.
        if (!open.state.asleep && open.state.treats > 0 && open.state.needs.fun <= 84) open.giveTreat();
        save = open.serialize();
        open = null;
        closeAt = Infinity;
      }
    }

    const hatching = now === start;
    const visitIndex = planned.get(now) ?? -1;
    const visiting = hatching || visitIndex >= 0;

    if (visiting) {
      const brain: Brain = open ?? launch();
      open = brain;
      brain.tick();
      if (hatching) bondStart = bondOf(brain.serialize());
      const arrive = glimpse(brain.state);
      const did = shortVisit(brain, options.fillBowl);

      const wantsFocus = visitIndex >= 0 && visitIndex < options.focusPerDay;
      if (wantsFocus && brain.state.focus.status === 'idle' && brain.startFocus().ok) {
        did.push('focus 25');
        closeAt = now + 25 * MIN;
      }
      visits.push({
        t: now,
        day,
        clock: clockText(minuteOfDay),
        arrive,
        leave: glimpse(brain.state),
        did,
        afterMissedDay: lastVisitDay > 0 && day - lastVisitDay >= 2,
      });
      lastVisitDay = day;

      if (closeAt === Infinity && !options.appOpen) {
        save = brain.serialize();
        open = null;
      }
    }

    const s = peek();
    samples.push({
      t: now,
      day,
      minuteOfDay,
      needs: s.needs,
      wellbeing: s.wellbeing,
      asleep: s.asleep,
      mood: s.mood,
      bowl: s.bowl,
      treats: s.treats,
    });
  }

  if (open) save = open.serialize();
  const finalState = peek();

  // ---- summary ----
  const zeroNeeds = (): Record<NeedKey, number> => ({ tummy: 0, fun: 0, energy: 0, clean: 0 });
  const moodShare: Record<Mood, number> = {
    asleep: 0, hungry: 0, bored: 0, sleepy: 0, dirty: 0, joyful: 0, content: 0, meh: 0,
  };
  const lowest: Record<NeedKey, number> = { tummy: 100, fun: 100, energy: 100, clean: 100 };
  const lowHours = zeroNeeds();
  const urgentHours = zeroNeeds();
  let wellbeing = 0;
  const stepHours = STEP / HOUR;
  for (const s of samples) {
    moodShare[s.mood] += 1 / samples.length;
    wellbeing += s.wellbeing / samples.length;
    for (const key of NEEDS) {
      lowest[key] = Math.min(lowest[key], s.needs[key]);
      if (s.needs[key] < 30) lowHours[key] += stepHours;
      if (s.needs[key] < 12) urgentHours[key] += stepHours;
    }
  }

  return {
    options,
    samples,
    visits,
    summary: {
      hours: samples.length * stepHours,
      moodShare,
      fineShare: moodShare.joyful + moodShare.content + moodShare.asleep,
      averageWellbeing: wellbeing,
      lowest,
      lowHours,
      urgentHours,
      bond: { start: bondStart, end: bondOf(save) },
      treatsEnd: finalState.treats,
      sessions: finalState.sessionsCompleted,
    },
  };
}

// ---- printing -----------------------------------------------------------------------

const BARS = '▁▂▃▄▅▆▇█';
const MOOD_LETTER: Record<Mood, string> = {
  joyful: 'J', content: 'c', meh: '-', hungry: 'H', bored: 'B', sleepy: 'S', dirty: 'D', asleep: 'z',
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function bar(value: number): string {
  return BARS[Math.min(BARS.length - 1, Math.floor((value / 100) * BARS.length))] ?? ' ';
}

function needsText(g: Glimpse): string {
  const n = g.needs;
  return `T${String(n.tummy).padStart(3)} F${String(n.fun).padStart(3)} E${String(n.energy).padStart(3)} C${String(n.clean).padStart(3)}`;
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** The curves, one character per half hour, a day per block, 08:00 to 08:00. */
export function formatCurves(result: WeekResult): string {
  const lines: string[] = [];
  const first = result.samples[0];
  if (!first) return '';
  const perHalfHour = (30 * MIN) / STEP;
  for (let d = 0; d < result.options.days; d++) {
    const from = d * (DAY / STEP);
    const dayRows = result.samples.slice(from, from + DAY / STEP);
    const picks = dayRows.filter((_, i) => i % perHalfHour === 0);
    const label = `Day ${d + 1} ${WEEKDAYS[d % 7]}`;
    lines.push(`${label.padEnd(10)}08  .   10  .   12  .   14  .   16  .   18  .   20  .   22  .   00  .   02  .   04  .   06  .`);
    for (const key of NEEDS) {
      lines.push(`  ${key.padEnd(8)}${picks.map((s) => bar(s.needs[key])).join(' ')}`);
    }
    lines.push(`  ${'mood'.padEnd(8)}${picks.map((s) => MOOD_LETTER[s.mood]).join(' ')}`);
    const marks = picks.map((s) => (result.visits.some((v) => v.t >= s.t && v.t < s.t + 30 * MIN) ? '^' : ' '));
    lines.push(`  ${'visit'.padEnd(8)}${marks.join(' ')}`.trimEnd());
    lines.push('');
  }
  lines.push('mood key: J joyful  c content  - meh  H hungry  B bored  S sleepy  D dirty  z asleep');
  return lines.join('\n');
}

export function formatVisits(result: WeekResult): string {
  const lines = ['day  time   on arrival                              after the visit                         what was done'];
  for (const v of result.visits) {
    const arrive = `${v.arrive.mood.padEnd(8)} ${needsText(v.arrive)}`;
    const leave = `${v.leave.mood.padEnd(8)} ${needsText(v.leave)}`;
    const flag = v.afterMissedDay ? '  <- first visit after a missed day' : '';
    lines.push(`${String(v.day).padStart(3)}  ${v.clock}  ${arrive.padEnd(38)}  ${leave.padEnd(38)}  ${v.did.join(', ')}${flag}`);
  }
  return lines.join('\n');
}

export function describeOptions(o: Required<WeekOptions>): string {
  const parts = [`${o.visitsPerDay} visit${o.visitsPerDay === 1 ? '' : 's'} a day`];
  if (o.skipDays.length) parts.push(`day ${o.skipDays.join(' and ')} missed`);
  if (o.focusPerDay) parts.push(`${o.focusPerDay} focus session${o.focusPerDay === 1 ? '' : 's'} a day`);
  if (!o.fillBowl) parts.push('bowl never filled');
  if (o.jitterMinutes) parts.push(`up to ${o.jitterMinutes} min early or late`);
  parts.push(o.appOpen ? 'app left running' : 'app closed between visits');
  return parts.join(', ');
}

const LABEL = 70;

export function summaryHeader(): string {
  return [
    `${'scenario'.padEnd(LABEL)} | fine | joyful content  meh | hungry bored sleepy dirty | asleep | avg  | urgent h (T/F/E/C)  | lowest (T/F/E/C) | bond`,
    `${'-'.repeat(LABEL)}-|------|---------------------|---------------------------|--------|------|---------------------|------------------|----------`,
  ].join('\n');
}

export function summaryRow(result: WeekResult): string {
  const s = result.summary;
  const m = s.moodShare;
  const cell = (v: string, w: number): string => v.padStart(w);
  const one = (v: number): string => v.toFixed(1);
  return [
    describeOptions(result.options).padEnd(LABEL),
    cell(pct(s.fineShare), 4),
    `${cell(pct(m.joyful), 6)} ${cell(pct(m.content), 7)} ${cell(pct(m.meh), 4)}`,
    `${cell(pct(m.hungry), 6)} ${cell(pct(m.bored), 5)} ${cell(pct(m.sleepy), 6)} ${cell(pct(m.dirty), 5)}`,
    cell(pct(m.asleep), 6),
    cell(s.averageWellbeing.toFixed(0), 4),
    cell(`${one(s.urgentHours.tummy)}/${one(s.urgentHours.fun)}/${one(s.urgentHours.energy)}/${one(s.urgentHours.clean)}`, 19),
    cell(`${s.lowest.tummy}/${s.lowest.fun}/${s.lowest.energy}/${s.lowest.clean}`, 16),
    `${s.bond.start.toFixed(0)} -> ${s.bond.end.toFixed(0)}`,
  ].join(' | ');
}

export function formatReport(result: WeekResult): string {
  return [
    `### ${describeOptions(result.options)}`,
    '',
    '```',
    formatCurves(result),
    '```',
    '',
    '```',
    formatVisits(result),
    '```',
    '',
    '```',
    summaryHeader(),
    summaryRow(result),
    '```',
  ].join('\n');
}
