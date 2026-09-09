import { useMemo, useState } from 'react';
import { ArrowRight, Beaker, CheckCircle2, ClipboardCheck, RefreshCw, Send, TestTubes } from 'lucide-react';
import { recordsApi } from '../api/client.js';
import { Card, EmptyState, ErrorState, FormField, LoadingState, Modal, Notice, PageHeader, StatusBadge } from '../components/Ui.jsx';
import { useAsync } from '../hooks/useAsync.js';

const modes = {
  specimen: { eyebrow: 'Pre-analytical phase', title: 'Specimen accession & collection', description: 'Maintain a unique accession, barcode, specimen type, collector, and event history.', action: 'Record specimen event', icon: TestTubes },
  testing: { eyebrow: 'Analytical phase', title: 'Testing & result entry', description: 'Enter measured values, units, and the reference range used for this immutable version.', action: 'Enter result', icon: Beaker },
  qc: { eyebrow: 'Analytical controls', title: 'Quality control', description: 'A passing QC decision is required before submission. Failures require repeat or referral.', action: 'Record QC', icon: CheckCircle2 },
  repeat: { eyebrow: 'Exception workflow', title: 'Repeat testing & referral', description: 'Resolve QC failures explicitly; unresolved work blocks submission.', action: 'Create resolution', icon: RefreshCw },
  submission: { eyebrow: 'Laboratory handoff', title: 'Result submission', description: 'Submit only when every required test has passing QC or an incorporated referral result.', action: 'Submit result', icon: Send },
  approval: { eyebrow: 'Supervisor portal', title: 'Supervisor review', description: 'Review submitted results. Approval freezes the version and starts encrypted publication.', action: 'Review result', icon: ClipboardCheck },
  release: { eyebrow: 'Controlled release', title: 'Result release', description: 'Release only after encrypted storage and proof registration have completed.', action: 'Release result', icon: Send },
  'doctor-review': { eyebrow: 'Doctor portal', title: 'Released result review', description: 'Append acknowledgment, interpretation, and follow-up without modifying the laboratory proof.', action: 'Add review', icon: ClipboardCheck },
};

function normalizeOrders(data) { return data?.items || data?.orders || (Array.isArray(data) ? data : []); }

function initialForm(mode) {
  const common = { remarks: '' };
  if (mode === 'specimen') return { ...common, sampleType: 'Whole Blood', specimenCode: '', collectedAt: new Date().toISOString().slice(0, 16) };
  if (mode === 'testing') return { ...common, testCode: 'HGB', testName: 'Hemoglobin', resultValue: '', numericValue: '', unit: 'g/dL', referenceRange: '13 - 17' };
  if (mode === 'qc') return { ...common, passed: true, controlLot: '', controlValue: '' };
  if (mode === 'repeat') return { ...common, resolution: 'repeat', reason: '', referralLaboratory: '', sentAt: new Date().toISOString().slice(0, 16) };
  if (mode === 'approval') return { ...common, decision: 'approve' };
  if (mode === 'doctor-review') return { ...common, acknowledgment: true, interpretation: '', followUpPlan: '' };
  return common;
}

function commandFor(mode, order, form) {
  if (mode === 'specimen') return /ACCESSIONED/i.test(order.status) ? 'collection' : 'accession';
  if (mode === 'repeat') return form.resolution === 'referral' ? 'referrals' : 'repeat-tests';
  return { testing: 'results', qc: 'qc', submission: 'submit', approval: 'approval', release: 'release', 'doctor-review': 'doctor-review' }[mode];
}

export function WorkflowQueuePage({ mode }) {
  const config = modes[mode];
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(initialForm(mode));
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { loading, data, error, reload } = useAsync(() => recordsApi.orders(), [mode]);
  const orders = normalizeOrders(data);
  const Icon = config.icon;
  const candidates = useMemo(() => orders.filter((order) => {
    const s = String(order.status || '').toUpperCase();
    if (mode === 'specimen') return ['REQUESTED', 'PAYMENT_CLASSIFIED', 'ACCESSIONED', 'RECOLLECTION_REQUIRED'].includes(s);
    if (mode === 'testing') return /COLLECTED|IN_TESTING|PROCESSING/.test(s);
    if (mode === 'qc') return s === 'IN_TESTING' && /QC_PENDING|DRAFT/.test(String(order.resultStatus || ''));
    if (mode === 'repeat') return /QC_FAILED|REPEAT_REQUIRED|REFERRED/.test(String(order.resultStatus || ''));
    if (mode === 'submission') return s === 'IN_TESTING' && order.resultStatus === 'QC_PASSED';
    if (mode === 'approval') return /FOR_VERIFICATION|SUBMITTED/.test(s);
    if (mode === 'release') return /LEDGER_REGISTERED|REGISTERED|APPROVED|STORED/.test(s);
    if (mode === 'doctor-review') return /RELEASED/.test(s);
    return true;
  }), [orders, mode]);

  const open = (order) => { setSelected(order); setForm(initialForm(mode)); setNotice(null); };
  const submit = async (event) => {
    event.preventDefault(); setSubmitting(true); setNotice(null);
    try {
      const body = { ...form };
      if (body.numericValue !== undefined && body.numericValue !== '') body.numericValue = Number(body.numericValue);
      else delete body.numericValue;
      if (body.collectedAt) body.collectedAt = new Date(body.collectedAt).toISOString();
      if (body.sentAt) body.sentAt = new Date(body.sentAt).toISOString();
      await recordsApi.command(selected.id || selected.orderId, commandFor(mode, selected, form), body, crypto.randomUUID());
      setSelected(null); setNotice({ tone: 'success', text: `${config.action} recorded with an audit event.` }); reload();
    } catch (caught) { setNotice({ tone: 'danger', text: caught.message }); }
    finally { setSubmitting(false); }
  };

  return <div><PageHeader eyebrow={config.eyebrow} title={config.title} description={config.description} actions={<button className="button button--secondary" onClick={reload}><RefreshCw size={17} /> Refresh</button>} />
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : !candidates.length ? <EmptyState title="Queue is clear" message="No records currently meet the validated entry conditions for this screen." /> : <div className="queue-list">{candidates.map((order) => <Card className="queue-card" key={order.id || order.orderId}><span className="queue-card__icon"><Icon /></span><div className="queue-card__content"><div><strong>{order.orderCode || order.id}</strong><StatusBadge status={order.status} /></div><h3>{order.patientName || order.patientCode || `Patient ${order.patientId}`}</h3><p>{order.clinicalReason || order.clinicalNotes || 'No clinical reason displayed.'}</p><small>{order.priority || 'Routine'} · {new Date(order.updatedAt || order.createdAt || Date.now()).toLocaleString()}</small></div><button className="button button--primary" onClick={() => open(order)}>{config.action} <ArrowRight size={17} /></button></Card>)}</div>}
    <Modal open={Boolean(selected)} title={`${config.action}: ${selected?.orderCode || ''}`} onClose={() => setSelected(null)}><form className="form-grid" onSubmit={submit}><ModeFields mode={mode} form={form} setForm={setForm} order={selected} />
      <FormField label="Remarks"><textarea rows="3" value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></FormField>
      <div className="modal-actions"><button type="button" className="button button--ghost" onClick={() => setSelected(null)}>Cancel</button><button className="button button--primary" disabled={submitting}>{submitting ? 'Saving…' : config.action}</button></div></form></Modal>
  </div>;
}

