// Scripted runs for Phase 10 (docs/polish-checks.md): the measurements that say what each
// view costs at rest and while Doozer moves, and the checks that go with the changes of
// that phase. Started like the other runs: a build made with `--features spike`,
// DOOZER_SPIKE set to a name from the table at the bottom. A normal build never loads
// this file.
//
// As everywhere, the real pointer is never moved: the shell is fed a pretend cursor, and
// with DOOZER_SPIKE_CLOAK=1 nothing appears on screen.

import { invoke } from '@tauri-apps/api/core';
import type { ViewId } from '../core/contract';
import { frames } from '../frames';
import { UI_SCALE } from '../host/host';
import type { Region } from '../shell';
import type { App } from '../main';
import { addPolicyFailures, scenarioNames, type TestRun } from './config';

type Point = { x: number; y: number };
type Result = { failures: string[] } & Record<string, unknown>;
type Scenario = (app: App, args: Record<string, unknown>) => Promise<Result>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const report = (name: string, data: unknown): Promise<unknown> => invoke('spike_report', { name, json: JSON.stringify(data) });
/** Far outside every monitor: the pretend cursor's resting place. */
const PARKED = { x: -30000, y: -30000, screen: true, down: false };
const park = (): Promise<unknown> => invoke('spike_inject', { cursor: PARKED });
const cursor = (at: Point, down: boolean): Promise<unknown> => invoke('spike_inject', { cursor: { ...at, down } });

const centre = (node: Element): Point => {
  const box = node.getBoundingClientRect();
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
};

function pointer(target: Element, type: string, at: Point, buttons: number): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 93, isPrimary: true, pointerType: 'mouse', button: 0, buttons, clientX: at.x, clientY: at.y,
  }));
}

async function waitFor(test: () => boolean, limitMs: number, stepMs = 50): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < limitMs) {
    if (test()) return true;
    await sleep(stepMs);
  }
  return test();
}

const VIEWS: readonly ViewId[] = ['pill', 'room', 'island', 'desktop'];

/** Into a view, as the host does it, with nothing of a first run left to play. */
async function enter(app: App, view: ViewId): Promise<void> {
  const { brain, host } = app;
  // Scripted runs must not be hidden by whatever game happens to be in front.
  if (brain.settings.tuckAwayInFullscreen) brain.setSetting('tuckAwayInFullscreen', false);
  if (!brain.settings.soundAsked) brain.setSetting('soundAsked', true);
  if (host.current() === 'pill') await waitFor(() => !app.pill.snapshot()?.hatching, 16_000);
  host.services.welcomed();
  if (host.current() !== view) {
    await host.switchTo(view);
    await host.settled();
  }
  await sleep(600);
  await park();
}

/** The element a pointer rests on when somebody is looking at Doozer in this view. */
function watchTarget(app: App, view: ViewId): { target: HTMLElement; at: () => Point } | null {
  if (view === 'pill') {
    const parts = app.pill.parts();
    return parts ? { target: parts.pill, at: () => centre(parts.pill) } : null;
  }
  if (view === 'room') {
    const parts = app.room.parts();
    if (!parts) return null;
    return {
      target: parts.scene,
      at: () => {
        const box = parts.scene.getBoundingClientRect();
        return { x: Math.round(box.left + box.width * 0.5), y: Math.round(box.top + box.height * 0.62) };
      },
    };
  }
  if (view === 'island') {
    const parts = app.island.parts();
    if (!parts) return null;
    return {
      target: parts.touch,
      at: () => {
        const s = app.island.snapshot();
        return s ? { x: Math.round(s.doozer.screen.x), y: Math.round(s.doozer.screen.y) } : centre(parts.touch);
      },
    };
  }
  const parts = app.desktop.parts();
  return parts ? { target: parts.hit, at: () => centre(parts.hit) } : null;
}

