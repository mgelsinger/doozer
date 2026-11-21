import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrain, type Brain, type Settings, type ViewId } from '../../src/core';
import { ENTER_LIMIT_MS, HIDE_FRAMES, LEAVE_LIMIT_MS, RELEASE_AFTER_MS, RELEASE_FOR_MS, TICK_AFTER_MS, UI_SCALE, createHost, type Host, type Presence } from '../../src/host/host';
import { freshHostData, parseSave, type HostData } from '../../src/host/store';
import type { View, ViewContext, WindowRequest } from '../../src/host/view';
import type { Region, Shell, ShellEvents, WindowInfo, WindowMode } from '../../src/shell';
import { HOUR, MIN, fakeClock, seeded, START } from '../core/helpers';

// ---- fakes -----------------------------------------------------------------------

/** Everything that happens, in order, across the shell, the root and the views. */
type Log = string[];

function fakeShell(log: Log) {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const saves: string[] = [];
  const state = {
    fullscreen: false,
    autostart: false,
    failMode: null as ViewId | null,
    failAutostart: false,
    regions: [] as readonly Region[],
    lastMode: null as WindowMode | null,
    quits: 0,
  };
  const info = (mode: WindowMode, view: ViewId | null): WindowInfo => ({
    kind: mode.kind, view, x: 100, y: 0, width: 600, height: 1116, scale: 1.5, cssWidth: 400, cssHeight: 744,
    monitor: { full: { x: 0, y: 0, w: 3840, h: 2160 }, work: { x: 0, y: 0, w: 3840, h: 2088 }, scale: 1.5 }, nativeMs: 1,
  });
  const shell: Shell = {
    native: true,
    async setWindowMode(mode, view) {
      log.push(`window:${view ?? '-'}:${mode.kind}`);
      if (view && state.failMode === view) throw new Error('the window would not change');
      state.lastMode = mode;
      return info(mode, view ?? null);
    },
    windowInfo: async () => null,
    setHitRegions(regions) {
      state.regions = regions;
      log.push(`regions:${regions.length}`);
    },
    regionsFlushed: async () => undefined,
    beginDrag: async () => false,
    async setFocusable(focusable) { log.push(`focusable:${focusable}`); },
    async setVisible(visible) { log.push(`visible:${visible}`); },
    async setAlwaysOnTop(onTop) { log.push(`onTop:${onTop}`); },
    fullscreenInFront: async () => state.fullscreen,
    load: async () => ({ data: null, source: 'none', problem: null }),
    async save(json) { saves.push(json); },
    async showMenu() { log.push('menu'); },
    async setAvailableViews(views) { log.push(`available:${views.join('+')}`); },
    autostartEnabled: async () => state.autostart,
    async setAutostart(enabled) {
      log.push(`autostart:${enabled}`);
      if (state.failAutostart) throw new Error('a development build is not registered');
      state.autostart = enabled;
      return enabled;
    },
    async quit() { state.quits++; log.push('quit'); },
    on(event, handler) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler as (payload: unknown) => void);
      handlers.set(event, set);
      return () => void set.delete(handler as (payload: unknown) => void);
    },
  };
  return {
    shell, state, saves,
    emit<K extends keyof ShellEvents>(event: K, payload: ShellEvents[K]): void {
      handlers.get(event)?.forEach((handler) => handler(payload));
    },
    listeners: (event: string) => handlers.get(event)?.size ?? 0,
  };
}

interface FakeViewOptions {
  /** A pop-out that never finishes. */
  leaveHangs?: boolean;
  mountThrows?: boolean;
  windowSettings?: readonly (keyof Settings)[];
  regions?: number;
  /** Uses a lot of memory: the host has the browser give it back afterwards. */
  heavy?: boolean;
}

function fakeView(id: ViewId, log: Log, options: FakeViewOptions = {}) {
  const seen = { requests: [] as WindowRequest[], contexts: [] as ViewContext[], awake: [] as boolean[], away: 0, mounted: false };
  const view: View = {
    id,
    heavy: options.heavy,
    windowSettings: options.windowSettings,
    window(request) {
      seen.requests.push(request);
      return id === 'pill'
        ? { kind: 'docked', width: 400, height: 744, anchor: request.settings.pillDock }
        : { kind: 'floating', width: 380, height: 464, ...(request.position ?? {}) };
    },
    mount(_root, context) {
      log.push(`${id}.mount`);
      if (options.mountThrows) throw new Error(`${id} would not mount`);
      seen.mounted = true;
      seen.contexts.push(context);
      // A view subscribes while mounting; the host must not tick before this.
      context.brain.on('away', () => { seen.away++; });
    },
    unmount() { seen.mounted = false; log.push(`${id}.unmount`); },
    hitRegions: () => Array.from({ length: options.regions ?? 2 }, (_, i) => ({ x: i, y: 0, w: 10, h: 10 })),
    leave() {
      log.push(`${id}.leave`);
      return options.leaveHangs ? new Promise(() => undefined) : Promise.resolve();
    },
    enter() { log.push(`${id}.enter`); return Promise.resolve(); },
    setAwake(awake) { seen.awake.push(awake); log.push(`${id}.awake:${awake}`); },
    windowChanged() { log.push(`${id}.windowChanged`); },
    openSettings() { log.push(`${id}.openSettings`); },
    openCard(keyboard) { log.push(`${id}.openCard:${keyboard}`); },
  };
  return { view, seen };
}

function fakeRoot(log: Log): HTMLElement {
  let visibility = '';
  const root = {
    style: {
      get visibility() { return visibility; },
      set visibility(value: string) {
        if (value !== visibility) log.push(`root:${value}`);
        visibility = value;
      },
    },
    replaceChildren() { /* nothing to remove in a fake */ },
  };
  return root as unknown as HTMLElement;
}

interface Rig {
  log: Log;
  host: Host;
  brain: Brain;
  shell: ReturnType<typeof fakeShell>;
  pill: ReturnType<typeof fakeView>;
  room: ReturnType<typeof fakeView>;
  hostData: HostData;
  chimes: { count: number };
  /** Every sound the host asked for, in order (the chime included). */
  sounds: string[];
  errors: string[];
  clock: ReturnType<typeof fakeClock>;
}