function ModeFields({ mode, form, setForm, order }) {
  if (mode === 'specimen') return <><Notice tone="info">Current state: <StatusBadge status={order.status} />. The service will reject a collection that has not been accessioned.</Notice><FormField label="Specimen / barcode code"><input value={form.specimenCode} onChange={(e) => setForm({ ...form, specimenCode: e.target.value })} placeholder="Generated when left blank" /></FormField><FormField label="Sample type"><input required value={form.sampleType} onChange={(e) => setForm({ ...form, sampleType: e.target.value })} /></FormField><FormField label="Collection time"><input type="datetime-local" required value={form.collectedAt} onChange={(e) => setForm({ ...form, collectedAt: e.target.value })} /></FormField></>;
  if (mode === 'testing') return <><FormField label="Test code"><input required value={form.testCode} onChange={(e) => setForm({ ...form, testCode: e.target.value })} /></FormField><FormField label="Test name"><input required value={form.testName} onChange={(e) => setForm({ ...form, testName: e.target.value })} /></FormField><FormField label="Result"><input required value={form.resultValue} onChange={(e) => setForm({ ...form, resultValue: e.target.value })} /></FormField><FormField label="Numeric value"><input type="number" step="any" value={form.numericValue} onChange={(e) => setForm({ ...form, numericValue: e.target.value })} /></FormField><FormField label="Unit"><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></FormField><FormField label="Applied reference range"><input required value={form.referenceRange} onChange={(e) => setForm({ ...form, referenceRange: e.target.value })} /></FormField></>;
  if (mode === 'qc') return <><FormField label="QC outcome"><select value={String(form.passed)} onChange={(e) => setForm({ ...form, passed: e.target.value === 'true' })}><option value="true">Passed</option><option value="false">Failed</option></select></FormField><FormField label="Control lot"><input required value={form.controlLot} onChange={(e) => setForm({ ...form, controlLot: e.target.value })} /></FormField><FormField label="Observed control value"><input required value={form.controlValue} onChange={(e) => setForm({ ...form, controlValue: e.target.value })} /></FormField></>;
  if (mode === 'repeat') return <><FormField label="Resolution"><select value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}><option value="repeat">Repeat test</option><option value="referral">External referral</option></select></FormField><FormField label="Reason"><textarea required rows="3" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></FormField>{form.resolution === 'referral' && <><FormField label="Referral laboratory"><input required value={form.referralLaboratory} onChange={(e) => setForm({ ...form, referralLaboratory: e.target.value })} /></FormField><FormField label="Sent at"><input required type="datetime-local" value={form.sentAt} onChange={(e) => setForm({ ...form, sentAt: e.target.value })} /></FormField></>}</>;
  if (mode === 'submission') return <Notice tone="warning">Submission freezes the current draft for supervisor verification. The service will reject missing results, failed QC, or unresolved repeats/referrals.</Notice>;
  if (mode === 'approval') return <><Notice tone="warning">Approval freezes this result version and begins encrypted publication. Rejection creates a correction path; it never overwrites this version.</Notice><FormField label="Decision"><select value={form.decision} onChange={(e) => setForm({ ...form, decision: e.target.value })}><option value="approve">Approve</option><option value="reject">Reject</option></select></FormField></>;
  if (mode === 'release') return <Notice tone="warning">Release is blocked until storage and ledger receipts match this exact version and ciphertext hash.</Notice>;
  if (mode === 'doctor-review') return <><FormField label="Interpretation / acknowledgment"><textarea required rows="4" value={form.interpretation} onChange={(e) => setForm({ ...form, interpretation: e.target.value })} /></FormField><FormField label="Follow-up plan"><textarea rows="3" value={form.followUpPlan} onChange={(e) => setForm({ ...form, followUpPlan: e.target.value })} /></FormField></>;
  return null;
}
