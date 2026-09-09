import { Link } from 'react-router-dom';
import { Pagination } from './AdminPages.jsx';
import { useWorkspace } from '../auth/WorkspaceContext.jsx';
import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CloudCog, DatabaseBackup, RefreshCw, RotateCcw, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { authApi, healthApi, recordsApi } from '../api/client.js';
import { Card, EmptyState, ErrorState, FormField, LoadingState, Modal, Notice, PageHeader, StatusBadge } from '../components/Ui.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { offlineDb } from '../offline/indexedDb.js';

export function UsersPage() {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', password: '', roleCode: 'REGISTRATION_CASHIER', mustChangePassword: true });
  const { loading, data, error, reload } = useAsync(async () => ({ users: await authApi.users(offset), roles: await authApi.roles() }), [offset]);
  const users = data?.users?.items || data?.users?.users || (Array.isArray(data?.users) ? data.users : []);
  const roles = data?.roles?.items || (Array.isArray(data?.roles) ? data.roles : []);
  const create = async (event) => {
    event.preventDefault(); setSaving(true); setNotice(null);
    try {
      await authApi.createUser({ ...form, roleCodes: [form.roleCode], status: 'ACTIVE' });
      setOpen(false); setForm({ email: '', firstName: '', lastName: '', password: '', roleCode: 'REGISTRATION_CASHIER', mustChangePassword: true });
      setNotice({ tone: 'success', text: 'Account created.' }); reload();
    } catch (caught) { setNotice({ tone: 'danger', text: caught.message }); }
    finally { setSaving(false); }
  };
  const toggleStatus = async (user) => {
    const next = (user.status || user.accountStatus) === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    if (!window.confirm(`${next === 'ACTIVE' ? 'Activate' : 'Deactivate'} ${user.email}?`)) return;
    try { await authApi.setUserStatus(user.id || user.userId, next); setNotice({ tone: 'success', text: `Account ${next.toLowerCase()}.` }); reload(); }
    catch (caught) { setNotice({ tone: 'danger', text: caught.message }); }
  };
  return <div><PageHeader title="Accounts" description="Manage accounts, access, and activity." actions={<button className="button button--primary" onClick={() => setOpen(true)}><UserPlus size={17} /> Create account</button>} />{notice && <Notice tone={notice.tone}>{notice.text}</Notice>}{loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : <Card><div className="table-wrap"><table aria-label="Accounts"><thead><tr><th>Account</th><th>Roles</th><th>Status</th><th>Password change</th><th>Action</th></tr></thead><tbody>{users.map((user) => <tr key={user.id || user.userId}><td><Link className="account-link" to={`/accounts/${encodeURIComponent(user.id || user.userId)}`}>{user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}</Link><small>{user.email}</small></td><td>{(user.roles || []).map((role) => <StatusBadge key={role} status={role} />)}</td><td><StatusBadge status={user.status || user.accountStatus} /></td><td>{user.mustChangePassword ? 'Required' : 'Complete'}</td><td><button className="button button--ghost" onClick={() => toggleStatus(user)}>{(user.status || user.accountStatus) === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button></td></tr>)}</tbody></table></div><Pagination offset={offset} total={data?.users?.pagination?.total ?? users.length} onChange={setOffset} /></Card>}
    <Modal open={open} title="Create account account" onClose={() => setOpen(false)}><form className="form-grid" onSubmit={create}><FormField label="Email"><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></FormField><FormField label="First name"><input required value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></FormField><FormField label="Last name"><input required value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></FormField><FormField label="Temporary password" hint="At least 12 characters with upper/lowercase, number, and symbol."><input required minLength="12" type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></FormField><FormField label="Role"><select value={form.roleCode} onChange={(event) => setForm({ ...form, roleCode: event.target.value })}>{roles.map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}</select></FormField><label className="checkbox-row"><input type="checkbox" checked={form.mustChangePassword} onChange={(event) => setForm({ ...form, mustChangePassword: event.target.checked })} /> Require password change at first login</label><div className="modal-actions"><button type="button" className="button button--ghost" onClick={() => setOpen(false)}>Cancel</button><button className="button button--primary" disabled={saving}>{saving ? 'Creating…' : 'Create account'}</button></div></form></Modal>
  </div>;
}

export function AuditPage() {
  const [query, setQuery] = useState('');
  const { loading, data, error, reload } = useAsync(() => recordsApi.audit(query ? `?search=${encodeURIComponent(query)}` : ''), [query]);
  const items = data?.items || data?.auditLogs || (Array.isArray(data) ? data : []);
  return <div><PageHeader title="Audit trail" description="Review laboratory activity and status changes. Account access history is available in Accounts." /><Card className="toolbar-card"><div className="search-box"><Search /><input placeholder="Filter audit events" value={query} onChange={(e) => setQuery(e.target.value)} /></div><button className="button button--secondary" onClick={reload}><RefreshCw size={17} /> Refresh</button></Card>{loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : !items.length ? <EmptyState title="No audit events" /> : <div className="table-wrap card"><table><thead><tr><th>Time</th><th>Actor / role</th><th>Action</th><th>Record</th><th>Status transition</th><th>Correlation</th></tr></thead><tbody>{items.map((item) => <tr key={item.id || item.auditId}><td>{new Date(item.timestamp || item.createdAt).toLocaleString()}</td><td>{item.actorName || item.actorUserId || item.userId}<small>{item.role}</small></td><td>{item.action}</td><td>{item.recordType}<small>{item.recordId}</small></td><td>{item.previousStatus || '—'} → {item.newStatus || '—'}</td><td><code>{item.correlationId || '—'}</code></td></tr>)}</tbody></table></div>}</div>;
}

export function SyncPage() {
  const { role } = useWorkspace();
  const canViewServer = ['SYSTEM_ADMIN', 'LAB_SUPERVISOR'].includes(role);
  const [local, setLocal] = useState([]);
  const { loading, data, error, reload } = useAsync(() => canViewServer ? recordsApi.outbox() : Promise.resolve({ items: [] }), [canViewServer]);
  const server = data?.items || data?.events || (Array.isArray(data) ? data : []);
  const refreshLocal = () => offlineDb.listOutbox().then(setLocal).catch(() => setLocal([]));
  useEffect(() => { refreshLocal(); }, []);
  const retryLocal = async (entry) => {
    const updated = { ...entry, status: 'RETRY_WAIT', retryCount: entry.retryCount + 1, nextRetryAt: new Date(Date.now() + 5000).toISOString() };
    await offlineDb.putOutbox(updated); refreshLocal();
  };
  return <div><PageHeader eyebrow="Offline-first operations" title="Synchronization queue" description="Idempotency keys and receipts prevent duplicated patients, specimens, results, releases, objects, and registrations." actions={<button className="button button--secondary" onClick={() => { reload(); refreshLocal(); }}><RefreshCw size={17} /> Refresh</button>} />
    <section className="dashboard-grid"><Card><div className="card-heading"><div><p className="eyebrow">This browser</p><h2>Offline queue</h2></div><CloudCog /></div>{!local.length ? <EmptyState title="Browser queue is clear" /> : local.map((entry) => <div className="health-row" key={entry.id}><span><strong>{entry.method} {entry.path}</strong><small>{entry.idempotencyKey}</small></span><StatusBadge status={entry.status} /><button className="icon-button" title="Schedule retry" onClick={() => retryLocal(entry)}><RotateCcw /></button></div>)}</Card>
    {canViewServer && <Card><div className="card-heading"><div><p className="eyebrow">Records service</p><h2>Durable outbox</h2></div><DatabaseBackup /></div>{loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : !server.length ? <EmptyState title="Server outbox is clear" /> : server.map((entry) => <div className="health-row" key={entry.id}><span><strong>{entry.eventType}</strong><small>Retries: {entry.retryCount || 0}</small></span><StatusBadge status={entry.status} /></div>)}</Card>}</section>
  </div>;
}

export function HealthPage({ embedded = false }) {
  const { loading, data, error, reload } = useAsync(healthApi.all, []);
  const items = (data || []).map((result, index) => result.status === 'fulfilled' ? result.value : ({ name: ['Authentication', 'Records & Sync', 'Encrypted Storage', 'Verification'][index], status: 'Unavailable', error: result.reason?.message }));
  return <div>{embedded ? <div className="card-heading"><h2>Service health</h2><button className="button button--secondary" onClick={reload}><RefreshCw size={17} /> Run checks</button></div> : <PageHeader title="System health" description="Check service availability." actions={<button className="button button--secondary" onClick={reload}><RefreshCw size={17} /> Run checks</button>} />}{loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={reload} /> : <div className="health-grid">{items.map((item) => <Card key={item.name}><div className="card-heading"><Activity /><StatusBadge status={item.status || 'Healthy'} /></div><h2>{item.name}</h2><p>{item.message || item.error || 'Service responded to its health check.'}</p><dl className="details-list compact"><div><dt>Database</dt><dd>{item.database?.driver || item.dbDriver || '—'}</dd></div><div><dt>Adapter</dt><dd>{item.adapter || item.ledgerDriver || item.objectStoreDriver || '—'}</dd></div></dl>{/(file|filesystem|memory|simulated)/i.test(JSON.stringify(item)) && <p className="adapter-note"><AlertTriangle size={16} /> Simulated local adapter; not production infrastructure.</p>}</Card>)}</div>}</div>;
}

export function BackupPage() {
  return <div><PageHeader eyebrow="Resilience" title="Backup & restore" description="Create recoverable snapshots of service databases, encrypted objects, configuration, keys, and ledger considerations." /><Notice tone="warning"><AlertTriangle /> Restore is intentionally not a one-click browser action. It requires a validated target directory, explicit confirmation, and a stopped stack.</Notice><section className="dashboard-grid"><Card><div className="card-heading"><h2>Backup checklist</h2><DatabaseBackup /></div><ol className="check-list"><li>Generate an encrypted backup with <code>infrastructure\backup\Backup-LabChain.ps1</code>.</li><li>Store the archive and key escrow separately.</li><li>Record service versions, Fabric channel, and latest transaction IDs.</li><li>Run <code>Verify-Backup.ps1</code> and retain its report.</li></ol></Card><Card><div className="card-heading"><h2>Safe recovery</h2><ShieldCheck /></div><ol className="check-list"><li>Use a clean, explicitly named recovery directory.</li><li>Stop the stack and verify the backup manifest.</li><li>Run restore with the required <code>-ConfirmRestore</code> switch.</li><li>Verify a known released synthetic record, its decryption, proof, and doctor review history.</li></ol></Card></section></div>;
}
