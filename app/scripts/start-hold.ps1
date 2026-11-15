# Starts a test build in one state and leaves it running, cloaked, with the browser's
# debugging port open, so that it can be looked into (ask-page.mjs, trace-frames.mjs).
# Prints the process id; stop it with -Stop <id>, which also removes its scratch folder.
#
#   pwsh app/scripts/start-hold.ps1 -Exe <exe> -ScenarioArgs '{"view":"desktop","state":"walk"}'
#   node app/scripts/ask-page.mjs --port 9230 --eval "window.doozer.host.current()"
#   pwsh app/scripts/start-hold.ps1 -Stop <id>

param(
  [string] $Exe = '',
  [string] $Scenario = 'app-polish-hold',
  [string] $ScenarioArgs = '{}',
  [int] $Port = 9230,
  [int] $Stop = 0,
  [switch] $Show
)

$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) 'doozer-polish'

if ($Stop) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId
  $ids = [System.Collections.Generic.List[int]]::new(); $ids.Add($Stop)
  $added = $true
  while ($added) {
    $added = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { $ids.Add([int]$p.ProcessId); $added = $true }
    }
  }
  foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
  $note = Join-Path $root "hold-$Stop.txt"
  if (Test-Path $note) {
    $scratch = (Get-Content $note -Raw).Trim()
    if ($scratch -and $scratch.StartsWith($root)) { Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue }
    Remove-Item $note -ErrorAction SilentlyContinue
  }
  "stopped $Stop"
  return
}

$exePath = (Resolve-Path $Exe).Path
$stamp = Get-Date -Format 'HHmmssfff'
$scratch = Join-Path $root "hold-pending-$stamp"
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$env:DOOZER_SAVE_DIR = Join-Path $scratch 'save'
$env:DOOZER_SPIKE_OUT = Join-Path $scratch 'out'
$env:DOOZER_SPIKE = $Scenario
$env:DOOZER_SPIKE_ARGS = $ScenarioArgs
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $scratch 'webview'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
if ($Show) { Remove-Item Env:DOOZER_SPIKE_CLOAK -ErrorAction SilentlyContinue } else { $env:DOOZER_SPIKE_CLOAK = '1' }
$app = Start-Process -FilePath $exePath -PassThru
Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
# A note named after the process, so that -Stop can find the scratch folder and remove it.
Set-Content -Path (Join-Path $root "hold-$($app.Id).txt") -Value $scratch
"started $($app.Id) (port $Port); scratch: $scratch"
