// The tuning targets from WORK_PLAN.md, Phase 4, task 10, held as assertions:
//   - three to five short visits a day keep Doozer happy
//   - a missed day leaves it sulky but recoverable in one visit
// If a change to core/tuning.ts breaks one of these, read docs/brain-week-sim.md first.

import { describe, expect, it } from 'vitest';
import { shortVisit, simulateWeek, visitTimes, type WeekResult } from './week-sim';
import { createBrain } from '../../src/core';
import { seeded } from './helpers';

const SEEDS = [1, 2, 3, 4, 5, 6];

/** Share of the week with tummy, fun and clean all at 30 or more: the needs a person looks after. */
function lookedAfter(r: WeekResult): number {
  const ok = r.samples.filter((s) => s.needs.tummy >= 30 && s.needs.fun >= 30 && s.needs.clean >= 30);
  return ok.length / r.samples.length;
}

function urgentCareHours(r: WeekResult): number {
  const u = r.summary.urgentHours;
  return u.tummy + u.fun + u.clean;
}

describe('week simulation: the schedule', () => {
  it('spreads visits between 08:00 and 22:00', () => {
    expect(visitTimes(1)).toEqual([18 * 60]);
    expect(visitTimes(3)).toEqual([8 * 60, 15 * 60, 22 * 60]);
    expect(visitTimes(5)).toEqual([480, 690, 900, 1110, 1320]);
    expect(visitTimes(0)).toEqual([]);
  });

  it('samples a whole week every five minutes', () => {
    const r = simulateWeek({ visitsPerDay: 3 });
    expect(r.samples).toHaveLength(7 * 24 * 12);
    expect(r.visits).toHaveLength(1 + 7 * 3 - 1); // the hatching visit is the first 08:00
    expect(r.summary.hours).toBeCloseTo(168, 6);
  });
});

describe('week simulation: three to five short visits a day keep Doozer happy', () => {
  for (const visitsPerDay of [3, 4, 5]) {
    it(`${visitsPerDay} visits a day, on the dot`, () => {
      const r = simulateWeek({ visitsPerDay });
      expect(lookedAfter(r)).toBeGreaterThanOrEqual(0.95);
      expect(urgentCareHours(r)).toBeLessThanOrEqual(1);
      expect(r.summary.averageWellbeing).toBeGreaterThanOrEqual(65);
    });

    it(`${visitsPerDay} visits a day, each up to 45 minutes early or late`, () => {
      for (const seed of SEEDS) {
        const r = simulateWeek({ visitsPerDay, jitterMinutes: 45, seed });
        expect(lookedAfter(r), `seed ${seed}`).toBeGreaterThanOrEqual(0.93);
        expect(urgentCareHours(r), `seed ${seed}`).toBeLessThanOrEqual(3);
        expect(r.summary.averageWellbeing, `seed ${seed}`).toBeGreaterThanOrEqual(65);
      }
    });
  }

  it('five visits leave almost no time with anything low', () => {
    for (const seed of SEEDS) {
      expect(lookedAfter(simulateWeek({ visitsPerDay: 5, jitterMinutes: 45, seed })), `seed ${seed}`).toBeGreaterThanOrEqual(0.97);
    }
  });

  it('one visit a day is not enough', () => {
    expect(lookedAfter(simulateWeek({ visitsPerDay: 1 }))).toBeLessThan(0.7);
  });

  it('depends on the bowl being filled', () => {
    const without = simulateWeek({ visitsPerDay: 4, fillBowl: false });
    expect(lookedAfter(without)).toBeLessThan(0.8);
    expect(without.summary.urgentHours.tummy).toBeGreaterThan(10);
  });

  it('is the same whether the app is closed between visits or left running', () => {
    const closed = simulateWeek({ visitsPerDay: 4 });
    const open = simulateWeek({ visitsPerDay: 4, appOpen: true });
    expect(open.samples.map((s) => s.needs)).toEqual(closed.samples.map((s) => s.needs));
    expect(open.samples.map((s) => s.mood)).toEqual(closed.samples.map((s) => s.mood));
  });

  it('earns treats when the visits include focus sessions', () => {
    const r = simulateWeek({ visitsPerDay: 4, focusPerDay: 2 });
    expect(r.summary.sessions).toBeGreaterThanOrEqual(8);
    expect(r.summary.treatsEnd).toBeGreaterThan(2);
    expect(lookedAfter(r)).toBeGreaterThanOrEqual(0.95);
  });
});

describe('week simulation: a missed day leaves Doozer sulky but recoverable in one visit', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`day 4 missed (week ${seed})`, () => {
      const r = simulateWeek({ visitsPerDay: 4, skipDays: [4], jitterMinutes: 45, seed });
      const back = r.visits.find((v) => v.afterMissedDay);
      expect(back).toBeDefined();
      if (!back) return;

      // Sulky: something is low and Doozer is visibly not all right.
      const a = back.arrive.needs;
      expect(Math.min(a.tummy, a.fun, a.clean)).toBeLessThan(30);
      expect(back.arrive.wellbeing).toBeLessThan(50);
      expect(['hungry', 'bored', 'dirty', 'sleepy', 'asleep']).toContain(back.arrive.mood);

      // One visit later: fed, clean, amused.
      const l = back.leave.needs;
      expect(l.tummy).toBeGreaterThanOrEqual(50);
      expect(l.clean).toBe(100);
      expect(l.fun).toBeGreaterThanOrEqual(55);
      expect(['joyful', 'content', 'asleep']).toContain(back.leave.mood);
    });
  }

  it('is no worse after a week of neglect than after a day: the catch-up is capped', () => {
    const r = simulateWeek({ visitsPerDay: 0 });
    const last = r.samples.at(-1);
    expect(last).toBeDefined();
    // Then one visit:
    let now = (last?.t ?? 0) + 5 * 60_000;
    const brain = createBrain({ now: () => now, random: seeded(3) });
    now += 30 * 24 * 3_600_000;
    brain.tick();
    expect(brain.state.wellbeing).toBeLessThan(50);
    shortVisit(brain, true);
    const n = brain.state.needs;
    expect(n.tummy).toBeGreaterThanOrEqual(50);
    expect(n.clean).toBe(100);
    expect(n.fun).toBeGreaterThanOrEqual(55);
  });
});
