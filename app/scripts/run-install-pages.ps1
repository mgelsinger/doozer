# Walks through the installer's and the uninstaller's own pages, as a person would, and
# takes a picture of each one. See docs/release.md, "The pages".
#
#   pwsh app/scripts/run-install-pages.ps1 -Out <folder for the pictures and the report>
#   pwsh app/scripts/run-install-pages.ps1 -Out <folder> -Setup <path to a setup .exe> -WaitMinutes 60
#
# What run-install-checks.ps1 cannot reach, because it runs everything silently:
#   - every page of the installer and of the uninstaller, on screen, with what it says;
#   - the message the installer shows when Doozer is running;
#   - the uninstaller's tick box "Also delete Doozer's save", left unticked (the save
#     stays, and installing again finds the same Doozer) and ticked (the save goes, and
#     installing again hatches a new one).
#
# How. The pages are ordinary Windows dialogs with ordinary buttons and tick boxes. Each
# is pressed by sending its dialog the message a press sends (WM_COMMAND, "this button was
# clicked"), and a tick box is set by the message that sets one (BM_SETCHECK). THE REAL
# POINTER IS NEVER MOVED OR CLICKED AND NO KEY IS SENT. (UI Automation's Invoke and Toggle
# would be the textbook way; it finds these controls but offers neither pattern for them,
# and for a Windows button Invoke comes down to the same message.) The pictures are taken
# with PrintWindow, which asks a window to draw itself: it works whatever is in front.
#
# These windows do come to the front, on the one screen the owner uses. So nothing is
# started until nobody has touched the machine for a minute and no fullscreen app is in
# front; the script waits for that (-WaitMinutes, default 30) and gives up otherwise.
#
# It only ever touches a dialog titled "Doozer Setup" or "Doozer Uninstall" that belongs
# to the installer it started itself, or to the uninstaller's own copy of itself. Anything
# else that appears, a prompt from Windows above all, is left alone: the step times out,
# the script says so, cleans up silently and stops.
#
# Like run-install-checks.ps1 it installs and removes the real thing in the real places
# and refuses to start if a Doozer is installed, running or saved here. It leaves the
# machine as it found it.

param(
  [string] $Setup = '',
  [Parameter(Mandatory)] [string] $Out,
  [int] $WaitMinutes = 30,
  [int] $Port = 9238
)

$ErrorActionPreference = 'Stop'
$app = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version
if (-not $Setup) { $Setup = Join-Path $app "src-tauri\target\release\bundle\nsis\Doozer_${version}_x64-setup.exe" }
$setupPath = (Resolve-Path $Setup).Path
# The version is the installer's own, whatever the source tree says by now.
if ((Split-Path $setupPath -Leaf) -match '^Doozer_(\d+\.\d+\.\d+)_') { $version = $Matches[1] }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$outDir = (Resolve-Path $Out).Path

$identifier = 'com.doozer.desktop'
$installDir = Join-Path $env:LOCALAPPDATA 'Doozer'
$exe = Join-Path $installDir 'doozer.exe'
$uninstaller = Join-Path $installDir 'uninstall.exe'
$saveDir = Join-Path $env:APPDATA $identifier
$saveFile = Join-Path $saveDir 'save.json'
$cacheDir = Join-Path $env:LOCALAPPDATA $identifier
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Doozer.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Doozer.lnk'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Doozer'
$makerKey = 'HKCU:\Software\Doozer'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$scratch = Join-Path ([IO.Path]::GetTempPath()) "doozer-install-pages-$PID"

$failures = [System.Collections.Generic.List[string]]::new()
$notes = [System.Collections.Generic.List[string]]::new()
$pages = [System.Collections.Generic.List[object]]::new()
# Every process this script started, so that it never ends one it did not.
$mine = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
function Say([string] $line) { Write-Host $line }
function Check([bool] $ok, [string] $what) {
  if ($ok) { Say "  ok    $what" } else { Say "  FAIL  $what"; $failures.Add($what) }
}
function Note([string] $what) { Say "  note  $what"; $notes.Add($what) }

