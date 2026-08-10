import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";

export type RequestContext = {
  user: User;
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
};

export async function requestContext(request: Request): Promise<RequestContext> {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !anonKey || !serviceKey) throw new Error("Supabase server environment is incomplete");
  if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "Authentication required", "unauthorized");

  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Invalid or expired session", "unauthorized");

  const { data: profile, error: profileError } = await serviceClient.from("profiles").select("status").eq("id", data.user.id).single();
  if (profileError) throw profileError;
  if (profile.status === "blocked") throw new HttpError(403, "Account is blocked", "account_blocked");
  return { user: data.user, userClient, serviceClient };
}

export async function privacySafeIdentifier(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`jaxongirman:${userId}`));
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
