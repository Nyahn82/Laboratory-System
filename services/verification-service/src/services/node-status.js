import { ApiError } from '@rhu-labchain/service-kit';

export async function requireAdministrator(authorization, config, fetchImpl = fetch) {
  if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'Sign in to view nodes.', [], 'AUTH_REQUIRED');
  let response;
  try {
    response = await fetchImpl(`${config.authServiceUrl}/me`, {
      headers: { authorization }, signal: AbortSignal.timeout(5000), redirect: 'error',
    });
  } catch { throw new ApiError(503, 'Account verification is unavailable.', [], 'AUTH_UNAVAILABLE'); }
  if (response.status === 401) throw new ApiError(401, 'Your session has expired.', [], 'AUTH_REQUIRED');
  if (!response.ok) throw new ApiError(503, 'Account verification is unavailable.', [], 'AUTH_UNAVAILABLE');
  const { data: user } = await response.json();
  if (user?.status !== 'ACTIVE' || user.mustChangePassword || !user.roles?.includes('SYSTEM_ADMIN')) {
    throw new ApiError(403, 'Administrator access is required.', [], 'ACCESS_DENIED');
  }
}

export async function nodeStatus(config, ledger, fetchImpl = fetch) {
  const simulated = Boolean(ledger.simulated);
  const definitions = [
    { id: 'rhu-peer', name: 'RHU peer', type: 'Peer', url: config.fabric.rhuOperationsUrl },
    { id: 'verifier-peer', name: 'Verifier peer', type: 'Peer', url: config.fabric.verifierOperationsUrl },
    { id: 'orderer', name: 'Orderer', type: 'Orderer', url: config.fabric.ordererOperationsUrl },
  ];
  const [ledgerStatus, nodes] = await Promise.all([
    ledger.health().catch(() => ({ ok: false })),
    Promise.all(definitions.map(async ({ url, ...node }) => {
      if (simulated) return { ...node, status: 'Not connected', message: 'Local development uses a simulated ledger.' };
      const start = Date.now();
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
        const health = await response.json();
        const healthy = response.ok && health.status === 'OK';
        return { ...node, status: healthy ? 'Healthy' : 'Unhealthy', latencyMs: Date.now() - start,
          message: healthy ? 'Node health check passed.' : 'Node health check did not pass.' };
      } catch {
        return { ...node, status: 'Unavailable', message: 'The node could not be reached or returned an invalid health response.' };
      }
    })),
  ]);
  return { checkedAt: new Date().toISOString(), simulated, provider: ledger.provider,
    channel: config.fabric.channel, chaincode: config.fabric.chaincode,
    ledgerStatus: ledgerStatus.ok ? (simulated ? 'Simulated' : 'Ready') : 'Unavailable', nodes };
}
