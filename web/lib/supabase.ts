import type { Database } from "@jaxongirman/types";
import { createClient } from "@supabase/supabase-js";

// Empty counts as missing: a build with a blank .env still has the variable
// defined, and passing "" to createClient throws rather than falling back.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined;

if (!url || !anonKey) {
  console.warn("Supabase client environment is incomplete. Copy web/.env.example to web/.env.local.");
}

/**
 * The browser client, holding the publishable key and nothing else.
 *
 * The web surface reads the same database under the same RLS as the apps — the
 * marketplace stays invisible here because the policies say so, not because
 * this file avoids querying it.
 */
export const supabase = createClient<Database>(
  url ?? "http://127.0.0.1:54321",
  anonKey ?? "missing-anon-key",
  { auth: { persistSession: true, detectSessionInUrl: true } },
);
