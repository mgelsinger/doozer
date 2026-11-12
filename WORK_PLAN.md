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
| 3 | Shell spike: one transparent window that changes shape | M1 | **Next** | **xhigh** |
| 4 | Pet brain: needs, bowl, treats, focus, streaks, unlocks, save | M1 | **Done** — `app/src/core/`, 231 tests; tuning notes in [docs/brain-week-sim.md](docs/brain-week-sim.md) | high |
| 5 | 2D Doozer rig and the dark-glass UI kit | M1 | Not started | **xhigh** |
| 6 | Pill view and app basics (tray, settings, view switching) | M1 | Not started | high |
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
| Shell fallback | Electron | Already proven by the mockup harness in [shell/](shell/). Use if Tauri fails Phase 3. |
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
    shell.ts              bridge to the native side (window mode, hit regions, save, tray)
    main.ts               the view host: mounts exactly one view at a time
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
  window: WindowMode;      // size, anchor or overlay, which sizes it supports
  mount(host: HTMLElement, ctx: { brain; settings; ui; shell }): void | Promise<void>;
  unmount(): void;         // must release everything: timers, listeners, GPU memory
  hitRegions(): Region[];  // where the mouse should be caught; everything else is click-through
}
```

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

Still open (spec section 12): *which* Desk Buddy movement was annoying. Nothing before Phase 9 depends on it, though it would help the walk cycle in Phase 5.

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
2. **Walk cycle to the calm standard** of spec 6.4 — a gentle waddle. This is the animation the owner was least happy with; treat it as the bar for the whole set.
3. **UI kit** in `app/src/ui/`: Card, Radial (six buttons, need rings), meters, emotes, tooltips, settings panel, the view-switch row. Dark glass per spec section 8. Keyboard reachable; honours reduce-motion.
4. The kit talks to the brain through a small interface, so it can be developed against a fake brain before Phase 4 lands.
5. **A viewer page** (dev only) that shows every expression × both line styles × every palette, plays every animation on a loop, and shows the Card and Radial in every state (asleep, focusing, no treats, bowl full).

**Done when:** the viewer page exists and everything on it reads clearly at 62 px (pill size) and at 190 px; nothing in the kit hard-codes a view.

---

## 9. Phase 6 — Pill view and app basics  ·  effort: high  ·  completes M1

**Goal:** the first shippable Doozer.

**Inputs:** Phases 3, 4, 5; spec sections 4, 5, 6.1, 9.

**Tasks**

1. The **view host** (`main.ts`): mounts one view, handles switching with the pop-out / pop-in transition, remembers the last view and each view's window position.
2. The **Pill view**: pill face (name, status line, ring), unfolding Card, hit regions for both states, dock position setting.
3. Wire the Card to the real brain: actions, bowl, treats, focus, streak, view row (other views shown as "coming soon" until built).
4. Settings panel, tray menu, right-click native menu, start-with-Windows, always-on-top, tuck-away during fullscreen apps.
5. First run: Doozer hatches, picks its favourite snack; the sound question is asked once.
6. Focus manners per spec 4.5, including never taking keyboard focus when a session ends.
7. Render on demand: when nothing is animating, nothing is drawing.

**Done when:** the app installs nowhere yet but runs from the repo as a tray app; a full day's use — feed, fill the bowl, three focus sessions, quit, reopen the next morning — behaves as the spec says; idle cost is within budget.

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

**Goal:** spec section 6.4. **Read the owner's answer to the movement question first** (spec section 12, item 1); if it is still unanswered, ask before building.

**Tasks:** the work-area overlay mode; Doozer on the taskbar edge with correct hit regions as it moves; the *Calm* behaviour set and the Still / Calm / Lively setting; carry and set-down with the gentle float; peekaboo; in-place ball play; the Radial; focus behaviour (sits still, time on hover); correct placement with the taskbar on any edge or auto-hidden; remembering its spot per monitor.

**Done when:** an hour with Doozer in *Calm* while actually working produces no moment where it pulls attention uninvited; the overlay never eats a click meant for another app; the owner agrees the movement is no longer annoying.

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
| Git | on PATH — **the project folder is not a git repo yet** (Phase 3, task 1) |
| Blender 5.2 | `C:\Program Files\Blender Foundation\Blender 5.2\` (not on PATH) |
| Unity 6000.4.9f1 | via Unity Hub (not used) |
| Godot 4.7.1 | zip in Downloads, not extracted (not used) |
| Display | 4K at 150% scaling (work area 2560 × 1392 in CSS pixels) |

---

## 17. Log

- **2026-11-11** — Project started. Plan written. Phase 1 built and verified: shared brain, five mockups, gallery, Electron harness.
- **2026-11-11** — Owner reviewed the mockups. V1 cut. Direction set: one pet, four swappable homes, focus timer as a core system. `DESIGN_SPEC.md` written; plan rebuilt around milestones M1–M5.
- **2026-11-11** — Owner signed off the spec as written. Phase 3 started in its own session. `docs/brain-contract.md` written so Phases 4 and 5 can run alongside it.
- **2026-11-11** — Phase 4 done: the pet brain is in `app/src/core/` behind `docs/brain-contract.md` (one addition: `BrainOptions.debug`; see its change log and the new "How the real brain behaves" section). 231 tests in `app/tests/core/`. Drain rates were slowed from the spec's first guesses to tummy 14, fun 6, energy 8, clean 4.5 per hour so that three to five visits a day keep Doozer happy; the week simulation and the reasoning are in `docs/brain-week-sim.md`. Not done here: the table in DESIGN_SPEC.md 3.1 still shows the first guesses.
