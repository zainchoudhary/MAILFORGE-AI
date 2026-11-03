import { Component, Suspense, useState, useEffect } from 'react';
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
  UserRoundPlus,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { api, session } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../components/Common';
import { Brand, OutreachMark } from '../components/Brand';
const groups = [
  [
    'WORKSPACE',
    [
      ['Overview', '/', LayoutDashboard],
      ['AI Agent Studio', '/studio', Bot],
      ['Campaign', '/campaigns', Mail],
      ['Recipients', '/recipients', Users],
      ['Recipient groups', '/recipient-groups', UserRoundPlus],
    ],
  ],
  [
    'EMAIL OPERATIONS',
    [
      ['Email activity', '/activity', Activity],
      ['Attachments', '/documents', FileScan],
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
                  className={({ isActive }) => `nav-link ${isActive || (url === '/campaigns' && location.pathname === '/compose') ? 'active' : ''}`}
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
        <div className="route-content">
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
        >
          <RouteErrorBoundary key={location.pathname}>
            <Suspense fallback={<RouteSkeleton />}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
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

function RouteSkeleton() {
  return <div className="route-skeleton" aria-label="Loading page content">
    <div className="route-skeleton-heading">
      <div className="skeleton route-skeleton-eyebrow" />
      <div className="skeleton route-skeleton-title" />
      <div className="skeleton route-skeleton-subtitle" />
    </div>
    <div className="route-skeleton-cards">
      <div className="skeleton" /><div className="skeleton" /><div className="skeleton" />
    </div>
    <div className="skeleton route-skeleton-panel" />
  </div>;
}

class RouteErrorBoundary extends Component {
  state = { failed: false, retryCount: 0 };
  static getDerivedStateFromError(error) {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error('Route render failed', error);
    // Route modules can briefly fail while a reload/HMR update swaps chunks.
    // Remount twice before surfacing recovery UI; users should never have to
    // manually recover from that transient rendering state.
    if (this.state.retryCount < 2) {
      window.setTimeout(() => this.setState((current) => ({ failed: false, retryCount: current.retryCount + 1 })), 0);
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="route-recovery" role="alert">
      <div className="route-recovery-mark"><Sparkles size={21} /></div>
      <h2>We couldn’t open this page</h2>
      <p>Your workspace is still safe. Try loading this page again.</p>
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload page</button>
    </section>;
  }
}
