import type { MarketplaceMaterialType } from "@jaxongirman/types";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BookOpenText, FileUp, Image as ImageIcon, Send, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { PaymentUnavailable } from "@/components/PaymentUnavailable";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { useMaterialTypes, useQuote } from "@/lib/marketplace";
import { formatBytes, formatSom } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { usePaymentPolicy } from "@/providers/PaymentPolicyProvider";
import { useAuth } from "@/providers/AuthProvider";
import { colors, radius, shadow, spacing, typography } from "@/theme/tokens";

type PickedFile = { uri: string; name: string; mimeType: string; sizeBytes: number };

/** The extension the storage path should carry, derived from the sniffed type. */
function extensionFor(mimeType: string, name: string): string {
  if (mimeType.includes("presentationml")) return "pptx";
  if (mimeType.includes("wordprocessingml")) return "docx";
  if (mimeType.includes("pdf")) return "pdf";
  return name.split(".").pop()?.toLowerCase() ?? "bin";
}

/**
 * Publishing a material.
 *
 * The price calculator below the field is not arithmetic done here — it is
 * `marketplace_quote()` answering with the commission rates in force right now.
 * If an admin changes the platform's cut while this screen is open, the next
 * keystroke shows the new numbers.
 */
export default function SellScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { types } = useMaterialTypes();
  /**
   * Arriving from the O‘yingoh editor's "Do‘konda sotish" button. A game
   * listing carries no file — the product references the game row, and the
   * purchase grants an entitlement to host it — so the type is fixed and the
   * upload fields are not offered.
   */
  const params = useLocalSearchParams<{ gameId?: string; gameTitle?: string }>();
  const gameId = typeof params.gameId === "string" ? params.gameId : null;
  const policy = usePaymentPolicy();

  const [materialType, setMaterialType] = useState<string | null>(gameId ? "game" : null);
  const [title, setTitle] = useState(typeof params.gameTitle === "string" ? params.gameTitle : "");
  const [description, setDescription] = useState("");
  const [priceText, setPriceText] = useState("");
  const [units, setUnits] = useState("");
  const [cover, setCover] = useState<PickedFile | null>(null);
  const [previews, setPreviews] = useState<PickedFile[]>([]);
  const [mainFile, setMainFile] = useState<PickedFile | null>(null);
  const [guideFile, setGuideFile] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = useMemo(() => {
    const parsed = Number.parseInt(priceText.replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [priceText]);
  const quote = useQuote(price);

  const selectedType: MarketplaceMaterialType | undefined = types.find((type) => type.code === materialType);

  const problem =
    !materialType ? "Material turini tanlang."
    : title.trim().length < 3 ? "Nom kamida 3 ta belgidan iborat bo‘lsin."
    : price <= 0 ? "Narxni kiriting."
    : !gameId && !mainFile ? "Asosiy faylni yuklang."
    : null;

  async function pickImage(kind: "cover" | "preview") {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    let sizeBytes = asset.fileSize ?? 0;
    if (!sizeBytes) sizeBytes = (await (await fetch(asset.uri)).blob()).size;
    const picked: PickedFile = {
      uri: asset.uri,
      name: asset.fileName ?? "cover.jpg",
      mimeType: asset.mimeType && /image\/(jpeg|png|webp)/.test(asset.mimeType) ? asset.mimeType : "image/jpeg",
      sizeBytes,
    };
    if (kind === "cover") setCover(picked);
    else setPreviews((current) => [...current, picked].slice(0, 6));
  }

  async function pickDocument(kind: "main" | "guide") {
    if (!selectedType) return;
    // The picker is limited to what this material type accepts; the server
    // re-checks the sniffed type, because a picker filter is not a control.
    const accepted = kind === "main"
      ? selectedType.allowed_mime_types
      : ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf"];
    const result = await DocumentPicker.getDocumentAsync({ type: accepted, copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    const mimeType = asset.mimeType ?? "";
    if (kind === "main" && !accepted.includes(mimeType)) {
      Alert.alert("Fayl mos emas", `Bu material turi uchun ${accepted.join(", ")} formatlari qabul qilinadi.`);
      return;
    }
    if (kind === "main" && (asset.size ?? 0) > selectedType.max_file_bytes) {
      Alert.alert("Fayl katta", `Maksimal hajm: ${formatBytes(selectedType.max_file_bytes)}.`);
      return;
    }

    const picked: PickedFile = { uri: asset.uri, name: asset.name, mimeType, sizeBytes: asset.size ?? 0 };
    if (kind === "main") setMainFile(picked);
    else setGuideFile(picked);
  }

  async function upload(bucket: string, path: string, file: PickedFile): Promise<void> {
    const blob = await (await fetch(file.uri)).blob();
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, blob, {
      contentType: file.mimeType,
      upsert: true,
    });
    if (uploadError) throw uploadError;
  }

  async function publish() {
    if (!user || problem || !materialType) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      // The listing exists first, so every object has a product id to live
      // under — the storage policy is keyed on that path shape.
      const { data: productId, error: saveError } = await supabase.rpc("marketplace_save_product", {
        p_product_id: undefined as unknown as string,
        p_material_type: materialType,
        p_title: title.trim(),
        p_description: description.trim(),
        p_base_price: price,
        p_content_units: Number.parseInt(units.replace(/[^0-9]/g, ""), 10) || undefined,
        p_file_format: mainFile ? extensionFor(mainFile.mimeType, mainFile.name) : undefined,
        p_submit: false,
        ...(gameId ? { p_game_id: gameId } : {}),
      });
      if (saveError) throw saveError;
      const id = productId as string;
      const base = `${user.id}/${id}`;

      if (cover) {
        const path = `${base}/cover-${Crypto.randomUUID()}.jpg`;
        await upload("marketplace-previews", path, cover);
        await supabase.rpc("marketplace_save_product", {
          p_product_id: id,
          p_material_type: materialType,
          p_title: title.trim(),
          p_description: description.trim(),
          p_base_price: price,
          p_cover_path: path,
          p_content_units: Number.parseInt(units.replace(/[^0-9]/g, ""), 10) || undefined,
          p_file_format: mainFile ? extensionFor(mainFile.mimeType, mainFile.name) : undefined,
          p_submit: false,
          ...(gameId ? { p_game_id: gameId } : {}),
        });
      }

      for (const [index, preview] of previews.entries()) {
        const path = `${base}/preview-${Crypto.randomUUID()}.jpg`;
        await upload("marketplace-previews", path, preview);
        await supabase.rpc("marketplace_attach_file", {
          p_product_id: id, p_kind: "preview", p_storage_path: path,
          p_mime_type: preview.mimeType, p_size_bytes: preview.sizeBytes,
          p_original_name: preview.name, p_position: index,
        });
      }

      if (mainFile) {
        const path = `${base}/main-${Crypto.randomUUID()}.${extensionFor(mainFile.mimeType, mainFile.name)}`;
        await upload("marketplace-files", path, mainFile);
        const { error: attachError } = await supabase.rpc("marketplace_attach_file", {
          p_product_id: id, p_kind: "main", p_storage_path: path,
          p_mime_type: mainFile.mimeType, p_size_bytes: mainFile.sizeBytes, p_original_name: mainFile.name,
        });
        if (attachError) throw attachError;
      }

      if (guideFile) {
        const path = `${base}/guide-${Crypto.randomUUID()}.${extensionFor(guideFile.mimeType, guideFile.name)}`;
        await upload("marketplace-files", path, guideFile);
        await supabase.rpc("marketplace_attach_file", {
          p_product_id: id, p_kind: "study_guide", p_storage_path: path,
          p_mime_type: guideFile.mimeType, p_size_bytes: guideFile.sizeBytes, p_original_name: guideFile.name,
        });
      }

      // Only now does it enter the queue: a listing without its files would be
      // rejected by a moderator for something the seller did not do wrong.
      const { error: submitError } = await supabase.rpc("marketplace_save_product", {
        p_product_id: id,
        p_material_type: materialType,
        p_title: title.trim(),
        p_description: description.trim(),
        p_base_price: price,
        p_content_units: Number.parseInt(units.replace(/[^0-9]/g, ""), 10) || undefined,
        p_file_format: mainFile ? extensionFor(mainFile.mimeType, mainFile.name) : undefined,
        p_submit: true,
        ...(gameId ? { p_game_id: gameId } : {}),
      });
      if (submitError) throw submitError;

      Alert.alert(
        "Yuborildi",
        "Material moderatsiyaga yuborildi. Tasdiqlangach Do‘konda ko‘rinadi va sizga xabar keladi.",
        [{ text: "Yaxshi", onPress: () => router.replace("/(app)/marketplace/seller") }],
      );
    } catch (nextError) {
      setError(asErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  // Selling is the other half of a storefront: if the shop is closed on this
  // platform, listing a price into it is closed too.
  if (!policy.loading && !policy.paymentsEnabled) {
    return (
      <PaymentUnavailable
        title={policy.unavailableMessage("marketplace")}
        message="Mavjud e’lonlaringiz o‘zgarishsiz qoladi."
        onLeave={() => router.back()}
      />
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <ScreenHeader title="Material sotish" variant="close" onLeave={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.block}>
          <Text style={styles.label}>Material turi</Text>
          {gameId ? (
            <View style={[styles.typeChip, styles.typeChipActive, { alignSelf: "flex-start" }]}>
              <Text style={[styles.typeText, styles.typeTextActive]}>O‘yin</Text>
            </View>
          ) : (
            <View style={styles.typeRow}>
              {types.filter((type) => type.code !== "game").map((type) => (
                <Pressable
                  key={type.code}
                  onPress={() => { setMaterialType(type.code); setMainFile(null); setGuideFile(null); }}
                  style={[styles.typeChip, materialType === type.code && styles.typeChipActive]}
                >
                  <Text style={[styles.typeText, materialType === type.code && styles.typeTextActive]}>{type.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {gameId ? (
            <Text style={styles.hint}>
              O‘yin fayl sifatida yuklanmaydi. Xaridor uni o‘z kutubxonasidan boshlab o‘tkazadi,
              o‘yin esa sizning nomingizda qoladi.
            </Text>
          ) : selectedType ? <Text style={styles.hint}>{selectedType.description}</Text> : null}
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>Nomi</Text>
          <TextInput
            value={title}
            onChangeText={(value) => setTitle(value.slice(0, 160))}
            placeholder="Masalan: Alisher Navoiy hayoti va ijodi"
            placeholderTextColor={colors.inkSoft}
            style={styles.input}
          />
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>Tavsif</Text>
          <TextInput
            value={description}
            onChangeText={(value) => setDescription(value.slice(0, 4000))}
            placeholder="Material nima haqida, kimga mos, nimalarni o‘z ichiga oladi"
            placeholderTextColor={colors.inkSoft}
            multiline
            style={[styles.input, styles.multiline]}
          />
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>Slayd / bet soni</Text>
          <TextInput
            value={units}
            onChangeText={(value) => setUnits(value.replace(/[^0-9]/g, "").slice(0, 5))}
            placeholder="Masalan: 18"
            placeholderTextColor={colors.inkSoft}
            keyboardType="number-pad"
            style={styles.input}
          />
        </View>

        {/* ------------------------------------------------ price calculator */}
        <View style={styles.block}>
          <Text style={styles.label}>Siz belgilagan narx</Text>
          <TextInput
            value={priceText}
            onChangeText={(value) => setPriceText(value.replace(/[^0-9]/g, "").slice(0, 9))}
            placeholder="10000"
            placeholderTextColor={colors.inkSoft}
            keyboardType="number-pad"
            style={[styles.input, styles.priceInput]}
          />

          {quote && price > 0 ? (
            <View style={styles.calculator}>
              <Text style={styles.calcNote}>
                Platforma mahsulot sotilganda {quote.seller_fee_rate}% komissiya oladi. Narxni shunga qarab belgilang.
              </Text>

              <Text style={styles.calcSection}>Siz olasiz</Text>
              <View style={styles.calcLine}>
                <Text style={styles.calcLabel}>Asosiy narx</Text>
                <Text style={styles.calcValue}>{formatSom(quote.base_price)}</Text>
              </View>
              <View style={styles.calcLine}>
                <Text style={styles.calcLabel}>Sotuvchi komissiyasi ({quote.seller_fee_rate}%)</Text>
                <Text style={[styles.calcValue, styles.calcNegative]}>−{formatSom(quote.seller_fee_amount)}</Text>
              </View>
              <View style={styles.calcDivider} />
              <View style={styles.calcLine}>
                <Text style={styles.calcTotalLabel}>Sizga tushadi</Text>
                <Text style={styles.calcTotal}>{formatSom(quote.seller_net)}</Text>
              </View>

              <Text style={[styles.calcSection, styles.calcSectionSpaced]}>Xaridor to‘laydi</Text>
              <View style={styles.calcLine}>
                <Text style={styles.calcLabel}>Mahsulot</Text>
                <Text style={styles.calcValue}>{formatSom(quote.base_price)}</Text>
              </View>
              <View style={styles.calcLine}>
                <Text style={styles.calcLabel}>Xizmat haqi ({quote.buyer_fee_rate}%)</Text>
                <Text style={styles.calcValue}>{formatSom(quote.buyer_fee_amount)}</Text>
              </View>
              <View style={styles.calcDivider} />
              <View style={styles.calcLine}>
                <Text style={styles.calcTotalLabel}>Jami</Text>
                <Text style={styles.calcTotal}>{formatSom(quote.buyer_total)}</Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* ------------------------------------------------------------ files */}
        <View style={styles.block}>
          <Text style={styles.label}>Muqova rasmi</Text>
          {cover ? (
            <View style={styles.filePicked}>
              <Image source={{ uri: cover.uri }} style={styles.coverThumb} />
              <Text numberOfLines={1} style={styles.fileName}>{cover.name}</Text>
              <Pressable accessibilityLabel="Olib tashlash" onPress={() => setCover(null)} style={styles.fileRemove}>
                <X color={colors.danger} size={14} strokeWidth={2.4} />
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => void pickImage("cover")} style={styles.picker}>
              <ImageIcon color={colors.primary} size={18} strokeWidth={2} />
              <Text style={styles.pickerText}>Muqova tanlash</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>Ko‘rish uchun rasmlar ({previews.length}/6)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewStrip}>
            {previews.map((preview, index) => (
              <Pressable
                key={preview.uri}
                accessibilityLabel="Olib tashlash"
                onPress={() => setPreviews((current) => current.filter((_, position) => position !== index))}
              >
                <Image source={{ uri: preview.uri }} style={styles.previewThumb} />
              </Pressable>
            ))}
            {previews.length < 6 ? (
              <Pressable onPress={() => void pickImage("preview")} style={styles.previewAdd}>
                <ImageIcon color={colors.primary} size={18} strokeWidth={2} />
              </Pressable>
            ) : null}
          </ScrollView>
        </View>

        {/* A game has no bytes to upload: the listing references the game row. */}
        {!gameId ? (<>
        <View style={styles.block}>
          <Text style={styles.label}>Asosiy fayl</Text>
          {mainFile ? (
            <View style={styles.filePicked}>
              <FileUp color={colors.primary} size={18} strokeWidth={2} />
              <View style={styles.fileCopy}>
                <Text numberOfLines={1} style={styles.fileName}>{mainFile.name}</Text>
                <Text style={styles.fileSize}>{formatBytes(mainFile.sizeBytes)}</Text>
              </View>
              <Pressable accessibilityLabel="Olib tashlash" onPress={() => setMainFile(null)} style={styles.fileRemove}>
                <X color={colors.danger} size={14} strokeWidth={2.4} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => void pickDocument("main")}
              disabled={!selectedType}
              style={[styles.picker, !selectedType && styles.pickerDisabled]}
            >
              <FileUp color={colors.primary} size={18} strokeWidth={2} />
              <Text style={styles.pickerText}>
                {selectedType ? "Fayl tanlash" : "Avval material turini tanlang"}
              </Text>
            </Pressable>
          )}
        </View>

        {selectedType?.supports_study_guide ? (
          <View style={styles.block}>
            <Text style={styles.label}>Qo‘shimcha o‘quv materiali (ixtiyoriy)</Text>
            {guideFile ? (
              <View style={styles.filePicked}>
                <BookOpenText color={colors.primary} size={18} strokeWidth={2} />
                <View style={styles.fileCopy}>
                  <Text numberOfLines={1} style={styles.fileName}>{guideFile.name}</Text>
                  <Text style={styles.fileSize}>{formatBytes(guideFile.sizeBytes)}</Text>
                </View>
                <Pressable accessibilityLabel="Olib tashlash" onPress={() => setGuideFile(null)} style={styles.fileRemove}>
                  <X color={colors.danger} size={14} strokeWidth={2.4} />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => void pickDocument("guide")} style={styles.picker}>
                <BookOpenText color={colors.primary} size={18} strokeWidth={2} />
                <Text style={styles.pickerText}>Study guide biriktirish</Text>
              </Pressable>
            )}
            <Text style={styles.hint}>Xaridor uni yuklab oladi, lekin Jaxongirman muharririda tahrirlay olmaydi.</Text>
          </View>
        ) : null}

        {error ? <InlineError message={error} /> : null}
        </>) : null}

        <PrimaryButton
          label="Moderatsiyaga yuborish"
          icon={Send}
          loading={busy}
          disabled={Boolean(problem)}
          onPress={() => void publish()}
        />
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <Text style={styles.footnote}>
          Material administrator tasdiqlagandan keyin Do‘konda ko‘rinadi. Tasdiqlash yoki qaytarish haqida
          sizga xabarnoma keladi.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },

  block: { gap: spacing.sm },
  label: { ...typography.bodyMedium, color: colors.ink },
  hint: { ...typography.caption, color: colors.inkSoft, lineHeight: 17 },
  input: {
    ...typography.body, color: colors.ink, minHeight: 52,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  multiline: { minHeight: 100, textAlignVertical: "top" },
  priceInput: { fontFamily: "Manrope_700Bold", fontSize: 22 },

  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  typeChip: { paddingHorizontal: spacing.md, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeText: { ...typography.caption, color: colors.inkMuted },
  typeTextActive: { color: colors.onPrimary },

  calculator: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primarySoft, gap: 6, marginTop: spacing.sm },
  calcNote: { ...typography.caption, color: colors.primaryDeep, lineHeight: 18, marginBottom: spacing.sm },
  calcSection: { ...typography.caption, color: colors.primaryDeep, fontFamily: "Manrope_600SemiBold", letterSpacing: 0.4, textTransform: "uppercase" },
  calcSectionSpaced: { marginTop: spacing.md },
  calcLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  calcLabel: { ...typography.caption, color: colors.inkMuted },
  calcValue: { ...typography.caption, color: colors.ink },
  calcNegative: { color: colors.danger },
  calcDivider: { height: 1, backgroundColor: colors.borderStrong, marginVertical: 3, opacity: 0.6 },
  calcTotalLabel: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  calcTotal: { ...typography.bodyMedium, color: colors.primaryDeep, fontSize: 16 },

  picker: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 56, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong, backgroundColor: colors.surfaceMuted },
  pickerDisabled: { opacity: 0.5 },
  pickerText: { ...typography.bodyMedium, color: colors.primary, fontSize: 14 },
  filePicked: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  fileCopy: { flex: 1 },
  fileName: { ...typography.caption, color: colors.ink, fontFamily: "Manrope_600SemiBold", flex: 1 },
  fileSize: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  fileRemove: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.dangerSoft },
  coverThumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.border },
  previewStrip: { gap: spacing.sm, paddingVertical: 2 },
  previewThumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  previewAdd: { width: 72, height: 72, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong, backgroundColor: colors.surfaceMuted },

  problem: { ...typography.caption, color: colors.inkSoft, textAlign: "center" },
  footnote: { ...typography.caption, color: colors.inkSoft, textAlign: "center", lineHeight: 18, ...shadow, shadowOpacity: 0 },
});
