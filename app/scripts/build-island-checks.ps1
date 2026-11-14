# Builds the app with the test hooks into its own folders, for the Island view's scripted
# runs and measurements (docs/island-checks.md), without touching app/dist or the usual
# target folder. Several sessions may be building at once; each keeps to its own output.
#
#   pwsh app/scripts/build-island-checks.ps1            # page + shell, with test hooks
#   pwsh app/scripts/build-island-checks.ps1 -Plain     # also a plain release build (no hooks)
#
# Output: app/src-tauri/target/island/release/doozer.exe        (hooks)
#         app/src-tauri/target/island-plain/release/doozer.exe  (-Plain)
# Both are under target/, which git ignores.

param([switch] $Plain)

$ErrorActionPreference = 'Stop'
$app = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tauri = Join-Path $app 'src-tauri'
# A new folder for the page each time. The shell embeds the page when it is compiled, and
# cargo only compiles again if it is told something changed: a new path in TAURI_CONFIG
# (below) is what tells it.
$pages = Join-Path $tauri 'target\island\pages'
$name = "dist-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
$dist = Join-Path $pages $name
if (Test-Path $pages) { Get-ChildItem $pages -Directory | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }

Push-Location $app
try {
  npx vite build --outDir $dist --emptyOutDir
  if ($LASTEXITCODE -ne 0) { throw 'the page did not build' }
}
finally { Pop-Location }

# What the page is made of: three.js must be in a file of its own, loaded on demand.
"`nthe page:"
Get-ChildItem (Join-Path $dist 'assets') | Sort-Object Length -Descending | Select-Object -First 12 |
  ForEach-Object { '  {0,9:N0} bytes  {1}' -f $_.Length, $_.Name }

# The shell embeds the page at compile time. Point it at this build of the page instead
# of app/dist (the same override the Tauri CLI's --config makes). The path has to be
# relative to src-tauri, as "../dist" is: an absolute Windows path is taken for a URL,
# and no page is put inside the program at all.
$env:TAURI_CONFIG = (@{ build = @{ frontendDist = "target/island/pages/$name" } } | ConvertTo-Json -Compress)

Push-Location $tauri
try {
  cargo build --release --features 'spike,tauri/custom-protocol' --target-dir target/island
  if ($LASTEXITCODE -ne 0) { throw 'the shell (with test hooks) did not build' }
  if ($Plain) {
    cargo build --release --features 'tauri/custom-protocol' --target-dir target/island-plain
    if ($LASTEXITCODE -ne 0) { throw 'the plain shell did not build' }
  }
}
finally {
  Pop-Location
  Remove-Item Env:TAURI_CONFIG -ErrorAction SilentlyContinue
}

# The page has to be inside the program. If it is not, say so here rather than in a run that hangs.
$inside = 0
Get-ChildItem (Join-Path $tauri 'target\island\release\build') -Directory -Filter 'doozer-*' | ForEach-Object {
  $assets = Join-Path $_.FullName 'out\tauri-codegen-assets'
  if (Test-Path $assets) { $inside = [math]::Max($inside, (Get-ChildItem $assets -File).Count) }
}
if ($inside -eq 0) { throw 'the page was not put inside the program' }

"`nbuilt: $(Join-Path $tauri 'target\island\release\doozer.exe')  ($inside files of the page inside)"
if ($Plain) { "built: $(Join-Path $tauri 'target\island-plain\release\doozer.exe')" }
