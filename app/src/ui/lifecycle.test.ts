// The kit's "nothing gets stuck" rules, on a fake clock:
// emotes always remove themselves, scenes always clean up, menus always close.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disclosure, SceneRunner, Scope, Transients, type CloseReason, type SceneOutcome } from './lifecycle';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Scope', () => {
  it('runs every clean-up once, newest first, even if one throws', () => {
    const order: string[] = [];
    const scope = new Scope();
    scope.add(() => order.push('a'));
    scope.add(() => { throw new Error('boom'); });
    scope.add(() => order.push('c'));
    scope.dispose();
    scope.dispose();
    expect(order).toEqual(['c', 'a']);
    expect(scope.disposed).toBe(true);
  });

  it('a clean-up run early is not run again', () => {
    let count = 0;
    const scope = new Scope();
    const early = scope.add(() => { count += 1; });
    early();
    early();
    scope.dispose();
    expect(count).toBe(1);
  });

  it('something registered after disposal is undone at once', () => {
    const scope = new Scope();
    scope.dispose();
    let ran = false;
    scope.add(() => { ran = true; });
    expect(ran).toBe(true);
  });

  it('its timeouts die with it', () => {
    const scope = new Scope();
    let fired = 0;
    scope.after(100, () => { fired += 1; });
    scope.after(200, () => { fired += 1; });
    vi.advanceTimersByTime(100);
    scope.dispose();
    vi.advanceTimersByTime(1000);
    expect(fired).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Transients (emotes)', () => {
  const make = (max?: number) => {
    const removed: string[] = [];
    const set = new Transients<string>({ remove: (item) => removed.push(item), max });
    return { set, removed };
  };

  it('an emote always removes itself', () => {
    const { set, removed } = make();
    set.add('heart', 1250);
    expect(set.size).toBe(1);
    vi.advanceTimersByTime(1249);
    expect(removed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(removed).toEqual(['heart']);
    expect(set.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a burst of rapid emits is capped and still empties completely', () => {
    const { set, removed } = make(6);
    for (let i = 0; i < 100; i++) set.add(`e${i}`, 1250);
    expect(set.size).toBe(6);
    expect(removed.length).toBe(94);
    vi.advanceTimersByTime(1250);
    expect(set.size).toBe(0);
    expect(new Set(removed).size).toBe(100);   // each removed exactly once
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clear removes everything now, and nothing is removed twice later', () => {
    const { set, removed } = make();
    set.add('a', 500);
    set.add('b', 900);
    set.clear();
    expect(removed).toEqual(['a', 'b']);
    vi.advanceTimersByTime(2000);
    expect(removed).toEqual(['a', 'b']);
  });

  it('a destroyed layer removes late arrivals immediately', () => {
    const { set, removed } = make();
    set.add('a', 500);
    set.destroy();
    expect(set.add('late', 500)).toBe(false);
    expect(removed).toEqual(['a', 'late']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a nonsense lifetime still ends', () => {
    const { set } = make();
    set.add('x', Number.NaN);
    set.add('y', Infinity);
    vi.advanceTimersByTime(30_000);
    expect(set.size).toBe(0);
  });
});

describe('SceneRunner', () => {
  const setup = () => {
    const ended: [string, SceneOutcome][] = [];
    const runner = new SceneRunner({ onEnd: (name, outcome) => ended.push([name, outcome]) });
    return { runner, ended };
  };

  /** A scene with a prop that must be gone at the end, and a number of steps. */
  const eat = (runner: SceneRunner, log: string[], steps = 3) => runner.play('eat', async (scene) => {
    log.push('prop on');
    scene.cleanup(() => log.push('prop off'));
    for (let i = 1; i <= steps; i++) {
      await scene.wait(400);
      log.push(`bite ${i}`);
    }
  });

  it('runs a scene to its end and cleans up', async () => {
    const { runner, ended } = setup();
    const log: string[] = [];
    const done = eat(runner, log);
    expect(runner.active).toBe('eat');
    await vi.advanceTimersByTimeAsync(1200);
    await expect(done).resolves.toBe('finished');
    expect(log).toEqual(['prop on', 'bite 1', 'bite 2', 'bite 3', 'prop off']);
    expect(runner.active).toBeNull();
    expect(ended).toEqual([['eat', 'finished']]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('interrupted at any step, it cleans up and never continues', async () => {
    // Cancel after 0, 1, 2 ... steps: the scene must end the same clean way each time.
    for (let cancelAt = 0; cancelAt <= 1300; cancelAt += 100) {
      const { runner } = setup();
      const log: string[] = [];
      const done = eat(runner, log);
      await vi.advanceTimersByTimeAsync(cancelAt);
      const before = log.length;
      runner.cancel();
      expect(log.filter((line) => line === 'prop off')).toEqual(['prop off']);
      expect(runner.active).toBeNull();
      await vi.advanceTimersByTimeAsync(5000);
      // Nothing after the cancel except the one clean-up (or nothing, if it had finished).
      expect(log.length).toBeLessThanOrEqual(before + 1);
      expect(log.filter((line) => line === 'prop off').length).toBe(1);
      expect(['interrupted', 'finished']).toContain(await done);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('a new scene replaces the old one: old cleaned up first, never two at once', async () => {
    const { runner, ended } = setup();
    const log: string[] = [];
    const first = eat(runner, log);
    await vi.advanceTimersByTimeAsync(500);
    const second = runner.play('play', async (scene) => {
      log.push('ball on');
      scene.cleanup(() => log.push('ball off'));
      await scene.wait(1000);
    });
    expect(log).toEqual(['prop on', 'bite 1', 'prop off', 'ball on']);
    await expect(first).resolves.toBe('interrupted');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(second).resolves.toBe('finished');
    expect(log[log.length - 1]).toBe('ball off');
    expect(ended).toEqual([['eat', 'interrupted'], ['play', 'finished']]);
  });

  it('rapid repeated starts leave exactly one prop on stage, then none', async () => {
    const { runner } = setup();
    let props = 0;
    let most = 0;
    for (let i = 0; i < 25; i++) {
      void runner.play('eat', async (scene) => {
        props += 1; most = Math.max(most, props);
        scene.cleanup(() => { props -= 1; });
        await scene.wait(1500);
      });
      await vi.advanceTimersByTimeAsync(30);
    }
    expect(most).toBe(1);
    expect(props).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(props).toBe(0);
    expect(runner.active).toBeNull();
  });

  it('a scene that never finishes is ended by the time limit', async () => {
    const { runner, ended } = setup();
    let cleaned = false;
    const done = runner.play('stuck', async (scene) => {
      scene.cleanup(() => { cleaned = true; });
      await new Promise(() => {});          // waits on something that never happens
    }, 3000);
    await vi.advanceTimersByTimeAsync(2999);
    expect(runner.active).toBe('stuck');
    await vi.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toBe('timed-out');
    expect(cleaned).toBe(true);
    expect(ended).toEqual([['stuck', 'timed-out']]);
  });

  it('a scene that throws is cleaned up', async () => {
    const { runner } = setup();
    let cleaned = false;
    const done = runner.play('bad', async (scene) => {
      scene.cleanup(() => { cleaned = true; });
      await scene.wait(100);
      throw new Error('oops');
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(done).resolves.toBe('failed');
    expect(cleaned).toBe(true);
    expect(runner.active).toBeNull();
  });

  it('`until` never resumes a scene that has ended', async () => {
    const { runner } = setup();
    let resumed = false;
    let release: () => void = () => {};
    const outside = new Promise<void>((resolve) => { release = resolve; });
    void runner.play('wait-for-animation', async (scene) => {
      await scene.until(outside);
      resumed = true;
    });
    runner.cancel();
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(resumed).toBe(false);
  });

  it('destroyed, it plays nothing more', async () => {
    const { runner } = setup();
    runner.destroy();
    let ran = false;
    await expect(runner.play('late', () => { ran = true; })).resolves.toBe('interrupted');
    expect(ran).toBe(false);
  });
});

describe('Disclosure (menus)', () => {
  const setup = (idleMs?: number | null) => {
    const events: [boolean, CloseReason | 'open'][] = [];
    const menu = new Disclosure({ onChange: (open, reason) => events.push([open, reason]), idleMs });
    return { menu, events };
  };

  it('opens and closes', () => {
    const { menu, events } = setup();
    menu.open();
    expect(menu.isOpen).toBe(true);
    menu.close('choice');
    expect(menu.isOpen).toBe(false);
    expect(events).toEqual([[true, 'open'], [false, 'choice']]);
  });

  it('an interruption closes an open menu, and is harmless on a closed one', () => {
    const { menu, events } = setup();
    menu.interrupt();
    expect(events).toEqual([]);
    menu.open();
    menu.interrupt();
    expect(menu.isOpen).toBe(false);
    expect(events[events.length - 1]).toEqual([false, 'interrupt']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes by itself when left alone', () => {
    const { menu, events } = setup(9000);
    menu.open();
    vi.advanceTimersByTime(8999);
    expect(menu.isOpen).toBe(true);
    vi.advanceTimersByTime(1);
    expect(menu.isOpen).toBe(false);
    expect(events[events.length - 1]).toEqual([false, 'idle']);
  });

  it('does not idle out while hovered or focused, and counts again afterwards', () => {
    const { menu } = setup(9000);
    menu.open();
    vi.advanceTimersByTime(5000);
    menu.hold(true);
    vi.advanceTimersByTime(60_000);
    expect(menu.isOpen).toBe(true);
    menu.hold(false);
    vi.advanceTimersByTime(8999);
    expect(menu.isOpen).toBe(true);
    vi.advanceTimersByTime(1);
    expect(menu.isOpen).toBe(false);
  });

  it('activity restarts the countdown', () => {
    const { menu } = setup(9000);
    menu.open();
    vi.advanceTimersByTime(8000);
    menu.touch();
    vi.advanceTimersByTime(8000);
    expect(menu.isOpen).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(menu.isOpen).toBe(false);
  });

  it('rapid toggling ends in the right state and leaves one timer at most', () => {
    const { menu, events } = setup(9000);
    for (let i = 0; i < 11; i++) menu.toggle();
    expect(menu.isOpen).toBe(true);
    expect(events.length).toBe(11);
    expect(vi.getTimerCount()).toBe(1);
    menu.toggle();
    expect(menu.isOpen).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('destroy closes it and it cannot be opened again', () => {
    const { menu, events } = setup();
    menu.open();
    menu.destroy();
    expect(menu.isOpen).toBe(false);
    expect(events[events.length - 1]).toEqual([false, 'destroy']);
    menu.open();
    expect(menu.isOpen).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('with idle closing off it stays until told', () => {
    const { menu } = setup(null);
    menu.open();
    vi.advanceTimersByTime(3_600_000);
    expect(menu.isOpen).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
