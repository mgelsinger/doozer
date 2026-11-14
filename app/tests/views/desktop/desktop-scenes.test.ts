// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DesktopSnapshot } from '../../../src/views/desktop';
import { readSpots } from '../../../src/views/desktop/stage';
import { MIN } from '../../core/helpers';
import {
  AT_REST, INFO, cleanUp, doozerAt, infoFor, mountDesktop, pickUp, pointer, restReport, settle, tap, tick, useFakeClock, type Rig,
} from './harness';

beforeEach(useFakeClock);
afterEach(cleanUp);

/** Sample the view every `stepMs` until it is at rest again (or the limit). */
async function follow(r: Rig, limitMs: number, stepMs = 100): Promise<DesktopSnapshot[]> {
  const seen: DesktopSnapshot[] = [];
  for (let t = 0; t < limitMs; t += stepMs) {
    await tick(stepMs);
    const s = r.snap();
    seen.push(s);
    if (s.atRest && !s.busy && s.emotes === 0 && t > 300) break;
  }
  return seen;
}

const food = (r: Rig): HTMLElement | null => r.parts().world.querySelector<HTMLElement>('.deskv-food');
const ball = (r: Rig): HTMLElement | null => r.parts().world.querySelector<HTMLElement>('.deskv-ball:not([data-bye])');

