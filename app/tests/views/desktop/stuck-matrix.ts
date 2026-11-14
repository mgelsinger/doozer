// The interruption matrix behind the "never stuck" tests (DESIGN_SPEC.md 6.4): every scene
// of the Desktop view, cut at every step of it, in every way a scene can be interrupted.
// After each cut Doozer has to come to rest on the taskbar line with nothing left behind,
// and the watchdog, asked after every step, must never have anything to put right.
//
// It is a module rather than one test file so that it can be run in slices, side by side
// (never-stuck-matrix-*.test.ts): played in full it is a few thousand runs of the view.

import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Brain } from '../../../src/core';
import {
  AT_REST, infoFor, mountDesktop, pickUp, pointer, restReport, settle, tap, tick, type MountOptions, type Rig,
} from './harness';

/** A pet that can do anything asked of it: hungry enough, awake enough, a few treats. */
export const ready = (brain: Brain): void => {
  brain.debug?.setNeeds({ tummy: 40, fun: 40, energy: 60, clean: 30 });
  brain.debug?.addTreats(6);
};

interface SceneCase {
  name: string;
  mount: MountOptions;
  /** Start the scene. */
  start(r: Rig): void | Promise<void>;
  /** The snapshot says the scene is still going. */
  going(r: Rig): boolean;
}

export const SCENES: SceneCase[] = [
  { name: 'a Calm stroll', mount: { pace: 'calm' }, start: (r) => void r.view.act('stroll'), going: (r) => r.snap().scene === 'stroll' },
  { name: 'a Lively stroll', mount: { pace: 'lively' }, start: (r) => void r.view.act('stroll'), going: (r) => r.snap().scene === 'stroll' },
  { name: 'a Calm peekaboo', mount: { pace: 'calm' }, start: (r) => void r.view.act('peek'), going: (r) => r.snap().scene === 'peek' },
  { name: 'a Lively peekaboo', mount: { pace: 'lively' }, start: (r) => void r.view.act('peek'), going: (r) => r.snap().scene === 'peek' },
  { name: 'a meal, Calm', mount: { pace: 'calm' }, start: (r) => void r.brain.feed(), going: (r) => r.snap().scene === 'eat' },
  { name: 'a meal, Lively', mount: { pace: 'lively' }, start: (r) => void r.brain.feed(), going: (r) => r.snap().scene === 'eat' },
  { name: 'a treat', mount: { pace: 'lively' }, start: (r) => void r.brain.giveTreat(), going: (r) => r.snap().scene === 'eat' },
  { name: 'ball play, Calm', mount: { pace: 'calm' }, start: (r) => void r.brain.play(), going: (r) => r.snap().scene === 'play' },
  { name: 'ball play, Lively', mount: { pace: 'lively' }, start: (r) => void r.brain.play(), going: (r) => r.snap().scene === 'play' },
  { name: 'a wash', mount: { pace: 'calm' }, start: (r) => void r.brain.wash(), going: (r) => r.snap().scene === 'wash' },
  {
    name: 'a celebration', mount: { pace: 'calm' },
    start: (r) => { r.brain.startFocus(); r.brain.debug?.finishFocusNow(); },
    going: (r) => r.snap().scene === 'celebrate',
  },
  { name: 'falling asleep', mount: { pace: 'calm' }, start: (r) => void r.brain.sleep(), going: (r) => r.snap().busy },
  {
    name: 'waking up', mount: { pace: 'calm', setup: (brain) => { ready(brain); brain.sleep(); } },
    start: (r) => void r.brain.wake(), going: (r) => r.snap().busy,
  },
  { name: 'the welcome', mount: { pace: 'calm', needsWelcome: true }, start: (r) => void r.view.enter?.(), going: (r) => r.snap().scene === 'welcome' },
  {
    name: 'the float down', mount: { pace: 'calm' },
    start: (r) => { pointer(r.parts().hit, 'pointerup', pickUp(r, { x: 1200, y: 200 })); },
    going: (r) => r.snap().state === 'float',
  },
  {
    name: 'coming back in from the edge', mount: { pace: 'calm' },
    start: async (r) => {
      r.view.act('peek');
      for (let i = 0; i < 400 && r.snap().pose !== 'peek'; i++) await tick(100);
      // A refusal cuts the peek short, half off the screen.
      r.brain.debug?.setNeeds({ tummy: 100 });
      r.brain.feed();
      r.brain.debug?.setNeeds({ tummy: 40 });
      await tick(1);
    },
    going: (r) => r.snap().scene === 'return',
  },
];

