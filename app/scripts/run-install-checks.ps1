# Checks the installer on this machine: install, run, install again over a running copy
# (an update), uninstall. Prints what failed. See docs/release.md.
#
#   pwsh app/scripts/run-install-checks.ps1                      # the installer build-release.ps1 made
#   pwsh app/scripts/run-install-checks.ps1 -Setup <path to a setup .exe>
#   pwsh app/scripts/run-install-checks.ps1 -Out <folder>        # keep the report
#
# THIS INSTALLS AND REMOVES THE REAL THING, in the real places, because those are the only
# places the installer knows: %LOCALAPPDATA%\Doozer, the Start menu, "Installed apps", the
# user's Run key, %APPDATA%\com.doozer.desktop (the save). So it refuses to start unless the
# machine has none of them: no Doozer installed, none running, no save. On a machine where
# somebody keeps a Doozer it will not run, and must not be made to.
#
# Everything is done without the mouse and without a window of the installer's (silent
# mode). The installed app does show for about half a minute in all, twice: the pill at the
# top of the screen. It is not started while a fullscreen app is in front.
#
# What a silent run cannot reach is the uninstaller's tick box "Also delete Doozer's
# save": unticked is the only way a silent uninstall goes. The check therefore proves the
# save is KEPT, and reads the installer's script to see that the box deletes what it says.
#
# It leaves the machine as it found it: when the checks are over the save the test pet
# made is removed (it is the test's own: there was none before, or the script would not
# have started), and anything a failed step left installed is uninstalled.

param(
  [string] $Setup = '',
  [string] $Out = '',
  [int] $Port = 9237
)

$ErrorActionPreference = 'Stop'
$app = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version
if (-not $Setup) { $Setup = Join-Path $app "src-tauri\target\release\bundle\nsis\Doozer_${version}_x64-setup.exe" }
$setupPath = (Resolve-Path $Setup).Path

$identifier = 'com.doozer.desktop'
$installDir = Join-Path $env:LOCALAPPDATA 'Doozer'
$exe = Join-Path $installDir 'doozer.exe'
$uninstaller = Join-Path $installDir 'uninstall.exe'
$saveDir = Join-Path $env:APPDATA $identifier
$cacheDir = Join-Path $env:LOCALAPPDATA $identifier
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Doozer.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Doozer.lnk'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Doozer'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$scratch = Join-Path ([IO.Path]::GetTempPath()) "doozer-install-checks-$PID"

$failures = [System.Collections.Generic.List[string]]::new()
$notes = [System.Collections.Generic.List[string]]::new()
function Check([bool] $ok, [string] $what) {
  if ($ok) { "  ok    $what" } else { "  FAIL  $what"; $failures.Add($what) }
}
function Note([string] $what) { "  note  $what"; $notes.Add($what) }

function Get-RunValue { (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).Doozer }
function Get-Doozers { @(Get-Process doozer -ErrorAction SilentlyContinue) }
function Wait-Until([scriptblock] $test, [int] $seconds) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  while ($clock.Elapsed.TotalSeconds -lt $seconds) {
    if (& $test) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return [bool](& $test)
}

Add-Type -Namespace Doozer -Name Shell -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("shell32.dll")]
public static extern int SHQueryUserNotificationState(out int state);
'@
function Test-FullscreenInFront {
  $state = 0
  [void][Doozer.Shell]::SHQueryUserNotificationState([ref] $state)
  # 2 busy, 3 a Direct3D app fullscreen, 4 presentation mode.
  return $state -in 2, 3, 4
}

# Ask the running app's page something (scripts/ask-page.mjs). The question goes in a file:
# quotes do not survive the trip through two shells.
function Ask-Page([string] $expression) {
  $file = Join-Path $scratch 'question.js'
  Set-Content -Path $file -Value $expression -Encoding utf8NoBOM
  $answer = & node (Join-Path $PSScriptRoot 'ask-page.mjs') --port $Port --file $file 2>&1
  if ($LASTEXITCODE -ne 0) { throw "the page did not answer: $answer" }
  return ($answer | Out-String).Trim()
}

function Start-Installed {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
  try { Start-Process -FilePath $exe | Out-Null }
  finally { Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue }
  # The page is there once it has chosen a view.
  $ready = Wait-Until {
    try { (Ask-Page 'document.querySelector("#host")?.childElementCount > 0 ? "ready" : "not yet"') -eq 'ready' } catch { $false }
  } 40
  return $ready
}

