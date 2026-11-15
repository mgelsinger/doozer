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

## The 3D Doozer (Phase 8)

One design, two renderings (spec section 7). The Island view draws Doozer as a model; everything else draws the rig above. They share the expression names, the tuft angles, the palettes and the state machine that ends everything temporary.

| File | What |
|---|---|
| `body-motion.ts` | The body as numbers: the squash-and-stretch spring, the hop, ears and tuft lagging behind, arms, the slump of a low mood, the flattened breathing of sleep, and what each one-shot does to the body. No three.js, no DOM. |
| `doozer3d.ts` | Loads the model and writes those numbers, and the face, onto its bones and shape keys. **Imports three.js**, so it is only ever loaded with a dynamic `import()` (the Island view and the dev viewer do); `index.ts` does not re-export it. |
| `../../assets/doozer/` | The model (`doozer.glb`) and the Blender script that builds it (`build_doozer.py`). |

```ts
const { loadDoozerModel, createDoozer3D } = await import('../character/doozer3d');
const model = await loadDoozerModel(url);            // the file, parsed once
const doozer = createDoozer3D(model, { palette: 'peach', invalidate: drawAgain });
scene.add(doozer.object);                            // origin at the feet; 1 unit = 100 px of the 2D rig

doozer.setMood('hungry');  doozer.flash('love', 1000);  await doozer.perform('celebrate');   // as the 2D rig
doozer.squish(0.8);  doozer.body.hop();  doozer.body.press(true);                            // the spring
const moving = doozer.update(dt);                    // once per frame; false means: stop drawing
doozer.destroy();  model.dispose();
```

- **It draws nothing by itself.** Its owner calls `update(dt)` each frame and stops when it returns false; `invalidate` is called when something changed while no frame was being drawn (a flash ending by timer, a setter).
- **Faces** are pairs of shape keys, eyes and mouth, looked up in `EXPRESSIONS`: the same table the 2D rig draws from. `tests/views/island/model.test.ts` fails if the model lacks a shape an expression needs, or if its palettes differ from `palettes.ts`; then rebuild the model.
- **Never stuck:** `ExpressionState` times every flash and performance, exactly as for the 2D rig. `BodyMotion` only shapes the body while one runs and forgets it when told to stop; everything in it eases or springs back to rest, a hop always lands, a press lets go by itself after 8 s, and `settle()` puts everything at rest at once.
- **Side by side:** `/viewer.html?only=3d` shows every expression, palette, hat and pose drawn and modelled, and the drawing laid over the model.

Rebuilding the model (headless: no window opens):

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python app/assets/doozer/build_doozer.py
```

## How often it is drawn (Phase 10)

The rig does not draw itself at the display's rate. `src/frames.ts` (one clock for the whole page; `main.ts` attaches it) takes every running animation in the document (the loops of `rig.css`, the kit's transitions, the performances) and steps them all together: **24 times a second** when nobody is there, **60 times** for four seconds after the pointer or a key touches the page. On a 120 Hz display that is a fifth of the pictures and about a quarter of the cost: drawing pictures is what animation costs here ([docs/polish-checks.md](../../../docs/polish-checks.md)). Nothing in this folder knows about it, with two exceptions:

- **Loop lengths are whole pictures.** At 24 pictures a second a loop whose length is not a whole number of them is caught at a different point each time round and stutters. The quick loops of `rig.css` are whole twelfths of a second (its "Timing" comment lists them), `walkCycleMs` rounds a walk cycle to a whole twelfth, and the shake-off is ten whole swings. Keep to that when adding one.
- **A thing moved from script** asks the same clock for its frames (`frames.request`, or `frames.frameSource()` where a pair of functions is wanted) instead of `requestAnimationFrame`, so it moves in step with the feet.

See every picture of every animation as it is drawn at a given rate: `/viewer.html?only=rig&strip=24` (or 30, 60). Watch the rig at a given rate: the *Drawn* selector at the top of the viewer.
