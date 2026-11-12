import { describe, expect, it } from 'vitest';
import type { BrainEvents, FocusMinutes, UnlockId } from '../../src/core';
import { UNLOCK_TABLE } from '../../src/core/tuning';
import { DAY, HOUR, MIN, SEC, at, fakeClock, of, rig, type Rig } from './helpers';

type Complete = Extract<BrainEvents['focus'], { type: 'complete' }>;

function completions(r: Rig): Complete[] {
  return of(r.events, 'focus').filter((e): e is Complete => e.type === 'complete');
}

/** Run one whole session of the current length, live. */
function runSession(r: Rig, minutes: FocusMinutes = 25): void {
  // Days pass in some of these tests; make sure Doozer is up and not about to nod off.
  r.brain.wake();
  r.debug.setNeeds({ energy: 90 });
  r.brain.setFocusLength(minutes);
  expect(r.brain.startFocus()).toEqual({ ok: true });
  r.live(minutes * MIN, 10 * SEC);
}

function quickSessions(r: Rig, count: number): void {
  for (let i = 0; i < count; i++) {
    r.brain.startFocus();
    r.debug.finishFocusNow();
  }
}

describe('focus: choosing a length', () => {
  it('offers 15, 25 and 50 minutes, 25 by default', () => {
    const r = rig();
    expect(r.brain.state.focus).toEqual({ status: 'idle', minutes: 25, remainingMs: 25 * MIN, progress: 0 });
    r.brain.setFocusLength(15);
    expect(r.brain.state.focus).toEqual({ status: 'idle', minutes: 15, remainingMs: 15 * MIN, progress: 0 });
    r.brain.setFocusLength(50);
    expect(r.brain.state.focus.remainingMs).toBe(50 * MIN);
  });

  it('ignores a length that is not on offer', () => {
    const r = rig();
    r.brain.setFocusLength(30 as FocusMinutes);
    expect(r.brain.state.focus.minutes).toBe(25);
  });

  it('ignores a change of length while a session is running or paused', () => {
    const r = rig();
    r.brain.startFocus();
    r.brain.setFocusLength(50);
    expect(r.brain.state.focus.minutes).toBe(25);
    r.brain.pauseFocus();
    r.brain.setFocusLength(15);
    expect(r.brain.state.focus.minutes).toBe(25);
  });
});

