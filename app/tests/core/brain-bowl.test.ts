import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/core/tuning';
import { HOUR, MIN, SEC, exact, of, rig } from './helpers';

describe('the bowl while Doozer is awake', () => {
  it('is eaten from as soon as it is filled, if tummy is below 70', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 60 });
    r.clear();
    r.brain.fillBowl();
    expect(r.brain.state.bowl).toBe(2);
    expect(r.brain.state.needs.tummy).toBe(92);
    const actions = of(r.events, 'action');
    expect(actions.map((a) => a.type)).toEqual(['fill-bowl', 'auto-eat']);
    const eaten = actions[1];
    expect(['apple', 'bread', 'carrot']).toContain(eaten?.type === 'auto-eat' ? eaten.food : '');
  });

  it('is left alone at 70 and above', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 70 });
    r.brain.fillBowl();
    expect(r.brain.state.bowl).toBe(3);
    expect(r.brain.state.needs.tummy).toBe(70);
  });

  it('is eaten from the moment tummy drops below 70', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 71, energy: 90 });
    r.brain.fillBowl();
    r.clear();
    r.live(3 * MIN, SEC); // 14 an hour: 70.3 after three minutes
    expect(r.brain.state.bowl).toBe(3);
    r.live(2 * MIN, SEC);
    expect(r.brain.state.bowl).toBe(2);
    expect(of(r.events, 'action').map((a) => a.type)).toEqual(['auto-eat']);
    expect(exact(r.brain).needs.tummy).toBeGreaterThan(100 - 1);
  });

  it('feeds a very hungry Doozer one serving at a time, a few minutes apart', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 0, energy: 90 });
    r.brain.fillBowl();
    expect(r.brain.state.bowl).toBe(2);
    expect(r.brain.state.needs.tummy).toBe(32);

    r.live((TUNING.bowlPaceSeconds - 5) * SEC, SEC);
    expect(r.brain.state.bowl).toBe(2);
    r.live(10 * SEC, SEC);
    expect(r.brain.state.bowl).toBe(1);

    r.live(TUNING.bowlPaceSeconds * SEC, SEC);
    expect(r.brain.state.bowl).toBe(0);
    expect(r.brain.state.needs.tummy).toBeGreaterThan(90);
  });

  it('keeps Doozer fed for hours, where an empty bowl would not', () => {
    const fed = rig();
    const unfed = rig();
    for (const r of [fed, unfed]) r.debug.setNeeds({ tummy: 90, energy: 100 });
    fed.brain.fillBowl();
    fed.live(8 * HOUR, MIN);
    unfed.live(8 * HOUR, MIN);
    expect(fed.brain.state.bowl).toBe(0);
    expect(fed.brain.state.needs.tummy).toBeGreaterThan(50);
    expect(unfed.brain.state.needs.tummy).toBe(0);
    expect(of(fed.events, 'action').filter((a) => a.type === 'auto-eat')).toHaveLength(3);
  });

  it('still feeds Doozer during a focus session', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 71, energy: 90 });
    r.brain.fillBowl();
    r.brain.startFocus();
    r.live(10 * MIN);
    expect(r.brain.state.quiet).toBe(true);
    expect(r.brain.state.bowl).toBe(2);
  });
});

describe('the bowl while Doozer is asleep', () => {
  it('is not touched, however hungry Doozer is', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 40, energy: 10 });
    r.brain.sleep();
    r.brain.fillBowl();
    r.live(HOUR);
    expect(r.brain.state.asleep).toBe(true);
    expect(r.brain.state.bowl).toBe(3);
  });

  it('is the first thing Doozer goes to on waking', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 40, energy: 10 });
    r.brain.sleep();
    r.brain.fillBowl();
    r.clear();
    r.brain.wake();
    expect(r.brain.state.bowl).toBe(2);
    expect(of(r.events, 'action').map((a) => a.type)).toEqual(['wake', 'auto-eat']);
  });

  it('is eaten from when Doozer wakes by itself', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 60, energy: 70 });
    r.brain.sleep();
    r.brain.fillBowl();
    r.clear();
    r.live(31 * MIN);
    expect(r.brain.state.asleep).toBe(false);
    expect(r.brain.state.bowl).toBe(2);
    expect(of(r.events, 'action').map((a) => a.type)).toEqual(['wake', 'auto-eat']);
  });
});

describe('the bowl while the app is closed', () => {
  it('feeds Doozer during the offline catch-up', () => {
    const fed = rig();
    const unfed = rig();
    for (const r of [fed, unfed]) r.debug.setNeeds({ tummy: 90, fun: 90, energy: 100, clean: 90 });
    fed.brain.fillBowl();

    const fedLater = fed.restart(9 * HOUR);
    const unfedLater = unfed.restart(9 * HOUR);

    expect(fedLater.brain.state.bowl).toBe(0);
    expect(unfedLater.brain.state.needs.tummy).toBe(0);
    // Each serving is eaten at 70 and fills Doozer to 100, so it is worth 30:
    // 90 + 3 x 30 - 9 h of draining.
    expect(exact(fedLater.brain).needs.tummy).toBeCloseTo(90 + 3 * 30 - 9 * TUNING.drain.tummy, 6);
  });

  it('reports how many servings were eaten in the away event', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90, energy: 100 });
    r.brain.fillBowl();
    const later = r.restart(4 * HOUR);
    later.brain.tick();
    expect(of(later.events, 'away')).toEqual([{ seconds: 4 * 3600, ateFromBowl: 2, slept: false }]);
    expect(later.brain.state.bowl).toBe(1);
  });

  it('does not feed a Doozer that sleeps through the whole absence', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 50, energy: 10 });
    r.brain.sleep();
    r.brain.fillBowl();
    const later = r.restart(HOUR);
    expect(later.brain.state.asleep).toBe(true);
    expect(later.brain.state.bowl).toBe(3);
  });

  it('carries the bowl across a restart untouched when no time has passed', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90 });
    r.brain.fillBowl();
    expect(r.restart().brain.state.bowl).toBe(3);
  });
});
