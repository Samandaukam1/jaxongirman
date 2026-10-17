import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthHero } from "@/components/AuthHero";
import { FormField } from "@/components/FormField";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SocialAuthButtons } from "@/components/SocialAuthButtons";
import { LANGUAGE_NAMES } from "@/i18n";
import { authRedirectTo } from "@/lib/authLinking";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/providers/LanguageProvider";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The first screen, and for most people the only one they will judge the app by
 * before deciding whether to bother.
 *
 * Three ways in, ordered by how little they ask of somebody: Apple and Google
 * want one tap, the form wants an email, a password and a trip to an inbox. The
 * form is collapsed behind a link rather than removed — it is how every account
 * that exists today was made, and putting two empty fields under the fold of a
 * welcome screen makes the fast paths look like an afterthought beside them.
 */
export default function SignInScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation("auth");
  const { language, setLanguage, uiLanguages } = useLanguage();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email.trim() || password.length < 8) {
      Alert.alert(t("missingTitle"), t("missingBody"));
      return;
    }
    setLoading(true);
    try {
      if (mode === "sign-in") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() }, emailRedirectTo: authRedirectTo },
        });
        if (error) throw error;
        if (!data.session) Alert.alert(t("confirmTitle"), t("confirmBody"));
      }
    } catch (error) {
      Alert.alert(t("failed"), asErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    // A wash rather than a flat white: the marks above are stickers, and a
    // sticker needs something to sit on. It fades out before the buttons so
    // nothing competes with them for the eye.
    <LinearGradient
      colors={colors.authWash}
      locations={[0, 0.42, 0.78]}
      style={styles.screen}
    >
      <View style={styles.flex}>
        <KeyboardAwareScrollView bottomOffset={spacing.xl}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Before an account there is no profile to keep a language in, so
              the choice is offered here too; it is remembered on the phone. */}
          <View style={styles.languages} accessibilityRole="radiogroup">
            {uiLanguages.concat(uiLanguages.includes(language) ? [] : [language]).map((code) => {
              const selected = language === code;
              return (
                <Pressable
                  key={code}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => void setLanguage(code)}
                  hitSlop={6}
                  style={[styles.language, selected && styles.languageSelected]}
                >
                  <Text style={[styles.languageText, selected && styles.languageTextSelected]}>{LANGUAGE_NAMES[code]}</Text>
                </Pressable>
              );
            })}
          </View>

          <AuthHero />

          <View style={styles.copy}>
            <Text style={styles.title}>{t("title")}</Text>
            <Text style={styles.subtitle}>{t("subtitle")}</Text>
          </View>

          <SocialAuthButtons />

          {emailOpen ? (
            <View style={styles.form}>
              {mode === "sign-up" ? (
                <FormField label={t("fullName")} value={fullName} onChangeText={setFullName} autoComplete="name" />
              ) : null}
              <FormField label={t("email")} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
              <FormField label={t("password")} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "sign-in" ? "current-password" : "new-password"} />
              <PrimaryButton
                label={mode === "sign-in" ? t("signIn") : t("signUp")}
                trailingIcon={ArrowRight}
                loading={loading}
                onPress={() => void submit()}
              />
              <Pressable
                onPress={() => setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"))}
                style={styles.switch}
              >
                <Text style={styles.switchText}>
                  {mode === "sign-in" ? t("toSignUp") : t("toSignIn")}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setEmailOpen(true)}
              style={({ pressed }) => [styles.emailButton, pressed && styles.pressed]}
            >
              <Text style={styles.emailButtonText}>{t("withEmail")}</Text>
            </Pressable>
          )}

          <Text style={styles.legal}>{t("legal")}</Text>
        </KeyboardAwareScrollView>
      </View>
    </LinearGradient>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },

  languages: { flexDirection: "row", justifyContent: "center", gap: spacing.xs },
  language: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  languageSelected: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  languageText: { ...typography.caption, color: colors.inkSoft },
  languageTextSelected: { color: colors.ink, fontFamily: "Manrope_700Bold" },

  copy: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  title: { ...typography.display, color: colors.ink, textAlign: "center", fontSize: 32, lineHeight: 38 },
  subtitle: { ...typography.body, color: colors.inkMuted, textAlign: "center", paddingHorizontal: spacing.md },

  emailButton: {
    minHeight: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
  },
  emailButtonText: { ...typography.bodyMedium, fontSize: 16, color: colors.ink },
  pressed: { opacity: 0.85 },

  form: { gap: spacing.lg },
  switch: { alignItems: "center", paddingTop: spacing.sm },
  switchText: { ...typography.caption, color: colors.primary },

  legal: { ...typography.caption, color: colors.inkSoft, textAlign: "center", paddingTop: spacing.sm },
}));
