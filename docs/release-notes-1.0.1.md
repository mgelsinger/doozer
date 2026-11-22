# Doozer 1.0.1

Doozer is a small creature that lives on your Windows desktop. It has four homes you can switch between (a pill at the edge of the screen, a little room, a 3D island, or the taskbar itself), it needs a little looking after, and it keeps you company while you work: there is a focus timer in every home, and finishing a session earns treats. Nothing bad ever happens to it. It never dies, it is never hungry because you had a bad day, and stopping a session early costs nothing.

It is free, it has no account, and it collects nothing: Doozer makes no network requests of any kind.

## Download

| | |
|---|---|
| File | `Doozer_1.0.1_x64-setup.exe` |
| Size | 1.7 MB (1,809,260 bytes) |
| SHA-256 | `088c6a413fc988f6f1c8fba218943b5d918e2c27dc5782148ac1049853f025f5` |
| Needs | Windows 10 or 11, 64-bit |

To check your download, in PowerShell: `Get-FileHash .\Doozer_1.0.1_x64-setup.exe` should print the SHA-256 above.

## Installing

1. Run `Doozer_1.0.1_x64-setup.exe`. It installs for you alone, with no administrator password.
2. **Windows may say "Windows protected your PC".** The installer is not signed with a paid certificate, so Windows SmartScreen does not know it yet. Choose **More info**, then **Run anyway**.
3. Doozer appears in a small pill at the top of the screen and in the tray beside the clock. Click the pill to open its Card; right-click for the menu.

On a Windows 10 PC without Microsoft's WebView2 runtime (Windows 11 always has it), the installer fetches that from Microsoft first.

If you had Doozer 1.0.0, install 1.0.1 over it: your pet and your settings stay.

To remove it: *Settings → Apps → Installed apps → Doozer → Uninstall*. One tick box asks whether to delete your pet's save too; left unticked, a later install finds the same Doozer.

## What's new in 1.0.1

- **Calmer on the taskbar.** In the Desktop home, at the default pace (Calm), Doozer now takes a short stroll about every four minutes instead of every one to two, and costs your PC less for it.
- **Lighter while you focus.** With nobody at the screen, Doozer's own clock ticks once a second instead of four times, and a focus session still ends on the second.
- **Locked down.** The page Doozer is drawn in runs under a strict content security policy: it can load nothing but Doozer's own files and cannot reach the network at all.
- **A cleaner uninstall.** The uninstaller now also removes the installer's own registry entry, which 1.0.0 left behind.
- **A licence**, `LICENSE.txt`, installed beside the program: free to use and to pass on unchanged.

## Known limits

- **Windows only**, 64-bit, Windows 10 or 11.
- **Not code-signed**: SmartScreen warns once (above). Some antivirus programs are wary of any unsigned installer; Windows Defender found nothing in this one.
- **No automatic updates.** A new version is installed by running its installer, and keeps your pet.
- **English only.**
- **Ctrl+Alt+D** (open the Card from the keyboard) cannot be changed. If another program already uses it, *Open Doozer's card* in the tray menu does the same.
- On a screen that does not refresh at a multiple of 24 times a second (60 Hz, for one), Doozer is drawn at 20 pictures a second when nobody is at it, rather than 24.

## The fine print

Doozer is free to use and to pass on unchanged, and comes with no warranty: `LICENSE.txt`, installed beside the program, says so in full. It is built with the work of others, listed with their licences in `THIRD-PARTY-NOTICES.txt` beside it.
