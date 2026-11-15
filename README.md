# Doozer

A small creature that lives on your desktop: one pet with four homes (Pill, Room, Island, Desktop) and a focus timer in every one of them.

- **What gets built:** [DESIGN_SPEC.md](DESIGN_SPEC.md)
- **How and in what order, and where it stands:** [WORK_PLAN.md](WORK_PLAN.md)

## The app (`app/`)

A TypeScript/Vite page inside a Tauri 2 shell. **Milestone 1 is built:** Doozer lives in a small pill docked to the top of the screen and in the tray. Click the pill for the Card: feed, fill the bowl, treats, play, wash, nap, the focus timer and its streak, settings. A view that is not built yet is shown as "coming soon".

**Milestone 2 is built:** the **Room**, a framed little room you can put anywhere on the screen. Pick it in the tray menu or in the Card's row of views, and everything carries over, a running focus session included. Click the bowl to fill it, the ball to toss it, the soap for a bath, the lamp or the bed for bedtime, the treat jar for a treat, the clock to start or stop a session; Doozer decides the rest. The sky in its window follows the real time of day. Drag the room by its title bar; the button in the title bar opens the Card.

**Milestone 3 is built:** the **Island**, the one you touch. A soft 3D Doozer on a small floating island, in a window with no frame at all. Stroke it and it is petted; press it and it squashes under the pointer and springs back; click it for the quick menu. Snacks drop out of the sky (a different one each time), the ball stays lying about to be clicked, a little rain cloud gives it a bath, and night falls on the island when it sleeps. Drag the island by the grip that appears at its top. The 3D engine is only loaded while the Island is open. Whether it beats the mockup for charm is for the owner to say: nobody has watched it move yet ([docs/island-checks.md](docs/island-checks.md), section 10).

**Milestone 4 is built:** the **Desktop**. No window at all: Doozer stands on the top edge of the taskbar, and every click beside it goes to whatever is underneath. It strolls a little, peeks in from the edge of the screen now and then, and sits still with its glasses on during a focus session (rest the pointer on it to see the time left). Click it for the quick menu, drag it to carry it somewhere else and let go: it floats down and stays near that spot. *Desktop activity* in Settings is how much it moves on its own: Still, Calm (the default for now) or Lively. Two things about it are waiting for the owner: which of those should be the default, and whether Doozer still ever gets stuck ([docs/desktop-checks.md](docs/desktop-checks.md), section 9).

**The polish pass (Phase 10) is done**, across all four views. Everything that moves is now drawn 24 times a second when nobody is there and 60 times with the pointer on Doozer, where it was drawn at the display's 120: a second of Doozer walking costs about a quarter of what it did, and Doozer alone in the Room and on the Island is livelier again for it. The time left in a focus session is shown to the minute while nobody is looking. **Ctrl+Alt+D** (or the tray menu) opens the Card with the keyboard, and Escape gives the keyboard back. *Interface size* in Settings makes everything larger. *Reduce motion* is honoured in every view. With Sound switched on there is a small family of soft sounds, all made in the app. What was measured, what could not be met, and what needs the owner's eyes and ears (whether 24 pictures a second reads as smooth, and how the sounds sound): [docs/polish-checks.md](docs/polish-checks.md).

Run everything from the `app` folder; first time only: `npm install`.

