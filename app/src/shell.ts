// Bridge to the native side: window mode, hit regions, dragging, save, tray.
//
// Everything a view needs from the operating system goes through this file.
// Inside the Tauri window `shell` talks to the Rust shell (app/src-tauri). In a
// plain browser tab or under Vitest it is a harmless stand-in: window calls do
// nothing and the save goes to localStorage, so views and the UI kit can be
// built and tested without the native side.
//
// The contract a view host has to follow when it changes view:
//
//   1. hide the old view and wait until that blank frame is on screen;
//   2. `await shell.setWindowMode(mode, id)`  (the window changes shape; the
//      promise resolves once the page has been laid out at the new size);
//   3. mount the new view, show it, then call `shell.setHitRegions(...)`.
//
// Between 2 and 3 the window lets every click through. A view that never
// reports regions is invisible to the mouse; that is the safe default.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

export type ViewId = 'pill' | 'room' | 'island' | 'desktop';

export type Anchor = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

/** The three shapes the one window can take. Sizes are CSS pixels. */
export type WindowMode =
  /** A small window glued to an edge of the work area (the Pill). */
  | { kind: 'docked'; width: number; height: number; anchor: Anchor; margin?: number }
  /**
   * A small window the user can put anywhere (Room, Island). `x`/`y` are a
   * position the shell handed out earlier (a `drag-end` event or a previous
   * `WindowInfo`). They are physical screen pixels: store them, do not do
   * arithmetic on them. Leave them out to get the default spot.
   *
   * `bleed` is how far the window may hang over the top and the bottom of the
   * work area, in CSS pixels. A view that keeps an empty, click-through band
   * above and below what it draws (the Room does, for its Card) asks for that
   * much, so that the drawn part can still be put right at the edge of the screen.
   */
  | { kind: 'floating'; width: number; height: number; x?: number; y?: number; bleed?: number }
  /** The whole work area of the current monitor, click-through except hit regions (Desktop). */
  | { kind: 'overlay' };

/**
 * An area of the page that catches the mouse: a rounded rectangle in CSS pixels
 * relative to the viewport. `r` of at least half the shorter side gives a pill
 * or a circle.
 */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
}

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowInfo {
  kind: WindowMode['kind'];
  view: ViewId | null;
  /** Window rectangle in physical screen pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Device pixels per CSS pixel on the window's monitor. */
  scale: number;
  /** The viewport size the page gets, in CSS pixels. */
  cssWidth: number;
  cssHeight: number;
  monitor: { full: ScreenRect; work: ScreenRect; scale: number };
  /** Time the native side spent changing the window, in milliseconds. */
  nativeMs: number;
}

export interface LoadResult {
  /** The saved document, or null when there is nothing usable. */
  data: string | null;
  /** `backup` means the main file was missing or damaged and the previous good save was used. */
  source: 'main' | 'backup' | 'none';
  problem: string | null;
}

export interface ShellEvents {
  /** The tray or right-click menu asked for a view. The host decides whether and how to switch. */
  'view-requested': ViewId;
  'settings-requested': null;
  /**
   * Quit was chosen in the tray or right-click menu. Write the save, then call
   * `shell.quit()`. The native side quits by itself about a second later whether
   * or not the page answers, so a hung page cannot keep the app alive.
   */
  'quit-requested': null;
  /** The user finished dragging the window. Remember `x` and `y` for next time. */
  'drag-end': WindowInfo;
  /** The taskbar, resolution or scaling changed and the shell re-placed the window. */
  'display-changed': WindowInfo;
  /** The shell dropped the hit regions because the page stopped checking in. */
  watchdog: string;
  /** A fullscreen app (game, video, presentation) came to the front (true) or went away (false). */
  'fullscreen-changed': boolean;
  /**
   * A press that started on one of the hit regions has ended: every mouse button
   * is up. Sent by the native side, which reads the buttons from Windows, so it
   * arrives even when the page never gets its `pointerup` (capture lost, focus
   * taken). **End any drag here.** The payload is where the pointer was, in CSS
   * pixels relative to the viewport (it may be outside the window), or null if
   * the pointer could not be read.
   */
  'pointer-released': { x: number; y: number } | null;
}

