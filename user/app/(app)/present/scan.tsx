import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Camera, ScanLine } from "lucide-react-native";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { lockedOnWeb } from "@/components/WebLocked";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** Pulls the token out of `jaxongirman://pair/<token>`, or accepts a bare token. */
function extractToken(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/pair\/([A-Za-z0-9_-]{32,64})$/);
  if (match?.[1]) return match[1];
  return /^[A-Za-z0-9_-]{32,64}$/.test(trimmed) ? trimmed : null;
}

/**
 * Scanning the code on the projector.
 *
 * The camera is only ever a way of reading a short-lived string; the claim that
 * follows is what actually binds the session to this account, and the server
 * refuses a code that has already been used or has rotated away.
 */
function ScanScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["present", "common"]);
  const router = useRouter();
  // Opened from a finished deck, the scan puts that deck on the screen at once.
  const params = useLocalSearchParams<{ presentationId?: string }>();
  const deckId = (Array.isArray(params.presentationId) ? params.presentationId[0] : params.presentationId) || null;
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The camera fires continuously; one scan is one claim.
  const claimed = useRef(false);
  // A rotated code stays on screen until the projector redraws it, and the
  // camera keeps reading it the whole time. Remembering the one that just
  // failed is what stops that from becoming a request per frame.
  const refused = useRef<string | null>(null);

  async function claim(token: string) {
    if (claimed.current || refused.current === token) return;
    claimed.current = true;
    setBusy(true);
    setError(null);
    const { data, error: claimError } = await supabase.rpc("presentation_pairing_claim", {
      p_token: token,
      // Null rather than omitted: this parameter happens to have a default
      // today, and a call that only works because of that is one schema
      // change away from failing with "function not found".
      p_presentation_id: deckId as unknown as string,
    });
    setBusy(false);
    if (claimError) {
      setError(asErrorMessage(claimError));
      // A rotated code is the common case, so let them try the next one — just
      // not this one again.
      refused.current = token;
      claimed.current = false;
      return;
    }
    const result = data as unknown as { session_id: string; realtime_token: string };
    router.replace({
      pathname: "/(app)/present/[sessionId]",
      params: { sessionId: result.session_id, realtimeToken: result.realtime_token },
    });
  }

  if (!permission) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t("scan.title")} variant="close" />
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t("scan.title")} variant="close" />
        <View style={styles.permission}>
          <View style={styles.permissionIcon}><Camera color={colors.primary} size={28} strokeWidth={2} /></View>
          <Text style={styles.permissionTitle}>{t("scan.camera")}</Text>
          <Text style={styles.permissionCopy}>
            {t("scan.cameraBody")}
          </Text>
          <PrimaryButton label={t("scan.allow")} onPress={() => void requestPermission()} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t("scan.scanTitle")} variant="close" />
      <View style={styles.cameraFrame}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            const token = extractToken(data);
            if (token) void claim(token);
          }}
        />
        <View pointerEvents="none" style={styles.reticle}>
          <ScanLine color={colors.onPrimary} size={30} strokeWidth={1.6} />
        </View>
        {busy ? (
          <View style={styles.busy}><ActivityIndicator color={colors.onPrimary} size="large" /></View>
        ) : null}
      </View>

      <View style={styles.footer}>
        {error ? <InlineError message={error} /> : null}
        <Text style={styles.hint}>
          {t("scan.hint")}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text style={styles.cancel}>{t("common:cancel")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  permission: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  permissionIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  permissionTitle: { ...typography.heading, color: colors.ink, marginTop: spacing.sm },
  permissionCopy: { ...typography.body, color: colors.inkMuted, textAlign: "center", lineHeight: 22, marginBottom: spacing.lg },
  cameraFrame: { flex: 1, margin: spacing.xl, borderRadius: radius.xl, overflow: "hidden", backgroundColor: colors.ink },
  reticle: {
    position: "absolute", top: "50%", left: "50%", width: 220, height: 220,
    marginLeft: -110, marginTop: -110, borderRadius: radius.xl,
    borderWidth: 3, borderColor: "rgba(255,255,255,.85)", alignItems: "center", justifyContent: "center",
  },
  busy: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(21,14,36,.55)" },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: 40, gap: spacing.md },
  hint: { ...typography.caption, color: colors.inkMuted, textAlign: "center", lineHeight: 18 },
  cancel: { ...typography.bodyMedium, color: colors.inkSoft, textAlign: "center" },
}));

// Not in a browser yet: see WebLocked.
export default lockedOnWeb(ScanScreen);