/** One word for what Doozer is up to, and whether it is animating, in whichever view is showing. */
function activity(app: App, view: ViewId): { lively: boolean; walking: boolean; scene: string | null } {
  if (view === 'pill') {
    const s = app.pill.snapshot();
    return { lively: !!s?.lively, walking: false, scene: null };
  }
  if (view === 'room') {
    const s = app.room.snapshot();
    return { lively: !!s?.lively, walking: s?.pose === 'walk' || s?.pose === 'trot', scene: s?.scene ?? null };
  }
  if (view === 'island') {
    const s = app.island.snapshot();
    return { lively: !!s?.lively || !!s?.drawing, walking: !!s?.moving, scene: s?.scene ?? null };
  }
  const s = app.desktop.snapshot();
  return { lively: !!s?.lively, walking: s?.pose === 'walk' || s?.pose === 'trot', scene: s?.scene ?? null };
}

/**
 * Sit in one view in one state for as long as the app runs, for scripts/measure-idle.ps1
 * and scripts/trace-frames.mjs to sample. Never finishes.
 *
 *   view   pill | room | island | desktop
 *   state  rest      nothing happening, nobody there (the everyday state)
 *          focus     a focus session counting down
 *          asleep    Doozer asleep
 *          watched   the pretend pointer rests on Doozer the whole time, so it stays lively
 *          walk      Desktop only: one stroll after another, with no rest between
 *          card      the Card left open
 *   pace   Desktop only: still | calm | lively
 *   hour   Room only: pretend it is this hour of the day
 *   style  a stylesheet to add, for experiments
 *   fps    draw at this many frames a second whoever is there
 *   script the body of a function of `app`, run once the state is set up (experiments)
 *   pacing false: leave every animation to the browser, as before Phase 10
 */
const hold: Scenario = async (app, args) => {
  const view = VIEWS.find((v) => v === args.view) ?? 'pill';
  const state = typeof args.state === 'string' ? args.state : 'rest';
  const { brain } = app;
  // (`pacing: false` is read at start-up, in main.ts: the clock is then never attached.)
  if (typeof args.fps === 'number') frames.setRates({ ambient: args.fps, attended: args.fps });
  if (view === 'desktop') {
    const pace = (['still', 'calm', 'lively'] as const).find((p) => p === args.pace) ?? 'calm';
    brain.setSetting('desktopActivity', pace);
  }
  if (brain.settings.reduceMotion !== 'off' && args.reduceMotion !== true) brain.setSetting('reduceMotion', 'off');
  if (args.reduceMotion === true) brain.setSetting('reduceMotion', 'on');
  await enter(app, view);
  brain.debug?.setNeeds({ tummy: 88, fun: 86, energy: 88, clean: 88 });
  if (view === 'room' && args.bowl !== false) brain.fillBowl();
  if (view === 'room' && typeof args.hour === 'number') app.room.setSkyHour(args.hour);
  if (typeof args.style === 'string') {
    const sheet = document.createElement('style');
    sheet.textContent = args.style;
    document.head.append(sheet);
  }
  if (state === 'focus') brain.startFocus();
  if (state === 'asleep') { brain.debug?.setNeeds({ energy: 40 }); brain.sleep(); }
  if (state === 'card') {
    if (view === 'pill') app.pill.setOpen('card');
    else if (view === 'room') app.room.setOpen('card');
    else if (view === 'island') app.island.setOpen('card');
    else app.desktop.setOpen('card');
  }
  await park();
  await sleep(1500);
  // An experiment written on the command line: a function body given `app`. Test builds only.
  if (typeof args.script === 'string') {
    try { (new Function('app', args.script) as (app: App) => void)(app); } catch (error) { await report('hold-script-error.json', { error: String(error) }); }
  }

  if (state === 'watched') {
    const watch = watchTarget(app, view);
    if (watch) {
      await cursor(watch.at(), false);
      setInterval(() => {
        const at = watch.at();
        void cursor(at, false);
        pointer(watch.target, 'pointermove', at, 0);
      }, 300);
    }
  }
  if (state === 'walk' && view === 'desktop') {
    // One stroll after another: as soon as Doozer is standing still it is sent off again.
    setInterval(() => {
      const s = app.desktop.snapshot();
      if (s && s.state === 'idle' && s.open === 'none') app.desktop.act('stroll');
    }, 120);
  }

  // What Doozer was doing while it was measured, so the numbers can be read against it.
  const started = Date.now();
  let samples = 0;
  let lively = 0;
  let walking = 0;
  const scenes: Record<string, number> = {};
  let lastScene: string | null = null;
  // Every ten seconds: how many ticks the frame clock took, at what rate, and Doozer's mood.
  const history: Array<Record<string, unknown>> = [];
  let ticksBefore = frames.stats.ticks;
  setInterval(() => {
    const a = activity(app, view);
    samples++;
    if (a.lively) lively++;
    if (a.walking) walking++;
    if (a.scene && a.scene !== lastScene) scenes[a.scene] = (scenes[a.scene] ?? 0) + 1;
    lastScene = a.scene;
    if (samples % 20 === 0) {
      const stats = frames.stats;
      history.push({
        second: Math.round((Date.now() - started) / 1000), ticks: stats.ticks - ticksBefore, fps: stats.fps, moving: stats.moving,
        mood: brain.state.mood, animations: typeof document.getAnimations === 'function' ? document.getAnimations().length : 0,
      });
      ticksBefore = stats.ticks;
      if (history.length > 120) history.shift();
      void report('hold-activity.json', {
        view, state, seconds: Math.round((Date.now() - started) / 1000), samples,
        livelyShare: Math.round((lively / samples) * 1000) / 1000,
        walkingShare: Math.round((walking / samples) * 1000) / 1000,
        scenes,
        focus: brain.state.focus.status,
        frames: frames.stats,
        history,
        island: view === 'island' ? { frames: app.island.snapshot()?.frames, undrawn: app.island.snapshot()?.undrawn } : undefined,
        desktop: view === 'desktop' ? { scenes: app.desktop.snapshot()?.scenes, rescues: app.desktop.snapshot()?.rescues.length } : undefined,
      });
    }
  }, 500);
  await report('hold-ready.json', { ready: true, at: Date.now(), view, state, current: app.host.current() });
  return new Promise(() => undefined);
};

