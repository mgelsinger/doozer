// @vitest-environment happy-dom
//
// The owner's one complaint about the mockups was that Doozer "would get stuck randomly".
// These are the Island view's answers, on the fake clock: rapid pokes, a press whose
// mouse-up never arrives, every scene interrupted at several moments by several things,
// the view left in the middle of a scene, frames that never come, a lost graphics
// context, and a long run of random prodding. After each, the island has to come to rest
// by itself, whole, with nothing left over and nothing still ticking that should not be.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTEXT_LIMIT_MS, PRESS_LIMIT_MS } from '../../../src/views/island';
import { islandLayout } from '../../../src/views/island/layout';
import { seeded } from '../../core/helpers';
import { START, arrive, mount, pointer, poke, rest, stroke, tick, type Rig } from './harness';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  (Element.prototype as { animate?: unknown }).animate = undefined;
});
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

/** The timers the view may hold while it is at rest and awake: its small signs of life. */
const AT_REST = new Set(['blink', 'stir', 'wink', 'hover']);

/** The island has come to rest, whole: nothing half-done, nothing left over. */
function expectAtRest(r: Rig, what: string): void {
  const s = r.snap();
  const { world, stage } = r.parts();
  const body = stage.actor.body;
  expect(s.scene, `${what}: scene`).toBeNull();
  expect(s.busy, `${what}: busy`).toBe(false);
  expect(s.moving, `${what}: moving`).toBe(false);
  expect(s.drawing, `${what}: drawing`).toBe(false);
  expect(s.pressed, `${what}: pressed`).toBe(false);
  expect(s.gone, `${what}: gone`).toBe(false);
  expect(s.snack, `${what}: snack`).toBeNull();
  expect(s.particles, `${what}: particles`).toBe(0);
  expect(s.emotes, `${what}: emotes`).toBe(0);
  expect(world.travelling, `${what}: travelling`).toBe(false);
  expect(world.rain, `${what}: rain`).toBe(0);
  expect(world.duck, `${what}: duck`).toBe(0);
  expect(s.night, `${what}: night`).toBe(r.brain.state.asleep ? 1 : 0);
  if (s.ball) expect(s.ball.resting, `${what}: ball`).toBe(true);
  expect(body.grounded, `${what}: on the ground`).toBe(true);
  expect(s.doozer.y, `${what}: height`).toBe(0);
  expect(s.doozer.stretch, `${what}: stretch`).toBeCloseTo(r.brain.state.asleep ? 0.82 : 1, 2);
  expect(body.pose.scale, `${what}: scale`).toBe(1);
  expect(body.pose.yaw, `${what}: facing front`).toBeCloseTo(0, 2);
  expect(Math.hypot(s.doozer.x, s.doozer.z), `${what}: on the island`).toBeLessThan(1.3);
  expect(stage.actor.object.visible, `${what}: visible`).toBe(true);
  expect(s.showing, `${what}: face`).toBe(s.mood);
  for (const name of s.timers) expect(AT_REST.has(name), `${what}: timer "${name}" still armed`).toBe(true);
  expect(r.parts().root.querySelectorAll('.dzk-emote'), `${what}: emote elements`).toHaveLength(0);
}

/** Get up, well fed and clean enough to do anything, with treats in the jar. */
function refresh(r: Rig): void {
  if (r.brain.state.focus.status !== 'idle') r.brain.stopFocus();
  if (r.brain.state.asleep) r.brain.wake();
  r.brain.debug?.setNeeds({ tummy: 35, fun: 40, energy: 62, clean: 35 });
  r.brain.debug?.addTreats(3);
}

const SCENES: readonly [string, (r: Rig) => void][] = [
  ['feed', (r) => void r.brain.feed()],
  ['treat', (r) => void r.brain.giveTreat()],
  ['play', (r) => void r.brain.play()],
  ['wash', (r) => void r.brain.wash()],
  ['sleep', (r) => void r.brain.sleep()],
  ['wake', (r) => { r.brain.sleep(); r.brain.wake(); }],
  ['focus start', (r) => void r.brain.startFocus()],
  ['focus complete', (r) => { r.brain.startFocus(); r.brain.debug?.finishFocusNow(); }],
  ['refusal', (r) => { r.brain.debug?.setNeeds({ tummy: 100 }); void r.brain.feed(); }],
];
const CUTS = [0, 150, 500, 950, 1700, 2600, 4200] as const;

