# host — one pet, one window, one view at a time

Phase 6. `main.ts` reads the save, creates the brain and hands both to the host built here. Everything about the *window* and the *save* lives in this folder; everything about the *pet* lives in `core/`; everything that is *drawn* lives in a view.

| File | What is in it |
|---|---|
| `view.ts` | The view contract: what the host asks of a view and what a view may ask of the host. Types only. |
| `host.ts` | `createHost`: mounting and switching views, the clock, saving, tuck-away, and what the window settings do. |
| `store.ts` | The save document (`{ brain, host }`) and `createSaver`, which decides when it is written. |
| `sound.ts` | The one sound of this phase: the chime when a focus session ends. Silent unless Sound is on. |

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

## What the host does

**Switching** (`docs/shell-spike.md` 4.2): the old view's `leave()` (Doozer pops out, at most 400 ms) → hide and wait three frames → unmount → `shell.setWindowMode` → mount → show → one frame → hit regions → `enter()` (not waited for). One switch at a time; a second request waits. `settings.lastView` is set after every switch, and the app reopens there.

**Re-placing** without a remount, when a setting in `windowSettings` changes or the view calls `host.windowChanged()`: the same steps without unmount and mount; the view gets `windowChanged(info)`.

**Never stuck.** Every wait has a limit: a pop-out that never settles, a frame that never comes (a hidden window draws none), a window that refuses to change, a view that throws while mounting. The result is always either a view on screen with its regions reported (the first view in the list is the fallback), or nothing shown and the whole window click-through.

**The clock.** `brain.tick()` every 250 ms, every second while tucked away. A listener that throws does not stop it.

**Saving.** Within a second of anything happening (an action, a setting, a session event, coming back from time away), within five minutes when only time has passed, when tucking away, and before quitting. Quit from the tray arrives as the shell's `quit-requested`; the host saves and answers with `shell.quit()`, and the shell quits by itself after 0.9 s if the page never answers. If the save could not even be *read* at start-up the host runs without writing, so a good save is never replaced by a new pet.

**Tuck away.** `fullscreen-changed` (or a fullscreen app already in front at start-up) with the setting on: the view is told `setAwake(false)`, the regions are dropped, the window is hidden, the save is written. The brain keeps ticking, so a session still ends on time.

**Settings that are about the window:** always on top, start with Windows (if registering fails the switch turns itself back off, so it never lies), tuck away.

**First run.** `host.needsWelcome()` is true until the mounted view calls `host.welcomed()` for this pet (its `bornAt` is remembered in the save), so a pet hatches exactly once and a new pet hatches again.