export interface Shell {
  /** True inside the Tauri window, false in a plain browser tab or under Vitest. */
  readonly native: boolean;
  /** Change the window's shape. See the three-step contract at the top of this file. */
  setWindowMode(mode: WindowMode, view?: ViewId): Promise<WindowInfo>;
  windowInfo(): Promise<WindowInfo | null>;
  /**
   * Replace the areas that catch the mouse. Cheap to call often: calls made in
   * the same turn are merged and only the latest set is sent.
   */
  setHitRegions(regions: readonly Region[]): void;
  /** Resolves once every `setHitRegions` call made so far has reached the native side. */
  regionsFlushed(): Promise<void>;
  /**
   * Start moving the window with the mouse. Call it from a pointer handler while
   * the button is still down. Only a floating window moves.
   */
  beginDrag(at: { clientX: number; clientY: number }): Promise<boolean>;
  /** Whether a click may give the window keyboard focus. Off by default: petting Doozer never steals focus. */
  setFocusable(focusable: boolean): Promise<void>;
  /** Show or hide the window. Showing never takes keyboard focus. */
  setVisible(visible: boolean): Promise<void>;
  setAlwaysOnTop(onTop: boolean): Promise<void>;
  /** Is a fullscreen app in front right now? Changes arrive as `fullscreen-changed`. */
  fullscreenInFront(): Promise<boolean>;
  load(): Promise<LoadResult>;
  /** Write the save. `json` must be valid JSON; the write is atomic and keeps the previous good copy. */
  save(json: string): Promise<void>;
  /** Pop up the native menu (the four views, Settings, Quit) at the cursor. */
  showMenu(): Promise<void>;
  /** Say which views exist. The others stay in the native menu, greyed out, as "coming soon". */
  setAvailableViews(views: readonly ViewId[]): Promise<void>;
  /** Is this copy of the app registered to start when the user signs in? */
  autostartEnabled(): Promise<boolean>;
  /**
   * Register or unregister "start with Windows". Resolves with what is now true.
   * Rejects in a development build, which is never registered.
   */
  setAutostart(enabled: boolean): Promise<boolean>;
  /** Leave now. Call it after saving, in answer to `quit-requested` or the user's own Quit button. */
  quit(): Promise<void>;
  on<K extends keyof ShellEvents>(event: K, handler: (payload: ShellEvents[K]) => void): () => void;
}

/** How often the page tells the native side it is alive. The native watchdog allows 6 s of silence. */
export const HEARTBEAT_MS = 2000;

// ---- Helpers for views ---------------------------------------------------------

interface Measurable {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

/**
 * The hit region for an element: its border box, with its corner radius.
 * `pad` grows the box on every side. Pass `radius` to override what CSS says.
 */
export function regionOf(el: Measurable, options: { pad?: number; radius?: number } = {}): Region {
  const pad = options.pad ?? 0;
  const box = el.getBoundingClientRect();
  const w = box.width + pad * 2;
  const h = box.height + pad * 2;
  let r = options.radius;
  if (r === undefined && typeof getComputedStyle === 'function' && typeof Element !== 'undefined' && el instanceof Element) {
    r = parseRadius(getComputedStyle(el).borderTopLeftRadius, box.width, box.height) + pad;
  }
  return { x: box.left - pad, y: box.top - pad, w, h, r: Math.max(0, Math.min(r ?? 0, w / 2, h / 2)) };
}

/** Parse a computed `border-*-radius` value ("12px", "50%", "12px 20px") into one number of pixels. */
export function parseRadius(value: string, width: number, height: number): number {
  const first = value.trim().split(/\s+/)[0] ?? '';
  const n = Number.parseFloat(first);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return first.endsWith('%') ? (Math.min(width, height) * n) / 100 : n;
}

// ---- Native implementation -----------------------------------------------------

/** The two things the native shell needs from Tauri. Separate so tests can fake them. */
export interface Bridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen(event: string, handler: (payload: unknown) => void): () => void;
}

/** The few things the native shell needs from the page. Separate so tests can fake them. */
export interface PageHost {
  viewport(): { width: number; height: number };
  /** Resolves on the next animation frame. */
  frame(): Promise<void>;
  onResize(handler: () => void): () => void;
  /** Called whenever the page goes from hidden to visible. */
  onVisible(handler: () => void): () => void;
  every(ms: number, handler: () => void): () => void;
  after(ms: number, handler: () => void): () => void;
}

