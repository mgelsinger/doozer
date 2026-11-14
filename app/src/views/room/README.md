# views/room — the terrarium

Phase 7 (DESIGN_SPEC.md 6.2). A framed little room with its own title bar. You set things up by clicking the furniture; Doozer decides when to use them. A slim strip of meters under the scene, and a button in the title bar that opens the Card.

A view draws and forwards clicks. Rules live in `core/`; the window, the save and the clock live in `host/`.

| File | What is in it |
|---|---|
| `index.ts` | `createRoomView()`: the view. Elements, the furniture's clicks, petting, the Card, the title bar as a drag handle, tuck-away. |
| `behaviour.ts` | What Doozer does: where it belongs, the walks between, the little scenes, what it gets up to alone. No DOM. |
| `walker.ts` | Where Doozer is on the floor, as a function of time. Pure. |
| `scene.ts` | The picture (soft storybook SVG, no outlines) and the functions that repaint what changes in it. |
| `sky.ts` | The sky for an hour of the day, the light in the room, the clock's hands and timer slice. Pure. |
| `layout.ts` | The window and the frame for each size, where the Card goes, and where everything is in the scene. Pure numbers; mirrored in `room.css`. |
| `room.css` | The frame and the scene's styles. The Card, the settings panel and the meters are the kit's. |

Tests: `app/tests/views/room/` (`room-view.test.ts` and `room-stuck.test.ts` run the whole view against the real brain in a test DOM). Scripted runs in the real window: `app/src/spike/room-scenarios.ts`, started by `app/scripts/run-room-checks.ps1`. What they showed: `docs/room-checks.md`.

## The furniture

| Object | A click calls | What the room then shows |
|---|---|---|
| Bowl | `brain.fillBowl()` | Kibble for each serving. When the brain says Doozer ate from it (`auto-eat`), Doozer walks over and eats; the serving stays in the bowl until it gets there |
| Ball (or the yarn ball, once unlocked) | `brain.play()` | The ball is tossed and Doozer trots after it for three kicks. Refused (too tired, asleep): the ball only hops |
| Soap | `brain.wash()` | Scrubbed where it stands: bubbles, a shake, a sparkle. The rubber duck turns up once unlocked |
| Lamp | `brain.sleep()` or `brain.wake()` | The lamp is on exactly while Doozer is awake. Off: Doozer walks to bed. On: it gets up |
| Bed | `brain.toggleSleep()` | The same |
| Window | nothing | Doozer wanders over and looks out by itself |
| Treat jar | `brain.giveTreat()` | Doozer comes running; the treat drops from the jar. The jar shows roughly how full it is |
| Clock | `brain.startFocus()` or `brain.stopFocus()` | Doozer fetches the top book of the pile and reads on the rug. The clock becomes a kitchen timer (the coloured slice is the time left) and the title bar counts down |

The view never decides a rule. "Hungry", "too tired", "not sleepy", "the jar is empty" are all the brain's answers; a refusal gets a wiggle of the furniture, a head-shake and a "?", never text.

## Where Doozer belongs

One function of the brain's state (`desired` in `behaviour.ts`): **in bed** while asleep, **on the rug with its book** while a session is running or paused, otherwise **free** on the floor. Where Doozer actually is (`station`) is one variable. Whenever nothing is playing and the two differ, `reconcile` starts the walk that fixes it: to bed, out of bed, to the books and then the rug. It runs after every scene, on every change of the brain, and once a minute.

Free, and left alone, Doozer does something by itself every one to two and a bit minutes (`ALONE_MS`). About seven times in ten that is a **glance**: its eyes go to two things in the room and back, and nothing else moves. The rest (`ALONE_OUTING_SHARE`) are real outings: a stroll, a look out of the window, a nudge of the ball, a hop or a yawn. That works out at a real outing about every six minutes. With somebody there (the pointer resting in the room) it does something every 5 to 11 seconds (`ATTENDED_MS`), and all of it is real outings. While reading it turns a page every three to five minutes. Asleep it does nothing.

Why a glance: a second of animation in this window costs about a third of a processor core, so an outing costs one to three core-seconds, while a glance is a few redraws (`docs/room-checks.md` section 6). The three numbers above are in `behaviour.ts` and are the knobs for "how lively when nobody is looking".

