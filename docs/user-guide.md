# Doozer: the short guide

Doozer is a small creature that lives on your desktop. It has four homes you can switch between, it needs a little looking after, and it keeps you company while you work: there is a focus timer in every home, and finishing a session earns treats.

Nothing bad ever happens to Doozer. It never dies, it is never hungry because you had a bad day, and stopping a focus session early costs nothing.

## Installing

Run `Doozer_1.0.1_x64-setup.exe`. It installs for you alone (no administrator password), into `%LOCALAPPDATA%\Doozer`, and adds Doozer to the Start menu. It needs Windows 10 or 11, 64-bit.

The installer is not signed. If Windows SmartScreen says it "protected your PC", choose *More info*, then *Run anyway*.

Doozer is free to use and to pass on unchanged; `LICENSE.txt`, installed beside the program, says so in full, and `THIRD-PARTY-NOTICES.txt` beside it lists the work of others it is built with.

## Privacy

Doozer collects nothing and sends nothing. It makes no network requests of any kind: no account, no updates, no analytics, no crash reports. The page Doozer is drawn in is not allowed to reach the network at all.

Everything it knows stays on your PC: your pet and your settings, in one small file (*Your pet's save*, below). Nothing else is written outside the program's own folder, apart from the browser engine's own cache in `%LOCALAPPDATA%\com.doozer.desktop` and, if you switch it on, one *Start with Windows* entry. Uninstalling removes both, and asks whether to delete the save too.

The one exception is not Doozer but the installer, and only on a PC that lacks Microsoft's WebView2 runtime (Windows 11 always has it): there it fetches that runtime from Microsoft.

## Finding Doozer

When it starts, Doozer sits in a small dark pill at the top of the screen, and in the tray beside the clock (the round peach face; it may be under the tray's ^ arrow).

- **Click the pill** to open the **Card**: everything you can do is on it.
- **Right-click** the pill or the tray icon for the menu: the four homes, Settings, Quit.
- **Ctrl+Alt+D** opens the Card from the keyboard. Tab and the arrow keys move, Enter presses, Escape closes it and gives the keyboard back to what you were doing.

Doozer never takes the keyboard by itself, and clicks beside it go to whatever is underneath.

## Looking after it

Four needs, shown as meters on the Card: **Tummy**, **Fun**, **Energy** and **Clean**. They run down slowly, more slowly while Doozer sleeps. Three to five short visits a day is plenty.

| Do this | What happens |
|---|---|
| **Feed** | One meal, straight away. Meals never run out. |
| **Fill the bowl** | Up to three servings. Doozer eats from it by itself when it gets peckish, even while the app is closed. Fill it before you step away. |
| **Treat** | A snack from the jar. Treats are earned by focusing. |
| **Play** | Doozer plays with its ball. |
| **Wash** | A bath. |
| **Nap** | Bedtime; press again to wake it. It also goes to sleep by itself when it is worn out, and wakes when rested. |
| **Pet it** | Stroke Doozer with the pointer, or press its picture on the Card. It likes that, awake or asleep. |

The curl of hair on its head tells you how it is: perky when happy, drooping when not. A need that is running low is marked on its meter with a small flag as well as by colour.

Time passes while the app is closed. Doozer will have eaten from the bowl and slept, and it says hello when you come back.

## Focusing

On the Card, pick **15**, **25** or **50 minutes** and start. Doozer puts its glasses on, settles down and stays quiet until you are done. You can pause, resume or stop at any time.

- A finished session earns treats: 1, 2 or 4, and one extra for the first session of the day.
- Days in a row with a session are your **streak**, shown on the Card with your best.
- Finished sessions slowly unlock small things: new snacks, new toys and two hats.

While nobody is looking the time left is shown in minutes; rest the pointer on it for the seconds.

## The four homes

Pick one in the menu or in the row of homes on the Card. Everything carries over, a running session included.

- **Pill.** A small pill docked to an edge of the screen. The least in the way.
- **Room.** A little framed room you can drag anywhere by its title bar. Click the bowl, the ball, the soap, the bed or lamp, the treat jar, the clock: each does what you would guess.
- **Island.** A soft 3D Doozer on a floating island, with no frame at all. Stroke it, press it, click it for a quick menu. Drag the island by the grip that appears at its top.
- **Desktop.** No window: Doozer stands on the taskbar and strolls about a little. Click it for the quick menu; drag it to carry it somewhere else. *Desktop activity* in Settings is how much it moves: Still, Calm or Lively.

## Settings

*Settings…* in the menu, or *Settings* at the bottom of the Card. Changes are saved as you make them.

| Setting | What it does |
|---|---|
| Colour | Peach, Mint, Lavender, Butter or Sky. |
| Hat | None, Nightcap or Bow, once unlocked. |
| Size | Small, Medium or Large, remembered for each home. |
| Pill position | Which edge the Pill docks to. |
| Desktop activity | Still, Calm or Lively. |
| Sound | Off unless you turn it on. A small set of soft sounds; one chime when a session ends. |
| When a focus session ends | Celebrate quietly, or open the Card. |
| Always on top | Whether Doozer stays above other windows. |
| Tuck away during fullscreen apps | On by default: Doozer hides while a game, a film or a presentation fills the screen, and comes back afterwards. |
| Start with Windows | Off by default. |
| Reduce motion | Follows Windows unless you choose. Doozer stops wandering and bouncing; nothing flies about. |
| Interface size | Normal, Large or Larger: everything, in every home. |

## Quitting

*Quit Doozer* in the menu or at the bottom of Settings. It saves first. Only one Doozer runs at a time; starting it again while it is running does nothing.

## Your pet's save

Doozer is one small file: `%APPDATA%\com.doozer.desktop\save.json`, with the previous save beside it as `save.bak.json`. To move Doozer to another PC, copy that folder. To start over with a new Doozer, quit and delete it.

## Updating and removing

**A newer version:** run its installer. It replaces the program and leaves your pet alone.

**Removing Doozer:** *Settings → Apps → Installed apps → Doozer → Uninstall*. The uninstaller has one tick box, *Also delete Doozer's save (your pet and its progress)*:

- **left unticked** (as it starts), your pet's save is kept, and installing Doozer again later finds it as you left it;
- **ticked**, the save is deleted too. That cannot be undone.

Either way the program, its shortcuts and its *Start with Windows* entry are removed.

## If something is odd

- **Doozer is nowhere to be seen.** A fullscreen app in front tucks it away; it returns when that app closes. Otherwise right-click the tray icon and pick a home.
- **Ctrl+Alt+D does nothing.** Another program has that shortcut. *Open Doozer's card* in the tray menu does the same.
- **It looks too small or too large.** *Size* for Doozer's home, *Interface size* for everything.
- **It moves too much, or too little.** *Desktop activity* and *Reduce motion*.
