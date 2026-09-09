import { useRef, useState } from 'react';
import { ClipboardPlus, Plus, Search, Stethoscope } from 'lucide-react';
import { createRequestId } from '../utils/requestId.js';
import { useWorkspace } from '../auth/WorkspaceContext.jsx';
import { recordsApi } from '../api/client.js';
import { Card, EmptyState, ErrorState, FormField, LoadingState, Modal, Notice, PageHeader, StatusBadge } from '../components/Ui.jsx';
import { useAsync } from '../hooks/useAsync.js';

function PatientDirectory({ onSelect, forRequest = false, revision = 0 }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { loading, data, error, reload } = useAsync(() => recordsApi.requestPatients(query, page), [query, page, revision]);
  const patients = data?.items || [];
  return <section aria-label="Patients">
    <Card className="toolbar-card"><h2>Patients</h2><div className="search-box"><Search size={18} /><input aria-label="Search patients" placeholder="Search patients" maxLength="120" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></div><button type="button" className="button button--secondary" onClick={reload}>Refresh</button></Card>
    {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : !patients.length ? <EmptyState title="No patients found" message="" /> : <div className="table-wrap card"><table><thead><tr><th>Patient</th><th>Date of birth</th><th>Address</th><th></th></tr></thead><tbody>{patients.map(patient => <tr key={patient.patientId}>
      <td><strong>{patient.patientName}</strong><br /><small>{patient.patientCode}</small></td><td>{patient.birthDate || '-'}</td><td>{patient.address || '-'}</td>
      <td><button type="button" className="button button--primary" onClick={() => onSelect(patient)}>{forRequest ? (patient.consultationId ? 'Request tests' : 'Consultation') : 'Select'}</button></td>
    </tr>)}</tbody></table></div>}
    <div className="pagination"><span>{data?.total ?? 0} patients</span><div className="page-actions"><button type="button" className="button button--secondary" disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button type="button" className="button button--secondary" disabled={loading || !data || page * data.limit >= data.total} onClick={() => setPage(page + 1)}>Next</button></div></div>
  </section>;
}

function ConsultationEditor({ patient, onSaved, onCancel, onBusyChange }) {
  const [form, setForm] = useState({ patientId: patient.patientId, visitId: patient.visitId || '', chiefComplaint: patient.reasonForVisit || patient.chiefComplaint || '', clinicalNotes: '', assessment: '', plan: '' });
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(null);
  const busy = useRef(false);
  const submit = async event => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true; setSubmitting(true); onBusyChange(true); setMessage(null);
    try {
      const signature = JSON.stringify(form);
      if (pending.current?.signature !== signature) pending.current = { signature, key: createRequestId() };
      const consultation = await recordsApi.createConsultation(form, pending.current.key);
      pending.current = null; onSaved(consultation);
    } catch (caught) { setMessage(caught.message); }
    finally { busy.current = false; setSubmitting(false); onBusyChange(false); }
  };
  return <form className="form-grid" onSubmit={submit}>
    {message && <Notice tone="danger">{message}</Notice>}
    <FormField label="Patient"><input readOnly value={patient.patientName || patient.patientCode} /></FormField>
    <FormField label="Reason for visit"><textarea required maxLength="1000" readOnly={Boolean(patient.visitId)} rows="3" value={form.chiefComplaint} onChange={event => setForm({ ...form, chiefComplaint: event.target.value })} /></FormField>
    <FormField label="Clinical notes"><textarea required maxLength="5000" rows="4" value={form.clinicalNotes} onChange={event => setForm({ ...form, clinicalNotes: event.target.value })} /></FormField>
    <FormField label="Assessment"><textarea required maxLength="2000" rows="2" value={form.assessment} onChange={event => setForm({ ...form, assessment: event.target.value })} /></FormField>
    <FormField label="Plan"><textarea maxLength="2000" rows="2" value={form.plan} onChange={event => setForm({ ...form, plan: event.target.value })} /></FormField>
    <div className="modal-actions"><button type="button" className="button button--ghost" disabled={submitting} onClick={onCancel}>Cancel</button><button className="button button--primary" disabled={submitting}>{submitting ? 'Saving...' : 'Save consultation'}</button></div>
  </form>;
}

