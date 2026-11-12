// The presenter against the fake brain, with a real ExpressionState behind a recording
// actor and a stage that counts what is on it. Everything runs on a fake clock.
// These are the Phase 5 "nothing may get stuck" requirements, end to end:
//   - a temporary expression always returns to the mood expression
//   - props and emotes never outlive their scene
//   - an open menu closes when Doozer is interrupted
//   - rapid repeated actions leave nothing in a wrong state

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brain } from '../core/contract';
import { ExpressionState } from '../character/expression-state';
import type { ExpressionName } from '../character/expressions';
import { Disclosure } from './lifecycle';
import { StageDirector, expressionFor, interruptOnActivity, syncDoozer, type EmoteKind, type PetActor, type StageFx } from './presenter';
import { createFakeBrain, type FakeBrainPreset } from './dev/fake-brain';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function makeActor() {
  const calls: string[] = [];
  const state = new ExpressionState({ apply: () => {} });
  const worn = { glasses: false, hat: null as string | null, dirt: false, palette: '' };
  let look: [number, number] = [0, 0];
  const actor: PetActor = {
    setMood: (name) => { calls.push(`mood:${name}`); state.setMood(name); },
    flash: (name, ms) => { calls.push(`flash:${name}`); state.flash(name, ms); },
    setPose: (pose, face) => { state.setPose(pose, face ?? null); },
    lookAt: (x, y) => { look = [x, y]; },
    perform: (name, strength) => { calls.push(`perform:${name}`); return state.perform(name, strength); },
    squish: () => { calls.push('squish'); },
    stop: () => { state.stop(); },
    setGlasses: (on) => { worn.glasses = on; },
    setHat: (hat) => { worn.hat = hat; },
    setDirt: (on) => { worn.dirt = on; },
    setPalette: (id) => { worn.palette = id; },
  };
  return { actor, state, calls, worn, look: () => look };
}

function makeStage() {
  const emotes: EmoteKind[] = [];
  let props = 0;
  let mostProps = 0;
  let treatsEarned = 0;
  const fx: StageFx = {
    emote: (kind, options) => { for (let i = 0; i < (options?.count ?? 1); i++) emotes.push(kind); },
    prop: () => {
      props += 1; mostProps = Math.max(mostProps, props);
      let gone = false;
      return { bite() {}, remove() { if (!gone) { gone = true; props -= 1; } } };
    },
    treatsEarned: (count) => { treatsEarned += count; },
  };
  return { fx, emotes, props: () => props, mostProps: () => mostProps, treatsEarned: () => treatsEarned };
}

function setup(preset: FakeBrainPreset = {}) {
  let t = 1_700_000_000_000;
  const brain = createFakeBrain({ preset: { needs: { tummy: 50, fun: 50, energy: 60, clean: 60 }, treats: 5, ...preset }, now: () => t, random: () => 0.1 });
  const a = makeActor();
  const stage = makeStage();
  const director = new StageDirector(brain, a.actor, stage.fx);
  const elapse = async (ms: number) => { t += ms; await vi.advanceTimersByTimeAsync(ms); };
  /** The whole stage is at rest: mood face, no scene, no props. */
  const settled = () => !a.state.busy && director.scene === null && stage.props() === 0
    && a.state.showing === expressionFor(brain.state, brain.limits) && a.look().every((v) => v === 0);
  return { brain, director, ...a, stage, elapse, settled };
}

describe('expressionFor', () => {
  const state = (preset: FakeBrainPreset) => {
    const brain = createFakeBrain({ preset });
    return expressionFor(brain.state, brain.limits);
  };
  it('is the mood normally', () => {
    expect(state({ needs: { tummy: 20, fun: 80, energy: 80, clean: 80 } })).toBe('hungry');
    expect(state({ needs: { tummy: 90, fun: 90, energy: 90, clean: 90 } })).toBe('joyful');
  });
  it('is asleep when asleep', () => {
    expect(state({ asleep: true })).toBe('asleep');
  });
  it('is the focus face during a session, even when a need is merely low', () => {
    expect(state({ focus: { status: 'running' }, needs: { tummy: 20, fun: 80, energy: 80, clean: 80 } })).toBe('focus');
  });
  it('lets an urgent need show through a session (spec 4.5), and a paused session shows the mood', () => {
    expect(state({ focus: { status: 'running' }, needs: { tummy: 5, fun: 80, energy: 80, clean: 80 } })).toBe('hungry');
    expect(state({ focus: { status: 'paused' }, needs: { tummy: 90, fun: 90, energy: 90, clean: 90 } })).toBe('joyful');
  });
});

