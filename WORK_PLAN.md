# Doozer — Work Plan & Handoff

> A tiny creature that lives on your desktop. You feed it, play with it, tuck it in, and it keeps you company while you work.

This file says **how and in what order** Doozer gets built. [DESIGN_SPEC.md](DESIGN_SPEC.md) says **what** gets built. A fresh session should be able to pick up from these two files with no other context.

**The product in one line:** one pet with four homes — Pill, Room, Island, Desktop — that you can swap between at any time with everything carrying over, and a focus timer in every one of them that earns Doozer treats.

---

## 0. Status at a glance

| Phase | What | Milestone | State | Effort (Fable 5.2) |
|---|---|---|---|---|
| 1 | Mockups: five versions, gallery, desktop harness | — | **Done** | — |
| 2 | Review and design spec | — | **Done — signed off 2026-11-11** | — |
| 3 | Shell spike: one transparent window that changes shape | M1 | **Done — Tauri stays.** `app/src-tauri/`, `app/src/shell.ts`; results in [docs/shell-spike.md](docs/shell-spike.md). Tested with injected input only: not yet tried with a real hand on the mouse (its section 6 lists what to try) | **xhigh** |
| 4 | Pet brain: needs, bowl, treats, focus, streaks, unlocks, save | M1 | **Done** — `app/src/core/`, 231 tests; tuning notes in [docs/brain-week-sim.md](docs/brain-week-sim.md) | high |
| 5 | 2D Doozer rig and the dark-glass UI kit | M1 | **Done** — `app/src/character/`, `app/src/ui/`; viewer at `/viewer.html` (`npm run dev`); 116 tests. Motion not yet watched by a person or seen inside the app window | **xhigh** |
| 6 | Pill view and app basics (tray, settings, view switching) | M1 | **Done — Milestone 1 is built.** `app/src/host/`, `app/src/views/pill/`, `app/src/main.ts`; 522 page tests and 46 native tests; checks and measurements in [docs/pill-checks.md](docs/pill-checks.md). Checked with scripted input in the real window, not yet by a person at the mouse (its last section lists what to try) | high |
| 7 | Room view | M2 | **Done — Milestone 2 is built.** `app/src/views/room/`; 109 new page tests and 3 native ones; checks and measurements in [docs/room-checks.md](docs/room-checks.md). Checked with scripted input in the real window, not yet by a person at the mouse (its section 7 lists what to try) | high |
| 8 | 3D Doozer and the Island view | M3 | **Done — Milestone 3 is built.** `app/assets/doozer/` (the model and the Blender script that builds it), `app/src/character/doozer3d.ts`, `app/src/views/island/`; 222 new page tests and 2 native ones; checks and measurements in [docs/island-checks.md](docs/island-checks.md). Idle cost is inside the budget. Leaving the Island leaks nothing that grows, but does not hand back all of its memory (section 4 there). Checked with scripted input in the real window and judged from still pictures, not yet by a person at the mouse (its section 10 lists what to try; whether it beats the mockup for charm is the owner's call) | **xhigh** |
| 9 | Desktop view (the calm roamer) | M4 | **Built and checked — Milestone 4, with two things waiting for the owner.** `app/src/views/desktop/`; 176 page tests; checks and measurements in [docs/desktop-checks.md](docs/desktop-checks.md). Checked with scripted input in the real window, a three-hour soak included; not yet by a person at the mouse. **Not done, and only the owner can:** trying Calm and Lively to choose the default, and agreeing that Doozer no longer gets stuck (section 9 of that document says what to try) | **xhigh** |
| 10 | Sound, polish, accessibility, performance | M5 | **In progress** (started 2026-11-14). Scope grew when the view phases finished: see section 13 | **xhigh** (was high: the performance work now reaches into the shared rig) |
| 11 | Packaging and release | M5 | Not started | high |

**How the effort column was chosen.** `high` is for phases that are well specified and mostly construction. `xhigh` ("extra") is for phases where the platform is fiddly and under-documented (transparent click-through windows, DPI, multi-monitor) or where the result is judged by taste (does it feel alive, is it cute, is the movement calm enough). Running everything on `xhigh` is fine; it only costs more.

**If you are a fresh session:** read the spec, then this file's section 4, then go to the first phase above that is not done. Before starting a phase, check the spec's section 12 for questions the owner has answered since.

---

## 1. Principles

1. **Cute first.** Every state — hungry, sleepy, grubby — should still be endearing.
2. **Small and polite.** Never steals keyboard focus, never pops up text uninvited, silent unless asked.
3. **Alive when you're not looking.** Time passes while the app is closed; the bowl feeds Doozer while you are away.
4. **Guilt-free.** Doozer never dies. Stopping a focus session early costs nothing.
5. **One pet.** Rules live in the brain. Views only draw and forward clicks. If a rule appears in a view, it is a bug.
6. **Every milestone ships.** After M1 there is always a finished, usable app.

---

## 2. Milestones

| Milestone | You get | Phases |
|---|---|---|
| **M1 — Pill** | A real tray app: Doozer in the pill, the Card, the whole focus loop, settings | 3, 4, 5, 6 |
| **M2 — Room** | A second home, and switching between views | 7 |
| **M3 — Island** | The 3D home | 8 |
| **M4 — Desktop** | The roamer | 9 |
| **M5 — Release** | Sound, polish, installer | 10, 11 |

```
3 Shell spike ─┐
4 Pet brain ───┼─► 6 Pill + app basics ─► M1 ─┬─► 7 Room ─────► M2
5 Rig + UI kit ┘                              ├─► 8 3D + Island ► M3 ─► 10 Polish ─► 11 Ship
                                              └─► 9 Desktop ───► M4
```

**What can run in parallel**

- **3, 4 and 5** touch different folders and can run as three sessions at once, *after* the project scaffold exists (Phase 3, task 1 — a short job; commit it first).
- **7, 8 and 9** each own one view folder and can run at once after M1.
- Never put two sessions in the same folder at the same time.

---

## 3. Stack

**Web stack in a small native shell.** Three of the four views and all of the interface are HTML/SVG, and the mockups are already written that way. A game engine would mean rebuilding them.

| Layer | Choice | Notes |
|---|---|---|
| Language / build | TypeScript, Vite, Vitest | One package, not a monorepo |
| 2D | SVG + CSS + the Web Animations API | As in the mockups |
| 3D | three.js, **Island view only**, loaded on demand | Released completely when the Island is left |
| Shell | **Tauri 2** (Rust + WebView2) | Small footprint; Rust toolchain is installed |
| Shell fallback | Electron | Already proven by the mockup harness in [shell/](shell/). Not needed: Tauri passed Phase 3 ([docs/shell-spike.md](docs/shell-spike.md)). Kept in reserve; it costs about twice the memory. |
| Not used | Godot, Unity | Considered in Phase 1; wrong fit once three of four views are 2D UI |

### Target layout

```
app/
  src-tauri/              native shell (Rust)
  src/
    core/                 the pet brain — no DOM, no view knowledge
    character/            2D rig; later the 3D model loader
    ui/                   dark-glass kit: Card, Radial, meters, emotes, settings
    views/
      pill/  room/  island/  desktop/
    host/                 the view host: one view at a time, the clock, the save, tuck-away
    shell.ts              bridge to the native side (window mode, hit regions, save, tray)
    main.ts               start-up: read the save, wake the brain, start the host
    spike/                scripted test runs (loaded only in a test build)
  tests/
  assets/
mockups/  shell/  tools/  docs/      Phase 1 reference material; do not build on these
```

### The single-window rule

The app is **one transparent window showing one page**. Changing view means: unmount the old view module, ask the shell to change the window's size / position / click-through mode, mount the new one. There is exactly one brain in memory, so nothing ever needs syncing.

### The view contract

```ts
interface View {
  id: 'pill' | 'room' | 'island' | 'desktop';
  window(request: { settings; position }): WindowMode;   // asked again when its dock or size changes
  mount(root: HTMLElement, ctx: { brain; shell; host; info }): void | Promise<void>;
  unmount(): void;         // must release everything: timers, listeners, GPU memory
  hitRegions(): Region[];  // where the mouse should be caught; everything else is click-through
  // optional: leave() / enter() (Doozer pops out and in), setAwake(false) when tucked away,
  // windowChanged(info), openSettings(), windowSettings
}
```

The full contract, with what the host does for a view and the rules a view must keep, is [app/src/host/view.ts](app/src/host/view.ts) and [app/src/host/README.md](app/src/host/README.md). (As built in Phase 6: `window` became a function because the Pill's window depends on its dock setting, and the kit is imported directly rather than passed in.)

---

## 4. Phase 1 — Mockups (done)

Five interactive versions on one shared brain, a comparison gallery, and an Electron harness that floats any of them on the real desktop. The owner reviewed them; the result is the spec.

| What | Command |
|---|---|
| Gallery in the browser | `npm run mockups` (http://127.0.0.1:4517) |
| A mockup on the real desktop | `npm run pet` — right-click Doozer to switch or quit |
| A specific one | `npm run pet -- room` (`pocket`, `blob`, `buddy`, `room`, `pill`) |

**Use the mockups as reference, not as a base.** They are one HTML file each with no build step and no tests. Worth lifting from:

| File | What to take |
|---|---|
| [mockups/shared/sim.js](mockups/shared/sim.js) | The rules and the tuning numbers |
| [mockups/shared/doozer-svg.js](mockups/shared/doozer-svg.js) | The 2D rig: parts, expressions, poses, palettes |
| [mockups/shared/art.js](mockups/shared/art.js) | Palettes, icons, need colours |
| [mockups/v5-pill/index.html](mockups/v5-pill/index.html) | The Card layout and dark-glass styling |
| [mockups/v4-room/index.html](mockups/v4-room/index.html) | The room scene, the sky, Doozer's self-directed behaviour |
| [mockups/v2-blob/index.html](mockups/v2-blob/index.html) | The island, the squash-and-stretch spring, night, 3D snacks |
| [mockups/v3-buddy/index.html](mockups/v3-buddy/index.html) | The Radial, carrying, peekaboo — **but not its pacing** |
| [shell/main.mjs](shell/main.mjs) | A working transparent click-through window in Electron |
| [docs/screenshots/](docs/screenshots/) | Reference images of each version in the shell |

**Verified in Phase 1:** every action in every mockup (scripted clicks, no console errors); each renders transparently in the harness; the click-through bridge passes its self-test in all five.
**Never hand-tested:** a real mouse on the real desktop (dragging windows, clicking through to apps beneath), multi-monitor, mixed DPI, fullscreen apps, and what the sounds sound like.

---

## 5. Phase 2 — Review and design spec (done)

The owner's picks are recorded and resolved in [DESIGN_SPEC.md](DESIGN_SPEC.md), which the owner **signed off as written on 2026-11-11**, with no vetoes of the calls in its section 2.1.

The owner has since answered the one open design question: the annoying thing about the Desk Buddy was that it **"would get stuck randomly"** — a defect, not its pace. Spec section 6.4 now carries "Never stuck" requirements, and the lesson applies to every view and to the shell (see the pitfalls in Phase 3).

**For parallel work:** [docs/brain-contract.md](docs/brain-contract.md) fixes the interface between the pet brain (Phase 4) and everything that draws it (Phases 5 onward), so those phases can be built at the same time without drifting apart.

---

## 6. Phase 3 — Shell spike  ·  effort: xhigh  ·  M1

**Goal:** prove the one hard platform idea — a single transparent window that can be a pill, a small framed room, a frameless island, or a full-screen click-through overlay, and can change between them cleanly.

**Inputs:** spec sections 5 and 10; [shell/main.mjs](shell/main.mjs) as a working Electron reference.

**Tasks**

1. **Scaffold first, and commit it** so Phases 4 and 5 can start: `git init`, the `app/` layout from section 3, Vite + TypeScript + Vitest, Tauri 2, a placeholder page. Check Tauri's current documentation rather than relying on memory for API names.
2. One window: frameless, transparent, always-on-top, shown without taking focus, not in Alt-Tab.
3. `setWindowMode(mode)`: change bounds and behaviour between four shapes — small docked (pill), small free-floating (room, island), work-area overlay (desktop). Must not flash or show a black frame. If resizing flickers, hide → resize → show.
4. **Click-through by region.** The page reports hit regions; the shell lets the mouse through everywhere else. Tauri's per-window "ignore cursor events" is all-or-nothing and does not forward mouse-moves, so the native side has to watch the cursor position itself and flip the switch when the cursor enters or leaves a region.
5. Dragging the window by a page-defined handle, implemented manually (do not depend on `-webkit-app-region` for odd shapes).
6. Save API: `load()` and `save(json)` to a file in the user's app-data folder, written atomically, keeping the previous good copy.
7. Tray icon with a menu (the four views, Settings, Quit). Quit actually quits.
8. A test page with four buttons that cycles the window through the four modes with a coloured blob as a stand-in for Doozer.
9. Measure and write down: idle memory, idle CPU, time to switch modes.
10. Check by hand and record: mixed-DPI dual monitors; taskbar on another edge and auto-hidden; a fullscreen app in front; sleep/resume; `Win+D`.

**Deliverables:** the `app/` skeleton; `docs/shell-spike.md` with the measurements, the manual-check results, and the decision (Tauri, or fall back to Electron and why).

**Done when:** the test page can be cycled through all four modes ten times with no flicker and no stuck click-through state; clicks beside the blob reach the app underneath in every mode; idle cost meets the budget (under 150 MB, under 1% CPU); the save file survives a kill mid-write.

**Pitfalls:** WebView2 needs both the window and the webview background transparent; other topmost windows can still cover an always-on-top one; an overlay that forgets to return to click-through makes the whole screen feel dead — add a watchdog that restores it.

**A bug the mockup harness actually had — do not repeat it:** the click-through state must **never change while a mouse button is down**. During a fast drag the dragged thing lags a frame behind the cursor, the hit-test misses, the window flips to pass-through, the mouse-up is swallowed, and the drag never ends. This is what made Doozer "get stuck" for the owner. `shell/main.mjs --dragtest` reproduces it with injected input and is the model for a test here. Test runs should also keep the real mouse out (the harness does this with `injectedInputOnly`), or a person using the machine will corrupt the results.

**Result (2026-11-11): done, and Tauri stays.** The full write-up is [docs/shell-spike.md](docs/shell-spike.md). In short: 220 mode switches filmed at 120 frames a second with nothing wrong reaching the screen; 440 of 440 click-through checks correct, with Windows' own hit-test agreeing; the click-through state never changes while a button is held, and the shell tells the page when a press has ended (`pointer-released`), so a drag in the page ends even if its mouse-up never arrives; the save survived 242 kills mid-write; idle in the pill is 73 MB and under 1 % of one core; a switch takes 33 ms.

Task 10, the checks by hand, **was not done**: the owner was using the machine and then away, so every test used injected input and kept the real mouse out. Detecting a fullscreen app in front was confirmed against a real game. Everything else that needs a person (real clicks, the tray icon, multi-monitor, taskbar positions, sleep/resume, Win+D) is listed with what to try in that document's section 6.

One finding matters for the next phase: an animation that never stops costs 13–26 % of a processor core. Idle Doozer must not animate continuously.

---

## 7. Phase 4 — Pet brain  ·  effort: high  ·  M1  ·  parallel with 3 and 5

**Goal:** the whole of spec sections 3 and 4 as a tested TypeScript module with no DOM in it.

**Inputs:** spec sections 3, 4, 5.1; **[docs/brain-contract.md](docs/brain-contract.md) — implement exactly this interface**; [mockups/shared/sim.js](mockups/shared/sim.js) for the existing rules and numbers.

**Tasks**

1. Port the sim to `app/src/core/` as a pure module: state in, events out, injectable clock and random source.
2. Remove messes. Keep bond as a hidden value.
3. Add the **bowl** (3 servings, auto-eat below 70, active during offline catch-up) and the **treat jar** (cap 20, random unlocked snack, favourite snack chosen at hatching).
4. Add **focus sessions**: 15/25/50, start/pause/resume/stop, defined by timestamps; rewards table; first-of-day bonus; streak with best-ever; lifetime session count; the unlock table as data.
5. A `quiet` flag the views can read: true during a focus session.
6. Settings store (spec section 9) with defaults.
7. Versioned save format with migrations; tolerate a corrupt or missing file.
8. Offline catch-up that is right across long gaps, clock changes and DST.
9. Tests: every action and every refusal; thresholds; auto-sleep and wake; bowl behaviour awake, asleep and offline; a session that spans a restart; streak across midnight; unlock thresholds; catch-up in one big step ≈ many small steps.
10. A headless script that simulates a week with N visits a day and prints the curves, and use it to tune: three to five short visits should keep Doozer happy; a missed day should leave it sulky but recoverable in one visit.

**Done when:** tests pass; the week simulation looks sensible and its output is saved in `docs/`; nothing in `core/` imports from outside `core/`.

---

## 8. Phase 5 — 2D rig and UI kit  ·  effort: xhigh  ·  M1  ·  parallel with 3 and 4

**Goal:** the Doozer that three of the four views use, and the interface pieces every view shares.

**Inputs:** spec sections 5.3, 7, 8; **[docs/brain-contract.md](docs/brain-contract.md) — the kit is written against this interface, with a fake brain until Phase 4 lands**; [doozer-svg.js](mockups/shared/doozer-svg.js); the Card in [v5-pill](mockups/v5-pill/index.html); the Radial in [v3-buddy](mockups/v3-buddy/index.html).

**Tasks**

1. **Rig** in `app/src/character/`: layered parts with proper pivots; both line styles (bold outline, soft); five palettes; the full expression list including *focus* (glasses); every animation in spec section 7 except the 3D-only ones. Hats as an attachment point.
2. **Walk cycle** per spec 6.4 — a gentle waddle that still has character. (An earlier draft of this plan said the owner disliked the walk; they did not. Their complaint was Doozer getting stuck.)
3. **UI kit** in `app/src/ui/`: Card, Radial (six buttons, need rings), meters, emotes, tooltips, settings panel, the view-switch row. Dark glass per spec section 8. Keyboard reachable; honours reduce-motion.
4. The kit talks to the brain through a small interface, so it can be developed against a fake brain before Phase 4 lands.
5. **A viewer page** (dev only) that shows every expression × both line styles × every palette, plays every animation on a loop, and shows the Card and Radial in every state (asleep, focusing, no treats, bowl full).

**Done when:** the viewer page exists and everything on it reads clearly at 62 px (pill size) and at 190 px; nothing in the kit hard-codes a view.

---

## 9. Phase 6 — Pill view and app basics  ·  effort: high  ·  completes M1

**Goal:** the first shippable Doozer.

**Inputs:** Phases 3, 4, 5; spec sections 4, 5, 6.1, 9; **[docs/shell-spike.md](docs/shell-spike.md) sections 4 and 8** — the bridge in `app/src/shell.ts`, the three-step view switch every host must follow, and the notes left for this phase. `app/src/main.ts` currently mounts the shell test page (`app/src/spike/`), which is a working example of a host; replace it.

**Tasks**

1. The **view host** (`main.ts`; built in `app/src/host/`): mounts one view, handles switching with the pop-out / pop-in transition, remembers the last view and each view's window position.
2. The **Pill view**: pill face (name, status line, ring), unfolding Card, hit regions for both states, dock position setting.
3. Wire the Card to the real brain: actions, bowl, treats, focus, streak, view row (other views shown as "coming soon" until built).
4. Settings panel, tray menu, right-click native menu, start-with-Windows, always-on-top, tuck-away during fullscreen apps.
5. First run: Doozer hatches, picks its favourite snack; the sound question is asked once.
6. Focus manners per spec 4.5, including never taking keyboard focus when a session ends.
7. Render on demand: when nothing is animating, nothing is drawing.

**Done when:** the app installs nowhere yet but runs from the repo as a tray app; a full day's use — feed, fill the bowl, three focus sessions, quit, reopen the next morning — behaves as the spec says; idle cost is within budget.

**Result (2026-11-13): done. Milestone 1 is built.** The write-up, with every measurement and what still needs a person, is [docs/pill-checks.md](docs/pill-checks.md). In short:

- `npm run tauri dev` in `app/` runs Doozer as a tray app with the pill docked top-centre. Click the pill and the Card unfolds from it; the settings panel takes the Card's place; Room, Island and Desktop are "coming soon" in the Card and greyed out in the tray menu.
- **A day's use, scripted in the real window** (first run, then "the next morning" with the clock moved 14 hours on): Doozer hatches and shows its favourite snack, the sound question is asked once, feeding and the bowl work, three sessions pay 3 + 2 + 2 treats and unlock the cookie and the donut, quitting from the tray saves first, and the next morning the same Doozer is back having eaten from the bowl overnight, the streak goes to 2 and the first session pays its bonus.
- **Idle in the pill, release build: 94–97 MB and 0.3–1.0 % of one core** (budget: 150 MB and 1 %). With a focus session counting down: 0.4–1.0 %. Getting there took a hard rule: at rest the pill does not animate at all, apart from a two-redraw blink every few seconds (see "Render on demand" in `app/src/views/pill/README.md`).
- **Never stuck**, with injected input: 200 rapid presses across every Card button; the Card closed mid-scene 30 times (six scenes, five moments each); a press whose mouse-up never arrives (ended 5 ms after the button came up, told once by the shell); a session ending with the Card closed (Doozer celebrates, comes to rest, never has the keyboard). All pass.
- Not done here, on purpose: an installer and code signing (Phase 11), a content security policy (Phase 11), sound beyond the one chime (Phase 10), a keyboard way into the Card (Phase 10).

**The app identifier is settled (2026-11-13): `com.doozer.desktop` stays.** It decides where the save lives (`%APPDATA%\com.doozer.desktop\`), so it was the one thing to fix before anyone had a pet worth keeping. The owner left the name to us; keeping the one every build has used so far means nothing moves. Do not change it: a test in `app/src-tauri/src/lib.rs` fails if it changes in either place it is written.

---

## 10. Phase 7 — Room view  ·  effort: high  ·  M2

**Goal:** spec section 6.2.

**Tasks:** the scene (soft storybook SVG); the real-time sky and light; every object in the furniture table, including the new treat jar and clock; Doozer's self-directed behaviour (wander, look out of the window, eat from the bowl when hungry, go to bed when sleepy, read during a focus session); the meter strip; the title-bar button for the Card; three window sizes.

**Done when:** every row of the furniture table works; leaving the Room open for an hour with a full bowl shows Doozer looking after itself; switching Pill ↔ Room mid-session loses nothing.

**Result (2026-11-13): done. Milestone 2 is built.** The write-up, with every measurement and what still needs a person, is [docs/room-checks.md](docs/room-checks.md). In short:

- Pick **Room** in the tray menu or on the Card and Doozer moves into a framed little room: a window with the real-time sky, two shelves, a lamp, a bed, a bowl, a ball, a rug. Click the furniture and Doozer decides the rest; a strip of meters under the scene; a button in the title bar opens the Card; the title bar moves the window; three sizes. The Card and the tray no longer say "coming soon" for it.
- **Every row of the furniture table works against the real brain**, in unit tests and pressed in the real window: bowl, ball (or the yarn ball), soap (and the duck), lamp, bed, treat jar, clock, and each of their refusals.
- **An hour with a full bowl, on a fast clock rather than a real wait:** the whole hour (and three hours) on a fake clock in the tests, and an hour of pet time in a minute in the real window. Doozer glances about, strolls, looks out of the window, eats when hungry, puts itself to bed when worn out, wakes rested, and is never away from rest for longer than one scene may last.
- **Pill to Room and back in the middle of a session loses nothing:** through the real host in the tests, and in the real window by the tray menu and the Card's view row. The app reopens in the Room, where the room was left.
- **Never stuck**, on a fake clock and with injected input in the real window: furniture clicked mid-walk, every scene interrupted at several moments (by another scene, by bed, by the Card, by tuck-away, by a window change), the view switched mid-scene, and a window drag whose mouse-up never arrives (ended 5 ms after the button came up, on the shell's `drag-end`).
- **Idle in the Room, release build: 113–126 MB; 0.3–1.0 % of one core at rest; 1.05 % averaged over ten minutes** that included two of Doozer's own outings. Against the budget (150 MB and 1 %): memory inside; CPU inside at rest and a hair over the line on that ten-minute average. What costs is Doozer moving: a second of animation is about a third of a core-second here.
- Not done here, on purpose: sound for the room (Phase 10), a keyboard way to the furniture (Phase 10), room decoration (not in v1).

---

## 11. Phase 8 — 3D Doozer and the Island view  ·  effort: xhigh  ·  M3

**Goal:** spec section 6.3, with a properly modelled Doozer.

**Tasks**

1. **Model** in Blender 5.2 (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`), scripted with `bpy` so it is reproducible: smooth low-poly body; shape keys for the expression list; a small armature (root, body, ears, tuft, arms, feet); palette as material parameters. Export glTF to `app/assets/`.
2. Match the 2D rig's proportions and face — put them side by side in the viewer page.
3. **Island view**: the island and its dressing; the squash-and-stretch spring (keep it procedural, as in the mockup); stroke and poke; the Radial; 3D snacks, a different one each time; the ball; night when asleep; the focus chip.
4. three.js is imported dynamically on mount and everything is disposed on unmount. Verify GPU memory returns to baseline after leaving the Island.
5. Render on demand when Doozer is asleep or idle; cap the frame rate.

**Done when:** the Island matches or beats the mockup for charm; ten switches into and out of it leak nothing; idle cost in the Island is measured and written down.

**Result (2026-11-13): done. Milestone 3 is built.** The write-up, with every measurement, sixteen pictures from the real window and what still needs a person, is [docs/island-checks.md](docs/island-checks.md). In short:

- Pick **Island** in the tray menu or on the Card and Doozer moves onto a small floating island in a frameless, transparent window: a soft 3D Doozer you can stroke (a pet) and poke (it squashes and springs back, and the Radial opens). Snacks drop out of the sky, a different one each time; the ball is served and chased and stays lying about; a rain cloud gives it a bath; night falls when it sleeps; glasses on and a chip counting down during a focus session. The Card and the tray no longer say "coming soon" for it.
- **The model** is built by one script in Blender, run without a window (`app/assets/doozer/build_doozer.py` → `doozer.glb`, 631 KB, 13,700 triangles, 10 bones). Its outline, its pivots and its palettes are the 2D rig's own numbers, and its sixteen faces are shape keys chosen by the same table of expressions the 2D rig uses. The two are side by side in the viewer (`/viewer.html?only=3d`).
- **Charm:** in my judgement it beats the mockup, clearly where something happens and about level at rest. That is judged from stills of the real window; nobody has watched it move. **The owner's call.**
- **three.js is loaded only when the Island is opened** (a test walks everything the app loads at start-up) **and given back when it is left**: the engine lives in a hidden frame that is removed on leaving, and the browser confirms it is collected, every time.
- **Ten switches in and out (and twenty-two): nothing grows without limit, but memory does not return to baseline.** Before any visit the Pill reads about 109 MB; after one visit 119 to 125; after a dozen or more it levels off around 140. About 11 MB of that is the browser's own (a trip to the Room leaves the same); about 20 MB is the Island's, in the page's own process, and I could not get it back. Section 4 of the write-up has the tables, two control runs and what was tried.
- **Idle in the Island, release build, against 150 MB and 1 % of one core:** awake 122–126 MB and 0.53 % of one core averaged over ten minutes (0.60 % in a second run); asleep 126–127 MB and 0.71 % (0.62 %); during a focus session 123–124 MB and about 1 %, at the line and not under it, because the countdown chip repaints once a second as it does in every view. As first built it was 1.1 to 4.6 % awake; the pace when nobody is looking was then set by measurement (decision 9 in the log).
- **Never stuck**, on a fake clock and with injected input in the real window: 150 rapid pokes; a stroke whose mouse-up never arrives (ended 9 ms after the button came up, on the shell's `pointer-released`); every scene cut at several moments; the view switched mid-scene; the WebGL context lost and restored, and lost for good (the renderer is rebuilt on a new canvas).
- **Pill to Island and back in the middle of a session loses nothing**, through the real host in the tests and in the real window.
- **A crash in the shell was found and fixed on the way:** a round hit region could abort the whole app while the cursor was near it (`hit.rs`). It concerned every view.
- Not done here, on purpose: sound for the island (Phase 10), a keyboard way to the Radial without a click (Phase 10), a second look at what the page's process keeps after the Island (the write-up says what to try).

---

## 12. Phase 9 — Desktop view  ·  effort: xhigh  ·  M4

**Goal:** spec section 6.4, and above all its **"Never stuck"** list — the owner's one complaint about the mockup was that Doozer "would get stuck randomly".

**Tasks:** the work-area overlay mode; Doozer on the taskbar edge with correct hit regions as it moves; the behaviour state machine with a time limit on every state and a watchdog back to idle; the Still / Calm / Lively levels (Lively close to the mockup, including running after the ball); carry and set-down with the gentle float, ending on mouse-up, lost capture, lost focus, or movement with no button held; peekaboo; ball play; the Radial; focus behaviour (sits still, time on hover); correct placement with the taskbar on any edge or auto-hidden; remembering its spot per monitor; injected-input tests for the stuck cases, modelled on `shell/main.mjs --dragtest`.

**Done when:** the stuck-case tests pass, including a drag whose mouse-up never arrives and a scene interrupted at every step; a soak run of several hours with random injected actions ends with Doozer idle on the taskbar; the overlay never eats a click meant for another app; the owner has tried Calm and Lively and chosen the default; the owner agrees Doozer no longer gets stuck.

**Result (2026-11-14): built and checked; the two things in "done when" that are the owner's are still open.** The write-up, with every measurement and what still needs a person, is [docs/desktop-checks.md](docs/desktop-checks.md); how the view is built is in `app/src/views/desktop/README.md`. In short:

- Switch to the Desktop from the Card, the tray menu or a right-click. Doozer stands on the top edge of the taskbar, strolls a little, peeks in from the edge of the screen, can be carried and put down anywhere (it floats down and stays near that spot, remembered per monitor), and sits still with its glasses on during a session. *Desktop activity* in Settings is Still, Calm (the default for now) or Lively.
- **Never stuck.** On a fake clock, 16 scenes cut at every step of them in 8 ways: 2,920 interruptions, every one ending idle on the taskbar line, the watchdog never needed. In the real window with injected input: the mockup's drag test, a mouse-up that never arrives (the carry ends 7 to 17 ms after the button comes up), 300 scene interruptions with real view switches and real tuck-away, rapid clicks. All pass.
- **The soak:** three hours, 5,090 random injected actions, cloaked and in the background. 128 hands-off checks all found Doozer at rest; the watchdog rescued nothing; no scene was ended by its time limit; at the end Doozer was idle on the taskbar line.
- **Click-through:** 709 probe points across the work area in 13 states, none wrong, and nowhere did the window catch a click meant for another application.
- **Idle cost, release build:** memory 123–143 MB at every pace (budget 150). CPU as a share of one core: Still 0.4–1.1 %; Calm under 1 % between strolls and 3.6 % averaged over twelve minutes; Lively about 23 %, because it is walking most of the time. Walking costs a third to a half of a core while it lasts, as any animation does in this window.
- **Switching to the Pill and back in the middle of a focus session loses nothing.**
- **Still open, and the owner's:** which pace is the default (spec section 12, item 3), and whether Doozer still ever gets stuck. Section 9 of the write-up says exactly what to try for each.

---

## 13. Phase 10 — Sound, polish, accessibility, performance  ·  effort: xhigh  ·  M5

**Rated xhigh, not high as first planned (changed 2026-11-14).** When this plan was written, Phase 10 was a tidy-up. The view phases then each measured the same thing and left it here: animation is expensive in this window, and the fix they point to is a frame-rate cap in the rig that every view shares. A change to shared code that every view's never-stuck checks stand on, judged partly by eye (does the capped motion still read as smooth), is the kind of work the `xhigh` rating is for.

**Goal:** all four views inside the budget (under 150 MB, under 1 % of one core when idle) with Doozer as lively as that allows; then accessibility, timing and sound.

**Inputs:** spec sections 5 to 9; the four view write-ups, above all their idle-cost sections and what each left for this phase ([docs/pill-checks.md](docs/pill-checks.md) 3, [docs/room-checks.md](docs/room-checks.md) 6, [docs/island-checks.md](docs/island-checks.md) 4 and 5, [docs/desktop-checks.md](docs/desktop-checks.md) 6); the READMEs under `app/src/`.

**What the view phases found and left here** (the added scope):

1. **Animation is expensive.** A second of anything moving costs a third to a half of one core. The Room averages 1.05 % over ten minutes; the Desktop view on Calm 3.6 % over twelve, on Lively about 23 %. The view sessions' diagnosis: everything is drawn at the display's 120 Hz. The Room and the Island were made quieter when nobody is watching in order to fit.
2. **The focus countdown repaints once a second in every view**, which puts a focus session at about 1 %.
3. **After the Island has been visited the page's process keeps about 20 MB** that never comes back.
4. **The Card cannot be reached by keyboard in the Pill**, because the window takes keyboard focus only while settings is open.
5. **Two tests are fragile under load:** the native `save::tests::kill_mid_write_small_payload` failed once while the disk was busy, and a few Pill and Desktop page tests have hit the 5-second timeout on a loaded machine.

**Tasks, in order of importance**

1. **Performance.** Confirm by measurement why animation costs what it does, then bring it down: a frame-rate cap for the 2D rig and for the Island, less frequent hit-region reports while walking, a focus countdown that does not repaint every second when nobody is looking, and whatever else the measurements point to. Find and return the Island's 20 MB, or show with evidence that it cannot be returned. With drawing cheaper, restore as much life to Doozer alone in the Room and on the Island as the budget allows.
2. **The two fragile tests**, fixed without weakening what they prove.
3. **A keyboard way into the Card from the Pill** that does not take focus unasked.
4. **Accessibility:** reduce-motion mode checked in every view; need indicators that do not depend on colour; a scalable interface.
5. **A timing and easing pass** on every scene in every view, judged from frame captures.
6. **Sound:** a small coherent set to replace the single placeholder chime, off by default, synthesised in code or rendered by a script kept in the repo. No downloaded sound files.

**Hard requirement, as everywhere:** never stuck. Every temporary state keeps its time limit and its way back to rest, and each view's never-stuck checks pass again after the changes.

**Done when**

- Measured on a release build and written down, before and after: every view at rest under 1 % of one core and 150 MB; a focus session under 1 % in every view; the Room's ten-minute average and the Desktop view's Calm twelve-minute average under 1 %; the cost of a second of walking at least halved; Lively's average measured. Where a target cannot be met, the numbers and what was tried.
- Motion still reads as smooth at the capped rate, shown with frame captures (the owner judges this by eye).
- Every view's never-stuck checks and click-through probes pass on the final build, and the Desktop view's soak is rerun for at least an hour.
- `npm test`, `npm run typecheck` and `cargo test` pass three times in a row, one of them while the machine is busy.
- A write-up `docs/polish-checks.md` in the manner of the others; this section, the status row and the log updated.

---

## 14. Phase 11 — Packaging and release  ·  effort: high  ·  M5

Installer through the shell's bundler; app icon; decisions on code signing and auto-update (depends on whether this is shared — spec section 12, item 5); clean uninstall with a choice about keeping the save; a short user-facing README; version 1.0 tag.

---

## 15. Risks

| Risk | Likelihood | What we do about it |
|---|---|---|
| Four views is three to four times the work of one | Certain | Milestones: every one ships. It is fine to stop at M2 or M3. |
| One window changing shape flickers or loses click-through | Medium | Phase 3 exists to find out first. Electron fallback is already proven. |
| The roamer is annoying again | Medium | Built last, with a *Still* setting, and with the owner's specific complaint in hand. |
| Doozer looks like two different creatures in 2D and 3D | Medium | One design, shared proportions, side-by-side check in the viewer page (Phase 8, task 2). |
| Focus loop turns the pet into a nagging tool | Medium | No penalties, no pop-ups, quiet during sessions, meals always free. |
| Idle resource use creeps up | Medium | Render on demand; 3D only when visible; measured at the end of every phase. |
| Scope creep: outfits, decoration, minigames | High | The "Not in v1" list in the spec is the fence. New ideas go there. |

---

## 16. Environment (this machine, checked 2026-11-11)

| Tool | Where |
|---|---|
| Node 22 / npm 12 | on PATH |
| Rust (cargo, rustc) | on PATH (`~\.cargo\bin`) |
| Python 3.11 | on PATH |
| Git | on PATH; the project folder is a git repository (since Phase 3) |
| Blender 5.2 | `C:\Program Files\Blender Foundation\Blender 5.2\` (not on PATH) |
| Unity 6000.4.9f1 | via Unity Hub (not used) |
| Godot 4.7.1 | zip in Downloads, not extracted (not used) |
| Display | 4K at 150% scaling, 120 Hz (work area 2560 × 1392 in CSS pixels) |

---

## 17. Log

- **2026-11-11** — Project started. Plan written. Phase 1 built and verified: shared brain, five mockups, gallery, Electron harness.
- **2026-11-11** — Owner reviewed the mockups. V1 cut. Direction set: one pet, four swappable homes, focus timer as a core system. `DESIGN_SPEC.md` written; plan rebuilt around milestones M1–M5.
- **2026-11-11** — Owner signed off the spec as written. Phase 3 started in its own session. `docs/brain-contract.md` written so Phases 4 and 5 can run alongside it.
- **2026-11-11** — Owner: the Desk Buddy annoyance was that it "would get stuck randomly". Two causes found and fixed in the mockup (`mockups/v3-buddy`, `mockups/shared/env.js`): a scene left open when its walk was interrupted, and the shell flipping to click-through mid-drag. Confirmed with the new `shell/main.mjs --dragtest`: the old code goes pass-through while Doozer is carried, the fixed code does not, and Doozer recovers even when the mouse-up is lost. Spec 6.4 and Phases 3, 5 and 9 updated.
- **2026-11-11** — Phase 4 done: the pet brain is in `app/src/core/` behind `docs/brain-contract.md` (one addition: `BrainOptions.debug`; see its change log and the new "How the real brain behaves" section). 231 tests in `app/tests/core/`. Drain rates were slowed from the spec's first guesses to tummy 14, fun 6, energy 8, clean 4.5 per hour so that three to five visits a day keep Doozer happy; the week simulation and the reasoning are in `docs/brain-week-sim.md`. DESIGN_SPEC.md 3.1 was updated to the tuned rates afterwards, at the owner's request (spec section 13).
- **2026-11-11** — Phase 5 done: the 2D rig (`app/src/character/`: both line styles from one set of parts, five palettes, sixteen expressions including *focus*, nightcap and bow on a hat attachment point, every animation in spec section 7, a calm waddle plus a livelier trot) and the dark-glass kit (`app/src/ui/`: Card, Radial, meters, emotes, tooltips, settings panel, focus chip), written against `docs/brain-contract.md` with a fake brain in `app/src/ui/dev/` and also tested against the real one. "Never stuck" is built in rather than patched on: what is drawn is a function of attributes, everything temporary is ended by a timer (never by an animation event or frame), one scene at a time, menus close when Doozer does anything; 116 tests on a fake clock cover it and the viewer has a bench for doing the same by hand. Checked by eye in a browser at 62, 112 and 190 px, both styles, all palettes; **not** checked: the motion in real time by a person (judged from frozen frames, since the browser pane drew frames only some of the time), anything inside the Tauri window, a screen reader. Two things differ from the mockup on purpose: the tuft is drawn in front of the head so a drooping tuft stays visible, and Feed's icon is an apple now that onigiri is an unlockable treat. Fredoka is vendored in `app/src/ui/fonts/` (OFL) because `app/package.json` was off limits; Phase 6 may prefer the npm package.
- **2026-11-11** — Phase 3 done: the shell spike says **stay on Tauri 2**. One frameless, transparent, always-on-top window (`app/src-tauri/`, bridge in `app/src/shell.ts`) is a docked pill, a floating window and a work-area overlay. It lets clicks through everywhere except the regions the page reports, never takes keyboard focus, and has a watchdog against stuck click-through. Filmed at 120 frames a second: 220 switches with no flash and no transitional picture, and a control run that switches wrongly on purpose is caught. 440 of 440 click-through checks, with Windows' own hit-test agreeing. The save survived 242 kills mid-write. Idle in the pill: 73 MB and under 1 % of one core; a switch takes 33 ms; cold start 0.44 s. Found on the way: an animation that never stops costs 13–26 % of a core, so idle Doozer must not animate continuously (Phase 6). **Not done:** the checks that need a hand on the mouse (real clicks, tray icon, multi-monitor, sleep/resume, Win+D). The owner was at the machine, so tests used injected input only. Everything is in [docs/shell-spike.md](docs/shell-spike.md); its section 6 is the list to try.
- **2026-11-11** — Phase 3 addition, from the main session's note on the stuck-drag bug: the shell now also covers the other direction. When a press that went to the page ends, it sends `pointer-released` (read from Windows, not from a mouse-up message), so a carry or any other drag in the page ends even if the page never sees its mouse-up. Tested with injected input: a carry in the Desktop view whose mouse-up is never delivered ends within 17 ms, six runs of six, and the same carry stays stuck in a control run where the page ignores the signal. Views must listen for it (docs/shell-spike.md, section 4.3).
- **2026-11-13** — Phase 6 done: **Milestone 1 is built**, the first shippable Doozer. The view host (`app/src/host/`: one view at a time through the view contract, the three-step switch with Doozer's pop-out and pop-in, the clock, the save, tuck-away, and what the window settings do), the Pill view (`app/src/views/pill/`: the pill face, the Card unfolding from it, the settings panel in its place, the first run), and the app basics in the shell (quit that saves first, start with Windows, one copy at a time, "coming soon" items in the native menu, focus handed back after the right-click menu). 522 page tests (144 new, including the whole Pill view against the real brain in a test DOM) and 44 native tests. In the real window, with scripted input and nothing shown on screen: a full day and the next morning, the never-stuck cases, click-through around the pill and the Card, the four docks, tuck-away, always on top, start with Windows against a scratch registry key. Idle in the pill on a release build: 94–97 MB and 0.3–1.0 % of one core. Everything is in [docs/pill-checks.md](docs/pill-checks.md); its last section is the list for a person at the mouse. **Not verified:** anything with a real hand on the mouse, the look and the motion in the real window by a person, the tray icon and both menus as a person sees them, the chime by ear, a real fullscreen app, a second monitor.

  Decisions made where the spec, the contract and the Phase 5 notes left a gap (each is also in the README of the folder it belongs to):
  1. **The window never changes size.** It is always 400 × 744, transparent and click-through outside the hit regions; opening the Card only adds a region. Nothing to flicker, and the click-through state never has to change around a click.
  2. **Render on demand is strict.** At rest the pill is still and blinks in two redraws every 4–9 s. Doozer animates only for a few seconds after the pointer rested on it or something happened. A pointer that merely crosses the pill is ignored (it has to stay 180 ms): the default dock is where a pointer crosses all day, and a visible measurement caught one such crossing costing 5 % of a core for a 30-second window. An open Card nobody is looking at goes still too (`card.setLively`, new in the kit), and a sleeping Doozer's z's only rise while someone is there. `doozer.blink(true)` is new in the rig for the still blink.
  3. **Keyboard focus:** the window can take it only while the settings panel is open. With the Card open it still cannot, so feeding, petting or starting a session never pulls focus from what you are typing in. The cost: the Card's keyboard support cannot be reached in the Pill until there is a way in without a click (a tray item or a hotkey; Phase 10). "Open the Card" at the end of a session opens it without focus.
  4. **Rewards on the focus lengths:** the contract gained `brain.rewards` (change log in `docs/brain-contract.md`), and the Card says "25 minutes earns 2 treats" on each length and on Start, as a tooltip and to a screen reader. No number is written in the kit.
  5. **The hat row in settings and the "next unlock" line on the Card stay** as Phase 5 built them. Both are the only place their thing can be seen or set, and both come from the contract (`settings.hat`, `state.nextUnlock`).
  6. **How the Card learns the current view:** from the host, through a `currentView()` callback. The brain only knows the last view (`settings.lastView`), which the host sets after every switch.
  7. **Views that are not built** are simply absent from the list in `main.ts`. The Card shows them disabled with "coming soon", the native menu greys them out with the same words, and a request for one is ignored.
  8. **Size** (Small / Medium / Large) scales the pill's face (0.86 / 1 / 1.18); the Card is the same everywhere.
  9. **The save** is one document holding the brain's save and the host's part (window positions, which pet has been welcomed). It is written within a second of anything happening, within five minutes when only time has passed, when tucking away and before quitting. If it could not be *read* at start-up, nothing is written that session.
  10. **Quit** from the tray or the right-click menu tells the page first and waits up to 0.9 s for it to save; a hung page cannot stop the app from quitting.
  11. **One copy per save folder.** A second copy leaves at once. A development build keeps its own pet in a `dev` subfolder and cannot be registered to start with Windows; if registering fails, the switch turns itself back off.
  12. **First run:** the egg is in the pill's pocket; the favourite snack is shown once, as an emote and in the status line ("loves cookies"); the sound question is a small panel under the pill that waits while the Card is open or a session runs, and the mute button answers it too.
  13. **Sound:** one synthesised chime, when a session ends and when sound is switched on by the question. Everything else is Phase 10.
  14. **The shell's test page is kept** (`app/src/spike/`), loaded only in a test build started with a shell scenario, so the Phase 3 runs still work. The app's own scripted runs sit beside it (`app-scenarios.ts`, `scripts/run-app-checks.ps1`).
  15. `happy-dom` was added as a development dependency, for the Pill view's tests. Fredoka stays vendored.

  Found on the way and worth knowing: a test caught a hatching that was cut short ending the *next* hatching early (an interrupted scene reaching into its successor, the same family of bug as the Desk Buddy's); each run now carries its own number. And a person using the machine during a scripted run changes which window has the keyboard, so the runs now assert that Doozer *never* has it rather than that nothing changed.
- **2026-11-13** — The app identifier is settled: **`com.doozer.desktop`, for good.** It was a placeholder from Phase 3 and decides the save folder, so it had to be fixed before the first real pet. The owner's answer was that the name is ours to choose and to close it; keeping the existing one costs nothing and moves nothing (no real save existed yet either way). It is now one constant in the shell (`APP_ID` in `app/src-tauri/src/lib.rs`), with a test that fails if it and `tauri.conf.json` ever disagree or change. Nothing in Phase 11 (packaging) should rename it.
- **2026-11-13** — Phase 7 done: **Milestone 2 is built**, Doozer's second home and with it real switching between views. The Room view (`app/src/views/room/`: the scene in the soft storybook style, the real-time sky and light, every row of the furniture table against the real brain, Doozer's own behaviour, the meter strip, the Card from the title bar, three sizes, the window moved by its title bar and its place remembered) is in the views list in `main.ts`. 109 page tests (the whole view against the real brain in a test DOM; never-stuck cases; an hour and three hours left alone on a fake clock; Pill to Room and back through the real host) and 3 native ones. In the real window, with scripted input and nothing shown on screen: the furniture table, an hour of pet time in a minute, switching mid-session by the tray menu and the Card, click-through around the frame in all three sizes (29 of 29 probes), the Card staying on the screen, tuck-away mid-scene, and the never-stuck cases including a window drag whose mouse-up never arrives. Idle in the Room on a release build: 113–126 MB, 0.3–1.0 % of one core at rest, 1.05 % averaged over ten minutes with two of Doozer's own outings in them. Everything is in [docs/room-checks.md](docs/room-checks.md); its section 7 is the list for a person at the mouse. **Not verified:** anything with a real hand on the mouse, the look and above all the motion in real time by a person (walks, the ball, bedtime: judged from still frames and from numbers only), the pace when left alone as a matter of taste, a second monitor.

  Decisions made where the spec left a gap (each is also in `app/src/views/room/README.md`, and DESIGN_SPEC.md section 13 has the short version):
  1. **The window is bigger than the room, and never changes size.** The Card is taller than the room at Small and Medium, so the window keeps an empty, click-through band of 200 px above and below the frame. The Card hangs from under the title bar, over the scene, and slides up to stay on the screen when the room is near the bottom. For that the shell gained one small thing: a floating window may now hang over the top and bottom of the work area by a `bleed` it asks for (`mode.rs`, `shell.ts`), so the room itself can still sit right at a screen edge.
  2. **Where Doozer belongs is worked out, never remembered:** in bed while asleep, on the rug with its book while a session is running or paused, otherwise free. One function of the brain's state, checked after every scene, on every change and once a minute. This is the Room's answer to "it would get stuck randomly".
  3. **The frame is dark glass; the room inside keeps its own soft art.** A round close button sits on the Card's corner, because slid up the Card can cover the title-bar button.
  4. **The lamp is not a switch of its own.** It is on exactly while Doozer is awake, so it cannot disagree with the pet.
  5. **The clock:** a click starts a session with the length chosen on the Card, and a click while one is running or paused stops it, as the spec's table says; pause and resume stay on the Card. The clock's face becomes a kitchen timer and the title bar counts down.
  6. **During a session** Doozer does not leave its book for the bowl (the serving just goes from the bowl); things *you* do still get their scene, and it fetches the book again afterwards.
  7. **The window is not clickable**, as the spec's table says. Doozer goes and looks out by itself.
  8. **Size** scales the frame (0.86 / 1 / 1.2) from its top-left corner; the Card is the same in every size.
  9. **The pace when nobody is looking** was set by measurement, not taste: a second of animation costs about a third of a processor core in this window, so, left alone, about seven in ten of the things Doozer does are a still glance and it really goes somewhere about every six minutes; with the pointer in the room it does something every 5 to 11 seconds. The three numbers are at the top of `behaviour.ts`. **This one is the owner's to tune by eye.**
  10. **A new Doozer met in the Room** (its hatching in the Pill was cut short) gets a short hello there and is then marked as welcomed.

  Found on the way and worth knowing: (a) the scripted run in the real window caught what no test in a test DOM could: at Small and Large the frame was drawn up to 42 px from the rectangle that catches the mouse, because CSS `zoom` on an element also scales that element's own `left` and `top`. Position goes on a wrapper, scale on the thing inside. (b) The brain makes Doozer wait five minutes between servings from the bowl (`bowlPaceSeconds`), so a test that feeds it from the bowl twice in a row must let that time pass, or it silently tests nothing; the Room's tests now say so if a scene they mean to interrupt never started. (c) Breaking the view on purpose in ten ways found two missing tests. (d) For Phase 10: everything that moves is drawn 120 times a second on this display; drawing a lively Doozer at half that rate would roughly halve the cost of every outing in every view.
- **2026-11-13** — Phase 8 done: **Milestone 3 is built**, the 3D Doozer and its island. The model (`app/assets/doozer/`: one Blender script, run headless, that builds body, face, limbs, hats, armature, shape keys and palettes from the 2D rig's own numbers and exports `doozer.glb`), the 3D character (`app/src/character/doozer3d.ts` and `body-motion.ts`: the same expression table and the same state machine as the 2D rig, a procedural squash-and-stretch spring), and the Island view (`app/src/views/island/`) are in; the Island is in the views list in `main.ts`. 222 page tests (the whole view against the real brain, the real model file and the real three.js scene in a test DOM) and 2 native ones; 1,029 page tests and 51 native tests in all. Scripted runs in the real window (`app/src/views/island/checks.ts`, `scripts/run-island-checks.ps1`, `measure-island-leak.ps1`) and every measurement are in [docs/island-checks.md](docs/island-checks.md). Not seen by a person yet.

  Decisions made where the spec left a gap (each is also in `app/src/views/island/README.md`):
  1. **One design, two renderings, from the same numbers.** The model's outline is the 2D rig's body outline turned into a solid; pivots, palettes and the list of faces are read from the 2D rig's own tables, and tests compare the exported file with them. On the island Doozer is drawn a fifth larger than that, because at the rig's exact size it looked small beside the mockup's.
  2. **The window is bigger than the island and never changes size with what is open** (as in the Room): 408 × 640 at Small and Medium, with empty click-through bands above and below for the Card, which opens over the island. The bands may hang off the screen (the shell's `bleed`).
  3. **Hit regions follow the island's outline, worked out from the camera's numbers,** not read back from the picture: the silhouette cut into slabs about 16 px tall, plus Doozer, the ball, and whatever is open. About 13 regions at rest.
  4. **Touch does not depend on the canvas.** One transparent layer takes every pointer event and what was touched is worked out from the camera, so touch survives the renderer being rebuilt.
  5. **A poke is not a pet.** A click squashes Doozer and opens the Radial and the brain hears nothing; only a stroke is a pet. (The mockup counted a poke as a pet; spec 5.4 gives the Island both gestures.)
  6. **Keyboard:** as in the Pill, the window may take the keyboard only while the settings panel is open.
  7. **The 3D engine is loaded into a hidden frame and thrown away with it.** Disposing of the scene could not give back three.js itself; removing the frame's whole script world does. `vite.config.ts` builds a second small page for it (`app/island-frame.html`). If the frame cannot be had within 4 s, the engine is imported into the page as before.
  8. **A lost graphics context is waited for (2.5 s), then the renderer is rebuilt on a new canvas;** if that fails too, Doozer goes back to the first view rather than sit on a dead island. Scenes go on meanwhile.
  9. **The pace when nobody is looking was set by measurement, not taste** (as in the Room): a second of animation costs about a fifth of a processor core in this window. Alone, Doozer blinks every 5 to 11 s in two redraws and stirs every minute to three for about a second without "coming alive"; anything done unwatched is drawn at 30 frames a second; asleep, the fireflies move every 4 s. With the pointer resting on the island it breathes, looks at the pointer and hops somewhere new every 2 to 5 s. The numbers are at the top of `index.ts`. **This one is the owner's to tune by eye.**
  10. **Night has a sky of its own:** a dark-blue glow behind the island that fades out before the edge of the window, so the moon and stars show on a pale wallpaper too.
  11. **The bowl is not drawn on the island;** Doozer eating from it shows as a snack arriving. **Emotes are the kit's**, laid over the canvas, so they look the same in every view; crumbs, raindrops and the ball's puff of stars are drawn in the scene.
  12. **Size** scales the island (0.8 / 1 / 1.25); the Radial, the chip and the Card stay the same size.
  13. `three` (r187) was added as a dependency. Nothing outside the Island loads it.

  Found on the way and worth knowing: (a) **the shell could crash on a round hit region** (`f64::clamp` panics when rounding leaves its bounds a hair out of order, which happens for a region whose radius is half its width; a release build aborts on a panic). Fixed in `hit.rs`, commit `fd4a8bd`; any earlier scripted run that died with exit code `-1073740791` and no report was probably this. (b) **An object keeps alive the whole script world that made it:** one small report from the 3D stage, kept by the measuring script, kept the entire engine in memory once per visit. (c) **Waking the frame loop on every change in the brain drew a frame for every tick of a focus countdown;** what changes the picture now asks for its own frame. (d) Several builds running at once share one WebView2 profile unless each is given its own (`WEBVIEW2_USER_DATA_FOLDER`), and a `frontendDist` given as an absolute path embeds no page at all.
- **2026-11-14** — Phase 9 built and checked: **the Desktop view, Milestone 4**, with two things left that only the owner can do. `app/src/views/desktop/` (README in the folder): Doozer on the top edge of the taskbar in the work-area overlay, with hit regions that follow it; the Still / Calm / Lively pace levels as one table (`pace.ts`), Lively at the mockup's speeds, running to its food and after the ball; carry and the gentle float down; peekaboo; ball play; the Radial, the Card and the settings over its head; focus manners (sits still at any pace, time left on hover); the taskbar on any edge or hidden; its spot remembered per monitor in the save. 176 page tests in `app/tests/views/desktop/` (1,029 in the repository at the end), type-check clean, 51 native tests. Everything is in [docs/desktop-checks.md](docs/desktop-checks.md). In short:

  - **Never stuck, on a fake clock:** 16 scenes, each cut at every step of it (365 cuts) in 8 ways (picked up, dropped at once, the mouse-up lost in three forms, another action started, the menu opened, the view switched, tucked away, the display changed): 2,920 interruptions, every one ending idle on the taskbar line, with the watchdog asked after every step and never having anything to put right. The watchdog itself is shown to work by breaking the view on purpose in five ways.
  - **Never stuck, in the real window with injected input:** the mockup's drag test (the window never goes click-through while the button is down); the same drag with the mouse-up never delivered (the carry ends 7 to 17 ms after the button comes up, on the shell's `pointer-released`); a carry the shell never saw (ends on the next move with no button, or after 30 s of silence); 12 scenes cut at 5 moments in 5 ways, real view switches and real tuck-away among them, 300 of 300; rapid clicks; and the five deliberate breakages, each caught and put right.
  - **The soak:** three hours, 5,090 random injected actions (731 carries, 671 scenes, 123 real view switches, 64 tuck-aways), cloaked and in the background while the machine was in use. 128 hands-off checks, every one finding Doozer at rest; the watchdog rescued nothing; no scene was ended by its time limit; the page never fell silent; memory level; and at the end Doozer was idle on the taskbar line. A first run on the build before was stopped at 25 minutes because it had found a bug (below).
  - **Click-through:** 709 probe points across the work area in 13 states, comparing what the view asked for, what the page would answer to and the window's real style: none wrong, and at no point did the window catch a click the view had not asked for.
  - **Idle cost, release build:** memory 123–143 MB at every pace. CPU, share of one core: Still 0.4–1.1 %; Calm under 1 % in a minute with no stroll, 2–6 % in a minute with one, 3.6 % averaged over twelve minutes; Lively 16–32 %, mean 23 %; a focus session 0.3–0.6 %; asleep 0.2–0.6 %. At rest it is at the budget line (the empty overlay of Phase 3 measured 1.1–1.5 %); walking costs a third to a half of a core while it lasts.
  - **A focus session** started in the Desktop view goes to the Pill and back, paused and resumed on the way, and finishes with its treats: nothing lost.
  - **Not done, and not mine to do:** the owner trying Calm and Lively to choose the default (it is Calm), and the owner agreeing that Doozer no longer gets stuck. Section 9 of the write-up says exactly what to try. **Not verified:** anything with a real hand on the mouse, the look of the motion in real time, a second monitor, a taskbar that is really on another edge.

  Decisions made where the spec left a gap (each is also in the view's README, and the spec's section 13 lists them):
  1. **The overlay is the whole work area**, as the spec says, not a strip along the bottom, so Doozer can be carried anywhere. It costs about 30 MB more than the pill.
  2. **Never stuck is built in three layers.** One scene at a time, each with a time limit, and a walk that answers "did not arrive" when it is stopped (the mockup's bug was a walk that never answered). A carry that ends on mouse-up, `pointercancel`, lost capture, the shell's `pointer-released`, the window losing focus, a move with no button, 30 s of silence and a 2-minute limit. And a watchdog that checks once a second that everything is as it should be and puts Doozer back on the line if not. **A rescue is a bug**: the tests and the soak hold the view to zero.
  3. **Movement is a function of the clock**, stepped by a timer; animation frames only make it smooth. A walk ends on time whether or not a frame is ever drawn.
  4. **Render on demand, as in the Pill.** At rest Doozer is still: a two-redraw blink every few seconds and a glance now and then. It breathes and moves only while it is doing something or the pointer rests on it. A pointer merely crossing it on the way to the taskbar is ignored.
  5. **Lively keeps the mockup's rhythm and its speeds for the peek, the run to the food and the chase** (70, 95 and 150 px/s). Its stroll is 56 px/s, not the mockup's 46: speeds are chosen so that the rig's feet do not slide, and a trot slides below about 56. It peeks about once a minute, not on a quarter of its decisions; and there are no windows to jump on (spec 2.1).
  6. **Calm strolls stay within 300 px of Doozer's spot**, which is where it was last put down; a peek returns there. The spot is kept per monitor in the save, as how far across the screen it is.
  7. **With the taskbar not along the bottom, Doozer stands on the bottom edge of the screen.**
  8. **While something is open or the pointer is on Doozer it does not wander off**, and a scene asked for while the Card is open is played on the spot, so the Card is never left hanging where Doozer was. Menus close by themselves when nobody is there (Radial 12 s, Card 2 min, settings 3 min).
  9. **A sleeping Doozer is carried asleep** (the mockup woke it). **The ball can be bopped** with a click, not dragged or thrown. **Peekaboo has no words**: a heart. **Reduce motion**: no wandering, no float, running scenes played on the spot. **Size** is Doozer's size: 92, 112 or 136 px.
  10. **While a session is paused Doozer may wander again**, glasses on: the brain's `quiet` flag is what silences it, and that is true only while a session is running.
  11. **The host gained one thing:** a view may keep a small note of its own in the save (`context.memory`; `ViewMemory` in `app/src/host/view.ts`). Additive: saves written before it read exactly as they did.
  12. **The scripted runs build into their own folders** (`scripts/build-desktop-checks.ps1`), so that several sessions can build at once.

  Found on the way and worth knowing: (a) **The soak found what nothing else had**: with Reduce motion on, the kit gives every element a 0.12 s transition, and on the transform that places Doozer that made it slide into place and lag the pointer. Any view that places something from script under a kit root should check for the same. (b) The geometry test found a Radial button off the bottom of the screen at the Small size near an edge; re-reading found that choosing a Size closed the settings panel. (c) Lively almost never peeked until a peek that fell due while Doozer was busy was made to wait for the next free moment. (d) Building into one's own folders with `TAURI_CONFIG`: the page folder must be relative to `src-tauri` (an absolute Windows path is taken for a URL and the app shows a folder listing) and new each time (cargo does not notice a changed page). (e) A scripted press has to wait until the shell has noticed the pointer, and follow Doozer if it is moving, or the shell rightly does not treat the press as Doozer's. (f) A hidden window still gets its animation frames (measured: 120 a second), so tuck-away really must stop every timer by hand. (g) For Phase 10: drawing the walk at 30 or 60 frames a second instead of 120 would cut the cost of every stroll by half or more, which is what would bring Calm near the budget; and the shell's style-repair counter read 19 after the soak, which nobody has looked into.
