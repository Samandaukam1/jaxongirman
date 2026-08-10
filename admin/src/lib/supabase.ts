import type { Database } from "@jaxongirman/types";
import { createClient } from "@supabase/supabase-js";

import { publishableKey, requiredUrl } from "./env-guard";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * There is no stand-in for a missing key. A placeholder does not degrade to
 * "signed out" — the client sends it as a bearer token, and every request comes
 * back rejected for the shape of a string.
 */
export const supabase = createClient<Database>(
  requiredUrl(url, "VITE_SUPABASE_URL"),
  publishableKey(anonKey, "VITE_SUPABASE_ANON_KEY"),
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
