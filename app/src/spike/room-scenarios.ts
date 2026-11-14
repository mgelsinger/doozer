// Scripted runs of the Room view (Phase 7) in the real window. See docs/room-checks.md
// for what they showed.
//
// Started like the other app runs (docs/pill-checks.md section 6): a build made with
// `--features spike`, DOOZER_SPIKE set to one or more names from the table at the
// bottom, DOOZER_SAVE_DIR pointing at a scratch folder. `scripts/run-room-checks.ps1`
// does all of that. A normal build never loads this file.
//
// The runs keep the real mouse out. A press is made twice over, as a real press is: the
// native cursor tracker is fed a pretend cursor and button (so the window's
// click-through state, the window drag and the shell's `drag-end` and
// `pointer-released` are the real ones), and the page is given the matching pointer
// events. Nothing moves the user's pointer, and with DOOZER_SPIKE_CLOAK=1 nothing
// appears on screen either.

import { invoke } from '@tauri-apps/api/core';
import type { App } from '../main';
import { parseSave } from '../host/store';
import { shell } from '../shell';
import type { RoomSnapshot } from '../views/room';
import { BAND, SPOT, roomGeometry, type FurnitureId } from '../views/room/layout';

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
  dragging: boolean;
  holding: boolean;
  isForeground: boolean;
}

type Point = { x: number; y: number };
type Result = { failures: string[] } & Record<string, unknown>;
export type RoomScenario = (app: App, args: Record<string, unknown>) => Promise<Result>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const status = (): Promise<Status> => invoke<Status>('shell_status');
/** Far outside every monitor: the pretend cursor's resting place. */
const PARKED = { x: -30000, y: -30000, screen: true, down: false };
const park = (): Promise<unknown> => invoke('spike_inject', { cursor: PARKED });
const cursor = (at: Point, down: boolean): Promise<unknown> => invoke('spike_inject', { cursor: { ...at, down } });

const centre = (node: Element): Point => {
  const box = node.getBoundingClientRect();
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
};

async function waitFor(test: () => boolean, limitMs: number, stepMs = 25): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < limitMs) {
    if (test()) return true;
    await sleep(stepMs);
  }
  return test();
}

function pointer(target: Element, type: string, at: Point, buttons: number): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 92, isPrimary: true, pointerType: 'mouse', button: 0, buttons, clientX: at.x, clientY: at.y,
  }));
}

