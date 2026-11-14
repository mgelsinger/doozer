// Start-up: read the save, wake the pet brain, and hand both to the view host, which
// mounts exactly one view at a time (WORK_PLAN.md section 3; src/host/host.ts).
//
// Order matters (docs/brain-contract.md, "What the host does"): the brain is created
// from the save, the host subscribes and mounts the view, and only then does the first
// `tick()` run, because time away and a session that ended while the app was closed are
// announced on that tick.

import { createBrain, type Brain } from './core';
import { createHost, type Host } from './host/host';
import { createSound } from './host/sound';
import { parseSave } from './host/store';
import { shell } from './shell';
import { isAppRun, readTestRun, type TestRun } from './spike/config';
import { createPillView, type PillView } from './views/pill';

export interface App {
  host: Host;
  brain: Brain;
  pill: PillView;
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
  const host = createHost({
    root,
    shell,
    brain,
    // The Room, the Island and the Desktop arrive in later milestones; until then they
    // are shown as "coming soon".
    views: [pill],
    hostData: saved.host,
    sound: createSound(() => brain.settings.sound),
    // If the save could not even be read, do not write over it with a new pet.
    persist: readable,
  });
  await host.start();
  return { host, brain, pill };
}

const root = document.getElementById('host');
if (!root) throw new Error('missing #host');

const run = await readTestRun();
if (run.enabled && !isAppRun(run)) {
  // A shell test run: the Phase 3 test page and its scenarios (docs/shell-spike.md).
  const [{ mountTestPage }, { runSpikeScenarios }] = await Promise.all([import('./spike/test-page'), import('./spike/scenarios')]);
  const page = await mountTestPage(root);
  void runSpikeScenarios(page).catch((error: unknown) => console.error('[spike]', error));
} else {
  const app = await startApp(root, run);
  if (import.meta.env.DEV || run.enabled) (window as unknown as { doozer?: App }).doozer = app;
  if (run.enabled) {
    const { runAppScenarios } = await import('./spike/app-scenarios');
    void runAppScenarios(app, run).catch((error: unknown) => console.error('[spike]', error));
  }
}
