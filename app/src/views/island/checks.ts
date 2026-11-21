// Scripted runs of the Island view in the real window (Phase 8). What they showed is in
// docs/island-checks.md.
//
// Started like the app's other scripted runs (docs/shell-spike.md section 9): a build made
// with `--features spike`, DOOZER_SPIKE set to one or more names from the table at the
// bottom, DOOZER_SAVE_DIR pointing at a scratch folder. `scripts/run-island-checks.ps1`
// does all of that. A normal build never loads this file.
//
// The runs keep the real mouse out. A press is made twice over, as a real press is: the
// native cursor tracker is fed a pretend cursor and button (so the window's click-through
// state and the shell's `pointer-released` are the real ones), and the page is given the
// matching pointer events. Nothing moves the user's pointer, and with DOOZER_SPIKE_CLOAK=1
// nothing appears on screen either.

import { invoke } from '@tauri-apps/api/core';
import type { App } from '../../main';
import { shell } from '../../shell';
import { addPolicyFailures, scenarioNames, type TestRun } from '../../spike/config';
import type { IslandSnapshot, IslandView } from './index';
import { CONTEXT_LIMIT_MS } from './index';
import { islandLayout } from './layout';

interface Status {
  kind: string | null;
  view: string | null;
  bounds: { x: number; y: number; w: number; h: number } | null;
  regions: number;
  catching: boolean;
  styleClickThrough: boolean;
  styleNoActivate: boolean;
  visible: boolean;
  focusable: boolean;
  holding: boolean;
  isForeground: boolean;
  fullscreenInFront: boolean;
}

type Point = { x: number; y: number };
type Result = { failures: string[] } & Record<string, unknown>;
type Scenario = (app: App, args: Record<string, unknown>) => Promise<Result>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const status = (): Promise<Status> => invoke<Status>('shell_status');
/** Far outside every monitor: the pretend cursor's resting place. */
const PARKED = { x: -30000, y: -30000, screen: true, down: false };
const park = (): Promise<unknown> => invoke('spike_inject', { cursor: PARKED });
const cursor = (at: Point, down: boolean): Promise<unknown> => invoke('spike_inject', { cursor: { x: at.x, y: at.y, down } });
const report = (name: string, data: unknown): Promise<unknown> => invoke('spike_report', { name, json: typeof data === 'string' ? data : JSON.stringify(data, null, 1) });

/** Where a run has got to, written as it goes, so that a run that stalls says where. */
const trail: { at: number; step: string }[] = [];
const began = performance.now();
async function mark(step: string, more: Record<string, unknown> = {}): Promise<void> {
  trail.push({ at: Math.round(performance.now() - began), step });
  await report('island-trail.json', { trail, visibility: document.visibilityState, ...more }).catch(() => undefined);
}

/** Does the page get animation frames? A window nobody can see may get none. */
function framesIn(ms: number): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0;
    let running = true;
    const count = (): void => {
      if (!running) return;
      frames++;
      requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
    setTimeout(() => { running = false; resolve(frames); }, ms);
  });
}

async function waitFor(test: () => boolean, limitMs: number, stepMs = 25): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < limitMs) {
    if (test()) return true;
    await sleep(stepMs);
  }
  return test();
}

function pointer(target: EventTarget, type: string, at: Point, buttons: number, movement: Point = { x: 0, y: 0 }): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 91, isPrimary: true, pointerType: 'mouse', button: 0, buttons,
    clientX: at.x, clientY: at.y, movementX: movement.x, movementY: movement.y,
  }));
}

function check(failures: string[], checks: Record<string, boolean>): void {
  for (const [name, ok] of Object.entries(checks)) if (!ok) failures.push(name);
}

// ---- the view under test -------------------------------------------------------------

function pieces(app: App) {
  const island: IslandView = app.island;
  const parts = island.parts();
  if (!parts) throw new Error('the Island view is not mounted');
  const snap = (): IslandSnapshot => island.snapshot() as IslandSnapshot;
  /** Where Doozer's middle is in the window. */
  const onDoozer = (): Point => ({ x: Math.round(snap().doozer.screen.x), y: Math.round(snap().doozer.screen.y) });
  return { ...parts, island, snap, onDoozer };
}

/** Scripted runs must not be hidden by whatever game happens to be in front. */
async function stayAwake(app: App): Promise<void> {
  if (app.brain.settings.tuckAwayInFullscreen) app.brain.setSetting('tuckAwayInFullscreen', false);
  if (!app.brain.settings.soundAsked) app.brain.setSetting('soundAsked', true);
  if (app.brain.settings.reduceMotion !== 'off') app.brain.setSetting('reduceMotion', 'off');
  await app.host.settled();
  // A new pet hatches in the Pill first. Let it, so that the Pill is itself when Doozer comes back to it.
  if (app.host.current() === 'pill') await waitFor(() => app.pill.snapshot()?.hatching !== true && !app.host.services.needsWelcome(), 16_000, 50);
  await sleep(150);
}

/** Move Doozer to the Island (or back to the Pill) the way the host does it, and wait for the view. */
async function go(app: App, view: 'island' | 'pill'): Promise<boolean> {
  const ok = await app.host.switchTo(view);
  await app.host.settled();
  await sleep(450);
  return ok && app.host.current() === view;
}

/** Wait for everything temporary to end: nothing moving, no scene, no face, no emote, loop asleep. */
async function atRest(app: App, limitMs = 20_000): Promise<boolean> {
  const { snap } = pieces(app);
  return waitFor(() => {
    const s = snap();
    return !s.moving && !s.drawing && s.scene === null && !s.busy && !s.lively && !s.pressed && !s.hover && s.particles === 0 && s.emotes === 0 && !s.gone;
  }, limitMs, 100);
}

