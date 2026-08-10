import { can, isAdminRole, isAppRole, isSuperAdminRole, type AdminPermission, type AppRole } from "@jaxongirman/types";
import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { supabase } from "@/lib/supabase";

type AuthState = {
  session: Session | null;
  loading: boolean;
  /** The strongest role the signed-in account holds. */
  role: AppRole;
  /** Admin or super admin — the gate for the console itself. */
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /**
   * Whether this account may perform a named action. Rendering only: the
   * database re-checks every privileged call, so hiding a control is a courtesy
   * to the user, never the thing that keeps them out.
   */
  can: (permission: AdminPermission) => boolean;
  accessChecked: boolean;
  refreshAccess: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<AppRole>("user");
  const [accessChecked, setAccessChecked] = useState(false);

  async function checkAccess(nextSession: Session | null) {
    setAccessChecked(false);
    if (!nextSession) {
      setRole("user");
      setAccessChecked(true);
      return;
    }
    // current_app_role() is security definer and reads user_roles server-side,
    // so the browser never decides its own rank — it is only told what it is.
    const { data, error } = await supabase.rpc("current_app_role");
    setRole(!error && isAppRole(data) ? data : "user");
    setAccessChecked(true);
  }

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      void checkAccess(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      void checkAccess(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading,
      role,
      isAdmin: isAdminRole(role),
      isSuperAdmin: isSuperAdminRole(role),
      can: (permission: AdminPermission) => can(role, permission),
      accessChecked,
      refreshAccess: () => checkAccess(session),
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    }),
    [accessChecked, loading, role, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const state = useContext(AuthContext);
  if (!state) throw new Error("useAuth must be used inside AuthProvider");
  return state;
}
