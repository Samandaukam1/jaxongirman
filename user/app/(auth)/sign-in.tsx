import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight } from "lucide-react-native";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { AuthHero } from "@/components/AuthHero";
import { FormField } from "@/components/FormField";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SocialAuthButtons } from "@/components/SocialAuthButtons";
import { authRedirectTo } from "@/lib/authLinking";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
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
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email.trim() || password.length < 8) {
      Alert.alert("Ma’lumot yetarli emas", "Email va kamida 8 belgili parol kiriting.");
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
        if (!data.session) Alert.alert("Emailni tasdiqlang", "Tasdiqlash havolasi emailingizga yuborildi.");
      }
    } catch (error) {
      Alert.alert("Kirish amalga oshmadi", asErrorMessage(error));
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
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <AuthHero />

          <View style={styles.copy}>
            <Text style={styles.title}>Fikringizdan{"\n"}taqdimot tug‘iladi</Text>
            <Text style={styles.subtitle}>
              Bir mavzu yozing — slaydlar, dizayn va o‘yin o‘zi tayyor bo‘ladi.
            </Text>
          </View>

          <SocialAuthButtons />

          {emailOpen ? (
            <View style={styles.form}>
              {mode === "sign-up" ? (
                <FormField label="Ism va familiya" value={fullName} onChangeText={setFullName} autoComplete="name" />
              ) : null}
              <FormField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
              <FormField label="Parol" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "sign-in" ? "current-password" : "new-password"} />
              <PrimaryButton
                label={mode === "sign-in" ? "Kirish" : "Ro‘yxatdan o‘tish"}
                trailingIcon={ArrowRight}
                loading={loading}
                onPress={() => void submit()}
              />
              <Pressable
                onPress={() => setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"))}
                style={styles.switch}
              >
                <Text style={styles.switchText}>
                  {mode === "sign-in" ? "Hisobingiz yo‘qmi? Ro‘yxatdan o‘ting" : "Hisobingiz bormi? Kirish"}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setEmailOpen(true)}
              style={({ pressed }) => [styles.emailButton, pressed && styles.pressed]}
            >
              <Text style={styles.emailButtonText}>Email bilan davom etish</Text>
            </Pressable>
          )}

          <Text style={styles.legal}>
            Davom etish orqali foydalanish shartlariga rozilik bildirasiz.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 64,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },

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
