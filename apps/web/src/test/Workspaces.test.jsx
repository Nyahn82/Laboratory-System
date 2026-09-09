import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { AuthContext } from '../auth/AuthContext.jsx';
import { authApi, healthApi, recordsApi } from '../api/client.js';
import { verificationToken } from '../pages/DashboardPage.jsx';

vi.mock('../api/client.js', () => ({
  recordsApi: { dashboard: vi.fn(), ownResults: vi.fn(), orders: vi.fn(), patients: vi.fn(), outbox: vi.fn(), visits: vi.fn(), consultations: vi.fn(), requestPatients: vi.fn(), catalog: vi.fn() },
  healthApi: { all: vi.fn() }, authApi: { users: vi.fn(), roles: vi.fn() }, verificationApi: { verify: vi.fn() },
}));
vi.mock('../offline/indexedDb.js', () => ({ offlineDb: { getDraft: vi.fn().mockResolvedValue(null), listOutbox: vi.fn().mockResolvedValue([]) } }));

function open(role, path = '/dashboard', extra = {}) {
  return render(<AuthContext.Provider value={{ user: { id: 'test-user', email: 'test@lab.local', roles: Array.isArray(role) ? role : [role], ...extra }, loading: false }}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></AuthContext.Provider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  recordsApi.dashboard.mockResolvedValue({ metrics: { awaitingCollection: 4, awaitingApproval: 2 } });
  recordsApi.ownResults.mockResolvedValue({ items: [] });
  recordsApi.orders.mockResolvedValue({ items: [] });
  recordsApi.patients.mockResolvedValue({ items: [] });
  recordsApi.outbox.mockResolvedValue({ items: [] });
  recordsApi.visits.mockResolvedValue({ items: [] });
  recordsApi.consultations.mockResolvedValue({ items: [] });
  recordsApi.requestPatients.mockResolvedValue({ items: [], total: 0, limit: 20 });
  recordsApi.catalog.mockResolvedValue({ panels: [], tests: [], panelTests: [] });
  healthApi.all.mockResolvedValue([]);
  authApi.users.mockResolvedValue({ items: [], pagination: { total: 0 } });
  authApi.roles.mockResolvedValue({ items: [] });
});
afterEach(cleanup);

describe('dedicated role interfaces', () => {
  it('renders safely while restoring a session before the user is available', () => {
    render(<AuthContext.Provider value={{ user: null, loading: true }}><MemoryRouter><App /></MemoryRouter></AuthContext.Provider>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(recordsApi.dashboard).not.toHaveBeenCalled();
  });

  it.each([
    ['SYSTEM_ADMIN', 'Accounts', 'Accounts', 'Patients'],
    ['REGISTRATION_CASHIER', 'Patient management', 'Patients', 'Payments'],
    ['DOCTOR', 'Doctor workspace', 'Consultations', 'Payments'],
    ['LAB_STAFF', 'Laboratory bench', 'Result entry', 'Supervisor review'],
    ['LAB_SUPERVISOR', 'Supervisor workspace', 'Supervisor review', 'Result entry'],
    ['PATIENT', 'My released results', 'My laboratory records', 'Patients'],
    ['PUBLIC_VERIFIER', 'Record verification', 'Verify a report', 'Patients'],
  ])('%s opens its own workspace and navigation', async (role, title, visible, hidden) => {
    open(role);
    expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: visible })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: hidden })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Loading local records…')).not.toBeInTheDocument());
    if (role === 'PATIENT' || role === 'PUBLIC_VERIFIER') {
      expect(recordsApi.dashboard).not.toHaveBeenCalled();
      expect(healthApi.all).not.toHaveBeenCalled();
    }
    if (role === 'SYSTEM_ADMIN') expect(recordsApi.dashboard).not.toHaveBeenCalled();
  });

  it.each(['SYSTEM_ADMIN', 'PATIENT', 'PUBLIC_VERIFIER', 'LAB_STAFF'])('blocks a direct consultation URL for %s', async (role) => {
    open(role, '/consultations');
    expect(screen.queryByRole('button', { name: 'New consultation' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
  });

  it.each(['REGISTRATION_CASHIER', 'LAB_STAFF', 'LAB_SUPERVISOR'])('hides request creation from %s', async (role) => {
    open(role, '/orders');
    await screen.findByText('No laboratory requests');
    expect(screen.queryByRole('button', { name: 'Create request' })).not.toBeInTheDocument();
  });

  it('allows doctors to create requests', async () => {
    open('DOCTOR', '/orders');
    await screen.findByText('No laboratory requests');
    expect(screen.getByRole('button', { name: 'Create request' })).toBeInTheDocument();
  });

  it.each(['DOCTOR', 'LAB_STAFF', 'LAB_SUPERVISOR'])('hides patient registration from %s', async (role) => {
    open(role, '/patients');
    await screen.findByText('No patients found');
    expect(screen.queryByRole('button', { name: 'Register patient' })).not.toBeInTheDocument();
  });

  it('allows registration staff to register patients', async () => {
    open('REGISTRATION_CASHIER', '/patients');
    await screen.findByText('No patients found');
    expect(screen.getByRole('button', { name: 'Register patient' })).toBeInTheDocument();
  });

  it('lets a user with multiple assigned roles focus on one workspace at a time', async () => {
    open(['DOCTOR', 'LAB_STAFF']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Active workspace' }), { target: { value: 'LAB_STAFF' } });
    expect(await screen.findByRole('heading', { name: 'Laboratory bench' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation')).queryByText('Consultations')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Administration' })).not.toBeInTheDocument();
  });

  it('keeps the required password change before any workspace', () => {
    open('DOCTOR', '/dashboard', { mustChangePassword: true });
    expect(screen.getByRole('heading', { name: 'Choose a private password' })).toBeInTheDocument();
    expect(recordsApi.dashboard).not.toHaveBeenCalled();
  });

  it('loads only the browser sync queue for front-desk staff', async () => {
    open('REGISTRATION_CASHIER', '/sync');
    await screen.findByText('Browser queue is clear');
    expect(screen.queryByText('Durable outbox')).not.toBeInTheDocument();
    expect(recordsApi.outbox).not.toHaveBeenCalled();
  });

  it('accepts report links and tokens while rejecting unrelated links', () => {
    expect(verificationToken(' abc_123-test ')).toBe('abc_123-test');
    expect(verificationToken('http://localhost:5173/verify/abc_123-test')).toBe('abc_123-test');
    expect(() => verificationToken('https://example.com/login')).toThrow();
    expect(() => verificationToken('javascript:alert(1)')).toThrow();
  });
});
