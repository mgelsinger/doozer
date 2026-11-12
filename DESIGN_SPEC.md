# Doozer — Design Spec (v1)

**Status:** **signed off by the owner as written, 2026-11-11.** Written from the owner's review of the Phase 1 mockups. Changes from here on are amendments: note them in section 13.
**Companion document:** [WORK_PLAN.md](WORK_PLAN.md) says *how and in what order* this gets built. This file says *what* gets built. Where the two disagree about behaviour, this file wins.

---

## 1. In one paragraph

Doozer is **one pet with four homes**. The Pill, the Room, the Island and the Desktop are four views of the same creature, each with its own look and its own way of being touched. You move Doozer between them whenever you like, and everything carries over — needs, treats, streaks, sleep — because there is only one pet underneath. A **focus timer** is built into every view: finish a session and Doozer earns treats.

---

## 2. What the review decided

| Topic | What the owner said | Decision |
|---|---|---|
| V1 Pocket (pixel toy) | "least desirable" | **Cut.** The mockup stays in the repo as a record only. |
| V2 Blob | Liked. Poke and stroke; night when asleep; different snacks | **Kept** as the **Island** view. |
| V4 Cozy Room | Liked. Click the furniture; real-time sky; food waits in the bowl | **Kept** as the **Room** view. |
| V5 Pill | Liked. One card with everything; focus timer | **Kept** as the **Pill** view, and promoted: its card becomes the shared **Card** available in every view. |
| V3 Desk Buddy | Liked least of the four; "some of the movement" was annoying; radial menu and peekaboo liked | **Kept** as the **Desktop** view, rebuilt calmer (6.4). Built last. |
| Focus timer earning food | "really did like"; gamify the productivity genre | **Promoted to a core system** present in every view (section 4). |
| Swap between views, stats carry over | Proposed by the owner | **This is the product's structure** (section 5). |
| Colour | "Let me choose in settings" | Five palettes, chosen in settings, applied in every view. |
| UI style | Minimal dark glass ticked | **All chrome** (menus, the Card, settings) is dark glass. The worlds keep their own soft, colourful art. |

### 2.1 Things that were not ticked, and what happened to them

The checklist said "tick anything you want", so an empty box could mean "no" or just "don't mind". These calls were put to the owner and **accepted at sign-off with no vetoes.**

| Not ticked | Decision | Reasoning |
|---|---|---|
| Little messes to tidy | **Cut.** | It is a chore, and the tone is cosy/productive. The Clean need stays; washing restores it. |
| Speech bubbles (text) | **Cut from v1.** Wordless emotes instead (a heart, a snack, "z", a "?"). | Three different "Doozer tells you things" options were all left unticked. Reads as: no pop-up text on my desktop. |
| Thought bubbles; one-line nudges | **Cut.** Needs show through Doozer's face and tuft, the meters, and the pill's status colour. | Same reason. Nothing pops up uninvited. |
| Bond hearts | **No hearts anywhere.** Bond stays as a hidden stat. | Visible progress comes from the focus streak and unlocks instead (section 4), so there is one progress system, not two. |
| Pick up and throw | **Reduced to drag-to-move.** No throwing, no bounce physics. | You still need a way to put Doozer somewhere else. Flinging was likely part of the "annoying movement". |
| Sits on windows, rides them | **Cut.** | Also removes the single most expensive piece of platform work. |
| Ring-gauge buttons under the island | **Replaced by the radial menu**, which keeps the need rings. | One way to act on Doozer in the open-air views instead of two. |
| LCD clock and words, stats on a side button | Gone with V1. | — |

---

## 3. The pet (rules shared by every view)

### 3.1 Needs

Four needs, each 0–100, higher is better. The drain rates were tuned in the brain phase (see section 13); the values the app actually uses live in [app/src/core/tuning.ts](app/src/core/tuning.ts), and the reasoning is in [docs/brain-week-sim.md](docs/brain-week-sim.md).

| Need | Drains while awake | Restored by | Mood when low |
|---|---|---|---|
| Tummy | 14 / hour | Meal +32 · treat +10 | hungry |
| Fun | 6 / hour | Play +28 · petting +3 · treat +16 | bored |
| Energy | 8 / hour | Sleeping +60 / hour | sleepy |
| Clean | 4.5 / hour | Wash → 100 | dirty |

Below **30** a need is *low*; below **12** it is *urgent*. While asleep, the other three drain at a fraction of the awake rate: Tummy and Clean at half, Fun at 0.15.