/** What "at rest, whole" means, as a list of what is wrong (empty when all is well). */
function wrongAtRest(app: App): string[] {
  const { snap, world, stage } = pieces(app);
  const s = snap();
  const wrong: string[] = [];
  const allowed = new Set(['blink', 'stir', 'wink', 'hover']);
  if (s.scene !== null) wrong.push(`scene ${s.scene}`);
  if (s.busy) wrong.push('busy');
  if (s.moving) wrong.push('moving');
  if (s.pressed) wrong.push('pressed');
  if (s.gone) wrong.push('gone');
  if (s.snack !== null) wrong.push(`snack ${s.snack}`);
  if (s.particles !== 0) wrong.push(`${s.particles} particles`);
  if (s.emotes !== 0) wrong.push(`${s.emotes} emotes`);
  if (world.travelling) wrong.push('travelling');
  if (world.rain !== 0 || world.duck !== 0) wrong.push('rain or duck');
  if (s.night !== (app.brain.state.asleep ? 1 : 0)) wrong.push(`night ${s.night}`);
  if (s.ball && !s.ball.resting) wrong.push('ball moving');
  if (s.doozer.y !== 0) wrong.push(`height ${s.doozer.y}`);
  if (Math.abs(s.doozer.stretch - (app.brain.state.asleep ? 0.82 : 1)) > 0.01) wrong.push(`stretch ${s.doozer.stretch}`);
  if (Math.hypot(s.doozer.x, s.doozer.z) > 1.3) wrong.push('off the island');
  if (Math.abs(stage.actor.body.pose.yaw) > 0.01) wrong.push('not facing front');
  if (!stage.actor.object.visible) wrong.push('invisible');
  if (s.showing !== s.mood) wrong.push(`face ${s.showing} for mood ${s.mood}`);
  for (const name of s.timers) if (!allowed.has(name)) wrong.push(`timer ${name}`);
  if (s.contextLost) wrong.push('context lost');
  return wrong;
}

/** Up, fed and clean enough to do anything, with treats in the jar. */
function refresh(app: App): void {
  const { brain } = app;
  if (brain.state.focus.status !== 'idle') brain.stopFocus();
  if (brain.state.asleep) brain.wake();
  brain.debug?.setNeeds({ tummy: 35, fun: 40, energy: 62, clean: 35 });
  brain.debug?.addTreats(3);
}

/** A whole press on the island at a point of the window: the native side sees it, and so does the page. */
async function press(app: App, at: Point, holdMs = 40): Promise<void> {
  const { touch } = pieces(app);
  await cursor(at, false);
  await sleep(30);
  pointer(touch, 'pointermove', at, 0);
  await cursor(at, true);
  pointer(touch, 'pointerdown', at, 1);
  await sleep(holdMs);
  await cursor(at, false);
  pointer(touch, 'pointerup', at, 0);
  await sleep(30);
}

/** How much of the drawing is not empty, from a copy of it. A dead canvas has none. */
async function painted(app: App): Promise<number> {
  // The copy comes as a data: address. It is decoded here, not handed to an <img>: the
  // page's policy loads images from the app's own files only (and refused this one, which
  // is how the policy's watch earned its keep on its first run).
  const url = pieces(app).stage.capture();
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) return 0;
  let image: ImageBitmap;
  try {
    const bytes = Uint8Array.from(atob(url.slice(comma + 1)), (c) => c.charCodeAt(0));
    image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  } catch {
    return 0;
  }
  if (!image.width) return 0;
  const canvas = document.createElement('canvas');
  canvas.width = 95; canvas.height = 112;
  const g = canvas.getContext('2d');
  if (!g) return 0;
  g.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
  let solid = 0;
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 40) solid++;
  return solid / (canvas.width * canvas.height);
}

const SCENES: readonly [string, (app: App) => void][] = [
  ['feed', (app) => void app.brain.feed()],
  ['treat', (app) => void app.brain.giveTreat()],
  ['play', (app) => void app.brain.play()],
  ['wash', (app) => void app.brain.wash()],
  ['sleep', (app) => void app.brain.sleep()],
  ['focus complete', (app) => { app.brain.startFocus(); app.brain.debug?.finishFocusNow(); }],
];

// ---- hello: the Island is there and is being drawn --------------------------------------

const hello: Scenario = async (app) => {
  const failures: string[] = [];
  await stayAwake(app);
  const wasPill = app.host.current();
  const t0 = performance.now();
  const arrived = await go(app, 'island');
  const switchMs = Math.round(performance.now() - t0);
  const { snap, stage } = pieces(app);
  const frames = await framesIn(1000);
  const native = await status();
  await atRest(app);
  const info = stage.info();
  const solid = await painted(app);
  const layout = islandLayout(app.brain.settings.size.island);
  check(failures, {
    'the app starts in the Pill': wasPill === 'pill',
    'the Island can be switched to': arrived,
    'it is a floating window of the size asked for': native.kind === 'floating' && !!native.bounds && Math.abs(native.bounds.w - Math.round(layout.windowWidth * (window.devicePixelRatio || 1))) <= 2,
    'the drawing is not empty': solid > 0.12,
    'three.js holds a scene': info.geometries > 10 && info.programs > 3,
    'the 3D engine is in a frame of its own': engineFrames() === 1,
    'Doozer is at rest on the island': wrongAtRest(app).length === 0,
    'the window catches the mouse only on its regions': native.regions > 8 && native.regions < 40,
  });
  return { failures, switchMs, frames, visibility: document.visibilityState, native, info: own(info), solid, engineFrames: engineFrames(), snapshot: snap(), wrong: wrongAtRest(app), dpr: window.devicePixelRatio };
};

// ---- never stuck ---------------------------------------------------------------------------

