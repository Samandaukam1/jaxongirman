import { useRouter } from "expo-router";
import { MonitorPlay, Smartphone, VenetianMask } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandSurface } from "@/components/BrandSurface";
import { MafiaRoleGallery } from "@/components/Mafia";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { createSession, mafiaGame } from "@/lib/games";
import { brandInk, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/**
 * Where Mafia starts: what it is, the seven cards, and the two ways to run
 * it — from this phone alone, or with a board the room can see.
 */
export default function MafiaScreen() {
  const styles = useStyles();
  const { t, i18n } = useTranslation("games");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<"phone" | "board" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(how: "phone" | "board") {
    setBusy(how);
    setError(null);
    try {
      const gameId = await mafiaGame(i18n.language);
      if (how === "board") {
        router.push({ pathname: "/(app)/oyingoh/scan", params: { gameId } });
      } else {
        const session = await createSession(gameId);
        router.push({ pathname: "/(app)/oyingoh/host/[sessionId]", params: { sessionId: session.session_id } });
      }
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("mafia.title")} onLeave={() => router.back()} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxxl }]} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(420)}>
          <BrandSurface radius={radius.xl} style={styles.hero}>
            <View style={styles.heroIcon}>
              <VenetianMask color={brandInk.strong} size={40} strokeWidth={1.6} />
            </View>
            <Text style={styles.heroTitle}>{t("mafia.title")}</Text>
            <Text style={styles.heroText}>{t("mafia.intro")}</Text>
            <View style={styles.steps}>
              {(["join", "deal", "play"] as const).map((step, index) => (
                <View key={step} style={styles.step}>
                  <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
                  <Text style={styles.stepText}>{t(`mafia.steps.${step}`)}</Text>
                </View>
              ))}
            </View>
          </BrandSurface>
        </Animated.View>

        <View style={styles.actions}>
          <PrimaryButton label={t("mafia.startPhone")} icon={Smartphone} loading={busy === "phone"} disabled={busy !== null} onPress={() => void start("phone")} />
          <PrimaryButton label={t("mafia.startBoard")} icon={MonitorPlay} tone="secondary" loading={busy === "board"} disabled={busy !== null} onPress={() => void start("board")} />
          <Text style={styles.hint}>{t("mafia.startBoardHint")}</Text>
          {error ? <InlineError message={error} /> : null}
        </View>

        <Text style={styles.section}>{t("mafia.setup")}</Text>
        <MafiaRoleGallery />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.xl, gap: spacing.lg },
  hero: { padding: spacing.xl, gap: spacing.sm },
  heroIcon: {
    width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs,
    backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.28)",
  },
  heroTitle: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 30, lineHeight: 36, color: brandInk.strong },
  heroText: { fontFamily: "JaxongirmanSans_500Medium", fontSize: 15, lineHeight: 22, color: brandInk.muted },
  steps: { gap: spacing.sm, marginTop: spacing.sm },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)" },
  stepNumberText: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 13, color: brandInk.strong },
  stepText: { flex: 1, fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 14, lineHeight: 19, color: brandInk.strong },
  actions: { gap: spacing.sm },
  hint: { ...typography.caption, color: colors.inkMuted, textAlign: "center" },
  section: { ...typography.heading, color: colors.ink, marginTop: spacing.sm },
}));
