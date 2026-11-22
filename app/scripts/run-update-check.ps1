# Checks the way up from an older version: install the old one, give it a pet and some
# settings, install the new one over it while it runs, and see that the same pet and the
# same settings are there. Then uninstall and leave the machine as it was found.
# See docs/release.md, "Ready to publish".
#
#   pwsh app/scripts/run-update-check.ps1 -Old <old setup .exe> [-New <new setup .exe>]
#
# Like run-install-checks.ps1 it installs and removes the real thing in the real places,
# silently and without the mouse, and refuses to start where a Doozer is installed,
# running or saved. It works the installed app through its page over the browser's
# debugging port, pressing the Card's and the Settings panel's own buttons. Doozer is on
# screen for about half a minute. Not started while a fullscreen app is in front.

param(
  [Parameter(Mandatory)] [string] $Old,
  [string] $New = '',
  [int] $Port = 9239
)

$ErrorActionPreference = 'Stop'
$app = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version
if (-not $New) { $New = Join-Path $app "src-tauri\target\release\bundle\nsis\Doozer_${version}_x64-setup.exe" }
$oldPath = (Resolve-Path $Old).Path
$newPath = (Resolve-Path $New).Path
$oldVersion = if ((Split-Path $oldPath -Leaf) -match '^Doozer_(\d+\.\d+\.\d+)_') { $Matches[1] } else { '?' }

$installDir = Join-Path $env:LOCALAPPDATA 'Doozer'
$exe = Join-Path $installDir 'doozer.exe'
$uninstaller = Join-Path $installDir 'uninstall.exe'
$saveDir = Join-Path $env:APPDATA 'com.doozer.desktop'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Doozer'
$makerKey = 'HKCU:\Software\Doozer'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Doozer.lnk'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Doozer.lnk'
$scratch = Join-Path ([IO.Path]::GetTempPath()) "doozer-update-check-$PID"
$mine = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

$failures = [System.Collections.Generic.List[string]]::new()
function Check([bool] $ok, [string] $what) { if ($ok) { "  ok    $what" } else { "  FAIL  $what"; $failures.Add($what) } }
function Get-Doozers { @(Get-Process doozer -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) }
function Get-RunValue { (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).Doozer }
function Wait-Until([scriptblock] $test, [int] $seconds) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  while ($clock.Elapsed.TotalSeconds -lt $seconds) { if (& $test) { return $true }; Start-Sleep -Milliseconds 250 }
  return [bool](& $test)
}
Add-Type -Namespace Doozer -Name Update -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
'@
function Test-FullscreenInFront { $state = 0; [void][Doozer.Update]::SHQueryUserNotificationState([ref] $state); return $state -in 2, 3, 4 }

