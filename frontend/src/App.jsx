import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Loading } from './components/Common';
import { useAuth } from './context/AuthContext';
import Workspace from './layouts/Workspace';
import Login from './pages/Login';
const Overview = lazy(() => import('./pages/Overview'));
const Compose = lazy(() => import('./pages/Compose'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const CampaignDetail = lazy(() =>
  import('./pages/Campaigns').then((m) => ({ default: m.CampaignDetail })),
);
const Documents = lazy(() => import('./pages/Documents'));
const Recipients = lazy(() => import('./pages/Recipients'));
const RecipientGroups = lazy(() => import('./pages/RecipientGroups'));
const Activity = lazy(() => import('./pages/Activity'));
const EmailDetail = lazy(() =>
  import('./pages/Activity').then((m) => ({ default: m.EmailDetail })),
);
const Templates = lazy(() => import('./pages/Templates'));
const Studio = lazy(() => import('./pages/Studio'));
const Analytics = lazy(() => import('./pages/Analytics'));
import { SMTP, Settings, Integrations, Audit, Automation } from './pages/Configuration';
function Guard() {
  const { authenticated } = useAuth();
  return authenticated ? <Workspace /> : <Navigate to="/login" replace />;
}
export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Guard />}>
          <Route index element={<Overview />} />
          <Route path="studio" element={<Studio />} />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
