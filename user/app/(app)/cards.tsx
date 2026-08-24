import { formatCardPan, formatStoredCardExpiry, type Tables } from "@jaxongirman/types";
import { useFocusEffect } from "expo-router";
import { CreditCard, ShieldCheck, Trash2 } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { formatShortDateTime } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type PartialCard = Tables<"partial_cards">;

/**
 * Chala kartalar.
 *
 * A card here is a record of a payment that happened, not something a person
 * typed in — which is why the only action is removal. Editing the digits would
 * mean the app holds a card number the buyer never re-entered, and a new card
 * simply appears the next time one is used.
 */
export default function CardsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [cards, setCards] = useState<PartialCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const { data, error: requestError } = await supabase
      .from("partial_cards").select("*").eq("is_active", true)
      .order("last_used_at", { ascending: false, nullsFirst: false });
    if (requestError) setError(asErrorMessage(requestError));
    else { setCards(data ?? []); setError(null); }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function remove(card: PartialCard) {
    Alert.alert(
      "Karta o‘chirilsinmi?",
      `${formatCardPan(card.display_pan)} ro‘yxatdan olib tashlanadi. Keyingi to‘lovda kartani qaytadan kiritishingiz mumkin.`,
      [
        { text: "Bekor qilish", style: "cancel" },
        {
          text: "O‘chirish",
          style: "destructive",
          onPress: async () => {
            setBusyId(card.id);
            const { error: deleteError } = await supabase.from("partial_cards").delete().eq("id", card.id);
            setBusyId(null);
            if (deleteError) Alert.alert("O‘chirilmadi", asErrorMessage(deleteError));
            else void load(true);
          },
        },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Chala kartalar" subtitle="To‘lovda ishlatilgan kartalar" />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        <View style={styles.notice}>
          <ShieldCheck color={colors.primary} size={18} strokeWidth={2} />
          <Text style={styles.noticeText}>
            To‘liq karta raqami saqlanmaydi. Faqat boshi va oxiri eslab qolinadi — o‘rtadagi 4 ta raqamni
            har to‘lovda o‘zingiz kiritasiz. CVV va tasdiqlash kodi hech qachon saqlanmaydi.
          </Text>
        </View>

        {loading ? <><SkeletonCard lines={1} /><SkeletonCard lines={1} /></> : null}
        {error && !loading ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {!loading && !error && cards.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="Saqlangan karta yo‘q"
            message="Do‘kondan birinchi xaridni amalga oshirganingizda karta shu yerda niqoblangan ko‘rinishda paydo bo‘ladi."
          />
        ) : null}

        <View style={styles.list}>
          {cards.map((card) => (
            <View key={card.id} style={styles.card}>
              <CreditCard color={colors.primary} size={20} strokeWidth={2} />
              <View style={styles.cardCopy}>
                <Text style={styles.pan}>{formatCardPan(card.display_pan)}</Text>
                <Text style={styles.meta}>
                  {formatStoredCardExpiry(card.expiry_month, card.expiry_year)}
                  {card.last_used_at ? ` · oxirgi: ${formatShortDateTime(card.last_used_at)}` : ""}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kartani o‘chirish"
                disabled={busyId === card.id}
                onPress={() => remove(card)}
                style={styles.remove}
              >
                <Trash2 color={colors.danger} size={16} strokeWidth={2} />
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },
  notice: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  noticeText: { ...typography.caption, color: colors.primaryDeep, flex: 1, lineHeight: 18 },
  list: { gap: spacing.md },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow },
  cardCopy: { flex: 1, gap: 2 },
  pan: { ...typography.bodyMedium, color: colors.ink, fontSize: 15, letterSpacing: 1.2 },
  meta: { ...typography.caption, color: colors.inkSoft },
  remove: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.dangerSoft },
}));
