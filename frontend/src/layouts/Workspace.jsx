import { Suspense, useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Bot,
  ChevronDown,
  CircleHelp,
  FileScan,
  FolderKanban,
  Layers,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { api, session } from '../services/api';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../components/Common';
import { Brand, OutreachMark } from '../components/Brand';
const groups = [
  [
    'WORKSPACE',
    [
      ['Overview', '/', LayoutDashboard],
      ['AI Agent Studio', '/studio', Bot],
      ['Compose email', '/compose', Mail],
      ['Recipients', '/recipients', Users],
    ],
  ],
  [
    'EMAIL OPERATIONS',
    [
      ['Campaigns', '/campaigns', FolderKanban],
      ['Email activity', '/activity', Activity],
      ['Document intelligence', '/documents', FileScan],
      ['Templates', '/templates', Layers],
      ['Analytics', '/analytics', BarChart3],
      ['Automation', '/automation', Zap],
    ],
  ],
  [
    'CONFIGURATION',
    [
      ['SMTP settings', '/smtp', Plug],
      ['Integrations', '/integrations', BookOpen],
      ['Audit logs', '/audit', ShieldCheck],
      ['Settings', '/settings', Settings],
    ],
  ],
];
export default function Workspace() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('mf_sidebar_collapsed') === 'true');
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { logout } = useAuth();
  const location = useLocation();
  const client = useQueryClient();
  const initialLoading = useIsFetching({
    predicate: (query) => query.getObserversCount() > 0 && query.state.data === undefined && !query.state.error,
  });
  const [readyRoute, setReadyRoute] = useState(null);
  const [moduleLoading, setModuleLoading] = useState(false);
  const loadedRoutes = useRef(new Map());
  const routeIdentity = location.pathname + location.search;
  const cachedKeys = loadedRoutes.current.get(routeIdentity);
  const hasCachedPage = cachedKeys !== undefined && cachedKeys.every(
    (key) => client.getQueryData(key) !== undefined,
  );
  const pageLoading = readyRoute !== location.key && !hasCachedPage;
  useEffect(() => {
    if (readyRoute === location.key || initialLoading || moduleLoading) return;
    // Allow mounted child panels to register dependent requests before reveal.
    const timer = setTimeout(() => {
      loadedRoutes.current.set(routeIdentity, client.getQueryCache().getAll()
        .filter((query) => query.getObserversCount() > 0 && query.state.data !== undefined)
        .map((query) => query.queryKey));
      setReadyRoute(location.key);
    }, hasCachedPage ? 0 : 250);
    return () => clearTimeout(timer);
  }, [initialLoading, moduleLoading, location.key, readyRoute, routeIdentity, client, hasCachedPage]);
  const me = useApi('/auth/me');
  const settings = useApi('/settings');
  useEffect(() => {
    const preferences = settings.data?.preferences;
    if (preferences) {
      document.documentElement.classList.toggle('compact-tables', !!preferences.compact_tables);
      if (preferences.timezone) sessionStorage.setItem('mf_timezone', preferences.timezone);
    }
  }, [settings.data]);
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const controller = new AbortController();
    async function listen() {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch('/api/v1/events', {
            headers: { Authorization: `Bearer ${session.access()}` },
            signal: controller.signal,
          });
          if (!response.ok) break;
          const reader = response.body.getReader();
          while (true) {
            const { done } = await reader.read();
            if (done) break;
            client.invalidateQueries({ queryKey: ['/analytics/overview'] });
          }
        } catch {
          break;
        }
      }
    }
    listen();
    return () => controller.abort();
  }, [client]);
  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-heading-row">
        <NavLink to="/" aria-label="Outreach Studio home"><Brand /></NavLink>
        <button
          type="button"
          className="sidebar-collapse-toggle"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            localStorage.setItem('mf_sidebar_collapsed', String(next));
          }}
        >
          {collapsed ? (
            <span className="sidebar-collapsed-toggle-icons" aria-hidden="true">
              <span className="sidebar-app-mark" aria-label="Outreach Studio"><OutreachMark className="sidebar-collapsed-logo" /></span>
              <PanelLeftOpen className="sidebar-expand-mark" size={20} />
            </span>
          ) : <PanelLeftClose size={16} />}
        </button>
        </div>
        <div className="workspace-switch">
          <div className="workspace-avatar">{me.data?.name?.[0] || 'M'}</div>
          <div>
            <strong>My workspace</strong>
            <small>Email operations</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <nav>
          {groups.map(([label, links]) => (
            <div className="nav-group" key={label}>
              <h3>{label}</h3>
              {links.map(([title, url, Icon]) => (
                <NavLink
                  key={url}
                  title={collapsed ? title : undefined}
                  aria-label={title}
                  to={url}
                  end={url === '/'}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                  <Icon size={17} />
                  <span>{title}</span>
                  {url === '/studio' && <span className="tiny-tag">AI</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="safe-card">
            <ShieldCheck size={18} />
            <div>
              <strong>{settings.data?.dry_run ? 'Safe mode enabled' : 'Approval protected'}</strong>
              <small>
                {settings.data?.dry_run ? 'Dry run · no live delivery' : 'Human approval required'}
              </small>
            </div>
          </div>
          <button
            className="profile"
            onClick={() => setLogoutOpen(true)}
          >
            <div className="avatar">{me.data?.name?.[0] || 'M'}</div>
            <div>
              <strong>{me.data?.name || 'Workspace member'}</strong>
              <small>Sign out</small>
            </div>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <ConfirmDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title="Sign out of Outreach Studio"
        confirmLabel="Sign out"
        message="Are you sure you want to sign out of this workspace?"
        onConfirm={async () => {
          await api.post('/auth/logout');
          logout();
          client.clear();
        }}
      />
      <div className="workspace-main">
        <div className="mobile-navigation-control">
            <button
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
        </div>
        <div className="route-content" aria-busy={pageLoading}>
        {pageLoading && (
          <div className="route-skeleton" aria-label="Loading page content">
            <div className="route-skeleton-heading">
              <div className="skeleton route-skeleton-eyebrow" />
              <div className="skeleton route-skeleton-title" />
              <div className="skeleton route-skeleton-subtitle" />
            </div>
            <div className="route-skeleton-cards">
              <div className="skeleton" /><div className="skeleton" /><div className="skeleton" />
            </div>
            <div className="skeleton route-skeleton-panel" />
          </div>
        )}
        <motion.main
          style={pageLoading ? { visibility: 'hidden', pointerEvents: 'none', height: 0, overflow: 'hidden' } : undefined}
          aria-hidden={pageLoading}
          key={location.pathname}
          initial={hasCachedPage ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
        >
          <Suspense fallback={<ModulePending setPending={setModuleLoading} />}>
            <Outlet />
          </Suspense>
        </motion.main>
        </div>
        <footer>
          Outreach Studio <span>Intelligent outreach. Accountable delivery.</span>
          <span>v1.0</span>
        </footer>
      </div>
    </div>
  );
}

function ModulePending({ setPending }) {
  useEffect(() => {
    setPending(true);
    return () => setPending(false);
  }, [setPending]);
  return null;
}
