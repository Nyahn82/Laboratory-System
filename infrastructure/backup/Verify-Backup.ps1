[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory
)

$ErrorActionPreference = "Stop"
$resolved = (Resolve-Path -LiteralPath $BackupDirectory).Path
$manifestPath = Join-Path $resolved "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "manifest.json was not found in $resolved" }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$failures = @()
foreach ($entry in $manifest) {
    $filePath = Join-Path $resolved $entry.path
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { $failures += "Missing: $($entry.path)"; continue }
    $actual = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $entry.sha256) { $failures += "Checksum mismatch: $($entry.path)" }
}
if ($failures.Count -gt 0) { throw ($failures -join [Environment]::NewLine) }
Write-Host "Backup manifest verified: $($manifest.Count) files passed."

