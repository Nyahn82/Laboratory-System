import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from '../pages/ClinicalPages.jsx';
import { recordsApi } from '../api/client.js';
vi.mock('../auth/WorkspaceContext.jsx', () => ({ useWorkspace: () => ({ role: 'DOCTOR' }) }));
vi.mock('../api/client.js', () => ({ recordsApi: { orders: vi.fn(), requestPatients: vi.fn(), catalog: vi.fn(), createOrder: vi.fn(), createConsultation: vi.fn() } }));
const patient = { patientId: 'p-1', patientCode: 'PT-1', patientName: 'Ana Example', birthDate: '1990-01-01', address: "Poblacion, M'lang", consultationId: 'c-1', consultationDate: '2026-09-09T00:00:00Z' };
const catalog = { panels: [{ panelId: 'cbc', panelCode: 'CBC', panelName: 'Complete Blood Count' }], tests: [{ testId: 'hgb', testCode: 'HGB', testName: 'Hemoglobin' }, { testId: 'fbs', testCode: 'FBS', testName: 'Fasting Blood Sugar' }], panelTests: [{ panelId: 'cbc', testId: 'hgb' }] };
beforeEach(() => {
  vi.resetAllMocks();
  recordsApi.orders.mockResolvedValue({ items: [] });
  recordsApi.requestPatients.mockResolvedValue({ items: [patient], total: 1, limit: 20 });
  recordsApi.catalog.mockResolvedValue(catalog);
  recordsApi.createOrder.mockResolvedValue({ orderId: 'o-1' });
  recordsApi.createConsultation.mockResolvedValue({ consultationId: 'c-new', signedAt: '2026-09-09T01:00:00Z' });
});
afterEach(cleanup);
async function startRequest() {
  render(<OrdersPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Request tests' }));
  await screen.findByLabelText('Fasting Blood Sugar');
}
describe('patient-based laboratory requests', () => {
  it('selects tests by name and submits automatically linked IDs', async () => {
    await startRequest();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Patient')).toHaveValue('Ana Example - PT-1');
    expect(within(dialog).queryByLabelText(/Patient ID|Consultation ID|codes/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Complete Blood Count (CBC)'));
    expect(screen.getByLabelText('Hemoglobin (included)')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Fasting Blood Sugar'));
    fireEvent.change(screen.getByLabelText('Clinical reason'), { target: { value: 'Evaluation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign and create request' }));
    await screen.findByText('Signed laboratory request created.');
    expect(recordsApi.createOrder).toHaveBeenCalledWith({ patientId: 'p-1', consultationId: 'c-1', priority: 'Routine', clinicalReason: 'Evaluation', panelCodes: ['CBC'], testCodes: ['FBS'] }, expect.stringMatching(/^[a-f0-9-]{36}$/));
  });
  it('requires a test and retains the same request key on retry', async () => {
    await startRequest();
    fireEvent.change(screen.getByLabelText('Clinical reason'), { target: { value: 'Evaluation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign and create request' }));
    expect(await screen.findByText('Select at least one test.')).toBeInTheDocument();
    expect(recordsApi.createOrder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Fasting Blood Sugar'));
    recordsApi.createOrder.mockRejectedValueOnce(new Error('Request timed out.'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign and create request' }));
    await screen.findByText('Request timed out.');
    const first = recordsApi.createOrder.mock.calls[0];
    fireEvent.click(screen.getByRole('button', { name: 'Sign and create request' }));
    await screen.findByText('Signed laboratory request created.');
    expect(recordsApi.createOrder.mock.calls[1]).toEqual(first);
  });
  it('saves the waiting consultation before continuing to the request', async () => {
    recordsApi.requestPatients.mockResolvedValue({ items: [{ ...patient, consultationId: null, visitId: 'v-1', reasonForVisit: 'Follow-up' }], total: 1, limit: 20 });
    render(<OrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Consultation' }));
    expect(screen.getByLabelText('Reason for visit')).toHaveValue('Follow-up');
    expect(recordsApi.createOrder).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Clinical notes'), { target: { value: 'Reviewed.' } });
    fireEvent.change(screen.getByLabelText('Assessment'), { target: { value: 'Recorded.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save consultation' }));
    await screen.findByLabelText('Fasting Blood Sugar');
    expect(recordsApi.createConsultation).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'p-1', visitId: 'v-1' }), expect.any(String));
    fireEvent.click(screen.getByLabelText('Fasting Blood Sugar'));
    fireEvent.change(screen.getByLabelText('Clinical reason'), { target: { value: 'Evaluation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign and create request' }));
    await screen.findByText('Signed laboratory request created.');
    expect(recordsApi.createOrder).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'p-1', consultationId: 'c-new' }), expect.any(String));
  });
  it('searches across pages and discards stale search responses', async () => {
    recordsApi.requestPatients.mockResolvedValue({ items: [patient], total: 21, limit: 20 });
    render(<OrdersPage />);
    await screen.findByText('Ana Example');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(recordsApi.requestPatients).toHaveBeenCalledWith('', 2));
    let resolveOld;
    recordsApi.requestPatients.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    fireEvent.change(screen.getByLabelText('Search patients'), { target: { value: 'Old' } });
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    recordsApi.requestPatients.mockResolvedValueOnce({ items: [{ ...patient, patientName: 'New Patient' }], total: 1, limit: 20 });
    fireEvent.change(screen.getByLabelText('Search patients'), { target: { value: 'New' } });
    await screen.findByText('New Patient');
    await waitFor(() => expect(recordsApi.requestPatients).toHaveBeenLastCalledWith('New', 1));
    resolveOld({ items: [{ ...patient, patientName: 'Old Patient' }], total: 1, limit: 20 });
    await waitFor(() => expect(screen.queryByText('Old Patient')).not.toBeInTheDocument());
    expect(screen.getByText('New Patient')).toBeInTheDocument();
  });
});
