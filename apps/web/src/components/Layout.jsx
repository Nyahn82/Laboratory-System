import { useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, Beaker, BookOpenCheck, ClipboardList, CloudCog, FlaskConical, Gauge,
  HeartPulse, History, Network, LogOut, Menu, Microscope, PanelLeftClose, QrCode,
  Send, ShieldCheck, Stethoscope, TestTubes, UserRoundCog, Users, X,
} from 'lucide-react';
import { useWorkspace } from '../auth/WorkspaceContext.jsx';
import { navigation, workspaces } from '../auth/workspaces.js';
import { AuthContext } from '../auth/AuthContext.jsx';
import { offlineDb } from '../offline/indexedDb.js';
import { StatusBadge } from './Ui.jsx';

const icons = {
  '/patients': Users, '/consultations': Stethoscope, '/orders': ClipboardList,
  '/specimens': TestTubes, '/testing': Microscope, '/quality-control': BookOpenCheck,
  '/repeat-referral': FlaskConical, '/result-submission': Send, '/supervisor-review': ShieldCheck,
  '/release': Beaker, '/doctor-review': HeartPulse, '/patient-portal': HeartPulse,
  '/patient-history': History, '/qr': QrCode, '/accounts': UserRoundCog, '/nodes': Network, '/audit': History,
  '/sync': CloudCog, '/health': Activity, '/backup': ShieldCheck,
};

export function Layout() {
  const { user, logout } = useContext(AuthContext);
  const [menuOpen, setMenuOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const location = useLocation();
  const { role, roles, workspace, selectRole } = useWorkspace();
  const navigate = useNavigate();
  const switchWorkspace = (event) => {
    selectRole(event.target.value);
    navigate(workspaces[event.target.value].home, { replace: true });
  };

  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  const signOut = async () => {
    await offlineDb.clearPrivateData().catch(() => {});
    await logout();
  };

  return <div className="app-shell" data-workspace={role}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className={`sidebar ${menuOpen ? 'sidebar--open' : ''}`} aria-label="Primary navigation">
      <div className="brand">
        <span className="brand__mark"><Microscope aria-hidden="true" /></span>
        <span><strong>RHU LabChain</strong><small>{workspace.title}</small></span>
        <button className="icon-button sidebar__close" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X /></button>
      </div>
      {roles.length > 1 && <label className="workspace-switcher">Active workspace<select value={role} onChange={switchWorkspace}>{roles.map((assigned) => <option key={assigned} value={assigned}>{workspaces[assigned].title}</option>)}</select></label>}
      <nav className="nav-list" aria-label={workspace.title}>
        {workspace.home === '/dashboard' && <NavLink to="/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}><Gauge size={19} aria-hidden="true" /><span>{role === 'PUBLIC_VERIFIER' ? 'Verify a report' : 'Overview'}</span></NavLink>}
        {workspace.groups.map(([label, paths]) => <div className="nav-group" key={label}><p className="nav-group__label">{label}</p>{paths.map((to) => {
          const Icon = icons[to];
          return <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}><Icon aria-hidden="true" size={19} /><span>{navigation[to]}</span></NavLink>;
        })}</div>)}
      </nav>
      <div className="sidebar__footer">
        <div className="user-chip"><span className="avatar">{(user?.name || user?.email || 'U').slice(0, 1).toUpperCase()}</span><span><strong>{user?.name || user?.email}</strong><small>{workspace.title}</small></span></div>
        <button className="button button--ghost" onClick={signOut}><LogOut size={18} /> Sign out</button>
      </div>
    </aside>
    {menuOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <div className="app-body">
      <header className="topbar">
        <button className="icon-button menu-button" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu /></button>
        <div className="topbar__context"><PanelLeftClose size={18} aria-hidden="true" /><span>{workspace.title}</span></div>
        <StatusBadge status={online ? 'Online' : 'Offline'} />
      </header>
      <main id="main-content" className="main-content"><Outlet key={role} /></main>
    </div>
  </div>;
}
