# views/pill — the home base

Phase 6 (DESIGN_SPEC.md 6.1). A dark pill docked to a screen edge: Doozer tucked into the left end, the name, one status line, and a ring. Click it and the Card unfolds from it; the settings panel takes the Card's place.

A view draws and forwards clicks. Rules live in `core/`; the window, the save and the clock live in `host/`.

| File | What is in it |
|---|---|
| `index.ts` | `createPillView()`: the view. Elements, what is open, presses, the first run, tuck-away. |
| `face.ts` | What the pill says for a given state: status words, tone, ring. Pure. |
| `layout.ts` | The window (one fixed size) and the spacing inside it. Pure numbers; mirrored in `pill.css`. |
| `attention.ts` | "Lively only while there is a reason to be": the render-on-demand clock. Pure. |
| `pill.css` | The pill's own styles. The Card and the settings panel are the kit's. |

Tests: `app/tests/views/pill/` (`pill-view.test.ts` runs the whole view against the real brain in a test DOM).

## How it is put together

**One window size.** The window is always 400 × 744: the pill plus the room the Card needs. It is transparent and click-through except for the hit regions, so the empty part costs nothing, and opening the Card never resizes the window. The dock setting only changes the window's anchor and which way the column runs (`data-dock`): on the bottom dock the pill is at the bottom and the Card unfolds upward.

**Hit regions:** the pill, a rounded box over the part of Doozer that pokes above it, the Card or the settings panel when open (their layout box, not their mid-animation box), and the sound question while it shows.

**What is open** is one variable, `'none' | 'card' | 'settings'`, mirrored in `data-open`. `setOpen` sets it and returns; nothing waits on an animation.

**The status line and ring** (`face.ts`): the mood in words; amber when a need is low; different words *and* red when it is urgent; a countdown and a progress ring while a session runs, with nothing else changing colour (spec 4.5).

## Render on demand

At rest the pill does not animate at all. Every few seconds Doozer blinks in two redraws (`doozer.blink(true)`), and that is everything. Doozer breathes, fidgets and plays its little scenes only while `Attention` is lively: for a few seconds after the pointer *rested* on the window (a pointer that merely crosses the pill on its way to a title bar or a tab is ignored: it has to stay 180 ms before the pill even shows its hover look), after the brain announced something (an action, a refusal, a mood change, a session starting or ending), after the Card was opened, or after coming back on screen. Each of those is a `poke` with a time limit; when the last one runs out everything goes still, including an open Card that nobody is looking at (`card.setLively(false)`) and the z's of a sleeping Doozer.

Why so strict: one animation that never stops costs 13–26 % of a processor core in this window (`docs/shell-spike.md` 2.1). Measured idle cost is in `docs/pill-checks.md`.

Tucked away (`setAwake(false)`): the Card folds, every timer of the view stops, and nothing can wake it until `setAwake(true)`.

## Never stuck

- A press ends on `pointerup`, `pointercancel`, `pointerleave`, a move with no button held, the shell's `pointer-released`, and in any case after 3 s. A lost press toggles nothing.
- The hover look relaxes 4 s after the last pointer event (a click-through window is not always told the pointer left).
- A second click within 320 ms is the same click, as on the Card.
- Doozer popped out for a window change comes back after 1.5 s even if the pop-in never comes.
- The hatching has a 12 s limit and ends the same way however it ends; one that is cut short cannot end the next one.
- `unmount` leaves no timer and no listener behind (tested with the fake clock's timer count).

## Decisions made here (also in WORK_PLAN.md's log)

- **Size** (Small / Medium / Large) scales the pill's face (0.86 / 1 / 1.18). The Card is the same in every view and size.
- **Keyboard.** The window may take keyboard focus only while the settings panel is open. With the Card open it still never does, so feeding, petting or starting a session never pulls you out of what you were typing in. The Card's keyboard support is therefore unreachable in this view until there is a way in that does not need a click (Phase 10).
- **Stroke to pet** is on Doozer itself (the pocket and the part above the pill); a click anywhere on the pill opens or closes the Card.
- **Emotes** from the pill are small and drift sideways as much as up: a pill docked to the top of the screen has almost no room above it.
- **No props** in the pill: an eating or playing scene is played by Doozer's face alone. The Card's stage shows the snack and the ball.
- **"Open the Card" when a session ends** opens it without taking focus; if the session ended while tucked away, the celebration and the Card wait until Doozer is back.
- **The sound question** is a small panel under the pill, shown once the hatching is over, hidden while the Card is open or a session runs, and answered just as well by the mute button or the Sound switch.