### 3.2 Food

- **Meals are unlimited.** Doozer never goes hungry because you had a bad day. Each meal is an apple, a piece of bread or a carrot, picked at random.
- **The bowl** holds up to **3 servings**. Whenever Doozer is awake and Tummy is below 70, it eats one serving on its own. This works in every view and **while the app is closed** — filling the bowl is how you look after Doozer before stepping away.
- **Hand-feeding** (the Feed action) gives one meal immediately, without touching the bowl. Refused when Tummy is above 94.
- **Treats** are earned by focusing (section 4) and kept in a jar, up to 20. A treat is a random snack from the ones unlocked so far. A plain biscuit is available from the start, and a new Doozer arrives with 2 treats in the jar as a welcome gift.
- **Favourite snack:** each Doozer has one, picked at hatching. It gets a visibly bigger reaction. Purely for delight.

### 3.3 Sleep

Toggled by the player, or automatic when Energy reaches 4. Doozer wakes by itself at 100. Play, feeding and washing are refused while asleep; petting is not.

### 3.4 Mood

Derived, never stored: `asleep` → the lowest need's mood if any need is low → `joyful` (average above 78) → `content` (above 50) → `meh`.

The **tuft** on Doozer's head is the mood meter in every view: perky when happy, drooping when not.

### 3.5 Bond

A hidden 0–100 value. Rises slowly with good care and with each interaction; falls only while a need is urgent. It has **no UI**. It may colour small things (how excited the hello is). It exists so later features have something to hang on.

### 3.6 Time

Real time. On launch, the time since the last save is simulated (capped at 12 hours), including eating from the bowl and falling asleep.

### 3.7 Consequences

**Doozer never dies and never leaves.** Neglect makes it sulky, grubby and sleepy; one visit brings it back.

### 3.8 Refusals

Every refused action (full, asleep, too tired, no treats) gets a small head-shake and an emote. Never an error message, never text.

---

## 4. Focus & rewards

The productivity loop. It lives in the pet brain, not in any one view.

### 4.1 Sessions

- Lengths: **15, 25 or 50 minutes** (25 is the default). Start, pause, resume, stop.
- A session is defined by timestamps, so it survives switching views and restarting the app.
- Stopping early gives nothing and costs nothing. No scolding.

### 4.2 Rewards

| Session | Treats |
|---|---|
| 15 min | 1 |
| 25 min | 2 |
| 50 min | 4 |
| First completed session of the day | +1 |

### 4.3 Streak

Days in a row with at least one completed session. Shown in the Card as a small number with the best-ever beside it. When it breaks it quietly resets; nothing is said.

### 4.4 Unlocks

Completed sessions (lifetime count) unlock small things. The mechanism is in scope for v1; the list below is a starting point to tune.

| Sessions | Unlock |
|---|---|
| 1 | Snack: cookie |
| 3 | Snack: donut |
| 6 | Toy: yarn ball |
| 10 | Snack: strawberry |
| 15 | Hat: nightcap (worn while asleep) |
| 25 | Toy: rubber duck (appears at bath time) |
| 40 | Snack: onigiri |
| 60 | Hat: tiny bow |

Colours are **not** unlocks; they are free in settings.

### 4.5 Manners during a session

- Doozer puts on its round glasses and settles. No wandering, no sounds, no emotes.
- Needs keep draining as normal; the bowl covers hunger.
- A need becoming *urgent* shows only as Doozer's face changing. Nothing else.
- **When the session ends:** Doozer celebrates, the treats land in the jar, and (if sound is on) one soft chime plays. The app never takes keyboard focus. A setting chooses between "celebrate quietly" (default) and "open the Card".

### 4.6 How each view shows it

| View | During a session |
|---|---|
| Pill | Countdown in the pill; ring fills as time passes |
| Room | The clock on the shelf runs; Doozer sits on the rug with a book |
| Island | Glasses on; a small dark-glass chip under the island shows the time left |
| Desktop | Glasses on; Doozer sits still; time left appears only when you hover |

---

## 5. One pet, four homes

### 5.1 The rule

**Exactly one view is on screen at a time.** Switching is instant and loses nothing.

| Carries over (it belongs to the pet) | Does not carry over (it belongs to the view) |
|---|---|
| Needs, sleep, mood, bond | Where the ball rolled to |
| Bowl contents, treat jar | Whether a menu was open |
| Focus session in progress, streak, unlocks | Doozer's exact position inside the view |
| Colour, settings | |

