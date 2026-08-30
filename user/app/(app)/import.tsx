import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { Coins, FileUp, Info } from "lucide-react-native";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { asErrorMessage, asFunctionErrorMessage } from "@/lib/format";
import { uploadLocalFile } from "@/lib/upload";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
/** The bucket's own ceiling. Checking here saves a 50 MB round trip to a refusal. */
const MAX_BYTES = 52_428_800;

type Picked = { uri: string; name: string; sizeBytes: number };
type Quote = { cost: number; balance: number; affordable: boolean };

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
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { user } = useAuth();
  const running = useRef(false);
  const [file, setFile] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [agreed, setAgreed] = useState(false);

  /**
   * What it will cost, asked before anything is uploaded.
   *
   * Nobody should learn a price by being charged it. The figure comes from the
   * same list the charge will read, so the number shown here and the number
   * taken cannot be two different numbers.
   */
  async function fetchQuote() {
    setQuote(null);
    setAgreed(false);
    const { data, error: quoteError } = await supabase.functions.invoke("import-pptx", {
      body: { step: "quote" },
    });
    if (quoteError) {
      setError(asErrorMessage(quoteError));
      return;
    }
    setQuote(data as Quote);
  }

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
    await fetchQuote();
  }

  async function run() {
    if (!file || !user) return;
    /**
     * A second tap must not start a second import.
     *
     * `busy` disables the button, but state lands a render later and two quick
     * taps both pass the check — and each one creates its own presentation, so
     * the idempotency key on the reservation is different and the person is
     * charged twice. A ref changes on the same tick.
     */
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      setStep("Fayl yuklanmoqda…");
      // `expo-crypto`, not the global. Hermes has no `crypto` object, so the
      // global form throws "Property 'crypto' doesn't exist" the moment an
      // import starts — which is every import, on every device. Every other
      // screen in the app already imports this module; this one did not.
      const storagePath = `${user.id}/imports/${Crypto.randomUUID()}.pptx`;
      const uploaded = await uploadLocalFile({
        bucket: "user-uploads",
        path: storagePath,
        uri: file.uri,
        contentType: PPTX_MIME,
        maxBytes: MAX_BYTES,
        tooLargeMessage: "Fayl 50 MB dan katta. Rasmlarni siqib, qaytadan urinib ko‘ring.",
      });
      if (!uploaded.ok) throw new Error(uploaded.message);

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
        running.current = false;
        setTimeout(() => router.replace({ pathname: "/(app)/presentation/[id]", params: { id: result.presentationId } }), 2200);
        return;
      }
      router.replace({ pathname: "/(app)/presentation/[id]", params: { id: result.presentationId } });
    } catch (failure) {
      /**
       * The server's sentence, or ours — never the runtime's.
       *
       * Our functions answer with an Uzbek sentence and a code, and that is
       * what a person should read. A failure with no such body is a technical
       * one — a missing runtime global, a transport error — and its message is
       * developer text that means nothing to the author and alarms them:
       * "Property 'crypto' doesn't exist" is what this screen used to show.
       * The detail is kept in the log, where it is useful.
       */
      running.current = false;
      const fromServer = await asFunctionErrorMessage(failure);
      const technical = !(failure as { context?: unknown })?.context;
      if (technical && __DEV__) console.warn("pptx import failed", failure);
      setError(technical
        ? "PowerPoint faylini import qilib bo‘lmadi. J Tanga yechilgan bo‘lsa, qaytariladi."
        : fromServer);
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

        {/* The price, and what it buys, before a single byte is uploaded. The
            charge is taken when the deck imports successfully and is not given
            back afterwards — somebody agreeing to that has to have been told
            it first, plainly, on the screen where they agree. */}
        {file && quote && quote.cost > 0 ? (
          <View style={styles.quote}>
            <View style={styles.quoteHead}>
              <Coins color={colors.primary} size={18} strokeWidth={2} />
              <Text style={styles.quoteTitle}>{quote.cost} J Tanga</Text>
              <Text style={styles.quoteBalance}>Balans: {quote.balance} J</Text>
            </View>
            <Text style={styles.quoteBody}>
              Tashqi PowerPoint faylini import qilish {quote.cost} J Tanga turadi. Import muvaffaqiyatli
              tugagach, bu summa qaytarilmaydi. Texnik xatolik yuz bersa, tanga to‘liq qaytariladi.
            </Text>

            {quote.affordable ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreed }}
                onPress={() => setAgreed((was) => !was)}
                style={styles.agreeRow}
              >
                <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
                  {agreed ? <Text style={styles.checkboxTick}>✓</Text> : null}
                </View>
                <Text style={styles.agreeText}>Roziman, {quote.cost} J Tanga yechilishini tasdiqlayman.</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => router.push("/(app)/coins/buy")} style={styles.topUp}>
                <Text style={styles.topUpText}>Tanga yetarli emas — to‘ldirish</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {error ? <InlineError message={error} /> : null}

        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.busyText}>{step}</Text>
          </View>
        ) : (
          <PrimaryButton
            disabled={!file || (quote !== null && quote.cost > 0 && (!agreed || !quote.affordable))}
            label="Import qilish"
            onPress={() => void run()}
          />
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
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
  quote: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceMuted },
  quoteHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  quoteTitle: { ...typography.heading, color: colors.ink, flex: 1 },
  quoteBalance: { ...typography.caption, color: colors.inkMuted },
  quoteBody: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
  agreeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.xs },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxTick: { color: colors.onPrimary, fontSize: 13, lineHeight: 16 },
  agreeText: { ...typography.caption, color: colors.ink, flex: 1 },
  topUp: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  topUpText: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },
  busy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.md },
  busyText: { ...typography.body, color: colors.inkMuted },
}));
