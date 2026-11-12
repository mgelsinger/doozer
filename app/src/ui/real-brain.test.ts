// The kit is written against the Brain interface and developed on the fake brain. This
// file runs the same "nothing gets stuck" checks against the REAL brain (app/src/core),
// so a difference between the two is found here rather than in the Pill view.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrain } from '../core';
import type { Brain, NeedKey } from '../core/contract';
import { ExpressionState } from '../character/expression-state';
import { isExpressionName } from '../character/expressions';
import { Disclosure } from './lifecycle';
import { needLevel, needTone } from './needs';
import { StageDirector, expressionFor, interruptOnActivity, type EmoteKind, type PetActor, type StageFx } from './presenter';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup(needs: Partial<Record<NeedKey, number>> = { tummy: 50, fun: 50, energy: 60, clean: 60 }) {
  let t = 1_800_000_000_000;
  const brain = createBrain({ now: () => t, random: () => 0.3, debug: true });
  brain.tick();
  brain.debug?.setNeeds(needs);
  brain.debug?.addTreats(6);

  const state = new ExpressionState({ apply: () => {} });
  const worn = { glasses: false };
  const actor: PetActor = {
    setMood: (name) => state.setMood(name),
    flash: (name, ms) => state.flash(name, ms),
    setPose: (pose, face) => state.setPose(pose, face ?? null),
    lookAt: () => {},
    perform: (name, strength) => state.perform(name, strength),
    squish: () => {},
    stop: () => state.stop(),
    setGlasses: (on) => { worn.glasses = on; },
    setHat: () => {},
    setDirt: () => {},
    setPalette: () => {},
  };
  const emotes: EmoteKind[] = [];
  let props = 0;
  let mostProps = 0;
  const fx: StageFx = {
    emote: (kind) => { emotes.push(kind); },
    prop: () => {
      props += 1; mostProps = Math.max(mostProps, props);
      let gone = false;
      return { bite() {}, remove() { if (!gone) { gone = true; props -= 1; } } };
    },
  };
  const director = new StageDirector(brain, actor, fx);
  const elapse = async (ms: number) => { t += ms; brain.tick(); await vi.advanceTimersByTimeAsync(ms); };
  const settled = () => !state.busy && director.scene === null && props === 0
    && state.showing === expressionFor(brain.state, brain.limits);
  return { brain, state, worn, emotes, director, elapse, settled, props: () => props, mostProps: () => mostProps };
}

