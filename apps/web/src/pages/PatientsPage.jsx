import { createRequestId } from '../utils/requestId.js';
import { useWorkspace } from '../auth/WorkspaceContext.jsx';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, MapPin, Plus, Search, UserRound, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { recordsApi } from '../api/client.js';
import { FormField, Card, EmptyState, ErrorState, LoadingState, Modal, Notice, PageHeader, StatusBadge } from '../components/Ui.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { offlineDb } from '../offline/indexedDb.js';

const addressFields = [
  ['houseNumber', 'House / unit / lot number', 60], ['street', 'Street / sitio / purok', 200],
  ['barangay', 'Barangay', 120], ['municipality', 'Municipality / city', 120],
  ['province', 'Province', 120], ['region', 'Region', 120],
  ['postalCode', 'Postal code', 20], ['country', 'Country', 80],
];
const registrationAddressFields = addressFields.slice(0, 3);
const municipality = "M'lang";
const emptyAddress = Object.fromEntries(registrationAddressFields.map(([key]) => [key, '']));
const emptyPatient = { firstName: '', middleName: '', lastName: '', suffix: '', birthDate: '', sex: 'Other', contactNumber: '', email: '', address: '', addressDetails: emptyAddress, reasonForVisit: '' };

export function PatientsPage() {
  const { role } = useWorkspace();
  const canRegister = role === 'REGISTRATION_CASHIER';
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [dialog, setDialog] = useState(false);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(emptyPatient);
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const pendingRegistration = useRef(null);
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 250); return () => clearTimeout(timer); }, [query]);
  const { loading, data, error, reload } = useAsync(() => recordsApi.patients(debounced), [debounced]);
  const patients = data?.items || data?.patients || (Array.isArray(data) ? data : []);

  useEffect(() => {
    if (!canRegister) return;
    offlineDb.getDraft('patient:current').then((draft) => draft?.payload && setForm({ ...emptyPatient, ...draft.payload, addressDetails: Object.fromEntries(registrationAddressFields.map(([key]) => [key, draft.payload.addressDetails?.[key] ?? ''])) })).catch(() => {});
  }, []);
  useEffect(() => {
    if (dialog) offlineDb.saveDraft('patient', form).catch(() => {});
  }, [form, dialog]);

  const submit = async (event) => {
    event.preventDefault();
    if (step === 1) { setStep(2); setMessage(null); return; }
    if (submitting) return;
    setSubmitting(true); setMessage(null);
    let payload;
    let key;
    try {
      const { address, addressDetails, ...identity } = form;
      payload = {
        ...identity,
        addressDetails: { ...addressDetails, municipality },
        birthDate: form.birthDate || null,
        email: form.email?.trim() || null,
      };
      const signature = JSON.stringify(payload);
      if (pendingRegistration.current?.signature !== signature) pendingRegistration.current = { signature, key: createRequestId() };
      key = pendingRegistration.current.key;
      await recordsApi.createPatient(payload, key);
      void offlineDb.deleteDraft('patient:current').catch(() => {});
      pendingRegistration.current = null;
      setForm(emptyPatient); setDialog(false); setMessage({ tone: 'success', text: 'Patient registered successfully.' });
      reload();
    } catch (caught) {
      if (payload && key && (!navigator.onLine || caught.status === 0)) {
        try {
          await offlineDb.queue('/api/records/patients', 'POST', payload, key);
        } catch {
          setMessage({ tone: 'danger', text: 'Registration could not be queued. Your form is still open; retry when the service is available.' });
          return;
        }
        void offlineDb.deleteDraft('patient:current').catch(() => {});
        pendingRegistration.current = null;
        setForm(emptyPatient); setDialog(false);
        setMessage({ tone: 'warning', text: 'The service could not be reached. Registration was queued for synchronization.' });
      } else setMessage({ tone: 'danger', text: caught.message || 'Registration failed. Please retry.' });
    } finally { setSubmitting(false); }
  };

  return <div>
    <PageHeader eyebrow={canRegister ? "Registration" : "Patient reference"} title={canRegister ? "Patient management" : "Patient directory"} description={canRegister ? "Register patients and maintain their identity details." : "Find patients and review the history available to your role."} actions={canRegister && <button className="button button--primary" onClick={() => { setStep(1); setMessage(null); setDialog(true); }}><Plus size={18} /> Register patient</button>} />
    {message && !dialog && <Notice tone={message.tone}>{message.text}</Notice>}
    <Card className="toolbar-card"><div className="search-box"><Search /><input aria-label="Search patients" placeholder="Search by patient code or name" value={query} onChange={(e) => setQuery(e.target.value)} /></div><StatusBadge status={`${patients.length} records`} /></Card>
    {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : patients.length === 0 ? <EmptyState title="No patients found" message={query ? 'Try a different code or spelling.' : canRegister ? 'Register the first synthetic patient to begin the workflow.' : 'Patients available to your role will appear here.'} /> : <div className="record-grid">{patients.map((patient) => <Link className="record-card" to={`/patients/${patient.id || patient.patientId}`} key={patient.id || patient.patientId}>
      <span className="record-card__icon"><UserRound /></span><div className="record-card__body"><div className="record-card__title"><strong>{[patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' ') || patient.fullName}</strong><StatusBadge status={patient.status || 'Active'} /></div><p>{patient.patientCode || patient.code}</p><span><CalendarDays size={15} /> {patient.birthDate ? new Date(patient.birthDate).toLocaleDateString() : 'Birth date not recorded'}</span><span><MapPin size={15} /> {patient.address || 'Address not recorded'}</span></div></Link>)}</div>}
    <Modal open={canRegister && dialog} title="Register a patient" onClose={() => !submitting && setDialog(false)}>
      <ol className="registration-steps" aria-label="Registration progress">
        <li aria-current={step === 1 ? 'step' : undefined}>1. Patient details</li>
        <li aria-current={step === 2 ? 'step' : undefined}>2. Address</li>
      </ol>
      <form className="form-grid" onSubmit={submit} key={step}>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {step === 1 ? <>
          <div className="modal-actions"><button type="button" className="button button--secondary" onClick={() => setForm({ ...emptyPatient, firstName: 'Synthetic', lastName: `Patient-${createRequestId().slice(0, 8)}`, birthDate: '1995-04-12', reasonForVisit: 'General consultation', addressDetails: { ...emptyAddress, houseNumber: '12', street: 'Sample Street', barangay: 'Sample Barangay' } })}>Use sample patient</button></div>
      <FormField label="First name"><input required maxLength="60" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></FormField>
      <FormField label="Middle name (optional)"><input maxLength="60" value={form.middleName} onChange={(e) => setForm({ ...form, middleName: e.target.value })} /></FormField>
      <FormField label="Last name"><input required maxLength="60" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></FormField>
      <FormField label="Suffix (optional)"><input maxLength="20" value={form.suffix} onChange={(e) => setForm({ ...form, suffix: e.target.value })} /></FormField>
      <FormField label="Birth date"><input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></FormField>
      <FormField label="Sex"><select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}><option>M</option><option>F</option><option>Other</option></select></FormField>
      <FormField label="Contact number (optional)"><input maxLength="30" value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} /></FormField>
      <FormField label="Email (optional)"><input type="email" maxLength="254" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
      <FormField label="Reason for visit"><textarea required maxLength="1000" rows="3" value={form.reasonForVisit || ''} onChange={(event) => setForm({ ...form, reasonForVisit: event.target.value })} /></FormField>
        </> : <>
          {form.address && <Notice>Previous address: {form.address}</Notice>}
          {registrationAddressFields.map(([key, label, maxLength], index) => <FormField key={key} label={key === 'houseNumber' ? `${label} (optional)` : label}><input required={key !== 'houseNumber'} autoFocus={index === 0} maxLength={maxLength} value={form.addressDetails[key]} disabled={submitting} onChange={(event) => setForm({ ...form, addressDetails: { ...form.addressDetails, [key]: event.target.value } })} /></FormField>)}
        </>}
        <div className="modal-actions">
          <button type="button" className="button button--ghost" disabled={submitting} onClick={() => setDialog(false)}>Cancel</button>
          {step === 2 && <button type="button" className="button button--secondary" disabled={submitting} onClick={() => { setStep(1); setMessage(null); }}>Back</button>}
          <button className="button button--primary" disabled={submitting}>{step === 1 ? 'Next' : submitting ? 'Registering...' : 'Register patient'}</button>
        </div>
      </form>
    </Modal>
  </div>;
}

