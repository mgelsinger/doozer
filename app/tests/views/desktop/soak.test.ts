// @vitest-environment happy-dom
//
// A soak on the fake clock: thousands of random actions against the whole view and the
// real brain, hours of pretend time in a few seconds. It is the quick twin of the soak
// that runs for real hours in the real window (app/src/views/desktop/checks.ts,
// docs/desktop-checks.md), and it holds the view to the same standard:
//
//   - after every single action the watchdog is asked whether anything is wrong, and the
//     answer must be no: it must never have anything to rescue;
//   - every so often everything is left alone, and Doozer has to come to rest by itself;
//   - at the end Doozer is idle on the taskbar line with nothing left behind.

import { appendFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seeded } from '../../core/helpers';
import {
  AT_REST, INFO, cardButton, cleanUp, doozerAt, infoFor, mountDesktop, pickUp, pointer, radialButton, restReport, tap, tick,
  useFakeClock, type Rig,
} from './harness';
import { ready } from './stuck-matrix';

beforeEach(useFakeClock);
afterEach(cleanUp);

const SCREENS = [
  INFO,
  infoFor({ x: 0, y: 0, w: 1920, h: 1080 }, { x: 0, y: 0, w: 1920, h: 1040 }),
  infoFor({ x: 0, y: 0, w: 1366, h: 768 }, { x: 60, y: 0, w: 1306, h: 768 }),
  infoFor({ x: 2560, y: 0, w: 2560, h: 1440 }, { x: 2560, y: 0, w: 2560, h: 1440 }),
];

interface Tally { actions: number; byKind: Record<string, number>; restChecks: number; slowestRestMs: number }

