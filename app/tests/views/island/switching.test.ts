// @vitest-environment happy-dom
//
// One pet, four homes (DESIGN_SPEC.md 5.1): the Island next to the Pill under the real
// host. Switching between them in the middle of a focus session, or in the middle of a
// scene, loses nothing and leaves nothing behind, and the app reopens where it was.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrain, type Brain, type ViewId } from '../../../src/core';
import { createHost, type Host } from '../../../src/host/host';
import { freshHostData, type HostData } from '../../../src/host/store';
import type { Region, Shell, WindowInfo, WindowMode } from '../../../src/shell';
import { createIslandView, type IslandSnapshot, type IslandView } from '../../../src/views/island';
import { islandLayout } from '../../../src/views/island/layout';
import { createPillView, type PillView } from '../../../src/views/pill';
import { MIN, seeded } from '../../core/helpers';
import { START, infoFor, loadModelOnce, painters, screen, tick } from './harness';

function fakeShell() {
  const saves: string[] = [];
  const state = { regions: [] as readonly Region[], modes: [] as WindowMode[], focusable: false };
  const info = (mode: WindowMode, view: ViewId | null): WindowInfo => (mode.kind === 'floating'
    ? { ...infoFor('medium'), view, cssWidth: mode.width, cssHeight: mode.height }
    : { ...infoFor('medium'), kind: mode.kind, view, width: 600, height: 1116, cssWidth: 400, cssHeight: 744 });
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const shell = {
    native: true,
    async setWindowMode(mode: WindowMode, view?: ViewId) { state.modes.push(mode); return info(mode, view ?? null); },
    windowInfo: async () => null,
    setHitRegions: (regions: readonly Region[]) => { state.regions = regions; },
    regionsFlushed: async () => undefined,
    beginDrag: async () => false,
    setFocusable: async (on: boolean) => { state.focusable = on; },
    setVisible: async () => undefined,
    setAlwaysOnTop: async () => undefined,
    fullscreenInFront: async () => false,
    load: async () => ({ data: null, source: 'none', problem: null }),
    save: async (json: string) => void saves.push(json),
    showMenu: async () => undefined,
    setAvailableViews: async () => undefined,
    autostartEnabled: async () => false,
    setAutostart: async () => false,
    quit: async () => undefined,
    on(event: string, handler: (payload: unknown) => void) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
      return () => void set.delete(handler);
    },
  } as unknown as Shell;
  return { shell, saves, state };
}

interface App {
  host: Host;
  brain: Brain;
  pill: PillView;
  island: IslandView;
  shell: ReturnType<typeof fakeShell>;
  painters: ReturnType<typeof painters>;
  loads: () => number;
  snap: () => IslandSnapshot;
  stop: () => void;
}

/** The app as main.ts builds it: the brain, the host, the Pill and the Island. */
async function startApp(save?: { brain: unknown; host: HostData }): Promise<App> {
  const template = await loadModelOnce();
  const stage = await import('../../../src/views/island/stage3d');
  const shell = fakeShell();
  const brain = createBrain({ save: save?.brain, now: () => Date.now(), random: seeded(4), debug: true });
  if (!save) {
    brain.debug?.setNeeds({ tummy: 80, fun: 80, energy: 80, clean: 80 });
    brain.setSetting('soundAsked', true);
    brain.setSetting('reduceMotion', 'off');
  }
  const made = painters();
  const display = screen();
  let loads = 0;
  const pill = createPillView({ now: () => Date.now(), random: seeded(5) });
  const island = createIslandView({
    now: () => Date.now(), random: seeded(6), createPainter: made.create, requestFrame: display.requestFrame, cancelFrame: display.cancelFrame, pixelRatio: () => 1.5,
    load: async () => { loads++; return { stage, model: { template: template.template, dispose: () => template.dispose() } }; },
  });
  const hostData = save?.host ?? freshHostData();
  if (!save) hostData.welcomedPet = brain.state.bornAt;
  const root = document.createElement('div');
  document.body.append(root);
  const host = createHost({ root, shell: shell.shell, brain, views: [pill, island], hostData, frame: async () => undefined });
  const starting = host.start();
  await tick(600);
  await starting;
  return { host, brain, pill, island, shell, painters: made, loads: () => loads, snap: () => island.snapshot() as IslandSnapshot, stop: () => { host.stop(); display.stop(); } };
}