export function ConsultationPage() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [message, setMessage] = useState(null);
  const { loading, data, error, reload } = useAsync(recordsApi.consultations, []);
  const queue = useAsync(() => recordsApi.visits('OPEN'), []);
  const visits = queue.data?.items || [];
  const consultations = data?.items || data?.consultations || (Array.isArray(data) ? data : []);
  const openConsultation = (patient = null) => { setSelectedPatient(patient); setMessage(null); setOpen(true); };
  return <div>
    <PageHeader eyebrow="Doctor portal" title="Consultations" description="Review visits and record the consultation." actions={<><button className="button button--secondary" onClick={() => { reload(); queue.reload(); }}>Refresh</button><button className="button button--primary" onClick={() => openConsultation()}><Plus size={18} /> New consultation</button></>} />
    {message && <Notice tone="success">{message}</Notice>}
    <section aria-label="Waiting for consultation">
      <div className="card-heading"><h2>Waiting for consultation</h2><StatusBadge status={visits.length} /></div>
      {queue.loading ? <LoadingState /> : queue.error ? <ErrorState error={queue.error} onRetry={queue.reload} /> : !visits.length ? <EmptyState title="No waiting patients" /> : <div className="record-grid">{visits.map(visit => <Card key={visit.visitId}>
        <div className="card-heading"><h3>{visit.patientName || visit.patientCode}</h3><StatusBadge status="Waiting" /></div>
        <p>{visit.patientCode}</p><dl className="details-list"><div><dt>Reason for visit</dt><dd>{visit.reasonForVisit || visit.chiefComplaint || 'Not recorded'}</dd></div></dl>
        <button className="button button--primary" onClick={() => openConsultation(visit)}>Review</button>
      </Card>)}</div>}
    </section>
    <section aria-label="Your consultations"><div className="card-heading"><h2>Your consultations</h2></div>
      {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : !consultations.length ? <EmptyState title="No consultations" /> : <div className="record-grid">{consultations.map(item => <Card key={item.id || item.consultationId}><div className="card-heading"><span className="record-card__icon"><Stethoscope /></span><StatusBadge status={item.status || 'Active'} /></div><h3>{item.patientName || item.patientId}</h3><p>{item.chiefComplaint || item.clinicalNotes}</p><small>{new Date(item.createdAt).toLocaleString()}</small></Card>)}</div>}
    </section>
    <Modal open={open} title="Consultation" onClose={() => !busy && setOpen(false)}>{selectedPatient ? <ConsultationEditor onBusyChange={setBusy} key={selectedPatient.patientId} patient={selectedPatient} onCancel={() => setOpen(false)} onSaved={() => { setOpen(false); setMessage('Consultation saved.'); reload(); queue.reload(); }} /> : <PatientDirectory onSelect={setSelectedPatient} />}</Modal>
  </div>;
}

