# End-to-end check that the save file survives the app being killed mid-write.
#
#   pwsh app/scripts/save-kill-test.ps1 -Exe app/src-tauri/target/release/doozer.exe
#
# Needs a `--features spike` build. Each round starts the real app saving as fast
# as it can, kills it at a random moment, then starts it again to load the save
# and report what it found. The app runs cloaked (nothing appears on screen) and
# is pointed at a scratch folder, never at the real save.
#
# The Rust unit tests (`cargo test save::`) do the same thing far more often and
# with tighter timing; this script proves it for the whole app, page included.

param(
  [Parameter(Mandatory)] [string] $Exe,
  [int] $Rounds = 12,
  [int] $Bytes = 262144,
  [int] $MaxExtraDelayMs = 300
)

$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path $Exe).Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) "doozer-killtest-$PID"
$saveDir = Join-Path $scratch 'save'
$outDir = Join-Path $scratch 'out'
New-Item -ItemType Directory -Force -Path $saveDir, $outDir | Out-Null
$env:DOOZER_SAVE_DIR = $saveDir
$env:DOOZER_SPIKE_OUT = $outDir
$env:DOOZER_SPIKE_CLOAK = '1'

function Read-Json($path) {
  # The progress file is written by a process that is about to be killed, so it
  # may be half-written. That is fine: fall back to what was read before.
  try { Get-Content -Raw -Path $path -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { $null }
}

$progress = Join-Path $outDir 'save-loop-progress.json'
$check = Join-Path $outDir 'save-check.json'
$confirmed = 0
$failures = @()
$rows = @()
$random = [Random]::new(20261111)

try {
  for ($round = 1; $round -le $Rounds; $round++) {
    # 1. Save in a loop, and get killed.
    $env:DOOZER_SPIKE = 'save-loop'
    $env:DOOZER_SPIKE_ARGS = "{`"bytes`":$Bytes,`"exit`":false}"
    $stampBefore = if (Test-Path $progress) { (Get-Item $progress).LastWriteTimeUtc } else { [datetime]::MinValue }
    $app = Start-Process -FilePath $exePath -PassThru
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
      if ((Test-Path $progress) -and (Get-Item $progress).LastWriteTimeUtc -gt $stampBefore) { break }
      Start-Sleep -Milliseconds 15
    }
    $extra = $random.Next(0, $MaxExtraDelayMs + 1)
    Start-Sleep -Milliseconds $extra
    $seen = Read-Json $progress
    if ($seen -and $seen.confirmed -gt $confirmed) { $confirmed = [int]$seen.confirmed }
    Stop-Process -Id $app.Id -Force
    $app.WaitForExit()
    $seen = Read-Json $progress
    if ($seen -and $seen.confirmed -gt $confirmed) { $confirmed = [int]$seen.confirmed }
    $tempLeft = @(Get-ChildItem -Path $saveDir -Filter '*.tmp' -ErrorAction SilentlyContinue).Count

    # 2. Start again and ask what survived.
    Remove-Item $check -ErrorAction SilentlyContinue
    $env:DOOZER_SPIKE = 'save-check'
    $env:DOOZER_SPIKE_ARGS = '{"tag":"save-check"}'
    $verify = Start-Process -FilePath $exePath -PassThru
    if (-not $verify.WaitForExit(30000)) { Stop-Process -Id $verify.Id -Force; $failures += "round ${round}: the check run hung" ; continue }
    $report = Read-Json $check
    $result = if ($report) { $report.scenarios.'save-check' } else { $null }
    if (-not $result) { $failures += "round ${round}: no report from the check run"; continue }

    $ok = $result.complete -and $result.source -eq 'main' -and $result.generation -ge $confirmed
    if (-not $ok) {
      $failures += "round ${round}: source=$($result.source) generation=$($result.generation) complete=$($result.complete) confirmed=$confirmed problem=$($result.problem)"
    }
    # The app sweeps interrupted temp files at start-up; none should remain after the check run.
    $tempAfter = @(Get-ChildItem -Path $saveDir -Filter '*.tmp' -ErrorAction SilentlyContinue).Count
    if ($tempAfter -ne 0) { $failures += "round ${round}: $tempAfter temp file(s) not swept at start-up" }
    $rows += [pscustomobject]@{
      round = $round; killedAfterExtraMs = $extra; confirmedBeforeKill = $confirmed
      onDisk = $result.generation; source = $result.source; complete = $result.complete
      interruptedTempFiles = $tempLeft; ok = $ok
    }
    if ($result.generation -gt $confirmed) { $confirmed = [int]$result.generation }
  }
}
finally {
  Get-Process -Name doozer -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath } | Stop-Process -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
}

$rows | Format-Table -AutoSize | Out-String -Width 200
$midWrite = @($rows | Where-Object interruptedTempFiles -gt 0).Count
"$Rounds kills of the real app saving $Bytes-byte documents; $midWrite landed while a file was being written; final generation $confirmed."
if ($failures.Count) { "FAILED:"; $failures; exit 1 } else { "PASSED: the save was complete and current after every kill."; exit 0 }
