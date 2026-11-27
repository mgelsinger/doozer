# Release: the installer, and how version 1.1.0 was checked

Phase 11 of [WORK_PLAN.md](../WORK_PLAN.md), brought up to version 1.0.1 (2026-11-20 and 21), the first public release, and then to **1.1.0 (2026-11-23), which adds a Frame rate setting**. **1.1.0 was published on 2026-11-27: section 10.** What a person installing Doozer needs to know is in [user-guide.md](user-guide.md); this is for whoever builds it. What each version changed is section 4.

## In short

- **One file ships:** `Doozer_1.1.0_x64-setup.exe`, 1.7 MB. It installs for the current user only, with no administrator prompt, into `%LOCALAPPDATA%\Doozer` (4.1 MB installed), adds a Start menu entry and an entry under *Installed apps*, and nothing else.
- **The icon is Doozer:** the whole creature from 48 pixels up, a simplified face at tray sizes.
- **Uninstalling is clean, and the pet is the user's choice.** The uninstaller's one tick box, *Also delete Doozer's save (your pet and its progress)*, decides whether the save goes. Unticked, which is how it starts, the save stays and a later install finds the same Doozer. Everything else goes either way: the program, its shortcuts, the *Start with Windows* entry, the browser's cache, and (new in 1.0.1) the installer's own key in the registry.
- **The page runs under a content security policy** (new in 1.0.1): nothing but the app's own files and its own shell. Section 5.
- **A public release of the installer.** Unsigned, no automatic updates; a short licence installed beside the program (free to use and to pass on unchanged, no warranty). Decided by Claude on the owner's delegation, 2026-11-20; section 6. **Since 2026-11-27 the repository is public too**, at the owner's word, with the installer under its releases, **and its code is under the MIT licence**, the creature and the name reserved. Whether it is ready to go up is section 10, *Ready to publish*.
- **1.1.0 adds one setting, Frame rate:** Light (the default, 1.0.1 unchanged), 30, 60, 120 or 144 pictures a second. Higher rates cost more processor time while Doozer moves; section 4.
- **Checked on this machine without a hand on the mouse, for 1.1.0:**
  - the installer and the uninstaller **page by page, on screen**, with a picture of every page, both ways through the tick box (38 checks);
  - install, run, a second copy, a save, *Start with Windows* from Settings, an update over a running copy, uninstall, silently (49 checks); and 1.0.1 with a pet and settings updated to 1.1.0, both kept, and the new setting at Light and then chosen (18 checks);
  - no personal details in anything that ships, and nothing found by Windows Defender;
  - every view's scripted checks, the never-stuck pass at 144, the polish set and an hour's Desktop soak on a build of the same commit with the test hooks, each of them failing if the policy refuses anything. The keyboard way into the Card could not be checked by that script on 2026-11-23; **on 2026-11-26 the real Ctrl+Alt+D was pressed at the program that ships, in all four views, and took the keyboard in each** (section 7). Sections 7 and 10.
- **Not checked by a person, and accepted as such:** the icon in the real tray, a PC that is not this one, a monitor that is awake and not 120 Hz, and how each frame rate looks. Section 8.

## 1. Building it

From the `app` folder:

```
pwsh scripts/build-release.ps1
```

It runs the type-check and both test suites, builds the page into a new folder, compiles the shell around it and has Tauri bundle the result. Output: `src-tauri/target/release/bundle/nsis/Doozer_<version>_x64-setup.exe`, with its size and SHA-256 printed. `-NoTests` skips the tests.

