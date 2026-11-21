// Automated runs of the shell spike test page (Phase 3). See docs/shell-spike.md.
//
// Started by launching a `--features spike` build with DOOZER_SPIKE set to one or
// more scenario names (comma separated) and, optionally, DOOZER_SPIKE_ARGS (JSON).
// A normal build never gets here: `spike_config` reports `enabled: false`.
//
// The runs keep the real mouse out. The cursor tracker is fed a pretend cursor,
// so nothing here moves the user's pointer or depends on where it is; what is
// checked is the real window style and what Windows says it would hit.

import { invoke } from '@tauri-apps/api/core';
import { shell, type Region, type ViewId } from '../shell';
import { VIEW_ORDER, type SwitchTiming, type TestPage } from './test-page';

interface SpikeConfig {
  enabled: boolean;
  scenario?: string;
  args?: Record<string, unknown> | null;
  out?: string;
  cloaked?: boolean;
  debugBuild?: boolean;
}

interface Status {
  kind: string | null;
  view: string | null;
  bounds: { x: number; y: number; w: number; h: number } | null;
  scale: number;
  regions: number;
  regionsLost: boolean;
  catching: boolean;
  styleClickThrough: boolean;
  styleLayered: boolean;
  styleNoActivate: boolean;
  styleToolWindow: boolean;
  visible: boolean;
  dragging: boolean;
  holding: boolean;
  isForeground: boolean;
  foreground: number;
  foregroundClass: string;
  fullscreenInFront: boolean;
  foregroundFullscreen: boolean;
  userNotificationState: number;
  userIdleMs: number;
  msSinceHeartbeat: number;
  stats: { ticks: number; flips: number; styleRepairs: number; styleCatchUps: number; watchdogTrips: number; displayChanges: number; modeSwitches: number };
}

interface ProbeReading {
  label: string;
  screen: [number, number];
  down: boolean;
  styleClickThrough: boolean;
  hitIsDoozer: boolean;
  hitClass: string;
}

interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Point = { x: number; y: number };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const status = (): Promise<Status> => invoke<Status>('shell_status');
/** Far outside every monitor: the pretend cursor's resting place. */
const PARKED = { x: -30000, y: -30000, screen: true, down: false };
const park = (): Promise<unknown> => invoke('spike_inject', { cursor: PARKED });

function contains(r: Region, p: Point): boolean {
  if (p.x < r.x || p.y < r.y || p.x >= r.x + r.w || p.y >= r.y + r.h) return false;
  const rad = Math.max(0, Math.min(r.r ?? 0, r.w / 2, r.h / 2));
  if (rad <= 0) return true;
  const cx = Math.min(Math.max(p.x, r.x + rad), r.x + r.w - rad);
  const cy = Math.min(Math.max(p.y, r.y + rad), r.y + r.h - rad);
  return (p.x - cx) ** 2 + (p.y - cy) ** 2 <= rad ** 2;
}

const centre = (node: Element): Point => {
  const b = node.getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
};

/** Somewhere inside the window that no hit region covers. */
function blankPoint(regions: readonly Region[]): Point {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const candidates: Point[] = [
    { x: 5, y: h - 5 },
    { x: w - 5, y: h - 5 },
    { x: 5, y: 5 },
    { x: w - 5, y: 5 },
    { x: Math.round(w / 2), y: Math.round(h / 2) },
    { x: Math.round(w * 0.2), y: Math.round(h * 0.3) },
  ];
  const free = candidates.find((p) => !regions.some((r) => contains(r, p)));
  if (!free) throw new Error('no blank point: the regions cover every candidate');
  return free;
}

/** A point inside a rounded region's bounding box but outside its rounded corner. */
function cornerPoint(regions: readonly Region[]): Point | null {
  for (const r of regions) {
    if ((r.r ?? 0) < 8) continue;
    const p = { x: r.x + 1.5, y: r.y + 1.5 };
    if (!regions.some((other) => contains(other, p))) return p;
  }
  return null;
}

interface ProbeCheck {
  label: string;
  expectThrough: boolean;
  styleClickThrough: boolean;
  hitIsDoozer: boolean;
  hitClass: string;
  ok: boolean;
}

/**
 * Walk the pretend cursor through the cases that matter for one view and check
 * each against what should happen. Includes the two "button held" cases: a press
 * that starts on Doozer keeps being caught when the cursor leaves the region,
 * and a press that starts elsewhere is not hijacked when it passes over Doozer.
 */
