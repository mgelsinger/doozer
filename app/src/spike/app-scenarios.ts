// Scripted runs of the real app (Phase 6): the Pill view, the Card and the host, in the
// real window. See docs/pill-checks.md for what they showed.
//
// Started the same way as the shell's own scenarios (docs/shell-spike.md section 9): a
// build made with `--features spike`, DOOZER_SPIKE set to one or more names from the
// table at the bottom, DOOZER_SAVE_DIR pointing at a scratch folder. A normal build
// never loads this file.
//
// The runs keep the real mouse out. Presses are made twice over, as a real press is:
// the native cursor tracker is fed a pretend cursor and button (so the window's
// click-through state and the shell's `pointer-released` are the real ones), and the
// page is given the matching pointer events. Nothing moves the user's pointer, and with
// DOOZER_SPIKE_CLOAK=1 nothing appears on screen either.

import { invoke } from '@tauri-apps/api/core';
import type { App } from '../main';
import { parseSave } from '../host/store';
import { shell } from '../shell';
import type { PillSnapshot } from '../views/pill';
import { scenarioNames, type TestRun } from './config';
import { ROOM_SCENARIOS } from './room-scenarios';

interface Status {
  kind: string | null;
  view: string | null;
  bounds: { x: number; y: number; w: number; h: number } | null;
  regions: number;
  catching: boolean;
  styleClickThrough: boolean;
  styleNoActivate: boolean;
  styleToolWindow: boolean;
  visible: boolean;
  focusable: boolean;
  topmost: boolean;
  holding: boolean;
  isForeground: boolean;
  foreground: number;
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
    bubbles: true, cancelable: true, pointerId: 91, isPrimary: true, pointerType: 'mouse', button: 0, buttons, clientX: at.x, clientY: at.y,
  }));
}

/** A whole press on an element: the native side sees the button go down and up on it, and so does the page. */
async function press(target: HTMLElement, settleMs = 60): Promise<void> {
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

/**
 * A press on the pill that stands on its own. The pill treats a second press within
 * 320 ms as the same press (a double-click opens the Card once), so a script that means
 * two presses has to leave a gap, as a person would.
 */
async function tap(target: HTMLElement, settleMs = 60): Promise<void> {
  await sleep(360);
  await press(target, settleMs);
}

function pieces(app: App) {
  const parts = app.pill.parts();
  if (!parts) throw new Error('the Pill view is not mounted');
  const button = (act: string): HTMLButtonElement => {
    const found = parts.card.el.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);
    if (!found) throw new Error(`no Card button "${act}"`);
    return found;
  };
  const snap = (): PillSnapshot => app.pill.snapshot() as PillSnapshot;
  return { ...parts, button, snap };
}

/** Wait for everything temporary to end: no scene, no flash, no emote, and the lively spell over. */
async function atRest(app: App, limitMs = 14_000): Promise<boolean> {
  const { snap } = pieces(app);
  return waitFor(() => {
    const s = snap();
    return !s.miniBusy && !s.stageBusy && s.emotes === 0 && !s.lively && !s.pressed && !s.gone && !s.hatching;
  }, limitMs, 100);
}

/** Scripted runs must not be hidden by whatever game happens to be in front. */
async function stayAwake(app: App): Promise<void> {
  if (app.brain.settings.tuckAwayInFullscreen) app.brain.setSetting('tuckAwayInFullscreen', false);
  await app.host.settled();
  await sleep(150);
}

/** Read afresh each time: the compiler would otherwise assume it cannot have changed between two reads. */
const focusStatus = (app: App): string => app.brain.state.focus.status;

/**
 * Watch who has the keyboard while something happens. A person may be using the machine
 * during a run, so the focused window is allowed to change: what must never happen is
 * that it becomes Doozer.
 */
