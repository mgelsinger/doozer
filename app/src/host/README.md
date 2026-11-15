# host — one pet, one window, one view at a time

Phase 6. `main.ts` reads the save, creates the brain and hands both to the host built here. Everything about the *window* and the *save* lives in this folder; everything about the *pet* lives in `core/`; everything that is *drawn* lives in a view.

| File | What is in it |
|---|---|
| `view.ts` | The view contract: what the host asks of a view and what a view may ask of the host. Types only. |
| `host.ts` | `createHost`: mounting and switching views, the clock, saving, tuck-away, and what the window settings do. |
| `store.ts` | The save document (`{ brain, host }`) and `createSaver`, which decides when it is written. |
| `sound.ts` | The sounds: thirteen short ones, synthesised in the page from one small instrument and one five-note scale. Silent unless Sound is on. |

Tests: `app/tests/host/` (no DOM needed; the shell, the root and the views are fakes).

## Writing a view

```ts
import type { View } from '../../host/view';

export function createRoomView(): View {
  return {
    id: 'room',
    windowSettings: ['size'],                       // the host re-places the window when one of these changes
    window: ({ settings, position }) => ({ kind: 'floating', width: 380, height: 464, ...(position ?? {}) }),
    mount(root, { brain, shell, host, info }) { /* build inside root; subscribe to the brain here */ },
    unmount() { /* release everything */ },
    hitRegions: () => [/* where the mouse is caught; everything else is click-through */],
    leave: () => doozer.perform('pop-out'),         // optional
    enter: () => doozer.perform('pop-in'),          // optional
    setAwake(awake) { /* false: stop every timer and animation */ },
    openSettings() { /* the tray asked */ },
  };
}
```

Then add it to the `views` list in `main.ts`. The Card, the settings row and the tray menu show a view as "coming soon" for exactly as long as it is missing from that list.

Rules for a view:

- It never calls `shell.setWindowMode` or `shell.setHitRegions`. It answers `window()` and `hitRegions()`, and calls `host.regionsChanged()` whenever its layout changes (cheap; call it freely).
- It ends anything it drags on the shell's `pointer-released` as well as on its own pointer events (`shell.on('pointer-released', …)`).
- It subscribes to the brain inside `mount`. The host runs the first `tick()` only after that, so `away` and a session that finished while the app was closed reach it.
- `setAwake(false)` must leave no timer of the view's running: a hidden window is not told it is hidden.
- It asks for the keyboard (`host.setFocusable(true)`) only while something really needs typing or arrow keys, and gives it back. The host takes it back anyway when the view leaves.
- If it has something of its own to remember that is about the view and not the pet (the Desktop view: where Doozer was left standing on each monitor), it keeps it in `context.memory`: `read()` gives back what it last wrote, or null, and `write(value)` replaces it. The value must be plain JSON; treat what comes back as untrusted, since it has been through a file. The host saves it and never looks inside.

## What the host does

**Switching** (`docs/shell-spike.md` 4.2): the old view's `leave()` (Doozer pops out, at most 400 ms) → hide and wait three frames → unmount → `shell.setWindowMode` → mount → show → one frame → hit regions → `enter()` (not waited for). One switch at a time; a second request waits. `settings.lastView` is set after every switch, and the app reopens there.

**Re-placing** without a remount, when a setting in `windowSettings` changes or the view calls `host.windowChanged()`: the same steps without unmount and mount; the view gets `windowChanged(info)`.

**Never stuck.** Every wait has a limit: a pop-out that never settles, a frame that never comes (a hidden window draws none), a window that refuses to change, a view that throws while mounting. The result is always either a view on screen with its regions reported (the first view in the list is the fallback), or nothing shown and the whole window click-through.

**The clock.** `brain.tick()` every 250 ms, every second while tucked away. A listener that throws does not stop it.

**Saving.** Within a second of anything happening (an action, a setting, a session event, a view changing its note, coming back from time away), within five minutes when only time has passed, when tucking away, and before quitting. Quit from the tray arrives as the shell's `quit-requested`; the host saves and answers with `shell.quit()`, and the shell quits by itself after 0.9 s if the page never answers. If the save could not even be *read* at start-up the host runs without writing, so a good save is never replaced by a new pet.

**Tuck away.** `fullscreen-changed` (or a fullscreen app already in front at start-up) with the setting on: the view is told `setAwake(false)`, the regions are dropped, the window is hidden, the save is written. The brain keeps ticking, so a session still ends on time.

**Settings that are about the window:** always on top, start with Windows (if registering fails the switch turns itself back off, so it never lies), tuck away.

**First run.** `host.needsWelcome()` is true until the mounted view calls `host.welcomed()` for this pet (its `bornAt` is remembered in the save), so a pet hatches exactly once and a new pet hatches again.

## Added in Phase 10

**Sound** (`sound.ts`, and `soundFor` in `host.ts`). The set is data (`SOUNDS`: notes with a time, a pitch, a ring and a loudness), so what it promises is tested without a loudspeaker: every pitch is on the scale, nothing is louder than a tenth of full volume or longer than a second and a half. The *host* decides when one is played, so no view has to: for something you did (fed, a treat, the bowl, play, a wash, a pet, tucked in, woken, a refusal, a move to another view), when a session starts, and when one ends (the chime, and a sparkle after it if something was unlocked). Never for what Doozer does by itself, never in the middle of a session, and nothing but the chime while tucked away. The audio device is opened at the first sound and let go again when the last note has died away. Hear them all at `/viewer.html#sounds`.

**The Card from the keyboard.** The shell's `card-requested` (Ctrl+Alt+D, or *Open Doozer's card* in the tray menu) is passed to the view's optional `openCard(keyboard)`. With `keyboard` true the shell has already given the window the keyboard; the view opens its Card with focus on the first button, and when the Card closes the host's `setFocusable(false)` hands the keyboard back to the window that had it. Nothing else ever gives the window the keyboard unasked.

**Interface size** (`uiScale` in the settings: Normal, Large, Larger). The host tells the shell (`shell.setUiScale`), which zooms the page and counts the zoom into every pixel calculation it makes, so the window, the hit regions and the pointer stay in step. A view needs to do nothing: it is simply handed a smaller `info.workArea` in its own pixels.

**Memory** (`syncMemory`). Tucked away, and for a few seconds after leaving a view that says it is `heavy` (the Island), the host asks the browser to hold less (`shell.setLowMemory`). It is a hint the browser may take or leave; what it gave back, measured, is in [docs/polish-checks.md](../../../docs/polish-checks.md).
