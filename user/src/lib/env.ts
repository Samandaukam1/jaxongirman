import { publishableKey, requiredUrl } from "./env-guard";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * There is no stand-in for a missing key. A placeholder does not degrade to
 * "signed out" — the client sends it as a bearer token, and every request comes
 * back rejected for the shape of a string rather than for anything an operator
 * could act on.
 */
export const env = {
  supabaseUrl: requiredUrl(supabaseUrl, "EXPO_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: publishableKey(supabaseAnonKey, "EXPO_PUBLIC_SUPABASE_ANON_KEY"),
};
