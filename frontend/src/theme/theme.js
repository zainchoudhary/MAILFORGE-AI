export const THEME_STORAGE_KEY = 'mf_theme';

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
    const value = localStorage.getItem(THEME_STORAGE_KEY);
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
    localStorage.setItem(THEME_STORAGE_KEY, resolved);
  } catch {
    /* ignore */
  }
  return resolved;
}

export function initTheme() {
  return applyTheme(readStoredTheme() || getSystemTheme());
}