// ---- Reduce motion, in every view ----------------------------------------------------------

interface Status {
  bounds: { x: number; y: number; w: number; h: number } | null;
  scale: number;
  regions: number;
  catching: boolean;
  focusable: boolean;
  isForeground: boolean;
  foreground: number;
  styleNoActivate: boolean;
  userIdleMs: number;
  visible: boolean;
}
const status = (): Promise<Status> => invoke<Status>('shell_status');

/** Nothing temporary left in the view that is showing. */
function atRest(app: App, view: ViewId): boolean {
  if (view === 'pill') {
    const s = app.pill.snapshot();
    return !!s && !s.miniBusy && !s.stageBusy && s.emotes === 0 && !s.pressed && !s.gone && !s.hatching;
  }
  if (view === 'room') {
    const s = app.room.snapshot();
    return !!s && s.scene === null && !s.busy && s.emotes === 0 && s.props === 0 && !s.gone && s.station === s.desired;
  }
  if (view === 'island') {
    const s = app.island.snapshot();
    return !!s && s.scene === null && !s.busy && !s.moving && s.emotes === 0 && s.particles === 0 && !s.gone && !s.pressed;
  }
  const s = app.desktop.snapshot();
  return !!s && s.atRest && !s.busy && s.emotes === 0;
}

/**
 * What is animating in the page right now that reduced motion should not allow: anything
 * that loops, and anything longer than the short fade the kit keeps (0.12 s). Each is named
 * by what it is and what it is on.
 */
