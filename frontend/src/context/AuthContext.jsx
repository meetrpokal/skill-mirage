import { createContext, useContext, useState, useEffect } from 'react';
import { getMe } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('sm_user_id');
    if (stored) {
      getMe(stored)
        .then(res => setUser(res.data.user))
        .catch(() => localStorage.removeItem('sm_user_id'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const loginUser = (userData) => {
    setUser(userData);
    localStorage.setItem('sm_user_id', userData.id);
  };

  const logoutUser = () => {
    setUser(null);
    localStorage.removeItem('sm_user_id');
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginUser, logoutUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