const stuck: Scenario = async (app) => {
  const failures: string[] = [];
  const { brain } = app;
  await stayAwake(app);
  if (app.host.current() !== 'island') await go(app, 'island');
  await atRest(app);
  const out: Record<string, unknown> = {};
  const { snap, touch, radial, world, onDoozer, stage } = pieces(app);
  out.frames = await framesIn(600);

  // 1. Rapid pokes on Doozer.
  await mark('rapid pokes');
  const petsHeard: string[] = [];
  const offPet = brain.on('action', (event) => petsHeard.push(event.type));
  let lowest = 1;
  for (let i = 0; i < 150; i++) {
    const at = onDoozer();
    await cursor(at, true);
    pointer(touch, 'pointerdown', at, 1);
    await sleep(14);
    await cursor(at, false);
    pointer(touch, 'pointerup', at, 0);
    await sleep(14);
    lowest = Math.min(lowest, snap().doozer.stretch);
  }
  offPet();
  radial.close();
  await park();
  const restedAfterPokes = await atRest(app);
  const afterPokes = { wrong: wrongAtRest(app), status: await status(), lowest };
  const opened = await (async () => { await press(app, onDoozer()); return snap().radial; })();
  radial.close();
  check(failures, {
    'rapid pokes: every poke jiggles': lowest < 0.97,
    'rapid pokes: the brain heard nothing (a poke is not a rule)': petsHeard.length === 0,
    'rapid pokes: everything came to rest': restedAfterPokes && afterPokes.wrong.length === 0,
    'rapid pokes: the shell is not holding a press': !afterPokes.status.holding,
    'rapid pokes: the window lets clicks through at rest': afterPokes.status.styleClickThrough && !afterPokes.status.catching,
    'rapid pokes: the next click opens the Radial': opened,
  });
  out.pokes = afterPokes;
  await park();
  await atRest(app);

  // 2. A stroke whose mouse-up never arrives.
  await mark('lost mouse-up');
  const released: unknown[] = [];
  const offReleased = shell.on('pointer-released', (at) => released.push(at));
  const from = onDoozer();
  await cursor(from, false);
  await sleep(220);
  pointer(touch, 'pointermove', from, 0);
  await sleep(220);
  pointer(touch, 'pointermove', from, 0);
  const pets: number[] = [];
  const offStroke = brain.on('action', (event) => { if (event.type === 'pet') pets.push(performance.now()); });
  await cursor(from, true);
  pointer(touch, 'pointerdown', from, 1);
  await sleep(120);
  const held = { snap: snap(), status: await status() };
  // Stroke across Doozer with the button down...
  for (let i = 0; i < 14; i++) {
    const at = { x: from.x + (i % 2 === 0 ? 14 : -14), y: from.y };
    await cursor(at, true);
    pointer(touch, 'pointermove', at, 1, { x: i % 2 === 0 ? 28 : -28, y: 0 });
    await sleep(12);
  }
  // ...then leave at speed with it still down.
  let leftWhileHeld = 0;
  let at = from;
  for (let i = 1; i <= 10; i++) {
    at = { x: from.x + 70 * i, y: from.y - 40 * i };
    await cursor(at, true);
    await sleep(16);
    if (i % 3 === 0) {
      const now = await status();
      if (now.styleClickThrough || !now.catching || !now.holding) leftWhileHeld++;
    }
  }
  const stillPressed = snap().pressed;
  // The button comes up far away. The page is given no pointerup.
  await cursor(at, false);
  const t0 = performance.now();
  const ended = await waitFor(() => !snap().pressed, 1500, 4);
  const endedAfterMs = Math.round((performance.now() - t0) * 10) / 10;
  await sleep(400);
  await park();
  await sleep(300);
  const rested = await status();
  offReleased();
  offStroke();
  const radialAfterLost = snap().radial;
  const restedAfterLost = await atRest(app);
  const wrongAfterLost = wrongAtRest(app);
  await press(app, onDoozer());
  const worksAfter = snap().radial;
  radial.close();
  check(failures, {
    'lost mouse-up: the press went to the page and squashed Doozer': held.snap.pressed && held.snap.doozer.stretch < 0.97 && held.status.holding && held.status.catching,
    'lost mouse-up: the stroke petted Doozer': pets.length >= 1,
    'lost mouse-up: click-through did not change while the button was down': leftWhileHeld === 0 && stillPressed,
    'lost mouse-up: the press ended without a mouse-up': ended,
    'lost mouse-up: the shell said so exactly once': released.length === 1,
    'lost mouse-up: nothing was toggled by it': !radialAfterLost,
    'lost mouse-up: not holding, and click-through at rest': !rested.holding && rested.styleClickThrough && !rested.catching,
    'lost mouse-up: Doozer came back to rest': restedAfterLost && wrongAfterLost.length === 0,
    'lost mouse-up: the next click works': worksAfter,
  });
  out.lostMouseUp = { endedAfterMs, released, pets: pets.length, restedAfterLost, wrongAfterLost };
  await park();
  await atRest(app);

  // 3. Every scene, interrupted at several moments, by a real poke and by another action in turn.
  await mark('scenes interrupted');
  const cuts: unknown[] = [];
  let n = 0;
  for (const [name, start] of SCENES) {
    for (const cutAt of [0, 300, 900, 1800, 3200]) {
      refresh(app);
      await atRest(app, 12_000);
      start(app);
      await sleep(cutAt);
      const how = n++ % 3;
      if (how === 0) { await press(app, onDoozer()); radial.close(); }
      else if (how === 1) { brain.debug?.setNeeds({ clean: 40 }); brain.wash(); }
      else { if (brain.state.asleep) brain.wake(); else { brain.debug?.setNeeds({ energy: 50 }); brain.sleep(); } }
      await park();
      const rested2 = await atRest(app, 25_000);
      const wrong = wrongAtRest(app);
      const ok = rested2 && wrong.length === 0;
      if (!ok) failures.push(`mid-scene: ${name} at ${cutAt} ms (${['poke', 'another action', 'sleep or wake'][how]}): ${wrong.join(', ') || 'never came to rest'}`);
      cuts.push({ name, cutAt, how: ['poke', 'another action', 'sleep or wake'][how], ok, wrong });
    }
  }
  out.cuts = cuts;
  refresh(app);
  await atRest(app);
  const tummy = brain.state.needs.tummy;
  await press(app, onDoozer());
  const feed = radial.el.querySelector<HTMLButtonElement>('[data-id="feed"]');
  if (feed) { feed.click(); }
  check(failures, { 'mid-scene: the island still works afterwards': brain.state.needs.tummy === tummy + 32 && snap().scene === 'eat' });
  await atRest(app);

  // 4. The view switched in the middle of every scene, and back.
  await mark('switched mid-scene');
  const switches: unknown[] = [];
  for (const [name, start] of SCENES) {
    refresh(app);
    await atRest(app, 12_000);
    start(app);
    await sleep(700);
    const toPill = await go(app, 'pill');
    const islandGone = app.island.snapshot() === null && document.querySelectorAll('canvas').length === 0;
    const pillOk = app.pill.snapshot() !== null;
    await sleep(300);
    const back = await go(app, 'island');
    const rested3 = back && await atRest(app, 25_000);
    const wrong = back ? wrongAtRest(app) : ['did not come back'];
    const ok = toPill && islandGone && pillOk && back && rested3 && wrong.length === 0;
    if (!ok) failures.push(`switched mid-scene: ${name}: ${[!toPill && 'no Pill', !islandGone && 'island left behind', !back && 'no way back', ...wrong].filter(Boolean).join(', ')}`);
    switches.push({ name, ok, toPill, islandGone, pillOk, back, wrong });
  }
  out.switches = switches;

  // 5. The graphics context lost and restored, then lost for good.
  await mark('context lost');
  refresh(app);
  await atRest(app);
  const fresh = pieces(app);
  const before = { solid: await painted(app), info: fresh.stage.info() };
  fresh.stage.loseContext();
  await sleep(300);
  const lost = { snap: fresh.snap(), timers: fresh.snap().timers };
  // Life goes on while nothing can be drawn.
  brain.feed();
  await sleep(700);
  const sceneWhileLost = fresh.snap().scene;
  const restoreAsked = performance.now();
  fresh.stage.restoreContext();
  const restored = await waitFor(() => !fresh.snap().contextLost, 3000, 5);
  const restoreMs = Math.round(performance.now() - restoreAsked);
  await sleep(400);
  const afterRestore = { solid: await painted(app), snap: fresh.snap() };
  const restedAfterRestore = await atRest(app, 25_000);
  check(failures, {
    'context lost: the view notices': lost.snap.contextLost && lost.timers.includes('context'),
    'context lost: scenes go on while nothing can be drawn': sceneWhileLost === 'eat',
    'context restored: the view notices': restored && afterRestore.snap.rebuilds === 0,
    'context restored: the island is drawn again': afterRestore.solid > 0.12 && Math.abs(afterRestore.solid - before.solid) < 0.2,
    'context restored: back to rest, whole': restedAfterRestore && wrongAtRest(app).length === 0,
  });
  // Lost and not restored: the renderer is rebuilt on a new canvas.
  const oldCanvas = fresh.stage.canvas;
  fresh.stage.loseContext();
  await sleep(CONTEXT_LIMIT_MS + 700);
  const rebuilt = { snap: fresh.snap(), newCanvas: fresh.stage.canvas !== oldCanvas, canvases: document.querySelectorAll('canvas').length, solid: await painted(app) };
  await press(app, fresh.onDoozer());
  const touchAfterRebuild = fresh.snap().radial;
  fresh.radial.close();
  await park();
  const restedAfterRebuild = await atRest(app, 25_000);
  check(failures, {
    'context lost for good: the drawing is rebuilt on a new canvas': rebuilt.snap.rebuilds === 1 && rebuilt.newCanvas && rebuilt.canvases === 1 && !rebuilt.snap.contextLost,
    'context lost for good: the island is drawn again': rebuilt.solid > 0.12,
    'context lost for good: touch still works': touchAfterRebuild,
    'context lost for good: back to rest, whole': restedAfterRebuild && wrongAtRest(app).length === 0,
  });
  out.context = { before, lostTimers: lost.timers, afterRestore: afterRestore.solid, restoreMs, rebuildsAfterRestore: afterRestore.snap.rebuilds, rebuilt };
  void world;
  void stage;

  await app.host.settled();
  await park();
  return { failures, ...out };
};