export function PatientProfilePage() {
  const { id } = useParams();
  const { loading, data, error, reload } = useAsync(() => recordsApi.patient(id), [id]);
  const patient = data?.patient || data;
  const orders = data?.orders || patient?.orders || [];
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return <div><PageHeader eyebrow={patient.patientCode || 'Patient'} title={[patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' ') || patient.fullName} description="Identity details and authorized laboratory workflow history." />
    <section className="profile-grid"><Card><div className="card-heading"><h2>Patient details</h2><Users /></div><dl className="details-list"><div><dt>Patient code</dt><dd>{patient.patientCode}</dd></div><div><dt>Birth date</dt><dd>{patient.birthDate || '—'}</dd></div><div><dt>Sex</dt><dd>{patient.sex || '—'}</dd></div><div><dt>Contact</dt><dd>{patient.contactNumber || '—'}</dd></div>{patient.addressDetails ? addressFields.filter(([key]) => patient.addressDetails[key]).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{patient.addressDetails[key] || 'Not recorded'}</dd></div>) : <div><dt>Address</dt><dd>{patient.address || 'Not recorded'}</dd></div>}</dl></Card>
    <Card><div className="card-heading"><h2>Laboratory history</h2><StatusBadge status={`${orders.length} orders`} /></div>{orders.length ? <div className="table-wrap"><table><thead><tr><th>Order</th><th>Priority</th><th>Status</th><th>Date</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id || order.orderId}><td>{order.orderCode}</td><td>{order.priority}</td><td><StatusBadge status={order.status} /></td><td>{new Date(order.orderDate || order.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <EmptyState />}</Card></section>
  </div>;
}
