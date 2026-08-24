import { GAME_AVATAR_COUNT } from "@jaxongirman/types";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Camera, KeyRound, ScanLine } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

import { GameAvatar } from "@/components/GameAvatar";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { isTransport, TRANSPORT_MESSAGE } from "@/lib/retry";
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
 * The avatar grid shows all forty at once. Nobody is asked to declare a gender
 * to pick a character.
 */
export default function JoinGameScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
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
  const claiming = useRef(false);

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
      setError(isTransport(failure) ? TRANSPORT_MESSAGE : asErrorMessage(failure));
      setBusy(false);
      claiming.current = false;
    }
  }

  if (step === "scan") {
    return (
      <View style={styles.safe}>
        <ScreenHeader title="O‘yinga qo‘shilish" subtitle="O‘yingoh" onLeave={() => router.back()} />
        <ScrollView contentContainerStyle={styles.content}>
          {manualCode ? (
            <View style={styles.codeBlock}>
              <KeyRound color={colors.primary} size={36} strokeWidth={icon.stroke} />
              <Text style={styles.blockTitle}>Kodni kiriting</Text>
              <Text style={styles.blockHint}>Katta ekranda ko‘rsatilgan 6 xonali kod.</Text>
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
                label="Davom etish"
                disabled={code.length !== 6}
                onPress={() => { setToken(null); setStep("identity"); }}
              />
              <Pressable onPress={() => setManualCode(false)}>
                <Text style={styles.linkText}>QR skanerlashga qaytish</Text>
              </Pressable>
            </View>
          ) : !permission?.granted ? (
            <View style={styles.codeBlock}>
              <Camera color={colors.primary} size={36} strokeWidth={icon.stroke} />
              <Text style={styles.blockTitle}>Kamera ruxsati kerak</Text>
              <Text style={styles.blockHint}>Proyektordagi QR kodni o‘qish uchun kameraga ruxsat bering.</Text>
              <PrimaryButton label="Ruxsat berish" onPress={() => void requestPermission()} />
              <Pressable onPress={() => setManualCode(true)}>
                <Text style={styles.linkText}>Kod bilan qo‘shilish</Text>
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
              <Text style={styles.blockHint}>Katta ekrandagi QR kodni kamera oldiga tuting.</Text>
              <Pressable onPress={() => setManualCode(true)}>
                <Text style={styles.linkText}>QR ishlamayaptimi? Kod bilan qo‘shilish</Text>
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
      <ScreenHeader title="O‘yinga qo‘shiling" subtitle="O‘yingoh" onLeave={() => { setStep("scan"); claiming.current = false; }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.chosenAvatar}>
            <GameAvatar id={avatarId} size={96} />
          </View>

          <Text style={styles.label}>Avatar tanlang</Text>
          <View style={styles.avatarGrid}>
            {Array.from({ length: GAME_AVATAR_COUNT }, (_, index) => (
              <Pressable
                key={index}
                style={[styles.avatarCell, avatarId === index && styles.avatarCellActive]}
                onPress={() => { setAvatarId(index); void Haptics.selectionAsync(); }}
                accessibilityLabel={`Avatar ${index + 1}`}
                accessibilityState={{ selected: avatarId === index }}
              >
                <GameAvatar id={index} size={54} />
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Ismingiz</Text>
          <TextInput
            style={styles.nameInput}
            value={nickname}
            onChangeText={setNickname}
            placeholder="O‘yindagi ismingiz"
            placeholderTextColor={colors.inkSoft}
            maxLength={30}
          />

          {error ? <InlineError message={error} /> : null}

          <PrimaryButton
            label={busy ? "O‘yinga ulanmoqda..." : "Tayyorman"}
            loading={busy}
            disabled={nickname.trim().length < 1 || busy}
            onPress={() => void join()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
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
  chosenAvatar: { alignItems: "center" },
  label: { ...typography.bodyMedium, color: colors.ink },
  avatarGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "space-between" },
  avatarCell: {
    borderRadius: radius.md, padding: 3, borderWidth: 2.5, borderColor: "transparent",
  },
  avatarCellActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  nameInput: {
    ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
}));
