// The view host: one pet, one window, exactly one view mounted at a time
// (WORK_PLAN.md section 3; DESIGN_SPEC.md sections 5 and 10).
//
// What it owns:
//   - which view is on screen, and the three-step switch between views
//     (docs/shell-spike.md 4.2: hide and wait three frames, change the window, mount
//     and show and report hit regions), with Doozer's pop-out before and pop-in after;
//   - the clock: `brain.tick()` four times a second while somebody is there, once a second
//     while nobody is (landing on the whole seconds of a running countdown, and on its
//     end), and once a second while tucked away;
//   - the save: the brain's document plus the window positions, written shortly after
//     anything happens and when quitting;
//   - what the settings do to the window: always on top, start with Windows, tuck away
//     while a fullscreen app is in front, and re-placing the window when a view's dock
//     or size changes;
//   - sound: which of the small set (sound.ts) is played for what, and when none is.
//
// What it never does: draw anything, or decide a rule about the pet.
//
// Never stuck: every wait in here has a time limit. A view whose pop-out never settles,
// an animation frame that never comes (a hidden window draws none), a window change that
// fails, a view that throws while mounting: each ends with a view on screen and its hit
// regions reported, or with nothing shown and the whole window click-through.

import type { Brain, BrainEvents, Settings, ViewId } from '../core/contract';
import { realTimers, type Timers } from '../character/timers';
import type { Region, Shell, WindowInfo } from '../shell';
import type { SoundName } from './sound';
import { buildSave, createSaver, type HostData, type Saver } from './store';
import type { HostServices, View, ViewContext, WindowRequest } from './view';

/** Frames to wait after hiding the old view before the window changes (docs/shell-spike.md 2.3). */
export const HIDE_FRAMES = 3;
/** Longest the host waits for Doozer to pop out. The rig's pop-out is 240 ms. */
export const LEAVE_LIMIT_MS = 400;
/** After this the host stops listening for the pop-in. It never waits for it. */
export const ENTER_LIMIT_MS = 1200;
/** An animation frame that has not come after this long is not coming (hidden window). */
const FRAME_LIMIT_MS = 60;
/**
 * After a heavy view has been left: how long the new view is given to settle before the
 * browser is asked to hold less memory, and how long it is held to that before it is
 * told to carry on as normal (docs/polish-checks.md, "What the Island leaves behind").
 */
export const RELEASE_AFTER_MS = 3000;
export const RELEASE_FOR_MS = 4000;
/** The "Interface size" setting as how many times larger than usual everything is drawn. */
export const UI_SCALE: Readonly<Record<Settings['uiScale'], number>> = { normal: 1, large: 1.15, larger: 1.3 };

/**
 * Is somebody there? In this window that has a plain meaning: it lets the mouse through
 * everywhere but on Doozer and its things, so a pointer or key event in the page is
 * somebody at it (frames.ts keeps the same account, for the same reason).
 */
export interface Presence {
  /** Somebody is there now, or was a moment ago. */
  there(): boolean;
  /** Call `listener` when somebody arrives after nobody was there. Returns the function that stops it. */
  onArrive(listener: () => void): () => void;
}

/** How long after a whole second of a countdown the tick that shows it lands. */
export const TICK_AFTER_MS = 8;

export interface HostOptions {
  /** The element views are mounted in. */
  root: HTMLElement;
  shell: Shell;
  brain: Brain;
  /** The views that exist. The first one is the fallback and the home on first run. */
  views: readonly View[];
  /** The host's part of the save, as read at start-up. The host keeps it up to date. */
  hostData: HostData;
  /** Plays one of the set if sound is on (sound.ts). `chime` alone is enough for a test. */
  sound?: { chime(): void; play?(name: SoundName): void };
  timers?: Timers;
  /** Resolves on the next animation frame. The host adds its own time limit. */
  frame?: () => Promise<void>;
  /** How often the brain is ticked while on screen, and while tucked away. */
  tickMs?: number;
  restingTickMs?: number;
  /**
   * Whether somebody is there. With nobody there the brain is ticked every `idleTickMs`
   * instead of every `tickMs`: nothing a tick does can be seen any sooner than that (the
   * needs move a point in minutes, a countdown nobody is looking at is shown in minutes),
   * and each tick wakes the page, which is most of what a focus session costs while
   * nothing is drawn (docs/polish-checks.md, "The Pill's focus session"). A running
   * session's ticks land just after each whole second of its countdown, so that a
   * countdown in seconds (its last minute) still shows every second, and the last one
   * lands on its end: the session ends on time to within a few milliseconds.
   * Omit, and somebody is always taken to be there.
   */
  presence?: Presence;
  idleTickMs?: number;
  /** False runs without writing the save (the save could not be read at start-up). */
  persist?: boolean;
  log?(message: string, error?: unknown): void;
}