async function probeView(page: TestPage, cloaked: boolean): Promise<ProbeCheck[]> {
  const regions = page.regions();
  const { blob, chip } = page.parts();
  const blank = blankPoint(regions);
  const onBlob = centre(blob);
  const onChip = centre(chip);
  const corner = cornerPoint(regions);
  const plan: { label: string; at: Point; down: boolean; through: boolean }[] = [
    { label: 'beside Doozer', at: blank, down: false, through: true },
    { label: 'on Doozer', at: onBlob, down: false, through: false },
    { label: 'press on Doozer', at: onBlob, down: true, through: false },
    { label: 'held, cursor strays off Doozer', at: blank, down: true, through: false },
    { label: 'released off Doozer', at: blank, down: false, through: true },
    ...(corner ? [{ label: 'in a rounded corner', at: corner, down: false, through: true }] : []),
    { label: 'on the controls', at: onChip, down: false, through: false },
    // A real pointer cannot leave a region and press in the same instant, so the
    // pretend one must not either: move off first, then press.
    { label: 'beside Doozer again', at: blank, down: false, through: true },
    { label: 'press beside Doozer', at: blank, down: true, through: true },
    { label: 'held, dragged across Doozer', at: onBlob, down: true, through: true },
    { label: 'released on Doozer', at: onBlob, down: false, through: false },
  ];
  const readings = await invoke<ProbeReading[]>('spike_probe', {
    points: plan.map((p) => ({ label: p.label, x: p.at.x, y: p.at.y, down: p.down })),
  });
  await park();
  return plan.map((p, i) => {
    const r = readings[i];
    if (!r) return { label: p.label, expectThrough: p.through, styleClickThrough: false, hitIsDoozer: false, hitClass: '?', ok: false };
    // A cloaked window is never hit by Windows, so only the style can be checked.
    // The same goes while a system dialog is dimming the screen: its dimming
    // layer sits above every window and takes every click, Doozer's included.
    const hitOk = cloaked || r.hitClass === 'Shell_SystemDim' || r.hitIsDoozer === !p.through;
    return {
      label: p.label,
      expectThrough: p.through,
      styleClickThrough: r.styleClickThrough,
      hitIsDoozer: r.hitIsDoozer,
      hitClass: r.hitClass,
      ok: r.styleClickThrough === p.through && hitOk,
    };
  });
}

function stats(values: number[]): { n: number; min: number; median: number; p95: number; max: number; mean: number } {
  const v = [...values].sort((a, b) => a - b);
  const at = (q: number): number => v[Math.min(v.length - 1, Math.floor(q * v.length))] ?? 0;
  const round = (x: number): number => Math.round(x * 10) / 10;
  return {
    n: v.length,
    min: round(v[0] ?? 0),
    median: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(v[v.length - 1] ?? 0),
    mean: round(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)),
  };
}

const union = (a: ScreenRect, b: ScreenRect): ScreenRect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

// ---- Scenarios -------------------------------------------------------------------

type Scenario = (page: TestPage, args: Record<string, unknown>, config: SpikeConfig) => Promise<unknown>;

/**
 * Cycle through all four modes `cycles` times.
 *   probe: check click-through state in every mode on every cycle (default on)
 *   film:  put flat-colour patches behind the window and film every frame (default off)
 */