function Ask-Page([string] $expression) {
  $file = Join-Path $scratch 'question.js'
  Set-Content -Path $file -Value $expression -Encoding utf8NoBOM
  $answer = & node (Join-Path $PSScriptRoot 'ask-page.mjs') --port $Port --file $file 2>&1
  if ($LASTEXITCODE -ne 0) { throw "the page did not answer: $answer" }
  return ($answer | Out-String).Trim()
}
function Start-Installed {
  if (Test-FullscreenInFront) { throw 'a fullscreen app is in front; Doozer is not started over it' }
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
  try { $mine.Add((Start-Process -FilePath $exe -PassThru)) }
  finally { Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue }
  return (Wait-Until { try { (Ask-Page 'document.querySelector("#host")?.childElementCount > 0 ? "ready" : "not yet"') -eq 'ready' } catch { $false } } 40)
}
function Stop-Installed {
  try { [void](Ask-Page 'window.__TAURI_INTERNALS__.invoke("quit").then(() => "bye", () => "bye")') } catch { }
  if (-not (Wait-Until { (Get-Doozers).Count -eq 0 } 10)) { Get-Doozers | Stop-Process -Force -ErrorAction SilentlyContinue }
}
function Install([string] $setup) {
  $process = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
  return $process.ExitCode
}
function Remove-UninstallerCopies {
  foreach ($folder in @(Get-ChildItem ([IO.Path]::GetTempPath()) -Directory -Filter '~nsu*.tmp' -ErrorAction SilentlyContinue)) {
    $copy = Join-Path $folder.FullName 'Un.exe'
    if (-not (Test-Path $copy) -or (Get-Item $copy).VersionInfo.ProductName -ne 'Doozer') { continue }
    if (@(Get-Process | Where-Object { $_.Path -eq $copy }).Count) { continue }
    Remove-Item -LiteralPath $folder.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# What is in the save: the pet's birth, its bowl and treats, and the settings that were changed.
$readSave = 'window.__TAURI_INTERNALS__.invoke("load_save").then((s) => { if (!s.data) return "none"; const d = JSON.parse(s.data).brain; return JSON.stringify({ source: s.source, bornAt: d.pet.bornAt, name: d.pet.name, bowl: d.pet.bowl, treats: d.pet.treats, palette: d.settings.palette, sound: d.settings.sound, desktopActivity: d.settings.desktopActivity, sessions: d.progress.sessions }); })'

# Give the pet something to remember: fill its bowl from the Card, and in Settings choose
# Mint, switch Sound on and set the Desktop activity to Still, each by its own control.
$lookAfter = @'
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const until = async (find) => { for (let i = 0; i < 50 && !find(); i++) await wait(100); return find(); };
  const pill = q('.pillv-pill');
  if (!pill) return 'no pill';
  if (!q('[aria-label^="Fill the bowl"]')) pill.click();
  const bowl = await until(() => q('[aria-label^="Fill the bowl"]'));
  if (!bowl) return 'no bowl button';
  bowl.click();
  await wait(300);
  const done = [];
  for (const [what, find] of [
    ['mint', () => q('.dzk-swatch[data-value="mint"]')],
    ['sound', () => q('[role="switch"][aria-label="Sound"]')],
    ['still', () => [...document.querySelectorAll('[role="radiogroup"] [role="radio"]')].find((b) => b.textContent.trim() === 'Still')],
  ]) {
    // The panel folds away by itself with no pointer on it: open it again for each control.
    if (!find()) { q('[data-act="settings"]')?.click() ?? pill.click(); }
    if (!find()) { if (!q('[data-act="settings"]')) pill.click(); await until(() => q('[data-act="settings"]')); q('[data-act="settings"]')?.click(); }
    const control = await until(find);
    if (!control) return 'no control for ' + what + ' (done: ' + done.join(',') + ')';
    if (what !== 'sound' || control.getAttribute('aria-checked') !== 'true') control.click();
    done.push(what);
    await wait(250);
  }
  await wait(1200);
  return 'done:' + done.join(',');
})()
'@

# ---- nothing of Doozer may be here already ------------------------------------------------
$inTheWay = @()
if (@(Get-Process doozer -ErrorAction SilentlyContinue).Count) { $inTheWay += 'a Doozer is running (or a test of one)' }
if (Test-Path $installDir) { $inTheWay += "Doozer is installed ($installDir)" }
if (Test-Path $uninstallKey) { $inTheWay += 'Doozer is listed under Installed apps' }
if (Test-Path $saveDir) { $inTheWay += "there is a save ($saveDir): somebody's pet lives on this machine" }
if (Test-Path $makerKey) { $inTheWay += "the installer's own key is there ($makerKey)" }
if (Get-RunValue) { $inTheWay += 'Doozer is registered to start with Windows' }
if ($inTheWay.Count) { 'Not run. It found:'; $inTheWay | ForEach-Object { "  - $_" }; exit 2 }
if (Test-FullscreenInFront) { 'Not run: a fullscreen app is in front.'; exit 2 }
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
"old: $oldPath"
"new: $newPath"

