import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const APP = 'Outreach Studio';

const TITLES = {
  '/login': 'Sign in',
  '/register': 'Create account',
  '/forgot-password': 'Forgot password',
  '/reset-password': 'Reset password',
  '/overview': 'Overview',
  '/studio': 'AI Agent Studio',
  '/lead-finder/gmail': 'Google Search',
  '/lead-finder/linkedin': 'LinkedIn Search',
  '/compose': 'Compose',
  '/documents': 'Attachments',
  '/campaigns': 'Campaign',
  '/activity': 'Email activity',
  '/recipients': 'Recipients',
  '/recipient-groups': 'Recipient groups',
  '/templates': 'Templates',
  '/analytics': 'Analytics',
  '/automation': 'Automation',
  '/smtp': 'SMTP settings',
  '/integrations': 'Integrations',
  '/audit': 'Audit logs',
  '/settings': 'Settings',
};

function pageLabel(pathname) {
  if (pathname === '/') return null;
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith('/campaigns/')) return 'Campaign';
  if (pathname.startsWith('/activity/')) return 'Email';
  if (pathname.startsWith('/lead-finder')) return 'Outreach Intelligence';
  return null;
}

export function appDocumentTitle(page) {
  if (!page) return APP;
  return `${APP} — ${page}`;
}

export function documentTitleForPath(pathname) {
  const page = pageLabel(pathname);
  if (page == null) return null;
  return appDocumentTitle(page);
}

/** Keep the browser tab label in sync with the active route (landing owns `/`). */
export function useDocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    const next = documentTitleForPath(pathname);
    if (!next) return undefined;
    document.title = next;
    return undefined;
  }, [pathname]);
}