Add-Type -AssemblyName System.Drawing.Common
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Doozer {
  public class Control {
    public IntPtr Hwnd; public IntPtr Parent; public int Id;
    public string Kind = ""; public string Class = ""; public string Text = "";
    public bool Enabled; public bool Ticked;
    /** The room the control has, and the room its words need, in pixels: to see a label cut short. */
    public int Width; public int Height; public int TextWidth;
  }
  public class Dialog { public IntPtr Hwnd; public string Title = ""; public bool Enabled; public uint ProcessId; }

  public static class Pages {
    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; }
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] static extern bool GetTextExtentPoint32W(IntPtr hdc, string text, int length, out SIZE size);
    [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
    [DllImport("kernel32.dll")] static extern uint GetTickCount();
    [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);

    const int GWL_STYLE = -16;
    const uint WM_COMMAND = 0x0111, WM_GETFONT = 0x0031, BM_GETCHECK = 0x00F0, BM_SETCHECK = 0x00F1;

    public static double IdleSeconds() {
      var info = new LASTINPUTINFO(); info.cbSize = 8;
      GetLastInputInfo(ref info);
      return (GetTickCount() - info.dwTime) / 1000.0;
    }
    /** 2 busy, 3 a Direct3D app fullscreen, 4 presentation mode. */
    public static bool FullscreenInFront() {
      int state; SHQueryUserNotificationState(out state);
      return state == 2 || state == 3 || state == 4;
    }

    static string TextOf(IntPtr hwnd) {
      var text = new StringBuilder(Math.Max(256, GetWindowTextLength(hwnd) + 2));
      GetWindowText(hwnd, text, text.Capacity);
      return text.ToString();
    }
    static string ClassOf(IntPtr hwnd) { var name = new StringBuilder(64); GetClassName(hwnd, name, 64); return name.ToString(); }

    /** Every visible dialog (the Windows dialog class) whose title begins with one of `titles`. */
    public static List<Dialog> Dialogs(string[] titles) {
      var found = new List<Dialog>();
      EnumWindows((hwnd, l) => {
        if (!IsWindowVisible(hwnd) || ClassOf(hwnd) != "#32770") return true;
        string title = TextOf(hwnd);
        foreach (string wanted in titles) {
          if (title.StartsWith(wanted, StringComparison.Ordinal)) {
            uint processId; GetWindowThreadProcessId(hwnd, out processId);
            found.Add(new Dialog { Hwnd = hwnd, Title = title, Enabled = IsWindowEnabled(hwnd), ProcessId = processId });
            break;
          }
        }
        return true;
      }, IntPtr.Zero);
      return found;
    }

    /** What a dialog shows: its words, buttons, tick boxes and choices, as they are now. */
    public static List<Control> Read(IntPtr dialog) {
      var controls = new List<Control>();
      EnumChildWindows(dialog, (hwnd, l) => {
        if (!IsWindowVisible(hwnd)) return true;
        string cls = ClassOf(hwnd);
        long style = GetWindowLongPtr(hwnd, GWL_STYLE).ToInt64();
        string kind;
        if (cls == "Button") {
          long type = style & 0xF;
          kind = type == 2 || type == 3 || type == 5 || type == 6 ? "CheckBox" : type == 4 || type == 9 ? "RadioButton" : type == 7 ? "Group" : "Button";
        } else if (cls == "Static") kind = "Text";
        else if (cls.StartsWith("RichEdit", StringComparison.OrdinalIgnoreCase) || cls == "Edit") kind = "Edit";
        else return true;
        RECT r; GetWindowRect(hwnd, out r);
        var control = new Control {
          Hwnd = hwnd, Parent = GetParent(hwnd), Id = GetDlgCtrlID(hwnd), Kind = kind, Class = cls, Text = TextOf(hwnd),
          Enabled = IsWindowEnabled(hwnd), Width = r.Right - r.Left, Height = r.Bottom - r.Top,
        };
        if (kind == "CheckBox" || kind == "RadioButton") {
          control.Ticked = SendMessage(hwnd, BM_GETCHECK, IntPtr.Zero, IntPtr.Zero).ToInt64() == 1;
          // How wide the label is in the control's own font.
          IntPtr font = SendMessage(hwnd, WM_GETFONT, IntPtr.Zero, IntPtr.Zero);
          IntPtr hdc = GetDC(hwnd);
          IntPtr old = font != IntPtr.Zero ? SelectObject(hdc, font) : IntPtr.Zero;
          SIZE size; string label = control.Text.Replace("&", "");
          if (GetTextExtentPoint32W(hdc, label, label.Length, out size)) control.TextWidth = size.cx;
          if (old != IntPtr.Zero) SelectObject(hdc, old);
          ReleaseDC(hwnd, hdc);
        }
        controls.Add(control);
        return true;
      }, IntPtr.Zero);
      return controls;
    }

    /** Press a button: tell its dialog it was clicked, which is all a click does. Does not wait. */
    public static bool Press(Control button) {
      // wParam: the control's id in the low word, BN_CLICKED (0) in the high word.
      return PostMessage(button.Parent, WM_COMMAND, new IntPtr(button.Id & 0xFFFF), button.Hwnd);
    }
    /** Tick or untick a box, and tell its dialog, as a click on it would. */
    public static bool SetTick(Control box, bool ticked) {
      SendMessage(box.Hwnd, BM_SETCHECK, new IntPtr(ticked ? 1 : 0), IntPtr.Zero);
      PostMessage(box.Parent, WM_COMMAND, new IntPtr(box.Id & 0xFFFF), box.Hwnd);
      return (SendMessage(box.Hwnd, BM_GETCHECK, IntPtr.Zero, IntPtr.Zero).ToInt64() == 1) == ticked;
    }
  }
}
'@

