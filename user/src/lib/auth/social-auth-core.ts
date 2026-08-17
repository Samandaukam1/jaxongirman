/**
 * Every decision social sign-in makes, and none of the machinery.
 *
 * Nothing here imports React Native, Expo or Supabase. That is not tidiness for
 * its own sake: it is what lets this file be compiled on its own and exercised
 * in `node --test`, so the parts that are easy to get quietly wrong — which
 * provider error becomes which sentence, whose name wins when two sources
 * disagree — are checked by a test rather than by installing a build on a phone
 * and hoping.
 *
 * The adapters in `social-auth.ts` hold the native calls and defer every
 * judgement to this file.
 */

/* ----------------------------------------------------------------- config */

export type GoogleAuthConfig = {
  /** True only when the app has enough to attempt a Google sign-in at all. */
  configured: boolean;
  webClientId: string | null;
  iosClientId: string | null;
  androidClientId: string | null;
};

/**
 * A Google OAuth client ID: a project number, a hyphen, an identifier.
 *
 * Checking the shape rather than merely that something was set, because
 * "something was set" is exactly how the app came to crash: the placeholder
 * text out of a set of instructions was stored in EAS, passed this gate as a
 * non-empty string, and reached the Google SDK — which answers a malformed
 * client ID with an Objective-C exception that kills the process.
 *
 * The identifier after the hyphen must be long, because the short fakes are the
 * ones that get pasted: `xxxx` out of an example is well-formed by every other
 * measure. Google's own are around thirty characters.
 *
 * A value that is not a client ID means the provider is not configured. That
 * is the honest reading, and it is also the safe one: the button says so and
 * nothing native is called.
 *
 * `scripts/client-id.mjs` holds the same pattern for the setup scripts, which
 * cannot import this file — it is compiled standalone by the test harness and
 * must stay dependency-free. A test compares the two and fails if they drift.
 */
const CLIENT_ID = /^\d{6,}-[a-z0-9]{12,}\.apps\.googleusercontent\.com$/;

function clientId(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  return CLIENT_ID.test(text) ? text : null;
}

/**
 * What the build was given for Google.
 *
 * A missing value is a state, never a throw. `env.ts` throws for a missing
 * Supabase key because without it every request in the app fails for a reason
 * nobody can read; a missing Google client ID makes exactly one button
 * unavailable, and taking the whole app down over it would be a worse answer
 * than the button saying so.
 *
 * The web client ID is the one that matters: Supabase verifies the ID token
 * against it, so a build with only the iOS ID would produce a sign-in that
 * looks like it works and then fails at the exchange.
 *
 * The values are passed in rather than read here. Expo replaces
 * `process.env.EXPO_PUBLIC_…` with a literal at build time, which it can only
 * do where the expression is written out in full — reading the same variable
 * through a computed key returns undefined in a real build while working
 * perfectly in a test. So the reads stay in `social-auth.ts`, where the
 * bundler sees them, and this file stays free of globals and testable.
 */
export function getGoogleAuthConfig(
  source: { web?: string; ios?: string; android?: string },
): GoogleAuthConfig {
  const webClientId = clientId(source.web);
  return {
    configured: webClientId !== null,
    webClientId,
    iosClientId: clientId(source.ios),
    androidClientId: clientId(source.android),
  };
}

/* ------------------------------------------------------------------ errors */

export type AuthErrorCode =
  | "cancelled"
  | "no_identity_token"
  | "provider_not_configured"
  | "provider_disabled"
  | "duplicate_account"
  | "play_services_unavailable"
  | "apple_unavailable"
  | "in_progress"
  | "network"
  | "unknown";

export type AuthUiError = {
  code: AuthErrorCode;
  /** What a person reads. Never a provider's own message. */
  message: string;
};

/**
 * One sentence per thing that can go wrong, in the language of the app.
 *
 * A provider's own message is written for a developer reading a stack trace: it
 * names OAuth grants and audiences. Passing it through to somebody trying to
 * sign in tells them nothing they can act on and leaks how the integration is
 * wired.
 */
const MESSAGES: Record<AuthErrorCode, string> = {
  cancelled: "Kirish bekor qilindi.",
  no_identity_token:
    "Provayder tasdiqni qaytarmadi. Iltimos, qaytadan urinib ko‘ring.",
  provider_not_configured: "Google orqali kirish hozircha sozlanmagan.",
  provider_disabled:
    "Bu kirish usuli hozircha yoqilmagan. Iltimos, email orqali kiring.",
  duplicate_account:
    "Bu email boshqa kirish usuli bilan allaqachon ishlatilgan.",
  play_services_unavailable:
    "Qurilmangizda Google Play Services mavjud emas yoki yangilanishi kerak.",
  apple_unavailable: "Apple orqali kirish bu qurilmada mavjud emas.",
  in_progress: "Avvalgi urinish hali tugamadi.",
  network: "Internet aloqasi yo‘q. Ulanishni tekshirib, qaytadan urinib ko‘ring.",
  unknown: "Kirish amalga oshmadi. Iltimos, qaytadan urinib ko‘ring.",
};

export function authError(code: AuthErrorCode): AuthUiError {
  return { code, message: MESSAGES[code] };
}

/**
 * Supabase codes that mean "this email already belongs to another way in".
 *
 * Taken from `@supabase/auth-js`'s own error-code list rather than guessed, so
 * a rename in the library is a compile-time or test-time surprise instead of a
 * message that silently stops matching.
 */
