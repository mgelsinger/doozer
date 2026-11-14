// Shared by the Desktop view's tests: a host and a shell that only record, the view
// mounted against the real brain in a test DOM, and a pointer to press, drag and release.
// Everything runs on Vitest's fake clock, so "ten minutes later" takes no time.

import { vi } from 'vitest';
import { createBrain, type Brain, type Settings, type ViewId } from '../../../src/core';
import type { HostServices, ViewContext } from '../../../src/host/view';
import type { Region, Shell, ShellEvents, WindowInfo } from '../../../src/shell';
import { createDesktopView, type DesktopParts, type DesktopSnapshot, type DesktopView } from '../../../src/views/desktop';
import { hitRegion } from '../../../src/views/desktop/stage';
import { START, seeded } from '../../core/helpers';

/** The development machine: 4K at 150 %, taskbar along the bottom. The overlay is the work area. */
export const INFO: WindowInfo = {
  kind: 'overlay', view: 'desktop', x: 0, y: 0, width: 3840, height: 2088, scale: 1.5, cssWidth: 2560, cssHeight: 1392,
  monitor: { full: { x: 0, y: 0, w: 3840, h: 2160 }, work: { x: 0, y: 0, w: 3840, h: 2088 }, scale: 1.5 }, nativeMs: 0,
};

/** A window on another monitor or with the taskbar somewhere else. Sizes in physical pixels. */
export function infoFor(full: { x: number; y: number; w: number; h: number }, work: { x: number; y: number; w: number; h: number }, scale = 1): WindowInfo {
  // The shell leaves a one-pixel strip free when the work area is the whole monitor (auto-hidden taskbar).
  const height = work.w === full.w && work.h === full.h ? work.h - 1 : work.h;
  return {
    kind: 'overlay', view: 'desktop', x: work.x, y: work.y, width: work.w, height, scale,
    cssWidth: work.w / scale, cssHeight: height / scale, monitor: { full, work, scale }, nativeMs: 0,
  };
}

export function fakeHost(options: { needsWelcome?: boolean; views?: readonly ViewId[] } = {}) {
  const calls: string[] = [];
  const state = { welcome: options.needsWelcome ?? false, focusable: false, regions: 0 };
  const services: HostServices = {
    availableViews: options.views ?? ['pill', 'desktop'],
    currentView: () => 'desktop',
    switchView: (view: ViewId) => void calls.push(`switch:${view}`),
    regionsChanged: () => { state.regions++; },
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

export function fakeShell() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const shell = {
    native: true,
    on(event: string, handler: (payload: unknown) => void) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
      return () => void set.delete(handler);
    },
  } as unknown as Shell;
  return {
    shell,
    emit<K extends keyof ShellEvents>(event: K, payload: ShellEvents[K]): void {
      handlers.get(event)?.forEach((handler) => handler(payload));
    },
    listeners: (event: string) => handlers.get(event)?.size ?? 0,
  };
}

export interface Rig {
  view: DesktopView;
  brain: Brain;
  host: ReturnType<typeof fakeHost>;
  shell: ReturnType<typeof fakeShell>;
  root: HTMLElement;
  /** What the view has asked the host to keep in the save. */
  memory: { value: unknown; writes: number };
  context: ViewContext;
  snap: () => DesktopSnapshot;
  parts: () => DesktopParts;
}

export interface MountOptions {
  pace?: Settings['desktopActivity'];
  needsWelcome?: boolean;
  save?: unknown;
  info?: WindowInfo;
  /** What the view remembered last time. */
  memory?: unknown;
  setup?(brain: Brain): void;
  /** Step with animation frames as well as timers. Default: timers only. */
  frames?: boolean;
  seed?: number;
  views?: readonly ViewId[];
}

/** The view mounted against the real brain, both on the fake clock. */
export function mountDesktop(options: MountOptions = {}): Rig {
  const seed = options.seed ?? 5;
  const brain = createBrain({ save: options.save, now: () => Date.now(), random: seeded(seed + 6), debug: true });
  // A settled, happy pet, unless a test says otherwise.
  brain.debug?.setNeeds({ tummy: 80, fun: 80, energy: 80, clean: 80 });
  brain.setSetting('soundAsked', true);
  brain.setSetting('reduceMotion', 'off');
  brain.setSetting('desktopActivity', options.pace ?? 'still');
  options.setup?.(brain);
  const host = fakeHost(options);
  const shell = fakeShell();
  const root = document.createElement('div');
  document.body.append(root);
  const memory = { value: options.memory ?? null, writes: 0 };
  const view = createDesktopView({
    now: () => Date.now(),
    random: seeded(seed),
    viewport: () => null,
    ...(options.frames ? {} : { frame: null }),
  });
  const context: ViewContext = {
    brain,
    shell: shell.shell,
    host: host.services,
    info: options.info ?? INFO,
    memory: { read: () => memory.value, write: (value) => { memory.value = JSON.parse(JSON.stringify(value)); memory.writes++; } },
  };
  void view.mount(root, context);
  return {
    view, brain, host, shell, root, memory, context,
    snap: () => view.snapshot() as DesktopSnapshot,
    parts: () => view.parts() as DesktopParts,
  };
}

/** Before each test: the fake clock, and no Web Animations (the test DOM's stub rejects on cancel). */
export function useFakeClock(): void {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  (Element.prototype as { animate?: unknown }).animate = undefined;
}

