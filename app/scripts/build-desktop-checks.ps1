# Builds the app with the test hooks into its own folders, for the Desktop view's scripted
# runs (docs/desktop-checks.md), without touching app/dist or the usual target folder.
# Several sessions may be building at once; each keeps to its own output.
#
#   pwsh app/scripts/build-desktop-checks.ps1            # page + shell, with test hooks
#   pwsh app/scripts/build-desktop-checks.ps1 -Plain     # also a plain release build (no hooks)
#
# Output: app/src-tauri/target/desktop/release/doozer.exe  (hooks)
#         app/src-tauri/target/desktop-plain/release/doozer.exe  (-Plain)
# Both are under target/, which git ignores.

param([switch] $Plain)

$ErrorActionPreference = 'Stop'
$app = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tauri = Join-Path $app 'src-tauri'
# A new folder for the page each time. The shell embeds the page when it is compiled, and
# cargo only compiles again if it is told something changed: a new path in TAURI_CONFIG
# (below) is what tells it. With a fixed folder a changed page was silently left out.
$pages = Join-Path $tauri 'target\desktop\pages'
$name = "dist-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
$dist = Join-Path $pages $name
if (Test-Path $pages) { Get-ChildItem $pages -Directory | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }

Push-Location $app
try {
  npx vite build --outDir $dist --emptyOutDir
  if ($LASTEXITCODE -ne 0) { throw 'the page did not build' }
}
finally { Pop-Location }

# The shell embeds the page at compile time. Point it at this build of the page instead
# of app/dist (the same override the Tauri CLI's --config makes). The path has to be
# relative to src-tauri, as "../dist" is: an absolute Windows path is taken for a URL,
# and the app then opens a folder listing instead of the page.
$env:TAURI_CONFIG = (@{ build = @{ frontendDist = "target/desktop/pages/$name" } } | ConvertTo-Json -Compress)

Push-Location $tauri
try {
  cargo build --release --features 'spike,tauri/custom-protocol' --target-dir target/desktop
  if ($LASTEXITCODE -ne 0) { throw 'the shell (with test hooks) did not build' }
  if ($Plain) {
    cargo build --release --features 'tauri/custom-protocol' --target-dir target/desktop-plain
    if ($LASTEXITCODE -ne 0) { throw 'the plain shell did not build' }
  }
}
finally {
  Pop-Location
  Remove-Item Env:TAURI_CONFIG -ErrorAction SilentlyContinue
}

"built: $(Join-Path $tauri 'target\desktop\release\doozer.exe')"
if ($Plain) { "built: $(Join-Path $tauri 'target\desktop-plain\release\doozer.exe')" }
