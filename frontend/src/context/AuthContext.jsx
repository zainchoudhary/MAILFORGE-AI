import { createContext, useContext, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { session } from '../services/api';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(!!session.access());
  const client = useQueryClient();
  return (
    <AuthContext.Provider
      value={{
        authenticated,
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
