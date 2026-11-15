# Builds the app with the test hooks for the Phase 10 measurements and scripted runs
# (docs/polish-checks.md), and keeps a copy of the executable under a label, so that a
# "before" and an "after" build can sit side by side and long runs can use a copy that a
# later build will not try to replace.
#
#   pwsh app/scripts/build-polish-checks.ps1 -Label base       # page + shell, with test hooks
#   pwsh app/scripts/build-polish-checks.ps1 -Label final -Plain   # also a plain release build (no hooks)
#
# Output: app/src-tauri/target/polish/<label>/doozer.exe          (hooks)
#         app/src-tauri/target/polish/<label>/doozer-plain.exe    (-Plain)
# Everything is under target/, which git ignores.

param(
  [Parameter(Mandatory)] [string] $Label,
  [switch] $Plain
)

$ErrorActionPreference = 'Stop'
$app = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tauri = Join-Path $app 'src-tauri'
$home_ = Join-Path $tauri 'target\polish'
# A new folder for the page each time. The shell embeds the page when it is compiled, and
# cargo only compiles again if it is told something changed: a new path in TAURI_CONFIG
# (below) is what tells it. With a fixed folder a changed page was silently left out.
$pages = Join-Path $home_ 'pages'
$name = "dist-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
$dist = Join-Path $pages $name
if (Test-Path $pages) { Get-ChildItem $pages -Directory | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }

Push-Location $app
try {
  npx vite build --outDir $dist --emptyOutDir
  if ($LASTEXITCODE -ne 0) { throw 'the page did not build' }
}
finally { Pop-Location }
if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw "no page in $dist" }

# The path has to be relative to src-tauri, as "../dist" is: an absolute Windows path is
# taken for a URL, and the app then opens a folder listing instead of the page.
$env:TAURI_CONFIG = (@{ build = @{ frontendDist = "target/polish/pages/$name" } } | ConvertTo-Json -Compress)

$out = Join-Path $home_ $Label
New-Item -ItemType Directory -Force -Path $out | Out-Null

Push-Location $tauri
try {
  cargo build --release --features 'spike,tauri/custom-protocol' --target-dir target/polish/cargo
  if ($LASTEXITCODE -ne 0) { throw 'the shell (with test hooks) did not build' }
  Copy-Item (Join-Path $home_ 'cargo\release\doozer.exe') (Join-Path $out 'doozer.exe') -Force
  if ($Plain) {
    cargo build --release --features 'tauri/custom-protocol' --target-dir target/polish/cargo-plain
    if ($LASTEXITCODE -ne 0) { throw 'the plain shell did not build' }
    Copy-Item (Join-Path $home_ 'cargo-plain\release\doozer.exe') (Join-Path $out 'doozer-plain.exe') -Force
  }
}
finally {
  Pop-Location
  Remove-Item Env:TAURI_CONFIG -ErrorAction SilentlyContinue
}

"built: $(Join-Path $out 'doozer.exe')"
if ($Plain) { "built: $(Join-Path $out 'doozer-plain.exe')" }
