import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  applyTheme,
  getSystemTheme,
  initTheme,
  persistTheme,
  readStoredTheme,
} from '../theme/theme';

const ThemeContext = createContext({
  theme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof document !== 'undefined') {
      const current = document.documentElement.getAttribute('data-theme');
      if (current === 'light' || current === 'dark') return current;
    }
    return initTheme();
  });

  const setTheme = useCallback((next) => {
    setThemeState(persistTheme(next));
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => persistTheme(current === 'dark' ? 'light' : 'dark'));
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    // Follow system only until the user has explicitly chosen a theme.
    if (readStoredTheme()) return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setThemeState(applyTheme(getSystemTheme()));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