# Nobody at the machine for a minute, and nothing fullscreen in front. Waits for it.
function Wait-ForQuiet([string] $before) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $said = $false
  while ($true) {
    if ([Doozer.Pages]::IdleSeconds() -ge 60 -and -not [Doozer.Pages]::FullscreenInFront()) { return $true }
    if ($clock.Elapsed.TotalMinutes -ge $WaitMinutes) { return $false }
    if (-not $said) { Say "  waiting before ${before}: somebody is at the machine, or a fullscreen app is in front"; $said = $true }
    Start-Sleep -Seconds 10
  }
}

function Get-RunValue { (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).Doozer }
function Get-Doozers { @(Get-Process doozer -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) }
function Wait-Until([scriptblock] $test, [int] $seconds) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  while ($clock.Elapsed.TotalSeconds -lt $seconds) {
    if (& $test) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return [bool](& $test)
}

# ---- the installer's dialogs ----------------------------------------------------------------

$TITLES = [string[]]@('Doozer Setup', 'Doozer Uninstall')
# Is this dialog the installer's or the uninstaller's? Its process is one this script
# started, or the uninstaller's copy of itself: it copies itself into the temp folder
# (~nsu1.tmp\Un.exe and so on) and carries on from there, in a process of its own. The
# copy is known by where it is and by what it says it is: a file of the product "Doozer".
function Test-Ours([Doozer.Dialog] $dialog) {
  if ($mine | Where-Object { $_.Id -eq $dialog.ProcessId }) { return $true }
  $process = Get-Process -Id $dialog.ProcessId -ErrorAction SilentlyContinue
  if (-not $process -or -not $process.Path) { return $false }
  $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not $process.Path.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase)) { return $false }
  if ($process.Path -notmatch '\\~nsu\w*\.tmp\\(Un|Un_[A-Z]|Au_)\.exe$') { return $false }
  return (Get-Item $process.Path).VersionInfo.ProductName -eq 'Doozer'
}
# The uninstaller copies itself into the temp folder (~nsu1.tmp\Un.exe and so on) and runs
# from there, and Windows only removes the copy at the next restart. The ones that are
# Doozer's, and not running, are removed here so that a check leaves nothing in Temp.
function Remove-UninstallerCopies {
  foreach ($folder in @(Get-ChildItem ([IO.Path]::GetTempPath()) -Directory -Filter '~nsu*.tmp' -ErrorAction SilentlyContinue)) {
    $copy = Join-Path $folder.FullName 'Un.exe'
    if (-not (Test-Path $copy)) { continue }
    if ((Get-Item $copy).VersionInfo.ProductName -ne 'Doozer') { continue }
    if (@(Get-Process | Where-Object { $_.Path -eq $copy }).Count) { continue }
    Remove-Item -LiteralPath $folder.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }
}
function Get-OurDialogs { @([Doozer.Pages]::Dialogs($TITLES) | Where-Object { Test-Ours $_ }) }

