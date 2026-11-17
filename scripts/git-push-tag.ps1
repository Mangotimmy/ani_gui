# scripts/git-push-tag.ps1 - AniFlix Interactive Release, Version Manager & Git Push/Tag Tool
# Supports:
#   1. Modern Dark-Themed Desktop GUI Window (Default when run with no CLI action args or with -Gui / -UI)
#   2. Interactive Console TUI Menu (-Tui)
#   3. Full CLI Automation with Update-ProjectVersion function & extended Git/Tag/Push options
#
# Examples:
#   .\scripts\git-push-tag.ps1                                 # Opens interactive Desktop GUI (or TUI fallback)
#   .\scripts\git-push-tag.ps1 -Gui                            # Explicitly launch Desktop GUI
#   .\scripts\git-push-tag.ps1 -Tui                            # Launch interactive Terminal TUI menu
#   .\scripts\git-push-tag.ps1 patch                           # Bump patch, commit, tag, and push
#   .\scripts\git-push-tag.ps1 minor -UpdateChangelog          # Bump minor, update CHANGELOG.md, commit, tag, push
#   .\scripts\git-push-tag.ps1 prerelease -PreId rc            # Bump pre-release (e.g. 2.7.6-rc.1)
#   .\scripts\git-push-tag.ps1 2.8.0 -VersionOnly              # Only update version in package.json / lock / changelog
#   .\scripts\git-push-tag.ps1 patch -ForceTag -DryRun         # Preview overwriting tag in dry-run mode

