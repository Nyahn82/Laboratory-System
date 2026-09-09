import { useMemo, useState } from 'react';
import { Download, Eye, History, QrCode, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { recordsApi } from '../api/client.js';
import { LabReport } from '../components/LabReport.jsx';
import { Card, EmptyState, ErrorState, LoadingState, Modal, Notice, PageHeader, StatusBadge } from '../components/Ui.jsx';
import { useAsync } from '../hooks/useAsync.js';

export function PatientPortalPage({ history = false }) {
  const [selected, setSelected] = useState(null);
  const { loading, data, error, reload } = useAsync(recordsApi.ownResults, []);
  const results = data?.items || data?.results || (Array.isArray(data) ? data : []);
  return <div><PageHeader eyebrow="Patient portal" title={history ? 'My laboratory history' : 'My released results'} description="Only released records linked to your authenticated patient account appear here. Every access is audited." />
    <Notice tone="info"><ShieldCheck /> Your verification QR contains only a public URL and opaque token—never your name or result values.</Notice>
    {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : !results.length ? <EmptyState title="No released results" message="Results will appear after supervisor approval, encrypted storage, proof registration, and release." /> : <div className="portal-results">{results.map((report) => <Card key={report.id || report.reportId || report.recordId}><div className="card-heading"><div><p className="eyebrow">{report.reportCode || report.panelName}</p><h2>{report.panelName || 'Laboratory report'}</h2></div><StatusBadge status={report.status || 'Released'} /></div><dl className="details-list compact"><div><dt>Collected</dt><dd>{report.collectedAt ? new Date(report.collectedAt).toLocaleDateString() : '—'}</dd></div><div><dt>Released</dt><dd>{report.releasedAt ? new Date(report.releasedAt).toLocaleDateString() : '—'}</dd></div><div><dt>Version</dt><dd>{report.version || 1}</dd></div></dl><div className="button-row"><button className="button button--primary" onClick={() => setSelected(report)}><Eye size={17} /> View report</button>{report.downloadUrl && <a className="button button--secondary" href={report.downloadUrl}><Download size={17} /> Download</a>}</div></Card>)}</div>}
    <Modal open={Boolean(selected)} title="Released laboratory report" onClose={() => setSelected(null)}>{selected && <LabReport report={selected} />}</Modal>
  </div>;
}

export function QrPage() {
  const { loading, data, error, reload } = useAsync(recordsApi.ownResults, []);
  const results = data?.items || data?.results || (Array.isArray(data) ? data : []);
  const report = useMemo(() => results.find((item) => item.verificationUrl || item.verificationToken), [results]);
  const verificationUrl = report?.verificationUrl || (report?.verificationToken ? `${window.location.origin}/verify/${report.verificationToken}` : '');
  return <div><PageHeader eyebrow="Integrity proof" title="Verification QR" description="Share this QR to confirm authenticity without exposing protected health information." />
    {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : !report ? <EmptyState title="No verification token available" /> : <Card className="qr-card"><div className="qr-frame"><QRCodeSVG value={verificationUrl} size={220} level="M" marginSize={2} /></div><div><p className="eyebrow">Released record</p><h2>{report.reportCode || report.recordId}</h2><StatusBadge status={report.status || 'Released'} /><p className="muted">The QR opens a redacted public verification page. It does not contain your patient code, name, laboratory values, CID, or encryption details.</p><a className="button button--primary" href={verificationUrl}><QrCode size={17} /> Open verification page</a></div></Card>}
  </div>;
}