describe('rapid pokes', () => {
  it('two hundred presses in a few seconds: every one jiggles, and it all comes to rest', async () => {
    const r = await mount();
    await rest(r);
    const actions: string[] = [];
    r.brain.on('action', (event) => actions.push(event.type));
    const { touch } = r.parts();
    let lowest = 1;
    for (let i = 0; i < 200; i++) {
      const at = r.onDoozer();
      pointer(touch, 'pointerdown', at, { buttons: 1, gap: 20 });
      await tick(12);
      pointer(touch, 'pointerup', at, { gap: 8 });
      await tick(12);
      lowest = Math.min(lowest, r.snap().doozer.stretch);
      const stretch = r.snap().doozer.stretch;
      expect(stretch).toBeGreaterThanOrEqual(0.55);
      expect(stretch).toBeLessThanOrEqual(1.4);
    }
    expect(lowest).toBeLessThan(0.9);
    expect(actions).toEqual([]);                    // a poke is not a rule
    r.parts().radial.close();
    expect(await rest(r)).toBeLessThan(6000);
    expectAtRest(r, 'after rapid pokes');
    // And it still answers.
    poke(r);
    expect(r.snap().radial).toBe(true);
    r.brain.debug?.setNeeds({ tummy: 30 });
    r.parts().radial.el.querySelector<HTMLButtonElement>('[data-id="feed"]')?.click();
    expect(r.snap().scene).toBe('eat');
  });

  it('pokes on everything at once: Doozer, the ball, the snack, the grass', async () => {
    const r = await mount();
    const { world } = r.parts();
    const layout = islandLayout('medium');
    world.serveBall('ball');
    r.brain.debug?.setNeeds({ tummy: 30 });
    r.brain.feed();
    const random = seeded(8);
    for (let i = 0; i < 150; i++) {
      const s = r.snap();
      const spot = random() < 0.4 ? r.onDoozer()
        : random() < 0.5 && s.ball ? { x: s.ball.screen.x - layout.sceneLeft, y: s.ball.screen.y - layout.sceneTop }
        : { x: 40 + random() * 300, y: 240 + random() * 150 };
      poke(r, spot, 15 + random() * 60);
      await tick(10 + random() * 50);
    }
    r.parts().radial.close();
    expect(await rest(r)).toBeLessThan(16_000);
    expectAtRest(r, 'after pokes everywhere');
  });
});