The first build on a machine fetches the installer maker (NSIS 3.13, and Tauri's helper library for it) from Tauri's releases on GitHub into `%LOCALAPPDATA%\tauri`. That is Tauri's doing and needs the network once. It happened on this machine during Phase 11.

`npm run tauri build` makes the same installer, with one risk the script avoids: the shell embeds the page when it is compiled, and a changed page in an unchanged folder has been silently left out before. To see which page a running copy carries, start it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9230` and ask: `node scripts/ask-page.mjs --port 9230 --eval "document.documentElement.dataset.version"`.

### The version

It is written in three places, and a native test (`the_version_is_the_same_everywhere`) fails if they differ:

| File | Read by |
|---|---|
| `app/package.json` | the page (stamped on its `<html>` tag as it is built) |
| `app/src-tauri/tauri.conf.json` | the installer, *Installed apps* |
| `app/src-tauri/Cargo.toml` | the program's own properties, the tray icon's tooltip ("Doozer 1.1.0") |

### The icon

Two drawings in `app/assets/icon/`, both made from the 2D rig's own shapes in the Peach palette:

- `doozer.svg`: the whole creature. Used from 48 pixels up.
- `doozer-small.svg`: the same creature without arms, feet and tail, with a heavier outline and bigger eyes and cheeks. Used at 16 to 40 pixels, where the whole one turns into a peach smudge.

`node scripts/make-icons.mjs` builds every file in `src-tauri/icons/` from them. The 32-pixel layer is written first in `icon.ico` because the shell takes the first layer for the tray icon.

![Every layer of the icon at its true size and enlarged, on a dark and a light taskbar colour: 16, 20, 24, 32 and 40 pixels from the small drawing; 48, 64 and 256 from the whole one](screenshots/release-icon.png)

### The third-party notices

`src-tauri/installer/THIRD-PARTY-NOTICES.txt` is installed beside the program. It carries the licences of what is inside it: the Fredoka typeface (SIL Open Font License), three.js (MIT), Tauri's script library, and the 224 Rust libraries a Windows build links, each with its authors' own licence text (97 different texts; where a library offers a choice, the MIT one). Five of those libraries are under the Mozilla Public License 2.0, used unchanged; the file says where their source is. `node scripts/make-notices.mjs` writes it; run it again whenever a dependency changes.

### Doozer's own licence

`src-tauri/installer/LICENSE.txt` is installed beside the program too. It is short and plain: Doozer may be used for free and passed on unchanged, it may not be sold or passed on changed, and it comes with no warranty. The copyright is "the author of Doozer": nobody is named, in it or anywhere else that ships (section 10 says how that was checked). The installer shows no licence page, so nothing has to be accepted to install it. A native test keeps the file shipping, keeps the installer free of a licence page and keeps the wording.

These are the terms of the program as the author publishes it. The code it is built from has its own, wider licence since 2026-11-27 (MIT; section 6, *The source*), and this file was left as it is: the published installer carries it, and it could not point at the repository without naming the owner's account.

## 2. What the installer does

| | |
|---|---|
| Kind | NSIS, built by Tauri's bundler; settings in `tauri.conf.json` under `bundle` |
| For whom | The current user only. No administrator rights, no prompt from Windows |
| Where | `%LOCALAPPDATA%\Doozer`: `doozer.exe`, `uninstall.exe`, `LICENSE.txt`, `THIRD-PARTY-NOTICES.txt` |
| Shortcuts | Start menu; a desktop shortcut if the box on the last page is left ticked (a silent install, `/S`, always makes one unless `/NS` is given) |
| Listed as | *Doozer*, version 1.1.0, publisher *Doozer*, under *Installed apps* |
| Language | English |
| Does not | Start Doozer with Windows (that is a setting in the app, off by default); write a save; need the network on Windows 11 |
| Over an older copy | Closes a running Doozer, replaces the program, leaves the save and the settings alone |
| WebView2 | Windows 11 has it. On a Windows 10 PC without it, the installer fetches Microsoft's small bootstrapper and runs it; that is the only time anything is downloaded |

A running Doozer is closed by the installer and by the uninstaller without being asked to save first. Nothing is lost by that: anything that happened is written within half a second of happening, the file is replaced in one step so it is never half-written (`save.rs`, and the kill tests there), and the time that passed is worked out again from the clock on the next start.

**Its pages**, as they came up on this screen (section 7 says how they were walked). A first install is four pages: welcome, the folder, the copying, and a last page with two tick boxes, *Run Doozer* and *Create desktop shortcut*, both ticked as they come. With Doozer already installed there is one more, *Already Installed*; and if Doozer is running when the files are about to be replaced, a message says so and offers to close it.

![The installer's pages: a first install (four pages), and the installer run again with Doozer installed and running (six, among them "Already Installed" and the message that Doozer is running)](screenshots/release-installer-pages.png)

Two things in those pictures are Tauri's and NSIS's own and were left: the blue artwork down the side of the first and last page, and the words *Add/Reinstall components* on the *Already Installed* page. A side picture of Doozer's own would go in `bundle.windows.nsis.sidebarImage` (a 164 by 314 bitmap); nobody has drawn one.

When a newer installer finds an older Doozer and is run by hand, its second page offers *Uninstall before installing* (the first choice) or *Do not uninstall*. Both keep the save. The first runs the old uninstaller in full, which takes the *Start with Windows* entry out; Doozer puts it back the next time it starts, because the setting is in the save and the app brings the registry in line with it at every start.

## 3. What the uninstaller does

| | Box unticked (the default) | Box ticked |
|---|---|---|
| The program, its shortcuts, its *Installed apps* entry | removed | removed |
| The *Start with Windows* entry | removed | removed |
| The browser's cache, `%LOCALAPPDATA%\com.doozer.desktop\` | removed | removed |
| The installer's own key, `HKCU\Software\Doozer\Doozer` (and `HKCU\Software\Doozer` if nothing else is in it) | removed (**1.0.0 left it**) | removed |
| The save, `%APPDATA%\com.doozer.desktop\` | **kept** | deleted |

![The uninstaller's two pages, with the box left unticked and with it ticked](screenshots/release-uninstaller-pages.png)

Most of that is Tauri's own uninstaller. Four things are Doozer's:

- **The wording** (`src-tauri/installer/English.nsh`). Tauri's tick box says *Delete the application data*, which leaves a person guessing whether that means their pet. Doozer's says *Also delete Doozer's save (your pet and its progress)*. And where Tauri's messages about a running copy say "Click OK to kill it", Doozer's say "close": the pet never dies, the installer included. The file is Tauri's own with those four lines changed; after upgrading Tauri, compare the two in case Tauri's has gained a line (the file's header says how).
- **The browser's cache goes even when the save is kept** (`src-tauri/installer/hooks.nsh`). Tauri removes it only with the box ticked. It holds nothing of the pet (the page keeps nothing there); it is some tens of megabytes of WebView2's own files.
- **The installer's own key goes too** (the same hook, new in 1.0.1). The installer notes the folder it installed into under `HKCU\Software\Doozer\Doozer`, so that the next install goes to the same place, and Tauri clears that only with the box ticked. So 1.0.0 left the key behind on every ordinary uninstall. The hook removes it, and its parent only if empty, exactly as Tauri's own lines do when the box is ticked. An update loses nothing by it: the installer reads the folder from the key before it runs the old uninstaller.
- **Start with Windows.** Tauri's uninstaller removes the value named after the product from the user's Run key. That is the name Doozer's own code writes (`autostart.rs`), which is why uninstalling takes the entry away; a native test keeps the two names the same.

Neither of the hook's two removals happens when a later version's updater runs the old uninstaller on the way to an update: then the program is coming straight back and wants both. Native tests keep the hook away from the save's folder, keep everything it removes inside that one "not an update" test, keep the parent key's removal to "only if empty", and keep the wording free of "kill".

A silent uninstall (`uninstall.exe /S`) cannot tick the box, so it always keeps the save.

The uninstaller copies itself into the temp folder to do its work (`~nsu1.tmp\Un.exe` and so on), and Windows removes the copy at the next restart. That is how NSIS works; the check scripts remove the copies they cause.

## 4. What changed in the app

**For 1.0.0, almost nothing, on purpose**: the build that was measured and checked in Phase 10 was the build that shipped. The tray icon's tooltip says the version; the page carries its version on its `<html>` tag, for the check in section 1; and the native tests gained four (the version, the Run key's name, the uninstall hook, the wording) and two repairs. The *Start with Windows* tests shared a scratch registry key that the last test to finish removed, and now and then one test removed it while another was creating its own key inside it; each test's key now stands by itself. The save tests no longer leave their scratch folders in the temp directory.

**1.0.1** is seven things asked for, four in the app and three in the release. Six were done; one (the second) could not be met:

| | What | Where it is written up |
|---|---|---|
| 1 | A content security policy, where there was none | Section 5 |
| 2 | **Not met, and taken out again.** The frame clock was made to aim at whole refreshes on a screen 24 or 60 does not divide, so as not to ask for a frame and pass it over. It worked on every pretend screen and made pictures late on a real one. The clock is as it was in 1.0.0; the rhythm on such screens is now tested | [polish-checks.md](polish-checks.md), section 18.1 |
| 3 | The pet's clock ticks once a second, not four times, while nobody is at the window; a focus session ends within a hundredth of a second of its time | polish-checks.md, section 18.2 |
| 4 | The shell's "style repairs" were never repairs: the counter counted the shell's own catching up. Explained, counted apart, and a real repair now fails the soak | polish-checks.md, section 18.3 |
| 5 | The uninstaller removes the installer's own registry key | Section 3 |
| 6 | The installer's and uninstaller's pages walked on screen and pictured; the tick box run both ways for real | Section 7 |
| 7 | The owner's answer about sharing, written down | Section 6 |

Then the owner handed every open decision over ("Just do everything you need for any decisions that need to be made. Your choice, just test and make sure it's ready to go live."), and 1.0.1 became the public release. That brought: Calm strolling about every four minutes rather than every one to two ([polish-checks.md](polish-checks.md), section 18.4); the licence and a privacy section in the user guide; and the go-live checks of section 10. The decisions themselves are in section 6 and in the spec's section 13.

**1.1.0** is one thing the owner asked for: "30fps, 60fps, 120fps, 144fps should all be available." *Settings → Frame rate*: **Light** · 30 · 60 · 120 · 144 (`src/frames.ts`; the spec's section 9 and its amendment in section 13).

- **Light is the default and is 1.0.1 unchanged**: 24 pictures a second with nobody there, 60 with somebody. A save from 1.0.1 has no such setting and loads at Light; a bad value in a save is read as Light.
- **A number** is that rate all the time, and at least 60 with somebody there, up to what the screen shows. The Island's renderer, with its own lower caps, is lifted to it too.
- **What each costs**, Doozer walking about on the Desktop, on this machine: Light 19 % of one core, 30 22 %, 60 26 %, 120 32 %, 144 39 % (the screen drew 103 a second, so 120 and 144 drew the same pictures and the gap between them is noise); memory while moving goes over the 150 MB budget from 60 up. At rest the rate hardly matters, because almost nothing moves. [polish-checks.md](polish-checks.md), section 19. The settings row says "Smoother uses more of your PC", and the user guide says so too.
- Nothing else changed: the installer, the uninstaller, the policy and every other setting are 1.0.1's.

## 5. The content security policy

`"csp": null` until 1.0.1. The plan had put a policy in Phase 11 and it was missed. It is in `tauri.conf.json` (`app.security.csp`), and Tauri sends it as a header with the page and with the Island's frame:

| Directive | Allows | Why |
|---|---|---|
| `default-src 'none'` | nothing | Whatever is not named below is refused. This is what makes the rest a whitelist |
| `script-src 'self'` | the app's own script files | No script from a string (`eval`, `new Function`), no inline script, none from anywhere else. Tauri adds the hashes of its own start-up scripts |
| `style-src 'self'` | the app's own style sheets | Tauri adds a nonce for the one small style block in each of the two HTML files. A style sheet made by script is refused |
| `style-src-attr 'unsafe-inline'` | a `style` attribute on an element | **The one concession.** The rig and the Radial write their pivots as `style="--px:..."` in the markup they build, and without this the creature comes apart. It allows a style attribute and nothing else. Taking it out means moving those pivots out of the markup (`character/rig-markup.ts`, `ui/radial.ts`) |
| `img-src 'self'`, `font-src 'self'` | the app's own images and its one typeface | Not `data:`, not `blob:` |
| `connect-src 'self' ipc: http://ipc.localhost` | the app's own files (the 3D model) and the shell | The last two are Tauri's channel between the page and the shell. Nothing else can be fetched: the page cannot reach the network at all |
| `frame-src 'self'`, `frame-ancestors 'self'` | the Island's hidden frame, and only inside the app's own page | The 3D engine lives in that frame |
| `base-uri 'none'`, `form-action 'none'` | nothing | There is no use for either |

What needed nothing: WebGL, Web Audio (the sounds are made in the page, not loaded), the CSS variables and styles that script sets on elements directly.

**How it is known to work, and to refuse.**

- Asked of the running app (the Island view, where the most is loaded): the header is there on the page and on the frame; `eval`, `new Function`, an inline script, a style sheet made by script, a fetch from another site and an image from another site are each refused; the Island draws, the typeface is loaded, the shell answers.
- **Every scripted run now watches the policy** (`spike/config.ts`): it listens, in the page and in the Island's frame, for anything the policy refuses, and every check of a run in which something was refused fails, naming the directive and what was refused. On its first run this caught the Island's own checks loading a `data:` picture into an image to count painted pixels; the checks were changed to decode the picture without an image, and the policy was left alone. Nothing in the app itself was refused anything, in any view's checks or in the soak (section 7).
- A native test (`the_content_security_policy_is_there_and_has_not_been_loosened`) fails if the policy is taken out, if a directive appears that is not in its table, or if any directive allows more than the table says. Making the policy stricter passes.

**In development** (`npm run tauri dev`) the page comes from Vite's dev server, which puts its styles in the page by script and talks to it over a websocket. `devCsp` is the same policy with those two allowed. It was not tried with the dev server in this phase (that opens a window on the screen). If the dev server is refused something, loosen `devCsp`, never `csp`: the native test watches only the latter.

## 6. Decisions, and how to change them

**A public release of the installer, and since 2026-11-27 of the source as well.** On 2026-11-16 the owner said "I'll share it"; on 2026-11-20 they handed every open decision to Claude, and Claude decided on a public release: the installer is put up for anyone to download. Unsigned, with no updater, and at first with the source not published. The decisions, each recorded in the spec's section 13 as decided by Claude on the owner's delegation:

- **The terms:** the licence above, and a Privacy section in the user guide: Doozer collects nothing and makes no network requests.
- **Unsigned** and **no updater**: below. Both can be added later without touching the app.
- **The source: published on 2026-11-27.** Until then it was not; the repository holds the owner's working notes as well as the code. The owner, 2026-11-27: "lets just make the whole thing public", and the repository on GitHub is public: the code, the notes and the history. It went up with no licence to reuse or change the code (decided by Claude: publishing was asked for, a licence was not, and one cannot be taken back). Later the same day the owner chose one: "lets go with MIT, keep the art and name reserved". **The code is under the MIT licence** (`LICENSE` at the root, the plain MIT text so that GitHub recognises it). **The creature and the name are not** (`ARTWORK-AND-NAME.md` beside it): Doozer's design and likeness wherever it is drawn, its model, icons and pictures, and the name "Doozer" stay with the author, so something built from the code needs a creature and a name of its own. The program's own terms above are unchanged. Before it went public, every file, every picture and the whole history were searched for secrets, addresses and the machine's paths (work plan, log, 2026-11-27).

**The name.** The name "Doozer" and the identifier `com.doozer.desktop` stay. Be aware that the Jim Henson Company uses "Doozers": they are the small builder creatures of *Fraggle Rock*, and there has been a children's series called *Doozers*. Whether a free desktop pet of the same name is a problem is a question for someone qualified to answer it; this paragraph is not legal advice. What is certain is the cost of changing course: a rename is cheap before the first public upload (the name in a handful of files, and the identifier, which names the save's folder, before anyone has a save) and costly after it (every installed copy keeps its pet in the old folder, and the name is out in the world).

