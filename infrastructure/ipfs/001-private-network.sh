#!/bin/sh
set -eu

REPO_PATH="${IPFS_PATH:-/data/ipfs}"
SWARM_KEY_PATH="${REPO_PATH}/swarm.key"

if [ ! -f "${SWARM_KEY_PATH}" ]; then
  umask 077
  RANDOM_HEX="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  {
    echo '/key/swarm/psk/1.0.0/'
    echo '/base16/'
    echo "${RANDOM_HEX}"
  } > "${SWARM_KEY_PATH}"
fi

ipfs bootstrap rm --all >/dev/null 2>&1 || true
ipfs config --json Discovery.MDNS.Enabled false
ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080

