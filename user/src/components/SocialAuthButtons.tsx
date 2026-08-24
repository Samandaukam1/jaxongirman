import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import {
  getSocialAuthAvailability, signInWithApple, signInWithGoogle,
  type SocialAuthAvailability,
} from "@/lib/auth/social-auth";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Apple's mark, drawn rather than imported.
 *
 * `lucide-react-native` ships an `Apple` icon that is a piece of fruit with a
 * leaf — not Apple Inc.'s logo. On a black Sign in with Apple button that reads
 * as a mistake, and Apple's guidelines are specific about which mark goes
 * there. This is that mark, at the weight their spec asks for.
 */
function AppleMark({ size = 19 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill="#FFFFFF"
        d="M17.05 12.54c-.02-2.66 2.17-3.93 2.27-4-1.24-1.8-3.16-2.05-3.84-2.08-1.63-.16-3.19.96-4.02.96-.83 0-2.11-.94-3.46-.91-1.78.03-3.42 1.03-4.34 2.63-1.85 3.2-.47 7.95 1.33 10.55.88 1.27 1.93 2.7 3.3 2.65 1.33-.05 1.83-.86 3.43-.86 1.6 0 2.05.86 3.46.83 1.42-.03 2.33-1.3 3.2-2.58 1-1.47 1.42-2.9 1.44-2.98-.03-.01-2.77-1.06-2.8-4.22z"
      />
      <Path
        fill="#FFFFFF"
        d="M14.54 4.6c.73-.89 1.22-2.12 1.09-3.35-1.05.05-2.33.7-3.08 1.59-.68.78-1.27 2.04-1.11 3.24 1.17.09 2.37-.6 3.1-1.48z"
      />
    </Svg>
  );
}

/**
 * Google's mark, drawn rather than imported.
 *
 * The four colours and the shape are Google's and are reproduced exactly:
 * their brand terms allow the mark on a sign-in button and allow nothing else —
 * not the wordmark, not the mark in the app's violet, not an approximation.
 * `lucide-react-native` carries no brand logos, which is why this is inline.
 */
function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <Path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <Path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <Path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </Svg>
  );
}

type Provider = "apple" | "google";

/**
 * Two ways in that are not a keyboard.
 *
 * Signing in and signing up are one button each: somebody who has been here
 * before gets their account, somebody who has not gets one made. Neither needs
 * to be asked which they are, which is the whole reason these are worth having
 * above a form that asks for an email, a password, and a confirmation email.
 *
 * A cancelled sign-in shows nothing at all. Somebody who changed their mind
 * knows they changed their mind, and an error toast for it reads as a fault.
 */
export function SocialAuthButtons({ onSignedIn }: { onSignedIn?: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [available, setAvailable] = useState<SocialAuthAvailability>({ apple: false, google: true });
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSocialAuthAvailability().then((next) => {
      if (!cancelled) setAvailable(next);
    });
    return () => { cancelled = true; };
  }, []);

  async function run(provider: Provider) {
    setBusy(provider);
    setError(null);
    const result = provider === "apple" ? await signInWithApple() : await signInWithGoogle();
    setBusy(null);

    if (result.ok) {
      // The session lands in AuthProvider through onAuthStateChange, and the
      // (auth) layout redirects on it. Nothing is navigated from here, so there
      // is no second route change to race the first.
      onSignedIn?.();
      return;
    }
    if (result.error.code !== "cancelled") setError(result.error.message);
  }

  if (!available.apple && !available.google) return null;

  return (
    <View style={styles.wrapper}>
      {available.apple ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Apple bilan davom etish"
          disabled={busy !== null}
          onPress={() => void run("apple")}
          style={({ pressed }) => [styles.button, styles.apple, pressed && styles.pressed, busy !== null && busy !== "apple" && styles.dimmed]}
        >
          {busy === "apple" ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <AppleMark />
              <Text style={[styles.label, styles.appleLabel]}>Apple bilan davom etish</Text>
            </>
          )}
        </Pressable>
      ) : null}

      {available.google ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Google bilan davom etish"
          disabled={busy !== null}
          onPress={() => void run("google")}
          style={({ pressed }) => [styles.button, styles.google, pressed && styles.pressed, busy !== null && busy !== "google" && styles.dimmed]}
        >
          {busy === "google" ? (
            <ActivityIndicator color={colors.ink} size="small" />
          ) : (
            <>
              <GoogleMark />
              <Text style={[styles.label, styles.googleLabel]}>Google bilan davom etish</Text>
            </>
          )}
        </Pressable>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.divider}>
        <View style={styles.rule} />
        <Text style={styles.dividerText}>yoki email bilan</Text>
        <View style={styles.rule} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrapper: { gap: spacing.sm },
  button: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    minHeight: 52, borderRadius: radius.md, paddingHorizontal: spacing.lg,
  },
  // Apple's guidelines fix the shape of this button: their black, their glyph,
  // their wording. It is the one control in the app that is not ours to style.
  apple: { backgroundColor: "#000000" },
  google: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  pressed: { opacity: 0.85 },
  dimmed: { opacity: 0.4 },
  label: { ...typography.bodyMedium, fontSize: 16 },
  appleLabel: { color: "#FFFFFF" },
  googleLabel: { color: colors.ink },
  error: { ...typography.caption, color: colors.danger, textAlign: "center", paddingTop: spacing.xs },
  divider: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  rule: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { ...typography.caption, color: colors.inkSoft },
}));
