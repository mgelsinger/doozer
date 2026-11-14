# ui — the dark-glass kit

Phase 5. The pieces every view shares (spec sections 5.3 and 8): the **Card**, the **Radial**, need meters, emotes, tooltips, the settings panel, and a focus chip. See them all, in every state, at `/viewer.html` (`npm run dev`).

**Boundaries.** The kit talks to the pet only through `Brain` from `core/contract.ts`, and to everything else through plain callbacks. It imports nothing from `views/` or `shell.ts` and names no view beyond the four ids on the view switcher. `kit.test.ts` checks this.

## Using it

```ts
import { createCard, createRadial, createSettingsPanel, createNeedMeters, createFocusChip,
         createEmoteLayer, syncDoozer, StageDirector } from '../ui';

const card = createCard(brain, {
  onSwitchView: (view) => host.switchTo(view),
  onOpenSettings: () => { card.close(); settings.open(); },
  onOpenChange: (open) => shell.updateHitRegions(),
  currentView: () => 'pill',
  unavailableViews: ['island', 'desktop'],     // shown as "coming soon"
  open: false,
});
host.append(card.el);                          // 320 px wide; you place it
card.el.style.setProperty('--dzk-origin', '50% -20px');   // where it unfolds from
card.toggle();
card.setLively(false);                         // open but perfectly still, for when nobody is looking

const radial = createRadial(brain, { onMore: () => card.open() });
petElement.append(radial.el);                  // a zero-size anchor: put it at Doozer's middle
petElement.setAttribute('data-radial-toggle', '');        // so a press on Doozer is not "outside"
radial.toggle();
radial.interrupt();                            // call when Doozer is picked up or moved
radial.setArc(-45, 150);                       // re-aim near a screen edge
radial.hitRects();                             // for the view's hit regions
```

A view with its own Doozer:

```ts
const off = syncDoozer(brain, doozer);         // mood face, glasses, hat, grime, palette
// or, for the standard little scenes (eat, play, wash, pet, sleep, wake, refuse, celebrate):
const director = new StageDirector(brain, doozer, { emote, prop });
```

Sizing hooks (CSS custom properties): `--dzk-card-w`, `--dzk-origin`, `--dzk-radial-r`, `--dzk-radial-b`, `--dzk-emote`, `--dzk-settings-max`.

## Files

| File | What |
|---|---|
| `card.ts` | The Card: stage, meters, actions, bowl and jar, focus block, view row, settings and mute |
| `radial.ts` | The Radial: six buttons on an arc, need rings on four of them |
| `settings.ts` | One row per row of spec section 9, plus the hat |
| `meters.ts` · `focus-chip.ts` · `emotes.ts` · `tooltip.ts` | The smaller pieces |
| `presenter.ts` | `syncDoozer`, `StageDirector`, `expressionFor`, `interruptOnActivity` — no DOM |
| `lifecycle.ts` | `Scope`, `Transients`, `SceneRunner`, `Disclosure` — no DOM |
| `needs.ts` · `format.ts` · `motion.ts` · `icons.ts` | Pure helpers and the icon set |
| `kit.css` | All the styling. `fonts/` holds Fredoka (SIL Open Font License, see `OFL-LICENSE.txt`) |
| `dev/` | The fake brain and the viewer. Development only; nothing in the app may import it |

## Rules that keep it from getting stuck

1. **State is an attribute, and what is drawn is a function of it.** `data-open`, `data-status`, `data-level`... Open and close are CSS transitions on those attributes. No JavaScript waits for an animation or transition to finish, and nothing depends on an animation frame, so nothing can be left half-open — including in a window that is not being drawn.
2. **Everything temporary is ended by a timer.** Emotes (`Transients`), temporary faces (`ExpressionState`), tooltips (a maximum time), the Radial (it closes itself when left alone).
3. **One scene at a time** (`SceneRunner`). A scene only pauses through its context, so ending it is: run its clean-ups and never resume it. A new scene, a refusal, falling asleep, closing the Card, or a time limit all take that same path.
4. **Menus close when Doozer is interrupted.** Any brain action, a session starting or finishing, a press outside, Escape, idling, or the view calling `interrupt()`.
5. **An open Card nobody is looking at is still.** `card.setLively(false)` pauses its Doozer and its scenes while the meters and the clock keep painting; the view decides when (the Pill view does it a few seconds after the pointer leaves). Added in Phase 6 for render on demand.
6. **Double presses count once.** Card buttons ignore a second press within 320 ms (compared by event time, with no timer), so a double-click cannot nap-then-wake or spend two treats.

Tests for all of this run without a browser: `lifecycle.test.ts`, `presenter.test.ts`, and `../character/expression-state.test.ts`.

## Accessibility

- Everything is a real `<button>`, in a sensible tab order. The Radial is a `menu` with arrow-key movement, Home/End and Escape; radio groups (session length, settings) move with the arrow keys.
- **Colour is never the only signal.** A need shows as bar or ring length *and* colour *and* a “!” flag when low (striped too when urgent); its text says “Tummy 23%, low”. Selected things are bolder and marked as well as coloured; switches say On/Off.
- **Reduced motion** follows `settings.reduceMotion` (and the system when it is `'system'`): every kit root carries `data-motion`. No springs or travel; emotes fade in place.
- During a focus session (`state.quiet`) the stage shows no hearts, sparkles or z's. The one emote that still appears is the “?” of a refusal, because that answers something the user just pressed.
