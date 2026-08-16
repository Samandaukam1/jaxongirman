import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight } from "lucide-react-native";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { FormField } from "@/components/FormField";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Screen } from "@/components/Screen";
import { SocialAuthButtons } from "@/components/SocialAuthButtons";
import { authRedirectTo } from "@/lib/authLinking";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { colors, gradients, radius, shadowLifted, spacing, typography } from "@/theme/tokens";

export default function SignInScreen() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
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
    <Screen scroll contentStyle={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.brandMark}><Text style={styles.brandLetter}>J</Text></LinearGradient>
        <Text style={styles.eyebrow}>JAXONGIR AI</Text>
        <Text style={styles.title}>{mode === "sign-in" ? "Xush kelibsiz" : "Hisob yarating"}</Text>
        <Text style={styles.subtitle}>Bir mavzudan professional taqdimotgacha.</Text>

        {/* Above the form, because it is the faster way in and because a person
            who has an Apple or Google account has one fewer password to invent.
            The form below is untouched — this adds a door, it does not replace
            one. */}
        <SocialAuthButtons />

        <View style={styles.form}>
          {mode === "sign-up" ? (
            <FormField label="Ism va familiya" value={fullName} onChangeText={setFullName} autoComplete="name" />
          ) : null}
          <FormField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <FormField label="Parol" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "sign-in" ? "current-password" : "new-password"} />
          <PrimaryButton label={mode === "sign-in" ? "Kirish" : "Ro‘yxatdan o‘tish"} trailingIcon={ArrowRight} loading={loading} onPress={() => void submit()} />
        </View>
        <Pressable onPress={() => setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"))} style={styles.switch}>
          <Text style={styles.switchText}>{mode === "sign-in" ? "Hisobingiz yo‘qmi? Ro‘yxatdan o‘ting" : "Hisobingiz bormi? Kirish"}</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: "center", paddingTop: 84, paddingBottom: spacing.xxxl },
  brandMark: { width: 56, height: 56, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginBottom: spacing.xl, ...shadowLifted },
  brandLetter: { color: colors.onPrimary, fontFamily: "Manrope_700Bold", fontSize: 28 },
  eyebrow: { ...typography.caption, color: colors.accent, letterSpacing: 2, marginBottom: spacing.md },
  title: { ...typography.display, color: colors.ink },
  subtitle: { ...typography.body, color: colors.inkMuted, marginTop: spacing.sm, marginBottom: spacing.xxl },
  form: { gap: spacing.lg },
  switch: { alignItems: "center", padding: spacing.xl },
  switchText: { ...typography.caption, color: colors.primary },
});
