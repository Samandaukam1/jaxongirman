import type { Session, User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { Alert, AppState } from "react-native";

import { i18n } from "@/i18n";
import { completeAuthRedirect } from "@/lib/authLinking";
import { registerDevice } from "@/lib/devices";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  /**
   * This phone names itself for the session, and checks in each time it comes
   * back to the foreground. A session taken out from another device answers
   * "not active", and the phone signs itself out at once instead of waiting
   * for its token to run out.
   */
  const sessionId = session?.access_token ? session.user.id + ":" + (session.expires_at ?? "") : null;
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    const check = async () => {
      const active = await registerDevice();
      if (alive && !active) await supabase.auth.signOut({ scope: "local" });
    };
    void check();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void check(); });
    return () => { alive = false; subscription.remove(); };
  }, [sessionId]);

  // Email confirmation links come back as a deep link carrying the session.
  // `setSession` fires onAuthStateChange, so no extra state wiring is needed here.
  useEffect(() => {
    let cancelled = false;
    async function handle(url: string | null) {
      if (!url || cancelled) return;
      try {
        await completeAuthRedirect(url);
      } catch (error) {
        Alert.alert(i18n.t("auth:confirmFailed"), asErrorMessage(error));
      }
    }
    void Linking.getInitialURL().then(handle);
    const subscription = Linking.addEventListener("url", (event) => void handle(event.url));
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    }),
    [loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
