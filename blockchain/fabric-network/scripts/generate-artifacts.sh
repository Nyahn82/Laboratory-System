#!/bin/sh
set -eu

CONFIG_ROOT=/workspace/blockchain/fabric-network/config
OUTPUT_ROOT=/network/generated
ORGANIZATIONS="${OUTPUT_ROOT}/organizations"
CHANNEL_ARTIFACTS="${OUTPUT_ROOT}/channel-artifacts"

mkdir -p "${ORGANIZATIONS}" "${CHANNEL_ARTIFACTS}" "${OUTPUT_ROOT}/application/rhu/user/keystore" "${OUTPUT_ROOT}/application/rhu/peer-tls"

if [ ! -f "${ORGANIZATIONS}/peerOrganizations/rhu.local/msp/config.yaml" ]; then
  cryptogen generate --config="${CONFIG_ROOT}/crypto-config.yaml" --output="${ORGANIZATIONS}"
fi

FABRIC_CFG_PATH="${CONFIG_ROOT}" configtxgen \
  -profile LabRecordsChannel \
  -channelID labrecords \
  -outputBlock "${CHANNEL_ARTIFACTS}/labrecords.block"

RHU_USER_ROOT="${ORGANIZATIONS}/peerOrganizations/rhu.local/users/User1@rhu.local"
RHU_PEER_TLS="${ORGANIZATIONS}/peerOrganizations/rhu.local/peers/peer0.rhu.local/tls"
IDENTITY_KEY="$(find "${RHU_USER_ROOT}/msp/keystore" -type f -name '*_sk' | head -n 1)"

test -n "${IDENTITY_KEY}"
cp "${RHU_USER_ROOT}/msp/signcerts/User1@rhu.local-cert.pem" "${OUTPUT_ROOT}/application/rhu/user/signcert.pem"
cp "${IDENTITY_KEY}" "${OUTPUT_ROOT}/application/rhu/user/keystore/key.pem"
cp "${RHU_PEER_TLS}/ca.crt" "${OUTPUT_ROOT}/application/rhu/peer-tls/ca.crt"
chmod 0600 "${OUTPUT_ROOT}/application/rhu/user/keystore/key.pem"

echo "Generated local Fabric identities and the labrecords application-channel block."
