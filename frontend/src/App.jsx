import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Sparkles } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { session } from './services/api';
import Workspace from './layouts/Workspace';
import Landing from './pages/Landing';
import Login from './pages/Login';
import { ForgotPassword, ResetPassword } from './pages/PasswordReset';
// A deployed Vite build can briefly serve an old HTML shell after a new route
// chunk is published. Retry that lazy import once with a fresh page instead of
// showing a route error on direct reloads such as /campaigns or /documents.
function lazyPage(loader, key) {
  return lazy(async () => {
    try {
      const module = await loader();
      sessionStorage.removeItem(`mf_lazy_retry_${key}`);
      return module;
    } catch (error) {
      const retryKey = `mf_lazy_retry_${key}`;
      if (!sessionStorage.getItem(retryKey)) {
        sessionStorage.setItem(retryKey, '1');
        window.location.reload();
        return new Promise(() => {});
      }
      sessionStorage.removeItem(retryKey);
      throw error;
    }
  });
}
const Overview = lazy(() => import('./pages/Overview'));
const Compose = lazy(() => import('./pages/Compose'));
const Campaigns = lazyPage(() => import('./pages/Campaigns'), 'campaigns');
const CampaignDetail = lazyPage(() =>
  import('./pages/Campaigns').then((m) => ({ default: m.CampaignDetail })),
  'campaign-detail',
);
const Documents = lazyPage(() => import('./pages/Documents'), 'documents');
const Recipients = lazy(() => import('./pages/Recipients'));
const RecipientGroups = lazy(() => import('./pages/RecipientGroups'));
const Activity = lazy(() => import('./pages/Activity'));
const EmailDetail = lazy(() =>
  import('./pages/Activity').then((m) => ({ default: m.EmailDetail })),
);
const Templates = lazy(() => import('./pages/Templates'));
const Studio = lazy(() => import('./pages/Studio'));
const LeadFinder = lazy(() => import('./pages/LeadFinder'));
const LinkedInFinder = lazy(() =>
  import('./pages/LinkedInFinder').then((module) => ({ default: module.default })),
);
const Analytics = lazy(() => import('./pages/Analytics'));
import { SMTP, Settings, Integrations, Audit, Automation } from './pages/Configuration';
function Guard() {
  const { authenticated, initializing } = useAuth();
  // Keep the application shell visible while a saved session is silently restored.
  // The dashboard itself owns its content loader, so navigation never disappears.
  if (initializing) return session.refresh() ? <Workspace /> : null;
  return authenticated ? <Workspace /> : <Navigate to="/login" replace />;
}
function WorkspaceBoot() {
  if (typeof window !== 'undefined' && window.location.pathname === '/') return null;
  return <div className="dashboard-boot" role="status" aria-live="polite">
    <div className="dashboard-boot-mark"><Sparkles size={25} /><i /><i /><i /></div>
    <strong>Building your command center</strong>
    <span>Your workspace is loading securely.</span>
  </div>;
}
export default function App() {
  useDocumentTitle();
  return (
    <Suspense fallback={<WorkspaceBoot />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<Guard />}>
          <Route path="overview" element={<Overview />} />
          <Route path="studio" element={<Studio />} />
          <Route path="lead-finder" element={<Navigate to="/lead-finder/gmail" replace />} />
          <Route path="lead-finder/gmail" element={<LeadFinder />} />
          <Route path="lead-finder/linkedin" element={<LinkedInFinder />} />
          <Route path="compose" element={<Compose />} />
          <Route path="documents" element={<Documents />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="campaigns/:id" element={<CampaignDetail />} />
          <Route path="activity" element={<Activity />} />
          <Route path="activity/:id" element={<EmailDetail />} />
          <Route path="recipients" element={<Recipients />} />
          <Route path="recipient-groups" element={<RecipientGroups />} />
          <Route path="templates" element={<Templates />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="automation" element={<Automation />} />
          <Route path="smtp" element={<SMTP />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="audit" element={<Audit />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