const cycle: Scenario = async (page, args, config) => {
  // Putting windows on top of a fullscreen game or video is rude and proves nothing.
  if (config.cloaked !== true && args.evenIfFullscreen !== true && (await status()).fullscreenInFront) {
    return { skipped: 'a fullscreen app is in front', failures: [] };
  }
  const cycles = Number(args.cycles ?? 10);
  const dwell = Number(args.dwell ?? 350);
  const probe = args.probe !== false;
  const film = args.film === true;
  if (args.hideFrames !== undefined) page.setHideFrames(Number(args.hideFrames));
  // Control run: switch the wrong way on purpose, to prove the film catches it.
  if (args.sabotage === true) page.setHideOldView(false);
  await park();

  let capture: unknown = null;
  let filmed: { rects: ScreenRect[]; names: string[] } | null = null;
  if (film) {
    // Dock the pill in the corner above the other modes, so that one strip of
    // screen covers every mode. One rectangle means one grab per composed frame.
    page.setPillAnchor('top-right');
    // A first pass to learn where each mode puts things.
    let strip: ScreenRect | null = null;
    let work: ScreenRect | null = null;
    for (const v of VIEW_ORDER) {
      const t = await page.switchTo(v);
      work = t.info.monitor.work;
      let area: ScreenRect = { x: t.info.x, y: t.info.y, w: t.info.width, h: t.info.height };
      if (v === 'desktop') {
        // The overlay is the whole work area; only the part with something in it matters.
        const s = t.info.scale;
        const { blob, chip } = page.parts();
        const toScreen = (node: Element): ScreenRect => {
          const b = node.getBoundingClientRect();
          return { x: t.info.x + Math.floor(b.left * s), y: t.info.y + Math.floor(b.top * s), w: Math.ceil(b.width * s), h: Math.ceil(b.height * s) };
        };
        area = union(toScreen(blob), toScreen(chip));
      }
      strip = strip ? union(strip, area) : area;
      await sleep(120);
    }
    if (!strip || !work) throw new Error('nothing to film');
    const pad = 12;
    const x = Math.max(work.x, strip.x - pad);
    const y = Math.max(work.y, strip.y - pad);
    const filmRect: ScreenRect = {
      x,
      y,
      w: Math.min(work.x + work.w, strip.x + strip.w + pad) - x,
      h: Math.min(work.y + work.h, strip.y + strip.h + pad) - y,
    };
    // A small separate patch beside the strip says what the pink area is.
    const label: ScreenRect = { x: filmRect.x - 640, y: work.y + 12, w: 620, h: 40 };
    await page.switchTo('pill');
    await invoke('spike_backdrop', { rects: [filmRect, label] });
    await sleep(500);
    filmed = { rects: [filmRect], names: ['every mode (right-hand strip)'] };
    page.onMark((text) => void invoke('spike_mark', { label: text }));
    await invoke('spike_capture_start', { rects: [filmRect], name: String(args.tag ?? 'film') });
    await sleep(300);
  }

  const before = await status();
  const visits: unknown[] = [];
  const timings: SwitchTiming[] = [];
  const failures: string[] = [];
  let blindChecks = 0;
  let behindBackdrop = 0;
  let backdropClicks: number | null = null;
  for (let c = 1; c <= cycles; c++) {
    for (const v of VIEW_ORDER) {
      const t = await page.switchTo(v);
      timings.push(t);
      await sleep(dwell);
      const after = await status();
      // Is the view really there? (Skipped while filming: the film answers that, frame by frame.)
      let seen: { shown: boolean; colour: number[] } | null = null;
      if (!film && config.cloaked !== true) {
        const check = await makeScreenCheck(page);
        seen = check.usable ? await check.shown() : null;
        if (!check.usable) blindChecks++;
      }
      if (seen && !seen.shown) failures.push(`cycle ${c} ${v}: the view is not on screen (pixel ${seen.colour.join(',')})`);
      if (film) {
        // The backdrop is an always-on-top window too. If it ever ends up in front
        // of Doozer the film shows an empty strip, which must not be mistaken for
        // the view failing to draw.
        const look = await invoke<{ order: { at: number; window: string }[] }>('spike_look', { points: [] });
        const doozerAt = look.order.find((o) => o.window === 'doozer')?.at ?? -1;
        if (look.order.some((o) => o.window === 'backdrop' && o.at < doozerAt)) {
          behindBackdrop++;
          failures.push(`cycle ${c} ${v}: the backdrop is in front of Doozer`);
        }
      }
      if (document.visibilityState !== 'visible') failures.push(`cycle ${c} ${v}: the page thinks it is ${document.visibilityState}`);
      // Settled, cursor parked: the window must be letting everything through.
      if (!after.styleClickThrough || after.catching) failures.push(`cycle ${c} ${v}: not click-through at rest`);
      if (after.regions === 0) failures.push(`cycle ${c} ${v}: no hit regions reported`);
      if (after.isForeground) failures.push(`cycle ${c} ${v}: Doozer took keyboard focus`);
      let probes: ProbeCheck[] | null = null;
      if (probe) {
        probes = await probeView(page, config.cloaked === true);
        for (const p of probes) if (!p.ok) failures.push(`cycle ${c} ${v}: "${p.label}" expected ${p.expectThrough ? 'through' : 'caught'}`);
      }
      visits.push({
        cycle: c,
        view: v,
        totalMs: t.totalMs,
        hideMs: t.hideMs,
        windowMs: t.windowMs,
        nativeMs: t.nativeMs,
        showMs: t.showMs,
        bounds: [t.info.x, t.info.y, t.info.width, t.info.height],
        onScreen: seen?.shown ?? null,
        probes,
      });
    }
  }
  const end = await status();

  if (film) {
    await sleep(300);
    capture = await invoke('spike_capture_stop');
    page.onMark(() => undefined);
    // Clicks on the backdrop can only come from a person: the test never clicks.
    backdropClicks = (await invoke<{ clicks: number }>('spike_backdrop', { rects: null })).clicks;
    page.setPillAnchor('top-center');
  }
  page.setHideOldView(true);

  const by = (pick: (t: SwitchTiming) => number, v?: ViewId): number[] => timings.filter((t) => !v || t.view === v).map(pick);
  return {
    cycles,
    switches: timings.length,
    onScreenChecksThatCouldNotTell: blindChecks,
    timesBackdropWasInFrontOfDoozer: film ? behindBackdrop : null,
    clicksOnBackdropByAPerson: backdropClicks,
    probed: probe,
    probesBlockedByASystemDialog: visits.reduce<number>(
      (n, v) => n + ((v as { probes: ProbeCheck[] | null }).probes?.filter((p) => p.hitClass === 'Shell_SystemDim').length ?? 0),
      0,
    ),
    filmed,
    failures,
    foregroundChanged: before.foreground !== end.foreground,
    foregroundClass: end.foregroundClass,
    fullscreenInFront: end.fullscreenInFront,
    userNotificationState: end.userNotificationState,
    counters: {
      flips: end.stats.flips - before.stats.flips,
      styleRepairs: end.stats.styleRepairs - before.stats.styleRepairs,
      watchdogTrips: end.stats.watchdogTrips - before.stats.watchdogTrips,
      displayChanges: end.stats.displayChanges - before.stats.displayChanges,
    },
    timing: {
      total: stats(by((t) => t.totalMs)),
      hide: stats(by((t) => t.hideMs)),
      window: stats(by((t) => t.windowMs)),
      native: stats(by((t) => t.nativeMs)),
      show: stats(by((t) => t.showMs)),
      totalByView: Object.fromEntries(VIEW_ORDER.map((v) => [v, stats(by((t) => t.totalMs, v))])),
    },
    visits,
    capture,
  };
};

