import { useState } from 'react';
import { ArrowRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../auth/WorkspaceContext.jsx';
import { recordsApi } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, ErrorState, FormField, LoadingState, Notice, PageHeader } from '../components/Ui.jsx';
import { HealthPage } from './OperationsPages.jsx';

export function DashboardPage() {
  const { role, workspace } = useWorkspace();
  if (role === 'SYSTEM_ADMIN') return <Navigate to="/accounts" replace />;
  if (role === 'REGISTRATION_CASHIER') return <Navigate to="/patients" replace />;
  if (role === 'PATIENT') return <Navigate to="/patient-portal" replace />;
  if (role === 'PUBLIC_VERIFIER') return <VerifierWorkspace />;
  return <div>
    <PageHeader title={workspace.title} description={workspace.description} />
    <section className="workspace-tasks" aria-label="Your tasks">{workspace.tasks.map(([path, title, description], index) => <Link className="card workspace-task" key={path} to={path}>
      <span className="workspace-task__number">{String(index + 1).padStart(2, '0')}</span><h2>{title}</h2><p>{description}</p><span className="workspace-task__open">Open task <ArrowRight size={17} aria-hidden="true" /></span>
    </Link>)}</section>
    {role === 'SYSTEM_ADMIN' ? <HealthPage embedded /> : <WorkSummary key={role} workspace={workspace} />}
  </div>;
}

function WorkSummary({ workspace }) {
  const { loading, data, error, reload } = useAsync(recordsApi.dashboard, []);
  return <section aria-label="Your workload"><div className="card-heading"><h2>Your workload</h2><button className="button button--secondary" onClick={reload}><RefreshCw size={17} /> Refresh</button></div>
    {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : <div className="metric-grid">{workspace.metrics.map(([key, label, path]) => <Link className="metric-card" key={key} to={path}><span><strong>{data?.metrics?.[key] ?? data?.[key] ?? 0}</strong><small>{label}</small></span><ArrowRight aria-hidden="true" /></Link>)}</div>}
  </section>;
}

export function verificationToken(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Enter a verification link or token.');
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
    let url;
    try { url = new URL(trimmed, window.location.origin); } catch { throw new Error('Enter a valid verification link.'); }
    const match = url.pathname.match(/^\/verify\/([^/]+)\/?$/);
    if (!match) throw new Error('The verification link must contain /verify/ followed by a token.');
    try { return decodeURIComponent(match[1]); } catch { throw new Error('The verification token is malformed.'); }
  }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) throw new Error('Enter the complete verification link or token printed with the report.');
  return trimmed;
}

function VerifierWorkspace() {
  const { workspace } = useWorkspace();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const verify = (event) => {
    event.preventDefault();
    try { navigate(`/verify/${encodeURIComponent(verificationToken(value))}`); } catch (caught) { setError(caught.message); }
  };
  return <div><PageHeader eyebrow="Public verifier" title={workspace.title} description={workspace.description} />
    <Card className="verifier-form"><ShieldCheck size={36} aria-hidden="true" /><h2>Verify a report</h2><p className="muted">Paste the link from the report's QR code, or enter its verification token.</p>
      <form onSubmit={verify}>{error && <Notice tone="danger">{error}</Notice>}<FormField label="Verification link or token"><input required value={value} onChange={(event) => { setValue(event.target.value); setError(''); }} placeholder="http://localhost:5173/verify/..." /></FormField><button className="button button--primary">Check authenticity <ArrowRight size={17} /></button></form>
      <p className="muted">The check displays authenticity and release information. Patient details and test values remain private.</p>
    </Card>
  </div>;
}
