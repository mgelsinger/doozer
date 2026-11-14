// @vitest-environment happy-dom
//
// One pet, four homes (DESIGN_SPEC.md 5.1): the Desktop view next to the Pill under the
// real host. Switching between them in the middle of a focus session loses nothing, the
// spot Doozer was left at comes back from the save, and the app reopens where it was.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrain, type Brain, type ViewId } from '../../../src/core';
import { createHost, type Host } from '../../../src/host/host';
import { freshHostData, parseSave, type HostData } from '../../../src/host/store';
import type { Region, Shell, WindowInfo, WindowMode } from '../../../src/shell';
import { createDesktopView, type DesktopSnapshot, type DesktopView } from '../../../src/views/desktop';
import { readSpots } from '../../../src/views/desktop/stage';
import { createPillView, type PillView } from '../../../src/views/pill';
import { MIN, START, seeded } from '../../core/helpers';
import { INFO, click, pointer } from './harness';

function fakeShell() {
  const saves: string[] = [];
  const state = { regions: [] as readonly Region[], mode: null as WindowMode | null, focusable: false };
  const info = (mode: WindowMode, view: ViewId | null): WindowInfo => (mode.kind === 'overlay'
    ? { ...INFO, view }
    : { ...INFO, kind: mode.kind, view, width: 600, height: 1116, cssWidth: 400, cssHeight: 744 });
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const shell = {
    native: true,
    async setWindowMode(mode: WindowMode, view?: ViewId) { state.mode = mode; return info(mode, view ?? null); },
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
  desktop: DesktopView;
  shell: ReturnType<typeof fakeShell>;
  snap: () => DesktopSnapshot;
}

const tick = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);