**Code signing: not signed.** A certificate costs money every year and is issued to a named person or company, so it is the owner's to buy, and only worth buying for a public release. Unsigned, the installer works; on somebody else's PC Windows SmartScreen will show "Windows protected your PC" until *More info → Run anyway* is chosen, and some antivirus programs are wary of any unsigned installer. To sign later: put the certificate's thumbprint in `bundle.windows.certificateThumbprint` (with `digestAlgorithm` and `timestampUrl`), or a signing command in `bundle.windows.signCommand`, and build again. Nothing in the app changes.

**Automatic updates: none.** Doozer makes no network request of its own (the only `fetch` in the page loads the 3D model from inside the program), which is part of being small and polite, and an updater needs three things that do not exist yet: somewhere to publish releases, a signing key kept safe, and a decision to release it publicly. A new version is installed by running its installer; it replaces the program and keeps the pet (checked, section 7). To add an updater later: Tauri's updater plugin, a key pair made with `tauri signer generate`, and an address in `plugins.updater.endpoints`.

**For the current user only.** No administrator prompt, and each Windows user gets their own Doozer, which matches the save being per user. `bundle.windows.nsis.installMode` is the switch.

**WebView2 is fetched only if missing.** The alternative, carrying Microsoft's offline installer inside ours, adds about 130 MB to spare the rare Windows 10 PC a download. `bundle.windows.webviewInstallMode`.

