# Measures what Doozer costs while it sits idle: memory and CPU of the app
# process and every WebView2 process it started.
#
#   pwsh app/scripts/measure-idle.ps1 -Exe app/src-tauri/target/release/doozer.exe
#   pwsh app/scripts/measure-idle.ps1 -Exe <exe> -Scenario idle -ScenarioArgs '{"view":"desktop"}'
#   pwsh app/scripts/measure-idle.ps1 -Exe <exe> -Scenario app-idle -Cloak                  # the real app, at rest in the pill
#   pwsh app/scripts/measure-idle.ps1 -Exe <exe> -Scenario app-idle -ScenarioArgs '{"focus":true}' -Cloak
#
# `idle` sits on the shell's test page; `app-idle` sits in the real Pill view
# (arguments: "focus" runs a session, "card" leaves the Card open, "asleep" naps).
#
# -Scenario / -ScenarioArgs only work with a `--features spike` build (see
# docs/shell-spike.md). Without them the app starts as a user would start it.
#
# The script starts the app, lets it settle, samples for a while, prints a table,
# optionally writes JSON, and closes the app again. It never touches the real
# save: the app is pointed at a scratch folder.

param(
  [Parameter(Mandatory)] [string] $Exe,
  # Arguments for the executable (used to measure the Phase 1 Electron harness for comparison).
  [string[]] $ExeArgs = @(),
  [string] $WorkingDirectory = '',
  # Extra environment variables for the app, as NAME=value.
  [string[]] $Set = @(),
  [int] $WarmupSeconds = 20,
  [int] $SampleSeconds = 30,
  [int] $Samples = 3,
  [string] $Scenario = '',
  [string] $ScenarioArgs = '',
  [string] $Label = 'idle',
  [string] $Out = '',
  # A browser profile to use and keep. A new profile spends its first minute or so on
  # the browser's own first-run chores, which reads as a busy browser process; a profile
  # that has been used once before does not. Default: a new one, removed afterwards.
  [string] $Profile = '',
  [switch] $Cloak
)

$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path $Exe).Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) "doozer-measure-$PID"
New-Item -ItemType Directory -Force -Path $scratch | Out-Null

$env:DOOZER_SAVE_DIR = Join-Path $scratch 'save'
$env:DOOZER_SPIKE_OUT = Join-Path $scratch 'out'
if ($Scenario) { $env:DOOZER_SPIKE = $Scenario } else { Remove-Item Env:DOOZER_SPIKE -ErrorAction SilentlyContinue }
if ($ScenarioArgs) { $env:DOOZER_SPIKE_ARGS = $ScenarioArgs } else { Remove-Item Env:DOOZER_SPIKE_ARGS -ErrorAction SilentlyContinue }
if ($Cloak) { $env:DOOZER_SPIKE_CLOAK = '1' } else { Remove-Item Env:DOOZER_SPIKE_CLOAK -ErrorAction SilentlyContinue }
# A browser profile of its own: copies of the app that share a profile share one WebView2
# browser process, and then the process tree measured here is not this copy's alone.
$env:WEBVIEW2_USER_DATA_FOLDER = if ($Profile) { New-Item -ItemType Directory -Force -Path $Profile | Out-Null; (Resolve-Path $Profile).Path } else { Join-Path $scratch 'webview' }
foreach ($pair in $Set) { $name, $value = $pair -split '=', 2; Set-Item -Path "Env:$name" -Value $value }

function Get-Tree([int] $rootId) {
  # The app process plus everything descended from it (WebView2 browser, GPU,
  # renderer and utility processes).
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine
  $ids = [System.Collections.Generic.List[int]]::new()
  $ids.Add($rootId)
  $added = $true
  while ($added) {
    $added = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) {
        $ids.Add([int]$p.ProcessId); $added = $true
      }
    }
  }
  $all | Where-Object { $ids.Contains([int]$_.ProcessId) }
}

function Get-Kind($process) {
  $family = if ($process.Name -like 'msedgewebview2*') { 'webview' } elseif ($process.Name -like 'electron*') { 'electron' } else { return "app ($($process.Name))" }
  if ($process.CommandLine -match '--type=([a-z-]+)') {
    $kind = $Matches[1]
    if ($kind -eq 'utility' -and $process.CommandLine -match '--utility-sub-type=([\w.]+)') { return "$family utility ($($Matches[1] -replace '^.*\.', ''))" }
    return "$family $kind"
  }
  if ($family -eq 'electron') { 'electron main' } else { 'webview browser' }
}

function Get-Snapshot([int] $rootId) {
  $tree = Get-Tree $rootId
  $perf = @{}
  Get-CimInstance Win32_PerfRawData_PerfProc_Process -Property IDProcess, WorkingSetPrivate |
    ForEach-Object { $perf[[int]$_.IDProcess] = [double]$_.WorkingSetPrivate }
  foreach ($p in $tree) {
    $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    [pscustomobject]@{
      Id         = [int]$p.ProcessId
      Kind       = Get-Kind $p
      CpuSeconds = $proc.TotalProcessorTime.TotalSeconds
      WorkingSet = [double]$proc.WorkingSet64
      Private    = [double]$proc.PrivateMemorySize64
      PrivateWs  = if ($perf.ContainsKey([int]$p.ProcessId)) { $perf[[int]$p.ProcessId] } else { 0 }
      Threads    = $proc.Threads.Count
    }
  }
}

