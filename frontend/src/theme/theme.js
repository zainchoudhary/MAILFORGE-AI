export const THEME_STORAGE_KEY = 'mf_theme';

function themeOwnerKey() {
  if (typeof window === 'undefined') return 'guest';
  try {
    const tokens = [
      localStorage.getItem('mf_access'),
      sessionStorage.getItem('mf_access'),
      localStorage.getItem('mf_refresh'),
      sessionStorage.getItem('mf_refresh'),
    ].filter(Boolean);
    for (const token of tokens) {
      const part = token.split('.')[1];
      if (!part) continue;
      const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4)));
      if (payload?.sub || payload?.email) return payload.sub || payload.email;
    }
    return 'guest';
  } catch {
    return 'guest';
  }
}

export function getThemeStorageKey() {
  return `${THEME_STORAGE_KEY}:${themeOwnerKey()}`;
}

export function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return getSystemTheme();
}

export function readStoredTheme() {
  try {
    const value = localStorage.getItem(getThemeStorageKey());
    if (value === 'light' || value === 'dark') return value;
  } catch {
    /* private mode / blocked storage */
  }
  return null;
}

export function applyTheme(theme) {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0d1117' : '#f8fafc');
  return resolved;
}

export function persistTheme(theme) {
  const resolved = applyTheme(theme);
  try {
    localStorage.setItem(getThemeStorageKey(), resolved);
  } catch {
    /* ignore */
  }
  return resolved;
}

export function initTheme() {
  return applyTheme(readStoredTheme() || getSystemTheme());
}