function Save-Picture([IntPtr] $hwnd, [string] $file) {
  $rect = New-Object Doozer.Pages+RECT
  [void][Doozer.Pages]::GetWindowRect($hwnd, [ref] $rect)
  $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
  if ($w -le 0 -or $h -le 0) { return }
  $bitmap = New-Object System.Drawing.Bitmap $w, $h
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $hdc = $graphics.GetHdc()
  # 2: PW_RENDERFULLCONTENT, so that the window draws itself whatever is in front of it.
  [void][Doozer.Pages]::PrintWindow($hwnd, $hdc, 2)
  $graphics.ReleaseHdc($hdc); $graphics.Dispose()
  $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png); $bitmap.Dispose()
}

$FORWARD = '^(&?Next\s*>|&?Install|&?Uninstall|&?Finish|&?Close|OK|&?Yes)$'
$script:walked = $false

# Walk one wizard from its first page until its window has gone. Sets $script:walked.
#   $decide: given a page's controls, may tick or untick things; returns the words of the
#   button to press, or '' for the usual one (Next, Install, Uninstall, Finish, OK).
function Step-Through([string] $name, [string] $title, [scriptblock] $decide, [int] $limitSeconds = 240) {
  $script:walked = $false
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $seen = ''
  $count = 0
  $goneFor = 0
  $appeared = $false
  while ($clock.Elapsed.TotalSeconds -lt $limitSeconds) {
    $dialogs = @(Get-OurDialogs | Where-Object { $_.Title.StartsWith($title) })
    if ($dialogs.Count -eq 0) {
      if ($appeared) { $goneFor++; if ($goneFor -ge 8) { $script:walked = $true; return } }
      elseif ($clock.Elapsed.TotalSeconds -gt 40) { Check $false "${name}: its window never appeared (if something else is on screen, it was left alone)"; return }
      Start-Sleep -Milliseconds 250
      continue
    }
    $appeared = $true; $goneFor = 0
    # The one that can be used: a message box if there is one (its owner is disabled meanwhile).
    $dialog = @($dialogs | Where-Object Enabled | Select-Object -Last 1)[0]
    if (-not $dialog) { Start-Sleep -Milliseconds 250; continue }
    $controls = @([Doozer.Pages]::Read($dialog.Hwnd))
    # A page that is still working (files being copied) has no way forward yet: wait for it.
    if (@($controls | Where-Object { $_.Kind -eq 'Button' -and $_.Enabled -and $_.Text -match $FORWARD }).Count -eq 0) { Start-Sleep -Milliseconds 300; continue }
    $signature = "$($dialog.Hwnd)|" + (@($controls | Where-Object { $_.Kind -in 'Text', 'CheckBox', 'RadioButton', 'Button' -and $_.Text } | ForEach-Object { "$($_.Kind):$($_.Text)" }) -join '|')
    if ($signature -eq $seen) { Start-Sleep -Milliseconds 300; continue }
    $seen = $signature
    $count++
    # Let the page finish drawing before anything is read or its picture taken.
    Start-Sleep -Milliseconds 500
    $controls = @([Doozer.Pages]::Read($dialog.Hwnd))
    $wanted = & $decide $controls
    Start-Sleep -Milliseconds 250
    $controls = @([Doozer.Pages]::Read($dialog.Hwnd))
    $file = Join-Path $outDir ("{0}-{1:00}.png" -f $name, $count)
    Save-Picture $dialog.Hwnd $file
    $choices = @($controls | Where-Object { $_.Kind -in 'CheckBox', 'RadioButton' } | ForEach-Object {
        # A tick box needs its label's width and about 20 pixels for the box itself.
        [pscustomobject]@{ kind = $_.Kind; text = $_.Text -replace '&', ''; ticked = $_.Ticked; enabled = $_.Enabled; width = $_.Width; labelNeeds = $_.TextWidth + 20; fits = ($_.TextWidth + 20) -le $_.Width }
      })
    $press = if ($wanted) { @($controls | Where-Object { $_.Kind -eq 'Button' -and $_.Enabled -and ($_.Text -replace '&', '') -eq $wanted })[0] } else { @($controls | Where-Object { $_.Kind -eq 'Button' -and $_.Enabled -and $_.Text -match $FORWARD })[0] }
    $page = [pscustomobject]@{
      wizard = $name; page = $count; title = $dialog.Title; picture = (Split-Path $file -Leaf)
      texts = @($controls | Where-Object { $_.Kind -in 'Text', 'Edit' -and $_.Text.Trim() } | ForEach-Object { $_.Text })
      choices = $choices
      buttons = @($controls | Where-Object { $_.Kind -eq 'Button' } | ForEach-Object { [pscustomobject]@{ text = $_.Text -replace '&', ''; enabled = $_.Enabled } })
      pressed = if ($press) { $press.Text -replace '&', '' } else { '' }
    }
    $pages.Add($page)
    $line = "    page $count  [$($page.pressed)]  " + ((@($page.texts) + @($choices | ForEach-Object { "[$(if ($_.ticked) { 'x' } else { ' ' })] $($_.text)" }) | Select-Object -First 4) -join ' / ' -replace '\s+', ' ')
    Say $line.Substring(0, [Math]::Min(220, $line.Length))
    foreach ($choice in $choices) { if (-not $choice.fits) { Check $false "${name}, page ${count}: the label '$($choice.text)' needs $($choice.labelNeeds) px and has $($choice.width): it is cut short" } }
    if (-not $press) { Check $false "${name}, page ${count}: no button to press (wanted '$wanted')"; return }
    if (-not [Doozer.Pages]::Press($press)) { Check $false "${name}, page ${count}: '$($page.pressed)' could not be pressed"; return }
    Start-Sleep -Milliseconds 400
  }
  Check $false "${name}: not finished after $limitSeconds s (if something else is on screen, it was left alone)"
}

