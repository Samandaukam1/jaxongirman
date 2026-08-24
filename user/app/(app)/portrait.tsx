import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { Check, ClipboardCopy, Download, ExternalLink, ImagePlus, Sparkles } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, Share, Text, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { asErrorMessage } from "@/lib/format";
import { buildPortraitSheet, portraitPrompt, sheetUrl, uploadPortrait, type PortraitSheet } from "@/lib/portrait";
import { useAuth } from "@/providers/AuthProvider";
import { icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * A picture becomes nine printable identity photographs.
 *
 * Four steps, and the second one happens outside this app on purpose. Running
 * an image model here would mean paying for every attempt, owning every refusal
 * and every "make me look thinner", and showing the person a result they cannot
 * judge until it is already spent. Handing over the instruction instead lets
 * them use whichever model they already have open, see the face before
 * committing, and come back only when they are happy with it.
 *
 * What this app does is the part it can do exactly: measure, crop and lay out at
 * a size a printer will not soften.
 */

const STEPS = ["Prompt", "ChatGPT", "Rasm", "Chop etish"] as const;

export default function PortraitScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PortraitSheet | null>(null);
  const [busy, setBusy] = useState<"upload" | "sheet" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPrompt(await portraitPrompt()); } catch { /* the copy button simply has nothing to give */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function pick() {
    if (!user) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    setBusy("upload"); setError(null); setSheet(null);
    try {
      setPreview(asset.uri);
      const path = await uploadPortrait(asset, user.id);
      setSourcePath(path);
      setStep(3);
    } catch (uploadError) {
      setError(asErrorMessage(uploadError));
      setPreview(null);
    } finally {
      setBusy(null);
    }
  }

  async function build() {
    if (!sourcePath) return;
    setBusy("sheet"); setError(null);
    try {
      setSheet(await buildPortraitSheet(sourcePath));
    } catch (buildError) {
      setError(asErrorMessage(buildError));
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    if (!sheet) return;
    setBusy("download"); setError(null);
    try {
      const url = await sheetUrl(sheet.sheetPath);
      if (Platform.OS === "web") { window.open(url, "_blank", "noopener,noreferrer"); return; }
      const { uri } = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}3x4-rasm.pdf`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "3×4 rasm" });
      }
    } catch (downloadError) {
      setError(asErrorMessage(downloadError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="3×4 rasm" />

      <View style={styles.steps}>
        {STEPS.map((label, index) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            // Going back is always allowed; going forward is what the work
            // decides, so a step you have not reached is not a target.
            disabled={index > step}
            onPress={() => setStep(index)}
            style={styles.stepItem}
          >
            <View style={[styles.stepDot, index <= step && styles.stepDotOn]}>
              {index < step
                ? <Check color={colors.onPrimary} size={13} strokeWidth={3} />
                : <Text style={[styles.stepNumber, index <= step && styles.stepNumberOn]}>{index + 1}</Text>}
            </View>
            <Text style={[styles.stepLabel, index === step && styles.stepLabelOn]} numberOfLines={1}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {step === 0 ? (
          <>
            <Text style={styles.lead}>
              Quyidagi matn — rasm modeliga beriladigan aniq ko‘rsatma. U yuzni o‘zgartirmaslikni,
              oq studiya foni va rasmiy kiyimni talab qiladi.
            </Text>
            <View style={styles.promptCard}>
              <Text style={styles.promptText} numberOfLines={12}>{prompt || "…"}</Text>
            </View>
            {/* Straight to the clipboard: the next thing the person does is
                paste, and a share sheet in between is a menu to dismiss. */}
            <Pressable
              disabled={!prompt}
              onPress={() => {
                void Clipboard.setStringAsync(prompt).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              style={[styles.primary, !prompt && styles.disabled]}
            >
              {copied
                ? <><Check color={colors.onPrimary} size={icon.sm} strokeWidth={2.6} /><Text style={styles.primaryText}>Nusxalandi</Text></>
                : <><ClipboardCopy color={colors.onPrimary} size={icon.sm} strokeWidth={2} /><Text style={styles.primaryText}>Promptni nusxalash</Text></>}
            </Pressable>

            {/* Sharing stays as a second way out, for people who would rather
                send the text into the app than paste it there. */}
            <Pressable
              disabled={!prompt}
              onPress={() => { void Share.share({ message: prompt }).catch(() => { /* dismissed */ }); }}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Ulashish</Text>
            </Pressable>
            <Pressable onPress={() => setStep(1)} style={styles.ghost}>
              <Text style={styles.ghostText}>Keyingisi</Text>
            </Pressable>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Text style={styles.lead}>
              ChatGPT’ni oching, nusxalangan promptni qo‘ying va <Text style={styles.bold}>o‘z rasmingizni
              birga yuboring</Text>. Rasm yuzingiz aniq ko‘rinadigan, yorug‘ joyda olingan bo‘lsin.
            </Text>
            <View style={styles.tips}>
              {[
                "Rasmda faqat siz bo‘ling",
                "Yuz to‘g‘ridan-to‘g‘ri ko‘rinsin",
                "Ko‘zoynak aksi va soya bo‘lmasin",
                "Natijani telefoningizga saqlang",
              ].map((tip) => (
                <View key={tip} style={styles.tip}>
                  <View style={styles.tipDot} />
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
            <Pressable onPress={() => void Linking.openURL("https://chat.openai.com/")} style={styles.secondary}>
              <ExternalLink color={colors.primary} size={icon.sm} strokeWidth={2} />
              <Text style={styles.secondaryText}>ChatGPT’ni ochish</Text>
            </Pressable>
            <Pressable onPress={() => setStep(2)} style={styles.primary}>
              <Text style={styles.primaryText}>Rasm tayyor</Text>
            </Pressable>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Text style={styles.lead}>
              ChatGPT qaytargan rasmni yuklang. Rasm bo‘yiga va kamida 355×473 nuqta bo‘lishi kerak —
              aks holda chop etilganda xira chiqadi.
            </Text>
            <Pressable disabled={busy !== null} onPress={() => void pick()} style={[styles.dropzone, busy !== null && styles.disabled]}>
              {busy === "upload"
                ? <ActivityIndicator color={colors.primary} size="large" />
                : <><ImagePlus color={colors.primary} size={30} strokeWidth={1.8} /><Text style={styles.dropzoneText}>Rasmni tanlash</Text></>}
            </Pressable>
          </>
        ) : null}

        {step === 3 ? (
          <>
            {preview ? <Image source={{ uri: preview }} style={styles.preview} resizeMode="cover" /> : null}
            <Text style={styles.lead}>
              A6 varaqqa 3×3 qilib to‘qqizta 30×40 mm rasm joylashtiriladi. Qirqish uchun ingichka
              chiziqlar chiziladi.
            </Text>

            {sheet?.warnings.map((warning) => (
              <Text key={warning} style={styles.warning}>{warning}</Text>
            ))}

            {sheet ? (
              <Pressable disabled={busy !== null} onPress={() => void download()} style={[styles.primary, busy !== null && styles.disabled]}>
                {busy === "download"
                  ? <ActivityIndicator color={colors.onPrimary} size="small" />
                  : <><Download color={colors.onPrimary} size={icon.sm} strokeWidth={2} /><Text style={styles.primaryText}>PDF yuklab olish</Text></>}
              </Pressable>
            ) : (
              <Pressable disabled={busy !== null || !sourcePath} onPress={() => void build()} style={[styles.primary, (busy !== null || !sourcePath) && styles.disabled]}>
                {busy === "sheet"
                  ? <ActivityIndicator color={colors.onPrimary} size="small" />
                  : <><Sparkles color={colors.onPrimary} size={icon.sm} strokeWidth={2} /><Text style={styles.primaryText}>Chop etish varag‘ini tayyorlash</Text></>}
              </Pressable>
            )}

            <Pressable onPress={() => { setStep(2); setSheet(null); }} style={styles.ghost}>
              <Text style={styles.ghostText}>Boshqa rasm tanlash</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  steps: { flexDirection: "row", paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.xs },
  stepItem: { flex: 1, alignItems: "center", gap: 5 },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  stepDotOn: { backgroundColor: colors.primary },
  stepNumber: { ...typography.caption, fontWeight: "700", color: colors.inkSoft },
  stepNumberOn: { color: colors.onPrimary },
  stepLabel: { ...typography.caption, color: colors.inkSoft },
  stepLabelOn: { color: colors.ink, fontWeight: "700" },
  content: { padding: spacing.xl, paddingTop: spacing.md, gap: spacing.lg },
  lead: { ...typography.body, color: colors.ink },
  bold: { fontWeight: "700" },
  promptCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, maxHeight: 300 },
  promptText: { ...typography.caption, color: colors.inkMuted, lineHeight: 19 },
  tips: { gap: spacing.sm },
  tip: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  tipText: { ...typography.body, color: colors.ink },
  dropzone: {
    alignItems: "center", justifyContent: "center", gap: spacing.sm,
    minHeight: 180, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, borderStyle: "dashed",
    backgroundColor: colors.surfaceMuted,
  },
  dropzoneText: { ...typography.body, fontWeight: "700", color: colors.primary },
  preview: { width: 150, height: 200, borderRadius: radius.md, alignSelf: "center", backgroundColor: colors.surfaceMuted },
  warning: { ...typography.caption, color: colors.inkMuted, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 54, borderRadius: radius.lg, backgroundColor: colors.primary, ...shadow },
  primaryText: { ...typography.body, fontWeight: "700", color: colors.onPrimary },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  secondaryText: { ...typography.body, fontWeight: "700", color: colors.primaryDeep },
  ghost: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  ghostText: { ...typography.body, color: colors.inkMuted },
  disabled: { opacity: 0.5 },
  error: { ...typography.caption, color: colors.danger },
}));
