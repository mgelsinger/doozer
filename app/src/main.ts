// Start-up: read the save, wake the pet brain, and hand both to the view host, which
// mounts exactly one view at a time (WORK_PLAN.md section 3; src/host/host.ts).
//
// Order matters (docs/brain-contract.md, "What the host does"): the brain is created
// from the save, the host subscribes and mounts the view, and only then does the first
// `tick()` run, because time away and a session that ended while the app was closed are
// announced on that tick.

import { createBrain, type Brain } from './core';
import { frames } from './frames';
import { createHost, type Host } from './host/host';
import { createSound } from './host/sound';
import { parseSave } from './host/store';
import { shell } from './shell';
import { isAppRun, readTestRun, scenarioNames, type TestRun } from './spike/config';
import { createDesktopView, type DesktopView } from './views/desktop';
import { createIslandView, type IslandView } from './views/island';
import { createPillView, type PillView } from './views/pill';
import { createRoomView, type RoomView } from './views/room';

export interface App {
  host: Host;
  brain: Brain;
  pill: PillView;
  room: RoomView;
  island: IslandView;
  desktop: DesktopView;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The save file's text. `readable` is false only if the shell could not be asked at all. */
async function readSave(): Promise<{ text: string | null; readable: boolean }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const loaded = await shell.load();
      if (loaded.problem) console.warn(`[doozer] save: ${loaded.problem} (using ${loaded.source})`);
      return { text: loaded.data, readable: true };
    } catch (error) {
      console.error(`[doozer] the save could not be read (attempt ${attempt})`, error);
      await sleep(150);
    }
  }
  return { text: null, readable: false };
}

async function startApp(root: HTMLElement, run: TestRun): Promise<App> {
  const { text, readable } = await readSave();
  const saved = parseSave(text);

  // A scripted run can start "tomorrow morning" without waiting for it.
  const clockOffset = run.enabled ? Number(run.args?.clockOffsetMs ?? 0) || 0 : 0;
  const brain = createBrain({
    save: saved.brain,
    now: () => Date.now() + clockOffset,
    debug: import.meta.env.DEV || run.enabled,
  });

  const pill = createPillView();
  const room = createRoomView();
  // The Island only loads three.js when it is switched to (views/island/index.ts).
  const island = createIslandView();
  const desktop = createDesktopView();
  const host = createHost({
    root,
    shell,
    brain,
    // The first view in the list is the home on first run.
    views: [pill, room, island, desktop],
    hostData: saved.host,
    sound: createSound(() => brain.settings.sound),
    // If the save could not even be read, do not write over it with a new pet.
    persist: readable,
  });
  await host.start();
  return { host, brain, pill, room, island, desktop };
}

const root = document.getElementById('host');
if (!root) throw new Error('missing #host');

const run = await readTestRun();
// Everything that moves in this page is drawn at a capped rate (src/frames.ts). A scripted
// run may ask for the browser's own rate instead, to measure what the cap saves.
if (!(run.enabled && run.args?.pacing === false)) frames.attach(document);
if (run.enabled && !isAppRun(run)) {
  // A shell test run: the Phase 3 test page and its scenarios (docs/shell-spike.md).
  const [{ mountTestPage }, { runSpikeScenarios }] = await Promise.all([import('./spike/test-page'), import('./spike/scenarios')]);
  const page = await mountTestPage(root);
  void runSpikeScenarios(page).catch((error: unknown) => console.error('[spike]', error));
} else {
  const app = await startApp(root, run);
  if (import.meta.env.DEV || run.enabled) (window as unknown as { doozer?: App }).doozer = app;
  if (run.enabled && scenarioNames(run).some((name) => name.startsWith('app-desktop'))) {
    // The Desktop view's own scripted runs (docs/desktop-checks.md).
    const { runDesktopChecks } = await import('./views/desktop/checks');
    void runDesktopChecks(app, run).catch((error: unknown) => console.error('[spike]', error));
  } else if (run.enabled && scenarioNames(run).some((name) => name.startsWith('app-island'))) {
    // The Island view's own scripted runs (docs/island-checks.md).
    const { runIslandChecks } = await import('./views/island/checks');
    void runIslandChecks(app, run).catch((error: unknown) => console.error('[spike]', error));
  } else if (run.enabled && scenarioNames(run).some((name) => name.startsWith('app-polish'))) {
    // Phase 10's measurements and checks (docs/polish-checks.md).
    const { runPolishScenarios } = await import('./spike/polish-scenarios');
    void runPolishScenarios(app, run).catch((error: unknown) => console.error('[spike]', error));
  } else if (run.enabled) {
    const { runAppScenarios } = await import('./spike/app-scenarios');
    void runAppScenarios(app, run).catch((error: unknown) => console.error('[spike]', error));
  }
}