function rig(options: {
  save?: unknown; hostData?: HostData; pill?: FakeViewOptions; room?: FakeViewOptions;
  frameHangs?: boolean; persist?: boolean; setup?(shell: ReturnType<typeof fakeShell>): void;
  /** The shell can ask the browser to hold less memory (the real one can). */
  lowMemory?: boolean;
  /** The shell can draw the interface larger (the real one can). */
  uiScale?: boolean;
  /** Who is at the window (omit: somebody always is, as the host takes it). */
  presence?: Presence;
  /** The pet's clock runs with the timers, as the real one does, instead of standing until moved by hand. */
  timeRuns?: boolean;
} = {}): Rig {
  const log: Log = [];
  const shell = fakeShell(log);
  if (options.lowMemory) shell.shell.setLowMemory = async (low) => { log.push(`low:${low}`); };
  if (options.uiScale) shell.shell.setUiScale = async (factor) => { log.push(`scale:${factor}`); return factor; };
  options.setup?.(shell);
  const clock = fakeClock(START);
  const timersStartedAt = Date.now();
  const now = options.timeRuns ? () => clock.now() + (Date.now() - timersStartedAt) : clock.now;
  const brain = createBrain({ save: options.save, now, random: seeded(7), debug: true });
  const pill = fakeView('pill', log, options.pill);
  const room = fakeView('room', log, options.room);
  const hostData = options.hostData ?? freshHostData();
  const chimes = { count: 0 };
  const sounds: string[] = [];
  const errors: string[] = [];
  const host = createHost({
    root: fakeRoot(log),
    shell: shell.shell,
    brain,
    views: [pill.view, room.view],
    hostData,
    sound: { chime: () => { chimes.count++; sounds.push('chime'); }, play: (name) => void sounds.push(name) },
    frame: () => {
      log.push('frame');
      return options.frameHangs ? new Promise(() => undefined) : Promise.resolve();
    },
    persist: options.persist,
    presence: options.presence,
    log: (message) => void errors.push(message),
  });
  return { log, host, brain, shell, pill, room, hostData, chimes, sounds, errors, clock };
}

/** Start the host and let every promise settle. */
async function started(r: Rig): Promise<Rig> {
  const starting = r.host.start();
  await vi.advanceTimersByTimeAsync(0);
  await starting;
  return r;
}

const settle = (ms = 0): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);
const between = (log: Log, from: string, to: string): string[] => log.slice(log.indexOf(from), log.lastIndexOf(to) + 1);

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

// ---- tests -----------------------------------------------------------------------

describe('starting up', () => {
  it('opens in the Pill on first run: change the window, mount, show, then report regions', async () => {
    const r = await started(rig());
    expect(r.host.current()).toBe('pill');
    expect(r.log).toContain('available:pill+room');
    expect(between(r.log, 'window:pill:docked', 'pill.enter')).toEqual([
      'window:pill:docked', 'pill.mount', 'root:visible', 'frame', 'regions:2', 'pill.enter',
    ]);
    // Until the view is on screen nothing catches the mouse.
    expect(r.log.indexOf('regions:0')).toBeLessThan(r.log.indexOf('window:pill:docked'));
    expect(r.errors).toEqual([]);
  });

  it('reopens in the last view used', async () => {
    const first = await started(rig());
    await first.host.switchTo('room');
    await settle();
    expect(first.brain.settings.lastView).toBe('room');
    const second = await started(rig({ save: first.brain.serialize() }));
    expect(second.host.current()).toBe('room');
    expect(second.log).not.toContain('pill.mount');
  });

  it('falls back to the first view when the last one is not built in this build', async () => {
    const maker = createBrain({ now: () => START, random: seeded(1) });
    maker.setSetting('lastView', 'island');
    const r = await started(rig({ save: maker.serialize() }));
    expect(r.host.current()).toBe('pill');
  });

  it('mounts the view before the first tick, so time away is announced to it', async () => {
    const earlier = createBrain({ now: () => START - 3 * HOUR, random: seeded(1) });
    const r = rig({ save: earlier.serialize() });
    expect(r.pill.seen.away).toBe(0);
    await started(r);
    expect(r.pill.seen.away).toBe(1);
  });

  it('applies the window settings that were saved', async () => {
    const maker = createBrain({ now: () => START, random: seeded(1) });
    maker.setSetting('alwaysOnTop', false);
    maker.setSetting('startWithWindows', true);
    const r = await started(rig({ save: maker.serialize() }));
    expect(r.log).toContain('onTop:false');
    expect(r.log).toContain('autostart:true');
  });

  it('does not touch the Run key when it already says what the setting says', async () => {
    const r = await started(rig());
    expect(r.log.filter((line) => line.startsWith('autostart'))).toEqual([]);
  });
});