function Stop-Installed {
  # The page's own way out, as Quit in the menu ends: the shell is told to leave.
  try { [void](Ask-Page 'window.__TAURI_INTERNALS__.invoke("quit").then(() => "bye", () => "bye")') } catch { }
  if (-not (Wait-Until { (Get-Doozers).Count -eq 0 } 10)) { Get-Doozers | Stop-Process -Force -ErrorAction SilentlyContinue }
}

function Invoke-Uninstall {
  if (-not (Test-Path $uninstaller)) { return }
  # The uninstaller copies itself to the temp folder and carries on from there, so its
  # own process ending means nothing: wait for the program folder to go.
  Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
  [void](Wait-Until { -not (Test-Path $exe) -and -not (Test-Path $uninstaller) } 60)
  Start-Sleep -Seconds 2
}

# ---- nothing of Doozer may be here already -------------------------------------------

$inTheWay = @()
if ((Get-Doozers).Count) { $inTheWay += 'a Doozer is running' }
if (Test-Path $installDir) { $inTheWay += "Doozer is installed ($installDir)" }
if (Test-Path $uninstallKey) { $inTheWay += 'Doozer is listed under Installed apps' }
if (Test-Path $saveDir) { $inTheWay += "there is a save ($saveDir): somebody's pet lives on this machine" }
if (Get-RunValue) { $inTheWay += 'Doozer is registered to start with Windows' }
if ($inTheWay.Count) {
  "Not run. This check installs and removes the real thing, and it found:"
  $inTheWay | ForEach-Object { "  - $_" }
  exit 2
}
if (Test-FullscreenInFront) {
  'Not run: a fullscreen app is in front, and the installed Doozer would show over it. Try again later.'
  exit 2
}

New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$cacheWasThere = Test-Path $cacheDir
"installer: $setupPath"
"version:   $version"

