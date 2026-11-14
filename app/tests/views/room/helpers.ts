// Shared by the Room view's tests: the view against the REAL brain in a test DOM, with
// a host and a shell that only record. Time is Vitest's fake clock throughout: the
// brain, the view's timers and the wall clock all read it, so "an hour passes" is one
// call and takes a second or two to run.

import { vi } from 'vitest';
import { createBrain, type Brain, type ViewId } from '../../../src/core';
import type { HostServices, ViewContext } from '../../../src/host/view';
import type { Shell, ShellEvents, WindowInfo } from '../../../src/shell';
import { createRoomView, type RoomSnapshot, type RoomView } from '../../../src/views/room';
import { roomGeometry } from '../../../src/views/room/layout';
import { START, seeded } from '../../core/helpers';

export function fakeHost(options: { needsWelcome?: boolean } = {}) {
  const calls: string[] = [];
  const state = { welcome: options.needsWelcome ?? false, focusable: false };
  const services: HostServices = {
    availableViews: ['pill', 'room'],
    currentView: () => 'room',
    switchView: (view: ViewId) => void calls.push(`switch:${view}`),
    regionsChanged: () => void calls.push('regions'),
    windowChanged: () => void calls.push('window'),
    setFocusable: (on) => { state.focusable = on; calls.push(`focusable:${on}`); },
    showMenu: () => void calls.push('menu'),
    quit: () => void calls.push('quit'),
    chime: () => void calls.push('chime'),
    needsWelcome: () => state.welcome,
    welcomed: () => { state.welcome = false; calls.push('welcomed'); },
  };
  return { services, calls, state };
}

export function fakeShell(options: { drag?: 'moves' | 'refuses' | 'throws' | 'silent' } = {}) {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const drags: { clientX: number; clientY: number }[] = [];
  const shell = {
    native: false,
    on(event: string, handler: (payload: unknown) => void) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
      return () => void set.delete(handler);
    },
    beginDrag(at: { clientX: number; clientY: number }): Promise<boolean> {
      drags.push({ clientX: at.clientX, clientY: at.clientY });
      if (options.drag === 'throws') return Promise.reject(new Error('no drag today'));
      if (options.drag === 'silent') return new Promise(() => undefined);
      return Promise.resolve(options.drag !== 'refuses');
    },
  } as unknown as Shell;
  return {
    shell, drags,
    emit<K extends keyof ShellEvents>(event: K, payload: ShellEvents[K]): void {
      handlers.get(event)?.forEach((handler) => handler(payload));
    },
    listeners: (event: string) => handlers.get(event)?.size ?? 0,
  };
}

/** The window as the shell would report it for the Room at Medium, well inside a 4K screen at 150 %. */
export function windowInfo(overrides: Partial<WindowInfo> = {}): WindowInfo {
  const { window } = roomGeometry('medium');
  return {
    kind: 'floating', view: 'room', x: 1000, y: 300, width: window.width * 1.5, height: window.height * 1.5, scale: 1.5,
    cssWidth: window.width, cssHeight: window.height,
    monitor: { full: { x: 0, y: 0, w: 3840, h: 2160 }, work: { x: 0, y: 0, w: 3840, h: 2088 }, scale: 1.5 }, nativeMs: 0,
    ...overrides,
  };
}

export interface Rig {
  view: RoomView;
  brain: Brain;
  host: ReturnType<typeof fakeHost>;
  shell: ReturnType<typeof fakeShell>;
  root: HTMLElement;
  snap: () => RoomSnapshot;
  parts: () => NonNullable<ReturnType<RoomView['parts']>>;
}

export interface MountOptions {
  needsWelcome?: boolean;
  /** Seed for the view's dice (what Doozer chooses to do on its own). */
  seed?: number;
  drag?: 'moves' | 'refuses' | 'throws' | 'silent';
  info?: WindowInfo;
  setup?(brain: Brain): void;
}