describe('syncDoozer', () => {
  it('keeps the lasting look in step and calls nothing when nothing changed', () => {
    const brain = createFakeBrain({ preset: { needs: { tummy: 80, fun: 80, energy: 80, clean: 20 }, sessionsCompleted: 61, settings: { hat: 'bow', palette: 'mint' } } });
    const { actor, calls, worn } = makeActor();
    const off = syncDoozer(brain, actor);
    expect(calls).toEqual(['mood:dirty']);
    expect(worn).toEqual({ glasses: false, hat: 'bow', dirt: true, palette: 'mint' });
    brain.pet();                                   // a change that alters nothing we draw
    expect(calls).toEqual(['mood:dirty']);
    brain.wash();
    expect(worn.dirt).toBe(false);
    brain.startFocus();
    expect(worn.glasses).toBe(true);
    expect(calls[calls.length - 1]).toBe('mood:focus');
    brain.setSetting('palette', 'sky');
    expect(worn.palette).toBe('sky');
    off();
    brain.stopFocus();
    expect(worn.glasses).toBe(true);               // no longer listening
  });

  it('wears the nightcap only while asleep, once unlocked', () => {
    const brain = createFakeBrain({ preset: { sessionsCompleted: 15, needs: { energy: 40 } } });
    const { actor, worn } = makeActor();
    syncDoozer(brain, actor);
    expect(worn.hat).toBeNull();
    brain.sleep();
    expect(worn.hat).toBe('nightcap');
    brain.wake();
    expect(worn.hat).toBeNull();
  });
});

