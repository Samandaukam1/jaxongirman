import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

/**
 * Whether this build may offer a purchase, and what to say where one would be.
 *
 * App Store Review Guideline 3.1.1 requires in-app purchase for anything that
 * unlocks content or features inside an iOS app. Everything Jaxongirman sells —
 * subscriptions, J Coin, module access, marketplace materials — is consumed in
 * the app, so until StoreKit exists the compliant iOS build offers none of it.
 * This provider is how every screen learns that, from one server answer rather
 * than from four copies of the same `Platform.OS === "ios"` check.
 *
 * The server is the authority: even a screen that forgot to ask gets refused by
 * the RPC that would have opened the payment. This is the presentation half.
 *
 * Android and web are never affected — `paymentsEnabled` can only ever be
 * narrowed for iOS, and a failed lookup leaves purchases on rather than
 * silently disabling a platform that has no such rule.
 */
export type PaymentCopyKey = "subscription" | "jcoin" | "marketplace" | "module";

type Policy = {
  paymentsEnabled: boolean;
  providerConfigured: boolean;
  provider: string | null;
  showPrices: boolean;
  copy: Partial<Record<PaymentCopyKey, string>>;
};

type PolicyContext = Policy & {
  loading: boolean;
  refresh: () => Promise<void>;
  /** The sentence to show where a purchase would have been. */
  unavailableMessage: (key: PaymentCopyKey) => string;
};

const FALLBACK: Policy = {
  // Open by default. A network blip must not look like a policy change, and on
  // Android or web there is nothing to gate in the first place.
  paymentsEnabled: true,
  providerConfigured: false,
  provider: null,
  showPrices: true,
  copy: {},
};

const DEFAULT_COPY: Record<PaymentCopyKey, string> = {
  subscription: "Tarif iOS ilovasida mavjud emas.",
  jcoin: "J Coin iOS ilovasida mavjud emas.",
  marketplace: "Do‘kon iOS ilovasida vaqtincha mavjud emas.",
  module: "Bu modul iOS ilovasida mavjud emas.",
};

const Context = createContext<PolicyContext | null>(null);

/** What the server is told this device is. Exactly what the RPC matches on. */
export const clientPlatform = Platform.OS;

export function PaymentPolicyProvider({ children }: PropsWithChildren) {
  const [policy, setPolicy] = useState<Policy>(FALLBACK);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("payment_policy", { p_platform: clientPlatform });
      if (error) throw error;
      const row = data as unknown as {
        payments_enabled: boolean; provider_configured: boolean; provider: string | null;
        show_prices: boolean; copy: Partial<Record<PaymentCopyKey, string>>;
      };
      setPolicy({
        paymentsEnabled: row.payments_enabled !== false,
        providerConfigured: Boolean(row.provider_configured),
        provider: row.provider ?? null,
        showPrices: row.show_prices !== false,
        copy: row.copy ?? {},
      });
    } catch {
      // Deliberately silent and open: see FALLBACK.
      setPolicy(FALLBACK);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<PolicyContext>(() => ({
    ...policy,
    loading,
    refresh,
    unavailableMessage: (key) => policy.copy[key] ?? DEFAULT_COPY[key],
  }), [loading, policy, refresh]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePaymentPolicy(): PolicyContext {
  const value = useContext(Context);
  if (!value) throw new Error("usePaymentPolicy must be used inside PaymentPolicyProvider");
  return value;
}