/** The app as main.ts builds it: the brain, the host, and the two views. */
async function startApp(save?: { brain: unknown; host: HostData }): Promise<App> {
  const shell = fakeShell();
  const brain = createBrain({ save: save?.brain, now: () => Date.now(), random: seeded(4), debug: true });
  if (!save) {
    brain.debug?.setNeeds({ tummy: 80, fun: 80, energy: 80, clean: 80 });
    brain.setSetting('soundAsked', true);
    brain.setSetting('reduceMotion', 'off');
  }
  const pill = createPillView({ now: () => Date.now(), random: seeded(5) });
  const desktop = createDesktopView({ now: () => Date.now(), random: seeded(6), frame: null });
  const hostData = save?.host ?? freshHostData();
  if (!save) hostData.welcomedPet = brain.state.bornAt;
  const root = document.createElement('div');
  document.body.append(root);
  const host = createHost({ root, shell: shell.shell, brain, views: [pill, desktop], hostData, frame: async () => undefined });
  const starting = host.start();
  await tick(600);
  await starting;
  return { host, brain, pill, desktop, shell, snap: () => desktop.snapshot() as DesktopSnapshot };
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

describe('the Desktop view under the real host, beside the Pill', () => {
  it('is no longer "coming soon": the Card in the Pill offers it, and takes Doozer there', async () => {
    const app = await startApp();
    expect(app.host.services.availableViews).toEqual(['pill', 'desktop']);
    expect(app.host.current()).toBe('pill');
    app.pill.setOpen('card');
    const card = app.pill.parts()!.card.el;
    const toDesktop = card.querySelector<HTMLButtonElement>('[data-view="desktop"]')!;
    expect(toDesktop.disabled).toBe(false);
    expect(card.querySelector<HTMLButtonElement>('[data-view="room"]')!.disabled).toBe(true);
    click(toDesktop);
    await tick(1500);
    await app.host.settled();
    expect(app.host.current()).toBe('desktop');
    expect(app.shell.state.mode).toEqual({ kind: 'overlay' });
    expect(app.brain.settings.lastView).toBe('desktop');
    // The host reports Doozer's hit region, and only that.
    await tick(700);
    expect(app.shell.state.regions).toHaveLength(1);
    expect(app.pill.snapshot()).toBeNull();
    expect(app.snap()).toMatchObject({ state: 'idle', atRest: true, stage: { w: 2560, h: 1392 } });

    // And back, from the Desktop's own Card.
    app.desktop.setOpen('card');
    click(app.desktop.parts()!.card.el.querySelector<HTMLElement>('[data-view="pill"]')!);
    await tick(1500);
    await app.host.settled();
    expect(app.host.current()).toBe('pill');
    expect(app.desktop.snapshot()).toBeNull();
    expect(app.shell.state.focusable).toBe(false);
    app.host.stop();
  });

  it('a focus session goes to the Desktop and back to the Pill without losing a second', async () => {
    const app = await startApp();
    const { brain } = app;
    brain.setSetting('desktopActivity', 'lively');
    expect(brain.startFocus().ok).toBe(true);
    await tick(5 * MIN);
    expect(app.pill.snapshot()?.status).toMatch(/^20:0[01]$/);
    const before = { treats: brain.state.treats, sessions: brain.state.sessionsCompleted, streak: brain.state.streak.current, bowl: brain.state.bowl };

    await go(app, 'desktop');
    const startedAt = Date.now();
    let s = app.snap();
    expect(brain.state.focus.status).toBe('running');
    expect(brain.state.focus.remainingMs).toBeGreaterThan(20 * MIN - 3000);
    expect(app.desktop.parts()!.doozer.el.dataset.glasses).toBe('1');
    // Sits still, even at the Lively pace, for as long as the session runs.
    const x = s.x;
    await tick(10 * MIN);
    s = app.snap();
    expect(s.x).toBe(x);
    expect(s.scenes.stroll).toBeUndefined();
    expect(s.emotes).toBe(0);
    expect(brain.state.focus.remainingMs).toBeCloseTo(20 * MIN - 1500 - 10 * MIN, -4);
    // The time left shows on hover.
    const { hit, chip } = app.desktop.parts()!;
    const at = { x: s.x, y: s.y - 50 };
    pointer(hit, 'pointermove', at);
    await tick(250);
    pointer(hit, 'pointermove', at);
    expect(app.snap().chip).toBe(true);
    expect(chip.textContent).toMatch(/^09:\d\d$/);

    // Paused in the Desktop, to the Pill, resumed there.
    brain.pauseFocus();
    const pausedAt = brain.state.focus.remainingMs;
    await go(app, 'pill');
    expect(brain.state.focus.status).toBe('paused');
    expect(brain.state.focus.remainingMs).toBe(pausedAt);
    expect(app.pill.snapshot()?.status).toMatch(/09:\d\d$/);
    brain.resumeFocus();
    await tick(4 * MIN);

    // Back in the Desktop for the end of it.
    await go(app, 'desktop');
    expect(brain.state.focus.status).toBe('running');
    expect(brain.state.focus.remainingMs).toBeLessThan(pausedAt - 4 * MIN + 1000);
    await tick(brain.state.focus.remainingMs + 500);
    expect(brain.state.focus.status).toBe('idle');
    expect(brain.state.sessionsCompleted).toBe(before.sessions + 1);
    expect(brain.state.treats).toBe(before.treats + 3);   // 2 for 25 minutes, 1 for the first of the day
    expect(brain.state.streak.current).toBe(before.streak + 1);
    expect(brain.state.bowl).toBe(before.bowl);
    expect(Date.now() - startedAt).toBeGreaterThan(14 * MIN);
    expect(app.snap().scene).toBe('celebrate');
    await tick(8000);
    expect(app.snap().scenes.celebrate).toMatchObject({ finished: 1 });
    expect(app.snap().rescues).toEqual([]);
    expect(app.desktop.parts()!.doozer.el.dataset.glasses).toBe('0');
    // With the session over, Lively is lively again.
    await tick(MIN);
    expect(app.snap().scenes.stroll).toBeDefined();
    app.host.stop();
  });

  it('a session survives a restart in the Desktop view, and the app reopens there', async () => {
    const app = await startApp();
    await go(app, 'desktop');
    app.brain.startFocus();
    await tick(6 * MIN);
    await app.host.flush();
    const saved = parseSave(app.shell.saves.at(-1) ?? null);
    app.host.stop();

    await tick(2 * MIN);
    const again = await startApp({ brain: saved.brain, host: saved.host });
    expect(again.host.current()).toBe('desktop');
    expect(again.brain.state.focus.status).toBe('running');
    expect(again.brain.state.focus.remainingMs).toBeCloseTo(25 * MIN - 8 * MIN, -4);
    expect(again.desktop.parts()!.doozer.el.dataset.glasses).toBe('1');
    expect(again.snap().state).toBe('idle');
    again.host.stop();
  });

  it('the spot Doozer was put down at is in the save, and comes back', async () => {
    const app = await startApp();
    await go(app, 'desktop');
    const { hit } = app.desktop.parts()!;
    const s = app.snap();
    const from = { x: s.x, y: s.y - 50 };
    pointer(hit, 'pointerdown', from, { buttons: 1 });
    pointer(hit, 'pointermove', { x: from.x - 30, y: from.y - 30 }, { buttons: 1 });
    pointer(hit, 'pointermove', { x: 500, y: 700 }, { buttons: 1 });
    pointer(window, 'pointerup', { x: 500, y: 700 });
    await tick(4000);
    const leftAt = app.snap().x;
    expect(app.snap().atRest).toBe(true);
    expect(Math.abs(leftAt - 500)).toBeLessThan(5);
    // Saved within a second or so of being put down.
    await tick(1500);
    const saved = parseSave(app.shell.saves.at(-1) ?? null);
    const spots = readSpots(saved.host.memory?.desktop);
    expect(spots['3840x2160@0,0']!.f).toBeCloseTo(leftAt / 2560, 3);

    // To the Pill and back: the same spot.
    await go(app, 'pill');
    await go(app, 'desktop');
    expect(app.snap().x).toBeCloseTo(leftAt, 0);
    app.host.stop();

    // A new start from that save: the same spot.
    const again = await startApp({ brain: saved.brain, host: saved.host });
    expect(again.host.current()).toBe('desktop');
    expect(again.snap().x).toBeCloseTo(leftAt, 0);
    again.host.stop();
  });

  it('switching away in the middle of anything leaves nothing behind', async () => {
    const app = await startApp();
    const before = vi.getTimerCount();
    await go(app, 'desktop');
    app.brain.setSetting('desktopActivity', 'lively');
    app.brain.debug?.setNeeds({ tummy: 40, fun: 40 });
    app.brain.play();
    await tick(1200);
    const { hit } = app.desktop.parts()!;
    const s = app.snap();
    pointer(hit, 'pointerdown', { x: s.x, y: s.y - 50 }, { buttons: 1 });
    pointer(hit, 'pointermove', { x: s.x + 200, y: s.y - 400 }, { buttons: 1 });
    expect(app.snap().state).toBe('carried');
    await go(app, 'pill');
    expect(app.desktop.snapshot()).toBeNull();
    expect(document.querySelectorAll('.deskv, .deskv-prop, .dzk-radial').length).toBe(0);
    // Only the Pill's and the host's timers are left: the same number as before the visit.
    await tick(30_000);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(before + 2);
    // The hand lets go at last: nothing answers, nothing breaks.
    pointer(window, 'pointerup', { x: 0, y: 0 });
    await go(app, 'desktop');
    await tick(3000);
    expect(app.snap().rescues).toEqual([]);
    expect(app.snap().state).not.toBe('carried');
    app.host.stop();
  });
});
