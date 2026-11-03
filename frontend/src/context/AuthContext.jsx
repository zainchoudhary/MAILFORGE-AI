import { createContext, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { restoreSession, session } from '../services/api';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const client = useQueryClient();
  useEffect(() => {
    let active = true;
    async function restore() {
      if (!session.refresh()) {
        if (active) setInitializing(false);
        return;
      }
      const restored = await restoreSession();
      if (active) {
        setAuthenticated(restored);
        if (active) setInitializing(false);
      }
    }
    restore();
    const syncTabs = (event) => {
      if (event.key === 'mf_refresh') setAuthenticated(!!event.newValue);
    };
    window.addEventListener('storage', syncTabs);
    return () => { active = false; window.removeEventListener('storage', syncTabs); };
  }, []);
  return (
    <AuthContext.Provider
      value={{
        authenticated,
        initializing,
        login: (data) => {
          client.clear();
          session.save(data);
          setAuthenticated(true);
        },
        logout: () => {
          session.clear();
          client.clear();
          setAuthenticated(false);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
