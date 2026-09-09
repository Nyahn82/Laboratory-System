# Local two-organization Fabric network

This network is optional for the first native/base-Docker run. The base stack uses an explicitly labeled file ledger; these files provide the real Hyperledger Fabric 2.5 path required for Phase One.

## Components

- `peer0.rhu.local` (`RHULabMSP`)
- `peer0.verifier.local` (`VerifierMSP`)
- `orderer.local` (`OrdererMSP`)
- application channel `labrecords`
- Node chaincode `labrecord-contract`

All three nodes run on the same Docker Desktop host. This simulates organizational separation but is not independent physical decentralization.

## Start

Start the base application once, then run this from repository-root PowerShell:

```powershell
.\blockchain\fabric-network\Start-Fabric.ps1
Invoke-RestMethod http://localhost:8080/api/verification/ready
```

The script generates ignored, local-only identities with `cryptogen`, creates the channel-participation block, starts both peers and the orderer, joins them to `labrecords`, installs/approves/commits the chaincode, and recreates Verification Service with `LEDGER_DRIVER=fabric`.

A successful readiness response must report `ledgerDriver: fabric`, `simulated: false`, channel `labrecords`, and chaincode `labrecord-contract`. Do not call a file-ledger receipt a blockchain transaction.

## Stop without deleting data

```powershell
.\blockchain\fabric-network\Stop-Fabric.ps1
```

The stop script retains identities, channel material, and named volumes. Removing those assets is intentionally not automated because it destroys the local ledger identity/history relationship.

## Rebuild or recover

Back up `blockchain/fabric-network/generated/` through protected configuration escrow and coordinate it with the three Fabric named volumes. Never commit generated private keys. To regenerate a different network, first stop it, verify the intended backup, and explicitly remove only the three `fabric_*` volumes plus `generated/`; do not mix new MSP identities with an old ledger.

## Troubleshooting

- Use `docker compose -f docker-compose.yml -f docker-compose.fabric.yml --profile fabric ps` to inspect status.
- Use the same command with `logs orderer peer0-rhu peer0-verifier verification-service` for failures.
- If chaincode launch cannot access Docker, confirm Docker Desktop exposes `/var/run/docker.sock` to Linux containers.
- If Verification readiness is false, confirm the generated application identity exists under `generated/application/rhu`, the chaincode is committed, and `peer0.rhu.local:7051` resolves on `fabric_net`.
