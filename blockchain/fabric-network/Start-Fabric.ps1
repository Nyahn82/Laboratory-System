[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$BaseCompose = Join-Path $RepositoryRoot 'docker-compose.yml'
$FabricCompose = Join-Path $RepositoryRoot 'docker-compose.fabric.yml'
$ComposeArguments = @('-f', $BaseCompose, '-f', $FabricCompose)

docker version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not available.' }

Write-Host 'Generating local-only Fabric identities and channel material...'
docker compose @ComposeArguments run --rm --entrypoint sh fabric-tools /workspace/blockchain/fabric-network/scripts/generate-artifacts.sh
if ($LASTEXITCODE -ne 0) { throw 'Fabric artifact generation failed.' }

Write-Host 'Starting the orderer and both organization peers...'
docker compose @ComposeArguments --profile fabric up -d orderer peer0-rhu peer0-verifier
if ($LASTEXITCODE -ne 0) { throw 'Fabric containers failed to start.' }

Write-Host 'Joining labrecords and deploying labrecord-contract...'
docker compose @ComposeArguments run --rm --entrypoint sh fabric-tools /workspace/blockchain/fabric-network/scripts/bootstrap-channel.sh
if ($LASTEXITCODE -ne 0) { throw 'Fabric channel or chaincode bootstrap failed.' }

Write-Host 'Switching Verification Service from the labeled file adapter to Fabric...'
docker compose @ComposeArguments --profile fabric up -d --build verification-service gateway
if ($LASTEXITCODE -ne 0) { throw 'Verification Service could not be started with the Fabric adapter.' }

Write-Host 'Fabric startup finished. Confirm /api/verification/ready reports simulated=false.'
