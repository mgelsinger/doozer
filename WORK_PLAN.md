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
| 7 | Room view | M2 | Not started | high |
| 8 | 3D Doozer and the Island view | M3 | Not started | **xhigh** |
| 9 | Desktop view (the calm roamer) | M4 | Not started | **xhigh** |
| 10 | Sound, polish, accessibility, performance | M5 | Not started | high |
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

---

## 12. Phase 9 — Desktop view  ·  effort: xhigh  ·  M4

**Goal:** spec section 6.4, and above all its **"Never stuck"** list — the owner's one complaint about the mockup was that Doozer "would get stuck randomly".

**Tasks:** the work-area overlay mode; Doozer on the taskbar edge with correct hit regions as it moves; the behaviour state machine with a time limit on every state and a watchdog back to idle; the Still / Calm / Lively levels (Lively close to the mockup, including running after the ball); carry and set-down with the gentle float, ending on mouse-up, lost capture, lost focus, or movement with no button held; peekaboo; ball play; the Radial; focus behaviour (sits still, time on hover); correct placement with the taskbar on any edge or auto-hidden; remembering its spot per monitor; injected-input tests for the stuck cases, modelled on `shell/main.mjs --dragtest`.

**Done when:** the stuck-case tests pass, including a drag whose mouse-up never arrives and a scene interrupted at every step; a soak run of several hours with random injected actions ends with Doozer idle on the taskbar; the overlay never eats a click meant for another app; the owner has tried Calm and Lively and chosen the default; the owner agrees Doozer no longer gets stuck.

---

## 13. Phase 10 — Sound, polish, accessibility, performance  ·  effort: high  ·  M5

A small coherent sound set to replace the synthesised placeholders (off by default); a timing and easing pass on every scene; reduce-motion mode; colour-independent need indicators; scalable interface; a final pass against the performance budget in all four views.

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