export interface Host {
  /** Mount the first view and start the clock. Call once. */
  start(): Promise<void>;
  /** Move to another view. Resolves true once it is on screen, false if it is not built or failed. */
  switchTo(view: ViewId): Promise<boolean>;
  /** The id of the mounted view, or null during a switch. */
  current(): ViewId | null;
  /** The mounted view itself. */
  view(): View | null;
  /** False while tucked away behind a fullscreen app. */
  awake(): boolean;
  /** A fullscreen app came to the front (true) or went away. The shell's event calls this. */
  setFullscreen(inFront: boolean): void;
  /** Resolves when no switch or window change is in flight. */
  settled(): Promise<void>;
  /** Write the save now, if anything is unsaved. */
  flush(): Promise<void>;
  /** Save, then leave. */
  quit(): Promise<void>;
  /** Unmount and stop everything. For tests and hot reload. */
  stop(): void;
  readonly services: HostServices;
}

const defaultFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else resolve();
  });

export function createHost(options: HostOptions): Host {
  const { root, shell, brain, hostData } = options;
  const timers = options.timers ?? realTimers;
  const nextFrame = options.frame ?? defaultFrame;
  const tickMs = options.tickMs ?? 250;
  const restingTickMs = options.restingTickMs ?? 1000;
  const idleTickMs = options.idleTickMs ?? 1000;
  const presence = options.presence ?? null;
  const log = options.log ?? ((message: string, error?: unknown) => console.error(`[host] ${message}`, error ?? ''));
  const sound = options.sound ?? { chime: () => undefined };

  if (options.views.length === 0) throw new Error('the host needs at least one view');
  const views = new Map<ViewId, View>(options.views.map((view) => [view.id, view]));
  const fallback = options.views[0] as View;
  const available = options.views.map((view) => view.id);

  let current: View | null = null;
  /** The root is visible and the mounted view may catch the mouse. */
  let shown = false;
  let awake = true;
  let fullscreen = false;
  let focusable = false;
  let started = false;
  let stopped = false;
  let quitting = false;
  let tickTimer: unknown = null;
  let replaceQueued = false;
  const offs: (() => void)[] = [];

  const safely = (what: string, fn: () => void): void => {
    try { fn(); } catch (error) { log(what, error); }
  };

  // ---- waiting, with limits ------------------------------------------------------

  /** Wait for `promise`, but never longer than `ms`. Rejections are logged, not thrown. */
  const within = (promise: Promise<unknown> | undefined, ms: number, what: string): Promise<void> =>
    new Promise((resolve) => {
      if (!promise) return resolve();
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        timers.clear(limit);
        resolve();
      };
      const limit = timers.set(finish, ms);
      promise.then(finish, (error: unknown) => { log(what, error); finish(); });
    });

  const frame = (): Promise<void> => within(nextFrame(), FRAME_LIMIT_MS, 'animation frame');
  const frames = async (count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await frame();
  };

  // ---- saving --------------------------------------------------------------------

  const saver: Saver = createSaver({
    build: () => buildSave(brain.serialize(), hostData),
    write: options.persist === false ? async () => undefined : (json) => shell.save(json),
    timers,
    soonMs: 1000,
    onError: (error) => log('the save could not be written', error),
  });

  // ---- sound ---------------------------------------------------------------------
  // Which sound goes with what Doozer was just made to do. Only for what the user did:
  // a Doozer that helps itself from the bowl at three in the afternoon, falls asleep worn
  // out or wakes up rested does so without a sound ("silent unless asked").
  function soundFor(event: BrainEvents['action']): SoundName | null {
    switch (event.type) {
      case 'feed': return 'munch';
      case 'treat': return 'yum';
      case 'fill-bowl': return 'kibble';
      case 'play': return 'boing';
      case 'wash': return 'bubbles';
      case 'pet': return 'chirp';
      case 'sleep': return event.why === 'tucked-in' ? 'lullaby' : null;
      case 'wake': return event.why === 'woken' ? 'morning' : null;
      default: return null;
    }
  }

  let chimeTimer: unknown = null;

  /**
   * Play one of the set, unless this is no time for it: during a focus session Doozer
   * makes no sound at all (spec 4.5), and tucked away behind a fullscreen app it keeps
   * quiet too. (The session's own two sounds are played where the session is followed.)
   */
  function play(name: SoundName): void {
    if (stopped || !awake || brain.state.quiet) return;
    sound.play?.(name);
  }

  // ---- hit regions ---------------------------------------------------------------

  function reportRegions(): void {
    if (stopped) return;
    let regions: Region[] = [];
    if (current && shown && awake) {
      const view = current;
      safely('hitRegions', () => { regions = view.hitRegions(); });
    }
    shell.setHitRegions(regions);
  }

  function hide(): void {
    shown = false;
    root.style.visibility = 'hidden';
    shell.setHitRegions([]);
  }

  function reveal(): void {
    shown = true;
    root.style.visibility = 'visible';
  }

  function setFocusable(on: boolean): void {
    if (focusable === on) return;
    focusable = on;
    void shell.setFocusable(on).catch((error: unknown) => log('setFocusable', error));
  }

  // ---- showing a view ------------------------------------------------------------

  const request = (view: View): WindowRequest => ({
    settings: brain.settings,
    position: hostData.positions[view.id] ?? null,
  });

  const context = (view: View, info: WindowInfo): ViewContext => ({
    brain,
    shell,
    host: services,
    info,
    // The view's own note in the save (where Doozer stands on each monitor, say).
    memory: {
      read: () => hostData.memory?.[view.id] ?? null,
      write: (value) => {
        (hostData.memory ??= {})[view.id] = value;
        saver.touch('soon');
      },
    },
  });

  // ---- asking the browser to hold less memory --------------------------------------
  // Two moments: while Doozer is tucked away behind a fullscreen app (for as long as that
  // lasts), and for a few seconds after a heavy view has been left. Never stuck low: the
  // level is worked out afresh from these two facts every time one of them changes.
  let releasing = false;
  let releaseTimer: unknown = null;
  let lowMemory = false;

  function syncMemory(): void {
    const low = !stopped && (!awake || releasing);
    if (low === lowMemory) return;
    lowMemory = low;
    void shell.setLowMemory?.(low).catch((error: unknown) => log('setLowMemory', error));
  }

  function cancelRelease(): void {
    if (releaseTimer !== null) timers.clear(releaseTimer);
    releaseTimer = null;
    releasing = false;
  }

  /** A heavy view has just been left: once the new one has settled, give back what it used. */
  function releaseSoon(): void {
    cancelRelease();
    if (stopped) return;
    releaseTimer = timers.set(() => {
      releasing = true;
      syncMemory();
      releaseTimer = timers.set(() => {
        releaseTimer = null;
        releasing = false;
        syncMemory();
      }, RELEASE_FOR_MS);
    }, RELEASE_AFTER_MS);
  }

  /** Take the mounted view off the screen and release it. */
  async function retire(animate: boolean): Promise<void> {
    const old = current;
    if (!old) return;
    if (animate && awake && shown) await within(old.leave?.(), LEAVE_LIMIT_MS, `${old.id}.leave`);
    hide();
    // The blank frame has to be on screen before the window moves.
    await frames(HIDE_FRAMES);
    current = null;
    safely(`${old.id}.unmount`, () => old.unmount());
    root.replaceChildren();
    // Whatever needed the keyboard has gone with the view.
    setFocusable(false);
  }

  /** Steps 2 and 3 of the switch: change the window, mount, show, report regions. */
  async function bring(view: View): Promise<void> {
    const info = await shell.setWindowMode(view.window(request(view)), view.id);
    try {
      await view.mount(root, context(view, info));
    } catch (error) {
      safely(`${view.id}.unmount`, () => view.unmount());
      root.replaceChildren();
      throw error;
    }
    current = view;
    if (brain.settings.lastView !== view.id) brain.setSetting('lastView', view.id);
    if (!awake) safely(`${view.id}.setAwake`, () => view.setAwake?.(false));
    reveal();
    await frame();
    reportRegions();
    if (awake) void within(view.enter?.(), ENTER_LIMIT_MS, `${view.id}.enter`);
  }

  async function show(view: View, animate: boolean): Promise<boolean> {
    if (stopped) return false;
    const leavingHeavy = current?.heavy === true && current !== view;
    // Doozer pops out of one home and into the next.
    if (animate && current && current !== view) play('pop');
    // Whatever was being given back, a view is about to be built: at full speed.
    cancelRelease();
    syncMemory();
    await retire(animate);
    if (leavingHeavy) releaseSoon();
    try {
      await bring(view);
      return true;
    } catch (error) {
      log(`the ${view.id} view could not be shown`, error);
    }
    if (view !== fallback) {
      try {
        await bring(fallback);
      } catch (error) {
        // Nothing on screen and no hit regions: invisible and click-through. The tray still works.
        log('the fallback view could not be shown either', error);
      }
    }
    return false;
  }

  // ---- the interface size ------------------------------------------------------------
  let uiScale = 1;

  /** Have the shell draw everything at the size the setting asks for. True if that changed anything. */
  async function syncUiScale(): Promise<boolean> {
    const wanted = UI_SCALE[brain.settings.uiScale] ?? 1;
    if (wanted === uiScale) return false;
    uiScale = wanted;
    try {
      await shell.setUiScale?.(wanted);
    } catch (error) {
      log('setUiScale', error);
    }
    return true;
  }

  /** The mounted view wants a different window: move it without remounting. */
  async function replace(): Promise<void> {
    replaceQueued = false;
    const view = current;
    if (!view || stopped) return;
    if (awake && shown) await within(view.leave?.(), LEAVE_LIMIT_MS, `${view.id}.leave`);
    hide();
    await frames(HIDE_FRAMES);
    // With nothing showing: the size of everything, if the setting has changed. The window
    // is asked for again just below and comes out larger or smaller to match.
    await syncUiScale();
    try {
      const info = await shell.setWindowMode(view.window(request(view)), view.id);
      safely(`${view.id}.windowChanged`, () => view.windowChanged?.(info));
    } catch (error) {
      log('the window could not be re-placed', error);
    }
    if (current !== view) return;
    reveal();
    await frame();
    reportRegions();
    if (awake) void within(view.enter?.(), ENTER_LIMIT_MS, `${view.id}.enter`);
  }

  // One window change at a time. A job that fails does not block the next.
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(job: () => Promise<T>, otherwise: T): Promise<T> {
    const run = queue.then(job).catch((error: unknown) => {
      log('a window change failed', error);
      return otherwise;
    });
    queue = run;
    return run;
  }

  function switchTo(id: ViewId): Promise<boolean> {
    const view = views.get(id);
    if (!view) return Promise.resolve(false);
    return enqueue(async () => {
      if (current === view) return true;
      return show(view, true);
    }, false);
  }

  function requestReplace(): void {
    if (replaceQueued || !started) return;
    replaceQueued = true;
    void enqueue(replace, undefined);
  }

  // ---- the clock -----------------------------------------------------------------

  function tick(): void {
    // A handler that throws must not stop the clock.
    safely('brain.tick', () => brain.tick());
  }

  /** How long until the next tick. */
  function tickWait(): number {
    if (!awake) return restingTickMs;
    if (!presence || presence.there()) return tickMs;
    // (The state's own figure is rounded up to whole seconds; this one is to the millisecond.)
    const left = brain.focusEndsInMs();
    if (!(left > 0)) return idleTickMs;
    // Just after the countdown's next whole second; at the latest, just after its end.
    const toNextSecond = left % 1000 || 1000;
    return Math.min(idleTickMs, toNextSecond) + TICK_AFTER_MS;
  }

  function armTick(): void {
    if (tickTimer !== null) timers.clear(tickTimer);
    tickTimer = null;
    if (stopped) return;
    tickTimer = timers.set(() => {
      tickTimer = null;
      tick();
      armTick();
    }, tickWait());
  }

  /** Somebody has arrived: whatever the slow clock has not shown yet is shown now. */
  function arrived(): void {
    if (!started || stopped || !awake) return;
    tick();
    armTick();
  }
  const stopListeningForArrivals = presence?.onArrive(arrived) ?? null;

  // ---- tuck away -----------------------------------------------------------------

  function applyTuck(): void {
    const tuck = fullscreen && brain.settings.tuckAwayInFullscreen;
    if (tuck === !awake) return;
    awake = !tuck;
    const view = current;
    if (!awake) {
      // The page is not told that its window is hidden (docs/shell-spike.md 4.8), so
      // the view has to stop its own clock.
      if (view) safely(`${view.id}.setAwake`, () => view.setAwake?.(false));
      shell.setHitRegions([]);
      void shell.setVisible(false).catch((error: unknown) => log('setVisible', error));
      void saver.flush();
      // Hidden behind somebody's game: hold as little memory as possible until it is over.
      syncMemory();
    } else {
      syncMemory();
      void shell.setVisible(true).catch((error: unknown) => log('setVisible', error));
      if (view) safely(`${view.id}.setAwake`, () => view.setAwake?.(true));
      tick();
      reportRegions();
    }
    if (started) armTick();
  }

  function setFullscreen(inFront: boolean): void {
    fullscreen = inFront;
    applyTuck();
  }

  // ---- what settings do to the window ----------------------------------------------

  async function syncAutostart(): Promise<void> {
    if (!shell.native) return;
    const want = brain.settings.startWithWindows;
    try {
      if ((await shell.autostartEnabled()) === want) return;
      await shell.setAutostart(want);
    } catch (error) {
      log('start with Windows could not be changed', error);
      // The switch must tell the truth: it did not take.
      if (want && brain.settings.startWithWindows) brain.setSetting('startWithWindows', false);
    }
  }

  function applySetting(key: keyof Settings): void {
    if (key === 'alwaysOnTop') {
      void shell.setAlwaysOnTop(brain.settings.alwaysOnTop).catch((error: unknown) => log('setAlwaysOnTop', error));
    } else if (key === 'startWithWindows') {
      void syncAutostart();
    } else if (key === 'tuckAwayInFullscreen') {
      applyTuck();
    }
    // The interface size changes every view's window: re-place whichever is showing.
    if (key === 'uiScale' || current?.windowSettings?.includes(key)) requestReplace();
  }

  // ---- quitting ------------------------------------------------------------------

  async function quit(): Promise<void> {
    if (quitting) return;
    quitting = true;
    saver.touch('soon');
    await saver.flush();
    await shell.quit().catch((error: unknown) => log('quit', error));
  }

  // ---- what a view may ask -------------------------------------------------------

  const services: HostServices = {
    availableViews: available,
    currentView: () => current?.id ?? fallback.id,
    switchView: (view) => void switchTo(view),
    regionsChanged: reportRegions,
    windowChanged: requestReplace,
    setFocusable,
    showMenu: () => void shell.showMenu().catch((error: unknown) => log('showMenu', error)),
    quit: () => void quit(),
    chime: () => sound.chime(),
    needsWelcome: () => hostData.welcomedPet !== brain.state.bornAt,
    welcomed: () => {
      if (hostData.welcomedPet === brain.state.bornAt) return;
      hostData.welcomedPet = brain.state.bornAt;
      saver.touch('soon');
    },
  };

  // ---- wiring --------------------------------------------------------------------

  function subscribe(): void {
    const brainOn = <E extends keyof BrainEvents>(type: E, handler: (detail: BrainEvents[E]) => void): void => {
      offs.push(brain.on(type, handler));
    };
    // Anything that happened is written soon; time merely passing can wait, because the
    // brain works the elapsed time out again from the save on the next start.
    brainOn('change', () => saver.touch('lazy'));
    brainOn('action', (event) => {
      saver.touch('soon');
      const name = soundFor(event);
      if (name) play(name);
    });
    brainOn('refuse', () => play('hm'));
    brainOn('away', () => saver.touch('soon'));
    brainOn('settings', ({ key }) => {
      saver.touch('soon');
      applySetting(key);
    });
    brainOn('focus', (event) => {
      saver.touch('soon');
      if (event.type === 'start') {
        // The one sound of a session's beginning; from here on it is quiet.
        if (awake && !stopped) sound.play?.('begin');
      } else if (event.type === 'complete') {
        // DESIGN_SPEC.md 4.5: one soft chime when a session ends, if sound is on. It is
        // played even while Doozer is tucked away: it is how you hear that the time is up.
        sound.chime();
        if (event.unlocked.length > 0 && sound.play) {
          const sparkle = sound.play;
          chimeTimer = timers.set(() => { chimeTimer = null; if (!stopped) sparkle('sparkle'); }, 650);
        }
      }
    });

    offs.push(shell.on('view-requested', (view) => void switchTo(view)));
    offs.push(shell.on('settings-requested', () => {
      const view = current;
      if (view) safely(`${view.id}.openSettings`, () => view.openSettings?.());
    }));
    offs.push(shell.on('card-requested', (request) => {
      const view = current;
      // Nothing to open while switching or tucked away. (If the shortcut gave the window the
      // keyboard, the shell takes it back by itself when nobody asks to keep it.)
      if (!view || !awake || !shown) return;
      safely(`${view.id}.openCard`, () => view.openCard?.(request?.keyboard === true));
    }));
    offs.push(shell.on('quit-requested', () => void quit()));
    offs.push(shell.on('drag-end', (info) => {
      if (!current) return;
      hostData.positions[current.id] = { x: info.x, y: info.y };
      saver.touch('soon');
      reportRegions();
    }));
    offs.push(shell.on('display-changed', (info) => {
      const view = current;
      if (view) safely(`${view.id}.windowChanged`, () => view.windowChanged?.(info));
      reportRegions();
    }));
    offs.push(shell.on('watchdog', () => reportRegions()));
    offs.push(shell.on('fullscreen-changed', (inFront) => setFullscreen(inFront)));
  }

  async function start(): Promise<void> {
    if (started || stopped) return;
    hide();
    subscribe();
    void shell.setAvailableViews(available).catch((error: unknown) => log('setAvailableViews', error));
    if (!brain.settings.alwaysOnTop) applySetting('alwaysOnTop');
    void syncAutostart();
    try {
      fullscreen = await shell.fullscreenInFront();
    } catch (error) {
      log('fullscreenInFront', error);
    }
    if (fullscreen && brain.settings.tuckAwayInFullscreen) {
      awake = false;
      await shell.setVisible(false).catch((error: unknown) => log('setVisible', error));
    }
    // Before the first window is asked for, so that it is the right size from the start.
    await syncUiScale();
    const first = views.get(brain.settings.lastView) ?? fallback;
    await enqueue(() => show(first, false), false);
    started = true;
    // The view is mounted and everyone is listening: time away and a session that ended
    // while the app was closed are announced on this first tick.
    tick();
    armTick();
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (tickTimer !== null) timers.clear(tickTimer);
    tickTimer = null;
    stopListeningForArrivals?.();
    if (chimeTimer !== null) timers.clear(chimeTimer);
    chimeTimer = null;
    cancelRelease();
    syncMemory();
    for (const off of offs.splice(0)) safely('unsubscribe', off);
    saver.dispose();
    const view = current;
    current = null;
    shown = false;
    if (view) safely(`${view.id}.unmount`, () => view.unmount());
    root.replaceChildren();
    shell.setHitRegions([]);
  }

  return {
    start,
    switchTo,
    current: () => current?.id ?? null,
    view: () => current,
    awake: () => awake,
    setFullscreen,
    settled: async () => {
      // Jobs may queue more jobs: wait until the queue stops growing.
      let seen: Promise<unknown> | null = null;
      while (seen !== queue) {
        seen = queue;
        await seen;
      }
    },
    flush: () => saver.flush(),
    quit,
    stop,
    services,
  };
}