**English only.** The app has no other language either.

**The identifier stays `com.doozer.desktop`**, as settled in Phase 6 and again for the public release: it names the save's folder.

## 7. What was checked, and how

Everything in this section is version 1.1.0, checked on 2026-11-23. The final installer was built from commit `9ed8aef`, and the app's own checks were run on a build of the same commit with the test hooks; the commits after it change only documents and one step of the update check's own script (below). The installer's pages were walked on that same final installer. How 1.0.1 was checked is at the end of the section.

### The pages, on screen

`pwsh scripts/run-install-pages.ps1 -Out <folder>` walks the installer and the uninstaller as a person would, page by page, and takes a picture of each (the two sheets in sections 2 and 3 are its pictures).

- **Never the real pointer, never a key.** Each button is pressed by sending its dialog the message a press sends ("this button was clicked"), and a tick box is set by the message that sets one. UI Automation's Invoke and Toggle patterns were the intended way; UI Automation finds these controls but offers neither pattern for them (tried from both PowerShells), and for a Windows button Invoke comes down to that same message.
- **The pictures are taken with PrintWindow**, which asks a window to draw itself, so they are right whatever is in front.
- **It waits for a quiet machine**: a minute with no input and no fullscreen app in front before it puts a window on the screen, and again before each further one. When it ran, nobody had touched the machine for more than a day.
- **It touches only its own windows**: dialogs titled *Doozer Setup* or *Doozer Uninstall* that belong to the installer it started or to the uninstaller's own copy of itself (known by where the copy is and by its being a file of the product "Doozer"). Anything else on screen is left alone, and only processes it started are ever ended.
- It measures every tick box's and choice's label against the room it has: **none is cut short** (the longest, the uninstaller's box, needs 438 pixels and has 600).
- Like the silent check it refuses to start where a Doozer is installed, running or saved.

| Step | What was checked | Result |
|---|---|---|
| A first install, four pages | Walked to its end; the program installed, in the Start menu, listed as 1.1.0; with *Run Doozer* unticked on the last page it is not started | 5 of 5 |
| The installed program | Starts; the page inside it is 1.1.0; the bowl filled from the Card; the save written | 4 of 4 |
| The installer again, Doozer installed and running, six pages | The *Already Installed* page shown; the message that Doozer is running shown, and it says "Doozer is running. Click OK to close it and carry on. Nothing is lost: it saves as it goes."; the running copy closed; the save untouched | 6 of 6 |
| Uninstall through the pages, **the box left as it comes** | One tick box, with Doozer's wording, unticked; the program, shortcuts, *Installed apps* entry, installer's key and browser's cache gone; **the save still there, byte for byte** | 10 of 10 |
| Install again | **The same Doozer is back**: born at the same moment, its bowl still full | 3 of 3 |
| Uninstall through the pages, **the box ticked** | The box ticked; the program gone; **the save gone**; the cache and the installer's keys gone | 6 of 6 |
| Install again | **No save: a new Doozer hatches.** Then uninstalled, and nothing left | 4 of 4 |

38 of 38, 14 pages pictured, on the 1.1.0 installer as on 1.0.1's; the pages are the same but for the version. (The two sheets in sections 2 and 3 are 1.0.1's pictures; the 1.1.0 ones are under `target/polish/final11/pages`, which git does not keep.)

