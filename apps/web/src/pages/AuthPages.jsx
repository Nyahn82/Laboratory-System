import { useContext, useState } from 'react';
import { KeyRound, LockKeyhole, Microscope, ShieldCheck, UserRound } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext.jsx';
import { FormField, Notice } from '../components/Ui.jsx';

export function LoginPage() {
  const { login } = useContext(AuthContext);
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const user = await login(form.email.trim(), form.password);
      const destination = user?.mustChangePassword ? '/password-change' : location.state?.from?.pathname || '/dashboard';
      navigate(destination, { replace: true });
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="auth-page">
    <section className="auth-intro">
      <div className="auth-brand"><span className="brand__mark brand__mark--large"><Microscope /></span><span><strong>RHU LabChain</strong><small>Hybrid Laboratory Record System</small></span></div>
      <div className="auth-copy"><p className="eyebrow">Local Phase One prototype</p><h1>Trusted records from collection to release.</h1><p>Role-separated laboratory workflows, encrypted record packages, and transparent verification for a Rural Health Unit.</p></div>
      <div className="auth-trust"><span><ShieldCheck /> Encrypted at rest</span><span><KeyRound /> Controlled access</span></div>
      <p className="prototype-warning">Synthetic or formally de-identified data only. This prototype is not approved for production clinical use.</p>
    </section>
    <section className="auth-panel" aria-labelledby="sign-in-title">
      <form className="auth-form card" onSubmit={submit}>
        <div className="auth-form__icon"><LockKeyhole /></div>
        <p className="eyebrow">Secure local access</p>
        <h2 id="sign-in-title">Welcome back</h2>
        <p className="muted">Use the account assigned by your system administrator.</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <FormField label="Email or username">
          <div className="input-with-icon"><UserRound /><input name="email" autoComplete="username" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        </FormField>
        <FormField label="Password">
          <div className="input-with-icon"><KeyRound /><input name="password" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        </FormField>
        <button className="button button--primary button--wide" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
        <a className="text-link" href="mailto:system-administrator@rhu.local">Need access? Contact your administrator.</a>
      </form>
    </section>
  </main>;
}

export function PasswordChangePage() {
  const { user, changePassword } = useContext(AuthContext);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const navigate = useNavigate();
  if (!user) return <Navigate to="/login" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (form.newPassword.length < 12) return setError('Use at least 12 characters.');
    if (form.newPassword !== form.confirm) return setError('The new passwords do not match.');
    try {
      await changePassword(form.currentPassword, form.newPassword);
      setDone(true);
      setTimeout(() => navigate('/dashboard', { replace: true }), 700);
    } catch (caught) {
      setError(caught.message);
    }
  };

  return <main className="center-page"><form className="card narrow-card" onSubmit={submit}>
    <div className="auth-form__icon"><KeyRound /></div>
    <p className="eyebrow">Account protection</p><h1>Choose a private password</h1>
    <p className="muted">Development seed accounts must be changed before clinical screens are available.</p>
    {error && <Notice tone="danger">{error}</Notice>}{done && <Notice tone="success">Password updated. Opening your dashboard…</Notice>}
    <FormField label="Current password"><input type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></FormField>
    <FormField label="New password" hint="At least 12 characters; use a unique passphrase."><input type="password" autoComplete="new-password" required value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /></FormField>
    <FormField label="Confirm new password"><input type="password" autoComplete="new-password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></FormField>
    <button className="button button--primary button--wide">Save password</button>
  </form></main>;
}

