import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronDown, ImagePlus, Send, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FormField } from "@/components/FormField";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { asErrorMessage } from "@/lib/format";
import { SUPPORT_CATEGORIES, createTicket, uploadSupportImage, type SupportCategory } from "@/lib/support";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

const MAX_SHOTS = 3;

type Picked = { uri: string; asset: ImagePicker.ImagePickerAsset };
type DeckOption = { id: string; title: string };

/**
 * A new question for the support staff.
 *
 * Only what the desk needs: what it is about, a subject, what happened.
 * Anything that identifies the order, payment or deck is optional and can be
 * passed in by the screen that sent the person here; screenshots are the
 * person's own and go to a private bucket.
 */
export default function NewTicketScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["support", "common"]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ category?: string; presentationId?: string; orderNumber?: string }>();

  const initialCategory = SUPPORT_CATEGORIES.some((item) => item.key === params.category) ? (params.category as SupportCategory) : null;
  const [category, setCategory] = useState<SupportCategory | null>(initialCategory);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [orderNumber, setOrderNumber] = useState(params.orderNumber ?? "");
  const [transactionRef, setTransactionRef] = useState("");
  const [presentationId, setPresentationId] = useState<string | null>(params.presentationId ?? null);
  const [decks, setDecks] = useState<DeckOption[]>([]);
  const [showDetails, setShowDetails] = useState(Boolean(params.presentationId || params.orderNumber));
  const [shots, setShots] = useState<Picked[]>([]);
  const [sending, setSending] = useState(false);

  // The person's recent decks, so naming one is a tap rather than an id.
  useEffect(() => {
    if (!user) return;
    void supabase.from("presentations").select("id, title").eq("owner_id", user.id)
      .order("created_at", { ascending: false }).limit(10)
      .then(({ data }) => setDecks((data ?? []) as DeckOption[]));
  }, [user]);

  async function pickShot() {
    if (shots.length >= MAX_SHOTS) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsMultipleSelection: true, selectionLimit: MAX_SHOTS - shots.length });
    if (result.canceled) return;
    setShots((current) => [...current, ...result.assets.map((asset) => ({ uri: asset.uri, asset }))].slice(0, MAX_SHOTS));
  }

  async function send() {
    if (!user) return;
    if (!category) { Alert.alert(t("form.kindTitle"), t("form.kindBody")); return; }
    if (subject.trim().length < 3) { Alert.alert(t("form.subjectTitle"), t("form.subjectBody")); return; }
    if (body.trim().length < 1) { Alert.alert(t("form.bodyTitle"), t("form.bodyBody")); return; }
    setSending(true);
    try {
      const paths: string[] = [];
      for (const shot of shots) paths.push(await uploadSupportImage(user.id, shot.asset));
      const ticket = await createTicket({
        category, subject, body,
        orderNumber: orderNumber || undefined,
        transactionRef: transactionRef || undefined,
        presentationId: presentationId ?? undefined,
        attachments: paths,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: "/(app)/support/[id]", params: { id: ticket.id } });
    } catch (failure) {
      Alert.alert(t("form.failed"), asErrorMessage(failure));
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <ScreenHeader title={t("newTicket")} subtitle={t("form.subtitle")} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.group}>
          <Text style={styles.label}>{t("form.kind")}</Text>
          <View style={styles.chips}>
            {SUPPORT_CATEGORIES.map((item) => {
              const selected = category === item.key;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => { setCategory(item.key); void Haptics.selectionAsync(); }}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{t(`category.${item.key}`)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <FormField label={t("form.subject")} placeholder={t("form.subjectPlaceholder")} value={subject} onChangeText={setSubject} maxLength={140} />
        <FormField label={t("form.body")} placeholder={t("form.bodyPlaceholder")} value={body} onChangeText={setBody} multiline maxLength={5000} />

        <View style={styles.group}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>{t("form.shots")}</Text>
            <Text style={styles.hint}>{t("form.shotsHint", { count: shots.length, max: MAX_SHOTS })}</Text>
          </View>
          <View style={styles.shots}>
            {shots.map((shot, index) => (
              <View key={shot.uri} style={styles.shot}>
                <Image source={{ uri: shot.uri }} style={styles.shotImage} />
                <Pressable accessibilityRole="button" accessibilityLabel={t("form.removeShot")} hitSlop={8}
                  onPress={() => setShots((current) => current.filter((_, at) => at !== index))} style={styles.shotRemove}>
                  <X color="#FFFFFF" size={14} strokeWidth={2.6} />
                </Pressable>
              </View>
            ))}
            {shots.length < MAX_SHOTS ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t("form.addShot")} onPress={() => void pickShot()} style={styles.addShot}>
                <ImagePlus color={colors.primary} size={22} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDetails }} onPress={() => setShowDetails((value) => !value)} style={styles.detailsToggle}>
          <Text style={styles.detailsToggleText}>{t("form.more")}</Text>
          <ChevronDown color={colors.inkSoft} size={18} strokeWidth={2} style={showDetails ? styles.flip : undefined} />
        </Pressable>
        {showDetails ? (
          <View style={styles.details}>
            <FormField label={t("form.order")} hint={t("form.orderHint")} placeholder={t("form.orderPlaceholder")} value={orderNumber} onChangeText={setOrderNumber} autoCapitalize="characters" />
            <FormField label={t("form.transaction")} placeholder={t("form.transactionPlaceholder")} value={transactionRef} onChangeText={setTransactionRef} maxLength={120} />
            {decks.length > 0 ? (
              <View style={styles.group}>
                <Text style={styles.label}>{t("form.deck")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.deckRow}>
                  {decks.map((deck) => {
                    const selected = presentationId === deck.id;
                    return (
                      <Pressable key={deck.id} accessibilityRole="radio" accessibilityState={{ selected }}
                        onPress={() => setPresentationId(selected ? null : deck.id)} style={[styles.chip, styles.deckChip, selected && styles.chipSelected]}>
                        <Text numberOfLines={1} style={[styles.chipText, selected && styles.chipTextSelected]}>{deck.title}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <PrimaryButton label={sending ? t("form.sending") : t("common:send")} icon={Send} loading={sending} onPress={() => void send()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 32, gap: spacing.lg },
  group: { gap: spacing.sm },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  label: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  hint: { ...typography.caption, color: colors.inkSoft },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { ...typography.caption, fontSize: 13, color: colors.ink },
  chipTextSelected: { color: colors.primaryDeep, fontFamily: "Manrope_700Bold" },
  shots: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  shot: { width: 84, height: 84, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceMuted },
  shotImage: { width: "100%", height: "100%" },
  shotRemove: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
  addShot: { width: 84, height: 84, borderRadius: radius.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  detailsToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm },
  detailsToggleText: { ...typography.bodyMedium, color: colors.inkMuted, fontSize: 14 },
  flip: { transform: [{ rotate: "180deg" }] },
  details: { gap: spacing.lg },
  deckRow: { gap: spacing.sm, paddingRight: spacing.sm },
  deckChip: { maxWidth: 220 },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.canvas },
}));