describe('focus: start, pause, resume, stop', () => {
  it('starts, counts down in whole seconds and reports progress', () => {
    const r = rig();
    expect(r.brain.startFocus()).toEqual({ ok: true });
    expect(of(r.events, 'focus')).toEqual([{ type: 'start' }]);
    expect(r.brain.state.focus).toEqual({ status: 'running', minutes: 25, remainingMs: 25 * MIN, progress: 0 });
    expect(r.brain.state.quiet).toBe(true);

    r.pass(250);
    expect(r.brain.state.focus.remainingMs).toBe(25 * MIN); // 24:59.75 reads 25:00
    r.pass(750);
    expect(r.brain.state.focus.remainingMs).toBe(25 * MIN - SEC);

    r.live(5 * MIN - SEC, SEC);
    expect(r.brain.state.focus.remainingMs).toBe(20 * MIN);
    expect(r.brain.state.focus.progress).toBeCloseTo(0.2, 9);
  });

  it('changes the snapshot once a second while running, not on every tick', () => {
    const r = rig();
    r.brain.startFocus();
    r.clear();
    r.live(10 * SEC, 250);
    expect(of(r.events, 'change')).toHaveLength(10);
  });

  it("refuses to start as 'focus-running' while a session is running or paused", () => {
    const r = rig();
    r.brain.startFocus();
    r.clear();
    expect(r.brain.startFocus()).toEqual({ ok: false, reason: 'focus-running' });
    expect(of(r.events, 'refuse')).toEqual([{ action: 'startFocus', reason: 'focus-running' }]);
    r.brain.pauseFocus();
    expect(r.brain.startFocus()).toEqual({ ok: false, reason: 'focus-running' });
  });

  it("refuses to start as 'asleep' while Doozer sleeps", () => {
    const r = rig();
    r.brain.sleep();
    r.clear();
    expect(r.brain.startFocus()).toEqual({ ok: false, reason: 'asleep' });
    expect(of(r.events, 'refuse')).toEqual([{ action: 'startFocus', reason: 'asleep' }]);
    expect(r.brain.state.focus.status).toBe('idle');
  });

  it('pauses: the clock stops and Doozer is no longer quiet', () => {
    const r = rig();
    r.brain.startFocus();
    r.live(10 * MIN);
    r.clear();
    r.brain.pauseFocus();
    expect(of(r.events, 'focus')).toEqual([{ type: 'pause' }]);
    expect(r.brain.state.focus.status).toBe('paused');
    expect(r.brain.state.quiet).toBe(false);
    r.live(HOUR, MIN);
    expect(r.brain.state.focus.remainingMs).toBe(15 * MIN);
    expect(r.brain.state.focus.progress).toBeCloseTo(0.4, 9);
  });

  it('resumes from where it stopped and finishes after the full running time', () => {
    const r = rig();
    r.brain.startFocus();
    r.live(10 * MIN);
    r.brain.pauseFocus();
    r.live(HOUR, MIN);
    r.clear();
    r.brain.resumeFocus();
    expect(of(r.events, 'focus')).toEqual([{ type: 'resume' }]);
    expect(r.brain.state.quiet).toBe(true);
    r.live(15 * MIN - SEC, SEC);
    expect(r.brain.state.focus.status).toBe('running');
    r.live(SEC, SEC);
    expect(r.brain.state.focus.status).toBe('idle');
    expect(completions(r)).toHaveLength(1);
  });

  it('stops early with no reward and no penalty', () => {
    const r = rig();
    const before = r.brain.state;
    r.brain.startFocus();
    r.live(20 * MIN);
    r.clear();
    r.brain.stopFocus();
    expect(of(r.events, 'focus')).toEqual([{ type: 'stop' }]);
    const s = r.brain.state;
    expect(s.focus).toEqual({ status: 'idle', minutes: 25, remainingMs: 25 * MIN, progress: 0 });
    expect(s.treats).toBe(before.treats);
    expect(s.streak).toEqual({ current: 0, best: 0 });
    expect(s.sessionsCompleted).toBe(0);
    expect(s.quiet).toBe(false);
    // ...and a stopped session never completes later.
    r.live(HOUR, MIN);
    expect(completions(r)).toHaveLength(0);
  });

  it('ignores pause, resume and stop when there is nothing to act on', () => {
    const r = rig();
    r.brain.pauseFocus();
    r.brain.resumeFocus();
    r.brain.stopFocus();
    expect(r.events).toHaveLength(0);
    r.brain.startFocus();
    r.clear();
    r.brain.resumeFocus(); // not paused
    expect(of(r.events, 'focus')).toHaveLength(0);
  });
});

describe('focus: rewards', () => {
  it('pays 1, 2 and 4 treats for 15, 25 and 50 minutes, plus 1 for the first of the day', () => {
    const r = rig();
    r.brain.giveTreat();
    r.brain.giveTreat(); // empty the welcome gift
    runSession(r, 15);
    runSession(r, 15);
    runSession(r, 25);
    runSession(r, 50);
    expect(completions(r).map((c) => c.treats)).toEqual([1 + 1, 1, 2, 4]);
    expect(r.brain.state.treats).toBe(9);
  });

  it('pays the first-of-the-day bonus again the next day', () => {
    const r = rig({ clock: fakeClock(at(2026, 11, 11, 9)) });
    runSession(r, 25);
    r.live(DAY, 30 * MIN);
    runSession(r, 25);
    expect(completions(r).map((c) => c.treats)).toEqual([3, 3]);
  });

  it('lands the treats in the jar and returns to idle, no longer quiet', () => {
    const r = rig();
    runSession(r, 25);
    const s = r.brain.state;
    expect(s.treats).toBe(2 + 3);
    expect(s.focus).toEqual({ status: 'idle', minutes: 25, remainingMs: 25 * MIN, progress: 0 });
    expect(s.quiet).toBe(false);
    expect(s.sessionsCompleted).toBe(1);
  });

  it('never fills the jar past 20, but still says what was earned', () => {
    const r = rig();
    r.debug.addTreats(17); // 19 in the jar
    runSession(r, 50);
    expect(r.brain.state.treats).toBe(20);
    expect(completions(r)[0]?.treats).toBe(5);
  });

  it('counts sessions for life', () => {
    const r = rig();
    quickSessions(r, 7);
    expect(r.brain.state.sessionsCompleted).toBe(7);
    expect(r.restart().brain.state.sessionsCompleted).toBe(7);
  });
});

