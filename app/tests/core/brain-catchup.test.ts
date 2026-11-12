import { describe, expect, it } from 'vitest';
import type { Brain } from '../../src/core';
import { createBrain } from '../../src/core';
import { TUNING } from '../../src/core/tuning';
import { DAY, HOUR, MIN, SEC, START, exact, fakeClock, of, record, rig, seeded, type Rig } from './helpers';

/** A pet with a lot about to happen: nearly out of energy, a full bowl, mid-range needs. */
function busyPet(): Rig {
  const r = rig();
  r.debug.setNeeds({ tummy: 75, fun: 80, energy: 30, clean: 70 });
  r.brain.fillBowl();
  return r;
}

function expectSamePet(a: Brain, b: Brain): void {
  const x = exact(a);
  const y = exact(b);
  for (const key of ['tummy', 'fun', 'energy', 'clean']) {
    expect(x.needs[key], key).toBeCloseTo(y.needs[key] as number, 6);
  }
  expect(x.bond).toBeCloseTo(y.bond, 6);
  expect(x.bowl).toBe(y.bowl);
  expect(x.asleep).toBe(y.asleep);
  expect(a.state).toEqual(b.state);
}

describe('catch-up: one big step is the same as many small ones', () => {
  for (const hours of [1, 4, 11]) {
    it(`${hours} h closed  =  ${hours} h of one-second ticks  =  one tick after ${hours} h`, () => {
      const closed = busyPet().restart(hours * HOUR);

      const ticking = busyPet();
      ticking.live(hours * HOUR, SEC);

      const asleepMachine = busyPet();
      asleepMachine.pass(hours * HOUR);

      expectSamePet(closed.brain, ticking.brain);
      expectSamePet(asleepMachine.brain, ticking.brain);
    });
  }

  it('does not depend on how the time is cut up', () => {
    const reference = busyPet();
    reference.live(6 * HOUR, 250);

    for (const step of [7 * SEC, 61 * SEC, 13 * MIN, 95 * MIN]) {
      const other = busyPet();
      other.live(6 * HOUR, step);
      expectSamePet(other.brain, reference.brain);
    }
  });

  it('agrees across several restarts in a row', () => {
    const once = busyPet().restart(10 * HOUR);
    let hopping = busyPet();
    for (let i = 0; i < 10; i++) hopping = hopping.restart(HOUR);
    expectSamePet(hopping.brain, once.brain);
  });

  it('really did go through sleep, waking and the bowl on the way', () => {
    const r = busyPet();
    r.live(11 * HOUR, SEC);
    const kinds = of(r.events, 'action').map((a) => a.type);
    expect(kinds).toContain('sleep');
    expect(kinds).toContain('wake');
    expect(kinds.filter((k) => k === 'auto-eat')).toHaveLength(3);
  });
});

describe('catch-up: the twelve-hour cap', () => {
  it('simulates at most twelve hours, however long the gap', () => {
    const twelve = busyPet().restart(12 * HOUR);
    const thirteen = busyPet().restart(13 * HOUR);
    const week = busyPet().restart(7 * DAY);
    const decade = busyPet().restart(3650 * DAY);
    expectSamePet(thirteen.brain, twelve.brain);
    expectSamePet(week.brain, twelve.brain);
    expectSamePet(decade.brain, twelve.brain);
  });

  it('is not yet reached at eleven hours', () => {
    const eleven = exact(busyPet().restart(11 * HOUR).brain);
    const twelve = exact(busyPet().restart(12 * HOUR).brain);
    expect(eleven.needs.clean).not.toBeCloseTo(twelve.needs.clean as number, 3);
  });

  it('applies to a long gap between ticks too (the machine slept)', () => {
    const closed = busyPet().restart(3 * DAY);
    const sleptMachine = busyPet();
    sleptMachine.pass(3 * DAY);
    expectSamePet(sleptMachine.brain, closed.brain);
  });

  it('leaves a neglected Doozer sulky, not gone', () => {
    const r = rig().restart(30 * DAY);
    const s = r.brain.state;
    expect(['hungry', 'bored', 'dirty', 'sleepy', 'asleep', 'meh']).toContain(s.mood);
    expect(s.wellbeing).toBeLessThan(50);
    expect(s.name).toBe('Doozer');
  });
});

describe('catch-up: the away event', () => {
  it('fires on the first tick after being closed for more than 90 seconds', () => {
    const r = busyPet().restart(5 * HOUR);
    expect(r.events).toHaveLength(0); // nothing until the host ticks
    r.brain.tick();
    expect(of(r.events, 'away')).toEqual([{ seconds: 5 * 3600, ateFromBowl: 2, slept: true }]);
    expect(r.events[0]?.type).toBe('away');

    r.clear();
    r.pass(250);
    r.pass(250);
    expect(of(r.events, 'away')).toHaveLength(0); // once only
  });

  it('reports the real length of the gap even beyond the cap', () => {
    const r = rig().restart(3 * DAY);
    r.brain.tick();
    expect(of(r.events, 'away')[0]?.seconds).toBe(3 * 86_400);
  });

  it('does not fire for 90 seconds or less', () => {
    const r = rig().restart(90 * SEC);
    r.brain.tick();
    expect(of(r.events, 'away')).toHaveLength(0);
    // ...but the 90 seconds still passed.
    expect(exact(r.brain).needs.tummy).toBeLessThan(72);
  });

  it('does not fire for a brand new pet', () => {
    const r = rig();
    r.brain.tick();
    expect(r.events).toHaveLength(0);
  });

  it('fires again after a long gap between two ticks, without replaying what happened', () => {
    const r = busyPet();
    r.brain.tick();
    r.clear();
    r.pass(5 * HOUR);
    expect(of(r.events, 'away')).toEqual([{ seconds: 5 * 3600, ateFromBowl: 2, slept: true }]);
    expect(of(r.events, 'action')).toHaveLength(0);
    expect(of(r.events, 'need')).toHaveLength(0);
    expect(of(r.events, 'change')).toHaveLength(1);
  });

  it('does not hold start-up events back from someone who subscribes late', () => {
    const first = busyPet();
    const save = first.brain.serialize();
    first.clock.advance(5 * HOUR);
    const brain = createBrain({ save, now: first.clock.now, random: seeded(1) });
    // The host mounts a view, which subscribes, and only then starts ticking.
    const events = record(brain);
    brain.tick();
    expect(of(events, 'away')).toHaveLength(1);
  });

  it('does not announce needs that went low while away', () => {
    const r = rig().restart(11 * HOUR);
    r.brain.tick();
    r.live(MIN, SEC);
    expect(r.brain.state.needs.tummy).toBeLessThan(12);
    expect(of(r.events, 'need').filter((e) => e.need === 'tummy')).toHaveLength(0);
  });
});