describe('switching view', () => {
  it('follows the three steps, with the pop-out before and the pop-in after', async () => {
    const r = await started(rig());
    r.log.length = 0;
    const done = r.host.switchTo('room');
    await settle();
    expect(await done).toBe(true);
    expect(r.log).toEqual([
      'pill.leave',
      'root:hidden', 'regions:0', ...Array<string>(HIDE_FRAMES).fill('frame'),
      'pill.unmount',
      'window:room:floating',
      'room.mount', 'root:visible', 'frame', 'regions:2', 'room.enter',
    ]);
    expect(r.host.current()).toBe('room');
    expect(r.pill.seen.mounted).toBe(false);
  });

  it('remembers the last view in the save', async () => {
    const r = await started(rig());
    await r.host.switchTo('room');
    await settle(1000);
    const saved = parseSave(r.shell.saves.at(-1) ?? null);
    expect(createBrain({ save: saved.brain }).settings.lastView).toBe('room');
  });

  it('asking for the view that is already showing does nothing', async () => {
    const r = await started(rig());
    r.log.length = 0;
    expect(await r.host.switchTo('pill')).toBe(true);
    expect(r.log).toEqual([]);
  });

  it('ignores a view that is not built yet, from the Card or from the tray', async () => {
    const r = await started(rig());
    r.log.length = 0;
    expect(await r.host.switchTo('island')).toBe(false);
    r.shell.emit('view-requested', 'desktop');
    r.host.services.switchView('island');
    await settle();
    expect(r.log).toEqual([]);
    expect(r.host.current()).toBe('pill');
  });

  it('switches when the tray asks', async () => {
    const r = await started(rig());
    r.shell.emit('view-requested', 'room');
    await settle();
    expect(r.host.current()).toBe('room');
  });

  it('runs requests one at a time and ends on the last one asked for', async () => {
    const r = await started(rig());
    void r.host.switchTo('room');
    void r.host.switchTo('pill');
    const last = r.host.switchTo('room');
    await settle();
    expect(await last).toBe(true);
    expect(r.host.current()).toBe('room');
    // Never two views mounted at once.
    let mounted = 0;
    for (const line of r.log) {
      if (line.endsWith('.mount')) mounted++;
      if (line.endsWith('.unmount')) mounted--;
      expect(mounted).toBeLessThanOrEqual(1);
    }
  });

  it('does not wait for ever for a pop-out that never finishes', async () => {
    const r = await started(rig({ pill: { leaveHangs: true } }));
    const done = r.host.switchTo('room');
    await settle(LEAVE_LIMIT_MS - 1);
    expect(r.host.current()).toBe('pill');
    await settle(1);
    expect(await done).toBe(true);
    expect(r.host.current()).toBe('room');
  });

  it('does not wait for ever for animation frames that never come (a hidden window draws none)', async () => {
    const r = rig({ frameHangs: true });
    const starting = r.host.start();
    await settle(1000);
    await starting;
    const done = r.host.switchTo('room');
    await settle(2000);
    expect(await done).toBe(true);
    expect(r.host.current()).toBe('room');
    expect(r.shell.state.regions).toHaveLength(2);
  });

  it('falls back to the Pill when a view throws while mounting, and is not left stuck', async () => {
    const r = await started(rig({ room: { mountThrows: true } }));
    expect(await r.host.switchTo('room').then((ok) => ok, () => 'threw')).toBe(false);
    await settle();
    expect(r.host.current()).toBe('pill');
    expect(r.shell.state.regions).toHaveLength(2);
    expect(r.log.filter((line) => line === 'room.unmount')).toHaveLength(1);
    // The host still works afterwards.
    r.shell.emit('settings-requested', null);
    expect(r.log.at(-1)).toBe('pill.openSettings');
  });

  it('falls back to the Pill when the window refuses to change', async () => {
    const r = await started(rig());
    r.shell.state.failMode = 'room';
    const done = r.host.switchTo('room');
    await settle();
    expect(await done).toBe(false);
    expect(r.host.current()).toBe('pill');
    expect(r.shell.state.regions).toHaveLength(2);
    expect(r.brain.settings.lastView).toBe('pill');
  });

  it('with nothing that can be shown, is invisible and click-through rather than broken', async () => {
    const r = rig({ pill: { mountThrows: true } });
    const starting = r.host.start();
    await settle();
    await starting;
    expect(r.host.current()).toBeNull();
    expect(r.shell.state.regions).toEqual([]);
  });

  it('takes the keyboard back from a view that is leaving', async () => {
    const r = await started(rig());
    r.host.services.setFocusable(true);
    r.host.services.setFocusable(true);
    expect(r.log.filter((line) => line === 'focusable:true')).toHaveLength(1);
    await r.host.switchTo('room');
    await settle();
    expect(r.log.filter((line) => line === 'focusable:false')).toHaveLength(1);
  });
});

describe('window positions', () => {
  it('remembers where each view was dragged to and hands it back', async () => {
    const r = await started(rig());
    await r.host.switchTo('room');
    await settle();
    expect(r.room.seen.requests.at(-1)?.position).toBeNull();
    r.shell.emit('drag-end', { x: 1234, y: 567 } as WindowInfo);
    await settle(1000);
    expect(r.hostData.positions).toEqual({ room: { x: 1234, y: 567 } });
    expect(parseSave(r.shell.saves.at(-1) ?? null).host.positions).toEqual({ room: { x: 1234, y: 567 } });

    await r.host.switchTo('pill');
    await r.host.switchTo('room');
    await settle();
    expect(r.room.seen.requests.at(-1)?.position).toEqual({ x: 1234, y: 567 });
    expect(r.shell.state.lastMode).toMatchObject({ kind: 'floating', x: 1234, y: 567 });
  });

  it('starts from the positions in the save', async () => {
    const r = await started(rig({ hostData: { welcomedPet: null, positions: { room: { x: 9, y: 8 } } } }));
    await r.host.switchTo('room');
    await settle();
    expect(r.shell.state.lastMode).toMatchObject({ x: 9, y: 8 });
  });
});

describe('re-placing the window', () => {
  it('moves the window without remounting when a setting the view named changes', async () => {
    const r = await started(rig({ pill: { windowSettings: ['pillDock'] } }));
    r.log.length = 0;
    r.brain.setSetting('pillDock', 'bottom-right');
    await settle();
    await r.host.settled();
    expect(r.log).toEqual([
      'pill.leave',
      'root:hidden', 'regions:0', ...Array<string>(HIDE_FRAMES).fill('frame'),
      'window:pill:docked', 'pill.windowChanged',
      'root:visible', 'frame', 'regions:2', 'pill.enter',
    ]);
    expect(r.shell.state.lastMode).toMatchObject({ anchor: 'bottom-right' });
  });

  it('several changes in a row are one move', async () => {
    const r = await started(rig({ pill: { windowSettings: ['pillDock'] } }));
    r.log.length = 0;
    r.brain.setSetting('pillDock', 'top-left');
    r.brain.setSetting('pillDock', 'top-right');
    r.brain.setSetting('pillDock', 'bottom-right');
    await settle();
    await r.host.settled();
    expect(r.log.filter((line) => line.startsWith('window:'))).toHaveLength(1);
    expect(r.shell.state.lastMode).toMatchObject({ anchor: 'bottom-right' });
  });

  it('a setting the view did not name leaves the window alone', async () => {
    const r = await started(rig({ pill: { windowSettings: ['pillDock'] } }));
    r.log.length = 0;
    r.brain.setSetting('palette', 'mint');
    await settle();
    expect(r.log.filter((line) => line.startsWith('window:'))).toEqual([]);
  });

  it('comes back on screen even if the window refuses', async () => {
    const r = await started(rig({ pill: { windowSettings: ['pillDock'] } }));
    r.shell.state.failMode = 'pill';
    r.brain.setSetting('pillDock', 'top-left');
    await settle();
    await r.host.settled();
    expect(r.log.at(-1)).toBe('pill.enter');
    expect(r.shell.state.regions).toHaveLength(2);
  });

  it('tells the view when the display changed under it', async () => {
    const r = await started(rig());
    r.log.length = 0;
    r.shell.emit('display-changed', {} as WindowInfo);
    expect(r.log).toEqual(['pill.windowChanged', 'regions:2']);
  });

  it('reports the regions again after the watchdog dropped them', async () => {
    const r = await started(rig());
    r.log.length = 0;
    r.shell.emit('watchdog', 'page-silent');
    expect(r.log).toEqual(['regions:2']);
  });
});