function movingNow(): string[] {
  const found: string[] = [];
  for (const animation of document.getAnimations()) {
    if (animation.playState === 'finished' || animation.playState === 'idle') continue;
    const effect = animation.effect as KeyframeEffect | null;
    const timing = effect?.getComputedTiming();
    const duration = Number(timing?.duration ?? 0);
    const endless = timing?.iterations === Infinity;
    if (!endless && !(duration > 200)) continue;
    const target = effect?.target as Element | null;
    // Held still by a resting Doozer: there, but not moving.
    if (endless && target?.closest('[data-live="0"]')) continue;
    // A fade is not motion: something that only changes how see-through it is travels nowhere.
    const changes = new Set<string>();
    for (const frame of effect?.getKeyframes() ?? []) {
      for (const key of Object.keys(frame)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(key)) changes.add(key);
    }
    if (!endless && changes.size > 0 && [...changes].every((key) => key === 'opacity' || key === 'visibility')) continue;
    const what = (animation as unknown as { animationName?: string }).animationName
      ?? (animation as unknown as { transitionProperty?: string }).transitionProperty ?? 'script';
    const where = target ? `${target.tagName.toLowerCase()}.${String(target.getAttribute('class') ?? '').split(' ').slice(0, 2).join('.')}` : '?';
    found.push(`${what} on ${where} (${endless ? 'loops' : `${Math.round(duration)} ms`})`);
  }
  return found;
}

/**
 * With Reduce motion on, every scene in every view: nothing loops, nothing springs,
 * nothing travels, and Doozer still gets where the scene ends. For each view and scene
 * the report lists anything that was caught animating, how many pictures the frame clock
 * drew, and whether the view came to rest.
 */
const motion: Scenario = async (app, args) => {
  const failures: string[] = [];
  const { brain } = app;
  const only = typeof args.view === 'string' ? [args.view as ViewId] : VIEWS;
  const views: Record<string, unknown> = {};
  brain.setSetting('reduceMotion', 'on');
  if (brain.settings.desktopActivity !== 'lively') brain.setSetting('desktopActivity', 'lively');

  for (const view of only) {
    await enter(app, view);
    const scenes: Record<string, unknown> = {};
    const play = async (name: string, start: () => void, ms: number): Promise<void> => {
      const caught = new Map<string, number>();
      const ticksBefore = frames.stats.ticks;
      const islandBefore = app.island.snapshot()?.frames ?? 0;
      // The Island's Doozer and ball are drawn in 3D, where no stylesheet can be asked what
      // is moving: watch where they are instead. Being put somewhere is one change; three
      // changes in a row is travelling.
      let lastPlace = '';
      let run = 0;
      let longestRun = 0;
      const watching = setInterval(() => {
        for (const m of movingNow()) caught.set(m, (caught.get(m) ?? 0) + 1);
        if (view !== 'island') return;
        const s = app.island.snapshot();
        if (!s) return;
        const r = (n: number): number => Math.round(n * 200) / 200;
        const place = `${r(s.doozer.x)},${r(s.doozer.z)},${r(s.doozer.y)},${r(s.doozer.stretch)}|${s.ball ? `${r(s.ball.x)},${r(s.ball.y)},${r(s.ball.z)}` : '-'}`;
        run = place !== lastPlace && lastPlace !== '' ? run + 1 : 0;
        longestRun = Math.max(longestRun, run);
        lastPlace = place;
      }, 40);
      start();
      await sleep(ms);
      const rested = await waitFor(() => atRest(app, view), 12_000, 100);
      clearInterval(watching);
      if (longestRun >= 3) caught.set(`Doozer or the ball travelling on the island (${longestRun} moves in a row)`, 1);
      const moving = [...caught.entries()].map(([what, samples]) => `${what} x${samples}`);
      scenes[name] = {
        moving, rested,
        ticks: frames.stats.ticks - ticksBefore,
        islandFrames: view === 'island' ? (app.island.snapshot()?.frames ?? 0) - islandBefore : undefined,
      };
      if (moving.length) failures.push(`${view}, ${name}: with motion reduced, still animating: ${moving.join('; ')}`);
      if (!rested) failures.push(`${view}, ${name}: did not come to rest`);
    };
    const ready = (): void => {
      if (brain.state.asleep) brain.wake();
      if (brain.state.focus.status !== 'idle') brain.stopFocus();
      brain.debug?.setNeeds({ tummy: 55, fun: 45, energy: 80, clean: 45 });
      brain.debug?.addTreats(3);
    };

    ready();
    await sleep(600);
    await play('at rest', () => undefined, 2500);
    await play('feed', () => { brain.feed(); }, 3500);
    await play('treat', () => { brain.giveTreat(); }, 3500);
    await play('play', () => { brain.play(); }, 4500);
    await play('wash', () => { brain.wash(); }, 4000);
    await play('a refusal', () => { brain.debug?.setNeeds({ tummy: 100 }); brain.feed(); }, 1800);
    await play('to sleep', () => { brain.debug?.setNeeds({ energy: 30 }); brain.sleep(); }, 3500);
    await play('waking', () => { brain.wake(); }, 3000);
    ready();
    await play('a session starts', () => { brain.startFocus(); }, 3500);
    await play('a session ends', () => { brain.debug?.finishFocusNow(); }, 4500);
    ready();
    await play('the Card opens and closes', () => {
      const open = (o: 'card' | 'none'): void => {
        if (view === 'pill') app.pill.setOpen(o); else if (view === 'room') app.room.setOpen(o);
        else if (view === 'island') app.island.setOpen(o); else app.desktop.setOpen(o);
      };
      open('card');
      setTimeout(() => open('none'), 1200);
    }, 2400);
    if (view === 'desktop') {
      // Left alone at the liveliest pace for a while: with motion reduced it does not wander.
      const x = app.desktop.snapshot()?.x;
      await play('left alone (Lively)', () => undefined, 9000);
      const moved = Math.abs((app.desktop.snapshot()?.x ?? 0) - (x ?? 0));
      scenes['left alone (Lively)'] = { ...(scenes['left alone (Lively)'] as object), movedPx: moved };
      if (moved > 1) failures.push(`desktop: with motion reduced Doozer wandered ${Math.round(moved)} px`);
    }
    views[view] = scenes;
  }
  brain.setSetting('reduceMotion', 'off');
  return { failures, views };
};

