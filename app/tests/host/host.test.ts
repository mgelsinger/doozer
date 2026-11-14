import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrain, type Brain, type Settings, type ViewId } from '../../src/core';
import { ENTER_LIMIT_MS, HIDE_FRAMES, LEAVE_LIMIT_MS, createHost, type Host } from '../../src/host/host';
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
}

function fakeView(id: ViewId, log: Log, options: FakeViewOptions = {}) {
  const seen = { requests: [] as WindowRequest[], contexts: [] as ViewContext[], awake: [] as boolean[], away: 0, mounted: false };
  const view: View = {
    id,
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
  errors: string[];
  clock: ReturnType<typeof fakeClock>;
}

function rig(options: {
  save?: unknown; hostData?: HostData; pill?: FakeViewOptions; room?: FakeViewOptions;
  frameHangs?: boolean; persist?: boolean; setup?(shell: ReturnType<typeof fakeShell>): void;
} = {}): Rig {
  const log: Log = [];
  const shell = fakeShell(log);
  options.setup?.(shell);
  const clock = fakeClock(START);
  const brain = createBrain({ save: options.save, now: clock.now, random: seeded(7), debug: true });
  const pill = fakeView('pill', log, options.pill);
  const room = fakeView('room', log, options.room);
  const hostData = options.hostData ?? freshHostData();
  const chimes = { count: 0 };
  const errors: string[] = [];
  const host = createHost({
    root: fakeRoot(log),
    shell: shell.shell,
    brain,
    views: [pill.view, room.view],
    hostData,
    sound: { chime: () => void chimes.count++ },
    frame: () => {
      log.push('frame');
      return options.frameHangs ? new Promise(() => undefined) : Promise.resolve();
    },
    persist: options.persist,
    log: (message) => void errors.push(message),
  });
  return { log, host, brain, shell, pill, room, hostData, chimes, errors, clock };
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