Each view remembers its own window position and size.

### 5.2 How you switch

- The **Card** has a row of four view buttons.
- **Right-click** Doozer (or the room's title bar) for the native menu: the four views, Settings, Quit.
- The **tray icon** has the same menu.

Transition: Doozer gives a little hop and pops out; the window changes; Doozer pops in. Under half a second.

**First run** opens in the Pill. After that the app reopens in the last view used.

### 5.3 Shared pieces

Three components appear in more than one view and must look and behave identically everywhere.

**The Card** — the "one card with everything". From top to bottom:
1. Doozer on a small stage (pettable)
2. Four need meters
3. Actions: Feed, Play, Wash, Nap/Wake
4. Bowl (three pips, *Fill*) and treat jar (count, *Give one*)
5. Focus: time, the three lengths, Start/Pause/Stop, streak
6. Views: Pill · Room · Island · Desktop
7. Settings and mute

**The Radial** — the quick menu around Doozer in the open-air views. Six buttons on an arc: Feed, Play, Wash, Nap/Wake, Treat, and *More* (opens the Card). The four need buttons carry a ring showing that need's level.

**Emotes** — small icons that float up from Doozer: heart, sparkle, "z", a snack, a "?" for refusals.

### 5.4 One interaction language

| Gesture | Pill | Room | Island | Desktop |
|---|---|---|---|---|
| Stroke across Doozer | pet | pet | pet | pet |
| Click Doozer | open / close the Card | pet | poke + Radial | poke + Radial |
| Drag | — | title bar moves the window | grip moves the window | carries Doozer; put it down anywhere |
| Click things | Card buttons | the furniture | ball, snack | ball, snack |
| Right-click | native menu | native menu | native menu | native menu |

---

## 6. The four views

### 6.1 Pill — the home base

*Reference: [mockups/v5-pill](mockups/v5-pill/index.html) · [screenshot](docs/screenshots/shell-pill.png)*

- **Window:** a dark pill about 214 × 54, docked to a screen edge (top-centre by default; top-left, top-right or bottom-right in settings). Clicking it unfolds the Card beneath it.
- **Look:** dark glass; Doozer (2D, bold outline) tucked into the left end with ears and tuft poking over the top.
- **Pill face:** name, one status line ("is content", "is hungry" in amber, or the countdown while focusing), and a ring: wellbeing normally, session progress while focusing.
- **Changes from the mockup:** no toast messages; bowl pips and streak added to the Card; the views row and settings added; the mess button removed.
- **Why it is first:** it is the smallest, the cheapest, the all-day view, and it carries the whole focus loop. With only the Pill built, Doozer is already a usable product.

### 6.2 Room — the terrarium

*Reference: [mockups/v4-room](mockups/v4-room/index.html) · [screenshot](docs/screenshots/shell-room.png)*

- **Window:** framed, about 380 × 464, with its own title bar. Three sizes (small / medium / large).
- **Look:** soft storybook vector, no outlines. Doozer is the 2D rig in its soft style.
- **How it works:** you set things up; Doozer decides when to use them.

| Object | Click it to | Doozer then |
|---|---|---|
| Bowl | fill it (3 servings) | walks over and eats when hungry |
| Ball (or unlocked toy) | toss it | chases it if it has the energy |
| Soap | start a bath | gets scrubbed where it stands |
| Lamp | lights off / on | goes to bed / wakes up |
| Bed | send to bed, or wake | same |
| Window | — | wanders over and looks out |
| Treat jar *(new)* | give a treat | comes running |
| Clock *(new)* | start or stop a focus session | fetches its book |

- **Sky:** follows the real time of day — sun, moon, stars, dusk — and the room's light follows the sky and the lamp.
- **Meters:** a slim strip under the scene. A button in the title bar opens the Card.
- **Changes from the mockup:** treat jar and clock added; thought bubbles, speech bubbles, messes and hearts removed.

### 6.3 Island — the one you touch

*Reference: [mockups/v2-blob](mockups/v2-blob/index.html) · [screenshot](docs/screenshots/shell-blob.png)*

- **Window:** frameless and transparent, about 380 × 450. A grip appears on hover for moving it. Three sizes.
- **Look:** soft 3D plush on a small floating island. This is the only 3D view.
- **Touch:** stroke to pet; click to poke (it jiggles) and open the Radial. Click the ball to bop it.
- **Snacks** drop onto the island as 3D objects — a different one each time — and Doozer hops over to eat.
- **Night falls when Doozer sleeps:** light cools, moon and stars fade in, fireflies drift.
- **Changes from the mockup:** the row of ring buttons under the island is replaced by the Radial; messes, speech bubbles and the hearts line are removed; a real modelled Doozer replaces the one built from spheres.

### 6.4 Desktop — the calm roamer

*Reference: [mockups/v3-buddy](mockups/v3-buddy/index.html) · [screenshot](docs/screenshots/shell-buddy-crop.png) — the mockup is livelier than this spec; where they differ, follow the spec.*

- **Window:** an invisible overlay over one monitor's work area. Clicks pass through everywhere except Doozer and its menus.
- **Look:** 2D rig, bold outline (it has to read against any wallpaper), about 110 px tall.
- **Where it lives:** on the top edge of the taskbar. Nowhere else.
- **Movement is the thing to get right.** Default behaviour is *Calm*:
  - Doozer mostly stays where it is: sitting, looking around, blinking, yawning, napping.
  - Every 45–120 seconds it may take a short, slow stroll (at most ~300 px, ~30 px/s) and settle again.
  - The walk is a gentle waddle, not a rock-and-bounce.
  - No jumping, no climbing, no chasing across the screen.
- **Activity setting:** *Still* (never moves on its own) · *Calm* (default) · *Lively* (more strolls, closer to the mockup).
- **Peekaboo:** occasionally — roughly once every ten minutes, never during a focus session — Doozer walks to the nearer screen edge, slips halfway off, peeks back in, and returns.
- **Moving it:** drag to carry (it dangles), release to set it down. Released in mid-air, it floats gently down to the taskbar. It then stays near that spot.
- **Play:** Doozer bats a ball back and forth close to where it stands for a few seconds. It does not run after it.
- **Changes from the mockup:** calmer movement throughout; no throwing; no sitting on windows; no speech bubbles; no messes; the Radial gains Treat and More.

**Never stuck.** The owner's one complaint about the mockup was that Doozer "would get stuck randomly". That was a defect, not a matter of pace, and it is the first thing this view must get right:

- Every behaviour has a time limit and a guaranteed way back to idle. A watchdog returns Doozer to idle, on the taskbar line, if it has been "in the middle of something" too long or is somewhere it should not be.
- A scene that is interrupted (Doozer is picked up, falls, or another action starts) is cleaned up completely. Nothing is left half-open.
- A carry always ends: on mouse-up, on losing the mouse, on the window losing focus, or as soon as the mouse moves with no button held.
- The click-through state never changes while a mouse button is down.
- These are tested with injected input, including the case where the mouse-up never arrives.

**Pace.** The *Calm* default above was written before the owner's answer, as a guess at what was annoying. Pace turned out not to be the complaint. Calm stays as the default for now, *Lively* should be built close to the mockup (including running after the ball), and the owner chooses the default by trying both when this view exists.

---

## 7. The character

- **One design, two renderings:** a 2D vector rig (Pill, Room, Desktop) and a 3D model (Island). Same proportions, same face, same tuft, same expression names, so Doozer is recognisably the same creature in every home.
- **The 2D rig has two line styles** from one set of parts: bold outline (Pill, Desktop) and soft, outline-free (Room). The mockup rig in [mockups/shared/doozer-svg.js](mockups/shared/doozer-svg.js) already does this.
- **Palettes:** Peach, Mint, Lavender, Butter, Sky. One setting; applies everywhere.
- **Expressions (shared vocabulary):** joyful, content, meh, hungry, bored, sleepy, dirty, asleep; reactions: eat, love, wow, cheer, no, shake, yawn; plus *focus* (glasses, calm eyes).
- **Animation set:** idle breathe, blink, look-at, walk, hop, eat, play, wash/shake, fall asleep, sleep, wake/stretch, celebrate, sulk, carried, set-down squish, yawn, wave, read (Room), peek (Desktop).

Doozer is an original creature. If it should resemble a real pet or an existing drawing, that changes this section and nothing else.

---

## 8. Look of the chrome

Everything that is *interface* rather than *world* — the pill, the Card, the Radial, settings, tooltips — is one dark-glass kit:

- Near-black plum surface (`#221b2a`), lighter raised surface (`#2f2738`), warm off-white text, one warm accent (butter yellow) for primary actions.
- Large radii, soft shadows, spring-eased open/close.
- Need colours are consistent everywhere: green → yellow → amber → red as a need falls. Colour is never the only signal: the meter length says the same thing.
- Rounded display type (Fredoka in the mockups).

---

## 9. Settings

| Setting | Options | Default |
|---|---|---|
| Colour | Peach · Mint · Lavender · Butter · Sky | Peach |
| Size | Small · Medium · Large (per view) | Medium |
| Pill position | Top-centre · top-left · top-right · bottom-right | Top-centre |
| Desktop activity | Still · Calm · Lively | Calm |
| Sound | Off · On | **Off** (asked once at first run) |
| When a focus session ends | Celebrate quietly · Open the Card | Celebrate quietly |
| Always on top | On · Off | On |
| Tuck away during fullscreen apps | On · Off | On |
| Start with Windows | On · Off | Off |
| Reduce motion | On · Off | Follows the system |

---

## 10. Technical shape

These are design-level constraints; the work plan has the detail.

- **Web stack** (TypeScript, a bundler, three.js for the Island only) inside a small native shell. Three of the four views and all of the chrome are HTML/SVG; a game engine would mean rebuilding them.
- **One window, one page.** The app is a single transparent window that changes its size, position and click-through behaviour when the view changes. Views are modules mounted and unmounted inside it. Consequences:
  - There is exactly one pet brain in memory; "stats carry over" needs no syncing.
  - Switching does not restart anything.
  - The 3D engine is loaded only when the Island is opened and fully released when it is left.
- **The brain has no knowledge of any view.** State in, events out. Views draw; they do not decide rules.
- **Each view is a module with the same small contract:** the window it wants, `mount`, `unmount`, and the regions that should catch the mouse.
- **Budget:** under 150 MB of memory and under 1% CPU when idle in the Pill. Nothing animates when nothing is happening.

---

## 11. Scope

### v1, by milestone

| Milestone | You get | Contains |
|---|---|---|
| **M1 — Pill** | A real app in the tray: Doozer in the pill, the Card, the full focus loop, settings | Shell, brain, 2D rig, UI kit, Pill view |
| **M2 — Room** | A second home; switching between two views | Room view |
| **M3 — Island** | The 3D home | Modelled Doozer, Island view |
| **M4 — Desktop** | The roamer | Desktop view |
| **M5 — Release** | Sound, polish, installer | — |

Each milestone is usable on its own. Stopping after any of them still leaves a finished thing.

### Not in v1

Messes · text speech · hearts · throwing · sitting on windows · the pixel toy · more than one view at once · life stages / growing up · room decoration beyond the unlock list · minigames · cloud sync · macOS.

---

## 12. Still open

None of these block Milestones 1–3.

1. **Is Doozer based on something real?** Assumed no: Doozer is an original creature. A photo or drawing would redirect section 7.
2. **Just for you, or to share?** Only affects the release phase (signing, updates).
3. **Default pace of the Desktop view** — Calm or Lively. Decided by trying both when the view exists (section 6.4).

Settled: the cuts in 2.1 stand; sound is off by default; the Desk Buddy complaint was Doozer getting stuck (section 6.4, "Never stuck").

---

## 13. Amendments

Record any change made after sign-off here, with the date and who asked for it.

- **2026-11-11** (owner's answer) — The annoying thing about the Desk Buddy was that it "would get stuck randomly". Section 6.4 gains the "Never stuck" requirements and a note that the Calm default was a guess about pace, to be settled by trying both. Two causes were found and fixed in the mockup: a scene that never ended when its walk was interrupted, and the desktop shell switching to click-through in the middle of a drag, which swallowed the mouse-up.
- **2026-11-11** (Claude, clarification only) — Section 3.2 now names the foods so the brain and the views agree on them: meals are apple / bread / carrot; a plain biscuit is the treat available before any unlock; a new Doozer starts with 2 treats. The interface these feed into is fixed in [docs/brain-contract.md](docs/brain-contract.md).
- **2026-11-11** (owner asked; Claude, Phase 4) — Section 3.1 now shows the drain rates tuned in the brain phase: Tummy 14, Fun 6, Energy 8, Clean 4.5 per awake hour (first guesses were 22, 26, 11, 8), and states the asleep fractions. With the first guesses Doozer was bored and hungry every morning; the tuned rates meet the target of three to five short visits a day. Nothing else in section 3 changed. Reasoning and the week simulation: [docs/brain-week-sim.md](docs/brain-week-sim.md).