// ---- The keyboard way into the Card ----------------------------------------------------------

/**
 * The Card from the tray menu (no keyboard) and from the shortcut (with it). The shortcut
 * really takes the keyboard from whatever has it, so that part is only run when nobody has
 * touched the machine for a minute (`idleMs`, default 60 s); otherwise it is reported as
 * skipped, and is on the list for a person.
 */
const keyboard: Scenario = async (app, args) => {
  const failures: string[] = [];
  const view = VIEWS.find((v) => v === args.view) ?? 'pill';
  await enter(app, view);
  const isOpen = (): string | undefined =>
    (view === 'pill' ? app.pill.snapshot()?.open : view === 'room' ? app.room.snapshot()?.open : view === 'island' ? app.island.snapshot()?.open : app.desktop.snapshot()?.open);
  const close = (): void => {
    if (view === 'pill') app.pill.setOpen('none'); else if (view === 'room') app.room.setOpen('none');
    else if (view === 'island') app.island.setOpen('none'); else app.desktop.setOpen('none');
  };
  const check = (what: string, ok: boolean): void => { if (!ok) failures.push(`${view}: ${what}`); };

  // From the tray menu: the Card, and the keyboard stays where it was.
  const before = await status();
  const menu = await invoke<{ labels?: Record<string, string> }>('spike_menu', { id: 'card' });
  await waitFor(() => isOpen() === 'card', 2000);
  const fromMenu = await status();
  check('the tray menu opens the Card', isOpen() === 'card');
  check('...without making the window focusable', !fromMenu.focusable && fromMenu.styleNoActivate);
  check('...and without taking the keyboard', !fromMenu.isForeground);
  close();
  await sleep(500);

  // From the shortcut.
  const idleNeeded = typeof args.idleMs === 'number' ? args.idleMs : 60_000;
  const idle = (await status()).userIdleMs;
  const result: Record<string, unknown> = { view, idleMs: idle, menu, foregroundBefore: before.foreground };
  if (idle < idleNeeded) {
    result.shortcut = `skipped: the machine was in use (${Math.round(idle / 1000)} s since the last key or mouse movement, ${Math.round(idleNeeded / 1000)} s needed)`;
    return { failures, ...result };
  }
  const had = (await status()).foreground;
  const pressed = await invoke<{ foregroundBefore: number; foregroundAfter: number; ours: number }>('spike_shortcut');
  await waitFor(() => isOpen() === 'card', 2000);
  await sleep(250);
  const taken = await status();
  const active = document.activeElement as HTMLElement | null;
  check('the shortcut opens the Card', isOpen() === 'card');
  check('...the window has the keyboard', taken.isForeground && taken.focusable && !taken.styleNoActivate);
  check('...the page has the focus', document.hasFocus());
  check('...and the focus is on the Card\'s first action', active?.dataset.act === 'feed');
  // Escape, as the Card hears it from the keyboard.
  active?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await waitFor(() => isOpen() === 'none', 2000);
  await sleep(400);
  const after = await status();
  check('Escape closes the Card', isOpen() === 'none');
  check('...the window gives the keyboard up', !after.focusable && after.styleNoActivate && !after.isForeground);
  check('...to the window that had it', after.foreground === had || had === 0);
  // The shortcut with nothing to open (tucked away): the keyboard comes back by itself.
  return { failures, ...result, pressed, hadForeground: had, foregroundAfter: after.foreground, tookMsToReturn: undefined };
};