try {
  "1. version $oldVersion, with a pet"
  Check ((Install $oldPath) -eq 0) "version $oldVersion installs"
  Check (Start-Installed) 'it starts'
  Check ((Ask-Page 'document.documentElement.dataset.version ?? "none"') -eq $oldVersion) "the page is $oldVersion"
  $did = Ask-Page $lookAfter
  Check ($did -eq 'done:mint,sound,still') "the bowl filled; Mint, Sound on and Still chosen in Settings (the page says $did)"
  $before = Ask-Page $readSave | ConvertFrom-Json
  Check ($before.source -eq 'main' -and $before.bowl -eq 3 -and $before.palette -eq 'mint' -and $before.sound -eq $true -and $before.desktopActivity -eq 'still') "the save holds it all: bowl $($before.bowl), $($before.palette), sound $($before.sound), $($before.desktopActivity)"

  "2. version $version installed over it, while it runs"
  Check ((Install $newPath) -eq 0) "version $version installs"
  Check (Wait-Until { (Get-Doozers).Count -eq 0 } 10) 'the running copy was closed for it'
  Check ((Get-Item $exe).VersionInfo.ProductVersion -eq $version) "the program is now $version"
  Check (Start-Installed) 'it starts'
  Check ((Ask-Page 'document.documentElement.dataset.version ?? "none"') -eq $version) "the page is $version"
  $after = Ask-Page $readSave | ConvertFrom-Json
  Check ($after.bornAt -eq $before.bornAt -and $after.name -eq $before.name) "the same pet: born at the same moment, the same name"
  Check ($after.bowl -eq $before.bowl -and $after.treats -eq $before.treats -and $after.sessions -eq $before.sessions) "its bowl, treats and sessions as they were ($($after.bowl), $($after.treats), $($after.sessions))"
  Check ($after.palette -eq 'mint' -and $after.sound -eq $true -and $after.desktopActivity -eq 'still') "the same settings: $($after.palette), sound $($after.sound), $($after.desktopActivity)"
  $colour = Ask-Page 'getComputedStyle(document.querySelector(".dz") ?? document.body).getPropertyValue("--dz-body").trim().toLowerCase()'
  Check ($colour -eq '#a9e8cf') "Doozer is drawn in Mint (its body colour is $colour)"
  Stop-Installed

  '3. uninstall'
  Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
  Check (Wait-Until { -not (Test-Path $installDir) } 60) 'the program is gone'
  Start-Sleep -Seconds 2
  Check (-not (Test-Path $uninstallKey) -and -not (Test-Path $makerKey)) 'its registry keys are gone'
}
catch { Check $false "stopped: $_" }
finally {
  foreach ($process in $mine) { if (-not $process.HasExited) { try { $process.Kill() } catch { } } }
  Get-Doozers | Stop-Process -Force -ErrorAction SilentlyContinue
  if (Test-Path $uninstaller) { Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait; [void](Wait-Until { -not (Test-Path $installDir) } 60); Start-Sleep -Seconds 2 }
  $value = Get-RunValue
  if ($value -and $value -eq "`"$exe`"") { Remove-ItemProperty $runKey -Name Doozer -ErrorAction SilentlyContinue }
  # The test pet. There was no save when this started, so this one is the check's own.
  if (Test-Path $saveDir) { Remove-Item -Recurse -Force $saveDir -ErrorAction SilentlyContinue }
  Remove-UninstallerCopies
  $left = @()
  foreach ($path in $installDir, $saveDir, $desktop, $startMenu) { if (Test-Path $path) { $left += $path } }
  foreach ($key in $uninstallKey, $makerKey) { if (Test-Path $key) { $left += $key } }
  if ($left.Count) { Check $false "left behind: $($left -join ', ')" }
  Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
}
''
if ($failures.Count) { "FAILED: $($failures.Count)"; $failures | ForEach-Object { "  - $_" }; exit 1 }
'all ok'
