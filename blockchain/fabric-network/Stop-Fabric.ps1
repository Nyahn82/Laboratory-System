[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$BaseCompose = Join-Path $RepositoryRoot 'docker-compose.yml'
$FabricCompose = Join-Path $RepositoryRoot 'docker-compose.fabric.yml'

docker compose -f $BaseCompose -f $FabricCompose --profile fabric stop verification-service peer0-verifier peer0-rhu orderer
if ($LASTEXITCODE -ne 0) { throw 'One or more Fabric services could not be stopped.' }
docker compose -f $BaseCompose up -d --force-recreate verification-service gateway
if ($LASTEXITCODE -ne 0) { throw 'The base file-ledger Verification Service could not be restored.' }
Write-Host 'Fabric services stopped. Named volumes and generated identities were retained; Verification Service is back on its labeled file adapter.'
