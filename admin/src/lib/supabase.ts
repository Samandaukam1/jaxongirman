import type { Database } from "@jaxongirman/types";
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  console.warn("Supabase client environment is incomplete. Copy admin/.env.example to admin/.env.");
}

export const supabase = createClient<Database>(url ?? "http://127.0.0.1:54321", anonKey ?? "missing-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
