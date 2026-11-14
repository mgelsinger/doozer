// Shared by the Island view's tests: a host and a shell that only record, a painter that
// stands in for the graphics card, a screen that offers frames on the fake clock, and the
// view mounted against the real brain, the real model file and the real three.js scene.
// Only the drawing itself is missing.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { createBrain, type Brain, type ViewId } from '../../../src/core';
import { parseDoozerModel, type DoozerModel } from '../../../src/character/doozer3d';
import type { HostServices, ViewContext } from '../../../src/host/view';
import type { Shell, ShellEvents, WindowInfo } from '../../../src/shell';
import { createIslandView, type IslandSnapshot, type IslandView, type IslandViewOptions } from '../../../src/views/island';
import { islandLayout } from '../../../src/views/island/layout';
import type { Painter } from '../../../src/views/island/stage3d';
import { START, seeded } from '../../core/helpers';

// The tests run from app/. (In the test DOM `import.meta.url` is not a file address.)
const MODEL_FILE = resolve(process.cwd(), 'assets/doozer/doozer.glb');

/** The model file's bytes, read once. */
export function modelBytes(): ArrayBuffer {
  const bytes = readFileSync(MODEL_FILE);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function fakeHost(options: { views?: readonly ViewId[] } = {}) {
  const calls: string[] = [];
  const state = { focusable: false, regions: 0 };
  const services: HostServices = {
    availableViews: options.views ?? ['pill', 'island'],
    currentView: () => 'island',
    switchView: (view: ViewId) => void calls.push(`switch:${view}`),
    regionsChanged: () => { state.regions++; },
    windowChanged: () => void calls.push('window'),
    setFocusable: (on) => { state.focusable = on; calls.push(`focusable:${on}`); },
    showMenu: () => void calls.push('menu'),
    quit: () => void calls.push('quit'),
    chime: () => void calls.push('chime'),
    needsWelcome: () => false,
    welcomed: () => undefined,
  };
  return { services, calls, state };
}

export function fakeShell() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const drags: { clientX: number; clientY: number }[] = [];
  const shell = {
    native: true,
    beginDrag: async (at: { clientX: number; clientY: number }) => { drags.push(at); return true; },
    on(event: string, handler: (payload: unknown) => void) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
      return () => void set.delete(handler);
    },
  } as unknown as Shell;
  return {
    shell,
    drags,
    emit<K extends keyof ShellEvents>(event: K, payload: ShellEvents[K]): void {
      handlers.get(event)?.forEach((handler) => handler(payload));
    },
    listeners: (): number => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

/** The Island's window at Medium on the development machine: 4K at 150 %. */
export function infoFor(size: 'small' | 'medium' | 'large' = 'medium', at: { x: number; y: number } = { x: 3000, y: 900 }): WindowInfo {
  const layout = islandLayout(size);
  return {
    kind: 'floating', view: 'island', x: at.x, y: at.y, width: Math.round(layout.windowWidth * 1.5), height: Math.round(layout.windowHeight * 1.5), scale: 1.5,
    cssWidth: layout.windowWidth, cssHeight: layout.windowHeight,
    monitor: { full: { x: 0, y: 0, w: 3840, h: 2160 }, work: { x: 0, y: 0, w: 3840, h: 2088 }, scale: 1.5 }, nativeMs: 0,
  };
}

export interface FakePainter {
  painter: Painter;
  renders: number;
  disposed: boolean;
  sizes: [number, number, number][];
}

/** Every painter the view asked for, in order. `bornLost` makes the next ones useless, as a dead graphics card would. */
export function painters() {
  const made: FakePainter[] = [];
  const state = { bornLost: false, failToCreate: false };
  const create = (): Painter => {
    if (state.failToCreate) throw new Error('no graphics context to be had');
    let lost = state.bornLost;
    const lostHandlers: (() => void)[] = [];
    const restoredHandlers: (() => void)[] = [];
    const record: FakePainter = {
      renders: 0, disposed: false, sizes: [],
      painter: {
        canvas: document.createElement('canvas'),
        get lost() { return lost; },
        setSize(width, height, ratio) { record.sizes.push([width, height, ratio]); },
        render() { if (!lost && !record.disposed) record.renders++; },
        info: () => ({ geometries: 0, textures: 0, programs: 0 }),
        onLost(handler) { lostHandlers.push(handler); },
        onRestored(handler) { restoredHandlers.push(handler); },
        loseContext() { if (lost) return; lost = true; for (const handler of lostHandlers) handler(); },
        restoreContext() { if (!lost) return; lost = false; for (const handler of restoredHandlers) handler(); },
        dispose() { record.disposed = true; },
      },
    };
    made.push(record);
    return record.painter;
  };
  return { made, state, create, last: (): FakePainter => made[made.length - 1] as FakePainter };
}

/**
 * A screen: it offers a frame `hz` times a second on the fake clock for as long as one
 * has been asked for. `on = false` is a window that is not being drawn (hidden, covered).
 */
export function screen(hz = 60) {
  let pending: (() => void) | null = null;
  const state = { on: true, requested: 0 };
  const timer = setInterval(() => {
    if (!state.on) return;
    const frame = pending;
    pending = null;
    frame?.();
  }, 1000 / hz);
  return {
    state,
    requestFrame: (callback: () => void): unknown => { pending = callback; state.requested++; return state.requested; },
    cancelFrame: (): void => { pending = null; },
    stop: (): void => clearInterval(timer),
    get waiting(): boolean { return pending !== null; },
  };
}

export interface Rig {
  view: IslandView;
  brain: Brain;
  host: ReturnType<typeof fakeHost>;
  shell: ReturnType<typeof fakeShell>;
  painters: ReturnType<typeof painters>;
  screen: ReturnType<typeof screen>;
  root: HTMLElement;
  model: DoozerModel;
  modelDisposed: () => number;
  context: ViewContext;
  snap: () => IslandSnapshot;
  parts: () => NonNullable<ReturnType<IslandView['parts']>>;
  /** Where Doozer's middle is, as the pointer would have to be to touch it. */
  onDoozer: () => { x: number; y: number };
}

export interface MountOptions {
  save?: unknown;
  setup?(brain: Brain): void;
  size?: 'small' | 'medium' | 'large';
  info?: WindowInfo;
  views?: readonly ViewId[];
  hz?: number;
  seed?: number;
  view?: Partial<IslandViewOptions>;
}

let sharedModel: Promise<DoozerModel> | null = null;
/** The model, parsed once for the whole file (parsing does not depend on the clock). */
export function loadModelOnce(): Promise<DoozerModel> {
  sharedModel ??= parseDoozerModel(modelBytes());
  return sharedModel;
}

/** Everything a mount needs, without mounting: for the tests about loading itself. */
export async function prepare(options: MountOptions = {}) {
  const template = await loadModelOnce();
  const stage = await import('../../../src/views/island/stage3d');
  let disposed = 0;
  // Each mount gets its own handle on the model so that "disposed" can be counted per mount.
  // (Disposing only gives up what is on the graphics card, so the shared model stays usable.)
  const model: DoozerModel = { template: template.template, dispose: () => { disposed++; template.dispose(); } };
  const brain = createBrain({ save: options.save, now: () => Date.now(), random: seeded(options.seed ?? 11), debug: true });
  if (!options.save) {
    // A settled, happy pet, with motion never reduced by whatever the test machine prefers.
    brain.debug?.setNeeds({ tummy: 80, fun: 80, energy: 80, clean: 80 });
    brain.setSetting('soundAsked', true);
    brain.setSetting('reduceMotion', 'off');
  }
  if (options.size) brain.setSetting('size', { ...brain.settings.size, island: options.size });
  options.setup?.(brain);
  const host = fakeHost({ views: options.views });
  const shell = fakeShell();
  const made = painters();
  const display = screen(options.hz ?? 60);
  const root = document.createElement('div');
  document.body.append(root);
  const view = createIslandView({
    now: () => Date.now(),
    random: seeded((options.seed ?? 11) + 3),
    load: async () => ({ stage, model }),
    createPainter: made.create,
    requestFrame: display.requestFrame,
    cancelFrame: display.cancelFrame,
    pixelRatio: () => 1.5,
    ...options.view,
  });
  const context: ViewContext = { brain, shell: shell.shell, host: host.services, info: options.info ?? infoFor(options.size ?? 'medium') };
  return { view, brain, host, shell, painters: made, screen: display, root, model, modelDisposed: () => disposed, context, stage };
}

/** The view mounted against the real brain, both on the fake clock. */
export async function mount(options: MountOptions = {}): Promise<Rig> {
  const p = await prepare(options);
  await p.view.mount(p.root, p.context);
  const snap = (): IslandSnapshot => p.view.snapshot() as IslandSnapshot;
  const parts = (): NonNullable<ReturnType<IslandView['parts']>> => p.view.parts() as NonNullable<ReturnType<IslandView['parts']>>;
  const layout = (): ReturnType<typeof islandLayout> => islandLayout(p.brain.settings.size.island);
  return {
    ...p, snap, parts,
    // The test DOM lays nothing out, so the touch surface sits at 0,0: scene pixels are client pixels.
    onDoozer: () => ({ x: snap().doozer.screen.x - layout().sceneLeft, y: snap().doozer.screen.y - layout().sceneTop }),
  };
}

/** Let `ms` pass: timers, frames, and the promise continuations between them. */
export const tick = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);

