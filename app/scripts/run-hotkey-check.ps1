# Presses the real Ctrl+Alt+D at the program itself, in each view, and reports who has the
# keyboard afterwards. See docs/polish-checks.md, section 20.
#
#   pwsh app/scripts/run-hotkey-check.ps1                       # the release build, every view
#   pwsh app/scripts/run-hotkey-check.ps1 -Views room,island
#   pwsh app/scripts/run-hotkey-check.ps1 -Exe <another build without DOOZER_SPIKE set>
#
# Why this beside run-polish-checks.ps1: a test run of the app does not register the
# shortcut (several run at once, on a machine somebody is using), so the keyboard check
# there calls the shortcut's handler without a key press behind it. Windows lets a program
# take the keyboard on a key press it was sent, and otherwise only when it feels like it:
# not while somebody is typing elsewhere, and not after a day with nobody at the machine.
# Here the key press is real (injected, which Windows delivers to whoever registered the
# shortcut exactly as a finger's would be), and the program is the one that ships.
#
# What it does: starts the program with a scratch save and a scratch browser profile, on
# screen. For each view: opens the Card with the shortcut and clicks the view's button in
# it (the page's own click, not the mouse); then waits for a quiet moment, presses the
# shortcut again, and watches for three seconds, some twenty times a second, who has the
# keyboard and whether the person at the machine did anything meanwhile. Then Escape, and
# who has the keyboard after that.
#
# What it takes from whoever is at the machine: the keyboard, for up to three seconds, twice
# for each view. A click elsewhere takes it back, as it should, and that view is then
# reported as interrupted, to be run again. Escape is pressed only while Doozer's own
# window has the keyboard. It refuses to run if a copy of Doozer is already running, if
# another program has the shortcut, or over a full-screen program. It ends only the copy it
# started, and leaves nothing behind.
#
# The views are taken in the order given, starting from the Pill (a new save's view): put
# the Pill last, as the default does, so that every step is a change of view.

param(
  [string] $Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\release\doozer.exe'),
  [string[]] $Views = @('room', 'island', 'desktop', 'pill'),
  [string] $Scratch = (Join-Path ([IO.Path]::GetTempPath()) "doozer-polish\hotkey-$PID"),
  [int] $QuietMs = 4000,
  [int] $WaitForQuietSeconds = 45,
  [int] $Port = 9237,
  [string] $AskPage = (Join-Path $PSScriptRoot 'ask-page.mjs')
)

