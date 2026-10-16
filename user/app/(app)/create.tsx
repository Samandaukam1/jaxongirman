import type { PresentationStyle } from "@jaxongirman/types";
import { SLIDE_COUNT_PRESETS } from "@jaxongirman/types";
import { decode } from "base64-arraybuffer";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  ArrowLeft, BookMarked, ChevronRight, Clock3, FileText, Gamepad2, ListChecks, Paperclip, Sparkles, WandSparkles, X,
  type LucideIcon,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AUTOMATIC, DesignChooser, designRequestOf, type DesignChoice } from "@/components/DesignChooser";
import { FormField } from "@/components/FormField";
import { IconChip } from "@/components/IconChip";
import { NoteSheet } from "@/components/NoteSheet";
import { PrimaryButton } from "@/components/PrimaryButton";
import { LANGUAGE_NAMES, type AppLanguage } from "@/i18n";
import { asFunctionErrorMessage } from "@/lib/format";
import { hasCyrillic, toLatin } from "@/lib/script";
import { supabase } from "@/lib/supabase";
import { fetchQuote, fetchWallet, quoteSummary, type Quote } from "@/lib/wallet";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { brandInk, gradients, icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type PickedAsset = DocumentPicker.DocumentPickerAsset;

/** Cover, agenda, bibliography and closing are always generated on top. */
const MIN_SLIDE_COUNT = 5;
const MAX_SLIDE_COUNT = 30;
/** A free deck — one made with welcome pages — is at most this long; the server says the same. */
const FREE_DECK_MAX = 10;

/** Lines a person can tap into their requirements instead of typing them, by their key in the `create` table. */
const REQUIREMENT_SUGGESTIONS = ["academic", "simple", "numbers", "points", "local", "dates", "practical", "compare"] as const;

type Allowance = { member: boolean; maxSlides: number | null; remaining: number | null; limit: number | null; period: string | null };

export default function CreatePresentationScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation(["create", "common"]);
  const { language: appLanguage, deckLanguages } = useLanguage();
  const insets = useSafeAreaInsets();
  const [topic, setTopic] = useState("");
  /**
   * The language the slides are written in — the app's own language until the
   * person picks another, and never tied to it: an English interface can make
   * an Uzbek deck.
   */
  const [chosenLanguage, setDeckLanguage] = useState<AppLanguage>(appLanguage);
  // A language the operator has since switched off for decks falls back to Uzbek.
  const deckLanguage: AppLanguage = deckLanguages.includes(chosenLanguage) ? chosenLanguage : "uz";
  /**
   * The tier the deck is billed as. Not a choice any more: every deck gets the
   * same invented design, so the screen takes the first tier the operator has
   * switched on and never asks.
   */
  const [style, setStyle] = useState<PresentationStyle>("super_professional");
  const [slideCount, setSlideCount] = useState(10);
  const [customCount, setCustomCount] = useState("");
  const [sources, setSources] = useState("");
  const [requirements, setRequirements] = useState("");
  const [sheet, setSheet] = useState<"sources" | "requirements" | null>(null);
  const [authorName, setAuthorName] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [attachments, setAttachments] = useState<PickedAsset[]>([]);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  /** The page price, from a server that has it; null on an older one. */
  const [quote, setQuote] = useState<Quote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  /** When on, the finished deck is followed by an AI-written O‘yingoh match. */
  const [withGame, setWithGame] = useState(false);
  /** Automatic unless the author turns it off and picks a style and colour. */
  const [design, setDesign] = useState<DesignChoice>(AUTOMATIC);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("style_configs")
      .select("style,is_active")
      .eq("is_active", true)
      .then(({ data }) => {
        if (cancelled) return;
        const active = (data ?? []).map((row) => row.style as PresentationStyle);
        if (active.length === 0) return;
        setStyle(active.includes("super_professional") ? "super_professional" : active[0]!);
      });
    return () => { cancelled = true; };
  }, []);

  /**
   * What the person's plan allows, said before they choose.
   *
   * A member's slide ceiling and what is left of their allowance used to be
   * discovered as a refusal after pressing the button. Read up front, the
   * presets the plan does not cover are simply not offered.
   */
  useEffect(() => {
    let cancelled = false;
    void Promise.all([supabase.rpc("my_entitlements"), supabase.rpc("my_usage")]).then(([entitlements, usage]) => {
      if (cancelled) return;
      const answer = (entitlements.data ?? {}) as { member?: boolean; features?: Record<string, { limit?: number | null; enabled?: boolean; period?: string }> };
      const quota = ((usage.data ?? []) as { feature?: string; remaining?: number | null; limit?: number | null; period?: string }[])
        .find((entry) => entry.feature === "presentation_weekly");
      const member = Boolean(answer.member);
      const ceiling = member ? answer.features?.presentation_max_slides?.limit ?? null : null;
      setAllowance({
        member,
        maxSlides: ceiling && ceiling > 0 ? ceiling : null,
        remaining: member ? quota?.remaining ?? null : null,
        limit: member ? quota?.limit ?? answer.features?.presentation_weekly?.limit ?? null : null,
        period: member ? quota?.period ?? answer.features?.presentation_weekly?.period ?? "week" : null,
      });
      if (ceiling && ceiling > 0) setSlideCount((current) => Math.min(current, ceiling));
    }).catch(() => { /* the server still enforces the plan */ });
    return () => { cancelled = true; };
  }, []);

  // The header's back button is the only way out of this screen, so Android's
  // system back must not quietly throw away a half-filled form either.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, []);

  /**
   * Welcome pages left. While any are, the deck is a free one, and a free deck
   * is ten pages at most: the longer presets stay on screen, switched off, with
   * the reason under them.
   */
  const [welcomeLeft, setWelcomeLeft] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchWallet().then((wallet) => { if (!cancelled) setWelcomeLeft(wallet?.welcome.remaining ?? 0); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // A weekly-count plan never touches welcome pages.
  const quotaPlan = Boolean(allowance?.member && allowance.limit !== null);
  const freeDeck = !quotaPlan && (welcomeLeft ?? quote?.welcomeRemaining ?? 0) > 0;

  const planMax = allowance?.maxSlides ?? MAX_SLIDE_COUNT;
  const maxSlides = freeDeck ? Math.min(planMax, FREE_DECK_MAX) : planMax;
  const presets = useMemo(() => SLIDE_COUNT_PRESETS.filter((count) => count <= planMax), [planMax]);

  // A longer count chosen before the wallet answered comes down to the free maximum.
  useEffect(() => {
    if (freeDeck && slideCount > FREE_DECK_MAX) setSlideCount(FREE_DECK_MAX);
  }, [freeDeck, slideCount]);

  const effectiveCount = useMemo(() => {
    const custom = Number(customCount);
    return customCount && Number.isInteger(custom) ? custom : slideCount;
  }, [customCount, slideCount]);

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      setEstimating(true);
      void (async () => {
        // The page price first. A server that predates it answers null and
        // the older estimate is read instead; a page count it refuses is said.
        let answer: Quote | null = null;
        try {
          answer = await fetchQuote(effectiveCount);
        } catch (failure) {
          if (!active) return;
          setQuote(null);
          setEstimate(null);
          setEstimateError((failure as { message?: string })?.message ?? t("estimate.failed"));
          setEstimating(false);
          return;
        }
        if (!active) return;
        if (answer) {
          setQuote(answer);
          setWelcomeLeft(answer.welcomeRemaining);
          setEstimate(answer.coins);
          setBalance(answer.balance);
          setEstimateError(null);
          setEstimating(false);
          return;
        }

        setQuote(null);
        const [estimateResult, walletResult] = await Promise.all([
          supabase.rpc("estimate_presentation_credits", { p_style: style, p_slide_count: effectiveCount }),
          user ? supabase.from("credit_wallets").select("balance").eq("user_id", user.id).single() : Promise.resolve({ data: null, error: null }),
        ]);
        if (!active) return;
        setEstimate(estimateResult.error ? null : estimateResult.data);
        setEstimateError(estimateResult.error?.message ?? null);
        setBalance(walletResult.data?.balance ?? null);
        setEstimating(false);
      })();
    }, 250);
    return () => { active = false; clearTimeout(timeout); };
  }, [effectiveCount, style, t, user]);

  const sourceLines = useMemo(() => sources.split(/\n+/).map((item) => item.trim()).filter(Boolean), [sources]);
  const requirementLines = useMemo(() => requirements.split(/\n+/).map((item) => item.trim()).filter(Boolean), [requirements]);
  const suggestions = useMemo(() => REQUIREMENT_SUGGESTIONS.map((key) => t(`suggestions.${key}`)), [t]);
  /** Uzbek decks are written in Latin, so a Cyrillic topic is caught here, before any request. */
  const needsLatin = deckLanguage === "uz" && hasCyrillic(topic);

  async function pickFiles() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "image/*"],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (!result.canceled) setAttachments((current) => [...current, ...result.assets].slice(0, 8));
  }

  async function uploadFiles(presentationId: string) {
    if (!user) throw new Error(t("alert.signIn"));
    const paths: string[] = [];
    for (const asset of attachments) {
      if ((asset.size ?? 0) > 50 * 1024 * 1024) throw new Error(t("attach.tooLarge", { name: asset.name }));
      const extension = asset.name.includes(".") ? `.${asset.name.split(".").pop()?.toLowerCase()}` : "";
      const safeBase = asset.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60) || "source";
      const path = `${user.id}/${presentationId}/${Crypto.randomUUID()}-${safeBase}${extension}`;
      const content = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const { error } = await supabase.storage.from("user-uploads").upload(path, decode(content), {
        contentType: asset.mimeType ?? "application/octet-stream",
        upsert: false,
      });
      if (error) throw error;
      paths.push(path);
    }
    return paths;
  }

  async function generate() {
    if (!user || topic.trim().length < 3) {
      Alert.alert(t("alert.topicTitle"), t("alert.topicBody"));
      return;
    }
    if (needsLatin) {
      Alert.alert(t("latin.title"), t("latin.body"), [
        { text: t("common:cancel"), style: "cancel" },
        { text: t("latin.fix"), onPress: () => setTopic(toLatin(topic)) },
      ]);
      return;
    }
    if (freeDeck && effectiveCount > FREE_DECK_MAX) {
      Alert.alert(t("alert.slidesTitle"), t("slides.freeMax", { max: FREE_DECK_MAX }));
      return;
    }
    if (effectiveCount < MIN_SLIDE_COUNT || effectiveCount > maxSlides) {
      Alert.alert(t("alert.slidesTitle"), t("alert.slidesBody", { min: MIN_SLIDE_COUNT, max: maxSlides }));
      return;
    }
    if (allowance?.member && allowance.remaining === 0) {
      Alert.alert(t("alert.limitTitle"), t("alert.limitBody"));
      return;
    }
    let confirmedCoins: number | null = null;
    if (quote && quote.mode === "credits") {
      if (!quote.sufficient) {
        Alert.alert(
          t("alert.coinsTitle"),
          t("alert.coinsBody", { coins: quote.coins, balance: quote.balance }),
          [
            { text: t("common:cancel"), style: "cancel" },
            { text: t("alert.toShop"), onPress: () => router.push("/(app)/coins/buy") },
          ],
        );
        return;
      }
      // Paid J Tanga are never spent without a yes: the person sees the
      // figure, where the pages come from, and the balance after.
      if (quote.coins > 0) {
        const agreed = await new Promise<boolean>((resolve) => Alert.alert(
          t("alert.spendTitle"),
          t("alert.spendBody", { summary: quoteSummary(quote), balance: quote.balance, after: quote.balance - quote.coins }),
          [
            { text: t("common:cancel"), style: "cancel", onPress: () => resolve(false) },
            { text: t("alert.spendConfirm", { coins: quote.coins }), onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        ));
        if (!agreed) return;
        confirmedCoins = quote.coins;
      }
    } else if (!allowance?.member && estimate !== null && balance !== null && balance < estimate) {
      Alert.alert(t("alert.creditsTitle"), t("alert.creditsBody", { estimate, balance }));
      return;
    }

    const presentationId = Crypto.randomUUID();
    let uploadedPaths: string[] = [];
    setSubmitting(true);
    try {
      uploadedPaths = await uploadFiles(presentationId);
      const { data, error } = await supabase.functions.invoke("generate-presentation", {
        body: {
          presentationId,
          topic: topic.trim(),
          title: topic.trim(),
          style,
          slideCount: effectiveCount,
          authorName: authorName.trim() || null,
          teacherName: teacherName.trim() || null,
          sources: sourceLines.slice(0, 30),
          requirements: requirements.trim() || null,
          design: designRequestOf(design),
          language: deckLanguage,
          uploadPaths: uploadedPaths,
          idempotencyKey: presentationId,
          ...(confirmedCoins !== null ? { confirmedCoins } : {}),
        },
      });
      if (error) throw error;
      if (!data?.jobId) throw new Error(t("alert.noJob"));
      router.replace({
        pathname: "/(app)/generation/[id]",
        params: { id: presentationId, withGame: withGame ? "1" : "0" },
      });
    } catch (error) {
      if (uploadedPaths.length) await supabase.storage.from("user-uploads").remove(uploadedPaths);
      Alert.alert(t("alert.startFailed"), await asFunctionErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  const periodLine = allowance?.period === "month"
    ? t("estimate.periodMonth")
    : allowance?.period === "day" ? t("estimate.periodDay") : t("estimate.periodWeek");

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
      {/* Presented as a modal, so the notch inset is 0 — fall back to plain spacing. */}
      <View style={[styles.header, { paddingTop: insets.top || spacing.xl }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common:back")} onPress={() => router.back()} style={styles.back}>
          <ArrowLeft color={colors.ink} size={icon.lg} strokeWidth={icon.stroke} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>{t("eyebrow")}</Text>
          <Text style={styles.headerTitle}>{t("title")}</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        {/**
          * What the deck will look like, said rather than chosen.
          *
          * There is no design catalogue any more: the look of every deck is
          * invented for its topic during generation. The card says so, so
          * nobody goes looking for a picker that is not there.
          */}
        <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroOrbA} />
          <View style={styles.heroOrbB} />
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(255,255,255,0.26)", "rgba(255,255,255,0)"]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.6, y: 1 }}
            style={[StyleSheet.absoluteFill, styles.heroSheen]}
          />
          <View style={styles.heroBadge}>
            <WandSparkles color={brandInk.strong} size={16} strokeWidth={2.2} />
            <Text style={styles.heroBadgeText}>{t("hero.badge")}</Text>
          </View>
          <Text style={styles.heroTitle}>{t("hero.title")}</Text>
          <Text style={styles.heroBody}>{t("hero.body")}</Text>
        </LinearGradient>

        <FormField
          label={t("topic.label")}
          hint={t("common:required")}
          placeholder={t("topic.placeholder")}
          value={topic}
          onChangeText={setTopic}
          multiline
          maxLength={2000}
          error={needsLatin ? t("latin.body") : undefined}
        />
        {needsLatin ? (
          <Pressable accessibilityRole="button" onPress={() => setTopic(toLatin(topic))} style={({ pressed }) => [styles.latinFix, pressed && styles.pressed]}>
            <Text style={styles.latinFixText}>{t("latin.fix")}</Text>
          </Pressable>
        ) : null}

        {/* Only when there is a choice: a single offered language needs no picker. */}
        {deckLanguages.length > 1 ? (
        <View style={styles.group}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>{t("language.label")}</Text>
            <Text style={styles.hint}>{t("language.hint")}</Text>
          </View>
          <View style={styles.languages} accessibilityRole="radiogroup">
            {deckLanguages.map((code) => {
              const selected = deckLanguage === code;
              return (
                <Pressable
                  key={code}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => { setDeckLanguage(code); void Haptics.selectionAsync(); }}
                  style={[styles.language, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>{LANGUAGE_NAMES[code]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        ) : null}

        {/* Sources and requirements: two buttons, each opening its own sheet. */}
        <View style={styles.group}>
          <Text style={styles.label}>{t("extras")}</Text>
          <View style={styles.extras}>
            <ExtraButton
              icon={BookMarked}
              title={t("sources.title")}
              detail={sourceLines.length ? t("sources.count", { count: sourceLines.length }) : t("notAdded")}
              filled={sourceLines.length > 0}
              onPress={() => setSheet("sources")}
            />
            <ExtraButton
              icon={ListChecks}
              title={t("requirements.title")}
              detail={requirementLines.length ? t("requirements.count", { count: requirementLines.length }) : t("notAdded")}
              filled={requirementLines.length > 0}
              onPress={() => setSheet("requirements")}
            />
          </View>
        </View>

        <View style={styles.group}>
          <View style={styles.labelRow}><Text style={styles.label}>{t("attach.label")}</Text><Text style={styles.hint}>{t("attach.types")}</Text></View>
          <Pressable onPress={() => void pickFiles()} style={styles.upload}>
            <IconChip icon={Paperclip} variant="soft" size="md" />
            <View style={styles.uploadText}><Text style={styles.uploadTitle}>{t("attach.pick")}</Text><Text style={styles.uploadHint}>{t("attach.limit")}</Text></View>
            <ChevronRight color={colors.inkSoft} size={icon.md} strokeWidth={icon.stroke} />
          </Pressable>
          {attachments.map((asset, index) => (
            <View style={styles.file} key={`${asset.uri}-${index}`}>
              <FileText color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} /><Text numberOfLines={1} style={styles.fileName}>{asset.name}</Text>
              <Pressable hitSlop={10} onPress={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X color={colors.inkMuted} size={icon.sm} strokeWidth={icon.stroke} /></Pressable>
            </View>
          ))}
        </View>

        <View style={styles.group}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>{t("slides.label")}</Text>
            <Text style={styles.hint}>{t("slides.hint", { min: MIN_SLIDE_COUNT, max: maxSlides })}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {presets.map((count) => {
              const locked = count > maxSlides;
              const selected = !customCount && slideCount === count;
              return (
                <Pressable
                  key={count}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: locked }}
                  disabled={locked}
                  onPress={() => { setSlideCount(count); setCustomCount(""); void Haptics.selectionAsync(); }}
                  style={[styles.chip, selected && styles.chipSelected, locked && styles.chipLocked]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{count}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {freeDeck ? <Text style={styles.freeNote}>{t("slides.freeMax", { max: FREE_DECK_MAX })}</Text> : null}
          <TextInput
            value={customCount}
            onChangeText={(value) => setCustomCount(value.replace(/\D/g, "").slice(0, 2))}
            placeholder={t("slides.custom", { min: MIN_SLIDE_COUNT, max: maxSlides })}
            placeholderTextColor={colors.inkSoft}
            keyboardType="number-pad"
            style={styles.customInput}
          />
        </View>

        <FormField label={t("author.label")} hint={t("common:optional")} placeholder={t("author.placeholder")} value={authorName} onChangeText={setAuthorName} />
        <FormField label={t("teacher.label")} hint={t("common:optional")} placeholder={t("teacher.placeholder")} value={teacherName} onChangeText={setTeacherName} />

        <DesignChooser value={design} onChange={setDesign} />

        {/* The flagship cross-sell: one switch here is what turns a finished deck
            into a match the room plays. The questions come from the slides, so
            the toggle cannot be offered before there is a deck to read. */}
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: withGame }}
          onPress={() => { setWithGame((value) => !value); void Haptics.selectionAsync(); }}
          style={[styles.gameCard, withGame && styles.gameCardOn]}
        >
          <View style={styles.gameCardHead}>
            <IconChip icon={Gamepad2} variant={withGame ? "brand" : "soft"} size="md" />
            <View style={styles.gameCardCopy}>
              <Text style={styles.gameCardTitle}>{t("game.title")}</Text>
              <Text style={styles.gameCardBody}>{t("game.body")}</Text>
            </View>
          </View>
          <View style={[styles.gameSwitch, withGame && styles.gameSwitchOn]}>
            <Text style={[styles.gameSwitchText, withGame && styles.gameSwitchTextOn]}>
              {withGame ? t("game.on") : t("game.off")}
            </Text>
          </View>
        </Pressable>

        <View style={styles.estimateCard}>
          {quote && quote.mode === "credits" ? (
            <View style={styles.estimateTop}>
              <View style={styles.flex1}>
                <Text style={styles.estimateLabel}>{t("estimate.price")}</Text>
                <View style={styles.estimateValueRow}>
                  {estimating ? <ActivityIndicator color={colors.primary} size="small" /> : (
                    <Text style={styles.estimateValue}>{quote.coins === 0 ? t("common:free") : quote.coins}</Text>
                  )}
                  {quote.coins > 0 ? <Text style={styles.estimateUnit}> J Tanga</Text> : null}
                </View>
                <Text style={styles.estimateMetaLabel}>{quoteSummary(quote)}</Text>
              </View>
              <IconChip icon={Sparkles} variant="brand" size="md" />
            </View>
          ) : allowance?.member ? (
            <View style={styles.estimateTop}>
              <View style={styles.flex1}>
                <Text style={styles.estimateLabel}>{t("estimate.plan")}</Text>
                <View style={styles.estimateValueRow}>
                  <Text style={styles.estimateValue}>{allowance.remaining ?? "∞"}</Text>
                  <Text style={styles.estimateUnit}>{allowance.limit ? t("estimate.leftOf", { limit: allowance.limit }) : t("estimate.left")}</Text>
                </View>
                <Text style={styles.estimateMetaLabel}>{periodLine}</Text>
              </View>
              <IconChip icon={Sparkles} variant="brand" size="md" />
            </View>
          ) : (
            <View style={styles.estimateTop}>
              <View>
                <Text style={styles.estimateLabel}>{t("estimate.approx")}</Text>
                <View style={styles.estimateValueRow}>
                  {estimating ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={styles.estimateValue}>{estimate ?? "—"}</Text>}
                  <Text style={styles.estimateUnit}>{t("estimate.credits")}</Text>
                </View>
              </View>
              <IconChip icon={Sparkles} variant="brand" size="md" />
            </View>
          )}
          {estimateError && !allowance?.member ? <Text style={styles.estimateError}>{estimateError}</Text> : null}
          <View style={styles.divider} />
          <View style={styles.estimateMeta}>
            <View><Text style={styles.estimateMetaLabel}>{t("estimate.pages")}</Text><Text style={styles.estimateMetaValue}>{effectiveCount}</Text></View>
            {quote && quote.mode === "credits" ? (
              <View>
                <Text style={styles.estimateMetaLabel}>{t("estimate.pageCredit")}</Text>
                <Text style={styles.estimateMetaValue}>{quote.welcomeRemaining + quote.purchasedRemaining}</Text>
              </View>
            ) : (
              <View><Text style={styles.estimateMetaLabel}>{t("estimate.design")}</Text><Text style={styles.estimateMetaValue}>{t("estimate.automatic")}</Text></View>
            )}
            <View><Text style={styles.estimateMetaLabel}>{t("estimate.balance")}</Text><Text style={styles.estimateMetaValue}>{balance ?? "—"} J</Text></View>
          </View>
        </View>
      </ScrollView>

      {/* Pinned so the primary action is reachable without scrolling to the end. */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <PrimaryButton
          loading={submitting}
          icon={Sparkles}
          trailingIcon={Clock3}
          label={submitting ? t("submitting") : t("start")}
          onPress={() => void generate()}
        />
      </View>

      <NoteSheet
        visible={sheet === "sources"}
        title={t("sourcesSheet.title")}
        description={t("sourcesSheet.description")}
        placeholder={t("sourcesSheet.placeholder")}
        value={sources}
        maxLength={3000}
        onClose={() => setSheet(null)}
        onSave={setSources}
      />
      <NoteSheet
        visible={sheet === "requirements"}
        title={t("requirementsSheet.title")}
        description={t("requirementsSheet.description")}
        placeholder={t("requirementsSheet.placeholder")}
        value={requirements}
        maxLength={2000}
        suggestions={suggestions}
        onClose={() => setSheet(null)}
        onSave={setRequirements}
      />
    </KeyboardAvoidingView>
  );
}

/** One of the two optional extras: a button that says whether it holds anything. */
function ExtraButton({ icon: Glyph, title, detail, filled, onPress }: { icon: LucideIcon; title: string; detail: string; filled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.extra, filled && styles.extraFilled, pressed && styles.pressed]}>
      <View style={[styles.extraIcon, filled && styles.extraIconFilled]}>
        <Glyph color={filled ? colors.onPrimary : colors.primary} size={18} strokeWidth={2.2} />
      </View>
      <View style={styles.extraCopy}>
        <Text style={styles.extraTitle}>{title}</Text>
        <Text style={[styles.extraDetail, filled && styles.extraDetailFilled]} numberOfLines={1}>{detail}</Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1, backgroundColor: colors.canvas },
  flex1: { flex: 1 },
  scroll: { flex: 1 },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 },
  eyebrow: { ...typography.caption, color: colors.accent, letterSpacing: 1.4 },
  headerTitle: { ...typography.heading, color: colors.ink, marginTop: 2 },
  content: { padding: spacing.xl, gap: spacing.xxl, paddingBottom: spacing.xxl },
  hero: { borderRadius: radius.xl, padding: spacing.xl, gap: spacing.sm, overflow: "hidden", ...shadow },
  heroSheen: { borderRadius: radius.xl },
  heroOrbA: { position: "absolute", width: 180, height: 180, borderRadius: 90, right: -50, top: -60, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.28)" },
  heroOrbB: { position: "absolute", width: 90, height: 90, borderRadius: 45, right: 46, bottom: -38, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" },
  heroBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.16)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  heroBadgeText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: brandInk.strong, letterSpacing: 0.3 },
  heroTitle: { ...typography.heading, color: brandInk.strong, marginTop: spacing.xs },
  heroBody: { ...typography.caption, color: brandInk.muted, lineHeight: 19 },
  group: { gap: spacing.md },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  label: { ...typography.bodyMedium, color: colors.ink },
  hint: { ...typography.caption, color: colors.inkSoft },
  extras: { flexDirection: "row", gap: spacing.md },
  extra: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  extraFilled: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  pressed: { opacity: 0.85 },
  extraIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  extraIconFilled: { backgroundColor: colors.primary },
  extraCopy: { flex: 1, gap: 1 },
  extraTitle: { ...typography.bodyMedium, color: colors.ink },
  extraDetail: { ...typography.caption, color: colors.inkSoft },
  extraDetailFilled: { color: colors.primary },
  upload: { minHeight: 76, borderRadius: radius.md, backgroundColor: colors.primarySoft, borderWidth: 1, borderStyle: "dashed", borderColor: colors.accentSoft, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  uploadText: { flex: 1 },
  uploadTitle: { ...typography.bodyMedium, color: colors.ink },
  uploadHint: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  file: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  fileName: { ...typography.caption, color: colors.ink, flex: 1 },
  chips: { gap: spacing.sm },
  chip: { width: 48, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.bodyMedium, color: colors.inkMuted },
  chipTextSelected: { color: colors.surface },
  chipLocked: { opacity: 0.35 },
  freeNote: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },
  languages: { flexDirection: "row", gap: spacing.sm },
  language: { flex: 1, height: 44, paddingHorizontal: spacing.sm, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  latinFix: { alignSelf: "flex-start", marginTop: -spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  latinFixText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primary },
  customInput: { ...typography.body, minHeight: 50, paddingHorizontal: spacing.lg, color: colors.ink, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  gameCard: {
    backgroundColor: colors.surface, padding: spacing.xl, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border, gap: spacing.lg,
  },
  gameCardOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  gameCardHead: { flexDirection: "row", gap: spacing.md },
  gameCardCopy: { flex: 1, gap: 4 },
  gameCardTitle: { ...typography.heading, color: colors.ink, fontSize: 17 },
  gameCardBody: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
  gameSwitch: {
    alignSelf: "flex-end", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill, backgroundColor: colors.surfaceMuted,
  },
  gameSwitchOn: { backgroundColor: colors.primary },
  gameSwitchText: { ...typography.caption, color: colors.inkMuted, letterSpacing: 1.2 },
  gameSwitchTextOn: { color: colors.onPrimary },
  estimateCard: { backgroundColor: colors.surface, padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow },
  estimateTop: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  estimateLabel: { ...typography.caption, color: colors.inkMuted },
  estimateValueRow: { minHeight: 42, flexDirection: "row", alignItems: "baseline", marginTop: spacing.xs },
  estimateValue: { ...typography.title, color: colors.ink },
  estimateUnit: { ...typography.bodyMedium, color: colors.inkMuted },
  estimateError: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  estimateMeta: { flexDirection: "row", justifyContent: "space-between" },
  estimateMetaLabel: { ...typography.caption, color: colors.inkSoft },
  estimateMetaValue: { ...typography.bodyMedium, color: colors.ink, marginTop: 2 },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, backgroundColor: colors.canvas, borderTopWidth: 1, borderTopColor: colors.border },
}));