/** Drag the room and the island by their handles with the pretend cursor. */
const drag: Scenario = async (page) => {
  const out: unknown[] = [];
  const failures: string[] = [];
  for (const v of ['room', 'island'] as const) {
    delete page.state().positions[v];
    const start = (await page.switchTo(v)).info;
    await sleep(200);
    const { handle } = page.parts();
    if (!handle) throw new Error(`${v} has no drag handle`);
    const grab = centre(handle);
    const dragEndsBefore = page.counters().dragEnds;

    const placed = await invoke<{ screen: [number, number] }>('spike_inject', { cursor: { ...grab, down: false } });
    await sleep(160);
    const hovering = await status();
    await invoke('spike_inject', { cursor: { ...grab, down: true } });
    await sleep(60);
    const began = await shell.beginDrag({ clientX: grab.x, clientY: grab.y });

    // Sweep up and to the left, quickly, checking the state on the way.
    const [sx, sy] = placed.screen;
    const steps = 30;
    let lostCatch = 0;
    for (let i = 1; i <= steps; i++) {
      await invoke('spike_inject', { cursor: { x: sx - 12 * i, y: sy - 9 * i, screen: true, down: true } });
      await sleep(14);
      if (i % 5 === 0) {
        const s = await status();
        if (s.styleClickThrough || !s.catching || !s.dragging) lostCatch++;
      }
    }
    await sleep(60);
    const during = await status();
    await invoke('spike_inject', { cursor: { x: sx - 12 * steps, y: sy - 9 * steps, screen: true, down: false } });
    await sleep(250);
    const released = await status();
    await park();
    await sleep(200);
    const parked = await status();

    const moved = { dx: (during.bounds?.x ?? 0) - start.x, dy: (during.bounds?.y ?? 0) - start.y };
    const expected = { dx: -12 * steps, dy: -9 * steps };
    const dragEnds = page.counters().dragEnds - dragEndsBefore;

    // The new spot is remembered: leave and come back.
    await page.switchTo('pill');
    const back = (await page.switchTo(v)).info;

    const checks = {
      caughtOnHandle: !hovering.styleClickThrough,
      began,
      followedCursor: Math.abs(moved.dx - expected.dx) <= 2 && Math.abs(moved.dy - expected.dy) <= 2,
      neverLetGoWhileHeld: lostCatch === 0,
      endedOnRelease: !released.dragging,
      oneDragEndEvent: dragEnds === 1,
      throughAgainAfterwards: parked.styleClickThrough && !parked.catching,
      sizeUnchanged: during.bounds?.w === start.width && during.bounds?.h === start.height,
      cameBackWhereItWasLeft: back.x === during.bounds?.x && back.y === during.bounds?.y,
    };
    for (const [name, ok] of Object.entries(checks)) if (!ok) failures.push(`${v}: ${name}`);
    out.push({ view: v, start: [start.x, start.y], moved, expected, dragEnds, checks });

    // A remembered position that is off every screen is pulled back into the work area.
    page.state().positions[v] = { x: -9000, y: 99000 };
    const rescued = (await page.switchTo(v)).info;
    const work = rescued.monitor.work;
    const inside = rescued.x >= work.x && rescued.y >= work.y && rescued.x + rescued.width <= work.x + work.w && rescued.y + rescued.height <= work.y + work.h;
    if (!inside) failures.push(`${v}: an off-screen position was not pulled back`);
    out.push({ view: v, offscreenRescuedTo: [rescued.x, rescued.y], inside });
    delete page.state().positions[v];
  }
  await page.switchTo('pill');
  return { failures, runs: out };
};

/** A page that stops checking in must lose its hit regions, and get them back when it recovers. */
const watchdog: Scenario = async (page, _args, config) => {
  const failures: string[] = [];
  await park();
  await page.switchTo('desktop');
  await sleep(300);
  const onBlob = centre(page.parts().blob);
  const read = async (label: string): Promise<ProbeReading> => {
    const r = await invoke<ProbeReading[]>('spike_probe', { points: [{ label, ...onBlob }] });
    await park();
    return r[0] as ProbeReading;
  };
  const before = await status();
  const healthy = await read('healthy page');
  let events = 0;
  const off = shell.on('watchdog', () => {
    events++;
  });

  const quiet = shell as unknown as { stopHeartbeat(): void; startHeartbeat(): void };
  quiet.stopHeartbeat();
  const silentFrom = performance.now();
  let trippedAfter = -1;
  while (performance.now() - silentFrom < 12000) {
    await sleep(250);
    if ((await status()).regionsLost) {
      trippedAfter = performance.now() - silentFrom;
      break;
    }
  }
  const tripped = await status();
  const silent = await read('silent page');

  quiet.startHeartbeat();
  await sleep(700);
  const recovered = await status();
  const alive = await read('recovered page');
  off();

  const checks = {
    caughtWhileHealthy: !healthy.styleClickThrough,
    tripped: trippedAfter > 0,
    regionsDropped: tripped.regions === 0 && tripped.regionsLost,
    throughWhileSilent: silent.styleClickThrough && (config.cloaked === true || !silent.hitIsDoozer),
    eventSent: events === 1,
    regionsRestored: recovered.regions === before.regions && !recovered.regionsLost,
    caughtAgain: !alive.styleClickThrough,
    countedOnce: recovered.stats.watchdogTrips - before.stats.watchdogTrips === 1,
  };
  for (const [name, ok] of Object.entries(checks)) if (!ok) failures.push(name);
  await page.switchTo('pill');
  return { failures, trippedAfterMs: Math.round(trippedAfter), checks };
};

/** Break the window style on purpose; the tracker has to put it right on its own. */
const repair: Scenario = async (page) => {
  const failures: string[] = [];
  await park();
  await page.switchTo('desktop');
  await sleep(1800); // let the tracker fall back to its slow, resting rate: the worst case
  const before = await status();
  const times: number[] = [];
  for (let i = 0; i < 6; i++) {
    await invoke('spike_clobber_style');
    const t0 = performance.now();
    let fixed = -1;
    while (performance.now() - t0 < 2000) {
      const s = await status();
      if (s.styleClickThrough && s.styleNoActivate && s.styleToolWindow) {
        fixed = performance.now() - t0;
        break;
      }
      await sleep(4);
    }
    if (fixed < 0) failures.push(`break ${i + 1}: never repaired`);
    else times.push(fixed);
    await sleep(400 + i * 130);
  }
  const after = await status();
  const repairs = after.stats.styleRepairs - before.stats.styleRepairs;
  if (repairs !== 6) failures.push(`expected 6 repairs, counted ${repairs}`);
  await page.switchTo('pill');
  return { failures, repairs, repairedWithinMs: stats(times) };
};