/** Wait until the island has come to rest (nothing moving, no scene, loop asleep), or the limit passes. */
export async function rest(r: Rig, limitMs = 20_000): Promise<number> {
  let waited = 0;
  const still = (): boolean => {
    const s = r.snap();
    return !s.moving && !s.drawing && s.scene === null && !s.busy && !s.lively && !s.pressed && !s.hover && s.particles === 0 && s.emotes === 0;
  };
  while (!still() && waited < limitMs) { await tick(100); waited += 100; }
  return waited;
}

let stamp = 50_000;
let pointerId = 7;

export interface PointerInit { buttons?: number; button?: number; movementX?: number; movementY?: number; gap?: number }

/** A pointer event on the island at a point of the drawing. */
export function pointer(target: Element, type: string, at: { x: number; y: number }, init: PointerInit = {}): void {
  stamp += init.gap ?? 16;
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: init.button ?? 0, buttons: init.buttons ?? 0, clientX: at.x, clientY: at.y });
  Object.defineProperty(event, 'movementX', { value: init.movementX ?? 0 });
  Object.defineProperty(event, 'movementY', { value: init.movementY ?? 0 });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'timeStamp', { value: stamp });
  target.dispatchEvent(event);
}

/** A whole press and release at one spot, `gap` ms after the previous one. */
export function poke(r: Rig, at = r.onDoozer(), gap = 1000): void {
  const { touch } = r.parts();
  pointerId++;
  pointer(touch, 'pointerdown', at, { buttons: 1, gap });
  pointer(touch, 'pointerup', at, { buttons: 0, gap: 40 });
}

/** Move the pointer across the island without pressing, in steps, covering `distance` pixels. */
export function stroke(r: Rig, distance: number, options: { buttons?: number; from?: { x: number; y: number } } = {}): void {
  const { touch } = r.parts();
  const start = options.from ?? r.onDoozer();
  const steps = Math.max(1, Math.round(distance / 12));
  for (let i = 0; i < steps; i++) {
    // Back and forth across the body, never leaving it.
    const dx = (i % 4 < 2 ? 12 : -12);
    pointer(touch, 'pointermove', { x: start.x + (i % 4 === 1 || i % 4 === 2 ? 12 : 0), y: start.y }, { buttons: options.buttons ?? 0, movementX: dx, movementY: 0 });
  }
}

/** The pointer rests on the island long enough to count as a visit, not a crossing. */
export async function arrive(r: Rig, at = r.onDoozer()): Promise<void> {
  const { touch } = r.parts();
  pointer(touch, 'pointermove', at);
  await tick(200);
  pointer(touch, 'pointermove', at);
}

export { START };
