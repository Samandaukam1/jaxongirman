import type { Tables } from "@jaxongirman/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

type Profile = Pick<Tables<"profiles">, "id" | "full_name" | "first_name" | "last_name" | "username" | "avatar_url">;
type Entitlement = Pick<Tables<"module_entitlements">, "module_code" | "expires_at" | "starts_at" | "status">;

type AccountState = {
  profile: Profile | null;
  balance: number;
  reserved: number;
  unreadCount: number;
  /** Live entitlements, newest expiry last. Empty means no paid module. */
  entitlements: Entitlement[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Local echo, so a badge clears the moment the inbox is opened. */
  setUnreadCount: (value: number) => void;
};

const AccountContext = createContext<AccountState | null>(null);

/**
 * One place that knows who the signed-in person is, what their wallet holds and
 * how many messages are waiting — read once and then kept current by realtime
 * rather than re-queried by every screen that shows a balance.
 */
export function AccountProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState(0);
  const [reserved, setReserved] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setProfile(null); setBalance(0); setReserved(0); setUnreadCount(0); setEntitlements([]);
      setLoading(false);
      return;
    }
    try {
      const [profileResult, walletResult, unreadResult, entitlementResult] = await Promise.all([
        supabase.from("profiles").select("id,full_name,first_name,last_name,username,avatar_url").eq("id", user.id).single(),
        supabase.from("credit_wallets").select("balance,reserved").eq("user_id", user.id).single(),
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
        supabase.from("module_entitlements")
          .select("module_code,expires_at,starts_at,status")
          .eq("user_id", user.id)
          .eq("status", "active")
          .gt("expires_at", new Date().toISOString())
          .order("expires_at", { ascending: true }),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (walletResult.error) throw walletResult.error;

      setProfile(profileResult.data);
      setBalance(walletResult.data.balance);
      setReserved(walletResult.data.reserved);
      setUnreadCount(unreadResult.count ?? 0);
      setEntitlements(entitlementResult.data ?? []);
      setError(null);
    } catch (nextError) {
      setError(asErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  // The wallet row is the authority on the balance; a transfer done on another
  // device should move this number without anyone pulling to refresh.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`account-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "credit_wallets", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as Tables<"credit_wallets">;
          setBalance(row.balance);
          setReserved(row.reserved);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => setUnreadCount((count) => count + 1),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user]);

  const value = useMemo<AccountState>(
    () => ({ profile, balance, reserved, unreadCount, entitlements, loading, error, refresh, setUnreadCount }),
    [balance, entitlements, error, loading, profile, refresh, reserved, unreadCount],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) throw new Error("useAccount must be used within AccountProvider");
  return context;
}

/**
 * "Jahongir" from whatever the profile actually has. Falls back through the
 * name parts to the handle, and finally to a neutral word — never to a
 * placeholder that looks like real data.
 */
export function displayFirstName(profile: Profile | null): string {
  const first = profile?.first_name?.trim();
  if (first) return first;
  const full = profile?.full_name?.trim();
  if (full) return full.split(/\s+/)[0] ?? full;
  if (profile?.username) return profile.username;
  return "Foydalanuvchi";
}

/** Initials for the avatar fallback: "JQ", or a single letter when that is all there is. */
export function profileInitials(profile: Profile | null): string {
  const parts = [profile?.first_name, profile?.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  if (parts.length === 0) {
    const source = profile?.full_name?.trim() || profile?.username?.trim() || "";
    if (!source) return "J";
    return source.split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase() || "J";
  }
  return parts.slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}
