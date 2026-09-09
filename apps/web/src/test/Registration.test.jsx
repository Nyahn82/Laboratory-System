import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PatientsPage } from '../pages/PatientsPage.jsx';
import { WorkflowQueuePage } from '../pages/WorkflowQueuePage.jsx';
import { recordsApi } from '../api/client.js';
import { offlineDb } from '../offline/indexedDb.js';

vi.mock('../auth/WorkspaceContext.jsx', () => ({ useWorkspace: () => ({ role: 'REGISTRATION_CASHIER' }) }));
vi.mock('../api/client.js', () => ({ recordsApi: { patients: vi.fn(), createPatient: vi.fn(), orders: vi.fn(), command: vi.fn() } }));
vi.mock('../offline/indexedDb.js', () => ({ offlineDb: { getDraft: vi.fn(), saveDraft: vi.fn(), deleteDraft: vi.fn(), queue: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  recordsApi.patients.mockResolvedValue({ items: [] });
  recordsApi.createPatient.mockResolvedValue({ patientId: 'patient-1', patientCode: 'PT-000001' });
  offlineDb.getDraft.mockResolvedValue(null);
  offlineDb.saveDraft.mockResolvedValue(undefined);
  offlineDb.deleteDraft.mockResolvedValue(undefined);
  offlineDb.queue.mockResolvedValue({ id: 'queued-1' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function sampleRegistration() {
  render(<MemoryRouter><PatientsPage /></MemoryRouter>);
  await screen.findByText('No patients found');
  fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use sample patient' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Register patient' }));
  return dialog;
}

describe('registration simulation', () => {
  it('registers without crypto.randomUUID', async () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    await sampleRegistration();
    await screen.findByText('Patient registered successfully.');
    expect(recordsApi.createPatient.mock.calls[0][1]).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('unlocks the form when request preparation fails', async () => {
    const random = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementationOnce(random).mockImplementationOnce(() => { throw new Error('Random source unavailable'); });
    await sampleRegistration();
    await screen.findByText('Random source unavailable');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Register patient' })).toBeEnabled();
    expect(recordsApi.createPatient).not.toHaveBeenCalled();
  });
  it('shows success without waiting for draft cleanup', async () => {
    offlineDb.deleteDraft.mockReturnValue(new Promise(() => {}));
    await sampleRegistration();
    await screen.findByText('Patient registered successfully.');
  });
  it('keeps the request key and unlocks the form after a timeout', async () => {
    recordsApi.createPatient.mockRejectedValueOnce({ status: 408, message: 'The request timed out. Please retry.' });
    const dialog=await sampleRegistration();
    await screen.findByText('The request timed out. Please retry.');
    const request=recordsApi.createPatient.mock.calls[0];
    expect(offlineDb.queue).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register patient' }));
    await screen.findByText('Patient registered successfully.');
    expect(recordsApi.createPatient.mock.calls[1]).toEqual(request);
  });

  it('submits sample identity details and refreshes the directory', async () => {
    await sampleRegistration();
    await screen.findByText('Patient registered successfully.');
    expect(recordsApi.createPatient).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Synthetic', lastName: expect.stringMatching(/^Patient-/), birthDate: '1995-04-12', email: null, reasonForVisit: 'General consultation', addressDetails: expect.objectContaining({ street: 'Sample Street', barangay: 'Sample Barangay', municipality: "M'lang" }) }), expect.any(String));
    expect(recordsApi.patients).toHaveBeenCalledTimes(2);
    expect(offlineDb.deleteDraft).toHaveBeenCalledWith('patient:current');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(offlineDb.queue).not.toHaveBeenCalled();
  });

  it('queues a lost response with the original key and clears the submitted form', async () => {
    recordsApi.createPatient.mockRejectedValue({ status: 0, message: 'Connection lost' });
    await sampleRegistration();
    await screen.findByText(/registration was queued for synchronization/i);
    const [body, key] = recordsApi.createPatient.mock.calls[0];
    expect(body.reasonForVisit).toBe('General consultation');
    expect(offlineDb.queue).toHaveBeenCalledWith('/api/records/patients', 'POST', body, key);
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(screen.getByLabelText('First name')).toHaveValue('');
  });

  it('retains the form and request key when offline persistence fails', async () => {
    recordsApi.createPatient.mockRejectedValueOnce({ status: 0 });
    offlineDb.queue.mockRejectedValueOnce(new Error('Storage unavailable'));
    const dialog = await sampleRegistration();
    await screen.findByText(/Registration could not be queued/);
    expect(screen.getByLabelText('Street / sitio / purok')).toHaveValue('Sample Street');
    const firstRequest = recordsApi.createPatient.mock.calls[0];
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register patient' }));
    await screen.findByText('Patient registered successfully.');
    expect(recordsApi.createPatient.mock.calls[1]).toEqual(firstRequest);
  });

  it('treats server validation errors as errors instead of queuing them', async () => {
    recordsApi.createPatient.mockRejectedValue({ status: 400, message: 'Invalid patient details' });
    await sampleRegistration();
    await screen.findByText('Invalid patient details');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(offlineDb.queue).not.toHaveBeenCalled();
  });

  it('does not report a failed registration if only draft cleanup fails', async () => {
    offlineDb.deleteDraft.mockRejectedValue(new Error('Storage unavailable'));
    await sampleRegistration();
    await screen.findByText('Patient registered successfully.');
    expect(offlineDb.queue).not.toHaveBeenCalled();
  });
});

describe('two-step patient registration', () => {
  it('validates identity before Next and preserves both steps without an early save', async () => {
    render(<MemoryRouter><PatientsPage /></MemoryRouter>);
    await screen.findByText('No patients found');
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Barangay')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Example' } });
    fireEvent.change(screen.getByLabelText('Reason for visit'), { target: { value: 'Follow-up visit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(recordsApi.createPatient).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Register patient' }));
    expect(recordsApi.createPatient).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Barangay'), { target: { value: 'Test Barangay' } });
    fireEvent.change(screen.getByLabelText('Street / sitio / purok'), { target: { value: 'Test Street' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('First name')).toHaveValue('Ana');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('Barangay')).toHaveValue('Test Barangay');
    expect(screen.getByLabelText('Street / sitio / purok')).toHaveValue('Test Street');
    for (const label of ['Municipality / city', 'Province', 'Region', 'Postal code', 'Country']) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Register patient' }));
    await screen.findByText('Patient registered successfully.');
    expect(recordsApi.createPatient).toHaveBeenCalledTimes(1);
    const saved = recordsApi.createPatient.mock.calls[0][0];
    expect(saved).toMatchObject({ middleName: '', suffix: '', contactNumber: '', email: null, addressDetails: { houseNumber: '' } });
    expect(recordsApi.createPatient).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Ana', addressDetails: expect.objectContaining({ barangay: 'Test Barangay', municipality: "M'lang" }) }), expect.any(String));
  });

  it('restores structured address drafts when registration is reopened', async () => {
    offlineDb.getDraft.mockResolvedValue({ payload: { firstName: 'Draft', lastName: 'Patient', reasonForVisit: 'Review symptoms', addressDetails: { barangay: 'Saved Barangay', municipality: 'Saved City', street: null } } });
    render(<MemoryRouter><PatientsPage /></MemoryRouter>);
    await screen.findByText('No patients found');
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(screen.getByLabelText('First name')).toHaveValue('Draft');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('Barangay')).toHaveValue('Saved Barangay');
    expect(screen.getByLabelText('Street / sitio / purok')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Street / sitio / purok'), { target: { value: 'Saved Street' } });
    expect(offlineDb.saveDraft).toHaveBeenLastCalledWith('patient', expect.objectContaining({ addressDetails: expect.objectContaining({ street: 'Saved Street' }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('Street / sitio / purok')).toHaveValue('Saved Street');
  });

  it('shows an older free-text draft while requiring the new street and barangay fields', async () => {
    offlineDb.getDraft.mockResolvedValue({ payload: { firstName: 'Legacy', lastName: 'Draft', reasonForVisit: 'Follow-up', address: 'Original address' } });
    render(<MemoryRouter><PatientsPage /></MemoryRouter>);
    await screen.findByText('No patients found');
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Previous address: Original address/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Register patient' }));
    expect(recordsApi.createPatient).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Street / sitio / purok'), { target: { value: 'Original Street' } });
    fireEvent.change(screen.getByLabelText('Barangay'), { target: { value: 'Original Barangay' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Register patient' }));
    await screen.findByText('Patient registered successfully.');
    expect(recordsApi.createPatient.mock.calls[0][0].address).toBeUndefined();
    expect(recordsApi.createPatient.mock.calls[0][0].addressDetails).toEqual({ houseNumber: '', street: 'Original Street', barangay: 'Original Barangay', municipality: "M'lang" });
  });
});

describe('payment-free specimen queue', () => {
  it('includes requested and legacy classified orders and excludes cancelled orders', async () => {
    recordsApi.orders.mockResolvedValue({ items: [
      { orderId: 'new', orderCode: 'NEW-REQUEST', status: 'REQUESTED' },
      { orderId: 'legacy', orderCode: 'LEGACY-REQUEST', status: 'PAYMENT_CLASSIFIED' },
      { orderId: 'cancelled', orderCode: 'CANCELLED-REQUEST', status: 'CANCELLED' },
    ] });
    render(<MemoryRouter><WorkflowQueuePage mode="specimen" /></MemoryRouter>);
    await screen.findByText('NEW-REQUEST');
    expect(screen.getByText('LEGACY-REQUEST')).toBeInTheDocument();
    expect(screen.queryByText('CANCELLED-REQUEST')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Record specimen event/ })).toHaveLength(2));
  });
});
