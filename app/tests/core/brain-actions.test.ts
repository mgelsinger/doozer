import { describe, expect, it } from 'vitest';
import type { BrainEvents } from '../../src/core';
import { HOUR, of, rig, type Rig } from './helpers';

/** A random source that plays back a script, then settles on 0.5. */
function scripted(values: number[]): () => number {
  let i = 0;
  return () => values[i++] ?? 0.5;
}

function completeSessions(r: Rig, count: number): void {
  for (let i = 0; i < count; i++) {
    r.brain.startFocus();
    r.debug.finishFocusNow();
  }
}

function actions(r: Rig): BrainEvents['action'][] {
  return of(r.events, 'action');
}

describe('a newly hatched Doozer', () => {
  it('starts with the documented values', () => {
    const { brain, clock } = rig();
    const s = brain.state;
    expect(s.name).toBe('Doozer');
    expect(s.bornAt).toBe(clock.now());
    expect(s.needs).toEqual({ tummy: 72, fun: 64, energy: 80, clean: 88 });
    expect(s.asleep).toBe(false);
    expect(s.mood).toBe('content');
    expect(s.wellbeing).toBe(76);
    expect(s.lowest).toEqual({ key: 'fun', value: 64 });
    expect(s.bowl).toBe(0);
    expect(s.treats).toBe(2);
    expect(s.focus).toEqual({ status: 'idle', minutes: 25, remainingMs: 25 * 60_000, progress: 0 });
    expect(s.streak).toEqual({ current: 0, best: 0 });
    expect(s.sessionsCompleted).toBe(0);
    expect(s.unlocked).toEqual(['biscuit', 'ball']);
    expect(s.nextUnlock).toEqual({ id: 'cookie', atSessions: 1 });
    expect(s.wearing).toBeNull();
    expect(s.quiet).toBe(false);
  });

  it('exposes the limits the UI relies on', () => {
    expect(rig().brain.limits).toEqual({ bowl: 3, treats: 20, low: 30, urgent: 12 });
  });

  it('picks its favourite snack from the random source at hatching', () => {
    expect(rig({ random: () => 0 }).brain.state.favourite).toBe('biscuit');
    expect(rig({ random: () => 0.5 }).brain.state.favourite).toBe('donut');
    expect(rig({ random: () => 0.999 }).brain.state.favourite).toBe('onigiri');
  });

  it('has no debug helpers unless asked for', () => {
    expect(rig({ debug: false }).brain.debug).toBeUndefined();
    expect(rig({ debug: true }).brain.debug).toBeDefined();
  });

  it('does not expose bond anywhere in state', () => {
    expect(JSON.stringify(rig().brain.state)).not.toContain('bond');
  });
});

describe('feed', () => {
  it('gives one meal: tummy +32, a random everyday food, one change', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 40 });
    r.clear();
    expect(r.brain.feed()).toEqual({ ok: true });
    expect(r.brain.state.needs.tummy).toBe(72);
    const [event] = actions(r);
    expect(event?.type).toBe('feed');
    expect(['apple', 'bread', 'carrot']).toContain(event?.type === 'feed' ? event.food : '');
    expect(of(r.events, 'change')).toHaveLength(1);
    expect(of(r.events, 'refuse')).toHaveLength(0);
  });

  it('never takes tummy above 100', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90 });
    r.brain.feed();
    expect(r.brain.state.needs.tummy).toBe(100);
  });

  it('does not touch the bowl', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90 });
    r.brain.fillBowl();
    r.debug.setNeeds({ tummy: 75 });
    r.brain.feed();
    expect(r.brain.state.bowl).toBe(3);
  });

  it("is refused as 'full' when tummy is above 94, and allowed at 94", () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 95 });
    r.clear();
    expect(r.brain.feed()).toEqual({ ok: false, reason: 'full' });
    expect(of(r.events, 'refuse')).toEqual([{ action: 'feed', reason: 'full' }]);
    expect(actions(r)).toHaveLength(0);
    expect(of(r.events, 'change')).toHaveLength(0);
    r.debug.setNeeds({ tummy: 94 });
    expect(r.brain.feed()).toEqual({ ok: true });
  });

  it("is refused as 'asleep' while Doozer sleeps", () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 20 });
    r.brain.sleep();
    r.clear();
    expect(r.brain.feed()).toEqual({ ok: false, reason: 'asleep' });
    expect(of(r.events, 'refuse')).toEqual([{ action: 'feed', reason: 'asleep' }]);
    expect(r.brain.state.needs.tummy).toBe(20);
  });
});