/** Nothing the shell does on its own may take keyboard focus. */
const focus: Scenario = async (page) => {
  const failures: string[] = [];
  await park();
  const start = await status();
  const seen: { step: string; foreground: number; cls: string; doozer: boolean }[] = [];
  const check = async (step: string): Promise<void> => {
    const s = await status();
    seen.push({ step, foreground: s.foreground, cls: s.foregroundClass, doozer: s.isForeground });
    if (s.isForeground) failures.push(`${step}: Doozer has keyboard focus`);
  };
  await check('start');
  for (const v of VIEW_ORDER) {
    await page.switchTo(v);
    await sleep(150);
    await check(`switched to ${v}`);
  }
  await shell.setVisible(false);
  await sleep(250);
  const hidden = await status();
  if (hidden.visible) failures.push('hide did not hide the window');
  await check('hidden');
  // Does the page know it is hidden (and so stop animating)? Give it a moment to notice.
  await sleep(1500);
  const pageWhileHidden = document.visibilityState;
  await shell.setVisible(true);
  await sleep(400);
  const pageWhenShown = document.visibilityState;
  const shown = await status();
  if (!shown.visible) failures.push('show did not show the window');
  await check('shown again');
  await shell.setAlwaysOnTop(false);
  await sleep(120);
  await shell.setAlwaysOnTop(true);
  await check('always-on-top toggled');
  await shell.setFocusable(true);
  await sleep(120);
  const focusable = await status();
  if (focusable.styleNoActivate) failures.push('setFocusable(true) left the no-activate style on');
  await check('made focusable');
  await shell.setFocusable(false);
  await sleep(120);
  const end = await status();
  if (!end.styleNoActivate) failures.push('setFocusable(false) did not restore the no-activate style');
  await page.switchTo('pill');
  return {
    failures,
    // If the person at the machine switched apps during the run this is true through no fault of ours.
    foregroundHandleChanged: seen.some((s) => s.foreground !== start.foreground),
    neverDoozer: seen.every((s) => !s.doozer),
    styles: { toolWindow: end.styleToolWindow, noActivate: end.styleNoActivate, layeredAtRest: end.styleLayered },
    pageVisibility: { whileHidden: pageWhileHidden, whenShownAgain: pageWhenShown },
    fullscreenInFront: end.fullscreenInFront,
    seen,
  };
};

/** Sit in one view doing nothing, for the idle-cost measurement. Never finishes. */
const idle: Scenario = async (page, args) => {
  await page.switchTo((args.view as ViewId | undefined) ?? 'pill');
  page.setBreathing(args.breathe === true);
  if (args.inject === true) await park();
  await invoke('spike_report', { name: 'idle-ready.json', json: JSON.stringify({ ready: true, at: Date.now(), status: await status() }) });
  return new Promise(() => undefined);
};

/** Save as fast as possible until killed from outside. */
const saveLoop: Scenario = async (_page, args) => {
  const bytes = Number(args.bytes ?? 4096);
  const loaded = await shell.load();
  let generation = 0;
  if (loaded.data) {
    try {
      generation = Number((JSON.parse(loaded.data) as { gen?: number }).gen ?? 0);
    } catch {
      /* start again from zero */
    }
  }
  for (;;) {
    generation++;
    const fill = String.fromCharCode(97 + (generation % 26)).repeat(bytes);
    await shell.save(JSON.stringify({ gen: generation, len: bytes, fill, end: generation }));
    await invoke('spike_report', { name: 'save-loop-progress.json', json: JSON.stringify({ confirmed: generation }) });
  }
};

/** After a kill: is what is on disk complete? */
const saveCheck: Scenario = async () => {
  const loaded = await shell.load();
  type Doc = { gen?: number; len?: number; fill?: string; end?: number };
  let doc: Doc | null = null;
  let parseError: string | null = null;
  try {
    doc = loaded.data ? (JSON.parse(loaded.data) as Doc) : null;
  } catch (error) {
    parseError = String(error);
  }
  const d: Doc = doc ?? {};
  const letter = d.gen !== undefined ? String.fromCharCode(97 + (d.gen % 26)) : '';
  const complete = doc !== null && d.gen === d.end && typeof d.fill === 'string' && d.fill.length === d.len && d.fill === letter.repeat(d.len ?? 0);
  return { source: loaded.source, problem: loaded.problem, generation: d.gen ?? null, complete, parseError };
};

/**
 * The one test that uses the real pointer: hover, click Doozer, click beside it.
 * The native side refuses unless the machine has been idle and nothing fullscreen is in front.
 */
const real: Scenario = async (page, args) => {
  await page.switchTo('island');
  await sleep(300);
  const info = (await shell.windowInfo())!;
  const patch = { x: info.x - 40, y: info.y - 40, w: info.width + 80, h: info.height + 80 };
  const label = { x: patch.x, y: patch.y - 48, w: 620, h: 40 };
  await invoke('spike_backdrop', { rects: [patch, label] });
  await sleep(400);
  const { blob } = page.parts();
  const onBlob = centre(blob);
  const beside = blankPoint(page.regions());
  const before = page.counters();
  const result = await invoke<{ ran: boolean; why?: string; aborted?: string | null; steps?: Record<string, unknown>[] }>('spike_real_input', {
    steps: [
      { label: 'hover Doozer', ...onBlob },
      { label: 'click Doozer', ...onBlob, click: true },
      { label: 'click beside Doozer', ...beside, click: true },
    ],
    minIdleMs: Number(args.minIdleMs ?? 45000),
  });
  await sleep(200);
  const after = page.counters();
  await park();
  await invoke('spike_backdrop', { rects: null });
  await page.switchTo('pill');
  return {
    ...result,
    page: { hoverEvents: after.enters - before.enters, moveEvents: after.moves - before.moves, clicks: after.clicks - before.clicks },
  };
};