describe('peekaboo', () => {
  it('walks to the nearer edge, slips half-way off, peeks back in, and returns', async () => {
    const r = mountDesktop({ pace: 'calm' });
    const home = r.snap().home;
    expect(r.view.act('peek')).toBe(true);
    const seen = await follow(r, 3 * MIN);
    const stage = r.snap().stage;
    // The default spot is right of the middle: the right edge is the nearer one.
    const farthest = Math.max(...seen.map((s) => s.x));
    expect(farthest).toBeGreaterThan(stage.w);
    expect(farthest).toBeLessThan(stage.w + stage.size * 0.2);
    const peeking = seen.filter((s) => s.pose === 'peek');
    expect(peeking.length).toBeGreaterThan(20);
    // While it peeks, only the half of it that is on the screen catches the mouse.
    expect(seen.some((s) => s.scene === 'peek' && s.x > stage.w)).toBe(true);
    // Never off the line, and it ends where it lives.
    for (const s of seen) expect(s.y).toBe(s.ground);
    expect(r.snap().x).toBeCloseTo(home, 0);
    expect(r.snap().scenes.peek).toMatchObject({ finished: 1 });
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('half off the screen, the hit region is only the half that is on it', async () => {
    const r = mountDesktop({ pace: 'calm' });
    r.view.act('peek');
    for (let i = 0; i < 400 && r.snap().pose !== 'peek'; i++) await tick(100);
    expect(r.snap().pose).toBe('peek');
    const s = r.snap();
    const region = r.view.hitRegions()[0]!;
    expect(region.x + region.w).toBe(s.stage.w);
    expect(region.w).toBeLessThan(40);
    expect(region.w).toBeGreaterThan(20);
  });

  it('goes to the left edge when that is nearer', async () => {
    const r = mountDesktop({ pace: 'calm' });
    pointer(r.parts().hit, 'pointerup', pickUp(r, { x: 500, y: 1340 }));
    expect(await settle(r)).toBe(true);
    expect(r.view.act('peek')).toBe(true);
    const seen = await follow(r, 3 * MIN);
    expect(Math.min(...seen.map((s) => s.x))).toBeLessThan(0);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('happens by itself about every ten minutes in Calm, and never in Still', async () => {
    const calm = mountDesktop({ pace: 'calm' });
    await tick(60 * MIN);
    const peeks = calm.snap().scenes.peek?.finished ?? 0;
    expect(peeks).toBeGreaterThanOrEqual(3);
    expect(peeks).toBeLessThanOrEqual(9);
    expect(calm.snap().rescues).toEqual([]);
    expect(calm.snap().overruns).toEqual([]);
    calm.view.unmount();

    const still = mountDesktop({ pace: 'still' });
    await tick(60 * MIN);
    expect(still.snap().scenes.peek).toBeUndefined();
    expect(still.view.act('peek')).toBe(false);
  });

  it('never during a focus session, and never while asleep', async () => {
    const r = mountDesktop({ pace: 'lively' });
    r.brain.startFocus();
    expect(await settle(r)).toBe(true);
    expect(r.view.act('peek')).toBe(false);
    expect(r.view.act('stroll')).toBe(false);
    r.brain.stopFocus();
    r.brain.debug?.setNeeds({ energy: 30 });
    r.brain.sleep();
    expect(await settle(r)).toBe(true);
    expect(r.view.act('peek')).toBe(false);
    expect(r.view.act('stroll')).toBe(false);
  });

  it('a peek cut short while half off the screen brings Doozer back in', async () => {
    const r = mountDesktop({ pace: 'calm' });
    r.view.act('peek');
    for (let i = 0; i < 400 && r.snap().pose !== 'peek'; i++) await tick(100);
    r.brain.setSetting('desktopActivity', 'still');
    // A refusal ends whatever Doozer was doing.
    r.brain.debug?.setNeeds({ tummy: 100 });
    r.brain.feed();
    expect(r.snap().scene).toBeNull();
    expect(await settle(r)).toBe(true);
    expect(r.snap().scenes.return).toMatchObject({ finished: 1 });
    expect(restReport(r)).toEqual(AT_REST);
  });
});

describe('what the brain says happened', () => {
  it('Calm: a meal lands within reach and is eaten where Doozer stands', async () => {
    const r = mountDesktop({ pace: 'calm', setup: (brain) => brain.debug?.setNeeds({ tummy: 40 }) });
    const x = r.snap().x;
    expect(r.brain.feed().ok).toBe(true);
    expect(r.snap().scene).toBe('eat');
    const snack = food(r);
    expect(snack).not.toBeNull();
    const bites: string[] = [];
    let moved = 0;
    for (let i = 0; i < 60 && r.snap().scene === 'eat'; i++) {
      await tick(100);
      moved = Math.max(moved, Math.abs(r.snap().x - x));
      const bite = food(r)?.dataset.bite;
      if (bite && bites.at(-1) !== bite) bites.push(bite);
    }
    expect(bites).toEqual(['1', '2', '3']);
    expect(moved).toBe(0);
    expect(food(r)).toBeNull();
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('Lively: the meal lands a little way off and Doozer runs to it', async () => {
    const r = mountDesktop({ pace: 'lively', setup: (brain) => brain.debug?.setNeeds({ tummy: 40 }) });
    expect(await settle(r, 60_000)).toBe(true);
    r.brain.setSetting('desktopActivity', 'lively');
    const x = r.snap().x;
    r.brain.feed();
    const snack = food(r)!;
    const foodX = Number.parseFloat(snack.style.left) + 19;
    expect(Math.abs(foodX - x)).toBeGreaterThanOrEqual(79);
    expect(Math.abs(foodX - x)).toBeLessThanOrEqual(111);
    const poses = new Set<string>();
    for (let i = 0; i < 80 && r.snap().scene === 'eat'; i++) {
      await tick(100);
      poses.add(r.snap().pose);
    }
    expect(poses.has('trot')).toBe(true);
    expect(poses.has('eat')).toBe(true);
    expect(r.snap().scenes.eat).toMatchObject({ finished: 1 });
    // It stopped at the snack, not on top of it.
    expect(Math.abs(Math.abs(r.snap().x - foodX) - 47)).toBeLessThan(2);
    expect(r.snap().props).toBe(0);
  });

  it('a treat, and the favourite gets a bigger reaction', async () => {
    const r = mountDesktop({ pace: 'calm', setup: (brain) => brain.debug?.addTreats(5) });
    const favourite = r.brain.state.favourite;
    let wasFavourite = false;
    r.brain.on('action', (event) => { if (event.type === 'treat') wasFavourite = event.favourite; });
    expect(r.brain.giveTreat().ok).toBe(true);
    expect(food(r)?.dataset.item).toBeDefined();
    expect(await settle(r)).toBe(true);
    expect(r.snap().scenes.eat).toMatchObject({ finished: 1 });
    expect(typeof favourite).toBe('string');
    expect(typeof wasFavourite).toBe('boolean');
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('Calm: Doozer bats the ball about where it stands and does not run after it', async () => {
    const r = mountDesktop({ pace: 'calm' });
    const x = r.snap().x;
    expect(r.brain.play().ok).toBe(true);
    expect(r.snap()).toMatchObject({ scene: 'play', ball: true, pose: 'play' });
    // The ball catches the mouse too.
    expect(r.view.hitRegions()).toHaveLength(2);
    let farthestBall = 0;
    let highest = Infinity;
    let moved = 0;
    for (let i = 0; i < 80 && r.snap().ball; i++) {
      await tick(50);
      const node = ball(r);
      if (!node) break;
      const [bx, by] = node.style.translate.split(' ').map((v) => Number.parseFloat(v)) as [number, number];
      farthestBall = Math.max(farthestBall, Math.abs(bx + 18 - x));
      highest = Math.min(highest, by);
      moved = Math.max(moved, Math.abs(r.snap().x - x));
    }
    expect(moved).toBe(0);
    // Close to where it stands, and up in the air between bats.
    expect(farthestBall).toBeLessThan(90);
    expect(highest).toBeLessThan(r.snap().ground - 200);
    expect(await settle(r)).toBe(true);
    expect(r.snap().scenes.play).toMatchObject({ finished: 1 });
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('Lively: Doozer runs after the ball and kicks it, as the mockup did', async () => {
    const r = mountDesktop({ pace: 'lively' });
    expect(await settle(r, 60_000)).toBe(true);
    const x = r.snap().x;
    r.brain.play();
    expect(r.snap()).toMatchObject({ scene: 'play', ball: true, pose: 'trot' });
    let moved = 0;
    let fastest = 0;
    let last = x;
    for (let i = 0; i < 260 && r.snap().ball; i++) {
      await tick(100);
      const s = r.snap();
      moved = Math.max(moved, Math.abs(s.x - x));
      fastest = Math.max(fastest, Math.abs(s.x - last) * 10);
      last = s.x;
      expect(s.y).toBe(s.ground);
      expect(s.x).toBeGreaterThanOrEqual(s.stage.minX);
      expect(s.x).toBeLessThanOrEqual(s.stage.maxX);
    }
    expect(moved).toBeGreaterThan(60);
    // 150 px a second, as in the mockup.
    expect(fastest).toBeGreaterThan(120);
    expect(fastest).toBeLessThanOrEqual(150 * 1.4);
    expect(await settle(r, 30_000)).toBe(true);
    expect(r.snap().scenes.play).toMatchObject({ finished: 1 });
    expect(r.snap().overruns).toEqual([]);
    expect(r.snap().props).toBe(0);
  });

  it('the ball can be bopped', async () => {
    const r = mountDesktop({ pace: 'calm' });
    r.brain.play();
    await tick(400);
    const node = ball(r)!;
    const before = node.style.translate;
    pointer(node, 'pointerdown', { x: r.snap().x - 30, y: 900 }, { buttons: 1 });
    await tick(120);
    expect(ball(r)?.style.translate).not.toBe(before);
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('a wash: bubbles, a shake, and the duck once it is unlocked', async () => {
    const r = mountDesktop({ pace: 'calm', setup: (brain) => brain.debug?.setNeeds({ clean: 20 }) });
    expect(r.brain.wash().ok).toBe(true);
    expect(r.snap().scene).toBe('wash');
    await tick(300);
    expect(r.snap().emotes).toBeGreaterThan(0);
    expect(await settle(r)).toBe(true);
    expect(r.snap().scenes.wash).toMatchObject({ finished: 1 });
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('petting is a squish and a heart, with no scene', async () => {
    const r = mountDesktop();
    r.brain.pet();
    expect(r.snap().scene).toBeNull();
    expect(r.snap().emotes).toBe(1);
    expect(r.parts().doozer.showing).toBe('love');
    expect(await settle(r)).toBe(true);
  });

  it('a refusal is a head-shake and a "?", never text', async () => {
    const r = mountDesktop({ setup: (brain) => brain.debug?.setNeeds({ tummy: 100 }) });
    expect(r.brain.feed().ok).toBe(false);
    expect(r.parts().doozer.showing).toBe('no');
    expect(r.parts().pet.querySelectorAll('.dzk-emote[data-kind="question"]')).toHaveLength(1);
    // Hammering the button is one "?" per head-shake.
    r.brain.feed();
    r.brain.feed();
    expect(r.parts().pet.querySelectorAll('.dzk-emote[data-kind="question"]')).toHaveLength(1);
    // Nothing is written beside Doozer: no bubble, no message.
    expect(/[a-z]{2,}/i.test(r.parts().pet.textContent ?? '')).toBe(false);
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('falling asleep stops whatever it was doing; it sleeps where it is', async () => {
    const r = mountDesktop({ pace: 'calm', setup: (brain) => brain.debug?.setNeeds({ energy: 30 }) });
    r.view.act('stroll');
    await tick(1500);
    expect(r.snap().scene).toBe('stroll');
    r.brain.sleep();
    expect(r.snap().scene).toBeNull();
    const x = r.snap().x;
    await tick(3000);
    expect(r.parts().doozer.pose).toBe('sleep');
    await tick(10 * MIN);
    expect(r.snap().x).toBe(x);
    expect(r.snap().timers).not.toContain('decide');
    // Asleep it says no without waking: a stir and a z.
    r.brain.play();
    expect(r.brain.state.asleep).toBe(true);
    expect(r.parts().pet.querySelectorAll('.dzk-emote[data-kind="z"]').length).toBeGreaterThan(0);
    r.brain.wake();
    await tick(3000);
    expect(r.snap().timers).toContain('decide');
    expect(await settle(r, 3 * MIN)).toBe(true);
    expect(r.snap().rescues).toEqual([]);
  });

  it('z\'s rise from a sleeping Doozer only while someone is there', async () => {
    const r = mountDesktop({ setup: (brain) => { brain.debug?.setNeeds({ energy: 30 }); brain.sleep(); } });
    await tick(20_000);
    expect(r.snap()).toMatchObject({ lively: false, emotes: 0 });
    expect(r.snap().timers).not.toContain('snore');
    const at = doozerAt(r);
    pointer(r.parts().hit, 'pointermove', at);
    await tick(250);
    pointer(r.parts().hit, 'pointermove', at);
    await tick(2700);
    expect(r.parts().pet.querySelectorAll('.dzk-emote[data-kind="z"]').length).toBe(1);
    await tick(20_000);
    expect(r.snap()).toMatchObject({ lively: false, emotes: 0 });
    expect(r.snap().timers).not.toContain('snore');
  });

  it('a new pet is welcomed once: it pops in, waves and shows its favourite snack', async () => {
    const r = mountDesktop({ needsWelcome: true });
    void r.view.enter?.();
    expect(r.snap().scene).toBe('welcome');
    expect(await settle(r)).toBe(true);
    expect(r.host.calls).toContain('welcomed');
    expect(r.snap().scenes.welcome).toMatchObject({ finished: 1 });
    void r.view.enter?.();
    expect(r.snap().scene).toBeNull();
  });

  it('a welcome cut short is shown again next time', async () => {
    const r = mountDesktop({ needsWelcome: true });
    void r.view.enter?.();
    await tick(600);
    pointer(r.parts().hit, 'pointerup', pickUp(r, { x: 900, y: 600 }));
    expect(await settle(r)).toBe(true);
    expect(r.host.calls).not.toContain('welcomed');
    expect(r.host.state.welcome).toBe(true);
  });

  it('a wave hello after time away, unless asleep or focusing', async () => {
    const r = mountDesktop();
    await tick(8000);
    expect(r.snap().lively).toBe(false);
    await tick(5 * MIN);
    r.brain.tick();
    expect(r.snap().lively).toBe(true);
    expect(r.parts().doozer.busy).toBe(true);
    expect(await settle(r)).toBe(true);
  });
});

describe('focus manners (spec 4.5 and 4.6)', () => {
  it('glasses on, sits still, and nothing else changes', async () => {
    const r = mountDesktop({ pace: 'lively' });
    await tick(20_000);
    expect(r.brain.startFocus().ok).toBe(true);
    // Whatever it was doing ends; it does not finish its walk first.
    expect(r.snap().scene).toBeNull();
    expect(r.parts().doozer.el.dataset.glasses).toBe('1');
    await tick(3000);
    const x = r.snap().x;
    expect(r.parts().doozer.mood).toBe('focus');
    for (let i = 0; i < 24; i++) {
      await tick(MIN);
      r.brain.tick();
      expect(r.snap().x).toBe(x);
      expect(r.snap().emotes).toBe(0);
    }
    expect(r.snap().scenes.stroll?.finished ?? 0).toBeLessThan(12);
    expect(r.snap().timers).not.toContain('decide');
    expect(r.snap().timers).not.toContain('peek');
    expect(r.snap().lively).toBe(false);
    expect(r.snap().rescues).toEqual([]);
  });

  it('the time left appears only while the pointer is on Doozer', async () => {
    const r = mountDesktop();
    r.brain.startFocus();
    await tick(5000);
    expect(r.snap().chip).toBe(false);
    const at = doozerAt(r);
    pointer(r.parts().hit, 'pointermove', at);
    await tick(250);
    pointer(r.parts().hit, 'pointermove', at);
    expect(r.snap().chip).toBe(true);
    expect(r.parts().chip.textContent).toMatch(/^\d\d:\d\d$/);
    pointer(r.parts().hit, 'pointerleave', at);
    expect(r.snap().chip).toBe(false);
    // And it goes by itself if the pointer never says it left.
    pointer(r.parts().hit, 'pointermove', at);
    await tick(250);
    pointer(r.parts().hit, 'pointermove', at);
    expect(r.snap().chip).toBe(true);
    await tick(4200);
    expect(r.snap().chip).toBe(false);
  });

  it('no chip when no session is on', async () => {
    const r = mountDesktop();
    const at = doozerAt(r);
    pointer(r.parts().hit, 'pointermove', at);
    await tick(250);
    pointer(r.parts().hit, 'pointermove', at);
    expect(r.snap()).toMatchObject({ hover: true, chip: false });
  });

  it('a meal from the bowl during a session is eaten quietly, on the spot', async () => {
    const r = mountDesktop({ pace: 'lively' });
    r.brain.startFocus();
    expect(await settle(r)).toBe(true);
    const x = r.snap().x;
    r.brain.debug?.setNeeds({ tummy: 50 });
    r.brain.fillBowl();
    expect(r.snap().scene).toBe('eat');
    let emotes = 0;
    for (let i = 0; i < 40 && r.snap().scene === 'eat'; i++) {
      await tick(100);
      emotes = Math.max(emotes, r.snap().emotes);
      expect(r.snap().x).toBe(x);
    }
    expect(emotes).toBe(0);
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('when the session ends Doozer celebrates, and the Card stays shut unless asked for', async () => {
    const r = mountDesktop();
    r.brain.startFocus();
    await tick(3000);
    r.brain.debug?.finishFocusNow();
    expect(r.snap().scene).toBe('celebrate');
    expect(r.snap().emotes).toBeGreaterThan(0);
    expect(r.snap().open).toBe('none');
    expect(r.host.calls.filter((call) => call === 'focusable:true')).toEqual([]);
    expect(await settle(r)).toBe(true);
    expect(r.parts().doozer.el.dataset.glasses).toBe('0');
    expect(restReport(r)).toEqual(AT_REST);

    r.brain.setSetting('onFocusEnd', 'open-card');
    r.brain.startFocus();
    await tick(2000);
    r.brain.debug?.finishFocusNow();
    expect(r.snap().open).toBe('card');
    expect(r.host.calls.filter((call) => call === 'focusable:true')).toEqual([]);
  });

  it('paused, it may wander again; stopped early, nothing is said', async () => {
    const r = mountDesktop({ pace: 'lively' });
    r.brain.startFocus();
    expect(await settle(r)).toBe(true);
    r.brain.pauseFocus();
    expect(r.snap().timers).toContain('decide');
    r.brain.resumeFocus();
    expect(await settle(r, 3 * MIN)).toBe(true);
    expect(r.snap().timers).not.toContain('decide');
    const emotes = r.snap().emotes;
    r.brain.stopFocus();
    expect(r.snap().emotes).toBe(emotes);
    expect(r.snap().scene).toBeNull();
    expect(r.snap().timers).toContain('decide');
  });
});

describe('the spot Doozer lives at, per monitor', () => {
  it('starts right of the middle, and remembers where it was put down', async () => {
    const r = mountDesktop();
    expect(r.snap().x).toBe(Math.round(2560 * 0.72));
    expect(r.memory.writes).toBe(0);
    pointer(r.parts().hit, 'pointerup', pickUp(r, { x: 640, y: 800 }));
    expect(await settle(r)).toBe(true);
    expect(r.memory.writes).toBe(1);
    const spots = readSpots(r.memory.value);
    expect(Object.keys(spots)).toEqual(['3840x2160@0,0']);
    expect(spots['3840x2160@0,0']!.f).toBeCloseTo(r.snap().x / 2560, 3);

    // The next time the view is opened on this monitor, that is where Doozer is.
    r.view.unmount();
    const again = mountDesktop({ memory: r.memory.value });
    expect(again.snap().x).toBeCloseTo(r.memory.value ? spots['3840x2160@0,0']!.f * 2560 : 0, 0);
    expect(again.snap().home).toBe(again.snap().x);
  });

  it('a stroll does not move the remembered spot; only being put down does', async () => {
    const r = mountDesktop({ pace: 'calm' });
    await tick(20 * MIN);
    expect(r.snap().scenes.stroll?.finished ?? 0).toBeGreaterThan(2);
    expect(r.memory.writes).toBe(0);
    expect(r.snap().home).toBe(Math.round(2560 * 0.72));
  });

  it('each monitor has its own spot', async () => {
    const second = infoFor({ x: 3840, y: 0, w: 1920, h: 1080 }, { x: 3840, y: 0, w: 1920, h: 1040 });
    const r = mountDesktop();
    pointer(r.parts().hit, 'pointerup', pickUp(r, { x: 400, y: 1300 }));
    expect(await settle(r)).toBe(true);
    const first = r.snap().x;

    // The window is moved to the second monitor.
    r.view.windowChanged?.(second);
    expect(r.snap().stage).toMatchObject({ w: 1920, h: 1040, monitor: '1920x1080@3840,0' });
    expect(r.snap().x).toBe(Math.round(1920 * 0.72));
    pointer(r.parts().hit, 'pointerup', pickUp(r, { x: 1500, y: 900 }));
    expect(await settle(r)).toBe(true);
    const onSecond = r.snap().x;
    expect(Object.keys(readSpots(r.memory.value)).sort()).toEqual(['1920x1080@3840,0', '3840x2160@0,0']);

    // Back on the first: where it was left there.
    r.view.windowChanged?.(INFO);
    expect(r.snap().x).toBeCloseTo(first, 0);
    r.view.windowChanged?.(second);
    expect(r.snap().x).toBeCloseTo(onSecond, 0);
    expect(restReport(r)).toEqual(AT_REST);
  });

  it('a remembered spot that makes no sense is ignored', async () => {
    for (const memory of [null, 7, 'x', { spots: 4 }, { spots: { '3840x2160@0,0': { f: 9 } } }, { spots: { '3840x2160@0,0': { f: 'left' } } }]) {
      const r = mountDesktop({ memory });
      expect(r.snap().x).toBe(Math.round(2560 * 0.72));
      r.view.unmount();
    }
    // A spot from a wider screen is pulled back to where Doozer may stand.
    const r = mountDesktop({ memory: { v: 1, spots: { '3840x2160@0,0': { f: 1, t: 1 } } } });
    expect(r.snap().x).toBe(r.snap().stage.maxX);
  });

  it('works without a save to keep the spot in', async () => {
    const r = mountDesktop();
    r.view.unmount();
    void r.view.mount(r.root, { ...r.context, memory: undefined });
    pointer(r.parts().hit, 'pointerup', pickUp(r, { x: 640, y: 800 }));
    expect(await settle(r)).toBe(true);
    expect(restReport(r)).toEqual(AT_REST);
  });
});

describe('the taskbar on any edge, or hidden', () => {
  const full = { x: 0, y: 0, w: 1920, h: 1080 };
  const cases = [
    { name: 'along the bottom', work: { x: 0, y: 0, w: 1920, h: 1032 }, taskbar: 'bottom', w: 1920, h: 1032 },
    { name: 'along the top', work: { x: 0, y: 48, w: 1920, h: 1032 }, taskbar: 'top', w: 1920, h: 1032 },
    { name: 'down the left', work: { x: 62, y: 0, w: 1858, h: 1080 }, taskbar: 'left', w: 1858, h: 1080 },
    { name: 'down the right', work: { x: 0, y: 0, w: 1858, h: 1080 }, taskbar: 'right', w: 1858, h: 1080 },
    { name: 'auto-hidden', work: { x: 0, y: 0, w: 1920, h: 1080 }, taskbar: 'hidden', w: 1920, h: 1079 },
  ] as const;

  for (const c of cases) {
    it(`${c.name}: Doozer stands on the bottom edge of the work area and everything works there`, async () => {
      const r = mountDesktop({ pace: 'calm', info: infoFor(full, c.work) });
      let s = r.snap();
      expect(s.stage).toMatchObject({ taskbar: c.taskbar, w: c.w, h: c.h });
      expect(s.ground).toBe(c.h - 6);
      expect(s.y).toBe(s.ground);
      const region = r.view.hitRegions()[0]!;
      expect(region.x).toBeGreaterThanOrEqual(0);
      expect(region.x + region.w).toBeLessThanOrEqual(c.w);
      expect(region.y + region.h).toBeLessThanOrEqual(c.h);

      // A stroll, a peek, a carry and a meal all end on that line.
      r.view.act('stroll');
      expect(await settle(r)).toBe(true);
      r.view.act('peek');
      expect(await settle(r)).toBe(true);
      pointer(r.parts().hit, 'pointerup', pickUp(r, { x: 300, y: 200 }));
      expect(await settle(r)).toBe(true);
      r.brain.debug?.setNeeds({ tummy: 40 });
      r.brain.feed();
      expect(await settle(r)).toBe(true);
      tap(r);
      expect(r.view.hitRegions()).toHaveLength(7);
      for (const each of r.view.hitRegions()) {
        expect(each.x).toBeGreaterThanOrEqual(0);
        expect(each.y).toBeGreaterThanOrEqual(0);
        expect(each.x + each.w).toBeLessThanOrEqual(c.w);
        expect(each.y + each.h).toBeLessThanOrEqual(c.h);
      }
      tap(r);
      s = r.snap();
      expect(s.y).toBe(c.h - 6);
      expect(restReport(r)).toEqual(AT_REST);
    });
  }

  it('the taskbar moving from the bottom to the side moves the line with it', async () => {
    const r = mountDesktop({ info: infoFor(full, cases[0].work) });
    expect(r.snap().ground).toBe(1026);
    r.view.windowChanged?.(infoFor(full, cases[2].work));
    expect(r.snap()).toMatchObject({ ground: 1074, y: 1074 });
    expect(r.snap().stage.taskbar).toBe('left');
    // The same monitor: the same spot, give or take the width the taskbar took.
    expect(Object.keys(readSpots(r.memory.value))).toEqual([]);
    expect(restReport(r)).toEqual(AT_REST);
  });
});
