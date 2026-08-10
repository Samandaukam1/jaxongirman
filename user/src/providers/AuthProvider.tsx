import type { Session, User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { Alert } from "react-native";

import { completeAuthRedirect } from "@/lib/authLinking";
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

  // Email confirmation links come back as a deep link carrying the session.
  // `setSession` fires onAuthStateChange, so no extra state wiring is needed here.
  useEffect(() => {
    let cancelled = false;
    async function handle(url: string | null) {
      if (!url || cancelled) return;
      try {
        await completeAuthRedirect(url);
      } catch (error) {
        Alert.alert("Tasdiqlash amalga oshmadi", asErrorMessage(error));
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