function Start-Wizard([string] $file) {
  if ([Doozer.Pages]::FullscreenInFront()) { throw 'a fullscreen app came to the front; nothing more is put on screen' }
  $process = Start-Process -FilePath $file -PassThru
  $mine.Add($process)
}
function Walk-Installer([string] $name, [scriptblock] $decide) {
  Start-Wizard $setupPath
  Step-Through $name 'Doozer Setup' $decide
}
function Walk-Uninstaller([string] $name, [scriptblock] $decide) {
  Start-Wizard $uninstaller
  Step-Through $name 'Doozer Uninstall' $decide
  [void](Wait-Until { -not (Test-Path $exe) -and -not (Test-Path $uninstaller) } 30)
  Start-Sleep -Seconds 2
}

# ---- the installed app, asked through its page (as run-install-checks.ps1 does) ------------------

function Ask-Page([string] $expression) {
  $file = Join-Path $scratch 'question.js'
  Set-Content -Path $file -Value $expression -Encoding utf8NoBOM
  $answer = & node (Join-Path $PSScriptRoot 'ask-page.mjs') --port $Port --file $file 2>&1
  if ($LASTEXITCODE -ne 0) { throw "the page did not answer: $answer" }
  return ($answer | Out-String).Trim()
}
function Start-Installed {
  if ([Doozer.Pages]::FullscreenInFront()) { throw 'a fullscreen app came to the front; Doozer is not started over it' }
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
  try { $mine.Add((Start-Process -FilePath $exe -PassThru)) }
  finally { Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue }
  return (Wait-Until { try { (Ask-Page 'document.querySelector("#host")?.childElementCount > 0 ? "ready" : "not yet"') -eq 'ready' } catch { $false } } 40)
}
function Stop-Installed {
  try { [void](Ask-Page 'window.__TAURI_INTERNALS__.invoke("quit").then(() => "bye", () => "bye")') } catch { }
  if (-not (Wait-Until { (Get-Doozers).Count -eq 0 } 10)) { Get-Doozers | Stop-Process -Force -ErrorAction SilentlyContinue }
}
$fillTheBowl = @'
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const find = () => document.querySelector('[aria-label^="Fill the bowl"]');
  const pill = document.querySelector('.pillv-pill');
  if (!pill) return 'no pill';
  if (!find()) pill.click();
  for (let i = 0; i < 50 && !find(); i++) await wait(100);
  const button = find();
  if (!button) return 'no bowl button on the Card';
  button.click();
  await wait(1500);
  const saved = await window.__TAURI_INTERNALS__.invoke('load_save');
  return saved.source + ':' + (saved.data ? JSON.parse(saved.data).brain.pet.bowl : 'nothing');
})()
'@
$whoIsHere = 'window.__TAURI_INTERNALS__.invoke("load_save").then((s) => s.source + ":" + (s.data ? JSON.parse(s.data).brain.pet.bowl + ":" + JSON.parse(s.data).brain.pet.bornAt : "nothing"))'

