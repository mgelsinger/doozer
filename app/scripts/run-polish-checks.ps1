# Runs Phase 10's scripted checks in the real window (app/src/spike/polish-scenarios.ts)
# and prints what failed. See docs/polish-checks.md.
#
#   pwsh app/scripts/run-polish-checks.ps1                             # reduce motion and the interface size in every view, the keyboard way into the Card
#   pwsh app/scripts/run-polish-checks.ps1 -Only app-polish-motion
#   pwsh app/scripts/run-polish-checks.ps1 -Out <folder>               # keep the reports
#
# Needs a build with the test hooks (scripts/build-polish-checks.ps1). The runs keep the
# real mouse out, use a scratch save and a browser profile of their own, and are cloaked
# unless -Show. The keyboard check takes the keyboard for half a second, and only does
# so when nobody has touched the machine for a minute; otherwise it says it was skipped.
# -IdleSeconds makes that minute shorter, for a run the person at the machine has agreed to:
#
#   pwsh app/scripts/run-polish-checks.ps1 -Only app-polish-keyboard -IdleSeconds 2

param(
  [string] $Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\polish\final\doozer.exe'),
  [string[]] $Only = @(),
  [string] $Out = '',
  [int] $IdleSeconds = 60,
  [switch] $Show
)

$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path $Exe).Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) "doozer-polish\checks-$PID"
$saveDir = Join-Path $scratch 'save'
$outDir = if ($Out) { $Out } else { Join-Path $scratch 'out' }
New-Item -ItemType Directory -Force -Path $saveDir, $outDir | Out-Null

$env:DOOZER_SAVE_DIR = $saveDir
$env:DOOZER_SPIKE_OUT = $outDir
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $scratch 'webview'
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

function Invoke-Scenario([string] $name, [hashtable] $arguments, [string] $tag, [int] $limitSeconds) {
  $arguments.tag = $tag
  $env:DOOZER_SPIKE = $name
  $env:DOOZER_SPIKE_ARGS = ($arguments | ConvertTo-Json -Compress)
  Remove-Item -Recurse -Force $saveDir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $saveDir | Out-Null
  $report = Join-Path $outDir "$tag.json"
  Remove-Item $report -ErrorAction SilentlyContinue
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $app = Start-Process -FilePath $exePath -PassThru
  $exited = $app.WaitForExit($limitSeconds * 1000)
  if (-not $exited) { Stop-Tree $app.Id }
  $result = [pscustomobject]@{ name = $tag; seconds = [math]::Round($clock.Elapsed.TotalSeconds, 1); failures = @(); notes = @() }
  if (-not $exited) { $result.failures += "the app did not finish and quit within $limitSeconds s" }
  if (Test-Path $report) {
    $scenario = (Get-Content $report -Raw | ConvertFrom-Json).scenarios.$name
    if ($null -eq $scenario) { $result.failures += 'the report has no entry for this scenario' }
    else {
      $result.failures += @($scenario.failures)
      if ($scenario.shortcut) { $result.notes += [string]$scenario.shortcut }
    }
  } else { $result.failures += 'no report was written' }
  $result
}

$plan = @(
  @{ name = 'app-polish-motion'; args = @{}; tag = 'app-polish-motion'; limit = 900 },
  @{ name = 'app-polish-scale'; args = @{}; tag = 'app-polish-scale'; limit = 900 },
  @{ name = 'app-polish-keyboard'; args = @{ view = 'pill'; idleMs = $IdleSeconds * 1000 }; tag = 'app-polish-keyboard-pill'; limit = 120 },
  @{ name = 'app-polish-keyboard'; args = @{ view = 'room'; idleMs = $IdleSeconds * 1000 }; tag = 'app-polish-keyboard-room'; limit = 120 },
  @{ name = 'app-polish-keyboard'; args = @{ view = 'island'; idleMs = $IdleSeconds * 1000 }; tag = 'app-polish-keyboard-island'; limit = 120 },
  @{ name = 'app-polish-keyboard'; args = @{ view = 'desktop'; idleMs = $IdleSeconds * 1000 }; tag = 'app-polish-keyboard-desktop'; limit = 120 }
)
# `pwsh -File ... -Only a,b` hands over one string, not a list.
$Only = @($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
if ($Only.Count) { $plan = @($plan | Where-Object { $Only -contains $_.name -or $Only -contains $_.tag }) }

$failed = 0
foreach ($step in $plan) {
  "running $($step.tag) ..."
  $r = Invoke-Scenario $step.name $step.args $step.tag $step.limit
  $count = @($r.failures).Count
  $failed += $count
  '{0,-30} {1,7} s   {2}' -f $r.name, $r.seconds, $(if ($count) { "FAILED ($count)" } else { 'ok' })
  foreach ($f in $r.failures) { "    - $f" }
  foreach ($n in $r.notes) { "    ($n)" }
}
''
"reports: $outDir"
if (-not $Out -and $failed -eq 0) { Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue; '(scratch folder removed)' }
elseif ($Out) { Remove-Item -Recurse -Force $saveDir, (Join-Path $scratch 'webview') -ErrorAction SilentlyContinue }
exit ([math]::Min($failed, 1))