## Render on demand

At rest the room is a still picture. What still happens: a two-redraw blink every 4 to 9 seconds, the sky, the clock and the title bar repainted once a minute (once a second for the title bar during a session), and the glances and outings above. Doozer animates only while a scene that moves something is playing or `Attention` (shared with the Pill) says somebody is there. Nothing in the picture loops: the clouds move a few pixels when the minute is repainted, the stars do not twinkle, a sleeping Doozer's z's rise only while the pointer is in the room, and an urgent need's icon does not shake in the strip while nobody is looking.

Why so strict: one animation that never stops costs 13–26 % of a processor core in this window (`docs/shell-spike.md` 2.1). Measured cost is in `docs/room-checks.md`.

## Never stuck

- **Where Doozer belongs is worked out, not remembered** (above), so a missed event or an interrupted scene is put right the next time anything happens, and within the minute at the latest.
- **One scene at a time**, each with a time limit of 16 s (`SceneRunner` from the kit). A new scene ends the old one completely: Doozer stops on the spot, faces forward, and anything the scene put down (a snack, the duck, a held serving in the bowl) is removed. A scene that runs out of time is not retried: Doozer is put where it belongs.
- **A walk is a start, an end and a duration** (`walker.ts`), drawn as one CSS transition. Nothing waits for an animation event or a frame; arriving is a timer.
- **The window drag** ends on the shell's `drag-end` and `pointer-released`, on `pointerup` and `pointercancel`, on any pointer move with no button held, and after 20 s. A press on the title bar that goes nowhere is forgotten after 6 s.
- **A highlighted piece of furniture** lets go 4 s after the last pointer event; the "not now" wiggle is ended by a timer.
- **Popped out for a window change**, Doozer is back after 1.5 s even if the host never says so.
- **A double-click counts once** (320 ms, by event time), so the lamp is not switched off and on again and a session is not started and stopped.
- **Tucked away** (`setAwake(false)`): the Card folds, the scene stops, every timer of the view stops. Back on screen, Doozer is simply where it belongs; it does not walk there.
- **`unmount`** leaves no timer, no listener and no element (tested with the fake clock's timer count, at several moments of every scene).

## Decisions made here (also in WORK_PLAN.md's log)

- **The window is bigger than the room.** The Card (320 wide, about 540 tall) is taller than the room at Medium, so the window keeps an empty, click-through band of 200 px above and below the frame and never changes size. The Card hangs from under the title bar, over the scene; when the room is near the bottom of the screen it slides up just far enough to stay on it. The shell gained `bleed` on a floating window so that those bands may hang off the work area and the room itself can sit right at the top or bottom edge. (The frame's place in the window is on a wrapper, `.roomv-slot`, and the Size scale on the frame inside it: a scaled element's own `left` and `top` are scaled too, and the frame has to be drawn exactly where its hit region is.)
- **The frame is dark glass, the room is not.** Title bar and meter strip are the kit's chrome (spec section 8); inside them the scene keeps its own soft art.
- **A close button on the Card's corner**, because slid up, the Card can cover the title-bar button that opened it.
- **Size** (Small / Medium / Large) scales the frame (0.86 / 1 / 1.2). The band is the same in every size, so the frame's top-left corner stays put when the size changes. The Card is the same everywhere.
- **The lamp is not a separate switch.** It is on exactly while Doozer is awake, so it can never disagree with the pet; a Doozer that drops off by itself turns the room dim too.
- **The window is not clickable**, as the spec's table says ("—").
- **During a session** Doozer does not leave its book for the bowl: the serving the brain has it eat simply disappears from the bowl. Things *you* do (a treat, a bath) still get their scene, and Doozer fetches its book again afterwards.
- **A clock click while a session is running stops it**, as the spec says. Pause and resume are on the Card.
- **Keyboard:** as in the Pill, the window may take keyboard focus only while the settings panel is open.
- **A new Doozer met in the Room** (its hatching in the Pill was cut short) gets a short hello here, favourite snack included, and is then marked as welcomed.
- **The ball is where you left it only until you leave**: its place, like Doozer's, belongs to the view and does not carry over (spec 5.1).
