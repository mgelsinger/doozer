// Scripted runs of the Desktop view in the real window (Phase 9). What they showed is in
// docs/desktop-checks.md.
//
// Started like the app's other scripted runs (docs/shell-spike.md section 9): a build made
// with `--features spike`, DOOZER_SPIKE set to one or more names from the table at the
// bottom, DOOZER_SAVE_DIR pointing at a scratch folder. `scripts/run-desktop-checks.ps1`
// does all of that. A normal build never loads this file.
//
// The runs keep the real mouse out. A press is made twice over, as a real press is: the
// native cursor tracker is fed a pretend cursor and button (so the window's click-through
// state and the shell's `pointer-released` are the real ones), and the page is given the
// matching pointer events. Nothing moves the user's pointer, and with DOOZER_SPIKE_CLOAK=1
// nothing appears on screen either.

import { invoke } from '@tauri-apps/api/core';
import type { NeedKey, Settings } from '../../core/contract';
import { parseSave } from '../../host/store';
import type { App } from '../../main';
import { shell, type Region } from '../../shell';
import { scenarioNames, type TestRun } from '../../spike/config';
import type { DesktopParts, DesktopSnapshot, Sabotage } from './index';
import { hitRegion, readSpots } from './stage';

interface Status {
  kind: string | null;
  view: string | null;
  bounds: { x: number; y: number; w: number; h: number } | null;
  scale: number;
  regions: number;
  catching: boolean;
  styleClickThrough: boolean;
  styleNoActivate: boolean;
  visible: boolean;
  focusable: boolean;
  holding: boolean;
  isForeground: boolean;
  fullscreenInFront: boolean;
  stats: { flips: number; styleRepairs: number; watchdogTrips: number; modeSwitches: number };
}

type Point = { x: number; y: number };
type Result = { failures: string[] } & Record<string, unknown>;
type Scenario = (app: App, args: Record<string, unknown>) => Promise<Result>;
type Pace = Settings['desktopActivity'];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const status = (): Promise<Status> => invoke<Status>('shell_status');
/** Far outside every monitor: the pretend cursor's resting place. */
const PARKED = { x: -30000, y: -30000, screen: true, down: false };
const park = (): Promise<unknown> => invoke('spike_inject', { cursor: PARKED });
const cursor = (at: Point, down: boolean): Promise<unknown> => invoke('spike_inject', { cursor: { x: at.x, y: at.y, down } });
const report = (name: string, data: unknown): Promise<unknown> => invoke('spike_report', { name, json: JSON.stringify(data, null, 1) });