function watchFocus(): { stop(): Promise<{ samples: number; doozerHadFocus: number }> } {
  let running = true;
  let samples = 0;
  let doozerHadFocus = 0;
  const loop = (async () => {
    while (running) {
      const now = await status();
      samples++;
      if (now.isForeground) doozerHadFocus++;
      await sleep(120);
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      return { samples, doozerHadFocus };
    },
  };
}

function check(failures: string[], checks: Record<string, boolean>): void {
  for (const [name, ok] of Object.entries(checks)) if (!ok) failures.push(name);
}

// ---- a full day ----------------------------------------------------------------------

/** First run: Doozer hatches, the sound question is asked once, then a day's use. Ends with a save. */
const day1: Scenario = async (app) => {
  const failures: string[] = [];
  const { brain, host } = app;
  await stayAwake(app);
  const { snap, pill, ask, button } = pieces(app);

  // --- first run: the hatching ---
  const first = snap();
  const hatchStarted = first.hatching || !host.services.needsWelcome();
  const born = { treats: brain.state.treats, sessions: brain.state.sessionsCompleted, favourite: brain.state.favourite, unlocked: [...brain.state.unlocked] };
  const hatched = await waitFor(() => !snap().hatching, 16_000, 50);
  const afterHatch = snap();
  check(failures, {
    'first run opens in the Pill': host.current() === 'pill' && brain.settings.lastView === 'pill',
    'a new Doozer hatches': hatchStarted && hatched,
    'the hatching is not shown twice': !host.services.needsWelcome(),
    'a new Doozer arrives with 2 treats and a biscuit': born.treats === 2 && born.unlocked.includes('biscuit') && born.sessions === 0,
    'it has a favourite snack': ['biscuit', 'cookie', 'donut', 'strawberry', 'onigiri'].includes(born.favourite),
    'the sound question is asked': afterHatch.asking && !brain.settings.soundAsked,
    'the question catches the mouse': app.pill.hitRegions().length === 3,
    'sound is off until asked for': brain.settings.sound === false,
  });

  // --- the sound question, answered once ---
  const no = [...ask.querySelectorAll('button')].find((b) => b.textContent === 'No thanks');
  if (no) await press(no);
  check(failures, {
    'answering the question ends it': !snap().asking && brain.settings.soundAsked && !brain.settings.sound,
    'only the pill catches the mouse afterwards': app.pill.hitRegions().length === 2,
  });

  // --- feed, fill the bowl ---
  await tap(pill);
  const opened = snap().open === 'card';
  brain.debug?.setNeeds({ tummy: 55 });
  const tummyBefore = brain.state.needs.tummy;
  await press(button('feed'));
  const fed = brain.state.needs.tummy === tummyBefore + 32;
  await press(button('fill'));
  const bowl = brain.state.bowl;
  await sleep(4500);

  // --- three focus sessions ---
  const sessions: unknown[] = [];
  let treats = brain.state.treats;
  for (let i = 1; i <= 3; i++) {
    await press(button('focus'));
    const running = brain.state.focus.status === 'running' && brain.state.quiet;
    const startText = snap().status;
    await sleep(2300);
    const laterText = snap().status;
    const glasses = pieces(app).mini.el.dataset.glasses === '1';
    const focusWatch = watchFocus();
    brain.debug?.finishFocusNow();
    const earned = brain.state.treats - treats;
    treats = brain.state.treats;
    const celebrating = snap().lively;
    await atRest(app);
    const focus = await focusWatch.stop();
    const ok = running && /^\d\d:\d\d$/.test(startText) && laterText < startText && glasses && earned === (i === 1 ? 3 : 2)
      && celebrating && focusStatus(app) === 'idle' && focus.samples > 5 && focus.doozerHadFocus === 0;
    if (!ok) failures.push(`focus session ${i}`);
    sessions.push({ i, running, startText, laterText, glasses, earned, celebrating, endedIdle: focusStatus(app) === 'idle', focus });
  }
  await tap(pill);

  const s = brain.state;
  check(failures, {
    'the Card opens from the pill': opened,
    'feeding gives one meal': fed,
    'the bowl fills to three': bowl === 3,
    'three sessions are counted': s.sessionsCompleted === 3,
    'the streak starts': s.streak.current === 1 && s.streak.best === 1,
    'treats: 2 + (2+1) + 2 + 2': s.treats === 9,
    'the cookie and the donut are unlocked': s.unlocked.includes('cookie') && s.unlocked.includes('donut'),
    'the next unlock is the yarn ball at 6': s.nextUnlock?.id === 'yarn' && s.nextUnlock.atSessions === 6,
    'the Card is closed again': snap().open === 'none',
  });

  // --- it is all on disk ---
  await host.flush();
  const saved = parseSave((await shell.load()).data);
  const doc = saved.brain as { progress?: { sessions?: number }; pet?: { bowl?: number; treats?: number }; settings?: { soundAsked?: boolean } } | undefined;
  check(failures, {
    'the save holds the day': doc?.progress?.sessions === 3 && doc.pet?.treats === 9 && doc.settings?.soundAsked === true,
    'the save knows the hatching was shown': saved.host.welcomedPet === s.bornAt,
  });
  return { failures, born, sessions, end: { needs: s.needs, bowl: s.bowl, treats: s.treats, asleep: s.asleep, streak: s.streak }, savedAt: Date.now() };
};

/** The next morning: started with `clockOffsetMs` so the app believes the night has passed. */
const day2: Scenario = async (app, args) => {
  const failures: string[] = [];
  const { brain, host } = app;
  // What the first tick found, before anything else touches it.
  const woke = { needs: { ...brain.state.needs }, bowl: brain.state.bowl, asleep: brain.state.asleep, treats: brain.state.treats, hatching: app.pill.snapshot()?.hatching };
  await stayAwake(app);
  const { snap, pill, button } = pieces(app);
  const s0 = brain.state;
  const saved = (brain.serialize() as { lastSeen?: number }).lastSeen ?? 0;
  const offset = Number(args.clockOffsetMs ?? 0);
  check(failures, {
    'the run really is the next morning': offset >= 8 * 3_600_000,
    'the same Doozer is back, with no second hatching': !woke.hatching && !host.services.needsWelcome(),
    'the sound question is not asked again': !snap().asking && brain.settings.soundAsked,
    'yesterday is remembered': s0.sessionsCompleted === 3 && s0.streak.current === 1 && s0.unlocked.includes('donut'),
    'the treats are still in the jar': woke.treats === 9,
    'time passed while the app was closed': Math.abs(saved - (Date.now() + offset)) < 30_000,
    'Doozer ate from the bowl overnight': woke.bowl === 0 && woke.needs.tummy > 0,
    'nothing is out of range': Object.values(woke.needs).every((v) => v >= 0 && v <= 100),
    'no session was left running': s0.focus.status === 'idle',
    'it reopens in the Pill': host.current() === 'pill',
  });

  // --- the first session of the new day ---
  if (brain.state.asleep) brain.wake();
  await sleep(300);
  await tap(pill);
  await press(button('focus'));
  const running = brain.state.focus.status === 'running';
  await sleep(1200);
  brain.debug?.finishFocusNow();
  await atRest(app);
  await tap(pill);
  const s = brain.state;
  check(failures, {
    'a session can be started': running,
    'the streak grows to two': s.streak.current === 2 && s.streak.best === 2,
    'the first session of the day pays the bonus': s.treats === 12,
    'four sessions in all': s.sessionsCompleted === 4,
  });
  await host.flush();
  return { failures, woke, end: { needs: s.needs, treats: s.treats, streak: s.streak, sessions: s.sessionsCompleted } };
};

// ---- never stuck ---------------------------------------------------------------------

const stuck: Scenario = async (app) => {
  const failures: string[] = [];
  const { brain, host } = app;
  await stayAwake(app);
  if (!brain.settings.soundAsked) brain.setSetting('soundAsked', true);
  await waitFor(() => !pieces(app).snap().hatching, 16_000, 50);
  const { snap, pill, button, card } = pieces(app);
  const out: Record<string, unknown> = {};

  // 1. Rapid presses on every Card button.
  brain.debug?.setNeeds({ tummy: 30, fun: 30, energy: 55, clean: 30 });
  brain.debug?.addTreats(12);
  await tap(pill);
  let presses = 0;
  for (const act of ['feed', 'play', 'wash', 'sleep', 'fill', 'treat', 'focus', 'focus-stop', 'mute', 'feed', 'sleep', 'treat', 'play']) {
    const target = button(act);
    const at = centre(target);
    await cursor(at, false);
    for (let i = 0; i < 14; i++) {
      await cursor(at, true);
      pointer(target, 'pointerdown', at, 1);
      await cursor(at, false);
      pointer(target, 'pointerup', at, 0);
      target.click();
      presses++;
      await sleep(24);
    }
  }
  for (const chip of card.el.querySelectorAll<HTMLButtonElement>('.dzk-chip')) {
    for (let i = 0; i < 6; i++) { chip.click(); presses++; await sleep(10); }
  }
  await park();
  const settledAfterRapid = await atRest(app);
  const afterRapid = { snap: snap(), status: await status(), props: card.el.querySelectorAll('.dzk-prop').length, emotes: card.el.querySelectorAll('.dzk-emote').length };
  if (brain.state.asleep) brain.wake();
  brain.stopFocus();
  await atRest(app);
  brain.debug?.setNeeds({ tummy: 20 });
  await sleep(100);
  const hungry = brain.state.needs.tummy;
  await press(button('feed'));
  check(failures, {
    'rapid presses: everything came to rest': settledAfterRapid,
    'rapid presses: the Card is still open and whole': afterRapid.snap.open === 'card' && card.isOpen,
    'rapid presses: nothing left on the stage': afterRapid.props === 0 && afterRapid.emotes === 0,
    'rapid presses: the shell is not holding a press': !afterRapid.status.holding,
    'rapid presses: the window lets clicks through at rest': afterRapid.status.styleClickThrough && !afterRapid.status.catching,
    'rapid presses: the Card still works afterwards': brain.state.needs.tummy === hungry + 32,
  });
  out.rapid = { presses, snap: afterRapid.snap };
  await atRest(app);

  // 2. The Card opened and closed in the middle of every scene.
  const scenes: [string, () => void][] = [
    ['feed', () => void brain.feed()],
    ['treat', () => void brain.giveTreat()],
    ['play', () => void brain.play()],
    ['wash', () => void brain.wash()],
    ['sleep', () => void brain.sleep()],
    ['focus', () => { brain.startFocus(); brain.debug?.finishFocusNow(); }],
  ];
  const cuts: unknown[] = [];
  for (const [name, act] of scenes) {
    for (const cutAt of [0, 250, 700, 1500, 2600]) {
      if (brain.state.asleep) brain.wake();
      brain.debug?.setNeeds({ tummy: 30, fun: 30, energy: 60, clean: 30 });
      brain.debug?.addTreats(3);
      if (snap().open !== 'card') await tap(pill, 30);
      act();
      await sleep(cutAt);
      await tap(pill, 30);
      const s = snap();
      const left = card.el.querySelectorAll('.dzk-prop, .dzk-emote').length;
      const ok = s.open === 'none' && !s.stageBusy && left === 0 && app.pill.hitRegions().length === 2;
      if (!ok) failures.push(`mid-scene close: ${name} at ${cutAt} ms`);
      cuts.push({ name, cutAt, ok, open: s.open, stageBusy: s.stageBusy, left });
    }
  }
  if (brain.state.asleep) brain.wake();
  check(failures, { 'mid-scene close: the pill comes to rest afterwards': await atRest(app) });
  await tap(pill);
  check(failures, { 'mid-scene close: the Card opens again': snap().open === 'card' && card.isOpen });
  await tap(pill);
  out.cuts = cuts;

  // 3. A press whose mouse-up never arrives.
  const released: unknown[] = [];
  const off = shell.on('pointer-released', (at) => released.push(at));
  const onPill = centre(pill);
  await cursor(onPill, false);
  await sleep(120);
  await cursor(onPill, true);
  pointer(pill, 'pointerdown', onPill, 1);
  await sleep(100);
  const held = { snap: snap(), status: await status() };
  let leftWhileHeld = 0;
  let at = onPill;
  for (let i = 1; i <= 10; i++) {
    at = { x: onPill.x + 60 * i, y: onPill.y + 45 * i };
    await cursor(at, true);
    await sleep(16);
    if (i % 3 === 0) {
      const now = await status();
      if (now.styleClickThrough || !now.catching || !now.holding) leftWhileHeld++;
    }
  }
  const stillPressed = snap().pressed;
  // The button comes up far away. The page is given no pointerup and no click.
  await cursor(at, false);
  const t0 = performance.now();
  const ended = await waitFor(() => !snap().pressed, 1500, 4);
  const endedAfterMs = Math.round((performance.now() - t0) * 10) / 10;
  await sleep(200);
  await park();
  await sleep(250);
  const rested = await status();
  off();
  const openAfterLostPress = snap().open;
  await tap(pill);
  const worksAfter = snap().open === 'card';
  await tap(pill);
  check(failures, {
    'lost mouse-up: the press went to the page': held.snap.pressed && held.status.holding && held.status.catching,
    'lost mouse-up: click-through did not change while the button was down': leftWhileHeld === 0 && stillPressed,
    'lost mouse-up: the press ended without a mouse-up': ended,
    'lost mouse-up: the shell said so exactly once': released.length === 1,
    'lost mouse-up: nothing was toggled by it': openAfterLostPress === 'none',
    'lost mouse-up: not holding, and click-through at rest': !rested.holding && rested.styleClickThrough && !rested.catching,
    'lost mouse-up: the next press works': worksAfter,
  });
  out.lostMouseUp = { endedAfterMs, released };

  // 4. A focus session ending while the Card is closed.
  await atRest(app);
  brain.startFocus();
  await sleep(1500);
  const during = snap();
  const quietWatch = watchFocus();
  brain.debug?.finishFocusNow();
  await sleep(300);
  const celebrating = snap();
  const quiet = await atRest(app);
  const quietFocus = await quietWatch.stop();
  const afterQuiet = { snap: snap(), status: await status() };
  check(failures, {
    'session end, Card closed: the pill was a countdown': /^\d\d:\d\d$/.test(during.status) && during.ring.startsWith('focus:'),
    'session end, Card closed: Doozer celebrates': celebrating.lively,
    'session end, Card closed: it comes back to rest': quiet,
    'session end, Card closed: the Card stayed closed': afterQuiet.snap.open === 'none',
    'session end, Card closed: the pill shows the mood again': afterQuiet.snap.statusTone !== 'focus' && afterQuiet.snap.ring.startsWith('wellbeing:'),
    'session end, Card closed: Doozer never had the keyboard': quietFocus.samples > 5 && quietFocus.doozerHadFocus === 0,
    'session end, Card closed: the window still refuses focus': afterQuiet.status.styleNoActivate && !afterQuiet.status.focusable,
  });
  brain.setSetting('onFocusEnd', 'open-card');
  brain.startFocus();
  await sleep(600);
  const openWatch = watchFocus();
  brain.debug?.finishFocusNow();
  await sleep(400);
  const openedCard = { snap: snap(), status: await status() };
  await atRest(app);
  const openFocus = await openWatch.stop();
  check(failures, {
    'session end, "open the Card": the Card opens': openedCard.snap.open === 'card',
    'session end, "open the Card": Doozer never had the keyboard': openFocus.samples > 5 && openFocus.doozerHadFocus === 0 && openedCard.status.styleNoActivate,
  });
  brain.setSetting('onFocusEnd', 'quiet');
  await tap(pill);
  out.sessionEnd = { during: during.status, afterQuiet: afterQuiet.snap.status, quietFocus, openFocus };

  // 5. Settings may take the keyboard, and give it back.
  app.pill.openSettings?.();
  await sleep(200);
  const inSettings = await status();
  app.pill.setOpen('none');
  await sleep(200);
  const outOfSettings = await status();
  check(failures, {
    'settings: a click may give the window the keyboard': inSettings.focusable && !inSettings.styleNoActivate,
    'settings: opening them took no focus by itself': !inSettings.isForeground,
    'settings: closed, the window refuses focus again': !outOfSettings.focusable && outOfSettings.styleNoActivate,
  });

  await host.settled();
  await park();
  return { failures, ...out };
};

// ---- the window ----------------------------------------------------------------------

/** Click-through around the pill and the Card, the four docks, and tuck-away. */
const windowChecks: Scenario = async (app) => {
  const failures: string[] = [];
  const { brain, host } = app;
  await stayAwake(app);
  if (!brain.settings.soundAsked) brain.setSetting('soundAsked', true);
  await waitFor(() => !pieces(app).snap().hatching, 16_000, 50);
  await atRest(app);
  const { snap, pill, card } = pieces(app);

  type Reading = { label: string; styleClickThrough: boolean; hitIsDoozer: boolean };
  const probe = async (points: { label: string; at: Point; through: boolean }[]): Promise<unknown[]> => {
    const readings = await invoke<Reading[]>('spike_probe', { points: points.map((p) => ({ label: p.label, x: p.at.x, y: p.at.y })), settleMs: 150 });
    return points.map((p, i) => {
      const got = readings[i];
      const ok = got !== undefined && got.styleClickThrough === p.through;
      if (!ok) failures.push(`click-through: ${p.label}`);
      return { label: p.label, expectThrough: p.through, got };
    });
  };
  const pillBox = pill.getBoundingClientRect();
  const cardSpot: Point = { x: Math.round(window.innerWidth / 2), y: Math.round(pillBox.bottom + 200) };
  const closed = await probe([
    { label: 'closed: on the pill', at: centre(pill), through: false },
    { label: 'closed: beside the pill', at: { x: Math.round(pillBox.right + 40), y: Math.round(pillBox.top + 27) }, through: true },
    { label: 'closed: where the Card will be', at: cardSpot, through: true },
    { label: 'closed: the pill\'s rounded corner', at: { x: Math.round(pillBox.right - 2), y: Math.round(pillBox.top + 2) }, through: true },
    { label: 'closed: on Doozer above the pill', at: { x: Math.round(pillBox.left + 36), y: Math.round(pillBox.top - 8) }, through: false },
  ]);
  await park();
  await tap(pill);
  await sleep(450);
  const cardBox = card.el.getBoundingClientRect();
  const open = await probe([
    { label: 'open: on the Card', at: centre(card.el), through: false },
    { label: 'open: beside the Card', at: { x: Math.round(cardBox.right + 20), y: Math.round(cardBox.top + 200) }, through: true },
    { label: 'open: below the Card', at: { x: Math.round(window.innerWidth / 2), y: Math.round(Math.min(window.innerHeight - 4, cardBox.bottom + 30)) }, through: true },
    { label: 'open: on the pill', at: centre(pill), through: false },
  ]);
  await park();
  await tap(pill);
  await sleep(300);
  const again = await probe([{ label: 'closed again: where the Card was', at: centre(card.el), through: true }]);
  await park();

  // The four docks: the window moves, Doozer pops out and in, and the pill is clickable there.
  const docks: unknown[] = [];
  for (const dock of ['top-left', 'top-right', 'bottom-right', 'top-center'] as const) {
    brain.setSetting('pillDock', dock);
    await sleep(60);
    await host.settled();
    await sleep(500);
    const s = await status();
    const work = (await shell.windowInfo())?.monitor.work;
    const b = s.bounds;
    const placed = !!b && !!work && (
      dock === 'top-left' ? b.x === work.x && b.y === work.y
      : dock === 'top-right' ? b.x + b.w === work.x + work.w && b.y === work.y
      : dock === 'bottom-right' ? b.x + b.w === work.x + work.w && b.y + b.h === work.y + work.h
      : Math.abs(b.x + b.w / 2 - (work.x + work.w / 2)) <= 1 && b.y === work.y);
    const view = snap();
    const ok = placed && s.regions === 2 && !view.gone && pieces(app).root.dataset.dock === dock && s.visible;
    if (!ok) failures.push(`dock ${dock}`);
    docks.push({ dock, placed, bounds: b, regions: s.regions, gone: view.gone });
  }

  // Tuck away: hidden, every clock stopped; then back as it was.
  brain.setSetting('tuckAwayInFullscreen', true);
  await tap(pill);
  host.setFullscreen(true);
  await sleep(400);
  const tucked = { snap: snap(), status: await status(), awake: host.awake() };
  await sleep(1500);
  const stillTucked = snap();
  host.setFullscreen(false);
  await sleep(500);
  const back = { snap: snap(), status: await status(), awake: host.awake() };
  check(failures, {
    'tuck away: the window is hidden': !tucked.status.visible && !tucked.awake,
    'tuck away: nothing catches the mouse': tucked.status.regions === 0,
    'tuck away: the Card is folded and every timer stopped': tucked.snap.open === 'none' && tucked.snap.timers.length === 0 && !tucked.snap.lively,
    'tuck away: it stays that way': stillTucked.timers.length === 0 && !stillTucked.lively,
    'tuck away: it comes back': back.status.visible && back.awake && back.status.regions === 2 && back.snap.timers.includes('blink'),
    'tuck away: coming back took no focus': !back.status.isForeground,
  });
  // The real state of the screen decides from here on.
  host.setFullscreen(await shell.fullscreenInFront());
  brain.setSetting('tuckAwayInFullscreen', false);

  // Always on top follows the setting.
  brain.setSetting('alwaysOnTop', false);
  await sleep(250);
  const notOnTop = await status();
  brain.setSetting('alwaysOnTop', true);
  await sleep(250);
  const onTop = await status();
  check(failures, {
    'always on top: off': !notOnTop.topmost,
    'always on top: on again': onTop.topmost,
    'the window is a tool window (no taskbar button, not in Alt-Tab)': onTop.styleToolWindow,
  });

  // Start with Windows: registers this copy and unregisters it. Uses the scratch key in DOOZER_AUTOSTART_KEY.
  const autostart: Record<string, unknown> = {};
  if (await invoke<boolean>('spike_autostart_is_scratch').catch(() => false)) {
    brain.setSetting('startWithWindows', true);
    await sleep(500);
    autostart.on = await shell.autostartEnabled();
    brain.setSetting('startWithWindows', false);
    await sleep(500);
    autostart.off = await shell.autostartEnabled();
    check(failures, { 'start with Windows: registered': autostart.on === true, 'start with Windows: unregistered': autostart.off === false });
  } else {
    autostart.skipped = 'DOOZER_AUTOSTART_KEY is not set, so the real Run key was left alone';
  }

  // The tray menu: every view is built now, so none is greyed out as "coming soon" (as
  // the three that were not yet built were when this check was written); Settings opens the panel.
  const menu = await invoke<{ ticked: string[]; trayIconExists: boolean; labels?: Record<string, string>; enabled?: Record<string, boolean> }>('spike_menu', { id: null });
  await invoke('spike_menu', { id: 'settings' });
  await sleep(300);
  const settingsOpen = snap().open === 'settings';
  app.pill.setOpen('none');
  check(failures, {
    'tray: the icon exists': menu.trayIconExists,
    'tray: the Pill is ticked': menu.ticked.join() === 'pill',
    'tray: every view is offered by its name and can be chosen': !!menu.labels && !!menu.enabled
      && (['pill', 'room', 'island', 'desktop'] as const).every((id) => menu.enabled?.[id] === true && !/coming soon/i.test(menu.labels?.[id] ?? 'coming soon')),
    'tray: Settings opens the settings panel': settingsOpen,
  });

  await park();
  return { failures, closed, open, again, docks, tucked: tucked.snap, autostart, menu };
};

// ---- idle, for the cost measurement --------------------------------------------------

/** Sit in the pill doing nothing, as it would all day. Never finishes; scripts/measure-idle.ps1 samples it. */
const idle: Scenario = async (app, args) => {
  await stayAwake(app);
  if (!app.brain.settings.soundAsked) app.brain.setSetting('soundAsked', true);
  await waitFor(() => !pieces(app).snap().hatching, 16_000, 50);
  if (args.focus === true) app.brain.startFocus();
  if (args.card === true) app.pill.setOpen('card');
  if (args.asleep === true) { app.brain.debug?.setNeeds({ energy: 40 }); app.brain.sleep(); }
  await park();
  await invoke('spike_report', { name: 'idle-ready.json', json: JSON.stringify({ ready: true, at: Date.now(), snap: app.pill.snapshot(), status: await status() }) });
  return new Promise(() => undefined);
};

const SCENARIOS: Record<string, Scenario> = {
  'app-day1': day1, 'app-day2': day2, 'app-stuck': stuck, 'app-window': windowChecks, 'app-idle': idle,
  // The Room view's runs (Phase 7): `app-room-*`, in room-scenarios.ts.
  ...ROOM_SCENARIOS,
};

export async function runAppScenarios(app: App, run: TestRun): Promise<void> {
  const args = run.args ?? {};
  const names = scenarioNames(run);
  const report: Record<string, unknown> = { run, startedAt: new Date().toISOString(), scenarios: {} };
  const results = report.scenarios as Record<string, unknown>;
  for (const name of names) {
    const scenario = SCENARIOS[name];
    try {
      results[name] = scenario ? await scenario(app, (args[name] as Record<string, unknown> | undefined) ?? args) : { failures: ['unknown scenario'] };
    } catch (error) {
      results[name] = { failures: [`threw: ${String(error)}`], stack: error instanceof Error ? error.stack : undefined };
    }
  }
  report.finishedAt = new Date().toISOString();
  report.endStatus = await status();
  report.endSnapshot = app.pill.snapshot() ?? app.room.snapshot();
  await invoke('spike_inject', { cursor: null });
  await invoke('spike_report', { name: `${String(args.tag ?? names.join('+'))}.json`, json: JSON.stringify(report, null, 1) });
  if (args.exit === false) return;
  // Quit the way a person would, through the tray menu: the page is told, saves, and answers.
  if (args.quitVia === 'page') await app.host.quit();
  else await invoke('spike_menu', { id: 'quit' });
}
