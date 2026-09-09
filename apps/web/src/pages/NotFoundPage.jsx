import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../components/Ui.jsx';

export function NotFoundPage() {
  return <div className="center-page"><Card className="narrow-card"><p className="eyebrow">404</p><h1>Screen not found</h1><p className="muted">The requested workflow screen does not exist or is outside your role boundary.</p><Link className="button button--primary" to="/dashboard"><ArrowLeft size={17} /> Back to dashboard</Link></Card></div>;
}