/** How long `setWindowMode` waits for the viewport to reach its new size before giving up. */
const SETTLE_TIMEOUT_MS = 1000;

export function createNativeShell(bridge: Bridge, host: PageHost): Shell & { stopHeartbeat(): void; startHeartbeat(): void } {
  let latest: readonly Region[] = [];
  let queued = false;
  let sending: Promise<void> = Promise.resolve();
  let stopBeat: (() => void) | null = null;

  const send = (): void => {
    queued = false;
    const regions = latest;
    // One call at a time, in order, so an older set can never overtake a newer one.
    sending = sending
      .then(() => bridge.invoke<number>('set_hit_regions', { regions }))
      .then(
        () => undefined,
        (error: unknown) => console.error('[shell] set_hit_regions failed', error),
      );
  };

  const beat = (): void => {
    bridge.invoke<boolean>('heartbeat').then(
      (lost) => {
        // The native watchdog dropped the regions while the page was stalled.
        if (lost && !queued) send();
      },
      () => undefined,
    );
  };

  const settled = (width: number, height: number): Promise<boolean> =>
    new Promise((resolve) => {
      const matches = (): boolean => {
        const v = host.viewport();
        return Math.abs(v.width - width) <= 1 && Math.abs(v.height - height) <= 1;
      };
      if (matches()) return resolve(true);
      let done = false;
      const finish = (ok: boolean): void => {
        if (done) return;
        done = true;
        offResize();
        offTimeout();
        resolve(ok);
      };
      const offResize = host.onResize(() => {
        if (matches()) finish(true);
      });
      const offTimeout = host.after(SETTLE_TIMEOUT_MS, () => finish(matches()));
    });

  const api = {
    native: true,

    async setWindowMode(mode: WindowMode, view?: ViewId): Promise<WindowInfo> {
      // Regions describe the layout that is about to go away. Drop them here and
      // let anything already on its way land first, so nothing stale arrives
      // after the window has changed.
      latest = [];
      queued = false;
      await sending;
      const info = await bridge.invoke<WindowInfo>('set_window_mode', { mode, view: view ?? null });
      const ok = await settled(info.cssWidth, info.cssHeight);
      if (!ok) console.warn('[shell] viewport did not reach', info.cssWidth, info.cssHeight, 'got', host.viewport());
      // One frame so the page has been laid out at the new size before the caller shows anything.
      await host.frame();
      return info;
    },

    windowInfo: () => bridge.invoke<WindowInfo | null>('window_info'),

    setHitRegions(regions: readonly Region[]): void {
      latest = regions.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, r: r.r ?? 0 }));
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        if (queued) send();
      });
    },

    async regionsFlushed(): Promise<void> {
      // Let a queued microtask run, then wait for the chain it extends.
      await Promise.resolve();
      await sending;
    },

    beginDrag: (at: { clientX: number; clientY: number }) => bridge.invoke<boolean>('begin_drag', { x: at.clientX, y: at.clientY }),
    setFocusable: (focusable: boolean) => bridge.invoke<void>('set_focusable', { focusable }),
    async setVisible(visible: boolean): Promise<void> {
      await bridge.invoke<void>('set_window_visible', { visible });
      // Timers are throttled while hidden, so the watchdog may have dropped the
      // regions. Check in straight away instead of waiting for the next beat.
      if (visible) beat();
    },
    setAlwaysOnTop: (onTop: boolean) => bridge.invoke<void>('set_always_on_top', { onTop }),
    fullscreenInFront: () => bridge.invoke<boolean>('fullscreen_in_front'),
    load: () => bridge.invoke<LoadResult>('load_save'),
    save: (json: string) => bridge.invoke<void>('write_save', { json }),
    showMenu: () => bridge.invoke<void>('show_menu'),
    setAvailableViews: (views: readonly ViewId[]) => bridge.invoke<void>('set_available_views', { views: [...views] }),
    autostartEnabled: () => bridge.invoke<boolean>('autostart_enabled'),
    setAutostart: (enabled: boolean) => bridge.invoke<boolean>('set_autostart', { enabled }),
    quit: () => bridge.invoke<void>('quit'),

    on<K extends keyof ShellEvents>(event: K, handler: (payload: ShellEvents[K]) => void): () => void {
      return bridge.listen(`shell://${event}`, (payload) => handler(payload as ShellEvents[K]));
    },

    startHeartbeat(): void {
      if (stopBeat) return;
      beat();
      stopBeat = host.every(HEARTBEAT_MS, beat);
    },

    /** For the watchdog test only: go silent, as a hung page would. */
    stopHeartbeat(): void {
      stopBeat?.();
      stopBeat = null;
    },
  };

  api.startHeartbeat();
  host.onVisible(() => {
    if (stopBeat) beat();
  });
  return api;
}