describe('catch-up: clock changes', () => {
  it('ignores a clock that jumps backwards, then carries on from there', () => {
    const r = rig();
    r.live(10 * MIN);
    const before = exact(r.brain).needs;
    r.clock.advance(-3 * HOUR);
    expect(() => r.brain.tick()).not.toThrow();
    expect(exact(r.brain).needs).toEqual(before);
    expect((r.brain.serialize() as { lastSeen: number }).lastSeen).toBe(r.clock.now());

    r.live(HOUR);
    expect(exact(r.brain).needs.tummy).toBeCloseTo((before.tummy as number) - TUNING.drain.tummy, 6);
  });

  it('keeps a running session at the time it had left when the clock goes back', () => {
    const r = rig();
    r.brain.startFocus();
    r.live(10 * MIN);
    r.clock.advance(-HOUR); // someone fixed the system clock
    r.brain.tick();
    expect(r.brain.state.focus.remainingMs).toBe(15 * MIN);
    r.live(15 * MIN, SEC);
    expect(r.brain.state.focus.status).toBe('idle');
    expect(r.brain.state.sessionsCompleted).toBe(1);
  });

  it('loads a save that claims to be from the future without simulating anything', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 50 });
    const save = r.brain.serialize();
    const earlier = createBrain({ save, now: () => START - 2 * DAY, random: seeded(1) });
    expect(earlier.state.needs.tummy).toBe(50);
    expect((earlier.serialize() as { lastSeen: number }).lastSeen).toBe(START - 2 * DAY);
  });

  it('treats a huge forward jump like any long absence', () => {
    const r = busyPet();
    r.clock.set(START + 400 * DAY);
    expect(() => r.brain.tick()).not.toThrow();
    expectSamePet(r.brain, busyPet().restart(12 * HOUR).brain);
  });

  it('ignores a tick when the clock returns nonsense', () => {
    let now = START;
    const brain = createBrain({ now: () => now, random: seeded(1) });
    const before = brain.state;
    now = NaN;
    expect(() => brain.tick()).not.toThrow();
    expect(brain.state).toBe(before);
    now = START + MIN;
    brain.tick();
    expect((brain.serialize() as { lastSeen: number }).lastSeen).toBe(START + MIN);
  });
});

describe('catch-up: the debug time scale', () => {
  it('stretches live ticks: at 60, one real minute is one pet hour', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90, fun: 90, energy: 90, clean: 90 });
    r.debug.setTimeScale(60);
    r.live(MIN, 250);
    const n = exact(r.brain).needs;
    expect(n.tummy).toBeCloseTo(90 - TUNING.drain.tummy, 6);
    expect(n.energy).toBeCloseTo(90 - TUNING.drain.energy, 6);
  });

  it('does not speed up a focus session', () => {
    const r = rig();
    r.debug.setTimeScale(60);
    r.brain.startFocus();
    r.live(MIN, 250);
    expect(r.brain.state.focus.remainingMs).toBe(24 * MIN);
  });

  it('can stop pet time altogether', () => {
    const r = rig();
    r.debug.setTimeScale(0);
    const before = exact(r.brain).needs;
    r.live(10 * MIN, SEC);
    expect(exact(r.brain).needs).toEqual(before);
  });

  it('does not apply to time away', () => {
    const fast = rig({ clock: fakeClock() });
    fast.debug.setTimeScale(60);
    fast.pass(2 * HOUR); // a long gap: real speed
    const normal = rig({ clock: fakeClock() });
    normal.pass(2 * HOUR);
    expectSamePet(fast.brain, normal.brain);
  });
});

describe('debug: reset', () => {
  it('hatches a new Doozer but keeps the settings', () => {
    const r = rig();
    r.brain.setSetting('palette', 'butter');
    r.debug.setNeeds({ tummy: 3 });
    r.brain.startFocus();
    r.debug.finishFocusNow();
    r.clock.advance(HOUR);
    r.debug.reset();
    const s = r.brain.state;
    expect(s.needs).toEqual({ tummy: 72, fun: 64, energy: 80, clean: 88 });
    expect(s.sessionsCompleted).toBe(0);
    expect(s.treats).toBe(2);
    expect(s.bornAt).toBe(r.clock.now());
    expect(r.brain.settings.palette).toBe('butter');
  });

  it('addTreats respects the jar', () => {
    const r = rig();
    r.debug.addTreats(100);
    expect(r.brain.state.treats).toBe(20);
    r.debug.addTreats(-100);
    expect(r.brain.state.treats).toBe(0);
  });
});
