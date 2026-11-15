# Runs a list of measurements one after another with measure-idle.ps1 and prints one line
# for each: the state, the median and mean share of one core, where it went, and memory.
# Used for the before-and-after tables of docs/polish-checks.md.
#
#   pwsh app/scripts/measure-set.ps1 -Exe <exe> -Tag after -Out <folder> -Runs @(
#     @{ name = 'desktop-walk'; args = '{"view":"desktop","state":"walk"}'; seconds = 20; samples = 3 },
#     @{ name = 'room-rest';    args = '{"view":"room","state":"rest"}';    seconds = 60; samples = 10 })
#
# Before and after side by side: give two (or more) builds as -Arms, and each run is made
# in all of them at the same moment, so that whatever else the machine is doing (it is
# usually in use) weighs on both alike:
#
#   pwsh app/scripts/measure-set.ps1 -Out <folder> -Arms @(@{ tag = 'before'; exe = <exe> }, @{ tag = 'after'; exe = <exe> }) -Runs ...
#
# Each run starts its own cloaked copy of the app with a scratch save and closes it again.
# Each arm keeps one browser profile for all of its runs (a new profile spends its first
# minute on first-run chores); the profiles are removed at the end unless -KeepProfiles.
# Results are written to <folder>/<tag>-<name>.json.

param(
  [string] $Exe = '',
  [string] $Tag = 'run',
  [hashtable[]] $Arms = @(),
  [Parameter(Mandatory)] [string] $Out,
  [Parameter(Mandatory)] [hashtable[]] $Runs,
  [string] $Scenario = 'app-polish-hold',
  [int] $WarmupSeconds = 20,
  [switch] $KeepProfiles
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$measure = Join-Path $PSScriptRoot 'measure-idle.ps1'
if (-not $Arms.Count) {
  if (-not $Exe) { throw 'give -Exe, or -Arms' }
  $Arms = @(@{ tag = $Tag; exe = $Exe })
}
$profiles = Join-Path ([IO.Path]::GetTempPath()) "doozer-polish\profiles-$PID"

function Show-Result([string] $label, [string] $file) {
  if (-not (Test-Path $file)) { return ("{0,-34} FAILED (no result)" -f $label) }
  $r = Get-Content $file -Raw | ConvertFrom-Json
  $cpu = @($r.windows | ForEach-Object { $_.cpuPercentOfOneCore })
  $mem = @($r.windows | ForEach-Object { $_.privateWorkingSetMB })
  $kinds = ($r.byKind | Where-Object { $_.cpuPercentOfOneCore -ge 0.02 } | ForEach-Object { "$($_.kind -replace 'webview ', '' -replace ' \(doozer.exe\)', '') $($_.cpuPercentOfOneCore)" }) -join ', '
  $activity = $r.reports.'hold-activity'
  $did = if ($activity) { "lively $($activity.livelyShare) walking $($activity.walkingShare)" } else { '' }
  $sorted = @($cpu | Sort-Object)
  $median = if ($sorted.Count % 2) { $sorted[($sorted.Count - 1) / 2] } else { ($sorted[$sorted.Count / 2 - 1] + $sorted[$sorted.Count / 2]) / 2 }
  $shown = if ($cpu.Count -le 12) { ($cpu | ForEach-Object { '{0:N2}' -f $_ }) -join ' ' } else { "$($cpu.Count) windows, $('{0:N2}' -f $sorted[0]) to $('{0:N2}' -f $sorted[-1])" }
  "{0,-34} median {1,6:N2} %  mean {2,6:N2} %  [{3}]  {4:N0}-{5:N0} MB  ({6})  {7}" -f $label, $median, $r.meanCpuPercentOfOneCore, $shown,
    ($mem | Measure-Object -Minimum).Minimum, ($mem | Measure-Object -Maximum).Maximum, $kinds, $did
}

try {
  foreach ($run in $Runs) {
    $seconds = if ($run.seconds) { [int]$run.seconds } else { 30 }
    $samples = if ($run.samples) { [int]$run.samples } else { 3 }
    $warm = if ($run.warmup) { [int]$run.warmup } else { $WarmupSeconds }
    $scenario = if ($run.scenario) { [string]$run.scenario } else { $Scenario }
    $jobs = @()
    foreach ($arm in $Arms) {
      # An arm may name its own arguments for a run (`argsFor = @{ <run name> = '...' }`), for
      # comparing two states of one build.
      $runArgs = if ($arm.argsFor -and $arm.argsFor[$run.name]) { [string]$arm.argsFor[$run.name] } else { [string]$run.args }
      $params = @{
        Exe = $arm.exe; Scenario = $scenario; ScenarioArgs = $runArgs; Cloak = $true
        Profile = (Join-Path $profiles $arm.tag)
        WarmupSeconds = $warm; SampleSeconds = $seconds; Samples = $samples
        Label = "$($arm.tag) $($run.name)"; Out = (Join-Path $Out "$($arm.tag)-$($run.name).json")
      }
      # A process of its own for each (its own environment, its own scratch folder), in step.
      $jobs += Start-Job -ScriptBlock { param($script, $p) & $script @p | Out-Null } -ArgumentList $measure, $params
    }
    $jobs | Wait-Job | Out-Null
    $jobs | Receive-Job -ErrorAction SilentlyContinue | Out-Null
    $jobs | Remove-Job -Force
    foreach ($arm in $Arms) { Show-Result "$($arm.tag) $($run.name)" (Join-Path $Out "$($arm.tag)-$($run.name).json") }
  }
}
finally {
  if (-not $KeepProfiles) { Remove-Item -Recurse -Force $profiles -ErrorAction SilentlyContinue }
}
