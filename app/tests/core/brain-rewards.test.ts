import { describe, expect, it } from 'vitest';
import { createBrain } from '../../src/core';
import { START, fakeClock, seeded } from './helpers';

// brain.rewards tells views what a session earns (DESIGN_SPEC.md 4.2). It must be the
// same table the brain pays out from, or the Card would promise one thing and give another.
describe('brain.rewards', () => {
  it('is the table in the spec', () => {
    const brain = createBrain({ now: () => START, random: seeded(1) });
    expect(brain.rewards).toEqual({ treats: { 15: 1, 25: 2, 50: 4 }, firstOfDay: 1 });
  });

  it('is what a completed session actually pays', () => {
    for (const minutes of [15, 25, 50] as const) {
      const clock = fakeClock(START);
      const brain = createBrain({ now: clock.now, random: seeded(2), debug: true });
      const paid: number[] = [];
      brain.on('focus', (event) => { if (event.type === 'complete') paid.push(event.treats); });
      brain.setFocusLength(minutes);
      brain.startFocus();
      brain.debug?.finishFocusNow();
      brain.startFocus();
      brain.debug?.finishFocusNow();
      expect(paid).toEqual([brain.rewards.treats[minutes] + brain.rewards.firstOfDay, brain.rewards.treats[minutes]]);
    }
  });

  it('cannot be changed by a view', () => {
    const brain = createBrain({ now: () => START, random: seeded(1) });
    expect(Object.isFrozen(brain.rewards)).toBe(true);
    expect(Object.isFrozen(brain.rewards.treats)).toBe(true);
  });
});
