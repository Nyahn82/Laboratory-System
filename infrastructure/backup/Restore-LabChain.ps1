[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9]{4,20}$')]
    [string]$RecoverySuffix,
    [switch]$ConfirmRestore
)

$ErrorActionPreference = "Stop"
if (-not $ConfirmRestore) {
    throw "Restore was not authorized. Re-run with -ConfirmRestore after reviewing the target and backup manifest."
}
$resolvedBackup = (Resolve-Path -LiteralPath $BackupDirectory).Path
& (Join-Path $PSScriptRoot "Verify-Backup.ps1") -BackupDirectory $resolvedBackup

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$recoveryRoot = Join-Path $workspaceRoot "recovery\$RecoverySuffix"
if (Test-Path -LiteralPath $recoveryRoot) { throw "Recovery target already exists and will not be overwritten: $recoveryRoot" }
New-Item -ItemType Directory -Path $recoveryRoot -Force | Out-Null

$mysqlRunning = docker inspect -f '{{.State.Running}}' rhu-labchain-mysql-1 2>$null
if ($mysqlRunning -ne "true") { throw "The LabChain MySQL container must be running." }
$schemas = @("auth_db", "records_db", "storage_db", "verification_db")
foreach ($schema in $schemas) {
    $restoreSchema = "${schema}_restore_${RecoverySuffix}"
    $sqlPath = Join-Path $resolvedBackup "mysql\$schema.sql"
    if (-not (Test-Path -LiteralPath $sqlPath)) { throw "Missing SQL backup: $sqlPath" }
    docker exec rhu-labchain-mysql-1 sh -c "mysql -uroot -p`"`$MYSQL_ROOT_PASSWORD`" -e 'CREATE DATABASE ``$restoreSchema`` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'"
    Get-Content -LiteralPath $sqlPath -Raw | docker exec -i rhu-labchain-mysql-1 sh -c "mysql -uroot -p`"`$MYSQL_ROOT_PASSWORD`" $restoreSchema"
    if ($LASTEXITCODE -ne 0) { throw "Failed to restore $schema into $restoreSchema" }
}

$volumeName = "rhu_labchain_ipfs_restore_$RecoverySuffix"
docker volume create $volumeName | Out-Null
docker run --rm -v "${volumeName}:/restore" -v "${resolvedBackup}:/backup:ro" alpine:3.22 tar -xzf /backup/ipfs-repository.tar.gz -C /restore --strip-components=1
if ($LASTEXITCODE -ne 0) { throw "Failed to stage the IPFS repository in $volumeName" }

Copy-Item -LiteralPath (Join-Path $resolvedBackup "configuration") -Destination $recoveryRoot -Recurse
@{
    restored_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    mysql_suffix = $RecoverySuffix
    ipfs_volume = $volumeName
    source = $resolvedBackup
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $recoveryRoot "recovery.json") -Encoding utf8

Write-Host "Recovery was staged without overwriting active data: $recoveryRoot"
Write-Warning "Do not switch production-style configuration until a known synthetic released record decrypts and verifies against the intended Fabric ledger backup. Fabric ledger volumes require coordinated peer/orderer recovery; see docs/BLOCKCHAIN.md."
