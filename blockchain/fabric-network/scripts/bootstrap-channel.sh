#!/bin/sh
set -eu

GENERATED=/network/generated
ORGS="${GENERATED}/organizations"
CHANNEL_BLOCK="${GENERATED}/channel-artifacts/labrecords.block"
PACKAGE="${GENERATED}/labrecord-contract_0.1.tgz"
ORDERER_CA="${ORGS}/ordererOrganizations/local/orderers/orderer.local/msp/tlscacerts/tlsca.local-cert.pem"
ORDERER_TLS="${ORGS}/ordererOrganizations/local/orderers/orderer.local/tls"
RHU_TLS="${ORGS}/peerOrganizations/rhu.local/peers/peer0.rhu.local/tls/ca.crt"
VERIFIER_TLS="${ORGS}/peerOrganizations/verifier.local/peers/peer0.verifier.local/tls/ca.crt"

export FABRIC_CFG_PATH=/etc/hyperledger/peercfg
export CORE_PEER_TLS_ENABLED=true

use_rhu() {
  export CORE_PEER_LOCALMSPID=RHULabMSP
  export CORE_PEER_ADDRESS=peer0.rhu.local:7051
  export CORE_PEER_TLS_ROOTCERT_FILE="${RHU_TLS}"
  export CORE_PEER_MSPCONFIGPATH="${ORGS}/peerOrganizations/rhu.local/users/Admin@rhu.local/msp"
}

use_verifier() {
  export CORE_PEER_LOCALMSPID=VerifierMSP
  export CORE_PEER_ADDRESS=peer0.verifier.local:7051
  export CORE_PEER_TLS_ROOTCERT_FILE="${VERIFIER_TLS}"
  export CORE_PEER_MSPCONFIGPATH="${ORGS}/peerOrganizations/verifier.local/users/Admin@verifier.local/msp"
}

wait_for_peer() {
  count=0
  until peer node status >/dev/null 2>&1; do
    count=$((count + 1))
    if [ "${count}" -ge 30 ]; then
      echo "Peer ${CORE_PEER_ADDRESS} did not become ready." >&2
      exit 1
    fi
    sleep 2
  done
}

count=0
until osnadmin channel list \
  -o orderer.local:7053 \
  --ca-file "${ORDERER_CA}" \
  --client-cert "${ORDERER_TLS}/server.crt" \
  --client-key "${ORDERER_TLS}/server.key" >/dev/null 2>&1; do
  count=$((count + 1))
  if [ "${count}" -ge 30 ]; then break; fi
  sleep 2
done

if ! osnadmin channel list \
  -o orderer.local:7053 \
  --ca-file "${ORDERER_CA}" \
  --client-cert "${ORDERER_TLS}/server.crt" \
  --client-key "${ORDERER_TLS}/server.key" 2>/dev/null | grep -q 'labrecords'; then
  osnadmin channel join \
    --channelID labrecords \
    --config-block "${CHANNEL_BLOCK}" \
    -o orderer.local:7053 \
    --ca-file "${ORDERER_CA}" \
    --client-cert "${ORDERER_TLS}/server.crt" \
    --client-key "${ORDERER_TLS}/server.key"
fi

use_rhu
wait_for_peer
if ! peer channel list 2>/dev/null | grep -q 'labrecords'; then peer channel join -b "${CHANNEL_BLOCK}"; fi

use_verifier
wait_for_peer
if ! peer channel list 2>/dev/null | grep -q 'labrecords'; then peer channel join -b "${CHANNEL_BLOCK}"; fi

if [ ! -f "${PACKAGE}" ]; then
  peer lifecycle chaincode package "${PACKAGE}" \
    --path /workspace/blockchain/chaincode \
    --lang node \
    --label labrecord-contract_0.1
fi
PACKAGE_ID="$(peer lifecycle chaincode calculatepackageid "${PACKAGE}")"

use_rhu
if ! peer lifecycle chaincode queryinstalled 2>/dev/null | grep -q "${PACKAGE_ID}"; then peer lifecycle chaincode install "${PACKAGE}"; fi
peer lifecycle chaincode approveformyorg \
  -o orderer.local:7050 --ordererTLSHostnameOverride orderer.local \
  --channelID labrecords --name labrecord-contract --version 0.1.0 \
  --package-id "${PACKAGE_ID}" --sequence 1 --tls --cafile "${ORDERER_CA}"

use_verifier
if ! peer lifecycle chaincode queryinstalled 2>/dev/null | grep -q "${PACKAGE_ID}"; then peer lifecycle chaincode install "${PACKAGE}"; fi
peer lifecycle chaincode approveformyorg \
  -o orderer.local:7050 --ordererTLSHostnameOverride orderer.local \
  --channelID labrecords --name labrecord-contract --version 0.1.0 \
  --package-id "${PACKAGE_ID}" --sequence 1 --tls --cafile "${ORDERER_CA}"

use_rhu
if ! peer lifecycle chaincode querycommitted --channelID labrecords --name labrecord-contract >/dev/null 2>&1; then
  peer lifecycle chaincode commit \
    -o orderer.local:7050 --ordererTLSHostnameOverride orderer.local \
    --channelID labrecords --name labrecord-contract --version 0.1.0 --sequence 1 \
    --peerAddresses peer0.rhu.local:7051 --tlsRootCertFiles "${RHU_TLS}" \
    --peerAddresses peer0.verifier.local:7051 --tlsRootCertFiles "${VERIFIER_TLS}" \
    --tls --cafile "${ORDERER_CA}"
fi

peer lifecycle chaincode querycommitted --channelID labrecords --name labrecord-contract
echo "Fabric channel labrecords and chaincode labrecord-contract are ready."
