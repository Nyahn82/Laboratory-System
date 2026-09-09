import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Network, RefreshCw } from 'lucide-react';
import { authApi, recordsApi, verificationApi } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, EmptyState, ErrorState, LoadingState, Notice, PageHeader, StatusBadge } from '../components/Ui.jsx';

const date = (value) => value ? new Date(value).toLocaleString() : '—';
const activityLabels = { AUTH_LOGIN: 'Sign-in', AUTH_LOGOUT: 'Sign-out', AUTH_REFRESH: 'Session renewed', AUTH_REFRESH_REUSE: 'Session reuse blocked', USER_CREATE: 'Account created', USER_UPDATE: 'Account updated', USER_STATUS_CHANGE: 'Account status changed', PASSWORD_CHANGE: 'Password changed', PASSWORD_RESET_REQUEST: 'Password reset requested', PASSWORD_RESET_CONFIRM: 'Password reset completed' };
const label = (value) => String(value || '—').replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase());

export function Pagination({ offset, total, onChange, limit = 25 }) {
  return <div className="pagination"><small>{total ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}` : '0 records'}</small><div className="button-row">
    <button className="button button--ghost" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</button>
    <button className="button button--ghost" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</button>
  </div></div>;
}

export function AccountDetailPage() {
  const { id } = useParams();
  return <AccountDetails key={id} id={id} />;
}

function AccountDetails({ id }) {
  const { loading, data: account, error, reload } = useAsync(() => authApi.user(id), [id]);
  const [trail, setTrail] = useState('access');
  return <div>
    <Link className="back-link" to="/accounts"><ArrowLeft size={17} /> Accounts</Link>
    {loading ? <LoadingState label="Loading account…" /> : error ? <ErrorState error={error} onRetry={reload} /> : <>
      <PageHeader title={[account.firstName, account.lastName].filter(Boolean).join(' ') || account.email} description={account.email} actions={<StatusBadge status={account.status} />} />
      <Card className="account-profile"><h2>Account information</h2><dl className="account-details">
        <div><dt>Email</dt><dd>{account.email}</dd></div>
        <div><dt>Roles</dt><dd>{account.roles.map(label).join(', ')}</dd></div>
        <div><dt>Created</dt><dd>{date(account.createdAt)}</dd></div>
        <div><dt>Last updated</dt><dd>{date(account.updatedAt)}</dd></div>
        <div><dt>Password change</dt><dd>{account.mustChangePassword ? 'Required at next sign-in' : 'Complete'}</dd></div>
        <div><dt>Account ID</dt><dd>{account.id}</dd></div>
        {account.patientId && <div><dt>Linked patient ID</dt><dd>{account.patientId}</dd></div>}
      </dl></Card>
      <section aria-label="Account audit trail" className="account-trail">
        <h2>Audit trail</h2>
        <div className="segmented-control" role="group" aria-label="Activity type">
          <button aria-pressed={trail === 'access'} onClick={() => setTrail('access')}>Account access</button>
          <button aria-pressed={trail === 'workflow'} onClick={() => setTrail('workflow')}>Laboratory activity</button>
        </div>
        <AccountTrail key={`${id}:${trail}`} id={id} type={trail} />
      </section>
    </>}
  </div>;
}

function AccountTrail({ id, type }) {
  const [offset, setOffset] = useState(0);
  const access = type === 'access';
  const { loading, data, error, reload } = useAsync(() => access
    ? authApi.userAudit(id, offset)
    : recordsApi.audit(`?actorUserId=${encodeURIComponent(id)}&limit=25&offset=${offset}`), [id, type, offset]);
  const items = data?.items || [];
  return <Card><div className="card-heading"><p className="muted">{access ? 'Sign-ins, password changes, and administration of this account.' : 'Laboratory actions performed by this account.'}</p><button className="button button--secondary" disabled={loading} onClick={reload}><RefreshCw size={16} /> Refresh</button></div>
    {loading ? <LoadingState label="Loading activity…" /> : error ? <ErrorState error={error} onRetry={reload} /> : !items.length ? <EmptyState title="No activity recorded" message="Events will appear here when this account is used." /> : <>
      <div className="table-wrap"><table><thead><tr><th>Time</th><th>Activity</th><th>{access ? 'Actor' : 'Record'}</th><th>{access ? 'Outcome' : 'Status'}</th><th>Source</th></tr></thead>
        <tbody>{items.map((item) => <tr key={item.id || item.auditId}>
          <td>{date(item.createdAt || item.timestamp)}</td>
          <td><strong>{activityLabels[item.eventType] || label(item.eventType || item.action)}</strong>{access && item.targetType === 'USER' && item.targetId !== id && <small>Account: {item.targetId}</small>}</td>
          <td>{access ? (item.actorUserId === id ? 'This account' : item.actorUserId || 'System') : <>{label(item.recordType)}<small>{item.recordId}</small></>}</td>
          <td>{access ? <StatusBadge status={item.outcome} /> : item.newStatus ? <StatusBadge status={item.newStatus} /> : '—'}</td>
          <td>{item.ipAddress || item.deviceOrSource || '—'}</td>
        </tr>)}</tbody></table></div>
      <Pagination offset={offset} total={data?.pagination?.total ?? data?.total ?? items.length} onChange={setOffset} />
    </>}
  </Card>;
}

export function NodesPage() {
  const { loading, data, error, reload } = useAsync(verificationApi.nodes, []);
  return <div><PageHeader title="Nodes" description="Monitor the blockchain network and ledger connection." actions={<button className="button button--secondary" disabled={loading} onClick={reload}><RefreshCw size={17} /> Refresh checks</button>} />
    {loading ? <LoadingState label="Checking blockchain nodes…" /> : error ? <ErrorState error={error} onRetry={reload} /> : <>
      {data.simulated && <Notice>Simulation mode. The application uses a local ledger; live blockchain nodes are not connected.</Notice>}
      <Card className="ledger-summary"><div className="card-heading"><h2>{data.simulated ? 'Local ledger' : 'Hyperledger Fabric'}</h2><StatusBadge status={data.ledgerStatus} /></div><dl className="account-details">
        <div><dt>Channel</dt><dd>{data.channel}</dd></div><div><dt>Smart contract</dt><dd>{data.chaincode}</dd></div><div><dt>Last checked</dt><dd>{date(data.checkedAt)}</dd></div>
      </dl><p className="muted">{data.simulated ? 'Node checks become available when the Fabric network is connected.' : 'Ledger readiness checks a smart contract query. Node health checks report each service’s health; they do not confirm that every peer has the latest block.'}</p></Card>
      <div className="nodes-grid">{data.nodes.map((node) => <Card key={node.id}><div className="card-heading"><Network size={22} /><StatusBadge status={node.status} /></div><h2>{node.name}</h2><p className="muted">{node.type}</p><p>{node.message}</p>{node.latencyMs != null && <small>Response time: {node.latencyMs} ms</small>}</Card>)}</div>
    </>}
  </div>;
}
