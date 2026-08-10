import type { Database } from "@jaxongirman/types";
import { createClient } from "@supabase/supabase-js";

import { publishableKey, requiredUrl } from "./env-guard";

// Empty counts as missing: a build with a blank .env still has the variable
// defined, and passing "" to createClient throws rather than falling back.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined;

/**
 * The browser client, holding the publishable key and nothing else.
 *
 * The web surface reads the same database under the same RLS as the apps — the
 * marketplace stays invisible here because the policies say so, not because
 * this file avoids querying it.
 *
 * There is no stand-in for a missing key. The client sends whatever it is given
 * as a bearer token, so a placeholder does not degrade to "signed out" — it
 * degrades to PostgREST rejecting every request with `Expected 3 parts in JWT`,
 * an error that names nothing an operator could act on.
 */
export const supabase = createClient<Database>(
  requiredUrl(url, "NEXT_PUBLIC_SUPABASE_URL"),
  publishableKey(anonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  { auth: { persistSession: true, detectSessionInUrl: true } },
);
