# Hyperledger Fabric and Verification

## Purpose and boundary

Fabric proves integrity, version history, issuer, and release/revocation events. It does not authorize users, diagnose patients, store a complete record, or replace the Records database.

The local network simulates two organizations on one computer:

- `peer0.rhu.local` / `RHULabMSP`
- `peer0.verifier.local` / `VerifierMSP`
- one local ordering service
- private channel `labrecords`
- chaincode `labrecord-contract`

This is logical separation, not independent physical decentralization.

## Allowed ledger asset

Only these proof fields are allowed:

- Opaque record identifier (never a patient number)
- Immutable record version
- SHA-256 hash of the encrypted envelope
- Protected private-IPFS CID reference when configured
- Approval and release timestamps
- Issuing organization/MSP
- Status and transaction metadata
- Previous transaction/version link

Patient name/code, address, contact data, consultation/diagnosis, clinical notes, measured values, passwords, refresh/QR tokens, encryption keys/nonces/tags, and plaintext files are prohibited. Chaincode validates inputs against prohibited fields.

## Chaincode functions

- `RegisterRecord`
- `RegisterRecordVersion`
- `ReleaseRecord`
- `RevokeRecord`
- `GetRecord`
- `GetRecordHistory`
- `VerifyRecord`

Corrections register a new version and retain the prior transaction link. Old public tokens become superseded/revoked rather than disappearing.

## Development ledger

`LEDGER_DRIVER=file` is an append-only local adapter so the application and end-to-end workflow can run before Fabric is bootstrapped. `/ready` and the frontend label it **Simulated**. It must never be described as a real blockchain transaction.

## Real Fabric setup

Prerequisites: Docker Desktop, WSL2, Git, and generated local-only Fabric identities. Generated certificates/private keys and channel artifacts are ignored by Git.

From PowerShell in the repository root, use the checked startup script:

```powershell
.\blockchain\fabric-network\Start-Fabric.ps1
Invoke-RestMethod http://localhost:8080/api/verification/ready
```

The script runs `cryptogen` and `configtxgen` in Fabric Tools, joins the orderer and both peers to `labrecords`, installs/approves/commits `labrecord-contract`, then recreates Verification Service with the Fabric Gateway identity. Generated identities and channel artifacts stay under ignored `blockchain/fabric-network/generated/`.

Then set/override:

```text
LEDGER_DRIVER=fabric
FABRIC_CHANNEL=labrecords
FABRIC_CHAINCODE=labrecord-contract
FABRIC_MSP_ID=RHULabMSP
FABRIC_GATEWAY_PEER=peer0.rhu.local:7051
FABRIC_TLS_CERT_PATH=...
FABRIC_IDENTITY_CERT_PATH=...
FABRIC_IDENTITY_KEY_PATH=...
```

Open `http://localhost:8080/api/verification/ready`. It must report `fabric`, committed channel/chaincode readiness, and no simulated warning before Fabric claims are accepted.

## Peer/recovery tests

1. Register and release a known synthetic version.
2. Query proof and history through the RHU peer.
3. Stop `peer0.verifier.local`.
4. Create another version/proof through the RHU peer.
5. Restart verifier, wait for catch-up, and query both peers.
6. Compare opaque fields and hashes; neither response may contain clinical data.

Fabric volumes, CA state/identities, channel configuration, chaincode packages, and protected application keys must be recovered as one coordinated system. Restoring a peer ledger alone is not sufficient.
