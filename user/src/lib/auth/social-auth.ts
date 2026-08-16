import type { Session, User } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

import {
  appleFullName, authError, classifyAuthError, getGoogleAuthConfig,
  hintsFromUserMetadata, mergeHints, profilePatch,
  type AuthUiError, type GoogleAuthConfig, type ProfileHints,
} from "./social-auth-core";

/**
 * Signing in with Apple or Google.
 *
 * Both providers end at the same place: an OIDC identity token handed to
 * `supabase.auth.signInWithIdToken`. Supabase stays the only thing that issues
 * a session, so everything already built on `auth.uid()` — roles, wallets,
 * subscriptions, every RLS policy — works for a social account on the day it is
 * created, with nothing taught about providers.
 *
 * Signing in and signing up are the same call. A person who has never been here
 * gets an account; a person who has gets theirs back. Neither the app nor the
 * button needs to know which happened.
 *
 * Every decision this file makes is made in `social-auth-core.ts`, which has no
 * native imports and is covered by tests. What remains here is the calling.
 */

/**
 * The three client IDs, written out so the bundler can see them.
 *
 * Expo substitutes `process.env.EXPO_PUBLIC_…` for a literal at build time and
 * only where the whole expression appears in the source. Anything cleverer —
 * a loop over key names, a lookup on `process.env` — compiles fine and returns
 * undefined on a device.
 */
export function googleAuthConfig(): GoogleAuthConfig {
  return getGoogleAuthConfig({
    web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });
}

export type SocialAuthResult =
  | { ok: true; user: User; session: Session }
  | { ok: false; error: AuthUiError };

/** Native modules arrive as parameters so a test can hand over a fake. */
type AppleModule = Pick<typeof AppleAuthentication, "signInAsync" | "isAvailableAsync">;

/**
 * Logging that cannot leak.
 *
 * A token, a credential or a whole error object is never passed here — only the
 * classified code, and only while developing. An identity token in a log is a
 * session anybody reading the log can take.
 */
function note(where: string, code: string): void {
  if (__DEV__) console.log(`[auth] ${where}: ${code}`);
}

/* ------------------------------------------------------------ availability */

export type SocialAuthAvailability = { apple: boolean; google: boolean };

/**
 * Which buttons to draw.
 *
 * Apple is asked rather than assumed: the entitlement exists only on iOS, and
 * even there `isAvailableAsync` is false on a simulator without an Apple ID.
 * Drawing a button that cannot work is worse than drawing none.
 */
export async function getSocialAuthAvailability(
  apple: AppleModule = AppleAuthentication,
): Promise<SocialAuthAvailability> {
  let appleReady = false;
  if (Platform.OS === "ios") {
    try {
      appleReady = await apple.isAvailableAsync();
    } catch {
      appleReady = false;
    }
  }
  // Google's button is drawn whether or not it is configured. An unconfigured
  // provider says so when pressed, which somebody can report; a button that was
  // never there looks like the feature does not exist.
  return { apple: appleReady, google: true };
}

/* ------------------------------------------------------------------- Apple */

/**
 * A nonce, so an identity token cannot be replayed.
 *
 * Apple receives the SHA-256 of the value and puts it in the token; Supabase
 * receives the original and hashes it to compare. A token captured on the way
 * past is therefore useless without the raw value, which never leaves this
 * function's caller.
 */
async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  const raw = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}

export async function signInWithApple(
  apple: AppleModule = AppleAuthentication,
): Promise<SocialAuthResult> {
  try {
    if (Platform.OS !== "ios" || !(await apple.isAvailableAsync())) {
      return { ok: false, error: authError("apple_unavailable") };
    }

    const { raw, hashed } = await makeNonce();
    const credential = await apple.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });

    if (!credential.identityToken) {
      note("apple", "no_identity_token");
      return { ok: false, error: authError("no_identity_token") };
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: credential.identityToken,
      nonce: raw,
    });
    if (error || !data.session || !data.user) {
      const classified = classifyAuthError(error);
      note("apple", classified.code);
      return { ok: false, error: classified };
    }

    // Apple gives the name once, on the first authorization, and never again.
    // This is the only moment it can be captured, so it is captured here even
    // though the signup trigger has already written the row.
    await ensureUserProfile(data.user, { fullName: appleFullName(credential.fullName) });

    return { ok: true, user: data.user, session: data.session };
  } catch (failure) {
    const classified = classifyAuthError(failure);
    note("apple", classified.code);
    return { ok: false, error: classified };
  }
}