/** A whole press on an element: the native side sees the button go down and up on it, and so does the page. */
async function press(target: HTMLElement, settleMs = 50): Promise<void> {
  const at = centre(target);
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

function check(failures: string[], checks: Record<string, boolean>): void {
  for (const [name, ok] of Object.entries(checks)) if (!ok) failures.push(name);
}

const RESTING_POSE: Record<string, readonly string[]> = { free: ['idle', 'sulk', 'drowsy'], bed: ['sleep'], reading: ['read'] };

/** What is wrong with "Doozer is where it belongs, doing nothing, with nothing left lying about", or ''. */
function unrest(s: RoomSnapshot): string {
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

function pieces(app: App) {
  const parts = app.room.parts();
  if (!parts) throw new Error('the Room view is not mounted');
  const snap = (): RoomSnapshot => app.room.snapshot() as RoomSnapshot;
  return { ...parts, snap };
}

/** Wait until Doozer has come to rest. Returns '' or what was still wrong when the time ran out. */
async function settle(app: App, limitMs = 30_000): Promise<string> {
  const { snap } = pieces(app);
  await waitFor(() => { const s = snap(); return unrest(s) === '' && !s.busy && s.emotes === 0; }, limitMs, 60);
  const s = snap();
  return unrest(s) || (s.busy ? 'still pulling a face' : s.emotes ? 'emotes left' : '');
}

/** Scripted runs must not be hidden by whatever game happens to be in front. */
async function stayAwake(app: App): Promise<void> {
  if (app.brain.settings.tuckAwayInFullscreen) app.brain.setSetting('tuckAwayInFullscreen', false);
  await app.host.settled();
  await sleep(150);
}

/** From a fresh start (the Pill, a pet just hatching) into the Room. */
async function enterRoom(app: App): Promise<void> {
  await stayAwake(app);
  if (!app.brain.settings.soundAsked) app.brain.setSetting('soundAsked', true);
  if (app.host.current() === 'pill') await waitFor(() => !app.pill.snapshot()?.hatching, 16_000, 50);
  await app.host.switchTo('room');
  await app.host.settled();
  await sleep(500);
  await park();
}

/** A pet that will say yes to everything. */
function ready(app: App): void {
  const { brain } = app;
  if (brain.state.asleep) brain.wake();
  brain.stopFocus();
  brain.debug?.setNeeds({ tummy: 75, fun: 40, energy: 70, clean: 40 });
  brain.debug?.addTreats(6);
  app.room.setOpen('none');
}

/**
 * Drag the window by its title bar, `travel` physical pixels, with a pretend pointer.
 * The page is given the press and the first few pixels of travel, as it would be, and
 * then NOTHING: no pointerup, no further pointermove, no click. The mouse-up "never
 * arrives". The native side sees the pretend button come up, as it would the real one.
 */
async function dragWindow(app: App, travel: { dx: number; dy: number }) {
  const room = pieces(app);
  const dragEnds: { x: number; y: number }[] = [];
  let releases = 0;
  const offEnd = shell.on('drag-end', (info) => dragEnds.push({ x: info.x, y: info.y }));
  const offUp = shell.on('pointer-released', () => { releases++; });
  const startBounds = (await status()).bounds;
  const titleBox = room.title.getBoundingClientRect();
  const grab: Point = { x: Math.round(titleBox.left + titleBox.width * 0.3), y: Math.round(titleBox.top + titleBox.height / 2) };
  await cursor(grab, false);
  await sleep(120);
  await cursor(grab, true);
  pointer(room.title, 'pointerdown', grab, 1);
  await sleep(60);
  const pressed = room.snap().pressed;
  // The first few pixels of travel: the page sees them and asks the shell to take over.
  pointer(room.root, 'pointermove', { x: grab.x + 9, y: grab.y + 5 }, 1);
  const began = await waitFor(() => room.snap().dragging, 1000, 10);
  await sleep(80);
  const whileHeld = await status();
  // From here the native side moves the window. The cursor travels; the page hears nothing more.
  const scale = window.devicePixelRatio;
  const screenAt = (dx: number, dy: number) => ({ x: Math.round((startBounds?.x ?? 0) + grab.x * scale + dx), y: Math.round((startBounds?.y ?? 0) + grab.y * scale + dy), screen: true });
  let leftWhileHeld = 0;
  for (let i = 1; i <= 14; i++) {
    await invoke('spike_inject', { cursor: { ...screenAt((travel.dx * i) / 14, (travel.dy * i) / 14), down: true } });
    await sleep(24);
    if (i % 4 === 0) {
      const now = await status();
      if (!now.dragging || now.styleClickThrough) leftWhileHeld++;
    }
  }
  const movedBounds = (await status()).bounds;
  const stillDragging = room.snap().dragging;
  // The button comes up, far from where it went down.
  await invoke('spike_inject', { cursor: { ...screenAt(travel.dx, travel.dy), down: false } });
  const t0 = performance.now();
  const ended = await waitFor(() => !room.snap().dragging, 2000, 4);
  const endedAfterMs = Math.round((performance.now() - t0) * 10) / 10;
  await sleep(300);
  await park();
  await sleep(300);
  const rested = await status();
  offEnd();
  offUp();
  return { pressed, began, whileHeld, leftWhileHeld, stillDragging, startBounds, movedBounds, ended, endedAfterMs, rested, dragEnds, releases };
}

// ---- every row of the furniture table --------------------------------------------------

const furnitureRun: RoomScenario = async (app) => {
  const failures: string[] = [];
  const { brain, host } = app;
  await enterRoom(app);
  const { snap, furniture, scene, cardButton, card, doozer } = pieces(app);
  const rows: Record<string, unknown> = {};
  const first = { status: await status(), snap: snap(), regions: app.room.hitRegions() };
  const g = roomGeometry(brain.settings.size.room);
  check(failures, {
    'the Room is on screen': host.current() === 'room' && first.status.view === 'room' && first.status.kind === 'floating' && first.status.visible,
    'the window is the size asked for': !!first.status.bounds && Math.abs(first.status.bounds.w - g.window.width * window.devicePixelRatio) <= 2 && Math.abs(first.status.bounds.h - g.window.height * window.devicePixelRatio) <= 2,
    'the page fills the window': Math.abs(window.innerWidth - g.window.width) <= 1 && Math.abs(window.innerHeight - g.window.height) <= 1,
    'only the frame catches the mouse': first.status.regions === 1 && first.regions.length === 1,
    'Doozer is at rest in the room': unrest(first.snap) === '',
    'the sky is the real time of day': ['day', 'night', 'dawn', 'dusk'].includes(first.snap.sky) && /^\d{1,2}:\d\d (AM|PM)$/.test(first.snap.time),
    'the window never takes the keyboard': first.status.styleNoActivate && !first.status.isForeground,
  });

  // Bowl: fill it; Doozer walks over and eats when hungry.
  brain.debug?.setNeeds({ tummy: 80, fun: 60, energy: 70, clean: 30 });
  await press(furniture.bowl);
  const filled = { brain: brain.state.bowl, drawn: snap().bowl };
  await sleep(1200);
  const leftAlone = snap().scene === null && brain.state.bowl === 3;
  brain.debug?.setNeeds({ tummy: 55 });
  const walking = snap();
  const ateWrong = await settle(app);
  rows.bowl = { filled, leftAlone, walking: { scene: walking.scene, bowl: walking.bowl, pose: walking.pose }, after: { x: snap().x, bowl: snap().bowl, tummy: brain.state.needs.tummy } };
  check(failures, {
    'bowl: a click fills it': filled.brain === 3 && filled.drawn === 3,
    'bowl: not hungry, Doozer leaves it': leftAlone,
    'bowl: hungry, it walks over': walking.scene === 'eat-bowl' && walking.bowl === 3 && walking.pose === 'walk',
    'bowl: it eats a serving and comes to rest at the bowl': ateWrong === '' && snap().x === SPOT.bowl && snap().bowl === 2 && brain.state.bowl === 2 && brain.state.needs.tummy === 87,
  });
  await press(furniture.bowl);
  const refilled = brain.state.bowl;
  await sleep(400);
  await press(furniture.bowl);
  check(failures, {
    'bowl: topped up again': refilled === 3,
    'bowl: a full one is refused with a wiggle': scene.dataset.nudge === 'bowl' || doozer.showing === 'no',
  });
  await settle(app);

  // Ball: toss it; Doozer chases it if it has the energy.
  const funBefore = brain.state.needs.fun;
  const ballBefore = snap().ballX;
  await press(furniture.ball);
  const chasing = snap();
  let ran = 0;
  const x0 = snap().x;
  await waitFor(() => { ran = Math.max(ran, Math.abs(snap().x - x0)); return snap().scene === null; }, 20_000, 50);
  const playWrong = await settle(app);
  brain.debug?.setNeeds({ energy: 6 });
  const tiredFun = brain.state.needs.fun;
  await press(furniture.ball);
  const tired = { scene: snap().scene, fun: brain.state.needs.fun };
  brain.debug?.setNeeds({ energy: 70 });
  rows.ball = { funBefore, funAfter: tiredFun, ballBefore, ballAfter: snap().ballX, ran, tired };
  check(failures, {
    'ball: a click tosses it and Doozer chases': chasing.scene === 'play' && chasing.pose === 'trot' && chasing.ballX !== ballBefore && tiredFun === Math.min(100, funBefore + 28),
    'ball: it really ran about, and came to rest': ran > 40 && playWrong === '',
    'ball: too tired, it is refused': tired.scene === null && tired.fun === tiredFun,
  });
  await settle(app);

  // Soap: a bath, scrubbed where it stands.
  const washAt = snap().x;
  await press(furniture.soap);
  const washing = snap();
  let bubbles = 0;
  let moved = false;
  await waitFor(() => { bubbles = Math.max(bubbles, snap().emotes); moved ||= snap().x !== washAt; return snap().scene === null; }, 12_000, 40);
  const washWrong = await settle(app);
  rows.soap = { clean: brain.state.needs.clean, bubbles, moved };
  check(failures, {
    'soap: a click starts a bath': washing.scene === 'wash' && brain.state.needs.clean === 100,
    'soap: scrubbed where it stands, with bubbles': !moved && bubbles >= 5 && washWrong === '',
  });

  // Lamp: lights off, to bed; lights on, up again.
  await press(furniture.lamp);
  const off = snap();
  const bedWrong = await settle(app);
  const inBed = snap();
  await sleep(400);
  await press(furniture.lamp);
  const on = snap();
  const upWrong = await settle(app);
  rows.lamp = { off: { lamp: off.lamp, scene: off.scene }, inBed: { station: inBed.station, x: inBed.x, pose: inBed.pose }, on: { lamp: on.lamp, scene: on.scene }, up: { station: snap().station, x: snap().x } };
  check(failures, {
    'lamp: lights off sends Doozer to bed': off.lamp === false && off.scene === 'to-bed' && bedWrong === '' && inBed.station === 'bed' && inBed.x === SPOT.bed.x && inBed.pose === 'sleep',
    'lamp: lights on wakes it': on.lamp === true && on.scene === 'get-up' && upWrong === '' && snap().station === 'free' && !brain.state.asleep,
  });
  brain.debug?.setNeeds({ energy: 97 });
  await press(furniture.lamp);
  check(failures, { 'lamp: not sleepy, it stays up': !brain.state.asleep && snap().lamp === true && snap().scene === null });
  brain.debug?.setNeeds({ energy: 70 });
  await settle(app);

  // Bed: the same by the bed.
  await press(furniture.bed);
  const tucked = brain.state.asleep;
  const tuckWrong = await settle(app);
  const asleepIn = snap().station;
  // Asleep it can still be petted, and nothing else gets through.
  const petFun = brain.state.needs.fun;
  await press(pieces(app).petHit);
  const petted = brain.state.needs.fun === petFun + 3 && brain.state.asleep;
  await press(furniture.jar);
  const refusedAsleep = brain.state.asleep && snap().scene === null;
  await sleep(400);
  await press(furniture.bed);
  const woken = !brain.state.asleep;
  const wakeWrong = await settle(app);
  rows.bed = { tucked, asleepIn, petted, refusedAsleep, woken };
  check(failures, {
    'bed: a click tucks Doozer in': tucked && tuckWrong === '' && asleepIn === 'bed',
    'bed: asleep, it can be petted and a treat is refused without waking it': petted && refusedAsleep,
    'bed: another click wakes it': woken && wakeWrong === '' && snap().station === 'free',
  });

  // Treat jar: a treat; Doozer comes running.
  const treats = brain.state.treats;
  await press(furniture.jar);
  const running = snap();
  let snack = 0;
  await waitFor(() => { snack = Math.max(snack, scene.querySelectorAll('.roomv-snack').length); return snap().scene === null; }, 12_000, 40);
  const treatWrong = await settle(app);
  rows.jar = { treats, after: brain.state.treats, x: snap().x, snack };
  check(failures, {
    'jar: a click gives a treat and Doozer comes running': brain.state.treats === treats - 1 && running.scene === 'treat' && (running.pose === 'trot' || running.x === SPOT.jar),
    'jar: it eats under the shelf and comes to rest': snack === 1 && treatWrong === '' && snap().x === SPOT.jar && scene.querySelectorAll('.roomv-snack').length === 0,
  });
  brain.debug?.addTreats(-20);
  await press(furniture.jar);
  check(failures, { 'jar: an empty jar is refused': snap().scene === null && brain.state.treats === 0 });
  brain.debug?.addTreats(4);
  await settle(app);

  // Clock: start a session, Doozer fetches its book; stop it again.
  await press(furniture.clock);
  const started = { focus: brain.state.focus.status, scene: snap().scene, time: snap().time, glasses: doozer.el.dataset.glasses };
  const readWrong = await settle(app);
  const reading = snap();
  await sleep(2200);
  const later = snap().time;
  const clockArt = scene.querySelector('.roomv-f-clock')?.getAttribute('data-status');
  const wedge = scene.querySelector('.roomv-clock-wedge')?.getAttribute('d') ?? '';
  await press(furniture.clock);
  const stopped = { focus: brain.state.focus.status, station: snap().station, time: snap().time };
  const stopWrong = await settle(app);
  rows.clock = { started, reading: { station: reading.station, pose: reading.pose, x: reading.x, book: reading.bookHeld }, later, stopped };
  check(failures, {
    'clock: a click starts a session': started.focus === 'running' && started.scene === 'fetch-book' && started.time === '25:00' && started.glasses === '1',
    'clock: Doozer fetches its book and reads on the rug': readWrong === '' && reading.station === 'reading' && reading.pose === 'read' && reading.x === SPOT.rug && reading.bookHeld,
    'clock: the clock on the shelf runs': clockArt === 'running' && wedge.length > 10 && /^24:5\d$/.test(later),
    'clock: another click stops it, and nothing is lost or owed': stopped.focus === 'idle' && stopped.station === 'free' && /M$/.test(stopped.time) && stopWrong === '' && brain.state.sessionsCompleted === 0,
  });

  // The Card, from the button in the title bar.
  await press(cardButton);
  await sleep(500);
  await shell.regionsFlushed();
  const opened = { snap: snap(), status: await status(), regions: app.room.hitRegions(), cardOpen: card.isOpen };
  // Feed from the Card: the same pet eats, here in the room.
  const feed = card.el.querySelector<HTMLButtonElement>('[data-act="feed"]');
  brain.debug?.setNeeds({ tummy: 50 });
  const tummyBefore = brain.state.needs.tummy;
  if (feed) await press(feed);
  const fedFromCard = { tummy: brain.state.needs.tummy - tummyBefore, scene: snap().scene };
  await sleep(300);
  await press(cardButton);
  await sleep(400);
  const closed = { snap: snap(), status: await status() };
  rows.card = { regions: opened.regions, open: opened.snap.open, cardOpen: opened.cardOpen, nativeRegions: opened.status.regions, fedFromCard };
  check(failures, {
    'card: the title-bar button opens it': opened.snap.open === 'card' && opened.cardOpen,
    'card: the frame, the Card and its close button catch the mouse': opened.regions.length === 3 && opened.status.regions === 3,
    'card: it works on the same pet': fedFromCard.tummy === 32 && fedFromCard.scene === 'eat',
    'card: the window still refuses the keyboard': opened.status.styleNoActivate && !opened.status.focusable && !opened.status.isForeground,
    'card: the button closes it again': closed.snap.open === 'none' && closed.status.regions === 1,
  });

  await park();
  await sleep(300);
  const end = await status();
  check(failures, {
    'at the end: Doozer is at rest': (await settle(app)) === '',
    'at the end: not holding a press, and click-through': !end.holding && end.styleClickThrough && !end.catching,
  });
  await host.flush();
  return { failures, rows, end: snap() };
};

// ---- an hour with a full bowl, on a fast clock ------------------------------------------

/**
 * The pet's hour passes in a minute (the brain's debug time scale); the room itself runs
 * at real speed. A pretend pointer rests in the room throughout, so Doozer keeps the
 * livelier pace it has when somebody is watching.
 */
const hourRun: RoomScenario = async (app, args) => {
  const failures: string[] = [];
  const { brain } = app;
  await enterRoom(app);
  const { snap, furniture, scene } = pieces(app);
  const realSeconds = Number(args.seconds ?? 66);
  const scale = Number(args.timeScale ?? 60);
  // Energy 10 is worn out (4) after 45 pet minutes, so bedtime falls inside the hour.
  brain.debug?.setNeeds({ tummy: 74, fun: 80, energy: Number(args.energy ?? 10), clean: 80 });
  await press(furniture.bowl);
  const start = { needs: { ...brain.state.needs }, bowl: brain.state.bowl };

  const seen = { scenes: {} as Record<string, number>, ate: 0, slept: 0, woke: 0, longestBusyMs: 0, worst: '', samples: 0, lively: 0 };
  const off = brain.on('action', (event) => {
    if (event.type === 'auto-eat') seen.ate++;
    if (event.type === 'sleep') seen.slept++;
    if (event.type === 'wake') seen.woke++;
  });
  // Somebody is watching: the pretend pointer rests in the room, away from the furniture.
  const watcher: Point = (() => { const box = scene.getBoundingClientRect(); return { x: Math.round(box.left + box.width * 0.5), y: Math.round(box.top + box.height * 0.62) }; })();
  await cursor(watcher, false);

  brain.debug?.setTimeScale(scale);
  const t0 = performance.now();
  let last: string | null = null;
  let busySince: number | null = null;
  while (performance.now() - t0 < realSeconds * 1000) {
    pointer(scene, 'pointermove', watcher, 0);
    const s = snap();
    seen.samples++;
    if (s.lively) seen.lively++;
    if (s.scene && s.scene !== last) seen.scenes[s.scene] = (seen.scenes[s.scene] ?? 0) + 1;
    last = s.scene;
    const wrong = unrest(s);
    if (wrong) {
      busySince ??= performance.now();
      const ms = performance.now() - busySince;
      if (ms > seen.longestBusyMs) { seen.longestBusyMs = Math.round(ms); seen.worst = wrong; }
    } else {
      busySince = null;
    }
    await sleep(100);
  }
  brain.debug?.setTimeScale(1);
  off();
  await park();
  const wrong = await settle(app);
  const end = snap();
  const outings = Object.values(seen.scenes).reduce((a, b) => a + b, 0);
  check(failures, {
    'the bowl was full to start with': start.bowl === 3,
    'Doozer ate from the bowl by itself, and the room showed it': seen.ate >= 1 && seen.scenes['eat-bowl'] === seen.ate && end.bowl === brain.state.bowl && brain.state.bowl === 3 - seen.ate,
    // Which outings come up, and how many fit in before bedtime, is dice: two is the least seen.
    'it kept itself busy (wandering, the window, the ball)': outings - (seen.scenes['eat-bowl'] ?? 0) - (seen.scenes['to-bed'] ?? 0) >= 2,
    'worn out, it put itself to bed': seen.slept === 1 && seen.scenes['to-bed'] === 1 && end.station === 'bed' && end.lamp === false && brain.state.asleep,
    'it was never in the middle of something for longer than one scene may last': seen.longestBusyMs <= 16_000,
    'and at the end it is at rest': wrong === '',
    'an hour of pet time really passed': brain.state.needs.clean <= start.needs.clean - 3,
  });
  return { failures, scale, realSeconds, start, seen, end: { snap: end, needs: brain.state.needs, bowl: brain.state.bowl, asleep: brain.state.asleep } };
};

// ---- never stuck ---------------------------------------------------------------------

const stuckRun: RoomScenario = async (app) => {
  const failures: string[] = [];
  const { brain, host } = app;
  await enterRoom(app);
  const { snap, furniture, scene, cardButton } = pieces(app);
  const out: Record<string, unknown> = {};
  const ids: FurnitureId[] = ['bed', 'bowl', 'soap', 'lamp', 'jar', 'clock', 'ball'];

  // 1. Furniture clicked while Doozer is in the middle of a walk.
  const midWalk: unknown[] = [];
  // 1a. On the way to the bowl (the brain allows one serving every five minutes, so once).
  ready(app);
  await press(furniture.bed);
  await settle(app);
  await sleep(350);
  await press(furniture.bed);
  await settle(app);
  brain.fillBowl();
  brain.debug?.setNeeds({ tummy: 55, clean: 30 });
  await sleep(400);
  const before = snap();
  await press(furniture.soap, 20);
  const during = snap();
  let slid = false;
  await waitFor(() => { slid ||= Math.abs(snap().x - during.x) > 0.5; return snap().scene !== 'wash'; }, 10_000, 30);
  const bowlWrong = await settle(app);
  check(failures, {
    'mid-walk to the bowl: Doozer was walking': before.scene === 'eat-bowl' && before.pose === 'walk' && before.x < SPOT.bowl - 5,
    'mid-walk to the bowl: the bath begins and it stops on the spot': during.scene === 'wash' && !slid && during.x < SPOT.bowl,
    'mid-walk to the bowl: it comes to rest, and the bowl shows what the brain has': bowlWrong === '' && snap().bowl === brain.state.bowl,
  });
  // 1b. Every piece of furniture while it chases the ball, at three moments of the chase.
  for (const id of ids) {
    for (const at of [250, 900, 1800]) {
      ready(app);
      await settle(app);
      await press(furniture.ball, 20);
      const started = snap().scene === 'play';
      await sleep(at);
      const moving = snap();
      await press(furniture[id], 20);
      const wrong = await settle(app);
      const ok = started && wrong === '' && snap().bowl === brain.state.bowl;
      if (!ok) failures.push(`mid-chase: ${id} at ${at} ms: ${started ? wrong || 'bowl out of step' : 'the chase did not start'}`);
      midWalk.push({ id, at, pose: moving.pose, scene: moving.scene, ok });
    }
  }
  out.midWalk = midWalk;

  // 2. Each scene interrupted at several moments, by a click on something else.
  const scenes: [string, () => void][] = [
    ['treat', () => void brain.giveTreat()],
    ['play', () => void brain.play()],
    ['wash', () => void brain.wash()],
    ['eat', () => { brain.debug?.setNeeds({ tummy: 60 }); brain.feed(); }],
    ['to-bed', () => void brain.sleep()],
    ['fetch-book', () => void brain.startFocus()],
    ['celebrate', () => { brain.startFocus(); brain.debug?.finishFocusNow(); }],
  ];
  const cuts: unknown[] = [];
  let n = 0;
  for (const [name, start] of scenes) {
    for (const at of [0, 300, 900, 2000]) {
      ready(app);
      // The bowl is kept empty here: a serving eaten in the middle would be a different test.
      await settle(app);
      start();
      const started = snap().scene === name;
      await sleep(at);
      const by = ids[n++ % ids.length] as FurnitureId;
      await press(furniture[by], 20);
      // Every third time the Card is opened and closed on top of it. (Two presses of its
      // button less than 320 ms apart are one press, so a person's pause is left between.)
      if (n % 3 === 0) { await press(cardButton, 20); await sleep(400); await press(cardButton, 20); }
      const wrong = await settle(app);
      const s = snap();
      const left = scene.querySelectorAll('.roomv-snack, .roomv-duck, .roomv-crumb').length;
      const ok = started && wrong === '' && left === 0 && s.open === 'none';
      if (!ok) failures.push(`${name} cut at ${at} ms by ${by}: ${started ? wrong || (left ? `${left} props left` : `the ${s.open} was left open`) : 'did not start'}`);
      cuts.push({ name, at, by, ok, station: s.station });
    }
  }
  out.cuts = cuts;
  ready(app);
  check(failures, { 'after all the interruptions: Doozer comes to rest and the shell is not holding a press': (await settle(app)) === '' && !(await status()).holding });

  // 3. The view switched in the middle of a scene.
  const switches: unknown[] = [];
  for (let i = 0; i < 6; i++) {
    ready(app);
    await settle(app);
    if (i % 2 === 0) brain.giveTreat(); else void brain.play();
    await sleep(200 + i * 300);
    const playing = pieces(app).snap().scene;
    await host.switchTo('pill');
    await host.settled();
    await sleep(250);
    const inPill = { current: host.current(), room: app.room.snapshot(), status: await status(), rooms: document.querySelectorAll('.roomv').length };
    await host.switchTo('room');
    await host.settled();
    await sleep(250);
    const back = { current: host.current(), status: await status(), rooms: document.querySelectorAll('.roomv').length, pills: document.querySelectorAll('.pillv').length };
    const wrong = await settle(app);
    const ok = playing !== null && inPill.current === 'pill' && inPill.room === null && inPill.rooms === 0 && inPill.status.view === 'pill' && inPill.status.regions === 2
      && back.current === 'room' && back.rooms === 1 && back.pills === 0 && back.status.view === 'room' && back.status.regions === 1 && wrong === '';
    if (!ok) failures.push(`switch mid-scene ${i}: ${wrong || JSON.stringify({ playing, inPill: inPill.current, regions: [inPill.status.regions, back.status.regions] })}`);
    switches.push({ i, playing, ok });
  }
  out.switches = switches;

  // 4. A window drag whose mouse-up never arrives.
  ready(app);
  await settle(app);
  const room = pieces(app);
  const travel = { dx: -420, dy: -260 };
  const drag = await dragWindow(app, travel);
  const { startBounds, movedBounds, rested, dragEnds, releases, endedAfterMs } = drag;
  const followed = !!startBounds && !!movedBounds && Math.abs(movedBounds.x - startBounds.x - travel.dx) <= 3 && Math.abs(movedBounds.y - startBounds.y - travel.dy) <= 3;
  check(failures, {
    'lost mouse-up: the press on the title bar was seen': drag.pressed,
    'lost mouse-up: travelling a few pixels started the drag': drag.began && drag.whileHeld.dragging,
    'lost mouse-up: the window followed the pointer and never let go while the button was down': followed && drag.leftWhileHeld === 0 && drag.stillDragging,
    'lost mouse-up: the drag ended without a mouse-up': drag.ended,
    'lost mouse-up: the shell said where the window was put down, once': dragEnds.length === 1,
    'lost mouse-up: nothing is held afterwards, and the window lets clicks through again': !rested.dragging && !rested.holding && rested.styleClickThrough && !rested.catching && room.snap().pressed === false,
    'lost mouse-up: the window stayed where it was dropped': !!rested.bounds && !!movedBounds && rested.bounds.x === movedBounds.x && rested.bounds.y === movedBounds.y,
  });
  out.lostMouseUp = { endedAfterMs, startBounds, movedBounds, dragEnds, releases };
  // The room still works after the drag, where it now is.
  ready(app);
  const treatsNow = brain.state.treats;
  await press(room.furniture.jar);
  check(failures, {
    'lost mouse-up: the furniture still works afterwards': brain.state.treats === treatsNow - 1 && room.snap().scene === 'treat',
    'lost mouse-up: and Doozer comes to rest': (await settle(app)) === '',
  });

  // The place it was dragged to is remembered: away to the Pill and back, and in the save.
  await host.switchTo('pill');
  await host.settled();
  await sleep(200);
  await host.switchTo('room');
  await host.settled();
  await sleep(300);
  const returned = (await status()).bounds;
  await host.flush();
  const saved = parseSave((await shell.load()).data).host.positions.room;
  check(failures, {
    'position: back from the Pill, the room is where it was left': !!returned && !!movedBounds && returned.x === movedBounds.x && returned.y === movedBounds.y,
    'position: it is in the save': !!saved && !!movedBounds && saved.x === movedBounds.x && saved.y === movedBounds.y,
  });
  out.position = { returned, saved };
  await park();
  return { failures, ...out };
};

// ---- Pill to Room and back, mid-session ------------------------------------------------

const switchRun: RoomScenario = async (app) => {
  const failures: string[] = [];
  const { brain, host } = app;
  await stayAwake(app);
  if (!brain.settings.soundAsked) brain.setSetting('soundAsked', true);
  await waitFor(() => !app.pill.snapshot()?.hatching, 16_000, 50);
  const menu0 = await invoke<{ labels?: Record<string, string>; enabled?: Record<string, boolean>; ticked: string[] }>('spike_menu', { id: null });
  const roomButton = app.pill.parts()?.card.el.querySelector<HTMLButtonElement>('[data-view="room"]');
  check(failures, {
    'the Room is no longer "coming soon" in the tray menu': menu0.enabled?.room === true && menu0.labels?.room === 'Room',
    'nor on the Card': !!roomButton && !roomButton.disabled,
  });

  brain.debug?.setNeeds({ tummy: 82, fun: 71, energy: 64, clean: 57 });
  brain.fillBowl();
  brain.debug?.addTreats(3);
  brain.startFocus();
  await sleep(3200);
  const before = { state: brain.state, pill: app.pill.snapshot() };

  // By the tray menu, as a person would.
  await invoke('spike_menu', { id: 'view:room' });
  await waitFor(() => host.current() === 'room', 3000, 20);
  await host.settled();
  await sleep(600);
  const inRoom = { state: brain.state, snap: app.room.snapshot(), status: await status(), menu: await invoke<{ ticked: string[] }>('spike_menu', { id: null }) };
  const same = (a: typeof brain.state, b: typeof brain.state): boolean =>
    a.bowl === b.bowl && a.treats === b.treats && a.sessionsCompleted === b.sessionsCompleted && a.streak.current === b.streak.current
    && (['tummy', 'fun', 'energy', 'clean'] as const).every((key) => a.needs[key] === b.needs[key]);
  check(failures, {
    'the session was running in the Pill': before.state.focus.status === 'running' && /^24:5\d$/.test(before.pill?.status ?? ''),
    'into the Room: it is still running, with the same time left': inRoom.state.focus.status === 'running' && before.state.focus.remainingMs - inRoom.state.focus.remainingMs >= 0 && before.state.focus.remainingMs - inRoom.state.focus.remainingMs <= 5000,
    'into the Room: needs, bowl, jar and streak are the same': same(before.state, inRoom.state),
    'into the Room: Doozer has its book and the clock runs': inRoom.snap?.station === 'reading' && inRoom.snap.pose === 'read' && /^24:5\d$/.test(inRoom.snap.time) && inRoom.snap.bowl === 3,
    'into the Room: the tray ticks the Room, and the window is the Room\'s': inRoom.menu.ticked.join() === 'room' && inRoom.status.view === 'room' && inRoom.status.kind === 'floating' && inRoom.status.regions === 1,
    'into the Room: it is remembered as the last view': brain.settings.lastView === 'room',
  });

  await sleep(2500);
  // Back by the Card's own view row, pressed in the Room.
  app.room.setOpen('card');
  await sleep(450);
  const pillButton = app.room.parts()?.card.el.querySelector<HTMLButtonElement>('[data-view="pill"]');
  if (pillButton) await press(pillButton);
  await waitFor(() => host.current() === 'pill', 3000, 20);
  await host.settled();
  await sleep(600);
  const back = { state: brain.state, pill: app.pill.snapshot(), status: await status() };
  check(failures, {
    'back in the Pill: it is still running, and has kept counting': back.state.focus.status === 'running' && back.state.focus.remainingMs < inRoom.state.focus.remainingMs && inRoom.state.focus.remainingMs - back.state.focus.remainingMs < 8000,
    'back in the Pill: needs, bowl, jar and streak are the same': same(before.state, back.state),
    'back in the Pill: the pill is a countdown again': /^24:[45]\d$/.test(back.pill?.status ?? '') && (back.pill?.ring ?? '').startsWith('focus:') && back.status.view === 'pill' && back.status.regions === 2,
  });

  // Finish it in the Room: the reward is whole.
  await host.switchTo('room');
  await host.settled();
  await sleep(400);
  const treats = brain.state.treats;
  brain.debug?.finishFocusNow();
  await sleep(300);
  const party = app.room.snapshot();
  const wrong = await settle(app);
  check(failures, {
    'finished in the Room: Doozer celebrates and the treats land': party?.scene === 'celebrate' && brain.state.treats === treats + 3 && brain.state.sessionsCompleted === 1 && brain.state.streak.current === 1,
    'finished in the Room: it comes to rest, free again': wrong === '' && app.room.snapshot()?.station === 'free',
    'finished in the Room: Doozer never had the keyboard': !(await status()).isForeground && (await status()).styleNoActivate,
  });
  await host.flush();
  const doc = parseSave((await shell.load()).data).brain as { progress?: { sessions?: number }; settings?: { lastView?: string } } | undefined;
  check(failures, { 'the save holds it, and the app will reopen in the Room': doc?.progress?.sessions === 1 && doc.settings?.lastView === 'room' });
  await park();
  return { failures, before: before.state.focus, inRoom: inRoom.state.focus, back: back.state.focus };
};

/** The app reopens in the Room, with the room where it was left. Needs the save `app-room-switch` left. */
const reopenRun: RoomScenario = async (app) => {
  const failures: string[] = [];
  await stayAwake(app);
  await sleep(600);
  const s = await status();
  const snap = app.room.snapshot();
  check(failures, {
    'the app reopens in the Room': app.host.current() === 'room' && s.view === 'room' && s.kind === 'floating',
    'with yesterday\'s session counted and Doozer at rest': app.brain.state.sessionsCompleted === 1 && !!snap && unrest(snap) === '',
    'and no second hatching': !app.host.services.needsWelcome(),
  });
  return { failures, snap, bounds: s.bounds };
};

// ---- the window: click-through, sizes, tuck-away ----------------------------------------

const windowRun: RoomScenario = async (app) => {
  const failures: string[] = [];
  const { brain, host } = app;
  await enterRoom(app);
  await settle(app);
  const { snap, frame, cardButton, card } = pieces(app);

  type Reading = { label: string; styleClickThrough: boolean; hitIsDoozer: boolean };
  const probe = async (points: { label: string; at: Point; through: boolean }[]): Promise<unknown[]> => {
    const readings = await invoke<Reading[]>('spike_probe', { points: points.map((p) => ({ label: p.label, x: p.at.x, y: p.at.y })), settleMs: 150 });
    return points.map((p, i) => {
      const got = readings[i];
      if (!(got !== undefined && got.styleClickThrough === p.through)) failures.push(`click-through: ${p.label}`);
      return { label: p.label, expectThrough: p.through, got };
    });
  };
  const box = frame.getBoundingClientRect();
  const mid = Math.round(box.left + box.width / 2);
  const closed = await probe([
    { label: 'closed: on the room', at: { x: mid, y: Math.round(box.top + box.height / 2) }, through: false },
    { label: 'closed: on the title bar', at: { x: Math.round(box.left + 80), y: Math.round(box.top + 18) }, through: false },
    { label: 'closed: on the meter strip', at: { x: mid, y: Math.round(box.bottom - 20) }, through: false },
    { label: 'closed: in the band above the room', at: { x: mid, y: Math.round(box.top - 60) }, through: true },
    { label: 'closed: in the band below the room (where the Card will hang)', at: { x: mid, y: Math.round(box.bottom + 60) }, through: true },
    { label: 'closed: just outside the room\'s rounded corner', at: { x: Math.round(box.left + 2), y: Math.round(box.top + 2) }, through: true },
  ]);
  await park();
  await press(cardButton);
  await sleep(500);
  const cardBox = card.el.getBoundingClientRect();
  const open = await probe([
    { label: 'open: on the Card, below the room', at: { x: mid, y: Math.round(Math.min(cardBox.bottom - 20, box.bottom + 40)) }, through: false },
    { label: 'open: beside the Card, below the room', at: { x: Math.round(cardBox.left - 12), y: Math.round(box.bottom + 40) }, through: true },
    { label: 'open: on the room beside the Card', at: { x: Math.round(box.left + 8), y: Math.round(box.top + box.height / 2) }, through: false },
    { label: 'open: in the band above the room', at: { x: mid, y: Math.round(box.top - 60) }, through: true },
  ]);
  // The default spot is the bottom-right corner, with the window's lower band hanging
  // off the work area: there the Card has slid up, and all of it is on the work area.
  const at0 = await shell.windowInfo();
  const cardBottom0 = at0 ? at0.y + Math.round(cardBox.bottom * window.devicePixelRatio) : Infinity;
  const cardFits = cardBox.height > 400 && cardBox.top >= 0 && !!at0 && cardBottom0 <= at0.monitor.work.y + at0.monitor.work.h
    && at0.y + at0.height > at0.monitor.work.y + at0.monitor.work.h && cardBox.top < box.top + 44;
  await park();
  await press(cardButton);
  await sleep(350);
  const again = await probe([{ label: 'closed again: where the Card hung', at: { x: mid, y: Math.round(box.bottom + 60) }, through: true }]);
  await park();
  check(failures, { 'in the screen corner: the Card slid up and is wholly on the work area': cardFits });

  // The three sizes: the window changes, the room's top-left corner stays put.
  const sizes: unknown[] = [];
  const corner = async (): Promise<Point | null> => {
    const s = await status();
    const f = pieces(app).frame.getBoundingClientRect();
    return s.bounds ? { x: Math.round(s.bounds.x + f.left * window.devicePixelRatio), y: Math.round(s.bounds.y + f.top * window.devicePixelRatio) } : null;
  };
  // Dragged up and to the left, clear of every edge (a real drag, pretend pointer): from
  // now on the Room has a place of its own, and the Card has room to hang where it should.
  const b0 = (await status()).bounds;
  const w0 = (await shell.windowInfo())?.monitor.work;
  const lift = b0 && w0 ? Math.min(-120, w0.y + w0.h - 90 - (b0.y + b0.h)) : -400;
  const moved = await dragWindow(app, { dx: -520, dy: lift });
  await press(cardButton);
  await sleep(500);
  const f1 = pieces(app).frame.getBoundingClientRect();
  const c1 = pieces(app).card.el.getBoundingClientRect();
  check(failures, {
    'dragged clear of the edges: the drag moved the window': moved.ended && moved.dragEnds.length === 1 && !!moved.movedBounds && !!b0 && moved.movedBounds.x === b0.x - 520,
    'dragged clear of the edges: the Card hangs under the title bar, centred, all inside the window': Math.abs(c1.top - (f1.top + 44)) <= 2 && Math.abs(c1.left + c1.width / 2 - (f1.left + f1.width / 2)) <= 1 && c1.bottom <= window.innerHeight,
  });
  await press(cardButton);
  await sleep(350);
  await park();
  const home = await corner();
  for (const size of ['small', 'large', 'medium'] as const) {
    brain.setSetting('size', { ...brain.settings.size, room: size });
    await sleep(80);
    await host.settled();
    await sleep(500);
    const g = roomGeometry(size);
    const s = await status();
    const f = pieces(app).frame.getBoundingClientRect();
    const at = await corner();
    const ok = !!s.bounds && Math.abs(s.bounds.w - g.window.width * window.devicePixelRatio) <= 2 && Math.abs(f.width - g.frame.w) <= 1 && Math.abs(f.height - g.frame.h) <= 1
      && s.regions === 1 && !snap().gone && !!home && !!at && Math.abs(at.x - home.x) <= 2 && Math.abs(at.y - home.y) <= 2 && unrest(snap()) === '';
    if (!ok) failures.push(`size ${size}`);
    // What is drawn and what catches the mouse are the same rectangle, in every size.
    const edges = await probe([
      { label: `${size}: just inside the room's right edge`, at: { x: Math.round(f.right - 5), y: Math.round(f.top + f.height / 2) }, through: false },
      { label: `${size}: just outside the room's right edge`, at: { x: Math.round(f.right + 5), y: Math.round(f.top + f.height / 2) }, through: true },
      { label: `${size}: just inside the room's bottom edge`, at: { x: Math.round(f.left + f.width / 2), y: Math.round(f.bottom - 5) }, through: false },
      { label: `${size}: just below the room`, at: { x: Math.round(f.left + f.width / 2), y: Math.round(f.bottom + 5) }, through: true },
      { label: `${size}: just above the room`, at: { x: Math.round(f.left + f.width / 2), y: Math.round(f.top - 5) }, through: true },
      { label: `${size}: just inside the room's top edge`, at: { x: Math.round(f.left + f.width / 2), y: Math.round(f.top + 5) }, through: false },
    ]);
    await park();
    sizes.push({ size, frame: [Math.round(f.width), Math.round(f.height)], bounds: s.bounds, corner: at, ok, edges });
  }

  // The room can sit right at the bottom of the work area: the band below hangs off it.
  // (Asked for through the view's own window(), as the host would after a drag there.)
  const work = (await shell.windowInfo())?.monitor.work;
  const medium = roomGeometry('medium');
  const edge: Record<string, unknown> = {};
  if (work) {
    const lowY = work.y + work.h - Math.round((medium.window.height - BAND) * window.devicePixelRatio);
    const info = await shell.setWindowMode({ ...app.room.window({ settings: brain.settings, position: { x: work.x + 200, y: lowY } }) }, 'room');
    app.room.windowChanged?.(info);
    host.services.regionsChanged();
    await sleep(300);
    const f = pieces(app).frame.getBoundingClientRect();
    const frameBottom = info.y + Math.round(f.bottom * window.devicePixelRatio);
    app.room.setOpen('card');
    await sleep(500);
    const c = pieces(app).card.el.getBoundingClientRect();
    const cardBottom = info.y + Math.round(c.bottom * window.devicePixelRatio);
    edge.frameBottom = frameBottom;
    edge.workBottom = work.y + work.h;
    edge.cardBottom = cardBottom;
    check(failures, {
      'at the bottom edge: the shell let the window hang over the work area': info.y === lowY && info.y + info.height > work.y + work.h,
      'at the bottom edge: the room itself is fully on the work area, close to its edge': frameBottom <= work.y + work.h && work.y + work.h - frameBottom < 40 * window.devicePixelRatio,
      'at the bottom edge: the Card slid up and is fully on the work area': cardBottom <= work.y + work.h && c.height > 400,
    });
    app.room.setOpen('none');
  } else {
    failures.push('the work area could not be read');
  }

  // Tuck away: hidden, every clock stopped; then back as it was.
  // In the middle of a scene. (The setting is switched on only now: with a real game in
  // front, as there often is on this machine, switching it on is already the tuck.)
  brain.debug?.addTreats(2);
  brain.giveTreat();
  await sleep(500);
  const playingWhenTucked = snap().scene;
  brain.setSetting('tuckAwayInFullscreen', true);
  host.setFullscreen(true);
  await sleep(400);
  const tucked = { snap: snap(), status: await status(), awake: host.awake(), playingWhenTucked };
  await sleep(1500);
  const stillTucked = snap();
  host.setFullscreen(false);
  await sleep(500);
  const back = { snap: snap(), status: await status(), awake: host.awake() };
  check(failures, {
    'tuck away: the window is hidden and nothing catches the mouse': !tucked.status.visible && !tucked.awake && tucked.status.regions === 0,
    'tuck away: Doozer was in the middle of eating a treat': playingWhenTucked === 'treat',
    'tuck away: the scene stopped, nothing is left lying about and no timer of the view runs': tucked.snap.scene === null && tucked.snap.timers.length === 0 && !tucked.snap.lively && tucked.snap.props === 0 && tucked.snap.emotes === 0,
    'tuck away: it stays that way': stillTucked.timers.length === 0 && stillTucked.scene === null,
    'tuck away: it comes back, with Doozer where it belongs': back.status.visible && back.awake && back.status.regions === 1 && back.snap.timers.includes('minute') && (await settle(app)) === '',
    'tuck away: coming back took no focus': !back.status.isForeground,
  });
  host.setFullscreen(await shell.fullscreenInFront());
  brain.setSetting('tuckAwayInFullscreen', false);
  await park();
  return { failures, closed, open, again, sizes, edge, tucked: tucked.snap };
};

// ---- idle, for the cost measurement ----------------------------------------------------

/** Sit in the Room doing nothing, as it would all day. Never finishes; scripts/measure-idle.ps1 samples it. */
const idleRun: RoomScenario = async (app, args) => {
  await enterRoom(app);
  const { brain } = app;
  brain.debug?.setNeeds({ tummy: 90, fun: 85, energy: 90, clean: 90 });
  if (args.bowl !== false) brain.fillBowl();
  if (typeof args.hour === 'number') app.room.setSkyHour(args.hour);
  if (args.focus === true) brain.startFocus();
  if (args.card === true) app.room.setOpen('card');
  if (args.asleep === true) { brain.debug?.setNeeds({ energy: 40 }); brain.sleep(); }
  // Experiments, to see what a lively second costs and why (docs/room-checks.md section 6).
  if (typeof args.style === 'string') {
    const sheet = document.createElement('style');
    sheet.textContent = args.style;
    document.head.append(sheet);
  }
  await park();
  await settle(app, 12_000);
  if (args.watch === true) {
    // Somebody is there the whole time: the pretend pointer rests in the room.
    const { scene } = pieces(app);
    const box = scene.getBoundingClientRect();
    const at = { x: Math.round(box.left + box.width * 0.5), y: Math.round(box.top + box.height * 0.62) };
    await cursor(at, false);
    window.setInterval(() => pointer(scene, 'pointermove', at, 0), 300);
  }
  // Count what Doozer gets up to while it is being measured, so the numbers can be read against it.
  const seen: Record<string, number> = {};
  let last: string | null = null;
  let lively = 0;
  let samples = 0;
  const started = Date.now();
  window.setInterval(() => {
    const s = app.room.snapshot();
    if (!s) return;
    samples++;
    if (s.lively) lively++;
    if (s.scene && s.scene !== last) seen[s.scene] = (seen[s.scene] ?? 0) + 1;
    last = s.scene;
    if (samples % 20 === 0) {
      void invoke('spike_report', { name: 'room-idle-seen.json', json: JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), samples, lively, livelyShare: Math.round((lively / samples) * 1000) / 1000, scenes: seen, snap: s }) });
    }
  }, 500);
  await invoke('spike_report', { name: 'idle-ready.json', json: JSON.stringify({ ready: true, at: Date.now(), snap: app.room.snapshot(), status: await status() }) });
  return new Promise(() => undefined);
};

export const ROOM_SCENARIOS: Record<string, RoomScenario> = {
  'app-room-furniture': furnitureRun,
  'app-room-hour': hourRun,
  'app-room-stuck': stuckRun,
  'app-room-switch': switchRun,
  'app-room-reopen': reopenRun,
  'app-room-window': windowRun,
  'app-room-idle': idleRun,
};
