import { describe, expect, it } from 'vitest';
import type { Mood, NeedKey } from '../../src/core';
import { TUNING } from '../../src/core/tuning';
import { DAY, HOUR, MIN, SEC, exact, of, rig } from './helpers';

const d = TUNING.drain;

describe('needs over time', () => {
  it('drain at the tuned rates while awake', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90, fun: 90, energy: 90, clean: 90 });
    r.live(HOUR);
    const n = exact(r.brain).needs;
    expect(n.tummy).toBeCloseTo(90 - d.tummy, 6);
    expect(n.fun).toBeCloseTo(90 - d.fun, 6);
    expect(n.energy).toBeCloseTo(90 - d.energy, 6);
    expect(n.clean).toBeCloseTo(90 - d.clean, 6);
  });

  it('while asleep: energy +60 an hour, the others at a fraction', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90, fun: 90, energy: 20, clean: 90 });
    r.brain.sleep();
    r.live(HOUR);
    const n = exact(r.brain).needs;
    expect(n.energy).toBeCloseTo(80, 6);
    expect(n.tummy).toBeCloseTo(90 - d.tummy * TUNING.asleepFactor.tummy, 6);
    expect(n.fun).toBeCloseTo(90 - d.fun * TUNING.asleepFactor.fun, 6);
    expect(n.clean).toBeCloseTo(90 - d.clean * TUNING.asleepFactor.clean, 6);
    expect(TUNING.asleepFactor.tummy).toBeLessThan(1);
    expect(TUNING.asleepFactor.fun).toBeLessThan(1);
    expect(TUNING.asleepFactor.clean).toBeLessThan(1);
  });

  it('shows needs as whole numbers', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 50 });
    r.live(MIN);
    expect(exact(r.brain).needs.tummy).toBeCloseTo(50 - d.tummy / 60, 6); // 49.77
    expect(r.brain.state.needs.tummy).toBe(50);
    r.live(2 * MIN);
    expect(r.brain.state.needs.tummy).toBe(49); // 49.3
    for (const value of Object.values(r.brain.state.needs)) expect(Number.isInteger(value)).toBe(true);
  });

  it('never leaves 0..100, and Doozer never dies', () => {
    const r = rig();
    for (let day = 0; day < 30; day++) r.pass(DAY);
    const s = r.brain.state;
    for (const value of Object.values(s.needs)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    expect(s.name).toBe('Doozer');
    // One visit brings it back.
    if (s.asleep) r.brain.wake();
    r.brain.feed();
    r.brain.feed();
    r.brain.feed();
    r.brain.wash();
    r.debug.setNeeds({ energy: 80 });
    r.brain.play();
    r.brain.play();
    r.brain.play();
    expect(['joyful', 'content']).toContain(r.brain.state.mood);
  });
});

