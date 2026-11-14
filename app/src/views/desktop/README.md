# views/desktop — the calm roamer

Phase 9 (DESIGN_SPEC.md 6.4). An invisible overlay over one monitor's work area, click-through everywhere except Doozer and its menus. Doozer lives on the top edge of the taskbar: it stands there, strolls a little, peeks in from the edge of the screen now and then, and can be picked up and put down somewhere else.

A view draws and forwards clicks. Rules live in `core/`; the window, the save and the clock live in `host/`.

| File | What is in it |
|---|---|
| `index.ts` | `createDesktopView()`: the elements, the pointer (poke, carry, stroke), the Radial / Card / settings, the watchdog, tuck-away. |
| `director.ts` | What Doozer does: strolls, peekaboo, gestures, and the scenes for what the brain says (eat, ball, wash, celebrate...). One scene at a time, each with a time limit. |
| `body.ts` | Where Doozer is and how it is moving: standing or walking on the line, carried, floating down. No DOM. |
| `stage.ts` | Where things are: the ground line, the walking range, the hit area, the Radial's arc, the Card's place, the spot per monitor. Pure. |
| `pace.ts` | Still / Calm / Lively as one table of numbers. Pure. |
| `motion.ts` · `ball.ts` | A walk or a float as a function of time; the ball's bouncing. Pure. |
| `props.ts` | The snack, the ball and the duck that appear for the length of a scene. |
| `named-timers.ts` | The view's timers, each with a name, so "nothing is running" can be checked. |
| `desktop.css` | The view's own styles. The Radial, the Card, emotes and the focus chip are the kit's. |
| `checks.ts` | Scripted runs in the real window (stuck cases, click-through probes, the soak, idle). Loaded only in a test build. |

Tests: `app/tests/views/desktop/` (the whole view against the real brain in a test DOM). What was checked in the real window, and how, is in `docs/desktop-checks.md`.

## How it is put together

**The window** is `{ kind: 'overlay' }`: the work area of the monitor the window is on, so the page's bottom edge *is* the top edge of a taskbar that runs along the bottom. Doozer's soles rest a few pixels above that edge (the shadow under its feet ends one pixel inside the window). With the taskbar on another edge, or auto-hidden, the bottom of the work area is the bottom of the screen and Doozer stands there; `stage.ts` reads which it is from what the work area leaves of the monitor.

**Position** is two numbers, Doozer's middle and the soles of its feet, and one `transform` on `.deskv-pet`. Standing still, that is all there is.

**Hit regions** (`hitRegions()`), clipped to the window: Doozer's body, ears and tuft (a rounded box, 70 % by 84 % of the sprite: `HIT` in `stage.ts`, and the same shape in `desktop.css`, so what the window catches and what the page answers to agree); the Radial's six buttons while it is open, where they come to rest rather than where their opening spring has got to; the Card or the settings panel while open; the ball while it is in play. The view tells the host on every step of a walk, a carry or the ball (`host.regionsChanged()`), about thirty times a second while something moves and never while nothing does.

**What is open** is one variable, `'none' | 'radial' | 'card' | 'settings'`, mirrored in `data-open`. A click on Doozer pokes it and opens the Radial (or closes whatever is open); *More* opens the Card over Doozer's head (beside it on a screen too short for that); the settings panel takes the Card's place and is the only thing that may take the keyboard.

**Movement** is a function of the clock (`motion.ts`): where Doozer is at any moment is worked out from when the move began. A timer steps it every 33 ms and reports the hit region; animation frames, when they come, only make it smoother. So a walk ends when its time is up whether or not a frame was ever drawn (a hidden window draws none).

**The spot.** Doozer starts right of the middle of the screen. Where it is put down becomes its spot: Calm strolls stay within 300 px of it, a peek returns to it, and it is kept in the save per monitor (`context.memory`, as how far across the screen) so Doozer is there again next time, on each monitor separately.

## Pace: Still, Calm, Lively

One table, `PACES` in `pace.ts`. The owner chooses the default by trying them (spec 6.4, "Pace"); it is Calm until then, and changing it is one word in `core/tuning.ts`.

| | Still | Calm (default) | Lively |
|---|---|---|---|
| Strolls | never | every 45–120 s it may (3 times in 4) walk 60–300 px at 30 px/s, the `walk` gait, never more than 300 px from its spot | 1–4.5 s after arriving it is off again (about 6 times in 10), anywhere along the line, at 56 px/s, the `trot` gait |
| Peekaboo | never | every 7–13 minutes, walking to the edge at 50 px/s and back to its spot | every 50–110 s, at 70 px/s, settling a little way in from the edge |
| A meal or a treat | lands in reach, eaten on the spot | the same | lands 80–110 px away; Doozer trots over at 95 px/s |
| Play | bats the ball where it stands, about 4 s | the same | the mockup's: chases the ball at 150 px/s and kicks it, six kicks or 16 s |
| Small gestures (a glance, a yawn when sleepy) | every 14–34 s | every 14–34 s | every 4–9 s, and it waves when it is in a good mood |

Lively keeps the mockup's rhythm and its speeds for the peek, the run to the food and the chase (70, 95 and 150 px/s). Three things are not the mockup's: its stroll was 46 px/s with a walk of its own, and the rig's trot would slide at that speed, so the stroll is 56; it peeked on a quarter of its decisions (every quarter of a minute), which is one every minute or so here; and there are no windows to jump on (spec 2.1).

