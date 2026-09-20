[CmdletBinding()]
param(
    [switch]$Publish,
    [switch]$UploadOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repoRoot
function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE." }
}
function Invoke-Packager {
    $arguments = @('--no-install', 'electron-builder', '--win', 'nsis', '--x64', '--publish', 'never')
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        & npx.cmd @arguments
        if ($LASTEXITCODE -eq 0) { return }
        if ($attempt -eq 2) { throw "Installer packaging failed twice (exit code $LASTEXITCODE). See the electron-builder error above." }
        Write-Warning 'Installer packaging failed. Waiting five seconds before one retry in case Windows temporarily locked the build folder.'
        Start-Sleep -Seconds 5
    }
}
function Read-Checked {
    param([string]$Command, [string[]]$Arguments)
    $result = & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE." }
    return ($result -join "`n")
}
try {
    $version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Use a stable three-part package version.' }
    $tag = "v$version"
    $commit = (Read-Checked 'git' @('rev-parse', 'HEAD')).Trim()
    if ((Read-Checked 'git' @('status', '--porcelain')).Trim()) { throw 'Commit your source changes before building a release.' }
    $installer = "dist/Relay-Studio-$version-x64.exe"
    $checksums = "dist/SHA256SUMS-$version.txt"
    $manifestPath = 'dist/release-build.json'
    $notes = "docs/releases/$tag.md"
    if (!(Test-Path -LiteralPath $notes)) { throw "Release notes are missing: $notes" }
    if (!$UploadOnly) {
        Invoke-Checked 'npm.cmd' @('ci')
        Invoke-Checked 'npm.cmd' @('test')
        Invoke-Checked 'npm.cmd' @('run', 'test:e2e')
        Invoke-Packager
        Invoke-Checked 'node' @('scripts/smoke-packaged.mjs')
        $hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $([IO.Path]::GetFileName($installer))" | Set-Content -LiteralPath $checksums -Encoding ascii
        @{ version = $version; commit = $commit; sha256 = $hash } | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding ascii
    }
    if (!(Test-Path -LiteralPath $manifestPath)) { throw 'No verified build exists. Run without -UploadOnly first.' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifest.version -ne $version -or $manifest.commit -ne $commit -or $manifest.sha256 -ne $hash) { throw 'The build does not match this commit/version. Rebuild without -UploadOnly.' }
    "$hash  $([IO.Path]::GetFileName($installer))" | Set-Content -LiteralPath $checksums -Encoding ascii
    if (!$Publish) {
        Write-Host "Installer ready: $installer"
        Write-Host 'To publish this verified build: powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Publish -UploadOnly'
        return
    }
    Invoke-Checked 'gh' @('auth', 'status')
    $remoteHead = (Read-Checked 'git' @('ls-remote', 'origin', 'refs/heads/main')).Split("`t")[0].Trim()
    if ($remoteHead -ne $commit) { throw 'Push this commit to main before publishing it.' }
    $listed = Read-Checked 'gh' @('release', 'list', '--limit', '1000', '--json', 'tagName,isDraft') | ConvertFrom-Json
    $draft = @($listed | Where-Object { $_.tagName -eq $tag })
    if ($draft.Count -gt 0) {
        $existing = Read-Checked 'gh' @('release', 'view', $tag, '--json', 'isDraft,targetCommitish') | ConvertFrom-Json
        if (!$existing.isDraft) { throw "$tag is already published. This script will not replace a published release." }
        if ($existing.targetCommitish -ne $commit) { throw 'The existing draft targets a different commit. Inspect it before continuing.' }
    } else {
        Invoke-Checked 'gh' @('release', 'create', $tag, '--target', $commit, '--title', "Relay Studio $tag", '--notes-file', $notes, '--draft')
    }
    # If the upload is interrupted, run -Publish -UploadOnly to retry the same draft.
    Invoke-Checked 'gh' @('release', 'upload', $tag, $installer, $checksums, '--clobber')
    $uploaded = (Read-Checked 'gh' @('release', 'view', $tag, '--json', 'assets') | ConvertFrom-Json).assets
    $asset = @($uploaded | Where-Object { $_.name -eq [IO.Path]::GetFileName($installer) })
    if ($asset.Count -ne 1 -or $asset[0].state -ne 'uploaded' -or $asset[0].digest -ne "sha256:$hash") { throw 'Uploaded installer verification failed. The release remains a draft.' }
    Invoke-Checked 'gh' @('release', 'edit', $tag, '--draft=false', '--latest', '--notes-file', $notes)
    Invoke-Checked 'gh' @('release', 'view', $tag, '--json', 'url', '--jq', '.url')
} finally {
    Pop-Location
}