const DUPLICATE_CODES = new Set([
  "email_exists",
  "user_already_exists",
  "identity_already_exists",
  "email_conflict_identity_not_deletable",
  "provider_email_needs_verification",
]);

/** Codes meaning the provider is not switched on in the Supabase dashboard. */
const DISABLED_CODES = new Set([
  "provider_disabled",
  "oauth_provider_not_supported",
  "signup_disabled",
]);

/** The native cancellations. Apple and Google each spell theirs differently. */
const CANCEL_TOKENS = [
  "ERR_REQUEST_CANCELED",
  "ERR_CANCELED",
  "SIGN_IN_CANCELLED",
  "-5", // Google's numeric status code for a dismissed sheet
];

type LooseError = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  status?: unknown;
};

/**
 * Turns whatever a provider or Supabase threw into one of our codes.
 *
 * Written defensively because the three sources disagree about shape: Supabase
 * carries a string `code`, `expo-apple-authentication` throws an `Error` whose
 * `code` is a constant, and the Google library throws with a numeric `code`.
 * None of them is trusted to be present.
 */
export function classifyAuthError(error: unknown): AuthUiError {
  if (typeof error === "string") return classifyAuthError({ message: error });

  const raw = (error ?? {}) as LooseError;
  const code = typeof raw.code === "string" ? raw.code : String(raw.code ?? "");
  const message = typeof raw.message === "string" ? raw.message : "";
  const haystack = `${code} ${message}`;

  if (CANCEL_TOKENS.some((token) => haystack.includes(token))) return authError("cancelled");
  if (/cancel/i.test(haystack)) return authError("cancelled");

  if (DISABLED_CODES.has(code)) return authError("provider_disabled");
  // Before the dashboard is configured this is what actually comes back, and it
  // arrives as prose rather than as a code.
  if (/provider is not enabled|unsupported provider/i.test(message)) {
    return authError("provider_disabled");
  }

  if (DUPLICATE_CODES.has(code)) return authError("duplicate_account");

  if (haystack.includes("PLAY_SERVICES_NOT_AVAILABLE")) return authError("play_services_unavailable");
  if (haystack.includes("IN_PROGRESS")) return authError("in_progress");
  if (haystack.includes("ERR_APPLE_AUTHENTICATION_UNAVAILABLE")) return authError("apple_unavailable");

  if (/network request failed|fetch failed|timeout/i.test(message)) return authError("network");

  return authError("unknown");
}

/* -------------------------------------------------------------- Apple name */

export type AppleFullName = {
  givenName?: string | null;
  middleName?: string | null;
  familyName?: string | null;
} | null;

/**
 * Apple's name parts, joined.
 *
 * Apple hands the name over exactly once — on the first authorization — and
 * never again, so this returns `null` on every later sign-in rather than an
 * empty string. The difference matters downstream: `null` means "Apple said
 * nothing this time, keep what is stored", while `""` would read as "the name
 * is blank" and could overwrite a real one.
 */
export function appleFullName(name: AppleFullName): string | null {
  if (!name) return null;
  const joined = [name.givenName, name.middleName, name.familyName]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" ");
  return joined.length > 0 ? joined.slice(0, 120) : null;
}

/* ------------------------------------------------------------ profile fill */

export type ProfileHints = {
  fullName?: string | null;
  avatarUrl?: string | null;
};

export type StoredProfile = {
  full_name?: string | null;
  avatar_url?: string | null;
};

export type ProfilePatch = {
  full_name?: string;
  avatar_url?: string;
};

/**
 * What is missing from a profile that the provider could supply.
 *
 * Only gaps are filled. Somebody who signed in with Google and then renamed
 * themselves in the app has made a decision, and a later sign-in must not undo
 * it — which is exactly what would happen if the provider's claims were written
 * on every login.
 *
 * Returns `null` when there is nothing to do, so the caller can skip the write
 * entirely rather than sending an update that changes no column.
 */
export function profilePatch(profile: StoredProfile, hints: ProfileHints): ProfilePatch | null {
  const patch: ProfilePatch = {};

  const storedName = (profile.full_name ?? "").trim();
  const hintedName = (hints.fullName ?? "").trim();
  if (storedName.length === 0 && hintedName.length > 0) {
    patch.full_name = hintedName.slice(0, 120);
  }

  const storedAvatar = (profile.avatar_url ?? "").trim();
  const hintedAvatar = (hints.avatarUrl ?? "").trim();
  if (storedAvatar.length === 0 && hintedAvatar.length > 0) {
    patch.avatar_url = hintedAvatar;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * What a Google or Apple sign-in leaves in the auth user's metadata.
 *
 * Google fills these from the ID token's claims, so the signup trigger already
 * has them; reading them again here costs nothing and covers the case where the
 * trigger ran before a claim was present.
 */
export function hintsFromUserMetadata(metadata: Record<string, unknown> | null | undefined): ProfileHints {
  const bag = metadata ?? {};
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = bag[key];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
    return null;
  };
  return {
    fullName: pick("full_name", "name"),
    avatarUrl: pick("avatar_url", "picture"),
  };
}

/** Later hints never blank an earlier one — first non-empty answer wins. */
export function mergeHints(...all: ProfileHints[]): ProfileHints {
  const merged: ProfileHints = {};
  for (const hints of all) {
    if (!merged.fullName && hints.fullName) merged.fullName = hints.fullName;
    if (!merged.avatarUrl && hints.avatarUrl) merged.avatarUrl = hints.avatarUrl;
  }
  return merged;
}
