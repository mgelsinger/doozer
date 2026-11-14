# Runs the scripted checks of the Room view (app/src/spike/room-scenarios.ts) in the
# real window and prints what failed. See docs/room-checks.md.
#
#   pwsh app/scripts/run-room-checks.ps1 -Exe <doozer.exe built with the test hooks>
#   pwsh app/scripts/run-room-checks.ps1 -Exe <exe> -Only app-room-stuck
#   pwsh app/scripts/run-room-checks.ps1 -Exe <exe> -Show          # let the window be seen
#
# Needs a build with the test hooks (docs/room-checks.md, "Running it again").
#
# Like run-app-checks.ps1: the runs keep the real mouse out (a pretend cursor is fed to
# the shell), never touch the real save (a scratch folder is used), and without -Show the
# window is cloaked, so nothing appears on screen.

param(
  [string] $Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\release\doozer.exe'),
  [string[]] $Only = @(),
  # Where to keep the reports. Default: a scratch folder that is removed at the end.
  [string] $Out = '',
  [switch] $Show
)

$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path $Exe).Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) "doozer-room-checks-$PID"
$saveDir = Join-Path $scratch 'save'
$outDir = if ($Out) { $Out } else { Join-Path $scratch 'out' }
New-Item -ItemType Directory -Force -Path $saveDir, $outDir | Out-Null

$env:DOOZER_SPIKE_OUT = $outDir
Remove-Item Env:DOOZER_AUTOSTART_KEY -ErrorAction SilentlyContinue
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

# One run of the app: a scenario, its own save folder (or one shared with an earlier run), a time limit.
function Invoke-Scenario([string] $name, [hashtable] $arguments, [string] $save, [int] $limitSeconds) {
  $arguments.tag = $name
  $env:DOOZER_SPIKE = $name
  $env:DOOZER_SPIKE_ARGS = ($arguments | ConvertTo-Json -Compress)
  $env:DOOZER_SAVE_DIR = Join-Path $saveDir $save
  New-Item -ItemType Directory -Force -Path $env:DOOZER_SAVE_DIR | Out-Null
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

# `app-room-reopen` starts from the save `app-room-switch` leaves, so the two share a folder.
$plan = @(
  @{ name = 'app-room-furniture'; args = @{}; save = 'furniture'; limit = 240 },
  @{ name = 'app-room-hour'; args = @{}; save = 'hour'; limit = 200 },
  @{ name = 'app-room-switch'; args = @{}; save = 'switch'; limit = 120 },
  @{ name = 'app-room-reopen'; args = @{}; save = 'switch'; limit = 60 },
  @{ name = 'app-room-window'; args = @{}; save = 'window'; limit = 120 },
  @{ name = 'app-room-stuck'; args = @{}; save = 'stuck'; limit = 900 }
)
# Started with `pwsh -File`, a list arrives as one string: "a,b,c".
$Only = @($Only | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($Only.Count) {
  $plan = @($plan | Where-Object { $Only -contains $_.name })
  if ($plan.Count -ne $Only.Count) { throw "unknown scenario in -Only: $($Only -join ', ')" }
}

$results = @()
foreach ($step in $plan) {
  "running $($step.name) ..."
  $results += Invoke-Scenario $step.name $step.args $step.save $step.limit
}

''
$failed = 0
foreach ($r in $results) {
  $count = @($r.failures).Count
  $failed += $count
  $verdict = if ($count -eq 0) { 'ok' } else { "FAILED ($count)" }
  '{0,-20} {1,6} s   exit {2,-4} {3}' -f $r.name, $r.seconds, $r.exitCode, $verdict
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