$cores = [Environment]::ProcessorCount
$launch = @{ FilePath = $exePath; PassThru = $true }
if ($ExeArgs.Count) { $launch.ArgumentList = $ExeArgs }
if ($WorkingDirectory) { $launch.WorkingDirectory = (Resolve-Path $WorkingDirectory).Path }
$app = Start-Process @launch
try {
  Start-Sleep -Seconds $WarmupSeconds
  if ($app.HasExited) { throw "the app exited during warm-up (exit code $($app.ExitCode))" }

  $windows = @()
  $before = Get-Snapshot $app.Id
  $clock = [Diagnostics.Stopwatch]::StartNew()
  for ($i = 1; $i -le $Samples; $i++) {
    Start-Sleep -Seconds $SampleSeconds
    $after = Get-Snapshot $app.Id
    $elapsed = $clock.Elapsed.TotalSeconds; $clock.Restart()
    $rows = foreach ($a in $after) {
      $b = $before | Where-Object Id -eq $a.Id
      $cpu = if ($b) { $a.CpuSeconds - $b.CpuSeconds } else { 0 }
      [pscustomobject]@{
        Kind            = $a.Kind
        Id              = $a.Id
        'CPU % of 1 core' = [math]::Round(100 * $cpu / $elapsed, 3)
        'Private WS MB' = [math]::Round($a.PrivateWs / 1MB, 1)
        'Working set MB' = [math]::Round($a.WorkingSet / 1MB, 1)
        'Commit MB'     = [math]::Round($a.Private / 1MB, 1)
        Threads         = $a.Threads
      }
    }
    $oneCore = ($rows | Measure-Object 'CPU % of 1 core' -Sum).Sum
    $windows += [pscustomobject]@{
      window          = $i
      seconds         = [math]::Round($elapsed, 1)
      processes       = $rows.Count
      cpuPercentOfOneCore = [math]::Round($oneCore, 3)
      cpuPercentOfMachine = [math]::Round($oneCore / $cores, 4)
      privateWorkingSetMB = [math]::Round(($rows | Measure-Object 'Private WS MB' -Sum).Sum, 1)
      workingSetMB    = [math]::Round(($rows | Measure-Object 'Working set MB' -Sum).Sum, 1)
      commitMB        = [math]::Round(($rows | Measure-Object 'Commit MB' -Sum).Sum, 1)
      rows            = $rows
    }
    $before = $after
  }

  $last = $windows[-1]
  "`n== $Label ==  ($exePath)"
  "warm-up ${WarmupSeconds}s, then $Samples windows of ${SampleSeconds}s; $cores logical cores"
  $last.rows | Sort-Object 'Private WS MB' -Descending | Format-Table -AutoSize | Out-String -Width 200
  $windows | Select-Object window, seconds, processes, cpuPercentOfOneCore, cpuPercentOfMachine, privateWorkingSetMB, workingSetMB, commitMB |
    Format-Table -AutoSize | Out-String -Width 200

  # The mean of each kind of process over all the windows: where the time went.
  $byKind = $windows | ForEach-Object { $_.rows } | Group-Object Kind | ForEach-Object {
    [pscustomobject]@{ kind = $_.Name; cpuPercentOfOneCore = [math]::Round((($_.Group | Measure-Object 'CPU % of 1 core' -Sum).Sum) / $windows.Count, 3) }
  } | Sort-Object cpuPercentOfOneCore -Descending
  $mean = [math]::Round(($windows | Measure-Object cpuPercentOfOneCore -Average).Average, 3)
  "mean over $($windows.Count) windows: $mean % of one core   (" + (($byKind | Where-Object cpuPercentOfOneCore -gt 0 | ForEach-Object { "$($_.kind) $($_.cpuPercentOfOneCore)" }) -join ', ') + ')'

  # What the scenario wrote down about itself (what Doozer was doing meanwhile).
  $reports = @{}
  if (Test-Path $env:DOOZER_SPIKE_OUT) {
    Get-ChildItem $env:DOOZER_SPIKE_OUT -Filter '*.json' | Where-Object Length -lt 200kb | ForEach-Object {
      try { $reports[$_.BaseName] = Get-Content $_.FullName -Raw | ConvertFrom-Json } catch { }
    }
  }

  if ($Out) {
    [pscustomobject]@{
      label = $Label; exe = $exePath; scenario = $Scenario; scenarioArgs = $ScenarioArgs; cloaked = [bool]$Cloak
      measuredAt = (Get-Date).ToString('s'); logicalCores = $cores
      warmupSeconds = $WarmupSeconds; sampleSeconds = $SampleSeconds
      meanCpuPercentOfOneCore = $mean; byKind = $byKind; windows = $windows; reports = $reports
    } | ConvertTo-Json -Depth 12 | Set-Content -Path $Out -Encoding utf8
    "written: $Out"
  }
}
finally {
  if (-not $app.HasExited) {
    # Closing the app process takes the WebView2 processes with it.
    Get-Tree $app.Id | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
}