describe('a press whose mouse-up never arrives', () => {
  async function held(): Promise<Rig> {
    const r = await mount();
    await rest(r);
    const { touch } = r.parts();
    const at = r.onDoozer();
    pointer(touch, 'pointerdown', at, { buttons: 1, gap: 1000 });
    // The pointer leaves at speed with the button still down, stroking as it goes.
    for (let i = 1; i <= 8; i++) pointer(touch, 'pointermove', { x: at.x + i * 40, y: at.y + i * 25 }, { buttons: 1, movementX: 40, movementY: 25 });
    expect(r.snap().pressed).toBe(true);
    return r;
  }

  it('ends as soon as the shell says the button is up, and toggles nothing', async () => {
    const r = await held();
    await tick(400);
    expect(r.snap().pressed).toBe(true);            // held all this while
    expect(r.snap().doozer.stretch).toBeLessThan(0.93);
    r.shell.emit('pointer-released', { x: 900, y: 700 });
    expect(r.snap().pressed).toBe(false);
    expect(r.snap().radial).toBe(false);
    expect(await rest(r)).toBeLessThan(8000);
    expectAtRest(r, 'after the shell ended the press');
    poke(r);
    expect(r.snap().radial).toBe(true);             // the next press works
  });

  it('ends on the next move with no button held', async () => {
    const r = await held();
    pointer(r.parts().touch, 'pointermove', { x: 300, y: 300 }, { buttons: 0 });
    expect(r.snap().pressed).toBe(false);
    expect(r.snap().radial).toBe(false);
    await rest(r);
    expectAtRest(r, 'after a move with no button');
  });

  it('ends when the pointer is cancelled, loses capture, or leaves', async () => {
    for (const type of ['pointercancel', 'lostpointercapture', 'pointerleave']) {
      const r = await held();
      // (A pointer that is captured does not leave; one that is not, can.)
      if (type === 'pointerleave') (r.parts().touch as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
      pointer(r.parts().touch, type, { x: 500, y: 500 });
      expect(r.snap().pressed, type).toBe(false);
      expect(r.snap().radial, type).toBe(false);
      await rest(r);
      expectAtRest(r, `after ${type}`);
      r.view.unmount();
      r.screen.stop();
    }
  });

  it('ends by itself when nobody says anything at all', async () => {
    const r = await held();
    await tick(PRESS_LIMIT_MS - 100);
    expect(r.snap().pressed).toBe(true);
    await tick(200);
    expect(r.snap().pressed).toBe(false);
    expect(await rest(r)).toBeLessThan(8000);
    expectAtRest(r, 'after a press nobody ended');
  });

  it('ends even if frames have stopped coming as well', async () => {
    const r = await held();
    r.screen.state.on = false;
    await tick(PRESS_LIMIT_MS + 200);
    expect(r.snap().pressed).toBe(false);
    await tick(4000);
    expect(r.snap().doozer.stretch).toBeCloseTo(1, 2);
  });

  it('a click whose mouse-up is merely late still counts, once', async () => {
    const r = await mount();
    await rest(r);
    const { touch } = r.parts();
    const at = r.onDoozer();
    pointer(touch, 'pointerdown', at, { buttons: 1, gap: 1000 });
    // The shell's word arrives first; the page's own pointerup a moment later.
    r.shell.emit('pointer-released', at);
    expect(r.snap().pressed).toBe(false);
    await tick(30);
    pointer(touch, 'pointerup', at);
    expect(r.snap().radial).toBe(true);
    // And without a pointerup at all, nothing is toggled later.
    r.parts().radial.close();
    pointer(touch, 'pointerdown', at, { buttons: 1, gap: 1000 });
    r.shell.emit('pointer-released', at);
    await tick(1000);
    expect(r.snap().radial).toBe(false);
    expect(r.snap().timers).not.toContain('press');
  });
});

describe('every scene, interrupted at several moments', () => {
  const INTERRUPTIONS: readonly [string, (r: Rig) => Promise<void>][] = [
    ['another action', async (r) => { r.brain.debug?.setNeeds({ clean: 40 }); r.brain.wash(); }],
    ['a poke and a stroke', async (r) => { poke(r, r.onDoozer(), 400); await tick(60); stroke(r, 200); r.parts().radial.close(); }],
    ['falling asleep', async (r) => { if (r.brain.state.asleep) r.brain.wake(); else { r.brain.debug?.setNeeds({ energy: 50 }); r.brain.sleep(); } }],
    ['being tucked away', async (r) => {
      r.view.setAwake?.(false);
      expect(r.snap().timers, 'tucked: timers').toEqual([]);
      expect(r.snap().drawing, 'tucked: drawing').toBe(false);
      expect(r.snap().scene, 'tucked: scene').toBeNull();
      const frames = r.snap().frames;
      await tick(3000);
      expect(r.snap().timers, 'tucked, later: timers').toEqual([]);
      expect(r.snap().frames, 'tucked, later: frames').toBe(frames);
      r.view.setAwake?.(true);
    }],
    ['the Card opening and closing', async (r) => { r.view.setOpen('card'); await tick(120); r.view.setOpen('none'); }],
    ['the graphics context being lost and restored', async (r) => {
      const painter = r.painters.last().painter;
      painter.loseContext();
      await tick(700);
      painter.restoreContext();
    }],
    ['the graphics context being lost for good', async (r) => {
      r.painters.last().painter.loseContext();
      await tick(CONTEXT_LIMIT_MS + 100);
      expect(r.snap().rebuilds, 'rebuilt').toBeGreaterThan(0);
    }],
    ['frames stopping for a while', async (r) => { r.screen.state.on = false; await tick(2500); r.screen.state.on = true; }],
  ];

  for (const [interruption, interrupt] of INTERRUPTIONS) {
    it(`by ${interruption}`, async () => {
      const r = await mount({ seed: 21 });
      await rest(r);
      for (const [name, start] of SCENES) {
        for (const cut of CUTS) {
          const what = `${name}, cut at ${cut} ms by ${interruption}`;
          refresh(r);
          await rest(r);
          start(r);
          await tick(cut);
          await interrupt(r);
          expect(await rest(r, 30_000), `${what}: time to rest`).toBeLessThan(30_000);
          expectAtRest(r, what);
        }
      }
      // After all of that it is still a working island.
      refresh(r);
      await rest(r);
      r.brain.feed();
      expect(r.snap().scene).toBe('eat');
      await rest(r);
      expectAtRest(r, 'at the end');
      r.view.unmount();
      r.screen.stop();
      expect(vi.getTimerCount()).toBe(0);
    });
  }
});

describe('leaving the view in the middle of a scene', () => {
  it('at any moment of any scene, unmounting leaves nothing running and nothing behind', async () => {
    for (const [name, start] of SCENES) {
      for (const cut of [0, 300, 1100, 2800]) {
        const r = await mount({ seed: 31 });
        refresh(r);
        start(r);
        await tick(cut);
        const resources = r.parts().stage.resources();
        const all = [...resources.geometries, ...resources.materials, ...resources.textures];
        const freed = new Set<unknown>();
        for (const item of all) item.addEventListener('dispose', () => { freed.add(item); });
        r.view.unmount();
        r.screen.stop();
        const what = `${name}, left at ${cut} ms`;
        expect(vi.getTimerCount(), what).toBe(0);
        expect(freed.size, what).toBe(all.length);
        expect(r.painters.made.every((painter) => painter.disposed), what).toBe(true);
        expect(r.shell.listeners(), what).toBe(0);
        expect(r.root.children, what).toHaveLength(0);
        // The brain is untouched by the view having gone.
        expect(() => { r.brain.tick(); r.brain.pet(); }, what).not.toThrow();
        await tick(3000);
        expect(vi.getTimerCount(), what).toBe(0);
      }
    }
  });

  it('popping out for a window change in the middle of a scene settles in time', async () => {
    const r = await mount();
    for (const [name, start] of SCENES) {
      refresh(r);
      await rest(r);
      start(r);
      await tick(700);
      let left = false;
      void r.view.leave?.().then(() => { left = true; });
      await tick(300);
      expect(left, name).toBe(true);
      void r.view.enter?.();
      expect(await rest(r, 30_000), name).toBeLessThan(30_000);
      expectAtRest(r, `${name}, then out and in`);
    }
  });

  it('the pop-out settles even when no frame is being drawn', async () => {
    const r = await mount();
    r.screen.state.on = false;
    let left = false;
    void r.view.leave?.().then(() => { left = true; });
    await tick(300);
    expect(left).toBe(true);
  });
});

describe('frames that never come', () => {
  it('every scene still reaches its end, with nothing drawn', async () => {
    const r = await mount();
    await rest(r);
    r.screen.state.on = false;
    const drawn = r.snap().frames;
    for (const [name, start] of SCENES) {
      refresh(r);
      await tick(8000);
      start(r);
      expect(await rest(r, 30_000), name).toBeLessThan(30_000);
      const s = r.snap();
      expect(s.scene, name).toBeNull();
      expect(s.snack, name).toBeNull();
      expect(s.moving, name).toBe(false);
      expect(s.doozer.y, name).toBe(0);
      expect(r.parts().world.travelling, name).toBe(false);
    }
    expect(r.snap().frames).toBe(drawn);
    expect(r.snap().undrawn).toBeGreaterThan(50);
    // The screen comes back: one look and everything is where it should be.
    r.screen.state.on = true;
    refresh(r);
    await rest(r);
    expectAtRest(r, 'after the screen came back');
  });
});

describe('tucked away', () => {
  it('stops every timer and every frame, whatever was going on, and comes back whole', async () => {
    const r = await mount();
    for (const [name, start] of SCENES) {
      refresh(r);
      await rest(r);
      start(r);
      await tick(900);
      poke(r);
      await arrive(r);
      r.view.setOpen('card');
      r.view.setAwake?.(false);
      const frames = r.snap().frames;
      const requested = r.screen.state.requested;
      expect(r.snap(), name).toMatchObject({ awake: false, open: 'none', radial: false, drawing: false, lively: false, pressed: false, hover: false, scene: null, timers: [] });
      // Not one timer anywhere in the page, apart from the test's own screen.
      expect(vi.getTimerCount(), `${name}: timers of any kind`).toBe(1);
      await tick(60_000);
      expect(r.snap().timers, name).toEqual([]);
      expect(r.snap().frames, name).toBe(frames);
      expect(r.screen.state.requested, name).toBe(requested);
      // Nothing can wake it: not the brain, not the pointer.
      r.brain.pet();
      r.brain.debug?.setNeeds({ tummy: 30 });
      r.brain.feed();
      poke(r);
      r.view.setOpen('card');
      void r.view.leave?.();
      void r.view.enter?.();
      expect(vi.getTimerCount(), `${name}: timers of any kind, after prodding`).toBe(1);
      await tick(5000);
      expect(r.snap(), name).toMatchObject({ open: 'none', radial: false, drawing: false, scene: null, snack: null, timers: [] });
      expect(r.snap().frames, name).toBe(frames);
      r.view.setAwake?.(true);
      expect(r.snap().awake, name).toBe(true);
      expect(await rest(r, 30_000), name).toBeLessThan(30_000);
      expectAtRest(r, `${name}, tucked away and back`);
    }
  });

  it('a session that ends while tucked away is celebrated on coming back', async () => {
    const r = await mount({ setup: (brain) => brain.setSetting('onFocusEnd', 'open-card') });
    r.brain.startFocus();
    await rest(r);
    r.view.setAwake?.(false);
    r.brain.debug?.finishFocusNow();
    await tick(5000);
    expect(r.snap()).toMatchObject({ open: 'none', timers: [] });
    r.view.setAwake?.(true);
    expect(r.snap().open).toBe('card');
    expect(r.snap().busy).toBe(true);
    expect(r.host.calls.filter((call) => call === 'focusable:true')).toEqual([]);
  });
});

describe('a long run of random prodding', () => {
  it('four hundred things at random, then rest', async () => {
    const r = await mount({ seed: 77 });
    const random = seeded(99);
    const { world } = r.parts();
    const layout = islandLayout('medium');
    const anywhere = (): { x: number; y: number } => ({ x: random() * layout.sceneWidth, y: random() * layout.sceneHeight });
    const things: (() => void | Promise<void>)[] = [
      () => void r.brain.feed(), () => void r.brain.giveTreat(), () => void r.brain.play(), () => void r.brain.wash(),
      () => void r.brain.toggleSleep(), () => void r.brain.pet(), () => void r.brain.fillBowl(),
      () => void r.brain.startFocus(), () => r.brain.stopFocus(), () => r.brain.debug?.finishFocusNow(), () => r.brain.pauseFocus(), () => r.brain.resumeFocus(),
      () => poke(r, r.onDoozer(), 20 + random() * 400), () => poke(r, anywhere(), 20 + random() * 400),
      () => stroke(r, 60 + random() * 300), () => stroke(r, 100 + random() * 200, { buttons: 1 }),
      () => arrive(r, anywhere()),
      () => pointer(r.parts().touch, 'pointerdown', r.onDoozer(), { buttons: 1, gap: 400 }),      // and never let go
      () => r.shell.emit('pointer-released', null),
      () => pointer(r.parts().touch, 'pointerleave', anywhere()),
      () => r.parts().radial.el.querySelectorAll<HTMLButtonElement>('button')[Math.floor(random() * 6)]?.click(),
      () => r.view.setOpen(random() < 0.5 ? 'card' : 'none'), () => r.view.openSettings?.(), () => r.view.setOpen('none'),
      () => r.parts().card.el.querySelectorAll<HTMLButtonElement>('.dzk-act, .dzk-mini, .dzk-go, .dzk-chip')[Math.floor(random() * 10)]?.click(),
      () => { r.view.setAwake?.(false); }, () => { r.view.setAwake?.(true); },
      () => r.painters.last().painter.loseContext(), () => r.painters.last().painter.restoreContext(),
      () => { r.screen.state.on = random() < 0.7; },
      () => world.bopBall(), () => world.bopSnack(),
      () => r.brain.setSetting('palette', (['peach', 'mint', 'lavender', 'butter', 'sky'] as const)[Math.floor(random() * 5)] ?? 'peach'),
      () => r.brain.setSetting('reduceMotion', random() < 0.2 ? 'on' : 'off'),
      () => { void r.view.leave?.(); }, () => { void r.view.enter?.(); },
      () => r.brain.debug?.setNeeds({ tummy: random() * 100, fun: random() * 100, energy: 12 + random() * 88, clean: random() * 100 }),
      () => r.brain.debug?.addTreats(1),
    ];
    for (let i = 0; i < 400; i++) {
      await things[Math.floor(random() * things.length)]?.();
      await tick(random() < 0.3 ? random() * 40 : random() * 1500);
      const s = r.snap();
      expect(Number.isFinite(s.doozer.x + s.doozer.z + s.doozer.y + s.doozer.stretch), `step ${i}`).toBe(true);
      expect(Math.hypot(s.doozer.x, s.doozer.z), `step ${i}`).toBeLessThan(1.4);
      expect(r.view.hitRegions().length, `step ${i}`).toBeLessThan(64);
      if (!s.awake) expect(s.timers, `step ${i}: tucked away`).toEqual([]);
    }
    // Put the world back in order and let it come to rest.
    r.screen.state.on = true;
    r.view.setAwake?.(true);
    r.painters.last().painter.restoreContext();
    r.brain.setSetting('reduceMotion', 'off');
    r.view.setOpen('none');
    r.parts().radial.close();
    r.shell.emit('pointer-released', null);
    refresh(r);
    expect(await rest(r, 40_000)).toBeLessThan(40_000);
    expectAtRest(r, 'after four hundred random things');
    r.view.unmount();
    r.screen.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(r.painters.made.every((painter) => painter.disposed)).toBe(true);
  });
});