export function cleanUp(): void {
  document.body.replaceChildren();
  vi.useRealTimers();
}

/** Let `ms` pass, running timers and the promise continuations between them. */
export const tick = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);

/** Wait until Doozer is at rest with its face back to normal, or `limitMs` has passed. */
export async function settle(r: Rig, limitMs = 180_000, stepMs = 100): Promise<boolean> {
  for (let waited = 0; waited <= limitMs; waited += stepMs) {
    const s = r.snap();
    if (s.atRest && !s.busy && s.emotes === 0) return true;
    await tick(stepMs);
  }
  return false;
}

// ---- the pointer ---------------------------------------------------------------------

export interface PointerInit {
  buttons?: number;
  button?: number;
  id?: number;
  movementX?: number;
  movementY?: number;
}

let stamp = 50_000;

export function pointer(target: EventTarget, type: string, at: { x: number; y: number }, init: PointerInit = {}): void {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, button: init.button ?? 0, buttons: init.buttons ?? 0, clientX: at.x, clientY: at.y,
  });
  Object.defineProperty(event, 'pointerId', { value: init.id ?? 7 });
  Object.defineProperty(event, 'movementX', { value: init.movementX ?? 0 });
  Object.defineProperty(event, 'movementY', { value: init.movementY ?? 0 });
  target.dispatchEvent(event);
}

/** A click with a real-looking time stamp, `gap` ms after the previous one. */
export function click(target: Element, gap = 1000): void {
  stamp += gap;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: stamp });
  target.dispatchEvent(event);
}

/** The middle of the part of Doozer that catches the mouse. */
export function doozerAt(r: Rig): { x: number; y: number } {
  const s = r.snap();
  const region = hitRegion(s.stage.size, s.x, s.y);
  return { x: region.x + region.w / 2, y: region.y + region.h / 2 };
}

/** Press on Doozer and move far enough to pick it up, then on to `to` in a few steps. The button stays down. */
export function pickUp(r: Rig, to?: { x: number; y: number }): { x: number; y: number } {
  const { hit } = r.parts();
  const from = doozerAt(r);
  pointer(hit, 'pointerdown', from, { buttons: 1 });
  pointer(hit, 'pointermove', { x: from.x + 6, y: from.y - 9 }, { buttons: 1 });
  const end = to ?? { x: from.x + 6, y: from.y - 9 };
  for (let i = 1; i <= 4; i++) {
    pointer(hit, 'pointermove', { x: from.x + ((end.x - from.x) * i) / 4, y: from.y + ((end.y - from.y) * i) / 4 }, { buttons: 1 });
  }
  return end;
}

/** A whole press and release on Doozer without moving: a click. */
export function tap(r: Rig, gap = 1000): void {
  const { hit } = r.parts();
  const at = doozerAt(r);
  pointer(hit, 'pointerdown', at, { buttons: 1 });
  pointer(hit, 'pointerup', at, { buttons: 0 });
  click(hit, gap);
}

/** The Radial's button with this id. */
export function radialButton(r: Rig, id: string): HTMLButtonElement {
  const found = r.parts().radial.el.querySelector<HTMLButtonElement>(`[data-id="${id}"]`);
  if (!found) throw new Error(`no radial button ${id}`);
  return found;
}

export function cardButton(r: Rig, act: string): HTMLButtonElement {
  const found = r.parts().card.el.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);
  if (!found) throw new Error(`no card button ${act}`);
  return found;
}

/** True if the point is inside the rounded rectangle. */
export function inRegion(region: Region, x: number, y: number): boolean {
  if (x < region.x || y < region.y || x >= region.x + region.w || y >= region.y + region.h) return false;
  const r = Math.max(0, Math.min(region.r ?? 0, region.w / 2, region.h / 2));
  if (r <= 0) return true;
  const cx = Math.min(region.x + region.w - r, Math.max(region.x + r, x));
  const cy = Math.min(region.y + region.h - r, Math.max(region.y + r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** What "idle on the taskbar line with nothing left behind" means, spelled out for an assertion. */
export function restReport(r: Rig): Record<string, unknown> {
  const s = r.snap();
  const { world, pet, radial, card, settings } = r.parts();
  return {
    state: s.state,
    onTheLine: Math.abs(s.y - s.ground) < 0.5,
    whereItMayStand: s.x >= s.stage.minX - 0.5 && s.x <= s.stage.maxX + 0.5,
    open: s.open,
    radialOpen: radial.isOpen,
    cardOpen: card.isOpen,
    settingsOpen: settings.isOpen,
    props: world.querySelectorAll('.deskv-prop:not([data-bye])').length,
    pose: s.pose === 'walk' || s.pose === 'trot' || s.pose === 'peek' || s.pose === 'play' || s.pose === 'carried' ? s.pose : 'standing',
    held: pet.dataset.held ?? null,
    pressed: s.pressed,
    regions: r.view.hitRegions().length,
    rescues: s.rescues.length,
    overruns: s.overruns.length,
  };
}

/** `restReport` for a Doozer that is where it should be. */
export const AT_REST = {
  state: 'idle', onTheLine: true, whereItMayStand: true, open: 'none', radialOpen: false, cardOpen: false, settingsOpen: false,
  props: 0, pose: 'standing', held: null, pressed: false, regions: 1, rescues: 0, overruns: 0,
} as const;
