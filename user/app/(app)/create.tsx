import type { PresentationStyle } from "@jaxongirman/types";
import { SLIDE_COUNT_PRESETS, STYLE_LABELS } from "@jaxongirman/types";
import { decode } from "base64-arraybuffer";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { ArrowLeft, ChartColumnBig, Check, ChevronRight, Clock3, Crown, FileText, Paperclip, Palette, Sparkles, Type, X, type LucideIcon } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FormField } from "@/components/FormField";
import { IconChip } from "@/components/IconChip";
import { PalettePicker } from "@/components/PalettePicker";
import { PrimaryButton } from "@/components/PrimaryButton";
import { TemplatePicker } from "@/components/TemplatePicker";
import { loadDesignCatalogue, type PaletteFamilyRow, type SlideTemplateRow } from "@/lib/design";
import { asFunctionErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

type PickedAsset = DocumentPicker.DocumentPickerAsset;

/** Cover, agenda, bibliography and closing are always generated on top. */
const MIN_SLIDE_COUNT = 5;

type StyleDetail = { description: string; icon: LucideIcon; gradient: readonly [string, string]; complexity: string };

/** Each tier gets its own metal: silver → sapphire → amethyst → gold. */
const styleDetails: Record<PresentationStyle, StyleDetail> = {
  simple: { description: "Tipografika, shakllar va professional diagrammalar", icon: Type, gradient: ["#B9B3C9", "#79728F"], complexity: "Tez" },
  good: { description: "Ikonkalar, grafiklar va mavzuga mos rasmlar", icon: ChartColumnBig, gradient: ["#5CB5F0", "#2A6FD4"], complexity: "O‘rtacha" },
  great: { description: "Illyustratsiyalar va kuchli vizual hikoya", icon: Palette, gradient: ["#A46BF5", "#6C34C9"], complexity: "Ko‘proq vaqt" },
  super_professional: { description: "Premium AI vizuallar va editorial kompozitsiya", icon: Crown, gradient: ["#F1CB6E", "#B8862B"], complexity: "Ko‘proq vaqt" },
};

export default function CreatePresentationScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<PresentationStyle>("good");
  const [slideCount, setSlideCount] = useState(10);
  const [customCount, setCustomCount] = useState("");
  const [sources, setSources] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [attachments, setAttachments] = useState<PickedAsset[]>([]);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [templates, setTemplates] = useState<SlideTemplateRow[]>([]);
  const [palettes, setPalettes] = useState<PaletteFamilyRow[]>([]);
  const [templateCode, setTemplateCode] = useState<string | null>(null);
  const [paletteCode, setPaletteCode] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  // The header's back button is the only way out of this screen, so Android's
  // system back must not quietly throw away a half-filled form either.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, []);

  const styleTemplates = useMemo(() => templates.filter((template) => template.style === style), [style, templates]);
  const activePalette = useMemo(() => palettes.find((family) => family.code === paletteCode) ?? palettes[0] ?? null, [paletteCode, palettes]);

  useEffect(() => {
    let active = true;
    void loadDesignCatalogue()
      .then((catalogue) => {
        if (!active) return;
        setTemplates(catalogue.templates);
        setPalettes(catalogue.palettes);
        setPaletteCode((current) => current ?? catalogue.palettes[0]?.code ?? null);
      })
      .catch(() => {
        // A missing catalogue is not fatal: the server falls back to defaults.
      });
    return () => { active = false; };
  }, []);

  // Templates belong to one style, so the choice resets when the style changes.
  useEffect(() => {
    setTemplateCode((current) => (styleTemplates.some((template) => template.code === current) ? current : styleTemplates[0]?.code ?? null));
  }, [styleTemplates]);

  const effectiveCount = useMemo(() => {
    const custom = Number(customCount);
    return customCount && Number.isInteger(custom) ? custom : slideCount;
  }, [customCount, slideCount]);

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      setEstimating(true);
      void Promise.all([
        supabase.rpc("estimate_presentation_credits", { p_style: style, p_slide_count: effectiveCount }),
        user ? supabase.from("credit_wallets").select("balance").eq("user_id", user.id).single() : Promise.resolve({ data: null, error: null }),
      ]).then(([estimateResult, walletResult]) => {
        if (!active) return;
        setEstimate(estimateResult.error ? null : estimateResult.data);
        setEstimateError(estimateResult.error?.message ?? null);
        setBalance(walletResult.data?.balance ?? null);
        setEstimating(false);
      });
    }, 250);
    return () => { active = false; clearTimeout(timeout); };
  }, [effectiveCount, style, user]);

  async function pickFiles() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "image/*"],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (!result.canceled) setAttachments((current) => [...current, ...result.assets].slice(0, 8));
  }

  async function uploadFiles(presentationId: string) {
    if (!user) throw new Error("Kirish talab qilinadi");
    const paths: string[] = [];
    for (const asset of attachments) {
      if ((asset.size ?? 0) > 50 * 1024 * 1024) throw new Error(`${asset.name} 50 MB limitdan katta`);
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
      Alert.alert("Mavzu kerak", "Kamida 3 belgidan iborat mavzu kiriting.");
      return;
    }
    // Four slides are always reserved for the cover, agenda, bibliography and
    // closing, so below five there would be nothing left for the topic itself.
    if (effectiveCount < MIN_SLIDE_COUNT || effectiveCount > 30) {
      Alert.alert("Slayd soni noto‘g‘ri", `${MIN_SLIDE_COUNT} dan 30 gacha slayd tanlang.`);
      return;
    }
    if (estimate !== null && balance !== null && balance < estimate) {
      Alert.alert("Kredit yetarli emas", `Bu taqdimot uchun ${estimate} kredit kerak. Balans: ${balance}.`);
      return;
    }

    const presentationId = Crypto.randomUUID();
    let uploadedPaths: string[] = [];
    setSubmitting(true);
    try {
      uploadedPaths = await uploadFiles(presentationId);
      const sourceList = sources.split(/\n+/).map((item) => item.trim()).filter(Boolean).slice(0, 30);
      const { data, error } = await supabase.functions.invoke("generate-presentation", {
        body: {
          presentationId,
          topic: topic.trim(),
          title: topic.trim(),
          style,
          slideCount: effectiveCount,
          authorName: authorName.trim() || null,
          teacherName: teacherName.trim() || null,
          sources: sourceList,
          uploadPaths: uploadedPaths,
          templateCode,
          paletteCode: activePalette?.code ?? null,
          idempotencyKey: presentationId,
        },
      });
      if (error) throw error;
      if (!data?.jobId) throw new Error("Generation job yaratilmadi");
      router.replace({ pathname: "/(app)/generation/[id]", params: { id: presentationId } });
    } catch (error) {
      if (uploadedPaths.length) await supabase.storage.from("user-uploads").remove(uploadedPaths);
      Alert.alert("Yaratish boshlanmadi", await asFunctionErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
      {/* Presented as a modal, so the notch inset is 0 — fall back to plain spacing. */}
      <View style={[styles.header, { paddingTop: insets.top || spacing.xl }]}>
        <Pressable onPress={() => router.back()} style={styles.back}><ArrowLeft color={colors.ink} size={icon.lg} strokeWidth={icon.stroke} /></Pressable>
        <View style={styles.headerText}><Text style={styles.eyebrow}>YANGI TAQDIMOT</Text><Text style={styles.headerTitle}>Slayd tayyorlash</Text></View>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        <FormField
          label="Mavzu"
          hint="Majburiy"
          placeholder="Masalan: Alisher Navoiy hayoti va ijodi"
          value={topic}
          onChangeText={setTopic}
          multiline
          maxLength={2000}
        />

        <View style={styles.group}>
          <View style={styles.labelRow}><Text style={styles.label}>Material biriktirish</Text><Text style={styles.hint}>PDF, DOCX, TXT, rasm</Text></View>
          <Pressable onPress={() => void pickFiles()} style={styles.upload}>
            <IconChip icon={Paperclip} variant="soft" size="md" />
            <View style={styles.uploadText}><Text style={styles.uploadTitle}>Fayl tanlash</Text><Text style={styles.uploadHint}>8 tagacha, har biri maksimum 50 MB</Text></View>
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
          <Text style={styles.label}>Uslub</Text>
          <View style={styles.stylesGrid}>
            {(Object.keys(styleDetails) as PresentationStyle[]).map((item) => {
              const selected = style === item;
              return (
                <Pressable onPress={() => setStyle(item)} key={item} style={[styles.styleCard, selected && styles.styleCardSelected]}>
                  <IconChip icon={styleDetails[item].icon} gradient={styleDetails[item].gradient} size="md" style={styles.styleSwatch} />
                  {selected ? <View style={styles.styleCheck}><Check color={colors.onPrimary} size={12} strokeWidth={icon.strokeBold} /></View> : null}
                  <Text style={styles.styleTitle}>{STYLE_LABELS[item]}</Text>
                  <Text style={styles.styleDescription}>{styleDetails[item].description}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {styleTemplates.length ? (
          <View style={styles.group}>
            <View style={styles.labelRow}><Text style={styles.label}>Namunaviy dizayn</Text><Text style={styles.hint}>{styleTemplates.length} ta</Text></View>
            <TemplatePicker templates={styleTemplates} palette={activePalette} selected={templateCode} onSelect={setTemplateCode} />
          </View>
        ) : null}

        {palettes.length ? (
          <View style={styles.group}>
            <View style={styles.labelRow}><Text style={styles.label}>Ranglar oilasi</Text><Text style={styles.hint}>{palettes.length} ta</Text></View>
            <PalettePicker palettes={palettes} selected={activePalette?.code ?? null} onSelect={setPaletteCode} />
          </View>
        ) : null}

        <View style={styles.group}>
          <View style={styles.labelRow}><Text style={styles.label}>Slaydlar soni</Text><Text style={styles.hint}>{MIN_SLIDE_COUNT}–30, sarlavha va adabiyotlar bilan</Text></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {SLIDE_COUNT_PRESETS.map((count) => (
              <Pressable key={count} onPress={() => { setSlideCount(count); setCustomCount(""); }} style={[styles.chip, !customCount && slideCount === count && styles.chipSelected]}>
                <Text style={[styles.chipText, !customCount && slideCount === count && styles.chipTextSelected]}>{count}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <TextInput
            value={customCount}
            onChangeText={(value) => setCustomCount(value.replace(/\D/g, "").slice(0, 2))}
            placeholder={`Boshqa son (${MIN_SLIDE_COUNT}–30)`}
            placeholderTextColor={colors.inkSoft}
            keyboardType="number-pad"
            style={styles.customInput}
          />
        </View>

        <FormField label="Foydalanilgan manbalar" hint="Har birini yangi qatordan" placeholder={"Wikipedia\nO‘zbekiston Milliy Ensiklopediyasi\nhttps://..."} value={sources} onChangeText={setSources} multiline />
        <Text style={styles.sourceNotice}>Bu ro‘yxat fakt generatsiyasi uchun avtomatik manba bo‘lmaydi; u taqdimot oxiridagi manbalar slaydiga qo‘shiladi.</Text>
        <FormField label="Kim tomonidan tayyorlandi" hint="Ixtiyoriy" placeholder="Jahongir Qurbonnazarov" value={authorName} onChangeText={setAuthorName} />
        <FormField label="O‘qituvchi" hint="Ixtiyoriy" placeholder="D. Karimova" value={teacherName} onChangeText={setTeacherName} />

        <View style={styles.estimateCard}>
          <View style={styles.estimateTop}><View><Text style={styles.estimateLabel}>Taxminiy xarajat</Text><View style={styles.estimateValueRow}>{estimating ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={styles.estimateValue}>{estimate ?? "—"}</Text>}<Text style={styles.estimateUnit}> kredit</Text></View></View><IconChip icon={Sparkles} variant="brand" size="md" /></View>
          {estimateError ? <Text style={styles.estimateError}>{estimateError}</Text> : null}
          <View style={styles.divider} />
          <View style={styles.estimateMeta}><View><Text style={styles.estimateMetaLabel}>Slaydlar</Text><Text style={styles.estimateMetaValue}>{effectiveCount}</Text></View><View><Text style={styles.estimateMetaLabel}>Murakkablik</Text><Text style={styles.estimateMetaValue}>{styleDetails[style].complexity}</Text></View><View><Text style={styles.estimateMetaLabel}>Balans</Text><Text style={styles.estimateMetaValue}>{balance ?? "—"}</Text></View></View>
        </View>

      </ScrollView>

      {/* Pinned so the primary action is reachable without scrolling to the end. */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <PrimaryButton
          loading={submitting}
          icon={Sparkles}
          trailingIcon={Clock3}
          label={submitting ? "Tayyorlanmoqda…" : "Generatsiyani boshlash"}
          onPress={() => void generate()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1 },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 },
  eyebrow: { ...typography.caption, color: colors.accent, letterSpacing: 1.4 },
  headerTitle: { ...typography.heading, color: colors.ink, marginTop: 2 },
  content: { padding: spacing.xl, gap: spacing.xxl, paddingBottom: spacing.xxl },
  group: { gap: spacing.md },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  label: { ...typography.bodyMedium, color: colors.ink },
  hint: { ...typography.caption, color: colors.inkSoft },
  upload: { minHeight: 76, borderRadius: radius.md, backgroundColor: colors.primarySoft, borderWidth: 1, borderStyle: "dashed", borderColor: colors.accentSoft, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  uploadText: { flex: 1 },
  uploadTitle: { ...typography.bodyMedium, color: colors.ink },
  uploadHint: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  file: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  fileName: { ...typography.caption, color: colors.ink, flex: 1 },
  stylesGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  styleCard: { width: "48%", minHeight: 150, borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  styleCardSelected: { borderColor: colors.primary, borderWidth: 2, padding: spacing.lg - 1, backgroundColor: colors.primarySoft, ...shadow },
  styleSwatch: { marginBottom: spacing.md },
  styleCheck: { position: "absolute", top: spacing.lg, right: spacing.lg, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  styleTitle: { ...typography.bodyMedium, color: colors.ink },
  styleDescription: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xs },
  chips: { gap: spacing.sm },
  chip: { width: 48, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.bodyMedium, color: colors.inkMuted },
  chipTextSelected: { color: colors.surface },
  customInput: { ...typography.body, minHeight: 50, paddingHorizontal: spacing.lg, color: colors.ink, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  sourceNotice: { ...typography.caption, color: colors.inkMuted, marginTop: -spacing.xl },
  estimateCard: { backgroundColor: colors.surface, padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow },
  estimateTop: { flexDirection: "row", justifyContent: "space-between" },
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
});
