import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Camera, MonitorPlay, ScanLine } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { claimPairing } from "@/lib/games";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * `jaxongirman://game-pair/<token>`, or a bare token.
 *
 * Deliberately its own path rather than the presentation `pair/` one: a phone
 * camera that reads a game code must not be sent to claim a presentation.
 */
function extractToken(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/game-pair\/([A-Za-z0-9_-]{32,64})$/);
  if (match?.[1]) return match[1];
  return /^[A-Za-z0-9_-]{32,64}$/.test(trimmed) ? trimmed : null;
}

/**
 * Becoming the host of a screen.
 *
 * The projector at jaxongirman.uz/oyingoh shows a rotating one-time code; this
 * screen scans it and claims the session, which is the moment the phone becomes
 * the only device that can drive the match. The game itself is chosen next, on
 * the host remote — so a presenter can walk up to a screen and decide what to
 * run afterwards.
 */
export default function HostScanScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claiming = useRef(false);

  const claim = useCallback(async (token: string) => {
    if (claiming.current) return;
    claiming.current = true;
    setBusy(true);
    setError(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const session = await claimPairing(token);
      router.replace({ pathname: "/(app)/oyingoh/host/[sessionId]", params: { sessionId: session.session_id } });
    } catch (failure) {
      setError(asErrorMessage(failure));
      setBusy(false);
      claiming.current = false;
    }
  }, [router]);

  // Arriving from the phone's own camera app, the token is already in hand — so
  // claim it without ever showing the viewfinder.
  const deepLinkToken = typeof params.token === "string" ? extractToken(params.token) : null;
  useEffect(() => {
    if (deepLinkToken) void claim(deepLinkToken);
  }, [claim, deepLinkToken]);

  return (
    <View style={styles.safe}>
      <ScreenHeader title="Mezbon bo‘lish" subtitle="O‘yingoh" onLeave={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        {busy ? (
          <View style={styles.block}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.blockTitle}>Ekranga ulanmoqda…</Text>
          </View>
        ) : !permission?.granted ? (
          <View style={styles.block}>
            <Camera color={colors.primary} size={36} strokeWidth={icon.stroke} />
            <Text style={styles.blockTitle}>Kamera ruxsati kerak</Text>
            <Text style={styles.blockHint}>Katta ekrandagi QR kodni o‘qish uchun kameraga ruxsat bering.</Text>
            <PrimaryButton label="Ruxsat berish" onPress={() => void requestPermission()} />
          </View>
        ) : (
          <>
            <View style={styles.cameraFrame}>
              <CameraView
                style={StyleSheet.absoluteFill}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => {
                  const token = extractToken(data);
                  if (token) void claim(token);
                }}
              />
              <View pointerEvents="none" style={styles.reticle}>
                <ScanLine color={colors.onPrimary} size={40} strokeWidth={icon.stroke} />
              </View>
            </View>

            <View style={styles.steps}>
              <MonitorPlay color={colors.primary} size={icon.lg} strokeWidth={icon.stroke} />
              <Text style={styles.blockHint}>
                Katta ekranda <Text style={styles.strong}>jaxongirman.uz</Text> saytini oching,
                {" "}<Text style={styles.strong}>O‘yingohni ochish</Text> tugmasini bosing va shu yerdagi
                QR kodni skaner qiling. Keyin qaysi o‘yinni o‘tkazishni tanlaysiz.
              </Text>
            </View>

            <Pressable onPress={() => router.replace("/(app)/oyingoh/join")}>
              <Text style={styles.linkText}>Mezbon emasmisiz? O‘yinga qo‘shilish</Text>
            </Pressable>
          </>
        )}
        {error ? <InlineError message={error} /> : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  cameraFrame: { height: 320, borderRadius: radius.xl, overflow: "hidden", backgroundColor: colors.primaryDeep },
  reticle: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  block: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
  blockTitle: { ...typography.heading, color: colors.ink, textAlign: "center" },
  blockHint: { ...typography.body, color: colors.inkMuted, flex: 1, lineHeight: 21 },
  strong: { ...typography.bodyMedium, color: colors.ink },
  steps: {
    flexDirection: "row", gap: spacing.md, alignItems: "flex-start",
    backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: spacing.lg,
  },
  linkText: { ...typography.body, color: colors.primary, textAlign: "center" },
}));
