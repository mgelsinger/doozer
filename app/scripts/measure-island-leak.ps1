# Does going into the Island and out again leave anything behind? Starts the app in the
# Pill, lets the `app-island-leak` run (app/src/views/island/checks.ts) switch to the
# Island and back ten times, and reads the memory of every process of the app each time
# the run says it is back in the Pill and has settled. See docs/island-checks.md.
#
#   pwsh app/scripts/measure-island-leak.ps1
#   pwsh app/scripts/measure-island-leak.ps1 -Rounds 10 -Out leak.json -Show
#
# Needs a build with the test hooks: pwsh app/scripts/build-island-checks.ps1
#
# What is read, per process (the app itself, and WebView2's browser, GPU and renderer
# processes): private working set, the figure Task Manager shows; and for the GPU, the
# dedicated and shared video memory Windows accounts to that process ("GPU Process
# Memory" counters). The page's own heap, and what three.js says it holds, come from the
# run itself. The app gets a browser profile of its own, so no other copy shares its
# processes, and is started with a way to ask for a garbage collection, so that what is
# measured is what is held, not what has not been tidied yet.

param(
  [string] $Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\island\release\doozer.exe'),
  [int] $Rounds = 10,
  [int] $SettleMs = 6000,
  # 'room': make the same trips by way of the Room instead, to see what a trip leaves behind whichever view it is to.
  [string] $Control = '',
  [string] $Out = '',
  [switch] $Show
)

$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path $Exe).Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) "doozer-island-leak-$PID"
$outDir = Join-Path $scratch 'out'
New-Item -ItemType Directory -Force -Path $outDir, (Join-Path $scratch 'save') | Out-Null

$env:DOOZER_SAVE_DIR = Join-Path $scratch 'save'
$env:DOOZER_SPIKE_OUT = $outDir
$env:DOOZER_SPIKE = 'app-island-leak'
$env:DOOZER_SPIKE_ARGS = (@{ tag = 'app-island-leak'; rounds = $Rounds; settleMs = $SettleMs; control = $Control } | ConvertTo-Json -Compress)
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $scratch 'webview'
# `gc()` for the page, so the run can collect garbage before each reading.
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--js-flags=--expose-gc'
if ($Show) { Remove-Item Env:DOOZER_SPIKE_CLOAK -ErrorAction SilentlyContinue } else { $env:DOOZER_SPIKE_CLOAK = '1' }

function Get-Tree([int] $rootId) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine
  $ids = [System.Collections.Generic.List[int]]::new(); $ids.Add($rootId)
  $added = $true
  while ($added) {
    $added = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { $ids.Add([int]$p.ProcessId); $added = $true }
    }
  }
  $all | Where-Object { $ids.Contains([int]$_.ProcessId) }
}

function Get-Kind($process) {
  if ($process.Name -notlike 'msedgewebview2*') { return 'app' }
  if ($process.CommandLine -match '--type=([a-z-]+)') {
    $kind = $Matches[1]
    if ($kind -eq 'utility' -and $process.CommandLine -match '--utility-sub-type=([\w.]+)') { return "utility ($($Matches[1] -replace '^.*\.', ''))" }
    return $kind
  }
  'browser'
}

# One reading: every process of the app, with its private working set and its video memory.
function Read-Memory([int] $rootId) {
  $tree = Get-Tree $rootId
  $perf = @{}
  Get-CimInstance Win32_PerfRawData_PerfProc_Process -Property IDProcess, WorkingSetPrivate |
    ForEach-Object { $perf[[int]$_.IDProcess] = [double]$_.WorkingSetPrivate }
  $video = @{}
  try {
    (Get-Counter '\GPU Process Memory(*)\Dedicated Usage', '\GPU Process Memory(*)\Shared Usage' -ErrorAction Stop).CounterSamples | ForEach-Object {
      if ($_.InstanceName -match 'pid_(\d+)_') {
        $id = [int]$Matches[1]
        if (-not $video.ContainsKey($id)) { $video[$id] = @{ dedicated = 0.0; shared = 0.0 } }
        if ($_.Path -like '*dedicated usage') { $video[$id].dedicated += $_.CookedValue } else { $video[$id].shared += $_.CookedValue }
      }
    }
  } catch { }
  $rows = foreach ($p in $tree) {
    $id = [int]$p.ProcessId
    [pscustomobject]@{
      kind = Get-Kind $p
      id = $id
      privateMB = if ($perf.ContainsKey($id)) { [math]::Round($perf[$id] / 1MB, 1) } else { 0 }
      videoDedicatedMB = if ($video.ContainsKey($id)) { [math]::Round($video[$id].dedicated / 1MB, 1) } else { 0 }
      videoSharedMB = if ($video.ContainsKey($id)) { [math]::Round($video[$id].shared / 1MB, 1) } else { 0 }
    }
  }
  $sum = { param($kind, $field) [math]::Round((($rows | Where-Object { $kind -eq '*' -or $_.kind -eq $kind } | Measure-Object $field -Sum).Sum), 1) }
  [pscustomobject]@{
    totalMB = & $sum '*' 'privateMB'
    appMB = & $sum 'app' 'privateMB'
    browserMB = & $sum 'browser' 'privateMB'
    rendererMB = & $sum 'renderer' 'privateMB'
    gpuMB = & $sum 'gpu-process' 'privateMB'
    videoDedicatedMB = & $sum '*' 'videoDedicatedMB'
    videoSharedMB = & $sum '*' 'videoSharedMB'
    processes = $rows.Count
    rows = $rows
  }
}