// ---- the window: click-through follows the island's outline ----------------------------------

const windowChecks: Scenario = async (app) => {
  const failures: string[] = [];
  await stayAwake(app);
  if (app.host.current() !== 'island') await go(app, 'island');
  refresh(app);
  await atRest(app);
  const { snap, radial, world, stage, onDoozer, island } = pieces(app);
  const layout = islandLayout(app.brain.settings.size.island);
  const ox = layout.sceneLeft;
  const oy = layout.sceneTop;
  type Reading = { label: string; styleClickThrough: boolean };
  const probe = async (points: { label: string; at: Point; through: boolean }[]): Promise<unknown[]> => {
    const readings = await invoke<Reading[]>('spike_probe', { points: points.map((p) => ({ label: p.label, x: Math.round(p.at.x), y: Math.round(p.at.y) })), settleMs: 150 });
    return points.map((p, i) => {
      const got = readings[i];
      const ok = got !== undefined && got.styleClickThrough === p.through;
      if (!ok) failures.push(`click-through: ${p.label}`);
      return { label: p.label, expectThrough: p.through, got };
    });
  };
  const project = (x: number, y: number, z: number): Point => {
    const p = stage.projector.project([x, y, z]);
    return { x: ox + p.x, y: oy + p.y };
  };
  const d = onDoozer();
  const outline = await probe([
    { label: 'on Doozer', at: d, through: false },
    { label: 'on Doozer\'s ear', at: { x: d.x - 32, y: d.y - 48 }, through: false },
    { label: 'on the grass, left', at: project(-1.4, -0.2, 0.4), through: false },
    { label: 'on the grass, right', at: project(1.4, -0.2, 0.4), through: false },
    { label: 'on the earth underneath', at: project(0, -1.1, 0.6), through: false },
    { label: 'top-left corner of the drawing', at: { x: ox + 8, y: oy + 8 }, through: true },
    { label: 'top-right corner of the drawing', at: { x: ox + layout.sceneWidth - 8, y: oy + 8 }, through: true },
    { label: 'bottom-left corner of the drawing', at: { x: ox + 10, y: oy + layout.sceneHeight - 10 }, through: true },
    { label: 'bottom-right corner of the drawing', at: { x: ox + layout.sceneWidth - 10, y: oy + layout.sceneHeight - 10 }, through: true },
    { label: 'beside the earth, under the rim', at: { x: ox + 30, y: oy + layout.sceneHeight - 75 }, through: true },
    { label: 'the sky above Doozer', at: { x: ox + layout.sceneWidth / 2, y: oy + 60 }, through: true },
    { label: 'the band kept for the Card, above', at: { x: layout.windowWidth / 2, y: Math.max(4, oy - 30) }, through: true },
    { label: 'the band kept for the Card, below', at: { x: layout.windowWidth / 2, y: oy + layout.sceneHeight + 30 }, through: true },
  ]);
  await park();

  // The Radial's buttons catch the mouse while it is open, and only then.
  await press(app, onDoozer());
  await sleep(450);
  const buttons = [...radial.el.querySelectorAll<HTMLButtonElement>('.dzk-rb')].map((b) => {
    const box = b.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, w: box.width };
  });
  const regions = island.hitRegions();
  const covered = buttons.filter((b) => regions.some((r) => b.x >= r.x && b.x <= r.x + r.w && b.y >= r.y && b.y <= r.y + r.h && Math.abs(r.w - (b.w + 6)) < 3)).length;
  const first = buttons[0] ?? { x: 0, y: 0 };
  const last = buttons[buttons.length - 1] ?? { x: 0, y: 0 };
  const open = await probe([
    { label: 'Radial open: on its first button', at: first, through: false },
    { label: 'Radial open: on its last button', at: last, through: false },
  ]);
  radial.close();
  await park();
  await sleep(300);
  const closed = await probe([{ label: 'Radial closed: where its first button was', at: first, through: first.y > oy + 250 ? false : true }]);
  check(failures, {
    'Radial: all six buttons are on screen inside the drawing': buttons.length === 6 && buttons.every((b) => b.x > ox + 20 && b.x < ox + layout.sceneWidth - 20 && b.y > oy + 20),
    'Radial: the regions the view reports are where the buttons really are': covered === 6,
  });

  // The ball has a region of its own, wherever it comes to rest.
  world.serveBall('ball');
  await atRest(app, 15_000);
  const ball = snap().ball;
  const ballProbe = ball ? await probe([{ label: 'on the ball', at: ball.screen, through: false }]) : [];
  await park();

  // The Card opens over the island without the window taking the keyboard; the settings panel may.
  island.setOpen('card');
  await sleep(500);
  const card = document.querySelector<HTMLElement>('.islv-panel .dzk-card');
  const cardBox = card?.getBoundingClientRect();
  const withCard = { status: await status(), snap: snap() };
  const cardProbe = cardBox ? await probe([
    { label: 'Card open: on the Card', at: { x: cardBox.left + cardBox.width / 2, y: cardBox.top + cardBox.height / 2 }, through: false },
    { label: 'Card open: beside the Card, in the band', at: { x: 6, y: Math.max(6, cardBox.top + 6) }, through: true },
  ]) : [];
  island.openSettings?.();
  await sleep(300);
  const withSettings = await status();
  island.setOpen('none');
  await sleep(300);
  const afterPanels = await status();
  check(failures, {
    'Card: it fits inside the window': !!cardBox && cardBox.top >= 0 && cardBox.bottom <= window.innerHeight + 1 && cardBox.left >= 0 && cardBox.right <= window.innerWidth + 1,
    'Card: open, the window still refuses the keyboard': withCard.snap.open === 'card' && withCard.status.styleNoActivate && !withCard.status.focusable && !withCard.status.isForeground,
    'settings: a click may give the window the keyboard': withSettings.focusable && !withSettings.styleNoActivate,
    'settings: closed, the window refuses it again': !afterPanels.focusable && afterPanels.styleNoActivate,
  });

  // The three sizes: the window changes, Doozer is back, the outline still fits.
  const sizes: unknown[] = [];
  for (const size of ['small', 'large', 'medium'] as const) {
    app.brain.setSetting('size', { ...app.brain.settings.size, island: size });
    await sleep(60);
    await app.host.settled();
    await sleep(500);
    const want = islandLayout(size);
    const s = await status();
    const scale = window.devicePixelRatio || 1;
    const ok = !!s.bounds && Math.abs(s.bounds.w - Math.round(want.windowWidth * scale)) <= 2 && Math.abs(s.bounds.h - Math.round(want.windowHeight * scale)) <= 2
      && Math.abs(window.innerWidth - want.windowWidth) <= 1 && !snap().gone && s.regions > 8 && await painted(app) > 0.1;
    if (!ok) failures.push(`size ${size}`);
    sizes.push({ size, ok, bounds: s.bounds, inner: [window.innerWidth, window.innerHeight], regions: s.regions });
  }
  await park();
  return { failures, outline, open, closed, ballProbe, cardProbe, sizes, buttons, covered };
};

