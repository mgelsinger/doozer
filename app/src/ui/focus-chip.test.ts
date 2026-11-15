// @vitest-environment happy-dom
// The focus chip (DESIGN_SPEC.md 4.6): the time left in a session, to the second for someone
// and in whole minutes for nobody.

import { describe, expect, it } from 'vitest';
import { createBrain } from '../core';
import { START, fakeClock } from '../../tests/core/helpers';
import { createFocusChip } from './focus-chip';

describe('the focus chip', () => {
  const chipFor = (precise?: () => boolean) => {
    const clock = fakeClock(START);
    const brain = createBrain({ now: clock.now, debug: true });
    const chip = createFocusChip(brain, precise ? { precise } : {});
    const text = (): string => chip.el.querySelector('[role="timer"]')?.textContent ?? '';
    return { clock, brain, chip, text };
  };

  it('counts to the second unless told that nobody is looking', () => {
    const { brain, clock, text } = chipFor();
    brain.startFocus();
    expect(text()).toBe('25:00');
    clock.advance(1000);
    brain.tick();
    expect(text()).toBe('24:59');
  });

  it('with nobody looking it counts in minutes, and changes once a minute', () => {
    let watched = false;
    const { brain, clock, chip, text } = chipFor(() => watched);
    brain.startFocus();
    expect(text()).toBe('25 min');
    let changes = 0;
    let shown = text();
    for (let i = 0; i < 120; i++) {
      clock.advance(1000);
      brain.tick();
      if (text() !== shown) { changes++; shown = text(); }
    }
    expect(text()).toBe('23 min');
    expect(changes).toBe(2);
    // Someone arrives: seconds, at once.
    watched = true;
    chip.refresh();
    expect(text()).toBe('23:00');
    clock.advance(1000);
    brain.tick();
    expect(text()).toBe('22:59');
    // And leaves again.
    watched = false;
    chip.refresh();
    expect(text()).toBe('23 min');
    chip.destroy();
  });

  it('a paused session shows exactly where it stopped, and the last minute is counted in seconds', () => {
    const { brain, clock, text } = chipFor(() => false);
    brain.startFocus();
    clock.advance(4 * 60_000 + 30_000);
    brain.tick();
    expect(text()).toBe('21 min');
    brain.pauseFocus();
    expect(text()).toBe('20:30');
    brain.resumeFocus();
    clock.advance(19 * 60_000 + 45_000);
    brain.tick();
    expect(text()).toBe('00:45');
  });
});
