# Runs the scripted checks of the real app (app/src/spike/app-scenarios.ts) and prints
# what failed. See docs/pill-checks.md.
#
#   pwsh app/scripts/run-app-checks.ps1                 # all four, nothing shown on screen
#   pwsh app/scripts/run-app-checks.ps1 -Only app-stuck
#   pwsh app/scripts/run-app-checks.ps1 -Show           # let the window be seen
#
# Needs a build with the test hooks:
#   npx vite build
#   cargo build --release --features spike,tauri/custom-protocol      (in app/src-tauri)
#
# The runs keep the real mouse out (a pretend cursor is fed to the shell), never touch
# the real save (a scratch folder is used) and never write the real "start with
# Windows" key (a scratch registry key is used and removed afterwards). Without -Show
# the window is cloaked: nothing appears on screen.

param(
  [string] $Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\release\doozer.exe'),
  [string[]] $Only = @(),
  # Where to keep the reports. Default: a scratch folder that is removed at the end.
  [string] $Out = '',
  # How far ahead "the next morning" is, at the least. It is always made far enough to be
  # the next day by the calendar (see Get-Night).
  [double] $NightHours = 14,
  [switch] $Show
)

$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path $Exe).Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) "doozer-checks-$PID"
$saveDir = Join-Path $scratch 'save'
$outDir = if ($Out) { $Out } else { Join-Path $scratch 'out' }
New-Item -ItemType Directory -Force -Path $saveDir, $outDir | Out-Null
$scratchKey = "Software\DoozerTests\checks-$PID"

$env:DOOZER_SAVE_DIR = $saveDir
$env:DOOZER_SPIKE_OUT = $outDir
$env:DOOZER_AUTOSTART_KEY = $scratchKey
if ($Show) { Remove-Item Env:DOOZER_SPIKE_CLOAK -ErrorAction SilentlyContinue } else { $env:DOOZER_SPIKE_CLOAK = '1' }

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

# One run of the app: a scenario, optional arguments, a time limit. Returns the report.
function Invoke-Scenario([string] $name, [hashtable] $arguments = @{}, [int] $limitSeconds = 240) {
  $arguments.tag = $name
  $env:DOOZER_SPIKE = $name
  $env:DOOZER_SPIKE_ARGS = ($arguments | ConvertTo-Json -Compress)
  $report = Join-Path $outDir "$name.json"
  Remove-Item $report -ErrorAction SilentlyContinue
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $app = Start-Process -FilePath $exePath -PassThru
  $exited = $app.WaitForExit($limitSeconds * 1000)
  if (-not $exited) { Stop-Tree $app.Id }
  $result = [pscustomobject]@{ name = $name; seconds = [math]::Round($clock.Elapsed.TotalSeconds, 1); exited = $exited; exitCode = $null; failures = @(); report = $null }
  if ($exited) { $result.exitCode = $app.ExitCode }
  if (-not $exited) { $result.failures += "the app did not finish and quit within $limitSeconds s" }
  if (Test-Path $report) {
    $result.report = Get-Content $report -Raw | ConvertFrom-Json
    $scenario = $result.report.scenarios.$name
    if ($null -eq $scenario) { $result.failures += 'the report has no entry for this scenario' }
    else { $result.failures += @($scenario.failures) }
  } else {
    $result.failures += 'no report was written'
  }
  $result
}

# How far ahead the second day's clock is set, in ms: $NightHours after now, if that is
# tomorrow by the calendar; otherwise eight o'clock tomorrow morning. A streak counts days,
# not hours. With fourteen hours and nothing else, this check failed whenever it was run
# between midnight and ten in the morning, when fourteen hours on is still today (found at
# two minutes past midnight, the first time it was ever run at that hour). Either way the
# night is longer than the twelve hours of it the pet lives through, so Doozer wakes the same.
# "Tomorrow" is the day after the one the first day ended on ($firstDayEndedAt, from its
# report), in case midnight fell between the two runs.
function Get-Night([object] $firstDayEndedAt) {
  $now = Get-Date
  $firstDay = if ($firstDayEndedAt) { [DateTimeOffset]::FromUnixTimeMilliseconds([long]$firstDayEndedAt).LocalDateTime.Date } else { $now.Date }
  $then = $now.AddHours($NightHours)
  if ($then.Date -ne $firstDay.AddDays(1)) { $then = $firstDay.AddDays(1).AddHours(8) }
  if ($then -le $now) { $then = $now.AddMinutes(1) }
  return [long]($then - $now).TotalMilliseconds
}

$plan = @(
  @{ name = 'app-day1'; args = @{} },
  @{ name = 'app-day2'; args = @{} },
  @{ name = 'app-stuck'; args = @{} },
  @{ name = 'app-window'; args = @{} }
)
if ($Only.Count) { $plan = $plan | Where-Object { $Only -contains $_.name } }

$results = @()
try {
  foreach ($step in $plan) {
    "running $($step.name) ..."
    # Worked out now, not when the list was made: the first day may have run over midnight.
    if ($step.name -eq 'app-day2') {
      $first = @($results | Where-Object { $_.name -eq 'app-day1' })[0]
      $step.args.clockOffsetMs = Get-Night $first.report.scenarios.'app-day1'.savedAt
    }
    $results += Invoke-Scenario $step.name $step.args
  }
}
finally {
  Remove-Item "HKCU:\$scratchKey" -Recurse -Force -ErrorAction SilentlyContinue
  if (-not (Get-ChildItem 'HKCU:\Software\DoozerTests' -ErrorAction SilentlyContinue)) {
    Remove-Item 'HKCU:\Software\DoozerTests' -Force -ErrorAction SilentlyContinue
  }
}

''
$failed = 0
foreach ($r in $results) {
  $count = @($r.failures).Count
  $failed += $count
  $verdict = if ($count -eq 0) { 'ok' } else { "FAILED ($count)" }
  '{0,-12} {1,6} s   exit {2,-4} {3}' -f $r.name, $r.seconds, $r.exitCode, $verdict
  foreach ($f in $r.failures) { "    - $f" }
}
''
"reports: $outDir"
if (-not $Out) {
  # Keep the reports only when something failed, so there is something to read.
  if ($failed -eq 0) { Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue; '(scratch folder removed)' }
} else {
  Remove-Item -Recurse -Force $saveDir -ErrorAction SilentlyContinue
}
exit ([math]::Min($failed, 1))
