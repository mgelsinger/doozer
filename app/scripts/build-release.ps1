# Builds the installer: the release build of the page and the shell, bundled by Tauri into
# one setup program (docs/release.md).
#
#   pwsh app/scripts/build-release.ps1
#
# Output: app/src-tauri/target/release/bundle/nsis/Doozer_<version>_x64-setup.exe
#         (and the bare program, app/src-tauri/target/release/doozer.exe)
# Everything is under target/, which git ignores.
#
# It is `npm run tauri build` with one difference. The shell embeds the page when it is
# compiled, and cargo only compiles again if it is told something changed. So the page is
# built into a new folder each time and the build is pointed at it: with a fixed folder a
# changed page has been silently left out before (see build-polish-checks.ps1). After a
# build, a running copy can be asked which page it carries: scripts/ask-page.mjs,
# `document.documentElement.dataset.version`.
#
# The first run fetches the installer maker (NSIS) into %LOCALAPPDATA%\tauri; that is
# Tauri's doing and needs the network once.

param(
  # Skip the tests. They are run first by default: a release that fails them is not one.
  [switch] $NoTests
)

$ErrorActionPreference = 'Stop'
$app = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tauri = Join-Path $app 'src-tauri'
$pages = Join-Path $tauri 'target\release-page'
$name = 'dist-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$dist = Join-Path $pages $name

Push-Location $app
try {
  if (-not $NoTests) {
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'the type-check failed' }
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'the page tests failed' }
    Push-Location $tauri
    try {
      cargo test
      if ($LASTEXITCODE -ne 0) { throw 'the native tests failed' }
    }
    finally { Pop-Location }
  }

  if (Test-Path $pages) { Get-ChildItem $pages | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }
  npx vite build --outDir $dist --emptyOutDir
  if ($LASTEXITCODE -ne 0) { throw 'the page did not build' }
  if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw "no page in $dist" }

  # The override goes in a file: JSON does not survive being passed through npx as an
  # argument. The path of the page has to be relative to src-tauri, as "../dist" is.
  $override = Join-Path $pages 'override.json'
  @{ build = @{ frontendDist = "target/release-page/$name"; beforeBuildCommand = '' } } |
    ConvertTo-Json -Compress | Set-Content -Path $override -Encoding utf8NoBOM

  npx tauri build --config $override
  if ($LASTEXITCODE -ne 0) { throw 'the installer did not build' }
}
finally { Pop-Location }

$version = (Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version
$setup = Join-Path $tauri "target\release\bundle\nsis\Doozer_${version}_x64-setup.exe"
if (-not (Test-Path $setup)) { throw "no installer at $setup" }
$file = Get-Item $setup
"built: $setup"
"size:  {0:N1} MB" -f ($file.Length / 1MB)
"sha256: $((Get-FileHash $setup -Algorithm SHA256).Hash.ToLower())"