/** Switch view and let the pop-out and pop-in play. */
async function go(app: App, view: ViewId): Promise<void> {
  const switching = app.host.switchTo(view);
  await tick(900);
  expect(await switching).toBe(true);
  await tick(600);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  (Element.prototype as { animate?: unknown }).animate = undefined;
});
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('the Island under the host', () => {
  it('is a view like any other: listed, switched to, remembered', async () => {
    const app = await startApp();
    expect(app.host.services.availableViews).toEqual(['pill', 'island']);
    expect(app.host.current()).toBe('pill');
    expect(app.loads()).toBe(0);                             // nothing 3D is loaded until it is wanted
    await go(app, 'island');
    expect(app.host.current()).toBe('island');
    expect(app.loads()).toBe(1);
    expect(app.brain.settings.lastView).toBe('island');
    const layout = islandLayout('medium');
    expect(app.shell.state.modes.at(-1)).toEqual({ kind: 'floating', width: layout.windowWidth, height: layout.windowHeight, bleed: layout.band });
    expect(app.shell.state.regions.length).toBeGreaterThan(8);
    expect(app.snap()).toMatchObject({ awake: true, gone: false, scene: null });
    app.stop();
  });

  it('remembers where its window was dragged to, and reopens in the Island', async () => {
    const app = await startApp();
    await go(app, 'island');
    const hostData = freshHostData();
    hostData.welcomedPet = app.brain.state.bornAt;
    hostData.positions.island = { x: 2222, y: 333 };
    const save = { brain: app.brain.serialize(), host: hostData };
    app.stop();
    document.body.replaceChildren();
    const again = await startApp(save);
    expect(again.host.current()).toBe('island');
    expect(again.shell.state.modes.at(-1)).toMatchObject({ kind: 'floating', x: 2222, y: 333 });
    again.stop();
  });
});

describe('a focus session carried between the Pill and the Island', () => {
  it('started in the Island, watched in the Pill, finished in the Island: nothing is lost', async () => {
    const app = await startApp();
    await go(app, 'island');
    const before = { treats: app.brain.state.treats, sessions: app.brain.state.sessionsCompleted };
    app.island.setOpen('card');
    app.island.parts()?.card.el.querySelector<HTMLButtonElement>('[data-act="focus"]')?.click();
    app.island.setOpen('none');
    expect(app.brain.state.focus).toMatchObject({ status: 'running', minutes: 25 });
    app.brain.tick();
    await tick(4 * MIN);
    app.brain.tick();
    const inIsland = app.brain.state.focus.remainingMs;
    expect(inIsland).toBeLessThan(21 * MIN + 1000);
    const chip = document.querySelector<HTMLElement>('.dzk-focus-chip');
    expect(chip?.dataset.show).toBe('1');
    expect(chip?.textContent).toMatch(/^2[01] min$/);                  // in minutes: nobody is at the island

    await go(app, 'pill');
    expect(app.island.snapshot()).toBeNull();
    expect(app.brain.state.focus.status).toBe('running');
    expect(app.pill.snapshot()?.status).toMatch(/^2[01]:\d\d$/);     // the pill is a countdown (in seconds: it has just popped in)
    await tick(6 * MIN);
    app.brain.tick();
    expect(app.brain.state.focus.status).toBe('running');
    expect(app.brain.state.focus.remainingMs).toBeLessThan(inIsland - 6 * MIN + 2500);
    expect(app.brain.state.focus.remainingMs).toBeGreaterThan(inIsland - 6 * MIN - 2500);

    await go(app, 'island');
    expect(app.brain.state.focus.status).toBe('running');
    expect(app.snap().showing).toBe('focus');
    expect(app.island.parts()?.stage.actor.object.getObjectByName('glasses')?.visible).toBe(true);
    expect(document.querySelector<HTMLElement>('.dzk-focus-chip')?.dataset.show).toBe('1');
    expect(document.querySelector<HTMLElement>('.dzk-focus-chip')?.textContent).toMatch(/^1[45]:\d\d$/);

    // Paused in one view, still paused in the other, and resumed there.
    app.brain.pauseFocus();
    await go(app, 'pill');
    expect(app.brain.state.focus.status).toBe('paused');
    const pausedAt = app.brain.state.focus.remainingMs;
    await tick(3 * MIN);
    app.brain.tick();
    expect(app.brain.state.focus.remainingMs).toBe(pausedAt);
    app.brain.resumeFocus();
    await go(app, 'island');
    expect(app.brain.state.focus.status).toBe('running');

    // It runs out while the Island is showing.
    await tick(16 * MIN);
    app.brain.tick();
    await tick(200);
    expect(app.brain.state.focus.status).toBe('idle');
    expect(app.brain.state.sessionsCompleted).toBe(before.sessions + 1);
    expect(app.brain.state.treats).toBe(before.treats + 3);          // 2 for 25 minutes, 1 for the first of the day
    expect(app.brain.state.streak.current).toBe(1);
    expect(app.shell.state.focusable).toBe(false);
    app.stop();
  });

  it('started in the Pill, finished while the Island shows: Doozer celebrates there', async () => {
    const app = await startApp();
    app.brain.startFocus();
    await tick(2 * MIN);
    await go(app, 'island');
    expect(app.snap().showing).toBe('focus');
    app.brain.debug?.finishFocusNow();
    expect(app.snap().scene).toBe('focus-complete');
    await tick(8000);
    expect(app.snap()).toMatchObject({ scene: null, mood: app.brain.state.mood });
    expect(app.brain.state.sessionsCompleted).toBe(1);
    app.stop();
  });

  it('what carries over, carries over: needs, bowl, treats, sleep, colour', async () => {
    const app = await startApp();
    app.brain.fillBowl();
    app.brain.setSetting('palette', 'lavender');
    app.brain.debug?.setNeeds({ energy: 40 });
    app.brain.sleep();
    const was = { needs: { ...app.brain.state.needs }, bowl: app.brain.state.bowl, treats: app.brain.state.treats };
    await go(app, 'island');
    expect(app.brain.state).toMatchObject({ asleep: true, bowl: was.bowl, treats: was.treats });
    expect(app.snap()).toMatchObject({ mood: 'asleep', showing: 'asleep' });
    await tick(4000);
    expect(app.snap().night).toBe(1);                                 // it arrives at night, because Doozer is asleep
    expect(app.island.parts()?.stage.actor.palette).toBe('lavender');
    await go(app, 'pill');
    expect(app.brain.state.asleep).toBe(true);
    expect(app.pill.parts()?.mini.palette).toBe('lavender');
    app.stop();
  });
});

