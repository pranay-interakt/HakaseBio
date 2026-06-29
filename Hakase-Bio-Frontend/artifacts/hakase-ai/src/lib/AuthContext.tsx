/**
 * AuthContext + ProtectedRoute.
 * Single source of truth for "is the user signed in" on the frontend.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import * as api from "./authApi";
import type { MeUser } from "./authApi";
import { clearPersistedWorkspace } from "@/hooks/usePersistedState";

interface AuthCtx {
  user: MeUser | null;
  loading: boolean;
  login: (emailOrUsername: string, password: string) => Promise<MeUser>;
  signup: (email: string, title: string, firstName: string, lastName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<MeUser | null>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On boot, attempt a silent refresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await api.refresh();
        if (!cancelled) setUser(u);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (emailOrUsername: string, password: string) => {
    const u = await api.login({ emailOrUsername, password });
    setUser(u);
    return u;
  }, []);

  const signup = useCallback(async (email: string, title: string, firstName: string, lastName: string, password: string) => {
    await api.signup({ email, title, firstName, lastName, password });
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    // Sign-out flushes any persisted analysis state — no data leakage between accounts on the same machine.
    clearPersistedWorkspace();
  }, []);

  const refresh = useCallback(async () => {
    const u = await api.refresh();
    setUser(u);
    return u;
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, login, signup, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within <AuthProvider>");
  return v;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      navigate(`/login?next=${next}`, { replace: true });
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07080c] text-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Loading workspace…
        </div>
      </div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}
