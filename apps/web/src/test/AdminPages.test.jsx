import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { AuthContext } from '../auth/AuthContext.jsx';
import { authApi, recordsApi, verificationApi } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  authApi: { users: vi.fn(), roles: vi.fn(), user: vi.fn(), userAudit: vi.fn() },
  recordsApi: { audit: vi.fn(), dashboard: vi.fn() }, verificationApi: { nodes: vi.fn() }, healthApi: { all: vi.fn() },
}));
const account = { id: 'account-1', firstName: 'Alex', lastName: 'Reyes', email: 'alex@lab.local', status: 'ACTIVE', roles: ['DOCTOR'], createdAt: '2026-01-01T00:00:00Z' };
function open(path, role = 'SYSTEM_ADMIN') {
  return render(<AuthContext.Provider value={{ user: { id: 'admin', email: 'admin@lab.local', roles: [role] }, loading: false }}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></AuthContext.Provider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  authApi.users.mockResolvedValue({ items: [account], pagination: { total: 1 } });
  authApi.roles.mockResolvedValue({ items: [] });
  authApi.user.mockResolvedValue(account);
  authApi.userAudit.mockResolvedValue({ items: [{ id: 'event-1', actorUserId: account.id, eventType: 'AUTH_LOGIN', outcome: 'SUCCESS' }], pagination: { total: 26 } });
  recordsApi.audit.mockResolvedValue({ items: [], pagination: { total: 0 } });
});
afterEach(cleanup);

describe('administration', () => {
  it('opens Accounts directly and navigates from an account to its information and trails', async () => {
    open('/dashboard');
    fireEvent.click(await screen.findByRole('link', { name: 'Alex Reyes' }));
    expect(await screen.findByRole('heading', { name: 'Account information' })).toBeInTheDocument();
    expect(await screen.findByText('Sign-in')).toBeInTheDocument();
    expect(screen.queryByText('My workspace')).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'Nodes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('26–26 of 26');
    expect(authApi.userAudit).toHaveBeenLastCalledWith('account-1', 25);
    fireEvent.click(screen.getByRole('button', { name: 'Laboratory activity' }));
    expect(await screen.findByText('No activity recorded')).toBeInTheDocument();
    expect(recordsApi.audit).toHaveBeenCalledWith('?actorUserId=account-1&limit=25&offset=0');
  });
  it('shows unavailable account trails as errors instead of empty activity', async () => {
    authApi.userAudit.mockRejectedValue(new Error('Audit service unavailable'));
    open('/accounts/account-1');
    expect(await screen.findByText('Audit service unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No activity recorded')).not.toBeInTheDocument();
  });
  it('shows simulated nodes explicitly and allows refreshing checks', async () => {
    verificationApi.nodes.mockResolvedValue({ simulated: true, ledgerStatus: 'Simulated', channel: 'labrecords', chaincode: 'labrecord-contract', nodes: [{ id: 'rhu', name: 'RHU peer', type: 'Peer', status: 'Not connected', message: 'Local simulation.' }] });
    open('/nodes');
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh checks' }));
    await screen.findByText('Not connected');
    expect(verificationApi.nodes).toHaveBeenCalledTimes(2);
  });
  it('blocks node monitoring from non-admin workspaces', async () => {
    recordsApi.dashboard.mockResolvedValue({ metrics: {} });
    open('/nodes', 'DOCTOR');
    expect(await screen.findByRole('heading', { name: 'Doctor workspace' })).toBeInTheDocument();
    expect(verificationApi.nodes).not.toHaveBeenCalled();
  });
});