// ---- a focus session carried between the Island and the Pill ------------------------------------

const focus: Scenario = async (app) => {
  const failures: string[] = [];
  const { brain, host } = app;
  await stayAwake(app);
  if (host.current() !== 'island') await go(app, 'island');
  refresh(app);
  await atRest(app);
  const before = { treats: brain.state.treats, sessions: brain.state.sessionsCompleted, streak: brain.state.streak.current };

  // Start it from the Island: poke Doozer, More, and the Card's own Start button.
  let p = pieces(app);
  await press(app, p.onDoozer());
  p.radial.el.querySelector<HTMLButtonElement>('[data-id="more"]')?.click();
  await sleep(450);
  const start = p.card.el.querySelector<HTMLButtonElement>('[data-act="focus"]');
  const samples: { at: number; view: string | null; status: string; remaining: number }[] = [];
  const sample = (): void => { samples.push({ at: performance.now(), view: host.current(), status: brain.state.focus.status, remaining: brain.state.focus.remainingMs }); };
  if (start) {
    const box = start.getBoundingClientRect();
    const at = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    await cursor(at, true);
    pointer(start, 'pointerdown', at, 1);
    await sleep(40);
    await cursor(at, false);
    pointer(start, 'pointerup', at, 0);
    start.click();
  }
  await sleep(200);
  p.island.setOpen('none');
  await park();
  const sampler = setInterval(sample, 100);
  await sleep(1800);
  const chip = document.querySelector<HTMLElement>('.islv-chip .dzk-focus-chip');
  const inIsland = {
    status: brain.state.focus.status, quiet: brain.state.quiet, chip: chip?.dataset.show, chipText: chip?.textContent ?? '',
    glasses: p.stage.actor.object.getObjectByName('glasses')?.visible === true, showing: p.snap().showing,
  };
  const chipLater = await (async () => { await sleep(1200); return chip?.textContent ?? ''; })();

  // To the Pill and back, twice, while it runs.
  const hops: unknown[] = [];
  for (let i = 0; i < 2; i++) {
    const leftAt = brain.state.focus.remainingMs;
    const toPill = await go(app, 'pill');
    const pill = app.pill.snapshot();
    const inPill = { status: brain.state.focus.status, pillStatus: pill?.status ?? '', ring: pill?.ring ?? '', remaining: brain.state.focus.remainingMs };
    await sleep(900);
    const back = await go(app, 'island');
    p = pieces(app);
    await sleep(600);
    const chipNow = document.querySelector<HTMLElement>('.islv-chip .dzk-focus-chip');
    const backInIsland = {
      status: brain.state.focus.status, remaining: brain.state.focus.remainingMs, chipShown: chipNow?.dataset.show === '1', chip: chipNow?.textContent ?? '',
      glasses: p.stage.actor.object.getObjectByName('glasses')?.visible === true, showing: p.snap().showing,
    };
    // Still running, still counting down (never back up), and each view shows it its own way.
    const ok = toPill && back && inPill.status === 'running' && /^\d\d:\d\d$/.test(inPill.pillStatus) && inPill.ring.startsWith('focus:')
      && inPill.remaining <= leftAt && backInIsland.remaining < leftAt && backInIsland.status === 'running' && backInIsland.chipShown
      && /^\d\d:\d\d$/.test(backInIsland.chip) && backInIsland.glasses && backInIsland.showing === 'focus';
    if (!ok) failures.push(`round trip ${i + 1} to the Pill and back`);
    hops.push({ i, ok, toPill, back, leftAt, inPill, backInIsland });
  }
  clearInterval(sampler);
  sample();
  // The session's own clock never jumped, stopped, went back or restarted, whichever view
  // was showing. (The brain counts in whole seconds and is asked four times a second, so
  // what it says can be up to a second and a quarter behind the wall clock.)
  let worstDrift = 0;
  let notRunning = 0;
  let wentBack = 0;
  const first = samples[0];
  let previous = first?.remaining ?? 0;
  for (const s of samples) {
    if (s.status !== 'running') notRunning++;
    if (s.remaining > previous) wentBack++;
    previous = s.remaining;
    if (first) worstDrift = Math.max(worstDrift, Math.abs((first.remaining - s.remaining) - (s.at - first.at)));
  }

  // It ends in the Island: Doozer celebrates, the treats land, and Doozer never has the keyboard.
  let hadFocus = 0;
  let looks = 0;
  const watching = setInterval(() => { void status().then((now) => { looks++; if (now.isForeground) hadFocus++; }); }, 120);
  brain.debug?.finishFocusNow();
  await sleep(350);
  const celebrating = p.snap();
  const rested = await atRest(app, 25_000);
  clearInterval(watching);
  const after = { treats: brain.state.treats, sessions: brain.state.sessionsCompleted, streak: brain.state.streak.current, status: brain.state.focus.status };
  const endStatus = await status();
  check(failures, {
    'the session starts from the Card in the Island': inIsland.status === 'running' && inIsland.quiet,
    'in the Island: glasses on, and the chip under the island counts down': inIsland.glasses && inIsland.showing === 'focus' && inIsland.chip === '1' && /^\d\d:\d\d$/.test(inIsland.chipText) && chipLater < inIsland.chipText,
    'the session ran the whole time, in whichever view': notRunning === 0 && samples.length > 30,
    'its clock never jumped or went back': worstDrift < 1500 && wentBack === 0,
    'it ends in the Island with a celebration': celebrating.scene === 'focus-complete' && rested,
    'the treats landed: 2 for 25 minutes, 1 for the first of the day': after.treats === Math.min(brain.limits.treats, before.treats + 3) && after.sessions === before.sessions + 1,
    'the streak counts it': after.streak === Math.max(1, before.streak),
    'Doozer never had the keyboard': looks > 5 && hadFocus === 0 && endStatus.styleNoActivate,
    'afterwards the island is at rest, whole': wrongAtRest(app).length === 0,
  });
  await host.flush();
  return { failures, before, inIsland, chipLater, hops, samples: samples.length, worstDrift, wentBack, notRunning, after, wrong: wrongAtRest(app) };
};

