import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { adminCheck, adminLogin, adminLogout } from "../services/api";
import { identifyAdmin, resetAnalyticsIdentity } from "../lib/analytics";

interface AdminContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    adminCheck()
      .then(() => {
        setIsAuthenticated(true);
        identifyAdmin({ app_area: "admin" });
      })
      .catch(() => setIsAuthenticated(false))
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (password: string) => {
    await adminLogin(password);
    setIsAuthenticated(true);
    identifyAdmin({ app_area: "admin" });
  }, []);

  const logout = useCallback(async () => {
    await adminLogout();
    setIsAuthenticated(false);
    resetAnalyticsIdentity();
  }, []);

  return (
    <AdminContext.Provider value={{ isAuthenticated, isLoading, login, logout }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}