describe('the kit against the real brain', () => {
  it('every mood the real brain reports is an expression the rig can draw', () => {
    const { brain } = setup();
    const moods = new Set<string>();
    const sample = (needs: Partial<Record<NeedKey, number>>) => { brain.debug?.setNeeds(needs); moods.add(brain.state.mood); };
    sample({ tummy: 95, fun: 95, energy: 90, clean: 95 });
    sample({ tummy: 60, fun: 60, energy: 60, clean: 60 });
    sample({ tummy: 35, fun: 35, energy: 35, clean: 35 });
    sample({ tummy: 10, fun: 80, energy: 80, clean: 80 });
    sample({ tummy: 80, fun: 10, energy: 80, clean: 80 });
    sample({ tummy: 80, fun: 80, energy: 15, clean: 80 });
    sample({ tummy: 80, fun: 80, energy: 80, clean: 10 });
    brain.debug?.setNeeds({ energy: 50 });
    brain.sleep();
    moods.add(brain.state.mood);
    expect(moods.size).toBeGreaterThanOrEqual(7);
    for (const mood of moods) expect(isExpressionName(mood), mood).toBe(true);
  });

  it('its limits drive the meters: low and urgent where the brain says', () => {
    const { brain } = setup();
    const { low, urgent } = brain.limits;
    expect(needLevel(low, brain.limits)).toBe('ok');
    expect(needLevel(low - 1, brain.limits)).toBe('low');
    expect(needLevel(urgent - 1, brain.limits)).toBe('urgent');
    expect(needTone(100, brain.limits)).toBe('good');
  });

  it('a feed plays and settles', async () => {
    const { brain, director, elapse, settled, emotes } = setup();
    expect(brain.feed()).toEqual({ ok: true });
    expect(director.scene).toBe('eat');
    await elapse(8000);
    expect(emotes).toContain('heart');
    expect(settled()).toBe(true);
  });

  it('filling the bowl when hungry (fill-bowl, then auto-eat in the same call) settles', async () => {
    const { brain, director, elapse, settled } = setup({ tummy: 40, fun: 60, energy: 60, clean: 60 });
    expect(brain.fillBowl()).toEqual({ ok: true });
    expect(director.scene).toBe('eat');
    await elapse(8000);
    expect(settled()).toBe(true);
  });

  it('refusals come back to rest, awake and asleep', async () => {
    const { brain, state, emotes, elapse, settled } = setup({ tummy: 99, fun: 50, energy: 50, clean: 50 });
    expect(brain.feed()).toEqual({ ok: false, reason: 'full' });
    expect(state.showing).toBe('no');
    expect(emotes).toContain('question');
    await elapse(2000);
    expect(settled()).toBe(true);
    brain.sleep();
    await elapse(4000);
    expect(brain.play()).toEqual({ ok: false, reason: 'asleep' });
    await elapse(2000);
    expect(state.showing).toBe('asleep');
    expect(state.busy).toBe(false);
  });

  it('waking an exhausted Doozer (wake, then asleep again at once) ends asleep and at rest', async () => {
    const { brain, state, elapse } = setup({ tummy: 60, fun: 60, energy: 3, clean: 60 });
    await elapse(1000);
    if (!brain.state.asleep) brain.sleep();
    await elapse(3000);
    brain.wake();
    await elapse(6000);
    expect(brain.state.asleep).toBe(true);
    expect(state.showing).toBe('asleep');
    expect(state.busy).toBe(false);
  });

  it('a focus session: glasses on, quiet, then a celebration that ends', async () => {
    const { brain, state, worn, emotes, elapse, settled } = setup();
    expect(brain.startFocus()).toEqual({ ok: true });
    expect(worn.glasses).toBe(true);
    await elapse(1000);
    expect(state.showing).toBe('focus');
    const before = emotes.length;
    brain.pet();
    brain.feed();
    await elapse(6000);
    expect(emotes.slice(before).filter((kind) => kind === 'heart' || kind === 'sparkle')).toEqual([]);
    brain.debug?.finishFocusNow();
    expect(state.performing).toBe('celebrate');
    await elapse(8000);
    expect(worn.glasses).toBe(false);
    expect(settled()).toBe(true);
  });

  it('a random storm of every action always settles', async () => {
    let seed = 99;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let round = 0; round < 8; round++) {
      const { brain, director, elapse, settled, props, mostProps } = setup({ tummy: 30, fun: 30, energy: 50, clean: 30 });
      const moves: ((b: Brain) => unknown)[] = [
        (b) => b.feed(), (b) => b.play(), (b) => b.wash(), (b) => b.giveTreat(), (b) => b.pet(), (b) => b.fillBowl(),
        (b) => b.toggleSleep(), (b) => b.startFocus(), (b) => b.pauseFocus(), (b) => b.resumeFocus(), (b) => b.stopFocus(),
        (b) => b.debug?.finishFocusNow(), () => director.interrupt(), () => director.setActive(random() < 0.7),
        (b) => b.debug?.setNeeds({ energy: Math.floor(random() * 100), tummy: Math.floor(random() * 100) }),
      ];
      for (let i = 0; i < 60; i++) {
        moves[Math.floor(random() * moves.length)]?.(brain);
        await elapse(Math.floor(random() * 400));
      }
      director.setActive(true);
      brain.stopFocus();
      brain.debug?.setNeeds({ energy: 60 });
      brain.wake();
      await elapse(12_000);
      expect(settled(), `round ${round}`).toBe(true);
      expect(props()).toBe(0);
      expect(mostProps()).toBeLessThanOrEqual(1);
    }
  });

  it('an open menu closes when the real Doozer does something by itself', async () => {
    const { brain, elapse } = setup({ tummy: 60, fun: 60, energy: 60, clean: 60 });
    const menu = new Disclosure({ onChange: () => {}, idleMs: null });
    interruptOnActivity(brain, menu);
    menu.open();
    brain.giveTreat();                       // a refusal would not close it; a real action does
    expect(menu.isOpen).toBe(false);

    menu.open();
    brain.debug?.setNeeds({ energy: 4 });    // exhausted: it falls asleep on its own
    await elapse(60_000);
    expect(brain.state.asleep).toBe(true);
    expect(menu.isOpen).toBe(false);
  });
});
