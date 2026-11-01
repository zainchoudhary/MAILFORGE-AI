import { createContext, useContext, useState } from 'react';
import { session } from '../services/api';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(!!session.access());
  return (
    <AuthContext.Provider
      value={{
        authenticated,
        login: (data) => {
          session.save(data);
          setAuthenticated(true);
        },
        logout: () => {
          session.clear();
          setAuthenticated(false);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