A first trial of the script, against the 1.0.0 installer, left two of the uninstaller's windows open on the screen for some minutes: it did not recognise the uninstaller's copy of itself as its own and so, rightly, did not touch it. They were closed and the rule that recognises the copy was written from what was found.

### The installer, silently

`pwsh scripts/run-install-checks.ps1` does the following with the real installer in the real places, silently. It asks the installed program's page questions over the browser's debugging port, and presses the Card's and the Settings panel's own buttons through the page.

| Step | What was checked | Result |
|---|---|---|
| Install (`/S`) | Finishes without an error, in under a second. Program, uninstaller, licence and notices in `%LOCALAPPDATA%\Doozer`; Start menu shortcut; listed under *Installed apps* as Doozer 1.1.0; the program's own properties say 1.1.0; the installer's note of its folder is in the registry. Installing does not register it to start with Windows, writes no save, and does not start it | 14 of 14 |
| The installed program | Starts; the page inside it is 1.1.0; no save, so a new Doozer; a second copy leaves by itself; the bowl filled from the Card and the save written to `%APPDATA%\com.doozer.desktop`; *Start with Windows* switched on in Settings: registered with the installed program's path and kept in the save | 9 of 9 |
| Install again while it runs | The running copy is closed; the program replaced; the save byte for byte the same; *Start with Windows* and the note of the folder still there; it starts again, finds the same Doozer with its bowl still full, and knows it is registered; it quits when asked | 10 of 10 |
| Uninstall (`/S`) | Program, folder, Start menu and desktop shortcuts, *Installed apps* entry, *Start with Windows* entry, the browser's cache, **the installer's key and its parent** all gone; **the save still there, unchanged** | 10 of 10 |
| The tick box, read from the installer's script | Data is deleted only when the box is ticked; what is deleted then is the save's folder, by the identifier; the Run key value is removed by the product's name; the box is worded for a pet; nothing the installer says speaks of killing | 6 of 6 |