/** Where a run has got to, written as it goes, so that a run that stalls says where. */
const trail: { at: number; step: string }[] = [];
const began = performance.now();
async function mark(step: string, more: Record<string, unknown> = {}): Promise<void> {
  trail.push({ at: Math.round(performance.now() - began), step });
  await report('desktop-trail.json', { trail, visibility: document.visibilityState, ...more }).catch(() => undefined);
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

/** A small deterministic random source (mulberry32), so a run can be played again. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the view under test -------------------------------------------------------------

const snap = (app: App): DesktopSnapshot => {
  const s = app.desktop.snapshot();
  if (!s) throw new Error('the Desktop view is not mounted');
  return s;
};
const parts = (app: App): DesktopParts => {
  const p = app.desktop.parts();
  if (!p) throw new Error('the Desktop view is not mounted');
  return p;
};
const mounted = (app: App): boolean => app.desktop.snapshot() !== null;

/** The middle of the part of Doozer that catches the mouse. */
function doozerAt(app: App): Point {
  const s = snap(app);
  const region = hitRegion(s.stage.size, s.x, s.y);
  return { x: Math.round(region.x + region.w / 2), y: Math.round(region.y + region.h / 2) };
}

const COMFORTABLE: Record<NeedKey, number> = { tummy: 45, fun: 45, energy: 62, clean: 40 };

/** A pet that can do whatever is asked of it. */
function refresh(app: App): void {
  app.brain.debug?.setNeeds(COMFORTABLE);
  if (app.brain.state.treats < 4) app.brain.debug?.addTreats(6);
}

/** Into the Desktop view, awake, at the pace asked for, with nothing in the way of the checks. */
async function enterDesktop(app: App, pace: Pace): Promise<void> {
  const { brain, host } = app;
  await mark('entering the Desktop view', { current: host.current() });
  // Scripted runs must not be hidden by whatever game happens to be in front.
  if (brain.settings.tuckAwayInFullscreen) brain.setSetting('tuckAwayInFullscreen', false);
  if (!brain.settings.soundAsked) brain.setSetting('soundAsked', true);
  if (brain.settings.reduceMotion !== 'off') brain.setSetting('reduceMotion', 'off');
  // The first run's hatching belongs to the Pill's checks.
  host.services.welcomed();
  brain.setSetting('desktopActivity', pace);
  await host.switchTo('desktop');
  await host.settled();
  await sleep(500);
  refresh(app);
  await mark('in the Desktop view', { current: host.current(), mounted: mounted(app), frames: await framesIn(500) });
}

/** Wait until Doozer is at rest with its face back to normal. */
async function atRest(app: App, limitMs = 90_000): Promise<boolean> {
  return waitFor(() => {
    if (!mounted(app)) return false;
    const s = snap(app);
    return s.atRest && !s.busy && s.emotes === 0;
  }, limitMs, 50);
}

/** Bring the pet back to an ordinary waking state and wait for rest at the Still pace. */
async function quietDown(app: App, limitMs = 90_000): Promise<boolean> {
  const { brain } = app;
  await park();
  if (brain.state.focus.status !== 'idle') brain.stopFocus();
  if (brain.state.asleep) brain.wake();
  brain.setSetting('desktopActivity', 'still');
  app.desktop.setOpen('none');
  return atRest(app, limitMs);
}

/** What "idle on the taskbar line with nothing left behind" means, spelled out. */
async function restReport(app: App): Promise<{ ok: boolean; why: string[]; snapshot: Partial<DesktopSnapshot>; native: Partial<Status> }> {
  // Everything about the page is read in one go, before anything is awaited: at the Lively
  // pace Doozer is off again a second after it comes to rest.
  const s = snap(app);
  const p = parts(app);
  const why: string[] = [];
  const doing = ['walk', 'trot', 'peek', 'play', 'carried'];
  if (s.state !== 'idle') why.push(`state is ${s.state}`);
  if (Math.abs(s.y - s.ground) > 0.5) why.push(`not on the line (y ${s.y}, line ${s.ground})`);
  if (s.x < s.stage.minX - 0.5 || s.x > s.stage.maxX + 0.5) why.push(`standing where it may not (x ${s.x})`);
  if (s.open !== 'none' || p.radial.isOpen || p.card.isOpen || p.settings.isOpen) why.push('something is open');
  if (p.world.querySelectorAll('.deskv-prop:not([data-bye])').length > 0) why.push('something was left beside Doozer');
  if (doing.includes(s.pose)) why.push(`standing in the ${s.pose} pose`);
  if (p.pet.dataset.held === '1' || s.pressed) why.push('still held');
  if (app.desktop.hitRegions().length !== 1) why.push(`${app.desktop.hitRegions().length} hit regions`);
  // What the page drew is what the view says.
  const box = p.pet.getBoundingClientRect();
  if (Math.abs(box.left + box.width / 2 - s.x) > 1.5 || Math.abs(box.top + box.height * 0.93 - s.y) > 1.5) why.push('drawn somewhere other than where it is');
  await shell.regionsFlushed();
  // A button that has just come up takes the shell one look (16 ms) to notice.
  let native = await status();
  for (let waited = 0; waited < 400 && native.holding; waited += 20) {
    await sleep(20);
    native = await status();
  }
  if (native.holding) why.push('the shell thinks a button is held on Doozer');
  if (native.regions !== 1) why.push(`the shell has ${native.regions} regions`);
  return {
    ok: why.length === 0,
    why,
    snapshot: { state: s.state, x: s.x, y: s.y, ground: s.ground, open: s.open, pose: s.pose, props: s.props, timers: s.timers },
    native: { regions: native.regions, catching: native.catching, holding: native.holding, styleClickThrough: native.styleClickThrough },
  };
}

// ---- pressing and carrying, as a hand would --------------------------------------------

/** A whole click on an element: the native side sees the button go down and up on it, and so does the page. */
async function press(target: HTMLElement, at: Point, settleMs = 50): Promise<void> {
  await cursor(at, false);
  await sleep(settleMs);
  pointer(target, 'pointermove', at, 0);
  await cursor(at, true);
  pointer(target, 'pointerdown', at, 1);
  await sleep(Math.max(20, settleMs / 2));
  await cursor(at, false);
  pointer(target, 'pointerup', at, 0);
  target.click();
  await sleep(settleMs);
}

const tapDoozer = (app: App, settleMs = 50): Promise<void> => press(parts(app).hit, doozerAt(app), settleMs);

interface Carry {
  from: Point;
  at: Point;
  /** Samples taken while the button was held on which the window was not catching. */
  letGo: number;
  samples: number;
}

/** Press on Doozer and drag it to `to` in `steps` moves. The button is still down afterwards. */
async function carryTo(app: App, to: Point, options: { steps?: number; stepMs?: number; native?: boolean } = {}): Promise<Carry> {
  const steps = options.steps ?? 10;
  const stepMs = options.stepMs ?? 16;
  const native = options.native ?? true;
  const { hit } = parts(app);
  let from = doozerAt(app);
  if (native) {
    // The pointer arrives on Doozer and rests there before the button goes down, as a hand's
    // does. The shell samples a pointer that has been still only ten times a second, and a
    // press that lands before it has noticed the pointer is on Doozer is, rightly, not the
    // page's: the window was still letting clicks through. (A script that pressed 60 ms
    // after arriving found this out: its carries were never reported as released.)
    // And it follows Doozer while it waits: a Doozer that is walking or floating down has
    // moved on by the time the shell looks.
    await cursor(from, false);
    await sleep(60);
    for (let waited = 0; waited < 800 && !(await status()).catching; waited += 20) {
      from = doozerAt(app);
      await cursor(from, false);
      await sleep(20);
    }
    from = doozerAt(app);
    await cursor(from, true);
  }
  const carry: Carry = { from, at: from, letGo: 0, samples: 0 };
  pointer(hit, 'pointerdown', from, 1);
  await sleep(30);
  for (let i = 1; i <= steps; i++) {
    const at = { x: Math.round(from.x + ((to.x - from.x) * i) / steps), y: Math.round(from.y + ((to.y - from.y) * i) / steps) };
    if (native) await cursor(at, true);
    pointer(hit, 'pointermove', at, 1);
    carry.at = at;
    await sleep(stepMs);
    if (native && i % 3 === 0) {
      const now = await status();
      carry.samples++;
      // The rule whose absence got the mockup stuck: never pass-through while a button is down.
      if (now.styleClickThrough || !now.catching || !now.holding) carry.letGo++;
    }
  }
  return carry;
}

type Release = 'up' | 'native-only' | 'move-no-button' | 'nothing';

/** Let go, in one of the ways a real release reaches the page (or fails to). */
async function release(app: App, carry: Carry, how: Release): Promise<void> {
  const { hit } = parts(app);
  if (how === 'up') {
    await cursor(carry.at, false);
    pointer(hit, 'pointerup', carry.at, 0);
  } else if (how === 'native-only') {
    // The button comes up. The page is given no pointerup: only the shell can tell it.
    await cursor(carry.at, false);
  } else if (how === 'move-no-button') {
    pointer(hit, 'pointermove', { x: carry.at.x + 6, y: carry.at.y }, 0);
  }
}

// ---- never stuck -----------------------------------------------------------------------

interface SceneCase {
  name: string;
  pace: Pace;
  start(app: App): void | Promise<void>;
}

const SCENES: SceneCase[] = [
  { name: 'stroll (calm)', pace: 'calm', start: (app) => void app.desktop.act('stroll') },
  { name: 'stroll (lively)', pace: 'lively', start: (app) => void app.desktop.act('stroll') },
  { name: 'peek (lively)', pace: 'lively', start: (app) => void app.desktop.act('peek') },
  { name: 'meal (calm)', pace: 'calm', start: (app) => void app.brain.feed() },
  { name: 'meal (lively)', pace: 'lively', start: (app) => void app.brain.feed() },
  { name: 'treat (lively)', pace: 'lively', start: (app) => void app.brain.giveTreat() },
  { name: 'ball (calm)', pace: 'calm', start: (app) => void app.brain.play() },
  { name: 'ball (lively)', pace: 'lively', start: (app) => void app.brain.play() },
  { name: 'wash', pace: 'calm', start: (app) => void app.brain.wash() },
  { name: 'celebrate', pace: 'calm', start: (app) => { app.brain.startFocus(); app.brain.debug?.finishFocusNow(); } },
  { name: 'fall asleep', pace: 'calm', start: (app) => void app.brain.sleep() },
  {
    name: 'float down', pace: 'calm',
    start: async (app) => {
      const s = snap(app);
      const carry = await carryTo(app, { x: Math.round(s.stage.w * 0.4), y: Math.round(s.stage.h * 0.25) }, { steps: 6 });
      await release(app, carry, 'up');
    },
  },
];

const CUTS_MS = [0, 250, 700, 1500, 2800];

const OTHER_ACTIONS: ((app: App) => void)[] = [
  (app) => void app.brain.feed(),
  (app) => void app.brain.play(),
  (app) => void app.brain.wash(),
  (app) => void app.brain.giveTreat(),
  (app) => void app.brain.toggleSleep(),
  (app) => void app.brain.startFocus(),
  (app) => { app.brain.debug?.setNeeds({ tummy: 100 }); app.brain.feed(); },
];

type Interrupt = (app: App, turn: number) => Promise<string[]>;

const INTERRUPTS: [string, Interrupt][] = [
  ['picked up, held, dropped', async (app) => {
    const problems: string[] = [];
    const s0 = snap(app);
    const carry = await carryTo(app, { x: Math.round(s0.stage.w * 0.3), y: Math.round(s0.stage.h * 0.4) });
    const s = snap(app);
    if (s.state !== 'carried') problems.push(`not picked up (${s.state})`);
    if (s.scene !== null || s.props !== 0 || s.open !== 'none') problems.push('the scene was not cleared away when Doozer was picked up');
    if (carry.letGo > 0) problems.push(`the window let go ${carry.letGo} times of ${carry.samples} while the button was down`);
    await sleep(700);
    if (snap(app).state !== 'carried') problems.push('did not stay in the hand');
    await release(app, carry, 'up');
    return problems;
  }],
  ['picked up, and the mouse-up never arrives', async (app) => {
    const problems: string[] = [];
    const s0 = snap(app);
    const carry = await carryTo(app, { x: Math.round(s0.stage.w * 0.6), y: Math.round(s0.stage.h * 0.3) });
    if (snap(app).state !== 'carried') problems.push('not picked up');
    await release(app, carry, 'native-only');
    if (!(await waitFor(() => snap(app).state !== 'carried', 1500, 4))) problems.push('still carried 1.5 s after the button came up');
    return problems;
  }],
  ['another action started', async (app, turn) => {
    OTHER_ACTIONS[turn % OTHER_ACTIONS.length]?.(app);
    return [];
  }],
  ['the view switched to the Pill and back', async (app, turn) => {
    const problems: string[] = [];
    await app.host.switchTo('pill');
    if (app.host.current() !== 'pill') problems.push('did not reach the Pill');
    if (mounted(app)) problems.push('the Desktop view is still mounted behind the Pill');
    await sleep(turn % 2 === 0 ? 150 : 900);
    await app.host.switchTo('desktop');
    await app.host.settled();
    if (!mounted(app)) problems.push('did not come back to the Desktop');
    return problems;
  }],
  ['tucked away and brought back', async (app) => {
    const problems: string[] = [];
    app.brain.setSetting('tuckAwayInFullscreen', true);
    app.host.setFullscreen(true);
    await sleep(350);
    const s = snap(app);
    const native = await status();
    if (s.timers.length > 0) problems.push(`timers still running while tucked away: ${s.timers.join(', ')}`);
    if (native.visible || native.regions !== 0) problems.push('still on screen or still catching while tucked away');
    await sleep(600);
    app.host.setFullscreen(false);
    app.brain.setSetting('tuckAwayInFullscreen', false);
    await sleep(200);
    return problems;
  }],
];

/** Every scene, interrupted at several moments, in every way; and the carry cases. */
const stuck: Scenario = async (app) => {
  const failures: string[] = [];
  const out: Record<string, unknown> = {};
  await enterDesktop(app, 'still');
  await atRest(app, 10_000);
  const released: unknown[] = [];
  const offReleased = shell.on('pointer-released', (at) => released.push(at));

  await mark('stuck: the drag test');
  // 1. The mockup's drag test: a fast, far drag, let go in mid-air.
  const first = snap(app);
  const far = { x: Math.round(first.x - 540), y: Math.round(first.y - 470) };
  let carry = await carryTo(app, far, { steps: 12, stepMs: 16 });
  const inHand = snap(app);
  await release(app, carry, 'up');
  const floating = snap(app).state;
  const landedA = await atRest(app, 8000);
  const afterA = await restReport(app);
  check(failures, {
    'drag: Doozer was picked up': inHand.state === 'carried' && inHand.pose === 'carried',
    'drag: the window never let go while the button was down': carry.letGo === 0 && carry.samples >= 3,
    'drag: let go in mid-air, it floats': floating === 'float',
    'drag: it lands on the line and stays near that spot': landedA && afterA.ok && Math.abs(snap(app).x - (far.x + (first.x - carry.from.x))) < 40,
  });
  out.drag = { carry, floating, afterA };

  await mark('stuck: the mouse-up never arrives');
  // 2. The same drag, and the mouse-up never arrives.
  await sleep(400);
  released.length = 0;
  const second = snap(app);
  carry = await carryTo(app, { x: Math.round(second.x + 500), y: Math.round(second.y - 420) }, { steps: 12, stepMs: 16 });
  const held = { state: snap(app).state, native: await status() };
  const t0 = performance.now();
  await release(app, carry, 'native-only');
  const ended = await waitFor(() => snap(app).state !== 'carried', 2000, 2);
  const endedAfterMs = Math.round((performance.now() - t0) * 10) / 10;
  const landedB = await atRest(app, 8000);
  await park();
  await sleep(250);
  const afterB = await restReport(app);
  const restedNative = await status();
  check(failures, {
    'lost mouse-up: the press went to the page': held.state === 'carried' && held.native.holding && held.native.catching,
    'lost mouse-up: the window never let go while the button was down': carry.letGo === 0,
    'lost mouse-up: the carry ended without a mouse-up': ended,
    'lost mouse-up: the shell said so exactly once': released.length === 1,
    'lost mouse-up: Doozer is back on the line': landedB && afterB.ok,
    'lost mouse-up: click-through again at rest': restedNative.styleClickThrough && !restedNative.catching && !restedNative.holding,
    'lost mouse-up: counted as ended by the shell': (snap(app).drops.released ?? 0) === 1,
  });
  out.lostMouseUp = { endedAfterMs, released: released.length, afterB };

  // 3. The shell never saw the press at all (so it will never say it ended): the next
  //    pointer move with no button ends the carry.
  carry = await carryTo(app, { x: Math.round(snap(app).x - 300), y: 400 }, { native: false });
  const pageOnly = snap(app).state;
  await release(app, carry, 'move-no-button');
  const endedC = snap(app).state !== 'carried';
  const landedC = await atRest(app, 8000);
  check(failures, {
    'no word from the shell: picked up': pageOnly === 'carried',
    'no word from the shell: a move with no button ends it': endedC && landedC && (await restReport(app)).ok,
  });

  await mark('stuck: silence');
  // 4. Nothing at all is heard again: the carry gives up by itself.
  carry = await carryTo(app, { x: Math.round(snap(app).x + 200), y: 500 }, { native: false });
  const t1 = performance.now();
  const endedD = await waitFor(() => snap(app).state !== 'carried', 34_000, 200);
  const silentMs = Math.round(performance.now() - t1);
  const landedD = await atRest(app, 8000);
  check(failures, {
    'silence: the carry gives up by itself after half a minute': endedD && silentMs > 28_000 && silentMs < 33_000,
    'silence: Doozer is back on the line': landedD && (await restReport(app)).ok,
  });
  out.silence = { silentMs };

  // 5. Every scene, cut at several moments, in every way.
  const cuts: unknown[] = [];
  let turn = 0;
  for (const scene of SCENES) {
    await mark(`stuck: cutting ${scene.name}`, { failuresSoFar: failures.length });
    for (const cutAt of CUTS_MS) {
      for (const [how, interrupt] of INTERRUPTS) {
        turn++;
        refresh(app);
        app.brain.setSetting('desktopActivity', scene.pace);
        await scene.start(app);
        await sleep(cutAt);
        const problems = await interrupt(app, turn);
        await sleep(300);
        if (!(await quietDown(app))) problems.push('did not come to rest');
        await sleep(120);
        const rest = await restReport(app);
        problems.push(...rest.why);
        if (problems.length > 0) failures.push(`${scene.name}, ${how}, at ${cutAt} ms: ${problems.join('; ')}`);
        cuts.push({ scene: scene.name, how, cutAt, problems });
      }
    }
  }
  out.cuts = { count: cuts.length, failed: cuts.filter((cut) => (cut as { problems: string[] }).problems.length > 0) };

  await mark('stuck: rapid clicks');
  // 6. Rapid clicks on Doozer and on the Radial.
  await quietDown(app);
  refresh(app);
  for (let i = 0; i < 40; i++) await tapDoozer(app, 15 + (i % 4) * 25);
  for (let round = 0; round < 12; round++) {
    await sleep(330);
    await tapDoozer(app, 40);
    const s = snap(app);
    if (s.open === 'radial') {
      const ids = ['feed', 'play', 'wash', 'sleep', 'treat', 'more'];
      const button = parts(app).radial.el.querySelector<HTMLElement>(`[data-id="${ids[round % ids.length]}"]`);
      if (button) {
        const box = button.getBoundingClientRect();
        const at = { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
        for (let i = 0; i < 5; i++) await press(button, at, 20);
      }
    }
  }
  const afterRapid = await quietDown(app);
  await sleep(200);
  const rapidRest = await restReport(app);
  check(failures, { 'rapid clicks: everything comes to rest': afterRapid && rapidRest.ok });
  out.rapid = rapidRest;

  // Everything above must have got by without the watchdog.
  const before = snap(app);
  check(failures, {
    'the watchdog had nothing to rescue': before.rescues.length === 0,
    'no scene had to be ended by its time limit': before.overruns.length === 0,
  });
  out.rescues = before.rescues;
  out.overruns = before.overruns;
  out.scenes = before.scenes;
  out.drops = before.drops;

  await mark('stuck: the watchdog, on purpose');
  // 7. Control: break the view on purpose, and the watchdog puts it right.
  const control: unknown[] = [];
  for (const what of ['off-the-line', 'stuck-pose', 'ghost-carry', 'litter', 'lost-timers'] as Sabotage[]) {
    app.brain.setSetting('desktopActivity', what === 'lost-timers' ? 'calm' : 'still');
    await sleep(200);
    const had = snap(app).rescues.length;
    app.desktop.sabotage(what);
    const rescued = await waitFor(() => snap(app).rescues.length > had, 7000, 100);
    await sleep(150);
    const rest = await restReport(app);
    if (!rescued || !rest.ok) failures.push(`watchdog control: ${what} was ${rescued ? 'rescued but not put right' : 'not noticed'}`);
    control.push({ what, rescued, problems: snap(app).rescues.at(-1)?.problems, rest: rest.why });
  }
  out.watchdogControl = control;

  offReleased();
  await quietDown(app);
  await app.host.settled();
  return { failures, ...out };
};

// ---- the window: geometry, click-through, focus, memory ----------------------------------

interface Probe { label: string; at: Point; down?: boolean }
type Reading = { label: string; styleClickThrough: boolean; hitIsDoozer: boolean; error?: string };

const inRegion = (region: Region, x: number, y: number): boolean => {
  if (x < region.x || y < region.y || x >= region.x + region.w || y >= region.y + region.h) return false;
  const r = Math.max(0, Math.min(region.r ?? 0, region.w / 2, region.h / 2));
  if (r <= 0) return true;
  const cx = Math.min(region.x + region.w - r, Math.max(region.x + r, x));
  const cy = Math.min(region.y + region.h - r, Math.max(region.y + r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** How close a point is to the edge of any region. Points on an edge are not probed: a pixel either way is not the question. */
const nearEdge = (regions: Region[], x: number, y: number, slack = 3): boolean =>
  regions.some((region) => {
    const votes = [inRegion(region, x - slack, y), inRegion(region, x + slack, y), inRegion(region, x, y - slack), inRegion(region, x, y + slack), inRegion(region, x, y)];
    return votes.some((v) => v !== votes[0]);
  });

/** What the page itself would answer to at this point: the view's own things, or nothing. */
function pageAnswers(at: Point): boolean {
  const target = document.elementFromPoint(at.x, at.y);
  return !!target?.closest('.deskv-hit, .dzk-rb, .dzk-card, .dzk-settings, .deskv-ball');
}

/** A grid across the whole work area, kept off the very edges. */
function grid(w: number, h: number, columns = 9, rows = 6): Probe[] {
  const points: Probe[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const at = { x: Math.round(((column + 0.5) * w) / columns), y: Math.round(((row + 0.5) * h) / rows) };
      points.push({ label: `grid ${column},${row}`, at });
    }
  }
  return points;
}

/** Points on and just around each thing that catches the mouse. */
function around(regions: Region[], w: number, h: number): Probe[] {
  const points: Probe[] = [];
  regions.forEach((region, i) => {
    const cx = Math.round(region.x + region.w / 2);
    const cy = Math.round(region.y + region.h / 2);
    points.push({ label: `on thing ${i}`, at: { x: cx, y: cy } });
    for (const [name, at] of [
      ['left of', { x: Math.round(region.x - 9), y: cy }],
      ['right of', { x: Math.round(region.x + region.w + 9), y: cy }],
      ['above', { x: cx, y: Math.round(region.y - 9) }],
      ['in the corner of', { x: Math.round(region.x + 2), y: Math.round(region.y + 2) }],
    ] as [string, Point][]) {
      if (at.x > 1 && at.y > 1 && at.x < w - 1 && at.y < h - 1) points.push({ label: `${name} thing ${i}`, at });
    }
  });
  return points;
}

interface ProbeTotals { points: number; wrong: number; skipped: number; states: Record<string, { points: number; wrong: number }> }

/**
 * Put the pretend cursor on each point and compare three things that must agree: what the
 * view told the shell to catch, what the page itself would answer to there, and what the
 * window's real style says. `moving`: Doozer is on the move, so points are taken one at a
 * time and one that Doozer passed over in the meantime is skipped rather than guessed.
 */
async function probeState(app: App, state: string, failures: string[], totals: ProbeTotals, options: { moving?: boolean; extra?: Probe[]; gridOnly?: boolean; keepOpen?: boolean } = {}): Promise<void> {
  const s = snap(app);
  const tally = (totals.states[state] ??= { points: 0, wrong: 0 });
  const points = [...grid(s.stage.w, s.stage.h), ...(options.gridOnly ? [] : around(app.desktop.hitRegions(), s.stage.w, s.stage.h)), ...(options.extra ?? [])];
  const one = async (probe: Probe): Promise<void> => {
    if (options.keepOpen) {
      // A menu left alone closes by itself. Someone is still here: the pointer is on it.
      const { radial, root } = parts(app);
      pointer(radial.isOpen ? radial.el : root, 'pointerover', { x: 1, y: 1 }, 0);
      pointer(window, 'pointermove', { x: 1, y: 1 }, 0);
    }
    const regionsBefore = app.desktop.hitRegions();
    if (nearEdge(regionsBefore, probe.at.x, probe.at.y)) { totals.skipped++; return; }
    const expected = regionsBefore.some((region) => inRegion(region, probe.at.x, probe.at.y));
    const readings = await invoke<Reading[]>('spike_probe', { points: [{ label: probe.label, x: probe.at.x, y: probe.at.y, down: probe.down ?? false }], settleMs: options.moving ? 70 : 120 });
    const got = readings[0];
    const regionsAfter = app.desktop.hitRegions();
    const after = regionsAfter.some((region) => inRegion(region, probe.at.x, probe.at.y));
    if (after !== expected || nearEdge(regionsAfter, probe.at.x, probe.at.y, 12)) {
      if (options.moving) { totals.skipped++; return; }
    }
    const page = pageAnswers(probe.at);
    totals.points++;
    tally.points++;
    const problems: string[] = [];
    if (!got || got.error) problems.push('could not be probed');
    else if (got.styleClickThrough === expected) problems.push(expected ? 'the window lets the click through where the view wants it' : 'THE WINDOW CATCHES A CLICK MEANT FOR ANOTHER APPLICATION');
    if (page !== expected && !options.moving) problems.push(page ? 'the page has something there that the window does not catch' : 'the window catches where the page has nothing');
    if (problems.length > 0) {
      totals.wrong++;
      tally.wrong++;
      failures.push(`click-through, ${state}, ${probe.label} (${probe.at.x}, ${probe.at.y}): ${problems.join('; ')}`);
    }
  };
  for (const probe of points) await one(probe);
  await park();
}

const windowChecks: Scenario = async (app) => {
  const failures: string[] = [];
  const out: Record<string, unknown> = {};
  const { brain, host } = app;
  await enterDesktop(app, 'still');
  await atRest(app, 10_000);

  // --- where the window is, and where Doozer is in it ---
  const info = await shell.windowInfo();
  const native = await status();
  const s = snap(app);
  const p = parts(app);
  const work = info?.monitor.work;
  const full = info?.monitor.full;
  const hidden = !!work && !!full && work.w === full.w && work.h === full.h;
  const hitBox = p.hit.getBoundingClientRect();
  const model = hitRegion(s.stage.size, s.x, s.y);
  const petBox = p.pet.getBoundingClientRect();
  check(failures, {
    'the window is the overlay': native.kind === 'overlay' && native.view === 'desktop',
    'the overlay is the work area (less one pixel when the taskbar hides itself)': !!work && !!native.bounds
      && native.bounds.x === work.x && native.bounds.y === work.y && native.bounds.w === work.w && native.bounds.h === work.h - (hidden ? 1 : 0),
    'the page is the size the view thinks it is': Math.abs(window.innerWidth - s.stage.w) <= 1 && Math.abs(window.innerHeight - s.stage.h) <= 1,
    'Doozer stands on the bottom edge': Math.abs(s.y - s.ground) < 0.5 && s.ground > s.stage.h - 12 && s.ground < s.stage.h,
    // The sprite's box runs a hair past the edge; what is drawn in it (down to the shadow) does not.
    'nothing of Doozer is drawn below the edge': petBox.top + petBox.height * 0.975 <= window.innerHeight + 0.5,
    'what catches the mouse is drawn where the shell is told it is': Math.abs(hitBox.left - model.x) < 0.75 && Math.abs(hitBox.top - model.y) < 0.75
      && Math.abs(hitBox.width - model.w) < 0.75 && Math.abs(hitBox.height - model.h) < 0.75,
    'its corners are rounded the same in the page and in the shell': Math.abs(Number.parseFloat(getComputedStyle(p.hit).borderTopLeftRadius) - (model.r ?? 0)) < 0.75,
    'at rest only Doozer catches the mouse': native.regions === 1 && app.desktop.hitRegions().length === 1,
    'the window refuses keyboard focus': native.styleNoActivate && !native.focusable,
  });
  out.window = { bounds: native.bounds, work, full, scale: native.scale, taskbar: s.stage.taskbar, stage: s.stage, hitBox: { x: hitBox.left, y: hitBox.top, w: hitBox.width, h: hitBox.height }, model };

  // --- click-through, in every state ---
  const totals: ProbeTotals = { points: 0, wrong: 0, skipped: 0, states: {} };
  await mark('window: probing at rest');
  await probeState(app, 'at rest', failures, totals);
  await mark('window: the Radial', { totals });

  // The Radial: the buttons' real boxes are where the shell was told they would be.
  await tapDoozer(app);
  await sleep(600);
  const radialRegions = app.desktop.hitRegions().slice(1);
  const buttons = [...p.radial.el.querySelectorAll<HTMLElement>('.dzk-rb')].map((b) => b.getBoundingClientRect());
  const radialMatches = buttons.length === 6 && radialRegions.length === 6 && buttons.every((box, i) => {
    const region = radialRegions[i];
    return !!region && Math.abs(box.left - region.x) < 1 && Math.abs(box.top - region.y) < 1 && Math.abs(box.width - region.w) < 1;
  });
  check(failures, { 'the Radial\'s buttons are where the shell is told they are': radialMatches && snap(app).open === 'radial' });
  await probeState(app, 'Radial open', failures, totals, { keepOpen: true });
  out.radial = { buttons: buttons.map((b) => ({ x: Math.round(b.left), y: Math.round(b.top), w: b.width })), regions: radialRegions };
  app.desktop.setOpen('none');

  await mark('window: the Card', { totals });
  app.desktop.setOpen('card');
  await sleep(600);
  const cardBox = p.card.el.getBoundingClientRect();
  const cardRegion = app.desktop.hitRegions()[1];
  check(failures, {
    'the Card is where the shell is told it is': !!cardRegion && Math.abs(cardBox.left - cardRegion.x) < 1 && Math.abs(cardBox.top - cardRegion.y) < 1
      && Math.abs(cardBox.width - cardRegion.w) < 1 && Math.abs(cardBox.height - cardRegion.h) < 1.5,
    'the Card is on the screen, over Doozer\'s head': cardBox.top >= 0 && cardBox.left >= 0 && cardBox.right <= window.innerWidth && cardBox.bottom < s.y - s.stage.size * 0.7,
  });
  await probeState(app, 'Card open', failures, totals, { keepOpen: true });
  out.card = { box: { x: cardBox.left, y: cardBox.top, w: cardBox.width, h: cardBox.height }, region: cardRegion };

  app.desktop.openSettings?.();
  await sleep(600);
  const inSettings = await status();
  check(failures, {
    'settings: a click may give the window the keyboard, and opening them took none': inSettings.focusable && !inSettings.styleNoActivate && !inSettings.isForeground,
  });
  await probeState(app, 'settings open', failures, totals, { keepOpen: true });
  app.desktop.setOpen('none');
  await sleep(200);
  check(failures, { 'settings closed: the window refuses focus again': (await status()).styleNoActivate });

  await mark('window: carried', { totals });
  // Carried: a press that began on Doozer stays Doozer's wherever the pointer goes, and
  // the region is under the pointer all the way.
  const carry = await carryTo(app, { x: Math.round(s.stage.w * 0.5), y: Math.round(s.stage.h * 0.3) });
  const heldReadings = await invoke<Reading[]>('spike_probe', {
    points: grid(s.stage.w, s.stage.h, 5, 3).map((probe) => ({ label: probe.label, x: probe.at.x, y: probe.at.y, down: true })), settleMs: 60,
  });
  const keptHold = heldReadings.every((reading) => reading.styleClickThrough === false);
  await cursor(carry.at, true);
  pointer(p.hit, 'pointermove', carry.at, 1);
  await sleep(60);
  const stillCarried = snap(app).state === 'carried';
  await release(app, carry, 'up');
  check(failures, {
    'carried: the window never lets go while the button is down, wherever the pointer is': keptHold && carry.letGo === 0,
    'carried: Doozer is still in the hand afterwards': stillCarried,
  });
  totals.points += heldReadings.length;
  totals.states.carried = { points: heldReadings.length, wrong: heldReadings.filter((reading) => reading.styleClickThrough).length };
  // Floating down: only Doozer catches, and it can be caught.
  await probeState(app, 'floating down', failures, totals, { moving: true, gridOnly: true });
  await atRest(app, 8000);

  // A press that begins somewhere else is not Doozer's, even as it is dragged across Doozer.
  const here = doozerAt(app);
  const across = await invoke<Reading[]>('spike_probe', {
    points: [
      { label: 'pressed far away', x: Math.round(s.stage.w * 0.2), y: Math.round(s.stage.h * 0.2), down: true },
      { label: 'dragged onto Doozer', x: here.x, y: here.y, down: true },
      { label: 'dragged off again', x: here.x + 200, y: here.y - 200, down: true },
    ],
    settleMs: 120,
  });
  check(failures, { 'a drag begun in another application is not taken as it crosses Doozer': across.every((reading) => reading.styleClickThrough === true) });
  totals.points += across.length;
  await park();
  await sleep(250);

  await mark('window: walking', { totals });
  // Walking: the region is where Doozer is, all the way.
  brain.setSetting('desktopActivity', 'calm');
  let walked = 0;
  let onDoozerWrong = 0;
  for (let attempt = 0; attempt < 4 && walked < 12; attempt++) {
    if (!app.desktop.act('stroll')) { await sleep(300); continue; }
    while (snap(app).scene === 'stroll' && walked < 12) {
      const at = doozerAt(app);
      const got = (await invoke<Reading[]>('spike_probe', { points: [{ label: 'on Doozer, walking', x: at.x, y: at.y }], settleMs: 60 }))[0];
      const far = (await invoke<Reading[]>('spike_probe', { points: [{ label: 'well ahead of Doozer', x: at.x > s.stage.w / 2 ? at.x - 400 : at.x + 400, y: at.y }], settleMs: 60 }))[0];
      walked++;
      if (!got || got.styleClickThrough || !far || !far.styleClickThrough) onDoozerWrong++;
    }
  }
  check(failures, { 'walking: the hit region stays on Doozer': walked >= 6 && onDoozerWrong === 0 });
  totals.points += walked * 2;
  totals.states.walking = { points: walked * 2, wrong: onDoozerWrong };
  out.walking = { walked, onDoozerWrong };
  await park();
  await quietDown(app);

  await mark('window: peeking', { totals });
  // Half off the screen for a peek.
  brain.setSetting('desktopActivity', 'lively');
  if (app.desktop.act('peek')) {
    const reached = await waitFor(() => snap(app).pose === 'peek', 60_000, 50);
    if (reached) {
      const region = app.desktop.hitRegions()[0];
      check(failures, { 'peeking: only the half of Doozer on the screen catches the mouse': !!region && region.x >= 0 && region.x + region.w <= snap(app).stage.w && region.w < s.stage.size * 0.5 });
      await probeState(app, 'peeking', failures, totals, { moving: true });
    } else failures.push('peeking: Doozer never reached the edge');
  } else failures.push('peeking: Doozer would not peek');
  await quietDown(app);

  await mark('window: ball and snack', { totals });
  // The ball in play, and a snack on the ground.
  brain.setSetting('desktopActivity', 'calm');
  refresh(app);
  brain.play();
  await sleep(500);
  check(failures, { 'ball: the ball catches the mouse too': app.desktop.hitRegions().length === 2 && (await status()).regions === 2 });
  await probeState(app, 'ball in play', failures, totals, { moving: true, gridOnly: true });
  await quietDown(app);
  brain.setSetting('desktopActivity', 'calm');
  refresh(app);
  brain.feed();
  await sleep(250);
  check(failures, { 'snack: a snack on the ground does not catch the mouse': app.desktop.hitRegions().length === 1 });
  await probeState(app, 'eating', failures, totals, { moving: true, gridOnly: true });
  await quietDown(app);

  // Asleep.
  brain.debug?.setNeeds({ energy: 40 });
  brain.sleep();
  await sleep(2500);
  await probeState(app, 'asleep', failures, totals);
  brain.wake();
  await quietDown(app);

  await mark('window: a focus session across views', { totals, failuresSoFar: failures.length });
  // --- a focus session, carried to the Pill and back ---
  refresh(app);
  brain.setSetting('desktopActivity', 'lively');
  await sleep(300);
  const before = { ...brain.state, needs: { ...brain.state.needs } };
  const startOk = brain.startFocus().ok;
  const startedAt = performance.now();
  const full25 = brain.state.focus.remainingMs;
  await sleep(1500);
  const sat = snap(app);
  await probeState(app, 'focusing', failures, totals);
  // Hover: the time left appears.
  const at = doozerAt(app);
  await cursor(at, false);
  pointer(p.hit, 'pointermove', at, 0);
  await sleep(260);
  pointer(p.hit, 'pointermove', at, 0);
  await sleep(120);
  const hovered = snap(app);
  const chipText = p.chip.textContent ?? '';
  const chipCatches = app.desktop.hitRegions().length;
  pointer(p.hit, 'pointerleave', at, 0);
  await park();
  await sleep(150);
  const unhovered = snap(app).chip;
  check(failures, {
    'focus: a session starts': startOk && brain.state.quiet,
    'focus: glasses on, sitting still': p.doozer.el.dataset.glasses === '1' && sat.scene === null && sat.state === 'idle',
    'focus: the time left shows only while the pointer is on Doozer': !sat.chip && hovered.chip && /^\d\d:\d\d$/.test(chipText) && !unhovered,
    'focus: the chip itself catches nothing': chipCatches === 1,
  });

  const inDesktop = brain.state.focus.remainingMs;
  await host.switchTo('pill');
  await host.settled();
  await sleep(700);
  const pill = app.pill.snapshot();
  const inPill = brain.state.focus;
  const elapsedA = performance.now() - startedAt;
  brain.pauseFocus();
  await sleep(400);
  const paused = brain.state.focus;
  // Paused, Doozer may wander (only a running session keeps it still): keep it Still for the comparison.
  brain.setSetting('desktopActivity', 'still');
  await host.switchTo('desktop');
  await host.settled();
  await sleep(700);
  const back = brain.state.focus;
  const backSnap = snap(app);
  const backGlasses = parts(app).doozer.el.dataset.glasses === '1';
  brain.setSetting('desktopActivity', 'lively');
  brain.resumeFocus();
  await sleep(6000);
  const resumed = brain.state.focus;
  const strolls = (s: DesktopSnapshot): number => (s.scenes.stroll?.finished ?? 0) + (s.scenes.stroll?.interrupted ?? 0);
  const stayedPut = Math.abs(snap(app).x - backSnap.x) < 0.5 && strolls(snap(app)) === strolls(backSnap) && snap(app).scene === null;
  // Where exactly Doozer stood does not carry over (spec 5.1): it comes back at its spot.
  const sameSpot = Math.abs(backSnap.x - backSnap.home) < 1.5 && Math.abs(backSnap.home - sat.home) < 1.5;
  check(failures, {
    'switch mid-session: the Pill shows the same countdown': !!pill && /^\d\d:\d\d$/.test(pill.status) && inPill.status === 'running'
      && Math.abs(full25 - inPill.remainingMs - elapsedA) < 1200 && inPill.remainingMs <= inDesktop,
    'switch mid-session: paused in the Pill, still paused back in the Desktop, glasses on': paused.status === 'paused' && back.status === 'paused'
      && Math.abs(back.remainingMs - paused.remainingMs) < 50 && backGlasses,
    'switch mid-session: resumed in the Desktop, it counts down and Doozer sits still': resumed.status === 'running' && resumed.remainingMs < back.remainingMs - 4000 && stayedPut,
    'switch mid-session: Doozer is back at its spot': sameSpot,
    'switch mid-session: nothing about the pet changed': brain.state.treats === before.treats && brain.state.streak.current === before.streak.current
      && brain.state.sessionsCompleted === before.sessionsCompleted && brain.state.bowl === before.bowl
      && (Object.keys(before.needs) as NeedKey[]).every((key) => Math.abs(brain.state.needs[key] - before.needs[key]) <= 1),
  });
  // And it ends in the Desktop view: the treats land and Doozer celebrates.
  const treatsBefore = brain.state.treats;
  const sessionsBefore = brain.state.sessionsCompleted;
  brain.debug?.finishFocusNow();
  await sleep(250);
  const celebrating = snap(app).scene;
  const earned = brain.state.treats - treatsBefore;
  await quietDown(app);
  check(failures, {
    'session end: Doozer celebrates and the treats land': celebrating === 'celebrate' && earned >= 2 && brain.state.sessionsCompleted === sessionsBefore + 1,
    'session end: glasses off, back to rest': parts(app).doozer.el.dataset.glasses === '0' && (await restReport(app)).ok,
  });
  out.focus = { full25, inDesktop, inPill: inPill.remainingMs, paused: paused.remainingMs, back: back.remainingMs, resumed: resumed.remainingMs, earned, chipText };

  await mark('window: the spot');
  // --- the spot is remembered, for this monitor, in the save ---
  const spotCarry = await carryTo(app, { x: Math.round(s.stage.w * 0.31), y: Math.round(s.stage.h * 0.6) });
  await release(app, spotCarry, 'up');
  await atRest(app, 8000);
  const leftAt = snap(app).x;
  await host.flush();
  const saved = parseSave((await shell.load()).data);
  const spots = readSpots(saved.host.memory?.desktop);
  const spot = spots[snap(app).stage.monitor];
  await host.switchTo('pill');
  await host.settled();
  await sleep(400);
  await host.switchTo('desktop');
  await host.settled();
  await sleep(600);
  check(failures, {
    'spot: where Doozer was put down is in the save, under this monitor': !!spot && Math.abs(spot.f * snap(app).stage.w - leftAt) < 1.5,
    'spot: back from another view, Doozer is where it was left': Math.abs(snap(app).x - leftAt) < 1.5 && Math.abs(snap(app).home - leftAt) < 1.5,
    'last view is the Desktop': brain.settings.lastView === 'desktop',
  });
  out.spot = { leftAt, saved: spots };

  await mark('window: tucked away');
  // --- tucked away ---
  brain.setSetting('tuckAwayInFullscreen', true);
  host.setFullscreen(true);
  await sleep(400);
  const tucked = { snap: snap(app), native: await status() };
  await probeState(app, 'tucked away', failures, totals, { gridOnly: true });
  host.setFullscreen(false);
  await sleep(500);
  const untucked = { snap: snap(app), native: await status() };
  check(failures, {
    'tuck away: hidden, nothing catches the mouse, every timer stopped': !tucked.native.visible && tucked.native.regions === 0 && tucked.snap.timers.length === 0 && !tucked.snap.lively,
    'tuck away: back as it was, and no focus taken': untucked.native.visible && untucked.native.regions === 1 && untucked.snap.timers.includes('watchdog') && !untucked.native.isForeground,
  });
  host.setFullscreen(await shell.fullscreenInFront());
  brain.setSetting('tuckAwayInFullscreen', false);

  const end = snap(app);
  check(failures, {
    'click-through: every probe agreed': totals.wrong === 0 && totals.points > 300,
    'the watchdog had nothing to rescue': end.rescues.length === 0,
    'no scene had to be ended by its time limit': end.overruns.length === 0,
  });
  out.probes = totals;
  out.rescues = end.rescues;
  out.overruns = end.overruns;
  await quietDown(app);
  await host.settled();
  return { failures, ...out };
};

// ---- the soak ------------------------------------------------------------------------

interface SoakReport {
  seed: number;
  startedAt: string;
  minutesAsked: number;
  minutesRun: number;
  finished: boolean;
  actions: number;
  byKind: Record<string, number>;
  /** Times the run stopped acting and waited for Doozer to come to rest by itself. */
  restChecks: number;
  restFailures: unknown[];
  slowestRestMs: number;
  /** What the watchdog had to put right. Each one is a bug to explain. */
  rescues: unknown[];
  /** Scenes ended by their time limit, or that threw. */
  overruns: unknown[];
  scenes: unknown;
  drops: unknown;
  /** How late the page's own clock ran at worst (a hidden window may be slowed down). */
  worstTimerLatenessMs: number;
  /** Times the shell found the page silent and dropped its hit regions. */
  nativeWatchdogTrips: number;
  memory: { atMinute: number; heapMB: number | null; nodes: number }[];
  /** The last things done before each rescue, to explain it by. */
  beforeRescue: unknown[];
  end: unknown;
  verdict: string;
}

/**
 * Hours of random injected actions, in the background. Ends with Doozer left alone and
 * the question the plan asks: is it idle on the taskbar line?
 */
const soak: Scenario = async (app, args) => {
  const failures: string[] = [];
  const minutes = Number(args.minutes ?? 180);
  const seed = Number(args.seed ?? 20261113);
  const random = seeded(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const between = (lo: number, hi: number): number => lo + random() * (hi - lo);
  const { brain, host } = app;
  await enterDesktop(app, 'lively');

  const result: SoakReport = {
    seed, startedAt: new Date().toISOString(), minutesAsked: minutes, minutesRun: 0, finished: false, actions: 0, byKind: {},
    restChecks: 0, restFailures: [], slowestRestMs: 0, rescues: [], overruns: [], scenes: {}, drops: {}, worstTimerLatenessMs: 0,
    nativeWatchdogTrips: 0, memory: [], beforeRescue: [], end: null, verdict: 'still running',
  };
  const recent: string[] = [];
  let knownRescues = 0;
  let held: Carry | null = null;

  // How late does the page's own clock run? (A window nobody can see may be slowed down.)
  let lateness = 0;
  let expectedAt = performance.now() + 500;
  const lateTimer = setInterval(() => {
    const now = performance.now();
    lateness = Math.max(lateness, now - expectedAt);
    expectedAt = now + 500;
  }, 500);

  /** The view is only there while the Desktop is the view on screen. */
  const here = (): boolean => host.current() === 'desktop' && mounted(app);
  const pointOn = (fx: number, fy: number): Point => {
    const s = snap(app);
    return { x: Math.round(s.stage.w * fx), y: Math.round(s.stage.h * fy) };
  };

  type Action = [name: string, weight: number, run: () => Promise<void>];
  const actions: Action[] = [
    ['wait', 20, async () => { await sleep(between(800, 6000)); }],
    ['tap Doozer', 8, async () => { await tapDoozer(app, between(15, 80)); }],
    ['press a Radial button', 9, async () => {
      if (snap(app).open !== 'radial') await tapDoozer(app, 40);
      await sleep(between(120, 500));
      if (!here() || snap(app).open !== 'radial') return;
      const button = parts(app).radial.el.querySelector<HTMLElement>(`[data-id="${pick(['feed', 'play', 'wash', 'sleep', 'treat', 'more'])}"]`);
      if (!button) return;
      const box = button.getBoundingClientRect();
      await press(button, { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }, 30);
    }],
    ['carry, let go', 8, async () => {
      const carry = await carryTo(app, pointOn(between(0.03, 0.97), between(0.05, 0.99)), { steps: Math.round(between(2, 14)), stepMs: between(8, 40) });
      await sleep(between(0, 900));
      await release(app, carry, 'up');
    }],
    ['carry, mouse-up lost', 6, async () => {
      const carry = await carryTo(app, pointOn(between(0.03, 0.97), between(0.05, 0.9)), { steps: Math.round(between(2, 12)) });
      await sleep(between(0, 600));
      await release(app, carry, 'native-only');
    }],
    ['carry the shell never saw, then a move with no button', 3, async () => {
      const carry = await carryTo(app, pointOn(between(0.1, 0.9), between(0.1, 0.8)), { native: false, steps: 5 });
      await sleep(between(100, 1500));
      await release(app, carry, 'move-no-button');
    }],
    ['carry and keep holding', 4, async () => {
      held = await carryTo(app, pointOn(between(0.1, 0.9), between(0.1, 0.8)), { steps: 6 });
    }],
    ['carry, then silence', 1, async () => {
      await carryTo(app, pointOn(between(0.2, 0.8), between(0.2, 0.7)), { native: false, steps: 4 });
      // No release of any kind. The carry has to give up by itself (half a minute).
    }],
    ['feed', 5, async () => { brain.feed(); }],
    ['treat', 4, async () => { brain.giveTreat(); }],
    ['play', 6, async () => { brain.play(); }],
    ['wash', 4, async () => { brain.wash(); }],
    ['pet', 3, async () => { brain.pet(); }],
    ['fill the bowl', 2, async () => { brain.fillBowl(); }],
    ['nap', 2, async () => { brain.debug?.setNeeds({ energy: 50 }); brain.sleep(); }],
    ['wake', 4, async () => { brain.wake(); }],
    ['focus: start', 3, async () => { brain.startFocus(); }],
    ['focus: pause or resume', 2, async () => { if (brain.state.focus.status === 'running') brain.pauseFocus(); else brain.resumeFocus(); }],
    ['focus: stop', 3, async () => { brain.stopFocus(); }],
    ['focus: finish', 2, async () => { if (brain.state.focus.status !== 'idle') brain.debug?.finishFocusNow(); }],
    ['change pace', 5, async () => { brain.setSetting('desktopActivity', pick(['still', 'calm', 'lively', 'lively'] as const)); }],
    ['change size', 2, async () => { brain.setSetting('size', { ...brain.settings.size, desktop: pick(['small', 'medium', 'large'] as const) }); }],
    ['change colour', 1, async () => { brain.setSetting('palette', pick(['peach', 'mint', 'lavender', 'butter', 'sky'] as const)); }],
    ['reduce motion on', 1, async () => { brain.setSetting('reduceMotion', 'on'); }],
    ['reduce motion off', 3, async () => { brain.setSetting('reduceMotion', 'off'); }],
    ['to the Pill and back', 3, async () => {
      await host.switchTo('pill');
      await sleep(between(100, 2500));
      await host.switchTo('desktop');
      await host.settled();
    }],
    ['tuck away and back', 2, async () => {
      brain.setSetting('tuckAwayInFullscreen', true);
      host.setFullscreen(true);
      await sleep(between(300, 4000));
      host.setFullscreen(false);
      brain.setSetting('tuckAwayInFullscreen', false);
    }],
    ['open the Card and press something', 4, async () => {
      app.desktop.setOpen('card');
      await sleep(between(200, 700));
      if (!here() || snap(app).open !== 'card') return;
      const act = pick(['feed', 'play', 'wash', 'sleep', 'fill', 'treat', 'focus', 'focus-stop', 'mute', 'settings']);
      const button = parts(app).card.el.querySelector<HTMLElement>(`[data-act="${act}"]`);
      if (!button || button.hidden) return;
      const box = button.getBoundingClientRect();
      await press(button, { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }, 30);
    }],
    ['open the settings from the tray', 1, async () => { await invoke('spike_menu', { id: 'settings' }); }],
    ['close whatever is open', 3, async () => { app.desktop.setOpen('none'); }],
    ['bop the ball', 3, async () => {
      const node = parts(app).world.querySelector<HTMLElement>('.deskv-ball:not([data-bye])');
      if (!node) return;
      const box = node.getBoundingClientRect();
      pointer(node, 'pointerdown', { x: Math.round(box.left + between(4, 30)), y: Math.round(box.top + 18) }, 1);
      pointer(node, 'pointerup', { x: Math.round(box.left + 18), y: Math.round(box.top + 18) }, 0);
    }],
    ['stroke Doozer', 3, async () => {
      const at = doozerAt(app);
      const { hit } = parts(app);
      await cursor(at, false);
      for (let i = 0; i < 14; i++) {
        pointer(hit, 'pointermove', { x: at.x + (i % 2 ? 14 : -14), y: at.y }, 0, { x: 28, y: 0 });
        await sleep(45);
      }
      pointer(hit, 'pointerleave', at, 0);
    }],
    ['a stray release, cancel or blur', 3, async () => {
      const what = pick(['up', 'cancel', 'blur', 'lost', 'move'] as const);
      const { hit } = parts(app);
      const at = pointOn(between(0, 1), between(0, 1));
      if (what === 'up') pointer(window, 'pointerup', at, 0);
      else if (what === 'cancel') pointer(hit, 'pointercancel', at, 0);
      else if (what === 'blur') window.dispatchEvent(new Event('blur'));
      else if (what === 'lost') pointer(hit, 'lostpointercapture', at, 0);
      else pointer(window, 'pointermove', at, pick([0, 1]));
    }],
    ['the display says it changed', 1, async () => {
      const info = await shell.windowInfo();
      if (info) app.desktop.windowChanged?.(info);
    }],
    ['a stroll or a peek, now', 6, async () => { app.desktop.act(pick(['stroll', 'peek', 'peek', 'gesture'] as const)); }],
  ];
  const totalWeight = actions.reduce((sum, action) => sum + action[1], 0);
  const choose = (): Action => {
    let roll = random() * totalWeight;
    for (const action of actions) {
      roll -= action[1];
      if (roll < 0) return action;
    }
    return actions[0] as Action;
  };

  const harvest = async (): Promise<void> => {
    if (!here()) return;
    const s = snap(app);
    if (s.rescues.length > knownRescues) {
      result.beforeRescue.push({ rescue: s.rescues.slice(knownRescues), actions: [...recent] });
      knownRescues = s.rescues.length;
    }
    result.rescues = s.rescues;
    result.overruns = s.overruns;
    result.scenes = s.scenes;
    result.drops = s.drops;
    result.worstTimerLatenessMs = Math.round(lateness);
    result.nativeWatchdogTrips = (await status()).stats.watchdogTrips;
  };

  /** Stop acting, let go of anything held, and wait for Doozer to come to rest of its own accord. */
  const restCheck = async (limitMs: number): Promise<boolean> => {
    if (held && here()) await release(app, held, 'up');
    held = null;
    await park();
    if (!here()) {
      await host.switchTo('desktop');
      await host.settled();
    }
    // Anything open would keep it from resting; a hand would close it or leave it to close itself.
    app.desktop.setOpen('none');
    const t0 = performance.now();
    const ok = await atRest(app, limitMs);
    const took = Math.round(performance.now() - t0);
    result.restChecks++;
    result.slowestRestMs = Math.max(result.slowestRestMs, took);
    const rest = ok ? await restReport(app) : null;
    // The pretend pointer was parked a moment ago; the shell looks ten times a second.
    let native = await status();
    for (let waited = 0; waited < 600 && (native.catching || !native.styleClickThrough); waited += 30) {
      await sleep(30);
      native = await status();
    }
    const clickThrough = native.styleClickThrough && !native.catching && !native.holding;
    if (!ok || !rest?.ok || !clickThrough) {
      const s = snap(app);
      result.restFailures.push({
        atAction: result.actions, tookMs: took, why: rest?.why ?? ['did not come to rest'], clickThrough,
        snapshot: { state: s.state, scene: s.scene, x: s.x, y: s.y, ground: s.ground, open: s.open, pose: s.pose, props: s.props, timers: s.timers, pace: s.pace },
        recent: [...recent],
      });
      return false;
    }
    return true;
  };

  const started = performance.now();
  const endAt = started + minutes * 60_000;
  let nextReport = started + 60_000;
  let nextMemory = started;
  while (performance.now() < endAt) {
    if (!here()) {
      await host.switchTo('desktop');
      await host.settled();
    }
    const [name, , run] = choose();
    recent.push(`${Math.round((performance.now() - started) / 100) / 10}s ${name}`);
    if (recent.length > 14) recent.shift();
    try {
      // A hand that is holding Doozer lets go before it does anything else with the mouse.
      if (held && here() && /carry|tap|press|stroke|bop/.test(name)) {
        await release(app, held, random() < 0.5 ? 'up' : 'native-only');
        held = null;
        await sleep(between(50, 400));
      }
      if (here()) await run();
    } catch (error) {
      result.restFailures.push({ atAction: result.actions, threw: String(error), during: name });
    }
    result.actions++;
    result.byKind[name] = (result.byKind[name] ?? 0) + 1;
    await sleep(between(150, 2600));
    if (result.actions % 20 === 0) refresh(app);
    await harvest();

    // Every so often: hands off, and see that Doozer comes to rest by itself.
    if (result.actions % 40 === 0) await restCheck(100_000);

    const now = performance.now();
    if (now >= nextMemory) {
      nextMemory = now + 10 * 60_000;
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      result.memory.push({ atMinute: Math.round((now - started) / 60_000), heapMB: heap ? Math.round(heap / 1048576 * 10) / 10 : null, nodes: document.getElementsByTagName('*').length });
    }
    if (now >= nextReport) {
      nextReport = now + 60_000;
      result.minutesRun = Math.round((now - started) / 6000) / 10;
      await report(String(args.tag ?? 'app-desktop-soak') + '.progress.json', result);
    }
  }

  // The end: hands off. Whatever pace it was left at, is Doozer idle on the taskbar line?
  clearInterval(lateTimer);
  result.minutesRun = Math.round((performance.now() - started) / 6000) / 10;
  if (brain.state.focus.status !== 'idle') brain.stopFocus();
  const final = await restCheck(150_000);
  await harvest();
  const s = snap(app);
  result.end = { atRest: final, state: s.state, x: s.x, y: s.y, ground: s.ground, onTheLine: Math.abs(s.y - s.ground) < 0.5, pace: s.pace, asleep: brain.state.asleep, rest: await restReport(app) };
  result.finished = true;
  check(failures, {
    'soak: it ran for the time asked': result.minutesRun >= minutes - 1,
    'soak: Doozer ends idle on the taskbar line': final && s.state === 'idle' && Math.abs(s.y - s.ground) < 0.5,
    'soak: every hands-off check found Doozer at rest': result.restFailures.length === 0,
    'soak: the watchdog had nothing to rescue': (result.rescues as unknown[]).length === 0,
    'soak: no scene had to be ended by its time limit': (result.overruns as unknown[]).length === 0,
    'soak: the shell never found the page silent': result.nativeWatchdogTrips === 0,
  });
  result.verdict = failures.length === 0 ? 'idle on the taskbar line, with nothing rescued' : failures.join('; ');
  await report(String(args.tag ?? 'app-desktop-soak') + '.progress.json', result);
  return { failures, ...result };
};

// ---- idle, for the cost measurement --------------------------------------------------

/**
 * Sit in the Desktop view at one pace, as it would all day. Never finishes;
 * scripts/measure-idle.ps1 samples it. `{"pace":"calm"}`, and optionally `"focus": true`
 * or `"asleep": true`.
 */
const idle: Scenario = async (app, args) => {
  const pace = (['still', 'calm', 'lively'] as const).find((p) => p === args.pace) ?? 'calm';
  await enterDesktop(app, pace);
  app.brain.debug?.setNeeds({ tummy: 85, fun: 85, energy: 85, clean: 85 });
  if (args.focus === true) app.brain.startFocus();
  if (args.asleep === true) { app.brain.debug?.setNeeds({ energy: 40 }); app.brain.sleep(); }
  await park();
  await report('idle-ready.json', { ready: true, at: Date.now(), pace, snap: app.desktop.snapshot(), status: await status() });
  // Leave a trace of what Doozer did while it was being measured.
  setInterval(() => {
    const s = app.desktop.snapshot();
    if (s) void report('idle-activity.json', { at: Date.now(), pace, scenes: s.scenes, rescues: s.rescues, overruns: s.overruns, state: s.state, lively: s.lively });
  }, 20_000);
  return new Promise(() => undefined);
};

/** A quick look at whether the view comes up at all in this window, and what the page's clock is like there. */
const hello: Scenario = async (app) => {
  const failures: string[] = [];
  const framesBefore = await framesIn(500);
  await enterDesktop(app, 'still');
  const s = snap(app);
  const native = await status();
  const t0 = performance.now();
  await sleep(1000);
  const sleptMs = Math.round(performance.now() - t0);
  const frames = await framesIn(1000);
  check(failures, {
    'the Desktop view is on screen': app.host.current() === 'desktop' && native.kind === 'overlay',
    'Doozer is at rest on the line': s.state === 'idle' && Math.abs(s.y - s.ground) < 0.5,
    'the clock of the page keeps time': sleptMs < 1300,
  });
  return { failures, framesBefore, frames, sleptMs, visibility: document.visibilityState, snapshot: s, native };
};

const SCENARIOS: Record<string, Scenario> = {
  'app-desktop-hello': hello,
  'app-desktop-stuck': stuck,
  'app-desktop-window': windowChecks,
  'app-desktop-soak': soak,
  'app-desktop-idle': idle,
};

export async function runDesktopChecks(app: App, run: TestRun): Promise<void> {
  const args = run.args ?? {};
  const names = scenarioNames(run);
  const whole: Record<string, unknown> = { run, startedAt: new Date().toISOString(), scenarios: {} };
  const results = whole.scenarios as Record<string, unknown>;
  for (const name of names) {
    const scenario = SCENARIOS[name];
    try {
      results[name] = scenario ? await scenario(app, (args[name] as Record<string, unknown> | undefined) ?? args) : { failures: ['unknown scenario'] };
    } catch (error) {
      results[name] = { failures: [`threw: ${String(error)}`], stack: error instanceof Error ? error.stack : undefined };
    }
  }
  whole.finishedAt = new Date().toISOString();
  whole.endStatus = await status();
  whole.endSnapshot = app.desktop.snapshot();
  await invoke('spike_inject', { cursor: null });
  await report(`${String(args.tag ?? names.join('+'))}.json`, whole);
  if (args.exit === false) return;
  // Quit the way a person would, through the tray menu: the page is told, saves, and answers.
  await invoke('spike_menu', { id: 'quit' });
}
