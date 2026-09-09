FROM ipfs/kubo:v0.42.0
COPY infrastructure/ipfs/001-private-network.sh /container-init.d/001-private-network.sh
USER root
RUN chmod 0755 /container-init.d/001-private-network.sh
USER ipfs

