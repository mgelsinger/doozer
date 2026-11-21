# Release: the installer, and how version 1.0.0 was checked

Phase 11 of [WORK_PLAN.md](../WORK_PLAN.md). What a person installing Doozer needs to know is in [user-guide.md](user-guide.md); this is for whoever builds it.

## In short

- **One file ships:** `Doozer_1.0.0_x64-setup.exe`, 1.7 MB. It installs for the current user only, with no administrator prompt, into `%LOCALAPPDATA%\Doozer` (4.1 MB installed), adds a Start menu entry and an entry under *Installed apps*, and nothing else.
- **The icon is Doozer** (it was Tauri's stock logo until now): the whole creature from 48 pixels up, a simplified face at tray sizes.
- **Uninstalling is clean, and the pet is the user's choice.** The uninstaller's one tick box, *Also delete Doozer's save (your pet and its progress)*, decides whether the save goes. Unticked, which is how it starts, the save stays and a later install finds the same Doozer. The *Start with Windows* entry and the browser's cache are removed either way.
- **Not signed, and no automatic updates.** Both depend on whether Doozer is shared (spec section 12, item 2, still open), and both can be switched on later without touching the app; section 5 says how.
- **Checked on this machine by script, no hand on the mouse:** install, run, a second copy, a save written, *Start with Windows* switched on in Settings, an update over a running copy, uninstall. All 44 checks pass, and the machine was left as it was found. Section 6.
- **Not checked, and needs a person:** the installer's own windows clicked through by hand, the tick box ticked, the icon in the real tray, a PC that is not this one. Section 7.

## 1. Building it

From the `app` folder:

```
pwsh scripts/build-release.ps1
```

It runs the type-check and both test suites, builds the page into a new folder, compiles the shell around it and has Tauri bundle the result. Output: `src-tauri/target/release/bundle/nsis/Doozer_<version>_x64-setup.exe`, with its size and SHA-256 printed. `-NoTests` skips the tests.

The first build on a machine fetches the installer maker (NSIS 3.13, and Tauri's helper library for it) from Tauri's releases on GitHub into `%LOCALAPPDATA%\tauri`. That is Tauri's doing and needs the network once. It happened on this machine during this phase.

`npm run tauri build` makes the same installer, with one risk the script avoids: the shell embeds the page when it is compiled, and a changed page in an unchanged folder has been silently left out before. To see which page a running copy carries, start it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9230` and ask: `node scripts/ask-page.mjs --port 9230 --eval "document.documentElement.dataset.version"`.

### The version

It is written in three places, and a native test (`the_version_is_the_same_everywhere`) fails if they differ:

| File | Read by |
|---|---|
| `app/package.json` | the page (stamped on its `<html>` tag as it is built) |
| `app/src-tauri/tauri.conf.json` | the installer, *Installed apps* |
| `app/src-tauri/Cargo.toml` | the program's own properties, the tray icon's tooltip ("Doozer 1.0.0") |

### The icon

Two drawings in `app/assets/icon/`, both made from the 2D rig's own shapes in the Peach palette:

- `doozer.svg`: the whole creature. Used from 48 pixels up.
- `doozer-small.svg`: the same creature without arms, feet and tail, with a heavier outline and bigger eyes and cheeks. Used at 16 to 40 pixels, where the whole one turns into a peach smudge.

`node scripts/make-icons.mjs` builds every file in `src-tauri/icons/` from them. The 32-pixel layer is written first in `icon.ico` because the shell takes the first layer for the tray icon.

![Every layer of the icon at its true size and enlarged, on a dark and a light taskbar colour: 16, 20, 24, 32 and 40 pixels from the small drawing; 48, 64 and 256 from the whole one](screenshots/release-icon.png)

### The third-party notices

`src-tauri/installer/THIRD-PARTY-NOTICES.txt` is installed beside the program. It carries the licences of what is inside it: the Fredoka typeface (SIL Open Font License), three.js (MIT), Tauri's script library, and the 224 Rust libraries a Windows build links, each with its authors' own licence text (97 different texts; where a library offers a choice, the MIT one). Five of those libraries are under the Mozilla Public License 2.0, used unchanged; the file says where their source is. `node scripts/make-notices.mjs` writes it; run it again whenever a dependency changes.

Doozer itself has no licence yet. That is the owner's to choose before sharing the source; the installer shows no licence page.

## 2. What the installer does

| | |
|---|---|
| Kind | NSIS, built by Tauri's bundler; settings in `tauri.conf.json` under `bundle` |
| For whom | The current user only. No administrator rights, no prompt from Windows |
| Where | `%LOCALAPPDATA%\Doozer`: `doozer.exe`, `uninstall.exe`, `THIRD-PARTY-NOTICES.txt` |
| Shortcuts | Start menu; a desktop shortcut if the box on the last page is left ticked (a silent install, `/S`, always makes one unless `/NS` is given) |
| Listed as | *Doozer*, version 1.0.0, publisher *Doozer*, under *Installed apps* |
| Language | English |
| Does not | Start Doozer with Windows (that is a setting in the app, off by default); write a save; need the network on Windows 11 |
| Over an older copy | Closes a running Doozer, replaces the program, leaves the save and the settings alone |
| WebView2 | Windows 11 has it. On a Windows 10 PC without it, the installer fetches Microsoft's small bootstrapper and runs it; that is the only time anything is downloaded |

A running Doozer is closed by the installer and by the uninstaller without being asked to save first. Nothing is lost by that: anything that happened is written within half a second of happening, the file is replaced in one step so it is never half-written (`save.rs`, and the kill tests there), and the time that passed is worked out again from the clock on the next start.

When a newer installer finds an older Doozer and is run by hand, its second page offers *Uninstall before installing* (the first choice) or *Do not uninstall*. Both keep the save. The first runs the old uninstaller in full, which takes the *Start with Windows* entry out; Doozer puts it back the next time it starts, because the setting is in the save and the app brings the registry in line with it at every start.

## 3. What the uninstaller does

| | Box unticked (the default) | Box ticked |
|---|---|---|
| The program, its shortcuts, its *Installed apps* entry | removed | removed |
| The *Start with Windows* entry | removed | removed |
| The browser's cache, `%LOCALAPPDATA%\com.doozer.desktop\` | removed | removed |
| The save, `%APPDATA%\com.doozer.desktop\` | **kept** | deleted |

Most of that is Tauri's own uninstaller. Three things are Doozer's:

- **The wording** (`src-tauri/installer/English.nsh`). Tauri's tick box says *Delete the application data*, which leaves a person guessing whether that means their pet. Doozer's says *Also delete Doozer's save (your pet and its progress)*. And where Tauri's messages about a running copy say "Click OK to kill it", Doozer's say "close": the pet never dies, the installer included. The file is Tauri's own with those four lines changed; after upgrading Tauri, compare the two in case Tauri's has gained a line (the file's header says how).
- **The browser's cache goes even when the save is kept** (`src-tauri/installer/hooks.nsh`). Tauri removes it only with the box ticked. It holds nothing of the pet (the page keeps nothing there); it is some tens of megabytes of WebView2's own files.
- **Start with Windows.** Tauri's uninstaller removes the value named after the product from the user's Run key. That is the name Doozer's own code writes (`autostart.rs`), which is why uninstalling takes the entry away; a native test keeps the two names the same.

None of it is touched when the updater of a later version runs the old uninstaller on the way to an update. Native tests keep the hook away from the save's folder and the wording free of "kill".

A silent uninstall (`uninstall.exe /S`) cannot tick the box, so it always keeps the save.

## 4. What changed in the app for this

Almost nothing, on purpose: the build that was measured and checked in Phase 10 is the build that ships.

- The tray icon's tooltip says the version.
- The page carries its version on its `<html>` tag, for the check in section 1.
- Four native tests (the version, the Run key's name, the uninstall hook, the wording), and two repairs to older ones. The *Start with Windows* tests shared a scratch registry key that the last test to finish removed, and now and then one test removed it while another was creating its own key inside it (seen once in this phase; each test's key now stands by itself). The save tests no longer leave their scratch folders in the temp directory, a leftover noted in Phase 10.

## 5. Decisions, and how to change them

**Code signing: not signed.** A certificate costs money every year and is issued to a named person or company, so it is the owner's to buy, and only worth buying if Doozer is shared. Unsigned, the installer works; on somebody else's PC Windows SmartScreen will show "Windows protected your PC" until *More info → Run anyway* is chosen, and some antivirus programs are wary of any unsigned installer. To sign later: put the certificate's thumbprint in `bundle.windows.certificateThumbprint` (with `digestAlgorithm` and `timestampUrl`), or a signing command in `bundle.windows.signCommand`, and build again. Nothing in the app changes.

**Automatic updates: none.** Doozer makes no network request of its own (the only `fetch` in the page loads the 3D model from inside the program), which is part of being small and polite, and an updater needs three things that do not exist yet: somewhere to publish releases, a signing key kept safe, and a decision that Doozer is shared. A new version is installed by running its installer; it replaces the program and keeps the pet (checked, section 6). To add an updater later: Tauri's updater plugin, a key pair made with `tauri signer generate`, and an address in `plugins.updater.endpoints`.

**For the current user only.** No administrator prompt, and each Windows user gets their own Doozer, which matches the save being per user. `bundle.windows.nsis.installMode` is the switch.

**WebView2 is fetched only if missing.** The alternative, carrying Microsoft's offline installer inside ours, adds about 130 MB to spare the rare Windows 10 PC a download. `bundle.windows.webviewInstallMode`.

**English only.** The app has no other language either.

**The identifier stays `com.doozer.desktop`**, as settled in Phase 6: it names the save's folder.

## 6. What was checked, and how

### The installer

`pwsh scripts/run-install-checks.ps1` does the following with the real installer in the real places, silently and without the mouse. It refuses to start on a machine that already has a Doozer installed, running or saved, because it would be handling somebody's pet; this machine had none (the owner has not yet kept a Doozer in a release build). It asks the installed program's page questions over the browser's debugging port, and presses the Card's and the Settings panel's own buttons through the page. The installed Doozer was on screen for about half a minute in all.

| Step | What was checked | Result |
|---|---|---|
| Install (`/S`) | Finishes without an error, in under a second. Program, uninstaller and notices in `%LOCALAPPDATA%\Doozer`; Start menu shortcut; listed under *Installed apps* as Doozer 1.0.0; the program's own properties say 1.0.0. Installing does not register it to start with Windows, writes no save, and does not start it | 12 of 12 |
| The installed program | Starts; the page inside it is 1.0.0; no save, so a new Doozer; a second copy leaves by itself; the bowl filled from the Card and the save written to `%APPDATA%\com.doozer.desktop`; *Start with Windows* switched on in Settings: registered with the installed program's path and kept in the save | 9 of 9 |
| Install again while it runs | The running copy is closed; the program replaced; the save byte for byte the same; *Start with Windows* still registered; it starts again, finds the same Doozer with its bowl still full, and knows it is registered; it quits when asked | 9 of 9 |
| Uninstall (`/S`) | Program, folder, Start menu and desktop shortcuts, *Installed apps* entry, *Start with Windows* entry and the browser's cache all gone; **the save still there, unchanged** | 8 of 8 |
| The tick box, read from the installer's script | Data is deleted only when the box is ticked; what is deleted then is the save's folder, by the identifier; the Run key value is removed by the product's name; the box is worded for a pet; nothing the installer says speaks of killing | 6 of 6 |

Afterwards the script removes the save the test pet made, so the owner's first start is still a first start. One thing did not come back: the browser's cache folder that earlier test runs of the plain build had left in `%LOCALAPPDATA%\com.doozer.desktop` went with the uninstall, as it is meant to. The next start makes a new one.

One mistake of the check's own is worth keeping, because it shows something true about the app. The first version switched *Start with Windows* on by asking the shell directly. At its next start the app took the entry out again: the setting in the save said off, and the app brings the registry in line with the setting at every start. The check now flips the switch in Settings, as a person would.

### The app, again

The installer carries the plain release build of this commit. The scripted checks of every view need the test hooks, so they were run on a build of the same commit with the hooks in (`scripts/build-polish-checks.ps1 -Label final`), cloaked and with injected input:

| Set | What it covers | Result |
|---|---|---|
| The app and the Pill | A first day, a second day, never stuck, the window | 4 of 4 |
| The Room | The furniture, an hour alone, switching views mid-session, reopening, the window, never stuck | 6 of 6, after the repair described below |
| The Island | Hello, never stuck, the window, a focus session, the still pictures | 5 of 5 |
| The Desktop | Never stuck (twenty minutes of interruptions), the click-through probes | 2 of 2 |
| Polish | Reduce motion in every view, the interface size in every view, the keyboard way into the Card in each of the four | 6 of 6 |
| The Desktop soak | Fifteen minutes of random actions with hands-off checks (Phase 10 ran it for an hour on a build whose app code is the same) | ok |

**The Room's ball check failed twice on the way, and both times it was the check.** The ball game is three kicks, each 90 to 150 px by chance, with Doozer trotting to 30 px short of where the ball lands. The check asked for two things that are only likely:

- Doozer already trotting a twentieth of a second after the click. When the first toss lands 30 px beyond where Doozer stands, the first leg is no distance at all, and Doozer waits for the ball without taking a step: about one game in fifteen. The report of the failed run fits that to the pixel, and shows the rest of the game played correctly (Fun up by exactly 28, the ball moved, Doozer at rest afterwards).
- Doozer getting more than 40 px away from where it started. In one run the tosses fell close and it read 35.

It now watches from the click until the scene ends and asks for what the game guarantees: the scene is "play", Doozer trots in it, the ball ends somewhere new, and Doozer covers at least 60 px of floor (the second and third legs are never under 30 px each, whatever the dice say). With that, the furniture check passed 8 times in 8 and the Room's set 6 of 6. Phases 7 and 10 had simply been lucky with it.

The other four sets and the soak were run on the build before that repair. It differs from the final one only in the Room check's own file.

**The tests:** 1,139 page tests in 53 files and 60 native tests (one more is the kill test's helper, ignored by design), three rounds in a row, all passing; in one round both suites ran at the same time to load the machine. Type-check clean. The save tests leave nothing in the temp folder now, and the native tests no registry key.

**The installer that was checked** was built from commit `4e35164` (later commits change documents only). SHA-256 `486ca55445929ddcd10ff28527f55bca6e852ee912e44550d51589a03d7afd34`. A rebuild will not give the same hash: the build stamps the time.

## 7. Not verified: needs a person

1. **The installer by hand.** Double-click `Doozer_1.0.0_x64-setup.exe` and walk through its pages; look at the icon on the installer, in the Start menu, in *Installed apps* and above all **in the tray**, at this screen's 150 %. The tray icon was judged from enlarged pictures of its 16, 20, 24 and 32 pixel layers, not on a real taskbar. The installer's pages were never on screen: every run was silent.
2. **The tick box.** Uninstall from *Settings → Apps* twice: once leaving *Also delete Doozer's save* unticked (install again: the same Doozer is back), once ticking it (install again: a new Doozer, and the first-run question about sound). Check that the box's label is not cut short. The unticked path is checked by script; the ticked one is only read from the installer's script.
3. **Another PC.** Windows SmartScreen on a machine that did not build the file; a Windows 10 PC; a PC without WebView2 (the installer should fetch it). None of these could be tried here.
4. **Start with Windows, for real.** Switch it on in Settings, sign out and in, and see Doozer arrive without taking the keyboard. The script proves the entry is written with the installed path and removed on uninstall, not that Windows acts on it.
5. Everything the earlier phases left for the owner still stands: section 16 of [polish-checks.md](polish-checks.md), section 9 of [desktop-checks.md](desktop-checks.md), section 10 of [island-checks.md](island-checks.md).

## 8. Releasing a newer version

1. Change the version in the three files of section 1 (the native test says so if one is missed).
2. If a dependency changed: `node scripts/make-notices.mjs`.
3. `pwsh scripts/build-release.ps1`.
4. On a machine with no Doozer on it: `pwsh scripts/run-install-checks.ps1`. On the owner's own machine, once a pet lives there, the script refuses to run: install by hand instead. The installer keeps the save.
5. Tag the commit `v<version>`.
