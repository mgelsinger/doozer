// Shell spike test page (Phase 3): a coloured blob standing in for Doozer and
// buttons that move the one window between its shapes.
//
// This is a stand-in for the real view host that Phase 6 builds. It follows the
// same three steps for every switch (see the top of src/shell.ts): hide, change
// the window, show and report hit regions.

import './test-page.css';
import { regionOf, shell, type Anchor, type Region, type ViewId, type WindowInfo, type WindowMode } from '../shell';

export const VIEW_ORDER: readonly ViewId[] = ['pill', 'room', 'island', 'desktop'];

const LABELS: Record<ViewId, string> = { pill: 'Pill', room: 'Room', island: 'Island', desktop: 'Desktop' };

/**
 * Frames to wait after hiding the old view before the window is changed.
 *
 * Filmed at 120 Hz (docs/shell-spike.md): with 0 frames the old view was caught
 * inside the new window for one frame in 1 switch of 40; with 1 and with 2 it
 * never was (0 of 40, 0 of 220), but the old view was often still on screen at
 * the instant the window changed and only Windows applying both together saved
 * it; with 3 the old view was always gone first. Three costs 8 ms more.
 */
const DEFAULT_HIDE_FRAMES = 3;

interface Saved {
  view: ViewId;
  positions: Partial<Record<ViewId, { x: number; y: number }>>;
  desktopX?: number;
  saves: number;
}

export interface SwitchTiming {
  view: ViewId;
  /** Request to new view painted. */
  totalMs: number;
  /** Hiding the old view and waiting for that frame. */
  hideMs: number;
  /** Asking the shell, the native change, and the page reaching its new size. */
  windowMs: number;
  /** Of which, time spent in native code. */
  nativeMs: number;
  /** Building the new view and showing it. */
  showMs: number;
  info: WindowInfo;
}

