# Starts a test build in one state and records where the processor time goes, thread by
# thread (trace-frames.mjs does the recording and the adding up). See docs/polish-checks.md.
#
#   pwsh app/scripts/trace-frames.ps1 -Exe <exe> -ScenarioArgs '{"view":"desktop","state":"walk"}'
#   pwsh app/scripts/trace-frames.ps1 -Exe <exe> -ScenarioArgs '{"view":"room","state":"watched"}' -Seconds 15 -Out walk.json
#
# Needs a `--features spike` build. Cloaked unless -Show; the real pointer is never moved;
# the save and the browser profile are scratch folders, removed afterwards.

param(
  [Parameter(Mandatory)] [string] $Exe,
  [string] $Scenario = 'app-polish-hold',
  [string] $ScenarioArgs = '{}',
  [int] $Port = 9230,
  [int] $WarmupSeconds = 14,
  [int] $Seconds = 10,
  [string] $Out = '',
  [string] $Raw = '',
  [int] $Threads = 6,
  [int] $Rows = 14,
  [switch] $Show
)

$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path $Exe).Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) "doozer-polish\trace-$PID"
New-Item -ItemType Directory -Force -Path $scratch | Out-Null

$env:DOOZER_SAVE_DIR = Join-Path $scratch 'save'
$env:DOOZER_SPIKE_OUT = Join-Path $scratch 'out'
$env:DOOZER_SPIKE = $Scenario
$env:DOOZER_SPIKE_ARGS = $ScenarioArgs
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $scratch 'webview'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
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

$app = Start-Process -FilePath $exePath -PassThru
try {
  Start-Sleep -Seconds $WarmupSeconds
  if ($app.HasExited) { throw "the app exited during warm-up (exit code $($app.ExitCode))" }
  $nodeArgs = @((Join-Path $PSScriptRoot 'trace-frames.mjs'), '--port', $Port, '--seconds', $Seconds, '--threads', $Threads, '--rows', $Rows)
  if ($Out) { $nodeArgs += @('--out', $Out) }
  if ($Raw) { $nodeArgs += @('--raw', $Raw) }
  node @nodeArgs
  $activity = Join-Path $env:DOOZER_SPIKE_OUT 'hold-activity.json'
  if (Test-Path $activity) { "activity: $(Get-Content $activity -Raw)" }
}
finally {
  if (-not $app.HasExited) { Stop-Tree $app.Id }
  Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 400
  Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
}
