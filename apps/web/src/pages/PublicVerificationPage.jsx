import { useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Fingerprint, Home, Microscope, ShieldCheck } from 'lucide-react';
import { verificationApi } from '../api/client.js';
import { ErrorState, LoadingState, StatusBadge } from '../components/Ui.jsx';
import { useAsync } from '../hooks/useAsync.js';

export function PublicVerificationPage() {
  const { token } = useParams();
  const { loading, data, error, reload } = useAsync(() => verificationApi.verify(token), [token]);
  const record = data?.verification || data;
  if (loading) return <main className="public-verify"><LoadingState label="Checking the registered proof…" /></main>;
  if (error) return <main className="public-verify"><section className="verification-card verification-card--invalid"><span className="verification-icon"><AlertTriangle /></span><p className="eyebrow">Verification unsuccessful</p><h1>This token could not be verified</h1><ErrorState error={error} onRetry={reload} /><a href="/" className="button button--secondary"><Home size={17} /> Return to RHU LabChain</a></section></main>;
  return <main className="public-verify"><section className="verification-card"><header className="public-brand"><span className="brand__mark"><Microscope /></span><span><strong>RHU LabChain</strong><small>Public record verification</small></span></header><span className="verification-icon"><CheckCircle2 /></span><p className="eyebrow">Authenticity check</p><h1>Laboratory record verified</h1><p className="verification-lead">The opaque proof for this released record matches the registered encrypted package.</p><div className="verification-details"><div><span><Fingerprint /> Record reference</span><strong>{record.opaqueRecordId || record.recordId || 'Protected reference'}</strong></div><div><span><ShieldCheck /> Status</span><StatusBadge status={record.status || 'Valid'} /></div><div><span>Version</span><strong>{record.version}</strong></div><div><span>Issued by</span><strong>{record.issuingOrganization || record.issuer || 'RHU Laboratory'}</strong></div><div><span>Released</span><strong>{record.releasedAt ? new Date(record.releasedAt).toLocaleString() : 'Registered'}</strong></div><div><span>Ledger mode</span><strong>{record.ledger || record.adapter || 'Verified'}</strong></div></div><div className="privacy-box"><ShieldCheck /><p><strong>Privacy protected.</strong> This public page intentionally excludes patient identity, address, laboratory values, clinical notes, IPFS location, and access credentials.</p></div><a href="/" className="button button--secondary"><Home size={17} /> RHU LabChain home</a></section></main>;
}