describe('focus: manners', () => {
  it('is quiet only while running', () => {
    const r = rig();
    expect(r.brain.state.quiet).toBe(false);
    r.brain.startFocus();
    expect(r.brain.state.quiet).toBe(true);
    r.brain.pauseFocus();
    expect(r.brain.state.quiet).toBe(false);
    r.brain.resumeFocus();
    expect(r.brain.state.quiet).toBe(true);
    r.brain.stopFocus();
    expect(r.brain.state.quiet).toBe(false);
  });

  it('keeps draining needs and still changes mood, but holds need events until the session ends', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 32, fun: 90, energy: 90, clean: 90 });
    r.brain.startFocus();
    r.clear();
    r.live(24 * MIN, 10 * SEC); // tummy 32 -> 26
    expect(r.brain.state.needs.tummy).toBe(26);
    expect(r.brain.state.mood).toBe('hungry');
    expect(of(r.events, 'mood')).toEqual([{ mood: 'hungry', from: 'content' }]);
    expect(of(r.events, 'need')).toHaveLength(0);

    r.live(MIN, 10 * SEC);
    const order = r.events.filter((e) => e.type === 'focus' || e.type === 'need').map((e) => e.type);
    expect(order).toEqual(['focus', 'need']);
    expect(of(r.events, 'need')).toEqual([{ need: 'tummy', level: 'low' }]);
  });

  it('lets Doozer doze off mid-session; the session still completes', () => {
    const r = rig();
    r.debug.setNeeds({ energy: 5 });
    r.brain.startFocus();
    r.live(25 * MIN, 10 * SEC);
    expect(completions(r)).toHaveLength(1);
    expect(r.brain.state.asleep).toBe(true);
  });
});

describe('focus: a session that spans a restart', () => {
  it('is still running, with the right time left, after serialize and restore', () => {
    const r = rig();
    r.brain.startFocus();
    r.live(10 * MIN);
    const later = r.restart(5 * MIN);
    expect(later.brain.state.focus.status).toBe('running');
    expect(later.brain.state.focus.remainingMs).toBe(10 * MIN);
    expect(later.brain.state.quiet).toBe(true);

    later.live(10 * MIN - SEC, SEC);
    expect(later.brain.state.focus.status).toBe('running');
    later.live(SEC, SEC);
    expect(completions(later)).toEqual([{ type: 'complete', treats: 3, streak: 1, unlocked: ['cookie'] }]);
    expect(later.brain.state.treats).toBe(5);
  });

  it('completes during start-up if it ran out while the app was closed, and says so on the first tick', () => {
    const r = rig();
    r.brain.startFocus();
    r.live(10 * MIN);
    const later = r.restart(2 * HOUR);

    // Already true before anyone has ticked:
    expect(later.brain.state.focus.status).toBe('idle');
    expect(later.brain.state.treats).toBe(5);
    expect(later.brain.state.sessionsCompleted).toBe(1);
    expect(later.brain.state.streak).toEqual({ current: 1, best: 1 });
    expect(later.events).toHaveLength(0);

    later.brain.tick();
    expect(completions(later)).toEqual([{ type: 'complete', treats: 3, streak: 1, unlocked: ['cookie'] }]);
    later.clear();
    later.brain.tick();
    expect(completions(later)).toHaveLength(0); // said once
  });

  it('stays paused across a restart, however long', () => {
    const r = rig();
    r.brain.startFocus();
    r.live(10 * MIN);
    r.brain.pauseFocus();
    const later = r.restart(3 * DAY);
    expect(later.brain.state.focus.status).toBe('paused');
    expect(later.brain.state.focus.remainingMs).toBe(15 * MIN);
    later.brain.resumeFocus();
    later.live(15 * MIN, SEC);
    expect(completions(later)).toHaveLength(1);
  });

  it('remembers the chosen length', () => {
    const r = rig();
    r.brain.setFocusLength(50);
    expect(r.restart().brain.state.focus.minutes).toBe(50);
  });
});