try {
  # ---- 1. install ----------------------------------------------------------------------
  '1. install (silent)'
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $install = Start-Process -FilePath $setupPath -ArgumentList '/S' -Wait -PassThru
  Check ($install.ExitCode -eq 0) "the installer finished without an error (exit code $($install.ExitCode), $([math]::Round($clock.Elapsed.TotalSeconds, 1)) s)"
  Check (Test-Path $exe) "the program is in $installDir"
  Check (Test-Path $uninstaller) 'its uninstaller is beside it'
  Check (Test-Path (Join-Path $installDir 'THIRD-PARTY-NOTICES.txt')) 'the third-party notices are beside it'
  Check (Test-Path $startMenu) 'it is in the Start menu'
  if (Test-Path $desktop) { Note 'a silent install also puts a shortcut on the desktop' }
  $entry = Get-ItemProperty $uninstallKey -ErrorAction SilentlyContinue
  Check ($null -ne $entry) 'it is listed under Installed apps'
  if ($entry) {
    Check ($entry.DisplayVersion -eq $version) "listed as version $version (it says $($entry.DisplayVersion))"
    Check ($entry.DisplayName -eq 'Doozer') "listed by the name Doozer (it says $($entry.DisplayName))"
  }
  if (Test-Path $exe) {
    $fileVersion = (Get-Item $exe).VersionInfo.ProductVersion
    Check ($fileVersion -eq $version) "the program's own properties say $version (they say $fileVersion)"
    $size = [math]::Round(((Get-ChildItem $installDir -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
    Note "installed size: $size MB; the installer is $([math]::Round((Get-Item $setupPath).Length / 1MB, 1)) MB"
  }
  Check (-not (Get-RunValue)) 'installing does not register it to start with Windows'
  Check (-not (Test-Path $saveDir)) 'installing writes no save'
  Check ((Get-Doozers).Count -eq 0) 'a silent install does not start it'

  # ---- 2. the installed program runs ------------------------------------------------------
  '2. the installed program'
  if (Test-FullscreenInFront) { throw 'a fullscreen app came to the front; stopping before Doozer shows over it' }
  Check (Start-Installed) 'it starts and its page comes up'
  $page = Ask-Page 'document.documentElement.dataset.version ?? "none"'
  Check ($page -eq $version) "the page inside it is version $version (it says $page)"
  Check ((Ask-Page 'window.__TAURI_INTERNALS__.invoke("load_save").then((s) => s.source)') -eq 'none') 'it starts with no save: a new Doozer'
  # A second copy must leave at once.
  $second = Start-Process -FilePath $exe -PassThru
  Check ($second.WaitForExit(8000)) 'a second copy leaves by itself'
  Check ((Get-Doozers).Count -eq 1) 'one Doozer is running'
  # Something a person would do, through the page: open the Card and fill the bowl.
  $filled = Ask-Page @'
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const find = () => document.querySelector('[aria-label^="Fill the bowl"]');
  // A new Doozer starts in the Pill; a click on the pill opens the Card.
  const pill = document.querySelector('.pillv-pill');
  if (!pill) return 'no pill';
  if (!find()) pill.click();
  for (let i = 0; i < 50 && !find(); i++) await wait(100);
  const button = find();
  if (!button) return 'no bowl button on the Card';
  button.click();
  // Anything that happened is written within half a second (host/store.ts).
  await wait(1500);
  const saved = await window.__TAURI_INTERNALS__.invoke('load_save');
  return saved.source + ':' + (saved.data ? JSON.parse(saved.data).brain.pet.bowl : 'nothing');
})()
'@
  Check ($filled -match '^main:') "the bowl was filled from the Card and the save was written (the page says $filled)"
  Check (Test-Path (Join-Path $saveDir 'save.json')) "the save is in $saveDir"
  # Start with Windows, switched on in Settings as a person would. (Asking the shell to
  # register behind the app's back is no test: the app puts the Run key back in line with
  # its own setting at the next start, and takes the line out again.)
  $registered = Ask-Page @'
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const find = () => document.querySelector('[role="switch"][aria-label="Start with Windows"]');
  if (!find()) document.querySelector('[data-act="settings"]')?.click();
  for (let i = 0; i < 50 && !find(); i++) await wait(100);
  const toggle = find();
  if (!toggle) return 'no switch in Settings';
  if (toggle.getAttribute('aria-checked') !== 'true') toggle.click();
  // (The panel folds away by itself with no pointer on it, so the switch is not read back.)
  await wait(1500);
  const saved = await window.__TAURI_INTERNALS__.invoke('load_save');
  const kept = JSON.parse(saved.data).brain.settings.startWithWindows;
  return [await window.__TAURI_INTERNALS__.invoke('autostart_enabled'), kept].join(':');
})()
'@
  Check ($registered -eq 'true:true') "Start with Windows can be switched on in Settings: registered, and kept in the save (the page says $registered)"
  Check ((Get-RunValue) -eq "`"$exe`"") "the Run key holds the installed program's path (it holds $(Get-RunValue))"
  $saveBefore = if (Test-Path (Join-Path $saveDir 'save.json')) { Get-Content (Join-Path $saveDir 'save.json') -Raw } else { '' }

  # ---- 3. install again over the running copy: an update --------------------------------------
  '3. install again while it is running (an update)'
  $update = Start-Process -FilePath $setupPath -ArgumentList '/S' -Wait -PassThru
  Check ($update.ExitCode -eq 0) "the installer finished without an error (exit code $($update.ExitCode))"
  Check (Wait-Until { (Get-Doozers).Count -eq 0 } 10) 'the running copy was closed for it'
  Check (Test-Path $exe) 'the program is still there'
  Check ((Test-Path (Join-Path $saveDir 'save.json')) -and ((Get-Content (Join-Path $saveDir 'save.json') -Raw) -eq $saveBefore)) 'the save is untouched'
  Check ((Get-RunValue) -eq "`"$exe`"") 'Start with Windows is still registered'
  if (Test-FullscreenInFront) { throw 'a fullscreen app came to the front; stopping before Doozer shows over it' }
  Check (Start-Installed) 'it starts again'
  $again = Ask-Page 'window.__TAURI_INTERNALS__.invoke("load_save").then((s) => s.source + ":" + JSON.parse(s.data).brain.pet.bowl)'
  Check ($again -match '^main:[1-3]$') "it finds the same Doozer, bowl still filled (the page says $again)"
  Check ((Ask-Page 'window.__TAURI_INTERNALS__.invoke("autostart_enabled").then(String)') -eq 'true') 'and knows it is registered to start with Windows'
  Stop-Installed
  Check ((Get-Doozers).Count -eq 0) 'it quits when asked'

  # ---- 4. uninstall, keeping the save -----------------------------------------------------------
  '4. uninstall (silent: the save is kept)'
  Invoke-Uninstall
  Check (-not (Test-Path $exe)) 'the program is gone'
  Check (-not (Test-Path $installDir)) "its folder is gone ($installDir)"
  Check (-not (Test-Path $startMenu)) 'the Start menu shortcut is gone'
  Check (-not (Test-Path $desktop)) 'the desktop shortcut is gone'
  Check (-not (Test-Path $uninstallKey)) 'it is no longer listed under Installed apps'
  Check (-not (Get-RunValue)) 'it is no longer registered to start with Windows'
  Check (-not (Test-Path $cacheDir)) "the browser's cache is gone ($cacheDir)"
  Check ((Test-Path (Join-Path $saveDir 'save.json')) -and ((Get-Content (Join-Path $saveDir 'save.json') -Raw) -eq $saveBefore)) "the save is still there, unchanged ($saveDir)"

  # ---- 5. what the tick box would do, read from the installer's script -----------------------------
  '5. the tick box "Also delete Doozer''s save"'
  $script = Join-Path (Split-Path $setupPath -Parent) '..\..\nsis\x64\installer.nsi'
  if (Test-Path $script) {
    $text = Get-Content $script -Raw
    Check ($text -match 'DeleteAppDataCheckboxState\s*=\s*1') 'the uninstaller deletes data only when the box is ticked'
    Check ($text -match 'RmDir /r "\$APPDATA\\\$\{BUNDLEID\}"') 'and what it deletes then is the save folder, by the identifier'
    Check ($text -match [regex]::Escape("!define BUNDLEID `"$identifier`"")) "the identifier in the installer is $identifier"
    $runLine = 'DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"'
    Check ($text.Contains($runLine)) 'the uninstaller removes the Start with Windows entry, by the product''s name'
    # Tauri's own wording is copied beside the script; Doozer's is included from the source tree.
    $wording = [regex]::Match($text, '!include\s+"([^"]*English\.nsh)"').Groups[1].Value
    if ($wording -and -not [IO.Path]::IsPathRooted($wording)) { $wording = Join-Path (Split-Path $script -Parent) $wording }
    $words = if ($wording -and (Test-Path $wording)) { Get-Content $wording -Raw } else { '' }
    Check ($words.Contains("Also delete Doozer's save")) "the tick box is worded for a pet (the installer's English is $wording)"
    Check ($words -and -not (($words -split "`n" | Where-Object { $_ -match '^\W*LangString' } | ForEach-Object { ($_ -split ' ', 4)[3] }) -match '(?i)kill')) 'nothing the installer says speaks of killing'
    Note 'the box itself was not ticked by this check: a silent uninstall cannot reach it'
  } else {
    Note "the installer's script is not beside this installer ($script), so the tick box was not read"
  }
}
catch {
  "  FAIL  the check stopped: $_"
  $failures.Add("the check stopped: $_")
}
finally {
  # Leave the machine as it was found.
  Get-Doozers | Stop-Process -Force -ErrorAction SilentlyContinue
  if (Test-Path $uninstaller) { 'cleaning up: uninstalling what a failed step left'; Invoke-Uninstall }
  $value = Get-RunValue
  if ($value -and $value -eq "`"$exe`"") { Remove-ItemProperty $runKey -Name Doozer -ErrorAction SilentlyContinue }
  # The test pet. There was no save when this started, so this one is the check's own.
  if (Test-Path $saveDir) { Remove-Item -Recurse -Force $saveDir -ErrorAction SilentlyContinue }
  $left = @()
  if (Test-Path $installDir) { $left += $installDir }
  if (Test-Path $saveDir) { $left += $saveDir }
  if (Test-Path $uninstallKey) { $left += 'the Installed apps entry' }
  if (Get-RunValue) { $left += 'the Run key value' }
  if (Test-Path $startMenu) { $left += $startMenu }
  if (Test-Path $desktop) { $left += $desktop }
  if ($left.Count) { $failures.Add("left behind: $($left -join ', ')"); "  FAIL  left behind: $($left -join ', ')" }
  if ($cacheWasThere -and -not (Test-Path $cacheDir)) { Note "the browser's cache that was here before ($cacheDir) went with the uninstall; the next start makes a new one" }
  if ($Out) {
    New-Item -ItemType Directory -Force -Path $Out | Out-Null
    [pscustomobject]@{ installer = $setupPath; version = $version; failures = @($failures); notes = @($notes) } |
      ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $Out 'install-checks.json') -Encoding utf8NoBOM
  }
  Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
}

''
if ($failures.Count) { "FAILED: $($failures.Count)"; $failures | ForEach-Object { "  - $_" }; exit 1 }
'all ok'