/** The colour of one pixel of the control chip, straight off the screen, plus where Doozer sits among the windows. */
async function lookAtChip(page: TestPage): Promise<{ colour: number[]; order: unknown }> {
  const info = (await shell.windowInfo())!;
  // The chip is one flat colour and its top-left padding has no text in it.
  const box = page.parts().chip.getBoundingClientRect();
  const point = [Math.round(info.x + (box.left + 5) * info.scale), Math.round(info.y + (box.top + 4) * info.scale)];
  const look = await invoke<{ colours: number[][]; order: unknown }>('spike_look', { points: [point] });
  return { colour: look.colours[0] ?? [], order: look.order };
}

const sameColour = (a: number[], b: number[]): boolean => a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - (b[i] ?? 999)) <= 10);

/**
 * Is the view really on screen? No backdrop or filming needed: the chip's colour
 * is read off the screen and compared with what that spot looks like when the
 * view is known to be showing and known to be hidden. (Measured, not assumed,
 * so it still works when something is dimming or tinting the screen.)
 */
async function makeScreenCheck(page: TestPage): Promise<{ usable: boolean; shown: () => Promise<{ shown: boolean; colour: number[]; order: unknown }> }> {
  const visible = (await lookAtChip(page)).colour;
  page.stage.style.visibility = 'hidden';
  await sleep(120);
  const hidden = (await lookAtChip(page)).colour;
  page.stage.style.visibility = 'visible';
  await sleep(120);
  return {
    // If the spot looks the same either way, the check cannot tell and says so.
    usable: !sameColour(visible, hidden),
    async shown() {
      const look = await lookAtChip(page);
      return { shown: sameColour(look.colour, visible), colour: look.colour, order: look.order };
    },
  };
}

/**
 * Re-apply the same view over and over (the window does not move or resize) and
 * check that it is still on screen afterwards, under four conditions: on its
 * own, with an opaque always-on-top window behind it, while the screen is being
 * recorded, and both.
 */
const reapply: Scenario = async (page, args) => {
  const failures: string[] = [];
  await park();
  const view = (args.view as ViewId | undefined) ?? 'pill';
  const repeats = Number(args.repeats ?? 6);
  const info = (await page.switchTo(view)).info;
  await sleep(400);
  const area = { x: info.x - 20, y: info.y, w: info.width + 40, h: info.height + 20 };
  const rounds: unknown[] = [];
  const all = [
    { name: 'on its own', backdrop: false, record: false },
    { name: 'opaque topmost window behind', backdrop: true, record: false },
    { name: 'screen being recorded', backdrop: false, record: true },
    { name: 'recorded, with window behind', backdrop: true, record: true },
  ];
  const wanted = args.conditions as string[] | undefined;
  for (const c of all.filter((x) => !wanted || wanted.includes(x.name))) {
    if (c.backdrop) await invoke('spike_backdrop', { rects: [area] });
    if (c.record) await invoke('spike_capture_start', { rects: [area], name: 'reapply' });
    await sleep(600);
    const check = await makeScreenCheck(page);
    let vanished = 0;
    const gone: number[] = [];
    for (let i = 0; i < repeats; i++) {
      await page.switchTo(view);
      await sleep(70);
      const soon = await check.shown();
      await sleep(Number(args.dwell ?? 300));
      const later = await check.shown();
      if (!soon.shown || !later.shown) {
        vanished++;
        gone.push(i + 1);
      }
    }
    if (c.record) await invoke('spike_capture_stop');
    if (c.backdrop) await invoke('spike_backdrop', { rects: null });
    await sleep(300);
    if (!check.usable) failures.push(`${c.name}: could not tell shown from hidden at the sampled spot`);
    if (vanished) failures.push(`${c.name}: gone from the screen after ${vanished} of ${repeats} re-applies`);
    rounds.push({ condition: c.name, checkUsable: check.usable, repeats, vanished, goneAfterReapplyNumber: gone });
  }
  return { failures, view, rounds };
};

/**
 * Replays, many times, the exact opening of the filmed run in which a view was
 * once seen to vanish: come back from the overlay to the pill, put the backdrop
 * up, start recording, then re-apply the pill. After each replay it looks at the
 * screen and at the window stacking order, so that if the view is gone again it
 * is known whether it was hidden behind the backdrop or simply not drawn.
 */
const prologue: Scenario = async (page, args) => {
  const failures: string[] = [];
  const repeats = Number(args.repeats ?? 20);
  await park();
  page.setPillAnchor('top-right');
  const info = (await page.switchTo('pill')).info;
  await sleep(300);
  const work = info.monitor.work;
  const strip = { x: info.x - 60, y: work.y, w: work.x + work.w - (info.x - 60), h: work.h };
  // What the sampled spot looks like with the view showing and with it hidden, backdrop in place.
  await invoke('spike_backdrop', { rects: [strip] });
  await sleep(400);
  const check = await makeScreenCheck(page);
  await invoke('spike_backdrop', { rects: null });
  await sleep(300);
  const gone: unknown[] = [];
  for (let i = 1; i <= repeats; i++) {
    await page.switchTo('desktop');
    await sleep(150);
    await page.switchTo('pill');
    await invoke('spike_backdrop', { rects: [strip, { x: strip.x - 640, y: work.y + 12, w: 620, h: 40 }] });
    await sleep(500);
    await invoke('spike_capture_start', { rects: [strip], name: 'prologue' });
    await sleep(300);
    const before = await check.shown();
    await page.switchTo('pill');
    await sleep(80);
    const soon = await check.shown();
    await sleep(260);
    const later = await check.shown();
    const pageVisibility = document.visibilityState;
    await invoke('spike_capture_stop');
    await invoke('spike_backdrop', { rects: null });
    await sleep(250);
    if (!before.shown || !soon.shown || !later.shown) {
      gone.push({ replay: i, before: before.shown, soon: soon.shown, later: later.shown, colour: later.colour, order: later.order, pageVisibility });
    }
  }
  page.setPillAnchor('top-center');
  await page.switchTo('pill');
  if (!check.usable) failures.push('could not tell shown from hidden at the sampled spot');
  if (gone.length) failures.push(`the view was missing in ${gone.length} of ${repeats} replays`);
  return { failures, repeats, checkUsable: check.usable, gone };
};