/** A settled, happy pet in the Room, at nine in the morning, unless a test says otherwise. */
export function mount(options: MountOptions = {}): Rig {
  const brain = createBrain({ now: () => Date.now(), random: seeded(11), debug: true });
  brain.debug?.setNeeds({ tummy: 80, fun: 80, energy: 80, clean: 80 });
  brain.setSetting('soundAsked', true);
  options.setup?.(brain);
  const host = fakeHost(options);
  const shell = fakeShell({ drag: options.drag });
  const root = document.createElement('div');
  document.body.append(root);
  const view = createRoomView({ now: () => Date.now(), random: seeded(options.seed ?? 5) });
  const context: ViewContext = { brain, shell: shell.shell, host: host.services, info: options.info ?? windowInfo() };
  void view.mount(root, context);
  return {
    view, brain, host, shell, root,
    snap: () => view.snapshot() as RoomSnapshot,
    parts: () => view.parts() as NonNullable<ReturnType<RoomView['parts']>>,
  };
}

/** Let `ms` pass the way the running app does: timers run, and the brain is ticked four times a second. */
export async function pass(r: { brain: Brain }, ms: number, stepMs = 250): Promise<void> {
  for (let left = ms; left > 0; left -= stepMs) {
    await vi.advanceTimersByTimeAsync(Math.min(stepMs, left));
    r.brain.tick();
  }
}

const RESTING_POSE: Record<string, readonly string[]> = {
  free: ['idle', 'sulk', 'drowsy'],
  bed: ['sleep'],
  reading: ['read'],
};

/** Doozer is where it belongs, doing nothing, with nothing left lying about. Returns what is wrong, or ''. */
export function unrest(s: RoomSnapshot): string {
  if (s.scene !== null) return `scene ${s.scene}`;
  if (s.station !== s.desired) return `in ${s.station}, belongs in ${s.desired}`;
  if (!(RESTING_POSE[s.station] ?? []).includes(s.pose)) return `pose ${s.pose} in ${s.station}`;
  if (s.place !== (s.station === 'bed' ? 'bed' : 'floor')) return `place ${s.place} in ${s.station}`;
  if (s.bookHeld !== (s.station === 'reading')) return `book ${s.bookHeld ? 'held' : 'down'} in ${s.station}`;
  if (s.props !== 0) return `${s.props} props left`;
  if (s.gone) return 'gone';
  if (s.dragging || s.pressed) return 'still pressed';
  if (s.lamp !== (s.station !== 'bed')) return `lamp ${s.lamp ? 'on' : 'off'} in ${s.station}`;
  return '';
}

/** Wait (at most `limitMs`) until Doozer has come to rest. Returns '' or what was still wrong at the end. */
export async function settle(r: Rig, limitMs = 30_000): Promise<string> {
  for (let waited = 0; waited < limitMs; waited += 100) {
    const s = r.snap();
    if (unrest(s) === '' && !s.busy && s.emotes === 0) return '';
    await pass(r, 100, 100);
  }
  const s = r.snap();
  return unrest(s) || (s.busy ? 'still pulling a face' : s.emotes ? 'emotes left' : '');
}

let stamp = 10_000;
/** A click with a real-looking time stamp, `gap` ms after the previous one. */
export function click(target: Element, gap = 1000): void {
  stamp += gap;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: stamp });
  target.dispatchEvent(event);
}

export function pointer(
  target: Element, type: string,
  init: { buttons?: number; button?: number; movementX?: number; movementY?: number; clientX?: number; clientY?: number } = {},
): void {
  const event = new MouseEvent(type, { bubbles: true, button: init.button ?? 0, buttons: init.buttons ?? 0, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 });
  Object.defineProperty(event, 'movementX', { value: init.movementX ?? 0 });
  Object.defineProperty(event, 'movementY', { value: init.movementY ?? 0 });
  target.dispatchEvent(event);
}

export function useRoomClock(start = START): void {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  // The test DOM's Web Animations stub rejects a promise nobody holds whenever an animation
  // is cancelled. Nothing here depends on an animation (all timing is timers), so run
  // without one, as the view does in any page that cannot animate.
  (Element.prototype as { animate?: unknown }).animate = undefined;
}

export function restoreClock(): void {
  document.body.replaceChildren();
  vi.useRealTimers();
}

/** Complete this many focus sessions, to unlock things. */
export function finishSessions(brain: Brain, count: number): void {
  for (let i = 0; i < count; i++) {
    brain.startFocus();
    brain.debug?.finishFocusNow();
  }
}