// ---- ten times in and out, for the leak measurement ----------------------------------------------

/** The page's own view of memory, where the browser offers one. */
function heap(): { usedMB: number | null; totalMB: number | null } {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  return memory ? { usedMB: Math.round(memory.usedJSHeapSize / 1e4) / 100, totalMB: Math.round(memory.totalJSHeapSize / 1e4) / 100 } : { usedMB: null, totalMB: null };
}
/** The hidden frames the 3D engine lives in (engine.ts): one in the Island, none anywhere else. */
const engineFrames = (): number => document.querySelectorAll('iframe').length;
/** A copy that is plain data of this page's own, holding on to nothing. */
const own = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const collect = (): void => { (globalThis as unknown as { gc?: () => void }).gc?.(); };

/**
 * A bare WebGL canvas the size of the Island's, with one spinning triangle, for `ms`; then
 * the context is given back and the canvas removed, as the Island does on leaving. Nothing
 * of three.js and nothing of the view: what this leaves behind, the browser keeps for any
 * page that has ever drawn with WebGL.
 */
async function bareWebGL(ms: number): Promise<boolean> {
  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(380 * ratio);
  canvas.height = Math.round(450 * ratio);
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:380px;height:450px;pointer-events:none';
  document.body.append(canvas);
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'low-power' });
  if (!gl) { canvas.remove(); return false; }
  const shader = (type: number, source: string): WebGLShader => {
    const made = gl.createShader(type) as WebGLShader;
    gl.shaderSource(made, source);
    gl.compileShader(made);
    return made;
  };
  const program = gl.createProgram() as WebGLProgram;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p; uniform float a; void main() { float c = cos(a), s = sin(a); gl_Position = vec4(p.x * c - p.y * s, p.x * s + p.y * c, 0.0, 1.0); }'));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float; out vec4 o; void main() { o = vec4(1.0, 0.7, 0.5, 1.0); }'));
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0.7, -0.6, -0.5, 0.6, -0.5]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const angle = gl.getUniformLocation(program, 'a');
  const began = performance.now();
  while (performance.now() - began < ms) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(angle, (performance.now() - began) / 600);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    await sleep(16);
  }
  const drawn = gl.getError() === gl.NO_ERROR;
  gl.deleteBuffer(buffer);
  gl.deleteProgram(program);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  canvas.remove();
  return drawn;
}