describe('focus: streak', () => {
  it('counts days in a row, not sessions', () => {
    const r = rig({ clock: fakeClock(at(2026, 11, 11, 9)) });
    runSession(r);
    expect(r.brain.state.streak).toEqual({ current: 1, best: 1 });
    runSession(r);
    expect(r.brain.state.streak).toEqual({ current: 1, best: 1 });

    r.clock.set(at(2026, 11, 12, 9));
    r.brain.tick();
    expect(r.brain.state.streak.current).toBe(1); // yesterday still counts today
    runSession(r);
    expect(r.brain.state.streak).toEqual({ current: 2, best: 2 });

    r.clock.set(at(2026, 11, 13, 22));
    runSession(r);
    expect(r.brain.state.streak).toEqual({ current: 3, best: 3 });
    expect(completions(r).map((c) => c.streak)).toEqual([1, 1, 2, 3]);
  });

  it('carries on across midnight: 23:59 one day and 00:01 the next is two days', () => {
    const r = rig({ clock: fakeClock(at(2026, 11, 11, 23, 30)) });
    runSession(r, 25); // ends 23:55
    expect(r.brain.state.streak.current).toBe(1);
    r.clock.set(at(2026, 11, 12, 0, 1));
    r.brain.tick();
    r.brain.setFocusLength(15);
    r.brain.startFocus();
    r.live(15 * MIN, SEC);
    expect(r.brain.state.streak).toEqual({ current: 2, best: 2 });
    expect(completions(r).map((c) => c.treats)).toEqual([3, 2]); // both were a first of the day
  });

  it('counts a session for the day it ends on when it runs over midnight', () => {
    const r = rig({ clock: fakeClock(at(2026, 11, 11, 10)) });
    runSession(r); // the 11th
    r.clock.set(at(2026, 11, 11, 23, 50));
    r.brain.tick();
    runSession(r); // 23:50 -> 00:15 on the 12th
    expect(r.brain.state.streak).toEqual({ current: 2, best: 2 });
    expect(completions(r).at(-1)?.treats).toBe(3);
  });

  it('quietly drops to zero after a whole day with no session, and keeps the best', () => {
    const r = rig({ clock: fakeClock(at(2026, 11, 11, 9)) });
    runSession(r);
    r.clock.set(at(2026, 11, 12, 9));
    runSession(r);
    expect(r.brain.state.streak).toEqual({ current: 2, best: 2 });

    r.clock.set(at(2026, 11, 13, 23, 59));
    r.brain.tick();
    expect(r.brain.state.streak.current).toBe(2); // the 13th is not over yet

    r.clear();
    r.clock.set(at(2026, 11, 14, 0, 1));
    r.brain.tick();
    expect(r.brain.state.streak).toEqual({ current: 0, best: 2 });
    // Nothing is said about it: no event beyond the ordinary ones.
    expect(r.events.every((e) => e.type === 'change' || e.type === 'away' || e.type === 'mood' || e.type === 'need')).toBe(true);

    runSession(r);
    expect(r.brain.state.streak).toEqual({ current: 1, best: 2 });
  });

  it('survives a restart, and lapses while the app is closed', () => {
    const r = rig({ clock: fakeClock(at(2026, 11, 11, 9)) });
    runSession(r);
    r.clock.set(at(2026, 11, 12, 9));
    runSession(r);

    const nextDay = r.restart(DAY);
    expect(nextDay.brain.state.streak).toEqual({ current: 2, best: 2 });

    const muchLater = r.restart(3 * DAY);
    expect(muchLater.brain.state.streak).toEqual({ current: 0, best: 2 });
  });

  it('gives a session that finished while the app was closed to the day it finished on', () => {
    const r = rig({ clock: fakeClock(at(2026, 11, 11, 9)) });
    runSession(r); // streak 1 on the 11th
    r.clock.set(at(2026, 11, 12, 23, 0));
    r.brain.tick();
    r.brain.startFocus(); // will end 23:25 on the 12th
    const later = r.restart(4 * HOUR); // reopened 03:00 on the 13th
    expect(later.brain.state.streak).toEqual({ current: 2, best: 2 });
    // A session on the 13th continues it.
    runSession(later);
    expect(later.brain.state.streak).toEqual({ current: 3, best: 3 });
  });

  it('counts calendar days correctly across a daylight-saving change', () => {
    const zone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      // Clocks go back on Sunday 1 November 2026: that day is 25 hours long.
      const before = at(2026, 10, 31, 23, 0);
      const longDay = at(2026, 11, 1, 23, 0);
      const after = at(2026, 11, 2, 23, 0);
      if (longDay - before !== 25 * HOUR) return; // this runtime cannot switch zone; nothing to check

      const r = rig({ clock: fakeClock(before) });
      runSession(r, 15);
      r.clock.set(longDay);
      runSession(r, 15);
      r.clock.set(after);
      runSession(r, 15);
      expect(r.brain.state.streak).toEqual({ current: 3, best: 3 });
      expect(completions(r).map((c) => c.treats)).toEqual([2, 2, 2]);
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});

describe('focus: unlocks', () => {
  it('follows the table in the spec', () => {
    expect(UNLOCK_TABLE).toEqual([
      { atSessions: 1, id: 'cookie' },
      { atSessions: 3, id: 'donut' },
      { atSessions: 6, id: 'yarn' },
      { atSessions: 10, id: 'strawberry' },
      { atSessions: 15, id: 'nightcap' },
      { atSessions: 25, id: 'duck' },
      { atSessions: 40, id: 'onigiri' },
      { atSessions: 60, id: 'bow' },
    ]);
  });

  it('unlocks each thing at exactly its threshold, and announces it once', () => {
    const r = rig();
    const expected: UnlockId[] = ['biscuit', 'ball'];
    for (let session = 1; session <= 61; session++) {
      const due = UNLOCK_TABLE.filter((u) => u.atSessions === session).map((u) => u.id);
      const upcoming = UNLOCK_TABLE.find((u) => u.atSessions >= session);
      expect(r.brain.state.nextUnlock).toEqual(upcoming ? { id: upcoming.id, atSessions: upcoming.atSessions } : null);

      r.clear();
      r.brain.startFocus();
      r.debug.finishFocusNow();
      expected.push(...due);

      expect(completions(r)[0]?.unlocked).toEqual(due);
      expect(r.brain.state.unlocked).toEqual(expected);
      expect(r.brain.state.sessionsCompleted).toBe(session);
    }
    expect(r.brain.state.nextUnlock).toBeNull();
    expect(r.brain.state.unlocked).toHaveLength(2 + UNLOCK_TABLE.length);
  });

  it('keeps unlocks across a restart', () => {
    const r = rig();
    quickSessions(r, 6);
    const later = r.restart();
    expect(later.brain.state.unlocked).toEqual(['biscuit', 'ball', 'cookie', 'donut', 'yarn']);
    expect(later.brain.state.nextUnlock).toEqual({ id: 'strawberry', atSessions: 10 });
  });

  it('puts the nightcap on while asleep, once it is unlocked', () => {
    const r = rig();
    quickSessions(r, 14);
    r.brain.sleep();
    expect(r.brain.state.wearing).toBeNull();
    r.brain.wake();
    quickSessions(r, 1);
    expect(r.brain.state.wearing).toBeNull();
    r.brain.sleep();
    expect(r.brain.state.wearing).toBe('nightcap');
    r.brain.wake();
    expect(r.brain.state.wearing).toBeNull();
  });

  it('wears the hat chosen in settings only once that hat is unlocked', () => {
    const r = rig();
    r.brain.setSetting('hat', 'bow');
    expect(r.brain.settings.hat).toBe('bow');
    expect(r.brain.state.wearing).toBeNull();
    quickSessions(r, 60);
    expect(r.brain.state.wearing).toBe('bow');
    r.debug.setNeeds({ energy: 50 });
    r.brain.sleep();
    expect(r.brain.state.wearing).toBe('nightcap'); // the nightcap wins at bedtime
    r.brain.wake();
    r.brain.setSetting('hat', null);
    expect(r.brain.state.wearing).toBeNull();
  });
});

describe('focus: debug', () => {
  it('finishFocusNow completes a running or paused session with the normal reward', () => {
    const r = rig();
    r.brain.startFocus();
    r.debug.finishFocusNow();
    r.brain.startFocus();
    r.brain.pauseFocus();
    r.debug.finishFocusNow();
    expect(completions(r).map((c) => c.treats)).toEqual([3, 2]);
    r.clear();
    r.debug.finishFocusNow(); // nothing running
    expect(r.events).toHaveLength(0);
  });
});