interface Interruption {
  name: string;
  /** Do it. Returns after anything it needs to check about the moment itself. */
  run(r: Rig, turn: number): void | Promise<void>;
}

const ACTIONS: ((brain: Brain) => void)[] = [
  (brain) => void brain.feed(),
  (brain) => void brain.play(),
  (brain) => void brain.wash(),
  (brain) => void brain.giveTreat(),
  (brain) => void brain.pet(),
  (brain) => void brain.toggleSleep(),
  (brain) => void brain.startFocus(),
  (brain) => { brain.debug?.setNeeds({ tummy: 100 }); brain.feed(); },   // a refusal
  (brain) => void brain.fillBowl(),
];

const small = infoFor({ x: 0, y: 0, w: 1366, h: 768 }, { x: 0, y: 0, w: 1366, h: 728 });

const INTERRUPTIONS: Interruption[] = [
  {
    name: 'picked up',
    async run(r) {
      const to = pickUp(r, { x: 700, y: 500 });
      const s = r.snap();
      // In the hand: the scene is gone and so is everything it had put out.
      expect({ state: s.state, scene: s.scene, props: s.props, open: s.open, pose: s.pose }).toEqual({ state: 'carried', scene: null, props: 0, open: 'none', pose: 'carried' });
      await tick(2500);
      expect(r.snap().state).toBe('carried');
      pointer(r.parts().hit, 'pointerup', to);
    },
  },
  {
    name: 'picked up and dropped at once',
    run(r) {
      const to = pickUp(r, { x: 1900, y: 300 });
      pointer(window, 'pointerup', to);
      expect(r.snap().state).toBe('float');
    },
  },
  {
    name: 'picked up, and the mouse-up never arrives',
    async run(r, turn) {
      pickUp(r, { x: 400, y: 900 });
      await tick(200);
      // Three ways the page can find out anyway, in turn.
      if (turn % 3 === 0) r.shell.emit('pointer-released', { x: 5000, y: -200 });
      else if (turn % 3 === 1) pointer(window, 'pointermove', { x: 400, y: 900 }, { buttons: 0 });
      else window.dispatchEvent(new Event('blur'));
      expect(r.snap().state).not.toBe('carried');
    },
  },
  {
    name: 'another action started',
    run(r, turn) {
      ACTIONS[turn % ACTIONS.length]!(r.brain);
    },
  },
  {
    name: 'the menu opened',
    async run(r, turn) {
      tap(r);
      await tick(300);
      if (turn % 2 === 0) r.view.setOpen('card');
      await tick(300);
      r.view.setOpen('none');
    },
  },
  {
    name: 'the view switched away and back',
    async run(r, turn) {
      void r.view.leave?.();
      expect(r.view.hitRegions()).toEqual([]);
      await tick(turn % 2 === 0 ? 260 : 60);
      if (turn % 3 === 0) {
        // The switch did not happen after all: Doozer pops back in.
        void r.view.enter?.();
        return;
      }
      r.view.unmount();
      expect(r.root.childElementCount).toBe(0);
      void r.view.mount(r.root, r.context);
      void r.view.enter?.();
    },
  },
  {
    name: 'tucked away and brought back',
    async run(r) {
      r.view.setAwake?.(false);
      const s = r.snap();
      expect({ state: s.state, timers: s.timers, props: s.props, open: s.open, lively: s.lively, regions: r.view.hitRegions().length })
        .toEqual({ state: 'away', timers: [], props: 0, open: 'none', lively: false, regions: 0 });
      await tick(4000);
      expect(r.snap().timers).toEqual([]);
      r.view.setAwake?.(true);
    },
  },
  {
    name: 'the display changed',
    run(r) {
      r.view.windowChanged?.(small);
    },
  },
];

