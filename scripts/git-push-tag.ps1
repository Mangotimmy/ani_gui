# scripts/git-push-tag.ps1 - Windows PowerShell helper for auto push and tag
# Usage:
#   .\scripts\git-push-tag.ps1
#   .\scripts\git-push-tag.ps1 patch
#   .\scripts\git-push-tag.ps1 2.7.0 -DryRun
#   .\scripts\git-push-tag.ps1 -Message "chore: release"

param (
    [Parameter(Position = 0)]
    [string]$Version = "",

    [Parameter(Position = 1)]
    [Alias("m")]
    [string]$Message = "",

    [Alias("d")]
    [switch]$DryRun,

    [switch]$NoPush,

    [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
    node (Join-Path $PSScriptRoot "release.mjs") --help
    exit 0
}

$releaseArgs = @()
if ($Version) { $releaseArgs += $Version }
if ($Message) { $releaseArgs += "-m"; $releaseArgs += $Message }
if ($DryRun) { $releaseArgs += "--dry-run" }
if ($NoPush) { $releaseArgs += "--no-push" }

node (Join-Path $PSScriptRoot "release.mjs") @releaseArgs
