# Doozer

A small creature that lives on your desktop: one pet with four homes (Pill, Room, Island, Desktop) and a focus timer in every one of them.

- **What gets built:** [DESIGN_SPEC.md](DESIGN_SPEC.md)
- **How and in what order, and where it stands:** [WORK_PLAN.md](WORK_PLAN.md)

## The app (`app/`)

A TypeScript/Vite page inside a Tauri 2 shell. **Milestone 1 is built:** Doozer lives in a small pill docked to the top of the screen and in the tray. Click the pill for the Card: feed, fill the bowl, treats, play, wash, nap, the focus timer and its streak, settings. A view that is not built yet is shown as "coming soon".

**Milestone 2 is built:** the **Room**, a framed little room you can put anywhere on the screen. Pick it in the tray menu or in the Card's row of views, and everything carries over, a running focus session included. Click the bowl to fill it, the ball to toss it, the soap for a bath, the lamp or the bed for bedtime, the treat jar for a treat, the clock to start or stop a session; Doozer decides the rest. The sky in its window follows the real time of day. Drag the room by its title bar; the button in the title bar opens the Card.

Run everything from the `app` folder; first time only: `npm install`.

| Do this | Command |
|---|---|
| Run the app with live reload | `npm run tauri dev` |
| Build the app (no installer) | `npm run tauri build -- --no-bundle` → `src-tauri/target/release/doozer.exe` |
| Page-side tests | `npm test` |
| Native-side tests (window maths, hit regions, save file, start with Windows) | `cargo test` in `app/src-tauri` |
| Type-check | `npm run typecheck` |
| See the rig and the UI kit on one page | `npm run dev`, then `/viewer.html` |
| Scripted checks of the built app (a day's use, never stuck, the window) | `pwsh scripts/run-app-checks.ps1` (needs the build described at the top of that script) |
| The same for the Room (the furniture, an hour alone, switching views, never stuck) | `pwsh scripts/run-room-checks.ps1` (same build) |

Using it:

- **Quit** from the tray icon, from a right-click on the pill, or from the bottom of Settings. All three save first.
- **The save** is `%APPDATA%\com.doozer.desktop\save.json` (with `save.bak.json` beside it). That folder name is the app's identifier and is fixed for good. A development build (`tauri dev`) keeps a separate pet in the `dev` subfolder, and "Start with Windows" only works in a release build.
- Only one copy runs at a time; starting a second one does nothing.

Where things are, each with its own `README.md`:

| Folder | What |
|---|---|
| `app/src/core/` | The pet brain: every rule and number. No DOM. |
| `app/src/character/` | The 2D Doozer rig. |
| `app/src/ui/` | The dark-glass kit: Card, Radial, settings panel, meters, emotes. |
| `app/src/host/` | The view host: one view at a time, the clock, the save, tuck-away. |
| `app/src/views/pill/` | The Pill view. |
| `app/src/views/room/` | The Room view. |
| `app/src-tauri/` | The native shell: one transparent window, click-through by region, tray, save file. |

What was measured and what still needs a hand on the mouse: [docs/pill-checks.md](docs/pill-checks.md) for the app and the Pill, [docs/room-checks.md](docs/room-checks.md) for the Room, [docs/shell-spike.md](docs/shell-spike.md) for the shell.

## The mockups (Phase 1, reference only)

Run from the repository root; first time only: `npm install`.

| Do this | Command |
|---|---|
| Open the gallery in your browser | `npm run mockups` |
| Float a mockup on your real desktop | `npm run pet` (right-click Doozer to switch version or quit) |
| Start on a specific version | `npm run pet -- buddy` (`pocket`, `blob`, `buddy`, `room`, `pill`) |