function Invoke-SilentUninstall {
  if (-not (Test-Path $uninstaller)) { return }
  Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
  [void](Wait-Until { -not (Test-Path $exe) -and -not (Test-Path $uninstaller) } 60)
  Start-Sleep -Seconds 2
}

# ---- nothing of Doozer may be here already -------------------------------------------------------

$inTheWay = @()
if (@(Get-Process doozer -ErrorAction SilentlyContinue).Count) { $inTheWay += 'a Doozer is running (or a test of one)' }
if (Test-Path $installDir) { $inTheWay += "Doozer is installed ($installDir)" }
if (Test-Path $uninstallKey) { $inTheWay += 'Doozer is listed under Installed apps' }
if (Test-Path $saveDir) { $inTheWay += "there is a save ($saveDir): somebody's pet lives on this machine" }
if (Get-RunValue) { $inTheWay += 'Doozer is registered to start with Windows' }
if (Test-Path $makerKey) { $inTheWay += "the installer's own key is there ($makerKey)" }
if (@([Doozer.Pages]::Dialogs($TITLES)).Count) { $inTheWay += 'an installer or uninstaller of Doozer is already open' }
if ($inTheWay.Count) {
  Say 'Not run. This installs and removes the real thing, and it found:'
  $inTheWay | ForEach-Object { Say "  - $_" }
  exit 2
}
if (-not (Wait-ForQuiet 'starting')) {
  Say "Not run: in $WaitMinutes minutes there was never a minute with nobody at the machine and no fullscreen app in front."
  exit 3
}

New-Item -ItemType Directory -Force -Path $scratch | Out-Null
Say "installer: $setupPath"
Say "version:   $version"
Say "pictures:  $outDir"
# On the installer's last page: do not let it start Doozer (it is started below, where it can be asked things).
$untickRun = {
  param($controls)
  $run = @($controls | Where-Object { $_.Kind -eq 'CheckBox' -and $_.Text -match '^&?Run ' })[0]
  if ($run) { [void][Doozer.Pages]::SetTick($run, $false) }
  ''
}

