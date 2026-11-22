# Shell spike: one transparent window that changes shape

**Phase 3 of [WORK_PLAN.md](../WORK_PLAN.md)** · run 2026-11-11 · Windows 11 Pro (build 26300), one 3840 × 2160 display at 150 % scaling and 120 Hz, WebView2 runtime 157, Tauri 2.12.5 (tao 0.37.2, wry 0.57.2), Rust 1.96.

> **Since Phase 6 (2026-11-13):** the app now opens in the real Pill view, not the test page described here. The test page and its scenarios are still in the repository and still run, but only in a build made with `--features spike` and started with one of this document's scenario names in `DOOZER_SPIKE` (section 9). What Phase 6 added to the shell is listed at the end of section 8; how the real app was checked is in [pill-checks.md](pill-checks.md).

## The decision

**Stay on Tauri 2.** A single frameless, transparent, always-on-top window does everything the design needs: it is a docked pill, a small free-floating window and a full work-area overlay, it moves between those shapes without a bad frame reaching the screen, it lets the mouse through everywhere except the regions the page names, and it never takes keyboard focus. Idle in the pill, it costs about 73 MB and under 1 % of one processor core.

What it took: about 1,150 lines of Rust and Win32, part of which goes around Tauri's window layer for things it gets wrong for this app (section 4.8). That code is written, tested and small enough to own.

What would change the decision: a problem found with a real hand on the mouse (section 6) that cannot be fixed in that Rust layer. Nothing seen so far points that way. The Electron fallback remains available. It costs about twice the memory (160 MB against 73 MB, section 2.1) and would need the same cursor-tracking logic to avoid the stuck-drag bug the mockup harness had.

## 1. What was asked, and what happened

| Asked for | Result | How it is known |
|---|---|---|
| One window: frameless, transparent, always on top, shown without taking focus, not in Alt-Tab | Done | Window styles read back from Windows; the focused window never changed across start-up, 40 switches, hide and show (section 5) |
| `setWindowMode` between docked, floating and overlay with no flash or black frame | Done | Filmed at the display's full 120 frames a second: 220 switches, no flash, no transitional picture (section 2.3) |
| Click-through by region, tracked natively | Done | 440 of 440 probes correct, with Windows' own hit-test agreeing (section 5) |
| A watchdog so the overlay cannot get stuck swallowing clicks | Done, in both directions | The window cannot stay catching, and a drag in the page cannot outlive the button. Each safety net triggered on purpose and seen to recover (section 4.5) |
| Manual window dragging from a page-defined handle | Done | Dragged with injected input in both floating modes: followed the cursor to the pixel |
| `load` / `save`, atomic, keeping the last good copy | Done | Killed mid-write 242 times; the save was complete and current every time |
| Tray icon with a menu that switches modes and quits | Done | Menu items drive the page; Quit ends the process. Not yet clicked by a person (section 6) |
| Test page: a blob and buttons that cycle the modes | Done | `app/src/spike/` |
| Idle under 150 MB and under 1 % CPU | Met in the pill | 73 MB; 0.4–0.9 % of one core, which is 0.02–0.04 % of the machine (section 2.1). One warning there about animation. |
| Cycle every mode ten times, no flicker, no stuck state | Met | Sections 2.3 and 5 |

## 2. Measurements

### 2.1 Idle cost

Release build, measured with [`app/scripts/measure-idle.ps1`](../app/scripts/measure-idle.ps1): 20 seconds to settle, then three 30-second windows. Memory is from the last window; CPU is the range across the three. Every process is counted: the app itself and the six WebView2 processes it starts.

| View | Processes | Memory (private working set) | Committed | CPU, share of one core | CPU, share of the machine |
|---|---|---|---|---|---|
| **Pill**, normal build, nothing moving | 7 | **73 MB** | 157 MB | **0.4–0.9 %** | 0.02–0.04 % |
| Pill, cursor sampled at its fast rate throughout | 7 | 73 MB | 156 MB | 0.4–0.9 % | 0.02–0.04 % |
| Room, nothing moving | 7 | 81 MB | 176 MB | 0.6–0.8 % | 0.02–0.03 % |
| Island (a 2D stand-in; no three.js yet) | 7 | 80 MB | 175 MB | 0.6–1.1 % | 0.02–0.05 % |
| Desktop overlay, nothing moving | 7 | 107 MB | 237 MB | 1.1–1.5 % | 0.05–0.06 % |
| Pill, blob "breathing" (one CSS animation that never stops) | 7 | 79 MB | 154 MB | **13–26 %** | 0.5–1.1 % |
| Desktop overlay, blob breathing | 7 | 109 MB | 222 MB | **14–25 %** | 0.6–1.1 % |
| For comparison: the Phase 1 Electron harness showing the pill mockup, which animates | 4 | 160 MB | 267 MB | 40–52 % | 1.7–2.2 % |