describe('thresholds and need events', () => {
  it('fires need once on crossing below 30 (low) and once below 12 (urgent)', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 31, fun: 90, energy: 90, clean: 90 });
    r.clear();
    r.live(8 * MIN); // 14 an hour: nearly two points in eight minutes
    expect(r.brain.state.needs.tummy).toBe(29);
    expect(of(r.events, 'need')).toEqual([{ need: 'tummy', level: 'low' }]);

    r.live(30 * MIN);
    expect(of(r.events, 'need')).toHaveLength(1); // still low: nothing new

    r.debug.setNeeds({ tummy: 13 });
    r.clear();
    r.live(8 * MIN);
    expect(r.brain.state.needs.tummy).toBe(11);
    expect(of(r.events, 'need')).toEqual([{ need: 'tummy', level: 'urgent' }]);
  });

  it('treats exactly 30 and exactly 12 as not yet low / urgent', () => {
    const r = rig();
    r.debug.setNeeds({ fun: 30 });
    expect(of(r.events, 'need')).toHaveLength(0);
    expect(r.brain.state.mood).not.toBe('bored');
    r.debug.setNeeds({ fun: 29 });
    expect(of(r.events, 'need')).toEqual([{ need: 'fun', level: 'low' }]);
    r.clear();
    r.debug.setNeeds({ fun: 12 });
    expect(of(r.events, 'need')).toHaveLength(0);
    r.debug.setNeeds({ fun: 11 });
    expect(of(r.events, 'need')).toEqual([{ need: 'fun', level: 'urgent' }]);
  });

  it('says urgent once when a need drops straight past low', () => {
    const r = rig();
    r.debug.setNeeds({ clean: 3 });
    expect(of(r.events, 'need')).toEqual([{ need: 'clean', level: 'urgent' }]);
  });

  it('fires again after the need has recovered and dropped a second time', () => {
    const r = rig();
    r.debug.setNeeds({ clean: 20 });
    r.brain.wash();
    r.clear();
    r.debug.setNeeds({ clean: 20 });
    expect(of(r.events, 'need')).toEqual([{ need: 'clean', level: 'low' }]);
  });

  it('fires one event per need', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 5, fun: 20, energy: 50, clean: 29 });
    const needs = of(r.events, 'need');
    expect(needs).toEqual([
      { need: 'tummy', level: 'urgent' },
      { need: 'fun', level: 'low' },
      { need: 'clean', level: 'low' },
    ]);
  });

  it('holds need events back while asleep and says them on waking', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 32, energy: 10 });
    r.brain.sleep();
    r.clear();
    r.live(40 * MIN); // tummy drains at half speed: 32 -> 27
    expect(r.brain.state.needs.tummy).toBeLessThan(30);
    expect(of(r.events, 'need')).toHaveLength(0);
    r.brain.wake();
    expect(of(r.events, 'need')).toEqual([{ need: 'tummy', level: 'low' }]);
  });
});

describe('mood', () => {
  const cases: [string, Partial<Record<NeedKey, number>>, Mood][] = [
    ['joyful above an average of 78', { tummy: 80, fun: 80, energy: 80, clean: 76 }, 'joyful'],
    ['content at an average of exactly 78', { tummy: 78, fun: 78, energy: 78, clean: 78 }, 'content'],
    ['content above 50', { tummy: 51, fun: 51, energy: 51, clean: 51 }, 'content'],
    ['meh at 50 and below', { tummy: 50, fun: 50, energy: 50, clean: 50 }, 'meh'],
    ['hungry when tummy is low', { tummy: 29, fun: 90, energy: 90, clean: 90 }, 'hungry'],
    ['bored when fun is low', { tummy: 90, fun: 29, energy: 90, clean: 90 }, 'bored'],
    ['sleepy when energy is low', { tummy: 90, fun: 90, energy: 29, clean: 90 }, 'sleepy'],
    ['dirty when clean is low', { tummy: 90, fun: 90, energy: 90, clean: 29 }, 'dirty'],
    ['the lowest need wins when several are low', { tummy: 20, fun: 10, energy: 25, clean: 15 }, 'bored'],
  ];
  for (const [name, needs, mood] of cases) {
    it(name, () => {
      const r = rig();
      r.debug.setNeeds(needs);
      expect(r.brain.state.mood).toBe(mood);
    });
  }

  it('is asleep whatever the needs are', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 5, energy: 50 });
    r.brain.sleep();
    expect(r.brain.state.mood).toBe('asleep');
  });

  it('reports wellbeing and the lowest need', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 40, fun: 60, energy: 80, clean: 100 });
    expect(r.brain.state.wellbeing).toBe(70);
    expect(r.brain.state.lowest).toEqual({ key: 'tummy', value: 40 });
  });

  it('fires a mood event with where it came from', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90, fun: 90, energy: 90, clean: 90 });
    r.clear();
    r.debug.setNeeds({ fun: 20 });
    expect(of(r.events, 'mood')).toEqual([{ mood: 'bored', from: 'joyful' }]);
  });
});

