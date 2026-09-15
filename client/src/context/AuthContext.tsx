import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "simplycrm.user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setUser(JSON.parse(stored));
    setLoading(false);
  }, []);

  async function login(email: string, password: string) {
    const { token, user: loggedInUser } = await api.post<{ token: string; user: AuthUser }>(
      "/auth/login",
      { email, password },
    );
    localStorage.setItem("token", token);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loggedInUser));
    setUser(loggedInUser);
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