**Which memory number.** "Private working set" is what Task Manager shows in its Memory column and is the figure to hold against the 150 MB budget. "Committed" is everything the processes have reserved for themselves, in use or not. Adding up plain working sets gives about 340 MB for the pill, but that counts the same shared WebView2 library pages once per process, so it overstates the cost several times over.

**Where the pill's 73 MB goes:** WebView2 browser process 24 MB, GPU process 20, page renderer 15, network service 6, the Rust shell 4, storage service 3, crash handler 2.

**Which CPU number.** The machine has 24 logical cores, so 1 % of one core is 0.04 % of the machine, which is how Task Manager shows it. At rest the figures are so small that the measurement is the limit: each process's time is counted in steps of about 0.05 % of a core over a 30-second window.

**The one thing here that is not cheap is an animation that never stops.** A single small CSS transform animation on the blob takes 13–26 % of a core, most of it in the GPU process, which then has a new frame to present 120 times a second. Against a budget of 1 % that is far over if the 1 % means one core, and right at the limit if it means the whole machine. The Electron mockup, which also animates all the time, shows the same kind of cost. The spec's rule that "nothing animates when nothing is happening" has to be taken literally: an idle Doozer must be still, move only now and then, or run its idle motion at a low frame rate. This is the main thing Phase 6 has to get right for the budget.

**The overlay's extra 30 MB** is in the shell's own process, and it tracks the window's area at four bytes per pixel in every mode (3840 × 2088 × 4 = 32 MB for the overlay, about 1 MB for the pill). That points at the surface Windows keeps for a click-through ("layered") window. An overlay that covered only the bottom third of the screen would cost a third as much. Tauri's `noRedirectionBitmap` option does not remove it (measured: no change).

### 2.2 Time to switch modes

Forty switches (ten cycles of pill → room → island → desktop), release build, nothing else being measured at the time.

| | median | 95th percentile | worst |
|---|---|---|---|
| Whole switch, from request to the new view painted | 32.5 ms | 41.1 ms | 41.6 ms |
| – wait for the old view to leave the screen (three frames) | 13.7 ms | 15.3 ms | 20.9 ms |
| – change the window and get the page to its new size | 8.4 ms | 16.7 ms | 16.8 ms |
|     of which native code | 1.8 ms | 2.5 ms | 2.5 ms |
| – build the new view and show it | 9.8 ms | 10.6 ms | 10.8 ms |

Switching to the pill, room or island takes about 32 ms. Switching to the desktop overlay takes about 40 ms, because the page has to be laid out at 3840 × 2088.

The spec allows half a second for a switch, including Doozer's hop out and pop in. The window change itself uses under a tenth of that.

### 2.3 What a switch looks like on screen

Timing the code says nothing about what reaches the screen, so the switches were filmed. Flat magenta patches were placed behind the window, and a thread recorded that strip of screen through the Desktop Duplication API, which hands over every frame Windows composes and says when one was missed. For each frame the outline of everything that is not magenta was recorded. A view that has settled has one outline; anything else that appears, even for one frame, is a picture that should not have been shown: a half-drawn view, the old view inside the new window, a black or white rectangle.

| Run | Switches | Frames seen | Pictures that should not be there |
|---|---|---|---|
| Final build, 10 cycles | 40 | 1,948 at 118/s (20 composed frames not seen individually) | **0** |
| Same three-frame wait, the two builds before it: 10, 10 and 25 cycles | 180 | 8,673 at 118–119/s (55 not seen individually) | **0** |
| Earlier builds, two-frame wait, five runs | 260 | 109–119/s | **0** |
| **Control:** switch without hiding the old view first | 12 | 119/s | **6**, each one frame long |
| Hide, but wait no frames before changing the window | 40 | 111/s | **1** |
| Hide and wait one frame | 40 | 111/s | 0 |

The control run is what makes the zeros mean something: when the switch is done wrongly on purpose, the film catches the old view sitting inside the new window for a single 8 ms frame.