async function soak(seed: number, steps: number): Promise<{ r: Rig; tally: Tally }> {
  const random = seeded(seed);
  const between = (lo: number, hi: number): number => lo + random() * (hi - lo);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const r = mountDesktop({ pace: 'lively', seed, setup: ready });
  // The host's clock: the brain is ticked four times a second.
  const clock = setInterval(() => r.brain.tick(), 250);
  const tally: Tally = { actions: 0, byKind: {}, restChecks: 0, slowestRestMs: 0 };
  let held: { x: number; y: number } | null = null;
  const anywhere = (): { x: number; y: number } => {
    const s = r.snap();
    return { x: between(-40, s.stage.w + 40), y: between(-40, s.stage.h + 40) };
  };
  const letGo = (): void => {
    if (!held) return;
    const how = Math.floor(random() * 4);
    if (how === 0) pointer(window, 'pointerup', held);
    else if (how === 1) r.shell.emit('pointer-released', held);
    else if (how === 2) pointer(window, 'pointermove', held, { buttons: 0 });
    else pointer(r.parts().hit, 'lostpointercapture', held);
    held = null;
  };

  const actions: [name: string, weight: number, run: () => void | Promise<void>][] = [
    ['wait', 16, () => tick(between(500, 15_000))],
    ['tap Doozer', 8, () => tap(r, between(60, 900))],
    ['press a Radial button', 8, async () => {
      if (r.snap().open !== 'radial') tap(r);
      await tick(between(50, 400));
      if (r.snap().open === 'radial') radialButton(r, pick(['feed', 'play', 'wash', 'sleep', 'treat', 'more'])).click();
    }],
    ['carry and let go', 8, async () => {
      letGo();
      held = pickUp(r, anywhere());
      await tick(between(0, 900));
      letGo();
    }],
    ['carry and keep holding', 5, () => {
      letGo();
      held = pickUp(r, anywhere());
    }],
    ['carry on', 5, () => {
      if (!held) return;
      held = anywhere();
      pointer(r.parts().hit, 'pointermove', held, { buttons: 1 });
    }],
    ['let go', 6, letGo],
    ['press and never release', 2, () => pointer(r.parts().hit, 'pointerdown', doozerAt(r), { buttons: 1 })],
    ['feed', 5, () => void r.brain.feed()],
    ['treat', 4, () => void r.brain.giveTreat()],
    ['play', 6, () => void r.brain.play()],
    ['wash', 4, () => void r.brain.wash()],
    ['pet', 3, () => void r.brain.pet()],
    ['fill the bowl', 2, () => void r.brain.fillBowl()],
    ['nap', 2, () => { r.brain.debug?.setNeeds({ energy: 50 }); r.brain.sleep(); }],
    ['wake', 4, () => void r.brain.wake()],
    ['focus: start', 3, () => void r.brain.startFocus()],
    ['focus: pause or resume', 2, () => (r.brain.state.focus.status === 'running' ? r.brain.pauseFocus() : r.brain.resumeFocus())],
    ['focus: stop', 3, () => r.brain.stopFocus()],
    ['focus: finish', 2, () => r.brain.debug?.finishFocusNow()],
    ['change pace', 5, () => r.brain.setSetting('desktopActivity', pick(['still', 'calm', 'lively', 'lively'] as const))],
    ['change size', 2, () => r.brain.setSetting('size', { ...r.brain.settings.size, desktop: pick(['small', 'medium', 'large'] as const) })],
    ['reduce motion on', 1, () => r.brain.setSetting('reduceMotion', 'on')],
    ['reduce motion off', 3, () => r.brain.setSetting('reduceMotion', 'off')],
    ['when a session ends: open the Card or not', 1, () => r.brain.setSetting('onFocusEnd', r.brain.settings.onFocusEnd === 'quiet' ? 'open-card' : 'quiet')],
    ['the view switched away and back', 3, async () => {
      held = null;
      void r.view.leave?.();
      await tick(between(0, 400));
      r.view.unmount();
      await tick(between(0, 3000));
      void r.view.mount(r.root, r.context);
      void r.view.enter?.();
    }],
    ['a switch that does not happen', 1, async () => {
      void r.view.leave?.();
      await tick(between(0, 2500));
      if (random() < 0.5) void r.view.enter?.();
    }],
    ['tucked away and back', 2, async () => {
      r.view.setAwake?.(false);
      held = null;
      expect(r.snap().timers).toEqual([]);
      await tick(between(200, 20_000));
      expect(r.snap().timers).toEqual([]);
      r.view.setAwake?.(true);
    }],
    ['the display changed', 2, () => r.view.windowChanged?.(pick(SCREENS))],
    ['open the Card and press something', 4, async () => {
      r.view.setOpen('card');
      await tick(between(100, 600));
      if (r.snap().open !== 'card') return;
      const button = cardButton(r, pick(['feed', 'play', 'wash', 'sleep', 'fill', 'treat', 'focus', 'focus-stop', 'mute', 'settings']));
      if (!button.hidden) button.click();
    }],
    ['open the settings', 1, () => r.view.openSettings?.()],
    ['close whatever is open', 3, () => r.view.setOpen('none')],
    ['bop the ball', 3, () => {
      const ball = r.parts().world.querySelector<HTMLElement>('.deskv-ball:not([data-bye])');
      if (ball) pointer(ball, 'pointerdown', anywhere(), { buttons: 1 });
    }],
    ['stroke Doozer', 3, async () => {
      const at = doozerAt(r);
      for (let i = 0; i < 12; i++) {
        pointer(r.parts().hit, 'pointermove', at, { movementX: 30 });
        await tick(45);
      }
      if (random() < 0.5) pointer(r.parts().hit, 'pointerleave', at);
    }],
    ['a stray release, cancel or blur', 4, () => {
      const what = Math.floor(random() * 5);
      const at = anywhere();
      if (what === 0) pointer(window, 'pointerup', at);
      else if (what === 1) pointer(r.parts().hit, 'pointercancel', at);
      else if (what === 2) window.dispatchEvent(new Event('blur'));
      else if (what === 3) r.shell.emit('pointer-released', random() < 0.5 ? at : null);
      else pointer(window, 'pointermove', at, { buttons: Math.floor(random() * 2) });
      if (what !== 4) held = null;
    }],
    ['a stroll, a peek or a gesture, now', 7, () => void r.view.act(pick(['stroll', 'peek', 'peek', 'gesture'] as const))],
    ['right-click', 1, () => r.parts().hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))],
  ];
  const total = actions.reduce((sum, action) => sum + action[1], 0);

  /** Hands off: whatever pace it is at, Doozer comes to rest by itself. */
  const restCheck = async (label: string): Promise<void> => {
    letGo();
    pointer(window, 'pointerup', { x: 0, y: 0 });
    r.view.setOpen('none');
    let waited = 0;
    while (waited < 150_000) {
      const s = r.snap();
      if (s.atRest && !s.busy && s.emotes === 0) break;
      await tick(100);
      waited += 100;
    }
    tally.restChecks++;
    tally.slowestRestMs = Math.max(tally.slowestRestMs, waited);
    expect(restReport(r), `${label}, after waiting ${waited} ms`).toEqual(AT_REST);
  };

  const recent: string[] = [];
  for (let i = 0; i < steps; i++) {
    let roll = random() * total;
    const [name, , run] = actions.find((action) => (roll -= action[1]) < 0) ?? actions[0]!;
    recent.push(name);
    if (recent.length > 8) recent.shift();
    await run();
    tally.actions++;
    tally.byKind[name] = (tally.byKind[name] ?? 0) + 1;
    await tick(between(30, 2600));
    const label = `seed ${seed}, action ${i}: ${recent.join(' > ')}`;
    // The standard: the watchdog never has anything to put right.
    expect(r.view.watch(), label).toEqual([]);
    expect(r.snap().overruns, label).toEqual([]);
    if (i % 20 === 19) ready(r.brain);
    if (i % 60 === 59) await restCheck(label);
  }

  // The end of the run: left alone, at whatever pace it happens to be.
  if (r.brain.state.focus.status !== 'idle') r.brain.stopFocus();
  await restCheck(`seed ${seed}, the end`);
  clearInterval(clock);
  return { r, tally };
}

describe('a soak on the fake clock', () => {
  for (const seed of [1, 20261113, 777]) {
    it(`seed ${seed}: 1,500 random actions, and Doozer ends idle on the taskbar line`, async () => {
      const { r, tally } = await soak(seed, 1500);
      const s = r.snap();
      expect(tally.actions).toBe(1500);
      expect(tally.restChecks).toBe(26);
      // Every kind of action was used.
      expect(Object.keys(tally.byKind).length).toBeGreaterThan(30);
      expect(s.rescues).toEqual([]);
      expect(s.overruns).toEqual([]);
      expect(restReport(r)).toEqual(AT_REST);
      // It did things while it was at it.
      const scenes = Object.values(s.scenes).reduce((sum, scene) => sum + scene.finished + scene.interrupted, 0);
      const carries = Object.values(s.drops).reduce((sum, count) => sum + (count ?? 0), 0);
      if (process.env.DOOZER_SOAK_COUNT) appendFileSync(process.env.DOOZER_SOAK_COUNT, `${JSON.stringify({ seed, tally, scenes: s.scenes, drops: s.drops })}
`);
      expect(scenes).toBeGreaterThan(120);
      expect(carries).toBeGreaterThan(60);
    }, 120_000);
  }
});
