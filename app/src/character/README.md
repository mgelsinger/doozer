# character — the Doozer rig

Phase 5 built the **2D rig** here (Pill, Room, Desktop, and the Card's stage). Phase 8 adds the 3D model loader beside it.

The rig knows nothing about the brain or about any view. See it all at `/viewer.html` (`npm run dev`).

## Using it

```ts
import { createDoozer, walkCycleMs } from '../character';

const doozer = createDoozer({ palette: 'peach', style: 'bold', size: 112 });
host.append(doozer.el);            // a square element, pointer-events: none

doozer.setMood('hungry');          // the lasting face (any of the 16 expression names)
doozer.flash('love', 1000);        // a temporary face; always returns to the mood
await doozer.perform('celebrate'); // a one-shot; the promise always settles
doozer.squish(0.8);                // a poke or a set-down, on top of whatever is showing

doozer.setPose('walk');            // hold a body pose until setPose(null)
doozer.setFacing(1);               // -1 left, 0 toward you, 1 right
doozer.setWalkCycle(walkCycleMs(112, 30));   // match the feet to the ground speed (px/s)
doozer.setPose('carried', 'wow');  // a pose can carry a face for as long as it is held

doozer.setLive(false);             // pause every loop: nothing redraws (idle, hidden)
doozer.blink(true);                // a still blink: two redraws and a timer, works while paused
doozer.destroy();
```

To follow the brain (mood face, glasses, hat, grime, palette) use `syncDoozer(brain, doozer)` from `../ui`.

| | |
|---|---|
| Line styles | `bold` (Pill, Desktop) and `soft` (Room): one set of parts, the outline switched off in CSS |
| Palettes | peach, mint, lavender, butter, sky (`palettes.ts`) |
| Expressions | joyful, content, meh, hungry, bored, sleepy, dirty, asleep · eat, love, wow, cheer, no, shake, yawn · focus (`expressions.ts`) |
| Looping poses | idle, settle, sulk, drowsy, sleep, walk, trot, hop, eat, play, shake, no, carried, wave, read, peek |
| One-shots | squish, hop, celebrate, wave, yawn, fall-asleep, wake, shake-off, stir, nod, pop-out, pop-in (`performances.ts`) |
| Hats | `setHat('nightcap' \| 'bow' \| null)`, drawn at the hat attachment point (`HAT_ANCHOR`) |
| Small sizes | at 84 px and below (`setSize`) the line is heavier and the features slightly larger |

Spec section 7's animation list maps onto these as: idle breathe → `idle`; blink → automatic (and `blink()`); look-at → `lookAt(x, y)`; walk → `walk` (calm) and `trot` (lively); hop → `hop`; eat → `eat`; play → `play`; wash/shake → `shake` and `shake-off`; fall asleep → `fall-asleep`; sleep → `sleep`; wake/stretch → `wake`; celebrate → `celebrate`; sulk → `sulk` and `drowsy`; carried → `carried`; set-down squish → `squish`; yawn → `yawn`; wave → `wave`; read → `read`; peek → `peek`.

## Rules that keep it from getting stuck

- **`expression-state.ts` is the only thing that decides what is showing.** Three layers: one *transient* (a flash or a performance), a *pose override*, and the *mood*. A new transient replaces the old one completely; every transient is ended by a timer; the mood is what everything returns to. It has no DOM in it and is tested on a fake clock.
- **`doozer.ts` is a thin driver.** Faces and poses are data attributes on the root, so what is drawn is a pure function of them. Performances are Web Animations started and cancelled by the state machine; their end never depends on an animation event or an animation frame (a hidden window runs neither).
- **Pivots.** Every moving part is a `<g class="dz-p">` carrying its pivot in view-box units (`PIVOTS` in `rig-markup.ts`). A shape with its own `transform` attribute must never also be a pivot part, and `rig.css` must never set `transform-box` / `transform-origin` with a blanket selector — that displaces such shapes. `rig-markup.test.ts` enforces both.
- **Reduced motion** (`setReduceMotion`) stops every loop and transition; poses keep a static form, and performances that are only movement finish at once while ones with faces still show them.
