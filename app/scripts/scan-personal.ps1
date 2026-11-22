# Looks for personal details in files that ship: the git user's name and email, the
# Windows user name, and the paths of this machine (the user's profile folder and the
# folder the project is in). See docs/release.md, "Ready to publish".
#
#   pwsh app/scripts/scan-personal.ps1 -Path <file or folder> [-Path <another>]
#
# The name and email are read from `git config` when the script runs and are never
# written anywhere: the report says which kind of thing was found, in which file and how
# often, not what it was. Each file is searched as text in three spellings (UTF-8, UTF-16
# as Windows programs store strings, and with the path's back-slashes doubled or turned to
# forward ones), ignoring case. Exit code 1 if anything is found.

param([Parameter(Mandatory)] [string[]] $Path)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path.TrimEnd('\')
$needles = [ordered]@{}
$name = (git -C $repo config user.name 2>$null)
$email = (git -C $repo config user.email 2>$null)
if ($name) { $needles['the git user name'] = $name.Trim() }
# (The part of the email before the @ alone is not looked for: it was found twice in the
# program, both times inside a compression library's built-in dictionary of common English
# fragments, and says nothing.)
if ($email) { $needles['the git user email'] = $email.Trim() }
$needles['the Windows user name'] = $env:USERNAME
$needles['the user profile folder'] = $env:USERPROFILE
$needles['the project folder'] = $repo
$needles['the project folder, as a Unix path'] = '/' + $repo.Substring(0, 1).ToLower() + $repo.Substring(2).Replace('\', '/')

# Each thing to look for, in each spelling, as bytes.
$patterns = foreach ($kind in $needles.Keys) {
  $text = [string]$needles[$kind]
  if ($text.Length -lt 4) { continue }   # too short to mean anything
  $spellings = @($text, $text.Replace('\', '/'), $text.Replace('\', '\\')) | Select-Object -Unique
  foreach ($spelling in $spellings) {
    foreach ($encoding in [Text.Encoding]::UTF8, [Text.Encoding]::Unicode) {
      [pscustomobject]@{ kind = $kind; lower = $encoding.GetBytes($spelling.ToLowerInvariant()); upper = $encoding.GetBytes($spelling.ToUpperInvariant()) }
    }
  }
}

# A case-blind search for one pattern in a byte array. Returns how many times it occurs.
Add-Type -TypeDefinition @'
public static class DoozerScan {
  public static int Count(byte[] hay, byte[] lower, byte[] upper) {
    int n = 0, len = lower.Length;
    if (len == 0) return 0;
    for (int i = 0; i + len <= hay.Length; i++) {
      int j = 0;
      while (j < len && (hay[i + j] == lower[j] || hay[i + j] == upper[j])) j++;
      if (j == len) { n++; i += len - 1; }
    }
    return n;
  }
}
'@

$files = foreach ($p in $Path) {
  if (Test-Path $p -PathType Container) { Get-ChildItem $p -Recurse -File } else { Get-Item $p }
}
$found = 0
foreach ($file in $files) {
  $bytes = [IO.File]::ReadAllBytes($file.FullName)
  $hits = [ordered]@{}
  foreach ($pattern in $patterns) {
    $count = [DoozerScan]::Count($bytes, $pattern.lower, $pattern.upper)
    if ($count) { $hits[$pattern.kind] = [int]($hits[$pattern.kind]) + $count }
  }
  if ($hits.Count) {
    $found += $hits.Count
    "FOUND in $($file.Name) ($([math]::Round($file.Length / 1KB)) KB): " + (($hits.Keys | ForEach-Object { "$_ x$($hits[$_])" }) -join ', ')
  } else {
    "clean: $($file.Name) ($([math]::Round($file.Length / 1KB)) KB)"
  }
}
"looked for: $(($needles.Keys | Where-Object { ([string]$needles[$_]).Length -ge 4 }) -join ', ')"
if ($found) { exit 1 }