[CmdletBinding()]
param (
    [Parameter(Position = 0)]
    [string]$Version = "",

    [Parameter(Position = 1)]
    [Alias("m")]
    [string]$Message = "",

    [ValidateSet("", "keep", "patch", "minor", "major", "prerelease", "prepatch", "preminor", "premajor", "custom")]
    [string]$BumpType = "",

    [string]$PreId = "beta",

    [Alias("r")]
    [string]$Remote = "origin",

    [string]$Branch = "",

    [Alias("d")]
    [switch]$DryRun,

    [switch]$NoCommit,

    [switch]$NoTag,

    [switch]$NoPush,

    [switch]$ForceTag,

    [switch]$ForcePush,

    [switch]$PullRebase,

    [switch]$UpdateChangelog,

    [switch]$VersionOnly,

    [switch]$BuildFirst,

    [string]$DeleteTag = "",

    [Alias("UI")]
    [switch]$Gui,

    [switch]$Tui,

    [switch]$NoGui,

    [Alias("h")]
    [switch]$Help
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = $PSScriptRoot
$RootDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$PkgPath = Join-Path $RootDir "package.json"
$PkgLockPath = Join-Path $RootDir "package-lock.json"
$ChangelogPath = Join-Path $RootDir "CHANGELOG.md"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ============================================================================
# 1. Environment & Node.js Discovery
# ============================================================================
function Resolve-NodePath {
    if (Get-Command node -ErrorAction SilentlyContinue) { return $true }
    $candidateDirs = @(
        (Join-Path $env:LOCALAPPDATA "deno\node_compat_bin"),
        (Join-Path $HOME "scoop\shims"),
        (Join-Path $env:ProgramFiles "nodejs"),
        (Join-Path $env:APPDATA "nvm"),
        (Join-Path $env:LOCALAPPDATA "fnm_multishells")
    )
    foreach ($dir in $candidateDirs) {
        if ($dir -and (Test-Path (Join-Path $dir "node.exe"))) {
            $env:PATH = "$dir;$env:PATH"
            return $true
        }
    }
    return $false
}
[void](Resolve-NodePath)

function Invoke-GitCommand {
    param (
        [string[]]$GitArgs,
        [switch]$IgnoreError
    )
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & git -C $RootDir @GitArgs 2>&1
        $exitCode = $LASTEXITCODE
        $text = ($output | ForEach-Object { "$_" }) -join "`n"
        if ($exitCode -ne 0 -and -not $IgnoreError) {
            throw "git $($GitArgs -join ' ') failed (exit $exitCode): $text"
        }
        return [PSCustomObject]@{
            Success  = ($exitCode -eq 0)
            ExitCode = $exitCode
            Output   = $text.Trim()
        }
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

# ============================================================================
# 2. Version Calculation & Update-ProjectVersion Function
# ============================================================================
function Get-CurrentProjectVersion {
    if (-not (Test-Path $PkgPath)) {
        throw "package.json not found at $PkgPath"
    }
    $pkgJson = Get-Content -Raw -Path $PkgPath -Encoding UTF8 | ConvertFrom-Json
    if ($pkgJson.version) { return [string]$pkgJson.version }
    return "1.0.0"
}

function Get-CalculatedVersion {
    param (
        [string]$CurrentVersion,
        [string]$Mode = "keep",
        [string]$CustomVersion = "",
        [string]$PreReleaseId = "beta"
    )
    $cleanCurrent = ($CurrentVersion -replace '^v', '').Trim()
    if (-not $PreReleaseId) { $PreReleaseId = "beta" }

    $modeStr = if ($null -ne $Mode) { [string]$Mode } else { "" }
    $modeLower = $modeStr.ToLower().Trim()
    if (-not $modeLower -or $modeLower -eq "keep") {
        return $cleanCurrent
    }

    if ($modeLower -eq "custom") {
        $cleanCustom = ($CustomVersion -replace '^v', '').Trim()
        if ($cleanCustom -match '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$') {
            return $cleanCustom
        }
        return $cleanCurrent
    }

    # Check if Mode itself is an explicit semver string
    if ($modeLower -match '^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
        return ($Mode -replace '^v', '').Trim()
    }

    $dashSplit = $cleanCurrent -split '-', 2
    $corePart = $dashSplit[0]
    $prePart = if ($dashSplit.Count -gt 1) { $dashSplit[1] } else { "" }

    $nums = $corePart -split '\.'
    $major = if ($nums.Count -ge 1) { [int]$nums[0] } else { 1 }
    $minor = if ($nums.Count -ge 2) { [int]$nums[1] } else { 0 }
    $patch = if ($nums.Count -ge 3) { [int]$nums[2] } else { 0 }

    switch ($modeLower) {
        "major" {
            return "$($major + 1).0.0"
        }
        "minor" {
            return "$major.$($minor + 1).0"
        }
        "patch" {
            if ($prePart) {
                # Graduating from 2.7.6-beta.1 -> 2.7.6
                return "$major.$minor.$patch"
            }
            return "$major.$minor.$($patch + 1)"
        }
        "premajor" {
            return "$($major + 1).0.0-$PreReleaseId.1"
        }
        "preminor" {
            return "$major.$($minor + 1).0-$PreReleaseId.1"
        }
        "prepatch" {
            return "$major.$minor.$($patch + 1)-$PreReleaseId.1"
        }
        "prerelease" {
            if ($prePart -match "^$([Regex]::Escape($PreReleaseId))\.(\d+)$") {
                $nextNum = [int]$Matches[1] + 1
                return "$major.$minor.$patch-$PreReleaseId.$nextNum"
            } elseif ($prePart) {
                return "$major.$minor.$patch-$PreReleaseId.1"
            } else {
                return "$major.$minor.$($patch + 1)-$PreReleaseId.1"
            }
        }
        default {
            throw "Unsupported version bump mode: '$Mode'"
        }
    }
}

function Get-GitStatusSummary {
    $branchRes = Invoke-GitCommand -GitArgs @("branch", "--show-current") -IgnoreError
    $branchName = if ($branchRes.Output) { $branchRes.Output } else { "master" }

    $remotesRes = Invoke-GitCommand -GitArgs @("remote") -IgnoreError
    $remotesList = @($remotesRes.Output -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($remotesList.Count -eq 0) { $remotesList = @("origin") }

    $statusRes = Invoke-GitCommand -GitArgs @("status", "--short") -IgnoreError
    $statusLines = @($statusRes.Output -split '\r?\n' | Where-Object { $_.Trim() })

    $tagsRes = Invoke-GitCommand -GitArgs @("tag", "--sort=-creatordate") -IgnoreError
    $tagsList = @($tagsRes.Output -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $latestTag = if ($tagsList.Count -gt 0) { $tagsList[0] } else { "(none)" }

    $notesRes = if ($tagsList.Count -gt 0) {
        Invoke-GitCommand -GitArgs @("log", "--pretty=format:* %s (%h)", "$($tagsList[0])..HEAD") -IgnoreError
    } else {
        Invoke-GitCommand -GitArgs @("log", "--pretty=format:* %s (%h)", "-n", "15") -IgnoreError
    }

    return [PSCustomObject]@{
        CurrentVersion = Get-CurrentProjectVersion
        Branch         = $branchName
        Remotes        = $remotesList
        StatusLines    = $statusLines
        StatusText     = if ($statusLines.Count -gt 0) { $statusLines -join "`r`n" } else { "(Working tree clean)" }
        ChangedCount   = $statusLines.Count
        Tags           = $tagsList
        LatestTag      = $latestTag
        CommitNotes    = $notesRes.Output
    }
}

<#
.SYNOPSIS
    Updates project version across package.json, package-lock.json, and optionally CHANGELOG.md.
#>
function Update-ProjectVersion {
    [CmdletBinding()]
    param (
        [Parameter(Position = 0)]
        [string]$VersionOrBump = "patch",

        [string]$CustomVersion = "",

        [string]$PreReleaseId = "beta",

        [switch]$UpdateChangelog,

        [string]$ReleaseNotes = "",

        [switch]$DryRun,

        [scriptblock]$Logger = $null
    )

    $writeLog = {
        param([string]$Msg, [string]$Color = "White")
        if ($Logger) { & $Logger $Msg $Color }
        else { Write-Host $Msg -ForegroundColor $Color }
    }

    $currentVer = Get-CurrentProjectVersion
    $targetVer = Get-CalculatedVersion -CurrentVersion $currentVer -Mode $VersionOrBump -CustomVersion $CustomVersion -PreReleaseId $PreReleaseId

    if ($targetVer -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$') {
        throw "Invalid target SemVer version: '$targetVer'. Expected X.Y.Z or X.Y.Z-tag.N"
    }

    $updatedFiles = @()
    $versionChanged = ($targetVer -ne $currentVer)

    if ($versionChanged) {
        if (-not $DryRun) {
            # 1. Update package.json preserving 2-space indentation
            $rawPkg = Get-Content -Raw -Path $PkgPath -Encoding UTF8
            $updatedPkg = [Regex]::Replace($rawPkg, '("version"\s*:\s*")[^"]+(")', "`${1}$targetVer`${2}", 1)
            [System.IO.File]::WriteAllText($PkgPath, $updatedPkg, $Utf8NoBom)
            $updatedFiles += "package.json"
            & $writeLog "✔ Updated package.json: $currentVer -> $targetVer" "Green"

            # 2. Update package-lock.json if present
            if (Test-Path $PkgLockPath) {
                try {
                    $rawLock = Get-Content -Raw -Path $PkgLockPath -Encoding UTF8
                    # Replace top-level version and root package version
                    $updatedLock = [Regex]::Replace($rawLock, '("name"\s*:\s*"[^"]+"\s*,\s*"version"\s*:\s*")[^"]+(")', "`${1}$targetVer`${2}", 2)
                    [System.IO.File]::WriteAllText($PkgLockPath, $updatedLock, $Utf8NoBom)
                    $updatedFiles += "package-lock.json"
                    & $writeLog "✔ Updated package-lock.json to $targetVer" "Green"
                } catch {
                    & $writeLog "⚠ Could not update package-lock.json: $($_.Exception.Message)" "Yellow"
                }
            }
        } else {
            & $writeLog "[Dry-Run] Would update package.json & package-lock.json: $currentVer -> $targetVer" "Yellow"
        }
    } else {
        & $writeLog "ℹ Version unchanged ($targetVer)" "Cyan"
    }

    # 3. Optional CHANGELOG.md update
    if ($UpdateChangelog) {
        $dateStr = (Get-Date).ToString("yyyy-MM-dd")
        $notesBody = if ($ReleaseNotes -and $ReleaseNotes.Trim()) {
            $ReleaseNotes.Trim()
        } else {
            $gitInfo = Get-GitStatusSummary
            if ($gitInfo.CommitNotes) { $gitInfo.CommitNotes } else { "* Release v$targetVer" }
        }

        $sectionHeader = "## $targetVer ($dateStr)"
        $newSection = "$sectionHeader`r`n`r`n$notesBody`r`n`r`n"

        if (-not $DryRun) {
            if (Test-Path $ChangelogPath) {
                $existingCl = Get-Content -Raw -Path $ChangelogPath -Encoding UTF8
                if ($existingCl -notmatch [Regex]::Escape("## $targetVer")) {
                    if ($existingCl -match '^#\s+Changelog\r?\n+') {
                        $updatedCl = [Regex]::Replace($existingCl, '^#\s+Changelog\r?\n+', "# Changelog`r`n`r`n$newSection", 1)
                    } else {
                        $updatedCl = "# Changelog`r`n`r`n$newSection$existingCl"
                    }
                    [System.IO.File]::WriteAllText($ChangelogPath, $updatedCl, $Utf8NoBom)
                    $updatedFiles += "CHANGELOG.md"
                    & $writeLog "✔ Prepended release section '$sectionHeader' to CHANGELOG.md" "Green"
                } else {
                    & $writeLog "ℹ CHANGELOG.md already contains section ## $targetVer" "Cyan"
                }
            } else {
                [System.IO.File]::WriteAllText($ChangelogPath, "# Changelog`r`n`r`n$newSection", $Utf8NoBom)
                $updatedFiles += "CHANGELOG.md"
                & $writeLog "✔ Created CHANGELOG.md with section '$sectionHeader'" "Green"
            }
        } else {
            & $writeLog "[Dry-Run] Would prepend '$sectionHeader' to CHANGELOG.md" "Yellow"
        }
    }

    return [PSCustomObject]@{
        PreviousVersion = $currentVer
        TargetVersion   = $targetVer
        TagName         = "v$targetVer"
        Changed         = $versionChanged
        UpdatedFiles    = $updatedFiles
    }
}

# ============================================================================
# 3. Full Git Release Workflow Engine
# ============================================================================
function Invoke-GitReleaseWorkflow {
    param (
        [string]$VersionMode = "keep",
        [string]$CustomVersion = "",
        [string]$PreReleaseId = "beta",
        [string]$CommitMessage = "",
        [string]$RemoteName = "origin",
        [string]$BranchName = "",
        [bool]$DoCommit = $true,
        [bool]$DoTag = $true,
        [bool]$DoPush = $true,
        [bool]$ForceTagOverwrite = $false,
        [bool]$ForceGitPush = $false,
        [bool]$DoPullRebase = $false,
        [bool]$DoUpdateChangelog = $false,
        [bool]$OnlyUpdateVersion = $false,
        [bool]$DoBuildFirst = $false,
        [bool]$IsDryRun = $false,
        [scriptblock]$Logger = $null
    )

    $writeLog = {
        param([string]$Msg, [string]$Color = "White")
        if ($Logger) { & $Logger $Msg $Color }
        else { Write-Host $Msg -ForegroundColor $Color }
    }

    & $writeLog "============================================================" "Magenta"
    & $writeLog "  🚀 AniFlix Release & Version Automation Pipeline" "Magenta"
    & $writeLog "============================================================" "Magenta"

    if ($IsDryRun) {
        & $writeLog "[DRY-RUN MODE] Previewing actions only — no files or git refs will be mutated." "Yellow"
    }

    # Step 1: Verify Git repo
    $gitSummary = Get-GitStatusSummary
    $targetBranch = if ($BranchName) { $BranchName } else { $gitSummary.Branch }
    $targetRemote = if ($RemoteName) { $RemoteName } else { $gitSummary.Remotes[0] }
    & $writeLog "[1/5] Repository branch: $targetBranch | Remote: $targetRemote | Current: v$($gitSummary.CurrentVersion)" "Cyan"

    # Step 2: Update Version Files
    & $writeLog "[2/5] Processing version update ($VersionMode)..." "Cyan"
    $verResult = Update-ProjectVersion `
        -VersionOrBump $VersionMode `
        -CustomVersion $CustomVersion `
        -PreReleaseId $PreReleaseId `
        -UpdateChangelog:$DoUpdateChangelog `
        -ReleaseNotes $gitSummary.CommitNotes `
        -DryRun:$IsDryRun `
        -Logger $Logger

    $tagName = $verResult.TagName

    if ($OnlyUpdateVersion) {
        & $writeLog "============================================================" "Green"
        & $writeLog "✔ Version update finished: v$($verResult.PreviousVersion) -> $tagName (Version-Only mode)." "Green"
        & $writeLog "============================================================" "Green"
        return $verResult
    }

    # Optional pre-release build verification
    if ($DoBuildFirst) {
        & $writeLog "[Build] Running frontend production build (vite build)..." "Cyan"
        if (-not $IsDryRun) {
            $viteScript = Join-Path $RootDir "node_modules\vite\bin\vite.js"
            if (Test-Path $viteScript) {
                $buildOut = & node $viteScript build 2>&1
                if ($LASTEXITCODE -ne 0) {
                    throw "Production build failed:`n$($buildOut -join "`n")"
                }
                & $writeLog "✔ Frontend build succeeded." "Green"
            } else {
                throw "Vite binary not found at $viteScript"
            }
        } else {
            & $writeLog "[Dry-Run] Would execute: node ./node_modules/vite/bin/vite.js build" "Yellow"
        }
    }

    # Step 3: Stage & Commit
    & $writeLog "[3/5] Checking working tree & staging changes..." "Cyan"
    $statusCheck = Invoke-GitCommand -GitArgs @("status", "--porcelain") -IgnoreError
    $hasDirtyFiles = [bool]($statusCheck.Output)

    if ($DoCommit -and ($hasDirtyFiles -or ($IsDryRun -and $verResult.Changed))) {
        $finalCommitMsg = if ($CommitMessage -and $CommitMessage.Trim()) {
            $CommitMessage.Trim().Replace("{version}", $verResult.TargetVersion).Replace("{tag}", $tagName)
        } else {
            "chore(release): $tagName"
        }
        if (-not $IsDryRun) {
            [void](Invoke-GitCommand -GitArgs @("add", "-A"))
            [void](Invoke-GitCommand -GitArgs @("commit", "-m", $finalCommitMsg))
            & $writeLog "✔ Committed all changes: `"$finalCommitMsg`"" "Green"
        } else {
            & $writeLog "[Dry-Run] Would run: git add -A && git commit -m `"$finalCommitMsg`"" "Yellow"
        }
    } elseif (-not $DoCommit) {
        & $writeLog "⚠ Skipping git commit (-NoCommit specified)." "Yellow"
    } else {
        & $writeLog "✔ Working tree is already clean." "Green"
    }

    # Step 4: Git Tag
    & $writeLog "[4/5] Managing Git tag $tagName..." "Cyan"
    if ($DoTag) {
        $existingTagCheck = Invoke-GitCommand -GitArgs @("tag", "-l", $tagName) -IgnoreError
        $tagAlreadyExists = ($existingTagCheck.Output -split '\r?\n' | Where-Object { $_.Trim() -eq $tagName }).Count -gt 0

        if ($tagAlreadyExists -and -not $ForceTagOverwrite) {
            & $writeLog "⚠ Tag '$tagName' already exists (enable Force Tag Overwrite to replace it)." "Yellow"
        } else {
            $notesForTag = if ($gitSummary.CommitNotes) { "`n`nCommits in this release:`n$($gitSummary.CommitNotes)" } else { "" }
            $fullTagMessage = "Release $tagName$notesForTag"
            if (-not $IsDryRun) {
                $tmpFile = Join-Path $RootDir ".tmp_tag_msg.txt"
                try {
                    [System.IO.File]::WriteAllText($tmpFile, $fullTagMessage, $Utf8NoBom)
                    $tagArgs = @("tag", "-a")
                    if ($ForceTagOverwrite) { $tagArgs += "-f" }
                    $tagArgs += @($tagName, "-F", $tmpFile)
                    [void](Invoke-GitCommand -GitArgs $tagArgs)
                    & $writeLog "✔ $(if ($tagAlreadyExists) { 'Overwrote' } else { 'Created' }) annotated tag: $tagName" "Green"
                } finally {
                    if (Test-Path $tmpFile) { Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue }
                }
            } else {
                $forceStr = if ($ForceTagOverwrite) { "-f " } else { "" }
                & $writeLog "[Dry-Run] Would run: git tag -a ${forceStr}$tagName (with release notes)" "Yellow"
            }
        }
    } else {
        & $writeLog "⚠ Skipping git tag creation (-NoTag specified)." "Yellow"
    }

    # Step 5: Git Push
    & $writeLog "[5/5] Pushing to remote '$targetRemote'..." "Cyan"
    if ($DoPush) {
        if ($DoPullRebase) {
            & $writeLog "↻ Pulling latest from $targetRemote/$targetBranch (--rebase)..." "Cyan"
            if (-not $IsDryRun) {
                [void](Invoke-GitCommand -GitArgs @("pull", "--rebase", $targetRemote, $targetBranch))
                & $writeLog "✔ Rebased onto $targetRemote/$targetBranch." "Green"
            } else {
                & $writeLog "[Dry-Run] Would run: git pull --rebase $targetRemote $targetBranch" "Yellow"
            }
        }

        if (-not $IsDryRun) {
            $pushBranchArgs = @("push")
            if ($ForceGitPush) { $pushBranchArgs += "--force-with-lease" }
            $pushBranchArgs += @($targetRemote, $targetBranch)
            [void](Invoke-GitCommand -GitArgs $pushBranchArgs)
            & $writeLog "✔ Pushed branch '$targetBranch' to '$targetRemote'." "Green"

            if ($DoTag) {
                $pushTagArgs = @("push")
                if ($ForceTagOverwrite -or $ForceGitPush) { $pushTagArgs += "--force" }
                $pushTagArgs += @($targetRemote, $tagName)
                [void](Invoke-GitCommand -GitArgs $pushTagArgs)
                & $writeLog "✔ Pushed tag '$tagName' to '$targetRemote'." "Green"
            }
        } else {
            $fBranch = if ($ForceGitPush) { "--force-with-lease " } else { "" }
            $fTag = if ($ForceTagOverwrite -or $ForceGitPush) { "--force " } else { "" }
            & $writeLog "[Dry-Run] Would run: git push ${fBranch}$targetRemote $targetBranch" "Yellow"
            if ($DoTag) {
                & $writeLog "[Dry-Run] Would run: git push ${fTag}$targetRemote $tagName" "Yellow"
            }
        }
    } else {
        & $writeLog "⚠ Skipping remote push (-NoPush specified)." "Yellow"
    }

    & $writeLog "============================================================" "Green"
    & $writeLog "🎉 Release Workflow Complete for $tagName!" "Green"
    & $writeLog "============================================================" "Green"
    return $verResult
}