function RequestEditor({ patient, onSaved, onCancel, onBusyChange }) {
  const [form, setForm] = useState({ priority: 'Routine', clinicalReason: '', panelCodes: [], testCodes: [] });
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const catalog = useAsync(recordsApi.catalog, []);
  const pending = useRef(null);
  const busy = useRef(false);
  const toggle = (field, code) => setForm(current => ({ ...current, [field]: current[field].includes(code) ? current[field].filter(value => value !== code) : [...current[field], code] }));
  const selectedPanels = (catalog.data?.panels || []).filter(panel => form.panelCodes.includes(panel.panelCode));
  const includedTests = new Set((catalog.data?.panelTests || []).filter(link => selectedPanels.some(panel => panel.panelId === link.panelId)).map(link => link.testId));
  const panelTests = new Set((catalog.data?.panelTests || []).map(link => link.testId));
  const testOption = test => <label className="checkbox-row" key={test.testId}><input type="checkbox" disabled={includedTests.has(test.testId)} checked={includedTests.has(test.testId) || form.testCodes.includes(test.testCode)} onChange={() => toggle('testCodes', test.testCode)} />{test.testName}{includedTests.has(test.testId) ? ' (included)' : ''}</label>;
  const submit = async event => {
    event.preventDefault();
    if (busy.current) return;
    if (!form.panelCodes.length && !form.testCodes.length) { setMessage('Select at least one test.'); return; }
    busy.current = true; setSubmitting(true); onBusyChange(true); setMessage(null);
    try {
      const body = { ...form, patientId: patient.patientId, consultationId: patient.consultationId };
      const signature = JSON.stringify(body);
      if (pending.current?.signature !== signature) pending.current = { signature, key: createRequestId() };
      await recordsApi.createOrder(body, pending.current.key);
      pending.current = null; onSaved();
    } catch (caught) { setMessage(caught.message); }
    finally { busy.current = false; setSubmitting(false); onBusyChange(false); }
  };
  return <form className="form-grid" onSubmit={submit}>
    {message && <Notice tone="danger">{message}</Notice>}
    <FormField label="Patient"><input readOnly value={`${patient.patientName} - ${patient.patientCode}`} /></FormField>
    <FormField label="Consultation"><input readOnly value={new Date(patient.consultationDate).toLocaleString()} /></FormField>
    <FormField label="Priority"><select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}><option>Routine</option><option>Urgent</option><option>STAT</option></select></FormField>
    <fieldset className="test-options"><legend>Tests</legend>{catalog.loading ? <LoadingState /> : catalog.error ? <ErrorState error={catalog.error} onRetry={catalog.reload} /> : <>
      {(catalog.data?.panels || []).map(panel => <label className="checkbox-row" key={panel.panelId}><input type="checkbox" checked={form.panelCodes.includes(panel.panelCode)} onChange={() => toggle('panelCodes', panel.panelCode)} />{panel.panelName} ({panel.panelCode})</label>)}
      {(catalog.data?.tests || []).filter(test => !panelTests.has(test.testId)).map(testOption)}
      <details><summary>Individual panel tests</summary><div className="individual-tests">{(catalog.data?.tests || []).filter(test => panelTests.has(test.testId)).map(testOption)}</div></details>
    </>}</fieldset>
    <FormField label="Clinical reason"><textarea required maxLength="5000" rows="3" value={form.clinicalReason} onChange={event => setForm({ ...form, clinicalReason: event.target.value })} /></FormField>
    <div className="modal-actions"><button type="button" className="button button--ghost" disabled={submitting} onClick={onCancel}>Cancel</button><button className="button button--primary" disabled={submitting || catalog.loading || Boolean(catalog.error)}>{submitting ? 'Creating...' : 'Sign and create request'}</button></div>
  </form>;
}

export function OrdersPage() {
  const { role } = useWorkspace();
  const canCreate = role === 'DOCTOR';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [patient, setPatient] = useState(null);
  const [message, setMessage] = useState(null);
  const [revision, setRevision] = useState(0);
  const { loading, data, error, reload } = useAsync(() => recordsApi.orders(), []);
  const orders = data?.items || data?.orders || (Array.isArray(data) ? data : []);
  const selectPatient = selected => { setPatient(selected); setMessage(null); setOpen(true); };
  return <div><PageHeader eyebrow="Doctor requests" title="Laboratory requests" actions={canCreate && <button className="button button--primary" onClick={() => selectPatient(null)}><ClipboardPlus size={18} /> Create request</button>} />
    {message && <Notice tone="success">{message}</Notice>}
    {canCreate && <PatientDirectory forRequest onSelect={selectPatient} revision={revision} />}
    <section aria-label="Requests"><div className="card-heading"><h2>Requests</h2><button className="button button--secondary" onClick={reload}>Refresh</button></div>
      {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : !orders.length ? <EmptyState title="No laboratory requests" /> : <div className="table-wrap card"><table><thead><tr><th>Request</th><th>Patient</th><th>Priority</th><th>Tests</th><th>Status</th><th>Ordered</th></tr></thead><tbody>{orders.map(order => <tr key={order.id || order.orderId}><td><strong>{order.orderCode}</strong></td><td>{order.patientName || '-'}</td><td>{order.priority}</td><td>{[...(order.panelCodes || []), ...(order.testNames || [])].join(', ') || '-'}</td><td><StatusBadge status={order.status} /></td><td>{new Date(order.orderDate || order.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div>}
    </section>
    <Modal open={canCreate && open} title={patient && !patient.consultationId ? 'Consultation' : 'Create laboratory request'} onClose={() => !busy && setOpen(false)}>
      {!patient ? <PatientDirectory forRequest onSelect={setPatient} /> : !patient.consultationId ? <ConsultationEditor onBusyChange={setBusy} key={patient.patientId} patient={patient} onCancel={() => setOpen(false)} onSaved={consultation => { setPatient({ ...patient, consultationId: consultation.consultationId, consultationDate: consultation.signedAt }); setRevision(value => value + 1); }} /> : <RequestEditor onBusyChange={setBusy} key={patient.consultationId} patient={patient} onCancel={() => setOpen(false)} onSaved={() => { setOpen(false); setMessage('Signed laboratory request created.'); reload(); setRevision(value => value + 1); }} />}
    </Modal>
  </div>;
}