try {
  # ---- 1. a first install, page by page -----------------------------------------------------------
  Say '1. install, through the pages'
  Walk-Installer 'install' $untickRun
  Check $script:walked 'the installer was walked to its end'
  Check (Test-Path $exe) "the program is in $installDir"
  Check (Test-Path $startMenu) 'it is in the Start menu'
  Check ((Get-ItemProperty $uninstallKey -ErrorAction SilentlyContinue).DisplayVersion -eq $version) "listed under Installed apps as $version"
  Start-Sleep -Seconds 2
  Check ((Get-Doozers).Count -eq 0) 'with "Run Doozer" unticked on the last page, it is not started'
  if (Test-Path $desktop) { Note 'the last page offers a desktop shortcut, ticked as it comes; it was left ticked and the shortcut was made' } else { Note 'no desktop shortcut was made' }

  # ---- 2. the installed program, and a save ---------------------------------------------------------
  Say '2. the installed program'
  Check (Start-Installed) 'it starts and its page comes up'
  Check ((Ask-Page 'document.documentElement.dataset.version ?? "none"') -eq $version) "the page inside it is version $version"
  $filled = Ask-Page $fillTheBowl
  Check ($filled -eq 'main:3') "the bowl was filled from the Card and the save written (the page says $filled)"
  $first = Ask-Page $whoIsHere
  $saveBefore = if (Test-Path $saveFile) { Get-Content $saveFile -Raw } else { '' }
  Check ($saveBefore.Length -gt 0) "the save is in $saveDir"

  # ---- 3. the installer again, over the running copy --------------------------------------------------
  Say '3. the installer again while Doozer is running: the "already installed" page, and the message about a running copy'
  if (-not (Wait-ForQuiet 'the second installer')) { throw 'somebody came back to the machine; stopping here' }
  Walk-Installer 'reinstall' $untickRun
  Check $script:walked 'the installer was walked to its end again'
  $again = @($pages | Where-Object { $_.wizard -eq 'reinstall' })
  Check (@($again | Where-Object { ($_.texts -join ' ') -match 'already installed' }).Count -gt 0) 'it showed the "already installed" page'
  $running = @($again | Where-Object { ($_.texts -join ' ') -match 'is running' })
  Check ($running.Count -gt 0) 'it showed the message that Doozer is running'
  if ($running.Count) {
    $said = ($running[0].texts -join ' ') -replace '\s+', ' '
    Check ($said -notmatch '(?i)kill') "that message does not speak of killing (it says: $said)"
  }
  Check (Wait-Until { (Get-Doozers).Count -eq 0 } 10) 'the running copy was closed for it'
  Check ((Test-Path $saveFile) -and ((Get-Content $saveFile -Raw) -eq $saveBefore)) 'the save is untouched'

  # ---- 4. uninstall through the pages, the box left unticked ----------------------------------------------
  Say '4. uninstall, through the pages, the box left as it comes'
  if (-not (Wait-ForQuiet 'the uninstaller')) { throw 'somebody came back to the machine; stopping here' }
  $boxes = [System.Collections.Generic.List[object]]::new()
  Walk-Uninstaller 'uninstall-keep' {
    param($controls)
    foreach ($box in @($controls | Where-Object { $_.Kind -eq 'CheckBox' })) { $boxes.Add([pscustomobject]@{ text = $box.Text; ticked = $box.Ticked }) }
    ''
  }
  Check $script:walked 'the uninstaller was walked to its end'
  Check ($boxes.Count -eq 1) "it has one tick box (it has $($boxes.Count))"
  if ($boxes.Count) {
    Check ($boxes[0].text -eq "Also delete Doozer's save (your pet and its progress)") "the box says: $($boxes[0].text)"
    Check (-not $boxes[0].ticked) 'and it comes unticked'
  }
  Check (-not (Test-Path $installDir)) 'the program and its folder are gone'
  Check (-not (Test-Path $startMenu) -and -not (Test-Path $desktop)) 'the shortcuts are gone'
  Check (-not (Test-Path $uninstallKey)) 'it is no longer listed under Installed apps'
  Check (-not (Test-Path $makerKey)) "the installer's own key is gone ($makerKey)"
  Check (-not (Test-Path $cacheDir)) "the browser's cache is gone"
  Check ((Test-Path $saveFile) -and ((Get-Content $saveFile -Raw) -eq $saveBefore)) 'THE SAVE IS STILL THERE, unchanged'

  # ---- 5. install again: the same Doozer ---------------------------------------------------------------------
  Say '5. install again (silently): the same Doozer is back'
  $install = Start-Process -FilePath $setupPath -ArgumentList '/S' -Wait -PassThru
  Check ($install.ExitCode -eq 0 -and (Test-Path $exe)) 'installed'
  Check (Start-Installed) 'it starts'
  $back = Ask-Page $whoIsHere
  Check ($back -eq $first -and $back -match '^main:3:') "it is the same Doozer, born at the same moment, its bowl still full (before $first, now $back)"
  Stop-Installed

  # ---- 6. uninstall through the pages, the box ticked ---------------------------------------------------------
  Say '6. uninstall, through the pages, with the box TICKED'
  if (-not (Wait-ForQuiet 'the second uninstaller')) { throw 'somebody came back to the machine; stopping here' }
  $ticked = [System.Collections.Generic.List[bool]]::new()
  Walk-Uninstaller 'uninstall-delete' {
    param($controls)
    foreach ($box in @($controls | Where-Object { $_.Kind -eq 'CheckBox' })) { $ticked.Add([Doozer.Pages]::SetTick($box, $true)) }
    ''
  }
  Check $script:walked 'the uninstaller was walked to its end'
  Check ($ticked.Count -eq 1 -and $ticked[0]) 'the box was ticked'
  Check (-not (Test-Path $installDir)) 'the program and its folder are gone'
  Check (-not (Test-Path $saveDir)) "THE SAVE IS GONE ($saveDir)"
  Check (-not (Test-Path $cacheDir)) "the browser's cache is gone"
  Check (-not (Test-Path $makerKey) -and -not (Test-Path $uninstallKey)) "the installer's keys are gone"

  # ---- 7. install again: a new Doozer ---------------------------------------------------------------------------
  Say '7. install again (silently): a new Doozer hatches'
  $install = Start-Process -FilePath $setupPath -ArgumentList '/S' -Wait -PassThru
  Check ($install.ExitCode -eq 0 -and (Test-Path $exe)) 'installed'
  Check (Start-Installed) 'it starts'
  $new = Ask-Page 'window.__TAURI_INTERNALS__.invoke("load_save").then((s) => s.source)'
  Check ($new -eq 'none') "there is no save: a new Doozer (the shell says $new)"
  Stop-Installed
  Invoke-SilentUninstall
  Check (-not (Test-Path $installDir) -and -not (Test-Path $makerKey)) 'and it is uninstalled again'
}
catch {
  Check $false "stopped: $_"
}
finally {
  # Leave the machine as it was found. Only what this script started is ever ended.
  Get-Doozers | Stop-Process -Force -ErrorAction SilentlyContinue
  $open = @(Get-OurDialogs)
  if ($open.Count) {
    Note "an installer window of this run was still open at the end ($($open[0].Title)); its process was ended"
    foreach ($dialog in $open) { Stop-Process -Id $dialog.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
  }
  Remove-UninstallerCopies
  if (Test-Path $uninstaller) { Say 'cleaning up: uninstalling what was left'; Invoke-SilentUninstall }
  $value = Get-RunValue
  if ($value -and $value -eq "`"$exe`"") { Remove-ItemProperty $runKey -Name Doozer -ErrorAction SilentlyContinue }
  # The test pets. There was no save when this started, so any here now is this script's own.
  if (Test-Path $saveDir) { Remove-Item -Recurse -Force $saveDir -ErrorAction SilentlyContinue }
  $left = @()
  foreach ($path in $installDir, $saveDir, $startMenu, $desktop) { if (Test-Path $path) { $left += $path } }
  foreach ($key in $uninstallKey, $makerKey) { if (Test-Path $key) { $left += $key } }
  if (Get-RunValue) { $left += 'the Run key value' }
  if ($left.Count) { Check $false "left behind: $($left -join ', ')" }
  [pscustomobject]@{ installer = $setupPath; version = $version; failures = @($failures); notes = @($notes); pages = @($pages) } |
    ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $outDir 'install-pages.json') -Encoding utf8NoBOM
  Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Remove-UninstallerCopies
}

Say ''
Say "$($pages.Count) pages pictured in $outDir"
if ($failures.Count) { Say "FAILED: $($failures.Count)"; $failures | ForEach-Object { Say "  - $_" }; exit 1 }
Say 'all ok'
