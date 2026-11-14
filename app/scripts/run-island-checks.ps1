# Runs the scripted checks of the Island view in the real window
# (app/src/views/island/checks.ts) and prints what failed. See docs/island-checks.md.
#
#   pwsh app/scripts/run-island-checks.ps1                      # all of them, nothing shown on screen
#   pwsh app/scripts/run-island-checks.ps1 -Only app-island-stuck
#   pwsh app/scripts/run-island-checks.ps1 -Show                # let the window be seen
#   pwsh app/scripts/run-island-checks.ps1 -Only app-island-stills -Out docs/screenshots/island
#
# Needs a build with the test hooks: pwsh app/scripts/build-island-checks.ps1
#
# The runs keep the real mouse out (a pretend cursor is fed to the shell) and never touch
# the real save (a scratch folder is used). Without -Show the window is cloaked: nothing
# appears on screen.

param(
  [string] $Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\island\release\doozer.exe'),
  [string[]] $Only = @(),
  # Where to keep the reports (and the stills). Default: a scratch folder that is removed at the end.
  [string] $Out = '',
  [switch] $Show
)

$ErrorActionPreference = 'Stop'
# "-Only a,b" arrives as one string when the script is started with `pwsh -File`.
$Only = @($Only | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$exePath = (Resolve-Path $Exe).Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) "doozer-island-checks-$PID"
$saveDir = Join-Path $scratch 'save'
$outDir = if ($Out) { $Out } else { Join-Path $scratch 'out' }
New-Item -ItemType Directory -Force -Path $saveDir, $outDir | Out-Null
$outDir = (Resolve-Path $outDir).Path

$env:DOOZER_SAVE_DIR = $saveDir
$env:DOOZER_SPIKE_OUT = $outDir
# A browser profile of its own. Without one, every Doozer build running on the machine
# shares a profile and its cache, and this build can be handed another build's page.
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
function Invoke-Scenario([string] $name, [hashtable] $arguments = @{}, [int] $limitSeconds = 300) {
  $arguments.tag = $name
  $env:DOOZER_SPIKE = $name
  $env:DOOZER_SPIKE_ARGS = ($arguments | ConvertTo-Json -Compress)
  $report = Join-Path $outDir "$name.json"
  Remove-Item $report -ErrorAction SilentlyContinue
  # A fresh pet for every scenario, so that none depends on what another left behind.
  Remove-Item -Recurse -Force $saveDir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $saveDir | Out-Null
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $app = Start-Process -FilePath $exePath -PassThru
  $exited = $app.WaitForExit($limitSeconds * 1000)
  if (-not $exited) { Stop-Tree $app.Id }
  $result = [pscustomobject]@{ name = $name; seconds = [math]::Round($clock.Elapsed.TotalSeconds, 1); exited = $exited; exitCode = $null; failures = @(); report = $null }
  if ($exited) { $result.exitCode = $app.ExitCode }
  if (-not $exited) {
    $result.failures += "the app did not finish and quit within $limitSeconds s"
    $trail = Join-Path $outDir 'island-trail.json'
    if (Test-Path $trail) { $result.failures += "  it had got as far as: $(((Get-Content $trail -Raw | ConvertFrom-Json).trail | Select-Object -Last 1).step)" }
  }
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

$plan = @(
  @{ name = 'app-island-hello'; limit = 90 },
  @{ name = 'app-island-stuck'; limit = 900 },
  @{ name = 'app-island-window'; limit = 240 },
  @{ name = 'app-island-focus'; limit = 180 },
  @{ name = 'app-island-stills'; limit = 240 }
)
if ($Only.Count) { $plan = $plan | Where-Object { $Only -contains $_.name } }

$results = @()
foreach ($step in $plan) {
  "running $($step.name) ..."
  $results += Invoke-Scenario $step.name @{} $step.limit
}

# The stills arrive as text (PNG data addresses); turn them into pictures.
Get-ChildItem $outDir -Filter 'still-*.txt' -ErrorAction SilentlyContinue | ForEach-Object {
  $text = Get-Content $_.FullName -Raw
  $comma = $text.IndexOf(',')
  if ($comma -gt 0) {
    $png = Join-Path $outDir ($_.BaseName -replace '^still-', 'island-')
    [IO.File]::WriteAllBytes("$png.png", [Convert]::FromBase64String($text.Substring($comma + 1)))
    Remove-Item $_.FullName
  }
}

''
$failed = 0
foreach ($r in $results) {
  $count = @($r.failures).Count
  $failed += $count
  $verdict = if ($count -eq 0) { 'ok' } else { "FAILED ($count)" }
  '{0,-19} {1,6} s   exit {2,-4} {3}' -f $r.name, $r.seconds, $r.exitCode, $verdict
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
