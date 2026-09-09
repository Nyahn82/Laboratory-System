import { AlertTriangle, CheckCircle2, Inbox, LoaderCircle, RefreshCw, WifiOff } from 'lucide-react';

export function Card({ children, className = '', as: Component = 'section' }) {
  return <Component className={`card ${className}`.trim()}>{children}</Component>;
}

export function StatusBadge({ status = 'Unknown' }) {
  const normalized = String(status).toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  const positive = /(healthy|ready|released|approved|verified|passed|synchronized|active|valid|success|complete)/.test(normalized);
  const negative = /(failed|rejected|critical|offline|unhealthy|locked|cancelled|invalid|unavailable|not-ready|disabled|denied)/.test(normalized);
  const waiting = /(pending|testing|syncing|verification|draft|queued|processing|repeat)/.test(normalized);
  return <span className={`badge ${negative ? 'badge--negative' : positive ? 'badge--positive' : waiting ? 'badge--waiting' : ''}`}>{String(status).replaceAll('_', ' ')}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return <header className="page-header">
    <div>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p className="page-description">{description}</p>}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}

export function LoadingState({ label = 'Loading local records…' }) {
  return <div className="state-card" role="status"><LoaderCircle className="spin" aria-hidden="true" /><p>{label}</p></div>;
}

export function EmptyState({ title = 'Nothing here yet', message = 'Records will appear when the workflow reaches this stage.' }) {
  return <div className="state-card"><Inbox aria-hidden="true" /><h3>{title}</h3><p>{message}</p></div>;
}

export function ErrorState({ error, onRetry }) {
  return <div className="state-card state-card--error" role="alert">
    {navigator.onLine ? <AlertTriangle aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
    <h3>We could not load this screen</h3>
    <p>{error?.message || 'The local service did not respond.'}</p>
    {onRetry && <button className="button button--secondary" onClick={onRetry}><RefreshCw size={17} /> Try again</button>}
  </div>;
}

export function Notice({ children, tone = 'info' }) {
  return <div className={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
    {tone === 'success' ? <CheckCircle2 /> : <AlertTriangle />}
    <div>{children}</div>
  </div>;
}

export function FormField({ label, hint, error, children }) {
  return <label className="field">
    <span className="field__label">{label}</span>
    {children}
    {hint && !error && <span className="field__hint">{hint}</span>}
    {error && <span className="field__error">{error}</span>}
  </label>;
}

export function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal__header"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}>×</button></div>
      {children}
    </section>
  </div>;
}