/**
 * Sits in the Pill, goes to the Island and back ten times, and writes a marker file each
 * time it is back in the Pill and has settled. scripts/measure-island-leak.ps1 watches for
 * the markers and reads the processes' memory at each one.
 */
const leak: Scenario = async (app, args) => {
  const failures: string[] = [];
  await stayAwake(app);
  if (app.host.current() !== 'pill') await go(app, 'pill');
  const rounds = Number(args.rounds ?? 10);
  const settleMs = Number(args.settleMs ?? 6000);
  const rows: unknown[] = [];
  const switches: { round: number; inMs: number; outMs: number; timing: IslandSnapshot['timing'] | null }[] = [];
  /**
   * Two control runs, to tell what is the Island's from what is not. "room": the same trips
   * by way of the Room, which draws no 3D. "webgl": no trip at all; the Pill stays, and a
   * bare WebGL canvas with one triangle on it, nothing of three.js or of this view, is put
   * up for the same ten seconds and taken down the same way.
   */
  const control = args.control === 'room' ? 'room' as const : null;
  const bare = args.control === 'webgl';
  const point = async (name: string, more: Record<string, unknown> = {}): Promise<void> => {
    await park();
    await sleep(settleMs / 2);
    collect();
    await sleep(settleMs / 2);
    collect();
    const row = { name, at: Date.now(), heap: heap(), canvases: document.querySelectorAll('canvas').length, engineFrames: engineFrames(), view: app.host.current(), gc: typeof (globalThis as { gc?: unknown }).gc === 'function', ...more };
    rows.push(row);
    await report(`leak-${name}.json`, row);
    // Give the script time to see the marker and read the processes.
    await sleep(3500);
  };
  /**
   * One visit, in a function of its own: once it has returned, nothing in this run holds a
   * piece of the Island any more. What it hands back is plain data of this page's own
   * (an object made by the 3D engine belongs to the engine's frame, and keeping one would
   * keep the whole frame), and a weak reference to the stage, which holds nothing.
   */
  const visit = async (i: number) => {
    if (bare) {
      const drawn = await bareWebGL(7000);
      const inIsland = { info: null, solid: drawn ? 1 : 0, heap: heap(), engineFrames: engineFrames() };
      if (i === 1 || i === rounds) await point(`island-${i}`, { inIsland });
      return { arrived: true, inMs: 0, timing: null, inIsland, engine: null };
    }
    // How long the switch itself takes, as the host does it (pop-out, window, mount, show).
    const t0 = performance.now();
    const arrived = await app.host.switchTo(control ?? 'island');
    const inMs = Math.round(performance.now() - t0);
    await app.host.settled();
    await sleep(450);
    if (control) {
      // The control run: the same trips and the same things done, by way of another view.
      refresh(app);
      app.brain.feed();
      await sleep(2600);
      app.brain.play();
      await sleep(2200);
      app.brain.wash();
      await sleep(1800);
      const inIsland = { info: null, solid: 1, heap: heap(), engineFrames: engineFrames() };
      if (i === 1 || i === rounds) await point(`island-${i}`, { inIsland });
      return { arrived, inMs, timing: null, inIsland, engine: null };
    }
    const p = pieces(app);
    const timing = own(p.snap().timing);
    // Use the island properly while there: a meal, a game, a bath, and night.
    refresh(app);
    app.brain.feed();
    await sleep(2600);
    app.brain.play();
    await sleep(2200);
    app.brain.wash();
    await sleep(1800);
    const inIsland = own({ info: p.stage.info(), solid: await painted(app), heap: heap(), engineFrames: engineFrames() });
    if (i === 1 || i === rounds) await point(`island-${i}`, { inIsland });
    return { arrived, inMs, timing, inIsland, engine: new WeakRef<object>(p.stage) };
  };
  const canCollect = typeof (globalThis as { gc?: unknown }).gc === 'function';
  await point('baseline');
  for (let i = 1; i <= rounds; i++) {
    const seen = await visit(i);
    const t1 = performance.now();
    const left = bare ? true : await app.host.switchTo('pill');
    switches.push({ round: i, inMs: seen.inMs, outMs: Math.round(performance.now() - t1), timing: seen.timing });
    await app.host.settled();
    await sleep(450);
    const gone = app.island.snapshot() === null && document.querySelectorAll('canvas').length === 0 && engineFrames() === 0;
    // Has the engine itself gone? Only a garbage collection can tell, so only where one can be asked for.
    collect();
    await sleep(300);
    collect();
    await sleep(50);
    const engineCollected = canCollect && seen.engine ? seen.engine.deref() === undefined : null;
    const wrong = [!seen.arrived && 'did not arrive', !left && 'did not leave', !gone && 'something left behind', seen.inIsland.solid < 0.1 && 'nothing drawn', engineCollected === false && 'the 3D engine is still held'].filter(Boolean);
    if (wrong.length) failures.push(`round ${i}: ${wrong.join(', ')}`);
    await point(`pill-${i}`, { inIsland: seen.inIsland, engineCollected });
  }
  await report('leak-done.json', { rows, switches });
  return { failures, rows, switches };
};

// ---- idle, for the cost measurement --------------------------------------------------------------