export interface TestPage {
  readonly stage: HTMLElement;
  current(): ViewId | null;
  switchTo(view: ViewId): Promise<SwitchTiming>;
  /** Regions the page last reported, in CSS pixels. */
  regions(): readonly Region[];
  /** The blob, the control chip and any drag handle of the current view. */
  parts(): { blob: HTMLElement; chip: HTMLElement; handle: HTMLElement | null; shape: HTMLElement | null };
  counters(): { clicks: number; moves: number; enters: number; dragEnds: number };
  setBreathing(on: boolean): void;
  setHideFrames(n: number): void;
  /** For the film test's control run only: switch without hiding the old view first. */
  setHideOldView(hide: boolean): void;
  /** Where the pill docks. The film test moves it to a corner so one strip of screen covers every mode. */
  setPillAnchor(anchor: Anchor): void;
  onMark(fn: (label: string) => void): void;
  save(): Promise<void>;
  state(): Saved;
}

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await frame();
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export async function mountTestPage(host: HTMLElement): Promise<TestPage> {
  const stage = el('div', 'stage');
  stage.style.visibility = 'hidden';
  host.append(stage);

  let saved: Saved = { view: 'pill', positions: {}, saves: 0 };
  let view: ViewId | null = null;
  let info: WindowInfo | null = null;
  let lastTiming: SwitchTiming | null = null;
  let lastRegions: Region[] = [];
  let breathing = false;
  let hideFrames = DEFAULT_HIDE_FRAMES;
  let pillAnchor: Anchor = 'top-center';
  let hideOldView = true;
  let switching: Promise<unknown> = Promise.resolve();
  let mark: (label: string) => void = () => undefined;
  let note = '';
  const count = { clicks: 0, moves: 0, enters: 0, dragEnds: 0 };

  // Parts of the current view; rebuilt on every switch.
  let blob: HTMLElement = el('div', 'blob');
  let chip: HTMLElement = el('div', 'chip');
  let readout: HTMLElement = el('pre', 'readout');
  let handle: HTMLElement | null = null;
  let shape: HTMLElement | null = null;
  // Listeners that belong to the current view; aborted when the view is rebuilt.
  let viewLife = new AbortController();

  const modeFor = (v: ViewId): WindowMode => {
    const at = saved.positions[v];
    switch (v) {
      case 'pill':
        return { kind: 'docked', width: 340, height: 196, anchor: pillAnchor };
      case 'room':
        return { kind: 'floating', width: 380, height: 464, ...at };
      case 'island':
        return { kind: 'floating', width: 380, height: 450, ...at };
      case 'desktop':
        return { kind: 'overlay' };
    }
  };

  const reportRegions = (): void => {
    lastRegions = [...stage.querySelectorAll<HTMLElement>('[data-hit]')].map((node) => regionOf(node));
    shell.setHitRegions(lastRegions);
  };

  const refreshReadout = (): void => {
    const size = info ? `${info.kind} ${Math.round(info.cssWidth)}x${Math.round(info.cssHeight)} @${info.scale}` : '';
    const t = lastTiming;
    const timing = t ? `switch ${t.totalMs.toFixed(0)} ms (native ${t.nativeMs.toFixed(1)})` : 'switch -';
    readout.textContent = `${view ?? '-'} · ${size}\n${timing}\nclicks ${count.clicks} · moves ${count.moves}${note ? `\n${note}` : ''}`;
  };

  // ---- Building a view ---------------------------------------------------------

  const makeBlob = (): HTMLElement => {
    const b = el('div', 'blob');
    b.dataset.hit = '';
    if (breathing) b.classList.add('breathe');
    b.addEventListener('pointerenter', () => {
      count.enters++;
      b.classList.add('hover');
    });
    b.addEventListener('pointerleave', () => b.classList.remove('hover'));
    b.addEventListener('pointermove', () => {
      count.moves++;
    });
    b.addEventListener('click', () => {
      count.clicks++;
      refreshReadout();
    });
    return b;
  };

  const makeChip = (): HTMLElement => {
    const c = el('div', 'chip');
    c.dataset.hit = '';
    const views = el('div', 'row');
    for (const v of VIEW_ORDER) {
      const b = el('button', v === view ? 'on' : '', LABELS[v]);
      b.dataset.view = v;
      b.addEventListener('click', () => void api.switchTo(v));
      views.append(b);
    }
    const cycle = el('button', '', '×10');
    cycle.title = 'Cycle through all four modes ten times';
    cycle.addEventListener('click', () => void cycleTenTimes());
    views.append(cycle);

    const tools = el('div', 'row');
    const button = (label: string, action: () => void): void => {
      const b = el('button', '', label);
      b.addEventListener('click', action);
      tools.append(b);
    };
    button('Save', () => void api.save());
    button('Load', () => void loadAndShow());
    button('Menu', () => void shell.showMenu());
    button('Quit', () => void shell.quit());

    readout = el('pre', 'readout');
    c.append(views, tools, readout);
    return c;
  };

  /** A page-defined handle that drags the whole window. No `-webkit-app-region` involved. */
  const makeDragHandle = (node: HTMLElement): void => {
    node.dataset.drag = '';
    let down: { x: number; y: number; id: number } | null = null;
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    node.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id) return;
      // A few pixels of slack so a plain click on the handle is not a drag.
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 3) return;
      const grab = down;
      down = null;
      void shell.beginDrag({ clientX: grab.x, clientY: grab.y });
    });
    const cancel = (): void => {
      down = null;
    };
    node.addEventListener('pointerup', cancel);
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('pointerleave', cancel);
  };

  /** Desktop view: the blob is carried around inside the page; the window does not move. */
  const makeCarriable = (b: HTMLElement): void => {
    let grab: { dx: number; dy: number; id: number } | null = null;
    let queued = false;
    const queueRegions = (): void => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        reportRegions();
      });
    };
    const place = (left: number, top: number): void => {
      b.style.left = `${left}px`;
      b.style.top = `${top}px`;
      chip.style.left = `${Math.max(8, Math.min(left - 70, window.innerWidth - chip.offsetWidth - 8))}px`;
      chip.style.top = `${Math.max(8, top - chip.offsetHeight - 14)}px`;
      queueRegions();
    };
    const setDown = (): void => {
      // Every way a carry can end lands here: there is no path that leaves the blob "carried".
      if (!grab) return;
      grab = null;
      b.classList.remove('carried');
      const left = Math.max(0, Math.min(b.offsetLeft, window.innerWidth - b.offsetWidth));
      saved.desktopX = left;
      place(left, window.innerHeight - b.offsetHeight);
      b.addEventListener('transitionend', () => reportRegions(), { once: true });
    };
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      grab = { dx: e.clientX - b.offsetLeft, dy: e.clientY - b.offsetTop, id: e.pointerId };
      b.setPointerCapture(e.pointerId);
      b.classList.add('carried');
    });
    b.addEventListener('pointermove', (e) => {
      if (!grab || e.pointerId !== grab.id) return;
      if (e.buttons === 0) return setDown(); // the button came up somewhere we never heard about
      place(e.clientX - grab.dx, e.clientY - grab.dy);
    });
    b.addEventListener('pointerup', setDown);
    b.addEventListener('pointercancel', setDown);
    b.addEventListener('lostpointercapture', setDown);
    window.addEventListener('blur', setDown, { signal: viewLife.signal });
  };

  const build = (v: ViewId): void => {
    viewLife.abort();
    viewLife = new AbortController();
    stage.replaceChildren();
    stage.className = `stage view-${v}`;
    handle = null;
    shape = null;
    blob = makeBlob();
    chip = makeChip();

    if (v === 'pill') {
      const pill = el('div', 'pill');
      pill.dataset.hit = '';
      delete blob.dataset.hit; // the pill is one region; the blob is inside it
      const text = el('div');
      text.append(el('div', 'name', 'Doozer'), el('div', 'status', 'is content'));
      pill.append(blob, text);
      shape = pill;
      stage.append(pill, chip);
    } else if (v === 'room') {
      const room = el('div', 'room');
      room.dataset.hit = '';
      delete blob.dataset.hit;
      delete chip.dataset.hit;
      const bar = el('div', 'titlebar');
      bar.append(el('span', '', "Doozer's room"), el('span', '', '⠿ drag'));
      makeDragHandle(bar);
      handle = bar;
      shape = room;
      room.append(bar, el('div', 'rug'), blob, chip);
      stage.append(room);
    } else if (v === 'island') {
      const grip = el('div', 'grip', '⠿ move');
      grip.dataset.hit = '';
      makeDragHandle(grip);
      handle = grip;
      shape = el('div', 'island');
      stage.append(shape, blob, grip, chip);
    } else {
      stage.append(blob, chip);
      const left = Math.max(0, Math.min(saved.desktopX ?? window.innerWidth - 330, window.innerWidth - 110));
      blob.style.left = `${left}px`;
      blob.style.top = `${window.innerHeight - 96}px`;
      chip.style.left = `${Math.max(8, left - 70)}px`;
      chip.style.top = `${window.innerHeight - 96 - 14 - chip.offsetHeight}px`;
      makeCarriable(blob);
    }
    refreshReadout();
  };

  // ---- Switching ---------------------------------------------------------------

  const doSwitch = async (v: ViewId): Promise<SwitchTiming> => {
    const t0 = performance.now();
    mark(`switch-begin:${v}`);
    // 1. Hide the old view and let that blank frame reach the screen.
    if (hideOldView) stage.style.visibility = 'hidden';
    shell.setHitRegions([]);
    await frames(hideFrames);
    const t1 = performance.now();
    mark('blank-begin');
    // 2. Change the window. Resolves once the page has its new size.
    info = await shell.setWindowMode(modeFor(v), v);
    const t2 = performance.now();
    // 3. Build the new view, show it, and say where the mouse should be caught.
    view = v;
    saved.view = v;
    build(v);
    mark('blank-end');
    stage.style.visibility = 'visible';
    await frame();
    reportRegions();
    await shell.regionsFlushed();
    const t3 = performance.now();
    mark(`switch-end:${v}`);
    lastTiming = { view: v, totalMs: t3 - t0, hideMs: t1 - t0, windowMs: t2 - t1, nativeMs: info.nativeMs, showMs: t3 - t2, info };
    refreshReadout();
    return lastTiming;
  };

  const cycleTenTimes = async (): Promise<void> => {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      for (const v of VIEW_ORDER) {
        times.push((await api.switchTo(v)).totalMs);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    times.sort((a, b) => a - b);
    note = `40 switches: median ${times[20]?.toFixed(0)} ms, worst ${times[39]?.toFixed(0)} ms`;
    refreshReadout();
  };

  const loadAndShow = async (): Promise<void> => {
    const loaded = await shell.load();
    note = `load: ${loaded.source}${loaded.problem ? ` (${loaded.problem})` : ''}`;
    if (loaded.data) {
      try {
        saved = { ...saved, ...(JSON.parse(loaded.data) as Partial<Saved>) };
      } catch {
        note = 'load: unreadable';
      }
    }
    refreshReadout();
  };

  const api: TestPage = {
    stage,
    current: () => view,
    switchTo(v) {
      // One switch at a time; a second request waits for the first to finish.
      const run = switching.then(() => doSwitch(v));
      switching = run.catch(() => undefined);
      return run;
    },
    regions: () => lastRegions,
    parts: () => ({ blob, chip, handle, shape }),
    counters: () => ({ ...count }),
    setBreathing(on) {
      breathing = on;
      blob.classList.toggle('breathe', on);
    },
    setHideFrames(n) {
      hideFrames = Math.max(0, Math.round(n));
    },
    setPillAnchor(anchor) {
      pillAnchor = anchor;
    },
    setHideOldView(hide) {
      hideOldView = hide;
    },
    onMark(fn) {
      mark = fn;
    },
    async save() {
      saved.saves++;
      try {
        await shell.save(JSON.stringify(saved));
        note = `save #${saved.saves} ok`;
      } catch (error) {
        note = `save failed: ${String(error)}`;
      }
      refreshReadout();
    },
    state: () => saved,
  };

  // ---- Wiring ------------------------------------------------------------------

  shell.on('view-requested', (v) => void api.switchTo(v));
  shell.on('drag-end', (moved) => {
    count.dragEnds++;
    info = moved;
    if (view) saved.positions[view] = { x: moved.x, y: moved.y };
    note = `moved to ${moved.x}, ${moved.y}`;
    refreshReadout();
    void api.save();
  });
  shell.on('display-changed', (changed) => {
    info = changed;
    if (view === 'desktop') build('desktop');
    reportRegions();
    refreshReadout();
  });
  shell.on('watchdog', () => {
    note = 'watchdog: regions were dropped';
    refreshReadout();
  });
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    void shell.showMenu();
  });

  await loadAndShow();
  await api.switchTo(saved.view);
  return api;
}
