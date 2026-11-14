// @vitest-environment happy-dom
//
// "Never stuck" (DESIGN_SPEC.md 6.4). The owner's one complaint about the Desk Buddy
// mockup was that Doozer "would get stuck randomly". These tests are the guarantee that
// the real view does not:
//
//   - every scene is interrupted at every step of it, in every way there is (picked up,
//     dropped, dropped with the mouse-up lost, another action started, the menu opened,
//     the view switched, tucked away, the display changed), and each time Doozer ends up
//     idle on the taskbar line with nothing left behind. That matrix is stuck-matrix.ts,
//     run in four slices by never-stuck-matrix-*.test.ts;
//   - here: a drag whose mouse-up never arrives, in every form; the watchdog shown to
//     work by breaking the view on purpose, and shown to have nothing to do otherwise;
//     tucked away and unmounted leaving nothing running.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sabotage } from '../../../src/views/desktop';
import { MIN } from '../../core/helpers';
import { AT_REST, cleanUp, mountDesktop, pickUp, pointer, restReport, settle, tap, tick, useFakeClock } from './harness';
import { ready } from './stuck-matrix';

beforeEach(useFakeClock);
afterEach(cleanUp);

describe('a drag whose mouse-up never arrives', () => {
  it('a fast, far drag ends the moment the shell says the button is up', async () => {
    // The case that got the mockup stuck (shell/main.mjs --dragtest): a fast drag, and
    // then no mouse-up at all, only a pointer that turns up somewhere else with no button.
    const r = mountDesktop({ pace: 'lively' });
    const from = { x: r.snap().x, y: r.snap().y - 50 };
    const { hit } = r.parts();
    pointer(hit, 'pointerdown', from, { buttons: 1 });
    for (let i = 1; i <= 12; i++) {
      pointer(hit, 'pointermove', { x: from.x + i * 45, y: from.y - i * 35 }, { buttons: 1 });
      await tick(16);
    }
    expect(r.snap()).toMatchObject({ state: 'carried', pose: 'carried' });
    // The region is under the pointer the whole way: nothing for the window to drop.
    const region = r.view.hitRegions()[0]!;
    expect(region.x).toBeLessThan(from.x + 540);
    expect(region.x + region.w).toBeGreaterThan(from.x + 540);
    r.shell.emit('pointer-released', { x: from.x + 546, y: from.y - 420 });
    expect(r.snap().state).toBe('float');
    await tick(4500);
    r.brain.setSetting('desktopActivity', 'still');
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('with no word from the shell either, it still ends: on the next move with no button, or on the limit', async () => {
    const moved = mountDesktop();
    pickUp(moved, { x: 900, y: 300 });
    pointer(window, 'pointermove', { x: 906, y: 300 }, { buttons: 0 });
    expect(moved.snap().state).toBe('float');
    expect(await settle(moved)).toBe(true);
    expect(restReport(moved)).toEqual(AT_REST);
    moved.view.unmount();

    const silent = mountDesktop();
    pickUp(silent, { x: 900, y: 300 });
    await tick(29_000);
    expect(silent.snap().state).toBe('carried');
    await tick(2000);
    expect(silent.snap().state).not.toBe('carried');
    expect(await settle(silent)).toBe(true);
    expect(restReport(silent)).toEqual(AT_REST);
  });

  it('rapid presses, drags and releases in any order always end at rest', async () => {
    const r = mountDesktop({ pace: 'lively', setup: ready });
    const { hit } = r.parts();
    for (let i = 0; i < 300; i++) {
      const at = { x: 200 + ((i * 397) % 2100), y: 100 + ((i * 211) % 1200) };
      const kind = i % 7;
      if (kind === 0) pickUp(r, at);
      else if (kind === 1) pointer(hit, 'pointerup', at);
      else if (kind === 2) tap(r, 90 + (i % 5) * 80);
      else if (kind === 3) pointer(hit, 'pointerdown', at, { buttons: 1 });
      else if (kind === 4) pointer(window, 'pointermove', at, { buttons: i % 2 });
      else if (kind === 5) r.shell.emit('pointer-released', at);
      else pointer(hit, 'pointercancel', at);
      await tick(10 + (i % 4) * 30);
      expect(r.view.watch(), `step ${i}`).toEqual([]);
    }
    pointer(window, 'pointerup', { x: 0, y: 0 });
    r.brain.setSetting('desktopActivity', 'still');
    r.view.setOpen('none');
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
  });
});

describe('the watchdog', () => {
  const broken: [Sabotage, RegExp][] = [
    ['off-the-line', /drawn somewhere other/],
    ['stuck-pose', /standing idle in the "walk" pose/],
    ['lost-timers', /nothing will start the next stroll/],
    ['ghost-carry', /drawn as held/],
    ['litter', /left lying beside Doozer/],
  ];

  for (const [what, says] of broken) {
    it(`puts Doozer back when the view is broken on purpose: ${what}`, async () => {
      const r = mountDesktop({ pace: 'calm' });
      await tick(2000);
      r.view.sabotage(what);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      // Nobody calls it: its own timer finds the problem.
      await tick(5500);
      warn.mockRestore();
      const s = r.snap();
      expect(s.rescues).toHaveLength(1);
      expect(s.rescues[0]!.problems.join('; ')).toMatch(says);
      expect({ ...restReport(r), rescues: 0 }).toEqual(AT_REST);
      expect(r.parts().pet.style.transform).toBe(`translate(${(s.x - 56).toFixed(2)}px, ${(s.y - 112 * 0.93).toFixed(2)}px)`);
      expect(s.timers).toEqual(expect.arrayContaining(['decide', 'peek', 'blink', 'watchdog']));
      // Once is enough: nothing is wrong afterwards.
      expect(r.view.watch()).toEqual([]);
      await tick(MIN);
      expect(r.snap().rescues).toHaveLength(1);
    });
  }

  it('looks every second while something is going on, and seldom at rest', async () => {
    const r = mountDesktop({ pace: 'calm' });
    await tick(6000);
    const timers = (): number => vi.getTimerCount();
    expect(r.snap().timers).toContain('watchdog');
    // At rest: a handful of timers, none of them fast.
    expect(timers()).toBeLessThan(12);
    r.view.act('stroll');
    r.view.sabotage('litter');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await tick(1100);
    warn.mockRestore();
    // Mid-scene a prop is expected, so nothing was wrong...
    expect(r.snap().rescues).toHaveLength(0);
    expect(await settle(r)).toBe(true);
    // ...and the scene's own ending cleared it away.
    expect(r.snap().props).toBe(0);
  });

  it('finds nothing to do through an hour of Lively', async () => {
    const r = mountDesktop({ pace: 'lively', setup: ready });
    for (let t = 0; t < 60 * MIN; t += 250) {
      await tick(250);
      if (t % (5 * MIN) === 0) ready(r.brain);
      if (t % 30_000 === 0) [() => r.brain.feed(), () => r.brain.play(), () => r.brain.wash(), () => r.brain.pet()][(t / 30_000) % 4]!();
    }
    const s = r.snap();
    expect(s.rescues).toEqual([]);
    expect(s.overruns).toEqual([]);
    expect(s.scenes.stroll!.finished).toBeGreaterThan(50);
    expect(s.scenes.peek!.finished).toBeGreaterThan(5);
    expect(s.scenes.play!.finished).toBeGreaterThan(10);
  });
});

describe('tucked away, and unmounted', () => {
  it('tucked away stops every timer of the view, whatever it was doing', async () => {
    const r = mountDesktop({ pace: 'lively', setup: ready });
    r.brain.play();
    await tick(1500);
    r.view.setAwake?.(false);
    expect(r.snap()).toMatchObject({ state: 'away', timers: [], lively: false, props: 0, emotes: 0, scene: null });
    expect(r.view.hitRegions()).toEqual([]);
    const x = r.snap().x;
    // Nothing the brain says, and nothing the pointer does, starts anything.
    r.brain.feed();
    r.brain.pet();
    tap(r);
    pickUp(r, { x: 300, y: 300 });
    r.view.setOpen('card');
    await tick(10 * MIN);
    expect(r.snap()).toMatchObject({ state: 'away', timers: [], x, open: 'none', props: 0, emotes: 0 });
    r.view.setAwake?.(true);
    expect(r.snap().timers).toEqual(expect.arrayContaining(['decide', 'peek', 'blink', 'watchdog', 'gesture']));
    r.brain.setSetting('desktopActivity', 'still');
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('a session that ends while tucked away is celebrated when Doozer is back', async () => {
    const r = mountDesktop();
    r.brain.startFocus();
    await tick(2000);
    r.view.setAwake?.(false);
    r.brain.debug?.finishFocusNow();
    expect(r.snap()).toMatchObject({ scene: null, emotes: 0 });
    r.view.setAwake?.(true);
    expect(r.snap().scene).toBe('celebrate');
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('unmount leaves no timer and no listener behind', async () => {
    const before = vi.getTimerCount();
    const r = mountDesktop({ pace: 'lively', setup: ready });
    r.brain.play();
    await tick(900);
    pickUp(r, { x: 500, y: 500 });
    await tick(300);
    r.view.unmount();
    expect(vi.getTimerCount()).toBe(before);
    expect(r.root.childElementCount).toBe(0);
    expect(r.shell.listeners('pointer-released')).toBe(0);
    expect(r.view.snapshot()).toBeNull();
    expect(r.view.hitRegions()).toEqual([]);
    // The brain and the pointer go on; nothing answers.
    r.brain.feed();
    pointer(window, 'pointermove', { x: 10, y: 10 }, { buttons: 1 });
    pointer(window, 'pointerup', { x: 10, y: 10 });
    window.dispatchEvent(new Event('blur'));
    r.shell.emit('pointer-released', null);
    await tick(MIN);
    expect(vi.getTimerCount()).toBe(before);
  });

  it('popped out for a window change, Doozer comes back by itself if the host never says so', async () => {
    const r = mountDesktop({ pace: 'lively' });
    void r.view.leave?.();
    await tick(300);
    expect(r.snap()).toMatchObject({ state: 'gone', gone: true });
    expect(r.view.hitRegions()).toEqual([]);
    expect(r.view.act('stroll')).toBe(false);
    await tick(1600);
    expect(r.snap().gone).toBe(false);
    expect(r.view.hitRegions()).toHaveLength(1);
  });
});
