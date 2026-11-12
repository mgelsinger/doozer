# Doozer

A small creature that lives on your desktop: one pet with four homes (Pill, Room, Island, Desktop) and a focus timer in every one of them.

- **What gets built:** [DESIGN_SPEC.md](DESIGN_SPEC.md)
- **How and in what order, and where it stands:** [WORK_PLAN.md](WORK_PLAN.md)

## The app (`app/`)

A TypeScript/Vite page inside a Tauri 2 shell. Run everything from the `app` folder; first time only: `npm install`.

| Do this | Command |
|---|---|
| Run the app with live reload | `npm run tauri dev` |
| Build the app (no installer) | `npm run tauri build -- --no-bundle` → `src-tauri/target/release/doozer.exe` |
| Page-side tests | `npm test` |
| Native-side tests (window maths, hit regions, save file) | `cargo test` in `app/src-tauri` |
| Type-check | `npm run typecheck` |

Until the Pill view exists the app shows the **shell test page**: a blob standing in for Doozer and buttons that move the one window between its shapes. The tray icon has the same menu. What the shell does, how it was measured and what still needs a hand on the mouse is in [docs/shell-spike.md](docs/shell-spike.md).

## The mockups (Phase 1, reference only)

Run from the repository root; first time only: `npm install`.

| Do this | Command |
|---|---|
| Open the gallery in your browser | `npm run mockups` |
| Float a mockup on your real desktop | `npm run pet` (right-click Doozer to switch version or quit) |
| Start on a specific version | `npm run pet -- buddy` (`pocket`, `blob`, `buddy`, `room`, `pill`) |
