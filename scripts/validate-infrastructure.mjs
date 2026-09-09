import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const read = (filename) => readFile(path.join(root, filename), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const [baseText, fabricText, configtxText, cryptoText, gatewayText] = await Promise.all([
  read('docker-compose.yml'),
  read('docker-compose.fabric.yml'),
  read('blockchain/fabric-network/config/configtx.yaml'),
  read('blockchain/fabric-network/config/crypto-config.yaml'),
  read('gateway/nginx/nginx.conf'),
]);
const base = YAML.parse(baseText);
const fabric = YAML.parse(fabricText);
const configtx = YAML.parse(configtxText);
const crypto = YAML.parse(cryptoText);

const baseServices = ['gateway', 'web', 'auth-service', 'records-service', 'storage-service', 'verification-service', 'mysql', 'ipfs'];
const fabricServices = ['orderer', 'peer0-rhu', 'peer0-verifier', 'fabric-tools'];
for (const service of baseServices) assert(base.services?.[service], `Base Compose service is missing: ${service}`);
for (const service of fabricServices) assert(fabric.services?.[service], `Fabric Compose service is missing: ${service}`);
assert(base.ports === undefined, 'Host ports must be declared per service, not globally.');
assert(base.services.gateway.ports?.includes('127.0.0.1:8080:80'), 'Gateway must bind only to loopback port 8080.');
assert(base.networks?.data_internal?.internal === true, 'The data network must be internal.');
assert(configtx.Profiles?.LabRecordsChannel, 'LabRecordsChannel profile is missing.');
assert(crypto.PeerOrgs?.length === 2, 'Exactly two Fabric peer organizations are required.');
assert(crypto.PeerOrgs.some((organization) => organization.Domain === 'rhu.local'), 'rhu.local peer organization is missing.');
assert(crypto.PeerOrgs.some((organization) => organization.Domain === 'verifier.local'), 'verifier.local peer organization is missing.');
for (const route of ['/api/auth/', '/api/records/', '/api/storage/', '/api/verification/']) {
  assert(gatewayText.includes(`location ${route}`), `Gateway route is missing: ${route}`);
}
for (const filename of [
  'gateway/nginx/proxy-params.conf',
  'gateway/nginx/security-headers.conf',
  'blockchain/fabric-network/scripts/generate-artifacts.sh',
  'blockchain/fabric-network/scripts/bootstrap-channel.sh',
]) await access(path.join(root, filename));

console.log(JSON.stringify({
  valid: true,
  baseServices,
  fabricServices,
  channel: 'labrecords',
  chaincode: 'labrecord-contract',
  peerOrganizations: crypto.PeerOrgs.map((organization) => organization.Domain),
}, null, 2));