From the same films, in the final build:

- Doozer is off the screen for **25 ms** in a typical switch (median; 95th percentile 34–51 ms, worst 75 ms).
- The new view is on screen **33 ms** after the request (median; worst 83 ms).
- In 217 of 220 switches the old view had already left the screen before the window changed. In the other three it left within one frame after, and no wrong picture appeared in any of them.

**Limits of the film.** It ran on one machine at one refresh rate. A few composed frames per run were folded into the next frame rather than seen on their own (75 of about 10,600 in the four runs with the three-frame wait), most of them during switches, when the graphics card is busiest. And it films the composed desktop, not the light leaving the panel.

### 2.4 Start-up

- **Cold start: 440 ms** from launching the process to the pill being on screen with its hit regions set (three starts: 440, 440, 439 ms; no other copy running, disk cache warm).
- **No flash.** A second copy of the app filmed a fresh start three times, over the whole work area: the first thing to reach the screen is the finished view. No white or black rectangle appears first, with or without Tauri's `noRedirectionBitmap` option, so that option is left off.
- The release executable is **3.4 MB**. There is no installer yet (Phase 11).

## 3. Where things are

| File | What it is |
|---|---|
| [`app/src/shell.ts`](../app/src/shell.ts) | The bridge every view uses. Works in a plain browser tab too, where it does nothing and saves to `localStorage`. |
| [`app/src-tauri/src/shell.rs`](../app/src-tauri/src/shell.rs) | The window's state, mode changes, and the thread that watches the cursor |
| [`app/src-tauri/src/mode.rs`](../app/src-tauri/src/mode.rs) | Window shapes and where they go on a monitor. Pure arithmetic. |
| [`app/src-tauri/src/hit.rs`](../app/src-tauri/src/hit.rs) | Hit regions and the catch-or-let-through rule. Pure. |
| [`app/src-tauri/src/save.rs`](../app/src-tauri/src/save.rs) | The atomic save file. Pure file handling. |
| [`app/src-tauri/src/win.rs`](../app/src-tauri/src/win.rs) | The Win32 calls, each wrapped once |
| [`app/src-tauri/src/tray.rs`](../app/src-tauri/src/tray.rs) | Tray icon and the one native menu |
| [`app/src-tauri/src/lib.rs`](../app/src-tauri/src/lib.rs) | Commands and start-up |
| [`app/src-tauri/src/spike.rs`](../app/src-tauri/src/spike.rs) | Test hooks. Compiled only with `--features spike`. |
| [`app/src/spike/`](../app/src/spike/) | The test page and its automated scenarios |
| [`app/scripts/`](../app/scripts/) | `measure-idle.ps1`, `save-kill-test.ps1`, `analyze-film.mjs` |

## 4. How the shell works

### 4.1 The bridge

```ts
import { shell, regionOf } from './shell';

await shell.setWindowMode({ kind: 'docked', width: 214, height: 54, anchor: 'top-center' }, 'pill');
await shell.setWindowMode({ kind: 'floating', width: 380, height: 464, x, y }, 'room');   // x, y optional
await shell.setWindowMode({ kind: 'overlay' }, 'desktop');

shell.setHitRegions([regionOf(doozerElement), regionOf(menuElement)]);
shell.beginDrag(pointerEvent);            // from a pointer handler, button still down
shell.setFocusable(true);                 // only while something needs the keyboard
shell.setVisible(false);                  // tuck away; showing never takes focus
await shell.fullscreenInFront();          // is a game or video in front?
const { data, source } = await shell.load();
await shell.save(json);
shell.showMenu();                         // the native menu, at the cursor
shell.on('view-requested', (view) => …);  // also: settings-requested, drag-end, pointer-released,
                                          // display-changed, fullscreen-changed, watchdog, quit-requested
// added in Phase 6:
shell.setAvailableViews(['pill']);        // the rest are greyed out in the menu as "coming soon"
await shell.setAutostart(true);           // start with Windows; autostartEnabled() reads it back
await shell.quit();                       // after saving, in answer to quit-requested
```

Sizes are CSS pixels. Positions are physical screen pixels: they are handed out by the shell (`drag-end`, `WindowInfo`) and are meant to be stored and handed back, not calculated with. That is the only coordinate space that stays unambiguous across monitors with different scaling.

### 4.2 Changing view: three steps

The view host must do this, in this order, every time:

1. **Hide the old view and wait three animation frames.** The blank frame has to be on screen before the window moves.
2. **`await shell.setWindowMode(mode, id)`.** The window changes shape. The promise resolves once the page has been laid out at its new size.
3. **Mount the new view, show it, then call `shell.setHitRegions`.**

Between steps 2 and 3 the window lets every click through. A view that never reports regions cannot be clicked; that is the safe way round.

Why three frames: section 2.3. With none, the old view was caught inside the new window in 1 switch of 40. With one or two it never was (0 of 300), but in about two thirds of those switches the old view was still on screen at the instant the window changed, and what saved it was Windows applying the window change and the already-submitted blank frame together. With three the old view was gone first in 217 of 220. The real host will play Doozer's pop-out animation before step 1, so it will have far more margin than the test page.

Hiding the window and showing it again around the change (the work plan's fallback) turned out not to be needed.

### 4.3 Click-through by region

Windows can make a whole window click-through or not, nothing finer. So a thread samples the cursor and switches the window to "catching" while the cursor is over one of the page's regions, and back when it leaves. A region is a rounded rectangle in CSS pixels; a large enough radius makes a pill or a circle. `regionOf(element)` builds one from an element's box and corner radius.

The cursor is sampled every 16 ms while it is moving, every 100 ms once it has been still for a second and a half, and every 6 ms while the window is being dragged.

**The state never changes while a mouse button is down.** A press that starts on Doozer keeps going to the page when the cursor strays outside the region (carrying Doozer, dragging a slider), and a drag that starts in another application is not hijacked as it crosses Doozer. This is the rule whose absence made Doozer "get stuck" in the mockup harness. The shell reads the buttons directly from Windows, so it does not depend on a mouse-up message arriving anywhere.

**And a drag in the page cannot outlive the button.** When a press that went to the page ends, the shell sends `pointer-released` with where the pointer was. It comes from the same reading of the buttons, so it arrives even if the page never gets its own `pointerup` (capture lost, focus taken by something else). Every view that drags anything should end the drag on this event as well as on its own pointer events. A press on another application is not reported, and dragging the whole window ends with `drag-end` instead.

One consequence of sampling: for up to one sample (16 ms) after the cursor crosses a region's edge the window is still in its previous state. A click landing inside that sliver of time goes to the wrong side. It takes a deliberate effort to hit.

### 4.4 Focus

The window carries the style that tells Windows never to activate it: not when it appears, not when it changes shape, and not when it is clicked. You can pet Doozer and keep typing in your editor. (Appearing and changing shape were tested. Being clicked rests on the style alone until someone clicks it: section 6.) `setFocusable(true)` lifts that for as long as something needs the keyboard (a settings field, keyboard navigation of the Card), and `setFocusable(false)` puts it back.

It is a tool window, which keeps it out of Alt-Tab and off the taskbar.

### 4.5 Never stuck: the safety nets

| If this goes wrong | This catches it | Tested by |
|---|---|---|
| The page hangs or crashes with regions set | The page checks in every 2 s. After 6 s of silence the shell drops the regions and the window is click-through everywhere. When the page comes back it is told to send them again. | Stopping the page's check-ins: regions dropped after 5.8 s, back within 0.7 s of resuming |
| Something else changes the window's style | Every sample compares the real style with the wanted one and rewrites it | Breaking the style on purpose six times: repaired in 9–93 ms |
| The page believes a drag is still going after the button has come up | The shell sends `pointer-released` the moment no button is down any more | A carry in the Desktop view whose mouse-up is never delivered to the page: ended 4–17 ms after the button came up, six runs of six. With the page told to ignore the signal, the same carry stays stuck. |
| A mode change leaves stale regions behind | Every mode change clears the regions and goes click-through before the window moves; the bridge also refuses to send regions queued for the old view | Unit tests on both sides |
| The tracker thread itself fails | It restarts with no regions and the window click-through. In a release build any panic ends the process, which removes the window. | By design; not triggered |

And always: Quit in the tray menu is handled natively and works whatever state the page is in.

### 4.6 Dragging

The page decides what is a handle and when a press has become a drag, then calls `shell.beginDrag(event)`. From there the native thread moves the window to follow the cursor until every button is up, and sends `drag-end` with the new position. No `-webkit-app-region`, so the handle can be any shape. The grab point is the place the pointer went down, so the window does not jump.

Only a floating window moves. A remembered position that is off every screen (a monitor was unplugged) is pulled back into the work area.

### 4.7 The save file

`%APPDATA%\com.doozer.desktop\save.json`, with `save.bak.json` beside it.

A save is written in full to a temporary file and flushed to disk; the current good save is copied to the backup; then one rename swaps the new save in. At no instant does `save.json` hold half a document. `load` returns the main file if it parses, otherwise the backup, and says which. A damaged main file is never copied over a good backup. The shell only insists the document is valid JSON; versions and migrations belong to the pet brain.

### 4.8 What Tauri does that the shell goes around

Found by reading the installed source of tao, Tauri's window layer, and worth knowing before changing anything here:

- **`window.show()` takes focus.** After creation tao always shows a window with `SW_SHOW`, which activates it. The shell shows and hides with Win32 instead (`SW_SHOWNOACTIVATE`). The window is created visible and unfocused, which tao does handle correctly.
- **Any style change through Tauri rewrites the whole extended style.** Calling `set_ignore_cursor_events`, `set_always_on_top` or `set_focusable` makes tao recompute the style from its own flags, wiping the tool-window style the shell relies on to stay out of Alt-Tab. The shell therefore owns click-through, focusability and always-on-top itself and never calls those Tauri functions. If something does, the tracker repairs the style within one sample.
- **`skipTaskbar` only removes the taskbar button** (tao asks the taskbar to drop it and leaves the window's styles alone). The tool-window style is what keeps a window out of both the taskbar and Alt-Tab.
- **Moving a window that is not changing size must not invalidate it** (`SWP_NOCOPYBITS`). The shell only discards the old pixels when the size changes, and does not touch the window at all when the rectangle is unchanged. See section 7.1.
- **Hiding the window does not tell the page.** `document.visibilityState` stays `visible` while the window is hidden, so timers and animations keep running. A view that is tucked away has to stop its own clock.

## 5. What was verified, and how

Everything here ran on the release build unless it says otherwise. "Injected" means the cursor tracker was fed a pretend cursor position and button state, so nothing moved the real pointer; the window style it produced was the real one and was read back from Windows.

| What | How | Result |
|---|---|---|
| Window bounds for every mode, anchor, margin, scaling, off-screen position, auto-hidden taskbar | Unit tests, `mode.rs` | 11 pass |
| Hit regions (rectangles, rounded corners, pills, circles), the button-held rule, and when the page is told a press has ended | Unit tests, `hit.rs` | 11 pass |
| Which window style goes with which state | Unit tests, `shell.rs` | 5 pass |
| Save: round trip, backup rotation, damaged and missing files, refusing bad input | Unit tests, `save.rs` | 9 pass |
| Save survives a kill mid-write | A writer process killed at a random point of the save cycle | 230 kills over two payload sizes; 162 landed while a file was being written, 13 between rotating the backup and swapping in the new save, 7 just after the swap; both files intact after every one |
| The same, whole app | `save-kill-test.ps1`: the real app saving in a loop, killed, restarted, asked what it found | 12 kills, 8 mid-write; complete and current every time |
| The bridge: region batching and ordering, the wait for the page's new size, check-ins, events, the browser stand-in | Vitest, `tests/shell.test.ts` | 29 pass |
| Ten cycles of four modes, no flicker | Filmed at 118–119 frames a second | 220 switches, nothing that should not be there (section 2.3) |
| Ten cycles, no stuck click-through | After every switch: style is click-through, regions are set, the view is on screen (pixel read off the screen), page is visible | 40 of 40 |
| Click-through in every mode | Injected cursor through 11 cases per mode per cycle: beside Doozer, on Doozer, pressed and dragged off, pressed elsewhere and dragged across, a rounded corner, the controls | **440 of 440.** For each, Windows was also asked which window a click at that point would go to: the application underneath when it should be, Doozer when it should be. |
| – on the final build | Same run | 440 of 440 on the window style. Windows' hit-test could not be asked: by then another program had left a Windows Security prompt up, whose dimming layer sits above every window. |
| Dragging | Injected press on the handle, 30 moves, release; room and island | Moved exactly as far as the cursor; never let go while held; one `drag-end`; position remembered; off-screen position rescued |
| A carry whose mouse-up never arrives | Injected press on Doozer in the Desktop view, the page told it is carrying, injected release far away, and no `pointerup` ever given to the page | Carry ended, Doozer back on the ground, window click-through again: six runs of six. Control run (page ignores `pointer-released`): stays stuck, as it must. |
| Watchdog, style repair | Section 4.5 | All recover |
| Focus | The focused window recorded at every step: start, four switches, hide, show, always-on-top off and on, focusable on and off | Never Doozer. It stayed with StarCraft II through one whole run. |
| Native menu | Menu clicks produced in code: each view item, Settings, Quit | Page switches, the tick follows, Quit ends the process with code 0 |
| A fullscreen app in front is detected | Status read while a fullscreen game was running, and while it was not | Reported correctly both times. The `fullscreen-changed` event has not been seen firing: no run was in progress when the game was closed. |
| The real pointer over Doozer | One run with the machine idle: real pointer moved onto the blob and off it | The window started catching and stopped again. The clicks were not sent (see section 6). |
| Idle cost, switch time, start-up | Section 2 | |

## 6. Not verified: needs a person at the mouse

The person who owns this machine was using it, and then away, while the spike ran. Tests kept the real mouse out so that they neither disturbed nor were disturbed. That leaves these unproven. None is expected to fail; all are cheap to check.

| Not verified | Why not | What to do |
|---|---|---|
| **Real-mouse click-through** | Clicks were never sent with the real pointer. The one attempt (machine idle) found a Windows Security prompt from another program on screen; its dimming layer takes every click, and the test rightly refused to click it. | In each mode, click beside the blob: the window underneath should react. Click the blob: it changes colour on hover and the click counter goes up. |
| **Focus when really clicked** | Same. The style that prevents activation is set and was read back, but no real click has tested it. | Type in an editor, click the blob, keep typing. |
| **Absent from Alt-Tab and the taskbar** | The tool-window style is set and was read back from Windows. Nobody has pressed Alt-Tab to look. | Press Alt-Tab with Doozer running. |
| **Typing into the window** | `setFocusable(true)` clears the style; no key has been pressed in the page. | Phase 6, with the first text field. |
| **The tray icon as a person sees it** | The icon exists and the menu logic works. Nobody has seen it or clicked it. New icons often start in the overflow area. | Click it; pick each view; Quit. |
| **The right-click menu** | `showMenu` is wired but untested. A popup opened by a window that is never activated may not close when you click elsewhere. | Right-click the blob, then click away. |
| **Dragging with a real hand** | Injected input proved the mechanism, not the feel. | Drag the room and the island, slowly and with fast flicks. In Desktop mode carry the blob and let go. |
| **Mixed-DPI multi-monitor** | One monitor. The code re-places the window when the monitor layout changes and corrects the size after landing on a monitor with different scaling; none of it has run. | Drag the room across; dock the pill and open the overlay on the second monitor. |
| **Taskbar on another edge, or auto-hidden** | The taskbar here is at the bottom and fixed. The work area is read from Windows, and the overlay leaves one pixel free when the taskbar is auto-hidden so Windows does not treat it as a fullscreen app. Untested. | Try both; check the taskbar still slides in. |
| **A fullscreen app in front** | Detection works (above). Doozer was kept invisible while the game was up, so what the game does with an always-on-top window over it was not seen. Tuck-away itself is Phase 6. | Start the app, then a game or a fullscreen video. |
| **Sleep and resume, lock and unlock** | Not something to do to a machine that is in use. The watchdog will drop the regions across a sleep and the page will restore them on its next check-in. | Sleep for a minute; check Doozer is clickable after. |
| **Win+D** | Not pressed. | Press it twice. |
| **Touch and pen** | No such hardware here. | |
| **Hours of running** | The longest run was a few minutes. | Phase 6 onward. |

## 7. Odd things seen

### 7.1 A view that vanished, once

In one filmed run, the first switch (pill to pill, so the window did not move) showed the pill for two frames and then an empty strip until the next switch brought everything back. It did not happen in the next run, in 240 further re-applications of the same view, or in 30 replays of that run's exact opening, under the old code or the new.

It is unexplained. Two guesses, neither confirmed: the web view repainting an older frame after being invalidated without any change to draw, or the test's own always-on-top backdrop ending up in front (a person was at the machine when the pink strip appeared, and a click on it might have raised it). Two changes followed. The shell no longer moves or invalidates the window when its rectangle is unchanged, which removes the one thing that switch did differently. And the film now records the stacking order and any clicks on the backdrop, so that a recurrence would explain itself. In the 612 switches filmed with that check in place, the backdrop was never in front, it was never clicked, and no view vanished.

### 7.2 A system prompt covers everything

A Windows Security prompt (raised by a different application) dims the screen with a layer that sits above always-on-top windows and takes every click. Doozer stays visible under it and cannot be clicked until the prompt is answered. That is correct behaviour and nothing to fix, but it is why the last probe run and the real-pointer test could not ask Windows where a click would land.

### 7.3 The film's colours are not the screen's

Desktop Duplication returned lighter colours than a plain screen copy of the same pixels, most likely because of how this display's colour mode is converted. The film therefore measures the backdrop colour from its first frame instead of assuming it, and judges "flash" against what each settled view normally contains.

## 8. Notes for the phases that build on this

**Phase 6 (Pill view and app basics)**

- Follow the three steps in section 4.2. `src/spike/test-page.ts` is a working example, including a drag handle and an in-page carry that ends on every exit path.
- Report hit regions after every layout change. Calls are batched, so reporting on every frame while something moves is fine.
- Each view remembers its own position: store `x` and `y` from `drag-end` and pass them back in the floating mode.
- Anything the page drags (a slider, Doozer itself) ends on `pointer-released` as well as on its own pointer events.
- When the tray asks for a view (`view-requested`) the host decides; the tick in the menu follows the `view` passed to `setWindowMode`.
- **Idle Doozer must not animate continuously** (section 2.1): one never-ending animation costs 13–26 % of a core. Measure with `scripts/measure-idle.ps1` as soon as the real rig is in the pill.
- Tuck-away: `fullscreenInFront()` and `fullscreen-changed` say when; `setVisible` does it. Stop the view's animations while hidden (section 4.8, last point).
- Not built here: single-instance guard, start with Windows, a content security policy, an installer. The app identifier `com.doozer.desktop` was a placeholder at this point; changing it moves the save folder. (Settled on 2026-11-13: it stays. See below.)
- `npm run tauri build` runs the type-check first, so it fails if any file in `app/` has a type error.

**What Phase 6 added to the shell** (2026-11-13):

- **Quit saves first.** Quit in the tray or right-click menu now sends `quit-requested` to the page and quits 0.9 s later whether or not the page answers; the page saves and calls `quit`, which exits at once. A hung page still cannot keep the app alive.
- **One copy per save folder** (a named mutex, `win::claim_single_instance`). A second copy exits immediately. Test runs with `DOOZER_SPIKE` set are exempt, and a copy pointed at another `DOOZER_SAVE_DIR` counts as a different Doozer.
- **Start with Windows** (`autostart.rs`): one value under the current user's Run key, written by `set_autostart`. A debug build refuses, so a development copy is never registered. `DOOZER_AUTOSTART_KEY` points it at a scratch key for tests.
- **A development build keeps its own save**, in a `dev` subfolder of the app-data folder.
- **"Coming soon" in the native menu:** `set_available_views` disables the items of views that are not built and says so in their text.
- **The right-click menu hands focus back.** The menu library has to make the window the foreground window for the popup to close on a click elsewhere; when the popup closes the shell gives the foreground back to whichever window had it. Not yet tried by a person.
- Still not built: a content security policy, an installer. (Both since done: the installer in Phase 11, the policy in version 1.0.1; [release.md](release.md).)
- **The identifier is settled: `com.doozer.desktop` stays** (2026-11-13). It names the save folder, so it must never change; it is the constant `APP_ID` in `lib.rs`, and a test keeps it equal to `identifier` in `tauri.conf.json`.

**What Phase 7 added to the shell** (2026-11-13):

- **A floating window may hang over the top and bottom of the work area: `bleed`.** `{ kind: 'floating', width, height, bleed: 200 }` lets the window sit up to that many CSS pixels above the top or below the bottom of the work area (never sideways), and the default spot takes it into account. It is for a window that keeps an empty, click-through band above and below what it draws: the Room does, so that its Card has somewhere to go without the window ever changing size, and the room itself can still be put right at the edge of the screen. Without `bleed` nothing changes. Three unit tests in `mode.rs`; in the real window the Room was placed with its lower band hanging off the work area and its frame 33 px above the taskbar ([room-checks.md](room-checks.md) section 2).

**What Phase 10 added to the shell** (2026-11-14; measurements and checks in [polish-checks.md](polish-checks.md)):

- **A region may be moving.** `{ x, y, w, h, r, vx, vy, ms }`: where it is now, its speed in CSS pixels a second, and for how many milliseconds it keeps that speed. The cursor thread works out where it is each time it samples (`Region::at` in `hit.rs`), and after `ms` it stays where it ended. A walk is therefore reported once, not thirty times a second. On the page side the bridge compares what a view reports with where the shell already thinks each region is (`compareRegions` in `shell.ts`) and sends nothing when they agree; a small drift is sent at most every 100 ms.
- **A way in from the keyboard.** `hotkey.rs` registers Ctrl+Alt+D (and the tray menu has *Open Doozer's card*). On the press the shell remembers which window had the keyboard, makes its own window focusable and takes the keyboard there and then (the one moment Windows allows it), and emits `card-requested { keyboard: true }`. `setFocusable(false)` gives the keyboard back to the window it was taken from. If the page does not ask to keep the keyboard within a second and a half, the shell gives it back by itself. If another program already owns the key combination the registration fails quietly and the tray item is the way in.
- **Interface size.** `set_ui_scale(factor)` (0.75 to 2) zooms the page and multiplies every scale the shell uses by the same factor, so "CSS pixels" in the bridge go on meaning the page's own pixels: window sizes, regions and the pointer need no change in any view.
- **Holding less memory.** `set_low_memory(low)` sets WebView2's memory target (`MemoryUsageTargetLevel`). Low makes the browser trim what it holds; it comes back as it is used. The host asks for it while tucked away and for a few seconds after the Island is left.

**Phase 8 (Island)**: idle cost for the island above is for a 2D stand-in. three.js will add GPU memory and, while it animates, real CPU. Measure again with the same script.

**Phase 9 (Desktop)**: the overlay is a 3840 × 2088 transparent surface costing 30 MB more than the pill (section 2.1). If that matters, a docked strip along the bottom edge (`{ kind: 'docked', anchor: 'bottom-center', … }`) is already supported and costs in proportion to its height. Regions can be reported every frame as Doozer walks. The two rules in section 4.3 are what the spec's "never stuck" list asks of the shell: the click-through state does not change while a button is down, and `pointer-released` ends a carry whose mouse-up never arrives. The view still has to listen for it and end a carry on every other exit path too, as the test page does.

## 9. Running it again

From `app/`:

```
npm test                                   # every page-side test, the bridge included
cd src-tauri && cargo test                 # window maths, regions, save, kill-mid-write (takes ~40 s)
npm run tauri dev                          # the app (since Phase 6); the test page needs a spike build
```

The automated runs need a build with the test hooks:

```
npx vite build
cd src-tauri && cargo build --release --features spike,tauri/custom-protocol
```

Then start `target/release/doozer.exe` with `DOOZER_SPIKE` set to one or more scenarios (comma separated) and, optionally, `DOOZER_SPIKE_ARGS` (JSON). The report is written to `DOOZER_SPIKE_OUT` (default: `%TEMP%\doozer-spike`) and the app quits. Set `DOOZER_SAVE_DIR` to a scratch folder so the real save is left alone. For example, in PowerShell:

```
$env:DOOZER_SAVE_DIR = "$env:TEMP\doozer-spike-save"
$env:DOOZER_SPIKE = 'cycle'
$env:DOOZER_SPIKE_ARGS = '{"tag":"film","film":true,"probe":false}'
.\target\release\doozer.exe          # about 20 seconds; pink strip on the right while it films
node ..\scripts\analyze-film.mjs "$env:TEMP\doozer-spike\film.json"
```

| Scenario | What it does |
|---|---|
| `cycle` | Ten cycles of the four modes, checking click-through in each (`{"probe":false}` skips that). `{"film":true}` films it; `{"sabotage":true}` is the control run. |
| `drag`, `release`, `watchdog`, `repair`, `focus`, `menu` | The checks in section 5. `release` with `{"control":true}` is its control run. |
| `reapply`, `prologue` | The hunts for section 7.1 |
| `camera` | Films another copy of the app starting up |
| `real` | The one test that uses the real pointer. Refuses unless the machine has been idle for 45 s and nothing fullscreen is in front. |
| `idle` | Sits in one view; used by `scripts/measure-idle.ps1` |

`DOOZER_SPIKE_CLOAK=1` runs any of them without anything appearing on screen (Windows' hit-test cannot be checked that way, and nothing can be filmed).

A build without `--features spike` contains none of this: the hooks answer with an error and the cursor can only come from the real mouse.