// ---- The interface size ------------------------------------------------------------------

const inRegion = (r: Region, x: number, y: number): boolean => {
  if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return false;
  const radius = Math.max(0, Math.min(r.r ?? 0, r.w / 2, r.h / 2));
  if (radius <= 0) return true;
  const cx = Math.min(Math.max(x, r.x + radius), r.x + r.w - radius);
  const cy = Math.min(Math.max(y, r.y + radius), r.y + r.h - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
};

/**
 * Every view at every interface size: the page is really drawn that much larger (its
 * pixel ratio), the window is that much larger and still exactly the page's size, and
 * the window catches the mouse on what the view reports and lets it through beside it.
 * With the Card open as well, since that is what the setting is mostly for.
 */
const scale: Scenario = async (app, args) => {
  const failures: string[] = [];
  const { brain, host } = app;
  const only = typeof args.view === 'string' ? [args.view as ViewId] : VIEWS;
  const steps: Array<keyof typeof UI_SCALE> = ['normal', 'large', 'larger', 'normal'];
  const seen: Record<string, unknown> = {};
  let baseRatio = 0;

  const probe = async (label: string, regions: readonly Region[]): Promise<{ on: number; off: number; wrong: string[] }> => {
    const wrong: string[] = [];
    let on = 0;
    let off = 0;
    const at = async (x: number, y: number, want: boolean, what: string): Promise<void> => {
      await cursor({ x, y }, false);
      await sleep(230);
      const got = (await status()).catching;
      if (want) on++; else off++;
      if (got !== want) wrong.push(`${label}: ${what} at (${Math.round(x)}, ${Math.round(y)}) should ${want ? 'catch' : 'let through'}`);
    };
    for (const [i, r] of regions.slice(0, 8).entries()) {
      await at(r.x + r.w / 2, r.y + r.h / 2, true, `the middle of region ${i}`);
      // Just outside its left and its top, unless another region is there.
      for (const [x, y, what] of [[r.x - 7, r.y + r.h / 2, 'left of'], [r.x + r.w / 2, r.y - 7, 'above']] as const) {
        if (x < 3 || y < 3 || x > innerWidth - 3 || y > innerHeight - 3) continue;
        if (regions.some((other) => inRegion(other, x, y))) continue;
        await at(x, y, false, `${what} region ${i}`);
      }
    }
    await park();
    await sleep(150);
    return { on, off, wrong };
  };

  for (const view of only) {
    await enter(view === 'desktop' ? app : app, view);
    if (view === 'desktop') brain.setSetting('desktopActivity', 'still');
    const rows: Array<Record<string, unknown>> = [];
    for (const step of steps) {
      brain.setSetting('uiScale', step);
      await sleep(50);
      await host.settled();
      await sleep(700);
      const native = await status();
      const ratio = window.devicePixelRatio;
      if (!baseRatio) baseRatio = ratio / UI_SCALE[step];
      const row: Record<string, unknown> = {
        step, factor: UI_SCALE[step], pixelRatio: Math.round(ratio * 1000) / 1000, nativeScale: Math.round(native.scale * 1000) / 1000,
        page: { w: innerWidth, h: innerHeight }, window: native.bounds ? { w: native.bounds.w, h: native.bounds.h } : null,
      };
      const here = `${view} at ${step}`;
      if (Math.abs(ratio - native.scale) > 0.011) failures.push(`${here}: the page is drawn at ${ratio} device pixels a pixel but the shell reckons with ${native.scale}`);
      if (Math.abs(ratio / baseRatio - UI_SCALE[step]) > 0.011) failures.push(`${here}: the page is ${Math.round((ratio / baseRatio) * 100)} % of its usual size, not ${Math.round(UI_SCALE[step] * 100)} %`);
      if (native.bounds && (Math.abs(innerWidth * ratio - native.bounds.w) > 2.5 || Math.abs(innerHeight * ratio - native.bounds.h) > 2.5)) {
        failures.push(`${here}: the page is ${innerWidth} x ${innerHeight} (${Math.round(innerWidth * ratio)} x ${Math.round(innerHeight * ratio)} device pixels) in a window of ${native.bounds.w} x ${native.bounds.h}`);
      }
      const regions = host.view()?.hitRegions() ?? [];
      if (native.regions !== regions.length) failures.push(`${here}: the view reports ${regions.length} regions and the shell holds ${native.regions}`);
      const rest = await probe(`${here}, at rest`, regions);
      failures.push(...rest.wrong);
      // The Card, which is what a larger interface is mostly for.
      if (view === 'pill') app.pill.setOpen('card'); else if (view === 'room') app.room.setOpen('card');
      else if (view === 'island') app.island.setOpen('card'); else app.desktop.setOpen('card');
      await sleep(900);
      const open = host.view()?.hitRegions() ?? [];
      const card = document.querySelector<HTMLElement>('.dzk-card[data-open="1"]');
      const box = card?.getBoundingClientRect();
      row.card = box ? { w: Math.round(box.width), h: Math.round(box.height), onPage: box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1 } : null;
      if (!box) failures.push(`${here}: the Card did not open`);
      else if (!(box.left >= -1 && box.right <= innerWidth + 1)) failures.push(`${here}: the Card does not fit across the window (${Math.round(box.left)} to ${Math.round(box.right)} of ${innerWidth})`);
      const withCard = await probe(`${here}, the Card open`, open);
      failures.push(...withCard.wrong);
      if (view === 'pill') app.pill.setOpen('none'); else if (view === 'room') app.room.setOpen('none');
      else if (view === 'island') app.island.setOpen('none'); else app.desktop.setOpen('none');
      await sleep(400);
      row.probes = { caught: rest.on + withCard.on, through: rest.off + withCard.off, wrong: rest.wrong.length + withCard.wrong.length };
      rows.push(row);
    }
    seen[view] = rows;
  }
  return { failures, views: seen };
};

export const POLISH_SCENARIOS: Record<string, Scenario> = {
  'app-polish-hold': hold,
  'app-polish-scale': scale,
  'app-polish-motion': motion,
  'app-polish-keyboard': keyboard,
};

export async function runPolishScenarios(app: App, run: TestRun): Promise<void> {
  const args = run.args ?? {};
  const names = scenarioNames(run);
  const whole: Record<string, unknown> = { run, startedAt: new Date().toISOString(), scenarios: {} };
  const results = whole.scenarios as Record<string, unknown>;
  for (const name of names) {
    const scenario = POLISH_SCENARIOS[name];
    try {
      results[name] = scenario ? await scenario(app, (args[name] as Record<string, unknown> | undefined) ?? args) : { failures: ['unknown scenario'] };
    } catch (error) {
      results[name] = { failures: [`threw: ${String(error)}`], stack: error instanceof Error ? error.stack : undefined };
    }
  }
  whole.finishedAt = new Date().toISOString();
  await invoke('spike_inject', { cursor: null });
  whole.policyViolations = addPolicyFailures(results);
  await report(`${String(args.tag ?? names.join('+'))}.json`, whole);
  if (args.exit === false) return;
  // Quit the way a person would, through the tray menu: the page is told, saves, and answers.
  await invoke('spike_menu', { id: 'quit' });
}
