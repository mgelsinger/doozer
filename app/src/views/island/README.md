# views/island — the one you touch

Phase 8 (DESIGN_SPEC.md 6.3). A soft 3D Doozer on a small floating island, in a frameless, transparent window. Stroke it to pet it; click it to poke it (it jiggles) and open the Radial; click the ball to bop it. Snacks drop out of the sky and Doozer hops over to eat; a little rain cloud gives it a bath; night falls when it sleeps. This is the only 3D view.

A view draws and forwards clicks. Rules live in `core/`; the window, the save and the clock live in `host/`.

| File | What is in it | three.js? |
|---|---|---|
| `index.ts` | `createIslandView()`: the view. Loads the stage on mount; elements, pointer, what is open, the small timers, a lost graphics context. | no |
| `engine.ts` | Fetches the 3D engine into a hidden frame of its own, with a time limit, and gives it back. | no |
| `frame.ts` | What runs inside that frame (`app/island-frame.html`): the one place three.js is imported for the app. | on demand |
| `layout.ts` | The window for each size and its bands, where a panel goes, the island's shape, the camera's numbers. Pure. | no |
| `camera.ts` | The camera as arithmetic: where a point lands on screen, and the ray under a point. Pure. | no |
| `regions.ts` | The hit regions (the island's outline cut into slabs, Doozer, the ball) and what is under the pointer. Pure. | no |
| `world.ts` | What happens on the island as numbers: Doozer's trips, the ball, the snack, crumbs and raindrops, night. Pure. | no |
| `director.ts` | The scenes: eat, play, wash, sleep and wake, refuse, a focus session starting and ending, wandering. | no |
| `loop.ts` | Render on demand with a capped frame rate, and a timer for when frames do not come. Pure. | no |
| `stage3d.ts` | The three.js scene that draws the world and the 3D Doozer, and disposes of everything. | **yes** |
| `props3d.ts` | The island and its dressing, the eight snacks, the ball and the yarn, the duck, the rain cloud. | **yes** |
| `checks.ts` | Scripted runs in the real window (test builds only). | no |
| `dev/playground.ts` | The view on a plain page for looking at in a browser: `npm run dev`, then `/island.html`. | no |
| `island.css` | The view's own styles. The Radial, the chip, the Card and the settings panel are the kit's. | |

The 3D Doozer itself is in `src/character/` (`doozer3d.ts`, `body-motion.ts`) and the model is built by `app/assets/doozer/build_doozer.py`.

Tests: `app/tests/views/island/` (222). They run the whole view against the real brain, the real model file and the real three.js scene in a test DOM; only the drawing itself is stood in for.

## three.js: loaded on mount, given back on unmount

Nothing the app loads at start-up imports three.js (`lazy-three.test.ts` walks what `main.ts` loads and fails if three.js is in it). In the built page three.js is two files of its own (about 650 KB, 170 KB compressed) that only the Island ever asks for.

**The engine lives in a frame of its own.** A script that a page has loaded stays loaded for as long as the page lives: disposing of the scene gives back what three.js drew and held, but not three.js. So `mount` does not import the engine into the app's page. It opens `app/island-frame.html` in a hidden, zero-sized frame (`engine.ts`), and takes two things from it: the stage module and the function that loads the model (`frame.ts`). Everything made with them (the scene, the renderer, the canvas) belongs to that frame's own script world; the canvas is handed to the app's page to be shown. `unmount` disposes of every geometry, material, texture and shadow map, gives the WebGL context back (`forceContextLoss`), removes the canvas, disposes of the parsed model, and last of all removes the frame, and the engine goes with it. `docs/island-checks.md` has the measurements, before and after.

Two things follow from that, for anyone changing this view:

- **Do not keep anything the engine made past `unmount`**, not even a small plain object such as `stage.info()` returns. An object belongs to the script world that made it and keeps all of it alive; one stray reference in the app's page keeps the whole engine in memory. Copy the numbers out instead. (The first leak measurement with the frame showed the engine being kept, once per visit: the measuring script itself was holding the stage's report.) The view keeps everything from the engine inside `build()`, which `unmount` lets go of.
- An error thrown inside the frame is not an `Error` of the app's page (`instanceof` says no), and the same goes for arrays and every other built-in. `engine.ts` turns a failure into an error of this page; elsewhere the view only passes numbers and its own objects across.