function Remove-ProjectGitTag {
    param (
        [string]$TagToRemove,
        [string]$RemoteName = "origin",
        [bool]$RemoveFromRemote = $true,
        [bool]$IsDryRun = $false,
        [scriptblock]$Logger = $null
    )
    $writeLog = {
        param([string]$Msg, [string]$Color = "White")
        if ($Logger) { & $Logger $Msg $Color }
        else { Write-Host $Msg -ForegroundColor $Color }
    }
    $cleanTag = $TagToRemove.Trim()
    if (-not $cleanTag) { throw "Tag name is required." }

    if (-not $IsDryRun) {
        [void](Invoke-GitCommand -GitArgs @("tag", "-d", $cleanTag) -IgnoreError)
        & $writeLog "✔ Deleted local tag '$cleanTag'." "Green"
        if ($RemoveFromRemote) {
            [void](Invoke-GitCommand -GitArgs @("push", $RemoteName, "--delete", $cleanTag) -IgnoreError)
            & $writeLog "✔ Deleted remote tag '$cleanTag' on '$RemoteName'." "Green"
        }
    } else {
        & $writeLog "[Dry-Run] Would run: git tag -d $cleanTag && git push $RemoteName --delete $cleanTag" "Yellow"
    }
}

# ============================================================================
# 4. Desktop GUI (Windows Forms Dark Netflix Theme)
# ============================================================================
function Show-ReleaseGui {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $bgDark       = [System.Drawing.Color]::FromArgb(18, 18, 22)
    $bgCard       = [System.Drawing.Color]::FromArgb(28, 28, 35)
    $bgInput      = [System.Drawing.Color]::FromArgb(38, 38, 48)
    $fgWhite      = [System.Drawing.Color]::FromArgb(244, 244, 246)
    $fgMuted      = [System.Drawing.Color]::FromArgb(165, 165, 180)
    $accentRed    = [System.Drawing.Color]::FromArgb(229, 9, 20)
    $accentGreen  = [System.Drawing.Color]::FromArgb(16, 185, 129)
    $accentAmber  = [System.Drawing.Color]::FromArgb(245, 158, 11)
    $accentBlue   = [System.Drawing.Color]::FromArgb(59, 130, 246)

    $fontTitle    = New-Object System.Drawing.Font("Segoe UI Semibold", 13, [System.Drawing.FontStyle]::Bold)
    $fontSection  = New-Object System.Drawing.Font("Segoe UI Semibold", 9.5, [System.Drawing.FontStyle]::Bold)
    $fontNormal   = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Regular)
    $fontMono     = New-Object System.Drawing.Font("Consolas", 9, [System.Drawing.FontStyle]::Regular)
    $fontBadge    = New-Object System.Drawing.Font("Consolas", 11, [System.Drawing.FontStyle]::Bold)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "AniFlix Release & Version Manager — Git Push & Tag UI"
    $form.Size = New-Object System.Drawing.Size(920, 760)
    $form.MinimumSize = New-Object System.Drawing.Size(880, 720)
    $form.StartPosition = "CenterScreen"
    $form.BackColor = $bgDark
    $form.ForeColor = $fgWhite
    $form.Font = $fontNormal

    # --- Top Header Banner ---
    $headerPanel = New-Object System.Windows.Forms.Panel
    $headerPanel.Location = New-Object System.Drawing.Point(16, 12)
    $headerPanel.Size = New-Object System.Drawing.Size(872, 64)
    $headerPanel.BackColor = $bgCard
    $form.Controls.Add($headerPanel)

    $lblTitle = New-Object System.Windows.Forms.Label
    $lblTitle.Text = "🎬 AniFlix Version & Git Release Center"
    $lblTitle.Font = $fontTitle
    $lblTitle.ForeColor = $fgWhite
    $lblTitle.Location = New-Object System.Drawing.Point(14, 10)
    $lblTitle.AutoSize = $true
    $headerPanel.Controls.Add($lblTitle)

    $lblRepoStatus = New-Object System.Windows.Forms.Label
    $lblRepoStatus.Text = "Loading repository state..."
    $lblRepoStatus.Font = $fontNormal
    $lblRepoStatus.ForeColor = $fgMuted
    $lblRepoStatus.Location = New-Object System.Drawing.Point(16, 36)
    $lblRepoStatus.AutoSize = $true
    $headerPanel.Controls.Add($lblRepoStatus)

    $lblVersionPreview = New-Object System.Windows.Forms.Label
    $lblVersionPreview.Text = "v0.0.0 -> v0.0.1"
    $lblVersionPreview.Font = $fontBadge
    $lblVersionPreview.ForeColor = $accentGreen
    $lblVersionPreview.Location = New-Object System.Drawing.Point(620, 18)
    $lblVersionPreview.Size = New-Object System.Drawing.Size(238, 28)
    $lblVersionPreview.TextAlign = "MiddleRight"
    $headerPanel.Controls.Add($lblVersionPreview)

    # --- Left Panel: Version Update Function ---
    $grpVersion = New-Object System.Windows.Forms.GroupBox
    $grpVersion.Text = " 1. Version Change & Bump Options "
    $grpVersion.Font = $fontSection
    $grpVersion.ForeColor = $fgWhite
    $grpVersion.BackColor = $bgCard
    $grpVersion.Location = New-Object System.Drawing.Point(16, 86)
    $grpVersion.Size = New-Object System.Drawing.Size(426, 250)
    $form.Controls.Add($grpVersion)

    $rbPatch = New-Object System.Windows.Forms.RadioButton
    $rbPatch.Text = "Patch (+0.0.1) — Bug fixes & minor tweaks"
    $rbPatch.Location = New-Object System.Drawing.Point(16, 26)
    $rbPatch.Size = New-Object System.Drawing.Size(390, 22)
    $rbPatch.Font = $fontNormal
    $rbPatch.Checked = $true
    $grpVersion.Controls.Add($rbPatch)

    $rbMinor = New-Object System.Windows.Forms.RadioButton
    $rbMinor.Text = "Minor (+0.1.0) — New features (backward-compatible)"
    $rbMinor.Location = New-Object System.Drawing.Point(16, 52)
    $rbMinor.Size = New-Object System.Drawing.Size(390, 22)
    $rbMinor.Font = $fontNormal
    $grpVersion.Controls.Add($rbMinor)

    $rbMajor = New-Object System.Windows.Forms.RadioButton
    $rbMajor.Text = "Major (+1.0.0) — Breaking changes / major release"
    $rbMajor.Location = New-Object System.Drawing.Point(16, 78)
    $rbMajor.Size = New-Object System.Drawing.Size(390, 22)
    $rbMajor.Font = $fontNormal
    $grpVersion.Controls.Add($rbMajor)

    $rbPrerelease = New-Object System.Windows.Forms.RadioButton
    $rbPrerelease.Text = "Pre-release (-beta / -rc / -alpha):"
    $rbPrerelease.Location = New-Object System.Drawing.Point(16, 104)
    $rbPrerelease.Size = New-Object System.Drawing.Size(235, 22)
    $rbPrerelease.Font = $fontNormal
    $grpVersion.Controls.Add($rbPrerelease)

    $cmbPreId = New-Object System.Windows.Forms.ComboBox
    $cmbPreId.Location = New-Object System.Drawing.Point(258, 103)
    $cmbPreId.Size = New-Object System.Drawing.Size(145, 24)
    $cmbPreId.DropDownStyle = "DropDownList"
    $cmbPreId.BackColor = $bgInput
    $cmbPreId.ForeColor = $fgWhite
    [void]$cmbPreId.Items.AddRange(@("beta", "rc", "alpha", "next"))
    $cmbPreId.SelectedIndex = 0
    $grpVersion.Controls.Add($cmbPreId)

    $rbKeep = New-Object System.Windows.Forms.RadioButton
    $rbKeep.Text = "Keep Current Version (no version bump)"
    $rbKeep.Location = New-Object System.Drawing.Point(16, 132)
    $rbKeep.Size = New-Object System.Drawing.Size(390, 22)
    $rbKeep.Font = $fontNormal
    $grpVersion.Controls.Add($rbKeep)

    $rbCustom = New-Object System.Windows.Forms.RadioButton
    $rbCustom.Text = "Custom SemVer:"
    $rbCustom.Location = New-Object System.Drawing.Point(16, 160)
    $rbCustom.Size = New-Object System.Drawing.Size(130, 22)
    $rbCustom.Font = $fontNormal
    $grpVersion.Controls.Add($rbCustom)

    $txtCustomVer = New-Object System.Windows.Forms.TextBox
    $txtCustomVer.Location = New-Object System.Drawing.Point(150, 159)
    $txtCustomVer.Size = New-Object System.Drawing.Size(253, 24)
    $txtCustomVer.BackColor = $bgInput
    $txtCustomVer.ForeColor = $fgWhite
    $txtCustomVer.Font = $fontMono
    $grpVersion.Controls.Add($txtCustomVer)

    $btnVersionOnly = New-Object System.Windows.Forms.Button
    $btnVersionOnly.Text = "⚡ Update Version Files Only (package.json / lock)"
    $btnVersionOnly.Location = New-Object System.Drawing.Point(16, 198)
    $btnVersionOnly.Size = New-Object System.Drawing.Size(387, 36)
    $btnVersionOnly.BackColor = $accentBlue
    $btnVersionOnly.ForeColor = $fgWhite
    $btnVersionOnly.FlatStyle = "Flat"
    $btnVersionOnly.Font = $fontSection
    $grpVersion.Controls.Add($btnVersionOnly)

    # --- Right Panel: Git, Tag & Release Options ---
    $grpOptions = New-Object System.Windows.Forms.GroupBox
    $grpOptions.Text = " 2. Commit, Tag & Push Options "
    $grpOptions.Font = $fontSection
    $grpOptions.ForeColor = $fgWhite
    $grpOptions.BackColor = $bgCard
    $grpOptions.Location = New-Object System.Drawing.Point(456, 86)
    $grpOptions.Size = New-Object System.Drawing.Size(432, 250)
    $form.Controls.Add($grpOptions)

    $lblMsg = New-Object System.Windows.Forms.Label
    $lblMsg.Text = "Commit Message:"
    $lblMsg.Location = New-Object System.Drawing.Point(14, 24)
    $lblMsg.Size = New-Object System.Drawing.Size(110, 20)
    $lblMsg.Font = $fontNormal
    $grpOptions.Controls.Add($lblMsg)

    $cmbPresetMsg = New-Object System.Windows.Forms.ComboBox
    $cmbPresetMsg.Location = New-Object System.Drawing.Point(126, 21)
    $cmbPresetMsg.Size = New-Object System.Drawing.Size(290, 24)
    $cmbPresetMsg.BackColor = $bgInput
    $cmbPresetMsg.ForeColor = $fgWhite
    $cmbPresetMsg.Font = $fontNormal
    [void]$cmbPresetMsg.Items.AddRange(@(
        "chore(release): {tag}",
        "feat(release): {tag} — new features & improvements",
        "fix(release): {tag} — bug fixes & stability",
        "build(release): {tag}"
    ))
    $cmbPresetMsg.SelectedIndex = 0
    $grpOptions.Controls.Add($cmbPresetMsg)

    $lblRemote = New-Object System.Windows.Forms.Label
    $lblRemote.Text = "Git Remote:"
    $lblRemote.Location = New-Object System.Drawing.Point(14, 54)
    $lblRemote.Size = New-Object System.Drawing.Size(110, 20)
    $lblRemote.Font = $fontNormal
    $grpOptions.Controls.Add($lblRemote)

    $cmbRemote = New-Object System.Windows.Forms.ComboBox
    $cmbRemote.Location = New-Object System.Drawing.Point(126, 51)
    $cmbRemote.Size = New-Object System.Drawing.Size(140, 24)
    $cmbRemote.DropDownStyle = "DropDownList"
    $cmbRemote.BackColor = $bgInput
    $cmbRemote.ForeColor = $fgWhite
    $grpOptions.Controls.Add($cmbRemote)

    $btnDeleteTag = New-Object System.Windows.Forms.Button
    $btnDeleteTag.Text = "🗑️ Delete Tag..."
    $btnDeleteTag.Location = New-Object System.Drawing.Point(280, 50)
    $btnDeleteTag.Size = New-Object System.Drawing.Size(136, 26)
    $btnDeleteTag.BackColor = $bgInput
    $btnDeleteTag.ForeColor = $fgWhite
    $btnDeleteTag.FlatStyle = "Flat"
    $btnDeleteTag.Font = $fontNormal
    $grpOptions.Controls.Add($btnDeleteTag)

    # Checkboxes (2 columns)
    $chkCommit = New-Object System.Windows.Forms.CheckBox
    $chkCommit.Text = "Stage & Commit all changes"
    $chkCommit.Location = New-Object System.Drawing.Point(16, 86)
    $chkCommit.Size = New-Object System.Drawing.Size(200, 22)
    $chkCommit.Font = $fontNormal
    $chkCommit.Checked = $true
    $grpOptions.Controls.Add($chkCommit)

    $chkTag = New-Object System.Windows.Forms.CheckBox
    $chkTag.Text = "Create Annotated Git Tag"
    $chkTag.Location = New-Object System.Drawing.Point(224, 86)
    $chkTag.Size = New-Object System.Drawing.Size(195, 22)
    $chkTag.Font = $fontNormal
    $chkTag.Checked = $true
    $grpOptions.Controls.Add($chkTag)

    $chkPush = New-Object System.Windows.Forms.CheckBox
    $chkPush.Text = "Push Branch & Tag to Remote"
    $chkPush.Location = New-Object System.Drawing.Point(16, 114)
    $chkPush.Size = New-Object System.Drawing.Size(200, 22)
    $chkPush.Font = $fontNormal
    $chkPush.Checked = $true
    $grpOptions.Controls.Add($chkPush)

    $chkChangelog = New-Object System.Windows.Forms.CheckBox
    $chkChangelog.Text = "Update CHANGELOG.md"
    $chkChangelog.Location = New-Object System.Drawing.Point(224, 114)
    $chkChangelog.Size = New-Object System.Drawing.Size(195, 22)
    $chkChangelog.Font = $fontNormal
    $chkChangelog.Checked = $false
    $grpOptions.Controls.Add($chkChangelog)

    $chkForceTag = New-Object System.Windows.Forms.CheckBox
    $chkForceTag.Text = "Force Overwrite Tag (-f)"
    $chkForceTag.Location = New-Object System.Drawing.Point(16, 142)
    $chkForceTag.Size = New-Object System.Drawing.Size(200, 22)
    $chkForceTag.Font = $fontNormal
    $grpOptions.Controls.Add($chkForceTag)

    $chkForcePush = New-Object System.Windows.Forms.CheckBox
    $chkForcePush.Text = "Force Push (--force-with-lease)"
    $chkForcePush.Location = New-Object System.Drawing.Point(224, 142)
    $chkForcePush.Size = New-Object System.Drawing.Size(195, 22)
    $chkForcePush.Font = $fontNormal
    $grpOptions.Controls.Add($chkForcePush)

    $chkPullRebase = New-Object System.Windows.Forms.CheckBox
    $chkPullRebase.Text = "Pull --rebase Before Push"
    $chkPullRebase.Location = New-Object System.Drawing.Point(16, 170)
    $chkPullRebase.Size = New-Object System.Drawing.Size(200, 22)
    $chkPullRebase.Font = $fontNormal
    $grpOptions.Controls.Add($chkPullRebase)

    $chkBuildFirst = New-Object System.Windows.Forms.CheckBox
    $chkBuildFirst.Text = "Run Vite Build Before Commit"
    $chkBuildFirst.Location = New-Object System.Drawing.Point(224, 170)
    $chkBuildFirst.Size = New-Object System.Drawing.Size(195, 22)
    $chkBuildFirst.Font = $fontNormal
    $grpOptions.Controls.Add($chkBuildFirst)

    $chkDryRun = New-Object System.Windows.Forms.CheckBox
    $chkDryRun.Text = "Dry-Run Preview Mode (do not modify files or push)"
    $chkDryRun.Location = New-Object System.Drawing.Point(16, 202)
    $chkDryRun.Size = New-Object System.Drawing.Size(390, 24)
    $chkDryRun.Font = $fontSection
    $chkDryRun.ForeColor = $accentAmber
    $chkDryRun.Checked = [bool]$DryRun
    $grpOptions.Controls.Add($chkDryRun)

    # --- Middle Panel: Git Status & Release Notes Preview ---
    $grpPreview = New-Object System.Windows.Forms.GroupBox
    $grpPreview.Text = " 3. Working Tree Changes & Auto-Generated Commit Notes "
    $grpPreview.Font = $fontSection
    $grpPreview.ForeColor = $fgWhite
    $grpPreview.BackColor = $bgCard
    $grpPreview.Location = New-Object System.Drawing.Point(16, 344)
    $grpPreview.Size = New-Object System.Drawing.Size(872, 145)
    $form.Controls.Add($grpPreview)

    $txtStatusPreview = New-Object System.Windows.Forms.TextBox
    $txtStatusPreview.Multiline = $true
    $txtStatusPreview.ReadOnly = $true
    $txtStatusPreview.ScrollBars = "Vertical"
    $txtStatusPreview.Location = New-Object System.Drawing.Point(14, 24)
    $txtStatusPreview.Size = New-Object System.Drawing.Size(415, 108)
    $txtStatusPreview.BackColor = $bgInput
    $txtStatusPreview.ForeColor = $fgWhite
    $txtStatusPreview.Font = $fontMono
    $grpPreview.Controls.Add($txtStatusPreview)

    $txtNotesPreview = New-Object System.Windows.Forms.TextBox
    $txtNotesPreview.Multiline = $true
    $txtNotesPreview.ReadOnly = $true
    $txtNotesPreview.ScrollBars = "Vertical"
    $txtNotesPreview.Location = New-Object System.Drawing.Point(440, 24)
    $txtNotesPreview.Size = New-Object System.Drawing.Size(418, 108)
    $txtNotesPreview.BackColor = $bgInput
    $txtNotesPreview.ForeColor = $fgWhite
    $txtNotesPreview.Font = $fontMono
    $grpPreview.Controls.Add($txtNotesPreview)

    # --- Bottom Panel: Live Output Log ---
    $grpLog = New-Object System.Windows.Forms.GroupBox
    $grpLog.Text = " 4. Live Execution Output "
    $grpLog.Font = $fontSection
    $grpLog.ForeColor = $fgWhite
    $grpLog.BackColor = $bgCard
    $grpLog.Location = New-Object System.Drawing.Point(16, 496)
    $grpLog.Size = New-Object System.Drawing.Size(872, 155)
    $form.Controls.Add($grpLog)

    $rtbLog = New-Object System.Windows.Forms.RichTextBox
    $rtbLog.ReadOnly = $true
    $rtbLog.Location = New-Object System.Drawing.Point(14, 22)
    $rtbLog.Size = New-Object System.Drawing.Size(844, 120)
    $rtbLog.BackColor = [System.Drawing.Color]::FromArgb(12, 12, 15)
    $rtbLog.ForeColor = $fgWhite
    $rtbLog.Font = $fontMono
    $rtbLog.BorderStyle = "None"
    $grpLog.Controls.Add($rtbLog)

    # --- Action Buttons Bar ---
    $btnRefresh = New-Object System.Windows.Forms.Button
    $btnRefresh.Text = "🔄 Refresh Status"
    $btnRefresh.Location = New-Object System.Drawing.Point(16, 662)
    $btnRefresh.Size = New-Object System.Drawing.Size(150, 42)
    $btnRefresh.BackColor = $bgCard
    $btnRefresh.ForeColor = $fgWhite
    $btnRefresh.FlatStyle = "Flat"
    $btnRefresh.Font = $fontSection
    $form.Controls.Add($btnRefresh)

    $btnDryRunExec = New-Object System.Windows.Forms.Button
    $btnDryRunExec.Text = "🔍 Run Dry-Run Preview"
    $btnDryRunExec.Location = New-Object System.Drawing.Point(178, 662)
    $btnDryRunExec.Size = New-Object System.Drawing.Size(210, 42)
    $btnDryRunExec.BackColor = $accentAmber
    $btnDryRunExec.ForeColor = [System.Drawing.Color]::Black
    $btnDryRunExec.FlatStyle = "Flat"
    $btnDryRunExec.Font = $fontSection
    $form.Controls.Add($btnDryRunExec)

    $btnReleaseExec = New-Object System.Windows.Forms.Button
    $btnReleaseExec.Text = "🚀 Execute Release (Version + Commit + Tag + Push)"
    $btnReleaseExec.Location = New-Object System.Drawing.Point(400, 662)
    $btnReleaseExec.Size = New-Object System.Drawing.Size(488, 42)
    $btnReleaseExec.BackColor = $accentRed
    $btnReleaseExec.ForeColor = $fgWhite
    $btnReleaseExec.FlatStyle = "Flat"
    $btnReleaseExec.Font = $fontTitle
    $form.Controls.Add($btnReleaseExec)

    # --- Helper Functions for GUI State ---
    $appendGuiLog = {
        param([string]$Msg, [string]$ColorName = "White")
        $colorMap = @{
            "Green"   = [System.Drawing.Color]::FromArgb(52, 211, 153)
            "Yellow"  = [System.Drawing.Color]::FromArgb(251, 191, 36)
            "Red"     = [System.Drawing.Color]::FromArgb(248, 113, 113)
            "Cyan"    = [System.Drawing.Color]::FromArgb(56, 189, 248)
            "Magenta" = [System.Drawing.Color]::FromArgb(232, 121, 249)
            "White"   = $fgWhite
        }
        $c = if ($colorMap.ContainsKey($ColorName)) { $colorMap[$ColorName] } else { $fgWhite }
        $rtbLog.SelectionStart = $rtbLog.TextLength
        $rtbLog.SelectionLength = 0
        $rtbLog.SelectionColor = $c
        $rtbLog.AppendText("[$(Get-Date -Format 'HH:mm:ss')] $Msg`r`n")
        $rtbLog.ScrollToCaret()
        [System.Windows.Forms.Application]::DoEvents()
    }

    $getSelectedBumpMode = {
        if ($rbPatch.Checked) { return "patch" }
        if ($rbMinor.Checked) { return "minor" }
        if ($rbMajor.Checked) { return "major" }
        if ($rbPrerelease.Checked) { return "prerelease" }
        if ($rbCustom.Checked) { return "custom" }
        return "keep"
    }

    $script:currentGitState = $null

    $updatePreviewLabels = {
        try {
            $curVer = if ($script:currentGitState) { $script:currentGitState.CurrentVersion } else { Get-CurrentProjectVersion }
            $mode = & $getSelectedBumpMode
            $calcVer = Get-CalculatedVersion -CurrentVersion $curVer -Mode $mode -CustomVersion $txtCustomVer.Text -PreReleaseId $cmbPreId.SelectedItem
            $lblVersionPreview.Text = "v$curVer  ➔  v$calcVer"
        } catch {
            $lblVersionPreview.Text = "Invalid SemVer"
        }
    }

    $refreshRepoInfo = {
        $script:currentGitState = Get-GitStatusSummary
        $s = $script:currentGitState
        $lblRepoStatus.Text = "Branch: $($s.Branch)   |   Latest Tag: $($s.LatestTag)   |   Modified Files: $($s.ChangedCount)"
        $txtStatusPreview.Text = "=== Modified / Untracked Files ($($s.ChangedCount)) ===`r`n" + $s.StatusText
        $txtNotesPreview.Text = "=== Commits Since $($s.LatestTag) ===`r`n" + ($(if ($s.CommitNotes) { $s.CommitNotes } else { "(No new commits since last tag)" }))

        $prevRemote = $cmbRemote.SelectedItem
        $cmbRemote.Items.Clear()
        foreach ($r in $s.Remotes) { [void]$cmbRemote.Items.Add($r) }
        if ($prevRemote -and $cmbRemote.Items.Contains($prevRemote)) {
            $cmbRemote.SelectedItem = $prevRemote
        } elseif ($cmbRemote.Items.Count -gt 0) {
            $cmbRemote.SelectedIndex = 0
        }
        & $updatePreviewLabels
    }

    # Wire up events
    foreach ($rb in @($rbPatch, $rbMinor, $rbMajor, $rbPrerelease, $rbKeep, $rbCustom)) {
        $rb.Add_CheckedChanged($updatePreviewLabels)
    }
    $cmbPreId.Add_SelectedIndexChanged($updatePreviewLabels)
    $txtCustomVer.Add_TextChanged({
        if ($txtCustomVer.Text.Trim()) { $rbCustom.Checked = $true }
        & $updatePreviewLabels
    })

    $btnRefresh.Add_Click({
        & $refreshRepoInfo
        & $appendGuiLog "Refreshed Git repository status and version info." "Cyan"
    })

    $btnVersionOnly.Add_Click({
        try {
            $rtbLog.Clear()
            $mode = & $getSelectedBumpMode
            [void](Update-ProjectVersion `
                -VersionOrBump $mode `
                -CustomVersion $txtCustomVer.Text `
                -PreReleaseId $cmbPreId.SelectedItem `
                -UpdateChangelog:$chkChangelog.Checked `
                -DryRun:$chkDryRun.Checked `
                -Logger $appendGuiLog)
            & $refreshRepoInfo
        } catch {
            & $appendGuiLog "✖ Error: $($_.Exception.Message)" "Red"
            [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Version Update Error", "OK", "Error") | Out-Null
        }
    })

    $btnDeleteTag.Add_Click({
        $s = $script:currentGitState
        $defaultTag = if ($s -and $s.Tags.Count -gt 0) { $s.Tags[0] } else { "v" + (Get-CurrentProjectVersion) }
        $inputTag = [Microsoft.VisualBasic.Interaction]::InputBox("Enter the Git tag name to delete (locally and on remote):", "Delete Git Tag", $defaultTag)
        if ($inputTag -and $inputTag.Trim()) {
            try {
                Remove-ProjectGitTag -TagToRemove $inputTag -RemoteName $cmbRemote.SelectedItem -RemoveFromRemote $true -IsDryRun $chkDryRun.Checked -Logger $appendGuiLog
                & $refreshRepoInfo
            } catch {
                & $appendGuiLog "✖ Error deleting tag: $($_.Exception.Message)" "Red"
            }
        }
    })

    $runWorkflowFromGui = {
        param([bool]$ForceDryRun)
        try {
            $btnReleaseExec.Enabled = $false
            $btnDryRunExec.Enabled = $false
            $rtbLog.Clear()
            $mode = & $getSelectedBumpMode
            [void](Invoke-GitReleaseWorkflow `
                -VersionMode $mode `
                -CustomVersion $txtCustomVer.Text `
                -PreReleaseId $cmbPreId.SelectedItem `
                -CommitMessage $cmbPresetMsg.Text `
                -RemoteName $cmbRemote.SelectedItem `
                -DoCommit $chkCommit.Checked `
                -DoTag $chkTag.Checked `
                -DoPush $chkPush.Checked `
                -ForceTagOverwrite $chkForceTag.Checked `
                -ForceGitPush $chkForcePush.Checked `
                -DoPullRebase $chkPullRebase.Checked `
                -DoUpdateChangelog $chkChangelog.Checked `
                -DoBuildFirst $chkBuildFirst.Checked `
                -IsDryRun ($ForceDryRun -or $chkDryRun.Checked) `
                -Logger $appendGuiLog)
            & $refreshRepoInfo
        } catch {
            & $appendGuiLog "✖ Release Error: $($_.Exception.Message)" "Red"
            [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Release Failed", "OK", "Error") | Out-Null
        } finally {
            $btnReleaseExec.Enabled = $true
            $btnDryRunExec.Enabled = $true
        }
    }

    $btnDryRunExec.Add_Click({ & $runWorkflowFromGui $true })
    $btnReleaseExec.Add_Click({ & $runWorkflowFromGui $false })

    # Initial load
    Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction SilentlyContinue
    & $refreshRepoInfo
    & $appendGuiLog "Ready. Select a version bump mode and options above, then click Execute Release or Update Version Only." "Cyan"

    [void]$form.ShowDialog()
}

# ============================================================================
# 5. Interactive Terminal TUI Menu (-Tui or Fallback)
# ============================================================================
function Show-ReleaseTui {
    $bumpMode = if ($BumpType) { $BumpType } elseif ($Version) { $Version } else { "patch" }
    $customVer = ""
    $preIdVal = if ($PreId) { $PreId } else { "beta" }
    $commitMsg = $Message
    $optCommit = -not $NoCommit
    $optTag = -not $NoTag
    $optPush = -not $NoPush
    $optForceTag = [bool]$ForceTag
    $optForcePush = [bool]$ForcePush
    $optPullRebase = [bool]$PullRebase
    $optChangelog = [bool]$UpdateChangelog
    $optBuild = [bool]$BuildFirst
    $optDryRun = [bool]$DryRun

    while ($true) {
        $summary = Get-GitStatusSummary
        $targetVer = Get-CalculatedVersion -CurrentVersion $summary.CurrentVersion -Mode $bumpMode -CustomVersion $customVer -PreReleaseId $preIdVal

        Write-Host "`n============================================================" -ForegroundColor Magenta
        Write-Host "  🎬 AniFlix Interactive Release & Version Manager (TUI)" -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Magenta
        Write-Host "  Branch:         $($summary.Branch) (Remote: $Remote)" -ForegroundColor White
        Write-Host "  Latest Tag:     $($summary.LatestTag) | Dirty Files: $($summary.ChangedCount)" -ForegroundColor Gray
        Write-Host "  Version Change: " -NoNewline
        Write-Host "v$($summary.CurrentVersion)  ➔  v$targetVer ($bumpMode)" -ForegroundColor Green
        Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
        Write-Host "  [1] Bump Mode:  Patch (+0.0.1)     [2] Minor (+0.1.0)     [3] Major (+1.0.0)"
        Write-Host "  [4] Pre-release (-$preIdVal.N)         [5] Keep Current       [6] Enter Custom SemVer"
        Write-Host "  [V] ⚡ Update Version Files Only (package.json / lock / changelog)" -ForegroundColor Cyan
        Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
        Write-Host "  [C] Commit Changes: $(if ($optCommit) {'[ON] '} else {'[OFF]'})   [T] Create Git Tag:  $(if ($optTag) {'[ON] '} else {'[OFF]'})"
        Write-Host "  [P] Push to Remote: $(if ($optPush) {'[ON] '} else {'[OFF]'})   [L] Update CHANGELOG: $(if ($optChangelog) {'[ON] '} else {'[OFF]'})"
        Write-Host "  [F] Force Tag (-f): $(if ($optForceTag) {'[ON] '} else {'[OFF]'})   [W] Force Push:      $(if ($optForcePush) {'[ON] '} else {'[OFF]'})"
        Write-Host "  [B] Vite Build 1st: $(if ($optBuild) {'[ON] '} else {'[OFF]'})   [D] Dry-Run Mode:    $(if ($optDryRun) {'[ON] '} else {'[OFF]'})"
        Write-Host "  [M] Custom Commit Message: $(if ($commitMsg) { $commitMsg } else { '(auto: chore(release): v' + $targetVer + ')' })"
        Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
        Write-Host "  [R] 🚀 Execute Full Release Now    [Q] Quit" -ForegroundColor Yellow
        Write-Host "============================================================" -ForegroundColor Magenta

        $choice = (Read-Host "Select an option").Trim().ToUpper()
        switch ($choice) {
            "1" { $bumpMode = "patch" }
            "2" { $bumpMode = "minor" }
            "3" { $bumpMode = "major" }
            "4" {
                $bumpMode = "prerelease"
                $newPre = (Read-Host "Enter pre-release tag (beta/rc/alpha/next) [default: $preIdVal]").Trim()
                if ($newPre) { $preIdVal = $newPre }
            }
            "5" { $bumpMode = "keep" }
            "6" {
                $entered = (Read-Host "Enter explicit SemVer (e.g. 2.8.0 or 3.0.0-rc.1)").Trim()
                if ($entered) { $bumpMode = "custom"; $customVer = $entered }
            }
            "V" {
                [void](Update-ProjectVersion -VersionOrBump $bumpMode -CustomVersion $customVer -PreReleaseId $preIdVal -UpdateChangelog:$optChangelog -DryRun:$optDryRun)
                Read-Host "`nPress Enter to continue..."
            }
            "C" { $optCommit = -not $optCommit }
            "T" { $optTag = -not $optTag }
            "P" { $optPush = -not $optPush }
            "L" { $optChangelog = -not $optChangelog }
            "F" { $optForceTag = -not $optForceTag }
            "W" { $optForcePush = -not $optForcePush }
            "B" { $optBuild = -not $optBuild }
            "D" { $optDryRun = -not $optDryRun }
            "M" { $commitMsg = Read-Host "Enter custom commit message (leave blank for default)" }
            "R" {
                [void](Invoke-GitReleaseWorkflow `
                    -VersionMode $bumpMode `
                    -CustomVersion $customVer `
                    -PreReleaseId $preIdVal `
                    -CommitMessage $commitMsg `
                    -RemoteName $Remote `
                    -BranchName $Branch `
                    -DoCommit $optCommit `
                    -DoTag $optTag `
                    -DoPush $optPush `
                    -ForceTagOverwrite $optForceTag `
                    -ForceGitPush $optForcePush `
                    -DoPullRebase $optPullRebase `
                    -DoUpdateChangelog $optChangelog `
                    -DoBuildFirst $optBuild `
                    -IsDryRun $optDryRun)
                break
            }
            "Q" { return }
        }
    }
}

# ============================================================================
# 6. CLI Entrypoint & Mode Dispatch
# ============================================================================
if ($Help) {
    Write-Host @"

AniFlix Release, Version Manager & Git Push/Tag Tool (git-push-tag.ps1)

USAGE:
  .\scripts\git-push-tag.ps1                        # Launch interactive Desktop GUI
  .\scripts\git-push-tag.ps1 -Gui                   # Launch interactive Desktop GUI
  .\scripts\git-push-tag.ps1 -Tui                   # Launch interactive Console TUI menu
  .\scripts\git-push-tag.ps1 <version|bump> [flags] # Run non-interactive CLI release

VERSION / BUMP OPTIONS:
  patch | minor | major | prerelease | prepatch | preminor | premajor | keep | <X.Y.Z>
  -BumpType <type>     Explicit bump type
  -PreId <id>          Pre-release identifier: beta, rc, alpha, next (default: beta)
  -VersionOnly         Only update version in package.json, package-lock.json, and CHANGELOG.md

GIT & RELEASE FLAGS:
  -Message, -m <msg>   Custom commit message (supports {version} and {tag} placeholders)
  -Remote, -r <name>   Git remote name (default: origin)
  -Branch <name>       Git branch to push (default: current branch)
  -UpdateChangelog     Prepend new version section & commit notes to CHANGELOG.md
  -ForceTag            Overwrite existing tag (-f) if it already exists
  -ForcePush           Push branch with --force-with-lease and tag with --force
  -PullRebase          Run 'git pull --rebase' before pushing
  -BuildFirst          Run 'vite build' verification before committing
  -NoCommit            Skip git add/commit
  -NoTag               Skip creating git tag
  -NoPush              Skip pushing to remote
  -DeleteTag <tag>     Delete the specified tag locally and on remote
  -DryRun, -d          Preview all commands without modifying files or git refs

"@ -ForegroundColor Cyan
    exit 0
}

if ($DeleteTag) {
    Remove-ProjectGitTag -TagToRemove $DeleteTag -RemoteName $Remote -RemoveFromRemote (-not $NoPush) -IsDryRun $DryRun
    exit 0
}

# Launch TUI if requested
if ($Tui) {
    Show-ReleaseTui
    exit 0
}

# Launch Desktop GUI if -Gui is passed OR if invoked with zero CLI action parameters (and not -NoGui)
$hasCliActionArgs = [bool]($Version -or $BumpType -or $Message -or $VersionOnly -or $DryRun -or $NoCommit -or $NoTag -or $NoPush -or $ForceTag -or $ForcePush -or $UpdateChangelog -or $BuildFirst -or $PullRebase)

if ($Gui -or (-not $hasCliActionArgs -and -not $NoGui)) {
    try {
        Show-ReleaseGui
        exit 0
    } catch {
        Write-Warning "Desktop GUI unavailable ($($_.Exception.Message)). Falling back to Console TUI..."
        Show-ReleaseTui
        exit 0
    }
}

# Otherwise run non-interactive CLI pipeline directly
$effectiveMode = if ($BumpType) {
    $BumpType
} elseif ($Version) {
    if ($Version -match '^(keep|patch|minor|major|prerelease|prepatch|preminor|premajor)$') {
        $Version.ToLower()
    } else {
        "custom"
    }
} else {
    "keep"
}

[void](Invoke-GitReleaseWorkflow `
    -VersionMode $effectiveMode `
    -CustomVersion $Version `
    -PreReleaseId $PreId `
    -CommitMessage $Message `
    -RemoteName $Remote `
    -BranchName $Branch `
    -DoCommit (-not $NoCommit) `
    -DoTag (-not $NoTag) `
    -DoPush (-not $NoPush) `
    -ForceTagOverwrite $ForceTag `
    -ForceGitPush $ForcePush `
    -DoPullRebase $PullRebase `
    -DoUpdateChangelog $UpdateChangelog `
    -OnlyUpdateVersion $VersionOnly `
    -DoBuildFirst $BuildFirst `
    -IsDryRun $DryRun)