describe('tuck away during fullscreen apps', () => {
  it('hides, stops the view and lets every click through; comes back when the app leaves', async () => {
    const r = await started(rig());
    r.log.length = 0;
    r.shell.emit('fullscreen-changed', true);
    expect(r.log).toEqual(['pill.awake:false', 'regions:0', 'visible:false']);
    expect(r.host.awake()).toBe(false);
    r.log.length = 0;
    r.shell.emit('fullscreen-changed', false);
    expect(r.log).toEqual(['visible:true', 'pill.awake:true', 'regions:2']);
    expect(r.host.awake()).toBe(true);
  });

  it('keeps the pet alive while hidden: time passes and a session still ends', async () => {
    const r = await started(rig());
    r.brain.startFocus();
    r.shell.emit('fullscreen-changed', true);
    r.clock.advance(26 * MIN);
    await settle(1000);
    expect(r.brain.state.focus.status).toBe('idle');
    expect(r.brain.state.sessionsCompleted).toBe(1);
    expect(r.chimes.count).toBe(1);
  });

  it('ticks more slowly while hidden', async () => {
    const r = await started(rig());
    const ticks = vi.spyOn(r.brain, 'tick');
    await settle(1000);
    expect(ticks).toHaveBeenCalledTimes(4);
    r.shell.emit('fullscreen-changed', true);
    ticks.mockClear();
    await settle(3000);
    expect(ticks).toHaveBeenCalledTimes(3);
  });

  it('does nothing when the setting is off, and follows the setting when it changes', async () => {
    const r = await started(rig());
    r.brain.setSetting('tuckAwayInFullscreen', false);
    r.log.length = 0;
    r.shell.emit('fullscreen-changed', true);
    expect(r.log).toEqual([]);
    expect(r.host.awake()).toBe(true);
    r.brain.setSetting('tuckAwayInFullscreen', true);
    expect(r.log).toContain('visible:false');
    r.brain.setSetting('tuckAwayInFullscreen', false);
    expect(r.log.at(-1)).toBe('regions:2');
    expect(r.host.awake()).toBe(true);
  });

  it('starts hidden when a fullscreen app is already in front', async () => {
    const r = await started(rig({ setup: (shell) => { shell.state.fullscreen = true; } }));
    expect(r.host.awake()).toBe(false);
    expect(r.log.indexOf('visible:false')).toBeLessThan(r.log.indexOf('pill.mount'));
    expect(r.pill.seen.awake).toEqual([false]);
    expect(r.shell.state.regions).toEqual([]);
    expect(r.log).not.toContain('pill.enter');
  });

  it('a view mounted while hidden is told it is asleep', async () => {
    const r = await started(rig());
    r.shell.emit('fullscreen-changed', true);
    await r.host.switchTo('room');
    await settle();
    expect(r.room.seen.awake).toEqual([false]);
    expect(r.shell.state.regions).toEqual([]);
    expect(r.log).not.toContain('pill.leave');
  });
});