Speeds are chosen so that the feet do not slide. The rig's walk covers about 29 px a cycle at the Medium size and its trot about 47, and a cycle can only be so slow or so fast (`walkCycleMs`): a walk suits 20–50 px/s and a trot 60–150.

Never, at any pace: wandering during a focus session, while asleep, while a menu is open, while the pointer rests on Doozer or a button is held on it, or with *Reduce motion* on. A scene the brain asks for while the Card is open is played on the spot, so the Card is never left hanging where Doozer was.

## Never stuck

The owner's one complaint about the mockup was that Doozer "would get stuck randomly". Two causes were found there: a scene that never ended when its walk was interrupted, and the window going click-through in the middle of a drag so that the mouse-up was lost. The shell deals with the second (docs/shell-spike.md 4.3, 4.5). This view is built so that neither can leave Doozer stuck:

- **One scene at a time, each with a time limit.** Everything Doozer does is a scene in one `SceneRunner` (`director.ts`). A new scene, a refusal, being picked up, falling asleep, a session starting, the view leaving or the limit all end it the same way: its clean-ups run, it is never resumed, and `sceneEnded` leaves Doozer standing, with no borrowed pose and nothing beside it.
- **A walk always answers.** `body.walkTo()` resolves `true` on arrival and `false` when the walk was stopped; a scene whose walk did not arrive ends there.
- **A carry always ends**: on `pointerup`, `pointercancel`, lost pointer capture, the shell's `pointer-released`, the window losing focus, the first pointer move with no button held, after 30 s with no pointer event at all, and after 2 minutes however it is held. Let go in mid-air, Doozer floats gently down (0.4–2.4 s, no gravity, no bounce); the float ends on a timer.
- **Everything temporary has a limit**: a press that never moves or ends (10 s), the hover look (4 s), the Radial (12 s with no pointer event, as well as its own 9 s), the Card (2 min), the settings (3 min), Doozer popped out for a window change (1.5 s).
- **The watchdog** (`watch()` in `index.ts`) asks once a second while anything is going on, and every five seconds at rest, whether everything is as it should be: `Body.check`, `Director.check` and `check` list everything that is not (off the line, a pose with nothing behind it, a scene past its limit, a prop with no scene, a menu with no limit, nothing left to start the next stroll...). If anything is listed, `recover()` puts Doozer on the line, idle, with nothing open, and the rescue is counted and described in the snapshot. **A rescue is a bug**: the tests and the soak hold the view to *zero*, and a separate test breaks the view on purpose to show the watchdog works.
- **Tucked away** (`setAwake(false)`) stops every timer the view owns; `unmount` leaves no timer and no listener.

## Render on demand

At rest Doozer is perfectly still: a blink in two redraws every 4–9 s (`doozer.blink(true)`), a glance to one side now and then, also in two redraws (the eyes are simply somewhere else, and a second or two later back; easing them across cost about half of what Doozer cost at rest, so `desktop.css` switches the easing off while the rig is paused), and nothing else. It breathes and moves only while it is doing something (a scene, a carry, a float) or while someone is at it: `Attention`, shared with the Pill, is poked when the pointer *rests* on Doozer (180 ms; a pointer on its way to the taskbar is ignored), when the brain says something happened, and when a menu opens. Asleep, its z's rise only while someone is there.

A stroll is an animation and costs what one costs (docs/shell-spike.md 2.1), so the paces differ in idle cost by how much of the time Doozer is walking. The measurements are in `docs/desktop-checks.md`.

## Decisions made here (also in WORK_PLAN.md's log)

- **The overlay is the whole work area**, as the spec says, not a strip along the bottom: Doozer can be carried anywhere on the screen. It costs about 30 MB more than the pill (docs/shell-spike.md 2.1).
- **With the taskbar not along the bottom**, Doozer stands on the bottom edge of the screen. "On the top edge of the taskbar, nowhere else" cannot be meant for a taskbar that stands upright.
- **Size** (Small / Medium / Large) is Doozer's size: 92, 112 or 136 px.
- **Reduce motion**: Doozer does not wander, a carry ends on the line with no float, and Lively's running scenes are played on the spot.
- **A sleeping Doozer is carried asleep.** Picking it up does not wake it (the mockup woke it); waking is the user's choice, in the Radial.
- **The ball can be bopped** with a click. It cannot be dragged or thrown (spec 2.1 cut throwing). A snack on the ground is not clickable.
- **Peekaboo has no words** (the mockup said "peekaboo!"): a heart floats up as Doozer peeks back in.
- **While a session is paused** Doozer may wander again, glasses still on: the brain's `quiet` flag is what silences it, and that is true only while a session is *running*.
- **The time left** shows over Doozer's head only while the pointer rests on it, and goes 4 s after the pointer was last heard from (a click-through window is not always told the pointer left).
- **A new pet met in this view** (normally the Pill hatches it) pops in, waves and shows its favourite snack once.
- **One monitor.** The overlay covers the monitor the window is on, and Doozer cannot be carried across to another. Which monitor that is follows the window (where the Pill was docked, where the Room floated).
