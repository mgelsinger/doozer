// @vitest-environment happy-dom
//
// The whole Island view against the real brain, the real model file and the real
// three.js scene, in a test DOM on the fake clock. Only the drawing itself is stood in
// for (harness.ts). The never-stuck cases have their own file, never-stuck.test.ts.

import type { Mesh } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PALETTES } from '../../../src/character/palettes';
import { CONTEXT_LIMIT_MS, LOAD_LIMIT_MS } from '../../../src/views/island';
import { islandLayout } from '../../../src/views/island/layout';
import type { Region } from '../../../src/shell';
import { START, arrive, infoFor, mount, pointer, poke, prepare, rest, stroke, tick, type Rig } from './harness';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  // The test DOM's Web Animations stub rejects a promise nobody holds whenever an animation
  // is cancelled; the kit never depends on an animation, so run without one.
  (Element.prototype as { animate?: unknown }).animate = undefined;
});
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

const inside = (r: Region, x: number, y: number): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const named = (r: Rig, name: string) => {
  const found = r.parts().stage.actor.object.getObjectByName(name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

describe('mounting', () => {
  it('asks for a floating window with a band above and below, and passes its position back', async () => {
    const p = await prepare();
    const layout = islandLayout('medium');
    expect(p.view.id).toBe('island');
    expect(p.view.windowSettings).toEqual(['size']);
    expect(p.view.window({ settings: p.brain.settings, position: null })).toEqual({ kind: 'floating', width: layout.windowWidth, height: layout.windowHeight, bleed: layout.band });
    expect(p.view.window({ settings: p.brain.settings, position: { x: 12, y: 34 } })).toMatchObject({ x: 12, y: 34 });
    p.screen.stop();
  });

  it('loads three.js and the model only when mounted, then shows the island', async () => {
    let loads = 0;
    const p = await prepare();
    const view = (await import('../../../src/views/island')).createIslandView({
      now: () => Date.now(), createPainter: p.painters.create, requestFrame: p.screen.requestFrame, cancelFrame: p.screen.cancelFrame,
      load: async () => { loads++; return { stage: p.stage, model: p.model }; },
    });
    expect(loads).toBe(0);
    expect(view.snapshot()).toBeNull();
    expect(view.hitRegions()).toEqual([]);
    await view.mount(p.root, p.context);
    expect(loads).toBe(1);
    expect(p.painters.made).toHaveLength(1);
    expect(p.root.querySelector('.islv canvas')).toBe(p.painters.last().painter.canvas);
    expect(view.snapshot()).toMatchObject({ open: 'none', awake: true, gone: false, scene: null, snack: null, ball: null, night: 0, contextLost: false });
    view.unmount();
    p.screen.stop();
  });

  it('draws at the size the layout gives, at the screen\'s pixel ratio', async () => {
    const r = await mount();
    expect(r.painters.last().sizes.at(-1)).toEqual([380, 450, 1.5]);
    const scene = r.parts().scene;
    expect([scene.style.left, scene.style.top, scene.style.width, scene.style.height]).toEqual(['14px', '95px', '380px', '450px']);
  });

  it('follows the brain from the first frame: mood, palette, hat, glasses', async () => {
    const r = await mount({ setup: (brain) => { brain.setSetting('palette', 'sky'); brain.debug?.setNeeds({ tummy: 8 }); } });
    await tick(600);
    expect(r.snap().mood).toBe('hungry');
    expect(r.parts().stage.actor.palette).toBe('sky');
    r.brain.setSetting('palette', 'butter');
    expect(r.parts().stage.actor.palette).toBe('butter');
    const skin = (named(r, 'doozer-limbs') as unknown as { children: Mesh[] }).children[0]?.material;
    expect(skin).toBeDefined();
    expect(PALETTES.butter.body).toBeDefined();
    expect(named(r, 'glasses').visible).toBe(false);
  });
});

describe('unmounting', () => {
  it('frees everything: the scene, the model, the painter, every listener and every timer', async () => {
    const r = await mount();
    r.brain.feed();
    await tick(1500);
    r.brain.play();
    await tick(1200);
    const { stage } = r.parts();
    const resources = stage.resources();
    expect(resources.geometries.length).toBeGreaterThan(20);
    expect(resources.materials.length).toBeGreaterThan(20);
    const freed = new Set<unknown>();
    const all = [...resources.geometries, ...resources.materials, ...resources.textures];
    for (const item of all) item.addEventListener('dispose', () => { freed.add(item); });
    const listeners = r.shell.listeners();
    expect(listeners).toBeGreaterThan(0);

    r.view.unmount();
    r.screen.stop();
    expect(freed.size).toBe(all.length);
    expect(r.modelDisposed()).toBe(1);
    expect(r.painters.last().disposed).toBe(true);
    expect(r.shell.listeners()).toBe(0);
    expect(r.root.children).toHaveLength(0);
    expect(r.view.snapshot()).toBeNull();
    expect(r.view.hitRegions()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    // The brain no longer reaches the view.
    r.brain.feed();
    r.brain.setSetting('palette', 'mint');
    await tick(5000);
    expect(vi.getTimerCount()).toBe(0);
    expect(r.painters.made).toHaveLength(1);
  });

  it('ten times in and out leaves nothing behind', async () => {
    const p = await prepare();
    for (let i = 0; i < 10; i++) {
      await p.view.mount(p.root, p.context);
      p.brain.feed();
      await tick(900);
      p.view.unmount();
    }
    p.screen.stop();
    expect(p.painters.made).toHaveLength(10);
    expect(p.painters.made.every((painter) => painter.disposed)).toBe(true);
    expect(p.modelDisposed()).toBe(10);
    expect(p.shell.listeners()).toBe(0);
    expect(p.root.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives the engine back last of all, once, after everything made with it is disposed of', async () => {
    const p = await prepare();
    const order: string[] = [];
    const view = (await import('../../../src/views/island')).createIslandView({
      now: () => Date.now(), createPainter: p.painters.create, requestFrame: p.screen.requestFrame, cancelFrame: p.screen.cancelFrame,
      load: async () => ({
        stage: p.stage,
        model: { template: p.model.template, dispose: () => { order.push('model'); p.model.dispose(); } },
        release: () => { order.push(p.painters.last().disposed ? 'engine' : 'engine before the painter'); },
      }),
    });
    for (let i = 0; i < 3; i++) {
      await view.mount(p.root, p.context);
      await tick(400);
      expect(order).toHaveLength(i * 2);
      view.unmount();
    }
    p.screen.stop();
    expect(order).toEqual(['model', 'engine', 'model', 'engine', 'model', 'engine']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unmounted while still loading: the engine that arrives late is given straight back', async () => {
    const p = await prepare();
    let arrive!: () => void;
    const gate = new Promise<void>((resolve) => { arrive = resolve; });
    let released = 0;
    const view = (await import('../../../src/views/island')).createIslandView({
      now: () => Date.now(), createPainter: p.painters.create, requestFrame: p.screen.requestFrame, cancelFrame: p.screen.cancelFrame,
      load: async () => { await gate; return { stage: p.stage, model: p.model, release: () => { released++; } }; },
    });
    const mounting = view.mount(p.root, p.context);
    view.unmount();
    arrive();
    await mounting;
    p.screen.stop();
    expect(released).toBe(1);
    expect(p.modelDisposed()).toBe(1);
    expect(p.painters.made).toHaveLength(0);
  });

  it('loading that is given up on: if the engine does arrive later, it is given straight back', async () => {
    const p = await prepare();
    let arrive!: () => void;
    const gate = new Promise<void>((resolve) => { arrive = resolve; });
    let released = 0;
    const island = await import('../../../src/views/island');
    const view = island.createIslandView({
      now: () => Date.now(), createPainter: p.painters.create, requestFrame: p.screen.requestFrame, cancelFrame: p.screen.cancelFrame,
      load: async () => { await gate; return { stage: p.stage, model: p.model, release: () => { released++; } }; },
    });
    const outcome = Promise.resolve(view.mount(p.root, p.context)).then(() => 'mounted', () => 'failed');
    await tick(island.LOAD_LIMIT_MS + 50);
    expect(await outcome).toBe('failed');
    expect(released).toBe(0);
    arrive();
    await tick(20);
    p.screen.stop();
    expect(released).toBe(1);
    expect(p.modelDisposed()).toBe(1);
    expect(p.painters.made).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unmounted while still loading: the late arrival is thrown away', async () => {
    const p = await prepare();
    let arrive!: () => void;
    const gate = new Promise<void>((resolve) => { arrive = resolve; });
    const view = (await import('../../../src/views/island')).createIslandView({
      now: () => Date.now(), createPainter: p.painters.create, requestFrame: p.screen.requestFrame, cancelFrame: p.screen.cancelFrame,
      load: async () => { await gate; return { stage: p.stage, model: p.model }; },
    });
    const mounting = view.mount(p.root, p.context);
    view.unmount();
    arrive();
    await mounting;
    p.screen.stop();
    expect(view.snapshot()).toBeNull();
    expect(p.painters.made).toHaveLength(0);
    expect(p.modelDisposed()).toBe(1);
    expect(p.root.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a load that fails, or never ends, fails the mount cleanly so the host can show another view', async () => {
    const p = await prepare();
    const make = (load: () => Promise<never>) => import('../../../src/views/island').then((m) => m.createIslandView({
      now: () => Date.now(), createPainter: p.painters.create, requestFrame: p.screen.requestFrame, cancelFrame: p.screen.cancelFrame, load,
    }));
    const broken = await make(async () => { throw new Error('offline'); });
    await expect(broken.mount(p.root, p.context)).rejects.toThrow('offline');
    const hung = await make(() => new Promise<never>(() => undefined));
    const mounting = hung.mount(p.root, p.context);
    const outcome = expect(mounting).rejects.toThrow(/longer than/);
    await tick(LOAD_LIMIT_MS + 10);
    await outcome;
    p.screen.stop();
    expect(p.root.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a graphics card that cannot be had at all fails the mount and leaves nothing behind', async () => {
    const p = await prepare();
    p.painters.state.failToCreate = true;
    await expect(p.view.mount(p.root, p.context)).rejects.toThrow('no graphics context');
    p.screen.stop();
    expect(p.root.children).toHaveLength(0);
    expect(p.shell.listeners()).toBe(0);
    expect(p.modelDisposed()).toBeGreaterThanOrEqual(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('hit regions', () => {
  it('follow the island\'s outline and Doozer, and nothing else at rest', async () => {
    const r = await mount();
    await rest(r);
    const regions = r.view.hitRegions();
    const layout = islandLayout('medium');
    expect(regions.length).toBeGreaterThan(8);
    expect(regions.length).toBeLessThan(24);
    const at = r.snap().doozer.screen;
    expect(regions.some((region) => inside(region, at.x, at.y))).toBe(true);
    // The corners of the drawing, and the bands kept for the Card, let clicks through.
    for (const [x, y] of [[layout.sceneLeft + 5, layout.sceneTop + 5], [layout.sceneLeft + layout.sceneWidth - 5, layout.sceneTop + 5], [layout.windowWidth / 2, 20], [layout.windowWidth / 2, layout.windowHeight - 20], [3, layout.windowHeight / 2]] as const) {
      expect(regions.some((region) => inside(region, x, y)), `${x}, ${y}`).toBe(false);
    }
    for (const region of regions) {
      expect(region.x).toBeGreaterThanOrEqual(0);
      expect(region.x + region.w).toBeLessThanOrEqual(layout.windowWidth);
      expect(region.y).toBeGreaterThanOrEqual(layout.sceneTop - 1);
      expect(region.y + region.h).toBeLessThanOrEqual(layout.sceneTop + layout.sceneHeight + 1);
    }
  });

  it('move with Doozer as it hops about, and the host is told', async () => {
    const r = await mount();
    await rest(r);
    const before = r.snap().doozer.screen;
    const told = r.host.state.regions;
    void r.parts().world.travelTo(-0.8, 0.5);
    await rest(r);
    const after = r.snap().doozer.screen;
    expect(before.x - after.x).toBeGreaterThan(40);
    expect(r.host.state.regions).toBeGreaterThan(told);
    expect(r.view.hitRegions().some((region) => inside(region, after.x, after.y - 40))).toBe(true);
    // Not on every frame: the trip took dozens of frames.
    expect(r.host.state.regions - told).toBeLessThan(30);
  });

  it('add the ball, the open Radial and the grip when they are there', async () => {
    const r = await mount();
    await rest(r);
    const base = r.view.hitRegions().length;
    r.parts().world.serveBall('ball');
    await rest(r);
    expect(r.view.hitRegions()).toHaveLength(base + 1);
    const ball = r.snap().ball;
    expect(r.view.hitRegions().some((region) => inside(region, ball?.screen.x ?? -1, ball?.screen.y ?? -1))).toBe(true);
    poke(r);
    expect(r.snap().radial).toBe(true);
    expect(r.view.hitRegions().length).toBeGreaterThanOrEqual(base + 1 + 6);
    r.parts().radial.close();
    await arrive(r);
    expect(r.snap().hover).toBe(true);
    expect(r.view.hitRegions()).toHaveLength(base + 1 + 1);
  });

  it('never more than the shell accepts, whatever is open', async () => {
    const r = await mount();
    r.parts().world.serveBall('ball');
    poke(r);
    await arrive(r);
    r.view.setOpen('card');
    expect(r.view.hitRegions().length).toBeLessThan(40);
  });
});

describe('touching Doozer', () => {
  it('a click pokes it and opens the Radial; another closes it', async () => {
    const r = await mount();
    await rest(r);
    const { touch } = r.parts();
    const at = r.onDoozer();
    pointer(touch, 'pointerdown', at, { buttons: 1, gap: 1000 });
    expect(r.snap().pressed).toBe(true);
    await tick(120);
    expect(r.snap().doozer.stretch).toBeLessThan(0.93);       // squashed under the finger
    pointer(touch, 'pointerup', at);
    expect(r.snap().pressed).toBe(false);
    expect(r.snap().radial).toBe(true);
    await tick(250);
    expect(r.snap().doozer.stretch).not.toBeCloseTo(1, 2);    // still jiggling
    poke(r);
    expect(r.snap().radial).toBe(false);
    await rest(r);
    expect(r.snap().doozer.stretch).toBeCloseTo(1, 2);
  });

  it('a poke is not a pet: the brain hears nothing', async () => {
    const r = await mount();
    const actions: string[] = [];
    r.brain.on('action', (event) => actions.push(event.type));
    poke(r); poke(r); poke(r);
    expect(actions).toEqual([]);
  });

  it('a double click is one click', async () => {
    const r = await mount();
    poke(r, r.onDoozer(), 1000);
    poke(r, r.onDoozer(), 100);
    expect(r.snap().radial).toBe(true);
  });

  it('the Radial opens around Doozer and stays inside the drawing', async () => {
    const r = await mount();
    for (const x of [-0.8, 0, 0.8]) {
      r.parts().radial.close();
      void r.parts().world.travelTo(x, 0.3);
      await rest(r);
      poke(r);
      const el = r.parts().radial.el;
      const left = Number.parseFloat(el.style.left);
      const top = Number.parseFloat(el.style.top);
      expect(left).toBeGreaterThanOrEqual(119);
      expect(left).toBeLessThanOrEqual(380 - 119);
      expect(top).toBeGreaterThanOrEqual(119);
      expect(Math.abs(left - r.onDoozer().x)).toBeLessThan(35);
    }
  });

  it('a press on the island beside Doozer closes the Radial and opens nothing', async () => {
    const r = await mount();
    await rest(r);
    poke(r);
    expect(r.snap().radial).toBe(true);
    poke(r, { x: 320, y: 320 });
    expect(r.snap().radial).toBe(false);
    poke(r, { x: 320, y: 320 });
    expect(r.snap().radial).toBe(false);
  });

  it('choosing from the Radial acts through the brain and closes it', async () => {
    const r = await mount({ setup: (brain) => brain.debug?.setNeeds({ tummy: 40 }) });
    await rest(r);
    poke(r);
    const before = r.brain.state.needs.tummy;
    r.parts().radial.el.querySelector<HTMLButtonElement>('[data-id="feed"]')?.click();
    expect(r.brain.state.needs.tummy).toBe(before + 32);
    expect(r.snap().radial).toBe(false);
    expect(r.snap().scene).toBe('eat');
  });

  it('stroking across Doozer pets it, with the button up or down, not more than once in a while', async () => {
    const r = await mount();
    await rest(r);
    const pets: number[] = [];
    r.brain.on('action', (event) => { if (event.type === 'pet') pets.push(Date.now()); });
    await arrive(r);
    stroke(r, 160);
    expect(pets).toHaveLength(1);
    stroke(r, 400);
    expect(pets).toHaveLength(1);                             // too soon for another
    await tick(700);
    await arrive(r);
    stroke(r, 160);
    expect(pets).toHaveLength(2);
    // With the button held: a stroke, not a click.
    await tick(700);
    const { touch } = r.parts();
    pointer(touch, 'pointerdown', r.onDoozer(), { buttons: 1, gap: 1000 });
    stroke(r, 180, { buttons: 1 });
    pointer(touch, 'pointerup', r.onDoozer());
    expect(pets).toHaveLength(3);
    expect(r.snap().radial).toBe(false);
  });

  it('a pointer that only crosses the island wakes nothing', async () => {
    const r = await mount();
    await rest(r);
    const frames = r.snap().frames;
    const { touch } = r.parts();
    for (let i = 0; i < 6; i++) pointer(touch, 'pointermove', { x: 60 + i * 50, y: 300 }, { movementX: 50 });
    await tick(120);
    expect(r.snap().lively).toBe(false);
    expect(r.snap().hover).toBe(false);
    expect(r.snap().frames).toBe(frames);
  });

  it('a pointer that rests on it makes Doozer lively and look at it', async () => {
    const r = await mount();
    await rest(r);
    await arrive(r, { x: 330, y: 200 });
    expect(r.snap().lively).toBe(true);
    await tick(600);
    expect(r.parts().stage.actor.body.pose.lookX).toBeGreaterThan(0.4);
    pointer(r.parts().touch, 'pointerleave', { x: 400, y: 200 });
    await tick(600);
    expect(r.parts().stage.actor.body.pose.lookX).toBeCloseTo(0, 1);
  });

  it('clicking the ball bops it; clicking the snack makes it hop', async () => {
    const r = await mount();
    const { world } = r.parts();
    world.serveBall('ball');
    await rest(r);
    const ball = r.snap().ball;
    const layout = islandLayout('medium');
    poke(r, { x: (ball?.screen.x ?? 0) - layout.sceneLeft, y: (ball?.screen.y ?? 0) - layout.sceneTop });
    expect(world.ball?.resting).toBe(false);
    expect(world.ball?.vy).toBeGreaterThan(4);
    expect(r.snap().radial).toBe(false);
    await rest(r);
    const snack = world.dropSnack('apple', 1.0, 0.6);
    await rest(r);
    const at = r.parts().stage.projector.project([snack.x, snack.y + 0.2, snack.z]);
    poke(r, { x: at.x, y: at.y });
    expect(snack.landed).toBe(false);
  });

  it('a right-click asks for the native menu', async () => {
    const r = await mount();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    r.parts().touch.dispatchEvent(event);
    expect(r.host.calls).toContain('menu');
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('the grip', () => {
  it('shows while the pointer is on the island, and moves the window through the shell', async () => {
    const r = await mount();
    await rest(r);
    expect(r.parts().root.dataset.hover).not.toBe('1');
    await arrive(r);
    expect(r.parts().root.dataset.hover).toBe('1');
    const { grip } = r.parts();
    poke(r);
    expect(r.snap().radial).toBe(true);
    pointer(grip, 'pointerdown', { x: 200, y: 100 }, { buttons: 1 });
    expect(r.shell.drags).toEqual([{ clientX: 200, clientY: 100 }]);
    expect(r.snap().radial).toBe(false);                      // the menu gets out of the way
    expect(r.parts().root.dataset.dragging).toBe('1');
    r.shell.emit('drag-end', infoFor('medium', { x: 100, y: 100 }));
    expect(r.parts().root.dataset.dragging).toBeUndefined();
  });

  it('a drag whose end is never heard of still ends', async () => {
    const r = await mount();
    await arrive(r);
    pointer(r.parts().grip, 'pointerdown', { x: 200, y: 100 }, { buttons: 1 });
    r.shell.emit('pointer-released', null);
    expect(r.parts().root.dataset.dragging).toBeUndefined();
    pointer(r.parts().grip, 'pointerdown', { x: 200, y: 100 }, { buttons: 1 });
    await tick(31_000);
    expect(r.parts().root.dataset.dragging).toBeUndefined();
  });

  it('lets go of the hover look by itself', async () => {
    const r = await mount();
    await arrive(r);
    expect(r.snap().hover).toBe(true);
    await tick(4100);
    expect(r.snap().hover).toBe(false);
  });
});

describe('scenes', () => {
  it('a meal drops out of the sky, Doozer hops over, eats it in three bites and cheers', async () => {
    const r = await mount({ setup: (brain) => brain.debug?.setNeeds({ tummy: 40 }) });
    await rest(r);
    const start = { ...r.parts().world.doozer };
    r.brain.feed();
    expect(r.snap()).toMatchObject({ scene: 'eat', showing: 'wow' });
    const food = r.snap().snack;
    expect(['apple', 'bread', 'carrot']).toContain(food);
    const snack = r.parts().world.snack;
    expect(snack?.y).toBeGreaterThan(3);
    await tick(1300);
    expect(snack?.landed).toBe(true);
    await tick(1000);
    const moved = Math.hypot(r.parts().world.doozer.x - start.x, r.parts().world.doozer.z - start.z);
    expect(moved).toBeGreaterThan(0.1);
    expect(r.snap().showing).toBe('eat');
    expect(Math.abs(r.parts().stage.actor.body.pose.yaw)).toBeGreaterThan(0.6);   // turned toward it
    await tick(1500);
    expect(r.snap().snack).toBeNull();
    expect(r.snap().emotes).toBeGreaterThan(0);                                    // hearts
    expect(r.snap().showing).toBe('cheer');
    await rest(r);
    expect(r.snap()).toMatchObject({ scene: null, snack: null, busy: false });
    expect(r.parts().stage.actor.body.pose.yaw).toBeCloseTo(0, 2);
  });

  it('the snack is the one the brain chose, a new object every time', async () => {
    const r = await mount({ setup: (brain) => { brain.debug?.setNeeds({ tummy: 10 }); brain.debug?.addTreats(5); } });
    const foods: string[] = [];
    const serials: number[] = [];
    r.brain.on('action', (event) => { if (event.type === 'feed' || event.type === 'treat') foods.push(event.food); });
    for (let i = 0; i < 4; i++) {
      if (i % 2 === 0) r.brain.feed(); else r.brain.giveTreat();
      expect(r.snap().snack).toBe(foods[i]);
      serials.push(r.parts().world.snack?.serial ?? -1);
      await rest(r);
    }
    expect(new Set(serials).size).toBe(4);
  });

  it('a game of ball: the ball arrives, Doozer chases and kicks it, and the ball stays', async () => {
    const r = await mount();
    await rest(r);
    r.brain.play();
    expect(r.snap().scene).toBe('play');
    expect(r.snap().ball).not.toBeNull();
    await tick(6000);
    expect(r.parts().world.kicks).toBeGreaterThanOrEqual(1);
    await rest(r);
    expect(r.snap().scene).toBeNull();
    expect(r.snap().ball?.resting).toBe(true);                 // a toy left lying on the island
    expect(r.parts().world.travelling).toBe(false);
  });

  it('a bath: a rain cloud, bubbles, a shake', async () => {
    const r = await mount({ setup: (brain) => brain.debug?.setNeeds({ clean: 30 }) });
    await rest(r);
    r.brain.wash();
    expect(r.snap().scene).toBe('wash');
    await tick(600);
    expect(r.parts().world.rain).toBeGreaterThan(0.9);
    expect(r.snap().particles).toBeGreaterThan(0);
    expect(r.snap().showing).toBe('shake');
    expect(r.snap().emotes).toBeGreaterThan(0);
    await rest(r);
    expect(r.parts().world.rain).toBe(0);
    expect(r.snap().scene).toBeNull();
  });

  it('night falls when Doozer sleeps and lifts when it wakes', async () => {
    const r = await mount();
    await rest(r);
    r.brain.sleep();
    await tick(600);
    expect(r.snap().night).toBeGreaterThan(0.3);
    await rest(r);
    expect(r.snap()).toMatchObject({ night: 1, mood: 'asleep', showing: 'asleep' });
    expect(r.snap().doozer.stretch).toBeCloseTo(0.82, 2);
    r.brain.wake();
    await rest(r);
    expect(r.snap().night).toBe(0);
    expect(r.snap().doozer.stretch).toBeCloseTo(1, 2);
  });

  it('a refusal shakes the head and shows a "?"; asleep it only stirs', async () => {
    const r = await mount({ setup: (brain) => brain.debug?.setNeeds({ tummy: 100 }) });
    await rest(r);
    expect(r.brain.feed().ok).toBe(false);
    expect(r.snap().showing).toBe('no');
    expect(r.parts().root.querySelector('.dzk-emote[data-kind="question"]')).not.toBeNull();
    await rest(r);
    r.brain.sleep();
    await rest(r);
    expect(r.brain.play().ok).toBe(false);
    expect(r.snap().showing).toBe('asleep');
    expect(r.parts().root.querySelector('.dzk-emote[data-kind="z"]')).not.toBeNull();
    await rest(r);
  });

  it('Doozer stays on the island through everything', async () => {
    const r = await mount({ setup: (brain) => { brain.debug?.setNeeds({ tummy: 20, fun: 20, clean: 20 }); brain.debug?.addTreats(6); } });
    for (const act of [() => r.brain.feed(), () => r.brain.play(), () => r.brain.giveTreat(), () => r.brain.wash(), () => r.brain.feed(), () => r.brain.play()]) {
      act();
      for (let i = 0; i < 60; i++) {
        await tick(100);
        const d = r.snap().doozer;
        expect(Math.hypot(d.x, d.z)).toBeLessThan(1.35);
        expect(d.y).toBeGreaterThanOrEqual(0);
        expect(d.y).toBeLessThan(0.7);
      }
    }
  });
});

describe('the focus timer', () => {
  it('glasses on, the chip under the island, Doozer settled in the middle', async () => {
    const r = await mount();
    void r.parts().world.travelTo(0.7, 0.6);
    await rest(r);
    const chip = r.parts().root.querySelector<HTMLElement>('.dzk-focus-chip');
    expect(chip?.dataset.show).toBe('0');
    r.brain.startFocus();
    await rest(r);
    expect(r.brain.state.quiet).toBe(true);
    expect(named(r, 'glasses').visible).toBe(true);
    expect(r.snap().showing).toBe('focus');
    expect(chip?.dataset.show).toBe('1');
    // At rest, with nobody there, the chip counts in whole minutes.
    expect(r.snap().lively).toBe(false);
    expect(chip?.textContent).toMatch(/^2[45] min$/);
    expect(Math.hypot(r.snap().doozer.x, r.snap().doozer.z - 0.3)).toBeLessThan(0.15);
    // No wandering and no stirring during a session.
    const at = { ...r.parts().world.doozer };
    await arrive(r);
    await tick(20_000);
    expect(r.parts().world.doozer).toEqual(at);
    expect(r.snap().timers).not.toContain('stir');
  });

  it('a snack from the bowl during a session is eaten quietly, where Doozer sits', async () => {
    const r = await mount();
    r.brain.startFocus();
    await rest(r);
    const at = { ...r.parts().world.doozer };
    r.brain.feed();
    await tick(1500);
    expect(r.parts().world.doozer).toEqual(at);
    await rest(r);
    expect(r.parts().root.querySelector('.dzk-emote[data-kind="heart"]')).toBeNull();
    expect(r.snap().snack).toBeNull();
  });

  it('when it ends Doozer celebrates, the chip goes, and the keyboard is never asked for', async () => {
    const r = await mount();
    r.brain.startFocus();
    await rest(r);
    r.brain.debug?.finishFocusNow();
    expect(r.snap().scene).toBe('focus-complete');
    await tick(300);
    expect(r.snap().doozer.y).toBeGreaterThan(0.05);          // a hop
    await rest(r);
    expect(named(r, 'glasses').visible).toBe(false);
    expect(r.parts().root.querySelector<HTMLElement>('.dzk-focus-chip')?.dataset.show).toBe('0');
    expect(r.snap().open).toBe('none');
    expect(r.host.calls.filter((call) => call === 'focusable:true')).toEqual([]);
  });

  it('with "open the Card" chosen the Card opens, still without the keyboard', async () => {
    const r = await mount({ setup: (brain) => brain.setSetting('onFocusEnd', 'open-card') });
    r.brain.startFocus();
    await rest(r);
    r.brain.debug?.finishFocusNow();
    expect(r.snap().open).toBe('card');
    expect(r.host.calls.filter((call) => call === 'focusable:true')).toEqual([]);
  });
});

describe('the Card and the settings panel', () => {
  it('"More" on the Radial opens the Card over the island; the close button and the island close it', async () => {
    const r = await mount();
    await rest(r);
    poke(r);
    r.parts().radial.el.querySelector<HTMLButtonElement>('[data-id="more"]')?.click();
    expect(r.snap()).toMatchObject({ open: 'card', radial: false });
    expect(r.parts().card.isOpen).toBe(true);
    const layout = islandLayout('medium');
    const regions = r.view.hitRegions();
    expect(regions.some((region) => region.w === 320 && inside(region, layout.windowWidth / 2, layout.windowHeight / 2))).toBe(true);
    r.parts().root.querySelector<HTMLButtonElement>('.islv-close')?.click();
    expect(r.snap().open).toBe('none');
    r.view.setOpen('card');
    // A press on the island under the Card only closes it: no poke, no Radial.
    poke(r);
    expect(r.snap()).toMatchObject({ open: 'none', radial: false, pressed: false });
  });

  it('the Card\'s buttons work on the island\'s Doozer', async () => {
    const r = await mount({ setup: (brain) => brain.debug?.setNeeds({ tummy: 40 }) });
    r.view.setOpen('card');
    r.parts().card.el.querySelector<HTMLButtonElement>('[data-act="feed"]')?.click();
    expect(r.snap().scene).toBe('eat');
    r.parts().card.el.querySelector<HTMLButtonElement>('[data-view="pill"]')?.click();
    expect(r.host.calls).toContain('switch:pill');
  });

  it('only the settings panel may take the keyboard, and gives it back', async () => {
    const r = await mount();
    r.view.setOpen('card');
    expect(r.host.state.focusable).toBe(false);
    r.view.openSettings?.();
    expect(r.snap().open).toBe('settings');
    expect(r.host.state.focusable).toBe(true);
    r.parts().settings.el.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')?.click();
    expect(r.snap().open).toBe('card');                       // back to where it was opened from
    expect(r.host.state.focusable).toBe(false);
    r.view.setOpen('none');
    r.view.openSettings?.();
    r.parts().settings.el.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')?.click();
    expect(r.snap().open).toBe('none');
  });

  it('keeps a panel on the part of the window that is on screen', async () => {
    // The island sits at the very bottom of the screen: the window's lower band hangs off it.
    const layout = islandLayout('medium');
    const info = infoFor('medium', { x: 3000, y: 2088 - Math.round((layout.windowHeight - layout.band) * 1.5) });
    const r = await mount({ info });
    r.view.setOpen('card');
    const panel = r.parts().root.querySelector<HTMLElement>('.islv-panel');
    const top = Number.parseFloat(panel?.style.top ?? '0');
    const max = Number.parseFloat(panel?.style.getPropertyValue('--islv-panel-max') ?? '0');
    expect(top).toBeGreaterThanOrEqual(14);
    expect(top + Math.min(540, max)).toBeLessThanOrEqual(layout.windowHeight - layout.band - 14 + 1);
  });
});

describe('what the host asks', () => {
  it('pops Doozer out before the window changes and in again after', async () => {
    const r = await mount();
    await rest(r);
    poke(r);
    const leaving = r.view.leave?.();
    expect(r.snap().radial).toBe(false);
    await tick(260);
    await leaving;
    expect(r.snap().gone).toBe(true);
    expect(r.parts().stage.actor.object.visible).toBe(false);
    const withoutDoozer = r.view.hitRegions().length;
    const entering = r.view.enter?.();
    expect(r.snap().gone).toBe(false);
    expect(r.parts().stage.actor.object.visible).toBe(true);
    expect(r.view.hitRegions().length).toBe(withoutDoozer + 2);
    await tick(400);
    await entering;
    await rest(r);
    expect(r.parts().stage.actor.body.pose.scale).toBe(1);
  });

  it('Doozer comes back by itself if the pop-in never comes', async () => {
    const r = await mount();
    const leaving = r.view.leave?.();
    await tick(260);
    await leaving;
    expect(r.snap().gone).toBe(true);
    await tick(1600);
    expect(r.snap().gone).toBe(false);
  });

  it('a new size is a new window, and the island is laid out again inside it', async () => {
    const r = await mount();
    r.brain.setSetting('size', { ...r.brain.settings.size, island: 'large' });
    const layout = islandLayout('large');
    expect(r.view.window({ settings: r.brain.settings, position: null })).toMatchObject({ width: layout.windowWidth, height: layout.windowHeight });
    r.view.windowChanged?.(infoFor('large'));
    expect(r.painters.last().sizes.at(-1)).toEqual([475, 563, 1.5]);
    expect(r.parts().scene.style.width).toBe('475px');
    expect(r.parts().root.dataset.size).toBe('large');
    const widest = Math.max(...r.view.hitRegions().map((region) => region.w));
    expect(widest).toBeGreaterThan(380);
  });

  it('with motion reduced Doozer is placed rather than hopped, and still eats', async () => {
    const r = await mount({ setup: (brain) => { brain.setSetting('reduceMotion', 'on'); brain.debug?.setNeeds({ tummy: 40 }); } });
    expect(r.parts().root.dataset.motion).toBe('reduce');
    r.brain.feed();
    let highest = 0;
    for (let i = 0; i < 50; i++) { await tick(100); highest = Math.max(highest, r.snap().doozer.y); }
    expect(highest).toBe(0);
    await rest(r);
    expect(r.snap()).toMatchObject({ scene: null, snack: null });
  });
});

describe('render on demand', () => {
  /** Let `seconds` pass and report how many frames were drawn and how often the loop was found running. */
  async function watch(r: Rig, seconds: number): Promise<{ frames: number; running: number; asked: number }> {
    const frames = r.snap().frames;
    const asked = r.screen.state.requested;
    let running = 0;
    for (let i = 0; i < seconds * 10; i++) {
      await tick(100);
      if (r.snap().drawing) running++;
    }
    return { frames: r.snap().frames - frames, running: running / (seconds * 10), asked: r.screen.state.requested - asked };
  }

  it('at rest with nobody there, almost nothing is drawn: a blink in two redraws now and then', async () => {
    const r = await mount();
    await rest(r);
    expect(r.snap()).toMatchObject({ drawing: false, lively: false });
    expect(r.snap().timers.sort()).toEqual(['blink', 'stir']);
    const seen = await watch(r, 40);
    // Five to eleven seconds between blinks, two redraws each (a stir cannot come this soon).
    expect(seen.frames).toBeGreaterThanOrEqual(6);
    expect(seen.frames).toBeLessThanOrEqual(16);
    expect(seen.asked).toBeLessThanOrEqual(16);
    expect(seen.running).toBeLessThan(0.05);
    expect(r.snap().lively).toBe(false);
  });

  it('asleep with nobody there: one frame every few seconds, as the fireflies wink', async () => {
    const r = await mount();
    r.brain.sleep();
    await rest(r);
    expect(r.snap().timers).toEqual(['wink']);
    const ambient = r.parts().world.ambient;
    const seen = await watch(r, 60);
    expect(seen.frames).toBeGreaterThanOrEqual(13);
    expect(seen.frames).toBeLessThanOrEqual(17);
    expect(seen.running).toBeLessThan(0.05);
    expect(r.parts().world.ambient).toBeGreaterThan(ambient);          // they did move
    expect(r.parts().root.querySelector('.dzk-emote')).toBeNull();     // and no z's rise unwatched
  });

  it('a focus session costs no frames of its own: the chip is the only thing that changes', async () => {
    const r = await mount();
    r.brain.startFocus();
    await rest(r);
    expect(r.snap().timers).toEqual(['blink']);
    const seen = await watch(r, 40);
    expect(seen.frames).toBeLessThanOrEqual(16);
    expect(seen.running).toBeLessThan(0.05);
  });

  it('the countdown ticking every second draws nothing: a change in the brain is not a change in the picture', async () => {
    const r = await mount();
    r.brain.startFocus();
    await rest(r);
    const left = r.brain.state.focus.remainingMs;
    let changes = 0;
    const off = r.brain.on('change', () => { changes++; });
    const frames = r.snap().frames;
    const asked = r.screen.state.requested;
    const chipEl = r.parts().root.querySelector('.dzk-focus-chip');
    let shown = chipEl?.textContent;
    let chipChanges = 0;
    // As the host's clock does it: the brain is ticked once a second, and says "change" each time.
    for (let i = 0; i < 60; i++) {
      await tick(1000);
      r.brain.tick();
      if (chipEl?.textContent !== shown) { chipChanges++; shown = chipEl?.textContent; }
    }
    off();
    expect(r.brain.state.focus.remainingMs).toBeLessThan(left - 55_000);
    expect(changes).toBeGreaterThanOrEqual(55);
    // A minute holds five to twelve blinks of two redraws each, and nothing else.
    expect(r.snap().frames - frames).toBeLessThanOrEqual(24);
    expect(r.screen.state.requested - asked).toBeLessThanOrEqual(24);
    // And the chip itself, with nobody there, counts in minutes: in a minute it changes once.
    expect(chipEl?.textContent).toMatch(/^2[34] min$/);
    expect(chipChanges).toBeLessThanOrEqual(1);
  });

  it('every minute to three, alone and awake, a small stir: a second of movement, and Doozer does not come alive for it', async () => {
    const r = await mount();
    await rest(r);
    // A blink is two redraws; a stir is the body moving, many frames in a row.
    let frames = r.snap().frames;
    let stirred = false;
    let waited = 0;
    while (!stirred && waited < 175_000) {
      await tick(500);
      waited += 500;
      stirred = r.snap().frames - frames > 6;
      frames = r.snap().frames;
      expect(r.snap().lively).toBe(false);
    }
    expect(stirred).toBe(true);
    expect(waited).toBeGreaterThan(60_000);
    const before = r.snap().frames;
    let lively = false;
    let settling = 0;
    while ((r.snap().moving || r.snap().drawing || r.snap().busy) && settling < 6000) {
      await tick(100);
      settling += 100;
      lively ||= r.snap().lively;
    }
    expect(settling).toBeLessThan(3000);
    expect(lively).toBe(false);
    // Thirty frames a second at most: nobody is there to see sixty.
    expect(r.snap().frames - before).toBeLessThanOrEqual(Math.ceil((settling / 1000) * 31) + 2);
    expect(r.snap().timers.sort()).toEqual(['blink', 'stir']);
  });

  it('caps the frame rate: sixty a second while something happens with somebody there, thirty while Doozer only breathes', async () => {
    const r = await mount({ hz: 125 });
    await rest(r);
    // Something happening: a game of ball.
    r.brain.play();
    await tick(500);
    let frames = r.snap().frames;
    await tick(2000);
    const active = (r.snap().frames - frames) / 2;
    expect(active).toBeGreaterThan(40);
    expect(active).toBeLessThanOrEqual(63);
    await rest(r);
    // Only breathing: the pointer rests on the island, away from Doozer.
    await arrive(r, { x: 330, y: 330 });
    await tick(1500);
    frames = r.snap().frames;
    for (let i = 0; i < 4; i++) { pointer(r.parts().touch, 'pointermove', { x: 330, y: 330 }); await tick(500); }
    if (r.snap().scene === null) {
      const ambient = (r.snap().frames - frames) / 2;
      expect(ambient).toBeGreaterThan(18);
      expect(ambient).toBeLessThanOrEqual(32);
    }
  });

  it('a watched Doozer breathes, looks about and wanders; left alone it goes still within seconds', async () => {
    const r = await mount();
    await rest(r);
    const at = { ...r.parts().world.doozer };
    for (let i = 0; i < 60; i++) { pointer(r.parts().touch, 'pointermove', { x: 330, y: 330 }); await tick(500); }
    expect(r.snap().lively).toBe(true);
    expect(r.parts().world.doozer).not.toEqual(at);                    // it wandered
    expect(r.snap().timers).toContain('wander');
    pointer(r.parts().touch, 'pointerleave', { x: 500, y: 330 });
    expect(await rest(r)).toBeLessThan(12_000);
    expect(r.snap().timers.sort()).toEqual(['blink', 'stir']);
  });
});

describe('watched for a long time', () => {
  it('ten minutes with the pointer resting on Doozer: nothing piles up', async () => {
    const r = await mount();
    await rest(r);
    const count = () => {
      const { stage, root, world } = r.parts();
      const info = stage.info();
      const held = stage.resources();
      return {
        nodes: root.querySelectorAll('*').length,
        objects: info.objects,
        geometries: held.geometries.length, materials: held.materials.length, textures: held.textures.length,
        particles: world.particles.length,
        listeners: r.shell.listeners(),
        timers: vi.getTimerCount(),
      };
    };
    const watch = async (minutes: number): Promise<void> => {
      // As the real-window measurement does it: the pointer is put on Doozer again and
      // again, wherever Doozer has got to, which strokes it now and then.
      for (let i = 0; i < minutes * 200; i++) { pointer(r.parts().touch, 'pointermove', r.onDoozer()); await tick(300); }
    };
    const frames = r.snap().frames;
    await watch(2);
    const early = count();
    expect(r.snap().lively).toBe(true);
    await watch(8);
    const late = count();
    // It really was drawing all that time: thirty frames a second at the least.
    expect(r.snap().frames - frames).toBeGreaterThan(10 * 60 * 25);
    // Counted while lively, so a heart or a crumb may be in the air at either moment.
    expect(late.nodes).toBeLessThanOrEqual(early.nodes + 12);
    expect(late.objects).toBeLessThanOrEqual(early.objects + 12);
    expect(late.geometries).toBeLessThanOrEqual(early.geometries + 2);
    expect(late.materials).toBeLessThanOrEqual(early.materials + 2);
    expect(late.textures).toBeLessThanOrEqual(early.textures + 2);
    expect(late.particles).toBeLessThanOrEqual(early.particles + 40);
    expect(late.listeners).toBe(early.listeners);
    expect(late.timers).toBeLessThanOrEqual(early.timers + 3);
    pointer(r.parts().touch, 'pointerleave', { x: 500, y: 330 });
    expect(await rest(r)).toBeLessThan(12_000);
    const after = count();
    expect(after.particles).toBe(0);
    expect(r.parts().root.querySelectorAll('.dzk-emote').length).toBe(0);
  }, 120_000);
});

describe('a lost graphics context', () => {
  it('lost and restored: the island carries on', async () => {
    const r = await mount();
    await rest(r);
    const painter = r.painters.last();
    painter.painter.loseContext();
    expect(r.snap().contextLost).toBe(true);
    expect(r.snap().timers).toContain('context');
    // Life goes on while nothing can be drawn.
    r.brain.feed();
    await tick(1000);
    expect(r.snap().scene).toBe('eat');
    const drawn = painter.renders;
    painter.painter.restoreContext();
    expect(r.snap().contextLost).toBe(false);
    expect(r.snap().timers).not.toContain('context');
    await tick(200);
    expect(painter.renders).toBeGreaterThan(drawn);
    await rest(r);
    expect(r.snap()).toMatchObject({ rebuilds: 0, scene: null, snack: null });
    expect(r.painters.made).toHaveLength(1);
  });

  it('lost and not restored: the drawing is rebuilt on a new canvas', async () => {
    const r = await mount();
    await rest(r);
    const old = r.painters.last();
    old.painter.loseContext();
    await tick(CONTEXT_LIMIT_MS + 50);
    expect(r.painters.made).toHaveLength(2);
    expect(old.disposed).toBe(true);
    expect(r.snap()).toMatchObject({ contextLost: false, rebuilds: 1 });
    expect(r.parts().scene.querySelector('canvas')).toBe(r.painters.last().painter.canvas);
    expect(r.parts().scene.querySelectorAll('canvas')).toHaveLength(1);
    expect(r.painters.last().sizes.at(-1)).toEqual([380, 450, 1.5]);
    await tick(200);
    expect(r.painters.last().renders).toBeGreaterThan(0);
    // Touch still works: the pointer never depended on the canvas.
    poke(r);
    expect(r.snap().radial).toBe(true);
  });

  it('lost for good: Doozer goes back to the first view rather than sit on a dead island', async () => {
    const r = await mount();
    await rest(r);
    r.painters.state.bornLost = true;
    r.painters.last().painter.loseContext();
    await tick(CONTEXT_LIMIT_MS + 50);
    expect(r.host.calls).toContain('switch:pill');
    r.view.unmount();
    r.screen.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lost while tucked away: dealt with on coming back', async () => {
    const r = await mount();
    await rest(r);
    r.view.setAwake?.(false);
    r.painters.last().painter.loseContext();
    await tick(10_000);
    expect(r.snap().timers).toEqual([]);
    r.view.setAwake?.(true);
    expect(r.snap().timers).toContain('context');
    await tick(CONTEXT_LIMIT_MS + 50);
    expect(r.snap()).toMatchObject({ contextLost: false, rebuilds: 1 });
  });
});
