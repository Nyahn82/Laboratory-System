import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { authApi, setAccessToken } from '../api/client.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(sessionStorage.getItem('labchain.accessToken')));

  const clearSession = useCallback(() => {
    setAccessToken('');
    setUser(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const restore = async () => {
      if (!sessionStorage.getItem('labchain.accessToken')) return setLoading(false);
      try {
        const data = await authApi.me();
        setUser(data.user || data);
      } catch {
        clearSession();
      } finally {
        setLoading(false);
      }
    };
    restore();
    const expired = () => clearSession();
    window.addEventListener('labchain:session-expired', expired);
    return () => window.removeEventListener('labchain:session-expired', expired);
  }, [clearSession]);

  const login = useCallback(async (email, password) => {
    const data = await authApi.login(email, password);
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const data = await authApi.changePassword(currentPassword, newPassword);
    if (data.accessToken) setAccessToken(data.accessToken);
    setUser(data.user || { ...user, mustChangePassword: false });
  }, [user]);

  const value = useMemo(() => ({ user, loading, login, logout, changePassword, clearSession }), [user, loading, login, logout, changePassword, clearSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