describe('scenes return to rest', () => {
  it('feeding plays an eat scene with one prop, a heart, and ends on the mood face', async () => {
    const { brain, director, state, stage, elapse, settled } = setup();
    expect(brain.feed().ok).toBe(true);
    expect(director.scene).toBe('eat');
    expect(stage.props()).toBe(1);
    await elapse(600);
    expect(state.showing).toBe('eat');
    await elapse(6000);
    expect(stage.emotes).toContain('heart');
    expect(settled()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('every care action settles: feed, treat, favourite treat, play, wash, pet, fill bowl', async () => {
    for (const run of [
      (b: Brain) => b.feed(), (b: Brain) => b.giveTreat(), (b: Brain) => b.play(),
      (b: Brain) => b.wash(), (b: Brain) => b.pet(), (b: Brain) => b.fillBowl(),
    ]) {
      const { brain, elapse, settled } = setup({ favourite: 'biscuit', bowl: 0 });   // biscuit is the only treat unlocked
      expect(run(brain).ok).toBe(true);
      await elapse(8000);
      expect(settled()).toBe(true);
    }
  });

  it('a favourite treat gets the bigger reaction', async () => {
    const { brain, calls, stage, elapse } = setup({ favourite: 'biscuit' });
    brain.giveTreat();
    await elapse(8000);
    expect(calls).toContain('perform:celebrate');
    expect(stage.emotes.filter((kind) => kind === 'sparkle').length).toBeGreaterThan(0);
  });

  it('a refusal shakes its head, shows "?", and returns to the mood', async () => {
    const { brain, state, stage, elapse, settled } = setup({ treats: 0 });
    expect(brain.giveTreat()).toEqual({ ok: false, reason: 'no-treats' });
    expect(state.showing).toBe('no');
    expect(stage.emotes).toEqual(['question']);
    await elapse(900);
    expect(settled()).toBe(true);
  });

  it('hammering a refused button shakes the head each time but shows one "?" per shake', async () => {
    const { brain, state, stage, elapse, settled } = setup({ treats: 0 });
    for (let i = 0; i < 8; i++) { brain.giveTreat(); await elapse(60); }
    expect(state.showing).toBe('no');
    expect(stage.emotes).toEqual(['question']);
    await elapse(800);
    brain.giveTreat();
    expect(stage.emotes).toEqual(['question', 'question']);
    await elapse(2000);
    expect(settled()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asleep, a refusal does not wake it: a stir and a "z", and it is still asleep after', async () => {
    const { brain, state, calls, stage, elapse } = setup({ asleep: true });
    brain.feed();
    expect(calls).toContain('perform:stir');
    expect(calls.filter((call) => call.startsWith('flash:'))).toEqual([]);
    expect(stage.emotes).toEqual(['z']);
    await elapse(900);
    expect(state.showing).toBe('asleep');
    expect(state.busy).toBe(false);
  });
});

describe('interruptions', () => {
  it('falling asleep in the middle of eating removes the food at once', async () => {
    const { brain, director, state, stage, elapse } = setup();
    brain.feed();
    await elapse(500);
    expect(stage.props()).toBe(1);
    brain.sleep();
    expect(stage.props()).toBe(0);
    expect(director.scene).toBeNull();
    expect(state.performing).toBe('fall-asleep');
    await elapse(3000);
    expect(state.showing).toBe('asleep');
    expect(state.busy).toBe(false);
  });

  it('a scene interrupted at every moment leaves nothing behind', async () => {
    for (let at = 0; at <= 2600; at += 130) {
      const { brain, director, stage, elapse, settled } = setup();
      brain.play();
      await elapse(at);
      director.interrupt();
      expect(stage.props()).toBe(0);
      expect(director.scene).toBeNull();
      await elapse(4000);
      expect(settled()).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('a closed stage drops its scene and plays nothing until it is opened again', async () => {
    const { brain, director, stage, elapse, settled, calls } = setup();
    brain.wash();
    await elapse(300);
    director.setActive(false);
    expect(director.scene).toBeNull();
    expect(settled()).toBe(true);
    const before = calls.length;
    const emotesBefore = stage.emotes.length;
    brain.feed();
    brain.play();
    await elapse(5000);
    expect(stage.props()).toBe(0);
    expect(stage.emotes.length).toBe(emotesBefore);
    expect(calls.slice(before).filter((call) => call.startsWith('flash:') || call.startsWith('perform:'))).toEqual([]);
    director.setActive(true);
    brain.feed();
    expect(director.scene).toBe('eat');
  });

  it('destroy in mid-scene cleans the stage and silences the director', async () => {
    const { brain, director, stage, elapse, calls } = setup();
    brain.feed();
    await elapse(400);
    director.destroy();
    expect(stage.props()).toBe(0);
    const before = calls.length;
    brain.play();
    brain.wash();
    await elapse(5000);
    expect(calls.length).toBe(before);
    expect(stage.props()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('rapid repeated clicks', () => {
  it('ten feeds in a row never put two props on stage and end at rest', async () => {
    const { brain, stage, elapse, settled } = setup({ needs: { tummy: 0, fun: 50, energy: 60, clean: 60 } });
    for (let i = 0; i < 10; i++) { brain.feed(); await elapse(40); }
    expect(stage.mostProps()).toBe(1);
    await elapse(8000);
    expect(settled()).toBe(true);
  });

  it('a random storm of every action always settles', async () => {
    let seed = 12345;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let round = 0; round < 12; round++) {
      const { brain, director, stage, elapse, settled } = setup({ needs: { tummy: 30, fun: 30, energy: 50, clean: 30 }, treats: 12, bowl: 0 });
      const moves: (() => unknown)[] = [
        () => brain.feed(), () => brain.play(), () => brain.wash(), () => brain.giveTreat(), () => brain.pet(),
        () => brain.fillBowl(), () => brain.toggleSleep(), () => brain.startFocus(), () => brain.pauseFocus(),
        () => brain.resumeFocus(), () => brain.stopFocus(), () => brain.debug?.finishFocusNow(),
        () => director.interrupt(), () => director.setActive(random() < 0.7),
      ];
      for (let i = 0; i < 60; i++) {
        moves[Math.floor(random() * moves.length)]?.();
        expect(stage.props()).toBeLessThanOrEqual(1);
        await elapse(Math.floor(random() * 400));
      }
      director.setActive(true);
      brain.stopFocus();
      brain.wake();
      await elapse(10_000);
      expect(settled(), `round ${round}`).toBe(true);
      expect(stage.props()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});

describe('snoring', () => {
  it('a "z" drifts up now and then while asleep, and stops with the sleep', async () => {
    const { brain, stage, elapse } = setup({ asleep: true, needs: { energy: 30 } });
    await elapse(2600 * 3 + 100);
    expect(stage.emotes.filter((kind) => kind === 'z').length).toBe(3);
    brain.wake();
    const count = stage.emotes.length;
    await elapse(20_000);
    expect(stage.emotes.filter((kind) => kind === 'z').length).toBe(3);
    expect(stage.emotes.length).toBe(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a closed stage does not snore', async () => {
    const { director, stage, elapse } = setup({ asleep: true });
    director.setActive(false);
    await elapse(20_000);
    expect(stage.emotes).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('manners during a focus session (spec 4.5)', () => {
  it('no hearts or sparkles while a session runs, but a refusal still gets its "?"', async () => {
    const { brain, stage, elapse, settled } = setup({ treats: 0, focus: { status: 'running', minutes: 25 } });
    brain.feed();
    brain.pet();
    await elapse(6000);
    brain.play();
    await elapse(6000);
    expect(stage.emotes.filter((kind) => kind === 'heart' || kind === 'sparkle' || kind === 'z')).toEqual([]);
    brain.giveTreat();
    expect(stage.emotes).toContain('question');
    await elapse(3000);
    expect(settled()).toBe(true);
  });

  it('finishing a session celebrates, lands the treats, and returns to rest', async () => {
    const { brain, calls, stage, elapse, settled, worn } = setup({ focus: { status: 'running', minutes: 15 } });
    expect(worn.glasses).toBe(true);
    brain.debug?.finishFocusNow();
    expect(calls).toContain('perform:celebrate');
    expect(stage.treatsEarned()).toBe(2);          // 1 for 15 minutes, +1 for the first of the day
    expect(stage.emotes).toContain('sparkle');
    await elapse(8000);
    expect(worn.glasses).toBe(false);
    expect(settled()).toBe(true);
  });

  it('stopping early says nothing at all', async () => {
    const { brain, calls, stage } = setup({ focus: { status: 'running' } });
    const before = calls.filter((call) => call.startsWith('flash:') || call.startsWith('perform:')).length;
    brain.stopFocus();
    expect(calls.filter((call) => call.startsWith('flash:') || call.startsWith('perform:')).length).toBe(before);
    expect(stage.emotes).toEqual([]);
  });
});

describe('a menu around Doozer closes when Doozer is interrupted', () => {
  const openMenu = (brain: Brain) => {
    const menu = new Disclosure({ onChange: () => {}, idleMs: null });
    const off = interruptOnActivity(brain, menu);
    menu.open();
    return { menu, off };
  };

  it('closes when Doozer falls asleep from exhaustion', () => {
    let t = 0;
    const brain = createFakeBrain({ preset: { needs: { energy: 4.2 } }, now: () => t });
    const { menu } = openMenu(brain);
    t += 3_600_000;
    brain.tick();
    expect(brain.state.asleep).toBe(true);
    expect(menu.isOpen).toBe(false);
  });

  it('closes when Doozer helps itself from the bowl', () => {
    let t = 0;
    const brain = createFakeBrain({ preset: { needs: { tummy: 71 }, bowl: 2 }, now: () => t });
    const { menu } = openMenu(brain);
    t += 600_000;
    brain.tick();
    expect(brain.state.bowl).toBe(1);
    expect(menu.isOpen).toBe(false);
  });

  it('closes for every kind of action, and for a session starting or finishing', () => {
    const moves: ((b: Brain) => unknown)[] = [
      (b) => b.feed(), (b) => b.play(), (b) => b.wash(), (b) => b.giveTreat(), (b) => b.pet(), (b) => b.fillBowl(),
      (b) => b.sleep(), (b) => b.startFocus(), (b) => { b.startFocus(); return undefined; },
    ];
    for (const move of moves) {
      const brain = createFakeBrain({ preset: { needs: { tummy: 40, fun: 40, energy: 40, clean: 40 }, treats: 3, bowl: 0 } });
      const { menu } = openMenu(brain);
      move(brain);
      expect(menu.isOpen).toBe(false);
    }
    const brain = createFakeBrain({ preset: { focus: { status: 'running' } } });
    const { menu } = openMenu(brain);
    brain.debug?.finishFocusNow();
    expect(menu.isOpen).toBe(false);
  });

  it('a refusal or a pause leaves the menu alone, and it stops listening when told', () => {
    const brain = createFakeBrain({ preset: { treats: 0, focus: { status: 'running' } } });
    const { menu, off } = openMenu(brain);
    brain.giveTreat();
    brain.pauseFocus();
    expect(menu.isOpen).toBe(true);
    off();
    brain.pet();
    expect(menu.isOpen).toBe(true);
  });
});

describe('the face names line up with the brain', () => {
  it('every mood the brain can report is an expression', () => {
    const moods: ExpressionName[] = ['asleep', 'hungry', 'bored', 'sleepy', 'dirty', 'joyful', 'content', 'meh'];
    const brain = createFakeBrain();
    const { actor, state } = makeActor();
    syncDoozer(brain, actor);
    for (const mood of moods) {
      state.setMood(mood);
      expect(state.showing).toBe(mood);
    }
  });
});
