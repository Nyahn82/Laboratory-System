import { describe, expect, it, vi } from 'vitest';
import { nodeStatus, requireAdministrator } from '../src/services/node-status.js';

const config = { authServiceUrl: 'http://auth.test', fabric: { channel: 'labrecords', chaincode: 'labrecord-contract',
  rhuOperationsUrl: 'http://rhu.test/healthz', verifierOperationsUrl: 'http://verifier.test/healthz', ordererOperationsUrl: 'http://orderer.test/healthz' } };
const ledger = (simulated = false, ok = true) => ({ simulated, provider: simulated ? 'file' : 'hyperledger-fabric', health: vi.fn().mockResolvedValue({ ok }) });

describe('blockchain node monitoring', () => {
  it('never probes or marks real nodes healthy in simulation mode', async () => {
    const fetchImpl = vi.fn();
    const result = await nodeStatus(config, ledger(true), fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.ledgerStatus).toBe('Simulated');
    expect(result.nodes.map((node) => node.status)).toEqual(['Not connected', 'Not connected', 'Not connected']);
  });
  it('checks each node independently and keeps ledger failure separate', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ status: 'OK' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'Service Unavailable' }), { status: 503 }))
      .mockRejectedValueOnce(new Error('Timed out'));
    const result = await nodeStatus(config, ledger(false, false), fetchImpl);
    expect(result.nodes.map((node) => node.status)).toEqual(['Healthy', 'Unhealthy', 'Unavailable']);
    expect(result.ledgerStatus).toBe('Unavailable');
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([config.fabric.rhuOperationsUrl, config.fabric.verifierOperationsUrl, config.fabric.ordererOperationsUrl]);
  });
  it('does not treat an arbitrary successful HTTP response as a healthy Fabric node', async () => {
    const result = await nodeStatus(config, ledger(), vi.fn(async () => new Response('{}')));
    expect(result.nodes.every((node) => node.status === 'Unhealthy')).toBe(true);
  });
  it('requires a current active administrator account with a completed password change', async () => {
    const fetchImpl = vi.fn();
    await expect(requireAdministrator(null, config, fetchImpl)).rejects.toThrow('Sign in');
    expect(fetchImpl).not.toHaveBeenCalled();
    for (const user of [
      { roles: ['DOCTOR'], status: 'ACTIVE' },
      { roles: ['SYSTEM_ADMIN'], status: 'DISABLED' },
      { roles: ['SYSTEM_ADMIN'], status: 'ACTIVE', mustChangePassword: true },
    ]) {
      fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ data: user })));
      await expect(requireAdministrator('Bearer test', config, fetchImpl)).rejects.toThrow('Administrator');
    }
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ data: { roles: ['SYSTEM_ADMIN'], status: 'ACTIVE', mustChangePassword: false } })));
    await expect(requireAdministrator('Bearer test', config, fetchImpl)).resolves.toBeUndefined();
    fetchImpl.mockRejectedValueOnce(new Error('Offline'));
    await expect(requireAdministrator('Bearer test', config, fetchImpl)).rejects.toThrow('unavailable');
  });
});