describe('falling asleep and waking by itself', () => {
  it('falls asleep when energy reaches 4', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90, fun: 90, energy: 5, clean: 90 });
    r.clear();
    r.live(6 * MIN, 10 * SEC); // 8 an hour: just under a point
    expect(r.brain.state.asleep).toBe(false);
    r.live(3 * MIN, 10 * SEC);
    expect(r.brain.state.asleep).toBe(true);
    expect(of(r.events, 'action')).toEqual([{ type: 'sleep', why: 'exhausted' }]);
    expect(of(r.events, 'mood').at(-1)).toEqual({ mood: 'asleep', from: 'sleepy' });
  });

  it('wakes by itself at 100', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90, fun: 90, energy: 40, clean: 90 });
    r.brain.sleep();
    r.clear();
    r.live(59 * MIN);
    expect(r.brain.state.asleep).toBe(true);
    r.live(2 * MIN);
    expect(r.brain.state.asleep).toBe(false);
    expect(of(r.events, 'action')).toEqual([{ type: 'wake', why: 'rested' }]);
    expect(r.brain.state.needs.energy).toBeGreaterThanOrEqual(99);
  });

  it('cycles on its own when nobody is there', () => {
    const r = rig();
    r.debug.setNeeds({ energy: 100 });
    r.clear();
    r.live(15 * HOUR, MIN);
    const selfActions = of(r.events, 'action').filter((a) => a.type === 'sleep' || a.type === 'wake');
    expect(selfActions).toEqual([
      { type: 'sleep', why: 'exhausted' }, // 96 points at 8 an hour: after 12 h
      { type: 'wake', why: 'rested' }, // 96 points at 60 an hour: 1 h 36 later
    ]);
  });
});

describe('bond (hidden)', () => {
  it('rises slowly while Doozer is well and with each interaction', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90, fun: 90, energy: 90, clean: 90 });
    const before = exact(r.brain).bond;
    r.live(HOUR);
    const afterAnHour = exact(r.brain).bond;
    expect(afterAnHour).toBeCloseTo(before + TUNING.bondGainPerHour, 6);
    r.brain.pet();
    expect(exact(r.brain).bond).toBeGreaterThan(afterAnHour);
  });

  it('falls only while a need is urgent', () => {
    const low = rig();
    low.debug.setNeeds({ tummy: 20, fun: 20, energy: 60, clean: 20 }); // low, not urgent
    const lowBefore = exact(low.brain).bond;
    low.live(30 * MIN);
    expect(exact(low.brain).bond).toBe(lowBefore);

    const urgent = rig();
    urgent.debug.setNeeds({ tummy: 5, fun: 90, energy: 90, clean: 90 });
    const urgentBefore = exact(urgent.brain).bond;
    urgent.live(HOUR);
    expect(exact(urgent.brain).bond).toBeCloseTo(urgentBefore - TUNING.bondLossPerHour, 6);
  });
});

describe('the state snapshot', () => {
  it('stays the same object until something visible changes', () => {
    const r = rig();
    const first = r.brain.state;
    r.clear();
    r.pass(250);
    r.pass(250);
    expect(r.brain.state).toBe(first);
    expect(r.events).toHaveLength(0);
    r.live(10 * MIN);
    expect(r.brain.state).not.toBe(first);
  });

  it('changes about once a minute when nothing is happening', () => {
    const r = rig();
    r.clear();
    r.live(HOUR, 250);
    const changes = of(r.events, 'change').length;
    expect(changes).toBeGreaterThan(20);
    expect(changes).toBeLessThan(40); // 32.5 points an hour between the four needs
  });

  it('is frozen', () => {
    const { brain } = rig();
    expect(Object.isFrozen(brain.state)).toBe(true);
    expect(Object.isFrozen(brain.state.needs)).toBe(true);
    expect(Object.isFrozen(brain.state.unlocked)).toBe(true);
    expect(() => {
      (brain.state.needs as Record<string, number>).tummy = 0;
    }).toThrow();
  });

  it('fires change at most once per tick', () => {
    const r = rig();
    r.debug.setNeeds({ energy: 4.5, tummy: 70.5 });
    r.brain.fillBowl();
    r.clear();
    r.pass(80 * SEC); // eats, gets sleepier: several things in one tick
    expect(of(r.events, 'change')).toHaveLength(1);
  });
});