$ErrorActionPreference = 'Stop'
$Views = @($Views | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
Add-Type -Namespace Desk -Name Trace -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
[DllImport("kernel32.dll")] public static extern uint GetTickCount();
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
[DllImport("user32.dll", SetLastError = true)] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint vk);
[DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
'@

function Get-LastInputTick {
  $info = New-Object Desk.Trace+LASTINPUTINFO
  $info.cbSize = 8
  [void][Desk.Trace]::GetLastInputInfo([ref]$info)
  $info.dwTime
}
function Get-IdleMs { [int]([Desk.Trace]::GetTickCount() - (Get-LastInputTick)) }
function Get-Front {
  $h = [Desk.Trace]::GetForegroundWindow()
  $procId = 0
  if ($h -ne [IntPtr]::Zero) { [void][Desk.Trace]::GetWindowThreadProcessId($h, [ref]$procId) }
  $name = if ($procId) { (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName } else { 'none' }
  [pscustomobject]@{ hwnd = $h.ToInt64(); pid = [int]$procId; name = $name }
}
function Get-KeysDown {
  $down = @()
  foreach ($vk in 1..254) { if (([Desk.Trace]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { $down += $vk } }
  , $down
}
# True if nobody has Ctrl+Alt+D: it could be registered here (and is at once given up again).
function Test-ShortcutFree {
  $ok = [Desk.Trace]::RegisterHotKey([IntPtr]::Zero, 0x0B00, 3, 0x44)
  if ($ok) { [void][Desk.Trace]::UnregisterHotKey([IntPtr]::Zero, 0x0B00) }
  $ok
}
function Send-Key([byte] $vk, [switch] $Up) { [Desk.Trace]::keybd_event($vk, 0, $(if ($Up) { 2 } else { 0 }), [UIntPtr]::Zero) }
# Waits for a pause, and in any case until no key or button is down (never in the middle of
# somebody's own key press), then presses Ctrl+Alt+D.
function Send-Shortcut([int] $quietMs = 250, [int] $waitSeconds = 30) {
  $wait = [Diagnostics.Stopwatch]::StartNew()
  while (((Get-KeysDown).Count -or (Get-IdleMs) -lt $quietMs) -and $wait.Elapsed.TotalSeconds -lt $waitSeconds) { Start-Sleep -Milliseconds 40 }
  $wait.Restart()
  while ((Get-KeysDown).Count -and $wait.Elapsed.TotalSeconds -lt 20) { Start-Sleep -Milliseconds 40 }
  if ((Get-KeysDown).Count) { return $false }
  $script:idleBefore = Get-IdleMs
  Send-Key 0x11; Send-Key 0x12; Send-Key 0x44
  Send-Key 0x44 -Up; Send-Key 0x12 -Up; Send-Key 0x11 -Up
  $true
}
function Send-EscapeIfOurs([int] $ourId) {
  if ((Get-Front).pid -ne $ourId) { return $false }
  Send-Key 0x1B; Send-Key 0x1B -Up
  $true
}
function Stop-Tree([int] $rootId) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId
  $ids = [System.Collections.Generic.List[int]]::new(); $ids.Add($rootId)
  $added = $true
  while ($added) {
    $added = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { $ids.Add([int]$p.ProcessId); $added = $true }
    }
  }
  foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}
function Ask-Page([string] $file) {
  try { (node $AskPage --port $Port --file $file 2>$null | Out-String | ConvertFrom-Json) } catch { $null }
}

$failures = [System.Collections.Generic.List[string]]::new()
$state = 0
[void][Desk.Trace]::SHQueryUserNotificationState([ref]$state)
if ($state -ne 5) { "not run: Windows says the screen is not an ordinary desktop just now (state $state)"; exit 3 }
if (@(Get-Process doozer -ErrorAction SilentlyContinue).Count) { 'not run: a copy of Doozer is already running, and it is not this script''s'; exit 3 }
if (-not (Test-ShortcutFree)) { 'not run: another program already has Ctrl+Alt+D'; exit 3 }
$realSave = Join-Path $env:APPDATA 'com.doozer.desktop'
$realCache = Join-Path $env:LOCALAPPDATA 'com.doozer.desktop'
$hadSave = Test-Path $realSave
$hadCache = Test-Path $realCache

$exePath = (Resolve-Path $Exe).Path
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
# The Card that holds the focused element, and the view it says is showing.
$find = @'
  const a = document.activeElement;
  let root = a;
  while (root && !(root.querySelector && root.querySelector('.dzk-views'))) root = root.parentElement;
  const shown = root ? root.querySelector('.dzk-view[aria-pressed="true"]') : null;
'@
$stateFile = Join-Path $Scratch 'state.js'
Set-Content -Path $stateFile -Encoding utf8 -Value @"
(() => {
$find
  return JSON.stringify({
    focus: document.hasFocus(),
    act: a && a.dataset && a.dataset.act ? a.dataset.act : null,
    view: shown ? shown.dataset.view : null,
  });
})()
"@
$switchFile = Join-Path $Scratch 'switch.js'
function Set-SwitchQuestion([string] $view) {
  Set-Content -Path $switchFile -Encoding utf8 -Value @"
(() => {
$find
  const button = root ? root.querySelector('.dzk-view[data-view="$view"]') : null;
  if (!button) return JSON.stringify({ clicked: false, why: 'no button for $view in the open Card' });
  if (button.disabled) return JSON.stringify({ clicked: false, why: 'the button is disabled' });
  button.click();
  return JSON.stringify({ clicked: true, from: shown ? shown.dataset.view : null });
})()
"@
}

$env:DOOZER_SAVE_DIR = Join-Path $Scratch 'save'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $Scratch 'webview'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
$app = Start-Process -FilePath $exePath -PassThru
Remove-Item Env:DOOZER_SAVE_DIR, Env:WEBVIEW2_USER_DATA_FOLDER, Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
"started $($app.Id): $([IO.Path]::GetFileName($exePath)) $((Get-Item $exePath).VersionInfo.ProductVersion), $((Get-Item $exePath).Length) bytes"

try {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $page = $null
  while (-not $page -and $clock.Elapsed.TotalSeconds -lt 40) {
    Start-Sleep -Milliseconds 700
    if ($app.HasExited) { break }
    $page = Ask-Page $stateFile
  }
  if (-not $page) { throw 'the page never answered' }
  Start-Sleep -Seconds 3
  if ((Get-Front).pid -eq $app.Id) { $failures.Add('Doozer took the keyboard just by starting') }
  if (Test-ShortcutFree) { throw 'Doozer did not register Ctrl+Alt+D' }
  'Ctrl+Alt+D is registered, and starting took no keyboard'

  foreach ($view in $Views) {
    # Change the view: the Card by the shortcut, then its button for the view.
    if (-not (Send-Shortcut)) { $failures.Add("${view}: the shortcut could not be pressed to change the view"); continue }
    Start-Sleep -Milliseconds 500
    Set-SwitchQuestion $view
    $clicked = Ask-Page $switchFile
    if (-not $clicked.clicked) { $failures.Add("${view}: could not change to this view ($($clicked.why))"); [void](Send-EscapeIfOurs $app.Id); Start-Sleep -Milliseconds 600; continue }
    # The old view's Card goes with it, and the keyboard with the Card.
    $wait = [Diagnostics.Stopwatch]::StartNew()
    while ((Get-Front).pid -eq $app.Id -and $wait.Elapsed.TotalSeconds -lt 8) { Start-Sleep -Milliseconds 200 }
    if ((Get-Front).pid -eq $app.Id) { [void](Send-EscapeIfOurs $app.Id); Start-Sleep -Milliseconds 700 }
    "changed to ${view} (from $($clicked.from))"
    Start-Sleep -Seconds 4

    $had = Get-Front
    if ($had.pid -eq $app.Id) { $failures.Add("${view}: Doozer already had the keyboard before the press"); continue }
    if (-not (Send-Shortcut $QuietMs $WaitForQuietSeconds)) { $failures.Add("${view}: the shortcut could not be pressed"); continue }
    $pressTick = Get-LastInputTick          # the key press made here is the last input now
    $cursor0 = New-Object Desk.Trace+POINT
    [void][Desk.Trace]::GetCursorPos([ref]$cursor0)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $tookAt = $null; $lostAt = $null; $lostTo = $null
    $firstInputAt = $null; $firstButtonAt = $null; $firstKeyAt = $null; $keys = @{}; $moved = $false
    foreach ($vk in 1, 2, 4) { [void][Desk.Trace]::GetAsyncKeyState($vk) }    # clear "pressed since the last look"
    while ($watch.ElapsedMilliseconds -lt 3000) {
      $t = $watch.ElapsedMilliseconds
      $h = [Desk.Trace]::GetForegroundWindow()
      $procId = 0
      if ($h -ne [IntPtr]::Zero) { [void][Desk.Trace]::GetWindowThreadProcessId($h, [ref]$procId) }
      if ($procId -eq $app.Id) { if ($null -eq $tookAt) { $tookAt = $t } }
      elseif ($null -ne $tookAt -and $null -eq $lostAt) { $lostAt = $t; $lostTo = (Get-Front).name }
      if ($null -eq $firstInputAt -and (Get-LastInputTick) -ne $pressTick) { $firstInputAt = $t }
      foreach ($vk in 1, 2, 4) { if (([Desk.Trace]::GetAsyncKeyState($vk) -band 0x8001) -ne 0 -and $null -eq $firstButtonAt) { $firstButtonAt = $t } }
      foreach ($vk in 8..254) { if (([Desk.Trace]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { $keys[$vk] = $t; if ($null -eq $firstKeyAt) { $firstKeyAt = $t } } }
      $now = New-Object Desk.Trace+POINT
      [void][Desk.Trace]::GetCursorPos([ref]$now)
      if ($now.x -ne $cursor0.x -or $now.y -ne $cursor0.y) { $moved = $true }
      Start-Sleep -Milliseconds 25
    }
    $late = Ask-Page $stateFile
    $escaped = Send-EscapeIfOurs $app.Id
    Start-Sleep -Milliseconds 600
    $back = Get-Front
    $closed = Ask-Page $stateFile

    $record = [ordered]@{
      view = $view; viewTheCardSays = $late.view; idleMsBefore = $script:idleBefore; inFrontBefore = $had.name
      tookKeyboardAtMs = $tookAt
      lostKeyboardAtMs = $lostAt; lostTo = $lostTo
      personsFirstInputAtMs = $firstInputAt; firstMouseButtonAtMs = $firstButtonAt; firstKeyAtMs = $firstKeyAt
      keysSeen = @($keys.Keys | Sort-Object); pointerMoved = $moved
      focusOnAt3000 = $late.act; pageFocusAt3000 = [bool]$late.focus
      escapePressed = $escaped; keyboardBackTo = $back.name; backToTheSameWindow = ($back.hwnd -eq $had.hwnd)
      focusOnAfterEscape = $closed.act
    }
    "${view}: " + ($record | ConvertTo-Json -Compress)
    if ($null -eq $tookAt) { $failures.Add("${view}: the window never got the keyboard") }
    elseif ($null -ne $lostAt) {
      $clickBefore = ($null -ne $firstButtonAt -and $firstButtonAt -le $lostAt + 60) -or ($null -ne $firstKeyAt -and $firstKeyAt -le $lostAt + 60)
      if ($null -eq $firstInputAt -or $firstInputAt -gt $lostAt) { $failures.Add("${view}: the window let go of the keyboard at $lostAt ms with nobody touching the machine") }
      elseif ($clickBefore) { "  (${view}: lost at $lostAt ms, after the person's own click or key: not a fault of Doozer's, but not a full pass either)"; $failures.Add("${view}: interrupted by the person at the machine; run again") }
      else { $failures.Add("${view}: the window let go of the keyboard at $lostAt ms while the pointer only moved (first movement at $firstInputAt ms)") }
    }
    else {
      if ($late.act -ne 'feed') { $failures.Add("${view}: after three seconds the focus was on '$($late.act)', not on the Card's first action") }
      if ($late.view -ne $view) { $failures.Add("${view}: the Card says the view is '$($late.view)'") }
      if ($escaped -and -not $record.backToTheSameWindow) { $failures.Add("${view}: after Escape the keyboard went to $($back.name)") }
      if ($escaped -and $closed.act -eq 'feed' -and $closed.focus) { $failures.Add("${view}: Escape did not close the Card") }
    }
    Start-Sleep -Milliseconds 1000
  }
}
catch { "stopped early: $($_.Exception.Message)"; $failures.Add("stopped early: $($_.Exception.Message)") }
finally {
  Stop-Tree $app.Id
  Start-Sleep -Milliseconds 800
  for ($i = 0; $i -lt 8 -and (Test-Path $Scratch); $i++) {
    Remove-Item -Recurse -Force $Scratch -ErrorAction SilentlyContinue
    if (Test-Path $Scratch) { Start-Sleep -Milliseconds 700 }
  }
  $scratchHome = Split-Path $Scratch -Parent
  if ((Split-Path $scratchHome -Leaf) -eq 'doozer-polish' -and (Test-Path $scratchHome) -and -not (Get-ChildItem $scratchHome -Force)) { Remove-Item $scratchHome -Force -ErrorAction SilentlyContinue }
  # The program makes its (empty) cache folder even with a scratch profile: gone again if it was not there before.
  if (-not $hadCache -and (Test-Path $realCache) -and -not (Get-ChildItem $realCache -Force)) { Remove-Item $realCache -Force -ErrorAction SilentlyContinue }
  "the copy started here is gone: " + -not [bool](Get-Process -Id $app.Id -ErrorAction SilentlyContinue)
  "scratch folder removed: " + -not (Test-Path $Scratch)
  "real save folder: before=$hadSave after=$(Test-Path $realSave); real cache folder: before=$hadCache after=$(Test-Path $realCache)"
  "Ctrl+Alt+D free again: " + (Test-ShortcutFree)
}

''
if ($failures.Count) { "FAILED ($($failures.Count))"; $failures | ForEach-Object { "  - $_" }; exit 1 }
"ok: the real shortcut in $($Views.Count) views"
exit 0