$app = Start-Process -FilePath $exePath -PassThru
$readings = @()
$seen = @{}
$deadline = (Get-Date).AddSeconds(120 + $Rounds * 60)
try {
  while ((Get-Date) -lt $deadline -and -not $app.HasExited) {
    Start-Sleep -Milliseconds 400
    foreach ($marker in Get-ChildItem $outDir -Filter 'leak-*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime) {
      if ($seen.ContainsKey($marker.Name)) { continue }
      $seen[$marker.Name] = $true
      if ($marker.Name -eq 'leak-done.json') { continue }
      # The run waits a few seconds after writing a marker; read in the middle of that.
      Start-Sleep -Milliseconds 900
      $page = Get-Content $marker.FullName -Raw | ConvertFrom-Json
      $memory = Read-Memory $app.Id
      $readings += [pscustomobject]@{
        point = $page.name; view = $page.view; canvases = $page.canvases; heapMB = $page.heap.usedMB; collected = $page.gc
        engineFrames = $page.engineFrames; engineCollected = $page.engineCollected
        totalMB = $memory.totalMB; appMB = $memory.appMB; browserMB = $memory.browserMB; rendererMB = $memory.rendererMB; gpuMB = $memory.gpuMB
        videoDedicatedMB = $memory.videoDedicatedMB; videoSharedMB = $memory.videoSharedMB; processes = $memory.processes
        three = $page.inIsland.info; rows = $memory.rows
      }
      $engine = if ($null -eq $page.engineCollected) { '' } elseif ($page.engineCollected) { '  engine collected' } else { '  ENGINE STILL HELD' }
      '{0,-12} view {1,-7} total {2,6} MB  renderer {3,6}  gpu {4,6}  video {5,6}+{6,-6}  heap {7,6} MB{8}' -f $page.name, $page.view, $memory.totalMB, $memory.rendererMB, $memory.gpuMB, $memory.videoDedicatedMB, $memory.videoSharedMB, $page.heap.usedMB, $engine
    }
    if ($seen.ContainsKey('leak-done.json')) { break }
  }
}
finally {
  Start-Sleep -Seconds 2
  if (-not $app.HasExited) { Get-Tree $app.Id | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
}

$report = Join-Path $outDir 'app-island-leak.json'
$failures = if (Test-Path $report) { @((Get-Content $report -Raw | ConvertFrom-Json).scenarios.'app-island-leak'.failures) } else { @('the run did not finish') }

''
$pill = @($readings | Where-Object { $_.point -like 'pill-*' })
$base = $readings | Where-Object { $_.point -eq 'baseline' } | Select-Object -First 1
if ($base -and $pill.Count -ge 2) {
  $first = $pill[0]; $last = $pill[-1]
  'back in the Pill, compared with before the Island was ever opened:'
  foreach ($field in 'totalMB', 'rendererMB', 'gpuMB', 'browserMB', 'videoDedicatedMB', 'videoSharedMB', 'heapMB') {
    '  {0,-18} before {1,7}   after 1 visit {2,7}   after {3} visits {4,7}   growth per visit after the first {5,6:N2}' -f $field, $base.$field, $first.$field, $pill.Count, $last.$field, (($last.$field - $first.$field) / [math]::Max(1, $pill.Count - 1))
  }
}
foreach ($f in $failures) { "FAILED: $f" }

if ($Out) {
  [pscustomobject]@{ measuredAt = (Get-Date).ToString('s'); exe = $exePath; rounds = $Rounds; settleMs = $SettleMs; cloaked = -not $Show; failures = $failures; readings = $readings } |
    ConvertTo-Json -Depth 6 | Set-Content -Path $Out -Encoding utf8
  "written: $Out"
}
Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
exit ([math]::Min(@($failures).Count, 1))