/* ------------------------------------------------------------------ Google */

/**
 * The Google module, loaded only when it is going to be used.
 *
 * `require` rather than a top-level import: the native module is absent from
 * builds made before it was added, and a missing native module at import time
 * takes the whole bundle down at startup. Reaching for it inside the handler
 * turns that into one button reporting a problem.
 */
type GoogleModule = {
  GoogleSignin: {
    configure: (options: Record<string, unknown>) => void;
    hasPlayServices: (options?: { showPlayServicesUpdateDialog?: boolean }) => Promise<boolean>;
    signIn: () => Promise<unknown>;
  };
  isSuccessResponse: (response: unknown) => response is { data: { idToken: string | null } };
};

let googleConfigured = false;

function loadGoogle(): GoogleModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@react-native-google-signin/google-signin") as GoogleModule;
  } catch {
    return null;
  }
}

export async function signInWithGoogle(
  google: GoogleModule | null = loadGoogle(),
): Promise<SocialAuthResult> {
  const config = googleAuthConfig();
  if (!config.configured || !google) {
    note("google", "provider_not_configured");
    return { ok: false, error: authError("provider_not_configured") };
  }

  try {
    if (!googleConfigured) {
      google.GoogleSignin.configure({
        // Supabase verifies the ID token against the web client, so this is the
        // one that must be right — the platform IDs only decide which sheet the
        // device shows.
        webClientId: config.webClientId,
        iosClientId: config.iosClientId ?? undefined,
        offlineAccess: false,
      });
      googleConfigured = true;
    }

    await google.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await google.GoogleSignin.signIn();

    // Version 16 answers with a discriminated response rather than throwing on
    // cancellation, so a dismissed sheet arrives here as "not a success".
    if (!google.isSuccessResponse(response)) {
      return { ok: false, error: authError("cancelled") };
    }

    const idToken = response.data.idToken;
    if (!idToken) {
      note("google", "no_identity_token");
      return { ok: false, error: authError("no_identity_token") };
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });
    if (error || !data.session || !data.user) {
      const classified = classifyAuthError(error);
      note("google", classified.code);
      return { ok: false, error: classified };
    }

    // Google's claims already reached the signup trigger through the token, so
    // this normally finds nothing to do. It runs anyway for the account that
    // existed before a claim did.
    await ensureUserProfile(data.user, {});

    return { ok: true, user: data.user, session: data.session };
  } catch (failure) {
    const classified = classifyAuthError(failure);
    note("google", classified.code);
    return { ok: false, error: classified };
  }
}

/* ----------------------------------------------------------------- profile */

/**
 * Fills what the profile is missing. It never creates one.
 *
 * `handle_new_user` already inserts the profile, the role, the wallet and the
 * welcome credits when the auth user appears. A second inserter here would race
 * that trigger for the same row and be a second answer to "where do accounts
 * come from". This only writes columns that are empty, and only when a provider
 * supplied something to put in them — a name somebody edited in the app is
 * their decision and outranks anything Apple or Google says later.
 *
 * A failure is swallowed on purpose: the person is signed in, and refusing them
 * the app over a cosmetic column would be the wrong trade.
 */
export async function ensureUserProfile(user: User, hints: ProfileHints): Promise<void> {
  try {
    const wanted = mergeHints(hints, hintsFromUserMetadata(user.user_metadata));
    if (!wanted.fullName && !wanted.avatarUrl) return;

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    if (error || !profile) return;

    const patch = profilePatch(profile, wanted);
    if (!patch) return;

    await supabase.from("profiles").update(patch).eq("id", user.id);
  } catch {
    note("profile", "fill_skipped");
  }
}

export type { AuthUiError } from "./social-auth-core";
