# Runs the scripted checks of the Desktop view in the real window
# (app/src/views/desktop/checks.ts) and prints what failed. See docs/desktop-checks.md.
#
#   pwsh app/scripts/run-desktop-checks.ps1                          # stuck cases and the window checks, nothing shown
#   pwsh app/scripts/run-desktop-checks.ps1 -Only app-desktop-stuck
#   pwsh app/scripts/run-desktop-checks.ps1 -Only app-desktop-hello      # a ten-second look: does the view come up here at all
#   pwsh app/scripts/run-desktop-checks.ps1 -Soak 180                # the soak alone: three hours of random actions
#   pwsh app/scripts/run-desktop-checks.ps1 -Show                    # let the window be seen
#
# Needs a build with the test hooks; scripts/build-desktop-checks.ps1 makes one in its
# own folders (the default -Exe here).
#
# The runs keep the real mouse out (a pretend cursor is fed to the shell) and never touch
# the real save (a scratch folder is used). Without -Show the window is cloaked: nothing
# appears on screen, and a cloaked window takes no clicks either.

param(
  [string] $Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\desktop\release\doozer.exe'),
  [string[]] $Only = @(),
  # Minutes of soak. Runs the soak instead of the other checks.
  [double] $Soak = 0,
  [int] $Seed = 20261113,
  # Where to keep the reports. Default: a scratch folder that is removed at the end if nothing failed.
  [string] $Out = '',
  [switch] $Show
)

$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path $Exe).Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) "doozer-desktop-checks-$PID"
$saveDir = Join-Path $scratch 'save'
$outDir = if ($Out) { $Out } else { Join-Path $scratch 'out' }
New-Item -ItemType Directory -Force -Path $saveDir, $outDir | Out-Null

$env:DOOZER_SAVE_DIR = $saveDir
$env:DOOZER_SPIKE_OUT = $outDir
# Its own browser profile too. Copies of the app that share a profile share one WebView2
# browser process, and several sessions may be running test copies at the same time.
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

$known = @{
  'app-desktop-hello'  = @{ name = 'app-desktop-hello'; args = @{}; limit = 120 }
  'app-desktop-stuck'  = @{ name = 'app-desktop-stuck'; args = @{}; limit = 3600 }
  'app-desktop-window' = @{ name = 'app-desktop-window'; args = @{}; limit = 1500 }
}
$plan = if ($Soak -gt 0) {
  @(@{ name = 'app-desktop-soak'; args = @{ minutes = $Soak; seed = $Seed }; limit = [int]($Soak * 60 + 600) })
} elseif ($Only.Count) {
  @($Only | ForEach-Object { if ($known.ContainsKey($_)) { $known[$_] } else { throw "unknown scenario: $_" } })
} else {
  @($known['app-desktop-stuck'], $known['app-desktop-window'])
}

$results = @()
foreach ($step in $plan) {
  "running $($step.name) ..."
  $results += Invoke-Scenario $step.name $step.args $step.limit
}

''
$failed = 0
foreach ($r in $results) {
  $count = @($r.failures).Count
  $failed += $count
  $verdict = if ($count -eq 0) { 'ok' } else { "FAILED ($count)" }
  '{0,-20} {1,8} s   exit {2,-4} {3}' -f $r.name, $r.seconds, $r.exitCode, $verdict
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