describe('giveTreat', () => {
  it('takes one treat from the jar: tummy +10, fun +16', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 50, fun: 50 });
    r.clear();
    expect(r.brain.giveTreat()).toEqual({ ok: true });
    expect(r.brain.state.treats).toBe(1);
    expect(r.brain.state.needs.tummy).toBe(60);
    expect(r.brain.state.needs.fun).toBe(66);
    expect(actions(r)).toEqual([{ type: 'treat', food: 'biscuit', favourite: r.brain.state.favourite === 'biscuit' }]);
  });

  it('is only ever a biscuit before anything is unlocked', () => {
    const r = rig({ seed: 3 });
    r.debug.addTreats(18);
    r.clear();
    for (let i = 0; i < 20; i++) r.brain.giveTreat();
    const foods = actions(r).map((a) => (a.type === 'treat' ? a.food : null));
    expect(foods).toHaveLength(20);
    expect(new Set(foods)).toEqual(new Set(['biscuit']));
  });

  it('picks at random among the snacks unlocked so far', () => {
    const r = rig({ seed: 5 });
    completeSessions(r, 3); // cookie at 1, donut at 3
    r.debug.addTreats(20);
    r.clear();
    for (let i = 0; i < 20; i++) r.brain.giveTreat();
    const foods = new Set(actions(r).map((a) => (a.type === 'treat' ? a.food : null)));
    expect(foods).toEqual(new Set(['biscuit', 'cookie', 'donut']));
  });

  it('flags the favourite snack', () => {
    const loves = rig({ random: scripted([0]) }); // favourite: biscuit
    loves.brain.giveTreat();
    expect(actions(loves)).toEqual([{ type: 'treat', food: 'biscuit', favourite: true }]);

    const waits = rig({ random: scripted([0.999]) }); // favourite: onigiri, not unlocked yet
    waits.brain.giveTreat();
    expect(actions(waits)).toEqual([{ type: 'treat', food: 'biscuit', favourite: false }]);
  });

  it("is refused as 'no-treats' when the jar is empty", () => {
    const r = rig();
    r.brain.giveTreat();
    r.brain.giveTreat();
    r.clear();
    expect(r.brain.giveTreat()).toEqual({ ok: false, reason: 'no-treats' });
    expect(of(r.events, 'refuse')).toEqual([{ action: 'giveTreat', reason: 'no-treats' }]);
    expect(r.brain.state.treats).toBe(0);
  });

  it("is refused as 'asleep' while Doozer sleeps, and keeps the treat", () => {
    const r = rig();
    r.brain.sleep();
    expect(r.brain.giveTreat()).toEqual({ ok: false, reason: 'asleep' });
    expect(r.brain.state.treats).toBe(2);
  });

  it('is welcome even on a full tummy', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 100 });
    expect(r.brain.giveTreat()).toEqual({ ok: true });
  });
});

describe('play', () => {
  it('gives fun +28 for energy -7 and tummy -4, with the ball', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 80, fun: 40, energy: 60 });
    r.clear();
    expect(r.brain.play()).toEqual({ ok: true });
    expect(r.brain.state.needs).toMatchObject({ tummy: 76, fun: 68, energy: 53 });
    expect(actions(r)).toEqual([{ type: 'play', toy: 'ball' }]);
  });

  it('uses the yarn too once it is unlocked, but never the duck', () => {
    const r = rig({ seed: 2 });
    completeSessions(r, 25); // yarn at 6, duck at 25
    r.clear();
    for (let i = 0; i < 12; i++) {
      r.debug.setNeeds({ energy: 80 });
      r.brain.play();
    }
    const toys = new Set(actions(r).map((a) => (a.type === 'play' ? a.toy : null)));
    expect(toys).toEqual(new Set(['ball', 'yarn']));
  });

  it("is refused as 'tired' when energy is below 10, and allowed at 10", () => {
    const r = rig();
    r.debug.setNeeds({ energy: 9, fun: 20 });
    r.clear();
    expect(r.brain.play()).toEqual({ ok: false, reason: 'tired' });
    expect(of(r.events, 'refuse')).toEqual([{ action: 'play', reason: 'tired' }]);
    expect(r.brain.state.needs.fun).toBe(20);
    r.debug.setNeeds({ energy: 10 });
    expect(r.brain.play()).toEqual({ ok: true });
  });

  it('wears Doozer out: playing down to energy 4 or less sends it straight to sleep', () => {
    const r = rig();
    r.debug.setNeeds({ energy: 10 });
    r.clear();
    r.brain.play();
    expect(r.brain.state.asleep).toBe(true);
    expect(actions(r)).toEqual([
      { type: 'play', toy: 'ball' },
      { type: 'sleep', why: 'exhausted' },
    ]);
  });

  it("is refused as 'asleep' while Doozer sleeps", () => {
    const r = rig();
    r.brain.sleep();
    expect(r.brain.play()).toEqual({ ok: false, reason: 'asleep' });
  });
});

