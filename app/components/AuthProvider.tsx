"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface AuthContextValue {
  isAuthenticated: boolean;
  isGuest: boolean;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  isGuest: true,
  isLoading: true,
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((data) => {
        setIsAuthenticated(data.authenticated === true);
      })
      .catch(() => {
        setIsAuthenticated(false);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setIsAuthenticated(false);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isGuest: !isAuthenticated,
        isLoading,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
