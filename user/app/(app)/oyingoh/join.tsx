import { GAME_AVATAR_COUNT, GAME_AVATAR_GROUPS, gameAvatarIds, type GameAvatarGroup } from "@jaxongirman/types";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Camera, Dices, KeyRound, ScanLine } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InteractionManager, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";

import { GameAvatar } from "@/components/GameAvatar";
import { GlassPanel } from "@/components/Glass";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { isTransport } from "@/lib/retry";
import { joinGame, joinGameByCode } from "@/lib/games";
import { useAccount } from "@/providers/AccountProvider";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** `https://…/join/<token>`, or a bare token pasted by hand. */
function extractToken(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/join\/([A-Za-z0-9_-]{32,64})$/);
  if (match?.[1]) return match[1];
  return /^[A-Za-z0-9_-]{32,64}$/.test(trimmed) ? trimmed : null;
}

type Step = "scan" | "identity";

/**
 * Joining a match. Two ways in — the QR on the projector, or the six digits
 * under it — and then one screen for the only two things the room needs to
 * know about you: a face and a name.
 *
 * The avatar grid opens on all forty. The quick picks above it are ways in —
 * a dice for somebody who just wants to play, a few groups for somebody
 * looking for themselves — and none of them is a question to answer.
 */
export default function JoinGameScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["games", "errors"]);
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; code?: string }>();
  const { profile } = useAccount();
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<Step>(params.token || params.code ? "identity" : "scan");
  const [token, setToken] = useState<string | null>(params.token ?? null);
  const [code, setCode] = useState(params.code ?? "");
  const [manualCode, setManualCode] = useState(false);
  const [nickname, setNickname] = useState("");
  const [avatarId, setAvatarId] = useState(() => Math.floor(Math.random() * GAME_AVATAR_COUNT));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<GameAvatarGroup>("all");
  // Forty portraits are a few thousand vector nodes: drawn once the screen
  // has finished arriving, so the transition into it never stutters.
  const [gridReady, setGridReady] = useState(false);
  const claiming = useRef(false);
  const visible = useMemo(() => gameAvatarIds(group), [group]);
  const pop = useSharedValue(1);
  const turn = useSharedValue(0);
  const chosenStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }, { rotate: `${turn.value}deg` }] }));

  useEffect(() => {
    if (step !== "identity" || gridReady) return;
    const task = InteractionManager.runAfterInteractions(() => setGridReady(true));
    return () => task.cancel();
  }, [gridReady, step]);

  const choose = useCallback((id: number) => {
    setAvatarId(id);
    pop.set(withSequence(withTiming(0.9, { duration: 90 }), withSpring(1, { damping: 9, stiffness: 260 })));
    void Haptics.selectionAsync();
  }, [pop]);

  /** A random character from the group in view, never the one already chosen. */
  const roll = useCallback(() => {
    const pool = visible.filter((id) => id !== avatarId);
    const next = pool[Math.floor(Math.random() * pool.length)] ?? avatarId;
    turn.set(withSequence(withTiming(-8, { duration: 80 }), withTiming(8, { duration: 110 }), withSpring(0, { damping: 8 })));
    choose(next);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [avatarId, choose, turn, visible]);

  useEffect(() => {
    if (!nickname && profile?.first_name) setNickname(profile.first_name);
  }, [nickname, profile?.first_name]);

  const onScan = useCallback((value: string) => {
    if (claiming.current) return;
    const scanned = extractToken(value);
    if (!scanned) return;
    claiming.current = true;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setToken(scanned);
    setStep("identity");
  }, []);

  async function join() {
    setBusy(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = token
        ? await joinGame(token, nickname.trim(), avatarId)
        : await joinGameByCode(code, nickname.trim(), avatarId);
      router.replace(`/oyingoh/play/${result.session_id}`);
    } catch (failure) {
      /**
       * The scanned token is kept, so retrying does not mean scanning again.
       *
       * A join that failed on the network is the one case where the person is
       * standing in front of a screen with everybody waiting; making them
       * re-aim a camera is the worst possible answer to a lost packet.
       */
      setError(isTransport(failure) ? t("errors:network") : asErrorMessage(failure));
      setBusy(false);
      claiming.current = false;
    }
  }

  if (step === "scan") {
    return (
      <View style={styles.safe}>
        <ScreenHeader title={t("entry.joinTitle")} subtitle={t("title")} onLeave={() => router.back()} />
        <ScrollView contentContainerStyle={styles.content}>
          {manualCode ? (
            <View style={styles.codeBlock}>
              <KeyRound color={colors.primary} size={36} strokeWidth={icon.stroke} />
              <Text style={styles.blockTitle}>{t("entry.enterCode")}</Text>
              <Text style={styles.blockHint}>{t("entry.codeHint")}</Text>
              <TextInput
                style={styles.codeInput}
                value={code}
                onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
                keyboardType="number-pad"
                placeholder="000000"
                placeholderTextColor={colors.inkSoft}
                maxLength={6}
                autoFocus
              />
              <PrimaryButton
                label={t("entry.continue")}
                disabled={code.length !== 6}
                onPress={() => { setToken(null); setStep("identity"); }}
              />
              <Pressable onPress={() => setManualCode(false)}>
                <Text style={styles.linkText}>{t("entry.backToQr")}</Text>
              </Pressable>
            </View>
          ) : !permission?.granted ? (
            <View style={styles.codeBlock}>
              <Camera color={colors.primary} size={36} strokeWidth={icon.stroke} />
              <Text style={styles.blockTitle}>{t("entry.camera")}</Text>
              <Text style={styles.blockHint}>{t("entry.cameraJoin")}</Text>
              <PrimaryButton label={t("entry.allow")} onPress={() => void requestPermission()} />
              <Pressable onPress={() => setManualCode(true)}>
                <Text style={styles.linkText}>{t("entry.withCode")}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.cameraFrame}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={({ data }) => onScan(data)}
                />
                <View pointerEvents="none" style={styles.reticle}>
                  <ScanLine color={colors.onPrimary} size={40} strokeWidth={icon.stroke} />
                </View>
              </View>
              <Text style={styles.blockHint}>{t("entry.holdQr")}</Text>
              <Pressable onPress={() => setManualCode(true)}>
                <Text style={styles.linkText}>{t("entry.qrBroken")}</Text>
              </Pressable>
            </>
          )}
          {error ? <InlineError message={error} /> : null}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("entry.joinNow")} subtitle={t("title")} onLeave={() => { setStep("scan"); claiming.current = false; }} />
      <View style={{ flex: 1 }}>
        <KeyboardAwareScrollView bottomOffset={spacing.xl} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <GlassPanel radius={radius.xl} padded={false}>
            <View style={styles.chosen}>
              <Animated.View style={[styles.chosenRing, chosenStyle]}>
                <GameAvatar id={avatarId} size={124} />
              </Animated.View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("entry.randomAvatar")}
                onPress={roll}
                style={({ pressed }) => [styles.dice, pressed && styles.pressed]}
              >
                <Dices color={colors.onPrimary} size={18} strokeWidth={2.2} />
                <Text style={styles.diceText}>{t("entry.random")}</Text>
              </Pressable>
            </View>
          </GlassPanel>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groups} keyboardShouldPersistTaps="handled">
            {GAME_AVATAR_GROUPS.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: group === item.key }}
                onPress={() => { setGroup(item.key); void Haptics.selectionAsync(); }}
                style={[styles.group, group === item.key && styles.groupActive]}
              >
                <Text style={[styles.groupText, group === item.key && styles.groupTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.avatarGrid}>
            {gridReady ? visible.map((index) => (
              <Pressable
                key={index}
                style={[styles.avatarCell, avatarId === index && styles.avatarCellActive]}
                onPress={() => choose(index)}
                accessibilityLabel={t("entry.avatar", { number: index + 1 })}
                accessibilityState={{ selected: avatarId === index }}
              >
                <GameAvatar id={index} size={56} />
              </Pressable>
            )) : Array.from({ length: Math.min(visible.length, 15) }, (_, at) => <View key={at} style={styles.avatarPlaceholder} />)}
            {/* Keeps the last row's cells at their own width, not stretched. */}
            {Array.from({ length: 4 }, (_, at) => <View key={`gap${at}`} style={styles.avatarSpacer} />)}
          </View>

          <Text style={styles.label}>{t("entry.name")}</Text>
          <TextInput
            style={styles.nameInput}
            value={nickname}
            onChangeText={setNickname}
            placeholder={t("entry.namePlaceholder")}
            placeholderTextColor={colors.inkSoft}
            maxLength={30}
          />

          {error ? <InlineError message={error} /> : null}

          <PrimaryButton
            label={busy ? t("entry.joining") : t("entry.ready")}
            loading={busy}
            disabled={nickname.trim().length < 1 || busy}
            onPress={() => void join()}
          />
        </KeyboardAwareScrollView>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  cameraFrame: {
    height: 320, borderRadius: radius.xl, overflow: "hidden", backgroundColor: colors.primaryDeep,
  },
  reticle: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  codeBlock: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
  blockTitle: { ...typography.heading, color: colors.ink, textAlign: "center" },
  blockHint: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  codeInput: {
    ...typography.display, color: colors.ink, letterSpacing: 8, textAlign: "center",
    backgroundColor: colors.surfaceMuted, borderRadius: radius.lg,
    paddingVertical: spacing.md, width: "100%",
  },
  linkText: { ...typography.body, color: colors.primary, textAlign: "center" },
  chosen: { alignItems: "center", paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
  chosenRing: { padding: 4, borderRadius: 70, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  dice: {
    flexDirection: "row", alignItems: "center", gap: 6, height: 38, paddingHorizontal: spacing.lg,
    borderRadius: radius.pill, backgroundColor: colors.primary,
  },
  diceText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.onPrimary },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  groups: { gap: spacing.sm, paddingRight: spacing.sm },
  group: {
    height: 34, paddingHorizontal: spacing.md, borderRadius: radius.pill, justifyContent: "center",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  groupActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  groupText: { ...typography.caption, fontFamily: "Manrope_600SemiBold", color: colors.inkMuted },
  groupTextActive: { color: colors.primaryDeep, fontFamily: "Manrope_700Bold" },
  label: { ...typography.bodyMedium, color: colors.ink },
  avatarGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "space-between" },
  avatarCell: {
    borderRadius: 40, padding: 3, borderWidth: 2.5, borderColor: "transparent",
  },
  avatarCellActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  avatarPlaceholder: { width: 67, height: 67, borderRadius: 34, backgroundColor: colors.surfaceMuted },
  avatarSpacer: { width: 67, height: 0 },
  nameInput: {
    ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
}));
