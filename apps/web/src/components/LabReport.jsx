import { QrCode } from 'lucide-react';
import { StatusBadge } from './Ui.jsx';

export function LabReport({ report, compact = false }) {
  const patient = report.patient || {};
  const items = report.items || report.results || [];
  return <article className={`lab-report ${compact ? 'lab-report--compact' : ''}`}>
    <header className="lab-report__header"><div className="report-brand"><span className="brand__mark"><QrCode /></span><div><strong>RHU LabChain Laboratory</strong><small>Synthetic Phase One report</small></div></div><div className="report-meta"><span>{report.reportCode || report.recordId}</span><StatusBadge status={report.status || 'Released'} /></div></header>
    <section className="report-patient"><div><small>Patient</small><strong>{patient.fullName || report.patientName || 'Authorized patient'}</strong></div><div><small>Patient code</small><strong>{patient.patientCode || report.patientCode || 'Protected'}</strong></div><div><small>Collected</small><strong>{report.collectedAt ? new Date(report.collectedAt).toLocaleString() : '—'}</strong></div><div><small>Released</small><strong>{report.releasedAt ? new Date(report.releasedAt).toLocaleString() : '—'}</strong></div></section>
    <div className="table-wrap"><table className="result-table"><thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference</th><th>Flag</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.id || item.resultItemId || index}><td>{item.testName || item.testNameSnapshot}</td><td><strong>{item.resultValue}</strong></td><td>{item.unit || item.unitSnapshot}</td><td>{item.referenceRange || item.referenceRangeSnapshot?.printable || '—'}</td><td><StatusBadge status={item.flag || 'Normal'} /></td></tr>)}</tbody></table></div>
    {!compact && <footer className="lab-report__footer"><p><strong>Integrity notice.</strong> This released version is encrypted before storage and registered using an opaque proof. Clinical interpretation remains the authorized doctor’s responsibility.</p><div className="report-signatures"><span><strong>{report.reportedByName || 'Medical Technologist'}</strong><small>Reported by</small></span><span><strong>{report.approvedByName || 'Laboratory Supervisor'}</strong><small>Verified by</small></span></div></footer>}
  </article>;
}