/** What the scene looks like at one moment: a change in this is a new step of the scene. */
const signature = (r: Rig): string => {
  const s = r.snap();
  const { world, pet } = r.parts();
  const snack = world.querySelector<HTMLElement>('.deskv-food');
  return [s.state, s.pose, s.props, snack?.dataset.bite ?? '-', s.busy ? 'busy' : '', pet.querySelectorAll('.dzk-emote').length > 0 ? 'emotes' : ''].join('|');
};

/**
 * Play the scene through with nothing interrupting it, and work out when to cut it: at
 * the start, just before and just after every moment something about it changes (a walk
 * ends, a bite is taken, a face comes or goes), at a dozen evenly spaced moments through
 * its long stretches, and just after it has ended.
 */
async function cutsFor(scene: SceneCase): Promise<number[]> {
  const stepMs = 50;
  const r = mountDesktop({ setup: ready, ...scene.mount });
  await scene.start(r);
  const cuts = new Set<number>([0, stepMs]);
  let last = signature(r);
  let t = 0;
  while (scene.going(r) && t < 120_000) {
    await tick(stepMs);
    t += stepMs;
    const now = signature(r);
    if (now !== last) {
      for (const at of [t - stepMs, t, t + 3 * stepMs]) cuts.add(Math.max(0, at));
      last = now;
    }
  }
  expect(scene.going(r)).toBe(false);
  const total = t;
  for (let i = 1; i <= 12; i++) cuts.add(Math.round((total * i) / 13 / stepMs) * stepMs);
  cuts.add(total + 2 * stepMs);
  // Left alone it ends by itself, with nothing for the watchdog to do.
  r.brain.setSetting('desktopActivity', 'still');
  expect(await settle(r)).toBe(true);
  expect(r.snap().rescues).toEqual([]);
  expect(r.snap().overruns).toEqual([]);
  r.view.unmount();
  document.body.replaceChildren();
  return [...cuts].filter((cut) => cut <= total + 2 * stepMs).sort((x, y) => x - y);
}


/** The matrix for the scenes numbered `from` up to (not including) `to`. */
export function describeMatrix(from: number, to: number): void {
  describe('every scene, interrupted at every step, in every way', () => {
    for (const scene of SCENES.slice(from, to)) matrixFor(scene);
  });
}

function matrixFor(scene: SceneCase): void {
    it(scene.name, async () => {
      const cuts = await cutsFor(scene);
      expect(cuts.length).toBeGreaterThan(10);
      let runs = 0;
      for (const cut of cuts) {
        for (const [index, interruption] of INTERRUPTIONS.entries()) {
          const turn = runs++;
          const r = mountDesktop({ setup: ready, ...scene.mount, seed: 5 });
          const label = `${scene.name}, ${interruption.name}, at ${cut} ms`;
          await scene.start(r);
          for (let t = 0; t < cut; t += 50) {
            await tick(50);
            expect(r.view.watch(), label).toEqual([]);
          }
          await interruption.run(r, turn + index);
          // Whatever happens next, the watchdog never has anything to put right...
          for (let t = 0; t < 2400; t += 200) {
            await tick(200);
            expect(r.view.watch(), label).toEqual([]);
          }
          // ...and Doozer comes to rest on the line with nothing left behind.
          r.brain.setSetting('desktopActivity', 'still');
          r.brain.stopFocus();
          if (r.brain.state.asleep) r.brain.wake();
          expect(await settle(r, 180_000, 250), label).toBe(true);
          expect(restReport(r), label).toEqual(AT_REST);
          expect(r.view.watch(), label).toEqual([]);
          r.view.unmount();
          document.body.replaceChildren();
        }
      }
      expect(runs).toBeGreaterThan(INTERRUPTIONS.length * 10);
      // Set DOOZER_STUCK_COUNT to a file name to have the numbers written there.
      if (process.env.DOOZER_STUCK_COUNT) appendFileSync(process.env.DOOZER_STUCK_COUNT, `${scene.name}	${cuts.length}	${runs}
`);
    }, 120_000);
}
