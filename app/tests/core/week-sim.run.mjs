// Print a simulated week of Doozer's needs. Run from app/:
//
//   node tests/core/week-sim.run.mjs                     the comparison table, 0 to 5 visits a day
//   node tests/core/week-sim.run.mjs --visits 4          curves for one scenario
//   node tests/core/week-sim.run.mjs --visits 4 --skip 4 ...with day 4 missed
//
// Options: --visits N   --days N   --skip D[,D]   --focus N   --no-bowl   --open   --jitter MIN   --seed N   --weeks N
//
// The TypeScript is loaded through Vite, so no build step and no extra dependency.

import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const number = (name) => (value(name) === undefined ? undefined : Number(value(name)));

const here = fileURLToPath(new URL('.', import.meta.url));
const { module: sim } = await runnerImport(`${here}week-sim.ts`, {
  root: fileURLToPath(new URL('../..', import.meta.url)),
  configFile: false,
  logLevel: 'error',
});

const shared = {
  days: number('days'),
  skipDays: value('skip')?.split(',').map(Number),
  focusPerDay: number('focus'),
  fillBowl: flag('no-bowl') ? false : undefined,
  appOpen: flag('open') || undefined,
  jitterMinutes: number('jitter'),
  seed: number('seed'),
};

if (value('visits') !== undefined) {
  console.log(sim.formatReport(sim.simulateWeek({ ...shared, visitsPerDay: number('visits') })));
} else {
  // --weeks N repeats each row with N different seeds (only useful together with --jitter).
  const weeks = number('weeks') ?? 1;
  console.log(sim.summaryHeader());
  for (const visitsPerDay of [5, 4, 3, 2, 1, 0]) {
    for (let week = 0; week < weeks; week++) {
      const seed = (shared.seed ?? 7) + week;
      console.log(sim.summaryRow(sim.simulateWeek({ ...shared, visitsPerDay, seed })));
    }
  }
}
