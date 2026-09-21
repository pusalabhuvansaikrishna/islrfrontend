"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, logout as logoutRequest, type CurrentUser } from "./auth";

type AuthContextValue = {
  user: CurrentUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      router.replace("/");
      return;
    }
    setUser(currentUser);
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const currentUser = await getCurrentUser();
      if (cancelled) return;

      if (!currentUser) {
        router.replace("/");
        return;
      }

      setUser(currentUser);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount — refresh() below is for manual re-checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = useCallback(async () => {
    await logoutRequest();
    router.replace("/");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh: load, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}