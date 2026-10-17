import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MonitorSmartphone, ShieldAlert } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { Rise, SuccessMark } from "@/components/SuccessMoment";
import { asFunctionErrorMessage } from "@/lib/format";
import { approveWebLogin, inspectWebLogin, webLoginToken, type WebRequest } from "@/lib/webLogin";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Letting a browser in.
 *
 * Opened by the scanner or straight from the phone's camera (the code is a
 * `jaxongirman://web-login/…` link). It says which browser is asking and how
 * long the code has left, warns about the one way this is abused — somebody
 * sending a code and asking for it to be scanned — and lets the browser in
 * only on an explicit tap.
 */
export default function WebLoginConfirmScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["profile", "common"]);
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = webLoginToken(typeof params.token === "string" ? params.token : "");
  const [request, setRequest] = useState<WebRequest | null>(null);
  const [error, setError] = useState<string | null>(token ? null : t("webLogin.notOurs"));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!token) return;
    let alive = true;
    inspectWebLogin(token)
      .then((answer) => { if (alive) setRequest(answer); })
      .catch(async (failure) => { if (alive) setError(await asFunctionErrorMessage(failure)); });
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    if (!request || done) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [done, request]);

  const seconds = request ? Math.max(0, Math.round((new Date(request.expiresAt).getTime() - now) / 1000)) : 0;
  const expired = Boolean(request) && seconds === 0 && !done;

  async function approve() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await approveWebLogin(token);
      setDone(true);
    } catch (failure) {
      setError(await asFunctionErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t("webLogin.title")} variant="close" onLeave={() => router.replace("/(app)/(tabs)/profile")} />
        <View style={styles.doneWrap}>
          <SuccessMark kind="done" />
          <Rise order={0} style={styles.doneLines}>
            <Text style={styles.doneTitle}>{t("webLogin.doneTitle")}</Text>
            <Text style={styles.doneBody}>{t("webLogin.doneBody")}</Text>
          </Rise>
          <Rise order={1} style={styles.actions}>
            <PrimaryButton label={t("webLogin.close")} onPress={() => router.replace("/(app)/(tabs)/profile")} />
          </Rise>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t("webLogin.confirmTitle")} variant="close" onLeave={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!request && !error ? (
          <View style={styles.checking}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.checkingText}>{t("webLogin.checking")}</Text>
          </View>
        ) : null}

        {request ? (
          <>
            <Text style={styles.lead}>{t("webLogin.confirmLead")}</Text>
            <View style={styles.browser}>
              <View style={styles.browserIcon}><MonitorSmartphone color={colors.primary} size={26} strokeWidth={2} /></View>
              <View style={styles.browserCopy}>
                <Text style={styles.browserName}>{request.browser ?? t("webLogin.unknownBrowser")}</Text>
                <Text style={[styles.browserTime, expired && styles.expired]}>
                  {expired ? t("webLogin.expired") : t("webLogin.expiresIn", { seconds })}
                </Text>
              </View>
            </View>
            <View style={styles.warning}>
              <ShieldAlert color={colors.warning} size={20} strokeWidth={2} />
              <Text style={styles.warningText}>{t("webLogin.warning")}</Text>
            </View>
          </>
        ) : null}

        {error ? <InlineError message={error} /> : null}

        <View style={styles.actions}>
          {request && !expired && !error ? (
            <PrimaryButton label={t("webLogin.approve")} loading={busy} onPress={() => void approve()} />
          ) : (
            <PrimaryButton label={t("webLogin.scanAgain")} onPress={() => router.replace("/(app)/web-login")} />
          )}
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.cancel}>
            <Text style={styles.cancelText}>{t("webLogin.cancel")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  checking: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl },
  checkingText: { ...typography.caption, color: colors.inkMuted },
  lead: { ...typography.body, color: colors.inkMuted },
  browser: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg,
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  browserIcon: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  browserCopy: { flex: 1, gap: 4 },
  browserName: { ...typography.heading, color: colors.ink },
  browserTime: { ...typography.caption, color: colors.inkMuted, fontVariant: ["tabular-nums"] },
  expired: { color: colors.danger },
  warning: {
    flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.warningBorder,
  },
  warningText: { ...typography.caption, color: colors.ink, flex: 1, lineHeight: 18 },
  actions: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.sm },
  cancel: { alignItems: "center", paddingVertical: spacing.sm },
  cancelText: { ...typography.bodyMedium, color: colors.inkSoft },
  doneWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  doneLines: { alignItems: "center", gap: spacing.sm, marginTop: -spacing.lg },
  doneTitle: { ...typography.title, color: colors.ink, textAlign: "center" },
  doneBody: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
}));
