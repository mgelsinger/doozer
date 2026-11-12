// The fake brain is only a stand-in, but the kit is judged against it, so it has to
// keep the promises the contract makes. (The real brain's tests are Phase 4's.)

import { describe, expect, it } from 'vitest';
import type { BrainEvents } from '../../core/contract';
import { createFakeBrain } from './fake-brain';

const at = (start = 1_700_000_000_000) => {
  let t = start;
  return { now: () => t, pass: (ms: number) => { t += ms; } };
};

describe('fake brain', () => {
  it('returns the same state object until something changes', () => {
    const brain = createFakeBrain();
    const before = brain.state;
    expect(brain.state).toBe(before);
    brain.pet();
    expect(brain.state).not.toBe(before);
  });

  it('fires change once per action, after the state is updated', () => {
    const brain = createFakeBrain({ preset: { needs: { tummy: 40 } } });
    const seen: number[] = [];
    brain.on('change', () => seen.push(brain.state.needs.tummy));
    brain.feed();
    expect(seen).toEqual([72]);
  });

  it('refuses as the contract says, with an event and no change', () => {
    const cases: [Parameters<typeof createFakeBrain>[0], (b: ReturnType<typeof createFakeBrain>) => unknown, string][] = [
      [{ preset: { asleep: true } }, (b) => b.feed(), 'asleep'],
      [{ preset: { needs: { tummy: 95 } } }, (b) => b.feed(), 'full'],
      [{ preset: { needs: { energy: 9 } } }, (b) => b.play(), 'tired'],
      [{ preset: { treats: 0 } }, (b) => b.giveTreat(), 'no-treats'],
      [{ preset: { needs: { energy: 93 } } }, (b) => b.sleep(), 'not-sleepy'],
      [{ preset: { bowl: 3 } }, (b) => b.fillBowl(), 'bowl-full'],
      [{ preset: { focus: { status: 'paused' } } }, (b) => b.startFocus(), 'focus-running'],
      [{ preset: { asleep: true } }, (b) => b.startFocus(), 'asleep'],
    ];
    for (const [options, run, reason] of cases) {
      const brain = createFakeBrain(options);
      const refusals: BrainEvents['refuse'][] = [];
      let changes = 0;
      brain.on('refuse', (event) => refusals.push(event));
      brain.on('change', () => { changes += 1; });
      expect(run(brain)).toEqual({ ok: false, reason });
      expect(refusals.map((event) => event.reason)).toEqual([reason]);
      expect(changes).toBe(0);
    }
  });

  it('petting is never refused, even asleep', () => {
    const brain = createFakeBrain({ preset: { asleep: true } });
    expect(brain.pet()).toEqual({ ok: true });
  });

  it('needs drain with time and the bowl covers hunger', () => {
    const clock = at();
    const brain = createFakeBrain({ now: clock.now, preset: { needs: { tummy: 75, fun: 80, energy: 80, clean: 80 }, bowl: 2 } });
    const ate: string[] = [];
    brain.on('action', (event) => { if (event.type === 'auto-eat') ate.push(event.food); });
    clock.pass(3_600_000);
    brain.tick();
    expect(ate.length).toBe(1);
    expect(brain.state.bowl).toBe(1);
    expect(brain.state.needs.fun).toBeCloseTo(54, 0);
  });

  it('runs a focus session by the clock, rewards it, and goes quiet meanwhile', () => {
    const clock = at();
    const brain = createFakeBrain({ now: clock.now, preset: { treats: 0 } });
    const events: BrainEvents['focus'][] = [];
    brain.on('focus', (event) => events.push(event));
    brain.setFocusLength(15);
    expect(brain.startFocus()).toEqual({ ok: true });
    expect(brain.state.quiet).toBe(true);
    brain.setFocusLength(50);                       // ignored while running
    expect(brain.state.focus.minutes).toBe(15);
    clock.pass(5 * 60_000);
    brain.tick();
    expect(brain.state.focus.remainingMs).toBe(10 * 60_000);
    expect(brain.state.focus.progress).toBeCloseTo(1 / 3, 5);
    brain.pauseFocus();
    expect(brain.state.quiet).toBe(false);
    clock.pass(60 * 60_000);
    brain.tick();
    expect(brain.state.focus.remainingMs).toBe(10 * 60_000);   // paused time does not count
    brain.resumeFocus();
    clock.pass(10 * 60_000);
    brain.tick();
    expect(brain.state.focus.status).toBe('idle');
    expect(brain.state.treats).toBe(2);              // 1 for 15 minutes + 1 first of the day
    expect(brain.state.streak).toEqual({ current: 1, best: 1 });
    expect(brain.state.unlocked).toContain('cookie');
    expect(events.map((event) => event.type)).toEqual(['start', 'pause', 'resume', 'complete']);
  });

  it('stopping early gives nothing and costs nothing', () => {
    const brain = createFakeBrain({ preset: { treats: 3, focus: { status: 'running', elapsedMs: 600_000 } } });
    brain.stopFocus();
    expect(brain.state.treats).toBe(3);
    expect(brain.state.sessionsCompleted).toBe(0);
    expect(brain.state.focus.status).toBe('idle');
  });

  it('settings change and announce themselves', () => {
    const brain = createFakeBrain();
    const keys: string[] = [];
    brain.on('settings', ({ key }) => keys.push(key));
    brain.setSetting('palette', 'sky');
    brain.setSetting('palette', 'sky');              // no change, no event
    brain.setSetting('sound', true);
    expect(keys).toEqual(['palette', 'sound']);
    expect(brain.settings.palette).toBe('sky');
  });

  it('an unsubscribed handler hears nothing more', () => {
    const brain = createFakeBrain();
    let heard = 0;
    const off = brain.on('change', () => { heard += 1; });
    brain.pet();
    off();
    brain.pet();
    expect(heard).toBe(1);
  });
});