describe('wash', () => {
  it('makes Doozer fully clean', () => {
    const r = rig();
    r.debug.setNeeds({ clean: 12 });
    r.clear();
    expect(r.brain.wash()).toEqual({ ok: true });
    expect(r.brain.state.needs.clean).toBe(100);
    expect(actions(r)).toEqual([{ type: 'wash', duck: false }]);
  });

  it('brings the rubber duck once it is unlocked', () => {
    const r = rig();
    completeSessions(r, 25);
    r.clear();
    r.brain.wash();
    expect(actions(r)).toEqual([{ type: 'wash', duck: true }]);
  });

  it("is refused as 'asleep' while Doozer sleeps", () => {
    const r = rig();
    r.debug.setNeeds({ clean: 12 });
    r.brain.sleep();
    r.clear();
    expect(r.brain.wash()).toEqual({ ok: false, reason: 'asleep' });
    expect(of(r.events, 'refuse')).toEqual([{ action: 'wash', reason: 'asleep' }]);
    expect(r.brain.state.needs.clean).toBe(12);
  });
});

describe('pet', () => {
  it('gives fun +3 and is never refused', () => {
    const r = rig();
    r.debug.setNeeds({ fun: 50 });
    r.clear();
    expect(r.brain.pet()).toEqual({ ok: true });
    expect(r.brain.state.needs.fun).toBe(53);
    expect(actions(r)).toEqual([{ type: 'pet' }]);
  });

  it('works while Doozer is asleep', () => {
    const r = rig();
    r.debug.setNeeds({ fun: 50 });
    r.brain.sleep();
    r.clear();
    expect(r.brain.pet()).toEqual({ ok: true });
    expect(r.brain.state.needs.fun).toBe(53);
    expect(r.brain.state.asleep).toBe(true);
    expect(of(r.events, 'refuse')).toHaveLength(0);
  });

  it('still reports the stroke when fun is already full', () => {
    const r = rig();
    r.debug.setNeeds({ fun: 100 });
    r.clear();
    expect(r.brain.pet()).toEqual({ ok: true });
    expect(actions(r)).toEqual([{ type: 'pet' }]);
  });
});

describe('sleep and wake', () => {
  it('tucks Doozer in', () => {
    const r = rig();
    expect(r.brain.sleep()).toEqual({ ok: true });
    expect(r.brain.state.asleep).toBe(true);
    expect(r.brain.state.mood).toBe('asleep');
    expect(actions(r)).toEqual([{ type: 'sleep', why: 'tucked-in' }]);
    expect(of(r.events, 'mood')).toEqual([{ mood: 'asleep', from: 'content' }]);
  });

  it("is refused as 'not-sleepy' when energy is above 92, and allowed at 92", () => {
    const r = rig();
    r.debug.setNeeds({ energy: 93 });
    r.clear();
    expect(r.brain.sleep()).toEqual({ ok: false, reason: 'not-sleepy' });
    expect(of(r.events, 'refuse')).toEqual([{ action: 'sleep', reason: 'not-sleepy' }]);
    expect(r.brain.state.asleep).toBe(false);
    r.debug.setNeeds({ energy: 92 });
    expect(r.brain.sleep()).toEqual({ ok: true });
  });

  it('wakes Doozer when asked', () => {
    const r = rig();
    r.brain.sleep();
    r.clear();
    expect(r.brain.wake()).toEqual({ ok: true });
    expect(r.brain.state.asleep).toBe(false);
    expect(actions(r)).toEqual([{ type: 'wake', why: 'woken' }]);
  });

  it('does nothing, quietly, when already in that state', () => {
    const r = rig();
    expect(r.brain.wake()).toEqual({ ok: true });
    expect(r.events).toHaveLength(0);
    r.brain.sleep();
    r.clear();
    expect(r.brain.sleep()).toEqual({ ok: true });
    expect(r.events).toHaveLength(0);
  });

  it('toggles', () => {
    const r = rig();
    expect(r.brain.toggleSleep()).toEqual({ ok: true });
    expect(r.brain.state.asleep).toBe(true);
    expect(r.brain.toggleSleep()).toEqual({ ok: true });
    expect(r.brain.state.asleep).toBe(false);
    r.debug.setNeeds({ energy: 99 });
    expect(r.brain.toggleSleep()).toEqual({ ok: false, reason: 'not-sleepy' });
  });

  it('dozes straight off again if woken while still exhausted', () => {
    const r = rig();
    r.debug.setNeeds({ energy: 4 });
    expect(r.brain.state.asleep).toBe(true);
    r.clear();
    r.brain.wake();
    expect(r.brain.state.asleep).toBe(true);
    expect(actions(r)).toEqual([
      { type: 'wake', why: 'woken' },
      { type: 'sleep', why: 'exhausted' },
    ]);
  });
});

