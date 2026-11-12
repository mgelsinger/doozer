# core — the pet brain

Pure TypeScript: no DOM, no storage, no timers, no view knowledge, nothing imported from outside `core/`. The host hands in the clock and the random source; `tests/core/core-purity.test.ts` keeps all of that true.

Everything outside this folder talks to the brain through [`contract.ts`](contract.ts), which is a verbatim copy of the TypeScript in [`docs/brain-contract.md`](../../../docs/brain-contract.md). Change the document and the file together, never one alone.

```ts
import { createBrain } from './core';

const brain = createBrain({ save, debug: import.meta.env.DEV });   // runs the offline catch-up
brain.on('change', () => render(brain.state));                      // subscribe first...
setInterval(() => brain.tick(), 250);                               // ...then start ticking
```

| File | What is in it |
|---|---|
| `contract.ts` | The interface. Types only. |
| `tuning.ts` | Every number and table: drain rates, thresholds, rewards, the unlock table, default settings. Tune here and nowhere else. |
| `rules.ts` | What happens when time passes: needs drain, Doozer eats from the bowl, falls asleep, wakes. Jumps from event to event, so one long step equals many short ones. |
| `brain.ts` | `createBrain`: actions and refusals, focus sessions, streak and unlocks, events, the published `state` snapshot. |
| `save.ts` | The versioned save format, migrations, and a loader that never throws. |
| `time.ts` | Local calendar days, for the streak. |
| `index.ts` | What the rest of the app imports. |

Tests are in `app/tests/core/`. The week simulation used for tuning is `tests/core/week-sim.ts` (run it with `node tests/core/week-sim.run.mjs` from `app/`); its output and the reasoning behind the numbers are in [`docs/brain-week-sim.md`](../../../docs/brain-week-sim.md).

Things the types cannot say (whole-number needs, event order, what happens on the first tick) are listed under "How the real brain behaves" in the contract document.