Never stuck: the frame is given 4 seconds. If it does not load, has no engine in it, fails, or is too slow, it is removed and the engine is imported into the page itself (the old way; it works the same, only the engine's code then stays in memory after the Island is left). If loading as a whole takes longer than 8 seconds, or no graphics context can be had, `mount` fails cleanly and the host shows the first view instead; an engine that turns up after that is given straight back.

## Render on demand

At rest nothing is drawn: the frame loop (`loop.ts`) holds no timer and asks for no frame. It is woken by whatever changes something (the brain, the pointer, a scene's timer) and goes back to sleep the first time a frame reports that nothing is moving. `snapshot().frames` counts every frame drawn.

- **Capped:** 60 frames a second while something is happening with somebody there (a hop, the spring, the ball, a scene); 30 while Doozer is only breathing and looking about with somebody there; 24 for anything it does with nobody there. The frames are asked of the page's one frame clock (`src/frames.ts`, Phase 10), so the 3D picture and the dark-glass things beside it are drawn in the same frame and the screen is not woken 120 times a second to draw 24.
- **Lively only while there is a reason** (`Attention`, shared with the Pill): for a few seconds after the pointer *rested* on the island (a pointer that merely crosses it is ignored), or after something happened. Then Doozer breathes, looks at the pointer, and now and then hops to another spot.
- **With nobody there** the island is a still picture with small signs of life, each a named timer that exists only while its reason does: a blink every 4 to 9 seconds (two redraws); asleep, the fireflies have moved a little every 3 seconds (one frame); and every one to two minutes a small stir (a little hop or a wobble: about a second of movement, and Doozer does not come alive for it), never during a focus session. These numbers were set by measurement (`docs/island-checks.md`, idle cost): a second of animation in this window costs a few hundredths of a processor core, and the budget for sitting idle is one hundredth. (Phase 10 made them a little livelier than Phase 8 left them, with what the lower frame rate freed.)
- **A change in the brain is not a change in the picture.** The loop is woken by whatever really changes what is drawn (the 3D Doozer and the world each ask for their own frame), never by the brain's `change` event as such: during a focus session the brain changes every second, and waking on that drew a 3D frame for every tick of the countdown.
- **Frames that never come** (the window is hidden or covered, and the page is not told): after 300 ms a timer takes the frame's place and time passes without drawing, so a hop still lands and a scene still ends.

Tucked away (`setAwake(false)`): scenes are ended and tidied, the Radial and the Card close, the Card and the settings panel are taken down, the loop sleeps, every timer stops, and nothing can wake it until `setAwake(true)`. The tests check that not one timer is left anywhere in the page.

## How it is put together

**The window** is the island's drawing (380 × 450 at Medium; Small is 0.8 and Large 1.25 of that) with an empty, click-through band above and below it, at least 408 wide. The bands are room for the Card and the settings panel, which are taller than the island, and may hang off the top and bottom of the screen (the shell's `bleed`), so the island itself can still sit right at a screen edge. A panel is centred on the island and kept on the part of the window that is on screen.

**Hit regions** follow the island's outline: its silhouette (worked out from the camera, not read back from the picture) is cut into slabs about 16 px tall. Doozer adds two rounded boxes that move with it (at most every 90 ms while it hops), the ball a round one, and the open Radial, the grip and an open panel their own. About 15 at rest; never near the shell's limit of 64.

**Touch** all lands on one transparent layer over the canvas, and what was touched is worked out from the camera (`pick` in `regions.ts`): Doozer is a few rounded blobs that squash with it, the ball and the snack are balls, the island is its grass and its earth. So touch does not depend on the canvas, and survives the renderer being rebuilt.

- **Stroke** across Doozer, button up or down, is a pet (130 px of travel, at most every 600 ms, as on the Card).
- **Press** on Doozer squashes it under the finger for as long as it is held; let go and it springs back. A press that did not move is a **click**: the Radial opens, or closes. A poke is not a pet: the brain hears nothing.
- **The ball** and **the snack** hop when clicked. The ball stays on the island after a game, as a toy lying about (where it rolled to is the view's business and is not saved, per spec 5.1).
- **The grip** shows at the top while the pointer is on the island; pressing it hands the window to the shell to be moved.
- **Right-click** anywhere on the island asks for the native menu.

**Scenes** are the brain's events, choreographed (`director.ts`), one at a time through the kit's `SceneRunner`:

| The brain says | The island shows |
|---|---|
| feed, treat, or Doozer helped itself from the bowl | The snack the brain chose (one of eight, a new object each time) drops beside Doozer and bounces; Doozer hops over, turns to it, eats it in three bites with crumbs, and cheers. Its favourite gets a celebration. During a focus session it eats quietly where it sits. |
| play | The ball (or the yarn) is served; Doozer chases it and kicks it, five times or nine seconds, then cheers. |
| wash | A small rain cloud over Doozer, bubbles, the duck if it is unlocked, a shake dry. |
| sleep / wake | Doozer lies down and night falls: the light cools, a dark sky glows behind the island, moon and stars fade in, fireflies drift. Waking is a stretch and morning. |
| a refusal | A head-shake and a "?"; asleep, a stir and a "z". |
| focus starts / ends | Glasses on, a nod, back to the middle of the island; the chip under the island counts down. At the end, a celebration and the treats. |

## Never stuck

- What is open is one variable mirrored in one attribute. Nothing waits for an animation or a frame.
- A press ends on `pointerup`, `pointercancel`, lost capture, the pointer leaving, a move with no button held, the shell's `pointer-released`, and in any case after 6 s. A lost press toggles nothing. (If the shell's word arrives a moment before the page's own `pointerup`, the click still counts, once.)
- Every scene has a time limit, and its clean-ups always run: the snack is taken away, the chase called off, the rain stopped, Doozer turned to face front. Doozer's trip across the island is waited for with a limit of its own; when it runs out Doozer is simply put where it was going.
- A game of ball ends after five kicks or nine seconds. The ball cannot leave the island, loses speed on the grass, and is put to rest after 7 s of moving regardless.
- The spring, the hop and every eased value come to rest by themselves, and `moving` says when; a hop is ballistics and always lands, even if frames arrive seconds apart.
- A lost graphics context is waited for (2.5 s); if it does not come back the renderer is rebuilt on a new canvas; if that fails too, Doozer goes back to the first view rather than sit on a dead island. Scenes go on meanwhile: only the drawing stops.
- The hover look, a held press, a window drag, Doozer being popped out for a window change: each has a named timer behind it, and `snapshot().timers` lists what is armed.
- `unmount` at any moment of any scene leaves no timer, no listener and nothing on the graphics card (tested at four moments of nine scenes).

`tests/views/island/never-stuck.test.ts` runs all of this on a fake clock, including every scene cut at seven moments by eight kinds of interruption, and four hundred random things in a row.

## Decisions made here (also in WORK_PLAN.md's log)

- **The Card opens over the island,** as it does over the Room: the window cannot hang off the sides of the screen, so there is no room beside it. The island dims a little behind it; a round close button sits on the Card's corner, and a press on the island closes it too. The Card and the settings panel are made when first opened.
- **Keyboard.** As in the Pill: the window may take keyboard focus only while the settings panel is open, or when the Card is asked for from the keyboard (Ctrl+Alt+D or the tray menu), and then it gives it back when the Card closes.
- **Reduce motion** (Phase 10): no crumbs, raindrops or other particles; the ball and a snack are put where they would have come to rest instead of flying there; Doozer does not chase.
- **A poke is not a pet.** Spec 5.4 gives the Island "poke + Radial" for a click and "pet" for a stroke; the mockup counted a poke as a pet. Here only a stroke reaches the brain.
- **Size** scales the island; the Radial, the chip and the Card stay the same size. At Small the Radial is kept inside the drawing by moving it a little off Doozer's middle.
- **Emotes** are the kit's (hearts, sparkles, z, "?", snacks, bubbles), laid over the canvas at Doozer's head, so they look the same as in every other view. Crumbs, raindrops and the ball's puff of stars are drawn in the scene.
- **Night has a sky of its own:** a soft dark-blue glow behind the island, so that the moon and stars show on a pale wallpaper too.
- **The bowl is not drawn on the island.** It is filled from the Card, and Doozer eating from it shows as a snack arriving.
- **Reduced motion:** Doozer is placed rather than hopped, nothing springs or loops, emotes fade in place; faces, snacks and night still show.
- **The 3D engine is loaded into a hidden frame and thrown away with it** (see the section on three.js above). Disposing of the scene was not enough to give the memory back after leaving the Island; removing the engine's whole script world is.
- **The pace when nobody is looking was set by measurement, not taste** (as in the Room): a blink every 4 to 9 seconds, a small stir every one to two minutes, twenty-four frames a second for anything Doozer does unwatched, and Doozer stays still for a stir rather than coming alive for it. With the pointer on the island it breathes, looks at the pointer and wanders every 2 to 5 seconds, at sixty frames a second when something happens. The numbers are at the top of `index.ts`. **These are the owner's to tune by eye.**
