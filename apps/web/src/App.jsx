import { useContext } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { WorkspaceProvider, useWorkspace } from './auth/WorkspaceContext.jsx';
import { canOpen } from './auth/workspaces.js';
import { AuthContext } from './auth/AuthContext.jsx';
import { Layout } from './components/Layout.jsx';
import { LoadingState } from './components/Ui.jsx';
import { LoginPage, PasswordChangePage } from './pages/AuthPages.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { PatientsPage, PatientProfilePage } from './pages/PatientsPage.jsx';
import { ConsultationPage, OrdersPage } from './pages/ClinicalPages.jsx';
import { WorkflowQueuePage } from './pages/WorkflowQueuePage.jsx';
import { PatientPortalPage, QrPage } from './pages/PatientPortalPage.jsx';
import { PublicVerificationPage } from './pages/PublicVerificationPage.jsx';
import { AuditPage, BackupPage, HealthPage, SyncPage, UsersPage } from './pages/OperationsPages.jsx';
import { AccountDetailPage, NodesPage } from './pages/AdminPages.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

function Protected({ children, path }) {
  const { user, loading } = useContext(AuthContext);
  const location = useLocation();
  const { role, workspace } = useWorkspace();
  if (loading) return <div className="standalone-state"><LoadingState label="Restoring secure session…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.mustChangePassword && location.pathname !== '/password-change') return <Navigate to="/password-change" replace />;
  if (!workspace) return <div className="standalone-state">No workspace is assigned to this account. Contact your administrator.</div>;
  if (path && !canOpen(role, path)) return <Navigate to={workspace.home} replace />;
  return children;
}

function Gate({ path, children }) {
  return <Protected path={path}>{children}</Protected>;
}

export default function App() {
  const { user } = useContext(AuthContext);
  return <WorkspaceProvider><Routes>
    <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
    <Route path="/verify/:token" element={<PublicVerificationPage />} />
    <Route path="/password-change" element={<Protected><PasswordChangePage /></Protected>} />
    <Route element={<Protected><Layout /></Protected>}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="patients" element={<Gate path="/patients"><PatientsPage /></Gate>} />
      <Route path="patients/:id" element={<Gate path="/patients"><PatientProfilePage /></Gate>} />
      <Route path="consultations" element={<Gate path="/consultations"><ConsultationPage /></Gate>} />
      <Route path="orders" element={<Gate path="/orders"><OrdersPage /></Gate>} />
      <Route path="specimens" element={<Gate path="/specimens"><WorkflowQueuePage key="specimen" mode="specimen" /></Gate>} />
      <Route path="testing" element={<Gate path="/testing"><WorkflowQueuePage key="testing" mode="testing" /></Gate>} />
      <Route path="quality-control" element={<Gate path="/quality-control"><WorkflowQueuePage key="qc" mode="qc" /></Gate>} />
      <Route path="repeat-referral" element={<Gate path="/repeat-referral"><WorkflowQueuePage key="repeat" mode="repeat" /></Gate>} />
      <Route path="result-submission" element={<Gate path="/result-submission"><WorkflowQueuePage key="submission" mode="submission" /></Gate>} />
      <Route path="supervisor-review" element={<Gate path="/supervisor-review"><WorkflowQueuePage key="approval" mode="approval" /></Gate>} />
      <Route path="release" element={<Gate path="/release"><WorkflowQueuePage key="release" mode="release" /></Gate>} />
      <Route path="doctor-review" element={<Gate path="/doctor-review"><WorkflowQueuePage key="doctor-review" mode="doctor-review" /></Gate>} />
      <Route path="patient-portal" element={<Gate path="/patient-portal"><PatientPortalPage /></Gate>} />
      <Route path="patient-history" element={<Gate path="/patient-history"><PatientPortalPage history /></Gate>} />
      <Route path="qr" element={<Gate path="/qr"><QrPage /></Gate>} />
      <Route path="users" element={<Navigate to="/accounts" replace />} />
      <Route path="accounts" element={<Gate path="/accounts"><UsersPage /></Gate>} />
      <Route path="accounts/:id" element={<Gate path="/accounts"><AccountDetailPage /></Gate>} />
      <Route path="nodes" element={<Gate path="/nodes"><NodesPage /></Gate>} />
      <Route path="audit" element={<Gate path="/audit"><AuditPage /></Gate>} />
      <Route path="sync" element={<Gate path="/sync"><SyncPage /></Gate>} />
      <Route path="health" element={<Gate path="/health"><HealthPage /></Gate>} />
      <Route path="backup" element={<Gate path="/backup"><BackupPage /></Gate>} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes></WorkspaceProvider>;
}