49 of 49 on the final installer, 4.1 MB installed (the licence file is the forty-ninth). Both scripts remove the save their test pets made, so the owner's first start is still a first start, and the machine was checked afterwards: nothing installed, no save, no key, no shortcut, nothing running, none of the uninstaller's copies in the temp folder. (The copy of the installer's key that the 1.0.0 checks had left on this machine was removed by hand, after seeing that it was the only Doozer key there, that it held the install folder and that nothing was installed.)

One mistake of the check's own is worth keeping, because it shows something true about the app. Its first version switched *Start with Windows* on by asking the shell directly. At its next start the app took the entry out again: the setting in the save said off, and the app brings the registry in line with the setting at every start. The check flips the switch in Settings, as a person would.

### The app

The scripted checks of every view need the test hooks, so they were run on a build of the same commit with the hooks in (`scripts/build-polish-checks.ps1 -Label final11`), cloaked and with injected input, at the default rate unless said. Every one of them also fails if the content security policy refuses anything during the run.

| Set | What it covers | Result on the final 1.1.0 build |
|---|---|---|
| The app and the Pill | A first day, a second day, never stuck, the window | 4 of 4 |
| The Room | The furniture, an hour alone, switching views mid-session, reopening, the window, never stuck | 6 of 6 |
| The Island | Hello, never stuck (a lost graphics context among it), the window, a focus session, the still pictures | 5 of 5 |
| The Desktop | Never stuck (twenty minutes of interruptions), the click-through probes | 2 of 2 |
| **The Desktop at 144**, the highest rate | Never stuck, the same twenty minutes | 1 of 1 |
| Polish | Reduce motion in every view, the interface size in every view | 2 of 2 |
| Polish: **the keyboard way into the Card**, each of the four views | On 2026-11-23 the Card opened from the shortcut, but the window in front kept the keyboard: failed in all four, and on the 1.0.1 build too, straight after. **On 2026-11-26 checked again, and with real key presses** | passed, with one part of the Room not reached (below) |
| **The Desktop soak, a full hour** | Random actions with hands-off checks between; nothing rescued, no style repairs | ok |
| The content security policy, in all of those runs | Nothing refused | 0 |

**The keyboard check.** It had passed on 1.0.1 on 2026-11-21. This time the owner had been away for more than a day, the monitor was asleep, and the window in front was another program's that nobody had touched in all that time; Windows let neither build take the keyboard from it. 1.0.1, which passed before, failed in the same way at the same hour, and 1.1.0 changes nothing on that path, so this is the machine's state and not a change in Doozer; but it is not a pass, and it is recorded as not checked for 1.1.0. Run `run-polish-checks.ps1 -Only app-polish-keyboard` again with the monitor awake. ([polish-checks.md](polish-checks.md), section 19.)

**The keyboard check again, 2026-11-26.** With the owner at the machine and the monitor awake, the script passed in the Pill and the Room on a quiet machine, and failed in the Island and the Desktop when it was made to run while the owner was typing in a browser. The reason is the check's own: a test run does not register the shortcut, so the script calls the shortcut's handler with no key press behind it, and without a key press Windows decides for itself whether a program may take the keyboard (not while somebody is typing elsewhere, and not on 2026-11-23, after a day with nobody there). So a new script, `scripts/run-hotkey-check.ps1`, presses the real Ctrl+Alt+D at the program that ships. **In all four views the window took the keyboard at once, with the focus on *Feed*, while the owner was working in a browser.** In the Pill, the Island and the Desktop, Escape then closed the Card and the keyboard went back to the same browser window. In the Room the owner's own mouse click took the keyboard back each time before Escape was pressed, as a click should; the Room's Escape passed in the scripted check. ([polish-checks.md](polish-checks.md), section 20.)

**What failed on the way, and was the check:** the update check's new Frame rate step found the Settings row before its buttons were drawn, and read it after the panel had folded itself away. It now waits for the buttons and reads the choice back at once; the app was right both times (the pet, the settings and the save were all as they should be).

**The tests:** 1,199 page tests in 53 files and 64 native tests, type-check clean: three rounds on the final code, the third inside the release build.

### Version 1.0.1, for the record

1.0.1 was checked on 2026-11-20 and 21, from commit `4f4e4b0` (its pages on the `596f24d` installer, which differed only in the licence file): the pages 38 of 38, the silent install 49 of 49, 1.0.0 updated to it 16 of 16, the Pill 4 of 4, the Room 6 of 6, the Island 5 of 5, the Desktop 2 of 2, the polish set 6 of 6 (the keyboard way in passing in all four views, with the owner's screen unlocked and idle a minute), an hour's soak (1,730 random actions; 44 hands-off checks, every one finding Doozer at rest; of the window's style, 745 flips, 8 catch-ups and 0 repairs), nothing refused by the policy in 24 runs, and 1,185 page tests and 64 native tests three rounds in a row plus once inside the release build.

**What failed on the way to 1.0.1, and was in each case a check:**

- **The Desktop's lost mouse-up.** The view ended the carry 15 ms after the lost mouse-up, Doozer was back on the line and click-through at rest; but the check read a running total of how carries had ended, for the whole scenario, and an earlier carry, whose mouse-up and the shell's notice of it arrived together, had been counted as the notice. It now counts this carry alone, and passed (this carry counted as the shell's notice, the earlier one as the mouse-up).
- **The second day** (the Pill's checks). The check set the clock fourteen hours ahead and expected a new day; run between midnight and ten in the morning, fourteen hours on is still today. It had never been run at that hour. The night now always reaches the next calendar day.
- **The keyboard way into the Card**, all four views, when the round ran with the screen locked: no program may take the keyboard then. It is now reported as skipped on a locked screen. On the final build, with the owner's screen unlocked and idle a minute, all four passed.
- **The Island's checks**, the first time the policy was on: they loaded a `data:` picture into an image to count painted pixels, which the policy refuses (section 5). They now decode it without an image.

The save tests leave nothing in the temp folder, and the native tests no registry key (one native test more, the kill test's helper, is ignored by design).

### Version 1.0.0, for the record

1.0.0 was checked the same way on 2026-11-20, from commit `4e35164`: the silent install check 44 of 44, the Pill 4 of 4, the Room 6 of 6, the Island 5 of 5, the Desktop 2 of 2, the polish set 6 of 6, a fifteen-minute soak, 1,139 page tests and 60 native tests three times over. Its pages were never on screen.

**The Room's ball check failed twice on the way to 1.0.0, and both times it was the check.** The ball game is three kicks, each 90 to 150 px by chance, with Doozer trotting to 30 px short of where the ball lands. The check asked for two things that are only likely: Doozer already trotting a twentieth of a second after the click (when the first toss lands 30 px beyond where Doozer stands, the first leg is no distance at all and Doozer waits without taking a step: about one game in fifteen), and Doozer getting more than 40 px away from where it started (it read 35 in one run). It now watches from the click until the scene ends and asks for what the game guarantees: the scene is "play", Doozer trots in it, the ball ends somewhere new, and Doozer covers at least 60 px of floor.

## 8. Not verified by a person (accepted for the release)

1. **The icon in the real tray**, at this screen's 150 %, and in the Start menu and *Installed apps*. It was judged from enlarged pictures of its layers, not on a real taskbar. (The installer's pages no longer need walking by hand: look at the two pictures in sections 2 and 3 instead, for the wording and for the stock artwork that was left.)
2. **Another PC.** Windows SmartScreen on a machine that did not build the file; a Windows 10 PC; a PC without WebView2 (the installer should fetch it). None of these could be tried here.
3. **A screen that is awake and not 120 Hz.** On a 60 Hz screen Doozer alone should move evenly at 20 pictures a second. That is held by tests on pretend screens, and was seen on this machine's own screen with its monitor asleep (about 56 Hz), not on a real 60 Hz monitor ([polish-checks.md](polish-checks.md), section 18.1).
4. **The frame rates, by eye** (1.1.0). Each choice was measured with the monitor asleep, where the screen gave about 103 refreshes a second; none was looked at. On a 144 Hz screen, 120 and 144 should both be 144, and 30 about 29; on a 60 Hz screen, 60, 120 and 144 are all 60. Held by tests on pretend screens of 60, 120 and 144 Hz.
5. **The Card's keys by hand** (section 7). A script pressed the real Ctrl+Alt+D and the real Escape on 2026-11-26, while the owner was working in another program. Nobody has pressed Tab, the arrows or Enter in the Card for real, or Escape in the Room without a click in between.
6. **Start with Windows, for real.** Switch it on in Settings, sign out and in, and see Doozer arrive without taking the keyboard. The scripts prove the entry is written with the installed path and removed on uninstall, not that Windows acts on it.
7. Everything the earlier phases left for the owner still stands: section 16 of [polish-checks.md](polish-checks.md), section 9 of [desktop-checks.md](desktop-checks.md), section 10 of [island-checks.md](island-checks.md).

## 9. Releasing a newer version

1. Change the version in the three files of section 1 (the native test says so if one is missed).
2. If a dependency changed: `node scripts/make-notices.mjs`.
3. `pwsh scripts/build-release.ps1`.
4. On a machine with no Doozer on it: `pwsh scripts/run-install-checks.ps1`, and `pwsh scripts/run-install-pages.ps1 -Out <folder>` for the pages (it waits until nobody is at the machine). On the owner's own machine, once a pet lives there, both refuse to run: install by hand instead. The installer keeps the save.
5. The update from the last release: `pwsh scripts/run-update-check.ps1 -Old <the last release's installer>` (same machine rule as step 4).
6. Every view's checks on a build with the test hooks: `pwsh scripts/build-polish-checks.ps1 -Label final`, then `run-app-checks.ps1`, `run-room-checks.ps1`, `run-island-checks.ps1`, `run-desktop-checks.ps1` (and `-Soak 60`, and `-Only app-desktop-stuck -FrameRate 144`) and `run-polish-checks.ps1`, each with `-Exe src-tauri\target\polish\final\doozer.exe`. Then the real shortcut on the release build itself: `pwsh scripts/run-hotkey-check.ps1` (on screen, and it takes the keyboard for a few seconds at a time: with nobody at the machine, or with their leave).
7. Tag the commit `v<version>`.
8. Put it on GitHub (the repository is `origin`): `git push origin main --tags`, then `gh release create v<version> <the installer> --title "Doozer <version>" --notes-file <the release notes, without their first line> --verify-tag --latest`. Check that the release's asset has the size and SHA-256 of section 10 (`gh api repos/<owner>/doozer/releases/latest`), and point the README's link to the release notes at the new file.

## 10. Ready to publish

**Yes.** Version 1.1.0 is ready for a public release of the installer, as decided (section 6). The one check that could not be made on 2026-11-23, the keyboard way into the Card, was made on 2026-11-26 with real key presses (below; recorded in the commit after the tag). Nothing was bought or signed up for. It went up on 2026-11-27 (the end of this section).

| What ships | |
|---|---|
| File | `app/src-tauri/target/release/bundle/nsis/Doozer_1.1.0_x64-setup.exe` |
| Size | 1,809,882 bytes (1.7 MB); 4.1 MB installed |
| SHA-256 | `952b4db892a4cac4cb8fdad17ed8762319b5d491009e4b315bfd93f84c41a486` |
| Built from | commit `9ed8aef`, tagged `v1.1.0` at the commit that records this list |
| Text to publish with it | [release-notes-1.1.0.md](release-notes-1.1.0.md) |

A rebuild gives a different hash (the build stamps the time); the file above is the one that was checked. The 1.0.1 file (`088c6a41…025f5`, tag `v1.0.1`) is still beside it and was used for the update check.

**The go-live checks, each on the final 1.1.0 build:**

| Check | Result |
|---|---|
| **a. Personal details** in what ships: the git user's name and email (read from `git config` at run time, written nowhere), the Windows user name, the profile path, the project's path; in the installer, the program and every file installed beside it, and the page | **Clean**, by the scan that ends every release build and fails it if anything is found (`scripts/scan-personal.ps1`). The licence names "the author of Doozer" and nobody else |
| **b. Antivirus**: Windows Defender, `MpCmdRun.exe -Scan -ScanType 3`, on the installer and on the program | **No threats found** in either. No administrator rights were needed, and no Defender setting was touched (`-DisableRemediation`, reporting only) |
| **c. The update path**: 1.0.1 installed and given a pet (its bowl filled) and settings (Mint, Sound on, Desktop activity Still), all through the app's own controls; 1.1.0 installed over it while it ran (`scripts/run-update-check.ps1`) | **The same pet**, born at the same moment with the same name, bowl, treats and sessions; **the same settings**, and Doozer drawn in Mint; **Frame rate offered as Light, 30, 60, 120, 144 and at Light**, and 144 chosen in Settings and kept in the save. Then uninstalled; the machine left clean. 18 of 18 |
| **d. The Desktop soak**, a full hour, at the default rate | **Passed**: nothing rescued, no style repairs, nothing refused by the policy |
| **d′. Never stuck at the highest rate**: the Desktop's twenty minutes of interruptions at 144 | **Passed** |
| **e. The budget**, at the default | **Unchanged from 1.0.1.** Measured side by side with 1.0.1 at the same moments in eight states, 1.1.0 was the same or cheaper in six; neither build was under 1 % that evening, on a machine much busier than on 2026-11-21 (1.0.1 then: 0.31 to 0.75 %). Memory 98 to 138 MB. The higher rates are over the budget while Doozer moves, which the setting says. [polish-checks.md](polish-checks.md), section 19 |
| **f. Release text** | [release-notes-1.1.0.md](release-notes-1.1.0.md): what Doozer is, Windows 10 or 11 64-bit, the SmartScreen steps, size and SHA-256, what is new, known limits |
| The installer, silently: install, run, a second copy, a save, *Start with Windows*, an update over a running copy, uninstall | 49 of 49 |
| The installer's and uninstaller's pages, on screen, both ways through the tick box | 38 of 38, 14 pages pictured |
| Every view's scripted checks and the polish set | All pass. The keyboard way into the Card could not be checked on 2026-11-23 (Windows let neither 1.1.0 nor 1.0.1 take the keyboard that evening); on 2026-11-26 it passed in the Pill and the Room, and the real key press in the next row answered for all four (section 7) |
| **The real Ctrl+Alt+D**, pressed by a script at the program that ships, in every view, with the owner working in a browser (2026-11-26) | **The window takes the keyboard at once in all four views**, with the focus on *Feed*. Escape closes the Card and hands the keyboard back to the same window in the Pill, the Island and the Desktop; in the Room the owner's own click took it back first, each time |
| The content security policy | Nothing refused in any run |
| The tests | 1,199 page tests and 64 native tests, type-check clean, three rounds, the third inside the release build |

**Not verified by a person, and accepted as such for the release:**

- the icon in the real tray, the installer's pages by eye (their pictures are in sections 2 and 3), and Doozer's motion and sounds (the two extra sounds were decided to stay without being heard);
- how each frame rate looks, on any screen;
- another PC: SmartScreen on a machine that did not build the file, Windows 10, a PC without WebView2;
- a monitor that is awake and not 120 Hz;
- Tab, the arrows and Enter in the Card, pressed for real (the shortcut and Escape were, by a script, on 2026-11-26);
- *Start with Windows* across a real sign-in.

Each is described in section 8 and in the earlier write-ups. None of them can make the installer harm a PC or lose a pet; the worst they could show is something that looks or sounds less good than it should.

**Before it went up**, one thing was the owner's to weigh: the name (section 6). It stayed.

**Where it is, since 2026-11-27.** At the owner's request the project is on GitHub as `mgelsinger/doozer`, first private and then, the same day, **public** ("lets just make the whole thing public"). Release `v1.1.0` there holds the installer of the table above with the release notes as its text, and is the latest. Checked without signing in: the repository's page answers, *latest* leads to `v1.1.0`, the installer's link serves 1,809,882 bytes, and GitHub's own SHA-256 of the file is the one in the table. The README's front page (the download link, a picture of each home) was looked at on GitHub's page.
