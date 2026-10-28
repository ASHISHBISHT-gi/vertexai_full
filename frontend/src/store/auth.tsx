import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setOnSessionExpired, tokens } from "../services/api";
import { authApi } from "../services/lms";
import type { Role, User } from "../services/types";

interface AuthValue {
  user: User | null;
  /** "loading" while we check whether a saved login is still valid on first page load. */
  status: "loading" | "ready";
  login: (email: string, password: string) => Promise<User>;
  register: (full_name: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthValue["status"]>("loading");

  useEffect(() => {
    // If a token refresh ever fails, drop the user back to logged-out.
    setOnSessionExpired(() => {
      setUser(null);
      queryClient.clear();
    });

    if (!tokens.access && !tokens.refresh) {
      setStatus("ready");
      return;
    }
    authApi
      .me()
      .then(setUser)
      .catch(() => tokens.clear())
      .finally(() => setStatus("ready"));
    return () => setOnSessionExpired(null);
  }, [queryClient]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      status,
      async login(email, password) {
        const res = await authApi.login({ email, password });
        tokens.set(res.access_token, res.refresh_token);
        queryClient.clear(); // cached data belonged to the previous (anonymous) viewer
        setUser(res.user);
        return res.user;
      },
      async register(full_name, email, password) {
        const res = await authApi.register({ full_name, email, password });
        tokens.set(res.access_token, res.refresh_token);
        queryClient.clear();
        setUser(res.user);
        return res.user;
      },
      async logout() {
        const refresh = tokens.refresh;
        if (refresh) await authApi.logout(refresh).catch(() => {}); // best effort
        tokens.clear();
        queryClient.clear();
        setUser(null);
      },
      hasRole: (...roles) => !!user && roles.some((r) => user.roles.includes(r)),
    }),
    [user, status, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Where each kind of user lands after logging in. */
export const homeFor = (user: User) => (user.role === "student" ? "/dashboard" : user.role === "instructor" ? "/teach" : "/admin");