| Do this | Command |
|---|---|
| Run the app with live reload | `npm run tauri dev` |
| Build the app (no installer) | `npm run tauri build -- --no-bundle` → `src-tauri/target/release/doozer.exe` |
| Page-side tests | `npm test` |
| Native-side tests (window maths, hit regions, save file, start with Windows) | `cargo test` in `app/src-tauri` |
| Type-check | `npm run typecheck` |
| See the rig and the UI kit on one page | `npm run dev`, then `/viewer.html` (the 2D and the 3D Doozer side by side: `/viewer.html?only=3d`) |
| Hear the sounds; see every picture of every animation as the app draws it | `npm run dev`, then `/viewer.html#sounds` and `/viewer.html?only=rig&strip=24` |
| See the Island in a browser | `npm run dev`, then `/island.html` |
| Rebuild the 3D model (Blender 5.2, no window opens) | `& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python assets/doozer/build_doozer.py` |
| Scripted checks of the built app (a day's use, never stuck, the window) | `pwsh scripts/run-app-checks.ps1` (needs the build described at the top of that script) |
| The same for the Room (the furniture, an hour alone, switching views, never stuck) | `pwsh scripts/run-room-checks.ps1` (same build) |
| The same for the Island (never stuck, a lost graphics context, click-through along its outline, memory after leaving, pictures) | `pwsh scripts/build-island-checks.ps1`, then `pwsh scripts/run-island-checks.ps1` and `pwsh scripts/measure-island-leak.ps1` (builds into its own folders) |
| The same for the Desktop (never stuck, click-through probes, a soak) | `pwsh scripts/build-desktop-checks.ps1`, then `pwsh scripts/run-desktop-checks.ps1` (builds into its own folders) |
| Reduce motion and the interface size in every view, the keyboard way into the Card; and the measuring tools | `pwsh scripts/build-polish-checks.ps1 -Label final`, then `pwsh scripts/run-polish-checks.ps1`; `measure-set.ps1` and `trace-frames.ps1` are described in [docs/polish-checks.md](docs/polish-checks.md), section 17 |

Using it:

- **Quit** from the tray icon, from a right-click on the pill, or from the bottom of Settings. All three save first.
- **Ctrl+Alt+D** opens the Card with the keyboard in any view (Tab and the arrow keys move, Enter presses, Escape closes and hands the keyboard back). It is also in the tray menu.
- **The save** is `%APPDATA%\com.doozer.desktop\save.json` (with `save.bak.json` beside it). That folder name is the app's identifier and is fixed for good. A development build (`tauri dev`) keeps a separate pet in the `dev` subfolder, and "Start with Windows" only works in a release build.
- Only one copy runs at a time; starting a second one does nothing.

Where things are, each with its own `README.md`:

| Folder | What |
|---|---|
| `app/src/core/` | The pet brain: every rule and number. No DOM. |
| `app/src/character/` | The 2D Doozer rig, and the 3D Doozer (`doozer3d.ts`). |
| `app/assets/doozer/` | The 3D model, and the Blender script that builds it. |
| `app/src/ui/` | The dark-glass kit: Card, Radial, settings panel, meters, emotes. |
| `app/src/host/` | The view host: one view at a time, the clock, the save, tuck-away, and the sounds. |
| `app/src/frames.ts` | The frame clock: how often everything that moves is drawn. |
| `app/src/views/pill/` | The Pill view. |
| `app/src/views/room/` | The Room view. |
| `app/src/views/island/` | The Island view. |
| `app/src/views/desktop/` | The Desktop view. |
| `app/src-tauri/` | The native shell: one transparent window, click-through by region, tray, save file. |

What was measured and what still needs a hand on the mouse: [docs/pill-checks.md](docs/pill-checks.md) for the app and the Pill, [docs/room-checks.md](docs/room-checks.md) for the Room, [docs/island-checks.md](docs/island-checks.md) for the 3D Doozer and the Island, [docs/desktop-checks.md](docs/desktop-checks.md) for the Desktop, [docs/polish-checks.md](docs/polish-checks.md) for the polish pass over all four (cost before and after, accessibility, sound), [docs/shell-spike.md](docs/shell-spike.md) for the shell.

## The mockups (Phase 1, reference only)

Run from the repository root; first time only: `npm install`.

| Do this | Command |
|---|---|
| Open the gallery in your browser | `npm run mockups` |
| Float a mockup on your real desktop | `npm run pet` (right-click Doozer to switch version or quit) |
| Start on a specific version | `npm run pet -- buddy` (`pocket`, `blob`, `buddy`, `room`, `pill`) |
