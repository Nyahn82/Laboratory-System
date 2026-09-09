[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$OutputDirectory = ".\backups"
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$resolvedParent = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))
if (-not $resolvedParent.StartsWith($workspaceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Backup output must remain inside the project workspace: $workspaceRoot"
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$backupRoot = Join-Path $resolvedParent "labchain-$stamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $backupRoot "mysql") -Force | Out-Null

$requiredContainers = @("rhu-labchain-mysql-1", "rhu-labchain-ipfs-1")
foreach ($container in $requiredContainers) {
    $running = docker inspect -f '{{.State.Running}}' $container 2>$null
    if ($running -ne "true") { throw "Required container is not running: $container" }
}

$schemas = @("auth_db", "records_db", "storage_db", "verification_db")
foreach ($schema in $schemas) {
    $target = Join-Path $backupRoot "mysql\$schema.sql"
    docker exec rhu-labchain-mysql-1 sh -c "exec mysqldump --single-transaction --routines --triggers -uroot -p`"`$MYSQL_ROOT_PASSWORD`" $schema" | Set-Content -LiteralPath $target -Encoding utf8
}

docker run --rm --volumes-from rhu-labchain-ipfs-1 -v "${backupRoot}:/backup" alpine:3.22 tar -czf /backup/ipfs-repository.tar.gz -C /data ipfs
if ($LASTEXITCODE -ne 0) { throw "IPFS backup failed." }

$configTarget = Join-Path $backupRoot "configuration"
New-Item -ItemType Directory -Path $configTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $workspaceRoot "docker-compose.yml") -Destination $configTarget
Copy-Item -LiteralPath (Join-Path $workspaceRoot ".env.example") -Destination $configTarget
if (Test-Path (Join-Path $workspaceRoot "docker-compose.fabric.yml")) {
    Copy-Item -LiteralPath (Join-Path $workspaceRoot "docker-compose.fabric.yml") -Destination $configTarget
}

$files = Get-ChildItem -LiteralPath $backupRoot -File -Recurse
$manifest = foreach ($file in $files) {
    [PSCustomObject]@{
        path = [System.IO.Path]::GetRelativePath($backupRoot, $file.FullName)
        bytes = $file.Length
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $backupRoot "manifest.json") -Encoding utf8
Write-Host "Backup created and checksummed at $backupRoot"
Write-Warning "Encryption keys and .env are intentionally excluded. Back them up separately using an approved secret escrow process."

