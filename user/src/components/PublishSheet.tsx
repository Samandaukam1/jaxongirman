import { useRouter } from "expo-router";
import { CheckCircle2, Clock3, ShieldCheck, Store, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { captureRef } from "react-native-view-shot";

import { FormField } from "@/components/FormField";
import { PrimaryButton } from "@/components/PrimaryButton";
import { MODEL_HEIGHT, MODEL_WIDTH, SlideCanvas } from "@/components/SlideCanvas";
import type { Deck } from "@/lib/deck";
import { asFunctionErrorMessage } from "@/lib/format";
import { formatNumber } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Reason = { code: string; message: string; product_id?: string };
type Check = {
  can_publish: boolean;
  auto: boolean;
  blocking: Reason[];
  review: Reason[];
  defaults: { title: string; description: string; pages: number; min_price: number; max_price: number };
};
type Draft = { product_id: string | null; check: Check };
type Result = { status: string; auto: boolean };

/** The first slides become the listing's cover and previews. */
const SHOTS = 3;
const THUMB = 92;

/**
 * Sotuvga chiqarish — a deck made here, for sale, in a few taps.
 *
 * The server opens the draft and says up front what will happen: live at
 * once, or after a moderator looks (and why). The person checks the title,
 * sets a price and confirms the right to sell; the cover and previews are
 * drawn from the deck's own first slides here, and the file the buyer gets is
 * made by the server from the slides. Nothing is uploaded by hand.
 */
export function PublishSheet({ visible, deck, onClose }: { visible: boolean; deck: Deck; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t, i18n } = useTranslation(["market", "common"]);
  const router = useRouter();
  const { user } = useAuth();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [rights, setRights] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const canvases = useRef<(View | null)[]>([]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    setError(null);
    setResult(null);
    void (async () => {
      const { data, error: draftError } = await supabase.rpc("marketplace_fast_draft", { p_presentation_id: deck.presentation.id });
      if (!active) return;
      if (draftError) {
        setError(await asFunctionErrorMessage(draftError));
      } else {
        const next = data as unknown as Draft;
        setDraft(next);
        setTitle(next.check.defaults.title);
        setDescription(next.check.defaults.description);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [deck.presentation.id, visible]);

  const check = draft?.check;
  const min = check?.defaults.min_price ?? 1000;
  const max = check?.defaults.max_price ?? 500000;
  const priceValue = Number(price.replace(/\D/g, ""));
  const priceValid = Number.isInteger(priceValue) && priceValue >= min && priceValue <= max;
  const slides = deck.slides.slice(0, SHOTS);

  /** Draws each of the first slides to a JPEG and puts it in the listing's folder. */
  async function uploadShots(productId: string): Promise<string[]> {
    if (!user) return [];
    const paths: string[] = [];
    for (let index = 0; index < slides.length; index += 1) {
      const view = canvases.current[index];
      if (!view) continue;
      const uri = await captureRef(view, { format: "jpg", quality: 0.86, width: 1280, height: 720, result: "tmpfile" });
      const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
      const path = `${user.id}/${productId}/${index === 0 ? "cover" : `preview-${index}`}.jpg`;
      const { error: uploadError } = await supabase.storage.from("marketplace-previews")
        .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
      if (uploadError) throw uploadError;
      paths.push(path);
    }
    return paths;
  }

  async function publish() {
    if (!draft?.product_id || !check?.can_publish) return;
    setPublishing(true);
    setError(null);
    try {
      const [cover, ...previews] = await uploadShots(draft.product_id);
      const { data, error: publishError } = await supabase.functions.invoke("marketplace-publish", {
        body: {
          productId: draft.product_id,
          title: title.trim(),
          price: priceValue,
          description: description.trim(),
          rightsConfirmed: rights,
          coverPath: cover ?? null,
          previewPaths: cover ? [cover, ...previews] : previews,
        },
      });
      if (publishError) throw publishError;
      setResult(data as Result);
    } catch (failure) {
      setError(await asFunctionErrorMessage(failure));
    } finally {
      setPublishing(false);
    }
  }

  const existing = check?.blocking.find((reason) => reason.code === "already_listed");

  /** A reason said in the app's language when this build knows its code, otherwise as the server wrote it. */
  function reasonText(reason: { code: string; message: string }): string {
    return i18n.exists(`market:publish.reason.${reason.code}`) ? t(`publish.reason.${reason.code as "disabled"}`) : reason.message;
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheet}>
        <View style={styles.head}>
          <Store color={colors.primary} size={20} strokeWidth={2.1} />
          <Text style={styles.headTitle}>{t("publish.title")}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common:close")} onPress={onClose} hitSlop={10}>
            <X color={colors.ink} size={22} strokeWidth={2} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {loading ? <ActivityIndicator color={colors.primary} style={styles.loading} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {result ? (
            <View style={styles.done}>
              {result.auto ? <CheckCircle2 color={colors.success} size={40} strokeWidth={2} /> : <Clock3 color={colors.warning} size={40} strokeWidth={2} />}
              <Text style={styles.doneTitle}>{result.auto ? t("publish.live") : t("publish.review")}</Text>
              <Text style={styles.doneBody}>
                {result.auto ? t("publish.liveBody") : t("publish.reviewBody")}
              </Text>
              <PrimaryButton label={t("publish.toMine")} onPress={() => { onClose(); router.push("/(app)/marketplace/seller"); }} />
            </View>
          ) : null}

          {!result && check && !check.can_publish ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>{t("publish.blocked")}</Text>
              {check.blocking.map((reason) => <Text key={reason.code} style={styles.noticeBody}>• {reasonText(reason)}</Text>)}
              {existing ? (
                <Pressable accessibilityRole="button" onPress={() => { onClose(); router.push("/(app)/marketplace/seller"); }}>
                  <Text style={styles.link}>{t("publish.seeListing")}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {!result && check?.can_publish ? (
            <>
              <View style={[styles.verdict, check.auto ? styles.verdictAuto : styles.verdictReview]}>
                {check.auto ? <ShieldCheck color={colors.success} size={20} strokeWidth={2.1} /> : <Clock3 color={colors.warning} size={20} strokeWidth={2.1} />}
                <View style={styles.verdictCopy}>
                  <Text style={styles.verdictTitle}>{check.auto ? t("publish.auto") : t("publish.manual")}</Text>
                  {check.auto ? (
                    <Text style={styles.verdictBody}>{t("publish.autoBody")}</Text>
                  ) : check.review.map((reason) => <Text key={reason.code} style={styles.verdictBody}>• {reasonText(reason)}</Text>)}
                </View>
              </View>

              <Text style={styles.label}>{t("publish.images")}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
                {slides.map((slide, index) => (
                  <View key={slide.id} style={styles.thumb}>
                    <View pointerEvents="none" style={{ width: MODEL_WIDTH, height: MODEL_HEIGHT, transform: [{ scale: (THUMB * 16 / 9) / MODEL_WIDTH }], transformOrigin: "top left" }}>
                      <SlideCanvas
                        ref={(view) => { canvases.current[index] = view; }}
                        slide={slide}
                        elements={deck.elements.filter((element) => element.slide_id === slide.id)}
                      />
                    </View>
                  </View>
                ))}
              </ScrollView>

              <FormField label={t("publish.heading")} value={title} onChangeText={setTitle} maxLength={160} />
              <View style={styles.group}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>{t("publish.price")}</Text>
                  <Text style={styles.hint}>{t("publish.range", { min: formatNumber(min), max: formatNumber(max) })}</Text>
                </View>
                <View style={[styles.priceBox, price !== "" && !priceValid && styles.priceInvalid]}>
                  <TextInput value={price} onChangeText={(value) => setPrice(value.replace(/\D/g, "").slice(0, 7))}
                    placeholder={t("publish.pricePlaceholder")} placeholderTextColor={colors.inkSoft} keyboardType="number-pad" style={styles.priceInput} />
                  <Text style={styles.currency}>{t("publish.currency")}</Text>
                </View>
              </View>
              <FormField label={t("publish.description")} hint={t("common:optional")} value={description} onChangeText={setDescription} multiline maxLength={4000} />

              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: rights }} onPress={() => setRights((value) => !value)} style={styles.rights}>
                <View style={[styles.box, rights && styles.boxOn]}>{rights ? <CheckCircle2 color={colors.onPrimary} size={14} strokeWidth={3} /> : null}</View>
                <Text style={styles.rightsText}>{t("publish.rights")}</Text>
              </Pressable>

              <PrimaryButton
                label={publishing ? t("publish.publishing") : t("publish.title")}
                icon={Store}
                loading={publishing}
                disabled={!rights || !priceValid || title.trim().length < 3}
                onPress={() => void publish()}
              />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  sheet: { flex: 1, backgroundColor: colors.canvas },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.xl, paddingBottom: spacing.md },
  headTitle: { ...typography.heading, flex: 1, color: colors.ink, fontSize: 19 },
  body: { paddingHorizontal: spacing.xl, paddingBottom: 48, gap: spacing.lg },
  loading: { marginTop: spacing.xxl },
  error: { ...typography.caption, color: colors.danger, lineHeight: 18 },
  notice: { gap: 6, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  noticeTitle: { ...typography.bodyMedium, color: colors.ink },
  noticeBody: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
  link: { ...typography.bodyMedium, color: colors.primary, marginTop: spacing.xs },
  verdict: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1 },
  verdictAuto: { backgroundColor: colors.successSoft, borderColor: colors.successBorder },
  verdictReview: { backgroundColor: colors.warningSoft, borderColor: colors.warningBorder },
  verdictCopy: { flex: 1, gap: 3 },
  verdictTitle: { ...typography.bodyMedium, color: colors.ink },
  verdictBody: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
  label: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  hint: { ...typography.caption, color: colors.inkSoft },
  group: { gap: spacing.sm },
  thumbs: { gap: spacing.sm },
  thumb: { width: THUMB * 16 / 9, height: THUMB, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  priceBox: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  priceInvalid: { borderColor: colors.danger },
  priceInput: { ...typography.heading, flex: 1, color: colors.ink, paddingVertical: spacing.md },
  currency: { ...typography.bodyMedium, color: colors.inkSoft },
  rights: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", marginTop: 1 },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  rightsText: { ...typography.caption, flex: 1, color: colors.ink, lineHeight: 19, fontSize: 13.5 },
  done: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxl },
  doneTitle: { ...typography.heading, color: colors.ink },
  doneBody: { ...typography.caption, color: colors.inkMuted, textAlign: "center", lineHeight: 19 },
}));