describe('switched in the middle of a scene', () => {
  it('each scene, left for the Pill part-way: the Island is gone whole, and comes back whole', async () => {
    const app = await startApp();
    const scenes: [string, () => void][] = [
      ['feed', () => void app.brain.feed()], ['treat', () => void app.brain.giveTreat()], ['play', () => void app.brain.play()],
      ['wash', () => void app.brain.wash()], ['sleep', () => void app.brain.sleep()],
    ];
    await go(app, 'island');
    for (const [name, start] of scenes) {
      if (app.brain.state.asleep) app.brain.wake();
      app.brain.debug?.setNeeds({ tummy: 35, fun: 40, energy: 62, clean: 35 });
      app.brain.debug?.addTreats(2);
      await tick(9000);
      start();
      await tick(700);
      expect(app.snap().scene === null && name !== 'sleep', name).toBe(false);
      await go(app, 'pill');
      expect(app.island.snapshot(), name).toBeNull();
      expect(document.querySelector('.islv'), name).toBeNull();
      expect(document.querySelectorAll('canvas'), name).toHaveLength(0);
      expect(app.painters.made.every((painter) => painter.disposed), name).toBe(true);
      expect(app.pill.snapshot(), name).not.toBeNull();
      await go(app, 'island');
      expect(app.snap(), name).toMatchObject({ awake: true, gone: false, snack: null, ball: null });
      expect(app.shell.state.regions.length, name).toBeGreaterThan(8);
    }
    expect(app.painters.made.length).toBe(scenes.length + 1);
    app.stop();
    expect(app.painters.made.every((painter) => painter.disposed)).toBe(true);
  });

  it('ten times in and out through the host leaves one view on screen and nothing else', async () => {
    const app = await startApp();
    for (let i = 0; i < 10; i++) {
      await go(app, 'island');
      app.brain.debug?.setNeeds({ tummy: 40 });
      app.brain.feed();
      await tick(500);
      await go(app, 'pill');
    }
    expect(app.painters.made).toHaveLength(10);
    expect(app.painters.made.every((painter) => painter.disposed)).toBe(true);
    expect(document.querySelectorAll('.islv')).toHaveLength(0);
    expect(document.querySelectorAll('.pillv')).toHaveLength(1);
    expect(app.host.current()).toBe('pill');
    app.stop();
  });

  it('a switch asked for while the Island is still loading ends in the view asked for last', async () => {
    const app = await startApp();
    void app.host.switchTo('island');
    void app.host.switchTo('pill');
    await tick(3000);
    await app.host.settled();
    expect(app.host.current()).toBe('pill');
    expect(document.querySelectorAll('.islv')).toHaveLength(0);
    expect(app.painters.made.every((painter) => painter.disposed)).toBe(true);
    app.stop();
  });

  it('tucked away behind a fullscreen app in the Island: no timer of the view runs, and it comes back', async () => {
    const app = await startApp();
    await go(app, 'island');
    app.brain.debug?.setNeeds({ tummy: 40 });
    app.brain.feed();
    await tick(600);
    app.host.setFullscreen(true);
    expect(app.snap()).toMatchObject({ awake: false, scene: null, drawing: false, timers: [] });
    expect(app.shell.state.regions).toEqual([]);
    await tick(30_000);
    expect(app.snap().timers).toEqual([]);
    app.host.setFullscreen(false);
    expect(app.snap().awake).toBe(true);
    expect(app.shell.state.regions.length).toBeGreaterThan(8);
    app.stop();
  });
});