describe('fillBowl', () => {
  it('tops the bowl up to three servings', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90 });
    r.clear();
    expect(r.brain.fillBowl()).toEqual({ ok: true });
    expect(r.brain.state.bowl).toBe(3);
    expect(actions(r)).toEqual([{ type: 'fill-bowl' }]);
  });

  it("is refused as 'bowl-full' when it already holds three", () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 90 });
    r.brain.fillBowl();
    r.clear();
    expect(r.brain.fillBowl()).toEqual({ ok: false, reason: 'bowl-full' });
    expect(of(r.events, 'refuse')).toEqual([{ action: 'fillBowl', reason: 'bowl-full' }]);
  });

  it('works while Doozer is asleep', () => {
    const r = rig();
    r.brain.sleep();
    expect(r.brain.fillBowl()).toEqual({ ok: true });
    expect(r.brain.state.bowl).toBe(3);
  });
});

describe('events in general', () => {
  it('fires change at most once per action, last, with the state already updated', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 20 });
    const seenAtChange: number[] = [];
    r.brain.on('change', () => seenAtChange.push(r.brain.state.needs.tummy));
    r.clear();
    r.brain.feed();
    expect(seenAtChange).toEqual([52]);
    expect(r.events.map((e) => e.type)).toEqual(['action', 'mood', 'change']);
  });

  it('gives handlers the new state even for the first event of an action', () => {
    const r = rig();
    r.debug.setNeeds({ tummy: 20 });
    let seen = -1;
    r.brain.on('action', () => (seen = r.brain.state.needs.tummy));
    r.brain.feed();
    expect(seen).toBe(52);
  });

  it('stops calling a handler once it is unsubscribed', () => {
    const r = rig();
    let calls = 0;
    const off = r.brain.on('action', () => calls++);
    r.brain.pet();
    off();
    r.brain.pet();
    expect(calls).toBe(1);
  });

  it('keeps going when a handler throws, then rethrows', () => {
    const r = rig();
    let later = 0;
    r.brain.on('action', () => {
      throw new Error('view bug');
    });
    r.brain.on('change', () => later++);
    expect(() => r.brain.pet()).toThrow('view bug');
    expect(later).toBe(1);
    expect(r.brain.state.needs.fun).toBe(67);
    // ...and the brain still works afterwards.
    expect(() => r.brain.tick()).not.toThrow();
  });

  it('copes with a handler that calls back into the brain', () => {
    const r = rig();
    r.debug.setNeeds({ fun: 10 });
    let once = true;
    r.brain.on('action', () => {
      if (once) {
        once = false;
        r.brain.pet();
      }
    });
    r.clear();
    r.brain.pet();
    expect(r.brain.state.needs.fun).toBe(16);
    expect(of(r.events, 'action')).toHaveLength(2);
  });

  it('applies an action at the present moment, even if tick was not called first', () => {
    const r = rig();
    r.clock.advance(HOUR / 60); // one minute, no tick
    r.brain.pet();
    const save = r.brain.serialize() as { lastSeen: number };
    expect(save.lastSeen).toBe(r.clock.now());
  });
});