describe('sound', () => {
  const ready = (r: Rig): void => {
    r.brain.debug?.setNeeds({ tummy: 50, fun: 40, energy: 70, clean: 40 });
    r.brain.debug?.addTreats(3);
    r.sounds.length = 0;
  };

  it('each thing you do has its sound', async () => {
    const r = await started(rig());
    ready(r);
    r.brain.feed();
    r.brain.giveTreat();
    r.brain.fillBowl();
    r.brain.play();
    r.brain.wash();
    r.brain.pet();
    expect(r.sounds).toEqual(['munch', 'yum', 'kibble', 'boing', 'bubbles', 'chirp']);
    r.sounds.length = 0;
    r.brain.debug?.setNeeds({ energy: 30 });
    r.brain.sleep();
    r.brain.wake();
    expect(r.sounds).toEqual(['lullaby', 'morning']);
  });

  it('a refusal has one too', async () => {
    const r = await started(rig());
    ready(r);
    r.brain.debug?.setNeeds({ tummy: 100 });
    expect(r.brain.feed().ok).toBe(false);
    expect(r.sounds).toEqual(['hm']);
  });

  it('what Doozer does by itself makes no sound: eating from the bowl, falling asleep worn out, waking rested', async () => {
    const r = await started(rig());
    ready(r);
    r.brain.fillBowl();
    r.sounds.length = 0;
    const seen: string[] = [];
    r.brain.on('action', (event) => { seen.push(event.type === 'sleep' || event.type === 'wake' ? `${event.type}:${event.why}` : event.type); });
    // Hungry and worn out, and then left alone for half a day.
    r.brain.debug?.setNeeds({ tummy: 40, energy: 6 });
    for (let i = 0; i < 12 * 60; i++) {
      r.clock.advance(MIN);
      await settle(1000);
    }
    expect(seen).toContain('auto-eat');
    expect(seen).toContain('sleep:exhausted');
    expect(seen).toContain('wake:rested');
    expect(r.sounds).toEqual([]);
  });

  it('a session begins with one sound and ends with the chime, and is silent in between whatever you do', async () => {
    const r = await started(rig());
    ready(r);
    r.brain.startFocus();
    expect(r.sounds).toEqual(['begin']);
    r.brain.feed();
    r.brain.pet();
    r.brain.wash();
    r.brain.debug?.setNeeds({ tummy: 100 });
    r.brain.feed();
    expect(r.sounds).toEqual(['begin']);
    // Paused, it is not a session for the moment: Doozer answers again.
    r.brain.pauseFocus();
    r.brain.pet();
    expect(r.sounds).toEqual(['begin', 'chirp']);
    r.brain.resumeFocus();
    r.sounds.length = 0;
    r.clock.advance(26 * MIN);
    await settle(1000);
    expect(r.brain.state.focus.status).toBe('idle');
    expect(r.sounds[0]).toBe('chime');
    expect(r.chimes.count).toBe(1);
  });

  it('an unlock adds a sparkle after the chime', async () => {
    const r = await started(rig());
    r.brain.startFocus();
    r.sounds.length = 0;
    r.clock.advance(26 * MIN);
    await settle(400);
    // The first session ever unlocks the cookie.
    expect(r.brain.state.sessionsCompleted).toBe(1);
    expect(r.sounds).toEqual(['chime']);
    // A moment later, once the chime has had its say.
    await settle(700);
    expect(r.sounds).toEqual(['chime', 'sparkle']);
    // The second unlocks nothing: the chime alone.
    r.brain.startFocus();
    r.sounds.length = 0;
    r.clock.advance(26 * MIN);
    await settle(2000);
    expect(r.sounds).toEqual(['chime']);
  });

  it('moving to another view pops; arriving at start-up and falling back do not', async () => {
    const r = await started(rig());
    expect(r.sounds).toEqual([]);
    await r.host.switchTo('room');
    expect(r.sounds).toEqual(['pop']);
    await r.host.switchTo('room');
    expect(r.sounds).toEqual(['pop']);
  });

  it('tucked away, Doozer is silent, but a session that ends is still heard', async () => {
    const r = await started(rig());
    ready(r);
    r.shell.emit('fullscreen-changed', true);
    r.brain.feed();
    r.brain.pet();
    expect(r.sounds).toEqual([]);
    r.brain.startFocus();
    expect(r.sounds).toEqual([]);
    r.clock.advance(26 * MIN);
    await settle(2500);
    expect(r.sounds).toEqual(['chime', 'sparkle']);
  });

  it('a host given only a chime (an older caller) still chimes and plays nothing else', async () => {
    const log: Log = [];
    const shell = fakeShell(log);
    const clock = fakeClock(START);
    const brain = createBrain({ now: clock.now, random: seeded(7), debug: true });
    let chimes = 0;
    const host = createHost({
      root: fakeRoot(log), shell: shell.shell, brain, views: [fakeView('pill', log).view], hostData: freshHostData(),
      sound: { chime: () => void chimes++ }, frame: () => Promise.resolve(), log: () => undefined,
    });
    const starting = host.start();
    await settle();
    await starting;
    brain.debug?.setNeeds({ tummy: 50 });
    brain.feed();
    brain.startFocus();
    clock.advance(26 * MIN);
    await settle(2000);
    expect(chimes).toBe(1);
    host.stop();
  });

  it('stopping leaves no sound waiting', async () => {
    const r = await started(rig());
    r.brain.startFocus();
    r.clock.advance(26 * MIN);
    await settle(300);
    r.sounds.length = 0;
    r.host.stop();
    await settle(2000);
    expect(r.sounds).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the interface size', () => {
  it('normal size asks the shell for nothing', async () => {
    const r = await started(rig({ uiScale: true }));
    expect(r.log.filter((entry) => entry.startsWith('scale:'))).toEqual([]);
  });

  it('a saved size is set before the first window is asked for, so the window is the right size from the start', async () => {
    const first = await started(rig());
    first.brain.setSetting('uiScale', 'larger');
    const save = first.brain.serialize();
    first.host.stop();
    const r = await started(rig({ uiScale: true, save }));
    expect(r.log.indexOf(`scale:${UI_SCALE.larger}`)).toBeGreaterThanOrEqual(0);
    expect(r.log.indexOf(`scale:${UI_SCALE.larger}`)).toBeLessThan(r.log.indexOf('window:pill:docked'));
  });

  it('changing it hides the view, resizes everything and asks for the window again, in that order', async () => {
    const r = await started(rig({ uiScale: true }));
    r.log.length = 0;
    r.brain.setSetting('uiScale', 'large');
    await settle();
    await r.host.settled();
    const order = ['root:hidden', `scale:${UI_SCALE.large}`, 'window:pill:docked', 'pill.windowChanged', 'root:visible', 'regions:2'];
    const at = order.map((entry) => r.log.indexOf(entry));
    expect(at.every((index) => index >= 0), r.log.join(' ')).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The view was not rebuilt for it.
    expect(r.log).not.toContain('pill.unmount');
    // Back to normal is a change like any other.
    r.log.length = 0;
    r.brain.setSetting('uiScale', 'normal');
    await settle();
    await r.host.settled();
    expect(r.log).toContain('scale:1');
    expect(r.log).toContain('window:pill:docked');
  });

  it('applies in whichever view is showing, and carries over a switch', async () => {
    const r = await started(rig({ uiScale: true }));
    await r.host.switchTo('room');
    r.log.length = 0;
    r.brain.setSetting('uiScale', 'larger');
    await settle();
    await r.host.settled();
    expect(r.log).toContain(`scale:${UI_SCALE.larger}`);
    expect(r.log).toContain('window:room:floating');
    r.log.length = 0;
    await r.host.switchTo('pill');
    // It is already that size: a switch does not set it again.
    expect(r.log.filter((entry) => entry.startsWith('scale:'))).toEqual([]);
  });

  it('a shell that cannot do it, or refuses, leaves everything else working', async () => {
    const plain = await started(rig());
    plain.brain.setSetting('uiScale', 'large');
    await settle();
    await plain.host.settled();
    expect(plain.host.current()).toBe('pill');
    expect(plain.errors).toEqual([]);

    const refusing = await started(rig({ setup: (s) => { s.shell.setUiScale = async () => { throw new Error('no zoom'); }; } }));
    refusing.brain.setSetting('uiScale', 'large');
    await settle();
    await refusing.host.settled();
    expect(refusing.host.current()).toBe('pill');
    expect(refusing.errors).toContain('setUiScale');
    expect(refusing.shell.state.regions.length).toBe(2);
  });
});

describe('giving memory back', () => {
  const lows = (log: Log): string[] => log.filter((entry) => entry.startsWith('low:'));

  it('tucked away, the browser is asked to hold as little as it can, and to carry on when Doozer is back', async () => {
    const r = await started(rig({ lowMemory: true }));
    expect(lows(r.log)).toEqual([]);
    r.log.length = 0;
    r.shell.emit('fullscreen-changed', true);
    expect(r.log).toEqual(['pill.awake:false', 'regions:0', 'visible:false', 'low:true']);
    await settle(10 * MIN);
    expect(lows(r.log)).toEqual(['low:true']);
    r.log.length = 0;
    r.shell.emit('fullscreen-changed', false);
    // Back to normal before anything is shown or started again.
    expect(r.log).toEqual(['low:false', 'visible:true', 'pill.awake:true', 'regions:2']);
  });

  it('after a heavy view has been left, once the next one has settled, for a few seconds', async () => {
    const r = await started(rig({ lowMemory: true, room: { heavy: true } }));
    await r.host.switchTo('room');
    await settle(60_000);
    // Being in the heavy view asks for nothing.
    expect(lows(r.log)).toEqual([]);
    await r.host.switchTo('pill');
    await settle(RELEASE_AFTER_MS - 1);
    expect(lows(r.log)).toEqual([]);
    await settle(1);
    expect(lows(r.log)).toEqual(['low:true']);
    await settle(RELEASE_FOR_MS - 1);
    expect(lows(r.log)).toEqual(['low:true']);
    await settle(1);
    expect(lows(r.log)).toEqual(['low:true', 'low:false']);
    await settle(10 * MIN);
    expect(lows(r.log)).toEqual(['low:true', 'low:false']);
  });

  it('leaving a view that is not heavy asks for nothing', async () => {
    const r = await started(rig({ lowMemory: true }));
    await r.host.switchTo('room');
    await r.host.switchTo('pill');
    await settle(MIN);
    expect(lows(r.log)).toEqual([]);
  });

  it('a switch in the middle of it puts the browser back to normal first: a view is never built on a browser held low', async () => {
    const r = await started(rig({ lowMemory: true, room: { heavy: true } }));
    await r.host.switchTo('room');
    await r.host.switchTo('pill');
    await settle(RELEASE_AFTER_MS + 100);
    expect(lows(r.log)).toEqual(['low:true']);
    r.log.length = 0;
    await r.host.switchTo('room');
    expect(r.log.indexOf('low:false')).toBeGreaterThanOrEqual(0);
    expect(r.log.indexOf('low:false')).toBeLessThan(r.log.indexOf('pill.unmount'));
    await settle(MIN);
    // Back in the heavy view: nothing more is asked, and the old timer is gone.
    expect(lows(r.log)).toEqual(['low:false']);
  });

  it('switching back before it began means it never begins', async () => {
    const r = await started(rig({ lowMemory: true, room: { heavy: true } }));
    await r.host.switchTo('room');
    await r.host.switchTo('pill');
    await settle(RELEASE_AFTER_MS - 500);
    await r.host.switchTo('room');
    await settle(MIN);
    expect(lows(r.log)).toEqual([]);
  });

  it('tucked away in the middle of it: low until Doozer is back, with no flapping', async () => {
    const r = await started(rig({ lowMemory: true, room: { heavy: true } }));
    await r.host.switchTo('room');
    await r.host.switchTo('pill');
    await settle(RELEASE_AFTER_MS + 100);
    r.shell.emit('fullscreen-changed', true);
    await settle(MIN);
    expect(lows(r.log)).toEqual(['low:true']);
    r.shell.emit('fullscreen-changed', false);
    expect(lows(r.log)).toEqual(['low:true', 'low:false']);
  });

  it('stopping puts the browser back to normal and leaves no timer', async () => {
    const r = await started(rig({ lowMemory: true, room: { heavy: true } }));
    await r.host.switchTo('room');
    await r.host.switchTo('pill');
    await settle(RELEASE_AFTER_MS + 100);
    r.host.stop();
    expect(lows(r.log)).toEqual(['low:true', 'low:false']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a browser that cannot be asked, or that refuses, changes nothing else', async () => {
    const plain = await started(rig({ room: { heavy: true } }));
    await plain.host.switchTo('room');
    await plain.host.switchTo('pill');
    await settle(MIN);
    plain.shell.emit('fullscreen-changed', true);
    expect(plain.host.current()).toBe('pill');
    expect(plain.errors).toEqual([]);

    const refusing = await started(rig({ room: { heavy: true }, setup: (s) => { s.shell.setLowMemory = async () => { throw new Error('no such switch'); }; } }));
    await refusing.host.switchTo('room');
    expect(await refusing.host.switchTo('pill')).toBe(true);
    await settle(MIN);
    expect(refusing.host.current()).toBe('pill');
    expect(refusing.errors).toContain('setLowMemory');
  });
});

describe('settings that change the window', () => {
  it('always on top follows the setting', async () => {
    const r = await started(rig());
    r.brain.setSetting('alwaysOnTop', false);
    r.brain.setSetting('alwaysOnTop', true);
    expect(r.log.filter((line) => line.startsWith('onTop'))).toEqual(['onTop:false', 'onTop:true']);
  });

  it('start with Windows registers and unregisters', async () => {
    const r = await started(rig());
    r.brain.setSetting('startWithWindows', true);
    await settle();
    expect(r.shell.state.autostart).toBe(true);
    r.brain.setSetting('startWithWindows', false);
    await settle();
    expect(r.shell.state.autostart).toBe(false);
  });

  it('start with Windows switches itself back off when it cannot be registered', async () => {
    const r = await started(rig());
    r.shell.state.failAutostart = true;
    r.brain.setSetting('startWithWindows', true);
    await settle();
    expect(r.brain.settings.startWithWindows).toBe(false);
    expect(r.errors.join()).toContain('start with Windows');
  });
});

describe('the clock', () => {
  it('ticks the brain four times a second', async () => {
    const r = await started(rig());
    const ticks = vi.spyOn(r.brain, 'tick');
    await settle(2000);
    expect(ticks).toHaveBeenCalledTimes(8);
  });

  it('keeps ticking after a listener throws', async () => {
    const r = await started(rig());
    r.brain.on('change', () => { throw new Error('a view bug'); });
    r.clock.advance(2 * HOUR);
    await settle(250);
    const ticks = vi.spyOn(r.brain, 'tick');
    await settle(1000);
    expect(ticks).toHaveBeenCalledTimes(4);
  });
});

describe('the clock with nobody there', () => {
  /** Somebody who can leave and come back. */
  function somebody(there = true) {
    const listeners = new Set<() => void>();
    const presence: Presence = {
      there: () => there,
      onArrive: (listener) => { listeners.add(listener); return () => void listeners.delete(listener); },
    };
    return {
      presence,
      leave(): void { there = false; },
      arrive(): void {
        const was = there;
        there = true;
        if (!was) for (const listener of [...listeners]) listener();
      },
      listening: () => listeners.size,
    };
  }

  it('four times a second while somebody is there, once a second when they have gone', async () => {
    const who = somebody();
    const r = await started(rig({ presence: who.presence }));
    const ticks = vi.spyOn(r.brain, 'tick');
    await settle(2000);
    expect(ticks).toHaveBeenCalledTimes(8);
    who.leave();
    // (The tick already waited for still comes on the quick beat.)
    await settle(250);
    ticks.mockClear();
    await settle(10_000);
    expect(ticks).toHaveBeenCalledTimes(10);
  });

  it('at once when somebody arrives, and four times a second from then on', async () => {
    const who = somebody(false);
    const r = await started(rig({ presence: who.presence }));
    await settle(1000);
    const ticks = vi.spyOn(r.brain, 'tick');
    await settle(300);
    expect(ticks).not.toHaveBeenCalled();
    who.arrive();
    expect(ticks).toHaveBeenCalledTimes(1);
    await settle(1000);
    expect(ticks).toHaveBeenCalledTimes(5);
  });

  it('what the slow clock had not shown yet is shown the moment somebody arrives', async () => {
    const who = somebody(false);
    const r = await started(rig({ presence: who.presence }));
    await settle(1000);
    r.brain.debug?.setNeeds({ tummy: 50 });
    const seen: number[] = [];
    r.brain.on('change', () => void seen.push(r.brain.state.needs.tummy));
    // Hours pass on the pet's clock between two ticks.
    r.clock.advance(HOUR);
    expect(seen).toEqual([]);
    who.arrive();
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeLessThan(50);
  });

  it('a running session: each tick lands just after a whole second of the countdown, so a countdown in seconds shows every one', async () => {
    const who = somebody();
    const r = await started(rig({ presence: who.presence, timeRuns: true }));
    await settle(137);
    expect(r.brain.startFocus().ok).toBe(true);
    await settle(389);
    who.leave();
    await settle(250);
    const shown: number[] = [];
    const lands: number[] = [];
    const tick = r.brain.tick.bind(r.brain);
    vi.spyOn(r.brain, 'tick').mockImplementation(() => {
      tick();
      // How far past a whole second of the countdown this tick came, and the second it shows.
      lands.push(1000 - (r.brain.focusEndsInMs() % 1000));
      shown.push(r.brain.state.focus.remainingMs / 1000);
    });
    await settle(60_000);
    // One tick a second, each a few milliseconds past the second it shows.
    expect(shown.length).toBeGreaterThanOrEqual(59);
    expect(shown.length).toBeLessThanOrEqual(61);
    expect(Math.max(...lands.slice(1))).toBeLessThanOrEqual(TICK_AFTER_MS + 1);
    expect(Math.min(...lands.slice(1))).toBeGreaterThan(0);
    // Every second of the countdown was shown once: none skipped, none twice.
    const steps = shown.slice(2).map((value, i) => (shown[i + 1] ?? value) - value);
    expect(new Set(steps)).toEqual(new Set([1]));
  });

  it('a session ends on time with nobody there: within a few milliseconds of its end, not up to a second after', async () => {
    const who = somebody(false);
    const r = await started(rig({ presence: who.presence, timeRuns: true }));
    await settle(613);
    const startedAt = Date.now();
    expect(r.brain.startFocus().ok).toBe(true);
    const length = r.brain.state.focus.remainingMs;
    let endedAt = 0;
    r.brain.on('focus', (event) => { if (event.type === 'complete') endedAt = Date.now(); });
    await settle(length - 2000);
    expect(endedAt).toBe(0);
    await settle(3000);
    expect(endedAt).toBeGreaterThanOrEqual(startedAt + length);
    expect(endedAt - (startedAt + length)).toBeLessThanOrEqual(TICK_AFTER_MS + 2);
    expect(r.brain.state.focus.status).toBe('idle');
  });

  it('with somebody there a session ends as it always did, on the next quick tick', async () => {
    const who = somebody(true);
    const r = await started(rig({ presence: who.presence, timeRuns: true }));
    const startedAt = Date.now();
    expect(r.brain.startFocus().ok).toBe(true);
    const length = r.brain.state.focus.remainingMs;
    let endedAt = 0;
    r.brain.on('focus', (event) => { if (event.type === 'complete') endedAt = Date.now(); });
    await settle(length + 500);
    expect(endedAt - (startedAt + length)).toBeGreaterThanOrEqual(0);
    expect(endedAt - (startedAt + length)).toBeLessThanOrEqual(250);
  });

  it('tucked away is once a second whoever is there, and an arrival does not wake the page then', async () => {
    const who = somebody(false);
    const r = await started(rig({ presence: who.presence }));
    r.shell.emit('fullscreen-changed', true);
    await settle(1000);
    const ticks = vi.spyOn(r.brain, 'tick');
    who.arrive();
    expect(ticks).not.toHaveBeenCalled();
    await settle(3000);
    expect(ticks).toHaveBeenCalledTimes(3);
  });

  it('stops listening for arrivals when it is stopped', async () => {
    const who = somebody(false);
    const r = await started(rig({ presence: who.presence }));
    expect(who.listening()).toBe(1);
    r.host.stop();
    expect(who.listening()).toBe(0);
    const ticks = vi.spyOn(r.brain, 'tick');
    who.arrive();
    await settle(3000);
    expect(ticks).not.toHaveBeenCalled();
  });
});

describe('saving', () => {
  it('writes soon after an action, with the brain and the host data in one document', async () => {
    const r = await started(rig());
    r.brain.feed();
    await settle(999);
    expect(r.shell.saves).toEqual([]);
    await settle(1);
    expect(r.shell.saves).toHaveLength(1);
    const saved = parseSave(r.shell.saves[0] ?? null);
    expect(createBrain({ save: saved.brain, now: r.clock.now }).state.needs.tummy).toBe(r.brain.state.needs.tummy);
  });

  it('writes after a setting on its own (which fires no change event)', async () => {
    const r = await started(rig());
    r.brain.setSetting('palette', 'sky');
    await settle(1000);
    expect(createBrain({ save: parseSave(r.shell.saves.at(-1) ?? null).brain }).settings.palette).toBe('sky');
  });

  it('does not write every second of a focus session, only now and then', async () => {
    const r = await started(rig());
    r.brain.startFocus();
    await settle(1000);
    const after = r.shell.saves.length;
    for (let second = 0; second < 120; second++) {
      r.clock.advance(1000);
      await settle(1000);
    }
    expect(r.shell.saves.length).toBe(after);
    for (let second = 0; second < 200; second++) {
      r.clock.advance(1000);
      await settle(1000);
    }
    expect(r.shell.saves.length).toBe(after + 1);
  });

  it('saves and then quits when the tray says quit, exactly once', async () => {
    const r = await started(rig());
    r.brain.feed();
    r.shell.emit('quit-requested', null);
    r.shell.emit('quit-requested', null);
    await settle();
    expect(r.shell.saves).toHaveLength(1);
    expect(r.shell.state.quits).toBe(1);
    expect(r.log.indexOf('quit')).toBe(r.log.length - 1);
  });

  it('the Quit button in settings takes the same road', async () => {
    const r = await started(rig());
    r.host.services.quit();
    await settle();
    expect(r.shell.saves).toHaveLength(1);
    expect(r.shell.state.quits).toBe(1);
  });

  it('saves when it tucks away', async () => {
    const r = await started(rig());
    r.brain.feed();
    r.shell.emit('fullscreen-changed', true);
    await settle();
    expect(r.shell.saves).toHaveLength(1);
  });

  it('never writes when the save could not be read at start-up', async () => {
    const r = await started(rig({ persist: false }));
    r.brain.feed();
    await r.host.quit();
    await settle(5000);
    expect(r.shell.saves).toEqual([]);
    expect(r.shell.state.quits).toBe(1);
  });
});

describe('what the host does for a view', () => {
  it('a new pet needs welcoming until the view says it has been', async () => {
    const r = await started(rig());
    expect(r.host.services.needsWelcome()).toBe(true);
    r.host.services.welcomed();
    expect(r.host.services.needsWelcome()).toBe(false);
    await settle(1000);
    expect(parseSave(r.shell.saves.at(-1) ?? null).host.welcomedPet).toBe(r.brain.state.bornAt);
  });

  it('a pet that has been welcomed is not welcomed again, but a new one is', async () => {
    const first = await started(rig());
    first.host.services.welcomed();
    const again = await started(rig({ save: first.brain.serialize(), hostData: { ...first.hostData } }));
    expect(again.host.services.needsWelcome()).toBe(false);
    again.clock.advance(HOUR);
    again.brain.debug?.reset();
    expect(again.host.services.needsWelcome()).toBe(true);
  });

  it('chimes when a session completes, and at no other time', async () => {
    const r = await started(rig());
    r.brain.startFocus();
    r.brain.pauseFocus();
    r.brain.resumeFocus();
    r.brain.stopFocus();
    expect(r.chimes.count).toBe(0);
    r.brain.startFocus();
    r.brain.debug?.finishFocusNow();
    expect(r.chimes.count).toBe(1);
  });

  it('passes on the menu, the settings request and the current view', async () => {
    const r = await started(rig());
    r.host.services.showMenu();
    r.shell.emit('settings-requested', null);
    expect(r.log.slice(-2)).toEqual(['menu', 'pill.openSettings']);
    expect(r.host.services.currentView()).toBe('pill');
    expect(r.host.services.availableViews).toEqual(['pill', 'room']);
  });

  it('passes a request for the Card on to the view, saying whether the keyboard came with it', async () => {
    const r = await started(rig());
    r.shell.emit('card-requested', { keyboard: true });
    r.shell.emit('card-requested', { keyboard: false });
    expect(r.log.slice(-2)).toEqual(['pill.openCard:true', 'pill.openCard:false']);
    // Tucked away there is no Card to open (the shell takes the keyboard back by itself).
    r.shell.emit('fullscreen-changed', true);
    r.log.length = 0;
    r.shell.emit('card-requested', { keyboard: true });
    expect(r.log).toEqual([]);
  });

  it('gives a view the window it asked for', async () => {
    const r = await started(rig());
    expect(r.pill.seen.contexts[0]?.info).toMatchObject({ kind: 'docked', cssWidth: 400, cssHeight: 744 });
  });
});

describe('stopping', () => {
  it('unmounts, stops the clock and lets go of every listener', async () => {
    const r = await started(rig());
    r.host.stop();
    expect(r.pill.seen.mounted).toBe(false);
    expect(r.shell.state.regions).toEqual([]);
    expect(r.shell.listeners('view-requested')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const ticks = vi.spyOn(r.brain, 'tick');
    await settle(5000);
    expect(ticks).not.toHaveBeenCalled();
  });

  it('the pop-in is not waited for, and its limit does not outlive it', async () => {
    const r = await started(rig());
    await settle(ENTER_LIMIT_MS);
    r.host.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