/**
 * Be the camera, nothing else: put the backdrop where a freshly started Doozer
 * will appear, film it for a while, and report every distinct picture seen.
 * Run this in a cloaked copy of the app, then start a normal copy beside it.
 */
const camera: Scenario = async (page, args) => {
  await park();
  const info = (await page.switchTo('pill')).info;
  const pad = 40;
  // `whole`: film the entire work area, to catch a window flashing up anywhere at all.
  const rect = args.whole === true ? info.monitor.work : { x: info.x - pad, y: info.y, w: info.width + pad * 2, h: info.height + pad * 2 };
  const label = { x: rect.x, y: rect.y + rect.h + 8, w: 620, h: 40 };
  await invoke('spike_backdrop', { rects: args.whole === true ? [rect] : [rect, label] });
  await sleep(400);
  await invoke('spike_capture_start', { rects: [rect], name: String(args.tag ?? 'camera') });
  await invoke('spike_report', { name: 'camera-ready.json', json: JSON.stringify({ ready: true, at: Date.now() }) });
  await sleep(Number(args.seconds ?? 8) * 1000);
  const film = await invoke<{ frames: { t: number; unseen: number; rects: { black: number; white: number; other: number; bbox: number[] | null }[] }[] }>('spike_capture_stop');
  await invoke('spike_backdrop', { rects: null });
  // Every distinct picture, in order, with how long it stayed.
  const pictures: { atMs: number; forMs: number; outline: string; pixels: number; black: number; white: number }[] = [];
  const t0 = film.frames[0]?.t ?? 0;
  for (const f of film.frames) {
    const r = f.rects[0];
    if (!r) continue;
    const outline = r.bbox ? r.bbox.join(',') : 'empty';
    const last = pictures[pictures.length - 1];
    if (last && last.outline === outline && last.pixels === r.other) continue;
    if (last) last.forMs = Math.round((f.t - t0 - last.atMs) * 10) / 10;
    pictures.push({ atMs: Math.round((f.t - t0) * 10) / 10, forMs: -1, outline, pixels: r.other, black: r.black, white: r.white });
  }
  return { failures: [], rect, pictures, film: { ...film, frames: undefined } };
};

/**
 * A carry whose mouse-up never arrives. In the Desktop view the page is told a
 * press has started on Doozer and is carrying it; then the button comes up, as
 * far as Windows is concerned, but no `pointerup` is ever delivered to the page.
 * The shell's `pointer-released` has to end the carry.
 *
 * `{"control":true}` runs it with the page ignoring that signal. The carry must
 * then stay stuck, which proves the mouse-up really never arrived and that the
 * signal is what ends it.
 */
