import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { FileUp, Info } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { colors, radius, spacing, typography } from "@/theme/tokens";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
/** The bucket's own ceiling. Checking here saves a 50 MB round trip to a refusal. */
const MAX_BYTES = 52_428_800;

type Picked = { uri: string; name: string; sizeBytes: number };

/**
 * Bringing an existing deck in.
 *
 * The file goes to storage first and the server reads it from there, so the
 * phone never holds the parsed deck and a large upload is the storage client's
 * problem rather than a function body's. What comes back is an ordinary
 * presentation, which is why this screen ends by handing off to the editor
 * instead of showing anything of its own.
 */
export default function ImportScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [file, setFile] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function pick() {
    setError(null);
    setWarnings([]);
    const result = await DocumentPicker.getDocumentAsync({ type: PPTX_MIME, copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    // Some Android providers hand back a generic type, so the extension is the
    // fallback rather than the only check.
    const looksRight = asset.mimeType === PPTX_MIME || asset.name.toLowerCase().endsWith(".pptx");
    if (!looksRight) {
      setError("Faqat .pptx fayllari qabul qilinadi. Eski .ppt formatini avval PowerPoint’da saqlang.");
      return;
    }
    if ((asset.size ?? 0) > MAX_BYTES) {
      setError("Fayl 50 MB dan katta. Rasmlarni siqib, qaytadan urinib ko‘ring.");
      return;
    }
    setFile({ uri: asset.uri, name: asset.name, sizeBytes: asset.size ?? 0 });
  }

  async function run() {
    if (!file || !user) return;
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      setStep("Fayl yuklanmoqda…");
      const storagePath = `${user.id}/imports/${crypto.randomUUID()}.pptx`;
      const blob = await (await fetch(file.uri)).blob();
      const uploaded = await supabase.storage.from("user-uploads").upload(storagePath, blob, {
        contentType: PPTX_MIME,
        upsert: false,
      });
      if (uploaded.error) throw uploaded.error;

      setStep("Slaydlar o‘qilmoqda…");
      const { data, error: importError } = await supabase.functions.invoke("import-pptx", {
        body: { storagePath, sourceName: file.name },
      });
      if (importError) throw importError;

      const result = data as { presentationId: string; warnings?: string[] };
      if (result.warnings?.length) {
        // Worth a beat on screen: these say what changed shape on the way in,
        // and the editor cannot say it later.
        setWarnings(result.warnings);
        setStep(null);
        setBusy(false);
        setFile(null);
        setTimeout(() => router.replace({ pathname: "/(app)/presentation/[id]", params: { id: result.presentationId } }), 2200);
        return;
      }
      router.replace({ pathname: "/(app)/presentation/[id]", params: { id: result.presentationId } });
    } catch (failure) {
      setError(asErrorMessage(failure));
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="PowerPoint’dan yuklash" variant="close" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          Tayyor .pptx faylni yuklang — slaydlar, matnlar va rasmlar tahrirlanadigan holda ochiladi.
        </Text>

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void pick()}
          style={({ pressed }) => [styles.dropzone, pressed && styles.dropzonePressed, file && styles.dropzoneFilled]}
        >
          <View style={styles.dropzoneIcon}><FileUp color={colors.primary} size={26} strokeWidth={2} /></View>
          <Text style={styles.dropzoneTitle}>{file ? file.name : "Fayl tanlang"}</Text>
          <Text style={styles.dropzoneHint}>
            {file ? `${(file.sizeBytes / 1_048_576).toFixed(1)} MB — almashtirish uchun bosing` : ".pptx, 50 MB gacha"}
          </Text>
        </Pressable>

        <View style={styles.note}>
          <Info color={colors.inkSoft} size={16} strokeWidth={2} />
          <Text style={styles.noteText}>
            Animatsiyalar va o‘tishlar ko‘chmaydi. Diagrammalar o‘rni saqlanadi, lekin ularni qayta chizish kerak.
            Taqdimotdan dastlabki 30 ta slayd olinadi.
          </Text>
        </View>

        {warnings.length > 0 ? (
          <View style={styles.warnings}>
            {warnings.map((warning) => <Text key={warning} style={styles.warningText}>• {warning}</Text>)}
            <Text style={styles.warningLead}>Tahrirlagichga o‘tilmoqda…</Text>
          </View>
        ) : null}

        {error ? <InlineError message={error} /> : null}

        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.busyText}>{step}</Text>
          </View>
        ) : (
          <PrimaryButton disabled={!file} label="Import qilish" onPress={() => void run()} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 48, gap: spacing.lg },
  lead: { ...typography.body, color: colors.inkMuted, lineHeight: 22 },
  dropzone: {
    alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xl * 1.4, paddingHorizontal: spacing.lg,
    borderRadius: radius.xl, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dropzonePressed: { opacity: 0.85 },
  dropzoneFilled: { borderStyle: "solid", borderColor: colors.primary },
  dropzoneIcon: {
    width: 56, height: 56, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primarySoft, marginBottom: spacing.xs,
  },
  dropzoneTitle: { ...typography.bodyMedium, color: colors.ink, textAlign: "center" },
  dropzoneHint: { ...typography.caption, color: colors.inkSoft, textAlign: "center" },
  note: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  noteText: { ...typography.caption, color: colors.inkSoft, flex: 1, lineHeight: 18 },
  warnings: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  warningText: { ...typography.caption, color: colors.ink, lineHeight: 18 },
  warningLead: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xs },
  busy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.md },
  busyText: { ...typography.body, color: colors.inkMuted },
});
