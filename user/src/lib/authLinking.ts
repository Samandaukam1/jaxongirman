import * as Linking from "expo-linking";

import { supabase } from "./supabase";

/**
 * Where Supabase sends the browser after an email confirmation.
 * Builds: `jaxongirman:///auth/callback`. Expo Go: `exp://<host>:8081/--/auth/callback`.
 * Both patterns must be allow-listed as redirect URLs in the Supabase project.
 */
export const authRedirectTo = Linking.createURL("/auth/callback");

if (__DEV__) console.log("[auth] redirect URL:", authRedirectTo);

type AuthRedirectParams = {
  code?: string;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
};

function readAuthParams(url: string): AuthRedirectParams | null {
  const [beforeHash = "", hash = ""] = url.split("#");
  const search = new URLSearchParams(beforeHash.split("?")[1] ?? "");
  const fragment = new URLSearchParams(hash);
  const read = (key: string) => fragment.get(key) ?? search.get(key) ?? undefined;

  const params: AuthRedirectParams = {
    code: read("code"),
    accessToken: read("access_token"),
    refreshToken: read("refresh_token"),
    error: read("error_description") ?? read("error"),
  };
  return params.code || params.accessToken || params.error ? params : null;
}

/**
 * Turns an incoming auth deep link into a session. Handles both the implicit flow
 * (tokens in the fragment) and PKCE (`?code=`), so switching the client's `flowType`
 * later needs no change here. Returns false for links that carry no auth payload.
 */
export async function completeAuthRedirect(url: string): Promise<boolean> {
  const params = readAuthParams(url);
  if (!params) return false;
  if (params.error) throw new Error(params.error);

  if (params.accessToken && params.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });
    if (error) throw error;
    return true;
  }

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) throw error;
    return true;
  }

  return false;
}