// ---- Browser stand-in ----------------------------------------------------------

/** Minimal key-value store; `localStorage` in a browser, a Map in tests. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SAVE_KEY = 'doozer.save';
const BACKUP_KEY = 'doozer.save.bak';

function parses(text: string | null): text is string {
  if (text === null || text.trim() === '') return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function createBrowserShell(store: KeyValueStore, viewport: () => { width: number; height: number }): Shell {
  const info = (mode: WindowMode, view: ViewId | null): WindowInfo => {
    const v = viewport();
    const rect = { x: 0, y: 0, w: v.width, h: v.height };
    return {
      kind: mode.kind,
      view,
      x: 0,
      y: 0,
      width: v.width,
      height: v.height,
      scale: 1,
      cssWidth: v.width,
      cssHeight: v.height,
      monitor: { full: rect, work: rect, scale: 1 },
      nativeMs: 0,
    };
  };
  let current: WindowInfo | null = null;
  return {
    native: false,
    async setWindowMode(mode, view) {
      current = info(mode, view ?? null);
      return current;
    },
    windowInfo: async () => current,
    setHitRegions: () => undefined,
    regionsFlushed: async () => undefined,
    beginDrag: async () => false,
    setFocusable: async () => undefined,
    setVisible: async () => undefined,
    setAlwaysOnTop: async () => undefined,
    fullscreenInFront: async () => false,
    async load() {
      const main = store.getItem(SAVE_KEY);
      if (parses(main)) return { data: main, source: 'main', problem: null };
      const backup = store.getItem(BACKUP_KEY);
      if (parses(backup)) return { data: backup, source: 'backup', problem: 'the main save is missing or damaged' };
      return { data: null, source: 'none', problem: main === null && backup === null ? null : 'both saves are damaged' };
    },
    async save(json) {
      if (!parses(json)) throw new Error('refusing to save: not valid JSON');
      const previous = store.getItem(SAVE_KEY);
      if (parses(previous)) store.setItem(BACKUP_KEY, previous);
      store.setItem(SAVE_KEY, json);
    },
    showMenu: async () => undefined,
    setAvailableViews: async () => undefined,
    autostartEnabled: async () => false,
    setAutostart: async () => false,
    quit: async () => undefined,
    on: () => () => undefined,
  };
}

// ---- The instance the app uses -------------------------------------------------

function isNative(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function tauriBridge(): Bridge {
  return {
    invoke: (command, args) => tauriInvoke(command, args),
    listen(event, handler) {
      let off: (() => void) | null = null;
      let cancelled = false;
      void tauriListen(event, (e) => handler(e.payload)).then((unlisten) => {
        if (cancelled) unlisten();
        else off = unlisten;
      });
      return () => {
        cancelled = true;
        off?.();
      };
    },
  };
}

function domHost(): PageHost {
  return {
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    frame: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
    onResize(handler) {
      window.addEventListener('resize', handler);
      return () => window.removeEventListener('resize', handler);
    },
    onVisible(handler) {
      const listener = (): void => {
        if (document.visibilityState === 'visible') handler();
      };
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    every(ms, handler) {
      const id = window.setInterval(handler, ms);
      return () => window.clearInterval(id);
    },
    after(ms, handler) {
      const id = window.setTimeout(handler, ms);
      return () => window.clearTimeout(id);
    },
  };
}

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

function createShell(): Shell {
  if (isNative()) return createNativeShell(tauriBridge(), domHost());
  const inBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  return createBrowserShell(
    inBrowser ? localStorage : memoryStore(),
    inBrowser ? () => ({ width: window.innerWidth, height: window.innerHeight }) : () => ({ width: 0, height: 0 }),
  );
}

export const shell: Shell = createShell();
