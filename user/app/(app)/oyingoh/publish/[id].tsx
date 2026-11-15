import { useLocalSearchParams, useRouter } from "expo-router";
import { Store } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { formatShortDateTime } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { loadStorePublish, priceStoreListing, stopStorePublish, type StorePublish } from "@/lib/games";
import { listingPrice } from "@/lib/marketplace";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Where a game stands with the store — the screen the auto-publish notice opens.
 *
 * A new game goes to the store free an hour after it is made. Before then its
 * owner may set a price (which lists it the ordinary way) or stop it; after,
 * they may put a price on the free listing, which sends it to review like any
 * paid listing. A stopped game can still be put in the store by hand.
 */
export default function GamePublishScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("games");
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const gameId = typeof params.id === "string" ? params.id : "";
  const [info, setInfo] = useState<StorePublish | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [priceText, setPriceText] = useState("");

  const load = useCallback(async () => {
    if (!gameId) return;
    try {
      setInfo(await loadStorePublish(gameId));
      setFatal(null);
    } catch (failure) {
      setFatal(asErrorMessage(failure));
    }
  }, [gameId]);

  useEffect(() => { void load(); }, [load]);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await load();
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const sell = () => router.push({ pathname: "/(app)/marketplace/sell", params: { gameId, gameTitle: info?.title ?? "" } });
  const price = Number.parseInt(priceText.replace(/\D/g, ""), 10);
  const listed = info?.product;
  const freeListing = listed && listed.base_price === 0 && listed.status === "approved";

  const status = !info ? ""
    : listed?.status === "pending_review" ? t("publish.review")
    : freeListing ? t("publish.published")
    : listed?.status === "approved" ? t("publish.approved", { price: listingPrice(listed.base_price) })
    : info.state === "pending" && info.publishAt ? t("publish.pending", { time: formatShortDateTime(info.publishAt) })
    : info.state === "stopped" ? t("publish.stopped")
    : t("publish.off");

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t("publish.title")} onLeave={() => router.back()} />
      {fatal ? <ErrorState message={fatal} onRetry={() => void load()} /> : !info ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <View style={styles.badge}><Store color={colors.primary} size={22} strokeWidth={2} /></View>
            <Text style={styles.title}>{info.title}</Text>
            <Text style={styles.status}>{status}</Text>
          </View>
          {info.state !== "off" ? <Text style={styles.explain}>{t("publish.explain")}</Text> : null}

          {error ? <InlineError message={error} /> : null}

          {freeListing ? (
            <>
              <TextInput
                value={priceText}
                onChangeText={(value) => setPriceText(value.replace(/\D/g, "").slice(0, 9))}
                placeholder={t("publish.pricePlaceholder")}
                placeholderTextColor={colors.inkSoft}
                keyboardType="number-pad"
                style={styles.input}
              />
              <PrimaryButton label={t("publish.setPrice")} loading={busy} disabled={!(price > 0) || busy}
                onPress={() => void act(() => priceStoreListing(gameId, price))} />
            </>
          ) : info.state === "pending" && !listed ? (
            <>
              <PrimaryButton label={t("publish.setPrice")} onPress={sell} />
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act(() => stopStorePublish(gameId))} style={styles.secondary}>
                <Text style={styles.secondaryText}>{t("publish.stop")}</Text>
              </Pressable>
            </>
          ) : !listed ? (
            <PrimaryButton label={t("publish.publishNow")} onPress={sell} />
          ) : null}

          {listed && listed.status === "approved" ? (
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/(app)/marketplace/[id]", params: { id: listed.id } })} style={styles.secondary}>
              <Text style={styles.secondaryText}>{t("publish.view")}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, gap: spacing.lg },
  card: { alignItems: "center", gap: spacing.sm, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  badge: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  title: { ...typography.heading, color: colors.ink, textAlign: "center" },
  status: { ...typography.bodyMedium, color: colors.primaryDeep, textAlign: "center" },
  explain: { ...typography.caption, color: colors.inkMuted, textAlign: "center" },
  input: { ...typography.body, color: colors.ink, height: 52, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  secondary: { alignSelf: "center", paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  secondaryText: { ...typography.bodyMedium, color: colors.inkMuted },
}));