const release: Scenario = async (page, args) => {
  const failures: string[] = [];
  const control = args.control === true;
  page.setReleaseBackstop(!control);
  await park();
  await page.switchTo('desktop');
  await sleep(300);
  const { blob } = page.parts();
  const start = centre(blob);
  const events: ({ x: number; y: number } | null)[] = [];
  const off = shell.on('pointer-released', (at) => events.push(at));
  const pointer = (type: string, at: Point, buttons: number): void => {
    blob.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 77, isPrimary: true, button: 0, buttons, clientX: at.x, clientY: at.y }));
  };

  // The press: Windows sees the button go down on Doozer, and so does the page.
  await invoke('spike_inject', { cursor: { ...start, down: false } });
  await sleep(140);
  await invoke('spike_inject', { cursor: { ...start, down: true } });
  pointer('pointerdown', start, 1);
  await sleep(120);
  const pressed = await status();
  const carriedAtPress = blob.classList.contains('carried');

  // Carry it up and to the left, fast. The cursor runs ahead of what the page hears.
  let at = start;
  let leftRegionWhileHeld = 0;
  for (let i = 1; i <= 12; i++) {
    at = { x: start.x - 55 * i, y: start.y - 38 * i };
    await invoke('spike_inject', { cursor: { ...at, down: true } });
    if (i % 3 === 0) pointer('pointermove', { x: at.x + 40, y: at.y + 30 }, 1);
    await sleep(16);
    if (i % 4 === 0) {
      const s = await status();
      if (s.styleClickThrough || !s.catching || !s.holding) leftRegionWhileHeld++;
    }
  }
  const carriedMidAir = blob.classList.contains('carried');
  const eventsWhileHeld = events.length;

  // The button comes up, far from where it went down. The page is told nothing.
  await invoke('spike_inject', { cursor: { ...at, down: false } });
  const t0 = performance.now();
  while (blob.classList.contains('carried') && performance.now() - t0 < 1500) await sleep(4);
  const endedAfterMs = blob.classList.contains('carried') ? -1 : performance.now() - t0;
  if (control) {
    // Stuck, as it should be without the backstop. Put things right and stop here.
    const shellSaidSo = events.length;
    pointer('pointerup', at, 0);
    page.setReleaseBackstop(true);
    await park();
    off();
    await sleep(450);
    await page.switchTo('pill');
    if (endedAfterMs >= 0) failures.push('the carry ended although the page ignores the shell: something else ended it, so the main run proves nothing');
    if (shellSaidSo !== 1) failures.push(`the shell sent ${shellSaidSo} release events, expected 1`);
    return { failures, control: true, carryStayedStuck: endedAfterMs < 0, shellReleaseEvents: shellSaidSo };
  }
  await sleep(450); // the blob floats back down
  const landed = await status();
  await park();
  await sleep(200);
  const rested = await status();
  const onTheGround = Math.abs(blob.offsetTop + blob.offsetHeight - window.innerHeight) <= 1;

  // A press that starts beside Doozer is another application's business: the page hears nothing.
  const beside = blankPoint(page.regions());
  const before = events.length;
  await invoke('spike_inject', { cursor: { ...beside, down: false } });
  await sleep(140);
  await invoke('spike_inject', { cursor: { ...beside, down: true } });
  await sleep(140);
  await invoke('spike_inject', { cursor: { ...beside, down: false } });
  await sleep(200);
  const strayEvents = events.length - before;
  await park();
  off();

  const reported = events[0] ?? null;
  const checks = {
    pressWentToThePage: pressed.holding && pressed.catching && carriedAtPress,
    stillCarriedAndCaughtWhileHeld: carriedMidAir && leftRegionWhileHeld === 0,
    nothingSentWhileHeld: eventsWhileHeld === 0,
    carryEndedWithoutAMouseUp: endedAfterMs >= 0,
    toldExactlyOnce: before === 1,
    toldWhereItWasReleased: reported !== null && Math.abs(reported.x - at.x) <= 1 && Math.abs(reported.y - at.y) <= 1,
    doozerBackOnTheGround: onTheGround,
    notHoldingAfterwards: !landed.holding && !rested.holding,
    clickThroughAgainAtRest: rested.styleClickThrough && !rested.catching,
    pressElsewhereNotReported: strayEvents === 0,
  };
  for (const [name, ok] of Object.entries(checks)) if (!ok) failures.push(name);
  await page.switchTo('pill');
  return { failures, endedAfterMs: Math.round(endedAfterMs * 10) / 10, releasedAt: reported, expectedAt: at, checks };
};

/** The native menu (tray and right-click share it): view items ask the page to switch, ticks follow. */
const menu: Scenario = async (page) => {
  const failures: string[] = [];
  type MenuState = { ticked: string[]; trayIconExists: boolean };
  await page.switchTo('pill');
  const start = await invoke<MenuState>('spike_menu', { id: null });
  if (!start.trayIconExists) failures.push('no tray icon');
  if (start.ticked.join() !== 'pill') failures.push(`at start the menu ticks [${start.ticked.join()}], expected [pill]`);
  const steps: unknown[] = [];
  for (const v of ['room', 'island', 'desktop', 'pill'] as const) {
    await invoke('spike_menu', { id: `view:${v}` });
    const t0 = performance.now();
    while (page.current() !== v && performance.now() - t0 < 3000) await sleep(20);
    await sleep(150);
    const state = await invoke<MenuState>('spike_menu', { id: null });
    const s = await status();
    const ok = page.current() === v && s.view === v && state.ticked.join() === v;
    if (!ok) failures.push(`menu item ${v}: page shows ${page.current()}, shell says ${s.view}, menu ticks [${state.ticked.join()}]`);
    steps.push({ asked: v, page: page.current(), shell: s.view, kind: s.kind, ticked: state.ticked });
  }
  let settings = 0;
  const off = shell.on('settings-requested', () => {
    settings++;
  });
  await invoke('spike_menu', { id: 'settings' });
  await sleep(150);
  off();
  if (settings !== 1) failures.push(`Settings item: ${settings} events, expected 1`);
  return { failures, trayIconExists: start.trayIconExists, steps, settingsEvents: settings };
};

const SCENARIOS: Record<string, Scenario> = { cycle, drag, release, watchdog, repair, focus, menu, reapply, prologue, camera, idle, 'save-loop': saveLoop, 'save-check': saveCheck, real };

export async function runSpikeScenarios(page: TestPage): Promise<void> {
  if (!shell.native) return;
  const config = await invoke<SpikeConfig>('spike_config');
  if (!config.enabled || !config.scenario) return;
  const args = config.args ?? {};
  const names = config.scenario.split(',').map((s) => s.trim()).filter(Boolean);
  const report: Record<string, unknown> = { config, startedAt: new Date().toISOString(), scenarios: {} };
  const results = report.scenarios as Record<string, unknown>;
  for (const name of names) {
    const run = SCENARIOS[name];
    try {
      results[name] = run ? await run(page, (args[name] as Record<string, unknown> | undefined) ?? args, config) : { error: 'unknown scenario' };
    } catch (error) {
      results[name] = { error: String(error), stack: error instanceof Error ? error.stack : undefined };
    }
  }
  report.finishedAt = new Date().toISOString();
  report.endStatus = await status();
  await invoke('spike_inject', { cursor: null });
  await invoke('spike_report', { name: `${String(args.tag ?? names.join('+'))}.json`, json: JSON.stringify(report, null, 1) });
  if (args.exit === false) return;
  // Quit through the native menu item when asked, to prove that Quit really quits.
  if (args.quitVia === 'menu') await invoke('spike_menu', { id: 'quit' });
  else await shell.quit();
}