/** Sit in the Island doing nothing, as it would all day. Never finishes; scripts/measure-idle.ps1 samples it. */
const idle: Scenario = async (app, args) => {
  await stayAwake(app);
  if (app.host.current() !== 'island') await go(app, 'island');
  refresh(app);
  app.brain.debug?.setNeeds({ tummy: 90, fun: 90, energy: 90, clean: 90 });
  if (args.asleep === true) { app.brain.debug?.setNeeds({ energy: 40 }); app.brain.sleep(); }
  if (args.focus === true) app.brain.startFocus();
  if (args.ball === true) pieces(app).world.serveBall('ball');
  await park();
  await atRest(app, 20_000);
  const { snap, stage, touch, onDoozer } = pieces(app);
  // "watched": the pointer rests on Doozer the whole time, so it stays lively. Not idle;
  // measured to know what being looked at costs.
  if (args.watched === true) setInterval(() => pointer(touch, 'pointermove', onDoozer(), 0), 300);
  const frames = await framesIn(1000);
  await report('idle-ready.json', { ready: true, at: Date.now(), snap: snap(), status: await status(), info: stage.info(), frames, visibility: document.visibilityState });
  // Report now and then how many frames have been drawn, so the measurement can say what the island was doing.
  let last = snap().frames;
  const started = Date.now();
  // With "gc" (and a browser started with a way to ask for one) garbage is collected before
  // each reading, so that the heap figures say what is held. Not for a CPU measurement.
  const history: Array<Record<string, unknown>> = [];
  setInterval(() => {
    const s = snap();
    if (args.gc === true) collect();
    const info = stage.info();
    history.push({
      second: Math.round((Date.now() - started) / 1000), drawn: s.frames - last, lively: s.lively,
      heapMB: heap().usedMB, nodes: document.getElementsByTagName('*').length, emotes: s.emotes, particles: s.particles,
      geometries: info.geometries, textures: info.textures, programs: info.programs,
    });
    void report('idle-frames.json', { at: Date.now(), frames: s.frames, sinceLast: s.frames - last, undrawn: s.undrawn, lively: s.lively, drawing: s.drawing, timers: s.timers, mood: s.mood, night: s.night, history });
    last = s.frames;
  }, 10_000);
  return new Promise(() => undefined);
};

// ---- stills: the drawing at several moments, as the real window draws it ---------------------------

/** Writes PNG data URLs of the island at chosen moments. scripts/run-island-checks.ps1 turns them into files. */
const stills: Scenario = async (app) => {
  const failures: string[] = [];
  await stayAwake(app);
  if (app.host.current() !== 'island') await go(app, 'island');
  const { brain } = app;
  const shots: string[] = [];
  const shoot = async (name: string): Promise<void> => {
    const url = pieces(app).stage.capture();
    await report(`still-${name}.txt`, url);
    shots.push(name);
  };
  refresh(app);
  // An ordinary day: content, eyes open.
  brain.debug?.setNeeds({ tummy: 66, fun: 66, energy: 66, clean: 66 });
  await sleep(900);
  await atRest(app);
  await shoot('00-content');
  brain.debug?.setNeeds({ tummy: 90, fun: 90, energy: 90, clean: 90 });
  await sleep(900);
  await atRest(app);
  await shoot('01-day-at-rest');
  const p = pieces(app);
  // A press, held: squashed under the finger.
  const at = p.onDoozer();
  pointer(p.touch, 'pointerdown', at, 1);
  await sleep(260);
  await shoot('02-pressed');
  pointer(p.touch, 'pointerup', at, 0);
  p.radial.close();
  await sleep(70);
  await shoot('03-springing-back');
  await atRest(app);
  // A meal.
  brain.debug?.setNeeds({ tummy: 40 });
  brain.feed();
  await sleep(520);
  await shoot('04-snack-falling');
  await sleep(1750);
  await shoot('05-eating');
  await sleep(1900);
  await shoot('06-cheering');
  await atRest(app);
  // A game of ball.
  brain.play();
  await sleep(1500);
  await shoot('07-ball');
  await sleep(1700);
  await shoot('08-ball-chase');
  await atRest(app, 25_000);
  // A bath.
  brain.debug?.setNeeds({ clean: 30 });
  brain.wash();
  await sleep(900);
  await shoot('09-bath');
  await atRest(app);
  // A focus session.
  brain.startFocus();
  await atRest(app);
  await shoot('10-focus');
  brain.stopFocus();
  await atRest(app);
  // Low moods.
  brain.debug?.setNeeds({ tummy: 8 });
  await sleep(900);
  await atRest(app);
  await shoot('11-hungry');
  brain.debug?.setNeeds({ tummy: 90, clean: 14 });
  await sleep(900);
  await atRest(app);
  await shoot('12-grubby');
  brain.debug?.setNeeds({ clean: 90, energy: 40 });
  // Night.
  brain.sleep();
  await sleep(1300);
  await shoot('13-falling-asleep');
  await atRest(app, 25_000);
  await shoot('14-night');
  brain.wake();
  await sleep(900);
  await shoot('15-waking');
  await atRest(app);
  check(failures, { 'every still was written': shots.length === 16 });
  return { failures, shots };
};

const SCENARIOS: Record<string, Scenario> = {
  'app-island-hello': hello,
  'app-island-stuck': stuck,
  'app-island-window': windowChecks,
  'app-island-focus': focus,
  'app-island-leak': leak,
  'app-island-idle': idle,
  'app-island-stills': stills,
};

export async function runIslandChecks(app: App, run: TestRun): Promise<void> {
  const args = run.args ?? {};
  const names = scenarioNames(run);
  const whole: Record<string, unknown> = { run, startedAt: new Date().toISOString(), scenarios: {} };
  const results = whole.scenarios as Record<string, unknown>;
  for (const name of names) {
    const scenario = SCENARIOS[name];
    await mark(`scenario ${name}`);
    try {
      results[name] = scenario ? await scenario(app, (args[name] as Record<string, unknown> | undefined) ?? args) : { failures: ['unknown scenario'] };
    } catch (error) {
      results[name] = { failures: [`threw: ${String(error)}`], stack: error instanceof Error ? error.stack : undefined };
    }
  }
  whole.finishedAt = new Date().toISOString();
  whole.endStatus = await status();
  whole.endSnapshot = app.island.snapshot();
  whole.trail = trail;
  await invoke('spike_inject', { cursor: null });
  whole.policyViolations = addPolicyFailures(results);
  await report(`${String(args.tag ?? names.join('+'))}.json`, whole);
  if (args.exit === false) return;
  // Quit the way a person would, through the tray menu: the page is told, saves, and answers.
  await invoke('spike_menu', { id: 'quit' });
}
