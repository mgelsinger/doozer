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
import type { App } from '../main';
import { scenarioNames, type TestRun } from './config';

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

export const POLISH_SCENARIOS: Record<string, Scenario> = {
  'app-polish-hold': hold,
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
  await report(`${String(args.tag ?? names.join('+'))}.json`, whole);
  if (args.exit === false) return;
  // Quit the way a person would, through the tray menu: the page is told, saves, and answers.
  await invoke('spike_menu', { id: 'quit' });
}
